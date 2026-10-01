"use client";

import { useState } from "react";
import { AccountPicker, AccountSelect, ErrorBanner, money, usePrepare, type AccountOption } from "@/components/tools";

export default function TransferClient({ alias, accounts, today }: { alias: string; accounts: AccountOption[]; today: string }) {
  const [fromIds, setFromIds] = useState<string[]>([]);
  const [toId, setToId] = useState("");
  const [asOf, setAsOf] = useState(today);
  const [date, setDate] = useState("");
  const [plStart, setPlStart] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [useFile, setUseFile] = useState(false);
  const [amountsCsv, setAmountsCsv] = useState("");
  const { prepare, busy, error } = usePrepare(alias);
  const from = accounts.filter((a) => fromIds.includes(a.id));
  const hasPl = from.some((a) => a.classification === "Revenue" || a.classification === "Expense");
  const parents = from.filter((a) => a.isParent);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="card card-pad grid min-w-0 gap-4">
        <h2 className="section-title">1. Move balances from</h2>
        <AccountPicker label="Old accounts" accounts={accounts.filter((a) => a.active)} selected={fromIds} onChange={setFromIds} exclude={toId ? [toId] : []} />
        {parents.length > 0 && <div className="banner-warn text-xs">{parents.map((p) => p.name).join(", ")} {parents.length > 1 ? "have" : "has"} sub-accounts. Select each sub-account too, or the preview will be refused.</div>}
        <h2 className="section-title">2. Into</h2>
        <AccountSelect id="to-account" label="New account" accounts={accounts} value={toId} onChange={setToId} exclude={fromIds} />
      </section>

      <section className="card card-pad grid h-fit gap-3">
        <h2 className="section-title">3. Entry details</h2>
        <label className="field" htmlFor="as-of">Balances as of<input id="as-of" type="date" className="input" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        <label className="field" htmlFor="je-date">Journal date (blank = same as above)<input id="je-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {hasPl && <label className="field" htmlFor="pl-start">Income/expense activity from (blank = fiscal year start)<input id="pl-start" type="date" className="input" value={plStart} onChange={(e) => setPlStart(e.target.value)} /></label>}
        <label className="field" htmlFor="doc-no">Journal no.<input id="doc-no" className="input" maxLength={21} value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="e.g. RECLASS-0930" /></label>
        <label className="field" htmlFor="memo">Memo<input id="memo" className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Combine rent accounts" /></label>

        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={useFile} onChange={(e) => setUseFile(e.target.checked)} /> Type the amounts myself instead of reading the ledger</label>
        {useFile && (
          <div className="grid gap-2">
            <textarea id="amounts" className="textarea min-h-[9rem]" value={amountsCsv} onChange={(e) => setAmountsCsv(e.target.value)} placeholder={"from_account,class,location,customer_or_vendor,amount\nOld Rent 1,East,,,1200.00"} aria-label="Amounts CSV" />
            <p className="text-xs text-ink-muted">amount is the balance in the account&apos;s normal direction: a normal balance is positive.</p>
          </div>
        )}

        {from.length > 0 && (
          <div className="rounded border border-line bg-canvas p-3 text-xs">
            <div className="mb-1 font-semibold">QuickBooks balances today</div>
            {from.map((a) => <div key={a.id} className="flex justify-between gap-2"><span className="truncate">{a.name}</span><span className="tabular-nums">{money(a.balance)}</span></div>)}
            <p className="mt-2 text-ink-muted">The preview uses the ledger as of the date above, split by class.</p>
          </div>
        )}
        <ErrorBanner message={error} />
        <button
          className="btn-primary"
          disabled={busy || !fromIds.length || !toId || !asOf || (useFile && !amountsCsv.trim())}
          onClick={() => prepare({ kind: "transfer", fromIds, toId, asOf, date, plStart, docNumber, memo, amountsCsv: useFile ? amountsCsv : "" })}
        >
          {busy ? "Reading the ledger..." : "Preview journal entry"}
        </button>
      </section>
    </div>
  );
}
