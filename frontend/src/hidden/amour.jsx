import React, { useState, useEffect, useRef, useMemo } from "react";
import { Stage, Title, useWin, useLoop, useKeys, Btn, rand, pick } from "./kit";

// Lot « amour » des pages cachees (23/10/2026) : neuf scenes tendres, chacune
// un petit jeu ou une enigme. Le secret ne tombe qu'a la reussite. Chaque page
// garde ses keyframes dans son propre <style>, prefixees par son slug.

const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const HAND = "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive";

/** Le coeur, dans une boite 100 x 90 (centre vers 50,45). */
const HEART_D = "M50 84 C20 62 3 45 3 26 C3 12 14 2 28 2 C38 2 46 8 50 17 C54 8 62 2 72 2 C86 2 97 12 97 26 C97 45 80 62 50 84Z";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Consigne discrete en bas de scene, masquee une fois gagne. */
function Hint({ children, won, color = "rgba(255,255,255,.72)", style }) {
  if (won) return null;
  return (
    <div style={{ position:"absolute", left:"50%", bottom:12, transform:"translateX(-50%)", zIndex:15,
      width:"max-content", maxWidth:"calc(100% - 32px)", textAlign:"center", fontSize:12.5, lineHeight:1.35,
      padding:"6px 12px", borderRadius:999, background:"rgba(0,0,0,.3)", color, fontFamily:SANS,
      backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)", pointerEvents:"none", ...style }}>
      {children}
    </div>
  );
}

/** Minuteries nettoyees au demontage : later(fn, ms). */
function useTimers() {
  const ids = useRef([]);
  useEffect(() => () => { ids.current.forEach(clearTimeout); ids.current = []; }, []);
  return useMemo(() => (fn, ms) => { const id = setTimeout(fn, ms); ids.current.push(id); return id; }, []);
}

/** Touche pressee (hors champ de saisie) ; fn(e) recoit l'evenement. */
function useKeyDown(fn, up) {
  const r = useRef(fn), u = useRef(up);
  r.current = fn; u.current = up;
  useEffect(() => {
    const typing = e => { const t = e.target; return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable); };
    const d = e => { if (!typing(e)) r.current(e); };
    const k = e => { if (!typing(e) && u.current) u.current(e); };
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", k);
    return () => { window.removeEventListener("keydown", d); window.removeEventListener("keyup", k); };
  }, []);
}

/** Canvas plein cadre (taille du conteneur, dpr) : rend une ref { w, h }. */
function useFullCanvas(box, cv) {
  const size = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current, c = cv.current;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: r.width, h: r.height };
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [box, cv]);
  return size;
}

let HEART_P2D = null;
function drawHeart(ctx, x, y, r, color, alpha = 1) {
  if (!HEART_P2D) HEART_P2D = new Path2D(HEART_D);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y); ctx.scale(r / 48, r / 48); ctx.translate(-50, -44);
  ctx.fillStyle = color; ctx.fill(HEART_P2D);
  ctx.globalAlpha = alpha * 0.35; ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.ellipse(28, 22, 11, 7, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Petits coeurs qui montent en fond (decor). */
function RisingHearts({ n = 10, color = "rgba(255,255,255,.18)", prefix }) {
  const hs = useRef(Array.from({ length: n }, () => ({ l: rand(2, 96), s: rand(10, 26), d: rand(9, 18), dl: -rand(0, 18) }))).current;
  return (
    <div aria-hidden="true" style={{ position:"absolute", inset:0, overflow:"hidden", pointerEvents:"none" }}>
      <style>{`@keyframes ${prefix}-rise { from { transform:translateY(0) rotate(-8deg); opacity:0 } 12% { opacity:1 } to { transform:translateY(-120vh) rotate(10deg); opacity:0 } }`}</style>
      {hs.map((h, i) => (
        <svg key={i} viewBox="0 0 100 90" style={{ position:"absolute", left:`${h.l}%`, bottom:-40, width:h.s,
          animation:`${prefix}-rise ${h.d}s linear ${h.dl}s infinite` }}><path d={HEART_D} fill={color}/></svg>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- coeur */

const CO_BEAT = 860, CO_TOL = 170, CO_GOAL = 10;

function Coeur() {
  const [won, win] = useWin("coeur");
  const [streak, setStreak] = useState(0);
  const [msg, setMsg] = useState({ text: "", ok: true, n: 0 });
  const t0 = useRef(performance.now() + 900);
  const s = useRef({ streak: 0, lastK: -99 });
  const heart = useRef(null), ring = useRef(null), glow = useRef(null);
  const say = (text, ok) => setMsg(m => ({ text, ok, n: m.n + 1 }));

  useLoop((dt, now) => {
    const x = (now - t0.current) / CO_BEAT;
    const ph = ((x % 1) + 1) % 1;
    const sc = 1 + 0.13 * Math.exp(-ph * 11) + (ph > 0.26 ? 0.06 * Math.exp(-(ph - 0.26) * 13) : 0);
    if (heart.current) heart.current.style.transform = `scale(${sc})`;
    if (glow.current) glow.current.style.opacity = String(0.35 + 0.65 * Math.exp(-ph * 6));
    if (ring.current) {
      ring.current.style.transform = `scale(${1 + (1 - ph) * 0.45})`;
      ring.current.style.opacity = String(0.1 + ph * 0.75);
    }
    const st = s.current;
    if (!won && st.streak > 0 && x - st.lastK > 1.5) {
      st.streak = 0; setStreak(0); say("Tu as laissé passer un battement…", false);
    }
  });

  const tap = () => {
    if (won) return;
    const x = (performance.now() - t0.current) / CO_BEAT;
    const k = Math.round(x), d = (x - k) * CO_BEAT;
    const st = s.current;
    if (Math.abs(d) <= CO_TOL) {
      if (k === st.lastK) return;
      st.streak = st.streak > 0 && k === st.lastK + 1 ? st.streak + 1 : 1;
      st.lastK = k;
      setStreak(st.streak);
      say(pick(["Juste !", "Parfait", "En rythme", "Boum-boum", "Pile !"]), true);
      if (st.streak >= CO_GOAL) win();
    } else {
      st.streak = 0; setStreak(0);
      say(d < 0 ? "Un peu tôt…" : "Un peu tard…", false);
    }
  };
  useKeyDown(e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); tap(); } });

  const size = "min(62vw, 270px, 38dvh)";
  return (
    <Stage won={won} wonText="Vos cœurs battent ensemble" bg="radial-gradient(circle at 50% 45%, #9f1239, #4c0519 70%, #2a0310)" style={{ padding:0 }}>
      <style>{`
        @keyframes coeur-pop { 0% { transform:scale(.6); opacity:0 } 40% { transform:scale(1.15); opacity:1 } 100% { transform:scale(1); opacity:1 } }
      `}</style>
      <RisingHearts n={9} color="rgba(251,113,133,.16)" prefix="coeur"/>
      <div onPointerDown={tap} style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center",
        justifyContent:"center", gap:18, cursor:"pointer", touchAction:"manipulation", padding:"20px 16px 60px" }}>
        <Title sub="Tape en même temps que lui. Dix fois d'affilée.">Cœur battant</Title>
        <div style={{ position:"relative", width:size, height:`calc(${size} * .9)` }}>
          <div ref={glow} aria-hidden="true" style={{ position:"absolute", inset:"-30%", borderRadius:"50%",
            background:"radial-gradient(circle, rgba(251,113,133,.55), rgba(251,113,133,0) 62%)" }}/>
          <svg ref={ring} aria-hidden="true" viewBox="0 0 100 90" style={{ position:"absolute", inset:0, width:"100%", height:"100%", overflow:"visible" }}>
            <path d={HEART_D} fill="none" stroke="#fecdd3" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/>
          </svg>
          <svg ref={heart} viewBox="0 0 100 90" style={{ position:"absolute", inset:0, width:"100%", height:"100%", overflow:"visible",
            filter:"drop-shadow(0 10px 22px rgba(0,0,0,.45))" }}>
            <defs>
              <linearGradient id="coeur-g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fb7185"/><stop offset="1" stopColor="#be123c"/>
              </linearGradient>
              <clipPath id="coeur-clip"><path d={HEART_D}/></clipPath>
            </defs>
            <path d={HEART_D} fill="url(#coeur-g)"/>
            {/* les couches d'impression */}
            <g clipPath="url(#coeur-clip)">
              {Array.from({ length: 22 }, (_, i) => (
                <rect key={i} x="0" y={i * 4} width="100" height="0.9" fill="rgba(255,255,255,.13)"/>
              ))}
              <ellipse cx="29" cy="22" rx="12" ry="7" transform="rotate(-35 29 22)" fill="rgba(255,255,255,.32)"/>
            </g>
          </svg>
        </div>
        <div aria-live="polite" style={{ height:28, fontFamily:SANS, fontWeight:800, fontSize:20 }}>
          {msg.text && <span key={msg.n} style={{ display:"inline-block", color: msg.ok ? "#fecdd3" : "#fda4af",
            opacity: msg.ok ? 1 : .8, animation:"coeur-pop .35s ease-out both" }}>{msg.text}</span>}
        </div>
        <div style={{ display:"flex", gap:5 }} aria-label={`${streak} battements sur ${CO_GOAL}`}>
          {Array.from({ length: CO_GOAL }, (_, i) => (
            <svg key={i} viewBox="0 0 100 90" width="22" style={{ transition:"transform .2s", transform: i < streak ? "scale(1.12)" : "scale(.9)" }}>
              <path d={HEART_D} fill={i < streak || won ? "#fb7185" : "rgba(255,255,255,.14)"}/>
            </svg>
          ))}
        </div>
      </div>
      <Hint won={won}>Touche l'écran (ou espace) quand l'anneau rejoint le cœur.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ cupidon */

const CU_GOAL = 10;
const CU_COLORS = ["#f43f5e", "#ec4899", "#f472b6", "#fb7185", "#e11d48", "#d946ef"];
const CU_MIN = -Math.PI + 0.14, CU_MAX = -0.14;

function Cupidon() {
  const [won, win] = useWin("cupidon");
  const [score, setScore] = useState(0);
  const box = useRef(null), cv = useRef(null);
  const size = useFullCanvas(box, cv);
  const keys = useKeys();
  const g = useRef({ hearts: [], arrows: [], bits: [], ang: -Math.PI / 2, last: -1e9, score: 0, t: 0 });

  const bow = () => ({ x: size.current.w / 2, y: size.current.h - 92 });
  const shoot = () => {
    const s = g.current, now = performance.now();
    if (now - s.last < 300) return;
    s.last = now;
    const b = bow(), sp = 720;
    s.arrows.push({ x: b.x + Math.cos(s.ang) * 30, y: b.y + Math.sin(s.ang) * 30, vx: Math.cos(s.ang) * sp, vy: Math.sin(s.ang) * sp, a: s.ang });
  };
  const aim = e => {
    const r = cv.current.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top, b = bow();
    let a = Math.atan2(y - b.y, x - b.x);
    if (a > 0) a = x < b.x ? CU_MIN : CU_MAX;
    g.current.ang = clamp(a, CU_MIN, CU_MAX);
  };
  const down = e => { aim(e); shoot(); };
  useKeyDown(e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); shoot(); } });

  const newHeart = (w, h) => {
    const r = rand(18, 27);
    return { r, x: rand(r + 8, w - r - 8), by: rand(80, Math.max(150, h * 0.58)), vx: rand(22, 55) * (Math.random() < 0.5 ? -1 : 1),
      f: rand(1.1, 2), p: rand(0, 6), c: pick(CU_COLORS), born: g.current.t, y: 0 };
  };

  useLoop(dt => {
    const c = cv.current;
    const { w, h } = size.current;
    if (!c || !w) return;
    const ctx = c.getContext("2d");
    const s = g.current;
    s.t += dt;
    if (keys.current.has("ArrowLeft")) s.ang = Math.max(CU_MIN, s.ang - 1.8 * dt);
    if (keys.current.has("ArrowRight")) s.ang = Math.min(CU_MAX, s.ang + 1.8 * dt);
    while (s.hearts.length < 5) s.hearts.push(newHeart(w, h));
    for (const H of s.hearts) {
      H.x += H.vx * dt;
      if (H.x < H.r + 4 || H.x > w - H.r - 4) { H.vx *= -1; H.x = clamp(H.x, H.r + 4, w - H.r - 4); }
      H.y = H.by + Math.sin(s.t * H.f + H.p) * 16;
    }
    for (const A of s.arrows) {
      A.x += A.vx * dt; A.y += A.vy * dt;
      for (const H of s.hearts) {
        if (!H.dead && Math.hypot(A.x - H.x, A.y - H.y) < H.r * 1.05) {
          H.dead = true; A.dead = true;
          for (let k = 0; k < 9; k += 1) {
            const a = (k / 9) * Math.PI * 2 + rand(-0.2, 0.2), v = rand(70, 170);
            s.bits.push({ x: H.x, y: H.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: H.c, r: rand(5, 9) });
          }
          s.score += 1;
          setScore(s.score);
          if (s.score >= CU_GOAL) win();
          break;
        }
      }
      if (A.x < -40 || A.x > w + 40 || A.y < -40) A.dead = true;
    }
    s.hearts = s.hearts.filter(H => !H.dead);
    s.arrows = s.arrows.filter(A => !A.dead);
    for (const B of s.bits) { B.x += B.vx * dt; B.y += B.vy * dt; B.vy += 160 * dt; B.life -= dt * 1.2; }
    s.bits = s.bits.filter(B => B.life > 0);

    ctx.clearRect(0, 0, w, h);
    // coeurs
    for (const H of s.hearts) {
      const k = Math.min(1, (s.t - H.born) * 2.5);
      ctx.save(); ctx.shadowColor = H.c; ctx.shadowBlur = 14;
      drawHeart(ctx, H.x, H.y, H.r * k, H.c);
      ctx.restore();
    }
    for (const B of s.bits) drawHeart(ctx, B.x, B.y, B.r, B.c, Math.max(0, B.life));
    // fleches
    for (const A of s.arrows) drawArrow(ctx, A.x, A.y, A.a);
    // l'arc
    const b = bow();
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.setLineDash([3, 7]); ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(Math.cos(s.ang) * 50, Math.sin(s.ang) * 50); ctx.lineTo(Math.cos(s.ang) * 170, Math.sin(s.ang) * 170); ctx.stroke();
    ctx.setLineDash([]);
    ctx.rotate(s.ang);
    const ready = performance.now() - s.last > 300;
    const pull = ready ? -10 : 0;
    ctx.strokeStyle = "#fde68a"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(2, -35); ctx.lineTo(pull, 0); ctx.lineTo(2, 35); ctx.stroke();
    ctx.strokeStyle = "#b45309"; ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(-18, 0, 40, -1.05, 1.05); ctx.stroke();
    ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(-18, 0, 40, -1.05, 1.05); ctx.stroke();
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath(); ctx.arc(21, 0, 4.5, 0, Math.PI * 2); ctx.fill();
    if (ready) drawArrow(ctx, 40 + pull, 0, 0);
    ctx.restore();
  });

  return (
    <Stage won={won} wonText="Dix cœurs dans le mille" bg="linear-gradient(180deg, #fbcfe8 0%, #f9a8d4 35%, #c084fc 75%, #7c3aed 100%)" style={{ padding:0 }}>
      <style>{`@keyframes cupidon-cloud { from { transform:translateX(-30vw) } to { transform:translateX(120vw) } }`}</style>
      {[0, 1, 2].map(i => (
        <div key={i} aria-hidden="true" style={{ position:"absolute", top:`${18 + i * 22}%`, left:0, width:120 + i * 30, height:34 + i * 6,
          borderRadius:40, background:"rgba(255,255,255,.45)", filter:"blur(2px)", pointerEvents:"none",
          animation:`cupidon-cloud ${40 + i * 14}s linear ${-i * 13}s infinite` }}/>
      ))}
      <div ref={box} style={{ position:"absolute", inset:0 }}>
        <canvas ref={cv} onPointerDown={down} onPointerMove={aim}
          style={{ position:"absolute", inset:0, width:"100%", height:"100%", touchAction:"none", cursor:"crosshair" }}/>
      </div>
      <div style={{ position:"absolute", top:14, left:0, right:0, pointerEvents:"none", color:"#4c1d95" }}>
        <Title color="#831843" sub={`Cœurs touchés : ${Math.min(score, CU_GOAL)} / ${CU_GOAL}`} style={{ textShadow:"none" }}>Cupidon</Title>
      </div>
      <Hint won={won} style={{ bottom:8 }}>Touche un cœur pour tirer vers lui (ou ← → et espace).</Hint>
    </Stage>
  );
}

