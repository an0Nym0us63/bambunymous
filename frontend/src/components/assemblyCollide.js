// Les collisions entre pieces de la vue assemblee (29/10/2026), pour l'anti-collision : chaque piece a
// une copie allegee de son maillage (60 000 triangles au plus, sommets proches fusionnes) avec son arbre de recherche
// (three-mesh-bvh), faits a la premiere demande et gardes. Deux pieces se touchent si leurs triangles se croisent.
const MAX_TRIS = 250000;               // au-dela seulement, simplifie (30/10/2026 : simplifier 90 000 triangles prenait 6 s)

export async function createCollider(THREE) {
  const { MeshBVH } = await import("three-mesh-bvh");
  const cache = new WeakMap(), thin = new WeakMap();

  // le maillage d'une piece (ses morceaux de couleur reunis), dans son repere, allege au besoin ; erode : la surface
  // rentree de tant de mm le long des normales (une piece « amincie », pour une premiere recherche a grands pas)
  const geoOf = (piece, erode = 0) => {
    if (erode) {
      const m = thin.get(piece) || new Map();
      thin.set(piece, m);
      if (m.has(erode)) return m.get(erode);
      const full = geoOf(piece);
      // les sommets soudes d'abord (30/10/2026) : un maillage dont chaque face a ses propres coins ne rentrait que face
      // par face, ses aretes restaient en place et la piece « amincie » ne l'etait pas
      const src = full.attributes.position.array, six = full.index.array, key = new Map(), wp = [], remap = new Uint32Array(src.length / 3);
      for (let i = 0; i < src.length / 3; i++) {
        const k = `${Math.round(src[i * 3] * 1e4)},${Math.round(src[i * 3 + 1] * 1e4)},${Math.round(src[i * 3 + 2] * 1e4)}`;
        let j = key.get(k);
        if (j === undefined) { j = wp.length / 3; key.set(k, j); wp.push(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]); }
        remap[i] = j;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(wp), 3));
      geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(six, i => remap[i]), 1));
      // chaque sommet recule de sorte que chaque face qui le touche recule de « erode » (au sens des moindres carres sur
      // les normales de ses faces) : une moyenne des normales laissait les aretes d'une collerette mince en place
      const p = geo.attributes.position.array, ix = geo.index.array, nv = p.length / 3;
      const M = new Float64Array(nv * 9), cnt = new Uint16Array(nv);
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), nf = new THREE.Vector3();
      for (let t = 0; t < ix.length; t += 3) {
        A.fromArray(p, ix[t] * 3); B.fromArray(p, ix[t + 1] * 3); C.fromArray(p, ix[t + 2] * 3);
        nf.subVectors(C, B).cross(A.clone().sub(B)).normalize();
        if (!Number.isFinite(nf.x) || nf.lengthSq() < 0.5) continue;
        const n3 = [nf.x, nf.y, nf.z];
        for (const v of [ix[t], ix[t + 1], ix[t + 2]]) {
          // une meme normale (faces coplanaires autour du sommet) ne compte qu'une fois par sommet, a peu pres
          for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[v * 9 + r * 3 + c] += n3[r] * n3[c];
          cnt[v]++;
        }
      }
      const m3 = new THREE.Matrix3(), rhs = new THREE.Vector3(), d = new THREE.Vector3();
      const nsum = new Float64Array(nv * 3);
      for (let t = 0; t < ix.length; t += 3) {
        A.fromArray(p, ix[t] * 3); B.fromArray(p, ix[t + 1] * 3); C.fromArray(p, ix[t + 2] * 3);
        nf.subVectors(C, B).cross(A.clone().sub(B)).normalize();
        if (!Number.isFinite(nf.x) || nf.lengthSq() < 0.5) continue;
        for (const v of [ix[t], ix[t + 1], ix[t + 2]]) { nsum[v * 3] += nf.x; nsum[v * 3 + 1] += nf.y; nsum[v * 3 + 2] += nf.z; }
      }
      const out = new Float32Array(p.length);
      for (let v = 0; v < nv; v++) {
        const k = cnt[v] || 1, e = v * 9, lam = 1e-3 * k;
        // (Σ n nᵀ + λI) d = e Σ n
        m3.set(M[e] + lam, M[e + 1], M[e + 2], M[e + 3], M[e + 4] + lam, M[e + 5], M[e + 6], M[e + 7], M[e + 8] + lam);
        rhs.set(nsum[v * 3], nsum[v * 3 + 1], nsum[v * 3 + 2]).multiplyScalar(erode);
        if (m3.determinant() === 0) d.set(0, 0, 0); else d.copy(rhs).applyMatrix3(m3.invert());
        if (d.length() > 3 * Math.abs(erode)) d.setLength(3 * Math.abs(erode));     // (negatif : la piece gonflee)
        out[v * 3] = p[v * 3] - d.x; out[v * 3 + 1] = p[v * 3 + 1] - d.y; out[v * 3 + 2] = p[v * 3 + 2] - d.z;
      }
      geo.setAttribute("position", new THREE.BufferAttribute(out, 3));
      geo.boundsTree = new MeshBVH(geo);
      geo.computeBoundingBox();
      m.set(erode, geo);
      return geo;
    }
    if (cache.has(piece)) return cache.get(piece);
    // les morceaux reunis, en tableaux types d'un coup (sans pousser un a un)
    const ms = piece.children.filter(m => m.isMesh && m.geometry?.attributes?.position);
    let nv = 0, ni = 0;
    for (const m of ms) { nv += m.geometry.attributes.position.array.length; ni += m.geometry.index ? m.geometry.index.array.length : m.geometry.attributes.position.array.length / 3; }
    let P = new Float32Array(nv), I = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const m of ms) {
      const p = m.geometry.attributes.position.array, ix = m.geometry.index ? m.geometry.index.array : null, base = vo / 3;
      P.set(p, vo);
      if (ix) for (let i = 0; i < ix.length; i++) I[io + i] = ix[i] + base;
      else for (let i = 0; i < p.length / 3; i++) I[io + i] = i + base;
      vo += p.length; io += ix ? ix.length : p.length / 3;
    }
    if (I.length / 3 > MAX_TRIS) [P, I] = simplify(P, I, MAX_TRIS);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.boundsTree = new MeshBVH(geo);
    geo.computeBoundingBox();
    cache.set(piece, geo);
    return geo;
  };

  // fusion des sommets sur une grille, de plus en plus large jusqu'a passer sous le nombre vise
  const simplify = (P, I, target) => {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
    const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    let cell = diag / 2000, outP = P, outI = I;
    for (let it = 0; it < 12; it++) {
      const map = new Map(), np = [], remap = new Uint32Array(P.length / 3);
      for (let i = 0; i < P.length / 3; i++) {
        const key = `${Math.floor((P[i * 3] - lo[0]) / cell)},${Math.floor((P[i * 3 + 1] - lo[1]) / cell)},${Math.floor((P[i * 3 + 2] - lo[2]) / cell)}`;
        let j = map.get(key);
        if (j === undefined) { j = np.length / 3; map.set(key, j); np.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); }
        remap[i] = j;
      }
      const ni = [];
      for (let t = 0; t < I.length; t += 3) {
        const a = remap[I[t]], b = remap[I[t + 1]], c = remap[I[t + 2]];
        if (a !== b && b !== c && a !== c) ni.push(a, b, c);
      }
      outP = Float32Array.from(np); outI = Uint32Array.from(ni);
      if (ni.length / 3 <= target) break;
      cell *= 1.5;
    }
    return [outP, outI];
  };

  const inv = new THREE.Matrix4(), rel = new THREE.Matrix4(), boxA = new THREE.Box3(), boxB = new THREE.Box3();
  // la piece a (a la place mA, repere du support) touche-t-elle la piece b (a sa place) ?
  const touches = (a, mA, b, erode = 0) => {
    const ga = geoOf(a, erode), gb = geoOf(b);
    b.updateMatrix();
    boxA.copy(ga.boundingBox).applyMatrix4(mA);
    boxB.copy(gb.boundingBox).applyMatrix4(b.matrix);
    if (!boxA.intersectsBox(boxB)) return false;
    rel.copy(inv.copy(b.matrix).invert()).multiply(mA);
    return gb.boundsTree.intersectsGeometry(ga, rel);
  };
  // des pieces deplacees ([piece, matrice]) touchent-elles une des autres ?
  const anyTouch = (moving, others, erode = 0) => moving.some(([a, m]) => others.some(b => b.visible && touches(a, m, b, erode)));
  return { geoOf, touches, anyTouch };
}
