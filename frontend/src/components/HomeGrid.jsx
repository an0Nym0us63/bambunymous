import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, EyeOff, Plus, RotateCcw, Check, GripVertical, Columns, Monitor, Smartphone, Settings2, X, Palette, Copy, Heading, Trash2, Pencil, Send } from "lucide-react";
import client from "../api/client";
import { currentFriend, useFriend } from "../store/friend";
import { toast } from "../store/toast";
import { TILES, TILE_NEEDS, useTilesData, tileWaiting, TileWaiting } from "./HomeTiles";
import { showConfirm } from "../utils/dialog";
import { useIsAdmin } from "../store/auth";

// La grille de l'accueil, a la carte (22/10/2026). Une disposition par nombre
// de colonnes (1 a 4), propre a chaque compte ; celle a une colonne est aussi
// celle du telephone. Chaque colonne est coupee en deux sous-colonnes. L'accueil
// montre la disposition du nombre de colonnes qui tiennent a l'ecran, sans
// depasser le maximum choisi ; une disposition jamais reglee se deduit d'une
// autre. Chaque tuile a une largeur (1 = moitie de sa colonne, 2 = toute la
// colonne) et une hauteur (rangees, ou « auto » : selon son contenu), parmi
// celles que son type accepte.

const WIDE = 1024;
const COL_MIN = 400;                               // largeur sous laquelle une colonne (deux sous-colonnes) se tasse trop
const ROW = 118;                                   // hauteur d'une rangee (px)
const HALF = 54;                                   // une demi-rangee (2 x 54 + l'ecart de 10 = 118)
// La grille avance par pas de 8 px, sans ecart entre rangees : chaque case porte
// sous elle sa marge de 10 px. Une demi-rangee = 64 px (8 pas), une rangee = 128
// (16 pas), etc. : les tuiles « selon le contenu » s'ajustent a 8 px pres.
const UNIT = 8, GAP = 10, PER_ROW = 16;

