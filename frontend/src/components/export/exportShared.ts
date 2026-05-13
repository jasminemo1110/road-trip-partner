import type { Route } from '../../types';
import dayjs from 'dayjs';

// ── Watermark / branding ──────────────────────────────────────────────────
// Single source of truth for the export footer signature.
export const PRODUCT_NAME = 'RoadTripPartner';
export const AUTHOR_NAME = '茉白';
// Update to the full GitHub URL once the repo is public.
export const GITHUB_HANDLE = 'jasminemo1110';
// Master title fallback for export images (unused — kept for backward
// compatibility with potential downstream usage; real title is config-driven
// via siteTitle from /api/config).
export const MASTER_TITLE = 'Road Trip Partner';
// Default home base. The runtime value is set via setHomeBaseCity() after
// /api/config loads; getHomeBaseCity() returns the override when present,
// otherwise this default. Public deployments can override via HOME_BASE_CITY
// env var; fork users may set it to '' to disable home-base filtering.
export const HOME_CITY = '济南';
let runtimeHomeBaseCity: string | null = null;
export function setHomeBaseCity(city: string | null | undefined): void {
  runtimeHomeBaseCity = city == null ? null : city;
}
export function getHomeBaseCity(): string {
  return runtimeHomeBaseCity ?? HOME_CITY;
}

export const EXPORT_W = 2560;
export const EXPORT_H = 1440;
export const SIDEBAR_W = 520;
export const PAGE_PAD = 40;
export const GAP = 32;
export const EXPORT_BG = '#fbf1f3';
export const EXPORT_PANEL_BG = '#fff8f9';
export const EXPORT_DIVIDER = '#efdadd';

// China-wide bounding box used for all "中国全貌" export variants.
// Includes the South China Sea islands area instead of stopping at Hainan.
export const CHINA_BOUNDS = {
  sw: [73, 3] as [number, number],
  ne: [135.5, 54] as [number, number],
};

export type ExportBounds = {
  sw: [number, number];
  ne: [number, number];
};

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function routeDistance(route: Route): number {
  const stops = [...route.stops].sort((a, b) => a.order - b.order);
  let dist = 0;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].transport_mode === 'flight') continue;
    dist += haversineKm(stops[i - 1].latitude, stops[i - 1].longitude, stops[i].latitude, stops[i].longitude);
  }
  return dist;
}

export function routeStartDate(route: Route): string | null {
  const dates = route.stops.map(s => s.arrival_date).filter(Boolean) as string[];
  return dates.length ? dates.sort()[0] : null;
}

export function routeEndDate(route: Route): string | null {
  const dates = route.stops.map(s => s.departure_date || s.arrival_date).filter(Boolean) as string[];
  return dates.length ? dates.sort().slice(-1)[0] : null;
}

export function routeTotalDays(route: Route): number {
  const start = routeStartDate(route);
  const end = routeEndDate(route);
  if (!start || !end) return 0;
  return dayjs(end).diff(dayjs(start), 'day') + 1;
}

export function routeTravelStopCount(route: Route): number {
  const home = getHomeBaseCity();
  return route.stops.filter(stop => stop.city_name !== home).length;
}

export function totalTravelStopCount(routes: Route[]): number {
  return routes.reduce((sum, route) => sum + routeTravelStopCount(route), 0);
}

export function routeCollectionBounds(routes: Route[], paddingRatio = 0.16): ExportBounds | undefined {
  const stops = routes.flatMap(route => route.stops);
  if (stops.length === 0) return undefined;

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const stop of stops) {
    minLng = Math.min(minLng, stop.longitude);
    maxLng = Math.max(maxLng, stop.longitude);
    minLat = Math.min(minLat, stop.latitude);
    maxLat = Math.max(maxLat, stop.latitude);
  }

  const lngPad = Math.max((maxLng - minLng) * paddingRatio, 1.2);
  const latPad = Math.max((maxLat - minLat) * paddingRatio, 1.2);

  return {
    sw: [minLng - lngPad, minLat - latPad],
    ne: [maxLng + lngPad, maxLat + latPad],
  };
}
