import dayjs from 'dayjs';
import type { Route, Stop } from '../../types';
import MapView from '../MapView';
import ExportTitleLogo from './ExportTitleLogo';
import MapSignature from './MapSignature';
import QrPlaceholder from './QrPlaceholder';
import Watermark from './Watermark';
import { routeQrUrl } from '../../api';
import { useRuntimeConfig } from '../../config';
import {
  EXPORT_BG,
  EXPORT_DIVIDER,
  EXPORT_PANEL_BG,
  routeCollectionBounds,
  routeDistance,
  routeEndDate,
  routeStartDate,
  routeTravelStopCount,
  routeTotalDays,
  totalTravelStopCount,
} from './exportShared';

interface PortraitExportProps {
  type: string;
  routes: Route[];
  routeId: number | null;
  layout?: string;
}

const PORTRAIT_W = 1440;
const PORTRAIT_H = 2560;
const PAD = 44;
const GAP = 24;
const HEADER_H = 560;
const PORTRAIT_CHINA_BOUNDS = {
  sw: [73, 17.5] as [number, number],
  ne: [135.5, 54.8] as [number, number],
};
const PORTRAIT_CHINA_ROUTE_PADDING: [number, number, number, number] = [28, 48, 24, 48];
const PORTRAIT_CHINA_LABEL_PADDING: [number, number, number, number] = [46, 48, 30, 48];

export default function PortraitExport({ type, routes, routeId, layout = 'default' }: PortraitExportProps) {
  const focusedRoute = routeId ? routes.find(r => r.id === routeId) : null;
  const isRoute = type === 'route' && focusedRoute;
  const isCustom = type === 'custom';

  return (
    <div style={{
      width: PORTRAIT_W,
      height: PORTRAIT_H,
      background: EXPORT_BG,
      padding: PAD,
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: GAP,
      overflow: 'hidden',
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      color: '#1a1a1a',
    }}>
      {isCustom ? (
        <PortraitCustom routes={routes} />
      ) : isRoute ? (
        <PortraitRoute route={focusedRoute} routes={routes} />
      ) : layout === 'single' ? (
        <PortraitOverviewSingle routes={routes} />
      ) : (
        <PortraitOverview routes={routes} />
      )}
    </div>
  );
}

function PortraitCustom({ routes }: { routes: Route[] }) {
  const visibleRouteIds = new Set(routes.map(route => route.id));
  const totalKm = Math.round(routes.reduce((s, r) => s + routeDistance(r), 0));
  const totalStops = totalTravelStopCount(routes);
  const totalDays = routes.reduce((s, r) => s + routeTotalDays(r), 0);
  const detailBounds = routeCollectionBounds(routes, 0.18);

  return (
    <>
      <PortraitHeader>
        <div style={{ fontSize: 31, color: '#555', marginTop: 28, lineHeight: 1.45 }}>
          <b>{routes.length}</b> 条路线 · <b>{totalStops}</b> 站 · 自驾 <b>{totalDays}</b> 天 · 约 <b>{totalKm.toLocaleString()}</b> km
        </div>
      </PortraitHeader>

      <MapCard label="纯路线" height={590}>
        <MapView
          routes={routes}
          visibleRouteIds={visibleRouteIds}
          showCityNames={false}
          showFlights
          embedded
          forceMapStyle="whitesmoke"
          viewportBounds={PORTRAIT_CHINA_BOUNDS}
          viewportPadding={PORTRAIT_CHINA_ROUTE_PADDING}
          cityLabelSize={16}
          onStopClick={() => {}}
        />
      </MapCard>

      <MapCard label="路线特写 · 城市细节" height={650}>
        <MapView
          routes={routes}
          visibleRouteIds={visibleRouteIds}
          showCityNames
          showFlights
          embedded
          forceMapStyle="fresh"
          viewportBounds={detailBounds}
          cityLabelSize={27}
          onStopClick={() => {}}
        />
      </MapCard>

      <CustomRoutesFooter routes={routes} />
    </>
  );
}

function PortraitHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div style={{
      background: EXPORT_PANEL_BG,
      borderRadius: 16,
      padding: '30px 34px',
      boxShadow: '0 4px 24px rgba(0,0,0,.06)',
      height: HEADER_H,
      boxSizing: 'border-box',
      flexShrink: 0,
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
    }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <ExportTitleLogo height={250} align="center" />
      </div>
      {children}
    </div>
  );
}

