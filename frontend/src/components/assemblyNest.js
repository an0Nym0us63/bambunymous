// Emboiter et aligner (30/10/2026) : une piece collee sur une autre glisse et tourne sur le contact. Deux cartes de
// hauteur, dans le repere du contact (w : la normale, de la piece support vers la piece posee) :
//  - le dessus de la piece support, colonne par colonne (le premier point touche en descendant) ;
//  - le dessous de la piece posee (le premier point touche en montant).
// « nest » (emboiter) : la place ou la piece descend le plus (un bloc dans son logement, un tenon dans son trou), sans
// rien traverser : pour une place (decalage dans le plan, angle autour de w), elle descend jusqu'au premier contact, sa
// hauteur est le plus grand ecart « dessus du support - dessous de la piece » sous elle.
// « align » (aligner) : la face collee de la piece et la face qui la porte se recouvrent au mieux (une plaque sur le
// flanc d'un obelisque, un panneau sur le cote d'une boite), avec le moins de matiere qui se traverse, puis centree.
// Dans les deux cas : a egalite, au milieu de ce qui va aussi bien (en angle et en position), et a peine penalise par
// le chemin parcouru. La recherche se fait autour de la place ou on l'a collee (la piece et une marge a sa mesure :
// sur un grand support, tout parcourir prenait plusieurs secondes), d'abord a grosses mailles, puis finement autour
// des meilleures.

