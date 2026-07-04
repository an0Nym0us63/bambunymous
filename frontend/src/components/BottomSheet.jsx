import React, { useEffect, useRef } from "react";

/**
 * BottomSheet universel :
 * - croix en haut à droite
 * - handle draggable en haut au centre
 * - swipe down ≥ 80px → ferme
 * - clic backdrop → ferme
 */
export default function BottomSheet({ onClose, children, title, maxHeight = "90dvh", zIndex = 200 }) {
  const sheetRef = useRef(null);
  const startY   = useRef(null);
  const curY     = useRef(0);

  const onTouchStart = (e) => { startY.current = e.touches[0].clientY; };
  const onTouchMove  = (e) => {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy < 0) return; // vers le haut → ignorer
    curY.current = dy;
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
  };
  const onTouchEnd = () => {
    if (curY.current > 80) { onClose(); }
    else if (sheetRef.current) sheetRef.current.style.transform = "";
    startY.current = null; curY.current = 0;
  };

  // Fermer avec Escape
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
      zIndex, display:"flex", alignItems:"flex-end" }}
      onClick={onClose}>
      <div ref={sheetRef} onClick={e => e.stopPropagation()}
        style={{ width:"100%", background:"var(--sheet-bg)",
          borderRadius:"20px 20px 0 0", maxHeight,
          overflowY:"auto", transition:"transform 0.1s",
          paddingBottom:"env(safe-area-inset-bottom,16px)" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}>

        {/* Header : handle + titre + croix */}
        <div style={{ position:"sticky", top:0, background:"var(--sheet-bg)",
          zIndex:1, padding:"12px 16px 8px", display:"flex",
          alignItems:"center", borderBottom: title ? "1px solid var(--border)" : "none" }}>
          {/* Handle centré */}
          <div style={{ position:"absolute", top:8, left:"50%", transform:"translateX(-50%)",
            width:36, height:4, borderRadius:2, background:"var(--border)" }}/>

          {title && (
            <p style={{ fontWeight:700, fontSize:15, color:"var(--text)",
              margin:"10px 0 0", flex:1, paddingRight:32 }}>{title}</p>
          )}
          {!title && <div style={{ height:20, marginTop:8 }}/>}

          <button onClick={onClose}
            style={{ position:"absolute", top:10, right:12, width:28, height:28,
              borderRadius:"50%", background:"var(--surface2)", border:"none",
              cursor:"pointer", display:"flex", alignItems:"center",
              justifyContent:"center", color:"var(--text)", fontSize:16, lineHeight:1 }}>
            ✕
          </button>
        </div>

        <div style={{ padding:"12px 16px 16px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
