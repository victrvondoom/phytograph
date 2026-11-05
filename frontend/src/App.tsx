import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import BatchInbox from "./pages/BatchInbox";
import BatchForm from "./pages/BatchForm";
import AuditWorkspace from "./pages/AuditWorkspace";
import Dossier from "./pages/Dossier";

export default function App() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-5 py-3">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="text-lg font-semibold tracking-tight text-moss">VanaSignal</span>
              <span className="text-xs text-bark/60">Botanical Origin Evidence Gate</span>
            </div>
            <p className="text-xs text-bark/60">Check whether the evidence supports a batch's origin claim. Not a legal or certification determination.</p>
          </div>
          <nav aria-label="Primary" className="flex gap-1">
            <NavLink to="/batches" className={({ isActive }) => `rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-moss text-white" : "text-bark hover:bg-mist"}`}>Batch inbox</NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/batches" replace />} />
          <Route path="/batches" element={<BatchInbox />} />
          <Route path="/batches/new" element={<BatchForm mode="create" />} />
          <Route path="/batches/:batchId/edit" element={<BatchForm mode="edit" />} />
          <Route path="/batches/:batchId/audit" element={<AuditWorkspace />} />
          <Route path="/batches/:batchId/dossier" element={<Dossier />} />
          <Route path="*" element={<div className="text-sm text-bark">Page not found. <NavLink className="text-moss underline" to="/batches">Back to the batch inbox</NavLink>.</div>} />
        </Routes>
      </main>
      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-[1400px] px-5 py-3 text-xs text-bark/60">
          Evidence review only. VanaSignal does not establish legal harvesting, medicinal efficacy, sustainable harvesting or population abundance. Public biodiversity records are opportunistic: no record is not absence.
        </div>
      </footer>
    </div>
  );
}
