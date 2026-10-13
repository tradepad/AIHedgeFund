"use client";

import Link from "next/link";
import { useEffect, useState, type DragEvent } from "react";
import { PresignedUploadSchema, ReportUploadSchema, VerificationStatusViewSchema, type ReportType, type VerificationStatusView } from "@arf/contracts";
import { ProblemInline } from "@/components/problem-inline";
import { useCommand } from "@/components/use-command";
import { clientGet } from "@/lib/client-api";

const LABEL: Record<ReportType, string> = { PERFORMANCE_SUMMARY: "Performance Summary", LIST_OF_TRADES: "List of Trades" };

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Upload flow: hash the file in the browser, reserve a presigned PUT, send the
 * bytes straight to object storage, then complete with the operator's
 * attestations. The server re-checks size and checksum before accepting it.
 */
export function UploadPanel({ initial }: { initial: VerificationStatusView }) {
  const [view, setView] = useState(initial);
  const [live, setLive] = useState(false);
  const v = view.verification;
  const done = v.status === "COMPLETED";

  useEffect(() => {
    if (done) return;
    // SSE progress, persisted server-side; the browser reconnects with Last-Event-ID.
    const source = new EventSource(`/arf-api/v1/tradingview-verifications/${v.id}/events`);
    source.addEventListener("open", () => setLive(true));
    source.addEventListener("verification", (e) => {
      const parsed = VerificationStatusViewSchema.safeParse(JSON.parse(e.data as string));
      if (parsed.success) setView(parsed.data);
    });
    source.addEventListener("end", () => source.close());
    source.addEventListener("error", () => setLive(false));
    return () => source.close();
  }, [v.id, done]);

  const refresh = async () => {
    const res = await clientGet(`/v1/tradingview-verifications/${v.id}`, VerificationStatusViewSchema);
    if (res.ok) setView(res.data);
  };

  return (
    <section className="card stack">
      <div className="row spread">
        <h2>Uploads</h2>
        <span className="badge" data-testid="verification-status" data-status={v.status}>
          {v.status.replace(/_/g, " ").toLowerCase()}
        </span>
      </div>
      {done ? (
        <div className="notice" data-testid="verification-complete">
          Processing complete. <Link href={`/versions/${v.strategyVersionId}?tab=results`}>View results</Link> · <Link href={`/versions/${v.strategyVersionId}?tab=parity`}>View parity</Link>
        </div>
      ) : null}
      {v.requiredReportTypes.map((t) => (
        <ReportSlot key={t} reportType={t} view={view} disabled={done} onChanged={() => void refresh()} />
      ))}
      <div>
        <h3>Processing jobs {live ? <span className="muted">· live</span> : null}</h3>
        {view.jobs.length === 0 ? (
          <span className="muted">none yet</span>
        ) : (
          <table data-testid="jobs-table">
            <tbody>
              {view.jobs.map((j) => (
                <tr key={j.jobKey}>
                  <td className="mono">{j.jobName}</td>
                  <td>{j.status.toLowerCase()}</td>
                  <td className="num">{j.attempts} attempt(s)</td>
                  <td className="mono">{j.lastErrorCode ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function ReportSlot({ reportType, view, disabled, onChanged }: { reportType: ReportType; view: VerificationStatusView; disabled: boolean; onChanged: () => void }) {
  const current = view.uploads.filter((u) => u.reportType === reportType && u.status !== "SUPERSEDED").at(-1);
  const [file, setFile] = useState<File | null>(null);
  const [active, setActive] = useState(false);
  const [attestHash, setAttestHash] = useState(false);
  const [attestSettings, setAttestSettings] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const presign = useCommand("POST", PresignedUploadSchema);
  const complete = useCommand("POST", ReportUploadSchema);
  const testId = reportType.toLowerCase().replace(/_/g, "-");

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setActive(false);
    const f = e.dataTransfer.files.item(0);
    if (f) setFile(f);
  };

  async function upload() {
    if (!file) return;
    setError(null);
    setStep("hashing");
    const bytes = await file.arrayBuffer();
    const sha256 = await sha256Hex(bytes);
    setStep("reserving upload");
    const slot = await presign.run(`/v1/tradingview-verifications/${view.verification.id}/uploads`, {
      reportType,
      fileName: file.name,
      contentType: "text/csv",
      sizeBytes: file.size,
      sha256,
    });
    if (!slot) return setStep(null);
    setStep("uploading");
    const put = await fetch(slot.url, { method: slot.method, headers: slot.headers, body: bytes }).catch(() => null);
    if (!put?.ok) {
      setStep(null);
      setError("upload to storage failed; try again");
      return;
    }
    setStep("verifying");
    const done = await complete.run(`/v1/tradingview-verifications/${view.verification.id}/uploads/complete`, {
      uploadId: slot.uploadId,
      attestedPineSourceHash: view.verification.pineSourceHash,
      attestedSettingsMatch: true,
    });
    setStep(null);
    if (done) {
      setFile(null);
      onChanged();
    }
  }

  return (
    <div className="stack" data-testid={`slot-${testId}`}>
      <div className="row spread">
        <strong>{LABEL[reportType]}</strong>
        {current ? (
          <span className="badge" data-testid={`upload-status-${testId}`}>
            {current.fileName} · {current.status.replace(/_/g, " ").toLowerCase()}
          </span>
        ) : (
          <span className="muted">not uploaded</span>
        )}
      </div>
      {current?.errorCode ? (
        <div className="notice bad">
          {current.errorCode}: {current.errorDetail}
        </div>
      ) : null}
      {current && current.warnings.length > 0 ? (
        <details>
          <summary>{current.warnings.length} parser warning(s)</summary>
          <ul>
            {current.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`} className="mono">
                {w.code}
                {w.row !== null ? ` row ${w.row}` : ""}: {w.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {disabled ? null : (
        <>
          <div
            className={`dropzone${active ? " active" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setActive(true);
            }}
            onDragLeave={() => setActive(false)}
            onDrop={onDrop}
          >
            <label>
              Drop the CSV here or choose a file
              <input type="file" accept=".csv,text/csv" data-testid={`file-${testId}`} onChange={(e) => setFile(e.target.files?.item(0) ?? null)} />
            </label>
            {file ? <div className="mono">{file.name} · {file.size} bytes</div> : null}
          </div>
          <label className="inline">
            <input type="checkbox" checked={attestHash} onChange={(e) => setAttestHash(e.target.checked)} data-testid={`attest-hash-${testId}`} /> The Pine source I ran has hash {view.verification.pineSourceHash.slice(0, 12)}…
          </label>
          <label className="inline">
            <input type="checkbox" checked={attestSettings} onChange={(e) => setAttestSettings(e.target.checked)} data-testid={`attest-settings-${testId}`} /> The chart settings matched the settings listed here
          </label>
          <ProblemInline problem={presign.problem ?? complete.problem} />
          <div className="row">
            <button type="button" disabled={!file || !attestHash || !attestSettings || step !== null} onClick={() => void upload()} data-testid={`upload-${testId}`}>
              Upload {LABEL[reportType]}
            </button>
            {step ? <span className="muted">{step}…</span> : null}
            {error ? <span className="tone-bad">{error}</span> : null}
          </div>
        </>
      )}
    </div>
  );
}
