import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { colorBg, parseColorsList } from "../utils/colors";

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
export const chosenOf = (x, scope, i) => {
  const id = PICKS.get(`${scope}|${i}`);
  return x.matches.find(m => m.filament_id === id) || x.matches[0];
};

// Besoins par filament du profil : tout le profil (selected absent) ou la
// somme des plateaux choisis. Puis le total par filament retenu : deux
// couleurs qui tombent sur le meme filament du stock s'additionnent.
export function stockNeeds(items, plates, selected, choose = x => x.matches[0]) {
  const need = items.map(x => {
    if (!selected || !plates?.length) return num(x.g);
    const k = fkey(x.type, x.color);
    return plates.filter(pl => selected.includes(pl.index))
      .reduce((s, pl) => s + (pl.filaments || []).filter(f => fkey(f.type, f.color) === k).reduce((a, f) => a + num(f.g), 0), 0);
  });
  const total = {};
  items.forEach((x, i) => { const b = choose(x, i); if (b && need[i] > 0) total[b.filament_id] = (total[b.filament_id] || 0) + need[i]; });
  return { need, total };
}

const detailOf = mt => [mt.brand, mt.material !== mt.name ? mt.material : null, mt.multicolor ? "multicolore" : null]
  .filter(Boolean).join(" · ");
// Combien de bobines il faudra entamer (les plus pleines d'abord) ; 0 si
// rien n'est demande, null si tout le stock ne suffit pas.
export const spoolsNeeded = (mt, g) => {
  if (!(g > 0)) return 0;
  let acc = 0, k = 0;
  for (const w of mt.spool_g || [mt.remaining_g]) { acc += w; k += 1; if (acc >= g) return k; }
  return null;
};
const spoolsText = (mt, g) => {
  const k = spoolsNeeded(mt, g);
  const n = mt.spools || (mt.spool_g || []).length || 1;
  const list = mt.spool_g?.length > 1 ? ` (${mt.spool_g.map(w => `${w} g`).join(" + ")})` : "";
  if (k > 1) return `il faudra ${k === n ? `les ${n}` : `${k} de tes ${n}`} bobines${list}`;
  return n > 1 ? `${n} bobines${list}` : "";
};
const levelText = mt => mt.multicolor && mt.delta_e < 12 ? "teinte incluse" : (LEVEL[mt.level] || LEVEL["différent"]).t;
const levelColor = mt => (LEVEL[mt.level] || LEVEL["différent"]).c;

