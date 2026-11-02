import { useEffect, useState } from "react";
import { MapContainer, Marker, Rectangle, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { Bbox } from "../fieldTypes";

export interface Pin { lat: number; lon: number }
interface Hit { name: string; lat: number; lon: number }

const inside = (b: Bbox, lat: number, lon: number) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
const pinIcon = L.divIcon({ className: "", html: '<div style="width:22px;height:22px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.5)"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });

function Clicks({ bbox, onPick }: { bbox: Bbox; onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => { if (inside(bbox, e.latlng.lat, e.latlng.lng)) onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

function Fly({ bbox, pin, flyKey, goto }: { bbox: Bbox; pin: Pin | null; flyKey: number; goto: { lat: number; lon: number; k: number } | null }) {
  const map = useMap();
  useEffect(() => { map.fitBounds([[bbox.south, bbox.west], [bbox.north, bbox.east]]); }, [bbox, map]);
  useEffect(() => { if (flyKey > 0 && pin) map.setView([pin.lat, pin.lon], Math.max(map.getZoom(), 15), { animate: true }); }, [flyKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (goto) map.setView([goto.lat, goto.lon], Math.max(map.getZoom(), 15), { animate: true }); }, [goto?.k]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** "11.6480, 76.4985" (also accepts a space or a Google Maps style pair). */
function parseCoords(s: string): Pin | null {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  return m ? { lat: parseFloat(m[1]), lon: parseFloat(m[2]) } : null;
}

/**
 * Satellite map for placing the incident pin. Tap the map, drag the pin, search for a place name,
 * or type coordinates. Everything stays inside the covered area. `flyKey` changes when the parent wants the map to jump to the pin (e.g. after GPS).
 */
export default function PinPicker({ bbox, pin, onPick, flyKey, height = 360 }: { bbox: Bbox; pin: Pin | null; onPick: (lat: number, lon: number) => void; flyKey: number; height?: number }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [goto, setGoto] = useState<{ lat: number; lon: number; k: number } | null>(null);
  const [sat, setSat] = useState(true);

  const place = (lat: number, lon: number) => {
    if (!inside(bbox, lat, lon)) { setMsg("That point is outside the area TerraPulse covers (the dashed box)."); return; }
    setMsg(null); setHits(null); onPick(lat, lon); setGoto({ lat, lon, k: Date.now() });
  };

  async function search() {
    const text = q.trim();
    if (!text) return;
    const c = parseCoords(text);
    if (c) { place(c.lat, c.lon); return; }
    setBusy(true); setMsg(null); setHits(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&bounded=1&viewbox=${bbox.west},${bbox.north},${bbox.east},${bbox.south}&q=${encodeURIComponent(text)}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { display_name: string; lat: string; lon: string }[];
      const list = j.map((x) => ({ name: x.display_name, lat: parseFloat(x.lat), lon: parseFloat(x.lon) })).filter((x) => inside(bbox, x.lat, x.lon));
      if (!list.length) setMsg("No place with that name inside the covered area. Try a nearby village or road name, type coordinates, or tap the map.");
      else if (list.length === 1) place(list[0].lat, list[0].lon);
      else setHits(list);
    } catch {
      setMsg("Place search is not available right now (it needs an internet connection). You can still tap the map or type coordinates like 11.6480, 76.4985.");
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-2 flex gap-2" role="search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a village or road, or type 11.6480, 76.4985"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
          aria-label="Search for a place or enter coordinates" className="min-w-0 flex-1 rounded-xl border border-white/15 bg-ink-700 px-3 py-2.5 text-sm text-stone-100 placeholder:text-stone-500" />
        <button type="button" onClick={search} disabled={busy || !q.trim()} className="btn-primary px-4">{busy ? "Searching…" : "Find"}</button>
      </div>
      {hits && (
        <ul className="mb-2 overflow-hidden rounded-xl border border-white/10 bg-ink-700 text-sm">
          {hits.map((h, i) => (
            <li key={i}><button type="button" onClick={() => place(h.lat, h.lon)} className="block w-full px-3 py-2 text-left text-stone-200 hover:bg-white/[0.08]">{h.name}</button></li>
          ))}
        </ul>
      )}
      {msg && <div className="mb-2 rounded-lg border border-warn/30 bg-warn/[0.07] px-3 py-2 text-sm text-amber-100">{msg}</div>}
      <div className="relative overflow-hidden rounded-2xl border border-white/10" style={{ height }}>
        <MapContainer bounds={L.latLngBounds([bbox.south, bbox.west], [bbox.north, bbox.east])} style={{ height: "100%", width: "100%" }} scrollWheelZoom maxBounds={L.latLngBounds([bbox.south - 0.3, bbox.west - 0.3], [bbox.north + 0.3, bbox.east + 0.3])}>
          {sat ? (
            <>
              <TileLayer attribution="Imagery © Esri, Maxar, Earthstar Geographics" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={19} opacity={0.8} />
            </>
          ) : (
            <TileLayer attribution="© OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
          )}
          <Rectangle bounds={[[bbox.south, bbox.west], [bbox.north, bbox.east]]} pathOptions={{ color: "#34d399", weight: 1.5, dashArray: "6 6", fillOpacity: 0 }} />
          <Fly bbox={bbox} pin={pin} flyKey={flyKey} goto={goto} />
          <Clicks bbox={bbox} onPick={(a, b) => { setMsg(null); setHits(null); onPick(a, b); }} />
          {pin && (
            <Marker position={[pin.lat, pin.lon]} icon={pinIcon} draggable
              eventHandlers={{ dragend: (e) => { const p = (e.target as L.Marker).getLatLng(); if (inside(bbox, p.lat, p.lng)) onPick(p.lat, p.lng); else { setMsg("Keep the pin inside the dashed area."); (e.target as L.Marker).setLatLng([pin.lat, pin.lon]); } } }} />
          )}
        </MapContainer>
        <div className="absolute right-2 top-2 z-[1000] flex overflow-hidden rounded-lg border border-white/20 bg-ink-900/90 text-xs">
          {([[true, "Satellite"], [false, "Map"]] as const).map(([v, l]) => (
            <button key={l} type="button" onClick={() => setSat(v)} aria-pressed={sat === v} className={`px-3 py-1.5 ${sat === v ? "bg-moss-500 font-medium text-ink-950" : "text-stone-300"}`}>{l}</button>
          ))}
        </div>
        <div className="pointer-events-none absolute bottom-2 left-2 z-[1000] rounded-lg bg-ink-950/80 px-2.5 py-1 text-[11px] text-stone-300">Tap to place the pin, drag it to adjust</div>
      </div>
    </div>
  );
}
