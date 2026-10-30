// Emboiter (30/10/2026) : une piece collee sur une autre glisse et tourne sur le contact jusqu'a la place ou elle
// descend le plus (un bloc dans son logement, un tenon dans son trou), sans rien traverser. Deux cartes de hauteur,
// dans le repere du contact (w : la normale, de la piece support vers la piece posee) :
//  - le dessus de la piece support, colonne par colonne (le premier point touche en descendant) ;
//  - le dessous de la piece posee (le premier point touche en montant).
// Pour une place (decalage dans le plan, angle autour de w), la piece descend jusqu'au premier contact : sa hauteur
// est le plus grand ecart « dessus du support - dessous de la piece » sous elle. On garde la place la plus basse
// (a peine penalisee par la distance parcourue : a egalite, la plus proche de la ou on l'a collee), toute la piece
// restant au-dessus du support. D'abord a grosses mailles (hauteurs regroupees, prudentes), puis finement autour des
// meilleures.

export async function nestPlace({ THREE, collider, moving, base, P, N }) {
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
  const size = Math.max(sa.hi[0] - sa.lo[0], sa.hi[1] - sa.lo[1], sb.hi[0] - sb.lo[0], sb.hi[1] - sb.lo[1]);
  const h = Math.max(0.25, size / 160);                      // la maille fine (mm)

  // la carte du dessus du support : H[j*nu+i] (NaN : rien dessous)
  const bu0 = sb.lo[0], bv0 = sb.lo[1], nu = Math.ceil((sb.hi[0] - bu0) / h) + 1, nv = Math.ceil((sb.hi[1] - bv0) / h) + 1;
  const H = new Float32Array(nu * nv).fill(NaN), top = sb.hi[2] + 1;
  dir.copy(w).negate();
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    o.copy(P).addScaledVector(u, bu0 + i * h).addScaledVector(v, bv0 + j * h).addScaledVector(w, top);
    const t = first(B, o, dir);
    if (t < Infinity) H[j * nu + i] = top - t;
  }
  // la carte du dessous de la piece posee : des cellules (du, dv, L) autour de son centre
  const cu = (sa.lo[0] + sa.hi[0]) / 2, cv = (sa.lo[1] + sa.hi[1]) / 2, bottom = sa.lo[2] - 1;
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

  // une place : la hauteur ou elle se pose. Les mailles de la piece hors du support ne comptent pas (une piece plus
  // large que ce qui la porte), mais elle doit rester au moins autant sur son support qu'a la place ou on l'a collee
  // (sinon elle « tomberait » a cote) : Infinity
  let minCov = 0.999;
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
  // a grosses mailles : le dessus garde le plus bas de chaque bloc, le dessous le plus haut (optimiste : un logement
  // juste a la taille de la piece reste visible ; la passe fine verifie ensuite)
  const K = 4, hc = h * K, nU = Math.ceil(nu / K), nV = Math.ceil(nv / K);
  const Hc = new Float32Array(nU * nV).fill(NaN);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const z = H[j * nu + i];
    if (Number.isNaN(z)) continue;
    const c = Math.floor(j / K) * nU + Math.floor(i / K);
    if (Number.isNaN(Hc[c]) || z < Hc[c]) Hc[c] = z;
  }
  // (les grosses cellules sont centrees sur des blocs de K fines : decalage d'une demi-maille)
  const off = (K - 1) / 2 * h;
  // le dessous en grosses mailles : chaque groupe de cellules au milieu de ses cellules (jamais plus large que la
  // piece : un logement juste a sa taille la recoit encore), a la hauteur de la plus haute
  const groupsC = new Map();
  for (let k = 0; k < cells.length; k += 3) {
    const key = `${Math.floor(cells[k] / hc)},${Math.floor(cells[k + 1] / hc)}`;
    let g = groupsC.get(key);
    if (!g) groupsC.set(key, g = [0, 0, 0, -Infinity]);
    g[0] += cells[k]; g[1] += cells[k + 1]; g[2]++; g[3] = Math.max(g[3], cells[k + 2]);
  }
  const cc = [];
  for (const g of groupsC.values()) cc.push(g[0] / g[2], g[1] / g[2], g[3]);
  const liftC = (th, su, sv) => lift(Hc, nU, nV, hc, cc, th, su - off, sv - off);
  // a peine penalisees : la distance parcourue, et l'angle (une piece symetrique ne tourne pas pour rien)
  const turn = th => { const g = ((th * 180 / Math.PI) % 360 + 360) % 360; return Math.min(g, 360 - g); };
  const cost = (d, su, sv, th = 0) => d + 0.02 * Math.hypot(su, sv) + 0.002 * turn(th);
  const tops = [];
  // les meilleures, et differentes (un meme creux vu de plusieurs mailles n'en compte qu'une)
  const all = [];
  const keep = c => all.push(c);
  // ce qui porte la piece a sa place de depart (un peu de marge)
  { const c0 = {}; minCov = 0; lift(H, nu, nv, h, cells, 0, 0, 0, c0); minCov = Math.max(0.05, Math.min(0.999, c0.v * 0.9)); }
  const ru0 = sb.lo[0] - cu, ru1 = sb.hi[0] - cu, rv0 = sb.lo[1] - cv, rv1 = sb.hi[1] - cv;
  for (let a = 0; a < 72; a++) {
    const th = a * Math.PI / 36;
    for (let sv = rv0; sv <= rv1; sv += hc) for (let su = ru0; su <= ru1; su += hc) {
      const d = liftC(th, su, sv);
      if (d < Infinity) keep({ th, su, sv, d, c: cost(d, su, sv, th) });
    }
  }
  all.sort((a, b) => a.c - b.c);
  for (const c of all) {
    if (tops.length >= 40) break;
    if (tops.some(t => Math.hypot(t.su - c.su, t.sv - c.sv) < 2 * hc && Math.abs(Math.sin((t.th - c.th) / 2)) < 0.09)) continue;
    tops.push(c);
  }
  const here = lift(H, nu, nv, h, cells, 0, 0, 0);
  if (!tops.length) return null;
  // finement autour des meilleures
  let best = null;
  tops.forEach(t => {
    for (let da = -3; da <= 3; da += 0.5) {
      const th = t.th + da * Math.PI / 180;
      for (let dv = -hc; dv <= hc + 1e-9; dv += h) for (let du = -hc; du <= hc + 1e-9; du += h) {
        const su = t.su + du, sv = t.sv + dv, d = lift(H, nu, nv, h, cells, th, su, sv);
        if (d === Infinity) continue;
        const c = cost(d, su, sv, th);
        if (!best || c < best.c) best = { th, su, sv, d, c };
      }
    }
  });
  if (!best) return null;
  // dans un logement plus grand que la piece : au milieu de ce qui va aussi bien (le meme creux, la meme hauteur), en
  // angle puis en position, deux fois (sinon elle restait de biais, collee a un bord)
  const ok = (th, su, sv) => lift(H, nu, nv, h, cells, th, su, sv) <= best.d + 0.05;
  const mid = (f, x0, step, lim) => {
    let a = 0, b = 0;
    while (a < lim && f(x0 - (a + 1) * step)) a++;
    while (b < lim && f(x0 + (b + 1) * step)) b++;
    return x0 + (b - a) / 2 * step;
  };
  for (let it = 0; it < 2; it++) {
    best.th = mid(t => ok(t, best.su, best.sv), best.th, Math.PI / 360, 120);
    best.su = mid(x => ok(best.th, x, best.sv), best.su, h, 400);
    best.sv = mid(y => ok(best.th, best.su, y), best.sv, h, 400);
  }
  best.d = lift(H, nu, nv, h, cells, best.th, best.su, best.sv);
  // rien a gagner (elle ne descend pas plus bas ailleurs) : elle reste ou elle est
  if (here !== Infinity && best.d > here - 0.05) return { M: new THREE.Matrix4(), sink: 0, moved: 0, turned: 0, contact: P.clone() };
  // la transformation (repere du support du modele) : tourner autour de la normale par le centre de la piece, puis
  // glisser et descendre (ou monter) jusqu'au contact
  const C = P.clone().addScaledVector(u, cu).addScaledVector(v, cv);
  const R = new THREE.Matrix4().makeTranslation(C.x, C.y, C.z).multiply(new THREE.Matrix4().makeRotationAxis(w, best.th))
    .multiply(new THREE.Matrix4().makeTranslation(-C.x, -C.y, -C.z));
  const sh = u.clone().multiplyScalar(best.su).addScaledVector(v, best.sv).addScaledVector(w, best.d);
  const M = new THREE.Matrix4().makeTranslation(sh.x, sh.y, sh.z).multiply(R);
  // le point de contact : sous le centre de la piece, sur le dessus du support
  const i = Math.round((cu + best.su - bu0) / h), j = Math.round((cv + best.sv - bv0) / h);
  const zc = (i >= 0 && j >= 0 && i < nu && j < nv && !Number.isNaN(H[j * nu + i])) ? H[j * nu + i] : best.d;
  const contact = P.clone().addScaledVector(u, cu + best.su).addScaledVector(v, cv + best.sv).addScaledVector(w, zc);
  return { M, sink: (here === Infinity ? 0 : here) - best.d, moved: Math.hypot(best.su, best.sv), turned: best.th * 180 / Math.PI, contact };
}
