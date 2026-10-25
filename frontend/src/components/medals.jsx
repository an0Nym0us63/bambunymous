// La medaille d'un succes, la carte a jouer, le ticket et l'ecusson des grades : sortis de la
// page des succes (25/10/2026) pour que l'accueil, qui les montre dans ses tuiles, n'ait plus
// a charger toute cette page avant son premier affichage.
import React from "react";

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

// Medaille : disque a la teinte du cran, liseré, ruban ; grisee tant qu'elle
// n'est pas gagnee.
// Une carte a jouer : de dos tant qu'elle n'est pas gagnee ; de face, son rang
// dans les coins et l'enseigne de sa section au centre. L'As a le liseré
// arc-en-ciel de l'Eternel, le Joker d'or brille.
export const CARD_ORDER = ["card_v", "card_d", "card_r", "card_a", "card_jv", "card_jd", "card_jr", "card_ja"];
function PlayCard({ tier, emoji, size, locked }) {
  const h = size, w = Math.round(size * 0.72), c = tier.color;
  // dos : une couleur trop sombre (l'As, noir comme l'Eternel) se perdrait sur le tapis
  const n = parseInt(c.slice(1), 16), dark = ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 80;
  const bc = dark ? "#C4B5FD" : c;
  const r = Math.max(3, size * 0.11), b = Math.max(1.2, size / 30);
  const corners = size >= 34, gold = tier.id === "card_ja" || tier.id === "jokers", ace = tier.id === "card_a";
  const corner = flip => (
    <span style={{ position:"absolute", [flip ? "bottom" : "top"]: size * 0.04, [flip ? "right" : "left"]: size * 0.06,
      transform: flip ? "rotate(180deg)" : "none", fontSize: size * 0.2, fontWeight:900, lineHeight:1,
      fontFamily:"Georgia, 'Times New Roman', serif", color: gold ? "#7a5300" : c }}>{tier.card}</span>
  );
  return (
    <span style={{ position:"relative", width:size, height:size, flexShrink:0, display:"inline-flex", alignItems:"center",
      justifyContent:"center" }}>
      {ace && !locked && size >= 30 && (
        <span aria-hidden="true" style={{ position:"absolute", width: w + 4, height: h + 4, borderRadius: r + 2, overflow:"hidden" }}>
          <span style={{ position:"absolute", inset:"-50%", animation:"bn-medal-turn 4s linear infinite",
            background:"conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)" }}/>
        </span>
      )}
      {locked ? (
        <span style={{ position:"relative", width:w, height:h, borderRadius:r, boxSizing:"border-box", opacity:0.7,
          border:`${b}px solid ${rgba(bc, 0.55)}`, boxShadow:"0 1px 4px rgba(0,0,0,0.25)",
          background:`repeating-linear-gradient(45deg, ${rgba(bc, 0.30)} 0 ${Math.max(2, size / 16)}px, transparent 0 ${Math.max(4, size / 8)}px), ` +
            "linear-gradient(160deg, #3b3355, #1d1830)" }}>
          <span style={{ position:"absolute", inset: size * 0.09, borderRadius: r * 0.6, border:`1px solid ${rgba(bc, 0.45)}` }}/>
        </span>
      ) : (
        <span style={{ position:"relative", width:w, height:h, borderRadius:r, boxSizing:"border-box", overflow:"hidden",
          display:"flex", alignItems:"center", justifyContent:"center",
          border:`${b}px solid ${gold ? "#B8860B" : c}`, boxShadow:`0 2px 6px rgba(0,0,0,0.28), 0 0 ${size / 6}px ${rgba(c, 0.35)}`,
          background: gold ? "linear-gradient(135deg, #fff6cf, #e9b62f 45%, #fff1b5 60%, #c99412)"
            : `linear-gradient(160deg, #fffdf7, #f1ebde)` }}>
          {size >= 30 && <span aria-hidden="true" style={{ position:"absolute", inset: size * 0.07, borderRadius: r * 0.6,
            border:`1px solid ${rgba(gold ? "#B8860B" : c, 0.35)}` }}/>}
          {corners && corner(false)}
          {corners && corner(true)}
          <span style={{ position:"relative", fontSize: size * (corners ? 0.34 : 0.42), lineHeight:1 }}>{emoji || (corners ? "" : tier.card)}</span>
          {gold && size >= 30 && (
            <span aria-hidden="true" style={{ position:"absolute", top:"-20%", bottom:"-20%", width:"40%",
              background:"linear-gradient(90deg, transparent, rgba(255,255,255,.8), transparent)",
              animation:"bn-medal-sweep 3s ease-in-out infinite" }}/>
          )}
        </span>
      )}
    </span>
  );
}

