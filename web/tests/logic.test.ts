import { describe, expect, it } from "vitest";
import { buildPlan } from "@/lib/logic/accounts";
import { csvRecords, parseCsv, toCsv } from "@/lib/logic/csv";
import { BeginningBalanceError, fiscalYearStart, parseGl, type GLLine } from "@/lib/logic/gl";
import { fmt, toCents } from "@/lib/logic/money";
import { findCandidates, replaceAccountRefs } from "@/lib/logic/reclass";
import {
  acctRef, buildLines, checkAccounts, groupsFromGl, groupsFromRows, journalBody, reversalBody, TransferError,
} from "@/lib/logic/transfer";
import { acct, glReport, glRow, index } from "./helpers";

describe("money and csv", () => {
  it("parses amounts to cents", () => {
    expect(toCents("(1,000.50)")).toBe(-100050);
    expect(toCents("12.345")).toBe(1235);
    expect(toCents("")).toBe(0);
    expect(fmt(-123456)).toBe("-1,234.56");
  });
  it("reads quoted csv", () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
    const { records } = csvRecords("﻿Action,Account\r\ncreate,\r\n");
    expect(records).toEqual([{ action: "create", account: "" }]);
    expect(toCsv(["a"], [{ a: "1,2" }])).toBe('a\r\n"1,2"\r\n');
  });
});

describe("general ledger", () => {
  it("flattens sections into lines with class and cents", () => {
    const lines = parseGl(glReport([
      ["10", "Old Rent", [
        { ColData: [{ value: "Beginning Balance" }, ...Array(10).fill({ value: "" })] },
        glRow("2026-01-05", "Expense", "501", { cls: "East", clsId: "c1", dr: "1,200.00" }),
        glRow("2026-02-05", "Journal Entry", "502", { cls: "West", clsId: "c2", cr: "200.00", cleared: "R" }),
      ]],
      ["11", "Old Utilities", [glRow("2026-01-09", "Bill", "601", { dr: "50" })]],
    ]));
    expect(lines.map((l) => [l.accountId, l.txnId, l.classId, l.debit - l.credit])).toEqual([
      ["10", "501", "c1", 120000], ["10", "502", "c2", -20000], ["11", "601", "", 5000],
    ]);
  });
  it("refuses a nonzero opening balance", () => {
    const opening = { ColData: [{ value: "Beginning Balance" }, ...Array(7).fill({ value: "" }), { value: "100" }, { value: "" }, { value: "" }] };
    expect(() => parseGl(glReport([["10", "Old", [opening]]]))).toThrow(BeginningBalanceError);
  });
  it("works out the fiscal year start", () => {
    expect(fiscalYearStart("2026-03-31", 4)).toBe("2025-04-01");
    expect(fiscalYearStart("2026-09-30", 4)).toBe("2026-04-01");
  });
});

const gl = (accountId: string, net: number, o: Partial<GLLine> = {}): GLLine => ({
  accountId, accountName: "", txnType: "Expense", txnId: "1", txnDate: "2026-01-01", docNum: "", name: "", nameId: "", memo: "",
  className: "", classId: "", locationName: "", locationId: "", debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, cleared: "", ...o,
});

describe("balance transfer", () => {
  const OLD = [1, 2, 3, 4, 5].map((i) => acct(String(i), `Old ${i}`));
  const NEW = acct("99", "New Combined");
  const byId = new Map(OLD.map((a) => [a.Id, a]));

  it("moves five accounts into one, keeping classes, balanced", () => {
    const groups = groupsFromGl([
      gl("1", 10000, { classId: "c1", className: "East" }), gl("1", 5000, { classId: "c2", className: "West" }),
      gl("2", 3000, { classId: "c1", className: "East" }), gl("3", -1000, { classId: "c2", className: "West" }),
      gl("4", 2500, { classId: "c1", className: "East" }), gl("4", -2500, { classId: "c1", className: "East" }),
      gl("5", 750),
    ], byId);
    expect(groups).toHaveLength(5);
    const lines = buildLines(groups, acctRef(NEW), "");
    const dest = Object.fromEntries(lines.filter((l) => l.destination).map((l) => [l.klass?.name ?? "-", [l.posting, l.amount]]));
    expect(dest).toEqual({ East: ["Debit", 13000], West: ["Debit", 4000], "-": ["Debit", 750] });
    const body = journalBody(lines, "2026-09-30", "RC-1", "note") as any;
    expect(body.Line[0].JournalEntryLineDetail).toMatchObject({ PostingType: "Credit", ClassRef: { value: "c1" } });
    expect(body.Line[0].Amount).toBe(100);
  });

  it("needs a customer on receivable lines", () => {
    const ar = acct("5", "Old AR", { cls: "Asset", type: "Accounts Receivable" });
    const ar2 = acct("6", "New AR", { cls: "Asset", type: "Accounts Receivable" });
    expect(() => buildLines(groupsFromGl([gl("5", 8000)], new Map([["5", ar]])), acctRef(ar2), "")).toThrow(/customer/);
    const lines = buildLines(groupsFromGl([gl("5", 8000, { nameId: "c7", name: "Acme" })], new Map([["5", ar]])), acctRef(ar2), "");
    const body = journalBody(lines, "2026-09-30", "", "") as any;
    for (const l of body.Line) expect(l.JournalEntryLineDetail.Entity).toEqual({ Type: "Customer", EntityRef: { value: "c7" } });
  });

  it("checks accounts", () => {
    const idx = index(...OLD, NEW);
    expect(checkAccounts(OLD, NEW, idx, "USD")).toEqual([]);
    expect(() => checkAccounts([NEW], NEW, idx, "USD")).toThrow(/both a source/);
    const parent = acct("7", "Parent"), child = acct("8", "Parent:Child", { parent: "7" });
    expect(() => checkAccounts([parent], NEW, index(parent, child, NEW), "USD")).toThrow(/sub-accounts/);
    const ar = acct("9", "AR", { cls: "Asset", type: "Accounts Receivable" });
    expect(() => checkAccounts([ar], acct("10", "Bank", { cls: "Asset", type: "Bank" }), idx, "USD")).toThrow(TransferError);
  });

  it("uses the normal-balance sign for typed amounts", () => {
    const income = acct("20", "Old Sales", { cls: "Revenue", type: "Income" });
    const rent = acct("21", "Old Rent");
    const groups = groupsFromRows([{ from_account: "Old Sales", amount: "500" }, { from_account: "Old Rent", amount: "200" }], index(income, rent), {});
    expect(groups.map((g) => g.net)).toEqual([-50000, 20000]);
  });

  it("reverses every line", () => {
    const rev = reversalBody({ Id: "42", DocNumber: "RC1", TxnDate: "2026-09-30", Line: [
      { DetailType: "JournalEntryLineDetail", Amount: 10, JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "1" }, ClassRef: { value: "c1" } } },
    ] }, "2026-10-01");
    expect(rev.Line[0].JournalEntryLineDetail).toMatchObject({ PostingType: "Credit", ClassRef: { value: "c1" } });
    expect(rev.DocNumber).toBe("RC1-R");
  });
});

