import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import MapView, { Pt } from "../components/MapView";
import { ErrorBox, LEVEL_COLOR, ModeTag, Panel, RiskBadge, Spinner, useLoad } from "../components/ui";
import { CATEGORY_LABEL, FieldSummary } from "../fieldTypes";
import type { Dashboard, Incident } from "../types";
import type { CAlert } from "./Community";

function ago(t: number) {
  const m = Math.max(1, Math.round((Date.now() / 1000 - t) / 60));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}

export default function Command() {
  const nav = useNavigate();
  const d = useLoad(() => api.get<Dashboard>("/api/dashboard"));
  const inc = useLoad(() => api.get<{ incidents: Incident[] }>("/api/incidents"));
  const fr = useLoad(() => api.get<{ reports: FieldSummary[] }>("/api/field-reports"));
  const al = useLoad(() => api.get<{ alerts: CAlert[] }>("/api/community-alerts"));
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data || !inc.data || !fr.data || !al.data) return <Spinner text="Loading…" />;

  const open = fr.data.reports.filter((r) => ["NEW", "UNDER REVIEW", "NEEDS FIELD VISIT"].includes(r.status));
  const waiting = open.filter((r) => r.status === "NEW");
  const drafts = al.data.alerts.filter((a) => a.status === "DRAFT");
  const elevated = inc.data.incidents.filter((i) => i.risk.level !== "LOW");
  const pts: Pt[] = inc.data.incidents.map((i) => ({ id: i.id, lat: i.lat, lon: i.lon, radius: 7, color: LEVEL_COLOR[i.risk.level], tip: `${i.id} · ${i.risk.level.toLowerCase()} risk` }));

  const todo = [
    { n: waiting.length, text: waiting.length === 1 ? "citizen report is waiting for review" : "citizen reports are waiting for review", to: "/field-reports" },
    { n: drafts.length, text: drafts.length === 1 ? "public alert draft needs your decision" : "public alert drafts need your decision", to: "/community" },
    { n: elevated.length, text: elevated.length === 1 ? "incident from the evidence file has moderate risk or higher" : "incidents from the evidence file have moderate risk or higher", to: "/incidents" },
  ];

  return (
    <div className="space-y-6 fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-50">Today</h1>
        <p className="mt-1 text-sm text-stone-400">Mudumalai Tiger Reserve</p>
      </div>

      <Panel title="To do">
        <ul className="divide-y divide-white/10">
          {todo.map((t) => (
            <li key={t.to}>
              <Link to={t.to} className="flex items-center gap-4 py-3 hover:bg-white/[0.05]">
                <span className={`w-10 text-right text-2xl font-semibold ${t.n ? "text-stone-50" : "text-stone-600"}`}>{t.n}</span>
                <span className={t.n ? "text-stone-100" : "text-stone-400"}>{t.text}</span>
                <span className="ml-auto text-sm text-moss-400">Open</span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-6 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Citizen reports to look at" right={<Link to="/field-reports" className="text-sm text-moss-400">All reports</Link>}>
          {open.length === 0 ? <p className="text-sm text-stone-400">No open reports. New reports from citizens appear here.</p> : (
            <ul className="divide-y divide-white/10">
              {open.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <Link to={`/field-reports/${r.id}`} className="flex items-center gap-3 py-2.5 hover:bg-white/[0.05]">
                    <RiskBadge level={r.priority_level} size="sm" />
                    <div className="min-w-0 flex-1"><div className="truncate text-stone-100">{CATEGORY_LABEL[r.category]}</div><div className="truncate text-xs text-stone-400">{r.note_preview || "No note"}</div></div>
                    <span className="flex-none text-xs text-stone-400">{ago(r.created)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Where the evidence file shows concern" right={<ModeTag mode="HISTORICAL" />}>
          <MapView pts={pts} onPick={(id) => nav(`/incidents/${id}`)} height={300} jump={false} />
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-400">
            {(["LOW", "MODERATE", "HIGH", "CRITICAL"] as const).map((l) => <span key={l} className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: LEVEL_COLOR[l] }} />{l[0] + l.slice(1).toLowerCase()}</span>)}
          </div>
          <p className="mt-3 text-xs text-stone-400">These {d.data.observations} points come from a past data file with no dates. They show where past evidence looks disturbed. They are not a live fire feed.</p>
        </Panel>
      </div>
    </div>
  );
}
