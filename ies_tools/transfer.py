"""Move balances from several accounts into one account with a single journal entry, keeping classes."""

import csv
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

from .client import QBOClient
from .gl import EARLIEST, BeginningBalanceError, fetch_gl, fiscal_start_month, fiscal_year_start, to_decimal
from .lookups import NameIndex, children_of, class_index, customer_index, location_index, vendor_index
from .safety import ResultLog, confirm_write

CENT = Decimal("0.01")
DEBIT_NORMAL = ("Asset", "Expense")
PROFIT_AND_LOSS = ("Revenue", "Expense")
ENTITY_ACCOUNT_TYPES = {"Accounts Receivable": "Customer", "Accounts Payable": "Vendor"}


class TransferError(Exception):
    pass


@dataclass
class Ref:
    id: str
    name: str


@dataclass
class TransferGroup:
    from_account: dict
    klass: Ref | None
    location: Ref | None
    entity_type: str | None
    entity: Ref | None
    net_debit: Decimal


@dataclass
class JELine:
    posting: str  # Debit or Credit
    amount: Decimal
    account: dict
    klass: Ref | None
    location: Ref | None
    entity_type: str | None
    entity: Ref | None
    description: str


def _ref(id_: str, name: str) -> Ref | None:
    return Ref(id_, name) if (id_ or name) else None


def groups_from_gl(lines, accounts_by_id: dict[str, dict]) -> list[TransferGroup]:
    totals: dict[tuple, TransferGroup] = {}
    for line in lines:
        account = accounts_by_id[line.account_id]
        entity_type = ENTITY_ACCOUNT_TYPES.get(account.get("AccountType"))
        entity = _ref(line.name_id, line.name) if entity_type else None
        key = (line.account_id, line.class_id or line.class_name, line.location_id or line.location_name,
               entity.id if entity else "")
        group = totals.get(key)
        if group is None:
            group = totals[key] = TransferGroup(
                account, _ref(line.class_id, line.class_name), _ref(line.location_id, line.location_name),
                entity_type, entity, Decimal("0"),
            )
        group.net_debit += line.net_debit
    return [g for g in totals.values() if g.net_debit.quantize(CENT) != 0]


AMOUNT_COLUMNS = ["from_account", "class", "location", "customer_or_vendor", "amount"]


def groups_from_csv(rows: list[dict], accounts: NameIndex, classes: NameIndex | None, locations: NameIndex | None,
                    customers: NameIndex | None, vendors: NameIndex | None) -> list[TransferGroup]:
    """'amount' is the balance to move in the account's normal direction (a normal balance is positive)."""
    groups = []
    for n, row in enumerate(rows, start=2):
        if not row.get("from_account"):
            continue
        try:
            account = accounts.get(row["from_account"])
            klass = location = entity = None
            if row.get("class"):
                c = classes.get(row["class"])
                klass = Ref(c["Id"], c["FullyQualifiedName"])
            if row.get("location"):
                d = locations.get(row["location"])
                location = Ref(d["Id"], d["FullyQualifiedName"])
            entity_type = ENTITY_ACCOUNT_TYPES.get(account.get("AccountType"))
            if entity_type and row.get("customer_or_vendor"):
                idx = customers if entity_type == "Customer" else vendors
                e = idx.get(row["customer_or_vendor"])
                entity = Ref(e["Id"], e.get("DisplayName") or e.get("FullyQualifiedName", ""))
        except Exception as exc:
            raise TransferError(f"Row {n}: {exc}")
        amount = to_decimal(row.get("amount"))
        net_debit = amount if account.get("Classification") in DEBIT_NORMAL else -amount
        if net_debit.quantize(CENT) != 0:
            groups.append(TransferGroup(account, klass, location, entity_type, entity, net_debit))
    return groups


def check_accounts(from_accounts: list[dict], to_account: dict, index: NameIndex, home_currency: str) -> list[str]:
    """Return warnings; raise TransferError for anything that would make a wrong or rejected entry."""
    warnings = []
    if not to_account.get("Active", True):
        raise TransferError(f"Destination account '{to_account['FullyQualifiedName']}' is inactive.")
    for a in from_accounts:
        name = a["FullyQualifiedName"]
        if a["Id"] == to_account["Id"]:
            raise TransferError(f"'{name}' is both a source and the destination.")
        kids = children_of(index, a["Id"])
        if kids:
            raise TransferError(
                f"'{name}' has sub-accounts ({', '.join(k['FullyQualifiedName'] for k in kids)}). "
                "List each sub-account as its own --from so every balance is moved."
            )
        for acct in (a, to_account):
            cur = acct.get("CurrencyRef", {}).get("value")
            if cur and home_currency and cur != home_currency:
                raise TransferError(f"'{acct['FullyQualifiedName']}' is in {cur}; foreign-currency accounts are not supported.")
        if a.get("AccountType") in ENTITY_ACCOUNT_TYPES and a.get("AccountType") != to_account.get("AccountType"):
            raise TransferError(
                f"'{name}' is {a['AccountType']}; its balance can only move to another {a['AccountType']} account."
            )
        if a.get("Classification") != to_account.get("Classification"):
            warnings.append(
                f"'{name}' is {a.get('Classification')} but the destination is {to_account.get('Classification')}."
            )
        if a.get("AccountType") in ("Bank", "Credit Card"):
            warnings.append(f"'{name}' is a {a['AccountType']} account: the entry will appear in its register and reconciliation.")
    return warnings


