"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import StatusPill from "@/components/StatusPill";

export type ItemRow = { id: string; seq: number; action: string; label: string; detail: string; status: string; message: string; excluded: boolean };

/**
 * The job's items. While it's a preview, items can be left out (and put back) one by one or in bulk,
 * so only what you've reviewed is saved to QuickBooks.
 */
export default function ItemsTable({ jobId, items, editable, title }: { jobId: string; items: ItemRow[]; editable: boolean; title: string }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");
  const [show, setShow] = useState<"all" | "included" | "excluded" | "problems">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const shown = useMemo(() => {
    const t = filter.trim().toLowerCase();
    return items.filter((i) => {
      if (show === "included" && i.status !== "READY") return false;
      if (show === "excluded" && !i.excluded) return false;
      if (show === "problems" && !["ERROR", "FAILED"].includes(i.status) && !(i.status === "SKIPPED" && !i.excluded)) return false;
      return !t || `${i.label} ${i.detail} ${i.message} ${i.action}`.toLowerCase().includes(t);
    });
  }, [items, filter, show]);
  const selectable = (i: ItemRow) => editable && (i.status === "READY" || i.excluded);
  const shownSelectable = shown.filter(selectable);
  const chosen = items.filter((i) => picked[i.id] && selectable(i));
  const allChosen = shownSelectable.length > 0 && shownSelectable.every((i) => picked[i.id]);

  async function setIncluded(ids: string[], include: boolean) {
    if (!ids.length) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/jobs/${jobId}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemIds: ids, include }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't change the items.");
      setPicked({});
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const counts = {
    included: items.filter((i) => i.status === "READY").length,
    excluded: items.filter((i) => i.excluded).length,
  };

  return (
    <section className="card min-w-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="section-title mr-1">{title} ({items.length})</h2>
        {editable && <span className="text-xs text-ink-muted">{counts.included} will be saved · {counts.excluded} left out</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className="input w-auto py-1" value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show">
            <option value="all">Show all</option>
            {editable && <option value="included">Will be saved</option>}
            {editable && <option value="excluded">Left out</option>}
            <option value="problems">Errors and skipped</option>
          </select>
          <input className="input w-56 py-1" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter items" />
        </div>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas px-5 py-2 text-sm">
          <span className="text-ink-muted">{chosen.length ? `${chosen.length} ticked:` : "Tick items to leave them out or put them back."}</span>
          <button className="btn-secondary btn-sm" disabled={busy || !chosen.some((i) => i.status === "READY")} onClick={() => setIncluded(chosen.filter((i) => i.status === "READY").map((i) => i.id), false)}>Leave out</button>
          <button className="btn-secondary btn-sm" disabled={busy || !chosen.some((i) => i.excluded)} onClick={() => setIncluded(chosen.filter((i) => i.excluded).map((i) => i.id), true)}>Put back</button>
          {counts.excluded > 0 && (
            <button className="btn-secondary btn-sm ml-auto" disabled={busy} onClick={() => setIncluded(items.filter((i) => i.excluded).map((i) => i.id), true)}>Put back everything left out</button>
          )}
          {error && <span className="w-full text-sm font-semibold text-bad" role="alert">{error}</span>}
        </div>
      )}
      <div className="max-h-[40rem] overflow-auto">
        <table className="tbl">
          <thead className="sticky top-0 z-10">
            <tr>
              {editable && (
                <th className="w-8">
                  <input type="checkbox" className="accent-brand" checked={allChosen} disabled={!shownSelectable.length}
                    onChange={(e) => setPicked({ ...picked, ...Object.fromEntries(shownSelectable.map((i) => [i.id, e.target.checked])) })} aria-label="Tick all shown" />
                </th>
              )}
              <th>#</th><th>Action</th><th>Item</th><th>Status</th><th>Details</th>{editable && <th></th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} className={i.excluded ? "text-ink-faint" : ""}>
                {editable && (
                  <td>{selectable(i) && <input type="checkbox" className="accent-brand" checked={!!picked[i.id]} onChange={(e) => setPicked({ ...picked, [i.id]: e.target.checked })} aria-label={`Tick ${i.label}`} />}</td>
                )}
                <td className="text-ink-muted">{i.seq}</td>
                <td className="whitespace-nowrap capitalize">{i.action}</td>
                <td className="min-w-[14rem]"><span className={i.excluded ? "line-through" : ""}>{i.label}</span>{i.detail && <div className="text-xs text-ink-muted">{i.detail}</div>}</td>
                <td>{i.excluded ? <span className="pill-grey">Left out</span> : <StatusPill status={i.status} />}</td>
                <td className={`text-xs ${i.status === "ERROR" || i.status === "FAILED" ? "text-bad" : "text-ink-muted"}`}>{i.message}</td>
                {editable && (
                  <td className="whitespace-nowrap">
                    {i.status === "READY" && <button className="btn-secondary btn-sm" disabled={busy} onClick={() => setIncluded([i.id], false)}>Leave out</button>}
                    {i.excluded && <button className="btn-secondary btn-sm" disabled={busy} onClick={() => setIncluded([i.id], true)}>Put back</button>}
                  </td>
                )}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={editable ? 7 : 5} className="py-6 text-center text-ink-muted">Nothing to show.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
