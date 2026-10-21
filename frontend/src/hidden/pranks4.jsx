import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStage, Layer, Pill, softly, rand, pick, tint, FONT, FILAMENTS } from "./pranks";

// Farces des fetes (lot 4) : chacune est jouee d'office le jour J (le serveur
// tient le calendrier) ; son adresse marche toute l'annee. Meme contrat que les
// autres lots : PRANKS[slug] = { label, Effect } ; Effect recoit `done`, appele
// une seule fois quand la farce est terminee (8 a 14 s). Les quelques gestes
// (galette, poisson, oeufs, bougies) sont facultatifs : sans eux, la farce se
// conclut seule bien avant 25 s, et `done` est appele dans tous les cas.
// Tout ce qui touche au DOM de l'appli passe par le controleur `ctl` de
// useStage (remise en etat exacte au demontage, meme en cours de route).

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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
// barre de navigation basse (mobile)
const navPad = () => (isNarrow() ? 76 : 0);
// accessoires poses en bas au centre : au-dessus de la legende
const propBottom = () => (isNarrow() ? 136 : 76);
// accessoires poses dans les coins du bas
const cornerBottom = () => (isNarrow() ? 136 : 16);
const floorY = () => vh() - (isNarrow() ? 86 : 14);
const px = v => `${v.toFixed(1)}px`;

// Socle : useStage, plus un dernier passage apres la remise en etat (Chrome
// laisse parfois un attribut style="" vide sur un element qui n'en avait pas).
function useStage4(done) {
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

// Morceaux de la page (cases, bobines, textes, puces…) avec leur boite
const withRects = list => list.map(c => ({ c, r: c.getBoundingClientRect() }));
const atomsOf = (ctl, max = 120) => withRects(ctl.cards(max)).filter(o => o.r.width > 0 && o.r.height > 0);
// Tuiles entieres visibles
const tilesOf = (ctl, max = 10, pad = 40) => withRects(ctl.tiles(30))
  .filter(o => o.r.width > 40 && o.r.height > 24 && o.r.bottom > pad && o.r.top < vh() - pad).slice(0, max);
// Amplitude d'un mouvement : un gros bloc bouge moins qu'une petite puce
const amp = (r, a) => a * clamp(90 / Math.max(30, Math.sqrt(r.width * r.height)), 0.35, 1);
// Zone visible de la page (main), bornee a l'ecran
function mainBox() {
  const m = document.querySelector("main.page-content");
  const W = vw(), H = vh();
  if (!m) return { left: 0, top: 0, w: W, h: H };
  const r = m.getBoundingClientRect();
  const left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(W, r.right), bottom = Math.min(H - navPad(), r.bottom);
  return { left, top, w: Math.max(90, right - left), h: Math.max(90, bottom - top) };
}
// Programme des phases : setPh(1) a t[0] ms, setPh(2) a t[1]…
const steps = (ctl, setPh, times) => times.forEach((t, i) => ctl.after(t, () => setPh(i + 1)));

// ── Objets accroches a un element de la page ───────────────────────────────
// Un objet du calque suit son element (defilement, animation) : position
// recalculee a chaque image. bind(id, cible, fx, fy, ox, oy) rend la ref.
function useAnchors(s) {
  const map = useRef(new Map());
  useEffect(() => {
    s.ctl.loop(() => {
      map.current.forEach(a => {
        if (!a.target.isConnected) { a.el.style.visibility = "hidden"; return; }
        const r = a.target.getBoundingClientRect();
        a.el.style.transform = `translate(${px(r.left + r.width * a.fx + a.ox)},${px(r.top + r.height * a.fy + a.oy)})`;
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (id, target, fx = 0, fy = 0, ox = 0, oy = 0) => el => {
    if (el && target) map.current.set(id, { el, target, fx, fy, ox, oy }); else map.current.delete(id);
  };
}
// Position de depart d'un objet accroche (evite une image en haut a gauche)
const anchorAt = (r, fx = 0, fy = 0, ox = 0, oy = 0) => `translate(${px(r.left + r.width * fx + ox)},${px(r.top + r.height * fy + oy)})`;
const ANCHOR = { position: "absolute", left: 0, top: 0, width: 0, height: 0, pointerEvents: "none" };

// ── Particules qui tombent ou qui montent ─────────────────────────────────
const driftCss = k => `
@keyframes pk-${k}-fall { 0% { transform: translate(0, -110%) rotate(var(--r0)) } 100% { transform: translate(var(--dx), calc(100vh + 30px)) rotate(var(--r1)) } }
@keyframes pk-${k}-rise { 0% { transform: translate(0, 0) rotate(var(--r0)); opacity: 0 } 8%, 82% { opacity: var(--o) }
  100% { transform: translate(var(--dx), calc(-100vh - 60px)) rotate(var(--r1)); opacity: 0 } }
@keyframes pk-${k}-sway { 0%, 100% { transform: translateX(calc(var(--sw) * -1)) rotate(-10deg) } 50% { transform: translateX(var(--sw)) rotate(10deg) } }
`;
function makeDrift(n, { t0 = 0, t1 = 6, d = [4, 7], size = [10, 22], colors = FILAMENTS, o = [0.75, 1], sw = [6, 22] } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    x: rand(-2, 100), dl: rand(t0, t1), d: rand(d[0], d[1]), dx: rand(-60, 60), r0: rand(-40, 40), r1: rand(-360, 360),
    size: rand(size[0], size[1]), c: colors[i % colors.length], o: rand(o[0], o[1]), sw: rand(sw[0], sw[1]), sd: rand(1.6, 3.2), i,
  }));
}
function Drift({ k, items, dir = "fall", render }) {
  return items.map(b => (
    <div key={b.i} aria-hidden="true" style={{ position: "absolute", left: `${b.x.toFixed(2)}%`, top: dir === "fall" ? 0 : "100%",
      "--dx": `${b.dx.toFixed(0)}px`, "--r0": `${b.r0.toFixed(0)}deg`, "--r1": `${b.r1.toFixed(0)}deg`, "--o": b.o.toFixed(2),
      animation: `pk-${k}-${dir} ${b.d.toFixed(2)}s ${dir === "fall" ? "linear" : "ease-out"} ${b.dl.toFixed(2)}s both` }}>
      <div style={{ "--sw": `${b.sw.toFixed(0)}px`, animation: `pk-${k}-sway ${b.sd.toFixed(2)}s ease-in-out ${(-b.sd * b.o).toFixed(2)}s infinite` }}>
        {render(b)}
      </div>
    </div>
  ));
}
// Confettis (rectangles et ronds), pour le fond des fetes
const confetto = b => (
  <span style={{ display: "block", width: b.size * 0.6, height: b.i % 3 ? b.size * 0.3 : b.size * 0.6, borderRadius: b.i % 3 ? 2 : "50%",
    background: b.c, boxShadow: "0 0 3px rgba(0,0,0,.18)" }}/>
);

// ── Feux d'artifice ───────────────────────────────────────────────────────
const fwCss = k => `
@keyframes pk-${k}-rocket { 0% { transform: translate(0, 0); opacity: 0 } 4%, 88% { opacity: 1 } 100% { transform: translate(var(--rx), var(--ry)); opacity: 0 } }
@keyframes pk-${k}-spark { 0% { transform: translate(0, 0) scale(1); opacity: 0 } 3% { opacity: 1 } 65% { opacity: 1 }
  100% { transform: translate(var(--dx), calc(var(--dy) + 46px)) scale(.25); opacity: 0 } }
@keyframes pk-${k}-flash { 0% { transform: translate(-50%, -50%) scale(.2); opacity: 0 } 6% { opacity: .9 } 100% { transform: translate(-50%, -50%) scale(2.6); opacity: 0 } }
`;
function makeShots(n, t0, t1, colors) {
  const W = vw(), H = vh(), small = isNarrow();
  return Array.from({ length: n }, (_, i) => {
    const x = rand(0.1, 0.9) * W, y = rand(0.1, 0.42) * H;
    const c = colors[i % colors.length];
    const rays = small ? 20 : 28, R = rand(70, 135) * (small ? 0.8 : 1);
    const t = Math.max(0, t0 + (t1 - t0) * i / Math.max(1, n - 1) + rand(-0.2, 0.2));
    const sparks = Array.from({ length: rays }, (_, j) => {
      const a = j / rays * Math.PI * 2 + rand(-0.12, 0.12), d = R * rand(0.75, 1.1);
      return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, c: j % 4 === 3 ? "#ffffff" : c, s: rand(5, 8) };
    });
    return { x, y, t, c, sparks, x0: x + rand(-50, 50), y0: H - navPad() };
  });
}
function Fireworks({ k, shots }) {
  return shots.map((f, i) => (
    <React.Fragment key={i}>
      <span aria-hidden="true" style={{ position: "absolute", left: f.x0, top: f.y0, width: 4, height: 16, marginLeft: -2, borderRadius: 2,
        background: `linear-gradient(${f.c}, transparent)`, "--rx": px(f.x - f.x0), "--ry": px(f.y - f.y0),
        animation: `pk-${k}-rocket .85s cubic-bezier(.2,.6,.4,1) ${f.t.toFixed(2)}s both` }}/>
      <div aria-hidden="true" style={{ position: "absolute", left: f.x, top: f.y, width: 0, height: 0 }}>
        <span style={{ position: "absolute", left: 0, top: 0, width: 90, height: 90, borderRadius: "50%",
          background: `radial-gradient(circle, ${f.c}, transparent 65%)`, animation: `pk-${k}-flash .7s ease-out ${(f.t + 0.82).toFixed(2)}s both` }}/>
        {f.sparks.map((p, j) => (
          <span key={j} style={{ position: "absolute", left: -p.s / 2, top: -p.s / 2, width: p.s, height: p.s, borderRadius: "50%", background: p.c,
            boxShadow: `0 0 6px ${p.c}, 0 0 12px ${p.c}`, "--dx": px(p.dx), "--dy": px(p.dy),
            animation: `pk-${k}-spark 1.5s cubic-bezier(.1,.7,.3,1) ${(f.t + 0.82).toFixed(2)}s both` }}/>
        ))}
      </div>
    </React.Fragment>
  ));
}

// ── Textes ────────────────────────────────────────────────────────────────
const wordCss = k => `
@keyframes pk-${k}-word { 0% { transform: translate(-50%, -50%) scale(.3) rotate(-8deg); opacity: 0 } 25% { transform: translate(-50%, -50%) scale(1.15) rotate(3deg); opacity: 1 }
  70% { transform: translate(-50%, -70%) scale(1) rotate(0deg); opacity: 1 } 100% { transform: translate(-50%, -110%) scale(1); opacity: 0 } }
@keyframes pk-${k}-burst { 0% { transform: translate(0, 0) scale(1); opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) scale(.3); opacity: 0 } }
`;
// Mot ephemere (POP !, CRAC !…) ; il disparait seul (animation .9 s)
function Word({ k, x, y, text, color = "#fde047", edge = "#7c2d12", size = 28, dur = 0.9 }) {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: x, top: y, fontFamily: FONT, fontWeight: 900, fontSize: size, color,
      WebkitTextStroke: `1.5px ${edge}`, textShadow: `0 3px 0 ${edge}, 0 6px 14px rgba(0,0,0,.35)`, whiteSpace: "nowrap",
      animation: `pk-${k}-word ${dur}s ease-out both` }}>{text}</div>
  );
}
function Burst({ k, x, y, n = 14, colors = FILAMENTS, dist = 70, size = 8 }) {
  const bits = useMemo(() => Array.from({ length: n }, (_, i) => {
    const a = i / n * Math.PI * 2 + rand(-0.3, 0.3), d = dist * rand(0.55, 1.25);
    return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, c: colors[i % colors.length], s: size * rand(0.6, 1.3) };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: x, top: y, width: 0, height: 0 }}>
      {bits.map((b, i) => (
        <span key={i} style={{ position: "absolute", left: -b.s / 2, top: -b.s / 2, width: b.s, height: b.s, borderRadius: "50%", background: b.c,
          "--dx": px(b.dx), "--dy": px(b.dy), animation: `pk-${k}-burst .8s cubic-bezier(.2,.7,.3,1) both` }}/>
      ))}
    </div>
  );
}
// Effets ephemeres : add({ text } ou { burst }) ; retires seuls
function useFx(s) {
  const [fx, setFx] = useState([]);
  const seq = useRef(0);
  const add = (item, life = 1200) => {
    const id = ++seq.current;
    setFx(l => [...l, { ...item, id }]);
    s.ctl.after(life, () => setFx(l => l.filter(f => f.id !== id)));
  };
  return [fx, add];
}
const FxLayer = ({ k, fx }) => fx.map(f => (f.text ? <Word key={f.id} k={k} {...f}/> : <Burst key={f.id} k={k} {...f}/>));

// Gros titre centre (texte du calque)
function Title({ children, top = "40%", anim, style }) {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "50%", top, transform: "translate(-50%, -50%)", width: "max-content",
      maxWidth: "calc(100vw - 24px)", textAlign: "center", fontFamily: FONT, fontWeight: 900, lineHeight: 1.05, animation: anim, ...style }}>
      {children}
    </div>
  );
}
// Voile plein ecran
const Veil = ({ bg, anim }) => <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: bg, animation: anim }}/>;

// Annee qui commence (le 31 decembre, c'est deja la suivante)
const newYear = () => { const d = new Date(); return d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear(); };

