import { Router } from 'express';
import { verifyFirebaseToken, verifyIdentityToken } from '../middleware/auth';
import { registerCompanyHandler } from '../companies/register';
import { getMeetingPolicyHandler, updateMeetingPolicyHandler } from '../companies/policy';
import {
  listCompaniesForAdminHandler,
  approveCompanyHandler,
  rejectCompanyHandler,
  suspendCompanyHandler,
  reactivateCompanyHandler,
} from '../companies/admin';

const router = Router();

// Tue-BE-4: Company Registration (authenticated)
router.post('/register', verifyIdentityToken, registerCompanyHandler);

router.get('/meeting-policy', verifyFirebaseToken, getMeetingPolicyHandler);
router.patch('/meeting-policy', verifyFirebaseToken, updateMeetingPolicyHandler);

// Super Admin company lifecycle -- each handler independently checks role === 'SUPER_ADMIN'
router.get('/admin', verifyFirebaseToken, listCompaniesForAdminHandler);
router.post('/admin/:id/approve', verifyFirebaseToken, approveCompanyHandler);
router.post('/admin/:id/reject', verifyFirebaseToken, rejectCompanyHandler);
router.post('/admin/:id/suspend', verifyFirebaseToken, suspendCompanyHandler);
router.post('/admin/:id/reactivate', verifyFirebaseToken, reactivateCompanyHandler);

export default router;
