import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import type { User } from "@/db/schema";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** Signed-in user for an API call. Also rejects cross-site POSTs by checking the Origin header. */
export async function apiUser(req: Request): Promise<User | NextResponse> {
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && host && new URL(origin).host !== host) return fail("Cross-site request refused.", 403);
  }
  const user = await currentUser();
  if (!user) return fail("Please sign in again.", 401);
  if (user.mustChangePassword) return fail("Change your temporary password first.", 403);
  return user;
}

export const today = () => new Date().toISOString().slice(0, 10);
