import { Router } from "express";

import { env } from "../../config/env";
import { getReadinessReport } from "./health.service";

export const healthRouter = Router();

healthRouter.get("/health/live", (_request, response) => {
  response.status(200).json({
    status: "live",
    uptime: process.uptime()
  });
});

healthRouter.get("/health/startup", (_request, response) => {
  response.status(200).json({
    status: "startup",
    nodeEnv: env.NODE_ENV
  });
});

healthRouter.get("/health/ready", async (_request, response, next) => {
  try {
    const report = await getReadinessReport();
    response.status(report.ready ? 200 : 503).json({
      status: report.ready ? "ready" : "not_ready",
      ...report
    });
  } catch (error) {
    next(error);
  }
});

healthRouter.get("/api/health", async (_request, response, next) => {
  try {
    const report = await getReadinessReport();
    response.status(report.ready ? 200 : 503).json({
      service: "propriateraydb-backend",
      authMode: env.AUTH_MODE,
      sessionStore: env.SESSION_STORE,
      status: report.ready ? "ok" : "degraded",
      ...report
    });
  } catch (error) {
    next(error);
  }
});
