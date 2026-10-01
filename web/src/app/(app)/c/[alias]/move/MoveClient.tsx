"use client";

import { useState } from "react";
import { AccountPicker, AccountSelect, ErrorBanner, usePrepare, type AccountOption } from "@/components/tools";

export default function MoveClient({ alias, accounts }: { alias: string; accounts: AccountOption[] }) {
  const [fromIds, setFromIds] = useState<string[]>([]);
  const [toId, setToId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [includeReconciled, setIncludeReconciled] = useState(false);
  const { prepare, busy, error } = usePrepare(alias);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="card card-pad grid min-w-0 gap-4">
        <h2 className="section-title">1. Old accounts</h2>
        <AccountPicker label="Move transactions out of" accounts={accounts.filter((a) => a.active)} selected={fromIds} onChange={setFromIds} exclude={toId ? [toId] : []} />
        <h2 className="section-title">2. New account</h2>
        <AccountSelect id="move-to" label="Move them into" accounts={accounts} value={toId} onChange={setToId} exclude={fromIds} />
      </section>
      <section className="card card-pad grid h-fit gap-3">
        <h2 className="section-title">3. Which transactions</h2>
        <label className="field" htmlFor="start">From date (blank = all history)<input id="start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field" htmlFor="end">To date (blank = today)<input id="end" type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 accent-brand" checked={includeReconciled} onChange={(e) => setIncludeReconciled(e.target.checked)} />
          <span>Include reconciled transactions<span className="block text-xs text-ink-muted">This changes past reconciliations. Leave off unless you&apos;re sure.</span></span>
        </label>
        <div className="rounded border border-line bg-canvas p-3 text-xs text-ink-muted">
          Skipped automatically, with the reason shown: payroll and other types the API can&apos;t edit, and lines whose account comes from a product/service item. Closed-period transactions fail with QuickBooks&apos; own message.
        </div>
        <ErrorBanner message={error} />
        <button className="btn-primary" disabled={busy || !fromIds.length || !toId} onClick={() => prepare({ kind: "move", fromIds, toId, start, end, includeReconciled })}>
          {busy ? "Finding transactions..." : "Find and preview"}
        </button>
      </section>
    </div>
  );
}
