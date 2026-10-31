// Read-only synthetic API for export layout QA; never reads or writes travel data.
import { createServer } from 'node:http';

createServer((request, response) => {
  const page = new URL(request.headers.referer || 'http://localhost');
  const count = Math.max(1, Math.min(100, Number(page.searchParams.get('count')) || 9));
  const stopCount = Math.max(1, Math.min(100, Number(page.searchParams.get('stops')) || 8));
  const longNames = page.searchParams.get('longNames') === 'true';
  const routes = Array.from({ length: count }, (_, index) => ({
    id: index + 1, name: longNames ? `测试路线 ${index + 1} · 山河湖泊与漫长旅途这是一条用于验证换行的长名称` : `测试路线 ${index + 1}`,
    year: 2026, color: '#2563EB', description: '', is_favorite: false, qr_code_path: '',
    stops: Array.from({ length: stopCount }, (_, order) => ({
      id: index * 1000 + order + 1, city_name: longNames ? `测试站点${order + 1}长名称换行检查` : `测试站点 ${order + 1}`,
      longitude: 100 + order * 0.1, latitude: 35, arrival_date: '2026-01-01', departure_date: '2026-01-23',
      lodging: '', food: '', attractions: '', other: '', videos: '', articles: '', order, transport_mode: 'drive', photos: [],
    })),
  }));
  const path = new URL(request.url, 'http://localhost').pathname;
  const data = path === '/api/routes' ? routes : path === '/api/config' ? {
    siteTitle: 'Export layout fixtures', homeBaseCity: '济南', amapKey: '', amapSecurityCode: '', editRequired: true,
  } : null;
  response.writeHead(data ? 200 : 404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(data));
}).listen(8001, '127.0.0.1', () => console.log('Synthetic export API: http://127.0.0.1:8001'));
