import type { Company } from "@/db/schema";
import type { AccountOption } from "@/components/tools";
import { QboClient } from "@/lib/qbo/client";
import { loadAccounts } from "@/lib/jobs/prepare";
import { toCents } from "@/lib/logic/money";

/** Accounts for a page, or the reason QuickBooks couldn't be reached (shown instead of crashing). */
export async function accountOptions(company: Company): Promise<{ accounts: AccountOption[]; error: string }> {
  if (!company.refreshTokenEnc) return { accounts: [], error: `'${company.alias}' is disconnected. An admin needs to reconnect it on the Companies page.` };
  try {
    const raw = await loadAccounts(new QboClient(company.id));
    const parents = new Set(raw.map((a) => a.ParentRef?.value).filter(Boolean));
    const accounts = raw
      .map((a) => ({
        id: a.Id, name: a.FullyQualifiedName, number: a.AcctNum ?? "", type: a.AccountType, classification: a.Classification,
        balance: toCents(a.CurrentBalanceWithSubAccounts ?? a.CurrentBalance ?? 0) / 100, active: a.Active !== false, isParent: parents.has(a.Id),
      }))
      .sort((a, b) => (a.number || "~").localeCompare(b.number || "~") || a.name.localeCompare(b.name));
    return { accounts, error: "" };
  } catch (e) {
    return { accounts: [], error: `Couldn't read the chart of accounts from QuickBooks: ${(e as Error).message}` };
  }
}
