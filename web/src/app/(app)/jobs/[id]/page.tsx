import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, users } from "@/db/schema";
import PageHeader from "@/components/PageHeader";
import StatusPill, { KIND_LABEL } from "@/components/StatusPill";
import { canConfirm, hasCompanyAccess, requireUser } from "@/lib/session";
import { getJob, itemCounts, loadItems } from "@/lib/jobs/store";
import { PREVIEW_MAX_AGE_HOURS } from "@/lib/jobs/run";
import { fmt } from "@/lib/logic/money";
import JobActions from "./JobActions";
import ItemsTable from "./ItemsTable";
import UndoButton from "./UndoButton";
import { UNDOABLE_KINDS, undoableCount } from "@/lib/jobs/review";

export const dynamic = "force-dynamic";
export const metadata = { title: "Job" };

type PreviewLine = { account: string; posting: string; amount: number; className: string; location: string; entity: string; destination: boolean };

export default async function JobPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const job = await getJob(params.id);
  if (!job || !(await hasCompanyAccess(user, job.companyId))) notFound();
  const [company, items, counts] = await Promise.all([
    db.query.companies.findFirst({ where: eq(companies.id, job.companyId) }),
    loadItems(job.id),
    itemCounts(job.id),
  ]);
  const name = async (id: string | null) => (id ? (await db.query.users.findFirst({ where: eq(users.id, id) }))?.name ?? "" : "");
  const [preparedBy, confirmedBy] = await Promise.all([name(job.createdById), name(job.confirmedById)]);
  const preview = job.preview as { lines?: PreviewLine[]; warnings?: string[]; notes?: string[]; total?: number; txnDate?: string; docNumber?: string };
  const result = job.result as { journalEntryId?: string; undoJobId?: string };
  const undoOf = (job.params as { undoOf?: string }).undoOf;
  const undoJob = result.undoJobId ? await getJob(result.undoJobId) : undefined;
  const canUndo = job.status === "DONE" && (UNDOABLE_KINDS as readonly string[]).includes(job.kind) && !undoOf
    && (!undoJob || undoJob.status === "CANCELLED") ? await undoableCount(job.id) : 0;
  const canReprepare = (job.kind === "transfer" || job.kind === "move") && Array.isArray((job.params as { pairs?: unknown }).pairs);
  const lines = preview.lines ?? [];
  const debit = lines.filter((l) => l.posting === "Debit").reduce((s, l) => s + l.amount, 0);
  const credit = lines.filter((l) => l.posting === "Credit").reduce((s, l) => s + l.amount, 0);
  const stale = job.status === "PREVIEW" && Date.now() - job.createdAt.getTime() > PREVIEW_MAX_AGE_HOURS * 3600_000;
  const secondApprover = process.env.REQUIRE_SECOND_APPROVER === "true";

  return (
    <>
      <div className="mb-2 text-sm"><Link className="link" href="/jobs">Activity</Link> <span className="text-ink-faint">/</span> {KIND_LABEL[job.kind]}</div>
      <PageHeader
        title={job.title}
        subtitle={<>{company?.companyName ?? company?.alias} ({company?.alias}) · prepared by {preparedBy} on {job.createdAt.toLocaleString("en-US")}{confirmedBy && <> · confirmed by {confirmedBy}</>}</>}
        actions={<><StatusPill status={job.status} /><a className="btn-secondary btn-sm" href={`/api/jobs/${job.id}/log.csv`}>Download log</a></>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["READY", "Ready"], ["DONE", "Done"], ["SKIPPED", "Skipped"], ["ERROR", "Errors"], ["FAILED", "Failed"]].map(([k, l]) => (
          <div key={k} className="card px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{l}</div>
            <div className={`text-2xl font-bold tabular-nums ${k === "FAILED" || k === "ERROR" ? (counts[k] ? "text-bad" : "") : ""}`}>{counts[k] ?? 0}</div>
          </div>
        ))}
      </div>

      {undoOf && <div className="banner-info mb-4"><span>This undoes <Link className="link" href={`/jobs/${undoOf}`}>an earlier job</Link>. Review the items, then confirm to put things back.</span></div>}
      {undoJob && undoJob.status !== "CANCELLED" && (
        <div className="banner-info mb-4"><span>An undo for this job was prepared: <Link className="link" href={`/jobs/${undoJob.id}`}>{undoJob.status === "DONE" ? "view the undo" : "review and confirm it"}</Link>.</span></div>
      )}
      {job.status === "PREVIEW" && canReprepare && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink-muted">Want different accounts, dates or amounts?</span>
          <Link className="btn-secondary btn-sm" href={`/c/${company?.alias}/${job.kind}?from=${job.id}`}>Change and prepare again</Link>
        </div>
      )}
      {canUndo > 0 && <UndoButton jobId={job.id} count={canUndo} />}

      {company?.environment === "production" && job.status === "PREVIEW" && <div className="banner-warn mb-4"><span><b>Production company.</b> Confirming will change your real books.</span></div>}

      <JobActions
        jobId={job.id}
        status={job.status}
        alias={company?.alias ?? ""}
        ready={counts.READY ?? 0}
        canConfirm={canConfirm(user.role) && !stale && !(secondApprover && job.createdById === user.id)}
        reason={!canConfirm(user.role) ? "Your role can prepare previews but not confirm them. Ask an operator or admin." : stale ? `This preview is more than ${PREVIEW_MAX_AGE_HOURS} hours old. Prepare it again so it reflects the books today.` : secondApprover && job.createdById === user.id ? "A second person must confirm this: you prepared it." : ""}
        canCancel={job.createdById === user.id || user.role === "ADMIN"}
        reverse={job.kind === "transfer" && job.status === "DONE" && result.journalEntryId && canConfirm(user.role) ? { journalId: result.journalEntryId } : null}
      />

      {lines.length > 0 && (
        <section className="card mb-5 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="section-title">Journal entry {preview.docNumber ? `no. ${preview.docNumber}` : ""} dated {preview.txnDate}</h2>
            {result.journalEntryId && <span className="pill-ok">Posted as Id {result.journalEntryId}</span>}
          </div>
          <table className="tbl">
            <thead><tr><th>#</th><th>Account</th><th className="num">Debits</th><th className="num">Credits</th><th>Class</th><th>Location</th><th>Name</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="text-ink-muted">{i + 1}</td>
                  <td className={l.destination ? "font-semibold text-brand-dark" : ""}>{l.account}</td>
                  <td className="num">{l.posting === "Debit" ? fmt(l.amount) : ""}</td>
                  <td className="num">{l.posting === "Credit" ? fmt(l.amount) : ""}</td>
                  <td>{l.className || <span className="text-ink-faint">No class</span>}</td>
                  <td>{l.location}</td>
                  <td>{l.entity}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td></td><td>Total</td><td className="num border-t-2 border-ink">{fmt(debit)}</td><td className="num border-t-2 border-ink">{fmt(credit)}</td>
                <td colSpan={3}>{debit === credit ? <span className="pill-ok">Balanced</span> : <span className="pill-bad">Out of balance</span>}</td>
              </tr>
            </tbody>
          </table>
          {(preview.warnings?.length || preview.notes?.length) ? (
            <div className="grid gap-2 border-t border-line px-5 py-3 text-sm">
              {preview.warnings?.map((w, i) => <div key={`w${i}`} className="flex gap-2"><span className="pill-warn">Check</span>{w}</div>)}
              {preview.notes?.map((n, i) => <div key={`n${i}`} className="flex gap-2"><span className="pill-info">Note</span>{n}</div>)}
            </div>
          ) : null}
        </section>
      )}

      <ItemsTable
        jobId={job.id}
        title={lines.length ? "Steps" : "Items"}
        editable={job.status === "PREVIEW" && items.length > 1 && (job.createdById === user.id || canConfirm(user.role))}
        items={items.map((i) => ({
          id: i.id, seq: i.seq, action: i.action, label: i.label, detail: i.detail, status: i.status, message: i.message,
          excluded: (i.payload as { excluded?: boolean }).excluded === true && i.status === "SKIPPED",
        }))}
      />
    </>
  );
}
