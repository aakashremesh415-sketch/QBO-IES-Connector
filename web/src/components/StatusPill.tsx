const MAP: Record<string, [string, string]> = {
  PREVIEW: ["pill-info", "Preview"],
  RUNNING: ["pill-warn", "Running"],
  DONE: ["pill-ok", "Done"],
  CANCELLED: ["pill-grey", "Cancelled"],
  READY: ["pill-ok", "Ready"],
  ERROR: ["pill-bad", "Error"],
  FAILED: ["pill-bad", "Failed"],
  SKIPPED: ["pill-warn", "Skipped"],
};

export default function StatusPill({ status }: { status: string }) {
  const [cls, label] = MAP[status] ?? ["pill-grey", status];
  return <span className={cls}>{label}</span>;
}

export const KIND_LABEL: Record<string, string> = {
  accounts: "Chart of accounts",
  inactivate: "Make inactive",
  transfer: "Balance transfer",
  reverse: "Reverse entry",
  move: "Move transactions",
};
