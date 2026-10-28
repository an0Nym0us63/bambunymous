import React, { useEffect, useState } from "react";
import client from "../api/client";
import { useIsAdmin } from "../store/auth";
import { egg } from "../eggs";

// « A venir » (28/10/2026) : les commandes Bambu Lab lues dans les mails dont des bobines ne sont pas encore
// arrivees, en tete de l'onglet Stock. Une ligne par bobine commandee, avec sa couleur quand le catalogue l'a
// reconnue ; une coche a la main quand la bobine est la sans avoir ete ajoutee par l'appli.
import { FSheet, fBtn } from "./FicheKit";

const ST = { confirmed: ["confirmée", "#3b82f6"], shipped: ["expédiée", "#f59e0b"], delivered: ["livrée", "#22c55e"], cancelled: ["annulée", "#94a3b8"] };
const day = iso => iso ? new Date(iso).toLocaleDateString("fr-FR", { day:"numeric", month:"short" }) : "";
const dayY = iso => iso ? new Date(iso).toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" }) : "";

// les trois etapes : commandee -> en livraison -> livree
function Steps({ stage, size = 12 }) {
  const idx = ["ordered", "shipping", "delivered"].indexOf(stage);
  return <span data-tip="Commandée → en livraison → livrée (livrée aussi quand toutes les bobines sont reçues, à la main ou au scan)"
    style={{ display:"inline-flex", alignItems:"center", gap:3 }}>
    {[["ordered", "📬"], ["shipping", "🚚"], ["delivered", "📦"]].map(([k, e], i) => { const on = i <= idx;
      return <span key={k} style={{ display:"inline-flex", alignItems:"center", gap:3 }}>
        {i > 0 && <span style={{ width:10, height:2, borderRadius:1, background: on ? "#0EA5E9" : "var(--border)" }}/>}
        <span style={{ fontSize:size, filter: on ? "none" : "grayscale(1)", opacity: on ? 1 : 0.4 }}>{e}</span></span>; })}
  </span>;
}

