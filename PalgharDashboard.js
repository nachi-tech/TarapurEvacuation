import React, { useContext, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { GlobalContext } from "../../../App";
import { HOST, HOST_MEDIA_URL } from "../../host"; 


//Local and production 

// const DATA_BASE_URL = process.env.NODE_ENV === "production"
//   ? `${HOST_MEDIA_URL}/media/Palghar`
//   : `${process.env.PUBLIC_URL}/data`;

//To run in local save the data in public-> data folder 


//Production only URL : 
const DATA_BASE_URL = `${HOST_MEDIA_URL}/media/Palghar`;
const API_BASE_URL = HOST;

const roadLoadCache = new Map();

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}


function createLRUCache(maxSize = 50) {
  const cache = new Map();
  return {
    get(key) {
      if (!cache.has(key)) return undefined;
      const value = cache.get(key);
      cache.delete(key);
      cache.set(key, value); // refresh recency on access
      return value;
    },
    set(key, value) {
      if (cache.has(key)) cache.delete(key);
      cache.set(key, value);
      if (cache.size > maxSize) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
      }
    },
  };
}


function roundBbox(bounds) {
  const r = (n) => Math.round(n * 10000) / 10000;
  return `${r(bounds.getWest())},${r(bounds.getSouth())},${r(bounds.getEast())},${r(bounds.getNorth())}`;
}

const layerCache = createLRUCache(40);
const stepDataCache = createLRUCache(60);
let insightsSummaryCache = null; // fetched once — static data between backend re-imports

function occupancyColor(ratio) {
  if (ratio == null) return "#3CB371"; 
  if (ratio >= 0.66) return "#D9534F"; 
  if (ratio >= 0.33) return "#E08E45"; 
  return "#3CB371"; 
}


function buildingPopupFormatter(feature) {
  const occupancy = Number(
    feature.properties?.pop_alloc ?? feature.properties?.occupancy ?? 0
  );
  return `Occupancy: ${Math.round(occupancy).toLocaleString()} people`;
}

const LAYER_DEFS = [
  {
    key: "roads",
    label: "Roads",
    file: "roads.geojson",
    style: (feature) => {
      const edgeId = feature?.properties?.edge_id;
      const ratio = roadLoadCache.get(edgeId);
      return { color: occupancyColor(ratio), weight: 2, opacity: 0.85 };
    },
    defaultChecked: true,
    minZoom: 11,
    fullZoom: 16,
    viewportOnly: true,
  },
  {
    key: "buildings",
    label: "Buildings",
    file: "buildings.geojson",
    style: { color: "#000000", fillColor: "#000000", fillOpacity: 0.55, weight: 0.6 },
    minZoom: 15,
    fullZoom: 18,
    viewportOnly: true,
    popupFormatter: buildingPopupFormatter,
  },
  {
    key: "rail_lines",
    label: "Rail Lines",
    file: "rail_lines.geojson",
    style: { color: "#6A4C93", weight: 2 },
    minZoom: 10,
    fullZoom: 15,
    viewportOnly: false,
  },
  {
    key: "railway",
    label: "Railway",
    file: "raillway.geojson",
    style: { color: "#A6743F", weight: 2, dashArray: "6,4" },
    minZoom: 10,
    fullZoom: 15,
    viewportOnly: false,
  },
  {
    key: "hsr",
    label: "HSR Station",
    file: "HSRStation.geojson",
    style: { color: "#1B998B", fillColor: "#1B998B", fillOpacity: 0.85 },
    minZoom: 9,
    fullZoom: 13,
    viewportOnly: false,
  },
  {
    key: "hospitals",
    label: "Hospitals",
    file: "hospitals.geojson",
    style: { color: "#C1443C", fillColor: "#C1443C", fillOpacity: 0.85 },
    minZoom: 9,
    fullZoom: 13,
    viewportOnly: false,
  },
  {
    key: "midc_plots",
    label: "MIDC Plots",
    file: "MIDC_plots.geojson",
    style: { color: "#8A6D3B", fillColor: "#C9A76A", fillOpacity: 0.28, weight: 1 },
    minZoom: 10,
    fullZoom: 15,
    viewportOnly: false,
  },
  {
    key: "reactor",
    label: "Reactor Building",
    file: "Reactor_building.geojson",
    style: { color: "#B23A48", fillColor: "#B23A48", fillOpacity: 0.65, weight: 1.5 },
    minZoom: 9,
    fullZoom: 13,
    viewportOnly: false,
  },
];

const CONTEXT_LAYERS = [
  {
    key: "district",
    file: "Palghar_District.geojson",
    style: { color: "#8A1F2D", weight: 2.5, fillOpacity: 0, dashArray: "4,3" },
    fitBounds: true,
  },
  {
    key: "tarapur",
    file: "Tarapur_Nuclear_Facility.geojson",
    style: { color: "#D9A441", weight: 2.5, fillOpacity: 0 },
    fitBounds: false,
  },

  {
    key: "ring_5000m",
    file: "5000m.geojson",
    style: { color: "#FF6B6B", fillColor: "#FF6B6B", fillOpacity: 0, weight: 2, dashArray: "6,4" },
    fitBounds: false,
  },
  {
    key: "ring_16000m",
    file: "16000m.geojson",
    style: { color: "#FFB74D", fillColor: "#FFB74D", fillOpacity: 0, weight: 2, dashArray: "6,4" },
    fitBounds: false,
  },
  {
    key: "ring_18000m",
    file: "18000m.geojson",
    style: { color: "#BA68C8", fillColor: "#BA68C8", fillOpacity: 0, weight: 2, dashArray: "6,4" },
    fitBounds: false,
  },
];

const DIRECTION_DEFS = [
  { key: "N", label: "North", color: "#3B82C4" },
  { key: "E", label: "East", color: "#2A9D8F" },
  { key: "S", label: "South", color: "#E08E45" },
];

async function fetchJson(file) {
  const res = await fetch(`${DATA_BASE_URL}/${file}`);
  if (!res.ok) throw new Error(`Failed to fetch ${file}: ${res.status}`);
  return res.json();
}

