import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { deleteRecordingHandler, listRecordingsHandler, renameRecordingHandler } from '../recordings/recordings';

const router = Router();

router.get('/', verifyFirebaseToken, listRecordingsHandler);
router.patch('/:id', verifyFirebaseToken, renameRecordingHandler);
router.delete('/:id', verifyFirebaseToken, deleteRecordingHandler);

export default router;
