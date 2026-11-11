export function apiRequestHeaders(token: string | null, options: Pick<RequestInit, 'body' | 'headers'>): Headers {
  const headers = new Headers(options.headers);
  const body = options.body;

  if (typeof body === 'string' && body.length > 0 && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
}
