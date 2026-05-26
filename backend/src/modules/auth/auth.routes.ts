import { Router, type RequestHandler } from "express";
import { z } from "zod";

import { env } from "../../config/env";
import { buildMockAuthContext } from "./auth.context";
import { completeOidcLogin, createOidcAuthorizationRequest } from "./oidc.service";

const mockLoginSchema = z.object({
  username: z.string().min(1).default("demo.user"),
  displayName: z.string().min(1).default("Demo User"),
  roles: z.array(z.string().min(1)).default(["reader"])
});

export const authRouter = Router();

const asyncHandler =
  (handler: RequestHandler): RequestHandler =>
  (request, response, next) => {
    void Promise.resolve(handler(request, response, next)).catch(next);
  };

const saveSession = (request: Parameters<RequestHandler>[0]) =>
  new Promise<void>((resolve, reject) => {
    request.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

authRouter.get("/me", (request, response) => {
  if (!request.session.authContext) {
    response.status(200).json({
      authenticated: false
    });
    return;
  }

  response.status(200).json({
    authenticated: true,
    ...request.session.authContext
  });
});

authRouter.post("/mock-login", asyncHandler(async (request, response) => {
  if (env.AUTH_MODE !== "mock") {
    response.status(405).json({
      error: "mock_auth_disabled"
    });
    return;
  }

  const payload = mockLoginSchema.parse(request.body ?? {});

  request.session.authContext = buildMockAuthContext({
    subject: payload.username,
    displayName: payload.displayName,
    roles: payload.roles
  });
  await saveSession(request);

  response.status(200).json({
    authenticated: true,
    ...request.session.authContext
  });
}));

authRouter.get("/login", asyncHandler(async (request, response) => {
  if (env.AUTH_MODE === "mock") {
    response.status(200).json({
      message: "Use POST /auth/mock-login in mock mode"
    });
    return;
  }

  const { authorizationUrl, pendingLogin } = await createOidcAuthorizationRequest();
  request.session.pendingOidcLogin = pendingLogin;
  await saveSession(request);

  response.redirect(authorizationUrl.toString());
}));

authRouter.get("/callback", asyncHandler(async (request, response) => {
  if (env.AUTH_MODE !== "oidc") {
    response.status(405).json({
      error: "oidc_auth_disabled"
    });
    return;
  }

  try {
    request.session.authContext = await completeOidcLogin({
      originalUrl: request.originalUrl,
      protocol: request.protocol,
      host: request.get("host"),
      pendingLogin: request.session.pendingOidcLogin
    });
    delete request.session.pendingOidcLogin;
    await saveSession(request);

    response.redirect("/me");
  } catch (error) {
    delete request.session.pendingOidcLogin;
    await saveSession(request).catch(() => undefined);
    throw error;
  }
}));

authRouter.post("/logout", (request, response, next) => {
  request.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }

    response.status(204).send();
  });
});