function PortraitFooterMark({ qrSrc, qrSize = 150 }: { qrSrc?: string; qrSize?: number }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 42,
      borderTop: `1px solid ${EXPORT_DIVIDER}`,
      paddingTop: 16,
      marginTop: 16,
      minHeight: qrSize + 18,
      flexShrink: 0,
    }}>
      <QrPlaceholder size={qrSize} marginTop={0} src={qrSrc} />
      <div style={{ width: 390 }}>
        <Watermark align="left" divider={false} scale={1.18} />
      </div>
    </div>
  );
}

function PortraitMultiFooterMark({ routes }: { routes: Route[] }) {
  const qrSize = routes.length <= 2 ? 145 : routes.length <= 3 ? 125 : 104;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 34,
      borderTop: `1px solid ${EXPORT_DIVIDER}`,
      paddingTop: 14,
      marginTop: 14,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px 14px', maxWidth: 760 }}>
        {routes.map(route => (
          <div key={route.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <QrPlaceholder
              size={qrSize}
              marginTop={0}
              src={route.qr_code_path ? routeQrUrl(route.id, route.qr_code_path) : undefined}
              caption="二维码"
            />
            <div style={{ maxWidth: qrSize + 24, fontSize: 14, color: '#78817a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {route.name}
            </div>
          </div>
        ))}
      </div>
      <div style={{ width: 360 }}>
        <Watermark align="left" divider={false} scale={1.18} />
      </div>
    </div>
  );
}

function MapCard({
  children,
  label,
  height,
}: {
  children: React.ReactNode;
  label: string;
  height: number;
}) {
  return (
    <div style={{
      height,
      background: EXPORT_PANEL_BG,
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: '0 4px 24px rgba(0,0,0,.08)',
      position: 'relative',
      flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute',
        top: 18,
        left: 18,
        zIndex: 5,
        padding: '8px 15px',
        borderRadius: 10,
        background: 'rgba(255,255,255,.92)',
        boxShadow: '0 2px 8px rgba(0,0,0,.12)',
        fontSize: 28,
        fontWeight: 600,
        color: '#333',
      }}>
        {label}
      </div>
      <MapSignature scale={1.22} />
      {children}
    </div>
  );
}

function CustomRoutesFooter({ routes }: { routes: Route[] }) {
  const sorted = [...routes].sort((a, b) =>
    (routeStartDate(a) ?? '9999').localeCompare(routeStartDate(b) ?? '9999')
  );
  const totalStops = routes.reduce((sum, route) => sum + route.stops.length, 0);
  const twoCol = totalStops > 18;
  const compact = totalStops > 26;
  const dense = routes.length >= 4 || totalStops > 34;

  return (
    <div style={{
      flex: 1,
      background: EXPORT_PANEL_BG,
      borderRadius: 16,
      padding: '28px 34px 18px',
      boxShadow: '0 4px 24px rgba(0,0,0,.06)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: twoCol ? '1fr 1fr' : '1fr',
        gap: dense ? '10px 20px' : compact ? '14px 24px' : '18px 28px',
        flex: 1,
        minHeight: 0,
        alignContent: 'start',
        overflow: 'hidden',
      }}>
        {sorted.map(route => (
          <PortraitRouteFlowBlock key={route.id} route={route} compact={compact} dense={dense} />
        ))}
      </div>
      <PortraitMultiFooterMark routes={sorted} />
    </div>
  );
}

function PortraitRouteFlowBlock({ route, compact, dense }: { route: Route; compact: boolean; dense: boolean }) {
  const stops = [...route.stops].sort((a, b) => a.order - b.order);
  const start = routeStartDate(route);
  const end = routeEndDate(route);
  const days = routeTotalDays(route);
  const dist = Math.round(routeDistance(route));

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          width: 17,
          height: 17,
          borderRadius: '50%',
          background: route.color,
          boxShadow: `0 0 0 4px ${route.color}33`,
          flexShrink: 0,
        }} />
        <div style={{ fontSize: dense ? 21 : compact ? 24 : 29, fontWeight: 700, lineHeight: 1.2 }}>{route.name}</div>
      </div>
      <div style={{ fontSize: dense ? 13 : compact ? 15 : 18, color: '#777', marginTop: dense ? 3 : 6, lineHeight: dense ? 1.32 : 1.45 }}>
        {start && end && (start === end ? start : `${start} → ${end}`)}
        {days > 0 && ` · ${days} 天`}
        {` · ${routeTravelStopCount(route)} 站 · 约 ${dist.toLocaleString()} km`}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: dense ? '4px 7px' : compact ? '5px 8px' : '7px 10px', marginTop: dense ? 5 : 9, alignItems: 'center' }}>
        {stops.map((stop, index) => (
          <StopFlowItem
            key={stop.id}
            stop={stop}
            routeColor={route.color}
            isLast={index === stops.length - 1}
            density={dense ? 'dense' : 'normal'}
          />
        ))}
      </div>
    </div>
  );
}

