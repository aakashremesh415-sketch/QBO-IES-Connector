from decimal import Decimal

import pytest

from ies_tools.gl import BeginningBalanceError, fiscal_year_start, parse_gl, to_decimal
from datetime import date

KEYS = ["tx_date", "txn_type", "doc_num", "name", "memo", "account_name", "klass_name", "dept_name",
        "debt_amt", "credit_amt", "is_cleared"]


def cols():
    return {"Column": [{"ColTitle": k, "MetaData": [{"Name": "ColKey", "Value": k}]} for k in KEYS]}


def row(date_, type_, id_, cls="", cls_id="", dr="", cr="", cleared="", name="", name_id=""):
    vals = [date_, type_, "", name, "", "", cls, "", dr, cr, cleared]
    data = [{"value": v} for v in vals]
    data[1]["id"] = id_
    data[3]["id"] = name_id
    data[6]["id"] = cls_id
    return {"type": "Data", "ColData": data}


def report(sections):
    return {"Columns": cols(), "Rows": {"Row": [
        {"type": "Section", "Header": {"ColData": [{"value": name, "id": aid}]}, "Rows": {"Row": rows}}
        for aid, name, rows in sections
    ]}}


def test_parses_lines_per_account_with_class_and_amounts():
    rep = report([
        ("10", "Old Rent", [
            {"ColData": [{"value": "Beginning Balance"}] + [{"value": ""}] * 10},
            row("2026-01-05", "Expense", "501", "East", "c1", dr="1,200.00"),
            row("2026-02-05", "Journal Entry", "502", "West", "c2", cr="200.00", cleared="R"),
        ]),
        ("11", "Old Utilities", [row("2026-01-09", "Bill", "601", dr="50")]),
    ])
    lines = parse_gl(rep)
    assert [(l.account_id, l.txn_id, l.class_id, l.net_debit) for l in lines] == [
        ("10", "501", "c1", Decimal("1200.00")),
        ("10", "502", "c2", Decimal("-200.00")),
        ("11", "601", "", Decimal("50")),
    ]
    assert lines[1].cleared == "R"


def test_nonzero_beginning_balance_is_refused():
    opening = {"ColData": [{"value": "Beginning Balance"}] + [{"value": ""}] * 7 + [{"value": "100"}, {"value": ""}, {"value": ""}]}
    with pytest.raises(BeginningBalanceError):
        parse_gl(report([("10", "Old Rent", [opening])]))


def test_to_decimal_handles_commas_and_parentheses():
    assert to_decimal("(1,000.50)") == Decimal("-1000.50")
    assert to_decimal("") == 0


def test_fiscal_year_start():
    assert fiscal_year_start(date(2026, 3, 31), 4) == date(2025, 4, 1)
    assert fiscal_year_start(date(2026, 9, 30), 4) == date(2026, 4, 1)
    assert fiscal_year_start(date(2026, 9, 30), 1) == date(2026, 1, 1)
