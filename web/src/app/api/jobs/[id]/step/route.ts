import { apiUser, fail, json } from "@/lib/http";
import { getJob } from "@/lib/jobs/store";
import { JobError, stepJob } from "@/lib/jobs/run";
import { hasCompanyAccess } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const job = await getJob(params.id);
  if (!job || !(await hasCompanyAccess(user, job.companyId))) return fail("Job not found.", 404);
  try {
    return json(await stepJob(job, user));
  } catch (e) {
    if (e instanceof JobError) return fail(e.message);
    return fail((e as Error).message, 500);
  }
}
