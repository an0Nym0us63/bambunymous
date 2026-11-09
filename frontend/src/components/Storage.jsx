import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import CardHelp from "./CardHelp";
import SpoolSVG from "./SpoolSVG";
import { FSheet, fBtn } from "./FicheKit";
import { openMenu } from "./ContextMenu";
import { showAlert, showConfirm, showChoice } from "../utils/dialog";
import { parseColorsList, finishOf } from "../utils/colors";
import { Archive, HelpCircle, Inbox, Layers, Package, Printer, Truck } from "lucide-react";
import { useRfidScan } from "../store/rfidScan";
import { haptic } from "../utils/haptic";
import { usePrinter } from "../store/printer";
import { amsName, slotLabel, isExternal, isHt, grilleAccueil, lireDisposition, columnWeight, slotCount } from "../utils/ams";
import { colorBg, trayBg, bgWithTop } from "../utils/colors";
import { toast } from "../store/toast";

// Les rangements des bobines (07/11/2026) : le mode (un seul rangement, chaque bobine a sa place, rangement manuel),
// l'arbre des emplacements (Tiroir 1 › Colonne 1 › Ligne 3, Rack 1 › A2…), ranger une bobine, les bobines « À ranger »
// et la vue du stock par rangement. Le serveur tient tout (services/storage_places.py) ; ici, un seul chargement
// partage par toutes les vues, recharge apres chaque changement.

export const STORAGE_MODES = [
  // [cle, icone, nom, explication (dans le ?), en bref (sur la carte, 09/11/2026)]
  ["single", "🗄", "Un seul rangement", "Tout ce qui sort de l'imprimante va au même endroit. C'est le mode d'origine ; donne-lui le nom que tu veux (Tiroir, Étagère, Placard…).", "Tout au même endroit"],
  ["assigned", "📍", "Chaque bobine a sa place", "Une bobine est dans l'imprimante ou à SA place, rien d'autre : en sortant de l'AMS, elle y retourne d'office. Une case ne prend qu'une bobine, gardée pendant qu'elle est dans l'AMS.", "Elle retourne à sa case"],
  ["manual", "✋", "Je range où je veux", "Une bobine qui sort de l'AMS (ou qui arrive) passe « À ranger » et l'appli te rappelle de dire où tu l'as mise. Aucune case n'est à une bobine : partie dans l'imprimante, elle libère la sienne.", "Tu dis où tu l'as mise"],
];

let _data = null, _loading = null, _ver = 0;
const _subs = new Set();
const _emit = () => _subs.forEach(f => f(_data));
const _set = (d, write = false) => { _data = { ...d, _v: write ? ++_ver : _ver }; _emit(); return _data; };

export function reloadStorage() {
  if (!_loading) _loading = client.get("/storage").then(r => _set(r.data)).catch(() => _data).finally(() => { _loading = null; });
  return _loading;
}

export function useStorage() {
  const [d, setD] = useState(_data);
  useEffect(() => {
    _subs.add(setD);
    if (_data) setD(_data); else reloadStorage();
    return () => { _subs.delete(setD); };
  }, []);
  return d;
}

const foldTxt = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const errMsg = e => { const d = e?.response?.data?.detail; return typeof d === "string" ? d : d?.message || e?.message || "Erreur"; };

async function write(method, url, body) {
  try {
    const { data } = await client[method](url, body);
    _set(data, true);
    return data;
  } catch (e) { showAlert(errMsg(e)); return null; }
}

// Ranger des bobines a une place ; une case prise par une autre : on propose de la deloger (elle repasse « À ranger »).
export async function assignSpools(ids, placeId) {
  try {
    const { data } = await client.post("/storage/assign", { spool_ids: ids, place_id: placeId });
    rememberPlace(placeId);
    return _set(data, true);
  } catch (e) {
    const d = e?.response?.data?.detail;
    if (e?.response?.status === 409 && d?.occupant) {
      if (!(await showConfirm(`${d.message}.\nLa déloger ? Elle repassera « À ranger ».`, { confirmLabel: "Déloger et ranger ici" }))) return null;
      try {
        const { data } = await client.post("/storage/assign", { spool_ids: ids, place_id: placeId, force: true });
        rememberPlace(placeId);
        return _set(data, true);
      } catch (e2) { showAlert(errMsg(e2)); return null; }
    }
    showAlert(errMsg(e));
    return null;
  }
}

const RECENT = "bn_recent_places";
function rememberPlace(id) {
  if (id == null) return;
  try {
    const l = JSON.parse(localStorage.getItem(RECENT) || "[]").filter(x => x !== id);
    localStorage.setItem(RECENT, JSON.stringify([id, ...l].slice(0, 6)));
  } catch { /* indisponible */ }
}
function recentPlaces() { try { return JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch { return []; } }

export const inPrinter = loc => /^(AMS|EXTERNE|HT-)/i.test((loc || "").trim());
export const unitOf = loc => {
  const l = (loc || "").trim();
  if (/^AMS HT-/i.test(l)) return l.slice(4);
  return l.replace(/ slot \d+$/i, "");
};

// la disposition du contenu d'un rangement ou d'une zone (07/11/2026) : l'ordre affiche et la grille. layout : auto, col
// (en colonne), row (en ligne), grid (cols par ligne) ; rev : le 1 en bas (colonne, grille : les rangees remontent) ou a
// droite (ligne). many : la zone a des soeurs, en auto elle se range en colonne.
export function arrange(list, p, many, fallback) {
  const n = list.length, lay = p.layout || "auto";
  const cols = lay === "col" ? 1 : lay === "row" ? Math.max(1, n) : lay === "grid" ? (p.cols || 3) : (p.cols || (many ? 1 : null));
  let items = list;
  if (p.rev) {
    if (!cols || cols === 1 || lay === "row") items = [...list].reverse();
    else { const rows = []; for (let i = 0; i < n; i += cols) rows.push(list.slice(i, i + cols)); items = rows.reverse().flat(); }
  }
  return { items, tpl: cols ? `repeat(${cols}, minmax(0, 1fr))` : fallback };
}
const layTxt = p => ({ col: "en colonne", row: "en ligne", grid: `grille de ${p.cols || 3}` }[p.layout] || (p.cols ? `${p.cols} par ligne` : "automatique")) + (p.rev ? " · 1 en bas" : "");

function index(st) {
  const by = {}, kids = {};
  for (const p of st?.places || []) { by[p.id] = p; (kids[p.parent_id ?? "root"] ||= []).push(p); }
  return { by, kids, roots: kids.root || [] };
}

const agoTxt = iso => {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(String(iso).replace(" ", "T") + (/[Zz+]/.test(String(iso).slice(10)) ? "" : "Z")).getTime()) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  if (m < 1440) return `il y a ${Math.floor(m / 60)} h`;
  return `il y a ${Math.floor(m / 1440)} j`;
};

