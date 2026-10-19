import React, { useEffect, useState } from "react";
import client from "../api/client";
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
// Filament trouve par la recherche dans tout le stock (hors propositions) : `${scope}|${i}` -> proposition.
const EXTRA = new Map();
const inLists = (x, id) => x.matches.some(m => m.filament_id === id) || (x.others || []).some(m => m.filament_id === id);
// Plan retenu pour « À imprimer » : cle « TYPE|#COULEUR » -> filament choisi a la main.
// Un choix fait par recherche est relu dans le stock (promesse resolue une fois tout pret).
export function setPicksFromPlan(scope, items, picks) {
  const asks = [];
  (items || []).forEach((x, i) => {
    const id = picks?.[fkey(x.type, x.color)];
    if (!id) return;
    PICKS.set(`${scope}|${i}`, id);
    if (!inLists(x, id)) asks.push(client.get("/makerworld/stock/search", { params: { type: x.type, color: x.color, ids: String(id) } })
      .then(({ data }) => { if (data.items?.[0]) EXTRA.set(`${scope}|${i}`, data.items[0]); }).catch(() => {}));
  });
  return Promise.all(asks);
}
export function picksOf(scope, items) {
  const out = {};
  (items || []).forEach((x, i) => {
    const c = chosenOf(x, scope, i);
    if (c && c !== x.matches[0]) out[fkey(x.type, x.color)] = c.filament_id;
  });
  return out;
}
export const chosenOf = (x, scope, i) => {
  const id = PICKS.get(`${scope}|${i}`);
  const ex = EXTRA.get(`${scope}|${i}`);
  // Choix possible aussi parmi les « autre matiere », ou trouve par recherche dans tout le stock.
  return x.matches.find(m => m.filament_id === id) || (x.others || []).find(m => m.filament_id === id)
    || (ex && ex.filament_id === id ? ex : null) || x.matches[0];
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
  const nav = useNavigate();
  if (!items?.length) return null;
  const go = id => { onNavigate?.(); nav(`/filaments?id=${id}`); };
  const choose = (x, i) => chosenOf(x, scope, i);
  const pick = (i, id) => { PICKS.set(`${scope}|${i}`, id); setOpen(null); bump(n => n + 1); };
  const pickFound = (i, mt) => { EXTRA.set(`${scope}|${i}`, mt); pick(i, mt.filament_id); };
  const { need, total } = stockNeeds(items, plates, selected, choose);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"0 10px 10px" }}>
      {items.map((x, i) => {
        const best = choose(x, i);
        const manual = best && best !== x.matches[0];
        const others = x.others || [];
        const nAlt = Math.max(0, x.matches.length - 1) + others.length;
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
            <button onClick={() => setOpen(isOpen ? null : i)}
              style={{ width:"100%", display:"flex", alignItems:"flex-start", gap:8, padding:"6px 8px", background:"none",
                border:"none", cursor:"pointer", color:"var(--text)", textAlign:"left" }}>
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
                    : <span style={{ display:"block", fontSize:9.5, color:"var(--muted)" }}>
                      {isOpen ? "masquer ▴" : nAlt > 0 ? `${nAlt} autre${nAlt > 1 ? "s" : ""} ▾` : "changer ▾"}</span>}
                </span>
              </>) : (
                <span style={{ flex:1, fontSize:11.5, color:"#ef4444", lineHeight:"16px" }}>Aucun {x.type || "filament"} en stock
                  <span style={{ display:"block", fontSize:10.5, color:"var(--muted)" }}>
                    {isOpen ? "masquer ▴" : others.length ? "choisir une autre matière ▾" : "chercher dans mon stock ▾"}</span></span>
              )}
            </button>
            {!unused && shared ? (
              <div style={{ fontSize:10.5, color: short ? "#f59e0b" : "var(--muted)", padding:"0 8px 6px 30px" }}>
                {short ? "⚠ " : ""}Partagé avec une autre couleur : {Math.round(sum)} g au total sur ce filament</div>
            ) : null}
            {isOpen && x.matches.map(mt => (
              <MatchRow key={mt.filament_id} mt={mt} g={g} on={mt.filament_id === best?.filament_id}
                onPick={() => pick(i, mt.filament_id)} onGo={go}/>
            ))}
            {/* Autre matiere : pour simuler (un PLA Silk a la place d'un ABS…) ; plus proches en couleur. */}
            {isOpen && others.length > 0 && (<>
              <div style={{ fontSize:10, fontWeight:800, color:"#f59e0b", textTransform:"uppercase", letterSpacing:0.4,
                padding:"7px 12px 3px", borderTop:"1px solid var(--border)" }}>Autre matière</div>
              {others.map(mt => (
                <MatchRow key={"o" + mt.filament_id} mt={mt} g={g} on={mt.filament_id === best?.filament_id}
                  onPick={() => pick(i, mt.filament_id)} onGo={go}/>
              ))}
            </>)}
            {isOpen && <StockSearch x={x} g={g} chosen={best} onPick={mt => pickFound(i, mt)} onGo={go}/>}
          </div>
        );
      })}
    </div>
  );
}

// Chercher dans tout le stock (toutes matieres, nom, marque, couleur, #id),
// du plus proche en couleur au plus eloigne.
function StockSearch({ x, g, chosen, onPick, onGo }) {
  const [on, setOn] = useState(false);
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
          style={{ width:"100%", boxSizing:"border-box", padding:"7px 10px", borderRadius:8, fontSize:12.5,
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
          {mt.same_finish != null && <RefBadge mt={mt}/>}
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

// Ce que dit le 3MF du profil : meme reference Bambu, meme finition, ou autre finition.
function RefBadge({ mt }) {
  const [t, c] = mt.same_ref ? ["✓ même référence", "#22c55e"] : mt.same_finish ? ["✓ même finition", "#22c55e"]
    : ["autre finition", "#f59e0b"];
  return <span style={{ display:"inline-block", fontSize:9.5, fontWeight:800, color:c, lineHeight:1.3 }}>{t}</span>;
}

function Swatch({ color, f, size = 16, title }) {
  const bg = f ? colorBg(parseColorsList(f.color, f.colors_array), f.multicolor_type) : { background: color || "#888" };
  return <span title={title} style={{ width:size, height:size, borderRadius:"50%", flexShrink:0, ...bg,
    border:"1px solid rgba(128,128,128,0.45)" }}/>;
}
