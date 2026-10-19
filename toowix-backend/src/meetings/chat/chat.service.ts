import crypto from 'crypto';
import { Meeting } from '../../models/Meeting';
import { User } from '../../models/User';
import { mayManageResource } from '../../middleware/ownership';
import { persistChatImage } from '../../uploads/chatImageStorage';
import { persistChatAudio } from '../../uploads/chatAudioStorage';
import { persistChatFile } from '../../uploads/chatFileStorage';
import { notifyCompany, notifyUser } from '../../notifications/notification.service';
import { sendEmailAsync } from '../../email/sender';
import { emailConfig } from '../../config/email';
import { buildMeetingPath } from '../../lib/meetingPath';

// All business rules for a meeting's saved conversation (chat messages, read receipts, image/
// audio attachments, membership) live here as plain functions -- no `req`/`res` anywhere in this
// file. chat.controller.ts parses HTTP in, calls one of these, and sends the result back out.

export interface IServiceResult<T = any> {
  body: T;
  httpStatus: number;
}

const MAX_STORED_MESSAGES = 500;
const MAX_TEXT_LENGTH = 4000;

// ---- Messages ----

interface ISaveMessageParams {
  audioDuration?: number;
  audioUrl?: string;
  firebaseUid?: string;
  imageUrl?: string;
  mentions?: unknown[];
  senderId?: string;
  senderName?: string;
  text?: string;
  // Generated client-side at send time (see ChatPanel.tsx) so the SAME id is used for the live
  // real-time broadcast (postRoomSignal) and this persisted copy -- needed so a later edit
  // (editMessage below), which only ever travels with that client-generated id, can find the
  // right message here too. Falls back to a server-generated id for an older client that
  // predates this (or never sends one), which simply can't be edited later.
  clientMessageId?: string;
  // Generic file attachment (ZIP, PDF, DOCX, video, or any other type -- see chatFileStorage.ts;
  // DISTINCT from imageUrl/audioUrl, which keep their own existing dedicated inline-preview
  // paths). fileUrl alone (set by uploadFile below, same pattern uploadImage/uploadAudio use) is
  // what the chat UI renders as a download card.
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
}

/** Best-effort persistence for one chat message (text, image, voice message, and @mentions). */
export async function saveMessage(room: string, params: ISaveMessageParams): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });

  if (!meeting) {
    return { body: { persisted: false }, httpStatus: 200 };
  }

  const senderName = String(params.senderName || 'Guest').slice(0, 100);
  const senderId = typeof params.senderId === 'string' ? params.senderId.slice(0, 120) : null;
  const text = typeof params.text === 'string' ? params.text.slice(0, MAX_TEXT_LENGTH) : null;
  const imageUrl = typeof params.imageUrl === 'string' ? params.imageUrl.slice(0, 2000) : null;
  const audioUrl = typeof params.audioUrl === 'string' ? params.audioUrl.slice(0, 2000) : null;
  const audioDuration = typeof params.audioDuration === 'number' ? params.audioDuration : null;
  const fileUrl = typeof params.fileUrl === 'string' ? params.fileUrl.slice(0, 2000) : null;
  const fileName = typeof params.fileName === 'string' ? params.fileName.slice(0, 200) : null;
  const fileSize = typeof params.fileSize === 'number' ? params.fileSize : null;
  const fileType = typeof params.fileType === 'string' ? params.fileType.slice(0, 120) : null;
  const mentions = Array.isArray(params.mentions) ? params.mentions.map((m: any) => String(m).slice(0, 100)) : [];

  if (!text && !imageUrl && !audioUrl && !fileUrl) {
    return { body: { error: 'A message needs text, an image, a voice message, or a file' }, httpStatus: 400 };
  }

  const clientMessageId = typeof params.clientMessageId === 'string' ? params.clientMessageId.slice(0, 160) : '';
  const message = {
    id: clientMessageId || crypto.randomUUID(),
    senderName,
    senderId,
    text,
    imageUrl,
    audioUrl,
    audioDuration,
    fileUrl,
    fileName,
    fileSize,
    fileType,
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
        ...(fileUrl ? { sharedFiles: { $each: [ {
          name: fileName || `${senderName}-file-${Date.now()}`,
          url: fileUrl,
          size: fileSize ? `${Math.ceil(fileSize / 1024)} KB` : '',
          sharedBy: senderName,
          sharedAt: message.createdAt.toISOString(),
        } ] } } : {}),
      },
    }
  );

  // Saved conversations are also dashboard conversations. Notify the other workspace members
  // about a new saved message and give the notification a stable deep link to that exact item.
  // The authenticated sender is excluded, so sending a message never notifies yourself.
  const senderUser = params.firebaseUid ? await User.findOne({ firebaseUid: params.firebaseUid }).select('_id') : null;
  let notifDesc = `${senderName}: ${text || (audioUrl ? `Sent a voice message (${Math.round(audioDuration || 0)}s)` : fileUrl ? `Sent a file (${fileName || 'attachment'})` : 'Sent an image')}`;
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

  return { body: { persisted: true, id: message.id }, httpStatus: 200 };
}

