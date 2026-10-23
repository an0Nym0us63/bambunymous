import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFriend } from "../store/friend";
import { relayed } from "./Friends";
import { stageLabel } from "../utils/printStage";
import { QUEUE_SORTS, sortQueue } from "../utils/queueSort";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CalendarClock, BarChart3, ListChecks, History, Package, Flame, Droplets, Coins, Star, Users, Trophy,
         Dices, ChevronRight, Camera, Video, Thermometer, CalendarDays, ShoppingBag, Rss, Images, Zap, Medal as MedalIcon,
         BellRing, Split, Fan, Wrench, TrendingUp, TrendingDown, Key, Ticket, X, ArrowUpRight, Timer, Palette, Target, Disc3, CalendarCheck } from "lucide-react";
import client, { apiUrl } from "../api/client";
import { mwImg } from "./MwImg";
import LiveCamera from "./LiveCamera";
import { Medal, gradeOf, GradeEmblem, CARD_ORDER } from "../pages/Achievements";
import { DryCard } from "./AMSSection";
import SpoolSVG from "./SpoolSVG";
import { switchRoutes, slotLabel, grilleAccueil, lireDisposition } from "../utils/ams";
import MakerWorldModelSheet from "./MakerWorldModelSheet";

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
const utc = iso => { const s = String(iso || "").trim().replace(" ", "T"); return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`); };
const printImg = id => apiUrl(`/prints/${id}/image`);
// la couleur d'un emplacement d'AMS, comme la tuile AMS : celle de la bobine associee d'abord, puis celle de l'AMS
const trayCol = t => { const c = t && !t.empty && (t.spool_info?.color || t.spool_info?.filament_color || t.color); return c ? hexCss(c) : null; };
const LIVE = ["RUNNING", "PAUSE", "PAUSED", "PREPARE", "SLICING"];
const isLive = st => LIVE.includes(String(st?.status || "").toUpperCase());

function W({ text }) {
  // un seul bloc en ligne : dans un parent en flex, des espaces laisses seuls entre les mots disparaissent
  // (« Personnen'imprimeencemoment »)
  return <span>{String(text ?? "").split(/(\s+)/).map((p, i) => /\s/.test(p) || !p ? p : <span key={i} data-pk="">{p}</span>)}</span>;
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
          {badge}{!zoom && act && <ChevronRight size={14} style={{ color: "var(--muted)" }}/>}</span>
      </div>
      <div ref={ref} style={{ position: "relative", minWidth: 0, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {box.W > 0 && <BoxCtx.Provider value={box}>{kids(children, box)}</BoxCtx.Provider>}
      </div>
      {big}
    </div>
  );
}
// la tuile en grand : par-dessus la page, son detail, et un lien vers sa page.
// Un en-tete degrade a la couleur de la tuile ; sur telephone, un panneau qui monte du bas.
function Zoom({ icon, color, label, to, onClose, children }) {
  const nav = useNavigate();
  const [ref, box] = useMeasure();
  const narrow = typeof window !== "undefined" && window.innerWidth < 560;
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // la place du contenu : la boite mesuree, moins ses marges interieures
  const b = { W: box.W - (narrow ? 32 : 36), H: box.H - (narrow ? 36 : 36), zoom: true };
  const big = React.isValidElement(icon) ? React.cloneElement(icon, { size: 22 }) : icon;
  return createPortal(
    <div data-no-pull="" onClick={e => { e.stopPropagation(); onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 900, padding: narrow ? 0 : 14,
      background: "rgba(2,6,23,0.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: narrow ? "flex-end" : "center", justifyContent: "center",
      cursor: "default", animation: "bn-fade .2s ease-out" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: narrow ? "100%" : "min(780px, 100%)", height: narrow ? "88vh" : "min(640px, 86vh)",
        display: "flex", flexDirection: "column", position: "relative", overflow: "hidden", boxSizing: "border-box",
        borderRadius: narrow ? "26px 26px 0 0" : 24, background: "var(--sheet-bg)", border: "1px solid var(--border)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.45)", animation: narrow ? "bn-sheet-up .3s cubic-bezier(.2,.8,.2,1)" : "bn-pop .24s cubic-bezier(.2,.8,.2,1)" }}>
        {/* l'en-tete : un degrade de la couleur de la tuile, deux halos */}
        <div style={{ position: "relative", padding: narrow ? "10px 16px 14px" : "16px 18px", overflow: "hidden", flexShrink: 0,
          background: `linear-gradient(135deg, ${color}38, ${color}10 55%, transparent)` }}>
          <span aria-hidden="true" style={{ position: "absolute", right: -50, top: -70, width: 180, height: 180, borderRadius: "50%", background: `${color}30` }}/>
          <span aria-hidden="true" style={{ position: "absolute", right: 90, top: -30, width: 70, height: 70, borderRadius: "50%", background: `${color}1c` }}/>
          {narrow && <div style={{ width: 42, height: 4, borderRadius: 4, background: "var(--border)", margin: "0 auto 10px" }}/>}
          <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
            <span style={{ width: 44, height: 44, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              background: `linear-gradient(135deg, ${color}, ${color}bb)`, color: "#fff", boxShadow: `0 8px 20px ${color}55` }}>{big}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 19, fontWeight: 900, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap", letterSpacing: "-.01em" }}>{label}</span>
            {to && <button onClick={() => { onClose(); nav(to); }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 13px",
              borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 12.5, color: "#fff", background: color,
              boxShadow: `0 6px 16px ${color}55` }}>Ouvrir<ArrowUpRight size={14}/></button>}
            <button onClick={onClose} aria-label="Fermer" style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid var(--border)",
              background: "var(--surface)", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <X size={17}/></button>
          </div>
        </div>
        <div ref={ref} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 14,
          padding: narrow ? "14px 16px 22px" : "16px 18px 20px", position: "relative" }} className="bn-zoom-body">
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
  const vs = !visual ? 0 : stack ? Math.min(W * (H >= 280 ? 0.9 : 0.66), H - 74, 200) : Math.min(H - 2, narrow ? 62 : zoom ? 140 : 132, W * 0.4);
  const fs = zoom ? 40 : stack ? 26 : Math.round(Math.max(20, Math.min(narrow ? 25 : 34, H * 0.4)));
  const used = stack ? vs + fs + 24 : fs + 22;
  const subLines = Math.max(0, Math.min(3, Math.floor((H - used) / 16)));
  return (
    <div style={{ display: "flex", flexDirection: stack ? "column" : "row", alignItems: "center", justifyContent: "center", gap: stack ? 6 : 12,
      textAlign: stack ? "center" : "left", minWidth: 0, ...(fill && !zoom ? { flex: 1, minHeight: 0 } : {}) }}>
      {visual && vs >= 24 && visual(Math.floor(vs))}
      <div style={{ minWidth: 0, flex: stack ? undefined : "0 1 auto", display: "flex", flexDirection: "column", alignItems: stack ? "center" : "flex-start", gap: 2 }}>
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
function Item({ img, dot, title, sub, right, size = 36, onClick, color, card = false, corner }) {
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
        {corner && <span style={{ position: "absolute", left: -3, top: -3 }}>{corner}</span>}
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
function Ring({ value, size = 54, color = "#3b82f6", stroke, children, cap }) {
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
        fontWeight: 900, color: "var(--text)", lineHeight: 1.05, flexDirection: "column" }}>{children}
        {cap && size >= 64 && <span style={{ fontSize: Math.max(9, size * 0.1), fontWeight: 700, color: "var(--muted)", marginTop: 1 }}>{cap}</span>}</span>
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
// une goutte d'eau remplie au niveau (0 a 100), une vague qui ondule a la surface ;
// sa hauteur : size, sa largeur : size * 0.75 ; la legende dessous (DROP_EXTRA)
const DROP = "M30 3 C30 3 7 31 7 50 A23 23 0 0 0 53 50 C53 31 30 3 30 3 Z";
const DROP_AR = 1 / 0.75, DROP_EXTRA = 34;
function DropGauge({ value, color, size = 80, label, sub }) {
  const id = useMemo(() => `dr${Math.random().toString(36).slice(2, 8)}`, []);
  const v = Math.max(0, Math.min(100, value || 0));
  const top = 75 - 72 * v / 100;   // la goutte va de y=3 (pointe) a y=73
  const inside = v >= 46;           // le chiffre est dans l'eau : en blanc
  return (
    <div data-pk="" style={{ display: "flex", flexDirection: "column", alignItems: "center", width: Math.round(size * 0.75), flexShrink: 0 }}>
      <svg width={Math.round(size * 0.75)} height={size} viewBox="0 0 60 80" aria-hidden="true" style={{ overflow: "visible" }}>
        <defs><clipPath id={id}><path d={DROP}/></clipPath>
          <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.75"/><stop offset="100%" stopColor={color}/></linearGradient></defs>
        <path d={DROP} fill="var(--surface2)"/>
        <g clipPath={`url(#${id})`}>
          <path d={`M-60 ${top} q7.5 -4 15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 V82 H-60 Z`} fill={`url(#${id}g)`}
            style={{ animation: "bn-wave 2.6s linear infinite" }}/>
          <ellipse cx="22" cy="40" rx="4" ry="9" fill="rgba(255,255,255,0.35)"/>
        </g>
        <path d={DROP} fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="2"/>
        <text x="30" y="57" textAnchor="middle" fontSize="15" fontWeight="900" fill={inside ? "#fff" : "var(--text)"}
          style={{ paintOrder: "stroke", stroke: inside ? "rgba(0,0,0,0.18)" : "none", strokeWidth: 2 }}>{Math.round(v)}%</text>
      </svg>
      <span style={{ fontSize: size > 110 ? 13 : 11, fontWeight: 800, color: "var(--text2)", marginTop: 2, whiteSpace: "nowrap" }}>{label}</span>
      {sub && <span style={{ fontSize: size > 110 ? 12 : 10.5, color: "var(--muted)", fontWeight: 700, whiteSpace: "nowrap" }}>{sub}</span>}
    </div>
  );
}
// la vue en grand de l'humidite : des gouttes a la largeur reelle de la fenetre
function HumZoom({ list, col, o, lo, hi }) {
  const { W } = useBox();
  const g = fitGrid(list.length, W, 360, { ar: DROP_AR, extra: DROP_EXTRA + 14, max: 130, gap: 16 });
  return <>
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, auto)`, justifyContent: "space-evenly", gap: 16, padding: "8px 0" }}>
      {list.map(a => <DropGauge key={a.id} value={a.humidity} color={col(a.humidity)} size={Math.max(60, g.size)} label={amsLab(a)}
        sub={a.temp ? `${Number(a.temp).toFixed(1).replace(".", ",")} °C` : null}/>)}</div>
    <H2>Unité par unité</H2>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
      {list.map(a => { const c = col(a.humidity), trays = (a.trays || []).filter(trayCol);
        return <div key={a.id} style={{ padding: "11px 13px", borderRadius: 16, background: `linear-gradient(135deg, ${c}1a, transparent 65%), var(--surface2)`,
          border: `1px solid ${c}33`, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 900, color: "var(--text)" }}>{amsLab(a)}</span>
            <span style={{ fontSize: 15, fontWeight: 900, color: c }}>{a.humidity} %</span>
            {a.temp > 0 && <Muted size={12}>{Number(a.temp).toFixed(1).replace(".", ",")} °C</Muted>}
            {a.is_drying && a.dry_time > 0 && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: "#ea580c" }}>séchage · {fmtDur(a.dry_time * 60)}</span>}
          </div>
          <div style={{ height: 6, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, a.humidity)}%`, background: c }}/></div>
          {trays.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {trays.map(t => <span key={t.id} title={t.filament_type} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--text2)" }}>
              <span style={{ width: 14, height: 14, borderRadius: 5, background: trayCol(t), border: "1px solid rgba(0,0,0,0.2)" }}/>{t.filament_type}</span>)}</div>}
        </div>; })}
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {[["sec", `sous ${lo} %`, "#22c55e"], ["à surveiller", `${lo} à ${hi} %`, "#f59e0b"], ["humide", `au-delà de ${hi} %`, "#ef4444"]].map(([l, r, c]) => (
        <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 20, background: `${c}18`,
          fontSize: 12, fontWeight: 800, color: c }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: c }}/>{l} <Muted size={11.5}>{r}</Muted></span>))}
    </div>
  </>;
}
// des barres (une par valeur), « hi » en plein ; labels et valeurs si la place le permet
function Bars({ values, labels, color, height = 40, hi = -1, showValues = false, fmt = v => v, titles, onPick, picked = -1 }) {
  const max = Math.max(1, ...values);
  const gap = values.length > 20 ? 2 : 4;
  return (
    <div style={{ display: "flex", gap, alignItems: "flex-end", height: height + (labels ? 15 : 0) + (showValues ? 14 : 0) }}>
      {values.map((v, i) => (
        <div key={i} title={titles?.[i]} onClick={onPick ? e => { e.stopPropagation(); onPick(i); } : undefined}
          style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: onPick ? "pointer" : undefined }}>
          {showValues && <span style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 700, whiteSpace: "nowrap" }}>{v ? fmt(v) : ""}</span>}
          <span data-pk="" style={{ width: "100%", maxWidth: 30, borderRadius: values.length > 20 ? 3 : 5, minHeight: 3,
            height: `${Math.max(3, Math.round(height * v / max))}px`, background: i === hi || i === picked ? color : `${color}59`,
            outline: i === picked ? `2px solid ${color}` : "none", outlineOffset: 2 }}/>
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
// la hauteur que prennent des Stats de n cases dans W (pour reserver la place)
const statsH = (n, W) => n ? Math.ceil(n / Math.max(1, Math.min(n, Math.floor((W + 6) / 96)))) * 49 - 6 : 0;
// le chiffre-cle (qui prend ce qui reste), puis autant de blocs que la hauteur en tient, dans l'ordre :
// une grande case se remplit au lieu de laisser un trou. blocks : [{ h: hauteur ou W => hauteur, node, opt }]
// (opt : facultatif, on passe au suivant s'il ne tient pas)
function Stack({ head, min = 70, blocks }) {
  const { W, H, zoom } = useBox();
  let left = H - min;
  const on = [];
  for (const b of blocks) {
    if (!b) continue;
    const h = typeof b.h === "function" ? b.h(W) : b.h;
    if (h + 8 <= left) { on.push(b); left -= h + 8; } else if (!b.opt) break;
  }
  const used = on.reduce((a, b) => a + (typeof b.h === "function" ? b.h(W) : b.h) + 8, 0) + (on.length ? 4 : 0);
  if (!on.length) return head;
  return <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}><BoxCtx.Provider value={{ W, H: H - used, zoom }}>{head}</BoxCtx.Provider></div>
    {on.map((b, i) => <div key={i} style={{ flexShrink: 0, marginTop: i ? 8 : 12 }}>{b.node}</div>)}
  </div>;
}
// une bande de vignettes (les impressions du jour…) : autant que la largeur en tient
function Thumbs({ list, size = 52, title }) {
  const { W } = useBox();
  const n = Math.max(1, Math.floor((W + 6) / (size + 6)));
  const more = list.length - n;
  return <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
    {title && <H2>{title}</H2>}
    <div style={{ display: "flex", gap: 6 }}>{list.slice(0, more > 0 ? n - 1 : n).map(x => <span key={x.key} title={x.title} style={{ position: "relative", flexShrink: 0 }}>
      <img data-pk="" src={x.img} alt="" onError={e => { e.currentTarget.style.visibility = "hidden"; }}
        style={{ width: size, height: size, borderRadius: 12, objectFit: "cover", background: "var(--surface2)", display: "block" }}/>
      {x.dot && <span style={{ position: "absolute", right: -2, bottom: -2, width: 11, height: 11, borderRadius: "50%", border: "2px solid var(--surface)", background: x.dot }}/>}
    </span>)}
    {more > 0 && <span style={{ width: size, height: size, borderRadius: 12, background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 13, fontWeight: 900, color: "var(--text2)", flexShrink: 0 }}>+{more + 1}</span>}</div>
  </div>;
}
function Stats({ items }) {
  const { W, zoom } = useBox();
  const list = items.filter(it => it && it[1] != null && it[1] !== "" && it[1] !== "—");
  const cols = Math.max(1, Math.min(list.length, Math.floor((W + 6) / (zoom ? 150 : 96))));
  const wrap = zoom ? { overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.25 }
    : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: zoom ? 8 : 6 }}>
    {list.map(([l, x, c]) => <div key={l} className="card-sm" style={{ padding: zoom ? "9px 11px" : "6px 8px", minWidth: 0 }}>
      <div style={{ fontSize: zoom ? 11.5 : 10.5, fontWeight: 700, color: "var(--muted)", ...wrap }}>{l}</div>
      <div data-pk="" style={{ fontSize: zoom ? 17 : 14.5, fontWeight: 900, color: c || "var(--text)", marginTop: zoom ? 2 : 0, ...wrap }}>{x}</div></div>)}
  </div>;
}
function FactCards({ groups }) {
  const list = groups.map(g => ({ ...g, rows: g.rows.filter(r => r && r.v != null && r.v !== "") })).filter(g => g.rows.length);
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12 }}>
    {list.map(g => <div key={g.t} style={{ borderRadius: 18, padding: "12px 14px", background: `linear-gradient(160deg, ${g.c}1a, transparent 55%), var(--surface2)`,
      border: `1px solid ${g.c}33`, display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 28, height: 28, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
          background: `${g.c}26` }}>{g.i}</span>
        <span style={{ fontSize: 13.5, fontWeight: 900, color: "var(--text)" }}>{g.t}</span>
      </div>
      {g.rows.map((r, k) => <div key={r.l} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "7px 0",
        borderTop: k ? "1px dashed var(--border)" : "none" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", flex: 1, minWidth: 0 }}>{r.l}</span>
        <span style={{ textAlign: "right", minWidth: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14.5, fontWeight: 900, color: r.vc || "var(--text)" }}>{r.pre}{r.v}</span>
          {r.d && <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>{r.d}</span>}
        </span>
      </div>)}
    </div>)}
  </div>;
}
function Facts({ items }) {
  const { W } = useBox();
  const list = items.filter(it => it && it.v != null && it.v !== "");
  const cols = Math.max(1, Math.min(2, Math.floor((W + 10) / 220)));
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 10 }}>
    {list.map(it => <div key={it.l} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 16,
      background: `linear-gradient(135deg, ${it.c || "#64748b"}14, transparent 70%), var(--surface2)`, minWidth: 0 }}>
      <span style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18, background: `${it.c || "#64748b"}22`, color: it.c || "var(--text2)" }}>{it.i}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{it.l}</div>
        <div style={{ fontSize: 15.5, fontWeight: 900, color: it.vc || "var(--text)", lineHeight: 1.2, overflowWrap: "anywhere" }}>{it.v}</div>
        {it.d && <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginTop: 1 }}>{it.d}</div>}
      </div>
    </div>)}
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
      // l'impression en cours, avec son vrai nom (celui de l'imprimante est souvent le nom du profil)
      put("live", get("/prints", { status: "IN_PROGRESS", limit: 1 }).then(r => (r.prints || r.items || [])[0] || null));
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
      // a evaluer : relu avec le reste (une impression qui vient de finir y entre sans recharger la page)
      put("rate", get("/makerworld/to-rate"));
    };
    load();
    put("queue", get("/makerworld/queue"));
    put("mw", get("/makerworld/creator"));
    put("podium", get("/achievements/podium"));
    const iv = setInterval(load, 120000);
    return () => { dead = true; clearInterval(iv); };
  }, []);
  return d;
}
// une serie par jour (n jours jusqu'a aujourd'hui). Toutes les tuiles partagent UNE requete :
// les 31 derniers jours, gardes une minute (avant : un appel par jour et par tuile, jusqu'a 80
// au chargement, qui bouchaient les connexions du navigateur et retardaient tout l'accueil)
const DAYS_MAX = 31;
let daysCache = null;   // { at, key, p }
function loadDays() {
  const now = new Date(), key = ymd(now);
  if (daysCache && daysCache.key === key && Date.now() - daysCache.at < 60000) return daysCache.p;
  const from = new Date(now); from.setDate(now.getDate() - DAYS_MAX + 1);
  const p = client.get("/prints/kpis/daily", { params: { date_from: ymd(from), date_to: key, tz: -now.getTimezoneOffset() } })
    .then(r => (r.data || []).map(x => ({ ...x, day: new Date(`${x.date}T12:00:00`) })))
    .catch(() => { daysCache = null; return null; });
  daysCache = { at: Date.now(), key, p };
  return p;
}
function useDays(n) {
  const [v, setV] = useState(null);
  useEffect(() => {
    if (!n) { setV(null); return undefined; }
    let dead = false;
    loadDays().then(all => { if (!dead && all) setV(all.slice(-Math.min(n, DAYS_MAX))); });
    return () => { dead = true; };
  }, [n]);
  return v;
}

