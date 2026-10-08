import { ReactNode, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import AuthImage from "../components/AuthImage";
import MapView, { Pt } from "../components/MapView";
import { Chip, ErrorBox, LEVEL_COLOR, Panel, RiskBadge, Spinner, Unavailable, useLoad } from "../components/ui";
import { CATEGORY_LABEL, FieldDetail, REPORT_STATUSES, ReportStatus } from "../fieldTypes";
import type { Observation } from "../types";
import { CRED_TONE } from "./FieldReports";

function List({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <div className="mt-4">
      <div className="label mb-1.5">{title}</div>
      {items.length ? <ul className="list-disc space-y-1 pl-5 text-[13px] text-stone-300">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <div className="text-[13px] text-stone-500">{empty}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 border-t border-white/[0.06] py-2.5 text-[13px] first:border-t-0"><div className="label !text-[10.5px] pt-0.5">{label}</div><div className="text-stone-300">{children}</div></div>;
}

export default function FieldReportDetail() {
  const { id } = useParams();
  const q = useLoad(() => api.get<{ report: FieldDetail }>(`/api/field-reports/${id}`), [id]);
  const obs = useLoad(() => api.get<{ observations: Observation[] }>("/api/observations"));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showTa, setShowTa] = useState(false);
  const aiStatus = q.data?.report.ai_status;

  useEffect(() => { if (q.data) setNotes(q.data.report.officer_notes); }, [q.data?.report.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (aiStatus !== "PENDING") return;
    const t = setInterval(q.reload, 3000);
    return () => clearInterval(t);
  }, [aiStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Spinner />;
  const r = q.data.report, ck = r.checks, ai = r.ai;

  async function act(kind: string, path: string, body?: unknown) {
    setSaving(kind); setErr(null);
    try { const res = await api.post<{ report: FieldDetail }>(path, body); q.setData({ report: res.report }); }
    catch (e) { setErr(e instanceof ApiError || e instanceof Error ? e.message : "Could not save"); }
    finally { setSaving(null); }
  }

  const pts: Pt[] = [
    ...(obs.data?.observations ?? []).filter((o) => o.lat != null).map((o) => ({ id: `o${o.row}`, lat: o.lat, lon: o.lon, color: LEVEL_COLOR[o.risk_level], radius: 5, dim: true, tip: `${o.incident_id ?? "Observation"} · ${o.risk_level}` })),
    { id: "report", lat: r.lat, lon: r.lon, color: "#ef4444", radius: 9, selected: true, tip: `Report #${r.id}` },
  ];

  return (
    <div className="space-y-6 fade-in">
      <div>
        <Link to="/field-reports" className="label hover:text-moss-400">← Citizen reports</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="h-display text-4xl">Report #{r.id}</h1>
          <RiskBadge level={r.priority_level} />
          <Chip>{CATEGORY_LABEL[r.category]}</Chip>
          <Chip tone={r.status === "NEW" ? "warn" : r.status === "VERIFIED" ? "good" : "neutral"}>{r.status}</Chip>
          <Chip tone="earth">Citizen report · unverified</Chip>
        </div>
        <div className="mt-2 text-sm text-stone-400">From {r.reporter_name} ({r.username}) · {new Date(r.created * 1000).toLocaleString()}</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel kicker="Photo" title="What the citizen sent">
            <AuthImage path={r.photo_url} alt={`Photo for report ${r.id}`} className="max-h-[440px] w-full rounded-xl border border-white/10 object-contain bg-black/30" />
            <div className="mt-4 text-sm"><span className="label">Citizen's note </span><span className="whitespace-pre-wrap text-stone-200">{r.note || <span className="text-stone-500">No note</span>}</span></div>
          </Panel>
          <Panel kicker="Location" title="Where it was reported">
            <MapView pts={pts} focus={{ lat: r.lat, lon: r.lon }} zoom={14} jump={false} height={340} />
            <div className="mt-3 font-mono text-xs text-stone-400">{r.lat.toFixed(5)}, {r.lon.toFixed(5)}{r.accuracy_m != null && ` · GPS accuracy about ${Math.round(r.accuracy_m)} m`}</div>
            <div className="mt-1 text-xs text-stone-500">Red = this report. Dim dots = TerraPulse historical observations, coloured by risk.</div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel kicker="Rule-based" title="Priority">
            <ul className="space-y-1.5 text-sm text-stone-300">{r.priority_reasons.reasons.map((x) => <li key={x}><span className="font-mono text-moss-400">{x.slice(0, 2)}</span>{x.slice(2)}</li>)}</ul>
            {r.priority_reasons.not_triggered.length > 0 && <List title="Not triggered" items={r.priority_reasons.not_triggered} />}
            <p className="mt-3 text-xs text-stone-500">{r.priority_reasons.rule}</p>
          </Panel>

          <Panel kicker="Grounded GenAI · Gemini" title="AI report check" right={
            <button disabled={saving !== null || aiStatus === "PENDING"} onClick={() => act("recheck", `/api/field-reports/${r.id}/recheck`)} className="btn-ghost !px-3 !py-1.5 text-xs">{saving === "recheck" ? "Starting…" : "Run AI check again"}</button>}>
            {aiStatus === "PENDING" && <div className="flex items-center gap-3 text-sm text-stone-400"><span className="h-4 w-4 animate-spin rounded-full border-2 border-moss-500 border-t-transparent" />The AI check is running. This page updates by itself.</div>}
            {aiStatus === "FAILED" && <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-amber-100">The AI check could not run: {r.ai_error}. The report and the priority above are unaffected. Use "Run AI check again" to retry.</div>}
            {ai && aiStatus === "DONE" && (<>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={CRED_TONE[ai.credibility] ?? "neutral"}>{ai.credibility}</Chip>
                <Chip>Photo: {ai.photo_quality}</Chip>
                <Chip>Matches category: {ai.photo_matches_reported_category}</Chip>
              </div>
              <p className="mt-3 text-sm text-stone-200">{ai.summary}</p>
              {ai.guard_flags.length > 0 && <div className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-amber-100">{ai.guard_flags.map((f) => <div key={f}>{f}</div>)}</div>}
              <List title="Visible in the photo" items={ai.photo_observations} />
              <List title="Evidence for" items={ai.evidence_for} empty="None listed." />
              <List title="Evidence against" items={ai.evidence_against} empty="None listed." />
              <List title="Contradictions" items={ai.contradictions} />
              <List title="Unknown or unavailable" items={ai.unknowns} />
              <div className="mt-4 text-[13px]"><span className="label">Suggested action </span>{ai.recommended_action}</div>
              <div className="mt-4 rounded-xl border border-white/10 bg-ink-900/60 p-3.5">
                <div className="label mb-1">Draft officer alert</div>
                <div className="font-display text-lg">{ai.officer_alert.headline}</div>
                <p className="mt-1 text-[13px] text-stone-300">{ai.officer_alert.message_en}</p>
                <button onClick={() => setShowTa((s) => !s)} className="mt-2 font-mono text-[11px] uppercase tracking-wider text-moss-400 hover:text-moss-500">{showTa ? "Hide Tamil" : "Show Tamil"}</button>
                {showTa && <p className="mt-1 text-[13px] text-stone-300">{ai.officer_alert.message_ta}</p>}
              </div>
              <div className="mt-3 text-xs text-stone-500">{r.legality}</div>
              <div className="mt-1 text-xs text-stone-500">AI-drafted from the photo and the checks below, using {r.ai_model}. It does not set the priority, decide legality or confirm anything. The officer decides.</div>
            </>)}
          </Panel>

          <Panel kicker="Deterministic checks" title="Map and data checks">
            <Row label="Nearest observations">{ck.nearest_observations.length ? ck.nearest_observations.map((n) => (
              <div key={n.incident_id}><Link to={`/incidents/${n.incident_id}`} className="font-mono text-moss-400 underline decoration-white/20">{n.incident_id}</Link> · {n.distance_km} km · {n.risk_level} · RF p {n.ml_probability}</div>)) : <Unavailable />}
              <div className="mt-1 text-xs text-stone-500">Historical observations, acquisition date unknown.</div></Row>
            <Row label="Fire detections">{ck.fire_detections.status === "ok"
              ? <>{ck.fire_detections.nearest ? <>Nearest {ck.fire_detections.nearest.distance_km} km away, {ck.fire_detections.nearest.detected_utc} UTC ({ck.fire_detections.nearest.hours_before_report} h before the report), confidence {ck.fire_detections.nearest.confidence}. {ck.fire_detections.recent_within_5km_72h ? "Within 5 km and 72 h." : "Not within 5 km and 72 h."}</> : "No detections within 10 km."}<div className="mt-1 text-xs text-stone-500">File covers {ck.fire_detections.coverage?.join(" to ")}.</div></>
              : <Unavailable>{ck.fire_detections.message}</Unavailable>}</Row>
            <Row label="Reserve boundary">{ck.reserve_boundary.status === "ok" ? (ck.reserve_boundary.inside ? `Inside${ck.reserve_boundary.name ? ` (${ck.reserve_boundary.name})` : ""}` : "Outside the loaded boundary") : <Unavailable>{ck.reserve_boundary.message}</Unavailable>}</Row>
            <Row label="Tree-cover loss"><Unavailable>{ck.tree_cover_loss.message}</Unavailable></Row>
            <Row label="Weather"><Unavailable>{ck.weather.message}</Unavailable></Row>
            <Row label="Base satellite image"><Unavailable>{ck.base_imagery.message}</Unavailable></Row>
            <Row label="Other reporters">{ck.other_reports_nearby.distinct_other_reporters} other {ck.other_reports_nearby.distinct_other_reporters === 1 ? "person" : "people"} within {ck.other_reports_nearby.radius_m} m in the last {ck.other_reports_nearby.window_hours} h</Row>
            <Row label="Photo metadata">{ck.photo.has_exif ? <>
              {ck.photo.exif_geotag_vs_reported ? `Photo geotag is ${ck.photo.exif_geotag_vs_reported.distance_km} km from the reported spot (${ck.photo.exif_geotag_vs_reported.consistent ? "consistent" : "differs"}).` : "Photo has no GPS tag."}
              {ck.photo.exif_time && ` Camera time ${ck.photo.exif_time}.`}</> : "No metadata in the photo."}
              <div className="mt-1 text-xs text-stone-500">{ck.photo.note}</div></Row>
          </Panel>

          <Panel kicker="Officer decision" title="Review">
            <div className="flex flex-wrap gap-2">
              {REPORT_STATUSES.map((s: ReportStatus) => (
                <button key={s} disabled={saving !== null} onClick={() => act(s, `/api/field-reports/${r.id}/review`, { status: s, notes })} aria-pressed={r.status === s}
                  className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition ${r.status === s ? "border-moss-500/60 bg-moss-500/15 text-moss-400" : "border-white/10 text-stone-300 hover:bg-white/5"}`}>{saving === s ? "Saving…" : s}</button>
              ))}
            </div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Notes (kept with the report)" aria-label="Officer notes"
              className="mt-3 w-full rounded-xl border border-white/10 bg-ink-900/80 px-3.5 py-2.5 text-sm text-stone-100 outline-none transition placeholder:text-stone-600 focus:border-moss-500/60 focus:ring-2 focus:ring-moss-500/20" />
            {err && <div role="alert" className="mt-3 rounded-xl border border-crit/40 bg-crit/10 px-3.5 py-2 text-sm text-red-200">{err}</div>}
            <div className="mt-2 text-xs text-stone-500">{r.reviewed_by ? `Last reviewed by ${r.reviewed_by} · ${new Date(r.updated * 1000).toLocaleString()}. ` : ""}Choosing a status saves it together with the notes. The citizen only sees Received, Under review, Action taken or Closed.</div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
