import { Router } from "express";

import { env } from "../../config/env";

export const apiRouter = Router();

apiRouter.get("/status", (request, response) => {
  response.status(200).json({
    name: "propriateraydb-backend",
    nodeEnv: env.NODE_ENV,
    authMode: env.AUTH_MODE,
    sessionStore: env.SESSION_STORE,
    authenticated: Boolean(request.session.user)
  });
});
