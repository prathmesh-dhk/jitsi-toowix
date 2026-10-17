import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from '../../middleware/auth';
import { Meeting } from '../../models/Meeting';
import { User } from '../../models/User';
import { Company } from '../../models/Company';
import { mayJoin } from '../lobby/lobby.service';

/**
 * Issues a credential intended solely for the monitoring ingest service. The ingest service must
 * verify this signature, audience and the meetingId/participantId claims before accepting stats.
 */
export async function createTelemetrySessionHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const secret = process.env.MONITORING_TELEMETRY_JWT_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'Monitoring telemetry is not configured' });
    return;
  }

  const roomSlug = String(req.params.roomSlug || '').toLowerCase();
  const user = await User.findOne({ firebaseUid: req.firebaseUid });
  const meeting = await Meeting.findOne({ roomSlug });
  const company = meeting?.companyId ? await Company.findById(meeting.companyId) : null;
  if (!user || !meeting || !mayJoin(meeting, user, company) || meeting.cancelledAt || meeting.endedAt) {
    res.status(403).json({ error: 'You cannot publish monitoring telemetry for this meeting' });
    return;
  }

  const participantId = String(user._id);
  const token = jwt.sign(
    { meetingId: roomSlug, participantId, displayName: user.fullName, purpose: 'monitoring-telemetry' },
    secret,
    { algorithm: 'HS256', audience: 'toowix-monitoring', issuer: 'toowix-backend', expiresIn: '5m' },
  );
  res.json({ token, participantId, displayName: user.fullName, expiresInSeconds: 300 });
}
