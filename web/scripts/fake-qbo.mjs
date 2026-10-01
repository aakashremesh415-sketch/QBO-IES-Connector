/**
 * A tiny in-memory stand-in for the QuickBooks Online API, for trying the app locally without
 * an Intuit account. NOT used in production. Point the app at it with:
 *   QBO_API_BASE=http://localhost:3999
 *   QBO_TOKEN_URL=http://localhost:3999/oauth2/v1/tokens/bearer
 *   QBO_AUTHORIZE_URL=http://localhost:3999/connect/oauth2
 *   QBO_REVOKE_URL=http://localhost:3999/v2/oauth2/tokens/revoke
 * Run: node scripts/fake-qbo.mjs
 */
import http from "node:http";

const PORT = Number(process.env.PORT ?? 3999);
let nextId = 1000;
const id = () => String(nextId++);

const acct = (Id, AcctNum, FullyQualifiedName, AccountType, Classification, extra = {}) => ({
  Id, AcctNum, FullyQualifiedName, Name: FullyQualifiedName.split(":").pop(), AccountType, Classification,
  Active: true, SyncToken: "0", CurrencyRef: { value: "USD" }, ...extra,
});
const accounts = [
  acct("41", "1010", "Operating Bank", "Bank", "Asset"),
  acct("45", "1250", "Old Security Deposits", "Other Current Asset", "Asset"),
  acct("60", "2250", "Old Deposits Held", "Other Current Liability", "Liability"),
  acct("52", "6100", "Rent", "Expense", "Expense"),
  acct("88", "6105", "Rent Expense - Combined", "Expense", "Expense"),
  acct("53", "6110", "Old Rent - HQ", "Expense", "Expense"),
  acct("54", "6120", "Old Rent - Warehouse", "Expense", "Expense"),
  acct("55", "6130", "Old Rent - Retail", "Expense", "Expense"),
  acct("56", "6140", "Old Rent - Storage", "Expense", "Expense"),
  acct("57", "6150", "Old Rent - Parking", "Expense", "Expense"),
  acct("70", "6300", "Marketing", "Expense", "Expense"),
  acct("71", "6310", "Marketing:Events", "Expense", "Expense", { SubAccount: true, ParentRef: { value: "70" } }),
  acct("72", "6900", "Old Marketing", "Expense", "Expense", { Active: false }),
];
const classes = [
  { Id: "c1", Name: "East", FullyQualifiedName: "East" },
  { Id: "c2", Name: "West", FullyQualifiedName: "West" },
  { Id: "c3", Name: "Central", FullyQualifiedName: "Central" },
];
const departments = [{ Id: "d1", Name: "Boston", FullyQualifiedName: "Boston" }, { Id: "d2", Name: "Denver", FullyQualifiedName: "Denver" }];

// Transactions in API shape, keyed by "Entity:Id".
const txns = new Map();
function purchase(Id, TxnDate, DocNumber, bankId, lines, type = "Expense") {
  txns.set(`Purchase:${Id}`, {
    Id, SyncToken: "0", TxnDate, DocNumber, PaymentType: type === "Check" ? "Check" : "Cash", AccountRef: { value: bankId },
    Line: lines.map(([accountId, amount, classId, deptId]) => ({
      DetailType: "AccountBasedExpenseLineDetail", Amount: amount,
      AccountBasedExpenseLineDetail: { AccountRef: { value: accountId }, ...(classId && { ClassRef: { value: classId } }) },
      ...(deptId && { _dept: deptId }),
    })),
    _type: type,
  });
}
purchase("501", "2026-01-05", "EXP-1102", "41", [["53", 18400, "c1", "d1"]]);
purchase("502", "2026-01-31", "EXP-1150", "41", [["53", 9600, "c2", "d2"]]);
purchase("503", "2026-02-03", "1045", "41", [["54", 12250, "c1", "d1"]], "Check");
purchase("504", "2026-02-28", "EXP-1201", "41", [["55", 7800, "c3"]]);
purchase("505", "2026-03-15", "EXP-1240", "41", [["56", 2150, "c2", "d2"]]);
purchase("506", "2026-04-01", "EXP-1302", "41", [["57", 1320]]);
txns.set("JournalEntry:507", {
  Id: "507", SyncToken: "0", TxnDate: "2026-04-30", DocNumber: "JE-0430", Line: [
    { DetailType: "JournalEntryLineDetail", Amount: 400, JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "53" }, ClassRef: { value: "c1" } } },
    { DetailType: "JournalEntryLineDetail", Amount: 400, JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "41" } } },
  ],
});
txns.set("Payroll:508", { Id: "508", _type: "Payroll Check", TxnDate: "2026-05-15", DocNumber: "PR-0515", Line: [{ _acct: "56", _amt: 880, _class: "c1" }] });
txns.set("JournalEntry:509", {
  Id: "509", SyncToken: "0", TxnDate: "2026-01-01", DocNumber: "OPEN", Line: [
    { DetailType: "JournalEntryLineDetail", Amount: 14500, JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "45" } } },
    { DetailType: "JournalEntryLineDetail", Amount: 3500, JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "60" } } },
    { DetailType: "JournalEntryLineDetail", Amount: 11000, JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "41" } } },
  ],
});

