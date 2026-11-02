import { createContext, ReactNode, useCallback, useContext, useState } from "react";

export type Lang = "en" | "ta";
const KEY = "terrapulse_lang";
const read = (): Lang => { try { return localStorage.getItem(KEY) === "ta" ? "ta" : "en"; } catch { return "en"; } };

const T = {
  report: { en: "Report", ta: "அறிக்கை" },
  mine: { en: "My reports", ta: "என் அறிக்கைகள்" },
  alerts: { en: "Alerts", ta: "எச்சரிக்கைகள்" },
  safety: { en: "Safety", ta: "பாதுகாப்பு" },
  signOut: { en: "Sign out", ta: "வெளியேறு" },
  formTitle: { en: "Report a fire, smoke or tree felling", ta: "தீ, புகை அல்லது மரம் வெட்டுதலைத் தெரிவிக்கவும்" },
  stay: { en: "Stay safe.", ta: "பாதுகாப்பாக இருங்கள்." },
  stayText: { en: "If a fire is burning, keep away and call the forest department or emergency number 112 first. Then report here.", ta: "தீ எரிந்தால் அருகில் செல்ல வேண்டாம்; முதலில் வனத்துறையை அல்லது அவசர எண் 112-ஐ அழைக்கவும். பிறகு இங்கே தெரிவிக்கவும்." },
  step1: { en: "Take a photo", ta: "புகைப்படம் எடுக்கவும்" },
  photoHelp: { en: "On a phone this opens the camera. Take the photo at the place you are reporting.", ta: "தொலைபேசியில் இது கேமராவைத் திறக்கும். தெரிவிக்கும் இடத்திலேயே படம் எடுக்கவும்." },
  step2: { en: "What are you reporting?", ta: "எதைத் தெரிவிக்கிறீர்கள்?" },
  fire: { en: "Fire or smoke", ta: "தீ அல்லது புகை" },
  deforestation: { en: "Tree felling / vegetation loss", ta: "மரம் வெட்டுதல் / தாவர இழப்பு" },
  other: { en: "Other", ta: "மற்றவை" },
  step3: { en: "Where is it?", ta: "எங்கே உள்ளது?" },
  useLoc: { en: "Use my location", ta: "என் இருப்பிடத்தைப் பயன்படுத்து" },
  tapMap: { en: "or tap the map to place the pin", ta: "அல்லது வரைபடத்தில் தொட்டுக் குறிக்கவும்" },
  noLoc: { en: "No location chosen yet.", ta: "இடம் இன்னும் தேர்ந்தெடுக்கப்படவில்லை." },
  step4: { en: "Add a note (optional)", ta: "குறிப்பு சேர்க்கவும் (விருப்பம்)" },
  noteHolder: { en: "What did you see? When did you notice it?", ta: "என்ன பார்த்தீர்கள்? எப்போது கவனித்தீர்கள்?" },
  send: { en: "Send report", ta: "அறிக்கையை அனுப்பு" },
  sending: { en: "Sending…", ta: "அனுப்புகிறது…" },
  needBoth: { en: "Add a photo and a location to send.", ta: "அனுப்ப புகைப்படமும் இடமும் சேர்க்கவும்." },
  privacy: { en: "Reports are reviewed by forest officers. Your name is visible only to authorised officers. A report is a claim until an officer checks it.", ta: "அறிக்கைகளை வனத்துறை அதிகாரிகள் ஆய்வு செய்வர். உங்கள் பெயர் அங்கீகரிக்கப்பட்ட அதிகாரிகளுக்கு மட்டுமே தெரியும். அதிகாரி சரிபார்க்கும் வரை இது ஒரு தகவல் மட்டுமே." },
  received: { en: "Report received", ta: "அறிக்கை பெறப்பட்டது" },
  receivedText: { en: "Thank you. Your report has been sent to the forest office and will be reviewed by an officer. You can follow its status under My reports.", ta: "நன்றி. உங்கள் அறிக்கை வனத்துறை அலுவலகத்துக்கு அனுப்பப்பட்டது; அதிகாரி ஆய்வு செய்வார். என் அறிக்கைகள் பகுதியில் நிலையைப் பார்க்கலாம்." },
  receivedWarn: { en: "If there is a fire close to people or homes, call 112 now. Do not go near the fire.", ta: "மக்கள் அல்லது வீடுகள் அருகே தீ இருந்தால் உடனே 112-ஐ அழைக்கவும். தீயின் அருகில் செல்ல வேண்டாம்." },
  viewMine: { en: "View my reports", ta: "என் அறிக்கைகளைப் பார்" },
  another: { en: "Report another", ta: "மற்றொன்றைத் தெரிவி" },
  myTitle: { en: "My reports", ta: "என் அறிக்கைகள்" },
  none: { en: "You have not sent any reports yet.", ta: "நீங்கள் இன்னும் அறிக்கை எதுவும் அனுப்பவில்லை." },
  status: { en: "Status", ta: "நிலை" },
  Received: { en: "Received", ta: "பெறப்பட்டது" },
  "Under review": { en: "Under review", ta: "ஆய்வில் உள்ளது" },
  "Action taken": { en: "Action taken", ta: "நடவடிக்கை எடுக்கப்பட்டது" },
  Closed: { en: "Closed", ta: "முடிக்கப்பட்டது" },
  alertsTitle: { en: "Community alerts", ta: "சமூக எச்சரிக்கைகள்" },
  alertsNone: { en: "There are no alerts right now.", ta: "தற்போது எச்சரிக்கைகள் இல்லை." },
  demo: { en: "DEMO – NOT AN OFFICIAL ALERT", ta: "டெமோ – அதிகாரப்பூர்வ எச்சரிக்கை அல்ல" },
} as const;
export type Key = keyof typeof T;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: Key) => string } | null>(null);
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(read);
  const setLang = useCallback((l: Lang) => { set(l); try { localStorage.setItem(KEY, l); } catch { /* storage blocked */ } }, []);
  const t = useCallback((k: Key) => T[k][lang], [lang]);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}
export function useLang() { const c = useContext(Ctx); if (!c) throw new Error("useLang outside LangProvider"); return c; }

export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="flex rounded-lg border border-white/10 p-0.5 text-xs" role="group" aria-label="Language">
      {([["en", "EN"], ["ta", "தமிழ்"]] as const).map(([k, l]) => <button key={k} onClick={() => setLang(k)} aria-pressed={lang === k} className={`rounded-md px-2.5 py-1 ${lang === k ? "bg-moss-500 text-ink-950" : "text-stone-400"}`}>{l}</button>)}
    </div>
  );
}
