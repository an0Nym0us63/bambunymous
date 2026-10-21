import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStage, Layer, Pill, GiveUp, softly, Soft, prefersReduced, rand, pick, tint, FONT, FILAMENTS } from "./pranks";

// Farces a geste (lot 3) : l'accueil est mis en desordre, il faut chercher ou
// agir pour le remettre en etat ; la reussite appelle `done` (une seule fois).
// Sans reussite au bout d'environ 60 s, la farce rend la main d'elle-meme
// (sans `done`) : tout revient en place et le calque devient inerte.
// Comme pour le premier lot, tout ce qui touche au DOM de l'appli passe par le
// controleur `ctl` de useStage (remise en etat exacte au demontage).

// Gardes pour les outils importes que ce lot n'utilise pas directement
void softly; void Soft; void prefersReduced; void tint;

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
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const vw = () => window.innerWidth;
const vh = () => window.innerHeight;
const isNarrow = () => window.innerWidth < 768;
const isCoarse = () => { try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; } };
const wrap180 = a => { let x = ((a + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; };
const capture = e => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch (er) { /* rien */ } };
const LIMIT = 60000;

// Partie a geste : phase play / won / rendu. A l'abandon, `hooks.giveUp`
// remet la page en douceur, puis le controleur restaure tout exactement.
function useGame(s, limit = LIMIT) {
  const [phase, setPhase] = useState("play");
  const ref = useRef("play");
  const hooks = useRef({ giveUp: null });
  const go = useCallback(p => { ref.current = p; setPhase(p); }, []);
  const win = useCallback(() => {
    if (ref.current !== "play") return false;
    go("won");
    s.finish();
    return true;
  }, [go, s.finish]); // eslint-disable-line react-hooks/exhaustive-deps
  const giveUp = useCallback(() => {
    if (ref.current !== "play") return;
    go("rendu");
    try { if (hooks.current.giveUp) hooks.current.giveUp(); } catch (e) { /* rien */ }
    s.ctl.after(1900, () => s.ctl.restore());
  }, [go, s.ctl]);
  useEffect(() => { s.ctl.after(limit, giveUp); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { phase, ref, go, win, giveUp, hooks, play: phase === "play" };
}

// Petits effets ephemeres (eclats, mots) : ajoutes puis retires tout seuls.
function useFx(s) {
  const [fx, setFx] = useState([]);
  const seq = useRef(0);
  const add = useCallback((item, life = 1300) => {
    const id = ++seq.current;
    setFx(l => [...l, { ...item, id }]);
    s.ctl.after(life, () => setFx(l => l.filter(f => f.id !== id)));
  }, [s.ctl]);
  return [fx, add];
}

const fxCss = k => `
@keyframes pk-${k}-burst { 0% { transform: translate(-50%,-50%) translate(0,0) rotate(0deg) scale(1); opacity: 1 }
  100% { transform: translate(-50%,-50%) translate(var(--dx), var(--dy)) rotate(var(--r)) scale(.35); opacity: 0 } }
@keyframes pk-${k}-word { 0% { transform: translate(-50%,-50%) scale(.3) rotate(-8deg); opacity: 0 } 25% { transform: translate(-50%,-50%) scale(1.18) rotate(4deg); opacity: 1 }
  70% { transform: translate(-50%,-65%) scale(1) rotate(0deg); opacity: 1 } 100% { transform: translate(-50%,-95%) scale(1); opacity: 0 } }
@keyframes pk-${k}-shake { 0%, 100% { transform: translateX(0) } 20% { transform: translateX(-9px) } 40% { transform: translateX(8px) } 60% { transform: translateX(-5px) } 80% { transform: translateX(3px) } }
@keyframes pk-${k}-ring { 0% { transform: translate(-50%,-50%) scale(.3); opacity: .9 } 100% { transform: translate(-50%,-50%) scale(1.7); opacity: 0 } }
@keyframes pk-${k}-fall { 0% { transform: translate(0, -10vh) rotate(0deg) } 100% { transform: translate(var(--dx), 115vh) rotate(var(--r)) } }
`;

function Burst({ k, x, y, n = 14, colors = FILAMENTS, dist = 70, size = 8, dur = 0.75 }) {
  const bits = useMemo(() => Array.from({ length: n }, (_, i) => {
    const a = i / n * Math.PI * 2 + rand(-0.3, 0.3), d = dist * rand(0.55, 1.3);
    return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, r: rand(-360, 360), c: colors[i % colors.length], s: size * rand(0.6, 1.3), round: Math.random() < 0.45 };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: x, top: y, width: 0, height: 0, pointerEvents: "none" }}>
      {bits.map((b, i) => (
        <span key={i} style={{ position: "absolute", left: 0, top: 0, width: b.s, height: b.round ? b.s : b.s * 0.5,
          borderRadius: b.round ? "50%" : 2, background: b.c, "--dx": `${b.dx.toFixed(1)}px`, "--dy": `${b.dy.toFixed(1)}px`,
          "--r": `${b.r.toFixed(0)}deg`, animation: `pk-${k}-burst ${dur}s cubic-bezier(.2,.7,.3,1) both` }}/>
      ))}
    </div>
  );
}
function Word({ k, x, y, text, color = "#fde047", size = 30, edge = "#7c2d12" }) {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: x, top: y, fontFamily: FONT, fontWeight: 900, fontSize: size, color,
      WebkitTextStroke: `1.5px ${edge}`, textShadow: `0 3px 0 ${edge}, 0 6px 14px rgba(0,0,0,.35)`, whiteSpace: "nowrap",
      pointerEvents: "none", animation: `pk-${k}-word .9s ease-out both` }}>{text}</div>
  );
}
function FxLayer({ k, fx }) {
  return fx.map(f => (f.text ? <Word key={f.id} k={k} {...f}/> : <Burst key={f.id} k={k} {...f}/>));
}
// Pluie de paillettes (victoire ou explosion de la bombe)
function Glitter({ k, n = 90, colors = FILAMENTS, dur = [2.2, 3.8], spread = 3 }) {
  const bits = useMemo(() => Array.from({ length: n }, (_, i) => ({ left: rand(0, 100), dl: rand(0, spread * 0.4), d: rand(dur[0], dur[1]),
    dx: rand(-70, 70), r: rand(-720, 720), c: colors[i % colors.length], w: rand(5, 10), round: Math.random() < 0.4 })), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {bits.map((b, i) => (
        <span key={i} style={{ position: "absolute", top: 0, left: `${b.left}%`, width: b.w, height: b.round ? b.w : b.w * 0.45,
          borderRadius: b.round ? "50%" : 1, background: b.c, boxShadow: "0 0 4px rgba(255,255,255,.6)", "--dx": `${b.dx.toFixed(0)}px`,
          "--r": `${b.r.toFixed(0)}deg`, animation: `pk-${k}-fall ${b.d.toFixed(2)}s linear ${b.dl.toFixed(2)}s both` }}/>
      ))}
    </div>
  );
}

// Calque transparent qui recoit le geste et protege la page des clics perdus.
function Catcher({ on, cursor, style, children, ...h }) {
  return (
    <div {...h} onContextMenu={e => e.preventDefault()} style={{ position: "absolute", inset: 0, pointerEvents: on ? "auto" : "none",
      touchAction: "none", cursor: cursor || "default", userSelect: "none", WebkitUserSelect: "none", ...style }}>{children}</div>
  );
}

// Zone visible de la page (main), bornee a l'ecran.
function mainBox() {
  const m = document.querySelector("main.page-content");
  const W = vw(), H = vh();
  if (!m) return { left: 0, top: 0, w: W, h: H };
  const r = m.getBoundingClientRect();
  const left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(W, r.right), bottom = Math.min(H, r.bottom);
  return { left, top, w: Math.max(90, right - left), h: Math.max(90, bottom - top) };
}

// Copie visuelle inerte de la page, placee dans `host` (origine ox, oy a l'ecran).
function cloneMain(ctl, host, ox, oy) {
  const main = ctl.main();
  if (!main || !host) return null;
  const mr = main.getBoundingClientRect();
  const clone = main.cloneNode(true);
  clone.querySelectorAll("[data-prank-layer]").forEach(n => n.remove());
  clone.querySelectorAll("[id]").forEach(n => n.removeAttribute("id"));
  clone.querySelectorAll("a,button,input,select,textarea,[tabindex]").forEach(n => n.setAttribute("tabindex", "-1"));
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("inert", "");
  Object.assign(clone.style, { position: "absolute", left: (mr.left - ox) + "px", top: (mr.top - oy) + "px", width: mr.width + "px",
    height: mr.height + "px", margin: "0", overflow: "hidden", pointerEvents: "none", boxSizing: "border-box" });
  host.appendChild(clone);
  clone.scrollTop = main.scrollTop;
  ctl.cleanup(() => { if (clone.parentNode) clone.parentNode.removeChild(clone); });
  return clone;
}

