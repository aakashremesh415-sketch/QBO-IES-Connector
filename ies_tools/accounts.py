"""Chart of accounts: export, and bulk create / update / inactivate / reactivate from a CSV plan."""

import csv
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

from .client import QBOClient, QBOError
from .lookups import LookupError_, NameIndex, account_index, children_of
from .safety import ResultLog, confirm_write

ACTIONS = ("create", "update", "inactivate", "reactivate")
BALANCE_SHEET = ("Asset", "Liability", "Equity")
TOP_LEVEL = ("(top level)", "(none)", "-")
PLAN_COLUMNS = ["action", "account", "name", "acct_num", "account_type", "detail_type", "description", "parent"]

EXPORT_COLUMNS = [
    "Id", "FullyQualifiedName", "Name", "AcctNum", "AccountType", "AccountSubType", "Classification",
    "Parent", "Active", "CurrentBalance", "CurrentBalanceWithSubAccounts", "Currency", "Description",
]


@dataclass
class Change:
    row: int
    action: str
    label: str
    account: dict | None = None
    fields: dict = field(default_factory=dict)
    parent_pending: str | None = None
    errors: list[str] = field(default_factory=list)

    def describe(self) -> str:
        parts = [f"{k}={v!r}" for k, v in self.fields.items() if k != "ParentRef"]
        if "ParentRef" in self.fields:
            parts.append("parent=" + ("top level" if self.fields["ParentRef"] is None else self.fields["ParentRef"]["name"]))
        if self.parent_pending:
            parts.append(f"parent={self.parent_pending!r} (created earlier in this file)")
        return ", ".join(parts)


def export_accounts(client: QBOClient, out: Path) -> int:
    index = account_index(client)
    with out.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=EXPORT_COLUMNS)
        writer.writeheader()
        for a in sorted(index.items, key=lambda a: a.get("FullyQualifiedName", "")):
            parent = index.by_id.get(a.get("ParentRef", {}).get("value", ""), {})
            writer.writerow({
                **{k: a.get(k, "") for k in EXPORT_COLUMNS},
                "Parent": parent.get("FullyQualifiedName", ""),
                "Currency": a.get("CurrencyRef", {}).get("value", ""),
            })
    return len(index.items)


def read_plan(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        missing = {"action", "account"} - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"{path} is missing column(s): {', '.join(sorted(missing))}. See templates/accounts_plan.csv.")
        return [{k.strip(): (v or "").strip() for k, v in row.items() if k} for row in reader]


def _validate_name(name: str, errors: list[str]) -> None:
    if any(ch in name for ch in ':"'):
        errors.append(f"Account name '{name}' cannot contain ':' or '\"'.")
    if len(name) > 100:
        errors.append("Account name is longer than 100 characters.")


def _parent_field(change: Change, parent_text: str, index: NameIndex, created_names: set[str]) -> None:
    if parent_text.lower() in TOP_LEVEL:
        change.fields["ParentRef"] = None
        return
    try:
        parent = index.find(parent_text)
    except LookupError_ as exc:
        change.errors.append(str(exc))
        return
    if parent:
        change.fields["ParentRef"] = {"value": parent["Id"], "name": parent["FullyQualifiedName"]}
    elif parent_text.lower() in created_names:
        change.parent_pending = parent_text
    else:
        change.errors.append(f"Parent account '{parent_text}' not found.")


