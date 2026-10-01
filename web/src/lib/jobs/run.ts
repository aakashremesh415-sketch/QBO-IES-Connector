/**
 * Confirming and running jobs. A confirmed job is worked through in short steps (one HTTP call
 * each) so no single request runs into the hosting time limit; the job page keeps calling
 * /step until nothing is left. A per-job advisory lock keeps two browser tabs from running the
 * same job at once, which also keeps items in order (a parent account before its sub-accounts).
 */
import { and, asc, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { companies, jobItems, jobs, type Job, type JobItem, type User } from "@/db/schema";
import { QboClient, QboError, type Qbo } from "@/lib/qbo/client";
import { applyChange } from "@/lib/logic/accounts";
import { sameAccountTransfer, trackAccountRefs, undoAccountRefs, type RefChange } from "@/lib/logic/reclass";
import { canConfirm, hasCompanyAccess } from "@/lib/session";
import { audit } from "@/lib/audit";
import { itemCounts as counts, readyCount } from "./store";

export const PREVIEW_MAX_AGE_HOURS = 4;
const STEP_BUDGET_MS = 20_000;

export class JobError extends Error {}

export async function confirmJob(job: Job, user: User, typedAlias: string): Promise<void> {
  if (!canConfirm(user.role)) throw new JobError("Your role can prepare previews but not confirm changes. Ask an operator or admin.");
  if (!(await hasCompanyAccess(user, job.companyId))) throw new JobError("You don't have access to this company.");
  if (job.status !== "PREVIEW") throw new JobError("This job has already been confirmed or cancelled.");
  const company = await db.query.companies.findFirst({ where: eq(companies.id, job.companyId) });
  if (!company) throw new JobError("Company not found.");
  if (typedAlias.trim() !== company.alias) throw new JobError(`That doesn't match. Type the company alias '${company.alias}' exactly.`);
  if (process.env.REQUIRE_SECOND_APPROVER === "true" && job.createdById === user.id) {
    throw new JobError("A second person must confirm this change: the person who prepared it can't confirm it.");
  }
  if (Date.now() - job.createdAt.getTime() > PREVIEW_MAX_AGE_HOURS * 3600_000) {
    throw new JobError(`This preview is more than ${PREVIEW_MAX_AGE_HOURS} hours old and the books may have changed. Prepare it again.`);
  }
  if ((await readyCount(job.id)) === 0) throw new JobError("Nothing in this job is ready to run.");
  const updated = await db.update(jobs)
    .set({ status: "RUNNING", confirmedById: user.id, confirmedAt: new Date() })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "PREVIEW")))
    .returning({ id: jobs.id });
  if (!updated.length) throw new JobError("This job was confirmed by someone else a moment ago.");
  await audit(user.id, "job.confirm", `${job.kind} job ${job.id} on ${company.alias}: ${job.title}`);
}

export async function cancelJob(job: Job, user: User): Promise<void> {
  if (job.status !== "PREVIEW") throw new JobError("Only a preview can be cancelled.");
  if (job.createdById !== user.id && user.role !== "ADMIN") throw new JobError("Only the person who prepared it, or an admin, can cancel it.");
  await db.update(jobs).set({ status: "CANCELLED", finishedAt: new Date() }).where(and(eq(jobs.id, job.id), eq(jobs.status, "PREVIEW")));
}

/** Names/ids of accounts created earlier in this job, so a sub-account can find its new parent. */
async function createdIds(jobId: string): Promise<Record<string, string>> {
  const done = await db.select().from(jobItems).where(and(eq(jobItems.jobId, jobId), eq(jobItems.action, "create"), eq(jobItems.status, "DONE")));
  const out: Record<string, string> = {};
  for (const d of done) {
    if (!d.resultRef) continue;
    out[d.label.toLowerCase()] = d.resultRef;
    const short = (d.payload as { shortName?: string }).shortName;
    if (short) out[short.toLowerCase()] = d.resultRef;
  }
  return out;
}

