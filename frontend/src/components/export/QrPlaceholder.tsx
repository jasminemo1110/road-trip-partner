import { EXPORT_BG } from './exportShared';

interface QrPlaceholderProps {
  // Future: actual QR image URL once routes/stops support uploaded QR codes.
  src?: string;
  caption?: string;
  size?: number;
  marginTop?: number;
}

// Reserved 200×200 QR slot above the watermark. Currently shows a dashed
// placeholder; once route/stop QR upload is implemented, pass the image URL
// via `src` and it'll render as the real code.
export default function QrPlaceholder({ src, caption = '扫码查看更多', size = 200, marginTop = 18 }: QrPlaceholderProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 6, marginTop, flexShrink: 0,
    }}>
      <div style={{
        width: size, height: size,
        border: src ? 'none' : '1.5px dashed #d4d4d4',
        background: src ? `url(${src}) center/cover` : EXPORT_BG,
        borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxSizing: 'border-box',
      }}>
        {!src && (
          <div style={{ textAlign: 'center', lineHeight: 1.7, color: '#aaa' }}>
            <div style={{ fontSize: 28, marginBottom: 4 }}>▦</div>
            <div style={{ fontSize: 14, color: '#888' }}>{caption}</div>
            <div style={{ fontSize: 12, color: '#bbb', marginTop: 2 }}>（预留位）</div>
          </div>
        )}
      </div>
    </div>
  );
}
