/**
 * Starts the API, outbox relay, orchestrator and pipeline workers against a
 * fresh throwaway database for the Playwright suite. Presigned uploads point
 * at the web BFF so the browser uploads same-origin. Development fixtures only.
 */
import { startStack } from "./harness";

const port = Number(process.env.E2E_API_PORT ?? "4400");
const webUrl = process.env.E2E_WEB_URL ?? "http://localhost:3100";

const stack = await startStack({ port, uploadBaseUrl: `${webUrl}/arf-api`, rateLimitMax: 1000 });
process.stdout.write(
  `e2e stack ready on ${stack.baseUrl} (database ${stack.db.url.split("/").at(-1) ?? ""})\n`,
);

let stopping = false;
const shutdown = (): void => {
  if (stopping) return;
  stopping = true;
  stack.stop().then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`e2e stack shutdown failed: ${String(error)}\n`);
      process.exit(1);
    },
  );
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
