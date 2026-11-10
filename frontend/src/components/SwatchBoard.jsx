import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import { egg } from "../eggs";
import { useIsAdmin } from "../store/auth";
import { useFriend } from "../store/friend";
import { showAlert, showChoice, showConfirm } from "../utils/dialog";
import { colorBg, parseColorsList, isDark, finishOf } from "../utils/colors";
import { FSheet } from "./FicheKit";
import { tipCard } from "./TipHost";

// Les planches des echantillons (10/11/2026) : le rangement physique du nuancier. Une ou plusieurs planches (SKADIS
// ou autre), chacune de sa couleur, en lignes de cases reparties sur des rails. Une case tient un echantillon ou un
// intercalaire (qui prend une case, comme la vraie etiquette). On touche une case pour y poser l'un ou l'autre ;
// « Ranger automatiquement » pose tout par sous-type, trie par teinte, avec de la marge au bout de chaque section.
// Le tout vit cote serveur (/filaments/boards) : un seul reglage, toutes planches comprises.

export const BOARD_MODELS = [
  { id: "skadis-76x56", l: "SKÅDIS 76 × 56, debout", rows: 12, cols: 26, rails: 2 },
  { id: "skadis-56x56", l: "SKÅDIS 56 × 56", rows: 9, cols: 26, rails: 2 },
  { id: "skadis-76x56-h", l: "SKÅDIS 76 × 56, couché", rows: 9, cols: 39, rails: 3 },
  { id: "skadis-36x56", l: "SKÅDIS 36 × 56", rows: 9, cols: 13, rails: 1 },
  { id: "custom", l: "Sur mesure" },
];
export const BOARD_COLORS = [["Noir", "#1f1f1f"], ["Blanc", "#f2f1ec"], ["Bois", "#c9a77c"], ["Gris", "#8f969c"], ["Vert", "#7f9479"], ["Rose", "#e3b5b0"], ["Bleu", "#4b6f9e"]];

// les sections d'une planche (10/11/2026) : chacune son nom, les sous-types qu'elle prend (« PLA Basic » peut prendre
// PLA Basic, PLA Classic, PLA+…) et l'ecart entre ses sous-types (« PLA Effets » : Sparkle, Glow, Marble… espaces de
// 2 cases). Chacun regle les siennes dans les reglages de la planche ; d'office, elles sont devinees d'apres les
// sous-types des filaments, sans separation par marque. « Autres » prend ce qui n'est dans aucune, « Indispo » (pas de
// bobine active) vient toujours en dernier.
const typeOf = f => String(f.fila_type || f.material || "?").trim();
const guessSection = t => { const s = t.toLowerCase();
  if (/^tpu/.test(s)) return "TPU";
  if (/support|asa|abs|-cf|\bcf\b|\bpa\b|\bpc\b|pa6|pa12/.test(s)) return "Techniques";
  if (s.includes("petg")) return s.includes("translucent") ? "PETG Translucent" : "PETG";
  if (s.includes("matte")) return "PLA Matte";
  if (s.includes("silk")) return "PLA Silk";
  if (s.includes("wood")) return "PLA Wood";
  if (/sparkle|glow|galaxy|marble|metal|translucent|rainbow|gradient/.test(s)) return "PLA Effets";
  return "PLA Basic"; };
const SECTION_ORDER = ["PLA Basic", "PLA Matte", "PLA Silk", "PLA Wood", "PLA Effets", "PETG", "PETG Translucent", "Techniques", "TPU"];
const SECTIONS = [...SECTION_ORDER, "Indispo"];
export const defaultSections = types => SECTION_ORDER.map(label => ({ label, types: types.filter(t => guessSection(t) === label), gap: label === "PLA Effets" ? 2 : 0 }))
  .filter(s => s.types.length);
const sectionsOf = (board, filaments) => (board.sections?.length ? board.sections : defaultSections([...new Set(filaments.map(typeOf))].sort()));
// (10/11/2026) les blocs d'une section : un sous-type peut aller « avec » un autre (Marble et High Speed Marble : un seul
// bloc, sans ecart entre eux) ; et « par marque » coupe chaque bloc par marque (dans l'ordre alphabetique)
const rootOf = (s, t) => { let r = t; for (let i = 0; i < 6 && s.with?.[r] && s.types.includes(s.with[r]) && s.with[r] !== t; i++) r = s.with[r]; return r; };
const blocksOf = s => { const out = new Map(); for (const t of s.types) { const r = rootOf(s, t); if (!out.has(r)) out.set(r, []); out.get(r).push(t); } return [...out.values()]; };
// (10/11/2026) dispo : une bobine active, ou en commande / en livraison
const dispo = f => f.active_spool_count > 0 || f.ordered_spool_count > 0 || f.shipping_spool_count > 0;
const sectionIn = (f, secs) => (!dispo(f) ? "Indispo" : secs.find(s => s.types.includes(typeOf(f)))?.label || "Autres");
export function sectionOf(f) { return !dispo(f) ? "Indispo" : guessSection(typeOf(f)); }

const key = (r, c) => `${r}:${c}`;
const fname = f => f.translated_name || f.name;
const railCols = (cols, rails) => { const base = Math.floor(cols / rails), extra = cols % rails;
  return Array.from({ length: rails }, (_, i) => base + (i < extra ? 1 : 0)); };
const swatchBg = (f, size = 24) => colorBg(parseColorsList(f.color, f.colors_array), f.multicolor_type, f.fila_finish, { size }) || { background: `#${String(f.color || "94a3b8").slice(0, 6)}` };
const newBoard = (n, m = BOARD_MODELS[0]) => ({ id: `p${Date.now().toString(36)}`, name: `Planche ${n}`, model: m.id, color: "#1f1f1f",
  rows: m.rows || 9, cols: m.cols || 26, rails: m.rails || 2, cells: {} });

// le rangement automatique d'une planche : les sections dans l'ordre, chacune ouverte par son intercalaire, ses
// echantillons par teinte, puis sa marge (au moins 2 cases, 20 %, plus une case par filament qui attend son
// echantillon) ; ce qui reste de la planche s'ajoute aux marges, a proportion, pour qu'aucune case ne reste a part.
// Une section qui passe a la ligne suivante y reprend avec son intercalaire ; jamais un intercalaire seul en bout de ligne.
// (10/11/2026) la marge se regle par planche : au moins « margin » cases, « marginPct » %, et « fill » (non d'office :
// elle creusait de grands trous) repartit ce qui reste de la planche dans les marges ; sans, le reste est a la fin.
// Un seul intercalaire par section : une section qui passe a la ligne suivante y continue sans le repeter.
const marginOf = b => ({ min: b.margin ?? 2, pct: b.marginPct ?? 20, spread: b.fill === true });
function pack(board, groups) {
  const W = board.cols, cap = board.rows * board.cols;
  const lay = extra => {
    const cells = {}; let pos = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const seq = [...(g.parts || [g.items]).flatMap((p, i) => [...(i ? Array(g.gap || 0).fill(null) : []), ...p.map(f => ({ t: "s", fid: f.id }))]),
        ...Array(g.margin + extra[gi]).fill(null)];
      if (W - (pos % W) <= 3) pos += W - (pos % W);        // pas d'intercalaire dans les 3 dernieres cases : ligne suivante
      cells[key(Math.floor(pos / W), pos % W)] = { t: "d", label: g.label }; pos++;
      for (let i = 0; i < seq.length; i++) {
        if (seq[i]) cells[key(Math.floor(pos / W), pos % W)] = seq[i];
        pos++;
      }
      if (pos > cap) return null;
    }
    return cells;
  };
  const base = groups.map(() => 0);
  if (!lay(base)) return null;
  const used = groups.reduce((a, g) => a + 1 + g.items.length + g.margin + (g.gap || 0) * Math.max(0, (g.parts?.length || 1) - 1), 0);
  const free = Math.max(0, cap - used), tot = groups.reduce((a, g) => a + g.items.length, 0) || 1;
  const extra = groups.map(g => (marginOf(board).spread ? Math.floor(free * g.items.length / tot) : 0));
  for (let guard = 0; guard < 400; guard++) {
    const out = lay(extra);
    if (out) return out;
    const i = extra.indexOf(Math.max(...extra));
    if (extra[i] <= 0) break;
    extra[i]--;
  }
  return lay(base);
}

