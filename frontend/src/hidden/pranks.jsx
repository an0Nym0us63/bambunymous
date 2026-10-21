import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Farces (22/10/2026) : des effets montes PAR-DESSUS la page d'accueil.
// Contrat : PRANKS[slug] = { label, Effect } ; Effect recoit `done`, a appeler
// une seule fois quand la farce est reussie ou terminee (le parent demonte
// l'effet environ 1,5 s plus tard).
// Tout ce qui touche au DOM de l'appli passe par le controleur `ctl` (styles
// inline, textes, animations, minuteries, ecouteurs) : au demontage, ou si la
// page change en cours de route, tout est remis exactement comme avant.
// Les calques sont rendus en JSX dans un calque fixe (z-index 3500), qui ne
// bloque rien sauf quand la farce l'exige.

const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBounce = x => {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};
const shuffle = arr => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
};
const vw = () => window.innerWidth;
const vh = () => window.innerHeight;
const isNarrow = () => window.innerWidth < 768;
// Le "sol" : au-dessus de la barre de navigation basse sur mobile
const floorY = () => vh() - (isNarrow() ? 86 : 14);
const prefersReduced = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
};
const isLight = () => document.documentElement.getAttribute("data-theme") === "light";
const FILAMENTS = ["#f97316", "#22c55e", "#ec4899", "#3b82f6", "#eab308", "#a855f7", "#ef4444", "#14b8a6"];

// Termine proprement une animation en boucle : elle finit son tour en cours.
function endLoop(a) {
  if (!a) return;
  try {
    const it = a.effect.getComputedTiming().currentIteration;
    a.effect.updateTiming({ iterations: (it || 0) + 1 });
  } catch (e) { try { a.cancel(); } catch (e2) { /* rien */ } }
}

// ── Controleur : toute modification du DOM de l'appli passe par lui ─────────
function makeCtl(layerRef) {
  const styles = new Map();   // el -> { css, had, props: { nom: [valeur, priorite] }, last }
  const texts = new Map();    // noeud texte -> { orig, last }
  const anims = new Set();
  const timers = new Set();
  const loops = new Set();
  const offs = [];
  const extra = [];

  const ctl = {
    dead: false,
    main: () => document.querySelector("main.page-content"),
    layer: () => layerRef.current,

    // Les blocs de la page qui ne contiennent pas notre calque (on peut les
    // transformer sans emporter le calque, ni en faire un bloc conteneur).
    parts() {
      const main = ctl.main();
      if (!main) return [];
      const layer = layerRef.current;
      const out = [];
      const walk = (el, depth) => {
        for (const c of Array.from(el.children)) {
          if (c === layer || c.tagName === "STYLE" || c.tagName === "SCRIPT") continue;
          if (c.hasAttribute && c.hasAttribute("data-prank-layer")) continue;
          if (layer && c.contains(layer)) { if (depth < 8) walk(c, depth + 1); }
          else out.push(c);
        }
      };
      walk(main, 0);
      return out;
    },

    // Les morceaux de la page qui bougent chacun de leur cote : dans chaque
    // tuile, on descend jusqu'aux elements « atomes » (case d'AMS, bobine,
    // vignette, ligne ou mot de texte, puce, barre…). Repli : les tuiles.
    cards(max = 60) {
      const tiles = ctl.tiles(30);
      const layer = layerRef.current;
      const H = vh();
      const out = [];
      const SKIP = /^(STYLE|SCRIPT|TEMPLATE|BR|NOSCRIPT)$/;
      const ATOM = /^(svg|IMG|CANVAS|VIDEO|BUTTON|INPUT|SELECT|TEXTAREA|PROGRESS)$/;
      const visit = (el, depth) => {
        for (const c of Array.from(el.children)) {
          if (out.length >= max * 3) return;
          if (SKIP.test(c.tagName) || c === layer || (layer && c.contains(layer))) continue;
          if (c.hasAttribute("data-prank-layer")) continue;
          const r = c.getBoundingClientRect();
          if (r.width < 6 || r.height < 6 || r.bottom < -40 || r.top > H + 40) {
            // conteneur sans boite propre (display: contents) : on regarde dedans
            if (r.width === 0 && r.height === 0 && c.children.length && depth < 14) visit(c, depth + 1);
            continue;
          }
          const area = r.width * r.height;
          const kids = Array.from(c.children).filter(k => !SKIP.test(k.tagName)).length;
          if (c.hasAttribute("data-pk") || ATOM.test(c.tagName) || !kids || depth >= 14 || (area <= 9000 && kids < 4)) out.push(c);
          else visit(c, depth + 1);
        }
      };
      tiles.forEach(t => visit(t, 0));
      if (!out.length) return tiles.slice(0, max);
      // trop de morceaux : on en garde un sur k, repartis sur toute la page
      const k = Math.max(1, Math.ceil(out.length / max));
      const pick = out.filter((_, i) => i % k === 0).slice(0, max);
      // un element en ligne ne se transforme pas : on le passe en bloc en ligne
      pick.forEach(el => { if (getComputedStyle(el).display === "inline") ctl.set(el, { display: "inline-block" }); });
      return pick;
    },

    // Tuiles de premier niveau visibles a l'ecran (repli : blocs de la page).
    tiles(max = 30) {
      const main = ctl.main();
      if (!main) return [];
      const layer = layerRef.current;
      const H = vh();
      const all = Array.from(main.querySelectorAll(".card")).filter(el => {
        if (layer && (layer.contains(el) || el.contains(layer))) return false;
        const up = el.parentElement && el.parentElement.closest(".card");
        return !(up && main.contains(up));
      });
      const vis = all.filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > -40 && r.top < H + 40;
      });
      if (vis.length) return vis.slice(0, max);
      return ctl.parts().filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < H;
      }).slice(0, max);
    },

    // Noeuds texte (avec des lettres) proches de l'ecran.
    textNodes(max = 1200, margin = 150) {
      const main = ctl.main();
      if (!main) return [];
      const layer = layerRef.current;
      const H = vh();
      const out = [];
      const seen = new Map();
      const w = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = w.nextNode()) && out.length < max) {
        const p = n.parentElement;
        if (!p || (layer && layer.contains(p))) continue;
        if (!/\p{L}/u.test(n.data)) continue;
        if (p.closest("script,style,textarea,select,option,svg,[contenteditable='true'],[data-prank-layer]")) continue;
        let r = seen.get(p);
        if (!r) { r = p.getBoundingClientRect(); seen.set(p, r); }
        if (r.width === 0 || r.bottom < -margin || r.top > H + margin) continue;
        out.push(n);
      }
      return out;
    },

    // transform-origin qui place le pivot au centre de l'ecran.
    originOf(el, cx = vw() / 2, cy = vh() / 2) {
      const r = el.getBoundingClientRect();
      return `${(cx - r.left).toFixed(1)}px ${(cy - r.top).toFixed(1)}px`;
    },

    // Style inline (noms en kebab-case), l'origine est memorisee.
    set(el, props) {
      if (!el || ctl.dead) return;
      let rec = styles.get(el);
      if (!rec) {
        rec = { css: el.style.cssText, had: el.hasAttribute("style"), props: {}, last: null };
        styles.set(el, rec);
      }
      for (const k of Object.keys(props)) {
        if (!(k in rec.props)) rec.props[k] = [el.style.getPropertyValue(k), el.style.getPropertyPriority(k)];
        const v = props[k];
        if (v == null || v === "") el.style.removeProperty(k);
        else el.style.setProperty(k, v);
      }
      rec.last = el.style.cssText;
    },
    // Remet certaines proprietes a leur valeur d'origine.
    unset(el, names) {
      const rec = styles.get(el);
      if (!rec) return;
      for (const k of names) {
        if (!(k in rec.props)) continue;
        const [v, p] = rec.props[k];
        if (v) el.style.setProperty(k, v, p); else el.style.removeProperty(k);
      }
      rec.last = el.style.cssText;
    },

    anim(el, kf, opts) {
      if (!el || !el.animate || ctl.dead) return null;
      try { const a = el.animate(kf, opts); anims.add(a); return a; } catch (e) { return null; }
    },
    after(ms, fn) {
      if (ctl.dead) return;
      const id = setTimeout(() => { timers.delete(id); if (!ctl.dead) fn(); }, ms);
      timers.add(id);
    },
    // Boucle d'animation : fn(t en s depuis le debut, dt) ; rendre false l'arrete.
    loop(fn) {
      if (ctl.dead) return null;
      const h = { id: 0 };
      const t0 = performance.now();
      let last = t0;
      const tick = now => {
        if (ctl.dead) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (fn((now - t0) / 1000, dt) === false) { loops.delete(h); return; }
        h.id = requestAnimationFrame(tick);
      };
      h.id = requestAnimationFrame(tick);
      loops.add(h);
      return h;
    },
    on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      offs.push(() => target.removeEventListener(type, fn, opts));
    },
    // Texte d'un noeud. Rend false si React l'a change entre-temps (on le
    // laisse alors tranquille : sa nouvelle valeur devient la reference).
    text(node, str) {
      if (ctl.dead) return false;
      let rec = texts.get(node);
      if (!rec) { rec = { orig: node.data, last: node.data }; texts.set(node, rec); }
      else if (node.data !== rec.last) { rec.orig = node.data; rec.last = node.data; return false; }
      if (node.data !== str) node.data = str;
      rec.last = str;
      return true;
    },
    cleanup(fn) { extra.push(fn); },

    restore() {
      ctl.dead = true;
      timers.forEach(clearTimeout); timers.clear();
      loops.forEach(h => cancelAnimationFrame(h.id)); loops.clear();
      offs.splice(0).forEach(f => { try { f(); } catch (e) { /* rien */ } });
      extra.splice(0).forEach(f => { try { f(); } catch (e) { /* rien */ } });
      anims.forEach(a => { try { a.cancel(); } catch (e) { /* rien */ } }); anims.clear();
      styles.forEach((rec, el) => {
        try {
          if (el.style.cssText === rec.last) el.style.cssText = rec.css;
          else {
            for (const k of Object.keys(rec.props)) {
              const [v, p] = rec.props[k];
              if (v) el.style.setProperty(k, v, p); else el.style.removeProperty(k);
            }
          }
          if (!rec.had && !el.style.cssText) el.removeAttribute("style");
        } catch (e) { /* rien */ }
      });
      styles.clear();
      texts.forEach((rec, node) => { try { if (node.data === rec.last) node.data = rec.orig; } catch (e) { /* rien */ } });
      texts.clear();
    },
  };
  return ctl;
}

// Socle de chaque farce : calque, controleur, `finish` (done une seule fois),
// detection d'un changement de page (tout est remis, la farce s'efface).
function useStage(done) {
  const ref = useRef(null);
  const ctlRef = useRef(null);
  if (!ctlRef.current) ctlRef.current = makeCtl(ref);
  const ctl = ctlRef.current;
  const [reduced] = useState(prefersReduced);
  const [left, setLeft] = useState(false);
  const doneRef = useRef(done);
  doneRef.current = done;
  const fired = useRef(false);
  const finish = useCallback(() => {
    if (fired.current || ctl.dead) return;
    fired.current = true;
    if (typeof doneRef.current === "function") doneRef.current();
  }, [ctl]);
  useEffect(() => {
    ctl.dead = false;
    const main = ctl.main();
    let mo = null;
    if (main && window.MutationObserver) {
      const snap = Array.from(main.children);
      mo = new MutationObserver(() => {
        if (snap.some(n => !n.isConnected)) { mo.disconnect(); ctl.restore(); setLeft(true); }
      });
      mo.observe(main, { childList: true });
    }
    return () => { if (mo) mo.disconnect(); ctl.restore(); };
  }, [ctl]);
  return { ref, ctl, reduced, left, finish };
}

const KIT_CSS = `
.pk-caption { bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }
@media (min-width: 768px) { .pk-caption { bottom: calc(22px + env(safe-area-inset-bottom, 0px)); } }
@keyframes pk-kit-pill { from { opacity: 0; transform: translate(-50%, 14px) scale(.95) } to { opacity: 1; transform: translate(-50%, 0) scale(1) } }
@keyframes pk-kit-fadeout { 0%, 70% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-kit-fadein { from { opacity: 0 } to { opacity: 1 } }
@keyframes pk-kit-fade { from { opacity: 1 } to { opacity: 0 } }
@keyframes pk-kit-soft { 0% { opacity: 0 } 18%, 78% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-kit-spin { to { transform: rotate(360deg) } }
@keyframes pk-kit-pop { 0% { transform: scale(.3); opacity: 0 } 60% { transform: scale(1.12); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
@keyframes pk-kit-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
`;

function Layer({ s, css, children, style }) {
  return (
    <div ref={s.ref} data-prank-layer="" style={{ position: "fixed", inset: 0, zIndex: 3500, pointerEvents: "none",
      overflow: "hidden", fontFamily: FONT, WebkitTapHighlightColor: "transparent", ...style }}>
      <style>{KIT_CSS + (css || "")}</style>
      {!s.left && children}
    </div>
  );
}

