import React, { useState, useEffect } from "react";

import { TrendingUp, Weight, Euro, Clock, Layers, Package, ShoppingBag, Trophy, BarChart2 } from "lucide-react";
import client from "../api/client";

const fmtH = s => { const h=Math.floor((s||0)/3600),m=Math.floor(((s||0)%3600)/60); return h>0?`${h}h${m>0?` ${m}min`:""}`:m>0?`${m}min`:"—"; };
const fmtDate = d => d ? new Date(d.includes("T")?d:d+"T00:00:00").toLocaleDateString("fr-FR",{month:"short",year:"numeric"}) : "";

function Section({ title, children }) {
  return (
    <section>
      <p style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase",
        letterSpacing:"0.08em", margin:"0 0 12px" }}>{title}</p>
      {children}
    </section>
  );
}

function KpiCard({ icon: Icon, label, value, sub, color="#3b82f6" }) {
  return (
    <div className="card" style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:5 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ width:28, height:28, borderRadius:8, background:`${color}20`,
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Icon size={14} style={{ color }}/>
        </div>
        <span style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</span>
      </div>
      <p style={{ fontSize:20, fontWeight:800, fontFamily:"JetBrains Mono,monospace",
        color:"var(--text)", margin:0, lineHeight:1 }}>{value ?? "—"}</p>
      {sub && <p style={{ fontSize:10, color:"var(--muted)", margin:0 }}>{sub}</p>}
    </div>
  );
}

// Barre horizontale CSS
function Bar({ label, value, max, color="#3b82f6", sublabel, badge }) {
  const pct = max > 0 ? Math.max(2, (value/max)*100) : 0;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0",
      borderBottom:"1px solid var(--border)" }}>
      <div style={{ width:140, fontSize:11, color:"var(--text)", fontWeight:600,
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flexShrink:0 }}>
        {badge && <span style={{ display:"inline-block", width:10, height:10, borderRadius:"50%",
          background:badge, marginRight:6, flexShrink:0 }}/>}
        {label}
      </div>
      <div style={{ flex:1, height:8, background:"var(--surface2)", borderRadius:4, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:color, borderRadius:4,
          transition:"width 0.5s ease" }}/>
      </div>
      <span style={{ fontSize:11, fontFamily:"JetBrains Mono,monospace", color:"var(--muted)",
        minWidth:60, textAlign:"right", flexShrink:0 }}>{sublabel}</span>
    </div>
  );
}