async function fetchPalgharLayer(layerKey, bounds, zoom, signal) {
  const type = layerKey === "roads" ? "road" : "building";
  const bbox = roundBbox(bounds);
  const url =
  type === "road"
    ? `${API_BASE_URL}/palghar-layer?type=road&bbox=${bbox}&zoom=${zoom}`
    : `${API_BASE_URL}/palghar-layer?type=building&bbox=${bbox}&zoom=${zoom}`;

  const cached = layerCache.get(url);
  if (cached) return cached;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Failed to fetch ${layerKey}: ${res.status}`);
  const data = await res.json();
  layerCache.set(url, data);
  return data;
}

async function fetchPalgharStepData(stepIndex, bounds) {
  const bbox = bounds ? roundBbox(bounds) : "";
  const url = bbox
    ? `${API_BASE_URL}/palghar-step-data?step=${stepIndex}&bbox=${bbox}`
    : `${API_BASE_URL}/palghar-step-data?step=${stepIndex}`;

  const cached = stepDataCache.get(url);
  if (cached) return cached;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch step data: ${res.status}`);
  const data = await res.json();
  stepDataCache.set(url, data);
  return data;
}

async function fetchPalgharInsightsSummary() {
  if (insightsSummaryCache) return insightsSummaryCache;
  const res = await fetch(`${API_BASE_URL}/palghar-insights-summary`);
  if (!res.ok) throw new Error(`Failed to load insights summary: ${res.status}`);
  const data = await res.json();
  insightsSummaryCache = data;
  return data;
}

function pointToLayer(style) {
  return (feature, latlng) =>
    L.circleMarker(latlng, {
      radius: 5,
      weight: 1,
      color: "#ffffff",
      fillColor: style.fillColor || style.color,
      fillOpacity: style.fillOpacity ?? 0.85,
    });
}

function buildLayer(data, def, extraOptions = {}) {
  const resolveStyle = (feature) =>
    typeof def.style === "function" ? def.style(feature) : def.style;
  return L.geoJSON(data, {
    style: resolveStyle,
    pointToLayer: pointToLayer(typeof def.style === "function" ? {} : def.style),
   onEachFeature: (feature, layer) => {
  if (typeof def.popupFormatter === "function") {
    const html = def.popupFormatter(feature);
    if (html) layer.bindPopup(html);
    layer.on("click", () => {  
      console.log("building clicked:", feature.properties, "popup html:", html);
    });
  }
},
    ...extraOptions,
  });
}

// Plain range slider driving the evacuation timeline.
function EvacuationSlider({ n, stepIndex, onStepChange, accentColor = "#3B82C4" }) {
  if (!n) return null;
  const clampedIndex = Math.max(0, Math.min(stepIndex, n - 1));
  return (
    <input
      type="range"
      min={0}
      max={n - 1}
      step={1}
      value={clampedIndex}
      onChange={(e) => onStepChange(Number(e.target.value))}
      style={{ width: "100%", accentColor }}
    />
  );
}

function useDraggable() {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  const onMouseDown = (e) => {
    draggingRef.current = true;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      setDragOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    };
    const handleMouseUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return { dragOffset, onMouseDown };
}

function useResizable({ initialWidth, initialHeight, minWidth = 220, minHeight = 160, maxWidth = 900, maxHeight = 900 }) {
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const resizingRef = useRef(null); // e.g. "e", "s", "se", "nw", ...
  const startRef = useRef({ x: 0, y: 0, width: initialWidth, height: initialHeight });

  const startResize = (direction) => (e) => {
    resizingRef.current = direction;
    startRef.current = { x: e.clientX, y: e.clientY, width: size.width, height: size.height };
    e.preventDefault();
    e.stopPropagation();
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      const dir = resizingRef.current;
      if (!dir) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;

      let newWidth = startRef.current.width;
      let newHeight = startRef.current.height;

      if (dir.includes("e")) newWidth = startRef.current.width + dx;
      if (dir.includes("w")) newWidth = startRef.current.width - dx;
      if (dir.includes("s")) newHeight = startRef.current.height + dy;
      if (dir.includes("n")) newHeight = startRef.current.height - dy;

      newWidth = Math.min(maxWidth, Math.max(minWidth, newWidth));
      newHeight = Math.min(maxHeight, Math.max(minHeight, newHeight));

      setSize({ width: newWidth, height: newHeight });
    };
    const handleMouseUp = () => {
      resizingRef.current = null;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minWidth, minHeight, maxWidth, maxHeight]);

  return { size, startResize };
}


function ResizeHandles({ startResize }) {
  const edgeBase = { position: "absolute", zIndex: 10 };
  const cornerSize = "12px";
  return (
    <>
      <div onMouseDown={startResize("n")} style={{ ...edgeBase, top: 0, left: 8, right: 8, height: "6px", cursor: "ns-resize" }} />
      <div onMouseDown={startResize("s")} style={{ ...edgeBase, bottom: 0, left: 8, right: 8, height: "6px", cursor: "ns-resize" }} />
      <div onMouseDown={startResize("e")} style={{ ...edgeBase, right: 0, top: 8, bottom: 8, width: "6px", cursor: "ew-resize" }} />
      <div onMouseDown={startResize("w")} style={{ ...edgeBase, left: 0, top: 8, bottom: 8, width: "6px", cursor: "ew-resize" }} />
      <div onMouseDown={startResize("ne")} style={{ ...edgeBase, top: 0, right: 0, width: cornerSize, height: cornerSize, cursor: "nesw-resize" }} />
      <div onMouseDown={startResize("nw")} style={{ ...edgeBase, top: 0, left: 0, width: cornerSize, height: cornerSize, cursor: "nwse-resize" }} />
      <div onMouseDown={startResize("se")} style={{ ...edgeBase, bottom: 0, right: 0, width: cornerSize, height: cornerSize, cursor: "nwse-resize" }} />
      <div onMouseDown={startResize("sw")} style={{ ...edgeBase, bottom: 0, left: 0, width: cornerSize, height: cornerSize, cursor: "nesw-resize" }} />
    </>
  );
}

