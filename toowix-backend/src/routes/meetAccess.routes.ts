import { Router } from 'express';
import { requireToowixAuth } from '../middleware/requireToowixAuth';
import { requireMeetEntitlement, type IMeetTenantRequest } from '../middleware/requireMeetEntitlement';

// New, additive route -- does not replace or modify any existing meeting route. This is the
// local proof of the full Keycloak -> tenant -> entitlement chain (Phase 8 of the brief);
// wiring this same middleware pair into the real meeting-join route is deliberately left as a
// separate, later change (see Phase K in the final report) rather than risking today's live
// Firebase-based meeting auth.
const router = Router();

router.get('/access-check', requireToowixAuth, requireMeetEntitlement, (req: IMeetTenantRequest, res) => {
  res.json({ allowed: true, tenantId: req.meetTenant?.companyId ?? null, userId: req.meetTenant?.userId });
});

export default router;
