"""Confirmation prompts and CSV result logs for anything that writes to QuickBooks."""

import csv
from datetime import datetime
from pathlib import Path


def confirm_write(client, summary: str) -> bool:
    """Show what is about to happen and require the company alias to be typed back."""
    env = client.settings.environment.upper()
    print()
    print("=" * 70)
    if client.settings.is_production:
        print("  PRODUCTION COMPANY - these changes are real.")
    print(f"  Environment: {env}")
    print(f"  Company:     {client.company_name} (alias '{client.alias}', realm {client.realm_id})")
    print(f"  About to:    {summary}")
    print("=" * 70)
    typed = input(f"Type the company alias '{client.alias}' to go ahead, or anything else to cancel: ").strip()
    if typed != client.alias:
        print("Cancelled. Nothing was changed.")
        return False
    return True


class ResultLog:
    """Append-as-you-go CSV log, so a partial run still leaves a full record of what was written."""

    def __init__(self, log_dir: Path, command: str, alias: str, fieldnames: list[str]):
        log_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        self.path = log_dir / f"{stamp}-{command}-{alias}.csv"
        self.fieldnames = fieldnames
        self._fh = self.path.open("w", newline="")
        self._writer = csv.DictWriter(self._fh, fieldnames=fieldnames, extrasaction="ignore")
        self._writer.writeheader()

    def write(self, **row) -> None:
        self._writer.writerow(row)
        self._fh.flush()

    def close(self) -> None:
        self._fh.close()
        print(f"Log written to {self.path}")
