import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertExportSize } from '../scripts/lib/export-layout.mjs';

test('a complete, taller-than-original portrait can be exported', () => {
  assert.doesNotThrow(() => assertExportSize({ ok: true, width: 1440, height: 5000, issues: [] }, 2));
});

test('clipped or missing content stops export instead of producing a partial image', () => {
  assert.throws(() => assertExportSize({ ok: false, width: 1440, height: 2560, issues: ['线路数量不完整'] }, 2), /已停止生成图片.*线路数量不完整/);
});

test('images exceeding browser dimension or pixel limits are rejected', () => {
  for (const [width, height, scale] of [[1440, 9000, 4], [20000, 20000, 1], [1440, 2560, 0]]) {
    assert.throws(() => assertExportSize({ ok: true, width, height, issues: [] }, scale), /降低导出倍率/);
  }
});