// ---- la planche dessinee (10/11/2026, revue) : une vraie SKADIS percee, des rails a peigne, l'echantillon torsade vu
// sur la tranche, pose dans le rail et qui depasse un poil dessous, l'intercalaire avec son etiquette comme les vrais.
// Tout en millimetres dans un seul SVG qui prend la largeur ; l'echantillon et son ombrage sont dessines une fois
// (<defs>) puis repris par <use> : la couleur seule change d'une case a l'autre.
// (10/11/2026, revu deux fois, mesure sur la photo de la vraie planche) en cases : les rails vont presque d'un chant a
// l'autre (embout gauche, jonction, embout droit, seules pieces accrochees), un rail tous les 3,5 cases ; les trous ont
// leur propre grille, independante des rails : 3,5 cases entre deux trous d'une rangee, rangees en quinconce tous les
// 1,4 case, trous d'environ 0,5 x 1,75 case, les premiers a 2 cases du chant ; l'echantillon 2,2 cases de haut
const PITCH = 20, JOIN = 20, ROW = 70, EDGE = 26;
const HX = 70, HY = 28, HW = 10.5, HH = 35, HMX = 38, HMY = 30;     // les trous : pas, quinconce, taille, marges au chant
const SW = 19, SH = 44, BAR = 6, OVER = 5;                  // l'echantillon (tranche) ; le rail ; ce qui depasse dessous
const MT = 80;
// l'echantillon : un prisme hexagonal torsade, couche sur la tranche. A chaque abscisse, l'hexagone a tourne : ses
// sommets montent et descendent, ce qui fait le bord ondule en haut et en bas, et ses faces passent de l'ombre a la
// lumiere en diagonale (le vrille de la piece)
const GEO = (() => {
  const Rr = SH / 2, N = 20, th = 115 * Math.PI / 180, p0 = 5 * Math.PI / 180, K = [0, 1, 2, 3, 4, 5];
  const xs = Array.from({ length: N + 1 }, (_, i) => i * SW / N);
  const phi = x => p0 + th * x / SW;
  const vy = (x, k) => Rr - Rr * Math.cos(phi(x) + k * Math.PI / 3);      // y (vers le bas) du sommet k
  const top = x => Math.min(...K.map(k => vy(x, k))), bot = x => Math.max(...K.map(k => vy(x, k)));
  const f = n => n.toFixed(2);
  const outline = `M${xs.map(x => `${f(x)},${f(top(x))}`).join(" L")} L${[...xs].reverse().map(x => `${f(x)},${f(bot(x))}`).join(" L")} Z`;
  const polys = [], ridges = [];
  for (let i = 0; i < N; i++) {
    const a = xs[i], b = xs[i + 1], m = (a + b) / 2;
    for (const k of K) {
      const n = phi(m) + k * Math.PI / 3 + Math.PI / 6;                    // la normale de la face k
      if (Math.sin(n) <= 0.02) continue;                                    // tournee vers le mur
      const lam = 0.6 * Math.cos(n) + 0.8 * Math.sin(n);                    // la lumiere vient d'en haut, de face
      const s = Math.max(-0.85, Math.min(0.75, (lam - 0.55) * 1.4));
      // un soupcon de recouvrement entre bandes : sans lui, un fil du fond passe entre deux (anticrenelage)
      const a0 = f(a - .05), b0 = f(b + .05);
      const d = `M${a0},${f(vy(a, k))} L${b0},${f(vy(b, k))} L${b0},${f(vy(b, k + 1))} L${a0},${f(vy(a, k + 1))} Z`;
      polys.push({ d, s, t: Math.sin(n), c: Math.cos(n) });                // t : de face (1) a la tranche (0) ; c : vers le haut (1) ou le bas (-1)
    }
  }
  for (const k of K) {                                                      // les aretes visibles, en fin liseré clair
    let seg = [];
    const flush = () => { if (seg.length > 1) ridges.push(`M${seg.join(" L")}`); seg = []; };
    for (const x of xs) { if (Math.sin(phi(x) + k * Math.PI / 3) > 0) seg.push(`${f(x)},${f(vy(x, k))}`); else flush(); }
    flush();
  }
  return { outline, polys, ridges };
})();
const hex6 = c => `#${String(c || "94a3b8").replace("#", "").slice(0, 6)}`;
// un coaxial (comme la vue 3D) : sa couleur depend de l'angle, la premiere de face, la deuxieme en biais, la troisieme
// sur la tranche, fondues l'une dans l'autre
const mixHex = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)]; return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`; };
// (10/11/2026) d'apres l'orientation haut / bas de la face : par l'angle de face, les faces rasantes faisaient de fins
// liseres de l'autre couleur sur les bords
const coaxAt = (cs, c) => { const u = Math.min(1, Math.max(0, (1 - c) / 2)) * (cs.length - 1), k = Math.min(cs.length - 2, Math.floor(u));
  return mixHex(cs[k], cs[k + 1], u - k); };
// la matiere d'un echantillon : ses couleurs (un degrade s'imprime du bas vers le haut : couche sur la tranche, il va
// de gauche a droite ; un coaxial, bi- ou tricolore, montre une couleur par face), sa finition, sa transparence
const fillOf = f => {
  const cs = parseColorsList(f.color, f.colors_array).map(hex6);
  const kind = cs.length < 2 ? "solid" : f.multicolor_type === "coaxial" ? "coax" : "grad";
  const a = /^#?[0-9a-f]{8}$/i.test(String(f.color || "")) ? parseInt(String(f.color).replace("#", "").slice(6, 8), 16) : 255;
  return { kind, cs: cs.length ? cs : [hex6(f.color)], fx: finishOf(f), trans: a < 235 || /translucent|transparent|clear/i.test(f.fila_type || "") };
};
// les motifs des finitions, poses par-dessus la couleur (en mm, a l'echelle de l'echantillon)
const FX_PAT = {
  sparkle: [6, [[1.1, .8, .32, "#fff"], [4.3, 1.9, .26, "#fde68a"], [2.6, 3.6, .3, "#fff"], [5.2, 4.8, .22, "#fff"], [.6, 5.1, .25, "#fde68a"], [3.5, .3, .18, "#fff"]], .95],
  galaxy: [5, [[.8, .9, .18, "#fff"], [3.6, 1.7, .14, "#fff"], [2.1, 3.4, .2, "#c4b5fd"], [4.4, 4.2, .12, "#fff"], [1.2, 4.6, .1, "#fff"]], 1],
  carbon: [1.6, [[.4, .4, .3, "#000"], [1.2, 1.2, .3, "#000"]], .35],
};
const FxPattern = ({ id, fx }) => {
  if (FX_PAT[fx]) { const [s, dots, op] = FX_PAT[fx];
    return <pattern id={id} width={s} height={s} patternUnits="userSpaceOnUse">{dots.map(([x, y, r, c], i) => <circle key={i} cx={x} cy={y} r={r} fill={c} opacity={op}/>)}</pattern>; }
  if (fx === "marble") return <pattern id={id} width="14" height="14" patternUnits="userSpaceOnUse">
    <path d="M-1,4 C3,2 5,7 9,5 S13,8 15,6 M-1,11 C2,9 6,13 10,10 S13,12 15,11" fill="none" stroke="#000" strokeOpacity=".28" strokeWidth=".45"/>
    <circle cx="4" cy="9" r=".35" fill="#000" opacity=".35"/><circle cx="11" cy="2" r=".3" fill="#000" opacity=".3"/></pattern>;
  if (fx === "wood") return <pattern id={id} width="2.4" height="8" patternUnits="userSpaceOnUse">
    <path d="M.6,0 C.9,2 .3,5 .7,8 M1.8,0 C1.6,3 2.1,5 1.7,8" fill="none" stroke="#3b2412" strokeOpacity=".3" strokeWidth=".35"/></pattern>;
  return null;
};
// chaque rail : ses cases, ou il commence (x0, la premiere case) ; une jonction (ou un embout) a JOIN/2 de chaque bout
const railsOf = (cols, rails) => { let s = 0, x = EDGE + JOIN / 2;
  return railCols(cols, rails).map((n, i) => { const r = { i, start: s, n, x0: x }; s += n; x += n * PITCH + JOIN; return r; }); };
const cellX = (c, rails) => { const rl = rails.find(r => c < r.start + r.n) || rails[rails.length - 1]; return rl.x0 + (c - rl.start) * PITCH; };

function BoardSVG({ board, byId, edit, tap, where, dimOf, holdK }) {
  const rails = railsOf(board.cols, board.rails);
  const W = 2 * EDGE + board.cols * PITCH + board.rails * JOIN, yLast = MT + (board.rows - 1) * ROW;
  const H = yLast + BAR + OVER + 50;
  const dark = isDark(board.color);
  // les trous : une colonne au milieu de la planche, des rangees en quinconce centrees en hauteur, rien pres du chant
  const holes = [];
  const ny = Math.floor((H - 2 * HMY) / HY), y0 = (H - ny * HY) / 2;
  for (let j = 0; j <= ny; j++) {
    const y = y0 + j * HY;
    for (let m = -Math.ceil(W / HX) * 2; m <= Math.ceil(W / HX) * 2; m++) {
      if ((m + j) % 2) continue;
      const x = W / 2 + m * HX / 2;
      // (10/11/2026) un trou que coupe un rail laissait deux picots, dessus et dessous : il n'est pas dessine
      const cut = Array.from({ length: board.rows }, (_, r) => MT + r * ROW).some(yb => y - HH / 2 < yb + BAR + 1 && y + HH / 2 > yb - 1);
      if (!cut && x >= HMX && x <= W - HMX) holes.push([x, y]);
    }
  }
  // les pieces du support d'une rangee : embout gauche, jonctions, embout droit
  const joints = [EDGE, ...rails.map(rl => rl.x0 + rl.n * PITCH + JOIN / 2)];
  const hole = dark ? "#d9d7d1" : "color-mix(in srgb, " + board.color + " 55%, #000)";
  const rail = "#141414", railHi = "#3a3a3a";
  const grads = [];
  const cells = [];
  for (let r = 0; r < board.rows; r++) {
    const yb = MT + r * ROW;
    for (let c = 0; c < board.cols; c++) {
      const k = key(r, c), cell = board.cells[k], x = cellX(c, rails);
      cells.push({ r, c, k, cell, x, yb, f: cell?.t === "s" ? byId.get(cell.fid) : null });
    }
  }
  // la loupe au doigt (10/11/2026) : un appui maintenu ouvre une bulle au-dessus du doigt, qui grossit la planche la ou
  // il est et dit ce qu'il y a dessous ; elle suit le doigt, et le lacher ouvre la case visee. La bulle reprend le dessin
  // de la planche par <use> : rien n'est redessine.
  const svgRef = useRef(null), wrap = useRef(null), press = useRef(null), lpRef = useRef(null), skip = useRef(0);
  const [lp, setLp] = useState(null);
  const show = (x, y) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const k = document.elementFromPoint(x, y)?.closest?.("[data-k]")?.getAttribute("data-k") || null;
    const v = { x, y, ux: (x - r.left) * W / r.width, uy: (y - r.top) * W / r.width, sc: r.width / W, k };
    lpRef.current = v; setLp(v);
  };
  const down = e => {
    if (e.pointerType !== "touch") return;
    if (press.current) { clearTimeout(press.current.t); press.current = null; lpRef.current = null; setLp(null); return; }   // un 2e doigt : on lache tout
    const p = { x: e.clientX, y: e.clientY, on: false };
    p.t = setTimeout(() => { if (press.current !== p) return; p.on = true; show(p.x, p.y); try { navigator.vibrate?.(8); } catch { /* rien */ } }, 300);
    press.current = p;
  };
  const move = e => {
    const p = press.current;
    if (!p) return;
    if (p.on) show(e.clientX, e.clientY);
    else if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) { clearTimeout(p.t); press.current = null; }
  };
  const up = (cancel = false) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    clearTimeout(p.t);
    if (!p.on) return;
    const k = lpRef.current?.k;
    lpRef.current = null; setLp(null); skip.current = Date.now();
    if (k && edit && !cancel) tap(k);                       // le systeme qui reprend le doigt n'ouvre rien
  };
  // le doigt leve n'importe ou (hors de la planche, apres un defilement…) referme la loupe : elle restait en l'air
  useEffect(() => {
    if (!lp) return undefined;
    const close = () => { if (press.current?.on) return; lpRef.current = null; setLp(null); };
    const lift = e => { if (press.current?.on && e.type !== "scroll") up(e.type !== "pointerup" && e.type !== "touchend"); else close(); };
    const evs = ["pointerup", "pointercancel", "touchend", "touchcancel"];
    evs.forEach(n => window.addEventListener(n, lift, true));
    window.addEventListener("scroll", close, true);
    return () => { evs.forEach(n => window.removeEventListener(n, lift, true)); window.removeEventListener("scroll", close, true); };
  }, [lp]); // eslint-disable-line react-hooks/exhaustive-deps
  // la loupe ouverte, le doigt ne fait plus defiler la page
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const tm = e => { if (press.current?.on) e.preventDefault(); };
    el.addEventListener("touchmove", tm, { passive: false });
    return () => el.removeEventListener("touchmove", tm);
  }, []);
  const tapK = k => { if (Date.now() - skip.current > 600) tap(k); };
  const Z = 3, LS = 150;
  const lpCell = lp?.k ? board.cells[lp.k] : null, lpF = lpCell?.t === "s" ? byId.get(lpCell.fid) : null;
  const lpTxt = !lp ? "" : lpCell?.t === "d" ? `🏷 ${lpCell.label}` : lpF ? `${fname(lpF)} · ${lpF.fila_type || lpF.material}` : lp.k ? "Case libre" : "";
  return <div ref={wrap} onPointerDown={down} onPointerMove={move} onPointerUp={() => up()} onPointerCancel={() => up(true)} onContextMenu={e => { if (press.current) e.preventDefault(); }}
    style={{ position: "relative", width: "100%", maxWidth: 900, margin: "0 auto", WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}>
  <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", borderRadius: 14, filter: "drop-shadow(0 10px 18px rgba(0,0,0,.35))" }}
    role="img" aria-label={`Planche ${board.name}`}>
    <defs>
      <path id="sw-out" d={GEO.outline}/>
      <g id="sw-shade">{GEO.polys.map((p, i) => <path key={i} d={p.d} fill={p.s > 0 ? "#fff" : "#000"} fillOpacity={Math.abs(p.s) * (p.s > 0 ? 0.6 : 0.65)}/>)}</g>
      <g id="sw-ridge">{GEO.ridges.map((d, i) => <path key={i} d={d} fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth=".4"/>)}</g>
      {/* la soie et le metal : un reflet de plus sur les faces eclairees */}
      <g id="sw-gloss">{GEO.polys.filter(p => p.s > 0.1).map((p, i) => <path key={i} d={p.d} fill="#fff" fillOpacity={p.s * 0.55}/>)}</g>
      {/* le reflet irise des coaxiaux (Neon City…), en biais comme la torsade */}
      <linearGradient id={`swirid-${board.id}`} x1="0" y1="0" x2="1" y2="1">
        {["#ff6ec7", "#7df9ff", "#fff38a", "#b388ff", "#7dffb2"].map((c, i) => <stop key={i} offset={`${i * 25}%`} stopColor={c} stopOpacity=".28"/>)}
      </linearGradient>
      <filter id={`swglow-${board.id}`} x="-60%" y="-40%" width="220%" height="180%"><feGaussianBlur stdDeviation="2.2"/></filter>
      {[...new Set(cells.filter(x => x.f).map(x => fillOf(x.f).fx).filter(Boolean))].map(fx => <FxPattern key={fx} id={`swp-${board.id}-${fx}`} fx={fx}/>)}
      {cells.filter(x => x.f && fillOf(x.f).kind === "grad").map(x => <linearGradient key={x.k} id={`swg-${board.id}-${x.k.replace(":", "-")}`} x1="0" y1="0" x2="1" y2="0">
        {fillOf(x.f).cs.map((col, i, a) => <stop key={i} offset={`${(i / Math.max(1, a.length - 1)) * 100}%`} stopColor={col}/>)}</linearGradient>)}
      <style>{`.sbc .sbhi{opacity:0;transition:opacity .12s}.sbc:hover .sbhi{opacity:1}`}</style>
    </defs>
    <g id={`bc-${board.id}`}>
    {/* la planche et ses trous */}
    <rect x="0" y="0" width={W} height={H} rx="9" fill={board.color}/>
    {holes.map(([x, y]) => <rect key={`${x}:${y}`} x={x - HW / 2} y={y - HH / 2} width={HW} height={HH} rx={HW / 2} fill={hole}/>)}
    <rect x=".4" y=".4" width={W - .8} height={H - .8} rx="8.6" fill="none" stroke={dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.18)"} strokeWidth=".8"/>
    {/* les rails : le fond a peigne, puis les echantillons, puis la barre de devant, puis les etiquettes */}
    {Array.from({ length: board.rows }, (_, r) => { const yb = MT + r * ROW;
      return <g key={`rb${r}`}>
        <text x={EDGE - 16} y={yb + 4} fontSize="4" fontWeight="800" fill={dark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)"} textAnchor="middle">{r + 1}</text>
        {rails.map(rl => { const x0 = cellX(rl.start, rails), x1 = x0 + rl.n * PITCH;
          return <g key={rl.i}>
            {Array.from({ length: rl.n + 1 }, (_, i) => <rect key={i} x={x0 + i * PITCH - .45} y={yb - 4} width=".9" height={BAR + 4} fill={rail}/>)}
          </g>; })}
      </g>; })}
    {cells.map(({ k, cell, x, yb, f }) => {
      const sx = x + (PITCH - SW) / 2, sy = yb + BAR + OVER - SH, dim = dimOf(cell);
      const tip = cell?.t === "d" ? { "data-tip": `Intercalaire « ${cell.label || "sans nom"} »\n${where(k)}` }
        : f ? { "data-tipcard": tipCard(`board:${board.id}:${k}`, () => <SwatchTip f={f} bid={board.id} k={k} where={where(k)} tag={!f.swatch ? "Échantillon pas coché sur sa fiche" : null}/>) }
        : edit ? { "data-tip": `Case libre · ${where(k)}` } : {};
      const fo = f && fillOf(f);
      return <g key={k} data-k={k} className="sbc" onClick={edit ? () => tapK(k) : undefined} style={{ cursor: edit ? "pointer" : "default" }} opacity={dim ? 0.2 : 1} {...tip}>
        <rect x={x + 1} y={yb - SH + 6} width={PITCH - 2} height={SH + 4} rx="2" fill="transparent"/>
        <rect className="sbhi" x={x + 1} y={yb - SH + 6} width={PITCH - 2} height={SH + 4} rx="2" fill={dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)"}/>
        {/* (10/11/2026) un filament sans echantillon (encore a imprimer) : sa place, en pointille fantome a sa couleur ;
            coche « echantillon » sur sa fiche, il s'y dessine en vrai */}
        {cell?.t === "s" && <g transform={`translate(${sx} ${sy})`}>{f && !f.swatch
          ? <use href="#sw-out" fill={fo.cs[0]} fillOpacity=".16" stroke={fo.cs[0]} strokeOpacity=".75" strokeWidth=".7" strokeDasharray="1.6 1.2"/>
          : <SampleArt f={f} fo={fo} bid={board.id} k={k}/>}</g>}
        {cell?.t === "d" && <rect x={x + 4} y={yb - SH * .6} width={PITCH - 8} height={SH * .6 + BAR} rx="1.2" fill="#101010" stroke="#2e2e2e" strokeWidth=".5"/>}
        {holdK === k && <rect x={x + .6} y={yb - SH + 5.5} width={PITCH - 1.2} height={SH + 5} rx="2.5" fill="none" stroke="#F59E0B" strokeWidth="1.4"/>}
      </g>; })}
    {Array.from({ length: board.rows }, (_, r) => { const yb = MT + r * ROW;
      return <g key={`rf${r}`} pointerEvents="none">
        {rails.map(rl => { const x0 = cellX(rl.start, rails), x1 = x0 + rl.n * PITCH;
          return <g key={rl.i}>
            <rect x={x0 - JOIN / 2} y={yb} width={x1 - x0 + JOIN} height={BAR} rx=".8" fill={rail}/>
            <rect x={x0 - JOIN / 2} y={yb} width={x1 - x0 + JOIN} height=".7" fill={railHi}/>
          </g>; })}
        {/* l'embout gauche, les jonctions, l'embout droit : les seules pieces accrochees a la planche */}
        {joints.map((jx, i) => { const end = i === 0 || i === joints.length - 1, w = end ? 12 : 10;
          return <g key={`j${i}`}>
            <rect x={jx - w / 2} y={yb - (end ? 20 : 23)} width={w} height={(end ? 20 : 23) + BAR + 9} rx="2" fill="#111"/>
            <rect x={jx - w / 2 + 1} y={yb - (end ? 19 : 22)} width={w - 2} height="1" rx=".5" fill={railHi}/>
          </g>; })}
      </g>; })}
    {/* les etiquettes des intercalaires, sous le rail, comme les vraies */}
    {cells.filter(x => x.cell?.t === "d" && x.cell.label).map(({ k, cell, x, yb }) => { const w = Math.max(26, cell.label.length * 4.4 + 10);
      return <g key={`l${k}`} pointerEvents="none">
        <rect x={x + 1} y={yb + BAR + 1.5} width={w} height="13" rx="1.4" fill="#0b0b0b" stroke="#e5e5e5" strokeWidth=".6"/>
        <text x={x + 1 + w / 2} y={yb + BAR + 10.9} fontSize="8" fontWeight="800" fill="#fff" textAnchor="middle" fontFamily="system-ui, sans-serif">{cell.label}</text>
      </g>; })}
    </g>
  </svg>
  {lp && createPortal(<div style={{ position: "fixed", zIndex: 10000, pointerEvents: "none", left: Math.max(6, Math.min(window.innerWidth - LS - 6, lp.x - LS / 2)),
      top: Math.max(6, lp.y - LS - 74), display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
    <span style={{ maxWidth: 220, minHeight: 22, padding: "3px 10px", borderRadius: 12, background: lpTxt ? "rgba(15,23,42,.92)" : "transparent", color: "#fff", fontSize: 12,
      fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxSizing: "border-box" }}>{lpTxt}</span>
    <div style={{ width: LS, height: LS, borderRadius: "50%", overflow: "hidden", background: board.color, border: "3px solid #fff", boxShadow: "0 10px 26px rgba(0,0,0,.45)", position: "relative" }}>
      <svg width={LS} height={LS} viewBox={`${lp.ux - LS / lp.sc / Z / 2} ${lp.uy - LS / lp.sc / Z / 2} ${LS / lp.sc / Z} ${LS / lp.sc / Z}`} style={{ display: "block" }}>
        <use href={`#bc-${board.id}`}/></svg>
      <span style={{ position: "absolute", left: "50%", top: "50%", width: 10, height: 10, marginLeft: -5, marginTop: -5, borderRadius: "50%", border: "2px solid #F59E0B" }}/>
    </div>
  </div>, document.body)}
  </div>;
}

