import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import MapView, { Pt } from "../components/MapView";
import { Chip, ErrorBox, LEVEL_COLOR, Panel, Spinner, Unavailable, useLoad } from "../components/ui";
import type { Dashboard, Observation } from "../types";

interface Resp { observations: Observation[]; reference: Record<string, { min: number; max: number; median: number }>; feature_meta: Record<string, { label: string; unit: string; unit_note: string }> }

const LAYERS = ["ML probability"] as const;
const ramp = (t: number) => { const a = [31, 58, 95], b = [52, 211, 153], c = [250, 204, 21]; const m = t < 0.5 ? [a, b, t * 2] : [b, c, (t - 0.5) * 2]; const [p, q, u] = m as [number[], number[], number]; return `rgb(${p.map((x, i) => Math.round(x + (q[i] - x) * u)).join(",")})`; };
const val = (o: Observation, l: string) => (l === "ML probability" ? o.ml.probability : l === "Risk level" ? 0 : (o.features as any)[l] as number);

export default function Monitor() {
  const r = useLoad(() => api.get<Resp>("/api/observations"));
  const d = useLoad(() => api.get<Dashboard>("/api/dashboard"));
  const [layer, setLayer] = useState<string>(LAYERS[0]);
  const [sel, setSel] = useState<number | null>(null);
  const [cmp, setCmp] = useState<number | null>(null);
  const obs = r.data?.observations ?? [];
  const range = useMemo(() => { const v = obs.map((o) => val(o, layer)); return [Math.min(...v), Math.max(...v)]; }, [obs, layer]);
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  if (!r.data) return <Spinner />;
  const color = (o: Observation) => layer === "Risk level" ? LEVEL_COLOR[o.risk_level] : layer === "Forest" ? (o.features.Forest ? "#34d399" : "#c2a878") : ramp(range[1] === range[0] ? 0.5 : (val(o, layer) - range[0]) / (range[1] - range[0]));
  const pts: Pt[] = obs.map((o) => ({ id: String(o.row), lat: o.lat, lon: o.lon, color: color(o), selected: sel === o.row, radius: 8, tip: `CSV row ${o.csv_row_number} · ${layer}: ${layer === "Risk level" ? o.risk_level : val(o, layer).toPrecision(4)}` }));
  const S = obs.find((o) => o.row === sel), C = obs.find((o) => o.row === cmp);
  const unit = layer in r.data.feature_meta ? r.data.feature_meta[layer].unit : "";
  return (
    <div className="space-y-5 fade-in">
      <div><div className="label mb-2">Forest Monitor</div><h1 className="h-display text-4xl">Environmental evidence layers</h1>
        <p className="mt-2 max-w-3xl text-stone-400">Points are coloured by the Random Forest disturbance probability. Click a point to inspect it, and a second to compare.</p></div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title={layer} right={layer !== "Risk level" && layer !== "Forest" ? <div className="flex items-center gap-2 font-mono text-[11px] text-stone-400">{range[0].toPrecision(4)}<span className="h-2 w-36 rounded" style={{ background: `linear-gradient(90deg,${ramp(0)},${ramp(0.5)},${ramp(1)})` }} />{range[1].toPrecision(4)} {unit}</div> : undefined}>
          <MapView pts={pts} onPick={(id) => { const n = Number(id); if (sel !== null && n !== sel) setCmp(n); else setSel(n); }} height={540} />
          <p className="mt-2 text-xs text-stone-500">Click one point to inspect, a second to compare. Layer values are the supplied CSV values; colour scale spans this sample only.</p>
        </Panel>
        <div className="space-y-4">
          <Panel kicker="Observation" title={S ? `CSV row ${S.csv_row_number} · ${S.system_index}` : "Select a point"} right={S?.incident_id ? <Link to={`/incidents/${S.incident_id}`} className="btn-ghost !py-1.5 text-xs">Open {S.incident_id}</Link> : undefined}>
            {!S ? <p className="text-sm text-stone-400">Click any point on the map to see its actual feature values and model output.</p> : (
              <table className="w-full text-sm"><tbody>
                {Object.entries(S.features).map(([k, v]) => <tr key={k} className="border-t border-white/[0.06]"><td className="py-1.5 text-stone-400">{r.data!.feature_meta[k].label}</td><td className="text-right font-mono">{k === "Rainfall" ? v.toPrecision(4) : Number(v.toPrecision(7))}</td>{C && <td className="text-right font-mono text-earth-300">{k === "Rainfall" ? (C.features as any)[k].toPrecision(4) : (C.features as any)[k]}</td>}</tr>)}
                <tr className="border-t border-white/10"><td className="py-1.5 text-stone-400">RF probability</td><td className="text-right font-mono text-moss-400">{S.ml.probability.toFixed(3)}</td>{C && <td className="text-right font-mono text-earth-300">{C.ml.probability.toFixed(3)}</td>}</tr>
                <tr className="border-t border-white/[0.06]"><td className="py-1.5 text-stone-400">CSV prob. (unverified)</td><td className="text-right font-mono">{S.csv_disturbance_probability.toFixed(3)}</td>{C && <td className="text-right font-mono text-earth-300">{C.csv_disturbance_probability.toFixed(3)}</td>}</tr>
                <tr className="border-t border-white/[0.06]"><td className="py-1.5 text-stone-400">Location</td><td className="text-right font-mono text-xs">{S.lat.toFixed(5)}, {S.lon.toFixed(5)}</td>{C && <td className="text-right font-mono text-xs text-earth-300">{C.lat.toFixed(5)}, {C.lon.toFixed(5)}</td>}</tr>
              </tbody></table>
            )}
            {S && C && <button className="btn-ghost mt-3 !py-1.5 text-xs" onClick={() => setCmp(null)}>Clear comparison (row {C.csv_row_number})</button>}
          </Panel>
          <Panel kicker="Random Forest" title="Feature importance (from the .joblib)">
            {d.data && Object.entries(d.data.model.feature_importances).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} className="mb-2"><div className="flex justify-between text-xs"><span className="text-stone-300">{k}</span><span className="font-mono text-stone-400">{v.toFixed(3)}</span></div><div className="mt-1 h-1.5 rounded bg-white/10"><div className="h-full rounded bg-moss-500" style={{ width: `${v * 100 / 0.25 > 100 ? 100 : v * 100 / 0.25}%` }} /></div></div>
            ))}
            <p className="mt-2 text-[11px] text-stone-500">Forest has zero importance in this model. {d.data?.model.class_meaning_note}</p>
          </Panel>
        </div>
      </div>
      <Panel kicker="All observations" title="Compare available observations" right={<Chip tone="neutral">{obs.length} rows</Chip>}>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
          <thead><tr className="text-left font-mono text-[10.5px] uppercase tracking-wider text-stone-500">{["Row", "Incident", "NDVI", "NBR", "VV", "VH", "Fire br.", "Temp K", "Rain", "Forest", "RF p", "Risk"].map((h) => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
          <tbody>{obs.map((o) => <tr key={o.row} onClick={() => setSel(o.row)} className={`cursor-pointer border-t border-white/[0.06] hover:bg-white/[0.03] ${sel === o.row ? "bg-moss-500/10" : ""}`}>
            <td className="py-1.5 pr-3 font-mono">{o.csv_row_number}</td><td className="pr-3 font-mono">{o.incident_id ?? "—"}</td>
            {["NDVI", "NBR", "VV", "VH", "Fire_Brightness", "Temperature"].map((k) => <td key={k} className="pr-3 font-mono">{(o.features as any)[k].toFixed(k === "Fire_Brightness" || k === "Temperature" ? 2 : 3)}</td>)}
            <td className="pr-3 font-mono">{o.features.Rainfall.toFixed(5)}</td><td className="pr-3 font-mono">{o.features.Forest}</td><td className="pr-3 font-mono">{o.ml.probability.toFixed(3)}</td><td style={{ color: LEVEL_COLOR[o.risk_level] }} className="font-mono text-xs">{o.risk_level}</td></tr>)}</tbody></table></div>
        <p className="mt-3 text-xs text-stone-500">Note: Temperature and Rainfall take only 3 distinct values across the 27 points, and Fire_Brightness only 4 — these layers are coarse (likely resampled from coarser grids). <Unavailable>source resolution not stated</Unavailable></p>
      </Panel>
    </div>
  );
}
