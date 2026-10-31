// Les couleurs de la vue assemblee (31/10/2026) : une piece entiere d'une autre couleur (« colors » : {cle : RRGGBB}),
// et des zones peintes (« paints » : [{k, own, tris, c}] -- la piece d'origine, la couleur d'origine du maillage, ses
// triangles tels que lus dans le fichier du plateau, la couleur posee ; la derniere posee l'emporte).
// Une piece separee, coupee ou copiee garde la numerotation de son maillage d'origine : chaque maillage sait d'ou
// viennent ses triangles (userData.src : le maillage du parent et ses triangles), la peinture s'y retrouve. Un
// triangle peint n'est pas retire de son maillage (sa numerotation bougerait) : il y est aplati (ses trois sommets
// confondus, il ne se voit plus) et repris dans un maillage de la couleur posee, rangé avec la piece.

// une zone s'enregistre en plages de triangles qui se suivent (« r » : debut, nombre, debut, nombre…) : un pantalon de
// 124 000 triangles tient en 5 000 plages
export const toRuns = tris => {
  const t = [...tris].sort((a, b) => a - b), r = [];
  for (let i = 0; i < t.length; i++) {
    if (i && t[i] === t[i - 1]) continue;
    if (r.length && t[i] === r[r.length - 2] + r[r.length - 1]) r[r.length - 1]++;
    else r.push(t[i], 1);
  }
  return r;
};
export const fromRuns = r => { const out = []; for (let i = 0; i + 1 < r.length; i += 2) for (let k = 0; k < r[i + 1]; k++) out.push(r[i] + k); return out; };
// une zone lue (plages, ou liste de triangles d'avant)
export const tris = p => p.tris || (p.r ? (p.tris = fromRuns(p.r)) : []);

const hexOf = m => m?.material?.color ? m.material.color.getHexString().toUpperCase() : null;

// la piece d'origine (celle du fichier du plateau) d'un morceau separe ou coupe
export const topOf = g => { while (g.userData.whole) g = g.userData.whole; return g; };

// la couleur d'origine d'un maillage (celle du fichier, avant toute peinture ou couleur de piece)
const ownOf = m => m.userData.own || (m.userData.own = hexOf(m.userData.mat0 ? { material: m.userData.mat0 } : m));

// le maillage d'origine et la correspondance de ses triangles : {top, own, map(t local) -> t d'origine}
export function resolve(mesh, group) {
  const chain = [];
  const map = t => { for (const f of chain) { if (t == null) return t; t = f(t); } return t; };
  let m = mesh, g = group;
  for (;;) {
    if (m.userData.paint) {                                  // une zone deja peinte : ses triangles d'origine
      const o = m.userData.paint.orig;
      chain.push(t => o[t]);
      return { top: m.userData.paint.k, own: m.userData.paint.own, map };
    }
    const src = m.userData.src, parent = g.userData.whole;
    if (!src || !parent || !parent.children[src.mi]) break;
    if (src.tris) { const tr = src.tris; chain.push(t => tr[t]); }
    m = parent.children[src.mi]; g = parent;
  }
  return { top: g.userData.k, own: ownOf(m), map };
}

const base = m => {
  if (!m.userData.idx0 && m.geometry?.index) m.userData.idx0 = m.geometry.index.array.slice();
  if (!m.userData.mat0) m.userData.mat0 = m.material;
  ownOf(m);
};

