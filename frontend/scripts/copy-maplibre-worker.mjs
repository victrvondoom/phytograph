// MapLibre runs geometry work in a Web Worker that must be served as a static file. Copy it to public/
// at install time so the worker URL resolves on the same origin (no third-party requests).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "public"), { recursive: true });
copyFileSync(join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"), join(root, "public", "maplibre-gl-worker.mjs"));
console.log("copied maplibre worker to public/");