// Les consignes du collage (31/10/2026) : lock, l'angle permis autour de la normale (0 : aucun ; null : tous) ; axis, la
// seule direction ou glisser (collee par une arete) ; reach, jusqu'ou glisser (mm). Emboiter prefere la place la plus
// proche : 1 mm de chemin coute 0,06 mm de profondeur, 1° 0,008 mm (avant 0,02 et 0,002 : un creux un peu plus profond
// a l'autre bout de la face, ou un demi-tour, l'emportait)
// res : la maille voulue (mm ; la passe fine de snapPlace), sinon a la mesure de la zone ; center : a profondeur egale,
// se centrer quand meme (la passe fine)
// tick (03/11/2026) : appele souvent pendant la recherche (async) -- l'editeur y rend la main a la page (sinon figee,
// jusqu'a l'ecran noir) et y leve l'arret demande
export async function nestPlace({ THREE, collider, moving, base, P, N, mode = "nest", collides = null, lock = null, axis = null, reach = null, res = null, center = false,
                                 erodeMm = 0.6, bounded = false, tick = null }) {
  const tk = tick || (() => null);
  const { MeshBVH } = await import("three-mesh-bvh");
  const w = N.clone().normalize();
  const u = (Math.abs(w.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).cross(w).normalize();
  const v = w.clone().cross(u);
  const fr = p => { const d = p.clone().sub(P); return [d.dot(u), d.dot(v), d.dot(w)]; };
  // la direction permise dans le plan (u, v), et la place ramenee dans ce que le collage permet
  const ax = axis ? (() => { const a = [axis.dot(u), axis.dot(v)], l = Math.hypot(a[0], a[1]); return l > 1e-6 ? [a[0] / l, a[1] / l] : null; })() : null;
  const wrap = t => { const r = ((t + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return r; };
  const cons = (th, su, sv) => {
    if (lock !== null) th = Math.max(-lock, Math.min(lock, wrap(th)));
    if (ax) { let s = su * ax[0] + sv * ax[1]; if (reach !== null) s = Math.max(-reach, Math.min(reach, s)); su = s * ax[0]; sv = s * ax[1]; }
    else if (reach !== null) { const d = Math.hypot(su, sv); if (d > reach) { su *= reach / d; sv *= reach / d; } }
    return [th, su, sv];
  };
  const fix = b => { const [th, su, sv] = cons(b.th, b.su, b.sv); return { ...b, th, su, sv }; };

  // les maillages des pieces (leur arbre de recherche), et un rayon lance dans le repere du support du modele
  const bvhOf = g => {
    const geo = collider.geoOf(g);
    if (!geo.boundsTree) geo.boundsTree = new MeshBVH(geo);
    g.updateMatrix();
    return { bvh: geo.boundsTree, inv: g.matrix.clone().invert() };
  };
  const A = moving.map(bvhOf), B = base.map(bvhOf);
  const ray = new THREE.Ray(), o = new THREE.Vector3(), dir = new THREE.Vector3();
  const first = (list, origin, d) => {
    let best = Infinity;
    for (const { bvh, inv } of list) {
      ray.origin.copy(origin).applyMatrix4(inv); ray.direction.copy(d).transformDirection(inv);
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
      if (hit && hit.distance < best) best = hit.distance;
    }
    return best;
  };
  // l'etendue des pieces dans le repere du contact
  const span = list => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const g of list) {
      const b = new THREE.Box3();
      g.children.forEach(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(g.matrix)); } });
      for (let i = 0; i < 8; i++) {
        const q = fr(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
        for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], q[c]); hi[c] = Math.max(hi[c], q[c]); }
      }
    }
    return { lo, hi };
  };
  const sa = span(moving), sb = span(base);
  const cu = (sa.lo[0] + sa.hi[0]) / 2, cv = (sa.lo[1] + sa.hi[1]) / 2;
  const half = Math.hypot(sa.hi[0] - sa.lo[0], sa.hi[1] - sa.lo[1]) / 2;      // la piece, quel que soit l'angle
  // jusqu'ou elle peut glisser : une fois et demie la piece (la demi-diagonale ne trouvait pas un logement a 16 mm d'un
  // bloc de 20), mais 30 mm au plus (03/11/2026 : sur un grand couvercle, la zone regardee faisait 40 cm, et la maille, a
  // sa mesure, plus de 2 mm -- les parois fines d'une boite et d'une jupe disparaissaient : « deja calee »)
  const W = Math.max(12, Math.min(half * 1.5, 30));
  // (03/11/2026) presque sans tourner et sans aller loin (la passe fine) : la zone suit la piece et sa marge, sans la
  // demi-diagonale tout autour (une reglette de 140 mm regardait 280 mm de large)
  const tight = lock !== null && lock <= 0.1 && reach !== null;
  // la zone : la piece, quel que soit l'angle quand elle peut tourner, et sa marge de glissement
  const hu = tight ? (sa.hi[0] - sa.lo[0]) / 2 + reach + 2 : half + W, hv = tight ? (sa.hi[1] - sa.lo[1]) / 2 + reach + 2 : half + W;
  // la zone du support regardee : la piece et sa marge
  const zlo = [Math.max(sb.lo[0], cu - hu), Math.max(sb.lo[1], cv - hv)];
  const zhi = [Math.min(sb.hi[0], cu + hu), Math.min(sb.hi[1], cv + hv)];
  if (zhi[0] <= zlo[0] || zhi[1] <= zlo[1]) return null;
  // la maille fine : a la mesure de la zone, mais jamais plus de 0,8 mm (une paroi de 1,2 mm doit rester visible)
  const h = res || Math.min(0.8, Math.max(0.25, Math.max(zhi[0] - zlo[0], zhi[1] - zlo[1]) / 140));

  // la carte du dessus du support : H[j*nu+i] (NaN : rien dessous)
  const bu0 = zlo[0], bv0 = zlo[1], nu = Math.ceil((zhi[0] - bu0) / h) + 1, nv = Math.ceil((zhi[1] - bv0) / h) + 1;
  const H = new Float32Array(nu * nv).fill(NaN), top = sb.hi[2] + 1;
  dir.copy(w).negate();
  for (let j = 0; j < nv; j++) {
    await tk();
    for (let i = 0; i < nu; i++) {
      o.copy(P).addScaledVector(u, bu0 + i * h).addScaledVector(v, bv0 + j * h).addScaledVector(w, top);
      const t = first(B, o, dir);
      if (t < Infinity) H[j * nu + i] = top - t;
    }
  }
  // la carte du dessous de la piece posee : des cellules (du, dv, L) autour de son centre
  const bottom = sa.lo[2] - 1;
  const mu = Math.floor((sa.hi[0] - sa.lo[0]) / h) + 1, mv = Math.floor((sa.hi[1] - sa.lo[1]) / h) + 1;
  // la grille centree sur la piece (03/11/2026 : partie d'un bord, elle perdait la derniere maille d'un seul cote, et le
  // centre de la partie qui entre se decalait d'une demi-maille -- un couvercle a 0,2 mm de jeu ne passait plus)
  const ga = sa.lo[0] + ((sa.hi[0] - sa.lo[0]) - (mu - 1) * h) / 2, gb = sa.lo[1] + ((sa.hi[1] - sa.lo[1]) - (mv - 1) * h) / 2;
  const La = new Float32Array(mu * mv).fill(NaN);
  dir.copy(w);
  for (let j = 0; j < mv; j++) {
    await tk();
    for (let i = 0; i < mu; i++) {
      o.copy(P).addScaledVector(u, ga + i * h).addScaledVector(v, gb + j * h).addScaledVector(w, bottom);
      const t = first(A, o, dir);
      if (t < Infinity) La[j * mu + i] = bottom + t;
    }
  }
  // le bord du dessous rogne d'une maille : le jeu d'impression (une piece faite pour entrer juste n'y entrait pas, les
  // mailles du bord tombant sur la paroi)
  const at = (i, j) => (i < 0 || j < 0 || i >= mu || j >= mv ? NaN : La[j * mu + i]);
  // erode : le bord du dessous rogne de n mailles (03/11/2026 : la recherche rogne 0,6 mm -- erodeMm -- pour voir les
  // logements faits juste a la taille de la piece, 0,2 mm de jeu, que ses mailles d'un millimetre et plus manquaient ;
  // la hauteur finale, elle, ne rogne qu'une maille)
  const pick = n => {
    let keep = new Uint8Array(mu * mv);
    for (let k = 0; k < mu * mv; k++) keep[k] = Number.isNaN(La[k]) ? 0 : 1;
    for (let it = 0; it < n; it++) {
      const nx = keep.slice();
      for (let j = 0; j < mv; j++) for (let i = 0; i < mu; i++) {
        const k = j * mu + i;
        if (keep[k] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const x = i + a, y = j + b; return x < 0 || y < 0 || x >= mu || y >= mv || !keep[y * mu + x]; })) nx[k] = 0;
      }
      keep = nx;
    }
    const out = [];
    for (let j = 0; j < mv; j++) for (let i = 0; i < mu; i++) if (keep[j * mu + i]) out.push(ga + i * h - cu, gb + j * h - cv, La[j * mu + i]);
    return out;
  };
  let exact = pick(1);
  if (exact.length < 36) exact = pick(0);
  if (!exact.length) return null;
  let cells = mode === "nest" ? pick(Math.max(1, Math.round(erodeMm / h))) : exact;
  if (cells.length < 36) cells = exact;
  // deja engagee : une part de la piece est sous la face collee (la jupe d'un couvercle en place, une reglette dans sa
  // rainure) -- Caler ne l'aligne plus a plat (03/11/2026 : un couvercle en place etait recentre de 0,4 mm sur le bord)
  let below = 0;
  for (let k = 2; k < exact.length; k += 3) if (exact[k] < -0.35) below++;
  const engaged = below >= Math.max(4, 0.02 * exact.length / 3);
  // descendre au plus de l'epaisseur de la piece (bounded, Caler : une barre posee sur deux montants tombait entre eux)
  const maxSink = bounded ? sa.hi[2] - sa.lo[2] + 0.5 : Infinity;

  // aligner : la face d'appui de la piece (le plus bas de son dessous, a 0,6 mm pres) et celle qui la porte (le dessus
  // du support a la hauteur du contact, a 0,6 mm pres : une face a grain ou a relief en est encore)
  // (30/10/2026) la face d'appui est la face collee : la nappe du dessous, d'un seul tenant, a la hauteur du dessous au
  // point de collage -- avant, le plus bas du dessous : sur un panneau a tenons, les tenons seuls, et il partait de cote
  const TOL = 0.6;
  let foot = cells, lvl = 0;
  if (mode === "align") {
    let i0 = Math.round(-ga / h), j0 = Math.round(-gb / h), s = -1, bd = Infinity;
    for (let r = 0; r < 16 && s < 0; r++) for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (Number.isNaN(at(i, j))) continue;
      const d = (i - i0) ** 2 + (j - j0) ** 2;
      if (d < bd) { bd = d; s = j * mu + i; }
    }
    if (s < 0) return null;
    let lmin = Infinity;
    for (let k = 2; k < cells.length; k += 3) lmin = Math.min(lmin, cells[k]);
    lvl = La[s];
    // le point de collage sur le plus bas du dessous (une plaque, la base d'un bec) : tout ce plus bas, comme avant ;
    // plus haut (des tenons dessous) : la nappe collee seule
    if (lvl <= lmin + TOL) {
      lvl = lmin; foot = [];
      for (let k = 0; k < cells.length; k += 3) if (cells[k + 2] <= lmin + TOL) foot.push(cells[k], cells[k + 1], cells[k + 2]);
    } else {
    const seen = new Uint8Array(mu * mv), st = [s];
    seen[s] = 1; foot = [];
    while (st.length) {
      const k = st.pop(), i = k % mu, j = (k - i) / mu;
      foot.push(ga + i * h - cu, gb + j * h - cv, La[k]);
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = i + a, y = j + b, q = y * mu + x;
        if (x >= 0 && y >= 0 && x < mu && y < mv && !seen[q] && Math.abs(at(x, y) - lvl) <= TOL) { seen[q] = 1; st.push(q); }
      }
    }
    }
  }
  // la face qui porte : les mailles du dessus a la hauteur du contact, d'un seul tenant avec celle sous le point de
  // collage (30/10/2026 : toute maille a la bonne hauteur comptait, une grande surface donnait n'importe quel angle ;
  // la forme de la face, elle, dit comment tourner la piece -- l'empreinte d'un bec sur une tete)
  const face = new Uint8Array(nu * nv);
  let faceN = 0;
  {
    // une maille de la face : a la hauteur du contact, et a plat avec ses voisines (30/10/2026 : sur une tete en tricot,
    // le relief passait par cette hauteur tout autour, la « face » debordait de l'empreinte et l'angle partait au hasard)
    const ok = k => {
      if (Number.isNaN(H[k]) || Math.abs(H[k]) > 0.35) return false;
      const i = k % nu, j = (k - i) / nu;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = i + a, y = j + b;
        if (x < 0 || y < 0 || x >= nu || y >= nv) continue;
        const z = H[y * nu + x];
        if (!Number.isNaN(z) && Math.abs(z - H[k]) > Math.max(0.12, 0.3 * h)) return false;
      }
      return true;
    };
    const gap = Math.max(1, Math.round(5 / h));
    let i0 = Math.round((0 - bu0) / h), j0 = Math.round((0 - bv0) / h);
    i0 = Math.min(nu - 1, Math.max(0, i0)); j0 = Math.min(nv - 1, Math.max(0, j0));
    // la maille de la face la plus proche du point de collage
    let start = -1, bd = Infinity;
    for (let r = 0; r < 12 && start < 0; r++) for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (i < 0 || j < 0 || i >= nu || j >= nv || !ok(j * nu + i)) continue;
      const d = (i - i0) ** 2 + (j - j0) ** 2;
      if (d < bd) { bd = d; start = j * nu + i; }
    }
    // un morceau de face, d'un seul tenant (une fente, une rainure etroite ne le coupe pas)
    const grow = (seed, mark) => {
      const st = [seed], got = [seed]; mark[seed] = 1;
      while (st.length) {
        const k = st.pop(), i = k % nu, j = (k - i) / nu;
        // une fente, une rainure etroite (5 mm au plus) ne coupe pas la face (30/10/2026 : le cote d'une boite a
        // fentes ne comptait que son morceau sous le point de collage, le panneau se calait de travers)
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (let r = 1; r <= gap; r++) {
            const x = i + a * r, y = j + b * r, q = y * nu + x;
            if (x < 0 || y < 0 || x >= nu || y >= nv) break;
            if (mark[q]) break;
            if (ok(q)) { mark[q] = 1; st.push(q); got.push(q); break; }
          }
        }
      }
      return got;
    };
    if (start >= 0) faceN = grow(start, face).length;
    {
      // les autres morceaux a plat a la meme hauteur, sous la piece et sa marge (03/11/2026 : une traverse posee sur
      // deux montants ne voyait que le dessus de celui touche ; elle glissait pour s'y centrer, et de biais). Pas les
      // miettes (un relief qui passe par cette hauteur) : un morceau compte s'il fait au moins 4 % de la face collee
      if (mode === "align") {
        const minC = Math.max(4, Math.round(foot.length / 3 * 0.04)), seen = new Uint8Array(nu * nv);
        for (let k = 0; k < nu * nv; k++) {
          if (face[k] || seen[k] || !ok(k)) continue;
          const part = grow(k, seen);
          if (part.length >= minC) for (const q of part) { if (!face[q]) { face[q] = 1; faceN++; } }
        }
      }
    }
  }

  // l'orientation des bords (03/11/2026) : une piece aux bords droits se pose parallele (ou d'equerre) aux bords du
  // support -- une traverse sur un cadre, un panneau sur une boite. L'angle dominant, a 90° pres, des bords d'une
  // silhouette (m : 1 dedans, 0 dehors) : la direction de chaque bord (le gradient de la silhouette adoucie, pour qu'un
  // bord de biais ne se lise pas en escalier), comptee quatre fois (a 90° pres), ponderee par sa nettete. r : de 0 (des
  // bords dans tous les sens, une forme ronde ou a relief) a 1 (tous les bords d'equerre entre eux)
  const orient = (m0, nI0, nJ0, pad = 0) => {
    // pad : une marge vide autour (la carte du dessous colle a la piece, ses bords tomberaient sur celui de la carte)
    const nI = nI0 + 2 * pad, nJ = nJ0 + 2 * pad;
    let b = m0;
    if (pad) { b = new Float32Array(nI * nJ); for (let j = 0; j < nJ0; j++) for (let i = 0; i < nI0; i++) b[(j + pad) * nI + i + pad] = m0[j * nI0 + i]; }
    for (let pass = 0; pass < 2; pass++) {
      const o = new Float32Array(nI * nJ);
      for (let j = 0; j < nJ; j++) for (let i = 0; i < nI; i++) {
        let sum = 0, c = 0;
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
          const x = i + di, y = j + dj;
          if (x < 0 || y < 0 || x >= nI || y >= nJ) continue;     // le bord de la carte n'est pas un bord de la piece
          sum += b[y * nI + x]; c++;
        }
        o[j * nI + i] = sum / c;
      }
      b = o;
    }
    let C = 0, S = 0, T = 0;
    for (let j = 1; j < nJ - 1; j++) for (let i = 1; i < nI - 1; i++) {
      const gx = b[j * nI + i + 1] - b[j * nI + i - 1], gy = b[(j + 1) * nI + i] - b[(j - 1) * nI + i], g = Math.hypot(gx, gy);
      if (g < 0.05) continue;
      const f = Math.atan2(gy, gx);
      C += g * Math.cos(4 * f); S += g * Math.sin(4 * f); T += g;
    }
    return T ? { a: Math.atan2(S, C) / 4, r: Math.hypot(C, S) / T } : null;
  };
  let oA = null, oB = null;
  {
    // la piece : le dessous tout entier ; le support : ce qui affleure a la hauteur du contact (2 mm sous elle au plus)
    let lmin = Infinity;
    for (let k = 0; k < mu * mv; k++) if (!Number.isNaN(La[k])) lmin = Math.min(lmin, La[k]);
    const mA = new Float32Array(mu * mv), mB = new Float32Array(nu * nv);
    for (let k = 0; k < mu * mv; k++) mA[k] = !Number.isNaN(La[k]) && La[k] <= lmin + 2 ? 1 : 0;
    for (let k = 0; k < nu * nv; k++) mB[k] = !Number.isNaN(H[k]) && H[k] >= -2 ? 1 : 0;
    await tk(); oA = orient(mA, mu, mv, 4); await tk(); oB = orient(mB, nu, nv);
  }
  // les bords des deux nets (r > 0,5) : l'ecart (degres) entre ceux de la piece tournee de th et ceux du support, a 90°
  // pres ; sinon 0 (rien a aligner, la forme de la face decide seule)
  const sharp = oA && oB && oA.r > 0.5 && oB.r > 0.5 ? Math.min(oA.r, oB.r) : 0;
  const skew = th => {
    if (!sharp) return 0;
    const d = ((th + oA.a - oB.a) * 180 / Math.PI) % 90;
    return Math.abs(((d % 90) + 135) % 90 - 45);
  };
  // l'angle qui met les bords d'equerre (le plus proche de zero ; les autres, a 90° pres, s'en deduisent)
  const square = sharp ? (() => { const t = oB.a - oA.a; return t - Math.round(t / (Math.PI / 2)) * (Math.PI / 2); })() : null;

  // une place : la hauteur ou elle se pose (Infinity : hors du support). Les mailles de la piece hors du support ne
  // comptent pas (une piece plus large que ce qui la porte), mais elle doit rester au moins autant sur son support qu'a
  // la place ou on l'a collee (sinon elle « tomberait » a cote)
  let minCov = 0;
  const lift = (Hm, nU, nV, hh, cl, th, su, sv, cov = null, mc = minCov) => {
    const cs = Math.cos(th), sn = Math.sin(th), n = cl.length / 3;
    let d = -Infinity, on = 0;
    for (let k = 0; k < cl.length; k += 3) {
      const x = cu + cs * cl[k] - sn * cl[k + 1] + su, y = cv + sn * cl[k] + cs * cl[k + 1] + sv;
      const i = Math.round((x - bu0) / hh), j = Math.round((y - bv0) / hh);
      if (i < 0 || j < 0 || i >= nU || j >= nV) continue;
      const z = Hm[j * nU + i];
      if (Number.isNaN(z)) continue;
      on++;
      const e = z - cl[k + 2];
      if (e > d) d = e;
    }
    if (cov) cov.v = on / n;
    return on && on >= mc * n ? d : Infinity;
  };
  // aligner : la part de matiere de la piece qui traverserait le support, la face collee posee sur la face qui porte
  // (des tenons qui tombent dans leurs fentes ne comptent pas, sur la paroi pleine si)
  let fLev = 0;
  const clash = (Hm, nU, nV, hh, cl, th, su, sv) => {
    const cs = Math.cos(th), sn = Math.sin(th);
    let bad = 0, pn = 0, pb = 0;
    for (let k = 0; k < cl.length; k += 3) {
      const x = cu + cs * cl[k] - sn * cl[k + 1] + su, y = cv + sn * cl[k] + cs * cl[k + 1] + sv;
      const i = Math.round((x - bu0) / hh), j = Math.round((y - bv0) / hh);
      const prot = cl[k + 2] < lvl - TOL;              // un tenon, un ergot sous la face collee
      if (prot) pn++;
      if (i < 0 || j < 0 || i >= nU || j >= nV) continue;
      const z = Hm[j * nU + i];
      if (!Number.isNaN(z) && z > cl[k + 2] - lvl + fLev + TOL) { bad++; if (prot) pb++; }
    }
    // la part de la piece qui traverse, et celle de ses tenons (peu de matiere, mais qu'ils tombent dans leurs fentes
    // compte : c'est ce qui dit la bonne place)
    return [bad / Math.max(1, cl.length / 3), pn ? pb / pn : 0];
  };
  // la part de la face d'appui posee sur la face qui porte
  const onFace = (F, nU, nV, hh, cl, th, su, sv) => {
    const cs = Math.cos(th), sn = Math.sin(th);
    let on = 0;
    for (let k = 0; k < cl.length; k += 3) {
      const x = cu + cs * cl[k] - sn * cl[k + 1] + su, y = cv + sn * cl[k] + cs * cl[k + 1] + sv;
      const i = Math.round((x - bu0) / hh), j = Math.round((y - bv0) / hh);
      if (i >= 0 && j >= 0 && i < nU && j < nV && F[j * nU + i]) on++;
    }
    return on / (cl.length / 3);
  };
  // a grosses mailles : le dessus garde le plus bas de chaque bloc (et la face, si une maille en est), le dessous le
  // plus haut (optimiste : un logement juste a la taille de la piece reste visible ; la passe fine verifie ensuite)
  const K = 4, hc = h * K, nU = Math.ceil(nu / K), nV = Math.ceil(nv / K);
  const Hc = new Float32Array(nU * nV).fill(NaN), Fc = new Uint8Array(nU * nV);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const z = H[j * nu + i], c = Math.floor(j / K) * nU + Math.floor(i / K);
    if (face[j * nu + i]) Fc[c] = 1;
    if (Number.isNaN(z)) continue;
    if (Number.isNaN(Hc[c]) || z < Hc[c]) Hc[c] = z;
  }
  const off = (K - 1) / 2 * h;                     // les grosses cellules sont centrees sur des blocs de K fines
  // le dessous en grosses mailles : chaque groupe de cellules au milieu de ses cellules (jamais plus large que la
  // piece), a la hauteur de la plus haute
  // (au plus ~200 groupes : une grande piece en avait un millier, la recherche grossiere prenait 6 s)
  const coarse = list => {
    const gc = hc * Math.max(1, Math.sqrt(list.length / 3 / (K * K) / 200));
    const gs = new Map();
    for (let k = 0; k < list.length; k += 3) {
      const key = `${Math.floor(list[k] / gc)},${Math.floor(list[k + 1] / gc)}`;
      let g = gs.get(key);
      if (!g) gs.set(key, g = [0, 0, 0, -Infinity]);
      g[0] += list[k]; g[1] += list[k + 1]; g[2]++; g[3] = Math.max(g[3], list[k + 2]);
    }
    const out = [];
    for (const g of gs.values()) out.push(g[0] / g[2], g[1] / g[2], g[3]);
    return out;
  };
  await tk();
  const cc = coarse(cells), fc = coarse(foot);
  // ce qui porte la piece a sa place de depart (un peu de marge)
  // (03/11/2026) chaque niveau mesure la part portee a sa facon : son seuil est pris a la place de depart, avec ses
  // propres mailles (un couvercle aussi large que sa boite etait porte a 93 % en mailles fines, moins de 85 % en
  // grosses : toutes les places grossieres refusees, « deja calee »)
  let minCovC = 0, minCovM = 0;
  if (mode !== "align") {
    const cov = (Hm, nU_, nV_, hh, cl, s0) => { const c = {}; lift(Hm, nU_, nV_, hh, cl, 0, -s0, -s0, c, 0); return Math.max(0.05, Math.min(0.999, c.v * 0.9)); };
    minCov = cov(H, nu, nv, h, cells, 0);
    minCovM = cov(H, nu, nv, h, cc, 0);
    minCovC = cov(Hc, nU, nV, hc, cc, off);
  }
  else if (faceN) { let s = 0; for (let k = 0; k < nu * nv; k++) if (face[k]) s += H[k]; fLev = s / faceN; }
  // le recouvrement mutuel de la face collee et de la face qui porte (leur part commune sur leur reunion)
  const iou = (F, nU, nV, hh, fl, th, su, sv) => { const inter = onFace(F, nU, nV, hh, fl, th, su, sv) * footN; return inter / Math.max(1, footN + faceN - inter); };
  // la note d'une place (plus basse : mieux), grossiere ou fine ; Infinity : impossible
  const turn = th => { const g = ((th * 180 / Math.PI) % 360 + 360) % 360; return Math.min(g, 360 - g); };
  const pen = (su, sv, th) => 0.06 * Math.hypot(su, sv) + 0.008 * turn(th);
  // lv : 0 grossier (carte et mailles regroupees), 1 moyen (carte fine, mailles regroupees), 2 fin
  const footN = foot.length / 3;
  const score = (lv, th0, su0, sv0) => {
    const [th, su, sv] = cons(th0, su0, sv0);
    const [Hm, nU_, nV_, hh, cl, fl, F, s0] = lv === 2 ? [H, nu, nv, h, cells, foot, face, 0] : lv === 1 ? [H, nu, nv, h, cc, fc, face, 0] : [Hc, nU, nV, hc, cc, fc, Fc, off];
    if (mode === "align") {
      // la face collee posee a plat sur la face qui porte : le recouvrement, moins la matiere qui traverserait (un peu
      // tolere : un relief, un tenon) ; tourner ou glisser doit rapporter : 1° coute quatre dix-milliemes de
      // recouvrement, 1 mm un demi-centieme (sinon un bec presque bien pose faisait un quart de tour pour rien)
      const o = iou(F, nU_, nV_, hh, fl, th, su - s0, sv - s0), [x, xp] = clash(Hm, nU_, nV_, hh, cl, th, su - s0, sv - s0);
      // des bords nets de part et d'autre : 1° de biais coute trois centiemes (un quart de point de recouvrement pour
      // 8°) : a recouvrement presque egal, d'equerre l'emporte
      return -10 * o + 12 * x + 2 * xp + 0.05 * Math.hypot(su, sv) + 0.004 * turn(th) + 0.03 * sharp * skew(th);
    }
    const d = lift(Hm, nU_, nV_, hh, cl, th, su - s0, sv - s0, null, lv === 2 ? minCov : lv === 1 ? minCovM : minCovC);
    if (d === Infinity) return Infinity;
    // trop profond : refuse sur la carte fine ; sur la grosse (optimiste, le plus bas de chaque bloc : avec des parois
    // fines, chaque bloc voit le fond de la boite), plafonne -- sinon toutes les places grossieres etaient refusees
    if (d < -maxSink) { if (lv === 0) return -maxSink + pen(su, sv, th); return Infinity; }
    return d + pen(su, sv, th);
  };
  // le pas de la recherche grossiere : a la mesure de la piece (une trentaine de pas de chaque cote au plus), tous les 10°
  const ss = Math.max(hc, W / 14), fs = Math.max(2 * h, ss / 5);      // et celui de la passe fine autour
  const all = [];
  const R = reach !== null ? Math.min(W, reach) : W;
  const angs = lock === null ? Array.from({ length: 36 }, (_, a) => a * Math.PI / 18)
    : Array.from({ length: 2 * Math.floor(lock / (Math.PI / 18)) + 1 }, (_, a) => (a - Math.floor(lock / (Math.PI / 18))) * Math.PI / 18);
  // et les angles qui mettent les bords d'equerre, essayes tels quels (ils tombent rarement sur un pas de 10°)
  if (square !== null) for (let q = 0; q < 4; q++) {
    const t = square + q * Math.PI / 2;
    if (lock === null || Math.abs(wrap(t)) <= lock) angs.push(lock === null ? t : wrap(t));
  }
  for (const th of angs) {
    await tk();
    if (ax) {
      for (let s = -R; s <= R + 1e-9; s += Math.min(ss, Math.max(h, R / 4))) {
        const c = score(0, th, s * ax[0], s * ax[1]);
        if (c < Infinity) all.push({ th, su: s * ax[0], sv: s * ax[1], c });
      }
      continue;
    }
    const st = Math.min(ss, Math.max(h, R / 4));
    for (let sv = -R; sv <= R + 1e-9; sv += st) for (let su = -R; su <= R + 1e-9; su += st) {
      if (Math.hypot(su, sv) > R + 1e-9) continue;
      const c = score(0, th, su, sv);
      if (c < Infinity) all.push({ th, su, sv, c });
    }
  }
  if (!all.length) return null;
  all.sort((a, b) => a.c - b.c);
  // les meilleures, et differentes (un meme creux vu de plusieurs mailles n'en compte qu'une)
  const tops = [];
  for (const c of all) {
    if (tops.length >= 24) break;
    if (tops.some(t => Math.hypot(t.su - c.su, t.sv - c.sv) < 2 * ss && Math.abs(Math.sin((t.th - c.th) / 2)) < 0.09)) continue;
    tops.push(c);
  }
  // finement autour de chacune des meilleures : la meilleure place de chaque creux
  const fines = [];
  for (const t of tops) {
    let b = null;
    for (let da = -6; da <= 6; da += 1.5) {
      await tk();
      const th = t.th + da * Math.PI / 180;
      for (let dv = -ss; dv <= ss + 1e-9; dv += fs) for (let du = -ss; du <= ss + 1e-9; du += fs) {
        const su = t.su + du, sv = t.sv + dv, c = score(1, th, su, sv);
        if (c < Infinity && (!b || c < b.c)) b = { th, su, sv, c };
      }
    }
    if (b) fines.push(fix(b));
  }
  // emboiter : la place « a la main » (03/11/2026) -- d'equerre, la partie qui entre (une jupe, une reglette, un bloc)
  // centree sur le creux qu'elle doit occuper (l'interieur d'une boite, une rainure, une poche). Les grosses mailles,
  // optimistes, ne savaient pas classer les places d'un couvercle a parois fines pose de travers
  const guesses = [];
  // la hauteur d'une place par de vrais rayons, sous chaque point de la piece a sa position exacte (03/11/2026 : la carte,
  // a la maille pres, faisait retomber la jupe d'un couvercle tourne sur le haut d'une paroi a 0,2 mm de jeu)
  // (allege : tous les points de la partie qui entre -- ce sont eux qui butent --, un sur quatre du reste)
  // cap (03/11/2026) : seule compte la reponse « au-dessus de cap ou pas » -- des qu'un point depasse, la place est
  // jugee (elle rend cette hauteur, pas la vraie) ; le point qui a fait echouer la precedente est essaye le premier
  // (29 s sur 33 passaient ici : chaque essai relancait tous les rayons, meme perdu des le premier point)
  let probe = null, killer = 0;
  const exactLift = (b, cap = Infinity) => {
    if (!probe) {
      // le dessous entier (sans rogner : les vrais rayons n'arrondissent rien) ; tout le pourtour et ce qui depasse
      // dessous (ce sont eux qui butent : les coins d'un bloc, la jupe d'un couvercle), un point sur quatre du reste
      let tp = -Infinity;
      for (let k = 0; k < mu * mv; k++) if (!Number.isNaN(La[k])) tp = Math.max(tp, La[k]);
      probe = [];
      // (03/11/2026) 4 000 points au plus : les bords et ce qui entre d'abord, un echantillon regulier du reste (la passe
      // fine, au 0,2 mm, en prenait 42 000 sur une glissiere de 110 mm : 20 s)
      const keyP = [], restP = [];
      for (let j = 0, n = 0; j < mv; j++) for (let i = 0; i < mu; i++) {
        const z = La[j * mu + i];
        if (Number.isNaN(z)) continue;
        n++;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b2]) => { const x = i + a, y = j + b2; return x < 0 || y < 0 || x >= mu || y >= mv || Number.isNaN(La[y * mu + x]) || Math.abs(La[y * mu + x] - z) > 0.35; });
        // (un point du pourtour rentre de 0,05 mm vers la piece : pose pile sur son bord, son rayon touchait une piece
        // voisine a fleur -- un panneau en place contre une boite plus haute se croyait enfonce de 14 mm)
        let ex = 0, ey = 0;
        if (edge) for (const [a, b2] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = i + a, y = j + b2; if (x >= 0 && y >= 0 && x < mu && y < mv && !Number.isNaN(La[y * mu + x])) { ex += a; ey += b2; } }
        const el = Math.hypot(ex, ey) || 1;
        if (edge || z < tp - 0.35) keyP.push(ga + i * h - cu + 0.05 * ex / el, gb + j * h - cv + 0.05 * ey / el, z);
        else if (n % 4 === 0) restP.push(ga + i * h - cu, gb + j * h - cv, z);
      }
      const take = (src, max) => {
        const m = src.length / 3;
        for (let q = 0; q < max; q++) { const k = Math.floor(q * m / max) * 3; probe.push(src[k], src[k + 1], src[k + 2]); }
      };
      const nk = keyP.length / 3, nr = restP.length / 3;
      const mk = Math.min(nk, Math.max(3000, 4000 - nr)), mr = Math.min(nr, 4000 - mk);
      take(keyP, mk); take(restP, mr);
    }
    const cs = Math.cos(b.th), sn = Math.sin(b.th), top = sb.hi[2] + 1, dn = w.clone().negate();
    let d = -Infinity, on = 0;
    const np = probe.length / 3;
    for (let q = 0; q < np; q++) {
      const k = ((q + killer) % np) * 3;
      const x = cu + cs * probe[k] - sn * probe[k + 1] + b.su, y = cv + sn * probe[k] + cs * probe[k + 1] + b.sv;
      o.copy(P).addScaledVector(u, x).addScaledVector(v, y).addScaledVector(w, top);
      const t = first(B, o, dn);
      if (t === Infinity) continue;
      on++;
      const e = top - t - probe[k + 2];
      if (e > d) d = e;
      if (d > cap) { killer = k / 3; return d; }
    }
    // (la piece est deja centree sur son creux : le bord d'un couvercle qui deborde de sa boite ne trouve rien dessous)
    return on >= 0.5 * (probe.length / 3) ? d : Infinity;
  };
  let gBest = null, gHere = null;
  // (03/11/2026) en collision, vraiment : aux vrais rayons, la piece traverse son support de plus de 0,3 mm a sa place
  // de depart (posee en vrac). Elle a alors le droit de remonter, et sa descente se mesure depuis la hauteur ou elle
  // ne traverse plus rien -- pas depuis sa place enfoncee, d'ou tout semblait « remonter »
  const pen0 = mode === "nest" ? exactLift({ th: 0, su: 0, sv: 0 }) : -Infinity;
  const colliding = pen0 !== Infinity && pen0 > 0.3;
  const ref0 = colliding ? pen0 : 0;
  if (mode === "nest") {
    // (le dessous entier, sans rogner : une jupe de 1,2 mm rognee d'une maille perdait des morceaux, son centre se
    // decalait d'un demi-millimetre et le couvercle ne passait plus)
    const all0 = pick(0);
    let top = -Infinity;
    for (let k = 2; k < all0.length; k += 3) top = Math.max(top, all0[k]);
    let ex = 0, ey = 0, en = 0;
    for (let k = 0; k < all0.length; k += 3) if (all0[k + 2] < top - 0.35) { ex += all0[k]; ey += all0[k + 1]; en++; }
    if (!en) for (let k = 0; k < all0.length; k += 3) { ex += all0[k]; ey += all0[k + 1]; en++; }
    ex /= en; ey /= en;
    // le creux : les mailles sous la face collee, d'un seul tenant, sous la partie qui entre (ou au plus pres)
    const i0 = Math.round((cu + ex - bu0) / h), j0 = Math.round((cv + ey - bv0) / h), low = q => !Number.isNaN(H[q]) && H[q] < -0.35;
    let seed = -1, bd = Infinity;
    const R0 = Math.ceil(Math.max(half, 10) / h);
    for (let j = Math.max(0, j0 - R0); j <= Math.min(nv - 1, j0 + R0); j++) for (let i = Math.max(0, i0 - R0); i <= Math.min(nu - 1, i0 + R0); i++) {
      if (!low(j * nu + i)) continue;
      const d2 = (i - i0) ** 2 + (j - j0) ** 2;
      if (d2 < bd) { bd = d2; seed = j * nu + i; }
    }
    if (seed >= 0) {
      const seen = new Uint8Array(nu * nv), st = [seed];
      seen[seed] = 1;
      let px = 0, py = 0, pn = 0;
      while (st.length) {
        const q = st.pop(), i = q % nu, j = (q - i) / nu;
        px += i; py += j; pn++;
        for (const [a, b2] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = i + a, y = j + b2, q2 = y * nu + x;
          if (x >= 0 && y >= 0 && x < nu && y < nv && !seen[q2] && low(q2)) { seen[q2] = 1; st.push(q2); }
        }
      }
      // le creux ne doit pas deborder de la zone (un sol tout autour n'est pas un creux)
      if (pn > 4) {
        const pcx = bu0 + (px / pn) * h, pcy = bv0 + (py / pn) * h;
        const ths = square !== null ? [0, 1, 2, 3].map(q => square + q * Math.PI / 2) : [0];
        for (const th of ths) {
          const c = Math.cos(th), sn = Math.sin(th);
          const g = fix({ th, su: pcx - cu - (c * ex - sn * ey), sv: pcy - cv - (sn * ex + c * ey) });
          const sc = score(2, g.th, g.su, g.sv);
          if (sc < Infinity) guesses.push({ ...g, c: sc });
          // verifiee aux vrais rayons, et a 0,2 mm pres autour
          // l'angle aussi, aux vrais rayons : l'equerre estimee l'est a 0,3° pres, soit 0,4 mm au bout d'un couvercle de
          // 140 mm -- plus que le jeu ; de 0,05° en 0,05° sur ±1°, la piece recentree a chaque angle
          const here0 = gHere ?? (gHere = exactLift({ th: 0, su: 0, sv: 0 }));
          if (here0 !== Infinity && sc < Infinity) {
            const at = t => { const c2 = Math.cos(t), s2 = Math.sin(t); return fix({ th: t, su: pcx - cu - (c2 * ex - s2 * ey), sv: pcy - cv - (s2 * ex + c2 * ey) }); };
            // de 0,25° en 0,25° sur ±4° (l'equerre estimee se trompe parfois de 3°), puis de 0,05° sur la plage des angles
            // qui descendent aussi bas : son milieu (le meme jeu des deux cotes)
            const res = [];
            // (au-dessus de la meilleure deja vue, a 0,05 pres : perdue, pas besoin de sa vraie hauteur)
            let lo0 = Infinity;
            for (let da = -4; da <= 4.0001; da += 0.25) { await tk(); const e = exactLift(at(th + da * Math.PI / 180), lo0 + 0.05); if (e < lo0) lo0 = e; res.push([da, e]); }
            const low = Math.min(...res.map(x => x[1]));
            // (elle descend sous la face collee, d'au moins 0,3 mm : meme si la piece flottait deja au-dessus)
            if (low < Infinity && low >= -maxSink && low < -0.3 && low <= here0 + 0.05) {
              const ok = res.filter(x => x[1] <= low + 0.05).map(x => x[0]);
              const fine = [];
              for (let da = Math.min(...ok) - 0.25; da <= Math.max(...ok) + 0.2501; da += 0.05) { await tk(); const dl = exactLift(at(th + da * Math.PI / 180), low + 0.05); if (dl <= low + 0.05) fine.push(da); }
              if (fine.length) {
                let b = at(th + ((Math.min(...fine) + Math.max(...fine)) / 2) * Math.PI / 180);
                // puis la position, aux vrais rayons aussi : sur ±1 mm dans chaque sens, le milieu de la plage ou elle
                // descend aussi bas (le centre du creux, lu sur la carte, l'etait a une demi-maille pres)
                for (const ax of ["su", "sv"]) {
                  const okp = [];
                  for (let dd = -1; dd <= 1.0001; dd += 0.05) { await tk(); const c2 = fix({ ...b, [ax]: b[ax] + dd }); if (exactLift(c2, low + 0.05) <= low + 0.05) okp.push(dd); }
                  if (okp.length) b = fix({ ...b, [ax]: b[ax] + (Math.min(...okp) + Math.max(...okp)) / 2 });
                }
                const dl = exactLift(b);
                if (dl <= low + 0.05 && (!gBest || dl < gBest.d - 0.05)) gBest = { b, d: dl };
              }
            }
          }
        }
      }
    }
  }
  fines.sort((a, b) => a.c - b.c);
  // la place « a la main » d'abord, la mieux notee de ses angles en tete
  fines.unshift(...guesses.sort((a, b) => a.c - b.c));
  if (!fines.length) return null;
  const here = mode === "align" ? Infinity : lift(H, nu, nv, h, exact, 0, 0, 0);
  // la hauteur d'une place : aligner pose la face collee sur la face qui porte ; emboiter descend jusqu'au contact
  const dOf = b => (mode === "align" ? fLev - lvl : lift(H, nu, nv, h, exact, b.th, b.su, b.sv));
  const mid = async (f, x0, step, lim) => {
    let a = 0, b = 0;
    while (a < lim && f(x0 - (a + 1) * step)) { a++; if (a % 8 === 0) await tk(); }
    while (b < lim && f(x0 + (b + 1) * step)) { b++; if (b % 8 === 0) await tk(); }
    return x0 + (b - a) / 2 * step;
  };
  // une place -> la transformation (repere du support du modele) : tourner autour de la normale par le centre de la
  // piece, puis glisser et descendre (ou monter) jusqu'au contact
  const C = P.clone().addScaledVector(u, cu).addScaledVector(v, cv);
  const matOf = (b, d) => {
    const R = new THREE.Matrix4().makeTranslation(C.x, C.y, C.z).multiply(new THREE.Matrix4().makeRotationAxis(w, b.th))
      .multiply(new THREE.Matrix4().makeTranslation(-C.x, -C.y, -C.z));
    const sh = u.clone().multiplyScalar(b.su).addScaledVector(v, b.sv).addScaledVector(w, d);
    return new THREE.Matrix4().makeTranslation(sh.x, sh.y, sh.z).multiply(R);
  };
  // les meilleures dans l'ordre, la premiere qui ne traverse aucune autre piece (collides : le test des collisions de
  // l'editeur, 30/10/2026 : seule la piece support comptait, l'aile s'emboitait dans le corps a travers l'autre aile)
  let best = null, blocked = 0;
  // la place « a la main » descend deja sous la face collee : pas la peine de passer les autres au crible fin (un grand
  // couvercle y passait trente secondes)
  for (const f of gBest && gBest.d < -0.3 ? [] : fines.slice(0, 12)) {
    let b = { ...f, c: score(2, f.th, f.su, f.sv) };
    // l'angle d'equerre le plus proche, essaye d'abord (03/11/2026 : la finition ne tourne que de 1,5° ; un couvercle
    // pose a 3° de travers n'y entrait jamais)
    if (square !== null) {
      const t = square + Math.round((b.th - square) / (Math.PI / 2)) * Math.PI / 2;
      if (Math.abs(wrap(t - b.th)) < 10 * Math.PI / 180) { const c = score(2, t, b.su, b.sv); if (c < b.c) b = { th: t, su: b.su, sv: b.sv, c }; }
    }
    if (b.c === Infinity) b.c = 1e9;
    // a la maille et au demi-degre pres autour d'elle
    for (let it = 0; it < 3; it++) {
      const b0 = { ...b }, r = it ? 2 * h : fs;
      await tk();
      for (let da = -1.5; da <= 1.5; da += 0.5) for (let dv = -r; dv <= r + 1e-9; dv += r / 2) for (let du = -r; du <= r + 1e-9; du += r / 2) {
        if (du === -r) await tk();
        const th = b0.th + da * Math.PI / 180, su = b0.su + du, sv = b0.sv + dv, c = score(2, th, su, sv);
        if (c < b.c) b = { th, su, sv, c };
      }
    }
    // au milieu de ce qui va aussi bien (un logement ou une face plus grands que la piece), en angle puis en position,
    // deux fois (sinon elle restait de biais, collee a un bord) ; la note sans la penalite de chemin
    const raw = (th, su, sv) => { const c = score(2, th, su, sv); return c === Infinity ? Infinity : c - (mode === "align" ? 0.05 * Math.hypot(su, sv) + 0.004 * turn(th) : pen(su, sv, th)); };
    const ref = raw(b.th, b.su, b.sv), okp = (th, su, sv) => raw(th, su, sv) <= ref + 0.05;
    const c0 = { ...b };
    // (pas plus loin que la recherche ne peut aller : la passe fine, a 3 mm, marchait 80 mm de chaque cote au 0,2 mm)
    const ml = reach !== null ? Math.min(400, Math.ceil(reach / h) + 2) : 400, al = lock !== null ? Math.min(120, Math.ceil(lock / (Math.PI / 360)) + 2) : 120;
    for (let it = 0; it < 2; it++) {
      await tk();
      b.th = await mid(t => okp(t, b.su, b.sv), b.th, Math.PI / 360, al);
      b.su = await mid(x => okp(b.th, x, b.sv), b.su, h, ml);
      b.sv = await mid(y => okp(b.th, b.su, y), b.sv, h, ml);
    }
    // presque d'equerre : tout a fait, si ca ne coute rien d'autre (les pas d'un demi-degre laissaient un reste)
    if (sharp && skew(b.th) > 0 && skew(b.th) < 3) {
      for (let q = -1; q <= 1; q++) {
        const t = square + Math.round((b.th - square) / (Math.PI / 2) + q) * Math.PI / 2;
        if (skew(t) < 0.01 && Math.abs(t - b.th) < 3.5 * Math.PI / 180 && raw(t, b.su, b.sv) <= raw(b.th, b.su, b.sv) + 0.02) { b.th = t; break; }
      }
      b.su = await mid(x => okp(b.th, x, b.sv), b.su, h, ml);
      b.sv = await mid(y => okp(b.th, b.su, y), b.sv, h, ml);
    }
    b = fix(b);
    // plus rien a gagner (center : la passe fine, ou se centrer a la meme profondeur est le but)
    // rien a gagner ici : la suivante (03/11/2026 : on s'arretait a la premiere, meme quand une autre allait mieux)
    if (mode === "nest" && !center && here !== Infinity && lift(H, nu, nv, h, exact, b.th, b.su, b.sv) > here - 0.05) continue;
    let found = null;
    for (const cand of [b, fix(c0)]) {
      const d = dOf(cand);
      if (d === Infinity) continue;
      if (collides && await collides(matOf(cand, d))) { blocked++; continue; }
      found = cand; break;
    }
    if (found) { best = found; break; }
  }
  // rien de mieux qu'a sa place : elle y reste, mais descend jusqu'au contact (03/11/2026 : une piece collee au-dessus
  // d'un logement restait en l'air, « deja a la meilleure place »)
  const stay = () => {
    // descendre seulement (03/11/2026 : sur une piece imbriquee, la carte des hauteurs la croit un peu dans son support,
    // et « descendre au contact » la soulevait hors du plan de collage)
    // (en collision : sortir, juste au contact)
    const dz = colliding ? pen0 : here !== Infinity && here <= -0.05 ? here : 0;
    return { M: new THREE.Matrix4().makeTranslation(w.x * dz, w.y * dz, w.z * dz), sink: colliding ? -dz : ref0 - dz, depth: -dz, moved: 0, turned: 0, contact: P.clone().addScaledVector(w, dz),
      engaged: engaged && !colliding, colliding, pen0 };
  };
  // la place « a la main », verifiee aux vrais rayons, l'emporte si elle descend plus bas (et ne traverse aucune
  // autre piece)
  let forcedD = null;
  // (a profondeur egale aussi : elle est d'equerre et centree, la carte ne l'est qu'a la maille pres -- un bloc finissait a
  // 2,9° dans sa poche)
  if (gBest && (!best || gBest.d <= dOf(best) + 0.05) && !(collides && await collides(matOf(gBest.b, gBest.d)))) { best = gBest.b; forcedD = gBest.d; }
  if (!best) return blocked ? { blocked } : (mode === "nest" ? stay() : null);
  const d = forcedD ?? dOf(best);
  if (mode === "nest" && !center && forcedD === null && here !== Infinity && d > here - 0.05) return stay();
  // (03/11/2026) ce qui est dit et juge : la part de la face collee qui repose sur la face qui porte (avant : leur
  // recouvrement mutuel, qui tombait sous 30 % des que la face qui porte etait bien plus grande que la piece -- une
  // plaque sur le dessus d'un cadre : « pas de face plane ») ; et le gain de la note (tourner pour se mettre d'equerre
  // ne change pas ce qui repose, mais compte)
  const cov0 = mode === "align" ? onFace(face, nu, nv, h, foot, 0, 0, 0) : 0, cov1 = mode === "align" ? onFace(face, nu, nv, h, foot, best.th, best.su, best.sv) : 0;
  // (la place seule : le chemin parcouru, recentrage compris, ne compte pas contre elle)
  const gain = mode === "align" ? score(2, 0, 0, 0) - (score(2, best.th, best.su, best.sv) - 0.05 * Math.hypot(best.su, best.sv) - 0.004 * turn(best.th)) : 0;
  const clash1 = mode === "align" ? clash(H, nu, nv, h, cells, best.th, best.su, best.sv)[0] : 0;
  const M = matOf(best, d);
  // le point de contact : sous le centre de la piece, sur le dessus du support
  const i = Math.round((cu + best.su - bu0) / h), j = Math.round((cv + best.sv - bv0) / h);
  // aligner : le contact est sur la face qui porte (03/11/2026 : sous le centre, il tombait entre deux montants, sur la
  // traverse du bas, et la passe fine de Caler s'alignait la-dessus)
  const zc = mode === "align" ? fLev : (i >= 0 && j >= 0 && i < nu && j < nv && !Number.isNaN(H[j * nu + i])) ? H[j * nu + i] : d;
  const contact = P.clone().addScaledVector(u, cu + best.su).addScaledVector(v, cv + best.sv).addScaledVector(w, zc);
  // emboiter : la part du pourtour de la piece, a sa place, qui reste a la hauteur de la face collee (03/11/2026 : un
  // logement -- rainure, poche -- est entoure par la face ou on a colle ; tomber du bord d'un plot sur la face d'en
  // dessous n'est pas s'emboiter)
  let surround = null;
  if (mode === "nest") {
    // la partie qui entre (03/11/2026) : ce qui passe sous la face collee une fois descendue -- la jupe d'un couvercle,
    // pas le couvercle entier, qui deborde de la boite ; toute la reglette dans sa rainure
    const cs = Math.cos(best.th), sn = Math.sin(best.th), occ = new Uint8Array(nu * nv), dB = d;
    for (let k = 0; k < exact.length; k += 3) {
      if (exact[k + 2] + dB >= -0.35) continue;
      const x = cu + cs * exact[k] - sn * exact[k + 1] + best.su, y = cv + sn * exact[k] + cs * exact[k + 1] + best.sv;
      const i = Math.round((x - bu0) / h), j = Math.round((y - bv0) / h);
      if (i >= 0 && j >= 0 && i < nu && j < nv) occ[j * nu + i] = 1;
    }
    // l'empreinte tournee laisse des trous entre ses mailles : bouchee d'une maille d'abord
    const fill = new Uint8Array(nu * nv);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (!occ[j * nu + i]) continue;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = i + di, y = j + dj; if (x >= 0 && y >= 0 && x < nu && y < nv) fill[y * nu + x] = 1; }
    }
    occ.set(fill);
    // depuis le centre de la piece, dans douze directions : passe son bord, trouve-t-on la face collee (a sa hauteur, a
    // 0,35 mm pres) a moins de 5 mm ? Un logement a des parois tout autour, meme lache (2 mm de jeu) ; le bord d'un plot
    // dont on tombe n'en a que d'un cote ; une rainure, des deux cotes et pas a ses bouts
    // depuis le dernier bord de la partie qui entre (03/11/2026 : depuis le centre, la jupe fine d'un couvercle n'etait
    // jamais atteinte -- au centre, le vide de la boite) ; une direction sans rien de la piece ne compte pas
    const ci = (cu + best.su - bu0) / h, cj = (cv + best.sv - bv0) / h, D = Math.ceil(5 / h), far = Math.ceil((half + 6) / h);
    let hit = 0, dirs = 0;
    for (let k = 0; k < 12; k++) {
      const a = k * Math.PI / 6, dx = Math.cos(a), dy = Math.sin(a);
      let last = -1;
      for (let t = 0; t <= far; t++) {
        const i = Math.round(ci + dx * t), j = Math.round(cj + dy * t);
        if (i < 0 || j < 0 || i >= nu || j >= nv) break;
        if (occ[j * nu + i]) last = t;
      }
      if (last < 0) continue;
      dirs++;
      for (let t = last + 1; t <= last + D; t++) {
        const i = Math.round(ci + dx * t), j = Math.round(cj + dy * t);
        if (i < 0 || j < 0 || i >= nu || j >= nv) break;
        const q = j * nu + i;
        if (!Number.isNaN(H[q]) && H[q] >= -0.35) { hit++; break; }
      }
    }
    surround = dirs ? hit / dirs : 0;
  }
  const tr = best.th * 180 / Math.PI;
  return { M, sink: ref0 - d, depth: colliding ? ref0 - d : -d, drop: -d, moved: Math.hypot(best.su, best.sv), turned: ((tr + 540) % 360) - 180, contact, cov0, cov1, gain, surround, clash: clash1, blocked, exact: forcedD !== null, engaged: engaged && !colliding, colliding, pen0 };
}


