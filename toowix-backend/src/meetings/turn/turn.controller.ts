import { Response } from 'express';
import { generateTurnCredentials, ITurnCredentials } from '../../lib/turnCredentials';
import { isTurnConfigured } from '../../config/turn';

/**
 * GET /api/meetings/turn-credentials
 * Short-lived STUN/TURN credentials for our own standalone coturn server -- independent of the
 * Jitsi/Prosody deployment's own (currently broken) extdisco mechanism. Not room-scoped: these
 * credentials work for any call, so there is nothing participant- or meeting-specific to check
 * here. Available to guests too (same trust level as the rest of the live call's media path,
 * which already has no auth requirement of its own).
 */
export async function getTurnCredentialsHandler(_req: any, res: Response<ITurnCredentials | { error: string }>): Promise<void> {
  if (!isTurnConfigured()) {
    res.status(503).json({ error: 'TURN is not configured on this server' });
    return;
  }
  res.status(200).json(generateTurnCredentials());
}
