export const SHARED_COLUMNS = ["name", "acct_num", "account_type", "detail_type", "parent", "description", "share_with"];

export const shareWith = (row: Record<string, string>) =>
  (row.share_with ?? "").split(/[;,]/).map((s) => s.trim()).filter(Boolean);

export const sharedFullName = (row: Record<string, string>) => (row.parent ? `${row.parent}:${row.name}` : row.name);
