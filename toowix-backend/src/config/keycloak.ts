/**
 * Server-only Keycloak resource-server configuration.
 *
 * No client secret belongs here: the Meet browser is a public PKCE client and this
 * backend only validates access tokens that Keycloak has already issued.
 */
export interface KeycloakConfig {
  enabled: boolean;
  issuer: string;
  jwksUrl: string;
  meetClientId: string;
}

const withoutTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export function getKeycloakConfig(): KeycloakConfig {
  const issuer = withoutTrailingSlash(
    process.env.KEYCLOAK_ISSUER_URL || 'http://localhost:8080/realms/toowix'
  );

  return {
    enabled: process.env.KEYCLOAK_ENABLED === 'true',
    issuer,
    jwksUrl: process.env.KEYCLOAK_JWKS_URL || `${issuer}/protocol/openid-connect/certs`,
    meetClientId: process.env.KEYCLOAK_MEET_CLIENT_ID || 'toowix-meet',
  };
}
