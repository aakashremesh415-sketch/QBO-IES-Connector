"use server";

import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { companies, companyAccess, roleEnum, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin, requireUser } from "@/lib/session";
import { decryptSecret } from "@/lib/crypto";
import { revokeToken } from "@/lib/qbo/client";

export type ActionState = { ok?: string; error?: string; tempPassword?: string };

const tempPassword = () => randomBytes(9).toString("base64url");
const hash = (p: string) => bcrypt.hash(p, 12);

const passwordRule = z.string().min(12, "Use at least 12 characters.").max(200);

export async function createUser(_: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({
    name: z.string().trim().min(1, "Enter a name.").max(100),
    email: z.string().trim().toLowerCase().email("Enter a valid email."),
    role: z.enum(roleEnum.enumValues),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, email, role } = parsed.data;
  if (await db.query.users.findFirst({ where: eq(users.email, email) })) return { error: `${email} already has an account.` };
  const password = tempPassword();
  await db.insert(users).values({ name, email, role, passwordHash: await hash(password), mustChangePassword: true });
  await audit(admin.id, "user.create", `${email} as ${role}`);
  revalidatePath("/users");
  return { ok: `Added ${name}. Give them this temporary password; they'll choose their own at first sign-in.`, tempPassword: password };
}

export async function updateUser(_: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({
    id: z.string().uuid(),
    role: z.enum(roleEnum.enumValues),
    active: z.enum(["true", "false"]),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, role, active } = parsed.data;
  if (id === admin.id && (role !== "ADMIN" || active === "false")) return { error: "You can't remove your own admin access or deactivate yourself." };
  if (role !== "ADMIN" || active === "false") {
    const others = await db.query.users.findFirst({ where: and(eq(users.role, "ADMIN"), eq(users.active, true), ne(users.id, id)) });
    if (!others) return { error: "There must always be at least one active admin." };
  }
  const companyIds = form.getAll("company").map(String);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ role, active: active === "true" }).where(eq(users.id, id));
    await tx.delete(companyAccess).where(eq(companyAccess.userId, id));
    if (companyIds.length) await tx.insert(companyAccess).values(companyIds.map((companyId) => ({ userId: id, companyId })));
  });
  const u = await db.query.users.findFirst({ where: eq(users.id, id) });
  await audit(admin.id, "user.update", `${u?.email}: role ${role}, ${active === "true" ? "active" : "inactive"}, ${companyIds.length} compan${companyIds.length === 1 ? "y" : "ies"}`);
  revalidatePath("/users");
  return { ok: `Saved ${u?.name}.` };
}

export async function resetPassword(_: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const u = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!u) return { error: "User not found." };
  const password = tempPassword();
  await db.update(users).set({ passwordHash: await hash(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null }).where(eq(users.id, id));
  await audit(admin.id, "user.reset_password", u.email);
  return { ok: `New temporary password for ${u.name}:`, tempPassword: password };
}

export async function changeOwnPassword(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser({ allowPasswordChange: true });
  const current = String(form.get("current") ?? "");
  const next = passwordRule.safeParse(form.get("next"));
  if (!next.success) return { error: next.error.issues[0].message };
  if (next.data !== form.get("confirm")) return { error: "The two new passwords don't match." };
  if (!(await bcrypt.compare(current, user.passwordHash))) return { error: "Your current password isn't right." };
  if (await bcrypt.compare(next.data, user.passwordHash)) return { error: "Choose a password different from the current one." };
  await db.update(users).set({ passwordHash: await hash(next.data), mustChangePassword: false }).where(eq(users.id, user.id));
  await audit(user.id, "user.change_password", "");
  return { ok: "Password changed." };
}

export async function renameCompany(_: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const alias = String(form.get("alias") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(alias)) return { error: "Use 2-31 lower-case letters, numbers or dashes." };
  const clash = await db.query.companies.findFirst({ where: and(eq(companies.alias, alias), ne(companies.id, id)) });
  if (clash) return { error: `'${alias}' is already used.` };
  const before = await db.query.companies.findFirst({ where: eq(companies.id, id) });
  await db.update(companies).set({ alias }).where(eq(companies.id, id));
  await audit(admin.id, "company.rename", `${before?.alias} -> ${alias}`);
  revalidatePath("/companies");
  return { ok: `Renamed to ${alias}.` };
}

export async function disconnectCompany(_: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const c = await db.query.companies.findFirst({ where: eq(companies.id, id) });
  if (!c) return { error: "Company not found." };
  // Cancel the sign-in at Intuit too, then wipe it here. Job history stays for the audit trail.
  let revokeNote = "";
  if (c.refreshTokenEnc) {
    try {
      await revokeToken(decryptSecret(c.refreshTokenEnc));
    } catch (e) {
      revokeNote = ` Intuit couldn't be reached to cancel the sign-in (${(e as Error).message}); you can also disconnect the app inside QuickBooks.`;
    }
  }
  await db.update(companies).set({ accessTokenEnc: null, refreshTokenEnc: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null }).where(eq(companies.id, id));
  await audit(admin.id, "company.disconnect", c.alias);
  revalidatePath("/companies");
  // The Disconnect button disappears with the connection, so report the result on the page itself.
  redirect(`/companies?notice=${encodeURIComponent(`Disconnected ${c.alias}. Its sign-in was cancelled and deleted; history is kept.${revokeNote}`)}`);
}
