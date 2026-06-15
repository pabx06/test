import "express-session";

import type { AppAuthContext, PendingOidcLogin } from "../modules/auth/auth.context";

declare module "express-session" {
  interface SessionData {
    authContext?: AppAuthContext;
    pendingOidcLogin?: PendingOidcLogin;
  }
}
