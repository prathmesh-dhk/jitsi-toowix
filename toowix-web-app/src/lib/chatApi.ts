import { auth } from './firebase';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const MAX_CHAT_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_CHAT_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_FILE_BYTES = 5 * 1024 * 1024;

// Resolves a generic file attachment's URL the same way resolveChatImageUrl/resolveChatAudioUrl
// do (an older backend origin/host, a relative /api/uploads/... path, or an already-absolute
// URL) -- kept as its own function rather than reusing resolveChatImageUrl so a future change
// specific to one attachment type doesn't silently affect the others.
export function resolveChatFileUrl(fileUrl: string): string {
  if (!fileUrl) return '';
  if (fileUrl.startsWith('blob:') || fileUrl.startsWith('data:')) {
    return fileUrl;
  }
  if (fileUrl.includes('/api/uploads/')) {
    const uploadPath = fileUrl.substring(fileUrl.indexOf('/api/uploads/'));
    const backendRoot = BACKEND_URL ? BACKEND_URL.replace(/\/$/, '') : '';
    return `${backendRoot}${uploadPath}`;
  }
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    return fileUrl;
  }
  const backendRoot = BACKEND_URL ? BACKEND_URL.replace(/\/$/, '') : '';
  const cleanPath = fileUrl.startsWith('/') ? fileUrl : `/${fileUrl}`;
  return `${backendRoot}${cleanPath}`;
}

export function resolveChatImageUrl(imageUrl: string): string {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('blob:') || imageUrl.startsWith('data:')) {
    return imageUrl;
  }
  // If stored with an older backend origin or host (e.g., http://localhost:4000/api/uploads/...)
  if (imageUrl.includes('/api/uploads/')) {
    const uploadPath = imageUrl.substring(imageUrl.indexOf('/api/uploads/'));
    const backendRoot = BACKEND_URL ? BACKEND_URL.replace(/\/$/, '') : '';
    return `${backendRoot}${uploadPath}`;
  }
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  const backendRoot = BACKEND_URL ? BACKEND_URL.replace(/\/$/, '') : '';
  const cleanPath = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
  return `${backendRoot}${cleanPath}`;
}

export function resolveChatAudioUrl(audioUrl: string): string {
  if (!audioUrl) return '';
  if (audioUrl.startsWith('blob:') || audioUrl.startsWith('data:')) {
    return audioUrl;
  }
  if (audioUrl.includes('/api/uploads/')) {
    const uploadPath = audioUrl.substring(audioUrl.indexOf('/api/uploads/'));
    const backendRoot = BACKEND_URL ? BACKEND_URL.replace(/\/$/, '') : '';
    return `${backendRoot}${uploadPath}`;
  }
  if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
    return audioUrl;
  }
  const backendRoot = BACKEND_URL ? BACKEND_URL.replace(/\/$/, '') : '';
  const cleanPath = audioUrl.startsWith('/') ? audioUrl : `/${audioUrl}`;
  return `${backendRoot}${cleanPath}`;
}

/**
 * Best-effort persistence for one chat message (text, image, audio, mentions)
 */
export async function persistChatMessage(
  roomId: string,
  message: {
    senderName: string;
    senderId?: string | null;
    text?: string | null;
    imageUrl?: string | null;
    audioUrl?: string | null;
    audioDuration?: number | null;
    fileUrl?: string | null;
    fileName?: string | null;
    fileSize?: number | null;
    fileType?: string | null;
    mentions?: string[];
    // The SAME id used for the live real-time broadcast (see ChatPanel.tsx) -- so a later edit,
    // which only ever travels with this id, can find this exact persisted copy too.
    clientMessageId?: string;
  }
): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(message),
    });
  } catch {
    // best-effort
  }
}

/**
 * Edits the text of one already-sent message (sender-only, same live session that sent it).
 * Best-effort, same pattern as persistChatMessage -- the live edit broadcast (postRoomSignal) is
 * the source of truth for everyone currently in the call; this only affects what a reload or a
 * later viewer of saved history sees.
 */
export async function editChatMessage(roomId: string, messageId: string, senderId: string, text: string): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/chat/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ senderId, text }),
    });
  } catch {
    // best-effort
  }
}

function readFileAsDataUri(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads a chat image attachment (JPG/PNG/GIF/WEBP, max 3MB) and returns its fetchable URL.
 */
export async function uploadChatImage(roomId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files (JPG, PNG, GIF, WEBP) can be attached.');
  }
  if (file.size > MAX_CHAT_IMAGE_BYTES) {
    throw new Error('Image is too large -- the limit is 3MB.');
  }

  const dataUri = await readFileAsDataUri(file);
  const response = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/chat/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ dataUri }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Failed to upload image');
  }

  return data.url as string;
}

/**
 * Uploads a voice note audio recording and returns its fetchable URL.
 */
export async function uploadChatAudio(roomId: string, audioBlob: Blob): Promise<string> {
  if (audioBlob.size > MAX_CHAT_AUDIO_BYTES) {
    throw new Error('Voice note is too large (max 10MB).');
  }

  const dataUri = await readFileAsDataUri(audioBlob);
  const response = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/chat/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ dataUri }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Failed to upload voice message');
  }

  return data.url as string;
}

