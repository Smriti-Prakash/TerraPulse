import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import MapView, { Pt } from "../components/MapView";
import { ErrorBox, LEVEL_COLOR, Panel, RiskBadge, Spinner, Stat, useLoad } from "../components/ui";
import type { Dashboard, Incident } from "../types";

const ramp = (t: number) => {
  const a = [31, 58, 95], b = [52, 211, 153], c = [250, 204, 21];
  const [p, q, u] = (t < 0.5 ? [a, b, t * 2] : [b, c, (t - 0.5) * 2]) as [number[], number[], number];
  return `rgb(${p.map((x, i) => Math.round(x + (q[i] - x) * u)).join(",")})`;
};

export default function Command() {
  const nav = useNavigate();
  const d = useLoad(() => api.get<Dashboard>("/api/dashboard"));
  const inc = useLoad(() => api.get<{ incidents: Incident[] }>("/api/incidents"));
  const [by, setBy] = useState<"risk" | "ml">("risk");
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data || !inc.data) return <Spinner text="Loading monitored forest…" />;
  const D = d.data;
  const probs = inc.data.incidents.map((i) => i.ml.probability);
  const lo = Math.min(...probs), hi = Math.max(...probs);
  const pts: Pt[] = inc.data.incidents.map((i) => ({
    id: i.id, lat: i.lat, lon: i.lon, radius: 8,
    color: by === "risk" ? LEVEL_COLOR[i.risk.level] : ramp(hi === lo ? 0.5 : (i.ml.probability - lo) / (hi - lo)),
    tip: `${i.id} · ${i.risk.level} · RF p=${i.ml.probability.toFixed(3)}`,
  }));

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label mb-2">Dashboard · {D.study_area}</div>
          <h1 className="h-display max-w-4xl text-4xl leading-tight md:text-5xl">What is happening in the monitored forest?</h1>
        </div>
        <Link to="/replay" className="btn-primary">Run historical event →</Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Observations analysed" value={D.observations} />
        <Stat label="ML-detected disturbances" value={D.ml_detected} tone={D.ml_detected ? "#ef4444" : "#6fcf97"} sub={`Random Forest probability ≥ ${D.ml_threshold}`} />
        <Stat label="Incidents" value={D.incidents} sub={`${D.by_risk.MODERATE} moderate · ${D.by_risk.LOW} low`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Panel kicker="Satellite view" title="Incident map"
          right={
            <div className="flex items-center gap-3">
              <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
                {([["risk", "Risk"], ["ml", "ML probability"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setBy(k)} className={`rounded-md px-2.5 py-1 ${by === k ? "bg-moss-500/15 text-moss-400" : "text-stone-400"}`}>{l}</button>
                ))}
              </div>
              {by === "risk"
                ? <div className="hidden gap-2 sm:flex">{(["LOW", "MODERATE", "HIGH", "CRITICAL"] as const).map((l) => <span key={l} className="flex items-center gap-1.5 text-[11px] text-stone-400"><i className="h-2.5 w-2.5 rounded-full" style={{ background: LEVEL_COLOR[l] }} />{l}</span>)}</div>
                : <div className="hidden items-center gap-2 font-mono text-[11px] text-stone-400 sm:flex">{lo.toFixed(2)}<span className="h-2 w-24 rounded" style={{ background: `linear-gradient(90deg,${ramp(0)},${ramp(0.5)},${ramp(1)})` }} />{hi.toFixed(2)}</div>}
            </div>
          }>
          <MapView pts={pts} onPick={(id) => nav(`/incidents/${id}`)} height={560} />
        </Panel>

        <Panel kicker="Ranked by risk score, then RF probability" title="Priority incidents">
          <div className="space-y-2.5">
            {D.priority.map((i) => (
              <Link key={i.id} to={`/incidents/${i.id}`} className="block rounded-xl border border-white/[0.07] bg-ink-900/60 p-3.5 transition hover:border-moss-500/40">
                <div className="flex items-center justify-between"><span className="font-mono text-sm text-stone-50">{i.id}</span><RiskBadge level={i.risk.level} size="sm" /></div>
                <div className="mt-1 text-sm text-stone-300">{i.title}</div>
                <div className="mt-1.5 font-mono text-[11px] text-stone-500">RF p={i.ml.probability.toFixed(3)} · {i.cluster}</div>
              </Link>
            ))}
          </div>
          <Link to="/incidents" className="btn-ghost mt-4 w-full">All incidents →</Link>
        </Panel>
      </div>
    </div>
  );
}
