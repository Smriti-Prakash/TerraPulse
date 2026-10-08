import type { Report } from "../types";
import { Chip } from "./ui";

export default function ReportView({ report }: { report: Report }) {
  const b = report.body;
  return (
    <article className="print-area mx-auto max-w-4xl rounded-2xl border border-white/10 bg-ink-800/80 p-8 md:p-12">
      <div className="mb-8 border-b border-white/10 pb-6">
        <div className="label">TerraPulse · Mudumalai Tiger Reserve</div>
        <h1 className="h-display mt-2 text-3xl md:text-4xl">{b.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-400">
          <Chip tone="earth">{b.mode}</Chip>
          <span>Generated {b.generated}</span>
          <Chip tone={b.ai_generated ? "good" : "warn"}>{b.ai_generated ? `AI narrative: ${b.ai_model}` : "AI investigation not yet run"}</Chip>
        </div>
      </div>
      {b.sections.map((s) => (
        <section key={s.n} className="mb-7 break-inside-avoid">
          <h2 className="h-display flex items-baseline gap-3 text-xl"><span className="font-mono text-sm text-moss-400">{String(s.n).padStart(2, "0")}</span>{s.title}
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-stone-500">{s.kind === "ai" ? "GenAI, grounded" : "from data / model"}</span></h2>
          <p className="mt-2 whitespace-pre-line leading-relaxed text-stone-300">{s.body}</p>
          {s.table && (
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left font-mono text-[10.5px] uppercase tracking-wider text-stone-500"><th className="py-1">Feature</th><th>Value</th><th>Unit</th></tr></thead>
              <tbody>{s.table.map((r) => <tr key={r.name} className="border-t border-white/[0.06]"><td className="py-1.5">{r.name}</td><td className="font-mono">{r.value}</td><td className="text-stone-500">{r.unit}</td></tr>)}</tbody>
            </table>
          )}
          {s.gaps && <ul className="mt-2 list-disc pl-5 text-sm text-stone-400">{s.gaps.map((g) => <li key={g}>{g}</li>)}</ul>}
          {s.note && <p className="mt-2 border-l-2 border-earth-400/60 pl-3 text-sm text-earth-300">{s.note}</p>}
        </section>
      ))}
      <section className="mt-8 border-t border-white/10 pt-5"><h2 className="h-display text-xl">Confidence & uncertainty</h2><p className="mt-2 whitespace-pre-line text-stone-300">{b.confidence}</p></section>
    </article>
  );
}
