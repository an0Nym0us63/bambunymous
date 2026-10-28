/**
 * Dessin d'une bobine, partage par l'accueil (slots AMS) et la page Bobines.
 *
 * Extrait dans son propre fichier et non exporte depuis AMSSection : celui-ci
 * importe deja FilamentSheetFromSpool depuis pages/Filaments, et Filaments a
 * desormais besoin de ce dessin. Un import croise entre les deux aurait forme
 * un cycle -- que les bundlers tolerent, mais au prix d'un composant parfois
 * undefined a l'evaluation, panne difficile a diagnostiquer. Un module feuille,
 * sans dependance vers l'un ou l'autre, supprime le probleme.
 */

import { useId } from "react";
import { finishImage, tierOf, TIER_PX } from "../utils/finishTex";

// Luminance percue (recommandation ITU-R BT.601) : sert a decider si les
// details du dessin doivent etre clairs ou fonces sur la couleur du filament.
function luminance(hex) {
  const h = (hex||"").replace("#","");
  const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
  return isNaN(r) ? 128 : (r*299+g*587+b*114)/1000;
}

// Couleur translucide ? Gere les deux formats qui arrivent ici : #RRGGBBAA
// (page Bobines, via parseColorsList) ET rgba(r,g,b,a) (slots AMS accueil, via
// hexToCss qui convertit deja l'alpha en rgba).
function _translucent(c) {
  const s = String(c || "");
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s.slice(7).toLowerCase() !== "ff";
  const m = s.match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i);
  return m ? parseFloat(m[1]) < 1 : false;
}

// La finition du filament (28/10/2026), dessinee sur le disque : les memes que les pastilles (utils/colors).
// tile : la tuile imposee, en unites du dessin (une zone etroite comme le corps d'une buse : la tuile a sa largeur,
// pour que le motif y tienne en entier) ; tier : le palier impose
export function FinishDefs({ f, id, size = 68, units = 80, dark = false, tile = null, tier = null }) {
  if (f === "silk") return <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
    <stop offset="20%" stopColor="#fff" stopOpacity="0"/><stop offset="45%" stopColor="#fff" stopOpacity=".55"/><stop offset="62%" stopColor="#fff" stopOpacity="0"/></linearGradient>;
  if (f === "metal") return <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stopColor="#fff" stopOpacity=".55"/><stop offset="35%" stopColor="#fff" stopOpacity="0"/>
    <stop offset="60%" stopColor="#000" stopOpacity=".3"/><stop offset="85%" stopColor="#fff" stopOpacity=".35"/></linearGradient>;
  // paillettes, galaxie, marbre, carbone : le meme dessin que les pastilles et la vue 3D (utils/finishTex)
  // le palier suit la taille affichee ; la tuile est convertie en unites du dessin (viewBox de `units`)
  const tr = tier || tierOf(size), img = finishImage(f, tr, dark), tl = tile || (TIER_PX[tr] || 64) * units / Math.max(1, size);
  if (img) return <pattern id={id} patternUnits="userSpaceOnUse" width={tl} height={tl}>
    <image href={img} width={tl} height={tl}/></pattern>;
  if (f === "glow") return <radialGradient id={id}>
    <stop offset="0%" stopColor="#f0ffe6" stopOpacity=".85"/><stop offset="35%" stopColor="#dcffc8" stopOpacity=".45"/><stop offset="70%" stopColor="#dcffc8" stopOpacity="0"/></radialGradient>;
  return null;
}