function DirectionCard({ label, color, data, style }) {
  const { dragOffset, onMouseDown } = useDraggable();

  if (!data) return null;

  const remaining = Math.max(0, data.totalBuildings - data.evacBuildings);
  const pieSegments = [
    { label: "Evacuated", value: data.evacBuildings, color },
    { label: "Remaining", value: remaining, color: "rgba(255,255,255,0.12)" },
  ];

  const baseTransform = style?.transform ? `${style.transform} ` : "";

  return (
    <div
      style={{
        position: "fixed",
        zIndex: 999,
        width: "220px",
        backgroundColor: "rgba(20, 27, 31, 0.94)",
        border: `1px solid ${color}55`,
        borderTop: `3px solid ${color}`,
        borderRadius: "10px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03)",
        padding: "10px 12px",
        color: "#ECEFF1",
        backdropFilter: "blur(2px)",
        ...style,
        transform: `${baseTransform}translate(${dragOffset.x}px, ${dragOffset.y}px)`,
      }}
    >
      <div
        onMouseDown={onMouseDown}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          cursor: "grab",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "0.3px" }}>{label}</span>
        <span style={{ fontSize: "16px", fontWeight: 800, color }}>{data.pct.toFixed(0)}%</span>
      </div>
      <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 2px" }}>
        <PieChart segments={pieSegments} size={92} donut showLegend={false} />
      </div>
      <div style={{ fontSize: "11px", color: "#90A4AE", marginTop: "2px", textAlign: "center" }}>
        {data.evacBuildings}/{data.totalBuildings} buildings evacuated
      </div>
    </div>
  );
}

function NightDayComparisonChart({ nightTotal, dayTotal }) {
  if (!nightTotal || !dayTotal) return null;
  const maxVal = Math.max(nightTotal, dayTotal);
  const bars = [
    { label: "Night", value: nightTotal, color: "#3B82C4" },
    { label: "Day", value: dayTotal, color: "#E08E45" },
  ];
  return (
    <div style={{ display: "flex", gap: "14px", alignItems: "flex-end", height: "90px", padding: "4px 6px 0" }}>
      {bars.map((b) => (
        <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: b.color, marginBottom: "3px" }}>
            {b.value.toLocaleString()}
          </div>
          <div
            style={{
              width: "100%",
              height: `${(b.value / maxVal) * 60}px`,
              background: `linear-gradient(180deg, ${b.color}, ${b.color}66)`,
              borderRadius: "4px 4px 0 0",
            }}
          />
          <div style={{ fontSize: "10.5px", color: "#90A4AE", marginTop: "4px" }}>{b.label}</div>
        </div>
      ))}
    </div>
  );
}

