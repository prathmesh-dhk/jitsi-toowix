import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { recordingsRateLimiter } from '../middleware/rateLimit';
import {
  deleteRecordingHandler,
  getRecordingHandler,
  ingestRecordingHandler,
  recordingSessionHandler,
  listRecordingsHandler,
  renameRecordingHandler,
  streamRecordingHandler,
} from '../recordings/recordings';

const router = Router();

// recordingsRateLimiter is registered AFTER verifyFirebaseToken so it can key by the signed-in
// user (see keyByUserOrIp in middleware/rateLimit.ts) instead of falling back to per-IP.
// Deliberately NOT applied to /:id/stream -- a browser scrubbing/seeking a video issues many
// Range requests against that same URL in quick succession, and rate-limiting that would break
// playback, not just abuse. Also not applied to /ingest -- see its own comment below.
router.get('/', verifyFirebaseToken, recordingsRateLimiter, listRecordingsHandler);
router.get('/:id', getRecordingHandler); // public/shared viewing
router.get('/:id/stream', streamRecordingHandler); // public/shared viewing, same access model as above
router.post('/session', verifyFirebaseToken, recordingsRateLimiter, recordingSessionHandler);
router.post('/ingest', ingestRecordingHandler); // shared-secret auth, not Firebase -- see handler. Not
// rate-limited here: it's called by the recorder/Jibri sidecar, not a logged-in user, and its real
// call frequency under load (repeated Processing pings while a recording finalizes) hasn't been
// measured against any threshold -- throttling it without that data risks dropping a legitimate
// ingest call from the recorder.
router.patch('/:id', verifyFirebaseToken, recordingsRateLimiter, renameRecordingHandler);
router.delete('/:id', verifyFirebaseToken, recordingsRateLimiter, deleteRecordingHandler);

export default router;