function drawArrow(ctx, x, y, a) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.strokeStyle = "#78350f"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-38, 0); ctx.lineTo(0, 0); ctx.stroke();
  ctx.fillStyle = "#e11d48";
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-2, 0); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#f9a8d4";
  ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(-40, -6); ctx.lineTo(-36, 0); ctx.lineTo(-40, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* ---------------------------------------------------------------- je-t-aime */

// Familles : les trois mauvaises propositions viennent de la meme famille
// (langues voisines ou meme ecriture), pour que ce soit vraiment dur.
const JT_LANGS = [
  ["Espagnol", "Te quiero", "rom"], ["Italien", "Ti amo", "rom"], ["Portugais", "Eu te amo", "rom"], ["Catalan", "T'estimo", "rom"],
  ["Roumain", "Te iubesc", "rom"], ["Galicien", "Quérote", "rom"],
  ["Anglais", "I love you", "ger"], ["Allemand", "Ich liebe dich", "ger"], ["Néerlandais", "Ik hou van jou", "ger"],
  ["Suédois", "Jag älskar dig", "ger"], ["Danois", "Jeg elsker dig", "ger"], ["Norvégien", "Jeg elsker deg", "ger"], ["Islandais", "Ég elska þig", "ger"],
  ["Russe", "Я тебя люблю", "cyr"], ["Ukrainien", "Я тебе кохаю", "cyr"], ["Bulgare", "Обичам те", "cyr"], ["Serbe", "Волим те", "cyr"],
  ["Macédonien", "Те сакам", "cyr"],
  ["Polonais", "Kocham cię", "sla"], ["Tchèque", "Miluji tě", "sla"], ["Slovaque", "Ľúbim ťa", "sla"], ["Croate", "Volim te", "sla"],
  ["Slovène", "Ljubim te", "sla"],
  ["Japonais", "愛してる", "asi"], ["Chinois", "我爱你", "asi"], ["Coréen", "사랑해", "asi"], ["Thaï", "ฉันรักคุณ", "asi"], ["Vietnamien", "Anh yêu em", "asi"],
  ["Arabe", "أحبك", "ori"], ["Persan", "دوستت دارم", "ori"], ["Ourdou", "میں تم سے محبت کرتا ہوں", "ori"], ["Hébreu", "אני אוהב אותך", "ori"],
  ["Hindi", "मैं तुमसे प्यार करता हूँ", "ori"], ["Bengali", "আমি তোমাকে ভালোবাসি", "ori"],
  ["Breton", "Da garout a ran", "cel"], ["Gallois", "Rwy'n dy garu di", "cel"], ["Irlandais", "Is breá liom thú", "cel"],
  ["Gaélique écossais", "Tha gaol agam ort", "cel"], ["Basque", "Maite zaitut", "cel"],
  ["Finnois", "Minä rakastan sinua", "eur"], ["Hongrois", "Szeretlek", "eur"], ["Estonien", "Ma armastan sind", "eur"],
  ["Turc", "Seni seviyorum", "eur"], ["Grec", "Σ' αγαπώ", "eur"],
];
const JT_GOAL = 12;

function JeTaime() {
  const [won, win] = useWin("je-t-aime");
  const later = useTimers();
  const [cur, setCur] = useState(() => Math.floor(Math.random() * JT_LANGS.length));
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [found, setFound] = useState([]);         // decor : les phrases reconnues de la serie
  const [answer, setAnswer] = useState(null);     // { pick, ok }
  const used = useRef(new Set());

  const options = useMemo(() => {
    const fam = JT_LANGS[cur][2];
    const same = shuffle(JT_LANGS.map((_, i) => i).filter(i => i !== cur && JT_LANGS[i][2] === fam)).slice(0, 3);
    return shuffle([cur, ...same]);
  }, [cur]);

  const next = () => {
    let n, guard = 0;
    do { n = Math.floor(Math.random() * JT_LANGS.length); guard += 1; } while ((n === cur || used.current.has(n)) && guard < 200);
    setAnswer(null);
    setCur(n);
  };
  const choose = i => {
    if (answer) return;
    if (i === cur) {
      const st = streak + 1;
      used.current.add(cur);
      setAnswer({ pick: i, ok: true });
      setStreak(st);
      setBest(b => Math.max(b, st));
      setFound(f => [...f, { i: cur, x: rand(3, 70), y: rand(4, 90), s: rand(0.85, 1.2), d: rand(0, 5) }]);
      if (st >= JT_GOAL) win();
      later(next, 750);
    } else {
      setAnswer({ pick: i, ok: false });
      if (!won) { setStreak(0); setFound([]); used.current = new Set(); }
      later(next, 1900);
    }
  };
  useKeyDown(e => { const k = Number(e.key); if (k >= 1 && k <= 4) choose(options[k - 1]); });

  const [, phrase] = JT_LANGS[cur];
  const fs = phrase.length > 20 ? "clamp(22px, 6.5vw, 34px)" : "clamp(28px, 9vw, 50px)";
  return (
    <Stage won={won} wonText="Polyglotte du cœur" bg="linear-gradient(160deg, #1e1b4b, #581c87 55%, #9d174d)" style={{ padding:0 }}>
      <style>{`
        @keyframes jtaime-in { from { transform:translateY(10px) scale(.96); opacity:0 } to { transform:none; opacity:1 } }
        @keyframes jtaime-shake { 0%,100% { transform:translateX(0) } 20%,60% { transform:translateX(-7px) } 40%,80% { transform:translateX(7px) } }
        @keyframes jtaime-drift { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-10px) } }
      `}</style>
      {found.map(f => (
        <div key={f.i} aria-hidden="true" dir="auto" style={{ position:"absolute", left:`${f.x}%`, top:`${f.y}%`, fontFamily:SERIF, fontStyle:"italic",
          fontSize:15 * f.s, color:"rgba(251,207,232,.22)", whiteSpace:"nowrap", pointerEvents:"none",
          animation:`jtaime-drift ${5 + f.d}s ease-in-out infinite` }}>{JT_LANGS[f.i][1]}</div>
      ))}
      <div style={{ position:"relative", zIndex:2, display:"flex", flexDirection:"column", alignItems:"center", gap:18, width:"100%",
        padding:"20px 16px 70px", boxSizing:"border-box" }}>
        <Title sub="Reconnais la langue. Douze d'affilée, sans te tromper une seule fois.">Je t'aime</Title>
        <div key={cur} dir="auto" style={{ minHeight:110, width:"min(100%, 440px)", display:"flex", alignItems:"center", justifyContent:"center",
          padding:"18px 16px", borderRadius:20, background:"rgba(255,255,255,.08)", border:"1px solid rgba(255,255,255,.18)",
          boxShadow:"0 14px 40px rgba(0,0,0,.35)", fontFamily:SERIF, fontSize:fs, textAlign:"center", lineHeight:1.25,
          animation:"jtaime-in .35s ease-out both", boxSizing:"border-box" }}>
          « {phrase} »
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, width:"min(100%, 440px)" }}>
          {options.map(i => {
            const isPick = answer && answer.pick === i;
            const isGood = answer && i === cur;
            const bg = isGood ? "#16a34a" : isPick ? "#dc2626" : "rgba(255,255,255,.12)";
            return (
              <button key={i} onClick={() => choose(i)} style={{ padding:"14px 10px", borderRadius:14, border:"1px solid rgba(255,255,255,.22)",
                background:bg, color:"#fff", fontFamily:SANS, fontWeight:800, fontSize:16, cursor:"pointer", transition:"background .2s",
                animation: isPick && !answer.ok ? "jtaime-shake .4s" : "none" }}>{JT_LANGS[i][0]}</button>
            );
          })}
        </div>
        <div style={{ fontFamily:SANS, fontSize:14, textAlign:"center", minHeight:40 }}>
          <div style={{ display:"flex", gap:4, justifyContent:"center", marginBottom:6 }}>
            {Array.from({ length: JT_GOAL }, (_, i) => (
              <span key={i} style={{ width:14, height:6, borderRadius:3, background: i < streak || won ? "#f9a8d4" : "rgba(255,255,255,.18)" }}/>
            ))}
          </div>
          {answer && !answer.ok
            ? <span style={{ color:"#fecaca" }}>Raté : c'était du {JT_LANGS[cur][0].toLowerCase()}. La série repart de zéro.</span>
            : <span style={{ opacity:.8 }}>Série : {streak} / {JT_GOAL}{best > 0 ? ` · record ${best}` : ""}</span>}
        </div>
      </div>
      <Hint won={won}>Une seule erreur et tout recommence. Courage !</Hint>
    </Stage>
  );
}

