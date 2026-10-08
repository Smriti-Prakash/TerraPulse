import { useEffect } from "react";
import { NavLink, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { Chip, ErrorBox, Spinner, useLoad } from "./components/ui";
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

const NAV = [["/", "Dashboard"], ["/incidents", "Incidents"], ["/field-reports", "Citizen reports"], ["/risk", "Alerts"], ["/reports", "Reports"]] as const;

interface Health { model_loaded: boolean; csv_loaded: boolean; rows: number; errors: string[]; gemini_configured: boolean; gemini_model: string }

export default function App() {
  const { user, ready } = useAuth();
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
  useEffect(() => { fr.reload(); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex min-h-full flex-col">
      <header className="no-print sticky top-0 z-[2000] border-b border-white/[0.07] bg-ink-950/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1680px] items-center gap-8 px-6 py-3">
          <NavLink to="/" className="flex items-center gap-3">
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" stroke="#34d399" strokeOpacity=".5" /><path d="M16 6c5 4 7 8 0 20C9 14 11 10 16 6Z" fill="#34d399" /><path d="M3 18h6l3-5 4 9 3-6 2 2h8" stroke="#ecfdf5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <div><div className="font-display text-xl leading-none tracking-wide text-stone-50">TERRAPULSE</div><div className="label mt-0.5 !text-[9.5px]">Forest intelligence · Mudumalai</div></div>
          </NavLink>
          <nav className="flex flex-1 gap-1 overflow-x-auto">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `whitespace-nowrap rounded-lg px-3.5 py-2 text-sm transition ${isActive ? "bg-moss-500/15 text-moss-400" : "text-stone-400 hover:text-stone-100"}`}>{label}{to === "/field-reports" && fr.data && fr.data.new > 0 && <span className="ml-2 rounded-full bg-warn/20 px-1.5 py-0.5 font-mono text-[10px] text-warn" title="New reports">{fr.data.new}</span>}</NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {error != null && <span className="hidden lg:inline-flex"><Chip tone="bad">Backend offline</Chip></span>}
            <div className="hidden text-right sm:block">
              <div className="text-sm leading-tight text-stone-200">{user?.name}</div>
              <div className="label !text-[9.5px]">{user?.username}</div>
            </div>
            <button onClick={logout} className="btn-ghost !px-3 !py-1.5 text-xs">Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1680px] flex-1 px-6 py-6">
        {h && h.errors.length > 0 && <div className="mb-4"><ErrorBox error={new Error(h.errors.join(" · "))} /></div>}
        <Routes>
          <Route path="/" element={<Command />} />
                    <Route path="/incidents" element={<Incidents />} />
          <Route path="/incidents/:id" element={<Workspace />} />
          <Route path="/replay" element={<Hub />} />
          <Route path="/field-reports" element={<FieldReports />} />
          <Route path="/field-reports/:id" element={<FieldReportDetail />} />
          <Route path="/risk" element={<RiskAlerts />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:rid" element={<Reports />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
