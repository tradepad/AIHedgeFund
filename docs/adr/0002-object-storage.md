# ADR 0002: Object storage with an S3 driver and a local signed-URL driver

## Status

Accepted (vertical slice).

## Context

Raw TradingView exports, parsed reports, Pine bundles and raw model output are
large immutable evidence. CLAUDE.md requires presigned uploads, organisation
scoped object paths and preserved raw files. Local development and CI must run
without cloud credentials, and the build environment for this slice could not
run Docker (so no MinIO).

## Decision

- `@arf/storage` defines a small `ObjectStore` interface: `presignPut`,
  `putImmutable` (refuses to overwrite a key with different content), `get` and
  `exists`. There is no delete.
- `S3ObjectStore` targets any S3-compatible store and is the only driver
  allowed in production (`NODE_ENV=production` refuses `local`).
- `LocalObjectStore` writes under an absolute `LOCAL_STORAGE_DIR` and issues
  upload URLs carrying an HMAC-SHA256 signed token (key, content type, size,
  SHA-256, expiry). `PUT /v1/object-uploads/:token` accepts the bytes only if
  the token verifies and the size and checksum match.
- Object keys are built by `objectPaths` and always begin with the
  organisation id. Uploads land in a staging key; completion verifies the
  object and copies it to a content-addressed artefact key.
- Artefacts are recorded in `artefacts` with SHA-256, size and protection
  level, and the table is immutable at the database level.

A separate package was added (rather than putting this in `apps/api`) because
the API and two workers all need the same store and object-path rules.

## Alternatives

- **MinIO in development.** Closest to production; not possible in the build
  environment and adds a service for every contributor. The compose file still
  provides it for anyone who wants the S3 driver locally.
- **Uploads through the API body.** Simpler, but the specification asks for
  presigned uploads and it couples API memory to file size.

## Consequences

- Browser uploads in development go through the web app's same-origin proxy
  (`UPLOAD_PUBLIC_BASE_URL=http://localhost:3000/arf-api`), avoiding CORS.
- With S3, bucket CORS must allow `PUT` from the web origin.

## Security implications

Upload tokens are short-lived, bound to one key, size and checksum, and signed
with `LOCAL_STORAGE_SIGNING_SECRET` (at least 32 characters, never logged).
Protected artefacts are only returned to callers with `protected:read`, and
every such read is audited.

## Migration/rollback

Switching drivers is configuration. Moving existing local objects to S3 is a
copy by key; `artefacts.sha256` verifies the copy.
