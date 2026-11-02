import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import AiResult from "../components/AiResult";
import EvidencePanel from "../components/Evidence";
import MapView, { Pt } from "../components/MapView";
import { Chip, ErrorBox, Kpi, LEVEL_COLOR, ModeTag, Panel, RiskBadge, Section, Spinner, useLoad } from "../components/ui";
import Impact from "../components/Impact";
import { draftAlert } from "./Community";
import { Nearby, sentence } from "../fieldTypes";
import type { Incident, IncidentDetail, Investigation, Report } from "../types";

const TABS = ["Investigation", "Ask TerraPulse AI"] as const;
const SUGGEST = ["Why was this location flagged?", "Could this disturbance be fire-related?", "What evidence is missing?", "How serious is this incident?", "What should investigators prioritize?"];

export default function Workspace() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { data: inc, error, reload, setData } = useLoad(() => api.get<IncidentDetail>(`/api/incidents/${id}`), [id]);
  const all = useLoad(() => api.get<{ incidents: Incident[] }>("/api/incidents"));
  const [tab, setTab] = useState<(typeof TABS)[number]>("Investigation");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setErr(null); setReport(null); }, [id]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [inc?.chat.length, chatBusy]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!inc) return <Spinner text="Opening incident…" />;

  const investigate = async () => {
    setTab("Investigation"); setBusy(true); setErr(null);
    try { const r = await api.post<{ investigation: Investigation; status: string }>(`/api/incidents/${id}/investigate`, { scenario: "investigate" }); setData({ ...inc, status: r.status, investigations: { ...inc.investigations, investigate: r.investigation } }); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const ask = async (m: string) => {
    if (!m.trim()) return; setChatBusy(true); setErr(null); setQ("");
    const before = inc.chat;
    setData({ ...inc, chat: [...before, { role: "user", content: m }] });
    try { const r = await api.post<{ chat: IncidentDetail["chat"] }>(`/api/incidents/${id}/chat`, { message: m }); setData({ ...inc, chat: r.chat }); }
    catch (e) { setErr(e); setData({ ...inc, chat: before }); } finally { setChatBusy(false); }
  };
  const setStatus = async (status: string) => { await api.post(`/api/incidents/${id}/status`, { status }); setData({ ...inc, status }); };
  const makeReport = async () => { setBusy(true); setErr(null); try { setReport(await api.post<Report>(`/api/incidents/${id}/report`)); } catch (e) { setErr(e); } finally { setBusy(false); } };

  const cur = inc.investigations.investigate;
  const pts: Pt[] = (all.data?.incidents ?? []).map((i) => ({ id: i.id, lat: i.lat, lon: i.lon, color: LEVEL_COLOR[i.risk.level], selected: i.id === id, dim: i.id !== id, radius: i.id === id ? 9 : 5, tip: i.id }));

  const sig = (k: string) => inc.evidence.signals.find((x) => x.key === k);
  const lvl = LEVEL_COLOR[inc.risk.level];
  const fmt = (k: string) => { const v = sig(k)?.value; return v == null ? "—" : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3); };

  return (
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/incidents" className="text-sm text-stone-400 hover:text-moss-400">← Incidents</Link>
          <div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{inc.id}</h1><RiskBadge level={inc.risk.level} /><Chip tone={inc.status === "NEW" ? "neutral" : inc.status === "REVIEWED" ? "good" : "warn"}>{sentence(inc.status)}</Chip><ModeTag mode="HISTORICAL">evidence file, no date</ModeTag></div>
          <div className="mt-1 text-base text-stone-300">{inc.title}</div>
          <div className="mt-0.5 text-sm text-stone-500">{inc.cluster} · CSV row {inc.csv_row_number} · {inc.lat.toFixed(5)}°N, {inc.lon.toFixed(5)}°E</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Switch incident" value={id} onChange={(e) => nav(`/incidents/${e.target.value}`)} className="rounded-xl border border-white/15 bg-ink-700 px-3 py-2.5 font-mono text-sm">{all.data?.incidents.slice().sort((a, b) => a.id.localeCompare(b.id)).map((i) => <option key={i.id}>{i.id}</option>)}</select>
          <button className="btn-ghost" onClick={() => setStatus(inc.status === "REVIEWED" ? "UNDER INVESTIGATION" : "REVIEWED")}>{inc.status === "REVIEWED" ? "Reopen" : "Mark reviewed"}</button>
          <button className="btn-ghost" onClick={async () => { const a = await draftAlert({ kind: "vegetation", source_type: "incident", source_ref: inc.id }); nav(`/community?open=${a.id}`); }} title="Creates a draft only. An officer must approve it.">Draft community notice</button>
          <button className="btn-primary" disabled={busy} onClick={investigate}>{busy && tab === "Investigation" ? "Investigating…" : cur ? "Re-run AI investigation" : "Run AI investigation"}</button>
        </div>
      </div>

      <section className="glass grid grid-cols-[minmax(0,1fr)] gap-5 border-l-4 p-5 sm:grid-cols-2 lg:grid-cols-4" style={{ borderLeftColor: lvl }} aria-label="Summary">
        <Kpi label="Risk level" value={<span style={{ color: lvl }}>{sentence(inc.risk.level)}</span>} sub={`${inc.risk.score} of ${inc.risk.max_score} points`} />
        <Kpi label="Random Forest probability" value={inc.ml.probability.toFixed(3)} sub={inc.ml.disturbance_detected ? `Above the ${inc.ml.threshold} threshold` : `Below the ${inc.ml.threshold} threshold, not flagged`} />
        <Kpi label="Key readings" value={<span className="text-base font-medium">NDVI {fmt("NDVI")} · NBR {fmt("NBR")}</span>} sub={`Thermal brightness ${fmt("Fire_Brightness")} K`} />
        <Kpi label="Alert" value={<span className="text-base font-medium">{inc.alert ? inc.alert.tier : "None"}</span>} sub={inc.alert ? inc.alert.headline : `${sentence(inc.risk.level)} risk is below the alert level`} />
      </section>

      <div className="grid gap-5 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-5">
          <div className="glass flex gap-1 p-1.5">
            {TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${tab === t ? "bg-moss-500 font-medium text-ink-950" : "text-stone-300 hover:bg-white/[0.06]"}`}>{t}</button>)}
          </div>
          {err != null && <ErrorBox error={err} />}

          {tab === "Investigation" && (<>
            <Panel title="AI investigation" right={cur ? <Chip tone="good">Generated by {cur.model}</Chip> : undefined}>
              {busy && !report ? <Spinner text="TerraPulse AI is reading the evidence…" /> : cur ? <AiResult result={cur.result} /> : (
                <div className="rounded-xl border border-dashed border-white/15 p-8 text-center"><p className="mb-4 text-stone-400">No AI investigation has been run for this incident yet.</p><button className="btn-primary" onClick={investigate}>Run AI investigation</button></div>
              )}
            </Panel>
            <Panel title="Alert and report">
              {inc.alert && (
                <div className="mb-4 rounded-xl border p-4" style={{ borderColor: LEVEL_COLOR[inc.alert.level] + "66", background: LEVEL_COLOR[inc.alert.level] + "14" }}>
                  <div className="text-sm font-semibold" style={{ color: LEVEL_COLOR[inc.alert.level] }}>{inc.alert.tier}</div>
                  <div className="mt-1 text-lg">{inc.alert.headline}</div>
                  <div className="mt-2 text-sm"><span className="text-stone-400">Recommended action: </span>{inc.alert.recommended_action}</div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn-ghost" disabled={busy} onClick={makeReport}>Generate investigation report</button>
                {!cur && <span className="text-sm text-warn">Run the AI investigation first for a complete report.</span>}
                {report && <span className="text-sm">Report #{report.id} is ready. <Link className="text-moss-400 underline" to={`/reports/${report.id}`}>Open it</Link></span>}
              </div>
            </Panel>
          </>)}

          {tab === "Ask TerraPulse AI" && (
            <Panel title="Ask TerraPulse AI about this incident">
              <div className="mb-3 flex flex-wrap gap-1.5">{SUGGEST.map((s) => <button key={s} disabled={chatBusy} onClick={() => ask(s)} className="rounded-full border border-white/15 px-3 py-1 text-xs text-stone-300 hover:border-moss-500/50 hover:text-moss-400 disabled:opacity-50">{s}</button>)}</div>
              <div className="h-[460px] space-y-3 overflow-y-auto rounded-xl border border-white/[0.07] bg-ink-900/60 p-4">
                {inc.chat.length === 0 && <p className="text-sm text-stone-500">Answers use only {inc.id}'s evidence.</p>}
                {inc.chat.map((m, i) => <div key={i} className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "ml-auto bg-moss-500/15 text-stone-100" : "whitespace-pre-line border border-white/[0.07] bg-ink-800"}`}>{m.content}</div>)}
                {chatBusy && <Spinner text="Thinking…" />}<div ref={endRef} />
              </div>
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={2000} placeholder={`Ask about ${inc.id}…`} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-ink-900 px-4 py-2.5 text-sm outline-none focus:border-moss-500/60" />
                <button className="btn-primary" disabled={chatBusy || !q.trim()}>Ask</button>
              </form>
            </Panel>
          )}
        </div>

        <aside className="min-w-0 space-y-5">
          <Panel title="Where">
            <MapView pts={pts} focus={{ lat: inc.lat, lon: inc.lon }} zoom={16} height={260} jump={false} onPick={(i) => nav(`/incidents/${i}`)} />
          </Panel>
          <Section title={`Why is this ${sentence(inc.risk.level).toLowerCase()} risk?`} summary={`${inc.risk.score} of ${inc.risk.max_score} points`} defaultOpen>
            <ul className="space-y-2 text-sm leading-snug">
              {inc.risk.reasons.map((r) => <li key={r} className="flex gap-2"><span className="text-warn">▲</span><span>{r}</span></li>)}
              {inc.risk.not_triggered.map((r) => <li key={r} className="flex gap-2 text-stone-400"><span className="text-stone-600">○</span><span>{r}</span></li>)}
            </ul>
          </Section>
          <Section title="Evidence values" summary={`probability ${inc.ml.probability.toFixed(3)}`} defaultOpen><EvidencePanel inc={inc} ev={inc.evidence} /></Section>
          <Section title="People and places nearby" defaultOpen><NearbyBody lat={inc.lat} lon={inc.lon} /></Section>
        </aside>
      </div>
      <Section title="Compare with other incidents" summary="closest on the map and most alike by measured values" defaultOpen><CompareBody id={id} lat={inc.lat} lon={inc.lon} /></Section>
    </div>
  );
}

