import { apiUser, fail, json } from "@/lib/http";
import { getJob } from "@/lib/jobs/store";
import { JobError } from "@/lib/jobs/run";
import { prepareUndo } from "@/lib/jobs/review";
import { hasCompanyAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Prepare (not run) an undo of a finished job. It opens as a preview to review and confirm. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const job = await getJob(params.id);
  if (!job || !(await hasCompanyAccess(user, job.companyId))) return fail("Job not found.", 404);
  try {
    return json({ id: await prepareUndo(job, user) });
  } catch (e) {
    if (e instanceof JobError) return fail(e.message);
    throw e;
  }
}
