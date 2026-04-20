import pino from "pino";

import { env } from "./env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "propriateraydb-backend",
    env: env.NODE_ENV
  },
  timestamp: pino.stdTimeFunctions.isoTime
});
