import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execute = promisify(execFile);

export function parseProbe(probe: any, sizeBytes: number) {
  const durationSeconds = Number(probe.format?.duration);
  const streams = probe.streams || [];
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0
    || !streams.some((s: any) => s.codec_type === 'video') || !streams.some((s: any) => s.codec_type === 'audio')) {
    throw new Error('Completed recording must contain video, audio and a positive duration');
  }
  return { durationSeconds, sizeBytes, container: String(probe.format?.format_name || ''),
    codecs: streams.map((s: any) => String(s.codec_name || 'unknown')) };
}

/**
 * Resolves a Recording document's stored relativeFile/fileUrl to a real, safe absolute path
 * inside the recorder mount -- shared by inspectRecording (ingest-time validation) and the
 * playback stream route, so both use the exact same path-traversal guard.
 */
export async function resolveRecordingFilePath(relativeFile: string): Promise<string> {
  const root = await fs.realpath(process.env.RECORDING_ROOT || process.env.RECORDINGS_STORAGE_PATH || '/recordings-storage');
  const file = await fs.realpath(path.resolve(root, relativeFile));
  const relative = path.relative(root, file);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Recording path is outside the recording root');

  return file;
}

/** Probe only a completed local file in the configured recorder mount. Never fetch caller URLs. */
export async function inspectRecording(relativeFile: string) {
  const file = await resolveRecordingFilePath(relativeFile);
  const before = await fs.stat(file);
  if (!before.isFile()) throw new Error('Recording is not a regular file');
  const { stdout } = await execute(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
    { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
  const metadata = parseProbe(JSON.parse(stdout), before.size);
  // A valid container header alone cannot rule out truncated or undecodable content.
  await execute(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'],
    { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024, windowsHide: true });
  const after = await fs.stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Recording is still being written');
  return metadata;
}
