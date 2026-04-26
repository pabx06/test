import { z } from "zod";

const booleanString = z
  .string()
  .optional()
  .transform((value) => value === "true");

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    AUTH_MODE: z.enum(["mock", "oidc"]).default("mock"),
    SESSION_STORE: z.enum(["memory", "redis"]).default("memory"),
    SESSION_SECRET: z.string().min(8).default("local-development-secret"),
    NAS_XML_PATH: z.string().min(1).default("/mnt/nas/xml"),
    DB_HOST: z.string().min(1).default("db"),
    DB_PORT: z.coerce.number().int().positive().default(3306),
    DB_NAME: z.string().min(1).default("propriateraydb"),
    DB_USER: z.string().min(1).default("propriateraydb"),
    DB_PASSWORD: z.string().min(1).default("propriateraydb"),
    REDIS_HOST: z.string().optional().default("redis"),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional().default(""),
    OIDC_ISSUER_URL: z.string().url().optional().or(z.literal("")).default(""),
    OIDC_CLIENT_ID: z.string().optional().default(""),
    OIDC_CLIENT_SECRET: z.string().optional().default(""),
    OIDC_REDIRECT_URI: z.string().url().optional().or(z.literal("")).default(""),
    OIDC_SCOPE: z.string().min(1).default("openid profile email"),
    ITK_MOCK: booleanString,
    PROPRIATERAYDB_MOCK: booleanString
  })
  .superRefine((data, context) => {
    if (data.AUTH_MODE === "oidc") {
      const missing = [
        ["OIDC_ISSUER_URL", data.OIDC_ISSUER_URL],
        ["OIDC_CLIENT_ID", data.OIDC_CLIENT_ID],
        ["OIDC_CLIENT_SECRET", data.OIDC_CLIENT_SECRET],
        ["OIDC_REDIRECT_URI", data.OIDC_REDIRECT_URI]
      ].filter(([, value]) => !value);

      for (const [field] of missing) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when AUTH_MODE=oidc`
        });
      }
    }

    if (data.SESSION_STORE === "redis" && !data.REDIS_HOST) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REDIS_HOST"],
        message: "REDIS_HOST is required when SESSION_STORE=redis"
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
