const ROAD_GREEN = "#3cb371";
const ROAD_ORANGE = "#e08e45";
const ROAD_RED = "#d9534f";
const BUILDING_GREEN = "#3cb371";
const BUILDING_RED = "#d9534f";
const BUILDING_OUTLINE = "#263238";
const NIGHT_SCENARIO = "night";
const CONTEXT_DEFS={facility:['Tarapur_Nuclear_Facility.geojson',{color:'#d9a441',weight:2.5,fillOpacity:0}],ring5:['5000m.geojson',{color:'#ff6b6b',weight:2,dashArray:'6,4',fillOpacity:0}],ring16:['16000m.geojson',{color:'#ffb74d',weight:2,dashArray:'6,4',fillOpacity:0}],ring18:['18000m.geojson',{color:'#ba68c8',weight:2,dashArray:'6,4',fillOpacity:0}],hospitals:['hospitals.geojson',{color:'#c1443c',fillColor:'#c1443c'},true],rail:['rail_lines.geojson',{color:'#6a4c93',weight:2}],hsr:['HSRStation.geojson',{color:'#1b998b',fillColor:'#1b998b'}],reactor:['Reactor_building.geojson',{color:'#b23a48',fillColor:'#b23a48'}],midc:['MIDC_plots.geojson',{color:'#8a6d3b',fillColor:'#c9a76a',fillOpacity:.22}]};


const state = { map:null, roadsLayer:null, buildingsLayer:null, edgeTimeseries:null, summaryTimeseries:null, buildingEvacStep:null, meta:null, steps:[], currentIndex:0, timerId:null, roadLayersByEdgeId:new Map(), buildingLayersById:new Map(), roadsVisible:true, buildingsVisible:true, scenarioMode:NIGHT_SCENARIO, manifest:null, currentRunId:null, analytics:null };

function roadColor(ratio) { return ratio <= .25 ? ROAD_GREEN : ratio <= .5 ? ROAD_ORANGE : ROAD_RED; }
function buildingIsEvacuated(id, step) { const evacuatedAt = state.buildingEvacStep?.[id]; return evacuatedAt !== null && evacuatedAt !== undefined && step >= evacuatedAt; }
function formatNumber(value) { return Math.round(Number(value || 0)).toLocaleString(); }
function currentSummaryRow() { const step = state.steps[state.currentIndex]; return state.summaryTimeseries?.find((row) => Number(row.step) === Number(step)) || state.summaryTimeseries?.[Math.min(state.currentIndex, (state.summaryTimeseries?.length || 1) - 1)] || null; }

function initMap() {
  state.map = L.map("map", { preferCanvas:true, zoomControl:true }).setView([19.834, 72.69], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom:19 }).addTo(state.map);
}

