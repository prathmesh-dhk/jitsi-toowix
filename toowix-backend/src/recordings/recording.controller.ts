import fs from 'fs';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import * as recordingService from './recording.service';

// Every function here does exactly one thing: parse the HTTP request, call one
// recording.service.ts function, and send the result back out. No business logic lives in this
// file. The one exception is streamRecordingHandler: it calls the service to validate/resolve
// the file, then does the actual Range-request parsing and byte piping itself, since streaming a
// ReadStream into `res` is irreducibly response-stream mechanics.

/**
 * GET /api/recordings
 * Lists recordings visible to the caller, plus aggregate stats.
 */
export const listRecordingsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await recordingService.listRecordings(req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/recordings/session  { roomSlug, action: 'start' | 'stop' }
 */
export const recordingSessionHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const account: any = req.accountUser;
  const roomSlug = typeof req.body?.roomSlug === 'string' ? req.body.roomSlug : '';
  const action = req.body?.action === 'stop' ? 'stop' : 'start';
  const result = await recordingService.startStopRecordingSession(account?.id, roomSlug, action);
  res.status(result.httpStatus).json(result.body);
};

/**
 * POST /api/recordings/ingest
 * Called by the Jibri finalize worker. Not user-authenticated -- gated by a shared secret.
 */
export const ingestRecordingHandler = async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const result = await recordingService.ingestRecording({ ...req.body, providedKey });
  res.status(result.httpStatus).json(result.body);
};

/**
 * PATCH /api/recordings/:id
 * Rename a recording. Owner (creator) or company admin only.
 */
export const renameRecordingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await recordingService.renameRecording(req.params.id, req.firebaseUid, req.body);
  res.status(result.httpStatus).json(result.body);
};

/**
 * DELETE /api/recordings/:id
 * Owner (creator) or company admin only.
 */
export const deleteRecordingHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await recordingService.deleteRecording(req.params.id, req.firebaseUid);
  res.status(result.httpStatus).json(result.body);
};

/**
 * GET /api/recordings/:id
 * Fetch a single recording by ID for details or standalone video playback.
 */
export const getRecordingHandler = async (req: Request, res: Response): Promise<void> => {
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const result = await recordingService.getRecording(req.params.id, req.headers.authorization, queryToken);
  res.status(result.httpStatus).json(result.body);
};

/**
 * GET /api/recordings/:id/stream
 * Streams the actual recording bytes for the <video> element to play. Supports HTTP Range
 * requests (required for browsers to seek/scrub, and for some browsers to play at all) via a
 * real 206 Partial Content response.
 */
export const streamRecordingHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    const prepared = await recordingService.prepareRecordingStream(req.params.id, req.headers.authorization, queryToken);

    if (!prepared.ok) {
      res.status(prepared.httpStatus).json(prepared.body);
      return;
    }

    const { filePath, size } = prepared;
    const range = req.headers.range;

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? parseInt(match[1], 10) : 0;
      const end = match?.[2] ? parseInt(match[2], 10) : size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
        res.status(416).set('Content-Range', `bytes */${size}`).end();
        return;
      }

      res.status(206);
      res.set({
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.status(200);
      res.set({
        'Content-Length': String(size),
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error: any) {
    console.error('[Recordings] Error streaming recording:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream recording' });
    }
  }
};
