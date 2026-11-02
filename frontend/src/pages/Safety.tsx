import { Link } from "react-router-dom";
import { LangToggle, useLang } from "../i18n";

const C = {
  en: {
    title: "Forest safety and fire advice", sub: "General guidance for people living or travelling near the forest. This page is information only; it does not report on any current event.",
    blocks: [
      ["If you see smoke or fire", ["Keep away. Do not try to put out a forest fire yourself.", "Call the forest department or the emergency number 112. Give the nearest landmark or village.", "If it is safe, take a photo from a distance and report it in TerraPulse. Do not go closer to take it."]],
      ["If a fire is coming towards you", ["Move away from the fire, towards a road, open ground, a river or a cleared area. Fire travels faster uphill.", "Warn people nearby. Keep roads clear for fire and rescue vehicles.", "Cover your nose and mouth with a wet cloth if there is smoke."]],
      ["Prevent forest fires", ["Do not light fires, burn waste or leave cigarettes, glass or bottles in or near the forest, especially in the dry months.", "Keep children and animals away from burning areas.", "Tell the forest department if you see someone lighting a fire."]],
      ["If you see trees being felled or land being cleared", ["Do not confront anyone. Stay safe and note the place and time.", "Report it with a photo in TerraPulse. A report is a claim until a forest officer checks permits and records; TerraPulse does not decide whether something is legal.", "Do not share unverified accusations."]],
      ["After you report", ["Your report goes to forest officers. You can follow its status under My reports: Received, Under review, Action taken or Closed.", "Alerts shown in this prototype are a demonstration and are not official warnings. In an emergency always call 112."]],
    ],
    back: "Back to TerraPulse", demo: "TerraPulse is a student prototype. It is not an official warning system.",
  },
  ta: {
    title: "வன பாதுகாப்பு மற்றும் தீ குறித்த அறிவுரை", sub: "காடு அருகே வசிப்பவர்கள் அல்லது பயணிப்பவர்களுக்கான பொது வழிகாட்டுதல். இது தகவலுக்காக மட்டுமே; தற்போதைய எந்த நிகழ்வையும் இது குறிப்பிடவில்லை.",
    blocks: [
      ["புகை அல்லது தீயைக் கண்டால்", ["விலகி இருங்கள். காட்டுத்தீயை நீங்களே அணைக்க முயற்சிக்க வேண்டாம்.", "வனத்துறையை அல்லது அவசர எண் 112-ஐ அழைக்கவும். அருகிலுள்ள அடையாளம் அல்லது கிராமத்தைத் தெரிவிக்கவும்.", "பாதுகாப்பாக இருந்தால் தூரத்திலிருந்து புகைப்படம் எடுத்து TerraPulse-ல் தெரிவிக்கவும். படம் எடுக்க நெருங்கிச் செல்ல வேண்டாம்."]],
      ["தீ உங்களை நோக்கி வந்தால்", ["தீயிலிருந்து விலகி, சாலை, திறந்தவெளி, ஆறு அல்லது சுத்தம் செய்யப்பட்ட பகுதியை நோக்கிச் செல்லுங்கள். மேல்நோக்கி தீ வேகமாகப் பரவும்.", "அருகிலுள்ளவர்களை எச்சரியுங்கள். தீயணைப்பு, மீட்பு வாகனங்களுக்குச் சாலையை விட்டுவையுங்கள்.", "புகை இருந்தால் ஈரத் துணியால் மூக்கையும் வாயையும் மூடிக்கொள்ளுங்கள்."]],
      ["காட்டுத்தீயைத் தடுக்க", ["காட்டிலோ அதன் அருகிலோ, குறிப்பாக வறண்ட மாதங்களில், தீ மூட்டவோ குப்பையை எரிக்கவோ சிகரெட், கண்ணாடி, பாட்டில்களை விடவோ வேண்டாம்.", "எரியும் பகுதிகளிலிருந்து குழந்தைகளையும் விலங்குகளையும் தள்ளி வையுங்கள்.", "யாராவது தீ மூட்டுவதைக் கண்டால் வனத்துறைக்குத் தெரிவியுங்கள்."]],
      ["மரங்கள் வெட்டப்படுவதை அல்லது நிலம் சுத்தம் செய்யப்படுவதைக் கண்டால்", ["யாரையும் எதிர்கொள்ள வேண்டாம். பாதுகாப்பாக இருந்து இடத்தையும் நேரத்தையும் குறித்துக்கொள்ளுங்கள்.", "புகைப்படத்துடன் TerraPulse-ல் தெரிவிக்கவும். வனத்துறை அதிகாரி அனுமதிகளையும் பதிவுகளையும் சரிபார்க்கும் வரை இது ஒரு தகவல் மட்டுமே; சட்டப்படி சரியா என்பதை TerraPulse தீர்மானிக்காது.", "உறுதிப்படுத்தப்படாத குற்றச்சாட்டுகளைப் பகிர வேண்டாம்."]],
      ["தெரிவித்த பிறகு", ["உங்கள் அறிக்கை வனத்துறை அதிகாரிகளுக்குச் செல்லும். என் அறிக்கைகள் பகுதியில் நிலையைப் பார்க்கலாம்: பெறப்பட்டது, ஆய்வில் உள்ளது, நடவடிக்கை எடுக்கப்பட்டது அல்லது முடிக்கப்பட்டது.", "இந்த மாதிரி அமைப்பில் காட்டப்படும் எச்சரிக்கைகள் செயல்விளக்கம் மட்டுமே; அவை அதிகாரப்பூர்வ எச்சரிக்கைகள் அல்ல. அவசரத்தில் எப்போதும் 112-ஐ அழைக்கவும்."]],
    ],
    back: "TerraPulse-க்குத் திரும்பு", demo: "TerraPulse ஒரு மாணவர் மாதிரி அமைப்பு. இது அதிகாரப்பூர்வ எச்சரிக்கை அமைப்பு அல்ல.",
  },
} as const;

/** Public page (no sign-in): static safety advice in English and Tamil. */
export default function Safety() {
  const { lang } = useLang();
  const c = C[lang];
  return (
    <div className="mx-auto min-h-full w-full max-w-[780px] px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3"><Link to="/" className="label hover:text-moss-400">← {c.back}</Link><LangToggle /></div>
      <h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-stone-400">{c.sub}</p>
      <div className="mt-6 space-y-4">
        {c.blocks.map(([h, items]) => (
          <section key={h} className="glass p-5"><h2 className="h-display text-xl">{h}</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-stone-300">{items.map((x) => <li key={x}>{x}</li>)}</ul></section>))}
      </div>
      <p className="mt-6 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-amber-100">{c.demo}</p>
    </div>
  );
}
