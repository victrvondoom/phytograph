import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { BatchCreate, BatchRead, CollectionType, PlantPart } from "../lib/types";
import { Button, Card, Loading, Notice, Pill } from "../components/ui";

const PLANT_PARTS: PlantPart[] = ["root", "rhizome", "leaf", "flower", "fruit", "seed", "bark", "whole_plant", "resin", "other", "unknown"];
const COLLECTION: CollectionType[] = ["wild-harvested", "cultivated", "unknown"];
const BATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

interface Form {
  batch_id: string; supplier_name: string; declared_botanical_name: string; plant_part: PlantPart; declared_country: string;
  declared_state: string; declared_district: string; latitude: string; longitude: string; collection_date: string;
  collection_type: CollectionType; supplier_batch_reference: string; documents: string;
}

const EMPTY: Form = {
  batch_id: "", supplier_name: "", declared_botanical_name: "", plant_part: "root", declared_country: "India", declared_state: "",
  declared_district: "", latitude: "", longitude: "", collection_date: "", collection_type: "unknown", supplier_batch_reference: "", documents: "",
};

function fromBatch(b: BatchRead): Form {
  return {
    batch_id: b.batch_id, supplier_name: b.supplier_name, declared_botanical_name: b.declared_botanical_name, plant_part: b.plant_part,
    declared_country: b.declared_country, declared_state: b.declared_state ?? "", declared_district: b.declared_district ?? "",
    latitude: b.latitude === null ? "" : String(b.latitude), longitude: b.longitude === null ? "" : String(b.longitude),
    collection_date: b.collection_date ?? "", collection_type: b.collection_type, supplier_batch_reference: b.supplier_batch_reference ?? "",
    documents: b.document_references.join("\n"),
  };
}

/** Client-side checks only improve feedback. The backend re-validates everything and is authoritative. */
function localErrors(f: Form, mode: "create" | "edit"): Record<string, string> {
  const e: Record<string, string> = {};
  if (mode === "create" && !BATCH_ID.test(f.batch_id.trim())) e.batch_id = "Use 3–64 letters, digits, '.', '_' or '-', starting with a letter or digit.";
  if (f.supplier_name.trim().length < 2) e.supplier_name = "Required (at least 2 characters).";
  if (f.declared_botanical_name.trim().length < 3) e.declared_botanical_name = "Required. Use the supplier's scientific name.";
  if (f.declared_country.trim().length < 2) e.declared_country = "Required.";
  const hasLat = f.latitude.trim() !== "", hasLon = f.longitude.trim() !== "";
  if (hasLat !== hasLon) e.longitude = "Enter latitude and longitude together, or leave both empty if unknown.";
  if (hasLat) {
    const lat = Number(f.latitude), lon = Number(f.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) e.latitude = "Latitude must be between -90 and 90.";
    if (hasLon && (!Number.isFinite(lon) || lon < -180 || lon > 180)) e.longitude = "Longitude must be between -180 and 180.";
    if (lat === 0 && Number(f.longitude) === 0) e.longitude = "(0, 0) is not a location. Leave both empty if unknown.";
  }
  if (f.collection_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.collection_date)) e.collection_date = "Use YYYY-MM-DD.";
    else if (f.collection_date > new Date().toISOString().slice(0, 10)) e.collection_date = "Collection date cannot be in the future.";
  }
  return e;
}

function toBody(f: Form): BatchCreate {
  const opt = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    batch_id: f.batch_id.trim(),
    supplier_name: f.supplier_name.trim(),
    declared_botanical_name: f.declared_botanical_name.trim(),
    plant_part: f.plant_part,
    declared_country: f.declared_country.trim(),
    declared_state: opt(f.declared_state),
    declared_district: opt(f.declared_district),
    latitude: f.latitude.trim() === "" ? null : Number(f.latitude),
    longitude: f.longitude.trim() === "" ? null : Number(f.longitude),
    collection_date: opt(f.collection_date),
    collection_type: f.collection_type,
    supplier_batch_reference: opt(f.supplier_batch_reference),
    document_references: f.documents.split("\n").map((d) => d.trim()).filter(Boolean),
    data_origin: "manual",
  };
}

