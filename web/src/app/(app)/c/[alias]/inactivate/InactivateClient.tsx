"use client";

import { useState } from "react";
import { AccountPicker, ErrorBanner, money, usePrepare, type AccountOption } from "@/components/tools";

const BS = ["Asset", "Liability", "Equity"];

export default function InactivateClient({ alias, accounts }: { alias: string; accounts: AccountOption[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const { prepare, busy, error } = usePrepare(alias);
  const chosen = accounts.filter((a) => selected.includes(a.id));
  const blocked = chosen.filter((a) => BS.includes(a.classification) && a.balance !== 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="card card-pad min-w-0">
        <AccountPicker label="Active accounts" accounts={accounts} selected={selected} onChange={setSelected} height="32rem" />
      </section>
      <section className="card card-pad grid h-fit gap-3">
        <h2 className="section-title">Selected</h2>
        {chosen.length ? (
          <ul className="grid gap-1 text-sm">
            {chosen.map((a) => (
              <li key={a.id} className="flex justify-between gap-2">
                <span className="truncate">{a.name}</span>
                {BS.includes(a.classification) && a.balance !== 0 ? <span className="pill-bad">{money(a.balance)}</span> : <span className="pill-ok">OK</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-muted">Nothing selected yet.</p>}
        {blocked.length > 0 && <div className="banner-warn text-xs">{blocked.length} account(s) still have a balance and will be refused. Move their balance first.</div>}
        <ErrorBanner message={error} />
        <button className="btn-primary" disabled={busy || !selected.length} onClick={() => prepare({ kind: "inactivate", accountIds: selected })}>
          {busy ? "Checking..." : "Check and preview"}
        </button>
      </section>
    </div>
  );
}
