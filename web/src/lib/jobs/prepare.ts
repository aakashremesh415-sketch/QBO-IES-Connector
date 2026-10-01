/**
 * Turn a request into a saved PREVIEW job. These only read from QuickBooks; nothing is written
 * until the job is confirmed (see run.ts).
 */
import type { Company } from "@/db/schema";
import type { Entity, Qbo } from "@/lib/qbo/client";
import { buildPlan, describe } from "@/lib/logic/accounts";
import { csvRecords } from "@/lib/logic/csv";
import { BeginningBalanceError, EARLIEST, GL_COLUMNS, fiscalYearStart, monthNumber, parseGl, type GLLine } from "@/lib/logic/gl";
import { accountIndex, classIndex, customerIndex, locationIndex, vendorIndex, type NameIndex } from "@/lib/logic/lookups";
import { fmt } from "@/lib/logic/money";
import { findCandidates } from "@/lib/logic/reclass";
import {
  acctRef, buildLines, checkAccounts, compareToQuickBooks, groupsFromGl, groupsFromRows, journalBody, reversalBody,
  PROFIT_AND_LOSS, TransferError, type TransferGroup,
} from "@/lib/logic/transfer";

export type PreparedItem = { label: string; action: string; detail?: string; payload?: Record<string, unknown>; status: "READY" | "ERROR" | "SKIPPED"; message?: string };
export type Prepared = { kind: "accounts" | "inactivate" | "transfer" | "reverse" | "move"; title: string; params: Record<string, unknown>; preview: Record<string, unknown>; items: PreparedItem[] };

export class PrepareError extends Error {}

export async function loadAccounts(qbo: Qbo): Promise<Entity[]> {
  return qbo.query("SELECT * FROM Account WHERE Active IN (true, false)");
}

async function fetchGl(qbo: Qbo, accountIds: string[], start: string, end: string): Promise<GLLine[]> {
  if (!accountIds.length) return [];
  const report = await qbo.report("GeneralLedger", {
    account: accountIds.join(","), start_date: start, end_date: end, columns: GL_COLUMNS, accounting_method: "Accrual",
  });
  const wanted = new Set(accountIds);
  return parseGl(report).filter((l) => wanted.has(l.accountId));
}

/* ---------- chart of accounts ---------- */

export async function prepareAccounts(qbo: Qbo, rows: Record<string, string>[], kind: "accounts" | "inactivate", source: string): Promise<Prepared> {
  if (!rows.length) throw new PrepareError("There are no rows to check.");
  if (rows.length > 2000) throw new PrepareError("Please split the file: at most 2,000 rows per run.");
  const index = accountIndex(await loadAccounts(qbo));
  const changes = buildPlan(rows, index);
  const ready = changes.filter((c) => !c.errors.length).length;
  return {
    kind,
    title: kind === "inactivate" ? `Make ${changes.length} account(s) inactive` : `Chart of accounts changes from ${source}`,
    params: { source, rows: rows.length },
    preview: { ready, errors: changes.length - ready },
    items: changes.map((c) => ({
      label: c.label,
      action: c.action,
      detail: describe(c),
      payload: { row: c.row, accountId: c.accountId, fields: c.fields, parent: c.parent, parentPending: c.parentPending, shortName: (c.fields.Name as string) ?? null },
      status: c.errors.length ? "ERROR" : "READY",
      message: c.errors.join(" "),
    })),
  };
}

/* ---------- balance transfer ---------- */

export type TransferInput = {
  fromIds: string[];
  toId: string;
  asOf: string;
  date?: string;
  plStart?: string;
  docNumber?: string;
  memo?: string;
  amountsCsv?: string;
};