def build_plan(rows: list[dict], index: NameIndex) -> list[Change]:
    changes: list[Change] = []
    created_names: set[str] = set()
    inactivating: set[str] = set()

    for n, row in enumerate(rows, start=2):  # row 1 is the header
        action = row.get("action", "").lower()
        if not action:
            continue
        target_text = row.get("account", "")
        change = Change(row=n, action=action, label=target_text or row.get("name", ""))
        changes.append(change)
        if action not in ACTIONS:
            change.errors.append(f"Unknown action '{action}'. Use one of: {', '.join(ACTIONS)}.")
            continue

        if action == "create":
            name = row.get("name", "")
            if not name:
                change.errors.append("'name' is required to create an account.")
                continue
            _validate_name(name, change.errors)
            if not row.get("account_type"):
                change.errors.append("'account_type' is required to create an account (e.g. Expense, Bank, Other Current Asset).")
            change.label = name
            change.fields = {"Name": name, "AccountType": row.get("account_type", "")}
            if row.get("detail_type"):
                change.fields["AccountSubType"] = row["detail_type"]
            if row.get("acct_num"):
                change.fields["AcctNum"] = row["acct_num"]
            if row.get("description"):
                change.fields["Description"] = row["description"]
            if row.get("parent") and row["parent"].lower() not in TOP_LEVEL:
                _parent_field(change, row["parent"], index, created_names)
                full_name = f"{change.fields.get('ParentRef', {}).get('name') or change.parent_pending}:{name}"
            else:
                full_name = name
            try:
                exists = index.find(full_name)
            except LookupError_:
                exists = True
            if exists:
                change.errors.append(f"An account named '{full_name}' already exists. Use 'update' instead.")
            created_names.add(full_name.lower())
            created_names.add(name.lower())
            continue

        if not target_text:
            change.errors.append(f"'account' (existing name, number or id:<Id>) is required for '{action}'.")
            continue
        try:
            account = index.get(target_text)
        except LookupError_ as exc:
            change.errors.append(str(exc))
            continue
        change.account = account
        change.label = account["FullyQualifiedName"]

        if action == "update":
            if row.get("name") and row["name"] != account["Name"]:
                _validate_name(row["name"], change.errors)
                change.fields["Name"] = row["name"]
            for column, key in (("acct_num", "AcctNum"), ("account_type", "AccountType"),
                                ("detail_type", "AccountSubType"), ("description", "Description")):
                if row.get(column) and row[column] != account.get(key, ""):
                    change.fields[key] = row[column]
            if row.get("parent"):
                _parent_field(change, row["parent"], index, created_names)
            if not change.fields and not change.parent_pending and not change.errors:
                change.errors.append("Nothing to change: every filled-in column already matches.")
        elif action == "inactivate":
            if not account.get("Active", True):
                change.errors.append("Already inactive.")
                continue
            balance = Decimal(str(account.get("CurrentBalanceWithSubAccounts", account.get("CurrentBalance", 0)) or 0))
            if account.get("Classification") in BALANCE_SHEET and balance != 0:
                change.errors.append(
                    f"Balance is {balance:,.2f}. Move the balance first (transfer-balance), then inactivate."
                )
            inactivating.add(account["Id"])
            change.fields = {"Active": False}
        elif action == "reactivate":
            if account.get("Active", True):
                change.errors.append("Already active.")
            change.fields = {"Active": True}

    # Sub-accounts must be inactive (or inactivated in this same file) before their parent.
    for change in changes:
        if change.action == "inactivate" and change.account and not change.errors:
            blocking = [c for c in children_of(index, change.account["Id"]) if c["Id"] not in inactivating]
            if blocking:
                names = ", ".join(c["FullyQualifiedName"] for c in blocking)
                change.errors.append(f"Has active sub-accounts not in this file: {names}.")

    def order(c: Change) -> tuple:
        # Creates first (parents before children, in file order), then updates, then inactivations
        # deepest first so sub-accounts go inactive before their parents.
        depth = c.label.count(":")
        rank = {"create": 0, "reactivate": 1, "update": 2, "inactivate": 3}.get(c.action, 9)
        return (rank, -depth if c.action == "inactivate" else 0, c.row)

    return sorted(changes, key=order)


def print_plan(changes: list[Change]) -> int:
    bad = [c for c in changes if c.errors]
    for c in changes:
        status = "ERROR" if c.errors else "ok"
        print(f"  row {c.row:>4}  {c.action:<10} {c.label:<45} [{status}] {c.describe()}")
        for e in c.errors:
            print(f"             -> {e}")
    good = len(changes) - len(bad)
    print(f"\n{good} change(s) ready, {len(bad)} with errors.")
    return len(bad)


def _apply(account: dict, change: Change, created_ids: dict[str, str]) -> dict:
    body = dict(account)
    for key, value in change.fields.items():
        if key == "ParentRef":
            if value is None:
                body["SubAccount"] = False
                body.pop("ParentRef", None)
            else:
                body["SubAccount"] = True
                body["ParentRef"] = {"value": value["value"]}
        else:
            body[key] = value
    if change.parent_pending:
        body["SubAccount"] = True
        body["ParentRef"] = {"value": created_ids[change.parent_pending.lower()]}
    return body


def execute_plan(client: QBOClient, changes: list[Change], command: str) -> None:
    ready = [c for c in changes if not c.errors]
    if not ready:
        print("Nothing to do.")
        return
    counts = {a: sum(1 for c in ready if c.action == a) for a in ACTIONS}
    summary = ", ".join(f"{n} {a}" for a, n in counts.items() if n)
    if not confirm_write(client, f"apply {len(ready)} chart of accounts change(s): {summary}"):
        return
    log = ResultLog(client.settings.log_dir, command, client.alias,
                    ["row", "action", "account", "status", "account_id", "details", "error"])
    created_ids: dict[str, str] = {}
    ok = failed = 0
    for c in ready:
        try:
            if c.action == "create":
                result = client.create("Account", _apply({}, c, created_ids))
                created_ids[c.label.lower()] = result["Id"]
                created_ids[result["FullyQualifiedName"].lower()] = result["Id"]
            else:
                fresh = client.read("Account", c.account["Id"])  # current SyncToken
                result = client.update("Account", _apply(fresh, c, created_ids))
            log.write(row=c.row, action=c.action, account=result.get("FullyQualifiedName", c.label),
                      status="done", account_id=result["Id"], details=c.describe())
            print(f"  done   row {c.row}: {c.action} {result.get('FullyQualifiedName', c.label)}")
            ok += 1
        except (QBOError, KeyError) as exc:
            log.write(row=c.row, action=c.action, account=c.label, status="failed", details=c.describe(), error=str(exc))
            print(f"  FAILED row {c.row}: {c.action} {c.label}: {exc}")
            failed += 1
    log.close()
    print(f"{ok} succeeded, {failed} failed.")
