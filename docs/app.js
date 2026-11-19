const ROAD_GREEN = "#2ecc71";
const ROAD_ORANGE = "#f39c12";
const ROAD_RED = "#e74c3c";
const BUILDING_GREEN = "#2ecc71";
const BUILDING_RED = "#e74c3c";
const BUILDING_OUTLINE = "#24344d";
const NIGHT_SCENARIO = "night";

const state = {
  map: null,
  roadsLayer: null,
  buildingsLayer: null,
  edgeTimeseries: null,
  summaryTimeseries: null,
  buildingEvacStep: null,
  meta: null,
  steps: [],
  currentIndex: 0,
  timerId: null,
  roadLayersByEdgeId: new Map(),
  buildingLayersById: new Map(),
  displayMode: "both",
  scenarioMode: NIGHT_SCENARIO,
};

function roadColor(occupancyRatio) {
  if (occupancyRatio <= 0.25) return ROAD_GREEN;
  if (occupancyRatio <= 0.5) return ROAD_ORANGE;
  return ROAD_RED;
}

function buildingIsEvacuated(buildingId, step) {
  const evacStep = state.buildingEvacStep[buildingId];
  if (evacStep === null || evacStep === undefined) return false;
  return step >= evacStep;
}

function initMap() {
  state.map = L.map("map", {
    preferCanvas: true,
  }).setView([19.834, 72.69], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(state.map);
}

async function loadJson(path) {
  // Avoid stale browser cache when regenerating docs/data/ JSON between runs.
  const cacheBust = `cacheBust=${Date.now()}`;
  const url = path + (path.includes("?") ? "&" : "?") + cacheBust;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load ${path}: ${res.status}`);
  }
  return res.json();
}

async function loadJsonParts(manifestPath) {
  const manifest = await loadJson(manifestPath);
  if (!Array.isArray(manifest.parts) || manifest.parts.length === 0) {
    throw new Error(`Invalid edge-timeseries manifest: ${manifestPath}`);
  }

  const partTexts = await Promise.all(
    manifest.parts.map(async (part) => {
      if (typeof part !== "string") {
        throw new Error(`Invalid edge-timeseries part in ${manifestPath}`);
      }

      const cacheBust = `cacheBust=${Date.now()}`;
      const res = await fetch(`./data/${part}?${cacheBust}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load ./data/${part}: ${res.status}`);
      }
      return res.text();
    }),
  );

  return JSON.parse(partTexts.join(""));
}

async function loadGeoJson(path) {
  return loadJson(path);
}

function styleRoadFeature(feature) {
  return {
    color: ROAD_GREEN,
    weight: 2.2,
    opacity: 0.95,
  };
}

function buildingStyleOptions(evacuated = false, isPoint = false) {
  const fillColor = evacuated ? BUILDING_GREEN : BUILDING_RED;

  if (isPoint) {
    return {
      radius: 3,
      color: "#00000000",
      fillColor,
      fillOpacity: 0.75,
      weight: 0.2,
    };
  }

  return {
    color: BUILDING_OUTLINE,
    fillColor,
    fillOpacity: 0.55,
    weight: 0.6,
  };
}

function applyBuildingStyle(layer, evacuated) {
  const isPointLayer = layer instanceof L.CircleMarker || layer instanceof L.Circle;
  layer.setStyle(buildingStyleOptions(evacuated, isPointLayer));
}

function setupRoadLayer(roadsGeoJson) {
  state.roadsLayer = L.geoJSON(roadsGeoJson, {
    style: styleRoadFeature,
    onEachFeature: (feature, layer) => {
      const eid = String(feature.properties.edge_id);
      state.roadLayersByEdgeId.set(eid, layer);
      layer.bindTooltip(`Edge: ${eid}`);
    },
  }).addTo(state.map);
}

function setupBuildingsLayer(buildingsGeoJson) {
  state.buildingsLayer = L.geoJSON(buildingsGeoJson, {
    style: () => buildingStyleOptions(false, false),
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, buildingStyleOptions(false, true)),
    onEachFeature: (feature, layer) => {
      const bid = String(feature.properties.building_id);
      const pop = Number(feature.properties.pop_alloc || 0);
      state.buildingLayersById.set(bid, layer);
      layer.bindTooltip(`Building ${bid}<br/>Population: ${pop.toFixed(0)}`);
    },
  }).addTo(state.map);
}

function setLayerVisibility(layer, visible) {
  if (!layer || !state.map) return;

  const isVisible = state.map.hasLayer(layer);
  if (visible && !isVisible) {
    layer.addTo(state.map);
  } else if (!visible && isVisible) {
    state.map.removeLayer(layer);
  }
}

function fitBounds() {
  const visibleBounds = [];

  if (state.roadsLayer && state.map.hasLayer(state.roadsLayer)) {
    visibleBounds.push(state.roadsLayer.getBounds());
  }

  if (state.buildingsLayer && state.map.hasLayer(state.buildingsLayer)) {
    visibleBounds.push(state.buildingsLayer.getBounds());
  }

  if (!visibleBounds.length) {
    return;
  }

  const combined = visibleBounds[0].pad(0);
  for (let i = 1; i < visibleBounds.length; i += 1) {
    combined.extend(visibleBounds[i]);
  }

  if (combined.isValid()) {
    state.map.fitBounds(combined, { padding: [10, 10] });
  }
}

function updateRoadStyles(stepIndex) {
  const edgeIds = state.edgeTimeseries.edge_ids;
  const matrix = state.edgeTimeseries.occupancy_pct_matrix;
  const row = matrix[stepIndex] || [];

  for (let i = 0; i < edgeIds.length; i += 1) {
    const eid = String(edgeIds[i]);
    const occPct = Number(row[i] || 0);
    const ratio = occPct / 100.0;
    const layer = state.roadLayersByEdgeId.get(eid);
    if (!layer) continue;

    layer.setStyle({ color: roadColor(ratio) });
    layer.bindTooltip(`Edge: ${eid}<br/>Occupancy: ${(ratio * 100).toFixed(0)}%`);
  }
}

function updateBuildingStyles(stepValue) {
  for (const [buildingId, layer] of state.buildingLayersById.entries()) {
    const evacuated = buildingIsEvacuated(buildingId, stepValue);
    applyBuildingStyle(layer, evacuated);
  }
}

function formatScenarioLabel(value) {
  return value === "day" ? "Day" : "Night";
}

function updateScenarioUi() {
  const scenarioStatusEl = document.getElementById("scenarioStatus");
  const datasetLabelEl = document.getElementById("datasetLabel");
  const scenarioLabel = formatScenarioLabel(state.scenarioMode);
  const buildingMode = state.meta?.building_geometry_mode ?? "unknown";
  const availableScenarios = Array.isArray(state.meta?.available_scenarios)
    ? state.meta.available_scenarios
    : [state.meta?.scenario ?? NIGHT_SCENARIO];
  const hasDayScenario = availableScenarios.includes("day");

  if (scenarioStatusEl) {
    scenarioStatusEl.textContent = hasDayScenario
      ? `Current dataset: ${scenarioLabel}`
      : "Current dataset: Night-only results";
  }

  if (datasetLabelEl) {
    datasetLabelEl.textContent = `Scenario: ${scenarioLabel} · Buildings: ${buildingMode}`;
  }
}

function applyDisplayMode(mode) {
  state.displayMode = mode;
  const showRoads = mode === "roads" || mode === "both";
  const showBuildings = mode === "buildings" || mode === "both";

  setLayerVisibility(state.roadsLayer, showRoads);
  setLayerVisibility(state.buildingsLayer, showBuildings);
}

function updateSummary(stepValue) {
  const row = state.summaryTimeseries.find((r) => Number(r.step) === Number(stepValue));
  if (!row) return;

  const evacPctEl = document.getElementById("evacPct");
  const evacRawEl = document.getElementById("evacRaw");
  const stepLabelEl = document.getElementById("stepLabel");
  const timeLabelEl = document.getElementById("timeLabel");

  evacPctEl.textContent = `${Number(row.evacuated_pct).toFixed(1)}%`;
  evacRawEl.textContent = `${Math.round(Number(row.people_exited))} / ${Math.round(Number(row.total_population))} people`;
  stepLabelEl.textContent = `Step ${row.step}`;
  timeLabelEl.textContent = `Time ${Number(row.time_minutes).toFixed(1)} min`;
}

function renderStepByIndex(idx) {
  const clamped = Math.max(0, Math.min(idx, state.steps.length - 1));
  state.currentIndex = clamped;
  const stepValue = state.steps[clamped];

  const slider = document.getElementById("stepSlider");
  slider.value = String(clamped);

  updateRoadStyles(clamped);
  updateBuildingStyles(stepValue);
  updateSummary(stepValue);
}

function stopPlayback() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
  document.getElementById("playPauseBtn").textContent = "Play";
}

function startPlayback() {
  stopPlayback();
  const speed = Number(document.getElementById("speedSelect").value);

  state.timerId = setInterval(() => {
    if (state.currentIndex >= state.steps.length - 1) {
      stopPlayback();
      return;
    }
    renderStepByIndex(state.currentIndex + 1);
  }, speed);

  document.getElementById("playPauseBtn").textContent = "Pause";
}

function wireControls() {
  const slider = document.getElementById("stepSlider");
  const playPauseBtn = document.getElementById("playPauseBtn");
  const speedSelect = document.getElementById("speedSelect");
  const displayModeSelect = document.getElementById("displayModeSelect");
  const scenarioSelect = document.getElementById("scenarioSelect");

  slider.min = "0";
  slider.max = String(Math.max(0, state.steps.length - 1));
  slider.step = "1";
  slider.value = "0";

  slider.addEventListener("input", (e) => {
    stopPlayback();
    const idx = Number(e.target.value);
    renderStepByIndex(idx);
  });

  playPauseBtn.addEventListener("click", () => {
    if (state.timerId) {
      stopPlayback();
    } else {
      startPlayback();
    }
  });

  speedSelect.addEventListener("change", () => {
    if (state.timerId) {
      startPlayback();
    }
  });

  displayModeSelect.value = state.displayMode;
  displayModeSelect.addEventListener("change", (e) => {
    applyDisplayMode(String(e.target.value || "both"));
    fitBounds();
  });

  const availableScenarios = Array.isArray(state.meta?.available_scenarios)
    ? state.meta.available_scenarios
    : [state.meta?.scenario ?? NIGHT_SCENARIO];
  const dayOption = scenarioSelect.querySelector('option[value="day"]');
  if (dayOption) {
    dayOption.disabled = !availableScenarios.includes("day");
  }

  state.scenarioMode = availableScenarios.includes(state.meta?.scenario) ? state.meta.scenario : NIGHT_SCENARIO;
  scenarioSelect.value = state.scenarioMode;
  scenarioSelect.addEventListener("change", (e) => {
    state.scenarioMode = String(e.target.value || NIGHT_SCENARIO);
    updateScenarioUi();
  });
}

async function bootstrap() {
  initMap();

  const [roadsGeoJson, buildingsGeoJson, edgeTimeseries, summaryTimeseries, buildingEvacStep, meta] = await Promise.all([
    loadGeoJson("./data/roads.geojson"),
    loadGeoJson("./data/buildings.geojson"),
    loadJsonParts("./data/edge_timeseries_parts.json"),
    loadJson("./data/summary_timeseries.json"),
    loadJson("./data/building_evacuation_step.json"),
    loadJson("./data/meta.json"),
  ]);

  state.edgeTimeseries = edgeTimeseries;
  state.summaryTimeseries = summaryTimeseries;
  state.buildingEvacStep = buildingEvacStep;
  state.meta = meta;
  const runIdEl = document.getElementById("runIdLabel");
  if (runIdEl) {
    runIdEl.textContent = `Run: ${meta?.run_id ?? "unknown"}`;
  }
  state.steps = edgeTimeseries.steps || [];

  setupRoadLayer(roadsGeoJson);
  setupBuildingsLayer(buildingsGeoJson);
  applyDisplayMode(state.displayMode);
  updateScenarioUi();
  fitBounds();
  wireControls();
  renderStepByIndex(0);
}

bootstrap().catch((err) => {
  console.error(err);
  alert(`Failed to initialize visualization: ${err.message}`);
});
