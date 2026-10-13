"use client";

import { useCallback, useRef, useState } from "react";
import type { z } from "zod";
import type { ProblemDetails } from "@arf/contracts";
import { clientCommand, newIdempotencyKey } from "@/lib/client-api";

/**
 * One logical command with a stable idempotency key: a double click or a
 * retry after a network error reuses the key, so the server applies it once.
 * The key rotates only after a definitive answer.
 */
export function useCommand<T>(method: "POST" | "PUT", schema: z.ZodType<T>) {
  const key = useRef<string>(newIdempotencyKey());
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const run = useCallback(
    async (path: string, body: unknown): Promise<T | null> => {
      setPending(true);
      setProblem(null);
      const res = await clientCommand(method, path, body, key.current, schema);
      setPending(false);
      if (res.ok) {
        key.current = newIdempotencyKey();
        return res.data;
      }
      if (res.problem.status < 500 && res.problem.status !== 409) key.current = newIdempotencyKey();
      setProblem(res.problem);
      return null;
    },
    [method, schema],
  );
  return { run, pending, problem, setProblem };
}
