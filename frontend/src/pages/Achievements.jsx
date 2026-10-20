import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import client from "../api/client";
import { isMoneyHidden } from "../utils/money";

// Succes : medailles gagnees sur l'historique (impressions, filaments, objets,
// MakerWorld, copains, secrets). Chaque succes a jusqu'a cinq crans (bronze,
// argent, or, platine, diamant) ou une medaille unique. Onglet de categorie
// garde dans l'adresse (?cat=) ; ?a= met un succes en avant (lien des
// notifications).

const fmt = (n, unit) => {
  if (n == null) return "";
  const v = typeof n === "number" && !Number.isInteger(n) ? n.toFixed(n < 10 ? 2 : 1).replace(".", ",")
    : Number(n).toLocaleString("fr-FR");
  return unit ? `${v} ${unit}` : v;
};
const dateFr = iso => iso ? new Date(iso + (iso.endsWith("Z") || iso.includes("+") ? "" : "Z"))
  .toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" }) : "";

export default function Achievements() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [sp, setSp] = useSearchParams();
  const cat = sp.get("cat") || "", focus = sp.get("a") || "";
  const pick = c => { const n = new URLSearchParams(sp); c ? n.set("cat", c) : n.delete("cat"); n.delete("a"); setSp(n, { replace:true }); };

  useEffect(() => {
    client.get("/achievements").then(r => setData(r.data)).catch(e => setErr(e.response?.data?.detail || e.message));
  }, []);

  const byId = useMemo(() => Object.fromEntries((data?.items || []).map(x => [x.id, x])), [data]);
  if (err) return <p style={msg}>{err}</p>;
  if (!data) return <p style={msg}>…</p>;

  const shown = data.items.filter(x => !cat || x.cat === cat)
    // gagnes d'abord (du plus haut cran), puis les plus avances vers leur premier cran
    .sort((a, b) => (b.level - a.level) || (progress(b) - progress(a)));
  const pct = data.score_max ? Math.round(100 * data.score / data.score_max) : 0;
  const counts = {};
  for (const x of data.items) {
    const c = counts[x.cat] || (counts[x.cat] = { got:0, all:0 });
    c.all++; if (x.level >= 0) c.got++;
  }

  return (
    <div style={{ maxWidth:900, margin:"0 auto", display:"flex", flexDirection:"column", gap:14 }}>
      <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Succès</h1>

      {/* Bilan : score et medailles */}
      <div className="card" style={{ padding:"16px 18px", display:"flex", flexDirection:"column", gap:12,
        background:"linear-gradient(135deg, rgba(245,183,0,0.12), rgba(139,92,246,0.10)), var(--surface)" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:10, flexWrap:"wrap" }}>
          <span style={{ fontSize:28, fontWeight:900, color:"var(--text)", fontVariantNumeric:"tabular-nums" }}>{data.score}</span>
          <span style={{ fontSize:13, color:"var(--muted)", fontWeight:600 }}>points sur {data.score_max} · {pct} %</span>
        </div>
        <div style={{ height:8, borderRadius:8, background:"var(--surface2)", overflow:"hidden" }}>
          <div style={{ width:`${pct}%`, height:"100%", borderRadius:8,
            background:"linear-gradient(90deg, #CD7F32, #F5B700, #6EC6D9, #8B5CF6)" }}/>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:`repeat(${data.tiers.length}, 1fr)`, gap:4 }}>
          {data.tiers.map(t => (
            <div key={t.id} title={t.label} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <Medal tier={t} emoji="" size={20} locked={!data.medals[t.id]}/>
                <span style={{ fontSize:15, fontWeight:800, color:"var(--text)", fontVariantNumeric:"tabular-nums" }}>
                  {data.medals[t.id] || 0}</span>
              </div>
              <span style={{ fontSize:10.5, color:"var(--muted)", whiteSpace:"nowrap" }}>{t.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Derniers succes */}
      {data.recent.length > 0 && !cat && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={sectionTitle}>Derniers succès</div>
          <div className="no-scrollbar" style={{ display:"flex", gap:8, overflowX:"auto", padding:"2px 0" }}>
            {data.recent.map(r => {
              const it = byId[r.id]; if (!it) return null;
              const t = it.tiers[r.tier];
              return (
                <button key={r.id + r.tier} onClick={() => { const n = new URLSearchParams(); n.set("a", r.id); setSp(n, { replace:true }); }}
                  className="card" style={{ flexShrink:0, display:"flex", alignItems:"center", gap:10, padding:"8px 12px 8px 8px",
                    cursor:"pointer", border:"1px solid var(--border)", textAlign:"left" }}>
                  <Medal tier={t} emoji={it.emoji} size={40}/>
                  <span style={{ display:"flex", flexDirection:"column", minWidth:0 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:"var(--text)", whiteSpace:"nowrap" }}>{it.name}</span>
                    <span style={{ fontSize:11, color:"var(--muted)", whiteSpace:"nowrap" }}>{t.label} · {dateFr(r.at)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Categories */}
      <div className="no-scrollbar" style={{ display:"flex", gap:7, overflowX:"auto", padding:"2px 24px 2px 0",
        WebkitMaskImage:"linear-gradient(90deg, #000 calc(100% - 28px), transparent)",
        maskImage:"linear-gradient(90deg, #000 calc(100% - 28px), transparent)" }}>
        <Chip on={!cat} onClick={() => pick("")}>Tout <small style={small}>{data.items.filter(x => x.level >= 0).length}/{data.items.length}</small></Chip>
        {data.categories.filter(c => counts[c.id]).map(c => (
          <Chip key={c.id} on={cat === c.id} onClick={() => pick(cat === c.id ? "" : c.id)}>
            <span>{c.emoji}</span>{c.name} <small style={small}>{counts[c.id].got}/{counts[c.id].all}</small>
          </Chip>
        ))}
      </div>

      {/* Succes */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:10 }}>
        {shown.map(it => <Card key={it.id} it={it} focus={focus === it.id}/>)}
      </div>
      {data.since && <p style={{ ...msg, padding:"4px", fontSize:11 }}>
        Les dates viennent de ton historique ; ce qui ne s'y lit pas (MakerWorld, stock, copains) est daté du jour où il a été constaté.</p>}
    </div>
  );
}

const progress = it => {
  if (it.next == null || it.value == null) return it.level >= 0 ? 1 : 0;
  const span = it.next - (it.prev || 0);
  return span > 0 ? Math.max(0, Math.min(1, (it.value - (it.prev || 0)) / span)) : 0;
};

function Card({ it, focus }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    // apres la mise en page (cartes au-dessus, ouverture de celle-ci)
    const t = setTimeout(() => ref.current?.scrollIntoView({ block:"center" }), 150);
    return () => clearTimeout(t);
  }, [focus]);
  const got = it.level >= 0;
  const top = got ? it.tiers[it.level] : it.tiers[0];
  const p = progress(it);
  const money = it.money && isMoneyHidden();
  const done = got && it.next == null;
  return (
    <div ref={ref} className="card" onClick={() => setOpen(o => !o)}
      style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:9, cursor:"pointer",
        border: focus ? `2px solid ${top.color}` : undefined,
        boxShadow: focus ? `0 0 0 4px ${top.color}33` : undefined,
        background: done ? `linear-gradient(135deg, ${top.color}1f, transparent 70%), var(--surface)` : undefined }}>
      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
        <Medal tier={top} emoji={it.emoji} size={52} locked={!got}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:800, color: got ? "var(--text)" : "var(--text2)" }}>{it.name}</div>
          <div style={{ fontSize:12, color:"var(--muted)", marginTop:2, lineHeight:1.35 }}>
            {done ? "✓ Tous les crans gagnés" : it.desc}</div>
        </div>
      </div>
      {!it.secret || got ? (
        it.tiers.length > 1 && (
          <>
            {it.next != null && (
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ flex:1, height:6, borderRadius:6, background:"var(--surface2)", overflow:"hidden" }}>
                  <div style={{ width:`${Math.round(p * 100)}%`, height:"100%", borderRadius:6,
                    background: it.tiers[it.level + 1]?.color || top.color }}/>
                </div>
                {!money && <span style={{ fontSize:11, fontWeight:700, color:"var(--text2)", whiteSpace:"nowrap",
                  fontVariantNumeric:"tabular-nums" }}>{fmt(it.value, it.unit)} / {fmt(it.next, it.unit)}</span>}
              </div>
            )}
            <div style={{ display:"flex", gap:6 }}>
              {it.tiers.map(t => <Medal key={t.id} tier={t} emoji="" size={18} locked={!t.at}/>)}
            </div>
          </>
        )
      ) : null}
      {open && (got || !it.secret) && (
        <div style={{ display:"flex", flexDirection:"column", gap:4, borderTop:"1px solid var(--border)", paddingTop:8 }}>
          {it.tiers.map(t => (
            <div key={t.id} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12,
              color: t.at ? "var(--text)" : "var(--muted)" }}>
              <Medal tier={t} emoji="" size={16} locked={!t.at}/>
              <span style={{ fontWeight:700, minWidth:58 }}>{t.label}</span>
              <span style={{ flex:1 }}>{money ? "" : it.tiers.length > 1 ? fmt(t.n, it.unit) : ""}</span>
              <span style={{ fontSize:11 }}>{t.at ? dateFr(t.at) : "à gagner"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Medaille : disque a la teinte du cran, liseré, ruban ; grisee tant qu'elle
// n'est pas gagnee.
export function Medal({ tier, emoji, size = 48, locked = false }) {
  const c = locked ? "#8a8f98" : tier.color;
  const id = `m${tier.id}${locked ? "l" : ""}`;
  return (
    <span style={{ position:"relative", width:size, height:size, flexShrink:0, display:"inline-flex",
      alignItems:"center", justifyContent:"center", opacity: locked ? 0.45 : 1 }}>
      <svg width={size} height={size} viewBox="0 0 48 48" style={{ position:"absolute", inset:0 }} aria-hidden="true">
        <defs>
          <radialGradient id={id} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.85"/>
            <stop offset="45%" stopColor={c}/>
            <stop offset="100%" stopColor={c} stopOpacity="0.75"/>
          </radialGradient>
        </defs>
        {size >= 30 && <>
          <path d="M14 2 L22 18 L17 20 L9 4 Z" fill={c} opacity="0.55"/>
          <path d="M34 2 L26 18 L31 20 L39 4 Z" fill={c} opacity="0.55"/>
        </>}
        <circle cx="24" cy={size >= 30 ? 28 : 24} r={size >= 30 ? 18 : 21} fill={`url(#${id})`}
          stroke={c} strokeWidth="2.5"/>
        <circle cx="24" cy={size >= 30 ? 28 : 24} r={size >= 30 ? 13.5 : 15.5} fill="none"
          stroke="#fff" strokeOpacity="0.45" strokeWidth="1.2"/>
      </svg>
      {emoji && <span style={{ position:"relative", top: size >= 30 ? size * 0.08 : 0, fontSize:size * 0.36,
        filter: locked ? "grayscale(1)" : "none", lineHeight:1 }}>{emoji}</span>}
    </span>
  );
}

function Chip({ on, onClick, children }) {
  return (
    <button onClick={onClick} aria-pressed={on} style={{ flexShrink:0, display:"flex", alignItems:"center", gap:5,
      whiteSpace:"nowrap", cursor:"pointer", borderRadius:20, fontWeight:700, padding:"6px 12px", fontSize:12.5,
      border: on ? "1px solid #F59E0B" : "1px solid var(--border)", background: on ? "#F59E0B" : "var(--surface2)",
      color: on ? "#fff" : "var(--text2)" }}>{children}</button>
  );
}

const small = { fontSize:11, fontWeight:700, opacity:0.7 };
const sectionTitle = { fontSize:11, fontWeight:800, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", padding:"0 4px" };
const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
