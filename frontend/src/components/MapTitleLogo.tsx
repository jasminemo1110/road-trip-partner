import mapTitleLogo from '../assets/map-title.png';
import { useRuntimeConfig } from '../config';
import { PRODUCT_NAME } from './Attribution';

interface MapTitleLogoProps {
  height?: number | string;
  align?: 'flex-start' | 'center';
}

export default function MapTitleLogo({ height = 124, align = 'flex-start' }: MapTitleLogoProps) {
  const config = useRuntimeConfig();
  const src = config?.titleImageUrl || mapTitleLogo;
  const title = config?.siteTitle || PRODUCT_NAME;
  return (
    <div style={{
      width: '100%',
      height,
      display: 'flex',
      alignItems: 'center',
      justifyContent: align,
    }}>
      {src ? (
        <img
          src={src}
          alt={title}
          style={{
            display: 'block',
            maxWidth: '100%',
            maxHeight: '100%',
            width: 'auto',
            height: 'auto',
          }}
        />
      ) : (
        <div style={{
          fontSize: 28,
          fontWeight: 800,
          color: '#2f3c34',
          letterSpacing: '0.5px',
        }}>
          {title}
        </div>
      )}
    </div>
  );
}
