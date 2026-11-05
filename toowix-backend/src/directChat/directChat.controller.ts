import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import * as directChatService from './directChat.service';
import * as directChatCalls from './directChat.calls';
import { configureSseResponse, subscribeDirectChat, writeDirectChatEvent } from './directChat.realtime';

// Every function here does one thing: read the already-authenticated user's id (set by
// verifyFirebaseToken, never taken from the request body), call one directChat.service.ts
// function, and send its result back. No business logic lives in this file.
const actorOf = (req: AuthenticatedRequest): string => {
  const id = req.accountUser?.id;

  return typeof id === 'string' ? id : '';
};

const unauthorized = (res: Response): void => {
  res.status(401).json({ error: 'Please sign in again.', code: 'UNAUTHENTICATED' });
};

const send = (res: Response, result: directChatService.IServiceResult): void => {
  // Chat responses are personal and change constantly -- never let a proxy or browser cache them.
  res.set('Cache-Control', 'no-store');
  res.status(result.httpStatus).json(result.body);
};

/** GET /api/direct-chat/users/search?q= */
export const searchUsersHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const actorId = actorOf(req);

  if (!actorId) return unauthorized(res);
  send(res, await directChatService.searchUsers(actorId, req.query.q));
};

/** POST /api/direct-chat/conversations   { userId } */
export const openConversationHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const actorId = actorOf(req);

  if (!actorId) return unauthorized(res);
  send(res, await directChatService.openConversation(actorId, req.body?.userId));
};

/** GET /api/direct-chat/conversations */
export const listConversationsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const actorId = actorOf(req);

  if (!actorId) return unauthorized(res);
  send(res, await directChatService.listConversations(actorId));
};

/** GET /api/direct-chat/conversations/:id/messages?before=&limit= */
export const getMessagesHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const actorId = actorOf(req);

  if (!actorId) return unauthorized(res);
  send(res, await directChatService.getMessages(actorId, String(req.params.id), req.query.before, req.query.limit));
};

/** POST /api/direct-chat/conversations/:id/messages   { text, clientId? } */
export const sendMessageHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const actorId = actorOf(req);

  if (!actorId) return unauthorized(res);
  send(res, await directChatService.sendMessage(actorId, String(req.params.id), req.body?.text, req.body?.clientId));
};

/** POST /api/direct-chat/conversations/:id/read */
export const markReadHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const actorId = actorOf(req);

  if (!actorId) return unauthorized(res);
  send(res, await directChatService.markConversationRead(actorId, String(req.params.id)));
};

type Runner = (actorId: string, req: AuthenticatedRequest) => Promise<directChatService.IServiceResult>;

const handler = (run: Runner) => async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const actorId = actorOf(req);

  if (!actorId) return unauthorized(res);
  send(res, await run(actorId, req));
};

const idOf = (req: AuthenticatedRequest): string => String(req.params.id);

/** POST /api/direct-chat/conversations/:id/mute   { duration: '8h' | '1w' | 'always' | 'off' } */
export const muteHandler = handler((actor, req) => directChatService.setMute(actor, idOf(req), req.body?.duration));
/** POST /api/direct-chat/conversations/:id/clear */
export const clearChatHandler = handler((actor, req) => directChatService.clearChat(actor, idOf(req)));
/** DELETE /api/direct-chat/conversations/:id */
export const deleteChatHandler = handler((actor, req) => directChatService.deleteChat(actor, idOf(req)));
/** POST /api/direct-chat/conversations/:id/block   { blocked: boolean } */
export const blockHandler = handler((actor, req) => directChatService.setBlocked(actor, idOf(req), req.body?.blocked));
/** POST /api/direct-chat/conversations/:id/calls   { mode: 'voice' | 'video' } */
export const startCallHandler = handler((actor, req) => directChatCalls.startCall(actor, idOf(req), req.body?.mode));
/** POST /api/direct-chat/calls/:id/accept */
export const acceptCallHandler = handler((actor, req) => directChatCalls.acceptCall(actor, idOf(req)));
/** POST /api/direct-chat/calls/:id/decline */
export const declineCallHandler = handler((actor, req) => directChatCalls.declineCall(actor, idOf(req)));
/** POST /api/direct-chat/calls/:id/cancel */
export const cancelCallHandler = handler((actor, req) => directChatCalls.cancelCall(actor, idOf(req)));

/** GET /api/direct-chat/unread-count */
export const unreadCountHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const actorId = actorOf(req);

  if (!actorId) return unauthorized(res);
  try {
    send(res, { body: { totalUnread: await directChatService.getTotalUnread(actorId) }, httpStatus: 200 });
  } catch {
    send(res, { body: { error: 'Could not load unread messages.', code: 'UNREAD_FAILED' }, httpStatus: 500 });
  }
};

/** GET /api/direct-chat/stream -- Server-Sent Events: new messages, receipts and unread counts, live. */
export const streamHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const actorId = actorOf(req);

  if (!actorId) return unauthorized(res);

  configureSseResponse(res);
  const unsubscribe = subscribeDirectChat(actorId, res);

  req.on('close', unsubscribe);
  res.on('close', unsubscribe);

  try {
    writeDirectChatEvent(res, { type: 'ready', totalUnread: await directChatService.getTotalUnread(actorId) });
  } catch {
    // The socket closed while we were counting: nothing to tell it, and unsubscribe already ran.
  }
  void directChatService.markPendingDelivered(actorId);
};