export function Medal({ tier, emoji, size = 48, locked = false }) {
  if (tier?.card) return <PlayCard tier={tier} emoji={emoji} size={size} locked={locked}/>;
  const c = locked ? "#8a8f98" : tier.color;
  const id = `m${tier.id}${locked ? "l" : ""}`;
  // chaque palier vit a sa facon, de plus en plus fort : lueur (Bronze), eclat (Argent), paillettes (Or),
  // givre (Platine), prisme (Diamant), reflet (Legende), halo (Mythique), etoiles (Cosmique),
  // liseré arc-en-ciel (Eternel), coeurs (Unique)
  const fx = !locked && size >= 30 ? tier.id : null;
  const big = size >= 30;
  const cy = size * (big ? 28 : 24) / 48, r = size * (big ? 18 : 21) / 48;
  const disc = { position:"absolute", left: size / 2 - r, top: cy - r, width: r * 2, height: r * 2, borderRadius:"50%" };
  return (
    <span style={{ position:"relative", width:size, height:size, flexShrink:0, display:"inline-flex",
      alignItems:"center", justifyContent:"center", opacity: locked ? 0.45 : 1 }}>
      {fx === "eternal" && (
        <span aria-hidden="true" style={{ ...disc, left: disc.left - 3, top: disc.top - 3, width: r * 2 + 6, height: r * 2 + 6,
          background:"conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)",
          animation:"bn-medal-turn 4s linear infinite" }}/>
      )}
      {fx === "bronze" && (
        <span aria-hidden="true" style={{ ...disc, boxShadow:`0 0 10px 3px ${tier.color}`,
          animation:"bn-medal-breath 4s ease-in-out infinite" }}/>
      )}
      {fx === "mythic" && (
        <span aria-hidden="true" style={{ ...disc, "--glow": `${tier.color}cc`, animation:"bn-medal-pulse 2.2s ease-in-out infinite" }}/>
      )}
      <svg width={size} height={size} viewBox="0 0 48 48" style={{ position:"absolute", inset:0 }} aria-hidden="true">
        <defs>
          <radialGradient id={id} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.85"/>
            <stop offset="45%" stopColor={c}/>
            <stop offset="100%" stopColor={c} stopOpacity="0.75"/>
          </radialGradient>
        </defs>
        {size >= 30 && <>
          <path d="M14 2 L22 18 L17 20 L9 4 Z" fill={c} opacity="0.55"/>
          <path d="M34 2 L26 18 L31 20 L39 4 Z" fill={c} opacity="0.55"/>
        </>}
        <circle cx="24" cy={size >= 30 ? 28 : 24} r={size >= 30 ? 18 : 21} fill={`url(#${id})`}
          stroke={c} strokeWidth="2.5"/>
        <circle cx="24" cy={size >= 30 ? 28 : 24} r={size >= 30 ? 13.5 : 15.5} fill="none"
          stroke="#fff" strokeOpacity="0.45" strokeWidth="1.2"/>
      </svg>
      {fx === "silver" && (
        <span aria-hidden="true" style={{ position:"absolute", left: disc.left + r * 0.15, top: disc.top - r * 0.05,
          fontSize: Math.max(9, size * 0.28), color:"#fff", textShadow:"0 0 6px #fff, 0 0 10px #cbd5e1", lineHeight:1,
          pointerEvents:"none", animation:"bn-medal-glint 3.6s ease-in-out infinite" }}>✦</span>
      )}
      {fx === "gold" && [[0.08, 0.38, 0], [0.86, 0.42, 0.6], [0.5, 0.98, 1.2], [0.92, 0.88, 1.8], [0.06, 0.9, 2.4]].map(([x, y, d], i) => (
        <span key={i} aria-hidden="true" style={{ position:"absolute", left: size * x - 2, top: size * y - 2, width:4, height:4,
          borderRadius:"50%", background:"#fde68a", boxShadow:"0 0 6px 1px #fbbf24", pointerEvents:"none",
          animation:`bn-medal-fizz 3s ${d}s ease-in-out infinite` }}/>
      ))}
      {fx === "platinum" && (
        <span aria-hidden="true" style={{ ...disc, overflow:"hidden" }}>
          <span style={{ position:"absolute", inset:"-25%", borderRadius:"50%",
            background:"conic-gradient(from 0deg, transparent 0 60%, rgba(255,255,255,.55) 70%, transparent 80% 100%)",
            animation:"bn-medal-frost 5s linear infinite" }}/>
        </span>
      )}
      {fx === "diamond" && (
        <span aria-hidden="true" style={{ ...disc, overflow:"hidden" }}>
          <span style={{ position:"absolute", inset:0,
            background:"linear-gradient(120deg, transparent 20%, rgba(244,114,182,.7) 35%, rgba(96,165,250,.7) 50%, rgba(52,211,153,.7) 65%, transparent 80%)",
            animation:"bn-medal-prism 2.6s ease-in-out infinite" }}/>
          <span style={{ position:"absolute", inset:0,
            background:"linear-gradient(60deg, transparent 25%, rgba(253,224,71,.65) 45%, rgba(167,139,250,.7) 60%, transparent 78%)",
            animation:"bn-medal-prism 2.6s 1.3s ease-in-out infinite" }}/>
        </span>
      )}
      {fx === "unique" && [[0.12, 0], [0.78, 1.1], [0.45, 2.2]].map(([x, d], i) => (
        <span key={i} aria-hidden="true" style={{ position:"absolute", left: size * x, top: disc.top - 2, lineHeight:1,
          fontSize: Math.max(7, size * 0.18), color:"#f9a8d4", textShadow:"0 0 5px #ec4899", pointerEvents:"none",
          animation:`bn-medal-rise 3.3s ${d}s ease-out infinite` }}>♥</span>
      ))}
      {fx === "legend" && (
        <span aria-hidden="true" style={{ ...disc, overflow:"hidden" }}>
          <span style={{ position:"absolute", top:"-20%", bottom:"-20%", width:"35%",
            background:"linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent)",
            animation:"bn-medal-sweep 3s ease-in-out infinite" }}/>
        </span>
      )}
      {fx === "cosmic" && [[-0.05, 0.25, 0], [0.92, 0.18, 0.7], [0.85, 0.92, 1.3], [0.02, 0.85, 1.9]].map(([x, y, d], i) => (
        <span key={i} aria-hidden="true" style={{ position:"absolute", left: size * x, top: size * y, fontSize: Math.max(8, size * 0.2),
          color:"#c7d2fe", textShadow:"0 0 6px #818cf8", animation:`bn-medal-twinkle 2.4s ${d}s ease-in-out infinite`,
          pointerEvents:"none", lineHeight:1 }}>✦</span>
      ))}
      {emoji && <span style={{ position:"relative", top: size >= 30 ? size * 0.08 : 0, fontSize:size * 0.36,
        filter: locked ? "grayscale(1)" : "none", lineHeight:1 }}>{emoji}</span>}
    </span>
  );
}

