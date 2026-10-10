import { Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import * as chatService from './chat.service';

// Every function here does exactly one thing: parse the HTTP request, call one chat.service.ts
// function, and send the result back out. No business logic lives in this file -- see
// chat.service.ts for the actual rules (validation, auth checks, persistence, notifications).

/**
 * POST /api/meetings/room/:roomSlug/chat
 * Best-effort persistence for one chat message (text, image, voice message, and @mentions).
 */
export async function postChatMessageHandler(req: any, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const result = await chatService.saveMessage(room, {
      firebaseUid: req.firebaseUid,
      senderName: req.body.senderName,
      senderId: req.body.senderId,
      text: req.body.text,
      imageUrl: req.body.imageUrl,
      audioUrl: req.body.audioUrl,
      audioDuration: req.body.audioDuration,
      mentions: req.body.mentions,
    });
    res.status(result.httpStatus).json(result.body);
  } catch (error: any) {
    console.error('[ChatHistory] Failed to persist chat message:', error.message);
    res.status(500).json({ error: 'Failed to save message' });
  }
}

/**
 * GET /api/meetings/room/:roomSlug/chat
 * Returns the saved conversation for a dashboard-created meeting.
 */
export async function getChatHistoryHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const result = await chatService.getHistory(room, req.firebaseUid);
    res.status(result.httpStatus).json(result.body);
  } catch (error: any) {
    console.error('[ChatHistory] Failed to fetch chat history:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
}

/**
 * POST /api/meetings/room/:roomSlug/chat/read
 * Records that the caller has read this conversation up to now.
 */
export async function markChatReadHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const result = await chatService.markRead(room, req.firebaseUid);
    res.status(result.httpStatus).json(result.body);
  } catch (error: any) {
    console.error('[ChatHistory] Failed to mark conversation read:', error.message);
    res.status(500).json({ error: 'Failed to update read receipt' });
  }
}

/**
 * POST /api/meetings/room/:roomSlug/chat/image
 * Uploads an image attachment for a meeting conversation.
 */
export async function uploadChatImageHandler(req: any, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const dataUri = typeof req.body.dataUri === 'string' ? req.body.dataUri : '';
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    const result = await chatService.uploadImage(room, dataUri, requestOrigin);
    res.status(result.httpStatus).json(result.body);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to upload image' });
  }
}

/**
 * POST /api/meetings/room/:roomSlug/chat/audio
 * Uploads a voice recording / audio note for a meeting conversation.
 */
export async function uploadChatAudioHandler(req: any, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const dataUri = typeof req.body.dataUri === 'string' ? req.body.dataUri : '';
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    const result = await chatService.uploadAudio(room, dataUri, requestOrigin);
    res.status(result.httpStatus).json(result.body);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to upload voice note' });
  }
}

/**
 * POST /api/meetings/room/:roomSlug/conversation/invite
 * Adds a member by email to this conversation and sends the E11_CONVERSATION_INVITE email.
 */
export async function inviteConversationMemberHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const result = await chatService.inviteMember(
        room, req.firebaseUid, String(req.body.email || ''), String(req.body.name || '')
    );
    res.status(result.httpStatus).json(result.body);
  } catch (error: any) {
    console.error('[ChatHistory] Failed to send conversation invite:', error.message);
    res.status(500).json({ error: error.message || 'Failed to send conversation invite' });
  }
}

/**
 * GET /api/meetings/room/:roomSlug/conversation/members
 * Returns list of members and workspace teammates for @ mentions and participant display.
 */
export async function getConversationMembersHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const result = await chatService.listMembers(room);
    res.status(result.httpStatus).json(result.body);
  } catch (error: any) {
    console.error('[ChatHistory] Failed to get conversation members:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversation members' });
  }
}