// ── Les tuiles ───────────────────────────────────────────────────────────────
// une liste qui defile dans la tuile (option « Defiler ») : toute la liste, la molette ou le doigt
const Scroller = ({ children, gap = 6 }) => <div onWheel={e => e.stopPropagation()} style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain",
  display: "flex", flexDirection: "column", gap, marginRight: -6, paddingRight: 6, paddingBottom: 14,
  maskImage: "linear-gradient(to bottom, #000 calc(100% - 22px), transparent)", WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 22px), transparent)" }}>{children}</div>;
const SCROLL = def => B("scroll", "Défiler dans la tuile", def, { hint: "Toute la liste dans la tuile, qu'on fait défiler au doigt ou à la molette." });
const rateColor = r => r == null ? "#94a3b8" : r >= 0.9 ? "#22c55e" : r >= 0.7 ? "#f59e0b" : "#ef4444";
// Aujourd'hui : un anneau de reussite, le compte, l'ecart avec hier ; en grand, face a hier
function Today({ v, p, o, sz, st, lp }) {
  const nav = useNavigate();
  const t0 = ymd(new Date());
  const mine = (p || []).filter(x => x.print_date && ymd(utc(x.print_date)) === t0);
  const strip = mine.length > 0 && <Thumbs title="Imprimées aujourd'hui" list={mine.map(x => ({ key: x.id, img: printImg(x.id), title: x.file_name,
    dot: okOf(x) ? "#22c55e" : "#ef4444" }))}/>;
  const rate = v?.count ? v.ok / v.count : null;
  const col = rateColor(rate);
  const sub = v && [o.weight && fmtG(v.weight_g), o.hours && `${fmtH(v.duration)} de machine`, o.cost && fmtEur(v.cost)].filter(Boolean).join(" · ");
  const hero = reserve => <Hero reserve={reserve} visual={o.ring && rate != null ? s => <Ring value={rate} size={s} color={col} cap="réussies">{Math.round(rate * 100)}%</Ring> : null}
    value={v ? v.count : "…"} unit={`impression${v?.count > 1 ? "s" : ""}`} sub={sub}
    delta={o.yesterday && v?.yesterday && <Delta now={v.count} before={v.yesterday.count}/>}/>;
  const versus = v?.yesterday && <Versus color="#3B82F6" rows={[["Impressions", v.count, v.yesterday.count, x => x || 0],
    ["Poids", v.weight_g, v.yesterday.weight_g, fmtG], ["Machine", v.duration, v.yesterday.duration, fmtH], ["Coût", v.cost, v.yesterday.cost, fmtEur]]}/>;
  return (
    <Tile icon={<CalendarClock size={15}/>} color="#3B82F6" label="Aujourd'hui" to="/prints"
      mini={sz.h === 0.5} summary={v ? <>{v.count}{rate != null && <span style={{ fontSize: 12, color: col }}>{Math.round(rate * 100)} %</span>}</> : "…"}
      zoom={<>{hero(0)}<Stats items={v ? [["Réussies", v.ok ?? "—", "#16a34a"], ["Ratées", v.count != null && v.ok != null ? v.count - v.ok : null, v.count - v.ok ? "#dc2626" : undefined],
        ["Poids", fmtG(v.weight_g)], ["Machine", fmtH(v.duration)], ["Coût", fmtEur(v.cost)]] : []}/>
        {versus && <><H2>Face à hier</H2>{versus}</>}
        {mine.length > 0 && <><H2>Imprimées aujourd'hui</H2><div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {mine.map(x => <Item key={x.id} img={printImg(x.id)} dot={okOf(x) ? "#22c55e" : "#ef4444"} size={52} title={x.file_name || `Impression #${x.id}`}
            sub={[x.print_date && utc(x.print_date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), x.duration_seconds && fmtDur(x.duration_seconds),
              x.total_weight_g && fmtG(x.total_weight_g)].filter(Boolean).join(" · ")} onClick={() => nav(`/prints?id=${x.id}`)}/>)}</div></>}</>}>
      {({ W, H }) => v && v.count === 0 ? <TodayEmpty st={st} y={v.yesterday} W={W} H={H} lp={lp}/> : <Stack min={W < 240 ? 150 : 96} head={hero(0)} blocks={[versus && { h: W < 240 ? 150 : 104, node: versus },
        v && { opt: true, h: w => statsH(3, w), node: <Stats items={[["Réussies", v.ok ?? "—", "#16a34a"], ["Ratées", v.count - (v.ok || 0), v.count - (v.ok || 0) ? "#dc2626" : undefined],
          ["Coût", fmtEur(v.cost)]]}/> },
        strip && { opt: true, h: 76, node: strip }]}/>}
    </Tile>
  );
}
const liveName = (lp, st) => lp?.translated_name || lp?.file_name || st?.print_name || "";
// aujourd'hui, rien encore : la premiere du jour en cours (son anneau, sa fin), ou l'imprimante qui dort
function TodayEmpty({ st, y, W, H, lp }) {
  const live = isLive(st);
  const pct = Math.round(st?.progress || 0), left = st?.remaining_minutes || 0;
  const narrow = W < 215, s = Math.max(40, Math.min(H - 6, narrow ? 64 : 88, W * 0.36));
  const yest = y?.count ? `Hier : ${y.count} impression${y.count > 1 ? "s" : ""} · ${fmtH(y.duration)}` : "Hier : rien non plus";
  const visual = live
    ? <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}><Ring value={pct / 100} size={s} color="#3B82F6">{pct}%</Ring>
      <span aria-hidden="true" style={{ position: "absolute", inset: -3, borderRadius: "50%", boxShadow: "0 0 16px rgba(59,130,246,0.45)",
        animation: "dryPulse 2.5s ease-in-out infinite" }}/></span>
    : <span aria-hidden="true" style={{ position: "relative", width: s, height: s, flexShrink: 0, borderRadius: "50%", display: "flex", alignItems: "center",
      justifyContent: "center", background: "radial-gradient(circle at 35% 30%, rgba(59,130,246,0.22), rgba(59,130,246,0.06))", color: "#3B82F6" }}>
      <CalendarClock size={Math.round(s * 0.42)}/>
      {["z", "z", "Z"].map((c, i) => <span key={i} style={{ position: "absolute", right: -2 - i * 5, top: 2 - i * 9, fontSize: s * (0.16 + i * 0.05), fontWeight: 900,
        color: "#93c5fd", animation: `bn-zz 2.4s ease-in-out ${i * 0.4}s infinite`, opacity: 0 }}>{c}</span>)}</span>;
  return <div style={{ flex: 1, display: "flex", flexDirection: narrow && H >= 150 ? "column" : "row", alignItems: "center", justifyContent: "center",
    gap: narrow ? 8 : 14, textAlign: narrow && H >= 150 ? "center" : "left", minWidth: 0 }}>
    {H >= 44 && visual}
    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: narrow ? 14 : 16, fontWeight: 900, color: "var(--text)", lineHeight: 1.2 }}>
        {live ? "La première du jour arrive" : "Pas encore d'impression aujourd'hui"}</span>
      {live && <span style={{ fontSize: 12, fontWeight: 800, color: "#3B82F6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {liveName(lp, st) ? `${liveName(lp, st)} · ` : ""}{left ? `fin à ${finAt(left)}` : "bientôt finie"}</span>}
      {H >= 70 && <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{live ? yest : `${yest} · l'imprimante se repose`}</span>}
    </div>
  </div>;
}
// les n derniers jours en barres : heures, impressions ou grammes ; en grand, on change de periode et de mesure
const METRICS = { h: ["les heures", x => x.duration || 0, fmtH], n: ["les impressions", x => x.count || 0, x => `${x}`], g: ["les grammes", x => x.weight_g || 0, fmtG] };
const dayLabel = (n, x) => n <= 7 ? x.day.toLocaleDateString("fr-FR", { weekday: "narrow" }) : n <= 14 ? String(x.day.getDate())
  : (x.day.getDate() % 5 === 0 ? String(x.day.getDate()) : "");
function DaysChart({ v, n, metric, color, H, W, big, onPick, picked }) {
  const [, val, fmt] = METRICS[metric] || METRICS.h;
  const today = ymd(new Date());
  const labels = H >= 60;
  const values = W / n >= (big ? 30 : 34) && H >= 100;
  const h = Math.max(12, H - (labels ? 15 : 0) - (values ? 14 : 0));
  return <Bars values={v.map(val)} labels={labels ? v.map(x => dayLabel(n, x)) : null} color={color} height={h}
    hi={v.findIndex(x => ymd(x.day) === today)} showValues={values} fmt={fmt}
    titles={v.map(x => `${x.day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} : ${fmt(val(x))}`)} onPick={onPick} picked={picked}/>;
}
// la hauteur d'un graphe en grand : a la mesure de la largeur (un telephone n'a pas besoin d'un graphe d'un demi-ecran)
const zoomChartH = W => Math.round(Math.max(110, Math.min(220, W * 0.45)));
function WeekZoom({ o }) {
  const [n, setN] = useState(o.range || 7);
  const [m, setM] = useState(o.metric || "h");
  const [pick, setPick] = useState(null);   // le jour touche (son detail sous le graphe)
  const v = useDays(n);
  const { W } = useBox();
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
    {v && <div><DaysChart v={v} n={n} metric={m} color="#8B5CF6" W={W} H={zoomChartH(W)} big onPick={i => setPick(v[i]?.date)}
      picked={v.findIndex(x => x.date === pick)}/></div>}
    {v && <DayDetail date={pick || v[v.length - 1]?.date}/>}
  </>;
}
// le detail d'un jour : les impressions qui ont tourne ce jour-la, et combien d'heures chacune y a pris
function DayDetail({ date }) {
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  useEffect(() => {
    if (!date) return undefined;
    let dead = false;
    setItems(null);
    client.get("/prints/kpis/daily", { params: { date_from: date, date_to: date, tz: -new Date().getTimezoneOffset(), detail: 1 } })
      .then(r => { if (!dead) setItems(r.data?.[0]?.items || []); }).catch(() => { if (!dead) setItems([]); });
    return () => { dead = true; };
  }, [date]);
  const d = date ? new Date(`${date}T12:00:00`) : null;
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <H2>{d ? d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : ""}{items ? ` · ${fmtH(items.reduce((t, x) => t + x.seconds, 0))}` : ""}</H2>
    {items == null ? <Muted>…</Muted> : !items.length ? <Muted>L'imprimante n'a pas tourné ce jour-là.</Muted>
      : items.map((x, i) => <div key={`${x.id}-${i}`} onClick={() => nav(`/prints?id=${x.id}`)} style={{ display: "flex", alignItems: "center", gap: 10,
        padding: "8px 10px", borderRadius: 12, background: "var(--surface2)", cursor: "pointer", minWidth: 0 }}>
        <img src={printImg(x.id)} alt="" onError={e => { e.currentTarget.style.visibility = "hidden"; }}
          style={{ width: 36, height: 36, borderRadius: 9, objectFit: "cover", background: "var(--surface)", flexShrink: 0 }}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>lancée le {new Date(x.start).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {x.status === "IN_PROGRESS" ? " · en cours" : ""}</div>
        </div>
        <span style={{ fontSize: 14, fontWeight: 900, color: "#8B5CF6", whiteSpace: "nowrap" }}>{fmtDur(x.seconds)}</span>
      </div>)}
  </div>;
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
// a faire : autant de modeles que la place en tient (le premier en grand s'il y a la place).
// Les etats sont ceux de la page « A faire » (ams, partial, stock, short) ; un clic ouvre la
// fenetre, le petit bouton de chaque modele ouvre directement sa fiche.
const QSTATE = {
  ams: ["prêt (AMS)", "#16a34a", "●"], partial: ["en partie prêt", "#16a34a", "◐"], stock: ["à charger", "#d97706", "○"],
  short: ["filament manquant", "#dc2626", "✕"], unknown: ["inconnu", "var(--muted)", "?"],
};
const qState = m => QSTATE[m.status] || QSTATE.unknown;
const canGo = m => m.status === "ams" || m.status === "partial";
const queueSub = (m, o) => { const [l, c, ic] = qState(m);
  return <><span style={{ color: c, fontWeight: 800 }}>{ic} {m.printing ? `en cours${m.progress != null ? ` · ${m.progress} %` : ""}` : l}</span>
    {m.seconds ? ` · ${fmtDur(m.seconds)}` : ""}{o.weight && m.weight_g ? ` · ${fmtG(m.weight_g)}` : ""}</>; };
// les filaments d'un modele : une pastille par couleur, cerclee selon ce qu'on a (vert AMS, orange stock, rouge rien)
const FilaDots = ({ list, size = 14 }) => <span style={{ display: "inline-flex", gap: 3, flexWrap: "wrap" }}>
  {(list || []).map((f, i) => <span key={i} title={`${f.type} ${Math.round(f.g)} g → ${f.chosen ? f.chosen.name + (f.chosen.in_ams ? " (AMS)" : "") : "rien en stock"}`}
    style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, background: hexCss(f.chosen?.color || f.color),
      border: `2px solid ${!f.chosen ? "#ef4444" : f.chosen.enough_ams ? "#22c55e" : f.chosen.enough_stock ? "#f59e0b" : "#ef4444"}` }}/>)}</span>;
// la fenetre de « À faire » : les modeles en deux sections, triees au choix (la priorite a chaque ouverture)
function NextSorted({ models, card }) {
  const [by, setBy] = useState("prio");
  const list = sortQueue(models, by);
  const grid = l => <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: 8 }}>{l.map(card)}</div>;
  return <>
    <label onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--muted)", flexWrap: "wrap" }}>
      Trier
      <select value={by} onChange={e => setBy(e.target.value)} style={{ height: 30, borderRadius: 9, border: "1px solid var(--border)", maxWidth: "100%",
        background: "var(--surface2)", color: "var(--text)", fontWeight: 700, fontSize: 12.5, padding: "0 8px" }}>
        {QUEUE_SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
    {list.some(canGo) && <><H2>Imprimables maintenant</H2>{grid(list.filter(canGo))}</>}
    {list.some(m => !canGo(m)) && <><H2>À préparer</H2>{grid(list.filter(m => !canGo(m)))}</>}
  </>;
}
function Next({ q, o, sz }) {
  const [sheet, setSheet] = useState(null);
  const narrow = useRef(false);   // etroite : le bouton « fiche » passe en coin de la vignette
  const all = q?.models || [];
  const models = all.filter(m => !o.ready || canGo(m));
  const t = q?.totals || {};
  const ready = t.ams ?? all.filter(m => m.status === "ams").length;
  const part = t.partial ?? all.filter(m => m.status === "partial").length;
  const open = m => setSheet({ design_id: m.design_id, title: m.title, title_fr: m.title_fr, cover_url: m.cover_url });
  // le petit bouton « fiche » : ouvre le modele sans passer par la fenetre
  const go = (m, s = 26) => <button type="button" aria-label="Ouvrir la fiche" title="Ouvrir la fiche du modèle"
    onClick={e => { e.stopPropagation(); open(m); }} style={{ width: s, height: s, borderRadius: s / 3.2, border: "1px solid var(--border)", flexShrink: 0,
      background: "var(--surface)", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
    <ArrowUpRight size={s >= 26 ? 14 : 12}/></button>;
  const row = (m, size, card) => <Item key={m.design_id} img={o.thumbs || card ? (m.cover_url ? mwImg(m.cover_url, 320) : null) : undefined} size={size} card={card}
    dot={canGo(m) ? "#22c55e" : null} title={m.title_fr || m.title} sub={queueSub(m, o)}
    right={card || (!narrow.current && size >= 30) ? go(m) : null} corner={!card && narrow.current && o.thumbs ? go(m, 20) : null}/>;
  // en grand : une carte par modele, tout ce que la page dit de lui
  const card = m => { const [l, c, ic] = qState(m);
    return <div key={m.design_id} onClick={() => open(m)} style={{ display: "flex", gap: 12, padding: 10, borderRadius: 16, cursor: "pointer", minWidth: 0,
      background: `linear-gradient(135deg, ${canGo(m) ? "rgba(34,197,94,0.12)" : "transparent"}, transparent 60%), var(--surface2)`,
      border: `1px solid ${m.printing ? "#3b82f6" : canGo(m) ? "rgba(34,197,94,0.35)" : "var(--border)"}` }}>
      {m.cover_url ? <img src={mwImg(m.cover_url, 240)} alt="" style={{ width: 72, height: 72, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}/>
        : <span style={{ width: 72, height: 72, borderRadius: 12, background: "var(--surface)", flexShrink: 0 }}/>}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", ...clamp(2) }}>{m.title_fr || m.title || `Modèle ${m.design_id}`}</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: m.printing ? "#fff" : c, padding: "1px 8px", borderRadius: 10,
            background: m.printing ? "#3b82f6" : `${c === "var(--muted)" ? "#94a3b8" : c}1f` }}>
            {m.printing ? `🖨️ en cours${m.progress != null ? ` · ${m.progress} %` : ""}` : `${ic} ${l}`}</span>
          {m.planned && <span style={{ fontSize: 11, fontWeight: 800, color: "#16a34a" }}>📌 retenu</span>}
          {(m.qty || 1) > 1 && <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text2)" }}>×{m.qty}</span>}
          {m.printed > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>déjà imprimé {m.printed}×</span>}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[m.profile?.title, m.profile && m.profile.plates_total > 1 && `${m.profile.plates}/${m.profile.plates_total} plateaux`, m.seconds && fmtDur(m.seconds),
            m.weight_g && fmtG(m.weight_g), m.cost != null && fmtEur(m.cost)].filter(Boolean).join(" · ")}</div>
        {m.ready_now?.plates > 0 && <div style={{ fontSize: 11.5, fontWeight: 800, color: "#16a34a" }}>
          ▶ faisable maintenant : {m.ready_now.plates} plateau{m.ready_now.plates > 1 ? "x" : ""}
          {m.ready_now.seconds ? ` · ${fmtDur(m.ready_now.seconds)}` : ""}{m.ready_now.weight_g ? ` · ${fmtG(m.ready_now.weight_g)}` : ""}</div>}
        <FilaDots list={m.filaments}/>
      </div>
      <ChevronRight size={16} style={{ color: "var(--muted)", alignSelf: "center", flexShrink: 0 }}/>
    </div>; };
  return (
    <Tile icon={<ListChecks size={15}/>} color="#22C55E" label="À faire" to="/prints?tab=queue"
      mini={sz.h === 0.5} summary={q ? <>{ready + part}<span style={{ fontSize: 12, color: "var(--muted)" }}>/ {all.length} prêts</span></> : "…"}
      badge={all.length ? <span title="prêts avec l'AMS / dans la liste" style={{ fontSize: 11, fontWeight: 800, color: ready + part ? "#16a34a" : "var(--muted)" }}>
        {ready + part}/{all.length}</span> : null}
      zoom={models.length ? <>
        <Stats items={[["Modèles", all.length], ["Prêts (AMS)", ready, "#16a34a"], part ? ["En partie", part, "#16a34a"] : null,
          t.stock ? ["À charger", t.stock, "#d97706"] : null, t.short ? ["Manque", t.short, "#dc2626"] : null,
          ["Durée", fmtH(t.seconds ?? all.reduce((a, m) => a + (m.seconds || 0), 0))], ["Poids", fmtG(t.weight_g ?? all.reduce((a, m) => a + (m.weight_g || 0), 0))],
          t.cost ? ["Coût", fmtEur(t.cost)] : null]}/>
        <NextSorted models={models} card={card}/>
      </> : null}>
      {({ W, H }) => { narrow.current = W < 215; return <>
        {!models.length ? <Empty>{q === undefined ? "…" : o.ready ? "Rien de prêt dans l'AMS" : "Rien dans « À faire »"}</Empty>
          : o.scroll ? <Scroller>{models.map((m, i) => row(m, i ? 34 : Math.min(52, H)))}</Scroller> : fitList(models, row, W, H)}
        {/* la fiche s'ouvre par-dessus ; ses clics et ses touches ne remontent pas jusqu'a la tuile */}
        {sheet && <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          <MakerWorldModelSheet designId={sheet.design_id} preview={sheet} onClose={() => setSheet(null)}/></span>}
      </>; }}
    </Tile>
  );
}
// le rappel « pas encore de photo » : seulement quand la tuile a la largeur
const PhotoHint = () => useBox().W >= 215 ? <Chip color="#0EA5E9" title="Pas encore de photo"><Camera size={12}/></Chip> : null;
// les dernieres impressions : la derniere en grand, puis la liste
const okOf = x => x.status === "SUCCESS" || x.status === "PARTIAL";
// a-t-elle une photo : la sienne (prise a la main, ou choisie), ou celle de son groupe
const hasPhoto = x => !!(x.cover_photo || (x.snapshots || []).some(s => s.trigger === "manual") || x.group_cover_photo || x.group_has_photos);
// les membres d'un groupe en une seule carte (a la place du plus recent) : le nom du groupe, les totaux
function groupCards(prints) {
  const out = [], at = {};
  for (const x of prints || []) {
    if (!x.group_id) { out.push(x); continue; }
    const k = x.group_id;
    if (at[k] == null) {
      at[k] = out.length;
      out.push({ ...x, file_name: x.group_name || x.file_name, members: [x] });
    } else {
      const g = out[at[k]];
      g.members.push(x);
      g.duration_seconds = (g.duration_seconds || 0) + (x.duration_seconds || 0);
      g.total_weight_g = (g.total_weight_g || 0) + (x.total_weight_g || 0);
      g.total_cost = (g.total_cost || 0) + (x.total_cost || 0);
    }
  }
  return out.map(x => {
    if (!x.members) return x;
    const ok = x.members.filter(okOf).length;
    const cover = x.members.find(m => m.id === x.group_cover_print_id) || x.members[0];
    return { ...x, id: cover.id, status: ok === x.members.length ? "SUCCESS" : ok ? "PARTIAL" : "FAILED", partial: ok > 0 && ok < x.members.length,
      snapshots: x.members.flatMap(m => m.snapshots || []), cover_photo: x.members.find(m => m.cover_photo)?.cover_photo || null };
  });
}
function Last({ p, o, sz, st, lp }) {
  const nav = useNavigate();
  const narrowL = useRef(false);   // etroite : le bouton « fiche » passe en coin de la vignette
  const live = isLive(st) && lp ? { ...lp, live: true } : null;
  const list = [...(live ? [live] : []), ...groupCards(p)];
  if (!list.length) return null;
  const sub = x => x.live ? <span style={{ color: "#3b82f6", fontWeight: 800 }}>● en cours · {Math.round(st?.progress || 0)} %{st?.remaining_minutes ? ` · fin à ${finAt(st.remaining_minutes)}` : ""}</span>
    : [x.members && `${x.members.length} impressions`, o.when && x.print_date && ago(x.print_date), x.duration_seconds && fmtDur(x.duration_seconds), x.total_weight_g && fmtG(x.total_weight_g),
    o.cost && x.total_cost && fmtEur(x.total_cost)].filter(Boolean).join(" · ");
  // un clic sur la tuile ouvre la fenetre ; le petit bouton de chaque impression ouvre sa fiche
  const go = (x, s = 26) => <button type="button" aria-label="Ouvrir la fiche" title="Ouvrir la fiche de l'impression"
    onClick={e => { e.stopPropagation(); nav(x.members ? `/prints?group=${x.group_id}` : `/prints?id=${x.id}`); }} style={{ width: s, height: s, borderRadius: s / 3.2, border: "1px solid var(--border)",
      flexShrink: 0, background: "var(--surface)", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
    <ArrowUpRight size={s >= 26 ? 14 : 12}/></button>;
  const row = (x, size, card, inZoom) => <Item key={x.id} img={printImg(x.id)} dot={x.live ? "#3b82f6" : x.partial ? "#f59e0b" : okOf(x) ? "#22c55e" : "#ef4444"} size={size} card={card}
    title={x.file_name || x.translated_name || `Impression #${x.id}`} sub={sub(x)} onClick={inZoom ? () => nav(x.members ? `/prints?group=${x.group_id}` : `/prints?id=${x.id}`) : undefined}
    right={<>{o.photo && !x.live && !hasPhoto(x) && (size >= 44 || card) && <PhotoHint/>}{!inZoom && (card || (!narrowL.current && size >= 30)) && go(x)}</>}
    corner={!inZoom && !card && narrowL.current ? go(x, 20) : null}/>;
  return (
    <Tile icon={<History size={15}/>} color="#0EA5E9" label="Dernières impressions" to="/prints"
      mini={sz.h === 0.5} summary={<span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis" }}>
        <span style={{ color: okOf(list[0]) ? "#22c55e" : "#ef4444" }}>● </span>{list[0].file_name || list[0].translated_name}</span>}
      zoom={<>
        {(done => <Stats items={[["Réussies", `${done.filter(okOf).length} / ${done.length}`, "#16a34a"], ["Durée", fmtH(done.reduce((t, x) => t + (x.duration_seconds || 0), 0))],
          ["Poids", fmtG(done.reduce((t, x) => t + (x.total_weight_g || 0), 0))]]}/>)(list.filter(x => !x.live))}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{list.map(x => row(x, 56, false, true))}</div></>}>
      {({ W, H }) => {
        narrowL.current = W < 215;
        if (o.scroll) return <Scroller>{list.map((x, i) => row(x, i ? 34 : Math.min(52, H)))}</Scroller>;
        return fitList(list, row, W, H);
      }}
    </Tile>
  );
}
// le stock : le total, et les bobines les plus basses (pastilles ou liste) qui remplissent la place
const spoolPct = x => x.filament_weight_g ? (x.remaining_weight_g || 0) / x.filament_weight_g : null;
const spoolName = x => x.filament_translated_name || x.filament_name || "Bobine";
// le compte des bobines presque vides, quand la tuile a la largeur
function FewChip({ n }) {
  if (useBox().W < 215) return null;
  return <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: "#dc2626", padding: "1px 7px", borderRadius: 10, background: "rgba(220,38,38,0.12)",
    whiteSpace: "nowrap" }}>{n} presque vide{n > 1 ? "s" : ""}</span>;
}
function Stock({ s, o, sz }) {
  const list = Array.isArray(s) ? s : [];
  const kg = list.reduce((a, x) => a + (x.remaining_weight_g || 0), 0);
  const low = list.filter(x => x.remaining_weight_g != null)
    .sort((a, b) => o.sort === "pct" ? (spoolPct(a) ?? 1) - (spoolPct(b) ?? 1) : a.remaining_weight_g - b.remaining_weight_g);
  const line = x => <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text2)", minWidth: 0, height: 22 }}>
    <SpoolDot color={x.filament_color} pct={spoolPct(x)} size={20}/>
    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}><W text={spoolName(x)}/></span>
    <span data-pk="" style={{ fontWeight: 800, color: "#d97706" }}>{Math.round(x.remaining_weight_g)} g</span></div>;
  const few = list.filter(x => (x.remaining_weight_g ?? 999) < 200).length;
  const head = <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
    <span data-pk="" style={{ fontSize: 24, fontWeight: 900, color: "var(--text)", lineHeight: 1.05 }}>{s === undefined ? "…" : list.length}</span>
    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>bobines{o.kg ? ` · ${fmtG(kg)}` : ""}</span>
    {few > 0 && <FewChip n={few}/>}</div>;
  return (
    <Tile icon={<Package size={15}/>} color="#F59E0B" label="Stock" to="/filaments"
      mini={sz.h === 0.5} summary={<>{list.length}<span style={{ display: "inline-flex", gap: 2 }}>{low.slice(0, 3).map(x => <SpoolDot key={x.id} color={x.filament_color} pct={spoolPct(x)} size={22}/>)}</span></>}
      zoom={<StockZoom list={list} low={low} kg={kg}/>}>
      {({ W, H }) => {
        const rest = H - 34;
        if (rest < 20) return head;
        if (o.style === "list") return <>{head}<div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>{low.slice(0, fitRows(rest, 22, 5)).map(line)}</div></>;
        // les pastilles grandissent pour remplir la case ; trop nombreuses, seules les plus basses qui tiennent
        // de la place : le poids sous chaque pastille
        const lg = fitGrid(low.length, W, rest, { gap: 6, max: 60, extra: 15 });
        const labels = lg.size >= 34;
        let g = labels ? lg : fitGrid(low.length, W, rest, { gap: 6, max: 56 });
        if (g.size < 26) { const f = fillGrid(W, rest, 26, 6); g = { cols: f.cols, size: Math.min(f.size, Math.max(20, rest - 2)), n: f.n }; }
        return <>{head}<div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, ${g.size}px)`, gap: 6, alignContent: "center",
          justifyContent: "space-evenly", marginTop: 4 }}>
          {low.slice(0, g.n || low.length).map(x => <span key={x.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <SpoolDot color={x.filament_color} pct={spoolPct(x)} size={g.size} title={`${spoolName(x)} · ${Math.round(x.remaining_weight_g)} g`}/>
            {labels && <span style={{ fontSize: 10.5, fontWeight: 800, lineHeight: "14px", whiteSpace: "nowrap",
              color: x.remaining_weight_g < 200 ? "#dc2626" : "var(--muted)" }}>{fmtG(x.remaining_weight_g)}</span>}</span>)}</div></>;
      }}
    </Tile>
  );
}
function StockZoom({ list, low, kg }) {
  const worth = list.reduce((t, x) => { const pr = x.price_override || x.filament_price; return t + (pr && x.filament_weight_g ? pr * (x.remaining_weight_g || 0) / x.filament_weight_g : 0); }, 0);
  const inAms = list.filter(x => x.ams_tray).length;
  // par matiere : le nombre de bobines et le poids, en barres
  const by = Object.values(list.reduce((m, x) => { const k = x.filament_material || "Autre";
    (m[k] = m[k] || { k, n: 0, g: 0, colors: [] }); m[k].n++; m[k].g += x.remaining_weight_g || 0; m[k].colors.push(x.filament_color); return m; }, {}))
    .sort((a, b) => b.g - a.g);
  const top = Math.max(1, ...by.map(x => x.g));
  return <>
    <Stats items={[["Bobines", list.length], ["Poids", fmtG(kg)], worth ? ["Valeur restante", fmtEur(worth), "#16a34a"] : null, inAms ? ["Dans l'AMS", inAms] : null,
      ["Sous 200 g", list.filter(x => (x.remaining_weight_g ?? 999) < 200).length, "#dc2626"], ["Sous 15 %", list.filter(x => (spoolPct(x) ?? 1) < 0.15).length, "#d97706"]]}/>
    {by.length > 1 && <><H2>Par matière</H2><div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {by.map(x => <div key={x.k} style={{ display: "grid", gridTemplateColumns: "92px minmax(0,1fr) auto", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.k}</span>
        <span style={{ height: 14, borderRadius: 7, background: "var(--surface2)", overflow: "hidden", display: "flex" }}>
          {x.colors.map((c, i) => <span key={i} style={{ width: `${(100 * x.g / top) / x.colors.length}%`, background: hexCss(c) }}/>)}</span>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap" }}>{x.n} · {fmtG(x.g)}</span></div>)}</div></>}
    <H2>Les plus basses</H2>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 8 }}>
      {low.slice(0, 40).map(x => { const pc = spoolPct(x); const c = pc == null ? "#94a3b8" : pc < 0.15 ? "#ef4444" : pc < 0.35 ? "#f59e0b" : "#22c55e";
        return <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 14, background: "var(--surface2)", minWidth: 0 }}>
          <SpoolDot color={x.filament_color} pct={pc} size={34}/>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{spoolName(x)}</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: c, whiteSpace: "nowrap" }}>{fmtG(x.remaining_weight_g)}</span></div>
            {(x.filament_manufacturer || x.ams_tray) && <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {[x.filament_manufacturer, x.ams_tray && `dans l'AMS ${x.ams_tray}`].filter(Boolean).join(" · ")}</span>}
            <span style={{ height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${(pc ?? 0) * 100}%`, background: c }}/></span>
          </div></div>; })}</div>
  </>;
}
// le sechage : un anneau par AMS qui seche, sinon ce qui est a secher
// la ventilation d'un sechage : un ventilateur qui tourne, en badge sur l'anneau (seulement si l'AMS le dit)
const FanBadge = ({ a, size = 16 }) => (a.dry_fan1 || a.dry_fan2) ? <span title={`Ventilation${a.dry_fan1 && a.dry_fan2 ? " (2 ventilateurs)" : ""}${a.dry_sub_status === 2 ? " · déshumidification" : a.dry_sub_status === 1 ? " · chauffe" : ""}`}
  style={{ position: "absolute", top: -3, right: -3, width: size, height: size, borderRadius: "50%", background: "var(--surface)", color: "#0ea5e9",
    display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 1.5px rgba(14,165,233,0.45)", zIndex: 1 }}>
  <Fan size={Math.round(size * 0.72)} style={{ animation: "spin 1.4s linear infinite" }}/></span> : null;
const amsLab = a => a.id >= 128 ? `HT-${String.fromCharCode(65 + a.id - 128)}` : `AMS-${String.fromCharCode(65 + a.id)}`;
function Dry({ v, status, o, sz }) {
  const drying = (status?.ams_list || []).filter(a => a.is_drying && a.dry_time > 0);
  const k = v?.kpis;
  const todo = v?.to_dry || [];
  const line = x => <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)", height: 18 }}>
    <span data-pk="" style={{ width: 10, height: 10, borderRadius: "50%", background: hexCss(x.color), flexShrink: 0 }}/>
    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</span>
    <span style={{ fontWeight: 800, color: "#dc2626" }}>{x.age_days != null ? `${x.age_days} j` : "jamais"}</span></div>;
  const prog = a => { const tot = (a.dry_duration || 0) * 60; return tot ? Math.max(0, Math.min(1, 1 - (a.dry_time || 0) / tot)) : 0; };
  // une unite qui seche : l'anneau (avancement, temperature au centre), son nom, le restant, la barre
  const dryRow = (a, ring, W) => (
    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <span style={{ position: "relative", flexShrink: 0, display: "inline-flex" }}>
        <Ring value={prog(a)} size={ring} color="#f97316">{a.dry_temperature ? `${a.dry_temperature}°` : ""}</Ring>
        <FanBadge a={a} size={Math.max(14, Math.round(ring * 0.3))}/>
        <span aria-hidden="true" style={{ position: "absolute", inset: -3, borderRadius: "50%", boxShadow: "0 0 14px rgba(249,115,22,0.45)",
          animation: "dryPulse 2.5s ease-in-out infinite", pointerEvents: "none" }}/></span>
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: ring >= 60 ? 16 : 13.5, fontWeight: 900, color: "var(--text)" }}>{amsLab(a)}</span>
          {a.dry_filament && W >= 150 && <Muted size={11.5} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.dry_filament}</Muted>}
        </div>
        <span style={{ fontSize: ring >= 60 ? 14 : 12, fontWeight: 800, color: "#ea580c", whiteSpace: "nowrap" }}>encore {fmtDur((a.dry_time || 0) * 60)}</span>
        <div style={{ height: 5, borderRadius: 4, background: "var(--surface2)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${prog(a) * 100}%`, borderRadius: 4, background: "linear-gradient(90deg, #fb923c, #f97316)" }}/></div>
      </div>
    </div>
  );
  const hero = <Hero visual={o.ring && k?.active ? s => <Ring value={(k.ok || 0) / k.active} size={s} color="#22c55e">{Math.round(100 * (k.ok || 0) / k.active)}%</Ring> : null}
    value={v ? k?.to_dry ?? 0 : "…"} unit="à sécher" color={k?.to_dry ? "#dc2626" : "var(--text)"}
    sub={k && `${k.soon ? `${k.soon} bientôt · ` : ""}${k.ok || 0} au sec${o.inams && k.to_dry_in_ams ? ` · ${k.to_dry_in_ams} dans l'AMS` : ""}`}/>;
  return (
    <Tile icon={<Flame size={15}/>} color="#F97316" label="Séchage" to="/stats?tab=drying"
      mini={sz.h === 0.5} summary={drying.length ? <span style={{ fontSize: 13, color: "#ef4444" }}>{drying.length} en cours · {fmtDur(drying[0].dry_time * 60)}</span>
        : <span style={{ color: k?.to_dry ? "#dc2626" : "var(--text)" }}>{k?.to_dry ?? "…"} <span style={{ fontSize: 12, color: "var(--muted)" }}>à sécher</span></span>}
      zoom={<>
        {drying.map(a => <div key={a.id} style={{ padding: 16, borderRadius: 18, background: "linear-gradient(135deg, rgba(249,115,22,0.12), transparent 60%), var(--surface2)" }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: "var(--text)", marginBottom: 10 }}>{amsLab(a)}{a.dry_filament ? <Muted size={12.5}> · {a.dry_filament}</Muted> : null}</div>
          <DryCard ams={a}/></div>)}
        {k && <Stats items={[["À sécher", k.to_dry ?? 0, k.to_dry ? "#dc2626" : undefined], ["Bientôt", k.soon ?? 0, "#d97706"], ["Au sec", k.ok ?? 0, "#16a34a"],
          ["Dans l'AMS", k.to_dry_in_ams ?? 0]]}/>}
        {todo.length > 0 && <><H2>À sécher</H2><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "6px 18px" }}>{todo.map(line)}</div></>}</>}>
      {({ W, H }) => {
        if (drying.length === 1 && H >= 150) {
          // une seule unite et de la place : en grand (anneau centre ou a gauche quand c'est large)
          const a = drying[0], wide = W >= 260;
          const trays = (a.trays || []).filter(trayCol);
          const extra = H - (wide ? 130 : 270) >= 52 ? 52 : 0;
          const Hr = H - extra;
          const ring = Math.floor(wide ? Math.min(Hr - 10, W * 0.42, 170) : Math.min(W * 0.78, Hr - 96, 170));
          const pill = (txt, c) => <span style={{ fontSize: 11.5, fontWeight: 800, color: c, padding: "3px 9px", borderRadius: 12, background: `${c}1c`, whiteSpace: "nowrap" }}>{txt}</span>;
          const below = extra > 0 && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
            {trays.length > 0 && <span style={{ display: "inline-flex", gap: 4 }}>{trays.map(t => <SpoolDot key={t.id} color={trayCol(t)} size={26}
              pct={t.remain >= 0 ? t.remain / 100 : null} title={`${t.filament_type || ""}`}/>)}</span>}
            {a.humidity > 0 && pill(`💧 ${a.humidity} %`, "#0ea5e9")}
            {a.temp > 0 && W >= 215 && pill(`${Math.round(a.temp)} °C dedans`, "#f97316")}
          </div>;
          const end = a.dry_time ? new Date(Date.now() + a.dry_time * 60000) : null;
          const info = <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: wide ? "flex-start" : "center", textAlign: wide ? "left" : "center", minWidth: 0 }}>
            <span style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{amsLab(a)}{a.dry_filament ? <Muted size={12.5}> · {a.dry_filament}</Muted> : null}</span>
            <span style={{ fontSize: 15, fontWeight: 900, color: "#ea580c" }}>encore {fmtDur((a.dry_time || 0) * 60)}</span>
            {end && <Muted size={12}>fin à {finAt(a.dry_time)}{a.dry_temperature ? ` · ${a.dry_temperature} °C` : ""}</Muted>}
            <div style={{ width: wide ? "100%" : Math.min(W, 180), height: 6, borderRadius: 4, background: "var(--surface2)", overflow: "hidden", marginTop: 2 }}>
              <div style={{ height: "100%", width: `${prog(a) * 100}%`, background: "linear-gradient(90deg, #fb923c, #f97316)" }}/></div>
          </div>;
          const big = <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
            <Ring value={prog(a)} size={ring} color="#f97316">{Math.round(prog(a) * 100)}%</Ring>
            <FanBadge a={a} size={Math.max(18, Math.min(30, Math.round(ring * 0.2)))}/>
            <span aria-hidden="true" style={{ position: "absolute", inset: -4, borderRadius: "50%", boxShadow: "0 0 22px rgba(249,115,22,0.45)",
              animation: "dryPulse 2.5s ease-in-out infinite", pointerEvents: "none" }}/></span>;
          return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: wide ? "row" : "column", alignItems: "center", justifyContent: "center", gap: wide ? 16 : 10 }}>{big}{info}</div>
            {below}</div>;
        }
        if (drying.length) {
          const each = (H - 8 * (drying.length - 1)) / drying.length;
          // pas la place d'un anneau par unite : des lignes compactes (nom, mode, temperature, temps restant),
          // la progression en fond de ligne ; ce qui ne tient pas se compte en « +n »
          if (each < 40) {
            // un anneau par unite qui seche (progression, consigne au centre), le nom et le temps restant dessous ;
            // ils se partagent la largeur (une rangee) ou passent en grille quand c'est haut
            const g = fitGrid(drying.length, W, H, { gap: 8, extra: 27, max: 96 });
            if (g.size >= 30) return <div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, minmax(0, 1fr))`, gap: 8,
              alignContent: "center", justifyItems: "center", minWidth: 0 }}>
              {drying.map(a => <div key={a.id} title={`${amsLab(a)}${a.dry_filament ? ` · ${a.dry_filament}` : ""} · encore ${fmtDur((a.dry_time || 0) * 60)}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 0, maxWidth: "100%" }}>
                <span style={{ position: "relative", display: "inline-flex" }}>
                  <Ring value={prog(a)} size={g.size} color="#f97316">{a.dry_temperature ? `${a.dry_temperature}°` : `${Math.round(prog(a) * 100)}%`}</Ring>
                  <FanBadge a={a} size={Math.max(14, Math.round(g.size * 0.32))}/>
                  <span aria-hidden="true" style={{ position: "absolute", inset: -2, borderRadius: "50%", boxShadow: "0 0 10px rgba(249,115,22,0.4)",
                    animation: "dryPulse 2.5s ease-in-out infinite", pointerEvents: "none" }}/></span>
                <span style={{ fontSize: 11, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", lineHeight: "13px" }}>
                  {g.size >= 46 ? amsLab(a) : amsLab(a).replace("AMS-", "")}{a.dry_filament && g.size >= 60 ? <span style={{ color: "var(--muted)", fontWeight: 800 }}> {a.dry_filament}</span> : null}</span>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: "#ea580c", whiteSpace: "nowrap", lineHeight: "13px" }}>{fmtDur((a.dry_time || 0) * 60)}</span>
              </div>)}</div>;
            const fit = Math.max(1, Math.floor((H + 4) / 24));
            const shown = drying.length > fit ? drying.slice(0, fit - 1) : drying;
            return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, minWidth: 0 }}>
              {shown.map(a => <div key={a.id} style={{ position: "relative", height: 20, borderRadius: 7, overflow: "hidden", display: "flex", alignItems: "center",
                gap: 6, padding: "0 7px", background: "rgba(249,115,22,0.08)", minWidth: 0 }}>
                <span aria-hidden="true" style={{ position: "absolute", inset: 0, width: `${prog(a) * 100}%`, background: "linear-gradient(90deg, rgba(249,115,22,0.10), rgba(249,115,22,0.28))" }}/>
                <span style={{ position: "relative", width: 6, height: 6, borderRadius: "50%", background: "#f97316", flexShrink: 0, animation: "dryPulse 2.5s ease-in-out infinite" }}/>
                <span style={{ position: "relative", fontSize: 12, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" }}>{amsLab(a)}</span>
                {a.dry_filament && W >= 190 && <span style={{ position: "relative", fontSize: 10.5, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap" }}>{a.dry_filament}</span>}
                <span style={{ position: "relative", marginLeft: "auto", fontSize: 11.5, fontWeight: 900, color: "#ea580c", whiteSpace: "nowrap" }}>
                  {W >= 230 && a.dry_temperature ? `${a.dry_temperature}° · ` : ""}{fmtDur((a.dry_time || 0) * 60)}</span>
              </div>)}
              {drying.length > shown.length && <span style={{ fontSize: 11, fontWeight: 800, color: "#ea580c", paddingLeft: 7 }}>+{drying.length - shown.length} autre{drying.length - shown.length > 1 ? "s" : ""}</span>}
            </div>;
          }
          const ring = Math.max(34, Math.min(each, W < 215 ? 64 : 84, W * 0.42));
          return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>{drying.map(a => dryRow(a, Math.floor(ring), W))}</div>;
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
// la disposition reglee pour la tuile AMS (Parametres) : lue une fois, partagee par les tuiles
let _amsOrd = { v: undefined, at: 0, p: null };
function useAmsOrder() {
  const [v, setV] = useState(_amsOrd.v);
  useEffect(() => {
    if (_amsOrd.v !== undefined && Date.now() - _amsOrd.at < 600000) { setV(_amsOrd.v); return; }
    _amsOrd.p = _amsOrd.p || client.get("/settings/ams-order").then(({ data }) => data?.order ?? null).catch(() => null)
      .then(x => { _amsOrd = { v: x, at: Date.now(), p: null }; return x; });
    _amsOrd.p.then(setV);
  }, []);
  return v;
}
// les unites rangees comme sur la tuile AMS : la grille (colonnes de cases, null = case vide)
// et l'ordre de lecture (ligne par ligne)
function amsArranged(list, order) {
  const cols = grilleAccueil(list, lireDisposition(order));
  const rows = cols[0]?.length || 0;
  const flat = [];
  for (let r = 0; r < rows; r++) for (const c of cols) if (c[r]) flat.push(c[r]);
  return { cols, rows, flat: flat.length === list.length ? flat : list };
}
// l'humidite : des jauges (qui remplissent la case) ou des barres, avec ses seuils
function Humidity({ status, o, sz }) {
  const order = useAmsOrder();
  const raw = (status?.ams_list || []).filter(a => a.humidity > 0 && a.id !== 255 && a.id !== 254);
  const lay = amsArranged(raw, order);
  const list = lay.flat;
  if (!list.length) return null;
  const [lo, hi] = o.thr === "strict" ? [20, 30] : o.thr === "loose" ? [40, 55] : [30, 40];
  const col = h => h < lo ? "#22c55e" : h < hi ? "#f59e0b" : "#ef4444";
  // la hauteur des gouttes rangees comme sur la tuile AMS (colonnes x lignes de cette grille) ; une goutte
  // fait 0,75 de sa hauteur en largeur, et porte dessous son nom (et sa temperature)
  const gridSize = (W, H) => { const ex = DROP_EXTRA - (o.temp ? 0 : 14), nc = lay.cols.length, nr = lay.rows;
    return nr > 1 ? Math.floor(Math.min((W - 8 * (nc - 1)) / nc / 0.75, (H - 6 * (nr - 1)) / nr - ex, 170)) : 0; };
  const drops = (W, H, grow = true) => {
    // la grille de la tuile AMS, si les gouttes y tiennent assez grandes (une case vide garde sa place)
    const nc = lay.cols.length, nr = lay.rows, gs = gridSize(W, H);
    if (nr > 1 && gs >= 56) return <div style={{ flex: grow ? 1 : undefined, display: "grid", gridTemplateColumns: `repeat(${nc}, auto)`, gridAutoFlow: "row",
      justifyContent: "space-evenly", alignContent: "center", columnGap: 8, rowGap: 6 }}>
      {[...Array(nr).keys()].flatMap(r => lay.cols.map((c, ci) => c[r]
        ? <DropGauge key={c[r].id} value={c[r].humidity} color={col(c[r].humidity)} size={gs} label={amsLab(c[r])} sub={o.temp && c[r].temp ? `${Math.round(c[r].temp)}°` : null}/>
        : <span key={`v${r}-${ci}`}/>))}</div>;
    const g = fitGrid(list.length, W, H, { ar: DROP_AR, extra: DROP_EXTRA - (o.temp ? 0 : 14), max: 150, gap: 8 });
    return <div style={{ flex: grow ? 1 : undefined, display: "grid", gridTemplateColumns: `repeat(${g.cols}, auto)`, justifyContent: "space-evenly", alignContent: "center", gap: 8 }}>
      {list.map(a => <DropGauge key={a.id} value={a.humidity} color={col(a.humidity)} size={Math.round(Math.max(40, g.size) * DROP_AR)} label={amsLab(a)}
        sub={o.temp && a.temp ? `${Math.round(a.temp)}°` : null}/>)}</div>;
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
      zoom={<HumZoom list={list} col={col} o={o} lo={lo} hi={hi}/>}>
      {({ W, H }) => {
        const fitsBars = H >= list.length * 19;
        if (o.style === "bars") return fitsBars ? bars(H) : columns(W);
        const wet = list.reduce((b, a) => a.humidity > b.humidity ? a : b, list[0]);
        const avg = Math.round(list.reduce((t, a) => t + a.humidity, 0) / list.length);
        const g0 = fitGrid(list.length, W, H, { ar: DROP_AR, extra: DROP_EXTRA - (o.temp ? 0 : 14), max: 150, gap: 8 });
        // la grille de la tuile AMS d'abord : avec la ligne du bas si elle tient, sinon seule
        const gsS = gridSize(W, H - 34), gsF = gridSize(W, H);
        const used = gsS >= 56 ? 0 : g0.rows * (g0.size * DROP_AR + DROP_EXTRA) + 8 * (g0.rows - 1);
        if (gsS < 56 && gsF >= 56) return drops(W, H);
        if ((gsS >= 56 || g0.size >= 46) && H - used >= 44) return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 10 }}>
          {drops(W, H - 34, false)}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
            <span>moyenne <b style={{ color: col(avg) }}>{avg} %</b></span>
            {wet.humidity >= lo && W >= 215 && <span>· le plus humide <b style={{ color: col(wet.humidity) }}>{amsLab(wet)}</b></span>}</div></div>;
        return fitGrid(list.length, W, H, { ar: DROP_AR, extra: DROP_EXTRA - (o.temp ? 0 : 14), gap: 8 }).size >= 46 ? drops(W, H) : fitsBars ? bars(H) : columns(W);
      }}
    </Tile>
  );
}
// les copains : qui imprime (vignette, avancement), autant que la place en tient
const FR_C = "#14B8A6";
const FR_STATE = { standby: ["au repos", "#22c55e"], off: ["éteinte", "#94a3b8"], unreachable: ["injoignable", "#ef4444"], printing: ["imprime", FR_C] };
const frPct = x => Math.round(x.progress || 0);
const frEnd = x => (x.remaining_minutes > 0 ? finAt(x.remaining_minutes) : null);
// l'initiale du copain, quand son impression n'a pas de vignette
const FrAvatar = ({ name, size }) => <span style={{ width: size, height: size, borderRadius: "50%", background: FR_C, color: "#fff", fontSize: size * 0.42,
  fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{(name || "?").slice(0, 1).toUpperCase()}</span>;
// la vignette d'un copain (par mon relais, avec le jeton) ; introuvable, ce qu'on montre a la place
function FrImg({ src, style, fallback = null }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  return bad || !src ? fallback : <img data-pk="" src={relayed(src)} alt="" onError={() => setBad(true)} style={style}/>;
}
// une affiche par copain qui imprime : son plateau en grand, son nom, l'avancement et l'heure de fin
// par-dessus, un liseré d'avancement en bas
function FrPoster({ x, thumbs, h }) {
  const small = h < 110, img = thumbs && x.print?.image, end = frEnd(x);
  return <div title={x.print?.name || x.print_name} style={{ position: "relative", height: h, borderRadius: 14, overflow: "hidden", minWidth: 0,
    background: `radial-gradient(circle at 50% 38%, ${FR_C}2e, transparent 70%), var(--surface2)`, border: "1px solid var(--border)" }}>
    <FrImg src={img ? x.print.image : null} style={{ position: "absolute", inset: "6% 8% 30%", width: "84%", height: "64%", objectFit: "contain" }}
      fallback={<div style={{ position: "absolute", inset: "0 0 28%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <FrAvatar name={x.name} size={Math.min(56, h * 0.36)}/></div>}/>
    {end && !small && <span data-pk="" style={{ position: "absolute", top: 6, right: 6, fontSize: 10.5, fontWeight: 800, color: "#fff", padding: "1px 7px",
      borderRadius: 10, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)" }}>fin {end}</span>}
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 4, padding: small ? "10px 8px 3px" : "18px 10px 5px", display: "flex", alignItems: "flex-end", gap: 6,
      background: "linear-gradient(to top, var(--surface) 35%, transparent)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div data-pk="" style={{ fontSize: small ? 11.5 : 13, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</div>
        {!small && <div style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          <W text={x.print?.name || x.print_name || "imprime"}/></div>}
      </div>
      <span data-pk="" style={{ fontSize: small ? 14 : 18, fontWeight: 900, color: FR_C, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{frPct(x)}%</span>
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: "var(--border)" }}>
      <div data-pk="" style={{ height: "100%", width: `${frPct(x)}%`, background: FR_C, boxShadow: `0 0 6px ${FR_C}99`, transition: "width 1s" }}/></div>
  </div>;
}
// les autres copains : une pastille nommee chacun, a la couleur de leur etat
const FrIdle = ({ list, wrap = false }) => <div style={{ display: "flex", gap: 5, flexWrap: wrap ? "wrap" : "nowrap", overflow: "hidden", minWidth: 0 }}>
  {list.map(([id, s]) => { const [l, c] = FR_STATE[s.state] || FR_STATE.off;
    return <span key={id} title={`${s.name || "Copain"} : ${l}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "1px 8px",
      borderRadius: 10, background: "var(--surface2)", color: "var(--text2)", whiteSpace: "nowrap", flexShrink: 0 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }}/>{s.name || "Copain"}{wrap && <span style={{ color: "var(--muted)", fontWeight: 600 }}>· {l}</span>}</span>; })}</div>;
// la fenetre : une grande carte par copain qui imprime, puis l'etat des autres
function FriendsZoom({ p, states, thumbs }) {
  const visit = useFriend(s => s.visit);
  const others = Object.entries(states).filter(([, s]) => s.state !== "printing");
  const go = (id, s) => <button type="button" onClick={e => { e.stopPropagation(); visit({ id, name: s?.name, role: s?.role }); }}
    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 10, border: "none", background: FR_C, color: "#fff",
      fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>Aller chez {s?.name || "lui"}<ArrowUpRight size={13}/></button>;
  return <>
    <Stats items={[["Impriment", p.length, "#0d9488"], ["Au repos", others.filter(([, s]) => s.state === "standby").length],
      ["Éteintes", others.filter(([, s]) => s.state === "off").length], others.some(([, s]) => s.state === "unreachable") ? ["Injoignables", others.filter(([, s]) => s.state === "unreachable").length, "#dc2626"] : null]}/>
    {p.length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(340px, 100%), 1fr))", gap: 10 }}>
      {p.map(x => { const end = frEnd(x);
        return <div key={x.id} style={{ display: "flex", gap: 12, padding: 12, borderRadius: 16, minWidth: 0,
          background: `linear-gradient(135deg, ${FR_C}1c, transparent 60%), var(--surface2)`, border: `1px solid ${FR_C}40` }}>
          <div style={{ width: 104, height: 104, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: `radial-gradient(circle, ${FR_C}2e, transparent 70%), var(--surface)` }}>
            <FrImg src={thumbs ? x.print?.image : null} style={{ width: "88%", height: "88%", objectFit: "contain" }} fallback={<FrAvatar name={x.name} size={52}/>}/></div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <b style={{ flex: 1, minWidth: 0, fontSize: 15, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</b>
              <span style={{ fontSize: 22, fontWeight: 900, color: FR_C, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{frPct(x)}%</span></div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", ...clamp(2) }}><W text={x.print?.name || x.print_name || "imprime"}/></div>
            <div style={{ height: 6, borderRadius: 6, background: "var(--border)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${frPct(x)}%`, background: FR_C }}/></div>
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{[x.remaining_minutes > 0 && `reste ${fmtDur(x.remaining_minutes * 60)}`, end && `fin ${end}`,
              x.total_layers > 0 && `couche ${x.layer || 0}/${x.total_layers}`].filter(Boolean).join(" · ")}</div>
            <div style={{ marginTop: "auto" }}>{go(x.id, states[x.id] || { name: x.name })}</div>
          </div>
        </div>; })}</div> : <Line>Personne n'imprime en ce moment.</Line>}
    {others.length > 0 && <><H2>Les autres</H2><FrIdle list={others} wrap/></>}
  </>;
}
function Friends({ f, o, sz }) {
  const p = f?.printing || [];
  const states = f?.states || {};
  const n = Object.keys(states).length;
  if (!f || !n) return null;
  const others = Object.entries(states).filter(([, s]) => s.state !== "printing");
  // tres petit : une ligne par copain (vignette, nom, avancement)
  const row = x => (
    <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, height: 36 }}>
      <FrImg src={o.thumbs ? x.print?.image : null} style={{ width: 32, height: 32, borderRadius: 8, objectFit: "contain", flexShrink: 0, background: "var(--surface2)" }}
        fallback={<FrAvatar name={x.name} size={28}/>}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <b data-pk="" style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</b>
          <span data-pk="" style={{ fontSize: 11.5, fontWeight: 800, color: "#0d9488" }}>{frPct(x)} %</span></div>
        <div style={{ height: 4, borderRadius: 4, background: "var(--surface2)", overflow: "hidden", margin: "2px 0" }}>
          <div data-pk="" style={{ height: "100%", width: `${frPct(x)}%`, background: FR_C }}/></div>
      </div>
    </div>
  );
  return (
    <Tile icon={<Users size={15}/>} color={FR_C} label="Copains" to="/stats?tab=friends" badge={<span style={{ fontSize: 11, fontWeight: 800, color: "#0d9488" }}>{p.length}/{n}</span>}
      mini={sz.h === 0.5} summary={<span style={{ fontSize: 13 }}>{p.length ? `${p.map(x => x.name).join(", ")} imprime${p.length > 1 ? "nt" : ""}` : "personne n'imprime"}</span>}
      zoom={<FriendsZoom p={p} states={states} thumbs={o.thumbs}/>}>
      {({ W: bw, H }) => {
        const strip = o.idle && others.length > 0 && H >= 96 ? 26 : 0;
        const room = H - strip;
        if (!p.length) return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
          <Empty>Personne n'imprime en ce moment</Empty>{o.idle && others.length > 0 && <FrIdle list={others} wrap={H >= 90}/>}</div>;
        // les affiches, autant que la place en tient (une grille qui remplit la tuile)
        const g = fitGrid(p.length, bw, room, { gap: 8, ar: 0.95, max: 260 });
        if (!o.scroll && g.size >= 80) {
          const rowH = Math.floor((room - 8 * (g.rows - 1)) / g.rows);
          return <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, minmax(0, 1fr))`, gap: 8 }}>
              {p.map(x => <FrPoster key={x.id} x={x} thumbs={o.thumbs} h={rowH}/>)}</div>
            {strip > 0 && <FrIdle list={others}/>}</div>;
        }
        // bas : un anneau d'avancement par copain, son plateau au centre, son nom et son pourcentage dessous
        const r = fitGrid(p.length, bw, room, { gap: 10, extra: o.thumbs ? 30 : 18, max: 96 });
        if (!o.scroll && r.size >= 40) return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, minHeight: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${r.cols}, minmax(0, 1fr))`, gap: 10, justifyItems: "center" }}>
            {p.map(x => <div key={x.id} title={x.print?.name || x.print_name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0, maxWidth: "100%" }}>
              <Ring value={frPct(x) / 100} size={r.size} color={FR_C}>
                <FrImg src={o.thumbs ? x.print?.image : null} style={{ width: r.size * 0.6, height: r.size * 0.6, objectFit: "contain", display: "block" }}
                  fallback={`${frPct(x)}%`}/></Ring>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text)", maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {x.name}</span>
              {o.thumbs && x.print?.image && <span style={{ fontSize: 11, fontWeight: 900, color: FR_C, lineHeight: 1 }}>{frPct(x)}%</span>}</div>)}</div>
          {strip > 0 && <FrIdle list={others}/>}</div>;
        return o.scroll ? <><Scroller gap={4}>{p.map(row)}</Scroller>{strip > 0 && <FrIdle list={others}/>}</> : <>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{p.slice(0, fitRows(room, 36, 4)).map(row)}</div>
          {strip > 0 && <div style={{ marginTop: "auto" }}><FrIdle list={others}/></div>}</>;
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
    {hist ? <Bars values={hist} color="#EAB308" height={zoomChartH(W)} hi={29} showValues={W / 30 >= 22} labels={days.map(d => d.getDate() % 5 === 0 ? String(d.getDate()) : "")}
      titles={days.map((d, i) => `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} : +${hist[i]}`)}/> : <Muted>…</Muted>}
    <H2>Ces 30 jours</H2>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
      {MW_STATS(c.head?.["30"]?.totals || c.head?.["7"]?.totals).map(([e, n, l]) => <div key={l} className="card-sm" style={{ textAlign: "center", padding: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" }}>{e} {n ?? 0}</div><Muted size={11}>{l}</Muted></div>)}
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
        const lg = fitGrid(items.length, W, rest, { gap: 8, max: 120, extra: 17 });
        const titled = lg.size >= 76;
        let g = titled ? lg : fitGrid(items.length, W, rest, { gap: 6, max: 110 });
        if (g.size < 28) { const f = fillGrid(W, rest, 28, 6); g = { cols: f.cols, size: Math.min(f.size, Math.max(22, rest - 2)), n: f.n }; }
        return <>{head}<div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, ${g.size}px)`, gap: titled ? 8 : 6, alignContent: "center",
          justifyContent: "space-evenly", marginTop: 4 }}>
          {items.slice(0, g.n || items.length).map(x => titled ? <div key={x.design_id} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            {thumb(x, g.size)}<span style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              lineHeight: "14px" }}>{x.title_fr || x.title}</span></div> : thumb(x, g.size))}</div></>;
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
    <Tile icon={<Dices size={15}/>} color="#EC4899" label="Roue et clés" to="/stats?tab=achievements"
      zoom={<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, paddingTop: 6 }}>
        <WheelArt size={220} spin={spins > 0}/>
        <div style={{ display: "flex", gap: 28 }}>{cells.map(([ic, n, l, c]) => <div key={l} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 34, fontWeight: 900, color: c }}>{ic}{n}</span>
          <Muted size={13}>{l}</Muted></div>)}</div>
        <div style={{ width: "min(320px, 100%)" }}>{btn(true)}</div></div>}
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
        const tall = wide && H >= 250;
        const art = wide && !tall ? Math.min(H - 12, W * 0.42, 200) : Math.min(W - 8, H - 110, tall ? 260 : 220);
        if (art >= 80) return wide && !tall
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
  const nz = [...(status.nozzles || [])].sort((a, b) => b.id - a.id);   // gauche (1) puis droite (0)
  const bed = { k: "bed", ico: IcoBed, l: "Plateau", v: status.bed_temp, t: status.target_bed_temp, max: 120, c: "#ef4444" };
  return [
    ...nz.map(n => ({ k: `n${n.id}`, ico: IcoNozzle, l: nz.length > 1 ? `Buse ${n.id === 1 ? "G" : "D"}` : "Buse", v: n.temp, t: n.target, max: 300, c: "#f97316",
      active: nz.length > 1 && !!n.active, s: nz.length > 1 ? (n.id === 1 ? "G" : "D") : null })),
    ...(!nz.length && status.nozzle_temp != null ? [{ k: "n", ico: IcoNozzle, l: "Buse", v: status.nozzle_temp, t: status.target_nozzle_temp, max: 300, c: "#f97316" }] : []),
    bed,
    ...(o.chamber && status.chamber_temp > 0 ? [{ k: "ch", ico: IcoChamber, l: "Chambre", v: status.chamber_temp, t: status.target_chamber_temp, max: 70, c: "#eab308" }] : []),
  ];
};
// la couleur d'une temperature : bleu froid, ambre tiede, orange chaud, rouge brulant
const HEAT = [[20, [96, 165, 250]], [45, [251, 191, 36]], [120, [249, 115, 22]], [240, [239, 68, 68]]];
function heat(v) {
  const x = Math.max(HEAT[0][0], Math.min(HEAT[HEAT.length - 1][0], v || 0));
  for (let i = 1; i < HEAT.length; i++) if (x <= HEAT[i][0]) {
    const [a, ca] = HEAT[i - 1], [b, cb] = HEAT[i], k = (x - a) / (b - a);
    return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * k)).join(",")})`;
  }
  return "rgb(239,68,68)";
}
// ce que fait la source : chauffe, a temperature, refroidit, au repos
function tempState(v, t) {
  if (t > 0) return Math.abs(v - t) <= 3 ? ["✓", "à température", "#16a34a"] : v < t ? ["▲", "chauffe", "#f97316"] : ["▼", "redescend", "#0ea5e9"];
  return v > 40 ? ["▼", "refroidit", "#0ea5e9"] : ["", "au repos", "var(--muted)"];
}
// une source en carte : en largeur (icone, valeur, barre et repere de consigne) ou, haute, en thermometre
function ThermoCell({ r, w, h, targets }) {
  const v = r.v || 0, t = r.t || 0, c = heat(v), [ic, st, sc] = tempState(v, t);
  const frac = x => Math.max(0, Math.min(1, x / r.max));
  const hot = v > 40;
  const icon = s => <span style={{ width: s, height: s, borderRadius: s / 3, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
    background: `${c.replace("rgb", "rgba").replace(")", ",0.18)")}`, color: c, boxShadow: hot ? `0 0 12px ${c.replace("rgb", "rgba").replace(")", ",0.45)")}` : "none",
    animation: ic === "▲" ? "dryPulse 2.2s ease-in-out infinite" : "none" }}><r.ico s={Math.round(s * 0.56)}/></span>;
  // tres etroite : la consigne se lit au repere de la barre, pas en chiffres
  const val = (fs, tgt = targets) => <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3, whiteSpace: "nowrap" }}>
    <span data-pk="" style={{ fontSize: fs, fontWeight: 900, color: hot ? c : "var(--text)", lineHeight: 1 }}>{Math.round(v)}°</span>
    {tgt && t > 0 && <span style={{ fontSize: Math.max(10, fs * 0.42), fontWeight: 800, color: "var(--muted)" }}>/{Math.round(t)}°</span>}</span>;
  const glow = a => c.replace("rgb", "rgba").replace(")", `,${a})`);
  const card = { width: w, height: h, boxSizing: "border-box", borderRadius: 16, padding: "8px 10px", minWidth: 0, overflow: "hidden", position: "relative",
    background: `radial-gradient(circle at 18% 100%, ${glow(hot ? 0.32 : 0.14)}, transparent 62%), linear-gradient(160deg, ${glow(0.12)}, transparent 70%), var(--surface2)`,
    border: r.active ? `2px solid ${c}` : "1px solid transparent", boxShadow: r.active ? `0 6px 22px ${glow(0.35)}` : "none" };
  const activeChip = r.active && (w >= 190 ? <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 900, color: "#fff", background: c,
    padding: "1px 7px", borderRadius: 10, letterSpacing: ".03em", lineHeight: 1.4 }}>active</span>
    : <span title="buse active" style={{ flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: c, boxShadow: `0 0 8px ${c}`,
      animation: "livePulse 2s infinite" }}/>);
  // haute : un thermometre (tube et bulbe) a gauche, le reste a droite
  if (h >= 150 && w >= 96) {
    const tubeH = h - 46, bulb = 22, fill = frac(v);
    return <div title={`${r.l} : ${st}`} style={{ ...card, display: "flex", gap: 10, padding: "10px 12px" }}>
      <div style={{ position: "relative", width: bulb, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 12, height: tubeH, borderRadius: 6, background: "var(--surface)", border: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${fill * 100}%`, background: `linear-gradient(to top, ${heat(20)}, ${c})`,
            transition: "height .8s" }}/>
          {targets && t > 0 && <div style={{ position: "absolute", left: -2, right: -2, bottom: `${frac(t) * 100}%`, height: 2, background: "var(--text)" }}/>}
        </div>
        {targets && t > 0 && w >= 160 && <span style={{ position: "absolute", left: 17, bottom: `calc(${bulb + 5}px + ${frac(t)} * ${tubeH}px - 6px)`, fontSize: 9, fontWeight: 900,
          color: "var(--muted)", whiteSpace: "nowrap" }}>◂ {Math.round(t)}°</span>}
        <div style={{ width: bulb, height: bulb, borderRadius: "50%", marginTop: -5, background: c, boxShadow: `0 0 14px ${c}`, border: "2px solid var(--surface)" }}/>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>{w >= 150 && icon(24)}
          <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{r.l}</span>
          {activeChip}</div>
        <div>{val(Math.min(34, (w - 44) * 0.26), false)}</div>
        <span style={{ fontSize: Math.max(9.5, Math.min(11.5, (w - 44) / 9)), fontWeight: 800, color: sc, whiteSpace: "nowrap", overflow: "hidden",
          textOverflow: "ellipsis" }}>{w < 150 && ic ? ic : `${ic ? `${ic} ` : ""}${st}`}</span>
      </div>
    </div>;
  }
  // en largeur : icone et nom, la valeur, une barre (avec le repere de la consigne)
  const big = h >= 84;
  return <div title={`${r.l} : ${st}`} style={{ ...card, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 4 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      {w >= 84 && icon(big ? 22 : 18)}
      <span style={{ fontSize: w < 84 ? 10.5 : 11.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{r.l}</span>
      {/* l'etat reste lisible, meme sur la buse active : en toutes lettres s'il y a la place */}
      {(ic || w >= 200) && w >= 100 && <span style={{ fontSize: w >= 200 ? 10.5 : 10, fontWeight: 900, color: sc, whiteSpace: "nowrap" }}>
        {w >= 200 ? `${ic ? `${ic} ` : ""}${st}` : ic}</span>}
      {activeChip}</div>
    {val(Math.max(15, Math.min(big ? 28 : 21, w * 0.19)), targets && w >= 84)}
    <div style={{ position: "relative", height: 6, borderRadius: 4, background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${frac(v) * 100}%`, borderRadius: 4,
        background: `linear-gradient(90deg, ${heat(20)}, ${c})`, transition: "width .8s" }}/>
      {targets && t > 0 && <div style={{ position: "absolute", top: -3, bottom: -3, left: `calc(${frac(t) * 100}% - 1px)`, width: 2, borderRadius: 1, background: "var(--text)" }}/>}
    </div>
  </div>;
}
// la disposition des cartes : le plus de colonnes qui laisse des cartes lisibles
function thermoGrid(n, W, H, gap = 8) {
  let best = null;
  for (let cols = n; cols >= 1; cols--) {
    const rows = Math.ceil(n / cols), w = (W - gap * (cols - 1)) / cols, h = Math.min(220, (H - gap * (rows - 1)) / rows);
    if (w < 68 || h < 62) continue;
    const score = Math.min(w / 1.3, h);
    if (!best || score > best.score) best = { cols, rows, w: Math.floor(w), h: Math.floor(h), score };
  }
  return best;
}
export function TempPanel({ status, chamber = true, cardH = 190 }) {
  const [ref, box] = useMeasure();
  const rows = status?.connected ? tempRows(status, { chamber }) : [];
  const cols = box.W >= 640 ? Math.min(4, rows.length) : 2;
  const w = box.W ? Math.floor((box.W - 10 * (cols - 1)) / cols) : 0;
  return <div ref={ref} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 10 }}>
    {w > 0 && rows.map(r => <ThermoCell key={r.k} r={r} w={w} h={cardH} targets/>)}</div>;
}
function Temps({ status, o, sz }) {
  if (!status?.connected) return null;
  const rows = tempRows(status, o);
  const hot = r => (r.v || 0) > 40;
  const thermo = (W, H) => { const g = thermoGrid(rows.length, W, H);
    return g && <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${g.cols}, ${g.w}px)`, gap: 8, justifyContent: "center", alignContent: "center" }}>
      {rows.map(r => <ThermoCell key={r.k} r={r} w={g.w} h={g.h} targets={o.targets}/>)}</div>; };
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
        {o.targets && r.t > 0 && <sup style={{ color: "var(--muted)", fontWeight: 700, fontSize: 10.5, lineHeight: 0 }}>/{Math.round(r.t)}°</sup>}
      </div>))}</div>;
  const cells = (W, H) => {
    const g = fitGrid(rows.length, W, H, { ar: 0.42, gap: 6, max: 200 });
    return <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${g.cols}, 1fr)`, gap: 6, alignContent: "center" }}>
      {rows.map(r => <div key={r.k} title={r.l} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, minWidth: 0,
        color: hot(r) ? r.c : "var(--muted)" }}><r.ico s={14}/>{r.s && <span style={{ fontSize: 10.5, fontWeight: 900, marginLeft: -3 }}>{r.s}</span>}
        <span data-pk="" style={{ fontSize: 16, fontWeight: 900, color: hot(r) ? r.c : "var(--text)" }}>{Math.round(r.v || 0)}°</span></div>)}</div>;
  };
  return (
    <Tile icon={<Thermometer size={15}/>} color="#F97316" label="Températures" zoom={({ W, H }) => { const n = tempRows(status, o).length, r = W >= 520 ? 1 : Math.ceil(n / 2);
      return <TempPanel status={status} chamber={o.chamber} cardH={Math.max(170, Math.min(360, Math.floor((H - 10 * (r - 1)) / r)))}/>; }}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 10, fontSize: 13.5 }}>{rows.map(r =>
        <span key={r.k} title={r.l} style={{ display: "inline-flex", alignItems: "center", gap: 3, color: hot(r) ? r.c : "var(--text)" }}>
          <r.ico s={13}/>{r.s && <span style={{ fontSize: 10, fontWeight: 900 }}>{r.s}</span>}{Math.round(r.v || 0)}°</span>)}</span>}>
      {({ W, H }) => {
        // des cartes thermometre si elles tiennent, sinon les jauges (style « jauges »), sinon des lignes
        if (!o.style || o.style === "thermo") { const th = thermo(W, H); if (th) return th; }
        const g = fitGrid(rows.length, W, H, { ar: GAUGE_AR, extra: GAUGE_EXTRA, gap: 8 });
        if (o.style === "gauges" && g.size >= 50) return gauges(W, H);
        return H >= rows.length * 22 ? lines : cells(W, H);
      }}
    </Tile>
  );
}
const statsH3 = W => statsH(3, W);
// le mois : le compte, l'ecart avec le mois dernier, les chiffres du mois et les barres par jour
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
        const items = days && days.length && [["Par jour", String(Math.round(days.reduce((a, x) => a + (x.count || 0), 0) / nd * 10) / 10).replace(".", ",")],
          ["Meilleur jour", best?.count ? `${best.day.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · ${best.count}` : "—"], ["Jours actifs", `${days.filter(x => x.count).length} / ${nd}`]];
        const statsH = items && H >= 210 + statsH3(W) ? statsH3(W) + 6 : 0;
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
  return <Bars values={days.map(x => x.count || 0)} color="#6366F1" height={zoomChartH(W)} hi={days.length - 1} showValues={W / days.length >= 22}
    labels={days.map(x => String(x.day.getDate()))} titles={days.map(x => `${x.day.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} : ${x.count || 0}`)}/>;
}
// objets et ventes : un anneau vendus / a vendre, le chiffre et la marge
function Sales({ v, o, sz }) {
  if (!v || !v.total) return null;
  const share = (v.sold || 0) / Math.max(1, (v.sold || 0) + (v.available || 0));
  const sub = [`${v.sold} vendu${v.sold > 1 ? "s" : ""}`, o.revenue && `${Math.round(v.revenue || 0)} €`,
    o.margin && `marge ${Math.round(v.margin || 0)} €${v.margin_pct ? ` (${Math.round(v.margin_pct)} %)` : ""}`].filter(Boolean).join(" · ");
  const hero = <Hero visual={o.ring ? s => <Ring value={share} size={s} color="#EC4899" cap="vendus">{v.sold}</Ring> : null} value={v.available} unit="à vendre" sub={sub}/>;
  const split = <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", background: "var(--surface2)" }}>
      <span style={{ width: `${share * 100}%`, background: "linear-gradient(90deg, #f472b6, #ec4899)" }}/></div>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
      <span style={{ whiteSpace: "nowrap" }}><b style={{ color: "#db2777" }}>{Math.round(share * 100)} %</b> vendus</span>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginLeft: 8 }}>{v.total} objets</span></div></div>;
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
        if (H >= 190) return <Stack min={W < 215 ? 150 : 96} head={hero} blocks={[{ h: statsH(items.length, W), node: <Stats items={items}/> },
          { h: 34, node: split }]}/>;
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
      zoom={all.length ? <><Stats items={[["Aujourd'hui", all.length], ["Non lus", fresh, "#3b82f6"]]}/>
        <div>{all.map((x, i) => row(x, i, true, false))}</div></> : null}>
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
  const n = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000);
  return n > 0 ? t + "⁺" + String(n).split("").map(c => "⁰¹²³⁴⁵⁶⁷⁸⁹"[c]).join("") : t; };
