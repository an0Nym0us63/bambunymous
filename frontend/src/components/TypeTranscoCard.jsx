import React, { useEffect, useMemo, useState } from "react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import CardHelp from "./CardHelp";

// Les sous-types des catalogues des autres marques, a notre facon (03/11/2026). La normalisation fait le gros (« Fil PLA »
// -> « PLA », « Matte PLA » -> « PLA Matte », comme Bambu) ; nos transcos corrigent le reste : « telle gamme » -> « notre
// sous-type ». Chaque geste s'enregistre tout de suite ; la synchro des catalogues propose ensuite d'harmoniser les
// filaments deja rattaches.
export default function TypeTranscoCard({ card, cardTitle }) {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);          // {from, to, orig} ; orig : la ligne remplacee (ou null)
  const [busy, setBusy] = useState(false);
  const [sug, setSug] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [q, setQ] = useState("");
  const load = () => client.get("/filaments/catalog/type-transco").then(r => setD(r.data)).catch(() => setD({ items: [], gammes: [] }));
  useEffect(() => { load(); }, []);
  const put = async items => {
    setBusy(true);
    try { await client.put("/filaments/catalog/type-transco", { items }); await load(); setEdit(null); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };
  const items = d?.items || [];
  const commit = () => {
    const a = edit.from.trim(), b = edit.to.trim();
    if (!a || !b) { showAlert("Il faut la gamme du catalogue et notre sous-type."); return; }
    put([...items.filter(x => x.from.toLowerCase() !== a.toLowerCase() && x.from !== edit.orig), { from: a, to: b }]);
  };
  const gam = useMemo(() => new Map((d?.gammes || []).map(g => [g.gamme.toLowerCase(), g])), [d]);
  const inp = { width: "100%", boxSizing: "border-box", minWidth: 0, padding: "7px 9px", borderRadius: 9, border: "1px solid var(--border)",
    background: "var(--surface)", color: "var(--text)", fontSize: 13 };
  const btn = (c = "var(--text2)") => ({ border: "1px solid var(--border)", background: "var(--surface)", color: c, borderRadius: 9, padding: "4px 9px",
    fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" });
  const brandsTxt = g => g ? `${g.brands.slice(0, 3).join(", ")}${g.brands.length > 3 ? ` +${g.brands.length - 3}` : ""} · ${g.count} couleur${g.count > 1 ? "s" : ""}` : "";
  const renamed = (d?.gammes || []).filter(g => g.ours !== g.gamme && (!q.trim() || `${g.gamme} ${g.ours} ${g.brands.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())));

  const editor = <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", borderRadius: 12,
    background: "color-mix(in srgb, #3B82F6 7%, var(--surface))", border: "1px solid color-mix(in srgb, #3B82F6 35%, var(--border))" }}>
    <div style={{ minWidth: 0 }}>
      <input value={edit?.from || ""} onChange={e => { setEdit(x => ({ ...x, from: e.target.value })); setSug(true); }} onFocus={() => setSug(true)}
        onBlur={() => setTimeout(() => setSug(false), 150)} placeholder="Gamme du catalogue (Matte PLA, Fil PLA…)" aria-label="Gamme du catalogue"
        autoComplete="off" autoFocus style={inp}/>
      {sug && (() => {
        const t = (edit?.from || "").trim().toLowerCase();
        const list = t ? (d?.gammes || []).filter(g => g.gamme.toLowerCase().includes(t) && g.gamme.toLowerCase() !== t).slice(0, 8) : [];
        return list.length > 0 && <div role="listbox" style={{ marginTop: 4, maxHeight: 220, overflowY: "auto", borderRadius: 10, border: "1px solid var(--border)",
          background: "var(--surface)", boxShadow: "0 10px 24px -14px rgba(0,0,0,.35)" }}>
          {list.map(g => <button key={`${g.gamme}|${g.material}`} type="button" role="option" onMouseDown={e => e.preventDefault()}
            onClick={() => { setEdit(x => ({ ...x, from: g.gamme, to: x.to || g.ours })); setSug(false); }}
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, width: "100%", textAlign: "left", padding: "7px 10px",
              border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{g.gamme}{g.ours !== g.gamme ? <span style={{ color: "var(--muted)" }}> → {g.ours}</span> : null}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>{brandsTxt(g)}</span></button>)}
        </div>;
      })()}
      {edit?.from?.trim() && <span style={{ fontSize: 11, fontWeight: 700, color: gam.get(edit.from.trim().toLowerCase()) ? "var(--muted)" : "#d97706" }}>
        {gam.get(edit.from.trim().toLowerCase()) ? brandsTxt(gam.get(edit.from.trim().toLowerCase())) : "⚠ Aucune gamme de ce nom dans les catalogues (vérifie l'orthographe)"}</span>}
    </div>
    <input value={edit?.to || ""} onChange={e => setEdit(x => ({ ...x, to: e.target.value }))} placeholder="Notre sous-type (PLA Matte…)" aria-label="Notre sous-type"
      onKeyDown={e => { if (e.key === "Enter") commit(); }} style={inp}/>
    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
      <button type="button" disabled={busy} onClick={commit} style={{ ...btn("#fff"), border: "none", background: "linear-gradient(135deg, #3B82F6, #6366F1)" }}>
        {busy ? "…" : "✓ Enregistrer"}</button>
      <button type="button" onClick={() => setEdit(null)} style={btn()}>Annuler</button>
    </div>
  </div>;

  return <div className="card" style={card}>
    <div style={{ ...cardTitle, display: "flex", alignItems: "center", gap: 6 }}>🔀 Sous-types des catalogues
      <CardHelp inline title="Sous-types des catalogues">
        Les autres marques nomment leurs gammes à leur façon (« Fil PLA », « Matte PLA », « 95A High Speed TPU »). L'appli les
        remet d'office à la manière de Bambu : sans « Fil » ni « Filament », la matière devant (« PLA Matte »,
        « TPU 95A High Speed »), et la matière seule en sous-type de base (« PLA » → « PLA Basic »). Une transco à toi passe avant : « telle gamme du catalogue » → « notre sous-type ». Elles
        valent à la création, au rattachement et à la synchro des catalogues, qui propose ensuite d'harmoniser les filaments
        déjà rattachés. Un sous-type gardé sur un filament (décoché au rattachement) n'est jamais touché.</CardHelp></div>
    {d == null ? <span style={{ fontSize: 13, color: "var(--muted)" }}>…</span> : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.length === 0 && !edit && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Aucune transco à toi : la normalisation seule s'applique.</span>}
      {items.map(x => edit?.orig === x.from ? <React.Fragment key={x.from}>{editor}</React.Fragment>
        : <div key={x.from} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface2)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{x.from} <span style={{ color: "#16a34a" }}>→ {x.to}</span></div>
            {gam.get(x.from.toLowerCase()) && <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>{brandsTxt(gam.get(x.from.toLowerCase()))}</div>}
          </div>
          <button type="button" onClick={() => setEdit({ from: x.from, to: x.to, orig: x.from })} data-tip="Modifier" style={btn()}>✏️</button>
          <button type="button" disabled={busy} onClick={() => put(items.filter(y => y.from !== x.from))} data-tip="Supprimer (la normalisation reprend)" style={btn("#dc2626")}>🗑</button>
        </div>)}
      {edit && edit.orig == null ? editor : !edit && <button type="button" onClick={() => setEdit({ from: "", to: "", orig: null })} style={{ ...btn("#3B82F6"), alignSelf: "flex-start" }}>＋ Ajouter une transco</button>}
      <button type="button" onClick={() => setBrowse(v => !v)} style={{ ...btn(), alignSelf: "flex-start" }}>
        {browse ? "Masquer" : "Voir"} les gammes renommées ({(d.gammes || []).filter(g => g.ours !== g.gamme).length})</button>
      {browse && <>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher une gamme ou une marque…" aria-label="Chercher une gamme" style={{ ...inp, maxWidth: 320 }}/>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 360, overflowY: "auto" }}>
          {renamed.slice(0, 200).map(g => <div key={`${g.gamme}|${g.material}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 10, background: "var(--surface2)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)" }}>{g.gamme} <span style={{ color: "var(--muted)" }}>→</span> {g.ours}</div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{brandsTxt(g)}</div>
            </div>
            <button type="button" onClick={() => { setEdit({ from: g.gamme, to: g.ours, orig: null }); setBrowse(false); }} data-tip="Choisir un autre sous-type pour cette gamme" style={btn()}>✏️</button>
          </div>)}
          {renamed.length > 200 && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>… {renamed.length - 200} de plus : cherche pour affiner.</span>}
        </div></>}
    </div>}
  </div>;
}
