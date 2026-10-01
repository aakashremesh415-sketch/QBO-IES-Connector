"use client";

import { useMemo, useState } from "react";
import TrialBalance, { type TBRow } from "@/components/TrialBalance";
import MappingEditor, { completeRows, type MappingRow } from "@/components/MappingEditor";
import { ErrorBanner, usePrepare, type AccountOption } from "@/components/tools";
import type { Prefill } from "@/lib/jobs/prefill";

export default function TransferClient({ alias, accounts, today, prefill }: { alias: string; accounts: AccountOption[]; today: string; prefill: Prefill | null }) {
  const [rows, setRows] = useState<MappingRow[]>(prefill?.pairs.length ? prefill.pairs : [{ fromId: "", toId: "" }]);
  const [asOf, setAsOf] = useState(prefill?.asOf ?? today);
  const [date, setDate] = useState(prefill?.date ?? "");
  const [plStart, setPlStart] = useState(prefill?.plStart ?? "");
  const [docNumber, setDocNumber] = useState(prefill?.docNumber ?? "");
  const [memo, setMemo] = useState(prefill?.memo ?? "");
  const [useFile, setUseFile] = useState(false);
  const [amountsCsv, setAmountsCsv] = useState("");
  const { prepare, busy, error } = usePrepare(alias, prefill?.replaces);
  const [tb, setTb] = useState<TBRow[]>([]);
  const tbNet = useMemo(() => new Map(tb.filter((r) => r.id).map((r) => [r.id, r.debit - r.credit])), [tb]);
  const inMapping = useMemo(() => new Set(rows.flatMap((r) => [r.fromId, r.toId]).filter(Boolean)), [rows]);
  const addOld = (id: string) => {
    const blank = rows.findIndex((r) => !r.fromId);
    setRows(blank >= 0 ? rows.map((r, i) => (i === blank ? { ...r, fromId: id } : r)) : [...rows, { fromId: id, toId: "" }]);
  };
  const pairs = completeRows(rows);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const hasPl = pairs.some((p) => ["Revenue", "Expense"].includes(byId.get(p.fromId)?.classification ?? ""));
  const incomplete = rows.some((r) => (r.fromId && !r.toId) || (!r.fromId && r.toId));

  return (
    <div className="grid gap-5">
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      {prefill && (
        <div className="banner-info xl:col-span-2">
          <span>
            Filled in from your earlier preview. Change anything, then preview again{prefill.replaces ? "; the earlier preview will be cancelled" : ""}.
            {prefill.amountsUsed && " The amounts you typed last time weren't kept, so paste them again if you need them."}
          </span>
        </div>
      )}
      <section className="card card-pad grid h-fit min-w-0 content-start gap-3">
        <div>
          <h2 className="section-title">1. Old account → new account</h2>
          <p className="mt-1 text-sm text-ink-muted">
            One row per old account. Each can go to its own new account, or several can share one. Everything is posted as a single
            compound journal entry, keeping each class, location and customer/vendor.
          </p>
        </div>
        <MappingEditor accounts={accounts} rows={rows} onChange={setRows} balances={tb.length ? tbNet : undefined} balanceLabel={`TB ${asOf}`} />
      </section>

      <section className="card card-pad grid h-fit gap-3">
        <h2 className="section-title">2. Entry details</h2>
        <label className="field" htmlFor="as-of">Balances as of<input id="as-of" type="date" className="input" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        <label className="field" htmlFor="je-date">Journal date (blank = same as above)<input id="je-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {hasPl && <label className="field" htmlFor="pl-start">Income/expense activity from (blank = fiscal year start)<input id="pl-start" type="date" className="input" value={plStart} onChange={(e) => setPlStart(e.target.value)} /></label>}
        <label className="field" htmlFor="doc-no">Journal no.<input id="doc-no" className="input" maxLength={21} value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="e.g. RECLASS-0930" /></label>
        <label className="field" htmlFor="memo">Memo<input id="memo" className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Chart of accounts clean-up" /></label>

        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={useFile} onChange={(e) => setUseFile(e.target.checked)} /> Type the amounts myself instead of reading the ledger</label>
        {useFile && (
          <div className="grid gap-2">
            <textarea id="amounts" className="textarea min-h-[9rem]" value={amountsCsv} onChange={(e) => setAmountsCsv(e.target.value)} placeholder={"from_account,class,location,customer_or_vendor,amount\nOld Rent 1,East,,,1200.00"} aria-label="Amounts CSV" />
            <p className="text-xs text-ink-muted">Each from_account must be an old account in the mapping. amount is the balance in the account&apos;s normal direction: a normal balance is positive.</p>
          </div>
        )}
        {incomplete && <div className="banner-warn text-xs">Some rows have only one side filled in. They&apos;re ignored until both are chosen.</div>}
        <ErrorBanner message={error} />
        <button
          className="btn-primary"
          disabled={busy || !pairs.length || !asOf || (useFile && !amountsCsv.trim())}
          onClick={() => prepare({ kind: "transfer", pairs, asOf, date, plStart, docNumber, memo, amountsCsv: useFile ? amountsCsv : "" })}
        >
          {busy ? "Reading the ledger..." : `Preview journal entry${pairs.length ? ` (${pairs.length} row${pairs.length > 1 ? "s" : ""})` : ""}`}
        </button>
      </section>
    </div>
    <TrialBalance alias={alias} asOf={asOf} highlight={inMapping} onLoaded={setTb} onPick={addOld} />
    </div>
  );
}