import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Spin } from 'antd';
import MapView from '../../components/MapView';
import CustomRoutesSidebar, { CUSTOM_ROUTE_TWO_COL_THRESHOLD } from '../../components/export/CustomRoutesSidebar';
import OverviewSidebar from '../../components/export/OverviewSidebar';
import PortraitExport from '../../components/export/PortraitExport';
import RouteSidebar from '../../components/export/RouteSidebar';
import MapSignature from '../../components/export/MapSignature';
import {
  EXPORT_BG, EXPORT_H, SIDEBAR_W, PAGE_PAD, GAP, CHINA_BOUNDS, routeCollectionBounds,
} from '../../components/export/exportShared';
import { OVERVIEW_TWO_COL_THRESHOLD } from '../../components/export/OverviewSidebar';
import { ROUTE_TWO_COL_THRESHOLD } from '../../components/export/RouteSidebar';
import { getRoutes } from '../../api';
import type { Route } from '../../types';

// URL params:
//   type=overview | route          (overview = images 1 & 2; route = 3a/3b)
//   type=custom&ids=1,2,3          (custom subset of routes)
//   orientation=landscape | portrait
//   layout=single                 (portrait overview only: one centered clean map)
//   names=true | false             (city labels on/off; overview/custom)
//   id=<route id>                  (required when type=route)
//   fit=wide | auto                (wide = China-wide; auto = bbox of route)
//   style=whitesmoke | fresh | normal
//
// Examples:
//   /export/render?type=overview&names=true&style=whitesmoke
//   /export/render?type=overview&names=false&style=whitesmoke
//   /export/render?type=route&id=2&fit=wide&style=whitesmoke
//   /export/render?type=route&id=2&fit=auto&style=fresh

export default function ExportRender() {
  const [params] = useSearchParams();
  const type = params.get('type') ?? 'overview';
  const orientation = params.get('orientation') ?? 'landscape';
  const layout = params.get('layout') ?? 'default';
  const showNames = params.get('names') !== 'false';
  const fit = params.get('fit') ?? 'wide';
  const idParam = params.get('id');
  const idsParam = params.get('ids') ?? '';
  const routeId = idParam ? parseInt(idParam, 10) : null;
  const styleParam = (params.get('style') ?? 'whitesmoke') as 'normal' | 'fresh' | 'whitesmoke';

  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRoutes().then(rs => { setRoutes(rs); setLoading(false); });
  }, []);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><Spin size="large" /></div>;
  }

  const customRouteIds = idsParam
    .split(',')
    .map(id => parseInt(id, 10))
    .filter(id => Number.isFinite(id));
  const renderRoutes = type === 'custom' && customRouteIds.length
    ? routes.filter(route => customRouteIds.includes(route.id))
    : routes;

  if (orientation === 'portrait') {
    return (
      <div id="export-canvas" style={{ width: 'fit-content' }}>
        <PortraitExport type={type} routes={renderRoutes} routeId={routeId} layout={layout} />
      </div>
    );
  }

  const visibleRouteIds = type === 'route' && routeId
    ? new Set([routeId])
    : new Set(renderRoutes.map(r => r.id));

  const focusedRoute = routeId ? routes.find(r => r.id === routeId) : null;
  const overviewLike = type === 'overview' || type === 'custom';

  const customBounds = type === 'custom' && fit === 'auto'
    ? routeCollectionBounds(renderRoutes)
    : undefined;
  // Bounds: wide → fixed China bbox; custom auto → selected routes bbox;
  // route auto → undefined (MapView's selected-route auto-fit kicks in).
  const viewportBounds = fit === 'wide' ? CHINA_BOUNDS : customBounds;
  // For auto-fit, mark route as selected so the auto-fit-to-selected effect runs
  const selectedRouteId = fit === 'auto' && routeId ? routeId : null;

  // City label size scales by density:
  // - Overview (all 7 routes' stops on China map) is dense → modest 14px
  // - Per-route China-wide is sparser (one route's ~10-23 stops) → 20px
  // - Per-route auto-fit zoom shows just one route's bbox → biggest 26px
  const cityLabelSize = type === 'custom'
    ? (fit === 'auto' ? 24 : 14)
    : overviewLike ? 14 : (fit === 'auto' ? 26 : 20);

  // Sidebar widens (and image total widens) when content density triggers
  // a 2-column layout: overview with many routes, or per-route with many stops.
  // Map area stays the same — only the left content column grows.
  const overviewWide = overviewLike && renderRoutes.length > OVERVIEW_TWO_COL_THRESHOLD;
  const routeWide = type === 'route' && focusedRoute && focusedRoute.stops.length > ROUTE_TWO_COL_THRESHOLD;
  const customWide = type === 'custom' && renderRoutes.reduce((sum, route) => sum + route.stops.length, 0) > CUSTOM_ROUTE_TWO_COL_THRESHOLD;
  const wide = overviewWide || routeWide || customWide;
  const sidebarW = wide ? 820 : SIDEBAR_W;
  const totalW = wide ? 2860 : 2560;

  // Page background is a very soft warm pink so the export feels less dry than pure white.
  return (
    <div id="export-canvas" style={{
        width: totalW, height: EXPORT_H,
        background: EXPORT_BG,
        display: 'flex', padding: PAGE_PAD, gap: GAP, boxSizing: 'border-box',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Sidebar */}
        <div style={{ width: sidebarW, height: '100%', flexShrink: 0 }}>
          {type === 'custom' ? (
            <CustomRoutesSidebar routes={renderRoutes} />
          ) : overviewLike ? (
            <OverviewSidebar routes={renderRoutes} />
          ) : focusedRoute ? (
            <RouteSidebar route={focusedRoute} />
          ) : (
            <div style={{ padding: 24 }}>未找到路线 id={routeId}</div>
          )}
        </div>

        {/* Map */}
        <div style={{
          flex: 1, height: '100%', borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(0,0,0,.08)', position: 'relative',
        }}>
          <MapSignature />
          <MapView
            routes={renderRoutes}
            visibleRouteIds={visibleRouteIds}
            selectedRouteId={selectedRouteId}
            showCityNames={showNames}
            showFlights={true}
            embedded
            forceMapStyle={styleParam}
            viewportBounds={viewportBounds}
            cityLabelSize={cityLabelSize}
            onStopClick={() => {}}
          />
        </div>
      </div>
  );
}