function PortraitOverview({ routes }: { routes: Route[] }) {
  const visibleRouteIds = new Set(routes.map(r => r.id));
  const totalKm = Math.round(routes.reduce((s, r) => s + routeDistance(r), 0));
  const totalStops = totalTravelStopCount(routes);
  const totalDays = routes.reduce((s, r) => s + routeTotalDays(r), 0);

  return (
    <>
      <PortraitHeader>
        <div style={{ fontSize: 31, color: '#555', marginTop: 28, lineHeight: 1.45 }}>
          累计 <b>{routes.length}</b> 条路线 · <b>{totalStops}</b> 站 · 自驾 <b>{totalDays}</b> 天 · 约 <b>{totalKm.toLocaleString()}</b> km
        </div>
      </PortraitHeader>

      <MapCard label="纯路线" height={600}>
        <MapView
          routes={routes}
          visibleRouteIds={visibleRouteIds}
          showCityNames={false}
          showFlights
          embedded
          forceMapStyle="whitesmoke"
          viewportBounds={PORTRAIT_CHINA_BOUNDS}
          viewportPadding={PORTRAIT_CHINA_ROUTE_PADDING}
          cityLabelSize={17}
          onStopClick={() => {}}
        />
      </MapCard>

      <MapCard label="城市名" height={600}>
        <MapView
          routes={routes}
          visibleRouteIds={visibleRouteIds}
          showCityNames
          showFlights
          embedded
          forceMapStyle="whitesmoke"
          viewportBounds={PORTRAIT_CHINA_BOUNDS}
          viewportPadding={PORTRAIT_CHINA_LABEL_PADDING}
          cityLabelSize={15}
          onStopClick={() => {}}
        />
      </MapCard>

      <OverviewFooter routes={routes} />
    </>
  );
}

function PortraitOverviewSingle({ routes }: { routes: Route[] }) {
  const visibleRouteIds = new Set(routes.map(r => r.id));
  const totalKm = Math.round(routes.reduce((s, r) => s + routeDistance(r), 0));
  const totalStops = totalTravelStopCount(routes);
  const totalDays = routes.reduce((s, r) => s + routeTotalDays(r), 0);

  return (
    <>
      <PortraitHeader>
        <div style={{ fontSize: 31, color: '#555', marginTop: 28, lineHeight: 1.45 }}>
          累计 <b>{routes.length}</b> 条路线 · <b>{totalStops}</b> 站 · 自驾 <b>{totalDays}</b> 天 · 约 <b>{totalKm.toLocaleString()}</b> km
        </div>
      </PortraitHeader>

      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <div style={{ width: 1250, maxWidth: '100%' }}>
          <MapCard label="纯路线" height={1250}>
            <MapView
              routes={routes}
              visibleRouteIds={visibleRouteIds}
              showCityNames={false}
              showFlights
              embedded
              forceMapStyle="whitesmoke"
              viewportBounds={PORTRAIT_CHINA_BOUNDS}
              viewportPadding={PORTRAIT_CHINA_ROUTE_PADDING}
              cityLabelSize={15}
              onStopClick={() => {}}
            />
          </MapCard>
        </div>
      </div>

      <OverviewFooter routes={routes} />
    </>
  );
}

