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

export default function MwStockMatch({ items, onNavigate }) {
  const [open, setOpen] = useState(null);
  const nav = useNavigate();
  if (!items?.length) return null;
  const go = id => { onNavigate?.(); nav(`/filaments?id=${id}`); };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"0 10px 10px" }}>
      {items.map((x, i) => {
        const best = x.matches[0];
        const lv = best ? LEVEL[best.level] || LEVEL["différent"] : null;
        const isOpen = open === i;
        return (
          <div key={i} style={{ borderRadius:8, background:"var(--surface)", border:"1px solid var(--border)" }}>
            <button onClick={() => setOpen(isOpen ? null : i)} disabled={x.matches.length < 2 && !best}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"6px 8px", background:"none",
                border:"none", cursor:"pointer", color:"var(--text)", textAlign:"left" }}>
              <Swatch color={x.color} title={x.color}/>
              <span style={{ fontSize:11.5, fontWeight:700, minWidth:0, flexShrink:0 }}>
                {x.type || "?"}{x.g ? <span style={{ color:"var(--muted)", fontWeight:500 }}> · {Math.round(x.g)} g</span> : null}
              </span>
              <span style={{ color:"var(--muted)", fontSize:11 }}>→</span>
              {best ? (<>
                <Swatch f={best}/>
                <span style={{ flex:1, minWidth:0, fontSize:11.5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {best.name}</span>
                <span style={{ fontSize:10, fontWeight:800, color: lv.c, whiteSpace:"nowrap" }}>{lv.t}</span>
              </>) : (
                <span style={{ flex:1, fontSize:11.5, color:"#ef4444" }}>Aucun {x.type || "filament"} en stock</span>
              )}
            </button>
            {best && (isOpen ? x.matches : []).map(mt => <MatchRow key={mt.filament_id} mt={mt} g={x.g} onGo={go}/>)}
            {best && !isOpen && !best.enough && x.g ? (
              <div style={{ fontSize:10.5, color:"#f59e0b", padding:"0 8px 6px 30px" }}>
                ⚠ il en faut {Math.round(x.g)} g, il en reste {best.remaining_g} g</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MatchRow({ mt, g, onGo }) {
  const lv = LEVEL[mt.level] || LEVEL["différent"];
  return (
    <button onClick={() => onGo(mt.filament_id)}
      style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"6px 8px 6px 30px", background:"none",
        border:"none", borderTop:"1px solid var(--border)", cursor:"pointer", color:"var(--text)", textAlign:"left" }}>
      <Swatch f={mt} size={18}/>
      <span style={{ flex:1, minWidth:0 }}>
        <span style={{ display:"block", fontSize:11.5, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {mt.name}</span>
        <span style={{ display:"block", fontSize:10.5, color:"var(--muted)" }}>
          {[mt.brand, mt.material, mt.multicolor ? "multicolore" : null,
            `${mt.remaining_g} g (${mt.spools} bobine${mt.spools > 1 ? "s" : ""})`, mt.where?.[0]].filter(Boolean).join(" · ")}
          {g && !mt.enough ? <b style={{ color:"#f59e0b" }}> · pas assez</b> : null}
        </span>
      </span>
      <span style={{ textAlign:"right", flexShrink:0 }}>
        <span style={{ display:"block", fontSize:10, fontWeight:800, color: lv.c }}>
          {mt.multicolor && mt.delta_e < 12 ? "teinte incluse" : lv.t}</span>
        <span style={{ display:"block", fontSize:9.5, color:"var(--muted)" }}
          title="Écart de couleur perçu (ΔE 2000) : sous 2,5 l'œil ne voit pas la différence">ΔE {String(mt.delta_e).replace(".", ",")}</span>
      </span>
    </button>
  );
}

function Swatch({ color, f, size = 16, title }) {
  const bg = f ? colorBg(parseColorsList(f.color, f.colors_array), f.multicolor_type) : { background: color || "#888" };
  return <span title={title} style={{ width:size, height:size, borderRadius:"50%", flexShrink:0, ...bg,
    border:"1px solid rgba(128,128,128,0.45)" }}/>;
}
