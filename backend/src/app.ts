import express, { type RequestHandler } from "express";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";

import { env } from "./config/env";
import { logger } from "./config/logger";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { authRouter } from "./modules/auth/auth.routes";
import { healthRouter } from "./modules/health/health.routes";
import { apiRouter } from "./modules/system/api.routes";

export const createApp = (sessionMiddleware: RequestHandler) => {
  const app = express();

  app.set("trust proxy", 1);

  app.use((request, response, next) => {
    const requestId = request.header("x-request-id") ?? randomUUID();
    request.headers["x-request-id"] = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (request, response) => {
        const current = request.headers["x-request-id"];
        if (Array.isArray(current)) {
          return current[0];
        }

        if (typeof current === "string" && current.length > 0) {
          return current;
        }

        const generated = randomUUID();
        response.setHeader("x-request-id", generated);
        return generated;
      }
    })
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(sessionMiddleware);

  app.get("/", (_request, response) => {
    response.status(200).json({
      name: "propriateraydb-backend",
      authMode: env.AUTH_MODE,
      sessionStore: env.SESSION_STORE
    });
  });

  app.use("/auth", authRouter);
  app.use(healthRouter);
  app.use("/api", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
