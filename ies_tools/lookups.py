"""Resolve names typed in spreadsheets (accounts, classes, locations, customers, vendors) to QuickBooks IDs."""

from .client import QBOClient


class LookupError_(Exception):
    pass


class NameIndex:
    """Case-insensitive lookup by full name, short name or account number, refusing ambiguous matches."""

    def __init__(self, kind: str, items: list[dict], full_key: str, short_key: str | None = None, number_key: str | None = None):
        self.kind = kind
        self.items = items
        self.by_id = {i["Id"]: i for i in items}
        self._full: dict[str, list[dict]] = {}
        self._short: dict[str, list[dict]] = {}
        self._number: dict[str, list[dict]] = {}
        for item in items:
            self._add(self._full, item.get(full_key), item)
            if short_key:
                self._add(self._short, item.get(short_key), item)
            if number_key:
                self._add(self._number, item.get(number_key), item)

    @staticmethod
    def _add(table: dict, key, item: dict) -> None:
        if key:
            table.setdefault(str(key).strip().lower(), []).append(item)

    def find(self, text: str) -> dict | None:
        """Return the single match, None if nothing matches; raise if more than one does."""
        key = text.strip().lower()
        if not key:
            return None
        if key.startswith("id:"):
            return self.by_id.get(key[3:].strip())
        for table in (self._full, self._number, self._short):
            hits = table.get(key, [])
            if len(hits) == 1:
                return hits[0]
            if len(hits) > 1:
                names = ", ".join(f"{h.get('FullyQualifiedName', h.get('DisplayName'))} (id {h['Id']})" for h in hits)
                raise LookupError_(f"'{text}' matches more than one {self.kind}: {names}. Use the full name or id:<Id>.")
        return None

    def get(self, text: str) -> dict:
        found = self.find(text)
        if found is None:
            raise LookupError_(f"No {self.kind} named '{text}'.")
        return found


def account_index(client: QBOClient, include_inactive: bool = True) -> NameIndex:
    where = " WHERE Active IN (true, false)" if include_inactive else ""
    accounts = client.query(f"SELECT * FROM Account{where}")
    return NameIndex("account", accounts, "FullyQualifiedName", "Name", "AcctNum")


def class_index(client: QBOClient) -> NameIndex:
    return NameIndex("class", client.query("SELECT * FROM Class"), "FullyQualifiedName", "Name")


def location_index(client: QBOClient) -> NameIndex:
    return NameIndex("location", client.query("SELECT * FROM Department"), "FullyQualifiedName", "Name")


def customer_index(client: QBOClient) -> NameIndex:
    return NameIndex("customer", client.query("SELECT * FROM Customer"), "FullyQualifiedName", "DisplayName")


def vendor_index(client: QBOClient) -> NameIndex:
    return NameIndex("vendor", client.query("SELECT * FROM Vendor"), "DisplayName")


def children_of(index: NameIndex, account_id: str, active_only: bool = True) -> list[dict]:
    return [
        a for a in index.items
        if a.get("ParentRef", {}).get("value") == account_id and (a.get("Active", True) or not active_only)
    ]
