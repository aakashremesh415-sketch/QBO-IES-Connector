import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/session";
import { authorizeUrl, qboRedirectUri } from "@/lib/qbo/client";
import { signState } from "@/lib/crypto";

export const dynamic = "force-dynamic";

const ALIAS = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** Admin -> Companies -> Connect: off to Intuit to pick a company and approve access. */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.redirect(new URL("/", req.url));
  const alias = (req.nextUrl.searchParams.get("alias") ?? "").trim().toLowerCase();
  if (!ALIAS.test(alias)) {
    return NextResponse.redirect(new URL(`/companies?error=${encodeURIComponent("Use 2-31 lower-case letters, numbers or dashes for the alias, e.g. us-parent.")}`, req.url));
  }
  try {
    return NextResponse.redirect(await authorizeUrl(signState({ alias, userId: user.id }), qboRedirectUri()));
  } catch (e) {
    return NextResponse.redirect(new URL(`/companies?error=${encodeURIComponent((e as Error).message)}`, req.url));
  }
}
