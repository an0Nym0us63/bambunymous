// Emboiter et aligner (30/10/2026) : une piece collee sur une autre glisse et tourne sur le contact. Deux cartes de
// hauteur, dans le repere du contact (w : la normale, de la piece support vers la piece posee) :
//  - le dessus de la piece support, colonne par colonne (le premier point touche en descendant) ;
//  - le dessous de la piece posee (le premier point touche en montant).
// « nest » (emboiter) : la place ou la piece descend le plus (un bloc dans son logement, un tenon dans son trou), sans
// rien traverser : pour une place (decalage dans le plan, angle autour de w), elle descend jusqu'au premier contact, sa
// hauteur est le plus grand ecart « dessus du support - dessous de la piece » sous elle.
// « align » (aligner) : la place ou la face d'appui de la piece deborde le moins de la face qui la porte (une plaque
// sur le flanc d'un obelisque), puis centree.
// Dans les deux cas : a egalite, au milieu de ce qui va aussi bien (en angle et en position), et a peine penalise par
// le chemin parcouru. La recherche se fait autour de la place ou on l'a collee (la piece et une marge a sa mesure :
// sur un grand support, tout parcourir prenait plusieurs secondes), d'abord a grosses mailles, puis finement autour
// des meilleures.

export async function nestPlace({ THREE, collider, moving, base, P, N, mode = "nest", collides = null }) {
  const { MeshBVH } = await import("three-mesh-bvh");
  const w = N.clone().normalize();
  const u = (Math.abs(w.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).cross(w).normalize();
  const v = w.clone().cross(u);
  const fr = p => { const d = p.clone().sub(P); return [d.dot(u), d.dot(v), d.dot(w)]; };

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
  const TOL = 0.6;
  let foot = cells;
  if (mode === "align") {
    let lmin = Infinity;
    for (let k = 2; k < cells.length; k += 3) lmin = Math.min(lmin, cells[k]);
    foot = [];
    for (let k = 0; k < cells.length; k += 3) if (cells[k + 2] <= lmin + TOL) foot.push(cells[k], cells[k + 1], cells[k + 2]);
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
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = i + a, y = j + b, q = y * nu + x;
          if (x >= 0 && y >= 0 && x < nu && y < nv && !face[q] && ok(q)) { face[q] = 1; st.push(q); }
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
  const coarse = list => {
    const gs = new Map();
    for (let k = 0; k < list.length; k += 3) {
      const key = `${Math.floor(list[k] / hc)},${Math.floor(list[k + 1] / hc)}`;
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
  { const c0 = {}; lift(H, nu, nv, h, cells, 0, 0, 0, c0); minCov = Math.max(0.05, Math.min(0.999, c0.v * 0.9)); }
  // la note d'une place (plus basse : mieux), grossiere ou fine ; Infinity : impossible
  const turn = th => { const g = ((th * 180 / Math.PI) % 360 + 360) % 360; return Math.min(g, 360 - g); };
  const pen = (su, sv, th) => 0.02 * Math.hypot(su, sv) + 0.002 * turn(th);
  const score = (fine, th, su, sv) => {
    const [Hm, nU_, nV_, hh, cl, fl, F, s0] = fine ? [H, nu, nv, h, cells, foot, face, 0] : [Hc, nU, nV, hc, cc, fc, Fc, off];
    const d = lift(Hm, nU_, nV_, hh, cl, th, su - s0, sv - s0);
    if (d === Infinity) return Infinity;
    if (mode === "align") {
      if (d > TOL) return Infinity;                     // quelque chose depasse de la face : elle ne s'y pose pas a plat
      // la forme : la part commune de la face d'appui et de la face qui porte (sur leur reunion) ; une face plus grande
      // que la piece laisse encore la place de centrer
      const on = onFace(F, nU_, nV_, hh, fl, th, su - s0, sv - s0), nf = fl.length / 3;
      const faceCells = fine ? faceN : faceN / (K * K), inter = on * nf;
      // tourner ou glisser doit rapporter : 1° coute quatre dix-milliemes de recouvrement, 1 mm un demi-centieme (sinon un bec
      // presque bien pose faisait un quart de tour pour quelques mailles de mieux)
      return -10 * inter / Math.max(1, nf + faceCells - inter) + 0.05 * Math.hypot(su, sv) + 0.004 * turn(th);
    }
    return d + pen(su, sv, th);
  };
  const all = [];
  for (let a = 0; a < 72; a++) {
    const th = a * Math.PI / 36;
    for (let sv = -W; sv <= W + 1e-9; sv += hc) for (let su = -W; su <= W + 1e-9; su += hc) {
      const c = score(false, th, su, sv);
      if (c < Infinity) all.push({ th, su, sv, c });
    }
  }
  if (!all.length) return null;
  all.sort((a, b) => a.c - b.c);
  // les meilleures, et differentes (un meme creux vu de plusieurs mailles n'en compte qu'une)
  const tops = [];
  for (const c of all) {
    if (tops.length >= 24) break;
    if (tops.some(t => Math.hypot(t.su - c.su, t.sv - c.sv) < 2 * hc && Math.abs(Math.sin((t.th - c.th) / 2)) < 0.09)) continue;
    tops.push(c);
  }
  // finement autour de chacune des meilleures : la meilleure place de chaque creux
  const fines = [];
  for (const t of tops) {
    let b = null;
    for (let da = -3; da <= 3; da += 1) {
      const th = t.th + da * Math.PI / 180;
      for (let dv = -hc; dv <= hc + 1e-9; dv += h * 2) for (let du = -hc; du <= hc + 1e-9; du += h * 2) {
        const su = t.su + du, sv = t.sv + dv, c = score(true, th, su, sv);
        if (c < Infinity && (!b || c < b.c)) b = { th, su, sv, c };
      }
    }
    if (b) fines.push(b);
  }
  if (!fines.length) return null;
  fines.sort((a, b) => a.c - b.c);
  const here = lift(H, nu, nv, h, cells, 0, 0, 0);
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
    let b = { ...f };
    // a la maille et au demi-degre pres autour d'elle
    for (let it = 0; it < 2; it++) {
      const b0 = { ...b };
      for (let da = -1.5; da <= 1.5; da += 0.5) for (let dv = -2 * h; dv <= 2 * h + 1e-9; dv += h) for (let du = -2 * h; du <= 2 * h + 1e-9; du += h) {
        const th = b0.th + da * Math.PI / 180, su = b0.su + du, sv = b0.sv + dv, c = score(true, th, su, sv);
        if (c < b.c) b = { th, su, sv, c };
      }
    }
    // au milieu de ce qui va aussi bien (un logement ou une face plus grands que la piece), en angle puis en position,
    // deux fois (sinon elle restait de biais, collee a un bord) ; la note sans la penalite de chemin
    const raw = (th, su, sv) => { const c = score(true, th, su, sv); return c === Infinity ? Infinity : c - (mode === "align" ? 0.05 * Math.hypot(su, sv) + 0.004 * turn(th) : pen(su, sv, th)); };
    const ref = raw(b.th, b.su, b.sv), okp = (th, su, sv) => raw(th, su, sv) <= ref + 0.05;
    const c0 = { ...b };
    for (let it = 0; it < 2; it++) {
      b.th = mid(t => okp(t, b.su, b.sv), b.th, Math.PI / 360, 120);
      b.su = mid(x => okp(b.th, x, b.sv), b.su, h, 400);
      b.sv = mid(y => okp(b.th, b.su, y), b.sv, h, 400);
    }
    if (mode === "nest" && here !== Infinity && lift(H, nu, nv, h, cells, b.th, b.su, b.sv) > here - 0.05) break;     // plus rien a gagner
    let found = null;
    for (const cand of [b, c0]) {
      const d = lift(H, nu, nv, h, cells, cand.th, cand.su, cand.sv);
      if (d === Infinity) continue;
      if (collides && await collides(matOf(cand, d))) { blocked++; continue; }
      found = cand; break;
    }
    if (found) { best = found; break; }
  }
  if (!best) return blocked ? { blocked } : (mode === "nest" ? { M: new THREE.Matrix4(), sink: 0, moved: 0, turned: 0, contact: P.clone() } : null);
  const d = lift(H, nu, nv, h, cells, best.th, best.su, best.sv);
  if (mode === "nest" && here !== Infinity && d > here - 0.05) return { M: new THREE.Matrix4(), sink: 0, moved: 0, turned: 0, contact: P.clone() };
  const cov0 = mode === "align" ? onFace(face, nu, nv, h, foot, 0, 0, 0) : 0, cov1 = mode === "align" ? onFace(face, nu, nv, h, foot, best.th, best.su, best.sv) : 0;
  const M = matOf(best, d);
  // le point de contact : sous le centre de la piece, sur le dessus du support
  const i = Math.round((cu + best.su - bu0) / h), j = Math.round((cv + best.sv - bv0) / h);
  const zc = (i >= 0 && j >= 0 && i < nu && j < nv && !Number.isNaN(H[j * nu + i])) ? H[j * nu + i] : d;
  const contact = P.clone().addScaledVector(u, cu + best.su).addScaledVector(v, cv + best.sv).addScaledVector(w, zc);
  const tr = best.th * 180 / Math.PI;
  return { M, sink: (here === Infinity ? 0 : here) - d, moved: Math.hypot(best.su, best.sv), turned: ((tr + 540) % 360) - 180, contact, cov0, cov1, blocked };
}
