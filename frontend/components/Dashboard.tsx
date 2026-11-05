"use client";

import { useCallback, useEffect, useState } from "react";
import { api, describeError, type ApiErrorBody } from "@/lib/api";
import type { BenchmarkResult, Bbox, Health, Region, ResolvedSpecies, RunListItem, SimulationResult, Summary } from "@/lib/types";
import MapPanel, { type ColorBy, type Layers } from "@/components/MapPanel";
import { Banner } from "@/components/ui";
import { OverviewSection, SpeciesSection, SpatialSection, PlannerSection, EvidenceSection } from "@/components/Sections";
import { parseBbox } from "@/lib/bbox";

export type SectionId = "overview" | "species" | "spatial" | "planner" | "evidence";
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "species", label: "Species Explorer" },
  { id: "spatial", label: "Spatial Intelligence" },
  { id: "planner", label: "Survey Planner" },
  { id: "evidence", label: "Evidence & Reports" },
];

export interface FormState {
  species: string;
  bbox: [string, string, string, string];
  resolution: number;
  maxRecords: number;
  uncertaintyM: number;
}

const DEFAULT_BBOX: [string, string, string, string] = ["74.8", "8.1", "77.5", "12.8"];

export interface Notice {
  title: string;
  detail: string;
  suggestions?: ApiErrorBody["suggestions"];
  tone: "error" | "warn";
}