/* -------------------------------------------------------------- rendez-vous */

const RV_C = 7, RV_R = 9, RV_GOAL = RV_C * RV_R - 1;
const RV_DIRS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const RV_OPP = { n: "s", s: "n", e: "w", w: "e" };

function makeMaze(C, R) {
  const cells = Array.from({ length: C * R }, () => ({ n: true, e: true, s: true, w: true }));
  const seen = new Array(C * R).fill(false);
  const stack = [0];
  seen[0] = true;
  while (stack.length) {
    const cur = stack[stack.length - 1], x = cur % C, y = Math.floor(cur / C);
    const nb = [];
    if (y > 0 && !seen[cur - C]) nb.push(["n", cur - C]);
    if (x < C - 1 && !seen[cur + 1]) nb.push(["e", cur + 1]);
    if (y < R - 1 && !seen[cur + C]) nb.push(["s", cur + C]);
    if (x > 0 && !seen[cur - 1]) nb.push(["w", cur - 1]);
    if (!nb.length) { stack.pop(); continue; }
    const [d, nx] = pick(nb);
    cells[cur][d] = false; cells[nx][RV_OPP[d]] = false; seen[nx] = true; stack.push(nx);
  }
  return cells;
}

/** Un pas dans la direction d (le fil se rembobine si on revient en arriere). */
function rvMove(maze, t, d) {
  const p = t[t.length - 1];
  if (p === RV_GOAL || maze[p][d]) return t;
  const [dx, dy] = RV_DIRS[d];
  const np = p + dx + dy * RV_C;
  if (t.length > 1 && t[t.length - 2] === np) return t.slice(0, -1);
  return [...t, np];
}

/** Glisse le long du couloir jusqu'au prochain carrefour. */
function rvSlide(maze, t, d) {
  let cur = t, dir = d;
  for (let i = 0; i < 60; i += 1) {
    const nt = rvMove(maze, cur, dir);
    if (nt === cur) break;
    cur = nt;
    const p = cur[cur.length - 1];
    if (p === RV_GOAL) break;
    const exits = Object.keys(RV_DIRS).filter(k => !maze[p][k] && k !== RV_OPP[dir]);
    if (exits.length !== 1) break;
    dir = exits[0];
  }
  return cur;
}

