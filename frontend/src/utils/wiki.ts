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
}

interface WikiApiResponse {
  query?: {
    pages?: Record<string, WikiApiPage>;
  };
}

const wikiSummaryCache = new Map<string, Promise<WikiSummary | null>>();

export function wikiSearchUrl(cityName: string): string {
  return `https://zh.wikipedia.org/w/index.php?search=${encodeURIComponent(cityName)}`;
}

function wikipediaApiUrl(cityName: string): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: cityName,
    gsrlimit: '1',
    prop: 'extracts|pageimages|info',
    exintro: '1',
    explaintext: '1',
    exsentences: '2',
    piprop: 'thumbnail',
    pithumbsize: '360',
    inprop: 'url',
  });
  return `https://zh.wikipedia.org/w/api.php?${params.toString()}`;
}

export function fetchWikiSummary(cityName: string): Promise<WikiSummary | null> {
  const cached = wikiSummaryCache.get(cityName);
  if (cached) return cached;

  const promise = fetch(wikipediaApiUrl(cityName))
    .then(res => res.ok ? res.json() as Promise<WikiApiResponse> : null)
    .then(data => {
      const pages = data?.query?.pages;
      const page = pages ? Object.values(pages)[0] : null;
      if (!page) return null;
      return {
        title: page.title || cityName,
        extract: page.extract || '',
        pageUrl: page.fullurl || wikiSearchUrl(cityName),
        thumbnailUrl: page.thumbnail?.source,
      };
    })
    .catch(() => null);

  wikiSummaryCache.set(cityName, promise);
  return promise;
}
