import type {
  BenchmarkResult,
  Health,
  Region,
  ResolvedSpecies,
  RunListItem,
  SimulationResult,
  Summary,
} from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export interface ApiErrorBody {
  code: string;
  message?: string;
  suggestions?: { key: number; scientific_name: string; rank?: string | null; status?: string | null }[];
  cells?: string[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, { code: "network_error", message: `The VanaSignal API at ${API_BASE} could not be reached.` });
  }
  if (!res.ok) {
    let body: ApiErrorBody = { code: "http_error", message: `HTTP ${res.status}` };
    try {
      const json = await res.json();
      const detail = json?.detail ?? json;
      if (Array.isArray(detail)) {
        body = { code: "invalid_request", message: detail.map((d: { msg?: string }) => d.msg ?? "invalid input").join("; ") };
      } else if (typeof detail === "string") {
        body = { code: "http_error", message: detail };
      } else if (detail && typeof detail === "object") {
        body = detail as ApiErrorBody;
      }
    } catch {
      /* non-JSON error body: keep generic */
    }
    throw new ApiError(res.status, body);
  }
  return res;
}

async function getJson<T>(path: string): Promise<T> {
  return (await send(path)).json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return (await send(path, { method: "POST", body: JSON.stringify(body) })).json() as Promise<T>;
}

export const api = {
  health: () => getJson<Health>("/api/health"),
  regions: () => getJson<Region[]>("/api/regions"),
  listRuns: () => getJson<RunListItem[]>("/api/analyses"),
  getRun: (id: string) => getJson<Summary>(`/api/analyses/${id}`),
  getGrid: (id: string) => getJson<GeoJSON.FeatureCollection>(`/api/analyses/${id}/grid`),
  getOccurrences: (id: string) => getJson<GeoJSON.FeatureCollection>(`/api/analyses/${id}/occurrences`),
  getManifest: (id: string) => getJson<Record<string, unknown>>(`/api/analyses/${id}/manifest`),
  getReport: async (id: string) => (await send(`/api/analyses/${id}/report`)).text(),
  getBenchmark: async (id: string): Promise<BenchmarkResult | null> => {
    try {
      return await getJson<BenchmarkResult>(`/api/analyses/${id}/benchmark`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  resolveSpecies: (name: string) => postJson<ResolvedSpecies>("/api/species/resolve", { name }),
  createAnalysis: (body: unknown) => postJson<Summary>("/api/analyses", body),
  simulate: (id: string, body: unknown) => postJson<SimulationResult>(`/api/analyses/${id}/simulate`, body),
  runBenchmark: (id: string, body: unknown) => postJson<BenchmarkResult>(`/api/analyses/${id}/benchmark`, body),
  exportUrl: (id: string, name: string) => `${API_BASE}/api/analyses/${id}/export/${name}`,
};

export function describeError(err: unknown): { title: string; detail: string; suggestions?: ApiErrorBody["suggestions"] } {
  if (!(err instanceof ApiError)) {
    return { title: "Unexpected error", detail: err instanceof Error ? err.message : String(err) };
  }
  const msg = err.body.message ?? err.message;
  switch (err.body.code) {
    case "gbif_unavailable":
      return {
        title: "GBIF is unreachable from the API server",
        detail: "No analysis was produced. VanaSignal does not substitute cached, example or estimated occurrence data. " + msg,
      };
    case "gbif_error":
      return { title: "GBIF returned an error", detail: msg };
    case "species_not_resolved":
      return { title: "Species name not matched in GBIF", detail: msg, suggestions: err.body.suggestions };
    case "no_records":
      return { title: "No georeferenced present records", detail: msg };
    case "region_too_large":
      return { title: "Region too large for this resolution", detail: msg };
    case "unknown_cells":
      return { title: "Some selected cells are not in this analysis", detail: msg };
    case "network_error":
      return { title: "API not reachable", detail: msg };
    case "invalid_request":
      return { title: "Invalid input", detail: msg };
    default:
      return { title: "Request failed", detail: msg };
  }
}
