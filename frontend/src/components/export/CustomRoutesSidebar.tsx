import dayjs from 'dayjs';
import type { Route, Stop } from '../../types';
import { routeQrUrl } from '../../api';
import ExportTitleLogo from './ExportTitleLogo';
import QrPlaceholder from './QrPlaceholder';
import Watermark from './Watermark';
import {
  EXPORT_DIVIDER,
  EXPORT_PANEL_BG,
  routeDistance,
  routeEndDate,
  routeStartDate,
  routeTotalDays,
  routeTravelStopCount,
  totalTravelStopCount,
} from './exportShared';

interface Props {
  routes: Route[];
}

export const CUSTOM_ROUTE_TWO_COL_THRESHOLD = 18;

export default function CustomRoutesSidebar({ routes }: Props) {
  const sorted = sortRoutes(routes);
  const totalKm = Math.round(routes.reduce((sum, route) => sum + routeDistance(route), 0));
  const totalDays = routes.reduce((sum, route) => sum + routeTotalDays(route), 0);
  const totalStops = totalStopRows(sorted);
  const compact = totalStops > 24;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: EXPORT_PANEL_BG,
      borderRadius: 16,
      padding: 40,
      boxShadow: '0 4px 24px rgba(0,0,0,.06)',
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      color: '#1a1a1a',
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      <div style={{ borderBottom: `2px solid ${EXPORT_DIVIDER}`, paddingBottom: 24, marginBottom: 22 }}>
        <ExportTitleLogo height={142} />
        <div style={{ fontSize: 19, color: '#666', marginTop: 10, lineHeight: 1.65 }}>
          共 <b>{routes.length}</b> 条路线 · <b>{totalTravelStopCount(routes)}</b> 站
          <br />
          自驾 <b>{totalDays}</b> 天 · 约 <b>{totalKm.toLocaleString()}</b> km
        </div>
      </div>

      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: totalStops > CUSTOM_ROUTE_TWO_COL_THRESHOLD ? '1fr 1fr' : '1fr',
        gap: compact ? '14px 26px' : '18px 30px',
        overflow: 'hidden',
        alignContent: 'start',
      }}>
        {sorted.map(route => (
          <RouteFlowBlock key={route.id} route={route} compact={compact} />
        ))}
      </div>

      <QrStrip routes={sorted} />
      <Watermark />
    </div>
  );
}

export function sortRoutes(routes: Route[]) {
  return [...routes].sort((a, b) =>
    (routeStartDate(a) ?? '9999').localeCompare(routeStartDate(b) ?? '9999')
  );
}

function totalStopRows(routes: Route[]) {
  return routes.reduce((sum, route) => sum + route.stops.length, 0);
}

function QrStrip({ routes }: { routes: Route[] }) {
  const qrSize = routes.length <= 2 ? 130 : routes.length <= 3 ? 112 : 94;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: '10px 14px',
      marginTop: 16,
      flexShrink: 0,
    }}>
      {routes.map(route => (
        <div key={route.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <QrPlaceholder
            size={qrSize}
            marginTop={0}
            src={route.qr_code_path ? routeQrUrl(route.id, route.qr_code_path) : undefined}
            caption="二维码"
          />
          <div style={{ maxWidth: qrSize + 26, fontSize: 12, color: '#78817a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {route.name}
          </div>
        </div>
      ))}
    </div>
  );
}

function RouteFlowBlock({ route, compact }: { route: Route; compact: boolean }) {
  const stops = [...route.stops].sort((a, b) => a.order - b.order);
  const start = routeStartDate(route);
  const end = routeEndDate(route);
  const days = routeTotalDays(route);
  const dist = Math.round(routeDistance(route));

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
        <span style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: route.color,
          boxShadow: `0 0 0 4px ${route.color}33`,
          flexShrink: 0,
        }} />
        <div style={{ fontSize: compact ? 21 : 23, fontWeight: 650, lineHeight: 1.3 }}>{route.name}</div>
      </div>
      <div style={{ fontSize: compact ? 14 : 15, color: '#777', marginTop: 6, lineHeight: 1.5 }}>
        {start && end && (start === end ? start : `${start} → ${end}`)}
        {days > 0 && ` · ${days} 天`}
        {` · ${routeTravelStopCount(route)} 站 · 约 ${dist.toLocaleString()} km`}
      </div>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: compact ? '4px 6px' : '5px 7px',
        marginTop: 10,
        alignItems: 'center',
        lineHeight: 1.35,
      }}>
        {stops.map((stop, index) => (
          <FlowChip
            key={stop.id}
            stop={stop}
            routeColor={route.color}
            isLast={index === stops.length - 1}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

function FlowChip({ stop, routeColor, isLast, compact }: { stop: Stop; routeColor: string; isLast: boolean; compact: boolean }) {
  const dateLabel = stop.arrival_date ? dayjs(stop.arrival_date).format('M/D') : '';
  const isFlight = stop.transport_mode === 'flight';

  return (
    <>
      <span style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 4,
        fontSize: compact ? 15 : 17,
        color: '#303a34',
        whiteSpace: 'nowrap',
      }}>
        {isFlight && <span style={{ color: routeColor, fontSize: compact ? 12 : 14 }}>✈</span>}
        <b style={{ fontWeight: 550 }}>{stop.city_name}</b>
        {dateLabel && <span style={{ fontSize: compact ? 12 : 13, color: '#8a928c' }}>{dateLabel}</span>}
      </span>
      {!isLast && <span style={{ color: routeColor, fontSize: compact ? 15 : 17, opacity: 0.75 }}>→</span>}
    </>
  );
}
