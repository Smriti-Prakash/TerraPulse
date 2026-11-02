import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Chip, ErrorBox, Panel, RiskBadge, Spinner, useLoad } from "../components/ui";
import { CATEGORY_LABEL, FieldSummary, REPORT_STATUSES, sentence } from "../fieldTypes";

export const CRED_TONE: Record<string, "good" | "warn" | "earth" | "neutral"> = { SUPPORTED: "good", "PARTLY SUPPORTED": "warn", "NOT SUPPORTED": "earth", INCONCLUSIVE: "neutral" };

export function AiChip({ r }: { r: Pick<FieldSummary, "ai_status" | "credibility"> }) {
  if (r.ai_status === "PENDING") return <Chip>AI check running…</Chip>;
  if (r.ai_status === "FAILED") return <Chip tone="warn">AI check unavailable</Chip>;
  return <Chip tone={CRED_TONE[r.credibility ?? ""] ?? "neutral"}>AI: {r.credibility ? r.credibility.toLowerCase() : "no result"}</Chip>;
}

export default function FieldReports() {
  const [status, setStatus] = useState<string>("");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const q = useLoad(() => api.get<{ reports: FieldSummary[]; count: number }>(`/api/field-reports?${new URLSearchParams({ ...(status ? { status } : {}), ...(alertsOnly ? { alerts: "true" } : {}) })}`), [status, alertsOnly]);
  return (
    <div className="space-y-6 fade-in">
      <div><h1 className="text-2xl font-semibold tracking-tight">Reports from the public</h1>
        <p className="mt-2 max-w-2xl text-sm text-stone-400">Photos and locations sent by registered citizens. A report stays unverified until you review it.</p></div>

      <div className="flex flex-wrap items-center gap-2">
        {["", ...REPORT_STATUSES].map((s) => (
          <button key={s || "all"} onClick={() => setStatus(s)} aria-pressed={status === s}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${status === s ? "border-moss-500 bg-moss-500 text-ink-950" : "border-white/15 bg-ink-700 text-stone-300 hover:bg-white/[0.06]"}`}>{s ? sentence(s) : "All"}</button>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-stone-300"><input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} className="accent-emerald-500" />Only open reports with moderate priority or higher</label>
      </div>

      {q.error ? <ErrorBox error={q.error} onRetry={q.reload} /> : !q.data ? <Spinner /> : q.data.reports.length === 0 ? (
        <Panel><p className="text-sm text-stone-300">No reports match.</p></Panel>
      ) : (
        <div className="space-y-3">
          {q.data.reports.map((r) => (
            <Link key={r.id} to={`/field-reports/${r.id}`} className="glass block p-4 transition hover:border-moss-500/40">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-stone-100">Report {r.id}</span>
                <RiskBadge level={r.priority_level} size="sm" />
                <Chip>{CATEGORY_LABEL[r.category]}</Chip>
                <AiChip r={r} />
                <Chip tone={r.status === "NEW" ? "warn" : r.status === "VERIFIED" ? "good" : "neutral"}>{sentence(r.status)}</Chip>
                <span className="ml-auto font-mono text-[11px] text-stone-500">{new Date(r.created * 1000).toLocaleString()}</span>
              </div>
              <div className="mt-2 text-sm text-stone-300">{r.note_preview || <span className="text-stone-500">No note</span>}</div>
              <div className="mt-1.5 font-mono text-[11px] text-stone-500">{r.reporter_name} · {r.lat.toFixed(4)}, {r.lon.toFixed(4)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
