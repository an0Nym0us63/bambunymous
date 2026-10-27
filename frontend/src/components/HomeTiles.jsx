import React, { createContext, useContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { colorBg, parseColorsList, finishOf, trayBg } from "../utils/colors";
import { importRetry } from "../utils/importRetry";
import AllAlertsModal from "./AllAlertsModal";
import { Hide } from "./Cachettes";
import { useFriend } from "../store/friend";
import { relayed } from "./Friends";
import { stageLabel } from "../utils/printStage";
import { QUEUE_SORTS, sortQueue, plateRound, plateDoneInRound } from "../utils/queueSort";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CalendarClock, BarChart3, ListChecks, History, Package, Flame, Droplets, Coins, Star, Users, Trophy,
         Dices, ChevronRight, Camera, Video, Thermometer, CalendarDays, ShoppingBag, Rss, Images, Zap, Medal as MedalIcon,
         BellRing, Split, Fan, Wrench, TrendingUp, TrendingDown, Key, Ticket, X, ArrowUpRight, Timer, Palette, Target, Disc3, CalendarCheck, Maximize2 } from "lucide-react";
import client, { apiUrl, apiThumb } from "../api/client";
import { RateButton } from "./MwToRate";
import { mwImg } from "./MwImg";
import LiveCamera from "./LiveCamera";
import { Medal, gradeOf, GradeEmblem, CARD_ORDER } from "./medals";
import { DryCard } from "./AMSSection";
import SpoolSVG from "./SpoolSVG";
import { switchRoutes, slotLabel, grilleAccueil, lireDisposition, trayPct } from "../utils/ams";
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
// la vignette d'une impression, a la taille de la tuile (le serveur la reduit)
const printImg = (id, w = 256) => apiThumb(apiUrl(`/prints/${id}/image`), w);
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
  const openBig = useCallback(() => setOpen(true), []);
  const act = onClick || (zoom ? openBig : to ? () => nav(to) : null);
  const big = open && <Zoom icon={icon} color={color} label={label} to={to} onClose={() => setOpen(false)}>{zoom}</Zoom>;
  if (mini) return (
    <div className="card" role={act ? "button" : undefined} tabIndex={act ? 0 : undefined} onClick={act}
      style={{ padding: "0 12px", display: "flex", alignItems: "center", gap: 8, minWidth: 0, cursor: act ? "pointer" : "default",
        position: "relative", overflow: "hidden", height: "100%", boxSizing: "border-box" }}>
      <span data-pk="" style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
        background: `${color}22`, color, flexShrink: 0 }}>{icon}</span>
      <span className="tile-head" style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", minWidth: 0, flexShrink: 1 }}><W text={label}/></span>
      <Hide at={`tile:${label}`} size={9}/>
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
      <div className="tile-head" style={{ display: "flex", alignItems: "center", gap: 8, position: "relative", minWidth: 0 }}>
        <span data-pk="" style={{ width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
          background: `${color}22`, color, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", letterSpacing: ".02em", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", minWidth: 0 }}><W text={label}/></span>
        <Hide at={`tile:${label}`}/>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {badge}{!zoom && act && <ChevronRight size={14} style={{ color: "var(--muted)" }}/>}
          {/* la tuile s'ouvre en grand en touchant son fond ; ses elements, eux, ouvrent leur fiche : le bouton le dit */}
          {zoom && act === openBig && <span data-pk="" data-tip="Ouvrir en grand" aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center", color, background: `${color}1a`, border: `1px solid ${color}33`, boxSizing: "border-box" }}>
            <Maximize2 size={11} strokeWidth={2.5}/></span>}</span>
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
            <Hide at={`zoom:${label}`} size={12}/>
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
// un grand chiffre en degrade, a la couleur de sa tuile (plutot qu'un gros chiffre noir)
const gradText = (a, b) => ({ backgroundImage: `linear-gradient(135deg, ${a}, ${b})`, WebkitBackgroundClip: "text", backgroundClip: "text",
  WebkitTextFillColor: "transparent", filter: `drop-shadow(0 2px 8px ${a}40)` });
function Hero({ visual, value, unit, delta, sub, color = "var(--text)", reserve = 0, fill = true, accent = null }) {
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
          <span data-pk="" style={{ fontSize: fs, fontWeight: 900, lineHeight: 1.05, color, letterSpacing: "-.01em", whiteSpace: "nowrap",
            ...(accent ? gradText(accent[0], accent[1]) : color === "var(--text)" ? gradText("#475569", "#94A3B8") : {}) }}>{value}</span>
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
  const gid = useMemo(() => `rg${Math.random().toString(36).slice(2, 8)}`, []);
  // l'arc et le chiffre en degrade, de la couleur de l'anneau vers sa teinte claire
  const light = `color-mix(in srgb, ${color} 55%, #ffffff)`;
  const prim = x => typeof x === "string" || typeof x === "number";
  const txt = prim(children) || (Array.isArray(children) && children.every(prim));
  return (
    <span data-pk="" style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-flex" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={color}/><stop offset="1" style={{ stopColor: light }}/></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface2)" strokeWidth={sw}/>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${gid})`} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - v)} style={{ transition: "stroke-dashoffset .6s", filter: `drop-shadow(0 0 ${Math.round(sw / 2)}px ${color}55)` }}/>
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
        fontSize: size * (String(children ?? "").length > 4 ? 0.17 : String(children ?? "").length > 3 ? 0.2 : 0.24),
        fontWeight: 900, color: "var(--text)", lineHeight: 1.05, flexDirection: "column" }}>
        {txt ? <span style={gradText(`color-mix(in srgb, ${color} 72%, #000000)`, color)}>{children}</span> : children}
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
// un thermometre en verre, rempli de liquide (comme les gouttes de l'humidite) : le tube monte avec la
// temperature, du froid a la chaleur, la consigne en repere ; le chiffre en degrade et le nom dessous
const THERMO = "M13 54.25 V11 A7 7 0 0 1 27 11 V54.25 A12 12 0 1 1 13 54.25 Z";
function ThermoGauge({ v, t, max, size = 90, c, label, sub, active = false, targets = true, bare = false }) {
  const id = useMemo(() => `tg${Math.random().toString(36).slice(2, 8)}`, []);
  const f = x => Math.max(0, Math.min(1, (x || 0) / max));
  const top = 56 - 50 * f(v);            // le tube va de y=6 a y=56 ; le bulbe est toujours plein
  const ty = 56 - 50 * f(t);
  const w = Math.round(size * 0.5);
  return (
    <div data-pk="" style={{ display: "flex", flexDirection: "column", alignItems: "center", width: bare ? w : Math.max(w, 46), flexShrink: 0 }}>
      <svg width={w} height={size} viewBox="0 0 40 80" aria-hidden="true" style={{ overflow: "visible",
        filter: active ? `drop-shadow(0 0 7px ${c})` : v > 40 ? `drop-shadow(0 2px 6px ${c}66)` : "none" }}>
        <defs><clipPath id={id}><path d={THERMO}/></clipPath>
          <linearGradient id={`${id}g`} x1="0" y1="1" x2="0" y2="0"><stop offset="0" style={{ stopColor: `color-mix(in srgb, ${c} 62%, ${heat(20)})` }}/><stop offset="1" stopColor={c}/></linearGradient></defs>
        <path d={THERMO} fill="var(--surface2)"/>
        <g clipPath={`url(#${id})`}>
          <path d={`M-40 ${top} q5 -2.5 10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 V82 H-40 Z`} fill={`url(#${id}g)`}
            style={{ animation: "bn-wave 2.6s linear infinite" }}/>
          <rect x="15.5" y="9" width="3" height="40" rx="1.5" fill="rgba(255,255,255,0.35)"/>
        </g>
        <path d={THERMO} fill="none" stroke={c} strokeOpacity="0.6" strokeWidth="1.8"/>
        {/* les graduations, et la consigne en repere */}
        {[0.25, 0.5, 0.75].map(k => <line key={k} x1="27" x2="30" y1={56 - 50 * k} y2={56 - 50 * k} stroke="var(--muted)" strokeOpacity="0.5" strokeWidth="1"/>)}
        {targets && t > 0 && <g><line x1="9" x2="31" y1={ty} y2={ty} stroke="var(--text)" strokeWidth="1.6" strokeLinecap="round"/>
          <path d={`M31 ${ty} l5 -3.5 v7 Z`} fill="var(--text)"/></g>}
      </svg>
      {!bare && <span style={{ fontSize: size > 160 ? 30 : size > 110 ? 20 : 15, fontWeight: 900, lineHeight: 1.1, marginTop: 2, whiteSpace: "nowrap",
        ...gradText(`color-mix(in srgb, ${c} 72%, #000000)`, c) }}>{label}</span>}
      {!bare && sub && <span style={{ fontSize: size > 110 ? 12 : 10.5, color: active ? c : "var(--muted)", fontWeight: 800, whiteSpace: "nowrap" }}>{sub}</span>}
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
              <span style={{ width: 14, height: 14, borderRadius: 5, ...trayBg(t), border: "1px solid rgba(0,0,0,0.2)" }}/>{t.filament_type}</span>)}</div>}
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
// goal : un rythme a tenir par barre (ligne en pointilles) ; au-dessus, la couleur pleine, en dessous, gris
function Bars({ values, labels, color, height = 40, hi = -1, showValues = false, fmt = v => v, titles, onPick, picked = -1, goal = null, goalLabel = null }) {
  const max = Math.max(1, ...values, goal || 0);
  const gap = values.length > 20 ? 2 : 4;
  const base = labels ? 15 : 0;
  const tint = (v, i) => goal ? (v >= goal ? (i === hi ? color : `${color}cc`) : (i === hi ? "#94a3b8" : "#94a3b866"))
    : i === hi || i === picked ? color : `${color}59`;
  return (
    <div style={{ display: "flex", gap, alignItems: "flex-end", height: height + base + (showValues ? 14 : 0), position: "relative" }}>
      {goal > 0 && <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: base + Math.round(height * goal / max),
        borderTop: "1.5px dashed var(--muted)", pointerEvents: "none", zIndex: 1 }}>
        {goalLabel && <span style={{ position: "absolute", left: 0, bottom: 3, fontSize: 9.5, fontWeight: 800, color: "var(--text)",
          background: "var(--surface)", border: "1px solid var(--border)", padding: "0 5px", borderRadius: 6, whiteSpace: "nowrap" }}>{goalLabel}</span>}</span>}
      {values.map((v, i) => (
        <div key={i} title={titles?.[i]} onClick={onPick ? e => { e.stopPropagation(); onPick(i); } : undefined}
          style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: onPick ? "pointer" : undefined }}>
          {showValues && <span style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 700, whiteSpace: "nowrap" }}>{v ? fmt(v) : ""}</span>}
          <span data-pk="" style={{ width: "100%", maxWidth: 30, borderRadius: values.length > 20 ? 3 : 5, minHeight: 3,
            height: `${Math.max(3, Math.round(height * v / max))}px`, background: tint(v, i),
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
function SpoolDot({ color, colors = null, multicolor = null, finish = null, pct, size = 34, title }) {
  const sw = Math.max(3, Math.round(size / 9));
  const r = size / 2 - sw / 2 - 1, C = 2 * Math.PI * r, v = Math.max(0, Math.min(1, pct ?? 1));
  return (
    <span data-pk="" title={title} style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-flex" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface2)" strokeWidth={sw}/>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={v < 0.15 ? "#ef4444" : v < 0.35 ? "#f59e0b" : "#22c55e"}
          strokeWidth={sw} strokeDasharray={C} strokeDashoffset={C * (1 - v)}/>
      </svg>
      <span style={{ position: "absolute", inset: sw + 3, borderRadius: "50%", border: "1px solid rgba(0,0,0,0.15)", overflow: "hidden",
        ...colorBg(parseColorsList(color, colors), multicolor, finish) }}/>
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
// Les donnees dont chaque tuile se sert (27/10/2026) : l'accueil ne demande plus que celles des tuiles posees ET
// proches de l'ecran (avant : toutes, pour toutes les tuiles possibles, d'un coup, meme absentes de l'accueil).
export const TILE_NEEDS = {
  today: ["today", "prints", "live"], next: ["queue"], last: ["prints", "live"], stock: ["spools"], dry: ["dry"],
  friends: ["friends"], mw: ["mw"], rate: ["rate"], wheel: ["ach"], ach: ["ach"], month: ["month"], sales: ["sales"],
  feed: ["feed"], gallery: ["prints"], family: ["family"], podium: ["podium", "ach"], alerts: ["attention"],
};
// lues une fois (pas relues toutes les 2 min avec le reste)
const ONCE = new Set(["mw", "podium", "family"]);

export function useTilesData(status = null, want = null) {
  const [d, setD] = useState({});
  const loadRef = useRef(null);
  const fetchRef = useRef(null);
  const wantRef = useRef(want);
  wantRef.current = want;
  // un evenement franc de l'imprimante (lancement, preparation, pause, fin, echec, nouveau travail) :
  // tout est relu tout de suite, puis 15 s apres (la fin d'une impression se confirme en 10 s cote serveur)
  const phase = `${String(status?.status || "").toUpperCase()}|${status?.job_id || ""}`;
  const lastPhase = useRef(null);
  useEffect(() => {
    if (!status?.status) return undefined;
    const before = lastPhase.current;
    lastPhase.current = phase;
    if (before == null || before === phase || !loadRef.current) return undefined;
    const a = setTimeout(() => loadRef.current?.(), 2000), b = setTimeout(() => loadRef.current?.(), 15000);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let dead = false;
    const asked = new Set();
    const put = (k, p) => p.then(r => { if (!dead) setD(x => ({ ...x, [k]: r })); }).catch(() => { if (!dead) setD(x => ({ ...x, [k]: null })); });
    const get = (url, params) => client.get(url, { params }).then(r => r.data);
    const F = {
      today: () => {
        const now = new Date(), t = ymd(now), y = new Date(now); y.setDate(now.getDate() - 1);
        put("today", Promise.all([get("/prints/kpis", { date_from: t }), get("/prints/kpis", { date_from: t, status: "SUCCESS" }),
          get("/prints/kpis", { date_from: ymd(y), date_to: ymd(y) })])
          .then(([all, ok, yd]) => ({ ...all, ok: ok.count, yesterday: yd })));
      },
      prints: () => put("prints", get("/prints", { limit: 16 }).then(r => (r.prints || r.items || []).filter(p => p.status !== "IN_PROGRESS"))),
      // l'impression en cours, avec son vrai nom (celui de l'imprimante est souvent le nom du profil)
      live: () => put("live", get("/prints", { status: "IN_PROGRESS", limit: 1 }).then(r => (r.prints || r.items || [])[0] || null)),
      spools: () => put("spools", get("/filaments/spools", { archived: false })),
      dry: () => put("dry", get("/filaments/drying/overview")),
      friends: () => put("friends", get("/friends/shared/printing")),
      ach: () => put("ach", get("/achievements")),
      month: () => {
        const now = new Date();
        const m0 = new Date(now.getFullYear(), now.getMonth(), 1), p0 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const pEnd = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), 28));
        put("month", Promise.all([get("/prints/kpis", { date_from: ymd(m0) }), get("/prints/kpis", { date_from: ymd(p0), date_to: ymd(pEnd) })])
          .then(([cur, prev]) => ({ ...cur, prev })));
      },
      sales: () => put("sales", get("/objects/objects/stats")),
      feed: () => put("feed", get("/notify/me/history")),
      attention: () => put("attention", get("/attention")),
      // a evaluer : relu avec le reste (une impression qui vient de finir y entre sans recharger la page)
      rate: () => put("rate", get("/makerworld/to-rate")),
      // « À faire » aussi : ce qui imprime, ce qui vient de finir, ce qui devient faisable bougent sans cesse
      queue: () => put("queue", get("/makerworld/queue")),
      mw: () => put("mw", get("/makerworld/creator")),
      podium: () => put("podium", get("/achievements/podium")),
      family: () => put("family", get("/achievements/family-board")),
    };
    // ce que les tuiles demandent (sans liste : tout, comme avant)
    const wanted = () => (wantRef.current ? [...wantRef.current] : Object.keys(F));
    // les nouvelles venues seulement (une tuile qui arrive pres de l'ecran)
    fetchRef.current = () => wanted().filter(k => F[k] && !asked.has(k)).forEach(k => { asked.add(k); F[k](); });
    // relire : ce qui est demande, sauf les « une fois »
    const load = () => wanted().filter(k => F[k] && !ONCE.has(k)).forEach(k => { asked.add(k); F[k](); });
    fetchRef.current();
    loadRef.current = load;
    const iv = setInterval(load, 120000);
    const again = () => load();
    window.addEventListener("bn-tiles-reload", again);
    return () => { dead = true; clearInterval(iv); loadRef.current = null; fetchRef.current = null; window.removeEventListener("bn-tiles-reload", again); };
  }, []);
  // une tuile s'approche de l'ecran : ses donnees, si elles n'ont pas encore ete demandees
  const wantKey = want ? [...want].sort().join(",") : "*";
  useEffect(() => { fetchRef.current?.(); }, [wantKey]);
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
const SCROLL = def => B("scroll", "Défiler dans la tuile", def, { hint: "Toute la liste dans la tuile, qu'on fait défiler à la molette. Sur un écran tactile, la tuile montre ce qui tient (sinon elle capterait le doigt au lieu de la page)." });
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
    accent={rate == null ? ["#3B82F6", "#06B6D4"] : rate >= 0.9 ? ["#16A34A", "#06B6D4"] : rate >= 0.7 ? ["#D97706", "#F59E0B"] : ["#DC2626", "#F97316"]}
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
  // demi-colonne basse : l'anneau en petit, des phrases courtes sur une ligne (sinon le texte, serre a cote
  // de l'anneau, s'etalait sur six lignes et debordait de la tuile)
  const compact = narrow && H < 150;
  const one = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 };
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
  if (compact) {
    const cs = Math.max(34, Math.min(48, H - 50));
    return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {live ? <Ring value={pct / 100} size={cs} color="#3B82F6">{pct}%</Ring>
          : <span aria-hidden="true" style={{ width: cs, height: cs, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(59,130,246,0.14)", color: "#3B82F6" }}><CalendarClock size={Math.round(cs * 0.45)}/></span>}
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", ...one }}>{live ? "1ʳᵉ du jour" : "Rien encore"}</span>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: live ? "#3B82F6" : "var(--muted)", ...one }}>
            {live ? (left ? `fin à ${finAt(left)}` : "bientôt finie") : "l'imprimante se repose"}</span></span>
      </div>
      {live && liveName(lp, st) && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", ...one }}>{liveName(lp, st)}</span>}
      {H >= 110 && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", ...one }}>{y?.count ? `Hier : ${y.count} · ${fmtH(y.duration)}` : "Hier : rien"}</span>}
    </div>;
  }
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
            <span data-pk="" style={{ fontSize: H >= 200 ? 30 : 24, fontWeight: 900, color: "var(--text)", lineHeight: 1.05, ...gradText("#7C3AED", "#C084FC") }}>{v ? fmt(tot) : "…"}</span>
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
// les filaments d'un modele : une pastille par couleur, cerclee selon ce qu'on a (vert AMS, orange stock, rouge rien)
const FilaDots = ({ list, size = 14 }) => <span style={{ display: "inline-flex", gap: 3, flexWrap: "wrap", flexShrink: 0 }}>
  {(list || []).map((f, i) => <span key={i} data-tip={`${f.type} ${Math.round(f.g)} g → ${f.chosen ? f.chosen.name + (f.chosen.in_ams ? " (AMS)" : "") : "rien en stock"}`}
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
// ── Les deux tuiles en liste (24/10/2026) : « À faire » et « Dernières impressions » ──
// En tete, la carte « heros » (ce qui tourne, sinon le premier) ; dessous, des rangees fines, un liseré
// de couleur a gauche pour l'etat, une colonne a droite (duree, poids) quand la largeur le permet.
// Selon la place : basse, le heros seul ; etroite et haute, le heros en vignette pleine largeur ;
// haute, autant de rangees que la tuile en tient. Toucher une rangee ouvre sa fiche, le reste de la
// tuile ouvre la fenetre.
const ROW_H = 38;
const Thumb = ({ img, size, radius, color = "#64748B", children }) => <span style={{ position: "relative", flexShrink: 0, width: size, height: size }}>
  {img ? <img data-pk="" src={img} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = "hidden"; }}
    style={{ width: size, height: size, borderRadius: radius ?? Math.round(size / 4), objectFit: "cover", background: "var(--surface2)", display: "block" }}/>
    : <span data-pk="" style={{ width: size, height: size, borderRadius: radius ?? Math.round(size / 4), display: "block",
      background: `linear-gradient(135deg, ${color}33, ${color}12)` }}/>}
  {children}</span>;
// la barre d'avancement d'une impression en cours
const Progress = ({ pct, color = "#3b82f6", h = 6 }) => <span style={{ display: "block", height: h, borderRadius: h, background: "var(--surface2)", overflow: "hidden", flexShrink: 0 }}>
  <span data-pk="" style={{ display: "block", height: "100%", width: `${Math.max(2, Math.min(100, pct || 0))}%`, borderRadius: h,
    background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 55%, #ffffff))`, transition: "width .6s" }}/></span>;
// une petite etiquette d'etat
const Pill = ({ c, solid, children }) => <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 900,
  padding: "1px 7px", borderRadius: 9, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", boxSizing: "border-box", color: solid ? "#fff" : c, background: solid ? c : `color-mix(in srgb, ${c} 14%, transparent)` }}>{children}</span>;
// la colonne de droite : une valeur forte, une plus petite dessous
const RightCol = ({ a, b }) => <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, gap: 1, paddingLeft: 4 }}>
  {a && <span data-pk="" style={{ fontSize: 12, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" }}>{a}</span>}
  {b && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>{b}</span>}</span>;
// une rangee : le liseré d'etat, la vignette (et ce qu'on y pose), le titre, une ligne dessous, la colonne de droite
function ListRow({ edge, img, thumb = true, badge, title, sub, right, h = ROW_H, onOpen, tip }) {
  const t = h - 8;
  return <div data-tip={tip} onClick={onOpen ? e => { e.stopPropagation(); onOpen(); } : undefined}
    style={{ display: "flex", alignItems: "center", gap: 8, height: h, minWidth: 0, flexShrink: 0, borderRadius: 11, padding: "0 8px 0 4px", position: "relative",
      cursor: onOpen ? "pointer" : undefined, overflow: "hidden", background: "color-mix(in srgb, var(--surface2) 55%, transparent)" }}>
    <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 3, borderRadius: 3, background: edge }}/>
    {thumb ? <span style={{ marginLeft: 4 }}><Thumb img={img} size={t} color={edge}>{badge}</Thumb></span> : <span style={{ width: 2 }}/>}
    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.25 }}><W text={title}/></span>
      {sub && <span className="bn-rowsub" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        display: "block", minWidth: 0, lineHeight: "14px" }}>{sub}</span>}
    </span>
    {right}
  </div>;
}
// la ligne des comptes, au-dessus de la liste (« À faire » et « Dernières impressions », meme dessin) :
// le total, puis chaque etat present, avec son mot quand la largeur le permet
function ListCounts({ W, n, label, items }) {
  const nar = W < 400;
  return <div style={{ display: "flex", gap: nar ? 8 : 10, alignItems: "center", height: 16, flexShrink: 0, overflow: "hidden", whiteSpace: "nowrap", fontSize: 11, fontWeight: 800 }}>
    <span style={{ color: "var(--text)" }}><b data-pk="" style={{ fontSize: 12.5, fontWeight: 900 }}>{n}</b>{nar ? "" : ` ${label}`}</span>
    {items.filter(x => x[0]).map(([k, c, ic, l]) => <span key={l} data-tip={`${k} ${l}`} style={{ color: c }}>{ic} {k}{nar ? "" : ` ${l}`}</span>)}</div>;
}
// le heros : la vignette en grand (a gauche, ou en haut si la tuile est etroite et haute), le titre,
// l'etat, et l'avancement s'il imprime
function ListHero({ img, color, title, chips, meta, pct, foot, h, stacked, onOpen, badge }) {
  // ce qui tient dans la hauteur : titre (1 ou 2 lignes), etiquettes, barre, ligne d'infos, plateaux
  const room = stacked ? 99 : h - 12;
  const two = stacked || room >= 92, showMeta = !!meta && room >= (pct != null ? 66 : 54), showFoot = !!foot && room >= 92;
  const body = <>
    <span style={{ fontSize: stacked || h >= 70 ? 13.5 : 12.5, fontWeight: 900, color: "var(--text)", lineHeight: 1.25, ...(two ? clamp(2)
      : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }) }}><W text={title}/></span>
    {chips && <span style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", minWidth: 0, maxHeight: 18, overflow: "hidden" }}>{chips}</span>}
    {pct != null && <Progress pct={pct} color={color}/>}
    {showMeta && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</span>}
    {showFoot && foot}
  </>;
  const frame = { borderRadius: 14, minWidth: 0, flexShrink: 0, cursor: onOpen ? "pointer" : undefined, position: "relative", overflow: "hidden", height: h,
    boxSizing: "border-box", background: `linear-gradient(135deg, color-mix(in srgb, ${color} 16%, transparent), transparent 70%), var(--surface2)`,
    border: `1px solid color-mix(in srgb, ${color} 30%, transparent)` };
  const open = onOpen ? e => { e.stopPropagation(); onOpen(); } : undefined;
  if (stacked) {
    // le texte d'abord (titre sur 2 lignes, etiquettes, barre, ligne d'infos, marges), l'image prend le reste
    const ih = Math.max(48, h - 96 - (pct != null ? 10 : 0) - (showFoot ? 18 : 0));
    return <div onClick={open} style={{ ...frame, display: "flex", flexDirection: "column" }}>
      <span style={{ position: "relative", height: ih, flexShrink: 0, display: "block" }}>
        {img ? <img data-pk="" src={img} alt="" onError={e => { e.currentTarget.style.visibility = "hidden"; }}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
          : <span style={{ display: "block", height: "100%", background: `linear-gradient(135deg, ${color}40, ${color}10)` }}/>}
        {badge && <span style={{ position: "absolute", inset: 8 }}>{badge}</span>}</span>
      <span style={{ padding: "6px 8px 7px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1, justifyContent: "center" }}>{body}</span>
    </div>;
  }
  const ts = Math.max(30, Math.min(h - 12, 96));
  return <div onClick={open} style={{ ...frame, display: "flex", alignItems: "center", gap: 10, padding: 6 }}>
    <Thumb img={img} size={ts} radius={11} color={color}>{badge}</Thumb>
    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: h >= 74 ? 4 : 3, justifyContent: "center", overflow: "hidden", maxHeight: "100%" }}>{body}</span>
  </div>;
}
// la place : la hauteur du heros, s'il est en vignette pleine largeur, combien de rangees tiennent dessous
// fit(rh, place) -> [rangees, hauteur prise] : par defaut des rangees de rh espacees de 6 (les dernieres
// impressions y ajoutent leurs intercalaires de jour). On cherche le plus de rangees : d'abord en hauteur
// normale (38) avec un heros qui se tasse, puis en rangees fines (34) ; la place qui reste va au heros.
const fitRowsOf = (rh, b, n) => { const k = b < rh ? 0 : Math.min(n, Math.floor((b + 6) / (rh + 6))); return [k, k ? k * (rh + 6) - 6 : 0]; };
function listPlan(W, H, n, fit = null) {
  const narrow = W < 215;
  if (n <= 1 || H < 100) return { heroH: Math.min(H, n <= 1 ? 120 : H), stacked: narrow && n <= 1 && H >= 150, rows: 0, rh: ROW_H };
  const stacked = narrow && H >= 230;
  const f = fit || ((rh, b) => fitRowsOf(rh, b, n - 1));
  const heros = stacked ? [Math.min(176, Math.round(H * 0.5)), 140, 120] : H >= 200 ? [78, 70, 64, 58] : [62, 56, 50];
  let best = null;
  for (const rh of [ROW_H, 34]) for (const hh of heros) {
    const [rows, used] = f(rh, H - hh - 6);
    if (!best || rows > best.rows) best = { heroH: hh, rows, rh, used };
  }
  // la place qui reste revient au heros (sans en faire une affiche)
  const heroH = best.rows ? Math.min(stacked ? 200 : 104, Math.max(best.heroH, H - 6 - best.used)) : Math.min(H, 120);
  return { heroH, stacked, rows: best.rows, rh: best.rh };
}

// « À faire » : l'etat de chaque modele, d'apres la page « À faire »
const Q_EDGE = { ams: "#22c55e", partial: "#86efac", stock: "#f59e0b", short: "#ef4444" };
const qEdge = m => m.printing ? "#3b82f6" : Q_EDGE[m.status] || "#94a3b8";
// les plateaux retenus en petits carres : fait, en cours, faisable maintenant, a faire
function PlateDots({ plates, size = 15 }) {
  if (!(plates?.length > 1)) return null;
  const r = plateRound(plates.map(p => p.printed));
  return <span style={{ display: "flex", alignItems: "center", gap: 3, minWidth: 0, overflow: "hidden", flexShrink: 0 }}>
    {plates.map(p => { const done = plateDoneInRound(p.printed, r);
      return <span key={p.index} data-pk="" data-tip={`Plateau ${p.index}${p.printing ? " : en cours" : done ? " : fait" : p.ready ? " : faisable maintenant" : ""}`}
        style={{ minWidth: size, height: size, padding: "0 2px", borderRadius: 4, fontSize: size * 0.62, fontWeight: 900, display: "inline-flex", alignItems: "center",
          justifyContent: "center", boxSizing: "border-box", flexShrink: 0,
          color: p.printing || (p.ready && !done) ? "#fff" : done ? "#16a34a" : "var(--muted)",
          background: p.printing ? "#3b82f6" : done ? "rgba(34,197,94,0.16)" : p.ready ? "#22c55e" : "var(--surface)",
          border: `1px solid ${p.printing ? "#3b82f6" : done || p.ready ? "#22c55e" : "var(--border)"}` }}>{p.printing ? "⏳" : done ? "✓" : p.index}</span>; })}
  </span>;
}
const plateShort = m => { const r = m.plates?.length > 1 ? plateRound(m.plates.map(p => p.printed)) : null;
  return r && (r.faits || r.serie > 1) ? r.label.replace(" faits", "") : null; };
function Next({ q, o, sz }) {
  const [sheet, setSheet] = useState(null);
  const all = q?.models || [];
  const models = all.filter(m => !o.ready || canGo(m));
  const t = q?.totals || {};
  const ready = t.ams ?? all.filter(m => m.status === "ams").length;
  const part = t.partial ?? all.filter(m => m.status === "partial").length;
  const stock = t.stock ?? all.filter(m => m.status === "stock").length;
  const short = t.short ?? all.filter(m => m.status === "short").length;
  const busy = all.filter(m => m.printing).length;
  const open = m => setSheet({ design_id: m.design_id, title: m.title, title_fr: m.title_fr, cover_url: m.cover_url });
  // en tete : ce qui tourne, sinon le premier imprimable, sinon le premier
  const hero = models.find(m => m.printing) || models.find(canGo) || models[0];
  const rest = models.filter(m => m !== hero);
  const name = m => m.title_fr || m.title || `Modèle ${m.design_id}`;
  const chips = m => { const [l, c, ic] = qState(m);
    return <>{m.printing ? <Pill c="#3b82f6" solid>🖨️ en cours</Pill> : <Pill c={c === "var(--muted)" ? "#94a3b8" : c}>{ic} {l}</Pill>}
      {m.planned && <Pill c="#16a34a">📌 retenu</Pill>}{(m.qty || 1) > 1 && <Pill c="#64748B">×{m.qty}</Pill>}</>; };
  const meta = m => m.printing ? [m.progress != null && `${m.progress} %`, plateShort(m) && `plateaux ${plateShort(m)}`].filter(Boolean).join(" · ")
    : [m.ready_now?.plates > 0 && m.status === "partial" && `▶ ${m.ready_now.plates} plateau${m.ready_now.plates > 1 ? "x" : ""} prêt${m.ready_now.plates > 1 ? "s" : ""}`,
      m.seconds && fmtDur(m.seconds), o.weight && m.weight_g && fmtG(m.weight_g)].filter(Boolean).join(" · ");
  const row = (m, W, rh = ROW_H) => { const wide = W >= 250, ps = plateShort(m);
    return <ListRow key={m.design_id} h={rh} edge={qEdge(m)} thumb={o.thumbs} img={m.cover_url ? mwImg(m.cover_url, 120) : null} title={name(m)} onOpen={() => open(m)}
      tip={`${name(m)}\n${m.printing ? "en cours" : qState(m)[0]}${ps ? ` · plateaux ${ps}` : ""}`}
      badge={(m.qty || 1) > 1 ? <span style={{ position: "absolute", right: -3, bottom: -3, fontSize: 9, fontWeight: 900, color: "#fff", background: "#334155",
        borderRadius: 6, padding: "0 4px", lineHeight: "13px", border: "1.5px solid var(--surface)" }}>×{m.qty}</span> : null}
      sub={<><FilaDots list={m.filaments} size={9}/>{ps && <span style={{ color: "var(--text2)" }}>{ps}</span>}
        {!wide && m.seconds ? <span>{fmtDur(m.seconds)}</span> : null}</>}
      right={wide ? <RightCol a={m.seconds ? fmtDur(m.seconds) : null} b={o.weight && m.weight_g ? fmtG(m.weight_g) : null}/> : null}/>; };
  // la ligne des comptes, au-dessus de la liste
  const counts = W => <ListCounts W={W} n={all.length} label="à faire" items={[[busy, "#3b82f6", "🖨️", "en cours"],
    [ready, "#16a34a", "●", ready > 1 ? "prêts" : "prêt"], [part, "#22c55e", "◐", "en partie"], [stock, "#d97706", "○", "à charger"], [short, "#dc2626", "✕", "manque"]]}/>;
  return (
    <Tile icon={<ListChecks size={15}/>} color="#22C55E" label="À faire" to="/prints?tab=queue"
      mini={sz.h === 0.5} summary={q ? <>{ready + part}<span style={{ fontSize: 12, color: "var(--muted)" }}>/ {all.length} prêts</span></> : "…"}
      badge={all.length ? <span data-tip="prêts avec l'AMS / dans la liste" style={{ fontSize: 11, fontWeight: 800, color: ready + part ? "#16a34a" : "var(--muted)" }}>
        {ready + part}/{all.length}</span> : null}
      zoom={models.length ? <>
        <Stats items={[["Modèles", all.length], ["Prêts (AMS)", ready, "#16a34a"], part ? ["En partie", part, "#16a34a"] : null,
          stock ? ["À charger", stock, "#d97706"] : null, short ? ["Manque", short, "#dc2626"] : null,
          ["Durée", fmtH(t.seconds ?? all.reduce((a, m) => a + (m.seconds || 0), 0))], ["Poids", fmtG(t.weight_g ?? all.reduce((a, m) => a + (m.weight_g || 0), 0))],
          t.cost ? ["Coût", fmtEur(t.cost)] : null]}/>
        <NextSorted models={models} card={m => <NextCard key={m.design_id} m={m} onOpen={() => open(m)}/>}/>
      </> : null}>
      {({ W, H }) => {
        if (!models.length) return <Empty>{q === undefined ? "…" : o.ready ? "Rien de prêt dans l'AMS" : "Rien dans « À faire »"}</Empty>;
        const head = H >= 150 ? 22 : 0;
        const pl = o.scroll ? { heroH: Math.min(78, Math.max(56, H * 0.35)), stacked: false, rows: rest.length, rh: ROW_H } : listPlan(W, H - head, models.length);
        const foot = !pl.stacked && W >= 215 && hero.plates?.length > 1 ? <PlateDots plates={hero.plates}/> : null;
        return <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {head > 0 && counts(W)}
          <ListHero img={hero.cover_url ? mwImg(hero.cover_url, 320) : null} color={qEdge(hero)} title={name(hero)} h={pl.heroH} stacked={pl.stacked}
            chips={chips(hero)} pct={hero.printing ? hero.progress ?? 0 : null} meta={meta(hero)} foot={foot} onOpen={() => open(hero)}/>
          {pl.rows > 0 && (o.scroll ? <Scroller>{rest.map(m => row(m, W))}</Scroller> : rest.slice(0, pl.rows).map(m => row(m, W, pl.rh)))}
          {/* la fiche s'ouvre par-dessus ; ses clics et ses touches ne remontent pas jusqu'a la tuile */}
          {sheet && <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <MakerWorldModelSheet designId={sheet.design_id} preview={sheet} onClose={() => setSheet(null)}/></span>}
        </div>;
      }}
    </Tile>
  );
}
// dans la fenetre : une carte par modele, tout ce que la page dit de lui
function NextCard({ m, onOpen }) {
  const [l, c, ic] = qState(m), col = qEdge(m);
  return <div onClick={e => { e.stopPropagation(); onOpen(); }} style={{ display: "flex", gap: 12, padding: 10, borderRadius: 16, cursor: "pointer", minWidth: 0, position: "relative",
    overflow: "hidden", background: `linear-gradient(135deg, color-mix(in srgb, ${col} 14%, transparent), transparent 60%), var(--surface2)`,
    border: `1px solid color-mix(in srgb, ${col} 35%, transparent)` }}>
    <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: 3, borderRadius: 3, background: col }}/>
    <Thumb img={m.cover_url ? mwImg(m.cover_url, 240) : null} size={76} radius={12} color={col}/>
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ fontSize: 13.5, fontWeight: 900, color: "var(--text)", ...clamp(2) }}>{m.title_fr || m.title || `Modèle ${m.design_id}`}</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {m.printing ? <Pill c="#3b82f6" solid>🖨️ en cours{m.progress != null ? ` · ${m.progress} %` : ""}</Pill> : <Pill c={c === "var(--muted)" ? "#94a3b8" : c}>{ic} {l}</Pill>}
        {m.planned && <Pill c="#16a34a">📌 retenu</Pill>}
        {(m.qty || 1) > 1 && <Pill c="#64748B">×{m.qty}</Pill>}
        {m.printed > 0 && <Pill c="#94a3b8">déjà imprimé {m.printed}×</Pill>}
      </div>
      {m.printing && <Progress pct={m.progress ?? 0}/>}
      <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {[m.profile?.title, m.seconds && fmtDur(m.seconds), m.weight_g && fmtG(m.weight_g), m.cost != null && fmtEur(m.cost)].filter(Boolean).join(" · ")}</div>
      {m.plates?.length > 1 && <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap" }}>Plateaux {plateRound(m.plates.map(p => p.printed))?.label}</span>
        <PlateDots plates={m.plates} size={16}/></div>}
      {m.ready_now?.plates > 0 && !m.printing && m.status === "partial" && <div style={{ fontSize: 11.5, fontWeight: 800, color: "#16a34a" }}>
        ▶ faisable maintenant : {m.ready_now.plates} plateau{m.ready_now.plates > 1 ? "x" : ""}
        {m.ready_now.seconds ? ` · ${fmtDur(m.ready_now.seconds)}` : ""}{m.ready_now.weight_g ? ` · ${fmtG(m.ready_now.weight_g)}` : ""}</div>}
      <FilaDots list={m.filaments}/>
    </div>
    <ChevronRight size={16} style={{ color: "var(--muted)", alignSelf: "center", flexShrink: 0 }}/>
  </div>;
}
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
// le jour d'une impression : « Aujourd'hui », « Hier », le jour de la semaine, puis la date
const dayKey = d => d ? ymd(d) : "";
const printDay = d => { if (!d) return "Plus tôt";
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()), n0 = new Date(), b = new Date(n0.getFullYear(), n0.getMonth(), n0.getDate());
  const n = Math.round((b - a) / 86400000);
  const s = n <= 0 ? "Aujourd'hui" : n === 1 ? "Hier" : n < 7 ? d.toLocaleDateString("fr-FR", { weekday: "long" }) : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1); };
