import crypto from 'crypto';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { Meeting } from '../models/Meeting';
import { User } from '../models/User';
import { mayManageResource } from '../middleware/ownership';
import { persistChatImage } from '../uploads/chatImageStorage';
import { persistChatAudio } from '../uploads/chatAudioStorage';
import { notifyCompany, notifyUser } from '../notifications/createNotification';
import { sendEmailAsync } from '../email/sender';
import { emailConfig } from '../config/email';

const MAX_STORED_MESSAGES = 500;
const MAX_TEXT_LENGTH = 4000;

/**
 * POST /api/meetings/room/:roomSlug/chat
 * Best-effort persistence for one chat message (text, image, voice message, and @mentions).
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
    const audioUrl = typeof req.body.audioUrl === 'string' ? req.body.audioUrl.slice(0, 2000) : null;
    const audioDuration = typeof req.body.audioDuration === 'number' ? req.body.audioDuration : null;
    const mentions = Array.isArray(req.body.mentions) ? req.body.mentions.map((m: any) => String(m).slice(0, 100)) : [];

    if (!text && !imageUrl && !audioUrl) {
      res.status(400).json({ error: 'A message needs text, an image, or a voice message' });
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      senderName,
      senderId,
      text,
      imageUrl,
      audioUrl,
      audioDuration,
      mentions,
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

    // Saved conversations are also dashboard conversations. Notify the other workspace members
    // about a new saved message and give the notification a stable deep link to that exact item.
    // The authenticated sender is excluded, so sending a message never notifies yourself.
    const senderUser = req.firebaseUid ? await User.findOne({ firebaseUid: req.firebaseUid }).select('_id') : null;
    let notifDesc = `${senderName}: ${text || (audioUrl ? `Sent a voice message (${Math.round(audioDuration || 0)}s)` : 'Sent an image')}`;
    if (mentions.length > 0) {
      notifDesc = `${senderName} mentioned ${mentions.join(', ')}: ${text || ''}`;
    }

    const notification = {
      category: 'MEETINGS' as const,
      type: 'CHAT_MESSAGE' as const,
      title: `New message in ${meeting.name}`,
      description: notifDesc.slice(0, 500),
      relatedName: meeting.name,
      actionLabel: 'View' as const,
      actionUrl: `/dashboard?tab=conversations&conversation=${meeting._id}&message=${message.id}`,
    };
    if (meeting.companyId) {
      await notifyCompany(meeting.companyId, notification, senderUser?._id);
    } else if (!senderUser || String(meeting.createdBy) !== String(senderUser._id)) {
      await notifyUser({ userId: meeting.createdBy, ...notification });
    }

    res.json({ persisted: true, id: message.id });
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

    res.json({ messages: meeting.chatMessages || [], readReceipts: meeting.chatReadReceipts || [] });
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
    const meeting = await Meeting.findOne({ roomSlug: room });

    if (!meeting || !req.firebaseUid) {
      res.json({ success: false });
      return;
    }

    const user = await User.findOne({ firebaseUid: req.firebaseUid });

    if (!user || !mayManageResource(user, meeting)) {
      res.status(403).json({ error: 'You are not authorized to view this conversation' });
      return;
    }

    const viewerId = String(user._id);
    const viewerName = user.fullName || user.email || 'Viewer';
    const now = new Date();

    const updated = await Meeting.updateOne(
      { _id: meeting._id, 'chatReadReceipts.viewerId': viewerId },
      { $set: { 'chatReadReceipts.$.lastReadAt': now } }
    );

    if (updated.matchedCount === 0) {
      await Meeting.updateOne(
        { _id: meeting._id },
        { $push: { chatReadReceipts: { viewerId, viewerName, lastReadAt: now } } }
      );
    }

    res.json({ success: true });
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

/**
 * POST /api/meetings/room/:roomSlug/chat/audio
 * Uploads a voice recording / audio note for a meeting conversation.
 */
