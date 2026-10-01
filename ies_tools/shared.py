"""Shared chart of accounts helpers.

Intuit does not offer a public API for creating shared accounts in Consolidated View or for the
"Share with companies" setting, so that step is done in Intuit Enterprise Suite itself. These helpers
turn a spreadsheet into a checklist for that work, and afterwards check every entity to confirm each
shared account actually appears there.
"""

import csv
from pathlib import Path

from .lookups import account_index

COLUMNS = ["name", "acct_num", "account_type", "detail_type", "parent", "description", "share_with"]


def read_shared(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if "name" not in (reader.fieldnames or []) or "share_with" not in (reader.fieldnames or []):
            raise SystemExit(f"{path} needs at least 'name' and 'share_with' columns. See templates/shared_accounts.csv.")
        rows = [{k.strip(): (v or "").strip() for k, v in r.items() if k} for r in reader]
    return [r for r in rows if r.get("name")]


def companies_for(row: dict) -> list[str]:
    return [c.strip() for c in row.get("share_with", "").replace(",", ";").split(";") if c.strip()]


def write_checklist(rows: list[dict], out: Path) -> None:
    lines = [
        "# Shared chart of accounts checklist",
        "",
        "Do these in Intuit Enterprise Suite as the parent company administrator:",
        "",
        "1. Switch to **Consolidated View**.",
        "2. Go to **Chart of accounts** and select **New** (or open an existing account and select **Edit**).",
        "3. Fill in the details below, select **Share with companies**, tick each listed company, and save.",
        "4. When every box is ticked, run `shared-verify` with this same spreadsheet to confirm.",
        "",
    ]
    for r in rows:
        title = f"{r.get('acct_num', '')} {r['name']}".strip()
        lines.append(f"- [ ] **{title}**")
        for label, key in (("Account type", "account_type"), ("Detail type", "detail_type"),
                           ("Parent (sub-account of)", "parent"), ("Description", "description")):
            if r.get(key):
                lines.append(f"    - {label}: {r[key]}")
        companies = companies_for(r)
        lines.append(f"    - Share with companies: {', '.join(companies) if companies else '(none listed)'}")
        lines.append("")
    out.write_text("\n".join(lines))


def full_name(row: dict) -> str:
    return f"{row['parent']}:{row['name']}" if row.get("parent") else row["name"]


def verify(rows: list[dict], client_for) -> list[tuple[str, str, str]]:
    """Return (account, company alias, status) for every account/company pair in the spreadsheet."""
    results = []
    aliases = sorted({c for r in rows for c in companies_for(r)})
    indexes = {}
    for alias in aliases:
        try:
            indexes[alias] = account_index(client_for(alias))
        except SystemExit as exc:
            indexes[alias] = exc
    for r in rows:
        for alias in companies_for(r):
            idx = indexes[alias]
            if isinstance(idx, SystemExit):
                results.append((full_name(r), alias, f"not checked: {idx}"))
                continue
            found = idx.find(full_name(r)) or (idx.find(r["acct_num"]) if r.get("acct_num") else None)
            if not found:
                status = "MISSING"
            elif not found.get("Active", True):
                status = "inactive"
            elif r.get("acct_num") and found.get("AcctNum", "") != r["acct_num"]:
                status = f"present, but number is '{found.get('AcctNum', '')}'"
            else:
                status = "present"
            results.append((full_name(r), alias, status))
    return results
