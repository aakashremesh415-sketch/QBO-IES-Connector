import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { apiUser, fail, json, today } from "@/lib/http";
import { hasCompanyAccess } from "@/lib/session";
import { QboClient, QboError } from "@/lib/qbo/client";
import { PrepareError, listMoveCandidates } from "@/lib/jobs/prepare";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const date = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional();
const Body = z.object({
  pairs: z.array(z.object({ fromId: z.string().min(1), toId: z.string().min(1, "Choose a new account on every row") })).min(1).max(200),
  start: date,
  end: date,
  includeReconciled: z.boolean().optional(),
});

/** Read-only: the transactions in the old accounts, so individual ones can be picked. */
export async function POST(req: Request, { params }: { params: { alias: string } }) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const company = await db.query.companies.findFirst({ where: eq(companies.alias, params.alias) });
  if (!company || !(await hasCompanyAccess(user, company.id))) return fail("Company not found.", 404);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(" "));
  try {
    const b = parsed.data;
    return json({ transactions: await listMoveCandidates(new QboClient(company.id), { ...b, start: b.start || undefined, end: b.end || undefined }, today()) });
  } catch (e) {
    if (e instanceof PrepareError) return fail(e.message);
    if (e instanceof QboError) return fail(`QuickBooks: ${e.message}`, 502);
    return fail((e as Error).message, 500);
  }
}
