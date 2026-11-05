import type { ReactNode } from "react";

export function Panel({ title, children, actions, id }: { title: string; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section id={id ? `panel-${id}` : undefined} className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-sm">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: string; tone?: "default" | "warn" | "good" }) {
  const toneClass = tone === "warn" ? "text-amber-300" : tone === "good" ? "text-emerald-300" : "text-slate-100";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function Banner({ tone, title, children }: { tone: "error" | "warn" | "info" | "synthetic"; title: string; children?: ReactNode }) {
  const styles = {
    error: "border-rose-700 bg-rose-950/60 text-rose-100",
    warn: "border-amber-700 bg-amber-950/50 text-amber-100",
    info: "border-sky-800 bg-sky-950/50 text-sky-100",
    synthetic: "border-fuchsia-700 bg-fuchsia-950/60 text-fuchsia-100",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      <div className="font-semibold">{title}</div>
      {children ? <div className="mt-1 text-sm opacity-90">{children}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const styles = {
    neutral: "bg-slate-800 text-slate-200",
    good: "bg-emerald-900/70 text-emerald-200",
    warn: "bg-amber-900/70 text-amber-200",
    bad: "bg-rose-900/70 text-rose-200",
  }[tone];
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function Table({ headers, rows, caption }: { headers: string[]; rows: (ReactNode | string | number)[][]; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="text-xs uppercase tracking-wide text-slate-400">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="border-b border-slate-800 px-2 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="text-slate-200">
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-slate-800/60">
              {cells.map((c, j) => (
                <td key={j} className="px-2 py-2 align-top tabular-nums">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined ? "n/a" : v.toFixed(digits);
}

export function meanSd(d: { mean: number | null; sd: number | null; n: number } | undefined, digits = 3): string {
  if (!d || d.mean === null) return "n/a";
  return `${d.mean.toFixed(digits)} ± ${(d.sd ?? 0).toFixed(digits)}`;
}