function OverviewFooter({ routes }: { routes: Route[] }) {
  const config = useRuntimeConfig();
  const overviewQrSrc = config?.overviewQrUrl || undefined;
  const sorted = [...routes].sort((a, b) =>
    (routeStartDate(a) ?? '9999').localeCompare(routeStartDate(b) ?? '9999')
  );

  return (
    <div style={{
      flex: 1,
      background: EXPORT_PANEL_BG,
      borderRadius: 16,
      padding: '30px 34px 20px',
      boxShadow: '0 4px 24px rgba(0,0,0,.06)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '16px 30px',
        flex: 1,
        minHeight: 0,
        alignContent: 'start',
        overflow: 'hidden',
      }}>
        {sorted.map(route => {
          const start = routeStartDate(route);
          const end = routeEndDate(route);
          const days = routeTotalDays(route);
          const dist = Math.round(routeDistance(route));
          return (
            <div key={route.id} style={{ display: 'flex', gap: 14, minWidth: 0 }}>
              <span style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: route.color,
                marginTop: 8,
                flexShrink: 0,
                boxShadow: `0 0 0 4px ${route.color}33`,
              }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 26, fontWeight: 650, lineHeight: 1.28 }}>{route.name}</div>
                <div style={{ fontSize: 18, color: '#777', marginTop: 4, lineHeight: 1.4 }}>
                  {start && end && (start === end ? start : `${start} → ${end}`)}
                  {days > 0 && ` · ${days} 天`}
                </div>
                <div style={{ fontSize: 18, color: '#666', marginTop: 2 }}>
                  {routeTravelStopCount(route)} 站 · 约 {dist.toLocaleString()} km
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <PortraitFooterMark qrSrc={overviewQrSrc} qrSize={160} />
    </div>
  );
}

function PortraitRoute({ route, routes }: { route: Route; routes: Route[] }) {
  const visibleRouteIds = new Set([route.id]);
  const stops = [...route.stops].sort((a, b) => a.order - b.order);
  const start = routeStartDate(route);
  const end = routeEndDate(route);
  const days = routeTotalDays(route);
  const dist = Math.round(routeDistance(route));

  return (
    <>
      <PortraitHeader>
        <div style={{
          marginTop: 30,
        }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <span style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: route.color,
              boxShadow: `0 0 0 5px ${route.color}33`,
              flexShrink: 0,
            }} />
            <div style={{ fontSize: 48, fontWeight: 750, lineHeight: 1.16 }}>{route.name}</div>
          </div>
          <div style={{ fontSize: 25, color: '#666', marginTop: 12 }}>
            {start} → {end} · 共 {days} 天 · {routeTravelStopCount(route)} 站 · 自驾约 {dist.toLocaleString()} km
          </div>
        </div>
      </PortraitHeader>

      <MapCard label="纯路线" height={590}>
        <MapView
          routes={routes}
          visibleRouteIds={visibleRouteIds}
          selectedRouteId={null}
          showCityNames={false}
          showFlights
          embedded
          forceMapStyle="whitesmoke"
          viewportBounds={PORTRAIT_CHINA_BOUNDS}
          viewportPadding={PORTRAIT_CHINA_ROUTE_PADDING}
          cityLabelSize={18}
          onStopClick={() => {}}
        />
      </MapCard>

      <MapCard label="路线特写 · 城市细节" height={650}>
        <MapView
          routes={routes}
          visibleRouteIds={visibleRouteIds}
          selectedRouteId={route.id}
          showCityNames
          showFlights
          embedded
          forceMapStyle="fresh"
          cityLabelSize={28}
          onStopClick={() => {}}
        />
      </MapCard>

      <RouteFooter
        stops={stops}
        routeColor={route.color}
        qrSrc={route.qr_code_path ? routeQrUrl(route.id, route.qr_code_path) : undefined}
      />
    </>
  );
}

function RouteFooter({ stops, routeColor, qrSrc }: { stops: Stop[]; routeColor: string; qrSrc?: string }) {
  return (
    <div style={{
      flex: 1,
      background: EXPORT_PANEL_BG,
      borderRadius: 16,
      padding: '30px 34px 20px',
      boxShadow: '0 4px 24px rgba(0,0,0,.06)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 18px', alignContent: 'flex-start', flex: 1 }}>
        {stops.map((stop, idx) => (
          <StopFlowItem
            key={stop.id}
            stop={stop}
            routeColor={routeColor}
            isLast={idx === stops.length - 1}
          />
        ))}
      </div>
      <PortraitFooterMark qrSrc={qrSrc} qrSize={190} />
    </div>
  );
}

function StopFlowItem({
  stop,
  routeColor,
  isLast,
  density = 'normal',
}: {
  stop: Stop;
  routeColor: string;
  isLast: boolean;
  density?: 'normal' | 'dense';
}) {
  const dateLabel = stop.arrival_date && stop.departure_date && stop.arrival_date !== stop.departure_date
    ? `${dayjs(stop.arrival_date).format('M/D')}-${dayjs(stop.departure_date).format('M/D')}`
    : stop.arrival_date ? dayjs(stop.arrival_date).format('M/D') : '';
  const isFlight = stop.transport_mode === 'flight';

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: density === 'dense' ? 8 : 12 }}>
      <div style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: density === 'dense' ? 60 : 76,
      }}>
        <div style={{ fontSize: density === 'dense' ? 22 : 28, fontWeight: 650, lineHeight: density === 'dense' ? 1.18 : 1.25, whiteSpace: 'nowrap' }}>
          {isFlight && <span style={{ marginRight: 6, color: routeColor }}>✈</span>}
          {stop.city_name}
        </div>
        <div style={{ fontSize: density === 'dense' ? 14 : 19, color: '#888', marginTop: density === 'dense' ? 1 : 3, fontVariantNumeric: 'tabular-nums' }}>
          {dateLabel}
        </div>
      </div>
      {!isLast && <span style={{ fontSize: density === 'dense' ? 20 : 26, color: routeColor, opacity: 0.75 }}>→</span>}
    </div>
  );
}
