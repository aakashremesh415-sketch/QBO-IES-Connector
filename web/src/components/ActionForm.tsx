"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";

function Submit({ label, className }: { label: string; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className ?? "btn-primary"} disabled={pending}>{pending ? "Saving..." : label}</button>;
}

/** A form bound to a server action, showing its success / error / temporary-password result inline. */
export default function ActionForm({
  action, children, submitLabel, submitClass, className, confirmText,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children?: React.ReactNode;
  submitLabel: string;
  submitClass?: string;
  className?: string;
  confirmText?: string;
}) {
  const [state, formAction] = useFormState(action, {});
  return (
    <form
      action={formAction}
      className={className ?? "grid gap-3"}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Submit label={submitLabel} className={submitClass} />
        {state.error && <span className="text-sm font-semibold text-bad" role="alert">{state.error}</span>}
        {state.ok && !state.tempPassword && <span className="text-sm font-semibold text-brand-dark">{state.ok}</span>}
      </div>
      {state.tempPassword && (
        <div className="banner-ok grid gap-1">
          <span>{state.ok}</span>
          <code className="select-all rounded bg-white px-2 py-1 font-mono text-base">{state.tempPassword}</code>
          <span className="text-xs text-ink-muted">This is shown once. Share it privately.</span>
        </div>
      )}
    </form>
  );
}
