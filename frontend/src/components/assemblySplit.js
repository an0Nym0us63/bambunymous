// Separer une piece de la vue assemblee en ses morceaux (29/10/2026), a la demande dans l'edition : les morceaux qui ne
// se touchent pas (sommets soudes a 0,001 mm pres), comme « Separer en objets » de Bambu Studio. Les miettes (moins de
// 0,3 % des triangles, et 30 au plus) restent au plus gros morceau. Les morceaux sont numerotes du plus gros au plus
// petit : le meme calcul redonne les memes numeros, ce qui permet de retrouver une separation enregistree
// (« objet:instance:partie:morceau »).

// les morceaux d'une piece : [{ parts: [[maillage d'origine, geometrie du morceau]] }], ou null (d'un seul tenant).
// cuts (30/10/2026) : les coups de couteau donnes a la piece (cutGeometry), appliques d'abord. Le tableau rendu porte
// aussi « owner » : pour chaque maillage, le morceau de chaque triangle d'origine (de quoi suivre un morceau d'une coupe
// a l'autre)
// info (facultatif) : y est note « lastHits », le nombre de triangles tranches par le dernier coup
export function splitPieceGeometry(THREE, pg, cuts = null, info = null) {
  const meshes = pg.children.filter(m => m.isMesh && m.geometry?.attributes?.position);
  if (!meshes.length) return null;
  const tagIds = new Map(), cut = cuts?.length ? meshes.map(m => cutGeometry(THREE, m.geometry, cuts, tagIds)) : null;
  const geos = cut ? cut.map(c => c.geo) : meshes.map(m => m.geometry);
  if (info && cut) info.lastHits = cut.reduce((s, c) => s + (c.hits[c.hits.length - 1] || 0), 0);
  const weld = new Map(), ids = [], tris = [];       // tris : [maillage, numero du triangle, sommets soudes a, b, c]
  const vid = (x, y, z, tag = 0) => {
    // un sommet ne d'une coupe est d'un cote ou de l'autre : son « tag » l'empeche de se souder a son jumeau d'en face
    const k = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}${tag ? `/${tag}` : ""}`;
    let i = weld.get(k);
    if (i === undefined) { i = weld.size; weld.set(k, i); }
    return i;
  };
  geos.forEach((geo, mi) => {
    const p = geo.attributes.position.array, ix = geo.index?.array, tg = cut?.[mi].tag;
    const w = new Int32Array(p.length / 3);
    for (let i = 0; i < w.length; i++) w[i] = vid(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], tg ? tg[i] : 0);
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
  let big;
  if (cut) {
    // apres une coupe, une miette se juge a sa taille et non a ses triangles : un support droit n'en a qu'une douzaine
    const pos = new Float64Array(weld.size * 3);
    let i = 0;
    for (const k of weld.keys()) { const [x, y, z] = k.split("/")[0].split(",").map(Number); pos[i * 3] = x / 1000; pos[i * 3 + 1] = y / 1000; pos[i * 3 + 2] = z / 1000; i++; }
    const box = new Map(), whole = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const grow = (b, v) => { for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], pos[v * 3 + a]); b[a + 3] = Math.max(b[a + 3], pos[v * 3 + a]); } };
    for (let t = 0; t < tris.length; t += 5) {
      const r = root(tris[t + 2]);
      let b = box.get(r);
      if (!b) { b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; box.set(r, b); }
      for (let e = 2; e < 5; e++) { grow(b, tris[t + e]); grow(whole, tris[t + e]); }
    }
    const diag = b => Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    const min = Math.max(0.6, 0.015 * diag(whole));
    big = order.filter(([r], j) => j === 0 || diag(box.get(r)) >= min);
  } else big = order.filter(([, c]) => c >= Math.max(30, 0.003 * total));
  if (big.length < 2) return null;
  const rank = new Map(big.map(([r], i) => [r, i]));
  // les triangles de chaque morceau, par maillage d'origine
  const per = big.map(() => meshes.map(() => []));
  for (let t = 0; t < tris.length; t += 5) {
    const n = rank.has(root(tris[t + 2])) ? rank.get(root(tris[t + 2])) : 0;     // une miette : au plus gros morceau
    per[n][tris[t]].push(tris[t + 1]);
  }
  const out = per.map(byMesh => ({
    parts: byMesh.map((list, mi) => list.length ? [meshes[mi], subGeometry(THREE, geos[mi], list)] : null).filter(Boolean),
  }));
  out.owner = geos.map((geo, mi) => {
    const n = cut ? cut[mi].n : (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const own = new Int32Array(n).fill(-1);
    per.forEach((byMesh, j) => { for (const t of byMesh[mi]) { const o = cut ? cut[mi].from[t] : t; if (own[o] < 0) own[o] = j; } });
    return own;
  });
  return out;
}

// Les supports integres au modele (30/10/2026) : des parois et des plaques fines (moins de 2,5 mm), faites de grandes
// faces planes en peu de triangles, fondues a la piece (une queue d'oiseau tenue par des voiles verticaux et une
// semelle). Reperes ainsi :
//  1. les regions planes (triangles voisins dans un meme plan) ;
//  2. les « graines » : les grandes regions planes (3 mm2 au moins, triangles de 1 mm2 en moyenne : une surface courbe
//     en a de bien plus petits) qui ont, en face, a 2,5 mm au plus, une autre grande region parallele qui la recouvre :
//     les deux faces d'une paroi fine ;
//  3. de proche en proche, les bandes planes etroites (1,8 mm au plus) qui les touchent : chants et sommets des parois ;
//  4. ce qui reste, en morceaux : les petits (moins de 5 % du plus grand) qui touchent les supports les rejoignent.
// Rend, pour chaque triangle, 1 s'il est d'un support (ou null : aucun support reconnu). Positions en mm.
export function supportTris(pos, ix, only = null) {
  const nt = ix.length / 3;
  const weld = new Map(), w = new Int32Array(pos.length / 3);
  for (let i = 0; i < w.length; i++) {
    const k = `${Math.round(pos[i * 3] * 1000)},${Math.round(pos[i * 3 + 1] * 1000)},${Math.round(pos[i * 3 + 2] * 1000)}`;
    let j = weld.get(k);
    if (j === undefined) { j = weld.size; weld.set(k, j); }
    w[i] = j;
  }
  const nv = weld.size;
  const N = new Float64Array(nt * 3), A = new Float64Array(nt), O = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    A[t] = l / 2;
    if (l > 1e-12) { nx /= l; ny /= l; nz /= l; }
    N[t * 3] = nx; N[t * 3 + 1] = ny; N[t * 3 + 2] = nz;
    O[t] = nx * pos[a] + ny * pos[a + 1] + nz * pos[a + 2];
  }
  // les voisins par arete (soudee)
  const edge = new Map(), nb = new Int32Array(nt * 3).fill(-1);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const p = w[ix[t * 3 + e]], q = w[ix[t * 3 + (e + 1) % 3]], k = p < q ? p * nv + q : q * nv + p, o = edge.get(k);
    if (o === undefined) edge.set(k, t * 3 + e); else { nb[t * 3 + e] = Math.floor(o / 3); nb[o] = t; }
  }
  // 1. les regions planes
  const reg = new Int32Array(nt).fill(-1), R = [];
  for (let s = 0; s < nt; s++) {
    if (reg[s] >= 0) continue;
    const id = R.length, r = { area: 0, n: 0, nx: 0, ny: 0, nz: 0, o: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
    R.push(r); reg[s] = id;
    const st = [s];
    while (st.length) {
      const t = st.pop();
      r.area += A[t]; r.n++; r.nx += N[t * 3] * A[t]; r.ny += N[t * 3 + 1] * A[t]; r.nz += N[t * 3 + 2] * A[t]; r.o += O[t] * A[t];
      for (let e = 0; e < 3; e++) {
        const v = ix[t * 3 + e] * 3;
        for (let c = 0; c < 3; c++) { r.lo[c] = Math.min(r.lo[c], pos[v + c]); r.hi[c] = Math.max(r.hi[c], pos[v + c]); }
        const o = nb[t * 3 + e];
        if (o < 0 || reg[o] >= 0) continue;
        if (N[o * 3] * N[s * 3] + N[o * 3 + 1] * N[s * 3 + 1] + N[o * 3 + 2] * N[s * 3 + 2] > 0.9995 && Math.abs(O[o] - O[s]) < 0.05) { reg[o] = id; st.push(o); }
      }
    }
  }
  let tot = 0;
  for (const r of R) {
    tot += r.area;
    const l = Math.hypot(r.nx, r.ny, r.nz) || 1;
    r.nx /= l; r.ny /= l; r.nz /= l; r.o /= r.area || 1;
    r.width = r.area / (Math.hypot(r.hi[0] - r.lo[0], r.hi[1] - r.lo[1], r.hi[2] - r.lo[2]) || 1);
  }
  // 2. les graines : deux grandes faces paralleles, face a face, a 2,5 mm au plus
  const big = R.map((r, i) => i).filter(i => R[i].area >= Math.max(3, 0.0002 * tot) && R[i].area / R[i].n >= 1)
    .sort((a, b) => R[b].area - R[a].area).slice(0, 1500);
  const inS = new Uint8Array(R.length);
  for (const i of big) {
    const r = R[i];
    for (const j of big) {
      if (j === i) continue;
      const q = R[j];
      if (r.nx * q.nx + r.ny * q.ny + r.nz * q.nz > -0.999) continue;
      const gap = Math.abs(r.o + q.o);
      if (gap > 2.5) continue;
      let over = true;
      for (let c = 0; c < 3; c++) if (Math.min(r.hi[c], q.hi[c]) + gap + 0.1 < Math.max(r.lo[c], q.lo[c])) over = false;
      if (over) { inS[i] = 1; inS[j] = 1; }
    }
  }
  if (!inS.some(Boolean)) return null;
  const S = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) S[t] = inS[reg[t]];
  // 3. les bandes etroites qui touchent les supports (chants, sommets des parois)
  const cand = R.map((r, i) => i).filter(i => !inS[i] && R[i].area >= 2 && R[i].area / R[i].n >= 0.8 && R[i].width <= 1.8);
  const vS = new Uint8Array(nv);
  const mark = () => { for (let t = 0; t < nt; t++) if (S[t]) for (let e = 0; e < 3; e++) vS[w[ix[t * 3 + e]]] = 1; };
  mark();
  const trisOf = new Map();
  for (let t = 0; t < nt; t++) { const r = reg[t]; if (!inS[r]) { let l = trisOf.get(r); if (!l) trisOf.set(r, l = []); l.push(t); } }
  for (let grew = true; grew;) {
    grew = false;
    for (const i of cand) {
      if (inS[i]) continue;
      const ts = trisOf.get(i) || [];
      if (!ts.some(t => vS[w[ix[t * 3]]] || vS[w[ix[t * 3 + 1]]] || vS[w[ix[t * 3 + 2]]])) continue;
      inS[i] = 1; grew = true;
      for (const t of ts) { S[t] = 1; for (let e = 0; e < 3; e++) vS[w[ix[t * 3 + e]]] = 1; }
    }
  }
  // 4. le reste en morceaux : les petits qui touchent les supports les rejoignent
  const up = new Int32Array(nv);
  for (let i = 0; i < nv; i++) up[i] = i;
  const root = i => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  for (let t = 0; t < nt; t++) if (!S[t]) { const a = root(w[ix[t * 3]]); up[root(w[ix[t * 3 + 1]])] = a; up[root(w[ix[t * 3 + 2]])] = a; }
  const area = new Map();
  for (let t = 0; t < nt; t++) if (!S[t]) { const k = root(w[ix[t * 3]]); area.set(k, (area.get(k) || 0) + A[t]); }
  const main = Math.max(0, ...area.values());
  const touch = new Set();
  for (let t = 0; t < nt; t++) if (!S[t] && (vS[w[ix[t * 3]]] || vS[w[ix[t * 3 + 1]]] || vS[w[ix[t * 3 + 2]]])) touch.add(root(w[ix[t * 3]]));
  for (let t = 0; t < nt; t++) if (!S[t]) { const k = root(w[ix[t * 3]]); if (area.get(k) < 0.05 * main && touch.has(k)) S[t] = 1; }
  // seulement dans la boite d'un morceau vise
  if (only) for (let t = 0; t < nt; t++) if (S[t] && !only(t)) S[t] = 0;
  return S;
}

// Un coup de couteau (30/10/2026) : un trait trace a l'ecran, devenu un secteur de plan qui part de l'oeil (e) entre
// deux directions (a, b), dans le repere de la piece entiere (et dans la boite « box » du morceau vise, s'il y en a
// une). Les triangles traverses dans ce secteur sont coupes en
// deux ; hors du secteur, rien ne change (un trait court ne tranche que ce qu'il traverse). La geometrie rendue a ses
// sommets marques (« tag ») d'un cote ou de l'autre de chaque coupe, et « from » : le triangle d'origine de chacun.
export function cutGeometry(THREE, geo, cuts, tagIds = new Map()) {
  const names = Object.keys(geo.attributes), src = names.map(nm => geo.attributes[nm]);
  const vals = src.map(a => Array.from(a.array)), size = src.map(a => a.itemSize);
  const pi = names.indexOf("position");
  const n0 = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  let ix = geo.index ? Array.from(geo.index.array) : Array.from({ length: n0 * 3 }, (_, i) => i);
  let from = Array.from({ length: n0 }, (_, i) => i);
  const hits = cuts.map(() => 0);
  const tag = new Array(geo.attributes.position.count).fill(0);   // tagIds : partages entre les maillages d'une piece
  const P = v => [vals[pi][v * 3], vals[pi][v * 3 + 1], vals[pi][v * 3 + 2]];
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  cuts.forEach((c, ci) => {
    if (c.sup) {
      // detacher les supports : leurs triangles prennent des sommets a eux (ceux partages avec le reste sont doubles)
      const X = c.box, n = ix.length / 3;
      const only = X ? t => { const q = [0, 1, 2].map(a => (P(ix[t * 3])[a] + P(ix[t * 3 + 1])[a] + P(ix[t * 3 + 2])[a]) / 3);
        return q[0] >= X[0] && q[1] >= X[1] && q[2] >= X[2] && q[0] <= X[3] && q[1] <= X[4] && q[2] <= X[5]; } : null;
      const S = supportTris(vals[pi], ix, only);
      if (!S) return;
      const inR = new Uint8Array(tag.length), inSv = new Uint8Array(tag.length);
      for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) (S[t] ? inSv : inR)[ix[t * 3 + e]] = 1;
      const dup = new Map();
      for (let t = 0; t < n; t++) {
        if (!S[t]) continue;
        hits[ci]++;
        for (let e = 0; e < 3; e++) {
          const v = ix[t * 3 + e], tk = `${tag[v]}|s${ci}`;
          let id = tagIds.get(tk);
          if (id === undefined) { id = tagIds.size + 1; tagIds.set(tk, id); }
          if (!inR[v]) { tag[v] = id; continue; }
          let j = dup.get(v);
          if (j === undefined) {
            j = tag.length;
            vals.forEach((arr, ai) => { for (let q = 0; q < size[ai]; q++) arr.push(arr[v * size[ai] + q]); });
            tag.push(id); dup.set(v, j);
          }
          ix[t * 3 + e] = j;
        }
      }
      return;
    }
    const E = c.e, A = c.a, B = c.b, N = cross(A, B), ln = Math.hypot(...N);
    if (ln < 1e-12) return;
    const nn = N.map(x => x / ln), fwd = [A[0] + B[0], A[1] + B[1], A[2] + B[2]];
    // box : la boite du morceau vise (un trait donne sur un morceau ne coupe pas les autres morceaux de la piece)
    const X = c.box, inBox = q => !X || (q[0] >= X[0] && q[1] >= X[1] && q[2] >= X[2] && q[0] <= X[3] && q[1] <= X[4] && q[2] <= X[5]);
    const inside = q => { const d = sub(q, E); return inBox(q) && dot(cross(A, d), nn) >= 0 && dot(cross(d, B), nn) >= 0 && dot(d, fwd) > 0; };
    // un sommet sur une arete coupee, un par cote (deux triangles voisins retombent sur le meme : le cache)
    const made = new Map();
    const between = (v0, v1, t, side) => {
      const a = Math.min(v0, v1), b = Math.max(v0, v1), k = `${a}-${b}-${side}`;
      let j = made.get(k);
      if (j !== undefined) return j;
      const tt = v0 === a ? t : 1 - t;
      j = tag.length;
      vals.forEach((arr, ai) => { for (let q = 0; q < size[ai]; q++) arr.push(arr[a * size[ai] + q] * (1 - tt) + arr[b * size[ai] + q] * tt); });
      // le cote de cette coupe, et celui des coupes d'avant de l'arete coupee : a la croisee de deux coupes, un sommet
      // ne doit pas se souder a celui d'en face de la premiere
      const tk = `${Math.min(tag[a], tag[b])}|${Math.max(tag[a], tag[b])}|${ci}|${side}`;
      let id = tagIds.get(tk);
      if (id === undefined) { id = tagIds.size + 1; tagIds.set(tk, id); }
      tag.push(id);
      made.set(k, j);
      return j;
    };
    const nix = [], nfrom = [];
    for (let t = 0; t < ix.length / 3; t++) {
      const v = [ix[t * 3], ix[t * 3 + 1], ix[t * 3 + 2]], p = v.map(P), d = p.map(q => dot(sub(q, E), nn)), s = d.map(x => (x >= 0 ? 1 : 0));
      if (s[0] === s[1] && s[1] === s[2]) { nix.push(...v); nfrom.push(from[t]); continue; }
      // le sommet seul de son cote (i), les deux autres (j, k) en face
      const i = s[0] !== s[1] && s[0] !== s[2] ? 0 : s[1] !== s[0] && s[1] !== s[2] ? 1 : 2, j = (i + 1) % 3, k = (i + 2) % 3;
      const tj = d[i] / (d[i] - d[j]), tk = d[i] / (d[i] - d[k]);
      const qj = p[i].map((x, a) => x + (p[j][a] - x) * tj), qk = p[i].map((x, a) => x + (p[k][a] - x) * tk);
      if (!inside(qj.map((x, a) => (x + qk[a]) / 2))) { nix.push(...v); nfrom.push(from[t]); continue; }
      const si = s[i], so = 1 - si;
      const ij = between(v[i], v[j], tj, si), ik = between(v[i], v[k], tk, si);
      const oj = between(v[i], v[j], tj, so), ok = between(v[i], v[k], tk, so);
      // l'ordre des sommets garde le sens du triangle (les faces restent tournees vers l'exterieur)
      nix.push(v[i], ij, ik, oj, v[j], v[k], oj, v[k], ok);
      hits[ci]++;
      nfrom.push(from[t], from[t], from[t]);
    }
    ix = nix; from = nfrom;
  });
  const out = new THREE.BufferGeometry();
  names.forEach((nm, ai) => out.setAttribute(nm, new THREE.BufferAttribute(new src[ai].array.constructor(vals[ai]), size[ai], src[ai].normalized)));
  out.setIndex(new THREE.BufferAttribute(tag.length > 65535 ? new Uint32Array(ix) : new Uint16Array(ix), 1));
  return { geo: out, tag: Int32Array.from(tag), from: Int32Array.from(from), n: n0, hits };
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
      c: c0.clone().add(cc), from: pg.userData.k, parentC: c0.clone(), whole: pg };
    pg.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(cc.x, cc.y, cc.z)).decompose(g.position, g.quaternion, g.scale);
    g.updateMatrix();
    return g;
  });
}