async function fillMissingIds(qbo: Qbo, groups: TransferGroup[]) {
  const resolve = async (refs: ({ id: string; name: string } | null)[], load: () => Promise<NameIndex>) => {
    const missing = refs.filter((r): r is { id: string; name: string } => !!r && !!r.name && !r.id);
    if (!missing.length) return;
    const idx = await load();
    for (const r of missing) r.id = idx.get(r.name).Id;
  };
  await resolve(groups.map((g) => g.klass), async () => classIndex(await qbo.query("SELECT * FROM Class")));
  await resolve(groups.map((g) => g.location), async () => locationIndex(await qbo.query("SELECT * FROM Department")));
  await resolve(groups.filter((g) => g.entityType === "Customer").map((g) => g.entity), async () => customerIndex(await qbo.query("SELECT * FROM Customer")));
  await resolve(groups.filter((g) => g.entityType === "Vendor").map((g) => g.entity), async () => vendorIndex(await qbo.query("SELECT * FROM Vendor")));
}

export async function prepareTransfer(qbo: Qbo, input: TransferInput, today: string): Promise<Prepared> {
  const index = accountIndex(await loadAccounts(qbo));
  const from = input.fromIds.map((id) => index.byId.get(id)).filter((a): a is Entity => !!a);
  const to = index.byId.get(input.toId);
  if (!to) throw new PrepareError("Choose the account to move the balances into.");
  if (from.length !== input.fromIds.length) throw new PrepareError("One of the source accounts no longer exists. Reload the page.");
  const prefs = await qbo.preferences();
  const home = prefs?.CurrencyPrefs?.HomeCurrency?.value ?? "";
  const txnDate = input.date || input.asOf;
  const notes: string[] = [];
  let groups: TransferGroup[];
  let warnings: string[];

  try {
    warnings = checkAccounts(from, to, index, home);
    if (input.amountsCsv?.trim()) {
      const { headers, records } = csvRecords(input.amountsCsv);
      if (!headers.includes("from_account") || !headers.includes("amount")) throw new TransferError("The amounts file needs 'from_account' and 'amount' columns.");
      const need = (col: string) => records.some((r) => r[col]);
      groups = groupsFromRows(records, index, {
        classes: need("class") ? classIndex(await qbo.query("SELECT * FROM Class")) : undefined,
        locations: need("location") ? locationIndex(await qbo.query("SELECT * FROM Department")) : undefined,
        customers: need("customer_or_vendor") ? customerIndex(await qbo.query("SELECT * FROM Customer")) : undefined,
        vendors: need("customer_or_vendor") ? vendorIndex(await qbo.query("SELECT * FROM Vendor")) : undefined,
      });
      const allowed = new Set(input.fromIds);
      const stray = [...new Set(groups.filter((g) => !allowed.has(g.from.id)).map((g) => g.from.name))];
      if (stray.length) throw new TransferError(`The amounts file mentions accounts you didn't choose as sources: ${stray.join(", ")}.`);
    } else {
      const bs = from.filter((a) => !PROFIT_AND_LOSS.includes(a.Classification)).map((a) => a.Id);
      const pl = from.filter((a) => PROFIT_AND_LOSS.includes(a.Classification)).map((a) => a.Id);
      let lines = await fetchGl(qbo, bs, EARLIEST, input.asOf);
      if (pl.length) {
        const start = input.plStart || fiscalYearStart(input.asOf, monthNumber((await qbo.companyInfo()).FiscalYearStartMonth));
        notes.push(`Income and expense accounts use activity from ${start} to ${input.asOf} (fiscal year to date).`);
        lines = lines.concat(await fetchGl(qbo, pl, start, input.asOf));
      }
      groups = groupsFromGl(lines, new Map(from.map((a) => [a.Id, a])));
      await fillMissingIds(qbo, groups);
      notes.push(...compareToQuickBooks(groups, from, input.asOf, today));
    }
    if (!groups.length) throw new TransferError("All the source accounts already have a zero balance. Nothing to transfer.");
    const lines = buildLines(groups, acctRef(to), input.memo ?? "");
    const body = journalBody(lines, txnDate, input.docNumber ?? "", input.memo || `Balance transfer to ${to.FullyQualifiedName} as of ${input.asOf}`);
    const total = lines.filter((l) => l.posting === "Debit").reduce((s, l) => s + l.amount, 0);
    return {
      kind: "transfer",
      title: `Balance transfer into ${to.FullyQualifiedName}`,
      params: { ...input, amountsCsv: input.amountsCsv ? "(file provided)" : undefined, fromNames: from.map((a) => a.FullyQualifiedName), toName: to.FullyQualifiedName },
      preview: {
        txnDate, docNumber: input.docNumber ?? "", total, warnings, notes,
        lines: lines.map((l) => ({
          account: l.account.name, posting: l.posting, amount: l.amount, className: l.klass?.name ?? "", location: l.location?.name ?? "",
          entity: l.entity?.name ?? "", destination: l.destination,
        })),
      },
      items: [{ label: `Journal entry dated ${txnDate}, ${lines.length} lines, total ${fmt(total)}`, action: "post", payload: { body }, status: "READY" }],
    };
  } catch (e) {
    if (e instanceof TransferError) throw new PrepareError(e.message);
    if (e instanceof BeginningBalanceError) throw new PrepareError(`The ledger for '${e.message}' starts with an opening balance; choose an earlier start date for income and expense accounts.`);
    throw e;
  }
}

