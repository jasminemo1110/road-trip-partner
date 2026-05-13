import type { Stop } from '../types';
import { getRouteLegPaths, saveLegPath } from '../api';

declare global {
  interface Window { AMap: any; }
}

export interface FetchedLeg {
  path: [number, number][];
  snapped: boolean;  // true = real road-snapped, false = straight fallback (rate-limited / error)
}

// Single A→B AMap.Driving call. The `snapped` flag distinguishes a real
// road-snapped result from the straight-line fallback used when AMap rejects
// or rate-limits the request. Callers should only persist `snapped: true`
// results; treating the fallback as success pollutes the cache with straight
// lines that look identical to a permanent cache hit on next load.
export async function fetchLegFromAMap(from: Stop, to: Stop): Promise<FetchedLeg> {
  const AMap = window.AMap;
  const straight: [number, number][] = [
    [from.longitude, from.latitude],
    [to.longitude, to.latitude],
  ];
  if (!AMap?.Driving) return { path: straight, snapped: false };
  return new Promise(resolve => {
    const driving = new AMap.Driving({ hideMarkers: true, showTraffic: false });
    const origin = new AMap.LngLat(from.longitude, from.latitude);
    const dest = new AMap.LngLat(to.longitude, to.latitude);
    driving.search(origin, dest, (status: string, result: any) => {
      if (status === 'complete' && result?.routes?.[0]) {
        const path: [number, number][] = [];
        for (const step of result.routes[0].steps) {
          for (const pt of (step.path || [])) {
            path.push([pt.getLng ? pt.getLng() : pt.lng, pt.getLat ? pt.getLat() : pt.lat]);
          }
        }
        if (path.length > 1) resolve({ path, snapped: true });
        else resolve({ path: straight, snapped: false });
      } else {
        console.warn('[AMap.Driving]', status, result?.info);
        resolve({ path: straight, snapped: false });
      }
    });
  });
}

// Walks every drive leg across the given routes and populates the backend
// leg-path cache. Skips legs that are already cached, and waits between AMap
// calls to stay under QPS limits.
export async function warmRouteCache(
  routes: Array<{ id: number; stops: Stop[] }>,
  onProgress?: (done: number, total: number) => void,
  delayMs = 250,
): Promise<{ fetched: number; total: number }> {
  type Job = { from: Stop; to: Stop };
  const jobs: Job[] = [];

  for (const route of routes) {
    let cachedKeys: Set<string>;
    try {
      const cached = await getRouteLegPaths(route.id);
      // Only treat real road-snapped paths (>2 points) as already cached.
      // Polluted 2-point straight-line entries from earlier failed attempts
      // are ignored so the warmer will refetch and overwrite them.
      cachedKeys = new Set(
        cached.filter(l => l.path.length > 2).map(l => `${l.stop_a_id}|${l.stop_b_id}`)
      );
    } catch {
      cachedKeys = new Set();
    }
    const stops = [...route.stops].sort((a, b) => a.order - b.order);
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (b.transport_mode === 'flight') continue;
      const [from, to] = a.id < b.id ? [a, b] : [b, a];
      if (cachedKeys.has(`${from.id}|${to.id}`)) continue;
      jobs.push({ from, to });
    }
  }

  const total = jobs.length;
  let done = 0;
  for (const { from, to } of jobs) {
    try {
      const fetched = await fetchLegFromAMap(from, to);
      if (fetched.snapped && fetched.path.length >= 2) {
        await saveLegPath(from.id, to.id, fetched.path);
      }
    } catch { /* best-effort */ }
    done++;
    onProgress?.(done, total);
    if (done < total) await new Promise(r => setTimeout(r, delayMs));
  }
  return { fetched: done, total };
}