/** Every posting as {accountId, debit, credit, classId, deptId, txnType, txnId, date, doc}. */
function postings() {
  const out = [];
  for (const [key, t] of txns) {
    const [entity] = key.split(":");
    if (entity === "Purchase") {
      let total = 0;
      for (const l of t.Line) {
        const d = l.AccountBasedExpenseLineDetail;
        out.push({ accountId: d.AccountRef.value, debit: l.Amount, credit: 0, classId: d.ClassRef?.value, deptId: l._dept, txnType: t._type, txnId: t.Id, date: t.TxnDate, doc: t.DocNumber });
        total += l.Amount;
      }
      out.push({ accountId: t.AccountRef.value, debit: 0, credit: total, txnType: t._type, txnId: t.Id, date: t.TxnDate, doc: t.DocNumber });
    } else if (entity === "JournalEntry") {
      for (const l of t.Line) {
        const d = l.JournalEntryLineDetail;
        out.push({ accountId: d.AccountRef.value, debit: d.PostingType === "Debit" ? l.Amount : 0, credit: d.PostingType === "Credit" ? l.Amount : 0, classId: d.ClassRef?.value, deptId: d.DepartmentRef?.value, txnType: "Journal Entry", txnId: t.Id, date: t.TxnDate, doc: t.DocNumber ?? "" });
      }
    } else if (entity === "Payroll") {
      for (const l of t.Line) out.push({ accountId: l._acct, debit: l._amt, credit: 0, classId: l._class, txnType: t._type, txnId: t.Id, date: t.TxnDate, doc: t.DocNumber });
    }
  }
  return out;
}

function withBalances(list) {
  const ps = postings();
  return list.map((a) => {
    const net = ps.filter((p) => p.accountId === a.Id).reduce((s, p) => s + p.debit - p.credit, 0);
    const bal = ["Asset", "Expense"].includes(a.Classification) ? net : -net;
    return { ...a, CurrentBalance: Math.round(bal * 100) / 100, CurrentBalanceWithSubAccounts: Math.round(bal * 100) / 100 };
  });
}

const GL_KEYS = ["tx_date", "txn_type", "doc_num", "name", "memo", "account_name", "klass_name", "dept_name", "debt_amt", "credit_amt", "is_cleared"];
function generalLedger(q) {
  const ids = (q.get("account") ?? "").split(",");
  const start = q.get("start_date") ?? "1900-01-01", end = q.get("end_date") ?? "2999-12-31";
  const ps = postings().filter((p) => p.date >= start && p.date <= end);
  return {
    Header: { ReportName: "GeneralLedger" },
    Columns: { Column: GL_KEYS.map((k) => ({ ColTitle: k, MetaData: [{ Name: "ColKey", Value: k }] })) },
    Rows: {
      Row: ids.map((aid) => {
        const a = accounts.find((x) => x.Id === aid);
        const rows = ps.filter((p) => p.accountId === aid).map((p) => {
          const cls = classes.find((c) => c.Id === p.classId), dep = departments.find((d) => d.Id === p.deptId);
          return { type: "Data", ColData: [
            { value: p.date }, { value: p.txnType, id: p.txnId }, { value: p.doc }, { value: "" }, { value: "" }, { value: a?.FullyQualifiedName ?? "" },
            { value: cls?.Name ?? "", id: cls?.Id ?? "" }, { value: dep?.Name ?? "", id: dep?.Id ?? "" },
            { value: p.debit ? p.debit.toFixed(2) : "" }, { value: p.credit ? p.credit.toFixed(2) : "" }, { value: p.txnId === "503" ? "R" : "" },
          ] };
        });
        return { type: "Section", Header: { ColData: [{ value: a?.FullyQualifiedName ?? aid, id: aid }] }, Rows: { Row: rows } };
      }),
    },
  };
}

