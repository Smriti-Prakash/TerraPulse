import { ReactNode, useEffect, useState } from "react";
import type { Level } from "../types";
import { ApiError } from "../api";

export const LEVEL_COLOR: Record<Level, string> = { LOW: "#6fcf97", MODERATE: "#f5b041", HIGH: "#f97316", CRITICAL: "#ef4444" };

export function Panel({ title, kicker, right, children, className = "" }: { title?: ReactNode; kicker?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`glass p-5 ${className}`}>
      {(title || kicker) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {kicker && <div className="label mb-1">{kicker}</div>}
            {title && <h3 className="h-display text-xl">{title}</h3>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function RiskBadge({ level, size = "md" }: { level: Level; size?: "sm" | "md" }) {
  const c = LEVEL_COLOR[level];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-mono uppercase tracking-wider ${size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs"}`}
      style={{ color: c, borderColor: c + "55", background: c + "14" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />{level}
    </span>
  );
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "good" | "bad" | "earth" }) {
  const t = { neutral: "border-white/10 text-stone-300", warn: "border-warn/40 text-warn bg-warn/10", good: "border-moss-500/40 text-moss-400 bg-moss-500/10", bad: "border-crit/40 text-crit bg-crit/10", earth: "border-earth-400/40 text-earth-300 bg-earth-400/10" }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider ${t}`}>{children}</span>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="glass p-4">
      <div className="label">{label}</div>
      <div className="mt-2 font-display text-4xl leading-none" style={{ color: tone }}>{value}</div>
      {sub && <div className="mt-2 text-xs leading-snug text-stone-400">{sub}</div>}
    </div>
  );
}

export function Unavailable({ children = "Data unavailable in current prototype" }: { children?: ReactNode }) {
  return <span className="rounded-md border border-dashed border-white/15 px-2 py-0.5 font-mono text-[11px] text-stone-500">{children}</span>;
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
      <div className="text-red-200/80">{msg}</div>
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
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-moss-600 to-moss-400" style={{ width: `${Math.min(100, p * 100)}%` }} />
        <div className="absolute -top-1 h-4.5 w-0.5 bg-warn" style={{ left: `${threshold * 100}%`, height: 18 }} title={`Decision threshold ${threshold}`} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-stone-500"><span>0</span><span className="text-warn">threshold {threshold}</span><span>1</span></div>
      {label && <div className="mt-1 text-xs text-stone-400">{label}</div>}
    </div>
  );
}
