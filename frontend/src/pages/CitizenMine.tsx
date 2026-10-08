import { Link } from "react-router-dom";
import { api } from "../api";
import AuthImage from "../components/AuthImage";
import { Chip, ErrorBox, Panel, Spinner, useLoad } from "../components/ui";
import { CATEGORY_LABEL, CitizenReport } from "../fieldTypes";

const TONE: Record<string, "neutral" | "warn" | "good" | "earth"> = { Received: "neutral", "Under review": "warn", "Action taken": "good", Closed: "earth" };

export default function CitizenMine() {
  const q = useLoad(() => api.get<{ reports: CitizenReport[] }>("/api/citizen/reports"));
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Spinner />;
  const list = q.data.reports;
  return (
    <div className="fade-in space-y-5">
      <div><div className="label mb-2">Citizen report</div><h1 className="h-display text-3xl">My reports</h1></div>
      {list.length === 0 ? (
        <Panel><p className="text-sm text-stone-300">You have not sent any reports yet.</p><Link to="/" className="btn-primary mt-4 inline-flex">Report an incident</Link></Panel>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <Panel key={r.id} className="!p-4">
              <div className="flex gap-4">
                <AuthImage path={r.photo_url} alt={`Photo for report ${r.id}`} className="h-24 w-24 flex-none rounded-xl border border-white/10 object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-stone-100">#{r.id}</span>
                    <Chip>{CATEGORY_LABEL[r.category]}</Chip>
                    <Chip tone={TONE[r.status] ?? "neutral"}>{r.status}</Chip>
                  </div>
                  {r.note && <p className="mt-2 line-clamp-2 text-sm text-stone-300">{r.note}</p>}
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
