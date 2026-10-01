"use client";

import { useMemo, useState } from "react";
import { ErrorBanner, money, usePrepare, type AccountOption } from "@/components/tools";

const TEMPLATE = `action,account,name,acct_num,account_type,detail_type,description,parent
create,,Facilities,6200,Expense,RentOrLeaseOfBuildings,Parent for facility costs,
create,,Utilities,6210,Expense,Utilities,Power and water,Facilities
update,6100,Office Rent,,,,Head office rent,
inactivate,Old Utilities,,,,,,
reactivate,Old Marketing,,,,,,
`;

export default function AccountsClient({ alias, accounts }: { alias: string; accounts: AccountOption[] }) {
  const [csv, setCsv] = useState("");
  const [source, setSource] = useState("pasted CSV");
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const { prepare, busy, error } = usePrepare(alias);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return accounts.filter((a) => (showInactive || a.active) && (!t || a.name.toLowerCase().includes(t) || a.number.includes(t) || a.type.toLowerCase().includes(t)));
  }, [accounts, q, showInactive]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2_000_000) return alert("That file is over 2 MB. Split it into smaller files.");
    setCsv(await f.text());
    setSource(f.name);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <section className="card min-w-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <input className="input max-w-xs" placeholder="Filter by name, number or type" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter accounts" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Include inactive</label>
          <span className="ml-auto text-xs text-ink-muted">{shown.length} of {accounts.length} accounts</span>
        </div>
        <div className="max-h-[38rem] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0"><tr><th>Number</th><th>Name</th><th>Type</th><th>Detail</th><th className="num">QuickBooks balance</th></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} className={a.active ? "" : "text-ink-faint"}>
                  <td className="text-ink-muted">{a.number}</td>
                  <td style={{ paddingLeft: `${0.75 + (a.name.split(":").length - 1) * 1.25}rem` }}>
                    {a.name.split(":").pop()}
                    {!a.active && <span className="pill-grey ml-2">Inactive</span>}
                  </td>
                  <td>{a.type}</td>
                  <td className="text-ink-muted">{a.classification}</td>
                  <td className="num">{money(a.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card card-pad grid h-fit gap-3">
        <div>
          <h2 className="section-title">Bulk changes</h2>
          <p className="mt-1 text-sm text-ink-muted">One row per change. <code>action</code> is create, update, inactivate or reactivate. For updates, blank cells stay as they are.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary btn-sm cursor-pointer">Upload CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} /></label>
          <button type="button" className="btn-secondary btn-sm" onClick={() => { setCsv(TEMPLATE); setSource("template"); }}>Start from template</button>
        </div>
        <textarea id="plan-csv" className="textarea min-h-[16rem]" spellCheck={false} value={csv} onChange={(e) => { setCsv(e.target.value); setSource("pasted CSV"); }} placeholder={TEMPLATE} aria-label="Plan CSV" />
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer font-semibold text-ink">Column guide</summary>
          <ul className="mt-2 grid gap-1">
            <li><b>account</b>: existing account, as a full name (Parent:Child), number, or id:123. Blank for create.</li>
            <li><b>name</b>: name for a new account, or the new name when renaming.</li>
            <li><b>account_type</b>: required for create, e.g. Expense, Bank, Other Current Asset, Income.</li>
            <li><b>detail_type</b>: Intuit&apos;s detail type code, e.g. Utilities. Optional.</li>
            <li><b>parent</b>: makes it a sub-account; can be created earlier in the same file. (top level) moves it out.</li>
            <li>Balance sheet accounts must have a zero balance before they can be made inactive.</li>
          </ul>
        </details>
        <ErrorBanner message={error} />
        <button className="btn-primary" disabled={busy || !csv.trim()} onClick={() => prepare({ kind: "accounts", csv, source })}>
          {busy ? "Checking..." : "Check and preview"}
        </button>
      </section>
    </div>
  );
}
