import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { FIELD_LABEL, ORIGIN_LABEL, fmtDate, label } from "../lib/labels";
import type { AuditReport } from "../lib/types";
import { Button, Card, DataModeBadge, Empty, KV, Loading, Missing, Notice, OriginBadge, Pill, Table } from "../components/ui";

const OVERALL: Record<string, string> = {
  EVIDENCE_INCOMPLETE: "Evidence incomplete",
  CONFLICT_REQUIRES_REVIEW: "Location conflict in public data: requires human review",
  INSUFFICIENT_PUBLIC_EVIDENCE: "Insufficient public evidence",
  CORROBORATED_PENDING_REVIEW: "Declared area corroborated by public records: pending human review",
};

export default function Dossier() {
  const { batchId = "" } = useParams();
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [verify, setVerify] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.getAudit(batchId)
      .then(setAudit)
      .catch((e: unknown) => setError(e instanceof ApiError ? e : new ApiError(0, "unknown", String(e))))
      .finally(() => setLoading(false));
  }, [batchId]);

  if (loading) return <Loading>Loading evidence dossier…</Loading>;
  if (error?.status === 404) {
    return <Empty title="No dossier yet" action={<Button href={`/batches/${encodeURIComponent(batchId)}/audit`}>Open the audit workspace</Button>}>This batch has not been audited. A dossier is generated from a stored audit.</Empty>;
  }
  if (error) return <Notice tone="error" title="Could not load the dossier">{error.message}</Notice>;
  if (!audit) return null;

  const snap = audit.batch_snapshot as Record<string, string | number | null | string[]>;
  const q = audit.quality;
  const verifyIntegrity = async () => {
    try {
      const r = await api.verifyIntegrity(batchId);
      setVerify(r.verified ? "Integrity verified: the stored audit matches its recorded SHA-256." : "Integrity check FAILED: the stored audit no longer matches its recorded hash.");
    } catch (e) {
      setVerify(e instanceof ApiError ? e.message : "Integrity check failed.");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to={`/batches/${encodeURIComponent(batchId)}/audit`} className="text-sm text-moss underline">← Audit workspace</Link>
          <h1 className="mt-1 text-xl font-semibold text-ink">Evidence dossier · {batchId}</h1>
          <p className="mt-1 text-sm text-bark/70">Audit {audit.audit_id} · {fmtDate(audit.created_at)} · method {audit.method_version}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" href={api.exportUrl(batchId, "md")}>Download readable report (.md)</Button>
          <Button variant="secondary" href={api.exportUrl(batchId, "json")}>Download JSON (.json)</Button>
          <Button variant="ghost" onClick={verifyIntegrity}>Verify integrity</Button>
        </div>
      </div>

      <Notice tone="warn" title={OVERALL[audit.overall_status] ?? audit.overall_status}>
        Automated evidence status. A person must review it before any decision. This is not a legal, regulatory or certification finding.
      </Notice>
      {verify ? <Notice tone={verify.startsWith("Integrity verified") ? "ok" : "error"} title="Integrity check">{verify}</Notice> : null}
      {snap.data_origin === "synthetic" ? <Notice tone="synthetic" title="SYNTHETIC demonstration batch">Invented sample data. Not a real supplier shipment.</Notice> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Batch summary">
          <KV items={[
            ["Batch ID", String(snap.batch_id ?? batchId)],
            ["Data origin", snap.data_origin === "synthetic" ? "Synthetic demonstration sample" : "Manually entered"],
            ["Supplier", String(snap.supplier_name ?? "")],
            ["Declared botanical name", String(snap.declared_botanical_name ?? "")],
            ["Plant part", label(String(snap.plant_part ?? ""))],
            ["Declared location", [snap.declared_district, snap.declared_state, snap.declared_country].filter(Boolean).join(", ") || "unknown"],
            ["Declared coordinates", snap.latitude != null && snap.longitude != null ? `${snap.latitude}, ${snap.longitude}` : "not provided (unknown)"],
            ["Collection date", String(snap.collection_date ?? "not provided")],
            ["Collection type", String(snap.collection_type ?? "")],
            ["Supplier batch reference", String(snap.supplier_batch_reference ?? "not provided")],
            ["Supporting documents referenced", (snap.document_references as string[] | undefined)?.join(", ") || "none"],
          ]} />
        </Card>

        <Card title="Batch-field completeness">
          <div className="space-y-3 text-sm">
            <div>Documentation completeness: <span className="font-semibold tabular-nums">{Math.round(audit.batch_completeness.completeness_share * 100)}%</span> <span className="text-xs text-bark/60">(a documentation measure only, not a quality or sustainability score)</span></div>
            <div><div className="mb-1 text-xs font-medium text-bark">Required fields missing</div><Missing items={audit.batch_completeness.required_missing.map((f) => FIELD_LABEL[f] ?? f)} /></div>
            <div><div className="mb-1 text-xs font-medium text-bark">Optional fields missing</div><Missing items={audit.batch_completeness.optional_missing.map((f) => FIELD_LABEL[f] ?? f)} /></div>
          </div>
        </Card>

        <Card title="Botanical identity">
          {audit.taxonomy ? (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Pill tone={audit.taxonomy.resolution_status === "RESOLVED" || audit.taxonomy.resolution_status === "SYNONYM_RESOLVED" ? "good" : "warn"}>{audit.taxonomy.resolution_status.replace("_", " ").toLowerCase()}</Pill><DataModeBadge mode={audit.taxonomy.data_mode} /></div>
              <KV items={[["Accepted taxon key", audit.taxonomy.taxon_key ? String(audit.taxonomy.taxon_key) : "not established"], ["Resolved name", audit.taxonomy.resolved_name ?? "n/a"], ["Selection", label(audit.taxonomy.selection)], ["Retrieved", fmtDate(audit.taxonomy.retrieved_at)]]} />
              <p>{audit.taxonomy.explanation}</p>
            </div>
          ) : <Notice tone="warn" title="Not checked">The GBIF Species API was unavailable for this audit.</Notice>}
        </Card>

        <Card title="Location evidence">
          <div className="space-y-3 text-sm">
            <OriginBadge status={audit.origin.status} />
            <p>{audit.origin.explanation}</p>
            <p className="text-xs text-bark/70">{ORIGIN_LABEL[audit.origin.status]} · status applies only to the public evidence available at audit time.</p>
            {audit.occurrence_search ? (
              <KV items={[
                ["GBIF present records (search area)", `${audit.occurrence_search.gbif_total_count} total · ${audit.occurrence_search.returned_count} retrieved`],
                ["Search radius", `${audit.occurrence_search.radius_km} km around the declared point`],
                ["Data mode", audit.occurrence_search.data_mode],
                ["Retrieved", fmtDate(audit.occurrence_search.retrieved_at)],
              ]} />
            ) : null}
            {audit.occurrence_search?.cached_note ? <Notice tone="warn" title="Cached data">{audit.occurrence_search.cached_note}</Notice> : null}
            {audit.occurrence_error ? <Notice tone="error" title="Occurrence retrieval failed">{audit.occurrence_error.message}</Notice> : null}
          </div>
        </Card>

        <Card title="Occurrence-quality findings">
          {q ? (
            <div className="space-y-3 text-sm">
              <KV items={Object.entries(q.counts).map(([k, v]) => [label(k), String(v)] as [string, string])} />
              <div className="text-xs text-bark/70">Reason counts: {Object.entries(q.reason_counts).map(([k, v]) => `${k} (${v})`).join(", ") || "none"}</div>
            </div>
          ) : <Empty title="No classification">No occurrence records were classified.</Empty>}
        </Card>

        <Card title="Unresolved questions">
          {audit.unresolved_questions.length ? (
            <ul className="list-disc space-y-1.5 pl-5 text-sm">{audit.unresolved_questions.map((x) => <li key={x}>{x}</li>)}</ul>
          ) : <p className="text-sm text-bark/70">None recorded.</p>}
        </Card>

        <Card title="Scientific limitations">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">{audit.scientific_limitations.map((x) => <li key={x}>{x}</li>)}</ul>
        </Card>
      </div>

      <Card title="Evidence findings">
        <Table caption="Evidence findings with provenance" headers={["Finding", "Category", "Status", "Review", "Source", "Retrieved"]}>
          {audit.findings.map((f) => (
            <tr key={f.finding_id} className="border-b border-line/70 align-top">
              <td className="px-3 py-2 font-mono text-[11px]">{f.finding_id}</td>
              <td className="px-3 py-2 text-xs">{label(f.category)}</td>
              <td className="px-3 py-2 text-xs font-medium">{f.status}</td>
              <td className="px-3 py-2 text-xs">{f.review_state === "awaiting_human_review" ? <Pill tone="warn">awaiting review</Pill> : <Pill tone="good">automated</Pill>}</td>
              <td className="px-3 py-2 text-xs">
                {f.source_name}
                {f.source_url ? <div className="break-all text-[11px] text-bark/60">{f.source_url}</div> : null}
              </td>
              <td className="px-3 py-2 text-xs">{f.retrieved_at ? fmtDate(f.retrieved_at) : "n/a"}</td>
            </tr>
          ))}
        </Table>
        <div className="mt-4 space-y-1.5 text-xs text-bark/80">
          {audit.findings.map((f) => (
            <details key={f.finding_id} className="rounded-md border border-line p-2">
              <summary className="cursor-pointer text-sm text-ink">{f.finding_id.slice(-4)} · {label(f.category)}: {f.status}</summary>
              <p className="mt-2 text-sm text-ink">{f.explanation}</p>
              <p className="mt-1">Source records: {f.source_record_ids.length ? f.source_record_ids.join(", ") : "none"}</p>
              <p className="mt-1">Method {f.method_version}. Limitations: {f.limitations.join(" ")}</p>
            </details>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Source references">
          <ul className="space-y-2 text-sm">
            {audit.sources.map((s, i) => (
              <li key={i}>
                <div className="font-medium">{String(s.name)}</div>
                <div className="break-all text-xs text-bark/70">{String(s.url ?? (s.urls as string[] | undefined)?.join(" ") ?? "")}</div>
                <div className="text-xs text-bark/60">Retrieved {s.retrieved_at ? fmtDate(String(s.retrieved_at)) : "n/a"}</div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Audit timeline">
          <ol className="space-y-2 text-sm">
            {audit.timeline.map((s, i) => (
              <li key={i}><span className="font-medium">{label(s.name)}</span> · {s.status} · <span className="text-xs text-bark/70">{s.detail}</span></li>
            ))}
          </ol>
          <div className="mt-4 break-all border-t border-line pt-3 text-xs text-bark/60">
            Audit timestamp {fmtDate(audit.created_at)} · SHA-256 {audit.integrity.body_sha256 ?? "n/a"}
          </div>
        </Card>
      </div>
    </div>
  );
}
