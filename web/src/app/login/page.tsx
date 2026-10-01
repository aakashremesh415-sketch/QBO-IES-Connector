"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const res = await signIn("credentials", { email: f.get("email"), password: f.get("password"), redirect: false });
    setBusy(false);
    if (res?.ok) {
      const next = params.get("callbackUrl");
      router.replace(next && next.startsWith("/") ? next : "/");
      router.refresh();
    } else {
      setError("That email and password don't match an active account. After 5 failed tries the account is locked for 15 minutes.");
    }
  }

  return (
    <form onSubmit={submit} className="card card-pad grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="muted mt-1 text-sm">Use the account your administrator created for you.</p>
      </div>
      {error && <div className="banner-bad" role="alert">{error}</div>}
      <label className="field">Email<input className="input" id="email" name="email" type="email" autoComplete="username" required autoFocus /></label>
      <label className="field">Password<input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></label>
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-full place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-brand">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9h11l-3-3M18 15H7l3 3" /></svg>
          </span>
          <span className="text-lg font-bold">IES Connector</span>
        </div>
        <Suspense><LoginForm /></Suspense>
        <p className="mt-4 text-center text-xs text-ink-muted">Forgot your password? Ask an administrator to reset it.</p>
      </div>
    </div>
  );
}
