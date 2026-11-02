import { Link } from "react-router-dom";
import { api } from "../api";
import AuthImage from "../components/AuthImage";
import { Chip, ErrorBox, Panel, Spinner, useLoad } from "../components/ui";
import { CitizenReport } from "../fieldTypes";
import { Key, useLang } from "../i18n";

const TONE: Record<string, "neutral" | "warn" | "good" | "earth"> = { Received: "neutral", "Under review": "warn", "Action taken": "good", Closed: "earth" };

export default function CitizenMine() {
  const { t, lang } = useLang();
  const q = useLoad(() => api.get<{ reports: CitizenReport[] }>("/api/citizen/reports"));
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Spinner />;
  const list = q.data.reports;
  return (
    <div className="fade-in space-y-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">{t("myTitle")}</h1></div>
      {list.length === 0 ? (
        <Panel><p className="text-sm text-stone-300">{t("none")}</p><Link to="/" className="btn-primary mt-4 inline-flex">{t("report")}</Link></Panel>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <Panel key={r.id} className="!p-4">
              <div className="flex gap-4">
                <AuthImage path={r.photo_url} alt={`Photo for report ${r.id}`} className="h-24 w-24 flex-none rounded-xl border border-white/10 object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-stone-100">#{r.id}</span>
                    <Chip>{t(r.category)}</Chip>
                    <Chip tone={TONE[r.status] ?? "neutral"}>{t(r.status as Key)}</Chip>
                  </div>
                  {r.note && <p className="mt-2 line-clamp-2 text-sm text-stone-300">{r.note}</p>}
                  <p className="mt-2 rounded-lg bg-ink-900/60 px-3 py-2 text-[13px] leading-snug text-stone-200">{lang === "ta" ? r.outcome_ta : r.outcome_en}</p>
                  <div className="mt-2 font-mono text-[11px] text-stone-500">{new Date(r.created * 1000).toLocaleString()} · {r.lat.toFixed(4)}, {r.lon.toFixed(4)}</div>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
