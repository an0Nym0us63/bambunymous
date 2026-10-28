import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import { useCanMw } from "../store/auth";
import { useNavigate } from "react-router-dom";
import { colorBg, parseColorsList, finishOf } from "../utils/colors";

// Filaments d'un profil MakerWorld face au stock : pour chacun, le filament
// en stock de la meme matiere dont la couleur s'en approche le plus (ecart
// percu, CIEDE2000), et ce qu'il en reste. Toucher la ligne montre les autres
// propositions ; toucher une proposition ouvre le filament.
const LEVEL = {
  "identique":   { c: "#22c55e", t: "identique" },
  "très proche": { c: "#22c55e", t: "très proche" },
  "proche":      { c: "#84cc16", t: "proche" },
  "approchant":  { c: "#f59e0b", t: "approchant" },
  "différent":   { c: "#ef4444", t: "couleur différente" },
};

export function stockSummary(items) {
  if (!items?.length) return null;
  const ok = items.filter(x => x.matches[0] && ["identique", "très proche", "proche"].includes(x.matches[0].level)).length;
  return `🧵 ${items.length} filament${items.length > 1 ? "s" : ""} · ${ok === items.length ? "tous en stock"
    : ok ? `${ok} en stock` : "rien d'approchant en stock"}`;
}

