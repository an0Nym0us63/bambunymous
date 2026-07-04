import React, { useState, useEffect, useCallback } from "react";
import { Search, Package, ShoppingBag } from "lucide-react";
import client from "../api/client";

function fmtPrice(v) { return v != null ? `${Number(v).toFixed(2)} €` : "—"; }

// ── Accessory Card ────────────────────────────────────────────────────────
function AccessoryCard({ acc }) {
  return (
    <div className="card" style={{ padding:0, overflow:"hidden" }}>
      <div style={{ height:120, background:"var(--surface2)", display:"flex",
        alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
        {acc.has_image
          ? <img src={`/api/v1/objects/accessories/${acc.id}/image`} alt={acc.name}
              style={{ width:"100%", height:"100%", objectFit:"cover" }}
              onError={e => e.currentTarget.style.display="none"}/>
          : <Package size={36} style={{ color:"var(--muted)" }}/>}
      </div>
      <div style={{ padding:"10px 12px" }}>
        <p style={{ fontWeight:700, fontSize:13, color:"var(--text)", margin:"0 0 4px",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{acc.name}</p>
        <div style={{ display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:11, color:"var(--muted)" }}>
            Stock : <b style={{ color: acc.quantity > 0 ? "#22c55e" : "#ef4444" }}>{acc.quantity}</b>
          </span>
          <span style={{ fontSize:11, fontFamily:"monospace" }}>{fmtPrice(acc.unit_price)}/u</span>
        </div>
      </div>
    </div>
  );
}

// ── Object Detail Sheet ───────────────────────────────────────────────────
function ObjectSheet({ obj, onClose }) {
  if (!obj) return null;
  const isSold = obj.sold_price > 0;
  const rows = [
    ["Coût fabrication", fmtPrice(obj.cost_fabrication)],
    ["Coût accessoires", obj.cost_accessory > 0 ? fmtPrice(obj.cost_accessory) : null],
    ["Coût total",       fmtPrice(obj.cost_total)],
    ["Coût normal/u",    obj.normal_cost_unit ? fmtPrice(obj.normal_cost_unit) : null],
    ["Prix souhaité",    obj.desired_price ? fmtPrice(obj.desired_price) : null],
    ["Prix de vente",    obj.sold_price ? fmtPrice(obj.sold_price) : null],
    ["Marge",            obj.margin != null ? `${obj.margin.toFixed(1)} %` : null],
  ].filter(([,v]) => v);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:200, display:"flex", alignItems:"flex-end" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner" style={{ width:"100%", maxHeight:"85vh", overflowY:"auto", background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", padding:"20px 16px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
            <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)", margin:"8px auto 0", flex:1 }}/>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>
        <div style={{ display:"flex", gap:12, marginBottom:16 }}>
          <div style={{ width:72, height:72, borderRadius:12, overflow:"hidden",
            background:"var(--surface2)", flexShrink:0 }}>
            <img src={`/api/v1/objects/objects/${obj.id}/image`} alt=""
              style={{ width:"100%", height:"100%", objectFit:"cover" }}
              onError={e => e.currentTarget.style.display="none"}/>
          </div>
          <div>
            <p style={{ fontWeight:800, fontSize:16, color:"var(--text)", margin:"0 0 3px" }}>
              {obj.translated_name || obj.name}
            </p>
            {isSold && <span style={{ fontSize:10, background:"rgba(34,197,94,0.12)",
              color:"#22c55e", padding:"2px 8px", borderRadius:20, fontWeight:700 }}>
              Vendu {fmtPrice(obj.sold_price)}
            </span>}
            {obj.personal && <span style={{ fontSize:10, background:"rgba(168,85,247,0.12)",
              color:"#a78bfa", padding:"2px 8px", borderRadius:20, fontWeight:700, marginLeft:4 }}>Perso</span>}
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:14 }}>
          {rows.map(([label, val]) => (
            <div key={label} style={{ padding:"8px 10px", borderRadius:10,
              background: label==="Coût total" ? "rgba(59,130,246,0.06)" : label==="Prix de vente" ? "rgba(34,197,94,0.06)" : "var(--surface2)",
              border:`1px solid ${label==="Coût total" ? "rgba(59,130,246,0.2)" : label==="Prix de vente" ? "rgba(34,197,94,0.2)" : "var(--border)"}`,
              gridColumn: label==="Coût total"||label==="Prix de vente" ? "1/-1" : "auto",
            }}>
              <p style={{ fontSize:9, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 2px" }}>{label}</p>
              <p style={{ fontSize:13, fontWeight:700, fontFamily:"monospace", color:"var(--text)", margin:0 }}>{val}</p>
            </div>
          ))}
        </div>
        {obj.accessories?.length > 0 && (<>
          <p style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:"0 0 8px" }}>Accessoires</p>
          {obj.accessories.map(a => (
            <div key={a.id} style={{ display:"flex", justifyContent:"space-between", padding:"6px 10px",
              borderRadius:8, background:"var(--surface2)", border:"1px solid var(--border)", marginBottom:4 }}>
              <span style={{ fontSize:12, color:"var(--text)" }}>{a.name} × {a.quantity}</span>
              <span style={{ fontSize:12, fontFamily:"monospace", color:"var(--muted)" }}>{fmtPrice(a.total)}</span>
            </div>
          ))}
        </>)}
        {obj.comment && <p style={{ fontSize:12, color:"var(--muted)", fontStyle:"italic", marginTop:8 }}>{obj.comment}</p>}
      </div>
    </div>
  );
}