// Legende d'une farce : petite carte discrete en bas d'ecran, dans le style des
// notifications de l'appli (fond du theme, liseré violet), au-dessus de la barre
// mobile. Elle accompagne ce qui se passe sans jamais le masquer.
function Pill({ children, fade, style }) {
  const anim = "pk-kit-pill .45s cubic-bezier(.2,1.3,.4,1) both" + (fade ? ", pk-kit-fadeout 3.4s ease .2s both" : "");
  return (
    <div role="status" className="pk-caption" style={{ position: "absolute", left: "50%",
      transform: "translateX(-50%)", width: "max-content", maxWidth: "min(380px, calc(100vw - 32px))",
      display: "flex", alignItems: "center", gap: 8, padding: "7px 12px 7px 9px", borderRadius: 12,
      background: "color-mix(in srgb, var(--sheet-bg, #1e293b) 86%, transparent)",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      color: "var(--text, #f1f5f9)", fontWeight: 600, fontSize: 12.5, lineHeight: 1.35, textAlign: "left",
      fontFamily: FONT, border: "1px solid rgba(139,92,246,0.45)",
      boxShadow: "0 6px 18px rgba(0,0,0,.22), 0 0 0 3px rgba(139,92,246,.10)",
      animation: anim, pointerEvents: "none", zIndex: 40, ...style }}>
      <span aria-hidden="true" style={{ fontSize: 13, flexShrink: 0 }}>🌀</span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}
const GiveUp = () => <Pill key="rendu" fade>Une autre fois… 🙂</Pill>;

// Version douce (prefers-reduced-motion) des farces tres animees.
function Soft({ done, emoji, text, tint, end }) {
  const s = useStage(done);
  const [fin, setFin] = useState(false);
  useEffect(() => { s.ctl.after(5200, () => { setFin(true); s.finish(); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s}>
      <div style={{ position: "absolute", inset: 0, background: tint, animation: "pk-kit-soft 5.4s ease both" }}/>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: "38%", textAlign: "center",
        fontSize: 64, animation: "pk-kit-soft 5.4s ease both" }}>{emoji}</div>
      {!fin ? <Pill key="a">{text}</Pill> : <Pill key="b" fade>{end || "Tout est rentré dans l'ordre."}</Pill>}
    </Layer>
  );
}
function softly(Comp, spec) {
  function Gentle(props) {
    const [reduced] = useState(prefersReduced);
    return reduced ? <Soft {...props} {...spec}/> : <Comp {...props}/>;
  }
  return Gentle;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Tsunami
// ════════════════════════════════════════════════════════════════════════════
const TSUNAMI_CSS = `
@keyframes pk-tsunami-in { from { transform: translateX(-125%) } to { transform: translateX(0) } }
@keyframes pk-tsunami-out { from { transform: translateY(0) } to { transform: translateY(112%) } }
@keyframes pk-tsunami-surf { from { transform: translateX(0) } to { transform: translateX(-50%) } }
@keyframes pk-tsunami-bubble { 0% { transform: translate(0, 0) scale(.5); opacity: 0 } 12% { opacity: .9 }
  100% { transform: translate(var(--dx), -92vh) scale(1.15); opacity: 0 } }
@keyframes pk-tsunami-ray { 0%, 100% { opacity: .08; transform: skewX(-18deg) translateX(0) } 50% { opacity: .24; transform: skewX(-18deg) translateX(34px) } }
@keyframes pk-tsunami-curl { 0%, 100% { transform: rotate(0deg) } 50% { transform: rotate(-5deg) translateY(-8px) } }
`;
const SURF_D = (() => {
  let d = "M0 26";
  for (let i = 0; i < 24; i++) d += ` Q${i * 50 + 25} ${i % 2 ? 40 : 8} ${i * 50 + 50} 26`;
  return d;
})();

function Tsunami({ done }) {
  const s = useStage(done);
  const [phase, setPhase] = useState("in");
  const bubbles = useMemo(() => Array.from({ length: 30 }, () => ({
    left: rand(2, 98), size: rand(5, 18), delay: rand(1.2, 5), dur: rand(2.4, 4.4), dx: rand(-40, 40) })), []);
  useEffect(() => {
    const { ctl } = s;
    const parts = ctl.parts();
    const sways = [];
    ctl.after(1000, () => {
      parts.forEach(p => {
        ctl.set(p, { filter: "url(#pk-tsunami-f) saturate(1.25) blur(.4px)" });
        sways.push(ctl.anim(p, [{ transform: "translate(0,0)" }, { transform: "translate(5px,-4px) skewX(.6deg)" },
          { transform: "translate(-5px,3px) skewX(-.5deg)" }, { transform: "translate(0,0)" }],
          { duration: 2200, iterations: Infinity, easing: "ease-in-out" }));
      });
    });
    ctl.after(5900, () => { setPhase("out"); sways.forEach(endLoop); });
    ctl.after(6600, () => parts.forEach(p => ctl.unset(p, ["filter"])));
    ctl.after(7600, () => { setPhase("fin"); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const water = "rgba(56,189,248,.42)";
  return (
    <Layer s={s} css={TSUNAMI_CSS}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <filter id="pk-tsunami-f" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.022" numOctaves="2" seed="4">
            <animate attributeName="baseFrequency" dur="4s" values="0.008 0.022;0.011 0.03;0.008 0.022" repeatCount="indefinite"/>
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="16"/>
        </filter>
      </svg>
      {phase !== "fin" && (
        <div style={{ position: "absolute", inset: 0, animation: phase === "in"
          ? "pk-tsunami-in 1.5s cubic-bezier(.3,.05,.25,1) both" : "pk-tsunami-out 1.6s cubic-bezier(.5,0,.75,.2) both" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: "9vh", bottom: 0,
            background: `linear-gradient(180deg, ${water}, rgba(14,116,144,.52) 55%, rgba(8,47,73,.68))` }}/>
          <div style={{ position: "absolute", left: 0, top: "calc(9vh - 40px)", height: 40, width: "200%",
            animation: "pk-tsunami-surf 3.2s linear infinite" }}>
            <svg width="100%" height="40" viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true">
              <path d={SURF_D + " L1200 40 L0 40 Z"} fill={water}/>
              <path d={SURF_D} fill="none" stroke="rgba(255,255,255,.75)" strokeWidth="3" vectorEffect="non-scaling-stroke"/>
            </svg>
          </div>
          {[12, 34, 58, 80].map((l, i) => (
            <div key={i} style={{ position: "absolute", top: "9vh", left: `${l}%`, width: 70, height: "70vh",
              background: "linear-gradient(180deg, rgba(255,255,255,.55), transparent)", filter: "blur(6px)",
              animation: `pk-tsunami-ray ${3 + i * .6}s ease-in-out ${i * .4}s infinite` }}/>
          ))}
          <svg style={{ position: "absolute", right: -150, top: "9vh", height: "91vh", width: 160 }}
            viewBox="0 0 150 1000" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 0 C 60 30, 120 90, 110 200 C 100 320, 40 380, 70 520 C 95 640, 140 700, 120 820 C 105 900, 60 960, 70 1000 L0 1000 Z"
              fill="rgba(56,189,248,.5)" stroke="rgba(255,255,255,.8)" strokeWidth="3" vectorEffect="non-scaling-stroke"/>
          </svg>
          <svg style={{ position: "absolute", right: -200, top: "calc(9vh - 200px)", width: 260, height: 220,
            transformOrigin: "0% 100%", animation: "pk-tsunami-curl 1.4s ease-in-out infinite" }}
            viewBox="0 0 260 220" aria-hidden="true">
            <defs>
              <linearGradient id="pk-tsunami-g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#7dd3fc" stopOpacity=".85"/>
                <stop offset="1" stopColor="#0ea5e9" stopOpacity=".55"/>
              </linearGradient>
            </defs>
            <path d="M0 220 L0 190 C 30 120, 110 30, 190 26 C 238 24, 258 62, 236 92 C 220 112, 190 108, 186 90 C 183 76, 196 70, 204 76 C 196 56, 160 58, 146 86 C 128 124, 140 180, 160 220 Z"
              fill="url(#pk-tsunami-g)"/>
            <path d="M0 190 C 30 120, 110 30, 190 26 C 238 24, 258 62, 236 92" fill="none" stroke="#fff" strokeWidth="6"
              strokeLinecap="round" opacity=".9"/>
            {[[200, 14, 5], [226, 20, 4], [176, 12, 3.5], [244, 40, 4], [150, 24, 3], [214, 6, 2.5]].map(([x, y, r], i) => (
              <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity=".85"/>
            ))}
          </svg>
          {bubbles.map((b, i) => (
            <span key={i} style={{ position: "absolute", left: `${b.left}%`, bottom: -20, width: b.size, height: b.size,
              borderRadius: "50%", border: "1.5px solid rgba(255,255,255,.7)", background: "rgba(255,255,255,.12)",
              "--dx": `${b.dx}px`, animation: `pk-tsunami-bubble ${b.dur}s ease-in ${b.delay}s infinite both` }}/>
          ))}
        </div>
      )}
      {phase === "in" && <Pill key="a" top>🌊 Alerte humidité : ton filament va boire la tasse !</Pill>}
      {phase === "fin" && <Pill key="b" fade>Ouf, tout est sec. Le PLA a eu chaud (enfin, froid).</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Seisme
// ════════════════════════════════════════════════════════════════════════════
const SEISME_CSS = `
@keyframes pk-seisme-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes pk-seisme-dust { 0% { transform: translate(0,0) scale(.4); opacity: .8 } 100% { transform: translate(var(--dx), var(--dy)) scale(1.4); opacity: 0 } }
`;
function Seisme({ done }) {
  const s = useStage(done);
  const [crack, setCrack] = useState(0); // 0 rien, 1 visible, 2 qui s'efface
  const [msg, setMsg] = useState(1);
  const geo = useMemo(() => {
    let x = rand(25, 70), y = -2;
    const pts = [[x, y]], br = [];
    while (y < 102) {
      y += rand(4, 9); x = clamp(x + rand(-7, 7), 5, 95); pts.push([x, y]);
      if (Math.random() < .3) {
        let bx = x, by = y; const b = [[bx, by]]; const dir = Math.random() < .5 ? -1 : 1;
        for (let k = 0; k < 3; k++) { bx += dir * rand(3, 8); by += rand(1, 5); b.push([bx, by]); }
        br.push(b);
      }
    }
    return { main: pts, br, dust: pts.filter((_, i) => i % 3 === 1).map(p => ({ x: p[0], y: p[1], dx: rand(-40, 40), dy: rand(-30, 20) })) };
  }, []);
  const toD = pts => "M" + pts.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
  useEffect(() => {
    const { ctl } = s;
    const parts = ctl.parts();
    const cards = ctl.cards(60);
    const N = 80, kf = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const env = t < .62 ? Math.pow(t / .62, 1.6) : Math.pow(1 - (t - .62) / .38, 2);
      const a = 15 * env;
      kf.push({ transform: i === 0 || i === N ? "translate(0px,0px) rotate(0deg)"
        : `translate(${rand(-a, a).toFixed(1)}px,${rand(-a * .6, a * .6).toFixed(1)}px) rotate(${rand(-a * .07, a * .07).toFixed(2)}deg)` });
    }
    parts.forEach(p => ctl.anim(p, kf, { duration: 6200, easing: "linear" }));
    const offs = cards.map(() => ({ dx: rand(-20, 20), dy: rand(-10, 16), r: rand(-5, 5) }));
    ctl.after(2500, () => {
      setCrack(1);
      cards.forEach((c, i) => {
        const o = offs[i];
        ctl.anim(c, [{ transform: "none" }, { transform: `translate(${o.dx}px,${o.dy}px) rotate(${o.r}deg)` }],
          { duration: 420, delay: i * 30, easing: "cubic-bezier(.3,1.6,.5,1)", fill: "forwards" });
      });
    });
    ctl.after(5000, () => {
      setCrack(2);
      cards.forEach((c, i) => {
        const o = offs[i];
        ctl.anim(c, [{ transform: `translate(${o.dx}px,${o.dy}px) rotate(${o.r}deg)` }, { transform: "none" }],
          { duration: 900, delay: i * 25, easing: "cubic-bezier(.3,1.45,.5,1)", fill: "forwards" });
      });
    });
    ctl.after(6900, () => { setMsg(2); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={SEISME_CSS}>
      {crack > 0 && (
        <div style={{ position: "absolute", inset: 0, opacity: crack === 2 ? 0 : 1, transition: "opacity 1.2s ease" }}>
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {[geo.main, ...geo.br].map((pts, i) => (
              <g key={i}>
                <path d={toD(pts)} fill="none" stroke="rgba(0,0,0,.85)" strokeWidth={i ? 2.5 : 5} strokeLinejoin="bevel"
                  vectorEffect="non-scaling-stroke" pathLength="1" strokeDasharray="1"
                  style={{ animation: `pk-seisme-draw ${i ? .5 : .9}s ease-out ${i ? .4 + i * .05 : 0}s both` }}/>
                <path d={toD(pts)} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth={i ? .8 : 1.4}
                  vectorEffect="non-scaling-stroke" pathLength="1" strokeDasharray="1" transform="translate(.25 .15)"
                  style={{ animation: `pk-seisme-draw ${i ? .5 : .9}s ease-out ${i ? .4 + i * .05 : 0}s both` }}/>
              </g>
            ))}
          </svg>
          {geo.dust.map((d, i) => (
            <span key={i} style={{ position: "absolute", left: `${d.x}%`, top: `${d.y}%`, width: 26, height: 26, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(180,160,130,.7), transparent 70%)", "--dx": `${d.dx}px`, "--dy": `${d.dy}px`,
              animation: `pk-seisme-dust 1.4s ease-out ${(i * .07).toFixed(2)}s both` }}/>
          ))}
        </div>
      )}
      {msg === 1 && <Pill key="a" top>📈 Magnitude 7,2 sur l'échelle de Bambu !</Pill>}
      {msg === 2 && <Pill key="b" fade>Fin des répliques. Pense à refaire le nivellement du plateau.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Tete en bas
// ════════════════════════════════════════════════════════════════════════════
const TETE_CSS = `
@keyframes pk-tete-en-bas-wob { 0%, 100% { transform: translateX(-50%) rotate(-2deg) } 50% { transform: translateX(-50%) rotate(2deg) scale(1.04) } }
`;
function TeteEnBas({ done }) {
  const s = useStage(done);
  const [state, setState] = useState("flip"); // flip, wait, back
  const partsRef = useRef([]);
  const backed = useRef(false);
  const back = useCallback(() => {
    if (backed.current) return;
    backed.current = true;
    const { ctl } = s;
    setState("back");
    partsRef.current.forEach(p => {
      if (s.reduced) {
        ctl.anim(p, [{ opacity: 1, transform: "rotate(180deg)" }, { opacity: 0, transform: "rotate(180deg)", offset: .5 },
          { opacity: 0, transform: "rotate(0deg)", offset: .501 }, { opacity: 1, transform: "rotate(0deg)" }], { duration: 900, fill: "forwards" });
      } else {
        ctl.anim(p, [{ transform: "rotate(180deg) scale(1)" }, { transform: "rotate(270deg) scale(.82)", offset: .5 },
          { transform: "rotate(360deg) scale(1)" }], { duration: 1300, easing: "cubic-bezier(.6,0,.3,1)", fill: "forwards" });
      }
    });
    s.finish();
  }, [s]);
  useEffect(() => {
    const { ctl } = s;
    const parts = ctl.parts();
    partsRef.current = parts;
    parts.forEach(p => {
      ctl.set(p, { "transform-origin": ctl.originOf(p) });
      if (s.reduced) {
        ctl.anim(p, [{ opacity: 1, transform: "rotate(0deg)" }, { opacity: 0, transform: "rotate(0deg)", offset: .5 },
          { opacity: 0, transform: "rotate(180deg)", offset: .501 }, { opacity: 1, transform: "rotate(180deg)" }], { duration: 900, fill: "forwards" });
      } else {
        ctl.anim(p, [{ transform: "rotate(0deg) scale(1)" }, { transform: "rotate(90deg) scale(.82)", offset: .5 },
          { transform: "rotate(180deg) scale(1)" }], { duration: 1400, easing: "cubic-bezier(.6,0,.3,1)", fill: "forwards" });
      }
    });
    ctl.after(1300, () => setState("wait"));
    ctl.after(11300, back);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={TETE_CSS}>
      {state === "wait" && (
        <>
          <Pill key="a" top>🙃 Ton imprimante imprime au plafond ?</Pill>
          <button onClick={back} style={{ position: "absolute", left: "50%", bottom: "calc(150px + env(safe-area-inset-bottom, 0px))",
            transform: "translateX(-50%)", pointerEvents: "auto", padding: "14px 22px", borderRadius: 14, border: "none",
            background: "#22c55e", color: "#fff", fontWeight: 900, fontSize: 16, fontFamily: FONT, cursor: "pointer",
            boxShadow: "0 5px 0 #15803d, 0 14px 30px rgba(0,0,0,.4)", whiteSpace: "nowrap",
            animation: s.reduced ? "none" : "pk-tete-en-bas-wob 1.2s ease-in-out infinite" }}>
            Remettre à l'endroit
          </button>
        </>
      )}
      {state === "back" && <Pill key="b" fade>Voilà, tout est d'aplomb. La gravité te salue.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Panne de courant
// ════════════════════════════════════════════════════════════════════════════
const PANNE_CSS = `
@keyframes pk-panne-cut { 0% { opacity: 0 } 12% { opacity: .9 } 20% { opacity: .1 } 34% { opacity: 1 } 42% { opacity: .35 } 55%, 100% { opacity: 1 } }
@keyframes pk-panne-neon { 0% { opacity: 1 } 10% { opacity: 0 } 18% { opacity: .85 } 30% { opacity: 0 } 40% { opacity: .6 } 52% { opacity: 0 } 60% { opacity: .3 } 70%, 100% { opacity: 0 } }
@keyframes pk-panne-led { 0%, 100% { opacity: .15 } 50% { opacity: .75 } }
`;
function Panne({ done }) {
  const s = useStage(done);
  const [phase, setPhase] = useState("dark"); // dark, on, rendu
  const [led, setLed] = useState(false);
  const darkRef = useRef(null);
  const pos = useRef({ x: vw() / 2, y: vh() / 2 });
  const sw = useMemo(() => {
    let p = { x: 0, y: 0 };
    for (let k = 0; k < 40; k++) {
      p = { x: rand(.08, .9) * vw(), y: rand(.18, .82) * vh() };
      if (Math.hypot(p.x - vw() / 2, p.y - vh() / 2) > 170) break;
    }
    return p;
  }, []);
  const paint = useCallback(() => {
    const d = darkRef.current;
    if (!d) return;
    const { x, y } = pos.current;
    d.style.background = `radial-gradient(circle at ${x.toFixed(0)}px ${y.toFixed(0)}px, rgba(0,0,0,0) 0, rgba(0,0,0,0) 44px, rgba(0,0,0,.55) 82px, rgba(0,0,0,.93) 122px, #000 155px)`;
  }, []);
  useEffect(() => {
    paint();
    s.ctl.after(20000, () => setLed(true));
    s.ctl.after(45000, () => setPhase(p => (p === "dark" ? "rendu" : p)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const move = e => {
    if (phase !== "dark") return;
    pos.current = { x: e.clientX, y: e.clientY };
    paint();
  };
  const flip = e => {
    e.stopPropagation();
    if (phase !== "dark") return;
    setPhase("on");
    s.finish();
  };
  const on = phase !== "dark";
  return (
    <Layer s={s} css={PANNE_CSS}>
      <div onPointerMove={move} onPointerDown={move} style={{ position: "absolute", inset: 0,
        pointerEvents: phase === "dark" ? "auto" : "none", touchAction: "none", cursor: "crosshair" }}>
        {phase !== "rendu" && <button onClick={flip} aria-label="Interrupteur" style={{ position: "absolute", left: sw.x - 24, top: sw.y - 32,
          width: 48, height: 64, borderRadius: 9, border: "1px solid #cbd5e1", padding: 0, cursor: "pointer",
          background: "linear-gradient(160deg, #f8fafc, #d6dde6)", boxShadow: "0 3px 8px rgba(0,0,0,.35)",
          pointerEvents: phase === "dark" ? "auto" : "none", opacity: phase === "on" ? 0 : 1, transition: "opacity .6s ease .5s" }}>
          <span style={{ position: "absolute", left: 11, right: 11, top: 12, bottom: 12, borderRadius: 5,
            background: "linear-gradient(180deg, #e2e8f0, #f8fafc)", boxShadow: "inset 0 1px 3px rgba(0,0,0,.3)" }}/>
          <span style={{ position: "absolute", left: 13, right: 13, height: 18, borderRadius: 4,
            top: on ? 15 : 29, transition: "top .15s ease", background: on ? "#fde047" : "#94a3b8",
            boxShadow: on ? "0 0 10px #fde047" : "0 2px 2px rgba(0,0,0,.3)" }}/>
        </button>}
        <div ref={darkRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "#000",
          animation: phase === "dark" ? "pk-panne-cut .9s linear both" : phase === "on" ? "pk-panne-neon 1.1s linear both" : "pk-kit-fade 1s ease both" }}/>
        {led && phase === "dark" && (
          <span style={{ position: "absolute", left: sw.x - 3, top: sw.y + 22, width: 6, height: 6, borderRadius: "50%",
            background: "#f97316", boxShadow: "0 0 6px #f97316", animation: "pk-panne-led 1.6s ease-in-out infinite" }}/>
        )}
      </div>
      {phase === "dark" && (
        <Pill key="a" top style={{ background: "rgba(20,20,30,.6)" }}>⚡ Panne de courant ! Trouve l'interrupteur à tâtons…</Pill>
      )}
      {phase === "on" && <Pill key="b" fade>💡 Et la lumière fut ! (L'impression a repris à la couche 212.)</Pill>}
      {phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Melange des lettres
// ════════════════════════════════════════════════════════════════════════════
function scrambleWord(w) {
  const a = Array.from(w);
  for (let n = 0; n < 6; n++) { shuffle(a); if (a.join("") !== w) break; }
  return a.join("");
}
function Melange({ done }) {
  const s = useStage(done);
  const [msg, setMsg] = useState(1);
  useEffect(() => {
    const { ctl } = s;
    const items = [], words = [];
    ctl.textNodes(900, 200).forEach(node => {
      const data = node.data, segs = [];
      const re = /\p{L}{3,}/gu;
      let m, last = 0;
      while ((m = re.exec(data))) {
        if (m.index > last) segs.push({ o: data.slice(last, m.index) });
        const seg = { o: m[0], w: true, sc: m[0], ok: false };
        segs.push(seg);
        last = m.index + m[0].length;
      }
      if (last < data.length) segs.push({ o: data.slice(last) });
      const it = { node, segs, dead: false };
      items.push(it);
      segs.forEach(seg => { if (seg.w) words.push({ seg, it }); });
    });
    const render = it => {
      if (it.dead) return;
      const str = it.segs.map(x => (x.w && !x.ok ? x.sc : x.o)).join("");
      if (!ctl.text(it.node, str)) it.dead = true;
    };
    const mix = () => { words.forEach(w => { w.seg.sc = scrambleWord(w.seg.o); }); items.forEach(render); };
    mix();
    ctl.after(300, mix);
    ctl.after(650, mix);
    const order = shuffle(words.slice());
    let k = 0;
    ctl.after(1300, () => {
      ctl.loop(t => {
        const target = Math.round(order.length * easeInOut(clamp(t / 6.2, 0, 1)));
        const dirty = new Set();
        while (k < target) { const w = order[k++]; w.seg.ok = true; dirty.add(w.it); }
        dirty.forEach(render);
        if (k >= order.length) { setMsg(2); s.finish(); return false; }
        return true;
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s}>
      {msg === 1 && <Pill key="a" top>🔀 Le slicer a mélangé les couches… et les lettres.</Pill>}
      {msg === 2 && <Pill key="b" fade>Correcteur orthographique : mission accomplie.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Gravite
// ════════════════════════════════════════════════════════════════════════════
function Gravite({ done }) {
  const s = useStage(done);
  const [msg, setMsg] = useState(1);
  useEffect(() => {
    const { ctl } = s;
    const cards = ctl.cards(60);
    const floor = floorY();
    const fallIn = "cubic-bezier(.55,0,1,.45)", upOut = "cubic-bezier(0,.55,.45,1)";
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const d = Math.max(0, floor - r.bottom);
      const rot = rand(-8, 8);
      const at = (y, rr) => `translateY(${y.toFixed(1)}px) rotate(${rr.toFixed(2)}deg)`;
      const b1 = Math.min(70, d * .2), b2 = Math.min(18, d * .06);
      const dur = clamp(900 + d * .8, 900, 1700);
      ctl.anim(c, [
        { transform: at(0, 0), easing: fallIn },
        { transform: at(d, rot), offset: .5, easing: upOut },
        { transform: at(d - b1, rot * .5), offset: .68, easing: fallIn },
        { transform: at(d, rot), offset: .82, easing: upOut },
        { transform: at(d - b2, rot * .8), offset: .91, easing: fallIn },
        { transform: at(d, rot) },
      ], { duration: dur, delay: i * Math.min(70, 1800 / cards.length) + rand(0, 140), fill: "forwards" });
      ctl.after(5000 + (cards.length - i) * 45, () => {
        ctl.anim(c, [{ transform: at(d, rot) }, { transform: at(-16, -rot * .3), offset: .78 }, { transform: at(0, 0) }],
          { duration: 1300, easing: "cubic-bezier(.45,0,.3,1)", fill: "forwards" });
      });
    });
    ctl.after(4800, () => setMsg(2));
    ctl.after(7300, () => { setMsg(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s}>
      {msg === 1 && <Pill key="a" top>🍎 Newton a débranché la gravité… g × 3 !</Pill>}
      {msg === 2 && <Pill key="b" top>Treuil activé, on remonte tout…</Pill>}
      {msg === 3 && <Pill key="c" fade>Gravité rétablie à 9,81 m/s². Tout est à sa place.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Miroir
// ════════════════════════════════════════════════════════════════════════════
const MIROIR_CSS = `
@keyframes pk-miroir-glint { 0% { transform: translateX(-160%) skewX(-20deg) } 100% { transform: translateX(380%) skewX(-20deg) } }
`;
function Miroir({ done }) {
  const s = useStage(done);
  const [msg, setMsg] = useState(1);
  useEffect(() => {
    const { ctl } = s;
    ctl.parts().forEach(p => {
      ctl.set(p, { "transform-origin": ctl.originOf(p) });
      ctl.anim(p, [{ transform: "perspective(1400px) rotateY(0deg)" }, { transform: "perspective(1400px) rotateY(180deg)" }],
        { duration: 1300, easing: "cubic-bezier(.6,0,.3,1)", fill: "forwards" });
      ctl.after(7100, () => ctl.anim(p, [{ transform: "perspective(1400px) rotateY(180deg)" }, { transform: "perspective(1400px) rotateY(360deg)" }],
        { duration: 1300, easing: "cubic-bezier(.6,0,.3,1)", fill: "forwards" }));
    });
    ctl.after(4400, () => setMsg(2));
    ctl.after(8500, () => { setMsg(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={MIROIR_CSS}>
      <div style={{ position: "absolute", inset: 0, opacity: msg === 3 ? 0 : 1, transition: "opacity 1s ease",
        animation: "pk-kit-fadein 1.2s ease both",
        boxShadow: "inset 0 0 0 5px rgba(226,232,240,.55), inset 0 0 0 9px rgba(148,163,184,.35), inset 0 0 60px rgba(186,230,253,.25)",
        background: "linear-gradient(125deg, rgba(255,255,255,.06), transparent 40%, rgba(255,255,255,.05) 60%, transparent)" }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "34%",
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,.26), transparent)",
          animation: "pk-miroir-glint 1.7s ease-in-out 1.1s 3 both" }}/>
      </div>
      {msg === 1 && <Pill key="a" top>🪞 Miroir, mon beau miroir…</Pill>}
      {msg === 2 && <Pill key="b" top>… qui a la plus belle imprimante du royaume ?</Pill>}
      {msg === 3 && <Pill key="c" fade>C'est toi. Mais à l'endroit, c'est mieux.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 8-9. Blizzard et brouillard : un voile a gratter
// ════════════════════════════════════════════════════════════════════════════
const SCRATCH_CSS = `
@keyframes pk-brouillard-drift { from { transform: translateX(-18%) } to { transform: translateX(18%) } }
`;
function paintCover(g, w, h, snow) {
  if (snow) {
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#f8fbff"); base.addColorStop(1, "#e3ebf5");
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rand(6, 40) * (w / 700 + .3);
      const gr = g.createRadialGradient(x - r * .3, y - r * .3, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,.9)"); gr.addColorStop(.7, "rgba(214,226,242,.35)"); gr.addColorStop(1, "rgba(214,226,242,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 380; i++) {
      g.fillStyle = Math.random() < .5 ? "rgba(255,255,255,1)" : "rgba(170,195,230,.5)";
      g.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2);
    }
  } else {
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "rgba(186,194,206,.97)"); base.addColorStop(1, "rgba(150,160,176,.97)");
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rand(30, 140) * (w / 700 + .3);
      const light = Math.random() < .6;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, light ? "rgba(236,240,246,.55)" : "rgba(110,120,138,.35)");
      gr.addColorStop(1, light ? "rgba(236,240,246,0)" : "rgba(110,120,138,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
}

function Scratch({ done, kind }) {
  const s = useStage(done);
  const snow = kind === "blizzard";
  const cvRef = useRef(null), fxRef = useRef(null);
  const [phase, setPhase] = useState("play"); // play, won, rendu
  const phaseRef = useRef("play");
  const [pct, setPct] = useState(0);
  const st = useRef({ last: null, q: 1, pad: 30, g: null });
  useEffect(() => {
    const { ctl } = s;
    const cv = cvRef.current;
    if (!cv) return;
    const W = vw(), H = vh(), P = st.current.pad;
    const q = Math.min(1, 720 / Math.max(W, H));
    st.current.q = q;
    cv.width = Math.max(1, Math.round((W + 2 * P) * q));
    cv.height = Math.max(1, Math.round((H + 2 * P) * q));
    const g = cv.getContext("2d", { willReadFrequently: true });
    st.current.g = g;
    paintCover(g, cv.width, cv.height, snow);
    // flocons (decor)
    const fx = fxRef.current;
    let fg = null, flakes = [];
    if (fx && snow) {
      fx.width = Math.round(W * q); fx.height = Math.round(H * q);
      fg = fx.getContext("2d");
      flakes = Array.from({ length: s.reduced ? 40 : 170 }, () => ({ x: Math.random() * fx.width, y: Math.random() * fx.height,
        r: rand(.8, 2.6) * (q + .3), v: rand(40, 110) * q, ph: Math.random() * 6 }));
    }
    const x0 = Math.round(P * q), y0 = Math.round(P * q), x1 = Math.round((P + W) * q), y1 = Math.round((P + H) * q);
    let lastCheck = 0;
    ctl.loop((t, dt) => {
      if (fg) {
        fg.clearRect(0, 0, fx.width, fx.height);
        const wind = (s.reduced ? 10 : 70 + 50 * Math.sin(t * .9)) * q;
        fg.fillStyle = "rgba(255,255,255,.92)";
        flakes.forEach(f => {
          if (!s.reduced) {
            f.y += f.v * dt; f.x += (wind + Math.sin(t * 2 + f.ph) * 20 * q) * dt;
            if (f.y > fx.height + 4) { f.y = -4; f.x = Math.random() * fx.width; }
            if (f.x > fx.width + 4) f.x = -4;
          }
          fg.beginPath(); fg.arc(f.x, f.y, f.r, 0, Math.PI * 2); fg.fill();
        });
      }
      if (phaseRef.current === "play" && t - lastCheck > .35) {
        lastCheck = t;
        const d = g.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
        let clear = 0, tot = 0;
        for (let i = 3; i < d.length; i += 4 * 7) { tot++; if (d[i] < 60) clear++; }
        const frac = tot ? clear / tot : 0;
        setPct(Math.min(100, Math.round(frac / .7 * 100)));
        if (frac >= .7) { phaseRef.current = "won"; setPhase("won"); s.finish(); }
      }
      return phaseRef.current !== "gone";
    });
    ctl.after(snow ? 40000 : 45000, () => {
      if (phaseRef.current === "play") { phaseRef.current = "rendu"; setPhase("rendu"); }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scrub = e => {
    if (phaseRef.current !== "play") return;
    const { g, q, pad } = st.current;
    if (!g) return;
    const x = (e.clientX + pad) * q, y = (e.clientY + pad) * q;
    const R = (snow ? 36 : 48) * q * (isNarrow() ? 1.15 : 1);
    g.globalCompositeOperation = "destination-out";
    const last = st.current.last, pts = [];
    if (last) {
      const dx = x - last.x, dy = y - last.y, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (R / 3)));
      for (let i = 1; i <= n; i++) pts.push([last.x + dx * i / n, last.y + dy * i / n]);
    } else pts.push([x, y]);
    pts.forEach(([px, py]) => {
      const gr = g.createRadialGradient(px, py, 0, px, py, R);
      gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(.55, "rgba(0,0,0,.85)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(px, py, R, 0, Math.PI * 2); g.fill();
    });
    g.globalCompositeOperation = "source-over";
    st.current.last = { x, y };
  };
  const down = e => { st.current.last = null; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (er) { /* rien */ } scrub(e); };
  const up = () => { st.current.last = null; };
  const playing = phase === "play";
  const P = st.current.pad;
  const gone = !playing;
  return (
    <Layer s={s} css={SCRATCH_CSS}>
      <canvas ref={cvRef} onPointerDown={down} onPointerMove={scrub} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
        aria-label={snow ? "Neige à essuyer" : "Brouillard à dissiper"}
        style={{ position: "absolute", left: -P, top: -P, width: `calc(100% + ${2 * P}px)`, height: `calc(100% + ${2 * P}px)`,
          pointerEvents: playing ? "auto" : "none", touchAction: "none", cursor: "grab",
          filter: snow ? "blur(.6px)" : "blur(9px)",
          animation: gone ? `pk-kit-fade ${phase === "won" ? 1 : 2}s ease both` : "pk-kit-fadein 2.6s ease both" }}/>
      {!snow && [0, 1, 2].map(i => (
        <div key={i} style={{ position: "absolute", left: "-30%", right: "-30%", top: `${8 + i * 30}%`, height: "40%",
          background: "radial-gradient(ellipse at center, rgba(235,240,246,.7), transparent 65%)", filter: "blur(12px)",
          opacity: gone ? 0 : .6 * (1 - pct / 100), transition: "opacity 1s ease",
          animation: s.reduced ? "none" : `pk-brouillard-drift ${9 + i * 3}s ease-in-out ${-i * 2}s infinite alternate` }}/>
      ))}
      {snow && <canvas ref={fxRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
        opacity: gone ? 0 : 1, transition: "opacity 1.2s ease" }}/>}
      {playing && <Pill key="a" top>{snow ? `❄️ Blizzard sur l'atelier ! Frotte pour déneiger : ${pct} %`
        : `🌫️ Purée de pois… Dissipe le brouillard : ${pct} %`}</Pill>}
      {phase === "won" && <Pill key="b" fade>{snow ? "☀️ Déneigé ! Le plateau est de nouveau visible." : "🌤️ Le brouillard s'est levé. Belle visibilité sur l'atelier."}</Pill>}
      {phase === "rendu" && <Pill key="c" fade>{snow ? "Le soleil s'en est chargé… Une autre fois ! 🙂" : "Le vent s'en est chargé… Une autre fois ! 🙂"}</Pill>}
    </Layer>
  );
}
const Blizzard = props => <Scratch {...props} kind="blizzard"/>;
const Brouillard = props => <Scratch {...props} kind="brouillard"/>;

// ════════════════════════════════════════════════════════════════════════════
// 10. Fete
// ════════════════════════════════════════════════════════════════════════════
const FETE_CSS = `
@keyframes pk-fete-fall { 0% { transform: translate(0, -12vh) } 100% { transform: translate(var(--dx), 112vh) } }
@keyframes pk-fete-flip { 0% { transform: rotate(0deg) rotateX(0deg) } 100% { transform: rotate(var(--rot)) rotateX(720deg) } }
@keyframes pk-fete-ball { 0% { transform: translate(-50%, -170px) } 60% { transform: translate(-50%, 10px) } 80% { transform: translate(-50%, -4px) } 100% { transform: translate(-50%, 0) } }
@keyframes pk-fete-streamer { 0% { stroke-dashoffset: 1; opacity: 1 } 65% { stroke-dashoffset: 0; opacity: 1 } 100% { stroke-dashoffset: 0; opacity: 0 } }
@keyframes pk-fete-popper { 0% { transform: scale(.4) rotate(0deg) } 30% { transform: scale(1.35) rotate(-14deg) } 100% { transform: scale(1) rotate(0deg) } }
`;
const STREAMERS = [
  "M10 395 C 70 310, -20 270, 60 210 S 150 140, 90 80 S 170 10, 230 30",
  "M20 395 C 40 330, 120 320, 110 250 S 40 170, 120 120 S 240 90, 260 20",
  "M5 395 C 90 360, 60 280, 150 260 S 230 200, 190 140 S 260 60, 300 70",
];
function Fete({ done }) {
  const s = useStage(done);
  const [msg, setMsg] = useState(1);
  const bits = useMemo(() => Array.from({ length: 90 }, (_, i) => ({ left: rand(0, 100), delay: rand(0, 4.2), dur: rand(2.6, 4.2),
    dx: rand(-60, 60), rot: rand(-540, 540), c: FILAMENTS[i % FILAMENTS.length], round: Math.random() < .3, w: rand(6, 11) })), []);
  useEffect(() => {
    const { ctl } = s;
    ctl.parts().forEach(p => ctl.anim(p, [
      { filter: "hue-rotate(0deg) saturate(1)" }, { filter: "hue-rotate(60deg) saturate(1.6)", offset: .08 },
      { filter: "hue-rotate(1020deg) saturate(1.6)", offset: .92 }, { filter: "hue-rotate(1080deg) saturate(1)" },
    ], { duration: 7400, easing: "linear" }));
    ctl.cards(60).forEach((c, i) => ctl.anim(c, [
      { transform: "translateY(0) rotate(0deg) scale(1)" },
      { transform: `translateY(-12px) rotate(${i % 2 ? 3 : -3}deg) scale(1.03)`, offset: .25 },
      { transform: "translateY(0) rotate(0deg) scale(1)", offset: .5 },
      { transform: `translateY(-12px) rotate(${i % 2 ? -3 : 3}deg) scale(1.03)`, offset: .75 },
      { transform: "translateY(0) rotate(0deg) scale(1)" },
    ], { duration: 940, delay: 300 + (i % 2) * 235, iterations: 7, easing: "ease-in-out" }));
    ctl.after(7700, () => { setMsg(2); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={FETE_CSS}>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: "220vmax", height: "220vmax", marginLeft: "-110vmax",
        marginTop: "-110vmax", opacity: msg === 1 ? .45 : 0, transition: "opacity 1s ease", mixBlendMode: "screen",
        background: "radial-gradient(circle, rgba(255,255,255,.55) 0 3px, transparent 4px) 0 0 / 74px 74px",
        animation: "pk-kit-spin 9s linear infinite" }}/>
      <div style={{ position: "absolute", left: "50%", top: 0, animation: "pk-fete-ball 1.2s cubic-bezier(.3,1.2,.5,1) both",
        opacity: msg === 1 ? 1 : 0, transition: "opacity .8s ease" }}>
        <div style={{ width: 2, height: 46, margin: "0 auto", background: "rgba(200,200,200,.8)" }}/>
        <div style={{ width: 62, height: 62, borderRadius: "50%", animation: "pk-kit-spin 3s linear infinite",
          boxShadow: "0 0 30px rgba(255,255,255,.5)",
          background: "repeating-linear-gradient(0deg, rgba(255,255,255,.35) 0 2px, transparent 2px 9px), repeating-linear-gradient(90deg, rgba(255,255,255,.35) 0 2px, transparent 2px 9px), radial-gradient(circle at 35% 30%, #fff, #a1a1aa 45%, #3f3f46)" }}/>
      </div>
      {[0, 1].map(side => (
        <svg key={side} width="300" height="400" viewBox="0 0 300 400" aria-hidden="true"
          style={{ position: "absolute", bottom: 0, [side ? "right" : "left"]: 0, transform: side ? "scaleX(-1)" : "none", maxWidth: "60vw" }}>
          {STREAMERS.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={FILAMENTS[(i * 3 + side) % FILAMENTS.length]} strokeWidth="5" strokeLinecap="round"
              pathLength="1" strokeDasharray="1" style={{ animation: `pk-fete-streamer 2.6s ease-out ${(.2 + i * .35 + side * .5).toFixed(2)}s both` }}/>
          ))}
        </svg>
      ))}
      {[0, 1].map(side => (
        <div key={side} aria-hidden="true" style={{ position: "absolute", bottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
          [side ? "right" : "left"]: 14, fontSize: 38, transform: side ? "scaleX(-1)" : "none" }}>
          <div style={{ animation: `pk-fete-popper .7s ease-out ${side * .5}s both` }}>🎉</div>
        </div>
      ))}
      {bits.map((b, i) => (
        <span key={i} style={{ position: "absolute", top: 0, left: `${b.left}%`, "--dx": `${b.dx}px`,
          animation: `pk-fete-fall ${b.dur}s linear ${b.delay}s both` }}>
          <span style={{ display: "block", width: b.w, height: b.round ? b.w : b.w * 1.5, borderRadius: b.round ? "50%" : 2,
            background: b.c, "--rot": `${b.rot}deg`, animation: `pk-fete-flip ${b.dur}s linear ${b.delay}s both` }}/>
        </span>
      ))}
      {msg === 1 && <Pill key="a" top>🎉 1000e impression réussie ! Le plateau met l'ambiance.</Pill>}
      {msg === 2 && <Pill key="b" fade>Fin de la soirée. Quelqu'un ramasse les confettis ?</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 11. Tornade
// ════════════════════════════════════════════════════════════════════════════
const TORNADE_CSS = `
@keyframes pk-tornade-wob { from { transform: translateX(-14px) } to { transform: translateX(14px) } }
@keyframes pk-tornade-twist { from { background-position: 0 0 } to { background-position: 160px 0 } }
@keyframes pk-tornade-debris { from { transform: rotate(0deg) translateX(var(--r)) rotate(0deg) } to { transform: rotate(360deg) translateX(var(--r)) rotate(-720deg) } }
`;
function Tornade({ done }) {
  const s = useStage(done);
  const funnel = useRef(null);
  const [msg, setMsg] = useState(1);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh(), cy = H * .45;
    const main = ctl.main(), sc0 = main ? main.scrollTop : 0;
    const st = ctl.cards(48).map(c => {
      const r = c.getBoundingClientRect();
      const hx = r.left + r.width / 2, hy = r.top + r.height / 2;
      return { c, hx, hy, a: Math.atan2(hy - cy, hx - W / 2), rad: rand(.16, .38) * Math.min(W, H * 1.2), sp: rand(2.2, 3.6),
        lift: rand(-.24, .1) * H, spin: rand(200, 520) * (Math.random() < .5 ? -1 : 1),
        sc: clamp(170 / Math.max(r.width, r.height, 1), .3, .7) };
    });
    const wander = t => .5 * W + Math.sin((t - 1.6) * 1.7) * W * .08;
    const cxAt = t => (t < 1.6 ? lerp(-.3 * W, .5 * W, easeInOut(t / 1.6))
      : t < 5.4 ? wander(t) : lerp(wander(5.4), 1.35 * W, easeInOut(clamp((t - 5.4) / 1.7, 0, 1))));
    ctl.loop(t => {
      const cx = cxAt(t);
      if (funnel.current) funnel.current.style.transform = `translateX(${(cx - 150).toFixed(1)}px)`;
      const k = t < 1 ? 0 : t < 2.2 ? easeInOut((t - 1) / 1.2) : t < 5.6 ? 1 : t < 7.2 ? 1 - easeOutBounce((t - 5.6) / 1.6) : 0;
      const ccx = t < 5.6 ? cx : cxAt(5.6);
      const dsc = main ? main.scrollTop - sc0 : 0;
      st.forEach(o => {
        if (k <= 0) { ctl.unset(o.c, ["transform"]); return; }
        const ang = o.a + o.sp * Math.max(0, t - 1);
        const tx = ccx + Math.cos(ang) * o.rad, ty = cy + o.lift + Math.sin(ang) * o.rad * .35;
        const depth = (Math.sin(ang) + 1) / 2;
        const sc = lerp(1, o.sc * (.8 + .4 * depth), k);
        const rot = k * o.spin * clamp((Math.min(t, 5.6) - 1) / 4, 0, 1.2);
        ctl.set(o.c, { transform: `translate(${((tx - o.hx) * k).toFixed(1)}px,${((ty - (o.hy - dsc)) * k).toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${sc.toFixed(3)})` });
      });
      if (t > 7.4) { setMsg(2); s.finish(); return false; }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={TORNADE_CSS}>
      <div ref={funnel} aria-hidden="true" style={{ position: "absolute", left: 0, bottom: 0, width: 300, height: "82vh",
        transform: "translateX(-400px)", opacity: msg === 1 ? 1 : 0, transition: "opacity .6s ease" }}>
        <div style={{ position: "absolute", left: -70, right: -70, top: -40, height: 90, borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(71,85,105,.85), rgba(71,85,105,0) 70%)", filter: "blur(6px)" }}/>
        <div style={{ position: "absolute", inset: 0, clipPath: "polygon(0 0, 100% 0, 58% 100%, 42% 100%)", filter: "blur(1.5px)",
          background: "repeating-linear-gradient(100deg, rgba(148,163,184,.6) 0 16px, rgba(226,232,240,.22) 16px 34px)",
          animation: "pk-tornade-twist .5s linear infinite" }}/>
        {Array.from({ length: 9 }, (_, i) => {
          const w = 280 - i * 26;
          return (
            <div key={i} style={{ position: "absolute", top: `${i * 10 + 2}%`, left: (300 - w) / 2, width: w, height: Math.max(14, 30 - i * 2),
              borderRadius: "50%", border: "2px solid rgba(226,232,240,.45)",
              animation: `pk-tornade-wob ${(.35 + i * .04).toFixed(2)}s ease-in-out ${(-i * .1).toFixed(2)}s infinite alternate` }}/>
          );
        })}
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} style={{ position: "absolute", left: 150, top: `${30 + i * 7}%`, width: 7, height: 5, background: pick(FILAMENTS),
            "--r": `${60 - i * 5}px`, animation: `pk-tornade-debris ${(.7 + i * .08).toFixed(2)}s linear infinite` }}/>
        ))}
      </div>
      {msg === 1 && <Pill key="a" top>🌪️ Alerte tornade : attache tes bobines !</Pill>}
      {msg === 2 && <Pill key="b" fade>La tornade est partie. Rien de cassé, juste un peu décoiffé.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 12. Aimant
// ════════════════════════════════════════════════════════════════════════════
const AIMANT_CSS = `
@keyframes pk-aimant-wave { 0% { transform: scale(.4); opacity: .8 } 100% { transform: scale(2.4); opacity: 0 } }
`;
function Aimant({ done }) {
  const s = useStage(done);
  const mag = useRef(null);
  const [msg, setMsg] = useState(1);
  useEffect(() => {
    const { ctl } = s;
    const main = ctl.main(), sc0 = main ? main.scrollTop : 0;
    const st = ctl.cards(48).map(c => {
      const r = c.getBoundingClientRect();
      return { c, hx: r.left + r.width / 2, hy: r.top + r.height / 2, x: 0, y: 0, r: 0, vx: 0, vy: 0, vr: 0 };
    });
    const p = { x: vw() / 2, y: vh() / 2, t: -1e9 };
    const track = e => { p.x = e.clientX; p.y = e.clientY; p.t = performance.now(); };
    ctl.on(window, "pointermove", track, { passive: true });
    ctl.on(window, "pointerdown", track, { passive: true });
    ctl.loop((t, dt) => {
      let mx = p.x, my = p.y;
      if (performance.now() - p.t > 1200) {
        mx = vw() / 2 + Math.sin(t * 1.3) * vw() * .42;
        my = vh() * .5 + Math.sin(t * 2.1) * vh() * .32;
      }
      if (mag.current) mag.current.style.transform = `translate(${mx.toFixed(1)}px,${my.toFixed(1)}px)`;
      const on = t < 8;
      const dsc = main ? main.scrollTop - sc0 : 0;
      st.forEach(o => {
        let tx = 0, ty = 0, tr = 0;
        if (on) {
          const dx = mx - o.hx, dy = my - (o.hy - dsc), d = Math.hypot(dx, dy);
          const f = .6 / (1 + d / 700);
          tx = dx * f; ty = dy * f;
          const m = Math.hypot(tx, ty);
          if (m > 150) { tx *= 150 / m; ty *= 150 / m; }
          tr = clamp(dx / 18, -12, 12) / (1 + d / 500);
        }
        const k = 70, c = 10;
        o.vx += (k * (tx - o.x) - c * o.vx) * dt; o.x += o.vx * dt;
        o.vy += (k * (ty - o.y) - c * o.vy) * dt; o.y += o.vy * dt;
        o.vr += (k * (tr - o.r) - c * o.vr) * dt; o.r += o.vr * dt;
        ctl.set(o.c, { transform: `translate(${o.x.toFixed(1)}px,${o.y.toFixed(1)}px) rotate(${o.r.toFixed(2)}deg)` });
      });
      if (t > 9.4) { st.forEach(o => ctl.unset(o.c, ["transform"])); setMsg(2); s.finish(); return false; }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={AIMANT_CSS}>
      <div ref={mag} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, opacity: msg === 1 ? 1 : 0, transition: "opacity .6s ease" }}>
        <div style={{ position: "absolute", left: -26, top: -26, width: 52, height: 52 }}>
          {[0, 1].map(i => (
            <span key={i} style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(239,68,68,.6)",
              animation: `pk-aimant-wave 1.4s ease-out ${i * .7}s infinite` }}/>
          ))}
          <svg width="52" height="52" viewBox="0 0 44 44" style={{ position: "absolute", inset: 0, transform: "rotate(180deg)",
            filter: "drop-shadow(0 3px 6px rgba(0,0,0,.5))" }}>
            <path d="M10 8 V22 A12 12 0 0 0 34 22 V8" fill="none" stroke="#ef4444" strokeWidth="9"/>
            <rect x="5.5" y="3" width="9" height="8" fill="#e5e7eb"/>
            <rect x="29.5" y="3" width="9" height="8" fill="#e5e7eb"/>
          </svg>
        </div>
      </div>
      {msg === 1 && <Pill key="a" top>🧲 Tes cartes sont aimantées… (le plateau PEI aussi, c'est normal)</Pill>}
      {msg === 2 && <Pill key="b" fade>Démagnétisé. Les cartes reprennent leur place.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 13. Fantomes
// ════════════════════════════════════════════════════════════════════════════
const FANTOME_CSS = `
@keyframes pk-fantome-cross { from { transform: translateX(var(--x0)) } to { transform: translateX(var(--x1)) } }
@keyframes pk-fantome-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-24px) } }
@keyframes pk-fantome-catch { 0% { transform: scale(1) rotate(0deg); opacity: 1 } 100% { transform: scale(1.9) rotate(25deg); opacity: 0 } }
@keyframes pk-fantome-bouh { 0%, 50%, 100% { opacity: 0; transform: scale(.6) } 58%, 88% { opacity: 1; transform: scale(1) } }
@keyframes pk-fantome-appear { 0% { opacity: 0 } 20%, 80% { opacity: 1 } 100% { opacity: 0 } }
`;
function GhostSvg({ size }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 60 70" aria-hidden="true" style={{ filter: "drop-shadow(0 0 12px rgba(255,255,255,.65))" }}>
      <path d="M30 4 C 14 4, 6 16, 6 32 L6 62 L13 56 L20 63 L27 56 L34 63 L41 56 L48 63 L54 57 L54 32 C 54 16, 46 4, 30 4 Z"
        fill="rgba(255,255,255,.93)" stroke="rgba(148,163,184,.7)" strokeWidth="1.2"/>
      <ellipse cx="22" cy="28" rx="3.6" ry="4.8" fill="#111827"/>
      <ellipse cx="38" cy="28" rx="3.6" ry="4.8" fill="#111827"/>
      <ellipse cx="30" cy="42" rx="4" ry="5.2" fill="#111827"/>
      <ellipse cx="16" cy="36" rx="3.5" ry="2" fill="rgba(244,114,182,.45)"/>
      <ellipse cx="44" cy="36" rx="3.5" ry="2" fill="rgba(244,114,182,.45)"/>
    </svg>
  );
}
function Fantome({ done }) {
  const s = useStage(done);
  const [ghosts, setGhosts] = useState([]);
  const [caught, setCaught] = useState(0);
  const [phase, setPhase] = useState("play");
  const phaseRef = useRef("play");
  const count = useRef(0);
  const seq = useRef(0);
  const partsRef = useRef([]);
  const fadeBack = () => partsRef.current.forEach(p => s.ctl.anim(p, [{ opacity: .32, filter: "grayscale(.6) blur(.5px)" },
    { opacity: 1, filter: "grayscale(0) blur(0px)" }], { duration: 700, fill: "forwards", easing: "ease" }));
  useEffect(() => {
    const { ctl } = s;
    const parts = ctl.parts();
    partsRef.current = parts;
    parts.forEach(p => ctl.anim(p, [{ opacity: 1, filter: "grayscale(0) blur(0px)" }, { opacity: .32, filter: "grayscale(.6) blur(.5px)" }],
      { duration: 1400, fill: "forwards", easing: "ease" }));
    const spawn = () => {
      if (phaseRef.current !== "play") return;
      setGhosts(gs => {
        const live = gs.filter(g => !g.gone);
        if (live.length >= 4) return live;
        const dir = Math.random() < .5 ? 1 : -1;
        return [...live, { id: ++seq.current, dir, y: rand(12, 70), x: rand(10, 78), dur: rand(5, 7.5), size: rand(56, 76) }];
      });
      ctl.after(rand(1000, 1800), spawn);
    };
    ctl.after(600, spawn);
    ctl.after(45000, () => {
      if (phaseRef.current !== "play") return;
      phaseRef.current = "rendu"; setPhase("rendu"); setGhosts([]); fadeBack();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const gone = id => setGhosts(gs => gs.filter(g => g.id !== id));
  const hit = id => {
    if (phaseRef.current !== "play") return;
    setGhosts(gs => gs.map(g => (g.id === id && !g.caught ? { ...g, caught: true } : g)));
    count.current += 1;
    setCaught(count.current);
    if (count.current >= 3) {
      phaseRef.current = "won"; setPhase("won"); fadeBack(); s.finish();
    }
  };
  return (
    <Layer s={s} css={FANTOME_CSS}>
      {ghosts.map(g => {
        const W = vw();
        const x0 = g.dir > 0 ? -110 : W + 30, x1 = g.dir > 0 ? W + 30 : -110;
        const cross = s.reduced ? "none" : `pk-fantome-cross ${g.dur}s linear both`;
        return (
          <div key={g.id} onAnimationEnd={e => { if (e.target === e.currentTarget) gone(g.id); }}
            style={{ position: "absolute", top: `${g.y}%`, left: s.reduced ? `${g.x}%` : 0, "--x0": `${x0}px`, "--x1": `${x1}px`,
              animation: s.reduced ? "pk-fantome-appear 4s ease both" : cross + (g.caught ? " paused" : "") }}>
            <div style={{ animation: s.reduced ? "none" : "pk-fantome-bob 1.6s ease-in-out infinite" }}>
              <button onClick={() => hit(g.id)} aria-label="Fantôme" disabled={g.caught}
                onAnimationEnd={e => { if (g.caught && e.target === e.currentTarget) gone(g.id); }}
                style={{ position: "relative", display: "block", padding: 8, border: "none", background: "transparent",
                  cursor: "pointer", pointerEvents: g.caught ? "none" : "auto", transform: g.dir < 0 ? "scaleX(-1)" : "none",
                  animation: g.caught ? "pk-fantome-catch .45s ease-out both" : "none" }}>
                <GhostSvg size={g.size}/>
              </button>
              {!g.caught && (
                <span style={{ position: "absolute", left: "70%", top: -18, padding: "3px 9px", borderRadius: 10, background: "#fff",
                  color: "#111827", fontWeight: 900, fontSize: 14, whiteSpace: "nowrap",
                  animation: "pk-fantome-bouh 2.2s ease-in-out infinite" }}>Bouh !</span>
              )}
            </div>
          </div>
        );
      })}
      {phase === "play" && <Pill key="a" top>👻 L'atelier est hanté ! Attrape 3 fantômes : {caught}/3</Pill>}
      {phase === "won" && <Pill key="b" fade>Ils sont partis hanter une Ender 3.</Pill>}
      {phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 14. Pixel
// ════════════════════════════════════════════════════════════════════════════
const PIXEL_SIZES = [28, 20, 14, 10, 7, 5, 3];
const PIXEL_MSG = ["Connexion à 56 kbit/s…", "Négociation avec le modem…", "Téléchargement des pixels…", "Encore quelques pixels…",
  "Ça se précise…", "Presque net…", "Dernières couches…", "Haute définition rétablie !"];
function Pixel({ done }) {
  const s = useStage(done);
  const [step, setStep] = useState(0);
  const [fin, setFin] = useState(false);
  const barRef = useRef(null), pctRef = useRef(null);
  useEffect(() => {
    const { ctl } = s;
    const parts = ctl.parts();
    const apply = b => parts.forEach(p => ctl.set(p, { filter: `url(#pk-pixel-${b})` }));
    const times = [0, 1300, 2200, 3000, 3700, 4300, 4900];
    times.forEach((tm, i) => ctl.after(tm, () => { apply(PIXEL_SIZES[i]); setStep(i); }));
    ctl.after(5500, () => { parts.forEach(p => ctl.unset(p, ["filter"])); setStep(7); });
    ctl.loop(t => {
      const raw = clamp(t / 5.5, 0, 1);
      const v = Math.round(100 * (raw < .3 ? raw * .5 : raw < .45 ? .15 : .15 + (raw - .45) / .55 * .85));
      if (barRef.current) barRef.current.style.width = v + "%";
      if (pctRef.current) pctRef.current.textContent = `${v} % · ${(v * 4.7).toFixed(0)} Ko reçus`;
      return t < 5.6;
    });
    ctl.after(6300, () => { setFin(true); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        {PIXEL_SIZES.map(b => (
          <filter key={b} id={`pk-pixel-${b}`} x="0" y="0" width="100%" height="100%">
            <feFlood x={b / 2 - 1} y={b / 2 - 1} width="2" height="2"/>
            <feComposite width={b} height={b}/>
            <feTile result="a"/>
            <feComposite in="SourceGraphic" in2="a" operator="in"/>
            <feMorphology operator="dilate" radius={b / 2}/>
          </filter>
        ))}
      </svg>
      {!fin && (
        <div style={{ position: "absolute", left: "50%", top: "calc(64px + env(safe-area-inset-top, 0px))", transform: "translateX(-50%)",
          width: "min(420px, calc(100vw - 32px))", padding: "10px 14px", borderRadius: 4, background: "#c0c0c0", color: "#000",
          fontFamily: "Tahoma, Verdana, sans-serif", fontSize: 13, border: "2px outset #fff", boxShadow: "0 8px 24px rgba(0,0,0,.45)" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>📞 Kkrrriiiiii… pshhhhh… {PIXEL_MSG[step]}</div>
          <div style={{ height: 16, border: "2px inset #fff", background: "#fff", padding: 1 }}>
            <div ref={barRef} style={{ height: "100%", width: "0%",
              background: "repeating-linear-gradient(90deg, #000080 0 10px, transparent 10px 12px)" }}/>
          </div>
          <div ref={pctRef} style={{ marginTop: 4, fontSize: 12 }}>0 %</div>
        </div>
      )}
      {fin && <Pill key="b" fade>Bienvenue en 2026. La fibre est revenue.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 15. Vieux film
// ════════════════════════════════════════════════════════════════════════════
const VF_CSS = `
@keyframes pk-vieux-film-grain { 0% { transform: translate(0,0) } 20% { transform: translate(-4%,3%) } 40% { transform: translate(3%,-5%) }
  60% { transform: translate(-6%,-2%) } 80% { transform: translate(5%,4%) } 100% { transform: translate(0,0) } }
@keyframes pk-vieux-film-scratch { 0%, 100% { opacity: 0 } 10%, 40% { opacity: .7 } 50% { opacity: 0 } 60%, 80% { opacity: .5 } }
@keyframes pk-vieux-film-jump { 0%, 100% { transform: translateX(0) } 33% { transform: translateX(var(--b)) } 66% { transform: translateX(var(--c)) } }
@keyframes pk-vieux-film-flicker { 0%, 100% { opacity: 0 } 20% { opacity: .07 } 40% { opacity: .02 } 60% { opacity: .11 } 80% { opacity: .03 } }
@keyframes pk-vieux-film-holes { from { background-position: 0 0 } to { background-position: 0 40px } }
@keyframes pk-vieux-film-card { 0% { opacity: 0 } 10%, 86% { opacity: 1 } 100% { opacity: 0 } }
`;
function VieuxFilm({ done }) {
  const s = useStage(done);
  const [phase, setPhase] = useState("card"); // card, film, iris, fin
  const circ = useRef(null);
  const scratches = useMemo(() => Array.from({ length: 4 }, () => ({ a: rand(5, 95), b: rand(-60, 60), c: rand(-80, 80), d: rand(.5, 1.3), w: rand(1, 2.2) })), []);
  const dust = useMemo(() => Array.from({ length: 10 }, () => ({ x: rand(0, 100), y: rand(0, 100), r: rand(1.5, 4), d: rand(.2, .9), dl: rand(0, 3) })), []);
  useEffect(() => {
    const { ctl } = s;
    const parts = ctl.parts();
    const weave = [];
    ctl.after(300, () => parts.forEach(p => ctl.set(p, { filter: "sepia(1) grayscale(.35) contrast(1.15) brightness(.95)" })));
    ctl.after(2300, () => {
      setPhase("film");
      if (!s.reduced) parts.forEach(p => weave.push(ctl.anim(p, [{ transform: "translate(0,0)" }, { transform: "translate(0,1.5px)" },
        { transform: "translate(1px,-1px)" }, { transform: "translate(-1px,1px)" }, { transform: "translate(0,0)" }],
        { duration: 420, iterations: Infinity, easing: "steps(1,end)" })));
    });
    const diag = Math.hypot(vw(), vh()) / 2 + 20;
    ctl.after(6600, () => {
      setPhase("iris");
      ctl.loop(t => {
        let r;
        if (t < .6) r = diag * (1 - easeInOut(t / .6));
        else {
          if (!weave.done) { weave.done = true; parts.forEach(p => ctl.unset(p, ["filter"])); weave.forEach(a => a && a.cancel()); }
          r = diag * easeInOut(clamp((t - .7) / .7, 0, 1));
        }
        if (circ.current) circ.current.setAttribute("r", Math.max(0, r).toFixed(1));
        if (t > 1.45) { setPhase("fin"); s.finish(); return false; }
        return true;
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const filmOn = phase === "card" || phase === "film" || (phase === "iris");
  return (
    <Layer s={s} css={VF_CSS}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <filter id="pk-vieux-film-noise"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/>
          <feColorMatrix type="saturate" values="0"/></filter>
      </svg>
      {filmOn && phase !== "iris" && (
        <>
          <div style={{ position: "absolute", inset: "-10%", opacity: .22, animation: s.reduced ? "none" : "pk-vieux-film-grain .5s steps(5) infinite" }}>
            <svg width="100%" height="100%" aria-hidden="true"><rect width="100%" height="100%" filter="url(#pk-vieux-film-noise)"/></svg>
          </div>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, transparent 50%, rgba(20,12,0,.75))" }}/>
          {!s.reduced && <div style={{ position: "absolute", inset: 0, background: "#fff8e6", animation: "pk-vieux-film-flicker .3s steps(3) infinite" }}/>}
          {!s.reduced && scratches.map((k, i) => (
            <span key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${k.a}%`, width: k.w, background: "rgba(255,250,235,.7)",
              "--b": `${k.b}px`, "--c": `${k.c}px`, animation: `pk-vieux-film-scratch ${k.d}s steps(4) infinite, pk-vieux-film-jump ${k.d * 3}s steps(1) infinite` }}/>
          ))}
          {!s.reduced && dust.map((d, i) => (
            <span key={i} style={{ position: "absolute", left: `${d.x}%`, top: `${d.y}%`, width: d.r, height: d.r, borderRadius: "50%",
              background: "rgba(10,8,4,.8)", animation: `pk-vieux-film-scratch ${d.d}s steps(2) ${d.dl}s infinite` }}/>
          ))}
          {[0, 1].map(side => (
            <div key={side} style={{ position: "absolute", top: 0, bottom: 0, [side ? "right" : "left"]: 0, width: isNarrow() ? 14 : 26,
              background: "#0b0905", display: "flex", justifyContent: "center" }}>
              <div style={{ width: isNarrow() ? 6 : 10, height: "100%",
                background: "repeating-linear-gradient(180deg, rgba(235,225,200,.85) 0 14px, transparent 14px 40px)",
                animation: s.reduced ? "none" : "pk-vieux-film-holes .4s linear infinite" }}/>
            </div>
          ))}
        </>
      )}
      {phase === "card" && (
        <div style={{ position: "absolute", inset: 0, background: "#0b0905", display: "flex", alignItems: "center", justifyContent: "center",
          animation: "pk-vieux-film-card 2.3s ease both" }}>
          <div style={{ margin: 16, padding: "28px 22px", border: "3px double rgba(245,235,210,.9)", outline: "1px solid rgba(245,235,210,.5)",
            outlineOffset: 6, color: "#f5ebd2", fontFamily: "Georgia, 'Times New Roman', serif", textAlign: "center", maxWidth: 460 }}>
            <div style={{ fontSize: 13, letterSpacing: ".3em", textTransform: "uppercase", opacity: .8 }}>❦ Bambu Films présente ❦</div>
            <div style={{ fontSize: "clamp(22px, 6vw, 32px)", fontStyle: "italic", marginTop: 14 }}>Pendant ce temps, à l'atelier…</div>
          </div>
        </div>
      )}
      {phase === "iris" && (
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
          <defs>
            <mask id="pk-vieux-film-iris">
              <rect width="100%" height="100%" fill="#fff"/>
              <circle ref={circ} cx="50%" cy="50%" r="2000" fill="#000"/>
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="#0b0905" mask="url(#pk-vieux-film-iris)"/>
        </svg>
      )}
      {phase === "film" && <Pill key="a" style={{ fontFamily: "Georgia, serif", fontStyle: "italic", background: "rgba(11,9,5,.85)" }}>♪ piano bastringue ♪</Pill>}
      {phase === "fin" && <Pill key="b" fade>Retour à la couleur. Le cinéma parlant, quelle invention.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 16. Glitch
// ════════════════════════════════════════════════════════════════════════════
const GLITCH_CSS = `
@keyframes pk-glitch-bar { 0%, 100% { opacity: 0 } 10%, 30% { opacity: .9 } 31%, 60% { opacity: 0 } 61%, 70% { opacity: .8 } }
@keyframes pk-glitch-shake { 0%, 100% { transform: translate(-50%, -50%) } 20% { transform: translate(calc(-50% - 6px), -50%) }
  40% { transform: translate(calc(-50% + 5px), calc(-50% + 2px)) } 60% { transform: translate(calc(-50% - 3px), calc(-50% - 2px)) }
  80% { transform: translate(calc(-50% + 4px), -50%) } }
@keyframes pk-glitch-scan { from { background-position: 0 0 } to { background-position: 0 6px } }
`;
const GLITCH_CHARS = "█▓▒░#%&@$¤§¿?!<>/\\|=+*";
function Glitch({ done }) {
  const s = useStage(done);
  const [phase, setPhase] = useState("bug"); // bug, repair, ok
  const barRef = useRef(null);
  const bars = useMemo(() => Array.from({ length: 7 }, () => ({ top: rand(0, 96), h: rand(2, 16), c: pick(["#ff00ff", "#00ffff", "#39ff14", "#ff3b3b"]),
    d: rand(.35, .9), dl: rand(0, .6) })), []);
  useEffect(() => {
    const { ctl } = s;
    const parts = ctl.parts();
    const cards = ctl.cards(40);
    const jerk = (amp, n) => Array.from({ length: n }, (_, i) => ({ transform: i === 0 || i === n - 1 ? "translate(0px,0) skewX(0deg)"
      : `translate(${rand(-amp, amp).toFixed(1)}px,0) skewX(${rand(-amp / 3, amp / 3).toFixed(1)}deg)`, easing: "steps(1,end)" }));
    const loops = [];
    parts.forEach(p => {
      ctl.set(p, { filter: "url(#pk-glitch-rgb)" });
      loops.push(ctl.anim(p, jerk(14, 16), { duration: 900, iterations: Infinity }));
    });
    cards.forEach(c => {
      if (Math.random() < .5) return;
      loops.push(ctl.anim(c, Array.from({ length: 10 }, (_, i) => ({
        transform: i === 0 || i === 9 ? "translateX(0px)" : `translateX(${rand(-34, 34).toFixed(0)}px)`,
        filter: i === 0 || i === 9 ? "hue-rotate(0deg)" : `hue-rotate(${rand(0, 360).toFixed(0)}deg)`, easing: "steps(1,end)" })),
        { duration: rand(500, 900), iterations: Infinity, delay: rand(0, 400) }));
    });
    // lettres corrompues
    const nodes = ctl.textNodes(300, 0).map(n => ({ n, o: n.data, dead: false }));
    let level = .14;
    const corrupt = () => nodes.forEach(x => {
      if (x.dead) return;
      const str = level <= 0 ? x.o : Array.from(x.o).map(ch => (/\p{L}/u.test(ch) && Math.random() < level ? pick(GLITCH_CHARS) : ch)).join("");
      if (!ctl.text(x.n, str)) x.dead = true;
    });
    let lastC = 0;
    ctl.loop(t => {
      if (t > 3.2) level = Math.max(0, .14 * (1 - (t - 3.2) / 1.6));
      if (t - lastC > .11) { lastC = t; corrupt(); }
      if (barRef.current && t > 3.2) barRef.current.style.width = `${Math.round(clamp((t - 3.2) / 1.8, 0, 1) * 100)}%`;
      if (t > 5) { level = 0; corrupt(); return false; }
      return true;
    });
    ctl.after(3200, () => {
      setPhase("repair");
      loops.forEach(a => a && a.cancel());
      parts.forEach(p => ctl.anim(p, jerk(4, 10), { duration: 700, iterations: 2 }));
    });
    ctl.after(5000, () => { parts.forEach(p => ctl.unset(p, ["filter"])); setPhase("ok"); });
    ctl.after(5600, s.finish);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bug = phase === "bug";
  return (
    <Layer s={s} css={GLITCH_CSS}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <filter id="pk-glitch-rgb" x="-5%" y="0" width="110%" height="100%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
          <feOffset in="r" dx="-6" dy="0" result="r2">
            <animate attributeName="dx" values="-6;4;-11;2;-6" dur=".6s" repeatCount="indefinite"/>
          </feOffset>
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
          <feOffset in="b" dx="6" dy="0" result="b2">
            <animate attributeName="dx" values="6;-3;9;-1;6" dur=".5s" repeatCount="indefinite"/>
          </feOffset>
          <feBlend in="r2" in2="g" mode="screen" result="rg"/>
          <feBlend in="rg" in2="b2" mode="screen"/>
        </filter>
      </svg>
      {phase !== "ok" && (
        <>
          <div style={{ position: "absolute", inset: 0, opacity: bug ? 1 : .5, transition: "opacity .6s",
            background: "repeating-linear-gradient(0deg, rgba(0,0,0,.2) 0 1px, transparent 1px 3px)", animation: "pk-glitch-scan .2s linear infinite" }}/>
          {bug && bars.map((b, i) => (
            <div key={i} style={{ position: "absolute", left: 0, right: 0, top: `${b.top}%`, height: b.h, background: b.c, mixBlendMode: "difference",
              animation: `pk-glitch-bar ${b.d}s steps(1) ${b.dl}s infinite` }}/>
          ))}
          <div style={{ position: "absolute", left: "50%", top: "50%", width: "min(400px, calc(100vw - 32px))", background: "#0a0a0a",
            border: `2px solid ${bug ? "#ef4444" : "#22c55e"}`, borderRadius: 6, color: "#e5e5e5", fontFamily: "Consolas, 'Courier New', monospace",
            fontSize: 14, boxShadow: "0 0 0 1px #000, 0 20px 50px rgba(0,0,0,.6)", animation: bug ? "pk-glitch-shake .25s steps(2) infinite" : "none",
            transform: "translate(-50%, -50%)" }}>
            <div style={{ padding: "6px 10px", background: bug ? "#7f1d1d" : "#14532d", fontWeight: 700 }}>BambuNymous.exe</div>
            <div style={{ padding: "14px 14px 16px" }}>
              {bug ? (
                <>
                  <div style={{ color: "#f87171", fontWeight: 700, fontSize: 16 }}>⚠ Erreur 3D : couche non trouvée</div>
                  <div style={{ marginTop: 8, opacity: .85 }}>Couche 42 sur 41 · G-code corrompu à la ligne 0x7FFF</div>
                </>
              ) : (
                <>
                  <div style={{ color: "#4ade80", fontWeight: 700 }}>Réparation : recalibrage du plateau…</div>
                  <div style={{ marginTop: 10, height: 10, background: "#262626", borderRadius: 3, overflow: "hidden" }}>
                    <div ref={barRef} style={{ height: "100%", width: "0%", background: "#22c55e" }}/>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
      {phase === "ok" && <Pill key="c" fade>✔ Réparé. Le problème se situait entre la chaise et le plateau.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 17. Toile d'araignee
// ════════════════════════════════════════════════════════════════════════════
const TOILE_CSS = `
@keyframes pk-toile-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes pk-toile-drop { from { transform: translateY(-80px) } to { transform: translateY(var(--y)) } }
@keyframes pk-toile-up { from { transform: translateY(var(--y)) } to { transform: translateY(-160px) } }
@keyframes pk-toile-sway { 0%, 100% { transform: rotate(-3deg) } 50% { transform: rotate(3deg) } }
@keyframes pk-toile-legs { 0%, 100% { transform: rotate(-7deg) } 50% { transform: rotate(7deg) } }
`;
function webPaths(cx, cy, R, a0, a1) {
  const spokes = 7, rings = 7, out = [];
  const angs = Array.from({ length: spokes }, (_, i) => a0 + (a1 - a0) * (i / (spokes - 1)));
  angs.forEach(a => out.push(`M${cx.toFixed(1)} ${cy.toFixed(1)} L${(cx + Math.cos(a) * R).toFixed(1)} ${(cy + Math.sin(a) * R).toFixed(1)}`));
  for (let k = 1; k <= rings; k++) {
    const r = R * Math.pow(k / rings, .9) * rand(.94, 1.02);
    let d = "";
    angs.forEach((a, i) => {
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) { d = `M${x.toFixed(1)} ${y.toFixed(1)}`; return; }
      const am = (a + angs[i - 1]) / 2, rm = r * .86;
      d += ` Q${(cx + Math.cos(am) * rm).toFixed(1)} ${(cy + Math.sin(am) * rm).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    out.push(d);
  }
  return out;
}
function Spider() {
  const legs = [[-1, -30], [-1, -8], [-1, 12], [-1, 32], [1, -30], [1, -8], [1, 12], [1, 32]];
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" style={{ overflow: "visible" }}>
      {legs.map(([side, a], i) => (
        <g key={i} style={{ transformBox: "view-box", transformOrigin: "32px 34px",
          animation: `pk-toile-legs ${(.5 + (i % 4) * .07).toFixed(2)}s ease-in-out ${(i * .06).toFixed(2)}s infinite` }}>
          <path d={`M32 34 Q ${32 + side * 16} ${34 + a * .5 - 12} ${32 + side * 26} ${34 + a * .7}`} fill="none" stroke="#111" strokeWidth="2.6" strokeLinecap="round"/>
        </g>
      ))}
      <circle cx="32" cy="38" r="11" fill="#1f1f1f"/>
      <path d="M27 36 L32 42 L37 36" fill="none" stroke="#dc2626" strokeWidth="1.6"/>
      <circle cx="32" cy="24" r="7" fill="#262626"/>
      <circle cx="29" cy="23" r="2.6" fill="#fff"/><circle cx="35" cy="23" r="2.6" fill="#fff"/>
      <circle cx="29.5" cy="23.8" r="1.3" fill="#000"/><circle cx="35.5" cy="23.8" r="1.3" fill="#000"/>
    </svg>
  );
}
function Toile({ done }) {
  const s = useStage(done);
  const [phase, setPhase] = useState("play"); // play, won, rendu
  const geo = useMemo(() => {
    const W = vw(), H = vh(), R = Math.min(W, H) * .32, Rb = R * .7;
    return { W, H, x: rand(.3, .7) * W, y: Math.round(H * .42),
      webs: [
        ...webPaths(0, 0, R, 0, Math.PI / 2),
        ...webPaths(W, 0, R * .9, Math.PI / 2, Math.PI),
        ...webPaths(0, H, Rb, -Math.PI / 2, 0),
        ...webPaths(W, H, Rb, Math.PI, Math.PI * 1.5),
      ] };
  }, []);
  useEffect(() => {
    s.ctl.after(45000, () => setPhase(p => (p === "play" ? "rendu" : p)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const hit = () => {
    if (phase !== "play") return;
    setPhase("won");
    s.finish();
  };
  const away = phase !== "play";
  return (
    <Layer s={s} css={TOILE_CSS}>
      <svg width="100%" height="100%" viewBox={`0 0 ${geo.W} ${geo.H}`} style={{ position: "absolute", inset: 0,
        opacity: away ? 0 : 1, transition: "opacity .9s ease" }} aria-hidden="true">
        {geo.webs.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="rgba(226,232,240,.78)" strokeWidth="1.2" pathLength="1" strokeDasharray="1"
            style={{ filter: "drop-shadow(0 0 2px rgba(255,255,255,.5))", animation: s.reduced ? "none" : `pk-toile-draw 1.4s ease-out ${(i % 14 * .07).toFixed(2)}s both` }}/>
        ))}
      </svg>
      <div style={{ position: "absolute", left: geo.x - 45, top: 0, "--y": `${geo.y}px`,
        animation: away ? "pk-toile-up .8s cubic-bezier(.5,0,.8,.4) both" : s.reduced ? "pk-kit-fadein 1s both" : "pk-toile-drop 2.6s cubic-bezier(.3,1.25,.5,1) both",
        transform: s.reduced && !away ? `translateY(${geo.y}px)` : undefined }}>
        <div style={{ transformOrigin: `45px ${-geo.y}px`, animation: s.reduced ? "none" : "pk-toile-sway 3.2s ease-in-out infinite" }}>
          <div style={{ position: "absolute", left: 44, bottom: 60, width: 1.5, height: "120vh", background: "rgba(226,232,240,.8)" }}/>
          <button onClick={hit} aria-label="Araignée" style={{ display: "block", width: 90, height: 90, padding: 13, border: "none",
            background: "transparent", cursor: "pointer", pointerEvents: away ? "none" : "auto" }}>
            <Spider/>
          </button>
          {!away && (
            <span style={{ position: "absolute", left: 82, top: 4, padding: "5px 10px", borderRadius: 12, background: "#fff", color: "#111827",
              fontWeight: 800, fontSize: 13, whiteSpace: "nowrap", boxShadow: "0 4px 12px rgba(0,0,0,.3)",
              animation: "pk-kit-pop .4s ease-out 2.4s both" }}>Je squatte ton imprimante !</span>
          )}
        </div>
      </div>
      {phase === "play" && <Pill key="a" top>🕷️ Ça fait longtemps qu'on n'a pas fait le ménage… Chasse l'araignée !</Pill>}
      {phase === "won" && <Pill key="b" fade>Elle est remontée. Les toiles, c'était pour le support d'impression.</Pill>}
      {phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 18. Apesanteur
// ════════════════════════════════════════════════════════════════════════════
const APESANTEUR_CSS = `
@keyframes pk-apesanteur-astro { 0% { transform: translate(-80px, 20vh) rotate(0deg) } 100% { transform: translate(calc(100vw + 40px), 4vh) rotate(260deg) } }
@keyframes pk-apesanteur-tw { 0%, 100% { opacity: .15 } 50% { opacity: .9 } }
`;
function Apesanteur({ done }) {
  const s = useStage(done);
  const [msg, setMsg] = useState(1);
  const stars = useMemo(() => Array.from({ length: 40 }, () => ({ x: rand(0, 100), y: rand(0, 100), r: rand(1, 2.6), d: rand(1, 3) })), []);
  useEffect(() => {
    const { ctl } = s;
    const e = "cubic-bezier(.45,0,.55,1)";
    ctl.cards(60).forEach((c, i) => {
      const lift = rand(40, 160), dx = rand(-40, 40), r = rand(-12, 12);
      const at = (x, y, rr) => `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${rr.toFixed(1)}deg)`;
      ctl.anim(c, [
        { transform: at(0, 0, 0), easing: e },
        { transform: at(dx * .4, -lift * .5, r * .4), offset: .2, easing: e },
        { transform: at(dx, -lift, r), offset: .45, easing: e },
        { transform: at(dx * .6, -lift * .85, -r * .5), offset: .65, easing: e },
        { transform: at(dx * .2, -lift * .3, r * .2), offset: .86, easing: e },
        { transform: at(0, 0, 0) },
      ], { duration: 8200, delay: i * 40, fill: "forwards" });
    });
    ctl.after(5800, () => setMsg(2));
    ctl.after(8700, () => { setMsg(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={APESANTEUR_CSS}>
      <div style={{ position: "absolute", inset: 0, opacity: msg === 3 ? 0 : 1, transition: "opacity 1s ease", animation: "pk-kit-fadein 1.5s ease both",
        background: "radial-gradient(ellipse at 50% 120%, rgba(59,7,100,.18), transparent 60%)" }}>
        {stars.map((st, i) => (
          <span key={i} style={{ position: "absolute", left: `${st.x}%`, top: `${st.y}%`, width: st.r, height: st.r, borderRadius: "50%",
            background: "#fff", animation: `pk-apesanteur-tw ${st.d}s ease-in-out infinite` }}/>
        ))}
        <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, fontSize: 44, animation: "pk-apesanteur-astro 9s linear both" }}>🧑‍🚀</div>
      </div>
      {msg === 1 && <Pill key="a" top>🧑‍🚀 Houston, on a un problème de gravité.</Pill>}
      {msg === 2 && <Pill key="b" top>Rentrée dans l'atmosphère…</Pill>}
      {msg === 3 && <Pill key="c" fade>Atterrissage en douceur. Petit pas pour l'imprimante.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 19. Vent
// ════════════════════════════════════════════════════════════════════════════
const VENT_CSS = `
@keyframes pk-vent-fly { 0% { transform: translate(-12vw, 0) rotate(0deg) } 25% { transform: translate(18vw, var(--y1)) rotate(calc(var(--r) * .3)) }
  50% { transform: translate(48vw, var(--y2)) rotate(calc(var(--r) * .55)) } 75% { transform: translate(78vw, var(--y1)) rotate(calc(var(--r) * .8)) }
  100% { transform: translate(112vw, var(--y3)) rotate(var(--r)) } }
@keyframes pk-vent-flutter { 0%, 100% { transform: rotateX(0deg) } 50% { transform: rotateX(65deg) } }
@keyframes pk-vent-streak { 0% { transform: translateX(-30vw) scaleX(.4); opacity: 0 } 20% { opacity: .55 } 100% { transform: translateX(120vw) scaleX(1.2); opacity: 0 } }
`;
const LEAF_COLORS = ["#e67e22", "#d35400", "#a3b82b", "#c0392b", "#f1c40f", "#b7791f"];
function Vent({ done }) {
  const s = useStage(done);
  const [msg, setMsg] = useState(1);
  const leaves = useMemo(() => Array.from({ length: 34 }, (_, i) => ({ top: rand(4, 84), dur: rand(1.6, 3), delay: rand(.3, 4.6),
    y1: rand(-60, 60), y2: rand(-80, 80), y3: rand(-40, 90), r: rand(300, 900) * (Math.random() < .5 ? -1 : 1),
    c: LEAF_COLORS[i % LEAF_COLORS.length], sz: rand(16, 30), fl: rand(.3, .7) })), []);
  const streaks = useMemo(() => Array.from({ length: 10 }, () => ({ top: rand(5, 90), w: rand(80, 220), d: rand(.8, 1.4), dl: rand(.4, 5) })), []);
  useEffect(() => {
    const { ctl } = s;
    const H = vh();
    const e = "ease-in-out";
    ctl.cards(60).forEach(c => {
      const r = c.getBoundingClientRect();
      const k = rand(.6, 1.05);
      const at = (x, rot, sk) => `translateX(${(x * k).toFixed(1)}px) rotate(${(rot * k).toFixed(2)}deg) skewX(${(sk * k).toFixed(2)}deg)`;
      ctl.set(c, { "transform-origin": "0% 100%" });
      ctl.anim(c, [
        { transform: at(0, 0, 0), easing: e }, { transform: at(30, 3, -3), offset: .18, easing: e },
        { transform: at(95, 7, -6), offset: .36, easing: e }, { transform: at(70, 5, -3), offset: .5, easing: e },
        { transform: at(115, 8, -5), offset: .66, easing: e }, { transform: at(-12, -2, 1), offset: .86, easing: e },
        { transform: at(0, 0, 0) },
      ], { duration: 5600, delay: 800 + clamp(r.top / H, 0, 1) * 300, fill: "forwards" });
    });
    ctl.after(7000, () => { setMsg(2); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={VENT_CSS}>
      {streaks.map((k, i) => (
        <span key={i} style={{ position: "absolute", left: 0, top: `${k.top}%`, width: k.w, height: 2, borderRadius: 2,
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent)",
          animation: `pk-vent-streak ${k.d}s ease-in ${k.dl}s both` }}/>
      ))}
      {leaves.map((l, i) => (
        <span key={i} style={{ position: "absolute", left: 0, top: `${l.top}%`, "--y1": `${l.y1}px`, "--y2": `${l.y2}px`, "--y3": `${l.y3}px`,
          "--r": `${l.r}deg`, animation: `pk-vent-fly ${l.dur}s cubic-bezier(.3,.1,.6,1) ${l.delay}s both` }}>
          <svg width={l.sz} height={l.sz * .7} viewBox="0 0 28 18" aria-hidden="true" style={{ display: "block", animation: `pk-vent-flutter ${l.fl}s ease-in-out infinite` }}>
            <path d="M1 9 C 6 1, 18 0, 27 7 C 18 15, 7 17, 1 9 Z" fill={l.c}/>
            <path d="M1 9 L 24 7.5" stroke="rgba(0,0,0,.3)" strokeWidth="1"/>
          </svg>
        </span>
      ))}
      {msg === 1 && <Pill key="a" top>🍂 Coup de vent ! Pense à fermer la porte de l'enceinte.</Pill>}
      {msg === 2 && <Pill key="b" fade>Le vent est tombé. Tout est retombé à sa place.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 20. Ecran bleu
// ════════════════════════════════════════════════════════════════════════════
const BSOD_CSS = `
@keyframes pk-ecran-bleu-off { 0% { transform: scale(1, 1); filter: brightness(1) } 45% { transform: scale(1, .006); filter: brightness(3) }
  100% { transform: scale(0, .006); filter: brightness(4) } }
@keyframes pk-ecran-bleu-blink { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
`;
function EcranBleu({ done }) {
  const s = useStage(done);
  const [pct, setPct] = useState(0);
  const [phase, setPhase] = useState("bsod"); // bsod, won, rendu
  const [ready, setReady] = useState(false);
  const phaseRef = useRef("bsod"), readyRef = useRef(false), goRef = useRef(null);
  const qr = useMemo(() => {
    const n = 21, cells = [];
    const finder = (x, y) => {
      for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
        const dx = x - fx, dy = y - fy;
        if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) {
          const ring = Math.min(dx, dy, 6 - dx, 6 - dy);
          return ring === 0 || ring >= 2 ? 1 : 0;
        }
      }
      return -1;
    };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const f = finder(x, y);
      if (f === 1 || (f === -1 && Math.random() < .5)) cells.push([x, y]);
    }
    return cells;
  }, []);
  goRef.current = () => {
    if (!readyRef.current || phaseRef.current !== "bsod") return;
    phaseRef.current = "won"; setPhase("won"); s.finish();
  };
  useEffect(() => {
    const { ctl } = s;
    let v = 0;
    const tick = () => { v = Math.min(100, v + Math.round(rand(3, 17))); setPct(v); if (v < 100) ctl.after(rand(300, 650), tick); };
    ctl.after(700, tick);
    ctl.after(1200, () => { readyRef.current = true; setReady(true); });
    ctl.on(window, "keydown", () => goRef.current());
    ctl.after(45000, () => { if (phaseRef.current === "bsod") { phaseRef.current = "rendu"; setPhase("rendu"); } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const big = isNarrow() ? 72 : 120;
  return (
    <Layer s={s} css={BSOD_CSS}>
      <div onPointerDown={() => goRef.current()} role="dialog" aria-label="Écran bleu"
        style={{ position: "absolute", inset: 0, background: "#0078d7", color: "#fff", pointerEvents: phase === "bsod" ? "auto" : "none",
          cursor: ready ? "pointer" : "default", fontFamily: '"Segoe UI", system-ui, sans-serif', overflowY: "auto",
          padding: "max(48px, 9vh) max(20px, 9vw) 40px", animation: phase === "won" ? "pk-ecran-bleu-off .7s ease-in both"
            : phase === "rendu" ? "pk-kit-fade .9s ease both" : "pk-kit-fadein .15s linear both" }}>
        <div style={{ fontSize: big, lineHeight: 1, fontWeight: 300 }}>:(</div>
        <div style={{ marginTop: 28, fontSize: isNarrow() ? 19 : 26, lineHeight: 1.35, maxWidth: 820 }}>
          BambuNymous a rencontré un spaghetti et doit redémarrer. Nous collectons quelques informations sur la buse,
          puis nous redémarrerons pour toi.
        </div>
        <div style={{ marginTop: 22, fontSize: isNarrow() ? 19 : 26 }}>{pct} % effectué</div>
        <div style={{ marginTop: 30, display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <svg width="96" height="96" viewBox="-1 -1 23 23" style={{ background: "#fff", flexShrink: 0 }} aria-hidden="true">
            {qr.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill="#0078d7"/>)}
          </svg>
          <div style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 520 }}>
            <div>Pour en savoir plus, cherche plus tard en ligne ce code d'arrêt.</div>
            <div style={{ marginTop: 10 }}>Si tu appelles le support, donne-lui ces infos :</div>
            <div>Code d'arrêt : FILAMENT_NOT_FOUND</div>
            <div>Ce qui a échoué : spaghetti.sys</div>
          </div>
        </div>
        {ready && phase === "bsod" && (
          <div style={{ marginTop: 34, fontSize: 16, fontWeight: 600, animation: "pk-ecran-bleu-blink 1.4s ease-in-out infinite" }}>
            Appuie sur une touche ou touche l'écran pour continuer
          </div>
        )}
      </div>
      {phase === "won" && <Pill key="b" fade>Redémarrage réussi. Le spaghetti a été mangé.</Pill>}
      {phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 21. Fourmis
// ════════════════════════════════════════════════════════════════════════════
const FOURMIS_CSS = `
@keyframes pk-fourmis-legs { 0%, 100% { transform: skewX(16deg) } 50% { transform: skewX(-16deg) } }
`;
function Ant() {
  return (
    <svg width="24" height="14" viewBox="0 0 24 14" aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <g style={{ transformBox: "view-box", transformOrigin: "12px 7px", animation: "pk-fourmis-legs .18s linear infinite" }}
        stroke="#2b1a0e" strokeWidth="1.1" strokeLinecap="round">
        {[8, 11.5, 15].map((x, i) => (
          <g key={i}><line x1={x} y1="7" x2={x - 3} y2="1"/><line x1={x} y1="7" x2={x - 3} y2="13"/></g>
        ))}
      </g>
      <ellipse cx="5" cy="7" rx="4" ry="3.1" fill="#2b1a0e"/>
      <ellipse cx="11.5" cy="7" rx="2.6" ry="2.1" fill="#3b2412"/>
      <ellipse cx="17.6" cy="7" rx="2.9" ry="2.6" fill="#2b1a0e"/>
      <path d="M19.5 5.4 Q 22 2 24 2.6 M19.5 8.6 Q 22 12 24 11.4" fill="none" stroke="#2b1a0e" strokeWidth="1"/>
    </svg>
  );
}
function Fourmis({ done }) {
  const s = useStage(done);
  const N = useMemo(() => clamp(Math.round(vw() / 28), 12, 24), []);
  const MAXL = 16;
  const antRefs = useRef([]), letRefs = useRef([]);
  const [msg, setMsg] = useState(1);
  const [letters, setLetters] = useState([]);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh();
    const y0 = Math.min(H * .66, floorY() - 40);
    const pathY = x => y0 + 10 * Math.sin(x / 55);
    const slope = x => Math.atan(10 / 55 * Math.cos(x / 55)) * 180 / Math.PI;
    const targets = [];
    for (const n of shuffle(ctl.textNodes(400, 0))) {
      if (targets.length >= MAXL) break;
      const idx = [];
      for (let i = 0; i < n.data.length; i++) if (/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(n.data[i])) idx.push(i);
      if (!idx.length) continue;
      const off = pick(idx);
      const rg = document.createRange();
      rg.setStart(n, off); rg.setEnd(n, off + 1);
      const r = rg.getBoundingClientRect();
      if (!r.width || r.top < 56 || r.bottom > H - 90 || r.left < 4 || r.right > W - 4) continue;
      const cs = getComputedStyle(n.parentElement);
      targets.push({ node: n, orig: n.data, off, ch: n.data[off], x: r.left + r.width / 2, y: r.top + r.height / 2,
        font: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, color: cs.color, state: "text", ant: -1, t0: 0, fx: 0, fy: 0, px: 0, py: 0 });
    }
    setLetters(targets.map(t => ({ ch: t.ch, font: t.font, size: t.size, weight: t.weight, color: t.color })));
    const sp = 26, v = (W + N * sp + 80) / 4.2;
    const loads = new Array(N).fill(-1);
    const antAt = (j, t) => (t < 4.5 ? { x: -30 - j * sp + v * t, dir: 1 } : { x: W + 30 + j * sp - v * (t - 4.6), dir: -1 });
    const putBack = tg => { if (tg.state !== "dead") ctl.text(tg.node, tg.orig); tg.state = "home"; };
    ctl.loop(t => {
      const ants = [];
      for (let j = 0; j < N; j++) {
        const a = antAt(j, t), y = pathY(a.x);
        ants.push({ x: a.x, y, dir: a.dir });
        const el = antRefs.current[j];
        if (el) el.style.transform = `translate(${(a.x - 12).toFixed(1)}px,${(y - 7).toFixed(1)}px) rotate(${slope(a.x).toFixed(1)}deg) scaleX(${a.dir})`;
      }
      targets.forEach((tg, i) => {
        const el = letRefs.current[i];
        if (tg.state === "text" && t < 4.4) {
          for (let j = 0; j < N; j++) {
            const a = ants[j];
            if (loads[j] < 0 && a.x > 0 && a.x < W && Math.abs(a.x - tg.x) < 10) {
              const str = tg.orig.slice(0, tg.off) + " " + tg.orig.slice(tg.off + 1);
              if (!ctl.text(tg.node, str)) { tg.state = "dead"; break; }
              loads[j] = i; tg.ant = j; tg.state = "fly"; tg.t0 = t; tg.fx = tg.x; tg.fy = tg.y;
              break;
            }
          }
        }
        if (tg.ant >= 0) {
          const a = ants[tg.ant];
          const ax = a.x, ay = a.y - 11;
          if (tg.state === "fly") {
            const u = clamp((t - tg.t0) / .55, 0, 1), e = easeInOut(u);
            tg.px = lerp(tg.fx, ax, e); tg.py = lerp(tg.fy, ay, e) - 40 * Math.sin(Math.PI * u);
            if (u >= 1) tg.state = "carried";
          } else if (tg.state === "carried") {
            tg.px = ax; tg.py = ay + Math.sin(t * 14 + i) * 1.2;
            if (t >= 4.6 && Math.abs(ax - tg.x) < 10) { tg.state = "back"; tg.t0 = t; tg.fx = tg.px; tg.fy = tg.py; loads[tg.ant] = -1; }
          } else if (tg.state === "back") {
            const u = clamp((t - tg.t0) / .55, 0, 1), e = easeInOut(u);
            tg.px = lerp(tg.fx, tg.x, e); tg.py = lerp(tg.fy, tg.y, e) - 40 * Math.sin(Math.PI * u);
            if (u >= 1) putBack(tg);
          }
        }
        if (el) {
          const vis = tg.state === "fly" || tg.state === "carried" || tg.state === "back";
          el.style.opacity = vis ? "1" : "0";
          if (vis) el.style.transform = `translate(${tg.px.toFixed(1)}px,${tg.py.toFixed(1)}px) translate(-50%,-50%)`;
        }
      });
      if (t > 9.3) {
        targets.forEach(tg => { if (tg.state !== "home" && tg.state !== "dead" && tg.state !== "text") putBack(tg); });
        setMsg(2); s.finish(); return false;
      }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={FOURMIS_CSS}>
      {Array.from({ length: N }, (_, j) => (
        <div key={j} ref={el => { antRefs.current[j] = el; }} style={{ position: "absolute", left: 0, top: 0, transform: "translate(-100px,-100px)" }}>
          <Ant/>
        </div>
      ))}
      {letters.map((l, i) => (
        <span key={i} ref={el => { letRefs.current[i] = el; }} style={{ position: "absolute", left: 0, top: 0, opacity: 0,
          fontFamily: l.font, fontSize: l.size, fontWeight: l.weight, color: l.color, lineHeight: 1, whiteSpace: "pre",
          textShadow: "0 1px 2px rgba(0,0,0,.35)" }}>{l.ch}</span>
      ))}
      {msg === 1 && <Pill key="a" top>🐜 Les fourmis font leurs courses… au rayon lettres.</Pill>}
      {msg === 2 && <Pill key="b" fade>Elles ont tout rapporté. Honnêtes, les fourmis.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 22. Canicule
// ════════════════════════════════════════════════════════════════════════════
const CANICULE_CSS = `
@keyframes pk-canicule-drip { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes pk-canicule-drop { 0% { transform: translate(-50%, 0) scale(1); opacity: 1 } 100% { transform: translate(-50%, var(--fall)) scale(.7); opacity: 0 } }
@keyframes pk-canicule-fan { from { transform: translateX(160%) } to { transform: translateX(0) } }
@keyframes pk-canicule-wind { 0% { transform: translateX(0) scaleX(.3); opacity: 0 } 30% { opacity: .75 } 100% { transform: translateX(-90vw) scaleX(1); opacity: 0 } }
@keyframes pk-canicule-glow { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.08) } }
`;
function Canicule({ done }) {
  const s = useStage(done);
  const [phase, setPhase] = useState("chaud"); // chaud, fond, ventilo, frais
  const [drips, setDrips] = useState([]);
  useEffect(() => {
    const { ctl } = s;
    const parts = ctl.parts();
    const cards = ctl.tiles(14);
    ctl.after(400, () => parts.forEach(p => ctl.set(p, { filter: "url(#pk-canicule-f)" })));
    ctl.after(2400, () => {
      setPhase("fond");
      const H = vh(), list = [];
      cards.forEach((c, i) => {
        const r = c.getBoundingClientRect();
        ctl.set(c, { "transform-origin": "50% 0%" });
        ctl.anim(c, [{ transform: "scaleY(1) skewX(0deg)" }, { transform: "scaleY(1.08) skewX(1deg)", offset: .4 }, { transform: "scaleY(1.16) skewX(-1.5deg)" }],
          { duration: 2200, delay: i * 60, easing: "ease-in", fill: "forwards" });
        if (i < 10 && r.bottom < H) {
          for (let k = 0; k < 2; k++) {
            const w = rand(10, 18);
            list.push({ x: r.left + rand(.15, .85) * r.width, y: r.top + r.height * 1.16 - 6, w, h: rand(26, 72), dl: rand(.2, 1.1), fall: rand(60, 160) });
          }
        }
      });
      setDrips(list);
      ctl.after(2900, () => {
        cards.forEach((c, i) => ctl.anim(c, [{ transform: "scaleY(1.16) skewX(-1.5deg)" }, { transform: "scaleY(.97) skewX(0deg)", offset: .6 },
          { transform: "scaleY(1) skewX(0deg)" }], { duration: 900, delay: i * 40, easing: "cubic-bezier(.3,1.3,.5,1)", fill: "forwards" }));
      });
    });
    ctl.after(4800, () => setPhase("ventilo"));
    ctl.after(5700, () => { parts.forEach(p => ctl.unset(p, ["filter"])); setPhase("frais"); });
    ctl.after(7600, s.finish);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const hot = phase === "chaud" || phase === "fond";
  return (
    <Layer s={s} css={CANICULE_CSS}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <filter id="pk-canicule-f" x="-3%" y="-3%" width="106%" height="106%">
          <feTurbulence type="turbulence" baseFrequency="0.012 0.07" numOctaves="1" seed="7">
            <animate attributeName="baseFrequency" dur="2.2s" values="0.012 0.07;0.014 0.085;0.012 0.07" repeatCount="indefinite"/>
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="9"/>
        </filter>
      </svg>
      <div style={{ position: "absolute", inset: 0, opacity: hot ? 1 : phase === "ventilo" ? .4 : 0, transition: "opacity 1.4s ease",
        animation: "pk-kit-fadein 1.2s ease both",
        background: "linear-gradient(0deg, rgba(255,110,0,.30), rgba(255,170,0,.10) 55%, rgba(255,210,0,.06))" }}/>
      <div style={{ position: "absolute", inset: 0, opacity: phase === "ventilo" || phase === "frais" ? 1 : 0, transition: "opacity 1.2s ease",
        background: "linear-gradient(270deg, rgba(56,189,248,.22), rgba(186,230,253,.06))", ...(phase === "frais" ? { opacity: 0, transition: "opacity 1.8s ease .4s" } : {}) }}/>
      <div aria-hidden="true" style={{ position: "absolute", right: -40, top: 20, width: 170, height: 170, opacity: hot ? 1 : 0, transition: "opacity 1.4s ease" }}>
        <div style={{ position: "absolute", inset: 0, animation: "pk-kit-spin 12s linear infinite",
          background: "repeating-conic-gradient(rgba(253,224,71,.5) 0 8deg, transparent 8deg 22deg)", borderRadius: "50%",
          WebkitMaskImage: "radial-gradient(circle, transparent 38%, #000 40%, transparent 70%)", maskImage: "radial-gradient(circle, transparent 38%, #000 40%, transparent 70%)" }}/>
        <div style={{ position: "absolute", inset: 46, borderRadius: "50%", background: "radial-gradient(circle at 40% 40%, #fff7c2, #fde047 45%, #f59e0b)",
          boxShadow: "0 0 50px 12px rgba(253,186,40,.6)", animation: "pk-canicule-glow 1.6s ease-in-out infinite" }}/>
      </div>
      {drips.map((d, i) => (
        <div key={i} style={{ position: "absolute", left: d.x - d.w / 2, top: d.y, width: d.w, height: d.h, transformOrigin: "50% 0",
          background: "linear-gradient(90deg, rgba(148,163,184,.75), rgba(226,232,240,.55) 45%, rgba(148,163,184,.7))", border: "1px solid rgba(255,255,255,.35)", borderTop: "none",
          borderRadius: `0 0 ${d.w}px ${d.w}px`, opacity: phase === "fond" ? 1 : 0, transition: "opacity .5s ease",
          animation: `pk-canicule-drip 1.7s ease-in ${d.dl}s both` }}>
          <span style={{ position: "absolute", left: "50%", bottom: -d.w * .5, width: d.w * .75, height: d.w * .9, borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%",
            background: "rgba(203,213,225,.8)", border: "1px solid rgba(255,255,255,.4)", "--fall": `${d.fall}px`,
            animation: `pk-canicule-drop 1s ease-in ${(d.dl + 1.5).toFixed(2)}s both` }}/>
        </div>
      ))}
      {(phase === "ventilo" || phase === "frais") && (
        <div aria-hidden="true" style={{ position: "absolute", right: 16, bottom: "calc(100px + env(safe-area-inset-bottom, 0px))",
          animation: "pk-canicule-fan .7s cubic-bezier(.2,1,.4,1) both", opacity: phase === "frais" ? 0 : 1, transition: "opacity 1s ease 1s" }}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} style={{ position: "absolute", right: 70, top: 20 + i * 16, width: 140, height: 2, borderRadius: 2,
              background: "linear-gradient(270deg, rgba(186,230,253,.9), transparent)", transformOrigin: "100% 50%",
              animation: `pk-canicule-wind .9s ease-out ${(i * .13).toFixed(2)}s infinite` }}/>
          ))}
          <svg width="130" height="170" viewBox="0 0 130 170">
            <rect x="58" y="110" width="14" height="44" rx="4" fill="#64748b"/>
            <ellipse cx="65" cy="158" rx="40" ry="9" fill="#475569"/>
            <circle cx="65" cy="62" r="56" fill="rgba(226,232,240,.15)" stroke="#94a3b8" strokeWidth="4"/>
            <g style={{ transformBox: "view-box", transformOrigin: "65px 62px", animation: "pk-kit-spin .22s linear infinite" }}>
              {[0, 120, 240].map(a => (
                <ellipse key={a} cx="65" cy="34" rx="13" ry="26" fill="#38bdf8" opacity=".85" transform={`rotate(${a} 65 62)`}/>
              ))}
            </g>
            <circle cx="65" cy="62" r="9" fill="#e2e8f0"/>
            {[-40, -20, 0, 20, 40].map(dx => <line key={dx} x1={65 + dx} y1="10" x2={65 + dx} y2="114" stroke="rgba(148,163,184,.6)" strokeWidth="1.2"/>)}
          </svg>
        </div>
      )}
      {phase === "chaud" && <Pill key="a" top>🌡️ 47 °C dans l'atelier… même le PETG transpire.</Pill>}
      {phase === "fond" && <Pill key="b" top>Ça fond ! Température de transition vitreuse dépassée !</Pill>}
      {phase === "ventilo" && <Pill key="c" top>🌀 Ventilo de pièce à 100 % !</Pill>}
      {phase === "frais" && <Pill key="d" fade>❄️ Tout est refroidi. Pense à ouvrir la fenêtre la prochaine fois.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 23. Papier froisse
// ════════════════════════════════════════════════════════════════════════════
const PAPIER_CSS = `
@keyframes pk-papier-iron { from { transform: translateY(-30vh) } to { transform: translateY(110vh) } }
`;
function Papier({ done }) {
  const s = useStage(done);
  const [msg, setMsg] = useState(1);
  const ball = useRef(null), crease = useRef(null);
  const geo = useMemo(() => {
    const cols = 6, rows = 10, pts = [];
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
      const edge = x === 0 || y === 0 || x === cols || y === rows;
      pts.push([(x + (edge ? 0 : rand(-.35, .35))) / cols * 100, (y + (edge ? 0 : rand(-.35, .35))) / rows * 100]);
    }
    const tris = [];
    const P = (x, y) => pts[y * (cols + 1) + x];
    const shade = () => (Math.random() < .5 ? `rgba(0,0,0,${rand(.05, .3).toFixed(2)})` : `rgba(255,255,255,${rand(.05, .3).toFixed(2)})`);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const a = P(x, y), b = P(x + 1, y), c = P(x + 1, y + 1), d = P(x, y + 1);
      if (Math.random() < .5) { tris.push([[a, b, c], shade()]); tris.push([[a, c, d], shade()]); }
      else { tris.push([[a, b, d], shade()]); tris.push([[b, c, d], shade()]); }
    }
    const facets = Array.from({ length: 26 }, () => {
      const cx = rand(-50, 50), cy = rand(-50, 50);
      return [[cx, cy], [cx + rand(-30, 30), cy + rand(-30, 30)], [cx + rand(-30, 30), cy + rand(-30, 30)]];
    }).map(p => [p, Math.random() < .5 ? `rgba(0,0,0,${rand(.06, .22).toFixed(2)})` : `rgba(255,255,255,${rand(.2, .5).toFixed(2)})`]);
    return { tris, facets };
  }, []);
  useEffect(() => {
    const { ctl } = s;
    const W = vw();
    const parts = ctl.parts();
    const P = "perspective(900px) ";
    const CR = [
      { transform: P + "rotateX(0deg) rotateY(0deg) rotate(0deg) scale(1)", opacity: 1 },
      { transform: P + "rotateX(8deg) rotateY(-10deg) rotate(-2deg) scale(.92)", opacity: 1, offset: .25 },
      { transform: P + "rotateX(-14deg) rotateY(16deg) rotate(-6deg) scale(.72)", opacity: 1, offset: .5 },
      { transform: P + "rotateX(24deg) rotateY(-20deg) rotate(10deg) scale(.45)", opacity: 1, offset: .75 },
      { transform: P + "rotateX(40deg) rotateY(30deg) rotate(40deg) scale(.08)", opacity: 0 },
    ];
    parts.forEach(p => {
      ctl.set(p, { "transform-origin": ctl.originOf(p) });
      ctl.anim(p, CR, { duration: 2200, easing: "ease-in", fill: "forwards" });
    });
    if (crease.current) ctl.anim(crease.current, [{ opacity: 0 }, { opacity: .6, offset: .6 }, { opacity: 0 }], { duration: 1500, fill: "both" });
    const b = ball.current;
    if (b) {
      ctl.anim(b, [{ transform: "translate(0,0) scale(.2) rotate(0deg)", opacity: 0 }, { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 }],
        { duration: 400, delay: 1800, easing: "cubic-bezier(.3,1.5,.5,1)", fill: "forwards" });
      const dx1 = W * .22, dx2 = -W * .12, deg = d => (d / 60 * 57.3).toFixed(0);
      ctl.after(2300, () => ctl.anim(b, [
        { transform: "translate(0px,0) scale(1) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx1}px,0) scale(1) rotate(${deg(dx1)}deg)`, opacity: 1, offset: .45 },
        { transform: `translate(${dx2}px,0) scale(1) rotate(${deg(dx2)}deg)`, opacity: 1, offset: .8 },
        { transform: "translate(0px,0) scale(1) rotate(0deg)", opacity: 1 },
      ], { duration: 2100, easing: "ease-in-out", fill: "forwards" }));
      ctl.after(4400, () => ctl.anim(b, [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(2.6)", opacity: 0 }],
        { duration: 600, easing: "ease-in", fill: "forwards" }));
    }
    ctl.after(4500, () => {
      setMsg(2);
      parts.forEach(p => ctl.anim(p, CR.slice().reverse().map((k, i, arr) => ({ ...k, offset: i / (arr.length - 1) })),
        { duration: 1500, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" }));
    });
    ctl.after(5300, () => { if (crease.current) ctl.anim(crease.current, [{ opacity: .5 }, { opacity: 0 }], { duration: 1500, fill: "both" }); });
    ctl.after(6900, () => { setMsg(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const BR = 60;
  return (
    <Layer s={s} css={PAPIER_CSS}>
      <svg ref={crease} width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"
        style={{ position: "absolute", inset: 0, opacity: 0, mixBlendMode: "overlay" }}>
        {geo.tris.map(([pts, f], i) => <polygon key={i} points={pts.map(p => p.join(",")).join(" ")} fill={f}/>)}
      </svg>
      <div style={{ position: "absolute", left: "50%", top: "45%", width: BR * 2, height: BR * 2, marginLeft: -BR, marginTop: -BR }}>
        <svg ref={ball} width={BR * 2} height={BR * 2} viewBox="-60 -60 120 120" style={{ opacity: 0, overflow: "visible",
          filter: "drop-shadow(0 12px 14px rgba(0,0,0,.45))" }} aria-hidden="true">
          <defs><clipPath id="pk-papier-clip"><circle r="58"/></clipPath></defs>
          <circle r="58" fill="#f4f1ea"/>
          <g clipPath="url(#pk-papier-clip)">
            {geo.facets.map(([pts, f], i) => <polygon key={i} points={pts.map(p => p.join(",")).join(" ")} fill={f}/>)}
          </g>
          <circle r="58" fill="none" stroke="#cfcac0" strokeWidth="1.5"/>
        </svg>
      </div>
      {msg === 2 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "26vh", mixBlendMode: "overlay",
          background: "linear-gradient(180deg, transparent, rgba(255,255,255,.45), transparent)", animation: "pk-papier-iron 1.6s ease-in-out .9s both" }}/>
      )}
      {msg === 1 && <Pill key="a" top>📄 Ce G-code ne me plaît pas… *froisse, froisse*</Pill>}
      {msg === 2 && <Pill key="b" top>Bon, on le déplie et on le repasse…</Pill>}
      {msg === 3 && <Pill key="c" fade>Lissé, repassé, comme neuf. Ou presque.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 24. Loupe
// ════════════════════════════════════════════════════════════════════════════
function Loupe({ done }) {
  const s = useStage(done);
  const lensRef = useRef(null), worldRef = useRef(null), hostRef = useRef(null), wordRef = useRef(null);
  const [phase, setPhase] = useState("play"); // play, won, rendu
  const phaseRef = useRef("play");
  const Z = 3, R = isNarrow() ? 72 : 92;
  const word = useMemo(() => ({ x: rand(.1, .82) * vw(), y: rand(.2, .8) * vh(), rot: rand(-20, 20) }), []);
  const st = useRef({ x: vw() / 2, y: vh() / 2, touch: false });
  const place = useCallback(() => {
    const { x, y, touch } = st.current;
    const ly = touch ? y - R - 46 : y;
    if (lensRef.current) lensRef.current.style.transform = `translate(${(x - R).toFixed(1)}px,${(ly - R).toFixed(1)}px)`;
    if (worldRef.current) worldRef.current.style.transform = `translate(${(R - x * Z).toFixed(1)}px,${(R - y * Z).toFixed(1)}px) scale(${Z})`;
  }, [R]);
  useEffect(() => {
    const { ctl } = s;
    const main = ctl.main(), host = hostRef.current;
    if (main && host) {
      const mr = main.getBoundingClientRect();
      const clone = main.cloneNode(true);
      clone.querySelectorAll("[data-prank-layer]").forEach(n => n.remove());
      clone.querySelectorAll("[id]").forEach(n => n.removeAttribute("id"));
      clone.querySelectorAll("a,button,input,select,textarea,[tabindex]").forEach(n => n.setAttribute("tabindex", "-1"));
      clone.setAttribute("aria-hidden", "true");
      clone.setAttribute("inert", "");
      Object.assign(clone.style, { position: "absolute", left: mr.left + "px", top: mr.top + "px", width: mr.width + "px",
        height: mr.height + "px", margin: "0", overflow: "hidden", pointerEvents: "none" });
      host.appendChild(clone);
      clone.scrollTop = main.scrollTop;
      ctl.cleanup(() => { if (clone.parentNode) clone.parentNode.removeChild(clone); });
      ctl.on(main, "scroll", () => { clone.scrollTop = main.scrollTop; }, { passive: true });
    }
    place();
    ctl.after(45000, () => { if (phaseRef.current === "play") { phaseRef.current = "rendu"; setPhase("rendu"); } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const move = e => {
    if (phaseRef.current !== "play") return;
    st.current = { x: e.clientX, y: e.clientY, touch: e.pointerType !== "mouse" };
    place();
  };
  const down = e => {
    move(e);
    if (phaseRef.current !== "play" || !wordRef.current) return;
    const r = wordRef.current.getBoundingClientRect(), pad = e.pointerType === "mouse" ? 12 : 22;
    if (e.clientX > r.left - pad && e.clientX < r.right + pad && e.clientY > r.top - pad && e.clientY < r.bottom + pad) {
      phaseRef.current = "won"; setPhase("won"); s.finish();
    }
  };
  const wheel = e => { const m = s.ctl.main(); if (m) m.scrollTop += e.deltaY * (e.deltaMode === 1 ? 16 : 1); };
  const play = phase === "play";
  const wordStyle = { position: "absolute", left: word.x, top: word.y, fontSize: 5.5, fontWeight: 700, color: "var(--muted, #7c8ba1)",
    transform: `translate(-50%,-50%) rotate(${word.rot}deg)`, whiteSpace: "nowrap", fontFamily: FONT };
  return (
    <Layer s={s}>
      <span ref={wordRef} style={{ ...wordStyle, opacity: phase === "won" ? 0 : .85, transition: "opacity .3s" }}>coucou</span>
      <div onPointerMove={move} onPointerDown={down} onWheel={wheel} style={{ position: "absolute", inset: 0,
        pointerEvents: play ? "auto" : "none", touchAction: "none", cursor: "crosshair" }}/>
      <div ref={lensRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: R * 2, height: R * 2,
        opacity: play ? 1 : 0, transition: "opacity .5s ease", pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: R * 1.6, top: R * 1.6, width: 22, height: R * 1.1, borderRadius: 10,
          background: "linear-gradient(90deg, #3f2a14, #7c4a1e, #3f2a14)", transform: "rotate(-45deg)", transformOrigin: "50% 0" }}/>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", background: "var(--bg, #0f1117)" }}>
          <div ref={worldRef} style={{ position: "absolute", left: 0, top: 0, width: "100vw", height: "100vh", transformOrigin: "0 0" }}>
            <div ref={hostRef}/>
            <span style={{ ...wordStyle, opacity: .95 }}>coucou</span>
          </div>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%",
            background: "radial-gradient(circle at 30% 28%, rgba(255,255,255,.35), transparent 32%), radial-gradient(circle, transparent 62%, rgba(0,0,0,.25))" }}/>
        </div>
        <div style={{ position: "absolute", inset: -7, borderRadius: "50%", border: "8px solid #9ca3af",
          boxShadow: "inset 0 0 0 2px #e5e7eb, 0 10px 30px rgba(0,0,0,.5)" }}/>
      </div>
      {phase === "won" && (
        <div style={{ position: "absolute", left: word.x, top: word.y, transform: "translate(-50%,-50%)" }}>
          <div style={{ padding: "10px 16px", borderRadius: 16, background: "#fff", color: "#111827", fontWeight: 900, fontSize: 26,
            boxShadow: "0 10px 30px rgba(0,0,0,.4)", whiteSpace: "nowrap", animation: "pk-kit-pop .5s cubic-bezier(.2,1.5,.4,1) both" }}>coucou ! 👋</div>
        </div>
      )}
      {play && <Pill key="a" top>🔎 Un tout petit mot se cache sur la page. Trouve-le à la loupe et touche-le !</Pill>}
      {phase === "won" && <Pill key="b" fade>Bien vu ! Tu as l'œil d'un contrôleur qualité.</Pill>}
      {phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 25. Escargot
// ════════════════════════════════════════════════════════════════════════════
const ESCARGOT_CSS = `
@keyframes pk-escargot-eye { 0%, 100% { transform: rotate(-8deg) } 50% { transform: rotate(10deg) } }
@keyframes pk-escargot-shine { from { background-position: 0 0 } to { background-position: 240px 0 } }
@keyframes pk-escargot-body { 0%, 100% { transform: scaleX(1) } 50% { transform: scaleX(1.05) } }
`;
function Escargot({ done }) {
  const s = useStage(done);
  const snail = useRef(null), trail = useRef(null);
  const [msg, setMsg] = useState(1);
  useEffect(() => {
    const { ctl } = s;
    const main = ctl.main(), layer = ctl.layer();
    const RATE = .15, saved = new Map();
    const slow = () => {
      if (!document.getAnimations) return;
      document.getAnimations().forEach(a => {
        if (saved.has(a)) return;
        const tg = a.effect && a.effect.target;
        if (!tg || (layer && layer.contains(tg))) return;
        saved.set(a, a.playbackRate);
        try { a.playbackRate = a.playbackRate * RATE; } catch (e) { /* rien */ }
      });
    };
    const speedUp = () => { saved.forEach((r, a) => { try { a.playbackRate = r; } catch (e) { /* rien */ } }); saved.clear(); };
    ctl.cleanup(speedUp);
    const inMain = t => main && t && main.contains(t);
    ctl.on(window, "wheel", e => {
      if (!inMain(e.target)) return;
      e.preventDefault();
      main.scrollTop += e.deltaY * (e.deltaMode === 1 ? 16 : 1) * .12;
    }, { passive: false, capture: true });
    let ty = null;
    ctl.on(window, "touchstart", e => { ty = e.touches[0] ? e.touches[0].clientY : null; }, { passive: true, capture: true });
    ctl.on(window, "touchmove", e => {
      if (!inMain(e.target) || ty == null || !e.touches[0]) return;
      e.preventDefault();
      const y = e.touches[0].clientY;
      main.scrollTop += (ty - y) * .15;
      ty = y;
    }, { passive: false, capture: true });
    ctl.parts().forEach(p => ctl.set(p, { filter: "saturate(.75) contrast(.95)" }));
    const W = vw(), y = floorY() - 62;
    let lastSlow = -1;
    ctl.loop(t => {
      if (t - lastSlow > .3) { lastSlow = t; slow(); }
      const x = lerp(-130, W + 20, clamp(t / 9, 0, 1));
      if (snail.current) snail.current.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      if (trail.current) { trail.current.style.width = Math.max(0, x + 20).toFixed(0) + "px"; trail.current.style.top = (y + 50) + "px"; }
      if (t >= 9) {
        speedUp();
        ctl.parts().forEach(p => ctl.unset(p, ["filter"]));
        setMsg(2); s.finish(); return false;
      }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={ESCARGOT_CSS}>
      <div ref={trail} style={{ position: "absolute", left: 0, top: -100, height: 8, borderRadius: 4, opacity: msg === 1 ? .85 : 0,
        transition: "opacity 1.5s ease", backgroundSize: "240px 100%",
        background: "linear-gradient(90deg, rgba(226,232,240,.15), rgba(255,255,255,.75) 20%, rgba(186,230,253,.4) 40%, rgba(255,255,255,.8) 60%, rgba(226,232,240,.2) 80%, rgba(255,255,255,.6))",
        animation: "pk-escargot-shine 2.4s linear infinite", boxShadow: "0 0 8px rgba(255,255,255,.4)" }}/>
      <div ref={snail} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, transform: "translate(-200px,-200px)" }}>
        <svg width="110" height="62" viewBox="0 0 110 62" style={{ overflow: "visible" }}>
          <defs>
            <radialGradient id="pk-escargot-shell" cx=".4" cy=".35" r=".7">
              <stop offset="0" stopColor="#fcd34d"/><stop offset=".6" stopColor="#d97706"/><stop offset="1" stopColor="#92400e"/>
            </radialGradient>
          </defs>
          <g style={{ transformBox: "view-box", transformOrigin: "10px 54px", animation: "pk-escargot-body 1.8s ease-in-out infinite" }}>
            <path d="M6 56 Q 4 46 22 46 L 86 44 Q 100 42 100 30 Q 100 22 93 22 Q 86 22 86 32 L 84 40 Q 60 54 6 56 Z" fill="#c9b38a" stroke="#9c8660" strokeWidth="1.2"/>
            <g style={{ transformBox: "view-box", transformOrigin: "94px 26px", animation: "pk-escargot-eye 1.6s ease-in-out infinite" }}>
              <line x1="94" y1="24" x2="100" y2="6" stroke="#9c8660" strokeWidth="2.4" strokeLinecap="round"/>
              <line x1="90" y1="24" x2="90" y2="8" stroke="#9c8660" strokeWidth="2.4" strokeLinecap="round"/>
              <circle cx="100" cy="6" r="3.4" fill="#fff" stroke="#9c8660"/><circle cx="100.8" cy="6.2" r="1.6" fill="#111"/>
              <circle cx="90" cy="8" r="3.4" fill="#fff" stroke="#9c8660"/><circle cx="90.8" cy="8.2" r="1.6" fill="#111"/>
            </g>
            <path d="M93 33 Q 96 35 99 33" fill="none" stroke="#6b5a3e" strokeWidth="1.2" strokeLinecap="round"/>
          </g>
          <circle cx="48" cy="28" r="24" fill="url(#pk-escargot-shell)" stroke="#78350f" strokeWidth="1.5"/>
          <path d="M48 28 m0 -4 a4 4 0 1 1 -4 4 a8 8 0 1 1 8 8 a12 12 0 1 1 -12 -12 a16 16 0 1 1 16 16" fill="none" stroke="#78350f" strokeWidth="1.6"/>
        </svg>
      </div>
      <div style={{ position: "absolute", right: 14, top: "calc(64px + env(safe-area-inset-top, 0px))", padding: "6px 10px", borderRadius: 8,
        background: "rgba(0,0,0,.7)", color: "#fff", fontWeight: 800, fontSize: 13, fontFamily: "ui-monospace, Consolas, monospace",
        opacity: msg === 1 ? 1 : 0, transition: "opacity .6s ease" }}>▶ 0,15×</div>
      {msg === 1 && <Pill key="a" top>🐌 Mode impression lente : 2 mm/s. Patience…</Pill>}
      {msg === 2 && <Pill key="b" fade>Vitesse normale rétablie (300 mm/s, ouf).</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 26. Aspirateur
// ════════════════════════════════════════════════════════════════════════════
const ASPI_CSS = `
@keyframes pk-aspirateur-grow { from { transform: scale(0) } to { transform: scale(1) } }
@keyframes pk-aspirateur-burp { 0% { transform: scale(1) } 30% { transform: scale(1.35) } 60% { transform: scale(.85) } 100% { transform: scale(1) } }
@keyframes pk-aspirateur-shrink { from { transform: scale(1); opacity: 1 } to { transform: scale(0); opacity: 0 } }
@keyframes pk-aspirateur-word { 0% { transform: translate(-50%, -50%) scale(.2) rotate(-12deg); opacity: 0 } 40% { transform: translate(-50%, -50%) scale(1.25) rotate(6deg); opacity: 1 }
  80% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 1 } 100% { transform: translate(-50%, -50%) scale(1.1); opacity: 0 } }
`;
function Aspirateur({ done }) {
  const s = useStage(done);
  const [phase, setPhase] = useState("aspire"); // aspire, burp, recrache, fin
  const V = useMemo(() => ({ x: vw() / 2, y: vh() * .45 }), []);
  useEffect(() => {
    const { ctl } = s;
    const cards = ctl.cards(40).map(c => {
      const r = c.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(cx - V.x, cy - V.y), a0 = Math.atan2(cy - V.y, cx - V.x);
      const kf = [];
      for (let i = 0; i <= 10; i++) {
        const f = i / 10, R = d * Math.pow(1 - f, 1.3), a = a0 + f * Math.PI * 2.2;
        const px = V.x + Math.cos(a) * R, py = V.y + Math.sin(a) * R;
        kf.push({ transform: `translate(${(px - cx).toFixed(1)}px,${(py - cy).toFixed(1)}px) rotate(${(f * 540).toFixed(0)}deg) scale(${(1 - .96 * f).toFixed(3)})`,
          opacity: f > .85 ? +((1 - f) / .15).toFixed(2) : 1 });
      }
      return { c, d, kf };
    }).sort((a, b) => a.d - b.d);
    const step = cards.length ? Math.min(90, 1300 / cards.length) : 0;
    cards.forEach((o, i) => ctl.anim(o.c, o.kf, { duration: 1500, delay: 600 + i * step, easing: "cubic-bezier(.55,0,.85,.45)", fill: "forwards" }));
    ctl.after(3800, () => setPhase("burp"));
    ctl.after(4500, () => {
      setPhase("recrache");
      cards.forEach(o => ctl.anim(o.c, o.kf.slice().reverse(), { duration: 900, delay: rand(0, 450), easing: "cubic-bezier(.15,.75,.3,1)", fill: "forwards" }));
    });
    ctl.after(6200, () => setPhase("fin"));
    ctl.after(7300, s.finish);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const vAnim = phase === "aspire" ? "pk-aspirateur-grow .8s cubic-bezier(.2,1.3,.4,1) both"
    : phase === "burp" ? "pk-aspirateur-burp .55s ease-out both" : phase === "fin" ? "pk-aspirateur-shrink .6s ease-in both" : "none";
  return (
    <Layer s={s} css={ASPI_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", left: V.x - 130, top: V.y - 130, width: 260, height: 260, animation: vAnim }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", filter: "blur(4px)", animation: "pk-kit-spin .8s linear infinite",
          background: "conic-gradient(from 0deg, rgba(99,102,241,0), rgba(99,102,241,.6), rgba(236,72,153,0), rgba(14,165,233,.55), rgba(99,102,241,0))" }}/>
        <svg width="260" height="260" viewBox="0 0 260 260" style={{ position: "absolute", inset: 0, animation: "pk-kit-spin 1.3s linear infinite" }}>
          {[0, 90, 180, 270].map(a => (
            <path key={a} d="M130 130 Q 190 110 200 40" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="5" strokeLinecap="round" transform={`rotate(${a} 130 130)`}/>
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 70, borderRadius: "50%", background: "radial-gradient(circle, #000 0 35%, rgba(0,0,0,.6) 55%, transparent 72%)" }}/>
      </div>
      {phase === "burp" && (
        <div style={{ position: "absolute", left: V.x, top: V.y - 20, animation: "pk-aspirateur-word .9s ease-out both", fontWeight: 900,
          fontSize: 44, color: "#fde047", WebkitTextStroke: "2px #7c2d12", textShadow: "0 6px 0 #7c2d12", fontFamily: FONT, whiteSpace: "nowrap" }}>BURP !</div>
      )}
      {phase === "aspire" && <Pill key="a" top>🌀 Vrrrrrooooom… le bac à déchets de l'AMS a faim !</Pill>}
      {phase === "recrache" && <Pill key="b" top>Pardon. Je recrache tout.</Pill>}
      {phase === "fin" && <Pill key="c" fade>Tout est revenu à sa place. Même les miettes.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 27. Bulle de savon
// ════════════════════════════════════════════════════════════════════════════
const BULLE_CSS = `
@keyframes pk-bulle-drop { 0% { transform: translate(0,0) scale(1); opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) scale(.3); opacity: 0 } }
@keyframes pk-bulle-ring { 0% { transform: scale(1); opacity: .9 } 100% { transform: scale(1.5); opacity: 0 } }
`;
const BULLE_FLOAT = [
  { transform: "translate(0px,0px) scale(.9,.9)" }, { transform: "translate(0px,-14px) scale(.93,.87)", offset: .25 },
  { transform: "translate(6px,-6px) scale(.88,.92)", offset: .5 }, { transform: "translate(-5px,-12px) scale(.92,.89)", offset: .75 },
  { transform: "translate(0px,0px) scale(.9,.9)" },
];
function Bulle({ done }) {
  const s = useStage(done);
  const [phase, setPhase] = useState("play"); // play, won, rendu
  const phaseRef = useRef("play");
  const bubbleRef = useRef(null);
  const st = useRef({ parts: [], origins: [], floats: [] });
  const geo = useMemo(() => { const W = vw(), H = vh(); return { W, H, R: Math.min(W, H) * .44, diag: Math.hypot(W, H) }; }, []);
  const drops = useMemo(() => Array.from({ length: 22 }, (_, i) => {
    const a = i / 22 * Math.PI * 2, d = rand(60, 130);
    return { x: Math.cos(a) * geo.R * .9, y: Math.sin(a) * geo.R * .9, dx: Math.cos(a) * d, dy: Math.sin(a) * d, r: rand(4, 9) };
  }), [geo]);
  const circ = (i, rr) => { const o = st.current.origins[i]; return `circle(${rr.toFixed(0)}px at ${o.ox.toFixed(1)}px ${o.oy.toFixed(1)}px)`; };
  useEffect(() => {
    const { ctl } = s;
    const parts = ctl.parts();
    st.current.parts = parts;
    st.current.origins = parts.map(p => { const r = p.getBoundingClientRect(); return { ox: geo.W / 2 - r.left, oy: geo.H / 2 - r.top }; });
    parts.forEach((p, i) => {
      const o = st.current.origins[i];
      ctl.set(p, { "transform-origin": `${o.ox.toFixed(1)}px ${o.oy.toFixed(1)}px` });
      ctl.anim(p, [{ clipPath: circ(i, geo.diag), transform: "translate(0px,0px) scale(1,1)" }, { clipPath: circ(i, geo.R), transform: "translate(0px,0px) scale(.9,.9)" }],
        { duration: 1100, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" });
      if (!s.reduced) st.current.floats.push(ctl.anim(p, BULLE_FLOAT, { duration: 5200, delay: 1100, iterations: Infinity, easing: "ease-in-out" }));
    });
    const b = bubbleRef.current;
    if (b) {
      ctl.anim(b, [{ transform: "scale(2.2)", opacity: 0 }, { transform: "scale(.9,.9)", opacity: 1 }], { duration: 1100, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" });
      if (!s.reduced) ctl.anim(b, BULLE_FLOAT, { duration: 5200, delay: 1100, iterations: Infinity, easing: "ease-in-out" });
    }
    ctl.after(45000, () => { if (phaseRef.current === "play") { phaseRef.current = "rendu"; setPhase("rendu"); release(false); } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const release = burst => {
    const { ctl } = s;
    const { parts, floats } = st.current;
    const cur = parts.map(p => { try { return getComputedStyle(p).transform; } catch (e) { return "none"; } });
    floats.forEach(a => a && a.cancel());
    parts.forEach((p, i) => ctl.anim(p, [
      { clipPath: circ(i, geo.R), transform: !cur[i] || cur[i] === "none" ? "scale(.9)" : cur[i] },
      { clipPath: circ(i, geo.R * 1.8), transform: "scale(1.02)", offset: .6 },
      { clipPath: circ(i, geo.diag), transform: "scale(1)" },
    ], { duration: burst ? 600 : 1000, easing: "ease-out", fill: "forwards" }));
  };
  const pop = () => {
    if (phaseRef.current !== "play") return;
    phaseRef.current = "won"; setPhase("won"); release(true); s.finish();
  };
  return (
    <Layer s={s} css={BULLE_CSS}>
      {phase === "play" && (
        <div ref={bubbleRef} onPointerDown={pop} role="button" aria-label="Bulle de savon" style={{ position: "absolute",
          left: geo.W / 2 - geo.R, top: geo.H / 2 - geo.R, width: geo.R * 2, height: geo.R * 2, borderRadius: "50%", pointerEvents: "auto",
          cursor: "pointer", overflow: "hidden", touchAction: "manipulation",
          boxShadow: "inset 0 0 40px rgba(255,255,255,.35), inset 0 0 8px rgba(255,255,255,.7), 0 0 30px rgba(160,200,255,.3)",
          background: "radial-gradient(circle at 30% 25%, rgba(255,255,255,.8) 0 3%, rgba(255,255,255,0) 9%), radial-gradient(circle at 70% 78%, rgba(255,255,255,.35) 0 2%, rgba(255,255,255,0) 6%)" }}>
          <div style={{ position: "absolute", inset: "-20%", opacity: .45, mixBlendMode: "screen", animation: "pk-kit-spin 7s linear infinite",
            background: "conic-gradient(from 0deg, #ff6ec7, #ffd36e, #6effb0, #6ec5ff, #b06eff, #ff6ec7)",
            WebkitMaskImage: "radial-gradient(circle, transparent 46%, #000 62%)", maskImage: "radial-gradient(circle, transparent 46%, #000 62%)" }}/>
        </div>
      )}
      {phase === "won" && (
        <div style={{ position: "absolute", left: geo.W / 2, top: geo.H / 2 }}>
          <div style={{ position: "absolute", left: -geo.R, top: -geo.R, width: geo.R * 2, height: geo.R * 2, borderRadius: "50%",
            border: "3px solid rgba(255,255,255,.8)", animation: "pk-bulle-ring .5s ease-out both" }}/>
          {drops.map((d, i) => (
            <span key={i} style={{ position: "absolute", left: d.x - d.r, top: d.y - d.r, width: d.r * 2, height: d.r * 2, borderRadius: "50%",
              background: "radial-gradient(circle at 35% 30%, #fff, rgba(186,230,253,.5) 60%, rgba(186,230,253,.1))",
              "--dx": `${d.dx}px`, "--dy": `${d.dy}px`, animation: "pk-bulle-drop .7s ease-out both" }}/>
          ))}
          <div style={{ position: "absolute", left: 0, top: 0, transform: "translate(-50%,-50%)", fontWeight: 900, fontSize: 40, color: "#fff",
            textShadow: "0 4px 14px rgba(0,0,0,.5)", animation: "pk-kit-pop .4s ease-out both", fontFamily: FONT }}>POP !</div>
        </div>
      )}
      {phase === "play" && <Pill key="a" top>🫧 Ta page est dans une bulle de savon. Éclate-la !</Pill>}
      {phase === "won" && <Pill key="b" fade>Pop ! Il ne reste qu'une petite odeur de savon.</Pill>}
      {phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 28. Taches de filament
// ════════════════════════════════════════════════════════════════════════════
const TACHES_CSS = `
@keyframes pk-taches-splat { 0% { transform: scale(0) } 60% { transform: scale(1.15) } 100% { transform: scale(1) } }
@keyframes pk-taches-drip { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes pk-taches-wipe { 0% { transform: translateX(0) skewX(0deg); opacity: 1; filter: blur(0px) } 100% { transform: translateX(60px) skewX(-25deg) scaleX(1.4); opacity: 0; filter: blur(6px) } }
@keyframes pk-taches-sponge { 0% { transform: translate(-60px, 10px) rotate(-10deg); opacity: 0 } 25% { opacity: 1 } 100% { transform: translate(70px, -6px) rotate(10deg); opacity: 0 } }
@keyframes pk-taches-shine { 0% { transform: scale(0) rotate(0deg); opacity: 0 } 50% { transform: scale(1) rotate(90deg); opacity: 1 } 100% { transform: scale(.4) rotate(180deg); opacity: 0 } }
`;
function blobPath(r) {
  const n = 11, pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, rr = r * rand(.72, 1.12); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  let d = `M${m0[0].toFixed(1)} ${m0[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i], m = mid(p, pts[(i + 1) % n]);
    d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  return d + "Z";
}
function Taches({ done }) {
  const s = useStage(done);
  const [phase, setPhase] = useState("play");
  const phaseRef = useRef("play");
  const [wiped, setWiped] = useState({});
  const count = useRef(0);
  const spots = useMemo(() => {
    const W = vw(), H = vh(), out = [];
    const base = isNarrow() ? 30 : 46;
    for (let i = 0; i < 8; i++) {
      const r = base * rand(.8, 1.25);
      let p = null;
      for (let k = 0; k < 40; k++) {
        const c = { x: rand(r + 12, W - r - 12), y: rand(80 + r, H - 110 - r) };
        if (!out.some(o => Math.hypot(o.x - c.x, o.y - c.y) < (o.r + r) * 1.1) || k === 39) { p = c; break; }
      }
      out.push({ ...p, r, d: blobPath(r), c: FILAMENTS[i % FILAMENTS.length], dl: i * .22,
        sats: Array.from({ length: 5 }, () => { const a = rand(0, Math.PI * 2), dd = r * rand(1.15, 1.7); return { x: Math.cos(a) * dd, y: Math.sin(a) * dd, r: r * rand(.06, .16) }; }),
        drips: Array.from({ length: Math.random() < .5 ? 1 : 2 }, () => ({ x: rand(-r * .4, r * .4), w: r * rand(.14, .24), h: r * rand(.6, 1.2) })) });
    }
    return out;
  }, []);
  useEffect(() => {
    s.ctl.after(45000, () => { if (phaseRef.current === "play") { phaseRef.current = "rendu"; setPhase("rendu"); } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const wipe = i => {
    if (phaseRef.current !== "play" || wiped[i]) return;
    setWiped(w => ({ ...w, [i]: true }));
    count.current += 1;
    if (count.current >= spots.length) { phaseRef.current = "won"; setPhase("won"); s.finish(); }
  };
  const n = Object.keys(wiped).length;
  return (
    <Layer s={s} css={TACHES_CSS}>
      {spots.map((p, i) => {
        const gone = wiped[i] || phase === "rendu";
        return (
          <button key={i} onClick={() => wipe(i)} aria-label="Essuyer la tache" disabled={!!wiped[i]}
            style={{ position: "absolute", left: p.x - p.r * 1.3, top: p.y - p.r * 1.3, width: p.r * 2.6, height: p.r * 2.6, padding: 0,
              border: "none", background: "transparent", cursor: "pointer", pointerEvents: gone || phase !== "play" ? "none" : "auto", overflow: "visible" }}>
            <svg width={p.r * 2.6} height={p.r * 2.6} viewBox={`${-p.r * 1.3} ${-p.r * 1.3} ${p.r * 2.6} ${p.r * 2.6}`} aria-hidden="true"
              style={{ overflow: "visible", display: "block", animation: gone ? (phase === "rendu" ? "pk-kit-fade 1.2s ease both" : "pk-taches-wipe .6s ease-in both")
                : `pk-taches-splat .45s cubic-bezier(.2,1.5,.4,1) ${p.dl}s both`, filter: "drop-shadow(0 3px 4px rgba(0,0,0,.35))" }}>
              {p.drips.map((d, k) => (
                <rect key={k} x={d.x - d.w / 2} y={0} width={d.w} height={p.r * .5 + d.h} rx={d.w / 2} fill={p.c}
                  style={{ transformBox: "fill-box", transformOrigin: "50% 0", animation: `pk-taches-drip 2.5s ease-in ${(p.dl + .4).toFixed(2)}s both` }}/>
              ))}
              <path d={p.d} fill={p.c}/>
              {p.sats.map((c, k) => <circle key={k} cx={c.x} cy={c.y} r={c.r} fill={p.c}/>)}
              <ellipse cx={-p.r * .3} cy={-p.r * .35} rx={p.r * .28} ry={p.r * .14} fill="rgba(255,255,255,.35)" transform={`rotate(-25 ${-p.r * .3} ${-p.r * .35})`}/>
            </svg>
            {wiped[i] && (
              <>
                <span aria-hidden="true" style={{ position: "absolute", left: "35%", top: "30%", fontSize: 34, animation: "pk-taches-sponge .6s ease-out both" }}>🧽</span>
                <span aria-hidden="true" style={{ position: "absolute", left: "45%", top: "40%", fontSize: 22, animation: "pk-taches-shine .7s ease-out .3s both" }}>✨</span>
              </>
            )}
          </button>
        );
      })}
      {phase === "play" && <Pill key="a" top>🎨 La buse s'est débouchée d'un coup ! Essuie les taches : {n}/{spots.length}</Pill>}
      {phase === "won" && <Pill key="b" fade>✨ Nickel ! Plateau et écran propres.</Pill>}
      {phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 29. Domino
// ════════════════════════════════════════════════════════════════════════════
const DOMINO_CSS = `
@keyframes pk-domino-tac { 0% { transform: translate(-50%, 0) scale(.4); opacity: 0 } 30% { transform: translate(-50%, -12px) scale(1.1); opacity: 1 }
  100% { transform: translate(-50%, -26px) scale(1); opacity: 0 } }
`;
function Domino({ done }) {
  const s = useStage(done);
  const [msg, setMsg] = useState(1);
  const [tacs, setTacs] = useState([]);
  useEffect(() => {
    const { ctl } = s;
    const cards = ctl.cards(36).map(c => ({ c, r: c.getBoundingClientRect() }))
      .sort((a, b) => (Math.abs(a.r.top - b.r.top) > 12 ? a.r.top - b.r.top : a.r.left - b.r.left));
    const n0 = cards.length;
    const n = cards.length, step = Math.min(200, 3000 / Math.max(n0, 1)), dur = 600;
    const P = "perspective(900px) ";
    const tl = [];
    cards.forEach(({ c, r }, i) => {
      ctl.set(c, { "transform-origin": "50% 100%" });
      ctl.anim(c, [
        { transform: P + "rotateX(0deg)", easing: "cubic-bezier(.55,0,1,.45)" },
        { transform: P + "rotateX(-82deg)", offset: .8, easing: "ease-out" },
        { transform: P + "rotateX(-72deg)", offset: .9, easing: "ease-in" },
        { transform: P + "rotateX(-80deg)" },
      ], { duration: dur, delay: 200 + i * step, fill: "forwards" });
      tl.push({ x: r.left + r.width / 2, y: Math.min(r.bottom, vh() - 120), dl: (200 + i * step + dur * .8) / 1000 });
    });
    setTacs(tl);
    const rise = 200 + n * step + dur + 1900;
    cards.forEach(({ c }, i) => {
      ctl.anim(c, [{ transform: P + "rotateX(-80deg)" }, { transform: P + "rotateX(8deg)", offset: .75 }, { transform: P + "rotateX(0deg)" }],
        { duration: 650, delay: rise + (n - 1 - i) * Math.min(130, 1600 / Math.max(n, 1)), easing: "cubic-bezier(.3,0,.4,1)", fill: "forwards" });
    });
    ctl.after(rise - 600, () => setMsg(2));
    ctl.after(rise + (Math.max(n, 1) - 1) * Math.min(130, 1600 / Math.max(n, 1)) + 800, () => { setMsg(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={DOMINO_CSS}>
      {tacs.map((t, i) => (
        <span key={i} style={{ position: "absolute", left: t.x, top: t.y - 10, fontWeight: 900, fontSize: 18, color: "#fde047",
          textShadow: "0 2px 6px rgba(0,0,0,.6)", animation: `pk-domino-tac .7s ease-out ${t.dl.toFixed(2)}s both`, fontFamily: FONT }}>
          {i % 2 ? "tac !" : "toc !"}
        </span>
      ))}
      {msg === 1 && <Pill key="a" top>🁢 Effet domino : une carte pousse l'autre…</Pill>}
      {msg === 2 && <Pill key="b" top>Et on remonte tout, dans l'autre sens.</Pill>}
      {msg === 3 && <Pill key="c" fade>Tout le monde debout. Personne n'a rien vu.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 30. Ombres (une journee qui passe)
// ════════════════════════════════════════════════════════════════════════════
const OMBRE_CSS = `
@keyframes pk-ombre-tw { 0%, 100% { opacity: .2 } 50% { opacity: 1 } }
`;
function parseRgb(str, fb) {
  const m = /rgba?\(([^)]+)\)/.exec(str || "");
  if (!m) return fb;
  const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return v.length >= 3 && !(v.length > 3 && v[3] === 0) ? v.slice(0, 3) : fb;
}
function Ombre({ done }) {
  const s = useStage(done);
  const sunRef = useRef(null), moonRef = useRef(null), nightRef = useRef(null);
  const [msg, setMsg] = useState(1);
  const stars = useMemo(() => Array.from({ length: 50 }, () => ({ x: rand(0, 100), y: rand(0, 70), r: rand(1, 2.6), d: rand(1, 3) })), []);
  useEffect(() => {
    const { ctl } = s;
    const main = ctl.main();
    const W = vw(), H = vh(), T = 8.6;
    const light = isLight();
    const base = parseRgb(main ? getComputedStyle(main).backgroundColor : "", light ? [240, 244, 248] : [15, 17, 23]);
    const S = light ? [
      [0, base, base], [.08, [254, 205, 160], [253, 186, 116]], [.3, [186, 230, 253], [224, 242, 254]], [.45, [147, 197, 253], [219, 234, 254]],
      [.6, [253, 164, 175], [251, 146, 60]], [.68, [30, 41, 82], [51, 65, 110]], [.85, [30, 41, 82], [51, 65, 110]],
      [.93, [254, 205, 160], [253, 186, 116]], [1, base, base],
    ] : [
      [0, base, base], [.08, [42, 27, 74], [194, 65, 12]], [.3, [30, 58, 138], [56, 110, 180]], [.45, [23, 55, 140], [40, 100, 190]],
      [.6, [76, 29, 149], [234, 88, 12]], [.68, [3, 7, 30], [15, 23, 42]], [.85, [3, 7, 30], [15, 23, 42]],
      [.93, [42, 27, 74], [180, 83, 9]], [1, base, base],
    ];
    const sky = u => {
      let i = 0;
      while (i < S.length - 2 && u > S[i + 1][0]) i++;
      const [u0, t0, b0] = S[i], [u1, t1, b1] = S[i + 1];
      const k = clamp((u - u0) / (u1 - u0), 0, 1);
      const mix = (a, b) => a.map((v, j) => Math.round(lerp(v, b[j], k))).join(",");
      return `linear-gradient(180deg, rgb(${mix(t0, t1)}) 0%, rgb(${mix(b0, b1)}) 100%)`;
    };
    // ombres des cartes, en une seule animation
    const shadowAt = u => {
      const p = (u - .05) / .57;
      if (p <= 0 || p >= 1) return "0px 0px 0px rgba(0,0,0,0)";
      const e = Math.sin(Math.PI * p), L = 10 + 70 * (1 - e);
      const dx = L * Math.cos(Math.PI * p), dy = 8 + 10 * e + 6 * (1 - e);
      const a = .5 * Math.min(1, p * 6, (1 - p) * 6);
      return `${dx.toFixed(1)}px ${dy.toFixed(1)}px ${(12 + L * .25).toFixed(1)}px rgba(0,0,0,${a.toFixed(2)})`;
    };
    ctl.tiles(30).forEach(c => {
      const orig = getComputedStyle(c).boxShadow;
      const kf = [];
      for (let i = 0; i <= 30; i++) { const u = i / 30; kf.push({ boxShadow: i === 0 || i === 30 ? orig : shadowAt(u) }); }
      ctl.anim(c, kf, { duration: T * 1000, easing: "linear" });
    });
    let shown = 1;
    ctl.loop(t => {
      const u = clamp(t / T, 0, 1);
      if (main) ctl.set(main, { background: sky(u) });
      const p = (u - .05) / .57;
      if (sunRef.current) {
        const vis = p > 0 && p < 1;
        sunRef.current.style.opacity = vis ? Math.min(1, p * 8, (1 - p) * 8).toFixed(2) : "0";
        if (vis) sunRef.current.style.transform = `translate(${(W * (.06 + .88 * p) - 34).toFixed(1)}px,${(64 + H * .3 * (1 - Math.sin(Math.PI * p)) - 34).toFixed(1)}px)`;
      }
      const q = (u - .64) / .28;
      if (moonRef.current) {
        const vis = q > 0 && q < 1;
        moonRef.current.style.opacity = vis ? Math.min(1, q * 6, (1 - q) * 6).toFixed(2) : "0";
        if (vis) moonRef.current.style.transform = `translate(${(W * (.08 + .84 * q) - 22).toFixed(1)}px,${(70 + H * .22 * (1 - Math.sin(Math.PI * q)) - 22).toFixed(1)}px)`;
      }
      const night = u < .62 ? 0 : u < .7 ? (u - .62) / .08 : u < .86 ? 1 : u < .95 ? 1 - (u - .86) / .09 : 0;
      if (nightRef.current) nightRef.current.style.opacity = night.toFixed(3);
      if (u > .64 && shown === 1) { shown = 2; setMsg(2); }
      if (u > .9 && shown === 2) { shown = 3; setMsg(3); }
      if (u >= 1) { if (main) ctl.unset(main, ["background"]); setMsg(4); s.finish(); return false; }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={OMBRE_CSS}>
      <div ref={nightRef} style={{ position: "absolute", inset: 0, opacity: 0, background: "rgba(5,10,35,.45)" }}>
        {stars.map((st, i) => (
          <span key={i} style={{ position: "absolute", left: `${st.x}%`, top: `${st.y}%`, width: st.r, height: st.r, borderRadius: "50%",
            background: "#fff", animation: `pk-ombre-tw ${st.d}s ease-in-out infinite` }}/>
        ))}
      </div>
      <div ref={sunRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 68, height: 68, borderRadius: "50%", opacity: 0,
        background: "radial-gradient(circle at 40% 40%, #fffbe0, #fde047 45%, #f59e0b)", boxShadow: "0 0 60px 18px rgba(253,200,60,.55)" }}/>
      <div ref={moonRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 44, height: 44, borderRadius: "50%", opacity: 0,
        background: "radial-gradient(circle at 35% 35%, #f8fafc, #cbd5e1)", boxShadow: "0 0 30px 6px rgba(226,232,240,.35), inset -8px -4px 0 rgba(148,163,184,.5)" }}/>
      {msg === 1 && <Pill key="a" top>☀️ Une journée à l'atelier, en accéléré.</Pill>}
      {msg === 2 && <Pill key="b" top>🌙 Bonne nuit… l'imprimante, elle, ne dort jamais.</Pill>}
      {msg === 3 && <Pill key="c" top>🌅 Et le jour se lève !</Pill>}
      {msg === 4 && <Pill key="d" fade>Une impression de 24 h en 9 secondes. Record battu.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Export
// ════════════════════════════════════════════════════════════════════════════
const tint = c => `radial-gradient(ellipse at center, ${c}, transparent 75%)`;
export const PRANKS = {
  "tsunami": { label: "Tsunami", Effect: softly(Tsunami, { emoji: "🌊", text: "Alerte humidité ! (version au calme)", tint: tint("rgba(56,189,248,.35)"), end: "Tout est sec." }) },
  "seisme": { label: "Séisme", Effect: softly(Seisme, { emoji: "📈", text: "Petit séisme ressenti… tout tient bon.", tint: tint("rgba(180,160,130,.3)") }) },
  "tete-en-bas": { label: "Tête en bas", Effect: TeteEnBas },
  "panne": { label: "Panne de courant", Effect: Panne },
  "melange": { label: "Mélange", Effect: Melange },
  "gravite": { label: "Gravité", Effect: softly(Gravite, { emoji: "🍎", text: "La gravité a eu un petit coup de mou.", tint: tint("rgba(239,68,68,.22)") }) },
  "miroir": { label: "Miroir", Effect: softly(Miroir, { emoji: "🪞", text: "Miroir, mon beau miroir…", tint: tint("rgba(186,230,253,.3)") }) },
  "blizzard": { label: "Blizzard", Effect: Blizzard },
  "brouillard": { label: "Brouillard", Effect: Brouillard },
  "fete": { label: "Fête", Effect: softly(Fete, { emoji: "🎉", text: "1000e impression réussie !", tint: tint("rgba(236,72,153,.28)") }) },
  "tornade": { label: "Tornade", Effect: softly(Tornade, { emoji: "🌪️", text: "Une tornade est passée au loin.", tint: tint("rgba(148,163,184,.3)") }) },
  "aimant": { label: "Aimant", Effect: softly(Aimant, { emoji: "🧲", text: "Tes cartes sont aimantées.", tint: tint("rgba(239,68,68,.22)") }) },
  "fantome": { label: "Fantômes", Effect: Fantome },
  "pixel": { label: "Pixel", Effect: Pixel },
  "vieux-film": { label: "Vieux film", Effect: VieuxFilm },
  "glitch": { label: "Glitch", Effect: softly(Glitch, { emoji: "👾", text: "Erreur 3D : couche non trouvée… réparée.", tint: tint("rgba(168,85,247,.28)") }) },
  "toile": { label: "Toile d'araignée", Effect: Toile },
  "apesanteur": { label: "Apesanteur", Effect: softly(Apesanteur, { emoji: "🧑‍🚀", text: "Houston, on a un problème de gravité.", tint: tint("rgba(99,102,241,.25)") }) },
  "vent": { label: "Coup de vent", Effect: softly(Vent, { emoji: "🍂", text: "Un coup de vent… pense à fermer l'enceinte.", tint: tint("rgba(234,179,8,.22)") }) },
  "ecran-bleu": { label: "Écran bleu", Effect: EcranBleu },
  "fourmis": { label: "Fourmis", Effect: softly(Fourmis, { emoji: "🐜", text: "Des fourmis sont passées… elles n'ont rien pris.", tint: tint("rgba(120,53,15,.25)") }) },
  "canicule": { label: "Canicule", Effect: softly(Canicule, { emoji: "🌡️", text: "47 °C dans l'atelier… ventilo activé.", tint: tint("rgba(249,115,22,.28)") }) },
  "papier": { label: "Papier froissé", Effect: softly(Papier, { emoji: "📄", text: "Ce G-code a failli finir à la corbeille.", tint: tint("rgba(244,241,234,.2)") }) },
  "loupe": { label: "Loupe", Effect: Loupe },
  "escargot": { label: "Escargot", Effect: Escargot },
  "aspirateur": { label: "Aspirateur", Effect: softly(Aspirateur, { emoji: "🌀", text: "Le bac à déchets a eu un petit creux. Burp.", tint: tint("rgba(99,102,241,.28)") }) },
  "bulle": { label: "Bulle de savon", Effect: Bulle },
  "taches": { label: "Taches", Effect: Taches },
  "domino": { label: "Domino", Effect: softly(Domino, { emoji: "🁢", text: "Effet domino évité de justesse.", tint: tint("rgba(234,179,8,.2)") }) },
  "ombre": { label: "Ombres", Effect: Ombre },
};

// Boite a outils partagee avec les autres lots de farces (pranks2, pranks3) :
// calque, legende, remise en etat garantie au demontage, version douce.
export { useStage, Layer, Pill, GiveUp, softly, Soft, prefersReduced, rand, pick, tint, FONT, FILAMENTS };
