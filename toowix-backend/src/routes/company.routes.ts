import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { registerCompanyHandler } from '../companies/register';
import { getMeetingPolicyHandler, updateMeetingPolicyHandler } from '../companies/policy';

const router = Router();

// Tue-BE-4: Company Registration (authenticated)
router.post('/register', verifyFirebaseToken, registerCompanyHandler);

router.get('/meeting-policy', verifyFirebaseToken, getMeetingPolicyHandler);
router.patch('/meeting-policy', verifyFirebaseToken, updateMeetingPolicyHandler);

export default router;
