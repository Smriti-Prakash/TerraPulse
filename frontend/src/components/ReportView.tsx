import type { Report } from "../types";
import { Chip, Section } from "./ui";

function Summary({ report }: { report: Report }) {
  const b = report.body;
  return (
    <article className="print-area mx-auto max-w-3xl space-y-8">
      <header className="space-y-4">
        <div className="text-sm text-stone-400">TerraPulse · Mudumalai Tiger Reserve</div>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight">{b.title}</h1>
        <p className="text-xl leading-snug text-stone-100">{b.headline}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
          <Chip tone="earth">{b.mode}</Chip><span>Generated {b.generated}</span>
          <Chip tone={b.ai_generated ? "good" : "warn"}>{b.ai_generated ? `AI wording: ${b.ai_model}` : "AI investigation not yet run"}</Chip>
        </div>
        <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-2 rounded-xl border border-white/10 bg-ink-900/60 p-4 text-sm sm:grid-cols-2">
          {b.at_a_glance?.map((g) => <div key={g.label} className="min-w-0"><dt className="text-xs text-stone-400">{g.label}</dt><dd className="text-stone-100">{g.value}</dd></div>)}
        </dl>
      </header>
      {b.summary?.map((s) => (
        <section key={s.key} className="break-inside-avoid">
          <h2 className="text-xl font-semibold text-stone-50">{s.title}</h2>
          <div className="mt-2 space-y-3 text-base leading-relaxed text-stone-200">
            {s.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
            {s.bullets.length > 0 && <ul className="space-y-2">{s.bullets.map((x, i) => <li key={i} className="flex gap-2.5"><span className="mt-2.5 h-1.5 w-1.5 flex-none rounded-full bg-moss-500" /><span className="min-w-0">{x}</span></li>)}</ul>}
            {s.numbered.length > 0 && <ol className="space-y-2.5">{s.numbered.map((x, i) => <li key={i} className="flex gap-3"><span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-moss-500/15 text-sm font-medium text-moss-400">{i + 1}</span><span className="min-w-0">{x}</span></li>)}</ol>}
            {s.note && <p className="border-l-2 border-earth-400/60 pl-3 text-sm text-stone-400">{s.note}</p>}
          </div>
        </section>
      ))}
      <p className="rounded-xl border border-warn/40 bg-warn/[0.08] p-4 text-sm leading-relaxed text-stone-100">{b.not_say}</p>
      <section className="space-y-3 pt-2">
        <h2 className="text-xl font-semibold text-stone-50">Technical appendix</h2>
        <p className="no-print text-sm text-stone-400">Detailed values and the raw evidence. Open a block to read it. Everything opens when the report is printed.</p>
        {b.appendix?.map((a) => (
          <Section key={a.title} title={a.title}>
            <div className="space-y-3 text-sm leading-relaxed text-stone-300">
              {a.paragraphs?.map((p, i) => <p key={i}>{p}</p>)}
              {a.bullets && a.bullets.length > 0 && <ul className="list-disc space-y-1 pl-5">{a.bullets.map((x) => <li key={x}>{x}</li>)}</ul>}
              {a.table && <div className="overflow-x-auto rounded-lg border border-white/[0.07]"><table className="w-full min-w-[360px] text-sm"><thead><tr className="bg-white/[0.04] text-left text-xs text-stone-400">{a.table.cols.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr></thead><tbody>{a.table.rows.map((r, i) => <tr key={i} className="border-t border-white/[0.06]">{r.map((c, j) => <td key={j} className={`px-3 py-2 ${j ? "font-mono" : ""}`}>{c}</td>)}</tr>)}</tbody></table></div>}
              {a.qa?.map((q) => <div key={q.title}><div className="text-xs font-medium text-stone-400">{q.title}</div><p>{q.body}</p></div>)}
            </div>
          </Section>
        ))}
      </section>
    </article>
  );
}

export default function ReportView({ report }: { report: Report }) {
  const b = report.body;
  if (b.version === 2) return <Summary report={report} />;
  return (
    <article className="print-area max-w-5xl rounded-2xl border border-white/10 bg-ink-800 p-5 sm:p-8 lg:p-10">
      <div className="mb-8 border-b border-white/10 pb-6">
        <div className="label">TerraPulse · Mudumalai Tiger Reserve</div>
        <h1 className="h-display mt-2 text-2xl md:text-3xl">{b.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-400">
          <Chip tone="earth">{b.mode}</Chip>
          <span>Generated {b.generated}</span>
          <Chip tone={b.ai_generated ? "good" : "warn"}>{b.ai_generated ? `AI narrative: ${b.ai_model}` : "AI investigation not yet run"}</Chip>
        </div>
      </div>
      {b.sections.map((s) => (
        <section key={s.n} className="mb-7 break-inside-avoid">
          <h2 className="h-display flex items-baseline gap-3 text-xl"><span className="font-mono text-sm text-moss-400">{s.n}</span>{s.title}
            <span className="ml-auto text-xs font-normal text-stone-500">{s.kind === "ai" ? "AI-written, from the evidence" : "From the data and model"}</span></h2>
          <p className="mt-2 whitespace-pre-line leading-relaxed text-stone-300">{s.body}</p>
          {s.table && (
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[360px] text-sm">
              <thead><tr className="text-left font-mono text-[10.5px] text-stone-500"><th className="py-1">Feature</th><th>Value</th><th>Unit</th></tr></thead>
              <tbody>{s.table.map((r) => <tr key={r.name} className="border-t border-white/[0.06]"><td className="py-1.5">{r.name}</td><td className="font-mono">{r.value}</td><td className="text-stone-500">{r.unit}</td></tr>)}</tbody>
            </table></div>
          )}
          {s.gaps && <ul className="mt-2 list-disc pl-5 text-sm text-stone-400">{s.gaps.map((g) => <li key={g}>{g}</li>)}</ul>}
          {s.note && <p className="mt-2 border-l-2 border-earth-400/60 pl-3 text-sm text-earth-300">{s.note}</p>}
        </section>
      ))}
      <section className="mt-8 border-t border-white/10 pt-5"><h2 className="h-display text-xl">Confidence & uncertainty</h2><p className="mt-2 whitespace-pre-line text-stone-300">{b.confidence}</p></section>
    </article>
  );
}