// l'echantillon dessine, sur la planche et dans sa fiche au survol : les degrades, motifs et reflets sont ceux que
// definit la planche (la fiche ne s'ouvre que sur elle)
function SampleArt({ f, fo, bid, k }) {
  const board = { id: bid };
  return <>
          {fo?.fx === "glow" && <use href="#sw-out" fill={fo.cs[0]} filter={`url(#swglow-${board.id})`} opacity=".85"/>}
          <use href="#sw-out" fill={!f ? "#94a3b8" : fo.kind === "grad" ? `url(#swg-${board.id}-${k.replace(":", "-")})` : fo.cs[0]}
            fillOpacity={fo?.trans ? 0.7 : 1} stroke="rgba(0,0,0,.35)" strokeWidth=".3"/>
          {fo?.kind === "coax" && GEO.polys.map((p, i) => <path key={i} d={p.d} fill={coaxAt(fo.cs, p.c)} fillOpacity={fo.trans ? 0.7 : 1}/>)}
          {fo?.kind === "coax" && <use href="#sw-out" fill={`url(#swirid-${board.id})`} style={{ mixBlendMode: "screen" }}/>}
          {fo?.fx && (FX_PAT[fo.fx] || ["marble", "wood"].includes(fo.fx)) ? <use href="#sw-out" fill={`url(#swp-${board.id}-${fo.fx})`}/> : null}
          <use href="#sw-shade" opacity={fo?.fx === "matte" || fo?.fx === "carbon" ? 0.55 : fo?.trans ? 0.7 : 1}/>
          {fo?.fx !== "matte" && fo?.fx !== "carbon" && <use href="#sw-ridge"/>}
          {(fo?.fx === "silk" || fo?.fx === "metal") && <use href="#sw-gloss"/>}
  </>;
}

