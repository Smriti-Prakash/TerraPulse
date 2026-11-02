import { useEffect, useState } from "react";
import { NavLink, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { ErrorBox, Spinner, useLoad } from "./components/ui";
import Login from "./pages/Login";
import CitizenApp from "./pages/CitizenApp";
import FieldReports from "./pages/FieldReports";
import FieldReportDetail from "./pages/FieldReportDetail";
import Command from "./pages/Command";
import Incidents from "./pages/Incidents";
import Workspace from "./pages/Workspace";
import Hub from "./pages/Hub";
import RiskAlerts from "./pages/RiskAlerts";
import Reports from "./pages/Reports";
import ChangeOverTime from "./pages/ChangeOverTime";
import FireSeason from "./pages/FireSeason";
import Community from "./pages/Community";
import Safety from "./pages/Safety";
import Insights from "./pages/Insights";

const NAV = [["/", "Today"], ["/field-reports", "Citizen reports"], ["/incidents", "Incidents"], ["/community", "Public alerts"], ["/insights", "Insights"], ["/reports", "Reports"]] as const;

interface Health { model_loaded: boolean; csv_loaded: boolean; rows: number; errors: string[]; gemini_configured: boolean; gemini_model: string }

export default function App() {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (loc.pathname === "/safety") return <Safety />; // public page: no sign-in needed
  if (!ready) return <div className="flex min-h-full items-center justify-center"><Spinner text="Checking sign-in…" /></div>;
  if (!user) return <Login />;
  if (user.role === "citizen") return <CitizenApp />;
  return <Shell />;
}

function Shell() {
  const { user, logout } = useAuth();
  const { data: h, error } = useLoad(() => api.get<Health>("/api/health"));
  const fr = useLoad(() => api.get<{ new: number; alerts: number }>("/api/field-reports/summary"));
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { fr.reload(); setOpen(false); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const link = (to: string, label: string, side: boolean) => (
    <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `flex items-center justify-between rounded-lg px-3 py-2 text-sm ${isActive ? "bg-moss-500 font-medium text-ink-950" : "text-stone-300 hover:bg-white/[0.05]"} ${side ? "" : "py-2.5"}`}>
      {label}{to === "/field-reports" && fr.data && fr.data.new > 0 && <span className="ml-2 rounded-full bg-warn px-2 text-xs font-semibold text-ink-950" title="New reports">{fr.data.new}</span>}
    </NavLink>
  );
  return (
    <div className="flex min-h-full">
      <aside className="no-print sticky top-0 hidden h-screen w-60 flex-none flex-col border-r border-white/10 bg-ink-900 p-4 lg:flex">
        <NavLink to="/" className="mb-6 flex items-center gap-2.5 px-1">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="15" fill="#34d399" /><path d="M16 7c5 4 7 8 0 18C9 15 11 11 16 7Z" fill="#0a100d" /></svg>
          <div><div className="text-base font-semibold leading-none text-stone-50">TerraPulse</div><div className="mt-1 text-xs text-stone-400">Mudumalai</div></div>
        </NavLink>
        <nav className="space-y-1">{NAV.map(([to, l]) => link(to, l, true))}</nav>
        <div className="mt-auto border-t border-white/10 pt-4">
          {error != null && <div className="mb-2 text-xs font-medium text-crit">Backend offline</div>}
          <div className="text-sm font-medium text-stone-100">{user?.name}</div>
          <button onClick={logout} className="mt-1 text-sm text-stone-400 underline-offset-2 hover:underline">Sign out</button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-[2000] border-b border-white/10 bg-ink-900 lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <NavLink to="/" className="text-base font-semibold text-stone-50">TerraPulse</NavLink>
            <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="btn-ghost !px-3 !py-1.5">{open ? "Close" : "Menu"}</button>
          </div>
          {open && <nav className="space-y-1 border-t border-white/10 p-3">{NAV.map(([to, l]) => link(to, l, false))}<button onClick={logout} className="px-3 py-2 text-sm text-stone-400">Sign out</button></nav>}
        </header>
        <main className="mx-auto w-full max-w-[1680px] px-4 py-6 lg:px-8 lg:py-8">
          {h && h.errors.length > 0 && <div className="mb-4"><ErrorBox error={new Error(h.errors.join(" · "))} /></div>}
          <Routes>
            <Route path="/" element={<Command />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/incidents/:id" element={<Workspace />} />
            <Route path="/field-reports" element={<FieldReports />} />
            <Route path="/field-reports/:id" element={<FieldReportDetail />} />
            <Route path="/community" element={<Community />} />
            <Route path="/insights/*" element={<Insights />} />
            <Route path="/change" element={<Navigate to="/insights/change" />} />
            <Route path="/fire-season" element={<Navigate to="/insights/fire-season" />} />
            <Route path="/replay" element={<Navigate to="/insights/replay" />} />
            <Route path="/risk" element={<Navigate to="/insights/risk" />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:rid" element={<Reports />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
