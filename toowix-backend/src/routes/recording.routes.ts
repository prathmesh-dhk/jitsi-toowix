import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import {
  deleteRecordingHandler,
  getRecordingHandler,
  ingestRecordingHandler,
  listRecordingsHandler,
  renameRecordingHandler,
} from '../recordings/recordings';

const router = Router();

router.get('/', verifyFirebaseToken, listRecordingsHandler);
router.get('/:id', getRecordingHandler); // public/shared viewing
router.post('/ingest', ingestRecordingHandler); // shared-secret auth, not Firebase -- see handler
router.patch('/:id', verifyFirebaseToken, renameRecordingHandler);
router.delete('/:id', verifyFirebaseToken, deleteRecordingHandler);

export default router;
