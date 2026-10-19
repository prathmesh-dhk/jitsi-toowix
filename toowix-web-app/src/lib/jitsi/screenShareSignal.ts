// Persistent Jitsi participant-property payload for screen-share lifecycle reconciliation.
export const SCREEN_SHARE_PROPERTY = 'toowixScreenShareState';

export interface IScreenShareSignal {
  version: number;
  sessionId: string;
  status: 'active' | 'stopped';
}

export function parseScreenShareSignal(value: unknown): IScreenShareSignal | null {
  if (typeof value !== 'string') return null;
  try {
    const signal = JSON.parse(value) as Partial<IScreenShareSignal>;
    return Number.isSafeInteger(signal.version) && signal.version! >= 1
      && typeof signal.sessionId === 'string' && signal.sessionId.length > 0
      && (signal.status === 'active' || signal.status === 'stopped')
      ? signal as IScreenShareSignal
      : null;
  } catch {
    return null;
  }
}