function Countdown({ status, o, sz }) {
  const live = isLive(status);
  const pct = Math.round(status?.progress || 0);
  const left = status?.remaining_minutes || 0;
  const paused = /PAUSE/.test(String(status?.status || "").toUpperCase());
  const color = paused ? "#f59e0b" : "#22c55e";
  const hero = <Hero visual={s => <Ring value={pct / 100} size={s} color={color}>{pct}%</Ring>}
    value={live ? (left ? fmtDur(left * 60) : "bientôt") : "—"} unit={live ? (paused ? "en pause" : "restantes") : "rien en cours"}
    sub={live && [left && o.fin && `fin à ${finAt(left)}`, o.layer && status.total_layers > 0 && `couche ${status.layer} / ${status.total_layers}`].filter(Boolean).join(" · ")}/>;
  // ce qui est deja passe, estime d'apres l'avancement
  const total = live && left && pct > 0 && pct < 100 ? left / (1 - pct / 100) : null;
  const since = total ? new Date(Date.now() - (total - left) * 60000) : null;
  const hm = d => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const name = live && status?.print_name && <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
    {status.print_name}</div>;
  const layers = live && status?.total_layers > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
      <span>couche <b style={{ color: "var(--text)" }}>{status.layer}</b> / {status.total_layers}</span><span>{Math.round(100 * status.layer / status.total_layers)} %</span></div>
    <div style={{ height: 8, borderRadius: 5, background: "var(--surface2)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${100 * status.layer / status.total_layers}%`, borderRadius: 5, background: `linear-gradient(90deg, ${color}99, ${color})` }}/></div></div>;
  const facts = [since && ["Commencée", hm(since)], total && ["Durée totale", `≈ ${fmtDur(total * 60)}`]].filter(Boolean);
  return (
    <Tile icon={<Timer size={15}/>} color={color} label="Fin d'impression" zoom={live ? <>
      <BoxCtx.Provider value={{ W: 600, H: 180, zoom: true }}>{hero}</BoxCtx.Provider>
      <div style={{ height: 10, borderRadius: 6, background: "var(--surface2)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 6, background: color, boxShadow: `0 0 10px ${color}` }}/></div>
      {name}
      <Stats items={[["Reste", left ? fmtDur(left * 60) : "—"], ["Fin", left ? finAt(left) : "—"],
        ["Couche", status.total_layers > 0 ? `${status.layer} / ${status.total_layers}` : "—"], ["Avancement", `${pct} %`, color], ...facts]}/></> : null}
      mini={sz.h === 0.5} summary={live ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
        <span style={{ color }}>{pct}%</span>{left > 0 && <>{fmtDur(left * 60)}<Muted>· {finAt(left)}</Muted></>}</span> : <Muted size={12.5}>rien en cours</Muted>}>
      {({ W }) => live ? <Stack min={W < 215 ? 150 : 76} head={hero} blocks={[name && { h: 18, node: name }, layers && { h: 30, node: layers },
        facts.length && { h: statsH(facts.length, W), node: <Stats items={facts}/> }]}/> : <Empty>Rien en cours d'impression</Empty>}
    </Tile>
  );
}
// le filament en cours : la bobine qui imprime (sa couleur, sa matiere, ce qui reste)
const slotOf = t => t.ams.id >= 128 ? amsLab(t.ams) : `${String.fromCharCode(65 + t.ams.id)}${t.id + 1}`;
function activeTray(status) {
  const ams = (status?.ams_list || []).find(a => a.id === status?.active_ams_id);
  const tray = ams?.trays?.find(t => t.id === status?.active_tray_id);
  return tray ? { ...tray, ams } : null;
}
function Spool({ status, o, sz }) {
  const t = activeTray(status);
  const live = isLive(status);
  if (!t) return (
    <Tile icon={<Disc3 size={15}/>} color="#8B5CF6" label="Filament en cours">
      <Empty>{live ? "Bobine inconnue" : "Pas d'impression en cours"}</Empty>
    </Tile>
  );
  const si = t.spool_info || {};
  const color = hexCss(si.color || t.color);
  const colors = si.colors_array ? si.colors_array.split(",").map(c => hexCss(c.trim())) : [color];
  const name = si.translated_name || si.name || t.filament_type || "Bobine";
  const type = si.fila_type || si.material || t.filament_type;
  const g = si.remaining_weight_g, tot = si.initial_weight_g;
  const pct = g != null && tot ? Math.max(0, Math.min(1, g / tot)) : t.remain != null && t.remain >= 0 ? t.remain / 100 : null;
  const slot = `${slotOf(t)} · ${amsLab(t.ams)}`;
  const weight = g != null ? `${Math.round(g)} g` : pct != null ? `${Math.round(pct * 100)} %` : "—";
  const barCol = pct == null ? "#94a3b8" : pct < 0.15 ? "#ef4444" : pct < 0.35 ? "#f59e0b" : color;
  // une couleur tres claire (blanc, jade…) se perd sur le fond : la barre garde un contour, le texte du % passe en sombre
  const light = (c => { const m = /^#?([0-9a-f]{6})/i.exec(c || ""); if (!m) return false; const n = parseInt(m[1], 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.72; })(barCol);
  const bar = h => <div style={{ height: h, borderRadius: h, background: "var(--surface2)", overflow: "hidden", boxShadow: "inset 0 0 0 1px var(--border)" }}>
    <div data-pk="" style={{ height: "100%", width: `${(pct ?? 0) * 100}%`, borderRadius: h, background: barCol,
      boxShadow: light ? "inset 0 0 0 1px rgba(0,0,0,0.28)" : `0 0 8px ${barCol}66` }}/></div>;
  // le pourcentage restant, en pastille a la couleur de la bobine
  const pctPill = fs => pct == null ? null : <span data-pk="" style={{ display: "inline-flex", alignItems: "baseline", gap: 1, padding: `1px ${Math.round(fs * 0.55)}px`,
    borderRadius: 20, fontSize: fs, fontWeight: 900, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1.35,
    color: light ? "#0f172a" : "#fff", background: light ? `linear-gradient(135deg, ${barCol}, #e2e8f0)` : `linear-gradient(135deg, ${barCol}, ${barCol}cc)`,
    border: light ? "1px solid rgba(0,0,0,0.18)" : "none", boxShadow: `0 3px 10px ${light ? "rgba(0,0,0,0.12)" : `${barCol}55`}` }}>
    {Math.round(pct * 100)}<span style={{ fontSize: fs * 0.7 }}>%</span></span>;
  const spool = size => <span data-pk="" style={{ display: "inline-flex", flexShrink: 0, filter: `drop-shadow(0 6px 14px ${color}55)` }}>
    <SpoolSVG colors={colors} size={size} active={live} type={si.multicolor_type}/></span>;
  const chip = (txt, c) => <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 800,
    whiteSpace: "nowrap", color: c, background: `${c}1c` }}>{txt}</span>;
  const ago = iso => { if (!iso) return "—"; const d = Math.round((Date.now() - utc(iso).getTime()) / 86400000); return d <= 0 ? "aujourd'hui" : d === 1 ? "hier" : `il y a ${d} j`; };
  return (
    <Tile icon={<Disc3 size={15}/>} color="#8B5CF6" label="Filament en cours" to="/filaments"
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
        <SpoolDot color={color} pct={pct} size={22}/>{name}<Muted>{weight}</Muted></span>}
      zoom={<>
        {/* la bobine en vedette, sur un fond de sa couleur */}
        <div style={{ position: "relative", overflow: "hidden", borderRadius: 22, padding: 18, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
          background: `radial-gradient(circle at 15% 50%, ${color}55, transparent 60%), linear-gradient(135deg, ${color}22, transparent 70%), var(--surface2)` }}>
          {spool(140)}
          <div style={{ flex: "1 1 180px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{chip(slot, "#8B5CF6")}{live && chip("● en cours", "#22c55e")}
              {si.needs_drying && chip("à sécher", "#0ea5e9")}{si.swatch === false && chip("échantillon à faire", "#f59e0b")}</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: "var(--text)", lineHeight: 1.1 }}>{name}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text2)" }}>{[type, si.brand].filter(Boolean).join(" · ")}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 30, fontWeight: 900, color: light ? "var(--text)" : barCol }}>{weight}</span>{pctPill(15)}
              {tot && g != null && <Muted size={13}>sur {Math.round(tot)} g · {Math.round((pct ?? 0) * 100)} %</Muted>}</div>
            {bar(10)}
          </div>
        </div>
        {(() => {
          const price = si.price_override || si.price;
          const day = iso => iso ? utc(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : null;
          return <FactCards groups={[
            { t: "Le filament", i: "🎨", c: color, rows: [
              { l: "Couleur Bambu", v: si.color_code ? `n° ${si.color_code}` : null, d: si.name_en && si.name_en !== name ? si.name_en : null,
                pre: <span style={{ width: 14, height: 14, borderRadius: 4, background: color, border: "1px solid rgba(0,0,0,0.2)" }}/> },
              { l: "Échantillon", v: si.swatch == null ? null : si.swatch ? "fait" : "à faire", vc: si.swatch === false ? "#d97706" : "#16a34a" },
              { l: "Stock de ce filament", v: si.filament_stock_g != null ? fmtG(si.filament_stock_g) : null, d: si.to_order ? "à commander" : null } ] },
            { t: "Le budget", i: "💶", c: "#16a34a", rows: [
              { l: "Prix de la bobine", v: price ? fmtEur(price) : null },
              { l: "Ce qu'il en reste", v: price && g != null && tot ? fmtEur(price * g / tot) : null, vc: "#16a34a" } ] },
            { t: "Son histoire", i: "🗓️", c: "#8b5cf6", rows: [
              { l: "Ajoutée au stock", v: day(si.created_at) },
              { l: "Première utilisation", v: day(si.first_used_at) || "aujourd'hui", d: si.first_used_at ? ago(si.first_used_at) : null },
              { l: "Dernier séchage", v: si.last_dried_at ? ago(si.last_dried_at) : "jamais", d: si.needs_drying ? "il est temps de la sécher" : null,
                vc: si.needs_drying ? "#0ea5e9" : undefined } ] },
            { t: "La bobine", i: "🧵", c: "#64748b", rows: [
              { l: "Bobine vide", v: si.spool_weight_g ? `${Math.round(si.spool_weight_g)} g` : null, d: si.spool_tare_name },
              { l: "Étiquette", v: si.label_printed == null ? null : si.label_printed ? "imprimée" : "à imprimer", vc: si.label_printed === false ? "#d97706" : undefined } ] },
            { t: "Dans l'AMS", i: "📍", c: "#0ea5e9", rows: [
              { l: "Emplacement", v: slot },
              { l: "Humidité", v: t.ams?.humidity ? `${t.ams.humidity} %` : null, vc: "#0ea5e9" },
              { l: "Température", v: t.ams?.temp ? `${Number(t.ams.temp).toFixed(1).replace(".", ",")} °C` : null },
              { l: "Séchage", v: t.ams?.dry_time > 0 ? `${t.ams.dry_temperature || "?"} °C` : null, d: t.ams?.dry_time > 0 ? `encore ${fmtDur(t.ams.dry_time * 60)}` : null,
                vc: "#ea580c" } ] },
          ]}/>;
        })()}
        {si.comment && <Line>{si.comment}</Line>}</>}>
      {({ W, H }) => {
        const narrow = W < 215;
        // etroite et haute : la bobine au centre, le reste dessous
        if (narrow && H >= 150) {
          const sp = Math.floor(Math.min(W * 0.62, H - 92, 130));
          return <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, textAlign: "center", minWidth: 0 }}>
            {spool(sp)}
            <span style={{ fontSize: 15, fontWeight: 900, color: "var(--text)", maxWidth: "100%", ...clamp(1) }}>{name}</span>
            <Muted size={11.5}>{slot}</Muted>
            <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: light ? "var(--text)" : barCol, whiteSpace: "nowrap" }}>{weight}</span><div style={{ flex: 1 }}>{bar(6)}</div>
              {pctPill(11)}</div>
          </div>;
        }
        // sinon en ligne : la bobine a gauche (a la hauteur), le nom, la matiere, le poids et sa jauge
        const sp = Math.floor(Math.max(36, Math.min(H - 4, narrow ? 64 : H >= 150 ? 150 : 104, W * 0.36)));
        const price = si.price_override || si.price;
        const facts = !narrow && H >= 150 && [price && g != null && tot && chip(`≈ ${fmtEur(price * g / tot)} restants`, "#16a34a"),
          t.ams?.humidity > 0 && chip(`💧 ${t.ams.humidity} %`, "#0ea5e9"), si.needs_drying && chip("à sécher", "#0ea5e9"),
          si.swatch === false && chip("échantillon à faire", "#f59e0b")].filter(Boolean);
        return <div style={{ flex: 1, display: "flex", alignItems: "center", gap: narrow ? 8 : 14, minWidth: 0 }}>
          {spool(sp)}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: narrow ? 2 : 4 }}>
            {!narrow && H >= 90 && <div>{chip(slot, "#8B5CF6")}</div>}
            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: narrow ? 14 : 20, fontWeight: 900, color: "var(--text)", lineHeight: 1.15, minWidth: 0, ...clamp(1) }}>{name}</span>
              {!narrow && pctPill(H < 80 ? 12 : 14)}</span>
            {narrow ? <>
              {/* etroite : la matiere, puis la marque dessous ; l'emplacement seulement s'il reste de la place */}
              {type && <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>{type}</span>}
              {si.brand && H >= 76 && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>{si.brand}</span>}
              {H >= 120 && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>{slot}</span>}
            </> : <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {[type, si.brand, H < 80 && g != null ? `${Math.round(g)} g` : null].filter(Boolean).join(" · ")}</span>}
            {!narrow && H < 80 ? bar(6) : <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: narrow ? 12.5 : 15, fontWeight: 900, color: light ? "var(--text)" : barCol, whiteSpace: "nowrap" }}>{weight}</span>
              {(!narrow || W >= 175) && <div style={{ flex: 1, minWidth: 0 }}>{bar(narrow ? 5 : 7)}</div>}
              {narrow && <span style={{ marginLeft: "auto" }}>{pctPill(10.5)}</span>}</div>}
            {facts && facts.length > 0 && <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>{facts}</div>}
          </div>
        </div>;
      }}
    </Tile>
  );
}
// l'aiguillage (Filament Track Switch) : les entrees A et B (les AMS qui y sont branches, la bobine
// engagee), le corps, les sorties vers les buses gauche et droite. Le chemin qui imprime est trace a la
// couleur de son filament. Sorties : id de buse, 1 = gauche, 0 = droite (comme les badges de l'AMS).
// les unites d'une entree, en clair : « AMS A et B », « AMS A, D et HT-A », « HT-A »
const unitsLabel = u => {
  if (!u.length) return "aucun AMS";
  const ids = [...u].sort((a, b) => a.id - b.id);
  const letters = ids.filter(a => a.id < 128).map(a => String.fromCharCode(65 + a.id));
  const items = [...letters, ...ids.filter(a => a.id >= 128).map(amsLab)];
  const list = items.length > 1 ? `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}` : items[0];
  return letters.length ? `AMS ${list}` : list;
};
const SIDE = id => id == null ? null : id === 1 ? "G" : "D";
const SIDE_L = id => id == null ? "—" : id === 1 ? "Gauche" : "Droite";
function switchModel(status) {
  const fs = switchRoutes(status) || {};
  const ams = status?.ams_list || [];
  const nz = status?.nozzles || [];
  // rien d'engage (ams / bac negatifs) : pas d'emplacement, pas de « @0 »
  const slot = s => { if (!s || s.ams == null || s.ams < 0 || s.tray < 0) return null; const a = ams.find(x => x.id === s.ams); const t = a?.trays?.find(x => x.id === s.tray);
    return { label: s.ams >= 128 ? amsLab({ id: s.ams }) : `${String.fromCharCode(65 + s.ams)}${s.tray + 1}`, color: trayCol(t),
      type: t?.filament_type || "" }; };
  const activeAms = ams.find(x => x.id === status?.active_ams_id);
  const activeNz = nz.find(n => n.active)?.id;
  // le chemin en cours : l'entree de l'AMS qui imprime, sinon celle qui sert la buse active
  let live = activeAms?.switch_port || null;
  if (!live && activeNz != null) live = fs.out_a === activeNz ? "A" : fs.out_b === activeNz ? "B" : null;
  const tray = activeAms?.trays?.find(x => x.id === status?.active_tray_id);
  const liveColor = trayCol(tray) || "#22c55e";
  const port = p => ({ p, units: ams.filter(x => x.switch_port === p), slot: slot(fs[`in_${p.toLowerCase()}`]), out: fs[`out_${p.toLowerCase()}`] ?? null,
    live: live === p });
  return { fs, ports: [port("A"), port("B")], nz, liveColor, hl: "#22c55e", temp: id => nz.find(n => n.id === id) };
}
// les rails souples de l'aiguillage : chaque entree a son tube jusqu'a sa buse (droit ou croise),
// le filament continu dedans a la couleur de sa bobine ; celui qui imprime en vert, par-dessus, qui avance
function SwitchRail({ d, live, color, hl, w = 10 }) {
  return <g>
    <path d={d} fill="none" stroke={live ? hl : "#374151"} strokeWidth={w} strokeLinecap="round"
      style={{ transition: "d .8s cubic-bezier(.5,1.3,.5,1)", ...(live ? { filter: `drop-shadow(0 0 5px ${hl}88)` } : {}) }}/>
    <path d={d} fill="none" stroke={live ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)"} strokeWidth={w * 0.55} strokeLinecap="round"
      style={{ transition: "d .8s cubic-bezier(.5,1.3,.5,1)" }}/>
    {color && <path d={d} fill="none" stroke={color} strokeWidth={Math.max(2.5, w * 0.36)} strokeLinecap="round"
      strokeDasharray={live ? "10 7" : "none"} opacity={live ? 1 : 0.7}
      style={{ transition: "d .8s cubic-bezier(.5,1.3,.5,1)", ...(live ? { animation: "bn-dash .8s linear infinite" } : {}) }}/>}
  </g>;
}
function SwitchArt({ m, W, H }) {
  const [A, B] = m.ports;
  const VW = 380, VH = 180, HL = m.hl;
  const inY = { A: 42, B: 138 }, pY = { A: 72, B: 108 }, oY = { G: 72, D: 108 }, nY = { G: 42, D: 138 };
  const cut = (t, n) => t.length > n ? `${t.slice(0, n - 1)}…` : t;
  const units = unitsLabel;
  const path = x => { const s = SIDE(x.out), y = inY[x.p], p = pY[x.p];
    return s ? `M122 ${y} C138 ${y} 136 ${p} 150 ${p} C190 ${p} 190 ${oY[s]} 230 ${oY[s]} C246 ${oY[s]} 244 ${nY[s]} 258 ${nY[s]}`
      : `M122 ${y} C138 ${y} 136 ${p} 150 ${p} L170 ${p}`; };
  const servedBy = side => m.ports.find(x => SIDE(x.out) === side);
  const box = (x, y, w, on) => <rect x={x} y={y} width={w} height="62" rx="14" fill="var(--surface2)" stroke={on ? HL : "var(--border)"} strokeWidth={on ? 2.5 : 1}/>;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width={W} height={H} style={{ display: "block", overflow: "visible" }} aria-label="Aiguillage">
      {/* le corps de l'aiguillage, dessous : les rails le traversent */}
      <rect x="150" y="46" width="80" height="88" rx="16" fill="#111827" stroke="rgba(255,255,255,0.12)"/>
      {[A, B].sort((a, b) => a.live - b.live).map(x => <SwitchRail key={x.p} d={path(x)} live={x.live} color={x.slot?.color} hl={HL} w={11}/>)}
      {[["A", 72], ["B", 108]].map(([p, y]) => <circle key={p} cx="150" cy={y} r="4.5" fill={m.ports.find(x => x.p === p).live ? HL : "#4b5563"}/>)}
      {[["G", 72], ["D", 108]].map(([sd, y]) => <circle key={sd} cx="230" cy={y} r="4.5" fill={servedBy(sd)?.live ? HL : "#4b5563"}/>)}
      {m.fs.calibrating && <text x="190" y="148" textAnchor="middle" fontSize="11" fontWeight="800" fill="#f59e0b">calibration</text>}
      {/* les entrees */}
      {[A, B].map(x => { const y = inY[x.p] - 31;
        return <g key={x.p}>{box(4, y, 118, x.live)}
          <text x="16" y={y + 19} fontSize="13.5" fontWeight="900" fill="#8b5cf6">Entrée {x.p}</text>
          {x.live && <text x="110" y={y + 19} textAnchor="end" fontSize="11" fontWeight="900" fill={HL}>●</text>}
          {x.slot ? <>
            <rect x="16" y={y + 27} width="14" height="14" rx="4" fill={x.slot.color || "transparent"} stroke="var(--muted)" strokeOpacity="0.6"
              strokeDasharray={x.slot.color ? "none" : "2 2"}/>
            <text x="35" y={y + 39} fontSize="12" fontWeight="800" fill="var(--text)">{cut(`${x.slot.label}${x.slot.type ? ` · ${x.slot.type}` : ""}`, 13)}</text></>
            : <text x="16" y={y + 39} fontSize="12" fontWeight="700" fill="var(--muted)">rien d'engagé</text>}
          <text x="16" y={y + 54} fontSize="10.5" fontWeight="700" fill="var(--muted)">{units(x.units)}</text></g>; })}
      {/* les buses */}
      {[["G", 1], ["D", 0]].map(([sd, id]) => { const y = nY[sd] - 31, by = servedBy(sd), n = m.temp(id), on = !!by?.live;
        return <g key={sd}>{box(258, y, 118, on)}
          <text x="270" y={y + 19} fontSize="13.5" fontWeight="900" fill="var(--text)">{sd === "G" ? "Gauche" : "Droite"}</text>
          <text x="270" y={y + 40}>
            <tspan fontSize="18" fontWeight="900" fill={n && n.temp > 40 ? "#f97316" : "var(--text2)"}>{n ? `${Math.round(n.temp)}°` : "—"}</tspan>
            {n?.target > 0 && <tspan dx="4" fontSize="11" fontWeight="700" fill="var(--muted)">/{Math.round(n.target)}°</tspan>}</text>
          <text x="270" y={y + 55} fontSize="11" fontWeight="800" fill={on ? HL : "var(--muted)"}>{by ? `${on ? "● " : ""}depuis ${by.p}` : "libre"}</text></g>; })}
    </svg>
  );
}
// le schema en petit : les entrees en pastilles a la couleur de leur bobine (A, B), le corps, les buses
// G et D ; le chemin qui imprime en vert, le filament qui avance dedans a sa couleur
function SwitchMini({ m, W, H }) {
  const VW = 170, VH = 120;
  const s = Math.min(W / VW, H / VH);
  const inY = { A: 32, B: 88 }, oY = { G: 32, D: 88 };
  const pin = { A: 46, B: 74 }, pout = { G: 46, D: 74 };
  const path = x => { const sd = SIDE(x.out), y = inY[x.p], q = pin[x.p];
    return sd ? `M38 ${y} C52 ${y} 50 ${q} 62 ${q} C85 ${q} 85 ${pout[sd]} 108 ${pout[sd]} C120 ${pout[sd]} 118 ${oY[sd]} 132 ${oY[sd]}`
      : `M38 ${y} C52 ${y} 50 ${q} 62 ${q} L74 ${q}`; };
  const served = sd => m.ports.find(x => SIDE(x.out) === sd);
  return <svg viewBox={`0 0 ${VW} ${VH}`} width={VW * s} height={VH * s} style={{ display: "block", overflow: "visible" }} aria-label="Aiguillage">
    <rect x="62" y="34" width="46" height="52" rx="11" fill="#111827" stroke="rgba(255,255,255,0.12)"/>
    {[...m.ports].sort((a, b) => a.live - b.live).map(x => <SwitchRail key={x.p} d={path(x)} live={x.live} color={x.slot?.color} hl={m.hl} w={8}/>)}
    {m.ports.map(x => { const c = x.slot?.color, y = inY[x.p];
      return <g key={x.p}>
        {/* une entree vide : le cercle en creux, sa lettre lisible (en couleur de texte, pas en blanc), « vide » dessous */}
        <circle cx="22" cy={y} r="17" fill={c || "var(--surface2)"} stroke={x.live ? m.hl : c ? "rgba(0,0,0,0.25)" : "var(--text2)"} strokeWidth={x.live ? 3 : c ? 1.5 : 2}
          strokeDasharray={c ? "none" : "4 3"}/>
        <text x="22" y={y + 5} textAnchor="middle" fontSize="14" fontWeight="900"
          fill={!c ? "var(--text2)" : (parseInt(c.slice(1, 3), 16) * 0.299 + parseInt(c.slice(3, 5), 16) * 0.587 + parseInt(c.slice(5, 7), 16) * 0.114) > 160 ? "#0f172a" : "#fff"}>{x.p}</text>
        {!c && <text x="22" y={y + 29} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="var(--muted)">vide</text>}
      </g>; })}
    {[["G", 1], ["D", 0]].map(([sd, id]) => { const by = served(sd), on = !!by?.live, n = m.temp(id), y = oY[sd];
      return <g key={sd}>
        <rect x="132" y={y - 16} width="36" height="32" rx="9" fill={on ? `${m.hl}22` : "var(--surface2)"} stroke={on ? m.hl : "var(--border)"} strokeWidth={on ? 2.5 : 1}/>
        <text x="150" y={y - 1} textAnchor="middle" fontSize="12.5" fontWeight="900" fill={on ? m.hl : "var(--text)"}>{sd}</text>
        {n && <text x="150" y={y + 11} textAnchor="middle" fontSize="9.5" fontWeight="800" fill={n.temp > 40 ? "#f97316" : "var(--muted)"}>{Math.round(n.temp)}°</text>}
      </g>; })}
  </svg>;
}
function FilaSwitch({ status, o, sz }) {
  if (!status?.fila_switch?.installed) return null;
  const m = switchModel(status);
  const arrow = x => <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: x.live ? m.hl : "var(--text2)", fontWeight: 900 }}>
    IN-{x.p}<span style={{ fontSize: 11 }}>→</span>{SIDE(x.out) || "—"}</span>;
  // bas : une ligne par entree, le chemin en cours en couleur
  const rows = W => <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
    {m.ports.map(x => <div key={x.p} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: "3px 8px", borderRadius: 10,
      background: x.live ? `${m.hl}22` : "transparent", border: `1px solid ${x.live ? `${m.hl}88` : "transparent"}` }}>
      <span style={{ fontSize: 12, fontWeight: 900, color: "#8b5cf6", whiteSpace: "nowrap" }}>IN-{x.p}</span>
      <span style={{ width: 12, height: 12, borderRadius: 4, flexShrink: 0, background: x.slot?.color || "transparent",
        border: x.slot?.color ? "1px solid rgba(0,0,0,0.2)" : "1px dashed var(--muted)" }}/>
      {W >= 215 && <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
        {x.slot ? x.slot.label : "vide"}</span>}
      <span style={{ flex: 1, minWidth: 12, height: 0, borderTop: `2px ${x.live ? "solid" : "dashed"} ${x.live ? m.hl : "var(--border)"}` }}/>
      <span style={{ fontSize: 12, fontWeight: 900, color: x.live ? m.hl : "var(--text)", whiteSpace: "nowrap" }}>{SIDE_L(x.out)}</span>
    </div>)}</div>;
  return (
    <Tile icon={<Split size={15}/>} color="#8B5CF6" label="Aiguillage"
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 12, fontSize: 13.5 }}>{m.ports.map(x => <React.Fragment key={x.p}>{arrow(x)}</React.Fragment>)}</span>}
      zoom={({ W }) => <>
        <div style={{ display: "flex", justifyContent: "center" }}><SwitchArt m={m} W={Math.min(W, 680)} H={Math.min(W, 680) * 180 / 380}/></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {m.ports.map(x => <div key={x.p} style={{ padding: "11px 13px", borderRadius: 16, display: "flex", flexDirection: "column", gap: 8,
            background: `linear-gradient(135deg, ${x.live ? m.hl : "#8b5cf6"}1c, transparent 65%), var(--surface2)`,
            border: `1px solid ${x.live ? `${m.hl}88` : "var(--border)"}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: "#8b5cf6" }}>Entrée {x.p}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: x.live ? m.hl : "var(--text2)" }}>→ buse {SIDE_L(x.out).toLowerCase()}</span>
              {x.live && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: m.hl }}>● imprime</span>}</div>
            <Muted size={12}>Bobine engagée : <b style={{ color: "var(--text)" }}>{x.slot ? `${x.slot.label}${x.slot.type ? ` · ${x.slot.type}` : ""}` : "aucune"}</b></Muted>
            {x.units.length ? x.units.map(a => <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", width: 50 }}>{amsLab(a)}</span>
              <span style={{ display: "inline-flex", gap: 4 }}>{(a.trays || []).map(t => <span key={t.id} title={t.filament_type}
                style={{ width: 18, height: 18, borderRadius: 6, background: trayCol(t) || "transparent",
                  border: trayCol(t) ? "1px solid rgba(0,0,0,0.2)" : "1px dashed var(--muted)",
                  boxShadow: a.id === status.active_ams_id && t.id === status.active_tray_id ? `0 0 0 2px var(--surface), 0 0 0 4px ${m.hl}` : "none" }}/>)}</span>
              {a.humidity > 0 && <Muted size={11.5} style={{ marginLeft: "auto" }}>💧 {a.humidity} %</Muted>}</div>)
              : <Muted size={12}>Aucun AMS branché sur cette entrée</Muted>}
          </div>)}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
          {m.fs.calibrating && <span style={{ color: "#f59e0b" }}>● calibration en cours</span>}
</div>

      </>}>
      {({ W, H }) => {
        const h = Math.min(H, W * 180 / 380);
        // le schema seulement si son texte reste lisible (pas plus petit qu'aux 9/10e) ;
        // sinon, haute : une carte par entree (entree, bobine, fleche, buse) ; basse : une ligne par entree
        const big = h >= 162;
        // demi-colonne : le schema compact, qui remplit la place
        if (!big && W < 260 && H >= 80) {
          // sous le schema, s'il reste de la place : chaque entree en clair (sa bobine, sa buse)
          const dh = Math.min(H, W * 120 / 170), extra = H - dh >= 44;
          return <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0 }}>
            <SwitchMini m={m} W={W} H={extra ? H - 44 : H}/>
            {extra && <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", gap: 3 }}>
              {m.ports.map(x => <div key={x.p} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800, minWidth: 0,
                color: x.live ? m.hl : "var(--text2)" }}>
                <span style={{ color: "#8b5cf6" }}>{x.p}</span>
                <span style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0, background: x.slot?.color || "transparent",
                  border: x.slot?.color ? "1px solid rgba(0,0,0,0.2)" : "1px dashed var(--muted)" }}/>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.slot ? `${x.slot.label}${x.slot.type ? ` · ${x.slot.type}` : ""}` : "vide"}</span>
                <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>→ {SIDE(x.out) || "—"}</span></div>)}</div>}
          </div>;
        }
        if (!big && H >= 150) return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
          {m.ports.map(x => { const n = m.temp(x.out);
            return <div key={x.p} style={{ padding: "8px 10px", borderRadius: 14, display: "flex", flexDirection: "column", gap: 4,
              background: x.live ? `${m.hl}1f` : "var(--surface2)", border: `1.5px solid ${x.live ? m.hl : "transparent"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 900, color: "#8b5cf6" }}>Entrée {x.p}</span>
                <span style={{ width: 12, height: 12, borderRadius: 4, background: x.slot?.color || "transparent",
                  border: x.slot?.color ? "1px solid rgba(0,0,0,0.2)" : "1px dashed var(--muted)" }}/>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text2)" }}>{x.slot?.label || "vide"}</span></div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 14, color: x.live ? m.hl : "var(--muted)", fontWeight: 900 }}>→</span>
                <span style={{ fontSize: 14, fontWeight: 900, color: x.live ? m.hl : "var(--text)" }}>{SIDE_L(x.out)}</span>
                {n && <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 900, color: n.temp > 40 ? "#f97316" : "var(--text2)" }}>{Math.round(n.temp)}°</span>}</div>
              {H >= 230 && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {unitsLabel(x.units)}</span>}
            </div>; })}</div>;
        if (!big) return rows(W);
        return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><SwitchArt m={m} W={h * 380 / 180} H={h}/></div>;
      }}
    </Tile>
  );
}
// ── La tete d'impression (double buse) : comme dans l'appli Bambu. Sur la H2C, seule la buse gauche
// bouge : baissee (plus bas que la droite) quand elle imprime, remontee (plus haut) sinon ; la droite
// est fixe. Le filament arrive dans chacune par le haut. Buse 1 = gauche, 0 = droite. ──
function headModel(st) {
  const nz = st?.nozzles || [];
  const ams = st?.ams_list || [];
  const tray = (a, t) => ams.find(x => x.id === a)?.trays?.find(x => x.id === t);
  const routes = switchRoutes(st);
  const side = id => {
    const n = nz.find(x => x.id === id);
    if (!n) return null;
    // ce qui est charge : l'emplacement que l'imprimante annonce pour cette buse, sinon (buse active)
    // l'emplacement actif, sinon l'entree de l'aiguillage qui va vers elle
    let a = n.slot_ams >= 0 ? n.slot_ams : null, t = n.slot_tray >= 0 ? n.slot_tray : null;
    if (a == null && n.active && st.active_ams_id >= 0) { a = st.active_ams_id; t = st.active_tray_id; }
    if (a == null && routes) { const p = routes.out_a === id ? routes.in_a : routes.out_b === id ? routes.in_b : null; if (p) { a = p.ams; t = p.tray; } }
    // 254 / 255 : la bobine externe (rangee par l'appli sous l'unite 255 : E1, E2)
    if (a === 254) a = 255;
    const tr = a != null ? tray(a, t) : null;
    // un emplacement vide (ou que l'AMS ne decrit pas) : aucun filament, et pas de numero qui ne veut rien dire
    const loaded = tr && !tr.empty && (trayCol(tr) || tr.filament_type);
    return { n, slot: loaded ? slotLabel(a, t) : null, color: loaded ? trayCol(tr) : null, type: loaded ? (tr?.spool_info?.fila_type || tr?.filament_type || "") : "",
      name: loaded ? (tr?.spool_info?.translated_name || tr?.spool_info?.name || "") : "", brand: loaded ? (tr?.spool_info?.brand || "") : "" };
  };
  const live = isLive(st);
  const L = side(1), R = side(0);
  // pendant une impression : la buse active imprime ; au repos, elle est seulement selectionnee
  // (la gauche, baissee) ; l'autre levee (gauche) ou au repos (droite).
  // Au lancement (chauffe, calibration, nettoyage : gcode PREPARE ou une etape stg_cur hors 0),
  // la buse active prepare, elle n'imprime pas encore -- souvent la gauche, sans filament.
  // En pause, elle attend. Et sans filament, une buse n'imprime jamais.
  const gs = String(st?.status || "").toUpperCase(), stage = st?.print_stage;
  const prep = live && (gs === "PREPARE" || gs === "SLICING" || (stage != null && stage !== 0 && stage !== 255 && stage !== -1));
  const paused = gs === "PAUSE" || gs === "PAUSED";
  for (const [x, left] of [[L, true], [R, false]]) if (x) {
    const on = live && x.n.active;
    x.printing = on && !prep && !paused && !!x.slot;
    // en preparation ou en pause : l'etape que l'imprimante annonce, si elle la dit
    const what = stageLabel(st);
    const lc = what ? what[0].toLowerCase() + what.slice(1) : null;
    x.state = x.printing ? "● imprime" : on && paused ? (lc || "en pause") : on && prep ? (lc || "préparation") : x.n.active ? (left ? "baissée" : "sélectionnée") : left ? "levée" : "au repos";
  }
  return { L, R, dual: nz.length > 1, live };
}
export function HeadArt({ st, h = 160 }) {
  const small = h < 110;
  const { L, R } = headModel(st);
  const w = h * 200 / 170;
  const tube = (x, s, id) => {
    const c = s?.color || "#94a3b8";
    return <g key={id}>
      <defs><linearGradient id={`hd-t${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c} stopOpacity=".15"/><stop offset=".55" stopColor={c}/></linearGradient></defs>
      <rect x={x - 7} y="0" width="14" height="46" rx="7" fill={`url(#hd-t${id})`} stroke={s?.color ? "rgba(0,0,0,0.15)" : "rgba(148,163,184,0.4)"}/>
      {s?.printing && s?.color && <rect x={x - 2} y="4" width="4" height="38" rx="2" fill="#fff" opacity=".35"
        style={{ animation: "bn-feed 1.6s linear infinite" }}/>}
      <rect x={x - 11} y="40" width="22" height="14" rx="4" fill="#cbd5e1" stroke="#64748b"/>
    </g>;
  };
  const nozzle = (x, s, id, dark, moves) => {
    if (!s) return null;
    const up = moves && !s.n.active, dy = moves ? (s.n.active ? 10 : -12) : 0, hot = heat(s.n.temp);
    return <g key={id} transform={`translate(0 ${dy})`} style={{ transition: "transform .6s" }} opacity={up ? 0.75 : 1}>
      <rect x={x - 14} y="118" width="28" height="18" rx="4" fill={dark ? "#475569" : "#94a3b8"} stroke="#334155"/>
      <path d={`M${x - 7} 136 H${x + 7} L${x + 3} 150 H${x - 3} Z`} fill={s.n.temp > 40 ? hot : "#64748b"} stroke="#334155" strokeLinejoin="round"
        style={s.printing && s.n.temp > 150 ? { filter: `drop-shadow(0 0 5px ${hot})` } : undefined}/>
      {s.printing && <rect x={x - 22} y="112" width="44" height="42" rx="8" fill={small ? "rgba(34,197,94,0.18)" : "none"} stroke="#22c55e"
        strokeWidth={small ? 5 : 2} strokeDasharray={small ? "none" : "4 3"} opacity={small ? 1 : 0.8}/>}
    </g>;
  };
  return <svg viewBox="0 0 200 170" width={w} height={h} aria-label="Tête d'impression" style={{ display: "block", overflow: "visible" }}>
    {tube(70, L, "l")}{tube(130, R, "r")}
    {/* le corps : moitie gauche claire, moitie droite sombre, le ventilateur au milieu */}
    <path d="M40 62 Q40 52 50 52 H100 V122 H48 Q40 122 40 114 Z" fill="#cbd5e1" stroke="#64748b"/>
    <path d="M100 52 H150 Q160 52 160 62 V114 Q160 122 152 122 H100 Z" fill="#64748b" stroke="#334155"/>
    <path d="M56 62 L72 74 M144 62 L128 74" stroke="#94a3b8" strokeWidth="5" strokeLinecap="round" opacity=".6"/>
    <circle cx="100" cy="88" r="17" fill="#94a3b8" stroke="#475569" strokeWidth="2"/>
    <circle cx="100" cy="88" r="9" fill="#e2e8f0" stroke="#475569" strokeWidth="2"/>
    <circle cx="100" cy="88" r="3" fill="#475569"/>
    {[["l", 64, L], ["r", 136, R]].map(([k, x, s]) => <rect key={k} x={x - 5} y="80" width="10" height="16" rx="5" fill={s?.printing ? "#22c55e" : "#86efac"}
      opacity={s?.n?.active ? 1 : 0.45}/>)}
    {nozzle(70, L, "nl", false, true)}{nozzle(130, R, "nr", true, false)}
  </svg>;
}
// une buse en carte : cote, temperature et consigne, levee ou en impression, le filament charge
function HeadSide({ s, label, big = false }) {
  if (!s) return null;
  const hot = heat(s.n.temp), live = s.printing;
  return <div style={{ padding: big ? "10px 12px" : "6px 9px", borderRadius: 14, minWidth: 0, display: "flex", flexDirection: "column", gap: big ? 4 : 2,
    background: live ? "linear-gradient(135deg, rgba(34,197,94,0.14), transparent 70%), var(--surface2)" : "var(--surface2)",
    border: `1.5px solid ${live ? "rgba(34,197,94,0.6)" : "transparent"}` }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: big ? 13 : 11.5, fontWeight: 900, color: "var(--text2)" }}>{label}</span>
      <span style={{ marginLeft: "auto", fontSize: big ? 11.5 : 10, fontWeight: 800, color: live ? "#16a34a" : "var(--muted)", whiteSpace: "nowrap" }}>
        {s.state}</span></div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
      <span style={{ fontSize: big ? 22 : 16, fontWeight: 900, color: s.n.temp > 40 ? hot : "var(--text)", lineHeight: 1.05 }}>{Math.round(s.n.temp)}°</span>
      {s.n.target > 0 && <span style={{ fontSize: big ? 11.5 : 10, fontWeight: 800, color: "var(--muted)" }}>/{Math.round(s.n.target)}°</span>}</div>
    <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
      <span style={{ width: big ? 13 : 10, height: big ? 13 : 10, borderRadius: 4, flexShrink: 0, background: s.color || "transparent",
        border: s.color ? "1px solid rgba(0,0,0,0.2)" : "1px dashed var(--muted)" }}/>
      <span style={{ fontSize: big ? 12 : 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {s.slot ? [s.slot, big ? (s.name || s.type) : s.type].filter(Boolean).join(" · ") : "aucun filament"}</span></div>
    {big && s.slot && (s.type || s.brand) && <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{[s.name && s.type, s.brand].filter(Boolean).join(" · ")}</span>}
  </div>;
}
function Toolhead({ status, sz }) {
  if (!status?.connected || (status?.nozzles || []).length < 2) return null;
  const m = headModel(status);
  return (
    <Tile icon={<Wrench size={15}/>} color="#22C55E" label="Tête d'impression"
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 10, fontSize: 13.5 }}>
        {[["G", m.L], ["D", m.R]].map(([k, s]) => s && <span key={k} style={{ color: s.printing ? "#16a34a" : "var(--muted)" }}>{k} {Math.round(s.n.temp)}°</span>)}</span>}
      zoom={<>
        <div style={{ display: "flex", justifyContent: "center" }}><HeadArt st={status} h={220}/></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><HeadSide s={m.L} label="Gauche" big/><HeadSide s={m.R} label="Droite" big/></div>
      </>}>
      {({ W, H }) => {
        // une ligne par buse : son cote (vert si elle imprime), le filament, la temperature, son etat si la place le permet
        // le texte grandit avec la tuile (12,5 a 17 px) : une tuile basse et etroite n'a plus des lignes minuscules
        const fs = Math.max(12.5, Math.min(17, H / 7.5)), sq = Math.round(fs * 0.85);
        const lines = <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: fs * 0.45 }}>
          {[["G", m.L], ["D", m.R]].map(([k, s]) => s && <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: fs, fontWeight: 800, minWidth: 0 }}>
            <span style={{ width: fs * 0.9, flexShrink: 0, color: s.printing ? "#16a34a" : "var(--muted)" }}>{k}</span>
            <span style={{ width: sq, height: sq, borderRadius: 3, flexShrink: 0, background: s.color || "transparent", border: s.color ? "1px solid rgba(0,0,0,0.2)" : "1.5px dashed var(--text2)" }}/>
            <span style={{ width: fs * 2.7, flexShrink: 0, color: s.n.temp > 40 ? heat(s.n.temp) : "var(--text)" }}>{Math.round(s.n.temp)}°</span>
            {/* le filament : son nom, et dessous l'etat, l'emplacement, la matiere et la marque */}
            {(W >= 230 || (H >= 150 && W >= 140)) && <span style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.name || s.type || "aucun filament"}</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: s.printing ? "#16a34a" : "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {[s.state, s.slot, s.name && s.type, s.brand].filter(Boolean).join(" · ")}</span></span>}
          </div>)}</div>;
        // bas : le dessin a gauche, les buses a cote ; haut : le dessin centre, les buses dessous (en cartes si la place le permet)
        if (H < 150 && (W >= 215 || H < 120)) return <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <HeadArt st={status} h={Math.max(50, Math.min(H - 4, 150, (W >= 300 ? W * 0.32 : W * 0.48) * 170 / 200))}/>{lines}</div>;
        const cards = W >= 200 && H >= 230;
        return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "center" }}><HeadArt st={status} h={Math.max(50, Math.min(H - (cards ? 96 : 50), 200, (W - 8) * 170 / 200))}/></div>
          {cards ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}><HeadSide s={m.L} label="Gauche"/><HeadSide s={m.R} label="Droite"/></div>
            : <div style={{ flex: "0 0 auto", display: "flex" }}>{lines}</div>}
        </div>;
      }}
    </Tile>
  );
}
// les couleurs chargees : toutes les bobines de l'AMS en pastilles, celle qui imprime cerclee
function Colors({ status, o, sz }) {
  const trays = (status?.ams_list || []).filter(a => a.id !== 255 && a.id !== 254).flatMap(a => (a.trays || []).map(t => ({ ...t, ams: a })))
    .filter(trayCol);
  if (!trays.length) return null;
  const on = t => t.ams.id === status?.active_ams_id && t.id === status?.active_tray_id;
  const dot = (t, s, label) => <span key={`${t.ams.id}-${t.id}`} title={`${amsLab(t.ams)} · ${t.filament_type || ""}`} style={{ display: "flex", flexDirection: "column",
    alignItems: "center", gap: 3, minWidth: 0 }}>
    <span data-pk="" style={{ width: s, height: s, borderRadius: Math.round(s / 3.2), background: trayCol(t), border: "1px solid rgba(0,0,0,0.15)",
      boxShadow: on(t) ? "0 0 0 3px var(--surface), 0 0 0 5px #3b82f6" : "none", display: "block" }}/>
    {label && <span style={{ fontSize: 10.5, fontWeight: 800, color: on(t) ? "#3b82f6" : "var(--muted)", whiteSpace: "nowrap", lineHeight: "13px",
      maxWidth: s + 6, overflow: "hidden", textOverflow: "ellipsis" }}>
      {s >= 56 ? `${slotOf(t)} · ${t.filament_type}` : slotOf(t)}</span>}</span>;
  return (
    <Tile icon={<Palette size={15}/>} color="#EC4899" label="Couleurs chargées"
      zoom={<>
        <Stats items={[["Bobines chargées", trays.length], ...Object.entries(trays.reduce((m, t) => { const k = t.filament_type || "?"; m[k] = (m[k] || 0) + 1; return m; }, {}))
          .sort((a, b) => b[1] - a[1]).slice(0, 3)]}/>
        {[...new Map(trays.map(t => [t.ams.id, t.ams])).values()].map(a => <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><H2>{amsLab(a)}</H2>
            {a.humidity > 0 && <Muted size={11.5}>💧 {a.humidity} %</Muted>}</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{trays.filter(t => t.ams.id === a.id).map(t => dot(t, 64, true))}</div></div>)}</>}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 3 }}>{trays.slice(0, 18).map(t => <span key={`${t.ams.id}-${t.id}`}
        style={{ width: 13, height: 13, borderRadius: 4, background: trayCol(t), border: "1px solid rgba(0,0,0,0.2)" }}/>)}</span>}>
      {({ W, H }) => {
        const lg = fitGrid(trays.length, W - 6, H - 6, { gap: 6, max: 64, extra: 16 });
        const labels = lg.size >= 40;
        const g = labels ? lg : fitGrid(trays.length, W - 6, H - 6, { gap: 6, max: 70 });
        return <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${g.cols}, ${g.size}px)`, gap: 6, justifyContent: "space-evenly", alignContent: "center", padding: 3 }}>
          {trays.map(t => dot(t, g.size, labels))}</div>;
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
      {(days || []).map((x, i) => <span key={ymd(x.day)} data-pk="" title={`${x.day.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} : ${x.count || 0}`}
        style={{ width: g.size, height: g.size, borderRadius: Math.max(2, g.size / 4), background: x.count ? `rgba(249,115,22,${0.3 + 0.7 * x.count / m})` : "var(--surface2)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.min(13, g.size * 0.36), fontWeight: 800,
          color: x.count ? "rgba(255,255,255,0.92)" : "var(--muted)", outline: i === days.length - 1 ? "2px solid #f97316" : "none", outlineOffset: 1 }}>
        {g.size >= 26 ? x.day.getDate() : ""}</span>)}</div>;
  };
  const active = (days || []).filter(x => x.count > 0).length;
  const hero = <Hero fill={false} value={days ? n : "…"} unit={`jour${n > 1 ? "s" : ""} d'affilée`} sub={days && `record sur 30 jours : ${best} · ${active} jours actifs`}
    color={n ? "#ea580c" : "var(--text)"} delta={n > 0 && n >= best ? <span style={{ fontSize: 11.5, fontWeight: 800, color: "#ea580c" }}>🔥 record en cours</span> : null}/>;
  return (
    <Tile icon={<CalendarCheck size={15}/>} color="#F97316" label="Série" zoom={<>{hero}
      {days && <Stats items={[["Série en cours", `${n} j`, "#ea580c"], ["Record (30 j)", `${best} j`], ["Jours actifs", `${active} / 30`],
        ["Impressions (30 j)", days.reduce((t, x) => t + (x.count || 0), 0)]]}/>}
      {days && <><H2>Les 30 derniers jours</H2>{heat(700, 240)}</>}</>}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Flame size={15} color="#ea580c"/>{days ? n : "…"}
        <Muted>jour{n > 1 ? "s" : ""}</Muted></span>}>
      {({ W, H }) => {
        const hh = Math.min(H, H >= 200 ? 78 : 56);
        if (o.heat && days && H - hh < 22) {
          // pas la place du calendrier : les derniers jours en carres, a droite (large) ou dessous
          const wide = W >= 240, k = Math.min(days.length, wide ? 14 : 7, Math.floor((W - (wide ? 130 : 0)) / 15));
          const row = <span style={{ display: "inline-flex", gap: 3 }}>{days.slice(-k).map(x => <span key={ymd(x.day)} title={`${x.day.getDate()} : ${x.count || 0}`}
            style={{ width: 12, height: 12, borderRadius: 3, background: x.count ? "#f97316" : "var(--surface2)" }}/>)}</span>;
          return <div style={{ flex: 1, display: "flex", flexDirection: wide ? "row" : "column", alignItems: wide ? "center" : "flex-start",
            justifyContent: wide ? "space-between" : "center", gap: wide ? 10 : 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span data-pk="" style={{ fontSize: 26, fontWeight: 900, color: n ? "#ea580c" : "var(--text)", lineHeight: 1 }}>{n}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", whiteSpace: "nowrap" }}>jour{n > 1 ? "s" : ""} d'affilée</span></div>
            {row}</div>;
        }
        return <><BoxCtx.Provider value={{ W, H: hh }}>{hero}</BoxCtx.Provider>{o.heat && days && heat(W, H - hh - 6)}</>;
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
    <Tile icon={<Target size={15}/>} color={color} label="Objectif" zoom={<>
      <BoxCtx.Provider value={{ W: 600, H: 180, zoom: true }}>{hero}</BoxCtx.Provider>
      <Stats items={[["Fait", now == null ? "…" : fmt(now), color], ["Objectif", tf],
        ["Reste", now == null ? "…" : done >= 1 ? "atteint 🎉" : fmt(Math.max(0, target * scale - now))]]}/>
      {o.period === "week" && week && <><H2>Les 7 derniers jours</H2><Bars values={week.map(val)} labels={week.map(x => x.day.toLocaleDateString("fr-FR", { weekday: "narrow" }))}
        color={color} height={120} hi={6} showValues fmt={fmt}/></>}</>}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{Math.round(done * 100)} %<Muted>{now == null ? "" : `${fmt(now)} / ${tf}`}</Muted></span>}>
      {({ W }) => <Stack min={W < 215 ? 150 : 90} head={hero} blocks={[
        { h: statsH(2, W), node: <Stats items={[["Reste", now == null ? "…" : done >= 1 ? "atteint 🎉" : fmt(Math.max(0, target * scale - now)), done >= 1 ? "#16a34a" : undefined],
          ["Par jour", now == null ? "…" : fmt(now / (o.period === "week" ? 7 : new Date().getDate()))]]}/> },
        o.period === "week" && week && { h: 92, node: <Bars values={week.map(val)} labels={week.map(x => x.day.toLocaleDateString("fr-FR", { weekday: "narrow" }))}
          color={color} height={74} hi={6}/> }]}/>}
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
  today: { label: "Aujourd'hui", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Today v={d.today} p={d.prints} o={o} sz={sz(it)} st={st} lp={d.live}/>,
    options: [B("ring", "Anneau de réussite", true, { hint: "La part des impressions réussies du jour." }), B("yesterday", "Écart avec hier", true),
      B("weight", "Poids imprimé", true), B("hours", "Heures de machine", true), B("cost", "Coût du jour", false)] },
  week: { label: "Derniers jours", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Week o={o} sz={sz(it)}/>,
    options: [C("range", "Période", 7, [[7, "7 jours"], [14, "14 jours"], [30, "30 jours"]]),
      C("metric", "Compter", "h", [["h", "les heures"], ["n", "les impressions"], ["g", "les grammes"]]), B("avg", "Moyenne par jour", true)] },
  next: { label: "À faire", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Next q={d.queue} o={o} sz={sz(it)}/>,
    options: [B("thumbs", "Vignettes", true), B("ready", "Seulement ce qui est prêt", false, { hint: "Les modèles imprimables tout de suite avec l'AMS (en tout ou en partie)." }),
      B("weight", "Poids", true), SCROLL(false)] },
  last: { label: "Dernières impressions", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Last p={d.prints} o={o} sz={sz(it)} st={st} lp={d.live}/>,
    options: [B("when", "Depuis quand", true), B("cost", "Coût", false), B("photo", "Rappel « pas de photo »", true), SCROLL(true)] },
  stock: { label: "Stock", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Stock s={d.spools} o={o} sz={sz(it)}/>,
    options: [C("style", "Bobines basses", "dots", [["dots", "en pastilles"], ["list", "en liste"]], { hint: "Autant que la tuile en tient ; l'anneau d'une pastille montre ce qui reste." }),
      C("sort", "Les plus basses", "g", [["g", "en grammes"], ["pct", "en pourcentage"]]), B("kg", "Poids total", true)] },
  dry: { label: "Séchage", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Dry v={d.dry} status={st} o={o} sz={sz(it)}/>,
    options: [B("ring", "Anneau « au sec »", true), B("inams", "Combien sont dans l'AMS", true)] },
  humidity: { label: "Humidité des AMS", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Humidity status={st} o={o} sz={sz(it)}/>,
    options: [C("style", "Affichage", "gauges", [["gauges", "gouttes"], ["bars", "barres"]], { hint: "Les gouttes passent en barres quand la tuile est trop basse." }),
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
    options: [C("style", "Affichage", "thermo", [["thermo", "thermomètres"], ["gauges", "jauges"], ["list", "lignes"]],
      { hint: "Thermomètres : une carte par source, sa couleur suit la chaleur, la consigne marquée sur la barre. Tout passe en lignes quand ce serait trop petit." }),
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
  head: { label: "Tête d'impression", w: [1, 2], h: [2, 1, 3], render: (d, st, o, it) => <Toolhead status={st} sz={sz(it)}/> },
  switch: { label: "Aiguillage (Track Switch)", w: [2, 1], h: [2, 1, 3, 0.5], render: (d, st, o, it) => <FilaSwitch status={st} o={o} sz={sz(it)}/> },
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
export const HEIGHTS = [1, 2, 3];   // trois rangees au plus (23/10/2026)
export { Zoom };
for (const t of Object.values(TILES)) { const d = t.h[0] === 0.5 ? 1 : t.h[0]; t.h = [d, ...HEIGHTS.filter(x => x !== d)]; }
