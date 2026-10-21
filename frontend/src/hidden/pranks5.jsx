import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStage, Layer, Pill, GiveUp, softly, Soft, prefersReduced, rand, pick, tint, FONT, FILAMENTS } from "./pranks";

// Farces, cinquieme lot : les catastrophes (meteorite, dragon, incendie…).
// Meme contrat que pranks.jsx : PRANKS[slug] = { label, Effect } ; Effect recoit
// `done`, appele une seule fois quand la farce est terminee. La page est detruite
// « pour de faux » : tout ce qui touche au DOM de l'appli passe par le controleur
// `ctl` de useStage (styles inline, animations, minuteries, ecouteurs), remis
// exactement en etat a la fin ou au demontage, meme en cours de route.
// Deux farces acceptent un geste facultatif (incendie, sables-mouvants) : sans
// geste, elles se terminent seules.

// Gardes pour les outils importes que ce lot n'utilise pas directement
void GiveUp; void Soft; void prefersReduced; void FONT; void FILAMENTS;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const vw = () => window.innerWidth;
const vh = () => window.innerHeight;
const isNarrow = () => window.innerWidth < 768;
const floorY = () => vh() - (isNarrow() ? 86 : 14);
const isLight = () => document.documentElement.getAttribute("data-theme") === "light";
const f1 = v => v.toFixed(1);
const shuffle = arr => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
};

// Releve les morceaux de la page avec leur boite de depart. `dsc()` donne le
// defilement de la page depuis le releve (a retirer des positions d'ecran).
function grab(ctl, max) {
  const main = ctl.main();
  const sc0 = main ? main.scrollTop : 0;
  const tiles = ctl.tiles(30);
  const list = ctl.cards(max).map(c => {
    const r = c.getBoundingClientRect();
    return { c, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top,
      tile: tiles.find(t => t === c || t.contains(c)) || null };
  });
  return { list, tiles, dsc: () => (main ? main.scrollTop - sc0 : 0), sc0 };
}

// Tremblement qui part de zero et y revient (images cles pour ctl.anim).
function jitterKf(amp, n, rot = 0) {
  const kf = [];
  for (let i = 0; i <= n; i++) {
    const env = Math.sin(Math.PI * i / n);
    const a = amp * env;
    kf.push({ transform: i === 0 || i === n ? "translate(0px,0px) rotate(0deg)"
      : `translate(${f1(rand(-a, a))}px,${f1(rand(-a * 0.6, a * 0.6))}px) rotate(${(rand(-rot, rot) * env).toFixed(2)}deg)` });
  }
  return kf;
}

// Particules (eclats, fumee, gouttes, textes) : rendues dans le calque, chacune
// retiree apres sa duree de vie par une minuterie du controleur.
function useFx(ctl) {
  const [fx, setFx] = useState([]);
  const idRef = useRef(0);
  const add = useCallback((items, life) => {
    if (ctl.dead || !items.length) return;
    const arr = items.map(o => ({ ...o, id: ++idRef.current }));
    setFx(f => f.concat(arr).slice(-320));
    const ids = new Set(arr.map(a => a.id));
    ctl.after(life || 2600, () => setFx(f => f.filter(p => !ids.has(p.id))));
  }, [ctl]);
  return [fx, add];
}
const FX_CSS = slug => `
@keyframes pk-${slug}-fly { 0% { transform: translate(-50%,-50%) scale(1) rotate(0deg); opacity: 1 }
  80% { opacity: .9 } 100% { transform: translate(-50%,-50%) translate(var(--dx), var(--dy)) scale(var(--s)) rotate(var(--r)); opacity: 0 } }
@keyframes pk-${slug}-smoke { 0% { transform: translate(-50%,-50%) scale(.4); opacity: 0 } 15% { opacity: var(--o) }
  100% { transform: translate(-50%,-50%) translate(var(--dx), var(--dy)) scale(2.4); opacity: 0 } }
@keyframes pk-${slug}-drop { 0% { transform: translate(-50%,-50%) scale(.6); opacity: 0 } 10% { transform: translate(-50%,-50%) scale(1); opacity: 1 }
  85% { opacity: 1 } 100% { transform: translate(-50%,-50%) translate(var(--dx), var(--dy)) scale(.8,1.2); opacity: 0 } }
@keyframes pk-${slug}-pop { 0% { transform: translate(-50%,-50%) scale(.3) rotate(var(--r)); opacity: 0 } 25% { transform: translate(-50%,-50%) scale(1.15) rotate(var(--r)); opacity: 1 }
  70% { transform: translate(-50%,-50%) translateY(-14px) scale(1) rotate(var(--r)); opacity: 1 } 100% { transform: translate(-50%,-50%) translateY(-34px) scale(.9) rotate(var(--r)); opacity: 0 } }
@keyframes pk-${slug}-blob { 0% { transform: translate(-50%,-50%) scale(.2); opacity: 0 } 20% { transform: translate(-50%,-50%) scale(1.1); opacity: 1 }
  70% { transform: translate(-50%,-50%) scale(1); opacity: .95 } 100% { transform: translate(-50%,-50%) scale(1.25); opacity: 0 } }
`;
function Fx({ fx, slug }) {
  return fx.map(p => (
    <span key={p.id} aria-hidden="true" style={{ position: "absolute", left: p.x, top: p.y,
      width: p.text ? "auto" : p.size, height: p.text ? "auto" : (p.h || p.size),
      borderRadius: p.round === false ? 2 : "50%", background: p.text ? "none" : p.bg,
      boxShadow: p.glow || "none", filter: p.blur ? `blur(${p.blur}px)` : "none",
      color: p.color || "#fff", fontSize: p.fs || 18, fontWeight: 900, whiteSpace: "nowrap", lineHeight: 1,
      textShadow: p.text ? "0 2px 0 rgba(0,0,0,.4), 0 0 10px rgba(0,0,0,.3)" : "none",
      "--dx": `${p.dx || 0}px`, "--dy": `${p.dy || 0}px`, "--s": p.s == null ? 0.4 : p.s, "--r": `${p.r || 0}deg`,
      "--o": p.o == null ? 0.7 : p.o,
      animation: `pk-${slug}-${p.kind || "fly"} ${p.dur || 1}s ${p.ease || "ease-out"} ${p.delay || 0}s both`,
      pointerEvents: "none" }}>{p.text || null}</span>
  ));
}

