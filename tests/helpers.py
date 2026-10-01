from ies_tools.lookups import NameIndex


def acct(id_, name, classification="Expense", account_type="Expense", parent=None, balance=0, active=True, num=""):
    a = {
        "Id": id_, "Name": name.split(":")[-1], "FullyQualifiedName": name, "Classification": classification,
        "AccountType": account_type, "Active": active, "CurrentBalance": balance,
        "CurrentBalanceWithSubAccounts": balance, "AcctNum": num, "SyncToken": "0",
    }
    if parent:
        a["ParentRef"] = {"value": parent}
        a["SubAccount"] = True
    return a


def index(*accounts):
    return NameIndex("account", list(accounts), "FullyQualifiedName", "Name", "AcctNum")
