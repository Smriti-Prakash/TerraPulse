import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import PinPicker, { Pin } from "../components/PinPicker";
import { Panel, Spinner, ErrorBox, useLoad } from "../components/ui";
import { Bbox, Category, CitizenReport } from "../fieldTypes";
import { useLang } from "../i18n";

const CATS: Category[] = ["fire", "deforestation", "other"];
const MAX_MB = 10;

export default function CitizenReportForm() {
  const { t } = useLang();
  const region = useLoad(() => api.get<{ bbox: Bbox; study_area: string }>("/api/citizen/region"));
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>("fire");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState<Pin | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [flyKey, setFlyKey] = useState(0);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CitizenReport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (region.error) return <ErrorBox error={region.error} onRetry={region.reload} />;
  if (!region.data) return <Spinner />;
  const bbox = region.data.bbox;

  function chooseFile(f: File | null) {
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    if (f && f.size > MAX_MB * 1024 * 1024) { setPhoto(null); setPreview(null); setError(`That photo is larger than ${MAX_MB} MB. Lower the camera resolution and try again.`); return; }
    setPhoto(f); setPreview(f ? URL.createObjectURL(f) : null);
  }

  function useMyLocation() {
    setLocMsg(null);
    if (!navigator.geolocation) { setLocMsg("This browser cannot share your location. Tap the map instead."); return; }
    setLocMsg("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const { latitude: lat, longitude: lon, accuracy: acc } = p.coords;
        if (lat < bbox.south || lat > bbox.north || lon < bbox.west || lon > bbox.east) { setLocMsg(`Your location is outside the area TerraPulse covers (${region.data!.study_area}). Tap the map to place the pin where the incident is.`); return; }
        setPin({ lat, lon }); setAccuracy(acc); setFlyKey((k) => k + 1); setLocMsg(`Location found (accurate to about ${Math.round(acc)} m).`);
      },
      () => setLocMsg("Could not get your location. Allow location access, or tap the map instead."),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!photo || !pin || busy) return;
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.append("photo", photo); fd.append("category", category); fd.append("note", note);
    fd.append("lat", String(pin.lat)); fd.append("lon", String(pin.lon));
    if (accuracy != null) fd.append("accuracy_m", String(accuracy));
    fd.append("client_time", new Date().toISOString());
    try {
      const r = await api.postForm<{ report: CitizenReport }>("/api/citizen/reports", fd);
      setDone(r.report);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Could not send the report");
    } finally { setBusy(false); }
  }

  function reset() { setDone(null); setPhoto(null); setPreview(null); setNote(""); setPin(null); setAccuracy(null); setLocMsg(null); if (fileRef.current) fileRef.current.value = ""; }

  if (done) {
    return (
      <div className="fade-in space-y-5">
        <Panel>
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-moss-500 text-ink-950">✓</div>
            <div>
              <h1 className="h-display text-2xl">{t("received")} #{done.id}</h1>
              <p className="mt-1.5 text-sm text-stone-300">{t("receivedText")}</p>
              <p className="mt-3 text-sm text-stone-400">{t("receivedWarn")}</p>
              <div className="mt-5 flex gap-3"><Link to="/mine" className="btn-primary">{t("viewMine")}</Link><button onClick={reset} className="btn-ghost">{t("another")}</button></div>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  const ready = !!photo && !!pin;
  return (
    <form onSubmit={submit} className="fade-in space-y-5" noValidate>
      <div><h1 className="h-display text-2xl sm:text-3xl">{t("formTitle")}</h1></div>

      <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-amber-100">
        <strong className="font-medium">{t("stay")}</strong> {t("stayText")} <Link to="/safety" className="underline">{t("safety")}</Link>
      </div>

      <Panel title={t("step1")}>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-stone-300 file:mr-4 file:rounded-xl file:border-0 file:bg-moss-500 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-ink-950 hover:file:bg-moss-400" aria-label="Photo" />
        <p className="mt-2 text-xs text-stone-500">{t("photoHelp")}</p>
        {preview && <img src={preview} alt="Selected photo" className="mt-4 max-h-72 rounded-xl border border-white/10 object-contain" />}
      </Panel>

      <Panel title={t("step2")}>
        <div className="flex flex-wrap gap-2">
          {CATS.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={category === c}
              className={`rounded-xl border px-4 py-2.5 text-sm transition ${category === c ? "border-moss-500 bg-moss-500 text-ink-950" : "border-white/10 text-stone-300 hover:bg-white/[0.06]"}`}>{t(c)}</button>
          ))}
        </div>
      </Panel>

      <Panel title={t("step3")}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={useMyLocation} className="btn-ghost">{t("useLoc")}</button>
          <span className="text-xs text-stone-400">{t("tapMap")}</span>
        </div>
        <PinPicker bbox={bbox} pin={pin} flyKey={flyKey} onPick={(lat, lon) => { setPin({ lat, lon }); setAccuracy(null); setLocMsg(null); }} />
        <div className="mt-3 text-sm">
          {pin ? <span className="font-mono text-stone-200">{pin.lat.toFixed(5)}, {pin.lon.toFixed(5)}</span> : <span className="text-stone-500">{t("noLoc")}</span>}
          {locMsg && <div className="mt-1 text-xs text-stone-400" role="status">{locMsg}</div>}
        </div>
      </Panel>

      <Panel title={t("step4")}>
        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={3} placeholder={t("noteHolder")}
          className="w-full rounded-xl border border-white/10 bg-ink-900/80 px-3.5 py-2.5 text-sm text-stone-100 outline-none transition placeholder:text-stone-600 focus:border-moss-500/60 focus:ring-2 focus:ring-moss-500/20" />
        <div className="mt-1 text-right font-mono text-[10.5px] text-stone-500">{note.length}/1000</div>
      </Panel>

      {error && <div role="alert" className="rounded-xl border border-crit/40 bg-crit/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="flex items-center gap-4">
        <button type="submit" disabled={!ready || busy} className="btn-primary">
          {busy ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />{t("sending")}</> : t("send")}
        </button>
        {!ready && <span className="text-xs text-stone-500">{t("needBoth")}</span>}
      </div>
      <p className="text-xs text-stone-500">{t("privacy")}</p>
    </form>
  );
}
