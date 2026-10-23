import React from "react";

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
  const here = CACHETTES.filter(c => c.spot === spot && c.when(now));
  if (!here.length) return null;
  return (
    <div aria-hidden="true" style={{ textAlign: side, lineHeight: 1, padding: "4px", pointerEvents: "none" }}>
      {here.map(c => <span key={c.egg} data-egg={c.egg} style={{ display: "inline-block", fontSize: 9, opacity: 0.16, cursor: "default",
        userSelect: "none", WebkitUserSelect: "none", pointerEvents: "auto", padding: 4, margin: "0 6px" }}>{c.e}</span>)}
    </div>
  );
}
