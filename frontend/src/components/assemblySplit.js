// Separer une piece de la vue assemblee en ses morceaux (29/10/2026), a la demande dans l'edition : les morceaux qui ne
// se touchent pas (sommets soudes a 0,001 mm pres), comme « Separer en objets » de Bambu Studio. Les miettes (moins de
// 0,3 % des triangles, et 30 au plus) restent au plus gros morceau. Les morceaux sont numerotes du plus gros au plus
// petit : le meme calcul redonne les memes numeros, ce qui permet de retrouver une separation enregistree
// (« objet:instance:partie:morceau »).

// les morceaux d'une piece : [{ parts: [[maillage d'origine, geometrie du morceau]] }], ou null (d'un seul tenant)
export function splitPieceGeometry(THREE, pg) {
  const meshes = pg.children.filter(m => m.isMesh && m.geometry?.attributes?.position);
  if (!meshes.length) return null;
  const weld = new Map(), ids = [], tris = [];       // tris : [maillage, numero du triangle, sommets soudes a, b, c]
  const vid = (x, y, z) => {
    const k = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
    let i = weld.get(k);
    if (i === undefined) { i = weld.size; weld.set(k, i); }
    return i;
  };
  meshes.forEach((m, mi) => {
    const p = m.geometry.attributes.position.array, ix = m.geometry.index?.array;
    const w = new Int32Array(p.length / 3);
    for (let i = 0; i < w.length; i++) w[i] = vid(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    ids.push(w);
    const n = ix ? ix.length / 3 : w.length / 3;
    for (let t = 0; t < n; t++) {
      const a = ix ? ix[t * 3] : t * 3, b = ix ? ix[t * 3 + 1] : t * 3 + 1, c = ix ? ix[t * 3 + 2] : t * 3 + 2;
      tris.push(mi, t, w[a], w[b], w[c]);
    }
  });
  // union des sommets par les triangles
  const up = new Int32Array(weld.size);
  for (let i = 0; i < up.length; i++) up[i] = i;
  const root = i => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  const join = (a, b) => { a = root(a); b = root(b); if (a !== b) up[Math.max(a, b)] = Math.min(a, b); };
  for (let t = 0; t < tris.length; t += 5) { join(tris[t + 2], tris[t + 3]); join(tris[t + 3], tris[t + 4]); }
  const count = new Map();
  for (let t = 0; t < tris.length; t += 5) { const r = root(tris[t + 2]); count.set(r, (count.get(r) || 0) + 1); }
  const total = tris.length / 5;
  const order = [...count.entries()].sort((a, b) => b[1] - a[1]);
  const big = order.filter(([, c]) => c >= Math.max(30, 0.003 * total));
  if (big.length < 2) return null;
  const rank = new Map(big.map(([r], i) => [r, i]));
  // les triangles de chaque morceau, par maillage d'origine
  const per = big.map(() => meshes.map(() => []));
  for (let t = 0; t < tris.length; t += 5) {
    const n = rank.has(root(tris[t + 2])) ? rank.get(root(tris[t + 2])) : 0;     // une miette : au plus gros morceau
    per[n][tris[t]].push(tris[t + 1]);
  }
  return per.map(byMesh => ({
    parts: byMesh.map((list, mi) => list.length ? [meshes[mi], subGeometry(THREE, meshes[mi].geometry, list)] : null).filter(Boolean),
  }));
}

// une partie d'une geometrie : ces triangles, ses sommets renumerotes (tous les attributs suivent)
function subGeometry(THREE, geo, triList) {
  const ix = geo.index?.array, map = new Map(), order = [], idx = new Uint32Array(triList.length * 3);
  let k = 0;
  for (const t of triList) {
    for (let e = 0; e < 3; e++) {
      const v = ix ? ix[t * 3 + e] : t * 3 + e;
      let j = map.get(v);
      if (j === undefined) { j = order.length; map.set(v, j); order.push(v); }
      idx[k++] = j;
    }
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const n = attr.itemSize, src = attr.array, arr = new src.constructor(order.length * n);
    order.forEach((v, j) => { for (let c = 0; c < n; c++) arr[j * n + c] = src[v * n + c]; });
    out.setAttribute(name, new THREE.BufferAttribute(arr, n, attr.normalized));
  }
  if (ix) out.setIndex(new THREE.BufferAttribute(idx, 1));
  else {
    // une geometrie sans index (finitions a texture) : on la garde sans index, triangles a plat
    const flat = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(out.attributes)) {
      const n = attr.itemSize, arr = new attr.array.constructor(idx.length * n);
      for (let i = 0; i < idx.length; i++) for (let c = 0; c < n; c++) arr[i * n + c] = attr.array[idx[i] * n + c];
      flat.setAttribute(name, new THREE.BufferAttribute(arr, n, attr.normalized));
    }
    return flat;
  }
  return out;
}

// les groupes three.js des morceaux d'une piece, a la place de la piece : chacun centre sur lui-meme (la poignee tourne
// autour de lui), avec sa cle, son nom, et son « c » (centre dans les coordonnees affichees de la vue) pour les places
// enregistrees. Les materiaux sont copies (la selection estompe chaque morceau a part), avec leurs effets.
export function buildSplitGroups(THREE, pg, comps) {
  pg.updateMatrix();
  return comps.map((comp, n) => {
    const g = new THREE.Group();
    const b = new THREE.Box3();
    comp.parts.forEach(([, geo]) => { geo.computeBoundingBox(); b.union(geo.boundingBox); });
    const cc = b.getCenter(new THREE.Vector3());
    for (const [m, geo] of comp.parts) {
      geo.translate(-cc.x, -cc.y, -cc.z); geo.computeBoundingSphere();
      const mat = m.material.clone();
      mat.onBeforeCompile = m.material.onBeforeCompile;
      mat.customProgramCacheKey = m.material.customProgramCacheKey;
      mat.userData = m.material.userData;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { ...m.userData };
      g.add(mesh);
    }
    const c0 = pg.userData.c || new THREE.Vector3();
    g.userData = { ...pg.userData, k: `${pg.userData.k}:${n}`, name: `${pg.userData.name} · ${n + 1}`, pid: `${pg.userData.pid}:${n}`,
      c: c0.clone().add(cc), from: pg.userData.k, parentC: c0.clone() };
    pg.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(cc.x, cc.y, cc.z)).decompose(g.position, g.quaternion, g.scale);
    g.updateMatrix();
    return g;
  });
}
