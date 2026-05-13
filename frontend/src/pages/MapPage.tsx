import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Spin, Button, Tooltip, Modal, Drawer } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined, CameraOutlined, UnorderedListOutlined } from '@ant-design/icons';
import MapView from '../components/MapView';
import RoutePanel from '../components/RoutePanel';
import StopCard from '../components/StopCard';
import RouteEditor from '../components/RouteEditor';
import mapTitleLogo from '../assets/map-title.png';
import { getRoutes } from '../api';
import type { Route, Stop } from '../types';
import { hasEditAccess } from '../auth';
import { useRuntimeConfig } from '../config';
import Attribution from '../components/Attribution';

const { Sider, Content } = Layout;
const MOBILE_QUERY = '(max-width: 768px)';
const MOBILE_TITLE_H = 108;
const VISIBLE_ROUTES_STORAGE_KEY = 'travel-map:visibleRouteIds';

type StopChoice = {
  stop: Stop;
  route: Route;
  index: number;
};

type SavedVisibleRoutes = {
  version?: number;
  visibleIds: string[];
  knownIds: string[];
};

function routeStorageKey(id: Route['id']) {
  return String(id);
}

function readSavedVisibleRoutes(routes: Route[]): Set<number> | null {
  const raw = localStorage.getItem(VISIBLE_ROUTES_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as SavedVisibleRoutes | number[];
    const rawVisibleIds = Array.isArray(parsed) ? parsed : parsed.visibleIds;
    if (!Array.isArray(rawVisibleIds)) return null;
    const visibleKeys = rawVisibleIds.map(String);
    const rawKnownIds = Array.isArray(parsed) ? rawVisibleIds : parsed.knownIds;
    const knownKeys = Array.isArray(rawKnownIds)
      ? rawKnownIds.map(String)
      : visibleKeys;
    if (Array.isArray(parsed) && visibleKeys.length === 0) return null;
    if (!Array.isArray(parsed) && parsed.version !== 4 && visibleKeys.length === 0) return null;

    const keyToId = new Map(routes.map(route => [routeStorageKey(route.id), route.id]));
    const next = new Set<number>();
    visibleKeys.forEach(key => {
      const id = keyToId.get(key);
      if (typeof id === 'number') next.add(id);
    });
    const known = new Set(knownKeys);
    routes.forEach(route => {
      if (!known.has(routeStorageKey(route.id))) next.add(route.id);
    });
    return next;
  } catch {
    return null;
  }
}

function saveVisibleRoutes(visibleRouteIds: Set<number>, routes: Route[]) {
  const knownIds = routes.map(route => routeStorageKey(route.id));
  const visibleKeys = new Set([...visibleRouteIds].map(String));
  const payload: SavedVisibleRoutes = {
    version: 4,
    visibleIds: knownIds.filter(id => visibleKeys.has(id)),
    knownIds,
  };
  localStorage.setItem(VISIBLE_ROUTES_STORAGE_KEY, JSON.stringify(payload));
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false
  );

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const handleChange = () => setIsMobile(media.matches);
    handleChange();
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
}

