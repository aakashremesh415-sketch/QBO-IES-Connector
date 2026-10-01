import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { apiUser, fail, json, today } from "@/lib/http";
import { hasCompanyAccess } from "@/lib/session";
import { QboClient, QboError } from "@/lib/qbo/client";
import { parseTrialBalance } from "@/lib/logic/tb";

export const dynamic = "force-dynamic";

/** Read-only Trial Balance as of a date, for reference while mapping accounts. */
export async function GET(req: Request, { params }: { params: { alias: string } }) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const company = await db.query.companies.findFirst({ where: eq(companies.alias, params.alias) });
  if (!company || !(await hasCompanyAccess(user, company.id))) return fail("Company not found.", 404);
  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf") ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return fail("Use a date like 2026-09-30.");
  const method = url.searchParams.get("method") === "Cash" ? "Cash" : "Accrual";
  try {
    // Trial balance as of a date: everything to that date for balance sheet accounts, fiscal year to date for income/expense.
    const report = await new QboClient(company.id).report("TrialBalance", { end_date: asOf, accounting_method: method });
    return json({ asOf, method, ...parseTrialBalance(report) });
  } catch (e) {
    if (e instanceof QboError) return fail(`QuickBooks: ${e.message}`, 502);
    return fail((e as Error).message, 500);
  }
}
