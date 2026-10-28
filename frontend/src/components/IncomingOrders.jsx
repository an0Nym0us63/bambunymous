import React, { useEffect, useState } from "react";
import client from "../api/client";
import { useIsAdmin } from "../store/auth";
import { egg } from "../eggs";
import { moneyVal } from "../utils/money";

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

// les petits signes d'une ligne (28/10/2026, a la place de textes tronques) : recharge ou bobine, nouvelle couleur
// sans fiche, dans un envoi en route
function Marks({ it, size = 12 }) {
  const rec = it.received || 0, sent = Math.max(0, (it.shipped || 0) - rec);
  const m = { fontSize: size, lineHeight: 1, cursor: "default" };
  return <span style={{ display:"inline-flex", alignItems:"center", gap:4, flexShrink:0 }}>
    {it.refill ? <span data-tip="Recharge (sans support)" style={m}>♻️</span> : <span data-tip="Avec bobine" style={{ ...m, opacity:0.55 }}>🧵</span>}
    {!it.filament_id && it.name_fr && <span data-tip="Nouvelle couleur : pas encore de fiche filament, elle naîtra au scan de la bobine" style={m}>✨</span>}
    {sent > 0 && (it.qty || 0) > rec && <span data-tip="Dans un envoi en route" style={m}>🚚</span>}
  </span>;
}

const lineName = it => it.kind === "filament" && it.name_fr ? `${it.fila_type || ""} · ${it.name_fr}` : it.title;
// un montant du mail, avec sa devise (euro sauf mention) ; masque en lecture seule
const eur = (v, cur = "€") => v == null ? null : `${moneyVal(v)} ${cur || "€"}`;
// le prix d'une ligne (28/10/2026) : « 14,96 € l'unité → 13,40 € payée » quand la remise de fin de commande joue ; « offerte » pour un cadeau
function LinePrice({ it, cur, size = 11.5 }) {
  if (it.kind !== "filament" || it.price == null) return null;
  if (it.gift || it.price === 0) return <span style={{ fontSize:size, fontWeight:800, color:"#22c55e" }}>🎁 offerte{it.list_price ? ` · ${eur(it.list_price / Math.max(1, it.qty || 1), cur)} valeur` : ""}</span>;
  const b = it.base_unit, p = it.paid_unit;
  return <span data-tip={`Prix de base (la fiche filament) : ${eur(b, cur)} la bobine, le prix barré du catalogue quand le mail le montre${p != null && p !== b ? ` · payée ${eur(p, cur)} (la bobine) : le prix remisé de la ligne, moins sa part de la remise de fin de commande` : ""}`}
    style={{ fontSize:size, fontWeight:700, color:"var(--muted)", whiteSpace:"nowrap" }}>
    {eur(b, cur)}{p != null && p !== b ? <> → <b style={{ color:"var(--text)" }}>{eur(p, cur)}</b></> : null}{(it.qty || 1) > 1 ? " /u" : ""}</span>;
}

