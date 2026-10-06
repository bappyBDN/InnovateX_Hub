/** Thin fetch client. The base URL comes only from VITE_API_BASE_URL (root .env). */
const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const TOKEN_KEY = 'ix.token';

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  requestId?: string;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

// Token lives in sessionStorage only (spec §13.4: nothing personal in localStorage).
export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export type Params = Record<string, string | number | boolean | null | undefined | Array<string | number>>;

export function apiUrl(path: string, params?: Params): string {
  let url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
      else qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  return url;
}

/** Offset between server and browser clocks, taken from the Date header (spec §13.3). */
let serverOffsetMs = 0;
export const getServerOffsetMs = () => serverOffsetMs;
export const setServerOffsetMs = (ms: number) => {
  serverOffsetMs = ms;
};

function redirectToLogin() {
  if (window.location.pathname.startsWith('/login')) return;
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

async function toError(res: Response): Promise<ApiError> {
  const requestId = res.headers.get('X-Request-Id') ?? undefined;
  let code = `HTTP_${res.status}`;
  let message = res.statusText || 'Request failed';
  let details: Record<string, unknown> = {};
  try {
    const body = await res.json();
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details ?? {};
    } else if (typeof body?.detail === 'string') {
      message = body.detail;
    }
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, code, message, details, requestId);
}

interface RequestOptions {
  params?: Params;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  /** Do not redirect to /login on 401 (used by the login call itself). */
  noAuthRedirect?: boolean;
}

async function raw(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path, opts.params), { method, headers, body });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection and try again.");
  }
  const date = res.headers.get('Date');
  if (date) {
    const t = Date.parse(date);
    if (!Number.isNaN(t)) serverOffsetMs = t - Date.now();
  }
  if (res.status === 401 && !opts.noAuthRedirect) {
    clearToken();
    redirectToLogin();
  }
  if (!res.ok) throw await toError(res);
  return res;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await raw(method, path, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** New key per submit action so double-clicks never create two submissions (spec §13.2). */
export function idempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const api = {
  get: <T = unknown>(path: string, params?: Params) => request<T>('GET', path, { params }),
  post: <T = unknown>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { ...opts, body: body ?? {} }),
  put: <T = unknown>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  patch: <T = unknown>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  del: <T = unknown>(path: string, params?: Params) => request<T>('DELETE', path, { params }),
  upload: <T = unknown>(path: string, form: FormData) => request<T>('POST', path, { form }),
  /** Downloads a protected file (needs the auth header, so we fetch it as a blob). */
  download: async (path: string, filename?: string, params?: Params): Promise<void> => {
    const res = await raw('GET', path, { params, headers: { Accept: '*/*' } });
    const blob = await res.blob();
    let name = filename;
    if (!name) {
      const cd = res.headers.get('Content-Disposition') ?? '';
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
      name = m ? decodeURIComponent(m[1]) : 'download';
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
