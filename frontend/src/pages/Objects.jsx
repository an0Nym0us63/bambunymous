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
function ObjectSheet({ obj, onClose, onUpdated }) {
  if (!obj) return null;
  const [accessories, setAccessories] = React.useState([]);
  const [addingAcc, setAddingAcc] = React.useState(false);
  const [allAccs, setAllAccs] = React.useState([]);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    client.get(`/objects/objects/${obj.id}/accessories`).then(r=>setAccessories(r.data)).catch(()=>{});
  }, [obj.id]);

  const isSold = obj.sold_price > 0;

  const openAddAcc = async () => {
    const r = await client.get("/objects/accessories");
    setAllAccs(r.data); setAddingAcc(true);
  };

  const linkAcc = async (acc) => {
    const qty = parseInt(prompt(`Lier "${acc.name}" à cet objet — quelle quantité ?`, "1"));
    if (!qty || isNaN(qty)) return;
    await client.post(`/objects/objects/${obj.id}/accessories`, { accessory_id: acc.id, qty });
    const r = await client.get(`/objects/objects/${obj.id}/accessories`);
    setAccessories(r.data); setAddingAcc(false); onUpdated?.();
  };

  const unlinkAcc = async (aid) => {
    await client.delete(`/objects/objects/${obj.id}/accessories/${aid}`);
    setAccessories(a => a.filter(x => x.accessory_id !== aid));
    onUpdated?.();
  };

  const markSold = async () => {
    const price = parseFloat(prompt("Prix de vente (€) :", obj.sold_price || (obj.cost_total||0).toFixed(2)));
    if (isNaN(price)) return;
    await client.patch(`/objects/objects/${obj.id}`, { sold_price: price, available: false });
    onUpdated?.();
  };

  const handleDelete = async () => {
    if (!confirm(`Supprimer "${obj.name}" ?`)) return;
    await client.delete(`/objects/objects/${obj.id}`);
    onClose(); onUpdated?.();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:200, display:"flex", alignItems:"flex-end" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="sheet-inner"
        style={{ width:"100%", maxHeight:"90vh", overflowY:"auto", background:"var(--sheet-bg)",
          borderRadius:"20px 20px 0 0", padding:"0 16px 24px", position:"relative" }}>

        {/* Handle + ✕ */}
        <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 8px" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)" }}/>
          <button onClick={onClose} style={{ position:"absolute", top:10, right:12, width:28, height:28,
            borderRadius:"50%", background:"var(--surface2)", border:"none", cursor:"pointer",
            color:"var(--muted)", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>

        {/* Header */}
        <div style={{ display:"flex", gap:12, marginBottom:14 }}>
          <img src={`/api/v1/objects/objects/${obj.id}/image`} alt=""
            style={{ width:72, height:72, borderRadius:10, objectFit:"cover", flexShrink:0, background:"var(--surface2)" }}
            onError={e=>e.currentTarget.style.display="none"}/>
          <div>
            <h2 style={{ fontSize:16, fontWeight:800, color:"var(--text)", margin:"0 0 4px" }}>
              {obj.translated_name || obj.name}
            </h2>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {isSold && <span style={{ fontSize:10, background:"rgba(34,197,94,0.12)", color:"#22c55e", padding:"2px 8px", borderRadius:20, fontWeight:700 }}>Vendu {fmtPrice(obj.sold_price)}</span>}
              {!obj.available && !isSold && <span style={{ fontSize:10, background:"rgba(239,68,68,0.1)", color:"#ef4444", padding:"2px 8px", borderRadius:20 }}>Non disponible</span>}
              {obj.personal && <span style={{ fontSize:10, background:"rgba(168,85,247,0.1)", color:"#a78bfa", padding:"2px 8px", borderRadius:20 }}>Perso</span>}
            </div>
          </div>
        </div>

        {/* Coûts */}
        <div style={{ background:"linear-gradient(135deg,rgba(59,130,246,0.06),rgba(139,92,246,0.06))",
          border:"1px solid rgba(59,130,246,0.15)", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            {[["Fabrication", obj.cost_fabrication], ["Accessoires", obj.cost_accessory],
              ["Prix désiré", obj.desired_price], ["Normal/u", obj.normal_cost_unit]
            ].filter(([,v])=>v>0).map(([l,v])=>(
              <div key={l} style={{ padding:"6px 10px", borderRadius:8, background:"var(--surface2)" }}>
                <p style={{ fontSize:9, color:"var(--muted)", margin:"0 0 2px" }}>{l}</p>
                <p style={{ fontSize:12, fontWeight:700, color:"var(--text)", margin:0, fontFamily:"monospace" }}>{fmtPrice(v)}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop:8, padding:"8px 10px", borderRadius:8,
            background:"rgba(59,130,246,0.1)", border:"1px solid rgba(59,130,246,0.2)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:10, color:"#60a5fa", fontWeight:700 }}>TOTAL</span>
              <span style={{ fontSize:18, fontWeight:900, color:"var(--text)", fontFamily:"monospace" }}>{fmtPrice(obj.cost_total)}</span>
            </div>
            {isSold && (
              <div style={{ marginTop:4, display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:10, color:"#22c55e" }}>Vendu</span>
                <span style={{ fontSize:14, fontWeight:700, color:"#22c55e", fontFamily:"monospace" }}>
                  {fmtPrice(obj.sold_price)}
                  {obj.sold_price > 0 && obj.cost_total > 0 &&
                    <span style={{ fontSize:10, marginLeft:6 }}>({((obj.sold_price/obj.cost_total-1)*100).toFixed(0)}%)</span>}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Accessoires associés */}
        <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em", margin:0 }}>Accessoires</p>
            <button onClick={openAddAcc}
              style={{ fontSize:11, padding:"2px 10px", borderRadius:20, border:"1px solid var(--border)",
                background:"var(--surface2)", color:"var(--text)", cursor:"pointer" }}>+ Ajouter</button>
          </div>
          {accessories.length === 0 && <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>Aucun accessoire</p>}
          {accessories.map(a => (
            <div key={a.accessory_id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px",
              background:"var(--surface2)", borderRadius:8, marginBottom:5, border:"1px solid var(--border)" }}>
              <span style={{ fontSize:12, flex:1 }}>{a.name}</span>
              <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>×{a.qty}</span>
              <span style={{ fontSize:11, color:"var(--text)", fontFamily:"monospace" }}>{fmtPrice(a.unit_price * a.qty)}</span>
              <button onClick={()=>unlinkAcc(a.accessory_id)}
                style={{ width:18, height:18, borderRadius:"50%", background:"rgba(239,68,68,0.1)",
                  border:"none", cursor:"pointer", color:"#ef4444", fontSize:12 }}>✕</button>
            </div>
          ))}
        </div>

        {/* Commentaire */}
        {obj.comment && <p style={{ fontSize:12, color:"var(--muted)", marginBottom:14, fontStyle:"italic" }}>{obj.comment}</p>}

        {/* Actions */}
        <div style={{ display:"flex", gap:8 }}>
          {!isSold && <button onClick={markSold}
            style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid rgba(34,197,94,0.3)",
              background:"rgba(34,197,94,0.06)", color:"#22c55e", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            💰 Marquer vendu
          </button>}
          <button onClick={handleDelete}
            style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid rgba(239,68,68,0.3)",
              background:"rgba(239,68,68,0.06)", color:"#ef4444", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            🗑 Supprimer
          </button>
          <button onClick={onClose}
            style={{ flex:2, padding:"10px", borderRadius:10, border:"none",
              background:"#3b82f6", color:"white", fontSize:13, fontWeight:700, cursor:"pointer" }}>✕</button>
        </div>
      </div>

      {/* Picker accessoire */}
      {addingAcc && (
        <div style={{ position:"fixed", inset:0, zIndex:300, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"flex-end" }}
          onClick={()=>setAddingAcc(false)}>
          <div onClick={e=>e.stopPropagation()} className="sheet-inner"
            style={{ width:"100%", background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0",
              padding:"16px 16px 32px", maxHeight:"60vh", overflowY:"auto" }}>
            <p style={{ fontWeight:700, fontSize:14, margin:"0 0 12px" }}>Choisir un accessoire</p>
            {allAccs.map(a => (
              <button key={a.id} onClick={()=>linkAcc(a)}
                style={{ width:"100%", padding:"10px 12px", marginBottom:6, textAlign:"left",
                  background:"var(--surface2)", border:"1px solid var(--border)",
                  borderRadius:8, cursor:"pointer", color:"var(--text)", fontSize:13 }}>
                {a.name} — {a.quantity} en stock · {fmtPrice(a.unit_price)}/u
              </button>
            ))}
            {allAccs.length === 0 && <p style={{ color:"var(--muted)", fontSize:12 }}>Aucun accessoire disponible</p>}
          </div>
        </div>
      )}
    </div>
  );
}

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
