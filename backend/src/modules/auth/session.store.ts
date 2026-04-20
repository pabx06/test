import session from "express-session";
import { RedisStore } from "connect-redis";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { getRedisClient } from "../../config/redis";

export const createSessionMiddleware = async () => {
  let store: session.Store | undefined;

  if (env.SESSION_STORE === "redis") {
    const redisClient = await getRedisClient();

    if (!redisClient) {
      throw new Error("Redis session store requested but redis client is unavailable");
    }

    store = new RedisStore({
      client: redisClient,
      prefix: "propriateraydb:sess:"
    });
  } else if (env.NODE_ENV === "production") {
    logger.warn("Memory session store enabled in production");
  }

  return session({
    name: "propriateraydb.sid",
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000
    }
  });
};
