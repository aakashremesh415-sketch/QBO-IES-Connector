import { asc } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import PageHeader from "@/components/PageHeader";
import ActionForm from "@/components/ActionForm";
import { disconnectCompany, renameCompany } from "@/lib/actions";
import { qboEnvironment, qboRedirectUri } from "@/lib/qbo/client";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: { searchParams: { error?: string; connected?: string } }) {
  await requireAdmin();
  const list = await db.select().from(companies).orderBy(asc(companies.alias));
  const env = qboEnvironment();
  return (
    <>
      <PageHeader title="Companies" subtitle="Each Intuit Enterprise Suite entity is connected separately. Sign in as an admin of that company when Intuit asks." />
      {searchParams.error && <div className="banner-bad mb-4" role="alert">{searchParams.error}</div>}
      {searchParams.connected && <div className="banner-ok mb-4">Connected <b>{searchParams.connected}</b>.</div>}
      {env === "production" && <div className="banner-warn mb-4">This site is set to <b>production</b>: companies you connect are your real books.</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="card min-w-0 overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Company</th><th>Alias</th><th>Environment</th><th>Sign-in</th><th></th></tr></thead>
            <tbody>
              {list.map((c) => {
                const connected = !!c.refreshTokenEnc;
                const expires = c.refreshTokenExpiresAt;
                const soon = expires && expires.getTime() - Date.now() < 14 * 86400_000;
                return (
                  <tr key={c.id}>
                    <td><div className="font-semibold">{c.companyName ?? "(unnamed)"}</div><div className="text-xs text-ink-muted">Realm {c.realmId}</div></td>
                    <td className="min-w-[14rem]">
                      <ActionForm action={renameCompany} submitLabel="Rename" submitClass="btn-secondary btn-sm" className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={c.id} />
                        <input className="input w-36 py-1" name="alias" defaultValue={c.alias} aria-label={`Alias for ${c.companyName}`} />
                      </ActionForm>
                    </td>
                    <td><span className={c.environment === "production" ? "pill-warn" : "pill-info"}>{c.environment}</span></td>
                    <td className="whitespace-nowrap text-xs">
                      {connected ? (
                        <>
                          <span className={soon ? "pill-warn" : "pill-ok"}>{soon ? "Expires soon" : "Connected"}</span>
                          {expires && <div className="mt-1 text-ink-muted">Until {expires.toLocaleDateString("en-US")}</div>}
                        </>
                      ) : <span className="pill-bad">Disconnected</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="flex flex-wrap gap-2">
                        <a className="btn-secondary btn-sm" href={`/api/qbo/connect?alias=${encodeURIComponent(c.alias)}`}>Reconnect</a>
                        {connected && (
                          <ActionForm action={disconnectCompany} submitLabel="Disconnect" submitClass="btn-danger btn-sm" confirmText={`Disconnect ${c.alias}? Nobody can use it until it is connected again.`}>
                            <input type="hidden" name="id" value={c.id} />
                          </ActionForm>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!list.length && <tr><td colSpan={5} className="py-8 text-center text-ink-muted">No companies yet.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="card card-pad h-fit">
          <h2 className="section-title mb-3">Connect a company</h2>
          <form action="/api/qbo/connect" method="get" className="grid gap-3">
            <label className="field">Short alias (used to confirm changes)
              <input className="input" id="alias" name="alias" placeholder="e.g. us-parent" pattern="[a-z0-9][a-z0-9\-]{1,30}" required />
            </label>
            <button className="btn-primary">Connect to QuickBooks</button>
          </form>
          <p className="mt-3 text-xs text-ink-muted">
            The Intuit app must list this Redirect URI exactly:<br />
            <code className="select-all break-all font-mono">{qboRedirectUri()}</code>
          </p>
        </section>
      </div>
    </>
  );
}
