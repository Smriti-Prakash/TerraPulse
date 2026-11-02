import { ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import AuthImage from "../components/AuthImage";
import MapView, { Pt } from "../components/MapView";
import { Callout, Chip, ErrorBox, LEVEL_COLOR, Panel, RiskBadge, Section, Spinner, Unavailable, useLoad } from "../components/ui";
import FireVerdict from "../components/FireVerdict";
import Impact from "../components/Impact";
import { draftAlert } from "./Community";
import { CATEGORY_LABEL, FieldDetail, REPORT_STATUSES, ReportStatus, sentence } from "../fieldTypes";
import type { Observation } from "../types";
import { CRED_TONE } from "./FieldReports";

function List({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-xs font-medium text-stone-400">{title}</div>
      {items.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-stone-300">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <div className="text-[13px] text-stone-500">{empty}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-1 border-t border-white/[0.06] py-2.5 text-sm sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3 first:border-t-0"><div className="pt-0.5 text-xs font-medium text-stone-400">{label}</div><div className="min-w-0 break-words text-stone-300">{children}</div></div>;
}

export default function FieldReportDetail() {
  const { id } = useParams();
  const q = useLoad(() => api.get<{ report: FieldDetail }>(`/api/field-reports/${id}`), [id]);
  const obs = useLoad(() => api.get<{ observations: Observation[] }>("/api/observations"));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showTa, setShowTa] = useState(false);
  const nav = useNavigate();
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

  const FV = { DETECTION_NEARBY: ["#fb923c", "Satellite detection nearby"], INCONCLUSIVE: ["#f5b041", "Inconclusive, needs field check"], CANNOT_CHECK: ["#a8a29e", "Cannot be cross-checked"] } as const;
  const [fvColor, fvText] = FV[ck.fire_detections.verdict] ?? FV.CANNOT_CHECK;
  const lvl = LEVEL_COLOR[r.priority_level];
  const nb = ck.community_impact;

  return (
    <div className="print-area space-y-5 fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/field-reports" className="text-sm text-stone-400 hover:text-moss-400">← Citizen reports</Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Report #{r.id}</h1>
            <RiskBadge level={r.priority_level} />
            <Chip>{CATEGORY_LABEL[r.category]}</Chip>
            <Chip tone={r.status === "NEW" ? "warn" : r.status === "VERIFIED" ? "good" : "neutral"}>{sentence(r.status)}</Chip>
            <Chip tone="earth">Unverified</Chip>
          </div>
          <div className="mt-1.5 text-sm text-stone-400">From {r.reporter_name} ({r.username}) · {new Date(r.created * 1000).toLocaleString()}</div>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <button className="btn-ghost !py-2 text-sm" onClick={() => window.print()}>Print officer brief</button>
          <button className="btn-ghost !py-2 text-sm" disabled={saving !== null} onClick={async () => { setSaving("draft"); try { const a = await draftAlert({ kind: r.category === "deforestation" ? "vegetation" : "fire_smoke", source_type: "report", source_ref: String(r.id) }); nav(`/community?open=${a.id}`); } catch (e) { setErr(e instanceof Error ? e.message : "Could not draft"); setSaving(null); } }}>Draft community alert (officer approves)</button>
        </div>
      </div>

      <section className="glass grid grid-cols-[minmax(0,1fr)] gap-5 border-l-4 p-5 md:grid-cols-2 xl:grid-cols-4" style={{ borderLeftColor: lvl }} aria-label="Summary">
        <div className="min-w-0">
          <div className="text-xs font-medium text-stone-400">Priority</div>
          <div className="mt-0.5 text-2xl font-semibold" style={{ color: lvl }}>{sentence(r.priority_level)}</div>
          <div className="mt-1 text-sm leading-snug text-stone-300">{r.priority_reasons.reasons.map((x) => x.replace(/^\+\d+\s*/, "")).join("; ") || "No priority points triggered"}</div>
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-stone-400">Satellite fire check (NASA FIRMS)</div>
          <div className="mt-1 flex items-center gap-2 text-base font-semibold"><span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: fvColor }} />{fvText}</div>
          <div className="mt-1 text-sm leading-snug text-stone-400">{ck.fire_detections.verdict === "INCONCLUSIVE" ? "No detection is not the same as no fire." : ck.fire_detections.verdict === "DETECTION_NEARBY" ? "Supports the report. Does not confirm a fire." : "The fire archive does not cover this case."}</div>
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-stone-400">AI photo check</div>
          {ai && aiStatus === "DONE" ? (<>
            <div className="mt-1 flex flex-wrap gap-1.5"><Chip tone={CRED_TONE[ai.credibility] ?? "neutral"}>{ai.credibility}</Chip><Chip>Photo: {ai.photo_quality}</Chip></div>
            <p className="mt-1.5 line-clamp-3 text-sm leading-snug text-stone-300">{ai.summary}</p>
          </>) : aiStatus === "PENDING" ? <div className="mt-1 text-sm text-stone-400">Running…</div> : <div className="mt-1 text-sm text-stone-400">{aiStatus === "FAILED" ? "Could not run" : "Not run"}</div>}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-stone-400">People and places nearby</div>
          <div className="mt-1 text-sm leading-snug text-stone-200">{nb.status === "ok" ? nb.summary_en : <Unavailable />}</div>
          <div className="mt-1 text-sm text-stone-400">{ck.other_reports_nearby.distinct_other_reporters} other {ck.other_reports_nearby.distinct_other_reporters === 1 ? "reporter" : "reporters"} within {ck.other_reports_nearby.radius_m} m</div>
        </div>
      </section>

      <section className="no-print glass p-4" aria-label="Review">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm font-medium text-stone-300">Review this report</span>
          {REPORT_STATUSES.map((s: ReportStatus) => (
            <button key={s} disabled={saving !== null} onClick={() => act(s, `/api/field-reports/${r.id}/review`, { status: s, notes })} aria-pressed={r.status === s}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${r.status === s ? "border-moss-500 bg-moss-500 font-medium text-ink-950" : "border-white/15 text-stone-300 hover:bg-white/[0.06]"}`}>{saving === s ? "Saving…" : sentence(s)}</button>
          ))}
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (saved with the report when you choose a status)" aria-label="Officer notes"
          className="mt-3 w-full rounded-xl border border-white/15 bg-ink-900/80 px-3.5 py-2 text-sm text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-moss-500/60 focus:ring-2 focus:ring-moss-500/20" />
        {err && <div role="alert" className="mt-2 rounded-xl border border-crit/40 bg-crit/10 px-3.5 py-2 text-sm text-red-200">{err}</div>}
        <div className="mt-1.5 text-xs text-stone-500">{r.reviewed_by ? `Last reviewed by ${r.reviewed_by} · ${new Date(r.updated * 1000).toLocaleString()}. ` : ""}The citizen only sees Received, Under review, Action taken or Closed.</div>
      </section>

      <div className="grid gap-5 grid-cols-[minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5 xl:sticky xl:top-4 xl:self-start">
          <Panel title="What the citizen sent">
            <AuthImage path={r.photo_url} alt={`Photo for report ${r.id}`} className="max-h-[320px] w-full rounded-xl border border-white/10 bg-black/30 object-contain" />
            <div className="mt-3 text-sm"><span className="text-stone-400">Citizen's note: </span><span className="whitespace-pre-wrap break-words text-stone-200">{r.note || <span className="text-stone-500">No note</span>}</span></div>
          </Panel>
          <Panel title="Where it was reported">
            <MapView pts={pts} focus={{ lat: r.lat, lon: r.lon }} zoom={14} jump={false} height={260} />
            <div className="mt-2 text-sm"><Link className="text-moss-400 underline decoration-white/20" to={`/insights/graphs?lat=${r.lat}&lon=${r.lon}`}>See this place over months and years</Link></div>
            <div className="mt-2 font-mono text-xs text-stone-400">{r.lat.toFixed(5)}, {r.lon.toFixed(5)}{r.accuracy_m != null && ` · GPS accuracy about ${Math.round(r.accuracy_m)} m`}</div>
            <div className="mt-1 text-xs text-stone-500">Red = this report. Dim dots = past observations, coloured by risk.</div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Section title="AI photo check" summary={ai && aiStatus === "DONE" ? `${ai.credibility} · photo ${ai.photo_quality}` : aiStatus === "PENDING" ? "running" : undefined} defaultOpen
            right={<button disabled={saving !== null || aiStatus === "PENDING"} onClick={() => act("recheck", `/api/field-reports/${r.id}/recheck`)} className="btn-ghost !px-3 !py-1.5 text-xs">{saving === "recheck" ? "Starting…" : "Run again"}</button>}>
            {aiStatus === "PENDING" && <div className="flex items-center gap-3 text-sm text-stone-400"><span className="h-4 w-4 animate-spin rounded-full border-2 border-moss-500 border-t-transparent" />The AI check is running. This page updates by itself.</div>}
            {aiStatus === "FAILED" && <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-amber-100">The AI check could not run: {r.ai_error}. The report and the priority are unaffected. Use "Run again" to retry.</div>}
            {!ai && !aiStatus && <p className="text-sm text-stone-400">The AI check has not run for this report.</p>}
            {ai && aiStatus === "DONE" && (<>
              <p className="text-sm leading-relaxed text-stone-200">{ai.summary}</p>
              {ai.guard_flags.length > 0 && <div className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-amber-100">{ai.guard_flags.map((f) => <div key={f}>{f}</div>)}</div>}
              <div className="mt-3 rounded-lg border border-moss-500/30 bg-moss-500/[0.07] p-3 text-sm"><span className="font-medium text-moss-400">Suggested action: </span>{ai.recommended_action}</div>
              <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-x-8 md:grid-cols-2">
                <List title="Evidence for" items={ai.evidence_for} empty="None listed." />
                <List title="Evidence against" items={ai.evidence_against} empty="None listed." />
              </div>
              <details className="mt-4 rounded-lg border border-white/[0.07] bg-ink-900/40">
                <summary className="cursor-pointer px-4 py-2.5 text-sm text-moss-400 hover:bg-white/[0.03]">Show the full AI analysis</summary>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 px-4 pb-4 md:grid-cols-2">
                  <List title="Visible in the photo" items={ai.photo_observations} />
                  <List title="Comparing the observations" items={ai.observation_comparison ?? []} />
                  <List title="Contradictions" items={ai.contradictions} />
                  <List title="Unknown or unavailable" items={ai.unknowns} />
                  <List title="Possible causes (hypotheses only)" items={ai.possible_causes ?? []} />
                  <List title="AI-suggested verification steps" items={ai.verification_checklist ?? []} />
                </div>
                <div className="mx-4 mb-4 rounded-xl border border-white/10 bg-ink-900/60 p-3.5">
                  <div className="text-xs font-medium text-stone-400">Draft officer alert</div>
                  <div className="mt-1 text-base">{ai.officer_alert.headline}</div>
                  <p className="mt-1 text-sm text-stone-300">{ai.officer_alert.message_en}</p>
                  <button onClick={() => setShowTa((x) => !x)} className="mt-2 text-xs text-moss-400 hover:underline">{showTa ? "Hide Tamil" : "Show Tamil"}</button>
                  {showTa && <p className="mt-1 text-sm text-stone-300">{ai.officer_alert.message_ta}</p>}
                </div>
              </details>
              <div className="mt-3 text-xs text-stone-500">{r.legality} AI-drafted from the photo and the checks, using {r.ai_model}. It does not set the priority, decide legality or confirm anything. The officer decides.</div>
            </>)}
          </Section>

          <Section title="Satellite and map checks" defaultOpen>
            <div className="mb-3"><FireVerdict fd={ck.fire_detections} /></div>
            <Row label="Nearest observations">{ck.nearest_observations.length ? ck.nearest_observations.map((n) => (
              <div key={n.incident_id}><Link to={`/incidents/${n.incident_id}`} className="font-mono text-moss-400 underline decoration-white/20">{n.incident_id}</Link> · {n.distance_km} km · {n.risk_level} · RF p {n.ml_probability}</div>)) : <Unavailable />}
              <div className="mt-1 text-xs text-stone-500">Historical observations, acquisition date unknown.</div></Row>
            <Row label="Reserve boundary">{ck.reserve_boundary.status === "ok" ? (ck.reserve_boundary.inside ? `Inside${ck.reserve_boundary.name ? ` (${ck.reserve_boundary.name})` : ""}` : "Outside the loaded boundary") : <Unavailable>{ck.reserve_boundary.message}</Unavailable>}</Row>
            <Row label="Hansen tree-cover loss">{ck.tree_cover_loss.status === "ok" ? <>{ck.tree_cover_loss.interpretation}<div className="mt-1 text-xs text-stone-500">Supporting evidence only. It records loss from any cause, once a year.</div></> : <Unavailable>{ck.tree_cover_loss.message}</Unavailable>}</Row>
            <Row label="Weather"><Unavailable>{ck.weather.message}</Unavailable></Row>
            <Row label="Base satellite image"><Unavailable>{ck.base_imagery.message}</Unavailable></Row>
            <Row label="Other reporters">{ck.other_reports_nearby.distinct_other_reporters} other {ck.other_reports_nearby.distinct_other_reporters === 1 ? "person" : "people"} within {ck.other_reports_nearby.radius_m} m in the last {ck.other_reports_nearby.window_hours} h</Row>
            <Row label="Photo metadata">{ck.photo.has_exif ? <>
              {ck.photo.exif_geotag_vs_reported ? `Photo geotag is ${ck.photo.exif_geotag_vs_reported.distance_km} km from the reported spot (${ck.photo.exif_geotag_vs_reported.consistent ? "consistent" : "differs"}).` : "Photo has no GPS tag."}
              {ck.photo.exif_time && ` Camera time ${ck.photo.exif_time}.`}</> : "No metadata in the photo."}
              <div className="mt-1 text-xs text-stone-500">{ck.photo.note}</div></Row>
          </Section>

          <Section title="Officer verification checklist" summary={`${r.checklist.length} steps`} defaultOpen>
            <ul className="space-y-2 text-sm text-stone-300">{r.checklist.map((x) => <li key={x} className="flex gap-2.5"><span className="mt-1 h-3.5 w-3.5 flex-none rounded border border-white/30" />{x}</li>)}</ul>
            <div className="mt-3"><Callout>{r.legality}</Callout></div>
          </Section>

          <Section title="People and places nearby" summary={nb.status === "ok" ? nb.summary_en : "data unavailable"}><Impact n={nb} /></Section>

          <Section title="How the priority was set" summary={r.priority_reasons.reasons.length ? `${r.priority_reasons.reasons.length} reasons` : undefined}>
            <ul className="space-y-1.5 text-sm text-stone-300">{r.priority_reasons.reasons.map((x) => <li key={x}><span className="font-mono text-moss-400">{x.slice(0, 2)}</span>{x.slice(2)}</li>)}</ul>
            {r.priority_reasons.not_triggered.length > 0 && <List title="Not triggered" items={r.priority_reasons.not_triggered} />}
            <p className="mt-3 text-xs text-stone-500">{r.priority_reasons.rule}</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
