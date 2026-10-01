import { apiUser, fail, json } from "@/lib/http";
import { getJob } from "@/lib/jobs/store";
import { JobError, confirmJob } from "@/lib/jobs/run";
import { hasCompanyAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const job = await getJob(params.id);
  if (!job || !(await hasCompanyAccess(user, job.companyId))) return fail("Job not found.", 404);
  const body = await req.json().catch(() => ({}));
  try {
    await confirmJob(job, user, String(body?.alias ?? ""));
    return json({ ok: true });
  } catch (e) {
    if (e instanceof JobError) return fail(e.message);
    throw e;
  }
}
