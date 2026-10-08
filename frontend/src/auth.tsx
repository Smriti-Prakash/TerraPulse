import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, clearToken, getToken, setToken } from "./api";

export interface User { username: string; name: string; role: string }

interface AuthCtx {
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (name: string, username: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  // On first load, check a saved token with the backend.
  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.get<{ user: User }>("/api/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => clearToken())
      .finally(() => setReady(true));
  }, []);

  // Any 401 from the API (expired or invalid token) signs the user out.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener("tp-auth-expired", onExpired);
    return () => window.removeEventListener("tp-auth-expired", onExpired);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.post<{ token: string; user: User }>("/api/auth/login", { username, password });
    setToken(r.token);
    setUser(r.user);
  }, []);

  const register = useCallback(async (name: string, username: string, password: string) => {
    const r = await api.post<{ token: string; user: User }>("/api/auth/register", { name, username, password });
    setToken(r.token);
    setUser(r.user);
  }, []);

  const logout = useCallback(() => { clearToken(); setUser(null); }, []);

  return <Ctx.Provider value={{ user, ready, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
