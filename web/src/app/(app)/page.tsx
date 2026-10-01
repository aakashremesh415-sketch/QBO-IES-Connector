import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs, users } from "@/db/schema";
import PageHeader from "@/components/PageHeader";
import StatusPill, { KIND_LABEL } from "@/components/StatusPill";
import { companiesFor, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requireUser();
  const list = await companiesFor(user);
  const ids = list.map((c) => c.id);
  const recent = ids.length
    ? await db.select({ job: jobs, by: users.name }).from(jobs).innerJoin(users, eq(users.id, jobs.createdById))
        .where(inArray(jobs.companyId, ids)).orderBy(desc(jobs.createdAt)).limit(10)
    : [];
  const byId = new Map(list.map((c) => [c.id, c]));
  const waiting = recent.filter((r) => r.job.status === "PREVIEW").length;

  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} subtitle="Bulk chart of accounts changes, balance transfers and transaction moves for your Intuit Enterprise Suite companies." />
      {!list.length && (
        <div className="banner-info mb-5">
          {user.role === "ADMIN"
            ? <span>No companies are connected yet. <Link className="link" href="/companies">Connect your first company</Link>.</span>
            : <span>You haven&apos;t been given access to any company yet. Ask an administrator.</span>}
        </div>
      )}
      {waiting > 0 && <div className="banner-warn mb-5"><span><b>{waiting}</b> prepared change{waiting > 1 ? "s are" : " is"} waiting to be confirmed or cancelled.</span></div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="card min-w-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="section-title">Recent activity</h2>
            <Link className="link text-sm" href="/jobs">View all</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Company</th><th>Type</th><th>Description</th><th>Prepared by</th><th>Status</th></tr></thead>
              <tbody>
                {recent.map(({ job, by }) => (
                  <tr key={job.id}>
                    <td className="whitespace-nowrap">{job.createdAt.toLocaleDateString("en-US")}</td>
                    <td>{byId.get(job.companyId)?.alias}</td>
                    <td className="whitespace-nowrap">{KIND_LABEL[job.kind]}</td>
                    <td><Link className="link" href={`/jobs/${job.id}`}>{job.title}</Link></td>
                    <td>{by}</td>
                    <td><StatusPill status={job.status} /></td>
                  </tr>
                ))}
                {!recent.length && <tr><td colSpan={6} className="py-8 text-center text-ink-muted">Nothing yet. Pick a tool from the left to prepare your first change.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid content-start gap-5">
          <div className="card card-pad">
            <h2 className="section-title mb-3">Your companies</h2>
            <ul className="grid gap-2">
              {list.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <Link className="link truncate" href={`/c/${c.alias}/accounts`}>{c.companyName ?? c.alias}</Link>
                  <span className={c.refreshTokenEnc ? (c.environment === "production" ? "pill-warn" : "pill-info") : "pill-bad"}>
                    {c.refreshTokenEnc ? (c.environment === "production" ? "Production" : "Sandbox") : "Disconnected"}
                  </span>
                </li>
              ))}
              {!list.length && <li className="muted text-sm">None yet.</li>}
            </ul>
          </div>
          <div className="card card-pad">
            <h2 className="section-title mb-2">How changes work</h2>
            <ol className="grid list-decimal gap-1 pl-5 text-sm text-ink-muted">
              <li>Prepare: the tool reads QuickBooks and shows exactly what would change.</li>
              <li>Confirm: an operator types the company alias.{process.env.REQUIRE_SECOND_APPROVER === "true" && " It must be a different person from whoever prepared it."}</li>
              <li>Run: changes are saved one by one, each with its result.</li>
              <li>Log: every item is kept and can be downloaded as CSV.</li>
            </ol>
          </div>
        </section>
      </div>
    </>
  );
}