// une bobine en petit : sa couleur (depuis une fiche bobine du stock, ou le resume de l'arbre)
function Swatch({ s, size = 28, dim = false }) {
  const colors = parseColorsList(s.filament_color ?? s.color, s.filament_colors_array ?? s.colors_array);
  return <span style={{ display: "inline-flex", opacity: dim ? 0.4 : 1, flexShrink: 0 }}>
    <SpoolSVG colors={colors} finish={finishOf(s)} size={size} type={s.filament_multicolor_type ?? s.multicolor_type}/></span>;
}
// une bobine vue sur la tranche (07/11/2026) : comme dans le tiroir, couchee, ses deux flasques dessus et dessous et le
// filament enroule entre, en large bande a sa couleur (plusieurs couleurs : en bandes) ; vertical : la meme, debout
// (flasques a gauche et a droite).
export function SpoolEdge({ s, vertical = false, len = "100%", thick = 18, dim = false }) {
  const cs = parseColorsList(s.filament_color ?? s.color, s.filament_colors_array ?? s.colors_array) || [];
  const list = cs.length ? cs : ["#94a3b8"];
  const along = vertical ? "180deg" : "90deg";         // le long de la bande
  const across = vertical ? "90deg" : "180deg";        // en travers : les spires
  const fill = list.length > 1 ? `linear-gradient(${along}, ${list.map((c, i) => `${c} ${i / list.length * 100}% ${(i + 1) / list.length * 100}%`).join(", ")})` : list[0];
  const wind = `repeating-linear-gradient(${across}, rgba(0,0,0,.13) 0 1px, transparent 1px 3px)`;
  const shade = `linear-gradient(${along}, rgba(0,0,0,.22), rgba(255,255,255,.18) 30%, transparent 55%, rgba(0,0,0,.25))`;
  // la matiere (07/11/2026 : la tranche etait d'une couleur plate) : le rendu des pastilles (finition, transparence), puis
  // le volume et les spires par-dessus ; plusieurs couleurs : en bandes le long de la tranche
  const base = list.length > 1 ? { background: fill }
    : colorBg(list, s.filament_multicolor_type ?? s.multicolor_type, finishOf(s), { size: 40 });
  const band = bgWithTop(bgWithTop(base, shade), wind);
  const fl = { flexShrink: 0, background: "linear-gradient(" + along + ", #cbd5e1, #f8fafc 40%, #e2e8f0)", borderRadius: 2,
    boxShadow: "0 0 0 1px rgba(15,23,42,.18)", [vertical ? "width" : "height"]: typeof thick === "number" ? Math.max(2, Math.round(thick / 7)) : 3 };
  return <span aria-hidden="true" style={{ display: "flex", flexDirection: vertical ? "row" : "column", alignItems: "stretch", flexShrink: 0, opacity: dim ? 0.4 : 1,
    width: vertical ? thick : len, height: vertical ? len : thick }}>
    <span style={fl}/>
    <span style={{ flex: 1, margin: vertical ? "5% 0" : "0 5%", ...band, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)" }}/>
    <span style={fl}/>
  </span>;
}
// comment un rangement montre ses bobines : la pastille, ou la tranche (h a plat, v debout), pose sur le rangement
// la vue des bobines (09/11/2026 : reglable par zone) : celle de la zone la plus proche qui en a une, sinon du rangement ;
// « p » = pastille choisie expres (une zone en pastille dans un rangement sur la tranche)
const edgeOf = (p, by) => { let q = p, seen = 0; while (q && seen++ < 20) { if (q.edge) return q.edge === "p" ? null : q.edge; q = q.parent_id != null ? by[q.parent_id] : null; } return null; };
const EDGE_TXT = { h: "sur la tranche, à plat", v: "sur la tranche, debout", p: "pastille", s: "petites pastilles", c: "dans leur carton" };
// les cases des rangements (08/11/2026) : le meme dessin dans la vue du stock et la fenetre d'un rangement ; le texte suit
// la largeur de la case (le nom toujours, sur une ligne quand c'est etroit ; rien que la tranche dans une toute petite case)
const CELL_CSS = `.bn-cell{position:relative;container-type:inline-size;display:flex;flex-direction:column;align-items:stretch;gap:2px;min-width:0;
        padding:3px 3px 4px;border-radius:10px;border:1px solid color-mix(in srgb,#8B5CF6 22%,var(--border));background:var(--surface);color:var(--text);
        overflow:hidden;font:inherit;text-align:center;transition:transform .12s, box-shadow .12s}
      .bn-cell:not(.bn-free):hover{transform:translateY(-1px);box-shadow:0 6px 14px -8px rgba(15,23,42,.35)}
      .bn-cell.bn-free{min-height:40px;justify-content:center;align-items:center;background:transparent;border:1.5px dashed color-mix(in srgb,var(--border) 85%,transparent)}
      .bn-num-free{font-size:12px;font-weight:900;color:var(--muted);opacity:.75}
      .bn-band{position:relative;display:flex;justify-content:center;align-items:center;min-height:24px;overflow:hidden;border-radius:6px}
      .bn-num{align-self:flex-start;font-size:9.5px;font-weight:900;line-height:1;color:var(--muted);margin:-1px 0 -1px 1px}
      .bn-slot{position:absolute;top:5px;left:5px;min-width:19px;height:19px;padding:0 5px;box-sizing:border-box;border-radius:10px;display:flex;align-items:center;
        justify-content:center;font-size:10.5px;font-weight:900;line-height:1;color:#fff;background:linear-gradient(135deg,#0EA5E9,#6366F1);
        box-shadow:0 3px 8px -3px rgba(79,70,229,.7),inset 0 1px 0 rgba(255,255,255,.35);pointer-events:none;z-index:1}
      .bn-ct-name{font-size:11px;font-weight:900;line-height:1.15;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
      .bn-ct-sub{font-size:9px;font-weight:700;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      @container (max-width:84px){.bn-ct-sub{display:none}.bn-ct-name{font-size:10px;-webkit-line-clamp:1}}
      .bn-pastille{display:inline-flex}.bn-pastille svg{width:96cqw;height:auto}
      .bn-tight{padding:2px;border-radius:8px;gap:0;background:transparent;border-color:transparent;box-shadow:none}
      .bn-tight:not(.bn-free):hover{transform:translateY(-1px) scale(1.04);background:radial-gradient(closest-side,color-mix(in srgb,#8B5CF6 22%,transparent),transparent);box-shadow:none}
      .bn-cell.bn-free.bn-tightf{border-width:1px;border-color:color-mix(in srgb,var(--border) 70%,transparent)}.bn-tight .bn-num{position:absolute;top:1px;left:2px;margin:0;z-index:1;padding:0 3px;border-radius:5px;font-size:8.5px;line-height:12px;
        background:color-mix(in srgb,var(--surface) 82%,transparent)}
      .bn-tight .bn-band{min-height:0}
      .bn-match{border:2px solid #F59E0B;box-shadow:0 0 0 2px color-mix(in srgb,#F59E0B 30%,transparent),0 0 14px -2px rgba(245,158,11,.75);animation:bnMatch 1.6s ease-in-out 2}
      @keyframes bnMatch{50%{box-shadow:0 0 0 4px color-mix(in srgb,#F59E0B 18%,transparent),0 0 20px 0 rgba(245,158,11,.9)}}
      .bn-cell.bn-free.bn-tightf{min-height:30px;padding:2px;border-radius:8px}
      @container (max-width:34px){.bn-ct-name{display:none}.bn-cell{padding:3px}.bn-num{font-size:8.5px}}`;
// condense (09/11/2026) : la largeur fixe d'une case selon la vue de ses bobines (debout, couchee, pastille), et la grille
// qui en decoule (rien ne s'etire pour remplir la largeur)
// les bobines d'un emplacement en vrac (09/11/2026) : sa disposition (en colonne, en ligne, en grille), d'office 6 par ligne
const vracCols = (p, n) => Math.max(1, p.layout === "col" ? 1 : p.layout === "row" ? n : p.layout === "grid" ? (p.cols || 3) : (p.cols || Math.min(n, 6)));
const CELL_W = e => e === "c" ? 40 : e === "s" ? 22 : e === "v" ? 40 : e ? 84 : 50;
// minmax(0, …) (09/11/2026) : sur un telephone, les cases retrecissent plutot que de deborder ; jamais plus larges que w
const tightTpl = (tpl, w, n) => tpl.includes("auto-fill") ? `repeat(${Math.max(1, Math.min(n, 6))}, minmax(0, ${w}px))` : tpl.replace(/minmax\(0, 1fr\)/g, `minmax(0, ${w}px)`);
// la largeur d'une zone parmi ses soeurs (08/11/2026) : span colonnes, -1 toute la largeur ; elargie, ses cases vont en grille
const spanOf = p => p.span === -1 ? { gridColumn: "1 / -1" } : p.span > 1 ? { gridColumn: `span ${p.span}` } : {};
const wide = p => p.span === -1 || p.span > 1;
// l'epaisseur de la tranche couchee suit la largeur de la case (unites de conteneur) : les proportions d'une bobine
const EDGE_H = "clamp(20px, 30cqw, 46px)";
const infoOf = (occ, full) => [full?.filament_fila_type || full?.filament_material || occ?.material, full?.filament_manufacturer || occ?.brand].filter(Boolean);

// les icones des rangements (07/11/2026 : des emojis 🗄 📥, illisibles sur telephone) : dessinees, a la couleur de la
// section ; une icone choisie par l'utilisateur (emoji, p.icon) reste la sienne
const PlaceIco = ({ p, size = 16 }) => p?.icon ? <span style={{ fontSize: size }}>{p.icon}</span>
  : React.createElement(p?.stock ? Package : p?.leaf && !p?.single ? Layers : Archive, { size, strokeWidth: 2.2 });
const icoBox = (c, size = 30, r = 10) => ({ width: size, height: size, borderRadius: r, display: "grid", placeItems: "center", flexShrink: 0, color: c,
  background: `color-mix(in srgb, ${c} 16%, var(--surface))`, border: `1px solid color-mix(in srgb, ${c} 35%, var(--border))` });

const spoolName = s => s.filament_translated_name || s.filament_name || s.name || `Bobine #${s.id}`;

// une bobine en commande (09/11/2026) : son carton, vu de trois quarts dessus. Kraft, plat et large ; en facade l'etiquette
// blanche en pilule (le type a gauche, des lignes de donnees, la pastille de sa couleur a droite) et un tampon rond.
// son carton (09/11/2026), de face : debout, ouvert en haut, deux rabats ecartes ; la bobine sur la tranche depasse un
// peu (le filament a sa couleur, stries verticales, entre deux flasques minces ; une recharge, sans bobine : le filament
// seul). Kraft fibre, l'etiquette en pilule a la verticale (le type, la pastille de sa couleur). En commande, et dans le
// stock en vue « cartons ».
function SpoolBox({ s, h = 84 }) {
  const cs = parseColorsList(s.filament_color ?? s.color, s.filament_colors_array ?? s.colors_array) || [];
  const c0 = cs[0] || "#94A3B8", c1 = cs[1] || c0;
  const refill = !!s.order_refill, id = `sbx${s.id}`;
  // l'effet de sa finition sur l'etiquette (09/11/2026) : soie et metal brillent, mat reste plat, paillettes et galaxie
  // scintillent
  const fin = String(finishOf(s) || "").toLowerCase();
  const shine = /silk|soie|metal|chrome|satin/.test(fin) ? .55 : /matte|mat/.test(fin) ? .08 : .25;
  const sparkle = /sparkle|paillet|galax|glitter/.test(fin);
  return <svg width={h * 0.5} height={h} viewBox="0 0 50 100" style={{ display: "block" }} aria-hidden="true">
    <defs>
      <linearGradient id={`${id}f`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#B6925C"/><stop offset=".5" stopColor="#CBAA79"/><stop offset="1" stopColor="#B6925C"/></linearGradient>
      <linearGradient id={`${id}c`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={c0}/><stop offset=".5" stopColor={c1}/><stop offset="1" stopColor={c0}/></linearGradient>
      <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="rgba(0,0,0,.22)"/><stop offset=".4" stopColor="rgba(255,255,255,.3)"/><stop offset="1" stopColor="rgba(0,0,0,.24)"/></linearGradient>
      <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c0}/><stop offset="1" stopColor={c1}/></linearGradient>
      <linearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="rgba(255,255,255,0)"/><stop offset=".42" stopColor={`rgba(255,255,255,${shine})`}/><stop offset=".5" stopColor="rgba(255,255,255,0)"/><stop offset=".78" stopColor={`rgba(255,255,255,${shine * .6})`}/><stop offset="1" stopColor="rgba(255,255,255,0)"/></linearGradient>
      <pattern id={`${id}k`} width="7" height="5" patternUnits="userSpaceOnUse">
        <path d="M0 1.2h3.4M4.2 3.6h2.6M1.4 4.6h1.6" stroke="rgba(110,75,35,.16)" strokeWidth=".45"/>
        <path d="M5 .6h1.6M.6 2.6h1.8" stroke="rgba(255,240,215,.16)" strokeWidth=".4"/>
      </pattern>
    </defs>
    <ellipse cx="25" cy="97.5" rx="21" ry="2.1" fill="rgba(15,23,42,.18)"/>
    {refill
      ? <path d="M12 40 V15 Q12 10 17 10 H33 Q38 10 38 15 V40 Z" fill={`url(#${id}c)`}/>
      : <path d="M13 40 V15 Q13 10 17.5 10 H32.5 Q37 10 37 15 V40 Z" fill={`url(#${id}c)`}/>}
    <path d={refill ? "M12 40 V15 Q12 10 17 10 H33 Q38 10 38 15 V40 Z" : "M13 40 V15 Q13 10 17.5 10 H32.5 Q37 10 37 15 V40 Z"} fill={`url(#${id}g)`}/>
    {[...Array(refill ? 9 : 8)].map((_, i) => <line key={i} x1={(refill ? 14.3 : 15) + i * 2.9} x2={(refill ? 14.3 : 15) + i * 2.9} y1="11.5" y2="40" stroke="rgba(0,0,0,.13)" strokeWidth=".45"/>)}
    {!refill && <>
      <path d="M11 40 V13 Q11 7 13 7 V40 Z" fill="#E7E5DF" stroke="#BDBAB1" strokeWidth=".45"/>
      <path d="M39 40 V13 Q39 7 37 7 V40 Z" fill="#D9D6CE" stroke="#BDBAB1" strokeWidth=".45"/>
    </>}
    <polygon points="5,28 1.5,13 6.5,11.5 8.5,28" fill="#C3A271" stroke="#A98657" strokeWidth=".55"/>
    <polygon points="45,28 48.5,13 43.5,11.5 41.5,28" fill="#B9976A" stroke="#A98657" strokeWidth=".55"/>
    <rect x="5" y="28" width="40" height="68" rx="1.4" fill={`url(#${id}f)`} stroke="#A98657" strokeWidth=".65"/>
    <rect x="5" y="28" width="40" height="68" rx="1.4" fill={`url(#${id}k)`}/>
    <rect x="5" y="28" width="40" height="2.3" fill="rgba(0,0,0,.12)"/>
    <line x1="5.8" y1="31" x2="5.8" y2="95" stroke="rgba(255,240,215,.22)" strokeWidth=".6"/>
    <circle cx="38.5" cy="37" r="3.4" fill="none" stroke="rgba(120,80,40,.35)" strokeWidth=".65"/>
    {/* l'etiquette (09/11/2026) : un contour blanc, et dedans toute la couleur du filament avec l'effet de sa finition */}
    <rect x="17.5" y="37" width="15" height="53" rx="7.5" fill="#FBFBF9" stroke="rgba(0,0,0,.12)" strokeWidth=".5"/>
    <rect x="19.3" y="38.8" width="11.4" height="49.4" rx="5.7" fill={`url(#${id}l)`}/>
    <rect x="19.3" y="38.8" width="11.4" height="49.4" rx="5.7" fill={`url(#${id}h)`}/>
    {sparkle && [[22, 45], [27, 52], [23.5, 61], [28, 70], [22.5, 78], [26.5, 84]].map(([x, y], i) =>
      <circle key={i} cx={x} cy={y} r=".7" fill="rgba(255,255,255,.85)"/>)}
  </svg>;
}

// la fiche d'identite d'une bobine au survol (09/11/2026) : une carte qui apparait au-dessus de la case (souris seulement ;
// au toucher, la case ouvre sa fiche ou sa fenetre). idTip(s, extra) a poser sur l'element ; <SpoolIdHost/> une fois par vue.
const _idTip = { cur: null, subs: new Set() };
const idTipSet = v => { _idTip.cur = v; _idTip.subs.forEach(f => f(v)); };
const idTip = (s, extra = null) => s ? {
  onPointerEnter: e => { if (e.pointerType === "mouse") idTipSet({ s, extra, r: e.currentTarget.getBoundingClientRect() }); },
  onPointerLeave: e => { if (e.pointerType === "mouse") idTipSet(null); },
  onPointerDown: () => idTipSet(null),
} : {};
function SpoolIdHost() {
  const [t, setT] = useState(null);
  useEffect(() => { const f = v => setT(v); _idTip.subs.add(f); const off = () => idTipSet(null);
    window.addEventListener("scroll", off, true); return () => { _idTip.subs.delete(f); window.removeEventListener("scroll", off, true); }; }, []);
  if (!t) return null;
  const { s, extra, r } = t, W = 250;
  const hex = (parseColorsList(s.filament_color ?? s.color, s.filament_colors_array ?? s.colors_array)[0] || "#8B5CF6").replace(/^#?/, "#").slice(0, 7);
  const g = s.remaining_weight_g, full = s.filament_weight_g || 1000, pct = g != null ? Math.max(0, Math.min(100, g / full * 100)) : null;
  const above = r.top > 190, left = Math.max(8, Math.min(window.innerWidth - W - 8, r.left + r.width / 2 - W / 2));
  const mat = s.filament_fila_type || s.filament_material || s.material, brand = s.filament_manufacturer || s.brand;
  return createPortal(<div style={{ position: "fixed", left, top: above ? r.top - 8 : r.bottom + 8, transform: above ? "translateY(-100%)" : "none", width: W, zIndex: 9000,
    pointerEvents: "none", borderRadius: 18, overflow: "hidden", color: "var(--text)", animation: "bnIdIn .16s cubic-bezier(.2,.9,.3,1.2)",
    background: `linear-gradient(150deg, color-mix(in srgb, ${hex} 30%, transparent) 0%, transparent 62%), var(--sheet-bg, #111827)`, backdropFilter: "blur(10px)",
    border: `1px solid color-mix(in srgb, ${hex} 45%, var(--border))`, boxShadow: `0 18px 40px -12px rgba(15,23,42,.55), 0 0 0 1px rgba(255,255,255,.04) inset` }}>
    <style>{"@keyframes bnIdIn{from{opacity:0;transform:translateY(" + (above ? "-94%" : "6%") + ") scale(.96)}to{opacity:1}}"}</style>
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 12px 10px" }}>
      <div style={{ filter: `drop-shadow(0 6px 10px color-mix(in srgb, ${hex} 45%, transparent))` }}><Swatch s={s} size={58}/></div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 900, lineHeight: 1.2, overflowWrap: "anywhere" }}>{spoolName(s)}</div>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text2)", marginTop: 2 }}>{[mat, brand].filter(Boolean).join(" · ")}</div>
        <div style={{ display: "inline-block", marginTop: 5, padding: "1px 7px", borderRadius: 8, fontSize: 10.5, fontWeight: 900, letterSpacing: ".04em",
          background: `color-mix(in srgb, ${hex} 22%, var(--surface2))`, color: "var(--text2)" }}>#{s.id}</div>
      </div>
    </div>
    {g != null && <div style={{ padding: "0 12px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 800, color: "var(--muted)", marginBottom: 4 }}>
        <span>Reste</span><span style={{ color: "var(--text)", fontWeight: 900 }}>{Math.round(g)} g{pct != null ? ` · ${Math.round(pct)} %` : ""}</span></div>
      <div style={{ height: 6, borderRadius: 4, background: "var(--surface2)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: `linear-gradient(90deg, color-mix(in srgb, ${hex} 70%, #ffffff), ${hex})` }}/></div>
    </div>}
    {(extra || s.location) && <div style={{ padding: "7px 12px 9px", borderTop: "1px dashed var(--border)", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
      📍 {extra || s.location}</div>}
  </div>, document.body);
}

const seg = { padding: "7px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)",
  fontSize: 12.5, fontWeight: 800, cursor: "pointer" };
const segOn = { background: "linear-gradient(135deg, #8B5CF6, #6366F1)", color: "#fff", border: "1px solid transparent" };
const inp = { width: "100%", boxSizing: "border-box", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
  padding: "8px 10px", fontSize: 13.5, fontWeight: 700, color: "var(--text)", outline: "none" };
const small = { fontSize: 11.5, fontWeight: 700, color: "var(--muted)" };

// ── Parametres › Filaments : le mode et les rangements ───────────────────────
// (07/11/2026, refait) une seule philosophie : un rangement contient des emplacements, directement (« 12 emplacements »)
// ou par zones nommees (« Colonne 1 : 7, Colonne 2 : 7, Colonne 3 : 3, Dessus : 4 ») ; un emplacement s'appelle
// « zone-numero » (« Colonne 1-3 »), ou son numero sans zone. La liste ne montre que les rangements ; un clic ouvre sa
// fenetre, avec ses zones et ses cases, ou tout se retouche.
const leafCountOf = (p, kids) => p.leaf ? 1 : (kids[p.id] || []).reduce((n, c) => n + leafCountOf(c, kids), 0);
const takenOf = (p, kids) => p.leaf ? (p.spools.length ? 1 : 0) : (kids[p.id] || []).reduce((n, c) => n + takenOf(c, kids), 0);
// (09/11/2026) les bobines rangees : un emplacement en vrac en tient plusieurs, « 3 pris » ne dit pas combien
const bobTxt = (p, kids, t) => { const b = spoolsOf(p, kids); return b !== t ? ` · ${b} bobine${b > 1 ? "s" : ""}` : ""; };
const spoolsOf = (p, kids) => p.leaf ? p.spools.length : (kids[p.id] || []).reduce((n, c) => n + spoolsOf(c, kids), 0);
// le nom court d'un emplacement dans sa zone : « Colonne 1-3 » -> « 3 »
export const shortName = (p, by) => { const par = by?.[p.parent_id]; return par && p.name.startsWith(par.name + "-") ? p.name.slice(par.name.length + 1) : p.name; };
// le numero suivant d'une zone (ou d'un rangement) : apres le plus grand « …-n » ou « n » de ses emplacements
const nextNum = (p, kids) => 1 + Math.max(0, ...(kids[p.id] || []).map(c => parseInt((c.name.match(/(\d+)$/) || [])[1] || "0", 10)));
const cellName = (zone, n) => zone ? `${zone}-${n}` : String(n);

async function delPlace(p, kids) {
  const n = spoolsOf(p, kids), sub = (kids[p.id] || []).length;
  if (!(await showConfirm(`Supprimer « ${p.path} »${sub ? " et tout ce qu'il contient" : ""} ?`
    + (n ? `\n${n} bobine${n > 1 ? "s" : ""} y ${n > 1 ? "perdent" : "perd"} leur place et ${n > 1 ? "passent" : "passe"} « À ranger ».` : ""),
    { danger: true, confirmLabel: "Supprimer" }))) return false;
  return !!(await write("delete", `/storage/places/${p.id}`));
}

// une petite fenetre de saisie (nom, nombre, cases)
function Ask({ title, fields, okLabel = "Valider", onOk, onClose }) {
  const [v, setV] = useState(() => Object.fromEntries(fields.map(f => [f.key, f.value ?? (f.type === "check" ? false : "")])));
  const [busy, setBusy] = useState(false);
  const ok = fields.every(f => !f.required || String(v[f.key]).trim());
  const go = async () => { setBusy(true); try { if ((await onOk(v)) !== false) onClose(); } finally { setBusy(false); } };
  return createPortal(<FSheet onClose={onClose} z={1400} bottom={<>
    <button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Annuler</button>
    <button onClick={go} disabled={busy || !ok} style={{ ...fBtn, flex: 2, border: "none", color: "#fff", opacity: busy || !ok ? 0.5 : 1,
      background: "linear-gradient(135deg, #8B5CF6, #6366F1)" }}>{busy ? "…" : okLabel}</button></>}>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 17, fontWeight: 900, color: "var(--text)" }}>{title}</div>
      {fields.map((f, i) => f.type === "check"
        ? <label key={f.key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>
          <input type="checkbox" checked={!!v[f.key]} onChange={e => setV(o => ({ ...o, [f.key]: e.target.checked }))}/>{f.label}</label>
        : <label key={f.key}><span style={{ ...small, display: "block", marginBottom: 4 }}>{f.label}</span>
          <input autoFocus={i === 0} type={f.type === "number" ? "number" : "text"} min={f.type === "number" ? 1 : undefined} max={f.type === "number" ? 200 : undefined}
            value={v[f.key]} placeholder={f.placeholder} onChange={e => setV(o => ({ ...o, [f.key]: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter" && ok) go(); }} style={inp}/></label>)}
    </div>
  </FSheet>, document.body);
}

export function StorageSettingsCard({ card, cardTitle }) {
  const st = useStorage();
  const [name, setName] = useState("");
  const [maker, setMaker] = useState(false);
  const [openId, setOpenId] = useState(null);         // la fenetre d'un rangement
  useEffect(() => { if (st) setName(st.name); }, [st?.name]);
  if (!st) return null;
  const { kids, roots } = index(st);
  const leaves = st.places.filter(p => p.leaf).length;

  const setMode = async m => {
    if (m === st.mode) return;
    if (m !== "single" && !leaves && !(await showConfirm("Tu n'as encore créé aucun rangement : toutes les bobines rangées passeront « À ranger » "
      + "jusqu'à ce que tu leur en donnes un. Changer quand même ?", { confirmLabel: "Changer" }))) return;
    await write("put", "/storage/settings", { mode: m });
  };

  return (
    <div className="card" style={card}>
      <div style={cardTitle}>🗄 Rangements</div>
      <CardHelp title="Rangements">
        Où vont les bobines qui ne sont pas dans l'imprimante. Trois façons de faire : un seul rangement (le mode d'origine),
        une place pour chaque bobine, ou un rangement libre où l'appli te demande où tu as mis la bobine. Un rangement (un tiroir,
        un placard, un carton) contient des emplacements, directement ou par zones (Colonne 1, Colonne 2, Dessus…) ; un emplacement
        est une case (une seule bobine, gardée pendant qu'elle est dans l'AMS), ou commun (autant de bobines qu'on veut).
        {STORAGE_MODES.map(([k, ic, l, d]) => <React.Fragment key={k}><br/><br/><b>{ic} {l}</b> : {d}</React.Fragment>)}
        <br/><br/><b>🧠 Échange intelligent</b> (en « Je range où je veux ») : tu remplaces une bobine par une autre dans le même emplacement
        de l'AMS (dans la demi-heure) : celle qui sort prend la place que l'autre vient de quitter (rangée d'office, sans rappel). Jamais une
        place de stock 📦 : une bobine qui sort d'un carton le quitte pour de bon, et celle qu'elle remplace attend que tu dises où elle est.
      </CardHelp>
      {/* (09/11/2026) en bref sur les cartes ; l'explication est dans le ? */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 10 }}>
        {STORAGE_MODES.map(([k, ic, l, d, short]) => {
          const on = st.mode === k;
          return <button key={k} type="button" onClick={() => setMode(k)} data-tip={d} style={{ textAlign: "left", padding: "8px 11px", borderRadius: 12, cursor: "pointer",
            border: on ? "2px solid #8B5CF6" : "1px solid var(--border)", background: on ? "color-mix(in srgb, #8B5CF6 10%, var(--surface))" : "var(--surface)",
            color: "var(--text)", display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13.5, fontWeight: 900 }}>{ic} {l}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: on ? "#8B5CF6" : "var(--muted)" }}>{on ? "✓ actif · " : ""}{short}</span>
          </button>;
        })}
      </div>

      {/* (08/11/2026) en « je range ou je veux » seulement : en « sa place », chacune retourne a la sienne */}
      {st.mode === "manual" && <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 11px", borderRadius: 12, marginBottom: 12, cursor: "pointer",
        border: `1px solid ${st.smart ? "color-mix(in srgb, #8B5CF6 45%, var(--border))" : "var(--border)"}`, background: st.smart ? "color-mix(in srgb, #8B5CF6 8%, var(--surface))" : "var(--surface)" }}>
        <input type="checkbox" checked={!!st.smart} onChange={e => write("put", "/storage/settings", { smart: e.target.checked })} style={{ marginTop: 3 }}/>
        <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 13.5, fontWeight: 900, color: "var(--text)" }}>🧠 Échange intelligent</span>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.4 }}>
            Une bobine remplacée dans l'AMS prend la place de celle qui l'y remplace (détail dans le ?)</span>
        </span>
      </label>}

      {st.mode === "single" && <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ flex: 1 }}><span style={{ ...small, display: "block", marginBottom: 4 }}>Nom du rangement</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Tiroir" maxLength={40} style={inp}/></label>
        <button type="button" disabled={!name.trim() || name.trim() === st.name} onClick={() => write("put", "/storage/settings", { name })}
          style={{ ...seg, ...(name.trim() && name.trim() !== st.name ? segOn : {}), padding: "9px 14px" }}>Renommer</button>
      </div>}

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 6px" }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", flex: 1 }}>Mes rangements
          <span style={{ ...small, marginLeft: 6 }}>{leaves ? `${leaves} emplacement${leaves > 1 ? "s" : ""} où ranger` : "aucun"}</span></span>
        <button type="button" onClick={() => setMaker(true)} style={{ ...seg, ...segOn }}>＋ Nouveau rangement</button>
      </div>
      {st.mode === "single" && <p style={{ ...small, margin: "0 0 6px" }}>
        Inutilisés dans ce mode : prépare-les avant de passer à « Chaque bobine a sa place » ou « Je range où je veux ».</p>}
      {!roots.length && <div style={{ padding: 14, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12, ...small }}>
        Aucun rangement. « ＋ Nouveau rangement » : un tiroir, un placard, un carton… avec ses emplacements, directement ou par zones.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
        {roots.map(p => {
          const n = leafCountOf(p, kids), t = takenOf(p, kids), zones = (kids[p.id] || []).filter(c => !c.leaf).length;
          return <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 10px 10px 12px", borderRadius: 14, border: "1px solid var(--border)",
            background: "color-mix(in srgb, #8B5CF6 5%, var(--surface))" }}>
            <button type="button" onClick={() => setOpenId(p.id)} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, background: "none", border: "none",
              padding: 0, cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
              <span style={icoBox(p.stock ? "#D97706" : "#8B5CF6", 38, 12)}><PlaceIco p={p} size={19}/></span>
              <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 14, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}
                  {p.stock && <span style={{ fontSize: 10.5, fontWeight: 900, marginLeft: 6, padding: "1px 7px", borderRadius: 20, color: "#B45309",
                    background: "color-mix(in srgb, #F59E0B 16%, transparent)" }}>📦 stock</span>}</span>
                <span style={small}>{p.leaf ? `commun · ${p.spools.length} bobine${p.spools.length > 1 ? "s" : ""}`
                  : `${n} emplacement${n > 1 ? "s" : ""}${zones ? ` · ${zones} zone${zones > 1 ? "s" : ""}` : ""} · ${t} pris${bobTxt(p, kids, t)}`}</span>
              </span>
            </button>
            <button type="button" onClick={() => write("post", `/storage/places/${p.id}/move`, { d: -1 })} aria-label="Monter" style={{ ...seg, padding: "2px 7px" }}>↑</button>
            <button type="button" onClick={() => write("post", `/storage/places/${p.id}/move`, { d: 1 })} aria-label="Descendre" style={{ ...seg, padding: "2px 7px" }}>↓</button>
          </div>;
        })}
      </div>
      {maker && <PlaceMaker onClose={() => setMaker(false)} onMade={id => setOpenId(id)}/>}
      {openId != null && st.places.some(p => p.id === openId) && <PlaceEditor id={openId} onClose={() => setOpenId(null)}/>}
    </div>
  );
}

