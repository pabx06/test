export type AppRole = "admin" | "viewer" | "reader";

export type AppAuthContext = {
  user: {
    id: string;
    subject: string;
    issuer: string;
    displayName: string;
    email: string;
    emailVerified: boolean;
  };
  organization: {
    id: string;
    name: string;
    tenantId: string;
  };
  authorization: {
    roles: AppRole[];
    permissions: string[];
    groups: Array<{
      id: string;
      name: string;
    }>;
    scopesGranted: string[];
  };
  session: {
    createdAt: string;
    lastAuthenticatedAt: string;
    expiresAt: string;
    idleExpiresAt: string;
    authTime: string;
    mfa: boolean;
    amr: string[];
    acr: string;
  };
  security: {
    reauthRequired: boolean;
    passwordChangeRequired: boolean;
  };
};

export type PendingOidcLogin = {
  state: string;
  nonce: string;
  pkceCodeVerifier: string;
  createdAt: string;
};

export type ExternalAuthIdentity = {
  subject: string;
  issuer: string;
  displayName?: string;
  email?: string;
  emailVerified?: boolean;
  roles?: string[];
  scopesGranted?: string[];
  authTime?: number;
  amr?: string[];
  acr?: string;
};

export class UnknownAppUserError extends Error {
  constructor(subject: string) {
    super(`OIDC subject '${subject}' is not mapped to an application user`);
    this.name = "UnknownAppUserError";
  }
}

const sessionAbsoluteTtlMs = 8 * 60 * 60 * 1000;
const sessionIdleTtlMs = 30 * 60 * 1000;

const demoOrganization = {
  id: "org_demo",
  name: "Demo Organization",
  tenantId: "tenant_local"
};

type AppUserProfile = {
  id: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  defaultRoles: AppRole[];
  defaultAmr: string[];
  defaultAcr: string;
  mfa: boolean;
};

const roleDefinitions: Record<
  AppRole,
  {
    permissions: string[];
    groups: Array<{ id: string; name: string }>;
  }
> = {
  admin: {
    permissions: ["users:read", "users:write", "reports:read", "settings:manage"],
    groups: [{ id: "platform-admins", name: "Platform Admins" }]
  },
  viewer: {
    permissions: ["reports:read"],
    groups: [{ id: "report-viewers", name: "Report Viewers" }]
  },
  reader: {
    permissions: ["reports:read"],
    groups: []
  }
};

const knownUsers: Record<
  string,
  AppUserProfile
> = {
  alice: {
    id: "usr_alice",
    displayName: "Alice Demo",
    email: "alice@example.test",
    emailVerified: true,
    defaultRoles: ["admin"],
    defaultAmr: ["pwd", "mfa"],
    defaultAcr: "urn:enterprise:loa:2",
    mfa: true
  },
  bob: {
    id: "usr_bob",
    displayName: "Bob Demo",
    email: "bob@example.test",
    emailVerified: true,
    defaultRoles: ["viewer"],
    defaultAmr: ["pwd"],
    defaultAcr: "urn:enterprise:loa:1",
    mfa: false
  }
};

const isAppRole = (value: string): value is AppRole => value in roleDefinitions;

const unique = <T>(values: T[]) => Array.from(new Set(values));

const normalizeIdentifier = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const createLooseProfile = (subject: string, displayName?: string) => {
  const normalized = normalizeIdentifier(subject) || "mock_user";

  return {
    id: `usr_${normalized}`,
    displayName: displayName ?? subject,
    email: `${normalized}@example.test`,
    emailVerified: true,
    defaultRoles: ["reader"],
    defaultAmr: ["pwd"],
    defaultAcr: "urn:enterprise:loa:1",
    mfa: false
  } satisfies AppUserProfile;
};

const normalizeRoles = (roles: string[] | undefined, fallbackRoles: AppRole[]) => {
  const mapped = unique(
    (roles ?? [])
      .map((role) => role.trim().toLowerCase())
      .filter((role): role is AppRole => isAppRole(role))
  );

  return mapped.length > 0 ? mapped : fallbackRoles;
};

const buildAuthorization = (roles: AppRole[], scopesGranted: string[]) => {
  const permissions = unique(roles.flatMap((role) => roleDefinitions[role].permissions));
  const groupsById = new Map<string, { id: string; name: string }>();

  for (const group of roles.flatMap((role) => roleDefinitions[role].groups)) {
    groupsById.set(group.id, group);
  }

  return {
    roles,
    permissions,
    groups: Array.from(groupsById.values()),
    scopesGranted: unique(scopesGranted)
  };
};

const toIsoFromSeconds = (seconds: number | undefined, fallback: Date) => {
  if (!seconds || !Number.isFinite(seconds)) {
    return fallback.toISOString();
  }

  return new Date(seconds * 1000).toISOString();
};

const buildContext = (
  input: ExternalAuthIdentity,
  profile: AppUserProfile,
  roles: AppRole[]
): AppAuthContext => {
  const now = new Date();
  const amr = input.amr && input.amr.length > 0 ? input.amr : profile.defaultAmr;

  return {
    user: {
      id: profile.id,
      subject: input.subject,
      issuer: input.issuer,
      displayName: input.displayName ?? profile.displayName,
      email: input.email ?? profile.email,
      emailVerified: input.emailVerified ?? profile.emailVerified
    },
    organization: demoOrganization,
    authorization: buildAuthorization(roles, input.scopesGranted ?? ["openid", "profile", "email"]),
    session: {
      createdAt: now.toISOString(),
      lastAuthenticatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + sessionAbsoluteTtlMs).toISOString(),
      idleExpiresAt: new Date(now.getTime() + sessionIdleTtlMs).toISOString(),
      authTime: toIsoFromSeconds(input.authTime, now),
      mfa: profile.mfa || amr.includes("mfa"),
      amr,
      acr: input.acr ?? profile.defaultAcr
    },
    security: {
      reauthRequired: false,
      passwordChangeRequired: false
    }
  };
};

export const buildMockAuthContext = (input: {
  subject: string;
  displayName?: string;
  roles?: string[];
}) => {
  const profile = knownUsers[input.subject] ?? createLooseProfile(input.subject, input.displayName);
  const roles = normalizeRoles(input.roles, profile.defaultRoles);

  return buildContext(
    {
      subject: input.subject,
      issuer: "mock",
      displayName: input.displayName,
      email: profile.email,
      emailVerified: profile.emailVerified,
      roles,
      scopesGranted: ["mock"]
    },
    profile,
    roles
  );
};

export const buildOidcAuthContext = (input: ExternalAuthIdentity) => {
  const profile = knownUsers[input.subject];

  if (!profile) {
    throw new UnknownAppUserError(input.subject);
  }

  const roles = normalizeRoles(input.roles, profile.defaultRoles);
  return buildContext(input, profile, roles);
};
