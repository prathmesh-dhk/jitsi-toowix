import { Company } from '../models/Company';
import { User } from '../models/User';
import { SimpleCache } from './simpleCache';

// This backend IS the Meet backend (see src/meetings/*) -- there is no separate central Toowix
// entitlement microservice with its own Tenant/Domain/DomainSubscription/Plan models anywhere in
// this codebase (confirmed by repo-wide search before writing this). The closest real equivalent
// is the existing Company model: Company.status is the tenant-suspension signal, Company.plan is
// the subscription tier. This module is therefore an IN-PROCESS entitlement check, not a second
// network hop to call itself over HTTP -- a real service-to-service call only makes sense once a
// genuinely separate entitlement service exists to call.
export type MeetEntitlementDenialReason =
  | 'USER_NOT_LINKED'
  | 'USER_SUSPENDED'
  | 'NO_COMPANY'
  | 'TENANT_SUSPENDED'
  | 'TENANT_PENDING'
  | 'TENANT_REJECTED';

export interface IMeetEntitlementResult {
  allowed: boolean;
  reason?: MeetEntitlementDenialReason;
  userId?: string;
  companyId?: string;
}

interface ITenantIdentity {
  userId: string;
  companyId: string | null;
}

/**
 * Resolves a verified Keycloak access token's `sub` claim to a Toowix user. Returns null if no
 * user has been linked to this sub yet -- this NEVER falls back to matching by email or any
 * other self-reported claim; the link must already exist (see scripts/link-keycloak-sub.ts for
 * how to create one locally). A sub that has no link is a real "this Keycloak identity has not
 * been provisioned in Toowix yet" state, not a bug to paper over with a guess.
 */
export async function resolveTenantFromKeycloakSub(sub: string): Promise<ITenantIdentity | null> {
  const user = await User.findOne({ keycloakSub: sub }).select('_id companyId status').lean();

  if (!user) {
    return null;
  }

  return {
    userId: String(user._id),
    companyId: user.companyId ? String(user.companyId) : null,
  };
}

const entitlementCache = new SimpleCache<IMeetEntitlementResult>(45_000);

/**
 * The actual allow/deny decision for Meet access, given an already-resolved tenant identity.
 * Checks both the individual user's own status (a user can be suspended while their company
 * stays active) and the company's status (suspended/pending/rejected tenants block every member).
 * Cached for a short TTL (see SimpleCache) so a login/reconnect burst from one person doesn't
 * repeat the same two DB reads every time -- short enough that a moderator suspending someone
 * mid-meeting still takes effect within under a minute, not "until the server restarts".
 */
export async function checkMeetEntitlement(identity: ITenantIdentity): Promise<IMeetEntitlementResult> {
  const cacheKey = `meet:${identity.userId}`;
  const cached = entitlementCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const result = await computeMeetEntitlement(identity);

  entitlementCache.set(cacheKey, result);

  return result;
}

async function computeMeetEntitlement(identity: ITenantIdentity): Promise<IMeetEntitlementResult> {
  const user = await User.findById(identity.userId).select('status companyId').lean();

  if (!user) {
    return { allowed: false, reason: 'USER_NOT_LINKED' };
  }
  if (user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
    return { allowed: false, reason: 'USER_SUSPENDED', userId: identity.userId };
  }
  if (!user.companyId) {
    return { allowed: false, reason: 'NO_COMPANY', userId: identity.userId };
  }

  const company = await Company.findById(user.companyId).select('status').lean();

  if (!company) {
    return { allowed: false, reason: 'NO_COMPANY', userId: identity.userId };
  }
  if (company.status === 'SUSPENDED') {
    return { allowed: false, reason: 'TENANT_SUSPENDED', userId: identity.userId, companyId: String(company._id) };
  }
  if (company.status === 'PENDING') {
    return { allowed: false, reason: 'TENANT_PENDING', userId: identity.userId, companyId: String(company._id) };
  }
  if (company.status === 'REJECTED') {
    return { allowed: false, reason: 'TENANT_REJECTED', userId: identity.userId, companyId: String(company._id) };
  }

  return { allowed: true, userId: identity.userId, companyId: String(company._id) };
}

/** Test/ops hook only -- lets a suspension take effect immediately instead of waiting for the TTL. */
export function invalidateMeetEntitlementCache(userId: string): void {
  entitlementCache.delete(`meet:${userId}`);
}
