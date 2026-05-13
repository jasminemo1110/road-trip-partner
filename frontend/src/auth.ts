const EDIT_TOKEN_STORAGE_KEY = 'travel-map:editToken';

function captureEditTokenFromUrl() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('edit') || url.searchParams.get('token');
  if (!token) return;

  localStorage.setItem(EDIT_TOKEN_STORAGE_KEY, token);
  url.searchParams.delete('edit');
  url.searchParams.delete('token');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export function getEditToken(): string {
  captureEditTokenFromUrl();
  return localStorage.getItem(EDIT_TOKEN_STORAGE_KEY) || '';
}

export function hasEditAccess(): boolean {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return true;
  }
  return Boolean(getEditToken());
}
