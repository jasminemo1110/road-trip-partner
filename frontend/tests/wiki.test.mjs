import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/utils/wiki.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const { fetchWikiSummary } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function mockWiki(t, page) {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ query: { pages: { '1': page } } }), { status: 200 }));
}

test('a same-name TV series is not presented as a scenic destination', async t => {
  mockWiki(t, { title: '大海道', extract: '《大海道》是中国电视剧，由某导演执导。', fullurl: 'https://zh.wikipedia.org/wiki/大海道' });
  assert.equal(await fetchWikiSummary('大海道', 92, 43), null);
  const url = new URL(globalThis.fetch.mock.calls[0].arguments[0]);
  assert.equal(url.searchParams.get('titles'), '大海道');
  assert.equal(url.searchParams.has('generator'), false);
});

test('missing and disambiguation pages do not become summaries', async t => {
  mockWiki(t, { title: '缺少的景区', missing: '' });
  assert.equal(await fetchWikiSummary('缺少的景区'), null);
  mockWiki(t, { title: '同名地点', pageprops: { disambiguation: '' }, extract: '可能指多个地点' });
  assert.equal(await fetchWikiSummary('同名地点'), null);
});

test('same-name places far from the stop are rejected; cache distinguishes coordinates', async t => {
  mockWiki(t, { title: '白沙湖', extract: '白沙湖是一座湖泊。', fullurl: 'https://zh.wikipedia.org/wiki/白沙湖', coordinates: [{ lon: 86, lat: 48 }] });
  assert.equal(await fetchWikiSummary('白沙湖', 75, 39), null);
  assert.equal((await fetchWikiSummary('白沙湖', 86, 48))?.title, '白沙湖');
});

test('valid geographical redirects keep their canonical article link', async t => {
  mockWiki(t, { title: '乌鲁木齐市', extract: '乌鲁木齐市是新疆的城市。', fullurl: 'https://zh.wikipedia.org/wiki/乌鲁木齐市', coordinates: [{ lon: 87.6, lat: 43.8 }] });
  assert.equal((await fetchWikiSummary('乌鲁木齐', 87.6, 43.8))?.pageUrl, 'https://zh.wikipedia.org/wiki/乌鲁木齐市');
});
