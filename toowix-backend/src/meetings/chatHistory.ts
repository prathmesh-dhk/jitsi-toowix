import crypto from 'crypto';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { Meeting } from '../models/Meeting';
import { User } from '../models/User';
import { mayManageResource } from '../middleware/ownership';
import { persistChatImage } from '../uploads/chatImageStorage';

const MAX_STORED_MESSAGES = 500;
const MAX_TEXT_LENGTH = 4000;

/**
 * POST /api/meetings/room/:roomSlug/chat
 * Best-effort persistence for one chat message. Only meetings that exist as a Meeting document
 * (created from the dashboard -- instant or scheduled) get a saved conversation; an ad-hoc room
 * joined straight from the public homepage has no Meeting document, so this silently no-ops
 * instead of erroring, and that meeting's chat is never written anywhere.
 */
export async function postChatMessageHandler(req: any, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const meeting = await Meeting.findOne({ roomSlug: room });

    if (!meeting) {
      res.json({ persisted: false });
      return;
    }

    const senderName = String(req.body.senderName || 'Guest').slice(0, 100);
    const senderId = typeof req.body.senderId === 'string' ? req.body.senderId.slice(0, 120) : null;
    const text = typeof req.body.text === 'string' ? req.body.text.slice(0, MAX_TEXT_LENGTH) : null;
    const imageUrl = typeof req.body.imageUrl === 'string' ? req.body.imageUrl.slice(0, 2000) : null;

    if (!text && !imageUrl) {
      res.status(400).json({ error: 'A message needs text or an image' });
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      senderName,
      senderId,
      text,
      imageUrl,
      createdAt: new Date(),
    };

    // $slice caps the array server-side so a very long meeting can't grow this document without
    // bound -- keeps only the most recent MAX_STORED_MESSAGES messages.
    await Meeting.updateOne(
      { _id: meeting._id },
      {
        $push: {
          chatMessages: { $each: [ message ], $slice: -MAX_STORED_MESSAGES },
          ...(imageUrl ? { sharedFiles: { $each: [ {
            name: `${senderName}-image-${Date.now()}`,
            url: imageUrl,
            size: '',
            sharedBy: senderName,
            sharedAt: message.createdAt.toISOString(),
          } ] } } : {}),
        },
      }
    );

    res.json({ persisted: true, id: message.id });
  } catch (error: any) {
    console.error('[ChatHistory] Failed to persist chat message:', error.message);
    res.status(500).json({ error: 'Failed to save message' });
  }
}

/**
 * GET /api/meetings/room/:roomSlug/chat
 * Returns the saved conversation for a dashboard-created meeting -- only to the meeting's
 * creator or a company admin of the same tenant, same rule as the other meeting-management
 * endpoints (requireHost in waitingRoom.ts).
 */
export async function getChatHistoryHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const meeting = await Meeting.findOne({ roomSlug: room });

    if (!meeting) {
      res.json({ messages: [] });
      return;
    }

    if (!req.firebaseUid) {
      res.status(403).json({ error: 'Sign in to view this conversation' });
      return;
    }

    const user = await User.findOne({ firebaseUid: req.firebaseUid });

    if (!user || !mayManageResource(user, meeting)) {
      res.status(403).json({ error: 'You are not authorized to view this conversation' });
      return;
    }

    res.json({ messages: meeting.chatMessages || [] });
  } catch (error: any) {
    console.error('[ChatHistory] Failed to fetch chat history:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
}

/**
 * POST /api/meetings/room/:roomSlug/chat/image
 * Image attachments are only offered for dashboard-created meetings (instant or scheduled) --
 * an ad-hoc homepage room has nowhere to persist the file and no saved conversation to attach it
 * to, so uploads for those are rejected rather than silently accepted and immediately orphaned.
 */
export async function uploadChatImageHandler(req: any, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const meeting = await Meeting.findOne({ roomSlug: room });

    if (!meeting) {
      res.status(403).json({ error: 'Image sharing is only available in meetings created from your dashboard.' });
      return;
    }

    const dataUri = typeof req.body.dataUri === 'string' ? req.body.dataUri : '';
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    const url = await persistChatImage(dataUri, room, requestOrigin);

    res.json({ url });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to upload image' });
  }
}
