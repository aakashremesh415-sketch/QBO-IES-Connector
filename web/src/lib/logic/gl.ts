import { toCents } from "./money";

export const GL_COLUMNS = "tx_date,txn_type,doc_num,name,memo,account_name,klass_name,dept_name,debt_amt,credit_amt,is_cleared";
export const EARLIEST = "1900-01-01";

export type GLLine = {
  accountId: string;
  accountName: string;
  txnType: string;
  txnId: string;
  txnDate: string;
  docNum: string;
  name: string;
  nameId: string;
  memo: string;
  className: string;
  classId: string;
  locationName: string;
  locationId: string;
  debit: number; // cents
  credit: number; // cents
  cleared: string;
};

export const netDebit = (l: GLLine) => l.debit - l.credit;

export class BeginningBalanceError extends Error {}

function columnKeys(report: any): string[] {
  return (report?.Columns?.Column ?? []).map((col: any) => {
    const meta = (col.MetaData ?? []).find((m: any) => m.Name === "ColKey");
    return meta?.Value ?? String(col.ColTitle ?? "").trim().toLowerCase();
  });
}

/** Flatten the General Ledger report into one line per posting, tagged with its account section. */
export function parseGl(report: any): GLLine[] {
  const keys = columnKeys(report);
  const lines: GLLine[] = [];

  const walk = (rows: any[], accountId: string, accountName: string) => {
    for (const row of rows ?? []) {
      if (row.Header) {
        const h = row.Header.ColData?.[0] ?? {};
        walk(row.Rows?.Row ?? [], h.id ?? accountId, h.value ?? accountName);
        continue;
      }
      const cols: any[] = row.ColData;
      if (!cols) continue;
      const cell: Record<string, any> = {};
      keys.forEach((k, i) => (cell[k] = cols[i] ?? {}));
      const v = (k: string) => String(cell[k]?.value ?? "");
      const id = (k: string) => String(cell[k]?.id ?? "");
      if (v("tx_date").toLowerCase() === "beginning balance") {
        if (cols.slice(1).some((c) => toCents(c?.value) !== 0)) throw new BeginningBalanceError(accountName);
        continue;
      }
      if (!v("txn_type")) continue;
      lines.push({
        accountId, accountName,
        txnType: v("txn_type"), txnId: id("txn_type"), txnDate: v("tx_date"), docNum: v("doc_num"),
        name: v("name"), nameId: id("name"), memo: v("memo"),
        className: v("klass_name"), classId: id("klass_name"),
        locationName: v("dept_name"), locationId: id("dept_name"),
        debit: toCents(v("debt_amt")), credit: toCents(v("credit_amt")),
        cleared: v("is_cleared"),
      });
    }
  };
  walk(report?.Rows?.Row ?? [], "", "");
  return lines;
}

export function fiscalYearStart(asOf: string, startMonth: number): string {
  const [y, m] = asOf.split("-").map(Number);
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, "0")}-01`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthNumber = (name: string | undefined) => (name && MONTHS.includes(name) ? MONTHS.indexOf(name) + 1 : 1);
