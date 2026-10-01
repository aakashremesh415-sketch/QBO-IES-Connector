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
import { candidateKey, findCandidates } from "@/lib/logic/reclass";
import {
  acctRef, buildLines, checkAccounts, checkMapping, compareToQuickBooks, groupsFromGl, groupsFromRows, journalBody, reversalBody,
  PROFIT_AND_LOSS, TransferError, type Pair, type TransferGroup,
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

/** One row of an old account -> new account mapping, as account Ids. */
export type PairInput = { fromId: string; toId: string };

export type TransferInput = {
  pairs: PairInput[];
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

function resolvePairs(index: NameIndex, pairs: PairInput[]): Pair[] {
  return pairs.map((p) => {
    const from = index.byId.get(p.fromId);
    const to = index.byId.get(p.toId);
    if (!from || !to) throw new PrepareError("One of the chosen accounts no longer exists in QuickBooks. Reload the page and choose again.");
    return { from, to };
  });
}

export async function prepareTransfer(qbo: Qbo, input: TransferInput, today: string): Promise<Prepared> {
  const index = accountIndex(await loadAccounts(qbo));
  const pairs = resolvePairs(index, input.pairs);
  const from = pairs.map((p) => p.from);
  const toById = new Map(pairs.map((p) => [p.from.Id, acctRef(p.to)]));
  const prefs = await qbo.preferences();
  const home = prefs?.CurrencyPrefs?.HomeCurrency?.value ?? "";
  const txnDate = input.date || input.asOf;
  const notes: string[] = [];
  let groups: TransferGroup[];
  let warnings: string[];

  try {
    warnings = checkAccounts(pairs, index, home);
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
      const stray = [...new Set(groups.filter((g) => !toById.has(g.from.id)).map((g) => g.from.name))];
      if (stray.length) throw new TransferError(`The amounts file mentions accounts that aren't in your mapping: ${stray.join(", ")}.`);
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
    if (!groups.length) throw new TransferError("All the old accounts already have a zero balance. Nothing to transfer.");
    const lines = buildLines(groups, (id) => toById.get(id)!, input.memo ?? "");
    const destinations = [...new Set(pairs.map((p) => p.to.FullyQualifiedName))];
    const intoText = destinations.length === 1 ? destinations[0] : `${destinations.length} accounts`;
    const body = journalBody(lines, txnDate, input.docNumber ?? "", input.memo || `Balance transfer of ${from.length} account(s) into ${intoText} as of ${input.asOf}`);
    const total = lines.filter((l) => l.posting === "Debit").reduce((s, l) => s + l.amount, 0);
    return {
      kind: "transfer",
      title: `Balance transfer: ${from.length} account${from.length === 1 ? "" : "s"} into ${intoText}`,
      params: {
        ...input, amountsCsv: input.amountsCsv ? "(file provided)" : undefined,
        mapping: pairs.map((p) => ({ from: p.from.FullyQualifiedName, to: p.to.FullyQualifiedName })),
      },
      preview: {
        txnDate, docNumber: input.docNumber ?? "", total, warnings, notes,
        mapping: pairs.map((p) => ({ from: p.from.FullyQualifiedName, to: p.to.FullyQualifiedName })),
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

export type MoveInput = {
  pairs: PairInput[];
  start?: string;
  end?: string;
  includeReconciled?: boolean;
  /** Transaction-level mode: only these transactions, each optionally sent to its own new account. */
  selected?: { key: string; toId?: string }[];
};

async function moveContext(qbo: Qbo, input: MoveInput, today: string) {
  const index = accountIndex(await loadAccounts(qbo));
  const pairs = resolvePairs(index, input.pairs);
  try {
    checkMapping(pairs);
  } catch (e) {
    throw new PrepareError((e as Error).message);
  }
  const start = input.start || EARLIEST;
  const end = input.end || today;
  const candidates = findCandidates(await fetchGl(qbo, pairs.map((p) => p.from.Id), start, end), !!input.includeReconciled);
  return { index, pairs, start, end, candidates };
}

/** Read-only list of the transactions in the old accounts, for picking individual ones. */
export async function listMoveCandidates(qbo: Qbo, input: MoveInput, today: string) {
  const { index, pairs, candidates } = await moveContext(qbo, input, today);
  if (candidates.length > 5000) throw new PrepareError(`${candidates.length} transactions found. Use a shorter date range (at most 5,000 at a time).`);
  const toFor = new Map(pairs.map((p) => [p.from.Id, p.to.Id]));
  return candidates.map((c) => ({
    key: candidateKey(c), txnType: c.txnType, txnId: c.txnId, txnDate: c.txnDate, docNum: c.docNum, name: c.name,
    className: c.className, amount: c.amount, skipReason: c.skipReason,
    accounts: c.accountIds.map((id) => index.byId.get(id)?.FullyQualifiedName ?? id),
    defaultToId: toFor.get(c.accountIds[0]) ?? "",
  }));
}

export async function prepareMove(qbo: Qbo, input: MoveInput, today: string): Promise<Prepared> {
  const { index, pairs, start, end, candidates: all } = await moveContext(qbo, input, today);
  const pairMap: Record<string, string> = Object.fromEntries(pairs.map((p) => [p.from.Id, p.to.Id]));
  const sources = new Set(Object.keys(pairMap));

  let candidates = all;
  const overrides = new Map<string, string>();
  if (input.selected) {
    if (!input.selected.length) throw new PrepareError("Tick at least one transaction.");
    for (const s of input.selected) {
      if (!s.toId) continue;
      const to = index.byId.get(s.toId);
      if (!to || to.Active === false) throw new PrepareError("One of the chosen new accounts doesn't exist or is inactive. Reload and choose again.");
      if (sources.has(s.toId)) throw new PrepareError(`'${to.FullyQualifiedName}' is one of the old accounts, so it can't also be a new account.`);
      overrides.set(s.key, s.toId);
    }
    // Only transactions the server itself found in the old accounts can be chosen.
    const wanted = new Set(input.selected.map((s) => s.key));
    candidates = all.filter((c) => wanted.has(candidateKey(c)));
    if (!candidates.length) throw new PrepareError("None of the ticked transactions are in the old accounts any more. Find them again.");
  }
  if (candidates.length > 5000) throw new PrepareError(`${candidates.length} transactions found. Use a shorter date range (at most 5,000 per run).`);

  const destinations = [...new Set([...pairs.map((p) => p.to.FullyQualifiedName), ...[...overrides.values()].map((id) => index.byId.get(id)!.FullyQualifiedName)])];
  return {
    kind: "move",
    title: `Move ${input.selected ? `${candidates.length} chosen transaction(s)` : "transactions"} into ${destinations.length === 1 ? destinations[0] : `${destinations.length} accounts`}`,
    params: {
      start, end, includeReconciled: !!input.includeReconciled, mode: input.selected ? "pick" : "all",
      mapping: pairs.map((p) => ({ from: p.from.FullyQualifiedName, to: p.to.FullyQualifiedName })),
    },
    preview: { found: candidates.length },
    items: candidates.map((c) => {
      const override = overrides.get(candidateKey(c));
      // Each old account on this transaction goes to its own new account, unless one was chosen for the whole transaction.
      const mapping = Object.fromEntries(c.accountIds.map((id) => [id, override ?? pairMap[id]]));
      const into = [...new Set(Object.values(mapping))].map((id) => index.byId.get(id)?.FullyQualifiedName ?? id).join(", ");
      return {
        label: `${c.txnType} ${c.docNum || c.txnId}`,
        action: "move",
        detail: [c.txnDate, c.name, c.className, c.amount, `→ ${into}`].filter(Boolean).join(" · "),
        payload: { entity: c.entity, txnId: c.txnId, mapping },
        status: c.skipReason ? "SKIPPED" : "READY",
        message: c.skipReason,
      };
    }),
  };
}

export const companyLabel = (c: Company) => `${c.companyName ?? c.alias} (${c.alias})`;
