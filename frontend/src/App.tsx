import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/shell/AppShell";
import BatchInbox from "./pages/BatchInbox";
import BatchForm from "./pages/BatchForm";
import AuditWorkspace from "./pages/AuditWorkspace";
import Dossier from "./pages/Dossier";
import ArchitectureStudio from "./pages/ArchitectureStudio";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/batches" replace />} />
        <Route path="/batches" element={<BatchInbox />} />
        <Route path="/batches/new" element={<BatchForm mode="create" />} />
        <Route path="/batches/:batchId/edit" element={<BatchForm mode="edit" />} />
        <Route path="/batches/:batchId/audit" element={<AuditWorkspace />} />
        <Route path="/batches/:batchId/dossier" element={<Dossier />} />
        <Route path="/architecture" element={<ArchitectureStudio />} />
        <Route path="*" element={<div className="text-sm text-fg2">Page not found. <a className="text-brand underline" href="/batches">Back to batches</a>.</div>} />
      </Routes>
    </AppShell>
  );
}