function RendezVous() {
  const [won, win] = useWin("rendez-vous");
  const [maze, setMaze] = useState(() => makeMaze(RV_C, RV_R));
  const tr = useRef([0]);
  const [, setV] = useState(0);
  const g = useRef({ on: false, sx: 0, sy: 0, moved: false });
  const svg = useRef(null);
  const commit = t => {
    if (t === tr.current) return;
    tr.current = t; setV(v => v + 1);
    if (t[t.length - 1] === RV_GOAL) win();
  };
  const trail = tr.current, pos = trail[trail.length - 1], here = pos === RV_GOAL;

  const cellAt = e => {
    const r = svg.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * (RV_C * 10 + 4) - 2, y = ((e.clientY - r.top) / r.height) * (RV_R * 10 + 4) - 2;
    if (x < 0 || y < 0 || x >= RV_C * 10 || y >= RV_R * 10) return -1;
    return Math.floor(x / 10) + Math.floor(y / 10) * RV_C;
  };
  const down = e => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pas de capture */ }
    g.current = { on: true, sx: e.clientX, sy: e.clientY, moved: false };
  };
  const move = e => {
    if (!g.current.on) return;
    const c = cellAt(e);
    if (c < 0) return;
    let t = tr.current;
    for (let k = 0; k < 4; k += 1) {
      const p = t[t.length - 1];
      if (p === c) break;
      const px = p % RV_C, py = Math.floor(p / RV_C), cx = c % RV_C, cy = Math.floor(c / RV_C);
      const d = Math.abs(cx - px) >= Math.abs(cy - py) ? (cx > px ? "e" : "w") : (cy > py ? "s" : "n");
      const nt = rvMove(maze, t, d);
      if (nt === t) break;
      t = nt;
    }
    if (t !== tr.current) { g.current.moved = true; commit(t); }
  };
  const up = e => {
    const s = g.current;
    if (!s.on) return;
    s.on = false;
    const dx = e.clientX - s.sx, dy = e.clientY - s.sy;
    if (!s.moved && Math.hypot(dx, dy) > 24) {
      const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : (dy > 0 ? "s" : "n");
      commit(rvSlide(maze, tr.current, d));
    }
  };
  useKeyDown(e => {
    const d = { ArrowUp: "n", ArrowDown: "s", ArrowLeft: "w", ArrowRight: "e", z: "n", s: "s", q: "w", d: "e", w: "n", a: "w" }[e.key];
    if (!d) return;
    e.preventDefault();
    commit(rvMove(maze, tr.current, d));
  });
  const again = () => { setMaze(makeMaze(RV_C, RV_R)); tr.current = [0]; setV(v => v + 1); };

  const cx = i => (i % RV_C) * 10 + 5, cy = i => Math.floor(i / RV_C) * 10 + 5;
  const walls = [];
  maze.forEach((c, i) => {
    const x = (i % RV_C) * 10, y = Math.floor(i / RV_C) * 10;
    if (c.n) walls.push(`M${x} ${y}h10`);
    if (c.w) walls.push(`M${x} ${y}v10`);
    if (i % RV_C === RV_C - 1 && c.e) walls.push(`M${x + 10} ${y}v10`);
    if (Math.floor(i / RV_C) === RV_R - 1 && c.s) walls.push(`M${x} ${y + 10}h10`);
  });
  const bx = here ? cx(RV_GOAL) - 2.6 : cx(pos), by = here ? cy(RV_GOAL) : cy(pos);

  return (
    <Stage won={won} wonText="Enfin réunies" bg="linear-gradient(180deg, #fff1f2, #fce7f3 50%, #ede9fe)" color="#4a044e" style={{ padding:0 }}>
      <style>{`
        @keyframes rdv-bob { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-1.2px) } }
        @keyframes rdv-heart { 0% { transform:translateY(0) scale(.3); opacity:0 } 30% { opacity:1 } 100% { transform:translateY(-120px) scale(1); opacity:1 } }
        @keyframes rdv-call { 0% { transform:translateY(0); opacity:0 } 30% { opacity:.9 } 100% { transform:translateY(-220px); opacity:0 } }
      `}</style>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:"16px 16px 60px" }}>
        <Title color="#831843" style={{ textShadow:"none" }} sub="La buse cherche sa bobine. Guide-la jusqu'à elle.">Rendez-vous</Title>
        <svg ref={svg} viewBox={`-2 -2 ${RV_C * 10 + 4} ${RV_R * 10 + 4}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ width:"min(100%, 380px, calc((100dvh - 330px) * 0.787))", touchAction:"none", cursor:"grab", overflow:"visible",
            filter:"drop-shadow(0 10px 24px rgba(131,24,67,.18))" }}>
          <rect x="-2" y="-2" width={RV_C * 10 + 4} height={RV_R * 10 + 4} rx="4" fill="#fff" opacity=".85"/>
          {/* plateau texture PEI */}
          {Array.from({ length: 40 }, (_, i) => (
            <circle key={i} cx={(i * 37) % (RV_C * 10)} cy={(i * 53) % (RV_R * 10)} r=".35" fill="#f9a8d4" opacity=".5"/>
          ))}
          <polyline points={trail.map(i => `${cx(i)},${cy(i)}`).join(" ")} fill="none" stroke="#f43f5e" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round" opacity=".85"/>
          <path d={walls.join("")} stroke="#7e22ce" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
          {/* la bobine */}
          <g transform={`translate(${cx(RV_GOAL) + (here ? 2.6 : 0)} ${cy(RV_GOAL)})`}>
            <g style={{ animation:"rdv-bob 1.6s ease-in-out infinite" }}>
              <circle r="3.8" fill="#f472b6" stroke="#be185d" strokeWidth=".6"/>
              <circle r="1.6" fill="#fdf2f8"/>
              <circle cx="-.6" cy="-.3" r=".28" fill="#831843"/><circle cx=".6" cy="-.3" r=".28" fill="#831843"/>
              <path d="M-.5 .5 q.5 .5 1 0" stroke="#831843" strokeWidth=".22" fill="none"/>
            </g>
            {!here && <g transform="translate(1.5 -7) scale(.03)"><path d={HEART_D} fill="#f43f5e" style={{ animation:"rdv-call 1.8s ease-out infinite" }}/></g>}
          </g>
          {/* la buse */}
          <g style={{ transform:`translate(${bx}px, ${by}px)`, transition:"transform .12s ease-out" }}>
            <rect x="-3" y="-4" width="6" height="4" rx=".8" fill="#64748b"/>
            <rect x="-2.2" y="-3.3" width="4.4" height="1" rx=".4" fill="#94a3b8"/>
            <path d="M-1.6 0 h3.2 l-1.2 2.6 h-.8z" fill="#f59e0b"/>
            <circle cx="-1" cy="-1.6" r=".4" fill="#fff"/><circle cx="1" cy="-1.6" r=".4" fill="#fff"/>
            <circle cx="-1" cy="-1.55" r=".2" fill="#0f172a"/><circle cx="1" cy="-1.55" r=".2" fill="#0f172a"/>
          </g>
          {here && (
            <g transform={`translate(${cx(RV_GOAL)} ${cy(RV_GOAL) - 4})`}>
              <g transform="translate(-2.5 -2.2) scale(.05)"><path d={HEART_D} fill="#f43f5e" style={{ animation:"rdv-heart .8s ease-out both" }}/></g>
            </g>
          )}
        </svg>
        {won && <Btn color="#db2777" onClick={again} style={{ position:"relative", zIndex:22 }}>Un autre labyrinthe</Btn>}
      </div>
      <Hint won={won} color="#831843" style={{ background:"rgba(255,255,255,.6)" }}>Fais glisser la buse du doigt, ou utilise les flèches.</Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------ bouquet */

const BQ_COLORS = [
  ["rouge", "#ef4444"], ["rose", "#f472b6"], ["jaune", "#facc15"], ["violet", "#a855f7"],
  ["bleu", "#60a5fa"], ["blanc", "#f8fafc"], ["orange", "#fb923c"],
];
const BQ_TOTAL = 12;

function makeOrder() {
  // trois ou quatre couleurs, douze fleurs en tout
  const cols = shuffle(BQ_COLORS.map((_, i) => i)).slice(0, Math.random() < 0.5 ? 3 : 4);
  const counts = cols.map(() => 1);
  for (let k = cols.length; k < BQ_TOTAL; k += 1) counts[Math.floor(Math.random() * cols.length)] += 1;
  return cols.map((c, i) => ({ c, n: counts[i] })).sort((a, b) => b.n - a.n);
}

function Bouquet() {
  const [won, win] = useWin("bouquet");
  const [order] = useState(makeOrder);
  const [col, setCol] = useState(order[0].c);
  const [flowers, setFlowers] = useState([]);
  const svg = useRef(null);
  const nid = useRef(0);

  const countOf = (list, c) => list.filter(f => f.c === c).length;
  const matches = list => list.length === BQ_TOTAL && order.every(o => countOf(list, o.c) === o.n);
  const add = (x, y) => {
    if (won || flowers.length >= BQ_TOTAL) return;
    const sx = 180 + rand(-16, 16);
    nid.current += 1;
    const f = { id: nid.current, x, y, c: col, kind: Math.floor(Math.random() * 3), r: rand(13, 18), rot: rand(0, 60),
      sx, qx: sx + (x - sx) * 0.25 + rand(-18, 18), qy: (345 + y) / 2 };
    const nf = [...flowers, f];
    setFlowers(nf);
    if (matches(nf)) win();
  };
  const tapVase = e => {
    const r = svg.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 360, y = ((e.clientY - r.top) / r.height) * 460;
    add(clamp(x, 40, 320), clamp(y, 36, 290));
  };
  const undo = () => { if (!won) setFlowers(f => f.slice(0, -1)); };
  useKeyDown(e => {
    const k = Number(e.key);
    if (k >= 1 && k <= BQ_COLORS.length) setCol(k - 1);
    else if (e.key === " ") { e.preventDefault(); add(rand(60, 300), rand(50, 270)); }
    else if (e.key === "Backspace") undo();
  });

  const last = flowers[flowers.length - 1];
  const full = flowers.length >= BQ_TOTAL && !won;
  return (
    <Stage won={won} wonText="Bouquet livré, cœur conquis" bg="linear-gradient(180deg, #fefce8, #fdf2f8 60%, #fce7f3)" color="#3f2a1d" style={{ padding:0 }}>
      <style>{`
        @keyframes bq-grow { from { stroke-dashoffset:1 } to { stroke-dashoffset:0 } }
        @keyframes bq-bloom { 0% { transform:scale(0) rotate(-40deg) } 70% { transform:scale(1.15) } 100% { transform:scale(1) rotate(0) } }
      `}</style>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", gap:8, padding:"14px 12px 56px" }}>
        <Title color="#9d174d" style={{ textShadow:"none" }}>Bouquet imprimé</Title>
        <div style={{ fontFamily:SANS, fontSize:13.5, display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center", alignItems:"center" }}>
          <b style={{ color:"#9d174d" }}>Commande :</b>
          {order.map(o => {
            const n = countOf(flowers, o.c);
            return (
              <span key={o.c} style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:999,
                background: n === o.n ? "#dcfce7" : n > o.n ? "#fee2e2" : "rgba(255,255,255,.75)", border:"1px solid rgba(0,0,0,.08)" }}>
                <i style={{ width:10, height:10, borderRadius:"50%", background:BQ_COLORS[o.c][1], border:"1px solid rgba(0,0,0,.2)" }}/>
                {n}/{o.n} {BQ_COLORS[o.c][0]}
              </span>
            );
          })}
        </div>
        <svg ref={svg} viewBox="0 0 360 460" onPointerDown={tapVase}
          style={{ width:"min(100%, 360px, calc((100dvh - 420px) * 0.78))", cursor:"pointer", touchAction:"manipulation", overflow:"visible" }}>
          {flowers.map(f => (
            <g key={"s" + f.id}>
              <path d={`M${f.sx} 345 Q${f.qx} ${f.qy} ${f.x} ${f.y + f.r * 0.5}`} fill="none" stroke="#16a34a" strokeWidth="3.2"
                strokeLinecap="round" pathLength="1" strokeDasharray="1" style={{ animation:"bq-grow .8s linear both" }}/>
              <ellipse cx={(f.sx + 2 * f.qx + f.x) / 4} cy={(345 + 2 * f.qy + f.y) / 4} rx="9" ry="3.6" fill="#22c55e"
                transform={`rotate(${f.x > f.sx ? -30 : 30} ${(f.sx + 2 * f.qx + f.x) / 4} ${(345 + 2 * f.qy + f.y) / 4})`}
                style={{ opacity:0, animation:"hk-fade .3s .5s forwards" }}/>
            </g>
          ))}
          {/* le vase, imprime en mode vase */}
          <defs>
            <clipPath id="bq-vase"><path d="M122 336 L238 336 L226 448 Q180 458 134 448 Z"/></clipPath>
          </defs>
          <path d="M122 336 L238 336 L226 448 Q180 458 134 448 Z" fill="rgba(125,211,252,.55)" stroke="#0284c7" strokeWidth="2"/>
          <g clipPath="url(#bq-vase)">
            {Array.from({ length: 26 }, (_, i) => <rect key={i} x="110" y={336 + i * 4.6} width="140" height="1" fill="rgba(255,255,255,.4)"/>)}
            <rect x="136" y="336" width="10" height="120" fill="rgba(255,255,255,.35)"/>
          </g>
          <rect x="116" y="330" width="128" height="9" rx="4.5" fill="#38bdf8" stroke="#0284c7" strokeWidth="1.5"/>
          {flowers.map(f => (
            <g key={"f" + f.id} transform={`translate(${f.x} ${f.y})`}>
              <g style={{ transformBox:"fill-box", transformOrigin:"center", animation:"bq-bloom .5s .75s cubic-bezier(.2,1.4,.4,1) both" }}>
                <BqHead f={f}/>
              </g>
            </g>
          ))}
          {/* la buse qui imprime */}
          <g style={{ transform:`translate(${last ? last.x : 180}px, ${last ? last.y - 34 : 20}px)`, transition:"transform .5s ease-in-out" }}>
            <rect x="-10" y="-14" width="20" height="12" rx="3" fill="#475569"/>
            <path d="M-5 -2 h10 l-3 7 h-4z" fill="#f59e0b"/>
          </g>
        </svg>
        <div style={{ display:"flex", gap:7, flexWrap:"wrap", justifyContent:"center" }}>
          {BQ_COLORS.map(([name, hex], i) => (
            <button key={i} onClick={() => setCol(i)} aria-label={`Filament ${name}`} title={name}
              style={{ width:38, height:38, borderRadius:"50%", cursor:"pointer", padding:0,
                border: col === i ? "3px solid #9d174d" : "2px solid rgba(0,0,0,.15)",
                background:`radial-gradient(circle, #e7e5e4 0 26%, ${hex} 28% 100%)`,
                transform: col === i ? "scale(1.12)" : "none", transition:"transform .15s", boxShadow:"0 2px 6px rgba(0,0,0,.15)" }}/>
          ))}
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center", fontFamily:SANS, fontSize:13.5 }}>
          <span>{flowers.length} / {BQ_TOTAL} fleurs</span>
          <Btn color="#a8a29e" onClick={undo} style={{ padding:"6px 12px", fontSize:13 }}>Retirer la dernière</Btn>
        </div>
        {full && <div style={{ fontFamily:SANS, fontSize:13, color:"#b91c1c" }}>Ce n'est pas tout à fait la commande… retire ce qui dépasse.</div>}
      </div>
      <Hint won={won} color="#9d174d" style={{ background:"rgba(255,255,255,.7)" }}>Choisis une bobine, puis touche au-dessus du vase.</Hint>
    </Stage>
  );
}

