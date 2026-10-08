import { useEffect, useState } from "react";
import { api } from "../api";

/** Shows a photo that needs the sign-in token (fetched as a blob, so <img src> alone would be refused). */
export default function AuthImage({ path, alt, className = "" }: { path: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    setSrc(null); setFailed(false);
    api.blob(path).then((b) => { if (alive) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => alive && setFailed(true));
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [path]);
  if (failed) return <div className={`flex items-center justify-center bg-ink-900 text-xs text-stone-500 ${className}`}>Photo unavailable</div>;
  if (!src) return <div className={`animate-pulse bg-ink-700 ${className}`} />;
  return <img src={src} alt={alt} className={className} />;
}