export default function MwStockMatch({ items, plates, selected, scope = "", onNavigate }) {
  const [open, setOpen] = useState(null);
  const [, bump] = useState(0);
  const nav = useNavigate();
  if (!items?.length) return null;
  const go = id => { onNavigate?.(); nav(`/filaments?id=${id}`); };
  const choose = (x, i) => chosenOf(x, scope, i);
  const pick = (i, id) => { PICKS.set(`${scope}|${i}`, id); setOpen(null); bump(n => n + 1); };
  const { need, total } = stockNeeds(items, plates, selected, choose);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"0 10px 10px" }}>
      {items.map((x, i) => {
        const best = choose(x, i);
        const manual = best && best !== x.matches[0];
        const isOpen = open === i;
        const g = need[i];
        const unused = selected && g <= 0;
        const sum = best ? total[best.filament_id] || 0 : 0;
        const shared = best && sum > g + 0.5;
        const after = best ? Math.round(best.remaining_g - sum) : 0;
        const short = best && g > 0 && after < 0;
        return (
          <div key={i} style={{ borderRadius:8, background:"var(--surface)", border:"1px solid var(--border)",
            opacity: unused ? 0.45 : 1, transition:"opacity .15s" }}>
            <button onClick={() => setOpen(isOpen ? null : i)} disabled={!best}
              style={{ width:"100%", display:"flex", alignItems:"flex-start", gap:8, padding:"6px 8px", background:"none",
                border:"none", cursor: best ? "pointer" : "default", color:"var(--text)", textAlign:"left" }}>
              <Swatch color={x.color} title={x.color}/>
              <span style={{ fontSize:11.5, fontWeight:700, flexShrink:0, lineHeight:"16px" }}>
                {x.type || "?"}<span style={{ color:"var(--muted)", fontWeight:500 }}>
                  {unused ? " · pas utilisé" : g ? ` · ${Math.round(g)} g` : ""}</span>
              </span>
              <span style={{ color:"var(--muted)", fontSize:11, lineHeight:"16px" }}>→</span>
              {best ? (<>
                <Swatch f={best}/>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:"block", fontSize:11.5, fontWeight:600, lineHeight:"16px", overflow:"hidden",
                    textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{best.name}</span>
                  <span style={{ display:"block", fontSize:10.5, color:"var(--muted)", lineHeight:1.35 }}>
                    {detailOf(best)}{detailOf(best) ? " · " : ""}
                    {unused || !g ? `${best.remaining_g} g en stock`
                      : <>{best.remaining_g} g → <b style={{ color: short ? "#f59e0b" : "var(--text2)" }}>
                        {short ? `manque ${-after} g` : `reste ${after} g`}</b></>}
                    {best.where?.[0] ? ` · ${best.where[0]}` : ""}
                  </span>
                  {!unused && spoolsText(best, sum) && (
                    <span style={{ display:"block", fontSize:10.5, lineHeight:1.35,
                      color: spoolsNeeded(best, sum) > 1 ? "#3b82f6" : "var(--muted)" }}>🧵 {spoolsText(best, sum)}</span>
                  )}
                </span>
                <span style={{ textAlign:"right", flexShrink:0 }}>
                  <span style={{ display:"block", fontSize:10, fontWeight:800, color: levelColor(best), whiteSpace:"nowrap",
                    lineHeight:"16px" }}>{levelText(best)}</span>
                  {manual ? <span style={{ display:"block", fontSize:9.5, color:"#3b82f6", fontWeight:700 }}>choisi</span>
                    : x.matches.length > 1 ? <span style={{ display:"block", fontSize:9.5, color:"var(--muted)" }}>
                      {isOpen ? "masquer ▴" : `${x.matches.length - 1} autre${x.matches.length > 2 ? "s" : ""} ▾`}</span> : null}
                </span>
              </>) : (
                <span style={{ flex:1, fontSize:11.5, color:"#ef4444", lineHeight:"16px" }}>Aucun {x.type || "filament"} en stock</span>
              )}
            </button>
            {!unused && shared ? (
              <div style={{ fontSize:10.5, color: short ? "#f59e0b" : "var(--muted)", padding:"0 8px 6px 30px" }}>
                {short ? "⚠ " : ""}Partagé avec une autre couleur : {Math.round(sum)} g au total sur ce filament</div>
            ) : null}
            {isOpen && x.matches.map(mt => (
              <MatchRow key={mt.filament_id} mt={mt} g={g} on={mt.filament_id === best.filament_id}
                onPick={() => pick(i, mt.filament_id)} onGo={go}/>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// Une proposition : la toucher la retient pour cette ligne ; ↗ ouvre le filament.
function MatchRow({ mt, g, on, onPick, onGo }) {
  const after = Math.round(mt.remaining_g - (g || 0));
  return (
    <div style={{ display:"flex", alignItems:"center", borderTop:"1px solid var(--border)",
      background: on ? "rgba(59,130,246,0.08)" : "none" }}>
      <button onClick={onPick}
        style={{ flex:1, minWidth:0, display:"flex", alignItems:"center", gap:8, padding:"6px 4px 6px 12px", background:"none",
          border:"none", cursor:"pointer", color:"var(--text)", textAlign:"left" }}>
        <span style={{ width:14, height:14, borderRadius:"50%", flexShrink:0, boxSizing:"border-box",
          border: on ? "4px solid #3b82f6" : "1.5px solid var(--muted)" }}/>
        <Swatch f={mt} size={18}/>
        <span style={{ flex:1, minWidth:0 }}>
          <span style={{ display:"block", fontSize:11.5, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {mt.name}</span>
          <span style={{ display:"block", fontSize:10.5, color:"var(--muted)" }}>
            {[detailOf(mt), `${mt.remaining_g} g (${mt.spools} bobine${mt.spools > 1 ? "s" : ""})`].filter(Boolean).join(" · ")}
            {g > 0 ? <b style={{ color: after < 0 ? "#f59e0b" : "var(--text2)" }}> · {after < 0 ? `manque ${-after} g` : `reste ${after} g`}</b> : null}
            {spoolsNeeded(mt, g) > 1 ? <span style={{ color:"#3b82f6" }}> · {spoolsNeeded(mt, g)} bobines à entamer</span> : null}
          </span>
        </span>
        <span style={{ textAlign:"right", flexShrink:0 }}>
          <span style={{ display:"block", fontSize:10, fontWeight:800, color: levelColor(mt) }}>{levelText(mt)}</span>
          <span style={{ display:"block", fontSize:9.5, color:"var(--muted)" }}
            title="Écart de couleur perçu (ΔE 2000) : sous 2,5 l'œil ne voit pas la différence">ΔE {String(mt.delta_e).replace(".", ",")}</span>
        </span>
      </button>
      <button onClick={() => onGo(mt.filament_id)} title="Ouvrir ce filament" aria-label={`Ouvrir ${mt.name}`}
        style={{ padding:"6px 10px", background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:13 }}>↗</button>
    </div>
  );
}

function Swatch({ color, f, size = 16, title }) {
  const bg = f ? colorBg(parseColorsList(f.color, f.colors_array), f.multicolor_type) : { background: color || "#888" };
  return <span title={title} style={{ width:size, height:size, borderRadius:"50%", flexShrink:0, ...bg,
    border:"1px solid rgba(128,128,128,0.45)" }}/>;
}
