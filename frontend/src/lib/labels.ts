import type { OriginStatus, RecordClass } from "./types";

export const ORIGIN_LABEL: Record<OriginStatus, string> = {
  CORROBORATED: "Corroborated by public records",
  LOCATION_CONFLICT: "Location conflict in public data",
  INSUFFICIENT_PUBLIC_RECORDS: "Insufficient public records",
  IDENTITY_UNRESOLVED: "Identity unresolved",
  NOT_CHECKED: "Not checked",
};

export const ORIGIN_HELP: Record<OriginStatus, string> = {
  CORROBORATED: "Enough usable public records lie near the declared point. This supports the declared area only; it does not prove this batch's origin.",
  LOCATION_CONFLICT: "Usable public records exist in the search area, but none lies near the declared point. This is a conflict at this scale in public data, not proof that the batch is false.",
  INSUFFICIENT_PUBLIC_RECORDS: "Too few usable public records to compare. Zero records is not evidence of absence.",
  IDENTITY_UNRESOLVED: "No single accepted taxon could be established, so occurrence evidence was not compared.",
  NOT_CHECKED: "The comparison could not be run (missing coordinates, or a service was unavailable).",
};

export const CLASS_LABEL: Record<RecordClass, string> = {
  usable: "Usable",
  usable_with_caution: "Usable with caution",
  insufficient_for_spatial_check: "Insufficient for spatial check",
  invalid: "Invalid",
  duplicate: "Duplicate",
};

export const CLASS_COLOR: Record<RecordClass, string> = {
  usable: "#2f7d5b",
  usable_with_caution: "#c08a2b",
  insufficient_for_spatial_check: "#7b8794",
  invalid: "#b4442f",
  duplicate: "#7a5ea8",
};

export const FIELD_LABEL: Record<string, string> = {
  supplier_name: "Supplier name",
  declared_botanical_name: "Declared botanical name",
  plant_part: "Plant part",
  declared_country: "Declared country",
  declared_state: "Declared state",
  declared_district: "Declared district or locality",
  latitude: "Latitude",
  longitude: "Longitude",
  collection_date: "Collection date",
  collection_type: "Collection type",
  supplier_batch_reference: "Supplier batch reference",
  document_references: "Supporting-document references",
  batch_id: "Batch ID",
};

export function label(v: string | null | undefined): string {
  return (v ?? "").replaceAll("_", " ");
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export const CLASS_DESCRIPTION: Record<RecordClass, string> = {
  usable: "No quality problem the rules detect. Counts toward origin status.",
  usable_with_caution: "Kept and labelled. Reported but not counted toward origin status.",
  insufficient_for_spatial_check: "No coordinates. Cannot inform a spatial check.",
  invalid: "Coordinates are out of range or the (0,0) placeholder.",
  duplicate: "Repeats an identifier or an earlier coordinate and date.",
};
