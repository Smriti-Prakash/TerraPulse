import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Chip, ErrorBox, RiskBadge, Spinner, useLoad } from "../components/ui";
import type { Incident } from "../types";

const FILTERS: [string, (i: Incident) => boolean][] = [
  ["All", () => true],
  ["Low", (i) => i.risk.level === "LOW"], ["Moderate", (i) => i.risk.level === "MODERATE"], ["High", (i) => i.risk.level === "HIGH"], ["Critical", (i) => i.risk.level === "CRITICAL"],
  ["Fire-related evidence", (i) => i.tags.includes("fire-related evidence")], ["Vegetation change", (i) => i.tags.includes("vegetation change")],
  ["Under investigation", (i) => i.status === "UNDER INVESTIGATION"], ["Reviewed", (i) => i.status === "REVIEWED"],
];

export default function Incidents() {
  const { data, error, reload } = useLoad(() => api.get<{ incidents: Incident[] }>("/api/incidents"));
  const [f, setF] = useState("All");
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const fn = FILTERS.find(([n]) => n === f)![1];
  const list = data.incidents.filter(fn);
  return (
    <div className="space-y-5 fade-in">
      <div><div className="label mb-2">Incidents</div><h1 className="h-display text-4xl">Investigation cases</h1>
        <p className="mt-2 max-w-3xl text-stone-400">One case per record that triggers a rule. Click a case to investigate it.</p></div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([n, fx]) => {
          const c = data.incidents.filter(fx).length;
          return <button key={n} onClick={() => setF(n)} className={`rounded-full border px-3.5 py-1.5 text-sm transition ${f === n ? "border-moss-500 bg-moss-500/15 text-moss-400" : "border-white/10 text-stone-400 hover:text-stone-100"}`}>{n} <span className="ml-1 font-mono text-[11px] opacity-70">{c}</span></button>;
        })}
      </div>
      {list.length === 0 && <div className="glass p-8 text-stone-400">No incidents match this filter in the current dataset.</div>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((i) => (
          <Link key={i.id} to={`/incidents/${i.id}`} className="glass block p-4 transition hover:border-moss-500/40">
            <div className="flex items-center justify-between"><span className="font-mono text-lg text-stone-50">{i.id}</span><RiskBadge level={i.risk.level} /></div>
            <div className="mt-1.5 text-[15px] text-stone-200">{i.title}</div>
            <div className="mt-1 text-xs text-stone-500">{i.location} · {i.cluster}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[["RF prob.", i.ml.probability.toFixed(3)], ["Fire br. K", i.features.Fire_Brightness.toString()], ["NDVI", i.features.NDVI.toFixed(3)]].map(([l, v]) => <div key={l} className="rounded-lg bg-ink-900/70 py-2"><div className="label !text-[9px]">{l}</div><div className="font-mono text-sm">{v}</div></div>)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Chip tone={i.status === "NEW" ? "neutral" : i.status === "REVIEWED" ? "good" : "warn"}>{i.status}</Chip>
              {i.tags.map((t) => <Chip key={t} tone="earth">{t}</Chip>)}{i.ai_investigated && <Chip tone="good">AI report</Chip>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
