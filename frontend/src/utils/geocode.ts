// Client-side place autocomplete using AMap.AutoComplete + DistrictSearch.
// AutoComplete returns POIs and admin areas; admin areas come without lng/lat
// (they're regions, not points), so we resolve their centers via DistrictSearch.
declare const window: any;

export interface GeoResult {
  name: string;
  district: string; // province + city for disambiguation
  lng: number;
  lat: number;
}

const ADMIN_RE = /(自治区|自治州|自治县|省|市|县|区|州|盟|旗)$/;

let pluginsReady: Promise<void> | null = null;

function ensurePlugins(): Promise<void> {
  if (pluginsReady) return pluginsReady;
  pluginsReady = new Promise<void>(resolve => {
    if (!window.AMap) { resolve(); return; }
    window.AMap.plugin(['AMap.AutoComplete', 'AMap.DistrictSearch'], resolve);
  });
  return pluginsReady;
}

function tipHasCoords(t: any): boolean {
  if (!t?.location) return false;
  if (typeof t.location === 'string') return false;
  return t.location.lng !== undefined || typeof t.location.getLng === 'function';
}

function readLng(loc: any): number {
  return typeof loc.getLng === 'function' ? loc.getLng() : loc.lng;
}
function readLat(loc: any): number {
  return typeof loc.getLat === 'function' ? loc.getLat() : loc.lat;
}

function lookupDistrictCenter(name: string): Promise<{ lng: number; lat: number } | null> {
  return new Promise(resolve => {
    const ds = new window.AMap.DistrictSearch({ subdistrict: 0, level: 'district' });
    ds.search(name, (status: string, result: any) => {
      const item = result?.districtList?.[0];
      if (status !== 'complete' || !item?.center) { resolve(null); return; }
      resolve({ lng: readLng(item.center), lat: readLat(item.center) });
    });
  });
}

// Direct district search on the raw keyword. Returns the matched admin area
// (with its formal name like "正定县" / "巩义市") so we can surface it even
// when AutoComplete only returned POI tips like "正定站" / "巩义高铁站".
// `level: undefined` lets AMap match any admin level (district/city/province).
function searchAdminDirect(keyword: string): Promise<GeoResult | null> {
  return new Promise(resolve => {
    const ds = new window.AMap.DistrictSearch({ subdistrict: 0, level: undefined });
    ds.search(keyword, (status: string, result: any) => {
      const item = result?.districtList?.[0];
      if (status !== 'complete' || !item?.center || !item?.name) { resolve(null); return; }
      // Skip the catch-all "中华人民共和国" root that AMap returns when nothing
      // remotely matches — it pollutes results for unrelated keywords.
      if (item.name === '中华人民共和国' || item.level === 'country') { resolve(null); return; }
      resolve({
        name: item.name,
        district: item.adcode || '',
        lng: readLng(item.center),
        lat: readLat(item.center),
      });
    });
  });
}

export async function searchCityAMap(keyword: string): Promise<GeoResult[]> {
  await ensurePlugins();
  if (!window.AMap?.AutoComplete) return [];

  // Run AutoComplete (POI + admin tips) and a direct DistrictSearch in
  // parallel. The direct search catches admin areas (县/市/区) whose names
  // are dominated by POI hits in AutoComplete (e.g. "正定" → "正定站" wins
  // there, but DistrictSearch returns "正定县").
  const [tips, directAdmin] = await Promise.all([
    new Promise<any[]>(resolve => {
      const ac = new window.AMap.AutoComplete({ city: '全国', citylimit: false });
      ac.search(keyword, (status: string, result: any) => {
        if (status !== 'complete' || !result?.tips?.length) { resolve([]); return; }
        resolve(result.tips);
      });
    }),
    searchAdminDirect(keyword),
  ]);

  // Separate admin (no coords) vs POI (with coords) from AutoComplete tips
  const admin: any[] = [];
  const poi: any[] = [];
  for (const t of tips) {
    if (ADMIN_RE.test(t.name) && !tipHasCoords(t)) admin.push(t);
    else if (tipHasCoords(t)) poi.push(t);
  }

  // Resolve admin centers in parallel
  const adminResolved = await Promise.all(admin.map(async t => {
    const center = await lookupDistrictCenter(t.name);
    if (!center) return null;
    return { name: t.name, district: t.district || '', lng: center.lng, lat: center.lat };
  }));

  const poiResults: GeoResult[] = poi.map(t => ({
    name: t.name,
    district: t.district || '',
    lng: readLng(t.location),
    lat: readLat(t.location),
  }));

  // Order: direct district hit → AutoComplete admin tips → POIs.
  // Dedupe by name so the direct hit doesn't appear twice.
  const seen = new Set<string>();
  const out: GeoResult[] = [];
  const tryPush = (r: GeoResult | null) => {
    if (!r) return;
    if (seen.has(r.name)) return;
    seen.add(r.name);
    out.push(r);
  };
  tryPush(directAdmin);
  for (const r of adminResolved) tryPush(r);
  for (const r of poiResults) tryPush(r);
  return out.slice(0, 8);
}