function EligibilityFunnel({ steps }) {
  if (!steps || !steps.length) return null;
  const maxVal = Math.max(...steps.map((s) => s.value));
  return (
    <div>
      {steps.map((s, i) => {
        const widthPct = Math.max(8, (s.value / maxVal) * 100);
        return (
          <div key={s.label} style={{ marginBottom: "7px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", color: "#90A4AE", marginBottom: "2px" }}>
              <span>{s.label}</span>
              <span style={{ color: "#B39DDB", fontWeight: 700 }}>{s.value.toLocaleString()}</span>
            </div>
            <div
              style={{
                width: `${widthPct}%`,
                height: "16px",
                background: `linear-gradient(90deg, #7E57C2, #B39DDB)`,
                borderRadius: "4px",
                marginLeft: `${(100 - widthPct) / 2}%`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function RoiBreakdownBar({ segments }) {
  if (!segments || !segments.length) return null;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  return (
    <div>
      <div style={{ display: "flex", height: "18px", borderRadius: "4px", overflow: "hidden" }}>
        {segments.map((seg) => (
          <div
            key={seg.label}
            style={{ width: `${(seg.value / total) * 100}%`, backgroundColor: seg.color }}
            title={`${seg.label}: ${seg.value.toLocaleString()}`}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "6px" }}>
        {segments.map((seg) => (
          <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", color: "#90A4AE" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: seg.color, display: "inline-block" }} />
            {seg.label}: <span style={{ color: "#ECEFF1", fontWeight: 600 }}>{seg.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PieChart({ segments, size = 130, donut = true, showLegend = true }) {
  if (!segments || !segments.length) return null;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = size / 2;
  const innerR = donut ? r * 0.55 : 0;
  const cx = r, cy = r;

let cumulativeAngle = -90; // start at 12 o'clock
  const toRad = (deg) => (deg * Math.PI) / 180;
  const nonZeroSegments = segments.filter((seg) => seg.value > 0);
  const isFullCircle = nonZeroSegments.length === 1;

  const arcs = nonZeroSegments.map((seg) => {
    const angle = (seg.value / total) * 360;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + angle;
    cumulativeAngle = endAngle;

    let d;
    if (isFullCircle) {

      const midAngle = startAngle + angle / 2;
      const x1 = cx + r * Math.cos(toRad(startAngle));
      const y1 = cy + r * Math.sin(toRad(startAngle));
      const xm = cx + r * Math.cos(toRad(midAngle));
      const ym = cy + r * Math.sin(toRad(midAngle));
      const ix1 = cx + innerR * Math.cos(toRad(startAngle));
      const iy1 = cy + innerR * Math.sin(toRad(startAngle));
      const ixm = cx + innerR * Math.cos(toRad(midAngle));
      const iym = cy + innerR * Math.sin(toRad(midAngle));

      d = donut
        ? `M ${ix1} ${iy1} L ${x1} ${y1} A ${r} ${r} 0 1 1 ${xm} ${ym} A ${r} ${r} 0 1 1 ${x1} ${y1} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 1 0 ${ixm} ${iym} A ${innerR} ${innerR} 0 1 0 ${ix1} ${iy1} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 1 1 ${xm} ${ym} A ${r} ${r} 0 1 1 ${x1} ${y1} Z`;
    } else {
      const x1 = cx + r * Math.cos(toRad(startAngle));
      const y1 = cy + r * Math.sin(toRad(startAngle));
      const x2 = cx + r * Math.cos(toRad(endAngle));
      const y2 = cy + r * Math.sin(toRad(endAngle));
      const ix1 = cx + innerR * Math.cos(toRad(startAngle));
      const iy1 = cy + innerR * Math.sin(toRad(startAngle));
      const ix2 = cx + innerR * Math.cos(toRad(endAngle));
      const iy2 = cy + innerR * Math.sin(toRad(endAngle));
      const largeArc = angle > 180 ? 1 : 0;

      d = donut
        ? `M ${ix1} ${iy1} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    }

    return { d, color: seg.color, label: seg.label, value: seg.value, pct: (seg.value / total) * 100 };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill={a.color} stroke="#141B1F" strokeWidth="1.5" />
        ))}
        {donut && (
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="13" fontWeight="800" fill="#ECEFF1">
            {total.toLocaleString()}
          </text>
        )}
      </svg>
      {showLegend && (
        <div style={{ minWidth: 0 }}>
          {arcs.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10.5px", color: "#90A4AE", marginBottom: "4px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: a.color, display: "inline-block", flexShrink: 0 }} />
              <span style={{ whiteSpace: "nowrap" }}>
                {a.label}: <span style={{ color: "#ECEFF1", fontWeight: 600 }}>{a.pct.toFixed(1)}%</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DistanceHistogram({ buckets, evacColor = "#26C6DA", remainingColor = "#455A64" }) {
  if (!buckets || !buckets.length) return null;
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "90px", padding: "4px 2px 0" }}>
      {buckets.map((b) => (
        <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ fontSize: "9.5px", color: evacColor, fontWeight: 700, marginBottom: "2px" }}>
            {b.count}
          </div>
          <div
            style={{
              width: "100%",
              height: `${Math.max(4, (b.count / maxCount) * 62)}px`,
              display: "flex",
              flexDirection: "column-reverse",
              borderRadius: "3px 3px 0 0",
              overflow: "hidden",
            }}
            title={`${b.label}: ${b.count} buildings (${b.evacuated} evacuated)`}
          >
            <div style={{ height: `${(b.remaining / (b.count || 1)) * 100}%`, background: remainingColor }} />
            <div
              style={{
                height: `${(b.evacuated / (b.count || 1)) * 100}%`,
                background: `linear-gradient(180deg, ${evacColor}, ${evacColor}55)`,
              }}
            />
          </div>
          <div style={{ fontSize: "9px", color: "#78909C", marginTop: "4px", textAlign: "center", lineHeight: 1.1 }}>
            {b.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function DistancePopulationScatter({ points, width = 260, height = 150, evacColor = "#607D8B", remainingColor = "#EF5350" }) {
  if (!points || !points.length) return null;
  const padding = { top: 8, right: 10, bottom: 22, left: 34 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const maxDist = Math.max(...points.map((p) => p.dist), 1);
  const maxPop = Math.max(...points.map((p) => p.pop), 1);

  const xFor = (d) => padding.left + (d / maxDist) * innerW;
  const yFor = (p) => padding.top + innerH - (p / maxPop) * innerH;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + t * innerH}
          y2={padding.top + t * innerH}
          stroke="#ffffff"
          strokeOpacity={0.07}
          strokeWidth={1}
        />
      ))}
      <text x={2} y={padding.top + 4} fontSize="8.5" fill="#78909C">{Math.round(maxPop)}</text>
      <text x={2} y={height - padding.bottom + 4} fontSize="8.5" fill="#78909C">0</text>
      <text x={padding.left} y={height - 6} fontSize="8.5" fill="#78909C">0m</text>
      <text x={width - padding.right - 24} y={height - 6} fontSize="8.5" fill="#78909C">{Math.round(maxDist)}m</text>

      {points.map((p, i) => (
        <circle
          key={i}
          cx={xFor(p.dist)}
          cy={yFor(p.pop)}
          r={2.5}
          fill={p.evacuated ? evacColor : remainingColor}
          fillOpacity={p.evacuated ? 0.35 : 0.6}
        />
      ))}
    </svg>
  );
}

function InsightSection({ title, children, isLast = false }) {
  return (
    <div
      style={{
        marginBottom: isLast ? 0 : "16px",
        paddingBottom: isLast ? 0 : "16px",
        borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.09)",
      }}
    >
      <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px", color: "#78909C", marginBottom: "8px", fontWeight: 700 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function PalgharDashboard() {
  const { map } = useContext(GlobalContext);
  const [panelOpen, setPanelOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [insightsCollapsed, setInsightsCollapsed] = useState(false);
  const [checked, setChecked] = useState(() =>
    LAYER_DEFS.reduce((acc, d) => ({ ...acc, [d.key]: !!d.defaultChecked }), {})
  );
  const [layerLoading, setLayerLoading] = useState({});

  // ---- directional evacuation state ----
  const [summarySteps, setSummarySteps] = useState(null); // full summary_timeseries.json array (small static file, kept as-is)
  const [directionStepIndex, setDirectionStepIndex] = useState(0); // instant, drives slider UI + displayed numbers
  const [fetchStepIndex, setFetchStepIndex] = useState(0); // debounced, drives all step-based API calls
  const [directionLoading, setDirectionLoading] = useState(false);
  const [directionError, setDirectionError] = useState(false);

  // ---- backend-derived per-step aggregates (replace client-side computation) ----
  const [directionNow, setDirectionNow] = useState(null); // from /palghar-step-data
  const [distanceInsights, setDistanceInsights] = useState(null); // from /palghar-step-data

  // ---- insights panel state (network + population summary data) ----
  const [insightsData, setInsightsData] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState(false);


  const [mapBounds, setMapBounds] = useState(null);


  const insightsDrag = useDraggable();
  const sliderDrag = useDraggable();
  const insightsResize = useResizable({
    initialWidth: 320,
    initialHeight: 560,
    minWidth: 260,
    minHeight: 220,
    maxWidth: 720,
    maxHeight: typeof window !== "undefined" ? window.innerHeight - 100 : 800,
  });

  const layerObjectsRef = useRef({}); // key -> L.layer (cached once fetched, for normal layers)
  const activeLayerRef = useRef({}); // key -> currently-on-map L.layer (for viewportOnly layers)
  const fetchingRef = useRef({}); // key -> boolean, prevents duplicate fetches
  const failedLayersRef = useRef({}); // key -> true, once a fetch has failed (stops retry storms)
  const checkedRef = useRef(checked); // lets async code read latest checked state
  const contextLayerRefs = useRef({}); // key -> L.layer, e.g. district boundary + Tarapur facility + zone rings
  const baseLayerRef = useRef(null); // currently-active OSM base tile layer we control
  const originalBaseLayersRef = useRef([]); // the map's original basemap layer(s), saved before swapping to OSM
  const layerAbortRef = useRef({}); // key -> AbortController, cancels stale bbox/zoom fetches

  useEffect(() => {
    checkedRef.current = checked;
  }, [checked]);


  useEffect(() => {
    const timer = setTimeout(() => setFetchStepIndex(directionStepIndex), 200);
    return () => clearTimeout(timer);
  }, [directionStepIndex]);

  // ---- track map bounds for viewport-aware charts ----
  useEffect(() => {
    if (!map) return;
    const updateBounds = debounce(() => setMapBounds(map.getBounds()), 300);
    setMapBounds(map.getBounds()); // initial, immediate
    map.on("zoomend", updateBounds);
    map.on("moveend", updateBounds);
    return () => {
      map.off("zoomend", updateBounds);
      map.off("moveend", updateBounds);
    };
  }, [map]);


  useEffect(() => {
    if (!map) return;
    const popupPane = map.getPane("popupPane");
    if (popupPane) popupPane.style.zIndex = 1001;
  }, [map]);


  // const setBaseMapToOSM = () => {
  //   if (!map) return;
  //   map.eachLayer((layer) => {
  //     if (layer instanceof L.TileLayer) {
  //       map.removeLayer(layer);
  //     }
  //   });
  //   const osmLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  //     attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  //     maxZoom: 20,
  //   });
  //   osmLayer.addTo(map);
  //   baseLayerRef.current = osmLayer;
  // };


  // function districtPopupFormatter(feature) {
  //   const props = feature.properties || {};
  //   const state =
  //     props.STATE || props.State || props.state_name || props.ST_NM || "Maharashtra";
  //   const district =
  //     props.DISTRICT || props.District || props.district_name || props.DIST_NAME || "Palghar";
  //   return `State: ${state}<br/>District: ${district}`;
  // }


  const setBaseMapToOSM = () => {
  if (!map) return;
  originalBaseLayersRef.current = [];
  map.eachLayer((layer) => {
    if (layer instanceof L.TileLayer) {
      originalBaseLayersRef.current.push(layer); 
      map.removeLayer(layer);
    }
  });
  const osmLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 20,
  });
  osmLayer.addTo(map);
  baseLayerRef.current = osmLayer;
};

// restores whatever basemap was showing before the dashboard opened
const restoreOriginalBaseMap = () => {
  if (!map) return;
  if (baseLayerRef.current && map.hasLayer(baseLayerRef.current)) {
    map.removeLayer(baseLayerRef.current);
  }
  baseLayerRef.current = null;
  originalBaseLayersRef.current.forEach((layer) => {
    if (!map.hasLayer(layer)) layer.addTo(map);
  });
  originalBaseLayersRef.current = [];
};

  function districtPopupFormatter(feature) {
  return `State: Maharashtra<br/>District: Palghar`;
}
 
  const loadContextLayers = async () => {
    if (!map) return;
    for (const def of CONTEXT_LAYERS) {
      if (contextLayerRefs.current[def.key]) continue; // already loaded
      try {
        const data = await fetchJson(def.file);
        const layer = L.geoJSON(data, {
          style: () => def.style,
          onEachFeature:
            def.key === "district"
              ? (feature, lyr) => {
                  const html = districtPopupFormatter(feature);
                  if (html) lyr.bindPopup(html);
                }
              : undefined, // no popup for tarapur / ring layers
        });
        contextLayerRefs.current[def.key] = layer;
        layer.addTo(map);
        if (def.fitBounds && layer.getBounds().isValid()) {
          map.fitBounds(layer.getBounds(), { padding: [20, 20] });
        }
      } catch (err) {
        console.error(`PalgharDashboard: could not load "${def.file}"`, err);
      }
    }
  };

  const loadSummarySteps = async () => {
    if (summarySteps || directionLoading) return;
    setDirectionLoading(true);
    setDirectionError(false);
    try {
      const summary = await fetchJson("summary_timeseries.json");
      setSummarySteps(Array.isArray(summary) ? summary : []);
    } catch (err) {
      console.error("PalgharDashboard: could not load summary timeseries", err);
      setDirectionError(true);
    } finally {
      setDirectionLoading(false);
    }
  };

  const loadInsightsData = async () => {
    if (insightsData || insightsLoading) return;
    setInsightsLoading(true);
    setInsightsError(false);
    try {
      const data = await fetchPalgharInsightsSummary(); // cached — fetched once per session
      setInsightsData(data);
    } catch (err) {
      console.error("PalgharDashboard: could not load insights data", err);
      setInsightsError(true);
    } finally {
      setInsightsLoading(false);
    }
  };

  
  useEffect(() => {
    if (!panelOpen) return;
    let cancelled = false;

    fetchPalgharStepData(fetchStepIndex, mapBounds)
      .then((data) => {
        if (cancelled) return;

       roadLoadCache.clear();
        Object.entries(data.roadLoad?.road_load || {}).forEach(([edgeId, ratio]) =>
          roadLoadCache.set(edgeId, ratio)
        );

    
        const activeRoadsLayer = activeLayerRef.current["roads"];
        if (activeRoadsLayer) {
          activeRoadsLayer.eachLayer((layer) => {
            const edgeId = layer.feature?.properties?.edge_id;
            const ratio = roadLoadCache.get(edgeId);
            layer.setStyle({ color: occupancyColor(ratio) });
          });
        } else if (map && checkedRef.current.roads) {
          // roads layer not loaded yet (e.g. just opened the panel) — do the one-time fetch
          const roadsDef = LAYER_DEFS.find((d) => d.key === "roads");
          if (roadsDef) renderViewportLayer(roadsDef);
        }

        setDirectionNow(data.directionSummary);
        setDistanceInsights(data.distanceInsights);
      })
      .catch((err) => console.error("PalgharDashboard: could not load step data", err));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, panelOpen, fetchStepIndex, mapBounds, checked.roads]);

  // pie-chart-ready segments for directional population + building-count split.
  const directionPieData = React.useMemo(() => {
    if (!directionNow) return null;
    const colorFor = (key) => DIRECTION_DEFS.find((d) => d.key === key)?.color || "#90A4AE";
    const labelFor = (key) => DIRECTION_DEFS.find((d) => d.key === key)?.label || key;

    const populationSegments = Object.entries(directionNow).map(([key, d]) => ({
      label: labelFor(key),
      value: d.totalPop,
      color: colorFor(key),
    }));
    const buildingSegments = Object.entries(directionNow).map(([key, d]) => ({
      label: labelFor(key),
      value: d.totalBuildings,
      color: colorFor(key),
    }));
    return { populationSegments, buildingSegments };
  }, [directionNow]);

  // ---- layer fetch / cache (used for the small static layers, not roads/buildings) ----
  const ensureLayerLoaded = async (def) => {
    if (
      layerObjectsRef.current[def.key] ||
      fetchingRef.current[def.key] ||
      failedLayersRef.current[def.key]
    ) {
      return layerObjectsRef.current[def.key] || null;
    }
    fetchingRef.current[def.key] = true;
    setLayerLoading((prev) => ({ ...prev, [def.key]: true }));
    try {
      const data = await fetchJson(def.file);
      const layer = buildLayer(data, def, def.minZoom ? { renderer: L.canvas() } : {});
      layerObjectsRef.current[def.key] = layer;
      return layer;
    } catch (err) {
      console.error(`PalgharDashboard: could not load "${def.file}"`, err);
      failedLayersRef.current[def.key] = true; // stop retrying this layer until panel reopens
      return null;
    } finally {
      fetchingRef.current[def.key] = false;
      setLayerLoading((prev) => ({ ...prev, [def.key]: false }));
    }
  };

  // ---- roads/buildings: fetch bbox-filtered, pre-sampled data straight from PostGIS ----
    
  const renderViewportLayer = async (def) => {
  if (!map) return;
  const shouldShow = checkedRef.current[def.key];
  const zoomOk = !def.minZoom || map.getZoom() >= def.minZoom;
  const prevActive = activeLayerRef.current[def.key];

  if (!shouldShow || !zoomOk) {
    if (prevActive && map.hasLayer(prevActive)) map.removeLayer(prevActive);
    activeLayerRef.current[def.key] = null;
    layerAbortRef.current[def.key]?.abort();
    return;
  }

  // cancel any in-flight fetch for this layer before starting a new one
  layerAbortRef.current[def.key]?.abort();
  const controller = new AbortController();
  layerAbortRef.current[def.key] = controller;

  setLayerLoading((prev) => ({ ...prev, [def.key]: true }));
  let data;
  try {
    data = await fetchPalgharLayer(def.key, map.getBounds(), map.getZoom(), controller.signal);
  } catch (err) {
    if (err.name === "AbortError") return; // superseded by a newer request, just bail
    console.error(`PalgharDashboard: could not load "${def.key}"`, err);
    data = { type: "FeatureCollection", features: [] };
  } finally {
    if (layerAbortRef.current[def.key] === controller) {
      setLayerLoading((prev) => ({ ...prev, [def.key]: false }));
    }
  }

  if (!checkedRef.current[def.key]) return; // toggled off while fetching
  if (layerAbortRef.current[def.key] !== controller) return; // a newer fetch already superseded this one

  // canvas instead of svg — one bitmap instead of one DOM node per feature
  // const newLayer = buildLayer(data, def, { renderer: L.canvas() });
  const newLayer = buildLayer(data, def, { renderer: L.svg() });

  if (prevActive && map.hasLayer(prevActive)) map.removeLayer(prevActive);
  newLayer.addTo(map);
  activeLayerRef.current[def.key] = newLayer;
};

  // ---- add/remove a single layer from the map based on checkbox + zoom ----
  const applyLayerVisibility = async (def) => {
    if (!map) return;
    if (def.viewportOnly) return renderViewportLayer(def);

    const shouldShow = checkedRef.current[def.key];
    const zoomOk = !def.minZoom || map.getZoom() >= def.minZoom;
    const existing = layerObjectsRef.current[def.key];

    if (shouldShow && zoomOk) {
      if (existing) {
        if (!map.hasLayer(existing)) existing.addTo(map);
      } else {
        const layer = await ensureLayerLoaded(def);
        const stillWanted =
          layer && checkedRef.current[def.key] && (!def.minZoom || map.getZoom() >= def.minZoom);
        if (stillWanted) layer.addTo(map);
      }
    } else if (existing && map.hasLayer(existing)) {
      map.removeLayer(existing);
    }
  };

  const toggleLayer = (def) => {
    setChecked((prev) => ({ ...prev, [def.key]: !prev[def.key] }));
  };

  // sync map whenever checkbox state changes (while panel is open)
  useEffect(() => {
    if (!panelOpen) return;
    LAYER_DEFS.forEach((def) => applyLayerVisibility(def));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, panelOpen]);

  useEffect(() => {
    if (!map) return;
    const handler = debounce(() => {
      if (!panelOpen) return;
      LAYER_DEFS.filter((d) => d.minZoom || d.viewportOnly).forEach((def) => applyLayerVisibility(def));
    }, 300);
    map.on("zoomend", handler);
    map.on("moveend", handler);
    return () => {
      map.off("zoomend", handler);
      map.off("moveend", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, panelOpen]);

const closePanel = () => {
    if (!map) return;

    LAYER_DEFS.forEach((def) => {
      const existing = layerObjectsRef.current[def.key];
      if (existing && map.hasLayer(existing)) map.removeLayer(existing);

      const active = activeLayerRef.current[def.key];
      if (active && map.hasLayer(active)) map.removeLayer(active);
    });

    Object.entries(contextLayerRefs.current).forEach(([key, layer]) => {
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    });

    // Abort any ongoing API requests
    Object.values(layerAbortRef.current).forEach((controller) =>
      controller?.abort()
    );
    layerAbortRef.current = {};

    contextLayerRefs.current = {}; // refetch + refit bounds on next open
    restoreOriginalBaseMap(); // <-- ADD THIS LINE: put back whatever basemap was showing before

    setPanelOpen(false);
    setInsightsOpen(false);
  };

  const handleToolClick = () => {
    if (!map) return;
    if (panelOpen) {
      closePanel();
    } else {
      setPanelOpen(true);
      setBaseMapToOSM();
      loadContextLayers();
      loadSummarySteps();
    }
  };

  const handleInsightsToggle = () => {
    setInsightsOpen((prev) => {
      const next = !prev;
      if (next) {
        setInsightsCollapsed(false);
        loadInsightsData();
      }
      return next;
    });
  };

  const INSIGHTS_COLOR_MAP = {
    "In MIDC": "#8A6D3B",
    "Eligible (non-MIDC)": "#6A4C93",
    Excluded: "#455A64",
    "MIDC buildings": "#8A6D3B",
    "Non-MIDC buildings": "#2A9D8F",
  };

  const insightsDerived = React.useMemo(() => {
    if (!insightsData) return null;
    const withColor = (segments) =>
      (segments || []).map((s) => ({ ...s, color: INSIGHTS_COLOR_MAP[s.label] || "#90A4AE" }));

    return {
      nightTotal: insightsData.nightTotal || 0,
      dayTotal: insightsData.dayTotal || 0,
      eligibilitySteps: insightsData.eligibilitySteps || [],
      roiSegments: withColor(insightsData.roiSegments),
      midcPieSegments: withColor(insightsData.midcPieSegments),
      nonzeroBuildings: insightsData.nonzeroBuildings || 0,
      buildingsSelected: insightsData.buildingsSelected || 0,
    };
  }, [insightsData]);

  const currentStepRow =
    summarySteps && summarySteps.length
      ? summarySteps[Math.min(directionStepIndex, summarySteps.length - 1)]
      : null;

  return (
    <>
      <button
        title="Palghar Dashboard"
        onClick={handleToolClick}
        className="btn-button btn-dark text-white"
        style={{
          zIndex: "1000",
          fontSize: "15px",
          backgroundColor: panelOpen ? "#37474F" : "black",
          padding: "2px 2px",
          width: "38px",
          height: "38px",
          borderRadius: "50%",
          border: "none",
        }}
      >
        <i className="fa-solid fa-circle-radiation"></i>
      </button>

      {panelOpen && (
        <div
          style={{
            position: "absolute",
            top: "70px",
            left: "12px",
            zIndex: 1000,
            width: "260px",
            maxHeight: "calc(100vh - 160px)",
            overflowY: "auto",
            backgroundColor: "#FAFAFA",
            border: "1px solid #CFD8DC",
            borderRadius: "8px",
            boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
            color: "#263238",
          }}
        >
          <div
            style={{
              backgroundColor: "#263238",
              color: "#ECEFF1",
              padding: "10px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              position: "sticky",
              top: 0,
              zIndex: 1,
            }}
          >
            <div>
              <div style={{ fontSize: "14px", fontWeight: 600 }}>Palghar Evacuation</div>
              <div style={{ fontSize: "11px", opacity: 0.75 }}>Nuclear Plant Emergency Zone</div>
            </div>
            <i className="fa-solid fa-xmark" style={{ cursor: "pointer" }} onClick={closePanel}></i>
          </div>

          <div style={{ padding: "12px 14px", borderBottom: "1px solid #ECEFF1" }}>
            <div
              style={{
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                color: "#607D8B",
                marginBottom: "4px",
              }}
            >
              Population Evacuated
            </div>
            {directionLoading && !currentStepRow && <div style={{ fontSize: "13px" }}>Loading…</div>}
            {currentStepRow && (
              <>
                <div style={{ fontSize: "22px", fontWeight: 700, color: "#37474F" }}>
                  {Number(currentStepRow.evacuated_pct ?? 0).toFixed(1)}%
                </div>
                <div style={{ fontSize: "12px", color: "#607D8B" }}>
                  {Math.round(Number(currentStepRow.people_exited ?? 0)).toLocaleString()} / {Math.round(Number(currentStepRow.total_population ?? 0)).toLocaleString()} people
                </div>
              </>
            )}
            {!directionLoading && !currentStepRow && (
              <div style={{ fontSize: "12px", color: "#90A4AE" }}>No evacuation data found</div>
            )}
            {directionLoading && <div style={{ fontSize: "11px", color: "#90A4AE", marginTop: "6px" }}>Loading directional data…</div>}
            {directionError && <div style={{ fontSize: "11px", color: "#B71C1C", marginTop: "6px" }}>Could not load directional data.</div>}
          </div>

          <div style={{ padding: "10px 14px", borderBottom: "1px solid #ECEFF1" }}>
            <button
              onClick={handleInsightsToggle}
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 10px",
                backgroundColor: insightsOpen ? "#37474F" : "#ECEFF1",
                color: insightsOpen ? "#ECEFF1" : "#263238",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "12.5px",
                fontWeight: 600,
              }}
            >
              <span>
                <i className="fa-solid fa-chart-line" style={{ marginRight: "8px" }}></i>
                Network &amp; Population Insights
              </span>
              {/* <i className={`fa-solid fa-chevron-${insightsOpen ? "up" : "down"}`}></i> */}
            </button>
          </div>

          <div style={{ padding: "10px 14px" }}>
            <div
              style={{
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                color: "#607D8B",
                marginBottom: "8px",
              }}
            >
              Map Layers
            </div>
            {LAYER_DEFS.map((def) => (
              <label
                key={def.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  padding: "5px 0",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!checked[def.key]}
                  onChange={() => toggleLayer(def)}
                />
                <span
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: def.style.fillColor ? "2px" : "50%",
                    backgroundColor:
                      typeof def.style === "function"
                        ? "#3CB371"
                        : def.style.fillColor || def.style.color,
                    display: "inline-block",
                    border: `1px solid ${typeof def.style === "function" ? "#3CB371" : def.style.color}`,
                    flexShrink: 0,
                  }}
                ></span>
                <span>{def.label}</span>
                {layerLoading[def.key] && (
                  <i
                    className="fa-solid fa-spinner fa-spin"
                    style={{ marginLeft: "auto", fontSize: "11px", color: "#90A4AE" }}
                  ></i>
                )}
              </label>
            ))}
            <div style={{ fontSize: "10.5px", color: "#90A4AE", marginTop: "6px" }}>
              Buildings render only once zoomed in (large dataset).
            </div>
            <div style={{ fontSize: "10.5px", color: "#90A4AE", marginTop: "4px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#3CB371", display: "inline-block" }}></span>
                &lt;33% load
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#E08E45", display: "inline-block" }}></span>
                33-66%
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#D9534F", display: "inline-block" }}></span>
                &gt;66%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ---- Floating direction cards docked to map edges (uniform dark theme) ---- */}
      {panelOpen && directionNow && (
        <>
          <DirectionCard
            label="North"
            color="#3B82C4"
            data={directionNow.N}
            style={{ top: "80px", left: "50%", transform: "translateX(-50%)" }}
          />
          <DirectionCard
            label="East"
            color="#2A9D8F"
            data={directionNow.E}
            style={{ top: "50%", right: "16px", transform: "translateY(-50%)" }}
          />
          <DirectionCard
            label="South"
            color="#E08E45"
            data={directionNow.S}
            style={{ bottom: "150px", left: "50%", transform: "translateX(-50%)" }}
          />
        </>
      )}


      {panelOpen && summarySteps && summarySteps.length > 0 && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: "16px",
            zIndex: 1000,
            backgroundColor: "rgba(20, 27, 31, 0.94)",
            color: "#ECEFF1",
            padding: "10px 16px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            width: "420px",
            display: "flex",
            alignItems: "center",
            gap: "16px",
            transform: `translateX(-50%) translate(${sliderDrag.dragOffset.x}px, ${sliderDrag.dragOffset.y}px)`,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              onMouseDown={sliderDrag.onMouseDown}
              style={{
                fontSize: "10.5px",
                marginBottom: "6px",
                color: "#90A4AE",
                cursor: "grab",
                userSelect: "none",
              }}
            >
              Evacuation Timeline
            </div>
            <EvacuationSlider
              n={summarySteps.length}
              stepIndex={directionStepIndex}
              onStepChange={setDirectionStepIndex}
              accentColor="#3B82C4"
            />
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, paddingLeft: "4px", borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: "17px", fontWeight: 800, color: "#3B82C4", lineHeight: 1.1 }}>
              {Number(currentStepRow?.evacuated_pct || 0).toFixed(1)}%
            </div>
            <div style={{ fontSize: "10.5px", color: "#90A4AE", whiteSpace: "nowrap" }}>
              {Number(currentStepRow?.time_minutes || 0).toFixed(1)} min elapsed
            </div>
          </div>
        </div>
      )}

      {panelOpen && insightsOpen && (
        <div
          style={{
            position: "fixed",
            top: "70px",
            right: "16px",
            zIndex: 1000,
            width: `${insightsResize.size.width}px`,
            height: insightsCollapsed ? "auto" : `${insightsResize.size.height}px`,
            backgroundColor: "rgba(20, 27, 31, 0.96)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "10px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.45)",
            color: "#ECEFF1",
            display: "flex",
            flexDirection: "column",
            transform: `translate(${insightsDrag.dragOffset.x}px, ${insightsDrag.dragOffset.y}px)`,
          }}
        >
          {!insightsCollapsed && <ResizeHandles startResize={insightsResize.startResize} />}

          <div
            onMouseDown={insightsDrag.onMouseDown}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 16px",
              cursor: "grab",
              userSelect: "none",
              flexShrink: 0,
              borderBottom: insightsCollapsed ? "none" : "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ fontSize: "14px", fontWeight: 700 }}>Network &amp; Population Insights</div>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <i
                className={`fa-solid fa-chevron-${insightsCollapsed ? "down" : "up"}`}
                title={insightsCollapsed ? "Expand" : "Collapse"}
                style={{ cursor: "pointer", color: "#90A4AE", fontSize: "13px" }}
                onClick={() => setInsightsCollapsed((prev) => !prev)}
              ></i>
              <i
                className="fa-solid fa-xmark"
                style={{ cursor: "pointer", color: "#90A4AE" }}
                onClick={() => setInsightsOpen(false)}
              ></i>
            </div>
          </div>

          {!insightsCollapsed && (
            <div style={{ padding: "14px 16px", overflowY: "auto", flex: 1 }}>
              {insightsLoading && <div style={{ fontSize: "12px", color: "#90A4AE" }}>Loading…</div>}
              {insightsError && <div style={{ fontSize: "12px", color: "#EF5350" }}>Could not load insights data.</div>}

              {insightsDerived && (
                <>
                  <InsightSection title="Night vs Daytime Population">
                    <NightDayComparisonChart nightTotal={insightsDerived.nightTotal} dayTotal={insightsDerived.dayTotal} />
                    <div style={{ fontSize: "10px", color: "#607D8B", marginTop: "4px" }}>
                      Daytime population reflects added workforce presence at MIDC / commercial zones.
                    </div>
                  </InsightSection>

                  <InsightSection title="Building Eligibility Coverage">
                    <EligibilityFunnel steps={insightsDerived.eligibilitySteps} />
                  </InsightSection>

                  <InsightSection title="ROI Building Breakdown">
                    <RoiBreakdownBar segments={insightsDerived.roiSegments} />
                    <div style={{ fontSize: "10px", color: "#607D8B", marginTop: "6px" }}>
                      {insightsDerived.nonzeroBuildings.toLocaleString()} of {insightsDerived.buildingsSelected.toLocaleString()} selected buildings have non-zero allocated population.
                    </div>
                  </InsightSection>

                  {insightsDerived.midcPieSegments.some((s) => s.value > 0) && (
                    <InsightSection title="MIDC vs Non-MIDC Buildings">
                      <PieChart segments={insightsDerived.midcPieSegments} size={110} />
                    </InsightSection>
                  )}

                  {directionPieData && (
                    <InsightSection title="Population Share by Direction">
                      <PieChart segments={directionPieData.populationSegments} size={110} />
                    </InsightSection>
                  )}

                  {directionPieData && (
                    <InsightSection title="Buildings by Direction">
                      <PieChart segments={directionPieData.buildingSegments} size={110} />
                    </InsightSection>
                  )}

                  {distanceInsights && (
                    <InsightSection title="Distance to Nearest Exit">
                      <DistanceHistogram buckets={distanceInsights.buckets} />
                      <div style={{ fontSize: "10px", color: "#607D8B", marginTop: "4px" }}>
                        {distanceInsights.usingFallback
                          ? "Showing full region -- too few buildings in the current view. Zoom into an area with buildings to filter by viewport."
                          : `Building count grouped by straight-line distance to assigned exit node, filtered to the current map view (${distanceInsights.inViewCount.toLocaleString()} buildings).`}
                      </div>
                    </InsightSection>
                  )}

                  {distanceInsights && (
                    <InsightSection title="Population vs Distance (Risk View)" isLast>
                      <DistancePopulationScatter points={distanceInsights.scatterPoints} />
                      <div style={{ fontSize: "10px", color: "#607D8B", marginTop: "4px" }}>
                        Each dot is one building in view. Red dots are not yet evacuated at this step; top-right dots are high-population buildings far from an exit — evacuation priority candidates.
                      </div>
                    </InsightSection>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default PalgharDashboard;