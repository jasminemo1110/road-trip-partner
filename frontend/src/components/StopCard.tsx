import { Drawer, Image, Tag, Typography, Button, Upload, Space, Popconfirm, Input, message, DatePicker } from 'antd';
import {
  PlusOutlined, DeleteOutlined, ShareAltOutlined,
  EditOutlined, CheckOutlined, CloseOutlined,
  LeftOutlined, RightOutlined
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import type { Stop, Route, Photo } from '../types';
import { uploadPhoto, deletePhoto, updateStop } from '../api';
import { fetchWikiSummary, wikiSearchUrl, type WikiSummary } from '../utils/wiki';

const { Text } = Typography;

interface StopCardProps {
  stop: Stop | null;
  route: Route | null;
  allStops: Stop[];       // full sorted stop list for prev/next
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
  onNavigate: (stop: Stop) => void;  // jump to another stop
  canEdit?: boolean;
  mobile?: boolean;
}

type StopTextField = 'lodging' | 'food' | 'attractions' | 'other' | 'videos' | 'articles';

const FIELD_META: { key: StopTextField; label: string; placeholder: string; rows: number }[] = [
  { key: 'lodging', label: '住宿', placeholder: '酒店名称、地址、价格、入住体验…', rows: 3 },
  { key: 'food', label: '餐饮', placeholder: '推荐餐厅、招牌菜、人均价格…', rows: 3 },
  { key: 'attractions', label: '景点', placeholder: '游玩了哪些景点、门票、亮点…', rows: 3 },
  { key: 'other', label: '其他', placeholder: '加油站、修车、突发情况、心情…', rows: 3 },
  { key: 'videos', label: '视频链接', placeholder: 'B站 / YouTube / 抖音视频地址，每行一条', rows: 3 },
  { key: 'articles', label: '文章链接', placeholder: '游记、攻略文章 URL，每行一条', rows: 3 },
];

export default function StopCard({ stop, route, allStops, open, onClose, onUpdated, onNavigate, canEdit = true, mobile = false }: StopCardProps) {
  const [uploading, setUploading] = useState(false);
  const [editingField, setEditingField] = useState<StopTextField | null>(null);
  const [fieldValue, setFieldValue] = useState('');
  const [editingDates, setEditingDates] = useState(false);
  const [arrivalValue, setArrivalValue] = useState<string | null>(null);
  const [departureValue, setDepartureValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [wikiSummary, setWikiSummary] = useState<WikiSummary | null>(null);
  const [wikiLoading, setWikiLoading] = useState(false);

  useEffect(() => {
    if (!mobile || !open || !stop) return;
    let cancelled = false;
    setWikiLoading(true);
    setWikiSummary(null);
    fetchWikiSummary(stop.city_name).then(summary => {
      if (cancelled) return;
      setWikiSummary(summary);
      setWikiLoading(false);
    });
    return () => { cancelled = true; };
  }, [mobile, open, stop?.id, stop?.city_name]);

  if (!stop || !route) return null;

  const sortedStops = [...allStops].sort((a, b) => a.order - b.order);
  const currentIdx = sortedStops.findIndex(s => s.id === stop.id);
  const prevStop = currentIdx > 0 ? sortedStops[currentIdx - 1] : null;
  const nextStop = currentIdx < sortedStops.length - 1 ? sortedStops[currentIdx + 1] : null;

  const nights = stop.arrival_date && stop.departure_date
    ? dayjs(stop.departure_date).diff(dayjs(stop.arrival_date), 'day')
    : null;

  const saveField = async (patch: Partial<Stop>) => {
    setSaving(true);
    try {
      await updateStop(stop.id, {
        city_name: stop.city_name, longitude: stop.longitude, latitude: stop.latitude,
        arrival_date: stop.arrival_date ?? undefined,
        departure_date: stop.departure_date ?? undefined,
        lodging: stop.lodging, food: stop.food, attractions: stop.attractions,
        other: stop.other, videos: stop.videos, articles: stop.articles,
        order: stop.order,
        ...patch,
      } as any);
      onUpdated();
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try { await uploadPhoto(stop.id, file); onUpdated(); } finally { setUploading(false); }
    return false;
  };

  const handleDeletePhoto = async (photo: Photo) => { await deletePhoto(photo.id); onUpdated(); };

  const sharePhoto = (photo: Photo) => {
    const url = `${window.location.origin}/api/photos/${photo.id}/file`;
    navigator.clipboard?.writeText(url).then(() => message.success('链接已复制，可粘贴到微信/微博分享'));
  };

  const startEditField = (key: StopTextField) => { setFieldValue(stop[key] || ''); setEditingField(key); };
  const saveCurrentField = async () => {
    if (!editingField) return;
    await saveField({ [editingField]: fieldValue } as Partial<Stop>);
    setEditingField(null);
  };

  const startEditDates = () => {
    setArrivalValue(stop.arrival_date || null);
    setDepartureValue(stop.departure_date || null);
    setEditingDates(true);
  };
  const saveDates = async () => {
    await saveField({ arrival_date: arrivalValue ?? undefined, departure_date: departureValue ?? undefined } as any);
    setEditingDates(false);
  };

  const handleNavigate = (target: Stop) => {
    setEditingField(null);
    setEditingDates(false);
    onNavigate(target);
  };

  const wikiUrl = wikiSummary?.pageUrl || (stop ? wikiSearchUrl(stop.city_name) : '#');

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            size="small"
            type="text"
            icon={<LeftOutlined />}
            disabled={!prevStop}
            onClick={() => prevStop && handleNavigate(prevStop)}
            title={prevStop ? `上一站：${prevStop.city_name}` : '已是第一站'}
          />
          <span style={{ color: route.color, fontSize: 16 }}>●</span>
          <span style={{ fontSize: mobile ? 18 : undefined, fontWeight: mobile ? 700 : undefined }}>{stop.city_name}</span>
          <Button
            size="small"
            type="text"
            icon={<RightOutlined />}
            disabled={!nextStop}
            onClick={() => nextStop && handleNavigate(nextStop)}
            title={nextStop ? `下一站：${nextStop.city_name}` : '已是最后一站'}
          />
          <Tag color={route.color} style={{ fontSize: mobile ? 13 : 11, margin: 0 }}>{route.name}</Tag>
          <span style={{ flex: 1 }} />
        </div>
      }
      open={open}
      onClose={() => { setEditingField(null); setEditingDates(false); onClose(); }}
      size={mobile ? undefined : 'default'}
      placement={mobile ? 'bottom' : 'right'}
      height={mobile ? '82dvh' : undefined}
      styles={mobile ? { body: { fontSize: 15 } } : undefined}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button
            icon={<LeftOutlined />}
            size="small"
            disabled={!prevStop}
            onClick={() => prevStop && handleNavigate(prevStop)}
          >
            {prevStop ? prevStop.city_name : '已是第一站'}
          </Button>
          <span style={{ fontSize: 11, color: '#999', alignSelf: 'center' }}>
            {currentIdx + 1} / {sortedStops.length}
          </span>
          <Button
            size="small"
            disabled={!nextStop}
            onClick={() => nextStop && handleNavigate(nextStop)}
          >
            {nextStop ? nextStop.city_name : '已是最后一站'} <RightOutlined />
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {mobile && (
          <a
            href={wikiUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'stretch',
              padding: 10,
              borderRadius: 10,
              background: '#fff6f8',
              border: '1px solid #f6d6df',
              color: '#2f3632',
              textDecoration: 'none',
            }}
          >
            {wikiSummary?.thumbnailUrl ? (
              <img
                src={wikiSummary.thumbnailUrl}
                alt={wikiSummary.title}
                style={{ width: 88, minWidth: 88, height: 74, objectFit: 'cover', borderRadius: 8 }}
              />
            ) : (
              <div
                style={{
                  width: 88,
                  minWidth: 88,
                  height: 74,
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #f8dce4, #fff)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#b05f79',
                  fontSize: 24,
                  fontWeight: 700,
                }}
              >
                {stop.city_name.slice(0, 1)}
              </div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#24302b' }}>
                {wikiSummary?.title || stop.city_name}
              </div>
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: '#66736d',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {wikiLoading ? '正在读取城市简介...' : (wikiSummary?.extract || '暂时没有找到合适的城市简介，点击继续搜索这个地点。')}
              </div>
            </div>
          </a>
        )}

        {/* 日期 */}
        <div style={{ background: '#fafafa', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text type="secondary" style={{ fontSize: mobile ? 14 : 12 }}>停留时间</Text>
            {canEdit && !editingDates ? (
              <Button type="text" size="small" icon={<EditOutlined />} onClick={startEditDates} style={{ fontSize: 12, height: 22 }}>
                {stop.arrival_date ? '修改' : '添加日期'}
              </Button>
            ) : canEdit && editingDates ? (
              <Space size={4}>
                <Button size="small" icon={<CloseOutlined />} onClick={() => setEditingDates(false)} style={{ height: 22 }} />
                <Button size="small" type="primary" icon={<CheckOutlined />} loading={saving} onClick={saveDates} style={{ height: 22 }}>保存</Button>
              </Space>
            ) : null}
          </div>
          {editingDates ? (
            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              <DatePicker
                size="small"
                placeholder="抵达日期"
                value={arrivalValue ? dayjs(arrivalValue) : null}
                onChange={d => setArrivalValue(d ? d.format('YYYY-MM-DD') : null)}
                format="YYYY-MM-DD"
                style={{ width: '100%' }}
              />
              <DatePicker
                size="small"
                placeholder="离开日期"
                value={departureValue ? dayjs(departureValue) : null}
                onChange={d => setDepartureValue(d ? d.format('YYYY-MM-DD') : null)}
                format="YYYY-MM-DD"
                style={{ width: '100%' }}
              />
            </div>
          ) : (
            <>
              {stop.arrival_date && <div style={{ marginBottom: 2 }}><Text type="secondary" style={{ fontSize: mobile ? 14 : 12 }}>抵达：</Text><Text style={{ fontSize: mobile ? 15 : 13 }}>{stop.arrival_date}</Text></div>}
              {stop.departure_date && <div style={{ marginBottom: 2 }}><Text type="secondary" style={{ fontSize: mobile ? 14 : 12 }}>离开：</Text><Text style={{ fontSize: mobile ? 15 : 13 }}>{stop.departure_date}</Text></div>}
              {nights !== null && nights > 0 && <div><Text type="secondary" style={{ fontSize: mobile ? 14 : 12 }}>停留：</Text><Text style={{ fontSize: mobile ? 15 : 13 }}>{nights} 晚</Text></div>}
              {!stop.arrival_date && !stop.departure_date && <Text type="secondary" style={{ fontSize: mobile ? 14 : 12 }}>暂无日期记录</Text>}
            </>
          )}
        </div>

        {/* 各分类编辑区 */}
        {FIELD_META.map(({ key, label, placeholder, rows }) => {
          const value = stop[key] || '';
          const isEditing = editingField === key;
          const isLink = key === 'videos' || key === 'articles';
          return (
            <div key={key}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text type="secondary" style={{ fontSize: mobile ? 14 : 12 }}>{label}</Text>
                {canEdit && !isEditing ? (
                  <Button type="text" size="small" icon={<EditOutlined />} onClick={() => startEditField(key)} style={{ fontSize: 12, height: 22 }}>
                    {value ? '编辑' : '添加'}
                  </Button>
                ) : canEdit && isEditing ? (
                  <Space size={4}>
                    <Button size="small" icon={<CloseOutlined />} onClick={() => setEditingField(null)} style={{ height: 22 }} />
                    <Button size="small" type="primary" icon={<CheckOutlined />} loading={saving} onClick={saveCurrentField} style={{ height: 22 }}>保存</Button>
                  </Space>
                ) : null}
              </div>
              {isEditing ? (
                <Input.TextArea value={fieldValue} onChange={e => setFieldValue(e.target.value)} rows={rows} placeholder={placeholder} autoFocus />
              ) : value ? (
                isLink ? (
                  <div style={{ fontSize: mobile ? 15 : 13, lineHeight: 1.7 }}>
                    {value.split('\n').map((line, i) => {
                      const url = line.trim();
                      if (!url) return null;
                      const looksLikeUrl = /^https?:\/\//i.test(url);
                      return looksLikeUrl ? (
                        <div key={i}><a href={url} target="_blank" rel="noopener noreferrer" style={{ wordBreak: 'break-all' }}>{url}</a></div>
                      ) : (
                        <div key={i} style={{ wordBreak: 'break-all' }}>{url}</div>
                      );
                    })}
                  </div>
                ) : (
                  <Text style={{ fontSize: mobile ? 15 : 13, whiteSpace: 'pre-wrap' }}>{value}</Text>
                )
              ) : (
                <Text type="secondary" style={{ fontSize: mobile ? 14 : 12 }}>暂无{label}</Text>
              )}
            </div>
          );
        })}

        {/* 照片 */}
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            照片 ({stop.photos.length})
          </Text>
          <Image.PreviewGroup>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {stop.photos.map(photo => (
                <div key={photo.id} style={{ position: 'relative' }}>
                  <Image src={`/api/photos/${photo.id}/file`} width={80} height={80}
                    style={{ objectFit: 'cover', borderRadius: 6 }} alt={photo.caption} />
                  <div style={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 2 }}>
                    <Button size="small" icon={<ShareAltOutlined />}
                      style={{ width: 20, height: 20, minWidth: 20, padding: 0, fontSize: 10 }}
                      onClick={() => sharePhoto(photo)} />
                    {canEdit && (
                      <Popconfirm title="删除这张照片？" onConfirm={() => handleDeletePhoto(photo)}>
                        <Button size="small" danger icon={<DeleteOutlined />}
                          style={{ width: 20, height: 20, minWidth: 20, padding: 0, fontSize: 10 }} />
                      </Popconfirm>
                    )}
                  </div>
                </div>
              ))}
              {canEdit && (
                <Upload showUploadList={false} beforeUpload={handleUpload} accept="image/*,video/*" multiple>
                  <div style={{ width: 80, height: 80, border: '1px dashed #d9d9d9', borderRadius: 6,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: '#999', fontSize: 11 }}>
                    {uploading ? '上传中...' : <><PlusOutlined style={{ fontSize: 18, marginBottom: 4 }} />添加</>}
                  </div>
                </Upload>
              )}
            </div>
          </Image.PreviewGroup>
        </div>

      </div>
    </Drawer>
  );
}
