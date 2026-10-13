import { isAbsolute } from "node:path";
import { z } from "zod";
import { LocalObjectStore } from "./local";
import type { ObjectStore } from "./object-store";
import { S3ObjectStore } from "./s3";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

export const StorageEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  /** Absolute, so the API and every worker resolve the same directory whatever their working directory. */
  LOCAL_STORAGE_DIR: z
    .string()
    .refine((p) => isAbsolute(p), "LOCAL_STORAGE_DIR must be an absolute path")
    .optional(),
  LOCAL_STORAGE_SIGNING_SECRET: z.string().min(32).optional(),
  UPLOAD_PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000/arf-api"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),
});
export type StorageEnv = z.infer<typeof StorageEnvSchema>;

/** Build the configured object store. Errors name the missing variable, never a value. */
export function createObjectStore(env: StorageEnv): ObjectStore {
  if (env.STORAGE_DRIVER === "s3") {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error(
        "S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required for STORAGE_DRIVER=s3",
      );
    }
    return new S3ObjectStore({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  if (env.NODE_ENV === "production")
    throw new Error("the local storage driver is not allowed in production");
  if (!env.LOCAL_STORAGE_SIGNING_SECRET)
    throw new Error("LOCAL_STORAGE_SIGNING_SECRET is required for STORAGE_DRIVER=local");
  if (!env.LOCAL_STORAGE_DIR)
    throw new Error("LOCAL_STORAGE_DIR is required for STORAGE_DRIVER=local");
  return new LocalObjectStore(
    env.LOCAL_STORAGE_DIR,
    env.LOCAL_STORAGE_SIGNING_SECRET,
    env.UPLOAD_PUBLIC_BASE_URL,
  );
}