// Caler dans le plan (03/11/2026) : collee face contre face mais en collision (posee en vrac, a cheval sur une paroi),
// la piece garde son plan de collage -- elle glisse et tourne seulement, jusqu'a la place libre la plus proche, puis se
// centre dans son jeu, et ne descend que si elle flotte au-dessus d'un fond. Les cartes de hauteur d'emboiter ne voient
// que le dessus des pieces : une glissiere en queue d'aronde (son pied plus large que l'ouverture, sous les levres du
// canal) n'y avait pas de place. Ici chaque colonne garde toute sa matiere, couche par couche (les entrees et sorties
// d'un rayon qui traverse la piece) : une place est libre si, colonne par colonne, rien de la piece ne croise rien du
// support. Rend null si la piece ne traverse rien a sa place (rien a faire ici) ou si aucune place libre n'est proche.
// deep (03/11/2026) : la place prisonniere la plus basse autour, la piece n'etant pas en collision -- une glissiere posee
// sur le dessus de son couvercle, au-dessus de son canal en queue d'aronde : emboiter, qui la fait descendre d'en haut,
// ne l'y voit pas. Seulement s'il y a des contre-depouilles (une colonne a plusieurs couches) sous la piece ou en elle
export async function planeFree({ THREE, collider, moving, base, P, N, collides = null, lock = null, axis = null, reach = null, tick = null, deep = false }) {
  const tk = tick || (() => null);
  const { MeshBVH } = await import("three-mesh-bvh");
  const w = N.clone().normalize();
  const u = (Math.abs(w.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).cross(w).normalize();
  const v = w.clone().cross(u);
  const fr = p => { const d = p.clone().sub(P); return [d.dot(u), d.dot(v), d.dot(w)]; };
  const ax = axis ? (() => { const a = [axis.dot(u), axis.dot(v)], l = Math.hypot(a[0], a[1]); return l > 1e-6 ? [a[0] / l, a[1] / l] : null; })() : null;
  const bvhOf = g => {
    const geo = collider.geoOf(g);
    if (!geo.boundsTree) geo.boundsTree = new MeshBVH(geo);
    g.updateMatrix();
    return { bvh: geo.boundsTree, m: g.matrix.clone(), inv: g.matrix.clone().invert() };
  };
  const A = moving.map(bvhOf), B = base.map(bvhOf);
  const span = list => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const g of list) {
      const b = new THREE.Box3();
      g.children.forEach(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(g.matrix)); } });
      for (let i = 0; i < 8; i++) {
        const q = fr(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
        for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], q[c]); hi[c] = Math.max(hi[c], q[c]); }
      }
    }
    return { lo, hi };
  };
  const sa = span(moving), sb = span(base);
  if (!(sb.hi[0] > sb.lo[0])) return null;
  // la matiere d'une colonne, en w : [bas, haut, bas, haut, ...] (un rayon qui descend : il entre dans la matiere par
  // une face tournee vers lui, en sort par une face tournee a l'oppose ; un leger decalage evite de passer pile sur une
  // arete, comptee deux fois)
  const ray = new THREE.Ray(), o = new THREE.Vector3(), lp = new THREE.Vector3(), dn = w.clone().negate();
  const column = (list, x, y, top) => {
    o.copy(P).addScaledVector(u, x + 1.37e-4).addScaledVector(v, y + 2.91e-4).addScaledVector(w, top);
    const ev = [];
    for (const { bvh, m, inv } of list) {
      ray.origin.copy(o).applyMatrix4(inv); ray.direction.copy(dn).transformDirection(inv);
      for (const hit of bvh.raycast(ray, THREE.DoubleSide)) {
        lp.copy(hit.point).applyMatrix4(m);
        ev.push([lp.sub(P).dot(w), hit.face.normal.dot(ray.direction) < 0 ? 1 : -1]);
      }
    }
    ev.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const out = [];
    let n = 0, hi = 0;
    for (const [z, e] of ev) {
      if (e > 0) { if (n++ === 0) hi = z; }
      else if (n > 0 && --n === 0 && hi - z > 1e-4) out.push(z, hi);
    }
    return out;
  };
  // la piece : ses colonnes sur une grille centree (pas hp), autour de son centre
  const cu = (sa.lo[0] + sa.hi[0]) / 2, cv = (sa.lo[1] + sa.hi[1]) / 2, ptop = sa.hi[2] + 1;
  const pieceGrid = async hp => {
    const mu = Math.floor((sa.hi[0] - sa.lo[0]) / hp) + 1, mv = Math.floor((sa.hi[1] - sa.lo[1]) / hp) + 1;
    const ga = sa.lo[0] + ((sa.hi[0] - sa.lo[0]) - (mu - 1) * hp) / 2, gb = sa.lo[1] + ((sa.hi[1] - sa.lo[1]) - (mv - 1) * hp) / 2;
    const iv = [];
    for (let j = 0; j < mv; j++) { await tk(); for (let i = 0; i < mu; i++) iv.push(column(A, ga + i * hp, gb + j * hp, ptop)); }
    return { mu, mv, ga, gb, hp, iv };
  };
  // les mailles a la mesure de la piece (03/11/2026 : au quart de millimetre partout, une grande piece faisait des
  // centaines de milliers de colonnes -- la page figee, puis l'ecran noir) : 40 000 colonnes au plus en fin, 8 000 en gros
  const area = Math.max(1, (sa.hi[0] - sa.lo[0]) * (sa.hi[1] - sa.lo[1]));
  const hpF = Math.max(0.25, Math.sqrt(area / 40000)), hpC = Math.max(0.5, Math.sqrt(area / 8000));
  // l'intersection de deux listes de couches
  const inter = (a, b) => {
    const out = [];
    for (let i = 0; i < a.length; i += 2) for (let j = 0; j < b.length; j += 2) {
      const lo = Math.max(a[i], b[j]), hi = Math.min(a[i + 1], b[j + 1]);
      if (hi > lo) out.push(lo, hi);
    }
    return out;
  };
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // les cellules a tester : rognees de n cellules sur les cotes (la grosse recherche, optimiste : elle avance a pas
  // d'un millimetre), et amincies de tol en hauteur ; d'abord celles ou la forme change (bords, levres, pieds), puis
  // une sur « every » des autres
  const cellsOf = (g, n, tol, every) => {
    let iv = g.iv;
    for (let it = 0; it < n; it++) {
      const nx = [];
      for (let j = 0; j < g.mv; j++) for (let i = 0; i < g.mu; i++) {
        let c = iv[j * g.mu + i];
        for (const [a, b] of N4) { const x = i + a, y = j + b; c = c.length ? inter(c, x < 0 || y < 0 || x >= g.mu || y >= g.mv ? [] : iv[y * g.mu + x]) : c; }
        nx.push(c);
      }
      iv = nx;
    }
    const edge = [], rest = [];
    let k = 0;
    for (let j = 0; j < g.mv; j++) for (let i = 0; i < g.mu; i++) {
      const c = iv[j * g.mu + i];
      const s = [];
      for (let q = 0; q < c.length; q += 2) if (c[q + 1] - c[q] > 2 * tol) s.push(c[q] + tol, c[q + 1] - tol);
      if (!s.length) continue;
      const cell = { x: g.ga + i * g.hp - cu, y: g.gb + j * g.hp - cv, s };
      const diff = N4.some(([a, b]) => {
        const x = i + a, y = j + b;
        if (x < 0 || y < 0 || x >= g.mu || y >= g.mv) return true;
        const o2 = iv[y * g.mu + x];
        return o2.length !== c.length || o2.some((z, q) => Math.abs(z - c[q]) > 0.3);
      });
      if (diff) edge.push(cell); else if (k++ % every === 0) rest.push(cell);
    }
    return edge.concat(rest);
  };
  // le support : ses colonnes a la demande, sur une grille de pas hb
  const btop = sb.hi[2] + 1;
  const baseGrid = hb => {
    const cache = new Map();
    return (x, y) => {
      const i = Math.round(x / hb), j = Math.round(y / hb), key = i * 100003 + j;
      let c = cache.get(key);
      if (!c) { c = x < sb.lo[0] - hb || x > sb.hi[0] + hb || y < sb.lo[1] - hb || y > sb.hi[1] + hb ? [] : column(B, i * hb, j * hb, btop); cache.set(key, c); }
      return c;
    };
  };
  // une place (angle th autour de w par le centre de la piece, glissement su, sv, hauteur d) traverse-t-elle le support ?
  const hits = (cells, col, th, su, sv, d) => {
    const cs = Math.cos(th), sn = Math.sin(th);
    for (const c of cells) {
      const b = col(cu + cs * c.x - sn * c.y + su, cv + sn * c.x + cs * c.y + sv);
      if (!b.length) continue;
      for (let q = 0; q < c.s.length; q += 2) {
        const lo = c.s[q] + d, hi = c.s[q + 1] + d;
        for (let r = 0; r < b.length; r += 2) if (lo < b[r + 1] && b[r] < hi) return true;
      }
    }
    return false;
  };
  const gF = await pieceGrid(hpF), fine = cellsOf(gF, 1, 0.05, 3), colF = baseGrid(Math.max(0.2, 0.8 * hpF));
  // en collision pour de bon a sa place (plus de 0,3 mm : une piece imbriquee, que les rayons voient un peu dans son
  // support, n'en est pas une)
  const firm = cellsOf(gF, 1, 0.3, 1);
  if (!firm.length) return null;
  if (!deep && !hits(firm, colF, 0, 0, 0, 0)) return { M: null, free: true };
  // la grosse recherche : des angles du plus petit au plus grand, des glissements de 1 mm (plus pour une grande piece),
  // la piece rognee d'autant que la moitie d'un pas et d'une maille du support (optimiste : rien de bon n'est manque, la
  // recherche fine verifie)
  const st = Math.max(1, hpC), hbC = Math.max(0.5, hpC);
  const gC = await pieceGrid(hpC), coarse = cellsOf(gC, Math.ceil((st / 2 + hbC / 2) / hpC), 0.15, 4), colC = baseGrid(hbC);
  // (pour les recherches en hauteur, qui lisent chaque cellule : 700 au plus, a pas reguliers -- optimiste aussi)
  const coarseG = coarse.length > 700 ? coarse.filter((_, k) => k % Math.ceil(coarse.length / 700) === 0) : coarse;
  const R = reach !== null ? Math.min(reach, deep ? 10 : 15) : deep ? 10 : 15, maxA = Math.min(deep ? 12 : 30, lock === null ? 30 : lock * 180 / Math.PI);
  const T = sa.hi[2] - sa.lo[2], dLo = -T, dHi = 0.5 - sa.lo[2];
  if (deep) {
    // des contre-depouilles ? une colonne de la piece a plusieurs couches, ou une du support dans la tranche ou la piece
    // peut descendre (tous les 0,8 mm sous la piece : une levre de canal ne deborde que d'un millimetre)
    const multi = c => c.length > 2;
    let under = gF.iv.some(multi);
    const wLo = sa.lo[2] - T - 0.5, wHi = sa.hi[2] + 0.5;
    for (let y = sa.lo[1]; y <= sa.hi[1] && !under; y += 0.8) {
      await tk();
      for (let x = sa.lo[0]; x <= sa.hi[0] && !under; x += 0.8) {
        const b = colC(x, y);
        let k = 0;
        for (let r = 0; r < b.length; r += 2) if (b[r + 1] > wLo && b[r] < wHi) k++;
        if (k > 1) under = true;
      }
    }
    if (!under) return null;
  }
  const angs = [0];
  for (const a of [1, 2, 3, 4, 5, 6, 7.5, 9, 10.5, 12, 15, 17.5, 20, 22.5, 25, 27.5, 30]) if (a <= maxA + 1e-9) angs.push(a, -a);
  const cost = (th, su, sv) => Math.hypot(su, sv) + 0.15 * Math.abs(th * 180 / Math.PI);
  // essayees de la plus proche a la plus lointaine : on s'arrete a huit places libres distinctes, ou a 4 mm (ou 27°)
  // au-dela de la premiere
  const poses = [];
  for (const a of angs) {
    const th = a * Math.PI / 180;
    if (ax) for (let s = -R; s <= R + 1e-9; s += st) poses.push({ th, su: s * ax[0], sv: s * ax[1] });
    else for (let sv = -R; sv <= R + 1e-9; sv += st) for (let su = -R; su <= R + 1e-9; su += st) if (Math.hypot(su, sv) <= R + 1e-9) poses.push({ th, su, sv });
  }
  await tk();
  for (const q of poses) q.c = cost(q.th, q.su, q.sv);
  poses.sort((a, b) => a.c - b.c);
  const tops = [];
  for (let k = 0; k < poses.length && !deep; k++) {
    const q = poses[k];
    if (k % 16 === 0) await tk();
    if (tops.length >= 8 || (tops.length && q.c > tops[0].c + 4)) break;
    if (tops.some(t => Math.hypot(t.su - q.su, t.sv - q.sv) < 2 * st && Math.abs(t.th - q.th) < 2 * Math.PI / 180)) continue;
    if (!hits(coarse, colC, q.th, q.su, q.sv, 0)) tops.push(q);
  }
  // rien de libre dans le plan (03/11/2026 : une glissiere enfoncee de 1,5 mm dans son couvercle, en vrac) : la hauteur
  // aussi, au plus pres. Pour une place (th, su, sv), les hauteurs ou la piece traverse sont, colonne par colonne, des
  // intervalles (une couche de la piece contre une couche du support) : la hauteur libre la plus proche s'en deduit
  // d'un coup. Monter coute 2 mm de chemin par mm (sortir de cote d'abord), descendre 3 ; le bas de la piece reste sous la face collee
  // (+0,5 mm), et elle ne s'enfonce pas de plus que son epaisseur
  const dCost = d => (d >= 0 ? 2 * d : -3 * d);
  // maxC : le cout au-dela duquel la hauteur ne sert plus (la place la plus proche deja trouvee) -- la fenetre des
  // hauteurs utiles en est d'autant plus etroite. Sans tri : on monte (ou descend) de bout en bout des intervalles qui
  // contiennent la hauteur courante, jusqu'a en sortir
  let F0 = new Float64Array(4096), F1 = new Float64Array(4096);
  let n = 0;
  const gather = (cells, col, th, su, sv, lo, hi) => {
    const cs = Math.cos(th), sn = Math.sin(th);
    n = 0;
    for (const c of cells) {
      const b = col(cu + cs * c.x - sn * c.y + su, cv + sn * c.x + cs * c.y + sv);
      for (let q = 0; q < c.s.length; q += 2) for (let r = 0; r < b.length; r += 2) {
        const f0 = b[r] - c.s[q + 1], f1 = b[r + 1] - c.s[q];
        if (f1 <= lo || f0 >= hi) continue;
        if (n === F0.length) { const g0 = new Float64Array(2 * n), g1 = new Float64Array(2 * n); g0.set(F0); g1.set(F1); F0 = g0; F1 = g1; }
        F0[n] = f0; F1[n] = f1; n++;
      }
    }
  };
  // rend la hauteur ou elle sort des intervalles en partant de d (moved : elle a du bouger)
  let moved = false;
  const climb = (d, upward, lo, hi) => {
    moved = false;
    for (let pass = 0; pass < 64; pass++) {
      let mv = false;
      for (let i = 0; i < n; i++) if (F0[i] < d && d < F1[i]) { d = upward ? F1[i] : F0[i]; mv = true; }
      if (!mv) return d;
      moved = true;
      if (d > hi || d < lo) return null;
    }
    return null;
  };
  const freeD = (cells, col, th, su, sv, maxC = Infinity) => {
    const lo = Math.max(dLo, -maxC / 3), hi = Math.min(dHi, maxC / 2);
    if (lo > hi) return null;
    gather(cells, col, th, su, sv, lo, hi);
    const up = climb(0, true, lo, hi), dn = climb(0, false, lo, hi);
    if (up === 0) return 0;
    const ok = d => d !== null && d >= lo && d <= hi;
    if (ok(up) && ok(dn)) return dCost(up) <= dCost(dn) ? up : dn;
    return ok(up) ? up : ok(dn) ? dn : null;
  };
  // deep : la plus basse ou elle repose (on part du plus bas permis, on remonte jusqu'a sortir de la matiere ; si rien ne
  // la porte la, elle tomberait plus bas : pas une place), a 0,3 mm au moins sous sa place
  // (on part 1,5 mm sous son epaisseur : partie pile de la, une glissiere a 0,1 mm de jeu au-dessus du fond de son canal
  // « flottait » et la place etait ecartee ; le dessus de la piece reste au plus 0,3 mm sous la face collee)
  const dTop = -0.3 - sa.hi[2];
  const deepD = (cells, col, th, su, sv) => {
    const d0 = dLo - 1.5;
    gather(cells, col, th, su, sv, d0 - 0.5, 0.5);
    const d = climb(d0, true, d0 - 0.5, 0.5);
    return d !== null && moved && d <= -0.3 && d >= dTop ? d : null;
  };
  if (deep) {
    for (let k = 0; k < poses.length; k++) {
      const q = poses[k];
      if (k % 16 === 0) await tk();
      const d = deepD(coarseG, colC, q.th, q.su, q.sv);
      if (d === null) continue;
      const c = q.c + 3 * d;
      if (tops.some(t => Math.hypot(t.su - q.su, t.sv - q.sv) < 2 * st && Math.abs(t.th - q.th) < 2 * Math.PI / 180 && t.c <= c)) continue;
      tops.push({ ...q, d, c });
      tops.sort((a, b) => a.c - b.c);
      if (tops.length > 4) tops.length = 4;
    }
  }
  let lift = false;
  if (!tops.length && !deep) {
    lift = true;
    let stop = Infinity;
    for (let k = 0; k < poses.length; k++) {
      const q = poses[k];
      if (k % 16 === 0) await tk();
      if (q.c > stop) break;
      if (tops.some(t => Math.hypot(t.su - q.su, t.sv - q.sv) < 2 * st && Math.abs(t.th - q.th) < 2 * Math.PI / 180)) continue;
      const d = freeD(coarseG, colC, q.th, q.su, q.sv, stop - q.c);
      if (d === null) continue;
      tops.push({ ...q, d, c: q.c + dCost(d) });
      tops.sort((a, b) => a.c - b.c);
      if (tops.length > 4) tops.length = 4;
      stop = tops[0].c + 2;
    }
  }
  if (!tops.length) return null;
  let curD = 0;
  const okF = (th, su, sv) => !hits(fine, colF, th, su, sv, curD);
  const prj = (su, sv) => (ax ? [(su * ax[0] + sv * ax[1]) * ax[0], (su * ax[0] + sv * ax[1]) * ax[1]] : [su, sv]);
  // le milieu de ce qui est libre autour de x0 (pas step, au plus lim pas de chaque cote) ; libre jusqu'au bout d'un
  // cote : pas de jeu a partager, x0 reste
  // (par bonds de 4 pas, puis par moities entre le dernier bon et le premier mauvais : le meme bord, dix fois moins
  // d'essais -- le centrage prenait deux secondes)
  const mid = async (f, x0, step, lim) => {
    const edge = async dir => {
      let ok = 0;
      while (ok < lim) {
        const nx = Math.min(lim, ok + 4);
        if (!f(x0 + dir * nx * step)) {
          let a = ok, b = nx;
          while (b - a > 1) { const m = (a + b) >> 1; if (f(x0 + dir * m * step)) a = m; else b = m; }
          return a;
        }
        ok = nx;
        await tk();
      }
      return lim;
    };
    const a = await edge(-1), b = await edge(1);
    return a >= lim || b >= lim ? x0 : x0 + (b - a) / 2 * step;
  };
  // le point de rotation : le centre de la piece, sur la face collee
  const C = P.clone().addScaledVector(u, cu).addScaledVector(v, cv);
  const matOf = (b, d) => {
    const Rm = new THREE.Matrix4().makeTranslation(C.x, C.y, C.z).multiply(new THREE.Matrix4().makeRotationAxis(w, b.th))
      .multiply(new THREE.Matrix4().makeTranslation(-C.x, -C.y, -C.z));
    const sh = u.clone().multiplyScalar(b.su).addScaledVector(v, b.sv).addScaledVector(w, d);
    return new THREE.Matrix4().makeTranslation(sh.x, sh.y, sh.z).multiply(Rm);
  };
  // descendre seulement si elle flotte au-dessus d'un fond (pas plus bas que son epaisseur : elle ne tombe pas a travers
  // une fente) ; posee face contre face, elle ne bouge pas
  const maxSink = sa.hi[2] - sa.lo[2] + 0.5;
  const dropOf = async (b, d0) => {
    let lo = d0, n = 0;
    const step = 0.05;
    while (lo - step >= d0 - maxSink && !hits(fine, colF, b.th, b.su, b.sv, lo - step)) { lo -= step; if (++n % 16 === 0) await tk(); }
    // (la piece testee est amincie de 0,05 mm en hauteur : autant de moins, sinon posee a plat elle « descendait » d'autant)
    return lo - step < d0 - maxSink ? d0 : Math.min(d0, lo + 0.05);
  };
  // de la plus proche a la plus lointaine : la premiere libre, centree, qui ne traverse aucune autre piece
  let blocked = 0;
  for (const t of tops) {
    // la place libre la plus proche autour (au quart de millimetre, au quart de degre)
    const near = [];
    // (en hauteur aussi : moins d'essais, chacun cherche sa hauteur)
    const [A0, A1, U0] = lift || deep ? [1, 0.5, 1] : [1.5, 0.25, 1.25];
    for (let da = -A0; da <= A0 + 1e-4; da += A1) for (let dv = -U0; dv <= U0 + 1e-4; dv += 0.25) for (let du = -U0; du <= U0 + 1e-4; du += 0.25) {
      const th = t.th + da * Math.PI / 180;
      if (lock !== null && Math.abs(th) > lock + 1e-9) continue;
      const [su, sv] = prj(t.su + du, t.sv + dv);
      near.push({ th, su, sv, c: cost(th, su, sv) });
    }
    near.sort((a, b) => a.c - b.c);
    let b = null;
    if (deep) for (let k = 0; k < near.length; k++) {
      await tk();
      const d = deepD(fine, colF, near[k].th, near[k].su, near[k].sv);
      if (d !== null && (!b || near[k].c + 3 * d < b.c)) b = { ...near[k], d, c: near[k].c + 3 * d };
    }
    else if (!lift) { curD = 0; for (let k = 0; k < near.length && !b; k++) { if (k % 32 === 0) await tk(); if (okF(near[k].th, near[k].su, near[k].sv)) b = near[k]; } }
    else for (let k = 0; k < near.length; k++) {
      if (b && near[k].c > b.c) break;
      await tk();
      const d = freeD(fine, colF, near[k].th, near[k].su, near[k].sv, b ? b.c - near[k].c : Infinity);
      if (d !== null && (!b || near[k].c + dCost(d) < b.c)) b = { ...near[k], d, c: near[k].c + dCost(d) };
    }
    if (!b) continue;
    curD = b.d || 0;
    // centree dans son jeu : en angle (sur ±15° : des tenons dans leurs fentes se remettent d'equerre), puis le long de
    // ses propres cotes (une glissiere dans son canal), deux fois
    for (let it = 0; it < 2; it++) {
      if (lock !== 0) b.th = await mid(t2 => (lock === null || Math.abs(t2) <= lock + 1e-9) && okF(t2, b.su, b.sv), b.th, 0.1 * Math.PI / 180, 150);
      for (const [ex, ey] of [[Math.cos(b.th), Math.sin(b.th)], [-Math.sin(b.th), Math.cos(b.th)]]) {
        if (ax && Math.abs(ex * ax[0] + ey * ax[1]) < 0.99) continue;
        const s = await mid(k => okF(b.th, b.su + k * ex, b.sv + k * ey), 0, 0.05, 60);
        b.su += s * ex; b.sv += s * ey;
      }
    }
    if (!okF(b.th, b.su, b.sv)) continue;
    const d = await dropOf(b, curD), M = matOf(b, d);
    if (collides && await collides(M)) { blocked++; continue; }
    const tr = b.th * 180 / Math.PI;
    return { M, kind: "plane", sink: -d, depth: -d, drop: -d, moved: Math.hypot(b.su, b.sv), turned: ((tr + 540) % 360) - 180,
      contact: P.clone().addScaledVector(u, cu + b.su).addScaledVector(v, cv + b.sv).addScaledVector(w, d), exact: true };
  }
  return blocked ? { blocked } : null;
}


