import { FormEvent, useState } from "react";
import { useAuth } from "../auth";
import { ApiError } from "../api";

const INPUT = "mt-1.5 w-full rounded-xl border border-white/10 bg-ink-900/80 px-3.5 py-2.5 text-sm text-stone-100 outline-none transition placeholder:text-stone-600 focus:border-moss-500/60 focus:ring-2 focus:ring-moss-500/20";

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reg = mode === "register";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (reg) await register(name.trim(), username.trim(), password);
      else await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  function flip() { setMode(reg ? "signin" : "register"); setError(null); }
  const ready = username.trim() && password && (!reg || name.trim().length >= 2);

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="fade-in w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <svg width="54" height="54" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" stroke="#34d399" strokeOpacity=".5" /><path d="M16 6c5 4 7 8 0 20C9 14 11 10 16 6Z" fill="#34d399" /><path d="M3 18h6l3-5 4 9 3-6 2 2h8" stroke="#ecfdf5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <h1 className="font-display mt-4 text-3xl tracking-wide text-stone-50">TERRAPULSE</h1>
          <div className="label mt-1.5">Forest intelligence · Mudumalai</div>
        </div>

        <form onSubmit={submit} className="glass p-6" noValidate>
          <h2 className="h-display text-xl">{reg ? "Create a citizen account" : "Sign in"}</h2>
          <p className="mt-1 text-sm text-stone-400">{reg ? "Report fires or tree felling near you." : "Forest department staff and registered citizens."}</p>

          {reg && (<>
            <label className="label mt-6 block" htmlFor="tp-name">Your name</label>
            <input id="tp-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
          </>)}

          <label className={`label ${reg ? "mt-4" : "mt-6"} block`} htmlFor="tp-user">Username</label>
          <input id="tp-user" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className={INPUT} />
          {reg && <p className="mt-1.5 text-xs text-stone-500">3 to 32 characters: letters, numbers, dot, dash or underscore.</p>}

          <label className="label mt-4 block" htmlFor="tp-pass">Password</label>
          <div className="relative mt-1.5">
            <input id="tp-pass" type={show ? "text" : "password"} autoComplete={reg ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-ink-900/80 py-2.5 pl-3.5 pr-16 text-sm text-stone-100 outline-none transition focus:border-moss-500/60 focus:ring-2 focus:ring-moss-500/20" />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-stone-400 hover:text-stone-100">
              {show ? "Hide" : "Show"}
            </button>
          </div>
          {reg && <p className="mt-1.5 text-xs text-stone-500">At least 8 characters.</p>}

          {error && <div role="alert" className="mt-4 rounded-xl border border-crit/40 bg-crit/10 px-3.5 py-2.5 text-sm text-red-200">{error}</div>}

          <button type="submit" disabled={busy || !ready} className="btn-primary mt-6 w-full">
            {busy ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-950 border-t-transparent" />{reg ? "Creating account…" : "Signing in…"}</> : reg ? "Create account" : "Sign in"}
          </button>

          <div className="mt-5 text-center text-sm text-stone-400">
            {reg ? "Already have an account?" : "New here?"}{" "}
            <button type="button" onClick={flip} className="text-moss-400 underline decoration-moss-400/30 underline-offset-4 hover:text-moss-500">{reg ? "Sign in" : "Create a citizen account"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
