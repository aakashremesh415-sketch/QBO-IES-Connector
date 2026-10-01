import type { Entity } from "@/lib/qbo/client";
import { LookupError, type NameIndex } from "./lookups";
import { toCents, fmt } from "./money";

export const ACTIONS = ["create", "update", "inactivate", "reactivate"] as const;
export type Action = (typeof ACTIONS)[number];
export const BALANCE_SHEET = ["Asset", "Liability", "Equity"];
const TOP_LEVEL = ["(top level)", "(none)", "-"];
export const PLAN_COLUMNS = ["action", "account", "name", "acct_num", "account_type", "detail_type", "description", "parent"];

export type ParentRef = { value: string; name: string } | null;

export type Change = {
  row: number;
  action: string;
  label: string;
  accountId: string | null;
  fields: Record<string, unknown>;
  parent?: ParentRef;
  parentPending?: string;
  errors: string[];
};

export function describe(c: Change): string {
  const parts = Object.entries(c.fields).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  if (c.parent !== undefined) parts.push(`parent: ${c.parent === null ? "top level" : c.parent.name}`);
  if (c.parentPending) parts.push(`parent: ${c.parentPending} (created earlier in this file)`);
  return parts.join(" · ");
}

function validateName(name: string, errors: string[]) {
  if (/[:"]/.test(name)) errors.push(`Account name '${name}' cannot contain ':' or '"'.`);
  if (name.length > 100) errors.push("Account name is longer than 100 characters.");
}

function setParent(c: Change, text: string, index: NameIndex, created: Set<string>) {
  if (TOP_LEVEL.includes(text.toLowerCase())) {
    c.parent = null;
    return;
  }
  let parent: Entity | null = null;
  try {
    parent = index.find(text);
  } catch (e) {
    c.errors.push((e as Error).message);
    return;
  }
  if (parent) c.parent = { value: parent.Id, name: parent.FullyQualifiedName };
  else if (created.has(text.toLowerCase())) c.parentPending = text;
  else c.errors.push(`Parent account '${text}' not found.`);
}

/** Validate every row against the current chart of accounts and order them safely. Mirrors the CLI. */
export function buildPlan(rows: Record<string, string>[], index: NameIndex): Change[] {
  const changes: Change[] = [];
  const created = new Set<string>();
  const inactivating = new Set<string>();

  rows.forEach((row, i) => {
    const action = (row.action ?? "").toLowerCase().trim();
    if (!action) return;
    const target = (row.account ?? "").trim();
    const c: Change = { row: i + 2, action, label: target || row.name || "", accountId: null, fields: {}, errors: [] };
    changes.push(c);
    if (!(ACTIONS as readonly string[]).includes(action)) {
      c.errors.push(`Unknown action '${action}'. Use one of: ${ACTIONS.join(", ")}.`);
      return;
    }

    if (action === "create") {
      const name = (row.name ?? "").trim();
      if (!name) {
        c.errors.push("'name' is required to create an account.");
        return;
      }
      validateName(name, c.errors);
      if (!row.account_type) c.errors.push("'account_type' is required to create an account (e.g. Expense, Bank, Other Current Asset).");
      c.label = name;
      c.fields = { Name: name, AccountType: row.account_type ?? "" };
      if (row.detail_type) c.fields.AccountSubType = row.detail_type;
      if (row.acct_num) c.fields.AcctNum = row.acct_num;
      if (row.description) c.fields.Description = row.description;
      let full = name;
      if (row.parent && !TOP_LEVEL.includes(row.parent.toLowerCase())) {
        setParent(c, row.parent, index, created);
        const parentName = c.parent?.name ?? c.parentPending;
        if (parentName) full = `${parentName}:${name}`;
      }
      let exists = false;
      try {
        exists = !!index.find(full);
      } catch {
        exists = true;
      }
      if (exists) c.errors.push(`An account named '${full}' already exists. Use 'update' instead.`);
      c.label = full;
      created.add(full.toLowerCase());
      created.add(name.toLowerCase());
      return;
    }

    if (!target) {
      c.errors.push(`'account' (existing name, number or id:<Id>) is required for '${action}'.`);
      return;
    }
    let account: Entity;
    try {
      account = index.get(target);
    } catch (e) {
      c.errors.push(e instanceof LookupError ? e.message : String(e));
      return;
    }
    c.accountId = account.Id;
    c.label = account.FullyQualifiedName;

    if (action === "update") {
      if (row.name && row.name !== account.Name) {
        validateName(row.name, c.errors);
        c.fields.Name = row.name;
      }
      for (const [col, key] of [["acct_num", "AcctNum"], ["account_type", "AccountType"], ["detail_type", "AccountSubType"], ["description", "Description"]]) {
        if (row[col] && row[col] !== (account[key] ?? "")) c.fields[key] = row[col];
      }
      if (row.parent) setParent(c, row.parent, index, created);
      if (!Object.keys(c.fields).length && c.parent === undefined && !c.parentPending && !c.errors.length) {
        c.errors.push("Nothing to change: every filled-in column already matches.");
      }
    } else if (action === "inactivate") {
      if (account.Active === false) {
        c.errors.push("Already inactive.");
        return;
      }
      const balance = toCents(account.CurrentBalanceWithSubAccounts ?? account.CurrentBalance ?? 0);
      if (BALANCE_SHEET.includes(account.Classification) && balance !== 0) {
        c.errors.push(`Balance is ${fmt(balance)}. Move the balance first (Balance transfer), then make it inactive.`);
      }
      inactivating.add(account.Id);
      c.fields = { Active: false };
    } else if (action === "reactivate") {
      if (account.Active !== false) c.errors.push("Already active.");
      c.fields = { Active: true };
    }
  });

  for (const c of changes) {
    if (c.action === "inactivate" && c.accountId && !c.errors.length) {
      const blocking = index.childrenOf(c.accountId).filter((k) => !inactivating.has(k.Id));
      if (blocking.length) c.errors.push(`Has active sub-accounts not in this list: ${blocking.map((k) => k.FullyQualifiedName).join(", ")}.`);
    }
  }

  const rank: Record<string, number> = { create: 0, reactivate: 1, update: 2, inactivate: 3 };
  return changes.sort((a, b) => {
    const r = (rank[a.action] ?? 9) - (rank[b.action] ?? 9);
    if (r) return r;
    if (a.action === "inactivate") {
      const d = b.label.split(":").length - a.label.split(":").length; // deepest first
      if (d) return d;
    }
    return a.row - b.row;
  });
}

/** Apply a change to a fresh copy of the account (or to {} for a create). */
export function applyChange(account: Record<string, any>, c: Pick<Change, "fields" | "parent" | "parentPending">, createdIds: Record<string, string>) {
  const body: Record<string, any> = { ...account, ...c.fields };
  if (c.parent === null) {
    body.SubAccount = false;
    delete body.ParentRef;
  } else if (c.parent) {
    body.SubAccount = true;
    body.ParentRef = { value: c.parent.value };
  }
  if (c.parentPending) {
    const id = createdIds[c.parentPending.toLowerCase()];
    if (!id) throw new Error(`Parent '${c.parentPending}' wasn't created, so this sub-account can't be either.`);
    body.SubAccount = true;
    body.ParentRef = { value: id };
  }
  return body;
}
