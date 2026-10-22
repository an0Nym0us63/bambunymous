import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CalendarClock, BarChart3, ListChecks, History, Package, Flame, Droplets, Coins, Star, Users, Trophy,
         Dices, ChevronRight, Camera, Video, Thermometer, CalendarDays, ShoppingBag, Rss, Images, Zap, Medal as MedalIcon,
         BellRing, TrendingUp, TrendingDown, Key, Ticket, X, ArrowUpRight, Maximize2, Timer, Palette, Target, Disc3, CalendarCheck } from "lucide-react";
import client, { apiUrl } from "../api/client";
import { mwImg } from "./MwImg";
import LiveCamera from "./LiveCamera";
import { Medal, gradeOf, GradeEmblem, CARD_ORDER } from "../pages/Achievements";

// Les tuiles de l'accueil (22/10/2026, refaites le meme jour). Chaque tuile :
//  - connait sa place reelle (largeur et hauteur en pixels, mesurees) et s'agence
//    en consequence : sur une ligne a demi-hauteur, en ligne quand c'est bas, en
//    colonne centree quand c'est etroit et haut, en grille qui remplit la case
//    (jauges, vignettes, pastilles, raccourcis), en listes qui montrent ce qui tient ;
//  - s'ouvre en grand d'un clic (le detail : courbes, listes completes) avec un
//    lien vers sa page ;
//  - a ses options, reglees dans son panneau (l'engrenage) et gardees par disposition.
// Chaque tuile est une « .card » et ses morceaux (mots, chiffres, pastilles,
// vignettes) portent data-pk : les effets de l'accueil les font bouger un par un.