function useWide() {
  const [w, setW] = useState(() => window.innerWidth >= WIDE);
  useEffect(() => {
    const f = () => setW(window.innerWidth >= WIDE);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return w;
}

// Disposition par defaut ; « defs » = les tuiles connues (les blocs de l'accueil + le catalogue)
function defaults(defs) {
  const it = id => ({ id, w: defs[id].w[0], h: defs[id].h[0] });
  const small = ["today", "week", "next", "last", "stock", "dry", "humidity", "friends", "mw", "rate", "wheel", "ach"].filter(id => defs[id]);
  return {
    v: 2, max: 2,
    layouts: {
      1: [["printer", "ams", "amsdetail", ...small, "alerts"].filter(id => defs[id]).map(it)],
      2: [["printer", "ams", "amsdetail"].filter(id => defs[id]).map(it), [...small, "alerts"].filter(id => defs[id]).map(it)],
    },
  };
}
// les hauteurs permises d'une tuile a une largeur donnee : « h1 » en demi-largeur si
// le type en a (une hauteur « auto » y occuperait une seule rangee etiree, et la
// tuile voisine paraitrait aussi haute qu'elle, sans place pour une autre dessous)
export const heightsOf = (def, w) => (w === 1 && def.h1) || def.h;
const fixer = defs => x => {
  const d = defs[x?.id];
  if (!d) return null;
  const w = d.w.includes(x.w) ? x.w : d.w[0], hs = heightsOf(d, w);
  // une demi-rangee devient une rangee ; quatre rangees (retirees le 23/10/2026) deviennent trois
  const h = x.h === 0.5 && hs.includes(1) ? 1 : x.h === 4 && hs.includes(3) ? 3 : x.h;
  return { id: x.id, w, h: hs.includes(h) ? h : hs[0], ...(x.o && typeof x.o === "object" ? { o: x.o } : {}) };
};
// les options d'une tuile : celles de son type (avec leur valeur par defaut), et ce que la disposition en a fait
// toutes les tuiles ont en plus une option commune : leur titre, affiche ou non
const TITLE_OPT = { key: "_title", label: "Titre de la tuile", hint: "Masqué, la tuile gagne de la place (les infos de l'en-tête restent).",
  def: true, group: "Général" };
const BG_OPT = { key: "_bg", label: "Fond coloré", hint: "Quand les fonds colorés sont activés pour l'accueil.", def: true, group: "Général" };
const allOpts = def => [TITLE_OPT, BG_OPT, ...(def.options || []).map(op => op.group ? op : { ...op, group: "Contenu" })];
const TOUCH_ONLY = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches && !window.matchMedia?.("(any-pointer: fine)").matches;
const optsOf = (def, item) => Object.fromEntries(allOpts(def).map(o => [o.key, item.o?.[o.key] ?? o.def]));
// Fonds colores : une teinte par tuile, jamais proche de celle d'une voisine
// (a gauche, a droite, au-dessus, au-dessous, ou en coin). La voisine se lit a
// l'ecran, la ou la grille a vraiment pose la tuile.
const TINTS = [
  { h: 215, a: "#2563EB", b: "#0284C7" }, { h: 285, a: "#7C3AED", b: "#A21CAF" }, { h: 25, a: "#EA580C", b: "#F97316" },
  { h: 150, a: "#059669", b: "#16A34A" }, { h: 330, a: "#DB2777", b: "#BE185D" }, { h: 180, a: "#0F766E", b: "#0E7490" },
  { h: 245, a: "#4F46E5", b: "#4338CA" }, { h: 355, a: "#DC2626", b: "#E11D48" }, { h: 45, a: "#B45309", b: "#CA8A04" },
];
// en fonds vifs, l'allure commune a toutes les tuiles (les couleurs restent celles du systeme)
const TINT_STYLES = [["flat", "dégradé"], ["glow", "lueur"], ["bubbles", "bulles"], ["glass", "verre"]];
const hueGap = (x, y) => { const d = Math.abs(x - y) % 360; return Math.min(d, 360 - d); };
const NEAR = 32;
const hueOf = hex => {
  const m = String(hex || "").replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return null;
  const [r, g, b] = m.slice(1).map(x => parseInt(x, 16) / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d < 0.08) return null;                                   // un gris : pas de teinte a eviter
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
// fixed : ce qui entoure la grille avec ses teintes (le bandeau d'accueil)
function paint(rects, fixed = []) {
  const out = {};
  const order = [...rects].sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
  const touch = (a, b) => a.left <= b.right + NEAR && b.left <= a.right + NEAR && a.top <= b.bottom + NEAR && b.top <= a.bottom + NEAR;
  order.forEach(({ id, r }, k) => {
    const near = [...order.slice(0, k).filter(x => touch(r, x.r)).map(x => TINTS[out[x.id]].h),
      ...fixed.filter(f => touch(r, f.r)).flatMap(f => f.hues)];
    const start = [...id].reduce((t, c) => t + c.charCodeAt(0), 0) % TINTS.length;
    let best = start, bestGap = -1;
    for (let i = 0; i < TINTS.length; i++) {
      const t = (start + i) % TINTS.length;
      const g = near.length ? Math.min(...near.map(h => hueGap(h, TINTS[t].h))) : 180;
      if (g >= 40) { best = t; break; }
      if (g > bestGap) { best = t; bestGap = g; }
    }
    out[id] = best;
  });
  return out;
}
// une disposition a n colonnes, remise d'aplomb : tuiles inconnues retirees, tailles
// ramenees a ce que la tuile accepte, pas de doublon, la tuile obligatoire presente
function cleanCols(cols, n, defs) {
  // l'ancienne tuile « Points d'attention » (retiree le 23/10/2026) devient « Alertes »
  const ren = x => x?.id === "attention" && defs.alerts ? { id: "alerts", w: defs.alerts.w.includes(x.w) ? x.w : defs.alerts.w[0],
    h: defs.alerts.h.includes(x.h) ? x.h : defs.alerts.h[0] } : x;
  cols = (cols || []).map(c => (c || []).map(ren));
  const fix = fixer(defs);
  const out = [...Array(n)].map((_, i) => ((cols || [])[i] || []).map(fix).filter(Boolean));
  (cols || []).slice(n).forEach(c => out[n - 1].push(...(c || []).map(fix).filter(Boolean)));
  const seen = new Set();
  const res = out.map(c => c.filter(x => !seen.has(x.id) && seen.add(x.id)));
  for (const [id, d] of Object.entries(defs)) if (d.required && !seen.has(id)) res[0].unshift({ id, w: d.w[0], h: d.h[0] });
  return res;
}
// Remet d'aplomb une disposition gardee (et convertit l'ancien format : PC + mobile)
function normalize(lay, defs) {
  if (!lay) return defaults(defs);
  if (lay.v === 1) {
    const n = Math.max(1, Math.min(4, parseInt(lay.dash?.cols) || 2));
    const cols = (lay.dash?.columns || []).map(c => [...(c || [])]);
    const mob = [...(lay.mobile?.items || [])];
    // l'ancienne tuile AMS (apercu + detail) a ete coupee en deux : le detail juste apres l'apercu
    if (!lay.amsSplit && defs.amsdetail) {
      const after = list => { const i = list.findIndex(x => x?.id === "ams"); if (i >= 0 && !list.some(x => x?.id === "amsdetail")) list.splice(i + 1, 0, { id: "amsdetail", w: 2, h: "auto" }); };
      cols.forEach(after); after(mob);
    }
    lay = { v: 2, max: n, layouts: { [n]: cols, ...(n !== 1 ? { 1: [mob] } : {}) } };
  }
  if (lay.v !== 2) return defaults(defs);
  const layouts = {};
  // la disposition a une colonne (le telephone) garde ses ecrans : une colonne par ecran, quatre au plus
  for (const n of [1, 2, 3, 4]) if (lay.layouts?.[n]) layouts[n] = cleanCols(lay.layouts[n], n === 1 ? Math.max(1, Math.min(MAX_PAGES, lay.layouts[1].length)) : n, defs);
  if (!Object.keys(layouts).length) return defaults(defs);
  return { v: 2, max: Math.max(1, Math.min(4, parseInt(lay.max) || 2)), layouts,
    ...(lay.bannerFirst === true ? { bannerFirst: true } : {}),
    ...(Array.isArray(lay.pageNames) ? { pageNames: lay.pageNames.slice(0, MAX_PAGES).map(x => String(x || "").slice(0, PAGE_NAME_MAX)) } : {}),
    ...(lay.top && typeof lay.top === "object" ? { top: lay.top } : {}),
    ...(lay.topPhone && typeof lay.topPhone === "object" ? { topPhone: lay.topPhone } : {}),
    ...(["soft", "vivid", "banner"].includes(lay.tint) ? { tint: lay.tint } : {}),
    ...(TINT_STYLES.some(([k]) => k === lay.tintStyle) ? { tintStyle: lay.tintStyle } : {}),
    ...(lay.tintColor === "one" ? { tintColor: "one", tintOne: lay.tintOne === "banner" ? "banner" : Math.max(0, Math.min(TINTS.length - 1, parseInt(lay.tintOne) || 0)) } : {}) };
}
// la disposition a n colonnes : la sienne, ou deduite de la plus proche reglee
// (a une colonne, celle qui est deduite tient sur un seul ecran)
function layoutFor(lay, n) {
  if (lay.layouts[n]) return lay.layouts[n];
  const have = Object.keys(lay.layouts).map(Number).sort((a, b) => Math.abs(a - n) - Math.abs(b - n) || b - a);
  const src = lay.layouts[have[0]];
  if (src.length > n) return [...Array(n)].map((_, i) => src.filter((_c, j) => j % n === i).flat());
  // moins de colonnes que voulu : les tuiles se repartissent, dans l'ordre, vers la colonne la moins chargee
  const out = [...Array(n)].map(() => []);
  const load = c => c.reduce((t, x) => t + (x.h === "auto" ? 3 : x.h) * (x.w === 2 ? 2 : 1), 0);
  src.forEach((c, ci) => c.forEach(x => {
    const k = ci < n && !out[ci].length ? ci : out.reduce((b, cc, i) => load(cc) < load(out[b]) ? i : b, 0);
    out[k].push(x);
  }));
  return out;
}

// Les ecrans du telephone (23/10/2026) : la disposition a une colonne en porte jusqu'a quatre, cote a
// cote, qu'on fait glisser au doigt ; apres le dernier revient le premier. Chacun a un nom bref.
const MAX_PAGES = 4, PAGE_NAME_MAX = 16;
// ce qui defile : le cadre de la page de l'appli (main.page-content), sinon le document
const pageScroller = () => { const m = document.querySelector("main.page-content");
  return m && m.scrollHeight > m.clientHeight + 1 ? m : document.scrollingElement || document.documentElement; };
const pageName = (lay, i) => (lay.pageNames?.[i] || "").trim() || `Écran ${i + 1}`;
// qui prend le geste : un champ ou un curseur, toujours ; un element qui defile de cote, seulement s'il
// peut encore aller dans ce sens (un debordement de quelques pixels, ou un rang deja au bout, laisse
// passer l'ecran). dir : -1 le doigt va a gauche, 1 a droite, 0 pas encore connu
function ownsSwipe(t, stop, dir = 0) {
  for (let n = t; n && n !== stop; n = n.parentElement) {
    if (n.dataset?.noswipe != null || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) return true;
    const ox = getComputedStyle(n).overflowX;
    if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth + 8) {
      if (!dir) return true;
      if (dir < 0 && n.scrollLeft < n.scrollWidth - n.clientWidth - 2) return true;
      if (dir > 0 && n.scrollLeft > 2) return true;
    }
  }
  return false;
}
// Les ecrans cote a cote : celui qu'on voit dans le flux (il donne la hauteur), ses voisins poses a
// gauche et a droite, prets a glisser. Le geste se decide au bout de quelques pixels : plutot vertical,
// la page defile comme d'habitude ; plutot horizontal, l'ecran suit le doigt.
// ce qui defile : la zone de page de l'appli (main), sinon la fenetre
const scrollerOf = el => { for (let n = el?.parentElement; n; n = n.parentElement) if (/auto|scroll/.test(getComputedStyle(n).overflowY)) return n; return null; };
function Pager({ count, cur, onGo, children }) {
  const box = useRef(null);
  // jusqu'en bas de l'ecran (au-dessus de la barre du bas) : un ecran peu rempli se glisse partout
  const [minH, setMinH] = useState(0);
  useLayoutEffect(() => {
    const f = () => { const el = box.current; if (!el) return;
      const nav = document.querySelector("nav.show-mobile"), navH = nav && nav.offsetWidth ? nav.getBoundingClientRect().height : 0;
      const sc = scrollerOf(el);
      // dans la zone qui defile : sa hauteur, moins ce qui precede l'ecran et sa marge du bas (qui laisse la barre)
      if (sc) { const r = sc.getBoundingClientRect(), top = el.getBoundingClientRect().top - r.top + sc.scrollTop;
        setMinH(Math.max(0, Math.floor(sc.clientHeight - top - parseFloat(getComputedStyle(sc).paddingBottom || 0)))); return; }
      setMinH(Math.max(0, Math.round(window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - navH - 12))); };
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [count, cur]);
  const [drag, setDrag] = useState(0);
  const [anim, setAnim] = useState(false);
  const g = useRef(null);
  // un autre ecran : on repart de son haut (sinon on arrivait au milieu, a la hauteur du precedent)
  const prev = useRef(cur);
  useEffect(() => {
    if (prev.current === cur) return;
    prev.current = cur;
    const sc = scrollerOf(box.current);
    if (sc) sc.scrollTo({ top: 0, behavior: "auto" });
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "auto" });
  }, [cur]);
  const st = useRef({ count, cur, onGo });
  st.current = { count, cur, onGo };
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const start = e => {
      if (st.current.count < 2 || e.touches.length !== 1) { g.current = null; return; }
      const t = e.touches[0];
      g.current = { x: t.clientX, y: t.clientY, t: Date.now(), dx: 0, lock: null, target: e.target };
    };
    const move = e => {
      const s = g.current;
      if (!s || s.lock === "skip" || s.lock === "v") return;
      const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (!s.lock) {
        if (Math.abs(dx) < 9 && Math.abs(dy) < 9) return;
        s.lock = Math.abs(dx) > Math.abs(dy) * 1.25 ? (ownsSwipe(s.target, el, dx < 0 ? -1 : 1) ? "skip" : "h") : "v";
        if (s.lock !== "h") return;
      }
      e.preventDefault();
      s.dx = dx; setAnim(false); setDrag(dx);
    };
    const end = () => {
      const s = g.current; g.current = null;
      if (!s || s.lock !== "h") return;
      const w = el.clientWidth || 1, v = Math.abs(s.dx) / Math.max(1, Date.now() - s.t);
      const go = Math.abs(s.dx) > w * 0.22 || (v > 0.45 && Math.abs(s.dx) > 30) ? (s.dx < 0 ? 1 : -1) : 0;
      setAnim(true);
      if (!go) { setDrag(0); return; }
      setDrag(go > 0 ? -w - 16 : w + 16);
      setTimeout(() => { const { count: c, cur: k, onGo: f } = st.current; setAnim(false); setDrag(0); f((k + go + c) % c); }, 230);
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => { el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end); };
  }, []);
  // ou se tient chaque ecran : celui qu'on voit a 0, le suivant a droite, le precedent a gauche (en boucle ;
  // a deux ecrans, l'autre se met du cote ou l'on tire)
  const at = i => {
    if (i === cur) return 0;
    if (count === 2) return drag > 0 ? -1 : 1;
    if (i === (cur + 1) % count) return 1;
    if (i === (cur - 1 + count) % count) return -1;
    return null;
  };
  const tr = anim ? "transform .23s cubic-bezier(.2,.7,.3,1)" : "none";
  // rogne dans les deux sens : un voisin plus long que l'ecran vu allongeait la page (on defilait dans le
  // vide, ou le geste ne prenait plus) ; la marge garde les ombres des tuiles
  return <div ref={box} style={{ position: "relative", overflow: "clip", overflowClipMargin: 14, touchAction: "pan-y", minHeight: count > 1 ? minH : undefined }}>
    {[...Array(count).keys()].map(i => { const k = at(i);
      return <div key={i} aria-hidden={i !== cur} style={i === cur ? { position: "relative", transform: `translateX(${drag}px)`, transition: tr }
        : { position: "absolute", top: 0, left: 0, width: "100%", visibility: k == null ? "hidden" : "visible", pointerEvents: "none",
          transform: `translateX(calc(${(k ?? 3) * 100}% + ${(k ?? 3) * 16 + drag}px))`, transition: tr }}>{children(i)}</div>; })}
  </div>;
}

