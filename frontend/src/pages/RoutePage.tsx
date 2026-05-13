import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Timeline, Image, Tag, Button, Spin, Empty } from 'antd';
import { ArrowLeftOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { getRoute } from '../api';
import type { Route } from '../types';
import { routeTravelStopCount } from '../components/export/exportShared';
import dayjs from 'dayjs';

export default function RoutePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [route, setRoute] = useState<Route | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getRoute(Number(id)).then(r => { setRoute(r); setLoading(false); });
  }, [id]);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', marginTop: 80 }}><Spin /></div>;
  if (!route) return <Empty description="线路不存在" />;

  const stops = [...route.stops].sort((a, b) => a.order - b.order);
  const arrivals = stops.map(s => s.arrival_date).filter(Boolean) as string[];
  const departures = stops.map(s => s.departure_date || s.arrival_date).filter(Boolean) as string[];
  const totalDays = arrivals.length && departures.length
    ? dayjs(departures.sort().slice(-1)[0]).diff(dayjs(arrivals.sort()[0]), 'day') + 1
    : 0;

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>返回地图</Button>
        <div>
          <h2 style={{ margin: 0 }}>
            <span style={{ color: route.color, marginRight: 8 }}>●</span>
            {route.name}
          </h2>
          <div style={{ marginTop: 4 }}>
            {route.year && <Tag color={route.color}>{route.year}年</Tag>}
            <Tag>{routeTravelStopCount(route)} 站</Tag>
            {totalDays > 0 && <Tag>{totalDays} 天</Tag>}
          </div>
        </div>
      </div>

      {route.description && (
        <p style={{ color: '#666', marginBottom: 20 }}>{route.description}</p>
      )}

      {stops.length === 0 ? (
        <Empty description="还没有添加城市" />
      ) : (
        <Timeline
          items={stops.map((stop, idx) => {
            const nights = stop.arrival_date && stop.departure_date
              ? dayjs(stop.departure_date).diff(dayjs(stop.arrival_date), 'day')
              : null;
            return {
              color: idx === 0 || idx === stops.length - 1 ? route.color : '#ccc',
              icon: idx === 0 || idx === stops.length - 1
                ? <EnvironmentOutlined style={{ color: route.color, fontSize: 16 }} />
                : undefined,
              content: (
                <div style={{ paddingBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 16 }}>{stop.city_name}</span>
                    {idx === 0 && <Tag color="green">出发</Tag>}
                    {idx === stops.length - 1 && stops.length > 1 && <Tag color="blue">返回</Tag>}
                    {nights !== null && nights > 0 && <Tag>停留 {nights} 晚</Tag>}
                  </div>
                  {(stop.arrival_date || stop.departure_date) && (
                    <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>
                      {stop.arrival_date} {stop.departure_date ? `→ ${stop.departure_date}` : ''}
                    </div>
                  )}
                  {([
                    ['lodging', '住宿'], ['food', '餐饮'], ['attractions', '景点'],
                    ['other', '其他'], ['videos', '视频'], ['articles', '文章'],
                  ] as const).map(([k, label]) => stop[k] ? (
                    <div key={k} style={{ marginBottom: 6, fontSize: 13 }}>
                      <span style={{ color: '#888', marginRight: 6 }}>{label}：</span>
                      <span style={{ color: '#555', whiteSpace: 'pre-wrap' }}>{stop[k]}</span>
                    </div>
                  ) : null)}
                  {stop.photos.length > 0 && (
                    <Image.PreviewGroup>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {stop.photos.map(photo => (
                          <Image
                            key={photo.id}
                            src={`/api/photos/${photo.id}/file`}
                            width={100}
                            height={100}
                            style={{ objectFit: 'cover', borderRadius: 6 }}
                            alt={photo.caption}
                          />
                        ))}
                      </div>
                    </Image.PreviewGroup>
                  )}
                </div>
              ),
            };
          })}
        />
      )}
    </div>
  );
}
