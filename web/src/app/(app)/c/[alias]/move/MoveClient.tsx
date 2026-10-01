"use client";

import { useMemo, useState } from "react";
import MappingEditor, { completeRows, type MappingRow } from "@/components/MappingEditor";
import { ErrorBanner, usePrepare, type AccountOption } from "@/components/tools";

type Txn = {
  key: string;
  txnType: string;
  txnId: string;
  txnDate: string;
  docNum: string;
  name: string;
  className: string;
  amount: string;
  skipReason: string;
  accounts: string[];
  defaultToId: string;
};

export default function MoveClient({ alias, accounts }: { alias: string; accounts: AccountOption[] }) {
  const [rows, setRows] = useState<MappingRow[]>([{ fromId: "", toId: "" }]);
  const [mode, setMode] = useState<"all" | "pick">("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [includeReconciled, setIncludeReconciled] = useState(false);
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState("");
  const { prepare, busy, error } = usePrepare(alias);
  const pairs = completeRows(rows);
  const oldIds = new Set(pairs.map((p) => p.fromId));
  const destinations = accounts.filter((a) => a.active && !oldIds.has(a.id));

  async function find() {
    setFinding(true);
    setFindError("");
    try {
      const res = await fetch(`/api/c/${encodeURIComponent(alias)}/transactions`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pairs, start, end, includeReconciled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status}).`);
      setTxns(data.transactions);
      setChosen({});
      setTargets(Object.fromEntries((data.transactions as Txn[]).map((t) => [t.key, t.defaultToId])));
    } catch (e) {
      setFindError((e as Error).message);
    } finally {
      setFinding(false);
    }
  }

  const shown = useMemo(() => {
    const t = filter.trim().toLowerCase();
    return (txns ?? []).filter((x) => !t || [x.txnType, x.docNum, x.name, x.className, x.amount, x.txnDate, ...x.accounts].join(" ").toLowerCase().includes(t));
  }, [txns, filter]);
  const eligible = shown.filter((t) => !t.skipReason);
  const selected = (txns ?? []).filter((t) => chosen[t.key] && !t.skipReason);
  const allShownChosen = eligible.length > 0 && eligible.every((t) => chosen[t.key]);

  const changedMapping = () => setTxns(null); // a new mapping means the list must be found again

  return (
    <div className="grid gap-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="card card-pad grid min-w-0 gap-3">
          <div>
            <h2 className="section-title">1. Old account → new account</h2>
            <p className="mt-1 text-sm text-ink-muted">Each transaction&apos;s lines on an old account are switched to that row&apos;s new account. Class, location, name, amount, date and memo stay the same.</p>
          </div>
          <MappingEditor accounts={accounts} rows={rows} onChange={(r) => { setRows(r); changedMapping(); }} />
        </section>

        <section className="card card-pad grid h-fit gap-3">
          <h2 className="section-title">2. Which transactions</h2>
          <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-canvas p-1 text-sm font-semibold" role="tablist" aria-label="Mode">
            {(["all", "pick"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} className={`rounded-full px-3 py-1.5 ${mode === m ? "bg-white text-brand-dark shadow-card" : "text-ink-muted"}`} onClick={() => setMode(m)}>
                {m === "all" ? "All in date range" : "Pick transactions"}
              </button>
            ))}
          </div>
          <label className="field" htmlFor="start">From date (blank = all history)<input id="start" type="date" className="input" value={start} onChange={(e) => { setStart(e.target.value); changedMapping(); }} /></label>
          <label className="field" htmlFor="end">To date (blank = today)<input id="end" type="date" className="input" value={end} onChange={(e) => { setEnd(e.target.value); changedMapping(); }} /></label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 accent-brand" checked={includeReconciled} onChange={(e) => { setIncludeReconciled(e.target.checked); changedMapping(); }} />
            <span>Include reconciled transactions<span className="block text-xs text-ink-muted">This changes past reconciliations. Leave off unless you&apos;re sure.</span></span>
          </label>
          <div className="rounded border border-line bg-canvas p-3 text-xs text-ink-muted">
            Skipped automatically, with the reason shown: payroll and other types the API can&apos;t edit, and lines whose account comes from a product/service item. Closed-period transactions fail with QuickBooks&apos; own message.
          </div>
          <ErrorBanner message={error || findError} />
          {mode === "all" ? (
            <button className="btn-primary" disabled={busy || !pairs.length} onClick={() => prepare({ kind: "move", pairs, start, end, includeReconciled })}>
              {busy ? "Finding transactions..." : "Find and preview"}
            </button>
          ) : (
            <button className="btn-primary" disabled={finding || !pairs.length} onClick={find}>
              {finding ? "Finding transactions..." : txns ? "Find again" : "Find transactions"}
            </button>
          )}
        </section>
      </div>

      {mode === "pick" && txns && (
        <section className="card min-w-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <h2 className="section-title mr-2">3. Choose transactions</h2>
            <input className="input max-w-xs py-1.5" placeholder="Filter by type, number, name, class, amount" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter transactions" />
            <span className="text-xs text-ink-muted">{txns.length} found · {selected.length} chosen</span>
            <button
              className="btn-primary ml-auto"
              disabled={busy || !selected.length}
              onClick={() => prepare({ kind: "move", pairs, start, end, includeReconciled, selected: selected.map((t) => ({ key: t.key, toId: targets[t.key] || undefined })) })}
            >
              {busy ? "Preparing..." : `Preview ${selected.length} chosen`}
            </button>
          </div>
          <div className="max-h-[36rem] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-8">
                    <input type="checkbox" className="accent-brand" checked={allShownChosen} disabled={!eligible.length}
                      onChange={(e) => setChosen({ ...chosen, ...Object.fromEntries(eligible.map((t) => [t.key, e.target.checked])) })} aria-label="Choose all shown" />
                  </th>
                  <th>Date</th><th>Type</th><th>No.</th><th>Name</th><th>Class</th><th>Old account</th><th className="num">Amount</th><th>Move to</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.key} className={t.skipReason ? "text-ink-faint" : ""}>
                    <td><input type="checkbox" className="accent-brand" disabled={!!t.skipReason} checked={!!chosen[t.key]} onChange={(e) => setChosen({ ...chosen, [t.key]: e.target.checked })} aria-label={`Choose ${t.txnType} ${t.docNum || t.txnId}`} /></td>
                    <td className="whitespace-nowrap">{t.txnDate}</td>
                    <td className="whitespace-nowrap">{t.txnType}</td>
                    <td>{t.docNum}</td>
                    <td>{t.name}</td>
                    <td>{t.className}</td>
                    <td className="text-xs">{t.accounts.join(", ")}</td>
                    <td className="num">{t.amount}</td>
                    <td className="min-w-[13rem]">
                      {t.skipReason ? (
                        <span className="text-xs text-warn">{t.skipReason}</span>
                      ) : (
                        <select className="input py-1" value={targets[t.key] ?? ""} onChange={(e) => setTargets({ ...targets, [t.key]: e.target.value })} aria-label={`New account for ${t.txnType} ${t.docNum || t.txnId}`}>
                          {destinations.map((a) => <option key={a.id} value={a.id}>{a.number ? `${a.number} ` : ""}{a.name}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={9} className="py-6 text-center text-ink-muted">No transactions match.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
