import "express-session";

declare module "express-session" {
  interface SessionData {
    user?: {
      username: string;
      displayName: string;
      roles: string[];
      authMode: "mock" | "oidc";
    };
  }
}
