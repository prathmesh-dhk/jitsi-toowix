import { NextFunction, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from 'jose';
import { getKeycloakConfig } from '../config/keycloak';
import { AuthenticatedRequest } from './auth';

export interface KeycloakAuthenticatedRequest extends AuthenticatedRequest {
  keycloakSub?: string;
  keycloakRoles?: string[];
  keycloakEmail?: string;
  keycloakEmailVerified?: boolean;
}

let cachedJwksUrl: string | null = null;
let cachedJwks: JWTVerifyGetKey | null = null;

function jwksFor(url: string): JWTVerifyGetKey {
  // jose's remote JWKS implementation caches keys and performs a safe refresh when
  // Keycloak publishes a new `kid`, which covers normal signing-key rotation.
  if (!cachedJwks || cachedJwksUrl !== url) {
    cachedJwksUrl = url;
    cachedJwks = createRemoteJWKSet(new URL(url), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
      timeoutDuration: 5_000,
    });
  }

  return cachedJwks;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] || null;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Verifies the token cryptographically before exposing any claim to application code. */
export async function verifyKeycloakAccessToken(
  token: string,
): Promise<{ sub: string; roles: string[]; email?: string; emailVerified: boolean }> {
  const config = getKeycloakConfig();
  const { payload } = await jwtVerify(token, jwksFor(config.jwksUrl), {
    issuer: config.issuer,
    audience: config.meetClientId,
    algorithms: ['RS256'],
  });

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Keycloak access token has no subject');
  }

  const realmAccess = payload.realm_access as { roles?: unknown } | undefined;
  const roles = Array.isArray(realmAccess?.roles)
    ? realmAccess!.roles.filter((role): role is string => typeof role === 'string')
    : [];

  // Only trusted because this claim came out of a cryptographically verified Keycloak token --
  // never taken from anything client-supplied. email_verified reflects Keycloak's OWN judgement
  // (its 'email' client scope, included by default on the toowix-meet client); a missing/false
  // value is treated as unverified, never defaulted to true.
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const emailVerified = payload.email_verified === true;

  return { sub: payload.sub, roles, email, emailVerified };
}

/**
 * Resource-server guard for POST /api/auth/keycloak-session. This is deliberately
 * separate from Firebase middleware so existing Firebase routes keep their behavior.
 */
export const requireKeycloakAccessToken = async (
  req: KeycloakAuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  await requireKeycloakTokenFromHeader(req, res, next, headerValue(req.headers.authorization), 'Authorization');
};

/**
 * The self-link endpoint already needs Authorization for the Firebase ID token. It therefore
 * receives its separately verified Keycloak access token in X-Keycloak-Authorization. Keeping
 * the identities in distinct headers makes it impossible for one token to be mistaken for the
 * other, and neither identity is ever taken from a browser-supplied user/sub field.
 */
export const requireKeycloakLinkAccessToken = async (
  req: KeycloakAuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  await requireKeycloakTokenFromHeader(
    req,
    res,
    next,
    headerValue(req.headers['x-keycloak-authorization']),
    'X-Keycloak-Authorization',
  );
};

async function requireKeycloakTokenFromHeader(
  req: KeycloakAuthenticatedRequest,
  res: Response,
  next: NextFunction,
  authorizationHeader: string | undefined,
  headerName: string,
): Promise<void> {
  const config = getKeycloakConfig();
  if (!config.enabled) {
    res.status(503).json({ error: 'Keycloak sign-in is not enabled.' });
    return;
  }

  const token = bearerToken(authorizationHeader);
  if (!token) {
    res.status(401).json({ error: `Missing or invalid ${headerName} header` });
    return;
  }

  try {
    const identity = await verifyKeycloakAccessToken(token);
    req.keycloakSub = identity.sub;
    req.keycloakRoles = identity.roles;
    req.keycloakEmail = identity.email;
    req.keycloakEmailVerified = identity.emailVerified;
    next();
  } catch (error: any) {
    // Never log the presented token or return verification details to a caller.
    console.warn('[Keycloak Auth] Access token rejected:', error?.code || error?.name || 'verification_failed');
    res.status(401).json({ error: 'Invalid or expired Keycloak access token' });
  }
}

/** Test-only hook; production code never calls this. */
export function resetKeycloakJwksCacheForTests(): void {
  cachedJwks = null;
  cachedJwksUrl = null;
}