describe("chart of accounts plan", () => {
  it("validates creates, updates, parents created in the same file", () => {
    const changes = buildPlan([
      { action: "create", name: "Facilities", account_type: "Expense" },
      { action: "create", name: "Utilities", account_type: "Expense", parent: "Facilities" },
      { action: "update", account: "6100", name: "Office Rent", description: "HQ" },
      { action: "create", name: "Rent", account_type: "Expense" },
      { action: "create", name: "Bad:Name", account_type: "Expense" },
    ], index(acct("1", "Rent", { num: "6100" })));
    const byRow = Object.fromEntries(changes.map((c) => [c.row, c]));
    expect(byRow[3].parentPending).toBe("Facilities");
    expect(byRow[3].errors).toEqual([]);
    expect(byRow[4].fields).toEqual({ Name: "Office Rent", Description: "HQ" });
    expect(byRow[5].errors[0]).toMatch(/already exists/);
    expect(byRow[6].errors[0]).toMatch(/cannot contain/);
    expect(changes.slice(0, 2).map((c) => c.row)).toEqual([2, 3]);
  });

  it("guards inactivation and orders sub-accounts first", () => {
    const changes = buildPlan(
      ["Cash", "Old", "Old:Sub", "Lonely", "Old Sales"].map((account) => ({ action: "inactivate", account })),
      index(
        acct("1", "Cash", { cls: "Asset", type: "Bank", balance: 10 }), acct("2", "Old"), acct("3", "Old:Sub", { parent: "2" }),
        acct("4", "Lonely"), acct("5", "Lonely:Kid", { parent: "4" }), acct("6", "Old Sales", { cls: "Revenue", type: "Income", balance: 999 }),
      ),
    );
    const by = Object.fromEntries(changes.map((c) => [c.label, c]));
    expect(by.Cash.errors[0]).toMatch(/Balance is 10.00/);
    expect(by.Old.errors).toEqual([]);
    expect(by.Lonely.errors[0]).toMatch(/sub-accounts/);
    expect(by["Old Sales"].errors).toEqual([]);
    const labels = changes.map((c) => c.label);
    expect(labels.indexOf("Old:Sub")).toBeLessThan(labels.indexOf("Old"));
  });
});

describe("moving transactions", () => {
  it("switches only the old account refs and keeps the class", () => {
    const p = { AccountRef: { value: "1", name: "Old" }, Line: [{ D: { AccountRef: { value: "1" }, ClassRef: { value: "c1" } } }, { D: { AccountRef: { value: "3" } } }] };
    expect(replaceAccountRefs(p, { "1": "9" })).toBe(2);
    expect(p.AccountRef).toEqual({ value: "9" });
    expect(p.Line[0].D).toEqual({ AccountRef: { value: "9" }, ClassRef: { value: "c1" } });
    expect(p.Line[1].D.AccountRef.value).toBe("3");
  });
  it("dedupes and explains skips", () => {
    const c = findCandidates([gl("1", 5, { txnId: "10" }), gl("1", 5, { txnId: "10" }), gl("1", 5, { txnType: "Payroll Check", txnId: "11" }), gl("1", 5, { txnType: "Bill", txnId: "12", cleared: "R" })], false);
    const by = Object.fromEntries(c.map((x) => [x.txnId, x]));
    expect(c).toHaveLength(3);
    expect(by["10"]).toMatchObject({ skipReason: "", entity: "Purchase" });
    expect(by["11"].skipReason).toMatch(/can't be changed/);
    expect(by["12"].skipReason).toMatch(/Reconciled/);
  });
});
