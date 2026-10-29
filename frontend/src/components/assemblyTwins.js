// Les faces jumelles (30/10/2026). Un modele decoupe pour l'impression a ses coupes en double : la face plane d'une piece
// et celle de la piece d'en face ont exactement le meme contour (trous des tenons compris). Touchee une face de la piece
// a coller, on cherche sur les autres pieces les faces planes de meme empreinte, puis la place exacte qui les superpose :
// les faces se regardent, leurs centres coincident, et l'angle autour du contact est celui ou les deux contours se
// recouvrent le mieux (avec les autres angles presque aussi bons : une face carree, ronde, symetrique).
//
// Chaque maillage est decoupe une fois en faces planes (triangles voisins de meme plan, a 3° pres), gardees au-dessus de
// 4 mm² ; la comparaison se fait sur deux grilles (les deux faces vues dans le plan du support), angle par angle.

const MIN_AREA = 4;                  // mm² : en dessous, ce n'est pas une face de coupe
const COS_PLANE = Math.cos(3 * Math.PI / 180);

export function createTwins(THREE, neighbours) {
  const cache = new WeakMap();       // geometrie -> { regions, of : Int32Array (triangle -> face, -1 : aucune) }

  // les faces planes d'un maillage (dans son repere)
  const segment = geo => {
    if (cache.has(geo)) return cache.get(geo);
    const pos = geo.attributes.position, ix = geo.index.array, n = ix.length / 3, nb = neighbours(geo);
    const N = new Float32Array(n * 3), C = new Float32Array(n * 3), A = new Float32Array(n);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e = new THREE.Vector3(), f = new THREE.Vector3();
    for (let t = 0; t < n; t++) {
      a.fromBufferAttribute(pos, ix[t * 3]); b.fromBufferAttribute(pos, ix[t * 3 + 1]); c.fromBufferAttribute(pos, ix[t * 3 + 2]);
      e.subVectors(b, a).cross(f.subVectors(c, a));
      const l = e.length();
      A[t] = l / 2;
      if (l > 0) e.divideScalar(l);
      N[t * 3] = e.x; N[t * 3 + 1] = e.y; N[t * 3 + 2] = e.z;
      C[t * 3] = (a.x + b.x + c.x) / 3; C[t * 3 + 1] = (a.y + b.y + c.y) / 3; C[t * 3 + 2] = (a.z + b.z + c.z) / 3;
    }
    const of = new Int32Array(n).fill(-1), seen = new Uint8Array(n), regions = [], stack = [];
    for (let t0 = 0; t0 < n; t0++) {
      if (seen[t0] || A[t0] <= 0) continue;
      const nx = N[t0 * 3], ny = N[t0 * 3 + 1], nz = N[t0 * 3 + 2], d0 = nx * C[t0 * 3] + ny * C[t0 * 3 + 1] + nz * C[t0 * 3 + 2];
      const tris = [t0];
      seen[t0] = 1; stack.length = 0; stack.push(t0);
      let area = 0;
      while (stack.length) {
        const t = stack.pop();
        area += A[t];
        for (let k = 0; k < 3; k++) {
          const u = nb[t * 3 + k];
          if (u < 0 || seen[u] || A[u] <= 0) continue;
          if (nx * N[u * 3] + ny * N[u * 3 + 1] + nz * N[u * 3 + 2] < COS_PLANE) continue;
          if (Math.abs(nx * C[u * 3] + ny * C[u * 3 + 1] + nz * C[u * 3 + 2] - d0) > 0.08) continue;   // le meme plan, pas une marche
          seen[u] = 1; stack.push(u); tris.push(u);
        }
      }
      if (area < MIN_AREA) continue;
      const id = regions.length;
      tris.forEach(t => { of[t] = id; });
      // centre, normale moyenne, et l'empreinte : surface, perimetre, etalement (les deux moments principaux)
      const cen = new THREE.Vector3(), nrm = new THREE.Vector3();
      for (const t of tris) { cen.x += C[t * 3] * A[t]; cen.y += C[t * 3 + 1] * A[t]; cen.z += C[t * 3 + 2] * A[t]; nrm.x += N[t * 3] * A[t]; nrm.y += N[t * 3 + 1] * A[t]; nrm.z += N[t * 3 + 2] * A[t]; }
      cen.divideScalar(area); nrm.normalize();
      const u = Math.abs(nrm.z) < 0.9 ? new THREE.Vector3(0, 0, 1).cross(nrm).normalize() : new THREE.Vector3(1, 0, 0).cross(nrm).normalize(), v = nrm.clone().cross(u);
      let sxx = 0, syy = 0, sxy = 0, per = 0;
      const set = new Set(tris);
      for (const t of tris) {
        const dx = C[t * 3] - cen.x, dy = C[t * 3 + 1] - cen.y, dz = C[t * 3 + 2] - cen.z, x = dx * u.x + dy * u.y + dz * u.z, y = dx * v.x + dy * v.y + dz * v.z;
        sxx += x * x * A[t]; syy += y * y * A[t]; sxy += x * y * A[t];
        for (let k = 0; k < 3; k++) {
          const w = nb[t * 3 + k];
          if (w >= 0 && set.has(w)) continue;
          a.fromBufferAttribute(pos, ix[t * 3 + k]); b.fromBufferAttribute(pos, ix[t * 3 + (k + 1) % 3]);
          per += a.distanceTo(b);
        }
      }
      const tr = (sxx + syy) / area, det = Math.max(0, (sxx / area) * (syy / area) - (sxy / area) ** 2), disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      regions.push({ id, tris: Int32Array.from(tris), area, per, c: cen, n: nrm, l1: Math.sqrt(tr / 2 + disc), l2: Math.sqrt(Math.max(0, tr / 2 - disc)) });
    }
    const out = { regions, of };
    cache.set(geo, out);
    return out;
  };

  // les triangles d'une face, dans le repere du support (M : maillage -> support)
  const trianglesOf = (geo, reg, M) => {
    const pos = geo.attributes.position, ix = geo.index.array, out = new Float32Array(reg.tris.length * 9), p = new THREE.Vector3();
    reg.tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { p.fromBufferAttribute(pos, ix[t * 3 + k]).applyMatrix4(M); out[i * 9 + k * 3] = p.x; out[i * 9 + k * 3 + 1] = p.y; out[i * 9 + k * 3 + 2] = p.z; } });
    return out;
  };

  // une face, posee dans le repere du support
  const placed = (geo, reg, M) => ({
    tri: trianglesOf(geo, reg, M), c: reg.c.clone().applyMatrix4(M), n: reg.n.clone().transformDirection(M).normalize(),
    area: reg.area * Math.abs(new THREE.Matrix3().setFromMatrix4(M).determinant()) ** (2 / 3), per: reg.per, l1: reg.l1, l2: reg.l2,
  });

  // la face B est-elle de meme empreinte que la face A ? (les tenons, une tolerance d'impression changent un peu la surface)
  const alike = (fa, fb) => {
    const r = (x, y) => Math.max(x, y) / Math.max(1e-6, Math.min(x, y));
    return r(fa.area, fb.area) < 1.3 && r(fa.per, fb.per) < 1.35 && r(fa.l1, fb.l1) < 1.3 && r(fa.l2 + 0.5, fb.l2 + 0.5) < 1.35;
  };

  // la grille d'une face (triangles en 2D) : les cases dont le centre tombe dans un triangle, et celle du centre de chaque
  // triangle (un triangle plus fin qu'une case n'en laisse pas de trou)
  const raster = (P, R, G) => {
    const h = 2 * R / G, grid = new Uint8Array(G * G);
    const cell = x => Math.floor((x + R) / h);
    for (let i = 0; i < P.length; i += 6) {
      const x0 = P[i], y0 = P[i + 1], x1 = P[i + 2], y1 = P[i + 3], x2 = P[i + 4], y2 = P[i + 5];
      const cx = cell((x0 + x1 + x2) / 3), cy = cell((y0 + y1 + y2) / 3);
      if (cx >= 0 && cy >= 0 && cx < G && cy < G) grid[cy * G + cx] = 1;
      const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(d) < 1e-12) continue;
      const ia = Math.max(0, cell(Math.min(x0, x1, x2))), ib = Math.min(G - 1, cell(Math.max(x0, x1, x2)));
      const ja = Math.max(0, cell(Math.min(y0, y1, y2))), jb = Math.min(G - 1, cell(Math.max(y0, y1, y2)));
      for (let j = ja; j <= jb; j++) {
        const y = -R + (j + 0.5) * h;
        for (let k = ia; k <= ib; k++) {
          const x = -R + (k + 0.5) * h;
          const s = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / d, t = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / d;
          if (s >= -1e-9 && t >= -1e-9 && s + t <= 1 + 1e-9) grid[j * G + k] = 1;
        }
      }
    }
    const pts = [];
    for (let j = 0; j < G; j++) for (let k = 0; k < G; k++) if (grid[j * G + k]) pts.push(-R + (k + 0.5) * h, -R + (j + 0.5) * h);
    return { grid, pts: Float32Array.from(pts), h };
  };

  // la place qui pose la face A sur la face B : les faces se regardent, centre sur centre, puis l'angle (et un petit
  // decalage) qui superposent le mieux les deux contours. Rend les meilleures positions, la meilleure d'abord :
  // [{ score (0 a 1 : la part de chaque face recouverte par l'autre, la plus petite des deux), M (support -> support) }]
  const fit = (fa, fb) => {
    const q0 = new THREE.Quaternion().setFromUnitVectors(fa.n, fb.n.clone().negate());
    const T0 = new THREE.Matrix4().makeTranslation(fb.c.x, fb.c.y, fb.c.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q0))
      .multiply(new THREE.Matrix4().makeTranslation(-fa.c.x, -fa.c.y, -fa.c.z));
    const nB = fb.n, u = Math.abs(nB.z) < 0.9 ? new THREE.Vector3(0, 0, 1).cross(nB).normalize() : new THREE.Vector3(1, 0, 0).cross(nB).normalize(), v = nB.clone().cross(u);
    const p = new THREE.Vector3();
    const flat = (tri, M) => {
      const out = new Float32Array(tri.length / 3 * 2);
      for (let i = 0, o = 0; i < tri.length; i += 3, o += 2) {
        p.set(tri[i], tri[i + 1], tri[i + 2]); if (M) p.applyMatrix4(M); p.sub(fb.c);
        out[o] = p.dot(u); out[o + 1] = p.dot(v);
      }
      return out;
    };
    const PA = flat(fa.tri, T0), PB = flat(fb.tri, null);
    let R = 0;
    for (const P of [PA, PB]) for (let i = 0; i < P.length; i++) R = Math.max(R, Math.abs(P[i]));
    R *= 1.2;                                          // de la marge pour tourner et decaler
    // deux grilles : une grossiere pour balayer les angles, une fine pour la place exacte et la note (une face de 3 cm y
    // fait une cinquantaine de cases de large)
    const coarseG = { a: raster(PA, R, 48), b: raster(PB, R, 48), G: 48 }, fineG = { a: raster(PA, R, 128), b: raster(PB, R, 128), G: 128 };
    if (!coarseG.a.pts.length || !coarseG.b.pts.length || !fineG.a.pts.length || !fineG.b.pts.length) return [];
    const h = fineG.a.h;
    // la part des cases de A (tournees de th, decalees de dx, dy) qui tombent dans B, et reciproquement
    const score = (th, dx, dy, L = fineG) => {
      const { a: ra, b: rb, G } = L, hh = ra.h;
      const inside = (grid, x, y) => { const k = Math.floor((x + R) / hh), j = Math.floor((y + R) / hh); return k >= 0 && j >= 0 && k < G && j < G && grid[j * G + k] === 1; };
      const cs = Math.cos(th), sn = Math.sin(th);
      let ha = 0, hb = 0;
      for (let i = 0; i < ra.pts.length; i += 2) { const x = ra.pts[i], y = ra.pts[i + 1]; if (inside(rb.grid, cs * x - sn * y + dx, sn * x + cs * y + dy)) ha++; }
      for (let i = 0; i < rb.pts.length; i += 2) { const x = rb.pts[i] - dx, y = rb.pts[i + 1] - dy; if (inside(ra.grid, cs * x + sn * y, -sn * x + cs * y)) hb++; }
      return Math.min(ha / (ra.pts.length / 2), hb / (rb.pts.length / 2));
    };
    // tous les 3° (grille grossiere), puis autour des meilleurs (grille fine) : au cinquieme de degre, et un petit decalage
    const steps = 120, coarse = Array.from({ length: steps }, (_, i) => score(i * 2 * Math.PI / steps, 0, 0, coarseG));
    const peaks = [];
    for (let i = 0; i < steps; i++) {
      const s = coarse[i];
      if (s >= 0.7 && s >= coarse[(i + steps - 1) % steps] && s >= coarse[(i + 1) % steps]) peaks.push(i);
    }
    peaks.sort((x, y) => coarse[y] - coarse[x]);
    const found = [];
    for (const i of peaks.slice(0, 4)) {
      const th0 = i * 2 * Math.PI / steps;
      let best = { s: score(th0, 0, 0), th: th0, dx: 0, dy: 0 };
      for (let k = 0; k < 2; k++) {
        const span = k ? 0.6 : 2, inc = k ? 0.2 : 0.5;
        for (let d = -span; d <= span; d += inc) {
          const th = best.th + d * Math.PI / 180;
          for (const [dx, dy] of k ? [[0, 0], [h / 2, 0], [-h / 2, 0], [0, h / 2], [0, -h / 2]] : [[0, 0], [h, 0], [-h, 0], [0, h], [0, -h]]) {
            const s = score(th, best.dx + dx, best.dy + dy);
            if (s > best.s + 1e-9) best = { s, th, dx: best.dx + dx, dy: best.dy + dy };
          }
        }
      }
      // deux pics qui tombent au meme angle : un seul
      const apart = f => Math.abs((((f.th - best.th) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      if (found.some(f => apart(f) < 4 * Math.PI / 180)) continue;
      found.push(best);
    }
    found.sort((x, y) => y.s - x.s);
    return found.map(f => {
      const shift = u.clone().multiplyScalar(f.dx).addScaledVector(v, f.dy);
      const M = new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z)
        .multiply(new THREE.Matrix4().makeTranslation(fb.c.x, fb.c.y, fb.c.z))
        .multiply(new THREE.Matrix4().makeRotationAxis(nB, f.th))
        .multiply(new THREE.Matrix4().makeTranslation(-fb.c.x, -fb.c.y, -fb.c.z))
        .multiply(T0);
      return { score: f.s, M };
    });
  };

  // les faces jumelles de la face touchee (mesh, tri) parmi les pieces donnees : [{ g, mesh, reg, face, fits }], la plus
  // ressemblante d'abord. matOf(g, mesh) : maillage -> support. Rend null si la face touchee n'est pas une face plane
  const search = async (from, others, matOf, onStep) => {
    const sa = segment(from.mesh.geometry), id = sa.of[from.tri];
    if (id < 0) return null;
    const fa = placed(from.mesh.geometry, sa.regions[id], matOf(from.g, from.mesh));
    const out = [];
    let k = 0;
    for (const g of others) {
      for (const mesh of g.children) {
        if (!mesh.isMesh || !mesh.geometry?.index) continue;
        const sb = segment(mesh.geometry);
        const M = matOf(g, mesh);
        for (const reg of sb.regions) {
          const fb = placed(mesh.geometry, reg, M);
          if (!alike(fa, fb)) continue;
          const fits = fit(fa, fb).filter(x => x.score >= 0.7);
          if (fits.length && fits[0].score >= 0.8) out.push({ g, mesh, reg, face: fb, fits });
        }
        if (++k % 2 === 0) { onStep?.(); await new Promise(r => setTimeout(r, 0)); }
      }
    }
    out.sort((x, y) => y.fits[0].score - x.fits[0].score);
    return { face: fa, twins: out };
  };

  return { segment, search, trianglesOf, regionOfTri: (geo, t) => { const s = segment(geo); return s.of[t] >= 0 ? s.regions[s.of[t]] : null; } };
}
