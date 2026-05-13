import titleLogo from '../../assets/export-title.png';
import { useRuntimeConfig } from '../../config';
import { PRODUCT_NAME } from '../Attribution';

interface ExportTitleLogoProps {
  maxWidth?: number | string;
  height?: number | string;
  align?: 'left' | 'center';
}

export default function ExportTitleLogo({ maxWidth = '100%', height = 'auto', align = 'left' }: ExportTitleLogoProps) {
  const config = useRuntimeConfig();
  const src = config?.exportTitleImageUrl || titleLogo;
  const title = config?.siteTitle || PRODUCT_NAME;

  if (!src) {
    const wordmarkSize = typeof height === 'number' ? Math.max(24, height * 0.55) : 36;
    return (
      <div style={{
        width: '100%',
        maxWidth,
        height: height === 'auto' ? undefined : height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        fontSize: wordmarkSize,
        fontWeight: 800,
        color: '#2f3c34',
        letterSpacing: '0.5px',
      }}>
        {title}
      </div>
    );
  }

  if (height !== 'auto') {
    return (
      <div style={{
        width: '100%', maxWidth, height,
        display: 'flex', alignItems: 'center', justifyContent: align === 'center' ? 'center' : 'flex-start',
      }}>
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
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={title}
      style={{
        display: 'block',
        width: '100%',
        maxWidth,
        height,
        objectFit: 'contain',
        objectPosition: `${align} center`,
      }}
    />
  );
}
