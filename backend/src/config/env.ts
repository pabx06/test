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
    AUTH_MODE: z.enum(["mock", "saml"]).default("mock"),
    SESSION_STORE: z.enum(["memory", "redis"]).default("memory"),
    SESSION_SECRET: z.string().min(8).default("local-development-secret"),
    DB_HOST: z.string().min(1).default("db"),
    DB_PORT: z.coerce.number().int().positive().default(3306),
    DB_NAME: z.string().min(1).default("propriateraydb"),
    DB_USER: z.string().min(1).default("propriateraydb"),
    DB_PASSWORD: z.string().min(1).default("propriateraydb"),
    REDIS_HOST: z.string().optional().default("redis"),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional().default(""),
    SAML_ENTRY_POINT: z.string().optional().default(""),
    SAML_ISSUER: z.string().optional().default(""),
    SAML_CALLBACK_URL: z.string().optional().default(""),
    SAML_CERT: z.string().optional().default(""),
    ITK_MOCK: booleanString,
    PROPRIATERAYDB_MOCK: booleanString
  })
  .superRefine((data, context) => {
    if (data.AUTH_MODE === "saml") {
      const missing = [
        ["SAML_ENTRY_POINT", data.SAML_ENTRY_POINT],
        ["SAML_ISSUER", data.SAML_ISSUER],
        ["SAML_CALLBACK_URL", data.SAML_CALLBACK_URL],
        ["SAML_CERT", data.SAML_CERT]
      ].filter(([, value]) => !value);

      for (const [field] of missing) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when AUTH_MODE=saml`
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
