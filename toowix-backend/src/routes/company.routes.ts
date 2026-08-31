import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { registerCompanyHandler } from '../companies/register';

const router = Router();

// Tue-BE-4: Company Registration (authenticated)
router.post('/register', verifyFirebaseToken, registerCompanyHandler);

export default router;
