// Les vibrations (07/11/2026). Dans l'appli Android, le pont natif (window.BambuScan) sait tout faire : motifs avec
// force, boucle, effets du telephone, compositions, retour haptique de l'interface ; ailleurs, navigator.vibrate (Chrome
// sur Android : durees seulement ; iPhone : rien). Une ancienne appli sans ces methodes : on se replie sur ce qui existe.
//
//   haptic("ok")                 un effet nomme (EFFECTS ci-dessous)
//   vibrate("70:255,90,70:80")   un motif : ms (vibre), ms (pause)... ; « ms:force » (1-255) sur les vibrations
//   vibrateLoop(motif, depuis)   en boucle depuis l'index « depuis », jusqu'a stopVibrate()
//   compose("click:0.8:0,thud:1:120")  primitives du telephone (click, thud, spin, quick_rise, slow_rise, quick_fall,
//                                tick, low_tick) : nom:force(0-1):pause avant (ms)
//   uiHaptic("confirm")          retour de l'interface, suit le reglage systeme « vibrations au toucher »
//   vibrateCaps()                ce que le telephone sait faire, null hors de l'appli

const bridge = () => (typeof window !== "undefined" ? window.BambuScan : null);
const has = name => { try { return typeof bridge()?.[name] === "function"; } catch { return false; } };
// « 70:255,90,70 » -> [70, 90, 70] pour navigator.vibrate (pas de force)
const plain = p => String(p).split(",").map(x => parseInt(x, 10)).filter(n => n >= 0);

export function vibrate(pattern) {
  try {
    if (has("vibrate")) return bridge().vibrate(String(pattern));
    navigator.vibrate?.(plain(pattern));
  } catch { /* pas de vibreur */ }
}

export function vibrateLoop(pattern, from = 0) {
  try {
    if (has("vibrateRepeat")) return bridge().vibrateRepeat(String(pattern), from);
    vibrate(pattern);                 // pas de boucle hors de l'appli : une fois
  } catch { /* pas de vibreur */ }
}

export function stopVibrate() {
  try { if (has("cancelVibrate")) bridge().cancelVibrate(); else navigator.vibrate?.(0); } catch { /* rien */ }
}

export function compose(spec, fallback = "25") {
  try { if (has("hapticCompose")) return bridge().hapticCompose(String(spec)); } catch { /* rien */ }
  vibrate(fallback);
}

export function uiHaptic(name, fallback = "15") {
  try { if (has("hapticView")) return bridge().hapticView(String(name)); } catch { /* rien */ }
  vibrate(fallback);
}

export function vibrateCaps() {
  try { return has("vibrateCaps") ? JSON.parse(bridge().vibrateCaps()) : null; } catch { return null; }
}

// les effets nommes : un endroit pour les regler tous ; chacun a un repli en motif simple
const EFFECTS = {
  tick:    () => (has("haptic") ? bridge().haptic("tick") : vibrate("12")),
  click:   () => (has("haptic") ? bridge().haptic("click") : vibrate("25")),
  ok:      () => compose("click:0.7:0,click:1:90", "70,90,70"),              // rangee, valide
  error:   () => compose("thud:1:0,thud:0.8:80,thud:0.6:80", "40,40,40,40,40"),
  heavy:   () => (has("haptic") ? bridge().haptic("heavy_click") : vibrate("60")),
  success: () => compose("quick_rise:0.6:0,click:1:60,click:0.8:80", "40,60,40,60,120"),  // un succes, un palier
  jackpot: () => vibrate("80:255,60,80:255,60,80:255,120,300:200"),          // la roue, le gros lot
};

export function haptic(name) {
  try { (EFFECTS[name] || EFFECTS.click)(); } catch { /* rien */ }
}