// Le bois (28/10/2026) : des cernes irreguliers, ondules et decentres, alternant veine sombre et bois clair, et
// deux fentes de sechage -- une coupe de tronc, pas des cercles. Claires sur un bois fonce, sombres sinon.
const WOOD_RINGS = (() => {
  const out = [];
  const radii = [15.5, 17.2, 18.6, 20.6, 22.1, 23.4, 25.3, 26.6, 28.4];
  radii.forEach((r, k) => {
    // meme ondulation d'un cerne a l'autre (a peine decalee) : ils ne se croisent pas, comme dans un tronc
    const ph = k * 0.25, pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * 2 * Math.PI;
      const rr = r + 0.9 * Math.sin(3 * a + ph) + 0.35 * Math.sin(7 * a + ph);
      pts.push(`${(41 + rr * Math.cos(a)).toFixed(2)} ${(39.5 + rr * Math.sin(a)).toFixed(2)}`);
    }
    out.push({ d: `M${pts.join("L")}Z`, w: [1.3, 0.6, 0.9, 1.6, 0.6, 1.1, 0.8, 1.4, 0.7][k], light: k % 3 === 1 });
  });
  return out;
})();
function WoodGrain({ dark, id }) {
  const vein = dark ? "rgba(255,225,180,.38)" : "rgba(75,40,12,.42)";
  const pale = dark ? "rgba(0,0,0,.25)" : "rgba(255,240,215,.45)";
  return <g>
    <clipPath id={id}><circle cx="40" cy="40" r="29.5"/></clipPath>
    <g clipPath={`url(#${id})`}>
      {WOOD_RINGS.map((x, i) => <path key={i} d={x.d} fill="none" stroke={x.light ? pale : vein} strokeWidth={x.w} strokeLinejoin="round"/>)}
      <path d="M58 22 L62.5 18.5 M21 56 L17.5 60.5" stroke={vein} strokeWidth="1" strokeLinecap="round"/>
    </g>
  </g>;
}

