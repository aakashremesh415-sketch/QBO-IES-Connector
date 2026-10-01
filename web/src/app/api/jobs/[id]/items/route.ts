import { z } from "zod";
import { apiUser, fail, json } from "@/lib/http";
import { getJob } from "@/lib/jobs/store";
import { JobError } from "@/lib/jobs/run";
import { setItemsIncluded } from "@/lib/jobs/review";
import { hasCompanyAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ itemIds: z.array(z.string()).min(1).max(5000), include: z.boolean() });

/** Leave items out of a preview, or put them back, before it's confirmed. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const job = await getJob(params.id);
  if (!job || !(await hasCompanyAccess(user, job.companyId))) return fail("Job not found.", 404);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Choose at least one item.");
  try {
    return json({ changed: await setItemsIncluded(job, user, parsed.data.itemIds, parsed.data.include) });
  } catch (e) {
    if (e instanceof JobError) return fail(e.message);
    throw e;
  }
}
