import { roomAdmission, attendance } from '../meetings/admission';
import { Router } from 'express';
import { optionalAccount, verifyFirebaseToken } from '../middleware/auth';
import { meetingAccessRateLimiter } from '../middleware/rateLimit';
import {
  createMeetingHandler,
  listMeetingsHandler,
  getMeetingHandler,
  updateMeetingHandler,
  cancelMeetingHandler,
  deleteMeetingHandler,
  rsvpMeetingHandler,
  inviteToMeetingHandler,
  listConversationsHandler,
  leaveConversationHandler,
} from '../meetings/meetings';
import {
  postChatMessageHandler,
  getChatHistoryHandler,
  uploadChatImageHandler,
  uploadChatAudioHandler,
  markChatReadHandler,
  inviteConversationMemberHandler,
  getConversationMembersHandler,
} from '../meetings/chatHistory';
import {
  knockLobbyHandler,
  getLobbyStatusHandler,
  cancelLobbyHandler,
  listPendingLobbyHandler,
  admitLobbyHandler,
  denyLobbyHandler,
  announceLobbyHandler,
  endMeetingForEveryoneHandler,
  getLiveMeetingStatusHandler,
  postSignalHandler,
  getSignalsHandler,
  lockMeetingHandler,
  unlockMeetingHandler,
} from '../meetings/waitingRoom';

const router = Router();

router.get('/rsvp', meetingAccessRateLimiter, rsvpMeetingHandler); // public, no auth -- RSVP links from email
router.post('/rsvp', meetingAccessRateLimiter, rsvpMeetingHandler); // public, no auth -- RSVP response from web app
router.get('/room/:roomSlug', optionalAccount, roomAdmission); // public, no auth -- guests need this too
router.post('/room/:roomSlug/attendance/join', attendance); // public, no auth
router.post('/room/:roomSlug/attendance/leave', attendance); // public, no auth
router.post('/room/:roomSlug/admission', meetingAccessRateLimiter, optionalAccount, roomAdmission);

// Real-time WebRTC Signaling routes
router.post('/room/:roomSlug/signal', optionalAccount, postSignalHandler);
router.get('/room/:roomSlug/signal', optionalAccount, getSignalsHandler);

// Google Meet Waiting Room & Host Admission routes
router.post('/room/:roomSlug/invite', meetingAccessRateLimiter, verifyFirebaseToken, inviteToMeetingHandler);
router.post('/room/:roomSlug/lock', meetingAccessRateLimiter, optionalAccount, lockMeetingHandler);
router.post('/room/:roomSlug/unlock', meetingAccessRateLimiter, optionalAccount, unlockMeetingHandler);
router.post('/room/:roomSlug/lobby/knock', meetingAccessRateLimiter, optionalAccount, knockLobbyHandler);
router.get('/room/:roomSlug/lobby/status', optionalAccount, getLobbyStatusHandler);
router.post('/room/:roomSlug/lobby/cancel', optionalAccount, cancelLobbyHandler);
router.get('/room/:roomSlug/lobby/pending', optionalAccount, listPendingLobbyHandler);
router.post('/room/:roomSlug/lobby/admit', optionalAccount, admitLobbyHandler);
router.post('/room/:roomSlug/lobby/deny', optionalAccount, denyLobbyHandler);
router.post('/room/:roomSlug/lobby/announce', optionalAccount, announceLobbyHandler);
router.post('/room/:roomSlug/end-for-everyone', optionalAccount, endMeetingForEveryoneHandler);
router.get('/room/:roomSlug/live-status', optionalAccount, getLiveMeetingStatusHandler);

// Chat persistence & attachments
router.post('/room/:roomSlug/chat', optionalAccount, postChatMessageHandler);
router.get('/room/:roomSlug/chat', verifyFirebaseToken, getChatHistoryHandler);
router.post('/room/:roomSlug/chat/image', optionalAccount, uploadChatImageHandler);
router.post('/room/:roomSlug/chat/audio', optionalAccount, uploadChatAudioHandler);
router.post('/room/:roomSlug/chat/read', verifyFirebaseToken, markChatReadHandler);
router.post('/room/:roomSlug/conversation/invite', optionalAccount, inviteConversationMemberHandler);
router.get('/room/:roomSlug/conversation/members', optionalAccount, getConversationMembersHandler);

// Must come before '/:id' below, or "conversations" would be matched as an :id.
router.get('/conversations', verifyFirebaseToken, listConversationsHandler);
router.post('/:id/conversation/leave', verifyFirebaseToken, leaveConversationHandler);

router.get('/', verifyFirebaseToken, listMeetingsHandler);
router.get('/:id', verifyFirebaseToken, getMeetingHandler);
router.post('/', verifyFirebaseToken, createMeetingHandler);
router.patch('/:id', verifyFirebaseToken, updateMeetingHandler);
router.post('/:id/cancel', verifyFirebaseToken, cancelMeetingHandler);
router.delete('/:id', verifyFirebaseToken, deleteMeetingHandler);

export default router;
