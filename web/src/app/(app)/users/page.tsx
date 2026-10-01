import { asc } from "drizzle-orm";
import { db } from "@/db";
import { companies, companyAccess, users } from "@/db/schema";
import PageHeader from "@/components/PageHeader";
import ActionForm from "@/components/ActionForm";
import { createUser, resetPassword, updateUser } from "@/lib/actions";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users" };

const ROLES = [
  ["ADMIN", "Admin", "Manages users and companies; can do everything on every company."],
  ["OPERATOR", "Operator", "Prepares and confirms changes on the companies you tick."],
  ["VIEWER", "Viewer", "Can look and prepare previews, but can't confirm changes."],
] as const;

export default async function UsersPage() {
  const me = await requireAdmin();
  const [all, comps, access] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name)),
    db.select().from(companies).orderBy(asc(companies.alias)),
    db.select().from(companyAccess),
  ]);
  const has = new Set(access.map((a) => `${a.userId}|${a.companyId}`));

  return (
    <>
      <PageHeader title="Users" subtitle="Who can sign in, what they can do, and which companies they can work on." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="card min-w-0 overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Role and access</th><th>Last sign-in</th><th></th></tr></thead>
            <tbody>
              {all.map((u) => (
                <tr key={u.id}>
                  <td className="min-w-[12rem]">
                    <div className="font-semibold">{u.name}{u.id === me.id && <span className="pill-grey ml-2">You</span>}</div>
                    <div className="text-xs text-ink-muted">{u.email}</div>
                    {!u.active && <span className="pill-bad mt-1">Inactive</span>}
                    {u.lockedUntil && u.lockedUntil > new Date() && <span className="pill-warn mt-1">Locked</span>}
                  </td>
                  <td className="min-w-[18rem]">
                    <ActionForm action={updateUser} submitLabel="Save" submitClass="btn-secondary btn-sm" className="grid gap-2">
                      <input type="hidden" name="id" value={u.id} />
                      <div className="flex flex-wrap gap-2">
                        <select name="role" defaultValue={u.role} className="input w-auto py-1" aria-label={`Role for ${u.name}`}>
                          {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <select name="active" defaultValue={String(u.active)} className="input w-auto py-1" aria-label={`Status for ${u.name}`}>
                          <option value="true">Active</option>
                          <option value="false">Inactive</option>
                        </select>
                      </div>
                      {u.role !== "ADMIN" && comps.length > 0 && (
                        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          <legend className="mb-1 font-semibold text-ink-muted">Companies</legend>
                          {comps.map((c) => (
                            <label key={c.id} className="flex items-center gap-1">
                              <input type="checkbox" name="company" value={c.id} defaultChecked={has.has(`${u.id}|${c.id}`)} className="accent-brand" />
                              {c.alias}
                            </label>
                          ))}
                        </fieldset>
                      )}
                      {u.role === "ADMIN" && <p className="text-xs text-ink-muted">Admins can use every company.</p>}
                    </ActionForm>
                  </td>
                  <td className="whitespace-nowrap text-xs text-ink-muted">{u.lastLoginAt ? u.lastLoginAt.toLocaleString("en-US") : "Never"}</td>
                  <td>
                    <ActionForm action={resetPassword} submitLabel="Reset password" submitClass="btn-secondary btn-sm" confirmText={`Reset ${u.name}'s password? Their current password stops working.`}>
                      <input type="hidden" name="id" value={u.id} />
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card card-pad h-fit">
          <h2 className="section-title mb-3">Add a user</h2>
          <ActionForm action={createUser} submitLabel="Add user">
            <label className="field">Name<input className="input" id="new-name" name="name" required /></label>
            <label className="field">Email<input className="input" id="new-email" name="email" type="email" required /></label>
            <label className="field">Role
              <select className="input" id="new-role" name="role" defaultValue="VIEWER">
                {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <ul className="grid gap-1 text-xs text-ink-muted">
              {ROLES.map(([v, l, d]) => <li key={v}><b className="text-ink">{l}:</b> {d}</li>)}
            </ul>
            <p className="text-xs text-ink-muted">After adding, tick the companies they may use in the table.</p>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
