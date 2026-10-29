import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import client, { apiUrl } from "../api/client";
import { showAlert } from "../utils/dialog";

// Les vues 3D d'une impression ou d'un groupe (30/10/2026) : jusqu'a 4, prises dans la vue 3D (un plateau, l'assemblage,
// de jour, de nuit, eclairee par derriere…). On en choisit une comme vignette, ou la vignette par defaut ; on en supprime ;
// et une vue qui vient d'etre prise (shot) s'ajoute ou en remplace une.
function Picker({ kind, id, shot, onDone, close }) {
  const base = kind === "group" ? `/prints/groups/${id}` : `/prints/${id}`;
  const [d, setD] = useState(null), [busy, setBusy] = useState(false), [sure, setSure] = useState(0), [saved, setSaved] = useState(!shot);
  const load = async () => { try { setD((await client.get(`${base}/vue3d`)).data); } catch (e) { showAlert(e.response?.data?.detail || e.message); close(); } };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async f => {
    setBusy(true);
    try { await f(); await load(); onDone?.(); window.dispatchEvent(new Event("bn-prints-changed")); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };
  const put = slot => act(async () => {
    const fd = new FormData(); fd.append("file", shot.blob, "Vue3D.png"); if (slot) fd.append("slot", String(slot));
    const r = await client.post(`${base}/vue3d`, fd);
    setSaved(r.data.n);
  });
  // plusieurs vues choisies : la vignette en fait une mosaique (30/10/2026) ; aucune : la vignette par defaut
  const sel = d?.sel || [];
  const toggle = n => act(() => client.put(`${base}/thumb`, { slots: sel.includes(n) ? sel.filter(x => x !== n) : [...sel, n] }));
  const none = () => act(() => client.put(`${base}/thumb`, { slots: [] }));
  const drop = n => { if (sure !== n) { setSure(n); setTimeout(() => setSure(0), 4000); return; } setSure(0); act(() => client.delete(`${base}/vue3d/${n}`)); };
  const full = d && d.slots.length >= d.max;
  const tile = { position: "relative", width: 112, display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" };
  const img = on => ({ width: 112, height: 112, objectFit: "contain", borderRadius: 12, background: "var(--surface2)",
    border: on ? "2px solid #0EA5E9" : "1px solid var(--border)", boxSizing: "border-box" });
  const btn = (main, extra = {}) => ({ height: 28, borderRadius: 9, border: main ? "none" : "1px solid var(--border)", cursor: "pointer", fontSize: 11.5, fontWeight: 800,
    color: main ? "#fff" : "var(--text2)", background: main ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "var(--surface)", ...extra });
  const def = kind === "group" ? "Mosaïque des impressions" : "Image du plateau";
  return <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(2,6,23,.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div onClick={e => e.stopPropagation()} style={{ width: "min(560px, calc(100% - 32px))", maxHeight: "calc(100% - 40px)", overflowY: "auto", padding: "16px 18px",
      borderRadius: 16, background: "var(--sheet-bg)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,.4)", color: "var(--text2)",
      display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <b style={{ flex: 1, fontSize: 16, color: "var(--text)" }}>🧊 Vues 3D {kind === "group" ? "du groupe" : "de l'impression"}</b>
        <button type="button" onClick={close} aria-label="Fermer" style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {shot && !saved && <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 10, borderRadius: 12, border: "1px dashed #0EA5E9" }}>
        <img src={shot.url} alt="" style={img(false)}/>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 700 }}>
          <span>La vue que tu viens de prendre</span>
          {d && !full && <button type="button" disabled={busy} onClick={() => put(0)} style={btn(true, { padding: "0 12px" })}>＋ La garder ({d.slots.length + 1}/{d.max})</button>}
          {d && d.slots.length > 0 && <span style={{ color: "var(--muted)", fontWeight: 600 }}>{full ? `Déjà ${d.max} vues : ` : "Ou "}touche « ↻ Remplacer » sous celle à écraser.</span>}
        </div>
      </div>}
      {!d ? <span>…</span> : <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <div style={tile}>
          <div style={{ ...img(!sel.length), display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 8, fontSize: 12, fontWeight: 800 }}>
            {kind === "group" ? "🧩" : "🖼"}<br/>{def}</div>
          {sel.length ? <button type="button" disabled={busy} onClick={none} style={btn(false)}>Par défaut</button>
            : <span style={{ fontSize: 11.5, fontWeight: 800, color: "#0EA5E9", textAlign: "center" }}>★ Vignette</span>}
        </div>
        {d.slots.map(s => <div key={s.n} style={tile}>
          <img src={apiUrl(s.url.replace(/^\/api\/v1/, ""))} alt="" style={img(sel.includes(s.n))}/>
          {sel.includes(s.n) ? <button type="button" disabled={busy} onClick={() => toggle(s.n)} data-tip="La retirer de la vignette"
              style={btn(false, { color: "#0EA5E9", borderColor: "#0EA5E9" })}>★ Dans la vignette</button>
            : <button type="button" disabled={busy} onClick={() => toggle(s.n)} data-tip="L'ajouter à la vignette (plusieurs : une mosaïque)" style={btn(true)}>⭐ Vignette</button>}
          {shot && !saved && <button type="button" disabled={busy} onClick={() => put(s.n)} style={btn(false)}>↻ Remplacer</button>}
          <button type="button" disabled={busy} onClick={() => drop(s.n)} style={btn(false, { color: "#ef4444" })}>{sure === s.n ? "Confirmer" : "🗑 Supprimer"}</button>
        </div>)}
      </div>}
      {d?.cover && sel.length > 1 && <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, fontWeight: 700 }}>
        <img src={(u => `${u}${u.includes("?") ? "&" : "?"}v=${d.cover.v}`)(apiUrl(`${kind === "group" ? `/prints/groups/${id}/photo` : `/prints/${id}/file`}/${d.cover.name}`))} alt="" style={{ ...img(true), width: 72, height: 72 }}/>
        <span>La vignette : une mosaïque des {sel.length} vues choisies</span>
      </div>}
      {d && !d.slots.length && !shot && <span style={{ fontSize: 12.5 }}>Aucune vue : prends-en une avec 📸 dans la vue 3D.</span>}
      <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Jusqu'à {d?.max || 4} vues, prises avec 📸 dans la vue 3D : un plateau ou l'assemblage, de jour, de nuit ou éclairé par derrière, telle qu'affichée. Plusieurs choisies : la vignette en fait une mosaïque.</span>
    </div>
  </div>;
}

export function openVue3D(opts) {
  const host = document.createElement("div");
  (document.fullscreenElement || document.body).appendChild(host);
  const root = createRoot(host);
  const close = () => { root.unmount(); host.remove(); };
  root.render(<Picker {...opts} close={close}/>);
  return close;
}