export async function prepareReverse(qbo: Qbo, journalId: string, date: string): Promise<Prepared> {
  const original = await qbo.read("JournalEntry", journalId);
  const body = reversalBody(original, date);
  const accounts = new Map((await loadAccounts(qbo)).map((a) => [a.Id, a.FullyQualifiedName]));
  const lines = body.Line.map((l: any) => ({
    account: accounts.get(l.JournalEntryLineDetail.AccountRef.value) ?? l.JournalEntryLineDetail.AccountRef.value,
    posting: l.JournalEntryLineDetail.PostingType, amount: Math.round(l.Amount * 100), className: l.JournalEntryLineDetail.ClassRef?.name ?? "",
    location: l.JournalEntryLineDetail.DepartmentRef?.name ?? "", entity: "", destination: false,
  }));
  const total = lines.filter((l: any) => l.posting === "Debit").reduce((s: number, l: any) => s + l.amount, 0);
  return {
    kind: "reverse",
    title: `Reverse journal entry ${original.DocNumber || journalId}`,
    params: { journalId, date },
    preview: { txnDate: date, docNumber: body.DocNumber, total, warnings: [], notes: [body.PrivateNote], lines },
    items: [{ label: `Reversing entry dated ${date}, total ${fmt(total)}`, action: "post", payload: { body }, status: "READY" }],
  };
}

/* ---------- move transactions ---------- */

export type MoveInput = { fromIds: string[]; toId: string; start?: string; end?: string; includeReconciled?: boolean };

export async function prepareMove(qbo: Qbo, input: MoveInput, today: string): Promise<Prepared> {
  const index = accountIndex(await loadAccounts(qbo));
  const from = input.fromIds.map((id) => index.byId.get(id)).filter((a): a is Entity => !!a);
  const to = index.byId.get(input.toId);
  if (!to || !from.length) throw new PrepareError("Choose the old accounts and the new account.");
  if (from.some((a) => a.Id === to.Id)) throw new PrepareError("The new account can't also be one of the old accounts.");
  if (to.Active === false) throw new PrepareError("The new account is inactive.");
  const start = input.start || EARLIEST;
  const end = input.end || today;
  const candidates = findCandidates(await fetchGl(qbo, from.map((a) => a.Id), start, end), !!input.includeReconciled);
  if (candidates.length > 5000) throw new PrepareError(`${candidates.length} transactions found. Use a shorter date range (at most 5,000 per run).`);
  const mapping = Object.fromEntries(from.map((a) => [a.Id, to.Id]));
  return {
    kind: "move",
    title: `Move transactions into ${to.FullyQualifiedName}`,
    params: { ...input, start, end, fromNames: from.map((a) => a.FullyQualifiedName), toName: to.FullyQualifiedName },
    preview: { found: candidates.length },
    items: candidates.map((c) => ({
      label: `${c.txnType} ${c.docNum || c.txnId}`,
      action: "move",
      detail: [c.txnDate, c.name, c.className, c.amount].filter(Boolean).join(" · "),
      payload: { entity: c.entity, txnId: c.txnId, mapping },
      status: c.skipReason ? "SKIPPED" : "READY",
      message: c.skipReason,
    })),
  };
}

export const companyLabel = (c: Company) => `${c.companyName ?? c.alias} (${c.alias})`;
