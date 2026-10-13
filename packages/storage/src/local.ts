import { z } from "zod";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, stat, rename } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  ObjectConflictError,
  type ObjectStore,
  type PresignRequest,
  type PresignedPut,
} from "./object-store";

const UploadTokenClaimsSchema = z
  .object({
    key: z.string().min(1),
    contentType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256Hex: z.string().regex(/^[0-9a-f]{64}$/),
    exp: z.number().int(),
  })
  .strict();
export type UploadTokenClaims = z.infer<typeof UploadTokenClaimsSchema>;

/**
 * Filesystem-backed store for local development and tests, used when no S3
 * endpoint is configured. Presigned uploads are HMAC-signed tokens accepted
 * by the API's `/v1/object-uploads/:token` endpoint, mirroring S3 presigned
 * PUT semantics (expiry, size and checksum enforced).
 */
export class LocalObjectStore implements ObjectStore {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(
    root: string,
    private readonly signingSecret: string,
    private readonly uploadBaseUrl: string,
  ) {
    if (signingSecret.length < 32)
      throw new Error("local object store signing secret must be at least 32 characters");
    this.root = resolve(root);
  }

  private path(key: string): string {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error("object key escapes the storage root");
    return p;
  }

  async putImmutable(key: string, bytes: Uint8Array, _contentType: string): Promise<void> {
    const target = this.path(key);
    const existing = await this.get(key);
    if (existing) {
      if (Buffer.compare(Buffer.from(existing), Buffer.from(bytes)) === 0) return;
      throw new ObjectConflictError(key);
    }
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, bytes, { flag: "wx" });
    await rename(tmp, target);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }

  presignPut(request: PresignRequest): Promise<PresignedPut> {
    const expiresAt = new Date(Date.now() + request.expiresInSeconds * 1000);
    const claims: UploadTokenClaims = {
      key: request.key,
      contentType: request.contentType,
      sizeBytes: request.sizeBytes,
      sha256Hex: request.sha256Hex,
      exp: Math.floor(expiresAt.getTime() / 1000),
    };
    const token = this.sign(claims);
    return Promise.resolve({
      url: `${this.uploadBaseUrl.replace(/\/$/, "")}/v1/object-uploads/${token}`,
      headers: { "content-type": request.contentType },
      expiresAt,
    });
  }

  sign(claims: UploadTokenClaims): string {
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const mac = createHmac("sha256", this.signingSecret).update(body).digest("base64url");
    return `${body}.${mac}`;
  }

  verifyToken(token: string, now: Date = new Date()): UploadTokenClaims | null {
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const expected = createHmac("sha256", this.signingSecret).update(body).digest();
    const given = Buffer.from(mac, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const parsed = UploadTokenClaimsSchema.safeParse(
        JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
      );
      if (!parsed.success || parsed.data.exp * 1000 < now.getTime()) return null;
      return parsed.data;
    } catch {
      return null;
    }
  }

  /** Accept a presigned upload: enforce size and checksum, then store immutably. */
  async acceptUpload(
    token: string,
    bytes: Uint8Array,
  ): Promise<{ ok: true; key: string } | { ok: false; reason: string }> {
    const claims = this.verifyToken(token);
    if (!claims) return { ok: false, reason: "upload token is invalid or expired" };
    if (bytes.byteLength !== claims.sizeBytes)
      return { ok: false, reason: "uploaded size differs from the declared size" };
    if (createHash("sha256").update(bytes).digest("hex") !== claims.sha256Hex) {
      return { ok: false, reason: "uploaded content does not match the declared sha256" };
    }
    await this.putImmutable(claims.key, bytes, claims.contentType);
    return { ok: true, key: claims.key };
  }
}
