"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { Map as MLMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent, type StyleSpecification } from "maplibre-gl";
import type { Bbox, Candidate } from "@/lib/types";

export type ColorBy = "priority_score" | "gap_score" | "raw_records";

export interface Layers {
  grid: boolean;
  occurrences: boolean;
  candidates: boolean;
}

interface Props {
  bbox: Bbox | null;
  grid: GeoJSON.FeatureCollection | null;
  occurrences: GeoJSON.FeatureCollection | null;
  candidates: Candidate[];
  colorBy: ColorBy;
  layers: Layers;
  planned: string[];
  selectedCell: string | null;
  onSelectCell: (cell: string) => void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#070d0b" } },
    { id: "basemap", type: "raster", source: "osm", paint: { "raster-opacity": 0.3 } },
  ],
};

/** Normalise the chosen metric to [0,1] so one colour ramp serves every metric. */
function withNormalised(fc: GeoJSON.FeatureCollection | null, key: ColorBy, planned: Set<string>): GeoJSON.FeatureCollection {
  if (!fc) return EMPTY;
  const values = fc.features.map((f) => Number(f.properties?.[key] ?? 0));
  const max = Math.max(...values, 1e-9);
  return {
    ...fc,
    features: fc.features.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        v: Math.min(1, Number(f.properties?.[key] ?? 0) / (key === "raw_records" ? max : 1)),
        planned: planned.has(String(f.properties?.cell)) ? 1 : 0,
      },
    })),
  };
}

export default function MapPanel(props: Props) {
  const { bbox, grid, occurrences, candidates, colorBy, layers, planned, selectedCell, onSelectCell } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const readyRef = useRef(false);
  const onSelectRef = useRef(onSelectCell);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  onSelectRef.current = onSelectCell;

  // Initialise once.
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    setWorkerUrl("/maplibre-gl-worker.mjs");
    const map = new MLMap({
      container: container.current,
      style: STYLE,
      center: [76.5, 10.5],
      zoom: 5,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("grid", { type: "geojson", data: EMPTY });
      map.addSource("occ", { type: "geojson", data: EMPTY });
      map.addSource("cands", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "grid-fill",
        type: "fill",
        source: "grid",
        paint: {
          "fill-color": ["interpolate", ["linear"], ["get", "v"], 0, "#12302a", 0.4, "#2f7d6d", 0.7, "#d19a2b", 1, "#e0452f"],
          "fill-opacity": ["case", ["==", ["get", "planned"], 1], 0.85, 0.55],
        },
      });
      map.addLayer({ id: "grid-line", type: "line", source: "grid", paint: { "line-color": "#0f172a", "line-width": 0.6 } });
      map.addLayer({
        id: "grid-selected",
        type: "line",
        source: "grid",
        filter: ["==", ["get", "cell"], ""],
        paint: { "line-color": "#f8fafc", "line-width": 2.5 },
      });
      map.addLayer({
        id: "occ-points",
        type: "circle",
        source: "occ",
        paint: {
          "circle-radius": 3.5,
          "circle-color": ["match", ["get", "quality_status"], "clean", "#67e8f9", "questionable", "#fbbf24", "#94a3b8"],
          "circle-stroke-color": "#020617",
          "circle-stroke-width": 0.8,
        },
      });
      map.addLayer({
        id: "cand-points",
        type: "circle",
        source: "cands",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "rank"], 1, 11, 20, 7],
          "circle-color": "#f472b6",
          "circle-stroke-color": "#fdf2f8",
          "circle-stroke-width": 2,
        },
      });
      map.on("click", "grid-fill", (e: MapLayerMouseEvent) => {
        const cell = e.features?.[0]?.properties?.cell;
        if (typeof cell === "string") onSelectRef.current(cell);
      });
      map.on("mousemove", "grid-fill", (e: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = "pointer";
        setHover(String(e.features?.[0]?.properties?.cell ?? ""));
      });
      map.on("mouseleave", "grid-fill", () => {
        map.getCanvas().style.cursor = "";
        setHover(null);
      });
      readyRef.current = true;
      setReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // Push data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("grid") as GeoJSONSource).setData(withNormalised(grid, colorBy, new Set(planned)));
  }, [grid, colorBy, planned, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("occ") as GeoJSONSource).setData(occurrences ?? EMPTY);
  }, [occurrences, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: candidates.map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.center_lon, c.center_lat] },
        properties: { rank: c.rank, cell: c.cell, priority: c.priority_score },
      })),
    };
    (map.getSource("cands") as GeoJSONSource).setData(fc);
  }, [candidates, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setFilter("grid-selected", ["==", ["get", "cell"], selectedCell ?? ""]);
  }, [selectedCell, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const vis = (on: boolean) => (on ? "visible" : "none");
    map.setLayoutProperty("grid-fill", "visibility", vis(layers.grid));
    map.setLayoutProperty("grid-line", "visibility", vis(layers.grid));
    map.setLayoutProperty("grid-selected", "visibility", vis(layers.grid));
    map.setLayoutProperty("occ-points", "visibility", vis(layers.occurrences));
    map.setLayoutProperty("cand-points", "visibility", vis(layers.candidates));
  }, [layers, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !bbox) return;
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 600, maxZoom: 9 });
  }, [bbox, ready]);

  return (
    <div className="relative h-[60vh] min-h-[360px] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <div ref={container} style={{ position: "absolute", inset: 0 }} role="application" aria-label="Interactive occurrence and survey-priority map" />
      <div className="pointer-events-none absolute left-3 top-3 hidden space-y-2 rounded-lg bg-slate-950/85 p-3 text-xs text-slate-200 shadow md:block">
        <div className="font-semibold text-slate-100">Legend</div>
        <div className="flex items-center gap-2"><span className="inline-block h-3 w-6 rounded-sm bg-gradient-to-r from-[#12302a] via-[#d19a2b] to-[#e0452f]" />Survey priority / metric (low → high)</div>
        <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#67e8f9]" />Clean occurrence</div>
        <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />Questionable occurrence</div>
        <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f472b6]" />Ranked survey candidate</div>
        <div className="text-slate-400">Click a grid cell to inspect it.</div>
      </div>
      {hover ? (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-slate-950/90 px-2 py-1 font-mono text-xs text-slate-300">cell {hover}</div>
      ) : null}
      {!grid ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto w-fit rounded bg-slate-950/90 px-3 py-2 text-sm text-slate-300">
          No analysis loaded. Run one in Species Explorer.
        </div>
      ) : null}
    </div>
  );
}
