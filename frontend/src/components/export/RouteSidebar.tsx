import type { Route, Stop } from '../../types';
import { EXPORT_PANEL_BG, routeDistance, routeStartDate, routeEndDate, routeTravelStopCount, routeTotalDays } from './exportShared';
import Watermark from './Watermark';
import QrPlaceholder from './QrPlaceholder';
import ExportTitleLogo from './ExportTitleLogo';
import dayjs from 'dayjs';
import { routeQrUrl } from '../../api';

interface Props {
  route: Route;
}

// Switch to 2-column timeline (with full-size typography retained, sidebar
// widens to compensate) once stop count exceeds this. Below threshold, single
// column. Mirrors the overview's `OVERVIEW_TWO_COL_THRESHOLD` policy.
export const ROUTE_TWO_COL_THRESHOLD = 16;

// Full-size timeline typography. Used for both single-col and 2-col modes —
// 2-col mode handles width overflow by widening the sidebar; height fit for
// single-col 16-stop case is what limits these values. Push name/date as
// large as fits the 16-stop budget at QR 180px and watermark 19px.
const SZ = { name: 22, date: 18, padBottom: 12, dot: 11, dateColW: 100, railW: 22 };

export default function RouteSidebar({ route }: Props) {
  const stops = [...route.stops].sort((a, b) => a.order - b.order);
  const dist = Math.round(routeDistance(route));
  const start = routeStartDate(route);
  const end = routeEndDate(route);
  const days = routeTotalDays(route);

  const twoCol = stops.length > ROUTE_TWO_COL_THRESHOLD;
  const splitAt = twoCol ? Math.ceil(stops.length / 2) : stops.length;
  const col1 = stops.slice(0, splitAt);
  const col2 = twoCol ? stops.slice(splitAt) : [];

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: EXPORT_PANEL_BG, borderRadius: 16, padding: 40,
      boxShadow: '0 4px 24px rgba(0,0,0,.06)',
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      color: '#1a1a1a', boxSizing: 'border-box', overflow: 'hidden',
    }}>
      {/* Master-title kicker — series brand connecting all exports together. */}
      <div style={{ marginBottom: 24 }}>
        <ExportTitleLogo height={124} />
      </div>
      <div style={{ borderBottom: `3px solid ${route.color}`, paddingBottom: 22, marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <span style={{
            width: 26, height: 26, borderRadius: '50%',
            background: route.color, flexShrink: 0,
            boxShadow: `0 0 0 5px ${route.color}33`,
          }} />
          <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.2 }}>
            {route.name}
          </div>
        </div>
        {(start || end) && (
          <div style={{ fontSize: 20, color: '#666', marginTop: 6 }}>
            {start} → {end} · 共 {days} 天
          </div>
        )}
        <div style={{ fontSize: 19, color: '#666', marginTop: 4 }}>
          {routeTravelStopCount(route)} 站 · 自驾约 {dist.toLocaleString()} km
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 32, overflow: 'hidden' }}>
        <TimelineColumn stops={col1} routeColor={route.color} />
        {twoCol && <TimelineColumn stops={col2} routeColor={route.color} />}
      </div>

      <QrPlaceholder size={180} src={route.qr_code_path ? routeQrUrl(route.id, route.qr_code_path) : undefined} />
      <Watermark />
    </div>
  );
}

function TimelineColumn({ stops, routeColor }: { stops: Stop[]; routeColor: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {stops.map((stop, i) => (
        <TimelineRow
          key={stop.id}
          stop={stop}
          routeColor={routeColor}
          isLast={i === stops.length - 1}
        />
      ))}
    </div>
  );
}

function TimelineRow({ stop, routeColor, isLast }: { stop: Stop; routeColor: string; isLast: boolean }) {
  const dateLabel = stop.arrival_date && stop.departure_date && stop.arrival_date !== stop.departure_date
    ? `${dayjs(stop.arrival_date).format('M/D')} - ${dayjs(stop.departure_date).format('M/D')}`
    : stop.arrival_date ? dayjs(stop.arrival_date).format('M/D') : '';
  const isFlight = stop.transport_mode === 'flight';
  const dotOffset = Math.round(SZ.name * 0.4);

  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{
        width: SZ.dateColW, flexShrink: 0, fontSize: SZ.date, color: '#888',
        lineHeight: 1.4, paddingTop: dotOffset - 2, fontVariantNumeric: 'tabular-nums',
      }}>
        {dateLabel}
      </div>
      <div style={{ width: SZ.railW, position: 'relative', flexShrink: 0 }}>
        <div style={{
          position: 'absolute', left: (SZ.railW - SZ.dot) / 2, top: dotOffset,
          width: SZ.dot, height: SZ.dot, borderRadius: '50%',
          background: routeColor, boxShadow: `0 0 0 3px ${routeColor}33`,
        }} />
        {!isLast && (
          <div style={{
            position: 'absolute', left: SZ.railW / 2 - 1,
            top: dotOffset + SZ.dot, bottom: -SZ.padBottom + 4, width: 2,
            background: isFlight ? 'transparent' : routeColor,
            backgroundImage: isFlight ? `repeating-linear-gradient(to bottom, ${routeColor} 0 4px, transparent 4px 8px)` : undefined,
            opacity: 0.4,
          }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: SZ.padBottom }}>
        <div style={{ fontSize: SZ.name, fontWeight: 500, lineHeight: 1.4 }}>
          {isFlight && <span style={{ marginRight: 8, fontSize: SZ.date, color: routeColor }}>✈</span>}
          {stop.city_name}
        </div>
      </div>
    </div>
  );
}