function BqHead({ f }) {
  const c = BQ_COLORS[f.c][1], r = f.r;
  if (f.kind === 0) {
    return (
      <g transform={`rotate(${f.rot})`}>
        {Array.from({ length: 8 }, (_, i) => (
          <ellipse key={i} cx="0" cy={-r * 0.75} rx={r * 0.32} ry={r * 0.62} fill={c} stroke="rgba(0,0,0,.15)" strokeWidth=".8" transform={`rotate(${i * 45})`}/>
        ))}
        <circle r={r * 0.38} fill="#f59e0b"/>
      </g>
    );
  }
  if (f.kind === 1) {
    return (
      <g>
        <path d={`M${-r * 0.8} ${-r * 0.6} L${-r * 0.4} ${-r * 0.1} L0 ${-r * 0.8} L${r * 0.4} ${-r * 0.1} L${r * 0.8} ${-r * 0.6} Q${r * 0.9} ${r * 0.7} 0 ${r * 0.75} Q${-r * 0.9} ${r * 0.7} ${-r * 0.8} ${-r * 0.6}Z`}
          fill={c} stroke="rgba(0,0,0,.18)" strokeWidth="1"/>
        <path d={`M${-r * 0.3} ${r * 0.1} Q0 ${r * 0.5} ${r * 0.3} ${r * 0.1}`} stroke="rgba(255,255,255,.4)" strokeWidth="1.4" fill="none"/>
      </g>
    );
  }
  return (
    <g transform={`rotate(${f.rot})`}>
      <circle r={r * 0.85} fill={c} stroke="rgba(0,0,0,.18)" strokeWidth="1"/>
      <path d={`M0 0 m${r * 0.15} 0 a${r * 0.15} ${r * 0.15} 0 1 1 ${-r * 0.3} 0 a${r * 0.3} ${r * 0.3} 0 1 1 ${r * 0.6} 0 a${r * 0.5} ${r * 0.5} 0 1 1 ${-r} 0`}
        stroke="rgba(0,0,0,.22)" strokeWidth="1.3" fill="none"/>
    </g>
  );
}

/* ------------------------------------------------------------------- lettre */

const LT_CODE = "1402";
const LT_TEXT = [
  "Ma bobine chérie,",
  "Depuis le jour où l'on t'a posée sur mon support, je ne tourne plus rond. Enfin si, je tourne rond, mais c'est pour toi.",
  "Chaque matin, quand ma buse monte à 220 °C, ce n'est pas seulement pour le PLA. C'est parce que je pense à toi.",
  "J'aime ta façon de te dérouler sans jamais faire de nœud (bon, presque jamais, et je t'ai pardonné). J'aime ton diamètre constant, 1,75 mm de pure fidélité, et ta couleur, qui rend magnifique même un cube de calibration.",
  "Quand l'AMS t'emmène pour en charger une autre, je fais semblant de rien. Mais je compte les couches jusqu'à ton retour.",
  "On a traversé ensemble des décollements, des spaghettis, une coupure de courant à 97 %. Tu ne m'as jamais lâchée. Enfin, une fois, mais c'était la faute du capteur.",
  "Je sais qu'un jour tu arriveras au bout. Que ton dernier mètre passera dans mon extrudeur. Ce jour-là, je garderai ton carton vide, comme on garde une lettre.",
  "En attendant, déroule-toi doucement, je t'en prie. Rien ne presse : on a toute la nuit, et le plateau est encore chaud.",
];

