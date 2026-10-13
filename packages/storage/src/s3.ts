import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, NoSuchKey, NotFound } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ObjectConflictError, type ObjectStore, type PresignRequest, type PresignedPut } from "./object-store";

export interface S3Config {
  endpoint?: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export class S3ObjectStore implements ObjectStore {
  readonly driver = "s3" as const;
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async putImmutable(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: bytes, ContentType: contentType, IfNoneMatch: "*" }),
      );
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 412) {
        const existing = await this.get(key);
        if (existing && Buffer.compare(Buffer.from(existing), Buffer.from(bytes)) === 0) return;
        throw new ObjectConflictError(key);
      }
      throw error;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return out.Body ? await out.Body.transformToByteArray() : null;
    } catch (error) {
      if (error instanceof NoSuchKey || error instanceof NotFound) return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch (error) {
      if (error instanceof NotFound || error instanceof NoSuchKey) return false;
      throw error;
    }
  }

  async presignPut(request: PresignRequest): Promise<PresignedPut> {
    const checksum = Buffer.from(request.sha256Hex, "hex").toString("base64");
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: request.key,
      ContentType: request.contentType,
      ContentLength: request.sizeBytes,
      ChecksumSHA256: checksum,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: request.expiresInSeconds,
      signableHeaders: new Set(["content-type", "content-length", "x-amz-checksum-sha256"]),
    });
    return {
      url,
      headers: { "content-type": request.contentType, "x-amz-checksum-sha256": checksum },
      expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
    };
  }
}
