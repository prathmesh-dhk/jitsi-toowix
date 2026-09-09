import { Router } from 'express';
import { verifyFirebaseToken, verifyIdentityToken } from '../middleware/auth';
import { registerCompanyHandler } from '../companies/register';
import { getMeetingPolicyHandler, updateMeetingPolicyHandler } from '../companies/policy';

const router = Router();

// Tue-BE-4: Company Registration (authenticated)
router.post('/register', verifyIdentityToken, registerCompanyHandler);

router.get('/meeting-policy', verifyFirebaseToken, getMeetingPolicyHandler);
router.patch('/meeting-policy', verifyFirebaseToken, updateMeetingPolicyHandler);

router.get('/meeting-policy', verifyFirebaseToken, getMeetingPolicyHandler);
router.patch('/meeting-policy', verifyFirebaseToken, updateMeetingPolicyHandler);

export default router;