function SwatchTip({ f, where, tag, bid, k }) {
  return <div style={{ display: "flex", gap: 10, alignItems: "flex-start", width: 250, maxWidth: "100%" }}>
    {/* l'echantillon tel que sur la planche (couleur, finition, reflets) ; pas encore place : un apercu a plat */}
    {bid ? <svg viewBox={`-2 -2 ${SW + 4} ${SH + 4}`} width="40" height={Math.round(40 * (SH + 4) / (SW + 4))} style={{ flexShrink: 0 }}>
      <SampleArt f={f} fo={fillOf(f)} bid={bid} k={k}/></svg>
      : <span style={{ width: 46, height: 62, borderRadius: 8, flexShrink: 0, border: "1px solid rgba(255,255,255,.2)", ...swatchBg(f, 46) }}/>}
    <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: "#f8fafc", lineHeight: 1.25 }}>{fname(f)}</div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "#94a3b8" }}>{f.manufacturer} · {f.fila_type || f.material}</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "#e2e8f0" }}>📍 {where}</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: dispo(f) ? "#86efac" : "#fca5a5" }}>
        {f.active_spool_count > 0 ? `🧵 ${f.active_spool_count} bobine${f.active_spool_count > 1 ? "s" : ""} active${f.active_spool_count > 1 ? "s" : ""}`
          : dispo(f) ? `📦 ${(f.ordered_spool_count || 0) + (f.shipping_spool_count || 0)} en commande` : "Plus de bobine active"}</div>
      {tag && <div style={{ fontSize: 11, fontWeight: 800, color: "#fdba74" }}>{tag}</div>}
    </div>
  </div>;
}

