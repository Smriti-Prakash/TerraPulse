import { api } from "../api";
import { Callout, Chip, ErrorBox, ModeTag, Panel, Spinner, useLoad } from "../components/ui";
import { useLang } from "../i18n";

interface A { id: number; kind: string; mode: "LIVE" | "HISTORICAL" | "REPLAY"; place: string; title_en: string; title_ta: string; body_en: string; body_ta: string; created: number }

export default function CitizenAlerts() {
  const { t, lang } = useLang();
  const q = useLoad(() => api.get<{ alerts: A[] }>("/api/citizen/alerts"));
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Spinner />;
  return (
    <div className="fade-in space-y-5">
      <div><h1 className="h-display text-2xl sm:text-3xl">{t("alertsTitle")}</h1></div>
      <Callout tone="warn" title={t("demo")}>{lang === "ta" ? "இவை செயல்விளக்க எச்சரிக்கைகள். அவசரத்தில் 112-ஐ அழைக்கவும்." : "These are demonstration alerts. In an emergency call 112."}</Callout>
      {q.data.alerts.length === 0 ? <Panel><p className="text-sm text-stone-300">{t("alertsNone")}</p></Panel> : q.data.alerts.map((a) => (
        <Panel key={a.id} className="!p-4">
          <div className="flex flex-wrap items-center gap-2"><Chip tone="warn">DEMO</Chip>{a.mode === "REPLAY" && <ModeTag mode="REPLAY" />}<span className="ml-auto font-mono text-[11px] text-stone-500">{new Date(a.created * 1000).toLocaleString()}</span></div>
          <h2 className="h-display mt-2 text-xl">{lang === "ta" ? a.title_ta : a.title_en}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-stone-300">{lang === "ta" ? a.body_ta : a.body_en}</p>
        </Panel>))}
    </div>
  );
}
