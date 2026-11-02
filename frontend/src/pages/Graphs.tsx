import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Bars, Chip, ErrorBox, Missing, Panel, Spinner, useLoad } from "../components/ui";
import type { Incident } from "../types";

interface Pt { t: string; v: number | null }
interface Ser { metric: string; label: string; unit: string; status: string; message?: string | null; points: Pt[]; source: string; note?: string; window?: string | null }
interface Resp {
  place: { lat: number; lon: number; label: string | null }; granularity: "month" | "year"; radius_km: number; range: { start: string | null; end: string | null };
  series: Ser[]; series_point?: { point_id: string; distance_km: number } | null; flag_years: number[];
  hansen: { status: string; loss_years: number[]; message?: string | null }; note: string; interpreted_as?: string; how?: string;
}
const METRICS = [["fire", "Fire detections"], ["ndvi", "NDVI (greenness)"], ["nbr", "NBR (burn / moisture)"], ["rain", "Rainfall"]] as const;
const COLOR: Record<string, string> = { ndvi: "#6fcf97", nbr: "#f5b041", rain: "#60a5fa", fire: "#fb923c" };
const EXAMPLES = ["Fire detections by month for TP-001 in 2024", "Greenness and burn index for TP-005 from 2019 to 2025", "Rainfall and NDVI by year near TP-010"];

