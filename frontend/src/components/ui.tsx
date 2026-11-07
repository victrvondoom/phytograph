import type { ReactNode } from "react";
import { CLASS_LABEL, ORIGIN_LABEL } from "../lib/labels";
import type { OriginStatus, RecordClass } from "../lib/types";

export const CLASS_HEX: Record<RecordClass, string> = {
  usable: "#3fd0a5",
  usable_with_caution: "#e0a53a",
  insufficient_for_spatial_check: "#7b8b96",
  invalid: "#e8674f",
  duplicate: "#a78bfa",
};

export function Card({ title, eyebrow, children, actions, id, className = "" }: { title?: string; eyebrow?: string; children: ReactNode; actions?: ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={`rise rounded-2xl border border-edge bg-panel p-5 ${className}`}>
      {title || actions ? (
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            {eyebrow ? <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg3">{eyebrow}</div> : null}
            {title ? <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2> : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export type Tone = "neutral" | "good" | "warn" | "bad" | "synth" | "info" | "violet";
const TONE: Record<Tone, string> = {
  neutral: "bg-white/[0.04] text-fg2 ring-edge2",
  good: "bg-good/10 text-good ring-good/30",
  warn: "bg-warn/10 text-warn ring-warn/30",
  bad: "bg-bad/10 text-bad ring-bad/30",
  synth: "bg-synth/10 text-synth ring-synth/30",
  info: "bg-info/10 text-info ring-info/30",
  violet: "bg-violet/10 text-violet ring-violet/30",
};

export function Pill({ children, tone = "neutral", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function OriginBadge({ status }: { status: OriginStatus }) {
  const tone: Tone = status === "CORROBORATED" ? "good" : status === "LOCATION_CONFLICT" ? "bad" : status === "INSUFFICIENT_PUBLIC_RECORDS" ? "warn" : "neutral";
  return <Pill tone={tone}>{ORIGIN_LABEL[status]}</Pill>;
}

export function ClassBadge({ value }: { value: RecordClass }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-fg2">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: CLASS_HEX[value], boxShadow: `0 0 0 3px ${CLASS_HEX[value]}22` }} aria-hidden />
      {CLASS_LABEL[value]}
    </span>
  );
}

export function DataModeBadge({ mode }: { mode: "live" | "cached" | "non_gbif_test_endpoint" | "synthetic" | "manual" | null | undefined }) {
  if (!mode) return <Pill>unknown source</Pill>;
  if (mode === "live") return <Pill tone="good">Live GBIF</Pill>;
  if (mode === "cached") return <Pill tone="warn" title="Local copy of an earlier response; original retrieval time is shown">Cached GBIF</Pill>;
  if (mode === "non_gbif_test_endpoint") return <Pill tone="bad" title="Served by a test or fixture endpoint, not api.gbif.org">Not GBIF · test endpoint</Pill>;
  if (mode === "synthetic") return <Pill tone="synth">Synthetic sample</Pill>;
  return <Pill>Manually entered</Pill>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-brand" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-fg";
  return (
    <div className="rounded-xl border border-edge bg-panel2 px-4 py-3">
      <div className="text-[11.5px] font-medium text-fg3">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${color}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-fg3">{hint}</div> : null}
    </div>
  );
}

export function Notice({ tone, title, children }: { tone: "error" | "warn" | "info" | "synthetic" | "ok"; title: string; children?: ReactNode }) {
  const style = {
    error: "border-bad/40 bg-bad/[0.07] text-[#ffc2b5]",
    warn: "border-warn/40 bg-warn/[0.07] text-[#f5d9a4]",
    info: "border-info/30 bg-info/[0.06] text-[#c7ecff]",
    synthetic: "border-synth/35 bg-synth/[0.07] text-[#ebd3ff]",
    ok: "border-brand/35 bg-brand/[0.07] text-[#c4f5e4]",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rise rounded-xl border px-4 py-3 text-sm ${style}`}>
      <div className="font-semibold text-fg">{title}</div>
      {children ? <div className="mt-1 leading-relaxed text-fg2">{children}</div> : null}
    </div>
  );
}

export function Loading({ children }: { children?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-10 text-sm text-fg2">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand/25 border-t-brand" aria-hidden />
      {children ?? "Loading…"}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-edge2 px-6 py-10 text-center">
      <div className="font-medium text-fg">{title}</div>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-fg3">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-5 gap-y-2.5 text-[13px]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg3">{k}</dt>
          <dd className="min-w-0 break-words text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Button({ children, onClick, type = "button", variant = "primary", disabled, href, title, download }: {
  children: ReactNode; onClick?: () => void; type?: "button" | "submit"; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; href?: string; title?: string; download?: boolean;
}) {
  const style = {
    primary: "bg-brand text-white hover:bg-[#ff9580] disabled:bg-brand/40 disabled:text-white/70",
    secondary: "border border-edge2 bg-raised text-fg hover:border-brand/50 hover:text-brand disabled:opacity-40",
    ghost: "text-brand hover:bg-brand/10 disabled:opacity-40",
    danger: "bg-bad/90 text-white hover:bg-bad disabled:opacity-40",
  }[variant];
  const cls = `inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed ${style}`;
  if (href) return <a href={href} title={title} download={download} className={cls}>{children}</a>;
  return <button type={type} onClick={onClick} disabled={disabled} title={title} className={cls}>{children}</button>;
}

export function Table({ headers, children, caption, minWidth = 680 }: { headers: string[]; children: ReactNode; caption: string; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-edge">
      <table className="w-full border-collapse text-left text-[13px]" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-panel2">
          <tr className="border-b border-edge text-[11px] font-medium uppercase tracking-wider text-fg3">
            {headers.map((h) => <th key={h} scope="col" className="px-3 py-2.5 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="text-fg2">{children}</tbody>
      </table>
    </div>
  );
}

export function Missing({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-xs text-brand">Nothing missing</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((i) => <span key={i} className="rounded-md bg-warn/10 px-2 py-0.5 text-[11.5px] text-warn ring-1 ring-inset ring-warn/25">{i.replaceAll("_", " ")}</span>)}
    </span>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg3">{children}</h3>;
}
