import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { FIELD_LABEL, ORIGIN_LABEL, fmtDate, label } from "../lib/labels";
import type { AuditReport, ReviewOut, ReviewState } from "../lib/types";
import { Button, Card, DataModeBadge, Empty, KV, Loading, Missing, Notice, OriginBadge, Pill, Table } from "../components/ui";

const OVERALL: Record<string, string> = {
  EVIDENCE_INCOMPLETE: "Evidence incomplete",
  CONFLICT_REQUIRES_REVIEW: "Location conflict in public data: requires human review",
  INSUFFICIENT_PUBLIC_EVIDENCE: "Insufficient public evidence",
  CORROBORATED_PENDING_REVIEW: "Declared area corroborated by public records: pending human review",
};
const DECISIONS: { value: ReviewOut["decision"]; label: string; help: string }[] = [
  { value: "accept_for_further_review", label: "Accept for further review", help: "The evidence is sufficient to pass this batch to the next human step. This is not a legal or certification finding." },
  { value: "request_more_evidence", label: "Request more evidence", help: "The batch cannot be decided yet. Record what is missing in the note." },
  { value: "reject", label: "Reject", help: "The evidence does not support the claim as declared. Record the reason in the note." },
];

export default function Dossier() {
  const { batchId = "" } = useParams();
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [verify, setVerify] = useState<string | null>(null);
  const [decision, setDecision] = useState<ReviewOut["decision"]>("request_more_evidence");
  const [reviewer, setReviewer] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => api.reviewState(batchId).then(setReview).catch(() => setReview(null));

  useEffect(() => {
    setLoading(true);
    api.auditHistory(batchId)
      .then((h) => (h.length ? api.getAudit(batchId) : Promise.reject(new ApiError(404, "audit_not_found", "No audit yet."))))
      .then(setAudit)
      .catch((e: unknown) => setError(e instanceof ApiError ? e : new ApiError(0, "unknown", String(e))))
      .finally(() => setLoading(false));
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  if (loading) return <Loading>Loading evidence dossier…</Loading>;
  if (error?.status === 404) {
    return <Empty title="No dossier yet" action={<Button href={`/batches/${encodeURIComponent(batchId)}/audit`}>Open the audit workspace</Button>}>A dossier is generated from a stored audit. Run one first.</Empty>;
  }
  if (error) return <Notice tone="error" title="Could not load the dossier">{error.message}</Notice>;
  if (!audit) return null;

  const snap = audit.batch_snapshot as Record<string, string | number | null | string[]>;
  const q = audit.quality;
  const submitReview = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    if (reviewer.trim().length < 2) { setFormError("Enter the name of the person recording this decision."); return; }
    setSaving(true);
    try {
      await api.addReview(batchId, { audit_id: audit.audit_id, decision, reviewer: reviewer.trim(), note: note.trim() });
      setNote("");
      await refresh();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "The decision could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  const verifyIntegrity = async () => {
    try {
      const r = await api.verifyIntegrity(batchId);
      setVerify(r.verified ? "Integrity verified: the stored audit matches its recorded SHA-256." : "Integrity check FAILED: the stored audit no longer matches its recorded hash.");
    } catch (e) {
      setVerify(e instanceof ApiError ? e.message : "Integrity check failed.");
    }
  };
  const closed = review?.state === "CLOSED";

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to={`/batches/${encodeURIComponent(batchId)}/audit`} className="text-[12.5px] text-fg3 hover:text-brand">← Origin audit</Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">Evidence dossier <span className="font-mono text-xl text-fg2">· {batchId}</span></h1>
          <p className="mt-1.5 text-[13px] text-fg2">Audit <span className="font-mono">{audit.audit_id}</span> · {fmtDate(audit.created_at)} · method {audit.method_version}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button variant="secondary" href={api.exportUrl(batchId, "md")} download>Readable report (.md)</Button>
          <Button variant="secondary" href={api.exportUrl(batchId, "json")} download>JSON (.json)</Button>
          <Button variant="secondary" href={api.csvUrl(batchId)} download>Records (.csv)</Button>
          <Button variant="ghost" onClick={verifyIntegrity}>Verify integrity</Button>
        </div>
      </div>

      <Notice tone="warn" title={OVERALL[audit.overall_status] ?? audit.overall_status}>Automated evidence status. A named person must review it before any decision. This is not a legal, regulatory or certification finding.</Notice>
      {verify ? <Notice tone={verify.startsWith("Integrity verified") ? "ok" : "error"} title="Integrity check">{verify}</Notice> : null}
      {snap.data_origin === "synthetic" ? <Notice tone="synthetic" title="Synthetic demonstration batch">Invented sample data. Not a real supplier shipment.</Notice> : null}

      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card eyebrow="Closure" title="Human review" className="h-fit">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Pill tone={closed ? "good" : "warn"}>{closed ? "Closed" : "Open"}</Pill>
            <span className="text-[12.5px] text-fg3">{closed ? "A named reviewer decided on this audit." : "No decision recorded for the latest audit."}</span>
          </div>
          {review?.history.length ? (
            <Table caption="Recorded decisions" headers={["When", "Decision", "Reviewer", "Audit", "Note"]} minWidth={560}>
              {review.history.map((h) => (
                <tr key={h.review_id} className="border-b border-edge/60">
                  <td className="px-3 py-2.5 text-[12px]">{fmtDate(h.decided_at)}</td>
                  <td className="px-3 py-2.5 text-[12px] font-medium text-fg">{label(h.decision)}</td>
                  <td className="px-3 py-2.5 text-[12px]">{h.reviewer}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px]">{h.audit_id.slice(-10)}{h.audit_id === audit.audit_id ? "" : " (older)"}</td>
                  <td className="px-3 py-2.5 text-[12px]">{h.note || "—"}</td>
                </tr>
              ))}
            </Table>
          ) : null}
          <form onSubmit={submitReview} className="mt-5 space-y-4 rounded-xl border border-edge bg-panel2 p-4" aria-label="Record a decision">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-[12.5px] font-medium text-fg">Decision on this audit</legend>
              {DECISIONS.map((d) => (
                <label key={d.value} className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-[13px] ${decision === d.value ? "border-brand/50 bg-brand/[0.06]" : "border-edge hover:border-edge2"}`}>
                  <input type="radio" name="decision" value={d.value} checked={decision === d.value} onChange={() => setDecision(d.value)} className="mt-0.5 accent-[#3fd0a5]" />
                  <span><span className="font-medium text-fg">{d.label}</span><span className="block text-[12px] text-fg3">{d.help}</span></span>
                </label>
              ))}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[12.5px] text-fg2">Reviewer name <span className="text-bad">*</span>
                <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-edge2 bg-canvas px-3 py-2 text-[13px] text-fg focus:border-brand focus:outline-none" placeholder="Your name" />
              </label>
              <label className="block text-[12.5px] text-fg2 sm:col-span-2">Note (optional)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className="mt-1 w-full rounded-lg border border-edge2 bg-canvas px-3 py-2 text-[13px] text-fg focus:border-brand focus:outline-none" placeholder="What did you check, and what is still missing?" />
              </label>
            </div>
            {formError ? <p role="alert" className="text-[12.5px] text-bad">{formError}</p> : null}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11.5px] text-fg3">Attribution label only: this build has no user accounts.</span>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Record decision"}</Button>
            </div>
          </form>
        </Card>

        <Card eyebrow="Location" title="Origin status">
          <div className="space-y-4 text-[13.5px]">
            <OriginBadge status={audit.origin.status} />
            <p className="leading-relaxed text-fg">{audit.origin.explanation}</p>
            <p className="text-[12px] text-fg3">{ORIGIN_LABEL[audit.origin.status]}. Applies only to the public evidence available at audit time.</p>
            {audit.occurrence_search ? (
              <KV items={[
                ["GBIF records (search area)", `${audit.occurrence_search.gbif_total_count} total · ${audit.occurrence_search.returned_count} retrieved`],
                ["Search radius", `${audit.occurrence_search.radius_km} km`],
                ["Source", <DataModeBadge key="m" mode={audit.occurrence_search.data_mode} />],
                ["Retrieved", fmtDate(audit.occurrence_search.retrieved_at)],
              ]} />
            ) : null}
            {audit.occurrence_search?.cached_note ? <Notice tone="warn" title="Cached data">{audit.occurrence_search.cached_note}</Notice> : null}
            {audit.occurrence_error ? <Notice tone="error" title="Occurrence retrieval failed">{audit.occurrence_error.message}</Notice> : null}
          </div>
        </Card>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
        <Card eyebrow="Declared claim" title="Batch summary">
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
        <Card eyebrow="Documentation" title="Batch-field completeness">
          <div className="space-y-4 text-[13.5px]">
            <div>Documentation completeness: <span className="font-semibold tabular-nums text-fg">{Math.round(audit.batch_completeness.completeness_share * 100)}%</span> <span className="text-[12px] text-fg3">(a documentation measure only, not a quality or sustainability score)</span></div>
            <div><div className="mb-2 text-[12px] font-medium text-fg2">Required fields missing</div><Missing items={audit.batch_completeness.required_missing.map((f) => FIELD_LABEL[f] ?? f)} /></div>
            <div><div className="mb-2 text-[12px] font-medium text-fg2">Optional fields missing</div><Missing items={audit.batch_completeness.optional_missing.map((f) => FIELD_LABEL[f] ?? f)} /></div>
          </div>
        </Card>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
        <Card eyebrow="Identity" title="Botanical identity">
          {audit.taxonomy ? (
            <div className="space-y-4 text-[13.5px]">
              <div className="flex flex-wrap items-center gap-2"><Pill tone={audit.taxonomy.resolution_status === "RESOLVED" || audit.taxonomy.resolution_status === "SYNONYM_RESOLVED" ? "good" : "warn"}>{audit.taxonomy.resolution_status.replace("_", " ").toLowerCase()}</Pill><DataModeBadge mode={audit.taxonomy.data_mode} /></div>
              <KV items={[["Accepted taxon key", audit.taxonomy.taxon_key ? String(audit.taxonomy.taxon_key) : "not established"], ["Resolved name", audit.taxonomy.resolved_name ?? "n/a"], ["Selection", label(audit.taxonomy.selection)], ["Retrieved", fmtDate(audit.taxonomy.retrieved_at)]]} />
              <p className="text-fg2">{audit.taxonomy.explanation}</p>
            </div>
          ) : <Notice tone="warn" title="Not checked">The GBIF Species API was unavailable for this audit.</Notice>}
        </Card>
        <Card eyebrow="Quality" title="Occurrence-quality findings">
          {q ? (
            <div className="space-y-4 text-[13.5px]">
              <KV items={Object.entries(q.counts).map(([k, v]) => [label(k), String(v)] as [string, string])} />
              <div className="text-[12px] text-fg3">Reason counts: {Object.entries(q.reason_counts).map(([k, v]) => `${k} (${v})`).join(", ") || "none"}</div>
            </div>
          ) : <Empty title="No classification">No occurrence records were classified.</Empty>}
        </Card>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
        <Card eyebrow="Questions" title="Unresolved questions">
          {audit.unresolved_questions.length ? (
            <ul className="list-disc space-y-2 pl-5 text-[13.5px] leading-relaxed text-fg2">{audit.unresolved_questions.map((x) => <li key={x}>{x}</li>)}</ul>
          ) : <p className="text-[13.5px] text-fg3">None recorded.</p>}
        </Card>
        <Card eyebrow="Limits" title="Scientific limitations">
          <ul className="list-disc space-y-2 pl-5 text-[13.5px] leading-relaxed text-fg2">{audit.scientific_limitations.map((x) => <li key={x}>{x}</li>)}</ul>
        </Card>
      </div>

      <Card eyebrow="Provenance" title="Evidence findings">
        <Table caption="Evidence findings with provenance" headers={["Finding", "Category", "Status", "Review", "Source", "Retrieved"]} minWidth={860}>
          {audit.findings.map((f) => (
            <tr key={f.finding_id} className="border-b border-edge/60 align-top">
              <td className="px-3 py-2.5 font-mono text-[11px]">{f.finding_id.slice(-6)}</td>
              <td className="px-3 py-2.5 text-[12px]">{label(f.category)}</td>
              <td className="px-3 py-2.5 text-[12px] font-medium text-fg">{f.status}</td>
              <td className="px-3 py-2.5">{f.review_state === "awaiting_human_review" ? <Pill tone="warn">awaiting review</Pill> : <Pill tone="good">automated</Pill>}</td>
              <td className="px-3 py-2.5 text-[12px]">{f.source_name}{f.source_url ? <div className="break-all font-mono text-[10.5px] text-fg3">{f.source_url}</div> : null}</td>
              <td className="px-3 py-2.5 text-[12px]">{f.retrieved_at ? fmtDate(f.retrieved_at) : "n/a"}</td>
            </tr>
          ))}
        </Table>
        <div className="mt-4 space-y-2">
          {audit.findings.map((f) => (
            <details key={f.finding_id} className="group rounded-xl border border-edge bg-panel2 px-4 py-3">
              <summary className="cursor-pointer list-none text-[13px] font-medium text-fg">
                <span className="mr-2 font-mono text-[11px] text-fg3">{f.finding_id.slice(-6)}</span>{label(f.category)}: <span className="text-brand">{f.status}</span>
              </summary>
              <p className="mt-3 text-[13px] leading-relaxed text-fg">{f.explanation}</p>
              <p className="mt-2 text-[12px] text-fg3">Source records: {f.source_record_ids.length ? f.source_record_ids.join(", ") : "none"}</p>
              <p className="mt-1 text-[12px] text-fg3">Method {f.method_version}. Limitations: {f.limitations.join(" ")}</p>
            </details>
          ))}
        </div>
      </Card>

      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
        <Card eyebrow="Sources" title="Source references">
          <ul className="space-y-3 text-[13px]">
            {audit.sources.map((s, i) => (
              <li key={i}>
                <div className="font-medium text-fg">{String(s.name)}</div>
                <div className="break-all font-mono text-[11.5px] text-fg3">{String(s.url ?? (s.urls as string[] | undefined)?.join(" ") ?? "")}</div>
                <div className="mt-0.5 text-[12px] text-fg3">Retrieved {s.retrieved_at ? fmtDate(String(s.retrieved_at)) : "n/a"} · <DataModeBadge mode={(s.data_mode as "live") ?? undefined} /></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card eyebrow="Integrity" title="Audit timeline">
          <ol className="space-y-2.5 text-[13px]">
            {audit.timeline.map((s, i) => (
              <li key={i}><span className="font-medium text-fg">{label(s.name)}</span> · <span className="text-fg3">{s.status}</span> · <span className="text-fg2">{s.detail}</span></li>
            ))}
          </ol>
          <div className="mt-5 break-all border-t border-edge pt-3 font-mono text-[11px] text-fg3">Audit timestamp {fmtDate(audit.created_at)} · SHA-256 {audit.integrity.body_sha256 ?? "n/a"}</div>
        </Card>
      </div>
    </div>
  );
}
