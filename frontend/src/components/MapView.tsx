import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";

export interface Pt { id: string; lat: number; lon: number; color: string; radius?: number; selected?: boolean; dim?: boolean; tip?: string }

function Fit({ pts, focus, zoom }: { pts: Pt[]; focus?: { lat: number; lon: number }; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (focus) { map.setView([focus.lat, focus.lon], zoom ?? 16, { animate: true }); return; }
    if (pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon] as [number, number])).pad(0.2), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.lat, focus?.lon, pts.length]);
  return null;
}

function Jump({ pts }: { pts: Pt[] }) {
  const map = useMap();
  const go = (north: boolean | null) => {
    const sel = north === null ? pts : pts.filter((p) => (p.lat >= 11.6) === north);
    if (sel.length) map.fitBounds(L.latLngBounds(sel.map((p) => [p.lat, p.lon] as [number, number])).pad(0.3), { animate: true });
  };
  return (
    <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-1.5">
      {[["All", null], ["North cluster", true], ["South cluster", false]].map(([l, v]) => (
        <button key={l as string} onClick={() => go(v as boolean | null)} className="rounded-lg border border-white/10 bg-ink-900/90 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wider text-stone-300 hover:text-moss-400">{l as string}</button>
      ))}
    </div>
  );
}

export default function MapView({ pts, onPick, height = 460, focus, zoom, jump = true, labels = true }: {
  pts: Pt[]; onPick?: (id: string) => void; height?: number | string; focus?: { lat: number; lon: number }; zoom?: number; jump?: boolean; labels?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10" style={{ height }}>
      <MapContainer center={[11.6, 76.5]} zoom={11} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <TileLayer attribution="Imagery © Esri, Maxar, Earthstar Geographics" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
        {labels && <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={19} opacity={0.8} />}
        <Fit pts={pts} focus={focus} zoom={zoom} />
        {pts.map((p) => (
          <CircleMarker key={p.id} center={[p.lat, p.lon]} radius={(p.radius ?? 7) + (p.selected ? 3 : 0)}
            pathOptions={{ color: p.selected ? "#ffffff" : "#0b110e", weight: p.selected ? 2.5 : 1.2, fillColor: p.color, fillOpacity: p.dim ? 0.35 : 0.92 }}
            eventHandlers={{ click: () => onPick?.(p.id) }}>
            {p.tip && <Tooltip direction="top" offset={[0, -6]}>{p.tip}</Tooltip>}
          </CircleMarker>
        ))}
        {jump && <Jump pts={pts} />}
      </MapContainer>
    </div>
  );
}