// ════════════════════════════════════════════════════════════════════════════
// 1. Nouvel an : 3, 2, 1, bouchon, feux d'artifice, « Bonne annee »
// ════════════════════════════════════════════════════════════════════════════
const NA_CSS = fwCss("nouvel-an") + wordCss("nouvel-an") + `
@keyframes pk-nouvel-an-veil { 0% { opacity: 0 } 6%, 88% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-nouvel-an-num { 0% { transform: translate(-50%, -50%) scale(2.6); opacity: 0 } 18% { transform: translate(-50%, -50%) scale(1); opacity: 1 }
  72% { transform: translate(-50%, -50%) scale(.9); opacity: 1 } 100% { transform: translate(-50%, -50%) scale(.5); opacity: 0 } }
@keyframes pk-nouvel-an-ring { 0% { transform: translate(-50%, -50%) scale(.3); opacity: 0 } 10% { opacity: .9 } 100% { transform: translate(-50%, -50%) scale(1.9); opacity: 0 } }
@keyframes pk-nouvel-an-title { 0% { transform: translate(-50%, -50%) scale(.3) rotate(-6deg); opacity: 0 } 10% { transform: translate(-50%, -50%) scale(1.12) rotate(2deg); opacity: 1 }
  16% { transform: translate(-50%, -50%) scale(1) rotate(0deg) } 88% { transform: translate(-50%, -50%) scale(1); opacity: 1 } 100% { transform: translate(-50%, -62%) scale(.96); opacity: 0 } }
@keyframes pk-nouvel-an-shine { from { background-position: 0% 50% } to { background-position: 200% 50% } }
@keyframes pk-nouvel-an-bottle { 0% { transform: translate(-50%, 130%) rotate(-8deg) } 14% { transform: translate(-50%, 0) rotate(-8deg) }
  24% { transform: translate(-50%, 0) rotate(7deg) } 29% { transform: translate(-50%, 0) rotate(-9deg) } 34% { transform: translate(-50%, 0) rotate(6deg) }
  38% { transform: translate(-50%, -6px) rotate(-12deg) } 44%, 86% { transform: translate(-50%, 0) rotate(-6deg) } 100% { transform: translate(-50%, 140%) rotate(-6deg) } }
@keyframes pk-nouvel-an-cork { 0% { transform: translate(0, 0) rotate(0deg); opacity: 1 } 90% { opacity: 1 } 100% { transform: translate(var(--cx), var(--cy)) rotate(1080deg); opacity: 0 } }
@keyframes pk-nouvel-an-foam { 0% { transform: translate(0, 0) scale(.4); opacity: 0 } 10% { opacity: .95 } 100% { transform: translate(var(--dx), var(--dy)) scale(1.3); opacity: 0 } }
`;
function Bottle({ h }) {
  return (
    <svg width={h * 60 / 160} height={h} viewBox="0 0 60 160" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id="pk4-btl" x1="0" x2="1"><stop offset="0" stopColor="#0b3d24"/><stop offset=".45" stopColor="#1f7a4a"/><stop offset="1" stopColor="#062616"/></linearGradient>
        <linearGradient id="pk4-foil" x1="0" x2="1"><stop offset="0" stopColor="#a16207"/><stop offset=".5" stopColor="#fde68a"/><stop offset="1" stopColor="#92400e"/></linearGradient>
      </defs>
      <path d="M24 8 L36 8 L36 38 C36 48 50 54 50 70 L50 150 Q50 156 44 156 L16 156 Q10 156 10 150 L10 70 C10 54 24 48 24 38 Z" fill="url(#pk4-btl)"/>
      <path d="M23 6 L37 6 L37 38 C37 43 40 46 43 50 L17 50 C20 46 23 43 23 38 Z" fill="url(#pk4-foil)"/>
      <rect x="13" y="86" width="34" height="38" rx="3" fill="#fef3c7" stroke="#b45309" strokeWidth="1.2"/>
      <path d="M30 94 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1 Z" fill="#d97706"/>
      <rect x="15" y="64" width="4" height="84" rx="2" fill="rgba(255,255,255,.22)"/>
    </svg>
  );
}
function NouvelAn({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const year = useMemo(newYear, []);
  const small = isNarrow();
  const H = vh(), W = vw();
  const bh = small ? 118 : 150;
  const bx = W * (small ? 0.16 : 0.14), by = H - propBottom() - bh;
  const shots = useMemo(() => makeShots(small ? 11 : 16, 3.5, 9.1, ["#fde047", "#f472b6", "#60a5fa", "#a3e635", "#fb923c", "#c084fc", "#f87171"]), []); // eslint-disable-line react-hooks/exhaustive-deps
  const foam = useMemo(() => Array.from({ length: 18 }, () => ({ dx: rand(-60, 60), dy: rand(-170, -50), dl: rand(0, 0.5), s: rand(6, 13) })), []);
  const glitter = useMemo(() => makeDrift(small ? 50 : 80, { t0: 3.6, t1: 8.5, d: [3.5, 6], size: [8, 14],
    colors: ["#fde047", "#facc15", "#fef3c7", "#f59e0b", "#e5e7eb"] }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { ctl } = s;
    const at = atomsOf(ctl, 120);
    // le compte a rebours fait battre la page
    [400, 1400, 2400].forEach(d => at.forEach(o => ctl.anim(o.c, [{ transform: "scale(1)" }, { transform: "scale(.93)", offset: 0.25 }, { transform: "scale(1)" }],
      { duration: 600, delay: d, easing: "ease-out" })));
    // puis tout le monde saute de joie
    at.forEach(o => {
      const h = amp(o.r, rand(16, 40)), r = rand(-7, 7);
      ctl.anim(o.c, [
        { transform: "translateY(0) rotate(0deg) scale(1,1)", easing: "ease-out" },
        { transform: "translateY(2px) rotate(0deg) scale(1.06,.9)", offset: 0.14, easing: "cubic-bezier(.2,.7,.4,1)" },
        { transform: `translateY(${-h.toFixed(1)}px) rotate(${r.toFixed(1)}deg) scale(.96,1.06)`, offset: 0.42, easing: "cubic-bezier(.6,0,.8,.5)" },
        { transform: "translateY(0) rotate(0deg) scale(1.05,.93)", offset: 0.68, easing: "ease-out" },
        { transform: "translateY(0) rotate(0deg) scale(1,1)", offset: 0.82 },
        { transform: "translateY(0) rotate(0deg) scale(1,1)" },
      ], { duration: rand(950, 1250), delay: 3700 + rand(0, 900), iterations: 3 });
    });
    steps(ctl, setPh, [400, 1400, 2400, 3400, 9300]);
    ctl.after(11700, () => { setPh(6); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const num = n => (
    <Title key={n} top="40%" anim="pk-nouvel-an-num 1s cubic-bezier(.2,.8,.3,1) both"
      style={{ fontSize: "clamp(120px, 36vw, 280px)", color: "#fef3c7", textShadow: "0 0 30px rgba(250,204,21,.85), 0 8px 0 #92400e" }}>{n}</Title>
  );
  return (
    <Layer s={s} css={NA_CSS + driftCss("nouvel-an")}>
      <Veil bg="radial-gradient(ellipse at 50% 30%, rgba(49,46,129,.6), rgba(2,6,23,.82))" anim="pk-nouvel-an-veil 11.6s ease both"/>
      {ph >= 1 && ph <= 3 && <span key={"r" + ph} aria-hidden="true" style={{ position: "absolute", left: "50%", top: "40%", width: 260, height: 260, borderRadius: "50%",
        border: "4px solid rgba(250,204,21,.8)", animation: "pk-nouvel-an-ring 1s ease-out both" }}/>}
      {ph === 1 && num(3)}{ph === 2 && num(2)}{ph === 3 && num(1)}
      {ph >= 4 && ph < 6 && <Fireworks k="nouvel-an" shots={shots}/>}
      {ph >= 4 && ph < 6 && <Drift k="nouvel-an" items={glitter} render={confetto}/>}
      {ph >= 4 && (
        <Title top="36%" anim="pk-nouvel-an-title 6.6s ease both">
          <div style={{ fontSize: "clamp(34px, 10vw, 78px)", color: "#fff", textShadow: "0 3px 0 #7c2d12, 0 0 24px rgba(250,204,21,.7)" }}>Bonne année</div>
          <div style={{ fontSize: "clamp(64px, 22vw, 168px)", backgroundImage: "linear-gradient(90deg, #fde68a, #f59e0b, #fff7d6, #d97706, #fde68a)",
            backgroundSize: "200% 100%", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
            filter: "drop-shadow(0 4px 0 #78350f) drop-shadow(0 0 18px rgba(250,204,21,.6))", animation: "pk-nouvel-an-shine 2.4s linear infinite" }}>{year}</div>
        </Title>
      )}
      <div aria-hidden="true" style={{ position: "absolute", left: bx, top: by, animation: "pk-nouvel-an-bottle 9s ease both" }}>
        <div style={{ position: "relative" }}>
          <svg width={bh * 18 / 160} height={bh * 14 / 160} viewBox="0 0 18 14" style={{ position: "absolute", left: "50%", top: -bh * 9 / 160, marginLeft: -bh * 9 / 160,
            "--cx": px(rand(90, 170)), "--cy": px(-H * 0.6), animation: "pk-nouvel-an-cork 1.3s cubic-bezier(.15,.7,.4,1) 3.4s both" }}>
            <path d="M3 0 L15 0 Q18 0 17 4 L14 14 L4 14 L1 4 Q0 0 3 0 Z" fill="#c69c6d" stroke="#7c5a35" strokeWidth="1"/>
          </svg>
          {ph >= 4 && foam.map((f, i) => (
            <span key={i} style={{ position: "absolute", left: "50%", top: 0, width: f.s, height: f.s, marginLeft: -f.s / 2, borderRadius: "50%",
              background: "rgba(254,249,195,.95)", boxShadow: "0 0 6px rgba(255,255,255,.8)", "--dx": px(f.dx), "--dy": px(f.dy),
              animation: `pk-nouvel-an-foam 1.2s ease-out ${f.dl.toFixed(2)}s both` }}/>
          ))}
          <Bottle h={bh}/>
        </div>
      </div>
      {ph === 4 && <Word k="nouvel-an" x={bx + 30} y={by - 20} text="POP !" size={34} dur={1.1}/>}
      {ph < 4 && <Pill key="a">🥂 Dernières secondes de l'année… 3, 2, 1…</Pill>}
      {(ph === 4 || ph === 5) && <Pill key="b">🎆 Bonne année {year} ! Que tes premières couches accrochent du premier coup.</Pill>}
      {ph === 6 && <Pill key="c" fade>Meilleurs vœux, et zéro spaghetti cette année.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Galette : trouver la feve (geste facultatif), couronne sur la carte
// ════════════════════════════════════════════════════════════════════════════
const GAL_N = 8;
const GAL_CSS = wordCss("galette") + `
@keyframes pk-galette-in { 0% { transform: scale(.2) rotate(-90deg); opacity: 0 } 70% { transform: scale(1.05) rotate(4deg); opacity: 1 } 100% { transform: scale(1) rotate(0deg); opacity: 1 } }
@keyframes pk-galette-out { from { transform: scale(1); opacity: 1 } to { transform: scale(.55) translateY(40px); opacity: 0 } }
@keyframes pk-galette-feve { 0% { transform: scale(0) } 50% { transform: scale(2.6) } 70% { transform: scale(2) } 100% { transform: scale(2.2) } }
@keyframes pk-galette-glow { 0%, 100% { opacity: .35 } 50% { opacity: .9 } }
@keyframes pk-galette-crown { 0% { transform: translate(-50%, -260px) rotate(-25deg); opacity: 0 } 15% { opacity: 1 } 70% { transform: translate(-50%, -82%) rotate(6deg) }
  85% { transform: translate(-50%, -90%) rotate(-3deg) } 100% { transform: translate(-50%, -82%) rotate(-4deg); opacity: 1 } }
@keyframes pk-galette-veil { from { opacity: 0 } to { opacity: 1 } }
`;
function Crown({ w = 92 }) {
  return (
    <svg width={w} height={w * 0.62} viewBox="0 0 92 57" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 4px 6px rgba(0,0,0,.35))" }}>
      <defs><linearGradient id="pk4-crown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fde68a"/><stop offset="1" stopColor="#d97706"/></linearGradient></defs>
      <path d="M4 54 L4 16 L20 32 L32 5 L46 28 L60 5 L72 32 L88 16 L88 54 Z" fill="url(#pk4-crown)" stroke="#92400e" strokeWidth="2" strokeLinejoin="round"/>
      <rect x="4" y="42" width="84" height="12" fill="#f59e0b" stroke="#92400e" strokeWidth="2"/>
      {[[20, 48, "#ef4444"], [46, 48, "#2563eb"], [72, 48, "#16a34a"]].map(([x, y, c]) => <circle key={x} cx={x} cy={y} r="4" fill={c} stroke="#fff" strokeWidth="1"/>)}
      {[[4, 16], [32, 5], [60, 5], [88, 16]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.4" fill="#fef3c7" stroke="#92400e" strokeWidth="1.4"/>)}
    </svg>
  );
}
function Galette({ done }) {
  const s = useStage4(done);
  const [open, setOpen] = useState([]);
  const [ph, setPh] = useState("play"); // play, feve, crown, end
  const [auto, setAuto] = useState(false);
  const [crown, setCrown] = useState(null);
  const [fx, addFx] = useFx(s);
  const phRef = useRef("play");
  const bind = useAnchors(s);
  const geo = useMemo(() => {
    const b = mainBox(), H = vh();
    const D = Math.max(150, Math.min(vw() - 36, H - navPad() - (isNarrow() ? 200 : 110), 440));
    const cx = b.left + b.w / 2, cy = clamp(b.top + b.h * 0.45, b.top + D / 2 + 6, H - propBottom() - D / 2 + 40);
    return { D, cx, cy, win: Math.floor(Math.random() * GAL_N) };
  }, []);
  const tilesRef = useRef([]);
  useEffect(() => {
    const { ctl } = s;
    tilesRef.current = tilesOf(ctl, 20, 0);
    // la page prend une teinte de pate feuilletee doree
    tilesRef.current.forEach(o => ctl.anim(o.c, [{ filter: "sepia(0) saturate(1)" }, { filter: "sepia(.55) saturate(1.5) hue-rotate(-10deg)" }],
      { duration: 900, fill: "forwards", easing: "ease" }));
    ctl.after(13000, () => { if (phRef.current === "play") { setAuto(true); reveal(); } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const partCenter = (i, rr = 0.55) => {
    const a = (i + 0.5) / GAL_N * Math.PI * 2 - Math.PI / 2;
    return [geo.cx + Math.cos(a) * geo.D / 2 * rr, geo.cy + Math.sin(a) * geo.D / 2 * rr];
  };
  const reveal = () => {
    const { ctl } = s;
    phRef.current = "feve";
    setPh("feve");
    setOpen(o => (o.includes(geo.win) ? o : [...o, geo.win]));
    const [fx0, fy0] = partCenter(geo.win, 0.3);
    addFx({ burst: true, x: fx0, y: fy0, n: 18, dist: 90, colors: ["#fde047", "#fff", "#f59e0b"] });
    ctl.after(1600, () => {
      // la carte gagnante : celle sous la part, sinon la plus proche
      let best = null, bd = Infinity;
      tilesRef.current.forEach(o => {
        const r = o.c.getBoundingClientRect();
        const dx = Math.max(r.left - fx0, 0, fx0 - r.right), dy = Math.max(r.top - fy0, 0, fy0 - r.bottom);
        const d = dx + dy + (r.top < 50 ? 400 : 0);
        if (d < bd) { bd = d; best = o.c; }
      });
      phRef.current = "crown";
      setPh("crown");
      if (best) {
        setCrown({ c: best, r: best.getBoundingClientRect() });
        ctl.after(800, () => ctl.anim(best, [{ transform: "translateY(0) scale(1,1)" }, { transform: "translateY(4px) scale(1.02,.95)", offset: 0.3 },
          { transform: "translateY(-6px) scale(1,1.02)", offset: 0.6 }, { transform: "translateY(0) scale(1,1)" }], { duration: 600, easing: "ease-out" }));
      }
      ctl.after(1000, () => atomsOf(ctl, 120).forEach(o => ctl.anim(o.c, [{ transform: "translateY(0) rotate(0deg)" },
        { transform: `translateY(${-amp(o.r, 14).toFixed(1)}px) rotate(${rand(-5, 5).toFixed(1)}deg)`, offset: 0.4 }, { transform: "translateY(0) rotate(0deg)" }],
        { duration: 700, delay: rand(0, 600), iterations: 2, easing: "ease-in-out" })));
      ctl.after(4200, () => { phRef.current = "end"; setPh("end"); s.finish(); });
    });
  };
  const onPart = (e, i) => {
    e.stopPropagation();
    if (phRef.current !== "play" || open.includes(i)) return;
    setOpen(o => [...o, i]);
    if (i === geo.win) { reveal(); return; }
    const [x, y] = partCenter(i, 0.6);
    addFx({ text: pick(["Frangipane…", "Raté !", "Pas ici !", "Que d'la pâte !", "Miam, mais non"]), x, y, size: 20, color: "#fff7d6", edge: "#92400e" });
  };
  const R = 100;
  const wedge = i => {
    const a0 = i / GAL_N * Math.PI * 2 - Math.PI / 2, a1 = (i + 1) / GAL_N * Math.PI * 2 - Math.PI / 2;
    return `M0 0 L${(R * Math.cos(a0)).toFixed(2)} ${(R * Math.sin(a0)).toFixed(2)} A${R} ${R} 0 0 1 ${(R * Math.cos(a1)).toFixed(2)} ${(R * Math.sin(a1)).toFixed(2)} Z`;
  };
  const score = [];
  for (let k = -5; k <= 5; k++) score.push(`M-100 ${k * 18} Q0 ${k * 18 + 26} 100 ${k * 18}`);
  const fa = (geo.win + 0.5) / GAL_N * Math.PI * 2 - Math.PI / 2;
  return (
    <Layer s={s} css={GAL_CSS}>
      <Veil bg="rgba(15,10,0,.28)" anim="pk-galette-veil .8s ease both"/>
      {ph !== "crown" && ph !== "end" && (
        <div style={{ position: "absolute", left: geo.cx - geo.D / 2, top: geo.cy - geo.D / 2, width: geo.D, height: geo.D,
          animation: "pk-galette-in .9s cubic-bezier(.2,1.2,.4,1) both" }}>
          <svg width={geo.D} height={geo.D} viewBox="-112 -112 224 224" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 10px 18px rgba(0,0,0,.45))" }}>
            <defs>
              <radialGradient id="pk4-gal"><stop offset="0" stopColor="#f8cf74"/><stop offset=".75" stopColor="#e2a043"/><stop offset="1" stopColor="#b8742a"/></radialGradient>
              {Array.from({ length: GAL_N }, (_, i) => <clipPath key={i} id={`pk4-galc${i}`}><path d={wedge(i)}/></clipPath>)}
            </defs>
            <circle r="98" fill="#f2d98f"/>
            {[[-30, 20], [40, -30], [10, 50], [-50, -40], [60, 30]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="5" fill="#e8c46f" opacity=".7"/>)}
            {Array.from({ length: GAL_N }, (_, i) => {
              const isOpen = open.includes(i), a = (i + 0.5) / GAL_N * Math.PI * 2 - Math.PI / 2, d = i === geo.win ? 46 : 40;
              return (
                <g key={i} onPointerDown={e => onPart(e, i)} role="button" aria-label={`Part ${i + 1}`}
                  style={{ pointerEvents: ph === "play" && !isOpen ? "auto" : "none", cursor: "pointer",
                    transform: isOpen ? `translate(${(Math.cos(a) * d).toFixed(1)}px, ${(Math.sin(a) * d).toFixed(1)}px) rotate(${i % 2 ? 7 : -7}deg)` : "none",
                    transition: "transform .55s cubic-bezier(.2,1.3,.4,1), opacity .55s", opacity: isOpen && i !== geo.win ? 0.82 : 1 }}>
                  <g clipPath={`url(#pk4-galc${i})`}>
                    <circle r="100" fill="url(#pk4-gal)"/>
                    {score.map((dd, k) => <path key={k} d={dd} fill="none" stroke="rgba(120,60,10,.38)" strokeWidth="1.6"/>)}
                    {score.map((dd, k) => <path key={"b" + k} d={dd} transform="rotate(64)" fill="none" stroke="rgba(120,60,10,.25)" strokeWidth="1.2"/>)}
                    <circle r="96" fill="none" stroke="#a8641c" strokeWidth="7" opacity=".55"/>
                  </g>
                  <path d={wedge(i)} fill="none" stroke="rgba(92,46,6,.65)" strokeWidth="1.3"/>
                </g>
              );
            })}
            {ph !== "play" && (
              <g transform={`translate(${(Math.cos(fa) * 26).toFixed(1)} ${(Math.sin(fa) * 26).toFixed(1)})`}>
                <circle r="14" fill="#fde047" style={{ animation: "pk-galette-glow 1s ease-in-out infinite" }}/>
                <g style={{ animation: "pk-galette-feve .7s cubic-bezier(.2,1.4,.4,1) both" }}>
                  <ellipse rx="7" ry="5.5" fill="#fffbeb" stroke="#a16207" strokeWidth="1"/>
                  <path d="M-3 -1 l1.6 -2.4 1.4 2 1.4 -2 1.6 2.4 Z" fill="#f59e0b"/>
                  <ellipse cx="-2" cy="2" rx="2" ry="1" fill="#fde68a"/>
                </g>
              </g>
            )}
          </svg>
        </div>
      )}
      {ph === "crown" && <div aria-hidden="true" style={{ position: "absolute", left: geo.cx - geo.D / 2, top: geo.cy - geo.D / 2, width: geo.D, height: geo.D,
        borderRadius: "50%", background: "radial-gradient(circle, #f8cf74, #b8742a)", animation: "pk-galette-out .6s ease-in both" }}/>}
      {crown && (
        <div ref={bind("crown", crown.c, 0.5, 0, 0, 2)} style={{ ...ANCHOR, transform: anchorAt(crown.r, 0.5, 0, 0, 2) }}>
          <div style={{ position: "absolute", left: 0, top: 0, animation: "pk-galette-crown 1s cubic-bezier(.3,1.2,.5,1) both" }}>
            <Crown w={isNarrow() ? 74 : 92}/>
          </div>
        </div>
      )}
      <FxLayer k="galette" fx={fx}/>
      {ph === "play" && !open.length && <Pill key="a">👑 Épiphanie ! La galette est découpée : choisis une part pour trouver la fève.</Pill>}
      {ph === "play" && open.length > 0 && <Pill key={"m" + open.length}>Toujours pas de fève… Essaie une autre part.</Pill>}
      {ph === "feve" && <Pill key="f">{auto ? "Personne ? La fève se dévoile toute seule…" : "La fève ! Bien joué, tu es tombé dessus."}</Pill>}
      {ph === "crown" && <Pill key="c">👑 Une couronne en papier pour la carte gagnante. Vive le roi de l'atelier !</Pill>}
      {ph === "end" && <Pill key="e" fade>La galette est finie. La fève, elle, était en PLA.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Chandeleur : crepes qui sautent, la page retournee comme une crepe
// ════════════════════════════════════════════════════════════════════════════
const CH_CSS = wordCss("chandeleur") + `
@keyframes pk-chandeleur-pan { 0% { transform: translate(-50%, 140%) } 8%, 92% { transform: translate(-50%, 0) } 100% { transform: translate(-50%, 140%) } }
@keyframes pk-chandeleur-jerk { 0%, 100% { transform: rotate(0deg) translateY(0) } 30% { transform: rotate(-9deg) translateY(-10px) } 60% { transform: rotate(3deg) translateY(2px) } }
@keyframes pk-chandeleur-up { 0% { transform: translateY(0); animation-timing-function: cubic-bezier(.2,.7,.4,1) } 50% { transform: translateY(var(--h)); animation-timing-function: cubic-bezier(.6,0,.8,.3) } 100% { transform: translateY(0) } }
@keyframes pk-chandeleur-flip { from { transform: perspective(300px) rotateX(0deg) } to { transform: perspective(300px) rotateX(var(--turn)) } }
@keyframes pk-chandeleur-stick { 0% { transform: translateY(0) } 22% { transform: translateY(var(--h)) } 70% { transform: translateY(var(--h)) scale(1.04, .9) }
  76% { transform: translateY(var(--h)) } 100% { transform: translateY(0) } }
`;
function Crepe({ w }) {
  return (
    <svg width={w} height={w * 0.36} viewBox="0 0 100 36" style={{ display: "block", overflow: "visible" }}>
      <ellipse cx="50" cy="18" rx="48" ry="16" fill="#f5c46b" stroke="#c98a2e" strokeWidth="2"/>
      {[[30, 14, 5], [58, 20, 4], [70, 12, 3], [42, 24, 3], [22, 22, 2.5], [80, 20, 2.5], [52, 10, 2]].map(([x, y, r], i) => (
        <ellipse key={i} cx={x} cy={y} rx={r * 1.6} ry={r * 0.7} fill="#c98a2e" opacity=".55"/>
      ))}
    </svg>
  );
}
function Pan({ w }) {
  return (
    <svg width={w} height={w * 0.3} viewBox="0 0 200 60" style={{ display: "block", overflow: "visible" }}>
      <defs><linearGradient id="pk4-pan" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#9ca3af"/><stop offset=".25" stopColor="#4b5563"/><stop offset="1" stopColor="#1f2937"/></linearGradient></defs>
      <rect x="134" y="20" width="66" height="11" rx="5.5" fill="#92400e" stroke="#451a03" strokeWidth="1.5" transform="rotate(-6 134 25)"/>
      <path d="M6 18 L134 18 L124 44 Q120 52 108 52 L32 52 Q20 52 16 44 Z" fill="url(#pk4-pan)" stroke="#cbd5e1" strokeWidth="2.2"/>
      <ellipse cx="70" cy="18" rx="64" ry="6" fill="#111827" stroke="#e5e7eb" strokeWidth="2"/>
    </svg>
  );
}
function Chandeleur({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const [fx, addFx] = useFx(s);
  const small = isNarrow();
  const pw = small ? 150 : 200;
  const panTop = vh() - propBottom() - pw * 0.3;
  const flips = useMemo(() => [
    { t: 0.9, h: -vh() * 0.32, turn: "360deg", d: 1.3 },
    { t: 2.6, h: -vh() * 0.4, turn: "540deg", d: 1.4 },
    { t: 4.4, h: -(panTop - 6), turn: "180deg", d: 4.2, stick: true },
    { t: 8.9, h: -vh() * 0.3, turn: "360deg", d: 1.3 },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { ctl } = s;
    const at = atomsOf(ctl, 120);
    at.forEach(o => {
      [1200 + rand(0, 2600), 5400 + rand(0, 2400)].forEach((d, k) => {
        const h = amp(o.r, rand(70, 150)), turn = k ? -360 : 360;
        ctl.anim(o.c, [
          { transform: "perspective(600px) translateY(0) rotateX(0deg) scale(1,1)", easing: "cubic-bezier(.2,.7,.4,1)" },
          { transform: `perspective(600px) translateY(${(-h).toFixed(1)}px) rotateX(${turn / 2}deg) scale(1,1)`, offset: 0.45, easing: "cubic-bezier(.6,0,.8,.3)" },
          { transform: `perspective(600px) translateY(0) rotateX(${turn}deg) scale(1.05,.9)`, offset: 0.86, easing: "ease-out" },
          { transform: `perspective(600px) translateY(0) rotateX(${turn}deg) scale(1,1)` },
        ], { duration: rand(1000, 1300), delay: d });
      });
    });
    const x = vw() / 2;
    flips.forEach((f, i) => ctl.after(f.t * 1000 + f.d * 1000 - 80, () => addFx({ text: i === 2 ? "PLAF !" : "FLOP !", x, y: panTop - 20, size: 24, color: "#fef3c7", edge: "#92400e" })));
    ctl.after(5300, () => addFx({ text: "Oups…", x, y: 70, size: 24, color: "#fef3c7", edge: "#92400e" }, 1400));
    steps(ctl, setPh, [4800, 8800]);
    ctl.after(11200, () => { setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={CH_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: panTop, animation: "pk-chandeleur-pan 11s ease both" }}>
        <div style={{ position: "relative", transformOrigin: "85% 50%", animation: flips.map(f => `pk-chandeleur-jerk .35s ease-out ${f.t.toFixed(2)}s`).join(", ") }}>
          {flips.map((f, i) => (
            <div key={i} style={{ position: "absolute", left: pw * 0.35 - pw * 0.27, top: -pw * 0.05, "--h": px(f.h),
              animation: `${f.stick ? "pk-chandeleur-stick" : "pk-chandeleur-up"} ${f.d}s linear ${f.t.toFixed(2)}s both`,
              opacity: 1 }}>
              <div style={{ "--turn": f.turn, animation: `pk-chandeleur-flip ${f.stick ? 0.95 : f.d}s ease-in-out ${f.t.toFixed(2)}s both` }}>
                <Crepe w={pw * 0.54}/>
              </div>
            </div>
          ))}
          <Pan w={pw}/>
        </div>
      </div>
      <FxLayer k="chandeleur" fx={fx}/>
      {ph === 0 && <Pill key="a">🥞 Chandeleur ! Une pièce dans la main gauche, la poêle dans la droite… et hop !</Pill>}
      {ph === 1 && <Pill key="b">Une crêpe au plafond… et toute la page qui saute avec !</Pill>}
      {ph === 2 && <Pill key="c">Dernière crêpe, la plus dorée.</Pill>}
      {ph === 3 && <Pill key="d" fade>Toutes retombées dans la poêle : prospérité assurée pour l'année !</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Saint-Valentin : coeurs, la page qui bat, fleche de Cupidon
// ════════════════════════════════════════════════════════════════════════════
const HEART_D = "M12 21 C12 21 2 14.5 2 8 C2 4.5 4.7 2 7.8 2 C9.7 2 11.2 3 12 4.4 C12.8 3 14.3 2 16.2 2 C19.3 2 22 4.5 22 8 C22 14.5 12 21 12 21 Z";
const Heart = ({ s, c }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" style={{ display: "block", overflow: "visible" }}>
    <path d={HEART_D} fill={c}/><path d="M6 6.5 C6.6 5.2 8 4.6 9 5" fill="none" stroke="rgba(255,255,255,.6)" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);
const SV_CSS = driftCss("saint-valentin") + wordCss("saint-valentin") + `
@keyframes pk-saint-valentin-veil { 0% { opacity: 0 } 8%, 88% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-saint-valentin-arrow { from { transform: translate(var(--x0), var(--y0)) rotate(var(--a)) } to { transform: translate(var(--x1), var(--y1)) rotate(var(--a)) } }
@keyframes pk-saint-valentin-big { 0% { transform: translate(-50%, -50%) scale(0); opacity: 0 } 18% { transform: translate(-50%, -50%) scale(1.25); opacity: 1 }
  28% { transform: translate(-50%, -50%) scale(.95) } 38% { transform: translate(-50%, -50%) scale(1.12) } 48%, 80% { transform: translate(-50%, -50%) scale(1); opacity: 1 }
  100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0 } }
`;
function Arrow({ w }) {
  return (
    <svg width={w} height={w * 0.16} viewBox="0 0 200 32" style={{ display: "block", overflow: "visible" }}>
      <path d="M10 16 L176 16" stroke="#92400e" strokeWidth="3.5" strokeLinecap="round"/>
      <path d="M2 8 L22 16 L2 24 L10 16 Z M14 6 L32 16 L14 26 L22 16 Z" fill="#f9a8d4" stroke="#db2777" strokeWidth="1"/>
      <g transform="translate(184 16) rotate(90) scale(.95) translate(-12 -12)"><path d={HEART_D} fill="#e11d48" stroke="#9f1239" strokeWidth="1.2"/></g>
    </svg>
  );
}
function SaintValentin({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const [fx, addFx] = useFx(s);
  const hearts = useMemo(() => makeDrift(isNarrow() ? 30 : 46, { t0: 0, t1: 7, d: [4, 6.5], size: [14, 40],
    colors: ["#f43f5e", "#ec4899", "#fb7185", "#f9a8d4", "#e11d48", "#be123c"] }), []);
  const arr = useMemo(() => {
    const W = vw(), H = vh(), x0 = -260, y0 = H * 0.62, x1 = W + 60, y1 = H * 0.24;
    return { x0, y0, x1, y1, a: Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI, w: isNarrow() ? 160 : 220 };
  }, []);
  useEffect(() => {
    const { ctl } = s;
    const at = atomsOf(ctl, 120);
    // tout bat comme un coeur : boum-boum… boum-boum
    at.forEach(o => ctl.anim(o.c, [
      { transform: "scale(1)" }, { transform: "scale(1.12)", offset: 0.1 }, { transform: "scale(1)", offset: 0.22 },
      { transform: "scale(1.07)", offset: 0.32 }, { transform: "scale(1)", offset: 0.46 }, { transform: "scale(1)" },
    ], { duration: 1000, delay: 800, iterations: 7, easing: "ease-in-out" }));
    ctl.after(5150, () => { addFx({ burst: true, x: vw() / 2, y: vh() * 0.42, n: 22, dist: 140, colors: ["#f43f5e", "#f9a8d4", "#fff"], size: 10 }); setPh(2); });
    steps(ctl, setPh, [4400]);
    ctl.after(8000, () => setPh(3));
    ctl.after(10400, () => { setPh(4); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={SV_CSS}>
      <Veil bg="radial-gradient(ellipse at 50% 45%, rgba(244,114,182,.22), rgba(190,24,93,.30))" anim="pk-saint-valentin-veil 10.4s ease both"/>
      {ph < 4 && <Drift k="saint-valentin" dir="rise" items={hearts} render={b => <Heart s={b.size} c={b.c}/>}/>}
      {ph >= 1 && (
        <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, "--x0": px(arr.x0), "--y0": px(arr.y0), "--x1": px(arr.x1), "--y1": px(arr.y1),
          "--a": `${arr.a.toFixed(1)}deg`, animation: "pk-saint-valentin-arrow 1.5s cubic-bezier(.3,.2,.5,1) both" }}>
          <Arrow w={arr.w}/>
        </div>
      )}
      {ph >= 2 && ph < 4 && (
        <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "42%", animation: "pk-saint-valentin-big 4s ease both",
          filter: "drop-shadow(0 8px 20px rgba(190,18,60,.5))" }}>
          <Heart s={isNarrow() ? 130 : 170} c="#e11d48"/>
        </div>
      )}
      {ph === 2 && <Word k="saint-valentin" x={vw() / 2} y={vh() * 0.42 + (isNarrow() ? 90 : 110)} text="Coup de foudre !" size={isNarrow() ? 26 : 34} color="#fff1f2" edge="#9f1239" dur={2.4}/>}
      <FxLayer k="saint-valentin" fx={fx}/>
      {ph === 0 && <Pill key="a">💗 Ton atelier a le cœur qui bat… pour qui donc ?</Pill>}
      {(ph === 1 || ph === 2) && <Pill key="b">💘 En plein dans le mille, Cupidon !</Pill>}
      {ph === 3 && <Pill key="c">Joyeuse Saint-Valentin ! Même ton imprimante a un faible pour toi.</Pill>}
      {ph === 4 && <Pill key="d" fade>Amour, gloire et PLA.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Mardi gras : carnaval, confettis, serpentins, masques, la page danse
// ════════════════════════════════════════════════════════════════════════════
const MG_CSS = driftCss("mardi-gras") + `
@keyframes pk-mardi-gras-draw { 0% { stroke-dashoffset: 1; opacity: 1 } 70% { stroke-dashoffset: 0; opacity: 1 } 100% { stroke-dashoffset: 0; opacity: 0 } }
@keyframes pk-mardi-gras-mask { 0% { transform: translate(-50%, -50%) scale(0) rotate(-40deg) } 12% { transform: translate(-50%, -50%) scale(1.2) rotate(8deg) }
  18%, 84% { transform: translate(-50%, -50%) scale(1) rotate(-4deg) } 100% { transform: translate(-50%, -50%) scale(0) rotate(30deg) } }
@keyframes pk-mardi-gras-wob { 0%, 100% { rotate: -6deg } 50% { rotate: 6deg } }
`;
function Mask({ w, c, c2 }) {
  return (
    <svg width={w} height={w * 0.62} viewBox="0 0 100 62" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 3px 4px rgba(0,0,0,.35))" }}>
      <path d="M50 4 C64 0 76 6 80 2 C86 -2 92 4 88 10 L100 22 C98 34 90 48 74 48 C62 48 56 40 50 40 C44 40 38 48 26 48 C10 48 2 34 0 22 L12 10 C8 4 14 -2 20 2 C24 6 36 0 50 4 Z"
        fill={c} stroke="#fde047" strokeWidth="2.5"/>
      <path d="M18 22 C24 14 36 16 40 24 C34 30 24 30 18 22 Z M82 22 C76 14 64 16 60 24 C66 30 76 30 82 22 Z" fill="#111827"/>
      <path d="M50 6 L50 38" stroke={c2} strokeWidth="3" strokeDasharray="3 3"/>
      <path d="M86 8 C94 -10 104 -12 108 -6 C100 -4 94 2 88 10 Z" fill={c2}/>
      <path d="M90 10 C102 -2 112 0 114 6 C106 6 98 8 92 14 Z" fill="#fde047"/>
      {[16, 30, 70, 84].map(x => <circle key={x} cx={x} cy={40} r="2.6" fill="#fde047"/>)}
    </svg>
  );
}
function streamerPath(x0, y0, W, H) {
  let d = `M${x0.toFixed(0)} ${y0.toFixed(0)}`;
  let x = x0, y = y0;
  const dir = x0 < W / 2 ? 1 : -1;
  for (let i = 0; i < 6; i++) {
    const nx = x + dir * rand(30, 110), ny = y - rand(70, 150);
    d += ` C${(x + dir * rand(60, 140)).toFixed(0)} ${(y - rand(0, 60)).toFixed(0)}, ${(nx - dir * rand(60, 140)).toFixed(0)} ${(ny + rand(0, 60)).toFixed(0)}, ${nx.toFixed(0)} ${ny.toFixed(0)}`;
    x = nx; y = ny;
    if (y < -40) break;
  }
  return d;
}
function MardiGras({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const [masks, setMasks] = useState([]);
  const bind = useAnchors(s);
  const W = vw(), H = vh();
  const conf = useMemo(() => makeDrift(isNarrow() ? 70 : 120, { t0: 0, t1: 6.5, d: [3, 5.5], size: [10, 18] }), []);
  const streamers = useMemo(() => Array.from({ length: isNarrow() ? 8 : 12 }, (_, i) => ({
    d: streamerPath(i % 2 ? W - rand(0, W * 0.3) : rand(0, W * 0.3), H - navPad(), W, H), c: FILAMENTS[(i * 3) % FILAMENTS.length],
    dl: 0.6 + i * 0.35 + rand(0, 0.3), w: rand(3, 5) })), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { ctl } = s;
    const at = atomsOf(ctl, 120);
    at.forEach((o, i) => {
      const sg = i % 2 ? 1 : -1, h = amp(o.r, 12), r = amp(o.r, 9) * sg;
      ctl.anim(o.c, [
        { transform: "translate(0,0) rotate(0deg)" },
        { transform: `translate(${(-4 * sg).toFixed(1)}px,${(-h).toFixed(1)}px) rotate(${r.toFixed(1)}deg)`, offset: 0.25 },
        { transform: "translate(0,0) rotate(0deg)", offset: 0.5 },
        { transform: `translate(${(4 * sg).toFixed(1)}px,${(-h).toFixed(1)}px) rotate(${(-r).toFixed(1)}deg)`, offset: 0.75 },
        { transform: "translate(0,0) rotate(0deg)" },
      ], { duration: 900, delay: 900 + (i % 5) * 60, iterations: 7, easing: "ease-in-out" });
    });
    const tl = tilesOf(ctl, isNarrow() ? 4 : 7, 60);
    setMasks(tl.map((o, i) => ({ id: i, c: o.c, r: o.r, fx: rand(0.2, 0.8), col: ["#7c3aed", "#db2777", "#0891b2", "#16a34a", "#ea580c", "#2563eb", "#be123c"][i % 7],
      col2: ["#fde047", "#22d3ee", "#f472b6", "#a3e635"][i % 4], dl: 1.2 + i * 0.25, w: isNarrow() ? 64 : 84 })));
    steps(ctl, setPh, [4200, 8400]);
    ctl.after(10600, () => { setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={MG_CSS}>
      {ph < 3 && <Drift k="mardi-gras" items={conf} render={confetto}/>}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden="true">
        {streamers.map((t, i) => (
          <path key={i} d={t.d} pathLength="1" fill="none" stroke={t.c} strokeWidth={t.w} strokeLinecap="round" strokeDasharray="1 1"
            style={{ strokeDashoffset: 1, animation: `pk-mardi-gras-draw 4.2s ease-out ${t.dl.toFixed(2)}s both` }}/>
        ))}
      </svg>
      {masks.map(m => (
        <div key={m.id} ref={bind("m" + m.id, m.c, m.fx, 0, 0, 6)} style={{ ...ANCHOR, transform: anchorAt(m.r, m.fx, 0, 0, 6) }}>
          <div style={{ position: "absolute", left: 0, top: 0, animation: `pk-mardi-gras-mask ${(8.4 - m.dl).toFixed(2)}s ease ${m.dl.toFixed(2)}s both` }}>
            <div style={{ animation: `pk-mardi-gras-wob 1.1s ease-in-out ${(-m.id * 0.3).toFixed(1)}s infinite` }}><Mask w={m.w} c={m.col} c2={m.col2}/></div>
          </div>
        </div>
      ))}
      {ph === 0 && <Pill key="a">🎭 Carnaval ! Masques, confettis et serpentins : l'atelier fait la fête.</Pill>}
      {ph === 1 && <Pill key="b">Tout le monde danse, même les bobines de l'AMS.</Pill>}
      {ph === 2 && <Pill key="c">Dernier tour de char… demain, on range les beignets.</Pill>}
      {ph === 3 && <Pill key="d" fade>Le carnaval est passé. Il reste des confettis dans l'extrudeur.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Poisson d'avril : un poisson colle dans le dos d'une carte (geste facultatif)
// ════════════════════════════════════════════════════════════════════════════
const PA_CSS = wordCss("poisson-avril") + `
@keyframes pk-poisson-avril-swim { from { transform: translateX(-140px) } to { transform: translateX(calc(100vw + 140px)) } }
@keyframes pk-poisson-avril-wig { 0%, 100% { transform: translateY(-8px) rotate(-6deg) } 50% { transform: translateY(8px) rotate(6deg) } }
@keyframes pk-poisson-avril-slap { 0% { transform: scale(1.8) rotate(-40deg); opacity: 0 } 40% { transform: scale(.92) rotate(-10deg); opacity: 1 }
  60% { transform: scale(1.06) rotate(-16deg) } 100% { transform: scale(1) rotate(-14deg); opacity: 1 } }
@keyframes pk-poisson-avril-flap { 0%, 100% { transform: rotate(-14deg) } 50% { transform: rotate(-20deg) } }
@keyframes pk-poisson-avril-peel { 0% { transform: rotate(-14deg) } 18% { transform: rotate(-48deg) translate(-2px, -4px) } 30% { transform: rotate(14deg) }
  42% { transform: rotate(-30deg) translate(-10px, -30px) } 100% { transform: rotate(-400deg) translate(-60px, -110vh) } }
`;
function Fish({ w, c, tape }) {
  return (
    <svg width={w} height={w * 0.56} viewBox="0 0 66 37" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.3))" }}>
      <path d="M4 18 C12 3 38 1 50 18 C38 35 12 33 4 18 Z" fill={c} stroke="#fff" strokeWidth="2.4" strokeLinejoin="round"/>
      <path d="M49 18 L64 5 L60 18 L64 31 Z" fill={c} stroke="#fff" strokeWidth="2.4" strokeLinejoin="round"/>
      <path d="M8 18 C14 8 34 6 45 18 C34 30 14 28 8 18 Z" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="1" strokeDasharray="2.5 2.5"/>
      <path d="M24 10 Q28 18 24 26 M32 10 Q36 18 32 26" fill="none" stroke="rgba(255,255,255,.6)" strokeWidth="1.6"/>
      <circle cx="14" cy="15" r="3" fill="#fff"/><circle cx="13.3" cy="15" r="1.6" fill="#111827"/>
      {tape && <rect x="4" y="9" width="16" height="9" rx="1" fill="rgba(254,249,195,.7)" stroke="rgba(161,98,7,.35)" strokeWidth=".6" transform="rotate(-24 12 13)"/>}
    </svg>
  );
}
function PoissonAvril({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState("play"); // play, peel, end
  const [auto, setAuto] = useState(false);
  const [stuck, setStuck] = useState(null);
  const [fx, addFx] = useFx(s);
  const phRef = useRef("play");
  const fishRef = useRef(null);
  const bind = useAnchors(s);
  const swimmers = useMemo(() => Array.from({ length: isNarrow() ? 7 : 11 }, (_, i) => ({
    y: rand(0.12, 0.78) * (vh() - navPad()), dl: rand(0.2, 9), d: rand(5, 9), w: rand(40, 70), rev: i % 2 === 1,
    c: ["#f97316", "#38bdf8", "#f472b6", "#facc15", "#4ade80", "#a78bfa"][i % 6], wd: rand(0.7, 1.1) })), []);
  useEffect(() => {
    const { ctl } = s;
    const tl = tilesOf(ctl, 12, 70).filter(o => o.r.bottom < vh() - navPad() - 30 || o.r.top < vh() * 0.5);
    tl.sort((a, b) => (b.r.width * Math.min(b.r.height, 200)) - (a.r.width * Math.min(a.r.height, 200)));
    const o = tl[0];
    if (o) {
      const fy = clamp((Math.min(o.r.bottom, vh() - navPad() - 40) - o.r.top - 30) / o.r.height, 0.2, 0.85);
      setStuck({ c: o.c, r: o.r, fx: clamp(1 - 60 / o.r.width, 0.5, 0.86), fy });
    }
    ctl.after(11000, () => { if (phRef.current === "play") { setAuto(true); peel(); } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const peel = () => {
    const { ctl } = s;
    if (phRef.current !== "play") return;
    phRef.current = "peel";
    setPh("peel");
    const b = fishRef.current ? fishRef.current.getBoundingClientRect() : { left: vw() / 2, top: vh() / 2, width: 0, height: 0 };
    addFx({ text: "Poisson d'avril !", x: clamp(b.left + b.width / 2, 110, vw() - 110), y: b.top - 10, size: isNarrow() ? 24 : 30, color: "#fff", edge: "#c2410c" }, 1600);
    // la page se tord de rire
    atomsOf(ctl, 120).forEach(a => ctl.anim(a.c, [
      { transform: "translate(0,0) rotate(0deg)" }, { transform: `translate(-2px,-3px) rotate(${rand(-4, 4).toFixed(1)}deg)`, offset: 0.2 },
      { transform: "translate(2px,0) rotate(0deg)", offset: 0.4 }, { transform: `translate(-1px,-2px) rotate(${rand(-3, 3).toFixed(1)}deg)`, offset: 0.6 },
      { transform: "translate(1px,0) rotate(0deg)", offset: 0.8 }, { transform: "translate(0,0) rotate(0deg)" },
    ], { duration: 420, delay: 300 + rand(0, 300), iterations: 3 }));
    ctl.after(3600, () => { phRef.current = "end"; setPh("end"); s.finish(); });
  };
  const fw = isNarrow() ? 64 : 76;
  return (
    <Layer s={s} css={PA_CSS}>
      {ph !== "end" && swimmers.map((f, i) => (
        <div key={i} aria-hidden="true" style={{ position: "absolute", left: 0, top: f.y, animation: `pk-poisson-avril-swim ${f.d.toFixed(2)}s linear ${f.dl.toFixed(2)}s both${f.rev ? " reverse" : ""}` }}>
          <div style={{ transform: f.rev ? "none" : "scaleX(-1)" }}>
            <div style={{ animation: `pk-poisson-avril-wig ${f.wd.toFixed(2)}s ease-in-out infinite` }}><Fish w={f.w} c={f.c}/></div>
          </div>
        </div>
      ))}
      {stuck && (
        <div ref={bind("fish", stuck.c, stuck.fx, stuck.fy, -fw / 2, -fw * 0.28)} style={{ ...ANCHOR, transform: anchorAt(stuck.r, stuck.fx, stuck.fy, -fw / 2, -fw * 0.28) }}>
          <button ref={fishRef} type="button" aria-label="Poisson collé" onPointerDown={e => { e.stopPropagation(); peel(); }}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") peel(); }}
            style={{ position: "absolute", left: -8, top: -8, padding: 8, border: "none", background: "transparent", cursor: "pointer",
              pointerEvents: ph === "play" ? "auto" : "none", touchAction: "manipulation" }}>
            <div style={{ transformOrigin: "14% 35%", animation: ph === "play" ? "pk-poisson-avril-slap .5s ease-out .8s both, pk-poisson-avril-flap 1.6s ease-in-out 2s infinite"
              : "pk-poisson-avril-peel 1.9s cubic-bezier(.4,0,.7,1) both" }}>
              <Fish w={fw} c="#fb923c" tape/>
            </div>
          </button>
        </div>
      )}
      <FxLayer k="poisson-avril" fx={fx}/>
      {ph === "play" && <Pill key="a">🐟 Des poissons nagent dans l'atelier… et l'un d'eux s'est collé dans le dos d'une carte. Décolle-le !</Pill>}
      {ph === "peel" && <Pill key="b">{auto ? "Il se décolle tout seul… et s'envole !" : "Bien vu ! Il était là depuis ce matin."}</Pill>}
      {ph === "end" && <Pill key="c" fade>Poisson d'avril ! Rassure-toi, il était en papier (pas en PETG).</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Paques : les cloches sement des oeufs caches derriere la page (geste facultatif)
// ════════════════════════════════════════════════════════════════════════════
const EGG_W = 26, EGG_H = 34, PEEK = 14, SLIP = EGG_H - PEEK;
const PQ_CSS = wordCss("paques") + `
@keyframes pk-paques-fly { from { transform: translateX(calc(100vw + 40px)) } to { transform: translateX(-140px) } }
@keyframes pk-paques-bob { 0%, 100% { transform: translateY(-6px) rotate(-10deg) } 50% { transform: translateY(6px) rotate(10deg) } }
@keyframes pk-paques-wing { 0%, 100% { transform: scaleY(1) } 50% { transform: scaleY(.35) } }
@keyframes pk-paques-drop { from { transform: translate(var(--fx), var(--fy)) rotate(-30deg) } to { transform: translate(0, 0) rotate(0deg) } }
@keyframes pk-paques-slip { from { transform: translateY(0) } to { transform: translateY(${SLIP}px) } }
@keyframes pk-paques-peek { 0%, 100% { transform: translateY(${SLIP}px) } 50% { transform: translateY(${SLIP - 7}px) rotate(8deg) } }
@keyframes pk-paques-pop { 0% { transform: translateY(${SLIP}px) } 35% { transform: translateY(-46px) rotate(200deg) scale(1.5) } 70% { transform: translateY(-40px) rotate(360deg) scale(1.4); opacity: 1 }
  100% { transform: translateY(-70px) rotate(360deg) scale(.6); opacity: 0 } }
`;
function Bell({ w }) {
  return (
    <svg width={w} height={w * 1.05} viewBox="0 0 80 84" style={{ display: "block", overflow: "visible" }}>
      <defs><linearGradient id="pk4-bell" x1="0" x2="1"><stop offset="0" stopColor="#b45309"/><stop offset=".4" stopColor="#fde68a"/><stop offset="1" stopColor="#a16207"/></linearGradient></defs>
      <g style={{ transformBox: "fill-box", transformOrigin: "100% 50%", animation: "pk-paques-wing .35s ease-in-out infinite" }}>
        <path d="M24 34 C10 20 0 26 2 32 C0 36 6 40 10 38 C4 44 10 48 16 44 C14 50 22 50 26 44 Z" fill="#fff" stroke="#cbd5e1" strokeWidth="1.2"/>
      </g>
      <g style={{ transformBox: "fill-box", transformOrigin: "0% 50%", animation: "pk-paques-wing .35s ease-in-out infinite" }}>
        <path d="M56 34 C70 20 80 26 78 32 C80 36 74 40 70 38 C76 44 70 48 64 44 C66 50 58 50 54 44 Z" fill="#fff" stroke="#cbd5e1" strokeWidth="1.2"/>
      </g>
      <path d="M40 12 C28 12 24 24 24 36 C24 48 20 54 14 60 L66 60 C60 54 56 48 56 36 C56 24 52 12 40 12 Z" fill="url(#pk4-bell)" stroke="#92400e" strokeWidth="1.5"/>
      <rect x="14" y="58" width="52" height="5" rx="2.5" fill="#d97706"/>
      <circle cx="40" cy="68" r="5" fill="#92400e"/>
      <path d="M40 12 C32 2 24 6 30 12 C24 16 34 18 40 12 C46 18 56 16 50 12 C56 6 48 2 40 12 Z" fill="#dc2626"/>
    </svg>
  );
}
const EGG_FOILS = [["#7c2d12", "#a16207", "#fde047"], ["#3f1d0b", "#5b2a12", "#f472b6"], ["#b45309", "#d97706", "#60a5fa"],
  ["#dc2626", "#ef4444", "#fde047"], ["#2563eb", "#3b82f6", "#f9fafb"], ["#16a34a", "#22c55e", "#fde047"]];
function Egg({ v }) {
  const [a, b, rib] = EGG_FOILS[v % EGG_FOILS.length];
  return (
    <svg width={EGG_W} height={EGG_H} viewBox="0 0 26 34" style={{ display: "block", overflow: "visible" }}>
      <defs><radialGradient id={`pk4-egg${v}`} cx=".35" cy=".3"><stop offset="0" stopColor={b}/><stop offset="1" stopColor={a}/></radialGradient></defs>
      <path d="M13 1 C5 1 1 14 1 21 C1 29 6 33 13 33 C20 33 25 29 25 21 C25 14 21 1 13 1 Z" fill={`url(#pk4-egg${v})`} stroke="rgba(0,0,0,.25)" strokeWidth=".8"/>
      <path d="M1.6 18 L5 15 L9 18 L13 15 L17 18 L21 15 L24.4 18" fill="none" stroke={rib} strokeWidth="2.2"/>
      <ellipse cx="8.5" cy="9" rx="2.6" ry="4" fill="rgba(255,255,255,.35)"/>
    </svg>
  );
}
function Paques({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0); // 0 cloches, 1 cherche, 2 trouves (ou devoiles), 3 fin
  const [eggs, setEggs] = useState([]);
  const [found, setFound] = useState(0);
  const [auto, setAuto] = useState(false);
  const [fx, addFx] = useFx(s);
  const eggsRef = useRef([]);
  const phRef = useRef(0);
  const bind = useAnchors(s);
  const bells = useMemo(() => [{ y: 58, d: 4.2, dl: 0.4, w: isNarrow() ? 54 : 70 }, { y: 120, d: 4.6, dl: 1.0, w: isNarrow() ? 44 : 56 },
    { y: 84, d: 4.0, dl: 1.7, w: isNarrow() ? 48 : 62 }], []);
  useEffect(() => {
    const { ctl } = s;
    const W = vw(), H = vh(), N = isNarrow() ? 4 : 6;
    const cand = shuffle(atomsOf(ctl, 120).filter(o => o.r.width >= 34 && o.r.height >= 14 && o.r.top > 90 && o.r.top < H - navPad() - 60 && o.r.left > 4 && o.r.right < W - 4));
    const picked = [];
    for (const o of cand) {
      if (picked.length >= N) break;
      if (picked.every(p => Math.abs(p.r.left - o.r.left) + Math.abs(p.r.top - o.r.top) > 90)) picked.push(o);
    }
    const list = picked.map((o, i) => {
      const fx = clamp(rand(0.2, 0.8), 18 / o.r.width, 1 - 18 / o.r.width);
      const tx = o.r.left + o.r.width * fx;
      const b = bells[i % bells.length];
      const tDrop = b.dl + b.d * (W + 40 - tx) / (W + 180);
      const by = b.y + b.w;
      return { id: i, c: o.c, r: o.r, fx, v: i, st: "wait", tDrop, fx0: 0, fy0: by - o.r.top + EGG_H };
    });
    eggsRef.current = list;
    setEggs(list.slice());
    const upd = (id, st) => { eggsRef.current = eggsRef.current.map(e => (e.id === id ? { ...e, st } : e)); setEggs(eggsRef.current.slice()); };
    list.forEach(e => {
      ctl.after(e.tDrop * 1000, () => upd(e.id, "fall"));
      ctl.after(e.tDrop * 1000 + 750, () => upd(e.id, "hid"));
    });
    const last = list.reduce((m, e) => Math.max(m, e.tDrop), 0);
    ctl.after(Math.max(4600, last * 1000 + 900), () => { phRef.current = 1; setPh(1); if (!list.length) finishWin(false); });
    // petit indice : de temps en temps, un element tremble (il y a quelque chose derriere)
    let k = 0;
    const hint = () => {
      const hid = eggsRef.current.filter(e => e.st === "hid");
      if (phRef.current === 1 && hid.length) {
        const e = hid[k++ % hid.length];
        ctl.anim(e.c, [{ transform: "rotate(0deg)" }, { transform: "rotate(-3deg)", offset: 0.25 }, { transform: "rotate(3deg)", offset: 0.5 },
          { transform: "rotate(-2deg)", offset: 0.75 }, { transform: "rotate(0deg)" }], { duration: 500 });
        upd(e.id, "hid2");
        ctl.after(900, () => { if (eggsRef.current.find(x => x.id === e.id && x.st === "hid2")) upd(e.id, "hid"); });
      }
      if (phRef.current <= 1) ctl.after(2200, hint);
    };
    ctl.after(6000, hint);
    ctl.after(15000, () => {
      if (phRef.current > 1) return;
      setAuto(true);
      const rest = eggsRef.current.filter(e => e.st !== "found");
      rest.forEach((e, i) => ctl.after(i * 260, () => pop(e.id, true)));
      ctl.after(rest.length * 260 + 200, () => finishWin(true));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const finishWin = () => {
    if (phRef.current >= 2) return;
    phRef.current = 2;
    setPh(2);
    const { ctl } = s;
    atomsOf(ctl, 120).forEach(o => ctl.anim(o.c, [{ transform: "translateY(0)" }, { transform: `translateY(${(-amp(o.r, 16)).toFixed(1)}px)`, offset: 0.4 },
      { transform: "translateY(0)" }], { duration: 600, delay: rand(0, 500), easing: "ease-out" }));
    ctl.after(3200, () => { phRef.current = 3; setPh(3); s.finish(); });
  };
  const pop = (id, quiet) => {
    const e = eggsRef.current.find(x => x.id === id);
    if (!e || e.st === "found") return;
    eggsRef.current = eggsRef.current.map(x => (x.id === id ? { ...x, st: "found" } : x));
    setEggs(eggsRef.current.slice());
    const r = e.c.getBoundingClientRect();
    const x = r.left + r.width * e.fx, y = r.top - 30;
    addFx({ burst: true, x, y, n: 14, dist: 60, colors: [EGG_FOILS[e.v % 6][2], "#fde047", "#fff", "#92400e"] });
    if (!quiet) addFx({ text: "Trouvé !", x, y: y - 26, size: 22, color: "#fef3c7", edge: "#78350f" });
    const n = eggsRef.current.filter(x2 => x2.st === "found").length;
    setFound(n);
    if (!quiet && n >= eggsRef.current.length) finishWin(false);
  };
  const total = eggs.length;
  return (
    <Layer s={s} css={PQ_CSS}>
      {bells.map((b, i) => (
        <div key={i} aria-hidden="true" style={{ position: "absolute", left: 0, top: b.y, animation: `pk-paques-fly ${b.d}s linear ${b.dl}s both` }}>
          <div style={{ animation: `pk-paques-bob 1.1s ease-in-out ${(-i * 0.4).toFixed(1)}s infinite` }}><Bell w={b.w}/></div>
        </div>
      ))}
      {eggs.map(e => e.st !== "wait" && (
        <div key={e.id} ref={bind("e" + e.id, e.c, e.fx, 0, -EGG_W / 2, -60)} style={{ ...ANCHOR, transform: anchorAt(e.r, e.fx, 0, -EGG_W / 2, -60) }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: EGG_W, height: 60, overflow: e.st === "fall" || e.st === "found" ? "visible" : "hidden" }}>
            <div style={{ position: "absolute", left: 0, top: 60 - EGG_H, "--fx": "0px", "--fy": px(e.fy0),
              animation: e.st === "fall" ? "pk-paques-drop .75s cubic-bezier(.5,0,.9,.6) both"
                : e.st === "hid" ? "pk-paques-slip .35s ease-in both"
                  : e.st === "hid2" ? "pk-paques-peek .8s ease-in-out both" : "pk-paques-pop 1s ease-out both" }}>
              <Egg v={e.v}/>
            </div>
          </div>
          {(e.st === "hid" || e.st === "hid2") && ph === 1 && (
            <button type="button" aria-label="Œuf caché" onPointerDown={ev => { ev.stopPropagation(); pop(e.id, false); }}
              onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") pop(e.id, false); }}
              style={{ position: "absolute", left: EGG_W / 2 - 24, top: 60 - PEEK - 10, width: 48, height: PEEK + 26, padding: 0, border: "none",
                background: "transparent", cursor: "pointer", pointerEvents: "auto", touchAction: "manipulation" }}/>
          )}
        </div>
      ))}
      <FxLayer k="paques" fx={fx}/>
      {ph === 0 && <Pill key="a">🔔 Les cloches reviennent de Rome… et elles sèment des œufs en chocolat !</Pill>}
      {ph === 1 && <Pill key={"b" + found}>🥚 Des œufs se cachent derrière la page : trouve-les ! ({found}/{total})</Pill>}
      {ph === 2 && <Pill key="c">{auto ? "Les œufs sortent de leur cachette… chasse terminée !" : "Tous trouvés ! Champion de la chasse aux œufs."}</Pill>}
      {ph === 3 && <Pill key="d" fade>Attention : le chocolat fond plus vite que le PLA sur un plateau à 60 °C.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 8. Muguet : des brins poussent au pied des tuiles, les clochettes tintent
// ════════════════════════════════════════════════════════════════════════════
const MU_CSS = wordCss("muguet") + `
@keyframes pk-muguet-grow { 0% { transform: scaleY(0) } 70% { transform: scaleY(1.06) } 100% { transform: scaleY(1) } }
@keyframes pk-muguet-wilt { from { transform: scaleY(1); opacity: 1 } to { transform: scaleY(0); opacity: 0 } }
@keyframes pk-muguet-bell { from { transform: scale(0) } to { transform: scale(1) } }
@keyframes pk-muguet-ring { 0%, 100% { transform: rotate(-14deg) } 50% { transform: rotate(14deg) } }
@keyframes pk-muguet-note { 0% { transform: translate(0, 0) scale(.5); opacity: 0 } 20% { opacity: 1 } 100% { transform: translate(var(--dx), -46px) scale(1.1); opacity: 0 } }
@keyframes pk-muguet-sparkle { 0%, 100% { transform: scale(0) rotate(0deg); opacity: 0 } 50% { transform: scale(1) rotate(90deg); opacity: 1 } }
`;
const MU_BELLS = [[44, 7, 1], [39, 7.5, 1], [34, 10, .95], [30, 15, .9], [28, 22, .85], [27, 30, .8]];
function Sprig({ h, flip, dl }) {
  return (
    <svg width={h * 50 / 84} height={h} viewBox="0 0 50 84" style={{ display: "block", overflow: "visible", transform: flip ? "scaleX(-1)" : "none" }}>
      <path d="M18 84 C3 62 4 32 15 13 C20 34 25 60 23 84 Z" fill="#15803d" stroke="#14532d" strokeWidth=".8"/>
      <path d="M31 84 C47 64 45 36 37 22 C31 42 28 62 28 84 Z" fill="#22c55e" stroke="#166534" strokeWidth=".8"/>
      <path d="M17 70 C14 54 15 36 15 20" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="1"/>
      <path d="M25 84 C24 60 25 36 28 22 C30 12 36 6 46 6" fill="none" stroke="#4d7c0f" strokeWidth="2"/>
      {MU_BELLS.map(([x, y, k], i) => (
        <g key={i} transform={`translate(${x} ${y + 3})`}>
          <g style={{ transformBox: "fill-box", transformOrigin: "50% 0%",
            animation: `pk-muguet-bell .35s cubic-bezier(.2,1.5,.4,1) ${(dl + 0.9 + i * 0.12).toFixed(2)}s both, pk-muguet-ring ${(0.7 + i * 0.07).toFixed(2)}s ease-in-out ${(dl + 2 + i * 0.1).toFixed(2)}s infinite` }}>
            <path d="M0 -3 L0 0" stroke="#4d7c0f" strokeWidth="1"/>
            <path d={`M${-4 * k} 4 C${-4 * k} ${-1 * k} ${4 * k} ${-1 * k} ${4 * k} 4 L${5 * k} ${7 * k} Q${3 * k} ${6 * k} ${2 * k} ${8 * k} Q0 ${6 * k} ${-2 * k} ${8 * k} Q${-3 * k} ${6 * k} ${-5 * k} ${7 * k} Z`}
              fill="#fffef5" stroke="#cbd5e1" strokeWidth=".7"/>
          </g>
        </g>
      ))}
    </svg>
  );
}
function Muguet({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const [sprigs, setSprigs] = useState([]);
  const bind = useAnchors(s);
  const notes = useMemo(() => Array.from({ length: 22 }, () => ({ x: rand(0.05, 0.95), y: rand(0.25, 0.8), dl: rand(2.6, 8.4), dx: rand(-20, 20), g: pick(["♪", "♫", "♪", "✧"]) })), []);
  useEffect(() => {
    const { ctl } = s;
    const H = vh(), lim = H - navPad() - 4;
    const tl = tilesOf(ctl, isNarrow() ? 6 : 9, 90).filter(o => o.r.bottom > 110 && o.r.bottom < lim);
    const list = [];
    tl.forEach((o, i) => {
      const n = o.r.width > 300 ? 2 : 1;
      for (let k = 0; k < n; k++) list.push({ id: list.length, c: o.c, r: o.r, fx: n === 1 ? rand(0.15, 0.85) : k ? rand(0.65, 0.9) : rand(0.1, 0.35),
        h: rand(58, 80) * (isNarrow() ? 0.85 : 1), flip: Math.random() < 0.5, dl: 0.3 + i * 0.22 + k * 0.1 });
    });
    // et toujours quelques brins au sol
    const W = vw();
    [0.08, 0.28, 0.72, 0.92].forEach((f, k) => list.push({ id: list.length, floor: true, x: W * f, h: rand(70, 92), flip: k % 2 === 1, dl: 0.2 + k * 0.2 }));
    setSprigs(list);
    atomsOf(ctl, 120).forEach(o => {
      ctl.set(o.c, { "transform-origin": "50% 100%" });
      ctl.anim(o.c, [{ transform: "rotate(0deg)" }, { transform: `rotate(${amp(o.r, 2.6).toFixed(2)}deg)`, offset: 0.25 }, { transform: "rotate(0deg)", offset: 0.5 },
        { transform: `rotate(${(-amp(o.r, 2.6)).toFixed(2)}deg)`, offset: 0.75 }, { transform: "rotate(0deg)" }],
      { duration: 2400, delay: 1500 + o.r.left / W * 600, iterations: 3, easing: "ease-in-out" });
    });
    steps(ctl, setPh, [3200, 9000]);
    ctl.after(10600, () => { setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const grow = sp => (ph >= 2 ? "pk-muguet-wilt .9s ease-in both" : `pk-muguet-grow 1.1s cubic-bezier(.3,1.2,.5,1) ${sp.dl.toFixed(2)}s both`);
  return (
    <Layer s={s} css={MU_CSS}>
      <Veil bg="radial-gradient(ellipse at 50% 100%, rgba(34,197,94,.16), transparent 70%)" anim="pk-kit-soft 10.6s ease both"/>
      {sprigs.map(sp => (sp.floor ? (
        <div key={sp.id} aria-hidden="true" style={{ position: "absolute", left: sp.x - sp.h * 0.3, bottom: navPad(), transformOrigin: "50% 100%", animation: grow(sp) }}>
          <Sprig h={sp.h} flip={sp.flip} dl={sp.dl}/>
        </div>
      ) : (
        <div key={sp.id} ref={bind("s" + sp.id, sp.c, sp.fx, 1, -sp.h * 0.3, -sp.h + 4)} style={{ ...ANCHOR, transform: anchorAt(sp.r, sp.fx, 1, -sp.h * 0.3, -sp.h + 4) }}>
          <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "50% 100%", animation: grow(sp) }}><Sprig h={sp.h} flip={sp.flip} dl={sp.dl}/></div>
        </div>
      )))}
      {ph === 1 && notes.map((n, i) => (
        <span key={i} aria-hidden="true" style={{ position: "absolute", left: `${(n.x * 100).toFixed(1)}%`, top: `${(n.y * 100).toFixed(1)}%`, fontSize: 18, fontWeight: 700,
          color: n.g === "✧" ? "#fde047" : "#16a34a", textShadow: "0 0 6px rgba(255,255,255,.8)", "--dx": px(n.dx),
          animation: `${n.g === "✧" ? "pk-muguet-sparkle" : "pk-muguet-note"} 1.4s ease-out ${(n.dl - 3.2).toFixed(2)}s both` }}>{n.g}</span>
      ))}
      {ph === 0 && <Pill key="a">🌿 Un brin pour chaque tuile, cueilli à l'aube…</Pill>}
      {ph === 1 && <Pill key="b">Écoute les clochettes : ding, ding… Ça porte bonheur !</Pill>}
      {ph >= 2 && <Pill key="c" fade>Porte-bonheur distribué. Bon 1er mai, et repose ta buse.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 9. Fete des meres : bouquet, petales, la page dessine un coeur
// ════════════════════════════════════════════════════════════════════════════
const FM_CSS = driftCss("fete-meres") + `
@keyframes pk-fete-meres-bq { 0% { transform: translate(-50%, 130%) } 10%, 90% { transform: translate(-50%, 0) } 100% { transform: translate(-50%, 130%) } }
@keyframes pk-fete-meres-bloom { 0% { transform: scale(0) rotate(-90deg) } 70% { transform: scale(1.15) rotate(8deg) } 100% { transform: scale(1) rotate(0deg) } }
@keyframes pk-fete-meres-title { 0% { transform: translate(-50%, -50%) scale(.4); opacity: 0 } 14% { transform: translate(-50%, -50%) scale(1.08); opacity: 1 }
  22%, 86% { transform: translate(-50%, -50%) scale(1); opacity: 1 } 100% { transform: translate(-50%, -50%) scale(.9); opacity: 0 } }
@keyframes pk-fete-meres-draw { 0% { stroke-dashoffset: 1; opacity: 0 } 4% { opacity: 1 } 22% { stroke-dashoffset: 0 } 80% { opacity: 1 } 100% { stroke-dashoffset: 0; opacity: 0 } }
`;
function Bouquet({ w }) {
  const fl = [[40, 46, "rose", "#e11d48"], [64, 30, "rose", "#f43f5e"], [88, 46, "rose", "#be123c"], [52, 64, "daisy", "#fff"], [78, 64, "daisy", "#fff"],
    [26, 62, "tulip", "#f472b6"], [102, 62, "tulip", "#fb7185"], [64, 52, "rose", "#fda4af"]];
  return (
    <svg width={w} height={w * 1.3} viewBox="0 0 130 170" style={{ display: "block", overflow: "visible" }}>
      {fl.map(([x, y], i) => <path key={"t" + i} d={`M65 120 Q${(65 + x) / 2} ${(120 + y) / 2 + 10} ${x} ${y}`} stroke="#15803d" strokeWidth="2.4" fill="none"/>)}
      <path d="M40 92 C30 80 34 70 44 76 Z M90 92 C100 80 96 70 86 76 Z" fill="#16a34a"/>
      {fl.map(([x, y, k, c], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <g style={{ transformBox: "fill-box", transformOrigin: "50% 50%", animation: `pk-fete-meres-bloom .6s cubic-bezier(.2,1.4,.4,1) ${(0.6 + i * 0.15).toFixed(2)}s both` }}>
            {k === "rose" && <><circle r="12" fill={c}/><path d="M-6 0 C-6 -7 6 -7 6 0 C6 5 -3 6 -3 1 C-3 -2 2 -2 2 0" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="1.6"/></>}
            {k === "daisy" && <>{Array.from({ length: 10 }, (_, j) => <ellipse key={j} rx="3.2" ry="9" fill={c} stroke="#e5e7eb" strokeWidth=".5" transform={`rotate(${j * 36}) translate(0 -8)`}/>)}<circle r="5" fill="#facc15"/></>}
            {k === "tulip" && <path d="M-9 -6 L-4 -14 L0 -7 L4 -14 L9 -6 C9 6 -9 6 -9 -6 Z" fill={c} stroke="rgba(0,0,0,.15)"/>}
          </g>
        </g>
      ))}
      <path d="M30 88 L100 88 L74 168 L56 168 Z" fill="#d6a86b" stroke="#a16207" strokeWidth="1.5"/>
      <path d="M30 88 L56 168 L50 168 Z" fill="rgba(0,0,0,.08)"/>
      <path d="M65 128 C50 116 46 132 58 132 C46 140 54 150 65 136 C76 150 84 140 72 132 C84 132 80 116 65 128 Z" fill="#ec4899"/>
      <circle cx="65" cy="132" r="4" fill="#be185d"/>
    </svg>
  );
}
function FeteMeres({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const small = isNarrow();
  const petals = useMemo(() => makeDrift(small ? 40 : 64, { t0: 0, t1: 8, d: [4.5, 7.5], size: [10, 18],
    colors: ["#fda4af", "#f43f5e", "#fecdd3", "#fb7185", "#f9a8d4", "#fff1f2"] }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const heart = useMemo(() => {
    const b = mainBox();
    const top = b.top + 12, bottom = vh() - navPad() - (small ? 150 : 70);
    const sc = Math.max(3, Math.min(Math.min(b.w * 0.85, 460) / 34, (bottom - top) / 31));
    const cx = b.left + b.w / 2, cy = (top + bottom) / 2 + 2.5 * sc;
    let d = "";
    for (let i = 0; i <= 120; i++) {
      const t = i / 120 * Math.PI * 2;
      const x = cx + 16 * Math.pow(Math.sin(t), 3) * sc, y = cy - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * sc;
      d += `${i ? " L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return { cx, cy, sc, d };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { ctl } = s;
    const at = atomsOf(ctl, 120);
    const N = Math.min(at.length, small ? 56 : 80);
    const pts = Array.from({ length: N }, (_, i) => {
      const t = i / N * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3), y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      return { x: heart.cx + x * heart.sc, y: heart.cy + y * heart.sc };
    });
    // chaque morceau va au point du coeur le plus « dans sa direction »
    const ang = (x, y) => Math.atan2(y - heart.cy, x - heart.cx);
    const inHeart = shuffle(at.slice()).slice(0, N).map(o => ({ ...o, a: ang(o.r.left + o.r.width / 2, o.r.top + o.r.height / 2) })).sort((a, b) => a.a - b.a);
    const ptsS = pts.map(p => ({ ...p, a: ang(p.x, p.y) })).sort((a, b) => a.a - b.a);
    const set = new Set(inHeart.map(o => o.c));
    const T = 7200;
    inHeart.forEach((o, i) => {
      const p = ptsS[i];
      const dx = p.x - (o.r.left + o.r.width / 2), dy = p.y - (o.r.top + o.r.height / 2);
      const sc = clamp(Math.min(52 / o.r.width, 30 / o.r.height), 0.12, 1);
      const at0 = `translate(${px(dx)},${px(dy)}) scale(${sc.toFixed(3)})`, big = `translate(${px(dx)},${px(dy)}) scale(${(sc * 1.18).toFixed(3)})`;
      ctl.anim(o.c, [
        { transform: "translate(0px,0px) scale(1)", easing: "cubic-bezier(.5,0,.3,1)" },
        { transform: at0, offset: 0.22 },
        { transform: big, offset: 0.3 }, { transform: at0, offset: 0.36 }, { transform: big, offset: 0.42 }, { transform: at0, offset: 0.5 },
        { transform: big, offset: 0.6 }, { transform: at0, offset: 0.66 }, { transform: big, offset: 0.72 },
        { transform: at0, offset: 0.8, easing: "cubic-bezier(.5,0,.3,1)" },
        { transform: "translate(0px,0px) scale(1)" },
      ], { duration: T, delay: 900 + i * 6 });
    });
    at.filter(o => !set.has(o.c)).forEach(o => ctl.anim(o.c, [{ opacity: 1 }, { opacity: 0.15, offset: 0.2 }, { opacity: 0.15, offset: 0.8 }, { opacity: 1 }], { duration: T, delay: 900 }));
    // le reste de la page s'efface derriere le coeur
    tilesOf(ctl, 30, 0).forEach(o => ctl.anim(o.c, [{ backgroundColor: getComputedStyle(o.c).backgroundColor }, { backgroundColor: "transparent", offset: 0.2 },
      { backgroundColor: "transparent", offset: 0.8 }, { backgroundColor: getComputedStyle(o.c).backgroundColor }], { duration: T, delay: 900 }));
    steps(ctl, setPh, [2600, 8200]);
    ctl.after(11000, () => { setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={FM_CSS}>
      <Veil bg="radial-gradient(ellipse at 50% 40%, rgba(253,164,175,.25), rgba(244,63,94,.12))" anim="pk-kit-soft 11s ease both"/>
      {ph < 3 && <Drift k="fete-meres" items={petals} render={b => (
        <span style={{ display: "block", width: b.size, height: b.size * 0.7, borderRadius: "70% 0 70% 0", background: b.c, boxShadow: "inset -2px -2px 3px rgba(0,0,0,.12)" }}/>
      )}/>}
      <svg aria-hidden="true" width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <path d={heart.d} pathLength="1" fill="rgba(244,63,94,.10)" stroke="#f43f5e" strokeWidth="5" strokeLinecap="round" strokeDasharray="1 1"
          style={{ strokeDashoffset: 1, filter: "drop-shadow(0 0 8px rgba(244,63,94,.8))", animation: "pk-fete-meres-draw 7.4s ease 1s both" }}/>
      </svg>
      {ph >= 1 && ph < 3 && (
        <Title top={`${heart.cy + 2 * heart.sc}px`} anim="pk-fete-meres-title 5.6s ease both"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: "italic", fontSize: small ? 30 : 46, color: "#be123c",
            textShadow: "0 0 10px #fff, 0 0 18px #fff, 0 2px 0 #fff" }}>Bonne fête<br/>maman</Title>
      )}
      <div aria-hidden="true" style={{ position: "absolute", left: small ? "78%" : "86%", bottom: small ? propBottom() : 8, animation: "pk-fete-meres-bq 11s ease both",
        filter: "drop-shadow(0 6px 10px rgba(0,0,0,.3))" }}>
        <Bouquet w={small ? 84 : 120}/>
      </div>
      {ph === 0 && <Pill key="a">💐 Un bouquet pour la plus belle… et toute la page s'y met.</Pill>}
      {ph === 1 && <Pill key="b">❤️ Bonne fête maman !</Pill>}
      {ph === 2 && <Pill key="c">Un coup de fil, ça fait toujours plaisir aussi.</Pill>}
      {ph === 3 && <Pill key="d" fade>Et un cœur imprimé en 3D, c'est encore mieux qu'un collier de nouilles.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 10. Fete des peres : cravates, moustaches, caisse a outils, barbecue
// ════════════════════════════════════════════════════════════════════════════
const FP_CSS = wordCss("fete-peres") + `
@keyframes pk-fete-peres-pop { 0% { transform: scale(0) rotate(-30deg); opacity: 0 } 60% { transform: scale(1.2) rotate(6deg); opacity: 1 } 100% { transform: scale(1) rotate(0deg); opacity: 1 } }
@keyframes pk-fete-peres-swing { 0%, 100% { transform: rotate(-9deg) } 50% { transform: rotate(9deg) } }
@keyframes pk-fete-peres-twitch { 0%, 80%, 100% { transform: scaleX(1) } 85% { transform: scaleX(1.12) rotate(3deg) } 90% { transform: scaleX(.94) rotate(-3deg) } }
@keyframes pk-fete-peres-out { to { transform: scale(0); opacity: 0 } }
@keyframes pk-fete-peres-in { 0% { transform: translateY(160%) } 100% { transform: translateY(0) } }
@keyframes pk-fete-peres-lid { 0%, 100% { transform: rotate(0deg) } 15%, 85% { transform: rotate(-70deg) } }
@keyframes pk-fete-peres-tool { 0% { transform: translate(0, 0) rotate(0deg) scale(.5); opacity: 0 } 10% { opacity: 1 } 50% { transform: translate(var(--dx), -120px) rotate(360deg) scale(1) }
  92% { opacity: 1 } 100% { transform: translate(0, 0) rotate(720deg) scale(.5); opacity: 0 } }
@keyframes pk-fete-peres-smoke { 0% { transform: translate(0, 0) scale(.4); opacity: 0 } 15% { opacity: .55 } 100% { transform: translate(var(--dx), -240px) scale(2.4); opacity: 0 } }
@keyframes pk-fete-peres-sizzle { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-1.5px) } }
@keyframes pk-fete-peres-coal { 0%, 100% { opacity: .65 } 50% { opacity: 1 } }
`;
const Mustache = ({ w }) => (
  <svg width={w} height={w / 3} viewBox="0 0 60 20" style={{ display: "block", overflow: "visible" }}>
    <path d="M30 8 C24 1 14 2 8 8 C5 11 2 12 0 9 C1 16 10 19 18 15 C24 13 28 11 30 10 C32 11 36 13 42 15 C50 19 59 16 60 9 C58 12 55 11 52 8 C46 2 36 1 30 8 Z"
      fill="#3b2416" stroke="#1c1009" strokeWidth=".8"/>
  </svg>
);
const Tie = ({ h, c }) => (
  <svg width={h * 24 / 64} height={h} viewBox="0 0 24 64" style={{ display: "block", overflow: "visible" }}>
    <path d="M6 0 L18 0 L15.5 10 L8.5 10 Z" fill={c} stroke="rgba(0,0,0,.35)" strokeWidth=".8"/>
    <path d="M8.5 10 L15.5 10 L21 50 L12 63 L3 50 Z" fill={c} stroke="rgba(0,0,0,.35)" strokeWidth=".8"/>
    {[18, 28, 38, 48].map(y => <path key={y} d={`M5 ${y + 4} L19 ${y - 4}`} stroke="rgba(255,255,255,.55)" strokeWidth="2.2"/>)}
  </svg>
);
function Toolbox({ w }) {
  const tools = [
    { dx: -40, dl: 0, el: <svg width="34" height="34" viewBox="0 0 34 34"><rect x="15" y="10" width="4" height="24" rx="2" fill="#92400e"/><rect x="6" y="4" width="22" height="9" rx="2" fill="#6b7280"/></svg> },
    { dx: 30, dl: 0.35, el: <svg width="34" height="34" viewBox="0 0 34 34"><path d="M6 28 L22 12 M22 12 C20 6 26 2 30 4 L26 8 L28 10 L32 6 C34 10 30 16 24 14" stroke="#9ca3af" strokeWidth="4" fill="none" strokeLinecap="round"/></svg> },
    { dx: -6, dl: 0.7, el: <svg width="34" height="34" viewBox="0 0 34 34"><rect x="14" y="2" width="6" height="14" rx="3" fill="#eab308"/><rect x="16" y="16" width="2" height="16" fill="#9ca3af"/></svg> },
  ];
  return (
    <div style={{ position: "relative", width: w, height: w * 0.64 }}>
      {tools.map((t, i) => (
        <div key={i} style={{ position: "absolute", left: w / 2 - 17, top: 0, "--dx": px(t.dx), animation: `pk-fete-peres-tool 1.7s ease-in-out ${(2.6 + t.dl).toFixed(2)}s 2 both` }}>{t.el}</div>
      ))}
      <svg width={w} height={w * 0.64} viewBox="0 0 110 70" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <path d="M40 18 L40 8 L70 8 L70 18" fill="none" stroke="#374151" strokeWidth="5"/>
        <rect x="6" y="22" width="98" height="46" rx="4" fill="#dc2626" stroke="#7f1d1d" strokeWidth="2"/>
        <rect x="6" y="40" width="98" height="4" fill="#991b1b"/>
        <rect x="48" y="34" width="14" height="10" rx="2" fill="#9ca3af"/>
        <g style={{ transformBox: "fill-box", transformOrigin: "0% 100%", animation: "pk-fete-peres-lid 5.4s ease 2.2s both" }}>
          <rect x="4" y="16" width="102" height="9" rx="3" fill="#ef4444" stroke="#7f1d1d" strokeWidth="2"/>
        </g>
      </svg>
    </div>
  );
}
function Bbq({ w }) {
  return (
    <svg width={w} height={w * 0.92} viewBox="0 0 110 100" style={{ display: "block", overflow: "visible" }}>
      <path d="M30 60 L18 98 M80 60 L92 98 M55 62 L55 98" stroke="#1f2937" strokeWidth="4" strokeLinecap="round"/>
      <path d="M8 34 L102 34 C102 58 84 66 55 66 C26 66 8 58 8 34 Z" fill="#111827" stroke="#374151" strokeWidth="2"/>
      <ellipse cx="55" cy="34" rx="47" ry="6" fill="#ea580c" style={{ animation: "pk-fete-peres-coal .9s ease-in-out infinite" }}/>
      {[16, 30, 44, 58, 72, 86].map(x => <path key={x} d={`M${x} 30 L${x + 10} 30`} stroke="#9ca3af" strokeWidth="1.5"/>)}
      <path d="M10 32 L100 32" stroke="#9ca3af" strokeWidth="2"/>
      {[[22, 0], [44, 0.2], [66, 0.4]].map(([x, d]) => (
        <rect key={x} x={x} y="23" width="20" height="8" rx="4" fill="#9a3412" stroke="#7c2d12" style={{ animation: `pk-fete-peres-sizzle .3s ease-in-out ${d}s infinite` }}/>
      ))}
    </svg>
  );
}
function FetePeres({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const [deco, setDeco] = useState([]);
  const [fx, addFx] = useFx(s);
  const bind = useAnchors(s);
  const small = isNarrow();
  const tw = small ? 74 : 104, bw = small ? 80 : 110;
  const smoke = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ dl: 1 + i * 0.5, dx: rand(-70, 20), s: rand(26, 44) })), []);
  useEffect(() => {
    const { ctl } = s;
    const tl = tilesOf(ctl, small ? 4 : 7, 60).filter(o => o.r.width > 110 && o.r.height > 60);
    setDeco(tl.map((o, i) => ({ id: i, c: o.c, r: o.r, fx: rand(0.35, 0.65), dl: 0.6 + i * 0.3, col: ["#1d4ed8", "#b91c1c", "#15803d", "#7c3aed", "#0f766e", "#c2410c", "#334155"][i % 7] })));
    const at = atomsOf(ctl, 120);
    // coups de marteau : la page encaisse
    [3200, 4000, 4800].forEach((t, k) => {
      ctl.after(t, () => addFx({ text: "TOC !", x: small ? 70 : 90, y: vh() - cornerBottom() - tw * 0.64 - 40 - k * 6, size: 24, color: "#fef3c7", edge: "#7f1d1d" }));
      at.forEach(o => ctl.anim(o.c, [{ transform: "translateY(0) scale(1,1)" }, { transform: "translateY(3px) scale(1.03,.9)", offset: 0.3 }, { transform: "translateY(0) scale(1,1)" }],
        { duration: 300, delay: t + o.r.left / vw() * 120, easing: "ease-out" }));
    });
    // puis tout le monde bombe le torse, en vague
    at.forEach(o => ctl.anim(o.c, [{ transform: "translateY(0) rotate(0deg) scale(1)" }, { transform: `translateY(${(-amp(o.r, 10)).toFixed(1)}px) rotate(${rand(-3, 3).toFixed(1)}deg) scale(1.05)`, offset: 0.5 },
      { transform: "translateY(0) rotate(0deg) scale(1)" }], { duration: 900, delay: 5800 + o.r.left / vw() * 700 + o.r.top / vh() * 300, iterations: 2, easing: "ease-in-out" }));
    steps(ctl, setPh, [2600, 6000, 9200]);
    ctl.after(11000, () => { setPh(4); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const out = ph >= 3;
  return (
    <Layer s={s} css={FP_CSS}>
      {deco.map(d => (
        <div key={d.id} ref={bind("d" + d.id, d.c, d.fx, 0, 0, 10)} style={{ ...ANCHOR, transform: anchorAt(d.r, d.fx, 0, 0, 10) }}>
          <div style={{ position: "absolute", left: small ? -24 : -30, top: 0, animation: out ? "pk-fete-peres-out .5s ease-in both" : `pk-fete-peres-pop .5s cubic-bezier(.2,1.4,.4,1) ${d.dl.toFixed(2)}s both` }}>
            <div style={{ animation: "pk-fete-peres-twitch 2.2s ease-in-out infinite" }}><Mustache w={small ? 48 : 60}/></div>
          </div>
          <div style={{ position: "absolute", left: small ? -9 : -12, top: small ? 22 : 26, transformOrigin: "50% 0%",
            animation: out ? "pk-fete-peres-out .5s ease-in both" : `pk-fete-peres-pop .5s cubic-bezier(.2,1.4,.4,1) ${(d.dl + 0.2).toFixed(2)}s both` }}>
            <div style={{ transformOrigin: "50% 0%", animation: `pk-fete-peres-swing ${(1.4 + d.id * 0.1).toFixed(2)}s ease-in-out infinite` }}><Tie h={small ? 48 : 64} c={d.col}/></div>
          </div>
        </div>
      ))}
      <div aria-hidden="true" style={{ position: "absolute", left: small ? 10 : 24, bottom: cornerBottom(), animation: out ? "pk-fete-peres-out .6s ease-in both" : "pk-fete-peres-in .7s ease-out .3s both" }}>
        <Toolbox w={tw}/>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", right: small ? 10 : 24, bottom: cornerBottom(), animation: out ? "pk-fete-peres-out .6s ease-in both" : "pk-fete-peres-in .7s ease-out .6s both" }}>
        {!out && smoke.map((m, i) => (
          <span key={i} style={{ position: "absolute", left: bw * 0.45, top: bw * 0.1, width: m.s, height: m.s, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(203,213,225,.85), rgba(148,163,184,0) 70%)", "--dx": px(m.dx),
            animation: `pk-fete-peres-smoke 2.8s ease-out ${m.dl.toFixed(2)}s infinite both` }}/>
        ))}
        <Bbq w={bw}/>
      </div>
      <FxLayer k="fete-peres" fx={fx}/>
      {ph === 0 && <Pill key="a">👔 Bonne fête papa ! Cravate et moustache de rigueur pour tout le monde.</Pill>}
      {ph === 1 && <Pill key="b">🔧 La caisse à outils est de sortie… toc, toc, toc.</Pill>}
      {ph === 2 && <Pill key="c">🔥 Et le barbecue fume déjà. Les saucisses, c'est papa qui gère.</Pill>}
      {ph >= 3 && <Pill key="d" fade>Bonne fête papa ! (La moustache était fausse, les saucisses non.)</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 11. Fete de la musique : notes, egaliseur, la page rebondit en rythme
// ════════════════════════════════════════════════════════════════════════════
const FMU_CSS = driftCss("fete-musique") + `
@keyframes pk-fete-musique-eq { 0% { transform: scaleY(.15) } 20% { transform: scaleY(.9) } 40% { transform: scaleY(.35) } 60% { transform: scaleY(1) } 80% { transform: scaleY(.5) } 100% { transform: scaleY(.2) } }
@keyframes pk-fete-musique-in { 0% { transform: translateY(100%) } 8%, 90% { transform: translateY(0) } 100% { transform: translateY(100%) } }
@keyframes pk-fete-musique-spot { 0% { transform: translate(-20vw, 10vh) } 50% { transform: translate(60vw, 50vh) } 100% { transform: translate(-20vw, 10vh) } }
`;
const MUSIC_BEAT = 480;
function FeteMusique({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const small = isNarrow();
  const bars = useMemo(() => Array.from({ length: small ? 16 : 32 }, (_, i) => ({ hue: Math.round(i / (small ? 16 : 32) * 300), d: rand(0.35, 0.8), dl: -rand(0, 1) })), []); // eslint-disable-line react-hooks/exhaustive-deps
  const notes = useMemo(() => makeDrift(small ? 26 : 40, { t0: 0.3, t1: 7.5, d: [3.5, 6], size: [20, 36],
    colors: ["#f472b6", "#a78bfa", "#38bdf8", "#facc15", "#4ade80", "#fb923c"] }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { ctl } = s;
    const at = atomsOf(ctl, 120);
    at.forEach(o => {
      // contretemps : une colonne sur deux rebondit sur le demi-temps
      const off = Math.floor(o.r.left / 120) % 2 ? MUSIC_BEAT / 2 : 0;
      const h = amp(o.r, 14);
      ctl.anim(o.c, [
        { transform: "translateY(0) scale(1,1)", easing: "cubic-bezier(.2,.7,.4,1)" },
        { transform: `translateY(${(-h).toFixed(1)}px) scale(.98,1.03)`, offset: 0.38, easing: "cubic-bezier(.6,0,.8,.4)" },
        { transform: "translateY(0) scale(1.05,.92)", offset: 0.72, easing: "ease-out" },
        { transform: "translateY(0) scale(1,1)" },
      ], { duration: MUSIC_BEAT, delay: 1000 + off, iterations: 15 });
    });
    steps(ctl, setPh, [3800, 8400]);
    ctl.after(10400, () => { setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const eqH = small ? 110 : 150;
  return (
    <Layer s={s} css={FMU_CSS}>
      {[["#ec4899", 0], ["#3b82f6", -2.4], ["#facc15", -4.8]].map(([c, d], i) => (
        <div key={i} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, width: "60vmin", height: "60vmin", borderRadius: "50%",
          background: `radial-gradient(circle, ${c}, transparent 65%)`, opacity: 0.2, animation: `pk-fete-musique-spot 7.2s ease-in-out ${d}s infinite, pk-kit-soft 10.4s ease both` }}/>
      ))}
      {ph < 3 && <Drift k="fete-musique" dir="rise" items={notes} render={b => (
        <span style={{ display: "block", fontSize: b.size, fontWeight: 800, color: b.c, textShadow: "0 2px 6px rgba(0,0,0,.3)", lineHeight: 1 }}>{["♪", "♫", "♬", "♩"][b.i % 4]}</span>
      )}/>}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: navPad(), height: eqH, display: "flex", alignItems: "flex-end",
        gap: small ? 4 : 6, padding: "0 8px", animation: "pk-fete-musique-in 10.4s ease both" }}>
        {bars.map((b, i) => (
          <div key={i} style={{ flex: 1, height: "100%", transformOrigin: "50% 100%", borderRadius: "4px 4px 0 0",
            background: `linear-gradient(0deg, hsl(${b.hue} 90% 55%), hsl(${(b.hue + 40) % 360} 95% 70%))`,
            WebkitMaskImage: "repeating-linear-gradient(0deg, #000 0 7px, transparent 7px 9px)", maskImage: "repeating-linear-gradient(0deg, #000 0 7px, transparent 7px 9px)",
            boxShadow: `0 0 12px hsl(${b.hue} 90% 60% / .6)`, animation: `pk-fete-musique-eq ${b.d.toFixed(2)}s ease-in-out ${b.dl.toFixed(2)}s infinite alternate` }}/>
        ))}
      </div>
      {ph === 0 && <Pill key="a">🎶 Fête de la musique ! L'atelier monte le son.</Pill>}
      {ph === 1 && <Pill key="b">Même les moteurs pas à pas jouent leur partition (M300, c'est de la musique).</Pill>}
      {ph === 2 && <Pill key="c">Et un dernier refrain, tous ensemble !</Pill>}
      {ph === 3 && <Pill key="d" fade>Rideau. Le doux ronron du ventilateur, c'est bien aussi.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 12. 14 juillet : Patrouille de France tricolore, defile au pas, feu d'artifice
// ════════════════════════════════════════════════════════════════════════════
const QJ_CSS = fwCss("quatorze-juillet") + `
@keyframes pk-quatorze-juillet-fly { from { transform: translateX(var(--x0)) } to { transform: translateX(var(--x1)) } }
@keyframes pk-quatorze-juillet-trail { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes pk-quatorze-juillet-fade { from { opacity: .9; transform: scaleY(1); filter: blur(1.5px) } to { opacity: 0; transform: scaleY(3.2); filter: blur(6px) } }
@keyframes pk-quatorze-juillet-night { 0% { opacity: 0 } 100% { opacity: 1 } }
`;
function Jet({ w }) {
  return (
    <svg width={w} height={w * 0.66} viewBox="0 0 46 30" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 3px 2px rgba(0,0,0,.35))" }}>
      <path d="M16 13 L25 2 L29 2 L27 13 Z M16 17 L25 28 L29 28 L27 17 Z" fill="#1e3a8a"/>
      <path d="M22 4 L27 4 M22 26 L27 26" stroke="#fff" strokeWidth="1.6"/>
      <path d="M2 11 L7 7 L10 7 L9 13 Z M2 19 L7 23 L10 23 L9 17 Z" fill="#1e3a8a"/>
      <path d="M1 15 L30 12 C38 12 44 14 46 15 C44 16 38 18 30 18 Z" fill="#2563eb" stroke="#1e3a8a" strokeWidth=".8"/>
      <path d="M36 14 C38 13.6 41 14.2 42 15 C41 15.8 38 16.4 36 16 Z" fill="#bae6fd"/>
      <path d="M4 15 L28 15" stroke="#ef4444" strokeWidth="1.2"/>
    </svg>
  );
}
function QuatorzeJuillet({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const small = isNarrow();
  const W = vw(), H = vh();
  const jw = small ? 36 : 48, gap = small ? 20 : 26;
  const y0 = H * (small ? 0.2 : 0.22);
  const D = 3.4, T0 = 0.6;
  const jets = useMemo(() => [[0, 0], [-1, -1], [-1, 1], [-2, -2], [-2, 2], [-2, 0], [-3, 0]].slice(0, small ? 6 : 7)
    .map(([c, r]) => ({ ox: c * jw * 0.95, oy: r * gap * 0.62, col: r < 0 ? "#2563eb" : r > 0 ? "#ef4444" : "#f8fafc" })), []); // eslint-disable-line react-hooks/exhaustive-deps
  const span = W + 4 * jw + 200;
  const shots = useMemo(() => makeShots(small ? 10 : 15, 5.2, 9.6, ["#2563eb", "#f8fafc", "#ef4444"]), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { ctl } = s;
    const at = atomsOf(ctl, 120);
    // defile au pas : gauche, droite, en cadence, on avance puis on revient
    const n = 16, step = 450, fr = [];
    for (let i = 0; i <= n; i++) {
      const x = 14 * Math.sin(i / n * Math.PI * 2);
      const r = i === 0 || i === n ? 0 : (i % 2 ? 2 : -2);
      fr.push({ transform: `translate(${x.toFixed(1)}px, 0px) rotate(${r}deg)`, offset: i / n });
      if (i < n) fr.push({ transform: `translate(${(14 * Math.sin((i + 0.5) / n * Math.PI * 2)).toFixed(1)}px, -5px) rotate(0deg)`, offset: (i + 0.5) / n });
    }
    at.forEach(o => ctl.anim(o.c, fr, { duration: n * step, delay: 1000, easing: "ease-in-out" }));
    steps(ctl, setPh, [4700, 7000, 10000]);
    ctl.after(12000, () => { setPh(4); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={QJ_CSS}>
      {ph >= 1 && <Veil bg="linear-gradient(180deg, rgba(2,6,23,.82), rgba(30,27,75,.6))" anim={ph < 4 ? "pk-quatorze-juillet-night 1.2s ease both" : "pk-kit-fade .9s ease both"}/>}
      {ph < 2 && jets.map((j, i) => {
        const start = T0 + D * (200 - j.ox) / span, dur = D * W / span;
        return (
          <div key={"t" + i} aria-hidden="true" style={{ position: "absolute", left: 0, top: y0 + j.oy - 4, width: W, height: 8, transformOrigin: "0% 50%",
            animation: `pk-quatorze-juillet-trail ${dur.toFixed(2)}s linear ${start.toFixed(2)}s both${ph >= 1 ? ", pk-quatorze-juillet-fade 2.2s ease-out both" : ""}` }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 4, background: j.col, opacity: 0.88, filter: "blur(1.5px)",
              boxShadow: j.col === "#f8fafc" ? "0 0 0 1px rgba(100,116,139,.25)" : "none" }}/>
          </div>
        );
      })}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, top: y0, "--x0": "-200px", "--x1": px(W + 4 * jw), animation: `pk-quatorze-juillet-fly ${D}s linear ${T0}s both` }}>
        {jets.map((j, i) => <div key={i} style={{ position: "absolute", left: j.ox, top: j.oy - jw * 0.33 }}><Jet w={jw}/></div>)}
      </div>
      {ph >= 1 && ph < 4 && <Fireworks k="quatorze-juillet" shots={shots.map(f => ({ ...f, t: f.t - 4.7 }))}/>}
      {ph === 0 && <Pill key="a">✈️ La Patrouille de France survole l'atelier ! En bleu, blanc, rouge.</Pill>}
      {ph === 1 && <Pill key="b">Défilé au pas… gauche, droite, gauche, droite !</Pill>}
      {ph === 2 && <Pill key="c">🎆 Et maintenant, le feu d'artifice du 14 Juillet !</Pill>}
      {ph === 3 && <Pill key="d">Bouquet final ! Vive la République, et vive le PLA.</Pill>}
      {ph === 4 && <Pill key="e" fade>Fin du feu d'artifice. Rentrez prudemment.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 13. Halloween : la nuit tombe, chauves-souris, citrouilles, toiles, fantomes
// ════════════════════════════════════════════════════════════════════════════
const HW_CSS = wordCss("halloween") + `
@keyframes pk-halloween-night { 0% { opacity: 0 } 10%, 88% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-halloween-bat { 0% { transform: translate(var(--x0), var(--y0)) } 25% { transform: translate(calc(var(--x0) * .5 + var(--x1) * .5), calc(var(--y0) + 50px)) }
  50% { transform: translate(calc(var(--x0) * .25 + var(--x1) * .75), calc(var(--y1) - 40px)) } 100% { transform: translate(var(--x1), var(--y1)) } }
@keyframes pk-halloween-flap { 0%, 100% { transform: scaleY(1) } 50% { transform: scaleY(-.5) } }
@keyframes pk-halloween-pop { 0% { transform: translate(-50%, -100%) scale(0) } 70% { transform: translate(-50%, -100%) scale(1.15) } 100% { transform: translate(-50%, -100%) scale(1) } }
@keyframes pk-halloween-out { to { transform: translate(-50%, -100%) scale(0); opacity: 0 } }
@keyframes pk-halloween-glow { 0%, 100% { opacity: 1 } 40% { opacity: .55 } 45% { opacity: .9 } 70% { opacity: .7 } }
@keyframes pk-halloween-web { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes pk-halloween-ghost { 0% { transform: translate(var(--x0), 0) ; opacity: 0 } 10%, 85% { opacity: .9 } 100% { transform: translate(var(--x1), -40px); opacity: 0 } }
@keyframes pk-halloween-float { 0%, 100% { transform: translateY(-8px) } 50% { transform: translateY(8px) } }
@keyframes pk-halloween-spider { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(var(--d)) } }
`;
function Bat({ w }) {
  return (
    <svg width={w} height={w * 0.5} viewBox="0 0 44 22" style={{ display: "block", overflow: "visible" }}>
      <g style={{ transformBox: "fill-box", transformOrigin: "50% 40%", animation: "pk-halloween-flap .22s ease-in-out infinite" }}>
        <path d="M22 8 C16 2 8 2 0 6 C4 8 6 12 5 15 C9 12 12 14 14 17 C16 13 19 12 22 12 C25 12 28 13 30 17 C32 14 35 12 39 15 C38 12 40 8 44 6 C36 2 28 2 22 8 Z" fill="#0b0b12"/>
      </g>
      <ellipse cx="22" cy="11" rx="4" ry="5.5" fill="#0b0b12"/>
      <path d="M19 6 L20 3 L21.5 6 Z M22.5 6 L24 3 L25 6 Z" fill="#0b0b12"/>
      <circle cx="20.5" cy="9.5" r=".9" fill="#f87171"/><circle cx="23.5" cy="9.5" r=".9" fill="#f87171"/>
    </svg>
  );
}
function Pumpkin({ w }) {
  return (
    <svg width={w} height={w * 0.9} viewBox="0 0 60 54" style={{ display: "block", overflow: "visible" }}>
      <path d="M30 10 C30 4 34 2 36 1" stroke="#166534" strokeWidth="4" fill="none" strokeLinecap="round"/>
      <ellipse cx="18" cy="32" rx="14" ry="20" fill="#c2410c"/><ellipse cx="42" cy="32" rx="14" ry="20" fill="#c2410c"/>
      <ellipse cx="30" cy="32" rx="16" ry="21" fill="#ea580c"/>
      <g style={{ animation: "pk-halloween-glow 1.3s ease-in-out infinite" }}>
        <path d="M17 26 L23 18 L27 27 Z M43 26 L37 18 L33 27 Z M28 30 L30 34 L32 30 Z" fill="#fde047"/>
        <path d="M14 36 C20 46 40 46 46 36 L42 38 L38 35 L34 39 L30 35 L26 39 L22 35 L18 38 Z" fill="#fde047"/>
      </g>
    </svg>
  );
}
function Web({ s, flip }) {
  const lines = [];
  for (let a = 0; a <= 90; a += 15) { const r = a * Math.PI / 180; lines.push(`M0 0 L${(100 * Math.cos(r)).toFixed(1)} ${(100 * Math.sin(r)).toFixed(1)}`); }
  [22, 40, 58, 76, 94].forEach(R => {
    let d = "";
    for (let a = 0; a <= 90; a += 15) {
      const r = a * Math.PI / 180, x = R * Math.cos(r), y = R * Math.sin(r);
      if (!a) d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
      else { const m = (a - 7.5) * Math.PI / 180, k = R * 0.86; d += ` Q${(k * Math.cos(m)).toFixed(1)} ${(k * Math.sin(m)).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`; }
    }
    lines.push(d);
  });
  return (
    <svg width={s} height={s} viewBox="0 0 100 100" style={{ display: "block", overflow: "visible", transform: flip ? "scaleX(-1)" : "none" }}>
      {lines.map((d, i) => <path key={i} d={d} pathLength="1" fill="none" stroke="rgba(226,232,240,.75)" strokeWidth=".9" strokeDasharray="1 1"
        style={{ strokeDashoffset: 1, animation: `pk-halloween-web 1.4s ease-out ${(0.6 + i * 0.08).toFixed(2)}s both` }}/>)}
    </svg>
  );
}
const Ghost = ({ w }) => (
  <svg width={w} height={w * 1.2} viewBox="0 0 50 60" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 0 10px rgba(255,255,255,.5))" }}>
    <path d="M5 58 L5 24 C5 10 14 2 25 2 C36 2 45 10 45 24 L45 58 L38 52 L31 58 L25 52 L19 58 L12 52 Z" fill="rgba(248,250,252,.92)"/>
    <ellipse cx="18" cy="24" rx="3.5" ry="5" fill="#111827"/><ellipse cx="32" cy="24" rx="3.5" ry="5" fill="#111827"/>
    <ellipse cx="25" cy="37" rx="4" ry="5" fill="#111827"/>
  </svg>
);
function Halloween({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const [pumps, setPumps] = useState([]);
  const bind = useAnchors(s);
  const small = isNarrow();
  const W = vw(), H = vh();
  const bats = useMemo(() => Array.from({ length: small ? 10 : 16 }, (_, i) => {
    const ltr = i % 2 === 0;
    return { x0: ltr ? -60 : W + 20, x1: ltr ? W + 20 : -60, y0: rand(0.08, 0.6) * H, y1: rand(0.05, 0.5) * H, d: rand(2.6, 4.2), dl: 0.9 + rand(0, 6.5), w: rand(30, 52) };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { ctl } = s;
    const tl = tilesOf(ctl, small ? 3 : 5, 120).filter(o => o.r.top > 70);
    setPumps(tl.map((o, i) => ({ id: i, c: o.c, r: o.r, fx: rand(0.15, 0.85), dl: 1.4 + i * 0.3, w: small ? 38 : 48 })));
    const at = atomsOf(ctl, 120);
    at.forEach((o, i) => {
      if (i % 5 === 0) {
        // les plus timides s'envolent un peu, comme des fantomes
        ctl.anim(o.c, [{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${(-amp(o.r, 26)).toFixed(1)}px)`, opacity: 0.35, offset: 0.35 },
          { transform: `translateY(${(-amp(o.r, 18)).toFixed(1)}px)`, opacity: 0.5, offset: 0.65 }, { transform: "translateY(0)", opacity: 1 }],
        { duration: 2600, delay: 2000 + rand(0, 3500), easing: "ease-in-out" });
        return;
      }
      const fr = [{ transform: "translate(0px,0px)", opacity: 1 }];
      for (let k = 1; k < 8; k++) fr.push({ transform: `translate(${rand(-2, 2).toFixed(1)}px,${rand(-1.5, 1.5).toFixed(1)}px)`, opacity: rand(0.55, 1).toFixed(2), offset: k / 8 });
      fr.push({ transform: "translate(0px,0px)", opacity: 1 });
      ctl.anim(o.c, fr, { duration: 700, delay: 1800 + rand(0, 600), iterations: 9 });
    });
    steps(ctl, setPh, [3600, 9400]);
    ctl.after(11400, () => { setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const webS = small ? 110 : 170;
  const out = ph >= 2;
  return (
    <Layer s={s} css={HW_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, animation: "pk-halloween-night 11.4s ease both" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(17,7,40,.86), rgba(46,16,6,.72))" }}/>
        <div style={{ position: "absolute", right: small ? 20 : "12%", top: small ? 60 : 50, width: small ? 70 : 100, height: small ? 70 : 100, borderRadius: "50%",
          background: "radial-gradient(circle at 40% 40%, #fffbeb, #fde68a 60%, #f59e0b)", boxShadow: "0 0 60px 20px rgba(253,230,138,.35)" }}>
          <span style={{ position: "absolute", left: "55%", top: "30%", width: "16%", height: "16%", borderRadius: "50%", background: "rgba(180,83,9,.25)" }}/>
          <span style={{ position: "absolute", left: "30%", top: "60%", width: "10%", height: "10%", borderRadius: "50%", background: "rgba(180,83,9,.2)" }}/>
        </div>
        <div style={{ position: "absolute", left: 0, top: 0 }}><Web s={webS}/></div>
        <div style={{ position: "absolute", right: 0, top: 0 }}><Web s={webS * 0.8} flip/></div>
        <div style={{ position: "absolute", left: webS * 0.55, top: 0, "--d": "60px", animation: "pk-halloween-spider 3s ease-in-out 1.5s infinite" }}>
          <div style={{ width: 1, height: webS * 0.6, background: "rgba(226,232,240,.7)", marginLeft: 6 }}/>
          <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4.5" fill="#0b0b12"/><path d="M1 3 L4 6 M1 11 L4 8 M13 3 L10 6 M13 11 L10 8 M0 7 L3 7 M14 7 L11 7" stroke="#0b0b12" strokeWidth="1.2"/></svg>
        </div>
        {[0.06, 0.3, 0.7, 0.94].map((f, i) => (
          <div key={i} style={{ position: "absolute", left: `${f * 100}%`, top: H - cornerBottom(), animation: `pk-halloween-pop .5s cubic-bezier(.2,1.4,.4,1) ${(1 + i * 0.25).toFixed(2)}s both` }}>
            <Pumpkin w={small ? 44 : 60}/>
          </div>
        ))}
      </div>
      {pumps.map(p => (
        <div key={p.id} ref={bind("p" + p.id, p.c, p.fx, 0, 0, 4)} style={{ ...ANCHOR, transform: anchorAt(p.r, p.fx, 0, 0, 4) }}>
          <div style={{ position: "absolute", left: 0, top: 0, animation: out ? "pk-halloween-out .5s ease-in both" : `pk-halloween-pop .5s cubic-bezier(.2,1.4,.4,1) ${p.dl.toFixed(2)}s both` }}>
            <Pumpkin w={p.w}/>
          </div>
        </div>
      ))}
      {ph < 3 && bats.map((b, i) => (
        <div key={i} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, "--x0": px(b.x0), "--x1": px(b.x1), "--y0": px(b.y0), "--y1": px(b.y1),
          animation: `pk-halloween-bat ${b.d.toFixed(2)}s ease-in-out ${b.dl.toFixed(2)}s both` }}>
          <div style={{ transform: b.x1 < b.x0 ? "scaleX(-1)" : "none" }}><Bat w={b.w}/></div>
        </div>
      ))}
      {[{ y: 0.32, x0: -80, x1: W + 20, dl: 2.6 }, { y: 0.58, x0: W + 20, x1: -80, dl: 4.6 }].map((g, i) => (
        <div key={"g" + i} aria-hidden="true" style={{ position: "absolute", left: 0, top: H * g.y, "--x0": px(g.x0), "--x1": px(g.x1),
          animation: `pk-halloween-ghost 4.4s ease-in-out ${g.dl}s both` }}>
          <div style={{ animation: "pk-halloween-float 1.6s ease-in-out infinite" }}><Ghost w={small ? 46 : 60}/></div>
        </div>
      ))}
      {ph === 1 && <Word k="halloween" x={W / 2} y={H * 0.45} text="Bouh !" size={small ? 40 : 56} color="#f8fafc" edge="#4c1d95" dur={1.6}/>}
      {ph === 0 && <Pill key="a">🎃 La nuit tombe sur l'atelier…</Pill>}
      {ph === 1 && <Pill key="b">🦇 Des chauves-souris dans le caisson ! Toute la page tremble.</Pill>}
      {ph === 2 && <Pill key="c">Le jour se lève… Les fantômes rentrent dans leur boîte à filament.</Pill>}
      {ph === 3 && <Pill key="d" fade>Plus de peur que de mal. Qui a mangé tous les bonbons ?</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 14. Beaujolais nouveau : bandeau, grappes qui tombent, la page tangue
// ════════════════════════════════════════════════════════════════════════════
const BJ_CSS = `
@keyframes pk-beaujolais-banner { 0% { transform: translate(-50%, -160%) rotate(-3deg) } 10% { transform: translate(-50%, 0) rotate(2deg) } 16% { transform: translate(-50%, 0) rotate(-1.5deg) }
  22%, 88% { transform: translate(-50%, 0) rotate(0deg) } 100% { transform: translate(-50%, -160%) rotate(2deg) } }
@keyframes pk-beaujolais-sway { 0%, 100% { transform: rotate(-1.2deg) } 50% { transform: rotate(1.2deg) } }
@keyframes pk-beaujolais-drop { 0% { transform: translate(0, -120%) rotate(var(--r)); opacity: 1 } 62% { transform: translate(0, var(--fy)) rotate(0deg) }
  74% { transform: translate(var(--dx), calc(var(--fy) - 34px)) rotate(var(--r)) } 86% { transform: translate(var(--dx), var(--fy)) rotate(0deg); opacity: 1 }
  100% { transform: translate(var(--dx), var(--fy)) rotate(0deg); opacity: 0 } }
`;
function Grapes({ w }) {
  const g = [[14, 10], [24, 10], [34, 10], [9, 19], [19, 19], [29, 19], [39, 19], [14, 28], [24, 28], [34, 28], [19, 37], [29, 37], [24, 46]];
  return (
    <svg width={w} height={w * 1.3} viewBox="0 0 48 62" style={{ display: "block", overflow: "visible" }}>
      <path d="M24 6 C24 2 26 0 29 -2" stroke="#78350f" strokeWidth="2.4" fill="none" strokeLinecap="round"/>
      <path d="M26 2 C32 -8 46 -6 46 2 C40 2 36 6 26 2 Z" fill="#65a30d" stroke="#3f6212" strokeWidth=".8"/>
      {g.map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="5.6" fill={i % 3 ? "#6b21a8" : "#581c87"}/><circle cx={x - 1.8} cy={y - 1.8} r="1.6" fill="rgba(255,255,255,.4)"/></g>)}
    </svg>
  );
}
function Beaujolais({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const small = isNarrow();
  const grapes = useMemo(() => Array.from({ length: small ? 14 : 24 }, () => ({ x: rand(2, 94), dl: rand(0.8, 7.5), d: rand(2.2, 3.2), w: rand(28, 46),
    r: `${rand(-50, 50).toFixed(0)}deg`, dx: rand(-30, 30) })), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { ctl } = s;
    // la page tangue, tout doucement, autour du centre de l'ecran
    tilesOf(ctl, 30, 0).forEach(o => {
      ctl.set(o.c, { "transform-origin": ctl.originOf(o.c) });
      ctl.anim(o.c, [{ transform: "rotate(0deg) translateX(0px)" }, { transform: "rotate(.9deg) translateX(5px)", offset: 0.25 }, { transform: "rotate(0deg) translateX(0px)", offset: 0.5 },
        { transform: "rotate(-.9deg) translateX(-5px)", offset: 0.75 }, { transform: "rotate(0deg) translateX(0px)" }], { duration: 3000, delay: 1400, iterations: 3, easing: "ease-in-out" });
    });
    steps(ctl, setPh, [4400, 9800]);
    ctl.after(11000, () => { setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fy = floorY() - 40;
  return (
    <Layer s={s} css={BJ_CSS}>
      <Veil bg="radial-gradient(ellipse at 50% 0%, rgba(126,34,206,.18), rgba(127,29,29,.12))" anim="pk-kit-soft 11s ease both"/>
      {ph < 3 && grapes.map((g, i) => (
        <div key={i} aria-hidden="true" style={{ position: "absolute", left: `${g.x.toFixed(1)}%`, top: 0, "--fy": px(fy - g.w * 1.3), "--r": g.r, "--dx": px(g.dx),
          animation: `pk-beaujolais-drop ${g.d.toFixed(2)}s linear ${g.dl.toFixed(2)}s both` }}>
          <Grapes w={g.w}/>
        </div>
      ))}
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: small ? 14 : 22, width: small ? "calc(100vw - 20px)" : "auto",
        animation: "pk-beaujolais-banner 10.6s cubic-bezier(.3,1.2,.5,1) .3s both" }}>
        <div style={{ transformOrigin: "50% 0%", animation: "pk-beaujolais-sway 3s ease-in-out 1.6s infinite" }}>
          <div style={{ padding: small ? "10px 26px" : "14px 46px", background: "linear-gradient(180deg, #9f1239, #7f1d1d)", color: "#fff7ed",
            fontWeight: 900, fontStyle: "italic", fontSize: small ? 17 : 26, textAlign: "center", lineHeight: 1.2, letterSpacing: ".01em",
            textShadow: "0 2px 0 rgba(0,0,0,.35)", boxShadow: "0 10px 24px rgba(0,0,0,.35)", whiteSpace: small ? "normal" : "nowrap",
            clipPath: "polygon(0 0, 100% 0, calc(100% - 16px) 50%, 100% 100%, 0 100%, 16px 50%)" }}>
            🍇 Le Beaujolais nouveau est arrivé ! 🍇
          </div>
        </div>
      </div>
      {ph === 0 && <Pill key="a">🍇 Troisième jeudi de novembre : la nouvelle cuvée débarque !</Pill>}
      {ph === 1 && <Pill key="b">Ça tangue un peu… c'est le roulis du tonneau (ici, c'est jus de raisin).</Pill>}
      {ph === 2 && <Pill key="c">Les grappes sont ramassées, la page reprend son aplomb.</Pill>}
      {ph === 3 && <Pill key="d" fade>Cuvée terminée. Vivement les vendanges de bobines.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 15. Sortie d'un jeu tres attendu (19/11/2026) : couchant, etoiles, poursuite
// Pastiche du genre, sans logo, police ni visuel officiel.
// ════════════════════════════════════════════════════════════════════════════
const GTA_CSS = `
@keyframes pk-gta-vi-sky { 0% { opacity: 0 } 8%, 90% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-gta-vi-sun { 0% { transform: translate(-50%, 60%) } 12%, 90% { transform: translate(-50%, 0) } 100% { transform: translate(-50%, 60%) } }
@keyframes pk-gta-vi-star { 0% { transform: scale(1) } 30% { transform: scale(1.6) } 100% { transform: scale(1) } }
@keyframes pk-gta-vi-blink { 0%, 100% { opacity: 1 } 50% { opacity: .15 } }
@keyframes pk-gta-vi-siren { 0%, 100% { opacity: .85 } 50% { opacity: 0 } }
@keyframes pk-gta-vi-siren2 { 0%, 100% { opacity: 0 } 50% { opacity: .85 } }
@keyframes pk-gta-vi-speed { from { transform: translateX(100vw) } to { transform: translateX(-60vw) } }
@keyframes pk-gta-vi-title { 0% { transform: translate(-50%, -50%) scale(2.2); opacity: 0 } 10% { transform: translate(-50%, -50%) scale(.96); opacity: 1 }
  14% { transform: translate(-50%, -50%) scale(1) } 86% { opacity: 1 } 100% { transform: translate(-50%, -50%) scale(1); opacity: 0 } }
@keyframes pk-gta-vi-palm { 0%, 100% { transform: rotate(-2deg) } 50% { transform: rotate(2deg) } }
`;
const STAR_D = "M12 1.5 L15 8.6 L22.6 9.2 L16.8 14.2 L18.6 21.6 L12 17.6 L5.4 21.6 L7.2 14.2 L1.4 9.2 L9 8.6 Z";
function Palm({ h, flip }) {
  return (
    <svg width={h * 0.7} height={h} viewBox="0 0 70 100" style={{ display: "block", overflow: "visible", transform: flip ? "scaleX(-1)" : "none" }}>
      <path d="M30 100 C32 70 36 46 44 24" stroke="#1e0b2e" strokeWidth="5" fill="none" strokeLinecap="round"/>
      <g style={{ transformBox: "fill-box", transformOrigin: "50% 60%", animation: "pk-gta-vi-palm 3s ease-in-out infinite" }}>
        {["M44 24 C30 14 14 16 4 26 C18 20 30 22 44 24 Z", "M44 24 C38 8 24 2 12 4 C26 8 34 14 44 24 Z", "M44 24 C52 8 64 4 70 8 C58 10 50 16 44 24 Z",
          "M44 24 C58 18 70 24 72 34 C62 26 54 24 44 24 Z", "M44 24 C46 10 40 0 32 -4 C40 6 42 14 44 24 Z"].map((d, i) => <path key={i} d={d} fill="#1e0b2e"/>)}
      </g>
    </svg>
  );
}
function GtaVi({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const [stars, setStars] = useState(0);
  const small = isNarrow();
  const lines = useMemo(() => Array.from({ length: 14 }, () => ({ y: rand(8, 88), w: rand(60, 200), d: rand(0.35, 0.7), dl: rand(0, 0.7) })), []);
  useEffect(() => {
    const { ctl } = s;
    [1500, 2200, 2900, 3600, 4300].forEach((t, i) => ctl.after(t, () => setStars(i + 1)));
    const at = atomsOf(ctl, 120);
    at.forEach(o => {
      const dx = amp(o.r, rand(50, 110)) * (Math.random() < 0.5 ? -1 : 1);
      ctl.anim(o.c, [
        { transform: "translateX(0px) skewX(0deg)" },
        { transform: `translateX(${(-dx * 0.6).toFixed(1)}px) skewX(${dx > 0 ? 12 : -12}deg)`, offset: 0.18 },
        { transform: `translateX(${(dx * 1.3).toFixed(1)}px) skewX(${dx > 0 ? -16 : 16}deg)`, offset: 0.45 },
        { transform: `translateX(${(-dx * 0.4).toFixed(1)}px) skewX(${dx > 0 ? 8 : -8}deg)`, offset: 0.72 },
        { transform: "translateX(0px) skewX(0deg)" },
      ], { duration: rand(1300, 1900), delay: 2000 + rand(0, 900), iterations: 3, easing: "ease-in-out" });
    });
    steps(ctl, setPh, [1500, 7900, 8500]);
    ctl.after(11900, () => { setPh(4); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const chase = ph >= 1 && ph < 2;
  return (
    <Layer s={s} css={GTA_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, animation: "pk-gta-vi-sky 11.9s ease both" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(76,29,149,.62) 0%, rgba(219,39,119,.5) 45%, rgba(251,146,60,.5) 75%, rgba(253,224,71,.42) 100%)" }}/>
        <div style={{ position: "absolute", left: "50%", bottom: navPad(), width: small ? 220 : 340, height: small ? 110 : 170, borderRadius: "999px 999px 0 0",
          background: "linear-gradient(180deg, #fde047, #fb923c 55%, #ec4899)", opacity: 0.85,
          WebkitMaskImage: "linear-gradient(180deg, #000 0 52%, transparent 52% 58%, #000 58% 70%, transparent 70% 75%, #000 75% 84%, transparent 84% 88%, #000 88%)",
          maskImage: "linear-gradient(180deg, #000 0 52%, transparent 52% 58%, #000 58% 70%, transparent 70% 75%, #000 75% 84%, transparent 84% 88%, #000 88%)",
          animation: "pk-gta-vi-sun 11.9s ease both" }}/>
        <div style={{ position: "absolute", left: -10, bottom: navPad() - 4 }}><Palm h={small ? 150 : 230}/></div>
        <div style={{ position: "absolute", right: -10, bottom: navPad() - 4 }}><Palm h={small ? 120 : 190} flip/></div>
      </div>
      {chase && <>
        <div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "18vw", background: "linear-gradient(90deg, rgba(239,68,68,.7), transparent)", animation: "pk-gta-vi-siren .45s steps(1) infinite" }}/>
        <div aria-hidden="true" style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "18vw", background: "linear-gradient(270deg, rgba(59,130,246,.7), transparent)", animation: "pk-gta-vi-siren2 .45s steps(1) infinite" }}/>
        {lines.map((l, i) => (
          <span key={i} aria-hidden="true" style={{ position: "absolute", left: 0, top: `${l.y.toFixed(1)}%`, width: l.w, height: 2, borderRadius: 2,
            background: "linear-gradient(90deg, rgba(255,255,255,.9), transparent)", animation: `pk-gta-vi-speed ${l.d.toFixed(2)}s linear ${l.dl.toFixed(2)}s infinite both` }}/>
        ))}
      </>}
      <div aria-hidden="true" style={{ position: "absolute", right: small ? 10 : 22, top: small ? 12 : 18, display: "flex", gap: 3,
        animation: ph === 2 ? "pk-gta-vi-blink .3s linear 2" : ph >= 3 ? "pk-kit-fade .4s ease both" : "pk-kit-fadein .5s ease .8s both" }}>
        {Array.from({ length: 5 }, (_, i) => (
          <svg key={i} width={small ? 22 : 28} height={small ? 22 : 28} viewBox="0 0 24 24"
            style={{ overflow: "visible", animation: stars > i ? "pk-gta-vi-star .35s ease-out both" : "none" }}>
            <path d={STAR_D} fill={stars > i && ph < 3 ? "#fde047" : "rgba(15,23,42,.35)"} stroke="#0f172a" strokeWidth="1.6" strokeLinejoin="round"/>
          </svg>
        ))}
      </div>
      {ph === 3 && (
        <Title top="40%" anim="pk-gta-vi-title 3.4s ease both" style={{ fontStyle: "italic", textTransform: "uppercase" }}>
          <div style={{ fontSize: "clamp(36px, 11vw, 92px)", color: "#facc15", letterSpacing: ".02em", WebkitTextStroke: "2px #111", textShadow: "4px 4px 0 #111" }}>Mission réussie</div>
          <div style={{ fontSize: "clamp(20px, 5.5vw, 36px)", color: "#fff", marginTop: 8, WebkitTextStroke: "1px #111", textShadow: "3px 3px 0 #111", textTransform: "none" }}>+ respect</div>
        </Title>
      )}
      {ph === 0 && <Pill key="a">🌴 Jour de sortie de GTA VI : l'atelier passe en mode course-poursuite.</Pill>}
      {ph === 1 && <Pill key={"b" + Math.min(stars, 5)}>★ Niveau de recherche : {stars}/5. Les bobines prennent la fuite !</Pill>}
      {(ph === 2 || ph === 3) && <Pill key="c">Semés ! On rentre tranquille, au coucher du soleil.</Pill>}
      {ph === 4 && <Pill key="d" fade>Retour au calme. Ton imprimante n'a enfreint aucune loi (sauf celle de la gravité).</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 16. Noel : neige, traineau, guirlandes, la page emballee en cadeaux
// ════════════════════════════════════════════════════════════════════════════
const NOEL_CSS = driftCss("noel") + wordCss("noel") + `
@keyframes pk-noel-sky { 0% { opacity: 0 } 8%, 90% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-noel-sleigh { 0% { transform: translate(-360px, 40px) rotate(4deg) } 50% { transform: translate(calc(50vw - 150px), -20px) rotate(-3deg) }
  100% { transform: translate(calc(100vw + 40px), 30px) rotate(5deg) } }
@keyframes pk-noel-gallop { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
@keyframes pk-noel-nose { 0%, 100% { opacity: 1 } 50% { opacity: .45 } }
@keyframes pk-noel-twinkle { 0% { transform: scale(0) rotate(0deg); opacity: 0 } 30% { transform: scale(1) rotate(45deg); opacity: 1 } 100% { transform: scale(.2) translateY(20px) rotate(120deg); opacity: 0 } }
@keyframes pk-noel-bulb { 0%, 100% { opacity: 1 } 50% { opacity: .3 } }
@keyframes pk-noel-garland { 0% { transform: translateY(-14px); opacity: 0 } 100% { transform: translateY(0); opacity: 1 } }
@keyframes pk-noel-gift { 0% { transform: scale(0) rotate(-12deg) } 65% { transform: scale(1.08) rotate(3deg) } 100% { transform: scale(1) rotate(0deg) } }
@keyframes pk-noel-unwrap { 0% { transform: scale(1) rotate(0deg); opacity: 1 } 40% { transform: scale(1.15) rotate(-4deg); opacity: 1 } 100% { transform: translateY(-40px) scale(.2) rotate(30deg); opacity: 0 } }
@keyframes pk-noel-fade { to { opacity: 0 } }
`;
function Sleigh({ w }) {
  const deer = x => (
    <g transform={`translate(${x} 0)`}>
      <g style={{ animation: `pk-noel-gallop .4s ease-in-out ${(x / 400).toFixed(2)}s infinite` }}>
        <path d="M2 40 L6 52 M10 40 L8 54 M26 40 L30 52 M34 40 L36 54" stroke="#5b3a1e" strokeWidth="2.6" strokeLinecap="round"/>
        <ellipse cx="18" cy="36" rx="17" ry="8" fill="#7c4a2d"/>
        <path d="M30 32 L38 18 L44 20 L36 34 Z" fill="#7c4a2d"/>
        <ellipse cx="44" cy="18" rx="6" ry="4.5" fill="#7c4a2d"/>
        <path d="M40 14 L36 4 M38 8 L33 6 M44 14 L46 3 M45 8 L50 5" stroke="#d6b48a" strokeWidth="1.8" strokeLinecap="round"/>
        <circle cx="45" cy="16.5" r="1" fill="#111"/>
      </g>
    </g>
  );
  return (
    <svg width={w} height={w * 0.3} viewBox="0 0 300 90" style={{ display: "block", overflow: "visible" }}>
      <path d="M72 46 C110 44 140 40 172 30 M72 50 C120 50 170 44 226 26" stroke="#facc15" strokeWidth="1.2" fill="none"/>
      <g transform="translate(96 22) scale(.95)">{deer(0)}</g>
      <g transform="translate(150 12) scale(.95)">{deer(0)}</g>
      <g transform="translate(204 4) scale(.95)">{deer(0)}<circle cx="50" cy="19" r="3.4" fill="#ef4444" style={{ animation: "pk-noel-nose .6s ease-in-out infinite" }}/></g>
      <g transform="translate(4 18)">
        <path d="M6 28 C4 16 18 10 26 22 L58 22 C62 22 64 26 62 34 L56 44 L14 44 C8 44 6 38 6 28 Z" fill="#b91c1c" stroke="#7f1d1d" strokeWidth="1.5"/>
        <path d="M2 50 L66 50 C74 50 76 42 72 40" stroke="#facc15" strokeWidth="3" fill="none" strokeLinecap="round"/>
        <path d="M16 44 L14 50 M52 44 L54 50" stroke="#facc15" strokeWidth="2.4"/>
        <ellipse cx="22" cy="14" rx="12" ry="12" fill="#92400e"/>
        <circle cx="44" cy="12" r="10" fill="#dc2626"/>
        <circle cx="44" cy="0" r="6" fill="#fcd9b6"/>
        <path d="M38 2 C38 12 50 12 50 2 C48 8 40 8 38 2 Z" fill="#f8fafc"/>
        <path d="M38 -2 C40 -12 50 -12 54 -6 L50 -4 Z" fill="#dc2626"/><circle cx="55" cy="-6" r="2.6" fill="#fff"/>
        <path d="M38 -2 L50 -2" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/>
      </g>
    </svg>
  );
}
function Garland({ w }) {
  const segs = Math.max(1, Math.round(w / 140)), sw = w / segs;
  let d = "M2 3";
  const bulbs = [];
  for (let i = 0; i < segs; i++) {
    const x0 = i * sw, x1 = (i + 1) * sw, mx = (x0 + x1) / 2;
    d += ` Q${mx.toFixed(1)} 30 ${x1.toFixed(1)} 3`;
    const nb = Math.max(3, Math.round(sw / 24));
    for (let k = 1; k < nb; k++) {
      const t = k / nb, x = (1 - t) * (1 - t) * x0 + 2 * t * (1 - t) * mx + t * t * x1, y = (1 - t) * (1 - t) * 3 + 2 * t * (1 - t) * 30 + t * t * 3;
      bulbs.push({ x, y, c: ["#ef4444", "#22c55e", "#facc15", "#3b82f6", "#ec4899"][bulbs.length % 5], dl: (bulbs.length % 3) * 0.3 });
    }
  }
  return (
    <svg width={w} height={34} viewBox={`0 0 ${w.toFixed(0)} 34`} style={{ display: "block", overflow: "visible" }}>
      <path d={d} fill="none" stroke="#14532d" strokeWidth="2"/>
      {bulbs.map((b, i) => (
        <g key={i} transform={`translate(${b.x.toFixed(1)} ${b.y.toFixed(1)})`}>
          <rect x="-1.6" y="-1" width="3.2" height="3" fill="#374151"/>
          <g style={{ animation: `pk-noel-bulb .9s ease-in-out ${b.dl}s infinite` }}>
            <circle cy="6" r="7" fill={b.c} opacity=".3"/>
            <ellipse cy="5.5" rx="3" ry="4.4" fill={b.c}/>
          </g>
        </g>
      ))}
    </svg>
  );
}
const GIFT_COLS = [["#dc2626", "#facc15"], ["#16a34a", "#f8fafc"], ["#2563eb", "#fde047"], ["#a855f7", "#f9a8d4"], ["#f59e0b", "#b91c1c"], ["#0d9488", "#fef3c7"]];
function Noel({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const [garl, setGarl] = useState([]);
  const [gifts, setGifts] = useState([]);
  const bind = useAnchors(s);
  const small = isNarrow();
  const W = vw(), H = vh();
  const snow = useMemo(() => makeDrift(small ? 55 : 95, { t0: 0, t1: 9, d: [5, 9], size: [4, 10], colors: ["#ffffff"], o: [0.6, 1], sw: [8, 26] }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const sw = small ? 220 : 300;
  const sparks = useMemo(() => Array.from({ length: 28 }, (_, i) => {
    const u = i / 28, x = -360 + (W + 400) * u + sw * 0.15, y = 70 + 40 * (1 - u) - 60 * Math.sin(u * Math.PI) + sw * 0.15;
    return { x, y: Math.max(20, y), dl: 1.4 + 4.2 * u + 0.15, s: rand(6, 12) };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { ctl } = s;
    const tl = tilesOf(ctl, small ? 5 : 8, 50).filter(o => o.r.top > 40);
    setGarl(tl.map((o, i) => ({ id: i, c: o.c, r: o.r, w: o.r.width, dl: 0.6 + i * 0.15 })));
    const at = atomsOf(ctl, 120).filter(o => o.r.width * o.r.height < 40000 && o.r.width > 10 && o.r.height > 10 && o.r.width / o.r.height < 7 && o.r.top > -10 && o.r.bottom < H + 10);
    const list = shuffle(at.slice()).slice(0, small ? 36 : 56).map((o, i) => ({ id: i, c: o.c, r: o.r, col: GIFT_COLS[i % GIFT_COLS.length], dl: rand(0, 1.3) }));
    setGifts(list);
    list.forEach(g => ctl.anim(g.c, [{ transform: "translateY(0)" }, { transform: `translateY(${(-amp(g.r, 14)).toFixed(1)}px)`, offset: 0.4 }, { transform: "translateY(0)" }],
      { duration: 600, delay: 8600 + g.dl * 600, easing: "ease-out" }));
    steps(ctl, setPh, [1400, 5600, 8500, 10400]);
    ctl.after(12200, () => { setPh(5); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Layer s={s} css={NOEL_CSS}>
      <Veil bg="linear-gradient(180deg, rgba(15,23,42,.62), rgba(30,58,138,.28))" anim="pk-noel-sky 12.2s ease both"/>
      {ph < 5 && <Drift k="noel" items={snow} render={b => (
        <span style={{ display: "block", width: b.size, height: b.size, borderRadius: "50%", background: "#fff", boxShadow: "0 0 3px rgba(100,116,139,.7)" }}/>
      )}/>}
      {garl.map(g => (
        <div key={g.id} ref={bind("g" + g.id, g.c, 0, 0, 0, -3)} style={{ ...ANCHOR, transform: anchorAt(g.r, 0, 0, 0, -3) }}>
          <div style={{ position: "absolute", left: 0, top: 0, animation: ph >= 4 ? "pk-noel-fade .8s ease both" : `pk-noel-garland .6s ease-out ${g.dl.toFixed(2)}s both` }}>
            <Garland w={g.w}/>
          </div>
        </div>
      ))}
      {ph >= 1 && ph < 3 && (
        <div aria-hidden="true" style={{ position: "absolute", left: 0, top: small ? 50 : 70, animation: "pk-noel-sleigh 4.4s linear both" }}>
          <Sleigh w={sw}/>
        </div>
      )}
      {ph >= 1 && ph < 3 && sparks.map((p, i) => (
        <span key={i} aria-hidden="true" style={{ position: "absolute", left: p.x, top: p.y + (small ? 50 : 70), color: "#fde047", fontSize: p.s * 1.6, lineHeight: 1,
          textShadow: "0 0 6px #fde047", animation: `pk-noel-twinkle 1.2s ease-out ${(p.dl - 1.4).toFixed(2)}s both` }}>✦</span>
      ))}
      {ph === 1 && <Word k="noel" x={W / 2} y={small ? 170 : 200} text="Ho ho ho !" size={small ? 30 : 40} color="#fff" edge="#b91c1c" dur={2}/>}
      {ph >= 2 && ph < 4 && gifts.map(g => {
        const bow = g.r.width >= 26 && g.r.height >= 18, rb = clamp(Math.min(g.r.width, g.r.height) * 0.14, 2, 8);
        const strip = (deg, c) => `linear-gradient(${deg}deg, transparent calc(50% - ${rb / 2}px), ${c} calc(50% - ${rb / 2}px), ${c} calc(50% + ${rb / 2}px), transparent calc(50% + ${rb / 2}px))`;
        return (
          <div key={g.id} ref={bind("k" + g.id, g.c, 0, 0, -3, -3)} style={{ ...ANCHOR, transform: anchorAt(g.r, 0, 0, -3, -3) }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: g.r.width + 6, height: g.r.height + 6, borderRadius: 4,
              backgroundColor: g.col[0], backgroundImage: `${strip(90, g.col[1])}, ${strip(0, g.col[1])}`, boxShadow: "0 3px 8px rgba(0,0,0,.3), inset 0 -3px 0 rgba(0,0,0,.15)",
              animation: ph === 3 ? `pk-noel-unwrap .6s ease-in ${(g.dl * 0.5).toFixed(2)}s both` : `pk-noel-gift .45s cubic-bezier(.2,1.4,.4,1) ${g.dl.toFixed(2)}s both` }}>
              {bow && <>
                <span style={{ position: "absolute", left: "50%", top: -rb * 1.4, width: rb * 2.2, height: rb * 1.6, marginLeft: -rb * 2.2, borderRadius: "50% 50% 10% 50%",
                  border: `${Math.max(2, rb * 0.5)}px solid ${g.col[1]}`, transform: "rotate(-20deg)" }}/>
                <span style={{ position: "absolute", left: "50%", top: -rb * 1.4, width: rb * 2.2, height: rb * 1.6, borderRadius: "50% 50% 50% 10%",
                  border: `${Math.max(2, rb * 0.5)}px solid ${g.col[1]}`, transform: "rotate(20deg)" }}/>
              </>}
            </div>
          </div>
        );
      })}
      {ph === 0 && <Pill key="a">🎄 Il neige sur l'atelier… Regarde bien le ciel.</Pill>}
      {ph === 1 && <Pill key="b">🦌 Le traîneau passe ! Rodolphe éclaire la route.</Pill>}
      {ph === 2 && <Pill key="c">🎁 Livraison express : toute la page est emballée !</Pill>}
      {ph === 3 && <Pill key="d">On déballe… Tout est imprimé en 3D, évidemment.</Pill>}
      {ph >= 4 && <Pill key="e" fade>Joyeux Noël ! (Pas de ticket de caisse, désolé.)</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 17. Vendredi 13 : chat noir, echelle, miroir qui se fend, la page tremble
// ════════════════════════════════════════════════════════════════════════════
const V13_CSS = wordCss("vendredi-13") + `
@keyframes pk-vendredi-13-dim { 0% { opacity: 0 } 8%, 90% { opacity: 1 } 100% { opacity: 0 } }
@keyframes pk-vendredi-13-walk { 0% { transform: translateX(calc(100vw + 20px)) } 42% { transform: translateX(calc(50vw - 50px)) } 56% { transform: translateX(calc(50vw - 50px)) } 100% { transform: translateX(-140px) } }
@keyframes pk-vendredi-13-leg { 0%, 100% { transform: rotate(-22deg) } 50% { transform: rotate(22deg) } }
@keyframes pk-vendredi-13-tail { 0%, 100% { transform: rotate(-8deg) } 50% { transform: rotate(12deg) } }
@keyframes pk-vendredi-13-eyes { 0%, 92%, 100% { transform: scaleY(1) } 96% { transform: scaleY(.1) } }
@keyframes pk-vendredi-13-ladder { 0% { transform: rotate(80deg); opacity: 0 } 20% { opacity: 1 } 70% { transform: rotate(10deg) } 85% { transform: rotate(15deg) } 100% { transform: rotate(13deg); opacity: 1 } }
@keyframes pk-vendredi-13-mirror { 0% { transform: translate(-50%, -50%) scale(.3); opacity: 0 } 100% { transform: translate(-50%, -50%) scale(1); opacity: 1 } }
@keyframes pk-vendredi-13-shine { from { transform: translateX(-120%) skewX(-20deg) } to { transform: translateX(220%) skewX(-20deg) } }
@keyframes pk-vendredi-13-crack { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes pk-vendredi-13-shard { 0% { transform: translate(0, 0) rotate(0deg); opacity: 1 } 100% { transform: translate(var(--dx), 70vh) rotate(var(--r)); opacity: 0 } }
@keyframes pk-vendredi-13-out { to { opacity: 0 } }
`;
function Cat({ w }) {
  const leg = (x, d) => (
    <g style={{ transformBox: "fill-box", transformOrigin: "50% 0%", animation: `pk-vendredi-13-leg .5s ease-in-out ${d}s infinite` }}>
      <rect x={x} y="34" width="5" height="18" rx="2.5" fill="#09090b"/>
    </g>
  );
  return (
    <svg width={w} height={w * 0.62} viewBox="0 0 96 60" style={{ display: "block", overflow: "visible" }}>
      {leg(24, 0)}{leg(32, -0.25)}{leg(62, -0.25)}{leg(70, 0)}
      <g style={{ transformBox: "fill-box", transformOrigin: "0% 100%", animation: "pk-vendredi-13-tail 1.4s ease-in-out infinite" }}>
        <path d="M78 30 C92 26 94 10 88 2 C86 12 84 20 76 24 Z" fill="#09090b"/>
      </g>
      <ellipse cx="50" cy="32" rx="30" ry="12" fill="#09090b"/>
      <circle cx="18" cy="22" r="12" fill="#09090b"/>
      <path d="M8 16 L8 2 L16 11 Z M22 11 L28 1 L29 15 Z" fill="#09090b"/>
      <g style={{ transformBox: "fill-box", transformOrigin: "50% 50%", animation: "pk-vendredi-13-eyes 2.4s ease-in-out infinite" }}>
        <ellipse cx="13" cy="21" rx="2.8" ry="3.2" fill="#facc15"/><ellipse cx="22" cy="21" rx="2.8" ry="3.2" fill="#facc15"/>
        <ellipse cx="13" cy="21" rx=".9" ry="2.6" fill="#09090b"/><ellipse cx="22" cy="21" rx=".9" ry="2.6" fill="#09090b"/>
      </g>
    </svg>
  );
}
function Ladder({ h }) {
  return (
    <svg width={h * 0.3} height={h} viewBox="0 0 60 200" style={{ display: "block", overflow: "visible", filter: "drop-shadow(3px 4px 3px rgba(0,0,0,.4))" }}>
      <rect x="4" y="0" width="7" height="200" rx="3" fill="#a16207"/><rect x="49" y="0" width="7" height="200" rx="3" fill="#a16207"/>
      {[18, 44, 70, 96, 122, 148, 174].map(y => <rect key={y} x="8" y={y} width="44" height="6" rx="2" fill="#ca8a04"/>)}
    </svg>
  );
}
const CRACKS = (() => {
  const out = [];
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 + rand(-0.2, 0.2);
    let x = 0, y = 0, d = "M0 0";
    for (let k = 0; k < 4; k++) { const r = 16 + k * 18, b = a + rand(-0.3, 0.3); x = Math.cos(b) * r; y = Math.sin(b) * r; d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; }
    out.push(d);
  }
  [14, 32].forEach(r => { let d = ""; for (let k = 0; k <= 12; k++) { const a = k / 12 * Math.PI * 2, rr = r + rand(-4, 4); d += `${k ? " L" : "M"}${(Math.cos(a) * rr).toFixed(1)} ${(Math.sin(a) * rr).toFixed(1)}`; } out.push(d); });
  return out;
})();
function Vendredi13({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const small = isNarrow();
  const W = vw(), H = vh();
  const mw = small ? 120 : 150, mh = mw * 1.3;
  const shards = useMemo(() => Array.from({ length: 7 }, () => ({ x: rand(-40, 40), y: rand(-50, 50), dx: px(rand(-80, 80)), r: `${rand(-300, 300).toFixed(0)}deg`, s: rand(10, 20), dl: rand(0, 0.5) })), []);
  useEffect(() => {
    const { ctl } = s;
    const at = atomsOf(ctl, 120);
    // CRAC : tout sursaute, puis la page reste nerveuse
    ctl.after(5200, () => at.forEach(o => {
      const fr = [];
      for (let k = 0; k <= 10; k++) { const a = amp(o.r, 9) * (1 - k / 10); fr.push({ transform: k === 0 || k === 10 ? "translate(0px,0px) rotate(0deg)" : `translate(${rand(-a, a).toFixed(1)}px,${rand(-a, a).toFixed(1)}px) rotate(${rand(-a / 3, a / 3).toFixed(1)}deg)` }); }
      ctl.anim(o.c, fr, { duration: 900 });
      const fr2 = [{ transform: "translate(0px,0px)" }];
      for (let k = 1; k < 6; k++) fr2.push({ transform: `translate(${rand(-1.2, 1.2).toFixed(1)}px,${rand(-1, 1).toFixed(1)}px)` });
      fr2.push({ transform: "translate(0px,0px)" });
      ctl.anim(o.c, fr2, { duration: 500, delay: 1000 + rand(0, 300), iterations: 4 });
    }));
    steps(ctl, setPh, [4000, 5200, 8600]);
    ctl.after(10800, () => { setPh(4); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const lh = Math.min(small ? 200 : 260, H * 0.38);
  return (
    <Layer s={s} css={V13_CSS}>
      <Veil bg="radial-gradient(ellipse at 50% 40%, rgba(15,23,42,.35), rgba(2,6,23,.7))" anim="pk-vendredi-13-dim 10.8s ease both"/>
      <div aria-hidden="true" style={{ position: "absolute", left: small ? 8 : 30, top: H - cornerBottom() - lh, transformOrigin: "50% 100%",
        animation: ph >= 3 ? "pk-vendredi-13-out .8s ease both" : "pk-vendredi-13-ladder 1.2s ease-out .5s both" }}>
        <Ladder h={lh}/>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, top: H - propBottom() - (small ? 48 : 60) + 6, animation: "pk-vendredi-13-walk 7.5s linear .4s both" }}>
        <Cat w={small ? 78 : 96}/>
      </div>
      {ph >= 1 && (
        <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "38%", width: mw, height: mh, animation: ph >= 3 ? "pk-vendredi-13-out .8s ease both" : "pk-vendredi-13-mirror .6s cubic-bezier(.2,1.3,.4,1) both" }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", padding: 8, background: "linear-gradient(135deg, #a16207, #fde68a, #92400e)", boxShadow: "0 10px 30px rgba(0,0,0,.5)" }}>
            <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden", background: "linear-gradient(160deg, #e2e8f0, #94a3b8 60%, #cbd5e1)" }}>
              <div style={{ position: "absolute", top: 0, bottom: 0, width: "30%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent)",
                animation: "pk-vendredi-13-shine 1.6s ease-in-out .3s infinite" }}/>
              {ph >= 2 && (
                <svg width="100%" height="100%" viewBox="-60 -78 120 156" style={{ position: "absolute", inset: 0 }}>
                  <g transform="translate(10 -16)">
                    {CRACKS.map((d, i) => <path key={i} d={d} pathLength="1" fill="none" stroke="#1e293b" strokeWidth="1.3" strokeDasharray="1 1"
                      style={{ strokeDashoffset: 1, animation: `pk-vendredi-13-crack .25s ease-out ${(i * 0.02).toFixed(2)}s both` }}/>)}
                  </g>
                </svg>
              )}
            </div>
          </div>
          {ph >= 2 && shards.map((p, i) => (
            <span key={i} style={{ position: "absolute", left: mw / 2 + p.x, top: mh / 2 + p.y, width: p.s, height: p.s, background: "linear-gradient(135deg, #f1f5f9, #94a3b8)",
              clipPath: "polygon(50% 0, 100% 100%, 0 70%)", "--dx": p.dx, "--r": p.r, animation: `pk-vendredi-13-shard 1.4s ease-in ${(0.5 + p.dl).toFixed(2)}s both` }}/>
          ))}
        </div>
      )}
      {ph === 2 && <Word k="vendredi-13" x={W / 2} y={H * 0.38 - mh / 2 - 10} text="CRAC !" size={small ? 34 : 44} color="#f8fafc" edge="#0f172a" dur={1.2}/>}
      {ph === 0 && <Pill key="a">🐈 Un chat noir traverse l'atelier… et une échelle traîne par là.</Pill>}
      {ph === 1 && <Pill key="b">🪞 Un miroir ! Surtout, ne le fais pas tomber…</Pill>}
      {ph === 2 && <Pill key="c">Sept ans de buses bouchées ? Toute la page en tremble.</Pill>}
      {ph >= 3 && <Pill key="d" fade>Touche du bois… ou du PLA effet bois. Ouf, tout va bien.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 18. Changement d'heure : horloges folles, la page avance (ou recule) d'une heure
// ════════════════════════════════════════════════════════════════════════════
const CHH_CSS = wordCss("changement-heure") + `
@keyframes pk-changement-heure-pop { 0% { transform: scale(0) rotate(-40deg) } 70% { transform: scale(1.12) rotate(6deg) } 100% { transform: scale(1) rotate(0deg) } }
@keyframes pk-changement-heure-out { to { transform: scale(0); opacity: 0 } }
@keyframes pk-changement-heure-cw { to { transform: rotate(360deg) } }
@keyframes pk-changement-heure-ccw { to { transform: rotate(-360deg) } }
@keyframes pk-changement-heure-light { 0% { background: rgba(253,224,71,0) } 25% { background: rgba(251,146,60,.28) } 50% { background: rgba(15,23,42,.62) }
  75% { background: rgba(244,114,182,.24) } 100% { background: rgba(253,224,71,0) } }
@keyframes pk-changement-heure-panel { 0% { transform: translate(-50%, -50%) scale(.4); opacity: 0 } 8% { transform: translate(-50%, -50%) scale(1.05); opacity: 1 }
  12%, 88% { transform: translate(-50%, -50%) scale(1); opacity: 1 } 100% { transform: translate(-50%, -50%) scale(.8); opacity: 0 } }
@keyframes pk-changement-heure-flip { 0% { transform: rotateX(90deg) } 100% { transform: rotateX(0deg) } }
`;
function Clock({ s: size, speed, ccw }) {
  const sp = name => (ccw ? "pk-changement-heure-ccw" : "pk-changement-heure-cw") + ` ${name}s linear infinite`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 3px 5px rgba(0,0,0,.3))" }}>
      <circle cx="50" cy="50" r="46" fill="#fffbeb" stroke="#334155" strokeWidth="6"/>
      {Array.from({ length: 12 }, (_, i) => <path key={i} d="M50 9 L50 16" stroke="#334155" strokeWidth={i % 3 ? 2 : 4} transform={`rotate(${i * 30} 50 50)`}/>)}
      <g style={{ transformOrigin: "50px 50px", animation: sp((speed * 12).toFixed(2)) }}><path d="M50 50 L50 28" stroke="#0f172a" strokeWidth="6" strokeLinecap="round"/></g>
      <g style={{ transformOrigin: "50px 50px", animation: sp(speed.toFixed(2)) }}><path d="M50 50 L50 15" stroke="#dc2626" strokeWidth="3.5" strokeLinecap="round"/></g>
      <circle cx="50" cy="50" r="4" fill="#0f172a"/>
    </svg>
  );
}
function ChangementHeure({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState(0);
  const [time, setTime] = useState("");
  const avance = useMemo(() => new Date().getMonth() < 6, []);
  const small = isNarrow();
  const clocks = useMemo(() => {
    const W = vw(), H = vh() - propBottom() - 40, out = [];
    for (let i = 0; out.length < (small ? 8 : 13) && i < 200; i++) {
      const sz = rand(38, small ? 70 : 96), x = rand(4, W - sz - 4), y = rand(50, Math.max(60, H - sz));
      if (out.every(c => Math.hypot(c.x - x, c.y - y) > (c.sz + sz) * 0.55)) out.push({ x, y, sz, dl: rand(0.2, 1.6), sp: rand(0.5, 1.2) });
    }
    return out;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const { ctl } = s;
    const seq = avance ? ["01:57", "01:58", "01:59", "03:00"] : ["02:57", "02:58", "02:59", "02:00"];
    seq.forEach((t, i) => ctl.after(1300 + i * 650, () => setTime(t)));
    const at = atomsOf(ctl, 120);
    const dir = avance ? 1 : -1;
    at.forEach(o => {
      const d = amp(o.r, 70) * dir;
      ctl.anim(o.c, [
        { transform: "translateX(0px) skewX(0deg)", opacity: 1, easing: "cubic-bezier(.6,0,.3,1)" },
        { transform: `translateX(${d.toFixed(1)}px) skewX(${(-12 * dir).toFixed(0)}deg)`, opacity: 0.55, offset: 0.3 },
        { transform: `translateX(${d.toFixed(1)}px) skewX(0deg)`, opacity: 0.9, offset: 0.45 },
        { transform: `translateX(${d.toFixed(1)}px) skewX(0deg)`, opacity: 0.9, offset: 0.62, easing: "cubic-bezier(.6,0,.3,1)" },
        { transform: "translateX(0px) skewX(0deg)", opacity: 1 },
      ], { duration: 3800, delay: 3300 + (o.r.top / vh()) * 500 });
    });
    steps(ctl, setPh, [3250, 7600]);
    ctl.after(10600, () => { setPh(3); s.finish(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const out = ph >= 2;
  return (
    <Layer s={s} css={CHH_CSS}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, animation: "pk-changement-heure-light 7s ease-in-out 2.4s both" }}/>
      {clocks.map((c, i) => (
        <div key={i} aria-hidden="true" style={{ position: "absolute", left: c.x, top: c.y, animation: out ? "pk-changement-heure-out .5s ease-in both" : `pk-changement-heure-pop .5s cubic-bezier(.2,1.4,.4,1) ${c.dl.toFixed(2)}s both` }}>
          <Clock s={c.sz} speed={c.sp} ccw={!avance}/>
        </div>
      ))}
      {time && (
        <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "40%", padding: small ? "10px 18px" : "14px 26px", borderRadius: 16, background: "#0b1120",
          border: "2px solid #1e293b", boxShadow: "0 0 30px rgba(34,211,238,.35), 0 12px 30px rgba(0,0,0,.5)", animation: "pk-changement-heure-panel 8.6s ease both", perspective: 400 }}>
          <div key={time} style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontWeight: 800, fontSize: small ? 48 : 72, letterSpacing: ".06em",
            color: "#22d3ee", textShadow: "0 0 12px rgba(34,211,238,.9)", animation: "pk-changement-heure-flip .25s ease-out both" }}>{time}</div>
        </div>
      )}
      {ph === 1 && <Word k="changement-heure" x={vw() / 2} y={vh() * 0.4 + (small ? 70 : 90)} text={avance ? "+1 h" : "−1 h"} size={small ? 34 : 46} color="#fde047" edge="#0f172a" dur={1.6}/>}
      {ph === 0 && <Pill key="a">⏰ Toutes les horloges s'affolent dans l'atelier…</Pill>}
      {ph === 1 && <Pill key="b">{avance ? "Cette nuit, à 2 h, il était déjà 3 h : on a avancé d'une heure !" : "Cette nuit, à 3 h, il était de nouveau 2 h : on a reculé d'une heure !"}</Pill>}
      {ph >= 2 && <Pill key="c" fade>{avance ? "Une heure de sommeil en moins… ton imprimante, elle, n'a rien senti." : "Une heure de plus : juste de quoi finir cette impression de 26 h."}</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 19. Anniversaire (de la premiere impression) : gateau, bougies a souffler
// (geste facultatif), cotillons, guirlande « Joyeux anniversaire »
// ════════════════════════════════════════════════════════════════════════════
const AN_CSS = driftCss("anniversaire") + wordCss("anniversaire") + `
@keyframes pk-anniversaire-cake { 0% { transform: translate(-50%, 140%) } 100% { transform: translate(-50%, 0) } }
@keyframes pk-anniversaire-cakeout { to { transform: translate(-50%, 140%) } }
@keyframes pk-anniversaire-flame { 0%, 100% { transform: scale(1, 1) rotate(-3deg) } 50% { transform: scale(.88, 1.12) rotate(3deg) } }
@keyframes pk-anniversaire-smoke { 0% { transform: translate(0, 0) scale(.4); opacity: 0 } 15% { opacity: .7 } 100% { transform: translate(var(--dx), -60px) scale(1.6); opacity: 0 } }
@keyframes pk-anniversaire-flag { 0% { transform: translateY(-120%) rotate(0deg) } 100% { transform: translateY(0) rotate(var(--r)) } }
@keyframes pk-anniversaire-swing { 0%, 100% { transform: rotate(-4deg) } 50% { transform: rotate(4deg) } }
@keyframes pk-anniversaire-popper { 0% { transform: translate(0, 0) rotate(0deg) scale(.3); opacity: 0 } 8% { opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--r)) scale(1); opacity: 0 } }
`;
const AN_TEXT = "JOYEUX ANNIVERSAIRE";
function Anniversaire({ done }) {
  const s = useStage4(done);
  const [ph, setPh] = useState("play"); // play, party, end
  const [out, setOut] = useState([]);
  const [auto, setAuto] = useState(false);
  const [fx, addFx] = useFx(s);
  const phRef = useRef("play");
  const outRef = useRef([]);
  const small = isNarrow();
  const years = useMemo(() => { const n = Number(window.__bnAnniv); return Number.isFinite(n) && n >= 1 && n <= 99 ? Math.floor(n) : 0; }, []);
  const nC = years >= 1 && years <= 9 ? years : 5;
  const cw = small ? 190 : 250;
  const cakeTop = vh() - propBottom() - cw * 0.62;
  const conf = useMemo(() => makeDrift(small ? 60 : 100, { t0: 0, t1: 3, d: [3, 5], size: [10, 18] }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const poppers = useMemo(() => [0, 1].flatMap(side => Array.from({ length: 26 }, (_, i) => ({
    side, dx: (side ? -1 : 1) * rand(60, vw() * 0.5), dy: -rand(120, vh() * 0.55), r: `${rand(-720, 720).toFixed(0)}deg`, c: FILAMENTS[i % 8], dl: rand(0, 0.25), w: rand(6, 12), round: i % 3 === 0 }))), []);
  const letters = useMemo(() => AN_TEXT.split(""), []);
  const party = () => {
    const { ctl } = s;
    if (phRef.current !== "play") return;
    phRef.current = "party";
    setPh("party");
    atomsOf(ctl, 120).forEach((o, i) => {
      const sg = i % 2 ? 1 : -1, h = amp(o.r, 22);
      ctl.anim(o.c, [
        { transform: "translateY(0) rotate(0deg) scale(1)" },
        { transform: `translateY(${(-h).toFixed(1)}px) rotate(${(6 * sg).toFixed(1)}deg) scale(1.06)`, offset: 0.3 },
        { transform: "translateY(0) rotate(0deg) scale(1)", offset: 0.55 },
        { transform: `translateY(${(-h * 0.5).toFixed(1)}px) rotate(${(-5 * sg).toFixed(1)}deg) scale(1.03)`, offset: 0.78 },
        { transform: "translateY(0) rotate(0deg) scale(1)" },
      ], { duration: 900, delay: 200 + rand(0, 500), iterations: 4, easing: "ease-in-out" });
    });
    ctl.after(5600, () => { phRef.current = "end"; setPh("end"); s.finish(); });
  };
  const blow = i => {
    if (phRef.current !== "play" || outRef.current.includes(i)) return;
    outRef.current = [...outRef.current, i];
    setOut(outRef.current);
    if (outRef.current.length >= nC) s.ctl.after(500, party);
  };
  useEffect(() => {
    const { ctl } = s;
    ctl.after(10000, () => {
      if (phRef.current !== "play") return;
      setAuto(true);
      addFx({ text: "Ffffff…", x: vw() / 2, y: cakeTop - 40, size: 28, color: "#e0f2fe", edge: "#0c4a6e" }, 1400);
      for (let i = 0; i < nC; i++) ctl.after(150 + i * 90, () => blow(i));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const candleX = i => 30 + (i + 0.5) * 140 / nC;
  return (
    <Layer s={s} css={AN_CSS}>
      <Veil bg="radial-gradient(ellipse at 50% 70%, rgba(250,204,21,.18), rgba(15,23,42,.42))" anim={ph === "end" ? "pk-kit-fade .9s ease both" : "pk-kit-fadein .8s ease both"}/>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: small ? 8 : 14, display: "flex", justifyContent: "center", flexWrap: "wrap",
        gap: small ? 2 : 4, padding: "0 10px", animation: ph === "end" ? "pk-kit-fade .8s ease both" : "none" }}>
        {letters.map((ch, i) => (
          <div key={i} style={{ "--r": `${((i % 2 ? 1 : -1) * rand(2, 6)).toFixed(1)}deg`, animation: `pk-anniversaire-flag .5s cubic-bezier(.2,1.4,.4,1) ${(0.4 + i * 0.05).toFixed(2)}s both` }}>
            {ch === " " ? <span style={{ display: "block", width: small ? 8 : 14 }}/> : (
              <div style={{ transformOrigin: "50% 0%", animation: `pk-anniversaire-swing ${(1.4 + (i % 4) * 0.2).toFixed(1)}s ease-in-out infinite` }}>
                <div style={{ width: small ? 17 : 26, height: small ? 24 : 34, clipPath: "polygon(0 0, 100% 0, 100% 72%, 50% 100%, 0 72%)",
                  background: FILAMENTS[i % 8], color: "#fff", fontWeight: 900, fontSize: small ? 11 : 15, textAlign: "center", paddingTop: small ? 3 : 5,
                  textShadow: "0 1px 0 rgba(0,0,0,.35)" }}>{ch}</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: "50%", top: cakeTop, width: cw, animation: ph === "end" ? "pk-anniversaire-cakeout .8s ease-in .6s both" : "pk-anniversaire-cake .8s cubic-bezier(.2,1.2,.4,1) both" }}>
        <svg width={cw} height={cw * 0.62} viewBox="0 0 200 124" style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 8px 14px rgba(0,0,0,.35))" }}>
          <ellipse cx="100" cy="118" rx="96" ry="6" fill="#cbd5e1"/>
          <rect x="22" y="70" width="156" height="46" rx="8" fill="#f472b6"/>
          <path d="M22 80 C34 92 46 76 58 88 C70 98 82 78 94 90 C106 100 118 78 130 90 C142 100 154 78 166 90 C172 94 176 88 178 84 L178 76 L22 76 Z" fill="#fdf2f8"/>
          <rect x="34" y="40" width="132" height="36" rx="8" fill="#a855f7"/>
          <path d="M34 48 C44 58 54 44 64 54 C74 62 84 46 94 56 C104 64 114 46 124 56 C134 64 144 46 154 56 C160 60 164 54 166 50 L166 44 L34 44 Z" fill="#fdf2f8"/>
          {[46, 70, 96, 122, 148].map((x, i) => <circle key={x} cx={x} cy={98 + (i % 2) * 6} r="3" fill={FILAMENTS[i]}/>)}
          {Array.from({ length: nC }, (_, i) => (
            <g key={i}>
              <rect x={candleX(i) - 3.5} y="14" width="7" height="28" rx="2" fill={["#38bdf8", "#facc15", "#4ade80", "#fb7185", "#c084fc"][i % 5]}/>
              <path d={`M${candleX(i) - 3.5} 20 L${candleX(i) + 3.5} 16 M${candleX(i) - 3.5} 28 L${candleX(i) + 3.5} 24 M${candleX(i) - 3.5} 36 L${candleX(i) + 3.5} 32`} stroke="rgba(255,255,255,.7)" strokeWidth="1.5"/>
              <path d={`M${candleX(i)} 14 L${candleX(i)} 10`} stroke="#1f2937" strokeWidth="1.2"/>
            </g>
          ))}
        </svg>
        {Array.from({ length: nC }, (_, i) => {
          const x = candleX(i) / 200 * cw, y = 10 / 124 * cw * 0.62, isOut = out.includes(i);
          return (
            <button key={i} type="button" aria-label="Bougie" onPointerDown={e => { e.stopPropagation(); blow(i); }}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") blow(i); }}
              style={{ position: "absolute", left: x - 20, top: y - 44, width: 40, height: 56, padding: 0, border: "none", background: "transparent",
                cursor: "pointer", pointerEvents: !isOut && ph === "play" ? "auto" : "none", touchAction: "manipulation" }}>
              {!isOut ? (
                <span style={{ position: "absolute", left: 13, top: 22, width: 14, height: 22, transformOrigin: "50% 100%", animation: `pk-anniversaire-flame ${(0.3 + i * 0.03).toFixed(2)}s ease-in-out infinite`,
                  borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%", background: "radial-gradient(ellipse at 50% 70%, #fff7ae, #fbbf24 45%, #f97316 80%)",
                  boxShadow: "0 0 14px 4px rgba(251,191,36,.6)" }}/>
              ) : [0, 1, 2].map(k => (
                <span key={k} style={{ position: "absolute", left: 16, top: 34, width: 8, height: 8, borderRadius: "50%", background: "rgba(203,213,225,.85)",
                  "--dx": px((k - 1) * 10), animation: `pk-anniversaire-smoke 1.2s ease-out ${k * 0.15}s both` }}/>
              ))}
            </button>
          );
        })}
      </div>
      {ph !== "play" && <Drift k="anniversaire" items={conf} render={confetto}/>}
      {ph !== "play" && poppers.map((p, i) => (
        <span key={i} aria-hidden="true" style={{ position: "absolute", left: p.side ? vw() - 10 : 10, top: vh() - cornerBottom(), width: p.w, height: p.round ? p.w : p.w * 0.4,
          borderRadius: p.round ? "50%" : 2, background: p.c, "--dx": px(p.dx), "--dy": px(p.dy), "--r": p.r, animation: `pk-anniversaire-popper 1.6s cubic-bezier(.1,.7,.3,1) ${p.dl.toFixed(2)}s both` }}/>
      ))}
      <FxLayer k="anniversaire" fx={fx}/>
      {ph === "play" && !out.length && <Pill key="a">🎂 C'est ton anniversaire d'impression{years ? ` : ${years} an${years > 1 ? "s" : ""} déjà` : ""} ! Souffle les bougies…</Pill>}
      {ph === "play" && out.length > 0 && <Pill key={"o" + out.length}>Encore {nC - out.length} bougie{nC - out.length > 1 ? "s" : ""}… Prends ton souffle !</Pill>}
      {ph === "party" && <Pill key="p">{auto ? "Un courant d'air les a soufflées pour toi… Joyeux anniversaire !" : "Bravo ! Fais un vœu (une buse qui ne bouche jamais ?)."}</Pill>}
      {ph === "end" && <Pill key="e" fade>Joyeux anniversaire ! Que la première couche soit avec toi.</Pill>}
    </Layer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Export
// ════════════════════════════════════════════════════════════════════════════
export const PRANKS = {
  "nouvel-an": { label: "Nouvel an", Effect: softly(NouvelAn, { emoji: "🎆", text: "Bonne année ! Que tes premières couches accrochent du premier coup.", tint: tint("rgba(250,204,21,.25)") }) },
  "galette": { label: "Galette des rois", Effect: softly(Galette, { emoji: "👑", text: "La fève était dans ta part. Vive le roi de l'atelier !", tint: tint("rgba(245,158,11,.25)") }) },
  "chandeleur": { label: "Chandeleur", Effect: softly(Chandeleur, { emoji: "🥞", text: "Une crêpe a sauté au-dessus de l'atelier.", tint: tint("rgba(245,196,107,.28)") }) },
  "saint-valentin": { label: "Saint-Valentin", Effect: softly(SaintValentin, { emoji: "💘", text: "Ton atelier a le cœur qui bat.", tint: tint("rgba(244,114,182,.25)") }) },
  "mardi-gras": { label: "Mardi gras", Effect: softly(MardiGras, { emoji: "🎭", text: "Carnaval dans l'atelier (version calme).", tint: tint("rgba(168,85,247,.25)") }) },
  "poisson-avril": { label: "Poisson d'avril", Effect: softly(PoissonAvril, { emoji: "🐟", text: "Poisson d'avril ! Il était en papier.", tint: tint("rgba(56,189,248,.25)") }) },
  "paques": { label: "Pâques", Effect: softly(Paques, { emoji: "🥚", text: "Les cloches sont passées : chocolat pour tout le monde.", tint: tint("rgba(250,204,21,.22)") }) },
  "muguet": { label: "Muguet", Effect: softly(Muguet, { emoji: "🌿", text: "Un brin de muguet pour toi. Porte-bonheur !", tint: tint("rgba(34,197,94,.22)") }) },
  "fete-meres": { label: "Fête des mères", Effect: softly(FeteMeres, { emoji: "💐", text: "Bonne fête maman !", tint: tint("rgba(244,114,182,.22)") }) },
  "fete-peres": { label: "Fête des pères", Effect: softly(FetePeres, { emoji: "👔", text: "Bonne fête papa ! Cravate et barbecue.", tint: tint("rgba(29,78,216,.2)") }) },
  "fete-musique": { label: "Fête de la musique", Effect: softly(FeteMusique, { emoji: "🎶", text: "L'atelier joue sa partition.", tint: tint("rgba(168,85,247,.22)") }) },
  "quatorze-juillet": { label: "14 Juillet", Effect: softly(QuatorzeJuillet, { emoji: "🎆", text: "Bleu, blanc, rouge au-dessus de l'atelier.", tint: tint("rgba(37,99,235,.22)") }) },
  "halloween": { label: "Halloween", Effect: softly(Halloween, { emoji: "🎃", text: "Bouh ! (Tout doux, c'est juste une citrouille.)", tint: tint("rgba(234,88,12,.25)") }) },
  "beaujolais": { label: "Beaujolais nouveau", Effect: softly(Beaujolais, { emoji: "🍇", text: "Le Beaujolais nouveau est arrivé !", tint: tint("rgba(126,34,206,.22)") }) },
  "gta-vi": { label: "Course-poursuite", Effect: softly(GtaVi, { emoji: "🌴", text: "Jour de sortie de GTA VI : mission réussie, + respect.", tint: tint("rgba(236,72,153,.25)") }) },
  "noel": { label: "Noël", Effect: softly(Noel, { emoji: "🎄", text: "Joyeux Noël ! Le traîneau est passé.", tint: tint("rgba(220,38,38,.2)") }) },
  "vendredi-13": { label: "Vendredi 13", Effect: softly(Vendredi13, { emoji: "🐈", text: "Un chat noir est passé… touche du bois.", tint: tint("rgba(15,23,42,.35)") }) },
  "changement-heure": { label: "Changement d'heure", Effect: softly(ChangementHeure, { emoji: "⏰", text: "Une heure de plus, ou de moins ?", tint: tint("rgba(34,211,238,.22)") }) },
  "anniversaire": { label: "Anniversaire", Effect: softly(Anniversaire, { emoji: "🎂", text: "Joyeux anniversaire d'impression !", tint: tint("rgba(250,204,21,.25)") }) },
};
