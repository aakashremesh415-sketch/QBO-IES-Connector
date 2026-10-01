import type { Entity } from "@/lib/qbo/client";
import { netDebit, type GLLine } from "./gl";
import type { NameIndex } from "./lookups";
import { fmt, toAmount, toCents } from "./money";

export const DEBIT_NORMAL = ["Asset", "Expense"];
export const PROFIT_AND_LOSS = ["Revenue", "Expense"];
export const ENTITY_ACCOUNT_TYPES: Record<string, "Customer" | "Vendor"> = {
  "Accounts Receivable": "Customer",
  "Accounts Payable": "Vendor",
};

export class TransferError extends Error {}

export type Ref = { id: string; name: string };
export type AccountRef = { id: string; name: string; type: string };

export type TransferGroup = {
  from: AccountRef;
  klass: Ref | null;
  location: Ref | null;
  entityType: "Customer" | "Vendor" | null;
  entity: Ref | null;
  net: number; // cents, positive = debit balance
};

export type JELine = {
  posting: "Debit" | "Credit";
  amount: number; // cents
  account: AccountRef;
  klass: Ref | null;
  location: Ref | null;
  entityType: "Customer" | "Vendor" | null;
  entity: Ref | null;
  description: string;
  destination: boolean;
};

const ref = (id: string, name: string): Ref | null => (id || name ? { id, name } : null);
export const acctRef = (a: Entity): AccountRef => ({ id: a.Id, name: a.FullyQualifiedName, type: a.AccountType });

export function groupsFromGl(lines: GLLine[], accountsById: Map<string, Entity>): TransferGroup[] {
  const totals = new Map<string, TransferGroup>();
  for (const l of lines) {
    const account = accountsById.get(l.accountId);
    if (!account) continue;
    const entityType = ENTITY_ACCOUNT_TYPES[account.AccountType] ?? null;
    const entity = entityType ? ref(l.nameId, l.name) : null;
    const key = [l.accountId, l.classId || l.className, l.locationId || l.locationName, entity?.id ?? entity?.name ?? ""].join("|");
    let g = totals.get(key);
    if (!g) {
      g = { from: acctRef(account), klass: ref(l.classId, l.className), location: ref(l.locationId, l.locationName), entityType, entity, net: 0 };
      totals.set(key, g);
    }
    g.net += netDebit(l);
  }
  return [...totals.values()].filter((g) => g.net !== 0);
}

/** Rows typed by the user. `amount` is the balance in the account's normal direction (normal = positive). */
export function groupsFromRows(
  rows: Record<string, string>[],
  accounts: NameIndex,
  lookups: { classes?: NameIndex; locations?: NameIndex; customers?: NameIndex; vendors?: NameIndex },
): TransferGroup[] {
  const groups: TransferGroup[] = [];
  rows.forEach((row, i) => {
    if (!row.from_account) return;
    try {
      const account = accounts.get(row.from_account);
      const entityType = ENTITY_ACCOUNT_TYPES[account.AccountType] ?? null;
      let klass: Ref | null = null, location: Ref | null = null, entity: Ref | null = null;
      if (row.class) {
        if (!lookups.classes) throw new Error("classes not loaded");
        const c = lookups.classes.get(row.class);
        klass = { id: c.Id, name: c.FullyQualifiedName };
      }
      if (row.location) {
        if (!lookups.locations) throw new Error("locations not loaded");
        const d = lookups.locations.get(row.location);
        location = { id: d.Id, name: d.FullyQualifiedName };
      }
      if (entityType && row.customer_or_vendor) {
        const idx = entityType === "Customer" ? lookups.customers : lookups.vendors;
        if (!idx) throw new Error("names not loaded");
        const e = idx.get(row.customer_or_vendor);
        entity = { id: e.Id, name: e.DisplayName ?? e.FullyQualifiedName ?? "" };
      }
      const amount = toCents(row.amount);
      const net = DEBIT_NORMAL.includes(account.Classification) ? amount : -amount;
      if (net !== 0) groups.push({ from: acctRef(account), klass, location, entityType, entity, net });
    } catch (e) {
      throw new TransferError(`Row ${i + 2}: ${(e as Error).message}`);
    }
  });
  return groups;
}

