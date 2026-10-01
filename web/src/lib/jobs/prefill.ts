import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, type Company, type User } from "@/db/schema";
import { hasCompanyAccess } from "@/lib/session";

/** Settings of an earlier transfer/move preview, to fill the form in again ("Change and prepare again"). */
export async function prefillFrom(user: User, company: Company, jobId: string | undefined, kind: "transfer" | "move") {
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job || job.kind !== kind || job.companyId !== company.id || !(await hasCompanyAccess(user, company.id))) return null;
  const p = job.params as Record<string, any>;
  if (!Array.isArray(p.pairs)) return null;
  return {
    jobId: job.id,
    replaces: job.status === "PREVIEW" ? job.id : undefined,
    pairs: p.pairs as { fromId: string; toId: string }[],
    asOf: p.asOf as string | undefined,
    date: p.date as string | undefined,
    plStart: p.plStart as string | undefined,
    docNumber: p.docNumber as string | undefined,
    memo: p.memo as string | undefined,
    amountsUsed: p.amountsCsv === "(file provided)",
    start: p.start && p.start !== "1900-01-01" ? (p.start as string) : undefined,
    end: p.end as string | undefined,
    includeReconciled: !!p.includeReconciled,
    mode: (p.mode === "pick" ? "pick" : "all") as "pick" | "all",
  };
}
export type Prefill = NonNullable<Awaited<ReturnType<typeof prefillFrom>>>;
