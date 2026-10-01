import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setup check" };

type Check = { name: string; ok: boolean; detail: string };

/**
 * Says which settings are missing, without showing any values. Linked automatically when the
 * site can't start sign-in, and safe to open any time while setting up.
 */
async function runChecks(): Promise<Check[]> {
  const env = (k: string) => (process.env[k] ?? "").trim();
  const checks: Check[] = [
    { name: "NEXTAUTH_SECRET", ok: env("NEXTAUTH_SECRET").length >= 16, detail: "Random string, 32+ characters. Generate with: openssl rand -base64 32" },
    { name: "NEXTAUTH_URL", ok: /^https?:\/\//.test(env("NEXTAUTH_URL")), detail: "This site's address, e.g. https://your-app.vercel.app (no trailing slash)" },
    { name: "TOKEN_ENCRYPTION_KEY", ok: env("TOKEN_ENCRYPTION_KEY").length >= 16, detail: "A second, different random string, 32+ characters. Keep a copy." },
    { name: "DATABASE_URL", ok: /^postgres(ql)?:\/\//.test(env("DATABASE_URL")), detail: "Your Neon connection string, starting postgres:// or postgresql://" },
    { name: "QBO_CLIENT_ID", ok: !!env("QBO_CLIENT_ID"), detail: "From your Intuit app's Keys & credentials" },
    { name: "QBO_CLIENT_SECRET", ok: !!env("QBO_CLIENT_SECRET"), detail: "From your Intuit app's Keys & credentials" },
    { name: "QBO_ENVIRONMENT", ok: ["sandbox", "production"].includes(env("QBO_ENVIRONMENT")), detail: "sandbox or production" },
  ];
  if (checks.find((c) => c.name === "DATABASE_URL")!.ok) {
    try {
      const r = await db.execute(sql`select to_regclass('public.users') is not null as has_users`);
      const hasUsers = (r.rows[0] as { has_users: boolean }).has_users;
      checks.push({ name: "Database tables", ok: hasUsers, detail: hasUsers ? "Found" : "Not created yet. On your computer run: cd web && npm run db:push" });
      if (hasUsers) {
        const a = await db.execute(sql`select count(*)::int as n from users where role = 'ADMIN' and active`);
        const n = (a.rows[0] as { n: number }).n;
        checks.push({ name: "First admin", ok: n > 0, detail: n > 0 ? "Exists" : 'None yet. Run: npm run create-admin -- you@example.com "Your Name"' });
      }
    } catch (e) {
      checks.push({ name: "Database connection", ok: false, detail: `Couldn't connect: ${(e as Error).message.slice(0, 200)}` });
    }
  }
  return checks;
}

export default async function SetupCheck() {
  const checks = await runChecks();
  const missing = checks.filter((c) => !c.ok);
  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="card card-pad w-full max-w-2xl">
        <h1 className="text-2xl font-bold">Setup check</h1>
        <p className="muted mt-1 text-sm">Environment variables are set in Vercel under Settings → Environment Variables. After changing them, redeploy: Vercel only reads them when a deployment starts.</p>
        <div className={`mt-4 ${missing.length ? "banner-warn" : "banner-ok"}`}>
          {missing.length ? `${missing.length} thing${missing.length > 1 ? "s" : ""} to fix.` : <span>Everything looks right. <a className="link" href="/login">Go to sign in</a>.</span>}
        </div>
        <table className="tbl mt-4">
          <tbody>
            {checks.map((c) => (
              <tr key={c.name}>
                <td className="w-24">{c.ok ? <span className="pill-ok">OK</span> : <span className="pill-bad">Missing</span>}</td>
                <td><code className="font-mono font-semibold">{c.name}</code><div className="text-xs text-ink-muted">{c.detail}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
