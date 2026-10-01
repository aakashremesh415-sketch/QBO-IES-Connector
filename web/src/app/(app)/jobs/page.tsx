import Link from "next/link";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { jobs, users } from "@/db/schema";
import PageHeader from "@/components/PageHeader";
import StatusPill, { KIND_LABEL } from "@/components/StatusPill";
import { companiesFor, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity" };

export default async function JobsPage({ searchParams }: { searchParams: { company?: string; status?: string } }) {
  const user = await requireUser();
  const list = await companiesFor(user);
  const byId = new Map(list.map((c) => [c.id, c]));
  const filterCompany = list.find((c) => c.alias === searchParams.company);
  const ids = filterCompany ? [filterCompany.id] : list.map((c) => c.id);
  const conds: SQL[] = [inArray(jobs.companyId, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])];
  const statuses = ["PREVIEW", "RUNNING", "DONE", "CANCELLED"] as const;
  const st = statuses.find((s) => s === searchParams.status);
  if (st) conds.push(eq(jobs.status, st));
  const rows = await db.select({ job: jobs, by: users.name }).from(jobs).innerJoin(users, eq(users.id, jobs.createdById))
    .where(and(...conds)).orderBy(desc(jobs.createdAt)).limit(200);

  return (
    <>
      <PageHeader title="Activity" subtitle="Every prepared change: previews waiting for confirmation, runs in progress and finished jobs with their full results." />
      <form className="mb-4 flex flex-wrap items-end gap-3">
        <label className="field">Company
          <select name="company" defaultValue={searchParams.company ?? ""} className="input w-56">
            <option value="">All companies</option>
            {list.map((c) => <option key={c.id} value={c.alias}>{c.companyName ?? c.alias} ({c.alias})</option>)}
          </select>
        </label>
        <label className="field">Status
          <select name="status" defaultValue={searchParams.status ?? ""} className="input w-40">
            <option value="">Any</option>
            <option value="PREVIEW">Preview</option>
            <option value="RUNNING">Running</option>
            <option value="DONE">Done</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        <button className="btn-secondary">Apply</button>
      </form>
      <section className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Prepared</th><th>Company</th><th>Type</th><th>Description</th><th>Prepared by</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map(({ job, by }) => (
              <tr key={job.id}>
                <td className="whitespace-nowrap">{job.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td>{byId.get(job.companyId)?.alias}</td>
                <td className="whitespace-nowrap">{KIND_LABEL[job.kind]}</td>
                <td><Link className="link" href={`/jobs/${job.id}`}>{job.title}</Link></td>
                <td>{by}</td>
                <td><StatusPill status={job.status} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="py-8 text-center text-ink-muted">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
