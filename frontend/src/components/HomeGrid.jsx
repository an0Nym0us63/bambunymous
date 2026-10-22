import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, EyeOff, Plus, RotateCcw, Check, GripVertical, Columns, Monitor, Smartphone, Settings2, X, Palette } from "lucide-react";
import client from "../api/client";
import { currentFriend, useFriend } from "../store/friend";
import { toast } from "../store/toast";
import { TILES, useTilesData } from "./HomeTiles";

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
      1: [["printer", "ams", "amsdetail", ...small, "attention"].filter(id => defs[id]).map(it)],
      2: [["printer", "ams", "amsdetail"].filter(id => defs[id]).map(it), [...small, "attention"].filter(id => defs[id]).map(it)],
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
  return { id: x.id, w, h: hs.includes(x.h) ? x.h : hs[0], ...(x.o && typeof x.o === "object" ? { o: x.o } : {}) };
};
// les options d'une tuile : celles de son type (avec leur valeur par defaut), et ce que la disposition en a fait
// toutes les tuiles ont en plus une option commune : leur titre, affiche ou non
const TITLE_OPT = { key: "_title", label: "Titre de la tuile", hint: "Masqué, la tuile gagne de la place (les infos de l'en-tête restent).",
  def: true, group: "Général" };
const BG_OPT = { key: "_bg", label: "Fond coloré", hint: "Quand les fonds colorés sont activés pour l'accueil.", def: true, group: "Général" };
const allOpts = def => [TITLE_OPT, BG_OPT, ...(def.options || []).map(op => op.group ? op : { ...op, group: "Contenu" })];
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
  for (const n of [1, 2, 3, 4]) if (lay.layouts?.[n]) layouts[n] = cleanCols(lay.layouts[n], n, defs);
  if (!Object.keys(layouts).length) return defaults(defs);
  return { v: 2, max: Math.max(1, Math.min(4, parseInt(lay.max) || 2)), layouts,
    ...(lay.top && typeof lay.top === "object" ? { top: lay.top } : {}),
    ...(["soft", "vivid"].includes(lay.tint) ? { tint: lay.tint } : {}),
    ...(TINT_STYLES.some(([k]) => k === lay.tintStyle) ? { tintStyle: lay.tintStyle } : {}) };
}
// la disposition a n colonnes : la sienne, ou deduite de la plus proche reglee
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
        ...(tint ? { "--hg-a": tint.a, "--hg-b": tint.b } : {}),
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
// Les blocs historiques (imprimante, AMS, points d'attention) dans le meme cadre
// que les tuiles : pastille d'icone, titre, lueur ; leurs cartes internes aplaties.
function Frame({ def, children, extra, item, summary }) {
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
  return (
    <div className="card hg-frame" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, position: "relative",
      overflow: "hidden", height: "100%", boxSizing: "border-box", minWidth: 0 }}>
      <span aria-hidden="true" style={{ position: "absolute", right: -24, top: -24, width: 80, height: 80, borderRadius: "50%",
        background: `${color}22`, pointerEvents: "none" }}/>
      <div className="frame-head" style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
        <span data-pk="" className="frame-label" style={{ width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
          background: `${color}22`, color, flexShrink: 0 }}>{icon}</span>
        <span className="frame-label" style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", letterSpacing: ".02em" }}>{def.label}</span>
        {extra && <span className="frame-extra" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap",
          justifyContent: "flex-end" }}>{extra}</span>}
      </div>
      <div className="hg-frame-body" style={{ position: "relative", minWidth: 0, ...(fixed ? { flex: 1, minHeight: 0, overflowY: "auto" } : {}) }}>{children}</div>
    </div>
  );
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
                    {!op.choices && op.type !== "text" && (
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

export default function HomeGrid({ status, blocks, top = null }) {
  const data = useTilesData();
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
  useLayoutEffect(() => {
    if (!lay.tint || !box.current) return;
    const rects = [...box.current.querySelectorAll("[data-hg-id]")].map(el => ({ id: el.dataset.hgId, r: el.getBoundingClientRect() }))
      .filter(x => x.r.height > 12);
    const banner = document.querySelector(".home-hello[data-hues]");
    const fixed = banner ? [{ r: banner.getBoundingClientRect(), hues: banner.dataset.hues.split(",").map(hueOf).filter(h => h != null) }] : [];
    const next = paint(rects, fixed);
    if (JSON.stringify(next) !== JSON.stringify(tints)) setTints(next);
  });
  // ce que l'accueil montre : une colonne sur telephone, sinon ce qui tient, au plus le maximum choisi
  const showN = wide ? Math.max(1, Math.min(lay.max, fit)) : 1;
  // l'accueil sur 4 colonnes : le serveur ne le voit pas, la page le lui dit (une fois par lancement)
  useEffect(() => {
    if (showN === 4 && !window.__bnFour) { window.__bnFour = true; client.post("/home/event", { four: true }).catch(() => {}); }
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
  const reset = () => { const l = defaults(defs); setLay(l); save(l, true); };

  // ── la disposition affichee (ou reglee) ──
  const n = edit && ec ? (wide ? ec : 1) : showN;
  const cols = layoutFor(lay, n);
  const custom = !!lay.layouts[n];
  const shownCols = cols;
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
  const shown = new Set(cols.flat().map(x => x.id));
  const hidden = Object.keys(defs).filter(id => !shown.has(id));
  // une tuile ajoutee va dans la colonne la moins chargee (les blocs « auto » comptent pour 3 rangees)
  const load = c => c.reduce((t, x) => t + (x.h === "auto" ? 3 : x.h) * (x.w === 2 ? 2 : 1), 0);
  const add = (id, col = null) => {
    const next = cols.map(c => [...c]);
    const ci = col ?? next.reduce((b, c, i) => load(c) < load(next[b]) ? i : b, 0);
    next[ci].push({ id, w: defs[id].w[0], h: defs[id].h[0] });
    setCols(next);
    setPick(null);
  };

  const renderItem = (item, ci) => {
    const def = defs[item.id];
    if (!def) return null;
    const p = where(item.id);
    const actions = <>
      {cols.length > 1 && <>
        <button style={btn()} disabled={p[0] === 0} onClick={() => move(item.id, -1, 0)} aria-label="Colonne de gauche"><ArrowLeft size={13}/></button>
        <button style={btn()} disabled={p[0] === cols.length - 1} onClick={() => move(item.id, 1, 0)} aria-label="Colonne de droite"><ArrowRight size={13}/></button>
      </>}
      <button style={btn()} onClick={() => move(item.id, 0, -1)} aria-label="Monter"><ArrowUp size={13}/></button>
      <button style={btn()} onClick={() => move(item.id, 0, 1)} aria-label="Descendre"><ArrowDown size={13}/></button>
      {!def.required && <button style={btn()} onClick={() => hide(item.id)} aria-label="Masquer" title="Masquer la tuile"><EyeOff size={13}/></button>}
      <button style={{ ...btn(), marginLeft: "auto" }} onClick={() => setOptFor(item.id)} aria-label="Réglages de la tuile"
        title="Taille et options"><Settings2 size={14}/></button>
    </>;
    // les options de la tuile (oui/non, ou un choix), propres a cette disposition
    const o = optsOf(def, item);
    // seulement les options qui servent a la taille choisie (« when ») ; elles se reglent dans leur panneau
    const usable = allOpts(def).filter(op => !op.when || op.when(item));
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
        tint={lay.tint && o._bg !== false && tints[item.id] != null ? TINTS[tints[item.id]] : null} tintMode={lay.tint} tintStyle={lay.tint === "vivid" ? lay.tintStyle || "glow" : null}
        selected={sel === item.id} onSelect={() => setSel(s => s === item.id ? null : item.id)}>
        {item.h === 0.5 && def.mini ? def.mini(data, status, o, item)
          : def.frame ? <Frame def={def} item={item} summary={def.summary?.(data, status, o)} extra={def.frame.extra?.(status, item, o)}>{def.render(data, status, o, item)}</Frame>
          : def.render(data, status, o, item)}
      </Cell>
    );
  };

  // le bandeau : ses options (communes a toutes les dispositions)
  const topOpts = top ? Object.fromEntries((top.options || []).map(op => [op.key, lay.top?.[op.key] ?? op.def])) : {};
  const setTopOpt = (k, v) => setLay(l => ({ ...l, top: { ...(l.top || {}), [k]: v } }));
  const optItem = optFor && optFor !== "top" ? cols.flat().find(x => x.id === optFor) : null;
  const optDef = optItem ? defs[optItem.id] : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      {top && (
        <div style={{ position: "relative", ...(edit ? { outline: "2px dashed rgba(59,130,246,0.55)", outlineOffset: 3, borderRadius: 18 } : {}) }}>
          {top.render(topOpts)}
          {edit && <button onClick={() => setOptFor("top")} aria-label="Réglages du bandeau" title="Réglages du bandeau"
            style={{ position: "absolute", left: 10, bottom: -14, zIndex: 3, display: "inline-flex",
            alignItems: "center", gap: 5, padding: "7px 9px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 800, fontSize: 12,
            color: "#fff", background: "rgba(15,23,42,0.88)", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
            <Settings2 size={15}/></button>}
        </div>
      )}
      {optFor === "top" && top && <OptionsSheet title={top.label} options={top.options} values={topOpts}
        onChange={setTopOpt} onClose={() => setOptFor(null)}/>}
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
        options={allOpts(optDef).filter(op => !op.when || op.when(optItem))} values={optsOf(optDef, optItem)}
        onChange={(k, v) => update(optItem.id, { o: { ...(optItem.o || {}), [k]: v } })} onClose={() => setOptFor(null)}/>}
      <style>{`
        .hg-cols { display:grid; gap:12px; align-items:start; }
        .hg-col { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); column-gap:10px; grid-auto-rows:${UNIT}px; row-gap:0;
                  grid-auto-flow:row dense; min-width:0; }
        .hg-cell:not(.hg-edit):has(> div:empty) { display:none; }
        .hg-notitle .tile-head { display:none !important; }
        .hg-tint-soft > div > .card { background:linear-gradient(135deg, color-mix(in srgb, var(--hg-a) 24%, var(--surface)), color-mix(in srgb, var(--hg-b) 9%, var(--surface))) !important;
          border-color:color-mix(in srgb, var(--hg-a) 30%, transparent) !important; }
        .hg-tint-vivid > div > .card { background:linear-gradient(135deg, var(--hg-a), var(--hg-b)) !important; border-color:transparent !important;
          box-shadow:0 8px 22px color-mix(in srgb, var(--hg-a) 30%, transparent) !important; color:#fff;
          --text:#fff; --text2:rgba(255,255,255,0.9); --muted:rgba(255,255,255,0.74); --surface2:rgba(255,255,255,0.16);
          --border:rgba(255,255,255,0.24); --surface:rgba(255,255,255,0.1); }
        .hg-tint-vivid > div > .card > span[aria-hidden] { display:none; }
        /* en vif, le texte est blanc partout comme sur le bandeau (les boutons gardent leurs couleurs) */
        .hg-tint-vivid > div > .card :not(button, button *, svg, svg *) { color:#fff !important; }
        .hg-tint-vivid > div > .card svg:not(button svg) { color:#fff; }
        .hg-ts-glow > div > .card { background:
          radial-gradient(circle at 92% -10%, rgba(255,255,255,0.38), transparent 42%),
          radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1.5px) 0 0 / 18px 18px,
          linear-gradient(120deg, var(--hg-a), var(--hg-b)) !important; }
        .hg-ts-bubbles > div > .card { background:
          radial-gradient(circle at calc(100% - 22px) 18px, rgba(255,255,255,0.24) 0 34px, transparent 35px),
          radial-gradient(circle at 12% calc(100% + 18px), rgba(255,255,255,0.15) 0 52px, transparent 53px),
          radial-gradient(circle at 68% 78%, rgba(255,255,255,0.11) 0 14px, transparent 15px),
          radial-gradient(circle at 40% 18%, rgba(255,255,255,0.09) 0 8px, transparent 9px),
          linear-gradient(135deg, var(--hg-a), var(--hg-b)) !important; }
        .hg-ts-glass > div > .card { background:
          linear-gradient(165deg, rgba(255,255,255,0.32), rgba(255,255,255,0.04) 46%, rgba(255,255,255,0) 60%),
          linear-gradient(135deg, var(--hg-a), var(--hg-b)) !important;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,0.35), inset 0 1px 0 rgba(255,255,255,0.55), 0 10px 26px color-mix(in srgb, var(--hg-a) 32%, transparent) !important; }
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
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Palette size={15} style={{ color: "var(--muted)" }}/>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", minWidth: 150 }}>Fonds des tuiles</span>
            {[[undefined, "neutres"], ["soft", "colorés doux"], ["vivid", "colorés vifs"]].map(([k, l]) => <button key={l}
              onClick={() => setLay(x => { const y = { ...x }; if (k) y.tint = k; else delete y.tint; return y; })}
              style={{ height: 30, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 12.5, border: "1px solid var(--border)",
                background: lay.tint === k ? "#EC4899" : "var(--surface2)", color: lay.tint === k ? "#fff" : "var(--text2)" }}>{l}</button>)}
          </div>
          {lay.tint === "vivid" && <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ width: 15 }}/>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", minWidth: 150 }}>Style</span>
            {TINT_STYLES.map(([k, l]) => <button key={k} onClick={() => setLay(x => ({ ...x, tintStyle: k }))}
              style={{ height: 30, padding: "0 11px", borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 12.5, border: "1px solid var(--border)",
                background: (lay.tintStyle || "glow") === k ? "#EC4899" : "var(--surface2)", color: (lay.tintStyle || "glow") === k ? "#fff" : "var(--text2)" }}>{l}</button>)}
            <span style={{ fontSize: 12, color: "var(--muted)" }}>· les couleurs sont choisies pour que deux voisines ne se ressemblent pas</span>
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
      <div ref={box} className="hg-cols" style={{ gridTemplateColumns: `repeat(${shownCols.length}, minmax(0,1fr))`,
        ...(edit && wide && n === 1 ? { width: "100%", maxWidth: 420, margin: "0 auto" } : {}) }}>
        {shownCols.map((c, ci) => (
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
        ))}
      </div>
    </div>
  );
}
