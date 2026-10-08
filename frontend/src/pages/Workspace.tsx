import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import AiResult from "../components/AiResult";
import EvidencePanel from "../components/Evidence";
import MapView, { Pt } from "../components/MapView";
import { Chip, ErrorBox, LEVEL_COLOR, Panel, RiskBadge, Spinner, useLoad } from "../components/ui";
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

  return (
    <div className="space-y-5 fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/incidents" className="label hover:text-moss-400">← Incidents</Link>
          <div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="h-display text-4xl">{inc.id}</h1><RiskBadge level={inc.risk.level} /><Chip tone={inc.status === "NEW" ? "neutral" : inc.status === "REVIEWED" ? "good" : "warn"}>{inc.status}</Chip></div>
          <div className="mt-1 text-lg text-stone-300">{inc.title}</div>
          <div className="mt-1 text-sm text-stone-500">{inc.cluster} · CSV row {inc.csv_row_number} · {inc.lat.toFixed(5)}°N, {inc.lon.toFixed(5)}°E</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Switch incident" value={id} onChange={(e) => nav(`/incidents/${e.target.value}`)} className="rounded-xl border border-white/10 bg-ink-800 px-3 py-2.5 font-mono text-sm">{all.data?.incidents.slice().sort((a, b) => a.id.localeCompare(b.id)).map((i) => <option key={i.id}>{i.id}</option>)}</select>
          <button className="btn-ghost" onClick={() => setStatus(inc.status === "REVIEWED" ? "UNDER INVESTIGATION" : "REVIEWED")}>{inc.status === "REVIEWED" ? "Reopen" : "Mark reviewed"}</button>
          <button className="btn-primary" disabled={busy} onClick={investigate}>{busy && tab === "Investigation" ? "Investigating…" : "Investigate with TerraPulse AI"}</button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Panel kicker="Location" title="Where">
            <MapView pts={pts} focus={{ lat: inc.lat, lon: inc.lon }} zoom={16} height={280} jump={false} onPick={(i) => nav(`/incidents/${i}`)} />
          </Panel>
          <Panel kicker="Explainability" title={`Why is this ${inc.risk.level} risk?`}>
            <div className="mb-3 flex items-baseline gap-2"><span className="font-display text-4xl">{inc.risk.score}</span><span className="text-stone-500">/ {inc.risk.max_score} points</span></div>
            <ul className="space-y-2 text-[13px] leading-snug">
              {inc.risk.reasons.map((r) => <li key={r} className="flex gap-2"><span className="text-warn">▲</span><span>{r}</span></li>)}
              {inc.risk.not_triggered.map((r) => <li key={r} className="flex gap-2 text-stone-400"><span className="text-stone-600">○</span><span>{r}</span></li>)}
            </ul>
          </Panel>
        </div>

        <div className="space-y-5">
          <div className="glass flex gap-1 p-1.5">
            {TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-xl px-3 py-2 text-sm transition ${tab === t ? "bg-moss-500/15 text-moss-400" : "text-stone-400 hover:text-stone-100"}`}>{t}</button>)}
          </div>
          {err != null && <ErrorBox error={err} />}

          {tab === "Investigation" && (
            <Panel kicker="Grounded GenAI · Gemini" title="TerraPulse AI investigation">
              {busy && !report ? <Spinner text="TerraPulse AI is reading the evidence…" /> : cur ? (
                <div>
                  <div className="mb-3 flex items-center gap-2"><Chip tone="good">Generated by {cur.model}</Chip><button onClick={investigate} className="btn-ghost ml-auto !py-1 text-xs">Re-run</button></div>
                  <AiResult result={cur.result} />
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/15 p-8 text-center"><p className="mb-4 text-stone-400">No investigation yet.</p><button className="btn-primary" onClick={investigate}>Investigate with TerraPulse AI</button></div>
              )}

              <div className="mt-6 border-t border-white/[0.07] pt-5">
                <div className="label mb-3">Alert & report</div>
                {inc.alert ? (
                  <div className="mb-4 rounded-xl border p-4" style={{ borderColor: LEVEL_COLOR[inc.alert.level] + "66", background: LEVEL_COLOR[inc.alert.level] + "0d" }}>
                    <div className="font-mono text-xs tracking-widest" style={{ color: LEVEL_COLOR[inc.alert.level] }}>{inc.alert.tier}</div>
                    <div className="mt-1 font-display text-xl">{inc.alert.headline}</div>
                    <div className="mt-2 text-[13px]"><span className="label">Recommended action </span>{inc.alert.recommended_action}</div>
                  </div>
                ) : <p className="mb-4 text-sm text-stone-400">No alert: {inc.risk.level} risk is below the alert level (MODERATE).</p>}
                <button className="btn-ghost" disabled={busy} onClick={makeReport}>Generate investigation report</button>
                {!cur && <span className="ml-3 text-xs text-warn">Run the investigation first for a complete report.</span>}
                {report && <span className="ml-3 text-sm">Report #{report.id} ready. <Link className="text-moss-400 underline" to={`/reports/${report.id}`}>Open →</Link></span>}
              </div>
            </Panel>
          )}

          {tab === "Ask TerraPulse AI" && (
            <Panel kicker="Incident-scoped chat" title="Ask TerraPulse AI about this incident">
              <div className="mb-3 flex flex-wrap gap-1.5">{SUGGEST.map((s) => <button key={s} disabled={chatBusy} onClick={() => ask(s)} className="rounded-full border border-white/10 px-3 py-1 text-xs text-stone-300 hover:border-moss-500/50 hover:text-moss-400 disabled:opacity-50">{s}</button>)}</div>
              <div className="h-[420px] space-y-3 overflow-y-auto rounded-xl border border-white/[0.07] bg-ink-900/60 p-4">
                {inc.chat.length === 0 && <p className="text-sm text-stone-500">Answers use only {inc.id}'s evidence.</p>}
                {inc.chat.map((m, i) => <div key={i} className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "ml-auto bg-moss-500/15 text-stone-100" : "whitespace-pre-line border border-white/[0.07] bg-ink-800"}`}>{m.content}</div>)}
                {chatBusy && <Spinner text="Thinking…" />}<div ref={endRef} />
              </div>
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={2000} placeholder={`Ask about ${inc.id}…`} className="flex-1 rounded-xl border border-white/10 bg-ink-900 px-4 py-2.5 text-sm outline-none focus:border-moss-500/60" />
                <button className="btn-primary" disabled={chatBusy || !q.trim()}>Ask</button>
              </form>
            </Panel>
          )}
        </div>

        <EvidencePanel inc={inc} ev={inc.evidence} />
      </div>
    </div>
  );
}
