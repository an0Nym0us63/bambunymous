import React from "react";
import { Search, SlidersHorizontal, Plus } from "lucide-react";
import AdminOnly from "./AdminOnly";

// Le langage des fiches et des pages de liste (25/10/2026) : sorti de la page Filaments pour etre partage
// (Objets et accessoires le reprennent). La coque d'une fiche, ses tuiles de chiffres, ses cartes de faits,
// et en tete de page les tuiles de chiffres, la recherche en pilule et les onglets en couleur.
export const fRound = { width:34, height:34, borderRadius:"50%", border:"1px solid var(--border)", background:"color-mix(in srgb, var(--sheet-bg) 80%, transparent)",
  backdropFilter:"blur(6px)", color:"var(--text2)", cursor:"pointer", fontSize:15, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center" };
export const fBtn = { padding:"11px 12px", borderRadius:12, border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)", fontSize:13.5,
  fontWeight:800, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 };
export const fGrad = (a, b) => ({ backgroundImage:`linear-gradient(135deg, ${a}, ${b})`, WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" });
// une couleur tres claire (blanc, jade…) se perd sur le fond : elle garde un contour et un texte sombre
export const isLight = c => { const m = /^#?([0-9a-f]{6})/i.exec(c || ""); if (!m) return false; const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.72; };
export const fChip = (txt, c, extra = {}) => <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:800,
  whiteSpace:"nowrap", color:c, background:`${c}1f`, border:`1px solid ${c}33`, ...extra }}>{txt}</span>;
export const dayFr = iso => iso ? new Date(String(iso).length <= 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" }) : null;
export const agoFr = iso => { if (!iso) return null; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "aujourd'hui" : d === 1 ? "hier" : d < 60 ? `il y a ${d} j` : `il y a ${Math.round(d / 30)} mois`; };

// la coque : fond assombri, feuille (en bas au telephone, centree a l'ordinateur), barre du haut et barre d'actions
export function FSheet({ onClose, top = null, bottom = null, children, z = 1000 }) {
  const wide = typeof window !== "undefined" && window.innerWidth >= 900;
  return (
    <div data-no-pull="" onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:z, display:"flex",
      alignItems: wide ? "center" : "flex-end", justifyContent:"center", padding: wide ? 20 : 0 }}>
      <div onClick={e => e.stopPropagation()} className="sheet-inner" style={{ background:"var(--sheet-bg)", borderRadius: wide ? 24 : "22px 22px 0 0",
        width:"100%", maxWidth: wide ? 760 : 600, maxHeight: wide ? "90dvh" : "94dvh", display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ flex:1, minHeight:0, overflowY:"auto", position:"relative" }}>
          <div style={{ position:"sticky", top:0, zIndex:10, height:0 }}>
            {!wide && <div style={{ position:"absolute", top:8, left:"50%", transform:"translateX(-50%)", width:38, height:4, borderRadius:2, background:"rgba(148,163,184,.6)" }}/>}
            <div style={{ position:"absolute", top:10, right:12, display:"flex", gap:8 }}>
              {top}
              <button onClick={onClose} aria-label="Fermer" style={fRound}>✕</button>
            </div>
          </div>
          {children}
        </div>
        {bottom && <div style={{ flexShrink:0, display:"flex", gap:8, padding:"10px 14px calc(10px + env(safe-area-inset-bottom, 0px))",
          borderTop:"1px solid var(--border)", background:"color-mix(in srgb, var(--sheet-bg) 94%, transparent)", backdropFilter:"blur(8px)" }}>{bottom}</div>}
      </div>
    </div>);
}
// une tuile de chiffre (meme dessin que celles de la fiche impression)
export function FTile({ label, value, sub, c1, c2, onClick, tip }) {
  return (
    <button onClick={onClick} disabled={!onClick} data-tip={tip} style={{ minWidth:0, padding:"9px 8px", borderRadius:16, border:`1px solid color-mix(in srgb, ${c1} 22%, var(--border))`,
      background:`radial-gradient(90% 70% at 100% 0%, ${c1}22, transparent 70%), var(--surface2)`, cursor: onClick ? "pointer" : "default", textAlign:"left",
      font:"inherit", color:"inherit", display:"flex", flexDirection:"column", gap:1, boxShadow:`0 6px 18px -12px ${c1}` }}>
      <span style={{ fontSize:10, fontWeight:800, letterSpacing:".05em", textTransform:"uppercase", color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{label}</span>
      <span style={{ fontSize:16, fontWeight:900, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", ...fGrad(c1, c2) }}>{value}</span>
      {sub && <span style={{ fontSize:10.5, fontWeight:700, color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{sub}</span>}
    </button>);
}
// une carte de faits ; repliable (fold) : le resume reste visible, le detail se deplie
export function FCard({ t, i, c, aside = null, fold = false, open = true, onToggle, summary = null, children }) {
  const shut = fold && !open;
  return (
    <div style={{ borderRadius:18, padding:"12px 14px", background:`linear-gradient(160deg, ${c}1a, transparent 55%), var(--surface2)`,
      border:`1px solid ${c}33`, display:"flex", flexDirection:"column", minWidth:0 }}>
      <div onClick={fold ? onToggle : undefined} style={{ display:"flex", alignItems:"center", gap:8, marginBottom: shut ? 0 : 4, cursor: fold ? "pointer" : "default" }}>
        <span style={{ width:28, height:28, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, background:`${c}26`, flexShrink:0 }}>{i}</span>
        <span style={{ fontSize:13.5, fontWeight:900, color:"var(--text)", flex:1, minWidth:0 }}>{t}</span>
        {aside}
        {fold && <span style={{ fontSize:11, color:"var(--muted)", transform: open ? "rotate(90deg)" : "none", transition:"transform .15s" }}>▶</span>}
      </div>
      {shut ? summary : children}
    </div>);
}
// une ligne de carte : l'intitule a gauche, la valeur a droite (en gras, en couleur si vc)
export const FROW = { display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, padding:"8px 0", borderTop:"1px dashed var(--border)" };
export const FLAB = { fontSize:12.5, fontWeight:700, color:"var(--muted)", flexShrink:0 };
export const FVAL = { fontSize:14, fontWeight:900, color:"var(--text)", textAlign:"right", minWidth:0, overflowWrap:"anywhere" };
export function FRow({ l, v, d, vc, pre, mono }) {
  if (v == null || v === "") return null;
  return (
    <div style={FROW}>
      <span style={FLAB}>{l}</span>
      <span style={{ textAlign:"right", minWidth:0 }}>
        <span style={{ ...FVAL, display:"inline-flex", alignItems:"center", gap:6, color: vc || "var(--text)",
          fontFamily: mono ? "JetBrains Mono,monospace" : "inherit", fontSize: mono ? 13 : 14 }}>{pre}{v}</span>
        {d && <span style={{ display:"block", fontSize:11, fontWeight:600, color:"var(--muted)" }}>{d}</span>}
      </span>
    </div>);
}

export const lighten = c => `color-mix(in srgb, ${c} 60%, #ffffff)`;
export function KpiBar({ kpis, icons = {} }) {
  const list = kpis.filter(k => k && k.value !== "—" && k.value != null);
  return (
    <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.min(Math.max(list.length, 1), 4)}, minmax(0, 1fr))`, gap:6 }}>
      {list.map(({ label, value, accent }) => {
        const c = accent || "#94a3b8";
        return (
          <div key={label} style={{ minWidth:0, padding:"7px 8px", borderRadius:14, border:`1px solid color-mix(in srgb, ${c} 22%, var(--border))`,
            background:`radial-gradient(90% 70% at 100% 0%, ${c}22, transparent 70%), var(--surface2)`, boxShadow:`0 6px 18px -12px ${c}` }}>
            <div style={{ fontSize:9.5, fontWeight:800, letterSpacing:".05em", textTransform:"uppercase", color:"var(--muted)", whiteSpace:"nowrap",
              overflow:"hidden", textOverflow:"ellipsis" }}>{icons[label] ? `${icons[label]} ` : ""}{label}</div>
            <div style={{ fontSize:"clamp(13px, 3.9vw, 16px)", fontWeight:900, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
              backgroundImage:`linear-gradient(135deg, ${c}, ${lighten(c)})`, WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" }}>{value}</div>
          </div>
        );
      })}
    </div>
  );
}

// Recherche en pilule, filtres en bouton rond (le nombre de filtres en pastille), ajout en degrade.
export function SearchRow({ q, setQ, placeholder, active = 0, onFilter, addLabel = null, onAdd = null, filterTip = "Filtres et tri" }) {
  return (
    <div style={{ display:"flex", gap:6, alignItems:"center" }}>
      <div style={{ position:"relative", flex:1, minWidth:0 }}>
        <Search size={15} style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder}
          style={{ width:"100%", height:40, padding:"0 34px 0 38px", boxSizing:"border-box", background:"var(--surface2)",
            border:"1px solid var(--border)", borderRadius:20, fontSize:13, color:"var(--text)", outline:"none" }}/>
        {q && <button onClick={() => setQ("")} aria-label="Effacer la recherche" style={{ position:"absolute", right:6, top:"50%", transform:"translateY(-50%)",
          width:28, height:28, borderRadius:"50%", border:"none", background:"var(--surface)", color:"var(--muted)", cursor:"pointer" }}>✕</button>}
      </div>
      {onFilter && <button onClick={onFilter} aria-label={filterTip} data-tip={filterTip} style={{ position:"relative", width:40, height:40, borderRadius:14, flexShrink:0,
        cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", border:"1px solid var(--border)",
        background: active ? "rgba(59,130,246,0.14)" : "var(--surface2)", color: active ? "#3b82f6" : "var(--muted)" }}>
        <SlidersHorizontal size={16}/>
        {active > 0 && <span style={{ position:"absolute", top:-5, right:-5, minWidth:18, height:18, padding:"0 5px", borderRadius:9, boxSizing:"border-box",
          fontSize:10.5, fontWeight:900, color:"#fff", background:"linear-gradient(135deg, #3B82F6, #6366F1)", display:"flex", alignItems:"center",
          justifyContent:"center", boxShadow:"0 0 0 2px var(--bg)" }}>{active}</span>}
      </button>}
      {addLabel && onAdd && (
        <AdminOnly><button onClick={onAdd} style={{ height:40, padding:"0 14px", borderRadius:14, border:"none", flexShrink:0, cursor:"pointer",
          display:"flex", alignItems:"center", gap:5, fontSize:13, fontWeight:800, color:"#fff",
          background:"linear-gradient(135deg, #3B82F6, #6366F1)", boxShadow:"0 6px 16px -8px #3B82F6" }}>
          <Plus size={15}/> {addLabel}</button></AdminOnly>
      )}
    </div>
  );
}

export function EmptyCard({ icon, text }) {
  return <div style={{ padding:"26px 16px", borderRadius:18, border:"1px dashed var(--border)", textAlign:"center",
    background:"radial-gradient(80% 80% at 50% 0%, rgba(59,130,246,0.12), transparent 70%), var(--surface2)" }}>
    <div style={{ fontSize:30, marginBottom:6 }}>{icon}</div>
    <p style={{ color:"var(--muted)", fontSize:13, fontWeight:700, margin:0 }}>{text}</p></div>;
}

// Les onglets de la page, chacun sa couleur (comme Impressions).
export function PageTabs({ tabs, tab, setTab }) {
  return (
    <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:16, padding:4, border:"1px solid var(--border)" }}>
      {tabs.map(t => {
        const on = tab === t.id;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex:"1 1 auto", minWidth:0, padding:"8px 4px", borderRadius:12, fontWeight:800, cursor:"pointer",
            fontSize:"clamp(10.5px, 3.1vw, 12.5px)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", border:"none",
            display:"flex", alignItems:"center", justifyContent:"center", gap:5, transition:"all 0.15s",
            background: on ? `linear-gradient(135deg, ${t.c}, color-mix(in srgb, ${t.c} 70%, #ffffff))` : "transparent",
            color: on ? "white" : "var(--muted)", boxShadow: on ? `0 6px 16px -6px ${t.c}` : "none" }}>
            <span style={{ fontSize:"clamp(11px, 3.2vw, 13px)", filter: on ? "none" : "grayscale(.5)" }}>{t.ic}</span>{t.label}</button>);
      })}
    </div>
  );
}