const ymd = d => d.toLocaleDateString("sv");
const hexCss = h => { const s = String(h || "").replace("#", ""); return s.length >= 6 ? `#${s.slice(0, 6)}` : "#888"; };
const fmtH = s => { const h = (s || 0) / 3600; return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1).replace(".", ",")} h`; };
const fmtG = g => (g || 0) >= 1000 ? `${((g || 0) / 1000).toFixed(1).replace(".", ",")} kg` : `${Math.round(g || 0)} g`;
const fmtDur = s => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`; };
const fmtEur = v => `${(v || 0).toFixed(2).replace(".", ",")} €`;
const ago = iso => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `il y a ${Math.max(1, m)} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
};
const noEmoji = t => String(t || "").replace(/^\p{Extended_Pictographic}️?\s*/u, "");
const printImg = id => apiUrl(`/prints/${id}/image`);
const LIVE = ["RUNNING", "PAUSE", "PAUSED", "PREPARE", "SLICING"];
const isLive = st => LIVE.includes(String(st?.status || "").toUpperCase());

function W({ text }) {
  return String(text ?? "").split(/(\s+)/).map((p, i) => /\s/.test(p) || !p ? p : <span key={i} data-pk="">{p}</span>);
}

// ── La place d'une tuile ─────────────────────────────────────────────────────
// W et H : la largeur et la hauteur du corps de la tuile (sous son titre) ;
// zoom : vrai dans la vue en grand.
const BoxCtx = createContext({ W: 0, H: 0, zoom: false });
const useBox = () => useContext(BoxCtx);
function useMeasure() {
  const ref = useRef(null);
  const [b, setB] = useState({ W: 0, H: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => {
      const r = el.getBoundingClientRect(), w = Math.floor(r.width), h = Math.floor(r.height);
      setB(o => o.W === w && o.H === h ? o : { W: w, H: h });
    };
    set();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, b];
}
const kids = (c, b) => typeof c === "function" ? c(b) : c;
// combien d'elements tiennent en liste (hauteur d'une ligne, ecart)
const fitRows = (H, rowH, gap = 6) => Math.max(1, Math.floor((H + gap) / (rowH + gap)));
// n elements en grille dans W x H : le nombre de colonnes qui les rend les plus grands
// (ar : hauteur / largeur d'un element ; extra : hauteur fixe ajoutee, une legende)
function fitGrid(n, W, H, { gap = 6, ar = 1, extra = 0, max = 400 } = {}) {
  let best = { cols: Math.max(1, n), rows: 1, size: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const byW = (W - gap * (cols - 1)) / cols;
    const byH = ((H - gap * (rows - 1)) / rows - extra) / ar;
    const size = Math.min(byW, byH, max);
    if (size > best.size + 0.5) best = { cols, rows, size };
  }
  return { ...best, size: Math.max(0, Math.floor(best.size)) };
}
// des elements de taille donnee : combien en tient-il (colonnes x rangees)
function fillGrid(W, H, min, gap = 6) {
  const cols = Math.max(1, Math.floor((W + gap) / (min + gap)));
  const size = Math.floor((W - gap * (cols - 1)) / cols);
  const rows = Math.max(1, Math.floor((H + gap) / (size + gap)));
  return { cols, rows, size, n: cols * rows };
}

// ── Le gabarit ───────────────────────────────────────────────────────────────
// to : la page de la tuile ; zoom : ce que montre la vue en grand (sinon un clic ouvre la page)
function Tile({ icon, color, label, to, zoom, onClick, badge, children, mini = false, summary = null }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [ref, box] = useMeasure();
  const act = onClick || (zoom ? () => setOpen(true) : to ? () => nav(to) : null);
  const big = open && <Zoom icon={icon} color={color} label={label} to={to} onClose={() => setOpen(false)}>{zoom}</Zoom>;
  if (mini) return (
    <div className="card" role={act ? "button" : undefined} tabIndex={act ? 0 : undefined} onClick={act}
      style={{ padding: "0 12px", display: "flex", alignItems: "center", gap: 8, minWidth: 0, cursor: act ? "pointer" : "default",
        position: "relative", overflow: "hidden", height: "100%", boxSizing: "border-box" }}>
      <span data-pk="" style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
        background: `${color}22`, color, flexShrink: 0 }}>{icon}</span>
      <span className="tile-head" style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", minWidth: 0, flexShrink: 1 }}><W text={label}/></span>
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 15, fontWeight: 900,
        color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden" }}>{summary}</span>
      {big}
    </div>
  );
  return (
    <div className="card" role={act ? "button" : undefined} tabIndex={act ? 0 : undefined} onClick={act}
      onKeyDown={e => { if (act && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); act(); } }}
      style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0, cursor: act ? "pointer" : "default",
        position: "relative", overflow: "hidden", height: "100%", boxSizing: "border-box" }}>
      <span aria-hidden="true" style={{ position: "absolute", right: -24, top: -24, width: 80, height: 80, borderRadius: "50%",
        background: `${color}22`, pointerEvents: "none" }}/>
      <div className="tile-head" style={{ display: "flex", alignItems: "center", gap: 8, position: "relative", minWidth: 0 }}>
        <span data-pk="" style={{ width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
          background: `${color}22`, color, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", letterSpacing: ".02em", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", minWidth: 0 }}><W text={label}/></span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {badge}{zoom ? <Maximize2 size={12} style={{ color: "var(--muted)" }}/> : act && <ChevronRight size={14} style={{ color: "var(--muted)" }}/>}</span>
      </div>
      <div ref={ref} style={{ position: "relative", minWidth: 0, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {box.W > 0 && <BoxCtx.Provider value={box}>{kids(children, box)}</BoxCtx.Provider>}
      </div>
      {big}
    </div>
  );
}
// la tuile en grand : par-dessus la page, son detail, et un lien vers sa page
function Zoom({ icon, color, label, to, onClose, children }) {
  const nav = useNavigate();
  const [ref, box] = useMeasure();
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const b = { W: box.W, H: box.H, zoom: true };
  return createPortal(
    <div data-no-pull="" onClick={e => { e.stopPropagation(); onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 900, padding: 14,
      background: "rgba(2,6,23,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "default" }}>
      <div className="card" onClick={e => e.stopPropagation()} style={{ width: "min(780px, 100%)", height: "min(620px, 86vh)", padding: 16,
        display: "flex", flexDirection: "column", gap: 12, position: "relative", overflow: "hidden", boxSizing: "border-box",
        background: "var(--sheet-bg)", boxShadow: "0 30px 80px rgba(0,0,0,0.45)" }}>
        <span aria-hidden="true" style={{ position: "absolute", right: -60, top: -60, width: 200, height: 200, borderRadius: "50%",
          background: `${color}26`, pointerEvents: "none" }}/>
        <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
          <span style={{ width: 34, height: 34, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center",
            background: `${color}22`, color, flexShrink: 0 }}>{icon}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 900, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap" }}>{label}</span>
          {to && <button onClick={() => { onClose(); nav(to); }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px",
            borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 12.5, color: "#fff", background: color }}>
            Ouvrir<ArrowUpRight size={14}/></button>}
          <button onClick={onClose} aria-label="Fermer" style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid var(--border)",
            background: "var(--surface2)", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={17}/></button>
        </div>
        <div ref={ref} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 12,
          position: "relative" }}>
          {box.W > 0 && <BoxCtx.Provider value={b}>{kids(children, b)}</BoxCtx.Provider>}
        </div>
      </div>
    </div>, document.body);
}

// ── Briques communes ─────────────────────────────────────────────────────────
const clamp = n => ({ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: n, WebkitBoxOrient: "vertical", lineHeight: 1.35 });
const Line = ({ children }) =>
  <div style={{ fontSize: 12.5, color: "var(--text2)", ...clamp(2) }}>{children}</div>;
const Empty = ({ children }) =>
  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 12.5,
    color: "var(--muted)", fontWeight: 700 }}><W text={children}/></div>;
const Muted = ({ children, size = 11.5, style }) => <span style={{ fontSize: size, color: "var(--muted)", fontWeight: 600, ...style }}>{children}</span>;
const H2 = ({ children }) => <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>{children}</div>;
// le chiffre-cle et son visuel (un anneau, une jauge…), agences selon la place :
// en ligne (visuel a gauche) ou, etroit et haut, en colonne centree
function Hero({ visual, value, unit, delta, sub, color = "var(--text)", reserve = 0, fill = true }) {
  const { W, H: H0, zoom } = useBox();
  const H = Math.max(40, H0 - reserve);
  const narrow = W < 215;
  const stack = !!visual && narrow && H >= 150;
  const vs = !visual ? 0 : stack ? Math.min(W * (H >= 280 ? 0.9 : 0.66), H - 74, 200) : Math.min(H - 2, narrow ? 62 : zoom ? 150 : 108, W * 0.4);
  const fs = zoom ? 40 : stack ? 26 : Math.round(Math.max(20, Math.min(narrow ? 25 : 34, H * 0.4)));
  const used = stack ? vs + fs + 24 : fs + 22;
  const subLines = Math.max(0, Math.min(3, Math.floor((H - used) / 16)));
  return (
    <div style={{ display: "flex", flexDirection: stack ? "column" : "row", alignItems: "center", justifyContent: "center", gap: stack ? 6 : 12,
      textAlign: stack ? "center" : "left", minWidth: 0, ...(fill ? { flex: 1, minHeight: 0 } : {}) }}>
      {visual && vs >= 24 && visual(Math.floor(vs))}
      <div style={{ minWidth: 0, flex: stack ? undefined : 1, display: "flex", flexDirection: "column", alignItems: stack ? "center" : "flex-start", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0 6px", flexWrap: "wrap", justifyContent: stack ? "center" : "flex-start", minWidth: 0 }}>
          <span data-pk="" style={{ fontSize: fs, fontWeight: 900, lineHeight: 1.05, color, letterSpacing: "-.01em", whiteSpace: "nowrap" }}>{value}</span>
          {unit && <span style={{ fontSize: zoom ? 15 : 12.5, fontWeight: 700, color: "var(--text2)" }}>{unit}</span>}
        </div>
        {delta}
        {sub && subLines > 0 && <div style={{ fontSize: zoom ? 13 : 12, color: "var(--muted)", ...clamp(zoom ? 3 : subLines) }}>{sub}</div>}
      </div>
    </div>
  );
}
// une liste de rangees qui occupe la case : longue, la premiere en grand puis ce qui tient ;
// courte, toutes grandissent
function fitList(list, row, W, H) {
  const per = Math.floor((H + 6) / 40);
  const each = Math.floor((H - 6 * (list.length - 1)) / Math.max(1, list.length));
  // etroite et haute : des cartes (la vignette en grand, le titre dessous)
  if (W < 215 && each >= 110) return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    {list.slice(0, Math.max(1, Math.floor((H + 6) / 116))).map(x => row(x, Math.min(each, W + 40), true))}</div>;
  if (list.length <= per) {
    const size = Math.max(30, Math.min(W < 215 ? 64 : 76, Math.floor((H - 6 * (list.length - 1)) / list.length)));
    return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{list.map(x => row(x, size))}</div>;
  }
  const first = H >= 120 ? 52 : Math.min(44, H);
  const rest = fitRows(H - first - 8, 34, 6);
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    {row(list[0], first)}{H - first >= 40 && list.slice(1, 1 + rest).map(x => row(x, 34))}</div>;
}
// une rangee d'element de liste : vignette, titre, sous-titre, a droite une valeur
function Item({ img, dot, title, sub, right, size = 36, onClick, color, card = false }) {
  if (card) return (
    <div onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
      style={{ height: size, display: "flex", flexDirection: "column", gap: 3, minWidth: 0, cursor: onClick ? "pointer" : undefined }}>
      <span style={{ position: "relative", flex: 1, minHeight: 0, display: "block" }}>
        {img ? <img data-pk="" src={img} alt="" onError={e => { e.currentTarget.style.visibility = "hidden"; }}
          style={{ width: "100%", height: "100%", borderRadius: 12, objectFit: "cover", background: "var(--surface2)", display: "block" }}/>
          : <span style={{ width: "100%", height: "100%", borderRadius: 12, background: color ? `${color}22` : "var(--surface2)", display: "block" }}/>}
        {dot && <span style={{ position: "absolute", right: 6, top: 6, width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--surface)", background: dot }}/>}
        {right && <span style={{ position: "absolute", left: 6, top: 6 }}>{right}</span>}
      </span>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><W text={title}/></div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
    </div>
  );
  return (
    <div onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
      style={{ display: "flex", gap: 9, alignItems: "center", minWidth: 0, cursor: onClick ? "pointer" : undefined, height: size }}>
      {img !== undefined && <span style={{ position: "relative", flexShrink: 0 }}>
        {img ? <img data-pk="" src={img} alt="" onError={e => { e.currentTarget.style.visibility = "hidden"; }}
          style={{ width: size, height: size, borderRadius: Math.round(size / 4), objectFit: "cover", background: "var(--surface2)", display: "block" }}/>
          : <span data-pk="" style={{ width: size, height: size, borderRadius: Math.round(size / 4), background: color ? `${color}22` : "var(--surface2)",
            display: "block" }}/>}
        {dot && <span style={{ position: "absolute", right: -3, bottom: -3, width: 12, height: 12, borderRadius: "50%",
          border: "2px solid var(--surface)", background: dot }}/>}
      </span>}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: size >= 44 ? 13.5 : 12.5, fontWeight: 800, color: "var(--text)", lineHeight: 1.25,
          ...(size >= 56 ? { overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }
            : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }) }}><W text={title}/></div>
        {sub && size >= 30 && <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}
// un anneau (0 a 1), un nombre au centre
function Ring({ value, size = 54, color = "#3b82f6", stroke, children }) {
  const sw = stroke || Math.max(5, Math.round(size / 9));
  const r = (size - sw) / 2, C = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value || 0));
  return (
    <span data-pk="" style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-flex" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface2)" strokeWidth={sw}/>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - v)} style={{ transition: "stroke-dashoffset .6s" }}/>
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
        fontSize: size * (String(children ?? "").length > 4 ? 0.17 : String(children ?? "").length > 3 ? 0.2 : 0.24),
        fontWeight: 900, color: "var(--text)", lineHeight: 1.05 }}>{children}</span>
    </span>
  );
}
// une jauge en demi-cercle ; sa hauteur : size / 2 + 32 au plus (avec sa legende)
const GAUGE_AR = 0.5, GAUGE_EXTRA = 32;
function Gauge({ value, max = 100, size = 74, color, label, sub }) {
  const sw = Math.max(6, Math.round(size / 10));
  const v = Math.max(0, Math.min(1, (value || 0) / max)), r = size / 2 - sw / 2 - 1, C = Math.PI * r;
  return (
    <div data-pk="" style={{ display: "flex", flexDirection: "column", alignItems: "center", width: size, flexShrink: 0 }}>
      <svg width={size} height={size / 2 + sw / 2 + 1} viewBox={`0 0 ${size} ${size / 2 + sw / 2 + 1}`} aria-hidden="true">
        <path d={`M${sw / 2 + 1} ${size / 2} A${r} ${r} 0 0 1 ${size - sw / 2 - 1} ${size / 2}`} fill="none" stroke="var(--surface2)" strokeWidth={sw} strokeLinecap="round"/>
        <path d={`M${sw / 2 + 1} ${size / 2} A${r} ${r} 0 0 1 ${size - sw / 2 - 1} ${size / 2}`} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - v)} style={{ transition: "stroke-dashoffset .6s" }}/>
      </svg>
      <span style={{ marginTop: -Math.round(size * 0.2), fontSize: Math.max(13, Math.round(size * 0.21)), fontWeight: 900, color: "var(--text)", lineHeight: 1.1 }}>{label}</span>
      {sub && <span style={{ fontSize: size > 110 ? 12.5 : 10.5, color: "var(--muted)", fontWeight: 700, whiteSpace: "nowrap", maxWidth: size + 20,
        overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>}
    </div>
  );
}
// des barres (une par valeur), « hi » en plein ; labels et valeurs si la place le permet
function Bars({ values, labels, color, height = 40, hi = -1, showValues = false, fmt = v => v, titles }) {
  const max = Math.max(1, ...values);
  const gap = values.length > 20 ? 2 : 4;
  return (
    <div style={{ display: "flex", gap, alignItems: "flex-end", height: height + (labels ? 15 : 0) + (showValues ? 14 : 0) }}>
      {values.map((v, i) => (
        <div key={i} title={titles?.[i]} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          {showValues && <span style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 700, whiteSpace: "nowrap" }}>{v ? fmt(v) : ""}</span>}
          <span data-pk="" style={{ width: "100%", maxWidth: 30, borderRadius: values.length > 20 ? 3 : 5, minHeight: 3,
            height: `${Math.max(3, Math.round(height * v / max))}px`, background: i === hi ? color : `${color}59` }}/>
          {labels && <span style={{ fontSize: 10, height: 13, color: i === hi ? "var(--text)" : "var(--muted)", fontWeight: i === hi ? 800 : 600,
            whiteSpace: "nowrap" }}>{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}
// une courbe remplie
function Spark({ values, color, height = 38 }) {
  if (!values?.length) return null;
  const max = Math.max(1, ...values), n = values.length;
  const pts = values.map((v, i) => `${(i / Math.max(1, n - 1)) * 100},${height - 3 - (v / max) * (height - 6)}`).join(" ");
  return (
    <svg data-pk="" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }} aria-hidden="true">
      <polyline points={`0,${height} ${pts} 100,${height}`} fill={`${color}26`} stroke="none"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
    </svg>
  );
}
// une bobine : sa couleur, et ce qu'il en reste en anneau
function SpoolDot({ color, pct, size = 34, title }) {
  const sw = Math.max(3, Math.round(size / 9));
  const r = size / 2 - sw / 2 - 1, C = 2 * Math.PI * r, v = Math.max(0, Math.min(1, pct ?? 1));
  return (
    <span data-pk="" title={title} style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-flex" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface2)" strokeWidth={sw}/>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={v < 0.15 ? "#ef4444" : v < 0.35 ? "#f59e0b" : "#22c55e"}
          strokeWidth={sw} strokeDasharray={C} strokeDashoffset={C * (1 - v)}/>
      </svg>
      <span style={{ position: "absolute", inset: sw + 3, borderRadius: "50%", background: hexCss(color), border: "1px solid rgba(0,0,0,0.15)" }}/>
    </span>
  );
}
const Delta = ({ now, before, unit = "", label = "hier" }) => {
  if (before == null || now == null) return null;
  const d = now - before;
  if (!d) return <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700 }}>= {label}</span>;
  const up = d > 0;
  return <span data-pk="" title={`par rapport à ${label}`} style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11.5, fontWeight: 800,
    color: up ? "#16a34a" : "#dc2626" }}>{up ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}{up ? "+" : ""}{unit ? fmtG(d) : d}</span>;
};
// aujourd'hui face a hier (ou ce mois face au precedent) : deux barres par mesure
function Versus({ rows, color, a = "aujourd'hui", b = "hier" }) {
  const { W } = useBox();
  const narrow = W < 240;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: narrow ? 5 : 7 }}>
      <div style={{ display: "flex", gap: 10, fontSize: 10.5, color: "var(--muted)", fontWeight: 700 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: color }}/>{a}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: "var(--border)" }}/>{b}</span>
      </div>
      {rows.map(([l, x, y, f]) => {
        const m = Math.max(1, x || 0, y || 0);
        const bars = <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <span data-pk="" style={{ height: 6, borderRadius: 4, background: color, width: `${(100 * (x || 0)) / m}%`, minWidth: 3 }}/>
          <span style={{ height: 6, borderRadius: 4, background: "var(--border)", width: `${(100 * (y || 0)) / m}%`, minWidth: 3 }}/></span>;
        const val = <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap" }}>{f(x)}
          <span style={{ color: "var(--muted)", fontWeight: 600 }}> / {f(y)}</span></span>;
        return narrow ? (
          <div key={l} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 11 }}>
              <span style={{ color: "var(--text2)", fontWeight: 700 }}>{l}</span>{val}</div>{bars}</div>
        ) : (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 84, flexShrink: 0, fontSize: 11.5, color: "var(--text2)", fontWeight: 700 }}>{l}</span>{bars}{val}</div>
        );
      })}
    </div>
  );
}
// des chiffres en petites cases (deux par rangee quand c'est etroit)
function Stats({ items }) {
  const { W } = useBox();
  const cols = Math.max(1, Math.min(items.length, Math.floor((W + 6) / 96)));
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6 }}>
    {items.map(([l, x, c]) => <div key={l} className="card-sm" style={{ padding: "6px 8px", minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</div>
      <div data-pk="" style={{ fontSize: 14.5, fontWeight: 900, color: c || "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x}</div></div>)}
  </div>;
}
const Chip = ({ children, color = "#64748B", title }) => <span data-pk="" title={title} style={{ display: "inline-flex", alignItems: "center", gap: 4,
  padding: "3px 9px", borderRadius: 20, fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap", color, background: `${color}1f` }}>{children}</span>;
const IcoNozzle = ({ s = 12 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
  strokeLinejoin="round" aria-hidden="true"><path d="M5 3h14v6h-3l-2 7h-4L8 9H5z"/><path d="M11 16h2l-1 4z" fill="currentColor"/></svg>;
const IcoBed = ({ s = 12 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
  strokeLinecap="round" aria-hidden="true"><rect x="3" y="12" width="18" height="5" rx="1"/><path d="M6 20v-3M18 20v-3M8 8c0-2 2-2 2-4M12 8c0-2 2-2 2-4"/></svg>;
const IcoChamber = ({ s = 12 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
  strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v18M12 8h5M12 12h5"/></svg>;

// ── Donnees ──────────────────────────────────────────────────────────────────
export function useTilesData() {
  const [d, setD] = useState({});
  useEffect(() => {
    let dead = false;
    const put = (k, p) => p.then(r => { if (!dead) setD(x => ({ ...x, [k]: r })); }).catch(() => { if (!dead) setD(x => ({ ...x, [k]: null })); });
    const get = (url, params) => client.get(url, { params }).then(r => r.data);
    const load = () => {
      const now = new Date(), t = ymd(now), y = new Date(now); y.setDate(now.getDate() - 1);
      put("today", Promise.all([get("/prints/kpis", { date_from: t }), get("/prints/kpis", { date_from: t, status: "SUCCESS" }),
        get("/prints/kpis", { date_from: ymd(y), date_to: ymd(y) })])
        .then(([all, ok, yd]) => ({ ...all, ok: ok.count, yesterday: yd })));
      put("prints", get("/prints", { limit: 16 }).then(r => (r.prints || r.items || []).filter(p => p.status !== "IN_PROGRESS")));
      put("spools", get("/filaments/spools", { archived: false }));
      put("dry", get("/filaments/drying/overview"));
      put("friends", get("/friends/shared/printing"));
      put("ach", get("/achievements"));
      const m0 = new Date(now.getFullYear(), now.getMonth(), 1), p0 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const pEnd = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), 28));
      put("month", Promise.all([get("/prints/kpis", { date_from: ymd(m0) }), get("/prints/kpis", { date_from: ymd(p0), date_to: ymd(pEnd) })])
        .then(([cur, prev]) => ({ ...cur, prev })));
      put("sales", get("/objects/objects/stats"));
      put("feed", get("/notify/me/history"));
      put("attention", get("/attention"));
    };
    load();
    put("queue", get("/makerworld/queue"));
    put("mw", get("/makerworld/creator"));
    put("rate", get("/makerworld/to-rate"));
    put("podium", get("/achievements/podium"));
    const iv = setInterval(load, 120000);
    return () => { dead = true; clearInterval(iv); };
  }, []);
  return d;
}
// une serie par jour (n jours jusqu'a aujourd'hui), chargee par la tuile qui la demande
function useDays(n) {
  const [v, setV] = useState(null);
  useEffect(() => {
    let dead = false;
    const now = new Date();
    const days = [...Array(n)].map((_, i) => { const x = new Date(now); x.setDate(now.getDate() - n + 1 + i); return x; });
    Promise.all(days.map(x => client.get("/prints/kpis", { params: { date_from: ymd(x), date_to: ymd(x) } }).then(r => r.data).catch(() => ({}))))
      .then(rs => { if (!dead) setV(rs.map((r, i) => ({ day: days[i], ...r }))); });
    return () => { dead = true; };
  }, [n]);
  return v;
}

// ── Les tuiles ───────────────────────────────────────────────────────────────
// une liste qui defile dans la tuile (option « Defiler ») : toute la liste, la molette ou le doigt
const Scroller = ({ children, gap = 6 }) => <div onWheel={e => e.stopPropagation()} style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain",
  display: "flex", flexDirection: "column", gap, marginRight: -6, paddingRight: 6 }}>{children}</div>;
const SCROLL = def => B("scroll", "Défiler dans la tuile", def, { hint: "Toute la liste dans la tuile, qu'on fait défiler au doigt ou à la molette." });
const rateColor = r => r == null ? "#94a3b8" : r >= 0.9 ? "#22c55e" : r >= 0.7 ? "#f59e0b" : "#ef4444";
// Aujourd'hui : un anneau de reussite, le compte, l'ecart avec hier ; en grand, face a hier
function Today({ v, o, sz }) {
  const rate = v?.count ? v.ok / v.count : null;
  const col = rateColor(rate);
  const sub = v && [o.weight && fmtG(v.weight_g), o.hours && `${fmtH(v.duration)} de machine`, o.cost && fmtEur(v.cost)].filter(Boolean).join(" · ");
  const hero = reserve => <Hero reserve={reserve} visual={o.ring && rate != null ? s => <Ring value={rate} size={s} color={col}>{Math.round(rate * 100)}%</Ring> : null}
    value={v ? v.count : "…"} unit={`impression${v?.count > 1 ? "s" : ""}`} sub={sub}
    delta={o.yesterday && v?.yesterday && <Delta now={v.count} before={v.yesterday.count}/>}/>;
  const versus = v?.yesterday && <Versus color="#3B82F6" rows={[["Impressions", v.count, v.yesterday.count, x => x || 0],
    ["Poids", v.weight_g, v.yesterday.weight_g, fmtG], ["Machine", v.duration, v.yesterday.duration, fmtH], ["Coût", v.cost, v.yesterday.cost, fmtEur]]}/>;
  return (
    <Tile icon={<CalendarClock size={15}/>} color="#3B82F6" label="Aujourd'hui" to="/prints"
      mini={sz.h === 0.5} summary={v ? <>{v.count}{rate != null && <span style={{ fontSize: 12, color: col }}>{Math.round(rate * 100)} %</span>}</> : "…"}
      zoom={<>{hero(0)}{versus && <><H2>Face à hier</H2>{versus}</>}</>}>
      {({ W, H }) => versus && H >= (W < 240 ? 250 : 165)
        ? <>{hero(W < 240 ? 150 : 110)}<div style={{ marginTop: 8 }}>{versus}</div></> : hero(0)}
    </Tile>
  );
}
// les n derniers jours en barres : heures, impressions ou grammes ; en grand, on change de periode et de mesure
const METRICS = { h: ["les heures", x => x.duration || 0, fmtH], n: ["les impressions", x => x.count || 0, x => `${x}`], g: ["les grammes", x => x.weight_g || 0, fmtG] };
const dayLabel = (n, x) => n <= 7 ? x.day.toLocaleDateString("fr-FR", { weekday: "narrow" }) : n <= 14 ? String(x.day.getDate())
  : (x.day.getDate() % 5 === 0 ? String(x.day.getDate()) : "");
function DaysChart({ v, n, metric, color, H, W, big }) {
  const [, val, fmt] = METRICS[metric] || METRICS.h;
  const today = ymd(new Date());
  const labels = H >= 60;
  const values = W / n >= (big ? 30 : 34) && H >= 100;
  const h = Math.max(12, H - (labels ? 15 : 0) - (values ? 14 : 0));
  return <Bars values={v.map(val)} labels={labels ? v.map(x => dayLabel(n, x)) : null} color={color} height={h}
    hi={v.findIndex(x => ymd(x.day) === today)} showValues={values} fmt={fmt}
    titles={v.map(x => `${x.day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} : ${fmt(val(x))}`)}/>;
}
function WeekZoom({ o }) {
  const [n, setN] = useState(o.range || 7);
  const [m, setM] = useState(o.metric || "h");
  const v = useDays(n);
  const { W, H } = useBox();
  const [, val, fmt] = METRICS[m];
  const tot = (v || []).reduce((a, x) => a + val(x), 0);
  const best = (v || []).reduce((b, x) => !b || val(x) > val(b) ? x : b, null);
  const active = (v || []).filter(x => val(x) > 0).length;
  const chip = on => ({ padding: "5px 11px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontWeight: 800, border: "none",
    background: on ? "#8B5CF6" : "var(--surface2)", color: on ? "#fff" : "var(--text2)" });
  return <>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {[7, 14, 30].map(k => <button key={k} style={chip(n === k)} onClick={() => setN(k)}>{k} jours</button>)}
      <span style={{ width: 8 }}/>
      {Object.entries(METRICS).map(([k, [l]]) => <button key={k} style={chip(m === k)} onClick={() => setM(k)}>{l}</button>)}
    </div>
    <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
      {[["Total", v ? fmt(tot) : "…"], ["Par jour", v ? fmt(m === "n" ? Math.round(tot / n * 10) / 10 : tot / n) : "…"],
        ["Meilleur jour", best && val(best) ? `${fmt(val(best))} · ${best.day.toLocaleDateString("fr-FR", n > 7 ? { day: "numeric", month: "short" } : { weekday: "short", day: "numeric" })}` : "—"],
        ["Jours actifs", v ? `${active} / ${n}` : "…"]].map(([l, x]) => (
        <div key={l}><Muted>{l}</Muted><div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)" }}>{x}</div></div>))}
    </div>
    {v && <div style={{ marginTop: "auto" }}><DaysChart v={v} n={n} metric={m} color="#8B5CF6" W={W} H={Math.max(140, H - 175)} big/></div>}
  </>;
}
function Week({ o, sz }) {
  const n = o.range || 7;
  const v = useDays(n);
  const [, val, fmt] = METRICS[o.metric] || METRICS.h;
  const tot = (v || []).reduce((a, x) => a + val(x), 0);
  return (
    <Tile icon={<BarChart3 size={15}/>} color="#8B5CF6" label={`${n} derniers jours`} to="/stats?tab=prints" zoom={<WeekZoom o={o}/>}
      mini={sz.h === 0.5} summary={v ? <>{fmt(tot)}<span style={{ width: 60, display: "inline-flex" }}><Spark values={v.map(val)} color="#8B5CF6" height={22}/></span></> : "…"}>
      {({ W, H }) => {
        const head = H >= 64;
        const best = (v || []).reduce((b, x) => !b || val(x) > val(b) ? x : b, null);
        const items = v && [["Par jour", fmt(o.metric === "n" ? Math.round(tot / n * 10) / 10 : tot / n)],
          ["Meilleur jour", best && val(best) ? best.day.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }) : "—"],
          ["Jours actifs", `${(v || []).filter(x => val(x) > 0).length} / ${n}`]];
        const statsH = items && H >= 260 ? (Math.ceil(items.length / Math.max(1, Math.min(3, Math.floor((W + 6) / 96)))) * 50) : 0;
        return <>
          {head && <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
            <span data-pk="" style={{ fontSize: H >= 200 ? 30 : 24, fontWeight: 900, color: "var(--text)", lineHeight: 1.05 }}>{v ? fmt(tot) : "…"}</span>
            {v && o.avg && W >= 150 && <Muted size={12}>· {fmt(o.metric === "n" ? Math.round(tot / n * 10) / 10 : tot / n)} / jour</Muted>}</div>}
          {statsH > 0 && <div style={{ marginTop: 8 }}><Stats items={items}/></div>}
          {v && <div style={{ marginTop: "auto" }}><DaysChart v={v} n={n} metric={o.metric} color="#8B5CF6" W={W} H={Math.min(220, H - (head ? 36 : 0) - (statsH ? statsH + 10 : 0))}/></div>}
        </>;
      }}
    </Tile>
  );
}
// a faire : autant de modeles que la place en tient (le premier en grand s'il y a la place)
const queueSub = (m, o) => <>{m.status === "ready" ? <span style={{ color: "#16a34a", fontWeight: 800 }}>● prêt</span> : <span>○ à préparer</span>}
  {m.seconds ? ` · ${fmtDur(m.seconds)}` : ""}{o.weight && m.weight_g ? ` · ${fmtG(m.weight_g)}` : ""}</>;
function Next({ q, o, sz }) {
  const nav = useNavigate();
  const models = (q?.models || []).filter(m => !o.ready || m.status === "ready");
  const ready = (q?.models || []).filter(m => m.status === "ready").length;
  const row = (m, size, card) => <Item key={m.design_id} img={o.thumbs || card ? (m.cover_url ? mwImg(m.cover_url, 320) : null) : undefined} size={size} card={card}
    title={m.title_fr || m.title} sub={queueSub(m, o)} onClick={() => nav("/prints?tab=queue")}/>;
  return (
    <Tile icon={<ListChecks size={15}/>} color="#22C55E" label="À faire" to="/prints?tab=queue"
      mini={sz.h === 0.5} summary={q ? <>{ready}<span style={{ fontSize: 12, color: "var(--muted)" }}>/ {q.models?.length || 0} prêts</span></> : "…"}
      badge={q?.models?.length ? <span style={{ fontSize: 11, fontWeight: 800, color: "#16a34a" }}>{ready}/{q.models.length}</span> : null}
      zoom={models.length ? <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{models.map(m => row(m, 56))}</div> : null}>
      {({ W, H }) => {
        if (!models.length) return <Empty>{q === undefined ? "…" : o.ready ? "Rien de prêt dans l'AMS" : "Rien dans « À faire »"}</Empty>;
        if (o.scroll) return <Scroller>{models.map((m, i) => row(m, i ? 34 : Math.min(52, H)))}</Scroller>;
        return fitList(models, row, W, H);
      }}
    </Tile>
  );
}
// le rappel « pas encore de photo » : seulement quand la tuile a la largeur
const PhotoHint = () => useBox().W >= 215 ? <Chip color="#0EA5E9" title="Pas encore de photo"><Camera size={12}/></Chip> : null;
// les dernieres impressions : la derniere en grand, puis la liste
const okOf = x => x.status === "SUCCESS" || x.status === "PARTIAL";
function Last({ p, o, sz }) {
  const nav = useNavigate();
  const list = p || [];
  if (!list.length) return null;
  const sub = x => [o.when && x.print_date && ago(x.print_date), x.duration_seconds && fmtDur(x.duration_seconds), x.total_weight_g && fmtG(x.total_weight_g),
    o.cost && x.total_cost && fmtEur(x.total_cost)].filter(Boolean).join(" · ");
  const row = (x, size, card) => <Item key={x.id} img={printImg(x.id)} dot={okOf(x) ? "#22c55e" : "#ef4444"} size={size} card={card}
    title={x.file_name || x.translated_name || `Impression #${x.id}`} sub={sub(x)} onClick={() => nav(`/prints?id=${x.id}`)}
    right={o.photo && !x.cover_photo && (size >= 44 || card) && <PhotoHint/>}/>;
  return (
    <Tile icon={<History size={15}/>} color="#0EA5E9" label="Dernières impressions" to="/prints"
      mini={sz.h === 0.5} summary={<span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis" }}>
        <span style={{ color: okOf(list[0]) ? "#22c55e" : "#ef4444" }}>● </span>{list[0].file_name || list[0].translated_name}</span>}
      zoom={<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{list.map(x => row(x, 56))}</div>}>
      {({ W, H }) => {
        if (o.scroll) return <Scroller>{list.map((x, i) => row(x, i ? 34 : Math.min(52, H)))}</Scroller>;
        return fitList(list, row, W, H);
      }}
    </Tile>
  );
}
// le stock : le total, et les bobines les plus basses (pastilles ou liste) qui remplissent la place
const spoolPct = x => x.filament_weight_g ? (x.remaining_weight_g || 0) / x.filament_weight_g : null;
const spoolName = x => x.filament_translated_name || x.filament_name || "Bobine";
function Stock({ s, o, sz }) {
  const list = Array.isArray(s) ? s : [];
  const kg = list.reduce((a, x) => a + (x.remaining_weight_g || 0), 0);
  const low = list.filter(x => x.remaining_weight_g != null)
    .sort((a, b) => o.sort === "pct" ? (spoolPct(a) ?? 1) - (spoolPct(b) ?? 1) : a.remaining_weight_g - b.remaining_weight_g);
  const line = x => <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text2)", minWidth: 0, height: 22 }}>
    <SpoolDot color={x.filament_color} pct={spoolPct(x)} size={20}/>
    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}><W text={spoolName(x)}/></span>
    <span data-pk="" style={{ fontWeight: 800, color: "#d97706" }}>{Math.round(x.remaining_weight_g)} g</span></div>;
  const head = <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
    <span data-pk="" style={{ fontSize: 24, fontWeight: 900, color: "var(--text)", lineHeight: 1.05 }}>{s === undefined ? "…" : list.length}</span>
    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>bobines{o.kg ? ` · ${fmtG(kg)}` : ""}</span></div>;
  return (
    <Tile icon={<Package size={15}/>} color="#F59E0B" label="Stock" to="/filaments"
      mini={sz.h === 0.5} summary={<>{list.length}<span style={{ display: "inline-flex", gap: 2 }}>{low.slice(0, 3).map(x => <SpoolDot key={x.id} color={x.filament_color} pct={spoolPct(x)} size={22}/>)}</span></>}
      zoom={<>{head}<H2>Les plus basses</H2><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "6px 18px" }}>
        {low.slice(0, 40).map(line)}</div></>}>
      {({ W, H }) => {
        const rest = H - 34;
        if (rest < 20) return head;
        if (o.style === "list") return <>{head}<div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>{low.slice(0, fitRows(rest, 22, 5)).map(line)}</div></>;
        // les pastilles grandissent pour remplir la case ; trop nombreuses, seules les plus basses qui tiennent
        let g = fitGrid(low.length, W, rest, { gap: 6, max: 56 });
        if (g.size < 26) { const f = fillGrid(W, rest, 26, 6); g = { cols: f.cols, size: Math.min(f.size, Math.max(20, rest - 2)), n: f.n }; }
        return <>{head}<div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, ${g.size}px)`, gap: 6, flex: 1, alignContent: "center",
          justifyContent: "space-evenly", marginTop: 4 }}>
          {low.slice(0, g.n || low.length).map(x => <SpoolDot key={x.id} color={x.filament_color} pct={spoolPct(x)} size={g.size}
            title={`${spoolName(x)} · ${Math.round(x.remaining_weight_g)} g`}/>)}</div></>;
      }}
    </Tile>
  );
}
// le sechage : un anneau par AMS qui seche, sinon ce qui est a secher
const amsLab = a => a.id >= 128 ? `HT-${String.fromCharCode(65 + a.id - 128)}` : `AMS-${String.fromCharCode(65 + a.id)}`;
function Dry({ v, status, o, sz }) {
  const drying = (status?.ams_list || []).filter(a => a.is_drying && a.dry_time > 0);
  const k = v?.kpis;
  const todo = v?.to_dry || [];
  const line = x => <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)", height: 18 }}>
    <span data-pk="" style={{ width: 10, height: 10, borderRadius: "50%", background: hexCss(x.color), flexShrink: 0 }}/>
    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</span>
    <span style={{ fontWeight: 800, color: "#dc2626" }}>{x.age_days != null ? `${x.age_days} j` : "jamais"}</span></div>;
  const rings = size => <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>{drying.map(a => {
    const tot = (a.dry_duration || 0) * 60, left = a.dry_time || 0;
    return <div key={a.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <Ring value={tot ? 1 - left / tot : 0.5} size={size} color="#ef4444">{a.dry_temperature ? `${a.dry_temperature}°` : ""}</Ring>
      <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text)" }}>{amsLab(a)}</span>
      <Muted size={11}>encore {fmtDur(left)}</Muted></div>;
  })}</div>;
  const hero = <Hero visual={o.ring && k?.active ? s => <Ring value={(k.ok || 0) / k.active} size={s} color="#22c55e">{Math.round(100 * (k.ok || 0) / k.active)}%</Ring> : null}
    value={v ? k?.to_dry ?? 0 : "…"} unit="à sécher" color={k?.to_dry ? "#dc2626" : "var(--text)"}
    sub={k && `${k.soon ? `${k.soon} bientôt · ` : ""}${k.ok || 0} au sec${o.inams && k.to_dry_in_ams ? ` · ${k.to_dry_in_ams} dans l'AMS` : ""}`}/>;
  return (
    <Tile icon={<Flame size={15}/>} color="#EF4444" label="Séchage" to="/stats?tab=drying"
      mini={sz.h === 0.5} summary={drying.length ? <span style={{ fontSize: 13, color: "#ef4444" }}>{drying.length} en cours · {fmtDur(drying[0].dry_time)}</span>
        : <span style={{ color: k?.to_dry ? "#dc2626" : "var(--text)" }}>{k?.to_dry ?? "…"} <span style={{ fontSize: 12, color: "var(--muted)" }}>à sécher</span></span>}
      zoom={<>{drying.length > 0 && <><H2>En cours</H2>{rings(110)}</>}<BoxCtx.Provider value={{ W: 600, H: 120, zoom: true }}>{hero}</BoxCtx.Provider>
        {todo.length > 0 && <><H2>À sécher</H2><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "6px 18px" }}>{todo.map(line)}</div></>}</>}>
      {({ W, H }) => {
        if (drying.length) {
          const g = fitGrid(drying.length, W, H, { ar: 1, extra: 34, max: 120 });
          return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>{rings(Math.max(36, g.size))}</div>;
        }
        // l'anneau prend ce que la liste « a secher » laisse (rien de liste quand c'est bas)
        const listH = H < 120 || !todo.length ? 0 : Math.min(Math.round(H * 0.5), todo.length * 23 + 28);
        const hh = H - listH;
        return <>
          <BoxCtx.Provider value={{ W, H: hh }}>{hero}</BoxCtx.Provider>
          {listH > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 5, borderTop: "1px solid var(--border)", paddingTop: 6 }}>
            <H2>À sécher</H2>{todo.slice(0, fitRows(listH - 24, 18, 5)).map(line)}</div>}
        </>;
      }}
    </Tile>
  );
}
// l'humidite : des jauges (qui remplissent la case) ou des barres, avec ses seuils
function Humidity({ status, o, sz }) {
  const list = (status?.ams_list || []).filter(a => a.humidity > 0 && a.id !== 255 && a.id !== 254);
  if (!list.length) return null;
  const [lo, hi] = o.thr === "strict" ? [20, 30] : o.thr === "loose" ? [40, 55] : [30, 40];
  const col = h => h < lo ? "#22c55e" : h < hi ? "#f59e0b" : "#ef4444";
  const gauges = (W, H) => {
    const g = fitGrid(list.length, W, H, { ar: GAUGE_AR, extra: GAUGE_EXTRA, max: 170, gap: 8 });
    return <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${g.cols}, auto)`, justifyContent: "space-evenly", alignContent: "center", gap: 8 }}>
      {list.map(a => <Gauge key={a.id} value={a.humidity} color={col(a.humidity)} size={Math.max(40, g.size)} label={`${a.humidity}%`}
        sub={`${amsLab(a)}${o.temp && a.temp ? ` · ${Math.round(a.temp)}°` : ""}`}/>)}</div>;
  };
  const bars = H => <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-evenly", flex: 1, gap: 4 }}>
    {list.map(a => (
      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, minHeight: 0 }}>
        <span style={{ width: 46, flexShrink: 0, whiteSpace: "nowrap", color: "var(--text2)", fontWeight: 700 }}>{amsLab(a)}</span>
        <span style={{ flex: 1, height: Math.max(5, Math.min(12, H / list.length / 3)), borderRadius: 7, background: "var(--surface2)", overflow: "hidden" }}>
          <span data-pk="" style={{ display: "block", height: "100%", width: `${Math.min(100, a.humidity)}%`, background: col(a.humidity), borderRadius: 7 }}/></span>
        <span data-pk="" style={{ width: 36, textAlign: "right", fontWeight: 800, color: col(a.humidity) }}>{a.humidity}%</span>
        {o.temp && a.temp > 0 && <span style={{ width: 30, textAlign: "right", color: "var(--muted)" }}>{Math.round(a.temp)}°</span>}
      </div>))}</div>;
  // tres bas : une barre verticale par AMS, le pourcentage dessus, le nom dessous
  const columns = W => { const cw = (W - 6 * (list.length - 1)) / list.length, fs = Math.max(9.5, Math.min(12.5, cw / 2.6));
    return <div style={{ flex: 1, display: "flex", gap: 6, minHeight: 0 }}>
    {list.map(a => <div key={a.id} title={amsLab(a)} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span data-pk="" style={{ fontSize: fs, fontWeight: 900, color: col(a.humidity), lineHeight: 1.1, whiteSpace: "nowrap" }}>{a.humidity}{cw >= 30 ? "%" : ""}</span>
      <span style={{ flex: 1, minHeight: 8, width: 12, borderRadius: 6, background: "var(--surface2)", position: "relative", overflow: "hidden" }}>
        <span data-pk="" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${Math.min(100, a.humidity)}%`, background: col(a.humidity) }}/></span>
      <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", lineHeight: 1.1, whiteSpace: "nowrap" }}>{a.id >= 128 ? (cw >= 34 ? amsLab(a) : "HT") : amsLab(a).slice(4)}</span>
    </div>)}</div>; };
  return (
    <Tile icon={<Droplets size={15}/>} color="#06B6D4" label="Humidité des AMS" to="/stats?tab=drying"
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 8 }}>{list.map(a => <span key={a.id} style={{ color: col(a.humidity) }}>{a.humidity}%</span>)}</span>}
      zoom={<>{gauges(700, 330)}<Muted>Seuils : sec sous {lo} %, à surveiller jusqu'à {hi} %, humide au-delà.</Muted></>}>
      {({ W, H }) => {
        const fitsBars = H >= list.length * 19;
        if (o.style === "bars") return fitsBars ? bars(H) : columns(W);
        return fitGrid(list.length, W, H, { ar: GAUGE_AR, extra: GAUGE_EXTRA, gap: 8 }).size >= 46 ? gauges(W, H) : fitsBars ? bars(H) : columns(W);
      }}
    </Tile>
  );
}
// les copains : qui imprime (vignette, avancement), autant que la place en tient
function Friends({ f, o, sz }) {
  const p = f?.printing || [];
  const states = f?.states || {};
  const n = Object.keys(states).length;
  if (!f || !n) return null;
  const row = (x, big) => (
    <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, height: big ? 48 : 36 }}>
      {o.thumbs && x.print?.image ? <img data-pk="" src={x.print.image} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
        style={{ width: big ? 44 : 32, height: big ? 44 : 32, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: "var(--surface2)" }}/>
        : <span data-pk="" style={{ width: big ? 40 : 28, height: big ? 40 : 28, borderRadius: "50%", background: "#14B8A6", color: "#fff", fontSize: 12, fontWeight: 900,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{(x.name || "?").slice(0, 1).toUpperCase()}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <b data-pk="" style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</b>
          <span data-pk="" style={{ fontSize: 11.5, fontWeight: 800, color: "#0d9488" }}>{Math.round(x.progress || 0)} %</span></div>
        <div style={{ height: 4, borderRadius: 4, background: "var(--surface2)", overflow: "hidden", margin: "2px 0" }}>
          <div data-pk="" style={{ height: "100%", width: `${Math.round(x.progress || 0)}%`, background: "#14B8A6" }}/></div>
        <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><W text={x.print?.name || x.print_name || "imprime"}/></div>
      </div>
    </div>
  );
  // avec de la place : une grande ligne par copain, l'avancement en anneau
  const ringRow = (x, size) => (
    <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <Ring value={(x.progress || 0) / 100} size={size} color="#14B8A6">{Math.round(x.progress || 0)}%</Ring>
      {o.thumbs && x.print?.image && <img data-pk="" src={x.print.image} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
        style={{ width: size, height: size, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}/>}
      <div style={{ minWidth: 0 }}>
        <div data-pk="" style={{ fontSize: 14, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", ...clamp(2) }}><W text={x.print?.name || x.print_name || "imprime"}/></div></div>
    </div>);
  const idle = o.idle && Object.values(states).some(s => s.state !== "printing") && (
    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
      {Object.values(states).filter(s => s.state === "standby").length} au repos · {Object.values(states).filter(s => s.state === "off").length} éteinte(s)</div>);
  return (
    <Tile icon={<Users size={15}/>} color="#14B8A6" label="Copains" to="/stats?tab=friends" badge={<span style={{ fontSize: 11, fontWeight: 800, color: "#0d9488" }}>{p.length}/{n}</span>}
      mini={sz.h === 0.5} summary={<span style={{ fontSize: 13 }}>{p.length ? `${p.map(x => x.name).join(", ")} imprime${p.length > 1 ? "nt" : ""}` : "personne n'imprime"}</span>}
      zoom={<>{p.length ? p.map(x => ringRow(x, 64)) : <Line>Personne n'imprime en ce moment.</Line>}{idle}</>}>
      {({ H }) => {
        const room = H - (idle && H >= 90 ? 22 : 0), each = (room - 8 * (p.length - 1)) / Math.max(1, p.length);
        // large et bas : les copains cote a cote, un anneau chacun, le nom dessous
        if (p.length > 1 && !o.scroll && W >= 240 && H < 110) {
          const g = fitGrid(p.length, W, H, { extra: 16, gap: 8, max: 64 });
          if (g.rows === 1 && g.size >= 34) return <div style={{ flex: 1, display: "flex", justifyContent: "space-evenly", alignItems: "center" }}>
            {p.map(x => <div key={x.id} title={x.print?.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 }}>
              <Ring value={(x.progress || 0) / 100} size={g.size} color="#14B8A6">{Math.round(x.progress || 0)}%</Ring>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text)", maxWidth: g.size + 30, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</span></div>)}</div>;
        }
        if (p.length && !o.scroll && each >= 52) return <><div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {p.map(x => ringRow(x, Math.min(64, Math.floor(each))))}</div>{H >= 90 && <div style={{ marginTop: "auto" }}>{idle}</div>}</>;
        return !p.length ? <><Empty>Personne n'imprime en ce moment</Empty>{H >= 80 && idle}</> : o.scroll ? <><Scroller gap={4}>{p.map(x => row(x))}</Scroller>{H >= 90 && idle}</> : <>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{p.slice(0, fitRows(H - (idle && H >= 90 ? 18 : 0), 36, 4)).map(x => row(x))}</div>
        {H >= 90 && <div style={{ marginTop: "auto" }}>{idle}</div>}</>;
      }}
    </Tile>
  );
}
// les points MakerWorld : le solde, les gains, la courbe (en grand : 30 jours en barres)
function useMwHist(on, days) {
  const [hist, setHist] = useState(null);
  useEffect(() => {
    if (!on) return;
    client.get("/makerworld/creator/points").then(({ data }) => {
      const out = Array(days).fill(0), now = Date.now();
      (data?.items || []).forEach(x => {
        const d = Math.floor((now - new Date(x.time).getTime()) / 86400000);
        if (d >= 0 && d < days) out[days - 1 - d] += Number(x.point ?? x.points ?? x.amount ?? 0) || 0;
      });
      setHist(out);
    }).catch(() => setHist(null));
  }, [on, days]);
  return hist;
}
const MW_STATS = head => [["⬇️", head?.downloads, "téléch."], ["🖨️", head?.prints, "impr."], ["🚀", head?.boosts, "boosts"], ["❤️", head?.likes, "j'aime"]];
function MwZoom({ c }) {
  const hist = useMwHist(true, 30);
  const { W } = useBox();
  const days = [...Array(30)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 29 + i); return d; });
  return <>
    <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
      <div><Muted>Solde</Muted><div style={{ fontSize: 28, fontWeight: 900, color: "var(--text)" }}>{Math.round(c.profile.points?.total || 0)}</div></div>
      {["7", "30", "365"].map(p => { const e = c.earned?.[p] ?? (p === "7" ? c.earned7 : p === "30" ? c.earned30 : null);
        return e != null && <div key={p}><Muted>{p === "365" ? "Sur un an" : `Sur ${p} jours`}</Muted>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#16a34a" }}>+{Math.round(e)}</div></div>; })}
    </div>
    <H2>Points gagnés, 30 jours</H2>
    {hist ? <Bars values={hist} color="#EAB308" height={180} hi={29} showValues={W / 30 >= 22} labels={days.map(d => d.getDate() % 5 === 0 ? String(d.getDate()) : "")}
      titles={days.map((d, i) => `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} : +${hist[i]}`)}/> : <Muted>…</Muted>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
      {MW_STATS(c.head?.["30"]?.totals || c.head?.["7"]?.totals).map(([e, n, l]) => <div key={l} className="card-sm" style={{ textAlign: "center", padding: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{e} {n ?? 0}</div><Muted>{l} (30 j)</Muted></div>)}
    </div>
  </>;
}
function MwPoints({ c, o, sz }) {
  const hist = useMwHist(o.chart && !!c?.profile, 14);
  if (!c?.profile) return null;
  const per = o.period || "7";
  const earned = c.earned?.[per] ?? (per === "7" ? c.earned7 : c.earned30);
  const head = c.head?.[per]?.totals;
  return (
    <Tile icon={<Coins size={15}/>} color="#EAB308" label="MakerWorld" to="/prints?tab=makerworld" zoom={<MwZoom c={c}/>}
      mini={sz.h === 0.5} summary={<>{Math.round(c.profile.points?.total || 0)}{earned != null && <span style={{ fontSize: 12, color: "#16a34a" }}>+{Math.round(earned)}</span>}</>}>
      {({ W, H }) => {
        const stats = o.stats && head && H >= 120;
        const chartH = H - 36 - (stats ? 40 : 0);
        return <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
            <span data-pk="" style={{ fontSize: 24, fontWeight: 900, color: "var(--text)", lineHeight: 1.05 }}>{Math.round(c.profile.points?.total || 0)}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>points</span>
            {earned != null && <span data-pk="" style={{ fontSize: 12, fontWeight: 800, color: "#16a34a" }}>+{Math.round(earned)}{W >= 170 ? ` en ${per} j` : ""}</span>}</div>
          {o.chart && hist && chartH >= 18 && (hist.some(Boolean) ? <div style={{ marginTop: "auto" }}><Spark values={hist} color="#EAB308" height={Math.min(chartH, 320)}/></div>
            : chartH >= 30 && <Empty>Pas de points ces 14 jours</Empty>)}
          {stats && <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginTop: o.chart && hist ? 6 : "auto" }}>
            {MW_STATS(head).map(([e, n, l]) => <div key={l} data-pk="" style={{ textAlign: "center", minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" }}>{W >= 200 ? `${e} ` : ""}{n ?? 0}</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>{l}</div></div>)}</div>}
        </>;
      }}
    </Tile>
  );
}
// a evaluer : le nombre, et les vignettes qui remplissent la place
function ToRate({ r, o, sz }) {
  const items = r?.items || [];
  if (!r) return null;
  const thumb = (x, s) => x.cover_url ? <img key={x.design_id} data-pk="" src={mwImg(x.cover_url, s * 2)} alt="" title={x.title}
    style={{ width: s, height: s, borderRadius: Math.round(s / 4), objectFit: "cover", display: "block" }}/>
    : <span key={x.design_id} style={{ width: s, height: s, borderRadius: Math.round(s / 4), background: "var(--surface2)", display: "block" }}/>;
  const head = <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
    <span data-pk="" style={{ fontSize: 24, fontWeight: 900, color: items.length ? "#ea580c" : "var(--text)", lineHeight: 1.05 }}>{items.length}</span>
    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>modèle{items.length > 1 ? "s" : ""}</span></div>;
  return (
    <Tile icon={<Star size={15}/>} color="#F97316" label="À évaluer" to="/prints?tab=makerworld"
      mini={sz.h === 0.5} summary={<span style={{ color: items.length ? "#ea580c" : "var(--text)" }}>{items.length}</span>}
      zoom={items.length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
        {items.map(x => <div key={x.design_id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {x.cover_url && <img src={mwImg(x.cover_url, 300)} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 12 }}/>}
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", ...clamp(2) }}>{x.title || `Modèle ${x.design_id}`}</span></div>)}</div> : null}>
      {({ W, H }) => {
        if (!items.length) return <>{head}<Empty>Tout est évalué</Empty></>;
        const rest = H - 34;
        if (!o.thumbs || rest < 24) return head;
        let g = fitGrid(items.length, W, rest, { gap: 6, max: 110 });
        if (g.size < 28) { const f = fillGrid(W, rest, 28, 6); g = { cols: f.cols, size: Math.min(f.size, Math.max(22, rest - 2)), n: f.n }; }
        return <>{head}<div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, ${g.size}px)`, gap: 6, flex: 1, alignContent: "center",
          justifyContent: "space-evenly", marginTop: 4 }}>
          {items.slice(0, g.n || items.length).map(x => thumb(x, g.size))}</div></>;
      }}
    </Tile>
  );
}
// une roue de fete en dessin : huit parts, un moyeu, le repere en haut ; elle tourne doucement s'il reste des tours
const WHEEL_COLORS = ["#EF4444", "#F59E0B", "#EAB308", "#22C55E", "#06B6D4", "#3B82F6", "#8B5CF6", "#EC4899"];
function WheelArt({ size, spin }) {
  const r = size / 2 - 4, c = size / 2;
  const part = i => { const a0 = (i / 8) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / 8) * 2 * Math.PI - Math.PI / 2;
    return `M${c} ${c} L${c + r * Math.cos(a0)} ${c + r * Math.sin(a0)} A${r} ${r} 0 0 1 ${c + r * Math.cos(a1)} ${c + r * Math.sin(a1)} Z`; };
  return (
    <span data-pk="" style={{ position: "relative", width: size, height: size + 8, display: "inline-flex", flexShrink: 0 }}>
      <style>{`@keyframes bn-wheel { to { transform: rotate(360deg) } }`}</style>
      <svg width={size} height={size} style={{ marginTop: 8, animation: spin ? "bn-wheel 24s linear infinite" : "none", filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.25))" }} aria-hidden="true">
        {WHEEL_COLORS.map((col, i) => <path key={i} d={part(i)} fill={col} stroke="rgba(255,255,255,0.85)" strokeWidth={Math.max(1.5, size / 80)}/>)}
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={Math.max(2, size / 40)}/>
        <circle cx={c} cy={c} r={size / 9} fill="#fff" stroke="rgba(0,0,0,0.12)"/>
      </svg>
      <svg width={size / 6} height={size / 6} viewBox="0 0 10 10" style={{ position: "absolute", left: size / 2 - size / 12, top: 0 }} aria-hidden="true">
        <path d="M5 10 L0 0 L10 0 Z" fill="#fff" stroke="rgba(0,0,0,0.25)" strokeWidth="0.8"/></svg>
    </span>
  );
}
// la roue : tours, cles et tickets ; le bouton pour tourner
function Wheel({ a, o, sz = { h: 1 } }) {
  const nav = useNavigate();
  const k = a?.keys;
  if (!k) return null;
  const spins = k.wheel?.spins || 0, tickets = k.wheel?.tickets || 0;
  const cells = [[<Dices key="d" size={15}/>, spins, `tour${spins > 1 ? "s" : ""}`, "var(--text)"],
    ...(o.keys ? [[<Key key="k" size={15}/>, k.balance, `clé${k.balance > 1 ? "s" : ""}`, "#d97706"]] : []),
    ...(o.tickets ? [[<Ticket key="t" size={15}/>, tickets, `ticket${tickets > 1 ? "s" : ""}`, "#db2777"]] : [])];
  const go = e => { e?.stopPropagation(); nav("/stats?tab=achievements"); };
  const btn = full => <button onClick={go} data-pk="" style={{ flexShrink: 0, padding: "8px 12px", borderRadius: 10, border: "none", fontWeight: 900, fontSize: 12.5,
    cursor: "pointer", color: "#3b2300", width: full ? "100%" : undefined, background: spins ? "linear-gradient(135deg, #FDE68A, #F59E0B)" : "var(--surface2)" }}>
    {spins ? "Tourner" : "Voir"}</button>;
  return (
    <Tile icon={<Dices size={15}/>} color="#EC4899" label="Roue et clés" onClick={() => nav("/stats?tab=achievements")}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 10, fontSize: 14 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Dices size={13}/>{spins}</span>
        {o.keys && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#d97706" }}><Key size={13}/>{k.balance}</span>}
        {o.tickets && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#db2777" }}><Ticket size={13}/>{tickets}</span>}</span>}>
      {({ W, H }) => {
        const wide = W >= 240, big = H >= 150;
        const fs = big ? 30 : 19;
        const row = <div style={{ display: "flex", alignItems: "center", justifyContent: wide ? "flex-start" : "space-around", gap: 10, flex: wide ? 1 : undefined }}>
          {cells.map(([ic, n, l, c]) => <div key={l} data-pk="" style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: fs, fontWeight: 900, color: c, lineHeight: 1.1 }}>{ic}{n}</span>
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{l}</span></div>)}</div>;
        // de la place : la roue en dessin, a gauche (large) ou au-dessus (etroit)
        const art = wide ? Math.min(H - 12, W * 0.42, 200) : Math.min(W - 8, H - 110, 220);
        if (art >= 80) return wide
          ? <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 14 }}><WheelArt size={art} spin={spins > 0}/>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>{row}{btn(true)}</div></div>
          : <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "center" }}><WheelArt size={art} spin={spins > 0}/></div>{row}{btn(true)}</div>;
        if (wide) return <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>{row}{btn(false)}</div>;
        return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>{row}{H >= 84 && btn(true)}</div>;
      }}
    </Tile>
  );
}
// les succes : le grade, les prochaines cartes, les dernieres medailles
function Ach({ a, o, sz }) {
  const nav = useNavigate();
  const v = a?.score_max ? a.score / a.score_max : 0;
  const g = gradeOf(null, v);
  const nexts = useMemo(() => (a?.items || []).filter(x => x.cat === "cards" && x.level < 0 && x.prog?.[1])
    .sort((x, y) => y.prog[0] / y.prog[1] - x.prog[0] / x.prog[1] || CARD_ORDER.indexOf(x.tiers[0].id) - CARD_ORDER.indexOf(y.tiers[0].id)), [a]);
  const recent = (a?.recent || []).map(r => ({ r, it: (a.items || []).find(x => x.id === r.id) })).filter(x => x.it);
  if (!a) return null;
  const grade = size => <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
    <span data-pk=""><GradeEmblem i={Math.max(0, g.i)} size={size} locked={g.i < 0}/></span>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: size > 40 ? 18 : 14, fontWeight: 900, color: "var(--text)", ...clamp(2), lineHeight: 1.15 }}>
        <W text={g.name || "Pas encore de grade"}/></div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {a.score.toLocaleString("fr-FR")} pts{g.next ? ` · prochain : ${g.next}` : ""}</div></div>
    {o.score && size > 30 && <span style={{ marginLeft: "auto" }}><Ring value={v} size={size + 6} color="#D4A017">{Math.round(v * 100)}%</Ring></span>}
  </div>;
  const card = nx => <div key={nx.id} onClick={e => { e.stopPropagation(); nav(`/stats?tab=achievements&a=${nx.id}`); }}
    style={{ display: "flex", alignItems: "center", gap: 8, height: 32, cursor: "pointer" }}>
    <span data-pk=""><Medal tier={nx.tiers[0]} emoji={nx.emoji} size={28} locked/></span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><W text={nx.name}/></div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
        <div style={{ flex: 1, height: 5, borderRadius: 5, background: "var(--surface2)", overflow: "hidden" }}>
          <div data-pk="" style={{ height: "100%", width: `${Math.round(100 * nx.prog[0] / nx.prog[1])}%`, background: nx.tiers[0].color }}/></div>
        <span data-pk="" style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap" }}>{nx.prog[0]}/{nx.prog[1]}</span></div></div></div>;
  const medals = (list, size) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{list.map(({ r, it }) =>
    <span key={it.id + r.tier} title={it.name} onClick={e => { e.stopPropagation(); nav(`/stats?tab=achievements&a=${it.id}`); }}>
      <Medal tier={it.tiers[r.tier]} emoji={it.emoji} size={size}/></span>)}</div>;
  return (
    <Tile icon={<Trophy size={15}/>} color="#D4A017" label="Succès" to="/stats?tab=achievements"
      mini={sz.h === 0.5} summary={<><GradeEmblem i={Math.max(0, g.i)} size={20} locked={g.i < 0}/><span style={{ fontSize: 13 }}>{g.name || "—"}</span></>}
      zoom={<>{grade(56)}{nexts.length > 0 && <><H2>Prochaines cartes</H2><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: "8px 18px" }}>{nexts.slice(0, 12).map(card)}</div></>}{recent.length > 0 && <><H2>Dernières médailles</H2>{medals(recent.slice(0, 20), 44)}</>}</>}>
      {({ W, H }) => {
        const gs = H >= 150 && W >= 200 ? 44 : 34;
        let room = H - (o.grade ? gs + 8 : 0);
        const ms = 30;
        const showMedals = o.recent && recent.length && room >= ms + 40;
        if (showMedals) room -= ms + 8;
        const nCards = o.cards ? Math.max(0, Math.floor((room + 6) / 38)) : 0;
        const perRow = Math.max(1, Math.floor((W + 6) / (ms + 6)));
        return <>
          {o.grade && grade(gs)}
          {nexts.slice(0, nCards).map(card)}
          {showMedals && <div style={{ marginTop: "auto" }}>{medals(recent.slice(0, perRow), ms)}</div>}
        </>;
      }}
    </Tile>
  );
}
// la camera : l'image remplit la tuile (un clic l'ouvre en grand)
function LiveCam({ status, o, sz = { h: 2 } }) {
  const on = !!status?.connected;
  const pct = Math.round(status?.progress || 0);
  const live = isLive(status);
  return (
    <Tile icon={<Video size={15}/>} color="#64748B" label="Caméra"
      mini={sz.h === 0.5} summary={!on ? <span style={{ fontSize: 12.5, color: "var(--muted)" }}>hors ligne</span>
        : <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: live ? "#ef4444" : "#94a3b8" }}/>
          {live ? `${pct} %${status.remaining_minutes ? ` · ${fmtDur(status.remaining_minutes * 60)}` : ""}` : "au repos"}</span>}>
      {({ W, H }) => {
        if (!on) return <Empty>L'imprimante ne répond pas.</Empty>;
        // haute et etroite : l'image entiere en haut, l'avancement dessous
        const imgH = Math.round(W * 9 / 16);
        if (H - imgH >= 90) return <>
          <div style={{ borderRadius: 10, overflow: "hidden", height: imgH, flexShrink: 0, background: "#111" }}><LiveCamera mode={o.mode} style={{ height: "100%" }}/></div>
          <BoxCtx.Provider value={{ W, H: H - imgH - 6 }}>{live ? <Hero visual={s => <Ring value={pct / 100} size={s} color="#22c55e">{pct}%</Ring>}
            value={status.remaining_minutes ? fmtDur(status.remaining_minutes * 60) : "bientôt"} unit="restantes"
            sub={[status.remaining_minutes && `fin à ${finAt(status.remaining_minutes)}`, status.total_layers > 0 && `couche ${status.layer} / ${status.total_layers}`].filter(Boolean).join(" · ")}/>
            : <Empty>Au repos</Empty>}</BoxCtx.Provider></>;
        return (
        <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", flex: 1, minHeight: 0, background: "#111" }}>
          <LiveCamera mode={o.mode} style={{ height: "100%" }}/>
          {o.overlay && live && <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "14px 10px 6px", color: "#fff", pointerEvents: "none",
            background: "linear-gradient(transparent, rgba(0,0,0,0.65))", display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}>
            <span style={{ flex: 1, height: 5, borderRadius: 5, background: "rgba(255,255,255,0.3)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${pct}%`, background: "#22c55e" }}/></span>
            {pct}%{status.remaining_minutes ? ` · ${fmtDur(status.remaining_minutes * 60)}` : ""}</div>}
        </div>);
      }}
    </Tile>
  );
}
// les temperatures : jauges (consigne = plein) qui remplissent la case, ou lignes
const tempRows = (status, o) => {
  const nz = status.nozzles || [];
  return [
    ...nz.map(n => ({ k: `n${n.id}`, ico: IcoNozzle, l: nz.length > 1 ? `Buse ${n.id === 1 ? "G" : "D"}` : "Buse", v: n.temp, t: n.target, max: 300, c: "#f97316" })),
    ...(!nz.length && status.nozzle_temp != null ? [{ k: "n", ico: IcoNozzle, l: "Buse", v: status.nozzle_temp, t: status.target_nozzle_temp, max: 300, c: "#f97316" }] : []),
    { k: "bed", ico: IcoBed, l: "Plateau", v: status.bed_temp, t: status.target_bed_temp, max: 120, c: "#ef4444" },
    ...(o.chamber && status.chamber_temp > 0 ? [{ k: "ch", ico: IcoChamber, l: "Chambre", v: status.chamber_temp, t: status.target_chamber_temp, max: 70, c: "#eab308" }] : []),
  ];
};
function Temps({ status, o, sz }) {
  if (!status?.connected) return null;
  const rows = tempRows(status, o);
  const hot = r => (r.v || 0) > 40;
  const gauges = (W, H) => {
    const g = fitGrid(rows.length, W, H, { ar: GAUGE_AR, extra: GAUGE_EXTRA, max: 180, gap: 8 });
    return <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${g.cols}, auto)`, justifyContent: "space-evenly", alignContent: "center", gap: 8 }}>
      {rows.map(r => <Gauge key={r.k} value={r.v} max={r.t > 0 ? r.t : r.max} color={hot(r) ? r.c : "#94a3b8"} size={Math.max(40, g.size)}
        label={`${Math.round(r.v || 0)}°`} sub={`${r.l}${o.targets && r.t > 0 ? ` / ${Math.round(r.t)}°` : ""}`}/>)}</div>;
  };
  const lines = <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-evenly", gap: 2 }}>
    {rows.map(r => (
      <div key={r.k} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
        <span style={{ color: hot(r) ? r.c : "var(--muted)", display: "inline-flex" }}><r.ico s={14}/></span>
        <span style={{ flex: 1, minWidth: 0, color: "var(--text2)", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.l}</span>
        <span data-pk="" style={{ fontSize: 16, fontWeight: 900, color: hot(r) ? r.c : "var(--text)" }}>{Math.round(r.v || 0)}°</span>
        {o.targets && r.t > 0 && <span style={{ color: "var(--muted)", fontWeight: 700 }}>/ {Math.round(r.t)}°</span>}
      </div>))}</div>;
  const cells = (W, H) => {
    const g = fitGrid(rows.length, W, H, { ar: 0.42, gap: 6, max: 200 });
    return <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${g.cols}, 1fr)`, gap: 6, alignContent: "center" }}>
      {rows.map(r => <div key={r.k} title={r.l} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, minWidth: 0,
        color: hot(r) ? r.c : "var(--muted)" }}><r.ico s={14}/>
        <span data-pk="" style={{ fontSize: 16, fontWeight: 900, color: hot(r) ? r.c : "var(--text)" }}>{Math.round(r.v || 0)}°</span></div>)}</div>;
  };
  return (
    <Tile icon={<Thermometer size={15}/>} color="#F97316" label="Températures" zoom={gauges(700, 300)}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 10, fontSize: 13.5 }}>{rows.map(r =>
        <span key={r.k} title={r.l} style={{ display: "inline-flex", alignItems: "center", gap: 3, color: hot(r) ? r.c : "var(--text)" }}>
          <r.ico s={13}/>{Math.round(r.v || 0)}°</span>)}</span>}>
      {({ W, H }) => {
        // les jauges seulement si elles restent lisibles, sinon des lignes
        const g = fitGrid(rows.length, W, H, { ar: GAUGE_AR, extra: GAUGE_EXTRA, gap: 8 });
        if (o.style !== "list" && g.size >= 50) return gauges(W, H);
        return H >= rows.length * 22 ? lines : cells(W, H);
      }}
    </Tile>
  );
}
// le mois : le compte, l'ecart avec le mois dernier, les barres par jour
function Month({ v, o, sz }) {
  const name = new Date().toLocaleDateString("fr-FR", { month: "long" });
  const nd = new Date().getDate();
  const days = useDays(o.chart ? nd : 0);
  const chart = (W, H) => days && days.length > 1 && <Bars values={days.map(x => x.count || 0)} color="#6366F1" height={Math.max(12, H - (H >= 60 ? 15 : 0))}
    hi={days.length - 1} labels={H >= 60 ? days.map(x => x.day.getDate() % 5 === 0 || x.day.getDate() === 1 ? String(x.day.getDate()) : "") : null}
    titles={days.map(x => `${x.day.getDate()} ${name} : ${x.count || 0}`)}/>;
  const sub = v && [fmtG(v.weight_g), fmtH(v.duration), o.cost && fmtEur(v.cost)].filter(Boolean).join(" · ");
  const hero = <Hero fill={false} value={v ? v.count : "…"} unit={`impression${v?.count > 1 ? "s" : ""}`} sub={sub}
    delta={o.compare && v?.prev && <Delta now={v.count} before={v.prev.count} label="le mois dernier"/>}/>;
  return (
    <Tile icon={<CalendarDays size={15}/>} color="#6366F1" label={`En ${name}`} to="/stats?tab=prints"
      mini={sz.h === 0.5} summary={<>{v ? v.count : "…"}{o.compare && v?.prev && <Delta now={v.count} before={v.prev.count}/>}</>}
      zoom={<>{hero}{v?.prev && <Versus color="#6366F1" a={`en ${name}`} b="à la même date le mois dernier" rows={[["Impressions", v.count, v.prev.count, x => x || 0],
        ["Poids", v.weight_g, v.prev.weight_g, fmtG], ["Machine", v.duration, v.prev.duration, fmtH], ["Coût", v.cost, v.prev.cost, fmtEur]]}/>}
        <H2>Impressions par jour</H2><MonthZoomChart/></>}>
      {({ W, H }) => {
        const hh = Math.min(H, 72);
        // haute : des chiffres du mois entre le compte et les barres
        const best = (days || []).reduce((b, x) => !b || (x.count || 0) > (b.count || 0) ? x : b, null);
        const items = days && days.length && [["Par jour", `${Math.round((v?.count ? (days.reduce((a, x) => a + (x.count || 0), 0)) : 0) / nd * 10) / 10}`],
          ["Meilleur jour", best?.count ? `${best.day.getDate()} · ${best.count}` : "—"], ["Jours actifs", `${days.filter(x => x.count).length} / ${nd}`]];
        const statsH = items && H >= 300 ? Math.ceil(3 / Math.max(1, Math.min(3, Math.floor((W + 6) / 96)))) * 50 : 0;
        return <>
          <BoxCtx.Provider value={{ W, H: hh }}>{hero}</BoxCtx.Provider>
          {statsH > 0 && <div style={{ marginTop: 6 }}><Stats items={items}/></div>}
          {o.chart && H - hh - statsH >= 26 && <div style={{ marginTop: "auto" }}>{chart(W, Math.min(220, H - hh - 6 - (statsH ? statsH + 8 : 0)))}</div>}
        </>;
      }}
    </Tile>
  );
}
function MonthZoomChart() {
  const days = useDays(new Date().getDate());
  const { W } = useBox();
  if (!days) return <Muted>…</Muted>;
  return <Bars values={days.map(x => x.count || 0)} color="#6366F1" height={150} hi={days.length - 1} showValues={W / days.length >= 22}
    labels={days.map(x => String(x.day.getDate()))} titles={days.map(x => `${x.day.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} : ${x.count || 0}`)}/>;
}
// objets et ventes : un anneau vendus / a vendre, le chiffre et la marge
function Sales({ v, o, sz }) {
  if (!v || !v.total) return null;
  const share = (v.sold || 0) / Math.max(1, (v.sold || 0) + (v.available || 0));
  const sub = [`${v.sold} vendu${v.sold > 1 ? "s" : ""}`, o.revenue && `${Math.round(v.revenue || 0)} €`,
    o.margin && `marge ${Math.round(v.margin || 0)} €${v.margin_pct ? ` (${Math.round(v.margin_pct)} %)` : ""}`].filter(Boolean).join(" · ");
  const hero = <Hero visual={o.ring ? s => <Ring value={share} size={s} color="#EC4899">{v.sold}</Ring> : null} value={v.available} unit="à vendre" sub={sub}/>;
  return (
    <Tile icon={<ShoppingBag size={15}/>} color="#EC4899" label="Objets et ventes" to="/objects"
      mini={sz.h === 0.5} summary={<>{v.available}<span style={{ fontSize: 12, color: "var(--muted)" }}>à vendre · {v.sold} vendus</span></>}
      zoom={<>{hero}<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {[["Objets", v.total], ["À vendre", v.available], ["Vendus", v.sold], ["Chiffre d'affaires", fmtEur(v.revenue)], ["Marge", fmtEur(v.margin)],
          ["Coût du stock", fmtEur(v.stock_cost)], ["Valeur du stock", fmtEur(v.potential_value)]].map(([l, x]) => <div key={l} className="card-sm" style={{ padding: 10 }}>
          <Muted>{l}</Muted><div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{x ?? "—"}</div></div>)}</div></>}>
      {({ W, H }) => {
        // haute : les chiffres en cases sous l'anneau
        const items = [o.revenue && ["Chiffre d'affaires", fmtEur(v.revenue)], o.margin && ["Marge", fmtEur(v.margin)],
          o.potential && ["Valeur du stock", fmtEur(v.potential_value)]].filter(Boolean);
        const cols = Math.max(1, Math.min(items.length, Math.floor((W + 6) / 96)));
        const statsH = items.length && H >= 280 ? Math.ceil(items.length / cols) * 50 : 0;
        if (statsH) return <><BoxCtx.Provider value={{ W, H: H - statsH - 8 }}>{hero}</BoxCtx.Provider><Stats items={items}/></>;
        return <>
          <BoxCtx.Provider value={{ W, H: o.potential && H >= 120 ? H - 22 : H }}>{hero}</BoxCtx.Provider>
          {o.potential && H >= 120 && <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            En stock : {fmtEur(v.potential_value)} de valeur</div>}</>;
      }}
    </Tile>
  );
}
// le fil : autant de lignes que la hauteur en tient ; en grand, tout le fil du jour
const FEED_SECTIONS = { all: null, prints: ["prints", "printer"], spools: ["spools", "dry"], mw: ["mw"], friends: ["friends"] };
function Feed({ f, o, sz }) {
  const nav = useNavigate();
  if (!f) return null;
  const want = FEED_SECTIONS[o.section || "all"];
  const all = (f.items || []).filter(x => !want || want.includes(x.section));
  const fresh = all.filter(x => !x.seen).length;
  const row = (x, i, detail, narrow) => {
    const sw = String(x.image || "").startsWith("color:") ? x.image.slice(6).split(",")[0] : null;
    const time = new Date(x.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return (
      <div key={x.id} onClick={e => { if (x.link) { e.stopPropagation(); nav(x.link); } }}
        style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", borderTop: i ? "1px solid var(--border)" : "none", cursor: x.link ? "pointer" : undefined }}>
        {o.time && !narrow && <span data-pk="" style={{ width: 38, flexShrink: 0, fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{time}</span>}
        <span data-pk="" style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, background: sw ? hexCss(sw) : `${x.section_color || "#64748B"}22` }}>{sw ? "" : x.section_emoji}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 12.5, color: "var(--text)", fontWeight: x.seen ? 600 : 800,
            ...(narrow ? { ...clamp(2), lineHeight: 1.2 } : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }) }}><W text={noEmoji(x.title)}/></span>
          {narrow && o.time && <span style={{ display: "block", fontSize: 10.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{time}</span>}
          {detail && <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {String(x.message || "").split("\n")[0]}</span>}
        </span>
        {!x.seen && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#3b82f6", flexShrink: 0 }}/>}
      </div>
    );
  };
  return (
    <Tile icon={<Rss size={15}/>} color="#0EA5E9" label="Le fil du jour" to="/notifications"
      badge={fresh ? <span style={{ fontSize: 11, fontWeight: 900, color: "#fff", background: "#3b82f6", borderRadius: 20, padding: "1px 7px" }}>{fresh}</span> : null}
      mini={sz.h === 0.5} summary={!all.length ? <span style={{ fontSize: 12.5, color: "var(--muted)" }}>rien de neuf</span>
        : <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, minWidth: 0 }}>
          {fresh > 0 && <span style={{ fontSize: 11, fontWeight: 900, color: "#fff", background: "#3b82f6", borderRadius: 20, padding: "1px 7px" }}>{fresh}</span>}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{noEmoji(all[0].title)}</span></span>}
      zoom={all.length ? <div>{all.map((x, i) => row(x, i, true, false))}</div> : null}>
      {({ W, H }) => {
        if (!all.length) return <Empty>Rien de neuf.</Empty>;
        const detail = o.detail && W >= 300 && H >= 100;
        const narrow = W < 215;
        const rowH = detail || narrow ? 52 : 33;
        const cap = o.count === "auto" || !o.count ? 99 : o.count;
        if (o.scroll) return <Scroller gap={0}>{all.slice(0, cap).map((x, i) => row(x, i, detail, narrow))}</Scroller>;
        return <div>{all.slice(0, Math.min(cap, fitRows(H + 1, rowH, 0))).map((x, i) => row(x, i, detail, narrow))}</div>;
      }}
    </Tile>
  );
}
// la galerie : des vignettes qui remplissent exactement la case
function Gallery({ g, o, sz }) {
  const nav = useNavigate();
  const all = (g || []).filter(p => !o.okOnly || okOf(p));
  if (!all.length) return null;
  const img = (p, s, extra = {}) => <img key={p.id} data-pk="" src={printImg(p.id)} alt="" title={p.file_name || p.translated_name}
    onClick={e => { e.stopPropagation(); nav(`/prints?id=${p.id}`); }} onError={e => { e.currentTarget.style.visibility = "hidden"; }}
    style={{ width: s, height: s, objectFit: "cover", borderRadius: o.round ? "50%" : Math.max(6, Math.round(s / 7)), background: "var(--surface2)", cursor: "pointer",
      outline: okOf(p) ? "none" : "2px solid rgba(239,68,68,0.6)", outlineOffset: -2, display: "block", ...extra }}/>;
  if (sz.h === 0.5) return (
    <div className="card" style={{ height: "100%", boxSizing: "border-box", padding: "0 10px", display: "flex", alignItems: "center", overflow: "hidden" }}>
      {/* une bande de vignettes entieres : celles qui ne tiennent pas passent a la ligne, cachee */}
      <div style={{ flex: 1, minWidth: 0, height: 38, display: "flex", flexWrap: "wrap", gap: 6, overflow: "hidden" }}>
        {all.slice(0, o.count || 8).map(p => img(p, 38, { flexShrink: 0 }))}</div>
    </div>
  );
  return (
    <Tile icon={<Images size={15}/>} color="#14B8A6" label="Galerie" to="/prints?tab=gallery"
      zoom={<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
        {all.map(p => <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <img src={printImg(p.id)} alt="" onClick={() => nav(`/prints?id=${p.id}`)} style={{ width: "100%", aspectRatio: "1", objectFit: "cover",
            borderRadius: 12, background: "var(--surface2)", cursor: "pointer", outline: okOf(p) ? "none" : "2px solid rgba(239,68,68,0.6)" }}/>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {p.file_name || p.translated_name}</span></div>)}</div>}>
      {({ W, H }) => {
        const n = Math.min(all.length, o.count || 8);
        const fg = fitGrid(n, W, H, { gap: 6 });
        // trop de place en hauteur : la derniere en grand, les autres en grille dessous
        const used = fg.rows * fg.size + 6 * (fg.rows - 1);
        if (n > 1 && H - used >= 90) {
          const rg = fitGrid(n - 1, W, Math.round(H * 0.42), { gap: 6 });
          const heroH = H - (rg.rows * rg.size + 6 * (rg.rows - 1)) - 6;
          return <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            {img(all[0], 0, { width: "100%", height: heroH, borderRadius: 12 })}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${rg.cols}, ${rg.size}px)`, gap: 6, justifyContent: "space-between" }}>
              {all.slice(1, n).map(p => img(p, rg.size))}</div></div>;
        }
        return <div style={{ display: "grid", gridTemplateColumns: `repeat(${fg.cols}, ${fg.size}px)`, gap: 6, justifyContent: "center", alignContent: "center", flex: 1 }}>
          {all.slice(0, n).map(p => img(p, fg.size))}</div>;
      }}
    </Tile>
  );
}
// les raccourcis : des boutons qui remplissent la case (le nom quand il tient)
const SHORTCUTS = [["hist", "Historique", "/prints", History], ["fil", "Filaments", "/filaments", Package], ["todo", "À faire", "/prints?tab=queue", ListChecks],
  ["dry", "Séchage", "/stats?tab=drying", Flame], ["notif", "Notifications", "/notifications", BellRing], ["ach", "Succès", "/stats?tab=achievements", Trophy],
  ["obj", "Objets", "/objects", ShoppingBag], ["stats", "Statistiques", "/stats", BarChart3], ["gal", "Galerie", "/prints?tab=gallery", Images]];
function Shortcuts({ o, sz = { h: 1 } }) {
  const nav = useNavigate();
  const list = SHORTCUTS.filter(([k]) => o[`s_${k}`]);
  const button = ([k, l, to, I], w, h) => {
    const col = !o.iconsOnly && h >= 58 && w >= 56;
    const words = !o.iconsOnly && (w >= 92 || col);
    return <button key={k} data-pk="" onClick={e => { e.stopPropagation(); nav(to); }} title={l} style={{ display: "flex", flexDirection: col ? "column" : "row",
      alignItems: "center", justifyContent: "center", gap: col ? 4 : 6, height: h, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)",
      color: "var(--text2)", fontWeight: 700, fontSize: 12, cursor: "pointer", minWidth: 0, padding: "0 6px" }}>
      <I size={Math.max(15, Math.min(24, h * 0.32))}/>{words && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        maxWidth: "100%", fontSize: col && w < 92 ? 10.5 : 12 }}>{l}</span>}</button>;
  };
  if (sz.h === 0.5) return (
    <div className="card" style={{ height: "100%", boxSizing: "border-box", padding: "0 10px", display: "flex", alignItems: "center", gap: 6 }}>
      {list.map(([k, l, to, I]) => <button key={k} data-pk="" onClick={() => nav(to)} title={l} style={{ flex: 1, minWidth: 0, height: 36, borderRadius: 10,
        border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer", display: "flex",
        alignItems: "center", justifyContent: "center" }}><I size={17}/></button>)}
    </div>
  );
  return (
    <Tile icon={<Zap size={15}/>} color="#EAB308" label="Raccourcis">
      {({ W, H }) => {
        const g = fitGrid(list.length, W, H, { ar: 0.5, gap: 6, max: 260 });
        const h = Math.min(Math.floor((H - 6 * (g.rows - 1)) / g.rows), 90);
        const w = Math.floor((W - 6 * (g.cols - 1)) / g.cols);
        return <div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, 1fr)`, gap: 6, flex: 1, alignContent: "center" }}>
          {list.map(s => button(s, w, h))}</div>;
      }}
    </Tile>
  );
}
// le classement des copains : liste ou podium, qui remplit la case
function Podium({ p, o, sz }) {
  const people = (p?.people || []).filter(x => x.status === "ok").sort((a, b) => (b.score || 0) - (a.score || 0));
  if (people.length < 2) return null;
  const max = Math.max(1, people[0].score || 0);
  const top = <span style={{ fontSize: 13 }}>🥇 {people[0].me ? "Toi" : people[0].name} · {(people[0].score || 0).toLocaleString("fr-FR")}</span>;
  const row = (x, i) => (
    <div key={x.id || x.name} style={{ height: o.bars ? 26 : 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
        <span data-pk="" style={{ width: 18, fontWeight: 900, color: ["#D4A017", "#94A3B8", "#B45309"][i] || "var(--muted)" }}>{i + 1}</span>
        <span style={{ flex: 1, minWidth: 0, fontWeight: x.me ? 900 : 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.me ? "Toi" : x.name}</span>
        <span data-pk="" style={{ fontWeight: 800, color: "var(--text2)" }}>{(x.score || 0).toLocaleString("fr-FR")}</span></div>
      {o.bars && <div style={{ height: 4, borderRadius: 4, background: "var(--surface2)", marginLeft: 26, overflow: "hidden", marginTop: 2 }}>
        <div data-pk="" style={{ height: "100%", width: `${Math.round(100 * (x.score || 0) / max)}%`, background: x.me ? "#A855F7" : "#C4B5FD" }}/></div>}
    </div>);
  const podium = H => {
    const list = people.slice(0, 3), order = [list[1], list[0], list[2]].filter(Boolean), hs = { 0: 1, 1: 0.72, 2: 0.52 };
    const step = Math.max(24, H - 22);
    return <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 6, flex: 1 }}>
      {order.map(x => { const rank = list.indexOf(x); return (
        <div key={x.name} style={{ flex: 1, maxWidth: 110, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 11.5, fontWeight: x.me ? 900 : 700, color: "var(--text)", maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.me ? "Toi" : x.name}</span>
          <div data-pk="" style={{ width: "100%", height: Math.round(hs[rank] * step), borderRadius: "8px 8px 0 0",
            background: ["#D4A017", "#94A3B8", "#B45309"][rank], display: "flex", alignItems: "flex-start", justifyContent: "center",
            color: "#fff", fontWeight: 900, fontSize: 13, paddingTop: 3 }}>{rank + 1}</div>
        </div>); })}</div>;
  };
  return (
    <Tile icon={<MedalIcon size={15}/>} color="#A855F7" label="Classement des copains" to="/stats?tab=achievements"
      mini={sz.h === 0.5} summary={top}
      zoom={<>{podium(200)}<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{people.map(row)}</div></>}>
      {({ H }) => o.style === "podium" ? podium(H) : o.scroll ? <Scroller gap={5}>{people.map(row)}</Scroller>
        : <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{people.slice(0, fitRows(H, o.bars ? 26 : 20, 5)).map(row)}</div>}
    </Tile>
  );
}
// ouvre les points d'attention de l'accueil (sur une categorie) ; sans la tuile a l'ecran, les reglages
const openAttention = category => {
  if (document.getElementById("att-section")) window.dispatchEvent(new CustomEvent("bn-attention-open", { detail: { category } }));
  else window.location.assign("/settings?tab=display");
};
function Alerts({ a, o, sz }) {
  const cats = (a?.categories || []).filter(c => c.total);
  if (!a) return null;
  const total = cats.reduce((n, c) => n + c.total, 0);
  const listRow = (c, detail) => (
    <div key={c.category} role="button" onClick={e => { e.stopPropagation(); openAttention(c.category); }}
      style={{ display: "flex", alignItems: "center", gap: 8, height: 24, cursor: "pointer" }}>
      <span data-pk="" style={{ fontSize: 15 }}>{c.icon}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}
        {detail && <span style={{ fontWeight: 500, color: "var(--muted)" }}> · {(c.alerts || []).slice(0, 2).map(x => x.title).join(", ")}</span>}</span>
      <span data-pk="" style={{ fontSize: 12, fontWeight: 900, color: "#b45309" }}>{c.total}</span>
    </div>);
  return (
    <Tile icon={<BellRing size={15}/>} color="#F59E0B" label="Alertes"
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 6, fontSize: 13 }}>{cats.length ? cats.map(c => <span key={c.category}
        title={c.label}>{c.icon}<b style={{ color: "#b45309" }}>{c.total}</b></span>) : "rien à signaler"}</span>}
      badge={total ? <span style={{ fontSize: 11, fontWeight: 900, color: "#fff", background: "#f59e0b", borderRadius: 20, padding: "1px 7px" }}>{total}</span> : null}
      zoom={cats.length ? <>{cats.map(c => <div key={c.category} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, color: "var(--text)" }}><span style={{ fontSize: 18 }}>{c.icon}</span>{c.label}
          <span style={{ marginLeft: "auto", color: "#b45309" }}>{c.total}</span></div>
        {(c.alerts || []).map(x => <div key={x.key} className="card-sm" style={{ padding: "7px 10px", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 12.5, color: "var(--text)" }}>{x.title}</b> <Muted>{x.detail}</Muted></span>
          <span style={{ fontWeight: 800, color: "#b45309", fontSize: 12.5 }}>{x.value}</span></div>)}
        <button onClick={() => openAttention(c.category)} style={{ alignSelf: "flex-start", border: "none", background: "none", color: "#d97706", fontWeight: 800,
          cursor: "pointer", fontSize: 12.5, padding: 0 }}>Voir dans les points d'attention →</button></div>)}</> : null}>
      {({ W, H }) => {
        if (!cats.length) return <Empty>Rien à signaler.</Empty>;
        // haute : chaque categorie avec ses alertes dessous, autant que la place en tient
        const spare = H - cats.length * 27;
        if (o.style !== "icons" && spare >= 40) {
          const per = Math.max(0, Math.floor(spare / cats.length / 19));
          return <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>{cats.map(c => <div key={c.category}>
            {listRow(c, false)}
            {(c.alerts || []).slice(0, per).map(x => <div key={x.key} style={{ display: "flex", gap: 6, alignItems: "baseline", height: 19, paddingLeft: 23,
              fontSize: 11.5, minWidth: 0 }}>
              <span style={{ flex: 1, minWidth: 0, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.title}
                {W >= 260 && <span style={{ color: "var(--muted)" }}> · {x.detail}</span>}</span>
              <span style={{ fontWeight: 800, color: "#b45309", whiteSpace: "nowrap" }}>{x.value}</span></div>)}
          </div>)}</div>;
        }
        if (o.style === "list" || (o.style !== "icons" && H >= cats.length * 28)) return <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {cats.slice(0, fitRows(H, 24, 3)).map(c => listRow(c, o.detail && W >= 300))}</div>;
        return <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignContent: "center", flex: 1 }}>
          {cats.map(c => <span key={c.category} data-pk="" role="button" tabIndex={0} title={c.label}
            onClick={e => { e.stopPropagation(); openAttention(c.category); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", cursor: "pointer",
              borderRadius: 20, fontSize: 12, fontWeight: 800, background: "rgba(245,158,11,0.12)", color: "#b45309" }}>
            {c.icon}{o.style !== "icons" && W >= 200 && ` ${c.label}`} <b>{c.total}</b></span>)}</div>;
      }}
    </Tile>
  );
}

