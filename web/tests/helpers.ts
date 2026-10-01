import type { Entity } from "@/lib/qbo/client";
import { accountIndex } from "@/lib/logic/lookups";

export function acct(id: string, name: string, opts: Partial<{ cls: string; type: string; parent: string; balance: number; active: boolean; num: string }> = {}): Entity {
  const a: Entity = {
    Id: id, Name: name.split(":").pop()!, FullyQualifiedName: name, Classification: opts.cls ?? "Expense",
    AccountType: opts.type ?? "Expense", Active: opts.active ?? true, CurrentBalance: opts.balance ?? 0,
    CurrentBalanceWithSubAccounts: opts.balance ?? 0, AcctNum: opts.num ?? "", SyncToken: "0",
  };
  if (opts.parent) Object.assign(a, { ParentRef: { value: opts.parent }, SubAccount: true });
  return a;
}

export const index = (...accounts: Entity[]) => accountIndex(accounts);

const KEYS = ["tx_date", "txn_type", "doc_num", "name", "memo", "account_name", "klass_name", "dept_name", "debt_amt", "credit_amt", "is_cleared"];

export function glRow(date: string, type: string, id: string, o: Partial<{ cls: string; clsId: string; dr: string; cr: string; cleared: string; name: string; nameId: string }> = {}) {
  const vals = [date, type, "", o.name ?? "", "", "", o.cls ?? "", "", o.dr ?? "", o.cr ?? "", o.cleared ?? ""];
  const data: any[] = vals.map((value) => ({ value }));
  data[1].id = id;
  data[3].id = o.nameId ?? "";
  data[6].id = o.clsId ?? "";
  return { type: "Data", ColData: data };
}

export function glReport(sections: [string, string, any[]][]) {
  return {
    Columns: { Column: KEYS.map((k) => ({ ColTitle: k, MetaData: [{ Name: "ColKey", Value: k }] })) },
    Rows: { Row: sections.map(([id, name, rows]) => ({ type: "Section", Header: { ColData: [{ value: name, id }] }, Rows: { Row: rows } })) },
  };
}
