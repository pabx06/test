import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { HttpError } from "../../middleware/http-error";
import {
  buildOidcAuthContext,
  type AppAuthContext,
  type ExternalAuthIdentity,
  type PendingOidcLogin,
  UnknownAppUserError
} from "./auth.context";

type OpenIdClientModule = typeof import("openid-client");
type OidcConfiguration = import("openid-client").Configuration;
type ClaimBag = Record<string, unknown>;

const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<OpenIdClientModule>;

let openIdClientModule: OpenIdClientModule | null = null;
let oidcConfiguration: OidcConfiguration | null = null;

const loadOpenIdClient = async () => {
  if (!openIdClientModule) {
    openIdClientModule = await nativeImport("openid-client");
  }

  return openIdClientModule;
};

const isLocalHttpIssuer = (issuerUrl: URL) =>
  issuerUrl.protocol === "http:" &&
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(issuerUrl.hostname);

const getOidcConfiguration = async () => {
  if (oidcConfiguration) {
    return oidcConfiguration;
  }

  const client = await loadOpenIdClient();
  const issuerUrl = new URL(env.OIDC_ISSUER_URL);
  const discoveryOptions = isLocalHttpIssuer(issuerUrl)
    ? {
        execute: [client.allowInsecureRequests]
      }
    : undefined;

  oidcConfiguration = await client.discovery(
    issuerUrl,
    env.OIDC_CLIENT_ID,
    {
      client_secret: env.OIDC_CLIENT_SECRET
    },
    client.ClientSecretPost(env.OIDC_CLIENT_SECRET),
    discoveryOptions
  );

  return oidcConfiguration;
};

export const createOidcAuthorizationRequest = async () => {
  const client = await loadOpenIdClient();
  const config = await getOidcConfiguration();
  const pkceCodeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(pkceCodeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const authorizationUrl = client.buildAuthorizationUrl(config, {
    response_type: "code",
    redirect_uri: env.OIDC_REDIRECT_URI,
    scope: env.OIDC_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce
  });

  return {
    authorizationUrl,
    pendingLogin: {
      state,
      nonce,
      pkceCodeVerifier,
      createdAt: new Date().toISOString()
    } satisfies PendingOidcLogin
  };
};

const asClaimBag = (value: unknown): ClaimBag => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as ClaimBag;
};

const getStringClaim = (claims: ClaimBag[], name: string) => {
  for (const claimBag of claims) {
    const value = claimBag[name];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
};

const getBooleanClaim = (claims: ClaimBag[], name: string) => {
  for (const claimBag of claims) {
    const value = claimBag[name];
    if (typeof value === "boolean") {
      return value;
    }
  }

  return undefined;
};

const getNumberClaim = (claims: ClaimBag[], name: string) => {
  for (const claimBag of claims) {
    const value = claimBag[name];
    if (typeof value === "number") {
      return value;
    }
  }

  return undefined;
};

const claimToStrings = (value: unknown): string[] => {
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  }

  return [];
};

const getStringListClaims = (claims: ClaimBag[], names: string[]) =>
  Array.from(
    new Set(
      claims.flatMap((claimBag) => names.flatMap((name) => claimToStrings(claimBag[name])))
    )
  );

const decodeJwtPayload = (token: unknown): ClaimBag => {
  if (typeof token !== "string") {
    return {};
  }

  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    return {};
  }

  try {
    return asClaimBag(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
  } catch {
    return {};
  }
};

const getCurrentUrl = (requestUrl: string, protocol: string, host: string | undefined) => {
  if (!host) {
    throw new HttpError(400, "invalid_callback_request", "Missing Host header");
  }

  return new URL(requestUrl, `${protocol}://${host}`);
};

export const completeOidcLogin = async (input: {
  originalUrl: string;
  protocol: string;
  host?: string;
  pendingLogin?: PendingOidcLogin;
}): Promise<AppAuthContext> => {
  if (!input.pendingLogin) {
    throw new HttpError(400, "oidc_login_state_missing", "No pending OIDC login state was found");
  }

  const client = await loadOpenIdClient();
  const config = await getOidcConfiguration();
  const tokens = await client.authorizationCodeGrant(
    config,
    getCurrentUrl(input.originalUrl, input.protocol, input.host),
    {
      expectedState: input.pendingLogin.state,
      expectedNonce: input.pendingLogin.nonce,
      pkceCodeVerifier: input.pendingLogin.pkceCodeVerifier,
      idTokenExpected: true
    }
  );

  const idClaims = asClaimBag(tokens.claims());
  const accessClaims = decodeJwtPayload(tokens.access_token);
  const subject = getStringClaim([idClaims], "sub");

  if (!subject) {
    throw new HttpError(401, "oidc_subject_missing", "The validated ID token did not contain a subject");
  }

  let userInfoClaims: ClaimBag = {};
  if (tokens.access_token) {
    try {
      userInfoClaims = asClaimBag(await client.fetchUserInfo(config, tokens.access_token, subject));
    } catch (error) {
      logger.warn({ error }, "OIDC userinfo request failed; continuing with token claims");
    }
  }

  const claimPriority = [userInfoClaims, idClaims, accessClaims];
  const identity: ExternalAuthIdentity = {
    subject,
    issuer: getStringClaim([idClaims], "iss") ?? env.OIDC_ISSUER_URL,
    displayName: getStringClaim(claimPriority, "name"),
    email: getStringClaim(claimPriority, "email"),
    emailVerified: getBooleanClaim(claimPriority, "email_verified"),
    roles: getStringListClaims([accessClaims, userInfoClaims, idClaims], ["role", "roles", "groups"]),
    scopesGranted:
      getStringListClaims([accessClaims], ["scope", "scp"]).length > 0
        ? getStringListClaims([accessClaims], ["scope", "scp"])
        : env.OIDC_SCOPE.split(/\s+/).filter(Boolean),
    authTime: getNumberClaim([idClaims, accessClaims], "auth_time"),
    amr: getStringListClaims([idClaims, accessClaims], ["amr"]),
    acr: getStringClaim([idClaims, accessClaims], "acr")
  };

  try {
    return buildOidcAuthContext(identity);
  } catch (error) {
    if (error instanceof UnknownAppUserError) {
      throw new HttpError(403, "user_not_authorized", error.message);
    }

    throw error;
  }
};
