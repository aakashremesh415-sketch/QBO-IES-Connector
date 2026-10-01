"""Thin QuickBooks Online Accounting API client: query, read, create, update and reports."""

import time

import requests

from .auth import TokenStore, refresh_tokens
from .config import Settings

PAGE_SIZE = 1000


class QBOError(Exception):
    def __init__(self, message: str, status: int | None = None, intuit_tid: str | None = None):
        detail = message
        if intuit_tid:
            detail += f" (intuit_tid {intuit_tid})"
        super().__init__(detail)
        self.status = status


def quote(value: str) -> str:
    """Quote a string literal for the QuickBooks query language."""
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _fault_message(body: dict) -> str:
    fault = body.get("Fault") or body.get("fault") or {}
    errors = fault.get("Error") or fault.get("error") or []
    parts = []
    for err in errors:
        msg = err.get("Message") or err.get("message") or ""
        det = err.get("Detail") or err.get("detail") or ""
        parts.append(f"{msg}: {det}" if det and det != msg else msg)
    return "; ".join(p for p in parts if p) or str(body)


class QBOClient:
    def __init__(self, settings: Settings, store: TokenStore, alias: str):
        self.settings = settings
        self.store = store
        self.alias = alias
        self.entry = store.get(alias)
        if self.entry.get("environment") != settings.environment:
            raise SystemExit(
                f"'{alias}' was signed in for {self.entry.get('environment')}, but QBO_ENVIRONMENT is "
                f"{settings.environment}. Sign in again or change QBO_ENVIRONMENT."
            )
        self.realm_id = self.entry["realm_id"]
        self.session = requests.Session()

    @property
    def company_name(self) -> str:
        return self.entry.get("company_name") or self.realm_id

    def _access_token(self, force_refresh: bool = False) -> str:
        if force_refresh or time.time() > self.entry["access_expires_at"] - 300:
            if time.time() > self.entry.get("refresh_expires_at", 0):
                raise SystemExit(f"Sign-in for '{self.alias}' has expired. Run: auth --alias {self.alias}")
            self.entry.update(refresh_tokens(self.settings, self.entry["refresh_token"]))
            # Intuit rotates refresh tokens, so the new one must be saved straight away.
            self.store.put(self.alias, self.entry)
        return self.entry["access_token"]

    def request(self, method: str, path: str, params: dict | None = None, json: dict | None = None) -> dict:
        url = f"{self.settings.base_url}/v3/company/{self.realm_id}/{path}"
        params = {**(params or {}), "minorversion": self.settings.minor_version}
        refreshed = False
        for attempt in range(5):
            headers = {
                "Authorization": f"Bearer {self._access_token()}",
                "Accept": "application/json",
            }
            if json is not None:
                headers["Content-Type"] = "application/json"
            resp = self.session.request(method, url, params=params, json=json, headers=headers, timeout=60)
            if resp.status_code == 401 and not refreshed:
                self._access_token(force_refresh=True)
                refreshed = True
                continue
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** (attempt + 1))
                continue
            tid = resp.headers.get("intuit_tid")
            try:
                body = resp.json()
            except ValueError:
                raise QBOError(f"HTTP {resp.status_code}: {resp.text[:500]}", resp.status_code, tid)
            if resp.status_code >= 400 or "Fault" in body:
                raise QBOError(_fault_message(body), resp.status_code, tid)
            return body
        raise QBOError("Gave up after repeated retries", None, None)

    def query(self, statement: str) -> list[dict]:
        """Run a query and follow pages until every row is returned."""
        results: list[dict] = []
        start = 1
        while True:
            page = f"{statement} STARTPOSITION {start} MAXRESULTS {PAGE_SIZE}"
            body = self.request("GET", "query", params={"query": page})
            qr = body.get("QueryResponse", {})
            rows = next((v for v in qr.values() if isinstance(v, list)), [])
            results.extend(rows)
            if len(rows) < PAGE_SIZE:
                return results
            start += PAGE_SIZE

    def read(self, entity: str, entity_id: str) -> dict:
        return self.request("GET", f"{entity.lower()}/{entity_id}")[entity]

    def create(self, entity: str, body: dict) -> dict:
        return self.request("POST", entity.lower(), json=body)[entity]

    def update(self, entity: str, body: dict) -> dict:
        """Full update: body must carry Id and the current SyncToken."""
        return self.request("POST", entity.lower(), json=body)[entity]

    def report(self, name: str, params: dict) -> dict:
        return self.request("GET", f"reports/{name}", params=params)

    def company_info(self) -> dict:
        return self.read("CompanyInfo", self.realm_id)
