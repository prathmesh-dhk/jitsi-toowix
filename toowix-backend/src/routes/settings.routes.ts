import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import {
  getSettingsHandler,
  updateProfileSettingsHandler,
  updateGeneralSettingsHandler,
  updateMeetingSettingsHandler,
  updateRecordingSettingsHandler,
  updateNotificationSettingsHandler,
  getStorageSettingsHandler,
  recordPasswordChangedHandler,
  deactivateAccountHandler,
  listSessionsHandler,
  revokeSessionHandler,
  revokeOtherSessionsHandler,
} from '../settings/settings';

const router = Router();

router.use(verifyFirebaseToken);

router.get('/', getSettingsHandler);
router.patch('/profile', updateProfileSettingsHandler);
router.patch('/general', updateGeneralSettingsHandler);
router.patch('/meetings', updateMeetingSettingsHandler);
router.patch('/recording', updateRecordingSettingsHandler);
router.patch('/notifications', updateNotificationSettingsHandler);
router.get('/storage', getStorageSettingsHandler);
router.post('/security/password-changed', recordPasswordChangedHandler);
router.post('/security/deactivate', deactivateAccountHandler);
router.get('/security/sessions', listSessionsHandler);
router.post('/security/sessions/:id/revoke', revokeSessionHandler);
router.post('/security/sessions/revoke-all-others', revokeOtherSessionsHandler);

export default router;
