import type { NextFunction, Response } from 'express';
import { checkMeetEntitlement, resolveTenantFromKeycloakSub } from '../lib/meetEntitlement';
import type { ToowixAuthenticatedRequest } from './requireToowixAuth';

export interface IMeetTenantRequest extends ToowixAuthenticatedRequest {
  meetTenant?: { userId: string; companyId: string | null };
}

/**
 * Runs AFTER requireToowixAuth (which already verified the Keycloak JWT and the meet_access
 * realm role). This is the Phase 5/6 step: resolve the verified token's `sub` to a real Toowix
 * user/company, then decide allow/deny from that tenant's actual status -- a valid, signed token
 * with the right role is necessary but not sufficient; a suspended tenant's users still have
 * perfectly valid tokens.
 */
export async function requireMeetEntitlement(
  req: IMeetTenantRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sub = req.toowixUser?.sub;

  if (!sub) {
    // Should be unreachable in practice -- requireToowixAuth already rejects a token with no
    // verifiable payload -- but a sub-less payload has nothing to resolve a tenant from either
    // way, so this is the correct response if it somehow got here.
    res.status(401).json({ message: 'Invalid or expired Keycloak token' });
    return;
  }

  try {
    const identity = await resolveTenantFromKeycloakSub(sub);

    if (!identity) {
      res.status(403).json({ message: 'This Keycloak account is not linked to a Toowix user', reason: 'USER_NOT_LINKED' });
      return;
    }

    const entitlement = await checkMeetEntitlement(identity);

    if (!entitlement.allowed) {
      // The reason code is useful to ops/support and to this app's own client-side messaging,
      // but deliberately carries no extra tenant/billing detail beyond the code itself -- see
      // Phase 6 of the brief ("do not leak sensitive internal details unnecessarily").
      res.status(403).json({ message: 'Meet access is not available for this account', reason: entitlement.reason });
      return;
    }

    req.meetTenant = { userId: entitlement.userId!, companyId: entitlement.companyId ?? null };
    next();
  } catch (error: unknown) {
    console.error('Meet entitlement check failed:', error instanceof Error ? error.message : error);
    res.status(500).json({ message: 'Could not verify Meet access' });
  }
}
