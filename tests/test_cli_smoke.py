"""Run whole commands against an in-memory fake QuickBooks to check they fit together."""

import builtins
from pathlib import Path
from types import SimpleNamespace

from ies_tools import cli
from tests.helpers import acct
from tests.test_gl import report, row


class FakeQBO:
    def __init__(self, tmp: Path):
        self.alias = "test-co"
        self.realm_id = "123"
        self.company_name = "Test Co"
        self.settings = SimpleNamespace(environment="sandbox", is_production=False, log_dir=tmp)
        self.accounts = [acct(str(i), f"Old {i}") for i in range(1, 6)] + [acct("99", "New Combined")]
        self.created = []
        self.updated = []
        self.txns = {"501": {"Id": "501", "SyncToken": "0", "AccountRef": {"value": "41"},
                             "Line": [{"AccountBasedExpenseLineDetail": {"AccountRef": {"value": "1"},
                                                                          "ClassRef": {"value": "c1"}}}]}}

    def query(self, sql):
        return self.accounts if "Account" in sql else []

    def request(self, method, path, **kw):
        return {"Preferences": {"CurrencyPrefs": {"HomeCurrency": {"value": "USD"}}}}

    def company_info(self):
        return {"FiscalYearStartMonth": "January"}

    def report(self, name, params):
        ids = params["account"].split(",")
        sections = [(i, f"Old {i}", [row("2026-03-01", "Expense", "501", "East", "c1", dr="100"),
                                     row("2026-03-02", "Expense", "502", "West", "c2", dr="40")]) for i in ids]
        return report(sections)

    def read(self, entity, id_):
        import copy
        return copy.deepcopy(self.txns.get(id_, {"Id": id_, "Line": []}))

    def create(self, entity, body):
        self.created.append((entity, body))
        return {"Id": "777", "TxnDate": body["TxnDate"], "DocNumber": body.get("DocNumber", "")}

    def update(self, entity, body):
        self.updated.append((entity, body))
        return body


def run(monkeypatch, tmp_path, argv, typed="test-co"):
    fake = FakeQBO(tmp_path)
    monkeypatch.setattr(cli, "_client", lambda args: fake)
    monkeypatch.setattr(builtins, "input", lambda prompt="": typed)
    code = cli.main(argv)
    return fake, code


def test_transfer_preview_writes_nothing(monkeypatch, tmp_path, capsys):
    fake, code = run(monkeypatch, tmp_path, ["transfer-balance", "--company", "x", "--from", "Old 1;Old 2;Old 3;Old 4;Old 5",
                                             "--to", "New Combined", "--as-of", "2026-09-30"])
    out = capsys.readouterr().out
    assert code == 0 and fake.created == []
    assert "TOTAL" in out and "700.00" in out and "Preview only" in out


def test_transfer_execute_posts_one_balanced_entry(monkeypatch, tmp_path):
    fake, code = run(monkeypatch, tmp_path, ["transfer-balance", "--company", "x", "--from", "Old 1", "--from", "Old 2",
                                             "--to", "New Combined", "--as-of", "2026-09-30", "--doc-number", "RC-1", "--execute"])
    assert code == 0 and len(fake.created) == 1
    entity, body = fake.created[0]
    assert entity == "JournalEntry" and body["DocNumber"] == "RC-1" and len(body["Line"]) == 6
    assert list(tmp_path.glob("*transfer-balance*.csv"))


def test_wrong_alias_cancels(monkeypatch, tmp_path):
    fake, _ = run(monkeypatch, tmp_path, ["transfer-balance", "--company", "x", "--from", "Old 1", "--to", "New Combined",
                                          "--as-of", "2026-09-30", "--execute"], typed="nope")
    assert fake.created == []


def test_move_transactions(monkeypatch, tmp_path, capsys):
    fake, code = run(monkeypatch, tmp_path, ["move-transactions", "--company", "x", "--from", "Old 1",
                                             "--to", "New Combined", "--execute"])
    out = capsys.readouterr().out
    assert code == 0
    assert len(fake.updated) == 1
    line = fake.updated[0][1]["Line"][0]["AccountBasedExpenseLineDetail"]
    assert line == {"AccountRef": {"value": "99"}, "ClassRef": {"value": "c1"}}
    assert "SKIP" in out  # txn 502 has no line on the old account


def test_inactivate_preview(monkeypatch, tmp_path, capsys):
    fake, code = run(monkeypatch, tmp_path, ["accounts-inactivate", "--company", "x", "--account", "Old 1;Old 2"])
    assert code == 0 and fake.updated == []
    assert "2 change(s) ready" in capsys.readouterr().out