export async function uploadChatAudioHandler(req: any, res: Response): Promise<void> {
  try {
    const room = String(req.params.roomSlug).toLowerCase();
    const meeting = await Meeting.findOne({ roomSlug: room });

    if (!meeting) {
      res.status(403).json({ error: 'Voice notes are only available in meetings created from your dashboard.' });
      return;
    }

    const dataUri = typeof req.body.dataUri === 'string' ? req.body.dataUri : '';
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    const url = await persistChatAudio(dataUri, room, requestOrigin);

    res.json({ url });
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
    const meeting = await Meeting.findOne({ roomSlug: room });

    if (!meeting) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const targetEmail = String(req.body.email || '').trim().toLowerCase();
    const memberName = String(req.body.name || '').trim();

    if (!targetEmail || !targetEmail.includes('@')) {
      res.status(400).json({ error: 'A valid email address is required' });
      return;
    }

    let inviterName = 'A team member';
    if (req.firebaseUid) {
      const caller = await User.findOne({ firebaseUid: req.firebaseUid });
      if (caller?.fullName) inviterName = caller.fullName;
      else if (caller?.email) inviterName = caller.email.split('@')[0];
    }

    // Add to meeting invitees if not already present
    const currentInvitees = meeting.invitees || [];
    if (!currentInvitees.includes(targetEmail)) {
      await Meeting.updateOne(
        { _id: meeting._id },
        {
          $addToSet: {
            invitees: targetEmail,
            ...(memberName ? {
              participants: {
                name: memberName,
                email: targetEmail,
                role: 'Participant',
              }
            } : {})
          }
        }
      );
    }

    const appUrl = emailConfig.appUrl || 'http://localhost:3000';
    const conversationUrl = `${appUrl}/meet/${encodeURIComponent(meeting.roomSlug)}?fromConversation=1`;

    // Send the conversation invitation email asynchronously
    await sendEmailAsync({
      to: targetEmail,
      templateName: 'E11_CONVERSATION_INVITE',
      subject: `${inviterName} invited you to join conversation "${meeting.name}"`,
      templateVariables: {
        inviter_name: inviterName,
        conversation_name: meeting.name,
        room_slug: meeting.roomSlug,
        conversation_url: conversationUrl,
        recipient_email: targetEmail,
      },
      metadata: {
        userId: req.firebaseUid,
        context: {
          roomSlug: meeting.roomSlug,
          meetingId: String(meeting._id),
          action: 'CONVERSATION_INVITE',
        }
      }
    });

    res.json({
      success: true,
      message: `Invitation email sent to ${targetEmail}`,
      member: {
        email: targetEmail,
        name: memberName || targetEmail.split('@')[0],
      }
    });
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
    const meeting = await Meeting.findOne({ roomSlug: room });

    if (!meeting) {
      res.json({ members: [] });
      return;
    }

    const membersMap = new Map<string, { id: string; name: string; email: string; avatarUrl?: string | null; role?: string }>();

    // 1. Organizer
    if (meeting.createdBy) {
      const creator = await User.findById(meeting.createdBy);
      if (creator) {
        membersMap.set(creator.email.toLowerCase(), {
          id: String(creator._id),
          name: creator.fullName || creator.email.split('@')[0],
          email: creator.email,
          avatarUrl: creator.avatarUrl || null,
          role: 'Organizer',
        });
      }
    }

    // 2. Explicit participants & invitees
    if (meeting.participants) {
      for (const p of meeting.participants) {
        if (p.email && !membersMap.has(p.email.toLowerCase())) {
          membersMap.set(p.email.toLowerCase(), {
            id: p.email.toLowerCase(),
            name: p.name || p.email.split('@')[0],
            email: p.email,
            avatarUrl: p.avatarUrl || null,
            role: p.role || 'Participant',
          });
        }
      }
    }

    if (meeting.invitees) {
      for (const email of meeting.invitees) {
        if (email && !membersMap.has(email.toLowerCase())) {
          membersMap.set(email.toLowerCase(), {
            id: email.toLowerCase(),
            name: email.split('@')[0],
            email: email,
            role: 'Participant',
          });
        }
      }
    }

    // 3. Message senders
    if (meeting.chatMessages) {
      for (const msg of meeting.chatMessages) {
        if (msg.senderName && !membersMap.has(msg.senderName.toLowerCase())) {
          membersMap.set(msg.senderName.toLowerCase(), {
            id: msg.senderId || msg.senderName.toLowerCase(),
            name: msg.senderName,
            email: '',
            role: 'Participant',
          });
        }
      }
    }

    // 4. If meeting belongs to a company, include company teammates for @ mentions
    if (meeting.companyId) {
      const teammates = await User.find({ companyId: meeting.companyId }).limit(50).select('fullName email avatarUrl role');
      for (const tm of teammates) {
        if (tm.email && !membersMap.has(tm.email.toLowerCase())) {
          membersMap.set(tm.email.toLowerCase(), {
            id: String(tm._id),
            name: tm.fullName || tm.email.split('@')[0],
            email: tm.email,
            avatarUrl: tm.avatarUrl || null,
            role: tm.role || 'Member',
          });
        }
      }
    }

    res.json({ members: Array.from(membersMap.values()) });
  } catch (error: any) {
    console.error('[ChatHistory] Failed to get conversation members:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversation members' });
  }
}
