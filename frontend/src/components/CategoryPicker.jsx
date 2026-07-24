import React, { useState, useEffect, useMemo } from "react";
import client from "../api/client";

/**
 * Choix d'un regroupement d'accessoires, sur le modele du selecteur de groupe
 * d'un print : on tape, la liste se filtre, et on choisit un existant ou on
 * cree le nouveau.
 *
 * Une difference volontaire avec les groupes de prints : la creation est
 * REFUSEE si le nom existe deja, a la casse et aux espaces pres. Deux groupes
 * de prints homonymes restent deux lots distincts et cela peut avoir un sens ;
 * deux regroupements d'accessoires homonymes ne seraient qu'une seule etagere
 * dessinee en double, avec des sections jumelles dans la liste.
 */
export default function CategoryPicker({ value, onChange }) {
  const [cats, setCats] = useState([]);
  const [q, setQ] = useState(value || "");
  const [open, setOpen] = useState(false);

  useEffect(() => { setQ(value || ""); }, [value]);
  useEffect(() => {
    client.get("/objects/accessories/categories")
      .then(r => setCats(r.data || [])).catch(() => setCats([]));
  }, []);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => cats.filter(c => !needle || c.name.toLowerCase().includes(needle)),
    [cats, needle]);
  // Comparaison normalisee : "Visserie" et " visserie " designent la meme chose.
  const exact = cats.some(c => c.name.trim().toLowerCase() === needle);
  const canCreate = needle.length > 0 && !exact;

  const pick = (name) => { onChange(name); setQ(name); setOpen(false); };

  const inp = { width:"100%", boxSizing:"border-box", padding:"9px 12px", borderRadius:9,
    border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)",
    fontSize:13, outline:"none" };

  return (
    <div style={{ position:"relative" }}>
      <div style={{ display:"flex", gap:6 }}>
        <input style={inp} value={q} placeholder="Aucun regroupement"
          onFocus={() => setOpen(true)}
          onChange={e => { setQ(e.target.value); setOpen(true); }}/>
        {(q || value) && (
          <button onClick={() => { onChange(null); setQ(""); setOpen(false); }}
            title="Retirer du regroupement"
            style={{ flexShrink:0, width:38, borderRadius:9, cursor:"pointer",
              border:"1px solid var(--border)", background:"var(--surface2)",
              color:"var(--muted)", fontSize:13 }}>✕</button>
        )}
      </div>

      {open && (
        <>
          {/* Voile de fermeture : sans lui, la liste reste ouverte des qu'on
              clique ailleurs dans la feuille. */}
          <div onClick={() => setOpen(false)}
            style={{ position:"fixed", inset:0, zIndex:10 }}/>
          <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:11,
            marginTop:4, maxHeight:220, overflowY:"auto", borderRadius:10,
            border:"1px solid var(--border)", background:"var(--sheet-bg)",
            boxShadow:"0 6px 24px rgba(0,0,0,0.3)" }}>
            {canCreate && (
              <button onClick={() => pick(q.trim())}
                style={{ display:"flex", alignItems:"center", gap:8, width:"100%",
                  padding:"11px 13px", border:"none", background:"none", cursor:"pointer",
                  textAlign:"left", color:"#22c55e", fontSize:13, fontWeight:700 }}>
                + Créer « {q.trim()} »
              </button>
            )}
            {exact && (
              <p style={{ margin:0, padding:"9px 13px", fontSize:11,
                color:"var(--muted)", borderBottom:"1px solid var(--border)" }}>
                Ce regroupement existe déjà — choisis-le ci-dessous.
              </p>
            )}
            {shown.map(c => (
              <button key={c.name} onClick={() => pick(c.name)}
                style={{ display:"flex", alignItems:"center", gap:8, width:"100%",
                  padding:"10px 13px", border:"none", cursor:"pointer", textAlign:"left",
                  background: c.name === value ? "rgba(59,130,246,0.12)" : "none",
                  color: c.name === value ? "#3b82f6" : "var(--text)", fontSize:13,
                  fontWeight: c.name === value ? 700 : 500 }}>
                <span style={{ flex:1, minWidth:0, overflow:"hidden",
                  textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.name}</span>
                <span style={{ fontSize:10.5, color:"var(--muted)" }}>{c.count}</span>
              </button>
            ))}
            {!shown.length && !canCreate && (
              <p style={{ margin:0, padding:"12px 13px", fontSize:12,
                color:"var(--muted)" }}>Aucun regroupement.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