// ── La fenetre d'un rangement : ses zones, ses emplacements, tout se retouche ──
// readOnly + focus / focusPlace (07/11/2026, « Localiser ») : la fenetre en consultation, le rangement s'ouvre comme un
// tiroir qu'on tire, puis la case de la bobine (ou sa place) clignote et vient a l'ecran
// focus : une bobine ou plusieurs (08/11/2026, les echanges d'un plateau), marks : {bobine: « 1 »} leur numero sur la case ;
// embed : la vue seule, a poser dans une autre fenetre (PlaceView)
function PlaceEditor({ id, onClose, readOnly = false, focus = null, focusPlace = null, banner = null, embed = false, marks = null }) {
  const st = useStorage();
  const bodyRef = useRef(null);
  const fset = new Set([].concat(focus ?? []).filter(Boolean)), fo = sid => fset.has(sid), fkey = [...fset].join(",");
  useEffect(() => {
    if (embed || (!fkey && !focusPlace)) return undefined;    // integree : la fenetre qui l'accueille garde son haut
    const t = setTimeout(() => { try { bodyRef.current?.querySelector("[data-hit='1']")?.scrollIntoView({ block: "center", behavior: "smooth" }); } catch { /* ancien navigateur */ } }, 450);
    return () => clearTimeout(t);
  }, [fkey, focusPlace, embed]);
  const isHit = p => p.spools.some(x => fo(x.id)) || (focusPlace != null && p.id === focusPlace);
  const [ask, setAsk] = useState(null);
  const [fill, setFill] = useState(null);             // { place, spools } : y ranger une bobine
  const fillCell = async p => {
    try {
      const { data } = await client.get("/filaments/spools", { params: { archived: false } });
      const TO = st.to_store_label || "À ranger", pri = s => s.location === TO ? 0 : !s.place_id ? 1 : 2;
      setFill({ place: p, spools: (data || []).filter(s => !s.ordered && s.place_id !== p.id).sort((a, b) => pri(a) - pri(b)) });
    } catch (e) { showAlert(errMsg(e)); }
  };
  if (!st) return null;
  const { by, kids } = index(st);
  const root = by[id];
  if (!root) return null;
  const patch = (p, b) => write("patch", `/storage/places/${p.id}`, b);
  const addCells = (parent, zoneName) => setAsk({
    title: zoneName ? `Des emplacements dans « ${parent.name} »` : `Des emplacements dans « ${parent.name} »`,
    fields: [{ key: "n", label: "Combien ?", type: "number", value: "4", required: true },
      { key: "single", label: "Des cases (une seule bobine chacune)", type: "check", value: true }],
    okLabel: "Ajouter",
    onOk: ({ n, single }) => {
      const k0 = nextNum(parent, kids), cnt = Math.max(1, Math.min(200, parseInt(n) || 1));
      return write("post", "/storage/places", { parent_id: parent.id, items: Array.from({ length: cnt }, (_, i) => ({ name: cellName(zoneName, k0 + i), single })) }).then(r => !!r);
    },
  });
  // une zone, dans le rangement ou dans une autre zone (des niveaux : Étage 1 › Colonne 2 › ses emplacements)
  const addZone = (parent = root) => setAsk({
    title: `Une zone dans « ${parent.name} »`,
    fields: [{ key: "name", label: "Nom de la zone", placeholder: "Colonne 4, Dessus, Étage 2…", required: true,
      value: `Zone ${(kids[parent.id] || []).filter(c => !c.leaf).length + 1}` },
      { key: "vrac", label: "En vrac : pas de cases, autant de bobines qu'on veut", type: "check", value: false },
      { key: "n", label: "Combien d'emplacements ? (ignoré en vrac)", type: "number", value: "4", required: true },
      { key: "single", label: "Des cases (une seule bobine chacune)", type: "check", value: true }],
    okLabel: "Créer la zone",
    onOk: ({ name, n, single, vrac }) => {
      const z = name.trim(), cnt = Math.max(1, Math.min(200, parseInt(n) || 1));
      // en vrac (07/11/2026) : la zone est elle-meme un emplacement commun
      const item = vrac ? { name: z, single: false } : { name: z, children: Array.from({ length: cnt }, (_, i) => ({ name: cellName(z, i + 1), single })) };
      return write("post", "/storage/places", { parent_id: parent.id, items: [item] }).then(r => !!r);
    },
  });
  // (08/11/2026) « − » sous une zone : retire son dernier emplacement (le plus grand numero) ; s'il tient une bobine, on demande
  const removeLast = async z => {
    const cs = (kids[z.id] || []).filter(c => c.leaf);
    if (!cs.length) return;
    const last = cs.reduce((a, b) => (parseInt((b.name.match(/(\d+)$/) || [])[1] || "0", 10) >= parseInt((a.name.match(/(\d+)$/) || [])[1] || "0", 10) ? b : a));
    if (last.spools.length && !(await showConfirm(`« ${last.path} » tient ${last.spools.length > 1 ? `${last.spools.length} bobines` : `« ${last.spools[0].name} »`} : `
      + `${last.spools.length > 1 ? "elles perdront leur place et passeront" : "elle perdra sa place et passera"} « À ranger ». Le retirer quand même ?`, { danger: true, confirmLabel: "Retirer" }))) return;
    await write("delete", `/storage/places/${last.id}`);
  };
  const rename = p => setAsk({ title: `Renommer « ${p.name} »`, fields: [{ key: "name", label: "Nom", value: p.name, required: true }], okLabel: "Renommer",
    onOk: async ({ name }) => {
      const nv = name.trim();
      if (nv === p.name) return true;
      if (!(await patch(p, { name: nv }))) return false;
      // une zone renommee : ses emplacements « ancien-n » suivent (« Colonne 1-3 » -> « Gauche-3 »)
      for (const c of kids[p.id] || []) if (c.name.startsWith(p.name + "-")) await patch(c, { name: nv + c.name.slice(p.name.length) });
      return true;
    } });
  // une case prise (09/11/2026) : sa bobine en tete (les cases n'ecrivent plus son nom) ; son nom, sa matiere, sa marque, ce qu'il reste
  const occOf = p => p.leaf && p.single ? p.spools[0] : null;
  const menu = (e, p) => readOnly ? null : openMenu(e, {
    title: occOf(p) ? occOf(p).name : p.leaf ? shortName(p, by) : p.name,
    subtitle: occOf(p) ? [...infoOf(occOf(p), null), occOf(p).remaining_weight_g != null ? `${Math.round(occOf(p).remaining_weight_g)} g` : null,
      `#${occOf(p).id}`].filter(Boolean).join(" · ") + ` — case ${shortName(p, by)}` : p.path,
    lead: occOf(p) ? <Swatch s={occOf(p)} size={48}/> : undefined, color: "#8B5CF6",
    items: [
      { icon: "✏️", label: "Renommer", onClick: () => rename(p) },
      !p.leaf && { icon: "＋", label: "Ajouter des emplacements", onClick: () => addCells(p, p.id === root.id ? null : p.name) },
      !p.leaf && { icon: "🗂", label: "Ajouter une zone dedans", hint: p.id === root.id ? "Colonne, étage, dessus…" : "Un niveau de plus : une zone dans cette zone", onClick: () => addZone(p) },
      p.leaf && st.mode !== "single" && { icon: "📥", label: "Y ranger une bobine…", tone: "#8B5CF6", hint: p.single && p.spools.length ? `Prise par #${p.spools[0].id} : elle sera délogée` : undefined,
        onClick: () => fillCell(p) },
      p.leaf && { icon: p.single ? "📚" : "🔲", label: p.single ? "En faire un emplacement commun" : "En faire une case (une seule bobine)",
        hint: p.single ? "Autant de bobines qu'on veut" : "Réservée à une bobine tant qu'elle ne va pas ailleurs", onClick: () => patch(p, { single: !p.single }) },
      (!p.leaf || !p.single) && { icon: "🧵", label: "Vue des bobines",
        hint: p.id === root.id ? EDGE_TXT[p.edge] || "pastille" : p.edge ? EDGE_TXT[p.edge] : `comme au-dessus (${EDGE_TXT[edgeOf(by[p.parent_id], by) || "p"]})`, onClick: () => openMenu(null, {
        title: `Les bobines de « ${p.name} »`, subtitle: p.id === root.id ? "comment les montrer dans ses cases (une zone peut avoir la sienne)" : "comment les montrer dans les cases de cette zone", color: "#8B5CF6",
        items: [...(p.id === root.id ? [] : [[null, "↩", `Comme au-dessus (${EDGE_TXT[edgeOf(by[p.parent_id], by) || "p"]})`]]),
          [p.id === root.id ? null : "p", "🟣", "Pastille"], ["s", "•", "Petites pastilles (un carton de 30 bobines)"], ["c", "📦", "Dans leur carton (du stock)"], ["h", "▬", "Sur la tranche, à plat (horizontale)"], ["v", "▮", "Sur la tranche, debout (verticale)"]].map(([k, ic, l]) =>
          ({ icon: (p.edge || null) === k ? "✓" : ic, label: l, onClick: () => patch(p, { edge: k }) })),
      }) },
      // du stock : le rangement entier, ou une zone, une caisse en vrac (07/11/2026 : seulement le rangement avant)
      (!p.leaf || !p.single) && { icon: "📦", label: p.stock ? "Ce n'est plus du stock" : "C'est du stock (cartons, réserve)", disabled: !p.stock && p.in_stock,
        hint: !p.stock && p.in_stock ? "Déjà dans du stock (le rangement ou une zone au-dessus)" : p.stock ? "Une bobine qui en sort pour l'AMS n'y revient pas"
          : "Une bobine qui en sort pour l'AMS le quitte pour de bon ; l'échange intelligent n'y range jamais rien" + (p.leaf ? "" : " (tout ce qu'elle contient)"),
        onClick: () => patch(p, { stock: !p.stock }) },
      p.id !== root.id && { icon: "↑", label: "Avant", onClick: () => write("post", `/storage/places/${p.id}/move`, { d: -1 }) },
      p.id !== root.id && { icon: "↓", label: "Après", onClick: () => write("post", `/storage/places/${p.id}/move`, { d: 1 }) },
      (!p.leaf || !p.single) && { icon: "▦", label: "Disposition", hint: layTxt(p), onClick: () => openMenu(null, {
        title: `Disposition de « ${p.name} »`, subtitle: "son contenu : en colonne, en ligne, en grille", color: "#8B5CF6",
        items: [
          { icon: (p.layout || "auto") === "auto" && !p.cols ? "✓" : "✨", label: "Automatique", onClick: () => patch(p, { layout: "auto", cols: null }) },
          { icon: p.layout === "col" ? "✓" : "⬇", label: "En colonne", onClick: () => patch(p, { layout: "col" }) },
          { icon: p.layout === "row" ? "✓" : "➡", label: "En ligne", onClick: () => patch(p, { layout: "row" }) },
          ...[2, 3, 4, 5, 6, 8].map(n => ({ icon: p.layout === "grid" && (p.cols || 3) === n ? "✓" : "▦", label: `Grille de ${n} par ligne`,
            onClick: () => patch(p, { layout: "grid", cols: n }) })),
        ],
      }) },
      p.id !== root.id && (!p.leaf || !p.single) && { icon: "↔", label: "Largeur", hint: p.span === -1 ? "toute la largeur" : p.span > 1 ? `${p.span} colonnes` : "une colonne",
        onClick: () => openMenu(null, { title: `Largeur de « ${p.name} »`, subtitle: "parmi les autres zones", color: "#8B5CF6",
          items: [[null, "Une colonne"], [2, "2 colonnes"], [3, "3 colonnes"], [4, "4 colonnes"], [-1, "Toute la largeur"]].map(([v, l]) =>
            ({ icon: (p.span ?? null) === v ? "✓" : "↔", label: l, onClick: () => patch(p, { span: v }) })) }) },
      !p.leaf && { icon: "⇅", label: p.rev ? "Le 1 en haut (ordre normal)" : p.layout === "row" ? "Le 1 à droite" : "Le 1 en bas",
        hint: p.rev ? "Numéros de haut en bas" : "Comme un tiroir qu'on remplit par le fond", onClick: () => patch(p, { rev: !p.rev }) },
      "-",
      { icon: "🗑", label: "Supprimer…", danger: true, onClick: async () => { if (await delPlace(p, kids) && p.id === root.id) onClose(); } },
    ],
  });
  const Cell = ({ p }) => {
    const occ = p.spools.find(x => fo(x.id)) || p.spools[0], edge = edgeOf(p, by), info = infoOf(occ, null), hit = isHit(p);
    const num = `${p.single ? "" : "📚"}${shortName(p, by)}`;
    // (08/11/2026) le meme dessin que la vue du stock : numero, tranche, nom, sous-type · marque
    return <button type="button" className={`bn-cell${occ ? "" : " bn-free"}${embed ? "" : occ ? " bn-tight" : " bn-tightf"}`} onClick={e => menu(e, p)} data-hit={hit ? "1" : undefined}
      data-swap-src={occ && marks?.[occ.id] != null ? marks[occ.id] : undefined}
      {...idTip(occ, p.path)} data-tip={occ ? undefined : p.single ? `${num} · case libre` : `${num} · emplacement commun`}
      style={{ cursor: readOnly ? "default" : "pointer", zIndex: hit ? 2 : undefined, animation: hit ? "bnHit 1s ease-in-out .7s infinite" : undefined }}>
      {occ && marks?.[occ.id] != null && <span className={`bn-mark${String(marks[occ.id]).startsWith("↩") ? " home" : ""}`}>{marks[occ.id]}</span>}
      {occ ? <>
        <span className="bn-num">{num}{!p.single && p.spools.length > 1 ? ` · ${p.spools.length}` : ""}</span>
        <span className="bn-band">{edge === "v" ? <SpoolEdge s={occ} vertical len={embed ? 26 : 48} thick={embed ? 12 : 24}/>
          : edge === "c" ? <SpoolBox s={occ} h={embed ? 36 : 58}/> : edge === "s" ? <Swatch s={occ} size={18}/> : edge ? <SpoolEdge s={occ} len="100%" thick={embed ? 15 : EDGE_H}/> : <span className="bn-pastille"><Swatch s={occ} size={embed ? 16 : 40}/></span>}</span>
        {/* (09/11/2026) ni nom ni marque : serre, l'info est dans la fenetre au toucher (et au survol) */}
      </> : <span className="bn-num-free">{num}</span>}
    </button>;
  };
  // une zone en vrac (un emplacement commun parmi les zones) : comme une zone, ses bobines en pastilles
  const Vrac = ({ p }) => <div data-hit={isHit(p) ? "1" : undefined} style={{ display: "flex", flexDirection: "column", gap: 3, padding: 4, borderRadius: 10, minWidth: 0,
    animation: isHit(p) ? "bnHit 1s ease-in-out .7s infinite" : undefined,
    border: "1px dashed color-mix(in srgb, #8B5CF6 45%, var(--border))", background: "color-mix(in srgb, #8B5CF6 4%, var(--surface2))" }}>
    <button type="button" onClick={e => menu(e, p)} data-tip={`${p.name} · en vrac · ${p.spools.length} bobine${p.spools.length > 1 ? "s" : ""}`}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", background: "none", border: "none", padding: "1px 0", cursor: "pointer", color: "var(--text)", minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 900, maxWidth: "100%", lineHeight: 1.15, textAlign: "center", overflowWrap: "anywhere",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.name}</span>
      <span style={{ ...small, fontSize: 10 }}>{p.stock ? "📦 stock · " : ""}vrac · {p.spools.length}</span>
    </button>
    {/* (09/11/2026) ses bobines comme des cases condensees, a sa vue et a sa disposition ; en integre, des pastilles */}
    {embed ? <div style={{ display: "flex", flexWrap: "wrap", gap: 3, justifyContent: "center", minHeight: 24, alignItems: "center" }}>
      {p.spools.slice(0, 24).map(x => <span key={x.id} {...idTip(x, p.path)} data-swap-src={marks?.[x.id] != null ? marks[x.id] : undefined} style={{ display: "inline-flex", borderRadius: "50%",
        animation: fo(x.id) ? "bnHit 1s ease-in-out .7s infinite" : undefined }}><Swatch s={x} size={fo(x.id) ? 22 : 16}/></span>)}
      {p.spools.length > 24 && <span style={{ ...small, fontSize: 10 }}>+{p.spools.length - 24}</span>}
      {!p.spools.length && <span style={{ ...small, fontSize: 10 }}>vide</span>}
    </div> : p.spools.length ? (() => { const e = edgeOf(p, by), list = p.rev ? [...p.spools].reverse() : p.spools;
      return <div style={{ display: "grid", gap: 2, justifyContent: "center", gridTemplateColumns: `repeat(${vracCols(p, list.length)}, minmax(0, ${CELL_W(e)}px))` }}>
        {list.map(x => <span key={x.id} className="bn-cell bn-tight" {...idTip(x, p.path)} data-swap-src={marks?.[x.id] != null ? marks[x.id] : undefined}
          onClick={ev => menu(ev, p)} style={{ cursor: readOnly ? "default" : "pointer", animation: fo(x.id) ? "bnHit 1s ease-in-out .7s infinite" : undefined }}>
          <span className="bn-band">{e === "v" ? <SpoolEdge s={x} vertical len={48} thick={24}/> : e === "c" ? <SpoolBox s={x} h={58}/> : e === "s" ? <Swatch s={x} size={18}/> : e ? <SpoolEdge s={x} len="100%" thick={EDGE_H}/>
            : <span className="bn-pastille"><Swatch s={x} size={40}/></span>}</span></span>)}
      </div>; })() : <span style={{ ...small, fontSize: 10, textAlign: "center" }}>vide</span>}
  </div>;
  // (09/11/2026) condense : des cases a largeur fixe selon la vue (debout, couchee, pastille), les zones a leur largeur ;
  // rien ne s'etire pour remplir la fenetre. En integre (les echanges), la grille d'avant
  const cellW = q => CELL_W(edgeOf(q, by));
  const tightCells = (tpl, q, n) => embed ? tpl : tightTpl(tpl, cellW(q), n);
  const tightZones = tpl => embed ? tpl : tpl.replace(/minmax\(0, 1fr\)/g, "minmax(0, max-content)");
  const Zone = ({ p, many }) => {
    const ch = kids[p.id] || [];
    const cells = ch.filter(c => c.leaf), subs = ch.filter(c => !c.leaf);
    return <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: 4, borderRadius: 10, border: "1px solid var(--border)", minWidth: 0,
      background: "color-mix(in srgb, #8B5CF6 4%, var(--surface2))" }}>
      <button type="button" onClick={e => menu(e, p)} data-tip={`${p.name} · ${takenOf(p, kids)} pris sur ${leafCountOf(p, kids)}${bobTxt(p, kids, takenOf(p, kids))}`} style={{ display: "flex", flexDirection: "column",
        alignItems: "center", gap: 0, background: "none", border: "none", padding: "1px 0", cursor: "pointer", color: "var(--text)", minWidth: 0 }}>
        {/* integree, en reduit (08/11/2026) : « Colonne 1 » devient « C1 » (le nom entier au survol) */}
        <span style={{ fontSize: embed ? 10 : 11, fontWeight: 900, maxWidth: "100%", lineHeight: 1.15, textAlign: "center", overflowWrap: embed ? "normal" : "anywhere",
          display: "-webkit-box", WebkitLineClamp: embed ? 1 : 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {embed ? p.name.replace(/^(\p{L})\p{L}*\s*(\d+)$/u, "$1$2") : p.name}</span>
        {!embed && <span style={{ ...small, fontSize: 10 }}>{p.stock ? "📦 " : ""}{takenOf(p, kids)}/{leafCountOf(p, kids)}</span>}
      </button>
      {cells.length > 0 && (a => <div style={{ display: "grid", gap: embed ? 3 : 2, gridTemplateColumns: tightCells(a.tpl, p, cells.length), justifyContent: "center" }}>
        {a.items.map(c => <Cell key={c.id} p={c}/>)}</div>)(arrange(cells, p, many, "repeat(auto-fill, minmax(30px, 1fr))"))}
      {subs.length > 0 && <Zones parent={p} list={subs}/>}
      {!readOnly && <div style={{ display: "flex", gap: 3 }}>
        <button type="button" onClick={() => removeLast(p)} disabled={!cells.length} aria-label={`Retirer le dernier emplacement de ${p.name}`}
          data-tip="Retirer le dernier emplacement" style={{ ...seg, flex: 1, padding: "0 4px", fontSize: 12, lineHeight: "18px", opacity: cells.length ? 1 : 0.4 }}>−</button>
        <button type="button" onClick={() => addCells(p, p.name)} aria-label={`Des emplacements dans ${p.name}`}
          data-tip="Ajouter des emplacements" style={{ ...seg, flex: 1, padding: "0 4px", fontSize: 11, lineHeight: "18px" }}>＋</button></div>}
    </div>;
  };
  // les zones cote a cote, chacune a sa hauteur (07/11/2026 : elles s'etiraient a la plus haute) ; 5 tiennent sur un telephone
  // (09/11/2026) condense : une zone en pleine largeur passe sur sa propre rangee, a la largeur des autres (dans la grille,
  // elle elargissait la premiere colonne a sa mesure)
  const Zones = ({ parent, list }) => { const a = arrange(list, parent, false, `repeat(${Math.min(list.length, 4)}, minmax(0, 1fr))`);
    const one = z => z.leaf ? <Vrac p={z}/> : <Zone p={z} many={list.length > 1 && !wide(z)}/>;
    if (embed) return <div style={{ display: "grid", gap: 4, gridTemplateColumns: a.tpl, alignItems: "start" }}>
      {a.items.map(z => <div key={z.id} style={{ minWidth: 0, ...spanOf(z) }}>{one(z)}</div>)}</div>;
    const row = a.items.filter(z => z.span !== -1), full = a.items.filter(z => z.span === -1);
    return <div style={{ display: "inline-flex", flexDirection: "column", gap: 4, maxWidth: "100%", minWidth: 0 }}>
      {row.length > 0 && <div style={{ display: "grid", gap: 4, gridTemplateColumns: tightZones(a.tpl), alignItems: "start", justifyContent: "start" }}>
        {row.map(z => <div key={z.id} style={{ minWidth: 0, ...spanOf(z) }}>{one(z)}</div>)}</div>}
      {full.map(z => <div key={z.id} style={{ minWidth: 0 }}>{one(z)}</div>)}</div>; };
  const ch = kids[root.id] || [];
  // les cases sans zone d'un cote ; les zones et les emplacements en vrac (communs) de l'autre, cote a cote
  const direct = ch.filter(c => c.leaf && c.single), zones = ch.filter(c => !c.leaf || !c.single);
  const n = leafCountOf(root, kids), t = takenOf(root, kids);

  const styles = <>
      <style>{CELL_CSS}</style>
      <SpoolIdHost/>
      <style>{`@keyframes bnDrawer{0%{opacity:0;transform:perspective(900px) rotateX(38deg) translateY(-34px) scale(.92)}
        60%{opacity:1;transform:perspective(900px) rotateX(-4deg) translateY(4px) scale(1.01)}100%{transform:none}}
        @keyframes bnHit{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.9);transform:scale(1);border-color:#F59E0B}
        50%{box-shadow:0 0 0 7px rgba(245,158,11,0),0 0 18px 4px rgba(245,158,11,.55);transform:scale(1.1);border-color:#FBBF24;background:color-mix(in srgb,#F59E0B 22%,var(--surface))}}
        .bn-mark{position:absolute;top:2px;right:2px;z-index:3;min-width:16px;height:16px;padding:0 4px;border-radius:8px;font-size:10px;font-weight:900;
          line-height:16px;color:#fff;background:#F59E0B;box-shadow:0 0 0 2px var(--surface)}
        .bn-compact .bn-ct-name,.bn-compact .bn-ct-sub,.bn-compact .bn-num{display:none}
        .bn-compact .bn-cell{padding:3px;gap:0;border-radius:7px}
        .bn-compact .bn-cell.bn-free{min-height:16px;border-width:1px}
        .bn-compact .bn-num-free{font-size:8.5px}
        .bn-compact .bn-band{min-height:0;padding-top:0}
        .bn-compact .bn-mark{min-width:11px;height:11px;line-height:11px;font-size:7.5px;top:1px;right:1px;padding:0 2px;border-radius:6px;
          box-shadow:none;background:rgba(245,158,11,.85)}
        .bn-compact .bn-mark.home{background:rgba(2,132,199,.85)}`}</style></>;
  // integree (08/11/2026, les echanges) : en reduit, rien que les tranches des bobines, pour voir le chemin
  const body = <div ref={bodyRef} className={embed ? "bn-compact" : undefined} style={{ padding: embed ? 0 : "52px 16px 18px", display: "flex", flexDirection: "column", gap: embed ? 8 : 12,
        animation: (fkey || focusPlace != null) ? "bnDrawer .75s cubic-bezier(.2,.9,.25,1.05) both" : undefined, transformOrigin: "50% 0" }}>
        {banner}
        {!embed && <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={icoBox(root.stock ? "#D97706" : "#8B5CF6", 42, 13)}><PlaceIco p={root} size={21}/></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{root.name}{root.stock && <span style={{ fontSize: 11, fontWeight: 900, marginLeft: 8, padding: "1px 8px",
              borderRadius: 20, color: "#B45309", background: "color-mix(in srgb, #F59E0B 16%, transparent)" }}>📦 stock</span>}</div>
            <div style={small}>{root.leaf ? `Emplacement commun · ${root.spools.length} bobine${root.spools.length > 1 ? "s" : ""}`
              : readOnly ? `${n} emplacement${n > 1 ? "s" : ""} · ${t} pris${bobTxt(root, kids, t)}`
              : `${n} emplacement${n > 1 ? "s" : ""} · ${t} pris${bobTxt(root, kids, t)} · touche une zone ou une case pour la retoucher${st.mode !== "single" ? " ou y ranger une bobine" : ""}`}</div>
          </div>
          {!readOnly && <button type="button" onClick={e => menu(e, root)} aria-label="Actions du rangement" style={{ ...seg, padding: "6px 11px" }}>⋯</button>}
        </div>}
        {!readOnly && st.mode === "single" && <div style={{ ...small, padding: "8px 12px", borderRadius: 12, color: "#B45309", background: "color-mix(in srgb, #F59E0B 10%, var(--surface))" }}>
          Tu es en « Un seul rangement » : les bobines ne vont pas encore dans ces emplacements. Choisis « Chaque bobine a sa place » ou « Je range où je veux »
          dans la carte Rangements pour y ranger tes bobines.</div>}
        {root.leaf && !readOnly && <div style={{ ...small, padding: 12, border: "1px dashed var(--border)", borderRadius: 12 }}>
          Un emplacement commun : autant de bobines qu'on veut.{root.spools.length ? " Il tient des bobines : range-les ailleurs pour le découper en zones ou en cases." : " « ＋ Une zone » ou « ＋ Des emplacements » le découpent."}</div>}
        {direct.length > 0 && (a => <div style={{ display: "grid", gap: 3, gridTemplateColumns: embed ? a.tpl : a.tpl.includes("auto-fill") ? `repeat(auto-fill, ${cellW(root)}px)` : tightCells(a.tpl, root, direct.length) }}>
          {a.items.map(c => <Cell key={c.id} p={c}/>)}</div>)(arrange(direct, root, false, "repeat(auto-fill, minmax(34px, 1fr))"))}
        {zones.length > 0 && <Zones parent={root} list={zones}/>}
      </div>;
  if (embed) return <>{styles}{body}</>;
  return createPortal(<>
    <FSheet onClose={onClose} z={readOnly ? 1500 : 1250} bottom={<>
      {!readOnly && (!root.leaf || !root.spools.length) ? <>
        <button onClick={() => addZone()} style={{ ...fBtn, flex: 1 }}>＋ Une zone</button>
        <button onClick={() => addCells(root, null)} style={{ ...fBtn, flex: 1 }}>＋ Des emplacements</button></> : null}
      <button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Fermer</button></>}>
      {styles}{body}
    </FSheet>
    {ask && <Ask {...ask} onClose={() => setAsk(null)}/>}
    {fill && <CellFiller place={fill.place} spools={fill.spools} onClose={() => setFill(null)}/>}
  </>, document.body);
}

// ── Localiser une bobine (07/11/2026) ─────────────────────────────────────────
// Son rangement s'ouvre et sa case clignote ; dans l'imprimante : ou elle est, et la place qui l'attend si elle en a une.
export function LocateSheet({ spoolId, onClose, home = false }) {
  const st = useStorage();
  const [sp, setSp] = useState(null);
  const [showHome, setShowHome] = useState(home);    // dans l'imprimante : voir la place qui l'attend (home : d'emblee)
  useEffect(() => { client.get(`/filaments/spools/${spoolId}`).then(r => setSp(r.data)).catch(() => setSp({ id: spoolId })); }, [spoolId]);
  if (!st || !sp) return null;
  const { by } = index(st);
  const here = st.places.find(p => p.spools.some(x => x.id === spoolId));
  const pid = here?.id ?? (sp.place_id && by[sp.place_id] ? sp.place_id : null);
  let root = pid != null ? by[pid] : null;
  while (root && root.parent_id != null && by[root.parent_id]) root = by[root.parent_id];
  const inPr = inPrinter(sp.location);
  const name = sp.filament_translated_name || sp.filament_name || `Bobine #${spoolId}`;
  // (08/11/2026) colle en haut : la fenetre descend jusqu'a la case, on garde sous les yeux de quelle bobine et quelle place
  // il s'agit (la marge a droite laisse la croix de fermeture)
  const banner = <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14,
    position: "sticky", top: 8, zIndex: 5, marginRight: 44, boxShadow: "0 8px 18px -10px rgba(15,23,42,.45)",
    border: `2px solid ${inPr ? "#0EA5E9" : "#F59E0B"}`, backgroundColor: "var(--sheet-bg)",       // plein : les cases passent dessous
    backgroundImage: `linear-gradient(color-mix(in srgb, ${inPr ? "#0EA5E9" : "#F59E0B"} 14%, transparent), color-mix(in srgb, ${inPr ? "#0EA5E9" : "#F59E0B"} 14%, transparent))` }}>
    <Swatch s={sp} size={32}/>
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 14, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name} <span style={{ color: "var(--muted)" }}>#{spoolId}</span></span>
      <span style={{ ...small, display: "block" }}>{[sp.filament_fila_type || sp.filament_material, sp.filament_manufacturer].filter(Boolean).join(" · ")}</span>
      <span style={{ fontSize: 12.5, fontWeight: 900, color: inPr ? "#0284C7" : "#B45309" }}>
        {inPr ? `🖨 Dans l'imprimante : ${sp.location}${pid != null ? ` · sa place : ${by[pid]?.path}` : ""}` : `📍 ${sp.location || "?"}`}</span>
    </span>
  </div>;
  if (inPr && !showHome) return <PrinterLocate sp={sp} spoolId={spoolId} banner={banner} onClose={onClose} home={root ? () => setShowHome(true) : null}/>;
  if (!root) return createPortal(<FSheet onClose={onClose} z={1500} bottom={<button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Fermer</button>}>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>📍 Localiser</div>
      {banner}
      {!inPr && <div style={small}>{sp.location === (st.to_store_label || "À ranger") ? "Elle n'a pas encore de place : dis où tu l'as rangée depuis sa fiche."
        : st.mode === "single" ? `Rangement unique : elle est dans « ${st.name} ».` : "Pas d'emplacement connu."}</div>}
    </div>
  </FSheet>, document.body);
  return <PlaceEditor id={root.id} onClose={onClose} readOnly focus={here ? spoolId : null} focusPlace={here ? null : pid} banner={banner}/>;
}

