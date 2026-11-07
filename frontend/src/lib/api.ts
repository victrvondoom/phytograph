import type { ArchitectureGraph, AppStatus, AuditListItem, AuditReport, BatchCreate, BatchRead, OccurrenceSearchResult, ReviewOut, ReviewState, TaxonomyResolution } from "./types";

/** All requests go to the same origin (proxied to the backend). The browser never calls GBIF directly. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: unknown;

  constructor(status: number, code: string, message: string, detail: unknown = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "network_error", "The VanaSignal API could not be reached. Check that the backend is running.");
  }
  if (!res.ok) {
    let code = "http_error";
    let message = `Request failed (HTTP ${res.status}).`;
    let detail: unknown = null;
    try {
      const body = await res.json();
      detail = body?.detail ?? body;
      if (Array.isArray(body?.detail)) {
        code = "validation_error";
        message = body.detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg ?? "invalid"}`).join("; ");
      } else if (body?.detail && typeof body.detail === "object") {
        code = body.detail.code ?? code;
        message = body.detail.message ?? message;
      } else if (typeof body?.detail === "string") {
        message = body.detail;
      }
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, code, message, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listBatches: () => request<BatchRead[]>("/api/batches"),
  getBatch: (id: string) => request<BatchRead>(`/api/batches/${encodeURIComponent(id)}`),
  createBatch: (body: BatchCreate) => request<BatchRead>("/api/batches", { method: "POST", body: JSON.stringify(body) }),
  updateBatch: (id: string, body: Omit<BatchCreate, "batch_id">) =>
    request<BatchRead>(`/api/batches/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  runAudit: (id: string, refresh = false) =>
    request<AuditReport>(`/api/batches/${encodeURIComponent(id)}/audit?refresh=${refresh}`, { method: "POST" }),
  getAudit: (id: string) => request<AuditReport>(`/api/batches/${encodeURIComponent(id)}/audit`),
  auditHistory: (id: string) => request<AuditListItem[]>(`/api/batches/${encodeURIComponent(id)}/audits`),
  verifyIntegrity: (id: string) => request<{ verified: boolean }>(`/api/integrity/${encodeURIComponent(id)}`),
  resolveTaxon: (name: string, confirmKey?: number) => {
    const q = new URLSearchParams({ name });
    if (confirmKey) q.set("confirm_key", String(confirmKey));
    return request<TaxonomyResolution>(`/api/taxonomy/resolve?${q.toString()}`);
  },
  searchOccurrences: (p: { taxonKey: number; lat: number; lon: number; radiusKm?: number }) => {
    const q = new URLSearchParams({ taxon_key: String(p.taxonKey), lat: String(p.lat), lon: String(p.lon), radius_km: String(p.radiusKm ?? 100) });
    return request<OccurrenceSearchResult>(`/api/occurrences/search?${q.toString()}`);
  },
  status: () => request<AppStatus>("/api/status"),
  architecture: () => request<ArchitectureGraph>("/api/architecture"),
  reviewState: (id: string) => request<ReviewState>(`/api/batches/${encodeURIComponent(id)}/review`),
  addReview: (id: string, body: { audit_id: string; decision: ReviewOut["decision"]; reviewer: string; note: string }) =>
    request<ReviewOut>(`/api/batches/${encodeURIComponent(id)}/reviews`, { method: "POST", body: JSON.stringify(body) }),
  csvUrl: (id: string) => `/api/batches/${encodeURIComponent(id)}/audit/records.csv`,
  regionGeoJson: () => request<GeoJSON.Feature>("/api/context/demonstration-region"),
  landGeoJsonUrl: "/api/context/land",
  exportUrl: (id: string, format: "json" | "md") => `/api/batches/${encodeURIComponent(id)}/audit/export.${format}`,
};