function NearbyBody({ lat, lon }: { lat: number; lon: number }) {
  const q = useLoad(() => api.get<Nearby>(`/api/nearby?lat=${lat}&lon=${lon}&radius_km=5`), [lat, lon]);
  return q.error ? <ErrorBox error={q.error} onRetry={q.reload} /> : !q.data ? <Spinner /> : <Impact n={q.data} />;
}

interface CRow { incident_id: string; distance_km: number | null; similarity_distance: number | null; risk_level: Incident["risk"]["level"]; ml_probability: number; status: string; ai_investigated: boolean; ndvi: number; nbr: number; thermal_k: number; d_ndvi: number; d_nbr: number; d_thermal_k: number }
interface Compare {
  note: string; summary: string[]; ranks: { of: number };
  nearest: CRow[]; most_similar: CRow[];
  citizen_reports_nearby: { radius_km: number; count: number; reports: { report_id: number; category: string; status: string; priority_level: string; distance_km: number }[] };
  fire_history: { status: string; message?: string; radius_km?: number; coverage?: string[]; total?: number; by_year?: Record<string, number>; note?: string };
}
const sg = (n: number, d = 2) => (n > 0 ? "+" : "") + n.toFixed(d);

function CompareTable({ rows, by }: { rows: CRow[]; by: "distance" | "similarity" }) {
  if (!rows.length) return <p className="text-sm text-stone-400">No other incidents to compare.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.07]">
      <table className="w-full min-w-[520px] text-sm">
        <thead><tr className="bg-white/[0.04] text-left text-xs text-stone-400"><th className="px-3 py-2 font-medium">Incident</th><th className="px-3 py-2 font-medium">{by === "distance" ? "Distance" : "Likeness*"}</th><th className="px-3 py-2 font-medium">Risk</th><th className="px-3 py-2 font-medium">RF p</th><th className="px-3 py-2 font-medium">NDVI (vs this)</th><th className="px-3 py-2 font-medium">NBR (vs this)</th><th className="px-3 py-2 font-medium">Thermal K (vs this)</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.incident_id} className="border-t border-white/[0.06]">
            <td className="px-3 py-2"><Link className="font-mono text-moss-400 underline decoration-white/20" to={`/incidents/${r.incident_id}`}>{r.incident_id}</Link></td>
            <td className="px-3 py-2">{by === "distance" ? `${r.distance_km} km` : r.similarity_distance?.toFixed(2)}</td>
            <td className="px-3 py-2"><RiskBadge level={r.risk_level} size="sm" /></td>
            <td className="px-3 py-2 font-mono">{r.ml_probability.toFixed(3)}</td>
            <td className="px-3 py-2 font-mono">{r.ndvi.toFixed(3)} <span className="text-stone-500">({sg(r.d_ndvi, 3)})</span></td>
            <td className="px-3 py-2 font-mono">{r.nbr.toFixed(3)} <span className="text-stone-500">({sg(r.d_nbr, 3)})</span></td>
            <td className="px-3 py-2 font-mono">{r.thermal_k.toFixed(1)} <span className="text-stone-500">({sg(r.d_thermal_k, 1)})</span></td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

