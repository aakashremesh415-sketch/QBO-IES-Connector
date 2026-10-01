"use client";

import { signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

type CompanyOption = { alias: string; name: string; environment: string };

export default function TopBar({ companies, alias, userName, role, onMenu }: { companies: CompanyOption[]; alias: string | null; userName: string; role: string; onMenu: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const current = companies.find((c) => c.alias === alias);

  function switchTo(next: string) {
    const m = path.match(/^\/c\/[^/]+(\/.*)?$/);
    router.push(m ? `/c/${encodeURIComponent(next)}${m[1] ?? "/accounts"}` : `/c/${encodeURIComponent(next)}/accounts`);
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-white px-4 sm:px-6">
      <button className="-ml-1 rounded p-1.5 text-ink hover:bg-canvas lg:hidden" onClick={onMenu} aria-label="Open menu">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <div className="flex min-w-0 items-center gap-3">
        <label htmlFor="company-switch" className="sr-only">Company</label>
        {companies.length ? (
          <select
            id="company-switch"
            value={alias ?? ""}
            onChange={(e) => switchTo(e.target.value)}
            className="w-full max-w-[34rem] min-w-0 truncate rounded-md border border-transparent bg-transparent py-1 pl-2 pr-8 text-[15px] font-semibold text-ink hover:border-line focus:border-brand focus:outline-none"
          >
            {!alias && <option value="">Choose a company</option>}
            {companies.map((c) => (
              <option key={c.alias} value={c.alias}>{c.name} ({c.alias})</option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-ink-muted">No companies connected yet</span>
        )}
        {current && (
          <span className={`hidden sm:inline-flex ${current.environment === "production" ? "pill-warn" : "pill-info"}`}>{current.environment === "production" ? "Production" : "Sandbox"}</span>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-4 text-sm">
        <Link href="/account" className="hidden text-right leading-tight hover:underline sm:block">
          <span className="block font-semibold text-ink">{userName}</span>
          <span className="block text-xs text-ink-muted">{role.charAt(0) + role.slice(1).toLowerCase()}</span>
        </Link>
        <button className="btn-secondary btn-sm" onClick={() => signOut({ callbackUrl: "/login" })}>Sign out</button>
      </div>
    </header>
  );
}
