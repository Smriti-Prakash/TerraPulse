import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../auth";
import CitizenReportForm from "./CitizenReportForm";
import CitizenMine from "./CitizenMine";
import CitizenAlerts from "./CitizenAlerts";
import { LangToggle, useLang } from "../i18n";

export default function CitizenApp() {
  const { logout } = useAuth();
  const { t } = useLang();
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-[2000] border-b border-white/10 bg-ink-900">
        <div className="mx-auto flex max-w-[900px] items-center gap-3 px-4 py-2.5">
          <NavLink to="/" className="flex items-center gap-2">
            <svg width="26" height="26" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="15" fill="#34d399" /><path d="M16 7c5 4 7 8 0 18C9 15 11 11 16 7Z" fill="#0a100d" /></svg>
            <span className="text-base font-semibold text-stone-50">TerraPulse</span>
          </NavLink>
          <div className="ml-auto flex items-center gap-2">
            <LangToggle />
            <button onClick={logout} className="btn-ghost !px-3 !py-1.5 text-xs">{t("signOut")}</button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[900px] gap-1 overflow-x-auto px-3">
          {[["/", t("report")], ["/mine", t("mine")], ["/alerts", t("alerts")], ["/safety", t("safety")]].map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${isActive ? "border-moss-500 font-semibold text-moss-400" : "border-transparent text-stone-400"}`}>{label}</NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[900px] flex-1 px-4 py-6">
        <Routes>
          <Route path="/" element={<CitizenReportForm />} />
          <Route path="/mine" element={<CitizenMine />} />
          <Route path="/alerts" element={<CitizenAlerts />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
