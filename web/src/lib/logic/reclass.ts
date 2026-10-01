import { netDebit, type GLLine } from "./gl";
import { fmt } from "./money";

/** General Ledger "Transaction Type" text -> API entity name. Anything else can't be edited through the API. */
export const TXN_TYPES: Record<string, string> = {
  "Journal Entry": "JournalEntry",
  Expense: "Purchase",
  Check: "Purchase",
  "Cash Expense": "Purchase",
  "Credit Card Expense": "Purchase",
  "Credit Card Credit": "Purchase",
  Bill: "Bill",
  "Vendor Credit": "VendorCredit",
  Deposit: "Deposit",
  Transfer: "Transfer",
  "Sales Receipt": "SalesReceipt",
  Payment: "Payment",
  "Receive Payment": "Payment",
  "Bill Payment (Check)": "BillPayment",
  "Bill Payment (Credit Card)": "BillPayment",
  Refund: "RefundReceipt",
};

export type Candidate = {
  txnType: string;
  txnId: string;
  txnDate: string;
  docNum: string;
  name: string;
  className: string;
  amount: string;
  entity: string | null;
  skipReason: string;
};

/** Switch every *AccountRef whose value is in mapping; returns how many were switched. */
export function replaceAccountRefs(obj: unknown, mapping: Record<string, string>): number {
  let count = 0;
  if (Array.isArray(obj)) {
    for (const item of obj) count += replaceAccountRefs(item, mapping);
  } else if (obj && typeof obj === "object") {
    for (const [key, value] of Object.entries(obj as Record<string, any>)) {
      if (key.endsWith("AccountRef") && value && typeof value === "object" && typeof value.value === "string" && value.value in mapping) {
        value.value = mapping[value.value];
        delete value.name;
        count++;
      } else {
        count += replaceAccountRefs(value, mapping);
      }
    }
  }
  return count;
}

export function findCandidates(lines: GLLine[], includeReconciled: boolean): Candidate[] {
  const byTxn = new Map<string, { c: Candidate; lines: GLLine[] }>();
  for (const l of lines) {
    const key = `${l.txnType}|${l.txnId}`;
    let entry = byTxn.get(key);
    if (!entry) {
      entry = {
        c: { txnType: l.txnType, txnId: l.txnId, txnDate: l.txnDate, docNum: l.docNum, name: l.name, className: l.className, amount: "", entity: TXN_TYPES[l.txnType] ?? null, skipReason: "" },
        lines: [],
      };
      byTxn.set(key, entry);
    }
    entry.lines.push(l);
  }
  const out: Candidate[] = [];
  for (const { c, lines: ls } of byTxn.values()) {
    c.amount = fmt(ls.reduce((s, l) => s + netDebit(l), 0));
    c.className = [...new Set(ls.map((l) => l.className).filter(Boolean))].join(", ");
    if (!c.txnId) c.skipReason = "No transaction id in the ledger report.";
    else if (!c.entity) c.skipReason = `'${c.txnType}' transactions can't be changed through the API; change these by hand.`;
    else if (!includeReconciled && ls.some((l) => l.cleared === "R")) c.skipReason = "Reconciled. Tick 'Include reconciled' to move it anyway.";
    out.push(c);
  }
  return out.sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.txnType.localeCompare(b.txnType) || a.txnId.localeCompare(b.txnId));
}

export const sameAccountTransfer = (txn: any) =>
  !!txn?.FromAccountRef && txn.FromAccountRef?.value === txn.ToAccountRef?.value;
