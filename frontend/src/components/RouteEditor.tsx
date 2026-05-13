import {
  Drawer, Form, Input, InputNumber, ColorPicker, Button, Space,
  AutoComplete, Popconfirm, Upload, message, Divider, Tooltip, DatePicker, Segmented
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined, UploadOutlined
} from '@ant-design/icons';
import { useState, useEffect, Fragment } from 'react';
import dayjs from 'dayjs';
import type { Route, Stop } from '../types';
import {
  createRoute, updateRoute, deleteRoute, createStop, updateStop, deleteStop, importGpx,
  uploadRouteQr, deleteRouteQr, routeQrUrl,
} from '../api';
import { searchCityAMap } from '../utils/geocode';

interface RouteEditorProps {
  route: Route | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  mobile?: boolean;
}

// Saturated-distinct palette tuned for ~0.6 alpha rendering. Hues spread
// around the wheel; first few entries are maximally separated so sequential
// picks for new routes stay distinguishable as long as possible.
const PRESET_COLORS = [
  '#D32F2F', // red
  '#1976D2', // blue
  '#2E7D32', // green
  '#F57C00', // orange
  '#6A1B9A', // purple
  '#00796B', // teal
  '#C2185B', // magenta
  '#303F9F', // indigo
  '#5D4037', // brown
  '#689F38', // olive
];

interface StopDraft extends Partial<Stop> {
  _searchOptions?: { value: string; label: string; lng: number; lat: number; district: string }[];
}

