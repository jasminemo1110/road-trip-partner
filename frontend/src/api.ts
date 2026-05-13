import axios from 'axios';
import type { Route, Stop, Photo } from './types';
import { getEditToken } from './auth';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = getEditToken();
  if (token) config.headers.set('X-Edit-Token', token);
  return config;
});

export const getRoutes = () => api.get<Route[]>('/routes').then(r => r.data);
export const getRoute = (id: number) => api.get<Route>(`/routes/${id}`).then(r => r.data);
export const createRoute = (data: Partial<Route>) => api.post<Route>('/routes', data).then(r => r.data);
export const updateRoute = (id: number, data: Partial<Route>) => api.put<Route>(`/routes/${id}`, data).then(r => r.data);
export const deleteRoute = (id: number) => api.delete(`/routes/${id}`);
export const toggleFavorite = (id: number) => api.post<Route>(`/routes/${id}/favorite`).then(r => r.data);
export const routeQrUrl = (routeId: number, cacheKey?: string) =>
  `/api/routes/${routeId}/qr/file${cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : ''}`;
export const uploadRouteQr = (routeId: number, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.post<Route>(`/routes/${routeId}/qr`, form).then(r => r.data);
};
export const deleteRouteQr = (routeId: number) =>
  api.delete<Route>(`/routes/${routeId}/qr`).then(r => r.data);

export const createStop = (routeId: number, data: Partial<Stop>) =>
  api.post<Stop>(`/routes/${routeId}/stops`, data).then(r => r.data);
export const updateStop = (stopId: number, data: Partial<Stop>) =>
  api.put<Stop>(`/stops/${stopId}`, data).then(r => r.data);
export const deleteStop = (stopId: number) => api.delete(`/stops/${stopId}`);
export const reorderStops = (routeId: number, stopIds: number[]) =>
  api.post(`/routes/${routeId}/stops/reorder`, { stop_ids: stopIds });

export const uploadPhoto = (stopId: number, file: File, caption = '') => {
  const form = new FormData();
  form.append('file', file);
  form.append('caption', caption);
  return api.post<Photo>(`/stops/${stopId}/photos`, form).then(r => r.data);
};
export const deletePhoto = (photoId: number) => api.delete(`/photos/${photoId}`);

export const searchCity = (keyword: string) =>
  api.get<{ name: string; lng: number; lat: number }[]>(`/geocode?keyword=${encodeURIComponent(keyword)}`).then(r => r.data);

export const importGpx = (routeId: number, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.post<Stop[]>(`/routes/${routeId}/import-gpx`, form).then(r => r.data);
};

export interface LegPath {
  stop_a_id: number;
  stop_b_id: number;
  path: [number, number][];
}

export const getRouteLegPaths = (routeId: number) =>
  api.get<LegPath[]>(`/routes/${routeId}/leg-paths`).then(r => r.data);

export const saveLegPath = (stopAId: number, stopBId: number, path: [number, number][]) =>
  api.post<LegPath>('/leg-paths', { stop_a_id: stopAId, stop_b_id: stopBId, path }).then(r => r.data);

export interface ExportImagesJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  include: string[];
  wait: number;
  scale: number;
  output_dir: string;
  command?: string;
  stdout?: string;
  stderr?: string;
  return_code?: number;
  manifest_path?: string;
  zip_path?: string;
  zip_error?: string;
  progress_current?: number;
  progress_total?: number;
  current_label?: string;
  files_cleaned?: boolean;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
}

export const startExportImages = (include: string[], wait = 8000, scale = 4) =>
  api.post<ExportImagesJob>('/export-images/start', { include, wait, scale }).then(r => r.data);

export const getExportImagesJob = (jobId: string) =>
  api.get<ExportImagesJob>(`/export-images/${jobId}`).then(r => r.data);

export const downloadExportImagesZip = (jobId: string) =>
  api.get<Blob>(`/export-images/${jobId}/zip`, { responseType: 'blob' }).then(r => r.data);

export const cleanupExportImagesFiles = (jobId: string) =>
  api.delete(`/export-images/${jobId}/files`).then(r => r.data);
