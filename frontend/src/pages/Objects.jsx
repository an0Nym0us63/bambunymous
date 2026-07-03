import React, { useState, useEffect, useCallback } from "react";
import { Search, Package, ShoppingBag, Tag, ChevronRight } from "lucide-react";
import client from "../api/client";

const TAB_LABELS = [
  { id: "objects",     label: "Objets" },
  { id: "accessories", label: "Accessoires" },
];

function fmtPrice(v) { return v != null ? `${Number(v).toFixed(2)} €` : "—"; }

// ── Accessory Card ─────────────────────────────────────────────────────────
function AccessoryCard({ acc }) {
  const imgUrl = `/api/v1/objects/accessories/${acc.id}/image`;
  return (
    <div className="card" style={{ padding:0, overflow:"hidden" }}>
      <div style={{ height:120, background:"var(--surface2)", display:"flex",
        alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
        {acc.has_image
          ? <img src={imgUrl} alt={acc.name} style={{ width:"100%", height:"100%", objectFit:"cover" }}
              onError={e => { e.currentTarget.style.display="none"; }}/>
          : <Package size={36} style={{ color:"var(--muted)" }}/>
        }
      </div>
      <div style={{ padding:"10px 12px" }}>
        <p style={{ fontWeight:700, fontSize:13, color:"var(--text)", margin:"0 0 4px",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{acc.name}</p>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:11, color:"var(--muted)" }}>
            Stock : <b style={{ color: acc.quantity > 0 ? "#22c55e" : "#ef4444" }}>{acc.quantity}</b>
          </span>
          <span style={{ fontSize:11, fontFamily:"monospace", color:"var(--text)" }}>
            {fmtPrice(acc.unit_price)}/u
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Object Card ───────────────────────────────────────────────────────────
function ObjectCard({ obj, onClick }) {
  const isSold = obj.sold_price > 0;
  return (
    <div className="card" onClick={onClick} style={{ padding:0, overflow:"hidden", cursor:"pointer",
      opacity: !obj.available ? 0.6 : 1 }}>
      <div style={{ position:"relative", height:130, background:"var(--surface2)",
        display:"flex", alignItems:"center", justifyContent:"center" }}>
        {obj.thumbnail
          ? <img src={`/api/v1/objects/objects/${obj.id}/image`} alt={obj.name}
              style={{ width:"100%", height:"100%", objectFit:"cover" }}
              onError={e => { e.currentTarget.style.display="none"; }}/>
          : <ShoppingBag size={36} style={{ color:"var(--muted)" }}/>
        }
        {isSold && (
          <span style={{ position:"absolute", top:6, right:6,
            background:"rgba(34,197,94,0.85)", color:"white",
            fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20 }}>
            Vendu {fmtPrice(obj.sold_price)}
          </span>
        )}
        {obj.personal && (
          <span style={{ position:"absolute", top:6, left:6,
            background:"rgba(168,85,247,0.85)", color:"white",
            fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:20 }}>
            Perso
          </span>
        )}
      </div>
      <div style={{ padding:"8px 10px" }}>
        <p style={{ fontWeight:700, fontSize:12, color:"var(--text)", margin:"0 0 2px",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {obj.translated_name || obj.name}
        </p>
        {obj.group_name && (
          <p style={{ fontSize:10, color:"#a78bfa", margin:"0 0 4px",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            📁 {obj.group_name}
          </p>
        )}
        <div style={{ display:"flex", gap:8, justifyContent:"space-between" }}>
          <span style={{ fontSize:10, color:"var(--muted)" }}>
            Total : <b style={{ fontFamily:"monospace", color:"var(--text)" }}>{fmtPrice(obj.cost_total)}</b>
          </span>
          {obj.desired_price && (
            <span style={{ fontSize:10, color:"var(--muted)" }}>
              Prix : <b style={{ fontFamily:"monospace", color:"#22c55e" }}>{fmtPrice(obj.desired_price)}</b>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Object Detail Sheet ───────────────────────────────────────────────────
function ObjectSheet({ obj, onClose }) {
  if (!obj) return null;
  const rows = [
    ["Coût fabrication", fmtPrice(obj.cost_fabrication)],
    ["Coût accessoires", fmtPrice(obj.cost_accessory)],
    ["Coût total",       fmtPrice(obj.cost_total)],
    ["Coût normal/u",    obj.normal_cost_unit ? fmtPrice(obj.normal_cost_unit) : null],
    ["Prix souhaité",    obj.desired_price ? fmtPrice(obj.desired_price) : null],
    ["Prix de vente",    obj.sold_price ? fmtPrice(obj.sold_price) : null],
    ["Marge",            obj.margin != null ? `${obj.margin.toFixed(1)} %` : null],
  ].filter(([,v]) => v);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:200, display:"flex", alignItems:"flex-end" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ width:"100%", maxHeight:"85vh", overflowY:"auto",
        background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", padding:"20px 16px" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)",
          margin:"0 auto 16px" }}/>
        <p style={{ fontWeight:800, fontSize:16, color:"var(--text)", margin:"0 0 4px" }}>
          {obj.translated_name || obj.name}
        </p>
        {obj.group_name && <p style={{ fontSize:12, color:"#a78bfa", margin:"0 0 16px" }}>📁 {obj.group_name}</p>}

        {/* Coûts */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:16 }}>
          {rows.map(([label, val]) => (
            <div key={label} style={{ padding:"8px 10px", borderRadius:10,
              background:"var(--surface2)", border:"1px solid var(--border)",
              ...(label === "Coût total" ? { gridColumn:"1/-1", background:"rgba(59,130,246,0.06)" } : {}),
              ...(label === "Prix de vente" ? { gridColumn:"1/-1", background:"rgba(34,197,94,0.06)" } : {}),
            }}>
              <p style={{ fontSize:9, color:"var(--muted)", textTransform:"uppercase",
                letterSpacing:"0.06em", margin:"0 0 2px" }}>{label}</p>
              <p style={{ fontSize:13, fontWeight:700, fontFamily:"monospace",
                color:"var(--text)", margin:0 }}>{val}</p>
            </div>
          ))}
        </div>

        {/* Accessoires */}
        {obj.accessories?.length > 0 && (
          <>
            <p style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase",
              letterSpacing:"0.06em", margin:"0 0 8px" }}>Accessoires</p>
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
              {obj.accessories.map(a => (
                <div key={a.id} style={{ display:"flex", justifyContent:"space-between",
                  padding:"6px 10px", borderRadius:8, background:"var(--surface2)",
                  border:"1px solid var(--border)" }}>
                  <span style={{ fontSize:12, color:"var(--text)" }}>{a.name} × {a.quantity}</span>
                  <span style={{ fontSize:12, fontFamily:"monospace", color:"var(--muted)" }}>
                    {fmtPrice(a.total)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {obj.comment && (
          <p style={{ fontSize:12, color:"var(--muted)", fontStyle:"italic", marginTop:8 }}>{obj.comment}</p>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function Objects() {
  const [tab, setTab] = useState("objects");
  const [q, setQ] = useState("");
  const [objects, setObjects] = useState([]);
  const [accessories, setAccessories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("all"); // all / available / sold / personal
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState(null);

  useEffect(() => {
    client.get("/objects/object-groups").then(r => setGroups(r.data || [])).catch(()=>{});
  }, []);

  const loadObjects = useCallback(async () => {
    setLoading(true);
    try {
      const params = { q: q || undefined, limit: 200 };
      if (groupId) params.group_id = groupId;
      if (filter === "available") params.available = true;
      if (filter === "sold") params.sold = true;
      if (filter === "personal") params.personal = true;
      const { data } = await client.get("/objects/objects", { params });
      setObjects(data.items || []);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [q, filter, groupId]);

  const loadAccessories = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await client.get("/objects/accessories", { params: { q: q || undefined } });
      setAccessories(data || []);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [q]);

  useEffect(() => {
    if (tab === "objects") loadObjects();
    else loadAccessories();
  }, [tab, q, filter, groupId]);

  const FILTERS = [["all","Tous"],["available","Disponibles"],["sold","Vendus"],["personal","Perso"]];

  return (
    <div style={{ maxWidth:900, margin:"0 auto", display:"flex", flexDirection:"column", gap:12 }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <h1 style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0 }}>Objets & Accessoires</h1>
        <div style={{ marginLeft:"auto", display:"flex", gap:2, background:"var(--surface2)",
          borderRadius:10, padding:3, border:"1px solid var(--border)" }}>
          {TAB_LABELS.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setQ(""); }}
              style={{ padding:"5px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:"none",
                background: tab===t.id ? "var(--text)" : "transparent",
                color: tab===t.id ? "var(--bg)" : "var(--muted)" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Barre filtres */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ position:"relative", flex:1, minWidth:160 }}>
          <Search size={13} style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"var(--muted)" }}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Rechercher…"
            style={{ width:"100%", paddingLeft:32, padding:"7px 10px 7px 32px",
              background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
              fontSize:12, color:"var(--text)", outline:"none", boxSizing:"border-box" }}/>
        </div>
        {tab === "objects" && groups.length > 0 && (
          <select value={groupId || ""} onChange={e => setGroupId(e.target.value ? Number(e.target.value) : null)}
            style={{ padding:"5px 10px", borderRadius:8, fontSize:11, fontWeight:600, cursor:"pointer",
              background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}>
            <option value="">Tous les groupes</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        {tab === "objects" && FILTERS.map(([id,label]) => (
          <button key={id} onClick={() => setFilter(id)}
            style={{ padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:"none",
              background: filter===id ? "#3b82f6" : "var(--surface2)",
              color: filter===id ? "white" : "var(--muted)" }}>
            {label}
          </button>
        ))}
      </div>

      {/* Contenu */}
      {loading ? (
        <p style={{ textAlign:"center", color:"var(--muted)", padding:40 }}>Chargement…</p>
      ) : tab === "objects" ? (
        objects.length === 0
          ? <p style={{ textAlign:"center", color:"var(--muted)", padding:40 }}>Aucun objet</p>
          : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
              {objects.map(o => <ObjectCard key={o.id} obj={o} onClick={() => setSelected(o)}/>)}
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
