import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { CLASS_DESCRIPTION, CLASS_LABEL, FIELD_LABEL, ORIGIN_HELP, fmtDate, label } from "../lib/labels";
import { ROBOTS, STATE_LABEL, robotStates, type RobotId } from "../lib/robots";
import type { AppStatus, AuditReport, BatchRead, OccurrenceRecord, RecordClass, ReviewState } from "../lib/types";
import OriginMap from "../components/OriginMap";
import RobotStage from "../components/robots/RobotStage";
import { Button, Card, ClassBadge, DataModeBadge, Empty, KV, Loading, Missing, Notice, OriginBadge, Pill, Stat, Table } from "../components/ui";

const CLASSES: RecordClass[] = ["usable", "usable_with_caution", "insufficient_for_spatial_check", "invalid", "duplicate"];
type Tab = "identity" | "occurrences" | "quality" | "review";

export default function AuditWorkspace() {
  const { batchId = "" } = useParams();
  const [batch, setBatch] = useState<BatchRead | null>(null);
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [regionGeo, setRegionGeo] = useState<GeoJSON.Feature | null>(null);
  const [app, setApp] = useState<AppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [running, setRunning] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [runError, setRunError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [robot, setRobot] = useState<RobotId | null>(null);
  const [classFilter, setClassFilter] = useState<RecordClass | "all">("all");
  const [tab, setTab] = useState<Tab>("identity");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, region, st] = await Promise.all([api.getBatch(batchId), api.regionGeoJson().catch(() => null), api.status().catch(() => null)]);
      setBatch(b);
      setRegionGeo(region);
      setApp(st);
      // Check the (empty-list) history first, so an unaudited batch never produces a logged 404.
      const history = await api.auditHistory(batchId);
      setAudit(history.length ? await api.getAudit(batchId) : null);
      setReview(await api.reviewState(batchId).catch(() => null));
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "unknown", String(e)));
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { load(); }, [load]);

  const runAudit = async () => {
    setRunning(true);
    setReplaying(true);
    setRunError(null);
    try {
      const a = await api.runAudit(batchId, refresh);
      setAudit(a);
      setSelected(null);
      setReview(await api.reviewState(batchId).catch(() => null));
      setTimeout(() => setReplaying(false), 9000);
    } catch (e) {
      setReplaying(false);
      setRunError(e instanceof ApiError ? e : new ApiError(0, "unknown", String(e)));
    } finally {
      setRunning(false);
    }
  };

  const records: OccurrenceRecord[] = audit?.occurrence_search?.records ?? [];
  const classes = useMemo(() => {
    const m: Record<string, RecordClass> = {};
    for (const f of audit?.quality?.findings ?? []) m[f.gbif_id] = f.record_class;
    return m;
  }, [audit]);
  const findingById = useMemo(() => {
    const m: Record<string, NonNullable<AuditReport["quality"]>["findings"][number]> = {};
    for (const f of audit?.quality?.findings ?? []) m[f.gbif_id] = f;
    return m;
  }, [audit]);
  const visible = records.filter((r) => classFilter === "all" || classes[r.gbif_id] === classFilter);
  const selectedRecord = records.find((r) => r.gbif_id === selected) ?? null;
  const declared = batch && batch.latitude !== null && batch.longitude !== null
    ? { lat: batch.latitude, lon: batch.longitude, name: `${batch.declared_botanical_name} · ${batch.batch_id}` } : null;
  const states = robotStates(audit, batch ? batch.completeness.required_missing.length === 0 : null);
  const isSynthetic = batch?.data_origin === "synthetic";

  if (loading) return <Loading>Loading batch and audit…</Loading>;
  if (error) return <Notice tone="error" title="Could not open this batch">{error.message} <Link className="underline" to="/batches">Back to batches</Link></Notice>;
  if (!batch) return null;

  const origin = audit?.origin;
  const tax = audit?.taxonomy;
  const search = audit?.occurrence_search;
  const quality = audit?.quality;
  const notGbif = tax?.source_url && !tax.source_url.startsWith("https://api.gbif.org/");
  const satelliteAvailable = !!app?.satellite_configured;

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/batches" className="text-[12.5px] text-fg3 hover:text-brand">← Batches</Link>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Origin audit <span className="font-mono text-xl text-fg2">· {batch.batch_id}</span></h1>
            <DataModeBadge mode={batch.data_origin} />
            {audit?.origin ? <OriginBadge status={audit.origin.status} /> : <Pill>Not audited</Pill>}
            {review ? <Pill tone={review.state === "CLOSED" ? "good" : "warn"}>Review {review.state === "CLOSED" ? "closed" : "open"}</Pill> : null}
          </div>
          <p className="mt-2 text-[13.5px] text-fg2">
            {batch.supplier_name} · <span className="italic text-fg">{batch.declared_botanical_name}</span> · {label(batch.plant_part)} · {batch.collection_type}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="mr-1 flex cursor-pointer items-center gap-2 text-[12px] text-fg3">
            <input type="checkbox" className="accent-[#3fd0a5]" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} />
            Force live GBIF request
          </label>
          <Button onClick={runAudit} disabled={running}>{running ? "Auditing…" : audit ? "Re-run audit" : "Run audit"}</Button>
          <Button variant="secondary" href={`/batches/${encodeURIComponent(batch.batch_id)}/dossier`}>Evidence dossier</Button>
          <Button variant="ghost" href={`/batches/${encodeURIComponent(batch.batch_id)}/edit`}>Edit</Button>
        </div>
      </div>

      <div className="space-y-3">
        {isSynthetic ? <Notice tone="synthetic" title="Synthetic demonstration batch">An invented sample. Its results illustrate the workflow and are not evidence about a real shipment.</Notice> : null}
        {running ? <Notice tone="info" title="Audit running">The conductor is sending work to the robots. Public records are requested through this server and cached with their retrieval times.</Notice> : null}
        {runError ? <Notice tone="error" title="The audit could not run">{runError.message}</Notice> : null}
        {audit?.occurrence_error ? <Notice tone="error" title="Public occurrence evidence unavailable">{audit.occurrence_error.message} No occurrence result was produced; this is not a finding about the species.</Notice> : null}
        {search?.cached_note ? <Notice tone="warn" title="Showing a CACHED GBIF response">{search.cached_note}</Notice> : null}
        {notGbif ? <Notice tone="error" title="NOT LIVE GBIF DATA: responses came from a non-GBIF endpoint">The connector points at {new URL(tax!.source_url).origin}, a test or fixture server. Do not treat these results as public evidence.</Notice> : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card eyebrow="Robot workforce" title="The conductor and its seven specialist robots" className="p-3 sm:p-4" actions={
          <Pill tone={replaying ? "warn" : audit ? "good" : "neutral"}>{replaying ? "Replaying recorded steps" : audit ? "Showing recorded outcome" : "Waiting for an audit"}</Pill>
        }>
          <div className="h-[360px]">
            <RobotStage states={states} selected={robot} onSelect={(id) => setRobot((r) => (r === id ? null : id))} replaying={replaying} />
          </div>
          <p className="mt-3 px-1 text-[12px] leading-relaxed text-fg3">
            Each robot is a view of one deterministic module. Its colour is read from the stored audit. Drag to orbit, select a robot to see its job.
          </p>
        </Card>

        <div className="space-y-5">
          <Card eyebrow="Origin consistency" title="Origin consistency">
            {origin ? (
              <div className="space-y-4">
                <OriginBadge status={origin.status} />
                <p className="text-[14px] leading-relaxed text-fg">{origin.explanation}</p>
                <p className="text-[12.5px] leading-relaxed text-fg3">{ORIGIN_HELP[origin.status]}</p>
                <KV items={[
                  ["Usable in search area", String(origin.evidence.usable_records_in_search_area ?? "n/a")],
                  ["Usable within near radius", String(origin.evidence.usable_records_within_near_radius ?? "n/a")],
                  ["Nearest usable record", origin.evidence.nearest_usable_record_km != null ? `${Number(origin.evidence.nearest_usable_record_km).toFixed(1)} km` : "n/a"],
                  ["Rule", `${origin.evidence.near_radius_km ?? "n/a"} km near · ${origin.evidence.min_support_records ?? "n/a"} records minimum`],
                ]} />
                <details className="rounded-lg bg-white/[0.03] p-3 text-[12px] text-fg2">
                  <summary className="cursor-pointer font-medium text-fg">Limitations of this status</summary>
                  <ul className="mt-2 list-disc space-y-1.5 pl-4">{origin.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
                </details>
              </div>
            ) : <Empty title="Not audited yet">The status is produced by the backend audit, never by the browser.</Empty>}
          </Card>

          <Card eyebrow="Robots" title="Who did what">
            <ul className="divide-y divide-edge/70" aria-label="Robot states">
              {ROBOTS.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setRobot(r.id)} aria-pressed={robot === r.id}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${robot === r.id ? "bg-brand/10" : "hover:bg-white/[0.03]"}`}>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-fg">{r.name}</span>
                      <span className="block truncate text-[11.5px] text-fg3">{robot === r.id ? r.job : r.module}</span>
                    </span>
                    <Pill tone={states[r.id] === "ok" ? "good" : states[r.id] === "attention" ? "warn" : states[r.id] === "failed" ? "bad" : "neutral"}>{STATE_LABEL[states[r.id]]}</Pill>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="h-[560px]">
          <OriginMap
            declared={declared}
            records={records}
            classes={classes}
            selectedId={selected}
            onSelect={setSelected}
            regionGeoJson={regionGeo}
            landUrl={api.landGeoJsonUrl}
            satelliteAvailable={satelliteAvailable}
          />
        </div>

        <Card className="p-0">
          <div role="tablist" aria-label="Audit details" className="flex gap-1 overflow-x-auto border-b border-edge px-3 pt-3">
            {(["identity", "occurrences", "quality", "review"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`whitespace-nowrap rounded-t-lg px-3.5 py-2 text-[13px] font-medium ${tab === t ? "bg-raised text-brand" : "text-fg3 hover:text-fg"}`}>
                {{ identity: "Identity", occurrences: "Occurrences", quality: "Quality", review: "Review" }[t]}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="space-y-4 p-5">
            {tab === "identity" ? (
              tax ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={tax.resolution_status === "AMBIGUOUS" || tax.resolution_status === "UNRESOLVED" ? "warn" : "good"}>{tax.resolution_status.replace("_", " ").toLowerCase()}</Pill>
                    <DataModeBadge mode={tax.data_mode} />
                  </div>
                  <KV items={[
                    ["Submitted name", tax.submitted_name],
                    ["Resolved name", tax.resolved_name ?? "not established"],
                    ["Accepted name", tax.accepted_name ?? "not established"],
                    ["GBIF taxon key", tax.taxon_key ? String(tax.taxon_key) : "not established"],
                    ["Match / status", `${tax.match_type ?? "n/a"} / ${tax.taxonomic_status ?? "n/a"}`],
                    ["Selection", label(tax.selection)],
                    ["Retrieved", fmtDate(tax.retrieved_at)],
                  ]} />
                  <p className="text-[13px] leading-relaxed text-fg2">{tax.explanation}</p>
                  {tax.candidates.length > 1 && !tax.taxon_key ? (
                    <div>
                      <div className="mb-2 text-[12px] font-medium text-fg">Candidates (a person must choose; VanaSignal does not)</div>
                      <ul className="space-y-1.5 font-mono text-[12px] text-fg2">
                        {tax.candidates.slice(0, 6).map((c) => <li key={c.usage_key}>{c.scientific_name} · key {c.usage_key} · {c.taxonomic_status ?? "n/a"}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  <a className="text-[12.5px] text-brand underline" href={tax.source_url} target="_blank" rel="noreferrer">GBIF Species API response</a>
                </>
              ) : <Empty title="Taxonomy not resolved">The GBIF Species API was unavailable, or the audit has not run.</Empty>
            ) : null}

            {tab === "occurrences" ? (
              search ? (
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="GBIF present records" value={search.gbif_total_count} hint={`${search.returned_count} retrieved`} />
                  <Stat label="Search radius" value={`${search.radius_km} km`} hint="around the declared point" />
                  <Stat label="Usable" value={quality?.counts.usable ?? 0} tone="good" />
                  <Stat label="Usable with caution" value={quality?.counts.usable_with_caution ?? 0} tone="warn" />
                  <div className="col-span-2 flex flex-wrap items-center gap-2 text-[12px] text-fg3">
                    <DataModeBadge mode={search.data_mode} /> retrieved {fmtDate(search.retrieved_at)}
                  </div>
                  <p className="col-span-2 text-[12.5px] leading-relaxed text-fg3">{search.absence_note}</p>
                </div>
              ) : <Empty title="No occurrence search">{audit?.occurrence_error ? audit.occurrence_error.message : "Needs a confirmed taxon and declared coordinates."}</Empty>
            ) : null}

            {tab === "quality" ? (
              quality ? (
                <div className="space-y-4">
                  <ul className="space-y-2.5">
                    {CLASSES.map((c) => (
                      <li key={c} className="flex items-start justify-between gap-4">
                        <div><ClassBadge value={c} /><div className="mt-0.5 pl-4 text-[11.5px] text-fg3">{CLASS_DESCRIPTION[c]}</div></div>
                        <span className="tabular-nums text-[15px] font-semibold text-fg">{quality.counts[c]}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="text-[12px] leading-relaxed text-fg3">Rule reasons: {Object.entries(quality.reason_counts).map(([k, v]) => `${label(k).toLowerCase()} (${v})`).join(", ") || "none"}</div>
                  <p className="text-[12px] text-fg3">Questionable records are kept and labelled. Nothing is deleted.</p>
                </div>
              ) : <Empty title="No classification yet">Records are classified by the backend audit.</Empty>
            ) : null}

            {tab === "review" ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Pill tone={review?.state === "CLOSED" ? "good" : "warn"}>{review?.state === "CLOSED" ? "Closed by a named reviewer" : "Open: awaiting a human decision"}</Pill>
                </div>
                {review?.latest_decision ? (
                  <KV items={[["Decision", label(review.latest_decision.decision)], ["Reviewer", review.latest_decision.reviewer], ["Recorded", fmtDate(review.latest_decision.decided_at)]]} />
                ) : <p className="text-[13px] text-fg2">Automated statuses are never final. A named person records the decision on the dossier page.</p>}
                <Button href={`/batches/${encodeURIComponent(batch.batch_id)}/dossier`} variant="secondary">Open dossier and decide</Button>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Card eyebrow="Record-level evidence" title="GBIF occurrence records" actions={
        records.length ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter records by class">
            <FilterChip active={classFilter === "all"} onClick={() => setClassFilter("all")}>All ({records.length})</FilterChip>
            {CLASSES.map((c) => (
              <FilterChip key={c} active={classFilter === c} onClick={() => setClassFilter(c)}>{CLASS_LABEL[c]} ({quality?.counts[c] ?? 0})</FilterChip>
            ))}
          </div>
        ) : null
      }>
        {!audit ? <Empty title="No records yet">Run the audit to load GBIF records for this batch.</Empty> : null}
        {audit && records.length === 0 ? <Empty title="No records retrieved">The search returned no georeferenced present records. This is not evidence that the taxon is absent.</Empty> : null}
        {records.length > 0 ? (
          <div className="max-h-[440px] overflow-y-auto rounded-xl">
            <Table caption="GBIF occurrence records with quality class" headers={["Class", "GBIF id", "Date", "Coordinates", "Uncertainty", "Distance", "Dataset", "Licence", "Basis"]} minWidth={980}>
              {visible.map((r) => {
                const f = findingById[r.gbif_id];
                const isSel = r.gbif_id === selected;
                return (
                  <tr key={`${r.gbif_id}-${r.occurrence_key ?? ""}`} onClick={() => setSelected(r.gbif_id)} aria-selected={isSel}
                    className={`cursor-pointer border-b border-edge/60 transition-colors hover:bg-white/[0.03] ${isSel ? "bg-brand/[0.08]" : ""}`}>
                    <td className="px-3 py-2.5"><ClassBadge value={classes[r.gbif_id] ?? "usable"} /></td>
                    <td className="px-3 py-2.5 font-mono text-[12px]">{r.gbif_id}</td>
                    <td className="px-3 py-2.5 text-[12px]">{r.event_date ?? <span className="text-warn">missing</span>}</td>
                    <td className="px-3 py-2.5 font-mono text-[12px] tabular-nums">{r.lat !== null && r.lon !== null ? `${r.lat}, ${r.lon}` : <span className="text-warn">missing</span>}</td>
                    <td className="px-3 py-2.5 text-[12px] tabular-nums">{r.coordinate_uncertainty_m !== null ? `${r.coordinate_uncertainty_m} m` : <span className="text-fg3">unknown</span>}</td>
                    <td className="px-3 py-2.5 text-[12px] tabular-nums">{f?.distance_km_to_declared != null ? `${f.distance_km_to_declared.toFixed(1)} km` : "n/a"}</td>
                    <td className="px-3 py-2.5 text-[12px]">{r.dataset_name ?? r.dataset_key ?? <span className="text-warn">missing</span>}</td>
                    <td className="px-3 py-2.5 text-[12px]">{r.license ?? "unspecified"}</td>
                    <td className="px-3 py-2.5 text-[12px]">{r.basis_of_record ? label(r.basis_of_record) : "unknown"}</td>
                  </tr>
                );
              })}
            </Table>
          </div>
        ) : null}
        {selectedRecord ? <RecordDetail record={selectedRecord} finding={findingById[selectedRecord.gbif_id]} /> : records.length > 0 ? <p className="mt-4 text-[12.5px] text-fg3">Select a row or a map point to see the full record.</p> : null}
        {audit ? <div className="mt-4"><a className="text-[12.5px] text-brand underline" href={api.exportUrl(batch.batch_id, "json")}>Download the full audit (JSON)</a></div> : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card eyebrow="Provenance" title="Data sources">
          <ul className="space-y-4 text-[13px]">
            <li>
              <div className="font-medium text-fg">GBIF Species API</div>
              <div className="break-all font-mono text-[11.5px] text-fg3">{tax?.source_url ?? "not called"}</div>
              <div className="mt-1 flex items-center gap-2 text-[12px] text-fg3"><DataModeBadge mode={tax?.data_mode} /> retrieved {tax ? fmtDate(tax.retrieved_at) : "n/a"}</div>
            </li>
            <li>
              <div className="font-medium text-fg">GBIF Occurrence API</div>
              <div className="text-[12px] text-fg3">{search ? `${search.source_urls.length} page request(s)` : "not called"}</div>
              {search?.source_urls.slice(0, 2).map((u) => <div key={u} className="break-all font-mono text-[11px] text-fg3">{u}</div>)}
              <div className="mt-1 flex items-center gap-2 text-[12px] text-fg3"><DataModeBadge mode={search?.data_mode} /> retrieved {search ? fmtDate(search.retrieved_at) : "n/a"}</div>
            </li>
            <li className="text-[12px] leading-relaxed text-fg3">Each record keeps its GBIF identifier, dataset key, publisher key and licence. Respect the licence when you reuse records.</li>
          </ul>
        </Card>

        <Card eyebrow="Audit trail" title="Timeline">
          {audit ? (
            <ol className="space-y-3.5">
              {audit.timeline.map((s, i) => (
                <li key={i} className="grid grid-cols-[14px_1fr] gap-3">
                  <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${s.status === "ok" ? "bg-brand" : s.status === "failed" ? "bg-bad" : "bg-fg3"}`} aria-hidden />
                  <div>
                    <div className="text-[13px] font-medium text-fg">{label(s.name)} <span className="font-normal text-fg3">· {s.status}</span></div>
                    <div className="text-[12.5px] leading-relaxed text-fg2">{s.detail}</div>
                    <div className="mt-0.5 text-[11px] text-fg3">{fmtDate(s.started_at)}</div>
                  </div>
                </li>
              ))}
            </ol>
          ) : <Empty title="No timeline yet">Run the audit to record each step and its outcome.</Empty>}
          {batch.completeness.required_missing.length || batch.completeness.optional_missing.length ? (
            <div className="mt-6 border-t border-edge pt-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg3">Missing batch evidence</div>
              <Missing items={[...batch.completeness.required_missing, ...batch.completeness.optional_missing].map((f) => FIELD_LABEL[f] ?? f)} />
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`rounded-full px-3 py-1 text-[12px] font-medium ring-1 ring-inset transition-colors ${active ? "bg-brand text-[#04110c] ring-brand" : "bg-white/[0.03] text-fg2 ring-edge2 hover:text-fg"}`}>
      {children}
    </button>
  );
}

