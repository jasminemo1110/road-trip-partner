export const PRODUCT_NAME = 'Road Trip Partner';
export const AUTHOR_LINE = 'Created by 茉白';
// Permanent attribution link to the public project repo.
export const ATTRIBUTION_GITHUB_HANDLE = 'jasminemo1110';
export const ATTRIBUTION_GITHUB_URL = 'https://github.com/jasminemo1110/road-trip-partner';

interface AttributionProps {
  variant?: 'sidebar' | 'inline';
}

export default function Attribution({ variant = 'sidebar' }: AttributionProps) {
  if (variant === 'inline') {
    return (
      <span style={{ color: '#4f5a53' }}>
        {PRODUCT_NAME} · {AUTHOR_LINE}
      </span>
    );
  }
  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#2f3c34' }}>{PRODUCT_NAME}</div>
      <div style={{ fontWeight: 600, color: '#4f5a53', marginTop: 1 }}>{AUTHOR_LINE}</div>
      <div style={{ marginTop: 3 }}>
        GitHub：
        <a
          href={ATTRIBUTION_GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          style={{ color: '#2f6f4f', fontWeight: 600 }}
        >
          {ATTRIBUTION_GITHUB_HANDLE}
        </a>
      </div>
    </>
  );
}
