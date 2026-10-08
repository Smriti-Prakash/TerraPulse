import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Chip, ErrorBox, Panel, Spinner, useLoad } from "../components/ui";
import type { Alert, Dashboard, IncidentDetail, Report } from "../types";

type St = "idle" | "run" | "ok" | "fail";
interface Step { title: string; state: St; detail?: string }
const TITLES = ["Loading real historical observation", "Reading actual evidence", "Running Random Forest", "ML disturbance assessment", "Reviewing supporting evidence", "Running TerraPulse AI investigation", "Risk assessment", "Alert generated", "Report ready"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (k: string, v: number) => (k === "Rainfall" ? v.toPrecision(4) : String(Number(v.toPrecision(7))));
const fresh = (): Step[] => TITLES.map((title) => ({ title, state: "idle" }));

export default function Hub() {
  const d = useLoad(() => api.get<Dashboard>("/api/dashboard"));
  const [pick, setPick] = useState<"fire" | "vegetation" | "top">("fire");
  const [steps, setSteps] = useState<Step[]>(fresh());
  const [running, setRunning] = useState(false);
  const [out, setOut] = useState<{ inc?: IncidentDetail; report?: Report; ai?: Record<string, any>; pred?: any; alert?: Alert | null } | null>(null);
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Spinner />;
  const demo = d.data.demo_records;
  const choices = [["fire", "Thermal / fire-evidence record"], ["vegetation", "Vegetation-anomaly record"], ["top", "Top-ranked incident"]] as const;

  const set = (i: number, p: Partial<Step>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const run = async () => {
    const id = demo[pick]?.incident_id; if (!id) return;
    setRunning(true); setOut({}); setSteps(fresh());
    const step = async <T,>(i: number, fn: () => Promise<{ v: T; detail: string }>, soft = false): Promise<T | undefined> => {
      set(i, { state: "run" }); await sleep(450);
      try { const r = await fn(); set(i, { state: "ok", detail: r.detail }); return r.v; }
      catch (e: any) { set(i, { state: "fail", detail: e?.message ?? String(e) }); if (!soft) throw e; return undefined; }
    };
    try {
      const inc = await step(0, async () => { const v = await api.get<IncidentDetail>(`/api/incidents/${id}`); return { v, detail: `${v.id} = CSV row ${v.csv_row_number} (${v.system_index}) at ${v.lat.toFixed(5)}°N, ${v.lon.toFixed(5)}°E` }; });
      if (!inc) return; setOut((o) => ({ ...o, inc }));
      await step(1, async () => ({ v: 0, detail: Object.entries(inc.features).map(([k, v]) => `${k}=${num(k, v)}`).join(" · ") }));
      const pred = await step(2, async () => { const v = await api.post<any>("/api/predict", inc.features); return { v, detail: `POST /api/predict → probability ${v.probability.toFixed(3)} from ${v.trees} trees` }; });
      if (!pred) return; setOut((o) => ({ ...o, pred }));
      await step(3, async () => ({ v: 0, detail: `${pred.label} (threshold ${pred.threshold}). The model is a forest-disturbance model, not a fire classifier.` }));
      const sc = inc.evidence.vegetation.spatial_context;
      await step(4, async () => ({ v: 0, detail: [inc.evidence.fire.label, `NDVI ${inc.features.NDVI.toFixed(3)} / NBR ${inc.features.NBR.toFixed(3)} (spatial z ${sc.NDVI.robust_z?.toFixed(2)} / ${sc.NBR.robust_z?.toFixed(2)})`].join(" · ") }));
      const ai = await step(5, async () => { const r = await api.post<{ investigation: { result: Record<string, any> } }>(`/api/incidents/${id}/investigate`, { scenario: "investigate" }); return { v: r.investigation.result, detail: "Gemini returned a structured, grounded investigation." }; }, true);
      setOut((o) => ({ ...o, ai }));
      await step(6, async () => ({ v: 0, detail: `${inc.risk.level} — score ${inc.risk.score}/4. ${inc.risk.reasons.concat(inc.risk.not_triggered).join(" ")}` }));
      const alert = await step(7, async () => { const a = await api.get<IncidentDetail>(`/api/incidents/${id}`); return { v: a.alert, detail: a.alert ? `${a.alert.tier}: ${a.alert.headline}` : `No alert — ${inc.risk.level} is below the MODERATE alert threshold.` }; });
      setOut((o) => ({ ...o, alert }));
      const report = await step(8, async () => { const v = await api.post<Report>(`/api/incidents/${id}/report`); return { v, detail: `Report #${v.id} stored${v.body.ai_generated ? "" : " (AI sections pending: investigation step failed)"}.` }; });
      setOut((o) => ({ ...o, report }));
    } catch { /* surfaced in the step list */ } finally { setRunning(false); }
  };

  const icon = (s: St) => s === "ok" ? <span className="text-moss-400">●</span> : s === "run" ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-moss-500 border-t-transparent" /> : s === "fail" ? <span className="text-crit">✕</span> : <span className="text-stone-600">○</span>;
  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="label mb-2">Replay</div><h1 className="h-display text-4xl">Historical event replay</h1>
        <p className="mt-2 max-w-3xl text-stone-400">Replays one actual CSV record through the real pipeline: Random Forest → evidence interpretation → Gemini → risk → alert → report.</p></div></div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel kicker="Select a real record" title="Run historical event">
          <div className="space-y-2">{choices.map(([k, l]) => demo[k] && (
            <label key={k} className={`block cursor-pointer rounded-xl border p-3.5 ${pick === k ? "border-moss-500/60 bg-moss-500/10" : "border-white/[0.07]"}`}>
              <input type="radio" className="mr-2" checked={pick === k} onChange={() => setPick(k)} /> <span className="text-stone-100">{l}</span> <Chip tone="earth">{demo[k].incident_id}</Chip>
              <div className="mt-1 pl-6 text-xs text-stone-500">Selection rule: {demo[k].rule}</div></label>))}</div>
          <button className="btn-primary mt-4 w-full !py-3 text-base" onClick={run} disabled={running}>{running ? "Running…" : "RUN HISTORICAL EVENT"}</button>
          <ol className="mt-5 space-y-2">{steps.map((s, i) => (
            <li key={i} className={`rounded-xl border p-3 transition ${s.state === "run" ? "border-moss-500/60 bg-moss-500/5" : "border-white/[0.07]"}`}>
              <div className="flex items-center gap-3 text-sm"><span className="w-4">{icon(s.state)}</span><span className={s.state === "idle" ? "text-stone-500" : "text-stone-100"}>{s.title}</span></div>
              {s.detail && <div className={`mt-1.5 pl-7 font-mono text-[11.5px] leading-snug ${s.state === "fail" ? "text-red-300" : "text-stone-400"}`}>{s.detail}</div>}
            </li>))}</ol>
        </Panel>

        <div className="space-y-6">
          <Panel kicker="Evidence trail" title={out?.inc ? `${out.inc.id} · ${out.inc.title}` : "Results appear here"}>
            {!out?.inc ? <p className="text-sm text-stone-400">Choose a record and press RUN HISTORICAL EVENT.</p> : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(out.inc.features).map(([k, v]) => <div key={k} className="rounded-lg bg-ink-900/70 p-2.5"><div className="label !text-[9px]">{k}</div><div className="font-mono text-sm">{num(k, v)}</div></div>)}</div>
                {out.pred && <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-3.5 text-sm"><span className="label">Random Forest </span>p = <strong className="text-moss-400">{out.pred.probability.toFixed(3)}</strong> · {out.pred.label} · stored incident value {out.inc.ml.probability.toFixed(3)} ({Math.abs(out.pred.probability - out.inc.ml.probability) < 1e-9 ? "identical" : "differs"})</div>}
                {out.ai && <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-3.5 text-sm leading-relaxed"><span className="label">TerraPulse AI </span><div className="mt-1">{typeof out.ai.detected === "string" ? out.ai.detected : JSON.stringify(out.ai.fire_assessment ?? "")}</div></div>}
                {out.alert !== undefined && <div className="rounded-xl border border-warn/30 bg-warn/5 p-3.5 text-sm"><span className="label">Alert </span>{out.alert ? `${out.alert.tier} — ${out.alert.headline}` : "No alert at this risk level"}</div>}
                <div className="flex gap-2"><Link className="btn-ghost" to={`/incidents/${out.inc.id}`}>Open workspace</Link>{out.report && <Link className="btn-primary" to={`/reports/${out.report.id}`}>Open report #{out.report.id}</Link>}</div>
              </div>)}
          </Panel>
        </div>
      </div>
    </div>
  );
}
