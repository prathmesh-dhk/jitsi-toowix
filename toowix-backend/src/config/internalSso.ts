// Shared-secret config for the Mail <-> Meet strict cross-app logout. Both backends set
// INTERNAL_SERVICE_SECRET to the SAME value out of band -- this authenticates service-to-service
// calls between the two, never a browser. An empty secret disables both the inbound endpoint
// (requireInternalSecret rejects everything) and outbound calls (callers treat it as unconfigured).
export interface InternalSsoConfig {
  serviceSecret: string;
  mailBaseUrl: string;
  timeoutMs: number;
}

export const internalSsoConfig: InternalSsoConfig = {
  serviceSecret: process.env.INTERNAL_SERVICE_SECRET || '',
  // Reuses the same Mail base URL already configured for the (currently dormant) entitlement
  // client, rather than inventing a second env var that would always be set to the same value.
  mailBaseUrl: (process.env.TENANT_ADMIN_BASE_URL || '').replace(/\/$/, ''),
  timeoutMs: parseInt(process.env.INTERNAL_SSO_TIMEOUT_MS || '5000', 10),
};

export function isInternalSsoInboundConfigured(): boolean {
  return Boolean(internalSsoConfig.serviceSecret);
}

export function isInternalSsoOutboundConfigured(): boolean {
  return Boolean(internalSsoConfig.serviceSecret && internalSsoConfig.mailBaseUrl);
}
