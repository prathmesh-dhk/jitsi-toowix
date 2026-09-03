import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import {
  deleteRecordingHandler,
  ingestRecordingHandler,
  listRecordingsHandler,
  renameRecordingHandler,
} from '../recordings/recordings';

const router = Router();

router.get('/', verifyFirebaseToken, listRecordingsHandler);
router.post('/ingest', ingestRecordingHandler); // shared-secret auth, not Firebase -- see handler
router.patch('/:id', verifyFirebaseToken, renameRecordingHandler);
router.delete('/:id', verifyFirebaseToken, deleteRecordingHandler);

export default router;
