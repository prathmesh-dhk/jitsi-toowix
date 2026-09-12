import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import {
  deleteRecordingHandler,
  getRecordingHandler,
  ingestRecordingHandler,
  listRecordingsHandler,
  renameRecordingHandler,
  streamRecordingHandler,
} from '../recordings/recordings';

const router = Router();

router.get('/', verifyFirebaseToken, listRecordingsHandler);
router.get('/:id', getRecordingHandler); // public/shared viewing
router.get('/:id/stream', streamRecordingHandler); // public/shared viewing, same access model as above
router.post('/ingest', ingestRecordingHandler); // shared-secret auth, not Firebase -- see handler
router.patch('/:id', verifyFirebaseToken, renameRecordingHandler);
router.delete('/:id', verifyFirebaseToken, deleteRecordingHandler);

export default router;