/** One line chart over labelled steps (months or years). Gaps (null) break the line. */
function Line({ pts, color, unit, flag = [] }: { pts: Pt[]; color: string; unit: string; flag?: string[] }) {
  const W = 640, H = 190, pad = { l: 44, r: 10, t: 10, b: 26 };
  const vals = pts.map((p) => p.v).filter((v): v is number => v != null);
  if (!vals.length) return <p className="text-sm text-stone-400">No values in this period.</p>;
  const lo = Math.min(...vals, 0), hi = Math.max(...vals) || 1;
  const x = (i: number) => pad.l + (pts.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (pts.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const every = Math.ceil(pts.length / 10);
  let d = ""; pts.forEach((p, i) => { d += p.v == null ? "" : `${d && pts[i - 1]?.v != null ? "L" : "M"}${x(i)},${y(p.v)} `; });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Line chart, ${unit}`}>
      {[lo, (lo + hi) / 2, hi].map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.1)" /><text x={4} y={y(t) + 3} fontSize="10" fill="#a8a29e" fontFamily="monospace">{Math.abs(t) >= 100 ? t.toFixed(0) : t.toFixed(2)}</text></g>)}
      {pts.map((p, i) => <g key={p.t}>{flag.includes(p.t) && <rect x={x(i) - 14} y={pad.t} width={28} height={H - pad.t - pad.b} fill="#f5b041" opacity={0.14} />}{i % every === 0 && <text x={x(i)} y={H - 7} fontSize="10" fill="#a8a29e" textAnchor="middle" fontFamily="monospace">{p.t}</text>}</g>)}
      <path d={d} fill="none" stroke={color} strokeWidth={2} />
      {pts.map((p, i) => p.v != null && <circle key={i} cx={x(i)} cy={y(p.v)} r={3} fill={color}><title>{`${p.t}: ${p.v} ${unit}`}</title></circle>)}
    </svg>
  );
}

function SeriesCard({ s, flag, gran }: { s: Ser; flag: string[]; gran: string }) {
  const [table, setTable] = useState(false);
  return (
    <Panel title={s.label} right={s.status === "ok" ? <button className="text-sm text-moss-400 underline-offset-2 hover:underline" onClick={() => setTable((t) => !t)}>{table ? "Show chart" : "Show table"}</button> : undefined}>
      {s.status !== "ok" ? (
        <Missing what={s.label} how={s.message ?? undefined} />
      ) : table ? (
        <div className="max-h-72 overflow-auto rounded-lg border border-white/[0.07]"><table className="w-full text-sm"><thead><tr className="bg-white/[0.04] text-left text-xs text-stone-400"><th className="px-3 py-2 font-medium">{gran === "month" ? "Month" : "Year"}</th><th className="px-3 py-2 font-medium">{s.unit}</th></tr></thead>
          <tbody>{s.points.map((p) => <tr key={p.t} className="border-t border-white/[0.06]"><td className="px-3 py-1.5 font-mono">{p.t}</td><td className="px-3 py-1.5">{p.v ?? <span className="text-stone-500">no clear view</span>}</td></tr>)}</tbody></table></div>
      ) : s.metric === "fire" ? (
        <div className="overflow-x-auto"><div style={{ minWidth: Math.min(s.points.length * 22, 1200) }}><Bars labels={s.points.map((p) => p.t.slice(gran === "month" ? 2 : 0))} values={s.points.map((p) => p.v ?? 0)} color={COLOR.fire} /></div></div>
      ) : <Line pts={s.points} color={COLOR[s.metric]} unit={s.unit} flag={flag} />}
      <div className="mt-2 space-y-0.5 text-xs text-stone-400">
        <div>Source: {s.source}</div>
        {s.note && <div>{s.note}</div>}
        {s.status === "ok" && s.metric === "fire" && <div>Counts are FIRMS satellite detections only. Zero means none in the file, not proof of no fire.</div>}
      </div>
    </Panel>
  );
}

export default function Graphs() {
  const [sp] = useSearchParams();
  const inc = useLoad(() => api.get<{ incidents: Incident[] }>("/api/incidents"));
  const [text, setText] = useState(""); const [typedId, setTypedId] = useState("");
  const [place, setPlace] = useState(sp.get("incident") ?? "");
  const [lat, setLat] = useState(sp.get("lat") ?? ""); const [lon, setLon] = useState(sp.get("lon") ?? "");
  const [mets, setMets] = useState<string[]>(["fire", "ndvi", "nbr"]);
  const [gran, setGran] = useState<"month" | "year">("year");
  const [start, setStart] = useState(""); const [end, setEnd] = useState(""); const [radius, setRadius] = useState("2");
  const [res, setRes] = useState<Resp | null>(null); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const list = useMemo(() => (inc.data?.incidents ?? []).slice().sort((a, b) => a.id.localeCompare(b.id)), [inc.data]);

  const run = async (fn: () => Promise<Resp>) => { setBusy(true); setErr(null); try { setRes(await fn()); } catch (e) { setErr(e); setRes(null); } finally { setBusy(false); } };
  const manual = () => {
    let la = lat, lo = lon, label = "";
    const typed = typedId.trim().toUpperCase();
    if (place) { const i = list.find((x) => x.id === place); if (i) { la = String(i.lat); lo = String(i.lon); label = i.id; } }
    else if (typed) { const i = list.find((x) => x.id === typed); if (!i) { setErr(new Error(list.length ? `I could not find incident ${typed}.` : "The incident list has not loaded, so use coordinates instead.")); return; } la = String(i.lat); lo = String(i.lon); label = i.id; }
    if (!la || !lo) { setErr(new Error("Choose an incident, or enter latitude and longitude.")); return; }
    const q = new URLSearchParams({ lat: la, lon: lo, metrics: mets.join(",") || "fire", granularity: gran, radius_km: radius || "2" });
    if (start) q.set("start", start); if (end) q.set("end", end); if (label) q.set("label", label);
    return run(() => api.get<Resp>(`/api/timeseries?${q}`));
  };
  const askAi = () => text.trim().length >= 3 && run(() => api.post<Resp>("/api/timeseries/ask", { text }));
  useEffect(() => { if ((sp.get("lat") && sp.get("lon")) || sp.get("incident")) { if (inc.data || sp.get("lat")) void manual(); } }, [inc.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const flag = (res?.flag_years ?? []).map(String);
  const field = "rounded-xl border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-moss-500/60";
  return (
    <div className="space-y-5 fade-in">
      <div><h1 className="text-2xl font-semibold tracking-tight">Forest over time</h1><p className="mt-1 max-w-3xl text-sm text-stone-400">Ask for a graph of fire detections, greenness, burn index or rainfall around a place, by month or by year. Every value comes from the data files. The AI only chooses the chart settings.</p></div>

      <Panel title="Ask for a graph">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && askAi()} maxLength={400} placeholder="For example: fire detections by month near TP-001 in 2024" className={`${field} min-w-0 flex-1`} aria-label="Describe the graph you want" />
          <button type="button" className="btn-primary" disabled={busy || text.trim().length < 3} onClick={askAi}>Show graph</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} type="button" onClick={() => setText(e)} className="rounded-full border border-white/15 px-3 py-1 text-xs text-stone-300 hover:border-moss-500/50 hover:text-moss-400">{e}</button>)}</div>
      </Panel>

      <Panel title="Or choose the settings yourself">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm"><span className="mb-1 block text-stone-400">Incident {inc.data ? `(${list.length} available)` : inc.error ? "(could not load)" : "(loading…)"}</span>
            <select value={place} onChange={(e) => setPlace(e.target.value)} className={`${field} w-full`}><option value="">Use coordinates instead</option>{list.map((i) => <option key={i.id} value={i.id}>{i.id}</option>)}</select>
            {!place && <input value={typedId} onChange={(e) => setTypedId(e.target.value)} placeholder="or type an id, e.g. TP-003" className={`${field} mt-2 w-full`} aria-label="Incident id" />}</label>
          <label className="text-sm"><span className="mb-1 block text-stone-400">Latitude</span><input disabled={!!place || !!typedId.trim()} value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" placeholder="e.g. 11.6480" className={`${field} w-full disabled:opacity-40`} /></label>
          <label className="text-sm"><span className="mb-1 block text-stone-400">Longitude</span><input disabled={!!place || !!typedId.trim()} value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" placeholder="e.g. 76.4985" className={`${field} w-full disabled:opacity-40`} /></label>
          <label className="text-sm"><span className="mb-1 block text-stone-400">Fire search radius (km)</span><input value={radius} onChange={(e) => setRadius(e.target.value)} inputMode="decimal" className={`${field} w-full`} /></label>
          <label className="text-sm"><span className="mb-1 block text-stone-400">Group by</span>
            <select value={gran} onChange={(e) => setGran(e.target.value as "month" | "year")} className={`${field} w-full`}><option value="year">Year</option><option value="month">Month</option></select></label>
          <label className="text-sm"><span className="mb-1 block text-stone-400">From ({gran === "month" ? "2023-03" : "2019"})</span><input value={start} onChange={(e) => setStart(e.target.value)} className={`${field} w-full`} /></label>
          <label className="text-sm"><span className="mb-1 block text-stone-400">To ({gran === "month" ? "2024-03" : "2025"})</span><input value={end} onChange={(e) => setEnd(e.target.value)} className={`${field} w-full`} /></label>
          <fieldset className="text-sm"><legend className="mb-1 text-stone-400">Show</legend><div className="flex flex-wrap gap-x-4 gap-y-1">{METRICS.map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={mets.includes(k)} onChange={() => setMets((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]))} />{l}</label>)}</div></fieldset>
        </div>
        <div className="mt-4"><button type="button" className="btn-primary" disabled={busy || !mets.length} onClick={manual}>Show graph</button></div>
      </Panel>

      {inc.error != null && <ErrorBox error={inc.error} onRetry={inc.reload} />}
      {err != null && <ErrorBox error={err} />}
      {busy && <Spinner text="Reading the data files…" />}

      {res && !busy && (<>
        <div className="glass flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-sm">
          <div className="min-w-0"><span className="text-stone-400">Showing: </span>{res.interpreted_as ?? `${res.place.label ?? `${res.place.lat.toFixed(4)}, ${res.place.lon.toFixed(4)}`} · by ${res.granularity}`}</div>
          {res.how && <Chip tone={res.how.startsWith("AI") ? "good" : "warn"}>{res.how}</Chip>}
          {res.place.label && <Link className="text-moss-400 underline decoration-white/20" to={`/incidents/${res.place.label}`}>Open {res.place.label}</Link>}
          {res.series_point && <span className="text-xs text-stone-400">Vegetation values are from the data point {res.series_point.distance_km} km away.</span>}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">{res.series.map((s) => <SeriesCard key={s.metric} s={s} flag={flag} gran={res.granularity} />)}</div>
        {(res.flag_years.length > 0 || res.hansen.loss_years.length > 0 || res.hansen.status !== "ok") && (
          <Panel title="Marked years">
            {res.flag_years.length > 0 && <p className="text-sm">Highlighted on the yearly charts: <b>{res.flag_years.join(", ")}</b>. Greenness or burn index dropped by 0.10 or more against this place's own baseline. This is potential vegetation disturbance, not a confirmed cause.</p>}
            <p className="mt-2 text-sm text-stone-300">{res.hansen.loss_years.length ? <>Hansen tree-cover loss recorded nearby in: <b>{res.hansen.loss_years.join(", ")}</b> (supporting evidence only).</> : res.hansen.message ?? "Data unavailable in current prototype"}</p>
          </Panel>
        )}
        <p className="text-xs text-stone-500">{res.note}</p>
      </>)}
    </div>
  );
}
