import { z } from "zod";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { apiUser, fail, json, today } from "@/lib/http";
import { hasCompanyAccess } from "@/lib/session";
import { QboClient, QboError } from "@/lib/qbo/client";
import { csvRecords } from "@/lib/logic/csv";
import { PrepareError, prepareAccounts, prepareMove, prepareReverse, prepareTransfer } from "@/lib/jobs/prepare";
import { getJob, saveJob } from "@/lib/jobs/store";
import { cancelJob } from "@/lib/jobs/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-30");
const optDate = z.union([date, z.literal("")]).optional();
const ids = z.array(z.string().min(1)).min(1, "Choose at least one account").max(200);
const pairs = z.array(z.object({ fromId: z.string().min(1), toId: z.string().min(1, "Choose a new account on every row") }))
  .min(1, "Add at least one old account -> new account row").max(200);

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("accounts"), csv: z.string().min(1, "Paste or upload a CSV").max(2_000_000), source: z.string().max(200).default("pasted CSV") }),
  z.object({ kind: z.literal("inactivate"), accountIds: ids }),
  z.object({
    kind: z.literal("transfer"), pairs, asOf: date, date: optDate,
    plStart: optDate, docNumber: z.string().max(21).optional(), memo: z.string().max(4000).optional(), amountsCsv: z.string().max(1_000_000).optional(),
  }),
  z.object({ kind: z.literal("reverse"), journalId: z.string().regex(/^\d+$/, "Journal entry Id is a number"), date }),
  z.object({
    kind: z.literal("move"), pairs, start: optDate, end: optDate, includeReconciled: z.boolean().optional(),
    selected: z.array(z.object({ key: z.string().min(1).max(200), toId: z.string().optional() })).max(5000).optional(),
  }),
]);

export async function POST(req: Request, { params }: { params: { alias: string } }) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const company = await db.query.companies.findFirst({ where: eq(companies.alias, params.alias) });
  if (!company || !(await hasCompanyAccess(user, company.id))) return fail("Company not found.", 404);

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join(" "));
  const b = parsed.data;
  const qbo = new QboClient(company.id);
  try {
    let prepared;
    if (b.kind === "accounts") {
      const { headers, records } = csvRecords(b.csv);
      if (!headers.includes("action")) return fail("The CSV needs an 'action' column. Download the template to see the layout.");
      prepared = await prepareAccounts(qbo, records, "accounts", b.source);
    } else if (b.kind === "inactivate") {
      prepared = await prepareAccounts(qbo, b.accountIds.map((id) => ({ action: "inactivate", account: `id:${id}` })), "inactivate", "account list");
    } else if (b.kind === "transfer") {
      prepared = await prepareTransfer(qbo, { ...b, date: b.date || undefined, plStart: b.plStart || undefined }, today());
    } else if (b.kind === "reverse") {
      prepared = await prepareReverse(qbo, b.journalId, b.date);
    } else {
      prepared = await prepareMove(qbo, { ...b, start: b.start || undefined, end: b.end || undefined }, today());
    }
    const id = await saveJob(company, user, prepared);
    // "Change and prepare again": the preview this one replaces is cancelled so only one stays open.
    const replaces = typeof raw?.replaces === "string" ? await getJob(raw.replaces) : undefined;
    if (replaces && replaces.companyId === company.id && replaces.status === "PREVIEW" && (replaces.createdById === user.id || user.role === "ADMIN")) {
      await cancelJob(replaces, user).catch(() => {});
    }
    return json({ id });
  } catch (e) {
    if (e instanceof PrepareError) return fail(e.message);
    if (e instanceof QboError) return fail(`QuickBooks: ${e.message}`, 502);
    return fail((e as Error).message, 500);
  }
}