// dans l'imprimante (07/11/2026) : ses AMS, HT et support externe, le slot de la bobine qui clignote
function PrinterLocate({ sp, spoolId, banner, onClose, home }) {
  // le slot : celui ou l'imprimante voit la bobine, sinon celui que dit son emplacement
  const hitOf = (a, t, units) => t.spool_id === spoolId || (!units.some(u => u.trays.some(x => x.spool_id === spoolId)) && slotIs(a, t, sp.location));
  return createPortal(<FSheet onClose={onClose} z={1500} bottom={<>
    {home && <button onClick={home} style={{ ...fBtn, flex: 1 }} data-tip="La place qui l'attend dans tes rangements">📍 Sa place</button>}
    <button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Fermer</button></>}>
    <style>{`@keyframes bnDrawer{0%{opacity:0;transform:perspective(900px) rotateX(38deg) translateY(-34px) scale(.92)}
      60%{opacity:1;transform:perspective(900px) rotateX(-4deg) translateY(4px) scale(1.01)}100%{transform:none}}
      @keyframes bnHit{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.9);transform:scale(1)}
      50%{box-shadow:0 0 0 7px rgba(245,158,11,0),0 0 18px 4px rgba(245,158,11,.55);transform:scale(1.12)}}`}</style>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12, animation: "bnDrawer .75s cubic-bezier(.2,.9,.25,1.05) both", transformOrigin: "50% 0" }}>
      {banner}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={icoBox("#0EA5E9", 42, 13)}><Printer size={21} strokeWidth={2.2}/></span>
        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>Dans l'imprimante</div>
      </div>
      <AmsMap isHit={hitOf}/>
    </div>
  </FSheet>, document.body);
}