// l'etat d'une ligne, en clair
function lineState(it) {
  const qty = it.qty || 0, rec = it.received || 0, left = Math.max(0, qty - rec);
  if (it.kind !== "filament") return ["", "var(--muted)"];
  if (it.confirmed && !left) return ["reçue, confirmée", "#22c55e"];
  if (it.assumed) return [`présumée reçue (commande ancienne)${it.auto ? `, ${it.auto} retrouvée${it.auto > 1 ? "s" : ""} par la date d'ajout` : ""} · à confirmer`, "#f59e0b"];
  if (!left) return [it.auto ? "reçue (bobine ajoutée après la commande)" : "reçue", "#22c55e"];
  const sent = Math.max(0, (it.shipped || 0) - rec);
  if (rec) return [`${rec} reçue${rec > 1 ? "s" : ""}, ${left} ${sent ? "en route" : "attendue" + (left > 1 ? "s" : "")}`, "#0EA5E9"];
  return [sent ? "en route" : "attendue", sent ? "#f59e0b" : "#0EA5E9"];
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
  // la fiche filament (si elle manque) et autant de bobines « en commande » qu'il en reste a recevoir, pour une
  // ligne ou pour toute la commande : elles attendent hors du stock, le scan ou l'ajout les adopte a l'arrivee
  const create = async index => {
    setBusy(true);
    try {
      const { data } = await client.post(`/filaments/incoming/${id}/create`, index == null ? {} : { index });
      if (data.order) setO(data.order);
      if (data.created_spools || data.created_filaments) egg("precommande");
    } catch { /* rien */ }
    setBusy(false);
  };
  const toCreate = it => it.kind === "filament" && (it.qty || 0) - (it.received || 0) - (it.spools?.length || 0) > 0;
  if (!o) return null;
  if (o.missing) return <FSheet onClose={onClose} z={3000}><p style={{ padding:40, textAlign:"center", color:"var(--muted)" }}>Commande introuvable.</p></FSheet>;
  const [sl, sc] = ST[o.status] || [o.status, "#94a3b8"];
  const fil = o.items.filter(i => i.kind === "filament"), other = o.items.filter(i => i.kind !== "filament");
  return (
    <FSheet onClose={onClose} z={3000} bottom={isAdmin ? <>
      {o.to_confirm > 0 && <button onClick={() => act({ confirm: true })} disabled={busy} style={{ ...fBtn, flex:1, background:"#22c55e", color:"#fff", border:"none" }}>✓ Tout est bien là</button>}
      {o.items.some(toCreate) && o.status !== "cancelled" && <button onClick={() => create(null)} disabled={busy} data-tip="Tout d'un coup : les fiches filament manquantes et une bobine « en commande » par unité attendue (ligne par ligne : le bouton « 📬 créer » de chaque ligne)"
        style={{ ...fBtn, flex:1, background:"#0EA5E9", color:"#fff", border:"none" }}>📬 Tout créer en commande</button>}
      <button onClick={async () => { await act({ hide: !o.hidden }); if (!o.hidden) onClose(); }} disabled={busy} style={{ ...fBtn, flex: o.to_confirm > 0 ? 0 : 1 }}>{o.hidden ? "Remontrer" : "Cacher"}</button>
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
          {o.totals?.total != null && <span data-tip="Lu dans le mail de confirmation. La remise de fin de commande (abonnement, points…) est partagée à parts égales entre les bobines pour leur prix payé ; la fiche filament garde le prix de base (le prix barré du catalogue).">
            💶 {o.totals.subtotal != null && o.totals.subtotal !== o.totals.total ? <>sous-total {eur(o.totals.subtotal, o.totals.currency)}{o.totals.discount ? ` · remise ${eur(o.totals.discount, o.totals.currency)}` : ""}{o.totals.shipping ? ` · envoi ${eur(o.totals.shipping, o.totals.currency)}` : ""} · </> : null}
            <b style={{ color:"var(--text)" }}>total {eur(o.totals.total, o.totals.currency)}</b></span>}
          {(o.shipments || []).map((sh, i) => <span key={i}>📦 Envoi du {dayY(sh.at)}{sh.carrier ? ` · ${sh.carrier}` : ""}{sh.tracking ? ` · ${sh.tracking}` : ""}
            {sh.url && <> · <a href={sh.url} target="_blank" rel="noreferrer" style={{ color:"#0EA5E9", fontWeight:700 }}>suivre ↗</a></>}
            {sh.items?.length ? ` : ${sh.items.join(", ")}` : ""}</span>)}
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
                {/* le nom en entier, sur deux lignes s'il le faut (jamais coupe) ; les marques suivent le texte */}
                <div style={{ fontSize:13.5, fontWeight:800, color:"var(--text)", lineHeight:1.25, overflowWrap:"anywhere" }}>
                  {lineName(it)} <span style={{ whiteSpace:"nowrap", display:"inline-flex", gap:4, verticalAlign:"middle" }}><Marks it={it} size={13}/></span></div>
                <div style={{ fontSize:11.5, fontWeight:700, color:c, display:"flex", gap:8, flexWrap:"wrap", alignItems:"baseline" }}>{txt}<LinePrice it={it} cur={o.totals?.currency || it.currency}/></div>
              </span>
              <span style={{ fontWeight:900, fontVariantNumeric:"tabular-nums" }}>{it.received || 0}/{it.qty}</span>
              {isAdmin && left > 0 && (toCreate(it)
                ? <button onClick={() => create(i)} disabled={busy} data-tip="Créer seulement cette ligne : la fiche filament si elle manque, et sa bobine « en commande »" style={{ ...fBtn, padding:"6px 8px", fontSize:12, whiteSpace:"nowrap" }}>📬 créer</button>
                : <span data-tip={`${it.spools.length} bobine${it.spools.length > 1 ? "s" : ""} en commande dans le stock`} style={{ fontSize:12, opacity:0.7 }}>📬✓</span>)}
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

// une bobine en miniature (la meme que sur la tuile Commandes) : la couleur du filament, hachuree si inconnue
export function MiniSpool({ hex, size = 14, sent = false, style }) {
  return <span aria-hidden="true" style={{ width:size, height:Math.round(size * 1.35), borderRadius:Math.round(size * 0.28), flexShrink:0, position:"relative",
    background: hex ? `#${hex}` : "repeating-linear-gradient(45deg, var(--surface) 0 3px, var(--border) 3px 6px)",
    boxShadow:`inset 0 0 0 1px rgba(0,0,0,0.18)${sent ? ", 0 0 0 2px #f59e0b" : ""}`, ...style }}>
    <span style={{ position:"absolute", left:"22%", right:"22%", top:"44%", height:"12%", borderRadius:2, background:"rgba(255,255,255,0.55)", boxShadow:"0 0 0 1px rgba(0,0,0,0.12)" }}/>
  </span>;
}

const STAGE = { ordered: ["commandée", "#3b82f6", "📬"], shipping: ["en livraison", "#f59e0b", "🚚"], delivered: ["livrée", "#22c55e", "📦"], cancelled: ["annulée", "#94a3b8", "✕"] };

// la carte d'une commande en route (28/10/2026) : un clic n'importe ou ouvre sa fenetre ; seuls « recu », le suivi et
// « cacher » font autre chose. En tete, l'etape en couleur, le numero, la date, les trois etapes ; puis les bobines qui manquent.
function OrderCard({ o, isAdmin, onOpen, onMark, onHide }) {
  const [sl, sc, ic] = STAGE[o.stage] || STAGE.ordered;
  const fil = o.items.filter(i => i.kind === "filament"), tot = fil.reduce((n, i) => n + (i.qty || 0), 0);
  const sent = fil.reduce((n, i) => n + Math.min(i.qty || 0, i.shipped || 0), 0), partial = o.stage === "shipping" && tot && sent < tot;
  const got = fil.reduce((n, it) => n + (it.received || 0), 0);
  const left = o.items.map((it, i) => ({ it, i })).filter(({ it }) => it.kind === "filament" && (it.qty || 0) - (it.received || 0) > 0);
  const stop = f => e => { e.stopPropagation(); f && f(); };
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="bn-order-card" style={{ borderRadius:14, background:"var(--surface)", border:`1px solid color-mix(in srgb, ${sc} 35%, var(--border))`, overflow:"hidden", cursor:"pointer",
        boxShadow:"0 1px 2px rgba(0,0,0,0.04)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:`linear-gradient(90deg, color-mix(in srgb, ${sc} 18%, var(--surface)), var(--surface) 75%)` }}>
        <span style={{ width:36, height:36, borderRadius:11, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:19,
          background:`color-mix(in srgb, ${sc} 22%, var(--surface))`, boxShadow:`inset 0 0 0 1px color-mix(in srgb, ${sc} 45%, transparent)` }}>{ic}</span>
        <span style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:2 }}>
          <span style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
            <span style={{ fontSize:13.5, fontWeight:900, color:"var(--text)" }}>{partial ? "Envoi partiel" : sl[0].toUpperCase() + sl.slice(1)}</span>
            {partial ? <span style={{ fontSize:11, fontWeight:800, color:sc }}>{sent}/{tot} en route</span> : null}
            {o.to_confirm > 0 && <span style={{ padding:"1px 7px", borderRadius:10, fontSize:10.5, fontWeight:800, color:"#fff", background:"#f59e0b" }}>à confirmer</span>}
            <Steps stage={o.stage} size={11}/>
          </span>
          <span style={{ fontSize:11.5, color:"var(--muted)", fontWeight:600, display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            <span>N° {o.order_no}</span>
            <span>· {o.stage === "shipping" && o.shipped_at ? `envoyée le ${day(o.shipped_at)}` : o.ordered_at ? `le ${day(o.ordered_at)}` : ""}</span>
            {o.tracking_url && <a href={o.tracking_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontWeight:800, color:"#0EA5E9" }}>suivi {o.carrier || ""} ↗</a>}
            {o.totals?.total != null && <span>· {eur(o.totals.total, o.totals.currency)}</span>}
          </span>
        </span>
        <span style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <b data-tip={`${o.pending} bobine${o.pending > 1 ? "s" : ""} encore attendue${o.pending > 1 ? "s" : ""}`} style={{ minWidth:26, textAlign:"center", fontSize:12.5, fontWeight:900, color:"#fff", background:sc, borderRadius:11, padding:"2px 8px" }}>{o.pending}</b>
          {isAdmin && <button type="button" onClick={stop(onHide)} data-tip="Ne plus montrer cette commande" aria-label="Cacher"
            style={{ border:"none", background:"none", color:"var(--muted)", cursor:"pointer", fontSize:13, padding:"2px 4px" }}>✕</button>}
          <span aria-hidden="true" style={{ color:"var(--muted)", fontSize:16, lineHeight:1 }}>›</span>
        </span>
      </div>
      {got > 0 && <div style={{ fontSize:11.5, fontWeight:700, color:"#22c55e", padding:"6px 12px 0" }}>✓ {got} bobine{got > 1 ? "s" : ""} déjà reçue{got > 1 ? "s" : ""}</div>}
      <div style={{ padding:"6px 12px 10px", display:"flex", flexDirection:"column" }}>
        {/* seules les bobines encore attendues ; ce qui est recu (ajoute, scanne ou coche) sort de la carte, la fenetre garde tout */}
        {left.map(({ it, i }, k) => { const n = (it.qty || 0) - (it.received || 0), onWay = Math.max(0, (it.shipped || 0) - (it.received || 0)) > 0; return (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:10, fontSize:12.5, padding:"6px 0", borderTop: k ? "1px solid color-mix(in srgb, var(--border) 60%, transparent)" : "none" }}>
            <MiniSpool hex={it.color_hex} sent={onWay}/>
            <span style={{ flex:1, minWidth:0, lineHeight:1.2, overflowWrap:"anywhere", color:"var(--text)", fontWeight:600, display:"flex", flexDirection:"column", gap:1 }}>{lineName(it)}
              <LinePrice it={it} cur={o.totals?.currency || it.currency} size={10.5}/></span>
            <Marks it={it}/>
            <span style={{ fontWeight:900, fontVariantNumeric:"tabular-nums", color: n > 1 ? "var(--text)" : "var(--muted)" }}>×{n}</span>
            {isAdmin && <button type="button" onClick={stop(() => onMark(i))} data-tip="La bobine est là, sans passer par un ajout ou un scan"
              style={{ border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)", cursor:"pointer", fontSize:11, fontWeight:800, padding:"3px 9px", borderRadius:10 }}>reçu</button>}
          </div>); })}
      </div>
    </div>
  );
}

export default function IncomingOrders() {
  const isAdmin = useIsAdmin();
  const [orders, setOrders] = useState(null);
  const [open, setOpen] = useState(true);
  // seulement ce qui attend encore (28/10/2026) : une commande finie (tout recu, livree, annulee) sort de la page Filaments ;
  // l'historique se lit dans Parametres -> Comptes -> Commandes Bambu Lab
  const load = () => client.get("/filaments/incoming").then(r => setOrders((r.data.orders || []).filter(o => !o.hidden))).catch(() => setOrders([]));
  useEffect(() => { load(); }, []);
  const [sheet, setSheet] = useState(null);
  const live = (orders || []).filter(o => o.status !== "cancelled" && (o.pending > 0 || o.to_confirm > 0));
  useEffect(() => { if (live.length) egg("facteur"); }, [live.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!live.length) return null;
  const mark = async (o, i) => {
    try { const { data } = await client.post(`/filaments/incoming/${o.id}/mark`, { index: i, received: true }); setOrders((data.orders || []).filter(x => !x.hidden)); }
    catch { /* rien */ }
  };
  const hide = async o => {
    try { const { data } = await client.post(`/filaments/incoming/${o.id}/mark`, { hide: true }); setOrders((data.orders || []).filter(x => !x.hidden)); }
    catch { /* rien */ }
  };
  const total = live.reduce((n, o) => n + o.pending, 0), onWay = live.reduce((n, o) => n + o.items.filter(i => i.kind === "filament").reduce((m, i) => m + Math.max(0, Math.min((i.qty || 0) - (i.received || 0), (i.shipped || 0) - (i.received || 0))), 0), 0);
  return (
    <div style={{ borderRadius:16, border:"1px solid color-mix(in srgb, #0EA5E9 35%, var(--border))", overflow:"hidden",
      background:"linear-gradient(180deg, color-mix(in srgb, #0EA5E9 9%, var(--surface)), color-mix(in srgb, #0EA5E9 3%, var(--surface)))" }}>
      <button type="button" onClick={() => setOpen(v => !v)} style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 12px",
        border:"none", background:"transparent", cursor:"pointer", color:"var(--text)", textAlign:"left" }}>
        <span style={{ fontSize:20 }}>📬</span>
        <span style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:1 }}>
          <span style={{ fontWeight:900, fontSize:14.5 }}>À venir · {total} bobine{total > 1 ? "s" : ""}</span>
          <span style={{ fontSize:11.5, fontWeight:700, color:"var(--muted)" }}>{onWay ? `🚚 ${onWay} en route · ` : ""}📬 {total - onWay} attendue{total - onWay > 1 ? "s" : ""} · {live.length} commande{live.length > 1 ? "s" : ""}</span>
        </span>
        <span style={{ fontSize:12, fontWeight:700, color:"var(--muted)" }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && <div style={{ display:"flex", flexDirection:"column", gap:8, padding:"0 10px 10px" }}>
        {live.map(o => <OrderCard key={o.id} o={o} isAdmin={isAdmin} onOpen={() => setSheet(o.id)} onMark={i => mark(o, i)} onHide={() => hide(o)}/>)}
      </div>}
      {sheet != null && <OrderSheet id={sheet} onClose={() => setSheet(null)} onChanged={list => setOrders((list || []).filter(x => !x.hidden))}/>}
    </div>
  );
}

// l'historique (28/10/2026) : toutes les commandes lues, finies comprises, une ligne chacune, la fenetre au clic.
// Dans Parametres -> Comptes, sous la carte des commandes Bambu Lab.
export function OrdersHistory() {
  const [orders, setOrders] = useState(null);
  const [openList, setOpenList] = useState(false);
  const [sheet, setSheet] = useState(null);
  const load = () => client.get("/filaments/incoming", { params: { all: 1 } }).then(r => setOrders(r.data.orders || [])).catch(() => setOrders([]));
  useEffect(() => { load(); }, []);
  const list = orders || [];
  if (!list.length) return null;
  return (
    <div style={{ borderTop:"1px solid var(--border)", marginTop:4, paddingTop:6 }}>
      <button type="button" onClick={() => setOpenList(v => !v)} style={{ width:"100%", display:"flex", alignItems:"center", gap:6, padding:"4px 0",
        border:"none", background:"transparent", cursor:"pointer", color:"var(--muted)", fontSize:12, fontWeight:700, textAlign:"left" }}>
        <span style={{ flex:1 }}>Commandes lues · {list.length}</span><span>{openList ? "▴" : "▾"}</span></button>
      {openList && <div style={{ display:"flex", flexDirection:"column", gap:4, marginTop:4 }}>
        {list.map(o => { const [sl, sc] = STAGE[o.stage] || STAGE.ordered; const nb = o.items.filter(i => i.kind === "filament").reduce((n, i) => n + (i.qty || 0), 0); return (
          <button type="button" key={o.id} onClick={() => setSheet(o.id)} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:10,
            border:"1px solid var(--border)", background:"var(--surface2)", cursor:"pointer", color:"var(--text)", textAlign:"left", fontSize:12.5, opacity: o.hidden ? 0.6 : 1 }}>
            <span style={{ fontWeight:800 }}>{o.order_no}</span>
            <span style={{ padding:"1px 7px", borderRadius:10, fontSize:10.5, fontWeight:800, color:"#fff", background:sc }}>{sl}</span>
            {o.hidden && <span style={{ fontSize:10.5, color:"var(--muted)", fontWeight:700 }}>cachée</span>}
            <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:"var(--muted)" }}>
              {nb ? `${nb} bobine${nb > 1 ? "s" : ""}` : "sans lignes"}{o.items.length > nb ? ` · ${o.items.length - nb} autre${o.items.length - nb > 1 ? "s" : ""}` : ""}</span>
            <span style={{ color:"var(--muted)", fontVariantNumeric:"tabular-nums" }}>{day(o.delivered_at || o.shipped_at || o.ordered_at)}</span>
          </button>); })}
      </div>}
      {sheet != null && <OrderSheet id={sheet} onClose={() => setSheet(null)} onChanged={() => load()}/>}
    </div>
  );
}
