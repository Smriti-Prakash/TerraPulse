import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { Callout, Chip, ErrorBox, Mode, ModeTag, PageHead, Panel, Spinner, useLoad } from "../components/ui";

export interface CAlert { id: number; kind: string; mode: Mode; source_type: string; source_ref: string; lat: number | null; lon: number | null; radius_km: number; place: string;
  title_en: string; title_ta: string; body_en: string; body_ta: string; status: "DRAFT" | "APPROVED" | "REJECTED"; created_by: string; reviewed_by: string | null; review_note: string;
  updated: number; delivery: Record<string, string>; audit: { t: number; by: string; event: string; note: string }[]; created: number }
const KIND: Record<string, string> = { fire_smoke: "Possible fire / smoke", vegetation: "Possible vegetation loss", advisory: "Seasonal advisory" };
const TONE = { DRAFT: "warn", APPROVED: "good", REJECTED: "neutral" } as const;
const AREA = "w-full rounded-xl border border-white/10 bg-ink-900/80 px-3.5 py-2.5 text-sm text-stone-100 outline-none focus:border-moss-500/60 focus:ring-2 focus:ring-moss-500/20";

export async function draftAlert(body: Record<string, unknown>) {
  return (await api.post<{ alert: CAlert }>("/api/community-alerts/draft", body)).alert;
}