// choisir un filament a poser : ceux qui ont un echantillon et ne sont sur aucune planche d'abord
function PickSheet({ filaments, placed, compareHue, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const qq = q.trim().toLowerCase();
  const list = filaments.filter(f => (all || f.swatch) && !placed.has(f.id))
    .filter(f => !qq || `${fname(f)} ${f.name} ${f.manufacturer} ${f.fila_type || ""} ${f.material}`.toLowerCase().includes(qq))
    .sort((a, b) => SECTIONS.indexOf(sectionOf(a)) - SECTIONS.indexOf(sectionOf(b)) || compareHue(a.color || "", b.color || ""));
  return <FSheet onClose={onClose}>
    <div style={{ padding: "18px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>🎨 Poser un échantillon</div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Nom, marque, matière…" autoFocus
        style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 11px", fontSize: 14, color: "var(--text)", outline: "none" }}/>
      <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>
        <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)}/> Aussi les filaments sans échantillon coché</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {list.map(f => <button key={f.id} type="button" onClick={() => onPick(f)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px",
          borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", cursor: "pointer", textAlign: "left", font: "inherit" }}>
          <span style={{ width: 18, height: 24, borderRadius: 4, flexShrink: 0, border: "1px solid rgba(0,0,0,.2)", ...swatchBg(f, 18) }}/>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fname(f)}</span>
            <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{f.manufacturer} · {f.fila_type || f.material} · {sectionOf(f)}</span>
          </span>
        </button>)}
        {!list.length && <div style={{ fontSize: 13, color: "var(--muted)", padding: 8 }}>Rien à poser : tous les échantillons sont rangés.</div>}
      </div>
    </div>
  </FSheet>;
}

function LabelSheet({ init = "", labels = SECTIONS, onPick, onClose }) {
  const [v, setV] = useState(init);
  return <FSheet onClose={onClose}>
    <div style={{ padding: "18px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>🏷 Intercalaire</div>
      <input value={v} onChange={e => setV(e.target.value)} placeholder="PLA Basic" autoFocus maxLength={40}
        onKeyDown={e => { if (e.key === "Enter" && v.trim()) onPick(v.trim()); }}
        style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 11px", fontSize: 14, color: "var(--text)", outline: "none" }}/>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {labels.map(s => <button key={s} type="button" onClick={() => setV(s)} style={{ padding: "4px 10px", borderRadius: 14, border: "1px solid var(--border)",
          background: v === s ? "#14B8A6" : "var(--surface2)", color: v === s ? "#fff" : "var(--text2)", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>{s}</button>)}
      </div>
      <button type="button" disabled={!v.trim()} onClick={() => onPick(v.trim())} style={{ height: 40, borderRadius: 12, border: "none", cursor: "pointer",
        background: "#14B8A6", color: "#fff", fontSize: 14, fontWeight: 900, opacity: v.trim() ? 1 : .5 }}>Poser</button>
    </div>
  </FSheet>;
}

function BoardSettings({ board, types, onSave, onDelete, onClose }) {
  const [b, setB] = useState(board);
  const secs = b.sections?.length ? b.sections : defaultSections(types.map(x => x.t));
  const setSecs = v => setB(x => ({ ...x, sections: v }));
  const usedT = new Set(secs.flatMap(s => s.types)), freeT = types.filter(x => !usedT.has(x.t));
  const upd = (i, p) => setSecs(secs.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const mv = (i, d) => { const n = [...secs], j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setSecs(n); };
  const sBtn = { width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)", cursor: "pointer", fontSize: 12, flexShrink: 0 };
  const set = (k, v) => setB(x => ({ ...x, [k]: v }));
  const pickModel = id => { const m = BOARD_MODELS.find(x => x.id === id); setB(x => ({ ...x, model: id, ...(m?.rows ? { rows: m.rows, cols: m.cols, rails: m.rails } : {}) })); };
  const num = (k, min, max) => <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, fontWeight: 800, color: "var(--muted)", flex: "1 1 90px" }}>
    {{ rows: "Lignes", cols: "Cases par ligne", rails: "Rails par ligne", margin: "Marge : au moins (cases)", marginPct: "Marge : en % de la section" }[k]}
    <input type="number" min={min} max={max} value={k === "margin" ? marginOf(b).min : k === "marginPct" ? marginOf(b).pct : b[k]} onChange={e => set(k, Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
      style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px", fontSize: 14, color: "var(--text)", outline: "none" }}/></label>;
  const lost = Object.keys(board.cells).filter(k => { const [r, c] = k.split(":").map(Number); return r >= b.rows || c >= b.cols; }).length;
  return <FSheet onClose={onClose} bottom={<>
      <button type="button" onClick={onDelete} style={{ height: 40, padding: "0 14px", borderRadius: 12, border: "1px solid #FCA5A5", background: "transparent", color: "#DC2626", fontWeight: 800, cursor: "pointer" }}>Supprimer</button>
      <button type="button" onClick={() => onSave(b)} style={{ flex: 1, height: 40, borderRadius: 12, border: "none", background: "#14B8A6", color: "#fff", fontWeight: 900, cursor: "pointer" }}>Enregistrer</button></>}>
    <div style={{ padding: "18px 16px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>⚙ La planche</div>
      <input value={b.name} onChange={e => set("name", e.target.value)} maxLength={40} placeholder="Nom"
        style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 11px", fontSize: 14, color: "var(--text)", outline: "none" }}/>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>Le modèle</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {BOARD_MODELS.map(m => <button key={m.id} type="button" onClick={() => pickModel(m.id)} style={{ padding: "6px 11px", borderRadius: 12, cursor: "pointer",
          border: `1px solid ${b.model === m.id ? "#14B8A6" : "var(--border)"}`, background: b.model === m.id ? "color-mix(in srgb, #14B8A6 15%, var(--surface2))" : "var(--surface2)",
          color: "var(--text2)", fontSize: 12.5, fontWeight: 800 }}>{m.l}</button>)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{num("rows", 1, 60)}{num("cols", 1, 80)}{num("rails", 1, b.cols)}</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45 }}>
        Un modèle propose un découpage ; ajuste les lignes et les cases à tes rails (un intercalaire prend une case).</div>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>Le rangement automatique</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{num("margin", 0, 20)}{num("marginPct", 0, 100)}</div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: "var(--text2)", cursor: "pointer" }}>
        <input type="checkbox" checked={marginOf(b).spread} onChange={e => set("fill", e.target.checked)}/>
        Répartir les cases en trop dans les marges (sinon, elles restent libres à la fin de la planche)</label>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45 }}>
        Après chaque section, la plus grande des deux marges, plus une case par filament qui attend encore son échantillon.</div>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>Les sections, dans l'ordre</div>
      {secs.map((s, i) => <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 9px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface2)" }}>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input value={s.label} onChange={e => upd(i, { label: e.target.value })} maxLength={40} style={{ flex: 1, minWidth: 0, background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "5px 8px", fontSize: 13, fontWeight: 800, color: "var(--text)", outline: "none" }}/>
          <label data-tip="Cases libres entre ses sous-types (0 : tous mêlés, par teinte)" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 800, color: "var(--muted)" }}>écart
            <input type="number" min="0" max="10" value={s.gap || 0} onChange={e => upd(i, { gap: Math.max(0, Math.min(10, parseInt(e.target.value) || 0)) })}
              style={{ width: 42, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 5px", fontSize: 12.5, color: "var(--text)" }}/></label>
          <label data-tip="Chaque bloc coupé par marque, dans l'ordre alphabétique (avec l'écart entre elles)" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={!!s.brand} onChange={e => upd(i, { brand: e.target.checked })}/>marques</label>
          <button type="button" onClick={() => mv(i, -1)} style={sBtn} aria-label="Monter">▲</button>
          <button type="button" onClick={() => mv(i, 1)} style={sBtn} aria-label="Descendre">▼</button>
          <button type="button" onClick={() => setSecs(secs.filter((_, j) => j !== i))} style={{ ...sBtn, color: "#DC2626" }} aria-label="Retirer la section">✕</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          {blocksOf(s).flatMap(bl => bl).map(t => { const w = rootOf(s, t) !== t ? rootOf(s, t) : null;
            return <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 4px 2px 8px", borderRadius: 10, fontSize: 11.5, fontWeight: 700,
            background: w ? "color-mix(in srgb, #6366F1 15%, var(--surface))" : "color-mix(in srgb, #14B8A6 13%, var(--surface))", color: "var(--text2)" }}>
            <button type="button" data-tip={w ? `Avec ${w} : un seul bloc, sans écart. Touche pour changer` : "Touche pour le mettre avec un autre sous-type (un seul bloc, sans écart)"}
              onClick={async () => { const v = await showChoice(`${t} : avec quel sous-type ?`, [{ value: "-", label: "Seul", icon: "▫" },
                ...s.types.filter(u => u !== t && rootOf(s, u) === u).map(u => ({ value: u, label: u, icon: "🔗" }))]);
                if (!v) return; const nw = { ...(s.with || {}) }; if (v === "-") delete nw[t]; else { nw[t] = v; Object.keys(nw).forEach(x => { if (nw[x] === t) nw[x] = v; }); }
                upd(i, { with: nw }); }}
              style={{ border: "none", background: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}>{w ? "🔗 " : ""}{t}</button>
            <button type="button" onClick={() => upd(i, { types: s.types.filter(x => x !== t) })} aria-label={`Retirer ${t}`}
              style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", fontSize: 11, padding: "0 3px" }}>✕</button></span>; })}
          {freeT.length > 0 && <select value="" onChange={e => e.target.value && upd(i, { types: [...s.types, e.target.value] })}
            style={{ fontSize: 11.5, padding: "3px 4px", borderRadius: 8, border: "1px dashed var(--border)", background: "var(--surface)", color: "var(--muted)" }}>
            <option value="">＋ sous-type</option>{freeT.map(x => <option key={x.t} value={x.t}>{x.t} ({x.n})</option>)}</select>}
          {!s.types.length && !freeT.length && <span style={{ fontSize: 11, color: "var(--muted)" }}>Aucun sous-type libre : retire-en un d'une autre section.</span>}
        </div>
      </div>)}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setSecs([...secs, { label: "Nouvelle section", types: [], gap: 0 }])} style={{ ...sBtn, width: "auto", padding: "0 10px", fontWeight: 800, color: "#14B8A6" }}>＋ Section</button>
        <button type="button" onClick={() => setSecs(defaultSections(types.map(x => x.t)))} style={{ ...sBtn, width: "auto", padding: "0 10px", fontWeight: 800 }}>↺ D'après mes filaments</button>
      </div>
      {freeT.length > 0 && <div style={{ fontSize: 11.5, fontWeight: 700, color: "#B45309" }}>Dans aucune section (rangés dans « Autres ») : {freeT.map(x => x.t).join(", ")}</div>}
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45 }}>
        « Indispo » (les filaments sans bobine active) vient toujours en dernier. L'écart met des cases libres entre les sous-types d'une même section (PLA Effets : Sparkle, Glow, Marble…) ;
        toucher un sous-type le met <b>avec</b> un autre (🔗 : un seul bloc, sans écart, Marble et High Speed Marble), « marques » coupe chaque bloc par marque.</div>
      {lost > 0 && <div style={{ fontSize: 12, fontWeight: 800, color: "#DC2626" }}>⚠ {lost} case{lost > 1 ? "s" : ""} occupée{lost > 1 ? "s" : ""} sortent de la planche : elles seront retirées.</div>}
      <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>La couleur</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {BOARD_COLORS.map(([l, c]) => <button key={c} type="button" onClick={() => set("color", c)} data-tip={l} aria-label={l}
          style={{ width: 30, height: 30, borderRadius: 9, cursor: "pointer", background: c, border: b.color === c ? "3px solid #14B8A6" : "1px solid var(--border)" }}/>)}
        <label data-tip="Une autre couleur" style={{ position: "relative", width: 30, height: 30, borderRadius: 9, border: "1px dashed var(--border)", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, cursor: "pointer" }}>🎨
          <input type="color" value={b.color} onChange={e => set("color", e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}/></label>
      </div>
    </div>
  </FSheet>;
}