// Conteneur qui suit le defilement de la page : ce qu'on y pose en coordonnees
// « document » (top + scrollTop) reste colle aux elements.
function usePin(ctl) {
  const ref = useRef(null);
  useEffect(() => {
    const main = ctl.main();
    if (!main) return;
    const upd = () => { if (ref.current) ref.current.style.transform = `translateY(${-main.scrollTop}px)`; };
    upd();
    ctl.on(main, "scroll", upd, { passive: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}
const pinStyle = { position: "absolute", left: 0, top: 0, width: "100%", height: 0, overflow: "visible" };

// ════════════════════════════════════════════════════════════════════════════
// 1. Meteorite
// ════════════════════════════════════════════════════════════════════════════
const METEORITE_CSS = FX_CSS("meteorite") + `
@keyframes pk-meteorite-ring { from { transform: translate(-50%,-50%) scale(.04); opacity: .95 } to { transform: translate(-50%,-50%) scale(1); opacity: 0 } }
@keyframes pk-meteorite-flash { 0% { opacity: 0 } 6% { opacity: .92 } 100% { opacity: 0 } }
@keyframes pk-meteorite-glow { 0%, 100% { opacity: .55 } 50% { opacity: .95 } }
@keyframes pk-meteorite-tail { 0%, 100% { transform: scaleX(1) } 50% { transform: scaleX(1.14) } }
@keyframes pk-meteorite-out { to { opacity: 0 } }
`;
function Meteorite({ done }) {
  const s = useStage(done);
  const rock = useRef(null);
  const [ph, setPh] = useState(0); // 0 approche, 1 impact, 2 retombee, 3 fin
  const [fx, addFx] = useFx(s.ctl);
  const geo = useMemo(() => ({ x: vw() * 0.5, y: vh() * (isNarrow() ? 0.42 : 0.48), big: Math.max(vw(), vh()) * 2.2,
    sz: isNarrow() ? 0.75 : 1 }), []);
  useEffect(() => {
    const { ctl } = s;
    const { list } = grab(ctl, 120);
    const parts = ctl.parts();
    const W = vw(), ix = geo.x, iy = geo.y;
    const sx = W + 180, sy = -220;
    const ang = Math.atan2(iy - sy, ix - sx) * 180 / Math.PI;
    if (rock.current) {
      ctl.anim(rock.current, [
        { transform: `translate(${sx}px,${sy}px) rotate(${f1(ang)}deg) scale(.45)` },
        { transform: `translate(${ix}px,${iy}px) rotate(${f1(ang)}deg) scale(${geo.sz})` }],
      { duration: 1600, easing: "cubic-bezier(.55,0,.95,.55)", fill: "forwards" });
    }
    // le sol gronde a l'approche
    parts.forEach(p => ctl.anim(p, jitterKf(3, 24), { duration: 1600, easing: "linear" }));
    const offs = list.map(o => {
      const dx = o.x - ix, dy = o.y - iy, d = Math.hypot(dx, dy) || 1;
      const push = clamp(30000 / (d + 90), 50, 330);
      return { o, d, tx: dx / d * push + rand(-25, 25), ty: dy / d * push - rand(30, 110), r: rand(-55, 55) };
    });
    const T = f => `translate(${f1(f.tx)}px,${f1(f.ty)}px) rotate(${f1(f.r)}deg)`;
    ctl.after(1600, () => {
      setPh(1);
      parts.forEach(p => ctl.anim(p, jitterKf(20, 40, 1.2), { duration: 1300, easing: "linear" }));
      offs.forEach(f => ctl.anim(f.o.c, [{ transform: "none" }, { transform: T(f) }],
        { duration: 700, delay: f.d * 0.8, easing: "cubic-bezier(.12,.9,.3,1)", fill: "forwards" }));
      const deb = [];
      for (let i = 0; i < 34; i++) {
        const a = rand(-Math.PI, 0.25), d = rand(90, 340);
        deb.push({ x: ix, y: iy, size: rand(6, 16), round: Math.random() < 0.5, bg: pick(["#57534e", "#78716c", "#44403c", "#f97316", "#fbbf24"]),
          dx: Math.cos(a) * d, dy: Math.sin(a) * d + rand(40, 160), r: rand(-400, 400), s: 0.6, dur: rand(0.9, 1.5), ease: "cubic-bezier(.2,.7,.5,1)" });
      }
      addFx(deb, 1800);
      let n = 0;
      const puff = () => {
        if (n++ > 22) return;
        addFx([{ x: ix + rand(-50, 50) * geo.sz, y: iy + rand(-6, 10), size: rand(34, 60), kind: "smoke", blur: 6, o: 0.65,
          bg: "radial-gradient(circle, rgba(120,113,108,.9), rgba(87,83,78,0) 70%)", dx: rand(-40, 40), dy: rand(-150, -90), dur: 2.4 }], 2600);
        ctl.after(260, puff);
      };
      puff();
    });
    ctl.after(5900, () => {
      setPh(2);
      const fallback = offs.slice().sort((a, b) => b.d - a.d);
      fallback.forEach((f, i) => {
        const mid = `translate(${f1(f.tx * 0.35)}px,${f1(f.ty * 0.35 - 50)}px) rotate(${f1(f.r * 0.4)}deg)`;
        ctl.anim(f.o.c, [
          { transform: T(f), easing: "ease-out" },
          { transform: mid, offset: 0.4, easing: "ease-in" },
          { transform: "translate(0px,0px) rotate(0deg)", offset: 0.72, easing: "ease-out" },
          { transform: "translate(0px,-10px) rotate(0deg)", offset: 0.86, easing: "ease-in" },
          { transform: "translate(0px,0px) rotate(0deg)" }],
        { duration: 1250, delay: i * Math.min(18, 1500 / fallback.length), fill: "forwards" });
      });
    });
    ctl.after(9300, () => { setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cw = 230 * geo.sz, ch = 92 * geo.sz;
  return (
    <Layer s={s} css={METEORITE_CSS}>
      {ph >= 1 && (
        <div aria-hidden="true" style={{ position: "absolute", left: geo.x, top: geo.y, width: 0, height: 0,
          animation: ph >= 3 ? "pk-meteorite-out 1.2s ease both" : "none" }}>
          <div style={{ position: "absolute", left: -cw / 2, top: -ch / 2, width: cw, height: ch, borderRadius: "50%",
            background: "radial-gradient(ellipse, #0c0a09 0 30%, #292524 46%, rgba(87,83,78,.85) 58%, rgba(120,113,108,.35) 66%, transparent 72%)" }}/>
          <div style={{ position: "absolute", left: -cw * 0.3, top: -ch * 0.25, width: cw * 0.6, height: ch * 0.5, borderRadius: "50%",
            background: "radial-gradient(ellipse, rgba(253,186,116,.95), rgba(239,68,68,.55) 45%, transparent 70%)",
            animation: "pk-meteorite-glow .9s ease-in-out infinite" }}/>
        </div>
      )}
      {ph === 0 && (
        <div ref={rock} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transform: "translate(-600px,-600px)" }}>
          <div style={{ position: "absolute", right: 14, top: -34, width: 300, height: 68, transformOrigin: "100% 50%",
            background: "linear-gradient(90deg, rgba(251,146,60,0), rgba(251,146,60,.55) 50%, rgba(253,224,71,.95))",
            clipPath: "polygon(0 44%, 100% 0, 100% 100%, 0 56%)", filter: "blur(3px)", animation: "pk-meteorite-tail .16s ease-in-out infinite" }}/>
          <div style={{ position: "absolute", left: -55, top: -55, width: 110, height: 110, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(253,224,71,.85), rgba(249,115,22,.45) 45%, transparent 70%)" }}/>
          <svg width="64" height="64" viewBox="0 0 64 64" style={{ position: "absolute", left: -32, top: -32 }}>
            <defs>
              <radialGradient id="pk-meteorite-rk" cx=".35" cy=".35" r=".75">
                <stop offset="0" stopColor="#a8a29e"/><stop offset=".6" stopColor="#57534e"/><stop offset="1" stopColor="#292524"/>
              </radialGradient>
            </defs>
            <path d="M32 4 C48 5 60 16 59 33 C58 49 46 60 30 59 C14 58 4 46 5 30 C6 15 18 3 32 4 Z" fill="url(#pk-meteorite-rk)" stroke="#f97316" strokeWidth="2"/>
            <circle cx="24" cy="22" r="6" fill="#44403c"/><circle cx="40" cy="38" r="8" fill="#44403c"/><circle cx="20" cy="42" r="4" fill="#44403c"/>
          </svg>
        </div>
      )}
      {ph === 1 && (
        <>
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "#fff7ed", animation: "pk-meteorite-flash .8s ease-out both" }}/>
          {[0, 0.15, 0.32].map((d, i) => (
            <div key={i} aria-hidden="true" style={{ position: "absolute", left: geo.x, top: geo.y, width: geo.big, height: geo.big,
              borderRadius: "50%", border: `${8 - i * 2}px solid rgba(254,215,170,.85)`, boxShadow: "0 0 30px rgba(249,115,22,.5)",
              animation: `pk-meteorite-ring 1.1s cubic-bezier(.2,.7,.4,1) ${d}s both` }}/>
          ))}
        </>
      )}
      <Fx fx={fx} slug="meteorite"/>
      {ph === 0 && <Pill key="a">☄️ Objet céleste en approche… trajectoire calculée : ton accueil !</Pill>}
      {ph === 1 && <Pill key="b">💥 Impact ! Le plateau a pris un sacré coup.</Pill>}
      {ph === 2 && <Pill key="c">Tout retombe… couche par couche, comme il faut.</Pill>}
      {ph === 3 && <Pill key="d" fade>Rien de cassé. Le cratère sera rebouché au PETG.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Dragon cracheur de feu
// ════════════════════════════════════════════════════════════════════════════
const DRAGON_CSS = FX_CSS("dragon-feu") + `
@keyframes pk-dragon-feu-flap { 0%, 100% { transform: scaleY(1) } 50% { transform: scaleY(-.35) } }
@keyframes pk-dragon-feu-flick { 0%, 100% { transform: translateY(-50%) scaleY(1) } 33% { transform: translateY(-50%) scaleY(.82) } 66% { transform: translateY(-50%) scaleY(1.12) } }
@keyframes pk-dragon-feu-burn { 0%, 100% { transform: translate(-50%,-100%) scale(1, 1) } 50% { transform: translate(-50%,-100%) scale(.85, 1.2) } }
@keyframes pk-dragon-feu-in { from { transform: translate(-140px, 40px) rotate(-20deg) } to { transform: translate(0,0) rotate(-8deg) } }
@keyframes pk-dragon-feu-out { to { opacity: 0 } }
`;
function DragonSvg({ w }) {
  return (
    <svg width={w} height={w * 150 / 220} viewBox="0 0 220 150" aria-hidden="true" style={{ overflow: "visible" }}>
      <path d="M72 88 C46 96 24 72 8 84 L0 76 L4 94 C24 86 44 110 78 100 Z" fill="#15803d"/>
      <path d="M0 76 L-10 70 L-6 84 L4 94 Z" fill="#facc15"/>
      <g style={{ transformBox: "view-box", transformOrigin: "108px 72px", animation: "pk-dragon-feu-flap .42s ease-in-out infinite" }}>
        <path d="M104 72 L66 8 L86 26 L98 2 L112 28 L132 12 L128 70 Z" fill="#166534"/>
        <path d="M104 70 L74 18 L88 30 L100 10 L110 32 L126 22 L124 68 Z" fill="#4ade80" opacity=".55"/>
      </g>
      <ellipse cx="106" cy="90" rx="48" ry="30" fill="#16a34a"/>
      <ellipse cx="114" cy="100" rx="32" ry="15" fill="#fde68a"/>
      {[[70, 66], [86, 60], [102, 58]].map(([x, y], i) => <path key={i} d={`M${x} ${y} L${x + 6} ${y - 12} L${x + 12} ${y + 1} Z`} fill="#facc15"/>)}
      <ellipse cx="86" cy="118" rx="9" ry="7" fill="#15803d"/><ellipse cx="126" cy="118" rx="9" ry="7" fill="#15803d"/>
      <path d="M134 80 C146 62 156 50 170 46 L176 58 C164 62 156 72 148 88 Z" fill="#16a34a"/>
      <ellipse cx="182" cy="46" rx="24" ry="17" fill="#16a34a"/>
      <ellipse cx="202" cy="52" rx="15" ry="10" fill="#22c55e"/>
      <circle cx="210" cy="48" r="2" fill="#14532d"/>
      <path d="M170 32 L164 16 L176 28 Z M184 30 L184 12 L192 28 Z" fill="#facc15"/>
      <circle cx="182" cy="40" r="6.5" fill="#fff"/><circle cx="184" cy="40" r="3.4" fill="#111827"/><circle cx="185" cy="38.6" r="1.1" fill="#fff"/>
      <path d="M176 32 L190 34" stroke="#14532d" strokeWidth="2.4" strokeLinecap="round"/>
    </svg>
  );
}
function DragonFeu({ done }) {
  const s = useStage(done);
  const drag = useRef(null);
  const pin = usePin(s.ctl);
  const [ph, setPh] = useState(0); // 0 dragon, 1 pompiers, 2 fin
  const [burns, setBurns] = useState([]);
  const [fx, addFx] = useFx(s.ctl);
  const geo = useMemo(() => {
    const narrow = isNarrow();
    const dw = narrow ? 150 : 220, sc = dw / 220;
    const y0 = vh() * (narrow ? 0.1 : 0.12);
    const my = y0 + 54 * sc;
    const ang = (narrow ? 66 : 58) * Math.PI / 180;
    const L = (floorY() - my) / Math.sin(ang) + 30;
    return { dw, sc, y0, ang, L, mx: 212 * sc, my: 54 * sc };
  }, []);
  useEffect(() => {
    const { ctl } = s;
    const { list, dsc, sc0 } = grab(ctl, 120);
    const W = vw();
    const reach = Math.cos(geo.ang) * geo.L;
    const x0 = -(geo.dw + reach) - 30, x1 = W + 40;
    const DUR = 5.2;
    const hit = new Set();
    const order = [];
    let nb = 0;
    ctl.loop(t => {
      const u = clamp(t / DUR, 0, 1);
      const x = lerp(x0, x1, u), y = geo.y0 + Math.sin(t * 4) * 10;
      if (drag.current) drag.current.style.transform = `translate(${f1(x)}px,${f1(y - geo.y0)}px)`;
      const mx = x + geo.mx, my = y + geo.my;
      const ex = mx + Math.cos(geo.ang) * geo.L, ey = my + Math.sin(geo.ang) * geo.L;
      const sdx = ex - mx, sdy = ey - my, sl = sdx * sdx + sdy * sdy;
      const d = dsc();
      const fresh = [];
      list.forEach((o, i) => {
        if (hit.has(i)) return;
        const px = o.x, py = o.y - d;
        const k = clamp(((px - mx) * sdx + (py - my) * sdy) / sl, 0, 1);
        const qx = mx + sdx * k, qy = my + sdy * k;
        if (Math.hypot(px - qx, py - qy) > 30 + 26 * k + Math.min(o.w, o.h) * 0.3) return;
        hit.add(i); order.push(o); fresh.push(o);
        ctl.set(o.c, { transition: "filter .45s ease", filter: "sepia(1) saturate(2.4) brightness(.42) contrast(1.3)" });
        o.tw = `rotate(${f1(rand(-9, 9))}deg) skew(${f1(rand(-10, 10))}deg,${f1(rand(-4, 4))}deg) scale(.93,.86)`;
        ctl.anim(o.c, [{ transform: "none" }, { transform: o.tw }], { duration: 650, easing: "cubic-bezier(.3,1.7,.5,1)", fill: "forwards" });
      });
      if (fresh.length) {
        const sm = [], nbs = [];
        fresh.forEach(o => {
          nb++;
          const cx = o.x, cy = o.y - d;
          if (nb % 3 === 0) sm.push({ x: cx, y: cy, size: rand(26, 44), kind: "smoke", blur: 5, o: 0.6,
            bg: "radial-gradient(circle, rgba(68,64,60,.85), rgba(68,64,60,0) 70%)", dx: rand(-30, 30), dy: rand(-120, -70), dur: 2.2 });
          if (nb % 4 === 1) nbs.push({ id: nb, i: list.indexOf(o), x: o.l + rand(0.2, 0.8) * o.w, y: o.t + sc0, h: o.h });
          if (nb % 2 === 0) sm.push({ x: cx + rand(-10, 10), y: cy, size: rand(4, 7), bg: pick(["#fbbf24", "#f97316", "#fde047"]),
            glow: "0 0 8px #f97316", dx: rand(-40, 40), dy: rand(-90, -30), dur: 1.1 });
        });
        if (sm.length) addFx(sm, 2400);
        if (nbs.length) setBurns(b => b.concat(nbs).slice(-36));
      }
      if (u >= 1) return false;
      return true;
    });
    ctl.after((DUR + 0.5) * 1000, () => {
      setPh(1);
      const nx = 46, ny = floorY() - 40;
      const todo = order.slice().sort((a, b) => Math.hypot(a.x - nx, a.y - ny) - Math.hypot(b.x - nx, b.y - ny));
      const steps = Math.ceil(todo.length / 4) || 1;
      const gap = Math.min(140, 3600 / steps);
      for (let k = 0; k < steps; k++) {
        ctl.after(300 + k * gap, () => {
          const batch = todo.slice(k * 4, k * 4 + 4);
          const d = dsc();
          const foam = [];
          batch.forEach(o => {
            const cx = o.x, cy = o.y - d;
            foam.push({ x: nx, y: ny, size: rand(12, 20), bg: "#f8fafc", glow: "0 0 6px rgba(255,255,255,.8)",
              dx: cx - nx, dy: cy - ny, s: 1.6, dur: 0.35, ease: "linear" });
            foam.push({ x: cx + rand(-8, 8), y: cy + rand(-6, 6), size: clamp(Math.min(o.w, o.h) * 0.9, 18, 70), kind: "blob", dur: 1.5, delay: 0.3,
              bg: "radial-gradient(circle at 35% 35%, #fff, #e2e8f0 70%)",
              glow: "14px 4px 0 -2px #f8fafc, -12px 6px 0 -3px #f1f5f9, 5px -10px 0 -4px #fff" });
            ctl.after(330, () => {
              ctl.unset(o.c, ["filter"]);
              ctl.anim(o.c, [{ transform: o.tw }, { transform: "none" }], { duration: 700, easing: "cubic-bezier(.3,1.5,.5,1)", fill: "forwards" });
            });
          });
          addFx(foam, 2200);
          const ids = new Set(batch.map(o => list.indexOf(o)));
          ctl.after(400, () => setBurns(b => b.filter(n => !ids.has(n.i))));
        });
      }
      ctl.after(300 + steps * gap + 600, () => setBurns([]));
    });
    ctl.after(10600, () => { setPh(2); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const flameW = geo.L, flameH = isNarrow() ? 70 : 96;
  return (
    <Layer s={s} css={DRAGON_CSS}>
      <div ref={pin} style={pinStyle}>
        {burns.map(b => (
          <div key={b.id} aria-hidden="true" style={{ position: "absolute", left: b.x, top: b.y + Math.min(b.h, 40) * 0.5, width: 22, height: 32,
            borderRadius: "50% 50% 50% 50% / 62% 62% 38% 38%",
            background: "radial-gradient(ellipse at 50% 80%, #fef9c3 0 18%, #fde047 30%, #f97316 58%, rgba(239,68,68,0) 72%)",
            transformOrigin: "50% 100%", animation: `pk-dragon-feu-burn ${(0.25 + (b.id % 5) * 0.035).toFixed(2)}s ease-in-out infinite`, filter: "blur(.5px)" }}/>
        ))}
      </div>
      {ph === 0 && (
        <div ref={drag} aria-hidden="true" style={{ position: "absolute", left: 0, top: geo.y0, width: geo.dw, transform: "translate(-900px,0)" }}>
          <div style={{ position: "absolute", left: geo.mx, top: geo.my, width: flameW, height: flameH, transformOrigin: "0 0",
            transform: `rotate(${f1(geo.ang * 180 / Math.PI)}deg)` }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", clipPath: "polygon(0 44%, 100% 0, 100% 100%, 0 56%)",
              background: "linear-gradient(90deg, #fffbeb, #fde047 10%, #fb923c 38%, #ef4444 68%, rgba(239,68,68,0))",
              filter: "blur(2px)", animation: "pk-dragon-feu-flick .12s linear infinite" }}/>
            <div style={{ position: "absolute", left: 0, top: "25%", width: "70%", height: "50%", clipPath: "polygon(0 46%, 100% 10%, 100% 90%, 0 54%)",
              background: "linear-gradient(90deg, #fff, #fef08a 30%, rgba(253,224,71,0))", filter: "blur(1.5px)",
              animation: "pk-dragon-feu-flick .09s linear infinite" }}/>
          </div>
          <DragonSvg w={geo.dw}/>
        </div>
      )}
      {ph === 1 && (
        <div aria-hidden="true" style={{ position: "absolute", left: 4, top: floorY() - 78, fontSize: 58, lineHeight: 1,
          transformOrigin: "50% 100%", animation: "pk-dragon-feu-in .5s cubic-bezier(.2,1.4,.4,1) both" }}>🧯</div>
      )}
      <Fx fx={fx} slug="dragon-feu"/>
      {ph === 0 && <Pill key="a">🐉 Un dragon a confondu ton accueil avec un plateau à préchauffer !</Pill>}
      {ph === 1 && <Pill key="b">🧯 Les pompiers de l'atelier arrivent, mousse à fond !</Pill>}
      {ph === 2 && <Pill key="c" fade>Feu éteint, tout est comme neuf. Ça sent juste un peu le PLA grillé.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Incendie (geste facultatif : frotter les flammes pour les eteindre)
// ════════════════════════════════════════════════════════════════════════════
const INCENDIE_CSS = FX_CSS("incendie") + `
@keyframes pk-incendie-plane { from { transform: translateX(var(--from)) translateY(0) } 50% { transform: translateX(calc(var(--from) * .45)) translateY(18px) }
  to { transform: translateX(-380px) translateY(-10px) } }
@keyframes pk-incendie-water { 0% { transform: translateY(-100%); opacity: 0 } 12% { opacity: .95 } 100% { transform: translateY(100%); opacity: .25 } }
@keyframes pk-incendie-in { from { opacity: 0 } to { opacity: 1 } }
`;
function CanadairSvg() {
  return (
    <svg width="210" height="78" viewBox="0 0 210 78" aria-hidden="true">
      <path d="M8 44 C10 34 30 28 60 28 L170 30 C186 30 196 36 198 44 C190 56 170 60 140 60 L40 60 C20 60 8 54 8 44 Z" fill="#facc15" stroke="#a16207" strokeWidth="2"/>
      <path d="M14 50 L196 46 L192 52 C170 58 60 60 30 58 Z" fill="#dc2626"/>
      <path d="M160 30 L178 4 L194 4 L186 32 Z" fill="#dc2626" stroke="#7f1d1d" strokeWidth="1.5"/>
      <rect x="54" y="20" width="96" height="7" rx="3" fill="#ca8a04"/>
      <ellipse cx="78" cy="18" rx="10" ry="5" fill="#475569"/><ellipse cx="126" cy="18" rx="10" ry="5" fill="#475569"/>
      <path d="M18 38 C22 32 34 30 40 32 L40 40 L20 42 Z" fill="#7dd3fc" stroke="#0369a1" strokeWidth="1.5"/>
      {[56, 72, 88, 104, 120].map(x => <rect key={x} x={x} y="35" width="9" height="6" rx="2" fill="#0ea5e9"/>)}
    </svg>
  );
}
function Incendie({ done }) {
  const s = useStage(done);
  const cv = useRef(null);
  const [ph, setPh] = useState("feu"); // feu, canadair, eau, eteint, fin
  const [hint, setHint] = useState(false);
  const [fx, addFx] = useFx(s.ctl);
  const st = useRef({ R: 0, hold: 0, mode: "feu", t: 0, rubs: 0 });
  const geo = useMemo(() => { const W = vw(), H = vh(); return { W, H, cx: 0, cy: H, max: Math.hypot(W, H) * 0.82 }; }, []);
  useEffect(() => {
    const { ctl } = s;
    const { list, dsc } = grab(ctl, 120);
    const { W, H, cx, cy, max } = geo;
    const S = st.current;
    const c = cv.current;
    const g = c && c.getContext ? c.getContext("2d") : null;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    if (c) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const N = 72;
    const nz = Array.from({ length: N + 1 }, () => rand(-1, 1));
    const em = Array.from({ length: 80 }, () => ({ a: rand(0, 1), f: rand(0.5, 1), p: rand(0, 6) }));
    const items = list.map(o => ({ o, on: false, rx: rand(30, 62), rz: rand(-16, 16) }));
    const flame = (x, y, w, h) => {
      const lg = g.createLinearGradient(0, y, 0, y - h);
      lg.addColorStop(0, "rgba(254,240,138,.95)"); lg.addColorStop(0.35, "rgba(251,146,60,.9)"); lg.addColorStop(1, "rgba(220,38,38,0)");
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(x - w, y); g.quadraticCurveTo(x - w, y - h * 0.55, x, y - h); g.quadraticCurveTo(x + w, y - h * 0.55, x + w, y); g.closePath(); g.fill();
    };
    const draw = t => {
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const R = S.R;
      if (R < 2) return;
      const pts = [];
      for (let k = 0; k <= N; k++) {
        const a = -Math.PI / 2 - 0.1 + (Math.PI / 2 + 0.2) * k / N;
        const r = R * (1 + 0.05 * Math.sin(a * 11 + t * 1.6) + 0.035 * nz[k]);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      g.beginPath(); g.moveTo(cx, cy); pts.forEach(p => g.lineTo(p[0], p[1])); g.closePath();
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      gr.addColorStop(0, "rgba(12,8,6,.78)"); gr.addColorStop(0.8, "rgba(30,15,6,.7)"); gr.addColorStop(1, "rgba(70,30,8,.66)");
      g.fillStyle = gr; g.fill();
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.lineJoin = "round";
      g.strokeStyle = "rgba(24,10,2,.92)"; g.lineWidth = 18; g.stroke();
      g.shadowColor = "#fb923c"; g.shadowBlur = 18; g.strokeStyle = "#f97316"; g.lineWidth = 5; g.stroke();
      g.shadowBlur = 0; g.strokeStyle = "#fde047"; g.lineWidth = 1.6; g.stroke();
      em.forEach(e => {
        const p = pts[Math.floor(e.a * N)];
        const x = cx + (p[0] - cx) * e.f, y = cy + (p[1] - cy) * e.f;
        const al = (0.35 + 0.65 * Math.abs(Math.sin(t * 3 + e.p))) * (e.f > 0.9 ? 1 : 0.55);
        g.fillStyle = `rgba(251,146,60,${al.toFixed(2)})`;
        g.fillRect(x, y, 2.6, 2.6);
      });
      const calm = S.mode === "eteint" || S.mode === "eau" ? 0.45 : 1;
      for (let k = 1; k < N; k += 3) {
        const p = pts[k];
        const h = (24 + 24 * Math.abs(Math.sin(t * 7 + k * 1.7))) * clamp(R / 120, 0.3, 1) * calm;
        flame(p[0], p[1], 8 + (k % 4), h);
      }
    };
    let lastSmoke = 0, endAt = 0;
    ctl.loop((t, dt) => {
      S.t = t;
      const growing = S.mode === "feu" || S.mode === "canadair";
      if (growing && t > S.hold) S.R = Math.min(max, S.R + dt * (S.R < 60 ? 50 : max / 8.5));
      if (!growing) S.R = Math.max(0, S.R - dt * (S.mode === "eau" ? 560 : 420));
      if (S.mode === "feu" && t > 11) {
        S.mode = "canadair"; setPh("canadair");
        ctl.after(1300, () => { if (S.mode === "canadair") { S.mode = "eau"; setPh("eau"); } });
      }
      const d = dsc();
      items.forEach(it => {
        const inside = Math.hypot(it.o.x - cx, it.o.y - d - cy) < S.R - 14;
        if (inside === it.on) return;
        it.on = inside;
        if (inside) {
          ctl.set(it.o.c, { transition: "transform .8s cubic-bezier(.3,1.4,.5,1), filter .8s ease", "transform-origin": "50% 100%",
            transform: `perspective(420px) rotateX(${f1(it.rx)}deg) rotate(${f1(it.rz)}deg) scale(.8)`,
            filter: "sepia(1) saturate(1.6) brightness(.45) contrast(1.3)" });
        } else ctl.unset(it.o.c, ["transform", "filter"]);
      });
      draw(t);
      if (S.R > 50 && t - lastSmoke > 0.3) {
        lastSmoke = t;
        const a = rand(-Math.PI / 2, 0), steam = !growing;
        addFx([{ x: cx + Math.cos(a) * S.R, y: cy + Math.sin(a) * S.R, size: rand(40, 70), kind: "smoke", blur: 7, o: steam ? 0.75 : 0.55,
          bg: steam ? "radial-gradient(circle, rgba(241,245,249,.95), rgba(241,245,249,0) 70%)" : "radial-gradient(circle, rgba(41,37,36,.9), rgba(41,37,36,0) 70%)",
          dx: rand(-30, 40), dy: rand(-170, -100), dur: 2.4 }], 2600);
      }
      if (S.R <= 0 && !growing) {
        if (!endAt) endAt = t;
        if (t - endAt > 1.3) { setPh("fin"); s.finish(); return false; }
      }
      return true;
    });
    ctl.after(5000, () => { if (S.rubs < 3) setHint(true); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rub = (x, y) => {
    const S = st.current;
    if (S.mode !== "feu" && S.mode !== "canadair") return;
    const d = Math.hypot(x - geo.cx, y - geo.cy);
    if (d > S.R + 70) return;
    S.R = Math.max(0, S.R - (d > S.R - 90 ? 9 : 4));
    S.hold = S.t + 0.6;
    S.rubs += 1;
    if (S.rubs % 4 === 0) {
      addFx([{ x, y, size: rand(22, 36), kind: "smoke", blur: 4, o: 0.7, bg: "radial-gradient(circle, rgba(226,232,240,.95), rgba(226,232,240,0) 70%)",
        dx: rand(-24, 24), dy: rand(-80, -40), dur: 1.3 }], 1500);
    }
    if (S.R < 40) { S.mode = "eteint"; setPh("eteint"); }
  };
  const live = ph === "feu" || ph === "canadair";
  return (
    <Layer s={s} css={INCENDIE_CSS}>
      <canvas ref={cv} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}/>
      {live && (
        <div aria-label="Flammes à éteindre" role="button" tabIndex={-1}
          onPointerDown={e => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch (er) { /* rien */ } rub(e.clientX, e.clientY); }}
          onPointerMove={e => { if (e.buttons || e.pointerType !== "mouse") rub(e.clientX, e.clientY); }}
          style={{ position: "absolute", inset: 0, pointerEvents: "auto", touchAction: "none", cursor: "grab" }}/>
      )}
      {(ph === "canadair" || ph === "eau") && (
        <div aria-hidden="true" style={{ position: "absolute", left: 0, top: geo.H * 0.1, "--from": `${geo.W + 40}px`,
          animation: "pk-incendie-plane 2.8s linear both" }}><CanadairSvg/></div>
      )}
      {ph === "eau" && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none",
          background: "repeating-linear-gradient(98deg, rgba(186,230,253,0) 0 12px, rgba(186,230,253,.6) 12px 15px), linear-gradient(180deg, rgba(56,189,248,.5), rgba(14,165,233,.25))",
          animation: "pk-incendie-water 1.5s ease-in both" }}/>
      )}
      <Fx fx={fx} slug="incendie"/>
      {ph === "feu" && (hint ? <Pill key="h">Frotte les flammes du doigt (ou de la souris) pour les souffler !</Pill>
        : <Pill key="a">🔥 Le plateau chauffant a débordé : la page prend feu !</Pill>)}
      {ph === "canadair" && <Pill key="c">✈️ Appel au canadair… il arrive en rase-mottes !</Pill>}
      {ph === "eau" && <Pill key="e">💦 Largage ! Tout le monde à l'abri.</Pill>}
      {ph === "eteint" && <Pill key="t">🧑‍🚒 Bravo, pompier ! Le feu recule…</Pill>}
      {ph === "fin" && <Pill key="f" fade>Feu éteint. Pas une trace de suie, promis.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Eruption
// ════════════════════════════════════════════════════════════════════════════
const ERUPTION_CSS = FX_CSS("eruption") + `
@keyframes pk-eruption-rise { from { transform: translate(-50%, 105%) } to { transform: translate(-50%, 0) } }
@keyframes pk-eruption-sink { from { transform: translate(-50%, 0) } to { transform: translate(-50%, 110%) } }
@keyframes pk-eruption-shake { 0%, 100% { transform: translate(0, 0) } 25% { transform: translate(-2px, 1px) } 75% { transform: translate(2px, -1px) } }
@keyframes pk-eruption-wave { from { transform: translateX(0) } to { transform: translateX(-50%) } }
@keyframes pk-eruption-glow { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
`;
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mixHex = (a, b, k) => {
  const p = hexRgb(a), q = hexRgb(b);
  return `rgb(${Math.round(lerp(p[0], q[0], k))},${Math.round(lerp(p[1], q[1], k))},${Math.round(lerp(p[2], q[2], k))})`;
};
const LAVA_HOT = ["#7f1d1d", "#dc2626", "#f97316", "#fde047"];
const LAVA_COLD = ["#1c1917", "#292524", "#44403c", "#78716c"];
const WAVE_D = (() => {
  let d = "M0 14";
  for (let i = 0; i < 24; i++) d += ` Q${i * 50 + 25} ${i % 2 ? 26 : 2} ${i * 50 + 50} 14`;
  return d + " L1200 40 L0 40 Z";
})();
function Eruption({ done }) {
  const s = useStage(done);
  const lake = useRef(null);
  const bombEls = useRef([]);
  const [ph, setPh] = useState(0); // 0 surgit, 1 erupte, 2 refroidit, 3 se retire, 4 fin
  const [cool, setCool] = useState(0);
  const [fx, addFx] = useFx(s.ctl);
  const geo = useMemo(() => {
    const W = vw(), narrow = isNarrow();
    const w = Math.min(440, W * 0.92), h = w * 0.55;
    const top = floorY() - h + (narrow ? 10 : 0);
    return { W, w, h, top, cx: W / 2, cy: top + h * 34 / 220, NB: narrow ? 7 : 11 };
  }, []);
  useEffect(() => {
    const { ctl } = s;
    const { list, tiles, dsc } = grab(ctl, 120);
    const main = ctl.main();
    const H = vh();
    const lakeMax = (H - floorY()) + H * 0.13;
    const bombs = Array.from({ length: geo.NB }, () => ({ on: false, next: rand(1.4, 3) }));
    const G = 1700;
    const tl = tiles.map(c => ({ c, ph: rand(0, 6), hot: false }));
    const lev = { bg: 0, lake: 0, cool: 0 };
    let lastPuff = 0, lastCool = -1;
    const launch = (b, t) => {
      if (!list.length) return;
      const o = pick(list);
      const tx = o.x, ty = o.y - dsc();
      const T = rand(0.9, 1.35);
      Object.assign(b, { on: true, t0: t, T, o, x0: geo.cx, y0: geo.cy, vx: (tx - geo.cx) / T, vy: (ty - geo.cy - 0.5 * G * T * T) / T });
    };
    ctl.loop((t, dt) => {
      // niveaux de lave : monte, refroidit, se retire
      const up = clamp((t - 1.4) / 4.4, 0, 1), back = clamp((t - 8.8) / 1.8, 0, 1);
      const amt = easeInOut(up) * (1 - easeInOut(back));
      lev.cool = clamp((t - 6.4) / 2, 0, 1);
      const mh = main ? main.clientHeight : H;
      lev.bg = mh * 0.7 * amt;
      lev.lake = lakeMax * easeInOut(clamp((t - 1.2) / 3.6, 0, 1)) * (1 - easeInOut(back));
      const cols = LAVA_HOT.map((c, i) => mixHex(c, LAVA_COLD[i], lev.cool));
      const L = lev.bg;
      if (main) {
        if (L > 1) {
          ctl.set(main, { "background-image": `linear-gradient(to top, ${cols[0]} 0px, ${cols[1]} ${f1(L * 0.45)}px, ${cols[2]} ${f1(Math.max(0, L - 18))}px, ${cols[3]} ${f1(Math.max(0, L - 4))}px, rgba(0,0,0,0) ${f1(L)}px)` });
        } else ctl.unset(main, ["background-image"]);
      }
      if (lake.current) {
        lake.current.style.height = `${f1(lev.lake)}px`;
        lake.current.style.setProperty("--c0", cols[0]); lake.current.style.setProperty("--c1", cols[1]);
        lake.current.style.setProperty("--c2", cols[2]); lake.current.style.setProperty("--c3", cols[3]);
      }
      const k10 = Math.round(lev.cool * 10);
      if (k10 !== lastCool) { lastCool = k10; setCool(k10 / 10); }
      // tuiles qui flottent sur la lave
      const mb = main ? main.getBoundingClientRect().bottom : H;
      const yL = Math.min(mb - L, H - lev.lake);
      tl.forEach(o => {
        const r = o.c.getBoundingClientRect();
        const sub = clamp((r.top + r.height * 0.6 - yL) / 90, 0, 1);
        if (sub <= 0.001) { ctl.unset(o.c, ["transform"]); }
        else {
          const bob = Math.sin(t * 2.2 + o.ph) * 6 * (1 - lev.cool * 0.8);
          ctl.set(o.c, { transform: `translateY(${f1(sub * (bob - 6))}px) rotate(${(sub * Math.sin(t * 1.3 + o.ph) * 1.6 * (1 - lev.cool * 0.8)).toFixed(2)}deg)` });
        }
        const hot = sub > 0.3;
        if (hot !== o.hot) {
          o.hot = hot;
          if (hot) ctl.set(o.c, { transition: "filter .6s ease", filter: lev.cool > 0.5 ? "grayscale(.7) brightness(.8)" : "sepia(.55) saturate(1.9) hue-rotate(-14deg) brightness(1.05)" });
          else ctl.unset(o.c, ["filter"]);
        }
        if (hot && lev.cool > 0.5 && !o.cold) { o.cold = true; ctl.set(o.c, { filter: "grayscale(.7) brightness(.8)" }); }
      });
      // bombes de lave
      bombs.forEach((b, i) => {
        const el = bombEls.current[i];
        if (!b.on) {
          if (t > b.next && t < 6.4) launch(b, t);
          else { if (el) el.style.opacity = "0"; return; }
        }
        const tau = t - b.t0;
        const x = b.x0 + b.vx * tau, y = b.y0 + b.vy * tau + 0.5 * G * tau * tau;
        if (el) { el.style.opacity = "1"; el.style.transform = `translate(${f1(x - 10)}px,${f1(y - 10)}px) rotate(${f1(tau * 500)}deg)`; }
        if (tau >= b.T) {
          b.on = false; b.next = t + rand(0.1, 0.7);
          const h = rand(18, 46);
          ctl.anim(b.o.c, [{ transform: "none" }, { transform: `translateY(${f1(-h)}px) rotate(${f1(rand(-14, 14))}deg) scale(1.06)`, offset: 0.35 },
            { transform: "translateY(0px)", offset: 0.7 }, { transform: "translateY(-6px)", offset: 0.85 }, { transform: "none" }],
          { duration: 700, easing: "ease-out" });
          const sp = [];
          for (let k = 0; k < 7; k++) {
            const a = rand(-Math.PI, 0);
            sp.push({ x, y, size: rand(4, 9), bg: pick(["#fde047", "#f97316", "#ef4444"]), glow: "0 0 6px #f97316",
              dx: Math.cos(a) * rand(20, 60), dy: Math.sin(a) * rand(20, 50) + 30, dur: 0.7 });
          }
          addFx(sp, 1000);
        }
      });
      // fontaine au cratere, puis vapeur au refroidissement
      if (t - lastPuff > 0.16 && t > 1.2 && t < 9.6) {
        lastPuff = t;
        const items = [];
        if (t < 6.4) {
          for (let k = 0; k < 3; k++) items.push({ x: geo.cx + rand(-8, 8), y: geo.cy, size: rand(6, 12), bg: pick(["#fde047", "#fb923c", "#ef4444"]),
            glow: "0 0 10px #f97316", dx: rand(-70, 70), dy: rand(-200, -90), s: 0.6, dur: rand(0.7, 1.1) });
          if (Math.random() < 0.6) items.push({ x: geo.cx + rand(-14, 14), y: geo.cy - 10, size: rand(50, 80), kind: "smoke", blur: 8, o: 0.6,
            bg: "radial-gradient(circle, rgba(68,64,60,.9), rgba(68,64,60,0) 70%)", dx: rand(-60, 60), dy: rand(-260, -180), dur: 2.6 });
        } else {
          items.push({ x: rand(0, geo.W), y: H - lev.lake, size: rand(40, 70), kind: "smoke", blur: 7, o: 0.7,
            bg: "radial-gradient(circle, rgba(241,245,249,.95), rgba(241,245,249,0) 70%)", dx: rand(-30, 30), dy: rand(-160, -90), dur: 2.2 });
        }
        addFx(items, 2800);
      }
      return t < 11;
    });
    ctl.after(1200, () => setPh(1));
    ctl.after(6400, () => setPh(2));
    ctl.after(8800, () => setPh(3));
    ctl.after(11300, () => {
      tl.forEach(o => ctl.unset(o.c, ["transform", "filter"]));
      if (main) ctl.unset(main, ["background-image"]);
      setPh(4); s.finish();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const streak = cool > 0.5 ? "#57534e" : "#f97316";
  return (
    <Layer s={s} css={ERUPTION_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: geo.top, width: geo.w, height: geo.h,
        animation: ph >= 3 ? "pk-eruption-sink 1.6s ease-in .6s both" : "pk-eruption-rise 1.2s cubic-bezier(.2,.9,.3,1) both" }}>
        <div style={{ width: "100%", height: "100%", animation: ph <= 1 ? "pk-eruption-shake .12s linear infinite" : "none" }}>
          <svg width="100%" height="100%" viewBox="0 0 400 220" preserveAspectRatio="none">
            <defs>
              <linearGradient id="pk-eruption-mt" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#78350f"/><stop offset="1" stopColor="#292524"/>
              </linearGradient>
              <radialGradient id="pk-eruption-cr" cx=".5" cy=".5" r=".5">
                <stop offset="0" stopColor="#fef08a"/><stop offset=".5" stopColor="#f97316"/><stop offset="1" stopColor="#f97316" stopOpacity="0"/>
              </radialGradient>
            </defs>
            <ellipse cx="200" cy="34" rx="70" ry="30" fill="url(#pk-eruption-cr)" style={{ animation: "pk-eruption-glow .7s ease-in-out infinite", opacity: cool > 0.5 ? 0.2 : 1 }}/>
            <path d="M0 220 L150 40 Q165 26 180 34 L200 30 L222 36 Q236 26 250 40 L400 220 Z" fill="url(#pk-eruption-mt)"/>
            <path d="M160 40 L130 80 L150 78 L120 120" stroke="#44403c" strokeWidth="3" fill="none" opacity=".6"/>
            {["M182 34 Q176 80 150 120 Q132 160 118 220", "M214 35 Q226 90 250 130 Q270 170 290 220", "M198 31 Q200 100 196 220"].map((d, i) => (
              <path key={i} d={d} fill="none" stroke={streak} strokeWidth={i === 2 ? 5 : 7} strokeLinecap="round"
                style={{ transition: "stroke 1.2s ease", filter: cool > 0.5 ? "none" : "drop-shadow(0 0 4px #f97316)" }}/>
            ))}
          </svg>
        </div>
      </div>
      <div ref={lake} aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 0,
        background: "linear-gradient(0deg, var(--c0, #7f1d1d), var(--c1, #dc2626) 50%, var(--c2, #f97316) 88%, var(--c3, #fde047))",
        boxShadow: cool > 0.5 ? "none" : "0 -8px 34px rgba(249,115,22,.55)" }}>
        <div style={{ position: "absolute", left: 0, top: -12, width: "200%", height: 40, animation: "pk-eruption-wave 3.5s linear infinite" }}>
          <svg width="100%" height="40" viewBox="0 0 1200 40" preserveAspectRatio="none"><path d={WAVE_D} fill="var(--c3, #fde047)"/></svg>
        </div>
      </div>
      {Array.from({ length: geo.NB }, (_, i) => (
        <div key={i} ref={el => { bombEls.current[i] = el; }} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 20, height: 20,
          borderRadius: "45% 55% 50% 50%", opacity: 0, transform: "translate(-100px,-100px)",
          background: "radial-gradient(circle at 35% 35%, #fef08a, #f97316 45%, #7f1d1d 80%)", boxShadow: "0 0 14px #f97316, 0 0 4px #fde047" }}/>
      ))}
      <Fx fx={fx} slug="eruption"/>
      {ph <= 1 && <Pill key="a">🌋 Éruption sous l'accueil ! Ça déborde par-dessus la buse…</Pill>}
      {ph === 2 && <Pill key="b">Ça refroidit… la lave fige comme du PLA à la sortie de buse.</Pill>}
      {ph === 3 && <Pill key="c">Le volcan rentre sous terre, la lave aussi.</Pill>}
      {ph === 4 && <Pill key="d" fade>Tout est sec et à sa place. Un peu chaud au toucher, peut-être.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Orage
// ════════════════════════════════════════════════════════════════════════════
const ORAGE_CSS = FX_CSS("orage") + `
@keyframes pk-orage-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes pk-orage-flash { 0% { opacity: 0 } 5% { opacity: .85 } 20% { opacity: .1 } 32% { opacity: .6 } 100% { opacity: 0 } }
@keyframes pk-orage-bolt { 0%, 55% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-orage-cloud { from { transform: translateX(-30px) } to { transform: translateX(30px) } }
@keyframes pk-orage-panne { 0% { opacity: 0 } 6% { opacity: .97 } 78% { opacity: .97 } 82% { opacity: .3 } 86% { opacity: .95 } 91% { opacity: .15 } 95% { opacity: .85 } 100% { opacity: 0 } }
`;
const toD = pts => "M" + pts.map(p => f1(p[0]) + " " + f1(p[1])).join(" L");
function Orage({ done }) {
  const s = useStage(done);
  const rain = useRef(null);
  const [ph, setPh] = useState(0); // 0 orage, 1 panne, 2 accalmie, 3 fin
  const [bolt, setBolt] = useState(null);
  const [fx, addFx] = useFx(s.ctl);
  const clouds = useMemo(() => Array.from({ length: 7 }, (_, i) => ({ l: i * 16 - 8 + rand(-4, 4), w: rand(30, 46), h: rand(90, 140), d: rand(3, 5) })), []);
  useEffect(() => {
    const { ctl } = s;
    const { list, dsc } = grab(ctl, 120);
    const W = vw(), H = vh();
    const c = rain.current;
    const g = c && c.getContext ? c.getContext("2d") : null;
    if (c) { c.width = W; c.height = H; }
    const drops = Array.from({ length: isNarrow() ? 110 : 220 }, () => ({ x: rand(-100, W), y: rand(-H, H), v: rand(900, 1400), l: rand(14, 26) }));
    const wind = 0.22;
    ctl.loop((t, dt) => {
      const k = t < 1 ? t : t > 9 ? Math.max(0, 1 - (t - 9) / 1.2) : 1;
      if (g) {
        g.clearRect(0, 0, W, H);
        g.strokeStyle = `rgba(186,230,253,${(0.55 * k).toFixed(2)})`;
        g.lineWidth = 1.3;
        g.beginPath();
        drops.forEach(dr => {
          dr.y += dr.v * dt; dr.x += dr.v * dt * wind;
          if (dr.y > H) { dr.y = rand(-60, -10); dr.x = rand(-100, W); }
          g.moveTo(dr.x, dr.y); g.lineTo(dr.x - dr.l * wind, dr.y - dr.l);
        });
        g.stroke();
      }
      return t < 10.4;
    });
    const used = new Set();
    const sooted = [];
    const SOOT = "brightness(.55) contrast(1.4) sepia(.45)";
    [1.5, 2.5, 3.2, 4.2, 4.8, 5.9].forEach((at, k) => ctl.after(at * 1000, () => {
      const d = dsc();
      const cand = list.filter((o, i) => !used.has(i) && o.y - d > 70 && o.y - d < floorY() - 30);
      const o = cand.length ? pick(cand) : pick(list);
      if (!o) return;
      used.add(list.indexOf(o));
      const tx = o.x, ty = o.y - d;
      let x = tx + rand(-130, 130), y = -10;
      const pts = [[x, y]];
      const n = 9;
      for (let i = 1; i < n; i++) { y = ty * i / n; x = lerp(x, tx, 1 / (n - i + 1)) + rand(-24, 24); pts.push([x, y]); }
      pts.push([tx, ty]);
      const br = [2, 5].map(i => {
        const b = [pts[i]]; let bx = pts[i][0], by = pts[i][1]; const dir = Math.random() < 0.5 ? -1 : 1;
        for (let j = 0; j < 3; j++) { bx += dir * rand(14, 34); by += rand(14, 34); b.push([bx, by]); }
        return toD(b);
      });
      setBolt({ id: k, main: toD(pts), br });
      ctl.after(420, () => setBolt(b => (b && b.id === k ? null : b)));
      ctl.anim(o.c, [
        { transform: "none", filter: "none" },
        { transform: `translateY(-52px) rotate(${f1(rand(-28, 28))}deg) scale(1.15)`, filter: "brightness(2.6) drop-shadow(0 0 10px #fde047)", offset: 0.22 },
        { transform: "translate(5px,-8px) rotate(-4deg)", filter: "invert(1) brightness(1.3)", offset: 0.36 },
        { transform: "translate(-5px,-4px) rotate(4deg)", filter: "brightness(2.2)", offset: 0.46 },
        { transform: "translate(4px,0px) rotate(-2deg)", filter: "invert(1)", offset: 0.56 },
        { transform: "translate(0px,0px) rotate(0deg)", filter: SOOT, offset: 0.8 },
        { transform: "none", filter: SOOT }],
      { duration: 1200, easing: "ease-out", fill: "forwards" });
      sooted.push(o);
      list.forEach(p => {
        if (p === o) return;
        const dd = Math.hypot(p.x - o.x, p.y - o.y);
        if (dd < 240) ctl.anim(p.c, jitterKf(9 * (1 - dd / 240) + 2, 8, 4), { duration: 420, delay: dd * 0.5 });
      });
      const sp = [];
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2);
        sp.push({ x: tx, y: ty, size: rand(3, 6), bg: pick(["#fde047", "#fef9c3", "#a5f3fc"]), glow: "0 0 8px #fde047",
          dx: Math.cos(a) * rand(30, 90), dy: Math.sin(a) * rand(30, 90), dur: 0.6 });
      }
      sp.push({ x: tx + rand(-20, 20), y: ty - 30, text: pick(["BZZT !", "ZAP !", "BZZZ…", "CRRR !"]), color: "#fde047", fs: 22, kind: "pop", r: rand(-12, 12), dur: 1.1 });
      sp.push({ x: tx, y: ty, size: 46, kind: "smoke", blur: 6, o: 0.6, bg: "radial-gradient(circle, rgba(71,85,105,.9), rgba(71,85,105,0) 70%)", dx: rand(-20, 20), dy: -90, dur: 1.8, delay: 0.3 });
      addFx(sp, 2200);
    }));
    ctl.after(6900, () => setPh(1));
    // dans le noir, les electrocutes se remettent (personne ne les voit)
    ctl.after(7400, () => sooted.forEach(o => ctl.anim(o.c, [{ filter: SOOT }, { filter: "none" }], { duration: 300, fill: "forwards" })));
    ctl.after(8900, () => setPh(2));
    ctl.after(10900, () => { setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={ORAGE_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: ph >= 2 ? 0 : 1, transition: "opacity 1.6s ease",
        background: "radial-gradient(ellipse at 50% -10%, rgba(30,41,59,.5), rgba(2,6,23,.72))", animation: "pk-orage-in 1s ease both" }}/>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: -50, height: 170, opacity: ph >= 2 ? 0 : 1, transition: "opacity 1.6s ease" }}>
        {clouds.map((cl, i) => (
          <div key={i} style={{ position: "absolute", left: `${cl.l}%`, top: 0, width: `${cl.w}%`, height: cl.h, borderRadius: "50%",
            background: "radial-gradient(ellipse at 50% 40%, #475569, #1e293b 60%, rgba(15,23,42,0) 72%)", filter: "blur(4px)",
            animation: `pk-orage-cloud ${f1(cl.d)}s ease-in-out ${f1(-i * 0.7)}s infinite alternate` }}/>
        ))}
      </div>
      <canvas ref={rain} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}/>
      {bolt && (
        <React.Fragment key={bolt.id}>
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "#e0f2fe", animation: "pk-orage-flash .45s ease-out both" }}/>
          <svg aria-hidden="true" width="100%" height="100%" style={{ position: "absolute", inset: 0, animation: "pk-orage-bolt .42s linear both",
            filter: "drop-shadow(0 0 8px #a5f3fc) drop-shadow(0 0 2px #fff)" }}>
            {[bolt.main, ...bolt.br].map((d, i) => (
              <g key={i}>
                <path d={d} fill="none" stroke="#bae6fd" strokeWidth={i ? 3 : 7} strokeLinejoin="bevel" opacity=".7"/>
                <path d={d} fill="none" stroke="#fff" strokeWidth={i ? 1.4 : 2.8} strokeLinejoin="bevel"/>
              </g>
            ))}
          </svg>
        </React.Fragment>
      )}
      {ph === 1 && <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "#020617", animation: "pk-orage-panne 2s linear both" }}/>}
      <Fx fx={fx} slug="orage"/>
      {ph === 0 && <Pill key="a">⛈️ Orage sur l'atelier ! Débranche l'imprimante… trop tard.</Pill>}
      {ph === 1 && <Pill key="b">🔌 Coupure de courant… le disjoncteur de l'atelier a sauté.</Pill>}
      {ph === 2 && <Pill key="c">Le courant revient. L'impression reprend à la couche 112.</Pill>}
      {ph === 3 && <Pill key="d" fade>L'orage est passé. Rien n'a grillé, pas même un fusible.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Trou noir
// ════════════════════════════════════════════════════════════════════════════
const TROU_CSS = FX_CSS("trou-noir") + `
@keyframes pk-trou-noir-spin { to { transform: rotate(360deg) } }
@keyframes pk-trou-noir-star { 0% { transform: rotate(var(--a)) translateX(var(--r)) scale(1); opacity: 0 } 15% { opacity: 1 }
  100% { transform: rotate(calc(var(--a) + 320deg)) translateX(0px) scale(.1); opacity: 0 } }
@keyframes pk-trou-noir-in { from { opacity: 0 } to { opacity: 1 } }
`;
function TrouNoir({ done }) {
  const s = useStage(done);
  const hole = useRef(null);
  const [ph, setPh] = useState(0); // 0 aspire, 1 recrache, 2 fin
  const geo = useMemo(() => ({ cx: vw() / 2, cy: vh() * 0.46, R: Math.min(vw(), vh()) * (isNarrow() ? 0.16 : 0.12) }), []);
  const stars = useMemo(() => Array.from({ length: 44 }, () => ({ a: rand(0, 360), r: rand(140, 700), d: rand(1.3, 2.6), dl: rand(0, 4) })), []);
  useEffect(() => {
    const { ctl } = s;
    const { list, dsc } = grab(ctl, 120);
    const { cx, cy } = geo;
    const maxD = Math.max(1, ...list.map(o => Math.hypot(o.x - cx, o.y - cy)));
    const st = list.map(o => {
      const d0 = Math.hypot(o.x - cx, o.y - cy);
      return { o, d0, a0: Math.atan2(o.y - cy, o.x - cx), ts: 1 + (d0 / maxD) * 2.6 + rand(0, 0.4), dur: rand(1.6, 2.2),
        turns: rand(2.5, 4.5), spin: rand(-540, 540), out: 6.6 + rand(0, 0.7) + (1 - d0 / maxD) * 0.3, home: false };
    });
    ctl.loop(t => {
      const k = t < 1 ? easeOutBack(clamp(t, 0, 1)) : t < 6.2 ? 1 + 0.06 * Math.sin(t * 6)
        : t < 6.7 ? 1 + 0.4 * Math.sin((t - 6.2) / 0.5 * Math.PI) : t < 8.6 ? 1 : Math.max(0, 1 - (t - 8.6) / 0.7);
      if (hole.current) hole.current.style.transform = `scale(${Math.max(0, k).toFixed(3)})`;
      const d = dsc();
      st.forEach(p => {
        if (p.home || t < p.ts) return;
        const hx = p.o.x, hy = p.o.y - d;
        let r, ang, sx, sy, sc, rot;
        if (t < p.out) {
          const u = clamp((t - p.ts) / p.dur, 0, 1), u2 = u * u;
          r = p.d0 * (1 - u2); ang = p.a0 + p.turns * u2;
          sx = 1 + 3.2 * u2; sy = 1 / (1 + 2.2 * u2); sc = u > 0.75 ? 1 - (u - 0.75) / 0.25 * 0.97 : 1; rot = p.spin * u;
        } else {
          const u = clamp((t - p.out) / 1.1, 0, 1);
          if (u >= 1) { ctl.unset(p.o.c, ["transform"]); p.home = true; return; }
          r = p.d0 * easeOutBack(u); ang = p.a0 - 2.2 * (1 - u);
          sx = 1 + 1.6 * (1 - u); sy = 1 / (1 + 1.2 * (1 - u)); sc = Math.min(1, 0.05 + u * 1.6); rot = p.spin * (1 - u) * 0.5;
        }
        const px = cx + Math.cos(ang) * r, py = cy + Math.sin(ang) * r;
        const ad = ang * 180 / Math.PI;
        ctl.set(p.o.c, { transform: `translate(${f1(px - hx)}px,${f1(py - hy)}px) rotate(${f1(ad)}deg) scale(${(sx * sc).toFixed(3)},${(sy * sc).toFixed(3)}) rotate(${f1(-ad + rot)}deg)` });
      });
      return t < 9.6;
    });
    ctl.after(6300, () => setPh(1));
    ctl.after(9800, () => { st.forEach(p => ctl.unset(p.o.c, ["transform"])); setPh(2); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const R = geo.R;
  return (
    <Layer s={s} css={TROU_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: ph >= 2 ? 0 : 1, transition: "opacity 1s ease",
        background: `radial-gradient(circle at ${geo.cx}px ${geo.cy}px, rgba(2,6,23,.15), rgba(2,6,23,.6) 70%)`, animation: "pk-trou-noir-in 1s ease both" }}/>
      <div aria-hidden="true" style={{ position: "absolute", left: geo.cx, top: geo.cy, width: 0, height: 0 }}>
        {ph === 0 && stars.map((st, i) => (
          <span key={i} style={{ position: "absolute", left: -1.5, top: -1.5, width: 3, height: 3, borderRadius: "50%", background: "#e0e7ff",
            boxShadow: "0 0 4px #c7d2fe", "--a": `${f1(st.a)}deg`, "--r": `${f1(st.r)}px`,
            animation: `pk-trou-noir-star ${f1(st.d)}s cubic-bezier(.5,0,.9,.6) ${f1(st.dl)}s infinite both` }}/>
        ))}
        <div ref={hole} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transform: "scale(0)" }}>
          <div style={{ position: "absolute", left: -R * 2.8, top: -R * 2.8, width: R * 5.6, height: R * 5.6, transform: "rotate(-16deg) scaleY(.34)" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: "50%", filter: "blur(3px)",
              background: "conic-gradient(from 0deg, #f97316, #fde047, #fff7ed, #c084fc, #6366f1, #f97316, #fde047, #f97316)",
              WebkitMaskImage: "radial-gradient(circle, transparent 34%, #000 37%, #000 60%, transparent 70%)",
              maskImage: "radial-gradient(circle, transparent 34%, #000 37%, #000 60%, transparent 70%)",
              animation: "pk-trou-noir-spin 1.4s linear infinite" }}/>
          </div>
          <div style={{ position: "absolute", left: -R * 1.5, top: -R * 1.5, width: R * 3, height: R * 3, borderRadius: "50%",
            background: "radial-gradient(circle, transparent 31%, rgba(253,224,71,.65) 34%, rgba(249,115,22,.25) 42%, transparent 60%)" }}/>
          <div style={{ position: "absolute", left: -R, top: -R, width: R * 2, height: R * 2, borderRadius: "50%", background: "#000",
            boxShadow: "0 0 30px 8px rgba(168,85,247,.55), inset 0 0 18px rgba(99,102,241,.6)" }}/>
        </div>
      </div>
      {ph === 0 && <Pill key="a">🕳️ Un trou noir s'est ouvert au milieu de ton accueil. Tiens bon !</Pill>}
      {ph === 1 && <Pill key="b">Burp. Il n'aime pas le PETG : il recrache tout !</Pill>}
      {ph === 2 && <Pill key="c" fade>L'horizon des événements est refermé. Rien ne manque.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Enlevement extraterrestre
// ════════════════════════════════════════════════════════════════════════════
const ENLEV_CSS = FX_CSS("enlevement") + `
@keyframes pk-enlevement-lights { 0%, 100% { opacity: 1 } 50% { opacity: .25 } }
@keyframes pk-enlevement-beam { 0%, 100% { opacity: .8 } 50% { opacity: .55 } }
@keyframes pk-enlevement-hover { 0%, 100% { transform: translateY(0) rotate(-2deg) } 50% { transform: translateY(-6px) rotate(2deg) } }
@keyframes pk-enlevement-flick { 0%, 100% { opacity: .75 } 15% { opacity: .1 } 35% { opacity: .8 } 55% { opacity: .15 } 75% { opacity: .7 } }
@keyframes pk-enlevement-up { from { transform: translateY(0); opacity: .9 } to { transform: translateY(-120px); opacity: 0 } }
`;
function UfoSvg({ w }) {
  return (
    <svg width={w} height={w / 2} viewBox="0 0 160 80" aria-hidden="true" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="pk-enlevement-hull" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cbd5e1"/><stop offset="1" stopColor="#475569"/>
        </linearGradient>
      </defs>
      <ellipse cx="80" cy="32" rx="34" ry="26" fill="rgba(186,230,253,.7)" stroke="#e0f2fe" strokeWidth="2"/>
      <circle cx="80" cy="34" r="12" fill="#4ade80"/>
      <ellipse cx="75" cy="33" rx="3.2" ry="4.6" fill="#0f172a"/><ellipse cx="85" cy="33" rx="3.2" ry="4.6" fill="#0f172a"/>
      <path d="M74 20 L70 12 M86 20 L90 12" stroke="#4ade80" strokeWidth="2"/>
      <ellipse cx="80" cy="48" rx="78" ry="18" fill="url(#pk-enlevement-hull)" stroke="#334155" strokeWidth="1.5"/>
      <ellipse cx="80" cy="43" rx="60" ry="7" fill="#e2e8f0" opacity=".8"/>
      {[16, 38, 60, 80, 100, 122, 144].map((x, i) => (
        <circle key={x} cx={x} cy={x === 80 ? 60 : 53 + Math.abs(80 - x) * -0.04} r="4.2" fill={["#fde047", "#f472b6", "#4ade80", "#60a5fa"][i % 4]}
          style={{ animation: `pk-enlevement-lights .6s ease-in-out ${(i * 0.12).toFixed(2)}s infinite` }}/>
      ))}
    </svg>
  );
}
function Enlevement({ done }) {
  const s = useStage(done);
  const ufo = useRef(null);
  const [beam, setBeam] = useState(null);
  const [ph, setPh] = useState(0); // 0 enleve, 1 restitue (de travers), 2 corrige, 3 fin
  const [fx, addFx] = useFx(s.ctl);
  const uw = useMemo(() => (isNarrow() ? 120 : 160), []);
  useEffect(() => {
    const { ctl } = s;
    const { list, tiles, dsc } = grab(ctl, 120);
    const W = vw(), H = vh(), uh = uw / 2, fl = floorY();
    let ux = -uw, uy = 30;
    const at = (x, y) => `translate(${f1(x - uw / 2)}px,${f1(y)}px)`;
    const fly = (x, y, ms) => {
      if (ufo.current) ctl.anim(ufo.current, [{ transform: at(ux, uy) }, { transform: at(x, y) }], { duration: ms, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" });
      ux = x; uy = y;
    };
    // les arrets : des tuiles visibles, et les morceaux de chacune
    const nStops = isNarrow() ? 3 : 4;
    let groups = shuffle(tiles.filter(t => { const r = t.getBoundingClientRect(); return r.top + r.height / 2 > 90 && r.top + r.height / 2 < fl - 40; }))
      .slice(0, nStops).map(t => ({ t, items: shuffle(list.filter(o => o.tile === t)).slice(0, 7) })).filter(g => g.items.length);
    if (!groups.length) groups = [{ t: null, items: list.slice(0, 6) }];
    groups.forEach(g => {
      const xs = g.items.map(o => o.x);
      g.x = clamp((Math.min(...xs) + Math.max(...xs)) / 2, uw / 2 + 4, W - uw / 2 - 4);
      g.y = clamp(Math.min(...g.items.map(o => o.t)) - uh - 60, 20, H * 0.5);
    });
    const taken = [];
    fly(groups[0].x, groups[0].y, 850);
    groups.forEach((g, k) => {
      const t0 = 900 + k * 1500;
      if (k) ctl.after(t0, () => fly(g.x, g.y, 550));
      ctl.after(t0 + 560, () => {
        const d = dsc();
        const bottom = Math.max(...g.items.map(o => o.t + o.h)) - d;
        const top = g.y + uh * 0.75;
        setBeam({ k, x: g.x, top, h: Math.max(60, bottom - top + 10), w: isNarrow() ? 150 : 230 });
        g.items.forEach((o, i) => ctl.after(i * 90, () => {
          const d2 = dsc();
          const hx = o.x, hy = o.y - d2;
          o.from = { x: g.x, y: g.y + uh * 0.5 };
          ctl.anim(o.c, [
            { transform: "none", opacity: 1 },
            { transform: `translate(${f1((g.x - hx) * 0.25)}px,-34px) rotate(${f1(rand(-30, 30))}deg)`, opacity: 1, offset: 0.3 },
            { transform: `translate(${f1(g.x - hx)}px,${f1(g.y + uh * 0.5 - hy)}px) rotate(${f1(rand(-360, 360))}deg) scale(.08)`, opacity: 0 }],
          { duration: 680, easing: "ease-in", fill: "forwards" });
          taken.push(o);
        }));
        list.forEach(o => {
          if (g.items.includes(o) || Math.abs(o.x - g.x) > 150) return;
          ctl.anim(o.c, [{ transform: "none" }, { transform: `translateY(-14px) rotate(${f1(rand(-4, 4))}deg)`, offset: 0.5 }, { transform: "none" }],
            { duration: 800, easing: "ease-in-out" });
        });
        addFx(Array.from({ length: 8 }, () => ({ x: g.x + rand(-60, 60), y: bottom - rand(0, 60), size: rand(3, 6), bg: "#d9f99d",
          glow: "0 0 6px #a3e635", dx: rand(-10, 10), dy: -(bottom - top) * 0.8, dur: 0.9 })), 1200);
      });
      ctl.after(t0 + 1380, () => setBeam(b => (b && b.k === k ? null : b)));
    });
    const tEnd = 900 + groups.length * 1500;
    ctl.after(tEnd, () => fly(W / 2, 30, 700));
    ctl.after(tEnd + 700, () => {
      setPh(1);
      setBeam({ k: "wide", x: W / 2, top: 30 + uh * 0.75, h: H, w: W * 1.15, wide: true });
      const n = taken.length, shift = n > 1 ? Math.ceil(n / 2) : 0;
      const d = dsc();
      taken.forEach((o, i) => {
        const tg = taken[(i + shift) % n];
        o.wx = tg.x - o.x; o.wy = tg.y - o.y; o.wr = rand(-14, 14);
        const sx = W / 2 - o.x, sy = 30 + uh * 0.5 - (o.y - d);
        ctl.anim(o.c, [
          { transform: `translate(${f1(sx)}px,${f1(sy)}px) rotate(0deg) scale(.08)`, opacity: 0 },
          { transform: `translate(${f1(o.wx)}px,${f1(o.wy)}px) rotate(${f1(o.wr)}deg) scale(1)`, opacity: 1 }],
        { duration: 900, delay: i * 45, easing: "cubic-bezier(.3,1.25,.5,1)", fill: "forwards" });
      });
    });
    ctl.after(tEnd + 2500, () => setBeam(null));
    ctl.after(tEnd + 2900, () => {
      setPh(2);
      setBeam({ k: "flick", x: W / 2, top: 30 + uh * 0.75, h: H, w: W * 1.15, wide: true, flick: true });
      taken.forEach((o, i) => ctl.after(350 + i * 40, () => {
        ctl.anim(o.c, [
          { transform: `translate(${f1(o.wx)}px,${f1(o.wy)}px) rotate(${f1(o.wr)}deg)`, opacity: 1 },
          { transform: `translate(${f1(o.wx * 0.5)}px,${f1(o.wy * 0.5 - 60)}px) rotate(${f1(o.wr * 0.5)}deg)`, opacity: 1, offset: 0.5 },
          { transform: "none", opacity: 1 }],
        { duration: 850, easing: "ease-in-out", fill: "forwards" });
      }));
    });
    ctl.after(tEnd + 4600, () => { setBeam(null); fly(W + uw, -uh - 60, 800); });
    ctl.after(tEnd + 5300, () => { setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={ENLEV_CSS}>
      {beam && (
        <div key={beam.k} aria-hidden="true" style={{ position: "absolute", left: beam.x - beam.w / 2, top: beam.top, width: beam.w, height: beam.h,
          clipPath: beam.wide ? "polygon(46% 0, 54% 0, 100% 100%, 0 100%)" : "polygon(36% 0, 64% 0, 100% 100%, 0 100%)",
          background: "linear-gradient(180deg, rgba(217,249,157,.8), rgba(163,230,53,.18))",
          animation: beam.flick ? "pk-enlevement-flick .5s linear infinite" : "pk-enlevement-beam .6s ease-in-out infinite" }}/>
      )}
      <div ref={ufo} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, transform: `translate(${-uw * 2}px,30px)` }}>
        <div style={{ animation: "pk-enlevement-hover 1.4s ease-in-out infinite" }}><UfoSvg w={uw}/></div>
      </div>
      <Fx fx={fx} slug="enlevement"/>
      {ph === 0 && <Pill key="a">🛸 Rencontre du troisième type : ils viennent prélever des échantillons.</Pill>}
      {ph === 1 && <Pill key="b">Analyse terminée. Restitution des échantillons…</Pill>}
      {ph === 2 && <Pill key="c">👽 Oups, mauvaise planète… pardon, mauvaise place. On recalibre !</Pill>}
      {ph === 3 && <Pill key="d" fade>Tout est rendu, à la bonne place cette fois. Ils ont gardé un Benchy.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 8. Kaiju
// ════════════════════════════════════════════════════════════════════════════
const KAIJU_CSS = FX_CSS("kaiju") + `
@keyframes pk-kaiju-eye { 0%, 88%, 100% { transform: scaleY(1) } 94% { transform: scaleY(.1) } }
@keyframes pk-kaiju-spikes { 0%, 100% { opacity: .35 } 50% { opacity: .95 } }
@keyframes pk-kaiju-foot { 0% { transform: translate(-50%, -130vh) } 32% { transform: translate(-50%, 0) } 40% { transform: translate(-50%, -6px) }
  46%, 70% { transform: translate(-50%, 0) } 100% { transform: translate(-50%, -130vh) } }
`;
const KAIJU_BACK = [[130, 250], [127, 222], [131, 192], [140, 162], [152, 134], [168, 106], [186, 80], [206, 62]];
function KaijuSvg({ h, light }) {
  const fill = light ? "rgba(30,41,59,.38)" : "rgba(100,116,139,.42)";
  return (
    <svg width={h * 300 / 360} height={h} viewBox="0 0 300 360" aria-hidden="true" style={{ overflow: "visible", filter: "blur(.6px)" }}>
      {KAIJU_BACK.map(([x, y], i) => (
        <path key={i} d={`M${x - 8} ${y + 8} L${x - 26 + i * 0.5} ${y - 14} L${x + 8} ${y - 6} Z`} fill="#38bdf8"
          style={{ animation: `pk-kaiju-spikes 1.2s ease-in-out ${(i * 0.08).toFixed(2)}s infinite`, filter: "drop-shadow(0 0 6px #38bdf8)" }}/>
      ))}
      <path d="M40 330 C70 300 110 290 130 260 C120 200 130 140 160 110 C170 80 190 50 220 46 C250 40 285 50 290 72 L292 86 C280 92 262 92 250 96 L252 104 C240 108 228 112 222 120 C230 140 236 160 232 190 C228 220 220 240 214 256 L226 330 L196 334 L186 280 C176 290 166 296 156 300 L160 338 L128 340 L126 296 C100 310 70 330 40 330 Z" fill={fill}/>
      <path d="M224 150 C244 160 252 172 256 186 L248 190 C242 178 232 170 222 168 Z" fill={fill}/>
      <g style={{ transformBox: "fill-box", transformOrigin: "50% 50%", animation: "pk-kaiju-eye 2.6s ease-in-out infinite" }}>
        <circle cx="262" cy="64" r="5.5" fill="#fde047" style={{ filter: "drop-shadow(0 0 5px #fde047)" }}/>
      </g>
    </svg>
  );
}
function FootSvg({ w }) {
  return (
    <svg width={w} height={w * 1.6} viewBox="0 0 100 160" aria-hidden="true" style={{ display: "block" }}>
      <path d="M22 0 L78 0 L80 110 C92 116 98 130 96 146 L84 150 L80 140 L70 152 L58 142 L50 156 L40 142 L30 152 L20 140 L14 150 L4 146 C2 130 8 116 20 110 Z"
        fill="#334155" stroke="#1e293b" strokeWidth="3"/>
      <path d="M30 20 C40 30 60 30 70 20 M30 50 C40 60 60 60 70 50 M30 80 C40 90 60 90 70 80" stroke="#475569" strokeWidth="4" fill="none"/>
      <path d="M14 150 L10 160 L20 152 Z M40 150 L40 160 L46 152 Z M66 152 L70 160 L74 150 Z M88 148 L94 158 L96 146 Z" fill="#f8fafc"/>
    </svg>
  );
}
function Kaiju({ done }) {
  const s = useStage(done);
  const mon = useRef(null);
  const [ph, setPh] = useState(0); // 0 traverse, 1 regonfle, 2 fin
  const [foot, setFoot] = useState(null);
  const [fx, addFx] = useFx(s.ctl);
  const geo = useMemo(() => { const H = vh(); const h = H * (isNarrow() ? 0.62 : 0.78); return { h, w: h * 300 / 360, light: isLight() }; }, []);
  useEffect(() => {
    const { ctl } = s;
    const { list, dsc } = grab(ctl, 120);
    const parts = ctl.parts();
    const W = vw(), fl = floorY();
    const P = 1.15, DUR = 10.2;
    const crushed = [];
    const isCrushed = new Set();
    let step = 0;
    const stomp = n => {
      const x = lerp(-geo.w, W + 20, clamp((n * P) / DUR, 0, 1)) + geo.w * (n % 2 ? 0.62 : 0.45);
      parts.forEach(p => ctl.anim(p, jitterKf(9, 12, 0.6), { duration: 380, easing: "linear" }));
      list.forEach(o => {
        if (isCrushed.has(o)) return;
        const dd = Math.abs(o.x - x);
        const amp = rand(8, 30) * (1 - Math.min(1, dd / W) * 0.6);
        ctl.anim(o.c, [{ transform: "none" }, { transform: `translateY(${f1(-amp)}px) rotate(${f1(rand(-6, 6))}deg)`, offset: 0.3 },
          { transform: "none", offset: 0.6 }, { transform: `translateY(${f1(-amp * 0.2)}px)`, offset: 0.8 }, { transform: "none" }],
        { duration: 560, delay: dd * 0.3, easing: "ease-out" });
      });
      addFx(Array.from({ length: 6 }, () => ({ x: x + rand(-50, 50), y: fl - 6, size: rand(40, 70), kind: "smoke", blur: 6, o: 0.5,
        bg: "radial-gradient(circle, rgba(168,162,158,.85), rgba(168,162,158,0) 70%)", dx: rand(-80, 80), dy: rand(-60, -20), dur: 1.4 })), 1600);
      if (n === 2 || n === 4 || n === 6) {
        const d = dsc();
        const cand = list.filter(o => !isCrushed.has(o) && o.y - d > 110 && o.y - d < fl - 40 && o.w < W * 0.8);
        const tg = cand.length ? pick(cand) : null;
        if (!tg) return;
        const group = [tg, ...cand.filter(o => o !== tg && Math.hypot(o.x - tg.x, o.y - tg.y) < 80).slice(0, 3)];
        const fw = clamp(Math.max(tg.w, 90) * 1.1, 90, 200);
        setFoot({ id: n, x: tg.x, y: tg.t - d + tg.h - fw * 1.6 + 6, w: fw });
        ctl.after(360, () => {
          group.forEach(o => {
            isCrushed.add(o); crushed.push(o);
            ctl.set(o.c, { "transform-origin": "50% 100%" });
            ctl.anim(o.c, [{ transform: "none" }, { transform: "scale(1.35,.12)" }], { duration: 140, easing: "ease-in", fill: "forwards" });
          });
          parts.forEach(p => ctl.anim(p, jitterKf(16, 10, 1), { duration: 420, easing: "linear" }));
          addFx([{ x: tg.x, y: tg.y - dsc() - 40, text: pick(["SPLATCH !", "CRONCH !", "SCROUNCH !"]), color: "#f8fafc", fs: 26, kind: "pop", r: rand(-10, 10), dur: 1.2 }], 1400);
        });
        ctl.after(1200, () => setFoot(f => (f && f.id === n ? null : f)));
      }
    };
    ctl.loop(t => {
      const u = clamp(t / DUR, 0, 1);
      const x = lerp(-geo.w, W + 20, u);
      const bob = -Math.abs(Math.sin(Math.PI * t / P)) * 16;
      if (mon.current) mon.current.style.transform = `translate(${f1(x)}px,${f1(bob)}px) rotate(${(Math.sin(Math.PI * t / P) * 2).toFixed(2)}deg)`;
      const n = Math.floor(t / P);
      if (n > step) { step = n; if (u < 0.97) stomp(n); }
      return u < 1;
    });
    ctl.after(10400, () => {
      setPh(1);
      crushed.forEach((o, i) => ctl.after(i * 180, () => {
        ctl.anim(o.c, [{ transform: "scale(1.35,.12)" }, { transform: "scale(.85,1.25)", offset: 0.55 }, { transform: "scale(1.06,.94)", offset: 0.8 }, { transform: "none" }],
          { duration: 900, easing: "ease-out", fill: "forwards" });
        addFx([{ x: o.x, y: o.y - dsc() - 20, text: pick(["pfff !", "POUF !", "pfuit !"]), color: "#fde047", fs: 18, kind: "pop", r: rand(-10, 10), dur: 1 }], 1200);
      }));
    });
    ctl.after(12600, () => { setPh(2); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={KAIJU_CSS}>
      <div ref={mon} aria-hidden="true" style={{ position: "absolute", left: 0, top: floorY() - geo.h + 8, transformOrigin: "50% 100%",
        transform: `translate(${-geo.w - 50}px,0)` }}>
        <KaijuSvg h={geo.h} light={geo.light}/>
      </div>
      {foot && (
        <div key={foot.id} aria-hidden="true" style={{ position: "absolute", left: foot.x, top: foot.y, width: foot.w,
          animation: "pk-kaiju-foot 1.15s cubic-bezier(.4,0,.6,1) both", filter: "drop-shadow(0 10px 14px rgba(0,0,0,.45))" }}>
          <FootSvg w={foot.w}/>
        </div>
      )}
      <Fx fx={fx} slug="kaiju"/>
      {ph === 0 && <Pill key="a">🦖 Alerte kaiju ! Il traverse l'atelier… attention où il met les pieds.</Pill>}
      {ph === 1 && <Pill key="b">On regonfle à la pompe à vélo… pfff, pfff !</Pill>}
      {ph === 2 && <Pill key="c" fade>Le kaiju est reparti. Tout est regonflé, comme neuf.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 9. Kraken
// ════════════════════════════════════════════════════════════════════════════
const KRAKEN_CSS = FX_CSS("kraken") + `
@keyframes pk-kraken-sea { from { transform: translateX(0) } to { transform: translateX(-50%) } }
@keyframes pk-kraken-in { from { transform: translateY(100%) } to { transform: translateY(0) } }
`;
// Contour effile d'un tentacule (courbe de Bezier quadratique) et ses ventouses.
function tentacle(bx, by, cx, cy, tx, ty, w0) {
  const L = [], R = [], S = [];
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const u = i / n, v = 1 - u;
    const x = v * v * bx + 2 * v * u * cx + u * u * tx, y = v * v * by + 2 * v * u * cy + u * u * ty;
    const dx = 2 * v * (cx - bx) + 2 * u * (tx - cx), dy = 2 * v * (cy - by) + 2 * u * (ty - cy);
    const l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    const w = lerp(w0, 3.5, u);
    L.push([x + nx * w, y + ny * w]); R.push([x - nx * w, y - ny * w]);
    if (i % 2 === 0 && i > 1 && i < n - 1) S.push([x + nx * w * 0.42, y + ny * w * 0.42, Math.max(1.6, w * 0.3)]);
  }
  const body = "M" + L.map(p => f1(p[0]) + " " + f1(p[1])).join(" L") + " L" + R.reverse().map(p => f1(p[0]) + " " + f1(p[1])).join(" L") + " Z";
  const suck = S.map(([x, y, r]) => `M${f1(x - r)} ${f1(y)} a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0 a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`).join(" ");
  return [body, suck];
}
function Kraken({ done }) {
  const s = useStage(done);
  const bodies = useRef([]), suckers = useRef([]);
  const [ph, setPh] = useState(0); // 0 attaque, 1 repart, 2 fin
  const [fx, addFx] = useFx(s.ctl);
  const NT = useMemo(() => (isNarrow() ? 4 : 6), []);
  useEffect(() => {
    const { ctl } = s;
    const { list, dsc } = grab(ctl, 120);
    const W = vw(), H = vh(), fl = floorY();
    const baseY = H + 30;
    const used = new Set();
    const cands = list.filter(o => o.y > 80 && o.y < fl - 50);
    const choose = bx => {
      const free = cands.filter(o => !used.has(o));
      if (!free.length) return null;
      free.sort((a, b) => Math.abs(a.x - bx) - Math.abs(b.x - bx));
      const o = free[Math.floor(rand(0, Math.min(4, free.length)))];
      used.add(o);
      return o;
    };
    const T = Array.from({ length: NT }, (_, k) => {
      const bx = W * (k + 0.5) / NT + rand(-20, 20);
      const s1 = 0.3 + k * 0.35, grabs = [];
      const o1 = choose(bx); if (o1) grabs.push({ s: s1, o: o1 });
      const o2 = choose(bx); if (o2 && s1 + 4.7 < 6.6) grabs.push({ s: s1 + 4.7, o: o2 });
      return { bx, k, grabs, w0: isNarrow() ? 15 : 19 };
    });
    // les autres tremblent de peur (les attrapes sont menes a la main)
    list.forEach(o => { if (!used.has(o)) ctl.anim(o.c, jitterKf(2.2, 70, 1.2), { duration: 9800, easing: "linear" }); });
    ctl.loop(t => {
      const d = dsc();
      T.forEach(tn => {
        const g = tn.grabs.find(q => t >= q.s && t < q.s + 4.5);
        const body = bodies.current[tn.k], suck = suckers.current[tn.k];
        if (!g) { if (body) body.setAttribute("d", ""); if (suck) suck.setAttribute("d", ""); return; }
        const r = t - g.s, o = g.o;
        const hx = o.x, hy = o.y - d;
        let ox = 0, oy = 0, rot = 0, reach = 1;
        if (r < 0.9) reach = easeInOut(r / 0.9);
        else if (r < 3.4) {
          const q = r - 0.9;
          if (!g.grabbed) { g.grabbed = true; addFx([{ x: hx, y: hy - 20, text: pick(["SLURP !", "CHLAC !", "GLOMP !"]), color: "#f9a8d4", fs: 20, kind: "pop", r: rand(-10, 10), dur: 1.1 }], 1300); }
          const tug = Math.max(0, Math.sin(q * 2.4)) * 70;
          ox = Math.sin(q * 23) * 13 * (1 - q / 5); oy = Math.sin(q * 17) * 7 + tug; rot = Math.sin(q * 19) * 10;
          g.last = [ox, oy, rot];
        } else {
          const q = r - 3.4;
          const [lx, ly, lr] = g.last || [0, 0, 0];
          const damp = Math.exp(-5 * q) * Math.cos(14 * q);
          ox = lx * damp; oy = ly * damp; rot = lr * damp;
          reach = 1 - easeInOut(clamp(q / 1, 0, 1));
          if (q > 0.8 && !g.freed) { g.freed = true; ctl.unset(o.c, ["transform"]); }
        }
        if (r >= 0.9 && !g.freed) ctl.set(o.c, { transform: `translate(${f1(ox)}px,${f1(oy)}px) rotate(${f1(rot)}deg)` });
        const ex = hx + ox, ey = hy + oy;
        const tx = lerp(tn.bx, ex, reach), ty = lerp(baseY, ey, reach);
        const cx = (tn.bx + tx) / 2 + Math.sin(t * 2 + tn.k) * 70 * reach, cy = (baseY + ty) / 2 + 60;
        const [b, sk] = tentacle(tn.bx, baseY, cx, cy, tx, ty, tn.w0);
        if (body) body.setAttribute("d", b);
        if (suck) suck.setAttribute("d", sk);
      });
      return t < 10.4;
    });
    ctl.after(9000, () => setPh(1));
    ctl.after(10900, () => { T.forEach(tn => tn.grabs.forEach(g => ctl.unset(g.o.c, ["transform"]))); setPh(2); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sea = (vh() - floorY()) + 34;
  return (
    <Layer s={s} css={KRAKEN_CSS}>
      <svg aria-hidden="true" width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <linearGradient id="pk-kraken-skin" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#831843"/><stop offset=".5" stopColor="#be185d"/><stop offset="1" stopColor="#db2777"/>
          </linearGradient>
        </defs>
        {Array.from({ length: NT }, (_, k) => (
          <g key={k}>
            <path ref={el => { bodies.current[k] = el; }} d="" fill="url(#pk-kraken-skin)" stroke="#500724" strokeWidth="2" strokeLinejoin="round"/>
            <path ref={el => { suckers.current[k] = el; }} d="" fill="#fbcfe8" stroke="#9d174d" strokeWidth="1"/>
          </g>
        ))}
      </svg>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: sea, overflow: "hidden",
        transition: "transform 1s ease", transform: ph >= 1 ? "translateY(100%)" : "none" }}>
        <div style={{ position: "absolute", inset: 0, animation: "pk-kraken-in .8s ease-out both" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: "200%", height: 30, animation: "pk-kraken-sea 2.6s linear infinite" }}>
            <svg width="100%" height="30" viewBox="0 0 1200 40" preserveAspectRatio="none"><path d={WAVE_D} fill="#0e7490"/></svg>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 26, bottom: 0, background: "linear-gradient(180deg, #0e7490, #083344)" }}/>
        </div>
      </div>
      <Fx fx={fx} slug="kraken"/>
      {ph === 0 && <Pill key="a">🐙 Le kraken de la cuve de résine s'est réveillé !</Pill>}
      {ph === 1 && <Pill key="b">Il repart bouder au fond : il n'aime pas le goût du PLA.</Pill>}
      {ph === 2 && <Pill key="c" fade>Tout est relâché, pas une ventouse de travers.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 10. Sables mouvants (geste facultatif : toucher une carte pour la sortir)
// ════════════════════════════════════════════════════════════════════════════
const SABLES_CSS = FX_CSS("sables-mouvants") + `
@keyframes pk-sables-mouvants-in { from { opacity: 0 } to { opacity: 1 } }
`;
function SablesMouvants({ done }) {
  const s = useStage(done);
  const pin = usePin(s.ctl);
  const lips = useRef([]);
  const [ph, setPh] = useState("coule"); // coule, sauve, treuil, fin
  const [hint, setHint] = useState(false);
  const [cnt, setCnt] = useState({ saved: 0, total: 0 });
  const [fx, addFx] = useFx(s.ctl);
  const [marks, setMarks] = useState([]);
  const st = useRef({ list: [], groups: [], mode: "coule", taps: 0, dsc: () => 0 });
  useEffect(() => {
    const { ctl } = s;
    const { list, tiles, sc0, dsc } = grab(ctl, 120);
    const main = ctl.main();
    if (main) {
      ctl.set(main, { "background-image": "radial-gradient(rgba(120,83,30,.35) 1px, transparent 1.6px), linear-gradient(rgba(214,170,98,.55), rgba(194,143,64,.6))",
        "background-size": "7px 7px, auto" });
    }
    const S = st.current;
    S.dsc = dsc;
    S.list = list.map((o, i) => ({ ...o, i, f: 0, t0: rand(0.6, 4.5), saved: false, sp: rand(0.7, 1.3), wob: rand(0, 6), dirty: false }));
    S.groups = tiles.map(t => ({ t, items: S.list.filter(o => o.tile === t) })).filter(g => g.items.length);
    setMarks(S.list.map(o => ({ i: o.i, x: o.l - 6, y: o.t + o.h + sc0 - 6, w: o.w + 12 })));
    setCnt({ saved: 0, total: S.groups.length });
    let endAt = 0, lastBub = 0;
    ctl.loop((t, dt) => {
      let allOut = true;
      S.list.forEach(o => {
        if (S.mode !== "coule" || o.saved) o.f = Math.max(0, o.f - dt * 1.7);
        else if (t > o.t0) o.f = Math.min(0.86, o.f + dt / 13 * o.sp);
        if (o.f > 0.001) {
          allOut = false;
          const px = o.f * o.h;
          const wob = Math.sin(t * 2.3 + o.wob) * Math.min(1, o.f * 4);
          ctl.set(o.c, { transform: `translateY(${f1(px)}px) rotate(${wob.toFixed(2)}deg)`, "clip-path": `inset(0px 0px ${f1(px)}px 0px)` });
          o.dirty = true;
        } else if (o.dirty) { o.dirty = false; ctl.unset(o.c, ["transform", "clip-path"]); }
        const lip = lips.current[o.i];
        if (lip) lip.style.opacity = o.f > 0.02 ? "1" : "0";
      });
      if (S.mode === "coule" && t - lastBub > 0.45) {
        lastBub = t;
        const deep = S.list.filter(o => o.f > 0.3 && !o.saved);
        if (deep.length) {
          const o = pick(deep), d = dsc();
          addFx([{ x: o.l + rand(0.1, 0.9) * o.w, y: o.t + o.h - d, size: rand(14, 26), kind: "blob", dur: 0.9,
            bg: "radial-gradient(circle, transparent 45%, rgba(161,98,7,.7) 52%, transparent 66%)" },
          Math.random() < 0.35 ? { x: o.x, y: o.t + o.h - d - 16, text: pick(["glou", "gloup", "à l'aide !", "blub"]), color: "#fef3c7", fs: 13, kind: "pop", r: rand(-8, 8), dur: 1.2 } : null].filter(Boolean), 1400);
        }
      }
      if (S.mode === "coule" && t > 17) { S.mode = "treuil"; setPh("treuil"); }
      if (S.mode !== "coule" && allOut) {
        if (!endAt) endAt = t;
        if (t - endAt > 0.8) {
          if (main) ctl.unset(main, ["background-image", "background-size"]);
          setPh(m => (m === "sauve" ? "fin-geste" : "fin")); s.finish(); return false;
        }
      }
      return true;
    });
    ctl.after(6000, () => { if (!st.current.taps) setHint(true); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const tap = e => {
    const S = st.current;
    if (S.mode !== "coule") return;
    const x = e.clientX, y = e.clientY;
    const g = S.groups.find(q => {
      const r = q.t.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom + 30 && q.items.some(o => !o.saved);
    });
    const d = S.dsc();
    const hits = g ? g.items.filter(o => !o.saved) : S.list.filter(o => !o.saved && Math.hypot(o.x - x, o.y - d - y) < 90);
    if (!hits.length) return;
    S.taps += 1;
    hits.forEach(o => { o.saved = true; });
    const sand = Array.from({ length: 10 }, () => ({ x, y, size: rand(4, 8), bg: pick(["#d6a85e", "#b7791f", "#e9c46a"]), dx: rand(-60, 60), dy: rand(-70, 10), dur: 0.7 }));
    sand.push({ x, y: y - 20, text: pick(["Hop !", "Sauvé !", "Plop !", "Ouf !"]), color: "#fef3c7", fs: 18, kind: "pop", r: rand(-10, 10), dur: 1 });
    addFx(sand, 1200);
    const saved = S.groups.filter(q => q.items.every(o => o.saved)).length;
    setCnt({ saved, total: S.groups.length });
    setHint(false);
    if (saved >= S.groups.length) { S.list.forEach(o => { o.saved = true; }); S.mode = "sauve"; setPh("sauve"); }
  };
  return (
    <Layer s={s} css={SABLES_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "rgba(214,170,98,.12)", animation: "pk-sables-mouvants-in 1s ease both",
        opacity: ph.startsWith("fin") ? 0 : 1, transition: "opacity .8s ease" }}/>
      <div ref={pin} style={pinStyle}>
        {marks.map(m => (
          <span key={m.i} ref={el => { lips.current[m.i] = el; }} aria-hidden="true" style={{ position: "absolute", left: m.x, top: m.y, width: m.w, height: 12,
            borderRadius: "50%", opacity: 0, transition: "opacity .3s ease",
            background: "radial-gradient(ellipse, #c99a52 35%, rgba(201,154,82,.6) 55%, rgba(201,154,82,0) 72%)" }}/>
        ))}
      </div>
      {ph === "coule" && (
        <div aria-label="Sortir une carte du sable" role="button" tabIndex={-1} onPointerDown={tap}
          style={{ position: "absolute", inset: 0, pointerEvents: "auto", touchAction: "manipulation", cursor: "pointer" }}/>
      )}
      <Fx fx={fx} slug="sables-mouvants"/>
      {ph === "coule" && (hint
        ? <Pill key="h">Touche les cartes qui s'enfoncent pour les tirer du sable !</Pill>
        : cnt.saved > 0 ? <Pill key={"n" + cnt.saved}>Sorties du sable : {cnt.saved} sur {cnt.total}. Courage !</Pill>
          : <Pill key="a">🏜️ Sables mouvants ! Tout l'accueil s'enfonce doucement…</Pill>)}
      {ph === "sauve" && <Pill key="s">🦸 Tout le monde est sorti du sable. Héros du désert !</Pill>}
      {ph === "treuil" && <Pill key="t">🪝 Le treuil de secours remonte tout le monde…</Pill>}
      {ph === "fin" && <Pill key="f" fade>Tout est sorti du sable. Secoue tes chaussures avant d'imprimer.</Pill>}
      {ph === "fin-geste" && <Pill key="g" fade>Sauvetage parfait ! Pas un grain de sable dans l'AMS.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 11. Ere glaciaire
// ════════════════════════════════════════════════════════════════════════════
const GLACE_CSS = FX_CSS("ere-glaciaire") + `
@keyframes pk-ere-glaciaire-frost { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes pk-ere-glaciaire-freeze { from { transform: scale(.7); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes pk-ere-glaciaire-melt { 0% { transform: scaleY(1); opacity: 1 } 100% { transform: translateY(20%) scaleY(.12); opacity: 0 } }
@keyframes pk-ere-glaciaire-icicle { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes pk-ere-glaciaire-snow { from { transform: translate(0, -10vh) rotate(0deg) } to { transform: translate(var(--dx), 110vh) rotate(360deg) } }
@keyframes pk-ere-glaciaire-in { from { opacity: 0 } to { opacity: 1 } }
`;
const ICE_BG = "linear-gradient(135deg, rgba(186,230,253,.62), rgba(125,211,252,.28) 42%, rgba(255,255,255,.5) 48%, rgba(125,211,252,.25) 54%, rgba(186,230,253,.45))";
function frostPaths(W, H) {
  const out = [];
  const grow = (x, y, a, len, depth) => {
    if (depth > 3) return;
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    out.push({ d: `M${f1(x)} ${f1(y)} L${f1(x2)} ${f1(y2)}`, w: 2.6 - depth * 0.5, delay: depth * 0.45 + rand(0, 0.25) });
    for (let i = 0; i < 2; i++) grow(x2, y2, a + rand(-0.75, 0.75), len * rand(0.55, 0.75), depth + 1);
  };
  const L = Math.min(W, H) * 0.24;
  [[0, 0, Math.PI / 4], [W, 0, 3 * Math.PI / 4], [0, H, -Math.PI / 4], [W, H, -3 * Math.PI / 4]].forEach(([x, y, a]) => {
    grow(x, y, a - 0.35, L, 0); grow(x, y, a + 0.35, L, 0);
  });
  return out;
}
function EreGlaciaire({ done }) {
  const s = useStage(done);
  const pin = usePin(s.ctl);
  const [ph, setPh] = useState(0); // 0 gel, 1 fissures, 2 degel, 3 fin
  const [blocks, setBlocks] = useState([]);
  const [icicles, setIcicles] = useState([]);
  const [fx, addFx] = useFx(s.ctl);
  const geo = useMemo(() => ({ W: vw(), H: vh() }), []);
  const frost = useMemo(() => frostPaths(geo.W, geo.H), [geo]);
  const snow = useMemo(() => Array.from({ length: isNarrow() ? 24 : 40 }, () => ({ l: rand(0, 100), s: rand(4, 9), d: rand(4, 8), dl: rand(-8, 0), dx: rand(-40, 40) })), []);
  useEffect(() => {
    const { ctl } = s;
    const { list, tiles, sc0, dsc } = grab(ctl, 120);
    const { W, H } = geo;
    const edge = o => Math.min(o.x, W - o.x, o.y, H - o.y);
    const maxE = Math.max(1, ...list.map(edge));
    const step = Math.max(1, Math.ceil(list.length / 70));
    const bl = list.map((o, i) => ({ o, i, delay: 0.3 + (edge(o) / maxE) * 2.4 + rand(0, 0.2) }));
    setBlocks(bl.filter((_, i) => i % step === 0).map(b => {
      const pts = [[rand(0, 30), 0]]; let x = pts[0][0], y = 0;
      while (y < 100) { x = clamp(x + rand(5, 30), 0, 100); y = y + rand(15, 40); pts.push([x, Math.min(100, y)]); }
      return { i: b.i, x: b.o.l - 4, y: b.o.t + sc0 - 4, w: b.o.w + 8, h: b.o.h + 8, delay: b.delay, melt: rand(0, 0.9),
        crack: toD(pts), cd: rand(0, 0.5) };
    }));
    setIcicles(tiles.slice(0, 12).flatMap((t, k) => {
      const r = t.getBoundingClientRect();
      const n = Math.max(3, Math.min(8, Math.floor(r.width / 60)));
      return Array.from({ length: n }, (_, j) => ({ id: `${k}-${j}`, x: r.left + (j + rand(0.2, 0.8)) * r.width / n, y: r.bottom + sc0 - 2,
        w: rand(7, 12), h: rand(14, 34), delay: 1.6 + rand(0, 1.2) }));
    }));
    bl.forEach(b => ctl.after(b.delay * 1000, () => {
      ctl.set(b.o.c, { transition: "filter .6s ease", filter: "saturate(.35) brightness(1.12) hue-rotate(-12deg)" });
      ctl.anim(b.o.c, jitterKf(1.5, 36, 0.8), { duration: Math.max(600, (5.4 - b.delay) * 1000), delay: 300, easing: "linear" });
    }));
    ctl.after(5600, () => {
      setPh(1);
      list.forEach((o, i) => ctl.anim(o.c, jitterKf(5, 8, 2), { duration: 380, delay: i * 4, easing: "linear" }));
      addFx([{ x: W / 2, y: H * 0.4, text: "CRRRAC !", color: "#e0f2fe", fs: 30, kind: "pop", r: -6, dur: 1.2 }], 1400);
    });
    ctl.after(7200, () => {
      setPh(2);
      list.forEach(o => ctl.unset(o.c, ["filter"]));
      const d = dsc();
      addFx(shuffle(list.slice()).slice(0, 46).map(o => ({ x: o.l + rand(0.1, 0.9) * o.w, y: o.t + o.h - d, size: 7, h: 10, round: true,
        bg: "radial-gradient(circle at 40% 35%, #f0f9ff, #7dd3fc 70%)", kind: "drop", dx: 0, dy: rand(80, 220), dur: rand(0.8, 1.3), delay: rand(0, 1.4), ease: "ease-in" })), 3000);
    });
    ctl.after(10600, () => { setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={GLACE_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: ph >= 2 ? 0 : 1, transition: "opacity 2s ease",
        background: "radial-gradient(ellipse at center, rgba(224,242,254,0) 42%, rgba(224,242,254,.5) 78%, rgba(240,249,255,.85))",
        animation: "pk-ere-glaciaire-in 2.6s ease both" }}/>
      <svg aria-hidden="true" width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: ph >= 2 ? 0 : 0.9, transition: "opacity 1.6s ease" }}>
        {frost.map((p, i) => (
          <path key={i} d={p.d} stroke="#f0f9ff" strokeWidth={p.w} strokeLinecap="round" fill="none" pathLength="1" strokeDasharray="1"
            style={{ filter: "drop-shadow(0 0 2px #7dd3fc)", animation: `pk-ere-glaciaire-frost .6s ease-out ${f1(p.delay)}s both` }}/>
        ))}
      </svg>
      {ph < 2 && snow.map((f, i) => (
        <span key={i} aria-hidden="true" style={{ position: "absolute", left: `${f1(f.l)}%`, top: 0, width: f.s, height: f.s, borderRadius: "50%",
          background: "#f8fafc", boxShadow: "0 0 4px #bae6fd", "--dx": `${f1(f.dx)}px`, animation: `pk-ere-glaciaire-snow ${f1(f.d)}s linear ${f1(f.dl)}s infinite` }}/>
      ))}
      <div ref={pin} style={pinStyle}>
        {icicles.map(c => (
          <span key={c.id} aria-hidden="true" style={{ position: "absolute", left: c.x - c.w / 2, top: c.y, width: c.w, height: c.h,
            clipPath: "polygon(0 0, 100% 0, 50% 100%)", background: "linear-gradient(180deg, #f0f9ff, rgba(125,211,252,.55))", transformOrigin: "50% 0",
            animation: ph >= 2 ? "pk-ere-glaciaire-melt 1.4s ease-in .2s both" : `pk-ere-glaciaire-icicle .8s ease-out ${f1(c.delay)}s both` }}/>
        ))}
        {blocks.map(b => (
          <div key={b.i} aria-hidden="true" style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: 6,
            background: ICE_BG, border: "1px solid rgba(255,255,255,.75)", transformOrigin: "50% 100%",
            boxShadow: "inset 0 0 12px rgba(255,255,255,.6), 0 2px 8px rgba(14,165,233,.25)",
            animation: ph >= 2 ? `pk-ere-glaciaire-melt 1.5s ease-in ${f1(b.melt)}s both` : `pk-ere-glaciaire-freeze .5s ease-out ${f1(b.delay)}s both` }}>
            {ph >= 1 && (
              <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
                <path d={b.crack} fill="none" stroke="rgba(255,255,255,.95)" strokeWidth="1.6" vectorEffect="non-scaling-stroke"
                  pathLength="1" strokeDasharray="1" style={{ animation: `pk-ere-glaciaire-frost .35s ease-out ${f1(b.cd)}s both` }}/>
              </svg>
            )}
          </div>
        ))}
      </div>
      {ph >= 2 && ph < 3 && <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 80% 0%, rgba(253,186,116,.3), transparent 60%)", animation: "pk-ere-glaciaire-in 1s ease both" }}/>}
      <Fx fx={fx} slug="ere-glaciaire"/>
      {ph === 0 && <Pill key="a">🥶 Ère glaciaire ! L'atelier vient de passer à −40 °C.</Pill>}
      {ph === 1 && <Pill key="b">Crrrac… la glace se fissure de partout !</Pill>}
      {ph === 2 && <Pill key="c">☀️ Dégel ! Le plateau chauffant est monté à 60 °C.</Pill>}
      {ph === 3 && <Pill key="d" fade>Tout a dégelé. Pense quand même à sécher ton filament.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 12. Pluie acide, puis reimpression couche par couche
// ════════════════════════════════════════════════════════════════════════════
const ACIDE_CSS = FX_CSS("acide") + `
@keyframes pk-acide-rain { from { transform: translateY(-12vh) } to { transform: translateY(112vh) } }
@keyframes pk-acide-cloud { from { transform: translateX(-24px) } to { transform: translateX(24px) } }
@keyframes pk-acide-head { from { left: 0% } to { left: calc(100% - 34px) } }
@keyframes pk-acide-in { from { opacity: 0 } to { opacity: 1 } }
`;
function Acide({ done }) {
  const s = useStage(done);
  const gantry = useRef(null);
  const [ph, setPh] = useState(0); // 0 pluie, 1 fonte, 2 impression, 3 fin
  const [couche, setCouche] = useState(0);
  const [fx, addFx] = useFx(s.ctl);
  const drops = useMemo(() => Array.from({ length: isNarrow() ? 36 : 70 }, () => ({ l: rand(0, 100), d: rand(0.7, 1.2), dl: rand(-2, 0), h: rand(10, 18) })), []);
  useEffect(() => {
    const { ctl } = s;
    const { list, dsc } = grab(ctl, 120);
    const fl = floorY();
    const st = list.map(o => ({ o, holes: [], cut: -1 }));
    const maskOf = p => p.holes.map(h => `radial-gradient(circle at ${f1(h.x)}px ${f1(h.y)}px, transparent ${f1(h.r)}px, #000 ${f1(h.r + 1.5)}px)`).join(", ");
    let lastHole = 0, frame = 0;
    ctl.loop((t, dt) => {
      frame++;
      if (t > 1 && t < 5 && t - lastHole > 0.045 && st.length) {
        lastHole = t;
        const p = pick(st);
        if (p.holes.length < 4) {
          const h = { x: rand(0.1, 0.9) * p.o.w, y: rand(0.1, 0.9) * p.o.h, r: 0, max: clamp(Math.min(p.o.w, p.o.h) * rand(0.25, 0.55), 5, 42) };
          p.holes.push(h);
          const x = p.o.l + h.x, y = p.o.t - dsc() + h.y;
          const items = Array.from({ length: 4 }, () => ({ x: x + rand(-6, 6), y: y + rand(-6, 6), size: rand(4, 9), bg: "rgba(190,242,100,.9)",
            glow: "0 0 8px #a3e635", dx: rand(-14, 14), dy: rand(-40, -16), s: 1.2, dur: 0.8 }));
          if (Math.random() < 0.18) items.push({ x, y: y - 16, text: pick(["pssshh…", "fsss !", "grésille…"]), color: "#d9f99d", fs: 14, kind: "pop", r: rand(-8, 8), dur: 1.1 });
          addFx(items, 1200);
        }
      }
      if (frame % 2 === 0) {
        st.forEach(p => {
          if (!p.holes.length) return;
          let ch = false;
          p.holes.forEach(h => { if (h.r < h.max) { h.r = Math.min(h.max, h.r + dt * 2 * 20); ch = true; } });
          if (ch) {
            const m = maskOf(p);
            ctl.set(p.o.c, { "-webkit-mask-image": m, "mask-image": m, "-webkit-mask-composite": "source-in", "mask-composite": "intersect" });
          }
        });
      }
      return t < 6.4;
    });
    const melts = [];
    ctl.after(4600, () => {
      setPh(1);
      const d = dsc();
      st.forEach(p => {
        const o = p.o;
        ctl.set(o.c, { "transform-origin": "50% 0%" });
        const sk = rand(-9, 9);
        melts.push(ctl.anim(o.c, [
          { transform: "none", opacity: 1 },
          { transform: `translateY(${f1(o.h * 0.2)}px) scaleY(1.3) skewX(${f1(sk)}deg)`, opacity: 0.9, offset: 0.55 },
          { transform: `translateY(${f1(o.h * 0.7)}px) scaleY(.15) skewX(${f1(sk * 1.6)}deg)`, opacity: 0 }],
        { duration: 1500, delay: rand(0, 700), easing: "ease-in", fill: "forwards" }));
      });
      addFx(shuffle(list.slice()).slice(0, 50).map(o => ({ x: o.l + rand(0.1, 0.9) * o.w, y: o.t + o.h - d, size: 7, h: 11, bg: "#a3e635", glow: "0 0 6px #84cc16",
        kind: "drop", dx: 0, dy: rand(120, 300), dur: rand(0.9, 1.4), delay: rand(0.2, 1.8), ease: "ease-in" })), 3600);
    });
    ctl.after(6900, () => {
      setPh(2);
      melts.forEach(a => { try { if (a) a.cancel(); } catch (e) { /* rien */ } });
      st.forEach(p => {
        ctl.unset(p.o.c, ["-webkit-mask-image", "mask-image", "-webkit-mask-composite", "mask-composite", "transform-origin"]);
        ctl.set(p.o.c, { "clip-path": "inset(100% 0px 0px 0px)" });
        p.cut = p.o.h;
      });
      const y0 = fl, y1 = Math.max(40, Math.min(...list.map(o => o.t)) - dsc() - 10);
      let lastC = -1;
      ctl.loop(t => {
        const u = clamp(t / 3.6, 0, 1);
        const y = lerp(y0, y1, u);
        if (gantry.current) gantry.current.style.transform = `translateY(${f1(y)}px)`;
        const d = dsc();
        st.forEach(p => {
          if (p.cut === 0) return;
          const top = p.o.t - d;
          let cut = clamp(y - top, 0, p.o.h);
          cut = Math.ceil(cut / 3) * 3;
          if (u >= 1) cut = 0;
          if (cut >= p.o.h) cut = p.o.h;
          if (cut === p.cut) return;
          p.cut = cut;
          if (cut <= 0) { p.cut = 0; ctl.unset(p.o.c, ["clip-path"]); }
          else ctl.set(p.o.c, { "clip-path": `inset(${f1(cut)}px 0px 0px 0px)` });
        });
        const c = Math.round(u * 240);
        if (c !== lastC && (c - lastC >= 6 || c === 240)) { lastC = c; setCouche(c); }
        return u < 1;
      });
    });
    ctl.after(11000, () => { st.forEach(p => ctl.unset(p.o.c, ["clip-path"])); setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={ACIDE_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, opacity: ph >= 2 ? 0 : 1, transition: "opacity 1s ease",
        background: "linear-gradient(180deg, rgba(54,83,20,.4), rgba(132,204,22,.08) 60%, rgba(132,204,22,0))", animation: "pk-acide-in 1s ease both" }}/>
      <div aria-hidden="true" style={{ position: "absolute", left: -40, right: -40, top: -60, height: 150, opacity: ph >= 2 ? 0 : 1, transition: "opacity 1s ease" }}>
        {[0, 18, 36, 54, 72, 88].map((l, i) => (
          <div key={i} style={{ position: "absolute", left: `${l}%`, top: 0, width: "30%", height: 130, borderRadius: "50%",
            background: "radial-gradient(ellipse at 50% 40%, #4d7c0f, #365314 60%, rgba(54,83,20,0) 72%)", filter: "blur(4px)",
            animation: `pk-acide-cloud ${3 + (i % 3)}s ease-in-out ${-i * 0.6}s infinite alternate` }}/>
        ))}
      </div>
      {ph < 2 && drops.map((d, i) => (
        <span key={i} aria-hidden="true" style={{ position: "absolute", left: `${f1(d.l)}%`, top: 0, width: 4, height: d.h, borderRadius: "40% 40% 50% 50%",
          background: "linear-gradient(180deg, rgba(217,249,157,0), #a3e635)", boxShadow: "0 0 6px #84cc16",
          animation: `pk-acide-rain ${f1(d.d)}s linear ${f1(d.dl)}s infinite` }}/>
      ))}
      {ph === 2 && (
        <div ref={gantry} aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 0, transform: `translateY(${floorY()}px)` }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: -2, height: 4, background: "linear-gradient(90deg, #64748b, #cbd5e1, #64748b)",
            boxShadow: "0 0 12px rgba(163,230,53,.8), 0 0 2px #fff" }}/>
          <div style={{ position: "absolute", left: 0, right: 0, top: 2, height: 3, background: "rgba(163,230,53,.65)", filter: "blur(2px)" }}/>
          <div style={{ position: "absolute", top: -22, width: 34, height: 26, animation: "pk-acide-head .45s ease-in-out infinite alternate" }}>
            <div style={{ width: 34, height: 18, borderRadius: 4, background: "#334155", border: "1px solid #94a3b8" }}/>
            <div style={{ width: 0, height: 0, margin: "0 auto", borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: "8px solid #f97316" }}/>
          </div>
        </div>
      )}
      <Fx fx={fx} slug="acide"/>
      {ph === 0 && <Pill key="a">🧪 Pluie acide ! L'accueil se fait ronger comme un support mal réglé.</Pill>}
      {ph === 1 && <Pill key="b">Ça fond, ça coule… il va falloir tout réimprimer.</Pill>}
      {ph === 2 && <Pill key="c">🖨️ Réimpression de l'accueil… couche {couche} sur 240</Pill>}
      {ph === 3 && <Pill key="d" fade>Réimprimé à 100 %, sans un fil d'ange. Belle première couche !</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Export
// ════════════════════════════════════════════════════════════════════════════
export const PRANKS = {
  "meteorite": { label: "Météorite", Effect: softly(Meteorite, { emoji: "☄️", text: "Une météorite est passée tout près… ouf.", tint: tint("rgba(249,115,22,.28)") }) },
  "dragon-feu": { label: "Dragon", Effect: softly(DragonFeu, { emoji: "🐉", text: "Un dragon est passé au loin, sans rien brûler.", tint: tint("rgba(239,68,68,.25)") }) },
  "incendie": { label: "Incendie", Effect: softly(Incendie, { emoji: "🔥", text: "Petit départ de feu… déjà éteint.", tint: tint("rgba(249,115,22,.28)"), end: "Feu éteint." }) },
  "eruption": { label: "Éruption", Effect: softly(Eruption, { emoji: "🌋", text: "Le volcan de l'atelier gronde, sans plus.", tint: tint("rgba(220,38,38,.25)") }) },
  "orage": { label: "Orage", Effect: softly(Orage, { emoji: "⛈️", text: "Un orage gronde au loin.", tint: tint("rgba(30,41,59,.4)") }) },
  "trou-noir": { label: "Trou noir", Effect: softly(TrouNoir, { emoji: "🕳️", text: "Un tout petit trou noir… vite refermé.", tint: tint("rgba(88,28,135,.3)") }) },
  "enlevement": { label: "Enlèvement", Effect: softly(Enlevement, { emoji: "🛸", text: "Une soucoupe est passée sans s'arrêter.", tint: tint("rgba(163,230,53,.22)") }) },
  "kaiju": { label: "Kaiju", Effect: softly(Kaiju, { emoji: "🦖", text: "Un kaiju passe au loin, sur la pointe des pieds.", tint: tint("rgba(56,189,248,.2)") }) },
  "kraken": { label: "Kraken", Effect: softly(Kraken, { emoji: "🐙", text: "Le kraken fait la sieste au fond de la cuve.", tint: tint("rgba(190,24,93,.22)") }) },
  "sables-mouvants": { label: "Sables mouvants", Effect: softly(SablesMouvants, { emoji: "🏜️", text: "Un peu de sable sur l'accueil… balayé.", tint: tint("rgba(214,170,98,.3)") }) },
  "ere-glaciaire": { label: "Ère glaciaire", Effect: softly(EreGlaciaire, { emoji: "🥶", text: "Petit coup de froid sur l'atelier.", tint: tint("rgba(186,230,253,.35)"), end: "Tout a dégelé." }) },
  "acide": { label: "Pluie acide", Effect: softly(Acide, { emoji: "🧪", text: "Quelques gouttes acides… tout est réimprimé.", tint: tint("rgba(163,230,53,.25)") }) },
};
