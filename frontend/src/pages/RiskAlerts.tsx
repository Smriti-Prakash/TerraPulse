import { Link } from "react-router-dom";
import { api } from "../api";
import { Chip, ErrorBox, LEVEL_COLOR, Panel, RiskBadge, Spinner, useLoad } from "../components/ui";
import { CATEGORY_LABEL, FieldSummary } from "../fieldTypes";
import { AiChip } from "./FieldReports";
import type { Alert, Dashboard } from "../types";

export default function RiskAlerts() {
  const a = useLoad(() => api.get<{ alerts: Alert[]; count: number; high_or_critical: number }>("/api/alerts"));
  const d = useLoad(() => api.get<Dashboard>("/api/dashboard"));
  const cr = useLoad(() => api.get<{ reports: FieldSummary[]; count: number }>("/api/field-reports?alerts=true"));
  if (a.error) return <ErrorBox error={a.error} onRetry={a.reload} />;
  if (!a.data || !d.data) return <Spinner />;
  const D = d.data, max = Math.max(...Object.values(D.by_risk), 1);
  return (
    <div className="space-y-6 fade-in">
      <div><div className="label mb-2">Alerts</div><h1 className="h-display text-4xl">Risk and alerts</h1></div>
      <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel kicker="Distribution" title="Incidents by risk">
            {(["CRITICAL", "HIGH", "MODERATE", "LOW"] as const).map((l) => (
              <div key={l} className="mb-3"><div className="flex justify-between text-sm"><RiskBadge level={l} size="sm" /><span className="font-mono">{D.by_risk[l]}</span></div>
                <div className="mt-1.5 h-2 rounded bg-white/10"><div className="h-full rounded" style={{ width: `${(D.by_risk[l] / max) * 100}%`, background: LEVEL_COLOR[l] }} /></div></div>
            ))}
          </Panel>
          <Panel kicker="Method" title="How risk is scored">
            <ul className="space-y-1.5 text-sm text-stone-300">
              <li><span className="font-mono text-moss-400">+2</span> Random Forest detects disturbance (p ≥ 0.5)</li>
              <li><span className="font-mono text-moss-400">+1</span> Thermal signal (Fire_Brightness ≥ 330 K)</li>
              <li><span className="font-mono text-moss-400">+1</span> Low NDVI/NBR vs other sampled points</li>
            </ul>
            <p className="mt-3 text-xs text-stone-500">0–1 LOW · 2 MODERATE · 3 HIGH · 4 CRITICAL</p>
          </Panel>
        </div>
        <div className="space-y-6">
        {cr.data && cr.data.count > 0 && (
          <Panel kicker={`${cr.data.count} open`} title="Citizen report alerts">
            <div className="space-y-3">
              {cr.data.reports.map((x) => (
                <Link key={x.id} to={`/field-reports/${x.id}`} className="block rounded-xl border p-3.5 transition hover:brightness-125" style={{ borderColor: LEVEL_COLOR[x.priority_level] + "66", background: LEVEL_COLOR[x.priority_level] + "0d" }}>
                  <div className="flex flex-wrap items-center gap-2"><RiskBadge level={x.priority_level} size="sm" /><Chip>{CATEGORY_LABEL[x.category]}</Chip><AiChip r={x} /><span className="ml-auto font-mono text-xs text-stone-300">#{x.id}</span></div>
                  <div className="mt-1.5 text-[13px] text-stone-300">{x.note_preview || "No note"}</div>
                  <div className="mt-1 font-mono text-[11px] text-stone-500">Unverified citizen report · {new Date(x.created * 1000).toLocaleString()}</div>
                </Link>
              ))}
            </div>
          </Panel>
        )}
        <Panel kicker={`${a.data.count} alerts`} title="Alerts">
          <div className="space-y-4">
            {a.data.alerts.map((x) => (
              <div key={x.incident_id} className="rounded-xl border p-4" style={{ borderColor: LEVEL_COLOR[x.level] + "66", background: LEVEL_COLOR[x.level] + "0d" }}>
                <div className="flex items-center justify-between"><span className="font-mono text-xs tracking-widest" style={{ color: LEVEL_COLOR[x.level] }}>{x.tier}</span><Link to={`/incidents/${x.incident_id}`} className="font-mono text-sm text-stone-100 underline decoration-white/20">{x.incident_id}</Link></div>
                <div className="mt-1.5 font-display text-xl">{x.headline}</div>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-stone-300">{x.supporting_evidence.map((e) => <li key={e}>{e}</li>)}</ul>
                <div className="mt-3 text-[13px]"><span className="label">Concern </span>{x.potential_concern}</div>
                <div className="mt-1.5 text-[13px]"><span className="label">Action </span>{x.recommended_action}</div>
              </div>
            ))}
          </div>
        </Panel>
        </div>
      </div>
    </div>
  );
}
