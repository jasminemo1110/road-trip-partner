/** Shared by the preview and screenshot exporter. Maps intentionally clip tiles/labels. */
export function inspectExportLayout(root) {
  const issues = new Set();
  const bounds = root.getBoundingClientRect();
  const tolerance = 2;
  const rectFits = (rect, clip, x = true, y = true) =>
    (!x || (rect.left >= clip.left - tolerance && rect.right <= clip.right + tolerance)) &&
    (!y || (rect.top >= clip.top - tolerance && rect.bottom <= clip.bottom + tolerance));
  const checkRect = (rect, element, label) => {
    if (!rectFits(rect, bounds)) issues.add(`内容超出画布：${label}`);
    for (let parent = element; parent && parent !== root; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const x = /^(hidden|clip|auto|scroll)$/.test(style.overflowX);
      const y = /^(hidden|clip|auto|scroll)$/.test(style.overflowY);
      if ((x || y) && !rectFits(rect, parent.getBoundingClientRect(), x, y)) {
        issues.add(`内容被容器裁切：${label}`);
      }
    }
  };
  for (const [expectedKey, selector, label] of [
    ['exportExpectedRoutes', '[data-export-route]', '线路'],
    ['exportExpectedStops', '[data-export-stop]', '站点'],
  ]) {
    const expected = root.dataset[expectedKey];
    if (expected !== undefined) {
      const actual = root.querySelectorAll(selector).length;
      if (actual !== Number(expected)) issues.add(`${label}数量不完整：应有 ${expected}，实际 ${actual}`);
    }
  }
  for (const element of root.querySelectorAll('[data-export-item]')) {
    const rect = element.getBoundingClientRect();
    const label = (element.textContent || '线路内容').trim().slice(0, 60);
    if (!rect.width || !rect.height) issues.add(`内容未显示：${label}`);
    else checkRect(rect, element, label);
  }
  for (const panel of root.querySelectorAll('[data-export-panel]')) {
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      const element = text.parentElement;
      if (!element || !text.textContent.trim() || element.closest('[data-export-map]') || !element.getClientRects().length) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const rect of range.getClientRects()) {
        if (rect.width && rect.height) checkRect(rect, element, text.textContent.trim().slice(0, 60));
      }
    }
  }
  return {
    ok: issues.size === 0,
    width: Math.ceil(bounds.width),
    height: Math.ceil(bounds.height),
    issues: [...issues].slice(0, 20),
  };
}

export function assertExportSize(report, scale) {
  if (!report.ok) throw new Error(`导出内容不完整，已停止生成图片：${report.issues.join('；')}`);
  const width = Math.ceil(report.width * scale);
  const height = Math.ceil(report.height * scale);
  if (!Number.isFinite(scale) || scale <= 0 || width > 32760 || height > 32760 || width * height > 268435456) {
    throw new Error('导出图片过大，请减少所选线路或降低导出倍率后重试。');
  }
}
