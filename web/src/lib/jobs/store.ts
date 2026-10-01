import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobItems, jobs, type Company, type Job, type User } from "@/db/schema";
import type { Prepared } from "./prepare";

export async function saveJob(company: Company, user: User, p: Prepared): Promise<string> {
  return db.transaction(async (tx) => {
    const [job] = await tx.insert(jobs).values({
      companyId: company.id, kind: p.kind, title: p.title, params: p.params, preview: p.preview, createdById: user.id,
    }).returning({ id: jobs.id });
    for (let i = 0; i < p.items.length; i += 500) {
      await tx.insert(jobItems).values(p.items.slice(i, i + 500).map((it, j) => ({
        jobId: job.id, seq: i + j + 1, label: it.label.slice(0, 500), action: it.action, detail: (it.detail ?? "").slice(0, 2000),
        payload: it.payload ?? {}, status: it.status, message: (it.message ?? "").slice(0, 2000),
      })));
    }
    return job.id;
  });
}

export async function itemCounts(jobId: string): Promise<Record<string, number>> {
  const rows = await db.select({ status: jobItems.status, n: sql<number>`count(*)::int` }).from(jobItems).where(eq(jobItems.jobId, jobId)).groupBy(jobItems.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function loadItems(jobId: string) {
  return db.select().from(jobItems).where(eq(jobItems.jobId, jobId)).orderBy(asc(jobItems.seq));
}

export async function getJob(jobId: string): Promise<Job | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return undefined;
  return db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
}

export async function readyCount(jobId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(jobItems).where(and(eq(jobItems.jobId, jobId), eq(jobItems.status, "READY")));
  return r?.n ?? 0;
}
