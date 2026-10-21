import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStage, Layer, Pill, softly, rand, pick, tint, FONT, FILAMENTS } from "./pranks";

// Farces, deuxieme lot (22/10/2026). Meme contrat que pranks.jsx :
// PRANKS[slug] = { label, Effect } ; Effect recoit `done`, a appeler une seule
// fois quand la farce est terminee. Tout ce qui touche au DOM de l'appli passe
// par le controleur `ctl` de useStage (remis exactement en etat au demontage).
// Les copies de la page (zoom, kaleidoscope, briques) et les lettres recopiees
// vivent dans le calque : elles disparaissent avec lui.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;
const smooth = t => t * t * (3 - 2 * t);
const vw = () => window.innerWidth;
const vh = () => window.innerHeight;
const isNarrow = () => window.innerWidth < 768;
const floorY = () => vh() - (isNarrow() ? 86 : 14);
const isLight = () => document.documentElement.getAttribute("data-theme") === "light";
const shuffle = arr => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
};
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const RAINBOW = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"];
// Ordre de lecture (haut en bas, puis gauche a droite)
const byReading = (a, b) => (Math.abs(a.r.top - b.r.top) > 12 ? a.r.top - b.r.top : a.r.left - b.r.left);
const withRects = list => list.map(c => ({ c, r: c.getBoundingClientRect() }));
// Les cartes entieres de la page (ctl.tiles ; ctl.cards dans les versions
// ou elle rendait encore les cartes et non leurs morceaux).
const tilesOf = (ctl, n) => (typeof ctl.tiles === "function" ? ctl.tiles(n) : ctl.cards(n));
// Petit tremblement (images-cles), revient a zero
const jitter = (amp, n = 10, rot = 0) => Array.from({ length: n }, (_, i) => {
  if (i === 0 || i === n - 1) return { transform: "translate(0px,0px) rotate(0deg)" };
  const a = amp * (1 - i / n);
  return { transform: `translate(${rand(-a, a).toFixed(1)}px,${rand(-a, a).toFixed(1)}px) rotate(${rand(-rot, rot).toFixed(2)}deg)` };
});
// Ombre portee : on ajoute la notre devant celle d'origine, liste de meme forme
// au depart et a l'arrivee pour que l'interpolation reste continue.
const shadowPair = (el, zero, on) => {
  let o = "";
  try { o = getComputedStyle(el).boxShadow; } catch (e) { o = ""; }
  const tail = o && o !== "none" ? ", " + o : "";
  return [zero + tail, on + tail];
};
// Fond opaque de la page (le fond de main, sinon celui du body)
function pageBg(main) {
  const clear = v => !v || v === "transparent" || /rgba\([^)]*,\s*0\)$/.test(v);
  try {
    const a = main ? getComputedStyle(main).backgroundColor : "";
    if (!clear(a)) return a;
    const b = getComputedStyle(document.body).backgroundColor;
    if (!clear(b)) return b;
  } catch (e) { /* rien */ }
  return isLight() ? "#f0f4f8" : "#0f1117";
}

// Socle commun : useStage de pranks.jsx, plus un dernier passage apres sa
// remise en etat. Chrome laisse parfois un attribut style="" vide sur un
// element qui n'en avait pas (cssText vide puis removeAttribute sans
// relecture de l'attribut) : on le retire, pour un DOM strictement identique.
function useStage2(done) {
  const s = useStage(done);
  const seen = useRef(null);
  if (!seen.current) {
    const map = new Map();
    seen.current = map;
    const set0 = s.ctl.set;
    s.ctl.set = (el, props) => {
      if (el && !s.ctl.dead && !map.has(el)) map.set(el, el.hasAttribute("style"));
      return set0(el, props);
    };
  }
  const sweep = () => seen.current.forEach((had, el) => {
    try { if (!had && el.getAttribute("style") === "") el.removeAttribute("style"); } catch (e) { /* rien */ }
  });
  useEffect(() => { if (s.left) sweep(); }, [s.left]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => sweep, []); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

// ── Lettres recopiees ───────────────────────────────────────────────────────
// Chaque lettre visible du texte de l'appli est recopiee a sa place exacte dans
// le calque (meme police, meme couleur), puis le texte d'origine devient
// transparent : on anime les copies sans jamais toucher a la mise en page.
function buildLetters(ctl, host, max = 1600) {
  const out = { list: [], parents: [], hide() {}, show() {} };
  const main = ctl.main();
  if (!main || !host) return out;
  const W = vw(), H = vh();
  const mr = main.getBoundingClientRect();
  const root = [Math.max(0, mr.left), Math.max(0, mr.top), Math.min(W, mr.right), Math.min(H, mr.bottom), 1];
  const clips = new Map();
  // zone visible (overflow des ancetres) et opacite cumulee
  const clipOf = el => {
    if (!el || el === main || !main.contains(el)) return root;
    if (clips.has(el)) return clips.get(el);
    const up = clipOf(el.parentElement);
    const cs = getComputedStyle(el);
    const o = parseFloat(cs.opacity);
    let c = [up[0], up[1], up[2], up[3], up[4] * (isNaN(o) ? 1 : o)];
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
      const r = el.getBoundingClientRect();
      c = [Math.max(c[0], r.left), Math.max(c[1], r.top), Math.min(c[2], r.right), Math.min(c[3], r.bottom), c[4]];
    }
    clips.set(el, c);
    return c;
  };
  const styles = new Map();
  const rg = document.createRange();
  const frag = document.createDocumentFragment();
  const done = new Set();
  // une suite de caracteres : chaque lettre devient une copie (false : plus de place)
  const take = node => {
    done.add(node);
    const data = node.data;
    if (out.list.length + data.length > max) return false;
    const p = node.parentElement;
    let st = styles.get(p);
    if (st === undefined) {
      const cs = getComputedStyle(p);
      const fill = cs.webkitTextFillColor;
      st = cs.visibility !== "visible" || (fill && fill !== cs.color) ? null : {
        css: `font-style:${cs.fontStyle};font-weight:${cs.fontWeight};font-size:${cs.fontSize};font-family:${cs.fontFamily};` +
          `letter-spacing:${cs.letterSpacing};font-variant-numeric:${cs.fontVariantNumeric};`,
        color: cs.color, ff: cs.fontFamily, tt: cs.textTransform, clip: clipOf(p),
      };
      styles.set(p, st);
    }
    if (!st || st.clip[4] < 0.05) return true;
    const start = out.list.length;
    let prev = false;
    for (let i = 0; i < data.length; i++) {
      const code = data.charCodeAt(i);
      const len = code >= 0xd800 && code <= 0xdbff ? 2 : 1;
      let ch = data.slice(i, i + len);
      if (/\s/.test(ch)) { prev = false; continue; }
      rg.setStart(node, i); rg.setEnd(node, i + len);
      i += len - 1;
      const r = rg.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const c = st.clip;
      if (cx < c[0] || cx > c[2] || cy < c[1] || cy > c[3]) continue;
      if (st.tt === "uppercase") ch = ch.toUpperCase();
      else if (st.tt === "lowercase") ch = ch.toLowerCase();
      else if (st.tt === "capitalize" && !prev) ch = ch.toUpperCase();
      prev = /\p{L}/u.test(ch);
      const el = document.createElement("span");
      el.textContent = ch;
      el.style.cssText = `position:absolute;left:${r.left.toFixed(1)}px;top:${r.top.toFixed(1)}px;height:${r.height.toFixed(1)}px;` +
        `line-height:${r.height.toFixed(1)}px;white-space:pre;${st.css}color:${st.color};opacity:${c[4]}`;
      el.style.setProperty("--o", String(c[4]));
      frag.appendChild(el);
      out.list.push({ el, ch, x: r.left, y: r.top, w: r.width, h: r.height, cx, cy, node, p, color: st.color, ff: st.ff, op: c[4] });
    }
    if (out.list.length > start && !out.parents.includes(p)) out.parents.push(p);
    return true;
  };
  for (const node of ctl.textNodes(700, 0)) if (!take(node)) break;
  // le reste du texte des elements masques (chiffres seuls, sous-elements) doit
  // aussi etre recopie, sinon il disparaitrait avec eux
  for (const p of out.parents.slice()) {
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = w.nextNode())) {
      if (done.has(n) || !/\S/.test(n.data) || !n.parentElement || n.parentElement.closest("svg,script,style,[data-prank-layer]")) continue;
      if (!take(n)) break;
    }
  }
  host.appendChild(frag);
  // la page defile : les copies suivent
  const sc0 = main.scrollTop;
  ctl.on(main, "scroll", () => { host.style.transform = `translateY(${(sc0 - main.scrollTop).toFixed(1)}px)`; }, { passive: true });
  out.hide = () => out.parents.forEach(p => ctl.set(p, { "-webkit-text-fill-color": "transparent", "text-shadow": "none" }));
  out.show = () => out.parents.forEach(p => ctl.unset(p, ["-webkit-text-fill-color", "text-shadow"]));
  return out;
}

