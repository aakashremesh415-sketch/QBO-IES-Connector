import { toCents } from "./money";

export type TBRow = { id: string; name: string; debit: number; credit: number }; // cents

/** Flatten QuickBooks' TrialBalance report into one row per account (sections are walked too). */
export function parseTrialBalance(report: any): { rows: TBRow[]; totalDebit: number; totalCredit: number } {
  const rows: TBRow[] = [];
  const walk = (list: any[]) => {
    for (const r of list ?? []) {
      if (r.Rows?.Row) walk(r.Rows.Row);
      const cols = r.ColData;
      if (!cols || r.type === "Section" || r.group === "GrandTotal") continue;
      const name = String(cols[0]?.value ?? "");
      if (!name || /^total/i.test(name)) continue;
      rows.push({ id: String(cols[0]?.id ?? ""), name, debit: toCents(cols[1]?.value), credit: toCents(cols[2]?.value) });
    }
  };
  walk(report?.Rows?.Row ?? []);
  return {
    rows,
    totalDebit: rows.reduce((s, r) => s + r.debit, 0),
    totalCredit: rows.reduce((s, r) => s + r.credit, 0),
  };
}
