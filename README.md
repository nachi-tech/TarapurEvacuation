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
## 1) Local preview

Use any static server. Example with Python:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/docs/
```

## Notes

- Data files are generated in `docs/data/`:
  - `roads.geojson`
  - `buildings.geojson`
  - `edge_timeseries.json`
  - `summary_timeseries.json`
  - `building_evacuation_step.json`
  - `meta.json`
- The visualization's **Scenario** selector is currently a UI selector only. Existing exported runs are treated as **night-time** .
- Sim run will have option for Day time and Night time Evacuation
- Modes of evacuation will have options for 'Roads only', 'Roads and Railways', 'Roads, Railways and High Speed Rail'.

- Current dynamic-routing runs use the newer behavioural routing framework,
  including same-exit reroutes before exit switching and richer reroute
  decision logging.

- The simulation runner accepts a routing-style switch:

```bash
python scripts/run_simulation_prototype.py --routing-mode static
python scripts/run_simulation_prototype.py --routing-mode dynamic
python scripts/run_simulation_prototype.py --routing-mode hydraulic_static
```

- Hydraulic routing is currently most complete in the `python_queue` backend,
  and now also has a first `hydraulic_static` libsumo path.

- Dynamic-routing and hydraulic-routing runs may produce additional backend
  diagnostics such as `reroute_events.csv`, `merge_event_log.csv`, and updated
  `vehicle_trip_log.csv` fields showing route versions and reroute counts.

- Hydraulic runs may additionally emit:
  - `hydraulic_component_diagnostics.csv`
  - `hydraulic_route_decisions.csv`
  - `hydraulic_split_probabilities.csv`
  - `hydraulic_mass_balance.csv`
  - `hydraulic_scan_stats.csv`

- The simulation runner still accepts a top-level road narrowing toggle without running anything automatically, for example:

```bash
python scripts/run_simulation_prototype.py --crash-enabled false
```


These flags can be prepared in the visualisation but are optional for now. 