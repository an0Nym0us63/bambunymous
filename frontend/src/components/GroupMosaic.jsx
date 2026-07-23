import React, { useState, useEffect, useRef } from "react";

/**
 * Vignette d'un groupe : mosaique de ses photos plutot qu'une seule.
 *
 * Une image unique ne dit pas qu'il y a un groupe derriere, et surtout elle
 * n'en montre qu'un huitieme quand le groupe compte huit pieces. La mosaique
 * repond aux deux : on voit d'un coup d'oeil que c'est un ensemble, et on en
 * voit le contenu.
 *
 * La photo de couverture choisie garde la place dominante -- la definir doit
 * rester utile.
 *
 * Rotation lente et facultative : au-dela de ce que la grille montre, une tuile
 * change toutes les quelques secondes pour laisser entrevoir le reste. Chaque
 * vignette part avec un decalage aleatoire, sinon toute la page clignoterait en
 * cadence. Et rien ne bouge si le systeme demande a limiter les animations.
 */

const layoutFor = (n) => {
  if (n <= 1) return { cells: 1, cols: "1fr", rows: "1fr", areas: null };
  if (n === 2) return { cells: 2, cols: "1fr 1fr", rows: "1fr", areas: null };
  if (n === 3) return {
    cells: 3, cols: "2fr 1fr", rows: "1fr 1fr",
    // La couverture occupe toute la colonne de gauche.
    areas: ['"a b" "a c"'],
  };
  return { cells: 4, cols: "1fr 1fr", rows: "1fr 1fr", areas: null };
};

export default function GroupMosaic({ photos = [], title = "", cover = null }) {
  const urls = photos.map(p => (typeof p === "string" ? p : p?.url)).filter(Boolean);

  // La couverture d'abord, le reste ensuite : l'ordre de la mosaique decoule
  // de la photo choisie, sans la dupliquer.
  const ordered = React.useMemo(() => {
    if (!cover) return urls;
    const idx = urls.findIndex(u => u.endsWith(`/${cover}`));
    if (idx <= 0) return urls;
    return [urls[idx], ...urls.slice(0, idx), ...urls.slice(idx + 1)];
  }, [urls.join("|"), cover]);

  const { cells, cols, rows, areas } = layoutFor(ordered.length);
  const [shown, setShown] = useState(() => ordered.slice(0, cells));

  useEffect(() => { setShown(ordered.slice(0, cells)); }, [ordered.join("|"), cells]);

  // Rotation : uniquement s'il reste des photos non affichees, et jamais sur
  // la case dominante -- la couverture doit rester reconnaissable.
  const extra = ordered.length - cells;
  const nextRef = useRef(cells);
  useEffect(() => {
    if (extra <= 0 || cells < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    // Periode volontairement longue et desynchronisee d'une vignette a l'autre :
    // une grille entiere qui change en cadence serait insupportable.
    const period = 3500 + Math.floor(Math.random() * 2500);
    const id = setInterval(() => {
      setShown(prev => {
        const next = [...prev];
        const slot = 1 + Math.floor(Math.random() * (cells - 1));
        next[slot] = ordered[nextRef.current % ordered.length];
        nextRef.current += 1;
        return next;
      });
    }, period);
    return () => clearInterval(id);
  }, [ordered.join("|"), cells, extra]);

  if (!ordered.length) {
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
        height:"100%", color:"var(--muted)", fontSize:10, padding:6,
        textAlign:"center" }}>{title}</div>
    );
  }

  return (
    <div style={{ width:"100%", height:"100%", display:"grid",
      gridTemplateColumns: cols, gridTemplateRows: rows, gap:1.5,
      gridTemplateAreas: areas ? areas[0] : undefined,
      background:"var(--border)" }}>
      {shown.map((u, i) => (
        <div key={i} style={{ overflow:"hidden", position:"relative",
          gridArea: areas ? ["a","b","c"][i] : undefined,
          background:"var(--surface2)" }}>
          <img src={u} alt="" loading="lazy"
            style={{ width:"100%", height:"100%", objectFit:"cover", display:"block",
              transition:"opacity 0.4s" }}
            onError={e => { e.currentTarget.style.visibility = "hidden"; }}/>
        </div>
      ))}
    </div>
  );
}