async function loadJson(path) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${path}${separator}cacheBust=${Date.now()}`, { cache:"no-store" });
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
  return response.json();
}

async function loadEdgeTimeseries(basePath) {
  try {
    return await loadJson(`${basePath}/edge_timeseries.json`);
  } catch (singleFileError) {
    const partsManifest = await loadJson(`${basePath}/edge_timeseries_parts.json`);
    if (!Array.isArray(partsManifest?.parts) || !partsManifest.parts.length) throw singleFileError;
    const partTexts = await Promise.all(partsManifest.parts.map(async (part) => {
      if (typeof part !== "string") throw new Error(`Invalid edge-timeseries part in ${basePath}`);
      const separator = part.includes("?") ? "&" : "?";
      const response = await fetch(`${basePath}/${part}${separator}cacheBust=${Date.now()}`, { cache:"no-store" });
      if (!response.ok) throw new Error(`Failed to load ${basePath}/${part}: ${response.status}`);
      return response.text();
    }));
    return JSON.parse(partTexts.join(""));
  }
}

function buildingStyle(evacuated=false, point=false) {
  const fillColor = evacuated ? BUILDING_GREEN : BUILDING_RED;
  return point ? { radius:3, color:"#00000000", fillColor, fillOpacity:.75, weight:.2 } : { color:BUILDING_OUTLINE, fillColor, fillOpacity:.55, weight:.6 };
}

function setupRoadLayer(data) {
  state.roadsLayer = L.geoJSON(data, { style:{ color:ROAD_GREEN, weight:2.2, opacity:.95 }, onEachFeature:(feature, layer) => { const id = String(feature.properties.edge_id); state.roadLayersByEdgeId.set(id, layer); } }).addTo(state.map);
}

function setupBuildingsLayer(data) {
  state.buildingsLayer = L.geoJSON(data, { style:() => buildingStyle(), pointToLayer:(feature, latlng) => L.circleMarker(latlng, buildingStyle(false, true)), onEachFeature:(feature, layer) => { const id = String(feature.properties.building_id); const population = Number(feature.properties.pop_alloc || 0); state.buildingLayersById.set(id, layer); layer.bindTooltip(`Building ${id}<br>Population: ${population.toFixed(0)}`); } }).addTo(state.map);
}

function setLayerVisible(layer, visible) {
  if (!layer) return;
  if (visible && !state.map.hasLayer(layer)) layer.addTo(state.map);
  if (!visible && state.map.hasLayer(layer)) state.map.removeLayer(layer);
}

function applyLayerVisibility() { setLayerVisible(state.roadsLayer, state.roadsVisible); setLayerVisible(state.buildingsLayer, state.buildingsVisible); }

function fitBounds() {
  const layers = [];
  if (state.roadsVisible && state.roadsLayer && state.map.hasLayer(state.roadsLayer)) layers.push(state.roadsLayer);
  if (state.buildingsVisible && state.buildingsLayer && state.map.hasLayer(state.buildingsLayer)) layers.push(state.buildingsLayer);
  if (!layers.length) return;
  const bounds = layers[0].getBounds().pad(0);
  layers.slice(1).forEach((layer) => bounds.extend(layer.getBounds()));
  if (bounds.isValid()) state.map.fitBounds(bounds, { padding:[20, 20] });
}

function updateRoadStyles(index) {
  const ids = state.edgeTimeseries?.edge_ids || [];
  const row = state.edgeTimeseries?.occupancy_pct_matrix?.[index] || [];
  ids.forEach((id, i) => {
    const ratio = Number(row[i] || 0) / 100;
    const layer = state.roadLayersByEdgeId.get(String(id));
    if (layer) { layer.setStyle({ color:roadColor(ratio) }); layer.bindTooltip(`Edge: ${id}<br>Occupancy: ${(ratio * 100).toFixed(0)}%`); }
  });
}

function updateBuildingStyles(step) {
  state.buildingLayersById.forEach((layer, id) => layer.setStyle(buildingStyle(buildingIsEvacuated(id, step), layer instanceof L.CircleMarker || layer instanceof L.Circle)));
}

function updateScenarioUi() {
  const available = Array.isArray(state.meta?.available_scenarios) ? state.meta.available_scenarios : [state.meta?.scenario || NIGHT_SCENARIO];
  const day = document.querySelector('#scenarioSelect option[value="day"]');
  if (day) day.disabled = !available.includes("day");
  if (!available.includes(state.scenarioMode)) state.scenarioMode = available.includes(state.meta?.scenario) ? state.meta.scenario : NIGHT_SCENARIO;
  document.getElementById("scenarioSelect").value = state.scenarioMode;
  document.getElementById("scenarioStatus").textContent = available.includes("day") ? `Current dataset: ${state.scenarioMode === "day" ? "Day" : "Night"}` : "Current export contains night-time results only.";
  document.getElementById("runIdLabel").textContent = `Run: ${state.meta?.run_id || state.currentRunId || "unknown"}`;
  document.getElementById("datasetLabel").textContent = `Building geometry: ${state.meta?.building_geometry_mode || "unknown"}`;
}

function updateInsights(row) {
  const step = state.steps[state.currentIndex];
  const evacuatedBuildings = [...state.buildingLayersById.keys()].filter((id) => buildingIsEvacuated(id, step)).length;
  const totalBuildings = state.buildingLayersById.size;
  const occupancy = state.edgeTimeseries?.occupancy_pct_matrix?.[state.currentIndex] || [];
  const high = occupancy.filter((value) => Number(value || 0) > 50).length;
  const peak = occupancy.length ? Math.max(...occupancy.map((value) => Number(value || 0))) : 0;
  document.getElementById("insightEvacuated").textContent = formatNumber(row.people_exited);
  document.getElementById("insightPopulation").textContent = formatNumber(row.total_population);
  document.getElementById("insightTime").textContent = `${Number(row.time_minutes || 0).toFixed(1)} min`;
  document.getElementById("insightBuildings").textContent = totalBuildings ? `${evacuatedBuildings.toLocaleString()} / ${totalBuildings.toLocaleString()}` : "—";
  document.getElementById("insightHighRoads").textContent = high.toLocaleString();
  document.getElementById("insightPeakOccupancy").textContent = `${peak.toFixed(0)}%`;
}

function updateSummary() {
  const row = currentSummaryRow();
  if (!row) return;
  const percent = `${Number(row.evacuated_pct || 0).toFixed(1)}%`;
  const elapsed = `${Number(row.time_minutes || 0).toFixed(1)} min elapsed`;
  document.getElementById("evacPct").textContent = percent;
  document.getElementById("evacRaw").textContent = `${formatNumber(row.people_exited)} / ${formatNumber(row.total_population)} people`;
  document.getElementById("timeLabel").textContent = elapsed;
  document.getElementById("timelinePct").textContent = percent;
  document.getElementById("timelineTime").textContent = elapsed;
  document.getElementById("stepLabel").textContent = `Step ${row.step ?? state.steps[state.currentIndex] ?? 0}`;
  updateInsights(row);
  drawEvacuationCurve();
  drawAnalytics();
}

function renderStep(index) {
  if (!state.steps.length) return;
  state.currentIndex = Math.max(0, Math.min(index, state.steps.length - 1));
  document.getElementById("stepSlider").value = String(state.currentIndex);
  updateRoadStyles(state.currentIndex);
  updateBuildingStyles(state.steps[state.currentIndex]);
  updateSummary();
}

function syncSlider() {
  const slider = document.getElementById("stepSlider");
  slider.min = "0";
  slider.max = String(Math.max(0, state.steps.length - 1));
  slider.value = "0";
}

function stopPlayback() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
  document.getElementById("playPauseBtn").textContent = "▶";
  document.getElementById("playPauseBtn").title = "Play evacuation timeline";
}

function startPlayback() {
  stopPlayback();
  if (state.steps.length <= 1) return;
  const interval = Number(document.getElementById("speedSelect").value);
  state.timerId = setInterval(() => {
    if (state.currentIndex >= state.steps.length - 1) return stopPlayback();
    renderStep(state.currentIndex + 1);
  }, interval);
  document.getElementById("playPauseBtn").textContent = "❚❚";
  document.getElementById("playPauseBtn").title = "Pause evacuation timeline";
}

async function loadManifest() {
  try {
    const manifest = await loadJson("./data/manifest.json");
    if (Array.isArray(manifest?.runs) && manifest.runs.length) return manifest;
  } catch (error) { console.warn("Could not load run manifest", error); }
  return { defaultRunId:"default", runs:[{ id:"default", label:"Default export", basePath:"./data" }] };
}

function findRun(id) { return state.manifest.runs.find((run) => String(run.id) === String(id)); }

function clearSimulationLayers() {
  [state.roadsLayer, state.buildingsLayer].forEach((layer) => { if (layer && state.map.hasLayer(layer)) state.map.removeLayer(layer); });
  state.roadsLayer = null;
  state.buildingsLayer = null;
  state.roadLayersByEdgeId.clear();
  state.buildingLayersById.clear();
}

async function loadRunDataset(id) {
  const run = findRun(id);
  if (!run) throw new Error(`Unknown run: ${id}`);
  stopPlayback();
  clearSimulationLayers();
  const base = run.basePath || "./data";
  const [roads, buildings, edges, summary, evacuated, meta] = await Promise.all([loadJson(`${base}/roads.geojson`), loadJson(`${base}/buildings.geojson`), loadEdgeTimeseries(base), loadJson(`${base}/summary_timeseries.json`), loadJson(`${base}/building_evacuation_step.json`), loadJson(`${base}/meta.json`)]);
  state.currentRunId = String(run.id);
  state.edgeTimeseries = edges;
  state.summaryTimeseries = summary;
  state.buildingEvacStep = evacuated;
  state.meta = meta;
  state.analytics = await loadJson(`${base}/analytics.json`).catch(() => null);
  state.steps = edges.steps || [];
  state.scenarioMode = Array.isArray(meta?.available_scenarios) && meta.available_scenarios.includes(meta?.scenario) ? meta.scenario : NIGHT_SCENARIO;
  setupRoadLayer(roads);
  setupBuildingsLayer(buildings);
  applyLayerVisibility();
  updateScenarioUi();
  syncSlider();
  fitBounds();
  renderStep(0);
  document.getElementById("runSelect").value = state.currentRunId;
  document.getElementById("loadingOverlay")?.classList.add("is-hidden");
}

function wirePanels() {
  const dashboard = document.getElementById("dashboardPanel");
  const insights = document.getElementById("insightsPanel");
  const launcher = document.getElementById("openInsightsBtn");
  document.getElementById("closeInsightsBtn")?.addEventListener("click", () => { insights.classList.add("is-hidden"); launcher.classList.add("is-visible"); });
  launcher?.addEventListener("click", () => { insights.classList.remove("is-hidden"); launcher.classList.remove("is-visible"); });
  document.getElementById("collapseInsightsBtn")?.addEventListener("click", () => { const collapsed = insights.classList.toggle("is-collapsed"); document.getElementById("collapseInsightsBtn").textContent = collapsed ? "⌄" : "⌃"; });
}

async function setContextLayer(key,on){const d=CONTEXT_DEFS[key];if(!d)return;state.contextLayers??={};let l=state.contextLayers[key];if(!l&&on){const data=await loadJson('./data/context/'+d[0]);l=L.geoJSON(data,{style:d[1],pointToLayer:d[2]?(f,ll)=>L.circleMarker(ll,{radius:4,color:'#fff',fillColor:d[1].fillColor||d[1].color,fillOpacity:.9}):undefined});state.contextLayers[key]=l;}if(l){if(on&&!state.map.hasLayer(l))l.addTo(state.map);if(!on&&state.map.hasLayer(l))state.map.removeLayer(l);}}
function curveStepAt(clientX){const c=document.getElementById('evacuationCurve'),r=state.summaryTimeseries;if(!c||!r?.length)return;const b=c.getBoundingClientRect(),p=12,s=b.width/c.width,t=Math.max(0,Math.min(1,(clientX-b.left-p*s)/(b.width-p*2*s))),mt=Math.max(1,...r.map(v=>+v.time_minutes||0)),time=t*mt;let best=0;r.forEach((v,i)=>{if(Math.abs((+v.time_minutes||0)-time)<Math.abs((+r[best].time_minutes||0)-time))best=i});const step=Number(r[best].step),index=state.steps.findIndex(v=>Number(v)===step);stopPlayback();renderStep(index>=0?index:Math.min(best,state.steps.length-1));}
function drawEvacuationCurve(){const c=document.getElementById('evacuationCurve');if(!c||!state.summaryTimeseries?.length)return;const x=c.getContext('2d'),w=c.width,h=c.height,p=12,r=state.summaryTimeseries,mt=Math.max(1,...r.map(v=>+v.time_minutes||0)),mp=Math.max(100,...r.map(v=>+v.evacuated_pct||0)),px=v=>p+(+v.time_minutes/mt)*(w-p*2),py=v=>h-p-(+v.evacuated_pct/mp)*(h-p*2);x.clearRect(0,0,w,h);x.strokeStyle='#64b5f6';x.lineWidth=2;x.beginPath();r.forEach((v,i)=>{const a=px(v),b=py(v);i?x.lineTo(a,b):x.moveTo(a,b)});x.stroke();const v=currentSummaryRow();if(v){const a=px(v),b=py(v);x.save();x.strokeStyle='#ffca28';x.lineWidth=1.5;x.setLineDash([4,3]);x.beginPath();x.moveTo(a,p);x.lineTo(a,h-p);x.stroke();x.setLineDash([]);x.fillStyle='#ffca28';x.beginPath();x.arc(a,b,3.5,0,Math.PI*2);x.fill();x.restore();}document.getElementById('curveCurrent').textContent=(+v?.evacuated_pct||0).toFixed(1)+'%';}
function wireControls() { document.querySelectorAll('[data-context-layer]').forEach(e=>{e.addEventListener('change',()=>setContextLayer(e.dataset.contextLayer,e.checked));if(e.checked)setContextLayer(e.dataset.contextLayer,true)});
  const slider = document.getElementById("stepSlider");
  const runSelect = document.getElementById("runSelect");
  slider?.addEventListener("input", (event) => { stopPlayback(); renderStep(Number(event.target.value)); });
  const curve=document.getElementById('evacuationCurve');let curveDragging=false;curve?.addEventListener('pointerdown',event=>{curveDragging=true;curve.setPointerCapture?.(event.pointerId);curveStepAt(event.clientX);});curve?.addEventListener('pointermove',event=>{if(curveDragging)curveStepAt(event.clientX);});curve?.addEventListener('pointerup',()=>{curveDragging=false;});curve?.addEventListener('pointercancel',()=>{curveDragging=false;});
  document.getElementById("playPauseBtn")?.addEventListener("click", () => state.timerId ? stopPlayback() : startPlayback());
  document.getElementById("speedSelect")?.addEventListener("change", () => { if (state.timerId) startPlayback(); });
  document.getElementById("roadsToggle")?.addEventListener("change", (event) => { state.roadsVisible = event.target.checked; applyLayerVisibility(); });
  document.getElementById("buildingsToggle")?.addEventListener("change", (event) => { state.buildingsVisible = event.target.checked; applyLayerVisibility(); });
  document.getElementById("scenarioSelect")?.addEventListener("change", (event) => { state.scenarioMode = event.target.value; updateScenarioUi(); });
  state.manifest.runs.forEach((run) => { const option = document.createElement("option"); option.value = String(run.id); option.textContent = String(run.label || run.id); runSelect.appendChild(option); });
  runSelect?.addEventListener("change", (event) => { document.getElementById("loadingOverlay")?.classList.remove("is-hidden"); loadRunDataset(event.target.value).catch(showError); });
}

function showError(error) { console.error(error); window.alert(`Failed to initialize visualization: ${error.message}`); }
async function bootstrap() { initMap(); state.manifest = await loadManifest(); state.currentRunId = String(state.manifest.defaultRunId || state.manifest.runs[0].id); wirePanels(); wireControls(); await loadRunDataset(state.currentRunId); }
bootstrap().catch(showError);

function drawAnalytics() {
  const ids = ["directionPopulationChart", "directionBuildingsChart", "midcChart", "distanceHistogram", "distanceScatter"];
  const buildings = state.analytics?.buildings;
  const message = (canvas) => {
    if (!canvas) return;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#90a4ae";
    context.font = "12px Arial";
    context.textAlign = "center";
    context.fillText("Analytics data unavailable for this run", canvas.width / 2, canvas.height / 2);
  };
  if (!Array.isArray(buildings) || !buildings.length) {
    ids.forEach((id) => message(document.getElementById(id)));
    return;
  }

  const step = state.steps[state.currentIndex];
  const directions = { N:[0, 0, 0, 0, "#3b82c4"], E:[0, 0, 0, 0, "#2a9d8f"], S:[0, 0, 0, 0, "#e08e45"], W:[0, 0, 0, 0, "#8e6ccf"] };
  const midc = [[0, 0], [0, 0]];
  const maximumDistance = Math.max(1, ...buildings.map((item) => Number(item[4]) || 0));
  const bins = Array.from({ length:5 }, () => [0, 0]);
  buildings.forEach((item) => {
    const population = Number(item[1]) || 0;
    const evacuated = buildingIsEvacuated(String(item[0]), step);
    const direction = directions[item[2]] || directions.N;
    const midcIndex = item[3] ? 0 : 1;
    direction[0] += population;
    direction[1] += 1;
    midc[midcIndex][0] += 1;
    if (evacuated) {
      direction[2] += population;
      direction[3] += 1;
      midc[midcIndex][1] += 1;
    }
    const bin = Math.min(4, Math.floor((Number(item[4]) || 0) / maximumDistance * 5));
    bins[bin][0] += 1;
    if (evacuated) bins[bin][1] += 1;
  });
  const overlayBars = (id, rows) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const context = canvas.getContext("2d"), padding = 20, base = canvas.height - padding;
    const maximum = Math.max(1, ...rows.map((row) => row[1]));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = "10px Arial";
    context.textAlign = "center";
    rows.forEach((row, index) => {
      const slot = (canvas.width - padding * 2) / rows.length, width = slot * .62;
      const left = padding + index * slot + (slot - width) / 2;
      const scale = (canvas.height - padding * 2 - 14) / maximum;
      const totalHeight = row[1] * scale, evacuatedHeight = row[2] * scale;
      context.fillStyle = row[3]; context.fillRect(left, base - 10 - totalHeight, width, totalHeight);
      context.fillStyle = "#26c6da"; context.fillRect(left, base - 10 - evacuatedHeight, width, evacuatedHeight);
      context.fillStyle = "#90a4ae"; context.fillText(row[0], left + width / 2, base);
      context.fillStyle = "#eceff1"; context.fillText(`${Math.round(row[2]).toLocaleString()}/${Math.round(row[1]).toLocaleString()}`, left + width / 2, Math.max(10, base - 14 - totalHeight));
    });
  };
  overlayBars("directionPopulationChart", Object.entries(directions).map(([key, value]) => [key, value[0], value[2], value[4]]));
  overlayBars("directionBuildingsChart", Object.entries(directions).map(([key, value]) => [key, value[1], value[3], value[4]]));
  overlayBars("midcChart", [["MIDC", midc[0][0], midc[0][1], "#8a6d3b"], ["Non-MIDC", midc[1][0], midc[1][1], "#2a9d8f"]]);

  const histogram = document.getElementById("distanceHistogram");
  if (histogram) {
    const context = histogram.getContext("2d"), padding = 20, base = histogram.height - padding;
    const maximum = Math.max(1, ...bins.map((bin) => bin[0]));
    context.clearRect(0, 0, histogram.width, histogram.height);
    bins.forEach((bin, index) => {
      const slot = (histogram.width - padding * 2) / bins.length, width = slot * .64;
      const left = padding + index * slot + (slot - width) / 2, scale = (histogram.height - padding * 2 - 14) / maximum;
      context.fillStyle = "#455a64"; context.fillRect(left, base - 10 - bin[0] * scale, width, bin[0] * scale);
      context.fillStyle = "#26c6da"; context.fillRect(left, base - 10 - bin[1] * scale, width, bin[1] * scale);
    });
  }
  const scatter = document.getElementById("distanceScatter");
  if (scatter) {
    const context = scatter.getContext("2d"), padding = 20;
    const maximumPopulation = Math.max(1, ...buildings.map((item) => Number(item[1]) || 0));
    const stride = Math.max(1, Math.ceil(buildings.length / 1500));
    context.clearRect(0, 0, scatter.width, scatter.height);
    for (let index = 0; index < buildings.length; index += stride) {
      const item = buildings[index];
      const x = padding + (Number(item[4]) || 0) / maximumDistance * (scatter.width - padding * 2);
      const y = scatter.height - padding - (Number(item[1]) || 0) / maximumPopulation * (scatter.height - padding * 2);
      context.fillStyle = buildingIsEvacuated(String(item[0]), step) ? "rgba(100,181,246,.55)" : "rgba(239,83,80,.65)";
      context.beginPath(); context.arc(x, y, 1.5, 0, Math.PI * 2); context.fill();
    }
  }
}