export default function RouteEditor({ route, open, onClose, onSaved, mobile = false }: RouteEditorProps) {
  const [form] = Form.useForm();
  const [stops, setStops] = useState<StopDraft[]>([]);
  const [originalStopIds, setOriginalStopIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [qrPath, setQrPath] = useState('');
  const isEdit = !!route;

  useEffect(() => {
    if (open) {
      if (route) {
        form.setFieldsValue({
          name: route.name, year: route.year,
          color: route.color, description: route.description,
        });
        const sorted = [...route.stops].sort((a, b) => a.order - b.order);
        setStops(sorted);
        setOriginalStopIds(new Set(sorted.map(s => s.id).filter((id): id is number => typeof id === 'number')));
        setQrPath(route.qr_code_path || '');
      } else {
        form.resetFields();
        form.setFieldValue('color', PRESET_COLORS[0]);
        setStops([]);
        setOriginalStopIds(new Set());
        setQrPath('');
      }
    }
  }, [open, route]);

  const handleCitySearch = async (keyword: string, idx: number) => {
    if (keyword.length < 1) return;
    const results = await searchCityAMap(keyword);
    const options = results.map(r => ({
      value: r.name,
      label: r.district ? `${r.name}（${r.district}）` : r.name,
      lng: r.lng,
      lat: r.lat,
      district: r.district,
    }));
    setStops(prev => {
      const updated = [...prev];
      if (!updated[idx]) return prev;
      updated[idx] = { ...updated[idx], _searchOptions: options };
      return updated;
    });
  };

  const handleCitySelect = (_: string, option: any, idx: number) => {
    setStops(prev => {
      const updated = [...prev];
      if (!updated[idx]) return prev;
      updated[idx] = { ...updated[idx], city_name: option.value, longitude: option.lng, latitude: option.lat, _searchOptions: [] };
      return updated;
    });
  };

  const updateStopField = (idx: number, field: string, value: any) => {
    setStops(prev => {
      const updated = [...prev];
      if (!updated[idx]) return prev;
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const addStop = () => setStops([...stops, { city_name: '', longitude: 0, latitude: 0, order: stops.length }]);
  const removeStop = (idx: number) => setStops(stops.filter((_, i) => i !== idx));
  const moveStop = (idx: number, dir: -1 | 1) => {
    const arr = [...stops];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    setStops(arr);
  };

  // Interpolate a sensible default date for a stop inserted between two
  // existing stops. Adjacent dates (≤1 day apart) use the previous stop's
  // date; multi-day gaps use the midpoint. Falls back to whichever neighbour
  // has a date, or null if neither does.
  const interpolateDate = (prev?: StopDraft, next?: StopDraft): string | null => {
    const prevDate = prev?.departure_date || prev?.arrival_date || null;
    const nextDate = next?.arrival_date || next?.departure_date || null;
    if (prevDate && nextDate) {
      const a = dayjs(prevDate);
      const b = dayjs(nextDate);
      const days = b.diff(a, 'day');
      if (days <= 1) return prevDate;
      return a.add(Math.floor(days / 2), 'day').format('YYYY-MM-DD');
    }
    return prevDate ?? nextDate;
  };

  // Insert a new blank stop at position `idx` (before current stop at idx).
  // idx === stops.length appends.
  const insertStopAt = (idx: number) => {
    setStops(prev => {
      const prevStop = idx > 0 ? prev[idx - 1] : undefined;
      const nextStop = idx < prev.length ? prev[idx] : undefined;
      const date = interpolateDate(prevStop, nextStop);
      const newStop: StopDraft = {
        city_name: '', longitude: 0, latitude: 0,
        arrival_date: date, departure_date: date,
        order: idx,
      };
      return [...prev.slice(0, idx), newStop, ...prev.slice(idx)];
    });
  };

  const hasInvalidCoords = stops.some(s => s.city_name && (s.longitude === 0 && s.latitude === 0));

  const handleSave = async () => {
    const values = await form.validateFields();
    if (hasInvalidCoords) {
      message.error('有城市坐标未识别，请从下拉列表中选择城市');
      return;
    }
    // Normalize color value (ColorPicker returns object or string)
    if (values.color && typeof values.color === 'object' && values.color.toHexString) {
      values.color = values.color.toHexString();
    }
    setSaving(true);
    try {
      let savedRoute: Route;
      if (isEdit && route) {
        savedRoute = await updateRoute(route.id, values);
      } else {
        savedRoute = await createRoute(values);
      }
      const currentStopIds = new Set(
        stops.map(s => s.id).filter((id): id is number => typeof id === 'number')
      );
      const removedStopIds = [...originalStopIds].filter(id => !currentStopIds.has(id));
      for (const id of removedStopIds) {
        await deleteStop(id);
      }
      for (let i = 0; i < stops.length; i++) {
        // Explicitly preserve every backend-side field so an unset value here
        // can't silently fall back to the StopCreate default on save (this is
        // how transport_mode='flight' got nuked to 'drive' previously).
        const src = stops[i];
        const s: any = {
          city_name: src.city_name ?? '',
          longitude: src.longitude ?? 0,
          latitude: src.latitude ?? 0,
          arrival_date: src.arrival_date ?? null,
          departure_date: src.departure_date ?? null,
          lodging: src.lodging ?? '',
          food: src.food ?? '',
          attractions: src.attractions ?? '',
          other: src.other ?? '',
          videos: src.videos ?? '',
          articles: src.articles ?? '',
          transport_mode: src.transport_mode ?? 'drive',
          order: i,
        };
        if (src.id) {
          await updateStop(src.id, s);
        } else if (src.city_name) {
          await createStop(savedRoute.id, s);
        }
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!route) return;
    await deleteRoute(route.id);
    onSaved();
    onClose();
  };

  const handleGpxImport = async (file: File) => {
    if (!route) { message.warning('请先保存线路基本信息后再导入 GPX'); return false; }
    const newStops = await importGpx(route.id, file);
    setStops(prev => [...prev, ...newStops]);
    message.success(`已导入 ${newStops.length} 个节点`);
    return false;
  };

  const handleQrUpload = async (file: File) => {
    if (!route) { message.warning('请先保存线路基本信息后再上传二维码'); return false; }
    const updated = await uploadRouteQr(route.id, file);
    setQrPath(updated.qr_code_path || '');
    message.success('二维码已上传');
    return false;
  };

  const handleQrDelete = async () => {
    if (!route) return;
    const updated = await deleteRouteQr(route.id);
    setQrPath(updated.qr_code_path || '');
    message.success('二维码已删除');
  };

  return (
    <Drawer
      title={isEdit ? `编辑线路：${route?.name}` : '新增线路'}
      open={open}
      onClose={onClose}
      size={mobile ? undefined : 'large'}
      placement={mobile ? 'bottom' : 'right'}
      height={mobile ? '90dvh' : undefined}
      extra={
        <Space>
          {isEdit && (
            <Popconfirm title="确定删除这条线路？" onConfirm={handleDelete}>
              <Button danger size="small">删除</Button>
            </Popconfirm>
          )}
          <Button type="primary" size="small" loading={saving} onClick={handleSave}>保存</Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" size="small">
        <Form.Item name="name" label="线路名称" rules={[{ required: true }]}>
          <Input placeholder="如：青甘环线" />
        </Form.Item>
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item name="year" label="年份" style={{ width: 120 }}>
            <InputNumber placeholder="2024" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="color" label="颜色" style={{ flex: 1 }}>
            <ColorPicker presets={[{ label: '推荐', colors: PRESET_COLORS }]} format="hex" style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item name="description" label="简介（可选）">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>

      <Divider style={{ margin: '12px 0' }}>线路二维码</Divider>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        {isEdit && route && qrPath ? (
          <img
            src={routeQrUrl(route.id, qrPath)}
            alt="线路二维码"
            style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, border: '1px solid #eee' }}
          />
        ) : (
          <div style={{
            width: 96, height: 96, borderRadius: 8, border: '1px dashed #d9d9d9',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#aaa', fontSize: 12, background: '#fafafa',
          }}>
            未上传
          </div>
        )}
        <Space direction="vertical" size={6}>
          <Upload showUploadList={false} beforeUpload={handleQrUpload} accept=".png,.jpg,.jpeg,.webp,image/*" disabled={!isEdit}>
            <Button size="small" icon={<UploadOutlined />} disabled={!isEdit}>上传二维码</Button>
          </Upload>
          {isEdit && qrPath && (
            <Popconfirm title="删除这张二维码？" onConfirm={handleQrDelete}>
              <Button size="small" danger>删除二维码</Button>
            </Popconfirm>
          )}
          {!isEdit && <span style={{ color: '#999', fontSize: 12 }}>保存线路后可上传二维码</span>}
        </Space>
      </div>

      <Divider style={{ margin: '12px 0' }}>途经城市</Divider>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Button size="small" icon={<PlusOutlined />} onClick={addStop}>添加城市</Button>
        {isEdit && (
          <Upload showUploadList={false} beforeUpload={handleGpxImport} accept=".gpx,.kml">
            <Button size="small" icon={<UploadOutlined />}>导入 GPX/KML</Button>
          </Upload>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {stops.map((stop, idx) => {
          const coordsOk = !stop.city_name || (stop.longitude !== 0 || stop.latitude !== 0);
          return (
            <Fragment key={idx}>
              <InsertHere onClick={() => insertStopAt(idx)} />
              <div style={{ border: `1px solid ${coordsOk ? '#f0f0f0' : '#faad14'}`, borderRadius: 6, padding: '8px 10px', background: coordsOk ? '#fafafa' : '#fffbe6' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: '#999', fontSize: 11, minWidth: 18 }}>{idx + 1}</span>
                <AutoComplete
                  style={{ flex: 1 }}
                  size="small"
                  value={stop.city_name}
                  options={stop._searchOptions || []}
                  onSearch={v => handleCitySearch(v, idx)}
                  onSelect={(v, opt) => handleCitySelect(v, opt, idx)}
                  onChange={v => updateStopField(idx, 'city_name', v)}
                  placeholder="输入城市名搜索…"
                  status={!coordsOk ? 'warning' : undefined}
                  filterOption={false}
                />
                <Tooltip title="上移"><Button size="small" icon={<ArrowUpOutlined />} onClick={() => moveStop(idx, -1)} /></Tooltip>
                <Tooltip title="下移"><Button size="small" icon={<ArrowDownOutlined />} onClick={() => moveStop(idx, 1)} /></Tooltip>
                <Popconfirm title="删除此站？" onConfirm={() => removeStop(idx)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </div>
              <div style={{ display: 'flex', gap: 6, paddingLeft: 24, alignItems: 'center' }}>
                <DatePicker
                  size="small"
                  placeholder="抵达日期"
                  style={{ flex: 1 }}
                  value={stop.arrival_date ? dayjs(stop.arrival_date) : null}
                  onChange={d => updateStopField(idx, 'arrival_date', d ? d.format('YYYY-MM-DD') : null)}
                  format="YYYY-MM-DD"
                />
                <DatePicker
                  size="small"
                  placeholder="离开日期"
                  style={{ flex: 1 }}
                  value={stop.departure_date ? dayjs(stop.departure_date) : null}
                  onChange={d => updateStopField(idx, 'departure_date', d ? d.format('YYYY-MM-DD') : null)}
                  format="YYYY-MM-DD"
                />
              </div>
              {idx > 0 && (
                <div style={{ display: 'flex', gap: 6, paddingLeft: 24, marginTop: 6, alignItems: 'center', fontSize: 11, color: '#888' }}>
                  <span style={{ minWidth: 56 }}>到达方式：</span>
                  <Segmented
                    size="small"
                    value={stop.transport_mode || 'drive'}
                    onChange={v => updateStopField(idx, 'transport_mode', v)}
                    options={[
                      { label: '🚗 自驾', value: 'drive' },
                      { label: '✈ 飞行', value: 'flight' },
                    ]}
                  />
                </div>
              )}
              {typeof stop.longitude === 'number' && typeof stop.latitude === 'number' &&
                (stop.longitude !== 0 || stop.latitude !== 0) && (
                <div style={{ paddingLeft: 24, marginTop: 4, fontSize: 10, color: '#aaa' }}>
                  {stop.longitude.toFixed(4)}, {stop.latitude.toFixed(4)}
                </div>
              )}
              </div>
            </Fragment>
          );
        })}
        {stops.length > 0 && <InsertHere onClick={() => insertStopAt(stops.length)} />}
      </div>
    </Drawer>
  );
}

// Thin insertion-point row between stop cards. A dashed divider with a small
// circular + button in the middle; clicking inserts a new blank stop at this
// position (with date interpolated from neighbours).
function InsertHere({ onClick }: { onClick: () => void }) {
  return (
    <div
      style={{
        position: 'relative', height: 22, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        position: 'absolute', left: 8, right: 8, top: 10,
        borderTop: '1px dashed #d9d9d9',
      }} />
      <Tooltip title="在此插入城市（日期会根据前后自动推算）">
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined style={{ fontSize: 10 }} />}
          onClick={onClick}
          style={{
            position: 'relative', zIndex: 1,
            width: 20, height: 20, minWidth: 20, padding: 0,
            borderRadius: '50%', background: '#fff',
            border: '1px solid #d9d9d9', color: '#999',
          }}
        />
      </Tooltip>
    </div>
  );
}
