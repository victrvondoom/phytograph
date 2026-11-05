import { useEffect, useRef, useState } from "react";
import { Map as MLMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CLASS_COLOR } from "../lib/labels";
import type { OccurrenceRecord, OccurrenceQualityFinding } from "../lib/types";

interface Props {
  declared: { lat: number; lon: number; name: string } | null;
  records: OccurrenceRecord[];
  classes: Record<string, OccurrenceQualityFinding["record_class"]>;
  selectedId: string | null;
  onSelect: (gbifId: string) => void;
  regionGeoJson: GeoJSON.Feature | null;
  landUrl: string;
}

// No basemap tiles: the map draws only backend-served data, so the browser makes no third-party requests.
const STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#e9ede4" } }],
};

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Display-only: a point can be drawn only if its coordinates are finite, in range and not the (0,0) placeholder.
 *  The quality class comes from the backend; records failing this stay in the evidence table. */
export function drawable(r: OccurrenceRecord): r is OccurrenceRecord & { lat: number; lon: number } {
  return r.lat !== null && r.lon !== null && Number.isFinite(r.lat) && Number.isFinite(r.lon)
    && Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180 && !(r.lat === 0 && r.lon === 0);
}

export default function OriginMap({ declared, records, classes, selectedId, onSelect, regionGeoJson, landUrl }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [isReady, setIsReady] = useState(false);
  const marker = useRef<Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!container.current || map.current) return;
    setWorkerUrl("/maplibre-gl-worker.mjs");
    const m = new MLMap({ container: container.current, style: STYLE, center: [77, 11], zoom: 6, attributionControl: false });
    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.on("load", async () => {
      m.addSource("land", { type: "geojson", data: EMPTY });
      m.addSource("region", { type: "geojson", data: EMPTY });
      m.addSource("records", { type: "geojson", data: EMPTY });
      m.addSource("selected", { type: "geojson", data: EMPTY });
      m.addLayer({ id: "land-fill", type: "fill", source: "land", paint: { "fill-color": "#d5dbc9" } });
      m.addLayer({ id: "land-line", type: "line", source: "land", paint: { "line-color": "#aeb8a0", "line-width": 0.6 } });
      m.addLayer({ id: "region-line", type: "line", source: "region", paint: { "line-color": "#2f5d4a", "line-width": 1.2, "line-dasharray": [3, 2] } });
      m.addLayer({
        id: "records-circle",
        type: "circle",
        source: "records",
        paint: {
          "circle-radius": 5.5,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.2,
        },
      });
      m.addLayer({
        id: "selected-ring",
        type: "circle",
        source: "selected",
        paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#1d2a24", "circle-stroke-width": 2 },
      });
      m.on("click", "records-circle", (e) => {
        const id = e.features?.[0]?.properties?.gbif_id;
        if (typeof id === "string") onSelectRef.current(id);
      });
      m.on("mouseenter", "records-circle", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "records-circle", () => (m.getCanvas().style.cursor = ""));
      try {
        const res = await fetch(landUrl);
        if (res.ok) (m.getSource("land") as GeoJSONSource).setData(await res.json());
      } catch {
        /* land context is optional; the map still shows records */
      }
      setIsReady(true);
    });
    return () => {
      marker.current?.remove();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !isReady) return;
    (m.getSource("region") as GeoJSONSource).setData(regionGeoJson ?? EMPTY);
  }, [regionGeoJson, isReady]);

  useEffect(() => {
    const m = map.current;
    if (!m || !isReady) return;
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: records
        .filter(drawable)
        .map((r) => {
          const cls = classes[r.gbif_id] ?? "usable";
          return {
            type: "Feature",
            geometry: { type: "Point", coordinates: [r.lon as number, r.lat as number] },
            properties: { gbif_id: r.gbif_id, class: cls, color: CLASS_COLOR[cls] },
          };
        }),
    };
    (m.getSource("records") as GeoJSONSource).setData(fc);
  }, [records, classes, isReady]);

  useEffect(() => {
    const m = map.current;
    if (!m || !isReady) return;
    const sel = records.find((r) => r.gbif_id === selectedId);
    (m.getSource("selected") as GeoJSONSource).setData(
      sel && drawable(sel)
        ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [sel.lon, sel.lat] }, properties: {} }] }
        : EMPTY,
    );
  }, [selectedId, records, isReady]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    marker.current?.remove();
    marker.current = null;
    if (declared) {
      const el = document.createElement("div");
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", `Declared collection point: ${declared.name}`);
      el.title = `Declared point: ${declared.name} (${declared.lat}, ${declared.lon})`;
      el.style.cssText = "width:16px;height:16px;border-radius:2px;background:#1d2a24;border:2px solid #fff;box-shadow:0 0 0 1px #1d2a24;transform:rotate(45deg)";
      marker.current = new Marker({ element: el }).setLngLat([declared.lon, declared.lat]).addTo(m);
    }
    const bounds: [number, number][] = [];
    if (declared) bounds.push([declared.lon, declared.lat]);
    for (const r of records) if (drawable(r)) bounds.push([r.lon, r.lat]);
    if (bounds.length) {
      const lons = bounds.map((b) => b[0]);
      const lats = bounds.map((b) => b[1]);
      const pad = 0.4;
      m.fitBounds([[Math.min(...lons) - pad, Math.min(...lats) - pad], [Math.max(...lons) + pad, Math.max(...lats) + pad]], { padding: 40, duration: 400, maxZoom: 7.5 });
    }
  }, [declared, records, isReady]);

  return (
    <div className="relative h-[460px] w-full overflow-hidden rounded-md border border-line bg-[#e9ede4] lg:h-[calc(100vh-14rem)] lg:min-h-[460px]">
      <div ref={container} className="absolute inset-0" style={{ position: "absolute", inset: 0 }} role="application" aria-label="Map of declared batch location and retrieved GBIF occurrence records" />
      <div className="pointer-events-none absolute left-3 top-3 w-60 rounded-md bg-white/95 p-3 text-xs text-bark shadow-sm ring-1 ring-line">
        <div className="mb-1.5 font-semibold text-ink">Map key</div>
        <div className="flex items-center gap-2"><span className="inline-block h-3 w-3 rotate-45 bg-ink" />Declared collection point</div>
        <div className="mt-1 flex items-center gap-2"><span className="inline-block h-0 w-4 border-t border-dashed border-moss" />Approximate demonstration region</div>
        <div className="mt-1 flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#2f7d5b]" />Usable GBIF record</div>
        <div className="mt-1 flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#c08a2b]" />Usable with caution</div>
        <div className="mt-1 flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#7b8794]" />Insufficient for spatial check</div>
        <div className="mt-1 flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#b4442f]" />Invalid</div>
        <div className="mt-1 flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#7a5ea8]" />Duplicate</div>
        <div className="mt-2 text-bark/60">Records with missing, out-of-range or (0,0) coordinates are not plotted; they remain in the evidence table. No third-party basemap is loaded.</div>
      </div>
    </div>
  );
}