function RecordDetail({ record, finding }: { record: OccurrenceRecord; finding?: { record_class: RecordClass; explanation: string; reasons: { code: string; message: string }[]; distance_km_to_declared: number | null } }) {
  return (
    <div className="mt-5 rounded-xl border border-edge bg-panel2 p-5" aria-live="polite">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-fg">Record {record.gbif_id}</h3>
        {finding ? <ClassBadge value={finding.record_class} /> : null}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <KV items={[
          ["GBIF occurrence key", record.occurrence_key != null ? String(record.occurrence_key) : "unknown"],
          ["Scientific name", record.scientific_name ?? "unknown"],
          ["Accepted name", record.accepted_scientific_name ?? "unknown"],
          ["Coordinates", record.lat !== null && record.lon !== null ? `${record.lat}, ${record.lon}` : "missing"],
          ["Coordinate uncertainty", record.coordinate_uncertainty_m !== null ? `${record.coordinate_uncertainty_m} m` : "unknown"],
          ["Distance to declared point", finding?.distance_km_to_declared != null ? `${finding.distance_km_to_declared.toFixed(2)} km` : "n/a"],
          ["Event date", record.event_date ?? "missing"],
          ["Year", record.year != null ? String(record.year) : "missing"],
        ]} />
        <KV items={[
          ["Basis of record", record.basis_of_record ? label(record.basis_of_record) : "unknown"],
          ["Occurrence status", record.occurrence_status ?? "unknown"],
          ["Dataset", record.dataset_name ?? "unknown"],
          ["Dataset key", record.dataset_key ?? "missing"],
          ["Publisher key", record.publisher_key ?? "unknown"],
          ["Institution / catalogue", [record.institution_code, record.catalog_number].filter(Boolean).join(" / ") || "unknown"],
          ["Licence", record.license ?? "unspecified"],
          ["GBIF issues", record.issues.length ? record.issues.join(", ") : "none reported"],
        ]} />
      </div>
      {finding ? (
        <div className="mt-5 space-y-2.5 border-t border-edge pt-4 text-[13px]">
          <p className="text-fg">{finding.explanation}</p>
          {finding.reasons.length ? <ul className="list-disc space-y-1 pl-5 text-[12px] text-fg2">{finding.reasons.map((r) => <li key={r.code}><span className="font-mono text-fg">{r.code}</span>: {r.message}</li>)}</ul> : null}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-edge pt-3 text-[12px] text-fg3">
        <span>Source: GBIF Occurrence API</span>
        <span>Retrieved {fmtDate(record.retrieved_at)}</span>
        <DataModeBadge mode={record.data_mode} />
        {record.source_url ? <a className="text-brand underline" href={record.source_url} target="_blank" rel="noreferrer">GBIF response page</a> : null}
      </div>
    </div>
  );
}

