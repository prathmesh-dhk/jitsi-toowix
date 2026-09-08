import { roomAdmission, attendance } from '../meetings/admission';
import { Router } from 'express';
import { optionalAccount, verifyFirebaseToken } from '../middleware/auth';
import {
  createMeetingHandler,
  listMeetingsHandler,
  getMeetingHandler,
  updateMeetingHandler,
  cancelMeetingHandler,
  deleteMeetingHandler,
  rsvpMeetingHandler,
} from '../meetings/meetings';
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
} from '../meetings/waitingRoom';

const router = Router();

router.get('/rsvp', rsvpMeetingHandler); // public, no auth -- RSVP links from email
router.post('/rsvp', rsvpMeetingHandler); // public, no auth -- RSVP response from web app
router.get('/room/:roomSlug', optionalAccount, roomAdmission); // public, no auth -- guests need this too
router.post('/room/:roomSlug/attendance/join', attendance); // public, no auth
router.post('/room/:roomSlug/attendance/leave', attendance); // public, no auth
router.post('/room/:roomSlug/admission', optionalAccount, roomAdmission);

// Real-time WebRTC Signaling routes
router.post('/room/:roomSlug/signal', optionalAccount, postSignalHandler);
router.get('/room/:roomSlug/signal', optionalAccount, getSignalsHandler);

// Google Meet Waiting Room & Host Admission routes
router.post('/room/:roomSlug/lobby/knock', optionalAccount, knockLobbyHandler);
router.get('/room/:roomSlug/lobby/status', optionalAccount, getLobbyStatusHandler);
router.post('/room/:roomSlug/lobby/cancel', optionalAccount, cancelLobbyHandler);
router.get('/room/:roomSlug/lobby/pending', optionalAccount, listPendingLobbyHandler);
router.post('/room/:roomSlug/lobby/admit', optionalAccount, admitLobbyHandler);
router.post('/room/:roomSlug/lobby/deny', optionalAccount, denyLobbyHandler);
router.post('/room/:roomSlug/lobby/announce', optionalAccount, announceLobbyHandler);
router.post('/room/:roomSlug/end-for-everyone', optionalAccount, endMeetingForEveryoneHandler);
router.get('/room/:roomSlug/live-status', optionalAccount, getLiveMeetingStatusHandler);

router.get('/', verifyFirebaseToken, listMeetingsHandler);
router.get('/:id', verifyFirebaseToken, getMeetingHandler);
router.post('/', verifyFirebaseToken, createMeetingHandler);
router.patch('/:id', verifyFirebaseToken, updateMeetingHandler);
router.post('/:id/cancel', verifyFirebaseToken, cancelMeetingHandler);
router.delete('/:id', verifyFirebaseToken, deleteMeetingHandler);

export default router;
