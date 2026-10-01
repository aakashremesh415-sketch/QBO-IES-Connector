"use client";

import { useMemo, useState } from "react";
import { csvRecords } from "@/lib/logic/csv";
import { shareWith, sharedFullName } from "@/lib/logic/shared";

const SAMPLE = `name,acct_num,account_type,detail_type,parent,description,share_with
Rent Expense - Combined,6105,Expense,RentOrLeaseOfBuildings,,All rent in one account,us-parent;uk-entity
Intercompany Receivable,1450,Other Current Asset,OtherCurrentAssets,,,us-parent;uk-entity
`;

type Result = { account: string; alias: string; status: string; note: string };

const STATUS: Record<string, [string, string]> = {
  present: ["pill-ok", "Present"],
  missing: ["pill-bad", "Missing"],
  inactive: ["pill-warn", "Inactive"],
  mismatch: ["pill-warn", "Number differs"],
  unchecked: ["pill-grey", "Not checked"],
};

export default function SharedClient({ aliases }: { aliases: string[] }) {
  const [csv, setCsv] = useState("");
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => csvRecords(csv).records.filter((r) => r.name), [csv]);
  const unknown = [...new Set(rows.flatMap(shareWith))].filter((a) => !aliases.includes(a));

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setCsv(await f.text());
  }

  async function verify() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/shared/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Check failed.");
      setResults(data.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const cols = [...new Set(rows.flatMap(shareWith))];
  const cell = (account: string, alias: string) => results?.find((r) => r.account === account && r.alias === alias);
  const good = results?.filter((r) => r.status === "present").length ?? 0;

  return (
    <div className="grid gap-5">
      <section className="card card-pad grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="section-title mr-auto">Your shared accounts spreadsheet</h2>
          <label className="btn-secondary btn-sm cursor-pointer">Upload CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} /></label>
          <button className="btn-secondary btn-sm" onClick={() => setCsv(SAMPLE)}>Use example</button>
        </div>
        <textarea id="shared-csv" className="textarea min-h-[8rem]" value={csv} onChange={(e) => { setCsv(e.target.value); setResults(null); }} placeholder={SAMPLE} spellCheck={false} aria-label="Shared accounts CSV" />
        <p className="text-xs text-ink-muted">share_with lists company aliases separated by ;. Your companies: {aliases.join(", ") || "none"}.</p>
        {unknown.length > 0 && <div className="banner-warn text-xs">Not one of your companies: {unknown.join(", ")}. Those can&apos;t be checked.</div>}
      </section>

      {rows.length > 0 && (
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="card card-pad grid content-start gap-3">
            <h2 className="section-title">1. Do this in Consolidated View</h2>
            <ol className="grid list-decimal gap-1 pl-5 text-sm">
              <li>Switch to <b>Consolidated View</b>.</li>
              <li>Open <b>Chart of accounts</b> and select <b>New</b> (or <b>Edit</b> an existing account).</li>
              <li>Fill in the details, select <b>Share with companies</b>, tick each company listed, and save.</li>
            </ol>
            <ul className="grid gap-2">
              {rows.map((r, i) => (
                <li key={i} className="flex gap-3 rounded border border-line p-3">
                  <input type="checkbox" className="mt-1 accent-brand" checked={!!done[i]} onChange={(e) => setDone({ ...done, [i]: e.target.checked })} aria-label={`Done: ${r.name}`} />
                  <div className={`text-sm ${done[i] ? "text-ink-faint line-through" : ""}`}>
                    <div className="font-semibold">{[r.acct_num, sharedFullName(r)].filter(Boolean).join(" ")}</div>
                    <div className="text-xs text-ink-muted">{[r.account_type, r.detail_type, r.description].filter(Boolean).join(" · ")}</div>
                    <div className="mt-1 text-xs">Share with: <b>{shareWith(r).join(", ") || "(none listed)"}</b></div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card card-pad grid content-start gap-3">
            <div className="flex items-center gap-2">
              <h2 className="section-title mr-auto">2. Check every company</h2>
              <button className="btn-primary btn-sm" disabled={busy} onClick={verify}>{busy ? "Checking..." : "Run check"}</button>
            </div>
            <p className="text-xs text-ink-muted">Read-only: signs in to each company and looks for each account by name and number.</p>
            {error && <div className="banner-bad" role="alert">{error}</div>}
            {results && (
              <>
                <div className={good === results.length ? "banner-ok" : "banner-warn"}>{good} of {results.length} account/company pairs look right.</div>
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead><tr><th>Account</th>{cols.map((c) => <th key={c} className="text-center">{c}</th>)}</tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td>{sharedFullName(r)}</td>
                          {cols.map((c) => {
                            if (!shareWith(r).includes(c)) return <td key={c} className="text-center text-xs text-ink-faint">not shared</td>;
                            const x = cell(sharedFullName(r), c);
                            const [cls, label] = STATUS[x?.status ?? "unchecked"];
                            return <td key={c} className="text-center"><span className={cls} title={x?.note}>{label}</span></td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
