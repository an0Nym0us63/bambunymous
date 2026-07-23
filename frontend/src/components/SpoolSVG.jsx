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

// Luminance percue (recommandation ITU-R BT.601) : sert a decider si les
// details du dessin doivent etre clairs ou fonces sur la couleur du filament.
function luminance(hex) {
  const h = (hex||"").replace("#","");
  const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
  return isNaN(r) ? 128 : (r*299+g*587+b*114)/1000;
}

export default function SpoolSVG({ colors, empty, size=68, active, type }) {
  const c1 = colors?.[0] || (empty ? "#2a2a2a" : "#888");
  const multi = colors && colors.length > 1;
  const isGradient = multi && type === "gradient";
  const uid = `sg${Math.random().toString(36).slice(2,7)}`;
  const lum = luminance(c1.replace("#",""));
  const dark = lum < 128;
  // Teinte légèrement plus claire/foncée pour l'anneau extérieur
  const ringColor = dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
  const hubColor  = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.20)";
  const spokeColor= dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.10)";
  const fill = empty ? "none" : c1;
  const patId = `pat${uid}`;

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
        {isGradient && (
          <linearGradient id={uid} x1="10" y1="40" x2="70" y2="40" gradientUnits="userSpaceOnUse">
            {colors.map((cl, i) => (
              <stop key={i} offset={`${Math.round(i/(colors.length-1)*100)}%`} stopColor={cl}/>
            ))}
          </linearGradient>
        )}
      </defs>

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

      {/* Anneau extérieur (léger contour) */}
      <circle cx="40" cy="40" r="30" fill="none" stroke={ringColor} strokeWidth="2"/>

      {/* Zone hub (cercle intérieur plus sombre) */}
      <circle cx="40" cy="40" r="14" fill={hubColor}/>
      {/* Trou central */}
      <circle cx="40" cy="40" r="6" fill={empty ? "#111" : "rgba(0,0,0,0.65)"}/>

      {/* Minuscule reflet */}
      <circle cx="34" cy="34" r="3" fill={dark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.30)"} opacity="0.8"/>

      {/* Animation impression */}
      {active && (
        <circle cx="40" cy="40" r="32" stroke="#3b82f6" strokeWidth="2.5"
          fill="none" strokeDasharray="6 3" opacity="0.9">
          <animateTransform attributeName="transform" type="rotate"
            from="0 40 40" to="360 40 40" dur="8s" repeatCount="indefinite"/>
        </circle>
      )}
    </svg>
  );
}