// l'imprimante comme sur la tuile AMS de l'accueil (07/11/2026, sortie de PrinterLocate le 08/11/2026 pour les echanges) :
// isHit(unite, slot) fait clignoter un slot, mark(unite, slot) y ecrit un numero (« 1 », l'echange qu'il attend)
// compact (08/11/2026, les echanges) : des slots plus bas, pour tenir a cote d'un rangement sur un telephone
export function AmsMap({ isHit = () => false, mark = () => null, compact = false }) {
  const status = usePrinter(s => s.status);
  useEffect(() => { if (!status) usePrinter.getState().fetch?.(); }, [status]);
  const [order, setOrder] = useState(undefined);
  useEffect(() => { client.get("/settings/ams-order").then(({ data }) => setOrder(data.order ?? null)).catch(() => setOrder(null)); }, []);
  const units = (status?.ams_list || []).filter(a => (a.trays || []).length);
  const rank = a => isExternal(a.id) ? 2 : isHt(a.id) ? 1 : 0;
  units.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  const hitOf = (a, t) => isHit(a, t, units);
  return <>
      <style>{`@keyframes bnHit{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.9);transform:scale(1)}
        50%{box-shadow:0 0 0 7px rgba(245,158,11,0),0 0 18px 4px rgba(245,158,11,.55);transform:scale(1.12)}}`}</style>
      {!units.length && <div style={small}>L'état de l'imprimante n'est pas disponible pour l'instant.</div>}
      {(() => {
        const grid = units.filter(a => !isExternal(a.id)), ext = units.filter(a => isExternal(a.id));
        const cols = grid.length ? grilleAccueil(grid, order === undefined ? null : lireDisposition(order)) : [];
        const Unit = ({ a, w }) => <div style={{ padding: compact ? "4px 3px 5px" : "8px 6px 9px", borderRadius: compact ? 10 : 14, background: "var(--surface2)", border: "1px solid var(--border)", minWidth: 0 }}>
          <div style={{ fontSize: compact ? 9.5 : 11, fontWeight: 900, color: "var(--muted)", textAlign: "center", marginBottom: compact ? 3 : 6 }}>{amsName(a.id)}</div>
          <div style={{ display: "flex", gap: compact ? 3 : 5, margin: "0 auto", width: w ? `${w * 100}%` : "100%" }}>
            {a.trays.map(t => {
              const hit = hitOf(a, t), empty = t.empty || !t.filament_type;
              // le fond de la tuile AMS (07/11/2026) : couleurs de la bobine, transparence, finition (soie, mat, paillettes...)
              const bg = empty ? null : trayBg(t, null, 60);
              // le numero sous le slot, en clair (07/11/2026 : ecrit dessus, il se lisait mal sur les couleurs)
              return <div key={t.id} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}
                data-tip={`${slotLabel(a.id, t.id)}${empty ? " — vide" : t.spool_info?.translated_name || t.spool_info?.name ? ` — ${t.spool_info.translated_name || t.spool_info.name}` : ""}`}>
                <div data-swap-dst={mark(a, t) != null ? mark(a, t) : undefined} style={{ width: "100%", height: compact ? 28 : 40, borderRadius: compact ? 6 : 9, position: "relative", zIndex: hit ? 2 : undefined,
                  border: hit ? "2px solid #F59E0B" : empty ? "1.5px dashed rgba(148,163,184,0.7)" : "1px solid rgba(0,0,0,0.15)",
                  animation: hit ? "bnHit 1s ease-in-out .7s infinite" : undefined,
                  ...(bg || { background: "repeating-linear-gradient(-45deg, rgba(148,163,184,0.22) 0px, rgba(148,163,184,0.22) 2px, transparent 2px, transparent 6px)" }) }}>
                  {mark(a, t) != null && <span style={{ position: "absolute", top: compact ? 1 : -6, right: compact ? 1 : -6, minWidth: compact ? 11 : 16, height: compact ? 11 : 16,
                    padding: compact ? "0 2px" : "0 4px", borderRadius: compact ? 6 : 8, fontSize: compact ? 7.5 : 10, fontWeight: 900, lineHeight: compact ? "11px" : "16px",
                    textAlign: "center", color: "#fff", background: compact ? "rgba(245,158,11,.85)" : "#F59E0B", boxShadow: compact ? "none" : "0 0 0 2px var(--surface2)" }}>{mark(a, t)}</span>}
                </div>
                <span style={{ fontSize: compact ? 8.5 : hit ? 11 : 10, fontWeight: 900, lineHeight: 1, color: hit ? "#D97706" : "var(--text2)" }}>{slotLabel(a.id, t.id)}</span>
              </div>;
            })}
          </div>
        </div>;
        return <>
          {cols.length > 0 && <div style={{ display: "grid", gap: compact ? 4 : 8, gridTemplateColumns: cols.map(c => `minmax(0, ${columnWeight(c)}fr)`).join(" ") }}>
            {cols.flatMap((col, ci) => col.map((a, ri) => a && <div key={a.id} style={{ gridColumn: ci + 1, gridRow: ri + 1, minWidth: 0 }}>
              <Unit a={a} w={slotCount(a) / columnWeight(col)}/></div>))}
          </div>}
          {ext.length > 0 && <div style={{ display: "grid", gap: compact ? 4 : 8, marginTop: compact ? 4 : 0, gridTemplateColumns: `repeat(auto-fit, minmax(${compact ? 90 : 150}px, 1fr))` }}>{ext.map(a => <Unit key={a.id} a={a}/>)}</div>}
        </>;
      })()}
  </>;
}

// le slot d'une bobine : celui ou l'imprimante la voit, sinon celui que dit son emplacement (« AMS-A slot 2 », « AMS HT-A »)
export const slotIs = (a, t, loc) => loc === `${amsName(a.id)} slot ${t.id + 1}` || (isHt(a.id) && loc === `AMS ${amsName(a.id)}`);
// un rangement en consultation, a poser dans une autre fenetre (08/11/2026, les echanges) ; rootOfSpool : le rangement d'une bobine
export const PlaceView = props => <PlaceEditor {...props} readOnly embed onClose={() => {}}/>;
export function rootOfSpool(st, spoolId) {
  if (!st) return null;
  const { by } = index(st);
  let p = st.places.find(x => x.spools.some(s => s.id === spoolId));
  while (p && p.parent_id != null && by[p.parent_id]) p = by[p.parent_id];
  return p?.id ?? null;
}