// ── Nouvelles tuiles ─────────────────────────────────────────────────────────
// la fin de l'impression : un compte a rebours en anneau (l'avancement), l'heure de fin, la couche
const finAt = min => { const d = new Date(Date.now() + min * 60000); const t = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.getDate() !== new Date().getDate() ? `demain ${t}` : t; };
function Countdown({ status, o, sz }) {
  const live = isLive(status);
  const pct = Math.round(status?.progress || 0);
  const left = status?.remaining_minutes || 0;
  const paused = /PAUSE/.test(String(status?.status || "").toUpperCase());
  const color = paused ? "#f59e0b" : "#22c55e";
  const hero = <Hero visual={s => <Ring value={pct / 100} size={s} color={color}>{pct}%</Ring>}
    value={live ? (left ? fmtDur(left * 60) : "bientôt") : "—"} unit={live ? (paused ? "en pause" : "restantes") : "rien en cours"}
    sub={live && [left && o.fin && `fin à ${finAt(left)}`, o.layer && status.total_layers > 0 && `couche ${status.layer} / ${status.total_layers}`].filter(Boolean).join(" · ")}/>;
  return (
    <Tile icon={<Timer size={15}/>} color={color} label="Fin d'impression" zoom={live ? hero : null}
      mini={sz.h === 0.5} summary={live ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
        <span style={{ color }}>{pct}%</span>{left > 0 && <>{fmtDur(left * 60)}<Muted>· {finAt(left)}</Muted></>}</span> : <Muted size={12.5}>rien en cours</Muted>}>
      {live ? hero : <Empty>Rien en cours d'impression</Empty>}
    </Tile>
  );
}
// le filament en cours : la bobine qui imprime (sa couleur, sa matiere, ce qui reste)
function activeTray(status) {
  const ams = (status?.ams_list || []).find(a => a.id === status?.active_ams_id);
  const tray = ams?.trays?.find(t => t.id === status?.active_tray_id);
  return tray ? { ...tray, ams } : null;
}
function Spool({ status, o, sz }) {
  const t = activeTray(status);
  const live = isLive(status);
  const pct = t?.remain != null && t.remain >= 0 ? t.remain / 100 : null;
  const hero = t && <Hero visual={s => <SpoolDot color={t.color} pct={pct} size={s}/>} value={t.filament_type || "?"} unit={t.tray_id_name || amsLab(t.ams)}
    sub={[pct != null && `${Math.round(pct * 100)} % restant`, `${amsLab(t.ams)} · bac ${t.id + 1}`].filter(Boolean).join(" · ")}/>;
  return (
    <Tile icon={<Disc3 size={15}/>} color="#8B5CF6" label="Filament en cours" zoom={hero}
      mini={sz.h === 0.5} summary={t ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
        <SpoolDot color={t.color} pct={pct} size={22}/>{t.filament_type}{pct != null && <Muted>{Math.round(pct * 100)} %</Muted>}</span> : <Muted size={12.5}>aucun</Muted>}>
      {t ? hero : <Empty>{live ? "Bobine inconnue" : "Pas d'impression en cours"}</Empty>}
    </Tile>
  );
}
// les couleurs chargees : toutes les bobines de l'AMS en pastilles, celle qui imprime cerclee
function Colors({ status, o, sz }) {
  const trays = (status?.ams_list || []).filter(a => a.id !== 255 && a.id !== 254).flatMap(a => (a.trays || []).map(t => ({ ...t, ams: a })))
    .filter(t => !t.empty && t.color);
  if (!trays.length) return null;
  const on = t => t.ams.id === status?.active_ams_id && t.id === status?.active_tray_id;
  const dot = (t, s, label) => <span key={`${t.ams.id}-${t.id}`} title={`${amsLab(t.ams)} · ${t.filament_type || ""}`} style={{ display: "flex", flexDirection: "column",
    alignItems: "center", gap: 3, minWidth: 0 }}>
    <span data-pk="" style={{ width: s, height: s, borderRadius: Math.round(s / 3.2), background: hexCss(t.color), border: "1px solid rgba(0,0,0,0.15)",
      boxShadow: on(t) ? "0 0 0 3px var(--surface), 0 0 0 5px #3b82f6" : "none", display: "block" }}/>
    {label && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>{t.filament_type}</span>}</span>;
  return (
    <Tile icon={<Palette size={15}/>} color="#EC4899" label="Couleurs chargées"
      zoom={<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 12, justifyItems: "center" }}>{trays.map(t => dot(t, 64, true))}</div>}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 3 }}>{trays.slice(0, 18).map(t => <span key={`${t.ams.id}-${t.id}`}
        style={{ width: 13, height: 13, borderRadius: 4, background: hexCss(t.color), border: "1px solid rgba(0,0,0,0.2)" }}/>)}</span>}>
      {({ W, H }) => {
        const g = fitGrid(trays.length, W - 6, H - 6, { gap: 6, max: 70 });
        return <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${g.cols}, ${g.size}px)`, gap: 6, justifyContent: "space-evenly", alignContent: "center", padding: 3 }}>
          {trays.map(t => dot(t, g.size))}</div>;
      }}
    </Tile>
  );
}
// la serie : combien de jours d'affilee avec au moins une impression, et le calendrier des 30 derniers
function Streak({ o, sz }) {
  const days = useDays(30);
  let n = 0;
  if (days) { const xs = [...days]; if (!(xs[xs.length - 1]?.count > 0)) xs.pop(); for (let i = xs.length - 1; i >= 0 && xs[i].count > 0; i--) n++; }
  const best = days ? days.reduce((b, x, i, a) => { let k = 0; for (let j = i; j >= 0 && a[j].count > 0; j--) k++; return Math.max(b, k); }, 0) : 0;
  const heat = (W, H) => {
    const g = fitGrid(30, W, H, { gap: 3, max: 40 });
    const m = Math.max(1, ...(days || []).map(x => x.count || 0));
    return <div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, ${g.size}px)`, gap: 3, justifyContent: "center", alignContent: "center", flex: 1 }}>
      {(days || []).map(x => <span key={ymd(x.day)} data-pk="" title={`${x.day.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} : ${x.count || 0}`}
        style={{ width: g.size, height: g.size, borderRadius: Math.max(2, g.size / 4), background: x.count ? `rgba(249,115,22,${0.3 + 0.7 * x.count / m})` : "var(--surface2)" }}/>)}</div>;
  };
  const hero = <Hero fill={false} value={days ? n : "…"} unit={`jour${n > 1 ? "s" : ""} d'affilée`} sub={days && `record sur 30 jours : ${best}`} color={n ? "#ea580c" : "var(--text)"}/>;
  return (
    <Tile icon={<CalendarCheck size={15}/>} color="#F97316" label="Série" zoom={<>{hero}{days && heat(700, 220)}</>}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Flame size={15} color="#ea580c"/>{days ? n : "…"}
        <Muted>jour{n > 1 ? "s" : ""}</Muted></span>}>
      {({ W, H }) => {
        const hh = Math.min(H, 56);
        return <><BoxCtx.Provider value={{ W, H: hh }}>{hero}</BoxCtx.Provider>{o.heat && days && H - hh >= 22 && heat(W, H - hh - 6)}</>;
      }}
    </Tile>
  );
}
// un objectif : des heures, des impressions ou des grammes, sur la semaine ou le mois
function Goal({ d, o, sz }) {
  const week = useDays(o.period === "week" ? 7 : 0);
  const [, val, fmt] = METRICS[o.metric] || METRICS.h;
  const target = Number(o.target) || 1;
  const scale = o.metric === "h" ? 3600 : 1;
  const now = o.period === "week" ? (week ? week.reduce((a, x) => a + val(x), 0) : null) : (d.month ? val(d.month) : null);
  const done = now == null ? 0 : Math.min(1, now / (target * scale));
  const color = done >= 1 ? "#22c55e" : "#3B82F6";
  const tf = o.metric === "h" ? `${target} h` : o.metric === "g" ? fmtG(target) : `${target}`;
  const hero = <Hero visual={s => <Ring value={done} size={s} color={color}>{Math.round(done * 100)}%</Ring>}
    value={now == null ? "…" : fmt(now)} unit={`sur ${tf}`} sub={o.period === "week" ? "ces 7 derniers jours" : "ce mois-ci"}/>;
  return (
    <Tile icon={<Target size={15}/>} color={color} label="Objectif" zoom={hero}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{Math.round(done * 100)} %<Muted>{now == null ? "" : `${fmt(now)} / ${tf}`}</Muted></span>}>
      {hero}
    </Tile>
  );
}

