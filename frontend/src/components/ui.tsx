import { ReactNode, useEffect, useState } from "react";
import type { Level } from "../types";
import { ApiError } from "../api";

export const LEVEL_COLOR: Record<Level, string> = { LOW: "#6fcf97", MODERATE: "#f5b041", HIGH: "#fb923c", CRITICAL: "#f87171" };

export function Panel({ title, kicker, right, children, className = "" }: { title?: ReactNode; kicker?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`glass p-5 ${className}`}>
      {(title || right) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-base font-semibold text-stone-50">{title}</h3>}
            {kicker && <div className="mt-0.5 text-xs text-stone-400">{kicker}</div>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

const LEVEL_TEXT: Record<Level, string> = { LOW: "Low", MODERATE: "Moderate", HIGH: "High", CRITICAL: "Critical" };
export function RiskBadge({ level, size = "md" }: { level: Level; size?: "sm" | "md" }) {
  const c = LEVEL_COLOR[level];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md font-medium ${size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2.5 py-1 text-sm"}`} style={{ color: c, background: c + "22" }}>
      <span className="h-2 w-2 rounded-full" style={{ background: c }} />{LEVEL_TEXT[level]}
    </span>
  );
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "good" | "bad" | "earth" }) {
  const t = { neutral: "bg-white/[0.05] text-stone-300", warn: "bg-warn/10 text-warn", good: "bg-moss-500/10 text-moss-400", bad: "bg-crit/10 text-crit", earth: "bg-white/[0.05] text-stone-400" }[tone];
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="glass p-4">
      <div className="text-sm text-stone-400">{label}</div>
      <div className="mt-1 text-3xl font-semibold leading-none" style={{ color: tone }}>{value}</div>
      {sub && <div className="mt-2 text-xs leading-snug text-stone-400">{sub}</div>}
    </div>
  );
}

export function Unavailable({ children = "Data unavailable in current prototype" }: { children?: ReactNode }) {
  return <span className="rounded-md bg-white/[0.05] px-2 py-0.5 text-xs text-stone-400">{children}</span>;
}

export function Spinner({ text = "Loading…" }: { text?: string }) {
  return <div className="flex items-center gap-3 p-8 text-stone-400"><span className="h-4 w-4 animate-spin rounded-full border-2 border-moss-500 border-t-transparent" />{text}</div>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError || error instanceof Error ? error.message : String(error);
  const down = error instanceof ApiError && error.status === 0;
  return (
    <div className="rounded-xl border border-crit/40 bg-crit/10 p-4 text-sm text-red-200">
      <div className="mb-1 font-medium">{down ? "Backend unavailable" : "Something went wrong"}</div>
      <div className="text-red-200">{msg}</div>
      {onRetry && <button onClick={onRetry} className="btn-ghost mt-3 !py-1.5 text-xs">Retry</button>}
    </div>
  );
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then((d) => { if (alive) { setData(d); setError(null); } }).catch((e) => alive && setError(e)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

export function ModeBadge() {
  return <Chip tone="earth">Historical data demonstration · not a live feed</Chip>;
}

export function ProbGauge({ p, threshold, label }: { p: number; threshold: number; label?: string }) {
  return (
    <div>
      <div className="relative h-2.5 rounded-full bg-white/10">
        <div className="absolute inset-y-0 left-0 rounded-full bg-moss-500" style={{ width: `${Math.min(100, p * 100)}%` }} />
        <div className="absolute -top-1 h-4.5 w-0.5 bg-warn" style={{ left: `${threshold * 100}%`, height: 18 }} title={`Decision threshold ${threshold}`} />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-stone-500"><span>0</span><span className="text-warn">threshold {threshold}</span><span>1</span></div>
      {label && <div className="mt-1 text-xs text-stone-400">{label}</div>}
    </div>
  );
}

export type Mode = "LIVE" | "HISTORICAL" | "REPLAY" | "SIMULATION" | "DEMO";
const MODE: Record<Mode, { text: string; c: string; loud: boolean; t: string }> = {
  LIVE: { text: "Live report", c: "#34d399", loud: false, t: "A real submission made by a signed-in person" },
  HISTORICAL: { text: "Past data", c: "#a8a29e", loud: false, t: "Real recorded data from the past. Not a live feed" },
  REPLAY: { text: "Replay", c: "#7cb7ff", loud: true, t: "A real past event replayed as a test. Nothing is live" },
  SIMULATION: { text: "Simulation", c: "#c4a1ff", loud: true, t: "Invented illustrative values, not measurements" },
  DEMO: { text: "Demo", c: "#f5b041", loud: true, t: "Demonstration only. Not an official action" },
};
/** Says what kind of data a screen shows. Quiet for real data, a coloured pill when the data is a replay, simulation or demo. */
export function ModeTag({ mode, children }: { mode: Mode; children?: ReactNode }) {
  const m = MODE[mode];
  if (!m.loud) return <span title={m.t} className="inline-flex items-center gap-1.5 text-xs text-stone-400"><span className="h-1.5 w-1.5 rounded-full" style={{ background: m.c }} />{m.text}{children && <> · {children}</>}</span>;
  return <span title={m.t} className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold" style={{ color: m.c, background: m.c + "22" }}>{m.text}{children && <span className="font-normal"> · {children}</span>}</span>;
}

export function PageHead({ title, sub, right, modes }: { kicker?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode; modes?: Mode[] }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-50">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-sm text-stone-400">{sub}</p>}
        {modes && <div className="mt-2 flex gap-3">{modes.map((m) => <ModeTag key={m} mode={m} />)}</div>}
      </div>
      {right}
    </div>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad"; title?: ReactNode; children: ReactNode }) {
  const t = { info: "border-white/10 bg-white/[0.05] text-stone-300", warn: "border-warn/30 bg-warn/[0.07] text-amber-100", bad: "border-crit/30 bg-crit/[0.06] text-red-200" }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${t}`}>{title && <div className="mb-0.5 font-semibold">{title}</div>}{children}</div>;
}

/** Shown wherever a layer file has not been supplied yet. Never a made-up number. */
export function Missing({ what, how }: { what: string; how?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/20 bg-ink-800 p-6">
      <div className="font-medium text-stone-100">{what}</div>
      <div className="mt-1 text-sm text-stone-400">Data unavailable in current prototype.</div>
      {how && <p className="mt-3 max-w-xl text-sm text-stone-400">{how}</p>}
    </div>
  );
}

export function Bars({ labels, values, highlight = [], height = 140, color = "#6fcf97" }: { labels: string[]; values: number[]; highlight?: number[]; height?: number; color?: string }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-1.5" style={{ height: height + 34 }} role="img" aria-label="Bar chart">
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[10px] text-stone-400">{v || ""}</span>
          <div className="w-full rounded-t" style={{ height: Math.max(2, (v / max) * height), background: highlight.includes(i) ? "#f5b041" : color, opacity: v ? 1 : 0.25 }} />
          <span className="text-[10px] text-stone-500">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

/** Small SVG line chart: one or two series over years. Gaps (null) are skipped. */
export function Lines({ years, series, flagYears = [], height = 170 }: { years: number[]; series: { name: string; color: string; values: (number | null)[] }[]; flagYears?: number[]; height?: number }) {
  const W = 520, H = height, pad = { l: 34, r: 10, t: 10, b: 24 };
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (!all.length) return null;
  const lo = Math.min(...all, 0), hi = Math.max(...all, 0.1);
  const x = (i: number) => pad.l + (years.length === 1 ? 0 : (i / (years.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Line chart by year">
      {[lo, (lo + hi) / 2, hi].map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.1)" /><text x={4} y={y(t) + 3} fontSize="9" fill="#a8a29e" fontFamily="monospace">{t.toFixed(2)}</text></g>)}
      {years.map((yr, i) => <g key={yr}>{flagYears.includes(yr) && <rect x={x(i) - 14} y={pad.t} width={28} height={H - pad.t - pad.b} fill="#f5b041" opacity={0.12} />}<text x={x(i)} y={H - 6} fontSize="10" fill="#a8a29e" textAnchor="middle" fontFamily="monospace">{yr}</text></g>)}
      {series.map((s) => {
        const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)] as [number, number]));
        const d = pts.filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p![0]},${p![1]}`).join(" ");
        return <g key={s.name}><path d={d} fill="none" stroke={s.color} strokeWidth={2} />{pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={3.2} fill={s.color} />)}</g>;
      })}
    </svg>
  );
}

