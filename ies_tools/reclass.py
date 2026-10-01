"""Move existing transactions from old accounts to a new account, one transaction at a time.

Each transaction is read, every account reference pointing at an old account is switched to the new
one, and it is saved back. Classes, locations, names, amounts and dates are left exactly as they were.
"""

import copy
from dataclasses import dataclass, field

from .client import QBOClient, QBOError
from .gl import GLLine, fetch_gl
from .safety import ResultLog, confirm_write

# General Ledger "Transaction Type" text -> API entity name.
TXN_TYPES = {
    "Journal Entry": "JournalEntry",
    "Expense": "Purchase",
    "Check": "Purchase",
    "Cash Expense": "Purchase",
    "Credit Card Expense": "Purchase",
    "Credit Card Credit": "Purchase",
    "Bill": "Bill",
    "Vendor Credit": "VendorCredit",
    "Deposit": "Deposit",
    "Transfer": "Transfer",
    "Sales Receipt": "SalesReceipt",
    "Payment": "Payment",
    "Receive Payment": "Payment",
    "Bill Payment (Check)": "BillPayment",
    "Bill Payment (Credit Card)": "BillPayment",
    "Refund": "RefundReceipt",
}


@dataclass
class Candidate:
    txn_type: str
    txn_id: str
    txn_date: str
    doc_num: str
    name: str
    amount: str
    entity: str | None
    lines: list[GLLine] = field(default_factory=list)
    skip_reason: str = ""
    refs_to_change: int = 0


def replace_account_refs(obj, mapping: dict[str, str]) -> int:
    """Switch every *AccountRef whose value is in mapping; returns how many were switched."""
    count = 0
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key.endswith("AccountRef") and isinstance(value, dict) and value.get("value") in mapping:
                value["value"] = mapping[value["value"]]
                value.pop("name", None)
                count += 1
            else:
                count += replace_account_refs(value, mapping)
    elif isinstance(obj, list):
        for item in obj:
            count += replace_account_refs(item, mapping)
    return count


def find_candidates(lines: list[GLLine], include_reconciled: bool) -> list[Candidate]:
    by_txn: dict[tuple, Candidate] = {}
    for line in lines:
        key = (line.txn_type, line.txn_id)
        c = by_txn.get(key)
        if c is None:
            c = by_txn[key] = Candidate(line.txn_type, line.txn_id, line.txn_date, line.doc_num, line.name, "",
                                        TXN_TYPES.get(line.txn_type))
        c.lines.append(line)
    for c in by_txn.values():
        net = sum((l.net_debit for l in c.lines), start=0)
        c.amount = f"{net:,.2f}"
        if not c.txn_id:
            c.skip_reason = "no transaction id in the ledger report"
        elif c.entity is None:
            c.skip_reason = f"'{c.txn_type}' transactions can't be changed through the API; change these by hand"
        elif not include_reconciled and any(l.cleared == "R" for l in c.lines):
            c.skip_reason = "reconciled (use --include-reconciled to move it anyway)"
    return sorted(by_txn.values(), key=lambda c: (c.txn_date, c.txn_type, c.txn_id))


def same_account_transfer(txn: dict) -> bool:
    return "FromAccountRef" in txn and txn.get("FromAccountRef", {}).get("value") == txn.get("ToAccountRef", {}).get("value")


def inspect(client: QBOClient, candidates: list[Candidate], mapping: dict[str, str]) -> None:
    """Read each transaction (read-only) to confirm the account really can be switched on it."""
    for c in candidates:
        if c.skip_reason:
            continue
        try:
            txn = copy.deepcopy(client.read(c.entity, c.txn_id))
        except QBOError as exc:
            c.skip_reason = f"could not read: {exc}"
            continue
        c.refs_to_change = replace_account_refs(txn, mapping)
        if c.refs_to_change == 0:
            c.skip_reason = "the account comes from a product/service or tax setting, not the transaction; change that item instead"
        elif same_account_transfer(txn):
            c.skip_reason = "would become a transfer from and to the same account"


def print_candidates(candidates: list[Candidate]) -> None:
    for c in candidates:
        status = f"SKIP: {c.skip_reason}" if c.skip_reason else f"move ({c.refs_to_change} line(s))"
        print(f"  {c.txn_date:<11} {c.txn_type:<26} {c.doc_num[:12]:<12} {c.name[:24]:<24} {c.amount:>14}  {status}")
    ready = sum(1 for c in candidates if not c.skip_reason)
    print(f"\n{ready} transaction(s) ready to move, {len(candidates) - ready} skipped.")


def move(client: QBOClient, candidates: list[Candidate], mapping: dict[str, str], to_name: str, command: str) -> None:
    ready = [c for c in candidates if not c.skip_reason]
    if not ready:
        print("Nothing to move.")
        return
    if not confirm_write(client, f"change {len(ready)} transaction(s) so they post to '{to_name}'"):
        return
    log = ResultLog(client.settings.log_dir, command, client.alias,
                    ["txn_type", "txn_id", "date", "doc_number", "name", "amount", "lines_changed", "status", "error"])
    ok = failed = 0
    for c in ready:
        row = dict(txn_type=c.txn_type, txn_id=c.txn_id, date=c.txn_date, doc_number=c.doc_num, name=c.name, amount=c.amount)
        try:
            txn = client.read(c.entity, c.txn_id)  # fresh copy with the current SyncToken
            changed = replace_account_refs(txn, mapping)
            if changed == 0:
                raise QBOError("no lines on the old account any more")
            client.update(c.entity, txn)
            log.write(**row, lines_changed=changed, status="moved")
            print(f"  moved  {c.txn_type} {c.doc_num or c.txn_id} ({changed} line(s))")
            ok += 1
        except QBOError as exc:
            log.write(**row, status="failed", error=str(exc))
            print(f"  FAILED {c.txn_type} {c.doc_num or c.txn_id}: {exc}")
            failed += 1
    log.close()
    print(f"{ok} moved, {failed} failed.")


def gather(client: QBOClient, from_ids: list[str], start: str, end: str, include_reconciled: bool) -> list[Candidate]:
    return find_candidates(fetch_gl(client, from_ids, start, end), include_reconciled)
