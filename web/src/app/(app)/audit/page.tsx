import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import PageHeader from "@/components/PageHeader";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requireAdmin();
  const rows = await db.select({ a: auditLog, name: users.name, email: users.email }).from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId)).orderBy(desc(auditLog.createdAt)).limit(500);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Sign-ins, user and company changes, and confirmed jobs. The latest 500 events." />
      <section className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>When</th><th>Who</th><th>Event</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.map(({ a, name, email }) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap text-xs">{a.createdAt.toLocaleString("en-US")}</td>
                <td>{name ?? "-"}<div className="text-xs text-ink-muted">{email}</div></td>
                <td><code className="font-mono text-xs">{a.action}</code></td>
                <td className="text-xs">{a.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
