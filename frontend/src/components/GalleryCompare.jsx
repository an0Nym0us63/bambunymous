import React, { useState, useRef, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Check } from "lucide-react";

/**
 * Galerie photo en tuiles avec carrousel multi-photos par item et comparaison.
 *
 * props:
 *  - items: liste d'objets (déjà l'ensemble complet — pas paginé côté appelant)
 *  - getId(item), getCoverImage(item), getPhotos(item) → [{url,label}] ou [url,...]
 *  - getTitle(item), getSubtitle(item)
 *  - compareFields: [[label, fn(item)], ...]
 *  - maxCompare: nombre max comparable (def 6)
 *  - pageSize: nombre de tuiles affichées initialement, "Charger plus" ensuite (def 30)
 */
export default function GalleryCompare({
  items, getId, getCoverImage, getPhotos, getTitle, getSubtitle, compareFields = [],
  maxCompare = 6, emptyLabel = "Aucun élément", pageSize = 30,
  enableCompare = true, renderCover = null, swatchMode = false,
  selectMode: selectModeProp = false, onSelectModeChange = null,
}) {
  const [selected, setSelected]   = useState(new Map());
  const [selectMode, setSelectMode] = useState(selectModeProp);
  React.useEffect(() => { setSelectMode(selectModeProp); if (!selectModeProp) setSelected(new Map()); }, [selectModeProp]);
  const changeSelectMode = (v) => { setSelectMode(v); onSelectModeChange?.(v); if (!v) setSelected(new Map()); };
  const [carousel, setCarousel]   = useState(null); // { item, index }
  const [compareOpen, setCompareOpen] = useState(false);
  // En mode swatch, tuiles légères → pas de pagination (tout charger d'un coup)
  const effectivePageSize = swatchMode ? 9999 : pageSize;
  const [visibleCount, setVisibleCount] = useState(effectivePageSize);
  const sentinelRef = useRef(null);

  // Reset la pagination si la liste source change (ex: changement d'onglet/filtre)
  useEffect(() => { setVisibleCount(effectivePageSize); }, [items, effectivePageSize]);

  // Lazy-load au scroll — charge le batch suivant quand la sentinelle approche du viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount(c => Math.min(c + effectivePageSize, items?.length || 0));
      }
    }, { rootMargin: "600px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [effectivePageSize, items]);

  const normPhotos = (item) => (getPhotos ? (getPhotos(item) || []) : []).map(p =>
    typeof p === "string" ? { url: p, label: "" } : p
  );

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
  const openCarousel = (item, index = 0) => setCarousel({ item, index });

  // Long press → activer mode sélection (sans déclencher sur scroll ni menu contextuel)
  const pressTimer  = React.useRef(null);
  const pressOrigin = React.useRef(null);
  const startPress  = (item, clientX, clientY) => {
    pressOrigin.current = { x: clientX, y: clientY };
    pressTimer.current  = setTimeout(() => { changeSelectMode(true); toggle(item); }, 500);
  };
  const cancelPress = () => { clearTimeout(pressTimer.current); pressOrigin.current = null; };
  const movePress   = (clientX, clientY) => {
    if (!pressOrigin.current) return;
    const dx = Math.abs(clientX - pressOrigin.current.x);
    const dy = Math.abs(clientY - pressOrigin.current.y);
    if (dx > 8 || dy > 8) cancelPress(); // scroll → annuler
  };
  const move = (delta) => setCarousel(c => {
    if (!c) return c;
    const photos = normPhotos(c.item);
    return { ...c, index: (c.index + delta + photos.length) % photos.length };
  });

  if (!items?.length) {
    return <p style={{ textAlign:"center", color:"var(--muted)", fontSize:13, padding:"32px 0" }}>{emptyLabel}</p>;
  }

  const visibleItems = items.slice(0, visibleCount);

  return (
    <div style={{ position:"relative" }}>

      <div style={{ display:"grid",
        gridTemplateColumns: swatchMode ? "repeat(auto-fill,minmax(72px,1fr))" : "repeat(auto-fill,minmax(110px,1fr))",
        gap: swatchMode ? 3 : 8,
        paddingBottom: (enableCompare && selectedList.length) ? 76 : 0 }}>
        {visibleItems.map(item => {
          const id = getId(item);
          const img = getCoverImage ? getCoverImage(item) : null;
          const checked = selected.has(id);
          const photos = normPhotos(item);
          const hasPhotos = photos.length > 0;
          return (
            <div key={id}
              onClick={() => { if (selectMode && enableCompare) toggle(item); else if (hasPhotos && !selectMode) openCarousel(item, 0); }}
              onMouseDown={e => enableCompare && startPress(item, e.clientX, e.clientY)}
              onMouseMove={e => movePress(e.clientX, e.clientY)}
              onMouseUp={cancelPress} onMouseLeave={cancelPress}
              onTouchStart={e => { const t=e.touches[0]; enableCompare && startPress(item, t.clientX, t.clientY); }}
              onTouchMove={e => { const t=e.touches[0]; movePress(t.clientX, t.clientY); }}
              onTouchEnd={cancelPress}
              onContextMenu={e => e.preventDefault()}
              style={{ position:"relative", borderRadius:10, overflow:"hidden", cursor:"pointer",
                aspectRatio:"1", background:"var(--surface2)", border: checked ? "2px solid #3b82f6" : "2px solid transparent" }}>
              {renderCover ? renderCover(item) : img ? (
                <img src={img} alt={getTitle(item)} style={{ width:"100%", height:"100%", objectFit:"cover" }}
                  onError={e => { e.currentTarget.style.display="none"; }}/>
              ) : (
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%",
                  color:"var(--muted)", fontSize:10, padding:6, textAlign:"center" }}>{getTitle(item)}</div>
              )}
              {photos.length > 1 && (
                <span style={{ position:"absolute", top:6, right:6, background:"rgba(0,0,0,0.6)", color:"white",
                  fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:20 }}>
                  {photos.length} 📷
                </span>
              )}
              {enableCompare && selectMode && (
                <button onClick={e => { e.stopPropagation(); toggle(item); }}
                  style={{ position:"absolute", top:6, left:6, width:22, height:22, borderRadius:6,
                    border: checked ? "none" : "1.5px solid rgba(255,255,255,0.7)",
                    background: checked ? "#3b82f6" : "rgba(0,0,0,0.35)",
                    display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:0 }}>
                  {checked && <Check size={13} color="white" strokeWidth={3}/>}
                </button>
              )}
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

      {visibleCount < items.length && (
        <div ref={sentinelRef} style={{ textAlign:"center", padding:"14px 0", color:"var(--muted)", fontSize:11 }}>
          Chargement…
        </div>
      )}

      {/* Tray flottant de sélection */}
      {enableCompare && selectedList.length > 0 && (
        <div style={{ position:"fixed", bottom:76, left:12, right:12, zIndex:500,
          background:"var(--sheet-bg)", border:"1px solid var(--border)", borderRadius:14,
          padding:8, display:"flex", alignItems:"center", gap:8, boxShadow:"0 4px 24px rgba(0,0,0,0.35)" }}>
          <div style={{ display:"flex", gap:4, overflowX:"auto", flex:1 }}>
            {selectedList.map(item => (
              <div key={getId(item)} style={{ position:"relative", flexShrink:0, width:32, height:32, borderRadius:6, overflow:"hidden" }}>
                {renderCover ? renderCover(item) :
                  <img src={getCoverImage ? getCoverImage(item) : null} alt="" style={{ width:32, height:32, objectFit:"cover" }}/>}
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
      {enableCompare && compareOpen && (
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
                  <div onClick={() => { if (normPhotos(item).length) openCarousel(item, 0); }}
                    style={{ width:"100%", aspectRatio:"1", borderRadius:8, overflow:"hidden",
                      cursor: normPhotos(item).length ? "pointer" : "default", marginBottom:8, background:"var(--surface2)" }}>
                    {renderCover ? renderCover(item) : (
                      <img src={getCoverImage ? getCoverImage(item) : null} alt={getTitle(item)}
                        style={{ width:"100%", height:"100%", objectFit:"cover" }}
                        onError={e => { e.currentTarget.style.display="none"; }}/>
                    )}
                  </div>
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

      {/* Carrousel plein écran — photos du print/groupe/filament cliqué, vignettes en bas */}
      {carousel && (() => {
        const photos = normPhotos(carousel.item);
        const current = photos[carousel.index];
        if (!current) return null;
        return (
          <div onClick={() => setCarousel(null)} style={{ position:"fixed", inset:0, zIndex:2000,
            background:"rgba(0,0,0,0.92)", display:"flex", flexDirection:"column" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px" }}>
              <div>
                <p style={{ color:"white", fontSize:14, fontWeight:700, margin:0 }}>{getTitle(carousel.item)}</p>
                <p style={{ color:"rgba(255,255,255,0.6)", fontSize:11, margin:0 }}>
                  {carousel.index + 1} / {photos.length}{current.label ? ` · ${current.label}` : ""}
                </p>
              </div>
              <button onClick={e => { e.stopPropagation(); setCarousel(null); }}
                style={{ background:"rgba(255,255,255,0.1)", border:"none", borderRadius:"50%",
                  width:32, height:32, color:"white", cursor:"pointer",
                  display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <X size={16}/>
              </button>
            </div>

            <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", position:"relative", minHeight:0 }}
              onClick={e => e.stopPropagation()}>
              {photos.length > 1 && (
                <button onClick={() => move(-1)}
                  style={{ position:"absolute", left:8, background:"rgba(255,255,255,0.1)", border:"none",
                    borderRadius:"50%", width:36, height:36, color:"white", cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}>
                  <ChevronLeft size={18}/>
                </button>
              )}
              <img src={current.url} alt={current.label}
                style={{ maxWidth:"88vw", maxHeight:"100%", objectFit:"contain", borderRadius:10 }}/>
              {photos.length > 1 && (
                <button onClick={() => move(1)}
                  style={{ position:"absolute", right:8, background:"rgba(255,255,255,0.1)", border:"none",
                    borderRadius:"50%", width:36, height:36, color:"white", cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center", zIndex:1 }}>
                  <ChevronRight size={18}/>
                </button>
              )}
            </div>

            {/* Vignettes en bas */}
            {photos.length > 1 && (
              <div onClick={e => e.stopPropagation()}
                style={{ display:"flex", gap:6, overflowX:"auto", padding:"10px 16px calc(10px + env(safe-area-inset-bottom,0px))" }}>
                {photos.map((p, i) => (
                  <img key={i} src={p.url} alt={p.label} onClick={() => setCarousel(c => ({ ...c, index:i }))}
                    style={{ width:48, height:48, objectFit:"cover", borderRadius:6, flexShrink:0, cursor:"pointer",
                      border: i===carousel.index ? "2px solid #3b82f6" : "2px solid transparent", opacity: i===carousel.index ? 1 : 0.55 }}/>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
