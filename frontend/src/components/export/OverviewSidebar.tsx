import type { Route } from '../../types';
import { EXPORT_DIVIDER, EXPORT_PANEL_BG, routeDistance, routeStartDate, routeEndDate, routeTotalDays, routeTravelStopCount, totalTravelStopCount } from './exportShared';
import Watermark from './Watermark';
import QrPlaceholder from './QrPlaceholder';
import ExportTitleLogo from './ExportTitleLogo';
import { useRuntimeConfig } from '../../config';

interface Props {
  routes: Route[];
}

// When more than this many routes are shown, switch to a 2-column route list
// (sidebar widens accordingly via ExportRender, type sizes stay the same).
export const OVERVIEW_TWO_COL_THRESHOLD = 6;

export default function OverviewSidebar({ routes }: Props) {
  const config = useRuntimeConfig();
  const qrSrc = config?.overviewQrUrl || undefined;
  const sorted = [...routes].sort((a, b) =>
    (routeStartDate(a) ?? '9999').localeCompare(routeStartDate(b) ?? '9999')
  );
  const totalKm = Math.round(routes.reduce((s, r) => s + routeDistance(r), 0));
  const totalStops = totalTravelStopCount(routes);
  const totalDays = routes.reduce((s, r) => s + routeTotalDays(r), 0);
  const twoCol = routes.length > OVERVIEW_TWO_COL_THRESHOLD;

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: EXPORT_PANEL_BG, borderRadius: 16, padding: 40,
      boxShadow: '0 4px 24px rgba(0,0,0,.06)',
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      color: '#1a1a1a', boxSizing: 'border-box', overflow: 'hidden',
      }}>
      <div style={{ borderBottom: `2px solid ${EXPORT_DIVIDER}`, paddingBottom: 28, marginBottom: 28 }}>
        <ExportTitleLogo height={166} />
        <div style={{ fontSize: 18, color: '#888', marginTop: 10 }}>
          A travel atlas of road trips across China
        </div>
        {/* Two-line totals — keeps the line short and readable regardless of
            how many routes there are. Line 1 = trip counts; line 2 = duration + distance. */}
        <div style={{ fontSize: 22, marginTop: 22, color: '#444', lineHeight: 1.7 }}>
          <div>
            累计 <b style={{ color: '#1a1a1a' }}>{routes.length}</b> 条路线 ·
            {' '}<b style={{ color: '#1a1a1a' }}>{totalStops}</b> 站
          </div>
          <div>
            自驾 <b style={{ color: '#1a1a1a' }}>{totalDays}</b> 天 ·
            {' '}约 <b style={{ color: '#1a1a1a' }}>{totalKm.toLocaleString()}</b> km
          </div>
        </div>
      </div>

      {/* Route list. Single column for ≤6 routes; CSS grid switches to 2 columns
          beyond that. The sidebar itself widens (via ExportRender) so column
          width and per-row typography stay the same. */}
      <div style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: twoCol ? '1fr 1fr' : '1fr',
        gap: '22px 32px',
        overflow: 'hidden', alignContent: 'start',
      }}>
        {sorted.map(route => {
          const dist = Math.round(routeDistance(route));
          const start = routeStartDate(route);
          const end = routeEndDate(route);
          const days = routeTotalDays(route);
          return (
            <div key={route.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%',
                background: route.color, marginTop: 8, flexShrink: 0,
                boxShadow: `0 0 0 4px ${route.color}33`,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>
                  {route.name}
                </div>
                <div style={{ fontSize: 17, color: '#888', marginTop: 6, lineHeight: 1.5 }}>
                  {start && end && (start === end ? start : `${start} → ${end}`)}
                  {days > 0 && ` · ${days} 天`}
                </div>
                <div style={{ fontSize: 17, color: '#666', marginTop: 3 }}>
                  {routeTravelStopCount(route)} 站 · 约 {dist.toLocaleString()} km
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <QrPlaceholder src={qrSrc} />
      <Watermark />
    </div>
  );
}
