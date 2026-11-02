import React, { useEffect, useMemo, useRef, useState } from "react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import CardHelp from "./CardHelp";

// Nos correspondances de noms (02/11/2026) : un nom anglais du catalogue Bambu -> notre nom francais. Elles passent
// avant le catalogue (une traduction absente ou qui ne convient pas) ; a l'enregistrement, les fiches filament qui
// portaient l'ancien nom (anglais, catalogue ou notre ancienne correspondance) prennent le nouveau ; un nom tape a la
// main sur une fiche n'est jamais touche. En tableau : chaque nom, ce qu'en dit le catalogue, modifier ou supprimer.
// Chaque geste s'enregistre tout de suite.
export default function CatalogNamesCard({ card, cardTitle }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);          // { i (ligne), en, fr } ; i = -1 : un nouveau nom
  const [sure, setSure] = useState(null);          // la ligne dont la suppression attend sa confirmation
  const [q, setQ] = useState("");
  const [sug, setSug] = useState(false);           // la liste des noms du catalogue sous le champ ouverte
  const box = useRef(null);
  const [W, setW] = useState(600);
  const load = () => client.get("/filaments/catalog-names").then(r => setD(r.data)).catch(() => setD({ rows: [], items: [], names: [] }));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const el = box.current; if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, [d != null]);
  const names = useMemo(() => new Map((d?.names || []).map(n => [n.en.toLowerCase(), n])), [d]);
  const put = async items => {
    setBusy(true);
    try { await client.put("/filaments/catalog-names", { items }); await load(); setEdit(null); setSure(null); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };
  const ours = () => (d?.items || []).map(x => ({ en: x.en, fr: x.fr }));
  const commit = () => {
    const en = edit.en.trim(), fr = edit.fr.trim();
    if (!en || !fr) { showAlert("Il faut le nom anglais du catalogue et notre nom français."); return; }
    const row = edit.i >= 0 ? d.rows[edit.i] : null;
    // une ligne a nous : remplacee ; une ligne de l'appli ou un nouveau nom : ajoute (le meme nom anglais remplace)
    const keep = ours().filter(x => x.en.toLowerCase() !== en.toLowerCase() && !(row?.source === "nous" && x.en.toLowerCase() === row.en.toLowerCase()));
    put([...keep, { en, fr }]);
  };
  const drop = row => {
    if (sure !== row.en) { setSure(row.en); setTimeout(() => setSure(s => s === row.en ? null : s), 4000); return; }
    put(ours().filter(x => x.en.toLowerCase() !== row.en.toLowerCase()));
  };
  const narrow = W < 560;
  const rows = (d?.rows || []).map((r, i) => ({ ...r, i }))
    .filter(r => !q.trim() || [r.en, r.fr, r.catalog?.fr].some(v => (v || "").toLowerCase().includes(q.trim().toLowerCase())));
  const inp = { width: "100%", boxSizing: "border-box", minWidth: 0, padding: "7px 9px", borderRadius: 9, border: "1px solid var(--border)",
    background: "var(--surface)", color: "var(--text)", fontSize: 13 };
  const btn = (c = "var(--text2)") => ({ border: "1px solid var(--border)", background: "var(--surface)", color: c, borderRadius: 9, padding: "4px 9px",
    fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" });
  const chip = (t, c) => <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 800, padding: "1px 7px", borderRadius: 20,
    color: c, background: `color-mix(in srgb, ${c} 13%, transparent)`, whiteSpace: "nowrap" }}>{t}</span>;
  // ce qu'en dit le catalogue : son nom francais (ou pas), et les filaments qui portent ce nom anglais
  const Catalog = ({ c }) => !c?.refs?.length
    ? <span style={{ fontSize: 12, fontWeight: 700, color: "#d97706" }}>⚠ absent du catalogue</span>
    : <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: c.fr ? "var(--text)" : "var(--muted)" }}>{c.fr ? `« ${c.fr} »` : "pas de nom français"}</span>
      <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{c.refs.map((r, k) => <span key={k} data-tip={`${r.fila_id} · code ${r.code}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--text2)", padding: "1px 7px", borderRadius: 20,
          background: "var(--surface2)", border: "1px solid var(--border)", whiteSpace: "nowrap" }}>
        <span style={{ display: "inline-flex" }}>{(r.colors || []).map((h, j) => <span key={j} style={{ width: 9, height: 9, borderRadius: "50%", background: `#${h}`,
          marginLeft: j ? -3 : 0, border: "1px solid rgba(0,0,0,.2)" }}/>)}</span>
        {[r.type, r.code, r.kind].filter(Boolean).join(" · ")}</span>)}</span>
    </div>;
  const editor = (i) => {
    const hit = names.get(edit.en.trim().toLowerCase());
    return <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr auto", gap: 6, alignItems: "center", padding: "8px 10px", borderRadius: 12,
      background: "color-mix(in srgb, #3B82F6 7%, var(--surface))", border: "1px solid color-mix(in srgb, #3B82F6 35%, var(--border))" }}>
      <div style={{ minWidth: 0 }}>
        {/* nos propres suggestions (02/11/2026) : la liste native (datalist) s'affichait transparente par-dessus la page
            dans l'appli Android */}
        <input value={edit.en} onChange={e => { setEdit(x => ({ ...x, en: e.target.value })); setSug(true); }} placeholder="Nom anglais du catalogue"
          aria-label="Nom anglais du catalogue" autoFocus={i < 0} onFocus={() => setSug(true)} onBlur={() => setTimeout(() => setSug(false), 150)}
          autoComplete="off" style={inp}/>
        {sug && (() => {
          const t = edit.en.trim().toLowerCase();
          const list = t ? (d?.names || []).filter(n => n.en.toLowerCase().includes(t) && n.en.toLowerCase() !== t)
            .sort((a, b) => a.en.toLowerCase().indexOf(t) - b.en.toLowerCase().indexOf(t)).slice(0, 8) : [];
          return list.length > 0 && <div role="listbox" style={{ marginTop: 4, maxHeight: 220, overflowY: "auto", borderRadius: 10, border: "1px solid var(--border)",
            background: "var(--surface)", boxShadow: "0 10px 24px -14px rgba(0,0,0,.35)" }}>
            {list.map(n => <button key={n.en} type="button" role="option" onMouseDown={e => e.preventDefault()}
              onClick={() => { setEdit(x => ({ ...x, en: n.en })); setSug(false); }}
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, width: "100%", textAlign: "left", padding: "7px 10px",
                border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{n.en}</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>{n.fr || "pas de nom français"}</span></button>)}
          </div>;
        })()}
        {edit.en.trim() && <span style={{ fontSize: 11, fontWeight: 700, color: hit ? "var(--muted)" : "#d97706" }}>
          {hit ? (hit.fr ? `Catalogue : « ${hit.fr} »` : "Au catalogue, sans nom français") : "⚠ Absent du catalogue (vérifie l'orthographe)"}</span>}
      </div>
      <input value={edit.fr} onChange={e => setEdit(x => ({ ...x, fr: e.target.value }))} placeholder="Notre nom français" aria-label="Notre nom français"
        onKeyDown={e => { if (e.key === "Enter") commit(); }} style={inp}/>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button type="button" disabled={busy} onClick={commit} style={{ ...btn("#fff"), border: "none", background: "linear-gradient(135deg, #3B82F6, #6366F1)" }}>
          {busy ? "…" : "✓ Enregistrer"}</button>
        <button type="button" onClick={() => setEdit(null)} style={btn()}>Annuler</button>
      </div>
    </div>;
  };
  return <div className="card" style={card} ref={box}>
    <div style={{ ...cardTitle, display: "flex", alignItems: "center", gap: 6 }}>🔤 Noms du catalogue
      <CardHelp inline title="Noms du catalogue">
        Le catalogue Bambu n'a pas traduit toutes ses couleurs, et certaines traductions ne collent pas à la boutique. Chaque
        ligne : un nom anglais du catalogue, le nom français à montrer, et ce qu'en dit le catalogue (son nom français s'il en
        a un, les filaments qui portent ce nom). Nos noms passent avant le catalogue : scan RFID, AMS, commandes lues dans les
        mails, fiches filament. En enregistrant, les fiches qui portaient l'ancien nom sont renommées ; un nom tapé à la main
        sur une fiche n'est jamais touché. « appli » : un nom que l'appli connaît déjà ; ✏️ le remplace par le tien.</CardHelp></div>
    {d == null ? <span style={{ fontSize: 13, color: "var(--muted)" }}>…</span> : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {(d.rows || []).length > 6 && <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un nom…" aria-label="Chercher un nom" style={{ ...inp, maxWidth: 280 }}/>}
      {!narrow && rows.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.1fr 1.6fr 84px", gap: 10, padding: "0 10px",
        fontSize: 10.5, fontWeight: 900, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>
        <span>Catalogue (anglais)</span><span>Notre nom</span><span>Ce qu'en dit le catalogue</span><span/></div>}
      {rows.length === 0 && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{q ? "Aucun nom ne correspond." : "Aucune correspondance pour l'instant."}</span>}
      {rows.map(r => edit?.i === r.i ? <div key={r.en}>{editor(r.i)}</div>
        : <div key={r.en} style={{ display: "grid", gridTemplateColumns: narrow ? "1fr auto" : "1.1fr 1.1fr 1.6fr 84px", gap: narrow ? "4px 8px" : 10,
          alignItems: "center", padding: "9px 10px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <span style={{ minWidth: 0, fontSize: 13, fontWeight: 800, color: "var(--text)", overflowWrap: "anywhere" }}>{r.en}
            {r.source === "appli" && <> {chip("appli", "#8B5CF6")}</>}</span>
          {narrow && actions(r)}
          <span style={{ minWidth: 0, fontSize: 13, fontWeight: 800, color: "#16a34a", overflowWrap: "anywhere", gridColumn: narrow ? "1 / -1" : undefined }}>
            {narrow && <span style={{ color: "var(--muted)", fontWeight: 700 }}>→ </span>}{r.fr}</span>
          <div style={{ minWidth: 0, gridColumn: narrow ? "1 / -1" : undefined }}><Catalog c={r.catalog}/></div>
          {!narrow && actions(r)}
        </div>)}
      {edit?.i === -1 ? editor(-1)
        : <div><button type="button" onClick={() => { setEdit({ i: -1, en: "", fr: "" }); setSure(null); }} style={btn("#3B82F6")}>＋ Ajouter un nom</button></div>}
    </div>}
  </div>;

  function actions(r) {
    return <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
      <button type="button" disabled={busy} onClick={() => { setEdit({ i: r.i, en: r.en, fr: r.fr }); setSure(null); }}
        data-tip={r.source === "appli" ? "Mettre ton propre nom à la place" : "Modifier"} style={btn()}>✏️</button>
      {r.source === "nous" && <button type="button" disabled={busy} onClick={() => drop(r)} data-tip="Supprimer cette correspondance"
        style={sure === r.en ? { ...btn("#fff"), background: "#dc2626", borderColor: "#dc2626" } : btn("#ef4444")}>{sure === r.en ? "Confirmer" : "🗑"}</button>}
    </span>;
  }
}
