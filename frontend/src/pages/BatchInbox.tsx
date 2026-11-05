import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { FIELD_LABEL } from "../lib/labels";
import type { BatchRead } from "../lib/types";
import { Button, Card, DataModeBadge, Empty, Loading, Missing, Notice, OriginBadge, Pill, Table } from "../components/ui";

export default function BatchInbox() {
  const [batches, setBatches] = useState<BatchRead[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.listBatches().then(setBatches).catch((e: unknown) => setError(e instanceof ApiError ? e : new ApiError(0, "unknown", String(e))));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Batch inbox</h1>
          <p className="mt-1 max-w-2xl text-sm text-bark/70">
            Each batch is a supplier claim. Open its audit to compare the declared botanical identity and location with public GBIF evidence, and see what is still missing.
          </p>
        </div>
        <Button href="/batches/new">New batch</Button>
      </div>

      {error ? (
        <Notice tone="error" title="Could not load batches">
          {error.message} <button className="ml-2 underline" onClick={load}>Retry</button>
        </Notice>
      ) : null}

      <Card>
        {batches === null && !error ? <Loading>Loading batches from the local database…</Loading> : null}
        {batches !== null && batches.length === 0 ? (
          <Empty title="No batches yet" action={<Button href="/batches/new">Create a batch</Button>}>
            Create a batch from a supplier claim, or ask an administrator to load the labelled synthetic sample batches.
          </Empty>
        ) : null}
        {batches && batches.length > 0 ? (
          <Table caption="Batches" headers={["Batch", "Supplier", "Declared botanical name", "Location", "Data", "Completeness", "Missing evidence", "Latest audit", ""]}>
            {batches.map((b) => (
              <tr key={b.batch_id} className="border-b border-line/70 align-top hover:bg-mist/50">
                <td className="px-3 py-3 font-mono text-xs text-ink">{b.batch_id}</td>
                <td className="px-3 py-3 text-ink">{b.supplier_name}</td>
                <td className="px-3 py-3 italic text-ink">{b.declared_botanical_name}</td>
                <td className="px-3 py-3 text-bark">
                  {[b.declared_district, b.declared_state, b.declared_country].filter(Boolean).join(", ")}
                  <div className="text-xs text-bark/60">
                    {b.latitude !== null && b.longitude !== null ? `${b.latitude}, ${b.longitude}` : "coordinates unknown"}
                  </div>
                </td>
                <td className="px-3 py-3"><DataModeBadge mode={b.data_origin} /></td>
                <td className="px-3 py-3 tabular-nums text-ink">{Math.round(b.completeness.completeness_share * 100)}%</td>
                <td className="px-3 py-3">
                  <Missing items={[...b.completeness.required_missing.map((f) => FIELD_LABEL[f] ?? f), ...b.completeness.optional_missing.map((f) => FIELD_LABEL[f] ?? f)].slice(0, 6)} />
                  {b.completeness.required_missing.length > 0 ? (
                    <div className="mt-1 text-xs text-clay">{b.completeness.required_missing.length} required field(s) missing</div>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  {b.latest_audit ? (
                    <div className="space-y-1">
                      <OriginBadge status={b.latest_audit.origin_status} />
                      <div className="text-xs text-bark/60">{new Date(b.latest_audit.created_at).toLocaleString()}</div>
                    </div>
                  ) : (
                    <Pill>Not audited</Pill>
                  )}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="flex gap-2">
                    <Link className="rounded-md bg-moss px-3 py-1.5 text-xs font-medium text-white hover:bg-[#244a3b]" to={`/batches/${encodeURIComponent(b.batch_id)}/audit`}>Open audit</Link>
                    <Link className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-mist" to={`/batches/${encodeURIComponent(b.batch_id)}/edit`}>Edit</Link>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Card>
      <p className="text-xs text-bark/60">Missing optional fields are shown as unknown. VanaSignal never fills them with defaults.</p>
      {batches?.some((b) => b.data_origin === "synthetic") ? (
        <Notice tone="synthetic" title="Some batches are SYNTHETIC demonstration samples">
          They describe invented shipments for demonstration. Their evidence must not be read as a real supplier claim.
        </Notice>
      ) : null}
    </div>
  );
}
