"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Prepares an undo as a new preview; nothing changes in QuickBooks until that is confirmed. */
export default function UndoButton({ jobId, count }: { jobId: string; count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/jobs/${jobId}/undo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't prepare the undo.");
      router.push(`/jobs/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="card card-pad mb-5 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="section-title">Need to undo it?</h2>
        <p className="text-sm text-ink-muted">
          Prepare an undo for the {count} change{count === 1 ? "" : "s"} that went through. You&apos;ll review it as a preview first; nothing is
          changed until you confirm. Anything edited in QuickBooks since is left alone.
        </p>
      </div>
      <button className="btn-secondary" disabled={busy} onClick={go}>{busy ? "Preparing..." : "Prepare undo"}</button>
      {error && <div className="banner-bad w-full" role="alert">{error}</div>}
    </section>
  );
}