/**
 * Uploads a generic file attachment (ZIP, PDF, DOCX, video, or any other type, up to 5MB) and
 * returns its fetchable URL plus the metadata needed to render a download card in chat.
 */
export async function uploadChatFile(
  roomId: string,
  file: File
): Promise<{ url: string; fileName: string; fileSize: number; fileType: string }> {
  if (file.size > MAX_CHAT_FILE_BYTES) {
    throw new Error('File is too large -- the limit is 5MB.');
  }

  const dataUri = await readFileAsDataUri(file);
  const response = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}/chat/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ dataUri, fileName: file.name }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Failed to upload file');
  }

  return data;
}

/**
 * Invites a member by email to a conversation, sending the E11_CONVERSATION_INVITE email.
 */
export async function inviteConversationMember(
  roomSlug: string,
  email: string,
  name?: string
): Promise<{ success: boolean; message: string; member?: any }> {
  const response = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomSlug)}/conversation/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ email, name }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Failed to send conversation invite');
  }

  return data;
}

/**
 * Switches a conversation's underlying meeting between Public (Guest, anyone with the link) and
 * Private (password required to join). Same rule the backend enforces on creation: a password is
 * required to switch to (or stay) Private; switching to Public clears any existing password.
 */
export async function updateMeetingPrivacy(meetingId: string, type: 'Guest' | 'Private', passcode?: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/meetings/${encodeURIComponent(meetingId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ type, passcode: type === 'Private' ? passcode : null }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Failed to update meeting privacy');
  }
}

/**
 * Fetches members and workspace participants for a conversation (for @ mentions & member list).
 */
export async function fetchRoomConversationMembers(roomSlug: string): Promise<IConversationMember[]> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomSlug)}/conversation/members`, {
      headers: await authHeaders(),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.members || [];
  } catch {
    return [];
  }
}

export interface IConversationSummary {
  id: string;
  name: string;
  roomSlug: string;
  type: string;
  messageCount: number;
  unreadCount: number;
  lastMessageAt: string;
  participantCount: number;
  status: 'Upcoming' | 'Live' | 'Ended';
  joinable: boolean;
  sharedFiles?: Array<{ name: string; url: string; size?: string; sharedBy?: string; sharedAt?: string }>;
}

export interface IConversationMember {
  id?: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  role?: 'Organizer' | 'Co-host' | 'Participant' | 'Member';
}

export interface ISavedChatMessage {
  id: string;
  senderName: string;
  senderId?: string | null;
  text?: string | null;
  imageUrl?: string | null;
  audioUrl?: string | null;
  audioDuration?: number | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  fileType?: string | null;
  mentions?: string[];
  createdAt: string;
  edited?: boolean;
  editedAt?: string | null;
}

export interface IChatReadReceipt {
  viewerId: string;
  viewerName: string;
  lastReadAt: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  await auth.authStateReady();
  if (!auth.currentUser) return {};
  return {
    Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
    'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
  };
}

export async function fetchConversations(): Promise<IConversationSummary[]> {
  const response = await fetch(`${BACKEND_URL}/api/meetings/conversations`, {
    headers: await authHeaders(),
  });
  if (!response.ok) throw new Error('Failed to load conversations');
  const data = await response.json();
  return data.conversations || [];
}

export async function fetchChatHistory(roomSlug: string): Promise<{ messages: ISavedChatMessage[]; readReceipts: IChatReadReceipt[] }> {
  const response = await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomSlug)}/chat`, {
    headers: await authHeaders(),
  });
  if (!response.ok) throw new Error('Failed to load this conversation');
  const data = await response.json();
  return { messages: data.messages || [], readReceipts: data.readReceipts || [] };
}

export async function fetchConversationMembers(meetingId: string): Promise<IConversationMember[]> {
  const response = await fetch(`${BACKEND_URL}/api/meetings/${encodeURIComponent(meetingId)}`, {
    headers: await authHeaders(),
  });
  if (!response.ok) throw new Error('Failed to load conversation members');
  const data = await response.json();
  const meeting = data?.meeting || {};
  const members: IConversationMember[] = [...(meeting.participants || [])];
  const knownEmails = new Set(members.map((member) => String(member.email || '').toLowerCase()).filter(Boolean));
  const add = (email: string, name?: string, role: IConversationMember['role'] = 'Participant') => {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || knownEmails.has(cleanEmail)) return;
    knownEmails.add(cleanEmail);
    members.push({ email: cleanEmail, name: name || cleanEmail.split('@')[0], role });
  };
  add(meeting.createdBy?.email, meeting.createdBy?.fullName, 'Organizer');
  (meeting.invitees || []).forEach((email: string) => add(email));
  return members;
}

export async function leaveConversation(meetingId: string, nextAdminEmail: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/meetings/${encodeURIComponent(meetingId)}/conversation/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ nextAdminEmail }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Could not hand over this conversation');
}

export async function markChatRead(roomSlug: string): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomSlug)}/chat/read`, {
      method: 'POST',
      headers: await authHeaders(),
    });
  } catch {
    // best-effort
  }
}
