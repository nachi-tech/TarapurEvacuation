# Tarapur Evacuation Web Visualization (GitHub Pages)

This folder contains a static browser visualization for evacuation dynamics:

- OSM tile basemap (Google Maps-like visual style)
- Full OSMnx-derived road network with discrete congestion classes
  - Green: `0.00–0.25`
  - Orange: `>0.25–0.50`
  - Red: `>0.50–1.00`
- Buildings:
  - Red = occupied / not fully evacuated
  - Green = fully evacuated (all building vehicles exited)
- Population evacuated tracker (%)
- Time slider + Play/Pause animation
- Display selector for roads / buildings / both
- Scenario selector in the UI (current exported results are night-only unless a day dataset is exported separately)

## 1) Regenerate web data bundle

Run from repository root:

```bash
python scripts/export_web_visualization_data.py --run-id build_0001 --out-dir docs/data --building-mode polygon
```

You can swap `--run-id` to any simulation run under `outputs/simulation_runs/`.

Simulation runs can now represent different routing scenarios. For example:

```bash
python scripts/run_simulation_prototype.py --run-id build_static_001 --routing-mode static
python scripts/run_simulation_prototype.py --run-id build_dynamic_001 --routing-mode dynamic
python scripts/export_web_visualization_data.py --run-id build_dynamic_001 --out-dir docs/data --building-mode polygon
```

By default, the exporter now emits **building polygons**. You can still request centroids explicitly with:

```bash
python scripts/export_web_visualization_data.py --run-id build_0001 --out-dir docs/data --building-mode centroid
```

## 2) Local preview

Use any static server. Example with Python:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/docs/
```

## 3) Deploy to GitHub Pages

### Option A (recommended): deploy from `/docs` on `main`
1. Push changes to your GitHub repository.
2. In GitHub: **Settings → Pages**.
3. Set:
   - **Source**: "Deploy from a branch"
   - **Branch**: `main`
   - **Folder**: `/docs`
4. Save and wait for deployment.

Your app will be available at:

```text
https://<your-username>.github.io/<your-repo>/
```

## Notes

- Data files are generated in `docs/data/`:
  - `roads.geojson`
  - `buildings.geojson`
  - `edge_timeseries.json`
  - `summary_timeseries.json`
  - `building_evacuation_step.json`
  - `meta.json`
- The visualization's **Scenario** selector is currently a UI selector only. Existing exported runs are treated as **night-time** unless you later export a separate day dataset.
- The simulation runner accepts a routing-style switch:

```bash
python scripts/run_simulation_prototype.py --routing-mode static
python scripts/run_simulation_prototype.py --routing-mode dynamic
```

- Dynamic-routing runs may produce additional backend diagnostics such as `reroute_events.csv`, `merge_event_log.csv`, and updated `vehicle_trip_log.csv` fields showing route versions and reroute counts.

- The simulation runner still accepts a top-level road narrowing toggle without running anything automatically, for example:

```bash
python scripts/run_simulation_prototype.py --crash-enabled false
```

- If you need lighter payload size, reduce features or add geometry simplification in export settings.
