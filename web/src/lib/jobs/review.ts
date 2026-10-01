/**
 * Reviewing a preview before it's confirmed (leave items out, put them back), and building an
 * undo for a finished job. An undo is itself a preview, so it's reviewed and confirmed the same way.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, jobItems, jobs, type Job, type User } from "@/db/schema";
import { canConfirm, hasCompanyAccess } from "@/lib/session";
import type { Prepared } from "./prepare";
import { loadItems, saveJob } from "./store";
import { JobError, type UndoData } from "./run";

export async function setItemsIncluded(job: Job, user: User, itemIds: string[], include: boolean): Promise<number> {
  if (!(await hasCompanyAccess(user, job.companyId))) throw new JobError("You don't have access to this company.");
  if (job.status !== "PREVIEW") throw new JobError("Items can only be left out or put back while the job is still a preview.");
  if (job.createdById !== user.id && !canConfirm(user.role)) throw new JobError("Only the person who prepared it, or an operator or admin, can change it.");
  if (!itemIds.length) return 0;
  const ids = itemIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const rows = include
    ? await db.update(jobItems)
        .set({ status: "READY", message: "", payload: sql`${jobItems.payload} - 'excluded'`, updatedAt: new Date() })
        .where(and(eq(jobItems.jobId, job.id), inArray(jobItems.id, ids), eq(jobItems.status, "SKIPPED"), sql`${jobItems.payload}->>'excluded' = 'true'`))
        .returning({ id: jobItems.id })
    : await db.update(jobItems)
        .set({ status: "SKIPPED", message: `Left out during review by ${user.name}.`, payload: sql`${jobItems.payload} || '{"excluded": true}'::jsonb`, updatedAt: new Date() })
        .where(and(eq(jobItems.jobId, job.id), inArray(jobItems.id, ids), eq(jobItems.status, "READY")))
        .returning({ id: jobItems.id });
  return rows.length;
}

export const UNDOABLE_KINDS = ["accounts", "inactivate", "move"] as const;

export async function undoableCount(jobId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(jobItems)
    .where(and(eq(jobItems.jobId, jobId), eq(jobItems.status, "DONE"), sql`${jobItems.payload} ? 'undo'`));
  return r?.n ?? 0;
}

export async function prepareUndo(job: Job, user: User): Promise<string> {
  if (!(await hasCompanyAccess(user, job.companyId))) throw new JobError("You don't have access to this company.");
  if (job.status !== "DONE") throw new JobError("Only a finished job can be undone.");
  if (!(UNDOABLE_KINDS as readonly string[]).includes(job.kind)) throw new JobError("Journal entries are undone with a reversing entry instead.");
  const existing = (job.result as { undoJobId?: string }).undoJobId;
  if (existing) {
    const prior = await db.query.jobs.findFirst({ where: eq(jobs.id, existing) });
    if (prior && prior.status !== "CANCELLED") throw new JobError("An undo for this job has already been prepared. Open it from the link on this page.");
  }
  const company = await db.query.companies.findFirst({ where: eq(companies.id, job.companyId) });
  if (!company) throw new JobError("Company not found.");

  // Undo in reverse order, so sub-accounts are handled before their parents.
  const done = (await loadItems(job.id)).filter((i) => i.status === "DONE" && (i.payload as { undo?: UndoData }).undo).reverse();
  if (!done.length) throw new JobError("Nothing in this job can be undone.");
  const describe = (u: UndoData) =>
    u.kind === "inactivate" ? "Make the new account inactive (QuickBooks can't delete accounts)"
      : u.kind === "restore" ? `Put back: ${Object.entries(u.before).filter(([k]) => k !== "SubAccount").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")}`
      : `Move ${u.changes.length} line(s) back to the original account`;

  const prepared: Prepared = {
    kind: job.kind as Prepared["kind"],
    title: `Undo: ${job.title}`,
    params: { undoOf: job.id },
    preview: { undoOf: job.id },
    items: done.map((i) => {
      const undo = (i.payload as { undo: UndoData }).undo;
      return { label: i.label, action: "undo", detail: describe(undo), payload: { undo }, status: "READY" as const };
    }),
  };
  const id = await saveJob(company, user, prepared);
  await db.update(jobs).set({ result: { ...(job.result as Record<string, unknown>), undoJobId: id } }).where(eq(jobs.id, job.id));
  return id;
}
