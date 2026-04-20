import { checkDatabaseConnection } from "../../config/db";
import { env } from "../../config/env";
import { checkRedisConnection } from "../../config/redis";

export type DependencyStatus = {
  name: string;
  ok: boolean;
  required: boolean;
  detail: string;
};

export const getReadinessReport = async () => {
  const dependencies: DependencyStatus[] = [];

  try {
    await checkDatabaseConnection();
    dependencies.push({
      name: "mariadb",
      ok: true,
      required: true,
      detail: "connection ok"
    });
  } catch (error) {
    dependencies.push({
      name: "mariadb",
      ok: false,
      required: true,
      detail: error instanceof Error ? error.message : "unknown database error"
    });
  }

  if (env.SESSION_STORE === "redis") {
    try {
      const ok = await checkRedisConnection();
      dependencies.push({
        name: "redis",
        ok,
        required: true,
        detail: ok ? "ping ok" : "unexpected ping response"
      });
    } catch (error) {
      dependencies.push({
        name: "redis",
        ok: false,
        required: true,
        detail: error instanceof Error ? error.message : "unknown redis error"
      });
    }
  } else {
    dependencies.push({
      name: "redis",
      ok: true,
      required: false,
      detail: "disabled"
    });
  }

  const ready = dependencies.every((dependency) => !dependency.required || dependency.ok);

  return {
    ready,
    dependencies
  };
};
