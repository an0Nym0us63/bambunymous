// Les sons de la fete des cartes, fabriques sur place (Web Audio) : aucun fichier.
// Rien ne joue avant un geste (le navigateur l'interdit) : unlock() se fait au
// toucher qui retourne la carte. Coupables : le choix reste sur cet appareil.
let ac = null;
const MUTE = "bn_cardfx_mute";

export function muted() {
  try { return localStorage.getItem(MUTE) === "1"; } catch { return false; }
}
export function setMuted(v) {
  try { localStorage.setItem(MUTE, v ? "1" : "0"); } catch { /* rien */ }
  if (ac?._m) ac._m.gain.value = v ? 0 : 0.55;
}
export function unlock() {
  if (!ac) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { ac = new C(); } catch { return null; }
  }
  if (ac.state === "suspended") ac.resume().catch(() => {});
  if (!ac._m) {
    ac._m = ac.createGain();
    ac._m.gain.value = muted() ? 0 : 0.55;
    const comp = ac.createDynamicsCompressor();
    ac._m.connect(comp);
    comp.connect(ac.destination);
  }
  return ac;
}
const now = () => ac.currentTime + 0.02;
const midi = n => 440 * Math.pow(2, (n - 69) / 12);

function tone(f, t, dur, { type = "sine", vol = 0.3, attack = 0.005, filter = 0, to = 0 } = {}) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (filter) {
    const fl = ac.createBiquadFilter();
    fl.type = "lowpass"; fl.frequency.value = filter;
    o.connect(fl); fl.connect(g);
  } else o.connect(g);
  g.connect(ac._m);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(t, dur, { vol = 0.2, hp = 1000, lp = 0 } = {}) {
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const s = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter();
  s.buffer = buf;
  f.type = lp ? "lowpass" : "highpass"; f.frequency.value = lp || hp;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(ac._m);
  s.start(t); s.stop(t + dur + 0.02);
}
const bell = (f, t, vol = 0.25) => {
  tone(f, t, 1.3, { vol }); tone(f * 2.76, t, 0.6, { vol: vol * 0.3 }); tone(f * 5.4, t, 0.3, { vol: vol * 0.12 });
};
const brass = (f, t, dur, vol = 0.16) => {
  tone(f, t, dur, { type:"sawtooth", vol, attack:0.03, filter:2400 });
  tone(f * 1.004, t, dur, { type:"sawtooth", vol: vol * 0.7, attack:0.04, filter:1800 });
};
const coins = (t, n, span) => {
  for (let i = 0; i < n; i++) {
    const at = t + Math.random() * span, f = 1900 + Math.random() * 1500;
    tone(f, at, 0.18, { type:"triangle", vol:0.09 }); tone(f * 1.5, at + 0.03, 0.15, { type:"triangle", vol:0.05 });
  }
};
const fanfare = (t, big) => {
  [67, 72, 76].forEach((n, i) => brass(midi(n), t + i * 0.13, 0.16));
  brass(midi(79), t + 0.39, big ? 1.4 : 0.7, 0.2);
  if (big) {
    [72, 76, 79, 84].forEach(n => brass(midi(n), t + 0.39, 1.5, 0.08));
    noise(t + 0.39, 1.8, { vol:0.18, hp:5000 });              // cymbale
  }
};

const safe = f => (...a) => { if (!unlock()) return; try { f(...a); } catch { /* son impossible : la fete continue */ } };

export const sTick = safe(() => tone(2100, now(), 0.04, { type:"triangle", vol:0.12 }));
export const sWhoosh = safe(() => noise(now(), 0.35, { vol:0.14, hp:1400 }));
export const sBoom = safe(() => {
  const t = now();
  tone(140, t, 0.6, { vol:0.35, to:38 }); noise(t, 0.5, { vol:0.12, lp:900 });
  for (let i = 0; i < 6; i++) noise(t + 0.25 + Math.random() * 0.5, 0.06, { vol:0.05, hp:4000 });   // crepitement
});
// le roulement qui precede l'As et le Joker d'or
export const sRoll = safe(dur => {
  const t = now();
  for (let x = 0; x < dur; x += 0.045) noise(t + x, 0.05, { vol: 0.03 + 0.12 * (x / dur), hp:700 });
});
// ce que joue une carte en se retournant, a la mesure de son rang (0 Valet … 7 Joker d'or)
export const sCard = safe((lvl, small = false) => {
  const t = now();
  if (small) { bell(midi(84 + Math.min(lvl, 7)), t, 0.14); return; }
  if (lvl === 0) bell(midi(84), t);
  else if (lvl === 1) [72, 76, 79, 84].forEach((n, i) => bell(midi(n), t + i * 0.09, 0.2));
  else if (lvl === 2) fanfare(t, false);
  else if (lvl === 3) fanfare(t, true);
  else if (lvl < 7) { coins(t, 10 + (lvl - 3) * 6, 1.4); [76, 79, 84].forEach(n => bell(midi(n), t + 0.1, 0.13)); }
  else { fanfare(t, true); coins(t + 0.3, 40, 2.5); }
});
// la fete des grades (26/10/2026) : un echelon, une montee de clochettes ; un nouveau grade, le roulement,
// le coup, la grande fanfare et la pluie de pieces (la legende : plus long encore)
export const sGrade = safe((promo, legend = false) => {
  const t = now();
  if (!promo) {
    [72, 76, 79, 84, 88].forEach((n, i) => bell(midi(n), t + i * 0.08, 0.16));
    coins(t + 0.35, 8, 0.7);
    return;
  }
  for (let x = 0; x < 0.9; x += 0.045) noise(t + x, 0.05, { vol: 0.03 + 0.12 * (x / 0.9), hp: 700 });
  tone(140, t + 0.9, 0.6, { vol: 0.35, to: 38 }); noise(t + 0.9, 0.5, { vol: 0.12, lp: 900 });
  fanfare(t + 1.0, true);
  coins(t + 1.3, legend ? 60 : 30, legend ? 3 : 2);
  if (legend) [84, 88, 91, 96].forEach((n, i) => bell(midi(n), t + 2.2 + i * 0.12, 0.14));
});
