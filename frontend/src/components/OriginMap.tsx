import { useEffect, useRef, useState } from "react";
import { Map as MLMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CLASS_HEX } from "./ui";
import type { OccurrenceRecord, OccurrenceQualityFinding } from "../lib/types";

export type Basemap = "context" | "satellite";

interface Props {
  declared: { lat: number; lon: number; name: string } | null;
  records: OccurrenceRecord[];
  classes: Record<string, OccurrenceQualityFinding["record_class"]>;
  selectedId: string | null;
  onSelect: (gbifId: string) => void;
  regionGeoJson: GeoJSON.Feature | null;
  landUrl: string;
  satelliteAvailable: boolean;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const BASE_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eef6fb" } }] };
const STATES_URL = "/api/context/india-states";
const OPERATIONAL = new Set(["Kerala", "Tamil Nadu"]);

/** Display-only: a point is drawable when its coordinates are finite, in range and not the (0,0) placeholder.
 *  Quality classes come from the backend; records that fail this stay in the evidence table. */
export function drawable(r: OccurrenceRecord): r is OccurrenceRecord & { lat: number; lon: number } {
  return r.lat !== null && r.lon !== null && Number.isFinite(r.lat) && Number.isFinite(r.lon)
    && Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180 && !(r.lat === 0 && r.lon === 0);
}

export default function OriginMap({ declared, records, classes, selectedId, onSelect, regionGeoJson, landUrl, satelliteAvailable }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("context");
  const [hover, setHover] = useState<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const drawableCount = records.filter(drawable).length;
  const undrawn = records.length - drawableCount;

  useEffect(() => {
    if (!container.current || map.current) return;
    setWorkerUrl("/maplibre-gl-worker.mjs");
    const m = new MLMap({ container: container.current, style: BASE_STYLE, center: [77, 11], zoom: 6, attributionControl: false });
    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.on("load", async () => {
      m.addSource("land", { type: "geojson", data: EMPTY });
      m.addSource("states", { type: "geojson", data: EMPTY });
      m.addSource("region", { type: "geojson", data: EMPTY });
      m.addSource("records", { type: "geojson", data: EMPTY });
      m.addSource("selected", { type: "geojson", data: EMPTY });
      m.addLayer({ id: "land-fill", type: "fill", source: "land", paint: { "fill-color": "#d9ebb0" } });
      m.addLayer({ id: "land-line", type: "line", source: "land", paint: { "line-color": "#8fb3a0", "line-width": 0.7 } });
      m.addLayer({ id: "states-fill", type: "fill", source: "states", paint: { "fill-color": ["case", ["==", ["get", "operational"], 1], "#53a8ea", "#e4f0d2"], "fill-opacity": ["case", ["==", ["get", "operational"], 1], 0.12, 0.35] } });
      m.addLayer({ id: "states-line", type: "line", source: "states", paint: { "line-color": ["case", ["==", ["get", "operational"], 1], "#53a8ea", "#8fb3a0"], "line-width": ["case", ["==", ["get", "operational"], 1], 1.6, 0.6] } });
      m.addLayer({ id: "region-fill", type: "fill", source: "region", paint: { "fill-color": "#53a8ea", "fill-opacity": 0.04 } });
      m.addLayer({ id: "region-line", type: "line", source: "region", paint: { "line-color": "#53a8ea", "line-width": 1.2, "line-dasharray": [3, 2], "line-opacity": 0.7 } });
      m.addLayer({
        id: "records-circle", type: "circle", source: "records",
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.5, 9, 6.5], "circle-color": ["get", "color"], "circle-stroke-color": "#eef6fb", "circle-stroke-width": 1.4 },
      });
      m.addLayer({ id: "selected-ring", type: "circle", source: "selected", paint: { "circle-radius": 12, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#e8f1ec", "circle-stroke-width": 2 } });
      m.on("click", "records-circle", (e) => {
        const id = e.features?.[0]?.properties?.gbif_id;
        if (typeof id === "string") onSelectRef.current(id);
      });
      m.on("mousemove", "records-circle", (e) => {
        m.getCanvas().style.cursor = "pointer";
        setHover(String(e.features?.[0]?.properties?.gbif_id ?? ""));
      });
      m.on("mouseleave", "records-circle", () => { m.getCanvas().style.cursor = ""; setHover(null); });
      try {
        const st = await fetch(STATES_URL);
        if (st.ok) {
          const fc = await st.json();
          for (const f of fc.features) f.properties.operational = OPERATIONAL.has(f.properties.name) ? 1 : 0;
          (m.getSource("states") as GeoJSONSource).setData(fc);
        }
      } catch { /* boundaries are optional context */ }
      try {
        const res = await fetch(landUrl);
        if (res.ok) (m.getSource("land") as GeoJSONSource).setData(await res.json());
      } catch { /* the land outline is optional context */ }
      setIsReady(true);
    });
    return () => { marker.current?.remove(); m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Satellite raster: the browser asks this origin for tiles; the server proxies the provider.
  useEffect(() => {
    const m = map.current;
    if (!m || !isReady || !satelliteAvailable || m.getSource("satellite")) return;
    m.addSource("satellite", {
      type: "raster",
      tiles: [`${window.location.origin}/api/tiles/satellite/{z}/{x}/{y}`],
      tileSize: 256,
      maxzoom: 18,
    });
    m.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" }, paint: { "raster-opacity": 0.95 } }, "land-fill");
  }, [isReady, satelliteAvailable]);

  useEffect(() => {
    const m = map.current;
    if (!m || !isReady) return;
    const sat = basemap === "satellite" && satelliteAvailable;
    if (m.getLayer("satellite")) m.setLayoutProperty("satellite", "visibility", sat ? "visible" : "none");
    for (const id of ["land-fill", "land-line"]) m.setLayoutProperty(id, "visibility", sat ? "none" : "visible");
  }, [basemap, satelliteAvailable, isReady]);

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
      features: records.filter(drawable).map((r) => {
        const cls = classes[r.gbif_id] ?? "usable";
        return { type: "Feature", geometry: { type: "Point", coordinates: [r.lon, r.lat] }, properties: { gbif_id: r.gbif_id, class: cls, color: CLASS_HEX[cls] } };
      }),
    };
    (m.getSource("records") as GeoJSONSource).setData(fc);
  }, [records, classes, isReady]);

  useEffect(() => {
    const m = map.current;
    if (!m || !isReady) return;
    const sel = records.find((r) => r.gbif_id === selectedId);
    (m.getSource("selected") as GeoJSONSource).setData(sel && drawable(sel)
      ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [sel.lon, sel.lat] }, properties: {} }] }
      : EMPTY);
    if (sel && drawable(sel)) m.easeTo({ center: [sel.lon, sel.lat], duration: 500, zoom: Math.max(m.getZoom(), 7.5) });
  }, [selectedId, records, isReady]);

  useEffect(() => {
    const m = map.current;
    if (!m || !isReady) return;
    marker.current?.remove();
    marker.current = null;
    if (declared) {
      const el = document.createElement("div");
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", `Declared collection point: ${declared.name}`);
      el.title = `Declared point: ${declared.name} (${declared.lat}, ${declared.lon})`;
      el.style.cssText = "width:14px;height:14px;background:#e8f1ec;transform:rotate(45deg);box-shadow:0 0 0 4px rgba(232,241,236,.18), 0 0 18px rgba(232,241,236,.6)";
      marker.current = new Marker({ element: el }).setLngLat([declared.lon, declared.lat]).addTo(m);
    }
    const pts: [number, number][] = [];
    if (declared) pts.push([declared.lon, declared.lat]);
    for (const r of records) if (drawable(r)) pts.push([r.lon, r.lat]);
    if (pts.length) {
      const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]), pad = 0.35;
      m.fitBounds([[Math.min(...lons) - pad, Math.min(...lats) - pad], [Math.max(...lons) + pad, Math.max(...lats) + pad]], { padding: 48, duration: 500, maxZoom: 7.5 });
    }
  }, [declared, records, isReady]);

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded-2xl border border-edge bg-canvas">
      <div ref={container} className="absolute inset-0" style={{ position: "absolute", inset: 0 }} role="application" aria-label="Map of the declared batch location and retrieved GBIF occurrence records" />

      <div className="absolute left-3 top-3 flex items-center gap-1 rounded-xl border border-edge bg-white/95 p-1 text-[12px] backdrop-blur" role="group" aria-label="Basemap">
        <button type="button" onClick={() => setBasemap("context")} aria-pressed={basemap === "context"} className={`rounded-lg px-3 py-1.5 font-medium ${basemap === "context" ? "bg-brand text-white" : "text-fg2 hover:text-fg"}`}>Context</button>
        <button type="button" onClick={() => satelliteAvailable && setBasemap("satellite")} aria-pressed={basemap === "satellite"} disabled={!satelliteAvailable}
          title={satelliteAvailable ? "Satellite imagery, proxied by the server" : "Satellite imagery is not configured on this server"}
          className={`rounded-lg px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-45 ${basemap === "satellite" ? "bg-brand text-white" : "text-fg2 hover:text-fg"}`}>
          Satellite{satelliteAvailable ? "" : " (not configured)"}
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 max-w-[300px] rounded-xl border border-edge bg-white/95 p-3 text-[11.5px] text-fg2 backdrop-blur">
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1.5">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rotate-45 bg-fg" />Declared point</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t border-dashed border-brand" />Approximate region</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {(["usable", "usable_with_caution", "insufficient_for_spatial_check", "invalid", "duplicate"] as const).map((c) => (
            <span key={c} className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: CLASS_HEX[c] }} />{c.replaceAll("_", " ")}</span>
          ))}
        </div>
        <div className="mt-2 text-fg3">Boundaries: Natural Earth 50m (public domain). Kerala and Tamil Nadu highlighted.<br />{drawableCount} plotted{undrawn > 0 ? ` · ${undrawn} without mappable coordinates (see table)` : ""}. No third-party requests from the browser.</div>
      </div>

      {hover ? <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg bg-white/95 px-2.5 py-1 font-mono text-[11px] text-fg2">record {hover}</div> : null}
      {records.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded-xl border border-edge bg-white/95 px-4 py-3 text-center text-[13px] text-fg2">
          No occurrence records on the map yet.<br /><span className="text-fg3">Run the audit to retrieve them.</span>
        </div>
      ) : null}
    </div>
  );
}
