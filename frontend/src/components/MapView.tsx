import { useCallback, useEffect, useRef, useState } from 'react';
import { Segmented, Button, Popover } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import type { Route, Stop } from '../types';
import { getRouteLegPaths, saveLegPath } from '../api';
import { fetchLegFromAMap } from '../utils/legCache';
import { fetchWikiSummary, wikiSearchUrl, type WikiSummary } from '../utils/wiki';
import { getRuntimeConfig, type RuntimeConfig } from '../config';

declare global {
  interface Window {
    AMap: any;
    _AMapSecurityConfig?: { securityJsCode: string };
    __TRAVEL_EXPORT_MAPS?: Record<string, { style: string; phase: string; readyAt: number; error?: string }>;
  }
}

interface MapViewProps {
  routes: Route[];
  visibleRouteIds: Set<number>;
  onStopClick: (stop: Stop, route: Route) => void;
  onRouteClick?: (routeId: number) => void;
  selectedRouteId?: number | null;
  showCityNames?: boolean;
  showFlights?: boolean;
  // Export-mode props: hide UI controls, override style/viewport from URL
  embedded?: boolean;
  forceMapStyle?: 'normal' | 'fresh' | 'whitesmoke';
  viewportBounds?: { sw: [number, number]; ne: [number, number] };
  viewportPadding?: [number, number, number, number];
  // Pixel font size for city labels. Default 11 = on-screen interactive view.
  // Export views pass larger values: 14 for dense overview, 18-22 for routes.
  cityLabelSize?: number;
  mobileControls?: boolean;
}

interface AMapInfoWindow {
  setContent: (content: string) => void;
  open: (map: unknown, position: [number, number]) => void;
  close: () => void;
}

import { getHomeBaseCity } from './export/exportShared';

type MapStyleKey = 'normal' | 'fresh' | 'whitesmoke';
const STYLE_STORAGE_KEY = 'travel-map:mapStyle';
const STYLE_OPTIONS: { label: string; value: MapStyleKey }[] = [
  { label: '标准', value: 'normal' },
  { label: '清新', value: 'fresh' },
  { label: '简洁', value: 'whitesmoke' },
];
const WIKI_HOVER_DELAY_MS = 750;

let amapScriptPromise: Promise<void> | null = null;

