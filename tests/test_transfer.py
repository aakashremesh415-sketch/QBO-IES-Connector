from decimal import Decimal

import pytest

from ies_tools.gl import GLLine
from ies_tools.transfer import (
    Ref, TransferError, build_lines, check_accounts, groups_from_csv, groups_from_gl, journal_body, reversal_body,
)
from tests.helpers import acct, index


def gl(account_id, net, cls_id="", cls="", name_id="", name=""):
    d, c = (net, Decimal(0)) if net > 0 else (Decimal(0), -net)
    return GLLine(account_id, "", "Expense", "1", "2026-01-01", "", name, name_id, "", cls, cls_id, "", "",
                  Decimal(d), Decimal(c), "")


OLD = [acct(str(i), f"Old {i}") for i in range(1, 6)]
NEW = acct("99", "New Combined")


def test_five_accounts_into_one_keeps_classes_and_balances():
    lines = [
        gl("1", Decimal("100"), "c1", "East"), gl("1", Decimal("50"), "c2", "West"),
        gl("2", Decimal("30"), "c1", "East"), gl("3", Decimal("-10"), "c2", "West"),
        gl("4", Decimal("25"), "c1", "East"), gl("4", Decimal("-25"), "c1", "East"),  # nets to zero: dropped
        gl("5", Decimal("7.5")),
    ]
    groups = groups_from_gl(lines, {a["Id"]: a for a in OLD})
    assert len(groups) == 5
    je = build_lines(groups, NEW, "")
    dest = {(l.klass.name if l.klass else None): (l.posting, l.amount) for l in je if l.account["Id"] == "99"}
    assert dest == {"East": ("Debit", Decimal("130.00")), "West": ("Debit", Decimal("40.00")), None: ("Debit", Decimal("7.50"))}
    src = [(l.account["Id"], l.posting, l.amount) for l in je if l.account["Id"] != "99"]
    assert ("3", "Debit", Decimal("10.00")) in src and ("1", "Credit", Decimal("100.00")) in src
    debits = sum(l.amount for l in je if l.posting == "Debit")
    assert debits == sum(l.amount for l in je if l.posting == "Credit")

    body = journal_body(je, "2026-09-30", "RECLASS-001", "note")
    first = body["Line"][0]["JournalEntryLineDetail"]
    assert first["ClassRef"] == {"value": "c1"} and first["PostingType"] == "Credit"
    assert body["DocNumber"] == "RECLASS-001"


def test_accounts_receivable_needs_a_customer_on_every_line():
    ar_old = acct("5", "Old AR", "Asset", "Accounts Receivable")
    ar_new = acct("6", "New AR", "Asset", "Accounts Receivable")
    groups = groups_from_gl([gl("5", Decimal("80"), name_id="", name="")], {"5": ar_old})
    with pytest.raises(TransferError, match="customer"):
        build_lines(groups, ar_new, "")
    groups = groups_from_gl([gl("5", Decimal("80"), name_id="cust7", name="Acme")], {"5": ar_old})
    je = build_lines(groups, ar_new, "")
    body = journal_body(je, "2026-09-30", "", "")
    assert all(l["JournalEntryLineDetail"]["Entity"] == {"Type": "Customer", "EntityRef": {"value": "cust7"}}
               for l in body["Line"])


def test_check_accounts_rules():
    idx = index(*OLD, NEW)
    assert check_accounts(OLD, NEW, idx, "USD") == []
    with pytest.raises(TransferError, match="both a source"):
        check_accounts([NEW], NEW, idx, "USD")
    parent = acct("7", "Parent")
    child = acct("8", "Parent:Child", parent="7")
    with pytest.raises(TransferError, match="sub-accounts"):
        check_accounts([parent], NEW, index(parent, child, NEW), "USD")
    ar = acct("9", "AR", "Asset", "Accounts Receivable")
    with pytest.raises(TransferError, match="Accounts Receivable"):
        check_accounts([ar], acct("10", "Bank", "Asset", "Bank"), idx, "USD")
    liab = acct("11", "Loan", "Liability", "Long Term Liability")
    assert "Liability" in check_accounts([liab], NEW, idx, "USD")[0]


def test_amounts_file_uses_normal_balance_sign():
    income = acct("20", "Old Sales", "Revenue", "Income")
    expense = acct("21", "Old Rent")
    idx = index(income, expense)
    groups = groups_from_csv([{"from_account": "Old Sales", "amount": "500"},
                              {"from_account": "Old Rent", "amount": "200"}], idx, None, None, None, None)
    assert [g.net_debit for g in groups] == [Decimal("-500"), Decimal("200")]


def test_reversal_flips_every_line():
    original = {"Id": "42", "DocNumber": "RC1", "TxnDate": "2026-09-30", "Line": [
        {"DetailType": "JournalEntryLineDetail", "Amount": 10.0,
         "JournalEntryLineDetail": {"PostingType": "Debit", "AccountRef": {"value": "1"}, "ClassRef": {"value": "c1"}}},
        {"DetailType": "JournalEntryLineDetail", "Amount": 10.0,
         "JournalEntryLineDetail": {"PostingType": "Credit", "AccountRef": {"value": "2"}}},
    ]}
    rev = reversal_body(original, "2026-10-01")
    assert [l["JournalEntryLineDetail"]["PostingType"] for l in rev["Line"]] == ["Credit", "Debit"]
    assert rev["Line"][0]["JournalEntryLineDetail"]["ClassRef"] == {"value": "c1"}
    assert rev["DocNumber"] == "RC1-R"
