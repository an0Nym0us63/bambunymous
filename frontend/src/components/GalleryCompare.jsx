import React, { useState } from "react";
import { X, ChevronLeft, ChevronRight, Check } from "lucide-react";

/**
 * Galerie photo en tuiles avec sélection multiple et comparaison côte à côte.
 *
 * props:
 *  - items: liste d'objets
 *  - getId(item), getImage(item), getTitle(item), getSubtitle(item)
 *  - compareFields: [[label, fn(item)], ...] — lignes affichées dans la comparaison
 *  - maxCompare: nombre max d'éléments comparables (def 6)
 *  - emptyLabel: texte si aucun item
 */
export default function GalleryCompare({
  items, getId, getImage, getTitle, getSubtitle, compareFields = [],
  maxCompare = 6, emptyLabel = "Aucun élément",
}) {
  const [selected, setSelected]   = useState(new Map());
  const [lightbox, setLightbox]   = useState(null); // { list, index }
  const [compareOpen, setCompareOpen] = useState(false);

  const toggle = (item) => {
    const id = getId(item);
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(id)) { next.delete(id); return next; }
      if (next.size >= maxCompare) return prev;
      next.set(id, item);
      return next;
    });
  };

  const selectedList = Array.from(selected.values());
  const openLightbox = (list, index) => setLightbox({ list, index });
  const move = (delta) => setLightbox(l => l && ({ ...l, index: (l.index + delta + l.list.length) % l.list.length }));

  if (!items?.length) {
    return <p style={{ textAlign:"center", color:"var(--muted)", fontSize:13, padding:"32px 0" }}>{emptyLabel}</p>;
  }

  return (
    <div style={{ position:"relative" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))", gap:8,
        paddingBottom: selectedList.length ? 76 : 0 }}>
        {items.map(item => {
          const id = getId(item);
          const img = getImage(item);
          const checked = selected.has(id);
          return (
            <div key={id} onClick={() => openLightbox(items, items.indexOf(item))}
              style={{ position:"relative", borderRadius:10, overflow:"hidden", cursor:"pointer",
                aspectRatio:"1", background:"var(--surface2)", border: checked ? "2px solid #3b82f6" : "2px solid transparent" }}>
              {img ? (
                <img src={img} alt={getTitle(item)} style={{ width:"100%", height:"100%", objectFit:"cover" }}
                  onError={e => { e.currentTarget.style.display="none"; }}/>
              ) : (
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%",
                  color:"var(--muted)", fontSize:10, padding:6, textAlign:"center" }}>{getTitle(item)}</div>
              )}
              <button onClick={e => { e.stopPropagation(); toggle(item); }}
                style={{ position:"absolute", top:6, left:6, width:20, height:20, borderRadius:6,
                  border: checked ? "none" : "1.5px solid rgba(255,255,255,0.7)",
                  background: checked ? "#3b82f6" : "rgba(0,0,0,0.35)",
                  display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:0 }}>
                {checked && <Check size={13} color="white" strokeWidth={3}/>}
              </button>
              <div style={{ position:"absolute", bottom:0, left:0, right:0,
                background:"linear-gradient(transparent,rgba(0,0,0,0.78))", padding:"18px 6px 4px" }}>
                <p style={{ fontSize:10, color:"white", fontWeight:700, margin:0,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{getTitle(item)}</p>
                {getSubtitle && (
                  <p style={{ fontSize:9, color:"rgba(255,255,255,0.7)", margin:0,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{getSubtitle(item)}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tray flottant de sélection */}
      {selectedList.length > 0 && (
        <div style={{ position:"fixed", bottom:76, left:12, right:12, zIndex:500,
          background:"var(--sheet-bg)", border:"1px solid var(--border)", borderRadius:14,
          padding:8, display:"flex", alignItems:"center", gap:8, boxShadow:"0 4px 24px rgba(0,0,0,0.35)" }}>
          <div style={{ display:"flex", gap:4, overflowX:"auto", flex:1 }}>
            {selectedList.map(item => (
              <div key={getId(item)} style={{ position:"relative", flexShrink:0 }}>
                <img src={getImage(item)} alt="" style={{ width:32, height:32, borderRadius:6, objectFit:"cover" }}/>
                <button onClick={() => toggle(item)}
                  style={{ position:"absolute", top:-4, right:-4, width:14, height:14, borderRadius:"50%",
                    background:"#ef4444", border:"none", color:"white", fontSize:9, cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
              </div>
            ))}
          </div>
          <span style={{ fontSize:11, color:"var(--muted)", flexShrink:0, fontFamily:"monospace" }}>{selectedList.length}/{maxCompare}</span>
          <button onClick={() => setCompareOpen(true)} disabled={selectedList.length < 2}
            style={{ padding:"6px 12px", borderRadius:8, fontSize:12, fontWeight:700, flexShrink:0,
              background: selectedList.length<2 ? "var(--border)" : "#3b82f6",
              color: selectedList.length<2 ? "var(--muted)" : "white",
              border:"none", cursor: selectedList.length<2 ? "default" : "pointer" }}>
            Comparer
          </button>
          <button onClick={() => setSelected(new Map())}
            style={{ padding:"6px 10px", borderRadius:8, fontSize:12, flexShrink:0,
              background:"none", border:"1px solid var(--border)", color:"var(--muted)", cursor:"pointer" }}>
            Vider
          </button>
        </div>
      )}

      {/* Modal comparaison */}
      {compareOpen && (
        <div onClick={() => setCompareOpen(false)} style={{ position:"fixed", inset:0, zIndex:1300,
          background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)",
            borderRadius:"20px 20px 0 0", width:"100%", maxWidth:720, maxHeight:"88dvh", overflowY:"auto",
            padding:"16px 16px calc(16px + env(safe-area-inset-bottom,0px))" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <h3 style={{ fontSize:15, fontWeight:800, color:"var(--text)", margin:0 }}>
                Comparer ({selectedList.length})
              </h3>
              <button onClick={() => setCompareOpen(false)}
                style={{ background:"var(--surface2)", border:"none", borderRadius:"50%", width:28, height:28,
                  cursor:"pointer", color:"var(--text2)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <X size={15}/>
              </button>
            </div>
            <div style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:6 }}>
              {selectedList.map(item => (
                <div key={getId(item)} style={{ flexShrink:0, width:160, background:"var(--surface)",
                  border:"1px solid var(--border)", borderRadius:12, padding:10 }}>
                  <img src={getImage(item)} alt={getTitle(item)}
                    onClick={() => openLightbox(selectedList, selectedList.indexOf(item))}
                    style={{ width:"100%", aspectRatio:"1", objectFit:"cover", borderRadius:8,
                      cursor:"pointer", marginBottom:8, background:"var(--surface2)" }}
                    onError={e => { e.currentTarget.style.display="none"; }}/>
                  <p style={{ fontSize:12, fontWeight:700, color:"var(--text)", margin:"0 0 6px",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{getTitle(item)}</p>
                  {compareFields.map(([label, fn]) => (
                    <div key={label} style={{ display:"flex", justifyContent:"space-between", gap:6,
                      fontSize:10, padding:"3px 0", borderTop:"1px solid var(--border)" }}>
                      <span style={{ color:"var(--muted)" }}>{label}</span>
                      <span style={{ color:"var(--text)", fontWeight:600, textAlign:"right",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fn(item) ?? "—"}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox plein écran avec navigation */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position:"fixed", inset:0, zIndex:2000,
          background:"rgba(0,0,0,0.9)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <button onClick={e => { e.stopPropagation(); setLightbox(null); }}
            style={{ position:"absolute", top:16, right:16, background:"rgba(255,255,255,0.1)", border:"none",
              borderRadius:"50%", width:32, height:32, color:"white", cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center" }}>
            <X size={16}/>
          </button>
          {lightbox.list.length > 1 && (
            <button onClick={e => { e.stopPropagation(); move(-1); }}
              style={{ position:"absolute", left:8, background:"rgba(255,255,255,0.1)", border:"none",
                borderRadius:"50%", width:36, height:36, color:"white", cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center" }}>
              <ChevronLeft size={18}/>
            </button>
          )}
          <div onClick={e => e.stopPropagation()} style={{ display:"flex", flexDirection:"column",
            alignItems:"center", gap:10, maxWidth:"90vw" }}>
            <img src={getImage(lightbox.list[lightbox.index])} alt=""
              style={{ maxWidth:"90vw", maxHeight:"75vh", objectFit:"contain", borderRadius:10 }}/>
            <p style={{ color:"white", fontSize:13, fontWeight:600, textAlign:"center" }}>
              {getTitle(lightbox.list[lightbox.index])}
            </p>
          </div>
          {lightbox.list.length > 1 && (
            <button onClick={e => { e.stopPropagation(); move(1); }}
              style={{ position:"absolute", right:8, background:"rgba(255,255,255,0.1)", border:"none",
                borderRadius:"50%", width:36, height:36, color:"white", cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center" }}>
              <ChevronRight size={18}/>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