interface IEditMessageParams {
  senderId?: string;
  text: string;
}

/**
 * Edits the text of one already-sent message. Best-effort, same as saveMessage -- a meeting with
 * no persisted Meeting document (the homepage's free instant meeting) has no history to edit
 * here at all, so this is a silent no-op for it; the LIVE edit still broadcasts fine via the
 * real-time signal, this only affects what a reload or a later viewer of saved history sees.
 * Ownership is checked by senderId (the sender's live session id, same guard the live chat's own
 * "is this my own message" check already uses) rather than an account -- a guest with no account
 * can send a message and must be able to edit it too. This means editing is only possible from
 * the SAME session that sent it (reloading starts a new session id), which matches how this
 * feature is actually used -- fixing a typo moments after sending, not a long-lived edit history.
 */
export async function editMessage(room: string, messageId: string, params: IEditMessageParams): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });

  if (!meeting) {
    return { body: { edited: false }, httpStatus: 200 };
  }

  const text = String(params.text || '').slice(0, MAX_TEXT_LENGTH);

  if (!text.trim()) {
    return { body: { error: 'Message text cannot be empty' }, httpStatus: 400 };
  }

  const existing = (meeting.chatMessages || []).find((m) => m.id === messageId);

  if (!existing) {
    return { body: { error: 'Message not found' }, httpStatus: 404 };
  }
  if (!params.senderId || existing.senderId !== params.senderId) {
    return { body: { error: 'You can only edit your own messages' }, httpStatus: 403 };
  }

  const editedAt = new Date();

  await Meeting.updateOne(
    { _id: meeting._id, 'chatMessages.id': messageId },
    { $set: { 'chatMessages.$.text': text, 'chatMessages.$.edited': true, 'chatMessages.$.editedAt': editedAt } }
  );

  return { body: { edited: true, editedAt: editedAt.toISOString() }, httpStatus: 200 };
}

/** Returns the saved conversation for a dashboard-created meeting. */
export async function getHistory(room: string, firebaseUid: string | undefined): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });

  if (!meeting) {
    return { body: { messages: [] }, httpStatus: 200 };
  }

  if (!firebaseUid) {
    return { body: { error: 'Sign in to view this conversation' }, httpStatus: 403 };
  }

  const user = await User.findOne({ firebaseUid });

  if (!user || !mayManageResource(user, meeting)) {
    return { body: { error: 'You are not authorized to view this conversation' }, httpStatus: 403 };
  }

  return { body: { messages: meeting.chatMessages || [], readReceipts: meeting.chatReadReceipts || [] }, httpStatus: 200 };
}