export default function Dashboard() {
  const [section, setSection] = useState<SectionId>("overview");
  const [health, setHealth] = useState<Health | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [grid, setGrid] = useState<GeoJSON.FeatureCollection | null>(null);
  const [occurrences, setOccurrences] = useState<GeoJSON.FeatureCollection | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ species: "Withania somnifera", bbox: DEFAULT_BBOX, resolution: 5, maxRecords: 3000, uncertaintyM: 5000 });
  const [resolved, setResolved] = useState<ResolvedSpecies | null>(null);
  const [colorBy, setColorBy] = useState<ColorBy>("priority_score");
  const [layers, setLayers] = useState<Layers>({ grid: true, occurrences: true, candidates: true });
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [planned, setPlanned] = useState<string[]>([]);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  const fail = useCallback((e: unknown, tone: Notice["tone"] = "error") => {
    const d = describeError(e);
    setNotice({ ...d, tone });
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api.health());
    } catch (e) {
      setHealth(null);
      fail(e, "warn");
    }
  }, [fail]);

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await api.listRuns());
    } catch (e) {
      fail(e, "warn");
    }
  }, [fail]);

  useEffect(() => {
    refreshHealth();
    refreshRuns();
    api.regions().then(setRegions).catch(() => setRegions([]));
  }, [refreshHealth, refreshRuns]);

  const loadRun = useCallback(
    async (id: string) => {
      setBusy("loading run");
      try {
        const [s, g, o, b] = await Promise.all([api.getRun(id), api.getGrid(id), api.getOccurrences(id), api.getBenchmark(id)]);
        setSummary(s);
        setGrid(g);
        setOccurrences(o);
        setBenchmark(b);
        setSelectedCell(null);
        setPlanned([]);
        setSimulation(null);
        setForm((f) => ({ ...f, species: s.request.species, bbox: s.request.bbox.map(String) as FormState["bbox"], resolution: s.request.resolution, maxRecords: s.request.max_records, uncertaintyM: s.request.uncertainty_threshold_m }));
        setNotice(null);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [fail],
  );

  useEffect(() => {
    if (runId) loadRun(runId);
  }, [runId, loadRun]);

  const onResolve = async () => {
    setBusy("resolving species");
    setResolved(null);
    try {
      setResolved(await api.resolveSpecies(form.species.trim()));
      setNotice(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const onRunAnalysis = async () => {
    const bbox = parseBbox(form.bbox);
    if (typeof bbox === "string") {
      setNotice({ title: "Check the study region", detail: bbox, tone: "error" });
      return;
    }
    setBusy("running analysis against GBIF (this can take a minute)");
    try {
      const created = await api.createAnalysis({
        species: form.species.trim(),
        bbox,
        resolution: form.resolution,
        max_records: form.maxRecords,
        uncertainty_threshold_m: form.uncertaintyM,
        include_protected: true,
      });
      await refreshRuns();
      setRunId(created.run_id);
      setSection("overview");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const onBenchmark = async (params: { seeds: number; k_values: number[]; fault_rate: number }) => {
    if (!runId) return;
    setBusy("running benchmarks");
    try {
      setBenchmark(await api.runBenchmark(runId, { ...params, test_fraction: 0.3, coverage_radius_km: 50 }));
      setNotice(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const onSimulate = async (params: { detection_probability: number; visits: number; occupancy_scenarios: number[] }) => {
    if (!runId || planned.length === 0) return;
    setBusy("simulating survey plan");
    try {
      setSimulation(await api.simulate(runId, { ...params, cell_ids: planned }));
      setNotice(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const togglePlanned = (cell: string) =>
    setPlanned((p) => (p.includes(cell) ? p.filter((c) => c !== cell) : [...p, cell]));

  const isSynthetic = summary?.data_source_kind !== undefined && summary.data_source_kind !== "gbif";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/95">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-lg font-semibold tracking-tight">VanaSignal</div>
            <div className="text-xs text-slate-400">Medicinal-plant occurrence gaps, data quality and survey priorities</div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {health ? (
              <span className={`rounded px-2 py-1 ${health.gbif.reachable ? "bg-emerald-900/70 text-emerald-200" : "bg-rose-900/70 text-rose-200"}`}>
                GBIF {health.gbif.reachable ? "reachable" : "unreachable"}
              </span>
            ) : (
              <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">API status unknown</span>
            )}
            <button type="button" onClick={refreshHealth} className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800">
              Refresh status
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4">
        {busy ? (
          <div role="status" aria-live="polite" className="rounded-lg border border-sky-800 bg-sky-950/50 px-4 py-2 text-sm text-sky-100">
            Working: {busy}…
          </div>
        ) : null}
        {notice ? (
          <div className="space-y-2">
            <Banner tone={notice.tone === "warn" ? "warn" : "error"} title={notice.title}>
              {notice.detail}
              {notice.suggestions?.length ? (
                <ul className="mt-2 list-disc pl-5">
                  {notice.suggestions.slice(0, 6).map((s) => (
                    <li key={s.key}>
                      <button type="button" className="underline" onClick={() => setForm((f) => ({ ...f, species: s.scientific_name }))}>
                        {s.scientific_name}
                      </button>{" "}
                      <span className="opacity-70">({s.rank ?? "rank unknown"}, {s.status ?? "status unknown"})</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Banner>
          </div>
        ) : null}
        {isSynthetic ? (
          <Banner tone="synthetic" title="Non-GBIF data: this run is not a live GBIF analysis">
            Data source recorded as “{summary?.data_source_kind}”. Do not use these results as occurrence evidence.
          </Banner>
        ) : null}

        <MapPanel
          bbox={summary?.request.bbox ?? null}
          grid={grid}
          occurrences={occurrences}
          candidates={summary?.candidates ?? []}
          colorBy={colorBy}
          layers={layers}
          planned={planned}
          selectedCell={selectedCell}
          onSelectCell={(c) => {
            setSelectedCell(c);
            setSection("planner");
          }}
        />
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300" role="group" aria-label="Map layers and colouring">
          <span className="text-slate-400">Colour grid by:</span>
          {(["priority_score", "gap_score", "raw_records"] as ColorBy[]).map((c) => (
            <label key={c} className="flex items-center gap-1">
              <input type="radio" name="colorBy" checked={colorBy === c} onChange={() => setColorBy(c)} />
              {c.replace("_", " ")}
            </label>
          ))}
          <span className="ml-4 text-slate-400">Layers:</span>
          {(Object.keys(layers) as (keyof Layers)[]).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers((l) => ({ ...l, [k]: e.target.checked }))} />
              {k}
            </label>
          ))}
          {selectedCell ? (
            <span className="ml-auto font-mono text-slate-400">Selected cell {selectedCell}</span>
          ) : null}
        </div>

        <nav aria-label="Dashboard sections" className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm ${section === s.id ? "bg-emerald-700 text-white" : "text-slate-300 hover:bg-slate-800"}`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {section === "overview" ? (
          <OverviewSection summary={summary} runs={runs} health={health} onOpenRun={setRunId} activeRunId={runId} />
        ) : null}
        {section === "species" ? (
          <SpeciesSection
            form={form}
            setForm={setForm}
            regions={regions}
            resolved={resolved}
            onResolve={onResolve}
            onRun={onRunAnalysis}
            busy={busy}
            summary={summary}
            occurrences={occurrences}
          />
        ) : null}
        {section === "spatial" ? <SpatialSection summary={summary} benchmark={benchmark} onBenchmark={onBenchmark} busy={busy} /> : null}
        {section === "planner" ? (
          <PlannerSection
            summary={summary}
            planned={planned}
            togglePlanned={togglePlanned}
            clearPlanned={() => setPlanned([])}
            selectedCell={selectedCell}
            onSelectCell={setSelectedCell}
            simulation={simulation}
            onSimulate={onSimulate}
            busy={busy}
          />
        ) : null}
        {section === "evidence" ? <EvidenceSection summary={summary} runs={runs} onOpenRun={setRunId} /> : null}
      </main>
    </div>
  );
}
