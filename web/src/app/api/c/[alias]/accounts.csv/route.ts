import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { apiUser, fail } from "@/lib/http";
import { hasCompanyAccess } from "@/lib/session";
import { QboClient } from "@/lib/qbo/client";
import { loadAccounts } from "@/lib/jobs/prepare";
import { toCsv } from "@/lib/logic/csv";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { alias: string } }) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const company = await db.query.companies.findFirst({ where: eq(companies.alias, params.alias) });
  if (!company || !(await hasCompanyAccess(user, company.id))) return fail("Company not found.", 404);
  const accounts = await loadAccounts(new QboClient(company.id));
  const byId = new Map(accounts.map((a) => [a.Id, a]));
  const headers = ["Id", "FullyQualifiedName", "Name", "AcctNum", "AccountType", "AccountSubType", "Classification", "Parent", "Active", "CurrentBalance", "Currency", "Description"];
  const rows = accounts
    .sort((a, b) => a.FullyQualifiedName.localeCompare(b.FullyQualifiedName))
    .map((a) => ({ ...a, Parent: byId.get(a.ParentRef?.value)?.FullyQualifiedName ?? "", Currency: a.CurrencyRef?.value ?? "" }));
  return new Response(toCsv(headers, rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="chart-of-accounts-${company.alias}.csv"` },
  });
}