/** What an item needs so it can be undone later; saved on the item when it runs. */
export type UndoData =
  | { kind: "inactivate"; accountId: string }
  | { kind: "restore"; accountId: string; before: Record<string, unknown> }
  | { kind: "move"; entity: string; txnId: string; changes: RefChange[] };

type Outcome = { status: "DONE" | "SKIPPED"; message: string; resultRef?: string; undo?: UndoData };

// Account fields an update can change, saved before the change so it can be put back.
const ACCOUNT_FIELDS = ["Name", "AcctNum", "AccountType", "AccountSubType", "Description", "Active", "SubAccount", "ParentRef"];
const pick = (o: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

async function runUndo(qbo: Qbo, u: UndoData): Promise<Outcome> {
  if (u.kind === "move") {
    const txn = await qbo.read(u.entity, u.txnId);
    const n = undoAccountRefs(txn, u.changes);
    if (n === 0) return { status: "SKIPPED", message: "Nothing to put back: these lines were changed again since, so they were left alone." };
    await qbo.update(u.entity, txn);
    return { status: "DONE", message: `${n} line(s) put back on the original account${n === u.changes.length ? "" : ` (${u.changes.length - n} changed since and left alone)`}`, resultRef: u.txnId };
  }
  const fresh = await qbo.read("Account", u.accountId);
  if (u.kind === "inactivate") {
    // QuickBooks can't delete accounts; making the new one inactive is the closest undo.
    if (fresh.Active === false) return { status: "SKIPPED", message: "Already inactive." };
    const done = await qbo.update("Account", { ...fresh, Active: false });
    return { status: "DONE", message: `Made inactive: ${done.FullyQualifiedName} (QuickBooks doesn't allow deleting accounts)`, resultRef: done.Id };
  }
  const body: Record<string, any> = { ...fresh, ...u.before };
  if (!("ParentRef" in u.before)) {
    delete body.ParentRef;
    body.SubAccount = false;
  }
  const done = await qbo.update("Account", body);
  return { status: "DONE", message: `Put back: ${done.FullyQualifiedName}`, resultRef: done.Id };
}

export async function runItem(qbo: Qbo, job: Job, item: JobItem): Promise<Outcome> {
  const p = item.payload as Record<string, any>;
  if (item.action === "undo") return runUndo(qbo, p.undo as UndoData);
  switch (job.kind) {
    case "accounts":
    case "inactivate": {
      if (item.action === "create") {
        const created = await qbo.create("Account", applyChange({}, p as any, await createdIds(job.id)));
        return { status: "DONE", message: `Created ${created.FullyQualifiedName}`, resultRef: created.Id, undo: { kind: "inactivate", accountId: created.Id } };
      }
      const fresh = await qbo.read("Account", p.accountId); // current SyncToken
      const before = pick(fresh, ACCOUNT_FIELDS);
      const updated = await qbo.update("Account", applyChange(fresh, p as any, await createdIds(job.id)));
      return {
        status: "DONE",
        message: `${item.action === "update" ? "Updated" : item.action === "inactivate" ? "Made inactive" : "Reactivated"}: ${updated.FullyQualifiedName ?? item.label}`,
        resultRef: updated.Id,
        undo: { kind: "restore", accountId: updated.Id, before },
      };
    }
    case "transfer":
    case "reverse": {
      const je = await qbo.create("JournalEntry", p.body);
      await db.update(jobs).set({ result: { journalEntryId: je.Id, docNumber: je.DocNumber ?? "" } }).where(eq(jobs.id, job.id));
      return { status: "DONE", message: `Posted journal entry Id ${je.Id}${je.DocNumber ? ` (no. ${je.DocNumber})` : ""}`, resultRef: je.Id };
    }
    case "move": {
      const txn = await qbo.read(p.entity, p.txnId); // fresh copy with the current SyncToken
      const changes = trackAccountRefs(txn, p.mapping);
      const changed = changes.length;
      if (changed === 0) return { status: "SKIPPED", message: "No line points at the old accounts. The account may come from a product/service item or tax setting; change that instead." };
      if (sameAccountTransfer(txn)) return { status: "SKIPPED", message: "Would become a transfer from and to the same account." };
      await qbo.update(p.entity, txn);
      return { status: "DONE", message: `${changed} line(s) switched`, resultRef: p.txnId, undo: { kind: "move", entity: p.entity, txnId: p.txnId, changes } };
    }
  }
}

export type StepResult = { status: Job["status"]; counts: Record<string, number>; busy?: boolean };

export async function stepJob(job: Job, user: User, qboFor: (companyId: string) => Qbo = (id) => new QboClient(id)): Promise<StepResult> {
  if (!canConfirm(user.role) || !(await hasCompanyAccess(user, job.companyId))) throw new JobError("You can't run this job.");
  if (job.status !== "RUNNING") return { status: job.status, counts: await counts(job.id) };

  const lockClient = await pool.connect();
  let locked = false;
  try {
    const r = await lockClient.query("select pg_try_advisory_lock(hashtext($1)) as ok", [job.id]);
    locked = r.rows[0]?.ok === true;
    if (!locked) return { status: "RUNNING", counts: await counts(job.id), busy: true };

    // Anything still RUNNING belongs to a step that died mid-write. We can't know whether
    // QuickBooks applied it, so it is never retried automatically.
    await db.update(jobItems)
      .set({ status: "FAILED", message: "Interrupted while being saved. Check QuickBooks to see whether this change went through.", updatedAt: new Date() })
      .where(and(eq(jobItems.jobId, job.id), eq(jobItems.status, "RUNNING")));

    const qbo = qboFor(job.companyId);
    const started = Date.now();
    while (Date.now() - started < STEP_BUDGET_MS) {
      const [next] = await db.select().from(jobItems).where(and(eq(jobItems.jobId, job.id), eq(jobItems.status, "READY"))).orderBy(asc(jobItems.seq)).limit(1);
      if (!next) break;
      await db.update(jobItems).set({ status: "RUNNING", updatedAt: new Date() }).where(eq(jobItems.id, next.id));
      try {
        const out = await runItem(qbo, job, next);
        await db.update(jobItems).set({
          status: out.status, message: out.message.slice(0, 2000), resultRef: out.resultRef ?? null, updatedAt: new Date(),
          ...(out.undo ? { payload: { ...(next.payload as Record<string, unknown>), undo: out.undo } } : {}),
        }).where(eq(jobItems.id, next.id));
      } catch (e) {
        const msg = e instanceof QboError || e instanceof Error ? e.message : String(e);
        await db.update(jobItems).set({ status: "FAILED", message: msg.slice(0, 2000), updatedAt: new Date() }).where(eq(jobItems.id, next.id));
        // A token or connection problem will fail every remaining item the same way: stop here.
        if (e instanceof QboError && (e.status === 401 || e.status === 403)) break;
        if (!(e instanceof QboError) && /sign-in|disconnected|reconnect/i.test(msg)) break;
      }
    }

    const c = await counts(job.id);
    if (!c.READY && !c.RUNNING) {
      await db.update(jobs).set({ status: "DONE", finishedAt: new Date() }).where(eq(jobs.id, job.id));
      await audit(user.id, "job.done", `${job.kind} job ${job.id}: ${c.DONE ?? 0} done, ${c.FAILED ?? 0} failed, ${c.SKIPPED ?? 0} skipped`);
      return { status: "DONE", counts: c };
    }
    return { status: "RUNNING", counts: c };
  } finally {
    if (locked) await lockClient.query("select pg_advisory_unlock(hashtext($1))", [job.id]).catch(() => {});
    lockClient.release();
  }
}