def build_lines(groups: list[TransferGroup], to_account: dict, memo: str) -> list[JELine]:
    lines: list[JELine] = []
    dest: dict[tuple, JELine] = {}
    for g in groups:
        amount = g.net_debit.quantize(CENT)
        if g.entity_type and g.entity is None:
            raise TransferError(
                f"Part of the balance in '{g.from_account['FullyQualifiedName']}' has no {g.entity_type.lower()}; "
                f"QuickBooks requires one on every {g.from_account['AccountType']} line."
            )
        source_desc = memo or f"Transfer balance to {to_account['FullyQualifiedName']}"
        # Reverse the balance out of the old account...
        lines.append(JELine("Credit" if amount > 0 else "Debit", abs(amount), g.from_account, g.klass, g.location,
                            g.entity_type, g.entity, source_desc))
        # ...and put the same amount, with the same class/location/name, into the new account.
        key = (g.klass.id if g.klass else "", g.location.id if g.location else "", g.entity.id if g.entity else "")
        line = dest.get(key)
        if line is None:
            line = dest[key] = JELine("Debit", Decimal("0"), to_account, g.klass, g.location, g.entity_type, g.entity,
                                      memo or "Balance transferred in")
        line.amount += amount  # signed for now
    for line in dest.values():
        if line.amount == 0:
            continue
        if line.amount < 0:
            line.posting, line.amount = "Credit", -line.amount
        lines.append(line)
    debits = sum(l.amount for l in lines if l.posting == "Debit")
    credits = sum(l.amount for l in lines if l.posting == "Credit")
    if debits != credits:
        raise TransferError(f"Entry does not balance: debits {debits} vs credits {credits}.")
    return lines


def journal_body(lines: list[JELine], txn_date: str, doc_number: str, private_note: str) -> dict:
    body_lines = []
    for l in lines:
        detail = {"PostingType": l.posting, "AccountRef": {"value": l.account["Id"]}}
        if l.klass and l.klass.id:
            detail["ClassRef"] = {"value": l.klass.id}
        if l.location and l.location.id:
            detail["DepartmentRef"] = {"value": l.location.id}
        if l.entity and l.entity.id:
            detail["Entity"] = {"Type": l.entity_type, "EntityRef": {"value": l.entity.id}}
        body_lines.append({
            "DetailType": "JournalEntryLineDetail",
            "Amount": float(l.amount),
            "Description": l.description[:4000],
            "JournalEntryLineDetail": detail,
        })
    body = {"TxnDate": txn_date, "Line": body_lines}
    if doc_number:
        body["DocNumber"] = doc_number[:21]
    if private_note:
        body["PrivateNote"] = private_note[:4000]
    return body


def print_lines(lines: list[JELine]) -> None:
    print(f"  {'Account':<40} {'Debit':>14} {'Credit':>14}  {'Class':<20} {'Location':<16} Name")
    for l in lines:
        dr = f"{l.amount:,.2f}" if l.posting == "Debit" else ""
        cr = f"{l.amount:,.2f}" if l.posting == "Credit" else ""
        print(f"  {l.account['FullyQualifiedName'][:40]:<40} {dr:>14} {cr:>14}  "
              f"{(l.klass.name if l.klass else '(no class)')[:20]:<20} "
              f"{(l.location.name if l.location else '')[:16]:<16} {l.entity.name if l.entity else ''}")
    total = sum(l.amount for l in lines if l.posting == "Debit")
    print(f"  {'TOTAL':<40} {total:>14,.2f} {total:>14,.2f}")


def balances_from_ledger(client: QBOClient, from_accounts: list[dict], as_of: date, pl_start: date | None) -> list[TransferGroup]:
    """Balance sheet accounts: all history to the as-of date. P&L accounts: fiscal year to date."""
    bs = [a["Id"] for a in from_accounts if a.get("Classification") not in PROFIT_AND_LOSS]
    pl = [a["Id"] for a in from_accounts if a.get("Classification") in PROFIT_AND_LOSS]
    by_id = {a["Id"]: a for a in from_accounts}
    lines = []
    try:
        lines += fetch_gl(client, bs, EARLIEST, as_of.isoformat())
        if pl:
            start = pl_start or fiscal_year_start(as_of, fiscal_start_month(client))
            print(f"Income/expense accounts: using activity from {start} to {as_of} (fiscal year to date).")
            lines += fetch_gl(client, pl, start.isoformat(), as_of.isoformat())
    except BeginningBalanceError as exc:
        raise TransferError(f"The ledger for '{exc}' starts with an opening balance; use an earlier --pl-start date.")
    groups = groups_from_gl(lines, by_id)
    fill_missing_ids(client, groups)
    return groups


