import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import MwImg from "./MwImg";
import { FSheet, fBtn } from "./FicheKit";
import { egg } from "../eggs";
import { showAlert } from "../utils/dialog";
import { mwCollections } from "../utils/mwSync";
import { currentFriend } from "../store/friend";

// (11/11/2026) les modeles faits en entier (toutes leurs variantes, dans la serie en cours) mais restes dans une
// collection de la liste (« Panier ») : proposes au retrait. « Garder » les oublie jusqu'a ce qu'ils repartent de zero.
const KEEP = "bn-done-keep";
const readKeep = () => { try { return JSON.parse(localStorage.getItem(KEEP) || "{}") || {}; } catch { return {}; } };
export default function DoneCleanup({ models: given = null, colls: givenColls = null, onDone = null }) {
  // (12/11/2026) sans liste fournie (Calendrier) : lue sur /makerworld/queue (calcul en cache cote serveur)
  const [fetched, setFetched] = useState(null), [tick, setTick] = useState(0);
  useEffect(() => {
    if (given || currentFriend()) return;
    client.get("/makerworld/queue").then(({ data }) => setFetched(data)).catch(() => setFetched({}));
  }, [given, tick]);
  const models = given || fetched?.models || [], colls = givenColls || fetched?.collections || [];
  onDone = onDone || (() => setTick(n => n + 1));
  const [open, setOpen] = useState(false), [sel, setSel] = useState(null), [busy, setBusy] = useState(false), [keep, setKeep] = useState(readKeep), [gone, setGone] = useState(() => new Set());
  const title = Object.fromEntries((colls || []).map(c => [c.id, c.title]));
  const done = useMemo(() => {
    const by = new Map();
    for (const r of models) { const k = String(r.mw_id || r.design_id); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
    return [...by.entries()].filter(([k, rs]) => rs.every(r => r.done) && (rs[0].coll_ids || []).length && keep[k] !== (rs[0].since || "-") && !gone.has(k))
      .map(([k, rs]) => ({ id: k, r: rs[0], colls: rs[0].coll_ids }));
  }, [models, keep, gone]);
  if (!done.length) return null;
  const chosen = sel || new Set(done.map(d => d.id));
  const names = [...new Set(done.flatMap(d => d.colls.map(c => title[c]).filter(Boolean)))];
  const where = names.length === 1 ? `« ${names[0]} »` : "tes collections";
  const toggle = id => setSel(() => { const x = new Set(chosen); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const keepThem = () => { const k = { ...keep }; done.filter(d => !chosen.has(d.id)).forEach(d => { k[d.id] = d.r.since || "-"; });
    try { localStorage.setItem(KEEP, JSON.stringify(k)); } catch { /* navigation privee */ } setKeep(k); };
  const remove = async () => {
    setBusy(true);
    const fails = [];
    for (const d of done.filter(x => chosen.has(x.id))) {
      try {
        const { data } = await client.get(`/makerworld/design/${d.id}/collections`);
        if (!data.known) { fails.push(d.r.title_fr || d.r.title); continue; }    // sans la liste exacte, l'ecriture effacerait les autres
        const ids = (data.in || []).map(String).filter(c => !d.colls.includes(c));
        await client.put(`/makerworld/design/${d.id}/collections`, { ids });
        mwCollections(d.id, ids);
        setGone(g => new Set([...g, d.id]));      // hors du bandeau sans attendre la relecture
      } catch { fails.push(d.r.title_fr || d.r.title); }
    }
    keepThem();
    egg("panier_menage");
    setBusy(false); setOpen(false); setSel(null);
    if (fails.length) showAlert(`Pas retiré (MakerWorld n'a pas dit où il est rangé) : ${fails.join(", ")}`);
    onDone();
  };
  return (<>
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 8px 8px 12px", borderRadius:14, fontSize:12.5, fontWeight:800, color:"#15803D",
      background:"radial-gradient(90% 90% at 0% 0%, rgba(34,197,94,0.16), transparent 70%), var(--surface2)", border:"1px dashed rgba(34,197,94,0.5)" }}>
      <span style={{ flex:1, minWidth:0 }}>🧺 {done.length} modèle{done.length > 1 ? "s" : ""} déjà fait{done.length > 1 ? "s" : ""} encore dans {where}</span>
      <button onClick={() => setOpen(true)} style={{ padding:"5px 12px", borderRadius:20, border:"none", cursor:"pointer", fontSize:12, fontWeight:900, color:"#fff",
        background:"linear-gradient(135deg, #22C55E, #16A34A)", whiteSpace:"nowrap" }}>Faire le tri</button>
    </div>
    {open && createPortal(<FSheet onClose={() => { setOpen(false); setSel(null); }} z={1300} bottom={<>
      <button onClick={() => { keepThem(); setOpen(false); setSel(null); }} disabled={busy} style={{ ...fBtn, flex:1 }}
        data-tip="Les décochés ne seront plus proposés (sauf s'ils repartent de zéro)">Garder les décochés</button>
      <button onClick={remove} disabled={busy || !chosen.size} style={{ ...fBtn, flex:1, border:"none", color:"#fff", background:"linear-gradient(135deg, #22C55E, #16A34A)" }}>
        {busy ? "…" : `Retirer ${chosen.size}`}</button></>}>
      <div style={{ padding:"22px 16px 8px" }}>
        <div style={{ fontSize:16, fontWeight:900, color:"var(--text)" }}>🧺 Déjà faits, encore dans {where}</div>
        <p style={{ fontSize:12, color:"var(--muted)", margin:"4px 0 12px" }}>Tous leurs plateaux ont été imprimés. Les cochés quittent les collections de la liste « À faire » (pas les autres) ; décoche ceux à garder.</p>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {done.map(d => { const on = chosen.has(d.id);
            return <label key={d.id} style={{ display:"flex", alignItems:"center", gap:10, padding:6, borderRadius:12, cursor:"pointer",
              border:`1px solid ${on ? "rgba(34,197,94,0.5)" : "var(--border)"}`, background: on ? "rgba(34,197,94,0.08)" : "var(--surface2)" }}>
              <input type="checkbox" checked={on} onChange={() => toggle(d.id)}/>
              {d.r.cover_url && <MwImg src={d.r.cover_url} alt="" style={{ width:42, height:42, borderRadius:9, objectFit:"cover", flexShrink:0 }}/>}
              <span style={{ minWidth:0, flex:1 }}>
                <span style={{ display:"block", fontSize:13, fontWeight:800, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {String(d.r.title_fr || d.r.title || "").split(" · ")[0]}</span>
                <span style={{ display:"block", fontSize:11, fontWeight:700, color:"var(--muted)" }}>
                  📁 {d.colls.map(c => title[c]).filter(Boolean).join(", ")}{d.r.printed ? ` · imprimé ${d.r.printed}×` : ""}</span>
              </span></label>; })}
        </div>
      </div>
    </FSheet>, document.body)}
  </>);
}
