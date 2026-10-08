const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";
const TOKEN_KEY = "terrapulse_token";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t: string) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage blocked: sign-in lasts until reload */ }
}
export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// A 401 on a request that carried a token means it expired: sign the user out.
function handle401(sentToken: boolean) {
  if (sentToken) { clearToken(); window.dispatchEvent(new Event("tp-auth-expired")); }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  const sentToken = !!getToken();
  try {
    const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData; // browser sets the multipart boundary itself
    r = await fetch(BASE + path, { ...init, headers: isForm ? authHeaders() : { "Content-Type": "application/json", ...authHeaders() } });
  } catch {
    throw new ApiError("Backend unavailable. Start the FastAPI server (uvicorn app.main:app --port 8000) and reload.", 0);
  }
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const j = await r.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch { /* ignore */ }
    if (r.status === 502 || r.status === 504) {
      if (!msg || msg === r.statusText) msg = "Backend unavailable (proxy could not reach FastAPI on port 8000).";
    }
    if (r.status === 401) handle401(sentToken);
    throw new ApiError(msg, r.status);
  }
  return r.json() as Promise<T>;
}

export const api = {
  get: <T,>(p: string) => req<T>(p),
  post: <T,>(p: string, body?: unknown) => req<T>(p, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  postForm: <T,>(p: string, form: FormData) => req<T>(p, { method: "POST", body: form }),
  // Photos need the sign-in token, so they are fetched as blobs instead of plain <img src>.
  blob: async (p: string) => {
    const sentToken = !!getToken();
    const r = await fetch(BASE + p, { headers: authHeaders() });
    if (!r.ok) { if (r.status === 401) handle401(sentToken); throw new ApiError("Could not load the photo", r.status); }
    return r.blob();
  },
  text: async (p: string) => {
    const sentToken = !!getToken();
    const r = await fetch(BASE + p, { headers: authHeaders() });
    if (!r.ok) { if (r.status === 401) handle401(sentToken); throw new ApiError("Download failed", r.status); }
    return r.text();
  },
};