const fkey = (type, color) => `${String(type || "").toUpperCase()}|${String(color || "").toUpperCase()}`;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Filament retenu pour une ligne : la proposition choisie a la main (gardee
// le temps de la session, par profil et par ligne), sinon la meilleure.
const PICKS = new Map();      // `${scope}|${i}` -> filament_id
// Filament trouve par la recherche dans tout le stock (hors propositions) : `${scope}|${i}` -> proposition.
const EXTRA = new Map();
// Exceptions par plateau : `${scope}|${plateau}|${i}` -> proposition (ce plateau dans une autre couleur).
const PLATE = new Map();
// Qui veut savoir quand un choix change (les vignettes repeintes de la fiche).
const WATCH = new Set();
const changed = () => WATCH.forEach(f => { try { f(); } catch { /* rien */ } });
export function usePicksVersion() {
  const [v, setV] = useState(0);
  useEffect(() => { const f = () => setV(n => n + 1); WATCH.add(f); return () => { WATCH.delete(f); }; }, []);
  return v;
}
const inLists = (x, id) => x.matches.some(m => m.filament_id === id) || (x.others || []).some(m => m.filament_id === id);
// Plan retenu pour « À faire » : cle « TYPE|#COULEUR » -> filament choisi a la main.
// Un choix fait par recherche est relu dans le stock (promesse resolue une fois tout pret).
export function setPicksFromPlan(scope, items, picks, platePicks) {
  const asks = [];
  // exceptions par plateau : relues dans les propositions, sinon dans tout le stock
  Object.entries(platePicks || {}).forEach(([pn, pk]) => (items || []).forEach((x, i) => {
    const id = pk?.[fkey(x.type, x.color)];
    if (!id) return;
    const mt = x.matches.find(m => m.filament_id === id) || (x.others || []).find(m => m.filament_id === id);
    if (mt) { PLATE.set(`${scope}|${pn}|${i}`, mt); return; }
    asks.push(client.get("/makerworld/stock/search", { params: { type: x.type, color: x.color, ids: String(id) } })
      .then(({ data }) => { if (data.items?.[0]) PLATE.set(`${scope}|${pn}|${i}`, data.items[0]); }).catch(() => {}));
  }));
  (items || []).forEach((x, i) => {
    const id = picks?.[fkey(x.type, x.color)];
    if (!id) return;
    PICKS.set(`${scope}|${i}`, id);
    if (!inLists(x, id)) asks.push(client.get("/makerworld/stock/search", { params: { type: x.type, color: x.color, ids: String(id) } })
      .then(({ data }) => { if (data.items?.[0]) EXTRA.set(`${scope}|${i}`, data.items[0]); }).catch(() => {}));
  });
  changed();
  return Promise.all(asks).then(r => { changed(); return r; });
}
// Oublier les choix faits a la main pour un profil (plan retenu annule) : retour aux propositions.
export function clearPicks(scope) {
  for (const m of [PICKS, EXTRA, PLATE]) for (const k of [...m.keys()]) if (k.startsWith(`${scope}|`)) m.delete(k);
  changed();
}

// Couleurs d'un plateau : pour chacun de ses filaments, couleur d'origine (3MF) ->
// couleur du filament retenu dans le stock. [{ from, to }], une ligne par couleur d'origine.
export function plateColorMap(items, plate, scope = "") {
  const out = [], seen = new Set();
  for (const f of (plate?.filaments || []).filter(x => num(x.g) > 0)) {
    const i = (items || []).findIndex(x => fkey(x.type, x.color) === fkey(f.type, f.color));
    const c = i >= 0 ? chosenOf(items[i], scope, i, plate.index) : null;
    const from = String(f.color || "").toUpperCase();
    if (!c?.color || !from || seen.has(from)) continue;
    seen.add(from);
    out.push({ from, to: String(c.color) });
  }
  return out;
}
// Pour la vue 3D : { couleur du createur RRGGBB : couleur du filament choisi } (plate : avec les choix de ce plateau).
export function profilePalette(items, scope, plate = null) {
  const out = {};
  (items || []).forEach((x, i) => {
    const c = chosenOf(x, scope, i, plate);
    const from = String(x.color || "").replace(/^#/, "").slice(0, 6).toUpperCase();
    const to = String(c?.color || "").replace(/^#/, "").slice(0, 6).toUpperCase();
    if (from.length === 6 && to.length === 6 && !(from in out)) out[from] = to;
  });
  return Object.keys(out).length ? out : null;
}
// Pour la vue 3D : { couleur du createur RRGGBB : finition du filament choisi } (silk, metal, translucide…).
export function profileFinishes(items, scope) {
  const out = {};
  (items || []).forEach((x, i) => {
    const c = chosenOf(x, scope, i);
    const from = String(x.color || "").replace(/^#/, "").slice(0, 6).toUpperCase();
    const f = c ? (/^#?[0-9a-f]{6}(?!ff)[0-9a-f]{2}$/i.test(String(c.color || "")) ? "translucent" : finishOf(c)) : null;
    if (from.length === 6 && f && !(from in out)) out[from] = f;
  });
  return out;
}
// le multicolore (degrade, coaxial) des filaments choisis : {couleur du createur : {type, colors}} pour la vue 3D
export function profileMulti(items, scope) {
  const out = {};
  (items || []).forEach((x, i) => {
    const c = chosenOf(x, scope, i);
    const from = String(x.color || "").replace(/^#/, "").slice(0, 6).toUpperCase();
    const t = c?.multicolor_type;
    const cols = String(c?.colors_array || "").split(",").map(v => v.replace(/^#/, "").slice(0, 6).toUpperCase()).filter(v => v.length === 6);
    if (from.length === 6 && (t === "gradient" || t === "coaxial") && cols.length >= 2 && !(from in out)) out[from] = { type: t, colors: cols.slice(0, 3) };
  });
  return out;
}
export function picksOf(scope, items) {
  const out = {};
  (items || []).forEach((x, i) => {
    const c = chosenOf(x, scope, i);
    if (c && c !== x.matches[0]) out[fkey(x.type, x.color)] = c.filament_id;
  });
  return out;
}
// Exceptions d'un profil, pour le plan : { plateau: { "TYPE|#COULEUR": filament } }.
export function platePicksOf(scope, items) {
  const out = {};
  for (const [k, mt] of PLATE) {
    if (!k.startsWith(`${scope}|`)) continue;
    const [pn, i] = k.slice(scope.length + 1).split("|");
    const x = (items || [])[+i];
    if (x && mt) (out[pn] = out[pn] || {})[fkey(x.type, x.color)] = mt.filament_id;
  }
  return out;
}
// Choisir (ou rendre au profil, mt null) la couleur d'un plateau.
export function setPlatePick(scope, plate, i, mt) {
  if (mt) PLATE.set(`${scope}|${plate}|${i}`, mt); else PLATE.delete(`${scope}|${plate}|${i}`);
  changed();
}
export const platePickOf = (scope, plate, i) => PLATE.get(`${scope}|${plate}|${i}`) || null;
export const chosenOf = (x, scope, i, plate) => {
  if (plate != null && PLATE.has(`${scope}|${plate}|${i}`)) return PLATE.get(`${scope}|${plate}|${i}`);
  const id = PICKS.get(`${scope}|${i}`);
  const ex = EXTRA.get(`${scope}|${i}`);
  // Choix possible aussi parmi les « autre matiere », ou trouve par recherche dans tout le stock.
  return x.matches.find(m => m.filament_id === id) || (x.others || []).find(m => m.filament_id === id)
    || (ex && ex.filament_id === id ? ex : null) || x.matches[0];
};

// Un plateau est-il faisable tout de suite avec ce qui est dans l'AMS ? Pour
// chacun de ses filaments, le filament retenu (choix a la main ou meilleur)
// doit avoir assez de grammes sur ses bobines chargees (AMS ou support
// externe). null : on ne sait pas (pas de filaments lus).
const IN_AMS = /^(AMS|Externe)/i;
export function plateInAms(items, plate, scope = "") {
  const fl = (plate?.filaments || []).filter(f => num(f.g) > 0);
  if (!items?.length || !fl.length) return null;
  const want = {}, have = {};
  for (const f of fl) {
    const i = items.findIndex(x => fkey(x.type, x.color) === fkey(f.type, f.color));
    const c = i >= 0 ? chosenOf(items[i], scope, i, plate.index) : null;
    if (!c) return false;
    want[c.filament_id] = (want[c.filament_id] || 0) + num(f.g);
    have[c.filament_id] = (c.spool_g || []).reduce((s, w, j) => s + (IN_AMS.test(c.spool_where?.[j] || "") ? num(w) : 0), 0);
  }
  return Object.keys(want).every(id => have[id] >= want[id]);
}

// Besoins par filament du profil : tout le profil (selected absent) ou la
// somme des plateaux choisis. Puis le total par filament retenu : deux
// couleurs qui tombent sur le meme filament du stock s'additionnent.
export function stockNeeds(items, plates, selected, choose = x => x.matches[0], scope = null) {
  // exceptions par plateau (plan) : ces grammes-la partent sur le filament du plateau
  const alt = items.map(() => []);
  const perPlate = scope != null && plates?.length && plates.every(pl => pl.filaments?.length);
  const need = items.map((x, i) => {
    const k = fkey(x.type, x.color);
    if (!perPlate && (!selected || !plates?.length)) return num(x.g);
    let g = 0;
    for (const pl of plates.filter(p => !selected || selected.includes(p.index))) {
      const gg = (pl.filaments || []).filter(f => fkey(f.type, f.color) === k).reduce((a, f) => a + num(f.g), 0);
      if (!gg) continue;
      const own = perPlate ? platePickOf(scope, pl.index, i) : null;
      if (own) alt[i].push({ plate: pl.index, mt: own, g: gg }); else g += gg;
    }
    return g;
  });
  const total = {};
  items.forEach((x, i) => {
    const b = choose(x, i);
    if (b && need[i] > 0) total[b.filament_id] = (total[b.filament_id] || 0) + need[i];
    for (const a of alt[i]) total[a.mt.filament_id] = (total[a.mt.filament_id] || 0) + a.g;
  });
  return { need, total, alt };
}

const detailOf = mt => [mt.brand, mt.material !== mt.name ? mt.material : null, mt.multicolor ? "multicolore" : null]
  .filter(Boolean).join(" · ");
// Bobine par bobine, dans l'ordre d'usage probable donne par le serveur (celle
// chargee dans l'AMS, puis la plus entamee) : ce qui sera pris sur chacune.
export const spoolPlan = (mt, g) => {
  if (!(g > 0)) return null;
  const ws = mt.spool_g?.length ? mt.spool_g : [mt.remaining_g];
  let left = g;
  const steps = [];
  for (let i = 0; i < ws.length && left > 0; i++) {
    const take = Math.min(ws[i], left);
    steps.push({ w: ws[i], take: Math.round(take), rest: Math.round(ws[i] - take), where: mt.spool_where?.[i] });
    left -= take;
  }
  return { steps, missing: Math.max(0, Math.round(left)) };
};
// Nombre de bobines touchees ; 0 si rien n'est demande, null si le stock ne suffit pas.
export const spoolsNeeded = (mt, g) => { const p = spoolPlan(mt, g); return !p ? 0 : p.missing ? null : p.steps.length; };
// Phrase explicite des que le filament a plusieurs bobines.
const planText = (mt, g) => {
  const p = spoolPlan(mt, g);
  if (!p || (mt.spool_g?.length || 1) < 2) return null;
  const nm = s => `la bobine de ${s.w} g${s.where ? ` (${s.where})` : ""}`;
  const [a, ...next] = p.steps;
  if (!next.length && !p.missing) return { warn: false, txt: `pris sur ${nm(a)} : il lui restera ${a.rest} g` };
  let txt = `finira ${nm(a)}`;
  next.forEach((s, i) => {
    txt += i === next.length - 1 && !p.missing
      ? `, puis entamera ${nm(s)} (${s.take} g, il lui restera ${s.rest} g)` : `, puis finira ${nm(s)}`;
  });
  if (p.missing) txt += ` — et il manquera encore ${p.missing} g`;
  return { warn: true, txt };
};
const levelText = mt => mt.multicolor && mt.delta_e < 12 ? "teinte incluse" : (LEVEL[mt.level] || LEVEL["différent"]).t;
const levelColor = mt => (LEVEL[mt.level] || LEVEL["différent"]).c;

export default function MwStockMatch({ items, plates, selected, scope = "", onNavigate }) {
  const [open, setOpen] = useState(null);
  const [, bump] = useState(0);
  usePicksVersion();                       // un plateau change de couleur : les besoins se recalculent
  const nav = useNavigate();
  // Changer le filament retenu est une ecriture (il part dans le plan « A faire ») :
  // reserve au droit MakerWorld, et jamais chez un copain. Les autres voient le choix.
  const canEdit = useCanMw();
  if (!items?.length) return null;
  const go = id => { onNavigate?.(); nav(`/filaments?id=${id}`); };
  const choose = (x, i) => chosenOf(x, scope, i);
  const pick = (i, id) => { PICKS.set(`${scope}|${i}`, id); setOpen(null); bump(n => n + 1); changed(); };
  const pickFound = (i, mt) => { EXTRA.set(`${scope}|${i}`, mt); pick(i, mt.filament_id); };
  const { need, total, alt } = stockNeeds(items, plates, selected, choose, scope);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"0 10px 10px" }}>
      {items.map((x, i) => {
        const best = choose(x, i);
        const manual = best && best !== x.matches[0];
        const others = x.others || [];
        const nAlt = Math.max(0, x.matches.length - 1) + others.length;
        const isOpen = open === i;
        const g = need[i];
        const unused = selected && g <= 0 && !alt[i].length;
        const sum = best ? total[best.filament_id] || 0 : 0;
        const shared = best && sum > g + 0.5;
        const after = best ? Math.round(best.remaining_g - sum) : 0;
        const short = best && g > 0 && after < 0;
        return (
          <div key={i} style={{ borderRadius:8, background:"var(--surface)", border:"1px solid var(--border)",
            opacity: unused ? 0.45 : 1, transition:"opacity .15s" }}>
            <button onClick={canEdit ? () => setOpen(isOpen ? null : i) : undefined} disabled={!canEdit}
              style={{ width:"100%", display:"flex", alignItems:"flex-start", gap:8, padding:"6px 8px", background:"none",
                border:"none", cursor: canEdit ? "pointer" : "default", color:"var(--text)", textAlign:"left" }}>
              <Swatch color={x.color} title={x.color}/>
              <span title={x.exact?.setting || undefined}
                style={{ fontSize:11.5, fontWeight:700, flexShrink:0, lineHeight:"16px", maxWidth:"34%" }}>
                {x.exact?.subtype || x.type || "?"}
                {x.exact?.vendor && !/bambu/i.test(x.exact.vendor) ? <span style={{ color:"var(--muted)", fontWeight:500 }}> ({x.exact.vendor})</span> : null}
                <span style={{ color:"var(--muted)", fontWeight:500 }}>
                  {unused ? " · pas utilisé" : g ? ` · ${Math.round(g)} g` : ""}</span>
              </span>
              <span style={{ color:"var(--muted)", fontSize:11, lineHeight:"16px" }}>→</span>
              {best ? (<>
                <Swatch f={best}/>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:"block", fontSize:11.5, fontWeight:600, lineHeight:"16px", overflow:"hidden",
                    textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{best.name}</span>
                  {x.exact && !best.other_material && <RefBadge mt={best}/>}
                  {best.other_material && <span style={{ display:"block", fontSize:9.5, fontWeight:800, color:"#f59e0b", lineHeight:1.3 }}>
                    ⚠ {best.material} au lieu de {x.exact?.subtype || x.type}</span>}
                  <span style={{ display:"block", fontSize:10.5, color:"var(--muted)", lineHeight:1.35 }}>
                    {detailOf(best)}{detailOf(best) ? " · " : ""}
                    {unused || !g ? `${best.remaining_g} g en stock`
                      : <>{best.remaining_g} g → <b style={{ color: short ? "#f59e0b" : "var(--text2)" }}>
                        {short ? `manque ${-after} g` : `reste ${after} g`}</b></>}
                    {best.where?.[0] ? ` · ${best.where[0]}` : ""}
                  </span>
                  {!unused && planText(best, sum) && (
                    <span style={{ display:"block", fontSize:10.5, lineHeight:1.35, marginTop:1,
                      color: planText(best, sum).warn ? "#3b82f6" : "var(--muted)", fontWeight: planText(best, sum).warn ? 700 : 400 }}>
                      {planText(best, sum).warn ? "🔄 " : "🧵 "}{planText(best, sum).txt}</span>
                  )}
                </span>
                <span style={{ textAlign:"right", flexShrink:0 }}>
                  <span style={{ display:"block", fontSize:10, fontWeight:800, color: levelColor(best), whiteSpace:"nowrap",
                    lineHeight:"16px" }}>{levelText(best)}</span>
                  {manual ? <span style={{ display:"block", fontSize:9.5, color:"#3b82f6", fontWeight:700 }}>choisi</span>
                    : canEdit && <span style={{ display:"block", fontSize:9.5, color:"var(--muted)" }}>
                      {nAlt > 0 ? `${nAlt} autre${nAlt > 1 ? "s" : ""} ▸` : "changer ▸"}</span>}
                </span>
              </>) : (
                <span style={{ flex:1, fontSize:11.5, color:"#ef4444", lineHeight:"16px" }}>Aucun {x.type || "filament"} en stock
                  {canEdit && <span style={{ display:"block", fontSize:10.5, color:"var(--muted)" }}>
                    {others.length ? "choisir une autre matière ▸" : "chercher dans mon stock ▸"}</span>}</span>
              )}
            </button>
            {alt[i].map(a => {
              const left = Math.round(a.mt.remaining_g - (total[a.mt.filament_id] || 0));
              return (
                <div key={a.plate} style={{ display:"flex", alignItems:"center", gap:6, fontSize:10.5, color:"var(--text2)",
                  padding:"0 8px 6px 30px" }}>
                  <span style={{ fontWeight:800, color:"#3b82f6" }}>Plateau {a.plate}</span> →
                  <Swatch f={a.mt} size={12}/>
                  <span style={{ minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.mt.name}
                    <span style={{ color:"var(--muted)" }}> · {Math.round(a.g)} g · </span>
                    <b style={{ color: left < 0 ? "#f59e0b" : "var(--text2)" }}>{left < 0 ? `manque ${-left} g` : `reste ${left} g`}</b></span>
                </div>
              );
            })}
            {!unused && shared ? (
              <div style={{ fontSize:10.5, color: short ? "#f59e0b" : "var(--muted)", padding:"0 8px 6px 30px" }}>
                {short ? "⚠ " : ""}Partagé avec une autre couleur : {Math.round(sum)} g au total sur ce filament</div>
            ) : null}
            {isOpen && <FilamentPicker x={x} g={g} chosen={best} title="Filament pour cette couleur (tout le profil)"
              onPick={mt => (inLists(x, mt.filament_id) ? pick(i, mt.filament_id) : pickFound(i, mt))}
              onGo={go} onClose={() => setOpen(null)}/>}
          </div>
        );
      })}
    </div>
  );
}

// Couleurs d'un plateau : pastilles du filament qui sera vraiment utilise (cerclees
// de bleu quand ce plateau a son propre choix) ; les toucher ouvre le choix pour CE
// plateau, le reste du profil ne bouge pas.
export function PlateColors({ items, plate, scope, canEdit, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [pickRow, setPickRow] = useState(null);
  const nav = useNavigate();
  const fl = (plate?.filaments || []).filter(f => num(f.g) > 0);
  if (!fl.length) return null;
  const rows = fl.map(f => {
    const i = (items || []).findIndex(x => fkey(x.type, x.color) === fkey(f.type, f.color));
    const x = i >= 0 ? items[i] : null;
    const own = x ? platePickOf(scope, plate.index, i) : null;
    return { f, i, x, own, c: x ? chosenOf(x, scope, i, plate.index) : null };
  });
  const dots = (
    <span style={{ display:"flex", gap:3, flexWrap:"wrap", alignItems:"center" }}>
      {rows.map((r, k) => <span key={k} title={`${r.f.type || ""} ${r.f.g ? `${r.f.g} g` : ""}${r.c ? ` → ${r.c.name}` : ""}`}
        style={{ width:12, height:12, borderRadius:"50%", boxSizing:"border-box", ...(r.c ? colorBg(parseColorsList(r.c.color, r.c.colors_array), r.c.multicolor_type, finishOf(r.c)) : { background: r.f.color || "#888" }),
          border: r.own ? "2px solid #3b82f6" : "1px solid rgba(255,255,255,0.3)" }}/>)}
      {canEdit && items?.length > 0 && <span style={{ fontSize:9.5, color:"#3b82f6", fontWeight:700, marginLeft:2 }}>🎨</span>}
    </span>
  );
  if (!canEdit || !items?.length) return <div style={{ marginTop:3 }}>{dots}</div>;
  const go = id => { setOpen(false); setPickRow(null); onNavigate?.(); nav(`/filaments?id=${id}`); };
  // une seule couleur : directement la fenetre de choix ; sinon la liste, puis la fenetre
  const cur = rows.length === 1 ? (rows[0].x ? rows[0] : null) : pickRow != null ? rows[pickRow] : null;
  return (
    <div onClick={e => e.stopPropagation()} style={{ marginTop:3 }}>
      <button type="button" onClick={() => setOpen(true)} title="Couleurs de ce plateau"
        style={{ background:"none", border:"none", padding:0, cursor:"pointer" }}>{dots}</button>
      {open && rows.length > 1 && pickRow == null && createPortal(
        <div onClick={e => { e.stopPropagation(); setOpen(false); }} style={{ position:"fixed", inset:0, zIndex:4300,
          background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:520, maxHeight:"85dvh", overflowY:"auto",
            background:"var(--sheet-bg, var(--surface))", borderRadius:"22px 22px 0 0", padding:"0 14px calc(14px + env(safe-area-inset-bottom,0px))",
            boxShadow:"0 -8px 30px rgba(0,0,0,.35)", display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, margin:"0 -14px 4px", padding:"16px 14px 12px",
              background:"radial-gradient(circle at 12% 30%, rgba(236,72,153,0.32), transparent 60%), var(--surface2)" }}>
              <span style={{ width:40, height:40, borderRadius:13, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:19,
                background:"linear-gradient(135deg, #EC4899, #8B5CF6)", boxShadow:"0 6px 14px -6px #EC4899" }}>🎨</span>
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:"block", fontSize:16, fontWeight:900, color:"var(--text)" }}>Couleurs du plateau {plate.index}</span>
                <span style={{ display:"block", fontSize:12, fontWeight:700, color:"var(--muted)" }}>{plate.name ? `${plate.name} · ` : ""}ce choix ne vaut que pour ce plateau</span>
              </span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" style={{ width:34, height:34, borderRadius:"50%",
                border:"1px solid var(--border)", background:"var(--surface)", fontSize:15, color:"var(--text2)", cursor:"pointer", flexShrink:0 }}>✕</button>
            </div>
            {rows.map((r, k) => r.x && (
              <button key={k} type="button" onClick={() => setPickRow(k)} style={{ display:"flex", alignItems:"center", gap:8,
                padding:"11px 12px", borderRadius:14, border:"1px solid var(--border)", background:"var(--surface2)", cursor:"pointer",
                textAlign:"left", color:"var(--text)" }}>
                <Swatch color={r.f.color} size={16}/>
                <span style={{ fontSize:12, fontWeight:700 }}>{r.f.type} · {Math.round(num(r.f.g))} g</span>
                <span style={{ color:"var(--muted)", fontSize:11 }}>→</span>
                {r.c && <Swatch f={r.c} size={16}/>}
                <span style={{ flex:1, minWidth:0, fontSize:12, fontWeight:600, color: r.own ? "#3b82f6" : "var(--text2)",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.c?.name || "—"}{r.own ? "" : " (profil)"}</span>
                <span style={{ fontSize:11.5, color:"#fff", fontWeight:800, padding:"3px 9px", borderRadius:20,
                  background:"linear-gradient(135deg, #3B82F6, #6366F1)", flexShrink:0 }}>changer ▸</span>
              </button>
            ))}
          </div>
        </div>, document.body)}
      {open && cur && <FilamentPicker x={cur.x} g={num(cur.f.g)} chosen={cur.c}
        title={`Plateau ${plate.index}${plate.name ? ` · ${plate.name}` : ""} : filament pour cette couleur`}
        onPick={mt => { setPlatePick(scope, plate.index, cur.i, mt); setPickRow(null); if (rows.length <= 1) setOpen(false); }}
        onReset={cur.own ? () => setPlatePick(scope, plate.index, cur.i, null) : null} resetLabel="= comme le profil"
        onGo={go} onClose={() => { setPickRow(null); if (rows.length <= 1) setOpen(false); }}/>}
    </div>
  );
}

// Fenetre de choix d'un filament, en onglets : proches en couleur, deja charges
// (AMS ou support externe), autre matiere, recherche dans tout le stock. Chaque
// ligne dit l'ecart de couleur (ΔE), le niveau, la matiere, ce qui restera et ou.
export function FilamentPicker({ x, g, chosen, title, onPick, onReset, resetLabel, onGo, onClose }) {
  const others = x.others || [];
  const [tab, setTab] = useState("near");
  const [ams, setAms] = useState(null);
  useEffect(() => {
    let alive = true;
    client.get("/makerworld/stock/search", { params: { type: x.type, color: x.color, g: g || undefined, ams: true } })
      .then(({ data }) => alive && setAms(data.items || [])).catch(() => alive && setAms([]));
    return () => { alive = false; };
  }, [x.type, x.color, g]);
  const tabs = [["near", "Proches", x.matches.length], ["ams", "Dans l'AMS", ams ? ams.length : "…"],
    ["other", "Autre matière", others.length], ["search", "Recherche", null]];
  const list = tab === "near" ? x.matches : tab === "ams" ? ams : tab === "other" ? others : null;
  const empty = { near: "Aucun filament proche en stock.", ams: "Rien de chargé dans l'AMS pour cette matière.",
    other: "Aucune autre matière proche." }[tab];
  return createPortal(
    <div onClick={e => { e.stopPropagation(); onClose(); }} style={{ position:"fixed", inset:0, zIndex:4400,
      background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:540, height:"min(640px, 88dvh)", display:"flex",
        flexDirection:"column", background:"var(--sheet-bg, var(--surface))", borderRadius:"22px 22px 0 0",
        boxShadow:"0 -8px 30px rgba(0,0,0,.35)", overflow:"hidden" }}>
        <div style={{ padding:"16px 14px 10px", display:"flex", flexDirection:"column", gap:9, borderBottom:"1px solid var(--border)",
          background:"radial-gradient(circle at 12% 30%, rgba(249,115,22,0.30), transparent 60%), var(--surface2)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ width:38, height:38, borderRadius:12, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18,
              background:"linear-gradient(135deg, #F97316, #FBBF24)", boxShadow:"0 6px 14px -6px #F97316" }}>🧵</span>
            <span style={{ flex:1, minWidth:0, fontSize:15, fontWeight:900, color:"var(--text)", lineHeight:1.25 }}>{title || "Choisir un filament"}</span>
            <button type="button" onClick={onClose} aria-label="Fermer" style={{ width:34, height:34, borderRadius:"50%", border:"1px solid var(--border)",
              background:"var(--surface)", fontSize:15, color:"var(--text2)", cursor:"pointer", flexShrink:0 }}>✕</button>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, color:"var(--text2)", flexWrap:"wrap" }}>
            <Swatch color={x.color} size={16} title={x.color}/>
            <b>{x.exact?.subtype || x.type || "?"}</b>{g ? <span style={{ color:"var(--muted)" }}>· {Math.round(g)} g</span> : null}
            <span style={{ color:"var(--muted)" }}>→</span>
            {chosen ? <><Swatch f={chosen} size={16}/><span style={{ fontWeight:700 }}>{chosen.name}</span></>
              : <span style={{ color:"#ef4444" }}>aucun</span>}
            {onReset && <button type="button" onClick={onReset} style={{ marginLeft:"auto", fontSize:11.5, fontWeight:800, color:"#3b82f6",
              background:"var(--surface)", border:"1px solid rgba(59,130,246,0.45)", borderRadius:20, padding:"3px 10px", cursor:"pointer" }}>{resetLabel || "Annuler ce choix"}</button>}
          </div>
          <div role="tablist" style={{ display:"flex", gap:4, overflowX:"auto" }}>
            {tabs.map(([id, label, n]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                style={{ flexShrink:0, padding:"6px 12px", borderRadius:20, cursor:"pointer", fontSize:12.5, fontWeight:800,
                  border: tab === id ? "none" : "1px solid var(--border)", boxShadow: tab === id ? "0 6px 14px -8px #F97316" : "none",
                  background: tab === id ? "linear-gradient(135deg, #F97316, #F59E0B)" : "var(--surface)", color: tab === id ? "#fff" : "var(--text2)" }}>
                {label}{n != null ? <span style={{ opacity:.75, fontWeight:700 }}> {n}</span> : null}</button>
            ))}
          </div>
        </div>
        <div style={{ flex:1, minHeight:0, overflowY:"auto" }}>
          {tab === "search" ? <StockSearch x={x} g={g} chosen={chosen} onPick={onPick} onGo={onGo} open/>
            : list === null ? <div style={{ padding:16, fontSize:12, color:"var(--muted)" }}>…</div>
            : !list.length ? <div style={{ padding:16, fontSize:12, color:"var(--muted)" }}>{empty}</div>
            : list.map(mt => <MatchRow key={tab + mt.filament_id} mt={mt} g={g} on={mt.filament_id === chosen?.filament_id}
                onPick={() => onPick(mt)} onGo={onGo}/>)}
        </div>
      </div>
    </div>, document.body);
}

// Chercher dans tout le stock (toutes matieres, nom, marque, couleur, #id),
// du plus proche en couleur au plus eloigne.
function StockSearch({ x, g, chosen, onPick, onGo, open }) {
  const [on, setOn] = useState(!!open);
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const t = setTimeout(() => {
      client.get("/makerworld/stock/search", { params: { type: x.type, color: x.color, g: g || undefined, q } })
        .then(({ data }) => alive && setRes(data.items || [])).catch(() => alive && setRes([]));
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [on, q, x.type, x.color, g]);
  if (!on) return (
    <button onClick={() => setOn(true)} style={{ width:"100%", textAlign:"left", padding:"8px 12px", background:"none",
      border:"none", borderTop:"1px solid var(--border)", color:"#3b82f6", fontSize:11.5, fontWeight:700, cursor:"pointer" }}>
      🔍 Chercher dans tout mon stock</button>
  );
  return (
    <div style={{ borderTop:"1px solid var(--border)" }}>
      <div style={{ padding:"7px 10px 5px" }}>
        <input value={q} onChange={e => setQ(e.target.value)} autoFocus autoComplete="off" spellCheck={false}
          placeholder="Nom, marque, matière, couleur…"
          style={{ width:"100%", boxSizing:"border-box", height:38, padding:"0 14px", borderRadius:20, fontSize:13.5,
            background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
      </div>
      {res === null ? <div style={{ padding:"4px 12px 8px", fontSize:11, color:"var(--muted)" }}>…</div>
        : !res.length ? <div style={{ padding:"4px 12px 8px", fontSize:11, color:"var(--muted)" }}>Rien dans le stock.</div>
        : (<div style={{ maxHeight:300, overflowY:"auto" }}>
          {res.map(mt => (
            <MatchRow key={"s" + mt.filament_id} mt={mt} g={g} on={mt.filament_id === chosen?.filament_id}
              onPick={() => onPick(mt)} onGo={onGo}/>
          ))}
        </div>)}
    </div>
  );
}

// Une proposition : la toucher la retient pour cette ligne ; ↗ ouvre le filament.
function MatchRow({ mt, g, on, onPick, onGo }) {
  const after = Math.round(mt.remaining_g - (g || 0));
  return (
    <div style={{ display:"flex", alignItems:"center", borderTop:"1px solid var(--border)",
      background: on ? "linear-gradient(90deg, rgba(59,130,246,0.16), transparent 75%)" : "none" }}>
      <button onClick={onPick}
        style={{ flex:1, minWidth:0, display:"flex", alignItems:"center", gap:9, padding:"9px 4px 9px 12px", background:"none",
          border:"none", cursor:"pointer", color:"var(--text)", textAlign:"left" }}>
        <span style={{ width:16, height:16, borderRadius:"50%", flexShrink:0, boxSizing:"border-box",
          border: on ? "5px solid #3b82f6" : "1.5px solid var(--muted)" }}/>
        <Swatch f={mt} size={24}/>
        <span style={{ flex:1, minWidth:0 }}>
          <span style={{ display:"block", fontSize:13, fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {mt.name}</span>
          {mt.same_finish != null && <RefBadge mt={mt}/>}
          {mt.other_material && <span style={{ display:"block", fontSize:9.5, fontWeight:800, color:"#f59e0b", lineHeight:1.3 }}>
            ⚠ autre matière : {mt.material}</span>}
          <span style={{ display:"block", fontSize:11.5, fontWeight:600, color:"var(--muted)" }}>
            {[detailOf(mt), `${mt.remaining_g} g (${mt.spools} bobine${mt.spools > 1 ? "s" : ""})`].filter(Boolean).join(" · ")}
            {g > 0 ? <b style={{ color: after < 0 ? "#f59e0b" : "var(--text2)" }}> · {after < 0 ? `manque ${-after} g` : `reste ${after} g`}</b> : null}
            {spoolsNeeded(mt, g) > 1 ? <span style={{ color:"#3b82f6" }}> · {spoolsNeeded(mt, g)} bobines à entamer</span> : null}
            {mt.where?.[0] ? <span style={{ color: /^(AMS|Externe)/i.test(mt.where[0]) ? "#16a34a" : "var(--muted)" }}> · {mt.where[0]}</span> : null}
          </span>
        </span>
        <span style={{ textAlign:"right", flexShrink:0 }}>
          <span style={{ display:"inline-block", fontSize:10.5, fontWeight:900, color: levelColor(mt), padding:"1px 7px", borderRadius:20,
            background:`color-mix(in srgb, ${levelColor(mt)} 14%, transparent)` }}>{levelText(mt)}</span>
          {mt.delta_e != null && <span style={{ display:"block", fontSize:9.5, color:"var(--muted)" }}
            title="Écart de couleur perçu (ΔE 2000) : sous 2,5 l'œil ne voit pas la différence">ΔE {String(mt.delta_e).replace(".", ",")}</span>}
        </span>
      </button>
      <button onClick={() => onGo(mt.filament_id)} title="Ouvrir ce filament" aria-label={`Ouvrir ${mt.name}`}
        style={{ padding:"6px 10px", background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:13 }}>↗</button>
    </div>
  );
}

// Ce que dit le 3MF du profil : meme reference Bambu, meme finition, ou autre finition.
function RefBadge({ mt }) {
  const [t, c] = mt.same_ref ? ["✓ même référence", "#22c55e"] : mt.same_finish ? ["✓ même finition", "#22c55e"]
    : ["autre finition", "#f59e0b"];
  return <span style={{ display:"inline-block", fontSize:9.5, fontWeight:800, color:c, lineHeight:1.3 }}>{t}</span>;
}

function Swatch({ color, f, size = 16, title }) {
  const bg = f ? colorBg(parseColorsList(f.color, f.colors_array), f.multicolor_type, finishOf(f)) : { background: color || "#888" };
  return <span title={title} style={{ width:size, height:size, borderRadius:"50%", flexShrink:0, ...bg,
    border:"1px solid rgba(128,128,128,0.45)" }}/>;
}