/** Collapsible block. Everything opens when the page is printed. */
export function Section({ title, summary, defaultOpen = false, right, children, className = "" }: { title: ReactNode; summary?: ReactNode; defaultOpen?: boolean; right?: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const on = () => setOpen(true), off = () => setOpen(defaultOpen);
    window.addEventListener("beforeprint", on); window.addEventListener("afterprint", off);
    return () => { window.removeEventListener("beforeprint", on); window.removeEventListener("afterprint", off); };
  }, [defaultOpen]);
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className={`glass group min-w-0 ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-5 py-3.5 hover:bg-white/[0.03] [&::-webkit-details-marker]:hidden">
        <svg width="14" height="14" viewBox="0 0 14 14" className="flex-none text-stone-400 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 2l5 5-5 5" /></svg>
        <h3 className="text-base font-semibold text-stone-50">{title}</h3>
        {summary && <span className="min-w-0 truncate text-sm text-stone-400">{summary}</span>}
        {right && <span className="ml-auto flex-none" onClick={(e) => e.stopPropagation()}>{right}</span>}
      </summary>
      <div className="min-w-0 border-t border-white/[0.07] px-5 py-4">{children}</div>
    </details>
  );
}

/** A big number with a small label. Used in the summary strips. */
export function Kpi({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-stone-400">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold leading-tight" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-stone-400">{sub}</div>}
    </div>
  );
}
