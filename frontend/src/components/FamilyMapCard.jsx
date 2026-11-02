import React, { useEffect, useMemo, useState } from "react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";

// Nos familles (03/11/2026) : « tel sous-type » -> « telle famille » (la matiere), quand la deduction de l'appli ne convient
// pas (« PET-G » -> PETG) ou ne trouve rien (« PEEK CF »). Dans la fenetre « Correspondances » des Parametres : chercher,
// ajouter, modifier, supprimer ; en enregistrant, la matiere des filaments concernes suit.
export default function FamilyMapCard() {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);          // {from, to, orig}
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [sug, setSug] = useState(false);
  const [last, setLast] = useState(null);
  const load = () => client.get("/filaments/catalog/family-map").then(r => setD(r.data)).catch(() => setD({ items: [], families: [], subtypes: [] }));
  useEffect(() => { load(); }, []);
  const items = d?.items || [];
  const put = async list => {
    setBusy(true);
    try { const r = await client.put("/filaments/catalog/family-map", { items: list }); setLast(r.data.updated_filaments); await load(); setEdit(null); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };
  const commit = () => {
    const a = edit.from.trim(), b = edit.to.trim();
    if (!a || !b) { showAlert("Il faut le sous-type et sa famille."); return; }
    put([...items.filter(x => x.from.toLowerCase() !== a.toLowerCase() && x.from !== edit.orig), { from: a, to: b }]);
  };
  const sub = useMemo(() => new Map((d?.subtypes || []).map(s => [s.name.toLowerCase(), s])), [d]);
  const ql = q.trim().toLowerCase();
  const shown = items.filter(x => !ql || `${x.from} ${x.to}`.toLowerCase().includes(ql));
  const orphans = (d?.subtypes || []).filter(s => !s.family && (!ql || s.name.toLowerCase().includes(ql)));
  const inp = { width: "100%", boxSizing: "border-box", minWidth: 0, padding: "7px 9px", borderRadius: 9, border: "1px solid var(--border)",
    background: "var(--surface)", color: "var(--text)", fontSize: 13 };
  const btn = (c = "var(--text2)") => ({ border: "1px solid var(--border)", background: "var(--surface)", color: c, borderRadius: 9, padding: "4px 9px",
    fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" });
  const info = s => s ? `${s.filaments ? `${s.filaments} filament${s.filaments > 1 ? "s" : ""}` : "catalogues"} · déduit : ${s.family || "aucune famille"}` : "";

  const editor = <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", borderRadius: 12,
    background: "color-mix(in srgb, #3B82F6 7%, var(--surface))", border: "1px solid color-mix(in srgb, #3B82F6 35%, var(--border))" }}>
    <div style={{ minWidth: 0 }}>
      <input value={edit?.from || ""} onChange={e => { setEdit(x => ({ ...x, from: e.target.value })); setSug(true); }} onFocus={() => setSug(true)}
        onBlur={() => setTimeout(() => setSug(false), 150)} placeholder="Sous-type (PET-G, PEEK CF…)" aria-label="Sous-type" autoComplete="off" autoFocus style={inp}/>
      {sug && (() => {
        const t = (edit?.from || "").trim().toLowerCase();
        const list = t ? (d?.subtypes || []).filter(s => s.name.toLowerCase().includes(t) && s.name.toLowerCase() !== t).slice(0, 8) : [];
        return list.length > 0 && <div role="listbox" style={{ marginTop: 4, maxHeight: 220, overflowY: "auto", borderRadius: 10, border: "1px solid var(--border)",
          background: "var(--surface)", boxShadow: "0 10px 24px -14px rgba(0,0,0,.35)" }}>
          {list.map(s => <button key={s.name} type="button" role="option" onMouseDown={e => e.preventDefault()}
            onClick={() => { setEdit(x => ({ ...x, from: s.name, to: x.to || s.family || "" })); setSug(false); }}
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, width: "100%", textAlign: "left", padding: "7px 10px",
              border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{s.name}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>{info(s)}</span></button>)}
        </div>;
      })()}
      {edit?.from?.trim() && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
        {sub.get(edit.from.trim().toLowerCase()) ? info(sub.get(edit.from.trim().toLowerCase())) : "Sous-type inconnu de tes filaments et des catalogues"}</span>}
    </div>
    <input value={edit?.to || ""} onChange={e => setEdit(x => ({ ...x, to: e.target.value.toUpperCase() }))} list={undefined} placeholder="Famille (PLA, PETG, PEEK…)"
      aria-label="Famille" onKeyDown={e => { if (e.key === "Enter") commit(); }} style={inp}/>
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {(d?.families || []).map(f => <button key={f} type="button" onClick={() => setEdit(x => ({ ...x, to: f }))}
        style={{ ...btn(edit?.to === f ? "#fff" : "var(--text2)"), padding: "3px 8px", fontSize: 11.5,
          background: edit?.to === f ? "linear-gradient(135deg, #3B82F6, #6366F1)" : "var(--surface)", border: edit?.to === f ? "none" : "1px solid var(--border)" }}>{f}</button>)}
    </div>
    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
      <button type="button" disabled={busy} onClick={commit} style={{ ...btn("#fff"), border: "none", background: "linear-gradient(135deg, #3B82F6, #6366F1)" }}>
        {busy ? "…" : "✓ Enregistrer"}</button>
      <button type="button" onClick={() => setEdit(null)} style={btn()}>Annuler</button>
    </div>
  </div>;

  if (!d) return <span style={{ fontSize: 13, color: "var(--muted)" }}>…</span>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un sous-type ou une famille…" aria-label="Chercher" style={{ ...inp, maxWidth: 320 }}/>
    {last != null && <span style={{ fontSize: 12, fontWeight: 700, color: "#16a34a" }}>✓ Enregistré{last ? ` · matière remise à jour sur ${last} filament${last > 1 ? "s" : ""}` : ""}</span>}
    {items.length === 0 && !edit && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Aucune famille à toi : la déduction de l'appli s'applique (« PLA Silk » → PLA).</span>}
    {shown.map(x => edit?.orig === x.from ? <React.Fragment key={x.from}>{editor}</React.Fragment>
      : <div key={x.from} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface2)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{x.from} <span style={{ color: "#16a34a" }}>→ {x.to}</span></div>
          {sub.get(x.from.toLowerCase())?.filaments > 0 && <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>{sub.get(x.from.toLowerCase()).filaments} filament(s)</div>}
        </div>
        <button type="button" onClick={() => setEdit({ from: x.from, to: x.to, orig: x.from })} data-tip="Modifier" style={btn()}>✏️</button>
        <button type="button" disabled={busy} onClick={() => put(items.filter(y => y.from !== x.from))} data-tip="Supprimer (la déduction reprend)" style={btn("#dc2626")}>🗑</button>
      </div>)}
    {edit && edit.orig == null ? editor : !edit && <button type="button" onClick={() => setEdit({ from: "", to: "", orig: null })} style={{ ...btn("#3B82F6"), alignSelf: "flex-start" }}>＋ Ajouter une famille</button>}
    {orphans.length > 0 && <>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#d97706", marginTop: 6 }}>Sans famille · {orphans.length}</div>
      {orphans.slice(0, 100).map(s => <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 10, background: "var(--surface2)" }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: "var(--text)" }}>{s.name}
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}> · {s.filaments ? `${s.filaments} filament(s)` : "catalogues"}</span></div>
        <button type="button" onClick={() => setEdit({ from: s.name, to: "", orig: null })} data-tip="Lui donner une famille" style={btn()}>✏️</button>
      </div>)}
    </>}
  </div>;
}
