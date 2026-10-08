import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import ReportView from "../components/ReportView";
import { ErrorBox, Panel, Spinner, useLoad } from "../components/ui";
import type { Report } from "../types";

export default function Reports() {
  const { rid } = useParams();
  const list = useLoad(() => api.get<{ reports: { id: number; incident_id: string; created: number }[] }>("/api/reports"), [rid]);
  const one = useLoad(() => (rid ? api.get<Report>(`/api/reports/${rid}`) : Promise.resolve(null)), [rid]);
  const download = async () => {
    const t = await api.text(`/api/reports/${rid}/markdown`);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], { type: "text/markdown" })); a.download = `terrapulse-report-${rid}.md`; a.click();
  };
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  return (
    <div className="space-y-6 fade-in">
      <div className="no-print flex flex-wrap items-end justify-between gap-3"><div><div className="label mb-2">Reports</div><h1 className="h-display text-4xl">Investigation reports</h1></div>
        {one.data && <div className="flex gap-2"><button className="btn-primary" onClick={() => window.print()}>Print / Save as PDF</button><button className="btn-ghost" onClick={download}>Download .md</button></div>}</div>
      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel kicker="Generated" title="Report archive" className="no-print h-fit">
          {!list.data ? <Spinner /> : list.data.reports.length === 0 ? <p className="text-sm text-stone-400">No reports yet. Open an incident and choose “Generate investigation report”.</p> :
            <ul className="space-y-2">{list.data.reports.map((r) => <li key={r.id}><Link to={`/reports/${r.id}`} className={`block rounded-lg border px-3 py-2 text-sm ${String(r.id) === rid ? "border-moss-500/50 bg-moss-500/10" : "border-white/[0.07] hover:border-white/20"}`}><span className="font-mono">#{r.id} · {r.incident_id}</span><div className="text-xs text-stone-500">{new Date(r.created * 1000).toLocaleString()}</div></Link></li>)}</ul>}
        </Panel>
        <div>{rid ? (one.error ? <ErrorBox error={one.error} /> : one.data ? <ReportView report={one.data} /> : <Spinner />) : <div className="glass p-10 text-stone-400">Select a report to read it here.</div>}</div>
      </div>
    </div>
  );
}
