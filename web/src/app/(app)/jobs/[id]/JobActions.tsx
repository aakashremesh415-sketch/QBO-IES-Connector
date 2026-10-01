"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Props = {
  jobId: string;
  status: string;
  alias: string;
  ready: number;
  canConfirm: boolean;
  reason: string;
  canCancel: boolean;
  reverse: { journalId: string } | null;
};

async function post(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status}).`);
  return data;
}

export default function JobActions({ jobId, status, alias, ready, canConfirm, reason, canCancel, reverse }: Props) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Record<string, number> | null>(null);
  const [revDate, setRevDate] = useState(new Date().toISOString().slice(0, 10));
  const running = useRef(false);

  // Keep stepping a running job until it finishes, even after a page reload.
  async function runLoop() {
    if (running.current) return;
    running.current = true;
    setError("");
    try {
      for (;;) {
        const r = await post(`/api/jobs/${jobId}/step`);
        setProgress(r.counts);
        if (r.status !== "RUNNING") break;
        if (r.busy) await new Promise((res) => setTimeout(res, 2000));
      }
    } catch (e) {
      setError(`${(e as Error).message} Reload the page to continue.`);
    } finally {
      running.current = false;
      router.refresh();
    }
  }

  useEffect(() => {
    if (status === "RUNNING") runLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await post(`/api/jobs/${jobId}/confirm`, { alias: typed });
      router.refresh();
      runLoop();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await post(`/api/jobs/${jobId}/cancel`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function prepareReverse() {
    setBusy(true);
    setError("");
    try {
      const r = await post(`/api/c/${encodeURIComponent(alias)}/prepare`, { kind: "reverse", journalId: reverse!.journalId, date: revDate });
      router.push(`/jobs/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (status === "PREVIEW") {
    return (
      <section className="card card-pad mb-5 grid gap-3 border-brand">
        <h2 className="section-title">Confirm these changes</h2>
        {ready === 0 ? (
          <p className="text-sm text-ink-muted">Nothing in this preview is ready to run. Fix the errors below and prepare it again.</p>
        ) : canConfirm ? (
          <>
            <p className="text-sm">
              {ready} item{ready === 1 ? "" : "s"} will be saved to QuickBooks. Items marked Error or Skipped are left out.
              To go ahead, type the company alias <code className="rounded bg-canvas px-1 font-mono font-bold">{alias}</code>.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input id="confirm-alias" className="input w-56" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={alias} autoComplete="off" aria-label="Company alias" onKeyDown={(e) => e.key === "Enter" && typed === alias && confirm()} />
              <button className="btn-primary" disabled={busy || typed !== alias} onClick={confirm}>{busy ? "Starting..." : "Confirm and run"}</button>
              {canCancel && <button className="btn-secondary" disabled={busy} onClick={cancel}>Cancel preview</button>}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink-muted">{reason}</p>
            {canCancel && <button className="btn-secondary btn-sm" disabled={busy} onClick={cancel}>Cancel preview</button>}
          </div>
        )}
        {error && <div className="banner-bad" role="alert">{error}</div>}
      </section>
    );
  }

  if (status === "RUNNING") {
    const total = progress ? Object.values(progress).reduce((a, b) => a + b, 0) : 0;
    const done = progress ? (progress.DONE ?? 0) + (progress.FAILED ?? 0) + (progress.SKIPPED ?? 0) + (progress.ERROR ?? 0) : 0;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return (
      <section className="card card-pad mb-5 grid gap-2">
        <div className="flex items-center justify-between"><h2 className="section-title">Saving to QuickBooks...</h2><span className="text-sm tabular-nums">{pct}%</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} /></div>
        <p className="text-xs text-ink-muted">Keep this page open. If you close it, open it again to continue from where it stopped.</p>
        {error && <div className="banner-bad" role="alert">{error}</div>}
      </section>
    );
  }

  if (reverse) {
    return (
      <section className="card card-pad mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="section-title">Need to undo it?</h2>
          <p className="text-sm text-ink-muted">Prepare a reversing entry for journal entry Id {reverse.journalId}. You&apos;ll see a preview before anything is posted.</p>
        </div>
        <label className="field" htmlFor="rev-date">Reversal date<input id="rev-date" type="date" className="input" value={revDate} onChange={(e) => setRevDate(e.target.value)} /></label>
        <button className="btn-secondary" disabled={busy} onClick={prepareReverse}>Prepare reversal</button>
        {error && <div className="banner-bad w-full" role="alert">{error}</div>}
      </section>
    );
  }
  return null;
}
