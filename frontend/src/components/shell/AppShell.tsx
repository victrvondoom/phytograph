import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api } from "../../lib/api";
import type { AppStatus } from "../../lib/types";

const ICON = {
  batches: "M4 6h16M4 12h16M4 18h10",
  robots: "M12 3a4 4 0 00-4 4v1H6a2 2 0 00-2 2v3a2 2 0 002 2h1v2a4 4 0 008 0v-2h1a2 2 0 002-2v-3a2 2 0 00-2-2h-2V7a4 4 0 00-4-4z",
  architecture: "M5 5h4v4H5zM15 5h4v4h-4zM10 15h4v4h-4zM9 7h6M7 9v6h3M17 9v6h-3",
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#0f1816" stroke="#28423a" />
      <path d="M8 22 L16 8 L24 22" fill="none" stroke="#3fd0a5" strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="16" cy="19" r="2.6" fill="#3fd0a5" />
    </svg>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const location = useLocation();

  useEffect(() => {
    api.status().then((s) => { setStatus(s); setOffline(false); }).catch(() => setOffline(true));
  }, []);

  const nav = [
    { to: "/batches", label: "Batches", icon: ICON.batches, match: "/batches" },
    { to: "/architecture", label: "Architecture studio", icon: ICON.architecture, match: "/architecture" },
  ];

  return (
    <div className="flex h-full min-h-screen">
      <aside className="hidden w-[76px] shrink-0 flex-col items-center gap-3 border-r border-edge bg-panel py-5 md:flex" aria-label="Primary">
        <NavLink to="/batches" aria-label="VanaSignal home" className="mb-3"><Logo /></NavLink>
        {nav.map((n) => {
          const active = location.pathname.startsWith(n.match);
          return (
            <NavLink key={n.to} to={n.to} title={n.label} aria-label={n.label} className={`group relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${active ? "bg-brand/15 text-brand" : "text-fg3 hover:bg-white/[0.05] hover:text-fg"}`}>
              {active ? <span className="absolute -left-[13px] h-6 w-[3px] rounded-r bg-brand" aria-hidden /> : null}
              <Icon d={n.icon} />
            </NavLink>
          );
        })}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-edge bg-canvas/85 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="md:hidden"><Logo /></span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-[15px] font-semibold tracking-tight text-fg">VanaSignal</span>
                  <span className="hidden text-xs text-fg3 sm:inline">Botanical Origin Evidence Gate</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 text-[11.5px]">
              {offline ? <span className="rounded-full bg-bad/10 px-2.5 py-1 text-bad ring-1 ring-inset ring-bad/30">API offline</span> : status ? (
                <>
                  <span className="rounded-full bg-brand/10 px-2.5 py-1 text-brand ring-1 ring-inset ring-brand/25"><span className="sm:hidden">API ●</span><span className="hidden sm:inline">API online · v{status.version}</span></span>
                  <span className={`hidden rounded-full px-2.5 py-1 ring-1 ring-inset md:inline-flex ${status.gbif_is_official ? "bg-brand/10 text-brand ring-brand/25" : "bg-bad/10 text-bad ring-bad/30"}`}>
                    {status.gbif_is_official ? "GBIF: api.gbif.org" : "GBIF: test endpoint (not GBIF)"}
                  </span>
                  <span className={`hidden rounded-full px-2.5 py-1 ring-1 ring-inset lg:inline-flex ${status.write_token_required ? "bg-violet/10 text-violet ring-violet/30" : "bg-white/[0.04] text-fg3 ring-edge2"}`}>
                    {status.write_token_required ? "Writes: token required" : "Writes: open (local)"}
                  </span>
                </>
              ) : <span className="text-fg3">Connecting…</span>}
            </div>
          </div>
          <nav aria-label="Sections" className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `rounded-md px-3 py-1.5 text-[13px] ${isActive ? "bg-brand/15 text-brand" : "text-fg2"}`}>{n.label}</NavLink>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        <footer className="border-t border-edge">
          <div className="mx-auto max-w-[1480px] px-6 py-3 text-[11.5px] leading-relaxed text-fg3">
            Evidence review only. VanaSignal does not establish legal harvesting, medicinal efficacy, sustainable harvesting or population abundance.
            Public records are opportunistic: no record is not absence. Every robot is a view of a deterministic module; none calls a language model.
          </div>
        </footer>
      </div>
    </div>
  );
}
