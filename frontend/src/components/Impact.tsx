import type { Nearby } from "../fieldTypes";
import { Missing } from "./ui";

const KINDS = [["settlement", "Settlements", "🏘"], ["school", "Schools", "🏫"], ["water", "Water sources", "💧"], ["road", "Roads", "🛣"]] as const;

/** People-and-places context around a point, from the OpenStreetMap layer. Counts are a minimum (OSM can be incomplete). */
export default function Impact({ n }: { n: Nearby | null | undefined }) {
  if (!n) return null;
  if (n.status !== "ok") return <Missing what="Settlements, schools, roads and water near this point" how="Run tools/fetch_osm_layers.py once on your laptop and save its output as backend/data/osm_layers.json." />;
  return (
    <div>
      <div className="mb-3 text-sm font-medium text-stone-100">{n.summary_en}</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-2">
        {KINDS.map(([k, label, icon]) => (
          <div key={k} className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-3">
            <div className="text-lg leading-none" aria-hidden>{icon}</div>
            <div className="mt-2 text-3xl leading-none">{n[k]!.count}</div>
            <div className="label mt-1 !text-[10px]">{label}</div>
            {n[k]!.nearest[0] && <div className="mt-1.5 truncate text-[11px] text-stone-400" title={n[k]!.nearest.map((x) => `${x.name ?? "unnamed"} ${x.distance_km} km`).join(", ")}>{n[k]!.nearest[0].name ?? "unnamed"} · {n[k]!.nearest[0].distance_km} km</div>}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-stone-500">Source: {n.source}. {n.note}</p>
    </div>
  );
}
