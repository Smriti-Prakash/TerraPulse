import type { FieldDetail } from "../fieldTypes";

type FD = FieldDetail["checks"]["fire_detections"];
const STYLE = {
  DETECTION_NEARBY: { c: "#f97316", head: "Satellite detection nearby", note: "Supports the report. Does not confirm a fire." },
  INCONCLUSIVE: { c: "#f5b041", head: "Inconclusive. Needs field verification", note: "No detection is NOT the same as no fire." },
  CANNOT_CHECK: { c: "#a8a29e", head: "Cannot be cross-checked", note: "The satellite file does not cover this case." },
} as const;

export default function FireVerdict({ fd }: { fd: FD }) {
  const s = STYLE[fd.verdict] ?? STYLE.CANNOT_CHECK;
  return (
    <div className="rounded-xl border p-3.5" style={{ borderColor: s.c + "66", background: s.c + "0d" }}>
      <div className="flex flex-wrap items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: s.c }} /><span className="font-medium text-stone-100">{s.head}</span><span className="label !text-[10px]">NASA FIRMS cross-check</span></div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-stone-300">{fd.interpretation}</p>
      {fd.status === "ok" && fd.nearest && <p className="mt-1.5 font-mono text-[11px] text-stone-400">Nearest: {fd.nearest.distance_km} km · {fd.nearest.detected_utc} UTC · {fd.nearest.hours_before_report <= 72 ? `${fd.nearest.hours_before_report} h` : `${Math.round(fd.nearest.hours_before_report / 24)} days`} before · confidence {fd.nearest.confidence}</p>}
      {fd.coverage && <p className="mt-1 font-mono text-[11px] text-stone-500">Archive covers {fd.coverage.join(" to ")}. {s.note}</p>}
    </div>
  );
}