export type Pair = { from: Entity; to: Entity };

/**
 * Rules for an old-account -> new-account mapping, shared by balance transfers and transaction moves.
 * A destination can't also be a source (A->B with B->C would leave B with A's balance), and each old
 * account maps to exactly one new account.
 */
export function checkMapping(pairs: Pair[]): void {
  if (!pairs.length) throw new TransferError("Add at least one old account -> new account row.");
  const sources = new Set<string>();
  for (const { from, to } of pairs) {
    if (from.Id === to.Id) throw new TransferError(`'${from.FullyQualifiedName}' can't be moved into itself.`);
    if (sources.has(from.Id)) throw new TransferError(`'${from.FullyQualifiedName}' appears in more than one row. Each old account maps to one new account.`);
    sources.add(from.Id);
    if (to.Active === false) throw new TransferError(`The new account '${to.FullyQualifiedName}' is inactive.`);
  }
  for (const { to } of pairs) {
    if (sources.has(to.Id)) throw new TransferError(`'${to.FullyQualifiedName}' is both an old account and a new account. Split this into two separate runs.`);
  }
  for (const { from, to } of pairs) {
    // Receivable/payable lines carry customer and vendor balances; they can only move to another account of the same type.
    for (const [a, b] of [[from, to], [to, from]]) {
      if (ENTITY_ACCOUNT_TYPES[a.AccountType] && a.AccountType !== b.AccountType) {
        throw new TransferError(`'${from.FullyQualifiedName}' → '${to.FullyQualifiedName}': ${a.AccountType} can only be mapped to another ${a.AccountType} account, or customer and vendor balances would break.`);
      }
    }
  }
}

/** Returns warnings; throws for anything that would make a wrong or rejected entry. */
export function checkAccounts(pairs: Pair[], index: NameIndex, homeCurrency: string): string[] {
  checkMapping(pairs);
  const warnings: string[] = [];
  for (const { from: a, to } of pairs) {
    const name = a.FullyQualifiedName;
    const kids = index.childrenOf(a.Id);
    if (kids.length) {
      throw new TransferError(`'${name}' has sub-accounts (${kids.map((k) => k.FullyQualifiedName).join(", ")}). Add each sub-account as its own row so every balance is moved.`);
    }
    for (const acct of [a, to]) {
      const cur = acct.CurrencyRef?.value;
      if (cur && homeCurrency && cur !== homeCurrency) throw new TransferError(`'${acct.FullyQualifiedName}' is in ${cur}; foreign-currency accounts aren't supported.`);
    }
    if (ENTITY_ACCOUNT_TYPES[a.AccountType] && a.AccountType !== to.AccountType) {
      throw new TransferError(`'${name}' is ${a.AccountType}; its balance can only move to another ${a.AccountType} account.`);
    }
    if (a.Classification !== to.Classification) warnings.push(`'${name}' is ${a.Classification} but its new account '${to.FullyQualifiedName}' is ${to.Classification}.`);
    if (a.AccountType === "Bank" || a.AccountType === "Credit Card") warnings.push(`'${name}' is a ${a.AccountType} account: the entry will show in its register and reconciliation.`);
  }
  return warnings;
}

/**
 * One compound entry: each balance comes out of its old account and goes into that account's new
 * account with the same class, location and customer/vendor. Lines into each new account are
 * combined per class/location/name.
 */
