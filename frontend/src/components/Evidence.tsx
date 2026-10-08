import { useState } from "react";
import type { Evidence, Incident } from "../types";
import { Chip, ProbGauge, Unavailable } from "./ui";

const fmt = (k: string, v: number) => (k === "Rainfall" ? v.toPrecision(4) : k === "Forest" ? String(v) : Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(4));
const KEY = ["NDVI", "NBR", "Fire_Brightness"];

export default function EvidencePanel({ inc, ev }: { inc: Incident; ev: Evidence }) {
  const [all, setAll] = useState(false);
  const ml = inc.ml;
  const rows = ev.signals.filter((s) => all || KEY.includes(s.key));
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-4">
        <div className="flex items-center justify-between"><span className="label">Random Forest probability</span>
          <Chip tone={ml.disturbance_detected ? "bad" : "good"}>{ml.disturbance_detected ? "Detected" : "Not detected"}</Chip></div>
        <div className="mt-2 font-display text-4xl">{ml.probability.toFixed(3)}</div>
        <ProbGauge p={ml.probability} threshold={ml.threshold} />
        <p className="mt-3 text-[11.5px] leading-snug text-amber-200/80">CSV column <span className="font-mono">Disturbance_Probability</span> = {inc.csv_disturbance_probability.toFixed(3)} (unverified, does not match the model; not used).</p>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-4">
        <div className="label mb-3">Evidence</div>
        <div className="space-y-2.5">
          {rows.map((s) => (
            <div key={s.key} className="flex items-baseline justify-between gap-2 border-b border-white/[0.05] pb-2 last:border-0" title={s.unit_note}>
              <span className="text-sm text-stone-300">{s.label}</span>
              <span className="font-mono text-sm text-stone-50">{fmt(s.key, s.value)} <span className="text-[10px] text-stone-500">{["index", "0/1", "unspecified"].includes(s.unit) ? "" : s.unit}</span></span>
            </div>
          ))}
        </div>
        <button onClick={() => setAll(!all)} className="mt-3 text-xs text-moss-400 hover:underline">{all ? "Show key values only" : "Show all 8 values"}</button>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-4">
        <div className="label mb-3">Who contributes what</div>
        <ol className="space-y-2 text-[12.5px] leading-snug">
          <li><span className="font-mono text-moss-400">ML</span> — {inc.ml_assessment}.</li>
          <li><span className="font-mono text-warn">THERMAL</span> — {ev.fire.thermal_signal_present ? `signal present (${ev.fire.fire_brightness_K} K)` : `no signal (${ev.fire.fire_brightness_K} K)`}. Confidence / FRP: <Unavailable />.</li>
          <li><span className="font-mono text-earth-300">GENAI</span> — {ev.fire.label}. <strong>Not confirmed.</strong></li>
        </ol>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-4 text-[12.5px] leading-snug text-stone-300">
        <div className="label mb-2">Community impact</div>{ev.community.status}
      </div>
    </div>
  );
}
