"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: string; match: string };

const ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
  list: "M4 6h16M4 12h16M4 18h10",
  swap: "M7 7h13l-3-3M17 17H4l3 3",
  move: "M4 12h12m0 0-4-4m4 4-4 4M20 5v14",
  off: "M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0",
  share: "M6 12a3 3 0 1 0 0-.01M18 6a3 3 0 1 0 0-.01M18 18a3 3 0 1 0 0-.01M8.6 10.7l6.8-3.4M8.6 13.3l6.8 3.4",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8",
  building: "M4 21V4h11v17M15 9h5v12M8 8h3M8 12h3M8 16h3",
  shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z",
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

export default function Sidebar({ alias, isAdmin }: { alias: string | null; isAdmin: boolean }) {
  const path = usePathname();
  const c = alias ? `/c/${encodeURIComponent(alias)}` : null;
  const tools: Item[] = c
    ? [
        { href: `${c}/accounts`, label: "Chart of accounts", icon: "list", match: "/accounts" },
        { href: `${c}/transfer`, label: "Balance transfer", icon: "swap", match: "/transfer" },
        { href: `${c}/move`, label: "Move transactions", icon: "move", match: "/move" },
        { href: `${c}/inactivate`, label: "Make inactive", icon: "off", match: "/inactivate" },
      ]
    : [];
  const groups: { title?: string; items: Item[] }[] = [
    { items: [{ href: "/", label: "Dashboard", icon: "home", match: "^/$" }] },
    { title: "Accounting", items: tools },
    {
      title: "Multi-entity",
      items: [
        { href: "/shared", label: "Shared COA", icon: "share", match: "^/shared" },
        { href: "/jobs", label: "Activity", icon: "clock", match: "^/jobs" },
      ],
    },
    ...(isAdmin
      ? [{
          title: "Settings",
          items: [
            { href: "/companies", label: "Companies", icon: "building", match: "^/companies" },
            { href: "/users", label: "Users", icon: "users", match: "^/users" },
            { href: "/audit", label: "Audit log", icon: "shield", match: "^/audit" },
          ],
        }]
      : []),
  ];
  const active = (m: string) => (m.startsWith("^") ? new RegExp(m).test(path) : path.includes(m));

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col bg-nav text-nav-text" aria-label="Main">
      <Link href="/" className="flex items-center gap-2 px-5 py-5 text-white">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-brand">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9h11l-3-3M18 15H7l3 3" /></svg>
        </span>
        <span className="text-[15px] font-bold leading-tight">IES Connector</span>
      </Link>
      <div className="flex-1 overflow-y-auto pb-6">
        {groups.map((g, i) => (
          <div key={i} className="mt-2">
            {g.title && <div className="px-5 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-[#8d9096]">{g.title}</div>}
            {g.title === "Accounting" && !c && <p className="px-5 py-2 text-xs text-[#8d9096]">Choose a company at the top to see these tools.</p>}
            {g.items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={`mx-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active(it.match) ? "bg-nav-active text-white shadow-[inset_3px_0_0_#2ca01c]" : "hover:bg-nav-hover hover:text-white"
                }`}
              >
                <Icon name={it.icon} />
                {it.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
