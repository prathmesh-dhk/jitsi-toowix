import type { ChatStreamEvent } from './types';

/**
 * Pulls complete Server-Sent-Events frames out of a text buffer. Handles both \n and \r\n, ignores
 * comment lines (the server's ": ping" keep-alives) and the "retry:" hint, joins multi-line data, and
 * silently skips a frame whose JSON is broken rather than killing the stream. Returns the unconsumed tail.
 */
export function parseSseBuffer(buffer: string): { events: ChatStreamEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const events: ChatStreamEvent[] = [];
  let rest = normalized;
  let boundary = rest.indexOf('\n\n');

  while (boundary !== -1) {
    const frame = rest.slice(0, boundary);

    rest = rest.slice(boundary + 2);
    boundary = rest.indexOf('\n\n');

    const dataLines: string[] = [];

    for (const line of frame.split('\n')) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) continue;
    try {
      const parsed = JSON.parse(dataLines.join('\n'));

      if (parsed && typeof parsed.type === 'string') events.push(parsed as ChatStreamEvent);
    } catch {
      // A malformed frame is dropped; the next one is processed normally.
    }
  }

  return { events, rest };
}

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'stopped';

export interface IStreamOptions {
  getHeaders: () => Promise<Record<string, string>>;
  url: string;
  onEvent: (event: ChatStreamEvent) => void;
  onStatus: (status: StreamStatus) => void;
  /** Called every time a (re)connection is established, so the screen can re-sync anything it missed. */
  onOpen?: () => void;
  fetchImpl?: typeof fetch;
}

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
// The server pings every 25s; no bytes at all for this long means the connection is dead even though
// the browser has not noticed (sleeping laptop, dropped Wi-Fi) -- tear it down and reconnect.
const SILENCE_LIMIT_MS = 70_000;

export const nextBackoff = (attempt: number): number => Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** Math.max(0, attempt));

/**
 * Keeps one live event stream open for as long as it is not stopped: reconnects with exponential
 * backoff, re-reads fresh auth headers on every attempt (the Firebase token may have been refreshed),
 * and uses fetch streaming instead of EventSource because EventSource cannot send the Authorization
 * and session headers this API requires. Returns a function that stops it for good.
 */
export function startChatStream(options: IStreamOptions): () => void {
  const doFetch = options.fetchImpl || fetch.bind(globalThis);
  let stopped = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const schedule = () => {
    if (stopped) return;
    options.onStatus('reconnecting');
    timer = setTimeout(connect, nextBackoff(attempt));
    attempt += 1;
  };

  async function connect() {
    if (stopped) return;
    controller = new AbortController();
    let silence: ReturnType<typeof setTimeout> | null = null;
    const resetSilence = () => {
      if (silence) clearTimeout(silence);
      silence = setTimeout(() => controller?.abort(), SILENCE_LIMIT_MS);
    };

    try {
      options.onStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      const response = await doFetch(options.url, { headers: await options.getHeaders(), signal: controller.signal });

      if (!response.ok || !response.body) {
        // 401/403 will not fix themselves by retrying fast; everything else backs off the same way.
        throw new Error(`stream http ${response.status}`);
      }

      attempt = 0;
      options.onStatus('open');
      options.onOpen?.();
      resetSilence();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { value, done } = await reader.read();

        if (done) break;
        resetSilence();
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseBuffer(buffer);

        buffer = parsed.rest;
        parsed.events.forEach((event) => options.onEvent(event));
      }
    } catch {
      // fall through to the reconnect below (an abort from stop() is filtered by `stopped`)
    } finally {
      if (silence) clearTimeout(silence);
    }
    if (!stopped) schedule();
  }

  void connect();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
    options.onStatus('stopped');
  };
}
