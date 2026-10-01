"use client";

import { useEffect, useMemo, useState } from "react";
import { fmt } from "@/lib/logic/money";

export type TBRow = { id: string; name: string; debit: number; credit: number };

/** Trial Balance as of a date, for reference. Clicking an account hands it to `onPick`. */
export default function TrialBalance({
  alias, asOf, highlight, onLoaded, onPick,
}: {
  alias: string;
  asOf: string;
  highlight: Set<string>;
  onLoaded?: (rows: TBRow[]) => void;
  onPick?: (accountId: string) => void;
}) {
  const [rows, setRows] = useState<TBRow[] | null>(null);
  const [totals, setTotals] = useState({ d: 0, c: 0 });
  const [method, setMethod] = useState<"Accrual" | "Cash">("Accrual");
  const [q, setQ] = useState("");
  const [onlyMapped, setOnlyMapped] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/c/${encodeURIComponent(alias)}/trial-balance?asOf=${asOf}&method=${method}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? "Couldn't load the trial balance.");
        if (cancelled) return;
        setRows(data.rows);
        setTotals({ d: data.totalDebit, c: data.totalCredit });
        onLoaded?.(data.rows);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alias, asOf, method]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!onlyMapped || highlight.has(r.id)) && (!t || r.name.toLowerCase().includes(t)));
  }, [rows, q, onlyMapped, highlight]);

  return (
    <section className="card min-w-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <button className="section-title flex items-center gap-2" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="text-ink-faint">{open ? "▾" : "▸"}</span> Trial balance as of {asOf}
        </button>
        {loading && <span className="text-xs text-ink-muted">Loading...</span>}
        {open && (
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <select className="input w-auto py-1" value={method} onChange={(e) => setMethod(e.target.value as "Accrual" | "Cash")} aria-label="Accounting method">
              <option value="Accrual">Accrual</option>
              <option value="Cash">Cash</option>
            </select>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-brand" checked={onlyMapped} onChange={(e) => setOnlyMapped(e.target.checked)} /> Only accounts in my mapping</label>
            <input className="input w-52 py-1" placeholder="Find an account" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find in trial balance" />
          </div>
        )}
      </div>
      {open && (
        <>
          {error && <div className="banner-bad m-4" role="alert">{error}</div>}
          <div className="max-h-[26rem] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 z-10"><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th>{onPick && <th></th>}</tr></thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={`${r.id}-${i}`} className={highlight.has(r.id) ? "bg-brand-light/60" : ""}>
                    <td>{r.name}{highlight.has(r.id) && <span className="pill-ok ml-2">In mapping</span>}</td>
                    <td className="num">{r.debit ? fmt(r.debit) : ""}</td>
                    <td className="num">{r.credit ? fmt(r.credit) : ""}</td>
                    {onPick && <td className="w-28 whitespace-nowrap text-right">{r.id && !highlight.has(r.id) && <button className="btn-secondary btn-sm whitespace-nowrap" onClick={() => onPick(r.id)}>Add as old</button>}</td>}
                  </tr>
                ))}
                {rows && !shown.length && <tr><td colSpan={onPick ? 4 : 3} className="py-6 text-center text-ink-muted">No accounts match.</td></tr>}
              </tbody>
              {rows && (
                <tfoot>
                  <tr className="font-bold">
                    <td className="border-t-2 border-ink px-3 py-2">Total{q || onlyMapped ? " (all accounts)" : ""}</td>
                    <td className="num border-t-2 border-ink px-3 py-2">{fmt(totals.d)}</td>
                    <td className="num border-t-2 border-ink px-3 py-2">{fmt(totals.c)}</td>
                    {onPick && <td className="border-t-2 border-ink"></td>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </section>
  );
}
