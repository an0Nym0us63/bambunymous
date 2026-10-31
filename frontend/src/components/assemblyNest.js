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
export async function nestPlace({ THREE, collider, moving, base, P, N, mode = "nest", collides = null, lock = null, axis = null, reach = null }) {
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
  const W = Math.max(8, half);                                                // jusqu'ou elle peut glisser
  // la zone du support regardee : la piece et sa marge
  const zlo = [Math.max(sb.lo[0], cu - half - W), Math.max(sb.lo[1], cv - half - W)];
  const zhi = [Math.min(sb.hi[0], cu + half + W), Math.min(sb.hi[1], cv + half + W)];
  if (zhi[0] <= zlo[0] || zhi[1] <= zlo[1]) return null;
  const h = Math.max(0.25, Math.max(zhi[0] - zlo[0], zhi[1] - zlo[1]) / 140);   // la maille fine (mm)

  // la carte du dessus du support : H[j*nu+i] (NaN : rien dessous)
  const bu0 = zlo[0], bv0 = zlo[1], nu = Math.ceil((zhi[0] - bu0) / h) + 1, nv = Math.ceil((zhi[1] - bv0) / h) + 1;
  const H = new Float32Array(nu * nv).fill(NaN), top = sb.hi[2] + 1;
  dir.copy(w).negate();
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    o.copy(P).addScaledVector(u, bu0 + i * h).addScaledVector(v, bv0 + j * h).addScaledVector(w, top);
    const t = first(B, o, dir);
    if (t < Infinity) H[j * nu + i] = top - t;
  }
  // la carte du dessous de la piece posee : des cellules (du, dv, L) autour de son centre
  const bottom = sa.lo[2] - 1;
  const mu = Math.floor((sa.hi[0] - sa.lo[0]) / h) + 1, mv = Math.floor((sa.hi[1] - sa.lo[1]) / h) + 1;
  const La = new Float32Array(mu * mv).fill(NaN);
  dir.copy(w);
  for (let j = 0; j < mv; j++) for (let i = 0; i < mu; i++) {
    o.copy(P).addScaledVector(u, sa.lo[0] + i * h).addScaledVector(v, sa.lo[1] + j * h).addScaledVector(w, bottom);
    const t = first(A, o, dir);
    if (t < Infinity) La[j * mu + i] = bottom + t;
  }
  // le bord du dessous rogne d'une maille : le jeu d'impression (une piece faite pour entrer juste n'y entrait pas, les
  // mailles du bord tombant sur la paroi)
  const at = (i, j) => (i < 0 || j < 0 || i >= mu || j >= mv ? NaN : La[j * mu + i]);
  const pick = erode => {
    const out = [];
    for (let j = 0; j < mv; j++) for (let i = 0; i < mu; i++) {
      const z = at(i, j);
      if (Number.isNaN(z)) continue;
      if (erode && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => Number.isNaN(at(i + a, j + b)))) continue;
      out.push(sa.lo[0] + i * h - cu, sa.lo[1] + j * h - cv, z);
    }
    return out;
  };
  let cells = pick(true);
  if (cells.length < 12) cells = pick(false);
  if (!cells.length) return null;

  // aligner : la face d'appui de la piece (le plus bas de son dessous, a 0,6 mm pres) et celle qui la porte (le dessus
  // du support a la hauteur du contact, a 0,6 mm pres : une face a grain ou a relief en est encore)
  // (30/10/2026) la face d'appui est la face collee : la nappe du dessous, d'un seul tenant, a la hauteur du dessous au
  // point de collage -- avant, le plus bas du dessous : sur un panneau a tenons, les tenons seuls, et il partait de cote
  const TOL = 0.6;
  let foot = cells, lvl = 0;
  if (mode === "align") {
    let i0 = Math.round(-sa.lo[0] / h), j0 = Math.round(-sa.lo[1] / h), s = -1, bd = Infinity;
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
      foot.push(sa.lo[0] + i * h - cu, sa.lo[1] + j * h - cv, La[k]);
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
    if (start >= 0) {
      const st = [start]; face[start] = 1;
      while (st.length) {
        const k = st.pop(), i = k % nu, j = (k - i) / nu;
        faceN++;
        // une fente, une rainure etroite (5 mm au plus) ne coupe pas la face (30/10/2026 : le cote d'une boite a
        // fentes ne comptait que son morceau sous le point de collage, le panneau se calait de travers)
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (let r = 1; r <= gap; r++) {
            const x = i + a * r, y = j + b * r, q = y * nu + x;
            if (x < 0 || y < 0 || x >= nu || y >= nv) break;
            if (face[q]) break;
            if (ok(q)) { face[q] = 1; st.push(q); break; }
          }
        }
      }
    }
  }

  // une place : la hauteur ou elle se pose (Infinity : hors du support). Les mailles de la piece hors du support ne
  // comptent pas (une piece plus large que ce qui la porte), mais elle doit rester au moins autant sur son support qu'a
  // la place ou on l'a collee (sinon elle « tomberait » a cote)
  let minCov = 0;
  const lift = (Hm, nU, nV, hh, cl, th, su, sv, cov = null) => {
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
    return on && on >= minCov * n ? d : Infinity;
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
  const cc = coarse(cells), fc = coarse(foot);
  // ce qui porte la piece a sa place de depart (un peu de marge)
  if (mode !== "align") { const c0 = {}; lift(H, nu, nv, h, cells, 0, 0, 0, c0); minCov = Math.max(0.05, Math.min(0.999, c0.v * 0.9)); }
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
      return -10 * o + 12 * x + 2 * xp + 0.05 * Math.hypot(su, sv) + 0.004 * turn(th);
    }
    const d = lift(Hm, nU_, nV_, hh, cl, th, su - s0, sv - s0);
    if (d === Infinity) return Infinity;
    return d + pen(su, sv, th);
  };
  // le pas de la recherche grossiere : a la mesure de la piece (une trentaine de pas de chaque cote au plus), tous les 10°
  const ss = Math.max(hc, W / 14), fs = Math.max(2 * h, ss / 5);      // et celui de la passe fine autour
  const all = [];
  const R = reach !== null ? Math.min(W, reach) : W;
  const angs = lock === null ? Array.from({ length: 36 }, (_, a) => a * Math.PI / 18)
    : Array.from({ length: 2 * Math.floor(lock / (Math.PI / 18)) + 1 }, (_, a) => (a - Math.floor(lock / (Math.PI / 18))) * Math.PI / 18);
  for (const th of angs) {
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
      const th = t.th + da * Math.PI / 180;
      for (let dv = -ss; dv <= ss + 1e-9; dv += fs) for (let du = -ss; du <= ss + 1e-9; du += fs) {
        const su = t.su + du, sv = t.sv + dv, c = score(1, th, su, sv);
        if (c < Infinity && (!b || c < b.c)) b = { th, su, sv, c };
      }
    }
    if (b) fines.push(fix(b));
  }
  if (!fines.length) return null;
  fines.sort((a, b) => a.c - b.c);
  const here = mode === "align" ? Infinity : lift(H, nu, nv, h, cells, 0, 0, 0);
  // la hauteur d'une place : aligner pose la face collee sur la face qui porte ; emboiter descend jusqu'au contact
  const dOf = b => (mode === "align" ? fLev - lvl : lift(H, nu, nv, h, cells, b.th, b.su, b.sv));
  const mid = (f, x0, step, lim) => {
    let a = 0, b = 0;
    while (a < lim && f(x0 - (a + 1) * step)) a++;
    while (b < lim && f(x0 + (b + 1) * step)) b++;
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
  for (const f of fines.slice(0, 12)) {
    let b = { ...f, c: score(2, f.th, f.su, f.sv) };
    if (b.c === Infinity) b.c = 1e9;
    // a la maille et au demi-degre pres autour d'elle
    for (let it = 0; it < 3; it++) {
      const b0 = { ...b }, r = it ? 2 * h : fs;
      for (let da = -1.5; da <= 1.5; da += 0.5) for (let dv = -r; dv <= r + 1e-9; dv += r / 2) for (let du = -r; du <= r + 1e-9; du += r / 2) {
        const th = b0.th + da * Math.PI / 180, su = b0.su + du, sv = b0.sv + dv, c = score(2, th, su, sv);
        if (c < b.c) b = { th, su, sv, c };
      }
    }
    // au milieu de ce qui va aussi bien (un logement ou une face plus grands que la piece), en angle puis en position,
    // deux fois (sinon elle restait de biais, collee a un bord) ; la note sans la penalite de chemin
    const raw = (th, su, sv) => { const c = score(2, th, su, sv); return c === Infinity ? Infinity : c - (mode === "align" ? 0.05 * Math.hypot(su, sv) + 0.004 * turn(th) : pen(su, sv, th)); };
    const ref = raw(b.th, b.su, b.sv), okp = (th, su, sv) => raw(th, su, sv) <= ref + 0.05;
    const c0 = { ...b };
    for (let it = 0; it < 2; it++) {
      b.th = mid(t => okp(t, b.su, b.sv), b.th, Math.PI / 360, 120);
      b.su = mid(x => okp(b.th, x, b.sv), b.su, h, 400);
      b.sv = mid(y => okp(b.th, b.su, y), b.sv, h, 400);
    }
    b = fix(b);
    if (mode === "nest" && here !== Infinity && lift(H, nu, nv, h, cells, b.th, b.su, b.sv) > here - 0.05) break;     // plus rien a gagner
    let found = null;
    for (const cand of [b, fix(c0)]) {
      const d = dOf(cand);
      if (d === Infinity) continue;
      if (collides && await collides(matOf(cand, d))) { blocked++; continue; }
      found = cand; break;
    }
    if (found) { best = found; break; }
  }
  if (!best) return blocked ? { blocked } : (mode === "nest" ? { M: new THREE.Matrix4(), sink: 0, moved: 0, turned: 0, contact: P.clone() } : null);
  const d = dOf(best);
  if (mode === "nest" && here !== Infinity && d > here - 0.05) return { M: new THREE.Matrix4(), sink: 0, moved: 0, turned: 0, contact: P.clone() };
  const cov0 = mode === "align" ? iou(face, nu, nv, h, foot, 0, 0, 0) : 0, cov1 = mode === "align" ? iou(face, nu, nv, h, foot, best.th, best.su, best.sv) : 0;
  const clash1 = mode === "align" ? clash(H, nu, nv, h, cells, best.th, best.su, best.sv)[0] : 0;
  const M = matOf(best, d);
  // le point de contact : sous le centre de la piece, sur le dessus du support
  const i = Math.round((cu + best.su - bu0) / h), j = Math.round((cv + best.sv - bv0) / h);
  const zc = (i >= 0 && j >= 0 && i < nu && j < nv && !Number.isNaN(H[j * nu + i])) ? H[j * nu + i] : d;
  const contact = P.clone().addScaledVector(u, cu + best.su).addScaledVector(v, cv + best.sv).addScaledVector(w, zc);
  const tr = best.th * 180 / Math.PI;
  return { M, sink: (here === Infinity ? 0 : here) - d, moved: Math.hypot(best.su, best.sv), turned: ((tr + 540) % 360) - 180, contact, cov0, cov1, clash: clash1, blocked };
}