function fault(res, status, message, detail = "") {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ Fault: { Error: [{ Message: message, Detail: detail }], type: "ValidationFault" } }));
}
const send = (res, body) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = "";
  for await (const chunk of req) body += chunk;
  const path = url.pathname;

  if (path === "/connect/oauth2") {
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "fake-code");
    back.searchParams.set("realmId", "9130350000000001");
    back.searchParams.set("state", url.searchParams.get("state"));
    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }
  if (path === "/v2/oauth2/tokens/revoke") {
    console.log("revoked", JSON.parse(body || "{}").token);
    res.writeHead(200);
    return res.end();
  }
  if (path === "/oauth2/v1/tokens/bearer") {
    if (process.env.FAKE_REJECT_REFRESH && body.includes("grant_type=refresh_token")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid_grant" }));
    }
    return send(res, { access_token: `at-${Date.now()}`, refresh_token: `rt-${Date.now()}`, expires_in: 3600, x_refresh_token_expires_in: 8640000 });
  }
  const m = path.match(/^\/v3\/company\/([^/]+)\/(.+)$/);
  if (!m) return fault(res, 404, "Not found");
  if (!req.headers.authorization?.startsWith("Bearer at-")) return fault(res, 401, "AuthenticationFailed");
  const [, , rest] = m;

  if (rest.startsWith("companyinfo/")) return send(res, { CompanyInfo: { Id: "1", CompanyName: "Northwind Holdings US", FiscalYearStartMonth: "January", Country: "US" } });
  if (rest === "preferences") return send(res, { Preferences: { CurrencyPrefs: { HomeCurrency: { value: "USD" } } } });
  if (rest === "reports/GeneralLedger") return send(res, generalLedger(url.searchParams));
  if (rest === "query") {
    const q = url.searchParams.get("query") ?? "";
    const start = Number(q.match(/STARTPOSITION (\d+)/i)?.[1] ?? 1);
    if (start > 1) return send(res, { QueryResponse: {} });
    if (/FROM Account/i.test(q)) {
      const all = withBalances(accounts);
      return send(res, { QueryResponse: { Account: /Active IN/i.test(q) ? all : all.filter((a) => a.Active) } });
    }
    if (/FROM Class/i.test(q)) return send(res, { QueryResponse: { Class: classes } });
    if (/FROM Department/i.test(q)) return send(res, { QueryResponse: { Department: departments } });
    return send(res, { QueryResponse: {} });
  }

  const [entityPath, entityId] = rest.split("/");
  const entityName = { account: "Account", journalentry: "JournalEntry", purchase: "Purchase" }[entityPath];
  if (!entityName) return fault(res, 400, "Unsupported entity in fake API", entityPath);

  if (req.method === "GET") {
    if (entityName === "Account") {
      const a = withBalances(accounts).find((x) => x.Id === entityId);
      return a ? send(res, { Account: a }) : fault(res, 400, "Object Not Found");
    }
    const t = txns.get(`${entityName}:${entityId}`);
    return t ? send(res, { [entityName]: structuredClone(t) }) : fault(res, 400, "Object Not Found");
  }

  const data = JSON.parse(body || "{}");
  if (entityName === "Account") {
    if (data.Id) {
      const i = accounts.findIndex((a) => a.Id === data.Id);
      if (i < 0) return fault(res, 400, "Object Not Found");
      if (data.SyncToken !== accounts[i].SyncToken) return fault(res, 400, "Stale Object Error", "You and someone else are editing the same thing.");
      const parent = data.ParentRef ? accounts.find((a) => a.Id === data.ParentRef.value) : null;
      const updated = { ...accounts[i], ...data, SyncToken: String(Number(accounts[i].SyncToken) + 1) };
      updated.FullyQualifiedName = parent ? `${parent.FullyQualifiedName}:${updated.Name}` : updated.Name;
      if (!data.ParentRef) delete updated.ParentRef;
      accounts[i] = updated;
      return send(res, { Account: updated });
    }
    if (accounts.some((a) => a.Name === data.Name && (a.ParentRef?.value ?? "") === (data.ParentRef?.value ?? ""))) return fault(res, 400, "Duplicate Name Exists Error", "The name supplied already exists.");
    const parent = data.ParentRef ? accounts.find((a) => a.Id === data.ParentRef.value) : null;
    const cls = { Expense: "Expense", Income: "Revenue", Bank: "Asset", "Other Current Asset": "Asset" }[data.AccountType] ?? "Expense";
    const created = acct(id(), data.AcctNum ?? "", parent ? `${parent.FullyQualifiedName}:${data.Name}` : data.Name, data.AccountType, cls, data.ParentRef ? { SubAccount: true, ParentRef: data.ParentRef } : {});
    created.Description = data.Description;
    accounts.push(created);
    return send(res, { Account: created });
  }
  if (entityName === "JournalEntry" && !data.Id) {
    const dr = data.Line.filter((l) => l.JournalEntryLineDetail.PostingType === "Debit").reduce((s, l) => s + l.Amount, 0);
    const cr = data.Line.filter((l) => l.JournalEntryLineDetail.PostingType === "Credit").reduce((s, l) => s + l.Amount, 0);
    if (Math.abs(dr - cr) > 0.001) return fault(res, 400, "Journal Entry Must Balance");
    const je = { ...data, Id: id(), SyncToken: "0" };
    txns.set(`JournalEntry:${je.Id}`, je);
    return send(res, { JournalEntry: je });
  }
  const key = `${entityName}:${data.Id}`;
  const existing = txns.get(key);
  if (!existing) return fault(res, 400, "Object Not Found");
  if (data.SyncToken !== existing.SyncToken) return fault(res, 400, "Stale Object Error");
  txns.set(key, { ...data, _type: existing._type, SyncToken: String(Number(existing.SyncToken) + 1) });
  return send(res, { [entityName]: txns.get(key) });
});

server.listen(PORT, () => console.log(`Fake QuickBooks API on http://localhost:${PORT}`));