def fill_missing_ids(client: QBOClient, groups: list[TransferGroup]) -> None:
    """The ledger report sometimes gives only names; look up IDs so classes and names are not dropped."""
    def resolve(refs, loader):
        refs = [r for r in refs if r and r.name and not r.id]
        if not refs:
            return
        index = loader(client)
        for r in refs:
            try:
                r.id = index.get(r.name)["Id"]
            except Exception as exc:
                raise TransferError(f"Could not find the ID for '{r.name}': {exc}")
    resolve([g.klass for g in groups], class_index)
    resolve([g.location for g in groups], location_index)
    resolve([g.entity for g in groups if g.entity_type == "Customer"], customer_index)
    resolve([g.entity for g in groups if g.entity_type == "Vendor"], vendor_index)


def compare_to_quickbooks(groups: list[TransferGroup], from_accounts: list[dict], as_of: date) -> list[str]:
    """Cross-check ledger totals against QuickBooks' own current balance for balance sheet accounts."""
    if as_of < date.today():
        return []
    notes = []
    for a in from_accounts:
        if a.get("Classification") in PROFIT_AND_LOSS:
            continue
        total = sum((g.net_debit for g in groups if g.from_account["Id"] == a["Id"]), Decimal("0"))
        natural = total if a.get("Classification") in DEBIT_NORMAL else -total
        qb = to_decimal(a.get("CurrentBalance"))
        if natural.quantize(CENT) != qb.quantize(CENT):
            notes.append(
                f"'{a['FullyQualifiedName']}': ledger total {natural:,.2f} differs from QuickBooks balance {qb:,.2f}. "
                "Check for future-dated transactions before posting."
            )
    return notes


def read_amounts(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        missing = {"from_account", "amount"} - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"{path} is missing column(s): {', '.join(sorted(missing))}. See templates/transfer_amounts.csv.")
        return [{k.strip(): (v or "").strip() for k, v in r.items() if k} for r in reader]


def lookups_for_csv(client: QBOClient, rows: list[dict]):
    need = lambda col: any(r.get(col) for r in rows)
    classes = class_index(client) if need("class") else None
    locations = location_index(client) if need("location") else None
    customers = customer_index(client) if need("customer_or_vendor") else None
    vendors = vendor_index(client) if need("customer_or_vendor") else None
    return classes, locations, customers, vendors


def post_journal(client: QBOClient, lines: list[JELine], body: dict, command: str) -> dict | None:
    total = sum(l.amount for l in lines if l.posting == "Debit")
    if not confirm_write(client, f"post 1 journal entry dated {body['TxnDate']} with {len(lines)} lines, total {total:,.2f}"):
        return None
    created = client.create("JournalEntry", body)
    log = ResultLog(client.settings.log_dir, command, client.alias,
                    ["journal_entry_id", "doc_number", "date", "posting", "amount", "account", "class", "location", "name"])
    for l in lines:
        log.write(journal_entry_id=created["Id"], doc_number=created.get("DocNumber", ""), date=created["TxnDate"],
                  posting=l.posting, amount=f"{l.amount:.2f}", account=l.account["FullyQualifiedName"],
                  location=l.location.name if l.location else "", name=l.entity.name if l.entity else "",
                  **{"class": l.klass.name if l.klass else ""})
    log.close()
    print(f"Posted journal entry Id {created['Id']} (no. {created.get('DocNumber', '-')}).")
    print(f"To undo it: python -m ies_tools reverse-je --company {client.alias} --id {created['Id']} --date <date>")
    return created


def reversal_body(original: dict, txn_date: str) -> dict:
    lines = []
    for line in original.get("Line", []):
        if line.get("DetailType") != "JournalEntryLineDetail":
            continue
        detail = dict(line["JournalEntryLineDetail"])
        detail["PostingType"] = "Credit" if detail["PostingType"] == "Debit" else "Debit"
        lines.append({"DetailType": "JournalEntryLineDetail", "Amount": line["Amount"],
                      "Description": line.get("Description", ""), "JournalEntryLineDetail": detail})
    doc = original.get("DocNumber", "")
    return {
        "TxnDate": txn_date,
        "DocNumber": (doc[:19] + "-R") if doc else f"REV{original['Id']}"[:21],
        "PrivateNote": f"Reversal of journal entry Id {original['Id']} ({doc or 'no number'}) dated {original['TxnDate']}",
        "Line": lines,
    }
