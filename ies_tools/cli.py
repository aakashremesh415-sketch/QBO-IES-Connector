"""Command-line entry point. Every command that writes previews first and only writes with --execute."""

import argparse
import csv
import sys
from datetime import date
from pathlib import Path

from . import accounts, reclass, shared, transfer
from .auth import TokenStore, authorization_url, exchange_code, new_state, parse_redirect
from .client import QBOClient, QBOError
from .config import get_settings
from .gl import EARLIEST
from .lookups import LookupError_, account_index

PREVIEW_NOTE = "\nPreview only - nothing was changed. Run again with --execute to make these changes."


def _client(args) -> QBOClient:
    settings = get_settings()
    return QBOClient(settings, TokenStore(settings.tokens_file), args.company)


def _iso(text: str) -> date:
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"'{text}' is not a date in YYYY-MM-DD format")


def _split(values: list[str]) -> list[str]:
    """Accept repeated --from options and/or semicolon-separated lists."""
    return [part.strip() for v in values for part in v.split(";") if part.strip()]


def cmd_auth(args) -> int:
    settings = get_settings()
    state = new_state()
    print(f"Environment: {settings.environment}")
    print("1. Open this address in your browser and sign in to the company you want to connect:\n")
    print(authorization_url(settings, state))
    print("\n2. After you approve, copy the FULL address from the browser bar (it contains code= and realmId=).")
    code, realm_id, returned_state = parse_redirect(input("\nPaste it here: "))
    if returned_state and returned_state != state:
        raise SystemExit("The sign-in response doesn't match this request. Start again.")
    store = TokenStore(settings.tokens_file)
    entry = {"realm_id": realm_id, "environment": settings.environment, **exchange_code(settings, code)}
    store.put(args.alias, entry)
    client = QBOClient(settings, store, args.alias)
    client.entry["company_name"] = client.company_info().get("CompanyName", "")
    store.put(args.alias, client.entry)
    print(f"Connected '{args.alias}' -> {client.entry['company_name']} (realm {realm_id}, {settings.environment}).")
    return 0


def cmd_companies(args) -> int:
    settings = get_settings()
    data = TokenStore(settings.tokens_file).load()
    if not data:
        print("No companies signed in yet. Run: python -m ies_tools auth --alias <short-name>")
    for alias, e in sorted(data.items()):
        print(f"  {alias:<20} {e.get('company_name', ''):<40} realm {e['realm_id']:<20} {e['environment']}")
    return 0


def cmd_accounts_export(args) -> int:
    n = accounts.export_accounts(_client(args), Path(args.out))
    print(f"Exported {n} accounts to {args.out}")
    return 0


def _run_plan(args, rows, command) -> int:
    client = _client(args)
    print(f"Reading chart of accounts for {client.company_name} ({client.settings.environment})...")
    changes = accounts.build_plan(rows, account_index(client))
    errors = accounts.print_plan(changes)
    if not args.execute:
        print(PREVIEW_NOTE)
        return 1 if errors else 0
    if errors and not args.skip_errors:
        print("\nFix the rows with errors (or add --skip-errors to apply only the rows marked ok).")
        return 1
    accounts.execute_plan(client, changes, command)
    return 0


def cmd_accounts_apply(args) -> int:
    return _run_plan(args, accounts.read_plan(Path(args.file)), "accounts-apply")


def cmd_accounts_inactivate(args) -> int:
    names = _split(args.account or [])
    if args.file:
        with Path(args.file).open(newline="", encoding="utf-8-sig") as fh:
            names += [(r.get("account") or "").strip() for r in csv.DictReader(fh)]
    if not names:
        raise SystemExit("Give accounts with --account (repeatable or 'A;B;C') or --file.")
    rows = [{"action": "inactivate", "account": n} for n in names if n]
    return _run_plan(args, rows, "accounts-inactivate")


def cmd_shared_checklist(args) -> int:
    rows = shared.read_shared(Path(args.file))
    shared.write_checklist(rows, Path(args.out))
    print(f"Checklist for {len(rows)} shared account(s) written to {args.out}")
    return 0


def cmd_shared_verify(args) -> int:
    settings = get_settings()
    store = TokenStore(settings.tokens_file)
    rows = shared.read_shared(Path(args.file))
    results = shared.verify(rows, lambda alias: QBOClient(settings, store, alias))
    problems = 0
    for account, alias, status in results:
        flag = "" if status == "present" else "  <--"
        problems += bool(flag)
        print(f"  {account[:45]:<45} {alias:<20} {status}{flag}")
    print(f"\n{len(results) - problems} of {len(results)} account/company pairs look right.")
    return 1 if problems else 0


