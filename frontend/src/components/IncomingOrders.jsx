import React, { useEffect, useState } from "react";
import client from "../api/client";
import { useIsAdmin } from "../store/auth";
import { egg } from "../eggs";

// « A venir » (28/10/2026) : les commandes Bambu Lab lues dans les mails dont des bobines ne sont pas encore
// arrivees, en tete de l'onglet Stock. Une ligne par bobine commandee, avec sa couleur quand le catalogue l'a
// reconnue ; une coche a la main quand la bobine est la sans avoir ete ajoutee par l'appli.
const ST = { confirmed: ["confirmée", "#3b82f6"], shipped: ["expédiée", "#f59e0b"], delivered: ["livrée", "#22c55e"], cancelled: ["annulée", "#94a3b8"] };
const day = iso => iso ? new Date(iso).toLocaleDateString("fr-FR", { day:"numeric", month:"short" }) : "";

export default function IncomingOrders() {
  const isAdmin = useIsAdmin();
  const [orders, setOrders] = useState(null);
  const [open, setOpen] = useState(true);
  const load = () => client.get("/filaments/incoming").then(r => setOrders(r.data.orders || [])).catch(() => setOrders([]));
  useEffect(() => { load(); }, []);
  const live = (orders || []).filter(o => o.status !== "cancelled" && o.pending > 0);
  useEffect(() => { if (live.length) egg("facteur"); }, [live.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!live.length) return null;
  const mark = async (o, i, received) => {
    try { const { data } = await client.post(`/filaments/incoming/${o.id}/mark`, { index: i, received }); setOrders(data.orders || []); }
    catch { /* rien */ }
  };
  const hide = async o => {
    try { const { data } = await client.post(`/filaments/incoming/${o.id}/mark`, { hide: true }); setOrders(data.orders || []); }
    catch { /* rien */ }
  };
  const total = live.reduce((n, o) => n + o.pending, 0);
  return (
    <div style={{ borderRadius:16, border:"1px solid color-mix(in srgb, #0EA5E9 35%, var(--border))", background:"color-mix(in srgb, #0EA5E9 6%, var(--surface))", overflow:"hidden" }}>
      <button type="button" onClick={() => setOpen(v => !v)} style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"10px 12px",
        border:"none", background:"transparent", cursor:"pointer", color:"var(--text)", textAlign:"left" }}>
        <span style={{ fontSize:18 }}>📬</span>
        <span style={{ fontWeight:800, fontSize:14, flex:1 }}>À venir · {total} bobine{total > 1 ? "s" : ""}</span>
        <span style={{ fontSize:11.5, fontWeight:700, color:"var(--muted)" }}>{live.length} commande{live.length > 1 ? "s" : ""} {open ? "▴" : "▾"}</span>
      </button>
      {open && <div style={{ display:"flex", flexDirection:"column", gap:8, padding:"0 12px 12px" }}>
        {live.map(o => { const [sl, sc] = ST[o.status] || [o.status, "#94a3b8"]; return (
          <div key={o.id} style={{ borderRadius:12, background:"var(--surface2)", border:"1px solid var(--border)", padding:"8px 10px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:12.5 }}>
              <span style={{ fontWeight:800 }}>Commande {o.order_no}</span>
              <span style={{ padding:"1px 8px", borderRadius:12, fontSize:11, fontWeight:800, color:"#fff", background:sc }}>{sl}{o.status === "shipped" && o.shipped_at ? ` le ${day(o.shipped_at)}` : o.ordered_at ? ` le ${day(o.ordered_at)}` : ""}</span>
              {o.tracking_url && <a href={o.tracking_url} target="_blank" rel="noreferrer" style={{ fontSize:11.5, fontWeight:700, color:"#0EA5E9" }}>suivi {o.carrier || ""} ↗</a>}
              <span style={{ flex:1 }}/>
              {isAdmin && <button type="button" onClick={() => hide(o)} data-tip="Ne plus montrer cette commande" style={{ border:"none", background:"none", color:"var(--muted)", cursor:"pointer", fontSize:12 }}>✕</button>}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:6 }}>
              {o.items.map((it, i) => { const left = Math.max(0, (it.qty || 0) - (it.received || 0)); const got = left === 0; return (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12.5, opacity: got ? 0.55 : 1 }}>
                  <span style={{ width:14, height:14, borderRadius:"50%", flexShrink:0, border:"1px solid var(--border)",
                    background: it.color_hex ? `#${it.color_hex}` : "repeating-linear-gradient(45deg, var(--surface) 0 3px, var(--border) 3px 6px)" }}/>
                  <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textDecoration: got ? "line-through" : "none" }}>
                    {it.kind === "filament" && it.name_fr ? `${it.fila_type || ""} · ${it.name_fr}${it.refill ? " (recharge)" : ""}` : it.title}
                    {it.kind === "filament" && !it.filament_id && it.name_fr && <span data-tip="Pas encore de fiche filament pour cette couleur : elle sera créée au scan de la bobine" style={{ marginLeft:6, fontSize:11, color:"var(--muted)" }}>·  nouvelle couleur</span>}
                  </span>
                  <span style={{ fontWeight:800, fontVariantNumeric:"tabular-nums" }}>{it.received ? `${it.received}/${it.qty}` : `×${it.qty}`}</span>
                  {isAdmin && it.kind === "filament" && (got
                    ? <button type="button" onClick={() => mark(o, i, false)} style={{ border:"none", background:"none", color:"var(--muted)", cursor:"pointer", fontSize:11, fontWeight:700 }}>annuler</button>
                    : <button type="button" onClick={() => mark(o, i, true)} data-tip="La bobine est là, sans passer par un ajout ou un scan"
                        style={{ border:"1px solid var(--border)", background:"var(--surface)", color:"var(--text)", cursor:"pointer", fontSize:11, fontWeight:800, padding:"2px 8px", borderRadius:10 }}>reçu</button>)}
                </div>); })}
            </div>
          </div>); })}
      </div>}
    </div>
  );
}