// l'etat d'une ligne, en clair
function lineState(it) {
  const qty = it.qty || 0, rec = it.received || 0, left = Math.max(0, qty - rec);
  if (it.kind !== "filament") return ["", "var(--muted)"];
  if (it.confirmed && !left) return ["reçue, confirmée", "#22c55e"];
  if (it.assumed) return [`présumée reçue (commande ancienne)${it.auto ? `, ${it.auto} retrouvée${it.auto > 1 ? "s" : ""} par la date d'ajout` : ""} · à confirmer`, "#f59e0b"];
  if (!left) return [it.auto ? "reçue (bobine ajoutée après la commande)" : "reçue", "#22c55e"];
  if (rec) return [`${rec} reçue${rec > 1 ? "s" : ""}, ${left} attendue${left > 1 ? "s" : ""}`, "#0EA5E9"];
  return ["attendue", "#0EA5E9"];
}

/** La fenetre d'une commande : depuis la carte, ou depuis une notification (/filaments?order=ID). */
export function OrderSheet({ id, order: given = null, onClose, onChanged }) {
  const isAdmin = useIsAdmin();
  const [o, setO] = useState(given);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!given) client.get(`/filaments/incoming/${id}`).then(r => setO(r.data)).catch(() => setO({ missing: true })); }, [id, given]);
  const act = async body => {
    setBusy(true);
    try { const { data } = await client.post(`/filaments/incoming/${id}/mark`, body); if (data.order) setO(data.order); onChanged?.(data.orders || []); }
    catch { /* rien */ }
    setBusy(false);
  };
  if (!o) return null;
  if (o.missing) return <FSheet onClose={onClose} z={3000}><p style={{ padding:40, textAlign:"center", color:"var(--muted)" }}>Commande introuvable.</p></FSheet>;
  const [sl, sc] = ST[o.status] || [o.status, "#94a3b8"];
  const fil = o.items.filter(i => i.kind === "filament"), other = o.items.filter(i => i.kind !== "filament");
  return (
    <FSheet onClose={onClose} z={3000} bottom={isAdmin ? <>
      {o.to_confirm > 0 && <button onClick={() => act({ confirm: true })} disabled={busy} style={{ ...fBtn, flex:1, background:"#22c55e", color:"#fff", border:"none" }}>✓ Tout est bien là</button>}
      <button onClick={() => act({ hide: !o.hidden })} disabled={busy} style={{ ...fBtn, flex: o.to_confirm > 0 ? 0 : 1 }}>{o.hidden ? "Remontrer" : "Cacher"}</button>
    </> : null}>
      <div style={{ padding:"18px 16px 12px" }}>
        <div style={{ fontSize:28 }}>📬</div>
        <h2 style={{ margin:"4px 0 6px", fontSize:19, fontWeight:900, color:"var(--text)" }}>Commande {o.order_no}</h2>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:12.5, color:"var(--text2)" }}>
          <span style={{ padding:"2px 9px", borderRadius:12, fontSize:11.5, fontWeight:800, color:"#fff", background:sc }}>{sl}</span>
          <Steps stage={o.stage} size={14}/>
          {o.store && <span style={{ color:"var(--muted)" }}>{o.store}</span>}
        </div>
        <div style={{ marginTop:8, fontSize:12.5, color:"var(--muted)", display:"flex", flexDirection:"column", gap:2 }}>
          {o.ordered_at && <span>Commandée le {dayY(o.ordered_at)}</span>}
          {o.shipped_at && <span>Expédiée le {dayY(o.shipped_at)}{o.carrier ? ` · ${o.carrier}` : ""}{o.tracking_url && <> · <a href={o.tracking_url} target="_blank" rel="noreferrer" style={{ color:"#0EA5E9", fontWeight:700 }}>suivi ↗</a></>}</span>}
          {o.delivered_at && <span>Livrée le {dayY(o.delivered_at)}</span>}
        </div>
        {o.to_confirm > 0 && <div style={{ marginTop:10, padding:"8px 10px", borderRadius:10, background:"color-mix(in srgb, #f59e0b 12%, var(--surface2))",
          border:"1px solid color-mix(in srgb, #f59e0b 40%, transparent)", fontSize:12.5, color:"var(--text)" }}>
          Commande ancienne lue après coup : ce que la date d'ajout des bobines explique est coché, le reste est <b>présumé reçu</b>.
          Confirme, ou remets une ligne en attendue si elle manque.</div>}
        <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:6 }}>
          {fil.map(it => { const i = o.items.indexOf(it); const [txt, c] = lineState(it); const left = Math.max(0, (it.qty || 0) - (it.received || 0)); return (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", borderRadius:12, background:"var(--surface2)", border:"1px solid var(--border)" }}>
              <span style={{ width:18, height:18, borderRadius:"50%", flexShrink:0, border:"1px solid var(--border)",
                background: it.color_hex ? `#${it.color_hex}` : "repeating-linear-gradient(45deg, var(--surface) 0 3px, var(--border) 3px 6px)" }}/>
              <span style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13.5, fontWeight:800, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {it.name_fr ? `${it.fila_type || ""} · ${it.name_fr}${it.refill ? " (recharge)" : ""}` : it.title}</div>
                <div style={{ fontSize:11.5, fontWeight:700, color:c }}>{txt}{!it.filament_id && it.name_fr ? " · nouvelle couleur, pas encore de fiche" : ""}</div>
              </span>
              <span style={{ fontWeight:900, fontVariantNumeric:"tabular-nums" }}>{it.received || 0}/{it.qty}</span>
              {isAdmin && (left ? <button onClick={() => act({ index: i, received: true })} disabled={busy} style={{ ...fBtn, padding:"6px 10px", fontSize:12 }}>reçu</button>
                : <button onClick={() => act({ index: i, received: false })} disabled={busy} style={{ ...fBtn, padding:"6px 10px", fontSize:12, color:"var(--muted)" }}>pas reçu</button>)}
            </div>); })}
          {other.length > 0 && <div style={{ fontSize:12, color:"var(--muted)", marginTop:4 }}>Aussi dans la commande : {other.map(i => `${i.title} ×${i.qty}`).join(", ")}</div>}
          {!o.items.length && <div style={{ fontSize:12.5, color:"var(--muted)" }}>Pas de lignes connues (seul le mail d'expédition a été vu).</div>}
        </div>
      </div>
    </FSheet>
  );
}

export default function IncomingOrders() {
  const isAdmin = useIsAdmin();
  const [orders, setOrders] = useState(null);
  const [open, setOpen] = useState(true);
  const load = () => client.get("/filaments/incoming").then(r => setOrders(r.data.orders || [])).catch(() => setOrders([]));
  useEffect(() => { load(); }, []);
  const [sheet, setSheet] = useState(null);
  const live = (orders || []).filter(o => o.status !== "cancelled" && (o.pending > 0 || o.to_confirm > 0));
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
              <span role="button" tabIndex={0} onClick={() => setSheet(o.id)} style={{ fontWeight:800, cursor:"pointer", textDecoration:"underline dotted" }}>Commande {o.order_no}</span>
              {o.to_confirm > 0 && <span style={{ padding:"1px 8px", borderRadius:12, fontSize:11, fontWeight:800, color:"#fff", background:"#f59e0b" }}>à confirmer</span>}
              <span style={{ padding:"1px 8px", borderRadius:12, fontSize:11, fontWeight:800, color:"#fff", background:sc }}>{sl}{o.status === "shipped" && o.shipped_at ? ` le ${day(o.shipped_at)}` : o.ordered_at ? ` le ${day(o.ordered_at)}` : ""}</span>
              <Steps stage={o.stage}/>
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
      {sheet != null && <OrderSheet id={sheet} onClose={() => setSheet(null)} onChanged={list => setOrders(list)}/>}
    </div>
  );
}
