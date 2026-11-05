"""Command-line entry point for reproducible runs.

    python -m vanasignal.cli analyse --species "Withania somnifera" --bbox 74.8 8.1 77.5 12.8
    python -m vanasignal.cli benchmark --run <run_id> --seeds 20

``analyse`` calls live GBIF (cached under data/cache/gbif). ``benchmark`` reads
the stored evidence bundle of a run; it never fetches anything new.
"""

from __future__ import annotations

import argparse
import json
import sys

import pandas as pd

from . import benchmark as bm
from .config import get_settings
from .gbif import GBIFClient, GBIFError
from .models import AnalysisRequest
from .pipeline import GBIFSource, PipelineOptions, run_analysis
from .spatial import PriorityConfig, land_union


def _analyse(args) -> int:
    s = get_settings()
    client = GBIFClient(s.cache_dir)
    req = AnalysisRequest(
        species=args.species,
        bbox=tuple(args.bbox),
        resolution=args.resolution,
        max_records=args.max_records,
        uncertainty_threshold_m=args.uncertainty_m,
        include_protected=not args.no_protected,
    )
    opts = PipelineOptions(out_root=s.runs_dir, land_mask_path=s.land_mask_path, wdpa_path=s.wdpa_path)
    try:
        summary = run_analysis(req, GBIFSource(client), opts)
    except GBIFError as exc:
        print(f"GBIF request failed: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"run_id": summary["run_id"], "species": summary["resolved_species"]["scientific_name"],
                      "usable_records": summary["quality_audit"]["records_usable"], "run_dir": str(s.runs_dir / summary["run_id"])}, indent=2))
    return 0


def _benchmark(args) -> int:
    s = get_settings()
    run_dir = s.runs_dir / args.run
    summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
    req = summary["request"]
    occ = pd.read_csv(run_dir / "occurrences.csv", dtype={"gbif_id": str})
    usable = occ[occ["quality_weight"] > 0]
    grid = pd.read_csv(run_dir / "grid_metrics.csv", dtype={"cell": str})[["cell", "center_lat", "center_lon"]]
    withheld = bm.withheld_experiment(usable, grid, req["resolution"], args.seeds, args.test_fraction, args.k,
                                      args.coverage_radius_km, PriorityConfig(**summary["priority_config"]))
    quality = bm.quality_experiment(bm.load_raw_records(str(run_dir / "occurrences.csv")), tuple(req["bbox"]),
                                    req["uncertainty_threshold_m"], args.fault_rate, land=land_union(s.land_mask_path))
    result = {"run_id": args.run, "data_source_kind": summary.get("data_source_kind"),
              "parameters": {"seeds": args.seeds, "test_fraction": args.test_fraction, "k": args.k,
                             "coverage_radius_km": args.coverage_radius_km, "fault_rate": args.fault_rate},
              "withheld_observation": withheld, "quality_detection": quality}
    (run_dir / "benchmark.json").write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    print(f"Wrote {run_dir / 'benchmark.json'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="vanasignal")
    sub = parser.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("analyse", help="Run the live GBIF analysis for a species and region")
    a.add_argument("--species", required=True)
    a.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("MIN_LON", "MIN_LAT", "MAX_LON", "MAX_LAT"))
    a.add_argument("--resolution", type=int, default=5)
    a.add_argument("--max-records", type=int, default=3000)
    a.add_argument("--uncertainty-m", type=float, default=5000.0)
    a.add_argument("--no-protected", action="store_true")
    a.set_defaults(func=_analyse)

    b = sub.add_parser("benchmark", help="Run the benchmarks on a stored analysis run")
    b.add_argument("--run", required=True)
    b.add_argument("--seeds", type=int, default=20)
    b.add_argument("--test-fraction", type=float, default=0.3)
    b.add_argument("--k", type=int, nargs="+", default=[5, 10])
    b.add_argument("--coverage-radius-km", type=float, default=50.0)
    b.add_argument("--fault-rate", type=float, default=0.1)
    b.set_defaults(func=_benchmark)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