// Ajuster en 3D (03/11/2026) : la piece collee pres de sa place, de travers, glisse et tourne dans les trois dimensions
// (6 degres de liberte, autour de la ou elle est collee) jusqu'a ce que la face tournee vers l'autre piece la touche
// partout sans rien traverser -- une plaque au dessous a plusieurs pans dans son logement pyramidal d'une coque (le
// dessus d'une carapace) : ni emboiter (une seule direction de descente) ni aligner (une seule face plane) ne savent.
// La distance signee au support (< 0 dans sa matiere), lue au plus proche triangle, gardee sur une grille de 0,4 mm et
// interpolee ; l'energie : 6 x la penetration moyenne (au-dela de 0,1 mm) moins la part de la face d'appui a moins de
// 0,3 mm du support (en cloche) ; des pas sur chaque axe (trois rotations, trois glissements), de plus en plus fins.
// reach (mm) et turn (degres) bornent le chemin. Rend null si rien ne s'ameliore.
export async function fit3D({ THREE, collider, moving, base, P, N, collides = null, tick = null, reach = 6, turn = 25 }) {
  const tk = tick || (() => null);
  const { MeshBVH } = await import("three-mesh-bvh");
  const w = N.clone().normalize();
  const bases = base.map(g => {
    const geo = collider.geoOf(g);
    if (!geo.boundsTree) geo.boundsTree = new MeshBVH(geo);
    g.updateMatrix();
    return { geo, bvh: geo.boundsTree, m: g.matrix.clone(), inv: g.matrix.clone().invert(), nm: new THREE.Matrix3().getNormalMatrix(g.matrix) };
  });
  // la distance signee en un point (repere du modele) : au plus proche triangle des pieces support, du cote de sa normale
  const lp = new THREE.Vector3(), tgt = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const A_ = new THREE.Vector3(), B_ = new THREE.Vector3(), C_ = new THREE.Vector3(), nf = new THREE.Vector3(), wp = new THREE.Vector3();
  const BAND = 3;
  const sdfAt = (x, y, z) => {
    let best = BAND, sgn = 1;
    for (const b of bases) {
      lp.set(x, y, z).applyMatrix4(b.inv);
      const r = b.bvh.closestPointToPoint(lp, tgt, 0, BAND);
      if (!r || !Number.isFinite(r.distance)) continue;
      wp.copy(r.point).applyMatrix4(b.m);
      const d = Math.hypot(wp.x - x, wp.y - y, wp.z - z);
      if (d >= best) continue;
      const ix = b.geo.index ? b.geo.index.array : null, pa = b.geo.attributes.position, f = r.faceIndex * 3;
      A_.fromBufferAttribute(pa, ix ? ix[f] : f); B_.fromBufferAttribute(pa, ix ? ix[f + 1] : f + 1); C_.fromBufferAttribute(pa, ix ? ix[f + 2] : f + 2);
      nf.subVectors(C_, B_).cross(A_.clone().sub(B_)).normalize();
      // (le point, dans le repere de la piece : la normale du triangle y est)
      best = d; sgn = (lp.x - r.point.x) * nf.x + (lp.y - r.point.y) * nf.y + (lp.z - r.point.z) * nf.z >= 0 ? 1 : -1;
    }
    return best * sgn;
  };
  // gardee sur une grille (interpolee) : les poses voisines relisent les memes noeuds ; un tableau sur la zone ou la
  // piece peut aller (un dictionnaire prenait le tiers du temps), un dictionnaire au-dela
  const H = 0.4, cache = new Map();
  const mb = new THREE.Box3();
  for (const g of moving) { g.updateMatrix(); g.children.forEach(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); mb.union(m.geometry.boundingBox.clone().applyMatrix4(g.matrix)); } }); }
  const ext = reach + Math.max(...mb.getSize(new THREE.Vector3()).toArray()) * Math.sin(Math.min(Math.PI / 2, turn * Math.PI / 180)) / 2 + 1.5;
  const gi0 = Math.floor((mb.min.x - ext) / H), gj0 = Math.floor((mb.min.y - ext) / H), gk0 = Math.floor((mb.min.z - ext) / H);
  let gnx = Math.ceil((mb.max.x + ext) / H) - gi0 + 2, gny = Math.ceil((mb.max.y + ext) / H) - gj0 + 2, gnz = Math.ceil((mb.max.z + ext) / H) - gk0 + 2;
  const big = gnx * gny * gnz > 8e6;                           // trop grand : le dictionnaire seul
  const grid = big ? null : new Float32Array(gnx * gny * gnz).fill(NaN);
  const node = (i, j, k) => {
    const a = i - gi0, b2 = j - gj0, c = k - gk0;
    if (grid && a >= 0 && b2 >= 0 && c >= 0 && a < gnx && b2 < gny && c < gnz) {
      const q = (c * gny + b2) * gnx + a;
      let v = grid[q];
      if (v !== v) v = grid[q] = sdfAt(i * H, j * H, k * H);
      return v;
    }
    const key = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
    let e = cache.get(key);
    if (e === undefined || e[0] !== i || e[1] !== j || e[2] !== k) { e = [i, j, k, sdfAt(i * H, j * H, k * H)]; cache.set(key, e); }
    return e[3];
  };
  const sdf = (x, y, z) => {
    const gx = x / H, gy = y / H, gz = z / H, i = Math.floor(gx), j = Math.floor(gy), k = Math.floor(gz), fx = gx - i, fy = gy - j, fz = gz - k;
    const c00 = node(i, j, k) * (1 - fx) + node(i + 1, j, k) * fx, c10 = node(i, j + 1, k) * (1 - fx) + node(i + 1, j + 1, k) * fx;
    const c01 = node(i, j, k + 1) * (1 - fx) + node(i + 1, j, k + 1) * fx, c11 = node(i, j + 1, k + 1) * (1 - fx) + node(i + 1, j + 1, k + 1) * fx;
    return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  };
  // des points de la surface de la piece (au hasard, selon l'aire, toujours les memes), et leur normale
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const tris = [];
  let area = 0;
  for (const g of moving) {
    const geo = collider.geoOf(g);
    g.updateMatrix();
    const pa = geo.attributes.position, ix = geo.index ? geo.index.array : null, n = ix ? ix.length / 3 : pa.count / 3;
    for (let t = 0; t < n; t++) {
      if (t % 10000 === 0) await tk();
      const a = new THREE.Vector3().fromBufferAttribute(pa, ix ? ix[3 * t] : 3 * t).applyMatrix4(g.matrix);
      const b = new THREE.Vector3().fromBufferAttribute(pa, ix ? ix[3 * t + 1] : 3 * t + 1).applyMatrix4(g.matrix);
      const c = new THREE.Vector3().fromBufferAttribute(pa, ix ? ix[3 * t + 2] : 3 * t + 2).applyMatrix4(g.matrix);
      const cr = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)), ar = cr.length() / 2;
      if (ar < 1e-9) continue;
      area += ar;
      tris.push([a, b, c, cr.normalize(), area]);
    }
  }
  if (!tris.length) return null;
  const NP = 1500, pts = new Float64Array(NP * 3), und = [];
  for (let q = 0; q < NP; q++) {
    const u = rnd() * area;
    let lo = 0, hi = tris.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tris[m][4] < u) lo = m + 1; else hi = m; }
    const [a, b, c, n] = tris[lo], r1 = Math.sqrt(rnd()), r2 = rnd();
    for (let e = 0; e < 3; e++) { const ax = ["x", "y", "z"][e]; pts[3 * q + e] = (1 - r1) * a[ax] + r1 * (1 - r2) * b[ax] + r1 * r2 * c[ax]; }
    // la face d'appui : tournee vers le support
    if (n.dot(w) < -0.2) und.push(q);
  }
  if (und.length < 20) return null;
  // le pivot : le milieu de la face d'appui
  const piv = new THREE.Vector3();
  for (const q of und) piv.x += pts[3 * q], piv.y += pts[3 * q + 1], piv.z += pts[3 * q + 2];
  piv.divideScalar(und.length);
  const isU = new Uint8Array(NP);
  for (const q of und) isU[q] = 1;
  // une pose : rotation (vecteur axe x angle, radians) autour du pivot, puis glissement
  const R = new THREE.Matrix4(), q4 = new THREE.Quaternion(), ax3 = new THREE.Vector3();
  const matOf = x => {
    const th = Math.hypot(x[0], x[1], x[2]);
    if (th > 1e-12) q4.setFromAxisAngle(ax3.set(x[0] / th, x[1] / th, x[2] / th), th); else q4.identity();
    R.makeRotationFromQuaternion(q4);
    const M = new THREE.Matrix4().makeTranslation(piv.x + x[3], piv.y + x[4], piv.z + x[5]).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-piv.x, -piv.y, -piv.z));
    return M;
  };
  // l'energie d'une pose, sur un point sur « every »
  const E = (x, every = 1, sig = 0.3) => {
    const M = matOf(x).elements;
    let pen = 0, np = 0, con = 0, nu = 0;
    for (let q = 0; q < NP; q += every) {
      const px = pts[3 * q], py = pts[3 * q + 1], pz = pts[3 * q + 2];
      const s = sdf(M[0] * px + M[4] * py + M[8] * pz + M[12], M[1] * px + M[5] * py + M[9] * pz + M[13], M[2] * px + M[6] * py + M[10] * pz + M[14]);
      np++;
      if (s < -0.1) pen += -s - 0.1;
      if (isU[q]) { nu++; con += Math.exp(-((s / sig) ** 2)); }
    }
    return { e: 6 * pen / np - (nu ? con / nu : 0), pen: pen / np, cov: nu ? con / nu : 0 };
  };
  // (la grille d'abord remplie sous la piece, par paquets : sinon la premiere energie bloquait la page une demi-seconde)
  for (let q = 0; q < NP; q++) { if (q % 64 === 0) await tk(); sdf(pts[3 * q], pts[3 * q + 1], pts[3 * q + 2]); }
  const x0 = [0, 0, 0, 0, 0, 0];
  const e0 = E(x0);
  let x = x0.slice(), cur;
  // pas sur chaque axe, de plus en plus fins (rotation : 4° par mm de pas)
  const dirs = [];
  for (let d = 0; d < 6; d++) for (const sg of [1, -1]) { const v = [0, 0, 0, 0, 0, 0]; v[d] = sg; dirs.push(v); }
  const ok = y => Math.hypot(y[3], y[4], y[5]) <= reach && Math.hypot(y[0], y[1], y[2]) <= turn * Math.PI / 180;
  // (la cloche du contact large aux grands pas : la piece « sent » la surface de plus loin, puis se resserre ; et des
  // directions au hasard en plus des axes -- sur les seuls axes, une plaque partie de 6° de travers restait coincee)
  for (const [st, every, sig] of [[1.5, 3, 1.2], [1, 3, 0.8], [0.5, 2, 0.5], [0.25, 1, 0.3], [0.12, 1, 0.3], [0.06, 1, 0.3]]) {
    cur = E(x, every, sig).e;
    for (let it = 0; it < 40; it++) {
      await tk();
      let bx = null, be = cur;
      const rd = [];
      for (let r = 0; r < 12; r++) { const v = [0, 0, 0, 0, 0, 0].map(() => rnd() * 2 - 1), l = Math.hypot(...v) || 1; rd.push(v.map(a => a / l * 1.5)); }
      for (const v of dirs.concat(rd)) {
        await tk();
        const y = x.map((a, d) => a + v[d] * (d < 3 ? st * 4 * Math.PI / 180 : st));
        if (!ok(y)) continue;
        const e = E(y, every, sig).e;
        if (e < be - 1e-6) { be = e; bx = y; }
      }
      if (!bx) break;
      x = bx; cur = be;
    }
  }
  const e1 = E(x);
  // rien de mieux, ou encore a travers le support
  if (!(e1.e < e0.e - 0.02) || e1.pen > 0.05) return null;
  const M = matOf(x);
  if (collides && await collides(M)) return { blocked: 1 };
  const th = Math.hypot(x[0], x[1], x[2]) * 180 / Math.PI;
  return { M, kind: "fit3d", moved: Math.hypot(x[3], x[4], x[5]), turned: th, cov0: e0.cov, cov1: e1.cov, pen: e1.pen, e0: e0.e, e1: e1.e,
    contact: piv.clone().applyMatrix4(M), exact: true, sink: 0 };
}