function Lettre() {
  const [won, win] = useWin("lettre");
  const later = useTimers();
  const [phase, setPhase] = useState(0);      // 0 scellee, 1 ouverture, 2 ouverte
  const [code, setCode] = useState([0, 0, 0, 0]);
  const [wrong, setWrong] = useState(0);
  const turn = (i, d) => { if (phase) return; setCode(c => c.map((v, j) => (j === i ? (v + d + 10) % 10 : v))); };
  const tryOpen = () => {
    if (phase) return;
    if (code.join("") === LT_CODE) { setPhase(1); later(() => setPhase(2), 1300); }
    else setWrong(w => w + 1);
  };
  const onScroll = e => {
    const el = e.currentTarget;
    if (el.scrollTop > 20 && el.scrollTop + el.clientHeight >= el.scrollHeight - 12) win();
  };
  useKeyDown(e => { if (e.key === "Enter" && !phase) tryOpen(); });

  return (
    <Stage won={won} wonText="Lue jusqu'au post-scriptum" bg="linear-gradient(160deg, #fdf2f8, #fbcfe8 55%, #f9a8d4)" color="#4a1d2c" style={{ padding:0 }}>
      <style>{`
        @keyframes lettre-crack-l { to { transform:translate(-26px, 30px) rotate(-40deg); opacity:0 } }
        @keyframes lettre-crack-r { to { transform:translate(26px, 30px) rotate(40deg); opacity:0 } }
        @keyframes lettre-unfold { from { transform:scaleY(.15) translateY(40%); opacity:0 } to { transform:none; opacity:1 } }
        @keyframes lettre-shake { 0%,100% { transform:translateX(0) } 25%,75% { transform:translateX(-6px) } 50% { transform:translateX(6px) } }
      `}</style>
      <RisingHearts n={7} color="rgba(190,24,93,.10)" prefix="lettre"/>
      {phase < 2 && (
        <div style={{ position:"relative", zIndex:2, display:"flex", flexDirection:"column", alignItems:"center", gap:16, padding:"0 0 50px" }}>
          <Title color="#9d174d" style={{ textShadow:"none" }} sub="Le cachet garde le secret. Il lui faut un code à quatre chiffres.">Une lettre pour toi</Title>
          {/* l'enveloppe */}
          <div style={{ position:"relative", width:"min(86vw, 330px)", aspectRatio:"1.55", perspective:700 }}>
            <div style={{ position:"absolute", inset:0, borderRadius:8, background:"#f5d0c5", boxShadow:"0 16px 34px rgba(131,24,67,.3)" }}/>
            <div style={{ position:"absolute", left:"8%", right:"8%", top:"10%", height:"80%", borderRadius:4, background:"#fffbeb",
              transform: phase >= 1 ? "translateY(-55%)" : "none", transition:"transform .9s .35s ease-in-out" }}/>
            <div style={{ position:"absolute", inset:0, borderRadius:8, background:"linear-gradient(180deg, #fbd5c9, #f3c2b3)",
              clipPath:"polygon(0 0, 50% 56%, 100% 0, 100% 100%, 0 100%)" }}/>
            {/* le tampon de la poste : le code s'y cache */}
            <div aria-hidden="true" style={{ position:"absolute", right:"6%", bottom:"9%", width:70, height:70, borderRadius:"50%",
              border:"2px solid rgba(91,33,182,.42)", color:"rgba(91,33,182,.5)", fontFamily:SANS, fontSize:8.5, fontWeight:700,
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", transform:"rotate(-14deg)", lineHeight:1.25 }}>
              <span>POSTE DES</span><span style={{ fontSize:12 }}>14 · 02</span><span>AMOUREUX</span>
            </div>
            <div aria-hidden="true" style={{ position:"absolute", left:"6%", bottom:"10%", fontFamily:HAND, fontSize:13, color:"#7c2d12", opacity:.8 }}>
              À ma bobine,<br/>étagère du haut
            </div>
            <div style={{ position:"absolute", left:0, right:0, top:0, height:"58%", transformOrigin:"top", zIndex: phase >= 1 ? 0 : 3,
              transform: phase >= 1 ? "rotateX(180deg)" : "none", transition:"transform .6s ease-in-out" }}>
              <div style={{ position:"absolute", inset:0, background:"#efb8a6", clipPath:"polygon(0 0, 100% 0, 50% 100%)", borderRadius:"8px 8px 0 0" }}/>
            </div>
            {/* le cachet de cire */}
            <div style={{ position:"absolute", left:"50%", top:"56%", width:58, height:58, marginLeft:-29, marginTop:-29, zIndex:4, filter:"drop-shadow(0 4px 5px rgba(0,0,0,.35))",
              animation: wrong ? "lettre-shake .35s" : "none" }} key={wrong}>
              {[0, 1].map(k => (
                <div key={k} style={{ position:"absolute", inset:0, borderRadius:"50%",
                  background:"radial-gradient(circle at 35% 30%, #f87171, #b91c1c 60%, #7f1d1d)",
                  clipPath: k ? "inset(0 0 0 50%)" : "inset(0 50% 0 0)", display:"flex", alignItems:"center", justifyContent:"center",
                  animation: phase >= 1 ? `${k ? "lettre-crack-r" : "lettre-crack-l"} .7s ease-in forwards` : "none" }}>
                  <svg viewBox="0 0 100 90" width="26"><path d={HEART_D} fill="rgba(254,202,202,.75)"/></svg>
                </div>
              ))}
            </div>
          </div>
          {/* la serrure du cachet */}
          <div style={{ display:"flex", gap:8, alignItems:"center", opacity: phase ? 0 : 1, transition:"opacity .3s" }}>
            {code.map((v, i) => (
              <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                <button onClick={() => turn(i, 1)} aria-label="Chiffre suivant" style={LT_ARROW}>▲</button>
                <div style={{ width:40, height:46, borderRadius:10, background:"#7f1d1d", color:"#fecaca", fontFamily:SERIF, fontSize:28,
                  fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"inset 0 3px 8px rgba(0,0,0,.4)" }}>{v}</div>
                <button onClick={() => turn(i, -1)} aria-label="Chiffre précédent" style={LT_ARROW}>▼</button>
              </div>
            ))}
            <Btn color="#be123c" onClick={tryOpen} style={{ marginLeft:6 }}>Briser le cachet</Btn>
          </div>
          {wrong > 0 && !phase && <div style={{ fontFamily:SANS, fontSize:13, color:"#9f1239" }}>
            {wrong < 3 ? "La cire résiste…" : "Le facteur a laissé une trace sur l'enveloppe. Regarde bien."}</div>}
        </div>
      )}
      {phase === 2 && (
        <div onScroll={onScroll} style={{ position:"absolute", inset:"12px 10px", zIndex:5, overflowY:"auto", borderRadius:6,
          background:"repeating-linear-gradient(180deg, #fffbeb 0 27px, #fde68a55 27px 28px), #fffbeb",
          boxShadow:"0 18px 44px rgba(131,24,67,.35)", transformOrigin:"top", animation:"lettre-unfold .7s ease-out both" }}>
          <div style={{ maxWidth:520, margin:"0 auto", padding:"26px 22px 30px", fontFamily:SERIF, fontSize:16.5, lineHeight:1.65, color:"#3b2a20" }}>
            <div style={{ textAlign:"right", fontSize:13, opacity:.7, marginBottom:12 }}>L'atelier, à minuit, plateau encore tiède</div>
            {LT_TEXT.map((p, i) => <p key={i} style={{ margin:"0 0 14px", textIndent: i ? 18 : 0, fontWeight: i ? 400 : 700 }}>{p}</p>)}
            <p style={{ margin:"22px 0 4px" }}>Pour toujours, à 100 % de remplissage,</p>
            <p style={{ margin:0, fontFamily:HAND, fontSize:22, color:"#be123c" }}>Ton imprimante</p>
            <p style={{ margin:"28px 0 0", fontSize:14.5, fontStyle:"italic" }}>
              P.-S. : Je t'ai fait un petit cœur en première couche. Il est un peu écrasé. Comme moi quand tu n'es pas là.
            </p>
            <div style={{ textAlign:"center", marginTop:26 }}>
              <svg viewBox="0 0 100 90" width="44"><path d={HEART_D} fill="#f43f5e" opacity=".8"/></svg>
              <div style={{ marginTop:12 }}>
                <Btn color="#be123c" onClick={win}>Plier la lettre contre mon cœur</Btn>
              </div>
            </div>
            <div style={{ height:60 }}/>
          </div>
        </div>
      )}
      <Hint won={won || phase === 2} color="#9d174d" style={{ background:"rgba(255,255,255,.65)" }}>Tout ce qu'il faut est sur l'enveloppe.</Hint>
    </Stage>
  );
}
const LT_ARROW = { width:40, height:24, borderRadius:8, border:"none", background:"rgba(255,255,255,.7)", color:"#9f1239",
  cursor:"pointer", fontSize:12, fontWeight:800 };

/* ----------------------------------------------------------- etoile-filante */

const EF_WISHES = [
  "Qu'aucune impression ne décolle plus jamais",
  "Une bobine qui ne s'emmêle jamais",
  "Du temps pour les gens que j'aime",
  "Un plateau toujours propre",
];

function EtoileFilante() {
  const [won, win] = useWin("etoile-filante");
  const [caught, setCaught] = useState(false);
  const [wish, setWish] = useState("");
  const [sent, setSent] = useState("");
  const [miss, setMiss] = useState(0);
  const box = useRef(null), cv = useRef(null);
  const size = useFullCanvas(box, cv);
  const g = useRef({ stars: [], sw: 0, mets: [], next: 1.8, t: 0, sparks: [], frozen: null });

  const near = (M, x, y) => {
    // distance au segment tete -> queue
    const tx = M.x - M.dx * 100, ty = M.y - M.dy * 100;
    const vx = M.x - tx, vy = M.y - ty, L = vx * vx + vy * vy;
    const k = clamp(((x - tx) * vx + (y - ty) * vy) / L, 0, 1);
    return Math.hypot(x - (tx + vx * k), y - (ty + vy * k));
  };
  const catchIt = M => { g.current.frozen = M; g.current.mets = [M]; setCaught(true); };
  const tap = e => {
    if (caught) return;
    const r = cv.current.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const M = g.current.mets.find(m => near(m, x, y) < 42);
    if (M) { catchIt(M); return; }
    for (let k = 0; k < 6; k += 1) g.current.sparks.push({ x, y, vx: rand(-60, 60), vy: rand(-60, 60), life: 0.7 });
    if (g.current.mets.length) setMiss(m => m + 1);
  };
  useKeyDown(e => {
    if ((e.key === " " || e.key === "Enter") && !caught && g.current.mets.length) { e.preventDefault(); catchIt(g.current.mets[0]); }
  });

  useLoop(dt => {
    const c = cv.current;
    const { w, h } = size.current;
    if (!c || !w) return;
    const ctx = c.getContext("2d");
    const s = g.current;
    s.t += dt;
    if (s.sw !== w) {
      s.sw = w;
      s.stars = Array.from({ length: Math.round((w * h) / 2600) }, () => ({ x: rand(0, w), y: rand(0, h * 0.82), r: rand(0.4, 1.6), f: rand(0.6, 2.4), p: rand(0, 6) }));
    }
    if (!s.frozen && s.t > s.next) {
      s.next = s.t + rand(2.4, 4.6);
      const fromRight = Math.random() < 0.5, a = rand(0.42, 0.72), sp = rand(330, 400);
      s.mets.push({ x: fromRight ? rand(w * 0.55, w + 30) : rand(-30, w * 0.45), y: rand(-20, h * 0.28),
        dx: (fromRight ? -1 : 1) * Math.cos(a), dy: Math.sin(a), sp });
    }
    if (!s.frozen) {
      for (const M of s.mets) { M.x += M.dx * M.sp * dt; M.y += M.dy * M.sp * dt; }
      s.mets = s.mets.filter(M => M.y < h + 120 && M.x > -160 && M.x < w + 160);
    }
    for (const S of s.sparks) { S.x += S.vx * dt; S.y += S.vy * dt; S.life -= dt; }
    s.sparks = s.sparks.filter(S => S.life > 0);

    ctx.clearRect(0, 0, w, h);
    for (const S of s.stars) {
      ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.t * S.f + S.p));
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(S.x, S.y, S.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const M of s.mets) {
      const tx = M.x - M.dx * 120, ty = M.y - M.dy * 120;
      const gr = ctx.createLinearGradient(M.x, M.y, tx, ty);
      gr.addColorStop(0, "rgba(255,255,255,.95)"); gr.addColorStop(0.3, "rgba(253,224,71,.55)"); gr.addColorStop(1, "rgba(253,224,71,0)");
      ctx.strokeStyle = gr; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(M.x, M.y); ctx.lineTo(tx, ty); ctx.stroke();
      const pulse = s.frozen ? 1 + 0.3 * Math.sin(s.t * 5) : 1;
      const rg = ctx.createRadialGradient(M.x, M.y, 0, M.x, M.y, 16 * pulse);
      rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(0.4, "rgba(254,240,138,.7)"); rg.addColorStop(1, "rgba(254,240,138,0)");
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(M.x, M.y, 16 * pulse, 0, Math.PI * 2); ctx.fill();
    }
    for (const S of s.sparks) {
      ctx.globalAlpha = Math.max(0, S.life / 0.7); ctx.fillStyle = "#fde68a";
      ctx.beginPath(); ctx.arc(S.x, S.y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  const send = () => { const t = wish.trim(); if (!t) return; setSent(t); win(); };

  return (
    <Stage won={won} wonText="Vœu envoyé aux étoiles" bg="linear-gradient(180deg, #020617 0%, #1e1b4b 55%, #4c1d95 100%)" style={{ padding:0 }}>
      <style>{`
        @keyframes ef-up { 0% { transform:translate(-50%, 0); opacity:1; letter-spacing:0 } 100% { transform:translate(-50%, -46vh); opacity:0; letter-spacing:.08em } }
        @keyframes ef-in { from { transform:translate(-50%, 20px); opacity:0 } to { transform:translate(-50%, 0); opacity:1 } }
      `}</style>
      <div ref={box} style={{ position:"absolute", inset:0 }}>
        <canvas ref={cv} onPointerDown={tap} style={{ position:"absolute", inset:0, width:"100%", height:"100%", touchAction:"manipulation", cursor:"pointer" }}/>
      </div>
      {/* la colline, et la bobine qui regarde le ciel */}
      <svg aria-hidden="true" viewBox="0 0 400 100" preserveAspectRatio="none" style={{ position:"absolute", left:0, right:0, bottom:0, width:"100%", height:"16%", pointerEvents:"none" }}>
        <path d="M0 60 Q120 20 230 50 T400 40 V100 H0Z" fill="#0b0a1f"/>
      </svg>
      <svg aria-hidden="true" viewBox="0 0 40 40" style={{ position:"absolute", left:"58%", bottom:"11%", width:34, pointerEvents:"none" }}>
        <circle cx="20" cy="20" r="16" fill="#1e1b4b" stroke="#312e81" strokeWidth="2"/><circle cx="20" cy="20" r="6" fill="#0b0a1f"/>
        <circle cx="16" cy="17" r="1.4" fill="#c7d2fe"/><circle cx="24" cy="17" r="1.4" fill="#c7d2fe"/>
      </svg>
      <div style={{ position:"absolute", top:16, left:0, right:0, pointerEvents:"none" }}>
        <Title sub={sent ? "Ton vœu est parti." : caught ? "Tu la tiens ! Vite, un vœu." : miss > 0 ? "Presque ! Elles filent vite…" : "Attrape une étoile filante pendant qu'elle passe."}>Étoile filante</Title>
      </div>
      {caught && !sent && (
        <div style={{ position:"absolute", left:"50%", bottom:"14%", zIndex:10, width:"min(92%, 420px)", padding:"16px 14px", borderRadius:18,
          background:"rgba(15,23,42,.82)", border:"1px solid rgba(253,224,71,.4)", boxShadow:"0 18px 44px rgba(0,0,0,.5)",
          fontFamily:SANS, animation:"ef-in .4s ease-out both", backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)", boxSizing:"border-box" }}>
          <div style={{ fontWeight:800, fontSize:17, marginBottom:10, textAlign:"center" }}>Fais un vœu ✨</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center", marginBottom:10 }}>
            {EF_WISHES.map(t => (
              <button key={t} onClick={() => setWish(t)} style={{ padding:"6px 10px", borderRadius:999, border:"1px solid rgba(255,255,255,.25)",
                background: wish === t ? "#fde68a" : "rgba(255,255,255,.08)", color: wish === t ? "#1e1b4b" : "#fff", fontSize:12.5, cursor:"pointer" }}>{t}</button>
            ))}
          </div>
          <input value={wish} onChange={e => setWish(e.target.value.slice(0, 80))} onKeyDown={e => { if (e.key === "Enter") send(); }}
            placeholder="… ou écris le tien" style={{ width:"100%", boxSizing:"border-box", padding:"10px 12px", borderRadius:10,
              border:"1px solid rgba(255,255,255,.25)", background:"rgba(255,255,255,.1)", color:"#fff", fontSize:16, outline:"none" }}/>
          <div style={{ textAlign:"center", marginTop:10 }}>
            <Btn color="#ca8a04" onClick={send} disabled={!wish.trim()} style={{ opacity: wish.trim() ? 1 : 0.5 }}>Confier mon vœu</Btn>
          </div>
        </div>
      )}
      {sent && (
        <>
          <div style={{ position:"absolute", left:"50%", top:"58%", zIndex:9, fontFamily:SERIF, fontStyle:"italic", fontSize:20, color:"#fef9c3",
            width:"86%", textAlign:"center", textShadow:"0 0 14px rgba(253,224,71,.8)", animation:"ef-up 4s ease-in forwards", pointerEvents:"none" }}>{sent}</div>
          <div style={{ position:"absolute", left:"50%", top:"40%", transform:"translateX(-50%)", zIndex:9, fontFamily:SANS, fontSize:14,
            opacity:.85, textAlign:"center", width:"80%", animation:"hk-fade 1s 2.5s both", pointerEvents:"none" }}>
            Ton vœu file vers les étoiles. Personne d'autre ne le lira.
          </div>
        </>
      )}
      <Hint won={won || caught}>Patience : elles passent toutes les quelques secondes.</Hint>
    </Stage>
  );
}

/* -------------------------------------------------------------------- calin */

const CA_GOAL = 5;

function Calin() {
  const [won, win] = useWin("calin");
  const s = useRef({ hold: false, held: 0, start: 0, d: 1, done: false });
  const [v, setV] = useState({ d: 1, held: 0, hold: false });
  const [msg, setMsg] = useState("");

  useLoop(dt => {
    const st = s.current;
    if (st.done) st.d = Math.max(0, st.d - dt * 3);
    else if (st.hold) {
      st.held = (performance.now() - st.start) / 1000;
      st.d = Math.max(0, st.d0 - st.held * 2.4);
      if (st.held >= CA_GOAL) { st.done = true; win(); }
    } else st.d = Math.min(1, st.d + dt * 2.2);
    setV(o => (o.d === st.d && o.held === st.held && o.hold === st.hold ? o : { d: st.d, held: st.held, hold: st.hold }));
  });
  const press = () => { const st = s.current; if (st.done || st.hold) return; st.hold = true; st.held = 0; st.d0 = st.d; st.start = performance.now(); setMsg(""); };
  const release = () => {
    const st = s.current;
    if (!st.hold) return;
    st.hold = false;
    if (!st.done) {
      st.held = (performance.now() - st.start) / 1000;
      if (st.held >= CA_GOAL) { st.done = true; win(); return; }
      if (st.held > 0.3) setMsg(pick(["Oh non, trop tôt !", "Ils n'avaient pas fini…", "Encore un peu, la prochaine fois !", "Un câlin, ça se savoure."]));
      st.held = 0;
    }
  };
  const relRef = useRef(release);
  relRef.current = release;
  useKeyDown(e => { if (e.key === " " && !e.repeat) { e.preventDefault(); press(); } }, e => { if (e.key === " ") release(); });
  useEffect(() => { const b = () => relRef.current(); window.addEventListener("blur", b); return () => window.removeEventListener("blur", b); }, []);

  const hug = 1 - v.d;
  const gap = -10 + v.d * 130;
  const hugging = v.d < 0.08 && (v.hold || s.current.done);
  const ratio = s.current.done ? 1 : v.held / CA_GOAL;
  return (
    <Stage won={won} wonText="Le plus doux des câlins" bg="radial-gradient(circle at 50% 60%, #fde68a, #fdba74 45%, #f472b6 100%)" color="#4a1d2c" style={{ padding:0 }}>
      <style>{`
        @keyframes calin-rise { 0% { transform:translateY(0) scale(.5); opacity:0 } 15% { opacity:1 } 100% { transform:translateY(-80px) scale(1.1); opacity:0 } }
        @keyframes calin-breath { 0%,100% { scale:1 } 50% { scale:1.03 } }
      `}</style>
      <div onPointerDown={e => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* rien */ } press(); }}
        onPointerUp={release} onPointerCancel={release} onContextMenu={e => e.preventDefault()}
        style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:22,
          padding:"20px 16px 60px", cursor:"pointer", touchAction:"none", WebkitTouchCallout:"none" }}>
        <Title color="#831843" style={{ textShadow:"none" }} sub={"Garde le doigt appuyé cinq secondes. Ne lâche pas !"}>Câlin</Title>
        <div style={{ position:"relative", width:"min(92vw, 380px)", height:180 }}>
          {/* les coeurs qui montent */}
          <div aria-hidden="true" style={{ position:"absolute", left:"50%", top:10, opacity: hugging ? 1 : 0, transition:"opacity .4s", pointerEvents:"none", zIndex:3 }}>
            {Array.from({ length: 8 }, (_, i) => (
              <svg key={i} viewBox="0 0 100 90" width={14 + (i % 3) * 6} style={{ position:"absolute", left:(i % 4) * 16 - 32,
                animation:`calin-rise ${2 + (i % 3) * 0.5}s ease-out ${i * 0.3}s infinite` }}>
                <path d={HEART_D} fill={["#f43f5e", "#ec4899", "#fb7185"][i % 3]}/>
              </svg>
            ))}
          </div>
          <CaSpool side={-1} gap={gap} hug={hug} color="#3b82f6" dark="#1d4ed8"/>
          <CaSpool side={1} gap={gap} hug={hug} color="#f472b6" dark="#be185d" bow/>
          {/* les bras, poses par-dessus : chacun entoure l'autre */}
          <svg aria-hidden="true" viewBox="-130 -90 260 180" width="260" height="180" style={{ position:"absolute", left:"50%", top:0,
            marginLeft:-130, overflow:"visible", pointerEvents:"none", zIndex:3, opacity: hug > 0.75 ? (hug - 0.75) / 0.25 : 0 }}>
            <path d="M-34 -16 Q30 -66 90 -18" stroke="#1d4ed8" strokeWidth="9" strokeLinecap="round" fill="none"/>
            <path d="M34 20 Q-30 68 -90 22" stroke="#be185d" strokeWidth="9" strokeLinecap="round" fill="none"/>
          </svg>
        </div>
        <div style={{ width:"min(80vw, 300px)" }}>
          <div style={{ height:10, borderRadius:10, background:"rgba(255,255,255,.5)", overflow:"hidden" }}>
            <div style={{ width:`${ratio * 100}%`, height:"100%", background:"linear-gradient(90deg, #fb7185, #e11d48)" }}/>
          </div>
          <div style={{ textAlign:"center", fontFamily:SANS, fontSize:14, marginTop:8, minHeight:20, fontWeight:700 }}>
            {s.current.done ? "Ils ne se lâchent plus." : v.hold ? `${Math.min(CA_GOAL, v.held).toFixed(1).replace(".", ",")} s… tiens bon` : msg}
          </div>
        </div>
      </div>
      <Hint won={won} color="#831843" style={{ background:"rgba(255,255,255,.6)" }}>Appui long sur l'écran, ou la barre d'espace maintenue.</Hint>
    </Stage>
  );
}

function CaSpool({ side, gap, hug, color, dark, bow }) {
  const R = 54;
  const closed = hug > 0.92;
  return (
    <svg viewBox="-70 -70 140 140" width="120" style={{ position:"absolute", top:30, left:"50%", overflow:"visible", zIndex: side > 0 ? 2 : 1,
      transform:`translateX(calc(-50% + ${side * (gap / 2 + R)}px)) rotate(${-side * 7 * hug}deg)`,
      animation: closed ? "calin-breath 1.6s ease-in-out infinite" : "none" }}>
      <circle r={R} fill={color} stroke={dark} strokeWidth="4"/>
      {Array.from({ length: 6 }, (_, i) => <circle key={i} r={R - 6 - i * 5} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="1.6"/>)}
      <circle r="24" fill="#f5f5f4" stroke="#d6d3d1" strokeWidth="2"/>
      {closed ? (
        <>
          <path d="M-12 -3 q4 -5 8 0" stroke="#292524" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
          <path d="M4 -3 q4 -5 8 0" stroke="#292524" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
        </>
      ) : (
        <>
          <circle cx="-8" cy="-3" r="3" fill="#292524"/><circle cx="8" cy="-3" r="3" fill="#292524"/>
          <circle cx={-7 + side * 0.8} cy="-4" r="1" fill="#fff"/><circle cx={9 + side * 0.8} cy="-4" r="1" fill="#fff"/>
        </>
      )}
      <ellipse cx="-14" cy="6" rx="4" ry="2.4" fill="#fda4af" opacity={0.4 + 0.6 * hug}/>
      <ellipse cx="14" cy="6" rx="4" ry="2.4" fill="#fda4af" opacity={0.4 + 0.6 * hug}/>
      <path d={closed ? "M-6 9 q6 6 12 0" : "M-5 9 q5 3 10 0"} stroke="#292524" strokeWidth="2" fill="none" strokeLinecap="round"/>
      {bow && (
        <g transform="translate(26 -46) rotate(18)">
          <path d="M0 0 L-14 -8 L-14 8Z M0 0 L14 -8 L14 8Z" fill="#e11d48"/><circle r="4" fill="#be123c"/>
        </g>
      )}
    </svg>
  );
}

/* -------------------------------------------------------------------- fleur */

const FL_WORDS = ["un peu", "beaucoup", "passionnément", "à la folie", "pas du tout"];

/** Un nombre de petales qui ne tombe PAS de lui-meme sur « a la folie ». */
function flCount() {
  let n;
  do { n = 13 + Math.floor(Math.random() * 7); } while (n % 5 === 4);
  return n;
}

function Fleur() {
  const [won, win] = useWin("fleur");
  const later = useTimers();
  const [n, setN] = useState(flCount);
  const [left, setLeft] = useState(() => Array.from({ length: n }, (_, i) => i));
  const [fall, setFall] = useState([]);
  const [words, setWords] = useState(0);         // mots prononces
  const [end, setEnd] = useState(null);          // "folie" | "rate"
  const [round, setRound] = useState(0);

  // copie synchrone de l'etat (deux touches rapides ne lisent pas un rendu perime)
  const live = useRef({ left, words: 0, end: null });
  const say = (gone, nl) => {
    const L = live.current;
    setFall(f => [...f, ...gone.map(i => ({ i, k: `${round}-${i}`, dx: rand(-90, 90), r: rand(-320, 320) }))]);
    L.left = nl; L.words += 1;
    setLeft(nl);
    setWords(L.words);
    if (nl.length === 0) {
      L.end = (L.words - 1) % 5 === 3 ? "folie" : "rate";
      setEnd(L.end);
      if (L.end === "folie") later(win, 300);
    }
  };
  const pluck = i => {
    const L = live.current;
    if (L.end || !L.left.includes(i)) return;
    say([i], L.left.filter(j => j !== i));
  };
  const blow = () => {
    const L = live.current;
    if (L.end || L.left.length < 2) return;
    say(L.left.slice(-2), L.left.slice(0, -2));
  };
  const regrow = () => {
    const m = flCount();
    const nl = Array.from({ length: m }, (_, i) => i);
    live.current = { left: nl, words: 0, end: null };
    setN(m); setLeft(nl); setFall([]); setWords(0); setEnd(null); setRound(r => r + 1);
  };
  useKeyDown(e => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (live.current.end === "rate") regrow(); else pluck(live.current.left[live.current.left.length - 1]); }
    if (e.key === "b" || e.key === "B") blow();
  });

  const word = words ? FL_WORDS[(words - 1) % 5] : null;
  const petalRx = Math.max(9, 150 / n);
  return (
    <Stage won={won} wonText="Elle t'aime à la folie" bg="linear-gradient(180deg, #bae6fd 0%, #e0f2fe 55%, #bbf7d0 56%, #86efac 100%)" color="#14532d" style={{ padding:0 }}>
      <style>{`
        @keyframes fleur-fall { 0% { transform:translate(0,0) rotate(0); opacity:1 } 100% { transform:translate(var(--dx), 340px) rotate(var(--r)); opacity:0 } }
        @keyframes fleur-word { 0% { transform:scale(.6); opacity:0 } 50% { transform:scale(1.12); opacity:1 } 100% { transform:scale(1); opacity:1 } }
        @keyframes fleur-sway { 0%,100% { transform:rotate(-2deg) } 50% { transform:rotate(2deg) } }
        @keyframes fleur-burst { 0% { transform:translate(0,0) scale(.3); opacity:1 } 100% { transform:translate(var(--dx), var(--dy)) scale(1); opacity:0 } }
      `}</style>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:"14px 16px 60px" }}>
        <Title color="#166534" style={{ textShadow:"none" }} sub="Le dernier pétale doit tomber sur « à la folie ».">Effeuille la marguerite</Title>
        <div style={{ height:56, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:SERIF }}>
          <div style={{ fontSize:14, opacity:.75 }}>Il m'aime…</div>
          {word && <div key={words} style={{ fontSize: end === "folie" ? 30 : 24, fontWeight:700, fontStyle:"italic",
            color: end === "folie" ? "#be123c" : end === "rate" ? "#64748b" : "#166534", animation:"fleur-word .35s ease-out both" }}>
            {end === "folie" ? "à la folie !" : word + (end === "rate" ? "." : "…")}</div>}
        </div>
        <div style={{ position:"relative" }}>
          <svg viewBox="0 0 300 420" style={{ width:"min(78vw, 300px, calc((100dvh - 330px) * 0.714))", overflow:"visible" }}>
            <g style={{ transformOrigin:"150px 420px", animation:"fleur-sway 5s ease-in-out infinite" }}>
              <path d="M150 180 Q138 300 152 420" stroke="#15803d" strokeWidth="7" fill="none" strokeLinecap="round"/>
              <path d="M146 320 q-46 -28 -66 -4 q30 20 66 4z" fill="#22c55e"/>
              <path d="M150 270 q44 -30 66 -8 q-28 22 -66 8z" fill="#16a34a"/>
              {left.map(i => (
                <g key={`${round}-${i}`} transform={`rotate(${(i * 360) / n} 150 150)`} onClick={e => { e.stopPropagation(); pluck(i); }}
                  style={{ cursor:"pointer" }}>
                  <ellipse cx="150" cy="96" rx={petalRx} ry="46" fill="#fff" stroke="#e5e7eb" strokeWidth="1.5"/>
                  <path d="M150 62 v50" stroke="#f1f5f9" strokeWidth="1.5"/>
                </g>
              ))}
              {fall.map(f => (
                <g key={"f" + f.k} style={{ transformBox:"fill-box", transformOrigin:"center", animation:"fleur-fall 1.8s ease-in forwards",
                  "--dx": `${f.dx}px`, "--r": `${f.r}deg`, pointerEvents:"none" }}>
                  <g transform={`rotate(${(f.i * 360) / n} 150 150)`}>
                    <ellipse cx="150" cy="96" rx={petalRx} ry="46" fill="#fff" stroke="#e5e7eb" strokeWidth="1.5"/>
                  </g>
                </g>
              ))}
              {/* le coeur jaune, remplissage en nid d'abeille */}
              <circle cx="150" cy="150" r="32" fill="#facc15" stroke="#ca8a04" strokeWidth="2"/>
              {Array.from({ length: 19 }, (_, i) => {
                const a = i * 2.4, rr = Math.sqrt(i) * 6.2;
                return <circle key={i} cx={150 + Math.cos(a) * rr} cy={150 + Math.sin(a) * rr} r="2.4" fill="#eab308"/>;
              })}
              {end === "folie" && <path d="M138 156 q12 12 24 0" stroke="#78350f" strokeWidth="3" fill="none" strokeLinecap="round"/>}
            </g>
          </svg>
          {end === "folie" && Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return (
              <svg key={i} viewBox="0 0 100 90" width="22" style={{ position:"absolute", left:"50%", top:"34%", marginLeft:-11,
                "--dx": `${Math.cos(a) * 140}px`, "--dy": `${Math.sin(a) * 140}px`, animation:`fleur-burst 1.4s ease-out ${i * 0.04}s both` }}>
                <path d={HEART_D} fill="#f43f5e"/>
              </svg>
            );
          })}
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center", position:"relative", zIndex:22 }}>
          {end === "rate"
            ? <Btn color="#16a34a" onClick={regrow}>Une autre marguerite</Btn>
            : !end && <Btn color="#0ea5e9" onClick={blow} disabled={left.length < 2} style={{ opacity: left.length < 2 ? 0.5 : 1 }}>Souffler 🌬️</Btn>}
        </div>
        {end === "rate" && <div style={{ fontFamily:SANS, fontSize:13, textAlign:"center", maxWidth:320 }}>
          Elle s'est arrêtée sur « {word} ». Compte les pétales avant de commencer !</div>}
      </div>
      <Hint won={won} color="#14532d" style={{ background:"rgba(255,255,255,.6)" }}>
        Un pétale = un mot. « Souffler » en fait tomber deux, mais ne dit qu'un mot.
      </Hint>
    </Stage>
  );
}

/* ------------------------------------------------------------------- export */

export const PAGES = {
  "coeur": Coeur,
  "cupidon": Cupidon,
  "je-t-aime": JeTaime,
  "rendez-vous": RendezVous,
  "bouquet": Bouquet,
  "lettre": Lettre,
  "etoile-filante": EtoileFilante,
  "calin": Calin,
  "fleur": Fleur,
};