// Graphe barres vertical — évolution mensuelle
function TimeChart({ data, mode = "count" }) {
  if (!data || Object.keys(data).length === 0) return null;
  const keys = Object.keys(data).slice(-18); // 18 derniers mois max
  const values = keys.map(k => mode==="cost" ? data[k].cost : mode==="weight" ? data[k].weight_g/1000 : data[k].count);
  const maxVal = Math.max(...values, 1);
  const [tab, setTab] = useState("count");
  const currentValues = keys.map(k => tab==="cost" ? data[k].cost : tab==="weight" ? data[k].weight_g/1000 : data[k].count);
  const currentMax = Math.max(...currentValues, 1);
  const colors = { count:"#3b82f6", cost:"#22c55e", weight:"#8b5cf6" };

  return (
    <div className="card" style={{ padding:"16px 16px 10px" }}>
      {/* Tabs */}
      <div style={{ display:"flex", gap:6, marginBottom:16 }}>
        {[["count","Impressions"],["cost","Coût (€)"],["weight","Filament (kg)"]].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{ padding:"4px 10px", borderRadius:20, fontSize:10, fontWeight:600, cursor:"pointer", border:"none",
              background:tab===id?colors[id]:"var(--surface2)", color:tab===id?"white":"var(--muted)" }}>
            {label}
          </button>
        ))}
      </div>
      {/* Barres */}
      <div style={{ display:"flex", gap:3, alignItems:"flex-end", height:100, overflowX:"auto" }}>
        {keys.map((k, i) => {
          const v = currentValues[i];
          const h = Math.max(2, (v/currentMax)*100);
          return (
            <div key={k} title={`${k}: ${tab==="count"?v+" prints":tab==="cost"?v.toFixed(2)+"€":v.toFixed(2)+"kg"}`}
              style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, flex:"0 0 auto", width:26 }}>
              <div style={{ width:"100%", height:`${h}%`, background:colors[tab], borderRadius:"3px 3px 0 0",
                minHeight:2, transition:"height 0.4s ease" }}/>
              <span style={{ fontSize:7, color:"var(--muted)", transform:"rotate(-45deg)",
                transformOrigin:"top center", whiteSpace:"nowrap", marginTop:6 }}>
                {k.slice(5)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Camembert SVG simple
function Donut({ data, title }) {
  if (!data || data.length === 0) return null;
  const total = data.reduce((s,d) => s+d.value, 0);
  if (!total) return null;
  const COLORS = ["#3b82f6","#22c55e","#f59e0b","#ef4444","#8b5cf6","#f97316","#06b6d4","#84cc16","#ec4899","#a78bfa"];
  let cum = 0;
  const slices = data.slice(0,10).map((d,i) => {
    const pct = d.value / total;
    const start = cum; cum += pct;
    const a1 = start * 2 * Math.PI - Math.PI/2;
    const a2 = cum  * 2 * Math.PI - Math.PI/2;
    const r = 45, cx = 60, cy = 60;
    const x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1),x2=cx+r*Math.cos(a2),y2=cy+r*Math.sin(a2);
    const large = pct > 0.5 ? 1 : 0;
    return { path:`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`,
      color:COLORS[i%COLORS.length], label:d.name, pct:Math.round(pct*100) };
  });

  return (
    <div className="card" style={{ padding:"16px" }}>
      <p style={{ fontSize:13, fontWeight:700, color:"var(--text)", margin:"0 0 12px" }}>{title}</p>
      <div style={{ display:"flex", gap:16, alignItems:"flex-start", flexWrap:"wrap" }}>
        <svg width={120} height={120} viewBox="0 0 120 120">
          {slices.map((s,i) => <path key={i} d={s.path} fill={s.color} stroke="var(--bg)" strokeWidth={1.5}/>)}
          <circle cx={60} cy={60} r={22} fill="var(--bg)"/>
        </svg>
        <div style={{ flex:1, display:"flex", flexDirection:"column", gap:5 }}>
          {slices.map((s,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:s.color, flexShrink:0 }}/>
              <span style={{ fontSize:11, color:"var(--text)", flex:1,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.label}</span>
              <span style={{ fontSize:10, color:"var(--muted)", fontFamily:"monospace" }}>{s.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TopList({ title, prints, groups, valueKey, valueLabel, barColor="#3b82f6", onItemClick }) {
  const [mode, setMode] = useState("prints");
  const items = mode === "groups" ? (groups||[]) : (prints||[]);
  if (!prints?.length && !groups?.length) return null;
  const maxVal = Math.max(...items.map(i => Number(i[valueKey])||0), 1);
  const MEDAL = ["🥇","🥈","🥉"];
  return (
    <div className="card" style={{ padding:"14px 16px", display:"flex", flexDirection:"column" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <p style={{ fontSize:13, fontWeight:700, color:"var(--text)", margin:0 }}>{title}</p>
        {(
          <div style={{ display:"flex", gap:2, background:"var(--surface2)", borderRadius:20, padding:2 }}>
            {[["prints","Prints"],["groups","Groupes"]].map(([id,label])=>(
              <button key={id} onClick={()=>id==="groups"&&!groups?.length?null:setMode(id)}
                style={{ padding:"3px 10px", borderRadius:18, fontSize:10, fontWeight:600,
                  cursor: id==="groups"&&!groups?.length?"default":"pointer", border:"none",
                  background:mode===id?"#3b82f6":"transparent",
                  color:mode===id?"white":id==="groups"&&!groups?.length?"var(--border)":"var(--muted)",
                  opacity:id==="groups"&&!groups?.length?0.4:1 }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ position:"relative" }}>
      <div style={{ overflowY:"auto", maxHeight:240,
        WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        {items.map((item, i) => {
          const pct = Math.max(2, (Number(item[valueKey])||0)/maxVal*100);
          return (
            <div key={item.id} style={{ marginBottom:10, cursor:"pointer" }}
              onClick={()=>onItemClick?.(item, mode)}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                <span style={{ fontSize:12, flexShrink:0 }}>{MEDAL[i]||`${i+1}`}</span>
                <span style={{ fontSize:11, color:"var(--text)", fontWeight:600, flex:1,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {mode==="groups" && item.nb > 1 && <span style={{ fontSize:9, color:"var(--muted)", marginRight:4 }}>×{item.nb}</span>}
                  {item.name}
                </span>
                <span style={{ fontSize:11, fontFamily:"JetBrains Mono,monospace",
                  color:barColor, fontWeight:700, flexShrink:0 }}>
                  {valueLabel(item)}
                </span>
              </div>
              <div style={{ height:4, background:"var(--surface2)", borderRadius:2, overflow:"hidden" }}>
                <div style={{ width:`${pct}%`, height:"100%", borderRadius:2,
                  background: i===0?"#f59e0b":i===1?"#94a3b8":i===2?"#cd7f32":barColor }}/>
              </div>
            </div>
          );
        })}
      </div>
      {items.length > 5 && (
        <div style={{ position:"absolute", bottom:0, left:0, right:0, height:40, pointerEvents:"none",
          background:"linear-gradient(transparent, var(--bg))", borderRadius:"0 0 8px 8px" }}/>
      )}
      </div>
    </div>
  );
}

export default function Stats() {
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null); // { type:"print"|"group", data:{...} }
  const [filaments, setFilaments] = useState(null);
  const [spools, setSpools] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      client.get("/prints/stats/summary"),
      client.get("/filaments/filaments"),
      client.get("/filaments/spools", { params:{ archived:false } }),
    ]).then(([r1,r2,r3]) => {
      setData(r1.data);
      setFilaments(r2.data);
      setSpools(r3.data);
    }).finally(() => setLoading(false));
  }, []);

  const openDetail = async (item, mode) => {
    if (mode === "groups") {
      setDetail({ type:"group", data:item });
    } else {
      try {
        const r = await client.get(`/prints/${item.id}`);
        setDetail({ type:"print", data:r.data });
      } catch { setDetail({ type:"print", data:item }); }
    }
  };

  if (loading) return <p style={{ textAlign:"center", color:"var(--muted)", padding:60 }}>Chargement…</p>;

  const spoolsActive = (spools||[]).filter(s=>!s.archived);
  const poidsStock   = spoolsActive.reduce((s,b)=>s+(b.remaining_weight_g||0),0);
  const filsStock    = (filaments||[]).filter(f=>(f.active_spool_count||0)>0).length;
  const matData      = (data?.materials||[]).map(m=>({name:m.name, value:m.grams}));
  const brandData    = (data?.brands||[]).map(b=>({name:b.name, value:b.grams}));

  return (
    <div style={{ maxWidth:960, margin:"0 auto", display:"flex", flexDirection:"column", gap:20 }}>
      <h1 style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Statistiques</h1>

      {detail && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:300, display:"flex", alignItems:"flex-end" }}
          onClick={()=>setDetail(null)}>
          <div onClick={e=>e.stopPropagation()} className="sheet-inner"
            style={{ width:"100%", background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
              padding:"0 16px 32px", maxHeight:"70dvh", overflowY:"auto", position:"relative" }}>
            <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)", margin:"12px auto 8px" }}/>
            <button onClick={()=>setDetail(null)} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            <p style={{ fontWeight:700, fontSize:15, color:"var(--text)", margin:"4px 0 14px",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", paddingRight:36 }}>
              {detail.data.name || detail.data.file_name || "?"}
            </p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {[
                ["Durée",     detail.data.duration_s > 0 ? fmtH(detail.data.duration_s)
                              : detail.data.duration_seconds > 0 ? fmtH(detail.data.duration_seconds) : null],
                ["Coût",      detail.data.cost > 0 ? `${detail.data.cost.toFixed(2)} €`
                              : detail.data.total_cost > 0 ? `${detail.data.total_cost.toFixed(2)} €` : null],
                ["Poids",     detail.data.total_weight_g > 0 ? `${detail.data.total_weight_g.toFixed(0)} g` : null],
                ["Prints",    detail.data.nb > 1 ? `${detail.data.nb} prints` : null],
              ].filter(([,v])=>v).map(([label,val])=>(
                <div key={label} style={{ background:"var(--surface2)", border:"1px solid var(--border)",
                  borderRadius:10, padding:"8px 12px" }}>
                  <p style={{ fontSize:9, color:"var(--muted)", textTransform:"uppercase",
                    letterSpacing:"0.06em", margin:"0 0 3px" }}>{label}</p>
                  <p style={{ fontSize:14, fontWeight:700, fontFamily:"monospace", color:"var(--text)", margin:0 }}>{val}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* KPIs impressions */}
      <Section title="Impressions">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
          <KpiCard icon={Layers}     label="Total"          value={data?.total_prints}      color="#3b82f6"/>
          <KpiCard icon={TrendingUp} label="Réussies"       value={data?.success_prints}    color="#22c55e"/>
          <KpiCard icon={Clock}      label="Temps total"    value={fmtH((data?.total_hours||0)*3600)} color="#f59e0b"/>
          <KpiCard icon={Clock}      label="Durée moyenne"  value={data?.avg_duration_h > 0 ? fmtH(data.avg_duration_h*3600) : null} color="#f59e0b" sub="par impression"/>
          <KpiCard icon={Weight}     label="Filament utilisé" value={data?.total_weight_g ? `${(data.total_weight_g/1000).toFixed(2)} kg` : null} color="#8b5cf6"/>
          <KpiCard icon={Euro}       label="Coût total"     value={data?.total_cost ? `${data.total_cost.toFixed(2)} €` : null} color="#ef4444"/>
          <KpiCard icon={Euro}       label="Coût moyen"     value={data?.avg_cost > 0 ? `${data.avg_cost.toFixed(2)} €` : null} color="#f97316" sub="par impression"/>
        </div>
      </Section>

      {/* Évolution temporelle */}
      {data?.monthly && Object.keys(data.monthly).length > 2 && (
        <Section title="Évolution dans le temps">
          <TimeChart data={data.monthly}/>
        </Section>
      )}

      {/* Classements */}
      <Section title="Classements">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
          <TopList title="⏱ Les plus longs"
            prints={data?.top_duration||[]}
            groups={data?.top_groups_duration||[]}
            valueKey="duration_s"
            valueLabel={p => fmtH(p.duration_s)}
            onItemClick={(item,mode)=>openDetail(item,mode)}/>
          <TopList title="💰 Les plus chers"
            prints={data?.top_cost||[]}
            groups={data?.top_groups_cost||[]}
            valueKey="cost"
            barColor="#22c55e"
            valueLabel={p => `${p.cost.toFixed(2)} €`}
            onItemClick={(item,mode)=>openDetail(item,mode)}/>
        </div>
      </Section>

      {/* Matériaux */}
      {matData.length > 0 && (
        <Section title="Matériaux utilisés">
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
            <Donut data={matData} title="Répartition par matériau (grammes)"/>
            <div className="card" style={{ padding:"14px 16px" }}>
              <p style={{ fontSize:13, fontWeight:700, color:"var(--text)", margin:"0 0 8px" }}>Détail</p>
              {matData.map(m => (
                <Bar key={m.name} label={m.name}
                  value={m.value} max={matData[0].value}
                  sublabel={`${(m.value/1000).toFixed(2)} kg`}
                  color="#3b82f6"/>
              ))}
            </div>
          </div>
        </Section>
      )}

      {/* Marques */}
      {brandData.length > 0 && (
        <Section title="Marques (grammes imprimés)">
          <div className="card" style={{ padding:"14px 16px" }}>
            {brandData.map(b => (
              <Bar key={b.name} label={b.name}
                value={b.value} max={brandData[0].value}
                sublabel={`${(b.value/1000).toFixed(2)} kg`}
                color="#8b5cf6"/>
            ))}
          </div>
        </Section>
      )}

      {/* Stock filaments */}
      <Section title="Stock & Filaments">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
          <KpiCard icon={Package}     label="Références"      value={filaments?.length}        color="#3b82f6"/>
          <KpiCard icon={Package}     label="En stock"        value={filsStock}                color="#22c55e"/>
          <KpiCard icon={Package}     label="Bobines actives" value={spoolsActive.length}      color="#8b5cf6"/>
          <KpiCard icon={Weight}      label="Poids en stock"  value={poidsStock>0?`${(poidsStock/1000).toFixed(2)} kg`:null} color="#f59e0b"/>
        </div>
      </Section>
    </div>
  );
}