// ── Nouveau rangement ────────────────────────────────────────────────────────
function PlaceMaker({ onClose, onMade }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("cells");          // cells : des emplacements ; common : un seul, commun
  const [direct, setDirect] = useState("");           // emplacements sans zone
  const [zones, setZones] = useState([]);             // [{ name, n }]
  const [single, setSingle] = useState(true);
  const [stock, setStock] = useState(false);
  const [quick, setQuick] = useState({ prefix: "Colonne", count: "3", n: "7" });
  const [lay, setLay] = useState("auto");             // (09/11/2026) la disposition des zones, des la creation
  const [busy, setBusy] = useState(false);
  const nd = Math.max(0, Math.min(200, parseInt(direct) || 0));
  const zs = zones.map(z => ({ name: z.name.trim(), vrac: !!z.vrac, lay: z.lay || "auto", n: z.vrac ? 1 : Math.max(0, Math.min(200, parseInt(z.n) || 0)) })).filter(z => z.name && z.n);
  const total = kind === "common" ? 0 : nd + zs.reduce((s, z) => s + z.n, 0);
  const ok = name.trim() && (kind === "common" || total > 0);
  const create = async () => {
    setBusy(true);
    try {
      const children = kind === "common" ? [] : [
        ...Array.from({ length: nd }, (_, i) => ({ name: cellName(null, i + 1), single })),
        ...zs.map(z => z.vrac ? { name: z.name, single: false }
          : { name: z.name, ...layBody(z.lay), children: Array.from({ length: z.n }, (_, i) => ({ name: cellName(z.name, i + 1), single })) }),
      ];
      const r = await write("post", "/storage/places", { name: name.trim(), single: false, stock, ...layBody(lay), children });
      if (r) { onClose(); if (r.made?.[0] && kind !== "common") onMade?.(r.made[0]); }
    } finally { setBusy(false); }
  };
  const setZ = (i, k, v) => setZones(l => l.map((z, j) => j === i ? { ...z, [k]: v } : z));
  const addQuick = () => {
    const c = Math.max(1, Math.min(26, parseInt(quick.count) || 1)), n = String(Math.max(1, parseInt(quick.n) || 1));
    const base = zones.filter(z => z.name.startsWith(quick.prefix)).length;
    setZones(l => [...l, ...Array.from({ length: c }, (_, i) => ({ name: `${quick.prefix} ${base + i + 1}`.trim(), n, vrac: !!quick.vrac }))]);
  };

  return createPortal(<FSheet onClose={onClose} z={1200} bottom={<>
    <button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Annuler</button>
    <button onClick={create} disabled={busy || !ok} style={{ ...fBtn, flex: 2, border: "none", color: "#fff", opacity: busy || !ok ? 0.5 : 1,
      background: "linear-gradient(135deg, #8B5CF6, #6366F1)" }}>{busy ? "…" : kind === "common" ? "Créer le rangement" : `Créer · ${total} emplacement${total > 1 ? "s" : ""}`}</button></>}>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>＋ Nouveau rangement</div>
      <label><span style={{ ...small, display: "block", marginBottom: 4 }}>Nom</span>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Tiroir bas, Placard, Carton réserve…" maxLength={60} style={inp}/></label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[["cells", "🔢 Des emplacements"], ["common", "📚 Un seul, commun (autant de bobines qu'on veut)"]].map(([k, l]) =>
          <button key={k} type="button" onClick={() => setKind(k)} style={{ ...seg, ...(kind === k ? segOn : {}) }}>{l}</button>)}
      </div>
      {kind === "cells" && <>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, color: "var(--text2)" }}>
          Emplacements sans zone
          <input type="number" min={0} max={200} value={direct} onChange={e => setDirect(e.target.value)} placeholder="0" style={{ ...inp, width: 80 }}/>
          <span style={small}>numérotés 1, 2, 3…</span></label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", flex: 1, minWidth: 0 }}>Zones <span style={small}>chacune son nom, son nombre d'emplacements (« Colonne 1-3 ») et leur disposition</span></div>
            {zones.length > 1 && <label style={{ display: "inline-flex", alignItems: "center", gap: 6, ...small }}>les zones
              <LaySelect value={lay} onChange={setLay} tip="Comment les zones se placent entre elles"/></label>}
          </div>
          {zones.map((z, i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input value={z.name} onChange={e => setZ(i, "name", e.target.value)} placeholder="Colonne 1, Dessus…" style={{ ...inp, flex: "1 1 120px", width: "auto", minWidth: 0 }}/>
            {!z.vrac && <input type="number" min={1} max={200} value={z.n} onChange={e => setZ(i, "n", e.target.value)} style={{ ...inp, width: 70 }}/>}
            <button type="button" onClick={() => setZ(i, "vrac", !z.vrac)} data-tip="En vrac : pas de cases, autant de bobines qu'on veut"
              style={{ ...seg, ...(z.vrac ? segOn : {}) }}>Vrac</button>
            {!z.vrac && <LaySelect value={z.lay || "auto"} onChange={v => setZ(i, "lay", v)} tip="La disposition de ses emplacements"/>}
            <button type="button" onClick={() => setZones(l => l.filter((_, j) => j !== i))} aria-label="Retirer la zone" style={seg}>✕</button>
          </div>)}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => setZones(l => [...l, { name: `Zone ${l.length + 1}`, n: "4" }])} style={seg}>＋ Une zone</button>
            <span style={small}>ou d'un coup :</span>
            <input value={quick.prefix} onChange={e => setQuick(q => ({ ...q, prefix: e.target.value }))} style={{ ...inp, width: 96 }}/>
            <input type="number" min={1} max={26} value={quick.count} onChange={e => setQuick(q => ({ ...q, count: e.target.value }))} style={{ ...inp, width: 56 }}/>
            {!quick.vrac && <><span style={small}>de</span>
            <input type="number" min={1} max={200} value={quick.n} onChange={e => setQuick(q => ({ ...q, n: e.target.value }))} style={{ ...inp, width: 56 }}/></>}
            <button type="button" onClick={() => setQuick(q => ({ ...q, vrac: !q.vrac }))} data-tip="Des zones en vrac (caisses, bacs) : pas de cases"
              style={{ ...seg, ...(quick.vrac ? segOn : {}) }}>Vrac</button>
            <button type="button" onClick={addQuick} style={seg}>Ajouter</button>
          </div>
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>
          <input type="checkbox" checked={single} onChange={e => setSingle(e.target.checked)}/>Des cases (une seule bobine chacune)</label>
      </>}
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}
        data-tip="Cartons, réserve : une bobine qui en sort pour l'AMS le quitte pour de bon, et l'échange intelligent n'y range jamais rien">
        <input type="checkbox" checked={stock} onChange={e => setStock(e.target.checked)}/>📦 C'est du stock (cartons, réserve)</label>
      {kind === "cells" && total > 0 && <div style={{ padding: 10, borderRadius: 12, border: "1px dashed var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={small}>Aperçu · {total} {single ? "cases" : "emplacements"}</div>
        {nd > 0 && <div style={{ display: "grid", gap: 3, gridTemplateColumns: "repeat(auto-fill, minmax(36px, 1fr))" }}>
          {Array.from({ length: Math.min(nd, 60) }, (_, i) => <div key={i} style={cellPrev(single)}>{i + 1}</div>)}</div>}
        {zs.length > 0 && <div style={{ display: "grid", gap: 6, gridTemplateColumns: layTpl(lay, zs.length) || `repeat(auto-fit, minmax(${zs.length > 4 ? 90 : 70}px, 1fr))`, alignItems: "start" }}>
          {zs.map((z, i) => <div key={i} style={{ display: z.lay === "auto" ? "flex" : "grid", flexDirection: "column", gap: 3, gridTemplateColumns: layTpl(z.lay, Math.min(z.n, 20)) || undefined, alignContent: "start" }}>
            <div style={{ ...small, fontSize: 10.5, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", gridColumn: "1 / -1" }}>{z.name}</div>
            {z.vrac ? <div style={{ ...cellPrev(false), padding: "10px 2px" }}>en vrac</div> : <>
              {Array.from({ length: Math.min(z.n, 20) }, (_, k) => <div key={k} style={cellPrev(single)}>{cellName(z.name, k + 1)}</div>)}
              {z.n > 20 && <div style={{ ...small, textAlign: "center", gridColumn: "1 / -1" }}>… {z.n}</div>}</>}
          </div>)}
        </div>}
      </div>}
    </div>
  </FSheet>, document.body);
}
// (09/11/2026) la disposition choisie a la creation : « auto », « col », « row », « g3 » (grille de 3 par ligne)
const LAYS = [["auto", "Automatique"], ["col", "En colonne"], ["row", "En ligne"], ...[2, 3, 4, 5, 6, 8].map(n => [`g${n}`, `Grille de ${n}`])];
const layBody = v => v === "col" || v === "row" ? { layout: v } : /^g\d+$/.test(v || "") ? { layout: "grid", cols: +v.slice(1) } : {};
const layTpl = (v, n) => v === "col" ? "minmax(0, 1fr)" : v === "row" ? `repeat(${Math.max(1, n)}, minmax(0, 1fr))` : /^g\d+$/.test(v || "") ? `repeat(${v.slice(1)}, minmax(0, 1fr))` : null;
function LaySelect({ value, onChange, tip }) {
  return <select value={value} onChange={e => onChange(e.target.value)} data-tip={tip} aria-label={tip}
    style={{ ...inp, width: "auto", padding: "6px 8px", fontSize: 12.5 }}>
    {LAYS.map(([k, l]) => <option key={k} value={k}>▦ {l}</option>)}</select>;
}
const cellPrev = single => ({ padding: "4px 2px", borderRadius: 6, fontSize: 10, fontWeight: 800, textAlign: "center", color: "var(--text2)",
  border: `1px ${single ? "solid" : "dashed"} color-mix(in srgb, #8B5CF6 35%, var(--border))`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });

// ── Ranger : choisir la place d'une ou plusieurs bobines ─────────────────────
export function PlacePicker({ spools, onClose, onDone, pickOnly = false, onPicked = null, title = null }) {
  const st = useStorage();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  const { kids, roots, by } = index(st);
  const ids = (spools || []).map(s => s.id);
  const one = ids.length === 1 ? spools[0] : null;
  const last = one && (one.place_id ?? one.last_place);
  const ql = q.trim().toLowerCase();
  const go = async pid => {
    if (pickOnly) { onPicked?.(pid); onClose(); return; }
    setBusy(true);
    const r = await assignSpools(ids, pid);
    setBusy(false);
    if (r) { onDone?.(r); onClose(); }
  };
  const unassign = async (toStore = false) => { setBusy(true); const r = await write("post", "/storage/assign", { spool_ids: ids, place_id: null, to_store: toStore }); setBusy(false); if (r) { onDone?.(r); onClose(); } };
  // « 📥 À ranger » (07/11/2026) : elle quitte sa place et attend qu'on dise ou elle est ; pour une bobine hors de
  // l'imprimante (ou dont le vieux slot AMS est reste en memoire)
  const TO = st.to_store_label || "À ranger";
  const canToStore = !pickOnly && st.mode !== "single" && ids.length > 0 && (spools || []).some(s => !s.ordered && s.location !== TO);
  const occOf = p => p.spools.filter(x => !ids.includes(x.id));
  const Leaf = ({ p, compact }) => {
    const occ = occOf(p), taken = p.single && occ.length > 0, mine = p.spools.some(x => ids.includes(x.id));
    const off = p.single && (ids.length > 1 || (pickOnly && taken));
    return <button type="button" disabled={busy || off} onClick={() => go(p.id)} data-tip={off ? (taken ? `Prise par la bobine #${occ[0].id}` : "Une case ne prend qu'une bobine") : taken ? `Prise par la bobine #${occ[0].id} : la toucher propose de la déloger` : undefined}
      style={{ display: "flex", alignItems: "center", gap: compact ? 2 : 6, padding: compact ? "3px 2px" : "8px 10px", borderRadius: compact ? 8 : 12, cursor: off ? "not-allowed" : "pointer",
        minWidth: 0, opacity: off ? 0.4 : 1, textAlign: "left", color: "var(--text)",
        border: mine ? "2px solid #8B5CF6" : `1px ${p.single ? "solid" : "dashed"} ${taken ? "color-mix(in srgb, #F59E0B 50%, var(--border))" : "var(--border)"}`,
        background: taken ? "color-mix(in srgb, #F59E0B 7%, var(--surface))" : "var(--surface)", flexDirection: compact ? "column" : "row", justifyContent: "center" }}>
      {taken ? <Swatch s={occ[0]} size={compact ? 16 : 26}/> : !compact && <span style={{ fontSize: 15 }}>{p.single ? "🔲" : "📚"}</span>}
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: compact ? "center" : "flex-start" }}>
        <span style={{ fontSize: compact ? 11.5 : 13, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{p.full ? p.path : shortName(p, by)}</span>
        {!compact && <span style={small}>{mine ? "ici en ce moment" : p.single ? (taken ? `prise · #${occ[0].id}` : "libre") : `${occ.length} bobine${occ.length > 1 ? "s" : ""}`}</span>}
      </span>
    </button>;
  };
  // un rangement : ses emplacements sans zone, puis ses zones cote a cote (07/11/2026), chacune en colonne
  const Group = ({ p, many }) => {
    const ch = kids[p.id] || [];
    const cells = ch.filter(c => c.leaf), subs = ch.filter(c => !c.leaf);
    return <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: p.depth ? 6 : 10, borderRadius: 14, minWidth: 0,
      border: "1px solid var(--border)", background: p.depth ? "var(--surface)" : "color-mix(in srgb, #8B5CF6 4%, var(--surface2))" }}>
      <div style={{ fontSize: p.depth ? 12 : 13.5, fontWeight: 900, color: p.depth ? "var(--text2)" : "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {p.depth ? "" : `${p.icon || (p.stock ? "📦" : "🗄")} `}{p.name}{p.stock ? " · stock" : ""}</div>
      {cells.length > 0 && (a => <div style={{ display: "grid", gap: 5, gridTemplateColumns: a.tpl }}>
        {a.items.map(c => <Leaf key={c.id} p={c} compact={many || p.layout === "row" || p.layout === "grid" || (!!p.cols && p.cols > 3)}/>)}</div>)(arrange(cells, p, many, "repeat(auto-fill, minmax(92px, 1fr))"))}
      {subs.length > 0 && (a => <div style={{ display: "grid", gap: 5, gridTemplateColumns: a.tpl, alignItems: "start" }}>
        {a.items.map(c => <div key={c.id} style={{ minWidth: 0, ...spanOf(c) }}><Group p={c} many={subs.length > 1 && !wide(c)}/></div>)}</div>)(arrange(subs, p, false, `repeat(${Math.min(subs.length, 4)}, minmax(0, 1fr))`))}
    </div>;
  };
  const found = ql ? st.places.filter(p => p.leaf && p.path.toLowerCase().includes(ql)) : null;
  const recents = recentPlaces().map(i => by[i]).filter(p => p && p.leaf && p.id !== last).slice(0, 4);
  const lastP = last != null ? by[last] : null;

  return createPortal(<FSheet onClose={onClose} z={1300} bottom={<>
    {canToStore && <button onClick={() => unassign(true)} disabled={busy} style={{ ...fBtn, flex: 1, color: "#D97706" }}
      data-tip="Elle quitte sa place et passe « À ranger » : l'appli te rappellera de dire où elle est">📥 À ranger</button>}
    {!pickOnly && st.mode !== "single" && ids.length > 0 && (spools || []).some(s => s.place_id && inPrinter(s.location)) &&
      <button onClick={() => unassign(false)} disabled={busy} style={{ ...fBtn, flex: 1, color: "var(--muted)" }} data-tip="Dans l'imprimante : elle n'aura plus de place qui l'attend">Retirer sa place</button>}
    <button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Annuler</button></>}>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {one && <Swatch s={one} size={40}/>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{title || (one ? "Où est-elle rangée ?" : `Ranger ${ids.length} bobines`)}</div>
          {one && <div style={small}>{[spoolName(one), one.filament_fila_type || one.filament_material || one.material, one.filament_manufacturer || one.brand, `#${one.id}`, one.location].filter(Boolean).join(" · ")}</div>}
        </div>
      </div>
      {!st.places.some(p => p.leaf)
        ? <div style={{ padding: 16, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 14, ...small }}>
          Aucun emplacement pour l'instant : crée-les dans Paramètres › Filaments › Rangements.
          <div><a href="/settings?tab=filament" style={{ color: "#8B5CF6", fontWeight: 900 }}>Créer mes emplacements</a></div></div>
        : <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un emplacement (A2, tiroir…)" style={inp}/>
          {!ql && (lastP || recents.length > 0) && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {lastP?.leaf && <button type="button" disabled={busy} onClick={() => go(lastP.id)} style={{ ...seg, ...segOn }}>↩ {one?.place_id ? "Sa place" : "Sa dernière place"} : {lastP.path}</button>}
            {recents.map(p => <button key={p.id} type="button" disabled={busy} onClick={() => go(p.id)} style={seg}>🕘 {p.path}</button>)}
          </div>}
          {found
            ? <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
              {found.map(p => <Leaf key={p.id} p={{ ...p, full: true }}/>)}
              {!found.length && <div style={small}>Aucun emplacement ne correspond.</div>}</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {roots.map(p => p.leaf ? <Leaf key={p.id} p={p}/> : <Group key={p.id} p={p}/>)}</div>}
        </>}
    </div>
  </FSheet>, document.body);
}

// ── Les bobines a ranger ─────────────────────────────────────────────────────
export function ToStoreSheet({ onClose, onDone }) {
  const st = useStorage();
  const [pick, setPick] = useState(null);
  if (!st) return null;
  const { by } = index(st);
  const list = st.to_store || [];
  return createPortal(<>
    <FSheet onClose={onClose} z={1250} bottom={<button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Fermer</button>}>
      <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>📥 À ranger <span style={{ ...small, fontSize: 13 }}>{list.length} bobine{list.length > 1 ? "s" : ""}</span></div>
        <div style={small}>{st.mode === "manual" ? "Sorties de l'AMS, reçues ou ajoutées : dis où tu les as mises." : "Ces bobines n'ont pas encore de place : donne-leur la leur."}</div>
        {!list.length && <div style={{ padding: 20, textAlign: "center", ...small }}>Tout est rangé 🎉</div>}
        {list.map(s => {
          const lp = s.last_place != null ? by[s.last_place] : null;
          return <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", flexWrap: "wrap" }}>
            <Swatch s={s} size={34}/>
            <div style={{ flex: "1 1 140px", minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
              <div style={{ ...small, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[s.material, s.brand].filter(Boolean).join(" · ")}</div>
              <div style={small}>#{s.id}{s.remaining_weight_g != null ? ` · ${Math.round(s.remaining_weight_g)} g` : ""}{s.unstored_at ? ` · sortie ${agoTxt(s.unstored_at)}` : ""}</div>
            </div>
            {lp?.leaf && <button type="button" onClick={async () => { if (await assignSpools([s.id], lp.id)) onDone?.(); }} style={{ ...seg, ...segOn }} data-tip="La remettre où elle était">↩ {lp.path}</button>}
            <button type="button" onClick={() => setPick(s)} style={seg}>Ranger…</button>
          </div>;
        })}
      </div>
    </FSheet>
    {pick && <PlacePicker spools={[pick]} onClose={() => setPick(null)} onDone={() => onDone?.()}/>}
  </>, document.body);
}

// le bandeau du stock : des bobines attendent
export function ToStoreBanner({ onOpen }) {
  const st = useStorage();
  const n = st?.to_store?.length || 0;
  if (!st || st.mode === "single" || !n) return null;
  const waiting = st.to_store.filter(s => s.unstored_at).length;
  return <button type="button" onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 16, cursor: "pointer",
    border: "1px solid color-mix(in srgb, #F59E0B 45%, var(--border))", background: "linear-gradient(135deg, color-mix(in srgb, #F59E0B 14%, var(--surface)), var(--surface))",
    color: "var(--text)", textAlign: "left" }}>
    <span style={icoBox("#D97706", 36, 11)}><Inbox size={19} strokeWidth={2.2}/></span>
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 14, fontWeight: 900 }}>{n} bobine{n > 1 ? "s" : ""} à ranger</span>
      <span style={small}>{waiting ? `${waiting} sortie${waiting > 1 ? "s" : ""} de l'AMS ou arrivée${waiting > 1 ? "s" : ""} : où ${waiting > 1 ? "sont-elles" : "est-elle"} ?` : "sans place pour l'instant"}</span>
    </span>
    <span style={{ ...seg, ...segOn }}>Ranger</span>
  </button>;
}

// ── Le stock par rangement ───────────────────────────────────────────────────
// spools : la liste filtree de l'onglet Stock ; renderSpool(s) : la carte de bobine de la page.
// filtering (09/11/2026) : une recherche ou un filtre ecarte des bobines ; les sections qui ont des resultats s'ouvrent, ce qui
// correspond s'allume, le reste s'estompe
export function StorageMap({ spools, onOpen, renderSpool, admin, filtering = false }) {
  const st = useStorage();
  const [fold, setFold] = useState(() => { try { return JSON.parse(localStorage.getItem("bn_storage_fold") || "{}"); } catch { return {}; } });
  const [fill, setFill] = useState(null);            // une case libre a remplir
  const [toStore, setToStore] = useState(false);
  const toggle = k => { anchor.current = k; setFold(f => { const n = { ...f, [k]: !f[k] }; try { localStorage.setItem("bn_storage_fold", JSON.stringify(n)); } catch { /* indisponible */ } return n; }); };
  // (09/11/2026) deplier ou replier une section ramenait en haut de la page : la carte entiere se redessine (ses images
  // se rechargent, la page raccourcit un instant). La section touchee revient en haut de l'ecran, et y reste le temps que
  // les images au-dessus reprennent leur place, sauf si on fait defiler entre-temps.
  const anchor = useRef(null);
  useLayoutEffect(() => {
    const k = anchor.current;
    if (k == null) return undefined;
    anchor.current = null;
    const put = () => document.querySelector(`[data-sec="${CSS.escape(k)}"]`)?.scrollIntoView({ block: "start" });
    put();
    let moved = false;
    const stop = () => { moved = true; };
    window.addEventListener("wheel", stop, { passive: true }); window.addEventListener("touchmove", stop, { passive: true });
    const ts = [120, 350, 700].map(ms => setTimeout(() => { if (!moved) put(); }, ms));
    const off = setTimeout(() => { window.removeEventListener("wheel", stop); window.removeEventListener("touchmove", stop); }, 800);
    return () => { ts.forEach(clearTimeout); clearTimeout(off); window.removeEventListener("wheel", stop); window.removeEventListener("touchmove", stop); };
  }, [fold]);
  const byId = useMemo(() => Object.fromEntries((spools || []).map(s => [s.id, s])), [spools]);
  if (!st) return null;
  const { kids, roots, by } = index(st);
  const TO = st.to_store_label || "À ranger";
  const printer = spools.filter(s => !s.ordered && inPrinter(s.location));
  // les AMS, puis les HT, et le support externe toujours en dernier (07/11/2026)
  const unitRank = u => /^externe/i.test(u) ? 2 : /^HT-/i.test(u) ? 1 : 0;
  const units = [...new Set(printer.map(s => unitOf(s.location)))].sort((a, b) => unitRank(a) - unitRank(b) || a.localeCompare(b, "fr", { numeric: true }));
  const waiting = spools.filter(s => !s.ordered && s.location === TO);
  const ordered = spools.filter(s => s.ordered);
  const storedHere = p => spools.filter(s => s.place_id === p.id && !s.ordered && !inPrinter(s.location) && s.location !== TO);
  const placed = new Set(st.mode === "single" ? [] : st.places.flatMap(p => storedHere(p).map(s => s.id)));
  const elsewhere = spools.filter(s => !s.ordered && !inPrinter(s.location) && s.location !== TO && !placed.has(s.id));
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(clamp(108px, 28vw, 136px),1fr))", gap: 8 };
  const tiles = { display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill, minmax(86px, 1fr))" };
  const slotTag = s => { const m = (s.location || "").match(/slot (\d+)$/); return m ? m[1] : null; };
  const countIn = p => p.leaf ? storedHere(p).length : (kids[p.id] || []).reduce((n, c) => n + countIn(c), 0);

  const Section = ({ k, icon, title, n, tone = "#8B5CF6", aside = null, children }) => <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div data-sec={k} style={{ display: "flex", alignItems: "center", gap: 8, scrollMarginTop: "calc(76px + env(safe-area-inset-top, 0px))" }}>
      <button type="button" onClick={() => toggle(k)} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, background: "none", border: "none",
        padding: 0, cursor: "pointer", color: "var(--text)", textAlign: "left" }}>
        <span style={{ width: 30, height: 30, borderRadius: 10, display: "grid", placeItems: "center", fontSize: 15, flexShrink: 0,
          background: `color-mix(in srgb, ${tone} 16%, var(--surface))`, border: `1px solid color-mix(in srgb, ${tone} 35%, var(--border))`, color: tone }}>{icon}</span>
        <span style={{ fontSize: 15, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        <span style={{ ...small, flexShrink: 0 }}>{n}</span>
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12 }}>{fold[k] && !(filtering && n > 0) ? "▸" : "▾"}</span>
      </button>
      {aside}
    </div>
    {(!fold[k] || (filtering && n > 0)) && children}
  </div>;

  // une case : sa bobine (ou son fantome si elle est dans l'imprimante / hors du filtre), sinon « libre »
  // une case (08/11/2026, refaite) : comme dans le tiroir, la bobine sur sa tranche en pleine largeur, son numero en
  // pastille ; le texte suit la largeur de la case (container queries, CSS plus bas) : nom sur deux lignes et sous-type ·
  // marque dans une grande, le nom seul dans une moyenne, la tranche seule dans une petite (le detail au toucher)
  const Cell = ({ p }) => {
    const occ = p.spools[0], full = occ ? byId[occ.id] : null, out = occ && occ.in_printer;
    const free = !occ, edge = edgeOf(p, by), info = infoOf(occ, full), num = shortName(p, by);
    const nm = out ? `🖨 ${unitOf(occ.location)}` : (full ? (full.filament_translated_name || full.filament_name) : occ?.name);
    return <button type="button" className={`bn-cell${free ? " bn-free bn-tightf" : " bn-tight"}${filtering && full ? " bn-match" : ""}`} onClick={() => full ? onOpen(full) : free && admin ? setFill(p) : null}
      {...idTip(occ ? (full || occ) : null, occ ? (out ? `dans l'imprimante (${occ.location}), sa case l'attend` : p.path) : null)}
      data-tip={occ ? undefined : admin ? `${num} · libre : toucher pour y ranger une bobine` : `${num} · libre`}
      style={{ cursor: full || (free && admin) ? "pointer" : "default", opacity: occ && !full && !out ? (filtering ? 0.3 : 0.55) : free && filtering ? 0.4 : 1 }}>
      {free ? <span className="bn-num-free">{num}</span> : <>
        <span className="bn-num">{num}</span>
        <span className="bn-band">
          {edge === "v" ? <SpoolEdge s={full || occ} vertical len={48} thick={24} dim={out}/>
            : edge === "c" ? <SpoolBox s={full || occ} h={58}/> : edge === "s" ? <Swatch s={full || occ} size={18} dim={out}/> : edge ? <SpoolEdge s={full || occ} len="100%" thick={EDGE_H} dim={out}/>
            : <span className="bn-pastille"><Swatch s={full || occ} size={40} dim={out}/></span>}
        </span>
        {/* (09/11/2026) condense comme la fenetre du rangement : le nom au survol, la fiche au toucher */}
        {out && <span className="bn-slot" style={{ top: "auto", bottom: 2, left: "auto", right: 2, minWidth: 0, height: 14, fontSize: 9 }}>🖨</span>}
      </>}
    </button>;
  };
  // une bobine en vrac (08/11/2026) : la meme tuile qu'une case, sans numero (les grandes cartes du stock etaient trop grosses)
  // vertical / tag (08/11/2026) : imprimante, en commande et a ranger en tuiles, la bobine debout ; tag = son slot (« A2 »)
  const Tile = ({ s, vertical = false, tag = null }) => {
    const edge = vertical ? "v" : edgeOf(p0Of(s), by), info = [s.filament_fila_type || s.filament_material, s.filament_manufacturer].filter(Boolean);
    // le slot (08/11/2026) : une pastille dans le coin de la tuile, a l'ecart de la bobine (il etait colle a sa tranche)
    return <button type="button" className={`bn-cell${filtering ? " bn-match" : ""}`} onClick={() => onOpen(s)} style={tag ? { position: "relative" } : undefined}
      {...idTip(s)}>
      {tag && <span className="bn-slot">{tag}</span>}
      <span className="bn-band">{edge === "v" ? <SpoolEdge s={s} vertical len={44} thick={22}/> : edge ? <SpoolEdge s={s} len="100%" thick={EDGE_H}/> : <Swatch s={s} size={28}/>}</span>
      <span className="bn-ct-name">{spoolName(s)}</span>
      {info.length > 0 && <span className="bn-ct-sub">{info.join(" · ")}</span>}
    </button>;
  };
  const p0Of = s => by[s.place_id] || {};
  // une bobine en vrac, condensee (09/11/2026) comme une case : sa bobine seule, le nom au survol, la fiche au toucher
  // off (09/11/2026) : hors de la recherche ou du filtre, elle reste a sa place, estompee (comme dans les cases)
  const Mini = ({ s, off = false, place = null }) => { const e = edgeOf(place || p0Of(s), by);
    return <button type="button" className={`bn-cell bn-tight${filtering && !off ? " bn-match" : ""}`} onClick={() => !off && onOpen(s)}
      {...idTip(s, (place || p0Of(s)).path)} style={off ? { opacity: 0.3, cursor: "default" } : undefined}>
      <span className="bn-band">{e === "v" ? <SpoolEdge s={s} vertical len={48} thick={24}/> : e === "c" ? <SpoolBox s={s} h={58}/> : e === "s" ? <Swatch s={s} size={18}/> : e ? <SpoolEdge s={s} len="100%" thick={EDGE_H}/>
        : <span className="bn-pastille"><Swatch s={s} size={40}/></span>}</span></button>; };
  const Common = ({ p, nested }) => {
    const here = storedHere(p);
    const away = p.spools.filter(x => x.in_printer);
    // toutes ses bobines rangees ; celles que la recherche ecarte restent, estompees
    const all = p.spools.filter(x => !x.in_printer && !x.ordered).map(x => byId[x.id] ? { s: byId[x.id] } : { s: x, off: true });
    return <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: nested ? 5 : 0, borderRadius: 10,
      border: nested ? "1px dashed color-mix(in srgb, #8B5CF6 40%, var(--border))" : "none", background: nested ? "color-mix(in srgb, #8B5CF6 3%, var(--surface2))" : "transparent" }}>
      {nested && <div style={{ fontSize: 11.5, fontWeight: 900, color: "var(--text2)", whiteSpace: "nowrap" }}>{p.name} <span style={small}>vrac · {here.length}</span></div>}
      {all.length ? <div style={{ display: "grid", gap: 2, gridTemplateColumns: `repeat(${vracCols(p, all.length)}, minmax(0, ${CELL_W(edgeOf(p, by))}px))` }}>{(p.rev ? [...all].reverse() : all).map(x => <Mini key={x.s.id} s={x.s} off={x.off} place={p}/>)}</div>
        : <div style={{ padding: 10, borderRadius: 12, border: "1.5px dashed var(--border)", textAlign: "center", ...small }}>vide</div>}
      {away.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", ...small }}>🖨 dans l'imprimante :
        {away.map(x => <span key={x.id} data-tip={`${x.name} · ${x.location}`} style={{ display: "inline-flex" }}><Swatch s={x} size={20} dim/></span>)}</div>}
    </div>;
  };
  // ses cases sans zone, ses emplacements communs, puis ses zones cote a cote (07/11/2026), chacune en colonne
  const Group = ({ p, many }) => {
    const ch = kids[p.id] || [];
    const cells = ch.filter(c => c.leaf && c.single), commons = ch.filter(c => c.leaf && !c.single), subs = ch.filter(c => !c.leaf);
    const tot = leafCountOf(p, kids), took = takenOf(p, kids);
    return <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: p.depth ? 4 : 0, borderRadius: 12,
      border: p.depth ? "1px solid var(--border)" : "none", background: p.depth ? "color-mix(in srgb, #8B5CF6 3%, var(--surface2))" : "transparent", minWidth: 0 }}>
      {p.depth > 0 && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
        <span style={{ fontSize: 11.5, fontWeight: 900, color: "var(--text2)", maxWidth: "100%", lineHeight: 1.15, textAlign: "center", overflowWrap: "anywhere",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.icon ? `${p.icon} ` : ""}{p.name}</span>
        <span style={{ ...small, fontSize: 10 }}>{took}/{tot}</span></div>}
      {cells.length > 0 && (a => <div style={{ display: "grid", gap: 2, justifyContent: "center", gridTemplateColumns: tightTpl(a.tpl, CELL_W(edgeOf(p, by)), cells.length) }}>
        {a.items.map(c => <Cell key={c.id} p={c}/>)}</div>)(arrange(cells, p, many, "repeat(auto-fill, minmax(76px, 1fr))"))}
      {/* les emplacements en vrac cote a cote (09/11/2026 : ils s'empilaient en colonne) */}
      {commons.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "flex-start" }}>{commons.map(c => <Common key={c.id} p={c} nested/>)}</div>}
      {subs.length > 0 && (a => { const row = a.items.filter(c => c.span !== -1), full = a.items.filter(c => c.span === -1);
        return <div style={{ display: "inline-flex", flexDirection: "column", gap: 4, maxWidth: "100%", minWidth: 0 }}>
          {row.length > 0 && <div style={{ display: "grid", gap: 4, gridTemplateColumns: a.tpl.replace(/minmax\(0, 1fr\)/g, "minmax(0, max-content)"), justifyContent: "start", alignItems: "start" }}>
            {row.map(c => <div key={c.id} style={{ minWidth: 0, ...spanOf(c) }}><Group p={c} many={subs.length > 1 && !wide(c)}/></div>)}</div>}
          {full.map(c => <div key={c.id} style={{ minWidth: 0 }}><Group p={c} many={false}/></div>)}</div>; })(arrange(subs, p, false, `repeat(${Math.min(subs.length, 4)}, minmax(0, 1fr))`))}
    </div>;
  };

  return <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
    <style>{CELL_CSS}</style>
    <SpoolIdHost/>
    {/* (09/11/2026) condense comme les rangements : chaque unite a sa largeur, les bobines debout, serrees, le slot dans le coin */}
    {printer.length > 0 && <Section k="printer" icon={<Printer size={16} strokeWidth={2.2}/>} title="Dans l'imprimante" n={printer.length} tone="#0EA5E9">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
      {units.map(u => { const list = printer.filter(s => unitOf(s.location) === u).sort((a, b) => (a.location || "").localeCompare(b.location || "", "fr", { numeric: true }));
        return <div key={u} style={{ display: "flex", flexDirection: "column", gap: 3, padding: 4, borderRadius: 10, border: "1px solid var(--border)",
          background: "color-mix(in srgb, #0EA5E9 4%, var(--surface2))" }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: "var(--text2)", textAlign: "center" }}>{u}</div>
          <div style={{ display: "grid", gap: 2, gridTemplateColumns: `repeat(${Math.max(1, list.length)}, ${CELL_W("v")}px)` }}>
            {list.map(s => <button key={s.id} type="button" className={`bn-cell bn-tight${filtering ? " bn-match" : ""}`} onClick={() => onOpen(s)} {...idTip(s)}>
              {slotTag(s) && <span className="bn-num">{slotTag(s)}</span>}
              <span className="bn-band"><SpoolEdge s={s} vertical len={48} thick={24}/></span></button>)}
          </div></div>; })}
      </div>
    </Section>}
    {st.mode === "single"
      ? (elsewhere.length > 0 && <Section k="single" icon={<Archive size={16} strokeWidth={2.2}/>} title={st.name} n={elsewhere.length}><div style={grid}>{elsewhere.map(s => renderSpool(s))}</div></Section>)
      : <>
        {/* (09/11/2026) condenses, les rangements se mettent cote a cote quand la largeur le permet */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-start" }}>
        {roots.map(p => <div key={p.id} style={{ flex: "0 1 auto", minWidth: 0, maxWidth: "100%" }}>
          <Section k={`p${p.id}`} icon={<PlaceIco p={p}/>} tone={p.stock ? "#D97706" : "#8B5CF6"} title={p.stock ? `${p.name} · stock` : p.name} n={countIn(p)}>
          {p.leaf ? (p.single ? <div style={{ maxWidth: 120 }}><Cell p={p}/></div> : <Common p={p}/>) : <Group p={p}/>}
        </Section></div>)}
        </div>
        {elsewhere.length > 0 && <Section k="else" icon={<HelpCircle size={16} strokeWidth={2.2}/>} title="Ailleurs" n={elsewhere.length} tone="#64748B"><div style={grid}>{elsewhere.map(s => renderSpool(s))}</div></Section>}
      </>}
    {ordered.length > 0 && <Section k="ordered" icon={<Truck size={16} strokeWidth={2.2}/>} title="En commande" n={ordered.length} tone="#0EA5E9">
      {/* (09/11/2026) ses cartons, comme ils arrivent : kraft, l'etiquette en pilule et la pastille de sa couleur */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{ordered.map(s => <button key={s.id} type="button" onClick={() => onOpen(s)} {...idTip(s, "en commande")}
        className={filtering ? "bn-match" : undefined} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: 2, border: "none",
          background: "none", cursor: "pointer", borderRadius: 10, color: "var(--text)" }}>
        <SpoolBox s={s} h={62}/>
        {s.order_refill && <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--muted)", marginTop: -2 }}>recharge</span>}
        <span style={{ fontSize: 11.5, fontWeight: 800, maxWidth: 76, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{spoolName(s)}</span>
      </button>)}</div></Section>}
    {/* a ranger, en dernier (07/11/2026) : la liste peut etre longue, les rangements d'abord */}
    {waiting.length > 0 && <Section k="tostore" icon={<Inbox size={16} strokeWidth={2.2}/>} title="À ranger" n={waiting.length} tone="#F59E0B"
      aside={admin && <button type="button" onClick={() => setToStore(true)} style={{ ...seg, ...segOn }}>Ranger</button>}>
      <div style={tiles}>{waiting.map(s => <Tile key={s.id} s={s} vertical/>)}</div>
    </Section>}
    {!spools.length && <div style={{ padding: 20, textAlign: "center", ...small }}>Aucune bobine ne correspond.</div>}
    {fill && <CellFiller place={fill} spools={spools} onClose={() => setFill(null)}/>}
    {toStore && <ToStoreSheet onClose={() => setToStore(false)}/>}
  </div>;
}

// Ranger dans une case (07/11/2026) : une bobine de la liste, ou scannee (appli Android). « Enchainer » : la bobine
// rangee, on passe a l'emplacement suivant du meme rangement (dans l'ordre des zones et sous-zones), le scan reste actif,
// la liste reste la ; on peut passer une case, revenir, terminer. Les cases prises sont sautees, sauf si on le decoche.
const CHAIN_KEY = "bn_store_chain", SKIP_KEY = "bn_store_skip";
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v === "1"; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* indisponible */ } };

