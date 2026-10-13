import { isAbsolute } from "node:path";
import { z } from "zod";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

export const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().default(4000),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    AUTH_MODE: z.enum(["dev", "clerk"]).default("dev"),
    CLERK_SECRET_KEY: z.string().optional(),
    CLERK_AUTHORIZED_PARTIES: z.string().optional(),
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  /** Absolute, so the API and every worker resolve the same directory whatever their working directory. */
  LOCAL_STORAGE_DIR: z.string().refine((p) => isAbsolute(p), "LOCAL_STORAGE_DIR must be an absolute path").optional(),
    LOCAL_STORAGE_SIGNING_SECRET: z.string().min(32).optional(),
    UPLOAD_PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000/arf-api"),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(true),
    OUTBOX_RELAY_ENABLED: bool.default(true),
    ORCHESTRATOR_ENABLED: bool.default(true),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    LOG_LEVEL: z.string().default("info"),
  })
  .superRefine((c, ctx) => {
    if (c.AUTH_MODE === "dev" && c.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["AUTH_MODE"], message: "dev auth is not allowed in production" });
    }
    if (c.AUTH_MODE === "clerk" && !c.CLERK_SECRET_KEY) {
      ctx.addIssue({ code: "custom", path: ["CLERK_SECRET_KEY"], message: "required when AUTH_MODE=clerk" });
    }
    if (c.STORAGE_DRIVER === "local" && !c.LOCAL_STORAGE_SIGNING_SECRET) {
      ctx.addIssue({ code: "custom", path: ["LOCAL_STORAGE_SIGNING_SECRET"], message: "required when STORAGE_DRIVER=local" });
    }
    if (c.STORAGE_DRIVER === "local" && !c.LOCAL_STORAGE_DIR) {
      ctx.addIssue({ code: "custom", path: ["LOCAL_STORAGE_DIR"], message: "required when STORAGE_DRIVER=local" });
    }
    if (c.STORAGE_DRIVER === "local" && c.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["STORAGE_DRIVER"], message: "use s3 storage in production" });
    }
    if (c.STORAGE_DRIVER === "s3" && (!c.S3_BUCKET || !c.S3_ACCESS_KEY_ID || !c.S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required" });
    }
  });
export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid configuration: ${fields}`);
  }
  return parsed.data;
}