def cmd_transfer_balance(args) -> int:
    client = _client(args)
    index = account_index(client)
    try:
        from_accounts = [index.get(n) for n in _split(args.from_accounts)]
        to_account = index.get(args.to)
    except LookupError_ as exc:
        raise SystemExit(str(exc))
    prefs = client.request("GET", "preferences").get("Preferences", {})
    home = prefs.get("CurrencyPrefs", {}).get("HomeCurrency", {}).get("value", "")
    as_of = args.as_of
    txn_date = (args.date or as_of).isoformat()
    try:
        warnings = transfer.check_accounts(from_accounts, to_account, index, home)
        if args.amounts_file:
            rows = transfer.read_amounts(Path(args.amounts_file))
            allowed = {a["Id"] for a in from_accounts}
            groups = transfer.groups_from_csv(rows, index, *transfer.lookups_for_csv(client, rows))
            stray = {g.from_account["FullyQualifiedName"] for g in groups if g.from_account["Id"] not in allowed}
            if stray:
                raise transfer.TransferError(f"Amounts file mentions accounts not given with --from: {', '.join(sorted(stray))}")
            notes = []
        else:
            print(f"Reading ledger balances by class as of {as_of}...")
            groups = transfer.balances_from_ledger(client, from_accounts, as_of, args.pl_start)
            notes = transfer.compare_to_quickbooks(groups, from_accounts, as_of)
        if not groups:
            print("All source accounts already have a zero balance. Nothing to transfer.")
            return 0
        lines = transfer.build_lines(groups, to_account, args.memo or "")
    except transfer.TransferError as exc:
        raise SystemExit(f"Cannot build the entry: {exc}")

    print(f"\nJournal entry dated {txn_date}, no. {args.doc_number or '(auto)'}:\n")
    transfer.print_lines(lines)
    for w in warnings + notes:
        print(f"  Note: {w}")
    body = transfer.journal_body(
        lines, txn_date, args.doc_number or "",
        args.memo or f"Balance transfer to {to_account['FullyQualifiedName']} as of {as_of}",
    )
    if not args.execute:
        print(PREVIEW_NOTE)
        return 0
    transfer.post_journal(client, lines, body, "transfer-balance")
    return 0


def cmd_reverse_je(args) -> int:
    client = _client(args)
    original = client.read("JournalEntry", args.id)
    body = transfer.reversal_body(original, args.date.isoformat())
    print(f"Reversal of journal entry {args.id} ({original.get('DocNumber', 'no number')}) dated {args.date}:")
    for line in body["Line"]:
        d = line["JournalEntryLineDetail"]
        print(f"  {d['PostingType']:<7} {line['Amount']:>14,.2f}  {d['AccountRef'].get('name', d['AccountRef']['value'])}"
              f"  {d.get('ClassRef', {}).get('name', '')}")
    if not args.execute:
        print(PREVIEW_NOTE)
        return 0
    from .safety import confirm_write
    if confirm_write(client, f"post a reversing journal entry for Id {args.id}"):
        created = client.create("JournalEntry", body)
        print(f"Posted reversing journal entry Id {created['Id']} (no. {created.get('DocNumber', '-')}).")
    return 0