function loadAMapScript(amapKey: string, amapSecurityCode: string): Promise<void> {
  if (window.AMap) return Promise.resolve();
  if (amapScriptPromise) return amapScriptPromise;
  if (amapSecurityCode) {
    window._AMapSecurityConfig = { securityJsCode: amapSecurityCode };
  }
  amapScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${amapKey}`;
    script.onload = () => resolve();
    script.onerror = () => {
      amapScriptPromise = null;
      reject();
    };
    document.head.appendChild(script);
  });
  return amapScriptPromise;
}

function loadPlugins(plugins: string[]): Promise<void> {
  return new Promise(resolve => window.AMap.plugin(plugins, resolve));
}

function waitForMapComplete(map: any, trigger: () => void, timeoutMs = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      try { map.off('complete', handleComplete); } catch {}
      window.clearTimeout(timer);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const handleComplete = () => finish(resolve);
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error('AMap did not finish loading before timeout')));
    }, timeoutMs);

    try {
      map.on('complete', handleComplete);
      trigger();
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] ?? ch));
}

function safeCssColor(color: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#1677ff';
}

function wikiLoadingContent(stop: Stop, route: Route): string {
  const cityName = escapeHtml(stop.city_name);
  const routeColor = safeCssColor(route.color);
  return `
    <a href="${wikiSearchUrl(stop.city_name)}" target="_blank" rel="noreferrer"
       style="display:block;width:260px;text-decoration:none;color:#24302b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${routeColor};display:inline-block;"></span>
        <strong style="font-size:15px;">${cityName}</strong>
      </div>
      <div style="font-size:12px;color:#7a8580;line-height:1.6;">正在读取维基百科简介...</div>
    </a>`;
}

function wikiInfoWindowContent(stop: Stop, route: Route, summary: WikiSummary | null): string {
  const routeColor = safeCssColor(route.color);
  const title = escapeHtml(summary?.title || stop.city_name);
  const extract = escapeHtml(summary?.extract || '暂时没有找到合适的维基百科简介。点击可继续搜索这个地点。');
  const pageUrl = escapeHtml(summary?.pageUrl || wikiSearchUrl(stop.city_name));
  const thumbnail = summary?.thumbnailUrl ? escapeHtml(summary.thumbnailUrl) : '';

  return `
    <a href="${pageUrl}" target="_blank" rel="noreferrer"
       style="display:block;width:280px;text-decoration:none;color:#24302b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      ${thumbnail ? `<img src="${thumbnail}" alt="${title}" style="width:100%;height:120px;object-fit:cover;border-radius:6px;margin-bottom:9px;" />` : ''}
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${routeColor};display:inline-block;"></span>
        <strong style="font-size:15px;">${title}</strong>
      </div>
      <div style="font-size:12px;color:#5f6c66;line-height:1.65;">${extract}</div>
    </a>`;
}

// ── Driving path: cache-first per-leg fetcher ────────────────────────────────
//
// Each leg (consecutive stop pair) is keyed by `${minId}|${maxId}` (canonical
// undirected key). A leg is fetched at most once per session — concurrent calls
// for the same leg are deduped via the pending map. Successful fetches are
// posted to the backend so future sessions / other devices skip the AMap call
// entirely. Concurrent AMap.Driving calls are capped to avoid hitting QPS.

const MAX_CONCURRENT_DRIVING = 3;
const drivingState = { active: 0, queue: [] as Array<() => void> };

async function withDrivingLimiter<T>(fn: () => Promise<T>): Promise<T> {
  if (drivingState.active >= MAX_CONCURRENT_DRIVING) {
    await new Promise<void>(resolve => drivingState.queue.push(resolve));
  }
  drivingState.active++;
  try {
    return await fn();
  } finally {
    drivingState.active--;
    drivingState.queue.shift()?.();
  }
}

function legCacheKey(a: Stop, b: Stop): string {
  return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
}

interface LegStores {
  cache: Map<string, [number, number][]>;
  pending: Map<string, Promise<[number, number][]>>;
}

async function getLegPath(a: Stop, b: Stop, stores: LegStores): Promise<[number, number][]> {
  const key = legCacheKey(a, b);
  // Cache stores canonical (smaller id first); reverse if travel direction is opposite.
  const reverseIfNeeded = (path: [number, number][]) =>
    a.id < b.id ? path : [...path].reverse();

  const cached = stores.cache.get(key);
  if (cached) return reverseIfNeeded(cached);

  const inflight = stores.pending.get(key);
  if (inflight) return reverseIfNeeded(await inflight);

  const [from, to] = a.id < b.id ? [a, b] : [b, a];
  const promise = withDrivingLimiter(async () => {
    const fetched = await fetchLegFromAMap(from, to);
    stores.cache.set(key, fetched.path);
    stores.pending.delete(key);
    // Persist to backend ONLY if AMap actually returned a road-snapped path.
    // The straight-line fallback on rate-limit must not be cached, otherwise
    // it permanently masquerades as a real cache hit on subsequent loads.
    if (fetched.snapped && fetched.path.length >= 2) {
      saveLegPath(from.id, to.id, fetched.path).catch(() => {});
    }
    return fetched.path;
  });
  stores.pending.set(key, promise);
  return reverseIfNeeded(await promise);
}


// Approximate label box width in pixels for AMap.Text rendering. Width scales
// linearly with font size — Chinese ~1.13× fontSize, ASCII ~0.64× fontSize,
// plus padding+border ~1.45× fontSize. Calibrated against fontSize=11
// (12.5/7/16 px respectively) and used to position labels with collision
// avoidance at any font size.
function approxLabelWidth(text: string, fontSize: number = 11): number {
  const cn = fontSize * 1.13;
  const ascii = fontSize * 0.64;
  const pad = fontSize * 1.45;
  let w = pad;
  for (const c of text) w += c.charCodeAt(0) > 127 ? cn : ascii;
  return Math.ceil(w);
}

type LabelDir = 'right' | 'top' | 'bottom' | 'left';
interface PixelBox { x: number; y: number; w: number; h: number; }

// AMap.Text offset shifts the label's top-left corner by (ox, oy) from the marker position.
// Returns the offset along with the resulting box position relative to marker center.
function labelOffsetForDir(dir: LabelDir, markerR: number, labelW: number, labelH: number) {
  const gap = 4;
  let ox = 0, oy = 0;
  switch (dir) {
    case 'right':  ox = markerR + gap;             oy = -labelH / 2; break;
    case 'top':    ox = -labelW / 2;               oy = -markerR - gap - labelH; break;
    case 'left':   ox = -markerR - gap - labelW;   oy = -labelH / 2; break;
    case 'bottom': ox = -labelW / 2;               oy = markerR + gap; break;
  }
  return { ox, oy };
}

function boxesOverlap(a: PixelBox, b: PixelBox): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}


// Build a quadratic bezier arc for a flight, always bulging to the LEFT of travel
// direction (perpendicular CCW). Round trips (A→B then B→A) automatically diverge
// to opposite sides, so duplicate paths never coincide. Single flights still curve.
function generateFlightArc(from: Stop, to: Stop): {
  path: [number, number][];
  midpoint: [number, number];
  bearingDeg: number;
} {
  const x1 = from.longitude, y1 = from.latitude;
  const x2 = to.longitude, y2 = to.latitude;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) {
    return { path: [[x1, y1], [x2, y2]], midpoint: [x1, y1], bearingDeg: 0 };
  }
  // Bulge proportional to chord length, with floor so even short flights have visible arc
  const bulge = Math.min(Math.max(len * 0.25, 0.7), 2.5);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  // Control point offset perpendicular CCW (= left of travel direction)
  const cx = mx + (-dy / len) * bulge;
  const cy = my + (dx / len) * bulge;

  const N = 60;
  const path: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    path.push([u * u * x1 + 2 * u * t * cx + t * t * x2,
               u * u * y1 + 2 * u * t * cy + t * t * y2]);
  }
  // Bezier midpoint at t=0.5
  const midpoint: [number, number] = [
    0.25 * x1 + 0.5 * cx + 0.25 * x2,
    0.25 * y1 + 0.5 * cy + 0.25 * y2,
  ];
  // Tangent at t=0.5 of a quadratic bezier is parallel to the chord (P2-P1)
  const bearingDeg = Math.atan2(dy, dx) * 180 / Math.PI;
  return { path, midpoint, bearingDeg };
}

// Split ordered stops into alternating drive/flight segments for rendering
type RouteSegment =
  | { type: 'drive'; stops: Stop[] }
  | { type: 'flight'; from: Stop; to: Stop };

function splitSegments(stops: Stop[]): RouteSegment[] {
  if (stops.length < 2) return [];
  const result: RouteSegment[] = [];
  let driveBuffer: Stop[] = [stops[0]];

  for (let i = 1; i < stops.length; i++) {
    const stop = stops[i];
    if (stop.transport_mode === 'flight') {
      if (driveBuffer.length >= 2) result.push({ type: 'drive', stops: [...driveBuffer] });
      result.push({ type: 'flight', from: driveBuffer[driveBuffer.length - 1], to: stop });
      driveBuffer = [stop];
    } else {
      driveBuffer.push(stop);
    }
  }
  if (driveBuffer.length >= 2) result.push({ type: 'drive', stops: driveBuffer });
  return result;
}

export default function MapView({
  routes, visibleRouteIds, onStopClick, onRouteClick, selectedRouteId,
  showCityNames = true, showFlights = true,
  embedded = false, forceMapStyle, viewportBounds, viewportPadding,
  cityLabelSize = 11,
  mobileControls = false,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const infoWindowRef = useRef<AMapInfoWindow | null>(null);
  const wikiHoverTimerRef = useRef<number | null>(null);
  const exportMapIdRef = useRef(`export-map-${Math.random().toString(36).slice(2)}`);
  const overlaysRef = useRef<any[]>([]);
  const legStoresRef = useRef<LegStores>({ cache: new Map(), pending: new Map() });
  const loadedRouteIdsRef = useRef<Set<number>>(new Set());
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [pluginsReady, setPluginsReady] = useState(false);
  const [exportViewReady, setExportViewReady] = useState(!embedded);
  const [mapStyle, setMapStyle] = useState<MapStyleKey>(() => {
    if (forceMapStyle) return forceMapStyle;
    const saved = localStorage.getItem(STYLE_STORAGE_KEY) as MapStyleKey | null;
    return saved && STYLE_OPTIONS.some(o => o.value === saved) ? saved : 'normal';
  });

  const showWikiPreview = useCallback((stop: Stop, route: Route) => {
    if (embedded || !mapRef.current || !window.AMap) return;
    const AMap = window.AMap;
    if (!infoWindowRef.current) {
      infoWindowRef.current = new AMap.InfoWindow({
        isCustom: false,
        offset: new AMap.Pixel(0, -18),
      });
    }
    const infoWindow = infoWindowRef.current;
    if (!infoWindow) return;
    infoWindow.setContent(wikiLoadingContent(stop, route));
    infoWindow.open(mapRef.current, [stop.longitude, stop.latitude]);

    fetchWikiSummary(stop.city_name).then(summary => {
      if (infoWindowRef.current !== infoWindow) return;
      infoWindow.setContent(wikiInfoWindowContent(stop, route, summary));
    });
  }, [embedded]);

  const clearWikiHoverTimer = useCallback(() => {
    if (wikiHoverTimerRef.current === null) return;
    window.clearTimeout(wikiHoverTimerRef.current);
    wikiHoverTimerRef.current = null;
  }, []);

  const scheduleWikiPreview = useCallback((stop: Stop, route: Route) => {
    clearWikiHoverTimer();
    if (embedded) return;
    wikiHoverTimerRef.current = window.setTimeout(() => {
      wikiHoverTimerRef.current = null;
      showWikiPreview(stop, route);
    }, WIKI_HOVER_DELAY_MS);
  }, [clearWikiHoverTimer, embedded, showWikiPreview]);

  useEffect(() => clearWikiHoverTimer, [clearWikiHoverTimer]);

  useEffect(() => {
    getRuntimeConfig().then(setRuntimeConfig);
  }, []);

  const setExportStatus = useCallback((status: Partial<{ phase: string; readyAt: number; error?: string }>) => {
    if (!embedded) return;
    const mapId = exportMapIdRef.current;
    const targetStyle = forceMapStyle || mapStyle;
    window.__TRAVEL_EXPORT_MAPS = window.__TRAVEL_EXPORT_MAPS || {};
    const previous = window.__TRAVEL_EXPORT_MAPS[mapId] || { style: targetStyle, phase: 'created', readyAt: 0 };
    window.__TRAVEL_EXPORT_MAPS[mapId] = {
      ...previous,
      ...status,
      style: targetStyle,
    };
  }, [embedded, forceMapStyle, mapStyle]);

  useEffect(() => {
    if (!embedded) return;
    const mapId = exportMapIdRef.current;
    window.__TRAVEL_EXPORT_MAPS = window.__TRAVEL_EXPORT_MAPS || {};
    window.__TRAVEL_EXPORT_MAPS[mapId] = { style: forceMapStyle || mapStyle, phase: 'registered', readyAt: 0 };
    return () => {
      if (window.__TRAVEL_EXPORT_MAPS) delete window.__TRAVEL_EXPORT_MAPS[mapId];
    };
  }, [embedded, forceMapStyle, mapStyle]);

  const markExportMapReady = useCallback(() => {
    if (!embedded) return;
    setExportStatus({ phase: 'painting', readyAt: 0, error: undefined });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          setExportStatus({ phase: 'ready', readyAt: Date.now(), error: undefined });
        }, 700);
      });
    });
  }, [embedded, setExportStatus]);

  useEffect(() => {
    if (!runtimeConfig?.amapKey || runtimeConfig.amapKey === 'your_amap_js_api_key_here') return;
    loadAMapScript(runtimeConfig.amapKey, runtimeConfig.amapSecurityCode).then(() => {
      if (!containerRef.current || mapRef.current) return;
      mapRef.current = new window.AMap.Map(containerRef.current, {
        zoom: 5,
        center: [104.0, 35.5],
        mapStyle: `amap://styles/${mapStyle}`,
        showLabel: true,
        animateEnable: false,
      });
      // Load Driving + Geocoder plugins after map init
      loadPlugins(['AMap.Driving', 'AMap.Geocoder']).then(() => {
        setPluginsReady(true);
        setMapReady(true);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeConfig]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (embedded) return;
    mapRef.current.setMapStyle(`amap://styles/${mapStyle}`);
    // Embedded/export mode shouldn't write the user's preference back
    localStorage.setItem(STYLE_STORAGE_KEY, mapStyle);
  }, [mapStyle, embedded]);

  // Drop the in-memory leg cache when routes data changes (likely an edit).
  // Backend already invalidated affected legs server-side; refilling from
  // backend on next render is fast and avoids using stale paths.
  useEffect(() => {
    legStoresRef.current = { cache: new Map(), pending: new Map() };
    loadedRouteIdsRef.current = new Set();
  }, [routes]);

  // Force a specific viewport bounds (export mode) — takes precedence over
  // the auto-fit-on-selected behaviour below.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !viewportBounds) return;
    if (embedded) return;
    const AMap = window.AMap;
    const sw = new AMap.LngLat(viewportBounds.sw[0], viewportBounds.sw[1]);
    const ne = new AMap.LngLat(viewportBounds.ne[0], viewportBounds.ne[1]);
    mapRef.current.setBounds(new AMap.Bounds(sw, ne), false, viewportPadding ?? [60, 60, 60, 60]);
  }, [viewportBounds, viewportPadding, mapReady, embedded]);

  // Auto-fit view to selected route so road labels (zoom ≥ 8) become visible
  useEffect(() => {
    if (!mapReady || !mapRef.current || !selectedRouteId || viewportBounds) return;
    if (embedded) return;
    const route = routes.find(r => r.id === selectedRouteId);
    if (!route) return;
    const stops = route.stops.filter(s => s.longitude !== 0 || s.latitude !== 0);
    if (stops.length === 0) return;
    const AMap = window.AMap;
    const lngs = stops.map(s => s.longitude);
    const lats = stops.map(s => s.latitude);
    const sw = new AMap.LngLat(Math.min(...lngs), Math.min(...lats));
    const ne = new AMap.LngLat(Math.max(...lngs), Math.max(...lats));
    mapRef.current.setBounds(new AMap.Bounds(sw, ne), false, [80, 80, 80, 80]);
  }, [selectedRouteId, mapReady, routes, viewportBounds, embedded]);

  useEffect(() => {
    if (!embedded) {
      setExportViewReady(true);
      return;
    }
    if (!mapReady || !mapRef.current) return;

    let cancelled = false;
    const map = mapRef.current;
    const AMap = window.AMap;
    const targetStyle = forceMapStyle || mapStyle;

    const route = selectedRouteId ? routes.find(r => r.id === selectedRouteId) : null;
    const routeStops = route?.stops.filter(s => s.longitude !== 0 || s.latitude !== 0) ?? [];
    const boundsFromRoute = routeStops.length > 0
      ? {
          sw: [
            Math.min(...routeStops.map(s => s.longitude)),
            Math.min(...routeStops.map(s => s.latitude)),
          ] as [number, number],
          ne: [
            Math.max(...routeStops.map(s => s.longitude)),
            Math.max(...routeStops.map(s => s.latitude)),
          ] as [number, number],
          padding: [80, 80, 80, 80] as [number, number, number, number],
        }
      : null;
    const exportBounds = viewportBounds
      ? { ...viewportBounds, padding: viewportPadding ?? [60, 60, 60, 60] as [number, number, number, number] }
      : boundsFromRoute;

    setExportViewReady(false);
    setExportStatus({ phase: 'preparing-view', readyAt: 0, error: undefined });

    (async () => {
      try {
        map.setMapStyle(`amap://styles/${targetStyle}`);
        if (cancelled) return;

        if (exportBounds) {
          setExportStatus({ phase: 'fitting-bounds', readyAt: 0, error: undefined });
          const sw = new AMap.LngLat(exportBounds.sw[0], exportBounds.sw[1]);
          const ne = new AMap.LngLat(exportBounds.ne[0], exportBounds.ne[1]);
          const bounds = new AMap.Bounds(sw, ne);
          await waitForMapComplete(map, () => {
            map.setBounds(bounds, false, exportBounds.padding);
          });
        } else {
          setExportStatus({ phase: 'waiting-initial-map', readyAt: 0, error: undefined });
          await waitForMapComplete(map, () => {
            map.setZoomAndCenter(map.getZoom(), map.getCenter());
          });
        }

        if (cancelled) return;
        setExportStatus({ phase: 'view-ready', readyAt: 0, error: undefined });
        setExportViewReady(true);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setExportStatus({ phase: 'failed', readyAt: 0, error: message });
      }
    })();

    return () => { cancelled = true; };
  }, [
    embedded, mapReady, forceMapStyle, mapStyle, selectedRouteId, routes,
    viewportBounds, viewportPadding, setExportStatus,
  ]);

  useEffect(() => {
    if (!mapReady || !pluginsReady || !mapRef.current) return;
    if (embedded && !exportViewReady) return;
    const map = mapRef.current;
    const AMap = window.AMap;
    let cancelled = false;

    // Pre-fetch backend leg cache for any visible route we haven't loaded yet.
    // Each route's cache is fetched once per "routes" version (the cache-clear
    // effect resets loadedRouteIds when routes prop changes).
    (async () => {
      const toLoad = routes.filter(
        r => visibleRouteIds.has(r.id) && !loadedRouteIdsRef.current.has(r.id),
      );
      for (const route of toLoad) {
        try {
          const legs = await getRouteLegPaths(route.id);
          if (cancelled) return;
          for (const leg of legs) {
            legStoresRef.current.cache.set(`${leg.stop_a_id}|${leg.stop_b_id}`, leg.path);
          }
          loadedRouteIdsRef.current.add(route.id);
        } catch {
          // Ignore — legs will fall back to AMap.Driving on render
        }
      }
      if (cancelled) return;
      runRender();
    })();

    function runRender() {
      overlaysRef.current.forEach(o => { try { map.remove(o); } catch {} });
      overlaysRef.current = [];
      const renderPromises: Promise<void>[] = [];

    // Track placed visual elements across ALL routes for collision detection.
    // Order: drive lines → flight arcs+planes (record plane boxes) → markers+labels
    // (avoiding plane boxes and other labels). Same-name same-location labels deduped.
    const placedBoxes: PixelBox[] = [];
    const placedLabelKeys = new Set<string>();
    const lngLatToPx = (lng: number, lat: number): { x: number; y: number } => {
      const p = map.lngLatToContainer(new AMap.LngLat(lng, lat));
      return { x: p.getX(), y: p.getY() };
    };


    routes.forEach(route => {
      if (!visibleRouteIds.has(route.id)) return;
      const stops = [...route.stops]
        .filter(s => s.longitude !== 0 || s.latitude !== 0) // skip invalid coords
        .sort((a, b) => a.order - b.order);
      if (stops.length === 0) return;

      const opacity = selectedRouteId && selectedRouteId !== route.id ? 0.3 : 1;
      const weight = selectedRouteId === route.id ? 6 : 4;
      // Lines use a lower opacity than markers so that overlapping route
      // segments naturally blend (stacked transparency reads as a deeper,
      // more saturated colour) — this acts as a "shared road" indicator
      // without needing geometric overlap detection.
      const lineOpacity = selectedRouteId
        ? (selectedRouteId === route.id ? 1 : 0.25)
        : 0.6;

      const segments = splitSegments(stops);

      // 1. Drive: render each consecutive-pair leg as a separate polyline.
      // No deduplication — same leg traversed twice (e.g. 腾冲→瑞丽→腾冲)
      // renders as two stacked polylines, and the alpha-blend at lineOpacity
      // makes the overlap read as a deeper colour. Cross-route shared segments
      // blend the same way, just with different colours.
      segments.forEach(seg => {
        if (seg.type !== 'drive') return;
        for (let i = 0; i < seg.stops.length - 1; i++) {
          const a = seg.stops[i], b = seg.stops[i + 1];
          const [from, to] = a.id < b.id ? [a, b] : [b, a];
          const renderPromise = getLegPath(from, to, legStoresRef.current).then(path => {
            if (cancelled) return;
            if (path.length < 2) return;
            const polyline = new AMap.Polyline({
              path,
              strokeColor: route.color,
              strokeWeight: weight,
              strokeOpacity: lineOpacity,
              strokeStyle: 'solid',
              lineJoin: 'round',
              cursor: 'pointer',
              extData: { routeId: route.id },
            });
            if (onRouteClick) polyline.on('click', () => onRouteClick(route.id));
            map.add(polyline);
            overlaysRef.current.push(polyline);
          });
          renderPromises.push(renderPromise);
        }
      });

      // 2. Flight arcs + airplane markers (record airplane boxes for label avoidance)
      if (showFlights) {
        segments.forEach(seg => {
          if (seg.type !== 'flight') return;
          const { path, midpoint, bearingDeg } = generateFlightArc(seg.from, seg.to);
          const dashed = new AMap.Polyline({
            path,
            strokeColor: route.color,
            strokeWeight: weight - 1,
            strokeOpacity: lineOpacity * 0.85,
            strokeStyle: 'dashed',
            strokeDasharray: [12, 6],
            lineJoin: 'round',
            cursor: 'pointer',
            extData: { routeId: route.id },
          });
          if (onRouteClick) dashed.on('click', () => onRouteClick(route.id));

          // Airplane sits in a white circular badge for visual prominence over
          // other overlays. SVG path natively points UP; pre-rotate 90° so it
          // points EAST at CSS rotate(0). Math bearing CCW vs CSS CW → negate.
          const cssRotation = -bearingDeg;
          const PLANE = 28;
          const planeMarker = new AMap.Marker({
            position: midpoint,
            offset: new AMap.Pixel(-PLANE / 2, -PLANE / 2),
            anchor: 'center',
            content: `<div style="
              width:${PLANE}px;height:${PLANE}px;border-radius:50%;
              background:rgba(255,255,255,.92);
              border:1.5px solid ${route.color};
              box-shadow:0 1px 4px rgba(0,0,0,.25);
              display:flex;align-items:center;justify-content:center;
              transform:rotate(${cssRotation}deg);opacity:${opacity};
            ">
              <svg width="18" height="18" viewBox="0 0 24 24">
                <g transform="rotate(90 12 12)">
                  <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"
                        fill="${route.color}"/>
                </g>
              </svg>
            </div>`,
          });
          map.add([dashed, planeMarker]);
          overlaysRef.current.push(dashed, planeMarker);

          // Record airplane bbox so subsequent label placement avoids it
          const px = lngLatToPx(midpoint[0], midpoint[1]);
          placedBoxes.push({ x: px.x - PLANE / 2, y: px.y - PLANE / 2, w: PLANE, h: PLANE });
        });
      }

      // 3. City markers + labels (济南 = home badge; others = colored dot)
      stops.forEach((stop) => {
        const isHome = stop.city_name === getHomeBaseCity();
        const size = isHome ? 22 : 10;
        const content = isHome
          ? `<div style="background:${route.color};border-radius:50%;
              width:${size}px;height:${size}px;border:2.5px solid #fff;
              box-shadow:0 2px 6px rgba(0,0,0,.4);cursor:pointer;
              display:flex;align-items:center;justify-content:center;opacity:${opacity};">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="#fff">
                <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
              </svg>
            </div>`
          : `<div style="background:${route.color};border-radius:50%;
              width:${size}px;height:${size}px;border:2px solid #fff;
              box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer;opacity:${opacity};"></div>`;

        const marker = new AMap.Marker({
          position: [stop.longitude, stop.latitude],
          title: stop.city_name,
          content,
          offset: new AMap.Pixel(-size / 2, -size / 2),
        });
        const handleCityClick = () => {
          clearWikiHoverTimer();
          infoWindowRef.current?.close();
          onStopClick(stop, route);
        };
        marker.on('mouseover', () => scheduleWikiPreview(stop, route));
        marker.on('mouseout', clearWikiHoverTimer);
        marker.on('click', handleCityClick);
        map.add(marker);
        overlaysRef.current.push(marker);

        if (!showCityNames) return;

        // Dedup: same city name at essentially same location → only label once
        const dupKey = `${stop.city_name}|${stop.longitude.toFixed(2)}|${stop.latitude.toFixed(2)}`;
        if (placedLabelKeys.has(dupKey)) return;
        placedLabelKeys.add(dupKey);

        const labelW = approxLabelWidth(stop.city_name, cityLabelSize);
        const labelH = Math.round(cityLabelSize * 1.82);
        const markerR = size / 2;

        // Try 4 directions in priority order; pick first non-conflicting.
        // Falls back to 'right' if all conflict (better than no label).
        const dirs: LabelDir[] = ['right', 'top', 'bottom', 'left'];
        const center = lngLatToPx(stop.longitude, stop.latitude);
        let chosenDir: LabelDir = 'right';
        let chosenBox: PixelBox | null = null;
        for (const dir of dirs) {
          const { ox, oy } = labelOffsetForDir(dir, markerR, labelW, labelH);
          const box: PixelBox = { x: center.x + ox, y: center.y + oy, w: labelW, h: labelH };
          if (!placedBoxes.some(b => boxesOverlap(b, box))) {
            chosenDir = dir;
            chosenBox = box;
            break;
          }
        }
        if (!chosenBox) {
          const { ox, oy } = labelOffsetForDir('right', markerR, labelW, labelH);
          chosenBox = { x: center.x + ox, y: center.y + oy, w: labelW, h: labelH };
        }
        placedBoxes.push(chosenBox);

        const { ox, oy } = labelOffsetForDir(chosenDir, markerR, labelW, labelH);
        // Padding scales with font size to keep proportions consistent across
        // on-screen (11px) and export (14-22px) sizes.
        const padV = Math.max(2, Math.round(cityLabelSize * 0.22));
        const padH = Math.max(7, Math.round(cityLabelSize * 0.65));
        const radius = Math.max(4, Math.round(cityLabelSize * 0.4));
        const label = new AMap.Text({
          position: [stop.longitude, stop.latitude],
          text: stop.city_name,
          offset: new AMap.Pixel(ox, oy),
          style: {
            background: route.color,
            border: '1px solid rgba(255,255,255,.85)',
            color: '#fff',
            fontSize: `${cityLabelSize}px`,
            fontWeight: '600',
            padding: `${padV}px ${padH}px`,
            borderRadius: `${radius}px`,
            boxShadow: '0 1px 3px rgba(0,0,0,.25)',
            opacity: String(opacity),
            cursor: 'pointer',
          },
        });
        label.on('mouseover', () => scheduleWikiPreview(stop, route));
        label.on('mouseout', clearWikiHoverTimer);
        label.on('click', handleCityClick);
        map.add(label);
        overlaysRef.current.push(label);
      });
    });

      Promise.allSettled(renderPromises).then(() => {
        if (!cancelled) markExportMapReady();
      });
    } // end runRender

    return () => { cancelled = true; };
  }, [
    mapReady, pluginsReady, routes, visibleRouteIds, selectedRouteId,
    onStopClick, onRouteClick, showCityNames, showFlights, embedded,
    cityLabelSize, clearWikiHoverTimer, scheduleWikiPreview, markExportMapReady,
    exportViewReady,
  ]);

  const noKey = runtimeConfig && (!runtimeConfig.amapKey || runtimeConfig.amapKey === 'your_amap_js_api_key_here');

  if (!runtimeConfig) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5', color: '#666' }}>
        正在加载地图配置...
      </div>
    );
  }

  if (noKey) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: '#f5f5f5', color: '#666' }}>
        <div style={{ fontSize: 40 }}>🗺️</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>需要配置高德地图 API Key</div>
        <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 400, lineHeight: 1.8 }}>
          编辑 <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>frontend/.env</code>，填入 <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>VITE_AMAP_KEY=你的Key</code>，重启前端
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {!embedded && <div style={{
        position: 'absolute', top: mobileControls ? 10 : 56, right: mobileControls ? 10 : 16, zIndex: 10,
        display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch',
      }}>
        <div style={{
          background: '#fff',
          padding: mobileControls ? 5 : 4,
          borderRadius: 6,
          boxShadow: '0 2px 8px rgba(0,0,0,.15)',
          width: mobileControls ? 170 : 156,
          boxSizing: 'border-box',
          fontSize: mobileControls ? 13 : undefined,
        }}>
          <Segmented
            size="small"
            value={mapStyle}
            onChange={(v) => setMapStyle(v as MapStyleKey)}
            options={STYLE_OPTIONS}
            block
            style={mobileControls ? { fontSize: 13, width: '100%' } : { width: '100%' }}
          />
        </div>
        <Popover
          trigger="click"
          placement="bottomRight"
          title="地图图例"
          content={
            <div style={{ fontSize: mobileControls ? 14 : 12, lineHeight: 1.85, minWidth: mobileControls ? 280 : 260 }}>
              <div style={{ color: '#888', fontWeight: 600, marginBottom: 4, fontSize: mobileControls ? 15 : undefined }}>行程线型</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ display: 'inline-block', width: 28, height: 3, background: '#4ECDC4', borderRadius: 2 }} />
                <span>自驾路线（路网贴合实线）</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <svg width="40" height="16" viewBox="0 0 40 16">
                  <path d="M2 13 Q20 -1 38 13" stroke="#4ECDC4" strokeWidth="1.8"
                        fill="none" strokeDasharray="4 3" strokeLinecap="round" />
                  <g transform="translate(14 0) rotate(-15 6 6)">
                    <g transform="rotate(90 6 6)">
                      <path d="M10.5 8v-1l-4-2.5V1.75c0-.41-.33-.75-.75-.75S5 1.34 5 1.75V4.5L1 7v1l4-1.25V9.5l-1 .75V11l1.75-.5L7.5 11v-.75L6.5 9.5V6.75l4 1.25z"
                            fill="#4ECDC4"/>
                    </g>
                  </g>
                </svg>
                <span>飞行路线（虚线弧线，不计入里程）</span>
              </div>
              <div style={{ color: '#888', fontWeight: 600, marginTop: 10, marginBottom: 4, fontSize: mobileControls ? 15 : undefined }}>城市标记</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  display: 'inline-flex', width: 18, height: 18, borderRadius: '50%',
                  background: '#4ECDC4', border: '2px solid #fff',
                  boxShadow: '0 1px 4px rgba(0,0,0,.35)', boxSizing: 'border-box',
                }} />
                <span>途经城市</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-flex', width: 22, height: 22, borderRadius: '50%',
                  background: '#4ECDC4', border: '2px solid #fff',
                  boxShadow: '0 1px 4px rgba(0,0,0,.35)', alignItems: 'center',
                  justifyContent: 'center', boxSizing: 'border-box',
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff">
                    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
                  </svg>
                </span>
                <span>济南 / 家</span>
              </div>

              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #eee', color: '#888' }}>
                底图道路、水系、边界与 POI 由高德地图显示。
              </div>
            </div>
          }
        >
          <Button
            size="small"
            icon={<InfoCircleOutlined />}
            block
            style={{
              background: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,.15)',
              width: mobileControls ? 170 : 156,
              height: mobileControls ? 34 : undefined,
              fontSize: mobileControls ? 14 : undefined,
              fontWeight: mobileControls ? 600 : undefined,
            }}
          >
            图例
          </Button>
        </Popover>
      </div>}
    </div>
  );
}