// ── Le catalogue ─────────────────────────────────────────────────────────────
// Chaque tuile : ses largeurs (1 = moitie, 2 = toute la colonne) et hauteurs
// (rangees ; la premiere valeur est celle par defaut), ses options (une valeur
// par defaut, un groupe, une explication ; « when » : seulement pour certaines
// tailles). render(donnees, imprimante, options, taille).
const sz = it => ({ w: it?.w || 1, h: typeof it?.h === "number" ? it.h : 1 });   // h : 0,5 (une ligne), 1, 2, 3 ou 4
const B = (key, label, def, extra = {}) => ({ key, label, def, ...extra });
const C = (key, label, def, choices, extra = {}) => ({ key, label, def, choices, ...extra });
export const TILES = {
  today: { label: "Aujourd'hui", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Today v={d.today} o={o} sz={sz(it)}/>,
    options: [B("ring", "Anneau de réussite", true, { hint: "La part des impressions réussies du jour." }), B("yesterday", "Écart avec hier", true),
      B("weight", "Poids imprimé", true), B("hours", "Heures de machine", true), B("cost", "Coût du jour", false)] },
  week: { label: "Derniers jours", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Week o={o} sz={sz(it)}/>,
    options: [C("range", "Période", 7, [[7, "7 jours"], [14, "14 jours"], [30, "30 jours"]]),
      C("metric", "Compter", "h", [["h", "les heures"], ["n", "les impressions"], ["g", "les grammes"]]), B("avg", "Moyenne par jour", true)] },
  next: { label: "À faire", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Next q={d.queue} o={o} sz={sz(it)}/>,
    options: [B("thumbs", "Vignettes", true), B("ready", "Seulement ce qui est prêt", false, { hint: "Les modèles dont les bobines sont dans l'AMS." }),
      B("weight", "Poids", true), SCROLL(false)] },
  last: { label: "Dernières impressions", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Last p={d.prints} o={o} sz={sz(it)}/>,
    options: [B("when", "Depuis quand", true), B("cost", "Coût", false), B("photo", "Rappel « pas de photo »", true), SCROLL(true)] },
  stock: { label: "Stock", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Stock s={d.spools} o={o} sz={sz(it)}/>,
    options: [C("style", "Bobines basses", "dots", [["dots", "en pastilles"], ["list", "en liste"]], { hint: "Autant que la tuile en tient ; l'anneau d'une pastille montre ce qui reste." }),
      C("sort", "Les plus basses", "g", [["g", "en grammes"], ["pct", "en pourcentage"]]), B("kg", "Poids total", true)] },
  dry: { label: "Séchage", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Dry v={d.dry} status={st} o={o} sz={sz(it)}/>,
    options: [B("ring", "Anneau « au sec »", true), B("inams", "Combien sont dans l'AMS", true)] },
  humidity: { label: "Humidité des AMS", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Humidity status={st} o={o} sz={sz(it)}/>,
    options: [C("style", "Affichage", "gauges", [["gauges", "jauges"], ["bars", "barres"]], { hint: "Les jauges passent en barres quand la tuile est trop basse." }),
      C("thr", "Seuils", "std", [["strict", "stricts (20/30 %)"], ["std", "normaux (30/40 %)"], ["loose", "souples (40/55 %)"]]),
      B("temp", "Température de l'AMS", false)] },
  friends: { label: "Copains", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Friends f={d.friends} o={o} sz={sz(it)}/>,
    options: [B("thumbs", "Vignette de leur impression", true), B("idle", "Ceux au repos", true), SCROLL(false)] },
  mw: { label: "MakerWorld", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <MwPoints c={d.mw} o={o} sz={sz(it)}/>,
    options: [C("period", "Gains sur", "7", [["7", "7 jours"], ["30", "30 jours"], ["365", "un an"]]), B("chart", "Courbe des points (14 j)", true),
      B("stats", "Téléchargements, impressions, boosts, j'aime", true, { hint: "Quand la tuile a la place." })] },
  rate: { label: "À évaluer", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <ToRate r={d.rate} o={o} sz={sz(it)}/>,
    options: [B("thumbs", "Vignettes", true)] },
  wheel: { label: "Roue et clés", w: [1, 2], h: [1, 0.5], render: (d, st, o, it) => <Wheel a={d.ach} o={o} sz={sz(it)}/>,
    options: [B("keys", "Clés", true), B("tickets", "Tickets de palier", true)] },
  ach: { label: "Succès", w: [2, 1], h: [1, 2, 0.5], render: (d, st, o, it) => <Ach a={d.ach} o={o} sz={sz(it)}/>,
    options: [B("grade", "Grade de maker", true), B("score", "Anneau du score", false), B("cards", "Prochaines cartes", true), B("recent", "Dernières médailles", true)] },
  // au choix (dans « Ajouter »)
  camera: { label: "Caméra", w: [2, 1], h: [2, 1, 3], render: (d, st, o, it) => <LiveCam status={st} o={o} sz={sz(it)}/>,
    options: [C("mode", "Image", "auto", [["auto", "auto"], ["stream", "direct"], ["images", "toutes les 2 s"]],
      { hint: "Auto : le direct, et des images si le direct se fige." }), B("overlay", "Avancement sur l'image", true)] },
  temps: { label: "Températures", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Temps status={st} o={o} sz={sz(it)}/>,
    options: [C("style", "Affichage", "gauges", [["gauges", "jauges"], ["list", "lignes"]], { hint: "Les jauges passent en lignes quand elles seraient trop petites." }),
      B("targets", "Consignes", true), B("chamber", "Chambre", true)] },
  month: { label: "Ce mois-ci", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Month v={d.month} o={o} sz={sz(it)}/>,
    options: [B("compare", "Comparer au mois dernier", true), B("cost", "Coût", true), B("chart", "Barres par jour", true, { hint: "Quand la tuile a la place." })] },
  sales: { label: "Objets et ventes", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Sales v={d.sales} o={o} sz={sz(it)}/>,
    options: [B("ring", "Anneau vendus / à vendre", true), B("revenue", "Chiffre d'affaires", true), B("margin", "Marge", true),
      B("potential", "Valeur du stock", true, { hint: "Quand la tuile a la place." })] },
  feed: { label: "Le fil du jour", w: [2, 1], h: [2, 3, 1], render: (d, st, o, it) => <Feed f={d.feed} o={o} sz={sz(it)}/>,
    options: [C("count", "Lignes", "auto", [["auto", "selon la hauteur"], [4, "4 au plus"], [6, "6 au plus"], [10, "10 au plus"]]),
      C("section", "Montrer", "all", [["all", "tout"], ["prints", "impressions"], ["spools", "bobines et séchage"], ["mw", "MakerWorld"], ["friends", "copains"]]),
      B("time", "Heure", true), B("detail", "Détail (quand la tuile est large)", true), SCROLL(true)] },
  gallery: { label: "Galerie", w: [2, 1], h: [1, 2], render: (d, st, o, it) => <Gallery g={d.prints} o={o} sz={sz(it)}/>,
    options: [C("count", "Vignettes au plus", 8, [[4, "4"], [8, "8"], [12, "12"], [16, "16"]]), B("okOnly", "Seulement les réussies", false),
      B("round", "Vignettes rondes", false)] },
  shortcuts: { label: "Raccourcis", w: [2, 1], h: [1, 0.5], render: (d, st, o, it) => <Shortcuts o={o} sz={sz(it)}/>,
    options: [B("iconsOnly", "Icônes seules", false, { hint: "Sinon le nom s'affiche quand il tient." }),
      ...SHORTCUTS.map(([k, l], i) => B(`s_${k}`, l, i < 6, { group: "Raccourcis affichés" }))] },
  podium: { label: "Classement des copains", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Podium p={d.podium} o={o} sz={sz(it)}/>,
    options: [C("style", "Affichage", "list", [["list", "liste"], ["podium", "podium"]]), B("bars", "Barres de score", true), SCROLL(false)] },
  alerts: { label: "Alertes en bref", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Alerts a={d.attention} o={o} sz={sz(it)}/>,
    options: [C("style", "Affichage", "chips", [["chips", "pastilles"], ["icons", "icônes"], ["list", "liste"]], { hint: "Les pastilles deviennent une liste quand la place le permet." }),
      B("detail", "Exemples (quand la tuile est large)", true)] },
  countdown: { label: "Fin d'impression", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Countdown status={st} o={o} sz={sz(it)}/>,
    options: [B("fin", "Heure de fin", true), B("layer", "Couche", true)] },
  spool: { label: "Filament en cours", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Spool status={st} o={o} sz={sz(it)}/> },
  colors: { label: "Couleurs chargées", w: [2, 1], h: [1, 2, 0.5], render: (d, st, o, it) => <Colors status={st} o={o} sz={sz(it)}/> },
  streak: { label: "Série", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Streak o={o} sz={sz(it)}/>,
    options: [B("heat", "Calendrier des 30 jours", true, { hint: "Quand la tuile a la place." })] },
  goal: { label: "Objectif", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Goal d={d} o={o} sz={sz(it)}/>,
    options: [C("metric", "Mesure", "h", [["h", "heures"], ["n", "impressions"], ["g", "grammes"]]),
      C("period", "Sur", "week", [["week", "7 jours"], ["month", "le mois"]]),
      C("target", "Objectif", 20, [[5, "5"], [10, "10"], [20, "20"], [50, "50"], [100, "100"], [500, "500"], [1000, "1000"]],
        { hint: "En heures, en impressions ou en grammes selon la mesure." })] },
};
// chaque tuile se pose sur 1/2, 1, 2, 3 ou 4 rangees ; sa hauteur par defaut reste en tete
export const HEIGHTS = [0.5, 1, 2, 3, 4];
for (const t of Object.values(TILES)) t.h = [t.h[0], ...HEIGHTS.filter(x => x !== t.h[0])];
