import { EXPORT_DIVIDER, PRODUCT_NAME, AUTHOR_NAME, GITHUB_HANDLE } from './exportShared';

interface WatermarkProps {
  align?: 'left' | 'center' | 'right';
  divider?: boolean;
  scale?: number;
}

function generatedDateLabel() {
  const now = new Date();
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
}

// Footer signature shown at the bottom of every export sidebar.
// Sits below a thin divider; styled subtle so it doesn't compete with content.
export default function Watermark({ align = 'left', divider = true, scale = 1 }: WatermarkProps) {
  return (
    <div style={{
      borderTop: divider ? `1px solid ${EXPORT_DIVIDER}` : 'none',
      paddingTop: divider ? Math.round(22 * scale) : 0,
      marginTop: divider ? Math.round(22 * scale) : 0,
      fontSize: Math.round(19 * scale),
      color: '#888',
      lineHeight: 1.85,
      letterSpacing: 0.2,
      flexShrink: 0,
      textAlign: align,
    }}>
      <div>Made with <span style={{ color: '#444', fontWeight: 600 }}>{PRODUCT_NAME}</span></div>
      <div>Created by <span style={{ color: '#444', fontWeight: 600 }}>{AUTHOR_NAME}</span></div>
      <div>github: <span style={{ color: '#444' }}>{GITHUB_HANDLE}</span></div>
      <div>图片生成于 <span style={{ color: '#444' }}>{generatedDateLabel()}</span></div>
    </div>
  );
}
