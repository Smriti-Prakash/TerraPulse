import { useEffect } from "react";
import { CircleMarker, MapContainer, Rectangle, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { Bbox } from "../fieldTypes";

export interface Pin { lat: number; lon: number }

const inside = (b: Bbox, lat: number, lon: number) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

function Clicks({ bbox, onPick }: { bbox: Bbox; onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => { if (inside(bbox, e.latlng.lat, e.latlng.lng)) onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

function Fly({ bbox, pin, flyKey }: { bbox: Bbox; pin: Pin | null; flyKey: number }) {
  const map = useMap();
  useEffect(() => { map.fitBounds([[bbox.south, bbox.west], [bbox.north, bbox.east]]); }, [bbox, map]);
  useEffect(() => { if (flyKey > 0 && pin) map.setView([pin.lat, pin.lon], Math.max(map.getZoom(), 15), { animate: true }); }, [flyKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Tap the map to drop a pin inside the covered area. `flyKey` changes when the parent wants the map to jump to the pin (e.g. after GPS). */
export default function PinPicker({ bbox, pin, onPick, flyKey, height = 320 }: { bbox: Bbox; pin: Pin | null; onPick: (lat: number, lon: number) => void; flyKey: number; height?: number }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10" style={{ height }}>
      <MapContainer bounds={L.latLngBounds([bbox.south, bbox.west], [bbox.north, bbox.east])} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false} maxBounds={L.latLngBounds([bbox.south - 0.3, bbox.west - 0.3], [bbox.north + 0.3, bbox.east + 0.3])}>
        <TileLayer attribution="Imagery © Esri, Maxar, Earthstar Geographics" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={19} opacity={0.8} />
        <Rectangle bounds={[[bbox.south, bbox.west], [bbox.north, bbox.east]]} pathOptions={{ color: "#34d399", weight: 1.5, dashArray: "6 6", fillOpacity: 0 }} />
        <Fly bbox={bbox} pin={pin} flyKey={flyKey} />
        <Clicks bbox={bbox} onPick={onPick} />
        {pin && <CircleMarker center={[pin.lat, pin.lon]} radius={9} pathOptions={{ color: "#ffffff", weight: 2.5, fillColor: "#ef4444", fillOpacity: 0.95 }} />}
      </MapContainer>
      <div className="pointer-events-none absolute bottom-2 left-2 z-[1000] rounded-lg bg-ink-950/80 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wider text-stone-300">Tap inside the dashed area</div>
    </div>
  );
}
