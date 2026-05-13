import { chromium } from 'playwright-core';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args.base || 'http://localhost:5173').replace(/\/$/, '');
const outDir = path.resolve(args.out || '../files/exports');
const waitMs = Number(args.wait || 8000);
const reloadBeforeCapture = args.reload !== 'false';
const scale = Number(args.scale || 4);
const retries = Number(args.retries || 2);
const retryWaitMs = Number(args.retryWait || 6000);
const minBytes = Number(args.minBytes || 500000);
const include = args.include ? new Set(String(args.include).split(',').map(s => s.trim()).filter(Boolean)) : null;
const routeIdFilter = args.route ? Number(args.route) : null;
const headed = Boolean(args.headed);

await mkdir(outDir, { recursive: true });

const routes = await fetchJson(`${baseUrl}/api/routes`);
const customVariants = include ? buildCustomVariants(routes, include) : [];
const variants = [...buildVariants(routes), ...customVariants]
  .filter(v => !include || include.has(v.id))
  .filter(v => !routeIdFilter || v.routeId === routeIdFilter || v.scope === 'overview' || v.scope === 'custom');

if (variants.length === 0) {
  console.log('没有匹配的导出项。');
  process.exit(0);
}

if (args.list) {
  for (const variant of variants) {
    console.log(`${variant.id}\t${variant.label}\t${variant.filename}.png`);
  }
  process.exit(0);
}

const browser = await launchBrowser();
const results = [];

try {
  const page = await browser.newPage({
    viewport: { width: 3200, height: 2800 },
    deviceScaleFactor: scale,
  });

  for (const [index, variant] of variants.entries()) {
    console.log(`[${index + 1}/${variants.length}] ${variant.label}`);
    const result = await captureVariant(page, variant);
    results.push(result);
    console.log(`  saved: ${result.filePath} (${formatBytes(result.bytes)})`);
  }
} finally {
  await browser.close();
}

const manifestPath = path.join(outDir, 'export-manifest.json');
await writeFile(manifestPath, JSON.stringify({
  exportedAt: new Date().toISOString(),
  baseUrl,
  scale,
  waitMs,
  reloadBeforeCapture,
  results,
}, null, 2), 'utf8');
console.log(`导出清单：${manifestPath}`);

function buildVariants(routes) {
  const variants = [
    {
      id: 'overview-landscape-names',
      scope: 'overview',
      label: '全路线 / 横版 / 含城市名',
      filename: '全路线-横版-含城市名',
      url: '/export/render?type=overview&names=true&style=whitesmoke',
    },
    {
      id: 'overview-landscape-clean',
      scope: 'overview',
      label: '全路线 / 横版 / 不含城市名',
      filename: '全路线-横版-不含城市名',
      url: '/export/render?type=overview&names=false&style=whitesmoke',
    },
    {
      id: 'overview-portrait',
      scope: 'overview',
      label: '全路线 / 竖版',
      filename: '全路线-竖版',
      url: '/export/render?orientation=portrait&type=overview',
    },
    {
      id: 'overview-portrait-single',
      scope: 'overview',
      label: '全路线 / 竖版 / 单地图',
      filename: '全路线-竖版-单地图',
      url: '/export/render?orientation=portrait&type=overview&layout=single',
    },
  ];

  for (const route of [...routes].sort((a, b) => a.id - b.id)) {
    const safeName = sanitizeFilename(route.name);
    variants.push(
      {
        id: `route-${route.id}-landscape-wide`,
        scope: 'route',
        routeId: route.id,
        label: `${route.name} / 横版全景`,
        filename: `${safeName}-横版全景`,
        url: `/export/render?type=route&id=${route.id}&fit=wide&style=whitesmoke`,
      },
      {
        id: `route-${route.id}-landscape-close`,
        scope: 'route',
        routeId: route.id,
        label: `${route.name} / 横版路线特写`,
        filename: `${safeName}-横版路线特写`,
        url: `/export/render?type=route&id=${route.id}&fit=auto&style=fresh`,
      },
      {
        id: `route-${route.id}-portrait`,
        scope: 'route',
        routeId: route.id,
        label: `${route.name} / 竖版`,
        filename: `${safeName}-竖版`,
        url: `/export/render?orientation=portrait&type=route&id=${route.id}`,
      },
    );
  }
  return variants;
}

function buildCustomVariants(routes, includeSet) {
  const variants = [];
  for (const id of includeSet) {
    const parsed = parseCustomId(id);
    if (!parsed || parsed.routeIds.length < 2) continue;
    const selectedRoutes = routes
      .filter(route => parsed.routeIds.includes(route.id))
      .sort((a, b) => a.id - b.id);
    if (selectedRoutes.length < 2) continue;
    const idsParam = selectedRoutes.map(route => route.id).join(',');
    const safeName = sanitizeFilename(selectedRoutes.map(route => route.name).join('+'));
    if (parsed.variant === 'landscape-wide') {
      variants.push({
        id,
        scope: 'custom',
        label: `${selectedRoutes.length}条线路 / 横版全景纯路线`,
        filename: `${safeName}-横版全景纯路线`,
        url: `/export/render?type=custom&ids=${idsParam}&fit=wide&names=false&style=whitesmoke`,
      });
    }
    if (parsed.variant === 'landscape-close') {
      variants.push({
        id,
        scope: 'custom',
        label: `${selectedRoutes.length}条线路 / 横版路线特写城市名`,
        filename: `${safeName}-横版路线特写城市名`,
        url: `/export/render?type=custom&ids=${idsParam}&fit=auto&names=true&style=fresh`,
      });
    }
    if (parsed.variant === 'portrait') {
      variants.push({
        id,
        scope: 'custom',
        label: `${selectedRoutes.length}条线路 / 竖版`,
        filename: `${safeName}-竖版双地图`,
        url: `/export/render?orientation=portrait&type=custom&ids=${idsParam}`,
      });
    }
  }
  return variants;
}

