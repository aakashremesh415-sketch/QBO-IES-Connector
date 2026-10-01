"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { parseCsv } from "@/lib/logic/csv";
import { money, type AccountOption } from "./tools";

export type MappingRow = { fromId: string; toId: string };

const label = (a: AccountOption) => `${a.number ? `${a.number} ` : ""}${a.name}`;

/** Find an account by number, full name or short name, the same way the CSV tools do. */
function findAccount(accounts: AccountOption[], text: string): AccountOption | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const tries = [
    accounts.filter((a) => a.number && a.number.toLowerCase() === t),
    accounts.filter((a) => a.name.toLowerCase() === t),
    accounts.filter((a) => a.name.split(":").pop()!.toLowerCase() === t),
  ];
  for (const hits of tries) if (hits.length === 1) return hits[0];
  return null;
}

/**
 * Old account -> new account table. Each old account gets its own new account; several old
 * accounts may share one. Rows can be typed in, set in bulk, or pasted as "old,new" lines.
 */
export default function MappingEditor({
  accounts, rows, onChange, oldLabel = "Old account", newLabel = "New account",
}: {
  accounts: AccountOption[];
  rows: MappingRow[];
  onChange: (rows: MappingRow[]) => void;
  oldLabel?: string;
  newLabel?: string;
}) {
  const [paste, setPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");
  const active = accounts.filter((a) => a.active);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const usedFrom = new Set(rows.map((r) => r.fromId).filter(Boolean));
  const usedTo = new Set(rows.map((r) => r.toId).filter(Boolean));

  const set = (i: number, patch: Partial<MappingRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ fromId: "", toId: "" }]);

  function applyPaste() {
    const out: MappingRow[] = [];
    const problems: string[] = [];
    parseCsv(pasteText).forEach((cells, i) => {
      const [oldText = "", newText = ""] = cells.map((c) => c.trim());
      if (i === 0 && /old|from/i.test(oldText) && /new|to/i.test(newText)) return; // header row
      const from = findAccount(active, oldText);
      const to = findAccount(active, newText);
      if (!from || !to) problems.push(`Line ${i + 1}: couldn't find ${!from ? `'${oldText}'` : `'${newText}'`}`);
      else out.push({ fromId: from.id, toId: to.id });
    });
    if (out.length) onChange([...rows.filter((r) => r.fromId || r.toId), ...out]);
    setPasteMsg(problems.length ? `${out.length} row(s) added. ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? "..." : ""}` : `${out.length} row(s) added.`);
    if (!problems.length) {
      setPasteText("");
      setPaste(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto rounded border border-line">
        <table className="tbl">
          <thead>
            <tr><th>{oldLabel}</th><th className="num">Balance</th><th aria-hidden></th><th>{newLabel}</th><th aria-hidden></th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const from = byId.get(r.fromId);
              const chained = r.toId && usedFrom.has(r.toId);
              return (
                <tr key={i}>
                  <td className="min-w-[14rem]">
                    <select className="input py-1.5" value={r.fromId} onChange={(e) => set(i, { fromId: e.target.value })} aria-label={`${oldLabel}, row ${i + 1}`}>
                      <option value="">Choose an account</option>
                      {active.filter((a) => a.id === r.fromId || (!usedFrom.has(a.id) && !usedTo.has(a.id))).map((a) => (
                        <option key={a.id} value={a.id}>{label(a)}</option>
                      ))}
                    </select>
                    {from?.isParent && <div className="mt-1 text-xs text-warn">Has sub-accounts: add each sub-account as its own row.</div>}
                  </td>
                  <td className="num text-ink-muted">{from ? money(from.balance) : ""}</td>
                  <td className="text-center text-ink-faint" aria-hidden>→</td>
                  <td className="min-w-[14rem]">
                    <select className="input py-1.5" value={r.toId} onChange={(e) => set(i, { toId: e.target.value })} aria-label={`${newLabel}, row ${i + 1}`}>
                      <option value="">Choose an account</option>
                      {active.filter((a) => a.id !== r.fromId && (a.id === r.toId || !usedFrom.has(a.id))).map((a) => (
                        <option key={a.id} value={a.id}>{label(a)} · {a.type}</option>
                      ))}
                    </select>
                    {chained && <div className="mt-1 text-xs text-bad">This account is also an old account in another row.</div>}
                  </td>
                  <td className="w-10">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => remove(i)} aria-label={`Remove row ${i + 1}`}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={() => onChange([...rows, { fromId: "", toId: "" }])}>Add row</button>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setPaste(!paste)}>{paste ? "Close paste" : "Paste a mapping"}</button>
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
          Set every {newLabel.toLowerCase()} to
          <select
            className="input w-56 py-1"
            value=""
            onChange={(e) => e.target.value && onChange(rows.map((r) => ({ ...r, toId: e.target.value === r.fromId ? r.toId : e.target.value })))}
            aria-label={`Set every ${newLabel.toLowerCase()}`}
          >
            <option value="">Choose...</option>
            {active.filter((a) => !usedFrom.has(a.id)).map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
          </select>
        </label>
      </div>
      {paste && (
        <div className="grid gap-2 rounded border border-line bg-canvas p-3">
          <p className="text-xs text-ink-muted">One row per line: old account, new account. Use account numbers or full names, e.g. <code>6110,6105</code>.</p>
          <textarea id="mapping-paste" className="textarea min-h-[7rem] bg-white" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"old_account,new_account\n6110,6105\nOld Rent - Warehouse,Rent Expense - Combined"} aria-label="Paste mapping" />
          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary btn-sm" disabled={!pasteText.trim()} onClick={applyPaste}>Add these rows</button>
            {pasteMsg && <span className="text-xs">{pasteMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export const completeRows = (rows: MappingRow[]) => rows.filter((r) => r.fromId && r.toId);

/** Re-reads QuickBooks: the app keeps no copy of the books, so this is all "resync" needs. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn-secondary" disabled={pending} onClick={() => start(() => router.refresh())} title="Reads the latest accounts and balances from QuickBooks">
      {pending ? "Refreshing..." : "Refresh from QuickBooks"}
    </button>
  );
}