export default function Community() {
  const q = useLoad(() => api.get<{ alerts: CAlert[]; channels: Record<string, boolean>; demo_notice: string }>("/api/community-alerts"));
  const [params, setParams] = useSearchParams();
  const [sel, setSel] = useState<number | null>(params.get("open") ? Number(params.get("open")) : null);
  const [f, setF] = useState({ title_en: "", title_ta: "", body_en: "", body_ta: "" });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adv, setAdv] = useState({ kind: "advisory", lat: "", lon: "" });
  const list = q.data?.alerts ?? [];
  const a = list.find((x) => x.id === sel) ?? list.find((x) => x.status === "DRAFT") ?? list[0];
  useEffect(() => { if (a) { setF({ title_en: a.title_en, title_ta: a.title_ta, body_en: a.body_en, body_ta: a.body_ta }); setNote(""); setErr(null); } }, [a?.id, a?.updated]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Spinner />;

  const run = async (kind: string, fn: () => Promise<unknown>) => {
    setBusy(kind); setErr(null);
    try { await fn(); q.reload(); } catch (e) { setErr(e instanceof ApiError || e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  };
  const draft = f.title_en !== a?.title_en || f.body_en !== a?.body_en || f.title_ta !== a?.title_ta || f.body_ta !== a?.body_ta;
  const post = (p: string, b: unknown) => run(p, () => api.post(`/api/community-alerts/${a!.id}/${p}`, b));

  return (
    <div className="space-y-6 fade-in">
      <PageHead modes={["DEMO"]} title="Public alerts" sub="Drafts use fixed English and Tamil wording about possible events. Nothing is sent until you approve it." />
      <Callout>Delivery is a demonstration, not an official warning. Citizens see approved alerts in the app. Telegram: {q.data.channels.telegram ? "on" : "off"}. E-mail: {q.data.channels.email ? "on" : "off"}.</Callout>
      <div className="grid gap-6 grid-cols-[minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel title={`${list.length} alert${list.length === 1 ? "" : "s"}`}>
            {list.length === 0 && <p className="text-sm text-stone-400">No alerts yet. Draft one from a citizen report, an incident, a Replay, or below.</p>}
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">{list.map((x) => (
              <button key={x.id} onClick={() => { setSel(x.id); setParams({}); }} className={`block w-full rounded-xl border p-3 text-left transition ${x.id === a?.id ? "border-moss-500/60 bg-moss-500/10" : "border-white/[0.07] hover:border-white/20"}`}>
                <div className="flex flex-wrap items-center gap-1.5"><Chip tone={TONE[x.status]}>{x.status[0] + x.status.slice(1).toLowerCase()}</Chip><ModeTag mode={x.mode} /><span className="ml-auto font-mono text-xs text-stone-500">#{x.id}</span></div>
                <div className="mt-1.5 text-sm text-stone-200">{KIND[x.kind]} · {x.place}</div>
              </button>))}</div>
          </Panel>
          <Panel title="New draft">
            <select value={adv.kind} onChange={(e) => setAdv({ ...adv, kind: e.target.value })} className={AREA} aria-label="Alert type">{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {adv.kind !== "advisory" && <div className="mt-2 grid grid-cols-2 gap-2"><input className={AREA} placeholder="Latitude" value={adv.lat} onChange={(e) => setAdv({ ...adv, lat: e.target.value })} /><input className={AREA} placeholder="Longitude" value={adv.lon} onChange={(e) => setAdv({ ...adv, lon: e.target.value })} /></div>}
            <button className="btn-ghost mt-3 w-full" disabled={busy === "new"} onClick={() => run("new", async () => { const n = await draftAlert({ kind: adv.kind, source_type: "manual", lat: adv.lat ? Number(adv.lat) : null, lon: adv.lon ? Number(adv.lon) : null }); setSel(n.id); })}>Create draft</button>
          </Panel>
        </div>

        {a ? (
          <Panel kicker={`${KIND[a.kind]} · ${a.place}`} title={`Alert #${a.id}`} right={<div className="flex gap-2"><Chip tone={TONE[a.status]}>{a.status[0] + a.status.slice(1).toLowerCase()}</Chip><ModeTag mode={a.mode} /></div>}>
            {a.mode === "REPLAY" && <div className="mb-4"><Callout>This draft comes from a REPLAY of a past FIRMS event. It exists to demonstrate the workflow.</Callout></div>}
            <div className="grid gap-4 lg:grid-cols-2">
              {(["en", "ta"] as const).map((l) => (
                <div key={l}>
                  <div className="label mb-1.5">{l === "en" ? "English" : "தமிழ் (Tamil)"}</div>
                  <input className={AREA} value={f[`title_${l}`]} disabled={a.status !== "DRAFT"} onChange={(e) => setF({ ...f, [`title_${l}`]: e.target.value })} aria-label={`Title ${l}`} />
                  <textarea className={`${AREA} mt-2`} rows={9} value={f[`body_${l}`]} disabled={a.status !== "DRAFT"} onChange={(e) => setF({ ...f, [`body_${l}`]: e.target.value })} aria-label={`Message ${l}`} />
                </div>))}
            </div>
            {err && <div role="alert" className="mt-3 rounded-xl border border-crit/40 bg-crit/10 px-3.5 py-2 text-sm text-red-200">{err}</div>}
            {a.status === "DRAFT" ? (
              <div className="mt-4 space-y-3">
                <input className={AREA} placeholder="Officer note (kept in the audit trail)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Officer note" />
                <div className="flex flex-wrap gap-2">
                  <button className="btn-ghost" disabled={!draft || !!busy} onClick={() => run("edit", () => api.post(`/api/community-alerts/${a.id}/edit`, f))}>{busy === "edit" ? "Saving…" : "Save edits"}</button>
                  <button className="btn-primary" disabled={draft || !!busy} onClick={() => post("approve", { note })} title={draft ? "Save your edits first" : ""}>{busy === "approve" ? "Sending…" : "Approve and send (DEMO)"}</button>
                  <button className="btn-ghost" disabled={!!busy} onClick={() => post("reject", { note })}>Reject</button>
                </div>
                <p className="text-xs text-stone-500">Approving publishes the alert to citizen accounts and to any configured demo channel. Wording about legality or a confirmed fire is refused.</p>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-white/[0.07] bg-ink-900/60 p-3.5 text-sm">
                <div className="label mb-1.5">Delivery (DEMO)</div>
                {Object.entries(a.delivery).map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-0.5"><span className="capitalize text-stone-400">{k.replace("_", "-")}</span><span className="font-mono text-xs text-stone-200">{v}</span></div>)}
                {a.review_note && <div className="mt-2 text-stone-300">Note: {a.review_note}</div>}
              </div>)}
            <div className="mt-5"><ol className="space-y-1 border-l border-white/10 pl-4 text-[13px]">{a.audit.map((x, i) => <li key={i} className="text-stone-300"><span className="font-mono text-[11px] text-stone-500">{new Date(x.t * 1000).toLocaleString()}</span> · {x.by} · <strong className="font-medium">{x.event}</strong>{x.note && <span className="text-stone-400"> — {x.note}</span>}</li>)}</ol></div>
          </Panel>
        ) : <Panel><p className="text-sm text-stone-400">Select or create an alert.</p></Panel>}
      </div>
    </div>
  );
}
