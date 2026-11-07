import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { FIELD_LABEL } from "../lib/labels";
import type { BatchRead } from "../lib/types";
import PortfolioMap from "../components/PortfolioMap";
import { Button, Card, DataModeBadge, Empty, Loading, Missing, Notice, OriginBadge, Pill, Stat, Table } from "../components/ui";

export default function BatchInbox() {
  const [batches, setBatches] = useState<BatchRead[] | null>(null);
  const [reviews, setReviews] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.listBatches()
      .then((list) => {
        setBatches(list);
        list.filter((b) => b.latest_audit).forEach((b) => {
          api.reviewState(b.batch_id).then((r) => setReviews((m) => ({ ...m, [b.batch_id]: r.state }))).catch(() => undefined);
        });
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e : new ApiError(0, "unknown", String(e))));
  }, []);

  useEffect(load, [load]);

  const stats = useMemo(() => {
    const list = batches ?? [];
    return {
      total: list.length,
      audited: list.filter((b) => b.latest_audit).length,
      open: list.filter((b) => b.latest_audit && reviews[b.batch_id] !== "CLOSED").length,
      synthetic: list.filter((b) => b.data_origin === "synthetic").length,
    };
  }, [batches, reviews]);

  return (
    <div className="space-y-6">
      <section className="rise relative overflow-hidden rounded-3xl text-white shadow-[0_18px_50px_-24px_rgba(20,48,20,0.55)]">
        <img src="/hero/landscape.jpg" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#143014]/92 via-[#143014]/55 to-[#143014]/10" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-6 px-8 py-10 sm:px-10 sm:py-14">
          <div className="max-w-3xl">
            <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#aebe3b]">VanaSignal · Botanical Origin Evidence Gate</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-[52px] sm:leading-[1.05]">Verify the origin of every batch</h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/90">Each batch is a supplier claim. Compare the declared identity and location with public GBIF evidence, and see what is still missing before a decision.</p>
          </div>
          <div className="flex gap-3">
            <Button href="/batches/new">New batch</Button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Batches" value={stats.total} />
        <Stat label="Audited" value={stats.audited} hint="with a stored audit" />
        <Stat label="Awaiting a decision" value={stats.open} tone={stats.open > 0 ? "warn" : undefined} hint="no named decision yet" />
        <Stat label="Synthetic samples" value={stats.synthetic} hint="labelled demonstration data" />
      </div>

      {error ? <Notice tone="error" title="Could not load batches">{error.message} <button className="ml-2 underline" onClick={load}>Retry</button></Notice> : null}

      {batches && batches.length > 0 ? (
        <Card eyebrow="Map" title="Where the declared claims sit" actions={<span className="text-[12px] text-fg3">Colour shows the latest audited origin status. Click a point to open its audit.</span>}>
          <PortfolioMap batches={batches} />
        </Card>
      ) : null}

      <Card>
        {batches === null && !error ? <Loading>Loading batches…</Loading> : null}
        {batches !== null && batches.length === 0 ? (
          <Empty title="No batches yet" action={<Button href="/batches/new">Create a batch</Button>}>Create a batch from a supplier claim.</Empty>
        ) : null}
        {batches && batches.length > 0 ? (
          <Table caption="Batches" headers={["Batch", "Supplier", "Declared botanical name", "Location", "Data", "Completeness", "Missing evidence", "Latest audit", "Review", ""]} minWidth={1100}>
            {batches.map((b) => (
              <tr key={b.batch_id} className="border-b border-edge/60 align-top transition-colors hover:bg-white/[0.025]">
                <td className="whitespace-nowrap px-3 py-3.5 font-mono text-[12px] text-fg">{b.batch_id}</td>
                <td className="px-3 py-3.5 text-fg">{b.supplier_name}</td>
                <td className="px-3 py-3.5 italic text-fg">{b.declared_botanical_name}</td>
                <td className="px-3 py-3.5">
                  <div className="text-fg2">{[b.declared_district, b.declared_state, b.declared_country].filter(Boolean).join(", ")}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-fg3">{b.latitude !== null && b.longitude !== null ? `${b.latitude}, ${b.longitude}` : "coordinates unknown"}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-3.5"><DataModeBadge mode={b.data_origin} /></td>
                <td className="px-3 py-3.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#143014]/[0.07]"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(b.completeness.completeness_share * 100)}%` }} /></div>
                    <span className="tabular-nums text-fg">{Math.round(b.completeness.completeness_share * 100)}%</span>
                  </div>
                </td>
                <td className="px-3 py-3.5">
                  {(() => {
                    const all = [...b.completeness.required_missing, ...b.completeness.optional_missing].map((f) => FIELD_LABEL[f] ?? f);
                    return all.length === 0 ? <Missing items={[]} /> : (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Missing items={all.slice(0, 2)} />
                        {all.length > 2 ? <span className="text-[11.5px] text-fg3">+{all.length - 2} more</span> : null}
                      </span>
                    );
                  })()}
                  {b.completeness.required_missing.length > 0 ? <div className="mt-1 text-[11.5px] text-bad">{b.completeness.required_missing.length} required missing</div> : null}
                </td>
                <td className="px-3 py-3.5 whitespace-nowrap">
                  {b.latest_audit ? (
                    <div className="space-y-1.5"><OriginBadge status={b.latest_audit.origin_status} /><div className="text-[11px] text-fg3">{new Date(b.latest_audit.created_at).toLocaleString()}</div></div>
                  ) : <Pill>Not audited</Pill>}
                </td>
                <td className="px-3 py-3.5">
                  {b.latest_audit ? <Pill tone={reviews[b.batch_id] === "CLOSED" ? "good" : "warn"}>{reviews[b.batch_id] === "CLOSED" ? "Closed" : "Open"}</Pill> : <span className="text-[12px] text-fg3">—</span>}
                </td>
                <td className="px-3 py-3.5 whitespace-nowrap">
                  <div className="flex gap-2">
                    <Link className="rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#ff9580]" to={`/batches/${encodeURIComponent(b.batch_id)}/audit`}>Open audit</Link>
                    <Link className="rounded-lg border border-edge2 px-3 py-1.5 text-[12px] font-medium text-fg2 hover:border-sky/60 hover:text-brand" to={`/batches/${encodeURIComponent(b.batch_id)}/edit`}>Edit</Link>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Card>
      <p className="text-[12px] text-fg3">Missing optional fields are shown as unknown. VanaSignal never fills them with defaults.</p>
      {stats.synthetic > 0 ? <Notice tone="synthetic" title="Some batches are synthetic demonstration samples">They describe invented shipments. Their evidence must not be read as a real supplier claim.</Notice> : null}
    </div>
  );
}
