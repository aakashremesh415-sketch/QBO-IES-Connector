from ies_tools.accounts import build_plan
from tests.helpers import acct, index


def plan(rows, idx):
    return {c.label: c for c in build_plan(rows, idx)}


def test_create_update_and_parent_created_in_same_file():
    idx = index(acct("1", "Rent", num="6100"))
    rows = [
        {"action": "create", "name": "Facilities", "account_type": "Expense"},
        {"action": "create", "name": "Utilities", "account_type": "Expense", "parent": "Facilities", "acct_num": "6210"},
        {"action": "update", "account": "6100", "name": "Office Rent", "description": "HQ"},
        {"action": "create", "name": "Rent", "account_type": "Expense"},
        {"action": "create", "name": "Bad:Name", "account_type": "Expense"},
    ]
    changes = build_plan(rows, idx)
    by_row = {c.row: c for c in changes}
    assert not by_row[2].errors and not by_row[3].errors
    assert by_row[3].parent_pending == "Facilities"
    assert by_row[4].fields == {"Name": "Office Rent", "Description": "HQ"}
    assert "already exists" in by_row[5].errors[0]
    assert "cannot contain" in by_row[6].errors[0]
    assert [c.row for c in changes][:2] == [2, 3]  # parent created before child


def test_inactivate_refuses_balance_and_orders_children_first():
    idx = index(
        acct("1", "Cash", "Asset", "Bank", balance=10),
        acct("2", "Old", balance=0),
        acct("3", "Old:Sub", parent="2"),
        acct("4", "Lonely Parent"),
        acct("5", "Lonely Parent:Kid", parent="4"),
        acct("6", "Old Sales", "Revenue", "Income", balance=999),
    )
    changes = build_plan([
        {"action": "inactivate", "account": "Cash"},
        {"action": "inactivate", "account": "Old"},
        {"action": "inactivate", "account": "Old:Sub"},
        {"action": "inactivate", "account": "Lonely Parent"},
        {"action": "inactivate", "account": "Old Sales"},
    ], idx)
    by = {c.label: c for c in changes}
    assert "Balance is 10.00" in by["Cash"].errors[0]
    assert by["Old"].errors == [] and by["Old:Sub"].errors == []
    assert "sub-accounts" in by["Lonely Parent"].errors[0]
    assert by["Old Sales"].errors == []  # income/expense accounts can be inactivated with history
    labels = [c.label for c in changes]
    assert labels.index("Old:Sub") < labels.index("Old")


def test_unknown_and_ambiguous_accounts():
    idx = index(acct("1", "A:Misc"), acct("2", "B:Misc"))
    changes = build_plan([{"action": "inactivate", "account": "Misc"},
                          {"action": "inactivate", "account": "Nope"},
                          {"action": "delete", "account": "A:Misc"}], idx)
    errors = [c.errors[0] for c in changes]
    assert any("more than one" in e for e in errors)
    assert any("No account named" in e for e in errors)
    assert any("Unknown action" in e for e in errors)