// ── Copies de la page ───────────────────────────────────────────────────────
// Modele de copie d'un bloc : images, videos et canevas sont figes en canevas
// (une copie n'ouvre jamais un nouveau flux camera), ids et focus retires.
function drawFit(g, src, W, H, fit) {
  const sw = src.naturalWidth || src.videoWidth || src.width || 0;
  const sh = src.naturalHeight || src.videoHeight || src.height || 0;
  if (!sw || !sh) return;
  if (fit === "cover" || fit === "contain") {
    const k = fit === "cover" ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
    const dw = sw * k, dh = sh * k;
    g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else g.drawImage(src, 0, 0, W, H);
}
function snapshot(src) {
  const tpl = src.cloneNode(true);
  tpl.querySelectorAll("[data-prank-layer]").forEach(n => n.remove());
  const so = Array.from(src.querySelectorAll("img,canvas,video")).filter(n => !n.closest("[data-prank-layer]"));
  const to = Array.from(tpl.querySelectorAll("img,canvas,video"));
  const k = Math.min(2, window.devicePixelRatio || 1);
  so.forEach((o, i) => {
    const c = to[i];
    if (!c) return;
    const r = o.getBoundingClientRect();
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(r.width * k));
    cv.height = Math.max(1, Math.round(r.height * k));
    const cls = c.getAttribute("class");
    if (cls) cv.setAttribute("class", cls);
    const css = c.getAttribute("style");
    if (css) cv.setAttribute("style", css);
    cv.style.width = r.width + "px";
    cv.style.height = r.height + "px";
    try {
      const cs = getComputedStyle(o);
      if (cs.display === "inline") cv.style.display = "inline-block";
      if (cs.display === "none" || !r.width) cv.style.display = "none";
      drawFit(cv.getContext("2d"), o, cv.width, cv.height, cs.objectFit);
    } catch (e) { /* image d'une autre origine : canevas vide */ }
    c.replaceWith(cv);
  });
  tpl.querySelectorAll("[id]").forEach(n => { if (!n.closest("svg")) n.removeAttribute("id"); });
  tpl.querySelectorAll("a,button,input,select,textarea,[tabindex]").forEach(n => n.setAttribute("tabindex", "-1"));
  tpl.setAttribute("aria-hidden", "true");
  tpl.setAttribute("inert", "");
  return {
    make() {
      const c = tpl.cloneNode(true);
      const a = tpl.querySelectorAll("canvas"), b = c.querySelectorAll("canvas");
      a.forEach((cv, i) => {
        const d = b[i];
        if (!d) return;
        d.width = cv.width; d.height = cv.height;
        try { d.getContext("2d").drawImage(cv, 0, 0); } catch (e) { /* rien */ }
      });
      return c;
    },
  };
}
// Copie de la zone de contenu, posee exactement a sa place
function mainCopy(snap, mr, bg) {
  const c = snap.make();
  Object.assign(c.style, { position: "absolute", left: mr.left + "px", top: mr.top + "px", width: mr.width + "px",
    height: mr.height + "px", margin: "0", overflow: "hidden", pointerEvents: "none", background: bg,
    transform: "none", filter: "none", animation: "none", transition: "none" });
  return c;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Eclipse
// ════════════════════════════════════════════════════════════════════════════
const ECLIPSE_CSS = `
@keyframes pk-eclipse-tw { 0%, 100% { opacity: .2 } 50% { opacity: 1 } }
@keyframes pk-eclipse-pulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.07) } }
`;
function Eclipse({ done }) {
  const s = useStage2(done);
  const [msg, setMsg] = useState(1);
  const moonRef = useRef(null), nightRef = useRef(null), coronaRef = useRef(null), ringRef = useRef(null);
  const starsRef = useRef(null), haloRef = useRef(null);
  const geo = useMemo(() => {
    const W = vw(), R = clamp(W * .085, 30, 54);
    return { R, x: W / 2, y: (isNarrow() ? 78 : 64) + R };
  }, []);
  const stars = useMemo(() => Array.from({ length: 48 }, () => ({ x: rand(0, 100), y: rand(0, 88), r: rand(1, 2.4), d: rand(1.2, 3), dl: rand(0, 2) })), []);
  useEffect(() => {
    const { ctl } = s;
    const { R } = geo;
    const T = 8.6;
    // position de la lune (-1 a gauche, 0 centree, 1 a droite) : elle traine au centre
    const pos = t => (t < .4 ? -1 : t < 3.6 ? lerp(-1, -.035, easeOut((t - .4) / 3.2))
      : t < 5.3 ? lerp(-.035, .035, (t - 3.6) / 1.7) : t < 8.1 ? lerp(.035, 1, easeIn((t - 5.3) / 2.8)) : 1);
    let shown = 1;
    ctl.loop(t => {
      const p = pos(t), dx = p * 2.3 * R, d = Math.abs(dx);
      const cover = clamp(1 - d / (2 * R), 0, 1);
      if (moonRef.current) moonRef.current.style.transform = `translate(${dx.toFixed(1)}px,${(-p * .3 * R).toFixed(1)}px)`;
      if (nightRef.current) nightRef.current.style.opacity = (Math.pow(cover, 2.2) * .84).toFixed(3);
      if (starsRef.current) starsRef.current.style.opacity = clamp((cover - .72) / .28, 0, 1).toFixed(3);
      if (coronaRef.current) coronaRef.current.style.opacity = smooth(clamp((cover - .9) / .1, 0, 1)).toFixed(3);
      if (haloRef.current) haloRef.current.style.opacity = (1 - Math.pow(cover, 1.4)).toFixed(3);
      if (ringRef.current) {
        const k = cover > .97 ? 0 : clamp(1 - Math.abs(d - .2 * R) / (.13 * R), 0, 1);
        ringRef.current.style.opacity = k.toFixed(3);
        ringRef.current.style.transform = `translate(${(p < 0 ? R * .96 : -R * .96).toFixed(1)}px,0) scale(${(.6 + k * .6).toFixed(2)})`;
      }
      if (shown === 1 && cover > .97) { shown = 2; setMsg(2); }
      if (shown === 2 && p > .2) { shown = 3; setMsg(3); }
      if (t >= T) { setMsg(4); s.finish(); return false; }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { R } = geo;
  return (
    <Layer s={s} css={ECLIPSE_CSS}>
      <div ref={nightRef} style={{ position: "absolute", inset: 0, opacity: 0,
        background: "linear-gradient(180deg, #01030c 0%, #070b1f 60%, #2b1708 100%)" }}/>
      <div ref={starsRef} style={{ position: "absolute", inset: 0, opacity: 0 }}>
        {stars.map((st, i) => (
          <span key={i} style={{ position: "absolute", left: `${st.x}%`, top: `${st.y}%`, width: st.r, height: st.r, borderRadius: "50%",
            background: "#fff", animation: `pk-eclipse-tw ${st.d}s ease-in-out ${st.dl}s infinite` }}/>
        ))}
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: geo.x, top: geo.y, width: 0, height: 0,
        opacity: msg === 4 ? .9 : 1, animation: "pk-kit-fadein 1s ease backwards" }}>
        <div ref={haloRef} style={{ position: "absolute", left: -R * 3.2, top: -R * 3.2, width: R * 6.4, height: R * 6.4, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(253,224,71,.5), rgba(253,186,40,.16) 38%, transparent 68%)",
          animation: "pk-eclipse-pulse 3s ease-in-out infinite" }}/>
        <div ref={coronaRef} style={{ position: "absolute", left: -R * 2.6, top: -R * 2.6, width: R * 5.2, height: R * 5.2, opacity: 0 }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", animation: "pk-kit-spin 40s linear infinite",
            background: "repeating-conic-gradient(rgba(226,240,255,.55) 0 3deg, transparent 3deg 11deg, rgba(226,240,255,.3) 11deg 13deg, transparent 13deg 24deg)",
            WebkitMaskImage: "radial-gradient(circle, transparent 36%, #000 39%, transparent 70%)",
            maskImage: "radial-gradient(circle, transparent 36%, #000 39%, transparent 70%)", filter: "blur(1.5px)" }}/>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,255,255,.95) 0 37%, rgba(186,220,255,.55) 41%, rgba(147,197,253,.18) 55%, transparent 70%)",
            animation: "pk-eclipse-pulse 2.4s ease-in-out infinite" }}/>
        </div>
        <div style={{ position: "absolute", left: -R, top: -R, width: R * 2, height: R * 2, borderRadius: "50%", overflow: "hidden",
          background: "radial-gradient(circle at 40% 38%, #fffbe6, #fde047 48%, #f59e0b)", boxShadow: "0 0 24px 6px rgba(253,200,60,.5)" }}>
          <div ref={moonRef} style={{ position: "absolute", left: -R * .04, top: -R * .04, width: R * 2.08, height: R * 2.08, borderRadius: "50%",
            background: "radial-gradient(circle at 42% 36%, #1c2438, #070a14 72%)", transform: `translate(${-R * 2.3}px,0)` }}/>
        </div>
        <div ref={ringRef} style={{ position: "absolute", left: -R * .45, top: -R * .45, width: R * .9, height: R * .9, opacity: 0 }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%",
            background: "radial-gradient(circle, #fff 0 12%, rgba(255,255,255,.7) 22%, rgba(186,230,253,.25) 45%, transparent 70%)" }}/>
          <div style={{ position: "absolute", left: "-60%", right: "-60%", top: "48%", height: "4%", background: "linear-gradient(90deg, transparent, #fff, transparent)" }}/>
          <div style={{ position: "absolute", top: "-60%", bottom: "-60%", left: "48%", width: "4%", background: "linear-gradient(180deg, transparent, #fff, transparent)" }}/>
        </div>
      </div>
      {msg === 1 && <Pill key="a">🌒 Éclipse totale annoncée sur l'atelier. Ne regarde pas la buse en face !</Pill>}
      {msg === 2 && <Pill key="b">🌑 Totalité ! Même le ventilo retient son souffle.</Pill>}
      {msg === 3 && <Pill key="c">💍 L'anneau de diamant… le jour revient.</Pill>}
      {msg === 4 && <Pill key="d" fade>☀️ Le soleil est de retour. Le PLA peut recommencer à jaunir.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Arc-en-ciel
// ════════════════════════════════════════════════════════════════════════════
const ARC_CSS = `
@keyframes pk-arc-en-ciel-gallop { 0%, 100% { transform: translateY(0) rotate(-5deg) } 50% { transform: translateY(-14px) rotate(6deg) } }
@keyframes pk-arc-en-ciel-spark { 0% { transform: scale(0) rotate(0deg); opacity: 0 } 30% { transform: scale(1.2) rotate(70deg); opacity: 1 }
  100% { transform: translateY(22px) scale(.2) rotate(200deg); opacity: 0 } }
@keyframes pk-arc-en-ciel-bow { 0% { opacity: 0; transform: scale(.92) } 25%, 72% { opacity: .5; transform: scale(1) } 100% { opacity: 0; transform: scale(1.03) } }
`;
function ArcEnCiel({ done }) {
  const s = useStage2(done);
  const [msg, setMsg] = useState(1);
  const uniRef = useRef(null), trailRef = useRef(null);
  const T0 = 1.9, T1 = 4.8;
  const geo = useMemo(() => { const W = vw(), H = vh(); return { W, H, y0: H * .42, amp: Math.min(60, H * .07) }; }, []);
  const uniAt = t => {
    const x = lerp(-90, geo.W + 90, clamp((t - T0) / (T1 - T0), 0, 1));
    return { x, y: geo.y0 + Math.sin(x / 110) * geo.amp };
  };
  const sparks = useMemo(() => Array.from({ length: 28 }, (_, i) => {
    const t = lerp(T0 + .15, T1 - .1, i / 27), p = uniAt(t);
    return { x: p.x - 34 + rand(-16, 16), y: p.y + rand(-28, 28), dl: t, c: RAINBOW[i % 7], sz: rand(10, 18) };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { ctl } = s;
    const cards = withRects(tilesOf(ctl, 24)).sort(byReading);
    const step = cards.length ? Math.min(260, 1500 / cards.length) : 0;
    cards.forEach(({ c }, i) => {
      const col = RAINBOW[i % 7];
      const [off, on] = shadowPair(c, `inset 0 0 0 2000px ${hexA(col, 0)}, 0 0 0 0 ${hexA(col, 0)}`,
        `inset 0 0 0 2000px ${hexA(col, .3)}, 0 0 26px 2px ${hexA(col, .55)}`);
      const bc = getComputedStyle(c).borderTopColor;
      ctl.anim(c, [{ boxShadow: off, borderColor: bc }, { boxShadow: on, borderColor: col }],
        { duration: 520, delay: 300 + i * step, easing: "ease-out", fill: "forwards" });
      ctl.anim(c, [{ transform: "scale(1)" }, { transform: "scale(1.035)", offset: .4 }, { transform: "scale(1)" }],
        { duration: 520, delay: 300 + i * step, easing: "ease-out" });
      ctl.after(5700 + i * step * .6, () => ctl.anim(c, [{ boxShadow: on, borderColor: col }, { boxShadow: off, borderColor: bc }],
        { duration: 700, easing: "ease-in-out", fill: "forwards" }));
    });
    const pts = [];
    let said = false;
    ctl.loop(t => {
      if (t >= T0 && t <= T1 + .1) {
        const p = uniAt(t);
        if (uniRef.current) uniRef.current.style.transform = `translate(${(p.x - 30).toFixed(1)}px,${(p.y - 34).toFixed(1)}px)`;
        pts.push([p.x - 26, p.y + 4]);
        const g = trailRef.current;
        if (g) {
          for (let k = 0; k < g.children.length; k++) {
            const off = (k - 3) * 5;
            g.children[k].setAttribute("d", "M" + pts.map(q => `${q[0].toFixed(0)} ${(q[1] + off).toFixed(0)}`).join(" L"));
          }
        }
      }
      if (t > 5.1 && !said) { said = true; setMsg(2); }
      if (t > 7.7) { setMsg(3); s.finish(); return false; }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={ARC_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: "-62vmin", width: "130vmin", height: "130vmin",
        marginLeft: "-65vmin", borderRadius: "50%", filter: "blur(2px)", animation: "pk-arc-en-ciel-bow 7.6s ease-in-out both",
        background: "radial-gradient(circle, transparent 52%, #a855f7 52% 54.5%, #3b82f6 0 57%, #06b6d4 0 59.5%, #22c55e 0 62%, #eab308 0 64.5%, #f97316 0 67%, #ef4444 0 69.5%, transparent 0)" }}/>
      <svg width="100%" height="100%" aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: msg === 1 ? 1 : 0, transition: "opacity 1.6s ease" }}>
        <g ref={trailRef} fill="none" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round">
          {RAINBOW.map(c => <path key={c} d="M-50 -50" stroke={c} opacity=".9"/>)}
        </g>
      </svg>
      {sparks.map((p, i) => (
        <span key={i} aria-hidden="true" style={{ position: "absolute", left: p.x, top: p.y, width: p.sz, height: p.sz,
          animation: `pk-arc-en-ciel-spark .9s ease-out ${p.dl.toFixed(2)}s both` }}>
          <svg viewBox="-10 -10 20 20" width={p.sz} height={p.sz}><path d="M0 -10 L2.5 -2.5 L10 0 L2.5 2.5 L0 10 L-2.5 2.5 L-10 0 L-2.5 -2.5 Z" fill={p.c}/></svg>
        </span>
      ))}
      <div ref={uniRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, transform: "translate(-200px,-200px)" }}>
        <div style={{ animation: "pk-arc-en-ciel-gallop .34s ease-in-out infinite" }}>
          <div style={{ fontSize: 56, lineHeight: 1, transform: "scaleX(-1)", filter: "drop-shadow(0 4px 8px rgba(0,0,0,.35))" }}>🦄</div>
        </div>
      </div>
      {msg === 1 && <Pill key="a">🌈 L'AMS a chargé toutes les bobines en même temps…</Pill>}
      {msg === 2 && <Pill key="b">🦄 Une licorne est passée. Elle repart avec les couleurs.</Pill>}
      {msg === 3 && <Pill key="c" fade>Retour au monochrome. Tout est rentré dans le rang.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Marees
// ════════════════════════════════════════════════════════════════════════════
const MAREES_CSS = `
@keyframes pk-marees-surf { from { transform: translateX(0) } to { transform: translateX(-50%) } }
@keyframes pk-marees-crab { from { transform: translateX(-70px) } to { transform: translateX(calc(100vw + 70px)) } }
@keyframes pk-marees-step { 0%, 100% { transform: translateY(0) rotate(-6deg) } 50% { transform: translateY(-3px) rotate(6deg) } }
@keyframes pk-marees-foam { 0% { transform: translateY(0) scale(.5); opacity: 0 } 30% { opacity: .9 } 100% { transform: translateY(-24px) scale(1.2); opacity: 0 } }
@keyframes pk-marees-bob { 0%, 100% { transform: rotate(-7deg) } 50% { transform: rotate(7deg) } }
`;
const WAVE_D = (() => {
  let d = "M0 20";
  for (let i = 0; i < 24; i++) d += ` Q${i * 50 + 25} ${i % 2 ? 34 : 6} ${i * 50 + 50} 20`;
  return d;
})();
function Marees({ done }) {
  const s = useStage2(done);
  const [msg, setMsg] = useState(1);
  const seaRef = useRef(null);
  const T = 8.6, P = 2.9;
  const env = t => smooth(clamp(t / 1.4, 0, 1)) * smooth(clamp((T - .4 - t) / 2, 0, 1));
  const foam = useMemo(() => Array.from({ length: 22 }, () => ({ x: rand(0, 100), d: rand(1.2, 2.4), dl: rand(0, 2), r: rand(4, 10) })), []);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh(), N = 90;
    tilesOf(ctl, 24).forEach(c => {
      const r = c.getBoundingClientRect();
      const ph = (r.left + r.width / 2) / W * Math.PI * .9 + r.top / H * .7;
      const A = clamp(r.height * .12, 14, 34);
      const kf = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N * T, e = env(t), w = 2 * Math.PI * t / P - ph;
        kf.push({ transform: `translateY(${(-A * e * Math.sin(w)).toFixed(2)}px) rotate(${(2.4 * e * Math.cos(w)).toFixed(3)}deg)` });
      }
      ctl.anim(c, kf, { duration: T * 1000, easing: "linear" });
    });
    const seaH = Math.round(H * .17);
    let said = false;
    ctl.loop(t => {
      const inOut = (1 - smooth(clamp(t / 1.3, 0, 1))) + smooth(clamp((t - (T - 1.5)) / 1.4, 0, 1));
      const y = inOut * (seaH + 50) - 28 * env(t) * Math.sin(2 * Math.PI * t / P);
      if (seaRef.current) seaRef.current.style.transform = `translateY(${y.toFixed(1)}px)`;
      if (t > 6.2 && !said) { said = true; setMsg(2); }
      if (t >= T) { setMsg(3); s.finish(); return false; }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const water = "rgba(14,165,233,.5)";
  return (
    <Layer s={s} css={MAREES_CSS}>
      <div ref={seaRef} aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "17vh", transform: "translateY(120%)" }}>
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${water}, rgba(3,105,161,.72))` }}/>
        {[0, 1].map(k => (
          <div key={k} style={{ position: "absolute", left: 0, top: -30 + k * 6, height: 40, width: "200%", opacity: k ? .55 : 1,
            animation: `pk-marees-surf ${k ? 5.4 : 3.6}s linear infinite${k ? " reverse" : ""}` }}>
            <svg width="100%" height="40" viewBox="0 0 1200 40" preserveAspectRatio="none">
              <path d={WAVE_D + " L1200 40 L0 40 Z"} fill={water}/>
              {!k && <path d={WAVE_D} fill="none" stroke="rgba(255,255,255,.85)" strokeWidth="3" strokeDasharray="14 7" vectorEffect="non-scaling-stroke"/>}
            </svg>
          </div>
        ))}
        {foam.map((f, i) => (
          <span key={i} style={{ position: "absolute", left: `${f.x}%`, top: -6, width: f.r, height: f.r, borderRadius: "50%",
            background: "rgba(255,255,255,.85)", animation: `pk-marees-foam ${f.d}s ease-out ${f.dl}s infinite` }}/>
        ))}
        <div style={{ position: "absolute", left: "62%", top: -46, fontSize: 34, transformOrigin: "50% 100%",
          animation: "pk-marees-bob 2.9s ease-in-out infinite" }}>⛵</div>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, bottom: "calc(6px + env(safe-area-inset-bottom, 0px))",
        animation: "pk-marees-crab 8.4s linear .3s both" }}>
        <div style={{ fontSize: 26, animation: "pk-marees-step .25s ease-in-out infinite" }}>🦀</div>
      </div>
      {msg === 1 && <Pill key="a">🌊 Grande marée sur l'atelier : coefficient 118 !</Pill>}
      {msg === 2 && <Pill key="b">La mer se retire doucement…</Pill>}
      {msg === 3 && <Pill key="c" fade>Marée basse. Tout le monde est resté à quai.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Meteores
// ════════════════════════════════════════════════════════════════════════════
const METEORES_CSS = `
@keyframes pk-meteores-fly { 0% { transform: translateX(var(--d)); opacity: 0 } 15%, 80% { opacity: 1 } 100% { transform: translateX(0); opacity: 0 } }
@keyframes pk-meteores-hit { 0% { transform: translateX(var(--d)); opacity: 0 } 20% { opacity: 1 } 100% { transform: translateX(0); opacity: 1 } }
@keyframes pk-meteores-flash { 0% { transform: scale(.2); opacity: 1 } 100% { transform: scale(2.6); opacity: 0 } }
@keyframes pk-meteores-crater { 0% { opacity: 0; transform: scale(.4) } 12% { opacity: 1; transform: scale(1) } 70% { opacity: .9 } 100% { opacity: 0 } }
@keyframes pk-meteores-smoke { 0% { transform: translate(0, 0) scale(.3); opacity: .8 } 100% { transform: translate(var(--dx), -70px) scale(2.2); opacity: 0 } }
@keyframes pk-meteores-spark { 0% { transform: translate(0, 0) scale(1); opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) scale(.2); opacity: 0 } }
@keyframes pk-meteores-tw { 0%, 100% { opacity: .2 } 50% { opacity: 1 } }
`;
function Meteor({ x, y, d, dl, dur, sz, hit }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 0, height: 0, transform: "rotate(145deg)" }}>
      <div style={{ position: "absolute", left: 0, top: 0, "--d": `${-d}px`, opacity: 0,
        animation: `${hit ? "pk-meteores-hit" : "pk-meteores-fly"} ${dur}s cubic-bezier(.4,0,1,1) ${dl}s ${hit ? "backwards" : "both"}` }}>
        <div style={{ position: "absolute", right: 0, top: -sz / 2, width: sz * 46, height: sz, borderRadius: sz,
          background: "linear-gradient(90deg, transparent, rgba(253,186,116,.35) 55%, rgba(255,255,255,.95))" }}/>
        <div style={{ position: "absolute", left: -sz * 1.6, top: -sz * 1.6, width: sz * 3.2, height: sz * 3.2, borderRadius: "50%",
          background: "radial-gradient(circle, #fff 0 30%, rgba(253,224,71,.8) 50%, transparent 72%)" }}/>
      </div>
    </div>
  );
}
function Meteores({ done }) {
  const s = useStage2(done);
  const [msg, setMsg] = useState(1);
  const [hits, setHits] = useState([]);
  const [booms, setBooms] = useState([]);
  const sky = useMemo(() => {
    const W = vw(), H = vh(), D = Math.hypot(W, H);
    return {
      stars: Array.from({ length: 40 }, () => ({ x: rand(0, 100), y: rand(0, 80), r: rand(1, 2.3), d: rand(1, 3) })),
      streaks: Array.from({ length: 26 }, () => ({ x: rand(-.1, 1.1) * W, y: rand(.35, 1.15) * H, d: rand(.45, .9) * D,
        dl: rand(.2, 6), dur: rand(.6, 1.1), sz: rand(1.6, 3.2) })),
    };
  }, []);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh();
    const cards = withRects(tilesOf(ctl, 12)).filter(o => o.r.top < H - 100 && o.r.bottom > 80);
    const times = [1.3, 2.3, 3.1, 4.0, 4.9];
    const list = times.map((tm, i) => {
      const o = cards.length ? cards[i % cards.length] : null;
      const r = o ? o.r : { left: W * .2, top: H * .25, width: W * .6, height: H * .4 };
      const x = r.left + r.width * rand(.2, .8), y = clamp(r.top + r.height * rand(.25, .75), 90, H - 120);
      const dur = .55;
      return { id: i, c: o && o.c, x, y, d: Math.hypot(W, H) * .55, dl: tm - dur, dur, sz: 4 };
    });
    setHits(list);
    list.forEach(h => ctl.after(h.dl * 1000 + h.dur * 1000, () => {
      setBooms(b => [...b, { id: h.id, x: h.x, y: h.y,
        smoke: Array.from({ length: 5 }, () => ({ dx: rand(-30, 30), dl: rand(0, .3), r: rand(18, 30) })),
        sparks: Array.from({ length: 9 }, (_, k) => { const a = k / 9 * Math.PI * 2 + rand(-.2, .2), d = rand(30, 70); return { dx: Math.cos(a) * d, dy: Math.sin(a) * d - 10 }; }) }]);
      if (h.c) ctl.anim(h.c, jitter(9, 12, 1.5), { duration: 520, easing: "linear" });
      ctl.parts().forEach(p => ctl.anim(p, jitter(2.5, 6), { duration: 260 }));
    }));
    ctl.after(5900, () => setMsg(2));
    ctl.after(8000, () => { setMsg(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={METEORES_CSS}>
      <div style={{ position: "absolute", inset: 0, opacity: msg === 3 ? 0 : 1, transition: "opacity 1.4s ease",
        animation: "pk-kit-fadein 1.2s ease backwards",
        background: "linear-gradient(180deg, rgba(2,6,23,.72), rgba(15,23,42,.38) 65%, rgba(15,23,42,.12))" }}>
        {sky.stars.map((st, i) => (
          <span key={i} style={{ position: "absolute", left: `${st.x}%`, top: `${st.y}%`, width: st.r, height: st.r, borderRadius: "50%",
            background: "#fff", animation: `pk-meteores-tw ${st.d}s ease-in-out infinite` }}/>
        ))}
        {sky.streaks.map((m, i) => <Meteor key={i} {...m}/>)}
        {hits.map(h => <Meteor key={"h" + h.id} {...h} hit/>)}
      </div>
      {booms.map(b => (
        <div key={b.id} aria-hidden="true" style={{ position: "absolute", left: b.x, top: b.y, width: 0, height: 0 }}>
          <div style={{ position: "absolute", left: -34, top: -16, width: 68, height: 32, borderRadius: "50%",
            background: "radial-gradient(ellipse, rgba(251,146,60,.9) 0 18%, rgba(68,40,20,.85) 30%, rgba(30,20,12,.55) 55%, transparent 72%)",
            animation: "pk-meteores-crater 2.8s ease-out both" }}/>
          <div style={{ position: "absolute", left: -40, top: -40, width: 80, height: 80, borderRadius: "50%",
            background: "radial-gradient(circle, #fff 0 20%, rgba(253,186,116,.85) 40%, rgba(249,115,22,.3) 60%, transparent 72%)",
            animation: "pk-meteores-flash .5s ease-out both" }}/>
          {b.sparks.map((k, i) => (
            <span key={i} style={{ position: "absolute", left: -3, top: -3, width: 6, height: 6, borderRadius: "50%", background: "#fdba74",
              boxShadow: "0 0 6px #f97316", "--dx": `${k.dx}px`, "--dy": `${k.dy}px`, animation: "pk-meteores-spark .65s ease-out both" }}/>
          ))}
          {b.smoke.map((k, i) => (
            <span key={i} style={{ position: "absolute", left: -k.r / 2, top: -k.r / 2, width: k.r, height: k.r, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(120,113,108,.75), rgba(120,113,108,0) 70%)", "--dx": `${k.dx}px`,
              animation: `pk-meteores-smoke 1.7s ease-out ${(.1 + k.dl).toFixed(2)}s both` }}/>
          ))}
        </div>
      ))}
      {msg === 1 && <Pill key="a">☄️ Pluie de météores ! Les Perséides ont pris de l'avance.</Pill>}
      {msg === 2 && <Pill key="b">Le ciel se calme… un peu de poussière d'étoile sur le plateau.</Pill>}
      {msg === 3 && <Pill key="c" fade>Fin de l'averse. Aucune buse n'a été blessée.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Hypnose
// ════════════════════════════════════════════════════════════════════════════
const HYPNOSE_CSS = `
@keyframes pk-hypnose-swing { 0%, 100% { transform: rotate(-22deg) } 50% { transform: rotate(22deg) } }
@keyframes pk-hypnose-in { from { transform: scale(.2) rotate(-90deg); opacity: 0 } to { transform: scale(1) rotate(0deg); opacity: 1 } }
@keyframes pk-hypnose-out { from { transform: scale(1); opacity: 1 } to { transform: scale(0) rotate(240deg); opacity: 0 } }
@keyframes pk-hypnose-ring { 0% { transform: scale(.6); opacity: .7 } 100% { transform: scale(1.7); opacity: 0 } }
@keyframes pk-hypnose-flash { 0% { opacity: 0 } 15% { opacity: .75 } 100% { opacity: 0 } }
@keyframes pk-hypnose-snap { 0% { transform: scale(.3) rotate(-20deg); opacity: 0 } 25% { transform: scale(1.25) rotate(8deg); opacity: 1 }
  70% { transform: scale(1) rotate(0deg); opacity: 1 } 100% { transform: scale(1.1); opacity: 0 } }
`;
const SPIRAL_D = (() => {
  let d = "";
  for (let th = 0; th <= Math.PI * 10.6; th += .07) {
    const r = 100 / (Math.PI * 10) * th;
    d += (d ? " L" : "M") + (r * Math.cos(th)).toFixed(2) + " " + (r * Math.sin(th)).toFixed(2);
  }
  return d;
})();
function Hypnose({ done }) {
  const s = useStage2(done);
  const [phase, setPhase] = useState(1); // 1, 2, 3 (reveil)
  const geo = useMemo(() => {
    const W = vw(), H = vh(), D = Math.min(360, Math.min(W, H) * .5);
    return { W, H, D, chain: Math.max(60, H / 2 - D / 2 - 56) };
  }, []);
  useEffect(() => {
    const { ctl } = s;
    tilesOf(ctl, 24).forEach((c, i) => {
      ctl.set(c, { "transform-origin": ctl.originOf(c) });
      ctl.anim(c, [
        { transform: "rotate(0deg) scale(1)", opacity: 1 },
        { transform: "rotate(50deg) scale(.86)", opacity: .82, offset: .22 },
        { transform: "rotate(310deg) scale(.86)", opacity: .82, offset: .8 },
        { transform: "rotate(360deg) scale(1)", opacity: 1 },
      ], { duration: 6000, delay: 600 + i * 60, easing: "cubic-bezier(.45,0,.55,1)", fill: "forwards" });
    });
    ctl.after(3400, () => setPhase(2));
    ctl.after(7000, () => setPhase(3));
    ctl.after(7700, s.finish);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { D } = geo;
  const awake = phase === 3;
  return (
    <Layer s={s} css={HYPNOSE_CSS}>
      <div style={{ position: "absolute", inset: 0, opacity: awake ? 0 : 1, transition: "opacity .5s ease", animation: "pk-kit-fadein 1s ease backwards",
        background: "radial-gradient(circle at 50% 50%, rgba(76,29,149,.32), rgba(2,6,23,.6) 75%)" }}/>
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", width: D, height: D, marginLeft: -D / 2, marginTop: -D / 2,
        animation: awake ? "pk-hypnose-out .45s ease-in both" : "pk-hypnose-in .9s cubic-bezier(.2,1,.4,1) both" }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "3px solid rgba(196,181,253,.6)",
            animation: `pk-hypnose-ring 2.1s ease-out ${i * .7}s infinite` }}/>
        ))}
        <svg width={D} height={D} viewBox="-100 -100 200 200" style={{ position: "absolute", inset: 0, animation: "pk-kit-spin 1.5s linear infinite",
          filter: "drop-shadow(0 0 24px rgba(167,139,250,.6))" }}>
          <defs><clipPath id="pk-hypnose-clip"><circle r="99"/></clipPath></defs>
          <circle r="99" fill="#fafafa"/>
          <path d={SPIRAL_D} fill="none" stroke="#111" strokeWidth="10" clipPath="url(#pk-hypnose-clip)"/>
          <circle r="99" fill="none" stroke="#111" strokeWidth="3"/>
        </svg>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: 0, width: 0, height: 0,
        opacity: awake ? 0 : 1, transition: "opacity .4s ease" }}>
        <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", animation: "pk-hypnose-swing 1.5s ease-in-out infinite" }}>
          <div style={{ position: "absolute", left: -1, top: 0, width: 2, height: geo.chain,
            background: "repeating-linear-gradient(180deg, #d4a017 0 4px, #8a6a0c 4px 6px)" }}/>
          <div style={{ position: "absolute", left: -22, top: geo.chain - 2, width: 44, height: 44, borderRadius: "50%",
            background: "radial-gradient(circle at 35% 30%, #fff7c2, #eab308 45%, #a16207)", boxShadow: "0 4px 12px rgba(0,0,0,.4)" }}>
            <div style={{ position: "absolute", inset: 6, borderRadius: "50%", background: "#fffbeb", border: "1px solid #a16207" }}>
              <div style={{ position: "absolute", left: "50%", top: "18%", width: 2, height: "34%", marginLeft: -1, background: "#111", transformOrigin: "50% 100%",
                animation: "pk-kit-spin 2s linear infinite" }}/>
            </div>
          </div>
        </div>
      </div>
      {awake && (
        <>
          <div style={{ position: "absolute", inset: 0, background: "#fff", animation: "pk-hypnose-flash .6s ease-out both" }}/>
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "45%", width: 0, height: 0 }}>
            <div style={{ position: "absolute", left: -45, top: -45, fontSize: 80, lineHeight: 1, animation: "pk-hypnose-snap 1.1s ease-out both" }}>🫰</div>
          </div>
        </>
      )}
      {phase === 1 && <Pill key="a">🌀 Regarde bien la spirale… tu as très envie d'imprimer…</Pill>}
      {phase === 2 && <Pill key="b">… un Benchy… puis un autre Benchy… puis un autre…</Pill>}
      {phase === 3 && <Pill key="c" fade>👌 *Clac !* Réveille-toi. Tu ne te souviens de rien.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Telex
// ════════════════════════════════════════════════════════════════════════════
const TELEX_CSS = `
@keyframes pk-telex-ink { 0% { opacity: 0; transform: translateY(-3px) scale(1.35) } 60% { opacity: var(--o, 1); transform: translateY(.5px) scale(.95) }
  100% { opacity: var(--o, 1); transform: none } }
@keyframes pk-telex-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: .1 } }
@keyframes pk-telex-ding { 0% { transform: translate(-50%, 0) scale(.5); opacity: 0 } 25% { transform: translate(-50%, -10px) scale(1.1); opacity: 1 }
  100% { transform: translate(-50%, -26px) scale(1); opacity: 0 } }
`;
function Telex({ done }) {
  const s = useStage2(done);
  const hostRef = useRef(null);
  const [msg, setMsg] = useState(1);
  const [dings, setDings] = useState([]);
  useEffect(() => {
    const { ctl } = s;
    const host = hostRef.current;
    const L = buildLetters(ctl, host, 1800);
    if (!L.list.length) { ctl.after(3000, () => { setMsg(3); s.finish(); }); return; }
    L.hide();
    // une "machine" par carte : chacune tape son texte en meme temps
    const cards = tilesOf(ctl, 30);
    const gOf = new Map(), groups = [];
    L.list.forEach(l => {
      let k = gOf.get(l.p);
      if (k === undefined) { k = cards.findIndex(c => c.contains(l.p)); gOf.set(l.p, k); }
      let g = groups.find(x => x.k === k);
      if (!g) {
        const caret = document.createElement("span");
        caret.textContent = "▌";
        caret.style.cssText = "position:absolute;left:-99px;top:-99px;color:#8b5cf6;animation:pk-telex-caret .45s steps(1) infinite;";
        host.appendChild(caret);
        g = { k, letters: [], caret, n: 0, lastFeed: 0, card: k >= 0 ? cards[k] : null };
        groups.push(g);
      }
      g.letters.push(l);
    });
    const big = groups.reduce((a, b) => (b.letters.length > a.letters.length ? b : a), groups[0]);
    let lastDing = 0, dingId = 0;
    const caretAt = (g, i) => {
      const l = g.letters[Math.max(0, Math.min(g.letters.length - 1, i))];
      if (!l) return;
      g.caret.style.left = (i < 0 ? l.x : l.x + l.w).toFixed(1) + "px";
      g.caret.style.top = l.y.toFixed(1) + "px";
      g.caret.style.fontSize = (l.h * .8).toFixed(1) + "px";
      g.caret.style.lineHeight = l.h.toFixed(1) + "px";
    };
    const setCount = (g, n, t, typing) => {
      n = clamp(n, 0, g.letters.length);
      if (n === g.n) return;
      if (n < g.n) for (let i = n; i < g.n; i++) { const e = g.letters[i].el; e.style.animation = "none"; e.style.opacity = "0"; }
      else {
        for (let i = g.n; i < n; i++) {
          const l = g.letters[i];
          l.el.style.opacity = String(l.op);
          l.el.style.animation = "pk-telex-ink .22s ease-out both";
          const prev = g.letters[i - 1];
          if (typing && prev && l.y > prev.y + prev.h / 2) {
            // retour chariot : la carte tressaute, et un "ding" pour la plus grosse
            if (g.card && t - g.lastFeed > .15) { g.lastFeed = t; ctl.anim(g.card, [{ transform: "translateY(0)" }, { transform: "translateY(-2px)" }, { transform: "translateY(0)" }], { duration: 140 }); }
            if (g === big && t - lastDing > .45) { lastDing = t; const id = ++dingId; setDings(d => [...d.slice(-5), { id, x: prev.x + prev.w + 14, y: prev.y }]); }
          }
        }
      }
      g.n = n;
      caretAt(g, n - 1);
    };
    groups.forEach(g => { g.n = g.letters.length; caretAt(g, g.n - 1); });
    let phase = 1;
    ctl.loop(t => {
      if (t < 1.3) groups.forEach(g => setCount(g, Math.round(g.letters.length * (1 - clamp((t - .3) / 1, 0, 1))), t, false));
      else if (t >= 1.7 && t < 6.4) {
        if (phase === 1) { phase = 2; setMsg(2); }
        groups.forEach(g => setCount(g, Math.ceil(g.letters.length * clamp((t - 1.7) / 4.4, 0, 1)), t, true));
      } else if (t >= 6.5) {
        groups.forEach(g => setCount(g, g.letters.length, t, false));
        L.show();
        host.style.visibility = "hidden";
        setMsg(3); s.finish();
        return false;
      }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={TELEX_CSS}>
      <div ref={hostRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}/>
      {dings.map(d => (
        <span key={d.id} aria-hidden="true" style={{ position: "absolute", left: d.x, top: d.y, fontWeight: 900, fontSize: 13, color: "#fbbf24",
          textShadow: "0 1px 4px rgba(0,0,0,.6)", whiteSpace: "nowrap", fontFamily: FONT, animation: "pk-telex-ding .8s ease-out both" }}>ding !</span>
      ))}
      {msg === 1 && <Pill key="a">📠 Transmission télex entrante… effacement de la page.</Pill>}
      {msg === 2 && <Pill key="b">Tac-tac-tac-tac-tac… ding ! Tac-tac-tac…</Pill>}
      {msg === 3 && <Pill key="c" fade>Fin de transmission. STOP. Bonne impression. STOP.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Aurore
// ════════════════════════════════════════════════════════════════════════════
const AURORE_CSS = `
@keyframes pk-aurore-drift { 0% { transform: translateX(-4%) skewX(-6deg) scaleY(1) } 100% { transform: translateX(4%) skewX(7deg) scaleY(1.12) } }
@keyframes pk-aurore-tw { 0%, 100% { opacity: .15 } 50% { opacity: 1 } }
@keyframes pk-aurore-glint { 0%, 100% { transform: scale(0) rotate(0deg); opacity: 0 } 50% { transform: scale(1) rotate(45deg); opacity: 1 } }
@keyframes pk-aurore-shoot { 0% { transform: translate(0, 0) rotate(152deg); opacity: 0 } 10% { opacity: 1 } 100% { transform: translate(-45vw, 24vh) rotate(152deg); opacity: 0 } }
`;
const auroraShape = a => `M0 ${a[0]} C 200 ${a[1]}, 400 ${a[2]}, 600 ${a[3]} S 900 ${a[4]}, 1000 ${a[5]} L1000 ${a[5] + 150} ` +
  `C 850 ${a[4] + 210}, 750 ${a[3] + 160}, 600 ${a[3] + 180} S 200 ${a[1] + 200}, 0 ${a[0] + 170} Z`;
const MOUNTAINS = (() => {
  let d = "M0 120 L0 70";
  const pk = [[60, 40], [130, 62], [210, 20], [300, 58], [360, 34], [450, 66], [540, 28], [640, 60], [720, 38], [820, 70], [900, 30], [1000, 56]];
  pk.forEach(([x, y]) => { d += ` L${x} ${y}`; });
  d += " L1000 120 Z";
  let t = "";
  for (let x = 8; x < 1000; x += rand(16, 34)) {
    const h = rand(14, 30);
    t += ` M${x.toFixed(0)} 120 L${(x + 6).toFixed(0)} ${(120 - h).toFixed(0)} L${(x + 12).toFixed(0)} 120 Z`;
  }
  return { d, t };
})();
function Aurore({ done }) {
  const s = useStage2(done);
  const [msg, setMsg] = useState(1);
  const [glints, setGlints] = useState([]);
  const sky = useMemo(() => ({
    stars: Array.from({ length: 60 }, () => ({ x: rand(0, 100), y: rand(0, 75), r: rand(.8, 2.2), d: rand(1, 3.4), dl: rand(0, 3) })),
    ribbons: [["#22c55e", "#2dd4bf", 2], ["#34d399", "#a855f7", 9], ["#06b6d4", "#ec4899", 16]].map(([c1, c2, top], i) => {
      const base = [rand(60, 140), rand(20, 120), rand(80, 180), rand(30, 140), rand(60, 170), rand(40, 150)];
      const shapes = [0, 1, 2].map(() => auroraShape(base.map(v => Math.round(v + rand(-55, 55)))));
      return { c1, c2, top, shapes, d: rand(5, 7.5), m: rand(6, 9), dl: -i * 1.7 };
    }),
  }), []);
  useEffect(() => {
    const { ctl } = s;
    const cards = tilesOf(ctl, 24);
    cards.forEach((c, i) => {
      const col = i % 2 ? "rgba(52,211,153," : "rgba(167,139,250,";
      const [off, on] = shadowPair(c, `0 0 0 0 ${col}0)`, `0 0 24px 2px ${col}.5)`);
      ctl.anim(c, [{ boxShadow: off }, { boxShadow: on }, { boxShadow: off }],
        { duration: 2400, delay: 1200 + rand(0, 1600), iterations: 2, easing: "ease-in-out" });
    });
    const gl = [];
    withRects(cards.slice(0, 10)).forEach(({ r }) => {
      for (let k = 0; k < 2; k++) {
        const onX = Math.random() < .5;
        gl.push({ x: onX ? r.left + rand(.1, .9) * r.width : (Math.random() < .5 ? r.left : r.right),
          y: onX ? (Math.random() < .5 ? r.top : r.bottom) : r.top + rand(.1, .9) * r.height, dl: rand(1, 6), d: rand(1.2, 2) });
      }
    });
    setGlints(gl);
    ctl.after(7400, () => setMsg(2));
    ctl.after(9000, s.finish);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const out = msg === 2;
  const mask = "repeating-linear-gradient(90deg, #000 0 3px, rgba(0,0,0,.45) 3px 8px)";
  return (
    <Layer s={s} css={AURORE_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: out ? 0 : 1, transition: "opacity 1.6s ease",
        animation: "pk-kit-fadein 1.8s ease backwards" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(2,6,23,.84), rgba(2,6,23,.5) 60%, rgba(2,6,23,.25))" }}/>
        {sky.stars.map((st, i) => (
          <span key={i} style={{ position: "absolute", left: `${st.x}%`, top: `${st.y}%`, width: st.r, height: st.r, borderRadius: "50%",
            background: "#fff", animation: `pk-aurore-tw ${st.d}s ease-in-out ${st.dl}s infinite` }}/>
        ))}
        {sky.ribbons.map((r, i) => (
          <div key={i} style={{ position: "absolute", left: "-12%", width: "124%", top: `${r.top}%`, height: "56vh", mixBlendMode: "screen",
            filter: "blur(7px)", animation: `pk-aurore-drift ${r.d}s ease-in-out ${r.dl}s infinite alternate`,
            WebkitMaskImage: mask, maskImage: mask }}>
            <svg width="100%" height="100%" viewBox="0 0 1000 400" preserveAspectRatio="none">
              <defs>
                <linearGradient id={`pk-aurore-g${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={r.c1} stopOpacity="0"/>
                  <stop offset=".3" stopColor={r.c1} stopOpacity=".85"/>
                  <stop offset=".68" stopColor={r.c2} stopOpacity=".45"/>
                  <stop offset="1" stopColor={r.c2} stopOpacity="0"/>
                </linearGradient>
              </defs>
              <path d={r.shapes[0]} fill={`url(#pk-aurore-g${i})`}>
                <animate attributeName="d" dur={`${r.m.toFixed(1)}s`} repeatCount="indefinite" values={[...r.shapes, r.shapes[0]].join(";")}/>
              </path>
            </svg>
          </div>
        ))}
        <div style={{ position: "absolute", right: "8%", top: "12%", width: 0, height: 0 }}>
          <div style={{ position: "absolute", width: 120, height: 2, borderRadius: 2, transformOrigin: "100% 50%",
            background: "linear-gradient(90deg, transparent, #fff)", animation: "pk-aurore-shoot 1.1s ease-in 4s both" }}/>
        </div>
        <svg viewBox="0 0 1000 120" preserveAspectRatio="none" style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: "16vh" }}>
          <path d={MOUNTAINS.d} fill="#030712"/>
          <path d={MOUNTAINS.t} fill="#020617"/>
        </svg>
      </div>
      {glints.map((g, i) => (
        <span key={i} aria-hidden="true" style={{ position: "absolute", left: g.x - 8, top: g.y - 8, width: 16, height: 16,
          animation: `pk-aurore-glint ${g.d.toFixed(2)}s ease-in-out ${g.dl.toFixed(2)}s both` }}>
          <svg viewBox="-10 -10 20 20" width="16" height="16"><path d="M0 -10 L2 -2 L10 0 L2 2 L0 10 L-2 2 L-10 0 L-2 -2 Z" fill="#ecfeff"/></svg>
        </span>
      ))}
      {msg === 1 && <Pill key="a">🌌 Aurore boréale au-dessus de l'atelier. Fais un vœu : zéro spaghetti.</Pill>}
      {msg === 2 && <Pill key="b" fade>Le ciel s'éteint doucement. Retour aux néons de l'atelier.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 8. Chantier
// ════════════════════════════════════════════════════════════════════════════
const CHANTIER_CSS = `
@keyframes pk-chantier-tape { from { transform: rotate(var(--r)) scaleX(0) } to { transform: rotate(var(--r)) scaleX(1) } }
@keyframes pk-chantier-drop { 0% { transform: translate(-50%, -90px); opacity: 0 } 60% { transform: translate(-50%, 4px); opacity: 1 }
  80% { transform: translate(-50%, -3px) } 100% { transform: translate(-50%, 0); opacity: 1 } }
@keyframes pk-chantier-cone { 0% { transform: translateY(40px) scale(.6); opacity: 0 } 70% { transform: translateY(-4px) scale(1.05); opacity: 1 } 100% { transform: none; opacity: 1 } }
@keyframes pk-chantier-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: .25 } }
@keyframes pk-chantier-march { from { background-position: 0 0 } to { background-position: 40px 0 } }
`;
const STRIPES = "repeating-linear-gradient(45deg, rgba(250,204,21,.55) 0 14px, rgba(17,17,17,.55) 14px 28px)";
function Helmet() {
  return (
    <svg width="58" height="32" viewBox="0 0 58 32" aria-hidden="true" style={{ display: "block", filter: "drop-shadow(0 3px 3px rgba(0,0,0,.35))" }}>
      <path d="M6 26 C 6 10, 18 3, 29 3 C 40 3, 52 10, 52 26 Z" fill="#facc15" stroke="#a16207" strokeWidth="1.5"/>
      <path d="M25 4 L25 25 M33 4 L33 25" stroke="#eab308" strokeWidth="3"/>
      <rect x="1" y="24" width="56" height="6" rx="3" fill="#eab308" stroke="#a16207" strokeWidth="1.2"/>
      <ellipse cx="20" cy="11" rx="5" ry="2.5" fill="rgba(255,255,255,.5)" transform="rotate(-25 20 11)"/>
    </svg>
  );
}
function Cone({ size }) {
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 40 48" aria-hidden="true">
      <path d="M17 3 L23 3 L33 42 L7 42 Z" fill="#f97316"/>
      <path d="M14.5 14 L25.5 14 L27.5 22 L12.5 22 Z M11 28 L29 28 L30.5 34 L9.5 34 Z" fill="#fff"/>
      <rect x="2" y="41" width="36" height="6" rx="2" fill="#c2410c"/>
    </svg>
  );
}
function Chantier({ done }) {
  const s = useStage2(done);
  const [phase, setPhase] = useState("pose"); // pose, grue, fin
  const [sites, setSites] = useState([]);
  const siteRefs = useRef([]);
  const rig = useRef(null), trolley = useRef(null), cable = useRef(null), hook = useRef(null);
  const geo = useMemo(() => {
    const W = vw(), H = vh(), jibY = isNarrow() ? 72 : 60, mastX = W - (isNarrow() ? 40 : 60), fl = floorY();
    let jib = `M10 ${jibY} L${mastX + 16} ${jibY} M10 ${jibY + 14} L${mastX} ${jibY + 14} M10 ${jibY} L10 ${jibY + 14}`;
    for (let x = 10, k = 0; x < mastX; x += 18, k++) jib += ` M${x} ${k % 2 ? jibY : jibY + 14} L${Math.min(mastX, x + 18)} ${k % 2 ? jibY + 14 : jibY}`;
    let mast = `M${mastX} ${jibY - 30} L${mastX} ${fl} M${mastX + 16} ${jibY - 30} L${mastX + 16} ${fl}`;
    for (let y = jibY - 30, k = 0; y < fl; y += 18, k++) mast += ` M${mastX} ${y} L${mastX + 16} ${Math.min(fl, y + 18)}`;
    return { W, H, jibY, mastX, fl, jib, mast };
  }, []);
  useEffect(() => {
    const { ctl } = s;
    const { W, H, jibY } = geo;
    const list = withRects(tilesOf(ctl, 12)).filter(o => o.r.top < H - 80 && o.r.bottom > 90 && o.r.top > jibY + 40).sort(byReading);
    const st = list.map(o => ({ x: o.r.left, y: o.r.top, w: o.r.width, h: o.r.height }));
    setSites(st);
    list.forEach(({ c }, i) => ctl.anim(c, jitter(3, 8), { duration: 420, delay: 1000 + i * 140 }));
    // trajet du crochet
    const segs = [];
    let cur = { x: W * .62, y: jibY + 70 }, t = 3.3;
    const go = (to, dur, ev) => { segs.push({ t0: t, t1: t + dur, a: cur, b: to, ev }); cur = to; t += dur; };
    const visits = st.slice(0, 3).map((o, j) => j);
    visits.forEach(j => {
      const o = st[j], cx = o.x + o.w / 2;
      go({ x: cx, y: jibY + 70 }, .55);
      go({ x: cx, y: o.y - 30 }, .45, { attach: j });
      go({ x: cx, y: jibY + 40 }, .5, { release: j });
    });
    go({ x: W * .5, y: jibY + 70 }, .4);
    const tEnd = t;
    const hooked = {};
    const at = tt => {
      let p = segs.length ? segs[0].a : cur;
      for (const g of segs) {
        if (tt >= g.t1) { p = g.b; continue; }
        if (tt >= g.t0) { const u = easeInOut((tt - g.t0) / (g.t1 - g.t0)); p = { x: lerp(g.a.x, g.b.x, u), y: lerp(g.a.y, g.b.y, u) }; }
        break;
      }
      return p;
    };
    const fired = new Set();
    let swept = false;
    ctl.after(2600, () => setPhase("grue"));
    ctl.loop(tt => {
      const enter = 1 - easeOut(clamp((tt - 2.5) / .8, 0, 1));
      const leave = easeIn(clamp((tt - tEnd) / .9, 0, 1));
      if (rig.current) rig.current.style.transform = `translateX(${((enter + leave) * W * .9).toFixed(1)}px)`;
      const p = at(tt);
      if (trolley.current) trolley.current.style.transform = `translateX(${(p.x - 13).toFixed(1)}px)`;
      if (cable.current) { cable.current.style.transform = `translateX(${(p.x - 1).toFixed(1)}px)`; cable.current.style.height = Math.max(0, p.y - jibY - 20).toFixed(1) + "px"; }
      if (hook.current) hook.current.style.transform = `translate(${(p.x - 9).toFixed(1)}px,${(p.y - 4).toFixed(1)}px)`;
      segs.forEach((g, k) => {
        if (!g.ev || tt < g.t1 || fired.has(k)) return;
        fired.add(k);
        if (g.ev.attach != null) {
          const j = g.ev.attach;
          hooked[j] = { x: p.x, y: p.y };
          if (list[j]) ctl.anim(list[j].c, [{ transform: "translateY(0)" }, { transform: "translateY(-12px)", offset: .35 },
            { transform: "translateY(2px)", offset: .7 }, { transform: "translateY(0)" }], { duration: 700, easing: "ease-out" });
        }
        if (g.ev.release != null) {
          const el = siteRefs.current[g.ev.release];
          if (el) { el.style.transition = "opacity .35s ease"; el.style.opacity = "0"; }
        }
      });
      Object.keys(hooked).forEach(j => {
        const el = siteRefs.current[j];
        if (el) el.style.transform = `translate(${(p.x - hooked[j].x).toFixed(1)}px,${(p.y - hooked[j].y).toFixed(1)}px)`;
      });
      if (tt >= tEnd && !swept) {
        swept = true;
        siteRefs.current.forEach((el, j) => {
          if (!el || hooked[j]) return;
          el.style.transition = "opacity .7s ease, transform .7s ease";
          el.style.opacity = "0"; el.style.transform = "translateY(-30px)";
        });
      }
      if (tt >= tEnd + 1) { setPhase("fin"); s.finish(); return false; }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { W, jibY, mastX, fl } = geo;
  const fin = phase === "fin";
  const coneSize = isNarrow() ? 30 : 40;
  return (
    <Layer s={s} css={CHANTIER_CSS}>
      {[["-7deg", "22%"], ["6deg", "64%"]].map(([r, top], i) => (
        <div key={i} aria-hidden="true" style={{ position: "absolute", left: "-6%", width: "112%", top, height: 18, transformOrigin: "0 50%",
          "--r": r, opacity: fin ? 0 : .92, transition: "opacity .8s ease", boxShadow: "0 3px 6px rgba(0,0,0,.25)",
          background: "repeating-linear-gradient(-45deg, #ef4444 0 16px, #fff 16px 32px)",
          animation: `pk-chantier-tape .7s cubic-bezier(.3,1,.4,1) ${.2 + i * .3}s both, pk-chantier-march 1.4s linear infinite` }}/>
      ))}
      {[.06, .3, .7, .92].map((x, i) => (
        <div key={i} aria-hidden="true" style={{ position: "absolute", left: `calc(${x * 100}% - ${coneSize / 2}px)`,
          bottom: `calc(${isNarrow() ? 84 : 12}px + env(safe-area-inset-bottom, 0px))`, opacity: fin ? 0 : 1, transition: "opacity .8s ease" }}>
          <div style={{ animation: `pk-chantier-cone .5s cubic-bezier(.3,1.4,.5,1) ${(.5 + i * .15).toFixed(2)}s both` }}><Cone size={coneSize}/></div>
        </div>
      ))}
      {sites.map((o, j) => (
        <div key={j} ref={el => { siteRefs.current[j] = el; }} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}>
          <div style={{ position: "absolute", left: o.x, top: o.y, width: o.w, height: o.h, borderRadius: "var(--r, 16px)",
            background: STRIPES, animation: `pk-kit-fadein .5s ease ${(.9 + j * .14).toFixed(2)}s both` }}/>
          <div style={{ position: "absolute", left: o.x + o.w / 2, top: o.y - 27, animation: `pk-chantier-drop .6s ease-out ${(1.1 + j * .14).toFixed(2)}s both` }}>
            <Helmet/>
          </div>
          <div style={{ position: "absolute", left: o.x + o.w - 26, top: o.y + 8, width: 12, height: 12, borderRadius: "50%", background: "#f97316",
            boxShadow: "0 0 10px #f97316", animation: `pk-chantier-blink .6s steps(1) ${(1.2 + j * .14).toFixed(2)}s infinite` }}/>
        </div>
      ))}
      <div ref={rig} aria-hidden="true" style={{ position: "absolute", inset: 0, transform: `translateX(${W}px)` }}>
        <svg width={W} height={geo.H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <path d={geo.mast} stroke="#eab308" strokeWidth="3" fill="none"/>
          <path d={geo.jib} stroke="#facc15" strokeWidth="2.6" fill="none"/>
          <path d={`M${mastX + 16} ${jibY} L${W + 80} ${jibY} M${mastX + 16} ${jibY + 14} L${W + 80} ${jibY + 14}`} stroke="#eab308" strokeWidth="3"/>
          <path d={`M${mastX + 8} ${jibY - 30} L40 ${jibY} M${mastX + 8} ${jibY - 30} L${W + 60} ${jibY}`} stroke="#a16207" strokeWidth="1.5"/>
          <rect x={mastX + 24} y={jibY + 14} width="34" height="26" fill="#6b7280" stroke="#374151"/>
          <rect x={mastX - 10} y={jibY + 16} width="34" height="24" rx="3" fill="#facc15" stroke="#a16207"/>
          <rect x={mastX - 5} y={jibY + 20} width="14" height="10" fill="#bae6fd"/>
          <rect x={mastX - 6} y={fl - 8} width="28" height="8" fill="#6b7280"/>
        </svg>
        <div ref={trolley} style={{ position: "absolute", left: 0, top: jibY + 12, width: 26, height: 9, borderRadius: 2, background: "#374151" }}/>
        <div ref={cable} style={{ position: "absolute", left: 0, top: jibY + 20, width: 2, height: 40, background: "#1f2937" }}/>
        <svg ref={hook} width="18" height="26" viewBox="0 0 18 26" style={{ position: "absolute", left: 0, top: 0 }}>
          <rect x="3" y="0" width="12" height="8" rx="2" fill="#f59e0b" stroke="#92400e"/>
          <path d="M9 8 L9 16 Q9 23 4 21" fill="none" stroke="#475569" strokeWidth="3" strokeLinecap="round"/>
        </svg>
      </div>
      {phase === "pose" && <Pill key="a">🚧 Travaux : révision des 500 heures de ton accueil.</Pill>}
      {phase === "grue" && <Pill key="b">🏗️ La grue remet tout d'aplomb…</Pill>}
      {phase === "fin" && <Pill key="c" fade>Chantier fini dans les délais. Une première dans l'histoire du BTP.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 9. Pellicule
// ════════════════════════════════════════════════════════════════════════════
const PELLICULE_CSS = `
@keyframes pk-pellicule-shut { 0% { transform: scaleY(0) } 45%, 55% { transform: scaleY(1) } 100% { transform: scaleY(0) } }
@keyframes pk-pellicule-flash { 0% { opacity: .9 } 100% { opacity: 0 } }
@keyframes pk-pellicule-holes { from { background-position: 0 0 } to { background-position: 0 36px } }
@keyframes pk-pellicule-ripple { 0% { transform: scale(.2); opacity: .55 } 100% { transform: scale(1.6); opacity: 0 } }
@keyframes pk-pellicule-lamp { 0%, 100% { opacity: .85 } 50% { opacity: 1 } }
`;
const pkFilter = (inv, sep, hue, gray, bri, con) =>
  `invert(${inv}) sepia(${sep}) hue-rotate(${hue}deg) grayscale(${gray}) brightness(${bri}) contrast(${con})`;
function Pellicule({ done }) {
  const s = useStage2(done);
  const [phase, setPhase] = useState("clic"); // clic, neg, bain, fin
  useEffect(() => {
    const { ctl } = s;
    const N0 = pkFilter(0, 0, 0, 0, 1, 1), NEG = pkFilter(1, .55, -12, 0, 1.05, .92);
    const PAPER = pkFilter(0, 0, 0, 1, 2.5, .12), BW = pkFilter(0, 0, 0, 1, 1, 1.06);
    const steps = prop => [
      { [prop]: N0 }, { [prop]: N0, offset: .04 }, { [prop]: NEG, offset: .06 }, { [prop]: NEG, offset: .34 },
      { [prop]: PAPER, offset: .42 }, { [prop]: PAPER, offset: .5 }, { [prop]: BW, offset: .76 }, { [prop]: BW, offset: .84 }, { [prop]: N0 },
    ];
    // le fond de la page suit (ombre interieure : ni filtre ni fond touches sur main)
    const main = ctl.main();
    if (main) {
      let o = "";
      try { o = getComputedStyle(main).boxShadow; } catch (e) { o = ""; }
      const tail = o && o !== "none" ? ", " + o : "";
      const sh = c => ({ boxShadow: `inset 0 0 0 200vmax ${c}${tail}` });
      const none = "rgba(244,241,234,0)", neg = isLight() ? "rgba(26,18,10,1)" : "rgba(234,220,198,1)", paper = "rgba(244,241,234,1)";
      ctl.anim(main, [
        { ...sh(none) }, { ...sh(none), offset: .04 }, { ...sh(neg), offset: .06 }, { ...sh(neg), offset: .34 },
        { ...sh(paper), offset: .42 }, { ...sh(paper), offset: .52 }, { ...sh(none), offset: .76 }, { ...sh(none) },
      ], { duration: 8000, easing: "linear", fill: "forwards" });
    }
    ctl.parts().forEach(p => {
      ctl.anim(p, steps("filter"), { duration: 8000, easing: "linear", fill: "forwards" });
      if (!s.reduced) ctl.anim(p, [{ transform: "rotate(0deg) translateY(0)" }, { transform: "rotate(.5deg) translateY(2px)" },
        { transform: "rotate(-.5deg) translateY(-1px)" }, { transform: "rotate(0deg) translateY(0)" }],
        { duration: 1500, delay: 3500, iterations: 2, easing: "ease-in-out" });
    });
    ctl.after(450, () => setPhase("neg"));
    ctl.after(2900, () => setPhase("bain"));
    ctl.after(7000, () => setPhase("fin"));
    ctl.after(8200, s.finish);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const holes = isNarrow() ? 14 : 24;
  return (
    <Layer s={s} css={PELLICULE_CSS}>
      {phase === "clic" && (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "50.5%", background: "#000", transformOrigin: "50% 0",
            animation: "pk-pellicule-shut .36s ease-in-out both" }}/>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "50.5%", background: "#000", transformOrigin: "50% 100%",
            animation: "pk-pellicule-shut .36s ease-in-out both" }}/>
        </>
      )}
      {phase === "neg" && (
        <>
          <div style={{ position: "absolute", inset: 0, background: "#fff", animation: "pk-pellicule-flash .5s ease-out both" }}/>
          {[0, 1].map(side => (
            <div key={side} aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, [side ? "right" : "left"]: 0, width: holes,
              background: "#1a0e05", display: "flex", justifyContent: "center", animation: "pk-kit-fadein .4s ease both" }}>
              <div style={{ width: holes * .45, height: "100%", animation: "pk-pellicule-holes .5s linear infinite",
                background: "repeating-linear-gradient(180deg, rgba(255,214,170,.75) 0 14px, transparent 14px 36px)" }}/>
            </div>
          ))}
          <div style={{ position: "absolute", left: holes, right: holes, top: 0, bottom: 0, boxShadow: "inset 0 0 0 3px rgba(26,14,5,.9)" }}/>
        </>
      )}
      <div style={{ position: "absolute", inset: 0, background: "rgba(220,38,38,.6)", mixBlendMode: "multiply",
        opacity: phase === "bain" ? 1 : 0, transition: "opacity .9s ease" }}/>
      {phase === "bain" && (
        <>
          <div aria-hidden="true" style={{ position: "absolute", right: 18, top: isNarrow() ? 64 : 20, width: 70, height: 70, borderRadius: "50%",
            background: "radial-gradient(circle, #fecaca 0 14%, #ef4444 30%, rgba(239,68,68,.35) 55%, transparent 72%)",
            animation: "pk-pellicule-lamp 1.4s ease-in-out infinite" }}/>
          {[0, 1, 2].map(i => (
            <span key={i} aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", width: "90vmin", height: "60vmin",
              marginLeft: "-45vmin", marginTop: "-30vmin", borderRadius: "50%", border: "2px solid rgba(255,255,255,.4)",
              animation: `pk-pellicule-ripple 2.4s ease-out ${(i * .8).toFixed(1)}s infinite` }}/>
          ))}
        </>
      )}
      {(phase === "clic" || phase === "neg") && <Pill key="a">📸 Clic-clac ! Ton accueil est passé en négatif.</Pill>}
      {phase === "bain" && <Pill key="b">🔴 Chambre noire : bain de révélateur, on agite doucement…</Pill>}
      {phase === "fin" && <Pill key="c" fade>Tirage réussi : 10 × 15, brillant, sans une poussière.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 10. Eboulement
// ════════════════════════════════════════════════════════════════════════════
const EBOUL_CSS = `
@keyframes pk-eboulement-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes pk-eboulement-dust { 0% { transform: translate(-50%, 0) scale(.3); opacity: .85 } 100% { transform: translate(calc(-50% + var(--dx)), -40px) scale(2); opacity: 0 } }
@keyframes pk-eboulement-clic { 0% { transform: translate(-50%, 0) scale(.5); opacity: 0 } 30% { transform: translate(-50%, -8px) scale(1.1); opacity: 1 }
  100% { transform: translate(-50%, -20px); opacity: 0 } }
`;
function Eboulement({ done }) {
  const s = useStage2(done);
  const hostRef = useRef(null);
  const [msg, setMsg] = useState(1);
  const [cracks, setCracks] = useState([]);
  const [crackOn, setCrackOn] = useState(true);
  const [dust, setDust] = useState([]);
  const [clics, setClics] = useState([]);
  useEffect(() => {
    const { ctl } = s;
    const host = hostRef.current;
    const H = vh(), floor = floorY();
    const bg = pageBg(ctl.main());
    const cards = withRects(tilesOf(ctl, 8)).filter(o => o.r.bottom > 40 && o.r.top < H - 40 && o.r.width > 40 && o.r.height > 24);
    let budget = 96;
    const bricks = [], used = [], cr = [];
    cards.forEach(({ c, r }) => {
      const rows = clamp(Math.round(r.height / 70), 2, 4), cols = clamp(Math.round(r.width / 110), 2, 5);
      if (!host || budget < rows * (cols + 1)) return;
      let snap;
      try { snap = snapshot(c); } catch (e) { return; }
      used.push(c);
      const cs = getComputedStyle(c);
      const bh = r.height / rows, bw = r.width / cols;
      let d = "";
      for (let y = 0; y < rows; y++) {
        const xs = [0];
        for (let x = y % 2 ? bw / 2 : bw; x < r.width - 4; x += bw) xs.push(x);
        xs.push(r.width);
        const top = r.top + y * bh;
        if (y) {
          d += ` M${r.left} ${top.toFixed(1)}`;
          for (let x = 12; x < r.width; x += 12) d += ` L${(r.left + x).toFixed(1)} ${(top + rand(-2.5, 2.5)).toFixed(1)}`;
        }
        for (let k = 0; k < xs.length - 1; k++) {
          const xa = xs[k], xb = xs[k + 1];
          if (k) d += ` M${(r.left + xa).toFixed(1)} ${top.toFixed(1)} L${(r.left + xa + rand(-3, 3)).toFixed(1)} ${(top + bh / 2).toFixed(1)} L${(r.left + xa).toFixed(1)} ${(top + bh).toFixed(1)}`;
          const el = document.createElement("div");
          el.style.cssText = `position:absolute;left:${(r.left + xa).toFixed(1)}px;top:${top.toFixed(1)}px;width:${(xb - xa).toFixed(1)}px;height:${bh.toFixed(1)}px;` +
            `overflow:hidden;opacity:0;background:${bg};color:${cs.color};font-family:${cs.fontFamily};font-size:${cs.fontSize};line-height:${cs.lineHeight};` +
            "border-radius:3px;will-change:transform;";
          const cl = snap.make();
          Object.assign(cl.style, { position: "absolute", left: -xa + "px", top: -(y * bh) + "px", width: r.width + "px", height: r.height + "px",
            margin: "0", transform: "none", animation: "none", transition: "none" });
          el.appendChild(cl);
          const m = document.createElement("div");
          m.style.cssText = "position:absolute;inset:0;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.4), inset 0 2px 0 rgba(255,255,255,.18), inset 0 -2px 0 rgba(0,0,0,.2);";
          el.appendChild(m);
          host.appendChild(el);
          const bottom = top + bh;
          const fromBottom = rows - 1 - y;
          const dy = Math.max(0, floor - bottom - fromBottom * bh * .3 - rand(0, 24));
          const cxr = r.left + (xa + xb) / 2;
          bricks.push({ el, dy, dx: rand(-40, 40) + (cxr - (r.left + r.width / 2)) * .35, rot: rand(-38, 38), fromBottom, k, x: cxr, top });
          budget--;
        }
      }
      cr.push(d);
    });
    setCracks(cr);
    used.forEach(c => ctl.anim(c, jitter(3, 14), { duration: 1000, delay: 300 }));
    const T = (x, y, r) => `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${r.toFixed(1)}deg)`;
    ctl.after(1450, () => {
      setCrackOn(false);
      used.forEach(c => ctl.set(c, { visibility: "hidden" }));
      bricks.forEach(b => {
        b.el.style.opacity = "1";
        const dur = clamp(800 + b.dy * .6, 800, 1500), bump = Math.min(40, b.dy * .12);
        ctl.anim(b.el, [
          { transform: T(0, 0, 0), easing: "cubic-bezier(.55,0,1,.45)" },
          { transform: T(b.dx * .8, b.dy, b.rot * .8), offset: .62, easing: "cubic-bezier(0,.55,.45,1)" },
          { transform: T(b.dx * .9, b.dy - bump, b.rot * .9), offset: .8, easing: "cubic-bezier(.55,0,1,.45)" },
          { transform: T(b.dx, b.dy, b.rot) },
        ], { duration: dur, delay: b.fromBottom * 60 + rand(0, 120), fill: "forwards" });
      });
      const xs = shuffle(bricks.map(b => b.x)).slice(0, 12);
      ctl.after(700, () => setDust(xs.map((x, i) => ({ id: i, x, dx: rand(-40, 40), dl: rand(0, .5) }))));
    });
    ctl.after(4700, () => {
      setMsg(2);
      let last = 0;
      bricks.forEach(b => {
        const delay = b.fromBottom * 280 + b.k * 45 + rand(0, 60);
        last = Math.max(last, delay);
        ctl.anim(b.el, [
          { transform: T(b.dx, b.dy, b.rot) },
          { transform: T(b.dx * .4, Math.min(b.dy * .4, b.dy - 70) - 50, b.rot * .3), offset: .55 },
          { transform: T(0, 0, 0) },
        ], { duration: 650, delay, easing: "cubic-bezier(.3,.7,.4,1)", fill: "forwards" });
      });
      const rowsDone = [...new Set(bricks.map(b => b.fromBottom))].sort((a, b) => a - b);
      rowsDone.forEach(fb => ctl.after(fb * 280 + 650, () => {
        const row = bricks.filter(b => b.fromBottom === fb);
        if (row.length) setClics(cl => [...cl.slice(-6), { id: fb, x: row[0].x, y: row[0].top }]);
      }));
      ctl.after(last + 800, () => {
        used.forEach(c => ctl.unset(c, ["visibility"]));
        if (host) host.style.display = "none";
        setMsg(3); s.finish();
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={EBOUL_CSS}>
      <div ref={hostRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}/>
      {crackOn && (
        <svg width="100%" height="100%" aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
          {cracks.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="rgba(0,0,0,.75)" strokeWidth="2" pathLength="1" strokeDasharray="1"
              style={{ animation: "pk-eboulement-draw 1s ease-out .3s both", filter: "drop-shadow(0 0 1px rgba(255,255,255,.4))" }}/>
          ))}
        </svg>
      )}
      {dust.map(d => (
        <span key={d.id} aria-hidden="true" style={{ position: "absolute", left: d.x, top: floorY() - 20, width: 50, height: 50, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(180,160,130,.7), transparent 70%)", "--dx": `${d.dx}px`,
          animation: `pk-eboulement-dust 1.3s ease-out ${d.dl.toFixed(2)}s both` }}/>
      ))}
      {clics.map(c => (
        <span key={c.id} aria-hidden="true" style={{ position: "absolute", left: c.x, top: c.y - 6, fontWeight: 900, fontSize: 15, color: "#fde047",
          textShadow: "0 2px 5px rgba(0,0,0,.6)", fontFamily: FONT, whiteSpace: "nowrap", animation: "pk-eboulement-clic .7s ease-out both" }}>clac !</span>
      ))}
      {msg === 1 && <Pill key="a">🧱 Effondrement ! Le slicer avait oublié les parois.</Pill>}
      {msg === 2 && <Pill key="b">On reconstruit, couche par couche…</Pill>}
      {msg === 3 && <Pill key="c" fade>Reconstruit à 100 %. Remplissage 15 %, comme d'habitude.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 11. Bulldozer
// ════════════════════════════════════════════════════════════════════════════
const BULL_CSS = `
@keyframes pk-bulldozer-rumble { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-1.5px) } }
@keyframes pk-bulldozer-smoke { 0% { transform: translate(0, 0) scale(.4); opacity: .75 } 100% { transform: translate(-26px, -60px) scale(2); opacity: 0 } }
@keyframes pk-bulldozer-dust { 0% { transform: translate(0, 0) scale(.4); opacity: .7 } 100% { transform: translate(var(--dx), -26px) scale(1.8); opacity: 0 } }
@keyframes pk-bulldozer-beacon { 0%, 49% { opacity: 1 } 50%, 100% { opacity: .15 } }
@keyframes pk-bulldozer-bip { 0% { transform: translate(-50%, 0) scale(.5); opacity: 0 } 30% { transform: translate(-50%, -10px) scale(1.1); opacity: 1 } 100% { transform: translate(-50%, -26px); opacity: 0 } }
`;
function Bulldozer({ done }) {
  const s = useStage2(done);
  const dozRef = useRef(null);
  const [phase, setPhase] = useState("avant"); // avant, pause, arriere, fin
  const [bips, setBips] = useState([]);
  const geo = useMemo(() => { const k = isNarrow() ? .72 : 1; return { k, w: 230 * k, h: 130 * k, y: floorY() - 128 * k }; }, []);
  useEffect(() => {
    const { ctl } = s;
    const W = vw();
    const cards = withRects(tilesOf(ctl, 24)).map(o => ({ c: o.c, L: o.r.left, w: o.r.width, sg: Math.random() < .5 ? -1 : 1 }));
    const maxW = cards.reduce((m, o) => Math.max(m, o.w), 0);
    const X0 = -geo.w - 30, X1 = W + maxW + 60, front = geo.w * .93;
    const xAt = t => (t < .3 ? X0 : t < 3.8 ? lerp(X0, X1, easeInOut((t - .3) / 3.5)) : t < 4.6 ? X1
      : t < 8 ? lerp(X1, X0, easeInOut((t - 4.6) / 3.4)) : X0);
    let ph = "avant", lastBip = 0, bipId = 0;
    ctl.loop(t => {
      const x = xAt(t);
      if (dozRef.current) dozRef.current.style.transform = `translateX(${x.toFixed(1)}px)`;
      cards.forEach(o => {
        const off = Math.max(0, x + front - o.L);
        if (off <= 0) { ctl.unset(o.c, ["transform"]); return; }
        ctl.set(o.c, { transform: `translate(${off.toFixed(1)}px,${(-Math.abs(Math.sin(off / 40)) * 4).toFixed(1)}px) rotate(${(o.sg * Math.min(6, off * .012)).toFixed(2)}deg)` });
      });
      if (ph === "avant" && t >= 3.8) { ph = "pause"; setPhase("pause"); }
      if (ph === "pause" && t >= 4.6) { ph = "arriere"; setPhase("arriere"); }
      if (ph === "arriere" && t - lastBip > .5 && t < 7.8) {
        lastBip = t;
        const id = ++bipId;
        setBips(b => [...b.slice(-4), { id, x: clamp(x + geo.w * .3, 30, W - 30) }]);
      }
      if (t >= 8.1) {
        cards.forEach(o => ctl.unset(o.c, ["transform"]));
        setPhase("fin"); s.finish();
        return false;
      }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const back = phase === "arriere";
  const wheel = (cx, cy, r) => (
    <g key={cx} style={{ transformBox: "fill-box", transformOrigin: "50% 50%",
      animation: `pk-kit-spin .5s linear infinite${back ? " reverse" : ""}${phase === "pause" ? " paused" : ""}` }}>
      <circle cx={cx} cy={cy} r={r} fill="#6b7280" stroke="#374151" strokeWidth="2"/>
      <path d={`M${cx - r + 2} ${cy} L${cx + r - 2} ${cy} M${cx} ${cy - r + 2} L${cx} ${cy + r - 2}`} stroke="#374151" strokeWidth="2"/>
    </g>
  );
  return (
    <Layer s={s} css={BULL_CSS}>
      <div ref={dozRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: geo.y, width: geo.w, height: geo.h, transform: "translateX(-400px)" }}>
        {phase !== "pause" && phase !== "fin" && [0, 1, 2].map(i => (
          <span key={i} style={{ position: "absolute", left: `${50 + i * 4}%`, top: "10%", width: 16, height: 16, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(75,85,99,.8), transparent 70%)", animation: `pk-bulldozer-smoke 1s ease-out ${i * .33}s infinite` }}/>
        ))}
        {phase !== "pause" && phase !== "fin" && [0, 1, 2, 3].map(i => (
          <span key={"d" + i} style={{ position: "absolute", left: back ? "88%" : "4%", bottom: 0, width: 26, height: 26, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(180,160,130,.75), transparent 70%)", "--dx": `${back ? 30 : -30}px`,
            animation: `pk-bulldozer-dust .8s ease-out ${i * .2}s infinite` }}/>
        ))}
        <svg width={geo.w} height={geo.h} viewBox="0 0 230 130" style={{ overflow: "visible", animation: "pk-bulldozer-rumble .18s linear infinite",
          filter: "drop-shadow(0 6px 8px rgba(0,0,0,.35))" }}>
          <rect x="118" y="26" width="8" height="32" fill="#374151"/>
          <rect x="40" y="18" width="58" height="44" rx="4" fill="#facc15" stroke="#a16207" strokeWidth="2"/>
          <rect x="48" y="24" width="42" height="24" rx="2" fill="#bae6fd"/>
          <circle cx="69" cy="13" r="5" fill="#f97316" style={{ animation: back ? "pk-bulldozer-beacon .4s steps(1) infinite" : "none" }}/>
          {back && <circle cx="69" cy="13" r="12" fill="rgba(249,115,22,.35)" style={{ animation: "pk-bulldozer-beacon .4s steps(1) infinite" }}/>}
          <rect x="28" y="58" width="126" height="36" rx="5" fill="#facc15" stroke="#a16207" strokeWidth="2"/>
          <path d="M40 76 L140 76" stroke="#a16207" strokeWidth="2"/>
          <path d="M150 70 L192 80 M150 88 L192 96" stroke="#a16207" strokeWidth="7" strokeLinecap="round"/>
          <path d="M188 46 Q 206 86 192 126 L 210 126 Q 224 86 206 46 Z" fill="#eab308" stroke="#a16207" strokeWidth="2"/>
          <rect x="18" y="92" width="154" height="34" rx="17" fill="#1f2937"/>
          {wheel(36, 109, 11)}{wheel(69, 112, 8)}{wheel(102, 112, 8)}{wheel(135, 112, 8)}{wheel(154, 109, 11)}
        </svg>
      </div>
      {bips.map(b => (
        <span key={b.id} aria-hidden="true" style={{ position: "absolute", left: b.x, top: geo.y - 18, fontWeight: 900, fontSize: 15, color: "#fb923c",
          textShadow: "0 2px 5px rgba(0,0,0,.6)", fontFamily: FONT, animation: "pk-bulldozer-bip .7s ease-out both" }}>bip !</span>
      ))}
      {phase === "avant" && <Pill key="a">🚜 On fait place nette sur l'accueil !</Pill>}
      {phase === "pause" && <Pill key="b">Terrain dégagé. Et maintenant… marche arrière !</Pill>}
      {phase === "arriere" && <Pill key="c">Bip… bip… bip… tout le monde revient à sa place.</Pill>}
      {phase === "fin" && <Pill key="d" fade>Terrassement terminé. Le bulldozer a son permis, promis.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 12. Ressort
// ════════════════════════════════════════════════════════════════════════════
const RESSORT_CSS = `
@keyframes pk-ressort-boing { 0% { transform: translate(-50%, 0) scale(.4) rotate(-10deg); opacity: 0 } 30% { transform: translate(-50%, -14px) scale(1.15) rotate(6deg); opacity: 1 }
  100% { transform: translate(-50%, -34px) scale(1) rotate(0deg); opacity: 0 } }
`;
function Ressort({ done }) {
  const s = useStage2(done);
  const [msg, setMsg] = useState(1);
  const [boings, setBoings] = useState([]);
  useEffect(() => {
    const { ctl } = s;
    const cards = withRects(tilesOf(ctl, 24)).sort(byReading);
    let end = 0;
    cards.forEach(({ c, r }, i) => {
      ctl.set(c, { "transform-origin": "50% 100%" });
      const A0 = clamp(r.height * .35, 36, 110);
      const fr = [];
      let tm = 0;
      const at = (y, sx, sy) => `translateY(${y.toFixed(1)}px) scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
      fr.push({ t: 0, transform: at(0, 1, 1), easing: "ease-in" });
      tm += 200; fr.push({ t: tm, transform: at(0, 1.12, .82), easing: "ease-out" });
      let h = A0, k = 0, firstLand = 0;
      while (h > 2 && k < 9) {
        const q = h / A0, d = 300 * Math.sqrt(q) + 80;
        tm += 60; fr.push({ t: tm, transform: at(0, .94, 1.1), easing: "cubic-bezier(.2,.6,.4,1)" });
        tm += d; fr.push({ t: tm, transform: at(-h, 1, 1), easing: "cubic-bezier(.6,0,.8,.4)" });
        tm += d; fr.push({ t: tm, transform: at(0, .95, 1.08), easing: "ease-out" });
        if (!k) firstLand = tm;
        tm += 70; fr.push({ t: tm, transform: at(0, 1 + .16 * q, 1 - .2 * q), easing: "ease-out" });
        h *= .55; k++;
      }
      tm += 160; fr.push({ t: tm, transform: at(0, 1, 1) });
      const delay = i * 110;
      ctl.anim(c, fr.map(f => ({ transform: f.transform, easing: f.easing, offset: f.t / tm })), { duration: tm, delay, fill: "forwards" });
      end = Math.max(end, delay + tm);
      if (i < 6) ctl.after(delay + firstLand, () => setBoings(b => [...b, { id: i, x: r.left + r.width * rand(.3, .7), y: r.top - 6 }]));
    });
    ctl.after(2800, () => setMsg(2));
    ctl.after(Math.max(end, 4000) + 900, () => { setMsg(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={RESSORT_CSS}>
      {boings.map(b => (
        <span key={b.id} aria-hidden="true" style={{ position: "absolute", left: b.x, top: b.y, fontWeight: 900, fontSize: 20, color: "#a78bfa",
          WebkitTextStroke: "1px #4c1d95", textShadow: "0 3px 0 #4c1d95", fontFamily: FONT, whiteSpace: "nowrap",
          animation: "pk-ressort-boing .9s ease-out both" }}>BOING !</span>
      ))}
      {msg === 1 && <Pill key="a">🪀 Nouveau firmware : suspension sur ressorts activée.</Pill>}
      {msg === 2 && <Pill key="b">Amortisseurs en cours de réglage…</Pill>}
      {msg === 3 && <Pill key="c" fade>Stabilisé. L'input shaping est calibré.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 13. Neon
// ════════════════════════════════════════════════════════════════════════════
const NEON = ["#ff2bd6", "#22d3ee", "#a3e635", "#fbbf24", "#a78bfa", "#fb7185"];
const NEON_CSS = `
@keyframes pk-neon-dead { 0%, 6% { opacity: 1 } 7%, 9% { opacity: 0 } 10%, 38% { opacity: 1 } 39%, 58% { opacity: 0 } 59%, 61% { opacity: 1 }
  62%, 66% { opacity: 0 } 67%, 100% { opacity: 1 } }
@keyframes pk-neon-spark { 0% { transform: translate(0, 0) scale(1); opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) scale(.2); opacity: 0 } }
@keyframes pk-neon-flash { 0% { opacity: 0 } 20% { opacity: .7 } 100% { opacity: 0 } }
`;
const NEON_FLICK = [[0, 0], [.1, 1], [.16, .15], [.28, 1], [.36, .35], [.48, 1], [1, 1]].map(([offset, opacity]) => ({ offset, opacity, easing: "steps(1, end)" }));
function Neon({ done }) {
  const s = useStage2(done);
  const [phase, setPhase] = useState("off"); // off, on, buzz, back
  const [dead, setDead] = useState(null);
  const [frame, setFrame] = useState(null);
  const sparks = useMemo(() => Array.from({ length: 7 }, () => ({ dx: rand(-26, 26), dy: rand(-26, 14), dl: rand(0, 1.6), d: rand(.35, .6) })), []);
  useEffect(() => {
    const { ctl } = s;
    const main = ctl.main();
    const WALL = "#0b0712", CARD = "#0e0a16";
    if (main) { const r = main.getBoundingClientRect(); setFrame({ l: r.left, t: r.top, r: r.right, b: r.bottom }); }
    const touched = [];
    const put = (el, props) => { ctl.set(el, props); touched.push([el, Object.keys(props)]); };
    ctl.after(420, () => {
      setPhase("on");
      if (main) put(main, { background: "repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 2px, transparent 2px 28px), " +
        `repeating-linear-gradient(90deg, rgba(255,255,255,.028) 0 2px, transparent 2px 64px), ${WALL}` });
      const cards = withRects(tilesOf(ctl, 24)).sort(byReading);
      const cardOf = el => cards.findIndex(o => o.c.contains(el));
      cards.forEach(({ c }, i) => {
        const col = NEON[i % NEON.length];
        put(c, { background: CARD, "border-color": col,
          "box-shadow": `0 0 4px ${col}, 0 0 16px ${hexA(col, .75)}, 0 0 34px ${hexA(col, .35)}, inset 0 0 14px ${hexA(col, .3)}` });
        ctl.anim(c, NEON_FLICK, { duration: 1100, delay: i * 130, fill: "backwards" });
      });
      new Set(ctl.textNodes(800, 60).map(n => n.parentElement)).forEach(p => {
        const col = NEON[Math.max(0, cardOf(p)) % NEON.length];
        put(p, { "-webkit-text-fill-color": "#fff5fd", "text-shadow": `0 0 2px #fff, 0 0 7px ${col}, 0 0 15px ${col}` });
      });
      if (main) {
        Array.from(main.querySelectorAll("img,video,canvas,svg")).filter(el => !el.closest("[data-prank-layer]")
          && !(el.parentElement && el.parentElement.closest("svg"))).slice(0, 150).forEach(el => {
          const col = NEON[Math.max(0, cardOf(el)) % NEON.length];
          put(el, { filter: el.tagName.toLowerCase() === "svg" ? `drop-shadow(0 0 3px ${col}) brightness(1.3)` : "brightness(.5) saturate(1.3)" });
        });
      }
      // la lettre fatiguee : de preference dans un titre
      const H = vh(), W = vw();
      const all = ctl.textNodes(400, 0);
      const big = all.filter(n => parseFloat(getComputedStyle(n.parentElement).fontSize) >= 15);
      const pool = big.length ? big : all;
      const rg = document.createRange();
      for (let k = 0; k < 14 && pool.length; k++) {
        const n = pick(pool), idx = [];
        for (let i = 0; i < n.data.length; i++) if (/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(n.data[i])) idx.push(i);
        if (!idx.length) continue;
        const off = pick(idx);
        rg.setStart(n, off); rg.setEnd(n, off + 1);
        const r = rg.getBoundingClientRect();
        if (!r.width || r.top < 60 || r.bottom > H - 100 || r.left < 4 || r.right > W - 4) continue;
        const cs = getComputedStyle(n.parentElement);
        const ci = cardOf(n.parentElement);
        let ch = n.data[off];
        if (cs.textTransform === "uppercase") ch = ch.toUpperCase();
        setDead({ x: r.left, y: r.top, w: r.width, h: r.height, ch, bg: ci >= 0 ? CARD : WALL, col: NEON[Math.max(0, ci) % NEON.length],
          font: { fontStyle: cs.fontStyle, fontWeight: cs.fontWeight, fontSize: cs.fontSize, fontFamily: cs.fontFamily, letterSpacing: cs.letterSpacing } });
        break;
      }
    });
    ctl.after(1900, () => setPhase("buzz"));
    ctl.after(6500, () => {
      touched.forEach(([el, names]) => ctl.unset(el, names));
      setPhase("back");
    });
    ctl.after(7300, s.finish);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const night = phase === "on" || phase === "buzz";
  const shade = "rgba(5,3,10,.86)";
  return (
    <Layer s={s} css={NEON_CSS}>
      <div style={{ position: "absolute", inset: 0, background: "#000", opacity: phase === "off" ? 1 : 0,
        transition: phase === "off" ? "opacity .35s ease" : "opacity .2s ease" }}/>
      {frame && night && (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: Math.max(0, frame.t), background: shade }}/>
          <div style={{ position: "absolute", left: 0, right: 0, top: frame.b, bottom: 0, background: shade }}/>
          <div style={{ position: "absolute", left: 0, width: Math.max(0, frame.l), top: frame.t, height: frame.b - frame.t, background: shade }}/>
          <div style={{ position: "absolute", left: frame.r, right: 0, top: frame.t, height: frame.b - frame.t, background: shade }}/>
        </>
      )}
      {dead && night && (
        <div aria-hidden="true" style={{ position: "absolute", left: dead.x - 2, top: dead.y, width: dead.w + 4, height: dead.h, background: dead.bg }}>
          <span style={{ position: "absolute", left: 2, top: 0, lineHeight: `${dead.h}px`, whiteSpace: "pre", color: "#3b3242", ...dead.font }}>{dead.ch}</span>
          <span style={{ position: "absolute", left: 2, top: 0, lineHeight: `${dead.h}px`, whiteSpace: "pre", color: "#fff5fd", ...dead.font,
            textShadow: `0 0 2px #fff, 0 0 7px ${dead.col}, 0 0 15px ${dead.col}`,
            animation: phase === "buzz" ? "pk-neon-dead 2.3s linear infinite" : "none" }}>{dead.ch}</span>
          {phase === "buzz" && sparks.map((k, i) => (
            <span key={i} style={{ position: "absolute", left: "50%", top: "30%", width: 3, height: 3, borderRadius: "50%", background: "#fff",
              boxShadow: `0 0 6px ${dead.col}`, "--dx": `${k.dx}px`, "--dy": `${k.dy}px`,
              animation: `pk-neon-spark ${k.d.toFixed(2)}s ease-out ${k.dl.toFixed(2)}s infinite` }}/>
          ))}
        </div>
      )}
      {phase === "back" && <div style={{ position: "absolute", inset: 0, background: "#fffbe8", animation: "pk-neon-flash .7s ease-out both" }}/>}
      {(phase === "off" || phase === "on") && <Pill key="a">🌃 La nuit tombe… l'atelier passe en enseigne néon.</Pill>}
      {phase === "buzz" && <Pill key="b">{dead ? `Bzzzt… le « ${dead.ch} » commence à fatiguer.` : "Bzzzt… un tube commence à fatiguer."}</Pill>}
      {phase === "back" && <Pill key="c" fade>💡 Plafonnier rallumé. Fini, Las Vegas.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 14. Origami
// ════════════════════════════════════════════════════════════════════════════
function PaperPlane({ c }) {
  return (
    <svg width="54" height="34" viewBox="0 0 54 34" aria-hidden="true" style={{ display: "block", overflow: "visible",
      filter: "drop-shadow(0 6px 6px rgba(0,0,0,.3))" }}>
      <path d="M0 4 L54 14 L18 18 Z" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M18 18 L54 14 L24 31 Z" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M8 7 L50 14" stroke={c} strokeWidth="2.4" strokeLinecap="round"/>
    </svg>
  );
}
function catmull(pts, u) {
  const n = pts.length - 1, sx = clamp(u, 0, 1) * n, i = Math.min(n - 1, Math.floor(sx)), f = sx - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const c = k => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f
    + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f * f * f);
  return [c(0), c(1)];
}
function Origami({ done }) {
  const s = useStage2(done);
  const [items, setItems] = useState([]);
  const [msg, setMsg] = useState(1);
  const sheetRefs = useRef([]), planeRefs = useRef([]), popRefs = useRef([]);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh(), top = isNarrow() ? 74 : 34, bot = floorY() - 30;
    const cards = withRects(tilesOf(ctl, 8)).filter(o => o.r.bottom > 40 && o.r.top < H - 40 && o.r.width > 20).sort(byReading);
    const its = cards.map((o, i) => ({ id: i, x: o.r.left, y: o.r.top, w: o.r.width, h: o.r.height,
      cx: o.r.left + o.r.width / 2, cy: clamp(o.r.top + o.r.height / 2, top + 20, bot - 20), col: FILAMENTS[i % FILAMENTS.length], dl: i * 140 }));
    setItems(its);
    if (!its.length) { ctl.after(2500, () => { setMsg(3); s.finish(); }); return; }
    const P = "perspective(900px) ";
    const FLY = 4000;
    const paths = its.map(o => {
      const d = o.cx < W / 2 ? 1 : -1, r = clamp(W * .09, 40, 85);
      const h = [o.cx, o.cy];
      const P1 = [h[0] + d * W * .18, h[1] - H * .06];
      const C = [P1[0] + d * r * .2, P1[1] - r];
      const raw = [h, P1, [C[0] + d * r, C[1]], [C[0], C[1] - r], [C[0] - d * r, C[1]], [C[0] + d * 12, C[1] + r],
        [h[0] + d * W * .32, h[1] + H * .08], [h[0] + d * W * .12, h[1] + H * .12], [h[0] - d * W * .06, h[1] + H * .03], h];
      return raw.map(([x, y]) => [clamp(x, 30, W - 30), clamp(y, top, bot)]);
    });
    ctl.after(40, () => {
      its.forEach((o, i) => {
        const c = cards[i].c, sh = sheetRefs.current[i], pop = popRefs.current[i];
        const sx = 70 / Math.max(o.w, 1), sy = 70 / Math.max(o.h, 1);
        ctl.anim(c, [{ transform: P + "rotateX(0deg) scale(1)", opacity: 1 }, { transform: P + "rotateX(70deg) scale(.5)", opacity: 0 }],
          { duration: 600, delay: o.dl, easing: "ease-in", fill: "forwards" });
        if (sh) ctl.anim(sh, [
          { opacity: 0, transform: "rotate(0deg) scale(1,1)" }, { opacity: 1, transform: "rotate(0deg) scale(1,1)", offset: .25 },
          { opacity: 1, transform: `rotate(45deg) scale(${sx},${sy})`, offset: .75 }, { opacity: 0, transform: `rotate(45deg) scale(0,${sy})` },
        ], { duration: 1300, delay: o.dl, easing: "ease-in-out", fill: "forwards" });
        if (pop) ctl.anim(pop, [{ transform: "scale(0,1)" }, { transform: "scale(1,1)" }], { duration: 260, delay: o.dl + 1150, fill: "both" });
        const land = o.dl + 1400 + FLY;
        ctl.after(land, () => {
          if (pop) ctl.anim(pop, [{ transform: "scale(1,1)" }, { transform: "scale(0,1)" }], { duration: 260, fill: "forwards" });
          if (sh) ctl.anim(sh, [
            { opacity: 0, transform: `rotate(45deg) scale(0,${sy})` }, { opacity: 1, transform: `rotate(45deg) scale(${sx},${sy})`, offset: .25 },
            { opacity: 1, transform: "rotate(0deg) scale(1,1)", offset: .75 }, { opacity: 0, transform: "rotate(0deg) scale(1,1)" },
          ], { duration: 1300, delay: 150, easing: "ease-in-out", fill: "forwards" });
          ctl.anim(c, [{ transform: P + "rotateX(70deg) scale(.5)", opacity: 0 }, { transform: P + "rotateX(0deg) scale(1)", opacity: 1 }],
            { duration: 600, delay: 1000, easing: "ease-out", fill: "forwards" });
        });
      });
      const last = its[its.length - 1].dl + 1400 + FLY + 1700;
      let said = false;
      ctl.loop(t => {
        const ms = t * 1000;
        its.forEach((o, i) => {
          const el = planeRefs.current[i];
          if (!el) return;
          const u = easeInOut(clamp((ms - o.dl - 1400) / FLY, 0, 1));
          const p = catmull(paths[i], u), q = catmull(paths[i], Math.min(1, u + .004));
          const dx = q[0] - p[0], dy = q[1] - p[1];
          const a = dx || dy ? Math.atan2(dy, dx) : 0;
          el.style.transform = `translate(${(p[0] - 27).toFixed(1)}px,${(p[1] - 17).toFixed(1)}px) rotate(${(a * 180 / Math.PI).toFixed(1)}deg) scaleY(${Math.cos(a) < 0 ? -1 : 1})`;
        });
        if (ms > 2600 && !said) { said = true; setMsg(2); }
        if (ms >= last) { setMsg(3); s.finish(); return false; }
        return true;
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s}>
      {items.map((o, i) => (
        <div key={o.id} ref={el => { sheetRefs.current[i] = el; }} aria-hidden="true" style={{ position: "absolute", left: o.x, top: o.y,
          width: o.w, height: o.h, opacity: 0, borderRadius: 6, boxShadow: "0 6px 18px rgba(0,0,0,.3)",
          background: "repeating-linear-gradient(0deg, rgba(148,163,184,.25) 0 1px, transparent 1px 18px), linear-gradient(135deg, #ffffff, #e2e8f0)" }}/>
      ))}
      {items.map((o, i) => (
        <div key={"p" + o.id} ref={el => { planeRefs.current[i] = el; }} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0,
          width: 54, height: 34, transformOrigin: "27px 17px", transform: `translate(${o.cx - 27}px,${o.cy - 17}px)` }}>
          <div ref={el => { popRefs.current[i] = el; }} style={{ transform: "scale(0,1)" }}><PaperPlane c={o.col}/></div>
        </div>
      ))}
      {msg === 1 && <Pill key="a">✈️ Pliage en cours : chaque carte devient un avion en papier.</Pill>}
      {msg === 2 && <Pill key="b">Looping ! Le meilleur pilote gagne une bobine.</Pill>}
      {msg === 3 && <Pill key="c" fade>Atterrissage parfait. Tout le monde est déplié.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 15. Zoom avant
// ════════════════════════════════════════════════════════════════════════════
const ZOOM_CSS = `
@keyframes pk-zoom-avant-lines { from { transform: rotate(0deg) scale(1) } to { transform: rotate(8deg) scale(1.08) } }
`;
function ZoomAvant({ done }) {
  const s = useStage2(done);
  const camRef = useRef(null);
  const [msg, setMsg] = useState(1);
  const [focus, setFocus] = useState(null);
  const [rush, setRush] = useState(false);
  useEffect(() => {
    const { ctl } = s;
    const main = ctl.main(), cam = camRef.current;
    if (!main || !cam) { ctl.after(2000, () => { setMsg(3); s.finish(); }); return; }
    const W = vw(), H = vh();
    const mr = main.getBoundingClientRect();
    const bg = pageBg(main);
    const cand = withRects(tilesOf(ctl, 20)).filter(o => o.r.top >= Math.max(0, mr.top) - 2 && o.r.bottom <= Math.min(H, mr.bottom) + 2
      && o.r.width > 60 && o.r.height > 50);
    let tr, rad = 16;
    if (cand.length) {
      const o = cand.reduce((a, b) => (b.r.width * b.r.height > a.r.width * a.r.height ? b : a));
      tr = o.r;
      rad = parseFloat(getComputedStyle(o.c).borderTopLeftRadius) || 12;
    } else tr = { left: mr.left + mr.width * .3, top: mr.top + mr.height * .3, width: mr.width * .4, height: mr.height * .4 };
    const k = Math.min(tr.width / mr.width, tr.height / mr.height) * .9;
    const ix = tr.left + (tr.width - k * mr.width) / 2, iy = tr.top + (tr.height - k * mr.height) / 2;
    const cx = (ix - k * mr.left) / (1 - k), cy = (iy - k * mr.top) / (1 - k);
    setFocus({ x: cx, y: cy });
    let snap;
    try { snap = snapshot(main); } catch (e) { ctl.after(2000, () => { setMsg(3); s.finish(); }); return; }
    const LV = k < .5 ? 5 : 7;
    for (let i = 0; i < LV; i++) {
      const wrap = document.createElement("div");
      wrap.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;` +
        `transform:translate(${cx}px,${cy}px) scale(${Math.pow(k, i)}) translate(${-cx}px,${-cy}px);`;
      const frame = document.createElement("div");
      frame.style.cssText = `position:absolute;left:${mr.left}px;top:${mr.top}px;width:${mr.width}px;height:${mr.height}px;overflow:hidden;background:${bg};` +
        (i ? `border-radius:${(rad * .8 / k).toFixed(1)}px;box-shadow:0 0 0 ${(2 / k).toFixed(1)}px rgba(139,92,246,.65), 0 ${(8 / k).toFixed(1)}px ${(24 / k).toFixed(1)}px rgba(0,0,0,.45);` : "");
      const copy = mainCopy(snap, { left: 0, top: 0, width: mr.width, height: mr.height }, bg);
      frame.appendChild(copy);
      wrap.appendChild(frame);
      cam.appendChild(wrap);
      copy.scrollTop = main.scrollTop;
    }
    const Z = 5;
    const zAt = t => (t < .4 ? 0 : t < 5.6 ? Z * Math.pow((t - .4) / 5.2, 1.6) : t < 5.9 ? Z : t < 6.7 ? Z * (1 - easeInOut((t - 5.9) / .8)) : 0);
    let said = 1;
    ctl.loop(t => {
      const z = zAt(t), f = z - Math.floor(z);
      const S = Math.pow(k, -f);
      cam.style.transform = `translate(${cx.toFixed(1)}px,${cy.toFixed(1)}px) scale(${S.toFixed(5)}) translate(${(-cx).toFixed(1)}px,${(-cy).toFixed(1)}px)`;
      if (said === 1 && t > 1) { said = 2; setRush(true); }
      if (said === 2 && t > 5.6) { said = 3; setMsg(2); }
      if (said === 3 && t > 6.7) {
        said = 4;
        cam.style.transform = "none";
        cam.style.display = "none";
        setRush(false); setMsg(3); s.finish();
        return false;
      }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={ZOOM_CSS}>
      <div ref={camRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", transformOrigin: "0 0" }}/>
      {focus && (
        <div aria-hidden="true" style={{ position: "absolute", left: focus.x, top: focus.y, width: 0, height: 0, opacity: rush ? .55 : 0, transition: "opacity .6s ease" }}>
          <div style={{ position: "absolute", left: "-150vmax", top: "-150vmax", width: "300vmax", height: "300vmax", borderRadius: "50%",
            background: "repeating-conic-gradient(rgba(255,255,255,.5) 0 .6deg, transparent .6deg 7deg)",
            WebkitMaskImage: "radial-gradient(circle, transparent 12%, #000 40%)", maskImage: "radial-gradient(circle, transparent 12%, #000 40%)",
            animation: "pk-zoom-avant-lines .25s linear infinite alternate" }}/>
        </div>
      )}
      {msg === 1 && <Pill key="a">🔍 Zoom × 2… × 4… × 8… on cherche la buse.</Pill>}
      {msg === 2 && <Pill key="b">Mise au point infinie atteinte. On remonte !</Pill>}
      {msg === 3 && <Pill key="c" fade>Retour à l'échelle 1:1. Tout est à sa place.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 16. Cubisme
// ════════════════════════════════════════════════════════════════════════════
const CUBIST = ["#c2410c", "#a16207", "#78716c", "#1e3a8a", "#0f766e", "#d6d3d1", "#57534e", "#b45309", "#334155"];
function CubistFace({ seed }) {
  const polys = useMemo(() => Array.from({ length: 13 }, () => {
    const cx = rand(0, 100), cy = rand(0, 100), n = 3 + Math.floor(rand(0, 3));
    const pts = Array.from({ length: n }, (_, k) => {
      const a = k / n * Math.PI * 2 + rand(-.4, .4), r = rand(18, 48);
      return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
    }).join(" ");
    return { pts, c: pick(CUBIST), o: rand(.75, 1) };
  }), [seed]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: "block" }}>
      <rect width="100" height="100" fill="#e7e5e4"/>
      {polys.map((p, i) => <polygon key={i} points={p.pts} fill={p.c} opacity={p.o} stroke="#1c1917" strokeWidth="1.4" vectorEffect="non-scaling-stroke"/>)}
      <circle cx="38" cy="40" r="6" fill="#fafaf9" stroke="#1c1917" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
      <circle cx="38" cy="40" r="2.4" fill="#1c1917"/>
    </svg>
  );
}
function Cubisme({ done }) {
  const s = useStage2(done);
  const [cubes, setCubes] = useState([]);
  const faceRefs = useRef({});
  const [msg, setMsg] = useState(1);
  useEffect(() => {
    const { ctl } = s;
    const H = vh();
    const cards = withRects(tilesOf(ctl, 10)).filter(o => o.r.bottom > 30 && o.r.top < H - 30 && o.r.width > 20 && o.r.height > 20).sort(byReading);
    const list = cards.map((o, i) => ({ id: i, x: o.r.left, y: o.r.top, w: o.r.width, h: o.r.height, axis: i % 2 ? "X" : "Y",
      D: clamp(Math.min(o.r.width, o.r.height), 40, 260), rad: getComputedStyle(o.c).borderTopLeftRadius }));
    setCubes(list);
    const TIMES = [[0, 0], [700, 90], [1050, 90], [1750, 180], [2100, 180], [2800, 270], [3150, 270], [3850, 360]];
    const TOTAL = 3850;
    let end = 0;
    ctl.after(40, () => {
      list.forEach((q, i) => {
        const c = cards[i].c;
        const tf = (theta, kk) => {
          const odd = kk % 2 === 1;
          const r = odd ? (q.axis === "Y" ? q.w : q.h) / 2 : q.D / 2;
          return `perspective(1100px) translateZ(${(-q.D / 2).toFixed(1)}px) rotate${q.axis}(${(theta + 90 * kk).toFixed(1)}deg) translateZ(${r.toFixed(1)}px)`;
        };
        const kf = kk => TIMES.map(([tm, th], j) => ({ transform: tf(th, kk), offset: tm / TOTAL,
          easing: j % 2 === 0 ? "cubic-bezier(.5,-0.3,.4,1.35)" : "linear" }));
        const delay = 300 + i * 150;
        end = Math.max(end, delay + TOTAL);
        ctl.set(c, { "transform-origin": "50% 50%", "backface-visibility": "hidden", "-webkit-backface-visibility": "hidden" });
        ctl.anim(c, kf(0), { duration: TOTAL, delay, fill: "forwards" });
        [1, 2, 3].forEach(kk => {
          const el = faceRefs.current[`${q.id}-${kk}`];
          if (el) ctl.anim(el, kf(kk), { duration: TOTAL, delay, fill: "both" });
        });
      });
      ctl.after(2600, () => setMsg(2));
      ctl.after(end + 300, () => { setMsg(3); s.finish(); });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s}>
      {cubes.map(q => [1, 2, 3].map(kk => {
        const odd = kk % 2 === 1;
        const fw = odd && q.axis === "Y" ? q.D : q.w, fh = odd && q.axis === "X" ? q.D : q.h;
        return (
          <div key={`${q.id}-${kk}`} ref={el => { faceRefs.current[`${q.id}-${kk}`] = el; }} aria-hidden="true"
            style={{ position: "absolute", left: q.x + q.w / 2 - fw / 2, top: q.y + q.h / 2 - fh / 2, width: fw, height: fh,
              borderRadius: q.rad, overflow: "hidden", border: "2px solid #1c1917", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
              transformOrigin: "50% 50%", transform: "rotateY(90deg)" }}>
            <CubistFace seed={`${q.id}-${kk}`}/>
          </div>
        );
      }))}
      {msg === 1 && <Pill key="a">🎨 Période cubiste : Picasso a pris le contrôle du slicer.</Pill>}
      {msg === 2 && <Pill key="b">« Les Demoiselles d'Imprimante », huile sur PLA, 2026.</Pill>}
      {msg === 3 && <Pill key="c" fade>Retour au figuratif. Tout est bien à plat.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 17. Briques
// ════════════════════════════════════════════════════════════════════════════
const BRIQUES_CSS = `
@keyframes pk-briques-stud { 0% { transform: scaleY(0) } 70% { transform: scaleY(1.2) } 100% { transform: scaleY(1) } }
@keyframes pk-briques-unstud { from { transform: scaleY(1); opacity: 1 } to { transform: scaleY(0); opacity: 0 } }
@keyframes pk-briques-clic { 0% { transform: translate(-50%, 0) scale(.5); opacity: 0 } 30% { transform: translate(-50%, -10px) scale(1.1); opacity: 1 }
  100% { transform: translate(-50%, -24px); opacity: 0 } }
`;
const BRICK_COLORS = ["#ef4444", "#facc15", "#3b82f6", "#22c55e", "#f97316", "#a855f7"];
function Briques({ done }) {
  const s = useStage2(done);
  const [items, setItems] = useState([]);
  const [msg, setMsg] = useState(1);
  const [clics, setClics] = useState([]);
  const rowRefs = useRef([]);
  useEffect(() => {
    const { ctl } = s;
    const H = vh();
    const cards = withRects(tilesOf(ctl, 16)).filter(o => o.r.bottom > 30 && o.r.top < H - 30 && o.r.width > 30).sort(byReading);
    const its = cards.map((o, i) => ({ id: i, x: o.r.left, y: o.r.top, w: o.r.width, h: o.r.height, col: BRICK_COLORS[i % 6],
      n: clamp(Math.round(o.r.width / 44), 2, 14) }));
    setItems(its);
    const JUMP = [
      { transform: "translateY(0px) rotate(0deg) scaleY(1)", easing: "cubic-bezier(.2,.7,.4,1)" },
      { transform: "translateY(-70px) rotate(-2deg) scaleY(1)", offset: .35 },
      { transform: "translateY(-70px) rotate(1deg) scaleY(1)", offset: .55, easing: "cubic-bezier(.6,0,.9,.5)" },
      { transform: "translateY(3px) rotate(0deg) scaleY(.95)", offset: .85, easing: "ease-out" },
      { transform: "translateY(0px) rotate(0deg) scaleY(1)" },
    ];
    const n = its.length;
    const Tr = Math.max(5600, 1300 + n * 260 + 900);
    cards.forEach(({ c }, i) => {
      const col = its[i].col;
      const [off, on] = shadowPair(c, `inset 0 0 0 2000px ${hexA(col, 0)}, inset 0 3px 0 rgba(255,255,255,0), inset 0 -4px 0 rgba(0,0,0,0)`,
        `inset 0 0 0 2000px ${hexA(col, .5)}, inset 0 3px 0 rgba(255,255,255,.45), inset 0 -4px 0 rgba(0,0,0,.3)`);
      const bc = getComputedStyle(c).borderTopColor;
      ctl.anim(c, [{ boxShadow: off, borderColor: bc }, { boxShadow: on, borderColor: col }], { duration: 500, delay: 200 + i * 90, fill: "forwards" });
      ctl.after(Tr + i * 50, () => ctl.anim(c, [{ boxShadow: on, borderColor: col }, { boxShadow: off, borderColor: bc }], { duration: 700, fill: "forwards" }));
      ctl.set(c, { "transform-origin": "50% 100%" });
      const delay = 1300 + i * 260;
      ctl.anim(c, JUMP, { duration: 900, delay });
      ctl.after(40, () => { const el = rowRefs.current[i]; if (el) ctl.anim(el, JUMP, { duration: 900, delay: delay - 40 }); });
      ctl.after(delay + 770, () => setClics(cl => [...cl.slice(-5), { id: i, x: its[i].x + its[i].w / 2, y: its[i].y }]));
    });
    ctl.after(Tr, () => setMsg(3));
    ctl.after(2400, () => setMsg(m => (m === 1 ? 2 : m)));
    ctl.after(Tr + 900, s.finish);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const gone = msg === 3;
  return (
    <Layer s={s} css={BRIQUES_CSS}>
      {items.map((o, i) => {
        const sp = o.w / o.n, sw = Math.min(30, sp * .62);
        return (
          <div key={o.id} ref={el => { rowRefs.current[i] = el; }} aria-hidden="true" style={{ position: "absolute", left: o.x, top: o.y,
            width: o.w, height: o.h, transformOrigin: "50% 100%" }}>
            {Array.from({ length: o.n }, (_, k) => (
              <span key={k} style={{ position: "absolute", left: sp * (k + .5) - sw / 2, top: -9, width: sw, height: 10, borderRadius: "5px 5px 2px 2px",
                transformOrigin: "50% 100%", boxShadow: "0 -1px 0 rgba(0,0,0,.25)",
                background: `linear-gradient(90deg, ${hexA(o.col, .75)}, ${o.col} 35%, #fff8 50%, ${o.col} 65%, ${hexA(o.col, .7)})`,
                animation: gone ? "pk-briques-unstud .4s ease-in both" : `pk-briques-stud .35s cubic-bezier(.3,1.4,.5,1) ${(.4 + i * .09 + k * .02).toFixed(2)}s both` }}/>
            ))}
          </div>
        );
      })}
      {clics.map(c => (
        <span key={c.id} aria-hidden="true" style={{ position: "absolute", left: c.x, top: c.y - 14, fontWeight: 900, fontSize: 16, color: "#fde047",
          textShadow: "0 2px 5px rgba(0,0,0,.6)", fontFamily: FONT, whiteSpace: "nowrap", animation: "pk-briques-clic .7s ease-out both" }}>clic !</span>
      ))}
      {msg === 1 && <Pill key="a">🧱 Mode jeu de construction : chaque carte devient une brique.</Pill>}
      {msg === 2 && <Pill key="b">Clic… clic… tout s'emboîte (tolérance 0,1 mm).</Pill>}
      {msg === 3 && <Pill key="c" fade>Démoulé. Aucune brique n'a fini sous un pied nu.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 18. Pluie de filament
// ════════════════════════════════════════════════════════════════════════════
const PF_CSS = `
@keyframes pk-pluie-filament-fall { 0% { transform: translate(0, -18vh) rotate(var(--r0)); opacity: 1 } 92% { opacity: 1 }
  100% { transform: translate(var(--dx), var(--fy)) rotate(var(--r1)); opacity: 0 } }
@keyframes pk-pluie-filament-splash { 0% { transform: translate(-50%, 0) scale(.2); opacity: 0 } 20% { opacity: 1 } 100% { transform: translate(-50%, -6px) scale(1.5); opacity: 0 } }
@keyframes pk-pluie-filament-rise { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes pk-pluie-filament-dry { from { transform: scaleY(1); opacity: 1 } to { transform: scaleY(0); opacity: 0 } }
@keyframes pk-pluie-filament-shimmer { from { background-position: 0 0 } to { background-position: 480px 0 } }
@keyframes pk-pluie-filament-steam { 0% { transform: translate(0, 0) scale(.5); opacity: 0 } 25% { opacity: .5 } 100% { transform: translate(var(--dx), -36vh) scale(2.2); opacity: 0 } }
@keyframes pk-pluie-filament-surf { from { transform: translateX(0) } to { transform: translateX(-50%) } }
`;
const SQUIGGLE = ["M5 0 C 0 8, 10 14, 5 22 S 0 36, 5 44", "M5 0 C 10 10, 0 16, 6 26 S 10 40, 4 52", "M4 0 C 9 6, 1 12, 5 18 S 9 28, 5 34"];
function PluieFilament({ done }) {
  const s = useStage2(done);
  const [phase, setPhase] = useState(1); // 1 averse, 2 flaque, 3 vapeur, 4 fin
  const drops = useMemo(() => {
    const W = vw(), fl = floorY(), n = isNarrow() ? 50 : 90;
    return Array.from({ length: n }, (_, i) => {
      const x = rand(0, W), dx = rand(-30, 30), dur = rand(.9, 1.6), dl = rand(0, 4.4);
      return { x, dx, dur, dl, fy: fl - rand(14, 46), r0: `${rand(-30, 30).toFixed(0)}deg`, r1: `${rand(-200, 200).toFixed(0)}deg`,
        c: FILAMENTS[i % FILAMENTS.length], d: pick(SQUIGGLE), sc: rand(.8, 1.3) };
    });
  }, []);
  const steam = useMemo(() => Array.from({ length: 12 }, () => ({ x: rand(2, 92), dx: rand(-40, 40), dl: rand(0, .9), d: rand(1.4, 2.2), r: rand(40, 80) })), []);
  useEffect(() => {
    const { ctl } = s;
    ctl.after(3600, () => setPhase(2));
    ctl.after(6000, () => setPhase(3));
    ctl.after(7900, () => { setPhase(4); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bottom = `calc(${isNarrow() ? 72 : 0}px + env(safe-area-inset-bottom, 0px))`;
  const rainbow = `linear-gradient(90deg, ${[...FILAMENTS, FILAMENTS[0]].join(", ")})`;
  return (
    <Layer s={s} css={PF_CSS}>
      {phase < 3 && drops.map((d, i) => (
        <React.Fragment key={i}>
          <div aria-hidden="true" style={{ position: "absolute", left: d.x, top: 0, "--dx": `${d.dx}px`, "--fy": `${d.fy}px`, "--r0": d.r0, "--r1": d.r1,
            animation: `pk-pluie-filament-fall ${d.dur.toFixed(2)}s cubic-bezier(.5,0,.9,.6) ${d.dl.toFixed(2)}s both` }}>
            <svg width={12 * d.sc} height={54 * d.sc} viewBox="0 0 12 54" style={{ display: "block", overflow: "visible" }}>
              <path d={d.d} fill="none" stroke={d.c} strokeWidth="3.2" strokeLinecap="round"/>
              <path d={d.d} fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="1" strokeLinecap="round" transform="translate(-.8 0)"/>
            </svg>
          </div>
          <span aria-hidden="true" style={{ position: "absolute", left: d.x + d.dx, top: d.fy + 10, width: 22, height: 8, borderRadius: "50%",
            border: `2px solid ${d.c}`, animation: `pk-pluie-filament-splash .45s ease-out ${(d.dl + d.dur).toFixed(2)}s both` }}/>
        </React.Fragment>
      ))}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom, height: "max(64px, 11vh)", transformOrigin: "50% 100%",
        animation: phase >= 3 ? "pk-pluie-filament-dry 1.8s ease-in both" : "pk-pluie-filament-rise 4.6s cubic-bezier(.3,.1,.3,1) .7s both" }}>
        <div style={{ position: "absolute", inset: 0, background: rainbow, backgroundSize: "480px 100%", opacity: .85,
          animation: "pk-pluie-filament-shimmer 3s linear infinite", borderRadius: "40% 40% 0 0 / 14px 14px 0 0" }}/>
        <div style={{ position: "absolute", left: 0, top: -12, width: "200%", height: 20, animation: "pk-pluie-filament-surf 2.6s linear infinite" }}>
          <svg width="100%" height="20" viewBox="0 0 1200 40" preserveAspectRatio="none">
            <path d={WAVE_D + " L1200 40 L0 40 Z"} fill="rgba(255,255,255,.35)"/>
          </svg>
        </div>
        <div style={{ position: "absolute", left: "8%", right: "30%", top: 6, height: 4, borderRadius: 4, background: "rgba(255,255,255,.55)", filter: "blur(1px)" }}/>
      </div>
      {phase === 3 && steam.map((k, i) => (
        <span key={i} aria-hidden="true" style={{ position: "absolute", left: `${k.x}%`, bottom: "calc(8vh + 70px)", width: k.r, height: k.r * 1.6,
          borderRadius: "50%", background: "radial-gradient(ellipse, rgba(241,245,249,.7), transparent 70%)", filter: "blur(4px)", "--dx": `${k.dx}px`,
          animation: `pk-pluie-filament-steam ${k.d.toFixed(2)}s ease-out ${k.dl.toFixed(2)}s both` }}/>
      ))}
      {phase === 1 && <Pill key="a">🌧️ Averse de filament : tous les coloris tombent en même temps !</Pill>}
      {phase === 2 && <Pill key="b">Belle flaque arc-en-ciel… (le PLA, ça ne se boit pas).</Pill>}
      {phase === 3 && <Pill key="c">♨️ Ça s'évapore… petite odeur de PLA chaud.</Pill>}
      {phase === 4 && <Pill key="d" fade>Plateau sec. Prêt pour la prochaine impression.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 19. Kaleidoscope
// ════════════════════════════════════════════════════════════════════════════
const KALEI_CSS = `
@keyframes pk-kaleidoscope-glint { 0%, 100% { opacity: .15 } 50% { opacity: .55 } }
`;
function Kaleidoscope({ done }) {
  const s = useStage2(done);
  const hostRef = useRef(null);
  const [geo, setGeo] = useState(null);
  const [msg, setMsg] = useState(1);
  useEffect(() => {
    const { ctl } = s;
    const main = ctl.main(), host = hostRef.current;
    const bail = () => ctl.after(2500, () => { setMsg(3); s.finish(); });
    if (!main || !host) { bail(); return; }
    const W = vw(), H = vh();
    const mr = main.getBoundingClientRect();
    const v = { l: Math.max(0, mr.left), t: Math.max(0, mr.top), r: Math.min(W, mr.right), b: Math.min(H, mr.bottom) };
    const cx = (v.l + v.r) / 2, cy = (v.t + v.b) / 2, R = Math.min(v.r - v.l, v.b - v.t) / 2 * .97;
    setGeo({ cx, cy, R });
    let snap;
    try { snap = snapshot(main); } catch (e) { bail(); return; }
    const bg = pageBg(main);
    const N = 6, B = 360 / N, far = Math.hypot(W, H) * 1.5;
    const box = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;`;
    const wedges = [];
    for (let i = 0; i < N; i++) {
      const pts = [[cx, cy]];
      for (let k = 0; k <= 4; k++) { const a = (i * B + k * B / 4) * Math.PI / 180; pts.push([cx + Math.cos(a) * far, cy + Math.sin(a) * far]); }
      const wedge = document.createElement("div");
      wedge.style.cssText = box + `clip-path:polygon(${pts.map(p => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`).join(",")});`;
      const outer = document.createElement("div"), inner = document.createElement("div");
      outer.style.cssText = box; inner.style.cssText = box;
      const copy = mainCopy(snap, mr, bg);
      inner.appendChild(copy); outer.appendChild(inner); wedge.appendChild(outer); host.appendChild(wedge);
      copy.scrollTop = main.scrollTop;
      // tranche paire : rotation ; impaire : miroir de la tranche 0
      wedges.push({ outer, inner, rot: i * B, sy: i % 2 ? -1 : 1, rot2: i % 2 ? -B : 0 });
    }
    const C = `translate(${cx.toFixed(1)}px,${cy.toFixed(1)}px)`, Cm = `translate(${(-cx).toFixed(1)}px,${(-cy).toFixed(1)}px)`;
    let said = 1;
    ctl.loop(t => {
      const m = t < 2 ? easeInOut(clamp((t - .5) / 1.5, 0, 1)) : t < 6.6 ? 1 : 1 - easeInOut(clamp((t - 6.6) / 1.2, 0, 1));
      const u = clamp((t - 2) / 4.6, 0, 1);
      const alpha = 360 * easeInOut(u), sc = 1 + .35 * Math.sin(Math.PI * u);
      wedges.forEach(w => {
        w.outer.style.transform = `${C} rotate(${(w.rot * m).toFixed(2)}deg) scale(1,${lerp(1, w.sy, m).toFixed(4)}) rotate(${(w.rot2 * m).toFixed(2)}deg) ${Cm}`;
        w.inner.style.transform = `${C} rotate(${alpha.toFixed(2)}deg) scale(${sc.toFixed(4)}) ${Cm}`;
      });
      if (said === 1 && t > 2) { said = 2; setMsg(2); }
      if (said === 2 && t >= 7.8) {
        said = 3;
        host.style.display = "none";
        setMsg(3);
      }
      if (t >= 8.4) { s.finish(); return false; }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const open = msg !== 3;
  return (
    <Layer s={s} css={KALEI_CSS}>
      <div ref={hostRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }}/>
      {geo && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: open ? 1 : 0, transition: "opacity .6s ease",
          animation: "pk-kit-fadein .8s ease backwards" }}>
          <div style={{ position: "absolute", inset: 0,
            background: `radial-gradient(circle at ${geo.cx}px ${geo.cy}px, transparent ${geo.R - 1}px, rgba(0,0,0,.92) ${geo.R + 4}px, #000 ${geo.R + 60}px)` }}/>
          <div style={{ position: "absolute", left: geo.cx - geo.R - 6, top: geo.cy - geo.R - 6, width: (geo.R + 6) * 2, height: (geo.R + 6) * 2,
            borderRadius: "50%", border: "6px solid #b08d57", boxShadow: "0 0 0 2px #5c4320, inset 0 0 30px rgba(0,0,0,.55), inset 0 0 0 2px rgba(255,236,190,.35)" }}/>
          {msg === 2 && Array.from({ length: 6 }, (_, i) => (
            <div key={i} style={{ position: "absolute", left: geo.cx, top: geo.cy - 1, width: geo.R, height: 2, transformOrigin: "0 50%",
              transform: `rotate(${i * 60}deg)`, background: "linear-gradient(90deg, rgba(255,255,255,.55), rgba(255,255,255,.08))",
              animation: `pk-kaleidoscope-glint 1.6s ease-in-out ${(i * .2).toFixed(1)}s infinite` }}/>
          ))}
        </div>
      )}
      {msg === 1 && <Pill key="a">🔮 Regarde dans le tube… ton atelier en six exemplaires.</Pill>}
      {msg === 2 && <Pill key="b">Tourne, tourne la bague… que de jolies bobines !</Pill>}
      {msg === 3 && <Pill key="c" fade>Retour à un seul atelier. C'était déjà bien assez.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 20. Vagues de texte
// ════════════════════════════════════════════════════════════════════════════
const VAGUES_CSS = (() => {
  let k = "@keyframes pk-vagues-texte-w {";
  for (let i = 0; i <= 40; i++) {
    const p = i / 40, env = Math.min(1, p * 6) * Math.pow(1 - p, 1.3);
    const y = -Math.sin(2 * Math.PI * 3 * p) * env, r = 10 * Math.cos(2 * Math.PI * 3 * p) * env;
    k += ` ${(p * 100).toFixed(1)}% { transform: translateY(calc(var(--a) * ${y.toFixed(3)})) rotate(${r.toFixed(2)}deg) scale(${(1 + .18 * Math.max(0, -y)).toFixed(3)}) }`;
  }
  return k + ` }
@keyframes pk-vagues-texte-surf { from { transform: translateX(-80px) } to { transform: translateX(calc(100vw + 40px)) } }
@keyframes pk-vagues-texte-ride { 0%, 100% { transform: translateY(0) rotate(-8deg) } 50% { transform: translateY(-16px) rotate(6deg) } }`;
})();
function VaguesTexte({ done }) {
  const s = useStage2(done);
  const hostRef = useRef(null);
  const [msg, setMsg] = useState(1);
  useEffect(() => {
    const { ctl } = s;
    const host = hostRef.current;
    const L = buildLetters(ctl, host, 1800);
    if (!L.list.length) { ctl.after(3000, () => { setMsg(2); s.finish(); }); return; }
    L.hide();
    const W = vw(), H = vh(), DUR = 4.2;
    let end = 0;
    L.list.forEach(l => {
      const dl = .3 + l.cx / W * 1.4 + l.cy / H * .35;
      end = Math.max(end, dl + DUR);
      l.el.style.setProperty("--a", `${(l.h * .9).toFixed(1)}px`);
      l.el.style.transformOrigin = "50% 70%";
      l.el.style.animation = `pk-vagues-texte-w ${DUR}s ease-in-out ${dl.toFixed(3)}s both`;
    });
    ctl.after(end * 1000 + 120, () => {
      L.show();
      if (host) host.style.visibility = "hidden";
      setMsg(2); s.finish();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={VAGUES_CSS}>
      <div ref={hostRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}/>
      {msg === 1 && (
        <div aria-hidden="true" style={{ position: "absolute", left: 0, top: "46%", animation: "pk-vagues-texte-surf 2.2s cubic-bezier(.4,0,.6,1) .3s both" }}>
          <div style={{ fontSize: 40, animation: "pk-vagues-texte-ride .6s ease-in-out infinite" }}>🏄</div>
        </div>
      )}
      {msg === 1 && <Pill key="a">🌊 Houle sur tes textes : les lettres font la ola.</Pill>}
      {msg === 2 && <Pill key="b" fade>Mer d'huile. Les lettres ont le pied marin.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 21. Projecteur
// ════════════════════════════════════════════════════════════════════════════
const PROJ_CSS = `
@keyframes pk-projecteur-l { from { transform: translateX(-102%) } to { transform: translateX(0) } }
@keyframes pk-projecteur-r { from { transform: translateX(102%) } to { transform: translateX(0) } }
@keyframes pk-projecteur-top { from { transform: translateY(-110%) } to { transform: translateY(0) } }
@keyframes pk-projecteur-sway { 0%, 100% { transform: skewX(0deg) } 50% { transform: skewX(1.4deg) } }
@keyframes pk-projecteur-clap { 0% { transform: translate(0, 0) scale(.6); opacity: 0 } 15% { opacity: 1 } 100% { transform: translate(var(--dx), -55vh) scale(1.2); opacity: 0 } }
@keyframes pk-projecteur-rose { 0% { transform: translate(0, 0) rotate(0deg); opacity: 0 } 10% { opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--r)); opacity: 1 } }
@keyframes pk-projecteur-wiggle { 0%, 100% { transform: rotate(-12deg) scale(1) } 50% { transform: rotate(12deg) scale(1.15) } }
`;
const DRAPE = "repeating-linear-gradient(90deg, #6b1111 0, #a81b1b 12px, #d42a2a 21px, #a81b1b 31px, #6b1111 42px)";
function Projecteur({ done }) {
  const s = useStage2(done);
  const [phase, setPhase] = useState("show"); // show, bravo, fin
  const darkRef = useRef(null), beamRef = useRef(null), spotRef = useRef(null);
  const geo = useMemo(() => { const W = vw(), H = vh(); return { W, H, R0: clamp(Math.min(W, H) * .2, 70, 150), diag: Math.hypot(W, H) }; }, []);
  const claps = useMemo(() => Array.from({ length: 22 }, () => ({ x: rand(4, 92), dx: rand(-40, 40), dl: rand(0, 1.8), d: rand(1.6, 2.4), e: Math.random() < .2 ? "🙌" : "👏" })), []);
  const roses = useMemo(() => Array.from({ length: 6 }, () => ({ x: rand(15, 80), dx: rand(-60, 60), dy: -rand(.25, .5) * geo.H, r: `${rand(-200, 200).toFixed(0)}deg`, dl: rand(.2, 1.2) })), [geo]);
  useEffect(() => {
    const { ctl } = s;
    const { W, H, R0, diag } = geo;
    const cards = withRects(tilesOf(ctl, 12)).filter(o => o.r.bottom > 60 && o.r.top < H - 80).sort(byReading);
    const pts = [[W * .12, H * .3], ...cards.slice(0, 5).map(o => [o.r.left + o.r.width / 2, clamp(o.r.top + o.r.height / 2, 80, H - 120)]), [W / 2, H * .45]];
    if (pts.length < 4) pts.splice(1, 0, [W * .8, H * .3], [W * .3, H * .6]);
    let ph = "show";
    ctl.loop(t => {
      const u = easeInOut(clamp((t - .9) / 4, 0, 1));
      const [x, y] = catmull(pts, u);
      const grow = easeInOut(clamp((t - 4.9) / .8, 0, 1));
      const R = lerp(R0, diag, grow);
      const dark = (t < .9 ? clamp(t / .6, 0, 1) : 1) * (1 - easeInOut(clamp((t - 5.2) / .7, 0, 1)));
      if (darkRef.current) {
        darkRef.current.style.background = `radial-gradient(circle at ${x.toFixed(0)}px ${y.toFixed(0)}px, rgba(0,0,0,0) ${(R * .72).toFixed(0)}px, rgba(0,0,0,.6) ${R.toFixed(0)}px, rgba(0,0,0,.92) ${(R * 1.35).toFixed(0)}px)`;
        darkRef.current.style.opacity = dark.toFixed(3);
      }
      if (spotRef.current) {
        spotRef.current.style.transform = `translate(${(x - R).toFixed(1)}px,${(y - R).toFixed(1)}px)`;
        spotRef.current.style.width = spotRef.current.style.height = (2 * R).toFixed(0) + "px";
        spotRef.current.style.opacity = (dark * .9).toFixed(3);
      }
      if (beamRef.current) {
        beamRef.current.setAttribute("points", `${(W / 2 - 8).toFixed(0)},-10 ${(W / 2 + 8).toFixed(0)},-10 ${(x + R * .8).toFixed(0)},${y.toFixed(0)} ${(x - R * .8).toFixed(0)},${y.toFixed(0)}`);
        beamRef.current.style.opacity = (dark * (1 - grow)).toFixed(3);
      }
      if (ph === "show" && t >= 5.3) {
        ph = "bravo"; setPhase("bravo");
        cards.forEach(({ c }, i) => {
          ctl.set(c, { "transform-origin": "50% 100%" });
          ctl.anim(c, [{ transform: "perspective(800px) rotateX(0deg) translateY(0)" },
            { transform: "perspective(800px) rotateX(-32deg) translateY(4px)", offset: .35 },
            { transform: "perspective(800px) rotateX(-32deg) translateY(4px)", offset: .6 },
            { transform: "perspective(800px) rotateX(0deg) translateY(0)" }], { duration: 1300, delay: i * 90, easing: "ease-in-out" });
        });
      }
      if (ph === "bravo" && t >= 7.4) { ph = "fin"; setPhase("fin"); }
      if (t >= 8.4) { s.finish(); return false; }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fin = phase === "fin";
  const side = "max(48px, min(20vw, 190px))";
  const fringe = "repeating-linear-gradient(90deg, #fbbf24 0 3px, #b45309 3px 6px)";
  return (
    <Layer s={s} css={PROJ_CSS}>
      <div ref={darkRef} style={{ position: "absolute", inset: 0, opacity: 0 }}/>
      <div ref={spotRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, borderRadius: "50%", opacity: 0, mixBlendMode: "screen",
        background: "radial-gradient(circle, rgba(255,240,200,.22), rgba(255,220,150,.08) 60%, transparent 72%)" }}/>
      <svg width="100%" height="100%" aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="pk-projecteur-beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff7e0" stopOpacity=".28"/><stop offset="1" stopColor="#fff7e0" stopOpacity=".05"/>
          </linearGradient>
        </defs>
        <polygon ref={beamRef} points="0,0 0,0 0,0" fill="url(#pk-projecteur-beam)" style={{ opacity: 0 }}/>
      </svg>
      {[0, 1].map(k => (
        <div key={k} aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, [k ? "right" : "left"]: 0, width: side,
          animation: fin ? `pk-projecteur-${k ? "r" : "l"} .9s ease-in reverse both` : `pk-projecteur-${k ? "r" : "l"} .9s cubic-bezier(.2,.9,.3,1) .3s both` }}>
          <div style={{ position: "absolute", inset: 0, background: DRAPE, transformOrigin: "50% 0",
            boxShadow: `inset ${k ? 14 : -14}px 0 24px rgba(0,0,0,.5), 0 0 30px rgba(0,0,0,.5)`,
            borderRadius: k ? "0 0 0 40% / 0 0 0 6%" : "0 0 40% 0 / 0 0 6% 0", animation: "pk-projecteur-sway 3s ease-in-out infinite" }}/>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 10, background: fringe }}/>
        </div>
      ))}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 58,
        animation: fin ? "pk-projecteur-top .8s ease-in .2s reverse both" : "pk-projecteur-top .8s cubic-bezier(.2,.9,.3,1) both" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 30, background: DRAPE, boxShadow: "0 4px 10px rgba(0,0,0,.4)" }}/>
        <div style={{ position: "absolute", left: 0, right: 0, top: 30, height: 24,
          background: "radial-gradient(circle at 50% 0, #b91c1c 0 68%, transparent 70%) 0 0 / 56px 24px repeat-x" }}/>
        <div style={{ position: "absolute", left: 0, right: 0, top: 28, height: 4, background: fringe }}/>
      </div>
      {phase !== "show" && claps.map((c, i) => (
        <span key={i} aria-hidden="true" style={{ position: "absolute", left: `${c.x}%`, bottom: 40, fontSize: 30, "--dx": `${c.dx}px`,
          animation: `pk-projecteur-clap ${c.d.toFixed(2)}s ease-out ${c.dl.toFixed(2)}s both` }}>
          <span style={{ display: "inline-block", animation: "pk-projecteur-wiggle .25s ease-in-out infinite" }}>{c.e}</span>
        </span>
      ))}
      {phase !== "show" && roses.map((r, i) => (
        <span key={"r" + i} aria-hidden="true" style={{ position: "absolute", left: `${r.x}%`, bottom: 30, fontSize: 28, "--dx": `${r.dx}px`,
          "--dy": `${r.dy}px`, "--r": r.r, opacity: fin ? 0 : 1, transition: "opacity .8s ease",
          animation: `pk-projecteur-rose 1s cubic-bezier(.2,.8,.4,1) ${r.dl.toFixed(2)}s both` }}>🌹</span>
      ))}
      {phase === "show" && <Pill key="a">🎭 Mesdames et messieurs… l'accueil de BambuNymous !</Pill>}
      {phase === "bravo" && <Pill key="b">👏 Saluez, les cartes ! Bravo, bravo !</Pill>}
      {phase === "fin" && <Pill key="c" fade>Rideau ! Merci, vous êtes un public formidable.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 22. Bande dessinee
// ════════════════════════════════════════════════════════════════════════════
const BD_CSS = `
@keyframes pk-bande-dessinee-pow { 0% { transform: translate(-50%, -50%) scale(.1) rotate(var(--r0)); opacity: 0 }
  18% { transform: translate(-50%, -50%) scale(1.25) rotate(var(--r)); opacity: 1 } 30% { transform: translate(-50%, -50%) scale(1) rotate(var(--r)) }
  80% { opacity: 1 } 100% { transform: translate(-50%, -50%) scale(1.06) rotate(var(--r)); opacity: 0 } }
@keyframes pk-bande-dessinee-lines { 0% { transform: scale(.3); opacity: .9 } 100% { transform: scale(1.5); opacity: 0 } }
`;
const POWS = ["POW !", "ZBAM !", "BLAM !", "WIZZ !", "CLONK !", "SPLOTCH !", "VLAN !", "KRAAK !"];
const burst = () => {
  const n = 14, pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = i / (n * 2) * Math.PI * 2, r = i % 2 ? rand(30, 36) : rand(44, 50);
    pts.push(`${(50 + Math.cos(a) * r * 1.4).toFixed(1)},${(50 + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(" ");
};
function BandeDessinee({ done }) {
  const s = useStage2(done);
  const [msg, setMsg] = useState(1);
  const [pows, setPows] = useState([]);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh();
    const parts = ctl.parts();
    const cards = withRects(tilesOf(ctl, 16));
    parts.forEach(p => ctl.set(p, { filter: "contrast(1.25) saturate(1.7)" }));
    cards.forEach(({ c }, i) => {
      ctl.set(c, { outline: "3px solid #111", "outline-offset": "0px", "box-shadow": "6px 6px 0 #111" });
      ctl.anim(c, [{ transform: "scale(1.05) rotate(-.6deg)" }, { transform: "scale(1) rotate(0deg)" }], { duration: 350, delay: i * 50, easing: "cubic-bezier(.3,1.5,.5,1)" });
    });
    const vis = cards.filter(o => o.r.bottom > 90 && o.r.top < H - 120);
    const times = [700, 1500, 2300, 3100, 3900, 4700, 5500];
    const words = shuffle(POWS.slice());
    times.forEach((tm, i) => ctl.after(tm, () => {
      const o = vis.length ? vis[i % vis.length] : null;
      const x = o ? clamp(o.r.left + o.r.width * rand(.25, .75), 80, W - 80) : rand(.2, .8) * W;
      const y = o ? clamp(o.r.top + o.r.height * rand(.3, .7), 110, H - 160) : rand(.25, .65) * H;
      setPows(ps => [...ps.slice(-3), { id: i, x, y, w: words[i % words.length], pts: burst(), r: `${rand(-14, 14).toFixed(0)}deg`,
        r0: `${rand(-40, 40).toFixed(0)}deg`, c: pick(["#fde047", "#fb923c", "#f472b6", "#67e8f9"]) }]);
      if (o) ctl.anim(o.c, jitter(8, 8, 2), { duration: 360 });
    }));
    ctl.after(3100, () => setMsg(2));
    ctl.after(6700, () => {
      parts.forEach(p => ctl.unset(p, ["filter"]));
      cards.forEach(({ c }) => ctl.unset(c, ["outline", "outline-offset", "box-shadow"]));
      setMsg(3);
    });
    ctl.after(7400, s.finish);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const light = isLight();
  const dots = light ? "radial-gradient(circle, rgba(0,0,0,.2) 1.2px, transparent 1.9px) 0 0 / 7px 7px"
    : "radial-gradient(circle, rgba(255,255,255,.12) 1.2px, transparent 1.9px) 0 0 / 7px 7px";
  const on = msg !== 3;
  return (
    <Layer s={s} css={BD_CSS}>
      <div style={{ position: "absolute", inset: 0, opacity: on ? 1 : 0, transition: "opacity .6s ease", animation: "pk-kit-fadein .4s ease backwards",
        background: `${dots}, radial-gradient(circle, rgba(236,72,153,.14) 1.4px, transparent 2px) 3px 3px / 9px 9px`,
        boxShadow: "inset 0 0 0 7px #111, inset 0 0 0 10px #fff, inset 0 0 0 13px #111" }}/>
      {pows.map(p => (
        <div key={p.id} aria-hidden="true" style={{ position: "absolute", left: p.x, top: p.y, width: 170, height: 124, "--r": p.r, "--r0": p.r0,
          animation: "pk-bande-dessinee-pow 1.5s cubic-bezier(.2,1.2,.4,1) both" }}>
          <div style={{ position: "absolute", left: "-30%", top: "-40%", width: "160%", height: "180%", borderRadius: "50%",
            background: "repeating-conic-gradient(#111 0 1.5deg, transparent 1.5deg 12deg)",
            WebkitMaskImage: "radial-gradient(ellipse, transparent 38%, #000 42%, transparent 70%)",
            maskImage: "radial-gradient(ellipse, transparent 38%, #000 42%, transparent 70%)", animation: "pk-bande-dessinee-lines .6s ease-out both" }}/>
          <svg width="170" height="124" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <polygon points={p.pts} fill={p.c} stroke="#111" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: '"Bangers", Impact, "Arial Black", sans-serif', fontWeight: 900, fontStyle: "italic", fontSize: 30, letterSpacing: 1,
            color: "#ef4444", WebkitTextStroke: "1.5px #111", textShadow: "3px 3px 0 #111", whiteSpace: "nowrap" }}>{p.w}</div>
        </div>
      ))}
      {msg === 1 && <Pill key="a">💥 Édition spéciale : ton accueil passe en bande dessinée !</Pill>}
      {msg === 2 && <Pill key="b">Mais que fait le support technique ?!</Pill>}
      {msg === 3 && <Pill key="c" fade>Fin de l'épisode. La suite au prochain numéro…</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 23. Pluie de code
// ════════════════════════════════════════════════════════════════════════════
const GLYPHS = "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン{}<>;=+*/#$GXYZEFM";
const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace';
function PluieDeCode({ done }) {
  const s = useStage2(done);
  const cvRef = useRef(null), hostRef = useRef(null);
  const [msg, setMsg] = useState(1);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh();
    const host = hostRef.current;
    const L = buildLetters(ctl, host, 1600);
    if (L.list.length) L.hide();
    const items = L.list.map(l => ({ l, a: .7 + l.cy / H * 1.6 + rand(0, .4), b: 4.3 + l.cy / H * 1.4 + rand(0, .4), st: 0, next: 0 }));
    // pluie (canevas)
    const cv = cvRef.current;
    const k = Math.min(2, window.devicePixelRatio || 1);
    const fs = isNarrow() ? 14 : 16;
    let g = null;
    const cols = [];
    if (cv) {
      cv.width = Math.round(W * k); cv.height = Math.round(H * k);
      g = cv.getContext("2d");
      g.scale(k, k);
      g.font = `${fs}px ${MONO}`;
      g.textBaseline = "top";
      for (let x = 0; x < W; x += fs) {
        const len = Math.round(rand(8, 22));
        cols.push({ x, y: rand(-H / fs, 0), v: rand(9, 22), len, gl: Array.from({ length: len + 1 }, glyph) });
      }
    }
    let said = 1;
    ctl.loop((t, dt) => {
      // intensite : monte, tient, retombe
      const I = clamp(t / .8, 0, 1) * (1 - clamp((t - 6) / .9, 0, 1));
      if (g) {
        g.clearRect(0, 0, W, H);
        cols.forEach(c => {
          c.y += c.v * dt;
          if ((c.y - c.len) * fs > H) { c.y = rand(-8, 0); c.v = rand(9, 22); }
          if (Math.random() < .08) c.gl[Math.floor(Math.random() * c.gl.length)] = glyph();
          for (let j = 0; j <= c.len; j++) {
            const yy = (Math.floor(c.y) - j) * fs;
            if (yy < -fs || yy > H) continue;
            const a = (1 - j / c.len) * I;
            g.fillStyle = j === 0 ? `rgba(220,255,230,${a.toFixed(3)})` : `rgba(34,197,94,${(a * .85).toFixed(3)})`;
            g.fillText(c.gl[j], c.x, yy);
          }
        });
        cv.style.opacity = "1";
      }
      let budget = 260;
      items.forEach(it => {
        const e = it.l.el;
        if (it.st === 0 && t >= it.a && t < it.b) {
          it.st = 1;
          e.style.color = "#4ade80"; e.style.textShadow = "0 0 6px rgba(34,197,94,.9)"; e.style.fontFamily = MONO;
          e.textContent = glyph(); it.next = t + rand(.08, .2);
        } else if (it.st === 1 && t >= it.b) {
          it.st = 2;
          e.textContent = it.l.ch; e.style.color = "#ecfdf5"; e.style.fontFamily = it.l.ff; it.next = t + .18;
        } else if (it.st === 1 && t >= it.next && budget > 0) {
          budget--; e.textContent = glyph(); it.next = t + rand(.08, .2);
        } else if (it.st === 2 && t >= it.next) {
          it.st = 3; e.style.color = it.l.color; e.style.textShadow = "";
        }
      });
      if (said === 1 && t > 3) { said = 2; setMsg(2); }
      if (said === 2 && t >= 7) {
        said = 3;
        items.forEach(it => { const e = it.l.el; e.textContent = it.l.ch; e.style.color = it.l.color; e.style.textShadow = ""; e.style.fontFamily = it.l.ff; });
        L.show();
        if (host) host.style.visibility = "hidden";
        if (cv) cv.style.opacity = "0";
        setMsg(3); s.finish();
        return false;
      }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const on = msg !== 3;
  return (
    <Layer s={s}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,10,4,.72)", opacity: on ? 1 : 0, transition: "opacity .9s ease",
        animation: "pk-kit-fadein .8s ease backwards" }}/>
      <canvas ref={cvRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0 }}/>
      <div ref={hostRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}/>
      {msg === 1 && <Pill key="a" style={{ fontFamily: MONO }}>💻 Réveille-toi, maker… le G-code a pris le contrôle.</Pill>}
      {msg === 2 && <Pill key="b" style={{ fontFamily: MONO }}>Recompilation de l'accueil en cours…</Pill>}
      {msg === 3 && <Pill key="c" fade>Compilation terminée : 0 erreur, 0 spaghetti.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Export
// ════════════════════════════════════════════════════════════════════════════
export const PRANKS = {
  "eclipse": { label: "Éclipse", Effect: Eclipse },
  "arc-en-ciel": { label: "Arc-en-ciel", Effect: softly(ArcEnCiel, { emoji: "🌈", text: "Une licorne est passée par là…", tint: tint("rgba(236,72,153,.25)") }) },
  "marees": { label: "Marées", Effect: softly(Marees, { emoji: "🌊", text: "Grande marée sur l'atelier (version calme).", tint: tint("rgba(14,165,233,.28)"), end: "Marée basse." }) },
  "meteores": { label: "Météores", Effect: softly(Meteores, { emoji: "☄️", text: "Une étoile filante est passée au-dessus de l'atelier.", tint: tint("rgba(30,41,82,.4)") }) },
  "hypnose": { label: "Hypnose", Effect: softly(Hypnose, { emoji: "🌀", text: "Tu as très envie d'imprimer… *clac*, réveillé !", tint: tint("rgba(124,58,237,.28)") }) },
  "telex": { label: "Télex", Effect: Telex },
  "aurore": { label: "Aurore boréale", Effect: Aurore },
  "chantier": { label: "Chantier", Effect: Chantier },
  "pellicule": { label: "Pellicule", Effect: Pellicule },
  "eboulement": { label: "Éboulement", Effect: softly(Eboulement, { emoji: "🧱", text: "Petit éboulement… déjà reconstruit.", tint: tint("rgba(180,160,130,.3)") }) },
  "bulldozer": { label: "Bulldozer", Effect: softly(Bulldozer, { emoji: "🚜", text: "Un bulldozer a fait le ménage. Tout est revenu.", tint: tint("rgba(250,204,21,.25)") }) },
  "ressort": { label: "Ressort", Effect: softly(Ressort, { emoji: "🪀", text: "Boing ! Suspension réglée.", tint: tint("rgba(167,139,250,.25)") }) },
  "neon": { label: "Néon", Effect: softly(Neon, { emoji: "🌃", text: "L'atelier s'est mis en enseigne néon.", tint: tint("rgba(255,43,214,.22)") }) },
  "origami": { label: "Origami", Effect: softly(Origami, { emoji: "✈️", text: "Un avion en papier a fait le tour de l'atelier.", tint: tint("rgba(226,232,240,.25)") }) },
  "zoom-avant": { label: "Zoom avant", Effect: softly(ZoomAvant, { emoji: "🔍", text: "Zoom × 8 sur la buse… et retour.", tint: tint("rgba(139,92,246,.25)") }) },
  "cubisme": { label: "Cubisme", Effect: softly(Cubisme, { emoji: "🎨", text: "Picasso est passé par le slicer.", tint: tint("rgba(194,65,12,.22)") }) },
  "briques": { label: "Briques", Effect: softly(Briques, { emoji: "🧱", text: "Tes cartes ont joué aux briques.", tint: tint("rgba(239,68,68,.22)") }) },
  "pluie-filament": { label: "Pluie de filament", Effect: softly(PluieFilament, { emoji: "🌧️", text: "Petite averse de filament multicolore.", tint: tint("rgba(236,72,153,.22)") }) },
  "kaleidoscope": { label: "Kaléidoscope", Effect: softly(Kaleidoscope, { emoji: "🔮", text: "Ton atelier en six exemplaires, le temps d'un clin d'œil.", tint: tint("rgba(168,85,247,.25)") }) },
  "vagues-texte": { label: "Vagues de texte", Effect: softly(VaguesTexte, { emoji: "🏄", text: "Les lettres ont fait la ola.", tint: tint("rgba(14,165,233,.22)") }) },
  "projecteur": { label: "Projecteur", Effect: softly(Projecteur, { emoji: "🎭", text: "Bravo ! L'accueil salue son public.", tint: tint("rgba(185,28,28,.25)") }) },
  "bande-dessinee": { label: "Bande dessinée", Effect: softly(BandeDessinee, { emoji: "💥", text: "POW ! Ton accueil en BD, l'espace d'un instant.", tint: tint("rgba(253,224,71,.25)") }) },
  "pluie-de-code": { label: "Pluie de code", Effect: softly(PluieDeCode, { emoji: "💻", text: "Le G-code a pris le contrôle… puis l'a rendu.", tint: tint("rgba(34,197,94,.25)") }) },
};
