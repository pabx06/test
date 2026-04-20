import { createServer } from "node:http";

import { createApp } from "./app";
import { closeDatabasePool } from "./config/db";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { closeRedisClient } from "./config/redis";
import { createSessionMiddleware } from "./modules/auth/session.store";

const shutdownSignals = ["SIGINT", "SIGTERM"] as const;

const bootstrap = async () => {
  const sessionMiddleware = await createSessionMiddleware();
  const app = createApp(sessionMiddleware);
  const server = createServer(app);

  server.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        authMode: env.AUTH_MODE,
        sessionStore: env.SESSION_STORE
      },
      "backend listening"
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutdown requested");

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await Promise.allSettled([closeDatabasePool(), closeRedisClient()]);
    process.exit(0);
  };

  for (const signal of shutdownSignals) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
};

void bootstrap().catch(async (error: unknown) => {
  logger.error({ error }, "failed to bootstrap backend");
  await Promise.allSettled([closeDatabasePool(), closeRedisClient()]);
  process.exit(1);
});
