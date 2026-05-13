import { Switch, Tag, Button, Tooltip, Select, Space, message } from 'antd';
import { PlusOutlined, EditOutlined, StarFilled, StarOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type { Route } from '../types';
import { toggleFavorite } from '../api';
import { warmRouteCache } from '../utils/legCache';
import MapTitleLogo from './MapTitleLogo';
import Attribution from './Attribution';
import { useRuntimeConfig } from '../config';
import { EXPORT_BG, routeTravelStopCount, totalTravelStopCount } from './export/exportShared';
import dayjs from 'dayjs';

type SortKey = 'date' | 'distance' | 'name';

interface RoutePanelProps {
  routes: Route[];
  visibleRouteIds: Set<number>;
  selectedRouteId: number | null;
  onToggle: (id: number) => void;
  onSelect: (id: number | null) => void;
  onAdd: () => void;
  onEdit: (route: Route) => void;
  onOpenTimeline: (routeId: number) => void;
  onRoutesUpdated: () => void;
  showCityNames: boolean;
  onShowCityNamesChange: (v: boolean) => void;
  showFlights: boolean;
  onShowFlightsChange: (v: boolean) => void;
  canEdit?: boolean;
  compact?: boolean;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routeDistance(route: Route): number {
  const stops = [...route.stops].sort((a, b) => a.order - b.order);
  let dist = 0;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].transport_mode === 'flight') continue;
    dist += haversineKm(stops[i - 1].latitude, stops[i - 1].longitude, stops[i].latitude, stops[i].longitude);
  }
  return dist;
}

function routeStartDate(route: Route): string {
  const dates = route.stops.map(s => s.arrival_date).filter(Boolean) as string[];
  return dates.length ? dates.sort()[0] : '9999';
}

function routeTotalDays(route: Route): number {
  const arrivals = route.stops.map(s => s.arrival_date).filter(Boolean) as string[];
  const departures = route.stops.map(s => s.departure_date || s.arrival_date).filter(Boolean) as string[];
  if (!arrivals.length || !departures.length) return 0;
  const start = arrivals.sort()[0];
  const end = departures.sort().slice(-1)[0];
  return dayjs(end).diff(dayjs(start), 'day') + 1;
}

