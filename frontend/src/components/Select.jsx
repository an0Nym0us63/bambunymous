import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Liste deroulante maison, en remplacement de <select>.
 *
 * Pourquoi ne pas garder le natif : dans une WebView Android, la liste qu'un
 * <select> ouvre n'est PAS du web, c'est une boite de dialogue Android dessinee
 * par le systeme avec le theme de l'application. Aucun CSS ne l'atteint --
 * ni un style sur <option>, ni color-scheme, qui ne fonctionne que sur les
 * navigateurs de bureau. D'ou des listes blanches au milieu du theme sombre.
 *
 * Le remplacant ouvre une feuille par le bas, dans le langage visuel deja
 * employe partout ailleurs dans l'application : themee, lisible, et des cibles
 * confortables au doigt plutot qu'une liste systeme dense.
 *
 * L'API reprend celle de <select> a dessein -- value, onChange avec
 * e.target.value, options en {value,label} -- pour que la substitution ne
 * demande pas de reecrire les appelants.
 *
 * Une longue liste (plus de 10 choix, ou searchable) a un champ en tete pour la
 * prefiltrer en tapant (03/11/2026 : marques des catalogues), sans accents ni
 * casse ; Entree prend le premier choix restant.
 */
const norm = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function Select({ value, onChange, options = [], style = {},
                                 placeholder = "—", disabled = false, title, searchable }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btnRef = useRef(null);
  const canSearch = searchable ?? options.length > 10;
  useEffect(() => { if (!open) setQ(""); }, [open]);
  const words = norm(q).split(/\s+/).filter(Boolean);
  const shown = words.length ? options.filter(o => { const l = norm(o.label); return words.every(w => l.includes(w)); }) : options;
  // le clavier ne s'ouvre de lui-meme qu'avec une souris (au doigt, il cacherait la moitie de la liste)
  const fine = typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;

  // Une liste ouverte ne doit pas survivre a un changement d'ecran.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const current = options.find(o => String(o.value) === String(value));
  const label = current ? current.label : placeholder;

  const pick = (v) => {
    setOpen(false);
    // Meme forme d'evenement que le natif : les appelants lisent
    // e.target.value sans savoir qu'ils ne parlent plus a un <select>.
    onChange?.({ target: { value: v } });
  };

  return (
    <>
      <button ref={btnRef} type="button" title={title} disabled={disabled}
        onClick={() => !disabled && setOpen(true)}
        style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          gap:8, textAlign:"left", cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1, ...style }}>
        <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {label}
        </span>
        <span style={{ flexShrink:0, opacity:0.5, fontSize:10 }}>▾</span>
      </button>

      {open && createPortal(
        <div onClick={() => setOpen(false)}
          style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.5)",
            display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width:"100%", maxWidth:520, background:"var(--sheet-bg)",
              borderRadius:"22px 22px 0 0", maxHeight:"70dvh", overflowY:"auto",
              padding:"12px 10px max(env(safe-area-inset-bottom,16px),16px)" }}>
            <div style={{ width:38, height:4, borderRadius:2, background:"rgba(148,163,184,.6)",
              margin:"0 auto 12px" }}/>
            {title && <p style={{ fontSize:15, fontWeight:900, color:"var(--text)", margin:"0 10px 8px" }}>{title}</p>}
            {canSearch && <div style={{ position:"sticky", top:-12, zIndex:1, padding:"4px 2px 8px", background:"var(--sheet-bg)" }}>
              <input value={q} onChange={e => setQ(e.target.value)} autoFocus={fine} placeholder="Taper pour filtrer…"
                aria-label="Filtrer la liste" autoComplete="off"
                onKeyDown={e => { if (e.key === "Enter" && shown.length) { e.preventDefault(); pick(shown[0].value); } }}
                style={{ width:"100%", boxSizing:"border-box", padding:"10px 14px", borderRadius:12, fontSize:14.5,
                  border:"1px solid var(--border)", background:"var(--surface)", color:"var(--text)" }}/></div>}
            {canSearch && shown.length === 0 && <p style={{ fontSize:13, color:"var(--muted)", margin:"8px 14px" }}>Aucun choix ne correspond</p>}
            {shown.map(o => {
              const sel = String(o.value) === String(value);
              return (
                <button key={String(o.value)} type="button" onClick={() => pick(o.value)}
                  style={{ display:"flex", alignItems:"center", gap:10, width:"100%",
                    padding:"12px 14px", border:"none", borderRadius:14, marginBottom:2, background: sel
                      ? "linear-gradient(135deg, #3B82F6, #6366F1)" : "transparent",
                    color: sel ? "#fff" : "var(--text)", boxShadow: sel ? "0 6px 14px -8px #3B82F6" : "none",
                    fontSize:14.5, fontWeight: sel ? 800 : 600, cursor:"pointer",
                    textAlign:"left" }}>
                  <span style={{ width:16, flexShrink:0, fontWeight:900 }}>{sel ? "✓" : ""}</span>
                  <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis",
                    whiteSpace:"nowrap" }}>{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
