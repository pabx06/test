import { Router } from "express";
import { z } from "zod";

import { env } from "../../config/env";

const mockLoginSchema = z.object({
  username: z.string().min(1).default("demo.user"),
  displayName: z.string().min(1).default("Demo User"),
  roles: z.array(z.string().min(1)).default(["reader"])
});

export const authRouter = Router();

authRouter.get("/me", (request, response) => {
  response.status(200).json({
    authenticated: Boolean(request.session.user),
    authMode: env.AUTH_MODE,
    user: request.session.user ?? null
  });
});

authRouter.post("/mock-login", (request, response) => {
  if (env.AUTH_MODE !== "mock") {
    response.status(405).json({
      error: "mock_auth_disabled"
    });
    return;
  }

  const payload = mockLoginSchema.parse(request.body ?? {});

  request.session.user = {
    username: payload.username,
    displayName: payload.displayName,
    roles: payload.roles,
    authMode: "mock"
  };

  response.status(200).json({
    authenticated: true,
    user: request.session.user
  });
});

authRouter.get("/login", (_request, response) => {
  if (env.AUTH_MODE === "mock") {
    response.status(200).json({
      message: "Use POST /auth/mock-login in mock mode"
    });
    return;
  }

  response.status(501).json({
    error: "oidc_not_wired",
    message: "OpenID Connect routes are scaffolded but the IdP integration is not yet implemented"
  });
});

authRouter.post("/logout", (request, response, next) => {
  request.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }

    response.status(204).send();
  });
});