function CellFiller({ place, spools: spools0, onClose }) {
  const st = useStorage();
  const [q, setQ] = useState("");
  const [chain, setChain] = useState(() => lsGet(CHAIN_KEY, false));
  const [skip, setSkip] = useState(() => lsGet(SKIP_KEY, true));
  const [curId, setCurId] = useState(place.id);
  const [done, setDone] = useState([]);              // bobines rangees pendant la serie
  // (07/11/2026) ce qui vient d'etre range, bien visible : « c'etait subtil, j'ai failli rescanner la meme »
  const [last, setLast] = useState(null);            // { s, cell, n }
  const placedIn = useRef({});                       // bobine -> emplacement ou elle a ete rangee pendant la serie
  // le son dit si c'est bon (07/11/2026) : l'appli Android vibre deja a chaque lecture, ratee comprise ; deux notes
  // montantes = rangee, une note grave = rien (tag inconnu, deja rangee). Le contexte audio nait au toucher du bouton
  // de scan (le navigateur n'autorise le son qu'apres un geste).
  const audio = useRef(null);
  const tone = (f, t0, d, type = "sine", vol = 0.18) => {
    const ctx = audio.current; if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime + t0;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.start(t); o.stop(t + d + 0.02);
  };
  // rangee : aussi une double vibration (telephone en silencieux), un peu apres celle de la lecture pour la distinguer
  const buzz = p => {
    try { if (Array.isArray(p)) tone(196, 0, 0.32, "square", 0.08); else { tone(880, 0, 0.11); tone(1320, 0.12, 0.16); } } catch { /* pas de son */ }
    // l'appli Android vibre par son pont (la WebView n'a pas navigator.vibrate) ; sinon le navigateur
    if (!Array.isArray(p)) setTimeout(() => haptic("ok"), 350);
  };
  const [busy, setBusy] = useState(false);
  const scan = useRfidScan();
  const [waiting, setWaiting] = useState(false);
  const started = useRef(false);                     // l'ecoute lancee ici : coupee en partant
  const pickRef = useRef(null);
  useEffect(() => () => { useRfidScan.getState().setCapture(null); if (started.current) useRfidScan.getState().stop(); }, []);
  const TO = st?.to_store_label || "À ranger";
  const { by } = index(st);
  const rootOf = id => { let p = by[id]; while (p && p.parent_id != null && by[p.parent_id]) p = by[p.parent_id]; return p?.id; };
  const root = rootOf(place.id);
  // les emplacements du rangement, dans l'ordre (zones puis sous-zones, comme dans l'arbre)
  const seq = (st?.places || []).filter(p => p.leaf && rootOf(p.id) === root);
  const cur = by[curId] || place;
  const pos = seq.findIndex(p => p.id === curId);
  const freeOk = p => !(p.single && p.spools.length);
  const nextFrom = (i, d) => { for (let k = i + d; k >= 0 && k < seq.length; k += d) if (!skip || freeOk(seq[k]) || d < 0) return seq[k]; return null; };
  const goNext = () => { const n = nextFrom(pos, 1); if (n) setCurId(n.id); else { toast("Dernier emplacement de ce rangement : série terminée", "success", 2500); onClose(); } };
  const pick = async s => {
    if (busy) return;
    // deja rangee ailleurs (07/11/2026) : on demande, au lieu de la deplacer sans rien dire
    const fromId = s.place_id ?? (st?.places || []).find(p => p.spools.some(x => x.id === s.id))?.id;
    if (fromId && fromId !== curId && by[fromId]) {
      const from = by[fromId];
      const v = await showChoice(`« ${spoolName(s)} » (#${s.id}) est déjà rangée en ${from.path}.
Que veux-tu faire ?`, [
        { value: "move", icon: "➡", label: `La déplacer en ${(by[curId] || cur).path}`, hint: `${from.path} redevient libre`, tone: "#8B5CF6" },
        { value: "keep", icon: "✋", label: "La laisser où elle est", hint: chain ? "On reste sur cet emplacement : scanne ou choisis une autre bobine" : undefined },
      ], { title: "Déjà rangée ailleurs" });
      if (v !== "move") return;
    }
    setBusy(true);
    const r = await assignSpools([s.id], curId);
    setBusy(false);
    if (!r) return;
    setDone(d => [...d, s.id]);
    const cellNm = (by[curId] || cur).path;
    placedIn.current[s.id] = cellNm;
    buzz(70);
    // sur un emplacement en vrac (commun), on y reste : chaque bobine scannee y va, jusqu'a « Passer » (07/11/2026)
    if (chain) { setLast(l => ({ s: (spools0 || []).find(x => x.id === s.id) || s, cell: cellNm, n: (l?.n || 0) + 1 })); setQ(""); if ((by[curId] || cur).single) goNext(); } else onClose();
  };
  pickRef.current = pick;
  const startScan = async () => {
    try { if (!audio.current) audio.current = new (window.AudioContext || window.webkitAudioContext)(); audio.current.resume?.(); } catch { /* pas d'audio */ }
    if (!scan.listening) { await scan.start(); started.current = true; }
    setWaiting(true);
    useRfidScan.getState().setCapture(d => {
      const qs = new URLSearchParams((d.redirect || "").split("?")[1] || "");
      const sid = Number(qs.get("spool"));
      if (!sid) { toast(qs.get("rfid") ? "Bobine inconnue : ajoute-la d'abord (scan depuis la page Filaments)" : "Tag non reconnu", "error", 3000); buzz([60, 40, 60]); return; }
      // deja rangee pendant cette serie : on ne la deplace pas (un second scan de la meme, par doute)
      if (placedIn.current[sid]) { toast(`Déjà rangée (${placedIn.current[sid]}) : scanne la suivante`, "error", 3000); buzz([60, 40, 60]); return; }
      pickRef.current?.((spools0 || []).find(s => s.id === sid) || { id: sid });
    });
  };
  const stopScan = () => { useRfidScan.getState().setCapture(null); setWaiting(false); };
  if (!st) return null;
  const pri = s => s.location === TO ? 0 : !s.place_id ? 1 : 2;
  const ql = foldTxt(q.trim());
  const list = (spools0 || []).filter(s => !done.includes(s.id) && s.place_id !== curId && !s.ordered)
    .filter(s => !ql || foldTxt([spoolName(s), s.filament_manufacturer, s.filament_fila_type, s.filament_material, String(s.id), s.location].filter(Boolean).join(" ")).includes(ql))
    .sort((a, b) => pri(a) - pri(b)).slice(0, 80);
  const occ = cur.single ? cur.spools[0] : null;
  const toggle = (k, set) => v => { set(v); lsSet(k, v); };

  return createPortal(<FSheet onClose={onClose} z={1300} bottom={chain ? <>
    <button onClick={() => { const p = nextFrom(pos, -1); if (p) setCurId(p.id); }} disabled={pos <= 0} style={{ ...fBtn, flex: 1, opacity: pos <= 0 ? 0.5 : 1 }}>⏮</button>
    <button onClick={goNext} style={{ ...fBtn, flex: 2 }}>⏭ Passer</button>
    <button onClick={onClose} style={{ ...fBtn, flex: 2 }}>Terminer{done.length ? ` (${done.length})` : ""}</button></>
    : <button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Annuler</button>}>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <style>{`@keyframes bnOk{0%{transform:scale(.96);box-shadow:0 0 0 0 rgba(34,197,94,.7)}60%{transform:scale(1.01);box-shadow:0 0 0 10px rgba(34,197,94,0)}100%{transform:scale(1)}}
        @keyframes bnNext{0%{background:color-mix(in srgb,#8B5CF6 35%,var(--surface))}100%{background:color-mix(in srgb,#8B5CF6 10%,var(--surface))}}`}</style>
      {chain && last && <div key={`ok${last.n}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, animation: "bnOk .7s ease-out",
        border: "2px solid #22C55E", background: "color-mix(in srgb, #22C55E 14%, var(--surface))" }}>
        <span style={{ fontSize: 22 }}>✅</span>
        <Swatch s={last.s} size={30}/>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Rangée : {spoolName(last.s)} <span style={{ color: "var(--muted)", fontWeight: 800 }}>#{last.s.id}</span></span>
          <span style={{ fontSize: 12, fontWeight: 800, color: "#16A34A" }}>dans {last.cell}</span>
        </span>
      </div>}
      <div>
        {chain ? <div key={`cur${curId}`} style={{ padding: "10px 12px", borderRadius: 14, border: "2px solid #8B5CF6", animation: last ? "bnNext 1.2s ease-out" : undefined,
          background: "color-mix(in srgb, #8B5CF6 10%, var(--surface))" }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#8B5CF6" }}>{last ? (cur.single ? "➡ Maintenant" : "↻ On reste ici") : "Emplacement"} · {pos + 1} sur {seq.length}{!cur.single ? " · en vrac : scanne tant que tu veux, « Passer » pour continuer" : ""}</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)" }}>{cur.path}</div>
          <div style={small}>{done.length} rangée{done.length > 1 ? "s" : ""} pendant la série</div>
        </div>
          : <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>Ranger dans « {cur.path} »</div>}
        {occ && <div style={{ ...small, color: "#B45309" }}>Prise par « {occ.name} » (#{occ.id}) : la bobine choisie la délogera, après confirmation.</div>}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 800, color: "var(--text2)" }}>
          <input type="checkbox" checked={chain} onChange={e => toggle(CHAIN_KEY, setChain)(e.target.checked)}/>🔁 Enchaîner les emplacements suivants</label>
        {chain && <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>
          <input type="checkbox" checked={skip} onChange={e => toggle(SKIP_KEY, setSkip)(e.target.checked)}/>sauter les cases prises</label>}
      </div>
      {scan.available && <button type="button" onClick={waiting ? stopScan : startScan}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px 12px", borderRadius: 14, cursor: "pointer", font: "inherit",
          fontSize: 14, fontWeight: 900, border: "none", color: "#fff", background: waiting ? "linear-gradient(135deg, #22C55E, #16A34A)" : "linear-gradient(135deg, #8B5CF6, #6366F1)",
          boxShadow: waiting ? "0 0 0 4px rgba(34,197,94,0.25)" : "none" }}>
        📡 {waiting ? (busy ? "Rangement…" : "Approche la bobine du téléphone… (toucher pour arrêter)") : "Scanner la bobine (RFID)"}</button>}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher une bobine" style={inp}/>
      {list.map(s => <button key={s.id} type="button" disabled={busy} onClick={() => pick(s)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
        borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
        <Swatch s={s} size={32}/>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{spoolName(s)}</span>
          <span style={{ ...small, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {[s.filament_fila_type || s.filament_material, s.filament_manufacturer].filter(Boolean).join(" · ")}</span>
          <span style={small}>#{s.id}{s.remaining_weight_g != null ? ` · ${Math.round(s.remaining_weight_g)} g` : ""} · {s.location === TO ? "📥 à ranger" : s.location}</span>
        </span>
      </button>)}
      {!list.length && <div style={small}>Aucune bobine.</div>}
    </div>
  </FSheet>, document.body);
}