// Caler (03/11/2026) : un seul geste a la place d'emboiter, aligner (et du choix entre eux). La piece collee :
//  1. s'emboite si elle trouve un logement (elle y descend d'au moins 0,3 mm : une reglette dans sa rainure, un tenon
//     dans son trou) ;
//  2. sinon s'aligne sur la face qui la porte (une plaque sur un dessus, un panneau sur un flanc), si ca rapporte ;
//  3. puis une passe fine : la meme recherche, a 0,2 mm pres et a 3° pres, autour de la place trouvee (la premiere
//     passe, a la maille de la zone, laissait une reglette de 140 mm decalee de 0,5 a 0,7 mm dans sa rainure).
//  0. (03/11/2026) d'abord, si elle traverse l'autre piece a sa place : dans son plan de collage (planeFree), glissee et
//     tournee jusqu'a la place libre la plus proche -- une glissiere posee a cheval sur la levre de son canal ;
//  (03/11/2026) avant tout, une piece au dessous a plusieurs pans (une plaque de carapace dans son logement pyramidal)
//     s'ajuste en 3D (fit3D) ; la suite habituelle seulement si ca n'apporte rien.
// Rend { M (depuis la place de depart), kind : "plane" | "nest" | "align" | "fit3d" | null, r (le resultat de l'etape
// retenue), fine }.
// moving : leurs matrices sont deplacees le temps de la passe fine, puis remises.
export async function snapPlace(o) {
  const { THREE, moving, collides = null } = o;
  // a plusieurs pans : la part (en aire) de ce qui regarde l'autre piece et s'ecarte de plus de 15° de la normale du
  // collage -- une plaque de carapace (dessous en pointe de diamant) ; une glissiere, une reglette, un couvercle ont un
  // dessous plat (leurs flancs, a 90°, ne regardent pas l'autre piece)
  const w = o.N.clone().normalize();
  let down = 0, tilt = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (const g of moving) {
    const geo = o.collider.geoOf(g), pa = geo.attributes.position, ix = geo.index ? geo.index.array : null, nt = ix ? ix.length / 3 : pa.count / 3;
    g.updateMatrix();
    const nm = new THREE.Matrix3().getNormalMatrix(g.matrix);
    for (let t = 0; t < nt; t++) {
      if (t % 20000 === 0 && o.tick) await o.tick();
      a.fromBufferAttribute(pa, ix ? ix[3 * t] : 3 * t); b.fromBufferAttribute(pa, ix ? ix[3 * t + 1] : 3 * t + 1); c.fromBufferAttribute(pa, ix ? ix[3 * t + 2] : 3 * t + 2);
      n.subVectors(b, a).cross(c.sub(a));
      const ar = n.length() / 2;
      if (ar < 1e-12) continue;
      n.applyMatrix3(nm).normalize();
      const d = -n.dot(w);
      if (d < 0.2) continue;
      down += ar;
      if (d < Math.cos(15 * Math.PI / 180)) tilt += ar;
    }
  }
  const facets = down > 0 && tilt / down >= 0.3 && o.lock !== 0 && !o.axis;
  // (03/11/2026) a plusieurs pans : ajuster en 3D d'abord (les etapes d'une seule direction l'emmenaient a 13 mm, dans
  // un autre logement) ; s'il n'apporte rien, la suite habituelle
  if (facets) {
    const f = await fit3D({ ...o, reach: o.reach === null || o.reach === undefined ? 6 : Math.min(6, o.reach) });
    if (f && f.M && f.cov1 >= 0.5 && f.pen < 0.03) return { M: f.M, kind: "fit3d", r: f, fine: null, nest: null };
    if (f && f.blocked) return { M: null, kind: null, r: { blocked: f.blocked }, nest: null };
  }
  return snapCore(o);
}

