import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, companyAccess, users, type Company, type Role, type User } from "@/db/schema";
import { authOptions } from "@/lib/auth";

/**
 * The signed-in user, read fresh from the database on every request so a role change or
 * deactivation takes effect immediately rather than when their session cookie expires.
 */
export async function currentUser(): Promise<User | null> {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  return user && user.active ? user : null;
}

export async function requireUser(opts: { allowPasswordChange?: boolean } = {}): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !opts.allowPasswordChange) redirect("/account?first=1");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/");
  return user;
}

export const canConfirm = (role: Role) => role === "ADMIN" || role === "OPERATOR";

export async function companiesFor(user: User): Promise<Company[]> {
  if (user.role === "ADMIN") return db.select().from(companies).orderBy(asc(companies.alias));
  const rows = await db
    .select({ c: companies })
    .from(companyAccess)
    .innerJoin(companies, eq(companies.id, companyAccess.companyId))
    .where(eq(companyAccess.userId, user.id))
    .orderBy(asc(companies.alias));
  return rows.map((r) => r.c);
}

export async function hasCompanyAccess(user: User, companyId: string): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  const row = await db.query.companyAccess.findFirst({
    where: and(eq(companyAccess.userId, user.id), eq(companyAccess.companyId, companyId)),
  });
  return !!row;
}

/** The company behind a /c/[alias] URL, or a 404 when it doesn't exist or this user can't use it. */
export async function companyForUser(user: User, alias: string): Promise<Company> {
  const company = await db.query.companies.findFirst({ where: eq(companies.alias, decodeURIComponent(alias)) });
  if (!company || !(await hasCompanyAccess(user, company.id))) notFound();
  return company;
}
