import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, users } from "@/db/schema";
import { apiUser, fail } from "@/lib/http";
import { getJob, loadItems } from "@/lib/jobs/store";
import { hasCompanyAccess } from "@/lib/session";
import { toCsv } from "@/lib/logic/csv";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const job = await getJob(params.id);
  if (!job || !(await hasCompanyAccess(user, job.companyId))) return fail("Job not found.", 404);
  const company = await db.query.companies.findFirst({ where: eq(companies.id, job.companyId) });
  const name = async (id: string | null) => (id ? (await db.query.users.findFirst({ where: eq(users.id, id) }))?.email ?? "" : "");
  const [preparedBy, confirmedBy] = await Promise.all([name(job.createdById), name(job.confirmedById)]);
  const rows = (await loadItems(job.id)).map((i) => ({
    job_id: job.id, company: company?.alias, job: job.title, prepared_by: preparedBy, confirmed_by: confirmedBy,
    seq: i.seq, action: i.action, item: i.label, detail: i.detail, status: i.status, message: i.message, quickbooks_id: i.resultRef ?? "",
    updated_at: i.updatedAt.toISOString(),
  }));
  const headers = ["job_id", "company", "job", "prepared_by", "confirmed_by", "seq", "action", "item", "detail", "status", "message", "quickbooks_id", "updated_at"];
  return new Response(toCsv(headers, rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="job-${job.id.slice(0, 8)}.csv"` },
  });
}