function parseCustomId(id) {
  const match = String(id).match(/^custom-([0-9-]+)-(landscape-wide|landscape-close|portrait)$/);
  if (!match) return null;
  return {
    routeIds: match[1].split('-').map(Number).filter(Number.isFinite),
    variant: match[2],
  };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`请求失败：${url} (${res.status})`);
  return res.json();
}

async function captureVariant(page, variant) {
  const url = `${baseUrl}${variant.url}`;
  const filePath = path.join(outDir, `${variant.filename}.png`);
  let lastError = null;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const startedAt = Date.now();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('#export-canvas', { timeout: 60000 });
      console.log(`  timing: page ready ${Date.now() - startedAt}ms`);
      if (reloadBeforeCapture) {
        await page.waitForTimeout(1500);
        console.log('  refresh before capture');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('#export-canvas', { timeout: 60000 });
      }
      const exportReadyAt = Date.now();
      await waitForExportReady(page);
      console.log(`  timing: export ready ${Date.now() - exportReadyAt}ms`);
      const mapImagesAt = Date.now();
      await waitForMapImages(page);
      console.log(`  timing: map images ${Date.now() - mapImagesAt}ms`);
      await page.waitForTimeout(waitMs + (attempt - 1) * retryWaitMs);
      const screenshotAt = Date.now();
      await page.locator('#export-canvas').screenshot({
        path: filePath,
        animations: 'disabled',
        timeout: 60000,
      });
      console.log(`  timing: screenshot ${Date.now() - screenshotAt}ms`);

      const info = await stat(filePath);
      if (info.size >= minBytes || attempt > retries) {
        console.log(`  timing: total ${Date.now() - startedAt}ms`);
        return {
          id: variant.id,
          label: variant.label,
          filename: `${variant.filename}.png`,
          filePath,
          bytes: info.size,
          attempts: attempt,
        };
      }
      console.warn(`  文件偏小（${formatBytes(info.size)}），重试 ${attempt}/${retries}`);
    } catch (error) {
      lastError = error;
      const exportStatus = await page.evaluate(() => window.__TRAVEL_EXPORT_MAPS || null).catch(() => null);
      if (exportStatus) {
        console.warn(`  export status: ${JSON.stringify(exportStatus)}`);
      }
      if (attempt > retries) throw error;
      console.warn(`  截图失败，重试 ${attempt}/${retries}`);
      await page.waitForTimeout(retryWaitMs);
    }
  }

  throw lastError;
}

async function waitForExportReady(page) {
  const handle = await page.waitForFunction(() => {
    const canvas = document.querySelector('#export-canvas');
    if (!canvas) return false;
    const mapCount = canvas.querySelectorAll('.amap-container').length;
    if (mapCount === 0) return false;
    const maps = Object.values(window.__TRAVEL_EXPORT_MAPS || {});
    const activeMaps = maps.filter(Boolean);
    const failed = activeMaps.find(map => map.error);
    if (failed) {
      return { ok: false, error: failed.error, maps: activeMaps };
    }
    if (activeMaps.length >= mapCount && activeMaps.filter(map => map.phase === 'ready' && map.readyAt > 0).length >= mapCount) {
      return { ok: true, maps: activeMaps };
    }
    return false;
  }, null, { timeout: 120000 });
  const result = await handle.jsonValue();
  if (!result?.ok) {
    throw new Error(`导出地图未能稳定加载：${JSON.stringify(result)}`);
  }
}

async function waitForMapImages(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#export-canvas');
    if (!canvas) return false;
    const maps = [...canvas.querySelectorAll('.amap-container')];
    if (maps.length === 0) return false;
    return maps.every(map => {
      const images = [...map.querySelectorAll('img')]
        .filter(img => /amap|autonavi|wprd|webrd|webst/i.test(img.src));
      const loadedImages = images.filter(img => img.complete && img.naturalWidth > 0);
      const canvases = [...map.querySelectorAll('canvas')]
        .filter(canvas => canvas.width > 0 && canvas.height > 0);
      return loadedImages.length >= 4 || canvases.length > 0;
    });
  }, null, { timeout: 45000 });
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sanitizeFilename(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) {
      result[arg.slice(2)] = true;
    } else {
      result[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return result;
}

async function launchBrowser() {
  const launchArgs = [
    '--disable-crash-reporter',
    '--disable-crashpad',
  ];

  if (args.chrome) {
    console.log(`使用指定浏览器：${args.chrome}`);
    return chromium.launch({
      executablePath: String(args.chrome),
      headless: !headed,
      args: launchArgs,
    });
  }

  if (process.env.CHROME_PATH) {
    console.log(`使用 CHROME_PATH 浏览器：${process.env.CHROME_PATH}`);
    return chromium.launch({
      executablePath: process.env.CHROME_PATH,
      headless: !headed,
      args: launchArgs,
    });
  }

  try {
    console.log('优先使用 Playwright 内置 Chromium。');
    return await chromium.launch({
      headless: !headed,
      args: launchArgs,
    });
  } catch (error) {
    const systemChromePath = DEFAULT_CHROME_PATHS.find(p => existsSync(p));
    if (!systemChromePath) {
      console.error('内置 Chromium 启动失败，且没有找到本机 Chrome。');
      console.error('可以先运行：npx playwright-core install chromium');
      throw error;
    }

    console.warn('内置 Chromium 启动失败，改用本机浏览器。');
    console.warn(`使用本机浏览器：${systemChromePath}`);
    return chromium.launch({
      executablePath: systemChromePath,
      headless: !headed,
      args: launchArgs,
    });
  }
}
