export interface PresignRequest {
  key: string;
  contentType: string;
  sizeBytes: number;
  sha256Hex: string;
  expiresInSeconds: number;
}

export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

export class ObjectConflictError extends Error {
  constructor(readonly key: string) {
    super(`object ${key} already exists with different content`);
  }
}

/**
 * Minimal S3-compatible object store. Objects are immutable: `putImmutable`
 * succeeds if the key is new or already holds identical bytes, and fails if
 * the key holds different bytes. Nothing in the application deletes evidence.
 */
export interface ObjectStore {
  readonly driver: "s3" | "local";
  putImmutable(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  presignPut(request: PresignRequest): Promise<PresignedPut>;
}

/** Object-store paths (spec §14.7). Every path is organisation-prefixed. */
export const objectPaths = {
  version(p: { orgId: string; campaignId: string; strategyId: string; versionId: string }): string {
    return `orgs/${p.orgId}/campaigns/${p.campaignId}/strategies/${p.strategyId}/versions/${p.versionId}`;
  },
  sdl(base: string, sha: string): string {
    return `${base}/source/sdl-${sha}.json`;
  },
  pineSource(base: string, sha: string): string {
    return `${base}/source/pine-${sha}.pine`;
  },
  pineManifest(base: string, sha: string): string {
    return `${base}/manifests/manifest-${sha}.json`;
  },
  verificationStaging(base: string, verificationId: string, uploadId: string): string {
    return `${base}/tradingview-verification/${verificationId}/staging/${uploadId}.csv`;
  },
  verificationRaw(base: string, verificationId: string, sha: string): string {
    return `${base}/tradingview-verification/${verificationId}/raw/${sha}.csv`;
  },
  verificationParsed(base: string, verificationId: string, uploadId: string, sha: string): string {
    return `${base}/tradingview-verification/${verificationId}/parsed/${uploadId}-${sha}.json`;
  },
  ideaCard(orgId: string, campaignId: string, sha: string): string {
    return `orgs/${orgId}/campaigns/${campaignId}/ideas/idea-${sha}.json`;
  },
  agentRawOutput(orgId: string, campaignId: string, runId: string, sha: string): string {
    return `orgs/${orgId}/campaigns/${campaignId}/agent-runs/${runId}/protected/raw-output-${sha}.json`;
  },
};

export function assertOrgScoped(key: string, orgId: string): void {
  if (!key.startsWith(`orgs/${orgId}/`) || key.includes("..")) {
    throw new Error("object key is outside the organisation prefix");
  }
}