function Cell({ item, def, edit, children, actions, options, drag, selected, onSelect, tint, tintMode, tintStyle }) {
  // une hauteur choisie est stricte (les rangees ne grandissent pas avec le contenu) ;
  // « selon le contenu » : la tuile se mesure et prend les demi-rangees qu'il lui faut
  const body = useRef(null);
  const [autoSpan, setAutoSpan] = useState(PER_ROW * 2);
  const auto = item.h === "auto";
  useEffect(() => {
    const el = body.current;
    if (!auto || !el || typeof ResizeObserver === "undefined") return undefined;
    // le conteneur a la hauteur de son contenu : c'est lui qu'on observe
    const ro = new ResizeObserver(() => setAutoSpan(Math.max(1, Math.ceil((el.getBoundingClientRect().height + GAP) / UNIT))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [auto]);
  const span = auto ? `span ${autoSpan}` : `span ${Math.round(item.h * PER_ROW)}`;
  return (
    <div data-hg-id={item.id} className={`hg-cell${edit ? " hg-edit" : ""}${item.o?._title === false ? " hg-notitle" : ""}${tint ? ` hg-tint-${tintMode}` : ""}${tint && tintStyle ? ` hg-ts-${tintStyle}` : ""}`}
      draggable={edit && drag ? true : undefined}
      onClick={edit ? e => { e.stopPropagation(); onSelect(); } : undefined}
      onDragStart={drag?.start} onDragOver={drag?.over} onDrop={drag?.drop} onDragEnd={drag?.end}
      style={{ gridColumn: `span ${item.w}`, gridRow: span, minWidth: 0, position: "relative", paddingBottom: GAP, boxSizing: "border-box",
        ...(tint ? { "--hg-a": tint.a, "--hg-b": tint.b, "--hg-c": tint.c || tint.a } : {}),
        ...(edit ? { outline: selected ? "3px solid #3b82f6" : "2px dashed rgba(59,130,246,0.55)", outlineOffset: 2, borderRadius: 16,
          cursor: "pointer",
          opacity: drag?.dragging ? 0.4 : 1 } : {}) }}>
      <div ref={body} style={{ height: auto ? "auto" : "100%", pointerEvents: edit ? "none" : undefined, filter: edit ? "saturate(0.85)" : undefined }}>
{children}</div>
      {edit && !selected && (
        <span style={{ position: "absolute", left: 8, top: 8, zIndex: 3, display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "calc(100% - 16px)",
          padding: "3px 9px 3px 6px", borderRadius: 20, background: "rgba(15,23,42,0.82)", color: "#fff", fontSize: 11.5, fontWeight: 800,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxShadow: "0 4px 10px rgba(0,0,0,0.25)" }}>
          {drag && <GripVertical size={13} style={{ opacity: 0.8, flexShrink: 0 }}/>}{def.label}</span>
      )}
      {edit && selected && (
        <div onClick={e => e.stopPropagation()} style={{ position: "absolute", left: 6, right: 6, top: 6, zIndex: 4, display: "flex",
          flexDirection: "column", gap: 5, padding: "7px 8px", borderRadius: 12, background: "rgba(15,23,42,0.92)", color: "#fff",
          boxShadow: "0 8px 22px rgba(0,0,0,0.35)" }}>
          <span style={{ fontSize: 12, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.label}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{actions}</div>
          {options}
        </div>
      )}
    </div>
  );
}
// Un contenu qui doit tenir dans sa case sans defiler : s'il depasse, il est
// reduit d'un bloc (echelle), en gardant sa largeur utile.
function FitBox({ children }) {
  const outer = useRef(null), inner = useRef(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i || typeof ResizeObserver === "undefined") return undefined;
    const fit = () => {
      const H = o.clientHeight, need = i.scrollHeight;
      if (!H || !need) return;
      setK(cur => {
        const next = Math.min(1, H / need);
        return Math.abs(next - cur) > 0.01 ? Math.max(0.4, next) : cur;
      });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(o); ro.observe(i);
    fit();
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} style={{ height: "100%", overflow: "hidden" }}>
      <div ref={inner} style={{ width: `${100 / k}%`, transform: k < 1 ? `scale(${k})` : undefined, transformOrigin: "top left" }}>{children}</div>
    </div>
  );
}
// Les blocs historiques (imprimante, AMS, points d'attention) dans le meme cadre
// que les tuiles : pastille d'icone, titre, lueur ; leurs cartes internes aplaties.
function Frame({ def, children, extra, item, summary, badge = null }) {
  if (children == null || children === false) return null;
  const { icon, color } = def.frame;
  const fixed = typeof item?.h === "number";
  // demi-hauteur : une ligne, l'icone, le nom, et l'essentiel a droite
  if (item?.h === 0.5) return (
    <div className="card hg-frame" style={{ padding: "0 12px", display: "flex", alignItems: "center", gap: 8, height: "100%", boxSizing: "border-box",
      overflow: "hidden", minWidth: 0 }}>
      <span data-pk="" style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
        background: `${color}22`, color, flexShrink: 0 }}>{icon}</span>
      <span className="frame-label" style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden",
        textOverflow: "ellipsis", minWidth: 0, flexShrink: 1 }}>{def.label}</span>
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 15, fontWeight: 900,
        color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden" }}>{summary}{extra}</span>
    </div>
  );
  return (<>
    {badge && <div style={{ position: "absolute", top: -7, right: 22, zIndex: 4 }}>{badge}</div>}
    <div className="card hg-frame" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, position: "relative",
      overflow: "hidden", height: "100%", boxSizing: "border-box", minWidth: 0 }}>
      <div className="frame-head" style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
        <span data-pk="" className="frame-label" style={{ width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
          background: `${color}22`, color, flexShrink: 0 }}>{icon}</span>
        <span className="frame-label" style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", letterSpacing: ".02em" }}>{def.label}</span>
        {extra && <span className="frame-extra" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap",
          justifyContent: "flex-end" }}>{extra}</span>}
      </div>
      <div className="hg-frame-body" style={{ position: "relative", minWidth: 0, ...(fixed ? { flex: 1, minHeight: 0, overflowY: def.fit ? "hidden" : "auto" } : {}) }}>
        {fixed && def.fit ? <FitBox>{children}</FitBox> : children}</div>
    </div>
  </>);
}

