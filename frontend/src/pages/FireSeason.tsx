import { api } from "../api";
import MapView, { Pt } from "../components/MapView";
import { Bars, Callout, ErrorBox, Missing, PageHead, Panel, Spinner, useLoad } from "../components/ui";

interface Res { status: string; message?: string; coverage?: string[]; years?: number[]; total_detections?: number; monthly?: number[]; months?: string[]; by_year?: Record<string, number[]>;
  hotspots?: { lat: number; lon: number; detections: number; peak_months: string[]; years_with_detections: number }[]; watch_months?: string[]; reliability?: string; caution?: string }

export default function FireSeason() {
  const q = useLoad(() => api.get<Res>("/api/fire-season"));
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Spinner />;
  const d = q.data;
  const max = Math.max(...(d.hotspots ?? []).map((h) => h.detections), 1);
  const pts: Pt[] = (d.hotspots ?? []).map((h, i) => ({ id: String(i), lat: h.lat, lon: h.lon, radius: 6 + (h.detections / max) * 12, color: "#f97316", tip: `${h.detections} detections · peak ${h.peak_months.join(", ")}` }));
  return (
    <div className="space-y-6 fade-in">
      <PageHead modes={["HISTORICAL"]} title="When and where have fire detections been recorded before?"
        sub="Planning information from past NASA FIRMS satellite hot-spot detections. It supports patrol and awareness planning. It is not a live prediction and does not say whether anything is burning now." />
      {d.status !== "ok" ? <Missing what="No FIRMS archive has been loaded yet" how="Run tools/fetch_firms.py with your free NASA FIRMS map key (several years, Mudumalai box) and save the CSV as backend/data/fire_detections.csv. The same file powers the fire cross-check on citizen reports and the Replay mode." /> : (<>
        <Callout tone={d.years!.length >= 3 ? "info" : "warn"} title={`Archive: ${d.coverage![0]} to ${d.coverage![1]} · ${d.total_detections} detections`}>{d.reliability}</Callout>
        <div className="grid gap-6 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel title="Detections by month" right={<span className="text-xs text-stone-400">Watch: <strong className="text-warn">{d.watch_months!.join(", ")}</strong></span>}>
            <Bars labels={d.months!} values={d.monthly!} highlight={d.months!.map((m, i) => (d.watch_months!.includes(m) ? i : -1)).filter((i) => i >= 0)} />
            <div className="mt-4 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-stone-500"><th className="py-1 pr-2 font-normal">Year</th>{d.months!.map((m) => <th key={m} className="px-1 text-center font-normal">{m}</th>)}</tr></thead>
              <tbody>{Object.entries(d.by_year!).map(([y, row]) => <tr key={y} className="border-t border-white/[0.06]"><td className="py-1 pr-2 font-mono text-stone-300">{y}</td>{row.map((v, i) => <td key={i} className="px-1 text-center font-mono" style={{ color: v ? "#fdba74" : "#57534e" }}>{v || "·"}</td>)}</tr>)}</tbody></table></div>
          </Panel>
          <Panel title="Hot-spot map">
            <MapView pts={pts} jump={false} height={300} />
            <div className="mt-3 space-y-1.5 text-sm">{d.hotspots!.slice(0, 6).map((h, i) => <div key={i} className="flex justify-between gap-3 rounded-lg bg-ink-900/60 px-3 py-1.5"><span className="font-mono text-xs text-stone-300">{h.lat.toFixed(2)}°N, {h.lon.toFixed(2)}°E</span><span className="text-stone-400">{h.detections} detections · peak {h.peak_months.join(", ")} · {h.years_with_detections} yr</span></div>)}</div>
          </Panel>
        </div>
        <Callout>{d.caution}</Callout>
      </>)}
    </div>
  );
}