export default function SwatchBoard({ filaments, visible, compareHue }) {
  const admin = useIsAdmin(), friend = useFriend(st => st.friend);
  const edit = admin && !friend;
  const [boards, setBoards] = useState(null);
  const [cur, setCur] = useState(null);
  const [hold, setHold] = useState(null);           // { cell, from: {bid, k} | null } : ce qu'on deplace ou pose
  const [pick, setPick] = useState(null);           // { bid, k } : la case ou poser un echantillon
  const [lab, setLab] = useState(null);             // { bid, k, init } : l'intercalaire a nommer
  const [cfg, setCfg] = useState(null);
  const [prop, setProp] = useState(null);           // { bid, cells } : le rangement automatique propose, pas encore garde
  const [busy, setBusy] = useState(false);
  // les filaments sans echantillon « ignores » dans les points d'attention (10/11/2026) : pas de place fantome pour eux,
  // seuls ceux encore a faire en ont une
  const [ign, setIgn] = useState(() => new Set());
  useEffect(() => { client.get("/attention/dismissed").then(({ data }) => setIgn(new Set((data?.dismissed || [])
    .filter(d => d.category === "fil_no_swatch" && !d.expired && d.entity_id != null).map(d => d.entity_id)))).catch(() => {}); }, [friend]);
  useEffect(() => { client.get("/filaments/boards").then(r => { setBoards(r.data.boards || []); setCur(c => c || r.data.boards?.[0]?.id || null); }).catch(() => setBoards([])); }, [friend]);

  const byId = useMemo(() => new Map(filaments.map(f => [f.id, f])), [filaments]);
  const vis = useMemo(() => new Set((visible || filaments).map(f => f.id)), [visible, filaments]);
  const filtered = vis.size < filaments.length;
  const placed = useMemo(() => { const m = new Map();
    for (const b of boards || []) for (const [k, c] of Object.entries(b.cells)) if (c.t === "s") m.set(c.fid, { b, k }); return m; }, [boards]);
  const board = (boards || []).find(b => b.id === cur) || boards?.[0];
  const unplaced = filaments.filter(f => f.swatch && !placed.has(f.id));
  const waiting = filaments.filter(f => !f.swatch && dispo(f) && !ign.has(f.id) && !placed.has(f.id)).length;   // sans echantillon ni place fantome

  const save = async next => {
    const prev = boards;
    setBoards(next);
    try { const r = await client.put("/filaments/boards", { boards: next }); setBoards(r.data.boards); egg("planche_nuancier"); }
    catch { setBoards(prev); showAlert("Enregistrement impossible"); }
  };
  const setCells = (bid, fn) => save(boards.map(b => b.id === bid ? { ...b, cells: fn({ ...b.cells }) } : b));
  const where = (b, k) => { const [r, c] = k.split(":").map(Number); return `${b.name} · ligne ${r + 1} · case ${c + 1}`; };

  // poser ce qu'on tient : dans une case libre, ou a la place de ce qui y est (qui part la d'ou on venait)
  // (10/11/2026) deplacer une case et tout ce qui la suit sans trou (un bloc), d'un coup : les cases d'arrivee doivent
  // etre libres (ou liberees par le bloc lui-meme)
  const blockOf = (b, k) => { const W = b.cols, cap = b.rows * W, [r, c] = k.split(":").map(Number), out = [];
    for (let i = r * W + c; i < cap && b.cells[key(Math.floor(i / W), i % W)]; i++) out.push(key(Math.floor(i / W), i % W));
    return out; };
  const dropBlock = (bid, k) => {
    const h = hold; setHold(null);
    const next = boards.map(b => ({ ...b, cells: { ...b.cells } }));
    const fb = next.find(b => b.id === h.from.bid), tb = next.find(b => b.id === bid);
    const cells = h.block.map(x => fb.cells[x]);
    h.block.forEach(x => { delete fb.cells[x]; });
    const W = tb.cols, [r, c] = k.split(":").map(Number), p = r * W + c;
    const dest = cells.map((_, i) => key(Math.floor((p + i) / W), (p + i) % W));
    if (p + cells.length > tb.rows * W || dest.some(x => tb.cells[x])) {
      showAlert(`Pas la place : il faut ${cells.length} cases libres à la suite à partir de là.`); return; }
    dest.forEach((x, i) => { tb.cells[x] = cells[i]; });
    save(next);
  };
  const drop = (bid, k) => {
    if (hold.block) { dropBlock(bid, k); return; }
    const h = hold; setHold(null);
    const next = boards.map(b => ({ ...b, cells: { ...b.cells } }));
    const tb = next.find(b => b.id === bid), old = tb.cells[k];
    if (h.from) { const fb = next.find(b => b.id === h.from.bid); delete fb.cells[h.from.k]; if (old) fb.cells[h.from.k] = old; }
    tb.cells[k] = h.cell;
    save(next);
  };
  // decaler (10/11/2026) : cette case et tout ce qui la suit, dans l'ordre de lecture (une ligne continue sur la
  // suivante), avancent ou reculent de n cases : la place d'un echantillon oublie, sans tout redeplacer a la main
  const shiftFrom = async (bid, k) => {
    const bb = boards.find(x => x.id === bid), toNext = bb.cols - Number(k.split(":")[1]);
    const n = await showChoice(`Décaler à partir de ${where(bb, k)}`, [
      ...(Number(k.split(":")[1]) > 0 ? [{ value: toNext, label: "↵ Au début de la ligne suivante", icon: "↵", hint: `${toNext} case${toNext > 1 ? "s" : ""} plus loin` }] : []),
      ...[1, 2, 3, 5].map(x => ({ value: x, label: `→ ${x} case${x > 1 ? "s" : ""} plus loin`, icon: "⇥" })),
      ...[1, 2, 3].map(x => ({ value: -x, label: `← ${x} case${x > 1 ? "s" : ""} plus tôt`, icon: "⇤" }))]);
    if (!n) return;
    const b = boards.find(x => x.id === bid), W = b.cols, cap = b.rows * W;
    const [r0, c0] = k.split(":").map(Number), p0 = r0 * W + c0;
    const ent = Object.entries(b.cells).map(([kk, v]) => { const [r, c] = kk.split(":").map(Number); return [r * W + c, v]; });
    const mv = ent.filter(([i]) => i >= p0), stay = ent.filter(([i]) => i < p0);
    if (n > 0 && mv.some(([i]) => i + n >= cap)) { showAlert(`Pas la place : la fin de la planche n'a pas ${n} case${n > 1 ? "s" : ""} libre${n > 1 ? "s" : ""}.`); return; }
    if (n < 0 && (p0 + n < 0 || stay.some(([i]) => i >= p0 + n))) { showAlert(`Les ${-n} case${n < -1 ? "s" : ""} d'avant ne sont pas libres.`); return; }
    const cells = {};
    for (const [i, v] of stay) cells[key(Math.floor(i / W), i % W)] = v;
    for (const [i, v] of mv) { const j = i + n; cells[key(Math.floor(j / W), j % W)] = v; }
    save(boards.map(x => (x.id === bid ? { ...x, cells } : x)));
  };
  const tap = async (bid, k) => {
    if (!edit) return;
    if (hold) { if (!(hold.from && hold.from.bid === bid && hold.from.k === k)) drop(bid, k); else setHold(null); return; }
    const b = boards.find(x => x.id === bid), c = b.cells[k];
    if (!c) {
      const v = await showChoice(`Case libre · ${where(b, k)}`, [{ value: "s", label: "Un échantillon", icon: "🎨" }, { value: "d", label: "Un intercalaire", icon: "🏷" },
        { value: "shift", label: "Décaler d'ici", icon: "⇥", hint: "Tout ce qui suit cette case avance ou recule" }]);
      if (v === "s") setPick({ bid, k }); else if (v === "d") setLab({ bid, k, init: "" }); else if (v === "shift") shiftFrom(bid, k);
      return;
    }
    const f = c.t === "s" ? byId.get(c.fid) : null;
    const v = await showChoice(c.t === "d" ? `Intercalaire « ${c.label} »` : f ? fname(f) : "Échantillon", [
      { value: "move", label: "Déplacer", icon: "↔", hint: "Puis touche la case où le poser" },
      ...(blockOf(b, k).length > 1 ? [{ value: "moveb", label: `Déplacer avec la suite (${blockOf(b, k).length} cases)`, icon: "⇉",
        hint: "Elle et tout ce qui la suit sans trou ; puis touche la case où poser le début" }] : []),
      c.t === "d" ? { value: "rename", label: "Renommer", icon: "✏" } : { value: "swap", label: "Remplacer", icon: "🔁" },
      { value: "shift", label: "Décaler d'ici", icon: "⇥", hint: "Cette case et tout ce qui suit avancent ou reculent" },
      { value: "del", label: "Retirer", icon: "✕", tone: "danger" }]);
    if (v === "shift") shiftFrom(bid, k);
    else if (v === "moveb") setHold({ cell: c, from: { bid, k }, block: blockOf(b, k) });
    else if (v === "move") setHold({ cell: c, from: { bid, k } });
    else if (v === "rename") setLab({ bid, k, init: c.label });
    else if (v === "swap") setPick({ bid, k });
    else if (v === "del") setCells(bid, cs => { delete cs[k]; return cs; });
  };

  // les sous-types des filaments, les plus nombreux d'abord : ce que les sections se partagent
  const types = useMemo(() => { const m = {}; filaments.forEach(f => { const t = typeOf(f); m[t] = (m[t] || 0) + 1; });
    return Object.entries(m).map(([t, n]) => ({ t, n })).sort((a, b) => b.n - a.n || a.t.localeCompare(b.t)); }, [filaments]);
  const addBoard = () => { const nb = newBoard((boards?.length || 0) + 1); save([...(boards || []), nb]); setCur(nb.id); setCfg(nb); };
  const auto = async () => {
    const others = new Set([...placed.entries()].filter(([, p]) => p.b.id !== board.id).map(([fid]) => fid));
    // (10/11/2026) aussi les echantillons encore a faire : sans echantillon mais avec une bobine active, et pas ignores
    // dans les points d'attention ; leur place est gardee, en fantome
    const mine = filaments.filter(f => (f.swatch || (dispo(f) && !ign.has(f.id))) && !others.has(f.id));
    if (!mine.length) { showAlert("Aucun échantillon à ranger sur cette planche."); return; }
    const secs = sectionsOf(board, filaments), hue = (a, b) => compareHue(a.color || "", b.color || "");
    const groups = [...new Set([...secs.map(s => s.label), "Autres", "Indispo"])].map(label => {
      const sec = secs.find(s => s.label === label), items = mine.filter(f => sectionIn(f, secs) === label);
      // une section a ecart : ses sous-types dans leur ordre, chacun par teinte ; sinon tout par teinte
      let parts = sec && (sec.gap > 0 || sec.brand) ? blocksOf(sec).map(bl => items.filter(f => bl.includes(typeOf(f)))) : [items];
      if (sec?.brand) parts = parts.flatMap(p => { const by = {}; p.forEach(f => { (by[f.manufacturer || "?"] ||= []).push(f); });
        return Object.keys(by).sort((a, b) => a.localeCompare(b)).map(m => by[m]); });
      parts = parts.map(p => p.sort(hue)).filter(p => p.length);
      const mg = marginOf(board);
      return { label, items: parts.flat(), parts, gap: sec?.gap || 0, margin: Math.max(mg.min, Math.ceil(items.length * mg.pct / 100)) };
    }).filter(g => g.items.length);
    setBusy(true);
    const cells = pack(board, groups);
    setBusy(false);
    if (!cells) { const need = groups.reduce((a, g) => a + 1 + g.items.length + g.margin, 0);
      showAlert(`Ça ne tient pas : il faut environ ${need} cases, la planche en a ${board.rows * board.cols}. Agrandis-la ou ajoute une planche.`); return; }
    setHold(null); setProp({ bid: board.id, cells });
  };
  const keepProp = () => { save(boards.map(b => b.id === prop.bid ? { ...b, cells: prop.cells } : b)); setProp(null); };
  const printDividers = async () => {
    const n = {};
    for (const c of Object.values(board.cells)) if (c.t === "d" && c.label) n[c.label] = (n[c.label] || 0) + 1;
    const items = Object.entries(n).map(([text, k]) => ({ text, n: k, bg: "#111111", fg: "#ffffff" }));
    if (!items.length) { showAlert("Pas d'intercalaire sur cette planche."); return; }
    try {
      const r = await client.post("/filaments/labels/custom", { items, skip: 0 }, { responseType: "blob" });
      const blob = new Blob([r.data], { type: "application/pdf" }), fileName = "intercalaires.pdf";
      if (window.BambuScan?.savePdf) {
        const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = rej; fr.readAsDataURL(blob); });
        window.BambuScan.savePdf(b64, fileName);
      } else {
        const url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = fileName; a.dispatchEvent(new MouseEvent("click")); setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch { showAlert("Génération impossible"); }
  };

  if (!boards) return <div style={{ padding: 20, color: "var(--muted)", fontSize: 13 }}>Chargement…</div>;
  const pill = (txt, onClick, tip, c = "var(--text2)") => <button type="button" onClick={onClick} data-tip={tip} disabled={busy}
    style={{ height: 32, padding: "0 12px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface2)", color: c, fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>{txt}</button>;

  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    {/* les planches, puis ce qu'on peut faire de celle qui est montree */}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {boards.map(b => <button key={b.id} type="button" onClick={() => setCur(b.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px",
        borderRadius: 16, cursor: "pointer", fontSize: 12.5, fontWeight: 800, border: `1px solid ${board?.id === b.id ? "#14B8A6" : "var(--border)"}`,
        background: board?.id === b.id ? "color-mix(in srgb, #14B8A6 14%, var(--surface2))" : "var(--surface2)", color: "var(--text)" }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: b.color, border: "1px solid var(--border)" }}/>{b.name}</button>)}
      {edit && pill("＋ Planche", addBoard, "Ajouter une planche (une autre SKÅDIS, un autre mur…)", "#14B8A6")}
    </div>
    {!board && <div style={{ padding: 18, borderRadius: 14, border: "1px dashed var(--border)", color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
      Pas encore de planche. {edit ? "« ＋ Planche » en crée une : choisis son modèle, ses lignes, ses cases et sa couleur, puis pose tes échantillons et tes intercalaires." : ""}</div>}
    {board && <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {edit && pill("⚙ Réglages", () => setCfg(board), "Modèle, lignes, cases, rails et couleur")}
        {edit && pill("✨ Ranger automatiquement", auto, "Par sous-type, trié par teinte, une marge au bout de chaque section", "#7C3AED")}
        {pill("🏷 Imprimer les intercalaires", printDividers, "Les étiquettes des intercalaires de cette planche, au format 20 × 10 mm")}
        <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
          {Object.values(board.cells).filter(c => c.t === "s").length} échantillons · {board.rows * board.cols - Object.keys(board.cells).length} cases libres</span>
      </div>
      {hold && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 12, background: "color-mix(in srgb, #F59E0B 14%, var(--surface2))",
        border: "1px solid color-mix(in srgb, #F59E0B 45%, var(--border))", fontSize: 12.5, fontWeight: 800, color: "var(--text)" }}>
        {hold.block ? <>⇉ Touche la case où poser le début du bloc ({hold.block.length} cases, il faut autant de cases libres à la suite)</>
          : <>↔ Touche la case où poser {hold.cell.t === "d" ? `l'intercalaire « ${hold.cell.label} »` : fname(byId.get(hold.cell.fid) || { name: "l'échantillon" })}
        {hold.from ? " (une case occupée échange avec lui)" : ""}</>}
        <button type="button" onClick={() => setHold(null)} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--muted)", fontWeight: 900, cursor: "pointer" }}>Annuler</button></div>}
      {prop?.bid === board.id && <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", borderRadius: 12,
        background: "color-mix(in srgb, #7C3AED 13%, var(--surface2))", border: "1px solid color-mix(in srgb, #7C3AED 45%, var(--border))", fontSize: 12.5, fontWeight: 800, color: "var(--text)" }}>
        ✨ Proposition de rangement : rien n'est encore changé
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" onClick={() => setProp(null)} style={{ height: 30, padding: "0 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)", fontWeight: 800, cursor: "pointer" }}>Annuler</button>
          <button type="button" onClick={keepProp} style={{ height: 30, padding: "0 14px", borderRadius: 10, border: "none", background: "#7C3AED", color: "#fff", fontWeight: 900, cursor: "pointer" }}>Garder</button>
        </span></div>}
      {/* la planche dessinee (ou la proposition du rangement automatique, qu'on regarde avant de la garder) */}
      <BoardSVG board={prop?.bid === board.id ? { ...board, cells: prop.cells } : board} byId={byId} edit={edit && prop?.bid !== board.id} tap={k => tap(board.id, k)} where={k => where(board, k)}
        dimOf={c => filtered && (c?.t !== "s" || !vis.has(c.fid))} holdK={hold?.from?.bid === board.id ? hold.from.k : null}/>
    </>}
    {/* ce qui n'est nulle part : un toucher le prend en main, la case touchee ensuite le recoit */}
    {(unplaced.length > 0 || waiting > 0) && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#14B8A6" }}>
        {unplaced.length} échantillon{unplaced.length > 1 ? "s" : ""} à placer{waiting ? ` · ${waiting} filament${waiting > 1 ? "s" : ""} sans échantillon` : ""}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {unplaced.sort((a, b) => SECTIONS.indexOf(sectionOf(a)) - SECTIONS.indexOf(sectionOf(b)) || compareHue(a.color || "", b.color || "")).map(f =>
          <button key={f.id} type="button" onClick={edit && board ? () => setHold({ cell: { t: "s", fid: f.id }, from: null }) : undefined}
            data-tipcard={tipCard(`board:un:${f.id}`, () => <SwatchTip f={f} where={`pas encore placé · ${sectionOf(f)}`}/>)}
            style={{ width: 20, height: 27, borderRadius: 4, padding: 0, cursor: edit ? "pointer" : "default", border: "1px solid var(--border)",
              outline: hold?.cell.fid === f.id && !hold.from ? "2px solid #F59E0B" : "none", outlineOffset: 1, opacity: filtered && !vis.has(f.id) ? .2 : 1, ...swatchBg(f, 20) }}/>)}
      </div>
    </div>}
    {pick && <PickSheet filaments={filaments} placed={placed} compareHue={compareHue} onClose={() => setPick(null)}
      onPick={f => { const p = pick; setPick(null); setCells(p.bid, cs => { cs[p.k] = { t: "s", fid: f.id }; return cs; }); }}/>}
    {lab && <LabelSheet init={lab.init} labels={[...sectionsOf(boards.find(b => b.id === lab.bid) || {}, filaments).map(s => s.label), "Indispo"]} onClose={() => setLab(null)}
      onPick={label => { const l = lab; setLab(null); setCells(l.bid, cs => { cs[l.k] = { t: "d", label }; return cs; }); }}/>}
    {cfg && <BoardSettings board={cfg} types={types} onClose={() => setCfg(null)}
      onSave={b => { setCfg(null); const cells = Object.fromEntries(Object.entries(b.cells).filter(([k]) => { const [r, c] = k.split(":").map(Number); return r < b.rows && c < b.cols; }));
        save(boards.map(x => x.id === b.id ? { ...b, cells, rails: Math.min(b.rails, b.cols) } : x)); }}
      onDelete={async () => { if (!(await showConfirm(`Supprimer « ${cfg.name} » ? Ses échantillons repartent dans « à placer ».`))) return;
        const id = cfg.id; setCfg(null); const next = boards.filter(x => x.id !== id); save(next); setCur(next[0]?.id || null); }}/>}
  </div>;
}
