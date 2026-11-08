// La vue 3D d'une piece, en lecture seule (04/11/2026 pour la vitrine ; partagee le 08/11/2026 avec le diaporama de la
// galerie des vues 3D) : l'assemblage s'il y en a un, avec le moteur de l'appli, charge a la demande. load() rend la
// description de la vue (la vitrine la lit par son lien public, l'appli par le compte).
import React, { useEffect, useMemo, useState } from "react";

const glassTag = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", padding: "4px 9px", borderRadius: 20, background: "rgba(0,0,0,.45)", color: "#fff",
  backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" };
const SPIN = "@keyframes p3dSpin{to{transform:rotate(360deg)}}.p3d-spin{width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.12);animation:p3dSpin .9s linear infinite;display:inline-block}";

// la vue 3D d'une piece (l'assemblage s'il y en a un), avec le moteur de l'appli, charge seulement a la demande
// les effets comme dans la vue de l'appli (04/11/2026) : finitions et multicolores du plateau montre, ceux de chaque
// piece d'un assemblage (le plateau d'ou elle vient), la lueur des phosphorescents, les couleurs par hauteur d'un lithophane
export default function Piece3D({ load, accent = "#8B5CF6", hint = true }) {
  const [st, setSt] = useState({ load: true });
  const [vs, setVs] = useState({});                   // ce que le moteur dit de la vue (dont « glow » : des phosphorescents)
  const [V, setV] = useState(null);
  useEffect(() => {
    let alive = true;
    setSt({ load: true });
    Promise.all([load(), import("./Model3D")]).then(([m, mod]) => { if (!alive) return; setV(() => mod.Model3DViewer); setSt({ m, isGlb: mod.isGlb }); })
      .catch(() => alive && setSt({ error: true }));
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- une piece par composant (key)
  const m = st.m;
  const plate = m ? ((m.plates || []).find(p => p.assembled && !p.skipped) || (m.plates || []).find(p => !p.skipped)) : null;
  const n = plate ? String(plate.n) : null;
  const pal = m && n ? (m.used_plates?.[n] || m.used_palette || null) : null;
  const piecePal = useMemo(() => {
    if (!plate?.assembled || !pal || !plate.pieces) return null;
    const out = {};
    for (const pc of Object.values(plate.pieces)) {
      const pn = m.piece_plates?.[String(pc.k || "").split(":").slice(0, 2).join(":")];
      const pp = pn != null ? m.used_plates?.[String(pn)] : null;
      if (pp) out[pc.k] = { ...pal, ...pp };
    }
    return Object.keys(out).length ? out : null;
  }, [m, plate, pal]);
  const pieceFx = useMemo(() => {
    if (!plate?.assembled || !pal || !plate.pieces) return null;
    const fin = {}, mul = {};
    for (const pc of Object.values(plate.pieces)) {
      const pn = m.piece_plates?.[String(pc.k || "").split(":").slice(0, 2).join(":")];
      if (pn == null || !m.used_plates?.[String(pn)]) continue;
      fin[pc.k] = m.used_finishes_plates?.[String(pn)] || {};
      mul[pc.k] = m.used_multi_plates?.[String(pn)] || {};
    }
    return Object.keys(fin).length ? { fin, mul } : null;
  }, [m, plate, pal]);
  // les finitions et multicolores du plateau montre (une seule fois par vue : le moteur ne doit pas recevoir un objet neuf
  // a chaque rendu)
  const fx = useMemo(() => {
    if (!m || !plate) return {};
    const byPlate = m.used_plates && Object.keys(m.used_plates).length > 0;
    return { fin: pal ? (byPlate ? m.used_finishes_plates?.[n] || {} : m.used_finishes) : m.finishes,
             multi: pal ? (byPlate ? m.used_multi_plates?.[n] || {} : m.used_multi) : null,
             hue: plate.litho && (plate.z_colors || []).length ? plate.z_colors : null };
  }, [m, plate, pal, n]);
  if (st.error || (!st.load && V && !plate)) return <Center>La vue 3D n'est pas disponible pour cette pièce.</Center>;
  if (st.load || !V) return <Center><style>{SPIN}</style><span className="p3d-spin" style={{ borderTopColor: accent }}/>Préparation de la vue 3D…</Center>;
  return <div style={{ position: "absolute", inset: 0 }}>
    <V url={plate.url} glb={st.isGlb(plate.url)} onState={setVs} palette={pal} piecePalettes={piecePal} finishes={fx.fin} multi={fx.multi} glows={m.glows || null}
      glow={!!vs.glow} pieceFinishes={pieceFx?.fin || null} pieceMulti={pieceFx?.mul || null} hue={fx.hue}
      pieces={plate.assembled ? plate.pieces : null} edit={plate.assembled ? m.assembly_edit : null} litho={!!plate.litho} bare/>
    {hint && <span style={{ position: "absolute", left: 14, bottom: 14, ...glassTag, pointerEvents: "none" }}>
      {plate.assembled ? "Assemblage · " : ""}glisser pour tourner · molette ou pincer pour zoomer</span>}
  </div>;
}

const Center = ({ children }) => <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 14, alignItems: "center", justifyContent: "center",
  color: "rgba(255,255,255,.7)", fontSize: 14, textAlign: "center", padding: 20 }}>{children}</div>;