// Cartes visibles et entierement utilisables (rectangles a l'ecran)
function visibleCards(ctl, max = 14, top = 56, bottom = 120) {
  const H = vh(), W = vw();
  return ctl.tiles(30).map(c => ({ c, r: c.getBoundingClientRect() }))
    .filter(o => o.r.width > 40 && o.r.height > 24 && o.r.bottom > top && o.r.top < H - bottom && o.r.right > 0 && o.r.left < W)
    .slice(0, max);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Puzzle
// ════════════════════════════════════════════════════════════════════════════
const PUZZLE_CSS = fxCss("puzzle") + `
@keyframes pk-puzzle-check { 0% { transform: scale(.2); opacity: 0 } 40% { transform: scale(1.2); opacity: 1 } 100% { transform: scale(1); opacity: 0 } }
`;
const ID9 = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const PUZZLE_T = "left .32s cubic-bezier(.2,.8,.3,1), top .32s cubic-bezier(.2,.8,.3,1), transform .32s cubic-bezier(.2,.8,.3,1), width .5s ease, height .5s ease, border-radius .5s ease, box-shadow .25s ease";
function Puzzle({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const box = useMemo(mainBox, []);
  const tw = box.w / 3, th = box.h / 3;
  const [perm, setPerm] = useState(() => {
    const p = ID9.slice();
    for (let k = 0; k < 30; k++) { shuffle(p); if (p.filter((t, i) => t === i).length <= 1) break; }
    return p;
  });
  const permRef = useRef(perm);
  const [ready, setReady] = useState(false);
  const [sel, setSel] = useState(-1);
  const selRef = useRef(-1);
  const [fx, addFx] = useFx(s);
  const tiles = useRef([]), hosts = useRef([]), drag = useRef(null);
  useEffect(() => {
    const { ctl } = s;
    for (let i = 0; i < 9; i++) cloneMain(ctl, hosts.current[i], box.left + (i % 3) * tw, box.top + Math.floor(i / 3) * th);
    ctl.after(550, () => { setReady(true); addFx({ text: "CRAC !", x: box.left + box.w / 2, y: box.top + box.h / 2, size: 40 }); });
    g.hooks.current.giveUp = () => { selRef.current = -1; setSel(-1); permRef.current = ID9.slice(); setPerm(ID9.slice()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = v => { selRef.current = v; setSel(v); };
  const swapSlots = (a, b) => {
    if (a === b || g.ref.current !== "play") return;
    const p = permRef.current.slice();
    const t = p[a]; p[a] = p[b]; p[b] = t;
    permRef.current = p;
    setPerm(p);
    [a, b].forEach(sl => {
      if (p[sl] === sl) addFx({ x: box.left + (sl % 3 + 0.5) * tw, y: box.top + (Math.floor(sl / 3) + 0.5) * th, n: 10, dist: 46, colors: ["#22c55e", "#86efac", "#fff"] });
    });
    if (p.every((x, i) => x === i)) { choose(-1); g.win(); }
  };
  const tap = t => {
    if (g.ref.current !== "play") return;
    const cur = selRef.current;
    if (cur < 0) choose(t);
    else if (cur === t) choose(-1);
    else { choose(-1); swapSlots(permRef.current.indexOf(cur), permRef.current.indexOf(t)); }
  };
  const down = (e, t) => {
    if (g.ref.current !== "play" || !ready) return;
    capture(e);
    drag.current = { t, x0: e.clientX, y0: e.clientY, moved: false };
  };
  const move = (e, t) => {
    const d = drag.current;
    if (!d || d.t !== t) return;
    const el = tiles.current[t];
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, dy) > 8) {
      d.moved = true;
      choose(-1);
      if (el) { el.style.transition = "none"; el.style.zIndex = "5"; }
    }
    if (d.moved && el) el.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(1.04)`;
  };
  const up = (e, t, cancel) => {
    const d = drag.current;
    if (!d || d.t !== t) return;
    drag.current = null;
    const el = tiles.current[t];
    if (!d.moved) { if (!cancel) tap(t); return; }
    if (el) {
      el.style.transition = PUZZLE_T;
      el.style.transform = "";
      s.ctl.after(360, () => { if (el) el.style.zIndex = ""; });
    }
    if (cancel) return;
    const from = permRef.current.indexOf(t);
    const cx = box.left + (from % 3 + 0.5) * tw + (e.clientX - d.x0);
    const cy = box.top + (Math.floor(from / 3) + 0.5) * th + (e.clientY - d.y0);
    const col = clamp(Math.floor((cx - box.left) / tw), 0, 2), row = clamp(Math.floor((cy - box.top) / th), 0, 2);
    swapSlots(from, row * 3 + col);
  };
  const shown = ready ? perm : ID9;
  const loose = ready && g.play;
  const good = perm.filter((t, i) => t === i).length;
  return (
    <Layer s={s} css={PUZZLE_CSS}>
      <div style={{ position: "absolute", left: box.left, top: box.top, width: box.w, height: box.h,
        background: loose ? "color-mix(in srgb, var(--bg, #0f1117) 80%, #000)" : "transparent", transition: "background .4s ease",
        pointerEvents: g.play ? "auto" : "none", touchAction: "none",
        animation: g.play ? "none" : "pk-kit-fade .7s ease .75s both" }}>
        {ID9.map(t => {
          const sl = shown.indexOf(t);
          const gap = loose ? 3 : 0;
          const ok = ready && sl === t;
          return (
            <div key={t} ref={el => { tiles.current[t] = el; }} role="button" tabIndex={g.play ? 0 : -1} aria-label={`Pièce ${t + 1}`}
              onPointerDown={e => down(e, t)} onPointerMove={e => move(e, t)} onPointerUp={e => up(e, t)} onPointerCancel={e => up(e, t, true)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(t); } }}
              style={{ position: "absolute", left: (sl % 3) * tw + gap, top: Math.floor(sl / 3) * th + gap, width: tw - 2 * gap, height: th - 2 * gap,
                overflow: "hidden", borderRadius: loose ? 8 : 0, cursor: g.play ? "grab" : "default", touchAction: "none", outline: "none",
                transition: PUZZLE_T, background: "var(--bg, #0f1117)",
                boxShadow: !loose ? "none" : sel === t ? "0 0 0 3px #a855f7, 0 12px 26px rgba(0,0,0,.5)"
                  : ok ? "0 0 0 2px rgba(34,197,94,.8), 0 4px 12px rgba(0,0,0,.35)" : "0 0 0 1px rgba(255,255,255,.2), 0 4px 12px rgba(0,0,0,.4)" }}>
              <div ref={el => { hosts.current[t] = el; }} style={{ position: "absolute", left: -gap, top: -gap, width: tw, height: th,
                transition: "left .5s ease, top .5s ease" }}/>
            </div>
          );
        })}
      </div>
      <FxLayer k="puzzle" fx={fx}/>
      {g.play && <Pill key="a">🧩 Le slicer a découpé ton accueil en 9 morceaux ! Recolle-les (glisse ou touche deux pièces) : {ready ? good : 0}/9</Pill>}
      {g.phase === "won" && <Pill key="b" fade>Recollé sans une trace de colle. Même pas de couture visible !</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Rideau
// ════════════════════════════════════════════════════════════════════════════
const RIDEAU_CSS = fxCss("rideau") + `
@keyframes pk-rideau-close { from { transform: scaleX(.08) } to { transform: scaleX(1) } }
@keyframes pk-rideau-sway { 0%, 100% { transform: rotate(-1.6deg) } 50% { transform: rotate(1.6deg) } }
@keyframes pk-rideau-clap { 0% { transform: translateY(40px) scale(.4); opacity: 0 } 25% { opacity: 1; transform: translateY(0) scale(1.15) } 100% { transform: translateY(-90px) scale(1); opacity: 0 } }
@keyframes pk-rideau-down { 0%, 100% { transform: translateY(0); opacity: .9 } 50% { transform: translateY(8px); opacity: .4 } }
`;
const VELVET = "repeating-linear-gradient(90deg, rgba(0,0,0,.4) 0px, rgba(255,255,255,.08) 21px, rgba(0,0,0,.4) 44px), linear-gradient(180deg, #c2410c -40%, #b91c1c 8%, #7f1d1d 60%, #450a0a)";
function Rideau({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const [pull, setPull] = useState(0);
  const [held, setHeld] = useState(false);
  const [hint, setHint] = useState(false);
  const claps = useMemo(() => Array.from({ length: 7 }, (_, i) => ({ x: 8 + i * 14 + rand(-4, 4), dl: rand(0, 0.8) })), []);
  const d = useRef(null);
  const TH = isNarrow() ? 120 : 150;
  const ropeX = vw() - (isNarrow() ? 44 : 72);
  const ropeLen = Math.round(vh() * 0.4);
  useEffect(() => { g.hooks.current.giveUp = () => setPull(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const open = () => { d.current = null; setHeld(false); if (g.win()) setPull(0); };
  const down = e => {
    if (g.ref.current !== "play") return;
    e.preventDefault();
    capture(e);
    d.current = { y0: e.clientY, max: 0 };
    setHeld(true);
  };
  const move = e => {
    if (!d.current) return;
    const raw = e.clientY - d.current.y0;
    d.current.max = Math.max(d.current.max, Math.abs(raw));
    const p = clamp(raw, 0, TH * 1.2);
    setPull(p);
    if (p >= TH) open();
  };
  const up = () => {
    if (!d.current) return;
    if (d.current.max < 8) setHint(true);
    d.current = null;
    setHeld(false);
    setPull(0);
  };
  const closed = g.play;
  const half = side => ({ position: "absolute", top: 0, bottom: 0, [side]: 0, width: "51%", background: VELVET,
    transformOrigin: side === "left" ? "0 50%" : "100% 50%",
    boxShadow: side === "left" ? "inset -18px 0 30px rgba(0,0,0,.45)" : "inset 18px 0 30px rgba(0,0,0,.45)",
    animation: "pk-rideau-close 1.3s cubic-bezier(.3,.75,.3,1) backwards",
    transform: closed ? `translateX(${(side === "left" ? 1 : -1) * pull * 0.03}px)` : "scaleX(.07)",
    opacity: closed ? 1 : 0, transition: "transform 1.5s cubic-bezier(.6,0,.25,1), opacity .6s ease 1.3s" });
  return (
    <Layer s={s} css={RIDEAU_CSS}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: closed ? "auto" : "none" }}>
        <div style={half("left")}/>
        <div style={half("right")}/>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 3, marginLeft: -1.5, background: "rgba(0,0,0,.5)",
          opacity: closed ? 1 : 0, transition: "opacity .3s" }}/>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 64, background: VELVET,
        boxShadow: "0 6px 14px rgba(0,0,0,.45)", opacity: closed ? 1 : 0, transition: "opacity .8s ease 1.2s",
        WebkitMaskImage: "radial-gradient(circle at 50% 0, #000 52px, transparent 53px) 0 0 / 70px 100%, linear-gradient(#000, #000) 0 0 / 100% 40px no-repeat",
        maskImage: "radial-gradient(circle at 50% 0, #000 52px, transparent 53px) 0 0 / 70px 100%, linear-gradient(#000, #000) 0 0 / 100% 40px no-repeat" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 34, height: 5, background: "linear-gradient(90deg, #a16207, #fde047, #a16207)" }}/>
      </div>
      <div style={{ position: "absolute", left: ropeX - 30, top: 30, width: 60, transformOrigin: "30px 0",
        animation: held || !closed || s.reduced ? "none" : "pk-rideau-sway 2.6s ease-in-out infinite",
        opacity: closed ? 1 : 0, transition: "opacity .5s ease" }}>
        <div style={{ position: "absolute", left: 27, top: 0, width: 6, height: ropeLen + pull, borderRadius: 3,
          background: "repeating-linear-gradient(35deg, #fde047 0 4px, #a16207 4px 8px)", boxShadow: "1px 0 2px rgba(0,0,0,.4)",
          transition: held ? "none" : "height .5s cubic-bezier(.3,1.6,.5,1)" }}/>
        <button aria-label="Cordon du rideau" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onKeyDown={e => { if (["Enter", " ", "ArrowDown"].includes(e.key)) { e.preventDefault(); open(); } }}
          style={{ position: "absolute", left: 0, top: ropeLen + pull - 8, width: 60, height: 90, padding: 0, border: "none",
            background: "transparent", cursor: held ? "grabbing" : "grab", touchAction: "none", pointerEvents: closed ? "auto" : "none",
            transition: held ? "none" : "top .5s cubic-bezier(.3,1.6,.5,1)" }}>
          <svg width="60" height="90" viewBox="0 0 60 90" aria-hidden="true" style={{ display: "block", filter: "drop-shadow(0 4px 6px rgba(0,0,0,.5))" }}>
            <defs>
              <linearGradient id="pk-rideau-gold" x1="0" x2="1">
                <stop offset="0" stopColor="#a16207"/><stop offset=".45" stopColor="#fde047"/><stop offset="1" stopColor="#a16207"/>
              </linearGradient>
            </defs>
            <circle cx="30" cy="12" r="8" fill="url(#pk-rideau-gold)"/>
            <path d="M22 18 Q30 14 38 18 L44 48 Q30 54 16 48 Z" fill="url(#pk-rideau-gold)"/>
            {Array.from({ length: 9 }, (_, i) => (
              <line key={i} x1={17 + i * 3.3} y1="48" x2={15 + i * 3.8} y2={80 + (i % 2) * 4} stroke={i % 2 ? "#ca8a04" : "#fde047"} strokeWidth="2.2" strokeLinecap="round"/>
            ))}
          </svg>
        </button>
        {closed && !held && (
          <div aria-hidden="true" style={{ position: "absolute", left: 22, top: ropeLen + 92, fontSize: 16, color: "#fde047",
            animation: "pk-rideau-down 1.4s ease-in-out infinite", opacity: hint ? 1 : 0, transition: "opacity .4s" }}>▼</div>
        )}
      </div>
      {g.phase === "won" && claps.map((c, i) => (
        <span key={i} aria-hidden="true" style={{ position: "absolute", left: `${c.x}%`, bottom: "22%", fontSize: 30,
          animation: `pk-rideau-clap 1.5s ease-out ${c.dl.toFixed(2)}s both` }}>👏</span>
      ))}
      {closed && (pull > 10 ? <Pill key="p">Encore… encore un peu…</Pill>
        : hint ? <Pill key="h">Un cordon, ça se tire ! Vers le bas, franchement.</Pill>
          : <Pill key="a">🎭 Entracte ! Le spectacle reprendra quand quelqu'un tirera le cordon.</Pill>)}
      {g.phase === "won" && <Pill key="b" fade>Lever de rideau ! Et maintenant, la star : ton plateau.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Cadenas
// ════════════════════════════════════════════════════════════════════════════
const CADENAS_CSS = fxCss("cadenas") + `
@keyframes pk-cadenas-drop { 0% { transform: translateY(0) rotate(0deg); opacity: 1 } 100% { transform: translateY(70vh) rotate(28deg); opacity: 0 } }
@keyframes pk-cadenas-chain { 0% { opacity: 1; transform: var(--t) } 100% { opacity: 0; transform: var(--t) translateY(60vh) } }
@keyframes pk-cadenas-glint { 0%, 100% { transform: translate(-50%,-50%) scale(0) rotate(0deg); opacity: 0 } 50% { transform: translate(-50%,-50%) scale(1) rotate(90deg); opacity: 1 } }
@keyframes pk-cadenas-in { from { transform: scale(1.6); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes pk-cadenas-key { 0% { transform: translate(-50%,-50%) scale(.2) rotate(var(--r)); opacity: 0 } 60% { transform: translate(-50%,-50%) scale(1.25) rotate(var(--r)); opacity: 1 } 100% { transform: translate(-50%,-50%) scale(1) rotate(var(--r)); opacity: 1 } }
`;
const CHAIN_BG = "radial-gradient(ellipse 10px 6px at 50% 50%, transparent 55%, #e2e8f0 60%, #64748b 82%, transparent 88%) 0 0 / 22px 24px, radial-gradient(ellipse 3px 9px at 0 50%, transparent 40%, #94a3b8 50%, #475569 80%, transparent 90%) 0 0 / 22px 24px";
function KeySvg({ color = "#facc15", w = 64 }) {
  return (
    <svg width={w} height={w * 0.44} viewBox="0 0 64 28" aria-hidden="true" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.5))" }}>
      <circle cx="12" cy="14" r="10" fill={color} stroke="rgba(0,0,0,.35)" strokeWidth="1.2"/>
      <circle cx="10" cy="14" r="3.6" fill="rgba(0,0,0,.45)"/>
      <rect x="20" y="11" width="40" height="6" rx="2" fill={color} stroke="rgba(0,0,0,.35)" strokeWidth="1"/>
      <path d="M46 17 v6 h4 v-3 h3 v5 h4 v-8" fill={color} stroke="rgba(0,0,0,.35)" strokeWidth="1"/>
      <ellipse cx="9" cy="10" rx="3.5" ry="1.6" fill="rgba(255,255,255,.55)"/>
    </svg>
  );
}
function Cadenas({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const lock = useMemo(() => ({ x: vw() / 2, y: Math.round(vh() * 0.42) }), []);
  const [spot, setSpot] = useState(null);
  const [key, setKey] = useState(null);
  const [held, setHeld] = useState(false);
  const [msg, setMsg] = useState(0);
  const [glint, setGlint] = useState(0);
  const [fresh, setFresh] = useState(false);
  const shownRef = useRef(false);
  const [fx, addFx] = useFx(s);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh();
    const spots = [];
    visibleCards(ctl, 20, 70, 150).forEach(({ c, r }) => {
      [[r.left + 24, r.top + 20], [r.right - 24, r.top + 20], [r.left + 24, r.bottom - 18], [r.right - 24, r.bottom - 18]].forEach(([x, y]) => {
        if (x > 34 && x < W - 34 && y > 74 && y < H - 150 && Math.hypot(x - lock.x, y - lock.y) > 180) spots.push({ x, y, c });
      });
    });
    let sp = spots.length ? pick(spots) : null;
    for (let k = 0; !sp && k < 40; k++) {
      const p = { x: rand(0.12, 0.88) * W, y: rand(0.18, 0.75) * H, c: null };
      if (Math.hypot(p.x - lock.x, p.y - lock.y) > 180 || k === 39) sp = p;
    }
    sp.rot = rand(-40, 40);
    setSpot(sp);
    const reveal = e => {
      if (shownRef.current || g.ref.current !== "play") return;
      const R = e.pointerType === "mouse" ? 66 : 60;
      if (Math.hypot(e.clientX - sp.x, e.clientY - sp.y) < R) {
        shownRef.current = true;
        setKey({ x: sp.x, y: sp.y });
        setMsg(1);
        setFresh(true);
        ctl.after(650, () => setFresh(false));
        addFx({ x: sp.x, y: sp.y, n: 10, dist: 40, colors: ["#fde047", "#fff", "#facc15"] });
      }
    };
    ctl.on(window, "pointermove", reveal, { passive: true });
    ctl.on(window, "pointerdown", reveal, { passive: true });
    const jingle = () => {
      if (shownRef.current || g.ref.current !== "play") return;
      if (sp.c) ctl.anim(sp.c, [{ transform: "rotate(0deg)" }, { transform: "rotate(-1.2deg)" }, { transform: "rotate(1.1deg)" },
        { transform: "rotate(-.6deg)" }, { transform: "rotate(0deg)" }], { duration: 650, easing: "ease-in-out" });
      setGlint(n => n + 1);
      setMsg(m => (m === 0 ? 2 : m));
      ctl.after(5000, jingle);
    };
    ctl.after(20000, jingle);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const down = e => { if (g.ref.current !== "play") return; e.stopPropagation(); capture(e); setHeld(true); };
  const move = e => { if (held) setKey({ x: e.clientX, y: e.clientY }); };
  const up = e => {
    if (!held) return;
    setHeld(false);
    if (Math.hypot(e.clientX - lock.x, e.clientY - lock.y) < 80) {
      setKey({ x: lock.x, y: lock.y });
      if (g.win()) addFx({ text: "CLIC !", x: lock.x, y: lock.y - 90, size: 34 });
    } else setKey({ x: e.clientX, y: e.clientY });
  };
  const won = g.phase === "won", over = !g.play;
  return (
    <Layer s={s} css={CADENAS_CSS}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(2,6,23,.42)", pointerEvents: g.play ? "auto" : "none",
        opacity: over ? 0 : 1, transition: "opacity .8s ease .7s", animation: "pk-kit-fadein .5s ease both" }}/>
      {[28, -28].map((a, i) => (
        <div key={i} aria-hidden="true" style={{ position: "absolute", left: lock.x, top: lock.y, width: "160vmax", height: 24,
          marginLeft: "-80vmax", marginTop: -12, background: CHAIN_BG, filter: "drop-shadow(0 3px 4px rgba(0,0,0,.5))",
          "--t": `rotate(${a}deg)`, transform: `rotate(${a}deg)`,
          animation: over ? `pk-cadenas-chain .9s cubic-bezier(.5,0,.8,.4) ${(0.35 + i * 0.1).toFixed(2)}s both` : "pk-kit-fadein .6s ease both" }}/>
      ))}
      <div aria-hidden="true" style={{ position: "absolute", left: lock.x, top: lock.y, width: 0, height: 0,
        animation: over ? "pk-cadenas-drop 1s cubic-bezier(.5,0,.8,.4) .55s both" : "none" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, animation: "pk-cadenas-in .55s cubic-bezier(.2,1.4,.4,1) both" }}>
          <svg width="150" height="190" viewBox="0 0 150 190" style={{ position: "absolute", left: -75, top: -125, overflow: "visible",
            filter: "drop-shadow(0 12px 18px rgba(0,0,0,.55))" }}>
            <defs>
              <linearGradient id="pk-cadenas-body" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#fde68a"/><stop offset=".5" stopColor="#eab308"/><stop offset="1" stopColor="#854d0e"/>
              </linearGradient>
            </defs>
            <path d="M38 88 V56 a37 37 0 0 1 74 0 V88" fill="none" stroke="#94a3b8" strokeWidth="15" strokeLinecap="round"
              style={{ transform: won ? "translateY(-24px)" : "none", transition: "transform .35s cubic-bezier(.3,1.6,.5,1)" }}/>
            <path d="M38 88 V56 a37 37 0 0 1 74 0 V88" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="4" strokeLinecap="round"
              style={{ transform: won ? "translateY(-24px) translateX(-3px)" : "translateX(-3px)", transition: "transform .35s cubic-bezier(.3,1.6,.5,1)" }}/>
            <rect x="15" y="80" width="120" height="102" rx="18" fill="url(#pk-cadenas-body)" stroke="#713f12" strokeWidth="2"/>
            <rect x="24" y="88" width="20" height="86" rx="9" fill="rgba(255,255,255,.22)"/>
            <circle cx="75" cy="125" r="12" fill="#1f2937"/>
            <rect x="69" y="127" width="12" height="28" rx="4" fill="#1f2937"/>
          </svg>
        </div>
      </div>
      {spot && glint > 0 && !key && (
        <span key={glint} aria-hidden="true" style={{ position: "absolute", left: spot.x + 10, top: spot.y - 8, fontSize: 18,
          animation: "pk-cadenas-glint 1.1s ease-in-out both" }}>✨</span>
      )}
      {key && (
        <div role="button" aria-label="Clé" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ position: "absolute", left: key.x, top: key.y, width: 76, height: 56, display: "flex", alignItems: "center",
            justifyContent: "center", "--r": `${won ? 90 : held ? -10 : spot.rot}deg`, cursor: held ? "grabbing" : "grab",
            transform: `translate(-50%,-50%) rotate(${won ? 90 : held ? -10 : spot.rot}deg) scale(${held ? 1.12 : 1})`,
            pointerEvents: g.play ? "auto" : "none", touchAction: "none", zIndex: 3,
            transition: held ? "transform .15s ease" : "transform .35s ease, left .3s ease, top .3s ease, opacity .4s ease .6s",
            opacity: over ? 0 : 1, animation: fresh && !held && !over ? "pk-cadenas-key .5s cubic-bezier(.2,1.4,.4,1) both" : "none" }}>
          <KeySvg/>
        </div>
      )}
      <FxLayer k="cadenas" fx={fx}/>
      {g.play && (msg === 1 ? <Pill key="k">🔑 Une clé ! Glisse-la jusqu'au cadenas.</Pill>
        : msg === 2 ? <Pill key="j">Quelque chose tinte du côté des cartes… cherche dans les coins.</Pill>
          : <Pill key="a">🔒 Accueil sous clé ! La clé traîne forcément quelque part sur la page…</Pill>)}
      {won && <Pill key="b" fade>Clic ! Déverrouillé. La clé retourne sous le paillasson… euh, la carte.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Ballons
// ════════════════════════════════════════════════════════════════════════════
const BALLONS_CSS = fxCss("ballons");
function Balloon({ c }) {
  return (
    <svg width="52" height="70" viewBox="0 0 52 70" aria-hidden="true" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 6px 8px rgba(0,0,0,.3))" }}>
      <path d="M26 2 C 44 2, 50 18, 49 28 C 47 44, 34 56, 26 58 C 18 56, 5 44, 3 28 C 2 18, 8 2, 26 2 Z" fill={c}/>
      <path d="M26 58 l-4 6 h8 Z" fill={c}/>
      <ellipse cx="16" cy="18" rx="5" ry="9" fill="rgba(255,255,255,.4)" transform="rotate(25 16 18)"/>
    </svg>
  );
}
function Ballons({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [landed, setLanded] = useState(0);
  const [fx, addFx] = useFx(s);
  const bRefs = useRef({}), sRefs = useRef({});
  const st = useRef([]), balRef = useRef([]), clock = useRef(0);
  useEffect(() => {
    const { ctl } = s;
    const cards = visibleCards(ctl, 6, 40, 90);
    let id = 0;
    const bal = [];
    st.current = cards.map(({ c, r }, i) => {
      const nb = r.width > 320 ? 2 : 1;
      for (let k = 0; k < nb; k++) bal.push({ id: ++id, card: i, k, nb, c: FILAMENTS[(i * 2 + k) % FILAMENTS.length], x: -200, y: -200 });
      return { c, lift: Math.min(-36, 110 + rand(0, 130) - r.top), ph: rand(0, 6), sw: rand(8, 16), x: 0, y: 0, rot: 0,
        state: "up", t0: 0.2 + i * 0.15, left: nb, tf: 0, yf: 0 };
    });
    balRef.current = bal;
    setList(bal.slice());
    setTotal(cards.length);
    if (!cards.length) { ctl.after(1500, g.win); return; }
    let n = 0;
    ctl.loop(t => {
      clock.current = t;
      st.current.forEach(o => {
        if (o.state === "up") {
          const u = clamp((t - o.t0) / 2.6, 0, 1), e = easeInOut(u);
          o.y = o.lift * e + Math.sin(t * 1.3 + o.ph) * 6 * e;
          o.x = Math.sin(t * 0.8 + o.ph) * o.sw * e;
          o.rot = Math.sin(t * 0.8 + o.ph + 0.6) * 2.4 * e;
        } else if (o.state === "fall") {
          const u = clamp((t - o.tf) / 1.0, 0, 1);
          o.y = o.yf * (1 - easeOutBounce(u));
          o.x *= 0.9; o.rot *= 0.9;
          if (u >= 1) {
            o.state = "home";
            ctl.unset(o.c, ["transform"]);
            const r = o.c.getBoundingClientRect();
            addFx({ x: r.left + r.width / 2, y: Math.min(r.bottom, vh() - 20), n: 8, dist: 50, colors: ["#cbd5e1", "#94a3b8"], size: 7 });
            n += 1;
            setLanded(n);
            if (n >= st.current.length && g.ref.current === "play") g.win();
          }
        }
        if (o.state !== "home") ctl.set(o.c, { transform: `translate(${o.x.toFixed(1)}px,${o.y.toFixed(1)}px) rotate(${o.rot.toFixed(2)}deg)` });
      });
      balRef.current.forEach(b => {
        const el = bRefs.current[b.id], ln = sRefs.current[b.id], o = st.current[b.card];
        if (!el || !o) return;
        const r = o.c.getBoundingClientRect();
        const ax = r.left + r.width * (b.k + 1) / (b.nb + 1), ay = r.top + 3;
        const bx = ax + Math.sin(t * 1.7 + b.id) * 6, by = Math.max(46, ay - 96 - b.k * 12) + Math.sin(t * 2.1 + b.id) * 4;
        el.style.transform = `translate(${(bx - 26).toFixed(1)}px,${(by - 34).toFixed(1)}px) rotate(${(Math.sin(t * 1.7 + b.id) * 6).toFixed(1)}deg)`;
        if (ln) ln.setAttribute("d", `M${bx.toFixed(1)} ${(by + 30).toFixed(1)} Q${((bx + ax) / 2 + Math.sin(t * 2 + b.id) * 9).toFixed(1)} ${((by + 30 + ay) / 2).toFixed(1)} ${ax.toFixed(1)} ${ay.toFixed(1)}`);
        b.x = bx; b.y = by;
      });
      return true;
    });
    g.hooks.current.giveUp = () => {
      balRef.current = [];
      setList([]);
      st.current.forEach(o => { if (o.state === "up") { o.state = "fall"; o.tf = clock.current; o.yf = o.y; } });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pop = (e, b) => {
    e.stopPropagation();
    if (g.ref.current !== "play") return;
    balRef.current = balRef.current.filter(x => x.id !== b.id);
    setList(balRef.current.slice());
    addFx({ x: b.x, y: b.y, n: 12, dist: 60, colors: [b.c, "#fff"] });
    addFx({ text: "POP !", x: b.x, y: b.y - 10, size: 26 });
    const o = st.current[b.card];
    if (o) {
      o.left -= 1;
      if (o.left <= 0 && o.state === "up") { o.state = "fall"; o.tf = clock.current; o.yf = o.y; }
    }
  };
  return (
    <Layer s={s} css={BALLONS_CSS}>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
        {list.map(b => <path key={b.id} ref={el => { sRefs.current[b.id] = el; }} fill="none" stroke="rgba(148,163,184,.9)" strokeWidth="1.4"/>)}
      </svg>
      {list.map(b => (
        <button key={b.id} ref={el => { bRefs.current[b.id] = el; }} aria-label="Ballon" onPointerDown={e => pop(e, b)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") pop(e, b); }}
          style={{ position: "absolute", left: 0, top: 0, width: 52, height: 70, padding: 0, border: "none", background: "transparent",
            cursor: "crosshair", pointerEvents: g.play ? "auto" : "none", touchAction: "manipulation", transform: "translate(-200px,-200px)" }}>
          <Balloon c={b.c}/>
        </button>
      ))}
      <FxLayer k="ballons" fx={fx}/>
      {g.play && <Pill key="a">🎈 Ça sent l'anniversaire : tes cartes s'envolent ! Perce les ballons : {landed}/{total} au sol</Pill>}
      {g.phase === "won" && <Pill key="b" fade>Tout le monde a atterri. Joyeux non-anniversaire, le plateau !</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Cache-cache
// ════════════════════════════════════════════════════════════════════════════
const CACHE_CSS = fxCss("cache-cache") + `
@keyframes pk-cache-cache-bub { 0% { transform: translate(-50%, 0) scale(.4); opacity: 0 } 20%, 75% { transform: translate(-50%, -6px) scale(1); opacity: 1 } 100% { transform: translate(-50%, -14px) scale(1); opacity: 0 } }
@keyframes pk-cache-cache-sweat { 0% { transform: translate(0,0); opacity: 0 } 30% { opacity: 1 } 100% { transform: translate(6px, 18px); opacity: 0 } }
@keyframes pk-cache-cache-pant { 0%, 100% { transform: translate(-50%,-50%) scale(1) } 50% { transform: translate(-50%,-50%) scale(.95, 1.04) } }
`;
const TAUNTS = ["Hé hé !", "Raté !", "Trop lent !", "Olé !", "Pas par là !", "Coucou !", "Même pas mal !", "Attrape-moi !"];
const PANTS = ["Pfiou…", "Un point de côté…", "Pause ?", "Je… fatigue…"];
function CacheCache({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const NEED = useMemo(() => (isCoarse() ? 7 : 9), []);
  const [pos, setPos] = useState(() => ({ x: vw() / 2, y: vh() * 0.55 }));
  const posRef = useRef(pos);
  const [n, setN] = useState(0);
  const nRef = useRef(0);
  const [say, setSay] = useState(null);
  const last = useRef(0);
  const cardsRef = useRef([]);
  const straighten = () => cardsRef.current.forEach(c => {
    let cur = "none";
    try { cur = getComputedStyle(c).transform; } catch (e) { /* rien */ }
    s.ctl.anim(c, [{ transform: cur && cur !== "none" ? cur : "none" }, { transform: "none" }],
      { duration: 650, easing: "cubic-bezier(.3,1.4,.5,1)", fill: "forwards" });
  });
  const flee = (px, py) => {
    const now = performance.now();
    if (now - last.current < 220 || g.ref.current !== "play" || nRef.current >= NEED) return;
    last.current = now;
    const k = nRef.current, W = vw(), H = vh();
    const D = Math.max(90, 240 - k * 16);
    const minX = 90, maxX = W - 90, minY = 100, maxY = H - (isNarrow() ? 170 : 110);
    let best = null, bd = -1;
    for (let i = 0; i < 20; i++) {
      const a = rand(0, Math.PI * 2), d = D * rand(0.7, 1.3);
      const x = clamp(posRef.current.x + Math.cos(a) * d, minX, Math.max(minX, maxX));
      const y = clamp(posRef.current.y + Math.sin(a) * d, minY, Math.max(minY, maxY));
      const dd = Math.hypot(x - px, y - py);
      if (dd > bd) { bd = dd; best = { x, y }; }
    }
    posRef.current = best;
    setPos(best);
    nRef.current = k + 1;
    setN(k + 1);
    setSay({ id: now, text: k + 1 >= NEED - 2 ? pick(PANTS) : pick(TAUNTS) });
  };
  useEffect(() => {
    const { ctl } = s;
    const cards = ctl.tiles(14);
    cardsRef.current = cards;
    cards.forEach((c, i) => ctl.anim(c, [{ transform: "none" }, { transform: `translate(${rand(-16, 16).toFixed(0)}px,${rand(-10, 10).toFixed(0)}px) rotate(${rand(-5, 5).toFixed(1)}deg)` }],
      { duration: 520, delay: i * 45, easing: "cubic-bezier(.3,1.5,.5,1)", fill: "forwards" }));
    const near = e => {
      if (g.ref.current !== "play" || nRef.current >= NEED) return;
      const R = Math.max(50, 125 - nRef.current * 8);
      if (Math.hypot(e.clientX - posRef.current.x, e.clientY - posRef.current.y) < R) flee(e.clientX, e.clientY);
    };
    ctl.on(window, "pointermove", near, { passive: true });
    ctl.on(window, "pointerdown", near, { passive: true });
    g.hooks.current.giveUp = straighten;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const tired = n >= NEED;
  const click = () => {
    if (g.ref.current !== "play") return;
    if (nRef.current >= NEED) { if (g.win()) straighten(); } else flee(posRef.current.x, posRef.current.y + 1);
  };
  const slow = 0.22 + n * 0.035;
  return (
    <Layer s={s} css={CACHE_CSS}>
      <Catcher on={g.play} cursor="crosshair"/>
      <div style={{ position: "absolute", left: pos.x, top: pos.y, width: 0, height: 0,
        transition: `left ${slow.toFixed(2)}s cubic-bezier(.2,.9,.3,1.2), top ${slow.toFixed(2)}s cubic-bezier(.2,.9,.3,1.2)`,
        opacity: g.phase === "rendu" ? 0 : 1 }}>
        <button onClick={click} style={{ position: "absolute", left: 0, top: 0, transform: "translate(-50%,-50%)", padding: "13px 20px",
          borderRadius: 14, border: "none", background: tired ? "#16a34a" : "#22c55e", color: "#fff", fontWeight: 900, fontSize: 15.5,
          fontFamily: FONT, cursor: "pointer", whiteSpace: "nowrap", pointerEvents: g.play ? "auto" : "none", touchAction: "manipulation",
          boxShadow: "0 5px 0 #15803d, 0 14px 30px rgba(0,0,0,.4)", minHeight: 46,
          animation: tired && g.play && !s.reduced ? "pk-cache-cache-pant .7s ease-in-out infinite" : "none" }}>
          {g.phase === "won" ? "Merci 😌" : tired ? "Bon… d'accord 😮‍💨" : "Remettre en ordre"}
        </button>
        {n > NEED / 2 && g.play && [0, 1].map(i => (
          <span key={i} aria-hidden="true" style={{ position: "absolute", left: 58 + i * 10, top: -34 + i * 6, fontSize: 13,
            animation: `pk-cache-cache-sweat 1s ease-in ${i * 0.45}s infinite` }}>💧</span>
        ))}
        {say && g.play && (
          <span key={say.id} aria-hidden="true" style={{ position: "absolute", left: 0, top: -62, padding: "4px 10px", borderRadius: 10,
            background: "#fff", color: "#111827", fontWeight: 800, fontSize: 13, whiteSpace: "nowrap", boxShadow: "0 4px 10px rgba(0,0,0,.3)",
            animation: "pk-cache-cache-bub 1s ease-out both" }}>{say.text}</span>
        )}
      </div>
      {g.play && (tired ? <Pill key="c">Il est à bout de souffle. C'est le moment !</Pill>
        : n > NEED / 2 ? <Pill key="b">Il commence à fatiguer… insiste !</Pill>
          : <Pill key="a">🏃 Le bouton « Remettre en ordre » a pris la poudre d'escampette. Attrape-le !</Pill>)}
      {g.phase === "won" && <Pill key="w" fade>Attrapé ! Tout est rangé. Il est allé s'allonger.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Gomme
// ════════════════════════════════════════════════════════════════════════════
const GOMME_CSS = fxCss("gomme");
const DOODLES = ["PLA > ABS", "Benchy ♥", "support ici →", "100 % remplissage", "BRIM !!!", "z-offset ??", "spaghetti", "à poncer", "buse 0,4"];
const INKS = ["#111827", "#ef4444", "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#db2777"];
function paintScribbles(g, w, h, q) {
  g.lineCap = "round"; g.lineJoin = "round";
  g.globalAlpha = 0.88;
  // hachures en zigzag sur toute la hauteur
  for (let i = 0; i < 10; i++) {
    g.strokeStyle = pick(INKS); g.lineWidth = rand(8, 14) * q;
    let x = rand(-0.1, 0.1) * w, y = (i + rand(0.1, 0.9)) / 10 * h;
    g.beginPath(); g.moveTo(x, y);
    while (x < w * 1.05) {
      x += rand(26, 60) * q;
      y = clamp(y + (Math.random() < 0.5 ? -1 : 1) * rand(40, 100) * q, 0, h);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // pelotes de gribouillis
  for (let i = 0; i < 14; i++) {
    const cx = rand(0.05, 0.95) * w, cy = rand(0.05, 0.95) * h, R = rand(34, 80) * q;
    g.strokeStyle = pick(INKS); g.lineWidth = rand(4, 8) * q;
    g.beginPath();
    let a = rand(0, 6);
    for (let k = 0; k < 44; k++) {
      a += rand(0.3, 0.9);
      const rr = R * rand(0.3, 1), px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.7;
      if (k) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.stroke();
  }
  // mots au feutre
  g.globalAlpha = 0.92;
  for (let i = 0; i < 7; i++) {
    g.save();
    g.translate(rand(0.04, 0.6) * w, rand(0.1, 0.92) * h);
    g.rotate(rand(-0.45, 0.45));
    g.fillStyle = pick(INKS);
    g.font = `bold ${Math.round(rand(26, 42) * q)}px "Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive`;
    g.fillText(pick(DOODLES), 0, 0);
    g.restore();
  }
  // un bonhomme
  const sx = rand(0.2, 0.8) * w, sy = rand(0.25, 0.75) * h, sr = 46 * q;
  g.strokeStyle = "#111827"; g.lineWidth = 6 * q;
  g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(sx, sy + 6 * q, sr * 0.55, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  g.fillStyle = "#111827";
  g.beginPath(); g.arc(sx - sr * 0.35, sy - sr * 0.25, 5 * q, 0, Math.PI * 2); g.arc(sx + sr * 0.35, sy - sr * 0.25, 5 * q, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
}
function Gomme({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const cvRef = useRef(null), eraserRef = useRef(null);
  const [pct, setPct] = useState(0);
  const [fx, addFx] = useFx(s);
  const st = useRef({ g: null, q: 1, last: null, init: 1, dirty: false, crumb: 0, rot: -18 });
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const W = vw(), H = vh(), q = Math.min(1, 800 / Math.max(W, H));
    cv.width = Math.max(1, Math.round(W * q)); cv.height = Math.max(1, Math.round(H * q));
    const gg = cv.getContext("2d", { willReadFrequently: true });
    st.current.g = gg; st.current.q = q;
    paintScribbles(gg, cv.width, cv.height, q);
    const count = () => {
      const d = gg.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 5) if (d[i] > 40) n++;
      return n;
    };
    st.current.init = Math.max(1, count());
    let lastCheck = 0;
    s.ctl.loop(t => {
      if (g.ref.current !== "play") return false;
      if (st.current.dirty && t - lastCheck > 0.3) {
        lastCheck = t;
        st.current.dirty = false;
        const erased = 1 - count() / st.current.init;
        setPct(Math.min(100, Math.round(erased / 0.75 * 100)));
        if (erased >= 0.75) g.win();
      }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const showEraser = (e, on) => {
    const el = eraserRef.current;
    if (!el) return;
    el.style.opacity = on && g.ref.current === "play" ? "1" : "0";
    el.style.transform = `translate(${e.clientX.toFixed(0)}px,${e.clientY.toFixed(0)}px) rotate(${st.current.rot.toFixed(0)}deg)`;
  };
  const rub = e => {
    showEraser(e, true);
    const S = st.current;
    if (!S.down || g.ref.current !== "play" || !S.g) return;
    const x = e.clientX * S.q, y = e.clientY * S.q;
    const R = (isNarrow() ? 30 : 26) * S.q;
    const gg = S.g;
    gg.globalCompositeOperation = "destination-out";
    gg.lineCap = "round"; gg.lineWidth = R * 2;
    gg.beginPath();
    const l = S.last || { x, y };
    gg.moveTo(l.x, l.y); gg.lineTo(x + 0.01, y);
    gg.stroke();
    gg.globalCompositeOperation = "source-over";
    if (S.last) S.rot = clamp(S.rot + (x - S.last.x) * 0.4, -40, 10);
    S.last = { x, y };
    S.dirty = true;
    const now = performance.now();
    if (now - S.crumb > 140) {
      S.crumb = now;
      addFx({ x: e.clientX, y: e.clientY + 10, n: 5, dist: 28, size: 4, colors: ["#f9a8d4", "#e5e7eb", "#a1a1aa"], dur: 0.6 }, 700);
    }
  };
  const down = e => { capture(e); st.current.down = true; st.current.last = null; rub(e); };
  const up = e => { st.current.down = false; st.current.last = null; if (e.pointerType !== "mouse") showEraser(e, false); };
  const over = !g.play;
  return (
    <Layer s={s} css={GOMME_CSS}>
      <canvas ref={cvRef} aria-label="Gribouillis à gommer" onPointerDown={down} onPointerMove={rub} onPointerUp={up} onPointerCancel={up}
        onPointerLeave={e => { up(e); showEraser(e, false); }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: over ? "none" : "auto", touchAction: "none",
          cursor: "none", animation: over ? "pk-kit-fade 1s ease both" : "pk-kit-fadein .5s ease both" }}/>
      <div ref={eraserRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, opacity: 0, transition: "opacity .2s" }}>
        <div style={{ position: "absolute", left: -26, top: -15, width: 52, height: 30, borderRadius: 6, overflow: "hidden",
          boxShadow: "0 4px 10px rgba(0,0,0,.35)", border: "1px solid rgba(0,0,0,.2)" }}>
          <div style={{ position: "absolute", inset: 0, background: "#f472b6" }}/>
          <div style={{ position: "absolute", left: 22, top: 0, bottom: 0, right: 0, background: "linear-gradient(180deg, #60a5fa, #2563eb)" }}/>
          <div style={{ position: "absolute", left: 26, top: 9, fontSize: 9, fontWeight: 900, color: "#fff", fontFamily: FONT }}>GOMME</div>
        </div>
      </div>
      <FxLayer k="gomme" fx={fx}/>
      {g.play && <Pill key="a">✏️ Un petit malin a gribouillé l'accueil au feutre ! Frotte pour gommer : {pct} %</Pill>}
      {g.phase === "won" && <Pill key="b" fade>Propre comme un plateau neuf. Le feutre était effaçable, ouf.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Serrure
// ════════════════════════════════════════════════════════════════════════════
const SERRURE_CSS = fxCss("serrure") + `
@keyframes pk-serrure-glow { 0%, 100% { box-shadow: 0 0 10px 2px rgba(250,204,21,.3), inset 0 2px 3px rgba(255,255,255,.5) } 50% { box-shadow: 0 0 24px 7px rgba(250,204,21,.55), inset 0 2px 3px rgba(255,255,255,.5) } }
@keyframes pk-serrure-tw { 0%, 100% { transform: translate(-50%,-50%) scale(0) rotate(0deg); opacity: 0 } 50% { transform: translate(-50%,-50%) scale(1) rotate(90deg); opacity: .9 } }
`;
const KEYHOLE_D = "M -17 0 A 42 42 0 1 1 17 0 L 34 92 L -34 92 Z";
function Serrure({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const geo = useMemo(() => {
    const W = vw(), H = vh();
    const lock = { x: W / 2, y: Math.round(H * 0.6) };
    let key = null;
    for (let k = 0; k < 60 && !key; k++) {
      const p = { x: rand(0.1, 0.9) * W, y: rand(0.14, 0.52) * H };
      if (Math.hypot(p.x - lock.x, p.y - lock.y) > Math.min(240, W * 0.55) || k === 59) key = p;
    }
    return { W, H, lock, key, sc: isNarrow() ? 0.85 : 1, rot: rand(-50, 50) };
  }, []);
  const holeRef = useRef(null);
  const [key, setKey] = useState(geo.key);
  const [carry, setCarry] = useState(false);
  const carryRef = useRef(false);
  const [msg, setMsg] = useState(0);
  const [tw, setTw] = useState(0);
  const st = useRef({ x: geo.W / 2, y: geo.H * 0.35, touch: false, grow: 0 });
  const place = useCallback(() => {
    const { x, y, touch, grow } = st.current;
    const hy = touch ? y - 100 : y;
    if (holeRef.current) holeRef.current.setAttribute("transform", `translate(${x.toFixed(1)} ${(hy - 6).toFixed(1)}) scale(${(geo.sc * (1 + grow)).toFixed(3)})`);
  }, [geo.sc]);
  useEffect(() => {
    place();
    const { ctl } = s;
    const twinkle = () => { if (g.ref.current === "play" && !carryRef.current) setTw(n => n + 1); ctl.after(5000, twinkle); };
    ctl.after(24000, () => { if (g.ref.current === "play") setMsg(m => (m === 0 ? 3 : m)); twinkle(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const at = e => { st.current.x = e.clientX; st.current.y = e.clientY; st.current.touch = e.pointerType !== "mouse"; place(); };
  const down = e => {
    if (g.ref.current !== "play") return;
    capture(e);
    at(e);
    if (!carryRef.current && Math.hypot(e.clientX - key.x, e.clientY - key.y) < 48) {
      carryRef.current = true; setCarry(true); setKey({ x: e.clientX, y: e.clientY }); setMsg(1);
    }
  };
  const move = e => {
    if (g.ref.current !== "play") return;
    at(e);
    if (carryRef.current) setKey({ x: e.clientX, y: e.clientY });
  };
  const up = e => {
    if (!carryRef.current || g.ref.current !== "play") return;
    carryRef.current = false;
    setCarry(false);
    if (Math.hypot(e.clientX - geo.lock.x, e.clientY - geo.lock.y) < 72) {
      setKey({ x: geo.lock.x, y: geo.lock.y });
      if (g.win()) {
        st.current.x = geo.lock.x; st.current.y = geo.lock.y + 6; st.current.touch = false;
        s.ctl.loop(t => { st.current.grow = 40 * Math.pow(clamp(t / 1.1, 0, 1), 2.2); place(); return t < 1.15; });
      }
    } else { setKey({ x: e.clientX, y: e.clientY }); setMsg(2); }
  };
  const over = !g.play;
  const keyStyle = { position: "absolute", left: key.x, top: key.y, transform: `translate(-50%,-50%) rotate(${carry ? -15 : g.phase === "won" ? 90 : geo.rot}deg)` };
  return (
    <Layer s={s} css={SERRURE_CSS}>
      {!carry && <div aria-hidden="true" style={keyStyle}><KeySvg/></div>}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: g.phase === "rendu" ? 0 : 1,
        animation: g.phase === "won" ? "pk-kit-fade .5s ease 1s both" : "pk-kit-fadein .6s ease both",
        transition: "opacity 1s ease" }} aria-hidden="true">
        <defs>
          <filter id="pk-serrure-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
          <radialGradient id="pk-serrure-vig" cx=".5" cy=".5" r=".75">
            <stop offset="0" stopColor="#05060b" stopOpacity="1"/><stop offset="1" stopColor="#000" stopOpacity="1"/>
          </radialGradient>
          <mask id="pk-serrure-m" maskUnits="userSpaceOnUse" x="0" y="0" width={geo.W} height={geo.H}>
            <rect x="0" y="0" width={geo.W} height={geo.H} fill="#fff"/>
            <g ref={holeRef}><path d={KEYHOLE_D} fill="#000" filter="url(#pk-serrure-soft)"/></g>
          </mask>
        </defs>
        <rect x="0" y="0" width={geo.W} height={geo.H} fill="url(#pk-serrure-vig)" mask="url(#pk-serrure-m)"/>
      </svg>
      <div aria-hidden="true" style={{ position: "absolute", left: geo.lock.x - 34, top: geo.lock.y - 52, width: 68, height: 108, borderRadius: 34,
        background: "linear-gradient(160deg, #fde68a, #ca8a04 55%, #713f12)", border: "2px solid #713f12",
        animation: over ? "pk-kit-fade .5s ease both" : "pk-serrure-glow 2.2s ease-in-out infinite" }}>
        <div style={{ position: "absolute", left: 22, top: 30, width: 24, height: 24, borderRadius: "50%", background: "#0b0b10" }}/>
        <div style={{ position: "absolute", left: 27, top: 46, width: 14, height: 34, borderRadius: "0 0 5px 5px", background: "#0b0b10",
          clipPath: "polygon(25% 0, 75% 0, 100% 100%, 0 100%)" }}/>
        {[10, 92].map(y => <div key={y} style={{ position: "absolute", left: 30, top: y, width: 8, height: 8, borderRadius: "50%", background: "#78350f" }}/>)}
      </div>
      {tw > 0 && !carry && g.play && (
        <span key={tw} aria-hidden="true" style={{ position: "absolute", left: key.x + 14, top: key.y - 10, fontSize: 16,
          animation: "pk-serrure-tw 1.2s ease-in-out both" }}>✨</span>
      )}
      {carry && <div aria-hidden="true" style={{ ...keyStyle, filter: "drop-shadow(0 0 8px rgba(250,204,21,.6))" }}><KeySvg/></div>}
      <Catcher on={g.play} cursor="none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}/>
      {g.play && (msg === 1 ? <Pill key="b">Tu la tiens ! Rapporte-la à la serrure dorée.</Pill>
        : msg === 2 ? <Pill key="c">Elle t'a glissé des doigts… Ramasse-la et vise la serrure.</Pill>
          : msg === 3 ? <Pill key="d">Un reflet doré, là-bas dans le noir ?</Pill>
            : <Pill key="a">🗝️ On ne voit plus que par le trou de la serrure ! Trouve la clé dans le noir et rapporte-la à la serrure.</Pill>)}
      {g.phase === "won" && <Pill key="w" fade>Clac ! Porte ouverte. Promis, personne ne regardait par le trou.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 8. Carte a gratter
// ════════════════════════════════════════════════════════════════════════════
const GRATTER_CSS = fxCss("carte-a-gratter") + `
@keyframes pk-carte-a-gratter-in { from { transform: translate(-50%,-50%) translateY(60vh) rotate(14deg) } to { transform: translate(-50%,-50%) rotate(-2deg) } }
@keyframes pk-carte-a-gratter-out { from { transform: translate(-50%,-50%) rotate(-2deg) } to { transform: translate(-50%,-50%) translate(40vw,-90vh) rotate(-40deg) } }
@keyframes pk-carte-a-gratter-stamp { 0% { transform: translate(-50%,-50%) scale(3) rotate(-18deg); opacity: 0 } 60% { transform: translate(-50%,-50%) scale(.92) rotate(-12deg); opacity: 1 } 100% { transform: translate(-50%,-50%) scale(1) rotate(-12deg); opacity: 1 } }
@keyframes pk-carte-a-gratter-shine { from { background-position: -200px 0 } to { background-position: 400px 0 } }
`;
function Spool({ c, size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true" style={{ display: "block" }}>
      <circle cx="30" cy="30" r="28" fill="#e5e7eb" stroke="#9ca3af" strokeWidth="1.5"/>
      <circle cx="30" cy="30" r="22" fill={c}/>
      {[19, 16, 13].map(r => <circle key={r} cx="30" cy="30" r={r} fill="none" stroke="rgba(0,0,0,.16)" strokeWidth="1"/>)}
      <circle cx="30" cy="30" r="9" fill="#f3f4f6" stroke="#9ca3af"/>
      <circle cx="30" cy="30" r="3.2" fill="#6b7280"/>
      <path d="M44 16 Q 52 10 56 14" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round"/>
    </svg>
  );
}
function paintSilver(g, w, h) {
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, "#d1d5db"); gr.addColorStop(0.45, "#f3f4f6"); gr.addColorStop(0.55, "#9ca3af"); gr.addColorStop(1, "#d1d5db");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,.55)" : "rgba(75,85,99,.25)";
    g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
  g.fillStyle = "rgba(55,65,81,.55)";
  g.font = `900 ${Math.round(w * 0.15)}px ${FONT}`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("GRATTEZ", w / 2, h / 2 - w * 0.08);
  g.font = `900 ${Math.round(w * 0.22)}px ${FONT}`;
  g.fillText("★", w / 2, h / 2 + w * 0.17);
}
function CarteAGratter({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const geo = useMemo(() => {
    const W = vw(), H = vh(), TW = Math.min(340, W - 32);
    return { W, H, TW, BOX: Math.min(92, Math.floor((TW - 64) / 3)), y: Math.round(H * 0.45) };
  }, []);
  const color = useMemo(() => pick(FILAMENTS), []);
  const [cleared, setCleared] = useState([false, false, false]);
  const clRef = useRef([false, false, false]);
  const cvs = useRef([]), last = useRef(null), checkT = useRef(0);
  const [fx, addFx] = useFx(s);
  useEffect(() => {
    cvs.current.forEach(cv => {
      if (!cv) return;
      cv.width = geo.BOX * 2; cv.height = geo.BOX * 2;
      paintSilver(cv.getContext("2d", { willReadFrequently: true }), cv.width, cv.height);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const check = force => {
    const now = performance.now();
    if (!force && now - checkT.current < 160) return;
    checkT.current = now;
    cvs.current.forEach((cv, i) => {
      if (!cv || clRef.current[i]) return;
      const d = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data;
      let clear = 0, tot = 0;
      for (let k = 3; k < d.length; k += 4 * 6) { tot++; if (d[k] < 60) clear++; }
      if (tot && clear / tot >= 0.55) {
        clRef.current = clRef.current.map((v, j) => v || j === i);
        setCleared(clRef.current.slice());
        const r = cv.getBoundingClientRect();
        addFx({ x: r.left + r.width / 2, y: r.top + r.height / 2, n: 12, dist: 54, colors: [color, "#fde047", "#fff"] });
        if (clRef.current.every(Boolean)) s.ctl.after(450, g.win);
      }
    });
  };
  const scratch = e => {
    if (!last.current || g.ref.current !== "play") return;
    const R = isNarrow() ? 17 : 15;
    cvs.current.forEach((cv, i) => {
      if (!cv || clRef.current[i]) return;
      const r = cv.getBoundingClientRect();
      if (e.clientX < r.left - R || e.clientX > r.right + R || e.clientY < r.top - R || e.clientY > r.bottom + R) return;
      const k = cv.width / r.width, gg = cv.getContext("2d", { willReadFrequently: true });
      const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
      const lx = (last.current.x - r.left) * k, ly = (last.current.y - r.top) * k;
      gg.globalCompositeOperation = "destination-out";
      gg.lineCap = "round"; gg.lineWidth = R * 2 * k;
      gg.beginPath(); gg.moveTo(lx, ly); gg.lineTo(x + 0.01, y); gg.stroke();
      gg.globalCompositeOperation = "source-over";
    });
    last.current = { x: e.clientX, y: e.clientY };
    check(false);
  };
  const down = e => { if (g.ref.current !== "play") return; capture(e); last.current = { x: e.clientX, y: e.clientY }; scratch(e); };
  const up = () => { if (last.current) { last.current = null; check(true); } };
  const won = g.phase === "won", n = cleared.filter(Boolean).length;
  return (
    <Layer s={s} css={GRATTER_CSS}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(2,6,23,.5)", pointerEvents: g.play ? "auto" : "none",
        animation: g.play ? "pk-kit-fadein .5s ease both" : "pk-kit-fade .8s ease .6s both" }}/>
      <div onPointerDown={down} onPointerMove={scratch} onPointerUp={up} onPointerCancel={up}
        style={{ position: "absolute", left: geo.W / 2, top: geo.y, width: geo.TW, padding: "18px 16px 14px", borderRadius: 18,
          background: "linear-gradient(160deg, #7c3aed, #db2777 60%, #f59e0b)", color: "#fff", fontFamily: FONT, textAlign: "center",
          boxShadow: "0 24px 60px rgba(0,0,0,.55), inset 0 0 0 3px rgba(255,255,255,.25)", pointerEvents: g.play ? "auto" : "none",
          touchAction: "none", cursor: "pointer", boxSizing: "border-box", transform: "translate(-50%,-50%) rotate(-2deg)",
          animation: g.play ? "pk-carte-a-gratter-in .8s cubic-bezier(.2,1.2,.4,1) both"
            : `pk-carte-a-gratter-out .9s cubic-bezier(.5,0,.8,.4) ${won ? 1.1 : 0.2}s both` }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 18, pointerEvents: "none", opacity: 0.35,
          background: "linear-gradient(100deg, transparent 30%, rgba(255,255,255,.7) 50%, transparent 70%) 0 0 / 200px 100% no-repeat",
          animation: "pk-carte-a-gratter-shine 3s ease-in-out infinite" }}/>
        <div style={{ fontSize: 12, letterSpacing: ".25em", fontWeight: 800, opacity: 0.85 }}>★ LOTO DE L'ATELIER ★</div>
        <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.05, marginTop: 4, textShadow: "0 3px 0 rgba(0,0,0,.25)" }}>MÉGA BOBINE</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 6, opacity: 0.95 }}>Trois bobines identiques = l'accueil est à toi !</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 14 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ position: "relative", width: geo.BOX, height: geo.BOX, borderRadius: 12, background: "#fff",
              boxShadow: "inset 0 2px 6px rgba(0,0,0,.25)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              <Spool c={color} size={geo.BOX * 0.78}/>
              <canvas ref={el => { cvs.current[i] = el; }} aria-label={`Case ${i + 1} à gratter`} style={{ position: "absolute", inset: 0,
                width: "100%", height: "100%", opacity: cleared[i] ? 0 : 1, transition: "opacity .45s ease" }}/>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10.5, marginTop: 12, opacity: 0.75 }}>Ticket n° 0042-PLA · Jeu sans obligation d'achat de filament.</div>
        {won && (
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "52%", padding: "6px 16px", border: "5px solid #16a34a",
            borderRadius: 12, color: "#16a34a", background: "rgba(255,255,255,.92)", fontWeight: 900, fontSize: 34, letterSpacing: ".06em",
            animation: "pk-carte-a-gratter-stamp .45s cubic-bezier(.3,1.4,.5,1) both" }}>GAGNÉ !</div>
        )}
      </div>
      <FxLayer k="carte-a-gratter" fx={fx}/>
      {won && <Glitter k="carte-a-gratter" n={60} spread={2}/>}
      {g.play && <Pill key="a">🎟️ Un ticket à gratter s'est collé sur l'accueil ! Gratte les 3 cases : {n}/3</Pill>}
      {won && <Pill key="b" fade>Trois bobines ! Le lot : ton accueil, rendu en parfait état.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 9. Radar
// ════════════════════════════════════════════════════════════════════════════
const RADAR_CSS = fxCss("radar") + `
@keyframes pk-radar-lock { 0% { transform: translate(-50%,-50%) scale(2.2) rotate(45deg); opacity: 0 } 40% { transform: translate(-50%,-50%) scale(1) rotate(0deg); opacity: 1 } 100% { transform: translate(-50%,-50%) scale(1) rotate(0deg); opacity: 0 } }
@keyframes pk-radar-ping { 0% { transform: translate(-50%,-50%) scale(.2); opacity: .9 } 100% { transform: translate(-50%,-50%) scale(1.6); opacity: 0 } }
@keyframes pk-radar-scan { from { background-position: 0 0 } to { background-position: 0 4px } }
`;
function Radar({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const geo = useMemo(() => {
    const W = vw(), H = vh();
    const R = Math.max(110, Math.min(W - 24, H - 230) * 0.46);
    return { W, H, R, cx: W / 2, cy: clamp(H * 0.45, R + 40, Math.max(R + 40, H - R - 120)) };
  }, []);
  const T = s.reduced ? 4.2 : 3.2;
  const sweepRef = useRef(null), blipRef = useRef(null);
  const blip = useRef({ ang: 0, rad: 0, flash: -10, moved: true, x: 0, y: 0 });
  const angRef = useRef(0);
  const [hits, setHits] = useState(0);
  const hitsRef = useRef(0);
  const [marks, setMarks] = useState([]);
  const [fx, addFx] = useFx(s);
  const relocate = from => {
    const b = blip.current;
    b.ang = (from + rand(80, 280)) % 360;
    b.rad = geo.R * rand(0.25, 0.85);
    b.x = geo.cx + Math.sin(b.ang * Math.PI / 180) * b.rad;
    b.y = geo.cy - Math.cos(b.ang * Math.PI / 180) * b.rad;
    b.flash = -10; b.moved = true;
  };
  useEffect(() => {
    relocate(0);
    let prev = 0;
    s.ctl.loop(t => {
      const a = (t / T * 360) % 360;
      angRef.current = a;
      if (sweepRef.current) sweepRef.current.style.transform = `rotate(${a.toFixed(1)}deg)`;
      const b = blip.current;
      const crossed = prev <= a ? prev < b.ang && b.ang <= a : b.ang > prev || b.ang <= a;
      if (crossed && g.ref.current === "play") { b.flash = t; b.moved = false; }
      prev = a;
      const age = t - b.flash, op = Math.max(0, 1 - age / 1.2);
      b.op = op;
      if (!b.moved && age > 1.5) relocate(a);
      if (blipRef.current) {
        blipRef.current.style.opacity = op.toFixed(3);
        blipRef.current.style.transform = `translate(${b.x.toFixed(1)}px,${b.y.toFixed(1)}px)`;
      }
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const down = e => {
    if (g.ref.current !== "play") return;
    const b = blip.current;
    if ((b.op || 0) > 0.1 && Math.hypot(e.clientX - b.x, e.clientY - b.y) < 46) {
      hitsRef.current += 1;
      setHits(hitsRef.current);
      const id = performance.now();
      setMarks(m => [...m.slice(-3), { id, x: b.x, y: b.y }]);
      addFx({ text: "VERROUILLÉ", x: b.x, y: b.y - 34, size: 15, color: "#86efac", edge: "#052e16" });
      b.flash = -10; b.moved = true;
      if (hitsRef.current >= 3) g.win();
      else s.ctl.after(450, () => relocate(angRef.current));
    } else {
      addFx({ x: e.clientX, y: e.clientY, n: 6, dist: 22, size: 4, colors: ["#4ade80"], dur: 0.5 }, 600);
    }
  };
  const over = !g.play;
  const green = "#4ade80";
  return (
    <Layer s={s} css={RADAR_CSS}>
      <div style={{ position: "absolute", inset: 0, animation: over ? `pk-kit-fade .9s ease ${g.phase === "won" ? 0.9 : 0}s both` : "pk-kit-fadein .5s ease both" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, rgba(3,30,14,.9), rgba(1,12,6,.96))" }}/>
        <div style={{ position: "absolute", inset: 0, opacity: 0.25, background: "repeating-linear-gradient(0deg, rgba(74,222,128,.25) 0 1px, transparent 1px 4px)",
          animation: s.reduced ? "none" : "pk-radar-scan .3s linear infinite" }}/>
        <div style={{ position: "absolute", left: geo.cx - geo.R, top: geo.cy - geo.R, width: geo.R * 2, height: geo.R * 2, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(22,101,52,.35), rgba(5,46,22,.5) 70%, rgba(2,20,10,.8))",
          boxShadow: `0 0 0 2px ${green}, 0 0 30px rgba(74,222,128,.35), inset 0 0 40px rgba(0,0,0,.6)`, overflow: "hidden" }}>
          {[0.25, 0.5, 0.75].map(f => (
            <div key={f} style={{ position: "absolute", left: "50%", top: "50%", width: geo.R * 2 * f, height: geo.R * 2 * f,
              transform: "translate(-50%,-50%)", borderRadius: "50%", border: "1px solid rgba(74,222,128,.35)" }}/>
          ))}
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(74,222,128,.3)" }}/>
          <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(74,222,128,.3)" }}/>
          <div ref={sweepRef} style={{ position: "absolute", inset: 0, borderRadius: "50%",
            background: "conic-gradient(from 0deg, rgba(74,222,128,0) 0deg, rgba(74,222,128,0) 280deg, rgba(74,222,128,.08) 300deg, rgba(74,222,128,.45) 357deg, rgba(187,247,208,.95) 360deg)" }}/>
        </div>
        {[["0", 0], ["90", 90], ["180", 180], ["270", 270]].map(([l, a]) => (
          <span key={l} aria-hidden="true" style={{ position: "absolute", left: geo.cx + Math.sin(a * Math.PI / 180) * (geo.R + 14),
            top: geo.cy - Math.cos(a * Math.PI / 180) * (geo.R + 14), transform: "translate(-50%,-50%)", color: green, fontSize: 11,
            fontFamily: "ui-monospace, Consolas, monospace", opacity: 0.8 }}>{l}°</span>
        ))}
        <div aria-hidden="true" style={{ position: "absolute", left: 16, top: "calc(60px + env(safe-area-inset-top, 0px))", color: green,
          fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12, lineHeight: 1.5, textShadow: "0 0 6px rgba(74,222,128,.6)" }}>
          BAMBU-RADAR v3<br/>PORTÉE 256 mm<br/>CIBLES : {hits}/3
        </div>
        <div ref={blipRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, opacity: 0 }}>
          <div style={{ position: "absolute", left: -8, top: -8, width: 16, height: 16, borderRadius: "50%", background: "#bbf7d0",
            boxShadow: "0 0 14px 6px rgba(74,222,128,.8)" }}/>
          <div style={{ position: "absolute", left: -22, top: -22, width: 44, height: 44, borderRadius: "50%", border: "1.5px solid rgba(134,239,172,.7)" }}/>
        </div>
        {marks.map(m => (
          <div key={m.id} aria-hidden="true" style={{ position: "absolute", left: m.x, top: m.y, width: 54, height: 54,
            border: "2px solid #bbf7d0", borderRadius: 6, boxShadow: "0 0 12px rgba(74,222,128,.8)", animation: "pk-radar-lock 1s ease-out both" }}/>
        ))}
      </div>
      <Catcher on={g.play} cursor="crosshair" onPointerDown={down}/>
      <FxLayer k="radar" fx={fx}/>
      {g.play && <Pill key="a">📡 Objet non identifié sur le plateau ! Touche-le quand il clignote : {hits}/3</Pill>}
      {g.phase === "won" && <Pill key="b" fade>Cible identifiée : un Benchy égaré. Fin de l'alerte.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 10. Ascenseur
// ════════════════════════════════════════════════════════════════════════════
const ASCENSEUR_CSS = fxCss("ascenseur") + `
@keyframes pk-ascenseur-blink { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
`;
const FLOORS = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2];
const FLOOR_GAGS = {
  "-2": "Niveau -2 : le parking à bobines vides. Il y en a… beaucoup.",
  "-1": "Niveau -1 : la cave à filament. Ça sent le PETG humide.",
  1: "1er : le service client. Merci de patienter… patienter…",
  2: "2e : la salle des supports qu'on n'a jamais retirés.",
  3: "3e : les impressions ratées. Attention aux spaghettis.",
  4: "4e : le club des Benchy. Ils sont 4 000, tous identiques.",
  5: "5e : le bureau du slicer. Ici, on découpe tout en tranches.",
  6: "6e : la salle de calibration. Ne touche pas au Z-offset !",
  7: "7e : le salon des filaments soie. Ça brille, ça brille.",
  8: "8e : les archives des fichiers « final_v2_vraiment_final.3mf ».",
  9: "Terrasse : vue imprenable sur… la file d'attente d'impression.",
};
function Ascenseur({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const H = useMemo(vh, []);
  const S = H * 1.1;
  const [floor, setFloor] = useState(0);
  const [dir, setDir] = useState(1);
  const [lit, setLit] = useState(null);
  const [gag, setGag] = useState(null);
  const [hint, setHint] = useState(false);
  const [fx, addFx] = useFx(s);
  const slabs = useRef([]), labels = useRef([]);
  const m = useRef({ pos: 0, target: randInt(3, 6), user: false, wait: 0, t: 0, shown: 0 });
  const partsRef = useRef([]);
  const nextRun = cur => { let f = cur; while (f === cur || f === 0) f = randInt(-2, 9); return f; };
  useEffect(() => {
    const { ctl } = s;
    const parts = ctl.parts();
    partsRef.current = parts;
    ctl.after(15000, () => setHint(true));
    ctl.loop((t, dt) => {
      const M = m.current;
      M.t = t;
      let moving = false;
      if (g.ref.current === "play" && t >= M.wait && Math.abs(M.target - M.pos) > 0.0005) {
        const d = M.target - M.pos, sp = (M.user ? 1.7 : 0.85) * clamp(Math.abs(d) * 1.6, 0.22, 1);
        M.pos += Math.sign(d) * Math.min(Math.abs(d), sp * dt);
        moving = true;
        if (Math.abs(M.target - M.pos) <= 0.0005) {
          M.pos = M.target;
          arrive(t);
        }
      }
      const b0 = Math.floor(M.pos - 0.5);
      for (let b = b0 - 1; b <= b0 + 1; b++) {
        const i = ((b % 3) + 3) % 3, el = slabs.current[i];
        if (!el) continue;
        const y = H / 2 - (b + 0.5 - M.pos) * S;
        el.style.transform = `translateY(${(y - 40).toFixed(1)}px)`;
        if (labels.current[i] && labels.current[i].dataset.b !== String(b)) {
          labels.current[i].dataset.b = String(b);
          labels.current[i].textContent = b + 1 === 0 ? "REZ-DE-CHAUSSÉE" : `NIVEAU ${b + 1}`;
        }
      }
      const shown = Math.round(M.pos);
      if (shown !== M.shown) { M.shown = shown; setFloor(shown); }
      if (!s.reduced && g.ref.current === "play") {
        const k = moving ? 1 : 0;
        parts.forEach(p => ctl.set(p, { transform: k ? `translateY(${(Math.sin(t * 47) * 1.3).toFixed(2)}px)` : null }));
      }
      return g.ref.current === "play";
    });
    const arrive = t => {
      const M = m.current;
      addFx({ text: "DING !", x: vw() / 2, y: 120, size: 26 });
      if (M.user && M.target === 0) { setLit(null); finishOk(); return; }
      setGag(FLOOR_GAGS[M.target] || null);
      setLit(null);
      M.user = false;
      M.wait = t + 2.6;
      const nx = nextRun(M.target);
      M.target = nx;
      ctl.after(2600, () => { setGag(null); setDir(Math.sign(nx - m.current.pos) || 1); });
    };
    const finishOk = () => { parts.forEach(p => ctl.unset(p, ["transform"])); g.win(); };
    g.hooks.current.giveUp = () => parts.forEach(p => ctl.unset(p, ["transform"]));
    setDir(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const press = f => {
    if (g.ref.current !== "play") return;
    const M = m.current;
    setLit(f);
    if (Math.abs(M.pos - f) < 0.001 && f === 0) { partsRef.current.forEach(p => s.ctl.unset(p, ["transform"])); g.win(); return; }
    M.user = true; M.target = f; M.wait = Math.min(M.wait, M.t + 0.25);
    setGag(null);
    setDir(Math.sign(f - M.pos) || 1);
  };
  const over = !g.play;
  const narrow = isNarrow();
  const disp = floor === 0 ? "0" : String(floor);
  return (
    <Layer s={s} css={ASCENSEUR_CSS}>
      <div style={{ position: "absolute", inset: 0, opacity: over ? 0 : 1, transition: "opacity .9s ease .5s" }}>
        {[0, 1, 2].map(i => (
          <div key={i} ref={el => { slabs.current[i] = el; }} aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 80,
            transform: "translateY(-300px)", background: "linear-gradient(180deg, #57534e, #44403c 40%, #292524)",
            boxShadow: "0 -6px 18px rgba(0,0,0,.5), 0 6px 18px rgba(0,0,0,.5)" }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 10,
              background: "repeating-linear-gradient(45deg, #facc15 0 12px, #111 12px 24px)" }}/>
            <div ref={el => { labels.current[i] = el; }} style={{ position: "absolute", left: 18, top: 26, color: "rgba(255,255,255,.75)",
              fontWeight: 900, letterSpacing: ".18em", fontSize: 18, fontFamily: FONT }}/>
          </div>
        ))}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
          boxShadow: "inset 0 0 0 9px #64748b, inset 0 0 0 11px #1e293b, inset 0 0 90px rgba(0,0,0,.55)" }}/>
        <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "calc(58px + env(safe-area-inset-top, 0px))", transform: "translateX(-50%)",
          minWidth: 112, padding: "6px 14px", borderRadius: 10, background: "#0a0a0a", border: "3px solid #94a3b8",
          boxShadow: "0 8px 20px rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          fontFamily: "ui-monospace, Consolas, monospace", color: "#f87171", textShadow: "0 0 8px rgba(248,113,113,.8)" }}>
          <span style={{ fontSize: 22, animation: gag ? "none" : "pk-ascenseur-blink 1s ease-in-out infinite" }}>{dir > 0 ? "▲" : "▼"}</span>
          <span style={{ fontSize: 34, fontWeight: 900, minWidth: 40, textAlign: "center" }}>{disp}</span>
        </div>
        <div style={{ position: "absolute", right: narrow ? "50%" : 24, bottom: narrow ? "calc(140px + env(safe-area-inset-bottom, 0px))" : 90,
          transform: narrow ? "translateX(50%)" : "none", padding: 12, borderRadius: 14,
          background: "linear-gradient(135deg, #e2e8f0, #94a3b8 45%, #cbd5e1 55%, #64748b)", boxShadow: "0 12px 30px rgba(0,0,0,.5)",
          border: "1px solid #475569", pointerEvents: g.play ? "auto" : "none" }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${narrow ? 6 : 4}, 44px)`, gap: 7 }}>
            {FLOORS.map(f => (
              <button key={f} onClick={() => press(f)} aria-label={`Étage ${f}`} style={{ width: 44, height: 44, borderRadius: "50%", padding: 0,
                border: lit === f ? "3px solid #fb923c" : "3px solid #475569", cursor: "pointer", fontFamily: FONT, fontWeight: 900, fontSize: 15,
                color: lit === f ? "#fff7ed" : "#1e293b", touchAction: "manipulation",
                background: lit === f ? "radial-gradient(circle, #fdba74, #ea580c)" : "radial-gradient(circle at 35% 30%, #f8fafc, #cbd5e1 60%, #94a3b8)",
                boxShadow: lit === f ? "0 0 14px rgba(251,146,60,.9)" : "0 2px 3px rgba(0,0,0,.35)" }}>{f}</button>
            ))}
          </div>
        </div>
      </div>
      <FxLayer k="ascenseur" fx={fx}/>
      {g.play && (gag ? <Pill key={"g" + gag}>{gag}</Pill>
        : hint ? <Pill key="h">Petit rappel du concierge : l'atelier est au rez-de-chaussée.</Pill>
          : <Pill key="a">🛗 L'accueil a pris l'ascenseur et ne s'arrête plus ! Ramène-le à l'étage de l'atelier.</Pill>)}
      {g.phase === "won" && <Pill key="w" fade>Ding ! Rez-de-chaussée, l'atelier. Tout le monde descend.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 11. Aimant inverse
// ════════════════════════════════════════════════════════════════════════════
const AIMANT_INV_CSS = fxCss("aimant-inverse") + `
@keyframes pk-aimant-inverse-wave { 0% { transform: scale(1.8); opacity: 0 } 60% { opacity: .7 } 100% { transform: scale(.4); opacity: 0 } }
@keyframes pk-aimant-inverse-corner { 0%, 100% { opacity: .25 } 50% { opacity: .7 } }
`;
function AimantInverse({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const P = useRef({ x: -999, y: -999, on: false });
  const magRef = useRef(null);
  const st = useRef([]);
  const [hold, setHold] = useState(0);
  const [fx, addFx] = useFx(s);
  const calm = () => st.current.forEach(o => {
    let cur = "none";
    try { cur = getComputedStyle(o.c).transform; } catch (e) { /* rien */ }
    s.ctl.anim(o.c, [{ transform: cur && cur !== "none" ? cur : "none" }, { transform: "none" }],
      { duration: 700, easing: "cubic-bezier(.3,1.3,.5,1)", fill: "forwards" });
  });
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh(), M = 6;
    const top = isNarrow() ? 54 : 8, bot = isNarrow() ? H - 78 : H - 8;
    st.current = visibleCards(ctl, 12, 0, 0).map(({ c, r }) => ({ c, r, x: 0, y: 0, vx: 0, vy: 0, held: 0, knock: 0 }));
    if (!st.current.length) { ctl.after(1500, g.win); return; }
    let shownHold = 0;
    ctl.loop((t, dt) => {
      const p = P.current, play = g.ref.current === "play";
      if (magRef.current) {
        magRef.current.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
        magRef.current.style.opacity = p.on && play ? "1" : "0";
      }
      if (!play) return false;
      let best = 0, bestO = null;
      st.current.forEach(o => {
        const L = o.r.left + o.x, T = o.r.top + o.y, Rr = L + o.r.width, B = T + o.r.height;
        let fx2 = 0, fy2 = 0, d = 1e9;
        if (p.on) {
          const nx = clamp(p.x, L, Rr), ny = clamp(p.y, T, B);
          d = Math.hypot(p.x - nx, p.y - ny);
          const R = 120;
          if (d < R) {
            const cx = (L + Rr) / 2, cy = (T + B) / 2;
            let ux = cx - p.x, uy = cy - p.y;
            const n = Math.hypot(ux, uy) || 1;
            ux /= n; uy /= n;
            const F = 3200 * (1 - d / R) + (d === 0 ? 1500 : 0);
            fx2 = ux * F; fy2 = uy * F;
          }
        }
        o.vx += (fx2 - 4.2 * o.vx - 1.1 * o.x) * dt;
        o.vy += (fy2 - 4.2 * o.vy - 1.1 * o.y) * dt;
        o.x += o.vx * dt; o.y += o.vy * dt;
        const minX = Math.min(0, M - o.r.left), maxX = Math.max(0, W - M - o.r.right);
        const minY = Math.min(0, top - o.r.top), maxY = Math.max(0, bot - o.r.bottom);
        let bump = false;
        if (o.x < minX) { o.x = minX; bump = Math.abs(o.vx) > 160; o.vx = -o.vx * 0.25; }
        if (o.x > maxX) { o.x = maxX; bump = Math.abs(o.vx) > 160; o.vx = -o.vx * 0.25; }
        if (o.y < minY) { o.y = minY; bump = bump || Math.abs(o.vy) > 160; o.vy = -o.vy * 0.25; }
        if (o.y > maxY) { o.y = maxY; bump = bump || Math.abs(o.vy) > 160; o.vy = -o.vy * 0.25; }
        if (bump && t - o.knock > 0.4) { o.knock = t; addFx({ text: "toc", x: (L + Rr) / 2, y: clamp((T + B) / 2, 80, H - 120), size: 16 }, 900); }
        const L2 = o.r.left + o.x, T2 = o.r.top + o.y;
        const side = L2 <= M + 1.5 || L2 + o.r.width >= W - M - 1.5;
        const end = T2 <= top + 1.5 || T2 + o.r.height >= bot - 1.5;
        if (side && end && p.on && d < 150 && Math.hypot(o.x, o.y) > 60) o.held += dt; else o.held = Math.max(0, o.held - dt * 1.5);
        if (o.held > best) { best = o.held; bestO = o; }
        const rot = clamp(o.vx * 0.012, -7, 7);
        ctl.set(o.c, { transform: `translate(${o.x.toFixed(1)}px,${o.y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)` });
      });
      const h = Math.min(1, best / 0.7);
      if (Math.abs(h - shownHold) > 0.08 || (h === 0 && shownHold !== 0)) { shownHold = h; setHold(h); }
      if (best >= 0.7 && bestO) {
        const r = bestO.c.getBoundingClientRect();
        addFx({ x: r.left + r.width / 2, y: clamp(r.top + r.height / 2, 60, H - 100), n: 16, dist: 80 });
        ctl.anim(bestO.c, [{ boxShadow: "0 0 0 3px rgba(168,85,247,.9), 0 0 40px rgba(168,85,247,.6)" }, { boxShadow: "0 0 0 0 rgba(168,85,247,0)" }], { duration: 900 });
        calm();
        g.win();
        return false;
      }
      return true;
    });
    g.hooks.current.giveUp = calm;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const at = (e, on) => { P.current = { x: e.clientX, y: e.clientY, on }; };
  const corner = (k, st2) => (
    <div key={k} aria-hidden="true" style={{ position: "absolute", width: 34, height: 34, ...st2, borderColor: "rgba(168,85,247,.85)",
      borderStyle: "solid", borderWidth: 0, animation: "pk-aimant-inverse-corner 1.6s ease-in-out infinite",
      opacity: g.play ? undefined : 0 }}/>
  );
  const tb = isNarrow() ? 58 : 12, bb = isNarrow() ? 82 : 12;
  return (
    <Layer s={s} css={AIMANT_INV_CSS}>
      {g.play && [
        corner("tl", { left: 10, top: tb, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 8 }),
        corner("tr", { right: 10, top: tb, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 8 }),
        corner("bl", { left: 10, bottom: bb, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 8 }),
        corner("br", { right: 10, bottom: bb, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 8 }),
      ]}
      <Catcher on={g.play} cursor="none"
        onPointerDown={e => { capture(e); at(e, true); }} onPointerMove={e => at(e, e.pointerType === "mouse" || e.buttons > 0 || P.current.on)}
        onPointerUp={e => at(e, e.pointerType === "mouse")} onPointerCancel={e => at(e, false)} onPointerLeave={e => at(e, false)}/>
      <div ref={magRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, opacity: 0, transition: "opacity .2s" }}>
        <div style={{ position: "absolute", left: -28, top: -28, width: 56, height: 56 }}>
          {[0, 1].map(i => (
            <span key={i} style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(59,130,246,.65)",
              animation: s.reduced ? "none" : `pk-aimant-inverse-wave 1.3s ease-out ${i * 0.65}s infinite` }}/>
          ))}
          <svg width="56" height="56" viewBox="0 0 44 44" style={{ position: "absolute", inset: 0, filter: "drop-shadow(0 3px 6px rgba(0,0,0,.5))" }}>
            <path d="M10 36 V22 A12 12 0 0 1 34 22 V36" fill="none" stroke="#3b82f6" strokeWidth="9"/>
            <rect x="5.5" y="33" width="9" height="8" fill="#e5e7eb"/><rect x="29.5" y="33" width="9" height="8" fill="#e5e7eb"/>
            <text x="22" y="27" textAnchor="middle" fontSize="8" fontWeight="900" fill="#fff" fontFamily={FONT}>N N</text>
          </svg>
        </div>
      </div>
      <FxLayer k="aimant-inverse" fx={fx}/>
      {g.play && (hold > 0.1 ? <Pill key="h">Elle est coincée… tiens bon ! {Math.round(hold * 100)} %</Pill>
        : <Pill key="a">🧲 Aimant à l'envers : tes cartes te fuient ! Coince-en une dans un coin de l'écran.</Pill>)}
      {g.phase === "won" && <Pill key="b" fade>Coincée ! Les autres se calment. Polarité rétablie.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 12. Sablier
// ════════════════════════════════════════════════════════════════════════════
const SABLIER_CSS = fxCss("sablier") + `
@keyframes pk-sablier-pour { from { background-position: 0 0 } to { background-position: 0 40px } }
@keyframes pk-sablier-up { 0% { transform: translate(0, 0); opacity: 0 } 15% { opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)); opacity: 0 } }
@keyframes pk-sablier-wob { 0%, 100% { transform: rotate(0deg) } 25% { transform: rotate(-9deg) } 75% { transform: rotate(7deg) } }
`;
const SAND = "#e0b56b";
const SAND_BG = `radial-gradient(circle at 20% 30%, rgba(120,72,20,.35) 0 1.5px, transparent 2px) 0 0 / 13px 11px, radial-gradient(circle at 70% 60%, rgba(255,240,200,.5) 0 1.2px, transparent 2px) 0 0 / 9px 13px, linear-gradient(180deg, #e9c27c, #c99446)`;
function Sablier({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const geo = useMemo(() => { const W = vw(), H = vh(); return { W, H, x: isNarrow() ? W - 70 : Math.round(W * 0.8), y: Math.round(H * 0.38) }; }, []);
  const DUR = 30;
  const [rot, setRot] = useState(0);
  const [held, setHeld] = useState(false);
  const [msg, setMsg] = useState(0);
  const [wob, setWob] = useState(0);
  const topRef = useRef(null), botRef = useRef(null), streamRef = useRef(null), pileRef = useRef(null);
  const lv = useRef(0), drain = useRef(-1), d = useRef(null), flipped = useRef(false);
  const grains = useMemo(() => Array.from({ length: 26 }, () => ({ x: rand(0, 100), dx: rand(-30, 30), dy: -rand(160, 360), dl: rand(0, 0.9) })), []);
  const streams = useMemo(() => Array.from({ length: 5 }, () => ({ x: rand(4, 96), w: rand(2, 4), d: rand(0.5, 0.9) })), []);
  useEffect(() => {
    const { ctl } = s;
    const parts = ctl.parts();
    let lastF = -1, full = false;
    ctl.loop((t, dt) => {
      if (g.ref.current === "play") {
        lv.current = Math.min(1, lv.current + dt / DUR);
        if (lv.current >= 1 && !full) { full = true; setMsg(2); }
      } else if (drain.current >= 0) {
        lv.current = Math.max(0, lv.current - dt / 1.4);
      }
      const L = lv.current, up = flipped.current;
      // dans le verre : bulbe du haut (1 - L), bulbe du bas L. Une fois retourne,
      // le dessin pivote : le sable se pose alors de l'autre cote de chaque bulbe.
      const hT = 62 * (1 - L), hB = 60 * L;
      if (topRef.current) { topRef.current.setAttribute("y", (up ? 12 : 84 - hT).toFixed(1)); topRef.current.setAttribute("height", hT.toFixed(1)); }
      if (botRef.current) { botRef.current.setAttribute("y", (up ? 85 : 158 - hB).toFixed(1)); botRef.current.setAttribute("height", hB.toFixed(1)); }
      if (streamRef.current) streamRef.current.style.opacity = (up ? L > 0.02 : g.ref.current === "play" && L < 1) ? "1" : "0";
      if (pileRef.current) pileRef.current.style.height = `${(L * geo.H * 0.58).toFixed(1)}px`;
      if (Math.abs(L - lastF) > 0.02 || (L === 0 && lastF !== 0)) {
        lastF = L;
        parts.forEach(p => ctl.set(p, { filter: L > 0.005 ? `sepia(${(L * 0.75).toFixed(2)}) saturate(${(1 - L * 0.3).toFixed(2)}) blur(${(L * 0.6).toFixed(2)}px)` : null }));
      }
      if (g.ref.current !== "play" && L <= 0) { parts.forEach(p => ctl.unset(p, ["filter"])); return false; }
      return true;
    });
    g.hooks.current.giveUp = () => { drain.current = 0; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const flip = sign => {
    if (g.ref.current !== "play") return;
    d.current = null;
    setHeld(false);
    setRot(sign * 180);
    flipped.current = true;
    drain.current = 0;
    g.win();
  };
  const ang = e => Math.atan2(e.clientY - geo.y, e.clientX - geo.x) * 180 / Math.PI;
  const down = e => {
    if (g.ref.current !== "play") return;
    e.preventDefault();
    capture(e);
    d.current = { prev: ang(e), acc: 0, moved: 0 };
    setHeld(true);
  };
  const move = e => {
    const D = d.current;
    if (!D) return;
    const a = ang(e), delta = wrap180(a - D.prev);
    D.prev = a; D.acc += delta; D.moved += Math.abs(delta);
    setRot(D.acc);
    if (Math.abs(D.acc) >= 150) flip(Math.sign(D.acc));
  };
  const up = () => {
    const D = d.current;
    if (!D) return;
    d.current = null;
    setHeld(false);
    setRot(0);
    if (D.moved < 6) { setMsg(1); setWob(n => n + 1); }
  };
  const won = g.phase === "won";
  return (
    <Layer s={s} css={SABLIER_CSS}>
      {streams.map((st, i) => (
        <div key={i} aria-hidden="true" style={{ position: "absolute", left: `${st.x}%`, top: 0, bottom: 0, width: st.w,
          background: `repeating-linear-gradient(180deg, ${SAND} 0 3px, transparent 3px 8px)`, opacity: g.play && msg !== 2 ? 0.55 : 0,
          transition: "opacity .8s ease", animation: s.reduced ? "none" : `pk-sablier-pour ${st.d}s linear infinite` }}/>
      ))}
      <div ref={pileRef} aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 0, background: SAND_BG,
        boxShadow: "0 -4px 12px rgba(120,72,20,.35)" }}>
        <svg width="100%" height="26" viewBox="0 0 400 26" preserveAspectRatio="none" style={{ position: "absolute", left: 0, top: -25 }} aria-hidden="true">
          <path d="M0 26 C 40 6, 80 18, 130 10 S 220 2, 270 14 S 360 4, 400 16 L400 26 Z" fill="#e9c27c"/>
        </svg>
      </div>
      {won && grains.map((gr, i) => (
        <span key={i} aria-hidden="true" style={{ position: "absolute", left: `${gr.x}%`, bottom: 10, width: 5, height: 5, borderRadius: "50%",
          background: SAND, "--dx": `${gr.dx.toFixed(0)}px`, "--dy": `${gr.dy.toFixed(0)}px`, animation: `pk-sablier-up 1.2s ease-out ${gr.dl.toFixed(2)}s both` }}/>
      ))}
      <div style={{ position: "absolute", left: geo.x, top: geo.y, width: 0, height: 0, animation: "pk-kit-pop .5s ease-out both" }}>
        <button aria-label="Sablier" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(1); } }}
          style={{ position: "absolute", left: -62, top: -100, width: 124, height: 200, padding: 0, border: "none", background: "transparent",
            cursor: held ? "grabbing" : "grab", touchAction: "none", pointerEvents: g.play ? "auto" : "none",
            transform: `rotate(${rot.toFixed(1)}deg)`,
            opacity: g.phase === "rendu" ? 0 : 1, transition: held ? "none" : "transform .55s cubic-bezier(.3,1.3,.5,1), opacity .6s ease",
            animation: won ? "pk-kit-fade .6s ease 1.6s both" : "none" }}>
          <div key={wob} style={{ width: "100%", height: "100%", animation: wob ? "pk-sablier-wob .5s ease-in-out" : "none" }}>
            <svg width="124" height="200" viewBox="-12 -10 124 190" aria-hidden="true" style={{ display: "block", overflow: "visible",
              filter: "drop-shadow(0 10px 14px rgba(0,0,0,.45))" }}>
              <defs>
                <clipPath id="pk-sablier-top"><path d="M18 12 C18 50, 44 70, 47 85 L53 85 C56 70, 82 50, 82 12 Z"/></clipPath>
                <clipPath id="pk-sablier-bot"><path d="M47 85 C44 100, 18 120, 18 158 L82 158 C82 120, 56 100, 53 85 Z"/></clipPath>
              </defs>
              <path d="M18 12 C18 50, 44 70, 47 85 C44 100, 18 120, 18 158 L82 158 C82 120, 56 100, 53 85 C56 70, 82 50, 82 12 Z"
                fill="rgba(186,230,253,.22)" stroke="rgba(226,232,240,.85)" strokeWidth="2"/>
              <rect ref={topRef} x="10" y="22" width="80" height="62" fill={SAND} clipPath="url(#pk-sablier-top)"/>
              <rect ref={botRef} x="10" y="158" width="80" height="0" fill={SAND} clipPath="url(#pk-sablier-bot)"/>
              <line ref={streamRef} x1="50" y1="84" x2="50" y2="156" stroke={SAND} strokeWidth="2" strokeDasharray="3 2"/>
              <path d="M26 20 C 27 44, 40 62, 46 76" fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="3" strokeLinecap="round"/>
              <rect x="0" y="0" width="100" height="12" rx="4" fill="#92400e" stroke="#451a03"/>
              <rect x="0" y="158" width="100" height="12" rx="4" fill="#92400e" stroke="#451a03"/>
              <rect x="5" y="12" width="6" height="146" fill="#b45309"/><rect x="89" y="12" width="6" height="146" fill="#b45309"/>
            </svg>
          </div>
        </button>
      </div>
      {g.play && (msg === 2 ? <Pill key="c">Ensablé ! Il est vide… retourne-le quand même, vite !</Pill>
        : msg === 1 ? <Pill key="b">Il est lourd : fais-le pivoter d'un demi-tour (glisse en rond).</Pill>
          : <Pill key="a">⏳ Le temps file et l'accueil s'ensable ! Retourne le sablier avant qu'il soit vide.</Pill>)}
      {won && <Pill key="w" fade>Le sable remonte, le temps aussi. Ton accueil a rajeuni de 30 secondes.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 13. Peche
// ════════════════════════════════════════════════════════════════════════════
const PECHE_CSS = fxCss("peche") + `
@keyframes pk-peche-surf { from { transform: translateX(0) } to { transform: translateX(-50%) } }
@keyframes pk-peche-bub { 0% { transform: translateY(0) scale(.6); opacity: 0 } 15% { opacity: .8 } 100% { transform: translateY(-70vh) scale(1.1); opacity: 0 } }
@keyframes pk-peche-tail { 0%, 100% { transform: scaleY(1) skewY(0deg) } 50% { transform: scaleY(.7) skewY(12deg) } }
`;
const PECHE_SURF = (() => { let d = "M0 14"; for (let i = 0; i < 24; i++) d += ` Q${i * 50 + 25} ${i % 2 ? 24 : 4} ${i * 50 + 50} 14`; return d; })();
function Peche({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const geo = useMemo(() => { const W = vw(), H = vh(); return { W, H, water: Math.round(H * 0.3), tip: { x: Math.min(W * 0.22, 140), y: 66 } }; }, []);
  const [up, setUp] = useState(false);
  const [down, setDown] = useState(false);
  const [caught, setCaught] = useState(0);
  const caughtRef = useRef(0);
  const [fx, addFx] = useFx(s);
  const fish = useRef([]);
  const tails = useRef([]);
  const hookRef = useRef(null), lineRef = useRef(null);
  const P = useRef({ x: geo.W / 2, y: geo.H * 0.6 });
  const hook = useRef({ x: geo.W / 2, y: geo.H * 0.6, vx: 0, vy: 0 });
  const bubbles = useMemo(() => Array.from({ length: 16 }, () => ({ x: rand(2, 98), s: rand(5, 14), d: rand(3, 6), dl: rand(0, 5) })), []);
  const [nf, setNf] = useState(0);
  useEffect(() => {
    const { ctl } = s;
    const W = geo.W, H = geo.H;
    fish.current = visibleCards(ctl, 8, 0, 0).map(({ c, r }) => {
      const sc = clamp(Math.min(190 / r.width, 110 / r.height), 0.14, 0.6);
      return { c, hx: r.left + r.width / 2, hy: r.top + r.height / 2, w: r.width * sc, h: r.height * sc, sc, k: 0, kT: 1, state: "swim",
        om: rand(0.22, 0.42) * (Math.random() < 0.5 ? -1 : 1), ph: rand(0, 6), yb: rand(geo.water + 80, H - 150), amp: rand(0.28, 0.4) * W,
        cx: 0, cy: 0, dir: 1, arc: 0 };
    });
    setNf(fish.current.length);
    if (!fish.current.length) { ctl.after(1500, g.win); return; }
    ctl.after(40, () => setUp(true));
    ctl.loop((t, dt) => {
      const hk = hook.current, p = P.current;
      hk.vx += ((p.x - hk.x) * 16 - hk.vx * 5.5) * dt;
      hk.vy += ((p.y - hk.y) * 16 - hk.vy * 5.5) * dt;
      hk.x += hk.vx * dt; hk.y += hk.vy * dt;
      if (hookRef.current) hookRef.current.style.transform = `translate(${hk.x.toFixed(1)}px,${hk.y.toFixed(1)}px)`;
      if (lineRef.current) {
        const mx = (geo.tip.x + hk.x) / 2, my = Math.max(geo.tip.y, hk.y) + 30;
        lineRef.current.setAttribute("d", `M${geo.tip.x} ${geo.tip.y} Q${mx.toFixed(1)} ${my.toFixed(1)} ${hk.x.toFixed(1)} ${(hk.y - 14).toFixed(1)}`);
      }
      fish.current.forEach((o, i) => {
        if (o.state === "home") return;
        o.k += (o.kT - o.k) * Math.min(1, dt * (o.state === "caught" ? 2.2 : 1.6));
        const a = o.om * t + o.ph;
        o.cx = W / 2 + o.amp * Math.sin(a);
        o.cy = o.yb + 16 * Math.sin(1.7 * a);
        o.dir = Math.cos(a) * o.om >= 0 ? 1 : -1;
        const arc = o.state === "caught" ? -140 * 4 * o.k * (1 - o.k) : 0;
        const tx = (o.cx - o.hx) * o.k, ty = (o.cy - o.hy) * o.k + arc;
        const sc = lerp(1, o.sc, o.k), rot = Math.sin(t * 3 + o.ph) * 5 * o.k;
        ctl.set(o.c, { transform: `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale(${sc.toFixed(3)}) rotate(${rot.toFixed(2)}deg)` });
        const el = tails.current[i];
        if (el) {
          const bx = o.hx + tx - o.dir * o.w / 2, by = o.hy + ty;
          el.style.opacity = o.state === "swim" ? Math.min(1, o.k * 1.4).toFixed(2) : "0";
          el.style.transform = `translate(${bx.toFixed(1)}px,${by.toFixed(1)}px) scaleX(${o.dir})`;
        }
        if (o.kT === 0 && o.k < 0.003) { o.state = "home"; ctl.unset(o.c, ["transform"]); if (el) el.style.opacity = "0"; }
      });
      return true;
    });
    g.hooks.current.giveUp = () => { setDown(true); fish.current.forEach(o => { if (o.state === "swim") { o.kT = 0; o.state = "back"; } }); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const strike = () => {
    if (g.ref.current !== "play") return;
    const hk = hook.current;
    hk.vy -= 260;
    const o = fish.current.find(f => f.state === "swim" && f.k > 0.6 && Math.abs(hk.x - f.cx) < f.w / 2 + 16 && Math.abs(hk.y - f.cy) < f.h / 2 + 16);
    if (!o) { addFx({ x: hk.x, y: hk.y, n: 6, dist: 26, size: 6, colors: ["rgba(255,255,255,.8)", "#bae6fd"] }, 800); return; }
    o.state = "caught"; o.kT = 0;
    addFx({ text: "Ferré !", x: o.cx, y: o.cy - o.h / 2 - 16, size: 24, color: "#e0f2fe", edge: "#075985" });
    addFx({ x: o.cx, y: geo.water + 8, n: 14, dist: 60, colors: ["#e0f2fe", "#7dd3fc", "#fff"] });
    caughtRef.current += 1;
    setCaught(caughtRef.current);
    if (caughtRef.current >= 3 || caughtRef.current >= fish.current.length) {
      setDown(true);
      fish.current.forEach(f => { if (f.state === "swim") { f.kT = 0; f.state = "back"; } });
      g.win();
    }
  };
  const need = Math.min(3, nf || 3);
  const waterTop = down ? geo.H + 40 : up ? geo.water : geo.H + 40;
  return (
    <Layer s={s} css={PECHE_CSS}>
      {Array.from({ length: nf }, (_, i) => (
        <div key={i} ref={el => { tails.current[i] = el; }} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, opacity: 0 }}>
          <div style={{ position: "absolute", left: -30, top: -18, width: 34, height: 36, transformOrigin: "100% 50%",
            animation: s.reduced ? "none" : "pk-peche-tail .5s ease-in-out infinite" }}>
            <svg width="34" height="36" viewBox="0 0 34 36"><path d="M34 18 L4 2 Q 12 18 4 34 Z" fill="#f97316" stroke="#9a3412" strokeWidth="1.5"/></svg>
          </div>
        </div>
      ))}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: waterTop, height: geo.H, transition: `top ${down ? 1.3 : 1.5}s cubic-bezier(.4,0,.2,1)` }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(56,189,248,.38), rgba(14,116,144,.5) 50%, rgba(8,47,73,.66))" }}/>
        <div style={{ position: "absolute", left: 0, top: -14, height: 28, width: "200%", animation: s.reduced ? "none" : "pk-peche-surf 4s linear infinite" }}>
          <svg width="100%" height="28" viewBox="0 0 1200 28" preserveAspectRatio="none">
            <path d={PECHE_SURF + " L1200 28 L0 28 Z"} fill="rgba(56,189,248,.38)"/>
            <path d={PECHE_SURF} fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>
          </svg>
        </div>
        {bubbles.map((b, i) => (
          <span key={i} style={{ position: "absolute", left: `${b.x}%`, top: "70%", width: b.s, height: b.s, borderRadius: "50%",
            border: "1.5px solid rgba(255,255,255,.65)", animation: s.reduced ? "none" : `pk-peche-bub ${b.d}s ease-in ${b.dl}s infinite both` }}/>
        ))}
      </div>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: g.play ? 1 : 0, transition: "opacity .8s ease .6s" }} aria-hidden="true">
        <line x1={-10} y1={geo.tip.y + 90} x2={geo.tip.x} y2={geo.tip.y} stroke="#78350f" strokeWidth="6" strokeLinecap="round"/>
        <circle cx={geo.tip.x * 0.25} cy={geo.tip.y + 68} r="9" fill="#475569" stroke="#1e293b" strokeWidth="2"/>
        <path ref={lineRef} fill="none" stroke="rgba(241,245,249,.85)" strokeWidth="1.3"/>
      </svg>
      <div ref={hookRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, opacity: g.play ? 1 : 0, transition: "opacity .5s" }}>
        <svg width="26" height="34" viewBox="0 0 26 34" style={{ position: "absolute", left: -13, top: -16, overflow: "visible" }}>
          <circle cx="13" cy="-6" r="6" fill="#ef4444" stroke="#fff" strokeWidth="1.5"/>
          <path d="M13 0 V20 A7 7 0 0 1 0 22 L 3 17" fill="none" stroke="#cbd5e1" strokeWidth="2.6" strokeLinecap="round"/>
        </svg>
      </div>
      <Catcher on={g.play} cursor="crosshair"
        onPointerDown={e => { capture(e); P.current = { x: e.clientX, y: e.clientY }; if (e.pointerType === "mouse") strike(); }}
        onPointerMove={e => { P.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={e => { if (e.pointerType !== "mouse") strike(); }}/>
      <FxLayer k="peche" fx={fx}/>
      {g.play && <Pill key="a">🎣 Inondation ! Tes cartes nagent au fond. Place l'hameçon sur l'une d'elles et ferre (clic, ou lâche le doigt) : {caught}/{need}</Pill>}
      {g.phase === "won" && <Pill key="b" fade>Belle pêche ! L'eau se retire. Pense à sécher ton filament.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 14. Digicode
// ════════════════════════════════════════════════════════════════════════════
const DIGICODE_CSS = fxCss("digicode") + `
@keyframes pk-digicode-pulse { 0%, 100% { transform: translate(-50%,-50%) scale(1) } 50% { transform: translate(-50%,-50%) scale(1.9) } }
@keyframes pk-digicode-in { from { transform: translateY(40px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes pk-digicode-out { from { transform: none; opacity: 1 } to { transform: translateY(60px) scale(.9); opacity: 0 } }
`;
const CODE_COLORS = ["#f97316", "#22c55e", "#ec4899", "#3b82f6"];
function Digicode({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const code = useMemo(() => Array.from({ length: 4 }, () => randInt(0, 9)), []);
  const pad = useMemo(() => {
    const W = vw(), H = vh(), w = 214, h = 300, narrow = isNarrow();
    return { w, h, left: narrow ? Math.round((W - w) / 2) : W - w - 28, top: narrow ? H - h - 132 : H - h - 76 };
  }, []);
  const [typed, setTyped] = useState([]);
  const typedRef = useRef([]);
  const [err, setErr] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [placed, setPlaced] = useState(false);
  const digRefs = useRef([]);
  const keyRef = useRef(null);
  keyRef.current = d => {
    if (g.ref.current !== "play" || typedRef.current.length >= 4) return;
    const t = [...typedRef.current, d];
    typedRef.current = t;
    setTyped(t);
    if (t.length === 4) {
      if (t.every((v, i) => v === code[i])) s.ctl.after(250, g.win);
      else s.ctl.after(300, () => { setErr(n => n + 1); s.ctl.after(650, () => { typedRef.current = []; setTyped([]); }); });
    }
  };
  const back = () => { if (g.ref.current !== "play" || typedRef.current.length >= 4) return; typedRef.current = typedRef.current.slice(0, -1); setTyped(typedRef.current); };
  const clearAll = () => { if (g.ref.current !== "play" || typedRef.current.length >= 4) return; typedRef.current = []; setTyped([]); };
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh();
    const inPad = (x, y) => x > pad.left - 26 && x < pad.left + pad.w + 26 && y > pad.top - 26 && y < pad.top + pad.h + 26;
    const cards = shuffle(visibleCards(ctl, 20, 60, 140));
    const used = [];
    for (let i = 0; i < 4; i++) {
      let sp = null;
      for (let k = 0; k < 80 && !sp && cards.length; k++) {
        const o = cards[(i + Math.floor(k / 20)) % cards.length];
        const fx2 = rand(0.06, 0.94), fy2 = rand(0.12, 0.88);
        const x = o.r.left + fx2 * o.r.width, y = o.r.top + fy2 * o.r.height;
        if (x < 16 || x > W - 16 || y < 66 || y > H - 110 || inPad(x, y) || used.some(u => Math.hypot(u.x - x, u.y - y) < 64)) continue;
        sp = { c: o.c, fx: fx2, fy: fy2, x, y };
      }
      for (let k = 0; k < 80 && !sp; k++) {
        const x = rand(20, W - 20), y = rand(70, H - 120);
        if (!inPad(x, y) && !used.some(u => Math.hypot(u.x - x, u.y - y) < 64)) sp = { c: null, x, y };
      }
      if (!sp) sp = { c: null, x: 30 + i * 44, y: 80 };
      sp.rot = rand(-28, 28);
      used.push(sp);
    }
    setPlaced(true);
    ctl.loop(() => {
      used.forEach((sp, i) => {
        let x = sp.x, y = sp.y;
        if (sp.c) { const r = sp.c.getBoundingClientRect(); x = r.left + sp.fx * r.width; y = r.top + sp.fy * r.height; }
        const el = digRefs.current[i];
        if (el) el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${sp.rot.toFixed(0)}deg)`;
      });
      return g.ref.current === "play";
    });
    ctl.on(window, "keydown", e => {
      if (/^[0-9]$/.test(e.key)) keyRef.current(+e.key);
      else if (e.key === "Backspace") back();
    });
    const nudge = () => { if (g.ref.current === "play") { setPulse(n => n + 1); ctl.after(6000, nudge); } };
    ctl.after(26000, nudge);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const won = g.phase === "won";
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "C"];
  const bad = err > 0 && typed.length === 4;
  return (
    <Layer s={s} css={DIGICODE_CSS}>
      {placed && code.map((dg, i) => (
        <div key={i} ref={el => { digRefs.current[i] = el; }} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0,
          opacity: g.play ? 1 : 0, transition: "opacity .6s" }}>
          <span key={pulse} style={{ position: "absolute", left: 0, top: 0, transform: "translate(-50%,-50%)", fontFamily: FONT, fontWeight: 900,
            fontSize: 13, color: CODE_COLORS[i], opacity: 0.8, textShadow: "0 0 1px rgba(0,0,0,.25)",
            animation: pulse ? "pk-digicode-pulse .7s ease-in-out" : "none" }}>{dg}</span>
        </div>
      ))}
      <div style={{ position: "absolute", left: pad.left, top: pad.top, width: pad.w, padding: 14, borderRadius: 16, boxSizing: "border-box",
        background: "linear-gradient(160deg, #475569, #1e293b)", border: "2px solid #64748b", boxShadow: "0 18px 40px rgba(0,0,0,.55)",
        pointerEvents: g.play ? "auto" : "none", fontFamily: FONT,
        animation: g.play ? "pk-digicode-in .5s cubic-bezier(.2,1.2,.4,1) both" : `pk-digicode-out .6s ease ${won ? 0.7 : 0}s both` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, color: "#cbd5e1",
          fontSize: 11, fontWeight: 800, letterSpacing: ".12em" }}>
          <span>DIGICODE</span>
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: won ? "#22c55e" : bad ? "#ef4444" : "#7f1d1d",
            boxShadow: won ? "0 0 10px #22c55e" : bad ? "0 0 10px #ef4444" : "none" }}/>
        </div>
        <div key={err} style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12,
          animation: err ? "pk-digicode-shake .45s ease" : "none" }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ width: 38, height: 44, borderRadius: 8, background: "#0b1220", color: won ? "#4ade80" : bad ? "#f87171" : "#e2e8f0",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900,
              fontFamily: "ui-monospace, Consolas, monospace", borderBottom: `4px solid ${CODE_COLORS[i]}` }}>{typed[i] != null ? typed[i] : ""}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {keys.map(k => (
            <button key={k} onClick={() => (k === "⌫" ? back() : k === "C" ? clearAll() : keyRef.current(k))}
              aria-label={k === "⌫" ? "Effacer" : k === "C" ? "Tout effacer" : `Touche ${k}`}
              style={{ height: 44, borderRadius: 10, border: "1px solid #0f172a", cursor: "pointer", fontFamily: FONT, fontWeight: 900, fontSize: 18,
                color: "#e2e8f0", background: "linear-gradient(180deg, #64748b, #334155)", boxShadow: "0 3px 0 #0f172a",
                touchAction: "manipulation" }}>{k}</button>
          ))}
        </div>
      </div>
      {g.play && (bad ? <Pill key={"e" + err}>Bip bip ! Code erroné. Regarde mieux les cartes…</Pill>
        : <Pill key="a">🔢 Accès verrouillé ! 4 petits chiffres se cachent dans les cartes : tape-les dans l'ordre des couleurs.</Pill>)}
      {won && <Pill key="b" fade>Bzzt, clac ! Accès autorisé. Bienvenue chez toi.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 15. Souris
// ════════════════════════════════════════════════════════════════════════════
const SOURIS_CSS = fxCss("souris") + `
@keyframes pk-souris-dash { 0% { transform: translate(var(--x0), var(--y0)) scaleX(var(--f)); opacity: 0 } 10%, 90% { opacity: 1 } 100% { transform: translate(var(--x1), var(--y1)) scaleX(var(--f)); opacity: 0 } }
@keyframes pk-souris-pop { 0% { transform: translate(-50%,-100%) scale(.2) } 60% { transform: translate(-50%,-100%) scale(1.2) } 100% { transform: translate(-50%,-100%) scale(1) } }
@keyframes pk-souris-hop { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
`;
function Mouse({ size = 54 }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 60 36" aria-hidden="true" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 3px 3px rgba(0,0,0,.35))" }}>
      <path d="M8 26 C -4 26, -4 12, 6 14" fill="none" stroke="#f9a8d4" strokeWidth="2" strokeLinecap="round"/>
      <ellipse cx="28" cy="24" rx="20" ry="11" fill="#9ca3af"/>
      <circle cx="40" cy="12" r="7" fill="#9ca3af"/><circle cx="40" cy="12" r="4" fill="#f9a8d4"/>
      <path d="M44 18 Q 56 20 58 25 Q 52 30 44 29 Z" fill="#9ca3af"/>
      <circle cx="58" cy="25" r="2.2" fill="#f472b6"/>
      <circle cx="49" cy="22" r="1.8" fill="#111"/>
      <path d="M56 26 l6 -2 M56 27 l6 1" stroke="#6b7280" strokeWidth=".8"/>
    </svg>
  );
}
function Souris({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const [dash, setDash] = useState(null);
  const [found, setFound] = useState(null);
  const [tries, setTries] = useState(0);
  const cardsRef = useRef([]), hide = useRef(0), busy = useRef(new Set());
  const [fx, addFx] = useFx(s);
  const spotOf = i => {
    const o = cardsRef.current[i];
    const r = o.c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: Math.min(r.bottom - 4, vh() - 100), r };
  };
  useEffect(() => {
    const { ctl } = s;
    cardsRef.current = visibleCards(ctl, 12, 60, 110);
    const n = cardsRef.current.length;
    if (!n) { ctl.after(1500, g.win); return; }
    hide.current = randInt(0, n - 1);
    const nibble = () => {
      if (g.ref.current !== "play") return;
      const o = cardsRef.current[hide.current];
      if (o && !busy.current.has(o.c)) {
        const r = o.c.getBoundingClientRect();
        const x = r.left + rand(0.2, 0.8) * r.width, y = Math.min(r.bottom, vh() - 100);
        addFx({ x, y, n: 7, dist: 26, size: 4, colors: ["#d6a85c", "#b45309", "#fde68a"], dur: 0.8 }, 900);
        if (Math.random() < 0.55) addFx({ text: pick(["crunch", "cronch", "scritch", "miam"]), x: x + rand(-24, 24), y: y - 16, size: 13, color: "#fef3c7", edge: "#78350f" }, 1000);
        ctl.anim(o.c, [{ transform: "translateX(0)" }, { transform: "translateX(-1.5px)" }, { transform: "translateX(1.5px)" }, { transform: "translateX(0)" }],
          { duration: 200, iterations: 2 });
      }
      ctl.after(rand(1300, 2200), nibble);
    };
    ctl.after(900, nibble);
    const wander = () => {
      if (g.ref.current !== "play") return;
      if (n > 1 && !busy.current.has(cardsRef.current[hide.current].c)) {
        const from = hide.current;
        let to = from;
        while (to === from) to = randInt(0, n - 1);
        const a = spotOf(from), b = spotOf(to);
        hide.current = to;
        setDash({ id: performance.now(), x0: a.x, y0: a.y, x1: b.x, y1: b.y, f: b.x >= a.x ? 1 : -1 });
        addFx({ text: "hi hi !", x: a.x, y: a.y - 30, size: 14, color: "#fce7f3", edge: "#831843" }, 1000);
      }
      ctl.after(rand(9000, 12500), wander);
    };
    ctl.after(rand(9000, 11000), wander);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const lift = (i, keep) => {
    const o = cardsRef.current[i];
    if (!o) return;
    busy.current.add(o.c);
    s.ctl.set(o.c, { "transform-origin": "50% 0%" });
    const P = "perspective(800px) ";
    const kf = keep
      ? [{ transform: P + "rotateX(0deg)" }, { transform: P + "rotateX(-40deg) translateY(-6px)", offset: 0.25 }, { transform: P + "rotateX(-40deg) translateY(-6px)", offset: 0.8 }, { transform: P + "rotateX(0deg)" }]
      : [{ transform: P + "rotateX(0deg)" }, { transform: P + "rotateX(-40deg) translateY(-6px)", offset: 0.3 }, { transform: P + "rotateX(-40deg) translateY(-6px)", offset: 0.6 }, { transform: P + "rotateX(0deg)" }];
    s.ctl.anim(o.c, kf, { duration: keep ? 2200 : 1100, easing: "ease-in-out" });
    s.ctl.after(keep ? 2250 : 1150, () => busy.current.delete(o.c));
  };
  const down = e => {
    if (g.ref.current !== "play") return;
    const i = cardsRef.current.findIndex(o => {
      const r = o.c.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (i < 0 || busy.current.has(cardsRef.current[i].c)) return;
    setTries(n => n + 1);
    if (i === hide.current) {
      const sp = spotOf(i);
      lift(i, true);
      setFound({ x: sp.x, y: sp.y, run: false, dir: sp.x < vw() / 2 ? -1 : 1 });
      addFx({ text: "Couic !", x: sp.x, y: sp.y - 60, size: 26, color: "#fce7f3", edge: "#831843" });
      s.ctl.after(700, () => setFound(f => (f ? { ...f, run: true } : f)));
      g.win();
    } else {
      lift(i, false);
      const sp = spotOf(i);
      addFx({ text: pick(["Pas là !", "Que dalle", "Rien…", "Des miettes…"]), x: sp.x, y: sp.y - 40, size: 16, color: "#e2e8f0", edge: "#334155" }, 1000);
      addFx({ x: sp.x, y: sp.y - 6, n: 6, dist: 30, size: 5, colors: ["#d6d3d1", "#a8a29e"] }, 800);
    }
  };
  return (
    <Layer s={s} css={SOURIS_CSS}>
      <Catcher on={g.play} cursor="pointer" onPointerDown={down}/>
      {dash && g.play && (
        <div key={dash.id} aria-hidden="true" style={{ position: "absolute", left: -27, top: -32, "--x0": `${dash.x0}px`, "--y0": `${dash.y0}px`,
          "--x1": `${dash.x1}px`, "--y1": `${dash.y1}px`, "--f": dash.f, animation: "pk-souris-dash .75s ease-in-out both" }}>
          <div style={{ animation: "pk-souris-hop .12s linear infinite" }}><Mouse/></div>
        </div>
      )}
      {found && (
        <div aria-hidden="true" style={{ position: "absolute", left: found.run ? found.x + found.dir * (vw() + 80) : found.x, top: found.y,
          transition: found.run ? "left 1.1s cubic-bezier(.5,0,.8,.6)" : "none" }}>
          <div style={{ transform: "translate(-50%,-100%)", animation: "pk-souris-pop .4s cubic-bezier(.3,1.5,.5,1) both" }}>
            <div style={{ transform: `scaleX(${found.dir})`, animation: found.run ? "pk-souris-hop .12s linear infinite" : "none" }}><Mouse size={64}/></div>
          </div>
        </div>
      )}
      <FxLayer k="souris" fx={fx}/>
      {g.play && (tries >= 4 ? <Pill key="b">Écoute bien… ça grignote quelque part. Et elle déménage, la coquine !</Pill>
        : <Pill key="a">🐭 Une souris grignote sous une carte ! Soulève les cartes pour la débusquer.</Pill>)}
      {g.phase === "won" && <Pill key="w" fade>Débusquée ! Elle file avec un bout de PLA. Bon appétit.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 16. Interrupteurs
// ════════════════════════════════════════════════════════════════════════════
const INTER_CSS = fxCss("interrupteurs") + `
@keyframes pk-interrupteurs-flick { 0% { opacity: .2 } 30% { opacity: 1 } 45% { opacity: .4 } 100% { opacity: 1 } }
`;
const NEIGH9 = i => {
  const r = Math.floor(i / 3), c = i % 3, out = [i];
  if (r > 0) out.push(i - 3);
  if (r < 2) out.push(i + 3);
  if (c > 0) out.push(i - 1);
  if (c < 2) out.push(i + 1);
  return out;
};
function Bulb({ on }) {
  return (
    <svg width="44" height="54" viewBox="0 0 44 54" aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      {on && <circle cx="22" cy="20" r="24" fill="rgba(253,224,71,.35)" style={{ filter: "blur(6px)" }}/>}
      <path d="M22 2 C 10 2, 4 11, 4 20 C 4 28, 10 31, 13 37 L 31 37 C 34 31, 40 28, 40 20 C 40 11, 34 2, 22 2 Z"
        fill={on ? "#fde047" : "rgba(148,163,184,.35)"} stroke={on ? "#f59e0b" : "#64748b"} strokeWidth="1.8"/>
      <path d="M16 30 Q 22 18 28 30" fill="none" stroke={on ? "#b45309" : "#475569"} strokeWidth="1.6"/>
      {on && <ellipse cx="15" cy="13" rx="4" ry="6" fill="rgba(255,255,255,.65)" transform="rotate(25 15 13)"/>}
      <rect x="13" y="37" width="18" height="11" rx="2" fill="#9ca3af" stroke="#4b5563"/>
      <path d="M13 41 H31 M13 44.5 H31" stroke="#4b5563" strokeWidth="1"/>
      <rect x="17" y="48" width="10" height="4" rx="2" fill="#374151"/>
    </svg>
  );
}
function Interrupteurs({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const [lights, setLights] = useState(() => {
    const L = Array(9).fill(true);
    shuffle(ID9.slice()).slice(0, randInt(3, 4)).forEach(i => NEIGH9(i).forEach(j => { L[j] = !L[j]; }));
    return L;
  });
  const lRef = useRef(lights);
  const [stamp, setStamp] = useState({});
  const [hint, setHint] = useState(false);
  useEffect(() => {
    s.ctl.after(25000, () => setHint(true));
    g.hooks.current.giveUp = () => { lRef.current = Array(9).fill(true); setLights(lRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const press = i => {
    if (g.ref.current !== "play") return;
    const L = lRef.current.slice(), st2 = {};
    NEIGH9(i).forEach(j => { L[j] = !L[j]; st2[j] = performance.now(); });
    lRef.current = L;
    setLights(L);
    setStamp(o => ({ ...o, ...st2 }));
    if (L.every(Boolean)) g.win();
  };
  const lit = lights.filter(Boolean).length;
  const narrow = isNarrow();
  return (
    <Layer s={s} css={INTER_CSS}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(2,4,12,.9)", opacity: g.play ? 0.97 * (1 - lit / 9) + 0.03 : 0,
        transition: "opacity .45s ease", pointerEvents: g.play ? "auto" : "none" }}/>
      <div style={{ position: "absolute", left: "50%", top: narrow ? "42%" : "46%", width: 0, height: 0,
        animation: g.play ? "pk-kit-pop .45s ease-out both" : "pk-kit-fade .6s ease .8s both" }}>
      <div style={{ position: "absolute", left: 0, top: 0, transform: "translate(-50%,-50%)", padding: "14px 16px 16px",
        borderRadius: 18, background: "linear-gradient(160deg, #e2e8f0, #94a3b8)", border: "2px solid #64748b",
        boxShadow: "0 20px 50px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.7)", fontFamily: FONT,
        pointerEvents: g.play ? "auto" : "none" }}>
        <div style={{ textAlign: "center", fontSize: 11, fontWeight: 900, letterSpacing: ".18em", color: "#334155", marginBottom: 10 }}>
          TABLEAU ÉLECTRIQUE · {lit}/9
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 70px)", gap: 8 }}>
          {lights.map((on, i) => (
            <button key={i} onClick={() => press(i)} aria-label={`Ampoule ${i + 1} ${on ? "allumée" : "éteinte"}`} aria-pressed={on}
              style={{ width: 70, height: 70, borderRadius: 14, border: "1px solid #475569", cursor: "pointer", padding: 0,
                display: "flex", alignItems: "center", justifyContent: "center", touchAction: "manipulation",
                background: on ? "radial-gradient(circle at 50% 40%, #fef9c3, #475569 75%)" : "radial-gradient(circle at 50% 40%, #334155, #0f172a 80%)",
                boxShadow: on ? "0 0 18px rgba(253,224,71,.55), inset 0 0 0 2px rgba(253,224,71,.4)" : "inset 0 3px 8px rgba(0,0,0,.6)" }}>
              <div key={stamp[i] || 0} style={{ animation: stamp[i] ? "pk-interrupteurs-flick .35s ease both" : "none" }}><Bulb on={on}/></div>
            </button>
          ))}
        </div>
      </div>
      </div>
      {g.play && (hint ? <Pill key="h">Câblage maison : chaque ampoule entraîne aussi ses voisines…</Pill>
        : <Pill key="a">💡 Les plombs ont sauté ! Allume les 9 ampoules pour rendre la lumière à l'atelier.</Pill>)}
      {g.phase === "won" && <Pill key="b" fade>Lumière ! L'électricien peut rentrer chez lui.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 17. Boussole
// ════════════════════════════════════════════════════════════════════════════
const BOUSSOLE_CSS = fxCss("boussole") + `
@keyframes pk-boussole-mark { 0%, 100% { transform: translate(-50%, 0) } 50% { transform: translate(-50%, 5px) } }
`;
function Boussole({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const geo = useMemo(() => ({ x: vw() / 2, y: Math.round(vh() * 0.45), R: isNarrow() ? 94 : 112 }), []);
  const [ang, setAng] = useState(() => (Math.random() < 0.5 ? -1 : 1) * rand(80, 160));
  const angRef = useRef(ang);
  const [held, setHeld] = useState(false);
  const [fx, addFx] = useFx(s);
  const d = useRef(null);
  const setA = a => { angRef.current = a; setAng(a); };
  const snap = () => {
    setA(0);
    if (g.win()) addFx({ x: geo.x, y: geo.y - geo.R - 10, n: 14, dist: 70, colors: ["#ef4444", "#fde047", "#fff"] });
  };
  useEffect(() => {
    const { ctl } = s;
    const parts = ctl.parts();
    parts.forEach(p => ctl.set(p, { "transform-origin": ctl.originOf(p) }));
    // pas d'ascenseur horizontal pendant que la page penche
    const main = ctl.main();
    if (main) ctl.set(main, { "overflow-x": "hidden" });
    let cur = 0;
    ctl.loop((t, dt) => {
      const play = g.ref.current === "play";
      const target = play ? wrap180(angRef.current) / 180 * 38 + (s.reduced ? 0 : Math.sin(t * 1.3) * 1.6) : 0;
      cur += (target - cur) * Math.min(1, dt * (play ? 5 : 4));
      if (!play && Math.abs(cur) < 0.05) {
        parts.forEach(p => ctl.unset(p, ["transform", "transform-origin"]));
        if (main) ctl.unset(main, ["overflow-x"]);
        return false;
      }
      parts.forEach(p => ctl.set(p, { transform: `rotate(${cur.toFixed(2)}deg)` }));
      return true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const deg = e => Math.atan2(e.clientY - geo.y, e.clientX - geo.x) * 180 / Math.PI;
  const down = e => {
    if (g.ref.current !== "play") return;
    e.preventDefault();
    capture(e);
    d.current = { prev: deg(e) };
    setHeld(true);
  };
  const move = e => {
    const D = d.current;
    if (!D || g.ref.current !== "play") return;
    const a = deg(e);
    const na = angRef.current + wrap180(a - D.prev);
    D.prev = a;
    if (Math.abs(wrap180(na)) < 4) { d.current = null; setHeld(false); snap(); return; }
    setA(na);
  };
  const up = () => {
    if (!d.current) return;
    d.current = null;
    setHeld(false);
    if (Math.abs(wrap180(angRef.current)) < 12) snap();
  };
  const key = e => {
    if (g.ref.current !== "play") return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const na = angRef.current + (e.key === "ArrowLeft" ? -10 : 10);
      if (Math.abs(wrap180(na)) < 6) snap(); else setA(na);
    }
  };
  const R = geo.R, won = g.phase === "won";
  const letters = [["N", 0, "#ef4444"], ["E", 90, "#e5e7eb"], ["S", 180, "#e5e7eb"], ["O", 270, "#e5e7eb"]];
  return (
    <Layer s={s} css={BOUSSOLE_CSS}>
      <Catcher on={g.play}/>
      <div style={{ position: "absolute", left: geo.x, top: geo.y, width: 0, height: 0,
        animation: g.play ? "pk-kit-pop .5s ease-out both" : `pk-kit-fade .6s ease ${won ? 1 : 0}s both` }}>
        <div aria-hidden="true" style={{ position: "absolute", left: 0, top: -R - 30, fontSize: 18, color: "#ef4444",
          animation: "pk-boussole-mark 1.4s ease-in-out infinite", textShadow: "0 2px 4px rgba(0,0,0,.5)" }}>▼</div>
        <div role="slider" tabIndex={0} aria-label="Boussole" aria-valuemin={-180} aria-valuemax={180} aria-valuenow={Math.round(wrap180(ang))}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
          style={{ position: "absolute", left: -R - 12, top: -R - 12, width: 2 * R + 24, height: 2 * R + 24, borderRadius: "50%",
            background: "radial-gradient(circle at 35% 30%, #fde68a, #b45309 60%, #78350f)", boxShadow: "0 18px 40px rgba(0,0,0,.55)",
            cursor: held ? "grabbing" : "grab", touchAction: "none", pointerEvents: g.play ? "auto" : "none", outline: "none" }}>
          <div style={{ position: "absolute", inset: 10, borderRadius: "50%", background: "radial-gradient(circle, #1e293b, #0f172a)",
            boxShadow: "inset 0 4px 12px rgba(0,0,0,.7)", overflow: "hidden" }}>
            <svg width={2 * R + 4} height={2 * R + 4} viewBox="-100 -100 200 200" aria-hidden="true"
              style={{ display: "block", transform: `rotate(${ang.toFixed(1)}deg)`, transition: held ? "none" : "transform .35s cubic-bezier(.3,1.4,.5,1)" }}>
              {Array.from({ length: 36 }, (_, i) => (
                <line key={i} x1="0" y1={i % 9 === 0 ? -90 : -94} x2="0" y2="-99" stroke="rgba(226,232,240,.6)" strokeWidth={i % 9 === 0 ? 2 : 1}
                  transform={`rotate(${i * 10})`}/>
              ))}
              {letters.map(([l, a, c]) => (
                <text key={l} x="0" y="-70" textAnchor="middle" dominantBaseline="middle" fill={c} fontSize="20" fontWeight="900"
                  fontFamily={FONT} transform={`rotate(${a})`}>{l}</text>
              ))}
              <path d="M0 -58 L 11 0 L -11 0 Z" fill="#ef4444"/>
              <path d="M0 58 L 11 0 L -11 0 Z" fill="#e5e7eb"/>
              <circle r="7" fill="#fbbf24" stroke="#78350f" strokeWidth="2"/>
            </svg>
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", pointerEvents: "none",
              background: "radial-gradient(circle at 30% 25%, rgba(255,255,255,.28), transparent 40%)" }}/>
          </div>
        </div>
      </div>
      <FxLayer k="boussole" fx={fx}/>
      {g.play && <Pill key="a">🧭 L'atelier a perdu le nord ! Fais tourner la boussole (glisse en rond) pour que le N vise le haut.</Pill>}
      {won && <Pill key="b" fade>Cap au nord ! L'accueil retrouve son aplomb.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 18. Cles
// ════════════════════════════════════════════════════════════════════════════
const CLES_CSS = fxCss("cles") + `
@keyframes pk-cles-swing { 0%, 100% { transform: rotate(-3deg) } 50% { transform: rotate(3deg) } }
@keyframes pk-cles-slam { from { transform: scaleX(.05) } to { transform: scaleX(1) } }
`;
const CLES_GAGS = [
  "Ça, c'est la clé Allen de 2,5. Elle ne rentre même pas.",
  "Clé USB. Ça ne se tourne pas, ça s'insère trois fois.",
  "Clé de 7 pour la buse. Presque !",
  "La clé de la cave à PETG humide. Beurk.",
  "Clé à molette miniature. Elle a molleté… tout court.",
];
function KeyV({ c, bend = 0 }) {
  return (
    <svg width="30" height="100" viewBox="0 0 30 100" aria-hidden="true" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 3px 3px rgba(0,0,0,.45))" }}>
      <g style={{ transformBox: "view-box", transformOrigin: "15px 46px", transform: `rotate(${bend}deg)`, transition: "transform .35s cubic-bezier(.3,1.6,.5,1)" }}>
        <rect x="11" y="6" width="8" height="42" rx="2" fill="#cbd5e1" stroke="#475569" strokeWidth="1"/>
        <path d="M19 10 h6 v5 h-3 v4 h4 v6 h-7" fill="#cbd5e1" stroke="#475569" strokeWidth="1"/>
      </g>
      <rect x="11" y="44" width="8" height="26" rx="2" fill="#cbd5e1" stroke="#475569" strokeWidth="1"/>
      <circle cx="15" cy="82" r="14" fill={c} stroke="rgba(0,0,0,.35)" strokeWidth="1.5"/>
      <circle cx="15" cy="84" r="4.5" fill="rgba(0,0,0,.4)"/>
      <ellipse cx="10" cy="76" rx="4" ry="2.2" fill="rgba(255,255,255,.5)"/>
    </svg>
  );
}
function Cles({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const geo = useMemo(() => {
    const W = vw(), H = vh();
    return { W, H, lock: { x: W / 2 + 30, y: Math.round(H * 0.34) }, ring: { x: W / 2, y: Math.round(H * 0.52) } };
  }, []);
  const good = useMemo(() => randInt(0, 5), []);
  const gags = useMemo(() => shuffle(CLES_GAGS.slice()), []);
  const [keys, setKeys] = useState(() => Array.from({ length: 6 }, (_, i) => ({ i, st: "ring", bend: 0, sx: 1, fx: 0, fr: 0 })));
  const [busy, setBusy] = useState(false);
  const [gag, setGag] = useState(null);
  const [fails, setFails] = useState(0);
  const [fx, addFx] = useFx(s);
  const upd = (i, o) => setKeys(ks => ks.map(k => (k.i === i ? { ...k, ...o } : k)));
  const tryKey = i => {
    if (busy || g.ref.current !== "play") return;
    setBusy(true);
    setGag(null);
    upd(i, { st: "lock" });
    const { ctl } = s;
    if (i === good) {
      ctl.after(520, () => { upd(i, { sx: 0.18 }); addFx({ text: "CLAC !", x: geo.lock.x, y: geo.lock.y - 50, size: 30 }); });
      ctl.after(900, () => g.win());
    } else {
      ctl.after(520, () => upd(i, { sx: 0.6 }));
      ctl.after(700, () => upd(i, { sx: 1 }));
      ctl.after(860, () => {
        upd(i, { bend: pick([-38, 34, -28, 42]) });
        addFx({ text: pick(["BOING !", "CRAC !", "TWANG !", "SCRONCH !"]), x: geo.lock.x + 40, y: geo.lock.y - 46, size: 26 });
        const n = fails + 1;
        setFails(n);
        setGag(gags[(n - 1) % gags.length]);
      });
      ctl.after(1500, () => { upd(i, { st: "out", fx: rand(0.1, 0.9) * geo.W, fr: rand(-120, 120) }); setBusy(false); });
    }
  };
  const place = k => {
    if (k.st === "lock") return { x: geo.lock.x + 52, y: geo.lock.y, r: -90, o: 1 };
    if (k.st === "out") return { x: k.fx, y: geo.H - (isNarrow() ? 150 : 90), r: k.fr, o: 0.55 };
    const a = (-82.5 + k.i * 33) * Math.PI / 180, L = 60;
    return { x: geo.ring.x - L * Math.sin(a), y: geo.ring.y + L * Math.cos(a), r: -82.5 + k.i * 33, o: 1 };
  };
  const won = g.phase === "won", over = !g.play;
  const door = side => ({ position: "absolute", top: 0, bottom: 0, [side]: 0, width: "50.2%",
    background: "repeating-linear-gradient(90deg, rgba(0,0,0,.07) 0 3px, transparent 3px 17px), linear-gradient(90deg, #7c4a1e, #9a5b26 50%, #6b3d16)",
    boxShadow: `inset 0 0 0 10px #5b3412, inset 0 0 0 12px rgba(0,0,0,.35), inset ${side === "left" ? -8 : 8}px 0 20px rgba(0,0,0,.4)`,
    transformOrigin: side === "left" ? "0 50%" : "100% 50%",
    transform: won ? `perspective(1200px) rotateY(${side === "left" ? 100 : -100}deg)` : "none",
    transition: "transform 1.3s cubic-bezier(.5,0,.3,1), opacity .5s ease 1.1s", opacity: over ? 0 : 1,
    animation: "pk-cles-slam .7s cubic-bezier(.6,0,.4,1.3) backwards" });
  return (
    <Layer s={s} css={CLES_CSS}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: g.play ? "auto" : "none" }}>
        <div style={door("left")}>
          {[0.18, 0.58].map(f => <div key={f} style={{ position: "absolute", left: "16%", right: "12%", top: `${f * 100}%`, height: "28%",
            borderRadius: 6, boxShadow: "inset 0 0 0 4px rgba(0,0,0,.18), inset 2px 2px 0 6px rgba(255,255,255,.06)" }}/>)}
        </div>
        <div style={door("right")}>
          {[0.18, 0.58].map(f => <div key={f} style={{ position: "absolute", left: "12%", right: "16%", top: `${f * 100}%`, height: "28%",
            borderRadius: 6, boxShadow: "inset 0 0 0 4px rgba(0,0,0,.18), inset 2px 2px 0 6px rgba(255,255,255,.06)" }}/>)}
        </div>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: geo.lock.x - 22, top: geo.lock.y - 46, width: 44, height: 92, borderRadius: 12,
        background: "linear-gradient(160deg, #fde68a, #ca8a04 55%, #713f12)", border: "2px solid #713f12", boxShadow: "0 4px 10px rgba(0,0,0,.5)",
        opacity: over ? 0 : 1, transition: "opacity .4s ease .4s" }}>
        <div style={{ position: "absolute", left: 6, top: 40, width: 30, height: 9, borderRadius: 4, background: "#111" }}/>
      </div>
      {!over && (
        <div aria-hidden="true" style={{ position: "absolute", left: geo.ring.x - 20, top: geo.ring.y - 20, width: 40, height: 40, borderRadius: "50%",
          border: "4px solid #94a3b8", boxShadow: "0 2px 4px rgba(0,0,0,.5)" }}/>
      )}
      {keys.map(k => {
        const p = place(k);
        const clickable = g.play && !busy && k.st === "ring";
        return (
          <button key={k.i} onClick={() => tryKey(k.i)} aria-label={`Clé ${k.i + 1}`} disabled={!clickable}
            style={{ position: "absolute", left: 0, top: 0, width: 40, height: 104, padding: 0, border: "none", background: "transparent",
              cursor: clickable ? "pointer" : "default", pointerEvents: clickable ? "auto" : "none", touchAction: "manipulation",
              transform: `translate(${(p.x - 20).toFixed(1)}px,${(p.y - 52).toFixed(1)}px) rotate(${p.r}deg) scaleX(${k.sx})`,
              opacity: over && !won ? 0 : won && k.i !== good ? 0 : p.o,
              transition: "transform .5s cubic-bezier(.4,0,.2,1), opacity .5s ease" }}>
            <div style={{ width: 40, height: 104, display: "flex", justifyContent: "center", transformOrigin: "50% 0",
              animation: k.st === "ring" && !s.reduced ? `pk-cles-swing ${(2 + k.i * 0.17).toFixed(2)}s ease-in-out infinite` : "none" }}>
              <KeyV c={FILAMENTS[k.i]} bend={k.bend}/>
            </div>
          </button>
        );
      })}
      <FxLayer k="cles" fx={fx}/>
      {g.play && (gag ? <Pill key={"g" + fails}>{gag}</Pill>
        : <Pill key="a">🔑 Porte fermée ! Une seule clé du trousseau ouvre la serrure. Essaie-les…</Pill>)}
      {won && <Pill key="b" fade>Clac clac ! La bonne était forcément la dernière qu'on essaie. Ou presque.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 19. Bombe (de paillettes)
// ════════════════════════════════════════════════════════════════════════════
const BOMBE_CSS = fxCss("bombe") + `
@keyframes pk-bombe-led { 0%, 100% { opacity: 1 } 50% { opacity: .45 } }
@keyframes pk-bombe-flash { 0% { opacity: .95 } 100% { opacity: 0 } }
@keyframes pk-bombe-sparkle { 0%, 100% { transform: scale(.6) rotate(0deg); opacity: .4 } 50% { transform: scale(1.1) rotate(40deg); opacity: 1 } }
`;
const WIRES = [["rouge", "#ef4444"], ["bleu", "#3b82f6"], ["vert", "#22c55e"], ["jaune", "#eab308"]];
function Bombe({ done }) {
  const s = useStage(done);
  const g = useGame(s, 76000);
  const geo = useMemo(() => {
    const W = vw(), H = vh(), w = Math.min(320, W - 32), h = 316;
    const top = clamp(Math.round(H * 0.55 - h / 2), 170, Math.max(170, H - h - 120));
    return { W, H, w, h, left: Math.round((W - w) / 2), top };
  }, []);
  const good = useMemo(() => randInt(0, 3), []);
  const note = useMemo(() => {
    const o = shuffle([0, 1, 2, 3].filter(i => i !== good)).map(i => WIRES[i][0]);
    return `Jamais le ${o[0]}… ni le ${o[1]}. Et le ${o[2]} ? Juste pour faire joli.`;
  }, [good]);
  const [postit, setPostit] = useState(null);
  const [cut, setCut] = useState([false, false, false, false]);
  const [msg, setMsg] = useState(0);
  const [shake, setShake] = useState(0);
  const [fx, addFx] = useFx(s);
  const timeRef = useRef(null);
  const tm = useRef({ start: 0, pen: 0, stop: false, left: 60 });
  useEffect(() => {
    const { ctl } = s;
    const W = geo.W, H = geo.H, PW = 136, PH = 100;
    const hit = (x, y) => !(x + PW < geo.left - 14 || x > geo.left + geo.w + 14 || y + PH < geo.top - 14 || y > geo.top + geo.h + 14);
    const ok = (x, y) => x >= 8 && x + PW <= W - 8 && y >= 60 && y + PH <= H - 110 && !hit(x, y);
    const cands = [];
    visibleCards(ctl, 20, 0, 0).forEach(({ r }) => {
      [[r.right - PW - 10, r.top + 10], [r.left + 10, r.top + 10], [r.right - PW - 10, r.bottom - PH - 10], [r.left + 10, r.bottom - PH - 10]]
        .forEach(([x, y]) => { if (ok(x, y)) cands.push({ x, y }); });
    });
    let p = cands.length ? pick(cands) : null;
    if (!p) p = [{ x: 10, y: 64 }, { x: W - PW - 10, y: 64 }, { x: 10, y: H - PH - 116 }].find(q => ok(q.x, q.y)) || { x: 10, y: 64 };
    setPostit({ ...p, rot: rand(-7, 7) });
    ctl.loop(t => {
      const T = tm.current;
      if (!T.stop) T.left = Math.max(0, 60 - t - T.pen);
      const v = T.left, mm = Math.floor(v / 60), ss = Math.floor(v % 60), cs = Math.floor((v * 10) % 10);
      if (timeRef.current) timeRef.current.textContent = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${cs}`;
      if (!T.stop && v <= 0 && g.ref.current === "play") {
        T.stop = true;
        g.go("boom");
        ctl.after(4200, () => ctl.restore());
        return false;
      }
      return g.ref.current === "play";
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const snip = (i, e) => {
    if (g.ref.current !== "play" || cut[i]) return;
    const nc = cut.slice(); nc[i] = true;
    setCut(nc);
    const x = e && e.clientX ? e.clientX : geo.left + geo.w / 2, y = e && e.clientY ? e.clientY : geo.top + 150 + i * 44;
    addFx({ text: "CLIC", x, y: y - 24, size: 20, color: "#fff", edge: "#334155" }, 900);
    if (i === good) {
      tm.current.stop = true;
      setMsg(2);
      addFx({ x: geo.left + geo.w / 2, y: geo.top + 60, n: 20, dist: 90 });
      g.win();
    } else {
      tm.current.pen += 15;
      setMsg(1);
      setShake(n => n + 1);
      addFx({ x, y, n: 22, dist: 80, colors: ["#f0abfc", "#fde047", "#a5f3fc", "#fff"] });
      addFx({ text: "PSCHITT", x: geo.left + geo.w / 2, y: geo.top + 40, size: 26, color: "#f0abfc", edge: "#701a75" });
    }
  };
  const won = g.phase === "won", boom = g.phase === "boom";
  return (
    <Layer s={s} css={BOMBE_CSS}>
      <Catcher on={g.play} style={{ background: g.play ? "rgba(2,6,23,.28)" : "transparent", transition: "background .6s" }}/>
      {postit && !boom && (
        <div aria-hidden="true" style={{ position: "absolute", left: postit.x, top: postit.y, width: 136, minHeight: 100, padding: "16px 10px 10px",
          boxSizing: "border-box", background: "linear-gradient(180deg, #fde68a, #fcd34d)", color: "#1f2937", fontSize: 12.5, lineHeight: 1.3,
          fontFamily: '"Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive', transform: `rotate(${postit.rot.toFixed(1)}deg)`,
          boxShadow: "0 8px 14px rgba(0,0,0,.3)", opacity: won ? 0 : 1, transition: "opacity .8s ease 1s", animation: "pk-kit-fadein .6s ease .8s both" }}>
          <span style={{ position: "absolute", left: "50%", top: -8, transform: "translateX(-50%)", fontSize: 16 }}>📌</span>
          {note}
        </div>
      )}
      <div key={shake} style={{ position: "absolute", left: geo.left, top: geo.top, width: geo.w, padding: 14, boxSizing: "border-box", borderRadius: 18,
        background: "linear-gradient(160deg, #3b0764, #1e1b4b)", border: "2px solid #a855f7", fontFamily: FONT,
        boxShadow: "0 0 40px rgba(168,85,247,.35), 0 20px 50px rgba(0,0,0,.6)", pointerEvents: g.play ? "auto" : "none",
        animation: shake ? "pk-bombe-shake .45s ease" : boom ? "none" : "pk-kit-pop .5s ease-out both",
        opacity: boom || won ? 0 : 1, transition: `opacity ${boom ? 0.1 : 0.8}s ease ${won ? 1.2 : 0}s` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div aria-hidden="true" style={{ position: "relative", width: 64, height: 78, borderRadius: "20px 20px 14px 14px", flexShrink: 0,
            background: "linear-gradient(90deg, #db2777, #f472b6 45%, #9d174d)", boxShadow: "inset 0 -6px 0 rgba(0,0,0,.2)" }}>
            <div style={{ position: "absolute", left: 22, top: -10, width: 20, height: 12, borderRadius: 4, background: "#94a3b8" }}/>
            <div style={{ position: "absolute", left: 4, right: 4, top: 30, padding: "2px 0", background: "#fff", color: "#9d174d",
              fontSize: 7.5, fontWeight: 900, textAlign: "center", letterSpacing: ".04em" }}>PAILLETTES</div>
            {[[10, 12], [44, 18], [26, 56]].map(([x, y], i) => (
              <span key={i} style={{ position: "absolute", left: x, top: y, fontSize: 11, animation: `pk-bombe-sparkle 1.4s ease-in-out ${i * 0.4}s infinite` }}>✨</span>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".14em", color: "#e9d5ff" }}>BOMBE DE PAILLETTES</div>
            <div style={{ marginTop: 6, padding: "6px 8px", borderRadius: 8, background: "#0a0a0a", border: "2px solid #334155",
              color: won ? "#4ade80" : "#ef4444", fontFamily: "ui-monospace, Consolas, monospace", fontSize: 26, fontWeight: 900,
              textShadow: won ? "0 0 8px rgba(74,222,128,.8)" : "0 0 8px rgba(239,68,68,.8)", textAlign: "center",
              animation: won ? "none" : "pk-bombe-led 1s steps(2) infinite" }}>
              {won ? "DÉSAMORCÉ" : <span ref={timeRef}>01:00.0</span>}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 4 }}>
          {WIRES.map(([name, c], i) => (
            <button key={name} onClick={e => snip(i, e)} disabled={cut[i] || !g.play} aria-label={`Couper le fil ${name}`}
              style={{ height: 44, padding: 0, border: "none", borderRadius: 8, background: "rgba(255,255,255,.04)",
                cursor: cut[i] ? "default" : "crosshair", touchAction: "manipulation", position: "relative" }}>
              <svg width="100%" height="44" viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true" style={{ display: "block" }}>
                <rect x="2" y="16" width="10" height="12" rx="2" fill="#94a3b8"/>
                <rect x="188" y="16" width="10" height="12" rx="2" fill="#94a3b8"/>
                {cut[i] ? (
                  <>
                    <path d="M12 22 C 40 10, 60 34, 92 30" fill="none" stroke={c} strokeWidth="5" strokeLinecap="round"/>
                    <path d="M108 34 C 140 34, 160 10, 188 22" fill="none" stroke={c} strokeWidth="5" strokeLinecap="round"/>
                  </>
                ) : (
                  <path d={`M12 22 C 50 ${i % 2 ? 8 : 36}, 150 ${i % 2 ? 36 : 8}, 188 22`} fill="none" stroke={c} strokeWidth="5" strokeLinecap="round"/>
                )}
              </svg>
            </button>
          ))}
        </div>
      </div>
      <FxLayer k="bombe" fx={fx}/>
      {won && <Glitter k="bombe" n={50} spread={2}/>}
      {boom && (
        <>
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "#fdf4ff", animation: "pk-bombe-flash .7s ease-out both" }}/>
          <Glitter k="bombe" n={160} spread={3.5} colors={["#f0abfc", "#fde047", "#a5f3fc", "#f472b6", "#fff", "#c4b5fd"]}/>
        </>
      )}
      {g.play && (msg === 1 ? <Pill key={"m" + cut.filter(Boolean).length}>Pschitt ! Mauvais fil : −15 secondes et des paillettes partout.</Pill>
        : <Pill key="a">💣 Une bombe de paillettes ! Coupe le bon fil avant la fin. Quelqu'un a laissé un mot…</Pill>)}
      {won && <Pill key="b" fade>Désamorcée ! Pas une paillette au sol. Enfin, presque.</Pill>}
      {boom && <Pill key="c" fade>BOUM ! Pailleté de la tête aux buses… Une autre fois ! 🙂</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 20. Demineur
// ════════════════════════════════════════════════════════════════════════════
const DEMINEUR_CSS = fxCss("demineur");
const NUM_COLORS = ["", "#3b82f6", "#16a34a", "#dc2626", "#7c3aed", "#b45309", "#0891b2", "#111827", "#6b7280"];
const neigh25 = i => {
  const r = Math.floor(i / 5), c = i % 5, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < 5 && cc >= 0 && cc < 5) out.push(rr * 5 + cc);
  }
  return out;
};
const freshBoard = () => ({ mines: null, open: Array(25).fill(false), flag: Array(25).fill(false), boom: -1 });
function Demineur({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const [b, setB] = useState(freshBoard);
  const bRef = useRef(b);
  const [round, setRound] = useState(1);
  const [flagMode, setFlagMode] = useState(false);
  const [fx, addFx] = useFx(s);
  const press = useRef({ tok: 0, long: false });
  const cellRefs = useRef([]);
  const commit = nb => { bRef.current = nb; setB(nb); };
  const center = i => {
    const el = cellRefs.current[i];
    if (!el) return { x: vw() / 2, y: vh() / 2 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const count = (mines, i) => neigh25(i).filter(j => mines[j]).length;
  const reveal = i => {
    const cur = bRef.current;
    if (g.ref.current !== "play" || cur.boom >= 0 || cur.open[i] || cur.flag[i]) return;
    let mines = cur.mines;
    if (!mines) {
      const safe = new Set([i, ...neigh25(i)]);
      const pool = shuffle(Array.from({ length: 25 }, (_, k) => k).filter(k => !safe.has(k)));
      mines = Array(25).fill(false);
      pool.slice(0, 4).forEach(k => { mines[k] = true; });
    }
    const open = cur.open.slice();
    if (mines[i]) {
      commit({ ...cur, mines, open: open.map((o, k) => o || mines[k]), boom: i });
      const c = center(i);
      addFx({ x: c.x, y: c.y, n: 26, dist: 120, colors: ["#f0abfc", "#fde047", "#a5f3fc", "#fff", "#f472b6"] });
      addFx({ text: "POUF !", x: c.x, y: c.y - 30, size: 30, color: "#f0abfc", edge: "#701a75" });
      s.ctl.after(1700, () => { if (g.ref.current === "play") { commit(freshBoard()); setRound(n => n + 1); } });
      return;
    }
    const stack = [i];
    while (stack.length) {
      const k = stack.pop();
      if (open[k] || mines[k]) continue;
      open[k] = true;
      if (count(mines, k) === 0) neigh25(k).forEach(j => { if (!open[j] && !cur.flag[j]) stack.push(j); });
    }
    const flag = cur.flag.map((f, k) => f && !open[k]);
    const allOpen = open.every((o, k) => o || mines[k]);
    commit({ ...cur, mines, open, flag: allOpen ? mines.slice() : flag });
    if (allOpen) g.win();
  };
  const toggleFlag = i => {
    const cur = bRef.current;
    if (g.ref.current !== "play" || cur.boom >= 0 || cur.open[i]) return;
    const flag = cur.flag.slice(); flag[i] = !flag[i];
    commit({ ...cur, flag });
  };
  const down = (e, i) => {
    if (e.button === 2) return;
    const tok = ++press.current.tok;
    press.current.long = false;
    s.ctl.after(450, () => { if (press.current.tok === tok) { press.current.long = true; press.current.tok++; toggleFlag(i); } });
  };
  const click = i => {
    press.current.tok++;
    if (press.current.long) { press.current.long = false; return; }
    if (flagMode) toggleFlag(i); else reveal(i);
  };
  const flags = b.flag.filter(Boolean).length;
  const won = g.phase === "won";
  const C = isNarrow() ? 52 : 50;
  return (
    <Layer s={s} css={DEMINEUR_CSS}>
      <Catcher on={g.play} style={{ background: g.play ? "rgba(2,6,23,.45)" : "transparent", transition: "background .6s" }}/>
      <div style={{ position: "absolute", left: "50%", top: isNarrow() ? "43%" : "47%", padding: 14, borderRadius: 18, fontFamily: FONT,
        background: "var(--sheet-bg, #1a1d27)", color: "var(--text, #f1f5f9)", border: "1px solid rgba(139,92,246,.45)",
        boxShadow: "0 20px 50px rgba(0,0,0,.55)", pointerEvents: g.play ? "auto" : "none", transform: "translate(-50%,-50%)",
        opacity: g.play ? 1 : 0, transition: `opacity .6s ease ${won ? 1 : 0}s` }}>
        <div key={round} style={{ animation: b.boom >= 0 ? "pk-demineur-shake .45s ease" : "none" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
            <div style={{ fontWeight: 900, fontSize: 14 }}>💣 Démineur de l'atelier</div>
            <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.8 }}>🚩 {flags}/4</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(5, ${C}px)`, gap: 4 }}>
            {Array.from({ length: 25 }, (_, i) => {
              const open = b.open[i], mine = b.mines && b.mines[i], n = b.mines && open && !mine ? count(b.mines, i) : 0;
              return (
                <button key={i} ref={el => { cellRefs.current[i] = el; }} aria-label={`Case ${Math.floor(i / 5) + 1}-${i % 5 + 1}`}
                  onPointerDown={e => down(e, i)} onClick={() => click(i)}
                  onContextMenu={e => { e.preventDefault(); press.current.tok++; toggleFlag(i); }}
                  style={{ width: C, height: C, borderRadius: 8, padding: 0, cursor: open ? "default" : "pointer", touchAction: "manipulation",
                    fontFamily: FONT, fontWeight: 900, fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center",
                    WebkitUserSelect: "none", userSelect: "none",
                    border: open ? "1px solid rgba(148,163,184,.25)" : "1px solid rgba(0,0,0,.4)",
                    color: mine ? "#fff" : NUM_COLORS[n],
                    background: open ? (mine ? (b.boom === i ? "#db2777" : "#831843") : "rgba(148,163,184,.14)")
                      : "linear-gradient(160deg, #64748b, #334155)",
                    boxShadow: open ? "none" : "inset 0 2px 0 rgba(255,255,255,.25), 0 2px 0 rgba(0,0,0,.4)" }}>
                  {open ? (mine ? "✨" : n || "") : b.flag[i] ? "🚩" : ""}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, gap: 8 }}>
            <span style={{ fontSize: 11.5, opacity: 0.75 }}>Appui long ou clic droit : drapeau</span>
            <button onClick={() => setFlagMode(v => !v)} aria-pressed={flagMode}
              style={{ minHeight: 40, padding: "0 12px", borderRadius: 10, border: flagMode ? "2px solid #f97316" : "1px solid rgba(148,163,184,.4)",
                background: flagMode ? "rgba(249,115,22,.2)" : "transparent", color: "inherit", fontFamily: FONT, fontWeight: 800,
                fontSize: 13, cursor: "pointer" }}>🚩 {flagMode ? "Drapeaux" : "Creuser"}</button>
          </div>
        </div>
      </div>
      <FxLayer k="demineur" fx={fx}/>
      {won && <Glitter k="demineur" n={60} spread={2}/>}
      {g.play && (b.boom >= 0 ? <Pill key={"x" + round}>Pouf ! Une mine à paillettes. Nouveau terrain, on recommence…</Pill>
        : <Pill key="a">💣 4 mines (à paillettes) sous l'accueil ! Découvre toutes les cases sûres.</Pill>)}
      {won && <Pill key="b" fade>Terrain déminé ! Tu peux reposer le plateau.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 21. Jardin
// ════════════════════════════════════════════════════════════════════════════
const JARDIN_CSS = fxCss("jardin") + `
@keyframes pk-jardin-drop { from { transform: translate(0, 0); opacity: 1 } to { transform: translate(0, 60vh); opacity: 0 } }
`;
function smoothD(pts) {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l[0].toFixed(1)} ${l[1].toFixed(1)}`;
}
function Jardin({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const [vines, setVines] = useState([]);
  const [cut, setCut] = useState({});
  const cutRef = useRef({});
  const [grow, setGrow] = useState(0);
  const [fx, addFx] = useFx(s);
  const pathRefs = useRef([]), leafRefs = useRef({}), flowerRefs = useRef([]);
  const data = useRef([]);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh(), top = 66, bot = H - 120;
    const cards = visibleCards(ctl, 10, 60, 120);
    const N = 10, out = [];
    for (let i = 0; i < N; i++) {
      let x, y, a;
      if (cards.length) {
        const { r } = cards[i % cards.length], side = randInt(0, 3);
        if (side === 0) { x = rand(r.left + 10, r.right - 10); y = r.top; a = -90; }
        else if (side === 1) { x = r.right; y = rand(r.top, r.bottom); a = 0; }
        else if (side === 2) { x = rand(r.left + 10, r.right - 10); y = r.bottom; a = 90; }
        else { x = r.left; y = rand(r.top, r.bottom); a = 180; }
        a += rand(-55, 55);
      } else {
        x = rand(0.05, 0.95) * W; y = i % 2 ? top : bot; a = i % 2 ? 90 : -90;
      }
      x = clamp(x, 20, W - 20); y = clamp(y, top, bot);
      let ang = a * Math.PI / 180;
      const pts = [[x, y]], steps = randInt(16, 24), turn = rand(-0.22, 0.22), ph = rand(0, 6);
      const leaves = [];
      for (let k = 1; k <= steps; k++) {
        ang += turn * 0.4 + Math.sin(k * 0.7 + ph) * 0.32;
        const st = rand(18, 26);
        x += Math.cos(ang) * st; y += Math.sin(ang) * st;
        if (x < 20 || x > W - 20) { ang = Math.PI - ang; x = clamp(x, 20, W - 20); }
        if (y < top || y > bot) { ang = -ang; y = clamp(y, top, bot); }
        pts.push([x, y]);
        if (k % 2 === 0) leaves.push({ x, y, t: k / steps, rot: ang * 180 / Math.PI + (k % 4 ? 60 : -60), on: false });
      }
      out.push({ id: i, d: smoothD(pts), leaves, end: pts[pts.length - 1], delay: 0.3 + i * 0.75, speed: rand(0.034, 0.048), g: 0, cut: false, bloom: false });
    }
    data.current = out;
    setVines(out);
    let shown = -1;
    ctl.loop(t => {
      let sum = 0, alive = 0;
      out.forEach((v, i) => {
        if (v.cut) return;
        alive++;
        v.g = clamp((t - v.delay) * v.speed, 0, 1);
        sum += v.g;
        const p = pathRefs.current[i];
        if (p) p.forEach(el => { if (el) el.style.strokeDashoffset = (1 - v.g).toFixed(4); });
        v.leaves.forEach((lf, j) => {
          if (!lf.on && v.g >= lf.t) {
            lf.on = true;
            const el = leafRefs.current[i + "-" + j];
            if (el) el.style.transform = "scale(1)";
          }
        });
        if (!v.bloom && v.g >= 1) { v.bloom = true; const el = flowerRefs.current[i]; if (el) el.style.transform = "scale(1)"; }
      });
      const gr = alive ? sum / out.length : 0;
      const q = Math.round(gr * 20) / 20;
      if (q !== shown) { shown = q; setGrow(q); }
      return g.ref.current === "play";
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const snip = (e, i) => {
    e.stopPropagation();
    const v = data.current[i];
    if (g.ref.current !== "play" || !v || v.cut || v.g < 0.04) return;
    v.cut = true;
    cutRef.current = { ...cutRef.current, [i]: true };
    setCut(cutRef.current);
    addFx({ text: pick(["Clac !", "Snip !", "Tchac !"]), x: e.clientX, y: e.clientY - 24, size: 20, color: "#dcfce7", edge: "#14532d" }, 900);
    addFx({ x: e.clientX, y: e.clientY, n: 10, dist: 50, size: 7, colors: ["#16a34a", "#4ade80", "#166534"] });
    if (Object.keys(cutRef.current).length >= data.current.length) g.win();
  };
  const n = Object.keys(cut).length;
  return (
    <Layer s={s} css={JARDIN_CSS}>
      <Catcher on={g.play}/>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 100%, rgba(22,101,52,.5), rgba(22,101,52,.15) 70%)",
        opacity: g.play ? grow * 0.9 : 0, transition: "opacity 1s ease" }}/>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible",
        opacity: g.phase === "rendu" ? 0 : 1, transition: "opacity 1s ease" }}>
        {vines.map((v, i) => (
          <g key={v.id} style={{ animation: cut[i] ? "pk-jardin-drop .9s cubic-bezier(.5,0,.8,.5) both" : "none" }}>
            {["#14532d", "#16a34a"].map((c, k) => (
              <path key={k} ref={el => { (pathRefs.current[i] = pathRefs.current[i] || [])[k] = el; }} d={v.d} fill="none" stroke={c}
                strokeWidth={k ? 2.5 : 7} strokeLinecap="round" pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: 1 }}/>
            ))}
            {v.leaves.map((lf, j) => (
              <g key={j} transform={`translate(${lf.x.toFixed(1)} ${lf.y.toFixed(1)}) rotate(${lf.rot.toFixed(0)})`}>
                <path ref={el => { leafRefs.current[i + "-" + j] = el; }} d="M0 0 C 6 -9, 20 -9, 26 0 C 20 9, 6 9, 0 0 Z"
                  fill="#22c55e" stroke="#14532d" strokeWidth="1.2" style={{ transform: "scale(0)", transition: "transform .45s cubic-bezier(.3,1.6,.5,1)" }}/>
              </g>
            ))}
            <g transform={`translate(${v.end[0].toFixed(1)} ${v.end[1].toFixed(1)})`}>
              <g ref={el => { flowerRefs.current[i] = el; }} style={{ transform: "scale(0)", transition: "transform .6s cubic-bezier(.3,1.6,.5,1)" }}>
                {[0, 72, 144, 216, 288].map(a => <ellipse key={a} cx="0" cy="-8" rx="5" ry="8" fill="#f9a8d4" transform={`rotate(${a})`}/>)}
                <circle r="4.5" fill="#fde047"/>
              </g>
            </g>
            {!cut[i] && (
              <path d={v.d} fill="none" stroke="transparent" strokeWidth="38" strokeLinecap="round" aria-label="Liane"
                onPointerDown={e => snip(e, i)} style={{ pointerEvents: g.play ? "stroke" : "none", cursor: "pointer" }}/>
            )}
          </g>
        ))}
      </svg>
      <FxLayer k="jardin" fx={fx}/>
      {g.play && (grow > 0.6 ? <Pill key="b">Ça pousse, ça pousse ! Taille plus vite : {n}/{vines.length || 10}</Pill>
        : <Pill key="a">🌿 Les lianes envahissent l'atelier ! Touche-les pour les tailler : {n}/{vines.length || 10}</Pill>)}
      {g.phase === "won" && <Pill key="w" fade>Jardin taillé au cordeau. Le PLA, c'est biosourcé, pas une raison.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 22. Cible
// ════════════════════════════════════════════════════════════════════════════
const CIBLE_CSS = fxCss("cible") + `
@keyframes pk-cible-away { 0% { transform: scale(1) rotate(0deg); opacity: 1 } 100% { transform: scale(0) rotate(540deg); opacity: 0 } }
@keyframes pk-cible-hole { 0% { transform: translate(-50%,-50%) scale(.4); opacity: .9 } 100% { transform: translate(-50%,-50%) scale(1.3); opacity: 0 } }
@keyframes pk-cible-dart { from { transform: translate(-50%,-100%) rotate(var(--r)) translateY(-24px); opacity: 0 } to { transform: translate(-50%,-100%) rotate(var(--r)); opacity: 1 } }
`;
function Cible({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const R = isNarrow() ? 42 : 48;
  const tRef = useRef(null);
  const st = useRef({ x: vw() / 2, y: vh() * 0.45, a: rand(0, Math.PI * 2), sp: s.reduced ? 110 : 165, ph: rand(0, 6) });
  const [hits, setHits] = useState(0);
  const hitsRef = useRef(0);
  const [darts, setDarts] = useState([]);
  const [holes, setHoles] = useState([]);
  const [fx, addFx] = useFx(s);
  useEffect(() => {
    s.ctl.loop((t, dt) => {
      const S = st.current, W = vw(), H = vh();
      if (g.ref.current === "play") {
        S.a += Math.sin(t * 0.9 + S.ph) * 1.1 * dt;
        S.x += Math.cos(S.a) * S.sp * dt;
        S.y += Math.sin(S.a) * S.sp * dt;
        const x0 = R + 8, x1 = W - R - 8, y0 = R + 70, y1 = Math.max(y0 + 10, H - R - (isNarrow() ? 150 : 90));
        if (S.x < x0 || S.x > x1) { S.a = Math.PI - S.a; S.x = clamp(S.x, x0, x1); }
        if (S.y < y0 || S.y > y1) { S.a = -S.a; S.y = clamp(S.y, y0, y1); }
      }
      if (tRef.current) tRef.current.style.transform = `translate(${(S.x - R).toFixed(1)}px,${(S.y - R).toFixed(1)}px)`;
      return g.ref.current === "play";
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const down = e => {
    if (g.ref.current !== "play") return;
    const S = st.current, dx = e.clientX - S.x, dy = e.clientY - S.y;
    if (Math.hypot(dx, dy) < R + 6) {
      hitsRef.current += 1;
      setHits(hitsRef.current);
      const d = Math.hypot(dx, dy);
      setDarts(ds => [...ds, { id: performance.now(), dx, dy, r: rand(-35, 35) }]);
      addFx({ text: d < R * 0.3 ? "Dans le mille !" : "+1", x: e.clientX, y: e.clientY - 30, size: d < R * 0.3 ? 22 : 26 }, 1000);
      S.sp += s.reduced ? 25 : 45;
      S.a += rand(1.5, 4.5);
      if (hitsRef.current >= 5) g.win();
    } else {
      const id = performance.now();
      setHoles(h => [...h.slice(-5), { id, x: e.clientX, y: e.clientY }]);
      s.ctl.after(700, () => setHoles(h => h.filter(o => o.id !== id)));
    }
  };
  const won = g.phase === "won";
  return (
    <Layer s={s} css={CIBLE_CSS}>
      <Catcher on={g.play} cursor="crosshair" onPointerDown={down}/>
      {holes.map(h => (
        <span key={h.id} aria-hidden="true" style={{ position: "absolute", left: h.x, top: h.y, width: 22, height: 22, borderRadius: "50%",
          border: "2px solid rgba(148,163,184,.8)", animation: "pk-cible-hole .7s ease-out both" }}/>
      ))}
      <div ref={tRef} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: 2 * R, height: 2 * R,
        transform: `translate(${st.current.x - R}px,${st.current.y - R}px)`, opacity: g.phase === "rendu" ? 0 : 1, transition: "opacity .6s" }}>
        <div style={{ position: "relative", width: "100%", height: "100%",
          animation: won ? "pk-cible-away .8s cubic-bezier(.5,0,.8,.5) .35s both" : "pk-kit-pop .45s ease-out both" }}>
          <svg width={2 * R} height={2 * R} viewBox="-50 -50 100 100" style={{ display: "block", filter: "drop-shadow(0 6px 10px rgba(0,0,0,.45))" }}>
            {[50, 40, 30, 20, 10].map((r, i) => <circle key={r} r={r} fill={i % 2 ? "#f8fafc" : "#ef4444"} stroke="#7f1d1d" strokeWidth=".8"/>)}
            <circle r="3.5" fill="#fde047"/>
          </svg>
          {darts.map(d => (
            <div key={d.id} style={{ position: "absolute", left: R + d.dx, top: R + d.dy, width: 0, height: 0 }}>
              <svg width="14" height="40" viewBox="0 0 14 40" style={{ position: "absolute", left: 0, top: 0, overflow: "visible", "--r": `${d.r.toFixed(0)}deg`,
                animation: "pk-cible-dart .18s ease-out both", transformOrigin: "50% 100%" }}>
                <path d="M7 40 L7 12" stroke="#334155" strokeWidth="2.4"/>
                <path d="M7 14 L1 2 L7 6 L13 2 Z" fill="#a855f7"/>
              </svg>
            </div>
          ))}
        </div>
      </div>
      <FxLayer k="cible" fx={fx}/>
      {won && <Glitter k="cible" n={60} spread={2}/>}
      {g.play && <Pill key="a">🎯 Une cible se balade sur l'accueil ! Touche-la 5 fois (elle n'aime pas ça) : {hits}/5</Pill>}
      {won && <Pill key="b" fade>Cinq sur cinq ! Une précision de buse de 0,2 mm.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 23. Bouchon
// ════════════════════════════════════════════════════════════════════════════
const BOUCHON_CSS = fxCss("bouchon") + `
@keyframes pk-bouchon-out { 0% { transform: translate(0, 0) rotate(0deg) } 100% { transform: translate(0, 115vh) rotate(500deg) } }
@keyframes pk-bouchon-wig { 0%, 100% { transform: rotate(-2deg) } 50% { transform: rotate(2deg) } }
@keyframes pk-bouchon-hint { 0%, 100% { transform: translateY(0); opacity: .9 } 50% { transform: translateY(7px); opacity: .4 } }
`;
const TANGLE_D = (() => {
  let d = "M20 60";
  for (let i = 0; i < 26; i++) {
    d += ` C${rand(0, 200).toFixed(0)} ${rand(5, 115).toFixed(0)}, ${rand(0, 200).toFixed(0)} ${rand(5, 115).toFixed(0)}, ${rand(25, 175).toFixed(0)} ${rand(20, 100).toFixed(0)}`;
  }
  return d + " C 120 110, 100 116, 100 120";
})();
function Bouchon({ done }) {
  const s = useStage(done);
  const g = useGame(s);
  const geo = useMemo(() => ({ W: vw(), H: vh(), top: isNarrow() ? 48 : 20 }), []);
  const TH = isNarrow() ? 170 : 210;
  const [pull, setPull] = useState(0);
  const [held, setHeld] = useState(false);
  const [jam, setJam] = useState(0);
  const [hint, setHint] = useState(false);
  const [fx, addFx] = useFx(s);
  const d = useRef(null);
  const partsRef = useRef([]);
  useEffect(() => {
    const { ctl } = s;
    const main = ctl.main();
    const parts = ctl.parts();
    partsRef.current = parts;
    let lastBump = 0;
    const bump = () => {
      const now = performance.now();
      if (now - lastBump < 550) return;
      lastBump = now;
      parts.forEach(p => ctl.anim(p, [{ transform: "translateY(0)" }, { transform: "translateY(-9px)" }, { transform: "translateY(3px)" }, { transform: "translateY(0)" }],
        { duration: 320, easing: "ease-out" }));
      setJam(n => n + 1);
    };
    const inMain = t => main && t && main.contains(t);
    ctl.on(window, "wheel", e => {
      if (g.ref.current !== "play" || !inMain(e.target)) return;
      e.preventDefault();
      bump();
    }, { passive: false, capture: true });
    ctl.on(window, "touchmove", e => {
      if (g.ref.current !== "play" || !inMain(e.target)) return;
      e.preventDefault();
      bump();
    }, { passive: false, capture: true });
    ctl.on(window, "keydown", e => {
      if (g.ref.current !== "play" || !["PageDown", "PageUp", "ArrowDown", "ArrowUp", " ", "End", "Home"].includes(e.key)) return;
      const tg = e.target;
      if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
      e.preventDefault();
      bump();
    }, { capture: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pop = () => {
    d.current = null;
    setHeld(false);
    if (!g.win()) return;
    addFx({ text: "POP !", x: geo.W / 2, y: geo.top + 90, size: 42 });
    addFx({ x: geo.W / 2, y: geo.top + 70, n: 18, dist: 90, colors: ["#f97316", "#fdba74", "#fff"] });
    partsRef.current.forEach(p => s.ctl.anim(p, [{ transform: "translateY(-26px)" }, { transform: "translateY(6px)", offset: 0.6 }, { transform: "translateY(0)" }],
      { duration: 650, easing: "cubic-bezier(.3,1.4,.5,1)" }));
  };
  const down = e => {
    if (g.ref.current !== "play") return;
    e.preventDefault();
    capture(e);
    d.current = { y0: e.clientY, max: 0 };
    setHeld(true);
  };
  const move = e => {
    if (!d.current) return;
    const raw = e.clientY - d.current.y0;
    d.current.max = Math.max(d.current.max, Math.abs(raw));
    const p = clamp(raw, 0, TH * 1.2);
    setPull(p);
    if (p >= TH) pop();
  };
  const up = () => {
    if (!d.current) return;
    if (d.current.max < 8) setHint(true);
    d.current = null;
    setHeld(false);
    setPull(0);
  };
  const won = g.phase === "won", over = !g.play;
  const k = pull / TH;
  const strand = 70 + pull;
  const cx = geo.W / 2, ty = geo.top;
  return (
    <Layer s={s} css={BOUCHON_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", left: cx - 15, top: 0, width: 30, height: ty + 30,
        background: "linear-gradient(90deg, rgba(255,255,255,.35), rgba(255,255,255,.75), rgba(255,255,255,.35))",
        borderLeft: "1px solid rgba(148,163,184,.6)", borderRight: "1px solid rgba(148,163,184,.6)", opacity: over ? 0 : 1, transition: "opacity .6s" }}/>
      <div aria-hidden="true" style={{ position: "absolute", left: cx - 100, top: ty + 10, width: 200, height: 124,
        transformOrigin: "50% 30%",
        animation: won ? "pk-bouchon-out 1.1s cubic-bezier(.4,0,.8,.5) both" : over ? "pk-kit-fade .8s ease both" : "pk-kit-pop .5s ease-out both" }}>
        <div style={{ width: "100%", height: "100%", transformOrigin: "50% 0", transform: `translateY(${(pull * 0.22).toFixed(1)}px) scale(${(1 - k * 0.12).toFixed(3)}, ${(1 + k * 0.35).toFixed(3)})`,
          transition: held ? "none" : "transform .5s cubic-bezier(.3,1.6,.5,1)" }}>
          <div style={{ width: "100%", height: "100%", animation: s.reduced || held ? "none" : "pk-bouchon-wig 1.8s ease-in-out infinite" }}>
            <svg width="200" height="124" viewBox="0 0 200 124" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 8px 10px rgba(0,0,0,.4))" }}>
              <path d={TANGLE_D} fill="none" stroke="#9a3412" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d={TANGLE_D} fill="none" stroke="#f97316" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d={TANGLE_D} fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" strokeLinecap="round" transform="translate(-.8 -.8)"/>
            </svg>
          </div>
        </div>
      </div>
      {!won && (
        <div style={{ position: "absolute", left: cx, top: ty + 124, width: 0, height: 0, opacity: over ? 0 : 1, transition: "opacity .6s" }}>
          <svg width="40" height={strand + 10} viewBox={`-20 0 40 ${strand + 10}`} aria-hidden="true"
            style={{ position: "absolute", left: -20, top: 0, overflow: "visible", transition: held ? "none" : "height .5s" }}>
            <path d={`M0 0 C ${held ? 2 : 10} ${strand * 0.3}, ${held ? -2 : -10} ${strand * 0.65}, 0 ${strand}`} fill="none" stroke="#9a3412" strokeWidth="5" strokeLinecap="round"/>
            <path d={`M0 0 C ${held ? 2 : 10} ${strand * 0.3}, ${held ? -2 : -10} ${strand * 0.65}, 0 ${strand}`} fill="none" stroke="#f97316" strokeWidth="3" strokeLinecap="round"/>
          </svg>
          <button aria-label="Bout de filament à tirer" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            onKeyDown={e => { if (["Enter", " ", "ArrowDown"].includes(e.key)) { e.preventDefault(); pop(); } }}
            style={{ position: "absolute", left: -28, top: strand - 12, width: 56, height: 64, padding: 0, border: "none", background: "transparent",
              cursor: held ? "grabbing" : "grab", touchAction: "none", pointerEvents: g.play ? "auto" : "none",
              transition: held ? "none" : "top .5s cubic-bezier(.3,1.6,.5,1)" }}>
            <div style={{ margin: "6px auto 0", width: 30, height: 30, borderRadius: "50%", border: "6px solid #f97316",
              boxShadow: "0 0 0 2px #9a3412, inset 0 0 0 2px #9a3412, 0 4px 8px rgba(0,0,0,.4)", boxSizing: "border-box" }}/>
            {!held && (
              <div style={{ fontSize: 14, color: "#f97316", marginTop: 2, textShadow: "0 1px 2px rgba(0,0,0,.6)", opacity: hint ? 1 : 0.6,
                animation: s.reduced ? "none" : "pk-bouchon-hint 1.4s ease-in-out infinite" }}>▼</div>
            )}
          </button>
        </div>
      )}
      <FxLayer k="bouchon" fx={fx}/>
      {g.play && (pull > 10 ? <Pill key="p">Ça vient… ça vient… encore !</Pill>
        : hint ? <Pill key="h">Attrape le bout de filament et tire-le bien vers le bas.</Pill>
          : jam > 0 ? <Pill key={"j" + Math.min(jam, 3)}>Ça coince ! Rien ne défile tant que le bouchon est là.</Pill>
            : <Pill key="a">🧶 Bouchon de filament en haut de l'écran : plus rien ne défile ! Débouche-le.</Pill>)}
      {won && <Pill key="b" fade>Pop ! Ça circule à nouveau. Pense à nettoyer la buse.</Pill>}
      {g.phase === "rendu" && <GiveUp/>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Export
// ════════════════════════════════════════════════════════════════════════════
export const PRANKS = {
  "puzzle": { label: "Puzzle", Effect: Puzzle },
  "rideau": { label: "Rideau", Effect: Rideau },
  "cadenas": { label: "Cadenas", Effect: Cadenas },
  "ballons": { label: "Ballons", Effect: Ballons },
  "cache-cache": { label: "Cache-cache", Effect: CacheCache },
  "gomme": { label: "Gomme", Effect: Gomme },
  "serrure": { label: "Serrure", Effect: Serrure },
  "carte-a-gratter": { label: "Carte à gratter", Effect: CarteAGratter },
  "radar": { label: "Radar", Effect: Radar },
  "ascenseur": { label: "Ascenseur", Effect: Ascenseur },
  "aimant-inverse": { label: "Aimant inversé", Effect: AimantInverse },
  "sablier": { label: "Sablier", Effect: Sablier },
  "peche": { label: "Pêche", Effect: Peche },
  "digicode": { label: "Digicode", Effect: Digicode },
  "souris": { label: "Souris", Effect: Souris },
  "interrupteurs": { label: "Interrupteurs", Effect: Interrupteurs },
  "boussole": { label: "Boussole", Effect: Boussole },
  "cles": { label: "Trousseau de clés", Effect: Cles },
  "bombe": { label: "Bombe à paillettes", Effect: Bombe },
  "demineur": { label: "Démineur", Effect: Demineur },
  "jardin": { label: "Jardin", Effect: Jardin },
  "cible": { label: "Cible", Effect: Cible },
  "bouchon": { label: "Bouchon", Effect: Bouchon },
};