// ── Object Card (standalone) ──────────────────────────────────────────────
function ObjectCard({ obj, onClick }) {
  const isSold = obj.sold_price > 0;
  return (
    <div className="card" onClick={onClick} style={{ padding:0, overflow:"hidden", cursor:"pointer", position:"relative",
      opacity: !obj.available && !isSold ? 0.6 : 1 }}>
      <div style={{ position:"relative", height:130, background:"var(--surface2)",
        display:"flex", alignItems:"center", justifyContent:"center" }}>
        <img src={`/api/v1/objects/objects/${obj.id}/image`} alt=""
          style={{ width:"100%", height:"100%", objectFit:"cover" }}
          onError={e => e.currentTarget.style.display="none"}/>
        {isSold && <span style={{ position:"absolute", top:6, right:6,
          background:"rgba(34,197,94,0.85)", color:"white",
          fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20 }}>Vendu</span>}
        {obj.personal && <span style={{ position:"absolute", top:6, left:6,
          background:"rgba(168,85,247,0.85)", color:"white",
          fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20 }}>Perso</span>}
      </div>
      <div style={{ padding:"8px 10px" }}>
        <p style={{ fontWeight:700, fontSize:12, color:"var(--text)", margin:"0 0 3px",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {obj.translated_name || obj.name}
        </p>
        <div style={{ display:"flex", gap:6, justifyContent:"space-between" }}>
          <span style={{ fontSize:10, color:"var(--muted)" }}>{fmtPrice(obj.cost_total)}</span>
          {obj.desired_price && <span style={{ fontSize:10, color:"#22c55e", fontFamily:"monospace" }}>{fmtPrice(obj.desired_price)}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Object Group Sheet ────────────────────────────────────────────────────
function ObjectGroupSheet({ group, objects, onClose, onSelectObj }) {
  const totalCost = objects.reduce((s,o) => s+(o.cost_total||0), 0);
  const soldCount = objects.filter(o => o.sold_price > 0).length;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:200, display:"flex", alignItems:"flex-end" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner" style={{ width:"100%", maxHeight:"88vh", overflowY:"auto", background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", padding:"20px 16px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
            <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)", margin:"8px auto 0", flex:1 }}/>
          <button onClick={onClose} style={{ position:"absolute", top:12, right:12, width:28, height:28, borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
          <div>
            <p style={{ fontWeight:800, fontSize:16, color:"#a78bfa", margin:"0 0 4px" }}>{group.name}</p>
            <p style={{ fontSize:12, color:"var(--muted)", margin:0 }}>
              {objects.length} objet{objects.length!==1?"s":""} · {fmtPrice(totalCost)}
              {soldCount > 0 && ` · ${soldCount} vendu${soldCount>1?"s":""}`}
            </p>
          </div>
          {group.desired_price && (
            <span style={{ fontSize:12, fontFamily:"monospace", color:"#22c55e",
              background:"rgba(34,197,94,0.1)", padding:"4px 10px", borderRadius:20 }}>
              Prix souhaité : {fmtPrice(group.desired_price)}
            </span>
          )}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:8 }}>
          {objects.map(o => <ObjectCard key={o.id} obj={o} onClick={() => { onClose(); onSelectObj(o); }}/>)}
        </div>
      </div>
    </div>
  );
}

// ── Object Group Tile ─────────────────────────────────────────────────────
function ObjectGroupTile({ group, objects }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const cover = objects[0];
  const soldCount = objects.filter(o => o.sold_price > 0).length;
  return (<>
    <div className="card" onClick={() => setOpen(true)}
      style={{ padding:0, overflow:"hidden", cursor:"pointer", position:"relative" }}>
      <div style={{ position:"relative", height:130, background:"var(--surface2)",
        display:"flex", alignItems:"center", justifyContent:"center" }}>
        {cover && <img src={`/api/v1/objects/objects/${cover.id}/image`} alt=""
          style={{ width:"100%", height:"100%", objectFit:"cover" }}
          onError={e => e.currentTarget.style.display="none"}/>}
        <div style={{ position:"absolute", inset:0, background:"rgba(167,139,250,0.12)" }}/>
        <span style={{ position:"absolute", top:6, left:6, background:"rgba(167,139,250,0.85)",
          color:"white", fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20 }}>
          📁 {objects.length}
        </span>
        {soldCount > 0 && <span style={{ position:"absolute", top:6, right:6,
          background:"rgba(34,197,94,0.85)", color:"white",
          fontSize:9, fontWeight:800, padding:"2px 7px", borderRadius:20 }}>
          {soldCount} vendu{soldCount>1?"s":""}
        </span>}
      </div>
      <div style={{ padding:"8px 10px" }}>
        <p style={{ fontWeight:700, fontSize:12, color:"#a78bfa", margin:"0 0 2px",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{group.name}</p>
        {group.desired_price && <p style={{ fontSize:10, color:"#22c55e", margin:0, fontFamily:"monospace" }}>{fmtPrice(group.desired_price)}</p>}
      </div>
    </div>
    {open && <ObjectGroupSheet group={group} objects={objects} onClose={() => setOpen(false)}
      onSelectObj={o => setSelected(o)}/>}
    {selected && <ObjectSheet obj={selected} onClose={() => setSelected(null)}/>}
  </>);
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function Objects() {
  const [tab, setTab] = useState("objects");
  const [q, setQ] = useState("");
  const [objects, setObjects] = useState([]);
  const [accessories, setAccessories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("all");

  const loadObjects = useCallback(async () => {
    setLoading(true);
    try {
      const params = { q: q||undefined, limit:500 };
      if (filter === "available") params.available = true;
      if (filter === "sold") params.sold = true;
      if (filter === "personal") params.personal = true;
      const { data } = await client.get("/objects/objects", { params });
      setObjects(data.items || []);
    } catch(e) { console.error(e); } finally { setLoading(false); }
  }, [q, filter]);

  const loadAccessories = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await client.get("/objects/accessories", { params: { q: q||undefined } });
      setAccessories(data || []);
    } catch(e) { console.error(e); } finally { setLoading(false); }
  }, [q]);

  useEffect(() => {
    if (tab === "objects") loadObjects(); else loadAccessories();
  }, [tab, q, filter]);

  const FILTERS = [["all","Tous"],["available","Disponibles"],["sold","Vendus"],["personal","Perso"]];

  // Séparer objets groupés vs solo — comme les prints
  const grouped = {};
  const solo = [];
  for (const o of objects) {
    if (o.group_id) { (grouped[o.group_id] = grouped[o.group_id] || { name: o.group_name, desired_price: null, items: [] }).items.push(o); }
    else solo.push(o);
  }
  // Items pour la grille : groupes d'abord puis solos — comme galerie prints
  const gridItems = [
    ...Object.entries(grouped).map(([gid, g]) => ({ kind:"group", group_id:Number(gid), group:g, objects:g.items })),
    ...solo.map(o => ({ kind:"object", obj:o })),
  ];

  return (
    <div style={{ maxWidth:900, margin:"0 auto", display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <h1 style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Objets & Accessoires</h1>
        <div style={{ marginLeft:"auto", display:"flex", gap:2, background:"var(--surface2)",
          borderRadius:10, padding:3, border:"1px solid var(--border)" }}>
          {[["objects","Objets"],["accessories","Accessoires"]].map(([id,label]) => (
            <button key={id} onClick={() => { setTab(id); setQ(""); }}
              style={{ padding:"5px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:"none",
                background:tab===id?"var(--text)":"transparent", color:tab===id?"var(--bg)":"var(--muted)" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ position:"relative", flex:1, minWidth:160 }}>
          <Search size={13} style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"var(--muted)" }}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher…"
            style={{ width:"100%", paddingLeft:32, padding:"7px 10px 7px 32px",
              background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
              fontSize:12, color:"var(--text)", outline:"none", boxSizing:"border-box" }}/>
        </div>
        {tab === "objects" && FILTERS.map(([id,label]) => (
          <button key={id} onClick={() => setFilter(id)}
            style={{ padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:"none",
              background:filter===id?"#3b82f6":"var(--surface2)", color:filter===id?"white":"var(--muted)" }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <p style={{ textAlign:"center", color:"var(--muted)", padding:40 }}>Chargement…</p>
      : tab === "objects" ? (
        gridItems.length === 0
          ? <p style={{ textAlign:"center", color:"var(--muted)", padding:40 }}>Aucun objet</p>
          : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
              {gridItems.map(item => item.kind === "group"
                ? <ObjectGroupTile key={`g${item.group_id}`} group={item.group} objects={item.objects}/>
                : <ObjectCard key={item.obj.id} obj={item.obj} onClick={() => setSelected(item.obj)}/>
              )}
            </div>
      ) : (
        accessories.length === 0
          ? <p style={{ textAlign:"center", color:"var(--muted)", padding:40 }}>Aucun accessoire</p>
          : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
              {accessories.map(a => <AccessoryCard key={a.id} acc={a}/>)}
            </div>
      )}

      {selected && <ObjectSheet obj={selected} onClose={() => setSelected(null)}/>}
    </div>
  );
}