function CompareBody({ id, lat, lon }: { id: string; lat: number; lon: number }) {
  const q = useLoad(() => api.get<Compare>(`/api/incidents/${id}/compare`), [id]);
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Spinner />;
  const c = q.data, fh = c.fire_history;
  return (
    <div className="space-y-4">
      <p className="text-xs text-stone-400">{c.note}</p>
      <ul className="space-y-1 text-sm">{c.summary.map((s) => <li key={s}>{s}</li>)}</ul>
      <div><div className="mb-1.5 text-xs font-medium text-stone-400">Closest on the map</div><CompareTable rows={c.nearest} by="distance" /></div>
      <div><div className="mb-1.5 text-xs font-medium text-stone-400">Most alike by measured values</div><CompareTable rows={c.most_similar} by="similarity" /><p className="mt-1 text-xs text-stone-500">*Average gap across NDVI, NBR, radar, thermal, temperature and rainfall. Smaller means more alike.</p></div>
      <div>
        <div className="mb-1.5 text-xs font-medium text-stone-400">Citizen reports within {c.citizen_reports_nearby.radius_km} km</div>
        {c.citizen_reports_nearby.count === 0 ? <p className="text-sm text-stone-400">None.</p> : (
          <ul className="space-y-1 text-sm">{c.citizen_reports_nearby.reports.map((r) => <li key={r.report_id}><Link className="text-moss-400 underline decoration-white/20" to={`/field-reports/${r.report_id}`}>Report #{r.report_id}</Link> · {r.category} · {r.distance_km} km · {r.status}</li>)}</ul>)}
      </div>
      <div>
        <div className="mb-1.5 text-xs font-medium text-stone-400">Satellite fire detections by year{fh.radius_km ? ` within ${fh.radius_km} km` : ""}</div>
        {fh.status !== "ok" ? <p className="text-sm text-stone-400">{fh.message ?? "Data unavailable in current prototype"}</p> : (<>
          <div className="flex flex-wrap gap-2">{Object.entries(fh.by_year ?? {}).map(([y, n]) => <Chip key={y} tone={n ? "warn" : "neutral"}>{y}: {n}</Chip>)}</div>
          <p className="mt-1 text-xs text-stone-500">{fh.note} File covers {fh.coverage?.[0]} to {fh.coverage?.[1]}.</p></>)}
      </div>
      <Link className="btn-ghost inline-block" to={`/insights/graphs?incident=${id}`}>See this place over months and years</Link>
    </div>
  );
}
