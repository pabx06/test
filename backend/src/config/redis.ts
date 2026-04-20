import { createClient, type RedisClientType } from "redis";

import { env } from "./env";
import { logger } from "./logger";

let client: RedisClientType | null = null;

const buildRedisUrl = () => {
  if (env.REDIS_PASSWORD) {
    return `redis://:${encodeURIComponent(env.REDIS_PASSWORD)}@${env.REDIS_HOST}:${env.REDIS_PORT}`;
  }

  return `redis://${env.REDIS_HOST}:${env.REDIS_PORT}`;
};

export const getRedisClient = async () => {
  if (env.SESSION_STORE !== "redis") {
    return null;
  }

  if (!client) {
    client = createClient({
      url: buildRedisUrl()
    });

    client.on("error", (error) => {
      logger.error({ error }, "redis client error");
    });
  }

  if (!client.isOpen) {
    await client.connect();
  }

  return client;
};

export const checkRedisConnection = async () => {
  if (env.SESSION_STORE !== "redis") {
    return true;
  }

  const redisClient = await getRedisClient();
  if (!redisClient) {
    return false;
  }

  const response = await redisClient.ping();
  return response === "PONG";
};

export const closeRedisClient = async () => {
  if (!client || !client.isOpen) {
    return;
  }

  await client.quit();
  client = null;
};
