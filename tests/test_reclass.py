from decimal import Decimal

from ies_tools.gl import GLLine
from ies_tools.reclass import find_candidates, replace_account_refs


def line(type_, id_, cleared=""):
    return GLLine("1", "", type_, id_, "2026-01-01", "", "", "", "", "", "", "", "", Decimal(5), Decimal(0), cleared)


def test_replace_account_refs_switches_header_and_lines_keeps_class():
    purchase = {
        "AccountRef": {"value": "1", "name": "Old"},
        "Line": [
            {"AccountBasedExpenseLineDetail": {"AccountRef": {"value": "1"}, "ClassRef": {"value": "c1"}}},
            {"AccountBasedExpenseLineDetail": {"AccountRef": {"value": "3"}}},
        ],
    }
    assert replace_account_refs(purchase, {"1": "9", "2": "9"}) == 2
    assert purchase["AccountRef"] == {"value": "9"}
    assert purchase["Line"][0]["AccountBasedExpenseLineDetail"] == {"AccountRef": {"value": "9"}, "ClassRef": {"value": "c1"}}
    assert purchase["Line"][1]["AccountBasedExpenseLineDetail"]["AccountRef"]["value"] == "3"


def test_candidates_are_deduplicated_and_skips_explained():
    cands = find_candidates([
        line("Expense", "10"), line("Expense", "10"),
        line("Payroll Check", "11"),
        line("Bill", "12", cleared="R"),
    ], include_reconciled=False)
    by_id = {c.txn_id: c for c in cands}
    assert len(cands) == 3
    assert by_id["10"].skip_reason == "" and by_id["10"].entity == "Purchase"
    assert "can't be changed" in by_id["11"].skip_reason
    assert "reconciled" in by_id["12"].skip_reason
    assert find_candidates([line("Bill", "12", cleared="R")], include_reconciled=True)[0].skip_reason == ""
