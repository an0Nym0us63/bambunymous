import React, { useEffect, useMemo, useState } from "react";
import { useEggsFound } from "../eggs";
import { usePrinter } from "../store/printer";

// Des petites choses cachees qui n'apparaissent qu'a certains moments (24/10/2026) : un jour de
// l'annee, une saison, une heure. Chacune a sa place (spot) ; presque invisible, il suffit de la
// toucher (le guetteur commun des secrets lit data-egg, voir eggs.js).
const md = d => (d.getMonth() + 1) * 100 + d.getDate();          // 1031 pour le 31 octobre
const between = (d, a, b) => { const x = md(d); return a <= b ? x >= a && x <= b : x >= a || x <= b; };
const hour = (d, a, b) => { const h = d.getHours(); return a <= b ? h >= a && h < b : h >= a || h < b; };
// dimanche de Paques (calendrier gregorien, algorithme de Meeus)
function paques(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - dd - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
const nearEaster = d => Math.abs((d - paques(d.getFullYear())) / 86400000) <= 3;

export const CACHETTES = [
  // selon le jour
  { egg: "c_pumpkin", e: "🎃", spot: "objects", when: d => between(d, 1025, 1031) },
  { egg: "c_xmas_tree", e: "🎄", spot: "stats", when: d => between(d, 1201, 1224) },
  { egg: "c_easter_chick", e: "🐣", spot: "notifications", when: nearEaster },
  { egg: "c_valentine_heart", e: "💌", spot: "achievements", when: d => between(d, 207, 214) },
  { egg: "c_dead_leaf", e: "🍂", spot: "home", when: d => between(d, 1001, 1130) },
  { egg: "c_snowflake", e: "❄️", spot: "guide", when: d => between(d, 1221, 320) },
  { egg: "c_sakura", e: "🌸", spot: "makerworld", when: d => between(d, 320, 430) },
  { egg: "c_watermelon", e: "🍉", spot: "prints", when: d => between(d, 701, 831) },
  { egg: "c_april_fish", e: "🐟", spot: "settings", when: d => md(d) === 401 },
  { egg: "c_black_cat", e: "🐈‍⬛", spot: "filaments", when: d => d.getDay() === 5 && d.getDate() === 13 },
  // selon l'heure
  { egg: "c_morning_coffee", e: "☕", spot: "home", when: d => d.getDay() >= 1 && d.getDay() <= 5 && hour(d, 7, 9) },
  { egg: "c_lunch", e: "🍽️", spot: "objects", when: d => hour(d, 12, 13) },
  { egg: "c_snack", e: "🍪", spot: "filaments", when: d => hour(d, 16, 17) },
  { egg: "c_sunset", e: "🌇", spot: "stats", when: d => hour(d, 19, 21) },
  { egg: "c_bat", e: "🦇", spot: "notifications", when: d => hour(d, 0, 3) },
  { egg: "c_rooster", e: "🐓", spot: "makerworld", when: d => hour(d, 6, 7) },
  { egg: "c_sleepy", e: "😴", spot: "achievements", when: d => hour(d, 3, 5) },
  { egg: "c_new_year_toast", e: "🥂", spot: "home", when: d => (md(d) === 1231 && d.getHours() >= 20) || (md(d) === 101 && d.getHours() < 2) },
  { egg: "c_sunflower", e: "🌻", spot: "settings", when: d => between(d, 620, 622) },
  { egg: "c_pencil", e: "✏️", spot: "objects", when: d => between(d, 901, 907) },
  { egg: "c_brunch", e: "🥞", spot: "home", when: d => (d.getDay() === 0 || d.getDay() === 6) && hour(d, 9, 11) },
  { egg: "c_moon", e: "🌙", spot: "settings", when: d => hour(d, 22, 24) },
  { egg: "c_calendar", e: "🗓️", spot: "stats", when: d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate() },
  { egg: "c_gift", e: "🎁", spot: "achievements", when: d => d.getDate() === 1 },
  { egg: "c_broom", e: "🧹", spot: "notifications", when: d => d.getDay() === 1 && hour(d, 9, 12) },
  { egg: "c_turtle", e: "🐢", spot: "filaments", when: d => d.getDay() === 0 && hour(d, 14, 17) },
  { egg: "c_star", e: "⭐", spot: "guide", when: d => d.getDay() === 0 && hour(d, 21, 23) },
];

/** Les cachettes de cet endroit dont le moment est venu (lu a l'affichage). */
export default function Cachettes({ spot, side = "center" }) {
  const now = new Date();
  const found = useEggsFound(st => st.found);           // deja trouvees : elles disparaissent
  const here = CACHETTES.filter(c => c.spot === spot && c.when(now) && !found.has(c.egg));
  if (!here.length) return null;
  return (
    <div aria-hidden="true" style={{ textAlign: side, lineHeight: 1, padding: "4px", pointerEvents: "none" }}>
      {here.map(c => <span key={c.egg} data-egg={c.egg} style={{ display: "inline-block", fontSize: 9, opacity: 0.16, cursor: "default",
        userSelect: "none", WebkitUserSelect: "none", pointerEvents: "auto", padding: 4, margin: "0 6px" }}>{c.e}</span>)}
    </div>
  );
}

// Les cachettes posees DANS les elements (24/10/2026) : l'en-tete d'une tuile (« tile:Stock »), d'une fenetre
// (« zoom:Stock »), la barre du haut (« header »), celle du bas (« nav »), une fiche. Certaines toujours la,
// d'autres a certains moments (when). Plus en bas de page : la ou on ne les attend pas.
// au hasard, comme la fourmi : certaines heures seulement (environ une sur n), la meme toute l'heure
// (elle ne clignote pas d'un affichage a l'autre)
const lucky = (egg, n, d) => { const k = `${egg}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
  let h = 2166136261; for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % n === 0; };
export const HIDES = [
  { egg: "c_mouse", e: "🐁", at: "tile:Stock", when: d => lucky("c_mouse", 4, d) },
  { egg: "c_bee", e: "🐝", at: "tile:Séchage", when: d => between(d, 320, 920) && hour(d, 9, 18) },
  { egg: "c_penguin", e: "🐧", at: "tile:Humidité des AMS", when: d => between(d, 1201, 228) },
  { egg: "c_parrot", e: "🦜", at: "tile:Le fil du jour", when: d => hour(d, 8, 11) },
  { egg: "c_frame", e: "🗾", at: "tile:Galerie", when: d => lucky("c_frame", 4, d) },
  { egg: "c_crown", e: "🤴", at: "tile:Succès", when: d => lucky("c_crown", 5, d) },
  { egg: "c_dice_small", e: "🀄", at: "tile:Roue et clés", when: d => lucky("c_dice_small", 6, d) },
  { egg: "c_sandglass", e: "⌛", at: "tile:Fin d'impression", when: d => hour(d, 0, 6) },
  { egg: "c_thermo", e: "🌡️", at: "tile:Températures" },
  { egg: "c_dart", e: "🏹", at: "tile:Objectif", when: d => d.getDate() <= 3 },
  { egg: "c_rainbow", e: "🪅", at: "tile:Couleurs chargées", when: d => lucky("c_rainbow", 4, d) },
  { egg: "c_piggy", e: "🐷", at: "tile:Objets et ventes", when: d => d.getDay() === 0 || d.getDay() === 6 },
  { egg: "c_fox", e: "🦊", at: "tile:Copains", when: d => hour(d, 18, 21) },
  { egg: "c_medal_tiny", e: "🎖️", at: "tile:Classement des copains", when: d => lucky("c_medal_tiny", 4, d) },
  { egg: "c_satellite", e: "🛰️", at: "tile:MakerWorld", when: d => hour(d, 22, 2) },
  { egg: "c_film", e: "📽️", at: "tile:Caméra", when: d => hour(d, 20, 24) },
  { egg: "c_train", e: "🚂", at: "tile:Aiguillage", when: d => lucky("c_train", 4, d) },
  { egg: "c_crab", e: "🦞", at: "tile:Tête d'impression", when: d => between(d, 701, 831) },
  { egg: "c_siren", e: "🚨", at: "tile:Alertes" },
  { egg: "c_pin", e: "📌", at: "tile:À faire", when: d => d.getDay() === 1 },
  { egg: "c_whale", e: "🐳", at: "zoom:Stock", when: d => between(d, 1101, 1231) && hour(d, 7, 12) },
  { egg: "c_cactus", e: "🌵", at: "zoom:Séchage", when: d => between(d, 621, 920) && hour(d, 11, 15) },
  { egg: "c_octopus", e: "🦑", at: "zoom:Couleurs chargées" },
  { egg: "c_kite", e: "🪁", at: "zoom:Le fil du jour", when: d => between(d, 922, 1130) && hour(d, 13, 18) },
  { egg: "c_unicorn", e: "🦄", at: "zoom:Galerie", when: d => lucky("c_unicorn", 5, d) },
  { egg: "c_mountain", e: "🗻", at: "zoom:Objectif", when: d => d.getDay() === 1 && hour(d, 6, 12) },
  { egg: "c_chess", e: "♟️", at: "zoom:Classement des copains", when: d => d.getDay() === 0 && hour(d, 13, 19) },
  { egg: "c_scroll", e: "📜", at: "zoom:Succès" },
  { egg: "c_bird", e: "🐤", at: "header", when: d => hour(d, 5, 8) },
  { egg: "c_shell", e: "🐚", at: "nav", when: d => between(d, 701, 831) && (d.getDay() === 0 || d.getDay() === 6) },
  { egg: "c_mushroom", e: "🪸", at: "mw-sheet", when: d => between(d, 621, 920) && hour(d, 17, 22) },
  { egg: "c_feather", e: "🪶", at: "print-edit" },
  { egg: "c_gem", e: "💎", at: "object-edit" },
  { egg: "c_herb", e: "🌱", at: "filament-prints", when: d => between(d, 320, 620) },
  { egg: "c_ice_cream", e: "🍦", at: "tile:Aujourd'hui", when: d => between(d, 621, 831) && hour(d, 14, 18) },
  { egg: "c_umbrella", e: "🌂", at: "zoom:Humidité des AMS", when: d => between(d, 922, 1220) && (d.getDay() === 0 || d.getDay() === 6) },
  { egg: "c_tea", e: "🍵", at: "tile:Dernières impressions", when: d => d.getDay() >= 1 && d.getDay() <= 5 && hour(d, 15, 16) },
  { egg: "c_cheese", e: "🧀", at: "zoom:Stock", when: d => d.getDay() === 5 && hour(d, 18, 21) },
  { egg: "c_fireworks", e: "🎇", at: "header", when: d => (md(d) === 713 || md(d) === 714) && d.getHours() >= 21 },
  { egg: "c_croissant", e: "🥖", at: "nav", when: d => (d.getDay() === 0 || d.getDay() === 6) && hour(d, 7, 10) },
  { egg: "c_mitten", e: "🧤", at: "tile:Températures", when: d => between(d, 1201, 228) && hour(d, 6, 9) },
  { egg: "c_sunglasses", e: "😎", at: "tile:Série", when: d => between(d, 701, 831) },
  { egg: "c_bunny", e: "🐰", at: "zoom:Galerie", when: nearEaster },
  { egg: "c_ghost", e: "💀", at: "tile:Alertes", when: d => (md(d) === 1031 && d.getHours() >= 20) || (md(d) === 1101 && d.getHours() < 3) },
  { egg: "c_candy", e: "🍬", at: "tile:À évaluer", when: d => d.getDay() === 3 && hour(d, 13, 18) },
  { egg: "c_lantern", e: "🏮", at: "zoom:Le fil du jour", when: d => between(d, 121, 220) && hour(d, 18, 23) },
  { egg: "c_wave", e: "🐬", at: "tile:MakerWorld", when: d => between(d, 801, 820) },
  { egg: "c_mask", e: "🤡", at: "tile:Copains", when: d => between(d, 210, 310) },
  { egg: "c_xmas_bell", e: "🦌", at: "tile:Le fil du jour", when: d => md(d) === 1224 || md(d) === 1225 },
  { egg: "c_sparkles", e: "🪐", at: "header", when: d => d.getHours() === d.getMinutes() },
];

/** Les cachettes de cet emplacement dont le moment est venu, en ligne, presque invisibles. */
export function Hide({ at, size = 10, style }) {
  const found = useEggsFound(st => st.found);
  const now = new Date();
  const here = HIDES.filter(c => c.at === at && (!c.when || c.when(now)) && !found.has(c.egg));
  if (!here.length) return null;
  return <>{here.map(c => <span key={c.egg} data-egg={c.egg} aria-hidden="true" onClick={e => e.stopPropagation()}
    style={{ display: "inline-block", fontSize: size, lineHeight: 1, opacity: 0.2, cursor: "default", userSelect: "none", WebkitUserSelect: "none",
      padding: "2px 3px", margin: "0 2px", flexShrink: 0, ...style }}>{c.e}</span>)}</>;
}


// (12/11/2026) les cachettes qu'on peut trouver EN CE MOMENT (celles qui dependent du jour ou de l'heure, pas encore
// trouvees) : l'avatar le signale, le menu du profil les compte, la page Succes les met en avant
// (12/11/2026) et celles qui dependent de l'etat de l'imprimante (dans sa fenetre, sur l'accueil) : le compte bouge avec
// elle -- une impression qui se termine, une pause, l'imprimante injoignable. Sans etat connu, elles ne comptent pas.
const fullMoon = d => {
  const age = (((d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % 29.530588853 + 29.530588853) % 29.530588853;
  return age > 14.3 && age < 15.3;
};
const LIVE = ["RUNNING", "PAUSE", "PAUSED", "PREPARE", "SLICING"];
export const STATE_HIDES = [
  { egg: "owl", when: d => hour(d, 22, 5) },
  { egg: "c_wolf", when: d => hour(d, 21, 5) && fullMoon(d) },
  { egg: "c_spider", when: (d, s) => !!s && !s.connected },
  { egg: "c_finish_flag", when: (d, s) => !!s && s.live && s.pct >= 99 },
  { egg: "c_sloth", when: (d, s) => !!s && s.live && s.left > 720 },
  { egg: "c_pause", when: (d, s) => !!s && s.paused },
];

export function activeCachettes(now = new Date(), found = new Set(), printer = null) {
  return [...CACHETTES, ...HIDES.filter(h => h.when), ...STATE_HIDES].filter(c => c.when(now, printer) && !found.has(c.egg));
}

// l'etat de l'imprimante reduit a ce que les cachettes regardent (le compte ne se refait pas a chaque degre de buse)
const printerKey = st => {
  if (!st) return "";
  const s = String(st.status || "").toUpperCase();
  return [st.connected ? 1 : 0, LIVE.includes(s) ? 1 : 0, s === "PAUSE" || s === "PAUSED" ? 1 : 0,
    Math.round(st.progress || 0) >= 99 ? 1 : 0, (st.remaining_minutes || 0) > 720 ? 1 : 0].join("");
};

export function useActiveCachettes(on = true) {
  const found = useEggsFound(st => st.found);
  const pk = usePrinter(st => printerKey(st.status));
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const i = setInterval(() => setT(Date.now()), 60000);
    return () => clearInterval(i);
  }, [on]);
  return useMemo(() => {
    if (!on) return [];
    const p = pk ? { connected: pk[0] === "1", live: pk[1] === "1", paused: pk[2] === "1", pct: pk[3] === "1" ? 100 : 0, left: pk[4] === "1" ? 721 : 0 } : null;
    return activeCachettes(new Date(t), found, p);
  }, [t, found, on, pk]);
}