// Un ticket de palier dessine : bords echancres, talon perfore, et le nombre.
export function TicketStub({ n, size = 1, dim = false }) {
  const h = 18 * size, w = (n != null ? 40 : 26) * size;
  const notch = `radial-gradient(circle at 0 50%, transparent ${3 * size}px, #000 ${3 * size + 0.5}px) left / 51% 100% no-repeat,
    radial-gradient(circle at 100% 50%, transparent ${3 * size}px, #000 ${3 * size + 0.5}px) right / 51% 100% no-repeat`;
  return (
    <span aria-label={n != null ? `${n} ticket${n > 1 ? "s" : ""}` : "ticket"} style={{ display:"inline-flex", alignItems:"center",
      height:h, width:w, flexShrink:0, position:"relative", verticalAlign:"middle",
      background: dim ? "linear-gradient(135deg, #a8a29e, #78716c)" : "linear-gradient(135deg, #fbbf24, #f97316)",
      WebkitMask: notch, mask: notch, borderRadius: 2 * size, boxShadow:"inset 0 0 0 1px rgba(255,255,255,.35)" }}>
      <span style={{ width: 9 * size, height:"100%", borderRight:`${size}px dashed rgba(255,255,255,.75)`,
        display:"flex", alignItems:"center", justifyContent:"center", fontSize: 8 * size, color:"#fff" }}>★</span>
      {n != null && <span style={{ flex:1, textAlign:"center", fontSize: 10.5 * size, fontWeight:900, color:"#fff",
        textShadow:"0 1px 0 rgba(0,0,0,.25)" }}>×{n}</span>}
    </span>
  );
}


