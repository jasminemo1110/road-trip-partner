import { AUTHOR_NAME, PRODUCT_NAME } from './exportShared';

interface MapSignatureProps {
  scale?: number;
}

export default function MapSignature({ scale = 1 }: MapSignatureProps) {
  return (
    <div style={{
      position: 'absolute',
      right: Math.round(18 * scale),
      bottom: Math.round(18 * scale),
      zIndex: 5,
      padding: `${Math.round(8 * scale)}px ${Math.round(12 * scale)}px`,
      borderRadius: Math.round(8 * scale),
      background: 'rgba(255,255,255,.82)',
      boxShadow: '0 2px 8px rgba(0,0,0,.10)',
      fontSize: Math.round(14 * scale),
      lineHeight: 1.55,
      color: '#666',
      textAlign: 'right',
      pointerEvents: 'none',
    }}>
      <div>Made with <span style={{ color: '#333', fontWeight: 600 }}>{PRODUCT_NAME}</span></div>
      <div>Created by <span style={{ color: '#333', fontWeight: 600 }}>{AUTHOR_NAME}</span></div>
    </div>
  );
}
