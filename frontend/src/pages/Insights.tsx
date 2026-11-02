import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import ChangeOverTime from "./ChangeOverTime";
import FireSeason from "./FireSeason";
import Graphs from "./Graphs";
import Hub from "./Hub";
import RiskAlerts from "./RiskAlerts";

const TABS = [["graphs", "Forest over time"], ["change", "Change over time"], ["fire-season", "Fire seasons"], ["replay", "Replay a past fire"], ["risk", "Risk scoring"]] as const;

export default function Insights() {
  return (
    <div className="space-y-6">
      <div className="flex gap-1 overflow-x-auto border-b border-white/10">
        {TABS.map(([to, l]) => <NavLink key={to} to={`/insights/${to}`} className={({ isActive }) => `-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm ${isActive ? "border-moss-500 font-semibold text-moss-400" : "border-transparent text-stone-400 hover:text-stone-100"}`}>{l}</NavLink>)}
      </div>
      <Routes>
        <Route path="graphs" element={<Graphs />} />
        <Route path="change" element={<ChangeOverTime />} />
        <Route path="fire-season" element={<FireSeason />} />
        <Route path="replay" element={<Hub />} />
        <Route path="risk" element={<RiskAlerts />} />
        <Route path="*" element={<Navigate to="graphs" />} />
      </Routes>
    </div>
  );
}