// Grades : un titre par section selon la part de ses points gagnes, et un grade
// general sur le score total. Une section sans titres a elle prend ceux du compagnonnage.
export const GRADE_AT = [0.05, 0.2, 0.4, 0.65, 0.9];
export const GRADES = {
  _: ["Curieux", "Bidouilleur", "Maker", "Fabricant", "Légende du fablab"],
  prints: ["Bidouilleur", "Imprimeur", "Artisan", "Maître imprimeur", "Légende de la buse"],
  filaments: ["Curieux", "Collectionneur", "Coloriste", "Alchimiste", "Gardien de l'arc-en-ciel"],
  objects: ["Brocanteur", "Marchand", "Commerçant", "Négociant", "Magnat"],
  mw: ["Visiteur", "Habitué", "Créateur", "Star", "Icône"],
  photos: ["Amateur", "Photographe", "Reporter", "Artiste", "Légende du cadre"],
  app: ["Nouveau", "Familier", "Habitué", "Expert", "Ange gardien"],
  social: ["Solitaire", "Sociable", "Rassembleur", "Chef de bande", "Âme de la bande"],
  game: ["Chanceux", "Joueur", "Parieur", "Flambeur", "Maître du casino"],
  cards: ["Joueur du dimanche", "Habitué du tapis", "Croupier", "Brelan d'as", "Roi du tapis vert"],
  secret: ["Fureteur", "Détective", "Chasseur de trésors", "Initié", "Gardien des secrets"],
  other: ["Apprenti", "Compagnon", "Artisan", "Maître", "Grand Maître"],
};
// Chaque grade a trois echelons (I, II, III), chacun un tiers de son intervalle
// (le dernier grade va de 90 a 100 %). sub : l'echelon (0 a 2) ; stepLo et
// nextAt : le debut de l'echelon et le seuil du suivant.
export const ROMAN = ["I", "II", "III"];
export function gradeOf(cat, v) {
  const names = cat == null ? GRADES._ : GRADES[cat] || GRADES.other;
  let i = -1;
  GRADE_AT.forEach((x, j) => { if (v >= x) i = j; });
  if (i < 0) return { i, sub: -1, name: null, base: null, next: `${names[0]} I`, nextAt: GRADE_AT[0], stepLo: 0, general: cat == null };
  const lo = GRADE_AT[i], hi = GRADE_AT[i + 1] ?? 1, step = (hi - lo) / 3;
  const sub = Math.max(0, Math.min(2, Math.floor((v - lo) / step + 1e-9)));
  const next = sub < 2 ? `${names[i]} ${ROMAN[sub + 1]}` : names[i + 1] ? `${names[i + 1]} I` : null;
  const nextAt = sub < 2 ? lo + step * (sub + 1) : names[i + 1] ? hi : null;
  return { i, sub, name: `${names[i]} ${ROMAN[sub]}`, base: names[i], next, nextAt, stepLo: lo + step * sub, general: cat == null };
}
// Les metaux des grades : fer, bronze, argent, or, puis l'irise de la legende
export const GRADE_METAL = [
  { a:"#D1D5DB", b:"#6B7280", ink:"#374151", name:"Fer" },
  { a:"#F6C48F", b:"#9A4E1C", ink:"#7C3A10", name:"Bronze" },
  { a:"#F8FAFC", b:"#94A3B8", ink:"#475569", name:"Argent" },
  { a:"#FDE68A", b:"#B7791F", ink:"#8A5A00", name:"Or" },
  { a:"#F5D0FE", b:"#7C3AED", ink:"#6D28D9", name:"Légende" },
];
// L'ecusson d'un grade : un blason de metal, une buse gravee au centre, et ses
// echelons (etoiles) en dessous. Le dernier a un liseré arc-en-ciel et un reflet.
export function GradeEmblem({ i, size = 22, locked = false }) {
  const m = GRADE_METAL[Math.max(0, i)], id = `ge${i}${locked ? "l" : ""}${size}`, top = i === 4 && !locked;
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 40 46" aria-hidden="true" style={{ flexShrink:0, overflow:"visible",
      filter: locked ? "grayscale(1) opacity(.35)" : top ? "drop-shadow(0 0 6px rgba(168,85,247,.7))" : `drop-shadow(0 1px 2px ${m.b}88)` }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={m.a}/><stop offset=".55" stopColor={m.b}/><stop offset="1" stopColor={m.a}/>
        </linearGradient>
        {top && <linearGradient id={id + "r"} x1="0" y1="0" x2="1" y2="0">
          {["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#06b6d4", "#6366f1", "#d946ef"].map((c, k) =>
            <stop key={c} offset={k / 6} stopColor={c}/>)}
        </linearGradient>}
      </defs>
      <path d="M20 2 L37 8 V22 C37 33 29 40 20 44 C11 40 3 33 3 22 V8 Z" fill={`url(#${id})`}
        stroke={top ? `url(#${id}r)` : m.b} strokeWidth={top ? 2.6 : 1.6}/>
      <path d="M20 6 L33 10.5 V22 C33 31 27 36.5 20 40 C13 36.5 7 31 7 22 V10.5 Z" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="1"/>
      {/* la buse */}
      <path d="M13.5 12 H26.5 V17 H24 L22 25 H18 L16 17 H13.5 Z" fill="#fff" fillOpacity=".92"/>
      <path d="M18.6 25 H21.4 L20 28.5 Z" fill="#fff" fillOpacity=".92"/>
      {/* les echelons */}
      {[0, 1, 2, 3, 4].map(k => <circle key={k} cx={12 + k * 4} cy="34" r="1.5" fill="#fff" fillOpacity={k <= i ? 0.95 : 0.3}/>)}
      {top && !locked && <rect x="-20" y="0" width="14" height="46" fill="#fff" opacity=".45" transform="skewX(-20)"
        style={{ animation:"bn-grade-sweep 3.2s ease-in-out infinite" }}/>}
    </svg>
  );
}
