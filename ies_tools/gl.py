"""Read the General Ledger report into flat lines with class, location, name and debit/credit."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

from .client import QBOClient

GL_COLUMNS = "tx_date,txn_type,doc_num,name,memo,account_name,klass_name,dept_name,debt_amt,credit_amt,is_cleared"
EARLIEST = "1900-01-01"


@dataclass
class GLLine:
    account_id: str
    account_name: str
    txn_type: str
    txn_id: str
    txn_date: str
    doc_num: str
    name: str
    name_id: str
    memo: str
    class_name: str
    class_id: str
    location_name: str
    location_id: str
    debit: Decimal
    credit: Decimal
    cleared: str

    @property
    def net_debit(self) -> Decimal:
        return self.debit - self.credit


def to_decimal(text) -> Decimal:
    s = str(text or "").strip().replace(",", "")
    if not s:
        return Decimal("0")
    negative = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        value = Decimal(s)
    except InvalidOperation:
        return Decimal("0")
    return -value if negative else value


def _column_keys(report: dict) -> list[str]:
    keys = []
    for col in report.get("Columns", {}).get("Column", []):
        key = next((m.get("Value") for m in col.get("MetaData", []) if m.get("Name") == "ColKey"), None)
        keys.append(key or col.get("ColTitle", "").strip().lower())
    return keys


class BeginningBalanceError(Exception):
    pass


def parse_gl(report: dict) -> list[GLLine]:
    keys = _column_keys(report)
    lines: list[GLLine] = []

    def walk(rows: list[dict], account_id: str, account_name: str) -> None:
        for row in rows:
            if "Header" in row:
                header = row["Header"].get("ColData", [{}])[0]
                sub_id = header.get("id", account_id)
                sub_name = header.get("value", account_name)
                walk(row.get("Rows", {}).get("Row", []), sub_id, sub_name)
                continue
            cols = row.get("ColData")
            if not cols:
                continue
            cell = {k: cols[i] if i < len(cols) else {} for i, k in enumerate(keys)}

            def v(k):
                return (cell.get(k) or {}).get("value", "") or ""

            def i(k):
                return (cell.get(k) or {}).get("id", "") or ""

            if v("tx_date").lower() == "beginning balance":
                if to_decimal(v("debt_amt")) or to_decimal(v("credit_amt")) or any(
                    to_decimal(c.get("value")) for c in cols[1:]
                ):
                    raise BeginningBalanceError(account_name)
                continue
            if not v("txn_type"):
                continue
            lines.append(GLLine(
                account_id=account_id, account_name=account_name,
                txn_type=v("txn_type"), txn_id=i("txn_type"), txn_date=v("tx_date"), doc_num=v("doc_num"),
                name=v("name"), name_id=i("name"), memo=v("memo"),
                class_name=v("klass_name"), class_id=i("klass_name"),
                location_name=v("dept_name"), location_id=i("dept_name"),
                debit=to_decimal(v("debt_amt")), credit=to_decimal(v("credit_amt")),
                cleared=v("is_cleared"),
            ))

    walk(report.get("Rows", {}).get("Row", []), "", "")
    return lines


def fetch_gl(client: QBOClient, account_ids: list[str], start: str, end: str, method: str = "Accrual") -> list[GLLine]:
    if not account_ids:
        return []
    report = client.report("GeneralLedger", {
        "account": ",".join(account_ids),
        "start_date": start,
        "end_date": end,
        "columns": GL_COLUMNS,
        "accounting_method": method,
    })
    wanted = set(account_ids)
    return [line for line in parse_gl(report) if line.account_id in wanted]


def fiscal_year_start(as_of: date, fiscal_start_month: int) -> date:
    year = as_of.year if as_of.month >= fiscal_start_month else as_of.year - 1
    return date(year, fiscal_start_month, 1)


MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def fiscal_start_month(client: QBOClient) -> int:
    name = client.company_info().get("FiscalYearStartMonth", "January")
    return MONTHS.index(name) + 1 if name in MONTHS else 1