// remet chaque maillage comme lu, puis pose les couleurs des pieces et les zones peintes
export function applyColors(THREE, groups, colors = {}, paints = []) {
  const mats = new Map();
  const tint = (mat0, hex) => {
    const key = `${mat0.uuid}|${hex}`;
    if (!mats.has(key)) {
      const m = mat0.clone();
      m.onBeforeCompile = mat0.onBeforeCompile; m.customProgramCacheKey = mat0.customProgramCacheKey; m.userData = mat0.userData;
      m.vertexColors = false;
      m.color.set(`#${hex}`);
      if (m.emissive && mat0.emissive && mat0.emissiveIntensity > 0.3) m.emissive.set(`#${hex}`);
      mats.set(key, m);
    }
    return mats.get(key);
  };
  for (const g of groups) {
    for (const m of g.children.filter(x => x.userData.isPaint)) { g.remove(m); m.geometry.index = null; m.geometry.dispose?.(); }
    const meshes = g.children.filter(x => x.isMesh);
    meshes.forEach(base);
    const pc = colors[g.userData.k];
    for (const m of meshes) {
      if (m.userData.idx0) { m.geometry.index.array.set(m.userData.idx0); m.geometry.index.needsUpdate = true; }
      m.material = pc ? tint(m.userData.mat0, pc) : m.userData.mat0;
    }
    if (!paints.length) continue;
    for (const m of meshes) {
      const { top, own, map } = resolve(m, g);
      const mine = paints.filter(p => p.k === top && p.own === own);
      if (!mine.length) continue;
      const idx = m.geometry.index.array, n = idx.length / 3;
      const local = new Map();                              // triangle d'origine -> triangle de ce maillage
      for (let t = 0; t < n; t++) { const o = map(t); if (o != null) local.set(o, t); }
      const colorOf = new Map();
      for (const p of mine) for (const o of tris(p)) { const t = local.get(o); if (t != null) colorOf.set(t, p.c); }
      if (!colorOf.size) continue;
      const byC = new Map();
      for (const [t, c] of colorOf) { if (!byC.has(c)) byC.set(c, []); byC.get(c).push(t); }
      for (const [c, ts] of byC) {
        const ix = new Uint32Array(ts.length * 3), orig = new Int32Array(ts.length);
        ts.forEach((t, i) => { ix[i * 3] = idx[t * 3]; ix[i * 3 + 1] = idx[t * 3 + 1]; ix[i * 3 + 2] = idx[t * 3 + 2]; orig[i] = map(t); });
        for (const t of ts) { idx[t * 3 + 1] = idx[t * 3]; idx[t * 3 + 2] = idx[t * 3]; }   // aplati dans son maillage
        const geo = new THREE.BufferGeometry();
        for (const [name, a] of Object.entries(m.geometry.attributes)) geo.setAttribute(name, a);
        geo.setIndex(new THREE.BufferAttribute(ix, 1));
        geo.computeBoundingSphere();
        const pm = new THREE.Mesh(geo, tint(m.userData.mat0, c));
        pm.userData = { isPaint: true, paint: { k: top, own, orig }, own };
        g.add(pm);
      }
      m.geometry.index.needsUpdate = true;
    }
  }
}

// les triangles d'une zone : de proche en proche par les aretes communes, tant que l'angle entre deux faces reste
// doux (sous « crease » degres) ; une piece a part (un oeil pose dessus) est prise entiere
export function zoneOf(geo, tri, crease = 35, limit = 400000) {
  const pos = geo.attributes.position, idx = geo.index.array, n = idx.length / 3;
  const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  // les sommets confondus (un maillage peut dupliquer ses sommets) : rapproches par leur position
  const vid = new Int32Array(pos.count), seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    if (!seen.has(k)) seen.set(k, i);
    vid[i] = seen.get(k);
  }
  const edges = new Map();
  const nrm = new Float32Array(n * 3);
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (let t = 0; t < n; t++) {
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    if (i0 === i1 && i1 === i2) continue;                  // aplati (deja peint ailleurs)
    a[0] = pos.getX(i0); a[1] = pos.getY(i0); a[2] = pos.getZ(i0);
    b[0] = pos.getX(i1) - a[0]; b[1] = pos.getY(i1) - a[1]; b[2] = pos.getZ(i1) - a[2];
    c[0] = pos.getX(i2) - a[0]; c[1] = pos.getY(i2) - a[1]; c[2] = pos.getZ(i2) - a[2];
    let x = b[1] * c[2] - b[2] * c[1], y = b[2] * c[0] - b[0] * c[2], z = b[0] * c[1] - b[1] * c[0];
    const l = Math.hypot(x, y, z) || 1; nrm[t * 3] = x / l; nrm[t * 3 + 1] = y / l; nrm[t * 3 + 2] = z / l;
    for (const [p, q] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const k = key(vid[p], vid[q]);
      const e = edges.get(k); if (e) e.push(t); else edges.set(k, [t]);
    }
  }
  const cos = Math.cos(crease * Math.PI / 180);
  const out = new Set([tri]), todo = [tri];
  while (todo.length && out.size < limit) {
    const t = todo.pop();
    const vs = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]].map(v => vid[v]);
    for (const [p, q] of [[vs[0], vs[1]], [vs[1], vs[2]], [vs[2], vs[0]]]) {
      for (const u of edges.get(key(p, q)) || []) {
        if (out.has(u)) continue;
        const d = nrm[t * 3] * nrm[u * 3] + nrm[t * 3 + 1] * nrm[u * 3 + 1] + nrm[t * 3 + 2] * nrm[u * 3 + 2];
        if (d < cos) continue;                             // une arete vive : la zone s'arrete la
        out.add(u); todo.push(u);
      }
    }
  }
  return [...out];
}

// les triangles d'un coup de pinceau : ceux dont le centre est a moins de r (mm, repere du maillage) du point touche
export function brushOf(geo, p, r) {
  const pos = geo.attributes.position, idx = geo.index.array, n = idx.length / 3, r2 = r * r, out = [];
  for (let t = 0; t < n; t++) {
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    if (i0 === i1 && i1 === i2) continue;
    const x = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3 - p.x, y = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3 - p.y,
      z = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3 - p.z;
    if (x * x + y * y + z * z <= r2) out.push(t);
  }
  return out;
}
