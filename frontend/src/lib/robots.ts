import type { AuditReport } from "./types";

/**
 * Presentation mapping only. Each robot is a view of one deterministic backend module. Its state is read from
 * the recorded audit (timeline + results). No scientific conclusion is computed here.
 */
export type RobotId = "conductor" | "intake" | "taxonomy" | "collector" | "quality" | "consistency" | "registry" | "dossier";
export type RobotState = "idle" | "running" | "ok" | "attention" | "failed" | "skipped";

export interface RobotInfo {
  id: RobotId;
  name: string;
  job: string;
  module: string;
}

export const ROBOTS: RobotInfo[] = [
  { id: "conductor", name: "Conductor", job: "One voice: orders the work and keeps the timeline", module: "origin/audit.py" },
  { id: "intake", name: "Intake", job: "Reads the batch and measures documentation completeness", module: "origin/batches.py" },
  { id: "taxonomy", name: "Taxonomy", job: "Resolves the declared name with GBIF Species", module: "origin/taxonomy.py" },
  { id: "collector", name: "Collector", job: "Fetches GBIF occurrence records around the declared point", module: "origin/occurrences.py" },
  { id: "quality", name: "Quality", job: "Classifies every record with explicit reasons", module: "origin/record_quality.py" },
  { id: "consistency", name: "Consistency", job: "Maps evidence to one origin status", module: "origin/consistency.py" },
  { id: "registry", name: "Registry", job: "Stores each finding with its source and limits", module: "origin/registry.py" },
  { id: "dossier", name: "Dossier", job: "Finalises the report and its integrity hash", module: "origin/dossier.py" },
];

export const WORKERS = ROBOTS.filter((r) => r.id !== "conductor");

export const STATE_LABEL: Record<RobotState, string> = {
  idle: "waiting",
  running: "working",
  ok: "done",
  attention: "needs review",
  failed: "failed",
  skipped: "not run",
};

/** Derive each robot's state from a stored audit. Returns idle for everything when no audit exists. */
export function robotStates(audit: AuditReport | null, batchComplete: boolean | null): Record<RobotId, RobotState> {
  const s: Record<RobotId, RobotState> = {
    conductor: "idle", intake: "idle", taxonomy: "idle", collector: "idle", quality: "idle", consistency: "idle", registry: "idle", dossier: "idle",
  };
  if (!audit) return s;
  const step = (name: string) => audit.timeline.find((t) => t.name === name);
  const map = (st: string | undefined): RobotState => (st === "ok" ? "ok" : st === "failed" ? "failed" : st === "skipped" ? "skipped" : "idle");

  s.conductor = audit.timeline.some((t) => t.status === "failed") ? "attention" : "ok";
  s.intake = batchComplete === false ? "attention" : map(step("batch_snapshot")?.status);

  const tax = audit.taxonomy?.resolution_status;
  s.taxonomy = !tax ? map(step("taxonomy_resolution")?.status) : tax === "RESOLVED" || tax === "SYNONYM_RESOLVED" ? "ok" : "attention";

  s.collector = map(step("occurrence_retrieval")?.status);
  if (s.collector === "ok" && audit.occurrence_search?.data_mode !== "live") s.collector = "attention";

  const q = audit.quality?.counts;
  s.quality = !q ? map(step("occurrence_quality")?.status) : q.invalid + q.duplicate > 0 ? "attention" : "ok";

  const o = audit.origin.status;
  s.consistency = o === "CORROBORATED" ? "ok" : o === "NOT_CHECKED" ? "skipped" : "attention";

  s.registry = audit.findings.length > 0 ? "ok" : "idle";
  s.dossier = audit.findings.length > 0 ? "ok" : "idle";
  return s;
}