export default function MapPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const runtimeConfig = useRuntimeConfig();
  const titleImageSrc = runtimeConfig?.titleImageUrl || mapTitleLogo;
  const siteTitle = runtimeConfig?.siteTitle || 'Road Trip Partner';
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleRouteIds, setVisibleRouteIds] = useState<Set<number>>(new Set());
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [selectedStopRoute, setSelectedStopRoute] = useState<Route | null>(null);
  const [stopCardOpen, setStopCardOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [stopChoices, setStopChoices] = useState<StopChoice[]>([]);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [routeDrawerOpen, setRouteDrawerOpen] = useState(false);
  const [showCityNames, setShowCityNames] = useState(() => localStorage.getItem('travel-map:showCityNames') !== 'false');
  const [showFlights, setShowFlights] = useState(() => localStorage.getItem('travel-map:showFlights') !== 'false');
  const [canEdit] = useState(() => hasEditAccess());
  const hasLoadedRoutesRef = useRef(false);
  const canPersistVisibleRoutesRef = useRef(false);
  const visibleRouteIdsChangedByUserRef = useRef(false);
  const knownRouteIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => { localStorage.setItem('travel-map:showCityNames', String(showCityNames)); }, [showCityNames]);
  useEffect(() => { localStorage.setItem('travel-map:showFlights', String(showFlights)); }, [showFlights]);
  useEffect(() => {
    if (!canPersistVisibleRoutesRef.current || !visibleRouteIdsChangedByUserRef.current || routes.length === 0) return;
    saveVisibleRoutes(visibleRouteIds, routes);
  }, [routes, visibleRouteIds]);

  const loadRoutes = useCallback(async () => {
    const isInitialLoad = !hasLoadedRoutesRef.current;
    const data = await getRoutes();
    setRoutes(data);
    const routeIds = new Set(data.map(r => r.id));
    setVisibleRouteIds(prev => {
      if (isInitialLoad) return readSavedVisibleRoutes(data) ?? routeIds;
      const next = new Set([...prev].filter(id => routeIds.has(id)));
      routeIds.forEach(id => {
        if (!knownRouteIdsRef.current.has(id)) next.add(id);
      });
      return next;
    });
    knownRouteIdsRef.current = routeIds;
    hasLoadedRoutesRef.current = true;
    canPersistVisibleRoutesRef.current = true;
    setLoading(false);
  }, []);

  useEffect(() => { loadRoutes(); }, [loadRoutes]);

  const handleToggle = (id: number) => {
    visibleRouteIdsChangedByUserRef.current = true;
    setVisibleRouteIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openStopCard = useCallback((stop: Stop, route: Route) => {
    setSelectedStop(stop);
    setSelectedStopRoute(route);
    setStopCardOpen(true);
  }, []);

  const handleStopClick = useCallback((stop: Stop, route: Route) => {
    const cityName = stop.city_name.trim();
    const sourceRoutes = selectedRouteId !== null
      ? routes.filter(r => r.id === selectedRouteId)
      : routes.filter(r => visibleRouteIds.has(r.id));
    const choices = sourceRoutes.flatMap(r =>
      [...r.stops]
        .sort((a, b) => a.order - b.order)
        .map((candidate, index) => ({ stop: candidate, route: r, index }))
        .filter(choice => choice.stop.city_name.trim() === cityName)
    );

    if (choices.length > 1) {
      setStopChoices(choices);
      return;
    }
    openStopCard(stop, route);
  }, [openStopCard, routes, selectedRouteId, visibleRouteIds]);

  const handleStopChoice = useCallback((choice: StopChoice) => {
    setStopChoices([]);
    openStopCard(choice.stop, choice.route);
  }, [openStopCard]);

  const handleStopUpdated = () => {
    loadRoutes();
    setStopCardOpen(false);
  };

  const handleStopNavigate = useCallback((stop: Stop) => {
    // Find which route this stop belongs to
    const route = routes.find(r => r.stops.some(s => s.id === stop.id));
    if (route) {
      // Get the latest stop data from current routes state
      const freshStop = route.stops.find(s => s.id === stop.id) ?? stop;
      setSelectedStop(freshStop);
      setSelectedStopRoute(route);
    }
  }, [routes]);

  const handleAddRoute = () => {
    setEditingRoute(null);
    setEditorOpen(true);
  };

  const handleEditRoute = (route: Route) => {
    setEditingRoute(route);
    setEditorOpen(true);
  };

  const displayedRoutes = selectedRouteId !== null
    ? routes.filter(r => r.id === selectedRouteId)
    : routes;
  const selectedRoute = selectedRouteId !== null
    ? routes.find(route => route.id === selectedRouteId) ?? null
    : null;

  const routePanel = (
    <RoutePanel
      routes={routes}
      visibleRouteIds={visibleRouteIds}
      selectedRouteId={selectedRouteId}
      onToggle={handleToggle}
      onSelect={(id) => {
        setSelectedRouteId(id);
        if (isMobile) setRouteDrawerOpen(false);
      }}
      onAdd={handleAddRoute}
      onEdit={(route) => {
        handleEditRoute(route);
        if (isMobile) setRouteDrawerOpen(false);
      }}
      onOpenTimeline={(routeId) => navigate(`/route/${routeId}`)}
      onRoutesUpdated={loadRoutes}
      showCityNames={showCityNames}
      onShowCityNamesChange={setShowCityNames}
      showFlights={showFlights}
      onShowFlightsChange={setShowFlights}
      canEdit={canEdit}
      compact={isMobile}
    />
  );

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <Spin size="large" />
    </div>
  );

  return (
    <Layout style={{ height: isMobile ? '100dvh' : '100vh' }}>
      {!isMobile && (
        <Sider
          width={320}
          collapsed={siderCollapsed}
          collapsedWidth={0}
          style={{ background: '#fff', borderRight: '1px solid #f0f0f0', overflow: 'hidden' }}
          trigger={null}
        >
          {routePanel}
        </Sider>
      )}

      <Content style={{
        position: 'relative',
        height: isMobile ? '100dvh' : undefined,
        paddingTop: isMobile ? MOBILE_TITLE_H : 0,
        overflow: 'hidden',
      }}>
        {isMobile && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: MOBILE_TITLE_H,
            zIndex: 120,
            background: 'rgba(255,255,255,.94)',
            boxShadow: '0 1px 8px rgba(0,0,0,.08)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px 4px 12px',
            boxSizing: 'border-box',
          }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', transform: 'translateY(4px)' }}>
              {titleImageSrc ? (
                <img
                  src={titleImageSrc}
                  alt={siteTitle}
                  style={{
                    display: 'block',
                    width: '100%',
                    maxHeight: 96,
                    objectFit: 'contain',
                    objectPosition: 'left center',
                  }}
                />
              ) : (
                <div style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#2f3c34',
                  lineHeight: 1.15,
                }}>
                  {siteTitle}
                </div>
              )}
            </div>
            <div style={{
              width: 142,
              flexShrink: 0,
              background: '#fbf1f3',
              border: '1px solid #f2dfe4',
              borderRadius: 8,
              padding: '8px 9px',
              boxSizing: 'border-box',
              fontSize: 11,
              lineHeight: 1.45,
              color: '#6f7973',
              boxShadow: '0 1px 4px rgba(160, 90, 110, .08)',
              transform: 'translateY(4px)',
            }}>
              <Attribution />
              {runtimeConfig?.ownerGithub && (
                <div style={{ marginTop: 3 }}>
                  GitHub：<a
                    href={`https://github.com/${runtimeConfig.ownerGithub}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#2f6f4f', fontWeight: 700 }}
                  >
                    {runtimeConfig.ownerGithub}
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {!isMobile && <Tooltip title={siderCollapsed ? '展开面板' : '收起面板'}>
          <Button
            type="default"
            icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setSiderCollapsed(!siderCollapsed)}
            style={{
              position: 'absolute',
              top: 16,
              left: siderCollapsed ? 16 : 16,
              zIndex: 100,
              background: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,.15)',
            }}
          />
        </Tooltip>}

        {!isMobile && <Tooltip title="打开导出页面，挑选不同尺寸/视角的图片">
          <Button
            icon={<CameraOutlined />}
            onClick={() => window.open('/export', '_blank')}
            style={{
              position: 'absolute', top: 16, right: 16, zIndex: 100,
              width: 156,
              background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,.15)',
            }}
            size="small"
          >
            导出图片
          </Button>
        </Tooltip>}

        {isMobile && (
          <>
            {selectedRoute && (
              <div style={{
                position: 'absolute',
                top: MOBILE_TITLE_H + 10,
                left: 10,
                zIndex: 105,
                maxWidth: 'calc(100% - 188px)',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '7px 10px',
                borderRadius: 8,
                background: 'rgba(255,255,255,.94)',
                border: '1px solid rgba(224, 232, 225, .95)',
                boxShadow: '0 2px 8px rgba(0,0,0,.14)',
                color: '#26332c',
                fontSize: 15,
                fontWeight: 700,
                lineHeight: 1.35,
                pointerEvents: 'none',
              }}>
                <span style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: selectedRoute.color,
                  boxShadow: `0 0 0 3px ${selectedRoute.color}22`,
                  flexShrink: 0,
                }} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedRoute.name}
                </span>
              </div>
            )}
          </>
        )}

        {isMobile && (
          <div style={{
            position: 'absolute',
            left: 14,
            right: 14,
            bottom: 18,
            zIndex: 110,
            display: 'flex',
            gap: 10,
            pointerEvents: 'none',
          }}>
            <Button
              type="primary"
              icon={<UnorderedListOutlined />}
              onClick={() => setRouteDrawerOpen(true)}
              style={{ flex: 1, height: 48, fontSize: 17, fontWeight: 650, boxShadow: '0 2px 10px rgba(0,0,0,.22)', pointerEvents: 'auto' }}
            >
              我的线路
            </Button>
            <Button
              icon={<CameraOutlined />}
              onClick={() => window.open('/export', '_blank')}
              style={{ width: 56, height: 48, fontSize: 17, background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,.18)', pointerEvents: 'auto' }}
            />
          </div>
        )}

        <div style={{ height: isMobile ? `calc(100dvh - ${MOBILE_TITLE_H}px)` : '100%' }}>
          <MapView
            routes={displayedRoutes}
            visibleRouteIds={visibleRouteIds}
            onStopClick={handleStopClick}
            onRouteClick={(id) => setSelectedRouteId(prev => (prev === id ? null : id))}
            selectedRouteId={selectedRouteId}
            showCityNames={showCityNames}
            showFlights={showFlights}
            mobileControls={isMobile}
          />
        </div>
      </Content>

      {isMobile && (
        <Drawer
          title={<span style={{ fontSize: 18, fontWeight: 700 }}>我的线路</span>}
          placement="bottom"
          open={routeDrawerOpen}
          onClose={() => setRouteDrawerOpen(false)}
          height="72dvh"
          styles={{
            header: { padding: '14px 18px' },
            body: { padding: 0, height: '100%' },
          }}
        >
          {routePanel}
        </Drawer>
      )}

      <StopCard
        stop={selectedStop}
        route={selectedStopRoute}
        allStops={selectedStopRoute?.stops ?? []}
        open={stopCardOpen}
        onClose={() => setStopCardOpen(false)}
        onUpdated={handleStopUpdated}
        onNavigate={handleStopNavigate}
        canEdit={canEdit}
        mobile={isMobile}
      />

      <Modal
        open={stopChoices.length > 0}
        title={stopChoices[0] ? `选择「${stopChoices[0].stop.city_name}」的记录` : '选择城市记录'}
        footer={null}
        width={520}
        onCancel={() => setStopChoices([])}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
          {stopChoices.map(choice => {
            const { stop, route, index } = choice;
            const dateText = [stop.arrival_date, stop.departure_date]
              .filter(Boolean)
              .join(' → ');
            return (
              <button
                key={`${route.id}-${stop.id}`}
                type="button"
                onClick={() => handleStopChoice(choice)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: '12px 14px',
                  border: '1px solid #edf0ee',
                  borderRadius: 8,
                  background: '#fff',
                  textAlign: 'left',
                  cursor: 'pointer',
                  boxShadow: '0 1px 4px rgba(0,0,0,.04)',
                }}
              >
                <span style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: route.color,
                  boxShadow: `0 0 0 4px ${route.color}22`,
                  flexShrink: 0,
                }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 650, color: '#26332c' }}>
                    {route.name}
                  </span>
                  <span style={{ display: 'block', marginTop: 3, fontSize: 12, color: '#7c8780' }}>
                    第 {index + 1} 站{dateText ? ` · ${dateText}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Modal>

      {canEdit && (
        <RouteEditor
          route={editingRoute}
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          onSaved={loadRoutes}
          mobile={isMobile}
        />
      )}
    </Layout>
  );
}