export default function BatchForm({ mode }: { mode: "create" | "edit" }) {
  const { batchId = "" } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState<BatchRead | null>(null);
  const [loading, setLoading] = useState(mode === "edit");
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== "edit") return;
    api.getBatch(batchId)
      .then((b) => { setLoaded(b); setForm(fromBatch(b)); })
      .catch((e: unknown) => setLoadError(e instanceof ApiError ? e : new ApiError(0, "unknown", String(e))))
      .finally(() => setLoading(false));
  }, [mode, batchId]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    const e = localErrors(form, mode);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const body = toBody(form);
      if (mode === "create") {
        const created = await api.createBatch(body);
        navigate(`/batches/${encodeURIComponent(created.batch_id)}/audit`);
      } else {
        const { batch_id: _ignored, ...rest } = body;
        void _ignored;
        await api.updateBatch(batchId, rest);
        navigate(`/batches/${encodeURIComponent(batchId)}/audit`);
      }
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(0, "unknown", String(err));
      setServerError(apiErr);
      if (apiErr.status === 409) setErrors({ batch_id: apiErr.message });
      if (apiErr.code === "validation_error") {
        const mapped: Record<string, string> = {};
        const detail = apiErr.detail as { loc?: unknown[]; msg?: string }[] | null;
        for (const d of detail ?? []) {
          const field = String((d.loc ?? []).slice(-1)[0] ?? "");
          if (field) mapped[field] = d.msg ?? "invalid";
        }
        setErrors(mapped);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading>Loading batch…</Loading>;
  if (loadError) return <Notice tone="error" title="Batch not found or unavailable">{loadError.message}</Notice>;

  const field = (name: keyof Form, labelText: string, props: { required?: boolean; hint?: string; type?: string; as?: "input" | "select" | "textarea"; options?: string[]; placeholder?: string; disabled?: boolean }) => {
    const err = errors[name];
    const common = "mt-1 w-full rounded-md border bg-canvas px-3 py-2 text-sm text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 " + (err ? "border-bad" : "border-edge2");
    return (
      <div>
        <label htmlFor={name} className="block text-sm font-medium text-fg">
          {labelText}
          {props.required ? <span className="text-bad"> *</span> : <span className="text-xs font-normal text-fg3"> (optional)</span>}
        </label>
        {props.as === "select" ? (
          <select id={name} className={common} value={form[name]} onChange={set(name)} disabled={props.disabled} aria-invalid={!!err}>
            {props.options!.map((o) => <option key={o} value={o}>{o.replaceAll("_", " ")}</option>)}
          </select>
        ) : props.as === "textarea" ? (
          <textarea id={name} rows={3} className={common} value={form[name]} onChange={set(name)} placeholder={props.placeholder} aria-invalid={!!err} />
        ) : (
          <input id={name} type={props.type ?? "text"} className={common} value={form[name]} onChange={set(name)} placeholder={props.placeholder} disabled={props.disabled} aria-invalid={!!err} aria-describedby={`${name}-hint`} />
        )}
        <p id={`${name}-hint`} className={err ? "mt-1 text-xs text-bad" : "mt-1 text-xs text-fg3"}>{err ?? props.hint ?? ""}</p>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/batches" className="text-sm text-brand underline">← Batch inbox</Link>
          <h1 className="mt-1 text-xl font-semibold text-fg">{mode === "create" ? "New batch" : `Edit batch ${batchId}`}</h1>
        </div>
        {loaded?.data_origin === "synthetic" ? <Pill tone="synth">Synthetic sample: editing keeps this label</Pill> : null}
      </div>

      <Notice tone="info" title="Enter what the supplier declared">
        Leave an optional field empty when it is unknown. VanaSignal stores it as unknown and never substitutes a default.
      </Notice>

      {serverError && serverError.code !== "validation_error" ? (
        <Notice tone="error" title={serverError.status === 409 ? "Duplicate batch ID" : "The batch was not saved"}>{serverError.message}</Notice>
      ) : null}

      <form onSubmit={submit} noValidate className="space-y-6">
        <Card title="Batch identity">
          <div className="grid gap-5 md:grid-cols-2">
            {field("batch_id", "Batch ID", { required: true, hint: "Unique. Cannot be changed after creation.", disabled: mode === "edit", placeholder: "e.g. SUP-2025-0412" })}
            {field("supplier_batch_reference", "Supplier batch reference", { hint: "The supplier's own reference, if any." })}
            {field("supplier_name", "Supplier name", { required: true })}
            {field("collection_type", "Collection type", { required: true, as: "select", options: COLLECTION, hint: "Use 'unknown' if the supplier did not state it." })}
          </div>
        </Card>

        <Card title="Declared botanical claim">
          <div className="grid gap-5 md:grid-cols-2">
            {field("declared_botanical_name", "Declared botanical name", { required: true, placeholder: "Scientific name, e.g. Decalepis hamiltonii", hint: "Resolved against the GBIF Species API during audit." })}
            {field("plant_part", "Plant part", { required: true, as: "select", options: PLANT_PARTS })}
          </div>
        </Card>

        <Card title="Declared location and date">
          <div className="grid gap-5 md:grid-cols-2">
            {field("declared_country", "Declared country", { required: true })}
            {field("declared_state", "Declared state", { hint: "e.g. Kerala or Tamil Nadu." })}
            {field("declared_district", "Declared district or locality", { hint: "As written by the supplier." })}
            {field("collection_date", "Collection date", { type: "date", hint: "YYYY-MM-DD. Not in the future." })}
            {field("latitude", "Latitude", { type: "text", hint: "Decimal degrees, −90 to 90." })}
            {field("longitude", "Longitude", { type: "text", hint: "Decimal degrees, −180 to 180. Enter with latitude." })}
          </div>
        </Card>

        <Card title="Supporting documents">
          {field("documents", "Document references", { as: "textarea", placeholder: "One reference per line, e.g. harvest permit no. or transfer note id", hint: "References only. VanaSignal does not store or verify the documents themselves." })}
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Link to={mode === "edit" ? `/batches/${encodeURIComponent(batchId)}/audit` : "/batches"} className="text-sm text-fg2 underline">Cancel</Link>
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : mode === "create" ? "Create batch" : "Save changes"}</Button>
        </div>
      </form>
    </div>
  );
}
