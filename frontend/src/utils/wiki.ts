export interface WikiSummary {
  title: string;
  extract: string;
  pageUrl: string;
  thumbnailUrl?: string;
}

interface WikiApiPage {
  title?: string;
  extract?: string;
  fullurl?: string;
  thumbnail?: { source?: string };
  missing?: string;
  invalid?: string;
  pageprops?: Record<string, string>;
  coordinates?: { lon: number; lat: number }[];
}

interface WikiApiResponse {
  query?: { pages?: Record<string, WikiApiPage> };
}

const wikiSummaryCache = new Map<string, Promise<WikiSummary | null>>();

export function wikiSearchUrl(cityName: string): string {
  // A fallback is explicitly a search, never an unverified encyclopedia summary.
  return `https://zh.wikipedia.org/w/index.php?search=${encodeURIComponent(`${cityName} 地理 -电视剧 -电影`)}`;
}

function wikipediaApiUrl(cityName: string): string {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    titles: cityName, redirects: '1', converttitles: '1', variant: 'zh-cn',
    prop: 'extracts|pageimages|info|pageprops|coordinates',
    exintro: '1', explaintext: '1', exsentences: '2',
    piprop: 'thumbnail', pithumbsize: '360', inprop: 'url',
  });
  return `https://zh.wikipedia.org/w/api.php?${params.toString()}`;
}

function distanceKm(lng: number, lat: number, other: { lon: number; lat: number }): number {
  const radians = Math.PI / 180;
  const a = Math.sin((other.lat - lat) * radians / 2) ** 2
    + Math.cos(lat * radians) * Math.cos(other.lat * radians) * Math.sin((other.lon - lng) * radians / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function fetchWikiSummary(cityName: string, longitude?: number, latitude?: number): Promise<WikiSummary | null> {
  const cacheKey = JSON.stringify([cityName, longitude, latitude]);
  const cached = wikiSummaryCache.get(cacheKey);
  if (cached) return cached;

  const promise = fetch(wikipediaApiUrl(cityName))
    .then(res => res.ok ? res.json() as Promise<WikiApiResponse> : null)
    .then(data => {
      const pages = data?.query?.pages;
      const page = pages ? Object.values(pages)[0] : null;
      if (!page || Object.hasOwn(page, 'missing') || Object.hasOwn(page, 'invalid')
        || Object.hasOwn(page.pageprops ?? {}, 'disambiguation')) return null;
      // An exact title may itself refer to a TV series, film or fictional work.
      const lead = `${page.title ?? ''} ${page.extract ?? ''}`.slice(0, 180);
      if (/(电视剧|電視劇|电视连续剧|電視連續劇|电影|電影|小说|小說|漫画|漫畫)/u.test(lead)) return null;
      if (longitude !== undefined && latitude !== undefined && Number.isFinite(longitude) && Number.isFinite(latitude)
        && (longitude !== 0 || latitude !== 0) && page.coordinates?.length
        && page.coordinates.every(point => distanceKm(longitude, latitude, point) > 150)) return null;
      if (!page.extract || !page.fullurl) return null;
      return {
        title: page.title || cityName,
        extract: page.extract,
        pageUrl: page.fullurl,
        thumbnailUrl: page.thumbnail?.source,
      };
    })
    .catch(() => null);

  wikiSummaryCache.set(cacheKey, promise);
  return promise;
}
