export interface ExportLayoutReport {
  ok: boolean;
  width: number;
  height: number;
  issues: string[];
}
export function inspectExportLayout(root: HTMLElement): ExportLayoutReport;
export function assertExportSize(report: ExportLayoutReport, scale: number): void;