export function buildLines(groups: TransferGroup[], toFor: (fromId: string) => AccountRef, memo: string): JELine[] {
  const lines: JELine[] = [];
  const dest = new Map<string, JELine & { signed: number }>();
  for (const g of groups) {
    if (g.entityType && !g.entity?.id && !g.entity?.name) {
      throw new TransferError(`Part of the balance in '${g.from.name}' has no ${g.entityType.toLowerCase()}; QuickBooks requires one on every ${g.from.type} line.`);
    }
    const to = toFor(g.from.id);
    lines.push({
      posting: g.net > 0 ? "Credit" : "Debit", amount: Math.abs(g.net), account: g.from, klass: g.klass, location: g.location,
      entityType: g.entityType, entity: g.entity, description: memo || `Transfer balance to ${to.name}`, destination: false,
    });
    const key = [to.id, g.klass?.id ?? g.klass?.name ?? "", g.location?.id ?? g.location?.name ?? "", g.entity?.id ?? g.entity?.name ?? ""].join("|");
    let d = dest.get(key);
    if (!d) {
      d = { posting: "Debit", amount: 0, signed: 0, account: to, klass: g.klass, location: g.location, entityType: g.entityType, entity: g.entity, description: memo || "Balance transferred in", destination: true };
      dest.set(key, d);
    }
    d.signed += g.net;
  }
  for (const d of dest.values()) {
    if (d.signed === 0) continue;
    const { signed, ...line } = d;
    lines.push({ ...line, posting: signed > 0 ? "Debit" : "Credit", amount: Math.abs(signed) });
  }
  const debits = lines.filter((l) => l.posting === "Debit").reduce((s, l) => s + l.amount, 0);
  const credits = lines.filter((l) => l.posting === "Credit").reduce((s, l) => s + l.amount, 0);
  if (debits !== credits) throw new TransferError(`Entry does not balance: debits ${fmt(debits)} vs credits ${fmt(credits)}.`);
  return lines;
}

export function journalBody(lines: JELine[], txnDate: string, docNumber: string, note: string) {
  const body: Record<string, unknown> = {
    TxnDate: txnDate,
    Line: lines.map((l) => {
      const detail: Record<string, unknown> = { PostingType: l.posting, AccountRef: { value: l.account.id } };
      if (l.klass?.id) detail.ClassRef = { value: l.klass.id };
      if (l.location?.id) detail.DepartmentRef = { value: l.location.id };
      if (l.entity?.id) detail.Entity = { Type: l.entityType, EntityRef: { value: l.entity.id } };
      return { DetailType: "JournalEntryLineDetail", Amount: toAmount(l.amount), Description: l.description.slice(0, 4000), JournalEntryLineDetail: detail };
    }),
  };
  if (docNumber) body.DocNumber = docNumber.slice(0, 21);
  if (note) body.PrivateNote = note.slice(0, 4000);
  return body;
}

export function reversalBody(original: Entity, txnDate: string) {
  const doc: string = original.DocNumber ?? "";
  return {
    TxnDate: txnDate,
    DocNumber: doc ? `${doc.slice(0, 19)}-R` : `REV${original.Id}`.slice(0, 21),
    PrivateNote: `Reversal of journal entry Id ${original.Id} (${doc || "no number"}) dated ${original.TxnDate}`,
    Line: (original.Line ?? [])
      .filter((l: any) => l.DetailType === "JournalEntryLineDetail")
      .map((l: any) => ({
        DetailType: "JournalEntryLineDetail",
        Amount: l.Amount,
        Description: l.Description ?? "",
        JournalEntryLineDetail: { ...l.JournalEntryLineDetail, PostingType: l.JournalEntryLineDetail.PostingType === "Debit" ? "Credit" : "Debit" },
      })),
  };
}

/** For balance sheet accounts as of today, compare ledger totals with QuickBooks' own balance. */
export function compareToQuickBooks(groups: TransferGroup[], from: Entity[], asOf: string, today: string): string[] {
  if (asOf < today) return [];
  const notes: string[] = [];
  for (const a of from) {
    if (PROFIT_AND_LOSS.includes(a.Classification)) continue;
    const total = groups.filter((g) => g.from.id === a.Id).reduce((s, g) => s + g.net, 0);
    const natural = DEBIT_NORMAL.includes(a.Classification) ? total : -total;
    const qb = toCents(a.CurrentBalance);
    if (natural !== qb) notes.push(`'${a.FullyQualifiedName}': ledger total ${fmt(natural)} differs from the QuickBooks balance ${fmt(qb)}. Check for future-dated transactions before posting.`);
  }
  return notes;
}
