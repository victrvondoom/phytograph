"use client";

import { useEffect, useMemo, useState } from "react";
import { api, API_BASE } from "@/lib/api";
import type { BenchmarkResult, Health, Region, ResolvedSpecies, RunListItem, SimulationResult, Summary, OccurrenceFeature } from "@/lib/types";
import type { FormState } from "@/components/Dashboard";
import { parseBbox } from "@/lib/bbox";
import { Badge, Banner, Panel, Stat, Table, meanSd, num, pct } from "@/components/ui";

const SCIENCE_NOTE =
  "Scores rank where a survey would add information. They are not ecological probabilities, do not estimate occupancy, and a missing record is not an absence.";

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400">{children}</p>;
}

/* ------------------------------------------------------------------ Overview */
export function OverviewSection({
  summary,
  runs,
  health,
  onOpenRun,
  activeRunId,
}: {
  summary: Summary | null;
  runs: RunListItem[];
  health: Health | null;
  onOpenRun: (id: string) => void;
  activeRunId: string | null;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Current analysis" id="overview" actions={summary ? <Badge tone={summary.data_source_kind === "gbif" ? "good" : "bad"}>{summary.data_source_kind === "gbif" ? "Live GBIF" : "Not GBIF"}</Badge> : null}>
        {!summary ? (
          <Empty>No analysis loaded. Use Species Explorer to resolve a species and run an analysis against GBIF.</Empty>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-lg font-semibold italic">{summary.resolved_species.scientific_name}</div>
              <div className="text-xs text-slate-400">
                Run <span className="font-mono">{summary.run_id}</span> · {new Date(summary.created_at).toLocaleString()}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Usable records" value={summary.quality_audit.records_usable} hint={`of ${summary.quality_audit.records_total} retrieved`} />
              <Stat label="Occupied cells" value={pct(summary.coverage.occupied_share)} hint={`${summary.coverage.occupied_cells} of ${summary.coverage.total_cells}`} />
              <Stat label="Unsurveyed cells" value={summary.coverage.unsurveyed_cells} hint="No usable record" tone="warn" />
              <Stat label="Top priority" value={summary.candidates[0] ? summary.candidates[0].priority_score.toFixed(3) : "n/a"} hint="Survey information gain" />
            </div>
            <p className="text-xs text-slate-400">{SCIENCE_NOTE}</p>
          </div>
        )}
      </Panel>

      <Panel title="Warnings and limitations">
        {!summary ? (
          <Empty>Warnings appear here for each analysis.</Empty>
        ) : summary.warnings.length === 0 ? (
          <Empty>No warnings were produced for this run.</Empty>
        ) : (
          <ul className="list-disc space-y-2 pl-5 text-sm text-amber-100">
            {summary.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Service status">
        <ul className="space-y-2 text-sm text-slate-300">
          <li>
            GBIF:{" "}
            {health?.gbif.reachable ? <Badge tone="good">reachable</Badge> : <Badge tone="bad">unreachable</Badge>}
            {health?.gbif.error ? <div className="mt-1 text-xs text-rose-300">{health.gbif.error}</div> : null}
          </li>
          <li>Land mask: {health?.land_mask_configured ? <Badge tone="good">loaded</Badge> : <Badge tone="warn">missing</Badge>}</li>
          <li>
            Protected areas:{" "}
            {health?.protected_areas_configured ? <Badge tone="good">configured</Badge> : <Badge tone="neutral">not configured</Badge>}
          </li>
          <li className="text-xs text-slate-500">API {API_BASE}</li>
        </ul>
      </Panel>

      <Panel title="Stored analyses" id="runs" actions={<span className="text-xs text-slate-400">{runs.length} stored</span>}>
        {runs.length === 0 ? (
          <Empty>No analyses are stored yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-800">
            {runs.map((r) => (
              <li key={r.run_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <div className="italic">{r.species}</div>
                  <div className="text-xs text-slate-400">
                    {new Date(r.created_at).toLocaleString()} · {r.records_usable} usable · {r.data_source_kind ?? "unknown source"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenRun(r.run_id)}
                  aria-pressed={activeRunId === r.run_id}
                  className={`rounded px-2 py-1 text-xs ${activeRunId === r.run_id ? "bg-emerald-700 text-white" : "border border-slate-700 text-slate-200 hover:bg-slate-800"}`}
                >
                  {activeRunId === r.run_id ? "Open" : "Load"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------- Species Explorer */
export function SpeciesSection({
  form,
  setForm,
  regions,
  resolved,
  onResolve,
  onRun,
  busy,
  summary,
  occurrences,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  regions: Region[];
  resolved: ResolvedSpecies | null;
  onResolve: () => void;
  onRun: () => void;
  busy: string | null;
  summary: Summary | null;
  occurrences: GeoJSON.FeatureCollection | null;
}) {
  const bboxCheck = parseBbox(form.bbox);
  const flagged = useMemo(
    () =>
      ((occurrences?.features ?? []) as unknown as OccurrenceFeature[])
        .filter((f) => f.properties.quality_status !== "clean")
        .slice(0, 25),
    [occurrences],
  );
  const audit = summary?.quality_audit;
  const working = busy !== null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Species and region" id="species">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onRun();
          }}
        >
          <div>
            <label htmlFor="species" className="text-sm text-slate-300">Scientific name</label>
            <div className="mt-1 flex gap-2">
              <input
                id="species"
                value={form.species}
                onChange={(e) => setForm((f) => ({ ...f, species: e.target.value }))}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                placeholder="e.g. Withania somnifera"
                minLength={3}
                required
              />
              <button type="button" onClick={onResolve} disabled={working || form.species.trim().length < 3} className="rounded bg-slate-700 px-3 text-sm hover:bg-slate-600 disabled:opacity-50">
                Resolve
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Use the scientific name. Common names are not resolved, so check the match before running.</p>
          </div>

          {resolved ? (
            <div className="rounded border border-slate-800 bg-slate-950/60 p-3 text-sm">
              <div className="italic">{resolved.scientific_name}</div>
              <div className="text-xs text-slate-400">
                Accepted key {resolved.accepted_key} · match {resolved.match_type}
                {resolved.confidence !== null ? ` (confidence ${resolved.confidence})` : ""} · status {resolved.status ?? "unknown"}
              </div>
              {resolved.warnings.map((w, i) => (
                <div key={i} className="mt-2 text-xs text-amber-200">{w}</div>
              ))}
            </div>
          ) : null}

          <div>
            <label htmlFor="region" className="text-sm text-slate-300">Study region preset</label>
            <select
              id="region"
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value=""
              onChange={(e) => {
                const r = regions.find((x) => x.id === e.target.value);
                if (r) setForm((f) => ({ ...f, bbox: r.bbox.map(String) as FormState["bbox"] }));
              }}
            >
              <option value="">Choose a preset (approximate boxes)…</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="text-sm text-slate-300">Bounding box (min lon, min lat, max lon, max lat)</legend>
            <div className="mt-1 grid grid-cols-4 gap-2">
              {(["min lon", "min lat", "max lon", "max lat"] as const).map((label, i) => (
                <input
                  key={label}
                  aria-label={label}
                  inputMode="decimal"
                  value={form.bbox[i]}
                  onChange={(e) => setForm((f) => {
                    const next = [...f.bbox] as FormState["bbox"];
                    next[i] = e.target.value;
                    return { ...f, bbox: next };
                  })}
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-sm tabular-nums"
                />
              ))}
            </div>
            {typeof bboxCheck === "string" ? <p className="mt-1 text-xs text-rose-300">{bboxCheck}</p> : null}
          </fieldset>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <label className="space-y-1">
              <span className="text-slate-300">H3 resolution</span>
              <select className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2" value={form.resolution} onChange={(e) => setForm((f) => ({ ...f, resolution: Number(e.target.value) }))}>
                {[4, 5, 6].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-slate-300">Max records</span>
              <input type="number" min={10} max={20000} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2" value={form.maxRecords} onChange={(e) => setForm((f) => ({ ...f, maxRecords: Number(e.target.value) }))} />
            </label>
            <label className="space-y-1">
              <span className="text-slate-300">Uncertainty (m)</span>
              <input type="number" min={1} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2" value={form.uncertaintyM} onChange={(e) => setForm((f) => ({ ...f, uncertaintyM: Number(e.target.value) }))} />
            </label>
          </div>

          <button type="submit" disabled={working || typeof bboxCheck === "string"} className="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            Run analysis against GBIF
          </button>
          <p className="text-xs text-slate-500">Runs call the live GBIF API through the server. Responses are cached with their URLs for reproducibility.</p>
        </form>
      </Panel>

      <Panel title="Occurrence quality audit" id="quality">
        {!audit ? (
          <Empty>Run an analysis to audit its occurrence records.</Empty>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Clean" value={audit.status_counts.clean ?? 0} tone="good" />
              <Stat label="Questionable" value={audit.status_counts.questionable ?? 0} tone="warn" hint="Kept at 0.5 weight" />
              <Stat label="Excluded" value={audit.status_counts.excluded ?? 0} tone="warn" hint="Not spatially usable" />
            </div>
            <Table
              caption="Flag counts"
              headers={["Flag", "Records"]}
              rows={Object.entries(audit.flag_counts).filter(([, v]) => v > 0).map(([k, v]) => [k.replace(/_/g, " "), v])}
            />
            <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
              <div>Distinct datasets: <span className="tabular-nums">{audit.distinct_datasets}</span></div>
              <div>Median uncertainty: {audit.uncertainty_median_m ?? "n/a"} m</div>
              <div>Licences: {Object.entries(audit.license_counts).map(([k, v]) => `${k} (${v})`).join(", ") || "none"}</div>
              <div>Years: {audit.year_range ? `${audit.year_range[0]}–${audit.year_range[1]}` : "n/a"}</div>
            </div>
            {audit.top_gbif_issues.length ? (
              <Table caption="GBIF issue codes" headers={["GBIF issue", "Count"]} rows={audit.top_gbif_issues.map((i) => [i.issue, i.count])} />
            ) : null}
            {audit.warnings.map((w, i) => (
              <Banner key={i} tone="warn" title="Data-quality warning">{w}</Banner>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Flagged occurrences (sample)" id="flagged">
        {flagged.length === 0 ? (
          <Empty>{summary ? "No flagged records in the displayed sample." : "Run an analysis to inspect flagged records."}</Empty>
        ) : (
          <Table
            caption="Flagged records"
            headers={["GBIF id", "Status", "Reasons", "Date", "Dataset", "Licence"]}
            rows={flagged.map((f) => [
              <span key="id" className="font-mono text-xs">{f.properties.gbif_id}</span>,
              f.properties.quality_status,
              f.properties.quality_reasons,
              f.properties.event_date ?? "n/a",
              f.properties.dataset_name ?? "n/a",
              f.properties.license ?? "n/a",
            ])}
          />
        )}
      </Panel>

      <Panel title="Retrieval counts" id="retrieval">
        {!summary ? (
          <Empty>Counts appear after an analysis.</Empty>
        ) : (
          <div className="space-y-3 text-sm text-slate-300">
            <div>GBIF present records in region: <span className="tabular-nums">{summary.gbif_total_count ?? "n/a"}</span></div>
            <div>Records retrieved for analysis: <span className="tabular-nums">{summary.quality_audit.records_total}</span></div>
            <div>Absence records in region (reported separately, not used as absence): <span className="tabular-nums">{summary.absence_and_coordinate_counts.absent_records_with_coordinates_in_region ?? "n/a"}</span></div>
            <div>Present records without coordinates (species-wide): <span className="tabular-nums">{summary.absence_and_coordinate_counts.present_records_without_coordinates_species_wide ?? "n/a"}</span></div>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------ Spatial Intelligence */
export function SpatialSection({
  summary,
  benchmark,
  onBenchmark,
  busy,
}: {
  summary: Summary | null;
  benchmark: BenchmarkResult | null;
  onBenchmark: (p: { seeds: number; k_values: number[]; fault_rate: number }) => void;
  busy: string | null;
}) {
  const [seeds, setSeeds] = useState(20);
  const [faultRate, setFaultRate] = useState(0.1);
  const c = summary?.coverage;
  const methodLabels: Record<string, string> = {
    random: "Random cells",
    highest_count: "Highest record count",
    vanasignal: "VanaSignal (quality-aware)",
    vanasignal_no_quality: "Ablation: no quality term",
  };
  const wo = benchmark?.withheld_observation;
  const qd = benchmark?.quality_detection;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Spatial coverage" id="coverage">
        {!c ? (
          <Empty>Run an analysis to see coverage statistics.</Empty>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Occupied share" value={pct(c.occupied_share)} hint={`${c.occupied_cells} of ${c.total_cells} land cells`} />
              <Stat label="Sparse cells" value={c.sparse_cells} hint="1–3 usable records" />
              <Stat label="Unsurveyed cells" value={c.unsurveyed_cells} tone="warn" hint="Zero usable records" />
              <Stat label="Median nearest record" value={c.median_nearest_record_km !== null ? `${c.median_nearest_record_km} km` : "n/a"} />
            </div>
            <p className="text-sm text-slate-300">
              Record concentration Gini: <span className="tabular-nums">{num(c.record_concentration_gini, 3)}</span>.
              Values near 1 mean records cluster in few cells, which reflects where people have sampled, not where the species occurs.
            </p>
            <Table
              caption="Survey priority indicators"
              headers={["Weight", "Indicator", "Meaning"]}
              rows={[
                [num(summary?.priority_config.w_gap, 2), "Gap", "Few quality-weighted records in the cell"],
                [num(summary?.priority_config.w_isolation, 2), "Isolation", `Distance to nearest usable record (cap ${summary?.priority_config.isolation_cap_km ?? "?"} km)`],
                [num(summary?.priority_config.w_quality, 2), "Quality deficit", "Share of the cell's records that are questionable"],
              ]}
            />
          </div>
        )}
      </Panel>

      <Panel
        title="Benchmarks: withheld observations and quality detection"
        id="benchmark"
        actions={
          <button
            type="button"
            disabled={!summary || busy !== null}
            onClick={() => onBenchmark({ seeds, k_values: [5, 10], fault_rate: faultRate })}
            className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-50"
          >
            Run benchmarks
          </button>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
          <label className="space-y-1">
            <span className="text-slate-300">Random splits (seeds)</span>
            <input type="number" min={2} max={200} value={seeds} onChange={(e) => setSeeds(Number(e.target.value))} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5" />
          </label>
          <label className="space-y-1">
            <span className="text-slate-300">Injected fault rate per type</span>
            <input type="number" step={0.01} min={0.01} max={0.45} value={faultRate} onChange={(e) => setFaultRate(Number(e.target.value))} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5" />
          </label>
        </div>
        {!benchmark ? (
          <Empty>No benchmark has been run for this analysis. Results are computed from this run's records; nothing is pre-filled.</Empty>
        ) : (
          <div className="space-y-5 text-sm">
            <p className="text-slate-300">
              {wo?.seeds_run} splits · {wo?.usable_records} usable records · {wo?.candidate_cells} candidate cells · {(wo?.test_fraction ?? 0) * 100}% withheld per split.
            </p>
            <Table
              caption="Withheld-observation results"
              headers={["Method", "Recall@5", "Recall@10", "Novel-cell recall@10", "Coverage gain @10 (pp)", "Top-10 stability (Jaccard)"]}
              rows={Object.keys(wo?.methods ?? {}).map((m) => [
                methodLabels[m] ?? m,
                meanSd(wo?.methods[m].k5.record_recall),
                meanSd(wo?.methods[m].k10.record_recall),
                meanSd(wo?.methods[m].k10.novel_cell_recall),
                meanSd(wo?.methods[m].k10.coverage_gain_pp, 2),
                meanSd(wo?.ranking_stability[m]?.top10_jaccard, 2),
              ])}
            />
            <Banner tone="info" title="How to read this">
              Recall@K is the share of withheld records that fall in the top-K cells. The count baseline re-finds sampling hotspots, so it often scores higher on recall. Gap-focused measures (novel-cell recall and coverage gain) show whether a method finds places that have no records. Each row is what the data produced; none are targets.
            </Banner>
            {qd ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Precision" value={pct(qd.precision)} hint="Flags that were injected faults" />
                  <Stat label="Recall" value={pct(qd.recall)} hint={`${qd.injected_rows} injected rows`} />
                  <Stat label="Flag rate on other rows" value={pct(qd.flag_rate_on_uninjected_rows)} hint="Real-data flags, no ground truth" />
                </div>
                <Table
                  caption="Detection by fault type"
                  headers={["Fault", "Injected", "Flagged", "Detection", "Rule-visible by design"]}
                  rows={Object.entries(qd.by_fault_type).map(([k, v]) => [k.replace(/_/g, " "), v.injected, v.flagged, pct(v.detection_rate), v.rule_visible_by_design ? "yes" : "no (limit of audit)"])}
                />
              </>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel title="Protected-area overlay" id="protected">
        {!summary ? (
          <Empty>Run an analysis to see the protected-area status.</Empty>
        ) : summary.protected_areas.loaded ? (
          <div className="space-y-2 text-sm text-slate-300">
            <div>Source: {summary.protected_areas.source_file} · {summary.protected_areas.polygons_in_region} polygons in region</div>
            <Banner tone="info" title="Context only">{summary.protected_areas.note}</Banner>
          </div>
        ) : (
          <Banner tone="warn" title="Protected-area layer not loaded">
            {summary.protected_areas.reason ?? "No protected-area data is configured."} Overlap is never used as evidence that a location is safe for harvesting.
          </Banner>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------- Survey Planner */
export function PlannerSection({
  summary,
  planned,
  togglePlanned,
  clearPlanned,
  selectedCell,
  onSelectCell,
  simulation,
  onSimulate,
  busy,
}: {
  summary: Summary | null;
  planned: string[];
  togglePlanned: (cell: string) => void;
  clearPlanned: () => void;
  selectedCell: string | null;
  onSelectCell: (c: string | null) => void;
  simulation: SimulationResult | null;
  onSimulate: (p: { detection_probability: number; visits: number; occupancy_scenarios: number[] }) => void;
  busy: string | null;
}) {
  const [detection, setDetection] = useState(0.3);
  const [visits, setVisits] = useState(3);
  const [scenarios, setScenarios] = useState("0.05, 0.2, 0.5");
  const parsed = scenarios.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  const valid = parsed.length > 0 && parsed.every((n) => n > 0 && n <= 1);

  useEffect(() => {
    if (selectedCell && summary?.candidates.some((c) => c.cell === selectedCell) && !planned.includes(selectedCell)) {
      togglePlanned(selectedCell);
    }
    // Only react to the cell chosen on the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCell]);

  if (!summary) {
    return <Panel title="Survey candidates" id="planner"><Empty>Run an analysis to rank survey locations.</Empty></Panel>;
  }
  const selectedDetail = summary.candidates.find((c) => c.cell === selectedCell);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title="Ranked survey candidates"
        id="planner"
        actions={
          <div className="flex gap-2">
            <a href={api.exportUrl(summary.run_id, "candidates.csv")} className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800">Export CSV</a>
            <button type="button" onClick={clearPlanned} disabled={planned.length === 0} className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-40">Clear plan</button>
          </div>
        }
      >
        <p className="mb-3 text-xs text-slate-400">{SCIENCE_NOTE} Candidates are at least two H3 rings apart.</p>
        <ol className="space-y-2">
          {summary.candidates.map((c) => {
            const isPlanned = planned.includes(c.cell);
            return (
              <li key={c.cell} className={`rounded-lg border p-3 text-sm ${selectedCell === c.cell ? "border-slate-200" : "border-slate-800"}`}>
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={isPlanned} onChange={() => togglePlanned(c.cell)} aria-label={`Plan survey of cell ${c.cell}`} />
                    <span>
                      <span className="font-semibold">#{c.rank}</span>{" "}
                      <span className="font-mono text-xs text-slate-400">{c.cell}</span>
                      <div className="text-xs text-slate-300">Priority {c.priority_score.toFixed(3)} · {c.raw_records} usable record(s) · {c.cell_status}</div>
                    </span>
                  </label>
                  <button type="button" onClick={() => onSelectCell(c.cell)} className="shrink-0 text-xs text-sky-300 underline">Focus on map</button>
                </div>
                <p className="mt-2 text-xs text-slate-300">{c.explanation.text}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
                  {c.explanation.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </li>
            );
          })}
        </ol>
      </Panel>

      <div className="space-y-4">
        <Panel title="Why this cell?" id="explain">
          {selectedDetail ? (
            <div className="space-y-3 text-sm">
              <div className="font-mono text-xs text-slate-400">{selectedDetail.cell}</div>
              <Table
                caption="Contributing indicators"
                headers={["Indicator", "Value (0–1)"]}
                rows={[
                  ["Gap score", selectedDetail.explanation.indicators.gap_score.toFixed(3)],
                  ["Isolation score", selectedDetail.explanation.indicators.isolation_score.toFixed(3)],
                  ["Quality deficit", selectedDetail.explanation.indicators.quality_deficit.toFixed(3)],
                  ["Priority", selectedDetail.explanation.indicators.priority_score.toFixed(3)],
                ]}
              />
              <p className="text-slate-300">{selectedDetail.explanation.text}</p>
              <p className="text-xs text-slate-500">Protected-area overlap: {pct(selectedDetail.protected_overlap_share)} (context only).</p>
            </div>
          ) : (
            <Empty>Click a grid cell on the map, or choose “Focus on map” on a candidate, to see its contributing indicators.</Empty>
          )}
        </Panel>

        <Panel title="Counterfactual survey simulator" id="simulator">
          <p className="mb-3 text-xs text-slate-400">
            Tick candidates to plan a survey, then compute expected outcomes under explicit occupancy assumptions. Nothing here estimates true occupancy.
          </p>
          <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
            <label className="space-y-1"><span className="text-slate-300">Detection / visit</span>
              <input type="number" step={0.05} min={0.01} max={1} value={detection} onChange={(e) => setDetection(Number(e.target.value))} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5" />
            </label>
            <label className="space-y-1"><span className="text-slate-300">Visits / cell</span>
              <input type="number" min={1} max={30} value={visits} onChange={(e) => setVisits(Number(e.target.value))} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5" />
            </label>
            <label className="space-y-1"><span className="text-slate-300">Occupancy scenarios</span>
              <input value={scenarios} onChange={(e) => setScenarios(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5" />
            </label>
          </div>
          <button
            type="button"
            disabled={planned.length === 0 || !valid || busy !== null}
            onClick={() => onSimulate({ detection_probability: detection, visits, occupancy_scenarios: parsed })}
            className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Simulate {planned.length} planned cell{planned.length === 1 ? "" : "s"}
          </button>
          {!valid ? <p className="mt-1 text-xs text-rose-300">Scenarios must be numbers in (0, 1].</p> : null}
          {simulation ? (
            <div className="mt-4 space-y-3">
              <Table
                caption="Expected outcomes by occupancy assumption"
                headers={["Occupancy ψ", "P(≥1 detection) per cell", "Expected new records", "Expected unsurveyed cells closed", "Unsurveyed share after"]}
                rows={simulation.scenarios.map((s) => [
                  s.occupancy_assumption_psi,
                  pct(s.p_detect_at_least_once_per_cell),
                  num(s.expected_new_records, 1),
                  num(s.expected_unsurveyed_cells_closed, 1),
                  pct(s.expected_unsurveyed_share_after),
                ])}
              />
              <p className="text-xs text-slate-500">{simulation.disclaimer}</p>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Evidence & Reports */
export function EvidenceSection({ summary, runs, onOpenRun }: { summary: Summary | null; runs: RunListItem[]; onOpenRun: (id: string) => void }) {
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!summary) return;
    setErr(null);
    Promise.all([api.getManifest(summary.run_id), api.getReport(summary.run_id)])
      .then(([m, r]) => {
        setManifest(m);
        setReport(r);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [summary]);

  if (!summary) {
    return (
      <Panel title="Evidence and reports" id="evidence">
        <Empty>Run or load an analysis to see its provenance, reproduction details and exports.</Empty>
        {runs.length ? <ul className="mt-3 text-sm">{runs.map((r) => <li key={r.run_id}><button className="underline" type="button" onClick={() => onOpenRun(r.run_id)}>{r.species} ({r.run_id})</button></li>)}</ul> : null}
      </Panel>
    );
  }

  const gbif = (manifest?.gbif ?? {}) as { occurrence_page_urls?: string[]; species_match_url?: string; licenses?: Record<string, number>; retrieved_at?: string };
  const reproduce = `python -m vanasignal.cli analyse --species "${summary.request.species}" --bbox ${summary.request.bbox.join(" ")} --resolution ${summary.request.resolution} --max-records ${summary.request.max_records} --uncertainty-m ${summary.request.uncertainty_threshold_m}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Exports" id="exports">
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {[
            ["occurrences.csv", "Occurrences with GBIF keys, licence and flags"],
            ["occurrences.geojson", "Usable points for GIS"],
            ["grid.geojson", "Grid cells with indicators (GeoJSON)"],
            ["grid_metrics.csv", "Grid indicators (CSV)"],
            ["candidates.csv", "Ranked survey candidates with explanations"],
            ["manifest.json", "Provenance and file hashes"],
            ["report.md", "Reproducible Markdown report"],
          ].map(([name, label]) => (
            <li key={name}>
              <a className="block rounded border border-slate-700 px-3 py-2 hover:bg-slate-800" href={api.exportUrl(summary.run_id, name)}>
                <span className="font-mono text-xs text-emerald-300">{name}</span>
                <div className="text-xs text-slate-400">{label}</div>
              </a>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Reproduce this analysis" id="reproduce">
        <p className="mb-2 text-sm text-slate-300">Run ID <span className="font-mono">{summary.run_id}</span> is a content hash of the request, the accepted taxon key and the record set. The same inputs against the same GBIF data give the same run.</p>
        <pre className="overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-200">{reproduce}</pre>
      </Panel>

      <Panel title="Provenance and licences" id="provenance">
        {err ? <Banner tone="error" title="Could not load provenance">{err}</Banner> : null}
        <div className="space-y-2 text-sm text-slate-300">
          <div>Data source: <span className="text-slate-100">{summary.data_source}</span></div>
          <div>Species match: <a className="break-all text-sky-300 underline" href={gbif.species_match_url}>{gbif.species_match_url}</a></div>
          <div>Licences: {Object.entries(gbif.licenses ?? {}).map(([k, v]) => `${k} (${v})`).join(", ") || "n/a"}</div>
          <details className="rounded border border-slate-800 p-2">
            <summary className="cursor-pointer text-slate-200">GBIF request URLs ({gbif.occurrence_page_urls?.length ?? 0})</summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto break-all font-mono text-xs text-slate-400">
              {(gbif.occurrence_page_urls ?? []).map((u) => <li key={u}>{u}</li>)}
            </ul>
          </details>
          <details className="rounded border border-slate-800 p-2">
            <summary className="cursor-pointer text-slate-200">Manifest (hashes and versions)</summary>
            <pre className="mt-2 max-h-72 overflow-auto text-xs text-slate-400">{manifest ? JSON.stringify(manifest, null, 2) : "Loading…"}</pre>
          </details>
        </div>
      </Panel>

      <Panel title="Analysis report" id="report">
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-200">{report ?? "Loading…"}</pre>
      </Panel>
    </div>
  );
}
