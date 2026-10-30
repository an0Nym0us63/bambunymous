import React, { useState, useRef, useEffect, useCallback } from "react";
import { apiThumb } from "../api/client";
import { X, ChevronLeft, ChevronRight, Check } from "lucide-react";
import AdminOnly from "./AdminOnly";
import Lightbox from "./Lightbox";
import { showAlert, showConfirm } from "../utils/dialog";
import CycleImg from "./CycleImg";
const isVideoUrl = (u) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u || "");

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
  onDeletePhoto, onSetPrimaryPhoto, onPhotosChanged,
  items, getId, getCoverImage, getPhotos, getTitle, getSubtitle, compareFields = [],
  maxCompare = 6, emptyLabel = "Aucun élément", pageSize = 30,
  enableCompare = true, renderCover = null, swatchMode = false, swatchInfo = false, getTone = null, preselect = null, stage = false,
  selectMode: selectModeProp = false, onSelectModeChange = null,
  onItemClick = null,
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
  const pressFired  = React.useRef(false);   // le clic qui suit l'appui long ne decoche pas
  const startPress  = (item, clientX, clientY) => {
    pressOrigin.current = { x: clientX, y: clientY };
    pressFired.current  = false;
    pressTimer.current  = setTimeout(() => {
      pressFired.current = true;
      if (navigator.vibrate) navigator.vibrate(15);
      changeSelectMode(true);
      if (!selected.has(getId(item))) toggle(item);
    }, 500);
  };
  // Venu d'ailleurs (appui long dans la vue Photos) : arrive deja coche.
  React.useEffect(() => {
    if (!preselect?.length) return;
    setSelectMode(true);
    setSelected(new Map(preselect.map(it => [getId(it), it])));
  }, [preselect]);
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
    return <div style={{ padding:"26px 16px", borderRadius:18, border:"1px dashed var(--border)", textAlign:"center",
      background:"radial-gradient(80% 80% at 50% 0%, rgba(236,72,153,0.12), transparent 70%), var(--surface2)" }}>
      <div style={{ fontSize:30, marginBottom:6 }}>🖼️</div>
      <p style={{ color:"var(--muted)", fontSize:13, fontWeight:600, margin:0 }}>{emptyLabel}</p></div>;
  }

  const visibleItems = items.slice(0, visibleCount);

  return (
    <div style={{ position:"relative" }}>

      <div style={{ display:"grid",
        gridTemplateColumns: swatchMode
          ? `repeat(auto-fill,minmax(${swatchInfo ? 108 : 72}px,1fr))`
          // 110 px sur telephone (inchange), jusqu'a 180 px sur grand ecran :
          // a 110 px partout, un ordinateur alignait 8 vignettes minuscules.
          : "repeat(auto-fill,minmax(clamp(110px, 18vw, 180px),1fr))",
        gap: swatchMode ? (swatchInfo ? 6 : 3) : 10,
        paddingBottom: (enableCompare && selectedList.length) ? 76 : 0 }}>
        {visibleItems.map(item => {
          const id = getId(item);
          const img = getCoverImage ? getCoverImage(item) : null;
          const checked = selected.has(id);
          const photos = normPhotos(item);
          const hasPhotos = photos.length > 0;
          const light = swatchInfo && getTone ? getTone(item) === "light" : false;
          return (
            <div key={id}
              onClick={() => { if (pressFired.current) { pressFired.current = false; return; }
                if (selectMode && enableCompare) { toggle(item); return; }
                if (stage && onItemClick && onItemClick(item) !== false) return;      // les vues 3D : la page ouvre la 3D
                if (hasPhotos) openCarousel(item, 0); else if (onItemClick && !stage) onItemClick(item); }}
              onMouseDown={e => enableCompare && startPress(item, e.clientX, e.clientY)}
              onMouseMove={e => movePress(e.clientX, e.clientY)}
              onMouseUp={cancelPress} onMouseLeave={cancelPress}
              onTouchStart={e => { const t=e.touches[0]; enableCompare && startPress(item, t.clientX, t.clientY); }}
              onTouchMove={e => { const t=e.touches[0]; movePress(t.clientX, t.clientY); }}
              onTouchEnd={cancelPress}
              onContextMenu={e => e.preventDefault()}
              style={{ position:"relative", borderRadius: swatchMode ? 10 : 16, overflow:"hidden", cursor:"pointer",
                aspectRatio: swatchInfo || stage ? undefined : "1",
                // les vues 3D (30/10/2026) : le modele pose sur un sol de studio, le nom dessous, rien par-dessus
                background: stage ? "var(--surface)" : "var(--surface2)",
                display: swatchInfo || stage ? "flex" : undefined, flexDirection:"column",
                border: checked ? "2px solid #3b82f6" : "2px solid transparent",
                boxShadow: checked ? "0 0 0 3px rgba(59,130,246,0.3), 0 10px 24px -12px #3b82f6" : swatchMode ? "none" : "0 8px 20px -14px rgba(0,0,0,.6)",
                transform: checked ? "scale(.97)" : "none", transition:"transform .15s, box-shadow .15s" }}>
              {swatchInfo ? (
                // Nuancier avec ses informations : la couleur occupe toute la
                // tuile, le texte vit sur un voile translucide en bas. Un
                // bandeau plein mangeait la moitie de la hauteur ; le voile
                // laisse la teinte lisible sur les trois quarts du haut.
                <>
                  <div style={{ position:"absolute", inset:0 }}>{renderCover(item)}</div>
                  <div style={{ height:86 }}/>
                  <div style={{ position:"relative", marginTop:"auto", padding:"4px 7px 5px",
                    display:"flex", flexDirection:"column", gap:0, minWidth:0,
                    // Voile choisi d'apres la TEINTE et non le theme : un voile
                    // sombre sur du blanc, ou clair sur du noir, rendait le nom
                    // illisible.
                    background: light ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.38)",
                    backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)" }}>
                    <p title={getTitle(item)} style={{ fontSize:10.5, fontWeight:700, color: light ? "#111827" : "#fff", margin:0,
                      lineHeight:1.25, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2,
                      WebkitBoxOrient:"vertical" }}>{getTitle(item)}</p>
                    {getSubtitle && (
                      <p title={getSubtitle(item)} style={{ fontSize:9, color: light ? "rgba(17,24,39,0.7)" : "rgba(255,255,255,0.78)", margin:0,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{getSubtitle(item)}</p>
                    )}
                  </div>
                </>
              ) : stage ? (
                <>
                  <div className="bn-stage" style={{ position:"relative", aspectRatio:"1", overflow:"hidden",
                    // le studio : un fond qui s'eclaire vers le haut, un sol plus sombre, la ligne d'horizon fondue
                    background:"radial-gradient(65% 50% at 50% 34%, color-mix(in srgb, #38BDF8 24%, transparent), transparent 75%),"
                      + "linear-gradient(180deg, color-mix(in srgb, #0EA5E9 8%, var(--surface2)) 0%, var(--surface2) 68%, color-mix(in srgb, #0f172a 9%, var(--surface2)) 68.5%, color-mix(in srgb, #0f172a 4%, var(--surface2)) 100%)" }}>
                    {/* l'ombre de contact, sous la base : la vue touche le sol (elle flottait) */}
                    <div style={{ position:"absolute", left:"18%", right:"18%", bottom:"9%", height:"9%", borderRadius:"50%",
                      background:"radial-gradient(closest-side, rgba(0,0,0,.30), rgba(0,0,0,.08) 60%, transparent)" }}/>
                    {/* toutes les vues de l'impression, l'une apres l'autre en fondu (30/10/2026) */}
                    {renderCover ? renderCover(item) : (() => {
                      // seulement les vues retenues comme vignette (⭐), s'il y en a plusieurs
                      const phs = (getPhotos && getPhotos(item)) || [], kept = phs.filter(ph => ph?.sel);
                      const urls = [...new Set(kept.map(ph => ph.url).filter(Boolean))];
                      const one = (u, on = true) => <img className="bn-stage-img" src={`${apiThumb(u, 384)}&trim=1`} alt={getTitle(item)} loading="lazy" decoding="async"
                        style={{ position:"absolute", left:"6%", top:"5%", width:"88%", height:"83%", objectFit:"contain", objectPosition:"50% 100%",
                          filter:"drop-shadow(0 3px 3px rgba(0,0,0,.25))", transformOrigin:"50% 100%", transition:"transform .25s, opacity .8s ease", opacity: on ? 1 : 0 }}/>;
                      return urls.length > 1 ? <CycleImg urls={urls} render={one}/> : img && one(img);
                    })()}
                  </div>
                  <div style={{ padding:"7px 10px 8px", borderTop:"1px solid var(--border)" }}>
                    <p title={getTitle(item)} style={{ fontSize:"clamp(11.5px, 1.15vw, 13px)", color:"var(--text)", fontWeight:800, margin:0, lineHeight:1.25,
                      overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{getTitle(item)}</p>
                  </div>
                  <style>{".bn-stage:hover .bn-stage-img{transform:scale(1.05)}"}</style>
                </>
              ) : renderCover ? renderCover(item) : img ? (
                <img src={apiThumb(img, 384)} alt={getTitle(item)} loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"cover" }}
                  onError={e => { e.currentTarget.style.display="none"; }}/>
              ) : (
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%",
                  color:"var(--muted)", fontSize:10, padding:6, textAlign:"center" }}>{getTitle(item)}</div>
              )}
              {/* Liseré du nuancier : en surimpression, sinon le calque de couleur
                  (enfant) recouvre l'ombre interne posee sur le conteneur.
                  Pas un border : sur un element peint, une bordure translucide
                  laisse transparaitre le fond (halo). */}
              {swatchMode && !checked && (
                <div style={{ position:"absolute", inset:0, borderRadius:8,
                  pointerEvents:"none",
                  boxShadow:"inset 0 0 0 1px rgba(0,0,0,0.22)" }}/>
              )}
              {photos.length > 1 && !swatchMode && (
                <span style={{ position:"absolute", top:6, right:6, background: stage ? "color-mix(in srgb, #0EA5E9 18%, var(--surface))" : "rgba(15,23,42,0.6)",
                  color: stage ? "#0284c7" : "white", backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)",
                  fontSize:10, fontWeight:800, padding:"2px 7px", borderRadius:20 }}>
                  {stage ? "🧊" : "📷"} {photos.length}
                </span>
              )}
              {enableCompare && selectMode && (
                <button onClick={e => { e.stopPropagation(); toggle(item); }}
                  style={{ position:"absolute", top:6, left:6, width:24, height:24, borderRadius:8,
                    border: checked ? "none" : "1.5px solid rgba(255,255,255,0.8)",
                    background: checked ? "linear-gradient(135deg, #3B82F6, #6366F1)" : "rgba(15,23,42,0.4)",
                    display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:0 }}>
                  {checked && <Check size={13} color="white" strokeWidth={3}/>}
                </button>
              )}
              {/* Un nuancier montre des couleurs : pas de voile sombre ni de texte
                  par-dessus, qui fausseraient la lecture de la teinte. */}
              {!swatchMode && !stage && (
                <div style={{ position:"absolute", bottom:0, left:0, right:0,
                  background:"linear-gradient(transparent, rgba(2,6,23,0.85))", padding:"26px 9px 7px" }}>
                  <p style={{ fontSize:"clamp(11px, 1.15vw, 13px)", color:"white", fontWeight:800, margin:0, textShadow:"0 1px 4px rgba(0,0,0,.5)",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{getTitle(item)}</p>
                  {getSubtitle && (
                    <p style={{ fontSize:"clamp(9px, 0.95vw, 11px)", color:"rgba(255,255,255,0.75)", margin:"1px 0 0",
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{getSubtitle(item)}</p>
                  )}
                </div>
              )}
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
        <div style={{ position:"fixed", bottom:"calc(76px + env(safe-area-inset-bottom,0px))", left:12, right:12, zIndex:500, maxWidth:620, margin:"0 auto",
          background:"color-mix(in srgb, var(--sheet-bg) 92%, transparent)", backdropFilter:"blur(10px)", WebkitBackdropFilter:"blur(10px)",
          border:"1px solid rgba(59,130,246,0.5)", borderRadius:18,
          padding:8, display:"flex", alignItems:"center", gap:8, boxShadow:"0 14px 34px -10px rgba(59,130,246,0.45)" }}>
          <div style={{ display:"flex", gap:4, overflowX:"auto", flex:1 }}>
            {selectedList.map(item => (
              <div key={getId(item)} style={{ position:"relative", flexShrink:0, width:36, height:36, borderRadius:10, overflow:"hidden" }}>
                {renderCover ? renderCover(item) :
                  <img src={apiThumb(getCoverImage ? getCoverImage(item) : null, 96)} alt="" style={{ width:32, height:32, objectFit:"cover" }}/>}
                <button onClick={() => toggle(item)}
                  style={{ position:"absolute", top:-4, right:-4, width:14, height:14, borderRadius:"50%",
                    background:"#ef4444", border:"none", color:"white", fontSize:9, cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
              </div>
            ))}
          </div>
          <span style={{ fontSize:11.5, fontWeight:800, color:"var(--muted)", flexShrink:0 }}>{selectedList.length}/{maxCompare}</span>
          <button onClick={() => setCompareOpen(true)} disabled={selectedList.length < 2}
            style={{ padding:"8px 13px", borderRadius:12, fontSize:12.5, fontWeight:800, flexShrink:0,
              background: selectedList.length<2 ? "var(--border)" : "linear-gradient(135deg, #3B82F6, #6366F1)",
              color: selectedList.length<2 ? "var(--muted)" : "white",
              border:"none", cursor: selectedList.length<2 ? "default" : "pointer" }}>
            Comparer
          </button>
          <button onClick={() => setSelected(new Map())}
            style={{ padding:"8px 11px", borderRadius:12, fontSize:12.5, fontWeight:800, flexShrink:0,
              background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text2)", cursor:"pointer" }}>
            Vider
          </button>
        </div>
      )}

      {/* Modal comparaison */}
      {enableCompare && compareOpen && (
        <div onClick={() => setCompareOpen(false)} style={{ position:"fixed", inset:0, zIndex:1300,
          background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div data-no-pull="" onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)",
            borderRadius:"22px 22px 0 0", width:"100%", maxWidth:720, maxHeight:"88dvh", overflowY:"auto",
            padding:"0 16px calc(16px + env(safe-area-inset-bottom,0px))" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, margin:"0 -16px 14px", padding:"16px 16px 12px",
              background:"linear-gradient(135deg, rgba(59,130,246,0.22), transparent 70%)" }}>
              <span style={{ width:36, height:36, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17,
                background:"linear-gradient(135deg, #3B82F6, #6366F1)", color:"#fff" }}>⚖️</span>
              <h3 style={{ flex:1, fontSize:16, fontWeight:900, color:"var(--text)", margin:0 }}>
                Comparer ({selectedList.length})
              </h3>
              <button onClick={() => setCompareOpen(false)}
                style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"50%", width:34, height:34,
                  cursor:"pointer", color:"var(--text2)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <X size={15}/>
              </button>
            </div>
            <div style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:6 }}>
              {selectedList.map(item => (
                <div key={getId(item)} style={{ flexShrink:0, width:164, border:"1px solid var(--border)", borderRadius:16, padding:10,
                  background:"linear-gradient(160deg, rgba(59,130,246,0.10), transparent 50%), var(--surface2)" }}>
                  <div onClick={() => { if (normPhotos(item).length) openCarousel(item, 0); }}
                    style={{ width:"100%", aspectRatio:"1", borderRadius:12, overflow:"hidden",
                      cursor: normPhotos(item).length ? "pointer" : "default", marginBottom:8, background:"var(--surface2)" }}>
                    {renderCover ? renderCover(item) : (
                      <img src={apiThumb(getCoverImage ? getCoverImage(item) : null, 384)} alt={getTitle(item)}
                        style={{ width:"100%", height:"100%", objectFit:"cover" }}
                        onError={e => { e.currentTarget.style.display="none"; }}/>
                    )}
                  </div>
                  <p style={{ fontSize:12.5, fontWeight:800, color:"var(--text)", margin:"0 0 6px",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{getTitle(item)}</p>
                  {compareFields.map(([label, fn]) => (
                    <div key={label} style={{ display:"flex", justifyContent:"space-between", gap:6,
                      fontSize:11, padding:"4px 0", borderTop:"1px dashed var(--border)" }}>
                      <span style={{ color:"var(--muted)", fontWeight:700 }}>{label}</span>
                      <span style={{ color:"var(--text)", fontWeight:900, textAlign:"right",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fn(item) ?? "—"}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Carrousel plein écran — photos du print/groupe/filament cliqué : la visionneuse commune,
          avec ici « Fiche » et, pour l'admin, supprimer / mettre en principale */}
      {carousel && normPhotos(carousel.item).length > 0 && (
        <Lightbox index={carousel.index} title={getTitle(carousel.item)}
          // une legende parlante seulement : pas « manual » ni « Photo-01.webp »
          images={normPhotos(carousel.item).map(p => ({ ...p, label: /^(manual|auto|snapshot.*)$|\.(webp|jpe?g|png|gif|mp4|mov|webm|m4v)$/i.test(p.label || "") ? "" : p.label }))}
          onIndex={i => setCarousel(c => c && c.index !== i ? { ...c, index: i } : c)}
          onClose={() => setCarousel(null)}
          actions={(i, close) => {
            const cur = normPhotos(carousel.item)[i];
            const filename = cur?.url ? cur.url.split("/").pop() : null;
            const pill = (bg, c, bd) => ({ padding:"10px 18px", borderRadius:22, cursor:"pointer", fontSize:13.5, fontWeight:900, color:c,
              background:bg, border: bd ? `1px solid ${bd}` : "none", backdropFilter:"blur(10px)", WebkitBackdropFilter:"blur(10px)" });
            return <>
              {onItemClick && <button onClick={() => { close(); onItemClick(carousel.item); }}
                style={{ ...pill("linear-gradient(135deg, #3B82F6, #6366F1)", "#fff"), boxShadow:"0 10px 22px -8px #3B82F6" }}>📄 Fiche</button>}
              {/* Actions photo : fournies par l'appelant (elles etaient cablees en dur sur les photos
                  d'un FILAMENT, y compris dans la galerie des prints), absentes la ou elles n'ont pas de sens. */}
              {filename && onDeletePhoto && <AdminOnly>
                <button onClick={async () => {
                  if (!(await showConfirm("Supprimer cette photo ?", { danger: true, confirmLabel: "Supprimer" }))) return;
                  await onDeletePhoto(carousel.item, filename);
                  close(); onPhotosChanged?.(); }}
                  style={pill("rgba(239,68,68,0.22)", "#fecaca", "rgba(239,68,68,0.45)")}>🗑 Supprimer</button>
                {onSetPrimaryPhoto && i !== 0 && <button onClick={async () => {
                  await onSetPrimaryPhoto(carousel.item, filename);
                  close(); onPhotosChanged?.(); }}
                  style={pill("rgba(34,197,94,0.22)", "#bbf7d0", "rgba(34,197,94,0.45)")}>⭐ Principale</button>}
              </AdminOnly>}
            </>;
          }}/>
      )}
    </div>
  );
}