// Le panneau des options d'une tuile (ou du bandeau) : chaque option avec son
// libelle, son explication et la bonne commande (interrupteur, choix, texte).
// Les options peuvent etre groupees (« group »). Les changements s'appliquent
// aussitot ; « Terminé » de la personnalisation enregistre.
function OptionsSheet({ title, options, values, onChange, onClose, head = null }) {
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const groups = [];
  options.forEach(op => {
    const g = op.group || "";
    let cur = groups.find(x => x.name === g);
    if (!cur) groups.push(cur = { name: g, items: [] });
    cur.items.push(op);
  });
  const sw = on => ({ width: 42, height: 24, borderRadius: 20, border: "none", cursor: "pointer", position: "relative", flexShrink: 0,
    background: on ? "#3b82f6" : "var(--border)", transition: "background .2s" });
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 4600, background: "rgba(0,0,0,0.5)", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 14 }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 460, maxHeight: "86vh", overflowY: "auto",
        padding: "14px 16px", background: "var(--sheet-bg, var(--surface))", backdropFilter: "none", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Settings2 size={18} style={{ color: "#3b82f6" }}/>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 900, color: "var(--text)" }}>{title}</span>
          <button onClick={onClose} aria-label="Fermer" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}><X size={20}/></button>
        </div>
        {head}
        {groups.map(g => (
          <div key={g.name} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {g.name && <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)",
              marginTop: 4 }}>{g.name}</div>}
            {g.items.map(op => {
              const v = values[op.key];
              return (
                <div key={op.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{op.label}</div>
                      {op.hint && <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.4, marginTop: 1 }}>{op.hint}</div>}
                    </div>
                    {!op.choices && op.type !== "text" && !op.render && (
                      <button role="switch" aria-checked={!!v} onClick={() => onChange(op.key, !v)} style={sw(!!v)}>
                        <span style={{ position: "absolute", top: 3, left: v ? 21 : 3, width: 18, height: 18, borderRadius: "50%",
                          background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}/></button>
                    )}
                  </div>
                  {op.choices && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {op.choices.map(([cv, cl]) => <button key={String(cv)} onClick={() => onChange(op.key, cv)}
                        style={{ padding: "6px 11px", borderRadius: 20, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                          border: `1px solid ${v === cv ? "#3b82f6" : "var(--border)"}`, background: v === cv ? "rgba(59,130,246,0.12)" : "var(--surface2)",
                          color: v === cv ? "#3b82f6" : "var(--text2)" }}>{cl}</button>)}
                    </div>
                  )}
                  {op.render && <div style={{ borderRadius: 12, border: "1px solid var(--border)", padding: 10, background: "var(--surface)" }}>{op.render()}</div>}
                  {op.type === "text" && (
                    <input value={v || ""} maxLength={op.max || 80} placeholder={op.placeholder || ""} onChange={e => onChange(op.key, e.target.value)}
                      style={{ width: "100%", boxSizing: "border-box", padding: "8px 11px", borderRadius: 10, fontSize: 13,
                        border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", outline: "none" }}/>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        <button onClick={onClose} style={{ alignSelf: "flex-end", padding: "8px 14px", borderRadius: 10, border: "none", background: "#3b82f6",
          color: "#fff", fontWeight: 800, cursor: "pointer" }}>OK</button>
      </div>
    </div>, document.body);
}

const btn = (on = false) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3, minWidth: 24, height: 26,
  padding: "0 5px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 800,
  color: on ? "#0f172a" : "#fff", background: on ? "#fff" : "rgba(255,255,255,0.14)" });

// Ou l'on est : un fin trait par ecran, colle au-dessus de la barre du bas (rien ne se decale), le
// courant plus long et en couleur ; le nom de l'ecran s'affiche juste au-dessus a chaque changement.
function PageDots({ names, cur, onGo, flash }) {
  const nav = document.querySelector("nav.show-mobile");
  const bottom = (nav && nav.offsetWidth ? nav.getBoundingClientRect().height : 0) + 6;
  // a la racine de la page : un parent transforme ferait d'un « fixed » un simple « absolute »
  return createPortal(<>
    {flash != null && <div style={{ position: "fixed", left: "50%", bottom: bottom + 18, zIndex: 40, pointerEvents: "none", padding: "5px 13px",
      borderRadius: 20, fontSize: 12.5, fontWeight: 900, color: "#fff", background: "rgba(15,23,42,0.82)", boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
      whiteSpace: "nowrap", animation: "hgFlash 1.3s ease forwards" }}>{names[flash]}</div>}
    <div style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom, zIndex: 40, display: "flex", gap: 3 }}>
      {names.map((nm, i) => <button key={i} type="button" onClick={() => onGo(i)} aria-label={nm} title={nm}
        style={{ padding: "6px 2px", border: "none", background: "transparent", cursor: "pointer", display: "flex" }}>
        <span style={{ display: "block", height: 4, width: i === cur ? 26 : 10, borderRadius: 4, transition: "width .2s, background .2s",
          background: i === cur ? "#3b82f6" : "var(--muted)", opacity: i === cur ? 1 : 0.45, boxShadow: "0 0 0 1px rgba(0,0,0,0.08)" }}/></button>)}
    </div>
  </>, document.body);
}
// En reglage : des onglets nommes, et de quoi renommer, ajouter (quatre au plus) ou supprimer l'ecran courant.
function PageBar({ names, cur, onGo, renaming, setRenaming, onRename, onAdd, onDel, bannerAll, setBannerAll, hasBanner }) {
  const tab = on => ({ height: 32, padding: "0 10px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 12.5, whiteSpace: "nowrap",
    display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${on ? "#3b82f6" : "var(--border)"}`,
    background: on ? "rgba(59,130,246,0.12)" : "var(--surface2)", color: on ? "#3b82f6" : "var(--text2)" });
  return <div className="card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, border: "1px dashed rgba(59,130,246,0.5)" }}>
    <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
      Les écrans du téléphone se font glisser au doigt (après le dernier revient le premier). Touche l'écran courant pour le renommer ;
      le bouton « Écran » d'une tuile l'envoie sur l'écran de ton choix.</div>
    <div data-noswipe="" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {names.map((nm, i) => i === cur && renaming
        ? <input key={i} autoFocus defaultValue={nm.startsWith("Écran ") ? "" : nm} placeholder={nm} maxLength={PAGE_NAME_MAX}
          onBlur={e => { onRename(e.target.value.trim()); setRenaming(false); }}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(false); }}
          style={{ ...tab(true), width: 130, outline: "none", fontFamily: "inherit" }}/>
        : <button key={i} type="button" style={tab(i === cur)} onClick={() => (i === cur ? setRenaming(true) : onGo(i))}
          title={i === cur ? "Renommer cet écran" : `Aller sur « ${nm} »`}>{nm}{i === cur && <Pencil size={12}/>}</button>)}
      {onAdd && <button type="button" onClick={onAdd} style={{ ...tab(false), borderStyle: "dashed", color: "#3b82f6" }} title="Ajouter un écran (quatre au plus)">
        <Plus size={14}/>Écran</button>}
      {onDel && <button type="button" onClick={onDel} style={{ ...tab(false), marginLeft: "auto", color: "#ef4444" }} title="Supprimer cet écran">
        <Trash2 size={14}/></button>}
    </div>
    {hasBanner && names.length > 1 && <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>Bandeau d'accueil</span>
      {[[false, "sur le premier écran"], [true, "sur tous les écrans"]].map(([v, l]) => <button key={l} type="button" onClick={() => setBannerAll(v)}
        style={{ ...tab(!!bannerAll === v), height: 28 }}>{l}</button>)}
    </div>}
  </div>;
}

// Envoyer mes dispositions a d'autres comptes (administrateur) : la famille qui ne veut pas s'en occuper
function SendSheet({ onSend, onClose }) {
  const [accounts, setAccounts] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    client.get("/home/layout/accounts").then(({ data }) => setAccounts(data.accounts || [])).catch(() => setAccounts([]));
    const k = e => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const flip = u => setPicked(p => { const n = new Set(p); if (n.has(u)) n.delete(u); else n.add(u); return n; });
  const all = accounts && accounts.length > 0 && accounts.every(a => picked.has(a.username));
  const go = async () => { setBusy(true); try { await onSend([...picked]); onClose(); } finally { setBusy(false); } };
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 4600, background: "rgba(0,0,0,0.5)", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 14 }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 440, maxHeight: "86vh", overflowY: "auto",
        padding: "14px 16px", background: "var(--sheet-bg, var(--surface))", backdropFilter: "none", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Send size={18} style={{ color: "#3b82f6" }}/>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 900, color: "var(--text)" }}>Envoyer mes dispositions</span>
          <button onClick={onClose} aria-label="Fermer" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}><X size={20}/></button>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
          Les comptes cochés reçoivent une copie de <b>toutes</b> tes dispositions : téléphone et ordinateur, écrans et leurs noms, bandeau, fonds
          des tuiles. Les leurs sont remplacées. Ensuite chacun reste libre : ce qu'ils changent ne revient pas chez toi, et inversement.</div>
        {accounts == null ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Chargement…</div>
          : !accounts.length ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Aucun autre compte.</div>
          : <>
            <button type="button" onClick={() => setPicked(all ? new Set() : new Set(accounts.map(a => a.username)))}
              style={{ alignSelf: "flex-start", padding: "5px 11px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface2)",
                color: "var(--text2)", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>{all ? "Tout décocher" : "Tout cocher"}</button>
            {accounts.map(a => { const on = picked.has(a.username);
              return <button key={a.username} type="button" onClick={() => flip(a.username)} style={{ display: "flex", alignItems: "center", gap: 10,
                padding: "9px 11px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                border: `1px solid ${on ? "#3b82f6" : "var(--border)"}`, background: on ? "rgba(59,130,246,0.1)" : "var(--surface2)" }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  border: on ? "none" : "2px solid var(--border)", background: on ? "#3b82f6" : "transparent", color: "#fff" }}>{on && <Check size={14}/>}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: "var(--text)" }}>{a.username}</span>
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{a.own ? "a sa propre disposition (elle sera remplacée)" : "voit celle du compte principal"}</span>
                </span>
                {a.role === "admin" && <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)" }}>admin</span>}
              </button>; })}
          </>}
        <button type="button" disabled={!picked.size || busy} onClick={go} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
          padding: "10px 14px", borderRadius: 12, border: "none", fontWeight: 900, fontSize: 13.5, cursor: picked.size && !busy ? "pointer" : "default",
          background: picked.size ? "#3b82f6" : "var(--surface2)", color: picked.size ? "#fff" : "var(--muted)" }}>
          <Send size={15}/>{busy ? "Envoi…" : picked.size ? `Envoyer à ${picked.size} compte${picked.size > 1 ? "s" : ""}` : "Coche un ou plusieurs comptes"}</button>
      </div>
    </div>, document.body);
}

// Une tuile ne se charge qu'en approchant de l'ecran (27/10/2026) : la premiere rafale ne contient que ce qui
// se voit, celles du bas (Alertes…) suivent quand on descend. Avant, sa place est tenue (meme taille, « en attente ») ;
// une fois venue, elle reste.
const NEAR_MARGIN = "250px";
function WhenNear({ id, onNear, near, children, fallback }) {
  const ref = useRef(null);
  useEffect(() => {
    if (near || !ref.current) return undefined;
    if (typeof IntersectionObserver === "undefined") { onNear(id); return undefined; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); onNear(id); } },
      { rootMargin: `${NEAR_MARGIN} ${NEAR_MARGIN}` });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [near, id, onNear]);
  return near ? children : <div ref={ref} style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>{fallback}</div>;
}

export default function HomeGrid({ status, blocks, top = null }) {
  // les tuiles deja venues pres de l'ecran, et les donnees qu'elles demandent
  const [near, setNear] = useState(() => new Set());
  const markNear = React.useCallback(id => setNear(s => (s.has(id) ? s : new Set([...s, id]))), []);
  const want = useMemo(() => new Set([...near].flatMap(id => TILE_NEEDS[id] || [])), [near]);
  const data = useTilesData(status, want);
  const wide = useWide();
  const defs = useMemo(() => ({ ...blocks, ...TILES }), [blocks]);
  const [lay, setLay] = useState(() => defaults(defs));
  const friendId = useFriend(s => s.friend?.id);
  const [edit, setEdit] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [sel, setSel] = useState(null);
  const [pick, setPick] = useState(null);            // colonne dont la case « + » est ouverte
  const [optFor, setOptFor] = useState(null);        // tuile (id) ou « top » dont le panneau d'options est ouvert
  const [ec, setEc] = useState(null);                // en personnalisation : la disposition reglee (nombre de colonnes)
  const saved = useRef(null);
  const [inh, setInh] = useState(null);             // disposition reprise du compte principal (son nom)
  // l'ecran du telephone qu'on regarde, et son nom, montre un instant a chaque changement. Chaque arrivee sur
  // l'accueil (onglet, retour, relance) repart du premier ecran, en haut (24/10/2026 ; avant, le dernier ecran vu)
  const [page, setPageState] = useState(0);
  const loc = useLocation();
  useEffect(() => {
    setPageState(0);
    // le cadre de la page reste le meme d'une page a l'autre : il gardait le defilement de la precedente
    document.querySelector("main.page-content")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [loc.key]);
  const [flash, setFlash] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [sendFor, setSendFor] = useState(null);      // la tuile dont le choix « envoyer vers un ecran » est ouvert
  // combien de colonnes tiennent vraiment a l'ecran
  const box = useRef(null);
  const [fit, setFit] = useState(() => Math.max(1, Math.floor((window.innerWidth - 280 + 12) / (COL_MIN + 12))));
  useEffect(() => {
    const el = box.current?.parentElement;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setFit(Math.max(1, Math.floor((e.contentRect.width + 12) / (COL_MIN + 12)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [tints, setTints] = useState({});
  const [bannerTint, setBannerTint] = useState(null);
  const [bannerExact, setBannerExact] = useState(null);
  // la teinte d'une tuile : la sienne (couleurs variees), ou la meme pour toutes
  const tintOf = id => !lay.tint ? null
    : lay.tint === "banner" ? (bannerExact || { a: "#7C3AED", b: "#DB2777", c: "#F5D0FE" })
    : lay.tintColor === "one" ? (lay.tintOne === "banner" ? (bannerTint || TINTS[0]) : TINTS[lay.tintOne || 0])
    : tints[id] != null ? TINTS[tints[id]] : null;
  useLayoutEffect(() => {
    if (!lay.tint || !box.current) return;
    const rects = [...box.current.querySelectorAll("[data-hg-id]")].map(el => ({ id: el.dataset.hgId, r: el.getBoundingClientRect() }))
      .filter(x => x.r.height > 12);
    const banner = document.querySelector(".home-hello[data-hues]");
    const fixed = banner ? [{ r: banner.getBoundingClientRect(), hues: banner.dataset.hues.split(",").map(hueOf).filter(h => h != null) }] : [];
    const next = paint(rects, fixed);
    if (JSON.stringify(next) !== JSON.stringify(tints)) setTints(next);
    const bh = banner?.dataset.hues?.split(",");
    if (bh?.length >= 3 && (bh[0] !== bannerExact?.a || bh[1] !== bannerExact?.b)) setBannerExact({ a: bh[0], b: bh[1], c: bh[2] });
    if (bh?.length >= 2) {
      // la teinte du bandeau, prise dans la palette (vive) : le soir, le bandeau est presque noir
      const h = hueOf(bh[0]) ?? hueOf(bh[1]);
      const k = h == null ? 0 : TINTS.reduce((b, t, i) => hueGap(t.h, h) < hueGap(TINTS[b].h, h) ? i : b, 0);
      if (TINTS[k] !== bannerTint) setBannerTint(TINTS[k]);
    }
  });
  // ce que l'accueil montre : une colonne sur telephone, sinon ce qui tient, au plus le maximum choisi
  const showN = wide ? Math.max(1, Math.min(lay.max, fit)) : 1;
  // l'accueil sur 2, 3 ou 4 colonnes : le serveur ne le voit pas, la page le lui dit (une fois par lancement et par mode)
  useEffect(() => {
    const seen = (window.__bnCols = window.__bnCols || {});
    if (showN >= 2 && !seen[showN] && !currentFriend()) { seen[showN] = true; client.post("/home/event", { cols: showN }).catch(() => {}); }
  }, [showN]);

  useEffect(() => {
    client.get("/home/layout").then(({ data }) => {
      const l = normalize(data?.layout, defs); setLay(l); saved.current = JSON.stringify(l);
      setInh(data?.inherited ? data.from || "le compte principal" : null);
    })
      .catch(() => setLay(defaults(defs)));
    // chez un copain, pas de personnalisation : on ecraserait sa propre disposition
    const open = () => { if (!currentFriend()) setEdit(true); };
    if (new URLSearchParams(window.location.search).get("edit") === "1" && !currentFriend()) {
      setEdit(true);
      // ?tile=… : ouvre directement les reglages de cette tuile (depuis les parametres)
      const t = new URLSearchParams(window.location.search).get("tile");
      if (t) setOptFor(t);
      window.history.replaceState(null, "", window.location.pathname);
    }
    window.addEventListener("bn-home-edit", open);
    return () => window.removeEventListener("bn-home-edit", open);
  }, [friendId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (edit) setEc(showN); }, [edit]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (l, reset = false) => {
    try {
      await client.put("/home/layout", { layout: reset ? null : l, known: Object.keys(defs) });
      saved.current = JSON.stringify(l);
      if (!reset) setInh(null);
      toast(reset ? "Accueil remis par défaut" : "Disposition enregistrée", "success");
    } catch (e) { toast(e.response?.data?.detail || e.message, "error"); }
  };
  const done = () => { setEdit(false); setSel(null); setPick(null); if (JSON.stringify(lay) !== saved.current) save(lay); };
  // envoyer mes dispositions : d'abord enregistrer celle en cours (c'est la copie enregistree qui part)
  const isAdmin = useIsAdmin();
  const [sendOpen, setSendOpen] = useState(false);
  const sendTo = async to => {
    try {
      await client.put("/home/layout", { layout: lay, known: Object.keys(defs) });
      saved.current = JSON.stringify(lay); setInh(null);
      const { data } = await client.post("/home/layout/send", { to });
      toast(data.sent?.length ? `Dispositions envoyées à ${data.sent.join(", ")}` : "Aucun compte n'a reçu la disposition", data.sent?.length ? "success" : "error");
    } catch (e) { toast(e.response?.data?.detail || e.message, "error"); }
  };
  const reset = () => { const l = defaults(defs); setLay(l); save(l, true); };

  // ── la disposition affichee (ou reglee) ──
  const n = edit && ec ? (wide ? ec : 1) : showN;
  const cols = layoutFor(lay, n);
  const custom = !!lay.layouts[n];
  const shownCols = cols;
  // a une colonne : les colonnes sont des ecrans
  const paged = n === 1;
  const nPages = paged ? cols.length : 1;
  const cur = Math.min(page, nPages - 1);
  const flashT = useRef(null);
  const goPage = (i, quiet = false) => {
    setPageState(i);
    setSel(null); setPick(null); setRenaming(false);
    if (!quiet && nPages > 1) { setFlash(i); clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlash(null), 1300); }
    // l'ecran d'arrivee se lit depuis son haut, si on etait descendu plus bas (ce qui defile : le cadre de la page)
    const sc = pageScroller();
    const y = sc === document.scrollingElement ? window.scrollY : sc.scrollTop;
    const top = box.current ? box.current.getBoundingClientRect().top - (sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top) + y - 70 : 0;
    if (y > top) sc.scrollTo({ top: Math.max(0, top) });
  };
  const setNames = f => setLay(l => { const names = [...Array(nPages).keys()].map(i => l.pageNames?.[i] || ""); return { ...l, pageNames: f(names) }; });
  const addPage = () => { if (nPages >= MAX_PAGES) return; setCols([...cols.map(c => [...c]), []]); setNames(x => [...x, ""]); goPage(nPages, true); setRenaming(true); };
  const delPage = async () => {
    if (nPages < 2) return;
    const tiles = cols[cur].length;
    if (tiles && !(await showConfirm(`Supprimer l'écran « ${pageName(lay, cur)} » ? Ses ${tiles} tuile${tiles > 1 ? "s" : ""} passe${tiles > 1 ? "nt" : ""} sur l'écran ${cur ? "précédent" : "suivant"}.`,
      { confirmLabel: "Supprimer" }))) return;
    const to = cur ? cur - 1 : 1;
    const next = cols.map(c => [...c]);
    next[to].push(...next[cur]);
    next.splice(cur, 1);
    setCols(next);
    setNames(x => x.filter((_v, i) => i !== cur));
    goPage(Math.max(0, cur - 1), true);
  };
  const setCols = next => setLay(l => ({ ...l, layouts: { ...l.layouts, [n]: next } }));
  const toAuto = () => setLay(l => {
    if (Object.keys(l.layouts).length <= 1) return l;        // il en faut au moins une reglee
    const { [n]: _gone, ...rest } = l.layouts;
    return { ...l, layouts: rest };
  });
  const where = id => { for (let c = 0; c < cols.length; c++) { const i = cols[c].findIndex(x => x.id === id); if (i >= 0) return [c, i]; } return null; };
  const update = (id, patch) => setCols(cols.map(c => c.map(x => x.id === id ? { ...x, ...patch } : x)));
  const move = (id, dc, di) => {
    const p = where(id); if (!p) return;
    const next = cols.map(c => [...c]);
    const [it] = next[p[0]].splice(p[1], 1);
    const c = Math.max(0, Math.min(next.length - 1, p[0] + dc));
    const i = dc ? Math.min(p[1], next[c].length) : Math.max(0, Math.min(next[c].length, p[1] + di));
    next[c].splice(i, 0, it);
    setCols(next);
  };
  const dropOn = (targetId, colIdx) => {
    if (!dragId || dragId === targetId) return;
    const p = where(dragId); if (!p) return;
    const next = cols.map(c => [...c]);
    const [it] = next[p[0]].splice(p[1], 1);
    let placed = false;
    if (targetId) {
      for (let c = 0; c < next.length && !placed; c++) {
        const i = next[c].findIndex(x => x.id === targetId);
        if (i >= 0) { next[c].splice(i, 0, it); placed = true; }
      }
    }
    if (!placed) next[colIdx].push(it);
    setCols(next);
    setDragId(null);
  };
  const hide = id => setCols(cols.map(c => c.filter(x => x.id !== id)));
  // une tuile envoyee sur un autre ecran : en bas de celui-ci
  const toPage = (id, to) => {
    const p = where(id); if (!p || p[0] === to) return;
    const next = cols.map(c => [...c]);
    const [it] = next[p[0]].splice(p[1], 1);
    next[to].push(it);
    setCols(next); setSel(null);
    toast(`${defs[id]?.label || "Tuile"} → ${pageName(lay, to)}`, "success");
  };
  const shown = new Set(cols.flat().map(x => x.id));
  const hidden = Object.keys(defs).filter(id => !shown.has(id));
  // une tuile ajoutee va dans la colonne la moins chargee (les blocs « auto » comptent pour 3 rangees)
  const load = c => c.reduce((t, x) => t + (x.h === "auto" ? 3 : x.h) * (x.w === 2 ? 2 : 1), 0);
  const add = (id, col = null) => {
    const next = cols.map(c => [...c]);
    const ci = col ?? (paged ? cur : next.reduce((b, c, i) => load(c) < load(next[b]) ? i : b, 0));
    next[ci].push({ id, w: defs[id].w[0], h: defs[id].h[0] });
    setCols(next);
    setPick(null);
  };

  const renderItem = (item, ci) => {
    const def = defs[item.id];
    if (!def) return null;
    const p = where(item.id);
    const actions = <>
      {cols.length > 1 && (paged ? <span style={{ position: "relative", display: "inline-flex" }}>
        <button style={{ ...btn(sendFor === item.id), padding: "0 7px", gap: 4 }} onClick={() => setSendFor(f => f === item.id ? null : item.id)}
          aria-label="Envoyer vers un autre écran" title="Envoyer vers un autre écran"><Send size={12}/>Écran</button>
        {sendFor === item.id && <span style={{ position: "absolute", top: 30, left: 0, zIndex: 30, display: "flex", flexDirection: "column", gap: 4, padding: 6,
          borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 10px 26px rgba(0,0,0,0.3)", minWidth: 150 }}>
          {[...Array(nPages).keys()].filter(i => i !== p[0]).map(i => <button key={i} onClick={() => { toPage(item.id, i); setSendFor(null); }}
            style={{ textAlign: "left", padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: "var(--surface2)",
              color: "var(--text)", fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap" }}>→ {pageName(lay, i)}</button>)}
        </span>}
      </span> : <>
        <button style={btn()} disabled={p[0] === 0} onClick={() => move(item.id, -1, 0)} aria-label="Colonne de gauche"><ArrowLeft size={13}/></button>
        <button style={btn()} disabled={p[0] === cols.length - 1} onClick={() => move(item.id, 1, 0)} aria-label="Colonne de droite"><ArrowRight size={13}/></button>
      </>)}
      <button style={btn()} onClick={() => move(item.id, 0, -1)} aria-label="Monter"><ArrowUp size={13}/></button>
      <button style={btn()} onClick={() => move(item.id, 0, 1)} aria-label="Descendre"><ArrowDown size={13}/></button>
      {!def.required && <button style={btn()} onClick={() => hide(item.id)} aria-label="Masquer" title="Masquer la tuile"><EyeOff size={13}/></button>}
      <button style={{ ...btn(), marginLeft: "auto" }} onClick={() => setOptFor(item.id)} aria-label="Réglages de la tuile"
        title="Taille et options"><Settings2 size={14}/></button>
    </>;
    // les options de la tuile (oui/non, ou un choix), propres a cette disposition
    // sur un ecran tactile, une tuile qui defile capte le doigt et la page ne defile plus : on y montre ce qui tient
    const o = { ...optsOf(def, item), ...(TOUCH_ONLY ? { scroll: false } : {}) };
    // seulement les options qui servent a la taille choisie (« when ») ; elles se reglent dans leur panneau
    const usable = allOpts(def).filter(op => !op.when || op.when(item, optsOf(def, item)));
    const options = null;
    const drag = wide ? {
      dragging: dragId === item.id,
      start: e => { setDragId(item.id); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", item.id); } catch { /* rien */ } },
      over: e => { e.preventDefault(); },
      drop: e => { e.preventDefault(); dropOn(item.id, ci); },
      end: () => setDragId(null),
    } : null;
    return (
      <Cell key={item.id} item={item} def={def} edit={edit} actions={actions} options={options} drag={edit ? drag : null}
        tint={lay.tint && o._bg !== false ? tintOf(item.id) : null} tintMode={lay.tint === "banner" ? "vivid" : lay.tint} tintStyle={lay.tint === "banner" ? "banner" : lay.tint ? lay.tintStyle || "glow" : null}
        selected={sel === item.id} onSelect={() => setSel(s => s === item.id ? null : item.id)}>
        {!TILES[item.id] ? (def.frame ? <Frame def={def} item={item} summary={def.summary?.(data, status, o)} extra={def.frame.extra?.(status, item, o)}
            badge={def.frame.badge?.(status, item, o)}>{def.render(data, status, o, item)}</Frame> : def.render(data, status, o, item))
          : <WhenNear id={item.id} near={near.has(item.id)} onNear={markNear} fallback={<TileWaiting id={item.id} label={def.label} mini={item.h === 0.5}/>}>
            {tileWaiting(item.id, data, status) ? <TileWaiting id={item.id} label={def.label} mini={item.h === 0.5}/>
              : item.h === 0.5 && def.mini ? def.mini(data, status, o, item)
              : def.frame ? <Frame def={def} item={item} summary={def.summary?.(data, status, o)} extra={def.frame.extra?.(status, item, o)}
                badge={def.frame.badge?.(status, item, o)}>{def.render(data, status, o, item)}</Frame>
              : def.render(data, status, o, item)}
          </WhenNear>}
      </Cell>
    );
  };

  // le bandeau : un jeu d'options pour l'ordinateur, un pour le telephone (l'accueil a une colonne), qui reprend
  // celui de l'ordinateur tant qu'on ne l'a pas regle
  const topSet = dev => (dev === "phone" ? lay.topPhone || lay.top : lay.top) || {};
  const topOptsOf = set => top ? Object.fromEntries((top.options || []).map(op => [op.key, set[op.key] ?? op.def])) : {};
  const topOpts = topOptsOf(topSet(paged ? "phone" : "pc"));
  const [topFor, setTopFor] = useState("pc");
  const setTopOpt = (k, v) => setLay(l => topFor === "phone"
    ? { ...l, topPhone: { ...(l.topPhone || l.top || {}), [k]: v } } : { ...l, top: { ...(l.top || {}), [k]: v } });
  const topHidden = top && topOpts.show === false;
  const optItem = optFor && optFor !== "top" ? cols.flat().find(x => x.id === optFor) : null;
  const optDef = optItem ? defs[optItem.id] : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      {top && (!paged || nPages < 2 || cur === 0 || edit || !lay.bannerFirst) && (!topHidden || edit) && (
        <div style={{ position: "relative", ...(edit ? { outline: "2px dashed rgba(59,130,246,0.55)", outlineOffset: 3, borderRadius: 18 } : {}) }}>
          {/* masque : en personnalisation, une simple ligne pour pouvoir le remettre */}
          {topHidden ? <div style={{ padding: "12px 16px 16px", borderRadius: 18, background: "var(--surface2)", color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>
            Bandeau d'accueil masqué{paged ? " sur le téléphone" : " sur l'ordinateur"}</div> : top.render(topOpts)}
          {edit && <button onClick={() => { setTopFor(paged ? "phone" : "pc"); setOptFor("top"); }} aria-label="Réglages du bandeau" title="Réglages du bandeau"
            style={{ position: "absolute", left: 10, bottom: -14, zIndex: 3, display: "inline-flex",
            alignItems: "center", gap: 5, padding: "7px 9px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 12,
            color: "#fff", background: "rgba(15,23,42,0.88)", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
            <Settings2 size={15}/></button>}
        </div>
      )}
      {sendOpen && <SendSheet onSend={sendTo} onClose={() => setSendOpen(false)}/>}
      {optFor === "top" && top && <OptionsSheet title={top.label} options={top.options} values={topOptsOf(topSet(topFor))}
        onChange={setTopOpt} onClose={() => setOptFor(null)} head={(() => {
          const chip = on => ({ flex: 1, padding: "7px 11px", borderRadius: 20, cursor: "pointer", fontSize: 12.5, fontWeight: 800,
            border: `1px solid ${on ? "#3b82f6" : "var(--border)"}`, background: on ? "rgba(59,130,246,0.12)" : "var(--surface2)", color: on ? "#3b82f6" : "var(--text2)" });
          return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[["pc", "🖥️ Ordinateur"], ["phone", "📱 Téléphone"]].map(([k, l]) => <button key={k} type="button" style={chip(topFor === k)} onClick={() => setTopFor(k)}>{l}</button>)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.4 }}>
              <span style={{ flex: 1 }}>{topFor === "pc" ? "Ces réglages valent sur ordinateur et tablette (accueil en colonnes)."
                : lay.topPhone ? "Le téléphone a ses propres réglages." : "Le téléphone reprend ceux de l'ordinateur ; change un réglage ici et il aura les siens."}</span>
              {topFor === "phone" && lay.topPhone && <button type="button" onClick={() => setLay(l => { const y = { ...l }; delete y.topPhone; return y; })}
                style={{ padding: "5px 10px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)",
                  fontSize: 11.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>Comme l'ordinateur</button>}
            </div>
          </div>; })()}/>}
      {optItem && optDef && <OptionsSheet title={optDef.label} head={(() => {
        const it = optItem, d = optDef, hs = heightsOf(d, it.w);
        const chip = on => ({ padding: "6px 11px", borderRadius: 20, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
          border: `1px solid ${on ? "#3b82f6" : "var(--border)"}`, background: on ? "rgba(59,130,246,0.12)" : "var(--surface2)", color: on ? "#3b82f6" : "var(--text2)" });
        const hl = h => h === "auto" ? "selon le contenu" : h === 0.5 ? "½ (une ligne)" : `${h} rangée${h > 1 ? "s" : ""}`;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>Disposition</div>
            {d.w.length > 1 && <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", minWidth: 80 }}>Largeur</span>
              {d.w.map(w => <button key={w} style={chip(it.w === w)}
                onClick={() => { const h2 = heightsOf(d, w); update(it.id, { w, h: h2.includes(it.h) ? it.h : h2[0] }); }}>
                {w === 1 ? "demi-colonne" : "toute la colonne"}</button>)}
            </div>}
            {hs.length > 1 && <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", minWidth: 80 }}>Hauteur</span>
              {[...hs].sort((a, b) => (a === "auto" ? 9 : a) - (b === "auto" ? 9 : b)).map(h => <button key={h} style={chip(it.h === h)}
                onClick={() => update(it.id, { h })}>{hl(h)}</button>)}
            </div>}
          </div>
        );
      })()}
        options={allOpts(optDef).filter(op => !op.when || op.when(optItem, optsOf(optDef, optItem)))} values={optsOf(optDef, optItem)}
        onChange={(k, v) => update(optItem.id, { o: { ...(optItem.o || {}), [k]: v } })} onClose={() => setOptFor(null)}/>}
      <style>{`
        .hg-cols { display:grid; gap:12px; align-items:start; }
        @keyframes hgFlash { 0% { opacity:0; transform:translate(-50%, 6px) } 15%, 70% { opacity:1; transform:translate(-50%, 0) } 100% { opacity:0 } }
        .hg-col { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); column-gap:10px; grid-auto-rows:${UNIT}px; row-gap:0;
                  grid-auto-flow:row dense; min-width:0; }
        .hg-cell:not(.hg-edit):has(> div:empty) { display:none; }
        .hg-notitle .tile-head { display:none !important; }
        .hg-tint-soft { --hg-base: var(--surface); }
        .hg-tint-soft > div > .card { --surface: color-mix(in srgb, var(--hg-a) 7%, transparent); --surface2: color-mix(in srgb, var(--hg-a) 13%, transparent);
          --border: color-mix(in srgb, var(--hg-a) 24%, transparent); }
        .hg-tint-soft > div > .card { background:linear-gradient(135deg, color-mix(in srgb, var(--hg-a) 24%, var(--hg-base)), color-mix(in srgb, var(--hg-b) 9%, var(--hg-base))) !important;
          border-color:color-mix(in srgb, var(--hg-a) 30%, transparent) !important; }
        .hg-tint-vivid > div > .card { background:linear-gradient(135deg, var(--hg-a), var(--hg-b)) !important; border-color:transparent !important;
          box-shadow:0 8px 22px color-mix(in srgb, var(--hg-a) 30%, transparent) !important; color:#fff;
          --text:#fff; --text2:rgba(255,255,255,0.9); --muted:rgba(255,255,255,0.74); --surface2:rgba(255,255,255,0.16);
          --border:rgba(255,255,255,0.24); --surface:rgba(255,255,255,0.1); }
        .hg-tint-vivid > div > .card > span[aria-hidden] { display:none; }
        /* en vif, le texte est blanc partout comme sur le bandeau (les boutons gardent leurs couleurs) */
        .hg-tint-vivid > div > .card :not(button, button *, svg, svg *) { color:#fff !important; }
        .hg-tint-vivid > div > .card svg:not(button svg) { color:#fff; }
        .hg-tint-vivid.hg-ts-glow > div > .card { background:
          radial-gradient(circle at 92% -10%, rgba(255,255,255,0.38), transparent 42%),
          radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1.5px) 0 0 / 18px 18px,
          linear-gradient(120deg, var(--hg-a), var(--hg-b)) !important; }
        .hg-tint-vivid.hg-ts-bubbles > div > .card { background:
          radial-gradient(circle at calc(100% - 22px) 18px, rgba(255,255,255,0.24) 0 34px, transparent 35px),
          radial-gradient(circle at 12% calc(100% + 18px), rgba(255,255,255,0.15) 0 52px, transparent 53px),
          radial-gradient(circle at 68% 78%, rgba(255,255,255,0.11) 0 14px, transparent 15px),
          radial-gradient(circle at 40% 18%, rgba(255,255,255,0.09) 0 8px, transparent 9px),
          linear-gradient(135deg, var(--hg-a), var(--hg-b)) !important; }
        .hg-tint-vivid.hg-ts-glass > div > .card { background:
          linear-gradient(165deg, rgba(255,255,255,0.32), rgba(255,255,255,0.04) 46%, rgba(255,255,255,0) 60%),
          linear-gradient(135deg, var(--hg-a), var(--hg-b)) !important;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,0.35), inset 0 1px 0 rgba(255,255,255,0.55), 0 10px 26px color-mix(in srgb, var(--hg-a) 32%, transparent) !important; }
        .hg-tint-vivid.hg-ts-banner > div > .card { background:
          radial-gradient(circle at 88% -30%, color-mix(in srgb, var(--hg-c) 55%, transparent), transparent 55%),
          radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1.5px) 0 0 / 18px 18px,
          linear-gradient(120deg, var(--hg-a), var(--hg-b)) !important; box-shadow:0 14px 34px -18px var(--hg-b) !important; }
        /* en doux : les memes allures, en teinte legere sur le fond de la carte */
        .hg-tint-soft.hg-ts-glow > div > .card { background:
          radial-gradient(circle at 92% -10%, color-mix(in srgb, var(--hg-a) 38%, transparent), transparent 46%),
          radial-gradient(color-mix(in srgb, var(--hg-a) 30%, transparent) 1px, transparent 1.5px) 0 0 / 18px 18px,
          linear-gradient(135deg, color-mix(in srgb, var(--hg-a) 16%, var(--hg-base)), color-mix(in srgb, var(--hg-b) 6%, var(--hg-base))) !important; }
        .hg-tint-soft.hg-ts-bubbles > div > .card { background:
          radial-gradient(circle at calc(100% - 22px) 18px, color-mix(in srgb, var(--hg-a) 26%, transparent) 0 34px, transparent 35px),
          radial-gradient(circle at 12% calc(100% + 18px), color-mix(in srgb, var(--hg-b) 20%, transparent) 0 52px, transparent 53px),
          radial-gradient(circle at 68% 78%, color-mix(in srgb, var(--hg-a) 16%, transparent) 0 14px, transparent 15px),
          radial-gradient(circle at 40% 18%, color-mix(in srgb, var(--hg-a) 14%, transparent) 0 8px, transparent 9px),
          linear-gradient(135deg, color-mix(in srgb, var(--hg-a) 12%, var(--hg-base)), var(--hg-base)) !important; }
        .hg-tint-soft.hg-ts-glass > div > .card { background:
          linear-gradient(165deg, rgba(255,255,255,0.22), rgba(255,255,255,0.03) 46%, rgba(255,255,255,0) 60%),
          linear-gradient(135deg, color-mix(in srgb, var(--hg-a) 22%, var(--hg-base)), color-mix(in srgb, var(--hg-b) 10%, var(--hg-base))) !important;
          box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--hg-a) 30%, transparent), inset 0 1px 0 rgba(255,255,255,0.35) !important; }
        .hg-notitle .frame-label { display:none !important; }
        .hg-notitle .frame-head:not(:has(.frame-extra)) { display:none !important; }
        .hg-frame-body .card { background:transparent !important; border:none !important; box-shadow:none !important;
                  backdrop-filter:none !important; -webkit-backdrop-filter:none !important; padding-left:0 !important; padding-right:0 !important; }
        .hg-frame-body > * + * { margin-top:8px; }
        .hg-frame-body > div > .card:first-child { padding-top:4px !important; }
        .hg-edit > div:empty { min-height:${ROW - 10}px; border-radius:16px; background:var(--surface2); display:flex;
                  align-items:flex-end; justify-content:center; padding-bottom:12px; box-sizing:border-box; }
        .hg-edit > div:empty::before { content:"Rien à montrer pour l'instant"; font-size:12px; color:var(--muted); font-weight:700; }
        .hg-col > .hg-drop { grid-column:1 / -1; min-height:44px; border:2px dashed rgba(59,130,246,0.45); border-radius:14px;
                  display:flex; align-items:center; justify-content:center; font-size:12px; color:var(--muted); font-weight:700; }
      `}</style>
      {edit && (
        <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10,
          border: "1px solid rgba(59,130,246,0.45)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {n === 1 ? <Smartphone size={16}/> : <Monitor size={16}/>}
            <span style={{ fontWeight: 900, fontSize: 14, color: "var(--text)" }}>
              Personnaliser l'accueil · {n === 1 ? "une colonne (téléphone)" : `${n} colonnes`}</span>
            <span style={{ fontSize: 11.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20,
              background: custom ? "rgba(34,197,94,0.14)" : "var(--surface2)", color: custom ? "#16a34a" : "var(--muted)" }}>
              {custom ? "réglée" : "automatique"}</span>
            <span style={{ flex: 1 }}/>
            {custom && Object.keys(lay.layouts).length > 1 && (
              <button onClick={toAuto} title="Cette disposition se déduira à nouveau des autres" style={{ padding: "7px 10px", borderRadius: 10,
                border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                Repasser en automatique</button>
            )}
            <button onClick={reset} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 10px", borderRadius: 10,
              border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
              <RotateCcw size={14}/>Tout par défaut</button>
            {isAdmin && !currentFriend() && <button onClick={() => setSendOpen(true)} title="Envoyer toutes mes dispositions à d'autres comptes"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 10px", borderRadius: 10,
              border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
              <Send size={14}/>Envoyer</button>}
            <button onClick={done} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 10,
              border: "none", background: "#3b82f6", color: "#fff", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>
              <Check size={14}/>Terminé</button>
          </div>
          {inh && <div style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed" }}>
            Tu vois la disposition de {inh} : dès ta première modification, tu auras la tienne (la sienne ne change pas).</div>}
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
            {wide ? "Touche une tuile pour ses réglages, ou glisse-la pour la déplacer. " : "Touche une tuile pour la déplacer ou la régler. "}
            L'engrenage règle sa largeur, sa hauteur et ses options. Chaque nombre de colonnes a sa disposition ; celle à une colonne
            est aussi celle du téléphone. Une disposition « automatique » se déduit des autres tant qu'on ne la règle pas.</div>
          {/* les titres de toutes les tuiles, d'un coup (toutes les dispositions) ; chaque tuile garde son reglage ensuite */}
          {(() => {
            const all = Object.values(lay.layouts).flat(2).filter(Boolean);
            const shown = all.filter(x => x.o?._title !== false).length;
            const setAll = v => setLay(l => ({ ...l, layouts: Object.fromEntries(Object.entries(l.layouts).map(([k, cols]) =>
              [k, cols.map(c => c.map(x => ({ ...x, o: { ...(x.o || {}), _title: v } })))])) }));
            const btn = (on, label, v) => <button onClick={() => setAll(v)} style={{ height: 30, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800,
              fontSize: 12.5, border: "1px solid var(--border)", background: on ? "#3b82f6" : "var(--surface2)", color: on ? "#fff" : "var(--text2)" }}>{label}</button>;
            return <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Heading size={15} style={{ color: "var(--muted)" }}/>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", minWidth: 150 }}>Titres des tuiles</span>
              {btn(shown === all.length, "tous affichés", true)}{btn(shown === 0, "tous masqués", false)}
              {shown > 0 && shown < all.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>· {shown} sur {all.length} affichés</span>}
            </div>;
          })()}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Palette size={15} style={{ color: "var(--muted)" }}/>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", minWidth: 150 }}>Fonds des tuiles</span>
            {[[undefined, "neutres"], ["soft", "colorés doux"], ["vivid", "colorés vifs"], ["banner", "comme le bandeau"]].map(([k, l]) => <button key={l}
              onClick={() => setLay(x => { const y = { ...x }; if (k) y.tint = k; else delete y.tint; return y; })}
              style={{ height: 30, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 12.5, border: "1px solid var(--border)",
                background: lay.tint === k ? "#EC4899" : "var(--surface2)", color: lay.tint === k ? "#fff" : "var(--text2)" }}>{l}</button>)}
          </div>
          {lay.tint && lay.tint !== "banner" && <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ width: 15 }}/>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", minWidth: 150 }}>Couleurs</span>
            {[["multi", "variées"], ["one", "une seule"]].map(([k, l]) => <button key={k}
              onClick={() => setLay(x => { const y = { ...x }; if (k === "one") { y.tintColor = "one"; y.tintOne = y.tintOne ?? "banner"; } else { delete y.tintColor; delete y.tintOne; } return y; })}
              style={{ height: 30, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 12.5, border: "1px solid var(--border)",
                background: (lay.tintColor || "multi") === k ? "#EC4899" : "var(--surface2)", color: (lay.tintColor || "multi") === k ? "#fff" : "var(--text2)" }}>{l}</button>)}
            {lay.tintColor === "one" && <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={() => setLay(x => ({ ...x, tintOne: "banner" }))} title="Comme le bandeau d'accueil" style={{ height: 26, padding: "0 9px", borderRadius: 20,
                cursor: "pointer", fontSize: 11.5, fontWeight: 800, color: "#fff", border: lay.tintOne === "banner" ? "2px solid var(--text)" : "2px solid transparent",
                background: bannerTint ? `linear-gradient(135deg, ${bannerTint.a}, ${bannerTint.b})` : "#8b5cf6" }}>comme le bandeau</button>
              {TINTS.map((t, i) => <button key={i} onClick={() => setLay(x => ({ ...x, tintOne: i }))} aria-label={`Couleur ${i + 1}`}
                style={{ width: 24, height: 24, borderRadius: "50%", cursor: "pointer", background: `linear-gradient(135deg, ${t.a}, ${t.b})`,
                  border: lay.tintOne === i ? "2px solid var(--text)" : "2px solid transparent", boxShadow: "0 0 0 1px rgba(0,0,0,0.1)" }}/>)}
            </span>}
          </div>}
          {lay.tint && lay.tint !== "banner" && <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ width: 15 }}/>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", minWidth: 150 }}>Style</span>
            {TINT_STYLES.map(([k, l]) => <button key={k} onClick={() => setLay(x => ({ ...x, tintStyle: k }))}
              style={{ height: 30, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 12.5, border: "1px solid var(--border)",
                background: (lay.tintStyle || "glow") === k ? "#EC4899" : "var(--surface2)", color: (lay.tintStyle || "glow") === k ? "#fff" : "var(--text2)" }}>{l}</button>)}
            {(lay.tintColor || "multi") === "multi" && <span style={{ fontSize: 12, color: "var(--muted)" }}>· les couleurs sont choisies pour que deux voisines ne se ressemblent pas</span>}
          </div>}
          {wide && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Columns size={15} style={{ color: "var(--muted)" }}/>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", minWidth: 150 }}>Disposition à régler</span>
                {[1, 2, 3, 4].map(k => <button key={k} onClick={() => { setEc(k); setSel(null); setPick(null); }}
                  title={k === 1 ? "Une colonne : c'est aussi l'accueil du téléphone" : `${k} colonnes`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 10px", borderRadius: 9, cursor: "pointer",
                    fontWeight: 800, border: "1px solid var(--border)", background: n === k ? "#3b82f6" : "var(--surface2)",
                    color: n === k ? "#fff" : "var(--text2)" }}>
                  {k === 1 && <Smartphone size={13}/>}{k}
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: lay.layouts[k] ? "#22c55e" : "transparent",
                    border: lay.layouts[k] ? "none" : "1px solid currentColor", opacity: 0.8 }}/></button>)}
              </div>
              {/* reprendre une autre disposition : ses tuiles (tailles et options comprises), redistribuees sur n colonnes */}
              {Object.keys(lay.layouts).map(Number).some(k => k !== n) && <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Copy size={15} style={{ color: "var(--muted)" }}/>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", minWidth: 150 }}>Reprendre la disposition de</span>
                {[1, 2, 3, 4].filter(k => k !== n && lay.layouts[k]).map(k => <button key={k} title={`Remplacer la disposition à ${n} colonne${n > 1 ? "s" : ""} par celle à ${k}, redistribuée`}
                  onClick={async () => {
                    if (!(await showConfirm(n === 1 ? `Remplacer l'accueil du téléphone par la disposition à ${k} colonne${k > 1 ? "s" : ""} ? Chaque colonne devient un écran, à faire glisser.`
                      : `Remplacer la disposition à ${n} colonne${n > 1 ? "s" : ""} par celle à ${k} colonne${k > 1 ? "s" : ""} ? Les tuiles sont réparties sur ${n} colonne${n > 1 ? "s" : ""}, à réorganiser ensuite.`,
                      { confirmLabel: "Reprendre" }))) return;
                    setLay(l => ({ ...l, layouts: { ...l.layouts, [n]: n === 1
                      ? l.layouts[k].slice(0, MAX_PAGES).map(c => c.map(x => ({ ...x })))
                      : layoutFor({ layouts: { [k]: l.layouts[k] } }, n).map(c => c.map(x => ({ ...x }))) } }));
                    if (n === 1) goPage(0, true);
                    setSel(null); setPick(null);
                    client.post("/home/event", { copied: true }).catch(() => {});
                  }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 10px", borderRadius: 9, cursor: "pointer", fontWeight: 800,
                    border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)" }}>{k === 1 && <Smartphone size={13}/>}{k}</button>)}
                <span style={{ fontSize: 12, color: "var(--muted)" }}>· sur celle à {n} colonne{n > 1 ? "s" : ""}</span>
              </div>}
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Monitor size={15} style={{ color: "var(--muted)" }}/>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", minWidth: 150 }}>Au plus sur grand écran</span>
                {[1, 2, 3, 4].map(k => <button key={k} onClick={() => setLay(l => ({ ...l, max: k }))} style={{ width: 32, height: 30, borderRadius: 9,
                  cursor: "pointer", fontWeight: 800, border: "1px solid var(--border)", background: lay.max === k ? "#8B5CF6" : "var(--surface2)",
                  color: lay.max === k ? "#fff" : "var(--text2)" }}>{k}</button>)}
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  · ici, {Math.min(lay.max, fit)} colonne{Math.min(lay.max, fit) > 1 ? "s" : ""} s'affiche{Math.min(lay.max, fit) > 1 ? "nt" : ""}
                  {fit < lay.max ? ` (l'écran n'en tient que ${fit})` : ""}</span>
              </div>
            </div>
          )}
          {hidden.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>Ajouter :</span>
              {hidden.map(id => <button key={id} onClick={() => add(id)} style={{ display: "inline-flex", alignItems: "center", gap: 4,
                padding: "5px 10px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontWeight: 700, border: "1px dashed rgba(59,130,246,0.6)",
                background: "rgba(59,130,246,0.08)", color: "#3b82f6" }}><Plus size={13}/>{defs[id].label}</button>)}
            </div>
          )}
        </div>
      )}
      {(() => {
        const column = (c, ci) => (
          <div key={ci} className="hg-col">
            {c.map(item => renderItem(item, ci))}
            {edit && (
              <div className="hg-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); dropOn(null, ci); }}
                style={{ flexDirection: "column", gap: 8, padding: 10, cursor: hidden.length ? "pointer" : "default",
                  gridRow: `span ${pick === ci ? 22 : 7}`, overflow: "hidden" }}
                onClick={() => hidden.length && setPick(p => p === ci ? null : ci)}>
                {/* la case « + » : les tuiles pas encore en place, a poser dans cette colonne */}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: hidden.length ? "#3b82f6" : "var(--muted)" }}>
                  <Plus size={16}/>{hidden.length ? "Ajouter une tuile" : "Toutes les tuiles sont en place"}
                  {wide && <span style={{ color: "var(--muted)", fontWeight: 600 }}> · ou dépose-en une ici</span>}</span>
                {pick === ci && (
                  <div onClick={e => e.stopPropagation()} style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
                    {hidden.map(id => <button key={id} onClick={() => add(id, ci)} style={{ display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 11px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontWeight: 700, border: "1px solid rgba(59,130,246,0.5)",
                      background: "var(--surface)", color: "#3b82f6" }}><Plus size={13}/>{defs[id].label}</button>)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
        if (!paged) return <div ref={box} className="hg-cols" style={{ gridTemplateColumns: `repeat(${shownCols.length}, minmax(0,1fr))` }}>
          {shownCols.map(column)}</div>;
        // le telephone : les ecrans, la barre qui les nomme (en reglage : renommer, ajouter, supprimer)
        return <div ref={box} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
          ...(edit && wide ? { width: "100%", maxWidth: 420, margin: "0 auto" } : {}) }}>
          {edit && <PageBar names={[...Array(nPages).keys()].map(i => pageName(lay, i))} cur={cur} onGo={i => goPage(i, true)}
            renaming={renaming} setRenaming={setRenaming} onRename={v => setNames(x => x.map((y, i) => i === cur ? v : y))}
            onAdd={nPages < MAX_PAGES ? addPage : null} onDel={nPages > 1 ? delPage : null} hasBanner={!!top}
            bannerAll={!lay.bannerFirst} setBannerAll={v => setLay(l => { const y = { ...l }; if (v) delete y.bannerFirst; else y.bannerFirst = true; return y; })}/>}
          {!edit && nPages > 1 && <PageDots names={[...Array(nPages).keys()].map(i => pageName(lay, i))} cur={cur} onGo={i => goPage(i)} flash={flash}/>}
          <div style={{ position: "relative" }}>
            <Pager count={nPages} cur={cur} onGo={i => goPage(i)}>
              {i => <div className="hg-cols" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>{column(cols[i], i)}</div>}
            </Pager>
          </div>
        </div>;
      })()}
    </div>
  );
}
