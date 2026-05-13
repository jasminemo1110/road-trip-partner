import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MapPage from './pages/MapPage';
import RoutePage from './pages/RoutePage';
import ExportIndex from './pages/export/ExportIndex';
import ExportRender from './pages/export/ExportRender';
import { getRuntimeConfig } from './config';
import { setHomeBaseCity } from './components/export/exportShared';
import 'antd/dist/reset.css';

export default function App() {
  useEffect(() => {
    getRuntimeConfig().then(config => {
      if (config.homeBaseCity) setHomeBaseCity(config.homeBaseCity);
      if (config.siteTitle) document.title = config.siteTitle;
      const desc = config.siteSocialDescription || config.siteTitle;
      if (desc) {
        document.querySelectorAll<HTMLMetaElement>(
          'meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]'
        ).forEach(el => { el.content = desc; });
      }
      if (config.siteTitle) {
        document.querySelectorAll<HTMLMetaElement>(
          'meta[property="og:title"], meta[name="twitter:title"]'
        ).forEach(el => { el.content = config.siteTitle; });
      }
      if (config.socialPreviewUrl) {
        document.querySelectorAll<HTMLMetaElement>(
          'meta[property="og:image"], meta[name="twitter:image"]'
        ).forEach(el => { el.content = config.socialPreviewUrl; });
      }
    });
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MapPage />} />
        <Route path="/route/:id" element={<RoutePage />} />
        <Route path="/export" element={<ExportIndex />} />
        <Route path="/export/render" element={<ExportRender />} />
      </Routes>
    </BrowserRouter>
  );
}