export default function SpoolSVG({ colors, empty, size=68, active, type, finish = null }) {
  const c1 = colors?.[0] || (empty ? "#2a2a2a" : "#888");
  const multi = colors && colors.length > 1;
  const isGradient = multi && type === "gradient";
  // un identifiant stable d'un rendu a l'autre (un nouveau a chaque rendu redefinissait les degrades de
  // toutes les bobines de l'accueil a chaque lecture de l'imprimante)
  const uid = "sg" + useId().replace(/:/g, "");
  const lum = luminance(c1.replace("#",""));
  const dark = lum < 128;
  // Teinte légèrement plus claire/foncée pour l'anneau extérieur
  const ringColor = dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
  const hubColor  = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.20)";
  const spokeColor= dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.10)";
  const fill = empty ? "none" : c1;
  const patId = `pat${uid}`;
  const transp = !empty && !!colors?.some(_translucent);
  const cbId = `cb${uid}`;
  const fin = empty ? null : finish;
  const finId = `fn${uid}`;

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      {/* Ombre portée */}
      <ellipse cx="40" cy="75" rx="22" ry="3" fill="rgba(0,0,0,0.20)"/>

      <defs>
        {empty && (
          <pattern id={patId} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(148,163,184,0.25)" strokeWidth="3"/>
          </pattern>
        )}
        {transp && (
          <pattern id={cbId} patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="8" height="8" fill="#f0f0f0"/>
            <rect width="4" height="4" fill="#c0c0c0"/>
            <rect x="4" y="4" width="4" height="4" fill="#c0c0c0"/>
          </pattern>
        )}
        {active && (
          <linearGradient id={`cm${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0"/>
            <stop offset="70%" stopColor="#3b82f6" stopOpacity="0.9"/>
            <stop offset="100%" stopColor="#bfdbfe" stopOpacity="1"/>
          </linearGradient>
        )}
        {fin && <FinishDefs f={fin} id={finId} size={size} dark={dark}/>}
        {fin === "glow" && <filter id={`gl${uid}`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3.5"/></filter>}
        {isGradient && (
          <linearGradient id={uid} x1="10" y1="40" x2="70" y2="40" gradientUnits="userSpaceOnUse">
            {colors.map((cl, i) => (
              <stop key={i} offset={`${Math.round(i/(colors.length-1)*100)}%`} stopColor={cl}/>
            ))}
          </linearGradient>
        )}
      </defs>

      {/* En cours : un halo bleu qui respire derriere la bobine */}
      {active && <circle cx="40" cy="40" r="34" fill="rgba(59,130,246,0.22)"
        style={{ transformBox: "view-box", transformOrigin: "40px 40px", animation: "bn-spool-glow 2.4s ease-in-out infinite" }}/>}

      {/* phosphorescent : un halo de sa couleur autour */}
      {fin === "glow" && <>
        <circle cx="40" cy="40" r="36" fill={c1} opacity=".9" filter={`url(#gl${uid})`}/>
        <circle cx="40" cy="40" r="32" fill="#fff" opacity=".35" filter={`url(#gl${uid})`}/></>}

      {/* Damier de transparence derrière le disque : rend l'alpha visible. */}
      {transp && <circle cx="40" cy="40" r="30" fill={`url(#${cbId})`}/>}

      {/* Disque principal — couleur exacte, dégradé lisse, ou secteurs selon le type */}
      {!empty && isGradient ? (
        <circle cx="40" cy="40" r="30" fill={`url(#${uid})`}/>
      ) : multi && !empty ? (
        // Secteurs de couleur (pie chart SVG) — coaxial et autres types.
        //
        // Depart a 6h (+PI/2) et non a midi : les secteurs tournent dans le sens
        // horaire, si bien qu'un depart a midi placait la PREMIERE couleur a
        // DROITE. Or partout ailleurs -- bandeau des tuiles, pastilles, aplats
        // du nuancier -- colorBg la place a GAUCHE. La meme bobine se lisait
        // donc en miroir selon l'element regarde. Le degrade, lui, etait deja
        // oriente de gauche a droite et n'a pas bouge.
        colors.map((cl, i) => {
          const total = colors.length;
          const startAngle = (i / total) * 2 * Math.PI + Math.PI / 2;
          const endAngle   = ((i + 1) / total) * 2 * Math.PI + Math.PI / 2;
          const x1 = 40 + 30 * Math.cos(startAngle);
          const y1 = 40 + 30 * Math.sin(startAngle);
          const x2 = 40 + 30 * Math.cos(endAngle);
          const y2 = 40 + 30 * Math.sin(endAngle);
          const large = total === 1 ? 1 : 0;
          return (
            <path key={i}
              d={`M 40 40 L ${x1.toFixed(2)} ${y1.toFixed(2)} A 30 30 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`}
              fill={cl}/>
          );
        })
      ) : (
        <circle cx="40" cy="40" r="30" fill={empty ? `url(#${patId})` : fill}/>
      )}

      {/* la finition, par-dessus la couleur : reflet, paillettes, mouchetures, tissage, lueur ; le bois en cernes */}
      {fin && fin !== "wood" && fin !== "matte" && <path fillRule="evenodd" fill={`url(#${finId})`}
        d="M10 40a30 30 0 1 0 60 0a30 30 0 1 0-60 0ZM26 40a14 14 0 1 1 28 0a14 14 0 1 1-28 0Z"/>}
      {fin === "wood" && <WoodGrain dark={dark} id={`wd${uid}`}/>}
      {fin === "matte" && <circle cx="40" cy="40" r="29.5" fill="none" stroke="rgba(0,0,0,.18)" strokeWidth="1"/>}

      {/* Anneau extérieur (léger contour) */}
      <circle cx="40" cy="40" r="30" fill="none" stroke={ringColor} strokeWidth="2"/>

      {/* Zone hub (cercle intérieur plus sombre) ; en cours, il tourne (le repère le montre) */}
      <g style={active ? { transformBox: "view-box", transformOrigin: "40px 40px", animation: "spin 6s linear infinite" } : undefined}>
        <circle cx="40" cy="40" r="14" fill={hubColor}/>
        {/* Trou central */}
        <circle cx="40" cy="40" r="6" fill={empty ? "#111" : "rgba(0,0,0,0.65)"}/>
        {/* un repere sur le moyeu : on voit la bobine tourner */}
        {active && <circle cx="40" cy="31" r="1.8" fill={dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.35)"}/>}
      </g>

      {/* Minuscule reflet */}
      <circle cx="34" cy="34" r="3" fill={dark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.30)"} opacity="0.8"/>

      {/* Animation impression */}
      {/* En cours : une trainee lumineuse fait le tour (animations CSS : l'animation SVG
          animateTransform restait parfois figee au rechargement de la page) */}
      {active && <>
        <circle cx="40" cy="40" r="33" stroke="rgba(59,130,246,0.25)" strokeWidth="2" fill="none"/>
        <circle cx="40" cy="40" r="33" stroke={`url(#cm${uid})`} strokeWidth="3" strokeLinecap="round" fill="none"
          strokeDasharray="70 140" style={{ transformBox: "view-box", transformOrigin: "40px 40px", animation: "spin 2.2s linear infinite",
            filter: "drop-shadow(0 0 2px #3b82f6)" }}/>
      </>}
    </svg>
  );
}
