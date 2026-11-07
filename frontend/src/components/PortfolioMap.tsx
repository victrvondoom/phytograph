import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Map as MLMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { BatchRead, OriginStatus } from "../lib/types";
import { ORIGIN_LABEL } from "../lib/labels";

const STATUS_HEX: Record<OriginStatus | "none", string> = {
  CORROBORATED: "#4fd1a5",
  LOCATION_CONFLICT: "#ff6b6b",
  INSUFFICIENT_PUBLIC_RECORDS: "#f2b65a",
  IDENTITY_UNRESOLVED: "#a99bff",
  NOT_CHECKED: "#7e93b5",
  none: "#7e93b5",
};
const STYLE: StyleSpecification = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef6fb" } }] };
const OPERATIONAL = new Set(["Kerala", "Tamil Nadu"]);

/** Every batch's DECLARED point over the real state boundaries. Colour = latest audited origin status, nothing else. */
export default function PortfolioMap({ batches }: { batches: BatchRead[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;

  useEffect(() => {
    if (!el.current || map.current) return;
    setWorkerUrl("/maplibre-gl-worker.mjs");
    const m = new MLMap({ container: el.current, style: STYLE, center: [77, 11], zoom: 4.6, attributionControl: false });
    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.on("load", async () => {
      m.addSource("states", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("batches", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "states-fill", type: "fill", source: "states", paint: { "fill-color": ["case", ["==", ["get", "operational"], 1], "#53a8ea", "#e4f0d2"], "fill-opacity": ["case", ["==", ["get", "operational"], 1], 0.18, 0.5] } });
      m.addLayer({ id: "states-line", type: "line", source: "states", paint: { "line-color": ["case", ["==", ["get", "operational"], 1], "#53a8ea", "#8fb3a0"], "line-width": ["case", ["==", ["get", "operational"], 1], 1.6, 0.6] } });
      m.addLayer({ id: "batch-dot", type: "circle", source: "batches", paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#eef6fb", "circle-stroke-width": 2 } });
      m.on("click", "batch-dot", (e) => {
        const id = e.features?.[0]?.properties?.batch_id;
        if (typeof id === "string") navRef.current(`/batches/${encodeURIComponent(id)}/audit`);
      });
      m.on("mouseenter", "batch-dot", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "batch-dot", () => (m.getCanvas().style.cursor = ""));
      try {
        const res = await fetch("/api/context/india-states");
        if (res.ok) {
          const fc = await res.json();
          for (const f of fc.features) f.properties.operational = OPERATIONAL.has(f.properties.name) ? 1 : 0;
          (m.getSource("states") as GeoJSONSource).setData(fc);
        }
      } catch { /* optional */ }
      ready.current = true;
      push(m, batches);
    });
    return () => { m.remove(); map.current = null; ready.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (map.current && ready.current) push(map.current, batches);
  }, [batches]);

  return (
    <div className="relative h-[380px] w-full overflow-hidden rounded-2xl border border-edge bg-canvas">
      <div ref={el} className="absolute inset-0" style={{ position: "absolute", inset: 0 }} role="application" aria-label="Map of declared batch locations coloured by origin status" />
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-4 gap-y-1.5 rounded-xl border border-edge bg-white/95 px-3 py-2 text-[11.5px] text-fg2">
        {(["CORROBORATED", "LOCATION_CONFLICT", "INSUFFICIENT_PUBLIC_RECORDS", "IDENTITY_UNRESOLVED", "NOT_CHECKED", "none"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STATUS_HEX[k] }} />{k === "none" ? "Not audited" : ORIGIN_LABEL[k]}</span>
        ))}
      </div>
    </div>
  );
}

function push(m: MLMap, batches: BatchRead[]) {
  const features = batches
    .filter((b) => b.latitude !== null && b.longitude !== null)
    .map((b) => {
      const st = (b.latest_audit?.origin_status ?? "none") as OriginStatus | "none";
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [b.longitude as number, b.latitude as number] },
        properties: { batch_id: b.batch_id, color: STATUS_HEX[st] ?? STATUS_HEX.none },
      };
    });
  (m.getSource("batches") as GeoJSONSource).setData({ type: "FeatureCollection", features });
}
