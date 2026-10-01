"""OAuth 2.0 sign-in with Intuit and local token storage (one entry per company alias)."""

import json
import os
import secrets
import time
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import requests

from .config import Settings

AUTH_URL = "https://appcenter.intuit.com/connect/oauth2"
TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
SCOPE = "com.intuit.quickbooks.accounting"


class TokenStore:
    """tokens.json: {alias: {realm_id, environment, company_name, access_token, refresh_token, ...}}."""

    def __init__(self, path: Path):
        self.path = path

    def load(self) -> dict:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text())

    def get(self, alias: str) -> dict:
        data = self.load()
        if alias not in data:
            known = ", ".join(sorted(data)) or "none yet"
            raise SystemExit(f"No company signed in as '{alias}'. Signed-in companies: {known}. Run: auth --alias {alias}")
        return data[alias]

    def put(self, alias: str, entry: dict) -> None:
        data = self.load()
        data[alias] = entry
        self.path.write_text(json.dumps(data, indent=2))
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass


def new_state() -> str:
    return secrets.token_urlsafe(16)


def authorization_url(settings: Settings, state: str) -> str:
    params = {
        "client_id": settings.client_id,
        "response_type": "code",
        "scope": SCOPE,
        "redirect_uri": settings.redirect_uri,
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def parse_redirect(url: str) -> tuple[str, str, str]:
    """Return (code, realm_id, state) from the address Intuit redirected the browser to."""
    query = parse_qs(urlparse(url.strip()).query)
    if "error" in query:
        raise SystemExit(f"Intuit returned an error: {query['error'][0]}")
    try:
        return query["code"][0], query["realmId"][0], query.get("state", [""])[0]
    except KeyError:
        raise SystemExit("That address has no 'code' and 'realmId'. Paste the full address from the browser bar after signing in.")


def _token_request(settings: Settings, data: dict) -> dict:
    resp = requests.post(
        TOKEN_URL,
        data=data,
        auth=(settings.client_id, settings.client_secret),
        headers={"Accept": "application/json"},
        timeout=30,
    )
    if resp.status_code != 200:
        raise SystemExit(f"Intuit token request failed ({resp.status_code}): {resp.text}")
    tokens = resp.json()
    now = time.time()
    return {
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "access_expires_at": now + int(tokens.get("expires_in", 3600)),
        "refresh_expires_at": now + int(tokens.get("x_refresh_token_expires_in", 8640000)),
    }


def exchange_code(settings: Settings, code: str) -> dict:
    return _token_request(settings, {"grant_type": "authorization_code", "code": code, "redirect_uri": settings.redirect_uri})


def refresh_tokens(settings: Settings, refresh_token: str) -> dict:
    return _token_request(settings, {"grant_type": "refresh_token", "refresh_token": refresh_token})