const dayHm = d => { const t = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), l = printDay(d);
  return l === "Aujourd'hui" ? t : `${l.toLowerCase().replace(/^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)$/, m => m.slice(0, 3) + ".")} ${t}`; };
const DayHead = ({ children }) => <div style={{ display: "flex", alignItems: "center", gap: 6, height: 14, flexShrink: 0, fontSize: 10, fontWeight: 900,
  letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{children}<span style={{ flex: 1, height: 1, background: "var(--border)" }}/></div>;
const lastEdge = x => x.live ? "#3b82f6" : x.partial ? "#f59e0b" : okOf(x) ? "#22c55e" : "#ef4444";
const lastState = x => x.live ? ["en cours", "#3b82f6", "🖨️"] : x.partial ? ["en partie", "#f59e0b", "◐"] : okOf(x) ? ["réussie", "#16a34a", "✓"] : ["échouée", "#dc2626", "✕"];
function Last({ p, o, sz, st, lp }) {
  const [open, setOpen] = useState(null);
  const live = isLive(st) && lp ? { ...lp, live: true } : null;
  const list = [...(live ? [live] : []), ...groupCards(p)];
  if (!list.length) return null;
  // la fiche s'ouvre sur place, par-dessus (celle du groupe pour un groupe), comme « À faire »
  const fiche = x => setOpen(x.members ? { group: x } : { print: x });
  const name = x => x.file_name || x.translated_name || `Impression #${x.id}`;
  const when = x => x.print_date ? utc(x.print_date) : null;
  const hm = d => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  // sur la vignette : la pastille d'etat, « ×5 » pour un groupe, l'appareil photo s'il manque la photo
  const marks = (x, big) => <>
    <span style={{ position: "absolute", right: -3, bottom: -3, width: big ? 14 : 11, height: big ? 14 : 11, borderRadius: "50%", background: lastEdge(x),
      border: "2px solid var(--surface)", boxSizing: "border-box" }}/>
    {x.members && <span style={{ position: "absolute", left: -3, top: -3, fontSize: 9, fontWeight: 900, color: "#fff", background: "#0EA5E9", borderRadius: 6,
      padding: "0 4px", lineHeight: "13px", border: "1.5px solid var(--surface)" }}>×{x.members.length}</span>}
    {o.photo && !x.live && !hasPhoto(x) && <span data-tip="Pas encore de photo" style={{ position: "absolute", right: -3, top: -3, width: 15, height: 15, borderRadius: "50%",
      background: "var(--surface)", color: "#0EA5E9", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 1px var(--border)" }}><Camera size={9}/></span>}
  </>;
  const row = (x, W, days, rh = ROW_H) => { const wide = W >= 250, d = when(x), [l, c] = lastState(x);
    return <ListRow key={`${x.id}${x.live ? "l" : ""}`} h={rh} edge={lastEdge(x)} img={printImg(x.id)} title={name(x)} onOpen={() => fiche(x)} badge={marks(x)}
      tip={`${name(x)}\n${l}${x.members ? ` · ${x.members.length} impressions` : ""}${d ? ` · ${d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : ""}`}
      sub={<><span style={{ color: c }}>{l}</span>{d && (o.when || days) && <span>{days ? hm(d) : dayHm(d)}</span>}
        {!wide && x.duration_seconds ? <span>{fmtDur(x.duration_seconds)}</span> : null}</>}
      right={wide ? <RightCol a={x.duration_seconds ? fmtDur(x.duration_seconds) : null}
        b={[x.total_weight_g && fmtG(x.total_weight_g), o.cost && x.total_cost && fmtEur(x.total_cost)].filter(Boolean).join(" · ") || null}/> : null}/>; };
  // les rangees, avec le jour en intercalaire quand il change (le heros compte pour le premier jour)
  // combien en tiennent dans H (hauteur rh, intercalaires compris) : [nombre, hauteur prise]
  const fitDays = (items, prev, days) => (rh, H) => { let used = 0, k = 0, last = prev;
    for (const x of items) {
      const d = dayKey(when(x)), need = rh + 6 + (days && d !== last ? 20 : 0);
      if (used + need > H + 6) break;
      used += need; k++; last = d;
    }
    return [k, Math.max(0, used - 6)]; };
  const rows = (items, W, H, prev, days, rh = ROW_H) => { const out = []; let used = 0, last = prev;
    for (const x of items) {
      const k = dayKey(when(x)), sep = days && k !== last;
      const need = rh + 6 + (sep ? 20 : 0);
      if (H != null && used + need > H + 6) break;
      if (sep) out.push(<DayHead key={`d${k}${x.id}`}>{printDay(when(x))}</DayHead>);
      out.push(row(x, W, days, rh)); used += need; last = k;
    }
    return out; };
  const heroOf = (x, h, stacked, W) => { const [l, c, ic] = lastState(x), d = when(x);
    return <ListHero img={printImg(x.id, 512)} color={lastEdge(x)} title={name(x)} h={h} stacked={stacked} onOpen={() => fiche(x)} badge={marks(x, true)}
      chips={<><Pill c={c} solid={x.live}>{ic} {l}{x.live ? ` · ${Math.round(st?.progress || 0)} %` : ""}</Pill>
        {x.members && <Pill c="#0EA5E9">{x.members.length} impressions</Pill>}</>}
      pct={x.live ? st?.progress || 0 : null}
      meta={x.live ? [st?.remaining_minutes ? `fin à ${finAt(st.remaining_minutes)}` : null, st?.total_layers ? `couche ${st.layer}/${st.total_layers}` : null].filter(Boolean).join(" · ")
        : [d && ago(d), x.duration_seconds && fmtDur(x.duration_seconds), W >= 215 && x.total_weight_g && fmtG(x.total_weight_g), o.cost && x.total_cost && fmtEur(x.total_cost)].filter(Boolean).join(" · ")}/>; };
  const done = list.filter(x => !x.live);
  // la ligne des comptes, comme « À faire » : les dernieres, et leur etat
  const nOf = l => done.filter(x => lastState(x)[0] === l).length;
  const counts = W => { const ok = nOf("réussie"), part = nOf("en partie"), ko = nOf("échouée");
    return <ListCounts W={W} n={done.length} label={done.length > 1 ? "dernières" : "dernière"} items={[[live ? 1 : 0, "#3b82f6", "🖨️", "en cours"],
      [ok, "#16a34a", "✓", ok > 1 ? "réussies" : "réussie"], [part, "#d97706", "◐", "en partie"], [ko, "#dc2626", "✕", ko > 1 ? "échouées" : "échouée"]]}/>; };
  return (
    <Tile icon={<History size={15}/>} color="#0EA5E9" label="Dernières impressions" to="/prints"
      mini={sz.h === 0.5} summary={<span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis" }}>
        <span style={{ color: lastEdge(list[0]) }}>● </span>{name(list[0])}</span>}
      badge={<span data-tip="réussies parmi les dernières" style={{ fontSize: 11, fontWeight: 800, color: "#16a34a" }}>✓ {done.filter(okOf).length}/{done.length}</span>}
      zoom={<LastZoom list={list} done={done} heroOf={heroOf} rows={rows}/>}>
      {({ W, H }) => {
        const [hero, ...rest] = list;
        // la ligne des comptes, quand la tuile a la place (comme « À faire »)
        const head = H >= 150 ? 22 : 0, Hb = H - head;
        // les intercalaires de jour seulement s'ils ne coutent aucune rangee (sinon « hier 09:44 » sur chacune)
        const first = dayKey(when(hero));
        const pD = W >= 215 ? listPlan(W, Hb, list.length, fitDays(rest, first, true)) : null;
        const p0 = listPlan(W, Hb, list.length, fitDays(rest, first, false));
        const days = !!pD && pD.rows >= p0.rows && pD.rows > 0;
        const pl = o.scroll ? { heroH: Math.min(78, Math.max(56, Hb * 0.35)), stacked: false, rows: rest.length, rh: ROW_H } : days ? pD : p0;
        return <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {open && <PrintSheets open={open} setOpen={setOpen}/>}
          {head > 0 && counts(W)}
          {heroOf(hero, pl.heroH, pl.stacked, W)}
          {pl.rows > 0 && (o.scroll ? <Scroller>{rows(rest, W, null, first, days)}</Scroller>
            : rows(rest, W, Hb - pl.heroH - 6, first, days, pl.rh))}
        </div>;
      }}
    </Tile>
  );
}
// la fiche d'une impression ou d'un groupe (chargees a la demande : la page Impressions est lourde), montee
// dans la page (pas dans la tuile) ; ses clics ne remontent pas jusqu'a la tuile
const LazyPrintDetail = React.lazy(() => importRetry(() => import("../pages/Prints")).then(m => ({ default: m.PrintDetail })));
const LazyGroupSheet = React.lazy(() => importRetry(() => import("../pages/Prints")).then(m => ({ default: m.GroupBottomSheet })));
function PrintSheets({ open, setOpen }) {
  const close = () => setOpen(null);
  return createPortal(<div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <React.Suspense fallback={null}>
      {open.print && <LazyPrintDetail p={open.print} onClose={close} onDelete={close}/>}
      {open.group && <LazyGroupSheet groupId={open.group.group_id} name={open.group.group_name || open.group.file_name} prints={[]}
        number_of_items={open.group.group_number_of_items || 1} cover_print_id={open.group.group_cover_print_id}
        onClose={close} onSelectPrint={p => setOpen({ print: p })} onDelete={close} onUngroup={close} onUpdated={() => {}}/>}
    </React.Suspense></div>, document.body);
}
// la fenetre : les chiffres, ce qui tourne en grand, puis tout, jour par jour
function LastZoom({ list, done, heroOf, rows }) {
  const { W } = useBox();
  const [hero, ...rest] = list;
  return <>
    <Stats items={[["Réussies", `${done.filter(okOf).length} / ${done.length}`, "#16a34a"], ["Durée", fmtH(done.reduce((t, x) => t + (x.duration_seconds || 0), 0))],
      ["Poids", fmtG(done.reduce((t, x) => t + (x.total_weight_g || 0), 0))], ["Coût", fmtEur(done.reduce((t, x) => t + (x.total_cost || 0), 0))]]}/>
    {heroOf(hero, 96, false, W)}
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{rows(rest, W, null, "", true)}</div>
  </>;
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
// ce qui distingue une bobine d'une autre de meme couleur : la marque, la matiere, le sous-type
const spoolKind = x => { const ft = (x.filament_fila_type || "").trim(), mat = (x.filament_material || "").trim();
  return ft && mat && !ft.toUpperCase().startsWith(mat.toUpperCase()) ? `${mat} ${ft}` : ft || mat || ""; };
const spoolShort = x => { const ft = (x.filament_fila_type || "").trim(), mat = (x.filament_material || "").trim();
  // sous la pastille : le sous-type sans la matiere si elle y est deja (« PLA Matte » -> « Matte »), sinon la matiere
  const rest = mat && ft.toUpperCase().startsWith(mat.toUpperCase()) ? ft.slice(mat.length).trim() : "";
  return rest ? `${mat} ${rest}` : ft || mat || "?"; };
const spoolTip = x => { const pc = spoolPct(x);
  return `${spoolName(x)}\n${[x.filament_manufacturer, spoolKind(x)].filter(Boolean).join(" · ")}\n${fmtG(x.remaining_weight_g)} restants${pc != null ? ` (${Math.round(pc * 100)} %)` : ""}${x.ams_tray ? ` · ${x.location || "dans l'AMS"}` : ""}`; };
const pctColor = pc => pc == null ? "#94a3b8" : pc < 0.15 ? "#ef4444" : pc < 0.35 ? "#f59e0b" : "#22c55e";
function Stock({ s, o, sz }) {
  const list = Array.isArray(s) ? s : [];
  const kg = list.reduce((a, x) => a + (x.remaining_weight_g || 0), 0);
  const low = list.filter(x => x.remaining_weight_g != null)
    .sort((a, b) => o.sort === "pct" ? (spoolPct(a) ?? 1) - (spoolPct(b) ?? 1) : a.remaining_weight_g - b.remaining_weight_g);
  const few = list.filter(x => (x.remaining_weight_g ?? 999) < 200).length;
  // une rangee de liste : la pastille, le nom, « marque · sous-type », le poids et une barre
  const line = (x, h) => { const pc = spoolPct(x), c = pctColor(pc), two = h >= 34;
    return <div key={x.id} data-tip={spoolTip(x)} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, height: h }}>
      <SpoolDot color={x.filament_color} colors={x.filament_colors_array} multicolor={x.filament_multicolor_type} finish={finishOf(x)} pct={pc} size={two ? 28 : 20}/>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><W text={spoolName(x)}/></span>
        {two && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {[x.filament_manufacturer, spoolKind(x)].filter(Boolean).join(" · ")}</span>}</span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
        <span data-pk="" style={{ fontSize: 12.5, fontWeight: 900, color: c, whiteSpace: "nowrap" }}>{fmtG(x.remaining_weight_g)}</span>
        {two && <span style={{ width: 44, height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: `${(pc ?? 0) * 100}%`, background: c }}/></span>}</span>
    </div>; };
  const head = <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
    <span data-pk="" style={{ fontSize: 24, fontWeight: 900, color: "var(--text)", lineHeight: 1.05, ...gradText("#D97706", "#F59E0B") }}>{s === undefined ? "…" : list.length}</span>
    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>bobines{o.kg ? ` · ${fmtG(kg)}` : ""}</span>
    {few > 0 && <FewChip n={few}/>}</div>;
  return (
    <Tile icon={<Package size={15}/>} color="#F59E0B" label="Stock" to="/filaments"
      mini={sz.h === 0.5} summary={<>{list.length}<span style={{ display: "inline-flex", gap: 2 }}>{low.slice(0, 3).map(x => <span key={x.id} data-tip={spoolTip(x)}><SpoolDot color={x.filament_color} colors={x.filament_colors_array} multicolor={x.filament_multicolor_type} finish={finishOf(x)} pct={spoolPct(x)} size={22}/></span>)}</span></>}
      zoom={<StockZoom list={list} kg={kg}/>}>
      {({ W, H }) => {
        const rest = H - 34;
        if (rest < 20) return head;
        if (o.style === "list") {
          const h = rest >= 3 * 40 ? 36 : 22;
          return <>{head}<div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>{low.slice(0, fitRows(rest, h, 5)).map(x => line(x, h))}</div></>;
        }
        // les pastilles grandissent pour remplir la case ; avec la place, le sous-type et le poids dessous
        const lg = fitGrid(low.length, W, rest, { gap: 6, max: 60, extra: 28 });
        const two = lg.size >= 36;
        const lg1 = two ? lg : fitGrid(low.length, W, rest, { gap: 6, max: 60, extra: 15 });
        const labels = lg1.size >= 30;
        let g = labels ? lg1 : fitGrid(low.length, W, rest, { gap: 6, max: 56 });
        if (g.size < 26) { const f = fillGrid(W, rest, 26, 6); g = { cols: f.cols, size: Math.min(f.size, Math.max(20, rest - 2)), n: f.n }; }
        const cell = Math.max(g.size, labels ? 52 : 0);
        return <>{head}<div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, minmax(${g.size}px, ${cell}px))`, gap: 6, alignContent: "center",
          justifyContent: "space-evenly", marginTop: 4 }}>
          {low.slice(0, g.n || low.length).map(x => <span key={x.id} data-tip={spoolTip(x)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 0 }}>
            <SpoolDot color={x.filament_color} colors={x.filament_colors_array} multicolor={x.filament_multicolor_type} finish={finishOf(x)} pct={spoolPct(x)} size={g.size}/>
            {labels && two && <span style={{ fontSize: 9.5, fontWeight: 700, lineHeight: "13px", color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden",
              textOverflow: "ellipsis", maxWidth: "100%" }}>{spoolShort(x)}</span>}
            {labels && <span style={{ fontSize: 10.5, fontWeight: 800, lineHeight: "14px", whiteSpace: "nowrap",
              color: x.remaining_weight_g < 200 ? "#dc2626" : "var(--muted)" }}>{fmtG(x.remaining_weight_g)}</span>}</span>)}</div></>;
      }}
    </Tile>
  );
}
// la fenetre du stock : les chiffres, la repartition par matiere, et chaque bobine avec sa marque, sa matiere,
// son sous-type ; des filtres pour s'y retrouver
function StockZoom({ list, kg }) {
  const [only, setOnly] = useState("low");          // low | all | mat:<x> | brand:<x>
  const [sort, setSort] = useState("g");
  const [more, setMore] = useState(false);
  const worth = list.reduce((t, x) => { const pr = x.price_override || x.filament_price; return t + (pr && x.filament_weight_g ? pr * (x.remaining_weight_g || 0) / x.filament_weight_g : 0); }, 0);
  const inAms = list.filter(x => x.ams_tray).length;
  const lowN = list.filter(x => (x.remaining_weight_g ?? 999) < 200).length;
  const by = Object.values(list.reduce((m, x) => { const k = x.filament_material || "Autre";
    (m[k] = m[k] || { k, n: 0, g: 0, colors: [] }); m[k].n++; m[k].g += x.remaining_weight_g || 0; m[k].colors.push(x.filament_color); return m; }, {}))
    .sort((a, b) => b.g - a.g);
  const brands = Object.entries(list.reduce((m, x) => { const k = x.filament_manufacturer || "Sans marque"; m[k] = (m[k] || 0) + 1; return m; }, {}))
    .sort((a, b) => b[1] - a[1]);
  const top = Math.max(1, ...by.map(x => x.g));
  const shown = list.filter(x => only === "all" ? true : only === "low" ? (x.remaining_weight_g ?? 999) < 200
    : only.startsWith("mat:") ? (x.filament_material || "Autre") === only.slice(4) : (x.filament_manufacturer || "Sans marque") === only.slice(6))
    .sort(sort === "pct" ? (a, b) => (spoolPct(a) ?? 1) - (spoolPct(b) ?? 1) : sort === "name" ? (a, b) => spoolName(a).localeCompare(spoolName(b), "fr")
      : (a, b) => (a.remaining_weight_g ?? 1e9) - (b.remaining_weight_g ?? 1e9));
  const chip = (on, c = "#F59E0B") => ({ height: 28, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 12, border: "1px solid var(--border)",
    background: on ? c : "var(--surface2)", color: on ? "#fff" : "var(--text2)", whiteSpace: "nowrap" });
  const pill = (t, c) => <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 20, whiteSpace: "nowrap", color: c,
    background: `${c}1f`, border: `1px solid ${c}40` }}>{t}</span>;
  const cap = more ? shown.length : 60;
  return <>
    <Stats items={[["Bobines", list.length, "#F59E0B"], ["Poids", fmtG(kg), "#D97706"], worth ? ["Valeur restante", fmtEur(worth), "#16a34a"] : null,
      inAms ? ["Dans l'AMS", inAms, "#3B82F6"] : null, ["Sous 200 g", lowN, "#dc2626"], ["Sous 15 %", list.filter(x => (spoolPct(x) ?? 1) < 0.15).length, "#d97706"]]}/>
    {by.length > 1 && <><H2>Par matière · touche pour filtrer</H2><div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {by.map(x => <button key={x.k} type="button" onClick={() => setOnly(o => o === `mat:${x.k}` ? "all" : `mat:${x.k}`)}
        style={{ display: "grid", gridTemplateColumns: "92px minmax(0,1fr) auto", alignItems: "center", gap: 10, padding: "3px 4px", borderRadius: 10, cursor: "pointer",
          border: "none", textAlign: "left", background: only === `mat:${x.k}` ? "rgba(245,158,11,0.14)" : "transparent" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.k}</span>
        <span style={{ height: 14, borderRadius: 7, background: "var(--surface2)", overflow: "hidden", display: "flex" }}>
          {x.colors.map((c, i) => <span key={i} style={{ width: `${(100 * x.g / top) / x.colors.length}%`, background: hexCss(c) }}/>)}</span>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap" }}>{x.n} · {fmtG(x.g)}</span></button>)}</div></>}
    <H2>Les bobines</H2>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <button type="button" style={chip(only === "low", "#dc2626")} onClick={() => setOnly("low")}>Presque vides ({lowN})</button>
      <button type="button" style={chip(only === "all")} onClick={() => setOnly("all")}>Toutes ({list.length})</button>
      {brands.length > 1 && brands.slice(0, 8).map(([b, n]) => <button key={b} type="button" style={chip(only === `brand:${b}`, "#8B5CF6")}
        onClick={() => setOnly(o => o === `brand:${b}` ? "all" : `brand:${b}`)}>{b} ({n})</button>)}
    </div>
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <Muted>Trier :</Muted>
      {[["g", "les plus basses"], ["pct", "en %"], ["name", "par nom"]].map(([k, l]) => <button key={k} type="button" style={chip(sort === k, "#3B82F6")} onClick={() => setSort(k)}>{l}</button>)}
    </div>
    {!shown.length ? <Muted>Aucune bobine ici.</Muted> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 8 }}>
      {shown.slice(0, cap).map(x => { const pc = spoolPct(x), c = pctColor(pc);
        return <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 14, minWidth: 0,
          background: `linear-gradient(135deg, ${hexCss(x.filament_color)}22, transparent 55%), var(--surface2)`, border: "1px solid var(--border)" }}>
          <SpoolDot color={x.filament_color} colors={x.filament_colors_array} multicolor={x.filament_multicolor_type} finish={finishOf(x)} pct={pc} size={40}/>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{spoolName(x)}</span>
              <span style={{ fontSize: 13.5, fontWeight: 900, color: c, whiteSpace: "nowrap" }}>{fmtG(x.remaining_weight_g)}</span></div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {x.filament_manufacturer && pill(x.filament_manufacturer, "#8B5CF6")}
              {x.filament_material && pill(x.filament_material, "#F59E0B")}
              {spoolKind(x) && spoolKind(x) !== x.filament_material && pill(spoolKind(x), "#0EA5E9")}
              {/* ams_tray est un identifiant interne : on montre l'emplacement lisible (« AMS-B slot 1 ») */}
              {x.ams_tray && pill(`📍 ${x.location || "AMS"}`, "#3B82F6")}
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${(pc ?? 0) * 100}%`, background: c }}/></span>
              {pc != null && <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)" }}>{Math.round(pc * 100)} %</span>}</span>
          </div></div>; })}</div>}
    {shown.length > cap && <button type="button" style={{ ...chip(false), alignSelf: "center" }} onClick={() => setMore(true)}>Voir les {shown.length - cap} autres</button>}
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
      {(() => {
        // la place a cote de l'anneau : etroite (demi-colonne), le nom court, la matiere dessous, le temps sans « encore »
        const room = W - ring - 10, tight = room < 130;
        const one = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 };
        return <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          {tight ? <>
            <span style={{ fontSize: 14, fontWeight: 900, color: "var(--text)", ...one }}>{amsLab(a)}</span>
            {a.dry_filament && <Muted size={11} style={one}>{a.dry_filament}{a.dry_temperature ? ` · ${a.dry_temperature}°` : ""}</Muted>}
            <span style={{ fontSize: 13, fontWeight: 900, color: "#ea580c", ...one }}>{fmtDur((a.dry_time || 0) * 60)}</span>
          </> : <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: ring >= 60 ? 16 : 13.5, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" }}>{amsLab(a)}</span>
              {a.dry_filament && <Muted size={11.5} style={one}>{a.dry_filament}</Muted>}
            </div>
            <span style={{ fontSize: ring >= 60 ? 14 : 12, fontWeight: 800, color: "#ea580c", ...one }}>encore {fmtDur((a.dry_time || 0) * 60)}</span>
          </>}
          <div style={{ height: 5, borderRadius: 4, background: "var(--surface2)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${prog(a) * 100}%`, borderRadius: 4, background: "linear-gradient(90deg, #fb923c, #f97316)" }}/></div>
        </div>;
      })()}
    </div>
  );
  const hero = <Hero visual={o.ring && k?.active ? s => <Ring value={(k.ok || 0) / k.active} size={s} color="#22c55e">{Math.round(100 * (k.ok || 0) / k.active)}%</Ring> : null}
    value={v ? k?.to_dry ?? 0 : "…"} unit="à sécher" accent={k?.to_dry ? ["#DC2626", "#F97316"] : ["#16A34A", "#4ADE80"]}
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
            {trays.length > 0 && <span style={{ display: "inline-flex", gap: 4 }}>{trays.map(t => <SpoolDot key={t.id} color={t.spool_info?.color || t.spool_info?.filament_color || t.color} colors={t.spool_info?.colors_array}
              multicolor={t.spool_info?.multicolor_type} finish={finishOf(t.spool_info, t)} size={26}
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
          const ring = Math.max(34, Math.min(each, W < 215 ? 64 : 84, W * 0.42, W - 100));
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
        // personne n'imprime : chaque copain en avatar, l'anneau de la couleur de son etat, son nom et son etat dessous
        if (!p.length) {
          const list = o.idle ? others : [];
          if (!list.length) return <Empty>Personne n'imprime en ce moment</Empty>;
          // une seule ligne de titre (courte si la tuile est etroite), comptee dans la place des avatars
          const g = fitGrid(list.length, bw, H - 28, { gap: 10, max: 64, extra: 34 });
          const s2 = Math.max(30, g.size);
          return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, minHeight: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden",
              textOverflow: "ellipsis", flexShrink: 0 }}>{bw < 260 ? "Personne n'imprime" : "Personne n'imprime en ce moment"}</span>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, minmax(0, 1fr))`, gap: 10, justifyItems: "center" }}>
              {list.map(([id, s]) => { const [l, c] = FR_STATE[s.state] || FR_STATE.off;
                return <span key={id} data-tip={`${s.name || "Copain"}
${l}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 0, maxWidth: "100%" }}>
                  <span style={{ position: "relative", borderRadius: "50%", padding: 3, background: `conic-gradient(${c}, ${c}66, ${c})` }}>
                    <span style={{ display: "flex", borderRadius: "50%", background: "var(--surface)", padding: 2 }}><FrAvatar name={s.name} size={s2 - 10}/></span>
                    <span style={{ position: "absolute", right: 1, bottom: 1, width: Math.max(10, s2 * 0.22), height: Math.max(10, s2 * 0.22), borderRadius: "50%",
                      background: c, boxShadow: "0 0 0 2px var(--surface)" }}/></span>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{s.name || "Copain"}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: c, whiteSpace: "nowrap", marginTop: -3 }}>{l}</span></span>; })}</div></div>;
        }
        // les affiches, autant que la place en tient (une grille qui remplit la tuile)
        const g = fitGrid(p.length, bw, room, { gap: 8, ar: 0.95, max: 260 });
        if (!o.scroll && g.size >= 80) {
          const rowH = Math.floor((room - 8 * (g.rows - 1)) / g.rows);
          return <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, minmax(0, 1fr))`, gap: 8 }}>
              {p.map(x => <FrPoster key={x.id} x={x} thumbs={o.thumbs} h={rowH}/>)}</div>
            {strip > 0 && <FrIdle list={others}/>}</div>;
        }
        // un seul copain, pas la place d'une affiche : une carte en largeur (plateau, nom, impression, avancement, fin)
        if (p.length === 1 && !o.scroll && bw >= 200 && room >= 50) {
          const x = p[0], t = Math.min(room, 110), end = frEnd(x);
          return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, minHeight: 0 }}>
            <div title={x.print?.name || x.print_name} style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <div style={{ width: t, height: t, borderRadius: 14, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                background: `radial-gradient(circle, ${FR_C}2e, transparent 70%), var(--surface2)` }}>
                <FrImg src={o.thumbs ? x.print?.image : null} style={{ width: "86%", height: "86%", objectFit: "contain" }} fallback={<FrAvatar name={x.name} size={t * 0.5}/>}/></div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <b data-pk="" style={{ flex: 1, minWidth: 0, fontSize: 15, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</b>
                  <span data-pk="" style={{ fontSize: 22, fontWeight: 900, color: FR_C, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{frPct(x)}%</span></div>
                <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><W text={x.print?.name || x.print_name || "imprime"}/></div>
                <div style={{ height: 6, borderRadius: 6, background: "var(--border)", overflow: "hidden" }}>
                  <div data-pk="" style={{ height: "100%", width: `${frPct(x)}%`, background: FR_C }}/></div>
                {end && t >= 64 && <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>fin {end}</span>}
              </div>
            </div>
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
// les series MakerWorld jour par jour (points par origine, depenses, compteurs du compte), en cache 5 min
const _mwSer = {};
function useMwSeries(on, days) {
  const [v, setV] = useState(() => _mwSer[days]?.v ?? null);
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    const c = _mwSer[days];
    if (c && Date.now() - c.at < 300000) { setV(c.v); return undefined; }
    client.get("/makerworld/creator/series", { params: { days, tz: -new Date().getTimezoneOffset() } })
      .then(({ data }) => { _mwSer[days] = { v: data?.days || [], at: Date.now() }; if (live) setV(_mwSer[days].v); })
      .catch(() => { if (live) setV(null); });
    return () => { live = false; };
  }, [on, days]);
  return v;
}
const MW_C = "#EAB308";
// ce qu'on peut suivre jour par jour : la valeur d'un jour, son nom, sa couleur
const MW_METRICS = [["points", "Points", MW_C, "⭐"], ["downloads", "Téléchargements", "#3B82F6", "⬇️"], ["prints", "Impressions", "#22C55E", "🖨️"],
  ["boosts", "Boosts reçus", "#8B5CF6", "🚀"], ["likes", "J'aime", "#EC4899", "❤️"]];
const MW_SRC = [["model", "modèles", MW_C], ["profile", "profils", "#F97316"], ["boost", "boosts", "#8B5CF6"]];
const MW_STATS = head => [["⬇️", head?.downloads, "téléch."], ["🖨️", head?.prints, "impr."], ["🚀", head?.boosts, "boosts"], ["❤️", head?.likes, "j'aime"]];
const mwNum = v => { const n = Math.round(v || 0); return n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(".", ",")} k` : n.toLocaleString("fr-FR"); };
const mwDay = k => new Date(`${k}T12:00:00`);
// des barres empilees : une par jour, les parts dans l'ordre de « parts »
function StackBars({ rows, parts, height = 120, labels, titles }) {
  const max = Math.max(1, ...rows.map(r => parts.reduce((t, [k]) => t + (r[k] || 0), 0)));
  const gap = rows.length > 40 ? 1 : rows.length > 20 ? 2 : 4;
  return <div style={{ display: "flex", gap, alignItems: "flex-end", height: height + (labels ? 15 : 0) }}>
    {rows.map((r, i) => <div key={i} title={titles?.[i]} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{ width: "100%", maxWidth: 30, display: "flex", flexDirection: "column-reverse", borderRadius: rows.length > 40 ? 2 : 4, overflow: "hidden",
        height: Math.max(2, Math.round(height * parts.reduce((t, [k]) => t + (r[k] || 0), 0) / max)), background: "var(--surface2)" }}>
        {parts.map(([k, , c]) => r[k] > 0 && <span key={k} style={{ display: "block", flex: r[k], background: c }}/>)}</div>
      {labels && <span style={{ fontSize: 10, height: 13, color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{labels[i]}</span>}
    </div>)}
  </div>;
}
// la fenetre : le profil, le solde, et tout jour par jour sur la periode choisie
function MwZoom({ c }) {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState("downloads");
  const ser = useMwSeries(true, days);
  const [per, setPer] = useState(null);          // l'apercu sur la periode (modeles et leurs ecarts)
  const [bill, setBill] = useState(null);        // les dernieres transactions
  const [sheet, setSheet] = useState(null);      // la fiche d'un modele, ouverte par-dessus
  useEffect(() => {
    let live = true;
    setPer(null);
    client.get("/makerworld/creator", { params: { period: String(days === 90 ? 90 : days) } }).then(({ data }) => live && setPer(data)).catch(() => {});
    return () => { live = false; };
  }, [days]);
  useEffect(() => { client.get("/makerworld/creator/points").then(({ data }) => setBill(data?.items || [])).catch(() => setBill([])); }, []);
  const { W } = useBox();
  const pr = c.profile, H = zoomChartH(W);
  const lab = (ser || []).map((d, i, a) => { const dt = mwDay(d.date), step = a.length > 60 ? 15 : a.length > 20 ? 5 : 1;
    return a.length > 60 ? (dt.getDate() === 1 ? dt.toLocaleDateString("fr-FR", { month: "short" }) : "") : dt.getDate() % step === 0 || a.length <= 7 ? String(dt.getDate()) : ""; });
  const tot = k => (ser || []).reduce((t, d) => t + (d[k] || 0), 0);
  const m = MW_METRICS.find(x => x[0] === metric);
  const chip = on => ({ height: 28, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 12, border: "1px solid var(--border)",
    background: on ? MW_C : "var(--surface2)", color: on ? "#1c1917" : "var(--text2)", whiteSpace: "nowrap" });
  const top = (per?.models || []).map(x => ({ ...x, p: x.period || {} })).filter(x => x.p.points > 0 || x.p.downloads > 0 || x.p.prints > 0)
    .sort((a, b) => (b.p.points || 0) - (a.p.points || 0) || (b.p.downloads || 0) - (a.p.downloads || 0)).slice(0, 6);
  const card = (label, value, color = "var(--text)", sub = null) => <div className="card-sm" style={{ padding: "9px 11px", minWidth: 0 }}>
    <Muted size={11}>{label}</Muted><div style={{ fontSize: 19, fontWeight: 900, color, whiteSpace: "nowrap" }}>{value}</div>{sub && <Muted size={10.5}>{sub}</Muted>}</div>;
  return <>
    {/* le profil */}
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      {pr.avatar && <img src={mwImg(pr.avatar, 120)} alt="" style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover" }}/>}
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>{pr.name || "Mon profil"}{pr.level != null && <span style={{ marginLeft: 8, fontSize: 11.5,
          fontWeight: 900, color: "#1c1917", background: MW_C, borderRadius: 8, padding: "1px 7px" }}>niv. {pr.level}</span>}</div>
        <Muted size={12}>{[pr.handle && `@${pr.handle}`, `${mwNum(pr.fans)} abonnés`, `${mwNum(pr.follows)} abonnements`, `${mwNum(pr.designs)} modèles`].filter(Boolean).join(" · ")}</Muted>
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 8 }}>
      {card("Solde", mwNum(pr.points?.total), "var(--text)", pr.points?.exclusive ? `dont ${mwNum(pr.points.exclusive)} exclusifs` : null)}
      {["7", "30", "365"].map(p => c.earned?.[p] != null && <React.Fragment key={p}>{card(p === "365" ? "Gagnés sur un an" : `Gagnés sur ${p} j`, `+${mwNum(c.earned[p])}`, "#16a34a")}</React.Fragment>)}
      {c.earned_total != null && card("Gagnés en tout", mwNum(c.earned_total), "#16a34a")}
      {c.spent_total != null && card("Dépensés en tout", mwNum(c.spent_total), "#dc2626")}
    </div>
    {/* la periode */}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <Muted size={12}>Période</Muted>{[7, 30, 90, 365].map(d => <button key={d} type="button" style={chip(days === d)} onClick={() => setDays(d)}>{d === 365 ? "1 an" : `${d} j`}</button>)}</div>
    <H2>Points gagnés par jour</H2>
    {ser ? <>
      <StackBars rows={ser} parts={MW_SRC} height={H} labels={lab}
        titles={ser.map(d => `${mwDay(d.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} : +${mwNum(d.points)} (modèles ${mwNum(d.model)}, profils ${mwNum(d.profile)}, boosts ${mwNum(d.boost)})${d.spent ? ` · dépensés ${mwNum(d.spent)}` : ""}`)}/>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>
        {MW_SRC.map(([k, l, col]) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: col }}/>{l} <b style={{ color: "var(--text)" }}>+{mwNum(tot(k))}</b></span>)}
        <span>total <b style={{ color: "#16a34a" }}>+{mwNum(tot("points"))}</b></span>
        {tot("spent") > 0 && <span>dépensés <b style={{ color: "#dc2626" }}>{mwNum(tot("spent"))}</b></span>}</div>
    </> : <Muted>…</Muted>}
    <H2>Activité par jour</H2>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {MW_METRICS.slice(1).map(([k, l, , e]) => <button key={k} type="button" style={chip(metric === k)} onClick={() => setMetric(k)}>{e} {l} · {mwNum(tot(k))}</button>)}</div>
    {ser ? <Bars values={ser.map(d => d[metric] || 0)} color={m[2]} height={H} labels={lab} showValues={W / ser.length >= 22}
      titles={ser.map(d => `${mwDay(d.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} : ${d[metric] || 0} ${m[1].toLowerCase()}`)}/> : <Muted>…</Muted>}
    {ser && !ser.some(d => d.src) && <Muted size={11.5}>Les compteurs jour par jour se remplissent avec les relevés quotidiens (ou l'import de l'historique, page MakerWorld).</Muted>}
    {top.length > 0 && <><H2>Meilleurs modèles de la période</H2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {top.map(x => <div key={x.design_id} onClick={e => { e.stopPropagation(); setSheet({ design_id: x.design_id, title: x.title, title_fr: x.title_fr, cover_url: x.cover_url }); }}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: 7, borderRadius: 12, background: "var(--surface2)", cursor: "pointer", minWidth: 0 }}>
          {x.cover_url ? <img src={mwImg(x.cover_url, 120)} alt="" style={{ width: 44, height: 44, borderRadius: 9, objectFit: "cover", flexShrink: 0 }}/>
            : <span style={{ width: 44, height: 44, borderRadius: 9, background: "var(--surface)", flexShrink: 0 }}/>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.title_fr || x.title}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              ⬇️ {mwNum(x.p.downloads)} · 🖨️ {mwNum(x.p.prints)} · 🚀 {mwNum(x.p.boosts)} · ❤️ {mwNum(x.p.likes)}</div></div>
          <b style={{ fontSize: 14, color: "#16a34a", whiteSpace: "nowrap" }}>+{mwNum(x.p.points)}</b></div>)}
      </div></>}
    <H2>Depuis toujours</H2>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
      {card("⬇️ Téléchargements", mwNum(pr.downloads), "var(--text)", pr.profile_downloads ? `+ ${mwNum(pr.profile_downloads)} de profils` : null)}
      {card("🖨️ Impressions", mwNum(pr.prints), "var(--text)", pr.profile_prints ? `+ ${mwNum(pr.profile_prints)} de profils` : null)}
      {card("🚀 Boosts reçus", mwNum(pr.boosts))}{card("❤️ J'aime", mwNum(pr.likes))}{card("📁 Collections", mwNum(pr.collections))}
    </div>
    <H2>Dernières transactions</H2>
    {bill == null ? <Muted>…</Muted> : !bill.length ? <Muted>Aucune.</Muted> :
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{bill.slice(0, 12).map((x, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8,
        fontSize: 12.5, padding: "5px 8px", borderRadius: 9, background: i % 2 ? "transparent" : "var(--surface2)", minWidth: 0 }}>
        <span style={{ width: 62, flexShrink: 0, color: "var(--muted)", fontWeight: 700 }}>{x.time ? new Date(x.time).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : ""}</span>
        <span style={{ flexShrink: 0, fontWeight: 800, color: "var(--text2)" }}>{x.label}</span>
        <span style={{ flex: 1, minWidth: 0, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.instance_title || x.title || ""}</span>
        <b style={{ flexShrink: 0, color: x.points < 0 ? "#dc2626" : "#16a34a" }}>{x.points > 0 ? "+" : ""}{String(x.points).replace(".", ",")}</b></div>)}</div>}
    {sheet && <span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <MakerWorldModelSheet designId={sheet.design_id} preview={sheet} onClose={() => setSheet(null)}/></span>}
  </>;
}
// la tuile : le solde et ses gains, la courbe de ce qu'on suit (14 jours), les compteurs, le modele du moment
function MwPoints({ c, o, sz }) {
  const metric = o.metric || "points";
  const ser = useMwSeries(o.chart && !!c?.profile, 14);
  if (!c?.profile) return null;
  const per = o.period || "7";
  const earned = c.earned?.[per] ?? (per === "7" ? c.earned7 : c.earned30);
  const head = c.head?.[per]?.totals;
  const m = MW_METRICS.find(x => x[0] === metric) || MW_METRICS[0];
  const today = ser?.[ser.length - 1];
  const best = (c.models || []).map(x => ({ ...x, p: x.period || {} })).filter(x => x.p.points > 0 || x.p.downloads > 0)
    .sort((a, b) => (b.p.points || 0) - (a.p.points || 0) || (b.p.downloads || 0) - (a.p.downloads || 0))[0];
  return (
    <Tile icon={<Coins size={15}/>} color={MW_C} label="MakerWorld" to="/prints?tab=makerworld" zoom={<MwZoom c={c}/>}
      mini={sz.h === 0.5} summary={<>{Math.round(c.profile.points?.total || 0)}{earned != null && <span style={{ fontSize: 12, color: "#16a34a" }}>+{Math.round(earned)}</span>}</>}>
      {({ W, H }) => {
        const stats = o.stats && head && H >= 120;
        const bestRow = o.best !== false && best && H >= 200;
        const chartH = H - 36 - (stats ? 40 : 0) - (bestRow ? 52 : 0);
        const vals = (ser || []).map(d => d[metric] || 0);
        return <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
            <span data-pk="" style={{ fontSize: 24, fontWeight: 900, color: "var(--text)", lineHeight: 1.05, ...gradText("#CA8A04", "#F97316") }}>{Math.round(c.profile.points?.total || 0)}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>points</span>
            {earned != null && <span data-pk="" style={{ fontSize: 12, fontWeight: 800, color: "#16a34a" }}>+{Math.round(earned)}{W >= 170 ? ` en ${per} j` : ""}</span>}
            {/* aujourd'hui, quand il s'est passe quelque chose */}
            {today && W >= 280 && (today.points > 0 || today.boosts > 0 || today.downloads > 0) && <span data-pk="" style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800,
              color: "#a16207", background: "linear-gradient(135deg, rgba(234,179,8,0.18), rgba(249,115,22,0.12))", border: "1px solid rgba(234,179,8,0.35)",
              borderRadius: 10, padding: "2px 8px", whiteSpace: "nowrap" }}>
              aujourd'hui {[today.points > 0 && `+${mwNum(today.points)} pts`, today.boosts > 0 && `🚀 ${today.boosts}`, today.downloads > 0 && `⬇️ ${today.downloads}`].filter(Boolean).join(" · ")}</span>}
          </div>
          {o.chart && ser && chartH >= 18 && (vals.some(Boolean) ? <div style={{ marginTop: "auto" }}>
            {metric !== "points" && chartH >= 40 && <Muted size={10.5}>{m[3]} {m[1].toLowerCase()} · 14 j : {mwNum(vals.reduce((t, v) => t + v, 0))}</Muted>}
            <Spark values={vals} color={m[2]} height={Math.min(chartH - (metric !== "points" && chartH >= 40 ? 14 : 0), 320)}/></div>
            : chartH >= 30 && <Empty>Rien ces 14 jours</Empty>)}
          {bestRow && <div title="Le modèle qui rapporte le plus sur 30 jours" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, minWidth: 0 }}>
            {best.cover_url && <img data-pk="" src={mwImg(best.cover_url, 90)} alt="" style={{ width: 40, height: 40, borderRadius: 9, objectFit: "cover", flexShrink: 0 }}/>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)" }}>🏆 en tête sur 30 j</div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{best.title_fr || best.title}</div></div>
            <b data-pk="" style={{ fontSize: 13, color: "#16a34a", whiteSpace: "nowrap" }}>+{mwNum(best.p.points)}</b></div>}
          {stats && <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginTop: o.chart && ser ? 6 : "auto" }}>
            {MW_STATS(head).map(([e, n, l]) => <div key={l} data-pk="" style={{ textAlign: "center", minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" }}>{W >= 200 ? `${e} ` : ""}{mwNum(n)}</div>
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
  // etroite : « 3 à evaluer », sur une ligne
  const headOf = W => <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, whiteSpace: "nowrap" }}>
    <span data-pk="" style={{ fontSize: 24, fontWeight: 900, color: items.length ? "#ea580c" : "var(--text)", lineHeight: 1.05, ...(items.length ? gradText("#EA580C", "#F59E0B") : {}) }}>{items.length}</span>
    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis" }}>{W < 230 ? "à évaluer" : `modèle${items.length > 1 ? "s" : ""} à évaluer`}</span></div>;
  const head = headOf(400);
  return (
    <Tile icon={<Star size={15}/>} color="#F97316" label="À évaluer" to="/prints?tab=makerworld"
      mini={sz.h === 0.5} summary={<span style={{ color: items.length ? "#ea580c" : "var(--text)" }}>{items.length}</span>}
      zoom={items.length ? <>
        <Stats items={[["À évaluer", items.length, "#ea580c"], r.stats && ["Déjà évalués", r.stats.rated, "#16a34a"],
          ["Impressions concernées", items.reduce((t, x) => t + (x.printed || 0), 0), "#3B82F6"]].filter(Boolean)}/>
        <Muted>Une évaluation par modèle imprimé : MakerWorld en attend une pour chaque profil que tu as imprimé.</Muted>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
        {/* chaque carte ouvre son evaluation (dans l'appli si MakerWorld l'attend, sinon sur MakerWorld) */}
        {items.map(x => <RateButton key={x.design_id} did={x.design_id} ext="" doneLabel={<span style={{ fontSize: 13, fontWeight: 900 }}>✓ Évalué</span>}
          style={{ display: "flex", flexDirection: "column", gap: 5, padding: 8, borderRadius: 16, minWidth: 0, textAlign: "left", textDecoration: "none",
            font: "inherit", color: "inherit", cursor: "pointer", alignItems: "stretch", boxSizing: "border-box", width: "100%",
            background: "linear-gradient(160deg, rgba(249,115,22,0.10), transparent 55%), var(--surface2)", border: "1px solid var(--border)" }}
          label={<>
          <span style={{ position: "relative" }}>
            {x.cover_url ? <img src={mwImg(x.cover_url, 300)} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 12, display: "block" }}/>
              : <span style={{ display: "block", width: "100%", aspectRatio: "1", borderRadius: 12, background: "var(--surface)" }}/>}
            <span style={{ position: "absolute", left: 6, bottom: 6, fontSize: 11, fontWeight: 900, color: "#fff", padding: "2px 8px", borderRadius: 9,
              background: "linear-gradient(135deg, #EA580C, #F59E0B)" }}>★ à noter</span></span>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", ...clamp(2) }}>{x.title_fr || x.title || `Modèle ${x.design_id}`}</span>
          {x.creator_name && <Muted size={11} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>par {x.creator_name}</Muted>}
          <span style={{ fontSize: 11, fontWeight: 800, color: "#ea580c" }}>imprimé{x.printed > 1 ? ` ${x.printed} fois` : ""}{x.last_date ? ` · ${ago(x.last_date)}` : ""}</span>
          <span style={{ marginTop: "auto", alignSelf: "flex-start", fontSize: 12, fontWeight: 900, color: "#fff", padding: "4px 11px", borderRadius: 20,
            background: "linear-gradient(135deg, #EA580C, #F59E0B)", boxShadow: "0 4px 12px -6px #EA580C" }}>⭐ Évaluer</span>
        </>}/>)}</div></> : null}>
      {({ W, H }) => {
        if (!items.length) return <>{headOf(W)}<Empty>Tout est évalué</Empty></>;
        const rest = H - 34;
        // basse (une rangee) : la vignette sur toute la hauteur a gauche ; le compte, le titre et la date a droite
        if (o.thumbs && items.length <= 2 && rest < 70 && H >= 44) {
          const x = items[0], s2 = Math.min(H - 2, 72);
          return <div data-tip={`${x.title_fr || x.title || ""}${x.creator_name ? `
par ${x.creator_name}` : ""}`}
            style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ position: "relative", flexShrink: 0 }}>{thumb(x, s2)}
              <span style={{ position: "absolute", top: 3, left: 3, fontSize: 9.5, fontWeight: 900, color: "#fff", padding: "0 5px", borderRadius: 6,
                background: "linear-gradient(135deg, #EA580C, #F59E0B)" }}>★</span>
              {items.length > 1 && <span style={{ position: "absolute", right: -4, bottom: -4, fontSize: 10, fontWeight: 900, color: "#fff", padding: "0 5px",
                borderRadius: 8, background: "#ea580c", boxShadow: "0 0 0 2px var(--surface)" }}>+1</span>}</span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              {W - s2 - 10 < 120 ? <div style={{ display: "flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap" }}>
                <span data-pk="" style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.05, ...gradText("#EA580C", "#F59E0B") }}>{items.length}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>à noter</span></div> : headOf(W)}
              {W >= 200 && <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", lineHeight: 1.25, ...clamp(1) }}>{x.title_fr || x.title || `Modèle ${x.design_id}`}</span>}
              {W >= 260 && x.last_date && <span style={{ fontSize: 10.5, fontWeight: 800, color: "#ea580c", whiteSpace: "nowrap" }}>imprimé {ago(x.last_date)}</span>}
            </span>
          </div>;
        }
        if (!o.thumbs || rest < 24) return headOf(W);
        // un ou deux modeles et de la place : leur carte (grande image, titre, createur, quand, a noter)
        if (items.length <= 2 && rest >= 70) {
          const each = Math.floor((rest - 8 * (items.length - 1)) / items.length);
          const narrow = W < 230;
          const card = x => { const s2 = narrow ? Math.max(40, Math.min(W - 8, each - 54, 150)) : Math.min(each, W * 0.45, 150), when = x.last_date ? ago(x.last_date) : null;
            return <div key={x.design_id} data-tip={x.title_fr || x.title || ""} style={{ display: "flex", flexDirection: narrow ? "column" : "row",
              alignItems: "center", justifyContent: "center", gap: narrow ? 6 : 10, minWidth: 0, height: each, textAlign: narrow ? "center" : "left" }}>
              <span style={{ position: "relative", flexShrink: 0 }}>{thumb(x, s2)}
                <span style={{ position: "absolute", left: 4, bottom: 4, fontSize: 10.5, fontWeight: 900, color: "#fff", padding: "1px 6px", borderRadius: 8,
                  background: "linear-gradient(135deg, #EA580C, #F59E0B)", boxShadow: "0 2px 6px rgba(234,88,12,0.45)" }}>★ à noter</span></span>
              <span style={{ flex: narrow ? "0 0 auto" : 1, minWidth: 0, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: narrow ? 12.5 : 13.5, fontWeight: 800, color: "var(--text)", lineHeight: 1.25, ...clamp(narrow ? 2 : each >= 90 ? 3 : 2) }}>{x.title_fr || x.title || `Modèle ${x.design_id}`}</span>
                {x.creator_name && each >= 64 && <Muted size={11.5} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>par {x.creator_name}</Muted>}
                {each >= 80 && !(narrow && each < 200) && <span style={{ fontSize: 11.5, fontWeight: 800, color: "#ea580c" }}>
                  imprimé{x.printed > 1 ? ` ${x.printed} fois` : ""}{when ? ` · ${when}` : ""}</span>}
              </span></div>; };
          return <>{headOf(W)}<div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, marginTop: 4, minHeight: 0 }}>
            {items.map(card)}</div></>;
        }
        const best = mosaic(items.length, W, rest - 4, 6);
        const cap = best.c * best.r - (best.big ? 3 : 0);
        const list = items.slice(0, cap);
        return <>{headOf(W)}<div style={{ flex: 1, display: "grid", gap: 6, marginTop: 4, ...mosaicGrid(best), minHeight: 0 }}>
          {list.map((x, k) => { const big = best.big && k === 0, cell = big ? best.cell * 2 : best.cell;
            return <div key={x.design_id} data-tip={`${x.title_fr || x.title || ""}${x.creator_name ? `
par ${x.creator_name}` : ""}`} style={{ position: "relative", minWidth: 0,
              minHeight: 0, overflow: "hidden", borderRadius: 12, background: "linear-gradient(135deg, rgba(249,115,22,0.12), var(--surface2))",
              gridColumn: big ? "span 2" : undefined, gridRow: big ? "span 2" : undefined, boxShadow: "inset 0 0 0 1px var(--border)" }}>
              {x.cover_url && <img data-pk="" src={mwImg(x.cover_url, Math.round(cell * 2))} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
                objectFit: "cover", display: "block" }}/>}
              {cell >= 90 && <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "14px 8px 5px", fontSize: big ? 12.5 : 10.5, fontWeight: 800,
                color: "#fff", background: "linear-gradient(to top, rgba(0,0,0,0.65), transparent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {x.title_fr || x.title}</span>}
              <span style={{ position: "absolute", top: 5, left: 5, fontSize: cell >= 60 ? 10 : 9, fontWeight: 900, color: "#fff", padding: "0 5px", borderRadius: 7,
                background: "linear-gradient(135deg, #EA580C, #F59E0B)" }}>★</span>
            </div>; })}
          {items.length > cap && <span style={{ position: "absolute", right: 14, bottom: 12, fontSize: 11, fontWeight: 900, color: "#fff", padding: "1px 7px",
            borderRadius: 9, background: "rgba(0,0,0,0.55)" }}>+{items.length - cap}</span>}</div></>;
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
// le bilan de la roue (la fenetre) : ce qu'on a, ce qui vient, ce qu'on a fait, le journal des cles
function WheelZoom({ a, cells, spins, go }) {
  const k = a.keys, w = k.wheel || {};
  const next = w.next ? new Date(`${w.next}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : null;
  const soon = [
    k.to_next != null && [<Key key="k" size={15}/>, "#d97706", `Prochaine clé dans ${k.to_next} impression${k.to_next > 1 ? "s" : ""} réussie${k.to_next > 1 ? "s" : ""}`],
    w.to_spin_prints != null && [<Dices key="d" size={15}/>, "var(--text)", `Prochain tour dans ${w.to_spin_prints} impression${w.to_spin_prints > 1 ? "s" : ""}`],
    next && w.weekly && [<Dices key="w" size={15}/>, "var(--text)", `+${w.weekly} tour${w.weekly > 1 ? "s" : ""}${w.weekly_tickets ? ` et +${w.weekly_tickets} ticket${w.weekly_tickets > 1 ? "s" : ""}` : ""} ${next}`],
    w.to_ticket_prints != null && [<Ticket key="t" size={15}/>, "#db2777", `Prochain ticket dans ${w.to_ticket_prints} impression${w.to_ticket_prints > 1 ? "s" : ""}${w.to_ticket != null ? ` ou ${w.to_ticket} secret${w.to_ticket > 1 ? "s" : ""} trouvé${w.to_ticket > 1 ? "s" : ""}` : ""}`],
  ].filter(Boolean);
  const card = (l, x, color = "var(--text)") => <div key={l} className="card-sm" style={{ padding: 10 }}><Muted>{l}</Muted>
    <div style={{ fontSize: 18, fontWeight: 900, color }}>{x ?? "—"}</div></div>;
  return <>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 26, flexWrap: "wrap" }}>
      <WheelArt size={170} spin={spins > 0}/>
      <div style={{ display: "flex", gap: 24 }}>{cells.map(([ic, n, l, c]) => <div key={l} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 32, fontWeight: 900, color: c }}>{ic}{n}</span>
        <Muted size={13}>{l}</Muted></div>)}</div>
    </div>
    {spins > 0 && <button onClick={go} style={{ alignSelf: "center", width: "min(320px, 100%)", padding: "10px 14px", borderRadius: 12, border: "none", fontWeight: 900,
      fontSize: 14, cursor: "pointer", color: "#3b2300", background: "linear-gradient(135deg, #FDE68A, #F59E0B)" }}>Tourner la roue</button>}
    {soon.length > 0 && <><H2>Ce qui vient</H2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{soon.map(([ic, c, t], i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 9,
        padding: "7px 10px", borderRadius: 10, background: "var(--surface2)", fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>
        <span style={{ color: c, display: "inline-flex" }}>{ic}</span>{t}</div>)}</div></>}
    <H2>Jusqu'ici</H2>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
      {card("Clés gagnées", k.earned, "#d97706")}{card("Clés dépensées", a.keys_spent)}{card("Tours joués", w.played)}{card("Tickets utilisés", a.tickets_used, "#db2777")}
    </div>
    {k.log?.length > 0 && <><H2>Journal des clés</H2>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>{k.log.slice(0, 10).map((l, i) => <div key={i} style={{ display: "flex", gap: 8, alignItems: "center",
        fontSize: 12.5, padding: "5px 8px", borderRadius: 8, background: i % 2 ? "transparent" : "var(--surface2)", minWidth: 0 }}>
        <span style={{ width: 58, flexShrink: 0, color: "var(--muted)", fontWeight: 700 }}>{l.at ? new Date(l.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : ""}</span>
        <span style={{ flex: 1, minWidth: 0, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.why}</span>
        {l.n ? <b style={{ flexShrink: 0, color: l.n > 0 ? "#16a34a" : "#dc2626" }}>{l.n > 0 ? "+" : ""}{l.n}</b> : null}</div>)}</div></>}
  </>;
}
// la roue : tours, cles et tickets ; un clic, le bilan (et de la, la page)
function Wheel({ a, o, sz = { h: 1 } }) {
  const nav = useNavigate();
  const k = a?.keys;
  if (!k) return null;
  const spins = k.wheel?.spins || 0, tickets = k.wheel?.tickets || 0;
  const cells = [[<Dices key="d" size={15}/>, spins, `tour${spins > 1 ? "s" : ""}`, "var(--text)"],
    ...(o.keys ? [[<Key key="k" size={15}/>, k.balance, `clé${k.balance > 1 ? "s" : ""}`, "#d97706"]] : []),
    ...(o.tickets ? [[<Ticket key="t" size={15}/>, tickets, `ticket${tickets > 1 ? "s" : ""}`, "#db2777"]] : [])];
  const go = e => { e?.stopPropagation(); nav("/stats?tab=achievements"); };
  // des tours a jouer : un mot discret (la roue tourne deja dans le dessin)
  const ready = spins > 0 && <span data-pk="" style={{ alignSelf: "center", fontSize: 11.5, fontWeight: 900, color: "#b45309", background: "rgba(245,158,11,0.16)",
    borderRadius: 10, padding: "2px 9px", whiteSpace: "nowrap" }}>{spins} tour{spins > 1 ? "s" : ""} à jouer</span>;
  return (
    <Tile icon={<Dices size={15}/>} color="#EC4899" label="Roue et clés" to="/stats?tab=achievements"
      zoom={<WheelZoom a={a} cells={cells} spins={spins} go={go}/>}
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
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>{row}{ready}</div></div>
          : <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "center" }}><WheelArt size={art} spin={spins > 0}/></div>{row}{ready}</div>;
        if (wide) return <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>{row}{ready}</div>;
        return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>{row}{H >= 84 && ready}</div>;
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
          <BoxCtx.Provider value={{ W, H: H - imgH - 6 }}>{live ? <Hero visual={s => <Ring value={pct / 100} size={s} color="#22c55e">{pct}%</Ring>} accent={["#16A34A", "#4ADE80"]}
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
// le chiffre d'une temperature : chaude, un degrade de sa couleur vers sa teinte claire ; tiede ou froide
// (40° et moins), un bleu ciel doux, lisible en clair comme en sombre (jamais en noir)
const tempGrad = r => (r.v || 0) > 40 ? gradText(r.c, `color-mix(in srgb, ${r.c} 55%, #ffffff)`) : gradText("#0284C7", "#38BDF8");
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
// un cadran en arc (270°) : la temperature en degrade du froid a la chaleur, la consigne en point sur l'arc,
// le chiffre au centre
function ArcDial({ v, t, max, size, c, targets }) {
  const gid = useMemo(() => `ad${Math.random().toString(36).slice(2, 8)}`, []);
  const sw = Math.max(5, Math.round(size / 11)), r = size / 2 - sw / 2 - 2, cx = size / 2, cy = size / 2;
  const A0 = 135, SPAN = 270, frac = x => Math.max(0, Math.min(1, (x || 0) / max));
  const pt = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const arc = f => { const a1 = A0 + SPAN * Math.max(0.001, f), [x0, y0] = pt(A0), [x1, y1] = pt(a1);
    return `M${x0} ${y0} A${r} ${r} 0 ${SPAN * f > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
  const [tx, ty] = pt(A0 + SPAN * frac(t));
  const light = `color-mix(in srgb, ${c} 55%, #ffffff)`;
  return <svg width={size} height={size} style={{ display: "block", overflow: "visible" }} aria-hidden="true">
    <defs><linearGradient id={gid} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor={heat(20)}/><stop offset="1" stopColor={c}/></linearGradient></defs>
    <path d={arc(1)} fill="none" stroke="var(--surface)" strokeWidth={sw} strokeLinecap="round"/>
    {v > 0 && <path d={arc(frac(v))} fill="none" stroke={`url(#${gid})`} strokeWidth={sw} strokeLinecap="round"
      style={{ filter: v > 40 ? `drop-shadow(0 0 ${sw}px ${c})` : "none", transition: "d .8s" }}/>}
    {targets && t > 0 && <circle cx={tx} cy={ty} r={sw * 0.62} fill="var(--surface)" stroke="var(--text)" strokeWidth={Math.max(1.5, sw / 3.5)}/>}
    <foreignObject x="0" y={size * 0.22} width={size} height={size * 0.6}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
        <span data-pk="" style={{ fontSize: size * 0.27, fontWeight: 900, ...gradText(`color-mix(in srgb, ${c} 72%, #000000)`, c) }}>{Math.round(v)}°</span>
        {targets && t > 0 && size >= 70 && <span style={{ fontSize: Math.max(9, size * 0.12), fontWeight: 800, color: "var(--muted)", marginTop: 2 }}>/{Math.round(t)}°</span>}
      </div></foreignObject>
  </svg>;
}
// une source en carte : un cadran, ou (basse) une barre, ou (haute) un thermometre
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
  // un cadran des que la carte a un peu de hauteur : le nom et l'etat dessous
  if (h >= 64 && w >= 64) {
    const size = Math.min(w - 12, h - (h >= 92 ? 30 : 8), 150);
    return <div title={`${r.l} : ${st}`} style={{ ...card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "6px 6px 7px" }}>
      {r.active && <span style={{ position: "absolute", top: 6, right: 7 }}>{activeChip}</span>}
      <ArcDial v={v} t={t} max={r.max} size={size} c={c} targets={targets}/>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: -size * (h >= 92 ? 0.14 : 0.26), minWidth: 0, maxWidth: "100%" }}>
        <span style={{ color: c, display: "inline-flex" }}><r.ico s={12}/></span>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.l}</span>
        {ic && <span style={{ fontSize: 10.5, fontWeight: 900, color: sc }}>{ic}</span>}</div>
      {w >= 120 && h >= 92 && <span style={{ fontSize: 10, fontWeight: 800, color: sc, whiteSpace: "nowrap" }}>{st}</span>}
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
// en grand (fenetre de la tuile, fenetre de l'imprimante) : les memes thermometres en verre, et pour chacun
// son nom, sa consigne et ce qu'il fait
// les temperatures en bande, pour la fenetre de l'imprimante : un petit thermometre, le chiffre en degrade,
// le pictogramme, la consigne (ou l'etat) ; une case par source, toutes sur une rangee quand la place le permet
export function TempStrip({ status }) {
  const [ref, box] = useMeasure();
  const rows = status?.connected ? tempRows(status, { chamber: true }) : [];
  const cols = Math.max(1, box.W >= 440 ? rows.length : Math.min(2, rows.length));
  return <div ref={ref} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 8 }}>
    {box.W > 0 && rows.map(r => { const c = heat(r.v), [ic, st, sc] = tempState(r.v || 0, r.t || 0);
      return <div key={r.k} title={`${r.l} : ${st}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 8px", borderRadius: 14,
        minWidth: 0, background: `linear-gradient(135deg, color-mix(in srgb, ${c} 16%, transparent), transparent 70%), var(--surface2)`,
        boxShadow: r.active ? `inset 0 0 0 1.5px ${c}` : "none" }}>
        <ThermoGauge bare v={r.v} t={r.t} max={r.max} size={52} c={c} active={r.active}/>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <span style={{ fontSize: 22, fontWeight: 900, whiteSpace: "nowrap", ...gradText(`color-mix(in srgb, ${c} 72%, #000000)`, c) }}>{Math.round(r.v || 0)}°</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 800, color: r.active ? c : "var(--text2)", whiteSpace: "nowrap" }}>
            <r.ico s={13}/>{r.l}</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: sc, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.t > 0 ? `${ic} ${Math.round(r.t)}°` : st}</span>
        </div></div>; })}</div>;
}
export function TempPanel({ status, chamber = true, cardH = 190 }) {
  const [ref, box] = useMeasure();
  const rows = status?.connected ? tempRows(status, { chamber }) : [];
  const cols = box.W >= 560 ? Math.min(4, rows.length) : 2;
  const colW = box.W ? Math.floor((box.W - 16 * (cols - 1)) / cols) : 0;
  const size = Math.max(110, Math.min(cardH - 60, colW * 1.6, 240));
  return <div ref={ref} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 16, justifyItems: "center", padding: "6px 0" }}>
    {colW > 0 && rows.map(r => { const c = heat(r.v), [ic, st, sc] = tempState(r.v || 0, r.t || 0);
      return <div key={r.k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 }}>
        <ThermoGauge v={r.v} t={r.t} max={r.max} size={size} c={c} active={r.active} label={`${Math.round(r.v || 0)}°`}/>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 800, color: r.active ? c : "var(--text2)" }}>
          <r.ico s={14}/>{r.l}{r.active && <span style={{ fontSize: 9.5, fontWeight: 900, color: "#fff", background: c, padding: "1px 6px", borderRadius: 10 }}>active</span>}</span>
        {r.t > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>consigne {Math.round(r.t)}°</span>}
        <span style={{ fontSize: 12, fontWeight: 900, color: sc }}>{ic ? `${ic} ` : ""}{st}</span>
      </div>; })}</div>;
}
function Temps({ status, o, sz }) {
  if (!status?.connected) return null;
  const rows = tempRows(status, o);
  const hot = r => (r.v || 0) > 40;
  const thermo = (W, H) => { const g = thermoGrid(rows.length, W, H);
    return g && <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${g.cols}, ${g.w}px)`, gap: 8, justifyContent: "center", alignContent: "center" }}>
      {rows.map(r => <ThermoCell key={r.k} r={r} w={g.w} h={g.h} targets={o.targets}/>)}</div>; };
  // des thermometres en verre, sans carte autour (comme les gouttes de l'humidite)
  const glass = (W, H) => {
    const g = fitGrid(rows.length, W, H, { ar: 2, extra: 34, max: 75, gap: 8 });
    // basse : chaque thermometre a gauche, le chiffre en degrade et le nom a droite
    if (g.size < 34 && H >= 44) {
      const cols = Math.max(1, Math.min(rows.length, Math.floor((W + 8) / 84))), nr = Math.ceil(rows.length / cols);
      const th = Math.min(96, Math.floor((H - 8 * (nr - 1)) / nr) - 2);
      // le texte d'abord (« 220° » tient toujours), le thermometre prend ce qui reste
      const colW = (W - 8 * (cols - 1)) / cols;
      const fs = Math.max(12, Math.min(th >= 70 ? 24 : 21, colW * 0.55 / 2.6));
      const thW = Math.max(14, Math.min(th * 0.5, colW - fs * 2.7 - 8));
      if (th >= 26) return <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 8, alignContent: "center" }}>
        {rows.map(r => { const c = heat(r.v), [ic, st, sc] = tempState(r.v || 0, r.t || 0);
          return <div key={r.k} title={`${r.l} : ${st}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, minWidth: 0, overflow: "hidden" }}>
            <ThermoGauge bare v={r.v} t={r.t} max={r.max} size={Math.round(thW * 2)} c={c} active={r.active} targets={o.targets}/>
            <div style={{ minWidth: 0, flex: "0 1 auto", overflow: "hidden", display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
              <span data-pk="" style={{ fontSize: fs, fontWeight: 900, whiteSpace: "nowrap", ...gradText(`color-mix(in srgb, ${c} 72%, #000000)`, c) }}>{Math.round(r.v || 0)}°</span>
              {/* le pictogramme (comme l'en-tete de l'imprimante) plutot que le nom : buse G / D, plateau, chambre */}
              <span title={r.l} style={{ display: "inline-flex", alignItems: "center", gap: 2, color: r.active ? c : "var(--muted)", marginTop: 1 }}>
                <r.ico s={13}/>{r.s && <span style={{ fontSize: 10.5, fontWeight: 900 }}>{r.s}</span>}</span>
              {th >= 56 && <span style={{ fontSize: 10, fontWeight: 800, color: sc, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.targets && r.t > 0 ? `${ic ? `${ic} ` : ""}${Math.round(r.t)}°` : colW < 110 ? (ic || "repos") : ic ? `${ic} ${st}` : st}</span>}
            </div></div>; })}</div>;
    }
    if (g.size < 24) return null;
    return <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${g.cols}, auto)`, justifyContent: "space-evenly", alignContent: "center", gap: 8 }}>
      {rows.map(r => <div key={r.k} title={`${r.l} : ${tempState(r.v || 0, r.t || 0)[1]}`}>
        <ThermoGauge v={r.v} t={r.t} max={r.max} size={g.size * 2} c={heat(r.v)} active={r.active} targets={o.targets}
          label={`${Math.round(r.v || 0)}°`} sub={`${r.l}${o.targets && r.t > 0 && g.size >= 34 ? ` · ${Math.round(r.t)}°` : ""}`}/></div>)}</div>;
  };
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
        <span data-pk="" style={{ fontSize: 16, fontWeight: 900, ...tempGrad(r) }}>{Math.round(r.v || 0)}°</span>
        {o.targets && r.t > 0 && <sup style={{ color: "var(--muted)", fontWeight: 700, fontSize: 10.5, lineHeight: 0 }}>/{Math.round(r.t)}°</sup>}
      </div>))}</div>;
  const cells = (W, H) => {
    const g = fitGrid(rows.length, W, H, { ar: 0.42, gap: 6, max: 200 });
    return <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${g.cols}, 1fr)`, gap: 6, alignContent: "center" }}>
      {rows.map(r => <div key={r.k} title={r.l} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, minWidth: 0,
        color: hot(r) ? r.c : "var(--muted)" }}><r.ico s={14}/>{r.s && <span style={{ fontSize: 10.5, fontWeight: 900, marginLeft: -3 }}>{r.s}</span>}
        <span data-pk="" style={{ fontSize: 16, fontWeight: 900, ...tempGrad(r) }}>{Math.round(r.v || 0)}°</span></div>)}</div>;
  };
  return (
    <Tile icon={<Thermometer size={15}/>} color="#F97316" label="Températures" zoom={({ W, H }) => { const n = tempRows(status, o).length, r = W >= 520 ? 1 : Math.ceil(n / 2);
      return <TempPanel status={status} chamber={o.chamber} cardH={Math.max(170, Math.min(360, Math.floor((H - 10 * (r - 1)) / r)))}/>; }}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 10, fontSize: 13.5 }}>{rows.map(r =>
        <span key={r.k} title={r.l} style={{ display: "inline-flex", alignItems: "center", gap: 3, color: hot(r) ? r.c : "var(--muted)" }}>
          <r.ico s={13}/>{r.s && <span style={{ fontSize: 10, fontWeight: 900 }}>{r.s}</span>}<span style={tempGrad(r)}>{Math.round(r.v || 0)}°</span></span>)}</span>}>
      {({ W, H }) => {
        // des thermometres en verre (par defaut), des cadrans en cartes, des jauges, sinon des lignes
        if (!o.style || o.style === "glass") { const gl = glass(W, H); if (gl) return gl; }
        if (o.style === "thermo") { const th = thermo(W, H); if (th) return th; }
        const g = fitGrid(rows.length, W, H, { ar: GAUGE_AR, extra: GAUGE_EXTRA, gap: 8 });
        if (o.style === "gauges" && g.size >= 50) return gauges(W, H);
        return H >= rows.length * 22 ? lines : cells(W, H);
      }}
    </Tile>
  );
}
const statsH3 = W => statsH(3, W);
// le mois : le compte (le mois est dit dans la tuile meme : titre masque, on sait de quoi on parle),
// la reussite, l'ecart avec le mois dernier, les chiffres du mois et les barres par jour
const MONTH_METRICS = [["count", "Impressions", x => String(Math.round(x || 0))], ["duration", "Heures", fmtH], ["weight_g", "Poids", fmtG], ["cost", "Coût", fmtEur]];
function monthFigures(days, nd) {
  if (!days || !days.length) return null;
  const best = days.reduce((b, x) => !b || (x.count || 0) > (b.count || 0) ? x : b, null);
  let streak = 0;
  for (let k = days.length - 1; k >= 0 && days[k].count; k--) streak++;
  return { best, active: days.filter(x => x.count).length, perDay: days.reduce((a, x) => a + (x.count || 0), 0) / nd, streak };
}
function Month({ v, o, sz }) {
  const name = new Date().toLocaleDateString("fr-FR", { month: "long" });
  const nd = new Date().getDate();
  const days = useDays(o.chart ? nd : 0);
  const rate = v?.count ? (v.ok ?? v.count) / v.count : null;
  const chart = (W, H) => days && days.length > 1 && <Bars values={days.map(x => x.count || 0)} color="#6366F1" height={Math.max(12, H - (H >= 60 ? 15 : 0))}
    hi={days.length - 1} labels={H >= 60 ? days.map(x => x.day.getDate() % 5 === 0 || x.day.getDate() === 1 ? String(x.day.getDate()) : "") : null}
    titles={days.map(x => `${x.day.getDate()} ${name} : ${x.count || 0}`)}/>;
  const sub = v && [fmtG(v.weight_g), fmtH(v.duration), o.cost && fmtEur(v.cost)].filter(Boolean).join(" · ");
  const hero = <Hero fill={false} value={v ? v.count : "…"} unit={`impression${v?.count > 1 ? "s" : ""} en ${name}`} sub={sub} accent={["#4F46E5", "#A855F7"]}
    visual={o.ring !== false && rate != null ? s => <Ring value={rate} size={s} color={rateColor(rate)} cap="réussies">{Math.round(rate * 100)}%</Ring> : null}
    delta={o.compare && v?.prev && <Delta now={v.count} before={v.prev.count} label="le mois dernier"/>}/>;
  return (
    <Tile icon={<CalendarDays size={15}/>} color="#6366F1" label={`En ${name}`} to="/stats?tab=prints"
      mini={sz.h === 0.5} summary={<>{v ? v.count : "…"}<span style={{ fontSize: 12, color: "var(--muted)" }}>en {name}</span>{o.compare && v?.prev && <Delta now={v.count} before={v.prev.count}/>}</>}
      zoom={<MonthZoom v={v} name={name} hero={hero} rate={rate}/>}>
      {({ W, H }) => {
        const hh = Math.min(H, 72);
        // haute : des chiffres du mois entre le compte et les barres
        const f = monthFigures(days, nd);
        const items = f && [["Par jour", String(Math.round(f.perDay * 10) / 10).replace(".", ",")],
          ["Meilleur jour", f.best?.count ? `${f.best.day.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · ${f.best.count}` : "—"], ["Jours actifs", `${f.active} / ${nd}`]];
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
// la fenetre du mois : face au mois dernier, les chiffres du mois, les barres au choix, les plus longues
function MonthZoom({ v, name, hero, rate }) {
  const nd = new Date().getDate();
  const days = useDays(nd);
  const [metric, setMetric] = useState("count");
  const [longest, setLongest] = useState(null);
  const { W } = useBox();
  useEffect(() => {
    const m0 = new Date(); m0.setDate(1);
    // tout le mois, trie ici par la duree de chaque impression : le tri « duree » du serveur classe les
    // groupes par leur total et rend tous leurs membres (d'ou des impressions courtes en tete)
    client.get("/prints", { params: { date_from: ymd(m0), limit: 200 } })
      .then(({ data }) => setLongest((data?.prints || data?.items || []).filter(x => x.status !== "IN_PROGRESS")
        .sort((a, b) => (b.duration_seconds || b.estimated_seconds || 0) - (a.duration_seconds || a.estimated_seconds || 0)).slice(0, 6))).catch(() => setLongest([]));
  }, []);
  const f = monthFigures(days, nd);
  const m = MONTH_METRICS.find(x => x[0] === metric);
  const chip = on => ({ height: 28, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 12, border: "1px solid var(--border)",
    background: on ? "#6366F1" : "var(--surface2)", color: on ? "#fff" : "var(--text2)", whiteSpace: "nowrap" });
  return <>
    {hero}
    {v?.prev && <Versus color="#6366F1" a={`en ${name}`} b="à la même date le mois dernier" rows={[["Impressions", v.count, v.prev.count, x => x || 0],
      ["Réussies", v.ok, v.prev.ok, x => x || 0], ["Poids", v.weight_g, v.prev.weight_g, fmtG], ["Machine", v.duration, v.prev.duration, fmtH], ["Coût", v.cost, v.prev.cost, fmtEur]]}/>}
    {f && <Stats items={[["Par jour", String(Math.round(f.perDay * 10) / 10).replace(".", ",")],
      ["Meilleur jour", f.best?.count ? `${f.best.day.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · ${f.best.count}` : "—"],
      ["Jours actifs", `${f.active} / ${nd}`], ["Série en cours", `${f.streak} j`],
      rate != null && ["Réussite", `${Math.round(rate * 100)} %`, rateColor(rate)], v?.failed ? ["Ratées", v.failed, "#dc2626"] : null,
      v?.count ? ["Coût moyen", fmtEur(v.cost / v.count)] : null, v?.count ? ["Durée moyenne", fmtH(v.duration / v.count)] : null].filter(Boolean)}/>}
    <H2>Par jour</H2>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{MONTH_METRICS.map(([k, l]) => <button key={k} type="button" style={chip(metric === k)} onClick={() => setMetric(k)}>{l}</button>)}</div>
    {days ? <Bars values={days.map(x => x[m[0]] || 0)} color="#6366F1" height={zoomChartH(W)} hi={days.length - 1} showValues={W / days.length >= 26} fmt={m[2]}
      labels={days.map(x => String(x.day.getDate()))} titles={days.map(x => `${x.day.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} : ${m[2](x[m[0]])}`)}/> : <Muted>…</Muted>}
    {longest?.length > 0 && <><H2>Les plus longues du mois</H2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{longest.map(x => <Item key={x.id} img={printImg(x.id)} size={44}
        dot={okOf(x) ? "#22c55e" : "#ef4444"} title={x.file_name || x.translated_name} sub={[fmtH(x.duration_seconds || x.estimated_seconds), fmtG(x.total_weight_g), fmtEur(x.total_cost)].join(" · ")}/>)}</div></>}
  </>;
}
// objets et ventes : un anneau vendus / a vendre, le chiffre et la marge ; ce mois-ci, les recettes sur douze mois
const SALE_C = "#EC4899";
const monthShort = ym => new Date(`${ym}-15T12:00:00`).toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
function Sales({ v, o, sz }) {
  if (!v || !v.total) return null;
  const share = (v.total_sold ?? v.sold ?? 0) / Math.max(1, (v.total_sold ?? v.sold ?? 0) + (v.available || 0));
  const sold = v.total_sold ?? v.sold;
  const sub = [`${sold} vendu${sold > 1 ? "s" : ""}`, o.revenue && `${Math.round(v.revenue || 0)} €`,
    o.margin && `marge ${Math.round(v.margin || 0)} €${v.margin_pct ? ` (${Math.round(v.margin_pct)} %)` : ""}`].filter(Boolean).join(" · ");
  const heroOf = W => <Hero visual={o.ring ? s => <Ring value={share} size={s} color={SALE_C} cap="vendus">{sold}</Ring> : null} value={v.available} unit="à vendre"
    sub={W >= 260 ? sub : null} accent={["#DB2777", "#F472B6"]}/>;
  const hero = heroOf(600);
  // etroite : les chiffres en pastilles plutot qu'une phrase coupee
  const chips = <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
    {[[`${sold} vendu${sold > 1 ? "s" : ""}`, SALE_C], o.revenue && [fmtEur(v.revenue), "#16a34a"], o.margin && [`marge ${fmtEur(v.margin)}`, "#8B5CF6"]].filter(Boolean)
      .map(([t, c]) => <span key={t} style={{ fontSize: 11, fontWeight: 800, color: c, padding: "2px 8px", borderRadius: 10, background: `${c}1c`, whiteSpace: "nowrap" }}>{t}</span>)}</div>;
  const tm = v.this_month;
  const monthLine = tm && <div data-pk="" style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
    {new Date().toLocaleDateString("fr-FR", { month: "long" })} : {tm.count ? <><b style={{ color: SALE_C }}>{tm.count} vente{tm.count > 1 ? "s" : ""}</b> · {fmtEur(tm.revenue)} · marge {fmtEur(tm.margin)}</> : "aucune vente pour l'instant"}</div>;
  const months = v.by_month || [];
  const chart = h => months.some(x => x.revenue) && <Bars values={months.map(x => x.revenue)} color={SALE_C} height={h} hi={months.length - 1}
    labels={h >= 50 ? months.map((x, k) => k % 2 === months.length % 2 ? monthShort(x.month) : "") : null}
    titles={months.map(x => `${monthShort(x.month)} : ${x.count} vente${x.count > 1 ? "s" : ""} · ${fmtEur(x.revenue)}`)}/>;
  return (
    <Tile icon={<ShoppingBag size={15}/>} color={SALE_C} label="Objets et ventes" to="/objects"
      mini={sz.h === 0.5} summary={<>{v.available}<span style={{ fontSize: 12, color: "var(--muted)" }}>à vendre · {sold} vendus</span></>}
      zoom={<SalesZoom v={v} hero={hero}/>}>
      {({ W, H }) => {
        // haute : le mois, les recettes sur douze mois, les chiffres en cases
        const items = [o.revenue && ["Chiffre d'affaires", fmtEur(v.revenue)], o.margin && ["Marge", fmtEur(v.margin)],
          o.potential && ["Valeur du stock", fmtEur(v.potential_value)]].filter(Boolean);
        const showMonth = o.month !== false && tm && H >= 110;
        const ch = o.chart !== false && months.some(x => x.revenue) ? Math.min(140, H - 120 - (showMonth ? 22 : 0) - (H >= 260 ? statsH(items.length, W) + 8 : 0)) : 0;
        return <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
          <BoxCtx.Provider value={{ W, H: Math.min(H - (showMonth ? 22 : 0) - (ch >= 30 ? ch + 8 : 0) - (H >= 260 ? statsH(items.length, W) + 8 : 0) - (W < 260 ? 30 : 0), 96) }}>{heroOf(W)}</BoxCtx.Provider>
          {W < 260 && chips}
          {showMonth && monthLine}
          {ch >= 30 && <div style={{ marginTop: "auto" }}>{chart(ch)}</div>}
          {H >= 260 && items.length > 0 && <Stats items={items}/>}
        </div>;
      }}
    </Tile>
  );
}
// la fenetre des ventes : l'inventaire, les ventes dans le temps, les meilleures, les dernieres, les accessoires
function SalesZoom({ v, hero }) {
  const { W } = useBox();
  const [metric, setMetric] = useState("revenue");
  const nav = useNavigate();
  const months = v.by_month || [];
  const card = (l, x, color = "var(--text)") => <div key={l} className="card-sm" style={{ padding: 10 }}><Muted>{l}</Muted>
    <div style={{ fontSize: 18, fontWeight: 900, color, whiteSpace: "nowrap" }}>{x ?? "—"}</div></div>;
  const chip = on => ({ height: 28, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 12, border: "1px solid var(--border)",
    background: on ? SALE_C : "var(--surface2)", color: on ? "#fff" : "var(--text2)", whiteSpace: "nowrap" });
  const fm = metric === "count" ? (x => String(x || 0)) : (x => `${Math.round(x || 0)} €`);
  const split = (v.state_split || []).filter(x => x.value > 0);
  const SPLIT_C = { "À vendre": SALE_C, "Vendus": "#22c55e", "Offerts": "#f59e0b", "Perso": "#6366f1", "Indisponibles": "#94a3b8" };
  const tot = split.reduce((t, x) => t + x.value, 0) || 1;
  const objRow = (x, right, sub) => <div key={x.id} onClick={e => { e.stopPropagation(); nav(`/objects?id=${x.id}`); }} style={{ display: "flex", alignItems: "center", gap: 10,
    padding: 6, borderRadius: 11, background: "var(--surface2)", cursor: "pointer", minWidth: 0 }}>
    <img src={apiThumb(apiUrl(`/objects/objects/${x.id}/image`), 256)} alt="" loading="lazy" decoding="async" onError={e => { e.currentTarget.style.visibility = "hidden"; }}
      style={{ width: 40, height: 40, borderRadius: 9, objectFit: "cover", flexShrink: 0, background: "var(--surface)" }}/>
    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</div>
      {sub && <Muted size={11.5}>{sub}</Muted>}</div>{right}</div>;
  return <>
    {hero}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
      {card("Objets", v.total)}{card("À vendre", v.available, SALE_C)}{card("Vendus", v.total_sold ?? v.sold, "#16a34a")}
      {card("Chiffre d'affaires", fmtEur(v.revenue))}{card("Marge", `${fmtEur(v.margin)}${v.margin_pct ? ` · ${Math.round(v.margin_pct)} %` : ""}`, v.margin >= 0 ? "#16a34a" : "#dc2626")}
      {card("Coût du stock", fmtEur(v.stock_cost))}{card("Valeur du stock", fmtEur(v.potential_value))}{card("Coût moyen d'un objet", fmtEur(v.avg_cost))}
      {v.gifted > 0 && card(`Offerts (${v.gifted})`, fmtEur(v.cost_gifted), "#d97706")}{v.personal > 0 && card(`Gardés (${v.personal})`, fmtEur(v.cost_personal), "#6366f1")}
    </div>
    {split.length > 0 && <><H2>Où en sont les objets</H2>
      <div style={{ display: "flex", height: 14, borderRadius: 8, overflow: "hidden" }}>{split.map(x => <span key={x.name} title={`${x.name} : ${x.value}`}
        style={{ width: `${x.value / tot * 100}%`, background: SPLIT_C[x.name] || "#94a3b8" }}/>)}</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>{split.map(x => <span key={x.name}
        style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: SPLIT_C[x.name] || "#94a3b8" }}/>{x.name} <b>{x.value}</b></span>)}</div></>}
    {months.length > 0 && <><H2>Ventes sur douze mois</H2>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{[["revenue", "Recettes"], ["margin", "Marge"], ["count", "Nombre"]].map(([k, l]) =>
        <button key={k} type="button" style={chip(metric === k)} onClick={() => setMetric(k)}>{l}</button>)}</div>
      <Bars values={months.map(x => Math.max(0, x[metric] || 0))} color={SALE_C} height={zoomChartH(W)} hi={months.length - 1} showValues={W / 12 >= 40} fmt={fm}
        labels={months.map(x => monthShort(x.month))} titles={months.map(x => `${monthShort(x.month)} : ${x.count} vente${x.count > 1 ? "s" : ""} · ${fmtEur(x.revenue)} · marge ${fmtEur(x.margin)}`)}/></>}
    {v.recent_sales?.length > 0 && <><H2>Dernières ventes</H2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{v.recent_sales.map(x => objRow(x,
        <div style={{ textAlign: "right", flexShrink: 0 }}><b style={{ fontSize: 13.5, color: "var(--text)" }}>{fmtEur(x.price)}</b>
          <div style={{ fontSize: 11, fontWeight: 800, color: x.margin >= 0 ? "#16a34a" : "#dc2626" }}>{x.margin >= 0 ? "+" : ""}{fmtEur(x.margin)}</div></div>,
        new Date(x.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })))}</div></>}
    {v.top_margin?.length > 0 && <><H2>Les meilleures marges</H2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{v.top_margin.map(x => objRow(x,
        <b style={{ fontSize: 13.5, color: "#16a34a", flexShrink: 0 }}>+{fmtEur(x.margin)}</b>, `vendu ${fmtEur(x.sold_price)}`))}</div></>}
    {v.top_margin_pct?.length > 0 && <><H2>Les meilleurs rendements</H2>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{v.top_margin_pct.map(x => objRow(x,
        <b style={{ fontSize: 13.5, color: "#16a34a", flexShrink: 0 }}>{Math.round(x.margin_pct)} %</b>, `coût ${fmtEur(x.cost)} · vendu ${fmtEur(x.sold_price)}`))}</div></>}
    {v.accessories?.count > 0 && <><H2>Accessoires</H2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        {card("En stock", `${v.accessories.stock_units} · ${fmtEur(v.accessories.stock_value)}`)}{card("Utilisés", `${v.accessories.used_units} · ${fmtEur(v.accessories.used_value)}`)}
        {v.accessories.out_of_stock > 0 && card("En rupture", v.accessories.out_of_stock, "#dc2626")}</div>
      {v.accessories.out_of_stock_names?.length > 0 && <Muted size={12}>À racheter : {v.accessories.out_of_stock_names.join(", ")}</Muted>}</>}
  </>;
}
// le fil : autant de lignes que la hauteur en tient ; en grand, tout le fil du jour
const FEED_SECTIONS = { all: null, prints: ["prints", "printer"], spools: ["spools", "dry"], mw: ["mw"], friends: ["friends"] };
const FEED_CHIPS = [["all", "Tout", "#0EA5E9"], ["prints", "Impressions", "#3B82F6"], ["spools", "Bobines et séchage", "#F59E0B"], ["mw", "MakerWorld", "#14B8A6"], ["friends", "Copains", "#8B5CF6"]];
// une ligne du fil : l'heure, l'icone dans un carre de la couleur de sa rubrique, le titre (et son detail), le point « non lu »
function FeedRow({ x, h = 40, detail, narrow, time = true, nav, big = false }) {
  const sw = String(x.image || "").startsWith("color:") ? x.image.slice(6).split(",")[0] : null;
  const col = x.section_color || "#64748B";
  const t = new Date(x.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const sq = Math.max(22, Math.min(big ? 38 : 32, h - 10));
  const msg = String(x.message || "").split("\n")[0];
  return <div data-tip={`${noEmoji(x.title)}${msg ? `\n${msg}` : ""}\n${t}`} onClick={e => { if (x.link) { e.stopPropagation(); nav(x.link); } }}
    style={{ display: "flex", gap: 9, alignItems: "center", minHeight: h, padding: "0 8px 0 4px", borderRadius: 12, cursor: x.link ? "pointer" : undefined,
      background: x.seen ? "transparent" : `linear-gradient(90deg, ${col}1c, transparent 75%)` }}>
    {time && !narrow && <span data-pk="" style={{ width: 38, flexShrink: 0, fontSize: 11, fontWeight: 700, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{t}</span>}
    <span data-pk="" style={{ width: sq, height: sq, borderRadius: sq * 0.3, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: sq * 0.5, background: sw ? hexCss(sw) : `${col}26`, boxShadow: sw ? "inset 0 0 0 1px rgba(0,0,0,0.15)" : `inset 0 0 0 1px ${col}55` }}>{sw ? "" : x.section_emoji}</span>
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: "block", fontSize: big ? 13.5 : 12.5, color: "var(--text)", fontWeight: x.seen ? 700 : 900,
        ...(narrow ? { ...clamp(2), lineHeight: 1.2 } : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }) }}><W text={noEmoji(x.title)}/></span>
      {narrow && time && <span style={{ display: "block", fontSize: 10.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{t}</span>}
      {detail && msg && <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{msg}</span>}
    </span>
    {!x.seen && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", flexShrink: 0, boxShadow: "0 0 0 3px rgba(59,130,246,0.2)" }}/>}
  </div>;
}
function Feed({ f, o, sz }) {
  const nav = useNavigate();
  if (!f) return null;
  const want = FEED_SECTIONS[o.section || "all"];
  const all = (f.items || []).filter(x => !want || want.includes(x.section));
  const fresh = all.filter(x => !x.seen).length;
  return (
    <Tile icon={<Rss size={15}/>} color="#0EA5E9" label="Le fil du jour" to="/notifications"
      badge={fresh ? <span style={{ fontSize: 11, fontWeight: 900, color: "#fff", background: "#3b82f6", borderRadius: 20, padding: "1px 7px" }}>{fresh}</span> : null}
      mini={sz.h === 0.5} summary={!all.length ? <span style={{ fontSize: 12.5, color: "var(--muted)" }}>rien de neuf</span>
        : <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, minWidth: 0 }}>
          {fresh > 0 && <span style={{ fontSize: 11, fontWeight: 900, color: "#fff", background: "#3b82f6", borderRadius: 20, padding: "1px 7px" }}>{fresh}</span>}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{noEmoji(all[0].title)}</span></span>}
      zoom={<FeedZoom f={f} section={o.section || "all"}/>}>
      {({ W, H }) => {
        if (!all.length) return <Empty>Rien de neuf aujourd'hui.</Empty>;
        const narrow = W < 215;
        const cap = o.count === "auto" || !o.count ? 99 : o.count;
        // l'en-tete quand il y a la hauteur : combien aujourd'hui, combien de non lus
        const hh = H >= 150 ? 32 : 0;
        const minH = narrow ? 46 : 34;
        let room = H - hh;
        let n = Math.min(cap, all.length, Math.max(1, Math.floor((room + 4) / (minH + 4))));
        // ce qui ne tient pas se compte en « +n plus tot » : sa ligne prend sa place
        if (n < all.length) { room -= 22; n = Math.max(1, Math.min(n, Math.floor((room + 4) / (minH + 4)))); }
        // peu de lignes pour la place : elles grandissent, et le detail s'ecrit dessous
        const h = Math.max(minH, Math.min(narrow ? 60 : 56, Math.floor((room - 4 * (n - 1)) / n)));
        const detail = o.detail !== false && !narrow && W >= 280 && h >= 46;
        return <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
          {hh > 0 && <div style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap", overflow: "hidden", height: 26, flexShrink: 0 }}>
            <span data-pk="" style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.05, ...gradText("#0284C7", "#22D3EE") }}>{all.length}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>aujourd'hui</span>
            {fresh > 0 && <span style={{ fontSize: 11.5, fontWeight: 800, color: "#3b82f6" }}>· {fresh}{narrow ? "" : ` non lu${fresh > 1 ? "s" : ""}`}</span>}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minHeight: 0 }}>
            {all.slice(0, n).map(x => <FeedRow key={x.id} x={x} h={h} detail={detail} narrow={narrow} time={o.time} nav={nav}/>)}
            {all.length > n && <span style={{ fontSize: 11, fontWeight: 800, color: "#0284c7", paddingLeft: 8, height: 14, lineHeight: "14px" }}>+{all.length - n} plus tôt</span>}
          </div>
        </div>;
      }}
    </Tile>
  );
}
// la fenetre du fil : les chiffres, une pastille par rubrique pour filtrer, puis la journee heure par heure
function FeedZoom({ f, section }) {
  const nav = useNavigate();
  const [sec, setSec] = useState(section);
  const items = f.items || [];
  const want = FEED_SECTIONS[sec];
  const list = items.filter(x => !want || want.includes(x.section));
  const count = k => items.filter(x => !FEED_SECTIONS[k] || FEED_SECTIONS[k].includes(x.section)).length;
  const chip = (on, c) => ({ height: 28, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 12, border: "1px solid var(--border)",
    background: on ? c : "var(--surface2)", color: on ? "#fff" : "var(--text2)", whiteSpace: "nowrap" });
  // par tranche horaire : matin, apres-midi, soir, nuit
  const slot = x => { const h = new Date(x.time).getHours(); return h < 6 ? "Cette nuit" : h < 12 ? "Ce matin" : h < 18 ? "Cet après-midi" : "Ce soir"; };
  const groups = list.reduce((m, x) => { const k = slot(x); (m[k] = m[k] || []).push(x); return m; }, {});
  if (!items.length) return <Muted>Rien de neuf aujourd'hui.</Muted>;
  return <>
    <Stats items={[["Aujourd'hui", items.length, "#0284C7"], ["Non lus", items.filter(x => !x.seen).length, "#3b82f6"],
      ...FEED_CHIPS.slice(1).map(([k, l, c]) => count(k) ? [l, count(k), c] : null)].filter(Boolean)}/>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {FEED_CHIPS.filter(([k]) => k === "all" || count(k)).map(([k, l, c]) => <button key={k} type="button" style={chip(sec === k, c)} onClick={() => setSec(k)}>
        {l} ({count(k)})</button>)}</div>
    {!list.length ? <Muted>Rien dans cette rubrique aujourd'hui.</Muted> : Object.entries(groups).map(([k, xs]) => <div key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <H2>{k}</H2>{xs.map(x => <FeedRow key={x.id} x={x} h={48} detail narrow={false} nav={nav} big/>)}</div>)}
  </>;
}
// la galerie : des vignettes qui remplissent exactement la case
// une mosaique qui remplit une case : la grille (colonnes x rangees) aux cases les plus grandes et les plus
// carrees ; avec de la place, la premiere en grand (2 x 2)
function mosaic(n, W, H, gap = 6) {
  let best = null;
  for (let c = 1; c <= n; c++) for (const big of [false, true]) {
    const r0 = Math.ceil((n + (big ? 3 : 0)) / c);
    if (big && (c < 3 || r0 < 2)) continue;
    const cw = (W - gap * (c - 1)) / c, ch = (H - gap * (r0 - 1)) / r0;
    if (cw < 34 || ch < 34) continue;
    const ar = cw / ch, score = Math.min(cw, ch) * (ar > 1.6 || ar < 0.65 ? 0.55 : 1) * (big ? 1.08 : 1);
    if (!best || score > best.score) best = { c, r: r0, big, score, cell: Math.min(cw, ch), cw, ch };
  }
  return best || { c: Math.max(1, Math.floor((W + gap) / 40)), r: 1, big: false, cell: 34, cw: 34, ch: 34 };
}
// la grille d'une mosaique : des cases qui remplissent, sauf si elles deviendraient trop plates ou trop hautes
// (une seule image dans une tuile large et basse : un bandeau recadre) ; alors carrees, au centre
function mosaicGrid(m) {
  const wide = m.cw / m.ch > 1.35, tall = m.ch / m.cw > 1.35;
  return { gridTemplateColumns: wide ? `repeat(${m.c}, ${Math.floor(m.ch)}px)` : `repeat(${m.c}, minmax(0, 1fr))`,
    gridTemplateRows: tall ? `repeat(${m.r}, ${Math.floor(m.cw)}px)` : `repeat(${m.r}, minmax(0, 1fr))`,
    justifyContent: wide ? "center" : undefined, alignContent: tall ? "center" : undefined };
}
// la fenetre de la galerie : les chiffres, un filtre (toutes, reussies, ratees), puis chaque impression en carte
function GalleryZoom({ all, nav }) {
  const [only, setOnly] = useState("all");
  const ok = all.filter(okOf).length;
  const list = all.filter(p => only === "all" || (only === "ok") === okOf(p));
  const chip = (on, c) => ({ height: 28, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 12, border: "1px solid var(--border)",
    background: on ? c : "var(--surface2)", color: on ? "#fff" : "var(--text2)", whiteSpace: "nowrap" });
  const kg = all.reduce((t, p) => t + (p.total_weight_g || 0), 0), sec = all.reduce((t, p) => t + (p.duration_seconds || 0), 0);
  return <>
    <Stats items={[["Impressions", all.length, "#14B8A6"], ["Réussies", ok, "#16a34a"], all.length - ok ? ["Ratées", all.length - ok, "#dc2626"] : null,
      kg ? ["Poids", fmtG(kg), "#F59E0B"] : null, sec ? ["Machine", fmtH(sec), "#8B5CF6"] : null].filter(Boolean)}/>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <button type="button" style={chip(only === "all", "#14B8A6")} onClick={() => setOnly("all")}>Toutes ({all.length})</button>
      <button type="button" style={chip(only === "ok", "#16a34a")} onClick={() => setOnly("ok")}>Réussies ({ok})</button>
      {all.length - ok > 0 && <button type="button" style={chip(only === "ko", "#dc2626")} onClick={() => setOnly("ko")}>Ratées ({all.length - ok})</button>}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
      {list.map(p => { const good = okOf(p), name = p.file_name || p.translated_name || `Impression #${p.id}`;
        return <div key={p.id} onClick={() => nav(`/prints?id=${p.id}`)} style={{ position: "relative", aspectRatio: "1", borderRadius: 16, overflow: "hidden", cursor: "pointer",
          background: "linear-gradient(135deg, rgba(20,184,166,0.12), var(--surface2))", boxShadow: good ? "inset 0 0 0 1px var(--border)" : "inset 0 0 0 2px rgba(239,68,68,0.6)" }}>
          <img src={printImg(p.id)} alt="" onError={e => { e.currentTarget.style.visibility = "hidden"; }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}/>
          <span style={{ position: "absolute", top: 8, right: 8, fontSize: 10.5, fontWeight: 900, color: "#fff", padding: "1px 7px", borderRadius: 9,
            background: good ? "#16a34a" : "#dc2626" }}>{good ? "réussie" : "ratée"}</span>
          <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "22px 10px 8px", background: "linear-gradient(to top, rgba(0,0,0,0.72), transparent)",
            display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.8)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {[p.print_date && utc(p.print_date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }), p.duration_seconds && fmtDur(p.duration_seconds),
                p.total_weight_g && fmtG(p.total_weight_g)].filter(Boolean).join(" · ")}</span></span>
        </div>; })}</div>
  </>;
}
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
      zoom={<GalleryZoom all={all} nav={nav}/>}>
      {({ W, H }) => {
        // une mosaique qui remplit toute la tuile : la grille (colonnes x rangees) dont les cases sont les plus
        // grandes et les plus carrees ; avec de la place, la derniere impression en grand (2 x 2)
        const n = Math.min(all.length, o.count || 8), gap = 6;
        const best = mosaic(n, W, H, gap);
        const cap = best.c * best.r - (best.big ? 3 : 0);
        const list = all.slice(0, Math.min(n, cap));
        const tile = (p, k) => { const ok = okOf(p), big = best.big && k === 0, name = p.file_name || p.translated_name || "";
          const showName = (big ? best.cell * 2 : best.cell) >= 96;
          return <div key={p.id} data-tip={`${name}${p.print_date ? `\n${utc(p.print_date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}${ok ? "" : "\nratée"}`}
            onClick={e => { e.stopPropagation(); nav(`/prints?id=${p.id}`); }}
            style={{ position: "relative", minWidth: 0, minHeight: 0, overflow: "hidden", cursor: "pointer", borderRadius: o.round ? "50%" : 12,
              background: "linear-gradient(135deg, rgba(20,184,166,0.10), var(--surface2))", gridColumn: big ? "span 2" : undefined, gridRow: big ? "span 2" : undefined,
              boxShadow: ok ? "inset 0 0 0 1px var(--border)" : "inset 0 0 0 2px rgba(239,68,68,0.6)" }}>
            <img data-pk="" src={printImg(p.id)} alt="" onError={e => { e.currentTarget.style.visibility = "hidden"; }}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
            {showName && !o.round && <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "14px 8px 5px", fontSize: big ? 12.5 : 10.5, fontWeight: 800,
              color: "#fff", background: "linear-gradient(to top, rgba(0,0,0,0.65), transparent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>}
            {!o.round && <span style={{ position: "absolute", top: 6, right: 6, width: 9, height: 9, borderRadius: "50%", background: ok ? "#22c55e" : "#ef4444",
              boxShadow: "0 0 0 2px rgba(255,255,255,0.85)" }}/>}
          </div>; };
        return <div style={{ flex: 1, display: "grid", gap, ...mosaicGrid(best), minHeight: 0 }}>{list.map(tile)}</div>;
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
// le classement des copains : rangs, grades, scores, ecarts ; en grand, le podium, le detail, les sections, les medailles
const POD = ["#D4A017", "#94A3B8", "#B45309"];
const POD_HI = ["#FDE68A", "#E2E8F0", "#FDBA74"];
const POD3 = POD, POD_HI3 = POD_HI;
const AV_COLORS = ["#8B5CF6", "#0EA5E9", "#14B8A6", "#F97316", "#EC4899", "#6366F1", "#22C55E"];
const avColor = name => AV_COLORS[[...(name || "?")].reduce((t, c) => t + c.charCodeAt(0), 0) % AV_COLORS.length];
const PodAvatar = ({ x, size = 30, ring = null }) => <span style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "inline-flex",
  alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 900, color: "#fff",
  background: `linear-gradient(135deg, ${avColor(x.name)}, color-mix(in srgb, ${avColor(x.name)} 60%, #000000))`,
  boxShadow: ring ? `0 0 0 2px var(--surface), 0 0 0 4px ${ring}` : "none" }}>{x.me ? "★" : (x.name || "?").slice(0, 1).toUpperCase()}</span>;
const podName = x => (x.me ? "Toi" : x.name);
const podGrade = x => gradeOf(null, x.score_max ? (x.score || 0) / x.score_max : 0);
const fmtN = n => Math.round(n || 0).toLocaleString("fr-FR");
// les marches : 2e, 1er, 3e ; chacun avec son avatar, son grade, son score
// places : 3, ou 4 (une 4e marche, violette, a droite du 3e)
function PodiumSteps({ people, H, big = false, places = 3 }) {
  const list = people.slice(0, places), order = [list[1], list[0], list[2], list[3]].filter(Boolean), hs = { 0: 1, 1: 0.7, 2: 0.48, 3: 0.32 };
  const POD = [...POD3, "#8B5CF6"], POD_HI = [...POD_HI3, "#C4B5FD"];
  const four = order.length > 3;
  const av = big ? 48 : Math.max(20, Math.min(four ? 28 : 34, H * 0.2));
  const step = Math.max(26, H - av - (big ? 64 : 30));
  return <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: big ? 12 : four ? 4 : 6, flex: 1 }}>
    {order.map(x => { const r = list.indexOf(x), g = podGrade(x);
      return <div key={x.id || x.name} style={{ flex: 1, maxWidth: big ? 150 : 110, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 0 }}>
        <span style={{ position: "relative", display: "inline-flex" }}>
          <PodAvatar x={x} size={av} ring={POD[r]}/>
          {r === 0 && <span style={{ position: "absolute", top: -av * 0.42, left: "50%", transform: "translateX(-50%)", fontSize: av * 0.5 }}>👑</span>}
        </span>
        <span style={{ fontSize: big ? 14 : four ? 10.5 : 11.5, fontWeight: 900, color: "var(--text)", maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{podName(x)}</span>
        {big && g.name && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
          <GradeEmblem i={Math.max(0, g.i)} size={16}/>{g.name}</span>}
        <div data-pk="" style={{ width: "100%", height: Math.round(hs[r] * step), borderRadius: "10px 10px 0 0", position: "relative", overflow: "hidden",
          background: `linear-gradient(180deg, ${POD_HI[r]}, ${POD[r]})`, boxShadow: `0 8px 20px ${POD[r]}55`,
          // marche basse (tuile d'une rangee) : le score a cote du rang plutot que dessous, il reste lisible
          display: "flex", flexDirection: big || hs[r] * step >= 46 ? "column" : "row", alignItems: big || hs[r] * step >= 46 ? "center" : "baseline",
          justifyContent: big || hs[r] * step >= 46 ? "flex-start" : "center", gap: 4, flexWrap: "wrap", paddingTop: big ? 8 : 3, color: "#fff" }}>
          <span style={{ fontSize: big ? 28 : 15, fontWeight: 900, lineHeight: 1, textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}>{r + 1}</span>
          {!(big || hs[r] * step >= 46) && <span style={{ fontSize: 10, fontWeight: 800, lineHeight: 1, textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}>{fmtN(x.score)}</span>}
          {(big || hs[r] * step >= 46) && <span style={{ fontSize: big ? 13 : 10.5, fontWeight: 800, marginTop: 2, textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}>{fmtN(x.score)}</span>}
        </div>
      </div>; })}
  </div>;
}
function Podium({ p, a, o, sz }) {
  const people = (p?.people || []).filter(x => x.status === "ok").sort((x, y) => (y.score || 0) - (x.score || 0));
  if (people.length < 2) return null;
  const max = Math.max(1, people[0].score || 0);
  const meI = people.findIndex(x => x.me);
  // en une ligne : le podium garde ses trois scores, la liste le premier
  const top = o.style === "podium"
    ? <span style={{ fontSize: 13, display: "inline-flex", gap: 10, whiteSpace: "nowrap" }}>{people.slice(0, 3).map((x, r) =>
      <span key={x.id || x.name}>{["🥇", "🥈", "🥉"][r]} {podName(x)} <b style={{ ...gradText(`color-mix(in srgb, ${POD[r]} 75%, #000000)`, POD[r]) }}>{fmtN(x.score)}</b></span>)}</span>
    : <span style={{ fontSize: 13 }}>🥇 {podName(people[0])} · {fmtN(people[0].score)}</span>;
  // une ligne : rang (medaille), avatar, nom et grade, score en degrade, barre, ecart avec celui de devant
  // etroite : pas d'avatar (la medaille du rang suffit), le score passe sur la ligne de la barre : le nom a toute la largeur
  const row = (x, r, h, narrow = false) => { const g = podGrade(x), ahead = r > 0 ? (people[r - 1].score || 0) - (x.score || 0) : null, c = POD[r] || "#A855F7";
    const score = <span data-pk="" style={{ fontSize: narrow ? 12 : 13.5, fontWeight: 900, whiteSpace: "nowrap", ...gradText(`color-mix(in srgb, ${c} 75%, #000000)`, c) }}>{fmtN(x.score)}</span>;
    return <div key={x.id || x.name} style={{ display: "flex", alignItems: "center", gap: 8, height: h, padding: "0 6px", borderRadius: 12, minWidth: 0,
      background: x.me ? "linear-gradient(90deg, rgba(168,85,247,0.14), transparent)" : "transparent" }}>
      <span data-pk="" style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11.5, fontWeight: 900, color: r < 3 ? "#fff" : "var(--muted)", background: r < 3 ? `linear-gradient(135deg, ${POD_HI[r]}, ${POD[r]})` : "var(--surface2)" }}>{r + 1}</span>
      {h >= 34 && !narrow && <PodAvatar x={x} size={Math.min(30, h - 8)}/>}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: x.me ? 900 : 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {podName(x)}{h >= 40 && !narrow && g.name && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}> · {g.name}</span>}</span>
          {!narrow && score}</div>
        {(o.bars || narrow) && <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ flex: 1, height: 5, borderRadius: 5, background: "var(--surface2)", overflow: "hidden" }}>
            <div data-pk="" style={{ height: "100%", width: `${Math.round(100 * (x.score || 0) / max)}%`, borderRadius: 5,
              background: x.me ? "linear-gradient(90deg, #A855F7, #EC4899)" : `linear-gradient(90deg, ${c}, ${r < 3 ? POD_HI[r] : "#C4B5FD"})` }}/></div>
          {narrow ? score : ahead != null && h >= 34 && <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap" }}>−{fmtN(ahead)}</span>}</div>}
      </div>
    </div>; };
  return (
    <Tile icon={<MedalIcon size={15}/>} color="#A855F7" label="Classement des copains" to="/stats?tab=achievements"
      mini={sz.h === 0.5} summary={top}
      zoom={<PodiumZoom people={people} a={a} meI={meI}/>}>
      {({ W, H }) => {
        // trop bas pour des marches (tuile d'une ligne) : les trois en rangee, avatar cercle de sa medaille, nom, score
        if (o.style === "podium" && H < 96) { const av = Math.max(20, Math.min(30, H - 6));
          return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-evenly", gap: 6, minWidth: 0 }}>
            {people.slice(0, 3).map((x, r) => <div key={x.id || x.name} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <PodAvatar x={x} size={av} ring={POD[r]}/>
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r + 1}. {podName(x)}</span>
                <span data-pk="" style={{ fontSize: 14, fontWeight: 900, whiteSpace: "nowrap", ...gradText(`color-mix(in srgb, ${POD[r]} 75%, #000000)`, POD_HI[r]) }}>{fmtN(x.score)}</span>
              </div></div>)}</div>; }
        if (o.style === "podium") return <PodiumSteps people={people} H={H}/>;
        if (o.scroll) return <Scroller gap={4}>{people.map((x, r) => row(x, r, 40))}</Scroller>;
        const n = Math.min(people.length, fitRows(H, 30, 4) || 1), h = Math.max(26, Math.min(48, Math.floor((H - 4 * (n - 1)) / n)));
        // le compte est toujours montre (s'il ne tient pas, la derniere ligne est la sienne)
        const shown = people.slice(0, n);
        if (meI >= n && n > 1) shown[n - 1] = people[meI];
        return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
          {shown.map(x => row(x, people.indexOf(x), h, W < 215))}</div>;
      }}
    </Tile>
  );
}
function PodiumZoom({ people, a, meI }) {
  const cats = (a?.categories || []).filter(c => people.some(x => x.cats?.[c.id]?.max));
  const tiers = (a?.tiers || []).filter(t => !String(t.id).startsWith("card_"));
  const me = people[meI];
  return <>
    <div style={{ height: 300, display: "flex" }}><PodiumSteps people={people} H={300} big/></div>
    <H2>Le classement</H2>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{people.map((x, r) => { const g = podGrade(x), pct = x.score_max ? Math.round(100 * x.score / x.score_max) : 0;
      const gap = me && !x.me ? (x.score || 0) - (me.score || 0) : null;
      return <div key={x.id || x.name} className="card-sm" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
        border: x.me ? "1.5px solid #A855F7" : undefined }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900,
          color: r < 3 ? "#fff" : "var(--muted)", background: r < 3 ? `linear-gradient(135deg, ${POD_HI[r]}, ${POD[r]})` : "var(--surface2)" }}>{r + 1}</span>
        <PodAvatar x={x} size={34}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{podName(x)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--muted)", fontWeight: 700, flexWrap: "wrap" }}>
            {g.name && <><GradeEmblem i={Math.max(0, g.i)} size={14}/>{g.name} ·</>} {x.got}/{x.total} succès · {(x.uniques || []).length} médailles uniques</div>
          <div style={{ height: 5, borderRadius: 5, background: "var(--surface2)", overflow: "hidden", marginTop: 4 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: x.me ? "linear-gradient(90deg, #A855F7, #EC4899)" : `linear-gradient(90deg, ${POD[r] || "#A855F7"}, ${POD_HI[r] || "#C4B5FD"})` }}/></div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 900, ...gradText("#7C3AED", "#EC4899") }}>{fmtN(x.score)}</div>
          <Muted size={11}>{pct} % du total</Muted>
          {gap != null && <div style={{ fontSize: 11, fontWeight: 800, color: gap > 0 ? "#dc2626" : "#16a34a" }}>{gap > 0 ? `+${fmtN(gap)} devant toi` : `${fmtN(-gap)} derrière toi`}</div>}
        </div>
      </div>; })}</div>
    {cats.length > 0 && <><H2>Section par section</H2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
        {cats.map(c => { const ranked = [...people].sort((x, y) => (y.cats?.[c.id]?.score || 0) - (x.cats?.[c.id]?.score || 0));
          const cmax = Math.max(1, ...people.map(x => x.cats?.[c.id]?.score || 0));
          return <div key={c.id} className="card-sm" style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 900, fontSize: 13, color: "var(--text)" }}>{c.emoji} {c.name}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#b45309" }}>👑 {podName(ranked[0])}</span></div>
            {ranked.map(x => <div key={x.id || x.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
              <span style={{ width: 54, flexShrink: 0, fontWeight: x.me ? 900 : 700, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{podName(x)}</span>
              <div style={{ flex: 1, height: 6, borderRadius: 6, background: "var(--surface2)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.round(100 * (x.cats?.[c.id]?.score || 0) / cmax)}%`, background: x.me ? "#A855F7" : avColor(x.name) }}/></div>
              <span style={{ width: 40, textAlign: "right", fontWeight: 800, color: "var(--muted)" }}>{fmtN(x.cats?.[c.id]?.score)}</span></div>)}
          </div>; })}</div></>}
    {tiers.length > 0 && <><H2>Les médailles</H2>
      <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "100%" }}>
        <thead><tr><th/>{tiers.map(t => <th key={t.id} title={t.label} style={{ padding: "2px 4px" }}><Medal tier={t} emoji="" size={18}/></th>)}</tr></thead>
        <tbody>{people.map(x => { const sum = id => Object.values(x.cats || {}).reduce((n, c) => n + (c.medals?.[id] || 0), 0);
          return <tr key={x.id || x.name}><td style={{ fontWeight: x.me ? 900 : 700, color: "var(--text2)", paddingRight: 8, whiteSpace: "nowrap" }}>{podName(x)}</td>
            {tiers.map(t => <td key={t.id} style={{ textAlign: "center", fontWeight: 800, color: sum(t.id) ? "var(--text)" : "var(--muted)", padding: "3px 4px" }}>{sum(t.id) || "·"}</td>)}</tr>; })}</tbody>
      </table></div></>}
  </>;
}
// une teinte par categorie (chaudes, distinctes), dans l'ordre ou elles viennent
const ALERT_TINTS = ["#F59E0B", "#EF4444", "#F97316", "#EAB308", "#EC4899", "#8B5CF6", "#0EA5E9", "#14B8A6"];
function Alerts({ a, o, sz }) {
  const cats = (a?.categories || []).filter(c => c.total);
  // la categorie touchee dans la tuile : la fenetre s'ouvre filtree dessus (le clic remonte a la tuile)
  const [pick, setPick] = useState("");
  if (!a) return null;
  const total = cats.reduce((n, c) => n + c.total, 0);
  const top = Math.max(1, ...cats.map(c => c.total));
  const tint = i => ALERT_TINTS[i % ALERT_TINTS.length];
  const head = (W, big) => <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
    <span data-pk="" style={{ fontSize: big ? 30 : 24, fontWeight: 900, lineHeight: 1.05, ...gradText("#D97706", "#EF4444") }}>{total}</span>
    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>à regarder</span>
    {W >= 200 && <Muted size={11.5}>· {cats.length} catégorie{cats.length > 1 ? "s" : ""}</Muted>}</div>;
  // une rangee : l'icone dans un carre teinte, le nom (et des exemples si la place), une barre, le nombre
  const row = (c, i, h, W, ex) => { const col = tint(i), sq = Math.max(20, Math.min(W < 200 ? 24 : 34, h - 6));
    const tip = `${c.label}\n${(c.alerts || []).slice(0, 4).map(x => `${x.title}${x.value ? ` · ${x.value}` : ""}`).join("\n")}`;
    return <div key={c.category} role="button" data-tip={tip} onClick={() => setPick(c.category)}
      style={{ display: "flex", alignItems: "center", gap: 8, height: h, minWidth: 0, cursor: "pointer", padding: "0 8px 0 4px", borderRadius: 12,
        background: `linear-gradient(90deg, ${col}1f, transparent 70%)` }}>
      <span data-pk="" style={{ width: sq, height: sq, borderRadius: sq * 0.3, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: sq * 0.55, background: `${col}26`, boxShadow: `inset 0 0 0 1px ${col}55` }}>{c.icon}</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: h >= 40 ? 13 : 12, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
        {ex && <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {(c.alerts || []).slice(0, 3).map(x => x.title).join(", ")}</span>}</span>
      {W >= 260 && <span style={{ width: Math.min(80, W * 0.22), height: 6, borderRadius: 3, background: "var(--surface2)", overflow: "hidden", flexShrink: 0 }}>
        <span style={{ display: "block", height: "100%", width: `${(100 * c.total) / top}%`, borderRadius: 3, background: col }}/></span>}
      <b data-pk="" style={{ minWidth: 24, textAlign: "center", fontSize: 12, fontWeight: 900, color: "#fff", background: col, borderRadius: 10, padding: "1px 7px",
        flexShrink: 0, boxShadow: `0 2px 6px ${col}55` }}>{c.total}</b>
    </div>; };
  return (
    <Tile icon={<BellRing size={15}/>} color="#F59E0B" label="Alertes"
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 6, fontSize: 13 }}>{cats.length ? cats.map(c => <span key={c.category}
        data-tip={c.label}>{c.icon}<b style={{ color: "#b45309" }}>{c.total}</b></span>) : "rien à signaler"}</span>}
      badge={total ? <span style={{ fontSize: 11, fontWeight: 900, color: "#fff", background: "#f59e0b", borderRadius: 20, padding: "1px 7px" }}>{total}</span> : null}
      zoom={<AllAlertsModal key={pick || "all"} inline initialCat={pick} onChanged={() => window.dispatchEvent(new Event("bn-tiles-reload"))}/>}>
      {({ W, H }) => {
        if (!cats.length) return <div data-egg="calme_plat" data-egg-n="5" style={{ flex: 1, display: "flex" }}><Empty>Rien à signaler.</Empty></div>;
        // icones : une grosse icone par categorie, le nombre en badge, rien d'ecrit
        if (o.style === "icons") {
          const g = fitGrid(cats.length, W, H, { gap: 10, max: 74 });
          const s2 = Math.max(30, g.size);
          return <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${g.cols}, ${s2}px)`, gap: 10, justifyContent: "space-evenly", alignContent: "center" }}>
            {cats.map((c, i) => <span key={c.category} data-pk="" role="button" tabIndex={0} data-tip={`${c.label} : ${c.total}`} onClick={() => setPick(c.category)}
              style={{ position: "relative", width: s2, height: s2, borderRadius: s2 * 0.28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: s2 * 0.5, background: `linear-gradient(135deg, ${tint(i)}38, ${tint(i)}14)`, boxShadow: `inset 0 0 0 1px ${tint(i)}55` }}>
              {c.icon}
              <b style={{ position: "absolute", top: -6, right: -6, minWidth: 20, height: 20, padding: "0 5px", borderRadius: 10, boxSizing: "border-box",
                fontSize: 11.5, lineHeight: "20px", textAlign: "center", color: "#fff", background: tint(i), boxShadow: `0 2px 6px ${tint(i)}80` }}>{c.total}</b>
            </span>)}</div>;
        }
        // rangees (par defaut) : l'en-tete puis une rangee par categorie qui se partagent la hauteur ;
        // hautes et larges, des exemples sous le nom ; trop nombreuses, ce qui tient puis « +n »
        const hh = H >= 110 ? (H >= 240 ? 42 : 34) : 0;
        const room = H - hh - (hh ? 6 : 0);
        const fit = Math.max(1, Math.floor((room + 4) / 28));
        // basse : pas la place d'une rangee par categorie, des pastilles (icone et nombre) cote a cote
        if (fit < cats.length && !hh) return <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 6, alignContent: "center", minWidth: 0 }}>
          {cats.map((c, i) => <span key={c.category} data-pk="" role="button" data-tip={`${c.label} : ${c.total}`} onClick={() => setPick(c.category)}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 4px 0 7px", borderRadius: 14, cursor: "pointer",
              background: `${tint(i)}22`, boxShadow: `inset 0 0 0 1px ${tint(i)}55` }}>
            <span style={{ fontSize: 15 }}>{c.icon}</span>
            {W >= 300 && <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap" }}>{c.label}</span>}
            <b style={{ fontSize: 11.5, fontWeight: 900, color: "#fff", background: tint(i), borderRadius: 10, padding: "1px 7px" }}>{c.total}</b></span>)}</div>;
        const shown = cats.length > fit ? cats.slice(0, fit - 1) : cats;
        const rowH = Math.max(24, Math.min(o.style === "list" || o.detail ? 52 : 44, Math.floor((room - 4 * (shown.length - 1) - (shown.length < cats.length ? 18 : 0)) / shown.length)));
        const ex = rowH >= 44 && W >= 230 && (o.style === "list" || o.detail !== false);
        return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, minHeight: 0 }}>
          {hh > 0 && head(W, H >= 240)}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minHeight: 0 }}>
            {shown.map((c, i) => row(c, i, rowH, W, ex))}
            {shown.length < cats.length && <span style={{ fontSize: 11, fontWeight: 800, color: "#b45309", paddingLeft: 8 }}>
              +{cats.length - shown.length} autre{cats.length - shown.length > 1 ? "s" : ""}</span>}
          </div>
        </div>;
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
  const hero = <Hero visual={s => <Ring value={pct / 100} size={s} color={color}>{pct}%</Ring>} accent={live ? (paused ? ["#D97706", "#FBBF24"] : ["#16A34A", "#4ADE80"]) : null}
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
    <SpoolSVG colors={colors} finish={finishOf(si, t)} size={size} active={live} type={si.multicolor_type}/></span>;
  // les autres bobines du filament en stock (comme la fiche bobine) : leurs ombres decalees derriere, et « +x en stock »
  const more = si.filament_spools > 1 ? si.filament_spools - 1 : 0;
  const moreG = si.filament_stock_g != null && g != null ? Math.max(0, si.filament_stock_g - g) : null;
  const stacked = size => { const k = size / 118;
    return <span style={{ position: "relative", display: "inline-flex", flexShrink: 0, filter: `drop-shadow(0 8px 18px ${color}66)`,
      marginRight: more > 0 ? (more > 1 ? 30 : 18) * k : 0 }}>
      {more > 1 && <span aria-hidden="true" style={{ position: "absolute", top: 10 * k, left: 34 * k, opacity: 0.35 }}>
        <SpoolSVG colors={colors} finish={finishOf(si, t)} size={100 * k} type={si.multicolor_type}/></span>}
      {more > 0 && <span aria-hidden="true" style={{ position: "absolute", top: 5 * k, left: 18 * k, opacity: 0.6 }}>
        <SpoolSVG colors={colors} finish={finishOf(si, t)} size={108 * k} type={si.multicolor_type}/></span>}
      <span data-pk="" style={{ position: "relative", display: "inline-flex" }}><SpoolSVG colors={colors} finish={finishOf(si, t)} size={size} active={live} type={si.multicolor_type}/></span></span>; };
  const chip = (txt, c) => <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 800,
    whiteSpace: "nowrap", color: c, background: `${c}1c` }}>{txt}</span>;
  const ago = iso => { if (!iso) return "—"; const d = Math.round((Date.now() - utc(iso).getTime()) / 86400000); return d <= 0 ? "aujourd'hui" : d === 1 ? "hier" : `il y a ${d} j`; };
  return (
    <Tile icon={<Disc3 size={15}/>} color="#8B5CF6" label="Filament en cours" to="/filaments"
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
        <SpoolDot color={si.color || t.color} colors={si.colors_array} multicolor={si.multicolor_type} finish={finishOf(si, t)} pct={pct} size={22}/>{name}<Muted>{weight}</Muted></span>}
      zoom={<>
        {/* la bobine en vedette, sur un fond de sa couleur */}
        <div style={{ position: "relative", overflow: "hidden", borderRadius: 22, padding: 18, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
          background: `radial-gradient(circle at 15% 50%, ${color}55, transparent 60%), linear-gradient(135deg, ${color}22, transparent 70%), var(--surface2)` }}>
          {stacked(140)}
          <div style={{ flex: "1 1 180px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{chip(slot, "#8B5CF6")}{live && chip("● en cours", "#22c55e")}
              {more > 0 && chip(`🧵 +${more} en stock${moreG ? ` · ${fmtG(moreG)}` : ""}`, "#22C55E")}
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
                pre: <span style={{ width: 14, height: 14, borderRadius: 4, ...(trayBg(t) || { background: color }), border: "1px solid rgba(0,0,0,0.2)" }}/> },
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
export function switchModel(status) {
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
  const ports = [port("A"), port("B")];
  // au repos : la machine n'annonce aucune sortie ; on trace alors les rails droits, en attente
  const rest = !fs.calibrating && ports.every(x => x.out == null);
  // « au repos » ne s'ecrit que si rien n'imprime (sinon le chemin est seulement inconnu)
  const idle = rest && !ports.some(x => x.live);
  return { fs, ports, rest, idle, nz, liveColor, hl: "#22c55e", temp: id => nz.find(n => n.id === id) };
}
// les rails souples de l'aiguillage : chaque entree a son tube jusqu'a sa buse (droit ou croise),
// le filament continu dedans a la couleur de sa bobine ; celui qui imprime en vert, par-dessus, qui avance
// des points a intervalle regulier le long d'un trace (M, L, C absolus) : les pointilles du navigateur
// repartent a zero a chaque jonction de segments et y serraient les points
function dotsAlong(d, step) {
  const t = d.match(/[MLC]|-?[\d.]+/g) || [];
  const pts = [];
  let i = 0, cur = [0, 0];
  while (i < t.length) {
    const c = t[i++], n = () => +t[i++];
    if (c === "M" || c === "L") { cur = [n(), n()]; pts.push(cur); }
    else if (c === "C") {
      const [x1, y1, x2, y2, x, y] = [n(), n(), n(), n(), n(), n()], [x0, y0] = cur;
      for (let k = 1; k <= 24; k++) { const u = k / 24, v = 1 - u;
        pts.push([v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x, v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y]); }
      cur = [x, y];
    }
  }
  const out = [pts[0]];
  let left = step;
  for (let k = 1; k < pts.length; k++) {
    let [ax, ay] = pts[k - 1];
    const [bx, by] = pts[k];
    let seg = Math.hypot(bx - ax, by - ay);
    while (seg >= left) { const f = left / seg; ax += (bx - ax) * f; ay += (by - ay) * f; out.push([ax, ay]); seg -= left; left = step; }
    left -= seg;
  }
  return out;
}
function SwitchRail({ d, live, color, hl, w = 10, idle = false }) {
  // au repos : le rail en pointilles, estompe (pas de chemin annonce par la machine)
  if (idle) return <g opacity="0.8">{dotsAlong(d, w * 1.3).map(([x, y], k) => <circle key={k} cx={x} cy={y} r={w * 0.28} fill="#4b5563"/>)}</g>;
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
// un trait fluide qui passe par ces points (depart et arrivee a l'horizontale, sans palier au milieu) :
// pour un rail croise, qui sinon s'aplatissait a l'entree et a la sortie du corps (trois vagues)
function fluid(pts) {
  const tan = i => i === 0 || i === pts.length - 1 ? [(pts[Math.min(i + 1, pts.length - 1)][0] - pts[Math.max(i - 1, 0)][0]) / 2, 0]
    : [(pts[i + 1][0] - pts[i - 1][0]) / 2, (pts[i + 1][1] - pts[i - 1][1]) / 2];
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]], ta = tan(i), tb = tan(i + 1);
    d += ` C${a[0] + ta[0] / 3} ${a[1] + ta[1] / 3} ${b[0] - tb[0] / 3} ${b[1] - tb[1] / 3} ${b[0]} ${b[1]}`;
  }
  return d;
}
export function SwitchArt({ m, W, H }) {
  const [A, B] = m.ports;
  const VW = 380, VH = 180, HL = m.hl;
  const inY = { A: 42, B: 138 }, pY = { A: 72, B: 108 }, oY = { G: 72, D: 108 }, nY = { G: 42, D: 138 };
  const cut = (t, n) => t.length > n ? `${t.slice(0, n - 1)}…` : t;
  const units = unitsLabel;
  const path = x => { const s = m.rest ? (x.p === "A" ? "G" : "D") : SIDE(x.out), y = inY[x.p], p = pY[x.p];
    // au repos : la traversee en ligne droite (une courbe aplatie espaçait mal les pointilles)
    if (m.rest) return `M122 ${y} C138 ${y} 136 ${p} 150 ${p} L230 ${p} C246 ${p} 244 ${nY[s]} 258 ${nY[s]}`;
    if (s && (x.p === "A") !== (s === "G")) return fluid([[122, y], [150, p], [230, oY[s]], [258, nY[s]]]);
    return s ? `M122 ${y} C138 ${y} 136 ${p} 150 ${p} C190 ${p} 190 ${oY[s]} 230 ${oY[s]} C246 ${oY[s]} 244 ${nY[s]} 258 ${nY[s]}`
      : `M122 ${y} C138 ${y} 136 ${p} 150 ${p} L170 ${p}`; };
  const servedBy = side => m.ports.find(x => SIDE(x.out) === side);
  const box = (x, y, w, on) => <rect x={x} y={y} width={w} height="62" rx="14" fill="var(--surface2)" stroke={on ? HL : "var(--border)"} strokeWidth={on ? 2.5 : 1}/>;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width={W} height={H} style={{ display: "block", overflow: "visible" }} aria-label="Aiguillage">
      {/* le corps de l'aiguillage, dessous : les rails le traversent */}
      <rect x="150" y="46" width="80" height="88" rx="16" fill="#111827" stroke="rgba(255,255,255,0.12)"/>
      {[A, B].sort((a, b) => a.live - b.live).map(x => <SwitchRail key={x.p} d={path(x)} live={x.live} color={x.slot?.color} hl={HL} w={11} idle={m.rest}/>)}
      {m.fs.calibrating && <text x="190" y="148" textAnchor="middle" fontSize="11" fontWeight="800" fill="#f59e0b">calibration</text>}
      {m.idle && <text x="190" y="148" textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--muted)">au repos</text>}
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
  const path = x => { const sd = m.rest ? (x.p === "A" ? "G" : "D") : SIDE(x.out), y = inY[x.p], q = pin[x.p];
    if (m.rest) return `M38 ${y} C52 ${y} 50 ${q} 62 ${q} L108 ${q} C120 ${q} 118 ${oY[sd]} 132 ${oY[sd]}`;
    // croise : les memes proportions que le grand schema (pente franche aux bouts, traversee douce au milieu)
    if (sd && (x.p === "A") !== (sd === "G")) return fluid([[38, y], [62, x.p === "A" ? 53 : 67], [108, sd === "G" ? 53 : 67], [132, oY[sd]]]);
    return sd ? `M38 ${y} C52 ${y} 50 ${q} 62 ${q} C85 ${q} 85 ${pout[sd]} 108 ${pout[sd]} C120 ${pout[sd]} 118 ${oY[sd]} 132 ${oY[sd]}`
      : `M38 ${y} C52 ${y} 50 ${q} 62 ${q} L74 ${q}`; };
  const served = sd => m.ports.find(x => SIDE(x.out) === sd);
  return <svg viewBox={`0 0 ${VW} ${VH}`} width={VW * s} height={VH * s} style={{ display: "block", overflow: "visible" }} aria-label="Aiguillage">
    <rect x="62" y="34" width="46" height="52" rx="11" fill="#111827" stroke="rgba(255,255,255,0.12)"/>
    {[...m.ports].sort((a, b) => a.live - b.live).map(x => <SwitchRail key={x.p} d={path(x)} live={x.live} color={x.slot?.color} hl={m.hl} w={8} idle={m.rest}/>)}
    {m.idle && <text x="85" y="104" textAnchor="middle" fontSize="10" fontWeight="800" fill="var(--muted)">au repos</text>}
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
                style={{ width: 18, height: 18, borderRadius: 6, ...(trayBg(t) || { background: "transparent" }),
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
    // un emplacement vide (ou que l'AMS ne decrit pas) : aucun filament, et pas de numero qui ne veut rien dire ;
    // l'imprimante dit aussi si du filament est vraiment engage (fin d'impression : retire, meme si
    // l'emplacement reste annonce)
    // (la buse qui imprime en a forcement : le bit ne compte qu'en dehors d'une impression)
    const engaged = (isLive(st) && n.active) || n.has_filament !== false;
    const loaded = engaged && tr && !tr.empty && (trayCol(tr) || tr.filament_type);
    return { n, tr: loaded ? tr : null, slot: loaded ? slotLabel(a, t) : null, color: loaded ? trayCol(tr) : null, type: loaded ? (tr?.spool_info?.fila_type || tr?.filament_type || "") : "",
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
      <span style={{ width: big ? 13 : 10, height: big ? 13 : 10, borderRadius: 4, flexShrink: 0, ...(trayBg(s.tr) || { background: s.color || "transparent" }),
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
            <span style={{ width: sq, height: sq, borderRadius: 3, flexShrink: 0, ...(trayBg(s.tr) || { background: s.color || "transparent" }), border: s.color ? "1px solid rgba(0,0,0,0.2)" : "1.5px dashed var(--text2)" }}/>
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
// une bobine chargee : son nom, sa marque, sa matiere (sous-type), ce qui reste (suivi BambuNymous, sinon l'AMS)
const trayName = t => t.spool_info?.translated_name || t.spool_info?.name || t.filament_type || "Bobine";
const trayKind = t => { const si = t.spool_info || {}; const ft = (si.fila_type || "").trim(), mat = (si.material || t.filament_type || "").trim();
  return ft && mat && !ft.toUpperCase().startsWith(mat.toUpperCase()) ? `${mat} ${ft}` : ft || mat; };
const trayLeft = t => { const p = trayPct(t); return p == null ? null : p / 100; };
const trayTip = t => { const si = t.spool_info || {}, p = trayPct(t);
  return `${slotOf(t)} · ${trayName(t)}\n${[si.brand, trayKind(t)].filter(Boolean).join(" · ")}${p != null ? `\n${si.remaining_weight_g != null ? `${fmtG(si.remaining_weight_g)} · ` : ""}${p} % restants` : ""}`; };
const lum = c => { const h = String(c || "").replace("#", ""); if (h.length < 6) return 200;
  return parseInt(h.slice(0, 2), 16) * 0.299 + parseInt(h.slice(2, 4), 16) * 0.587 + parseInt(h.slice(4, 6), 16) * 0.114; };
// la case d'une bobine : sa couleur, assombrie au-dessus de ce qui reste, l'emplacement ecrit dedans quand ca tient
function TraySwatch({ t, s, on, label = true }) {
  const c = trayCol(t), left = trayLeft(t), ink = lum(c) > 160 ? "rgba(15,23,42,0.75)" : "rgba(255,255,255,0.92)";
  return <span data-pk="" data-tip={trayTip(t)} style={{ position: "relative", width: s, height: s, flexShrink: 0, borderRadius: Math.round(s / 3.4), display: "block",
    ...trayBg(t, left != null && s >= 22 ? `linear-gradient(to bottom, rgba(0,0,0,0.16) ${(1 - left) * 100}%, transparent ${(1 - left) * 100}%)` : null),
    border: "1px solid rgba(0,0,0,0.15)", boxShadow: on ? "0 0 0 2.5px var(--surface), 0 0 0 4.5px #3b82f6, 0 4px 14px rgba(59,130,246,0.45)" : "0 2px 6px rgba(0,0,0,0.12)",
    animation: on ? "bn-ring 2s ease-out infinite" : "none" }}>
    {label && s >= 30 && <span style={{ position: "absolute", left: 0, right: 0, bottom: Math.max(2, s * 0.06), textAlign: "center", fontSize: Math.max(9, Math.min(12, s * 0.22)),
      fontWeight: 900, color: ink, letterSpacing: ".02em" }}>{slotOf(t)}</span>}
  </span>;
}
function Colors({ status, o, sz }) {
  const units = (status?.ams_list || []).filter(a => a.id !== 255 && a.id !== 254)
    .map(a => ({ a, trays: (a.trays || []).map(t => ({ ...t, ams: a })).filter(trayCol) })).filter(u => u.trays.length);
  const trays = units.flatMap(u => u.trays);
  if (!trays.length) return null;
  const on = t => t.ams.id === status?.active_ams_id && t.id === status?.active_tray_id;
  const cur = trays.find(on);
  const mats = Object.entries(trays.reduce((m, t) => { const k = t.spool_info?.material || t.filament_type || "?"; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const head = W => <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
    <span data-pk="" style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.05, ...gradText("#DB2777", "#A855F7") }}>{trays.length}</span>
    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>couleur{trays.length > 1 ? "s" : ""}</span>
    {W >= 220 && <Muted size={11.5}>· {mats.slice(0, 3).map(([k, n]) => `${n} ${k}`).join(" · ")}</Muted>}
    {cur && W >= 180 && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: "#3b82f6", whiteSpace: "nowrap" }}>● {slotOf(cur)}</span>}</div>;
  return (
    <Tile icon={<Palette size={15}/>} color="#EC4899" label="Couleurs chargées" zoom={<ColorsZoom units={units} on={on} mats={mats} cur={cur}/>}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 3 }}>{trays.slice(0, 18).map(t => <span key={`${t.ams.id}-${t.id}`} data-tip={trayTip(t)}
        style={{ width: 13, height: 13, borderRadius: 4, ...trayBg(t), border: "1px solid rgba(0,0,0,0.2)", outline: on(t) ? "2px solid #3b82f6" : "none", outlineOffset: 1 }}/>)}</span>}>
      {({ W, H }) => {
        const hh = H >= 120 ? 32 : 0;
        const room = H - hh;
        // une rangee par unite (son nom a gauche) quand chacune a au moins 28 px ; sinon toutes les cases en grille
        const rowH = Math.floor((room - 6 * (units.length - 1)) / units.length);
        const maxN = Math.max(...units.map(u => u.trays.length));
        const lab = 32;
        const s = Math.min(rowH, Math.floor((W - lab - 6 - 6 * (maxN - 1)) / maxN), 56);
        if (s >= 24) return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, minWidth: 0 }}>
          {hh > 0 && head(W)}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, justifyContent: "center", alignSelf: "center", maxWidth: "100%" }}>
            {units.map(u => <div key={u.a.id} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ width: lab, flexShrink: 0, fontSize: 10.5, fontWeight: 900, textAlign: "center", whiteSpace: "nowrap",
                color: u.a.id === status?.active_ams_id ? "#3b82f6" : "var(--muted)" }}>
                {amsLab(u.a).replace("AMS-", "")}</span>
              <span style={{ display: "flex", gap: 6, minWidth: 0 }}>{u.trays.map(t => <TraySwatch key={t.id} t={t} s={s} on={on(t)}/>)}</span>
            </div>)}</div></div>;
        const g = fitGrid(trays.length, W - 6, room - 6, { gap: 6, max: 64 });
        return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, minWidth: 0 }}>
          {hh > 0 && head(W)}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${g.cols}, ${g.size}px)`, gap: 6, justifyContent: "space-evenly", alignContent: "center" }}>
            {trays.map(t => <TraySwatch key={`${t.ams.id}-${t.id}`} t={t} s={g.size} on={on(t)}/>)}</div></div>;
      }}
    </Tile>
  );
}
// la fenetre : les chiffres, puis chaque unite et ses bobines, avec leur nom, marque, sous-type et ce qui reste
function ColorsZoom({ units, on, mats, cur }) {
  const n = units.reduce((t, u) => t + u.trays.length, 0);
  const pill = (t, c) => <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 20, whiteSpace: "nowrap", color: c,
    background: `${c}1f`, border: `1px solid ${c}40` }}>{t}</span>;
  return <>
    <Stats items={[["Bobines chargées", n, "#EC4899"], ["Unités", units.length, "#A855F7"], ...mats.slice(0, 3).map(([k, x]) => [k, x, "#F59E0B"]),
      cur && ["En cours", `${slotOf(cur)} · ${trayName(cur)}`, "#3B82F6"]].filter(Boolean)}/>
    {units.map(({ a, trays }) => <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <H2>{amsLab(a)}</H2>
        {a.humidity > 0 && pill(`💧 ${a.humidity} %`, a.humidity >= 40 ? "#ef4444" : a.humidity >= 30 ? "#d97706" : "#0ea5e9")}
        {a.temp > 0 && pill(`${Math.round(a.temp)} °C`, "#64748b")}
        {a.is_drying && a.dry_time > 0 && pill(`🔥 séchage · ${fmtDur(a.dry_time * 60)}`, "#f97316")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
        {trays.map(t => { const si = t.spool_info || {}, p = trayPct(t), c = p == null ? "#94a3b8" : p < 15 ? "#ef4444" : p < 35 ? "#f59e0b" : "#22c55e";
          return <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 14, minWidth: 0,
            background: `linear-gradient(135deg, ${trayCol(t)}26, transparent 55%), var(--surface2)`, border: `1px solid ${on(t) ? "#3b82f6" : "var(--border)"}` }}>
            <TraySwatch t={t} s={44} on={on(t)}/>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{trayName(t)}</span>
                {si.remaining_weight_g != null && <span style={{ fontSize: 13, fontWeight: 900, color: c, whiteSpace: "nowrap" }}>{fmtG(si.remaining_weight_g)}</span>}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {pill(slotOf(t), on(t) ? "#3b82f6" : "#64748b")}
                {si.brand && pill(si.brand, "#8B5CF6")}
                {trayKind(t) && pill(trayKind(t), "#0EA5E9")}
                {on(t) && pill("● en cours", "#3b82f6")}
                {!t.spool_info && pill("bobine non associée", "#94a3b8")}
              </div>
              {p != null && <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${p}%`, background: c }}/></span>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)" }}>{p} %</span></span>}
            </div></div>; })}</div>
    </div>)}
  </>;
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
    color={n ? "#ea580c" : "var(--text)"} accent={n ? ["#EA580C", "#F59E0B"] : null}
    delta={n > 0 && n >= best ? <span style={{ fontSize: 11.5, fontWeight: 800, color: "#ea580c" }}>🔥 record en cours</span> : null}/>;
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
              <span data-pk="" style={{ fontSize: 26, fontWeight: 900, color: n ? "#ea580c" : "var(--text)", lineHeight: 1, ...(n ? gradText("#EA580C", "#F59E0B") : {}) }}>{n}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", whiteSpace: "nowrap" }}>jour{n > 1 ? "s" : ""} d'affilée</span></div>
            {row}</div>;
        }
        return <><BoxCtx.Provider value={{ W, H: hh }}>{hero}</BoxCtx.Provider>{o.heat && days && heat(W, H - hh - 6)}</>;
      }}
    </Tile>
  );
}
// un objectif : des heures, des impressions ou des grammes, sur la semaine ou le mois
// l'objectif choisi, ou « selon ma moyenne » : la moyenne par jour des 30 derniers jours (sans aujourd'hui)
// + 10 %, sur la periode, arrondie (5 h, 50 g, une impression). En heures, impressions ou grammes.
function goalTarget(o, days, nDays, metric = o.metric) {
  const [, val] = METRICS[metric] || METRICS.h;
  if (o.target === "custom") return Math.max(0, Number(String(o.custom || "").replace(",", ".")) || 0) || null;
  if (o.target !== "auto" && o.target != null) return Number(o.target) || null;
  if (!days?.length) return null;
  const past = days.slice(0, -1), scale = metric === "h" ? 3600 : 1;
  const avg = past.reduce((a, x) => a + val(x), 0) / Math.max(1, past.length) / scale;
  const raw = avg * nDays * 1.1, step = metric === "h" ? 5 : metric === "g" ? 50 : 1;
  return raw > 0 ? Math.max(step, Math.round(raw / step) * step) : null;
}
// tout ce que la tuile et sa fenetre affichent, pour une periode et une mesure
function goalModel(o, all, period, metric) {
  const [, val, fmt] = METRICS[metric] || METRICS.h;
  const t = new Date(), monthDays = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(), nd = t.getDate();
  const nDays = period === "week" ? 7 : monthDays;
  const days = all ? all.slice(-(period === "week" ? 7 : nd)) : null;
  const scale = metric === "h" ? 3600 : 1;
  // mesure ou periode changee dans la fenetre : l'objectif suit la moyenne (un chiffre fixe n'y a plus de sens)
  const same = metric === (o.metric || "h") && period === (o.period || "week");
  const target = goalTarget(same ? o : { target: "auto" }, all, nDays, metric);
  const auto = !same || (o.target ?? "auto") === "auto";
  const now = days ? days.reduce((a, x) => a + val(x), 0) : null;
  const done = now == null || !target ? 0 : now / (target * scale);
  const pace = target ? target * scale / nDays : null;
  const elapsed = days ? days.length : 0;
  const avg = elapsed ? now / elapsed : null;
  const above = days ? days.filter(x => pace && val(x) >= pace).length : 0;
  const tf = !target ? "…" : metric === "h" ? `${target} h` : metric === "g" ? fmtG(target) : `${target}`;
  // le mois : ou il finira a ce rythme
  const proj = period === "month" && avg != null ? avg * nDays : null;
  const ok = done >= 1;
  return { val, fmt, days, nDays, target, auto, now, done, pace, avg, above, tf, proj, ok, scale,
    rest: now == null || !target ? null : Math.max(0, target * scale - now),
    color: ok ? "#22c55e" : "#3B82F6", accent: ok ? ["#16A34A", "#4ADE80"] : ["#2563EB", "#60A5FA"],
    label: period === "week" ? "ces 7 derniers jours" : "ce mois-ci" };
}
const goalDays = (m, period) => m.days && m.days.map(x => period === "week" ? x.day.toLocaleDateString("fr-FR", { weekday: "narrow" }) : String(x.day.getDate()));
function Goal({ o, sz }) {
  const all = useDays(31);
  const period = o.period || "week", metric = o.metric || "h";
  const m = goalModel(o, all, period, metric);
  const pct = Math.round(m.done * 100);
  const hero = <Hero visual={s => <Ring value={Math.min(1, m.done)} size={s} color={m.color} cap={m.ok ? "atteint" : "fait"}>{pct}%</Ring>}
    value={m.now == null ? "…" : m.fmt(m.now)} unit={`sur ${m.tf}`} accent={m.accent}
    sub={`${m.label}${m.auto ? " · objectif selon ta moyenne" : ""}`}/>;
  const stats = [["Reste", m.rest == null ? "…" : m.ok ? "atteint 🎉" : m.fmt(m.rest), m.ok ? "#16a34a" : "#3B82F6"],
    ["Rythme visé", m.pace ? `${m.fmt(m.pace)} / j` : "…", "#8B5CF6"],
    period === "month" ? ["À ce rythme", m.proj == null ? "…" : m.fmt(m.proj), m.target && m.proj >= m.target * m.scale ? "#16a34a" : "#F59E0B"]
      : ["Ta moyenne", m.avg == null ? "…" : `${m.fmt(m.avg)} / j`, m.pace && m.avg >= m.pace ? "#16a34a" : "#F59E0B"]];
  const bars = h => m.days && <Bars values={m.days.map(m.val)} labels={h >= 50 ? goalDays(m, period).map((l, k) => period === "week" || (k + 1) % 5 === 0 || k === 0 ? l : "") : null}
    color="#22c55e" height={h} hi={m.days.length - 1} goal={m.pace} goalLabel={h >= 50 && m.pace ? `${m.fmt(m.pace)} / j` : null}/>;
  return (
    <Tile icon={<Target size={15}/>} color={m.color} label="Objectif" zoom={<GoalZoom o={o} all={all}/>}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...gradText(m.accent[0], m.accent[1]) }}>{pct} %</span><Muted>{m.now == null ? "" : `${m.fmt(m.now)} / ${m.tf}`}</Muted></span>}>
      {({ W, H }) => {
        // petite : l'anneau et le chiffre ; plus haute, les cases ; plus haute encore, les jours face au rythme
        const sh = H >= 170 ? statsH(3, W) : 0;
        const ch = H >= 250 ? Math.min(150, H - 90 - sh - 16) : 0;
        return <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          <BoxCtx.Provider value={{ W, H: Math.max(48, H - (sh ? sh + 8 : 0) - (ch >= 40 ? ch + 8 : 0)) }}>{hero}</BoxCtx.Provider>
          {sh > 0 && <Stats items={stats}/>}
          {ch >= 40 && <div style={{ marginTop: "auto" }}>{bars(ch)}</div>}
        </div>;
      }}
    </Tile>
  );
}
// la fenetre : la periode et la mesure au choix, les chiffres, les jours face au rythme, le detail d'un jour
function GoalZoom({ o, all }) {
  const [period, setPeriod] = useState(o.period || "week");
  const [metric, setMetric] = useState(o.metric || "h");
  const [pick, setPick] = useState(null);
  const { W } = useBox();
  const m = goalModel(o, all, period, metric);
  const chip = (on, c) => ({ height: 28, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 12, border: "1px solid var(--border)",
    background: on ? c : "var(--surface2)", color: on ? "#fff" : "var(--text2)", whiteSpace: "nowrap" });
  const pct = Math.round(m.done * 100);
  return <>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {[["week", "7 derniers jours"], ["month", "Ce mois-ci"]].map(([k, l]) => <button key={k} type="button" style={chip(period === k, "#22c55e")} onClick={() => setPeriod(k)}>{l}</button>)}
      <span style={{ width: 8 }}/>
      {[["h", "Heures"], ["n", "Impressions"], ["g", "Grammes"]].map(([k, l]) => <button key={k} type="button" style={chip(metric === k, "#3B82F6")} onClick={() => setMetric(k)}>{l}</button>)}
    </div>
    <Hero fill={false} visual={s => <Ring value={Math.min(1, m.done)} size={s} color={m.color} cap={m.ok ? "atteint" : "fait"}>{pct}%</Ring>}
      value={m.now == null ? "…" : m.fmt(m.now)} unit={`sur ${m.tf}`} accent={m.accent}
      sub={`${m.label}${m.auto ? " · objectif selon ta moyenne des 30 derniers jours, plus 10 %" : ""}`}/>
    <Stats items={[["Fait", m.now == null ? "…" : m.fmt(m.now), m.color], ["Objectif", m.auto ? `${m.tf} (auto)` : m.tf, "#3B82F6"],
      ["Reste", m.rest == null ? "…" : m.ok ? "atteint 🎉" : m.fmt(m.rest), m.ok ? "#16a34a" : "#F59E0B"],
      ["Rythme visé", m.pace ? `${m.fmt(m.pace)} / j` : "…", "#8B5CF6"],
      ["Ta moyenne", m.avg == null ? "…" : `${m.fmt(m.avg)} / j`, m.pace && m.avg >= m.pace ? "#16a34a" : "#F59E0B"],
      m.days && ["Jours au-dessus", `${m.above} / ${m.days.length}`, "#16a34a"],
      period === "month" && m.proj != null && ["À ce rythme, fin du mois", m.fmt(m.proj), m.target && m.proj >= m.target * m.scale ? "#16a34a" : "#F59E0B"]].filter(Boolean)}/>
    <H2>{period === "week" ? "Les 7 derniers jours" : "Les jours du mois"} face au rythme</H2>
    {m.days ? <Bars values={m.days.map(m.val)} labels={goalDays(m, period)} color="#22c55e" height={zoomChartH(W)} hi={m.days.length - 1}
      showValues={W / m.days.length >= 30} fmt={m.fmt} goal={m.pace} goalLabel={m.pace ? `${m.fmt(m.pace)} / j` : null}
      onPick={k => setPick(m.days[k]?.date)} picked={m.days.findIndex(x => x.date === pick)}
      titles={m.days.map(x => `${x.day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} : ${m.fmt(m.val(x))}`)}/> : <Muted>…</Muted>}
    <Muted>En vert, les jours au-dessus du rythme visé ; en gris, ceux en dessous. Touche un jour pour son détail.</Muted>
    {m.days && <DayDetail date={pick || m.days[m.days.length - 1]?.date}/>}
  </>;
}

// le classement de la famille (24/10/2026) : sur les seuls secrets a chercher, le compte principal et chaque
// compte de la famille ; une rangee chacun (rang, avatar, nom, nombre de secrets en degrade, barre)
const FAM_C = "#EC4899";
const FamAv = ({ name, size }) => <span style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center",
  justifyContent: "center", fontSize: size * 0.44, fontWeight: 900, color: "#fff", background: avColor(name) }}>{(name || "?").slice(0, 1).toUpperCase()}</span>;
function famRow(b, x, r, h, narrow, max) {
  const c = POD[r] || FAM_C, me = x.username === b.me;
  const count = <span data-pk="" style={{ fontSize: narrow ? 12.5 : 14, fontWeight: 900, whiteSpace: "nowrap", ...gradText("#DB2777", "#A855F7") }}>{x.count}</span>;
  return <div key={x.username} data-tip={`${x.username}${x.main ? " (la maison)" : ""}\n${x.count} secret${x.count > 1 ? "s" : ""} sur ${b.total}`}
    style={{ display: "flex", alignItems: "center", gap: 8, height: h, padding: "0 6px", borderRadius: 12, minWidth: 0,
      background: me ? "linear-gradient(90deg, rgba(236,72,153,0.14), transparent)" : "transparent" }}>
    <span data-pk="" style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11.5, fontWeight: 900, color: r < 3 ? "#fff" : "var(--muted)", background: r < 3 ? `linear-gradient(135deg, ${POD_HI[r]}, ${c})` : "var(--surface2)" }}>{r + 1}</span>
    {h >= 34 && !narrow && <FamAv name={x.username} size={Math.min(30, h - 8)}/>}
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: me ? 900 : 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {x.username}{x.main && h >= 40 && !narrow && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}> · la maison</span>}</span>
        {!narrow && count}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1, height: 5, borderRadius: 5, background: "var(--surface2)", overflow: "hidden" }}>
          <div data-pk="" style={{ height: "100%", width: `${Math.round(100 * x.count / max)}%`, borderRadius: 5,
            background: me ? "linear-gradient(90deg, #EC4899, #A855F7)" : `linear-gradient(90deg, ${c}, ${r < 3 ? POD_HI[r] : "#F9A8D4"})` }}/></div>
        {narrow && count}</div>
    </div>
  </div>;
}
function FamilyBoard({ b, o, sz }) {
  if (!b) return null;                       // pas de famille (ou un compte hors de la famille)
  const people = b.people || [];
  if (people.length < 2) return null;
  const max = Math.max(1, ...people.map(x => x.count));
  return (
    <Tile icon={<Trophy size={15}/>} color={FAM_C} label="Classement de la famille" to="/stats?tab=achievements"
      mini={sz.h === 0.5} summary={<span style={{ fontSize: 13 }}>🥇 {people[0].username} · <b style={{ ...gradText("#DB2777", "#A855F7") }}>{people[0].count}</b></span>}
      zoom={<FamilyBoardZoom b={b}/>}>
      {({ W, H }) => {
        const pod = people.map(x => ({ id: x.username, name: x.username, me: x.username === b.me, score: x.count }));
        // le podium comme celui des copains : des marches des qu'il y a un peu de hauteur ; tres bas (une rangee
        // avec titre), les places en rangee : avatar cercle de sa medaille, rang et nom, score
        if (o.style === "podium" && H >= 84) return <PodiumSteps H={H} places={4} people={pod}/>;
        if (o.style === "podium") { const av = Math.max(20, Math.min(28, H - 6)), C4 = [...POD, "#8B5CF6"], HI4 = [...POD_HI, "#C4B5FD"];
          return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-evenly", gap: 6, minWidth: 0 }}>
            {W < 230 ? pod.slice(0, 3).map((x, r) => <div key={x.id} data-tip={`${r + 1}. ${podName(x)}
${x.score}`} style={{ display: "flex", flexDirection: "column",
              alignItems: "center", gap: 2, minWidth: 0 }}>
              <PodAvatar x={x} size={Math.min(av, H - 22)} ring={C4[r]}/>
              <span data-pk="" style={{ fontSize: 12.5, fontWeight: 900, lineHeight: 1, ...gradText(`color-mix(in srgb, ${C4[r]} 75%, #000000)`, HI4[r]) }}>{x.score}</span></div>)
            : pod.slice(0, W < 300 ? 3 : 4).map((x, r) => <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <PodAvatar x={x} size={av} ring={C4[r]}/>
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r + 1}. {podName(x)}</span>
                <span data-pk="" style={{ fontSize: 14, fontWeight: 900, whiteSpace: "nowrap", ...gradText(`color-mix(in srgb, ${C4[r]} 75%, #000000)`, HI4[r]) }}>{x.score}</span>
              </div></div>)}</div>; }
        const n = Math.min(people.length, fitRows(H, 30, 4) || 1), h = Math.max(26, Math.min(48, Math.floor((H - 4 * (n - 1)) / n)));
        const meI = people.findIndex(x => x.username === b.me);
        const shown = people.slice(0, n);
        if (meI >= n && n > 1) shown[n - 1] = people[meI];
        return <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
          {shown.map(x => famRow(b, x, people.indexOf(x), h, W < 215, max))}</div>;
      }}
    </Tile>
  );
}
// la fenetre : les chiffres, le classement en grand, et section par section qui en a trouve combien
function FamilyBoardZoom({ b }) {
  const people = b.people || [];
  const max = Math.max(1, ...people.map(x => x.count));
  return <>
    <Stats items={[["Secrets à chercher", b.total, FAM_C], ["En tête", people[0] ? `${people[0].username} · ${people[0].count}` : "—", "#D4A017"],
      ["Membres", people.length, "#A855F7"]]}/>
    <Muted>Seuls comptent les secrets qui se cherchent : easter eggs, cachettes, appli Android, farces, fêtes et pages cachées. Chacun les siens ;
      ceux de la maison sont ceux du compte principal.</Muted>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{people.map((x, r) => famRow(b, x, r, 48, false, max))}</div>
    <H2>Section par section</H2>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
      {(b.subs || []).map(sb => { const ranked = [...people].sort((x, y) => (y.subs?.[sb.id] || 0) - (x.subs?.[sb.id] || 0));
        const cmax = Math.max(1, ...people.map(x => x.subs?.[sb.id] || 0));
        return <div key={sb.id} className="card-sm" style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 900, fontSize: 13, color: "var(--text)" }}>{sb.emoji} {sb.name}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>{sb.total}</span></div>
          {ranked.map(x => <div key={x.username} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
            <span style={{ width: 64, flexShrink: 0, fontWeight: x.username === b.me ? 900 : 700, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.username}</span>
            <div style={{ flex: 1, height: 6, borderRadius: 6, background: "var(--surface2)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round(100 * (x.subs?.[sb.id] || 0) / cmax)}%`, background: x.username === b.me ? FAM_C : avColor(x.username) }}/></div>
            <span style={{ width: 28, textAlign: "right", fontWeight: 800, color: "var(--muted)" }}>{x.subs?.[sb.id] || 0}</span></div>)}
        </div>; })}</div>
  </>;
}
export { FamilyBoardZoom };

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
    options: [B("when", "Depuis quand", true), B("cost", "Coût", false), B("photo", "Rappel « pas de photo »", true), SCROLL(false)] },
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
    options: [C("period", "Gains sur", "7", [["7", "7 jours"], ["30", "30 jours"], ["365", "un an"]]), B("chart", "Courbe (14 jours)", true),
      C("metric", "La courbe suit", "points", [["points", "les points"], ["downloads", "les téléchargements"], ["prints", "les impressions"], ["boosts", "les boosts reçus"], ["likes", "les j'aime"]]),
      B("stats", "Téléchargements, impressions, boosts, j'aime", true, { hint: "Quand la tuile a la place." }),
      B("best", "Le modèle en tête (30 jours)", true, { hint: "Quand la tuile a de la hauteur." })] },
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
    options: [C("style", "Affichage", "glass", [["glass", "thermomètres"], ["thermo", "cadrans"], ["gauges", "jauges"], ["list", "lignes"]],
      { hint: "Thermomètres : un tube qui se remplit du froid à la chaleur, la consigne en repère. Cadrans : une carte par source. Tout passe en lignes quand ce serait trop petit." }),
      B("targets", "Consignes", true), B("chamber", "Chambre", true)] },
  month: { label: "Ce mois-ci", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Month v={d.month} o={o} sz={sz(it)}/>,
    options: [B("ring", "Anneau de réussite", true), B("compare", "Comparer au mois dernier", true), B("cost", "Coût", true), B("chart", "Barres par jour", true, { hint: "Quand la tuile a la place." })] },
  sales: { label: "Objets et ventes", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Sales v={d.sales} o={o} sz={sz(it)}/>,
    options: [B("ring", "Anneau vendus / à vendre", true), B("revenue", "Chiffre d'affaires", true), B("margin", "Marge", true),
      B("month", "Les ventes du mois", true, { hint: "Quand la tuile a la place." }), B("chart", "Recettes sur douze mois", true, { hint: "Quand la tuile a la place." }),
      B("potential", "Valeur du stock", true, { hint: "Quand la tuile a la place." })] },
  feed: { label: "Le fil du jour", w: [2, 1], h: [2, 3, 1], render: (d, st, o, it) => <Feed f={d.feed} o={o} sz={sz(it)}/>,
    options: [C("count", "Lignes", "auto", [["auto", "selon la hauteur"], [4, "4 au plus"], [6, "6 au plus"], [10, "10 au plus"]]),
      C("section", "Montrer", "all", [["all", "tout"], ["prints", "impressions"], ["spools", "bobines et séchage"], ["mw", "MakerWorld"], ["friends", "copains"]]),
      B("time", "Heure", true), B("detail", "Détail (quand la tuile est large)", true), SCROLL(false)] },
  gallery: { label: "Galerie", w: [2, 1], h: [1, 2], render: (d, st, o, it) => <Gallery g={d.prints} o={o} sz={sz(it)}/>,
    options: [C("count", "Vignettes au plus", 8, [[4, "4"], [8, "8"], [12, "12"], [16, "16"]]), B("okOnly", "Seulement les réussies", false),
      B("round", "Vignettes rondes", false)] },
  shortcuts: { label: "Raccourcis", w: [2, 1], h: [1, 0.5], render: (d, st, o, it) => <Shortcuts o={o} sz={sz(it)}/>,
    options: [B("iconsOnly", "Icônes seules", false, { hint: "Sinon le nom s'affiche quand il tient." }),
      ...SHORTCUTS.map(([k, l], i) => B(`s_${k}`, l, i < 6, { group: "Raccourcis affichés" }))] },
  family: { label: "Classement de la famille", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <FamilyBoard b={d.family} o={o} sz={sz(it)}/>,
    options: [C("style", "Affichage", "list", [["list", "liste"], ["podium", "podium (4 places)"]], { hint: "Le podium a besoin d'un peu de hauteur ; trop bas, la liste revient." })] },
  podium: { label: "Classement des copains", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Podium p={d.podium} a={d.ach} o={o} sz={sz(it)}/>,
    options: [C("style", "Affichage", "list", [["list", "liste"], ["podium", "podium"]]), B("bars", "Barres de score", true), SCROLL(false)] },
  alerts: { label: "Alertes en bref", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Alerts a={d.attention} o={o} sz={sz(it)}/>,
    options: [C("style", "Affichage", "chips", [["chips", "rangées"], ["icons", "icônes"], ["list", "rangées et exemples"]], { hint: "Rangées : une par catégorie, sa couleur, une barre et le nombre. Icônes : une grosse icône, le nombre en badge. Rangées et exemples : les premières alertes sous chaque catégorie quand il y a la place." }),
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
      C("target", "Objectif", "auto", [["auto", "selon ma moyenne"], [5, "5"], [10, "10"], [20, "20"], [30, "30"], [50, "50"], [75, "75"], [100, "100"],
        [150, "150"], [200, "200"], [300, "300"], [500, "500"], [1000, "1000"], [2000, "2000"], ["custom", "à moi…"]],
        { hint: "En heures, en impressions ou en grammes selon la mesure. « Selon ma moyenne » : ta moyenne des 30 derniers jours, plus 10 %." }),
      { key: "custom", label: "Mon objectif", type: "text", def: "", placeholder: "par exemple 80", max: 7,
        when: (it, o) => o.target === "custom", hint: "Un nombre, dans l'unité de la mesure." }] },
};
// En attendant ses donnees, une tuile tient deja sa place (les autres ne bougent pas a l'arrivee) :
// son nom, ce qu'elle montre, « chargement… ». needs : la cle de useTilesData, ou "status" (l'imprimante).
const WAIT = {
  today: ["today", "Les impressions du jour, leur réussite et l'écart avec hier."],
  next: ["queue", "Ce qui attend d'être imprimé, et ce qui est prêt tout de suite."],
  last: ["prints", "Tes dernières impressions, réussies ou non."],
  stock: ["spools", "Ce qui reste en bobines, et les plus basses."],
  dry: ["dry", "Les bobines au sec et celles à sécher."],
  humidity: ["status", "L'humidité dans chaque AMS."],
  friends: ["friends", "Ce que tes copains impriment en ce moment."],
  mw: ["mw", "Tes points et compteurs MakerWorld."],
  rate: ["rate", "Les impressions qui attendent ton avis sur MakerWorld."],
  wheel: ["ach", "Tes tours de roue, tes clés et tes tickets."],
  ach: ["ach", "Ton grade, ton score et tes dernières médailles."],
  camera: ["status", "L'image de la caméra de l'imprimante."],
  temps: ["status", "Les températures de la buse, du plateau et de la chambre."],
  month: ["month", "Le bilan du mois, comparé au mois dernier."],
  sales: ["sales", "Tes objets, ce qui est vendu et ce que ça rapporte."],
  feed: ["feed", "Ce qui s'est passé aujourd'hui, au fil des heures."],
  gallery: ["prints", "Les photos de tes dernières impressions."],
  podium: ["podium", "Ton classement face à tes copains."],
  family: ["family", "Qui de la famille a trouvé le plus de secrets."],
  alerts: ["attention", "Ce qui mérite ton attention dans le stock et les fiches."],
  countdown: ["status", "Le temps qu'il reste à l'impression en cours."],
  spool: ["status", "La bobine qui imprime en ce moment."],
  head: ["status", "Les buses de la tête d'impression."],
  switch: ["status", "Le chemin du filament dans l'aiguillage."],
  colors: ["status", "Les couleurs chargées dans les AMS."],
};
export function tileWaiting(id, data, status) {
  const w = WAIT[id];
  if (!w) return false;
  return w[0] === "status" ? status == null : data?.[w[0]] === undefined;
}
export function TileWaiting({ id, label, mini = false }) {
  const what = WAIT[id]?.[1];
  const dots = <span className="bn-wait-dots" aria-hidden="true"><i/><i/><i/></span>;
  return (
    <div className="card" aria-busy="true" style={{ height: "100%", boxSizing: "border-box", minWidth: 0, overflow: "hidden", display: "flex",
      flexDirection: mini ? "row" : "column", alignItems: mini ? "center" : "stretch", gap: mini ? 8 : 6, padding: mini ? "0 12px" : "10px 12px" }}>
      <style>{`.bn-wait-dots{display:inline-flex;gap:3px;align-items:center}.bn-wait-dots i{width:5px;height:5px;border-radius:50%;background:var(--muted);
        opacity:.35;animation:bn-wait 1.2s infinite ease-in-out}.bn-wait-dots i:nth-child(2){animation-delay:.2s}.bn-wait-dots i:nth-child(3){animation-delay:.4s}
        @keyframes bn-wait{0%,80%,100%{opacity:.25}40%{opacity:.9}}`}</style>
      <span className="tile-head" style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden",
        textOverflow: "ellipsis", minWidth: 0 }}>{label}</span>
      {mini ? <span style={{ marginLeft: "auto" }}>{dots}</span> : <>
        {what && <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4, overflow: "hidden" }}>{what}</span>}
        <span style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
          {dots}chargement</span></>}
    </div>
  );
}
// chaque tuile se pose sur 1/2, 1, 2, 3 ou 4 rangees ; sa hauteur par defaut reste en tete
export const HEIGHTS = [1, 2, 3];   // trois rangees au plus (23/10/2026)
export { Zoom };
for (const t of Object.values(TILES)) { const d = t.h[0] === 0.5 ? 1 : t.h[0]; t.h = [d, ...HEIGHTS.filter(x => x !== d)]; }