/** Records that the caller has read this conversation up to now. */
export async function markRead(room: string, firebaseUid: string | undefined): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });

  if (!meeting || !firebaseUid) {
    return { body: { success: false }, httpStatus: 200 };
  }

  const user = await User.findOne({ firebaseUid });

  if (!user || !mayManageResource(user, meeting)) {
    return { body: { error: 'You are not authorized to view this conversation' }, httpStatus: 403 };
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

  return { body: { success: true }, httpStatus: 200 };
}

// ---- Attachments ----

/** Uploads an image attachment for a meeting conversation. */
export async function uploadImage(room: string, dataUri: string, requestOrigin: string): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });

  if (!meeting) {
    return { body: { error: 'Image sharing is only available in meetings created from your dashboard.' }, httpStatus: 403 };
  }

  try {
    const url = await persistChatImage(dataUri, room, requestOrigin);
    return { body: { url }, httpStatus: 200 };
  } catch (error: any) {
    return { body: { error: error.message || 'Failed to upload image' }, httpStatus: 400 };
  }
}

/** Uploads a voice recording / audio note for a meeting conversation. */
export async function uploadAudio(room: string, dataUri: string, requestOrigin: string): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });

  if (!meeting) {
    return { body: { error: 'Voice notes are only available in meetings created from your dashboard.' }, httpStatus: 403 };
  }

  try {
    const url = await persistChatAudio(dataUri, room, requestOrigin);
    return { body: { url }, httpStatus: 200 };
  } catch (error: any) {
    return { body: { error: error.message || 'Failed to upload voice note' }, httpStatus: 400 };
  }
}

/**
 * Uploads a generic file attachment (ZIP, PDF, DOCX, video, or any other type, up to 5MB) for a
 * meeting conversation. Distinct from uploadImage/uploadAudio -- those keep their own existing
 * dedicated inline-preview paths; this is for everything else, rendered as a download card.
 */
export async function uploadFile(room: string, dataUri: string, fileName: string): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });

  if (!meeting) {
    return { body: { error: 'File sharing is only available in meetings created from your dashboard.' }, httpStatus: 403 };
  }

  try {
    const file = await persistChatFile(dataUri, fileName, room);
    return { body: file, httpStatus: 200 };
  } catch (error: any) {
    return { body: { error: error.message || 'Failed to upload file' }, httpStatus: 400 };
  }
}

// ---- Membership ----

/** Adds a member by email to this conversation and sends the E11_CONVERSATION_INVITE email. */
export async function inviteMember(room: string, firebaseUid: string | undefined, email: string, name: string): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });

  if (!meeting) {
    return { body: { error: 'Conversation not found' }, httpStatus: 404 };
  }

  const targetEmail = email.trim().toLowerCase();
  const memberName = name.trim();

  if (!targetEmail || !targetEmail.includes('@')) {
    return { body: { error: 'A valid email address is required' }, httpStatus: 400 };
  }

  let inviterName = 'A team member';
  if (firebaseUid) {
    const caller = await User.findOne({ firebaseUid });
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
  const conversationUrl = `${appUrl}${buildMeetingPath(meeting.roomSlug)}?fromConversation=1`;

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
      userId: firebaseUid,
      context: {
        roomSlug: meeting.roomSlug,
        meetingId: String(meeting._id),
        action: 'CONVERSATION_INVITE',
      }
    }
  });

  return {
    body: {
      success: true,
      message: `Invitation email sent to ${targetEmail}`,
      member: { email: targetEmail, name: memberName || targetEmail.split('@')[0] },
    },
    httpStatus: 200,
  };
}

/** Returns list of members and workspace teammates for @ mentions and participant display. */
export async function listMembers(room: string): Promise<IServiceResult> {
  const meeting = await Meeting.findOne({ roomSlug: room });

  if (!meeting) {
    return { body: { members: [] }, httpStatus: 200 };
  }

  const membersMap = new Map<string, { avatarUrl?: string | null; email: string; id: string; name: string; role?: string }>();

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

  return { body: { members: Array.from(membersMap.values()) }, httpStatus: 200 };
}