export default function RoutePanel({
  routes, visibleRouteIds, selectedRouteId,
  onToggle, onSelect, onAdd, onEdit, onOpenTimeline, onRoutesUpdated,
  showCityNames, onShowCityNamesChange,
  showFlights, onShowFlightsChange,
  canEdit = true,
  compact = false,
}: RoutePanelProps) {
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [warming, setWarming] = useState(false);
  const [warmProgress, setWarmProgress] = useState<{ done: number; total: number } | null>(null);
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<number, boolean>>({});
  const isFavorite = (route: Route) => favoriteOverrides[route.id] ?? route.is_favorite;

  const handleWarmCache = async () => {
    if (warming) return;
    setWarming(true);
    setWarmProgress({ done: 0, total: 0 });
    try {
      const result = await warmRouteCache(
        routes.map(r => ({ id: r.id, stops: r.stops })),
        (done, total) => setWarmProgress({ done, total }),
      );
      if (result.total === 0) {
        message.success('所有路段已缓存，无需预热');
      } else {
        message.success(`预热完成，缓存了 ${result.fetched} 条路段`);
        onRoutesUpdated();  // refresh so MapView reloads cache
      }
    } catch (e) {
      message.error('预热失败');
      console.error(e);
    } finally {
      setWarming(false);
      setWarmProgress(null);
    }
  };

  const sorted = [...routes].sort((a, b) => {
    const aFavorite = isFavorite(a);
    const bFavorite = isFavorite(b);
    if (aFavorite !== bFavorite) return aFavorite ? -1 : 1;
    if (sortKey === 'date') return routeStartDate(a).localeCompare(routeStartDate(b));
    if (sortKey === 'distance') return routeDistance(b) - routeDistance(a);
    return a.name.localeCompare(b.name, 'zh');
  });

  const handleToggleFavorite = async (e: React.MouseEvent, route: Route) => {
    e.stopPropagation();
    const previous = isFavorite(route);
    setFavoriteOverrides(prev => ({ ...prev, [route.id]: !previous }));
    try {
      const updated = await toggleFavorite(route.id);
      setFavoriteOverrides(prev => ({ ...prev, [route.id]: updated.is_favorite }));
    } catch (error) {
      setFavoriteOverrides(prev => ({ ...prev, [route.id]: previous }));
      message.error('收藏状态保存失败');
    }
  };

  const handleGlobalSwitch = (checked: boolean) => {
    sorted.forEach(r => {
      const isVisible = visibleRouteIds.has(r.id);
      if (checked && !isVisible) onToggle(r.id);
      if (!checked && isVisible) onToggle(r.id);
    });
  };

  const allVisible = sorted.every(r => visibleRouteIds.has(r.id));
  const panelPadX = compact ? 18 : 16;
  const routeTitleSize = compact ? 15 : 13;
  const routeMetaSize = compact ? 13 : 11;
  const sectionTitleSize = compact ? 18 : 15;
  const controlTextSize = compact ? 14 : 12;
  const rowPad = compact ? '9px 18px' : '10px 16px';
  const allRowPad = compact ? '10px 18px' : '8px 16px';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: compact ? '14px 18px 10px' : '14px 16px 8px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
        {!compact && <div style={{ marginBottom: 10 }}>
          <MapTitleLogo height={124} />
        </div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: sectionTitleSize }}>我的线路</span>
          {canEdit && <Button type="primary" icon={<PlusOutlined />} size={compact ? 'middle' : 'small'} onClick={onAdd}>新增</Button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space size={6}>
            <span style={{ fontSize: controlTextSize, color: '#78837d' }}>排序：</span>
            <Select
              size={compact ? 'middle' : 'small'}
              value={sortKey}
              onChange={setSortKey}
              style={{ width: compact ? 118 : 96 }}
              options={[
                { value: 'date', label: '出发时间' },
                { value: 'distance', label: '总距离' },
                { value: 'name', label: '名称' },
              ]}
            />
          </Space>
          <Tooltip title={allVisible ? '一键关闭所有线路' : '一键显示所有线路'}>
            <Switch
              size="small"
              checked={allVisible}
              onChange={handleGlobalSwitch}
              checkedChildren="全部"
              unCheckedChildren="全部"
            />
          </Tooltip>
        </div>
        <div style={{ display: 'flex', gap: compact ? 18 : 16, alignItems: 'center', marginTop: compact ? 10 : 8, fontSize: controlTextSize, color: '#59635d' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <Switch
              size="small"
              checked={showCityNames}
              onChange={onShowCityNamesChange}
            />
            <span>城市名</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <Switch
              size="small"
              checked={showFlights}
              onChange={onShowFlightsChange}
            />
            <span>飞行线</span>
          </label>
        </div>
        {canEdit && <div style={{ marginTop: 8 }}>
          <Tooltip title="一次性把所有路线的路网贴合结果计算并存入数据库。完成后所有设备打开都即时显示路网线，无需再调高德 API。">
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              loading={warming}
              onClick={handleWarmCache}
              style={{ fontSize: compact ? 14 : 12, height: compact ? 34 : undefined }}
              block
            >
              {warming
                ? warmProgress && warmProgress.total > 0
                  ? `预热中 ${warmProgress.done}/${warmProgress.total}`
                  : '准备中…'
                : '预热路网缓存'}
            </Button>
          </Tooltip>
        </div>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* All-routes option + cumulative totals across every route */}
        {(() => {
          const totalKm = Math.round(routes.reduce((s, r) => s + routeDistance(r), 0));
          const totalStops = totalTravelStopCount(routes);
          const totalDays = routes.reduce((s, r) => s + routeTotalDays(r), 0);
          return (
            <div
              onClick={() => onSelect(null)}
              style={{
                padding: allRowPad,
                cursor: 'pointer',
                background: selectedRouteId === null ? '#e6f4ff' : 'transparent',
                borderLeft: selectedRouteId === null ? '3px solid #1677ff' : '3px solid transparent',
              }}
            >
              <div style={{ fontSize: routeTitleSize, color: selectedRouteId === null ? '#1677ff' : '#445048', fontWeight: 650 }}>
                全部线路叠加
              </div>
              <div style={{ fontSize: routeMetaSize, color: '#7c8780', marginTop: 3, lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                累计 {routes.length} 条 · {totalStops} 站 · 自驾 {totalDays} 天 · 约 {totalKm.toLocaleString()} km
              </div>
            </div>
          );
        })()}

        {/* Route list */}
        {sorted.map(route => {
          const dist = Math.round(routeDistance(route));
          const startDate = routeStartDate(route);
          const days = routeTotalDays(route);
          const favorite = isFavorite(route);
          return (
            <div
              key={route.id}
              style={{
                padding: rowPad,
                cursor: 'pointer',
                background: selectedRouteId === route.id ? '#e6f4ff' : 'transparent',
                borderLeft: selectedRouteId === route.id ? `3px solid ${route.color}` : '3px solid transparent',
                display: 'flex', alignItems: 'center', gap: compact ? 10 : 8,
                transition: 'background .15s',
              }}
            >
              <Switch
                checked={visibleRouteIds.has(route.id)}
                onChange={() => onToggle(route.id)}
                style={{ background: visibleRouteIds.has(route.id) ? route.color : undefined, flexShrink: 0 }}
                size="small"
              />
              <div
                style={{ flex: 1, minWidth: 0 }}
                onClick={() => onSelect(selectedRouteId === route.id ? null : route.id)}
              >
                <div style={{ fontWeight: 650, fontSize: routeTitleSize, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#26332c' }}>
                  {route.name}
                </div>
                <div style={{
                  fontSize: routeMetaSize,
                  color: '#7c8780',
                  marginTop: 3,
                  lineHeight: 1.55,
                  whiteSpace: compact ? 'normal' : undefined,
                  overflow: compact ? 'visible' : undefined,
                  textOverflow: compact ? undefined : undefined,
                }}>
                  {route.year && <Tag color={route.color} style={{ fontSize: compact ? 12 : 10, padding: compact ? '0 5px' : '0 4px', margin: '0 4px 0 0' }}>{route.year}</Tag>}
                  {startDate !== '9999' && <span>{startDate} 出发</span>}
                  {startDate !== '9999' && days > 0 && <span> · </span>}
                  {days > 0 && <span>{days} 天</span>}
                  {(startDate !== '9999' || days > 0) && <span> · </span>}
                  <span>{routeTravelStopCount(route)} 站</span>
                  {dist > 0 && <span style={{ display: 'inline-block', whiteSpace: 'nowrap' }}> · 约 {dist} km</span>}
                </div>
              </div>
              {canEdit && (
                <>
                  <Tooltip title={favorite ? '取消收藏' : '收藏'}>
                    <Button
                      type="text"
                      icon={favorite ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined style={{ color: '#ccc' }} />}
                      size="small"
                      onClick={e => handleToggleFavorite(e, route)}
                      style={{ padding: 0, width: compact ? 30 : 24, minWidth: compact ? 30 : 24, height: compact ? 30 : undefined, fontSize: compact ? 17 : undefined }}
                    />
                  </Tooltip>
                  <Tooltip title="编辑线路">
                    <Button
                      type="text"
                      icon={<EditOutlined />}
                      size="small"
                      onClick={e => { e.stopPropagation(); onEdit(route); }}
                      style={{ padding: 0, width: compact ? 30 : 24, minWidth: compact ? 30 : 24, height: compact ? 30 : undefined, fontSize: compact ? 17 : undefined }}
                    />
                  </Tooltip>
                </>
              )}
            </div>
          );
        })}
      </div>

      {(!compact || selectedRouteId !== null) && <div style={{
        flexShrink: 0,
        borderTop: '1px solid #f0f0f0',
        padding: `10px ${panelPadX}px 12px`,
        background: '#fff',
      }}>
        {selectedRouteId !== null && (
          <Button
            type="link"
            onClick={() => onOpenTimeline(selectedRouteId)}
            style={{ padding: 0, height: 'auto', fontSize: compact ? 14 : 12, marginBottom: 10 }}
          >
            查看详细时间轴
          </Button>
        )}
        {!compact && <SidebarSignature />}
      </div>}
    </div>
  );
}

function SidebarSignature() {
  const config = useRuntimeConfig();
  const profileLines = config?.ownerProfileLines ?? [];
  const github = config?.ownerGithub ?? '';
  const email = config?.ownerEmail ?? '';
  const wechat = config?.ownerWechat ?? '';
  const platforms = config?.ownerPlatforms ?? '';

  return (
    <div style={{
      background: EXPORT_BG,
      border: '1px solid #f2dfe4',
      borderRadius: 8,
      padding: '8px 10px',
      fontSize: 10,
      lineHeight: 1.55,
      color: '#7b837d',
      wordBreak: 'break-word',
      boxShadow: '0 1px 4px rgba(160, 90, 110, .08)',
    }}>
      <Attribution />
      {profileLines.map((line, i) => (
        <div key={i} style={{ marginTop: i === 0 ? 5 : 0 }}>{line}</div>
      ))}
      {github && (
        <div style={{ marginTop: profileLines.length > 0 ? 6 : 5 }}>
          GitHub：<a
            href={`https://github.com/${github}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#2f6f4f', fontWeight: 600 }}
          >
            {github}
          </a>
        </div>
      )}
      {email && <div>📮 {email}</div>}
      {wechat && <div>WeChat：{wechat}</div>}
      {platforms && <div>全平台：{platforms}</div>}
    </div>
  );
}
