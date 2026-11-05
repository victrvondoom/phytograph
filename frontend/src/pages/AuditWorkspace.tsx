import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { CLASS_LABEL, FIELD_LABEL, ORIGIN_HELP, fmtDate, label } from "../lib/labels";
import type { AuditReport, BatchRead, OccurrenceRecord, RecordClass } from "../lib/types";
import OriginMap from "../components/OriginMap";
import { Button, Card, ClassBadge, DataModeBadge, Empty, KV, Loading, Missing, Notice, OriginBadge, Pill, Stat, Table } from "../components/ui";

const CLASSES: RecordClass[] = ["usable", "usable_with_caution", "insufficient_for_spatial_check", "invalid", "duplicate"];

export default function AuditWorkspace() {
  const { batchId = "" } = useParams();
  const [batch, setBatch] = useState<BatchRead | null>(null);
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [regionGeo, setRegionGeo] = useState<GeoJSON.Feature | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [running, setRunning] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [runError, setRunError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<RecordClass | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, region] = await Promise.all([api.getBatch(batchId), api.regionGeoJson().catch(() => null)]);
      setBatch(b);
      setRegionGeo(region);
      try {
        setAudit(await api.getAudit(batchId));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setAudit(null);
        else throw e;
      }
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "unknown", String(e)));
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { load(); }, [load]);

  const runAudit = async () => {
    setRunning(true);
    setRunError(null);
    try {
      setAudit(await api.runAudit(batchId, refresh));
      setSelected(null);
    } catch (e) {
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
  const isSynthetic = batch?.data_origin === "synthetic";

  if (loading) return <Loading>Loading batch and audit…</Loading>;
  if (error) return <Notice tone="error" title="Could not open this batch">{error.message} <Link className="underline" to="/batches">Back to the inbox</Link></Notice>;
  if (!batch) return null;

  const origin = audit?.origin;
  const tax = audit?.taxonomy;
  const search = audit?.occurrence_search;
  const quality = audit?.quality;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/batches" className="text-sm text-moss underline">← Batch inbox</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-ink">Origin audit · <span className="font-mono text-lg">{batch.batch_id}</span></h1>
            <DataModeBadge mode={batch.data_origin} />
            {audit?.origin ? <OriginBadge status={audit.origin.status} /> : <Pill>Not audited</Pill>}
          </div>
          <p className="mt-1 text-sm text-bark/70">
            {batch.supplier_name} · <span className="italic">{batch.declared_botanical_name}</span> · {batch.plant_part.replaceAll("_", " ")} · {batch.collection_type}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-bark">
            <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} />
            Force live GBIF request
          </label>
          <Button onClick={runAudit} disabled={running}>{running ? "Auditing…" : audit ? "Re-run audit" : "Run audit"}</Button>
          <Button variant="secondary" href={`/batches/${encodeURIComponent(batch.batch_id)}/dossier`} title="Open the evidence dossier">Evidence dossier</Button>
          <Button variant="ghost" href={`/batches/${encodeURIComponent(batch.batch_id)}/edit`}>Edit batch</Button>
        </div>
      </div>

      {isSynthetic ? (
        <Notice tone="synthetic" title="SYNTHETIC demonstration batch">
          This batch is an invented sample for demonstration. Its results illustrate the workflow and must not be read as evidence about a real shipment.
        </Notice>
      ) : null}
      {running ? <Notice tone="info" title="Auditing">Querying the GBIF Species and Occurrence APIs through this server. Responses are cached with their retrieval times.</Notice> : null}
      {runError ? <Notice tone="error" title="The audit could not run">{runError.message}</Notice> : null}
      {audit?.occurrence_error ? (
        <Notice tone="error" title="Public occurrence evidence unavailable">
          {audit.occurrence_error.message} No occurrence result was produced, which is not a finding about the species.
        </Notice>
      ) : null}
      {search?.cached_note ? <Notice tone="warn" title="Showing a CACHED GBIF response">{search.cached_note}</Notice> : null}
      {tax?.source_url && !tax.source_url.startsWith("https://api.gbif.org/") ? (
        <Notice tone="error" title="NOT LIVE GBIF DATA: responses came from a non-GBIF endpoint">
          The connector is pointed at {new URL(tax.source_url).origin}, a test or fixture server. Do not treat these results as public evidence.
        </Notice>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <OriginMap
            declared={declared}
            records={records}
            classes={classes}
            selectedId={selected}
            onSelect={setSelected}
            regionGeoJson={regionGeo}
            landUrl={api.landGeoJsonUrl}
          />
          {!audit ? <Notice tone="info" title="No occurrence records are on the map yet">Run the audit to retrieve GBIF occurrence records around the declared point. Only retrieved records are plotted.</Notice> : null}
          {audit && records.length === 0 && !audit.occurrence_error ? (
            <Notice tone="warn" title="GBIF returned zero records in the search area">{search?.absence_note}</Notice>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card title="Origin consistency">
            {origin ? (
              <div className="space-y-3">
                <OriginBadge status={origin.status} />
                <p className="text-sm text-ink">{origin.explanation}</p>
                <p className="text-xs text-bark/70">{ORIGIN_HELP[origin.status]}</p>
                <KV items={[
                  ["Usable records in search area", String(origin.evidence.usable_records_in_search_area ?? "n/a")],
                  ["Usable within near radius", String(origin.evidence.usable_records_within_near_radius ?? "n/a")],
                  ["Nearest usable record", origin.evidence.nearest_usable_record_km != null ? `${Number(origin.evidence.nearest_usable_record_km).toFixed(1)} km` : "n/a"],
                  ["Near radius / minimum support", `${origin.evidence.near_radius_km ?? "n/a"} km / ${origin.evidence.min_support_records ?? "n/a"} records`],
                ]} />
                <div className="rounded-md bg-mist p-3 text-xs text-bark">
                  <div className="mb-1 font-semibold">Limitations of this status</div>
                  <ul className="list-disc space-y-1 pl-4">{origin.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
                </div>
              </div>
            ) : <Empty title="Not audited yet">The origin status is produced by the audit, not by the browser.</Empty>}
          </Card>

          <Card title="Botanical identity">
            {tax ? (
              <div className="space-y-3">
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
                <p className="text-sm text-bark">{tax.explanation}</p>
                {tax.candidates.length > 1 && !tax.taxon_key ? (
                  <div>
                    <div className="mb-1 text-xs font-medium text-bark">Candidates (a person must choose; VanaSignal does not)</div>
                    <ul className="space-y-1 text-xs">
                      {tax.candidates.slice(0, 6).map((c) => (
                        <li key={c.usage_key} className="font-mono">{c.scientific_name} · key {c.usage_key} · {c.taxonomic_status ?? "n/a"}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <a className="text-xs text-moss underline" href={tax.source_url} target="_blank" rel="noreferrer">GBIF Species API response</a>
              </div>
            ) : <Empty title="Taxonomy not resolved">GBIF Species API was unavailable or the audit has not run.</Empty>}
          </Card>

          <Card title="Occurrence summary">
            {search ? (
              <div className="grid grid-cols-2 gap-3">
                <Stat label="GBIF present records" value={search.gbif_total_count} hint={`${search.returned_count} retrieved`} />
                <Stat label="Search radius" value={`${search.radius_km} km`} hint="around declared point" />
                <Stat label="Usable" value={quality?.counts.usable ?? 0} />
                <Stat label="Usable with caution" value={quality?.counts.usable_with_caution ?? 0} />
                <div className="col-span-2 text-xs text-bark/70">
                  Data: <DataModeBadge mode={search.data_mode} /> · retrieved {fmtDate(search.retrieved_at)} · <span>{search.absence_note}</span>
                </div>
              </div>
            ) : <Empty title="No occurrence search">{audit?.occurrence_error ? audit.occurrence_error.message : "Needs a confirmed taxon and declared coordinates."}</Empty>}
          </Card>

          <Card title="Occurrence-quality findings">
            {quality ? (
              <div className="space-y-3 text-sm">
                <ul className="space-y-1.5">
                  {CLASSES.map((c) => (
                    <li key={c} className="flex items-center justify-between"><ClassBadge value={c} /><span className="tabular-nums">{quality.counts[c]}</span></li>
                  ))}
                </ul>
                <div className="text-xs text-bark/70">Rule reasons: {Object.entries(quality.reason_counts).map(([k, v]) => `${label(k).toLowerCase()} (${v})`).join(", ") || "none"}</div>
                <p className="text-xs text-bark/60">Questionable records are kept and labelled. Nothing is deleted.</p>
              </div>
            ) : <Empty title="No classification yet">Records are classified by the backend audit.</Empty>}
          </Card>
        </div>
      </div>

      <Card title="Record-level evidence" actions={
        records.length ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter records by class">
            <button onClick={() => setClassFilter("all")} className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${classFilter === "all" ? "bg-moss text-white ring-moss" : "bg-white text-bark ring-line"}`}>All ({records.length})</button>
            {CLASSES.map((c) => (
              <button key={c} onClick={() => setClassFilter(c)} className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${classFilter === c ? "bg-moss text-white ring-moss" : "bg-white text-bark ring-line"}`}>{CLASS_LABEL[c]} ({quality?.counts[c] ?? 0})</button>
            ))}
          </div>
        ) : null
      }>
        {!audit ? <Empty title="No records yet">Run the audit to load GBIF records for this batch.</Empty> : null}
        {audit && records.length === 0 ? <Empty title="No records retrieved">The search returned no georeferenced present records. This is not evidence that the taxon is absent.</Empty> : null}
        {records.length > 0 ? (
          <div className="max-h-[420px] overflow-y-auto">
            <Table caption="GBIF occurrence records with quality class" headers={["Class", "GBIF id", "Date", "Coordinates", "Uncertainty", "Distance", "Dataset", "Licence", "Basis"]}>
              {visible.map((r) => {
                const f = findingById[r.gbif_id];
                const isSel = r.gbif_id === selected;
                return (
                  <tr key={`${r.gbif_id}-${r.occurrence_key ?? ""}`} onClick={() => setSelected(r.gbif_id)} className={`cursor-pointer border-b border-line/70 hover:bg-mist/60 ${isSel ? "bg-moss/10" : ""}`} aria-selected={isSel}>
                    <td className="px-3 py-2"><ClassBadge value={classes[r.gbif_id] ?? "usable"} /></td>
                    <td className="px-3 py-2 font-mono text-xs">{r.gbif_id}</td>
                    <td className="px-3 py-2 text-xs">{r.event_date ?? <span className="text-clay">missing</span>}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{r.lat !== null && r.lon !== null ? `${r.lat}, ${r.lon}` : <span className="text-clay">missing</span>}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{r.coordinate_uncertainty_m !== null ? `${r.coordinate_uncertainty_m} m` : <span className="text-bark/60">unknown</span>}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{f?.distance_km_to_declared != null ? `${f.distance_km_to_declared.toFixed(1)} km` : "n/a"}</td>
                    <td className="px-3 py-2 text-xs">{r.dataset_name ?? r.dataset_key ?? <span className="text-clay">missing</span>}</td>
                    <td className="px-3 py-2 text-xs">{r.license ?? "unspecified"}</td>
                    <td className="px-3 py-2 text-xs">{r.basis_of_record ? label(r.basis_of_record) : "unknown"}</td>
                  </tr>
                );
              })}
            </Table>
          </div>
        ) : null}
        {selectedRecord ? <RecordDetail record={selectedRecord} finding={findingById[selectedRecord.gbif_id]} /> : records.length > 0 ? <p className="mt-3 text-xs text-bark/60">Select a row or a map point to see the full record.</p> : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Data sources">
          <ul className="space-y-3 text-sm">
            <li>
              <div className="font-medium">GBIF Species API</div>
              <div className="break-all text-xs text-bark/70">{tax?.source_url ?? "not called"}</div>
              <div className="text-xs text-bark/60">Retrieved {tax ? fmtDate(tax.retrieved_at) : "n/a"} · <DataModeBadge mode={tax?.data_mode} /></div>
            </li>
            <li>
              <div className="font-medium">GBIF Occurrence API</div>
              <div className="text-xs text-bark/70">{search ? `${search.source_urls.length} page request(s)` : "not called"}</div>
              {search?.source_urls.slice(0, 3).map((u) => <div key={u} className="break-all font-mono text-[11px] text-bark/60">{u}</div>)}
              <div className="text-xs text-bark/60">Retrieved {search ? fmtDate(search.retrieved_at) : "n/a"} · <DataModeBadge mode={search?.data_mode} /></div>
            </li>
            <li className="text-xs text-bark/70">Each record keeps its GBIF identifier, dataset key, publisher key and licence. Respect the licence when you reuse records.</li>
          </ul>
        </Card>

        <Card title="Audit timeline">
          {audit ? (
            <ol className="space-y-2 text-sm">
              {audit.timeline.map((s, i) => (
                <li key={i} className="grid grid-cols-[auto_1fr] gap-3">
                  <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${s.status === "ok" ? "bg-leaf" : s.status === "failed" ? "bg-clay" : "bg-stone-400"}`} aria-hidden />
                  <div>
                    <div className="font-medium">{label(s.name)} <span className="text-xs font-normal text-bark/60">· {s.status}</span></div>
                    <div className="text-xs text-bark/70">{s.detail}</div>
                    <div className="text-[11px] text-bark/50">{fmtDate(s.started_at)}</div>
                  </div>
                </li>
              ))}
            </ol>
          ) : <Empty title="No audit timeline yet">Run the audit to record each step and its outcome.</Empty>}
          {batch.completeness.required_missing.length || batch.completeness.optional_missing.length ? (
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-bark/60">Missing batch evidence</div>
              <Missing items={[...batch.completeness.required_missing, ...batch.completeness.optional_missing].map((f) => FIELD_LABEL[f] ?? f)} />
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function RecordDetail({ record, finding }: { record: OccurrenceRecord; finding?: { record_class: RecordClass; explanation: string; reasons: { code: string; message: string }[]; distance_km_to_declared: number | null } }) {
  return (
    <div className="mt-5 rounded-md border border-line bg-mist/50 p-4" aria-live="polite">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Record {record.gbif_id}</h3>
        {finding ? <ClassBadge value={finding.record_class} /> : null}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
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
        <div className="mt-4 space-y-2 text-sm">
          <p className="text-ink">{finding.explanation}</p>
          {finding.reasons.length ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-bark">{finding.reasons.map((r) => <li key={r.code}><span className="font-mono">{r.code}</span>: {r.message}</li>)}</ul>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs text-bark/70">
        <span>Source: GBIF Occurrence API</span>
        <span>Retrieved {fmtDate(record.retrieved_at)}</span>
        <DataModeBadge mode={record.data_mode} />
        {record.source_url ? <a className="text-moss underline" href={record.source_url} target="_blank" rel="noreferrer">GBIF response page</a> : null}
      </div>
    </div>
  );
}
