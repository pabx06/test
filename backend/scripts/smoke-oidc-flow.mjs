const [backendUrl, providerUrl] = process.argv.slice(2);

const adminPermissions = ["users:read", "users:write", "reports:read", "settings:manage"];
const forbiddenKeys = new Set(["access_token", "id_token", "refresh_token", "claims"]);

const fail = (message) => {
  throw new Error(message);
};

const request = async (url, options = {}) => {
  const response = await fetch(url, { redirect: "manual", ...options });
  if (response.status >= 400) {
    fail(`${options.method ?? "GET"} ${url} returned ${response.status}: ${await response.text()}`);
  }
  return response;
};

const redirectLocation = (response, baseUrl) => {
  const location = response.headers.get("location");
  if (!location) {
    fail(`Expected redirect from ${response.url}`);
  }
  return new URL(location, baseUrl).href;
};

const backendCookieFrom = (response) => response.headers.get("set-cookie")?.split(";")[0] ?? "";

const providerFormUrl = (authorizationUrl, subject) => {
  const source = new URL(authorizationUrl);
  const target = new URL("/api/form", source.origin);

  for (const name of ["redirect_uri", "code_challenge", "code_challenge_method", "scope", "state", "nonce"]) {
    const value = source.searchParams.get(name);
    if (!value) {
      fail(`Missing ${name} in authorization URL`);
    }
    target.searchParams.set(name, value);
  }

  target.searchParams.set("sub", subject);
  return target.href;
};

const leakedKeys = (value, path = []) => {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) => {
    const nextPath = [...path, key];
    return forbiddenKeys.has(key) ? [nextPath.join(".")] : leakedKeys(nested, nextPath);
  });
};

const assertAuthContext = (payload, subject, role) => {
  if (payload.authenticated !== true) {
    fail("Expected authenticated=true");
  }
  if (payload.user?.subject !== subject || payload.user?.email !== `${subject}@example.test`) {
    fail(`Unexpected user in /auth/me: ${JSON.stringify(payload.user)}`);
  }
  if (!payload.authorization?.roles?.includes(role)) {
    fail(`Expected role ${role}`);
  }

  const permissions = payload.authorization?.permissions ?? [];
  if (role === "admin" && adminPermissions.some((permission) => !permissions.includes(permission))) {
    fail(`Admin permissions are incomplete: ${permissions.join(", ")}`);
  }
  if (role === "viewer" && (!permissions.includes("reports:read") || permissions.includes("users:write"))) {
    fail(`Viewer permissions are invalid: ${permissions.join(", ")}`);
  }

  const leaks = leakedKeys(payload);
  if (leaks.length > 0) {
    fail(`Response leaked token or raw claim fields: ${leaks.join(", ")}`);
  }
};

const loginAs = async (subject, role) => {
  const login = await request(`${backendUrl}/auth/login`);
  const backendCookie = backendCookieFrom(login);
  const authorizeUrl = redirectLocation(login, providerUrl);
  const providerForm = await request(providerFormUrl(authorizeUrl, subject));
  const callbackUrl = redirectLocation(providerForm, backendUrl);
  const callback = await request(callbackUrl, { headers: { cookie: backendCookie } });

  if (callback.headers.get("location") !== "/me") {
    fail(`Expected callback redirect to /me, got ${callback.headers.get("location")}`);
  }

  const me = await request(`${backendUrl}/auth/me`, { headers: { cookie: backendCookie } });
  assertAuthContext(await me.json(), subject, role);
};

for (const [subject, role] of [["alice", "admin"], ["bob", "viewer"]]) {
  await request(`${providerUrl}/api/clear`, { method: "POST" });
  await loginAs(subject, role);
}
