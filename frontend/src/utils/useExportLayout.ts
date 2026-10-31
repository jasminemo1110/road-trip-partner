import { useLayoutEffect, useState, type RefObject } from 'react';
import { inspectExportLayout, type ExportLayoutReport } from '../../scripts/lib/export-layout.mjs';

export function useExportLayout(ref: RefObject<HTMLDivElement | null>, contentKey: string) {
  const [report, setReport] = useState<ExportLayoutReport | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let disposed = false;
    let frame = 0;
    let fontsReady = false;
    root.dataset.exportLayoutStatus = 'measuring';
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || !fontsReady) return;
        const result = inspectExportLayout(root);
        root.dataset.exportLayoutStatus = result.ok ? 'ready' : 'error';
        root.dataset.exportLayoutErrors = JSON.stringify(result.issues);
        setReport(previous => JSON.stringify(previous) === JSON.stringify(result) ? previous : result);
      });
    };
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    const mutation = new MutationObserver(measure);
    for (const panel of root.querySelectorAll('[data-export-panel]')) {
      resize.observe(panel);
      mutation.observe(panel, { subtree: true, childList: true, characterData: true });
    }
    const imageLoaded = (event: Event) => {
      if (event.target instanceof HTMLImageElement && !event.target.closest('[data-export-map]')) measure();
    };
    root.addEventListener('load', imageLoaded, true);
    document.fonts.ready.then(() => { fontsReady = true; measure(); });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      root.removeEventListener('load', imageLoaded, true);
    };
  }, [ref, contentKey]);
  return report;
}
