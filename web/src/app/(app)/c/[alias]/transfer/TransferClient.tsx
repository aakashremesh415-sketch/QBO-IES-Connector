"use client";

import { useState } from "react";
import MappingEditor, { completeRows, type MappingRow } from "@/components/MappingEditor";
import { ErrorBanner, usePrepare, type AccountOption } from "@/components/tools";

export default function TransferClient({ alias, accounts, today }: { alias: string; accounts: AccountOption[]; today: string }) {
  const [rows, setRows] = useState<MappingRow[]>([{ fromId: "", toId: "" }]);
  const [asOf, setAsOf] = useState(today);
  const [date, setDate] = useState("");
  const [plStart, setPlStart] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [useFile, setUseFile] = useState(false);
  const [amountsCsv, setAmountsCsv] = useState("");
  const { prepare, busy, error } = usePrepare(alias);
  const pairs = completeRows(rows);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const hasPl = pairs.some((p) => ["Revenue", "Expense"].includes(byId.get(p.fromId)?.classification ?? ""));
  const incomplete = rows.some((r) => (r.fromId && !r.toId) || (!r.fromId && r.toId));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="card card-pad grid min-w-0 gap-3">
        <div>
          <h2 className="section-title">1. Old account → new account</h2>
          <p className="mt-1 text-sm text-ink-muted">
            One row per old account. Each can go to its own new account, or several can share one. Everything is posted as a single
            compound journal entry, keeping each class, location and customer/vendor.
          </p>
        </div>
        <MappingEditor accounts={accounts} rows={rows} onChange={setRows} />
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
  );
}
