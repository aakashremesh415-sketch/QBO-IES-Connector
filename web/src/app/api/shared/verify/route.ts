import { apiUser, fail, json } from "@/lib/http";
import { companiesFor } from "@/lib/session";
import { QboClient } from "@/lib/qbo/client";
import { csvRecords } from "@/lib/logic/csv";
import { accountIndex } from "@/lib/logic/lookups";
import { loadAccounts } from "@/lib/jobs/prepare";
import { shareWith, sharedFullName } from "@/lib/logic/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** For each shared account in the spreadsheet, check each company it should be shared with. Read-only. */
export async function POST(req: Request) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({}));
  const { headers, records } = csvRecords(String(body?.csv ?? ""));
  if (!headers.includes("name") || !headers.includes("share_with")) return fail("The spreadsheet needs at least 'name' and 'share_with' columns.");
  const rows = records.filter((r) => r.name);
  const allowed = new Map((await companiesFor(user)).map((c) => [c.alias, c]));
  const aliases = [...new Set(rows.flatMap(shareWith))];
  const indexes = new Map<string, ReturnType<typeof accountIndex> | string>();
  await Promise.all(aliases.map(async (alias) => {
    const c = allowed.get(alias);
    if (!c) return indexes.set(alias, "not connected, or you don't have access");
    try {
      indexes.set(alias, accountIndex(await loadAccounts(new QboClient(c.id))));
    } catch (e) {
      indexes.set(alias, `couldn't read: ${(e as Error).message}`);
    }
  }));
  const results = rows.flatMap((r) => shareWith(r).map((alias) => {
    const idx = indexes.get(alias)!;
    if (typeof idx === "string") return { account: sharedFullName(r), alias, status: "unchecked", note: idx };
    let found = null;
    try {
      found = idx.find(sharedFullName(r)) ?? (r.acct_num ? idx.find(r.acct_num) : null);
    } catch (e) {
      return { account: sharedFullName(r), alias, status: "unchecked", note: (e as Error).message };
    }
    if (!found) return { account: sharedFullName(r), alias, status: "missing", note: "" };
    if (found.Active === false) return { account: sharedFullName(r), alias, status: "inactive", note: "" };
    if (r.acct_num && (found.AcctNum ?? "") !== r.acct_num) return { account: sharedFullName(r), alias, status: "mismatch", note: `number is '${found.AcctNum ?? ""}'` };
    return { account: sharedFullName(r), alias, status: "present", note: "" };
  }));
  return json({ results, aliases });
}
