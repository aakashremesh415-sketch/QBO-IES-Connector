import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { exchangeCode, fetchCompanyName, qboEnvironment, qboRedirectUri, tokenColumns } from "@/lib/qbo/client";
import { verifyState } from "@/lib/crypto";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Intuit sends the admin back here after they approve access to a company. */
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(new URL(`/companies?${q}`, req.url));
  const user = await currentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.redirect(new URL("/", req.url));
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return back(`error=${encodeURIComponent(`Intuit said: ${p.get("error")}`)}`);
  const state = verifyState(p.get("state") ?? "");
  const code = p.get("code");
  const realmId = p.get("realmId");
  if (!state || state.userId !== user.id || !code || !realmId) {
    return back(`error=${encodeURIComponent("That connection link expired or didn't come from this site. Try Connect again.")}`);
  }
  try {
    const tokens = await exchangeCode(code, qboRedirectUri());
    const companyName = await fetchCompanyName(realmId, tokens.access_token);
    const environment = qboEnvironment();
    const existing = await db.query.companies.findFirst({ where: and(eq(companies.realmId, realmId), eq(companies.environment, environment)) });
    if (existing) {
      await db.update(companies).set({ ...tokenColumns(tokens), companyName: companyName ?? existing.companyName, connectedById: user.id, connectedAt: new Date() }).where(eq(companies.id, existing.id));
      await audit(user.id, "company.reconnect", `${existing.alias} (${companyName ?? realmId})`);
      return back(`connected=${encodeURIComponent(existing.alias)}`);
    }
    const clash = await db.query.companies.findFirst({ where: eq(companies.alias, state.alias) });
    if (clash) return back(`error=${encodeURIComponent(`The alias '${state.alias}' is already used by another company. Pick another.`)}`);
    await db.insert(companies).values({ alias: state.alias, realmId, companyName, environment, connectedById: user.id, ...tokenColumns(tokens) });
    await audit(user.id, "company.connect", `${state.alias} (${companyName ?? realmId}, ${environment})`);
    return back(`connected=${encodeURIComponent(state.alias)}`);
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message.slice(0, 300))}`);
  }
}
