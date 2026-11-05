import type { ReactNode } from "react";
import { ORIGIN_LABEL, CLASS_COLOR, CLASS_LABEL, label } from "../lib/labels";
import type { OriginStatus, RecordClass } from "../lib/types";

export function Card({ title, children, actions, id, className = "" }: { title?: string; children: ReactNode; actions?: ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={`rounded-lg border border-line bg-white p-5 ${className}`}>
      {title || actions ? (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title ? <h2 className="text-sm font-semibold uppercase tracking-wide text-bark">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Notice({ tone, title, children }: { tone: "error" | "warn" | "info" | "synthetic" | "ok"; title: string; children?: ReactNode }) {
  const styles = {
    error: "border-clay/40 bg-clay/5 text-[#7a2c1c]",
    warn: "border-ochre/40 bg-ochre/5 text-[#6b4a14]",
    info: "border-moss/30 bg-moss/5 text-moss",
    synthetic: "border-violet/40 bg-violet/5 text-violet",
    ok: "border-leaf/30 bg-leaf/5 text-leaf",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-4 py-3 text-sm ${styles}`}>
      <div className="font-semibold">{title}</div>
      {children ? <div className="mt-1 leading-relaxed">{children}</div> : null}
    </div>
  );
}

export function Pill({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "synthetic" | "violet"; title?: string }) {
  const styles = {
    neutral: "bg-stone-100 text-stone-700 ring-stone-300",
    good: "bg-emerald-50 text-emerald-800 ring-emerald-300",
    warn: "bg-amber-50 text-amber-900 ring-amber-300",
    bad: "bg-rose-50 text-rose-800 ring-rose-300",
    synthetic: "bg-fuchsia-50 text-fuchsia-900 ring-fuchsia-300",
    violet: "bg-violet-50 text-violet-900 ring-violet-300",
  }[tone];
  return <span title={title} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}>{children}</span>;
}

export function OriginBadge({ status }: { status: OriginStatus }) {
  const tone = status === "CORROBORATED" ? "good" : status === "LOCATION_CONFLICT" ? "bad" : status === "INSUFFICIENT_PUBLIC_RECORDS" ? "warn" : "neutral";
  return <Pill tone={tone}>{ORIGIN_LABEL[status]}</Pill>;
}

export function ClassBadge({ value }: { value: RecordClass }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-bark">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CLASS_COLOR[value] }} aria-hidden />
      {CLASS_LABEL[value]}
    </span>
  );
}

export function DataModeBadge({ mode }: { mode: "live" | "cached" | "non_gbif_test_endpoint" | "synthetic" | "manual" | null | undefined }) {
  if (!mode) return <Pill>unknown</Pill>;
  if (mode === "live") return <Pill tone="good">Live GBIF</Pill>;
  if (mode === "cached") return <Pill tone="warn">Cached GBIF</Pill>;
  if (mode === "non_gbif_test_endpoint") return <Pill tone="bad" title="Served by a test or fixture endpoint, not api.gbif.org">NOT GBIF (test endpoint)</Pill>;
  if (mode === "synthetic") return <Pill tone="synthetic">Synthetic sample</Pill>;
  return <Pill tone="neutral">Manually entered</Pill>;
}

export function Stat({ label: l, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-line bg-mist/60 p-3">
      <div className="text-xs text-bark/70">{l}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-bark/60">{hint}</div> : null}
    </div>
  );
}

export function Loading({ children }: { children?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-8 text-sm text-bark/70">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-moss/30 border-t-moss" aria-hidden />
      {children ?? "Loading…"}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line px-6 py-10 text-center">
      <div className="font-medium text-ink">{title}</div>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-bark/70">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-bark/60">{k}</dt>
          <dd className="break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Button({ children, onClick, type = "button", variant = "primary", disabled, href, title }: {
  children: ReactNode; onClick?: () => void; type?: "button" | "submit"; variant?: "primary" | "secondary" | "ghost"; disabled?: boolean; href?: string; title?: string;
}) {
  const styles = {
    primary: "bg-moss text-white hover:bg-[#244a3b] disabled:bg-moss/40",
    secondary: "border border-line bg-white text-ink hover:bg-mist disabled:opacity-50",
    ghost: "text-moss hover:bg-moss/10 disabled:opacity-50",
  }[variant];
  const cls = `inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-moss/50 ${styles}`;
  if (href) return <a href={href} title={title} className={cls}>{children}</a>;
  return <button type={type} onClick={onClick} disabled={disabled} title={title} className={cls}>{children}</button>;
}

export function Table({ headers, children, caption }: { headers: string[]; children: ReactNode; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-bark/60">
            {headers.map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Missing({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-xs text-leaf">none</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((i) => <span key={i} className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">{label(i)}</span>)}
    </span>
  );
}
