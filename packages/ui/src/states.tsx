import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state-empty" role="status">
      <strong>{title}</strong>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  detail,
  traceId,
}: {
  title?: string;
  detail: string;
  traceId?: string | null;
}) {
  return (
    <div className="state state-error" role="alert">
      <strong>{title}</strong>
      <div>{detail}</div>
      {traceId ? <div className="muted mono">trace {traceId}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      {label}…
    </div>
  );
}

export function StaleNotice({ asOf }: { asOf: string }) {
  return (
    <div className="state state-stale" role="note">
      Derived view as of {asOf}. It refreshes after background jobs finish.
    </div>
  );
}
