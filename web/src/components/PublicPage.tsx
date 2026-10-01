import Link from "next/link";

/** Plain public layout for the legal and disconnect pages (no sign-in needed). */
export default function PublicPage({ title, updated, children }: { title: string; updated?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-canvas px-4 py-10">
      <article className="card card-pad mx-auto max-w-3xl">
        <Link href="/" className="mb-6 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-brand">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9h11l-3-3M18 15H7l3 3" /></svg>
          </span>
          <span className="font-bold">Entity Connector</span>
        </Link>
        <h1 className="text-[26px] font-bold leading-tight">{title}</h1>
        {updated && <p className="mt-1 text-sm text-ink-muted">Last updated {updated}</p>}
        <div className="legal mt-6 grid gap-4 text-[15px] leading-relaxed">{children}</div>
        <footer className="mt-10 flex flex-wrap gap-4 border-t border-line pt-4 text-sm">
          <Link className="link" href="/terms">Terms of use</Link>
          <Link className="link" href="/privacy">Privacy policy</Link>
          <Link className="link" href="/support">Help and support</Link>
          <Link className="link" href="/login">Sign in</Link>
        </footer>
      </article>
    </div>
  );
}

/** Who runs this site and how to reach them, from LEGAL_NAME / CONTACT_EMAIL. */
export function operator() {
  return {
    name: process.env.LEGAL_NAME?.trim() || "the operator of this site",
    email: process.env.CONTACT_EMAIL?.trim() || "",
  };
}
