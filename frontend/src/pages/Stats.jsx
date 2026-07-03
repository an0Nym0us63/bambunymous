import React, { useState, useEffect } from "react";
import { TrendingUp, Weight, Euro, Clock, Layers, Package, ShoppingBag } from "lucide-react";
import client from "../api/client";

function fmtH(s) { const h=Math.floor((s||0)/3600); const m=Math.floor(((s||0)%3600)/60); return h>0?`${h}h${m>0?` ${m}min`:""}`:m>0?`${m}min`:"—"; }

function KpiCard({ icon: Icon, label, value, sub, color="#3b82f6" }) {
  return (
    <div className="card" style={{ padding:"16px 18px", display:"flex", flexDirection:"column", gap:6 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ width:32, height:32, borderRadius:10, background:`${color}20`,
          display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <Icon size={16} style={{ color }}/>
        </div>
        <span style={{ fontSize:11, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</span>
      </div>
      <p style={{ fontSize:24, fontWeight:800, fontFamily:"JetBrains Mono,monospace",
        color:"var(--text)", margin:0, lineHeight:1 }}>{value ?? "—"}</p>
      {sub && <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>{sub}</p>}
    </div>
  );
}

export default function Stats() {
  const [prints, setPrints] = useState(null);
  const [filaments, setFilaments] = useState(null);
  const [spools, setSpools]  = useState(null);
  const [objects, setObjects] = useState(null);

  useEffect(() => {
    client.get("/prints/stats/summary").then(r => setPrints(r.data)).catch(()=>{});
    client.get("/filaments/filaments").then(r => setFilaments(r.data)).catch(()=>{});
    client.get("/filaments/spools", { params:{ archived:false } }).then(r => setSpools(r.data)).catch(()=>{});
    client.get("/objects/objects", { params:{ limit:1 } }).then(r => setObjects(r.data)).catch(()=>{});
  }, []);

  const spoolsActive = Array.isArray(spools) ? spools.filter(s=>!s.archived) : [];
  const poidsStock = spoolsActive.reduce((s,b)=>s+(b.remaining_weight_g??0),0);
  const valeurStock = spoolsActive.reduce((s,b)=>s+(b.price_override||b.filament_price||0),0);
  const filsAvecBobine = Array.isArray(filaments) ? filaments.filter(f=>(f.active_spool_count||0)>0).length : 0;

  return (
    <div style={{ maxWidth:900, margin:"0 auto", display:"flex", flexDirection:"column", gap:20 }}>
      <h1 style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Statistiques</h1>

      {/* Impressions */}
      <section>
        <p style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase",
          letterSpacing:"0.08em", margin:"0 0 10px" }}>Impressions</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:10 }}>
          <KpiCard icon={Layers}    label="Total"       value={prints?.total_prints}   color="#3b82f6"/>
          <KpiCard icon={TrendingUp} label="Succès"     value={prints?.success_prints} color="#22c55e"/>
          <KpiCard icon={Clock}     label="Temps total" value={fmtH((prints?.total_hours||0)*3600)} color="#f59e0b"/>
          <KpiCard icon={Weight}    label="Filament"    value={prints?.total_weight_g ? `${(prints.total_weight_g/1000).toFixed(2)} kg` : null} color="#8b5cf6"/>
          <KpiCard icon={Euro}      label="Coût total"  value={prints?.total_cost ? `${prints.total_cost.toFixed(2)} €` : null} color="#ef4444"/>
          <KpiCard icon={Euro}      label="Coût moyen"  value={prints?.success_prints && prints?.total_cost
            ? `${(prints.total_cost/prints.success_prints).toFixed(2)} €` : null} sub="par impression" color="#f97316"/>
        </div>
      </section>

      {/* Filaments */}
      <section>
        <p style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase",
          letterSpacing:"0.08em", margin:"0 0 10px" }}>Filaments & Stock</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:10 }}>
          <KpiCard icon={Package} label="Références"  value={filaments?.length}         color="#3b82f6"/>
          <KpiCard icon={Package} label="En stock"    value={filsAvecBobine}            color="#22c55e"/>
          <KpiCard icon={Package} label="Bobines actives" value={spoolsActive.length}   color="#8b5cf6"/>
          <KpiCard icon={Weight}  label="Poids stock" value={poidsStock>0?`${(poidsStock/1000).toFixed(2)} kg`:null} color="#f59e0b"/>
        </div>
      </section>

      {/* Objets */}
      {objects?.total > 0 && (
        <section>
          <p style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase",
            letterSpacing:"0.08em", margin:"0 0 10px" }}>Objets</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:10 }}>
            <KpiCard icon={ShoppingBag} label="Total objets" value={objects.total} color="#a78bfa"/>
          </div>
        </section>
      )}
    </div>
  );
}
