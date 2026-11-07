import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { ArchitectureGraph, ArchNode } from "../lib/types";
import { Card, Loading, Notice, Pill, SectionTitle } from "../components/ui";

const COL_W = 230;
const ROW_H = 120;
const NODE_W = 196;
const NODE_H = 78;

export default function ArchitectureStudio() {
  const [graph, setGraph] = useState<ArchitectureGraph | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<string>("conductor");

  useEffect(() => {
    api.architecture().then(setGraph).catch((e: unknown) => setError(e instanceof ApiError ? e : new ApiError(0, "unknown", String(e))));
  }, []);

  const layout = useMemo(() => {
    if (!graph) return new Map<string, { x: number; y: number }>();
    const byCol = new Map<number, ArchNode[]>();
    for (const n of graph.nodes) byCol.set(n.column, [...(byCol.get(n.column) ?? []), n]);
    const pos = new Map<string, { x: number; y: number }>();
    for (const [col, nodes] of byCol) {
      nodes.forEach((n, i) => pos.set(n.id, { x: 24 + (col - 1) * COL_W, y: 24 + i * ROW_H + (nodes.length === 1 ? 0 : 0) }));
    }
    return pos;
  }, [graph]);

  if (error) return <Notice tone="error" title="Architecture could not be loaded">{error.message}</Notice>;
  if (!graph) return <Loading>Loading architecture…</Loading>;
  const node = graph.nodes.find((n) => n.id === selected) ?? graph.nodes[0];
  const width = 24 + 5 * COL_W;
  const height = Math.max(...Array.from(layout.values()).map((p) => p.y)) + NODE_H + 48;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg3">Architecture studio</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">One conductor, many specialist robots</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-fg2">{graph.statement} Select any robot to see what it reads, what it writes and what it must never do.</p>
        </div>
        <Pill tone="good">{graph.nodes.filter((n) => !n.uses_llm).length} of {graph.nodes.length} modules are deterministic code</Pill>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card eyebrow="Data flow" title="Modules and edges" className="overflow-hidden p-0">
          <div className="overflow-x-auto p-4">
            <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: 900 }} role="img" aria-label="Module graph: the conductor sends work to intake, taxonomy and collector robots; their outputs meet in the consistency robot, which feeds the registry, dossier and human review.">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#3fd0a5" opacity="0.7" />
                </marker>
                <linearGradient id="edge" x1="0" x2="1">
                  <stop offset="0" stopColor="#3fd0a5" stopOpacity="0.2" />
                  <stop offset="1" stopColor="#3fd0a5" stopOpacity="0.8" />
                </linearGradient>
              </defs>
              {graph.edges.map(([a, b]) => {
                const pa = layout.get(a), pb = layout.get(b);
                if (!pa || !pb) return null;
                const x1 = pa.x + NODE_W, y1 = pa.y + NODE_H / 2, x2 = pb.x, y2 = pb.y + NODE_H / 2;
                const mx = (x1 + x2) / 2;
                const active = selected === a || selected === b;
                return <path key={`${a}-${b}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={active ? "#3fd0a5" : "url(#edge)"} strokeWidth={active ? 2.2 : 1.4} markerEnd="url(#arrow)" opacity={active ? 1 : 0.7} />;
              })}
              {graph.nodes.map((n) => {
                const p = layout.get(n.id)!;
                const active = selected === n.id;
                return (
                  <g key={n.id} transform={`translate(${p.x},${p.y})`} onClick={() => setSelected(n.id)} className="cursor-pointer" role="button" tabIndex={0}
                     onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelected(n.id); }} aria-pressed={active} aria-label={`${n.name}: ${n.role}`}>
                    <rect width={NODE_W} height={NODE_H} rx="14" fill={active ? "#13241e" : "#0f1816"} stroke={active ? "#3fd0a5" : n.deterministic ? "#28423a" : "#a78bfa"} strokeWidth={active ? 2 : 1.2} />
                    <text x="16" y="28" fill="#e8f1ec" fontSize="13.5" fontWeight="600">{n.name}</text>
                    <text x="16" y="48" fill="#6f8a7f" fontSize="11" fontFamily="ui-monospace, Menlo, monospace">{n.module}</text>
                    <circle cx={NODE_W - 16} cy="20" r="4" fill={n.deterministic ? "#3fd0a5" : "#a78bfa"} />
                    <text x="16" y="88" fill="#a3bcb0" fontSize="10.5">{n.deterministic ? "deterministic code · no LLM" : "human decision"}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </Card>

        <div className="space-y-5">
          <Card eyebrow="Selected robot" title={node.name}>
            <div className="space-y-4 text-[13.5px] leading-relaxed">
              <p className="text-fg">{node.role}</p>
              <div>
                <SectionTitle>Reads</SectionTitle>
                <div className="flex flex-wrap gap-1.5">{node.inputs.map((i) => <Pill key={i}>{i}</Pill>)}</div>
              </div>
              <div>
                <SectionTitle>Writes</SectionTitle>
                <div className="flex flex-wrap gap-1.5">{node.outputs.map((o) => <Pill key={o} tone="info">{o}</Pill>)}</div>
              </div>
              <div className="rounded-lg bg-white/[0.03] p-3 text-[12.5px] text-fg2">
                <span className="font-medium text-fg">Never does:</span> {node.deterministic ? "call a language model, invent a record, or decide origin status by hand." : "close a batch without a named person and a specific audit."}
              </div>
              <div className="font-mono text-[11.5px] text-fg3">{node.module}</div>
            </div>
          </Card>

          <Card eyebrow="Trust" title="Security and closure controls">
            <ul className="space-y-3">
              {graph.security_controls.map((c) => (
                <li key={c.control} className="flex gap-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${c.status === "enforced" ? "bg-brand" : "bg-violet"}`} aria-hidden />
                  <div>
                    <div className="flex items-center gap-2 text-[13px] font-medium text-fg">{c.control}
                      <span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${c.status === "enforced" ? "bg-brand/10 text-brand" : "bg-violet/10 text-violet"}`}>{c.status === "enforced" ? "enforced" : "configure"}</span>
                    </div>
                    <div className="text-[12.5px] leading-relaxed text-fg3">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
