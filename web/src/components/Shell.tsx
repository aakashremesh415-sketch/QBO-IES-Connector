"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

type Props = {
  alias: string | null;
  isAdmin: boolean;
  companies: { alias: string; name: string; environment: string }[];
  userName: string;
  role: string;
  children: React.ReactNode;
};

/** Left navigation that stays put on wide screens and slides in from a menu button on phones. */
export default function Shell({ alias, isAdmin, companies, userName, role, children }: Props) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);

  return (
    <div className="flex h-full">
      <div className="hidden lg:flex"><Sidebar alias={alias} isAdmin={isAdmin} /></div>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <Sidebar alias={alias} isAdmin={isAdmin} />
          <button className="flex-1 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar companies={companies} alias={alias} userName={userName} role={role} onMenu={() => setOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
