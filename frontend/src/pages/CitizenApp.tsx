import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../auth";
import CitizenReportForm from "./CitizenReportForm";
import CitizenMine from "./CitizenMine";

export default function CitizenApp() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-[2000] border-b border-white/[0.07] bg-ink-950/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[900px] items-center gap-2 px-3 py-3 sm:gap-4 sm:px-4">
          <NavLink to="/" className="flex items-center gap-2.5">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" stroke="#34d399" strokeOpacity=".5" /><path d="M16 6c5 4 7 8 0 20C9 14 11 10 16 6Z" fill="#34d399" /><path d="M3 18h6l3-5 4 9 3-6 2 2h8" stroke="#ecfdf5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="font-display hidden text-lg tracking-wide text-stone-50 sm:inline">TERRAPULSE</span>
          </NavLink>
          <nav className="flex flex-1 gap-1">
            {[["/", "Report"], ["/mine", "My reports"]].map(([to, label]) => (
              <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${isActive ? "bg-moss-500/15 text-moss-400" : "text-stone-400 hover:text-stone-100"}`}>{label}</NavLink>
            ))}
          </nav>
          <span className="hidden text-sm text-stone-300 sm:block">{user?.name}</span>
          <button onClick={logout} className="btn-ghost !px-3 !py-1.5 text-xs">Sign out</button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[900px] flex-1 px-4 py-6">
        <Routes>
          <Route path="/" element={<CitizenReportForm />} />
          <Route path="/mine" element={<CitizenMine />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
