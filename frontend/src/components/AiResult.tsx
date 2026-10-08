import { ReactNode } from "react";

const ORDER: [string, string, string][] = [
  ["detected", "A", "What was detected"],
  ["why_flagged", "B", "Why it was flagged"],
  ["supporting_evidence", "C", "Supporting evidence"],
  ["possible_causes", "D", "Possible causes"],
  ["fire_assessment", "E", "Fire-related assessment"],
  ["evidence_for", "E+", "Evidence for a fire-related disturbance"],
  ["evidence_against", "E−", "Evidence against"],
  ["vegetation_assessment", "F", "Vegetation-change assessment"],
  ["environmental_impact", "G", "Environmental impact"],
  ["community_impact", "H", "Potential community impact"],
  ["determinable", "H1", "Exposure determinable from supplied data?"],
  ["data_required", "H2", "Data required"],
  ["risk_assessment", "I", "Risk assessment"],
  ["missing_evidence", "J", "Missing / contradictory evidence"],
  ["recommended_action", "K", "Recommended next action"],
  ["confidence", "L", "Confidence & uncertainty"],
];

const pretty = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Val({ v }: { v: any }): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-stone-500">—</span>;
  if (typeof v === "boolean") return <span>{v ? "Yes" : "No"}</span>;
  if (typeof v === "string" || typeof v === "number") return <p className="leading-relaxed text-stone-200">{String(v)}</p>;
  if (Array.isArray(v)) return (
    <ul className="space-y-2">
      {v.map((x, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-moss-500" />
          <div className="min-w-0 flex-1">{typeof x === "object" && x ? <Obj o={x} /> : <span className="leading-relaxed">{String(x)}</span>}</div>
        </li>
      ))}
    </ul>
  );
  return <Obj o={v} />;
}
function Obj({ o }: { o: Record<string, any> }) {
  return (
    <div className="space-y-1">
      {Object.entries(o).map(([k, x]) => (
        <div key={k} className="text-sm leading-relaxed">
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-moss-400">{pretty(k)} </span>
          {typeof x === "object" && x ? <div className="mt-1 pl-3"><Val v={x} /></div> : <span className="text-stone-200">{typeof x === "boolean" ? (x ? "Yes" : "No") : String(x)}</span>}
        </div>
      ))}
    </div>
  );
}

export default function AiResult({ result }: { result: Record<string, any> }) {
  const known = ORDER.filter(([k]) => k in result);
  const extra = Object.keys(result).filter((k) => !ORDER.some(([o]) => o === k));
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {known.map(([k, tag, title], i) => (
        <div key={k} className={`fade-in rounded-xl border border-white/[0.07] bg-ink-900/60 p-4 ${["why_flagged"].includes(k) ? "" : ""} ${(k === "supporting_evidence" || k === "possible_causes" || k === "detected") ? "md:col-span-2" : ""}`} style={{ animationDelay: `${i * 50}ms` }}>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-5 min-w-5 place-items-center rounded bg-moss-500/15 px-1 font-mono text-[10px] text-moss-400">{tag}</span>
            <span className="label !text-stone-300">{title}</span>
          </div>
          <Val v={result[k]} />
        </div>
      ))}
      {extra.map((k) => (
        <div key={k} className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-4"><div className="label mb-2">{pretty(k)}</div><Val v={result[k]} /></div>
      ))}
    </div>
  );
}
