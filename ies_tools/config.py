"""Settings loaded from environment variables or a local .env file."""

import os
from dataclasses import dataclass
from pathlib import Path

BASE_URLS = {
    "sandbox": "https://sandbox-quickbooks.api.intuit.com",
    "production": "https://quickbooks.api.intuit.com",
}


def load_env_file(path: Path = Path(".env")) -> None:
    """Read KEY=VALUE lines into os.environ without overriding variables already set."""
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass
class Settings:
    client_id: str
    client_secret: str
    redirect_uri: str
    environment: str
    minor_version: str
    tokens_file: Path
    log_dir: Path

    @property
    def base_url(self) -> str:
        return BASE_URLS[self.environment]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


def get_settings() -> Settings:
    load_env_file()
    environment = os.environ.get("QBO_ENVIRONMENT", "sandbox").strip().lower()
    if environment not in BASE_URLS:
        raise SystemExit(f"QBO_ENVIRONMENT must be 'sandbox' or 'production', not '{environment}'.")
    missing = [k for k in ("QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI") if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"Missing settings: {', '.join(missing)}. Copy .env.example to .env and fill it in.")
    return Settings(
        client_id=os.environ["QBO_CLIENT_ID"],
        client_secret=os.environ["QBO_CLIENT_SECRET"],
        redirect_uri=os.environ["QBO_REDIRECT_URI"],
        environment=environment,
        minor_version=os.environ.get("QBO_MINOR_VERSION", "75"),
        tokens_file=Path(os.environ.get("QBO_TOKENS_FILE", "tokens.json")),
        log_dir=Path(os.environ.get("QBO_LOG_DIR", "logs")),
    )
