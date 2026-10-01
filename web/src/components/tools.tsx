"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export type AccountOption = {
  id: string;
  name: string;
  number: string;
  type: string;
  classification: string;
  balance: number;
  active: boolean;
  isParent: boolean;
};

export function money(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** POST to the prepare endpoint and open the resulting preview job. */
export function usePrepare(alias: string, replaces?: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function prepare(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/c/${encodeURIComponent(alias)}/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(replaces ? { ...body, replaces } : body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status}).`);
      router.push(`/jobs/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return { prepare, busy, error };
}

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return <div className="banner-bad" role="alert">{message}</div>;
}

/** Searchable checkbox list of accounts. */
export function AccountPicker({
  accounts, selected, onChange, exclude = [], height = "18rem", label,
}: {
  accounts: AccountOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
  height?: string;
  label: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return accounts.filter((a) => !exclude.includes(a.id) && (!t || a.name.toLowerCase().includes(t) || a.number.includes(t) || a.type.toLowerCase().includes(t)));
  }, [accounts, q, exclude]);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-muted">{label}</span>
        <span className="text-xs text-ink-muted">{selected.length} selected</span>
      </div>
      <input className="input" placeholder="Search by name, number or type" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search: ${label}`} />
      <div className="overflow-y-auto rounded border border-line" style={{ maxHeight: height }}>
        <table className="tbl">
          <tbody>
            {shown.map((a) => (
              <tr key={a.id} className="cursor-pointer" onClick={() => toggle(a.id)}>
                <td className="w-8"><input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} onClick={(e) => e.stopPropagation()} className="accent-brand" aria-label={a.name} /></td>
                <td className="w-16 text-xs text-ink-muted">{a.number}</td>
                <td>{a.name}<div className="text-xs text-ink-muted">{a.type}</div></td>
                <td className="num">{money(a.balance)}</td>
              </tr>
            ))}
            {!shown.length && <tr><td className="py-4 text-center text-ink-muted">No accounts match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AccountSelect({ accounts, value, onChange, exclude = [], id, label }: { accounts: AccountOption[]; value: string; onChange: (id: string) => void; exclude?: string[]; id: string; label: string }) {
  return (
    <label className="field" htmlFor={id}>{label}
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose an account</option>
        {accounts.filter((a) => a.active && !exclude.includes(a.id)).map((a) => (
          <option key={a.id} value={a.id}>{a.number ? `${a.number} ` : ""}{a.name} · {a.type}</option>
        ))}
      </select>
    </label>
  );
}
