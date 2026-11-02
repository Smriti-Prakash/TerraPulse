import { ReactNode, useState } from "react";
import { Section } from "./ui";

const LABEL: Record<string, string> = {
  detected: "What was detected", why_flagged: "Why it was flagged", supporting_evidence: "Supporting evidence", possible_causes: "Possible causes (hypotheses only)",
  fire_assessment: "Fire-related assessment", evidence_for: "Evidence for a fire-related disturbance", evidence_against: "Evidence against",
  vegetation_assessment: "Vegetation-change assessment", environmental_impact: "Environmental impact", community_impact: "Potential community impact",
  determinable: "Can exposure be worked out from the supplied data?", data_required: "Data that would be needed", risk_assessment: "Risk assessment",
  missing_evidence: "Missing or contradictory evidence", verification_checklist: "Officer verification checklist", recommended_action: "Recommended next action", comparison_with_other_incidents: "Comparison with other recorded incidents", confidence: "Confidence and uncertainty",
};
const GROUPS: { title: string; keys: string[]; open: boolean }[] = [
  { title: "Why it was flagged", keys: ["why_flagged"], open: true },
  { title: "Exact values behind it", keys: ["supporting_evidence"], open: false },
  { title: "Fire-related assessment", keys: ["fire_assessment", "evidence_for", "evidence_against"], open: true },
  { title: "Gaps and what to check next", keys: ["missing_evidence", "verification_checklist"], open: true },
  { title: "Comparison with other incidents", keys: ["comparison_with_other_incidents"], open: false },
  { title: "Possible causes and vegetation", keys: ["possible_causes", "vegetation_assessment"], open: false },
  { title: "Impact on environment and community", keys: ["environmental_impact", "community_impact", "determinable", "data_required"], open: false },
];
const HEADLINE = ["detected", "risk_assessment", "recommended_action", "confidence"];
const pretty = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const isObj = (x: any) => x && typeof x === "object" && !Array.isArray(x);

function Table({ rows }: { rows: Record<string, any>[] }) {
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.07]">
      <table className="w-full min-w-[420px] text-sm">
        <thead><tr className="bg-white/[0.04] text-left text-xs text-stone-400">{cols.map((c) => <th key={c} className="px-3 py-2 font-medium">{pretty(c)}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-white/[0.06] align-top">{cols.map((c, j) => <td key={c} className={`px-3 py-2 ${j === 0 ? "font-medium text-stone-100" : "text-stone-300"}`}>{String(r[c] ?? "")}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Val({ v, check }: { v: any; check?: boolean }): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-stone-500">Nothing listed</span>;
  if (typeof v === "boolean") return <span>{v ? "Yes" : "No"}</span>;
  if (typeof v === "string" || typeof v === "number") return <p className="leading-relaxed text-stone-200">{String(v)}</p>;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="text-stone-500">Nothing listed</span>;
    if (v.every(isObj) && Object.keys(v[0]).length >= 2 && v.every((x) => Object.keys(x).length === Object.keys(v[0]).length)) return <Table rows={v} />;
    return (
      <ul className="space-y-1.5">
        {v.map((x, i) => (
          <li key={i} className="flex gap-2.5">
            {check ? <span className="mt-1 h-3.5 w-3.5 flex-none rounded border border-white/30" /> : <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-moss-500" />}
            <div className="min-w-0 flex-1 leading-relaxed text-stone-200">{isObj(x) ? <Obj o={x} /> : String(x)}</div>
          </li>
        ))}
      </ul>
    );
  }
  return <Obj o={v} />;
}
function Obj({ o }: { o: Record<string, any> }) {
  return (
    <dl className="space-y-1">
      {Object.entries(o).map(([k, x]) => (
        <div key={k} className="text-sm leading-relaxed"><dt className="inline text-stone-400">{pretty(k)}: </dt><dd className="inline text-stone-200">{isObj(x) || Array.isArray(x) ? <div className="mt-1 pl-3"><Val v={x} /></div> : typeof x === "boolean" ? (x ? "Yes" : "No") : String(x)}</dd></div>
      ))}
    </dl>
  );
}

// The officer needs the top few gaps. The rest, and notes about the evidence file's own probability column (already shown beside the evidence values), stay behind "Show all".
const TECHNICAL = /pipeline probability|Disturbance_Probability|csv.*probabilit|contradiction between the random forest/i;
function Gaps({ items }: { items: string[] }) {
  const [all, setAll] = useState(false);
  const main = items.filter((x) => !TECHNICAL.test(String(x))), shown = all ? main : main.slice(0, 3);
  return (
    <div>
      <Val v={shown} />
      {main.length > 3 && <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 text-sm text-moss-400 underline-offset-2 hover:underline">{all ? "Show fewer" : `Show all ${main.length}`}</button>}
    </div>
  );
}

const Block = ({ k, v, hideLabel }: { k: string; v: any; hideLabel?: boolean }) => (
  <div className="min-w-0">{!hideLabel && <div className="mb-1.5 text-xs font-medium text-stone-400">{LABEL[k] ?? pretty(k)}</div>}{k === "missing_evidence" && Array.isArray(v) && v.every((x) => typeof x === "string") ? <Gaps items={v} /> : <Val v={v} check={k === "verification_checklist"} />}</div>
);

/** The AI investigation, laid out for quick reading: headline first, then grouped detail the officer can open. */
export default function AiResult({ result }: { result: Record<string, any> }) {
  const used = new Set<string>(HEADLINE);
  const head = HEADLINE.filter((k) => k in result);
  const groups = GROUPS.map((g) => ({ ...g, present: g.keys.filter((k) => k in result) })).filter((g) => g.present.length);
  groups.forEach((g) => g.present.forEach((k) => used.add(k)));
  const extra = Object.keys(result).filter((k) => !used.has(k));
  return (
    <div className="space-y-4">
      {head.length > 0 && (
        <div className="space-y-4 rounded-xl border border-white/10 bg-ink-900/60 p-5">
          {"detected" in result && <div><div className="mb-1 text-xs font-medium text-stone-400">{LABEL.detected}</div><p className="text-base font-medium leading-relaxed text-stone-50">{String(result.detected)}</p></div>}
          {"recommended_action" in result && (
            <div className="min-w-0 rounded-lg border border-moss-500/30 bg-moss-500/[0.07] p-4"><div className="mb-1 text-xs font-medium text-moss-400">{LABEL.recommended_action}</div><div className="text-[15px] leading-relaxed"><Val v={result.recommended_action} /></div></div>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 text-[15px] md:grid-cols-2">
            {"risk_assessment" in result && <Block k="risk_assessment" v={result.risk_assessment} />}
            {"confidence" in result && <Block k="confidence" v={result.confidence} />}
          </div>
        </div>
      )}
      {groups.map((g) => (
        <Section key={g.title} title={g.title} defaultOpen={g.open}>
          <div className={`grid grid-cols-[minmax(0,1fr)] gap-5 ${g.present.includes("evidence_for") ? "md:grid-cols-2" : ""}`}>
            {g.present.map((k) => <div key={k} className={`min-w-0 ${["fire_assessment", "supporting_evidence", "why_flagged"].includes(k) ? "md:col-span-2" : ""}`}><Block k={k} v={result[k]} hideLabel={LABEL[k] === g.title} /></div>)}
          </div>
        </Section>
      ))}
      {extra.length > 0 && <Section title="Other details"><div className="space-y-4">{extra.map((k) => <Block key={k} k={k} v={result[k]} />)}</div></Section>}
    </div>
  );
}
