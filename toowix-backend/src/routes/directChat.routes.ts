import { Router } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { directChatRateLimiter, directChatSearchRateLimiter } from '../middleware/rateLimit';
import {
  acceptCallHandler,
  blockHandler,
  cancelCallHandler,
  clearChatHandler,
  declineCallHandler,
  deleteChatHandler,
  muteHandler,
  startCallHandler,
  listConversationsHandler,
  getMessagesHandler,
  markReadHandler,
  openConversationHandler,
  searchUsersHandler,
  sendMessageHandler,
  streamHandler,
  unreadCountHandler,
} from '../directChat/directChat.controller';

const router = Router();

// Signed-in, active users only. The limiters are keyed by user (not IP) and must come AFTER
// verifyFirebaseToken, which is what sets req.accountUser for them to read.
router.use(verifyFirebaseToken, directChatRateLimiter);

router.get('/stream', streamHandler);
router.get('/unread-count', unreadCountHandler);
router.get('/users/search', directChatSearchRateLimiter, searchUsersHandler);
router.get('/conversations', listConversationsHandler);
router.post('/conversations', openConversationHandler);
router.get('/conversations/:id/messages', getMessagesHandler);
router.post('/conversations/:id/messages', sendMessageHandler);
router.post('/conversations/:id/read', markReadHandler);
router.post('/conversations/:id/mute', muteHandler);
router.post('/conversations/:id/clear', clearChatHandler);
router.post('/conversations/:id/block', blockHandler);
router.delete('/conversations/:id', deleteChatHandler);
router.post('/conversations/:id/calls', startCallHandler);
router.post('/calls/:id/accept', acceptCallHandler);
router.post('/calls/:id/decline', declineCallHandler);
router.post('/calls/:id/cancel', cancelCallHandler);

export default router;