async function snapCore(o) {
  const { THREE, moving, P, N, collides = null, lock = null, axis = null, reach = null } = o;
  const pf = await planeFree(o);
  // (03/11/2026) seulement soulevee sur place (rien de libre a cote, a sa hauteur) : emboiter cherche d'abord un logement
  // autour -- une reglette enfoncee dans le dessus a 14 mm de sa rainure y va plutot que de remonter sur le dessus
  const liftPf = pf && pf.M && pf.sink < -0.3 && pf.moved < 0.5 ? pf : null;
  if (pf && pf.M && !liftPf) {
    // degagee : puis alignee de la, si ca rapporte sans rien traverser ni changer de plan (un panneau a tenons, dans ses
    // fentes, se met a fleur de la boite ; une glissiere en queue d'aronde, que les cartes de hauteur croient a travers
    // les levres, reste ou elle est)
    const saved = moving.map(g => { g.updateMatrix(); return [g, g.matrix.clone()]; });
    let al = null;
    try {
      for (const [g, m0] of saved) pf.M.clone().multiply(m0).decompose(g.position, g.quaternion, g.scale);
      const c2 = collides ? (M2 => collides(M2.clone().multiply(pf.M))) : null;
      al = await nestPlace({ ...o, P: pf.contact.clone(), mode: "align", collides: c2, lock: lock === 0 ? 0 : 15 * Math.PI / 180,
        reach: reach === null ? 15 : Math.min(15, reach) });
    } catch (e) {
      al = null;
    } finally {
      for (const [g, m0] of saved) { m0.decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }
    }
    if (al && al.M && (al.gain ?? 0) > 0.01 && al.cov1 >= 0.2 && (al.clash ?? 1) < 0.005 && Math.abs(al.sink ?? 0) < 0.05) {
      const M = al.M.clone().multiply(pf.M);
      return { M, kind: "plane", r: { ...pf, M, moved: pf.moved + (al.moved || 0), turned: pf.turned + (al.turned || 0), cov0: al.cov0, cov1: al.cov1 }, fine: null, nest: null, align: al };
    }
    return { M: pf.M, kind: "plane", r: pf, fine: null, nest: null };
  }
  // (03/11/2026) une place prisonniere plus bas (une glissiere posee sur son couvercle, au-dessus de son canal en queue
  // d'aronde) : emboiter ne la voit pas (au mieux, 0,6 mm dans les chanfreins des levres), aligner la promenait de 20 mm
  // sur le dessus. Seulement s'il y a des contre-depouilles (sinon, rien n'est cherche) ; trouvee, emboiter n'a plus
  // rien a dire (elle voit aussi les logements ordinaires)
  const dp = await planeFree({ ...o, deep: true });
  if (dp && dp.M && dp.sink >= 0.3) return { M: dp.M, kind: "nest", r: dp, fine: null, nest: null };
  const nest = await nestPlace({ ...o, mode: "nest", bounded: true });
  let kind = null, r = null, al;
  const alignOk = a => a && a.M && (a.gain ?? 0) > 0.01 && (a.cov1 >= 0.2 || a.cov1 - (a.cov0 || 0) >= 0.2);
  // un logement : la piece y descend, et la face collee l'entoure encore (pas un plot dont elle tombe)
  // (en collision, la profondeur se compte depuis la place hors collision : une reglette enfoncee dans le dessus a cote
  // de sa rainure y va ; mais si la place trouvee n'est pas plus basse que celle de depart -- des tenons qui traversaient
  // un mur --, l'alignement passe d'abord s'il la sort de la collision sans la soulever : il la met dans ses fentes, a fleur)
  if (nest && nest.M && nest.sink >= 0.3 && (nest.depth ?? nest.sink) >= 0.3 && (nest.surround ?? 1) >= 0.6) {
    if (nest.colliding && nest.drop < 0.3 && alignOk(al = await nestPlace({ ...o, mode: "align" })) && !((al.sink ?? 0) < -0.3)) { kind = "align"; r = al; }
    else { kind = "nest"; r = nest; }
  }
  else if (liftPf) return { M: liftPf.M, kind: "plane", r: liftPf, fine: null, nest };
  else if (nest && nest.engaged) return { M: null, kind: null, r: nest, nest, align: null };   // deja engagee : rien de mieux
  else {
    al = al || await nestPlace({ ...o, mode: "align" });
    // aligner : seulement s'il porte vraiment (au moins 20 %, ou 20 points de mieux ; 03/11/2026 : un couvercle decale de
    // 6 mm pour reposer a 16 % au lieu de 4 % sur le bord fin d'une boite)
    if (alignOk(al) && (nest?.colliding || !((al.sink ?? 0) < -0.5))) { kind = "align"; r = al; }
    // au moins descendre au contact, sur place ; en collision, en sortir
    else if (nest && nest.M && nest.moved < 0.05 && Math.abs(nest.turned) < 0.1 && (nest.sink >= 0.05 || (nest.colliding && nest.sink <= -0.05))) { kind = "nest"; r = nest; }
    // rien de mieux, mais en collision : au moins en sortir, juste au contact, sans la deplacer ni la tourner
    else if (nest && nest.colliding && nest.pen0 > 0.3) {
      const w = N.clone().normalize(), dz = nest.pen0;
      const M = new THREE.Matrix4().makeTranslation(w.x * dz, w.y * dz, w.z * dz);
      return { M, kind: "nest", r: { ...nest, M, sink: -dz, moved: 0, turned: 0, contact: P.clone().addScaledVector(w, dz) }, fine: null, nest };
    }
    // rien : sans face plane du tout (une face courbe), l'editeur fera epouser la surface ; sinon, elle reste
    else return { M: null, kind: null, r: al || nest, nest, align: al, noface: !al || !al.M || (al.cov0 || 0) < 0.02 && (al.cov1 || 0) < 0.05 };
  }
  // deja precise (la place « a la main », verifiee aux vrais rayons) : pas de passe fine (sur un couvercle de 140 mm,
  // elle prenait dix secondes pour ne rien changer)
  if (r.exact) return { M: r.M, kind, r, fine: null, nest };
  // la passe fine : la piece posee a la place trouvee, puis cherchee de pres
  const saved = moving.map(g => { g.updateMatrix(); return [g, g.matrix.clone()]; });
  let fine = null;
  try {
    for (const [g, m0] of saved) r.M.clone().multiply(m0).decompose(g.position, g.quaternion, g.scale);
    const P2 = r.contact ? r.contact.clone() : P.clone();
    const c2 = collides ? (M2 => collides(M2.clone().multiply(r.M))) : null;
    fine = await nestPlace({ ...o, P: P2, N, mode: kind, collides: c2, lock: lock === 0 ? 0 : 3 * Math.PI / 180,
      axis, reach: reach === null ? 3 : Math.min(3, reach), res: 0.2, center: true, erodeMm: 0.25, bounded: true });
  } catch (e) {
    fine = null;
  } finally {
    for (const [g, m0] of saved) { m0.decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }
  }
  // garder la passe fine si elle trouve (et ne recule pas : un emboitement reste au moins aussi bas)
  // (jamais vers le haut : ni un emboitement ni un alignement ne soulevent la piece hors de son plan)
  if (fine && fine.M && !(fine.sink < -0.05)) {
    const M = fine.M.clone().multiply(r.M);
    // les deux passes s'ajoutent : le chemin, le tour et la descente de l'ensemble (a peu de chose pres)
    return { M, kind, r: { ...r, M, contact: fine.contact || r.contact, cov1: fine.cov1 ?? r.cov1, moved: r.moved + (fine.moved || 0),
      turned: r.turned + (fine.turned || 0), sink: r.sink + (kind === "nest" ? fine.sink || 0 : 0) }, fine, nest, align: kind === "align" ? r : null };
  }
  return { M: r.M, kind, r, fine: null, nest };
}