def cmd_move_transactions(args) -> int:
    client = _client(args)
    index = account_index(client)
    try:
        from_accounts = [index.get(n) for n in _split(args.from_accounts)]
        to_account = index.get(args.to)
    except LookupError_ as exc:
        raise SystemExit(str(exc))
    if to_account["Id"] in {a["Id"] for a in from_accounts}:
        raise SystemExit("The destination can't also be a source.")
    mapping = {a["Id"]: to_account["Id"] for a in from_accounts}
    start = (args.start or date.fromisoformat(EARLIEST)).isoformat()
    end = (args.end or date.today()).isoformat()
    print(f"Finding transactions from {start} to {end}...")
    candidates = reclass.gather(client, list(mapping), start, end, args.include_reconciled)
    if args.limit:
        candidates = candidates[: args.limit]
    print(f"Checking {len(candidates)} transaction(s)...")
    reclass.inspect(client, candidates, mapping)
    reclass.print_candidates(candidates)
    if not args.execute:
        print(PREVIEW_NOTE)
        return 0
    reclass.move(client, candidates, mapping, to_account["FullyQualifiedName"], "move-transactions")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m ies_tools", description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    def company(sp):
        sp.add_argument("--company", required=True, help="alias you gave the company when running auth")

    def execute(sp):
        sp.add_argument("--execute", action="store_true", help="actually make the changes (default is preview only)")

    sp = sub.add_parser("auth", help="sign in to a company and save its tokens under an alias")
    sp.add_argument("--alias", required=True, help="short name for this company, e.g. us-parent or uk-entity")
    sp.set_defaults(func=cmd_auth)

    sp = sub.add_parser("companies", help="list signed-in companies")
    sp.set_defaults(func=cmd_companies)

    sp = sub.add_parser("accounts-export", help="export the chart of accounts to CSV")
    company(sp)
    sp.add_argument("--out", default="chart_of_accounts.csv")
    sp.set_defaults(func=cmd_accounts_export)

    sp = sub.add_parser("accounts-apply", help="create / update / inactivate / reactivate accounts from a CSV plan")
    company(sp)
    sp.add_argument("--file", required=True)
    sp.add_argument("--skip-errors", action="store_true", help="with --execute, apply the good rows and skip rows with errors")
    execute(sp)
    sp.set_defaults(func=cmd_accounts_apply)

    sp = sub.add_parser("accounts-inactivate", help="make accounts inactive (refuses accounts that still have a balance)")
    company(sp)
    sp.add_argument("--account", action="append", help="account name, number or id:<Id>; repeat or use 'A;B;C'")
    sp.add_argument("--file", help="CSV with an 'account' column")
    sp.add_argument("--skip-errors", action="store_true")
    execute(sp)
    sp.set_defaults(func=cmd_accounts_inactivate)

    sp = sub.add_parser("shared-checklist", help="turn a shared-accounts spreadsheet into a Consolidated View checklist")
    sp.add_argument("--file", required=True)
    sp.add_argument("--out", default="shared_accounts_checklist.md")
    sp.set_defaults(func=cmd_shared_checklist)

    sp = sub.add_parser("shared-verify", help="check every entity has the shared accounts it should")
    sp.add_argument("--file", required=True)
    sp.set_defaults(func=cmd_shared_verify)

    sp = sub.add_parser("transfer-balance", help="one journal entry moving balances (by class) into one account")
    company(sp)
    sp.add_argument("--from", dest="from_accounts", action="append", required=True,
                    help="source account; repeat for each, or 'A;B;C'")
    sp.add_argument("--to", required=True, help="destination account")
    sp.add_argument("--as-of", type=_iso, default=date.today(), help="balances as of this date (default today)")
    sp.add_argument("--date", type=_iso, help="journal entry date (default: the --as-of date)")
    sp.add_argument("--pl-start", type=_iso, help="start date for income/expense balances (default: fiscal year start)")
    sp.add_argument("--amounts-file", help="CSV of amounts to use instead of reading balances from the ledger")
    sp.add_argument("--doc-number", help="journal number (max 21 characters)")
    sp.add_argument("--memo", help="memo for the entry and its lines")
    execute(sp)
    sp.set_defaults(func=cmd_transfer_balance)

    sp = sub.add_parser("reverse-je", help="post a reversing entry for a journal entry")
    company(sp)
    sp.add_argument("--id", required=True, help="journal entry Id (shown when it was posted, and in the log)")
    sp.add_argument("--date", type=_iso, required=True)
    execute(sp)
    sp.set_defaults(func=cmd_reverse_je)

    sp = sub.add_parser("move-transactions", help="switch existing transactions from old accounts to a new one")
    company(sp)
    sp.add_argument("--from", dest="from_accounts", action="append", required=True)
    sp.add_argument("--to", required=True)
    sp.add_argument("--start", type=_iso, help="first transaction date (default: all history)")
    sp.add_argument("--end", type=_iso, help="last transaction date (default: today)")
    sp.add_argument("--include-reconciled", action="store_true", help="also move reconciled transactions")
    sp.add_argument("--limit", type=int, help="only handle the first N transactions (good for a trial run)")
    execute(sp)
    sp.set_defaults(func=cmd_move_transactions)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except QBOError as exc:
        print(f"QuickBooks error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)
        return 130
