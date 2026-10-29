// L'edition de la vue assemblee (29/10/2026), sur PC, a la souris. Chaque piece est un groupe three.js (enfant du
// support du modele, en coordonnees du 3MF : Z vers le haut, en mm). Les gestes :
//  - choisir : un clic (une piece, ou tout son groupe ; Alt : la piece seule) ; Ctrl ou Maj : en ajouter, en retirer ;
//    « Grouper » / « Degrouper » : des pieces qui bougent ensemble, gardees avec l'assemblage ;
//  - deplacer / tourner la selection : la poignee de three.js (TransformControls), avec l'aimantation (pas de 1 mm et
//    15°, et la selection lachee pres d'une autre piece ou du sol vient s'y coller) ;
//  - poser au sol : une face touchee vient a plat sur le sol (une arete : mise a l'horizontale), puis la piece y descend ;
//  - coller : une face (ou une arete) de la piece A, puis une face (ou une arete) de la piece B : A pivote pour que les
//    deux se regardent (ou s'alignent) et vient s'y coller ; en mode assiste, les deux faces planes entieres sont
//    reperees, centrees l'une sur l'autre et leurs grands axes alignes (au clic pres sinon) ; A tourne ensuite autour
//    du contact (boutons) ;
//  - annuler, refaire.
// Une arete est reconnue la ou les deux faces qui la bordent font un angle marque (plus de 30°), et seulement si le
// clic tombe tout pres d'elle ; sinon c'est la face.
// Les collages (29/10/2026) : une piece collee reste collee. Un glisser sur elle la fait coulisser sur la face de
// contact (ou le long de l'arete), Maj + glisser la fait tourner autour du contact ; les pieces collees sur une piece
// la suivent quand elle bouge ; « Decoller » la libere. Un collage est garde dans le repere de la piece support (B) :
// le point et la normale du contact (et l'arete), enregistres avec l'assemblage.
import { egg } from "../eggs";

// ce que l'editeur charge a part, demande d'avance (30/10/2026 : sur un telephone, le premier chargement prenait
// quelques secondes sans rien montrer, on croyait l'edition en panne)
export const preloadEditor = () => import("three/examples/jsm/controls/TransformControls.js").catch(() => {});

export async function createAssemblyEditor({ THREE, scene, camera, renderer, controls, holder, pieces, render, onChange, groupsInit = [], jointsInit = [], groupByObject = false,
                                                  copyPiece = null }) {
  const { TransformControls } = await import("three/examples/jsm/controls/TransformControls.js");
  const el = renderer.domElement;
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let all = [...pieces.values()];
  let byKey = new Map(all.map(g => [g.userData.k, g]));
  const reindex = () => { all = [...pieces.values()]; byKey = new Map(all.map(g => [g.userData.k, g])); };

  let mode = "move";                 // move | rotate | ground | mate
  let magnet = true, assist = true;
  let rotStep = 0;                   // le cran des rotations a la poignee (0 : libre) ; Alt maintenu : tout libre
  // tablette au stylet (29/10/2026) : sans clavier, deux interrupteurs tiennent lieu de Ctrl (choisir plusieurs) et de
  // Maj (tourner la piece collee)
  let multi = false, turnGlued = false;
  // l'anti-collision (29/10/2026) : une piece collee qu'on fait coulisser s'arrete au contact de la matiere (l'assistant
  // d'emboitement, trop lourd, a ete retire le 30/10/2026)
  let guard = false, fitMsg = null, collider = null;
  const getCollider = async () => { if (!collider) { const { createCollider } = await import("./assemblyCollide"); collider = await createCollider(THREE); } return collider; };
  let alt = false;
  const sel = new Set();             // les pieces choisies
  let first = null;                  // coller : la premiere prise
  let pivot = null;                  // l'axe de contact apres un collage {p, axis, unit} (repere du support)
  // les groupes : des listes de pieces (gardes par leur cle)
  // une cle d'avant le decoupage en morceaux (« objet:instance[:partie] ») designe tous ses morceaux
  const byOld = k => byKey.has(k) ? [byKey.get(k)] : all.filter(g => String(g.userData.k || "").startsWith(`${k}:`));
  let groups = (groupsInit || []).map(ks => ks.flatMap(byOld)).filter(g => g.length > 1);
  // les parties d'un meme objet (« objet:instance:partie ») bougent ensemble, comme dans Bambu Studio : le visage avec ses
  // yeux et sa bouche ; Alt + clic en prend une seule, « Degrouper » les libere (tant que l'assemblage n'a pas ete
  // enregistre par cette version : ensuite, ses groupes font foi)
  if (groupByObject) {
    const byObj = new Map();
    for (const g of all) { const k = String(g.userData.k || "").split(":").slice(0, 2).join(":"); byObj.set(k, [...(byObj.get(k) || []), g]); }
    for (const parts of byObj.values()) if (parts.length > 1 && !parts.some(g => groups.some(gr => gr.includes(g)))) groups.push(parts);
  }
  const groupOf = g => groups.find(gr => gr.includes(g)) || null;
  const unitOf = g => groupOf(g) || [g];
  // les collages : {a : la piece collee, b : son support, kind, p, n, e : dans le repere de b}
  const V = a => (a ? new THREE.Vector3().fromArray(a) : null);
  let joints = (jointsInit || []).map(j => ({ a: byOld(j.a)[0], b: byOld(j.b)[0], kind: j.kind === "edge" ? "edge" : "face", p: V(j.p), n: V(j.n), e: V(j.e) }))
    .filter(j => j.a && j.b && j.p && j.n);
  const cloneJ = j => ({ ...j, p: j.p.clone(), n: j.n.clone(), e: j.e ? j.e.clone() : null });
  // une liste de pieces, et tout ce qui y est colle (de proche en proche, avec leurs groupes)
  const withKids = list => {
    const out = new Set(list);
    for (let grew = true; grew;) {
      grew = false;
      for (const j of joints) if (out.has(j.b) && !out.has(j.a)) { unitOf(j.a).forEach(g => out.add(g)); grew = true; }
    }
    return [...out];
  };
  // le collage qui tient cette selection a une piece hors d'elle
  const jointOf = list => { const set = new Set(list); return joints.find(j => set.has(j.a) && !set.has(j.b)) || null; };
  // le contact d'un collage, dans le repere du support du modele
  const contact = j => {
    j.b.updateMatrix();
    const P = j.p.clone().applyMatrix4(j.b.matrix), N = j.n.clone().transformDirection(j.b.matrix);
    return { P, N, E: j.e ? j.e.clone().transformDirection(j.b.matrix) : null };
  };

  // la poignee : posee sur un repere au centre de la selection ; ce qu'on lui fait s'applique a toute la selection
  const handle = new THREE.Object3D(); holder.add(handle);
  const tc = new TransformControls(camera, el);
  tc.setSpace("world");
  // au doigt (30/10/2026) : une poignee plus grosse, qu'on attrape sans viser au pixel
  const coarse = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
  tc.size = coarse ? 0.95 : 0.8;          // au doigt, la piece se tire aussi elle-meme (hors des fleches)
  const helper = tc.getHelper();
  scene.add(helper);
  let dragStart = null;              // la poignee et les pieces au debut du glisser
  tc.addEventListener("dragging-changed", e => {
    controls.enabled = !e.value;
    if (e.value) { handle.updateMatrix(); dragStart = { h: handle.matrix.clone(), q: handle.quaternion.clone(), m: withKids([...sel]).map(g => [g, g.matrix.clone()]) }; }
    else { dragStart = null; liveAngle = null; snapAfterDrag(); push(); }
  });
  // la rotation a la poignee, demultipliee (29/10/2026) : three.js fait tourner de 20 radians par unite de glisser divisee
  // par la distance de la camera ; en millimetres, un centimetre de souris faisait un demi-tour. L'angle est ramene a
  // un dixieme, puis au cran choisi ; il s'affiche en direct.
  const ROT_GAIN = 0.1;
  let liveAngle = null;
  tc.addEventListener("objectChange", () => {
    if (!dragStart) return;
    if (tc.mode === "rotate") {
      // l'angle du geste lui-meme (continu, signe), pas celui relu sur la poignee : au-dela d'un demi-tour, un
      // quaternion se replie et l'axe s'inversait, la piece sautait d'un sens a l'autre (30/10/2026)
      let a = THREE.MathUtils.radToDeg((tc.rotationAngle || 0) * ROT_GAIN);
      if (rotStep && !alt) a = Math.round(a / rotStep) * rotStep;
      handle.quaternion.setFromAxisAngle(tc.rotationAxis.clone().normalize(), THREE.MathUtils.degToRad(a)).multiply(dragStart.q).normalize();
      liveAngle = Math.round(a * 10) / 10;
      onChange?.(state());
    }
    handle.updateMatrix();
    const d = handle.matrix.clone().multiply(dragStart.h.clone().invert());
    for (const [g, m0] of dragStart.m) { d.clone().multiply(m0).decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }
  });
  tc.addEventListener("change", render);

  const undo = [], redo = [];
  let pendingSplit = null;            // une separation proposee, pas encore validee
  const snapshot = () => ({ m: all.map(g => g.matrix.clone()), groups: groups.map(gr => [...gr]), joints: joints.map(cloneJ), ex: all.map(g => !!g.userData.excluded) });
  const restore = s => { all.forEach((g, i) => { s.m[i].decompose(g.position, g.quaternion, g.scale); g.updateMatrix();
    if (s.ex) { g.userData.excluded = s.ex[i]; g.visible = !s.ex[i]; } }); groups = s.groups.map(gr => [...gr]);
    joints = s.joints.map(cloneJ); placeHandle(); showContact(); render(); };
  // l'historique repart d'ici (une piece ajoutee ou retiree : les etats d'avant n'ont pas le meme nombre de pieces)
  const resetHistory = () => { undo.length = 0; redo.length = 0; last = snapshot(); changes++; };
  let last = snapshot();
  let changes = 0, savedAt = 0;          // dirty : des changements depuis le dernier enregistrement
  const push = () => { undo.push(last); if (undo.length > 100) undo.shift(); redo.length = 0; last = snapshot(); changes++; onChange?.(state()); };
  const selName = () => sel.size === 0 ? null : sel.size === 1 ? [...sel][0].userData.name : `${sel.size} pièces${groups.some(gr => gr.length === sel.size && gr.every(g => sel.has(g))) ? " (groupe)" : ""}`;
  const center = () => { if (!sel.size) return null; const c = boxOfAll([...sel]).getCenter(new THREE.Vector3()); return [c.x, c.y, c.z].map(v => Math.round(v * 10) / 10); };
  const state = () => ({ mode, magnet, assist, rotStep, center: center(), selected: selName(), count: sel.size, step: first ? 2 : 1, canUndo: undo.length > 0, canRedo: redo.length > 0,
    pivot: !!pivot, pairs: pairs.length, boxMode, ground3, groundPts: gPts.length, vertical, pinsA: pins.a.length, pinsB: pins.b.length,
    pinsFrom: pins.A?.userData.name || null, pinsTo: pins.B?.userData.name || null, dirty: changes !== savedAt, splitPending: pendingSplit ? pendingSplit.groups.length : 0,
    canSplit: !pendingSplit && (sel.size === 1 || [...sel].some(g => groupOf(g))), canReunite: [...sel].some(g => g.userData.from),
    canGroup: sel.size > 1 && !groups.some(gr => gr.length === sel.size && gr.every(g => sel.has(g))),
    // de la selection part au moins un collage (vers une piece hors d'elle) : « Grouper le colle » a un sens
    canGroupGlued: sel.size > 0 && joints.some(j => sel.has(j.a) !== sel.has(j.b)),
    canUngroup: [...sel].some(g => groupOf(g)), multi, turnGlued, liveAngle, guard, fitMsg,
    hidden: all.filter(g => !g.visible && !g.userData.excluded && g !== pendingSplit?.pg).length,
    // la liste des pieces (30/10/2026) : pour exclure, remettre, multiplier
    list: all.filter(g => g !== pendingSplit?.pg).map(g => ({ k: g.userData.k, name: g.userData.name, sel: sel.has(g), shown: g.visible,
      excluded: !!g.userData.excluded, copy: !!g.userData.copyOf })),
    glued: (() => { const j = jointOf([...sel]); return j ? { to: j.b.userData.name, kind: j.kind } : null; })() });

  // une marque de la prise (face : un disque ; arete : un trait)
  const markMat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xf97316, depthTest: false });
  const marks = new THREE.Group(); marks.renderOrder = 999; holder.add(marks);
  const clearMarks = () => { marks.children.slice().forEach(m => { m.geometry.dispose(); marks.remove(m); }); };
  const mark = pick => {
    if (pick.kind === "edge") {
      marks.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([pick.a, pick.b]), lineMat));
    } else {
      const r = Math.max(1.5, Math.min(pick.size * 0.06, pick.region ? Math.sqrt(pick.region.area) * 0.4 : 1e9));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 24), markMat);
      disc.position.copy(pick.region ? pick.region.c : pick.p).addScaledVector(pick.n, 0.05);
      disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pick.n);
      marks.add(disc);
    }
    render();
  };

  const meshes = () => all.filter(g => g.visible).flatMap(g => g.children.filter(c => c.isMesh));   // les pieces masquees ne se touchent pas
  const pieceOf = o => { while (o && !pieces.has(o.userData.pid)) o = o.parent; return o; };
  const boxOf = g => { g.updateMatrix(); const b = new THREE.Box3(); g.children.forEach(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(g.matrix)); } }); return b; };
  const boxOfAll = list => list.reduce((b, g) => b.union(boxOf(g)), new THREE.Box3());

  // les triangles voisins d'un maillage (par arete), faits une fois par maillage, a la demande
  const adj = new WeakMap();
  const neighbours = geo => {
    if (adj.has(geo)) return adj.get(geo);
    const ix = geo.index.array, n = ix.length / 3, edge = new Map(), nb = new Int32Array(n * 3).fill(-1);
    const nv = geo.attributes.position.count;          // une cle exacte tant que nv * nv < 2^53 (des millions de sommets)
    const key = (a, b) => (a < b ? a * nv + b : b * nv + a);
    for (let t = 0; t < n; t++) {
      for (let e = 0; e < 3; e++) {
        const a = ix[t * 3 + e], b = ix[t * 3 + (e + 1) % 3], k = key(a, b), o = edge.get(k);
        if (o === undefined) edge.set(k, t * 3 + e);
        else { nb[t * 3 + e] = Math.floor(o / 3); nb[o] = t; }
      }
    }
    adj.set(geo, nb);
    return nb;
  };
  const triNormal = (pos, ix, t, out) => {
    const a = new THREE.Vector3().fromBufferAttribute(pos, ix[t * 3]), b = new THREE.Vector3().fromBufferAttribute(pos, ix[t * 3 + 1]),
      c = new THREE.Vector3().fromBufferAttribute(pos, ix[t * 3 + 2]);
    out.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const area = out.length() / 2; out.normalize();
    return [area, a, b, c];
  };
  // la face plane entiere autour d'un triangle (triangles voisins presque paralleles) : son centre, sa surface, son
  // grand axe (dans le repere du maillage)
  const regionOf = (geo, t0) => {
    const nb = neighbours(geo), pos = geo.attributes.position, ix = geo.index.array;
    const n0 = new THREE.Vector3(); triNormal(pos, ix, t0, n0);
    const seen = new Set([t0]), stack = [t0], n = new THREE.Vector3(), c = new THREE.Vector3(), pts = [];
    let area = 0;
    while (stack.length && seen.size < 200000) {
      const t = stack.pop();
      const [ar, a, b, cc] = triNormal(pos, ix, t, n);
      area += ar;
      c.addScaledVector(a.clone().add(b).add(cc).multiplyScalar(1 / 3), ar);
      pts.push(a, b, cc);
      for (let e = 0; e < 3; e++) {
        const u = nb[t * 3 + e];
        if (u < 0 || seen.has(u)) continue;
        triNormal(pos, ix, u, n);
        if (n.dot(n0) > Math.cos(THREE.MathUtils.degToRad(3))) { seen.add(u); stack.push(u); }
      }
    }
    if (area <= 0) return null;
    c.multiplyScalar(1 / area);
    // une face a relief (un tricot, un grain) : la face stricte n'est qu'une bosse de quelques triangles (30/10/2026 :
    // 9 mm² au lieu des 250 de la face d'une aile). On l'etend alors aux triangles voisins proches du plan moyen
    // (a 1,2 mm pres, normales a moins de 50°), plan recalcule au fur et a mesure : la face entiere, et sa normale moyenne
    let relaxed = false;
    if (seen.size < 40) {
      const nAvg = new THREE.Vector3(), cAvg = new THREE.Vector3();
      const seen2 = new Set([t0]), st2 = [t0], pts2 = [];
      let area2 = 0, k = 0;
      const add = t => { const [ar, a, b, cc] = triNormal(pos, ix, t, n); nAvg.addScaledVector(n, ar); cAvg.addScaledVector(a.clone().add(b).add(cc).multiplyScalar(1 / 3), ar); area2 += ar; pts2.push(a, b, cc); };
      add(t0);
      const cosMax = Math.cos(THREE.MathUtils.degToRad(50)), m = new THREE.Vector3();
      while (st2.length && seen2.size < 200000) {
        const t = st2.pop();
        const pn = nAvg.clone().normalize(), pc = cAvg.clone().divideScalar(area2 || 1);
        for (let e = 0; e < 3; e++) {
          const u = nb[t * 3 + e];
          if (u < 0 || seen2.has(u)) continue;
          const [, a, b, cc] = triNormal(pos, ix, u, m);
          const ctr = a.clone().add(b).add(cc).multiplyScalar(1 / 3);
          if (m.dot(pn) > cosMax && Math.abs(ctr.sub(pc).dot(pn)) < 1.2) { seen2.add(u); st2.push(u); add(u); k++; }
        }
      }
      if (area2 > area * 3) { relaxed = true; area = area2; c.copy(cAvg).divideScalar(area2); n0.copy(nAvg).normalize(); pts.length = 0; for (const x of pts2) pts.push(x); seen.clear(); seen2.forEach(x => seen.add(x)); }
    }
    // le grand axe : la direction la plus etendue dans le plan (analyse des points de la face, en 2D)
    const u = Math.abs(n0.z) < 0.9 ? new THREE.Vector3(0, 0, 1).cross(n0).normalize() : new THREE.Vector3(1, 0, 0).cross(n0).normalize();
    const v = n0.clone().cross(u);
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { const d = p.clone().sub(c), x = d.dot(u), y = d.dot(v); sxx += x * x; syy += y * y; sxy += x * y; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const axis = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(v, Math.sin(ang)).normalize();
    const elongated = Math.abs(sxx - syy) + Math.abs(sxy) > 0.08 * (sxx + syy);       // une face ronde ou carree : pas de grand axe sur
    return { c, area, axis, n: n0, elongated, count: seen.size, relaxed };
  };

  // la prise sous la souris : la piece, et sa face ou son arete (en coordonnees du support)
  const pickAt = ev => {
    const r = el.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    return pickRay();
  };
  // la prise le long du rayon deja pose (la souris, ou un essai sur le banc)
  const pickRay = () => {
    const hit = ray.intersectObjects(meshes(), false)[0];
    if (!hit) return null;
    const g = pieceOf(hit.object);
    if (!g) return null;
    const geo = hit.object.geometry, pos = geo.attributes.position, idx = geo.index;
    const ia = hit.face.a, ib = hit.face.b, ic = hit.face.c;
    g.updateMatrix();
    const M = g.matrix.clone().multiply(hit.object.matrix);                        // maillage -> support
    const N = new THREE.Matrix3().getNormalMatrix(M);
    const toHolder = v => v.applyMatrix4(M);
    const va = toHolder(new THREE.Vector3().fromBufferAttribute(pos, ia)), vb = toHolder(new THREE.Vector3().fromBufferAttribute(pos, ib)),
      vc = toHolder(new THREE.Vector3().fromBufferAttribute(pos, ic));
    const p = holder.worldToLocal(hit.point.clone());
    const n = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va)).normalize();
    const size = boxOf(g).getSize(new THREE.Vector3()).length();
    // la face entiere autour du clic (en mode assiste) ; une face a relief (tricot) : sa normale moyenne, et pas d'arete
    // (les cretes du relief n'en sont pas)
    let region = null;
    if (assist && idx) {
      const rg = regionOf(geo, hit.faceIndex);
      if (rg) region = { c: rg.c.clone().applyMatrix4(M), area: rg.area, axis: rg.axis.clone().applyMatrix3(N).normalize(), elongated: rg.elongated, relaxed: rg.relaxed };
      if (rg?.relaxed && rg.area > 20) {
        const nr = rg.n.clone().applyMatrix3(N).normalize();
        if (nr.dot(n) < 0) nr.negate();
        return { group: g, kind: "face", p, n: nr, size, region };
      }
    }
    // l'arete la plus proche du clic, si le clic la frole et si c'est une vraie arete (angle marque avec sa voisine)
    if (idx) {
      const nb = neighbours(geo), ix = idx.array, t = hit.faceIndex;
      const edges = [[0, va, vb], [1, vb, vc], [2, vc, va]];
      let best = null;
      for (const [e, a, b] of edges) {
        const q = new THREE.Line3(a, b).closestPointToPoint(p, true, new THREE.Vector3()), d = q.distanceTo(p);
        if (d < Math.max(0.5, 0.12 * a.distanceTo(b)) && (!best || d < best.d)) best = { d, e, a, b, q };
      }
      const u = best ? nb[t * 3 + best.e] : -1;
      if (u >= 0) {
        const n2 = new THREE.Vector3(); triNormal(pos, ix, u, n2); n2.applyMatrix3(N).normalize();
        if (n.angleTo(n2) > Math.PI / 6) {
          return { group: g, kind: "edge", p: best.q, a: best.a, b: best.b, e: new THREE.Vector3().subVectors(best.b, best.a).normalize(), n, size };
        }
      }
    }
    return { group: g, kind: "face", p, n, size, region };
  };

  // applique M (repere du support) a des pieces
  const apply = (list, M) => { for (const g of list) { g.updateMatrix(); M.clone().multiply(g.matrix).decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); } };
  const about = (p, q) => new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  // le sol : le plateau tel que la vue le montre (30/10/2026 : c'etait la hauteur 0 du repere du modele, que la vue
  // decale pour poser la piece la plus basse sur le plateau ; une piece « posee au sol » s'enfoncait sous la grille)
  const floorZ = () => { holder.updateMatrixWorld(true); return holder.worldToLocal(new THREE.Vector3(0, 0, 0)).z; };
  // le point le plus bas, sur les sommets (la boite d'une piece tournee deborde de la piece)
  const minZ = list => {
    let z = Infinity;
    const v = new THREE.Vector3();
    for (const g of list) {
      g.updateMatrix();
      for (const m of g.children) {
        if (!m.isMesh || !m.geometry?.attributes?.position) continue;
        const pa = m.geometry.attributes.position.array, st = Math.max(1, Math.floor(pa.length / 3 / 200000));
        for (let i = 0; i < pa.length; i += 3 * st) z = Math.min(z, v.set(pa[i], pa[i + 1], pa[i + 2]).applyMatrix4(g.matrix).z);
      }
    }
    return Number.isFinite(z) ? z : boxOfAll(list).min.z;
  };
  const drop = list => { apply(list, new THREE.Matrix4().makeTranslation(0, 0, floorZ() - minZ(list))); };

  // la poignee au centre de la selection
  const placeHandle = () => {
    if (!sel.size || !(mode === "move" || mode === "rotate") || jointOf([...sel])) { tc.detach(); return; }
    const c = boxOfAll([...sel]).getCenter(new THREE.Vector3());
    handle.position.copy(c); handle.quaternion.identity(); handle.scale.set(1, 1, 1); handle.updateMatrix();
    tc.attach(handle); tc.setMode(mode === "move" ? "translate" : "rotate");
  };
  const shade = () => {
    all.forEach(o => o.children.forEach(m => { if (m.isMesh && m.material) { const dim = sel.size > 0 && !sel.has(o); m.material.transparent = dim; m.material.opacity = dim ? 0.65 : 1; } }));
  };
  const setSel = list => { fitMsg = null; sel.clear(); list.forEach(g => sel.add(g)); shade(); placeHandle(); showContact(); render(); onChange?.(state()); };
  // le contact de la selection collee, marque d'un anneau
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.2, 32), ringMat); ring.renderOrder = 999; ring.visible = false; holder.add(ring);
  const showContact = () => {
    const j = jointOf([...sel]);
    ring.visible = !!j;
    if (j) { const { P, N, E } = contact(j); ring.position.copy(P); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), E ? E : N); }
  };

  // l'aimantation apres un deplacement : sol a moins de 3 mm, et faces de boite d'une autre piece a moins de 3 mm
  const SNAP = 3;
  const snapAfterDrag = () => {
    if (!magnet || !sel.size || mode !== "move") return;
    const list = [...sel], b = boxOfAll(list), t = new THREE.Vector3(), fz = floorZ(), mz = minZ(list);
    if (Math.abs(mz - fz) < SNAP) t.z = fz - mz;
    for (const o of all) {
      if (sel.has(o)) continue;
      const c = boxOf(o);
      const near = ax => b.max[ax] > c.min[ax] - SNAP && b.min[ax] < c.max[ax] + SNAP;
      for (const ax of ["x", "y", "z"]) {
        if (!["x", "y", "z"].filter(a => a !== ax).every(near)) continue;
        const d1 = c.min[ax] - b.max[ax], d2 = c.max[ax] - b.min[ax];
        if (Math.abs(d1) < SNAP && !t[ax]) t[ax] = d1;
        else if (Math.abs(d2) < SNAP && !t[ax]) t[ax] = d2;
      }
    }
    if (t.lengthSq()) { apply(withKids(list), new THREE.Matrix4().makeTranslation(t.x, t.y, t.z)); placeHandle(); render(); }
  };
  const applySnap = () => { tc.setTranslationSnap(magnet && !alt ? 1 : null); tc.setRotationSnap(null); };   // le cran des rotations : applique ici, apres la demultiplication
  applySnap();

  // coller A contre B
  const mate = (A, B) => {
    const unit = sel.has(A.group) ? [...sel] : unitOf(A.group);
    if (unit.includes(B.group) || withKids(unit).includes(B.group)) return false;
    let q = new THREE.Quaternion(), from = A.p, to = B.p, axis;
    if (A.kind === "face" && B.kind === "face") {
      const nb = B.n.clone().negate();
      q.setFromUnitVectors(A.n, nb);
      axis = B.n.clone();
      if (A.region && B.region) {
        // assiste : les faces entieres centrees l'une sur l'autre, et leurs grands axes alignes (le plus proche des deux sens)
        from = A.region.c; to = B.region.c;
        if (A.region.elongated && B.region.elongated) {
          const ax = A.region.axis.clone().applyQuaternion(q);
          ax.addScaledVector(B.n, -ax.dot(B.n)).normalize();
          const bx = B.region.axis.clone().addScaledVector(B.n, -B.region.axis.dot(B.n)).normalize();
          let ang = Math.atan2(ax.clone().cross(bx).dot(B.n), ax.dot(bx));
          if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
          q = new THREE.Quaternion().setFromAxisAngle(B.n, ang).multiply(q);
        }
      }
    } else if (A.kind === "edge" && B.kind === "edge") {
      const eb = A.e.dot(B.e) >= 0 ? B.e.clone() : B.e.clone().negate();
      q.setFromUnitVectors(A.e, eb); axis = eb;
      if (assist) { from = A.a.clone().add(A.b).multiplyScalar(0.5); to = B.a.clone().add(B.b).multiplyScalar(0.5); }   // milieu contre milieu
    } else axis = (B.kind === "face" ? B.n : B.e).clone();
    apply(withKids(unit), new THREE.Matrix4().makeTranslation(to.x - from.x, to.y - from.y, to.z - from.z).multiply(about(from, q)));
    pivot = { p: to.clone(), axis: axis.normalize(), unit: withKids(unit) };
    // le collage, dans le repere du support (un nouveau collage de cette piece remplace l'ancien)
    B.group.updateMatrix();
    const inv = B.group.matrix.clone().invert();
    joints = joints.filter(j => !unit.includes(j.a));
    joints.push({ a: A.group, b: B.group, kind: B.kind === "edge" && A.kind === "edge" ? "edge" : "face", p: to.clone().applyMatrix4(inv),
      n: (B.kind === "face" ? B.n : B.n).clone().transformDirection(inv), e: B.kind === "edge" ? B.e.clone().transformDirection(inv) : null });
    return unit;
  };

  // le collage a plusieurs points (30/10/2026) : apres un premier collage, d'autres paires (Maj + clic, ou « Multi ») :
  // un point, une face ou une arete de la piece, puis sa cible sur le support. Chaque paire est gardee dans le repere de
  // sa piece ; a chaque ajout, la place et l'orientation qui font coincider au mieux toutes les paires (points
  // superposes, faces qui se regardent, aretes alignees) sont recalculees (methode de Horn, moindres carres)
  let pairs = [];                    // [{ ag, bg, a, b, an, bn, ae, be, kind }] (repere de ag / de bg)
  const toLocal = (g, v, dir) => { g.updateMatrix(); const inv = g.matrix.clone().invert(); return dir ? v.clone().transformDirection(inv) : v.clone().applyMatrix4(inv); };
  const toWorld = (g, v, dir) => { g.updateMatrix(); return dir ? v.clone().transformDirection(g.matrix) : v.clone().applyMatrix4(g.matrix); };
  const pairOf = (A, B, aPt, bPt) => ({ ag: A.group, bg: B.group, kind: A.kind === "edge" && B.kind === "edge" ? "edge" : A.kind === "face" && B.kind === "face" ? "face" : "point",
    a: toLocal(A.group, aPt), b: toLocal(B.group, bPt), an: A.n ? toLocal(A.group, A.n, true) : null, bn: B.n ? toLocal(B.group, B.n, true) : null,
    ae: A.e ? toLocal(A.group, A.e, true) : null, be: B.e ? toLocal(B.group, B.e, true) : null });
  // la rotation R et la translation t qui menent au mieux les points a vers b (et les directions da vers db)
  const horn = (pts, dirs) => {
    const ca = new THREE.Vector3(), cb = new THREE.Vector3();
    pts.forEach(([a, b]) => { ca.add(a); cb.add(b); }); ca.divideScalar(pts.length); cb.divideScalar(pts.length);
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const acc = (a, b, w) => { const A = [a.x, a.y, a.z], Bv = [b.x, b.y, b.z]; for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) S[i][k] += w * A[i] * Bv[k]; };
    pts.forEach(([a, b]) => acc(a.clone().sub(ca), b.clone().sub(cb), 1));
    dirs.forEach(([a, b, w]) => acc(a, b, w));
    const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
    const N = [[xx + yy + zz, yz - zy, zx - xz, xy - yx], [yz - zy, xx - yy - zz, xy + yx, zx + xz],
      [zx - xz, xy + yx, -xx + yy - zz, yz + zy], [xy - yx, zx + xz, yz + zy, -xx - yy + zz]];
    // le plus grand vecteur propre, par puissances iterees (decale pour etre positif)
    const sh = N.flat().reduce((s, v) => s + Math.abs(v), 0) + 1e-9;
    let q = [1, 0, 0, 0];
    for (let it = 0; it < 200; it++) {
      const r = N.map((row, i) => row.reduce((s, v, k) => s + v * q[k], 0) + sh * q[i]);
      const n = Math.hypot(...r) || 1;
      q = r.map(v => v / n);
    }
    const Q = new THREE.Quaternion(q[1], q[2], q[3], q[0]).normalize();
    const t = cb.clone().sub(ca.clone().applyQuaternion(Q));
    return new THREE.Matrix4().makeRotationFromQuaternion(Q).setPosition(t);
  };
  const solvePairs = unit => {
    const pts = [], dirs = [];
    const L = Math.max(10, boxOfAll(unit).getSize(new THREE.Vector3()).length());
    for (const p of pairs) {
      const a = toWorld(p.ag, p.a), b = toWorld(p.bg, p.b);
      pts.push([a, b]);
      if (p.kind === "face" && p.an && p.bn) dirs.push([toWorld(p.ag, p.an, true), toWorld(p.bg, p.bn, true).negate(), L * L * 0.5]);
      if (p.kind === "edge" && p.ae && p.be) {
        const ea = toWorld(p.ag, p.ae, true), eb = toWorld(p.bg, p.be, true);
        dirs.push([ea, ea.dot(eb) >= 0 ? eb : eb.negate(), L * L * 0.5]);
      }
    }
    // une seule paire de points : rien a orienter ; deux points seuls : l'axe qui les joint, le reste garde
    if (pts.length < 2 && !dirs.length) return;
    apply(withKids(unit), horn(pts, dirs));
  };

  // le mode « Points » (30/10/2026) : des paires numerotees, 1 avec 1, 2 avec 2… Un clic sur la piece a deplacer (son
  // point n), puis un clic sur la cible (son point n), et ainsi de suite ; chaque point porte son numero (orange sur la
  // piece, vert sur la cible). « Assembler » fait coincider toutes les paires (les faces cliquees se regardent, a peine
  // pondere : ce sont les points qui decident)
  const pins = { A: null, B: null, a: [], b: [] };         // a, b : [{ g, p, n }] (repere de la piece cliquee)
  const pinMarks = new THREE.Group(); pinMarks.renderOrder = 1000; holder.add(pinMarks);
  const label = (txt, color) => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    x.fillStyle = color; x.beginPath(); x.arc(32, 32, 28, 0, Math.PI * 2); x.fill();
    x.lineWidth = 4; x.strokeStyle = "#fff"; x.stroke();
    x.fillStyle = "#fff"; x.font = "bold 34px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(txt, 32, 34);
    const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
    const s = new THREE.Sprite(m); s.renderOrder = 1000; return s;
  };
  const drawPins = () => {
    pinMarks.children.slice().forEach(s => { s.material.map.dispose(); s.material.dispose(); pinMarks.remove(s); });
    const L = Math.max(10, boxOfAll(all.filter(g => g.visible)).getSize(new THREE.Vector3()).length());
    const put = (list, color) => list.forEach((q, i) => {
      const s = label(String(i + 1), color);
      s.position.copy(toWorld(q.g, q.p)); s.scale.setScalar(L * 0.025); pinMarks.add(s);
    });
    put(pins.a, "#f97316"); put(pins.b, "#16a34a");
    render();
  };
  const pinsClear = () => { pins.A = null; pins.B = null; pins.a = []; pins.b = []; drawPins(); };
  const pinsApply = () => {
    const n = Math.min(pins.a.length, pins.b.length);
    if (!n || !pins.A) return;
    const unit = unitOf(pins.A);
    const L = Math.max(10, boxOfAll(unit).getSize(new THREE.Vector3()).length());
    const pts = [], dirs = [];
    for (let i = 0; i < n; i++) {
      const a = pins.a[i], b = pins.b[i];
      pts.push([toWorld(a.g, a.p), toWorld(b.g, b.p)]);
      // les faces cliquees se regardent, un peu seulement (avec un ou deux points, c'est ce qui fixe le reste)
      if (a.n && b.n) dirs.push([toWorld(a.g, a.n, true), toWorld(b.g, b.n, true).negate(), L * L * (n >= 3 ? 0.02 : 0.2)]);
    }
    apply(withKids(unit), horn(pts, dirs));
    // collee a la cible par la premiere paire (elle coulisse et tourne ensuite comme une piece collee)
    const b0 = pins.b[0];
    if (b0.n) {
      joints = joints.filter(j => !unit.includes(j.a));
      joints.push({ a: pins.a[0].g, b: b0.g, kind: "face", p: b0.p.clone(), n: b0.n.clone(), e: null });
    }
    const err = Math.max(...pts.map((_, i) => toWorld(pins.a[i].g, pins.a[i].p).distanceTo(toWorld(pins.b[i].g, pins.b[i].p))));
    pinsClear(); push(); setSel(unit);
    if (n >= 3) egg("tenon_mortaise");
    const f = v => String(Math.round(v * 10) / 10).replace(".", ",");
    fitMsg = `Assemblée sur ${n} point${n > 1 ? "s" : ""}${n > 1 ? ` · écart le plus grand : ${f(err)} mm` : ""}${n < 3 ? " · 3 points fixent tout à fait l'orientation" : ""}`;
    onChange?.(state());
  };

  let ground3 = false, gPts = [], gUnit = [];
  const groundMarks = new THREE.Group(); groundMarks.renderOrder = 1000; holder.add(groundMarks);
  const drawGround = () => {
    groundMarks.children.slice().forEach(sp => { sp.material.map.dispose(); sp.material.dispose(); groundMarks.remove(sp); });
    const L = Math.max(10, boxOfAll(all.filter(g => g.visible)).getSize(new THREE.Vector3()).length());
    gPts.forEach((pt, i) => { const sp = label(String(i + 1), "#0EA5E9"); sp.position.copy(pt); sp.scale.setScalar(L * 0.025); groundMarks.add(sp); });
    render();
  };

  let down = null;
  // un tap se distingue d'un glisser (un doigt bouge plus qu'une souris) ; un geste a deux doigts (zoomer, deplacer la
  // vue) n'est jamais un tap, meme quand un doigt se releve sans avoir bouge
  let fingers = 0, several = false;
  const onDown = ev => { fingers++; if (fingers > 1) several = true; down = [ev.clientX, ev.clientY]; };
  const onCancel = () => { fingers = Math.max(0, fingers - 1); if (!fingers) several = false; down = null; };
  const onUp = ev => {
    fingers = Math.max(0, fingers - 1);
    if (several) { if (!fingers) several = false; down = null; return; }
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > (coarse ? 10 : 4) || tc.dragging) { down = null; return; }   // un glisser : la vue tourne
    down = null;
    const pick = pickAt(ev);
    // un clic sur la poignee ; ses zones invisibles debordent : dans le vide, le clic desselectionne quand meme (30/10/2026)
    if (tc.axis && pick) return;
    if (mode === "move" || mode === "rotate") {
      if (!pick) { if (!ev.ctrlKey && !ev.shiftKey && !multi) setSel([]); return; }
      const unit = ev.altKey ? [pick.group] : unitOf(pick.group);
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey || multi) {
        const on = unit.every(g => sel.has(g));
        setSel(on ? [...sel].filter(g => !unit.includes(g)) : [...sel, ...unit.filter(g => !sel.has(g))]);
      } else setSel(unit);
      return;
    }
    // un clic dans le vide desselectionne, quel que soit le mode (30/10/2026)
    if (!pick) { if (!ev.ctrlKey && !ev.shiftKey && !multi) { first = null; clearMarks(); setSel([]); render(); onChange?.(state()); } return; }
    if (mode === "pins") {
      const toA = pins.a.length === pins.b.length;       // le prochain point : sur la piece a deplacer, ou sur la cible
      if (toA) {
        if (pins.A && !unitOf(pins.A).includes(pick.group)) { fitMsg = `Le point ${pins.a.length + 1} se met d'abord sur la pièce à déplacer (${pins.A.userData.name})`; onChange?.(state()); return; }
        if (pins.B && unitOf(pins.B).includes(pick.group)) { fitMsg = "Ça, c'est la cible : clique d'abord la pièce à déplacer"; onChange?.(state()); return; }
        pins.A = pins.A || pick.group;
        pins.a.push({ g: pick.group, p: toLocal(pick.group, pick.p), n: pick.n ? toLocal(pick.group, pick.n, true) : null });
      } else {
        if (unitOf(pins.A).includes(pick.group)) { fitMsg = `Le point ${pins.b.length + 1} se met sur la cible, pas sur la pièce à déplacer`; onChange?.(state()); return; }
        if (pins.B && !unitOf(pins.B).includes(pick.group)) { fitMsg = `Le point ${pins.b.length + 1} se met sur la même cible (${pins.B.userData.name})`; onChange?.(state()); return; }
        pins.B = pins.B || pick.group;
        pins.b.push({ g: pick.group, p: toLocal(pick.group, pick.p), n: pick.n ? toLocal(pick.group, pick.n, true) : null });
      }
      fitMsg = null; drawPins(); onChange?.(state()); return;
    }
    if (mode === "ground" && ground3) {
      // poser au sol par 3 points (30/10/2026) : trois points de la piece qui doivent toucher le plateau ; au troisieme,
      // le plan qu'ils forment vient a plat sur le sol, la piece dessus
      if (gPts.length && !gUnit.includes(pick.group)) { fitMsg = `Les 3 points se prennent sur la même pièce (${gUnit[0].userData.name})`; onChange?.(state()); return; }
      if (!gPts.length) gUnit = sel.has(pick.group) ? [...sel] : unitOf(pick.group);
      gPts.push(pick.p.clone());
      drawGround();
      if (gPts.length < 3) { fitMsg = null; onChange?.(state()); return; }
      const [p1, p2, p3] = gPts, n = p2.clone().sub(p1).cross(p3.clone().sub(p1));
      if (n.lengthSq() < 1e-6) { gPts = []; drawGround(); fitMsg = "Ces 3 points sont alignés : choisis-en trois qui forment un triangle"; onChange?.(state()); return; }
      n.normalize();
      // la normale tournee vers l'exterieur de la piece (vers le sol a venir)
      const ctr = boxOfAll(gUnit).getCenter(new THREE.Vector3());
      if (ctr.clone().sub(p1).dot(n) > 0) n.negate();
      const moving = withKids(gUnit);
      const pts = [p1.clone(), p2.clone(), p3.clone()];
      const turn = (from, to, at) => { const M = about(at, new THREE.Quaternion().setFromUnitVectors(from, to)); apply(moving, M); pts.forEach(q => q.applyMatrix4(M)); };
      turn(n, new THREE.Vector3(0, 0, -1), p1);
      // indulgent (30/10/2026 : trois clics a peu pres sur les roues d'un tricycle) : autour de chaque clic, le point le
      // plus bas de la piece est son vrai appui ; le plan de ces trois appuis vient a plat, deux ou trois fois de suite
      const size = boxOfAll(gUnit).getSize(new THREE.Vector3()).length(), R = Math.max(3, size * 0.12);
      const verts = () => {
        const out = [], v = new THREE.Vector3();
        for (const g of gUnit) {
          g.updateMatrix();
          for (const m of g.children) {
            if (!m.isMesh || !m.geometry?.attributes?.position) continue;
            const pa = m.geometry.attributes.position.array, st = Math.max(1, Math.floor(pa.length / 3 / 60000));
            for (let i = 0; i < pa.length; i += 3 * st) out.push(v.set(pa[i], pa[i + 1], pa[i + 2]).applyMatrix4(g.matrix).clone());
          }
        }
        return out;
      };
      for (let it = 0; it < 3; it++) {
        const vs = verts();
        const low = pts.map(q => vs.filter(v => Math.hypot(v.x - q.x, v.y - q.y) <= R).reduce((m, v) => (!m || v.z < m.z ? v : m), null) || q);
        const m2 = low[1].clone().sub(low[0]).cross(low[2].clone().sub(low[0]));
        if (m2.lengthSq() < 1e-6) break;
        m2.normalize();
        if (m2.z > 0) m2.negate();                       // vers le bas
        if (m2.angleTo(new THREE.Vector3(0, 0, -1)) < 0.002) break;
        turn(m2, new THREE.Vector3(0, 0, -1), low[0]);
        pts.splice(0, 3, ...low.map(v => v.clone().applyMatrix4(about(low[0], new THREE.Quaternion().setFromUnitVectors(m2, new THREE.Vector3(0, 0, -1))))));
      }
      joints = joints.filter(j => !gUnit.includes(j.a));
      drop(gUnit); const u = gUnit; gPts = []; gUnit = []; drawGround();
      pivot = null; clearMarks(); showContact(); push(); setSel(u);
      fitMsg = "Posée au sol sur ses 3 points"; onChange?.(state()); render(); return;
    }
    if (mode === "ground") {
      const unit = sel.has(pick.group) ? [...sel] : unitOf(pick.group), moving = withKids(unit);
      if (pick.kind === "face") apply(moving, about(pick.p, new THREE.Quaternion().setFromUnitVectors(pick.n, new THREE.Vector3(0, 0, -1))));
      else {
        const h = new THREE.Vector3(pick.e.x, pick.e.y, 0);
        if (h.lengthSq() > 1e-6) apply(moving, about(pick.p, new THREE.Quaternion().setFromUnitVectors(pick.e, h.normalize())));
      }
      joints = joints.filter(j => !unit.includes(j.a));
      drop(unit); pivot = null; clearMarks(); showContact(); push(); render(); return;
    }
    if (mode === "mate") {
      if (!first) { first = pick; clearMarks(); mark(pick); onChange?.(state()); return; }
      const A = first;
      first = null; clearMarks();
      // une paire de plus pour la meme piece et le meme support (Maj, ou « Multi ») : toutes les paires a la fois
      const more = (ev.shiftKey || multi) && pairs.length && unitOf(pairs[0].ag).includes(A.group) && pick.group === pairs[0].bg;
      if (more) {
        pairs.push(pairOf(A, pick, A.p, pick.p));
        const unit = unitOf(pairs[0].ag);
        solvePairs(unit);
        pivot = null; push(); setSel(unit);
        fitMsg = `Collée en ${pairs.length} points : l'orientation suit toutes les paires (Maj + clic : une de plus)`;
        render(); onChange?.(state());
        return;
      }
      const unit = mate(A, pick);
      if (unit) {
        // la premiere paire : le point de la piece, la ou il est venu (sur sa cible)
        pairs = [pairOf(A, pick, pivot ? pivot.p : pick.p, pivot ? pivot.p : pick.p)];
        push(); setSel(unit);
      }
      render(); onChange?.(state());
    }
  };
  // la selection au rectangle (30/10/2026) : en mode « ▭ Rectangle », un glisser trace un rectangle et choisit les pieces
  // dont le centre y tombe (Ctrl / Maj, ou « Multi » : les ajouter a la selection) ; la vue ne tourne pas pendant ce mode
  let boxMode = false, boxStart = null, boxDiv = null;
  const host = el.parentElement;
  const onBoxDown = ev => {
    if (!boxMode || ev.button !== 0) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    const r = el.getBoundingClientRect();
    boxStart = [ev.clientX, ev.clientY, r];
    boxDiv = document.createElement("div");
    boxDiv.style.cssText = "position:absolute;border:1.5px dashed #0EA5E9;background:rgba(14,165,233,.12);pointer-events:none;z-index:5;border-radius:4px";
    host.appendChild(boxDiv);
  };
  const onBoxMove = ev => {
    if (!boxStart || !boxDiv) return;
    const [x0, y0, r] = boxStart, hr = host.getBoundingClientRect();
    const x1 = Math.min(x0, ev.clientX), y1 = Math.min(y0, ev.clientY), x2 = Math.max(x0, ev.clientX), y2 = Math.max(y0, ev.clientY);
    Object.assign(boxDiv.style, { left: `${x1 - hr.left}px`, top: `${y1 - hr.top}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
    void r;
  };
  const onBoxUp = ev => {
    if (!boxStart) return;
    const [x0, y0, r] = boxStart;
    boxStart = null; boxDiv?.remove(); boxDiv = null;
    const x1 = Math.min(x0, ev.clientX), y1 = Math.min(y0, ev.clientY), x2 = Math.max(x0, ev.clientX), y2 = Math.max(y0, ev.clientY);
    if (x2 - x1 < 4 && y2 - y1 < 4) { if (!ev.ctrlKey && !ev.shiftKey && !multi) setSel([]); return; }
    holder.updateMatrixWorld(true);
    const inside = all.filter(g => g.visible).filter(g => {
      const c = boxOf(g).getCenter(new THREE.Vector3()).applyMatrix4(holder.matrixWorld).project(camera);
      const sx = r.left + (c.x + 1) / 2 * r.width, sy = r.top + (1 - c.y) / 2 * r.height;
      return c.z < 1 && sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2;
    });
    setSel(ev.ctrlKey || ev.shiftKey || multi ? [...new Set([...sel, ...inside])] : inside);
  };
  el.addEventListener("pointerdown", onBoxDown, true);
  window.addEventListener("pointermove", onBoxMove);
  window.addEventListener("pointerup", onBoxUp);
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointercancel", onCancel);

  // au doigt, deplacer en tirant la piece elle-meme (30/10/2026 : viser les fleches de la poignee etait penible) : en
  // mode Deplacer, un doigt pose sur une piece choisie la fait glisser a plat sur le plateau (« ⇕ Hauteur » : la monte
  // ou la descend) ; ailleurs, le doigt tourne la vue comme avant, deux doigts zooment et deplacent la vue
  let fdrag = null, vertical = false;
  const planeAt = (ev, plane) => {
    const r = el.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    holder.updateMatrixWorld(true);
    return ray.ray.clone().applyMatrix4(holder.matrixWorld.clone().invert()).intersectPlane(plane, new THREE.Vector3());
  };
  const onDragStart = ev => {
    if (!coarse || mode !== "move" || !sel.size || tc.dragging || tc.axis || fingers > 1 || boxMode) return;
    if (jointOf([...sel])) return;                    // collee : elle glisse sur son contact par la poignee
    const pick = pickAt(ev);
    if (!pick || !sel.has(pick.group)) return;
    let n = new THREE.Vector3(0, 0, 1);
    if (vertical) {                                   // un plan debout, face a l'appareil
      n = holder.worldToLocal(camera.position.clone()).sub(pick.p); n.z = 0;
      n = n.lengthSq() > 1e-9 ? n.normalize() : new THREE.Vector3(0, 1, 0);
    }
    fdrag = { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, pick.p), from: pick.p.clone(), done: new THREE.Vector3(), id: ev.pointerId, moved: false };
    controls.enabled = false;
  };
  const endDrag = () => {
    if (!fdrag) return;
    const moved = fdrag.moved;
    fdrag = null; controls.enabled = !boxMode;
    if (moved) { placeHandle(); push(); render(); }
  };
  const onDragMove = ev => {
    if (!fdrag || ev.pointerId !== fdrag.id) return;
    if (fingers > 1) { endDrag(); return; }           // un second doigt : c'est la vue qu'on veut bouger
    const q = planeAt(ev, fdrag.plane);
    if (!q) return;
    const want = q.sub(fdrag.from);
    if (vertical) { want.x = 0; want.y = 0; } else want.z = 0;
    if (magnet) want.set(Math.round(want.x), Math.round(want.y), Math.round(want.z));
    const step = want.clone().sub(fdrag.done);
    if (step.lengthSq() < 1e-8) return;
    apply(withKids([...sel]), new THREE.Matrix4().makeTranslation(step.x, step.y, step.z));
    fdrag.done.copy(want); fdrag.moved = true; placeHandle(); render();
  };
  const onDragEnd = ev => { if (fdrag && ev.pointerId === fdrag.id) endDrag(); };
  el.addEventListener("pointerdown", onDragStart);
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
  window.addEventListener("pointercancel", onDragEnd);
  el.addEventListener("pointerup", onUp);
  let slide = null;
  const rayHolder = ev => {
    const r = el.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    holder.updateMatrixWorld(true);
    const inv = holder.matrixWorld.clone().invert();
    return new THREE.Ray(ray.ray.origin.clone().applyMatrix4(inv), ray.ray.direction.clone().transformDirection(inv));
  };
  const onSlideDown = ev => {
    if (ev.button !== 0 || !sel.size || tc.axis) return;
    const j = jointOf([...sel]);
    if (!j) return;
    const pick = pickAt(ev);
    if (!pick || !sel.has(pick.group)) return;
    const { P, N, E } = contact(j);
    // le plan du glisser : celui du contact ; pour une arete, le plan qui la contient face a l'oeil
    let pn = N.clone();
    if (j.kind === "edge" && E) {
      const eye = holder.worldToLocal(camera.position.clone()).sub(P);
      pn = eye.sub(E.clone().multiplyScalar(eye.dot(E))).normalize();
    }
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(pn, P);
    const p0 = rayHolder(ev).intersectPlane(plane, new THREE.Vector3());
    if (!p0) return;
    controls.enabled = false;                         // ce glisser n'est pas pour la vue
    const moving = withKids([...sel]);
    slide = { j, P, N, E, plane, p0, x0: ev.clientX, rot: ev.shiftKey || turnGlued, start: moving.map(g => [g, g.matrix.clone()]), d: new THREE.Vector3(), ang: 0 };
  };
  const onSlideMove = ev => {
    if (!slide) return;
    const s = slide;
    let M;
    if (s.rot) {
      // tourner autour du contact : 0,5° par pixel, au cran choisi (Alt : libre)
      let ang = (ev.clientX - s.x0) * 0.5;
      if (rotStep && !ev.altKey) ang = Math.round(ang / rotStep) * rotStep;
      s.ang = ang; liveAngle = Math.round(ang * 10) / 10; onChange?.(state());
      M = about(s.P, new THREE.Quaternion().setFromAxisAngle(s.E || s.N, THREE.MathUtils.degToRad(ang)));
    } else {
      const p = rayHolder(ev).intersectPlane(s.plane, new THREE.Vector3());
      if (!p) return;
      const d = p.sub(s.p0);
      if (s.E) d.copy(s.E).multiplyScalar(d.dot(s.E)); else d.addScaledVector(s.N, -d.dot(s.N));
      if (magnet && !ev.altKey) d.set(Math.round(d.x), Math.round(d.y), Math.round(d.z));
      s.d.copy(d);
      M = new THREE.Matrix4().makeTranslation(d.x, d.y, d.z);
    }
    if (guard && collider) {
      // la position voulue traverse-t-elle une autre piece ? (le contact colle lui-meme ne compte pas : 0,05 mm de jeu)
      const lift = s.E ? new THREE.Matrix4() : new THREE.Matrix4().makeTranslation(s.N.x * 0.05, s.N.y * 0.05, s.N.z * 0.05);
      const cand = s.start.map(([g, m0]) => [g, lift.clone().multiply(M).multiply(m0)]);
      if (collider.anyTouch(cand, all.filter(g => !s.start.some(([x]) => x === g)))) return;     // reste a la derniere place libre
    }
    for (const [g, m0] of s.start) { M.clone().multiply(m0).decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }
    render();
  };
  const onSlideUp = () => {
    if (!slide) return;
    const s = slide;
    slide = null;
    controls.enabled = true;
    if (!s.rot && s.d.lengthSq()) {
      // le point de contact suit la piece (dans le repere du support)
      s.j.b.updateMatrix();
      s.j.p.add(s.d.clone().transformDirection(s.j.b.matrix.clone().invert()).multiplyScalar(s.d.length()));
    }
    liveAngle = null;
    if (!s.rot && s.d.lengthSq()) egg("glissade");
    if (s.d.lengthSq() || s.ang) { showContact(); push(); } else onChange?.(state());
  };
  el.addEventListener("pointerdown", onSlideDown, true);
  window.addEventListener("pointermove", onSlideMove);
  window.addEventListener("pointerup", onSlideUp);
  const rotateSel = (axis, deg) => {
    if (!sel.size) return;
    const c = boxOfAll([...sel]).getCenter(new THREE.Vector3());
    const v = new THREE.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
    apply(withKids([...sel]), about(c, new THREE.Quaternion().setFromAxisAngle(v, THREE.MathUtils.degToRad(deg))));
    placeHandle(); push(); render();
  };
  // cadrer la vue sur la selection (ou sur tout)
  const frame = () => {
    const b = boxOfAll(sel.size ? [...sel] : all);
    if (b.isEmpty()) return;
    holder.updateMatrixWorld(true);
    const wb = b.clone().applyMatrix4(holder.matrixWorld), sph = wb.getBoundingSphere(new THREE.Sphere());
    const dir = camera.position.clone().sub(controls.target).normalize();
    const half = Math.min(camera.fov * Math.PI / 360, Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));   // en portrait : l'horizontal
    const d = Math.max(sph.radius, 5) / Math.sin(half) * 1.2;
    controls.target.copy(sph.center); camera.position.copy(sph.center).addScaledVector(dir, d);
    camera.near = Math.max(0.1, d / 100); camera.far = d * 50; camera.updateProjectionMatrix(); controls.update(); render();
  };
  const onKeyUp = ev => { if (ev.key === "Alt" && alt) { alt = false; applySnap(); } };
  const onKey = ev => {
    if (ev.target?.closest?.("input, textarea, select")) return;
    if (ev.key === "Alt") { if (!alt) { alt = true; applySnap(); } ev.preventDefault(); return; }
    if (ev.altKey && ev.key.toLowerCase() === "h") { ev.preventDefault(); return api.showAll(); }
    // les touches de Bambu Studio : M deplacer, R tourner, F poser sur une face ; C coller, Z cadrer
    if (!ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      const k = ev.key.toLowerCase();
      if (k === "m") return api.setMode("move");
      if (k === "r") return api.setMode("rotate");
      if (k === "f") return api.setMode("ground");
      if (k === "c") return api.setMode("mate");
      if (k === "p") return api.setMode("pins");
      if (k === "z") return frame();
      if (k === "h") return api.hide();
      if (k === "enter" && mode === "pins") return pinsApply();
    }
    if (mode === "rotate" && sel.size && ev.key.startsWith("Arrow") && !ev.ctrlKey && !ev.metaKey) {
      // en mode Tourner, les fleches tournent : gauche/droite autour de Z, haut/bas autour de X ; 1° (Maj : 15°)
      ev.preventDefault();
      const d = ev.shiftKey ? 15 : 1;
      if (ev.key === "ArrowLeft") rotateSel("z", d); else if (ev.key === "ArrowRight") rotateSel("z", -d);
      else if (ev.key === "ArrowUp") rotateSel("x", d); else if (ev.key === "ArrowDown") rotateSel("x", -d);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? api.redo() : api.undo(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") { ev.preventDefault(); api.redo(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "g") { ev.preventDefault(); ev.shiftKey ? api.ungroup() : api.group(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") { ev.preventDefault(); setSel(all); }
    else if (ev.key === "Escape") {
      // Echap desselectionne, sans rien fermer d'autre (30/10/2026 : la fenetre de la fiche se fermait avec)
      ev.preventDefault(); ev.stopImmediatePropagation();
      first = null; clearMarks(); setSel([]); render(); onChange?.(state());
    }
    else if (sel.size && ev.key.startsWith("Arrow")) {
      // les fleches : 1 mm (10 avec Maj) ; haut/bas avec Ctrl : monter/descendre
      ev.preventDefault();
      const s = ev.shiftKey ? 10 : 1, t = new THREE.Vector3();
      if (ev.ctrlKey || ev.metaKey) t.z = ev.key === "ArrowUp" ? s : ev.key === "ArrowDown" ? -s : 0;
      else { t.x = ev.key === "ArrowRight" ? s : ev.key === "ArrowLeft" ? -s : 0; t.y = ev.key === "ArrowUp" ? s : ev.key === "ArrowDown" ? -s : 0; }
      apply(withKids([...sel]), new THREE.Matrix4().makeTranslation(t.x, t.y, t.z)); placeHandle(); push(); render();
    }
  };
  window.addEventListener("keydown", onKey, true);   // avant les autres (Echap ne doit fermer que la selection)
  window.addEventListener("keyup", onKeyUp);
  const onBlur = () => { if (alt) { alt = false; applySnap(); } };
  window.addEventListener("blur", onBlur);

  const api = {
    setGround3: on => { ground3 = on; gPts = []; gUnit = []; drawGround(); onChange?.(state()); },
    setMode: m => { if (m !== "pins") pinsClear(); if (m !== "ground") { gPts = []; gUnit = []; drawGround(); } mode = m; first = null; if (m !== "mate") pairs = []; pivot = m === "mate" ? pivot : null; clearMarks(); placeHandle(); shade(); render(); onChange?.(state()); },
    setMagnet: on => { magnet = on; applySnap(); onChange?.(state()); },
    setRotStep: d => { rotStep = d; applySnap(); onChange?.(state()); },
    setMulti: on => { multi = on; onChange?.(state()); },
    // au doigt : glisser monte ou descend la piece au lieu de la faire glisser a plat
    setVertical: on => { vertical = on; onChange?.(state()); },
    // un pas de cote, en avant, en hauteur, d'apres l'ecran : droite / loin / haut (r, f, u : -1, 0 ou 1), de s mm ;
    // suivant l'axe du plateau le plus proche de la direction vue (un pas net, en X ou en Y)
    nudge: (r, f, u, s = 1) => {
      if (!sel.size) return;
      holder.updateMatrixWorld(true);
      const inv = new THREE.Matrix3().setFromMatrix4(holder.matrixWorld).invert();
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).applyMatrix3(inv);
      const fwd = camera.getWorldDirection(new THREE.Vector3()).applyMatrix3(inv);
      const axis = v => (Math.abs(v.x) >= Math.abs(v.y) ? new THREE.Vector3(Math.sign(v.x) || 1, 0, 0) : new THREE.Vector3(0, Math.sign(v.y) || 1, 0));
      const t = new THREE.Vector3().addScaledVector(axis(right), r * s).addScaledVector(axis(fwd), f * s);
      t.z += u * s;
      apply(withKids([...sel]), new THREE.Matrix4().makeTranslation(t.x, t.y, t.z)); placeHandle(); push(); render();
    },
    setTurnGlued: on => { turnGlued = on; onChange?.(state()); },
    pinsApply,
    pinsUndo: () => { if (pins.a.length > pins.b.length) pins.a.pop(); else pins.b.pop(); if (!pins.a.length) pins.A = null; if (!pins.b.length) pins.B = null; drawPins(); onChange?.(state()); },
    pinsClear: () => { pinsClear(); onChange?.(state()); },
    setGuard: async on => { guard = on; if (on) await getCollider(); onChange?.(state()); },
    select: keys => setSel(keys.map(k => byKey.get(k)).filter(Boolean)),
    // separer la piece choisie : proposer (morceaux colores), puis valider ou non
    splitPreview: async () => {
      if (pendingSplit) return;
      // des pieces groupees (les parties d'un objet du 3MF, un groupe fait a la main) : la separation les rend
      // independantes d'un coup (30/10/2026 : « Separer » ne faisait rien sur un groupe)
      const grouped = [...sel].filter(g => groupOf(g));
      if (grouped.length) {
        const list = [...new Set(grouped.flatMap(g => groupOf(g)))];
        groups = groups.filter(gr => !gr.some(g => sel.has(g)));
        push();
        setSel(list);                                     // choisir efface le message : il vient apres
        fitMsg = `Séparée en ${list.length} pièces du 3MF : chacune se choisit et se déplace seule (✂ sur une seule pour la couper en morceaux)`;
        onChange?.(state());
        return;
      }
      if (sel.size !== 1) return;
      const pg = [...sel][0];
      const { splitPieceGeometry, buildSplitGroups } = await import("./assemblySplit");
      const comps = splitPieceGeometry(THREE, pg);
      if (!comps) { fitMsg = "Cette pièce est d'un seul tenant : rien à séparer"; onChange?.(state()); return; }
      const pieceParts = buildSplitGroups(THREE, pg, comps);
      const tints = [0xef4444, 0x22c55e, 0x3b82f6, 0xf59e0b, 0xa855f7, 0x06b6d4, 0xec4899, 0x84cc16];
      pieceParts.forEach((g, i) => { holder.add(g); g.children.forEach(m => { m.material.emissive = new THREE.Color(tints[i % tints.length]); m.material.emissiveIntensity = 0.55; }); });
      pg.visible = false;
      pendingSplit = { pg, groups: pieceParts };
      tc.detach(); render(); onChange?.(state());
    },
    splitCancel: () => {
      if (!pendingSplit) return;
      const { pg, groups } = pendingSplit;
      groups.forEach(g => { holder.remove(g); g.children.forEach(m => { m.geometry.dispose(); m.material.dispose(); }); });
      pg.visible = true; pendingSplit = null; placeHandle(); render(); onChange?.(state());
    },
    splitConfirm: () => {
      if (!pendingSplit) return;
      const { pg, groups: parts } = pendingSplit;
      pendingSplit = null;
      parts.forEach(g => g.children.forEach(m => {           // leur couleur d'origine
        const src = pg.children.find(x => x.isMesh && x.material.color.equals(m.material.color));
        m.material.emissive = src ? src.material.emissive.clone() : new THREE.Color(0); m.material.emissiveIntensity = src ? src.material.emissiveIntensity : 1;
      }));
      holder.remove(pg); pieces.delete(pg.userData.pid);
      parts.forEach(g => pieces.set(g.userData.pid, g));
      reindex();
      // groupes et collages de la piece : repris par ses morceaux (le plus gros pour un collage)
      groups = groups.map(gr => gr.flatMap(g => (g === pg ? parts : [g])));
      joints = joints.map(j => ({ ...j, a: j.a === pg ? parts[0] : j.a, b: j.b === pg ? parts[0] : j.b }));
      undo.length = 0; redo.length = 0; last = snapshot(); changes++;   // l'historique repart d'ici
      egg("puzzle_3d");
      setSel(parts);
    },
    // remettre une piece separee d'un seul tenant
    reunite: () => {
      const from = [...sel].map(g => g.userData.from).find(Boolean);
      if (!from) return;
      const parts = all.filter(g => g.userData.from === from);
      const g0 = parts[0], whole = new THREE.Group();
      const pc = g0.userData.parentC || new THREE.Vector3();
      for (const g of parts) {
        const cc = g.userData.c.clone().sub(pc);
        for (const m of [...g.children]) { if (m.isMesh) { m.geometry.translate(cc.x, cc.y, cc.z); m.geometry.computeBoundingSphere(); whole.add(m); } }
        holder.remove(g); pieces.delete(g.userData.pid);
      }
      const ud = { ...g0.userData, k: from, name: g0.userData.name.replace(/ · \d+$/, ""), pid: String(g0.userData.pid).replace(/:\d+$/, ""), c: pc.clone() };
      delete ud.from; delete ud.parentC;
      whole.userData = ud;
      const cc0 = g0.userData.c.clone().sub(pc);
      g0.updateMatrix();
      g0.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(-cc0.x, -cc0.y, -cc0.z)).decompose(whole.position, whole.quaternion, whole.scale);
      whole.updateMatrix();
      holder.add(whole); pieces.set(ud.pid, whole);
      reindex();
      groups = groups.map(gr => [...new Set(gr.map(g => (parts.includes(g) ? whole : g)))]).filter(gr => gr.length > 1);
      joints = joints.map(j => ({ ...j, a: parts.includes(j.a) ? whole : j.a, b: parts.includes(j.b) ? whole : j.b })).filter(j => j.a !== j.b);
      undo.length = 0; redo.length = 0; last = snapshot(); changes++;
      setSel([whole]);
    },
    rotate: rotateSel,
    // placer le centre de la selection a une position exacte (mm, repere du 3MF : Z vers le haut)
    moveTo: (x, y, z) => {
      if (!sel.size) return;
      const c = boxOfAll([...sel]).getCenter(new THREE.Vector3());
      apply(withKids([...sel]), new THREE.Matrix4().makeTranslation(x - c.x, y - c.y, z - c.z)); placeHandle(); push(); render();
    },
    frame,
    // masquer la selection, pour atteindre ce qu'elle cache (la vue seulement : rien n'est enregistre) ; Alt+H : tout
    hide: () => { if (!sel.size) return; [...sel].forEach(g => { g.visible = false; }); setSel([]); egg("cache_cache"); },
    showAll: () => { all.forEach(g => { if (!g.userData.excluded) g.visible = true; }); render(); onChange?.(state()); },
    // exclure de l'assemblage (30/10/2026) : la piece n'est plus montree, meme hors edition ; enregistre, et remise depuis
    // la liste des pieces
    exclude: keys => {
      const list = keys ? keys.map(k => byKey.get(k)).filter(Boolean) : [...sel];
      if (!list.length) return;
      list.forEach(g => { g.userData.excluded = true; g.visible = false; });
      joints = joints.filter(j => !list.includes(j.a) && !list.includes(j.b));
      setSel([...sel].filter(g => !list.includes(g))); push();
    },
    include: k => { const g = byKey.get(k); if (!g) return; g.userData.excluded = false; g.visible = true; push(); setSel([g]); },
    // masquer / montrer une piece depuis la liste (la vue seulement)
    toggleShown: k => { const g = byKey.get(k); if (!g || g.userData.excluded) return; g.visible = !g.visible; if (!g.visible) sel.delete(g); shade(); placeHandle(); render(); onChange?.(state()); },
    // un exemplaire de plus (30/10/2026 : une piece imprimee en 3 exemplaires), pose a cote ; il se deplace, se colle,
    // s'enregistre comme les autres
    copy: k => {
      const src = k ? byKey.get(k) : [...sel][0];
      if (!src || !copyPiece) return;
      const base = src.userData.copyOf || src.userData.k;
      const used = new Set(all.map(g => g.userData.k));
      let n = 1;
      while (used.has(`${base}#${n}`)) n++;
      const g = copyPiece(src, n);
      const w = boxOf(src).getSize(new THREE.Vector3());
      g.position.x += w.x + 5; g.updateMatrix();
      holder.add(g); pieces.set(g.userData.pid, g); reindex();
      resetHistory(); setSel([g]); drop([g]); placeHandle(); render(); onChange?.(state());
    },
    // retirer un exemplaire ajoute (les pieces du 3MF, elles, s'excluent)
    uncopy: k => {
      const g = byKey.get(k);
      if (!g || !g.userData.copyOf) return;
      holder.remove(g); pieces.delete(g.userData.pid); reindex();
      groups = groups.map(gr => gr.filter(x => x !== g)).filter(gr => gr.length > 1);
      joints = joints.filter(j => j.a !== g && j.b !== g);
      sel.delete(g); resetHistory(); setSel([...sel]);
    },
    excluded: () => all.filter(g => g.userData.excluded).map(g => g.userData.k),
    setAssist: on => { assist = on; onChange?.(state()); },
    group: () => {
      if (sel.size < 2) return;
      const list = [...sel];
      groups = groups.map(gr => gr.filter(g => !sel.has(g))).filter(gr => gr.length > 1);
      groups.push(list); push();
    },
    ungroup: () => { groups = groups.filter(gr => !gr.some(g => sel.has(g))); push(); },
    setBoxMode: on => { boxMode = on; controls.enabled = !on; el.style.cursor = on ? "crosshair" : ""; onChange?.(state()); },
    // grouper ce qui se touche (30/10/2026) : la selection, et de proche en proche les pieces qui la touchent (a 0,3 mm
    // pres : la piece est a peine gonflee pour le test) ; le tout devient un groupe
    groupTouching: async () => {
      if (!sel.size) return;
      fitMsg = "Recherche des pièces qui se touchent…"; onChange?.(state());
      await new Promise(r => setTimeout(r, 0));
      const col = await getCollider();
      const tris = g => g.children.reduce((t, m) => t + (m.geometry?.attributes?.position?.count || 0), 0);
      const set = new Set([...sel].flatMap(unitOf)), todo = [...set];
      const others = () => all.filter(g => g.visible && !set.has(g));
      while (todo.length) {
        const a = todo.pop(), ba = boxOf(a).expandByScalar(0.5);
        for (const b of others()) {
          if (!ba.intersectsBox(boxOf(b))) continue;
          // la plus petite des deux, gonflee, contre l'autre telle quelle
          const [p, q] = tris(a) <= tris(b) ? [a, b] : [b, a];
          p.updateMatrix(); q.updateMatrix();
          if (col.touches(p, p.matrix, q, -0.3)) { unitOf(b).forEach(g => { set.add(g); todo.push(g); }); }
          await new Promise(r => setTimeout(r, 0));
        }
      }
      const list = [...set];
      if (list.length < 2) { fitMsg = "Aucune pièce ne touche celle-ci"; onChange?.(state()); return; }
      groups = groups.filter(gr => !gr.some(g => set.has(g)));
      groups.push(list); push(); setSel(list);
      fitMsg = `Groupée avec tout ce qui la touche : ${list.length} pièces`;
      onChange?.(state());
    },
    // grouper tout ce qui est colle (30/10/2026) : la selection, et de proche en proche ce qui y est colle ou ce sur quoi
    // elle est collee (et leurs groupes) ; le tout devient un groupe, choisi
    groupGlued: () => {
      const set = new Set([...sel].flatMap(unitOf));
      for (let grew = true; grew;) {
        grew = false;
        for (const j of joints) {
          if (set.has(j.a) && !set.has(j.b)) { unitOf(j.b).forEach(g => set.add(g)); grew = true; }
          if (set.has(j.b) && !set.has(j.a)) { unitOf(j.a).forEach(g => set.add(g)); grew = true; }
        }
      }
      const list = [...set].filter(g => g.visible || !g.userData.excluded);
      if (list.length < 2) { fitMsg = "Rien n'est collé à cette pièce"; onChange?.(state()); return; }
      groups = groups.filter(gr => !gr.some(g => set.has(g)));
      groups.push(list); push(); setSel(list);
      fitMsg = `Groupée avec tout ce qui y est collé : ${list.length} pièces`;
      onChange?.(state());
    },
    undo: () => { if (!undo.length) return; redo.push(snapshot()); last = undo.pop(); restore(last); changes++; onChange?.(state()); },
    redo: () => { if (!redo.length) return; undo.push(snapshot()); last = redo.pop(); restore(last); changes++; onChange?.(state()); },
    markSaved: () => { savedAt = changes; onChange?.(state()); },
    // tourner la piece collee autour de l'axe de contact
    turn: deg => {
      if (!pivot) return;
      apply(pivot.unit, about(pivot.p, new THREE.Quaternion().setFromAxisAngle(pivot.axis, THREE.MathUtils.degToRad(deg))));
      placeHandle(); push(); render();
    },
    reset: matrices => { all.forEach((g, i) => { matrices[i].decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }); groups = []; joints = []; setSel([]); push(); },
    groups: () => groups.map(gr => gr.map(g => g.userData.k)),
    splits: () => [...new Set(all.map(g => g.userData.from).filter(Boolean))],     // les pieces separees a la main
    // decoller la selection : son collage oublie, et la piece ecartee de 2 mm
    // le meilleur ajustement (30/10/2026), apres un collage (face, points) : les faces de la piece pres du contact viennent
    // contre celles du support qui les regardent (une face ne s'apparie qu'a une face tournee vers elle : sur une surface
    // texturee, le point le plus proche tombait sur le mauvais cote), en distance point-plan (la piece glisse jusqu'a
    // epouser, au lieu de s'accrocher aux reliefs), une trentaine de fois ; puis elle recule le long du contact juste assez
    // pour ne rien traverser. Si le resultat n'est pas meilleur, ou s'il faut trop reculer, la piece reste ou elle est.
    // Leger : un millier de facettes, l'arbre de recherche des pieces deja fait pour l'anti-collision
    refine: async () => {
      const list = [...sel], j = jointOf(list);
      if (!j) { fitMsg = "Colle d'abord la pièce (Coller ou Points) : l'ajustement part de son collage"; onChange?.(state()); return; }
      const col = await getCollider();
      const moving = withKids(list), start = moving.map(g => { g.updateMatrix(); return [g, g.matrix.clone()]; });
      const sups = unitOf(j.b).filter(g => !moving.includes(g) && g.visible);
      const { P, N: Nc } = contact(j);
      const rho = Math.min(60, Math.max(8, boxOfAll(list).getSize(new THREE.Vector3()).length() * 0.5));
      // les facettes de la piece pres du contact, tournees vers le support (son dos, son relief exterieur ne comptent pas :
      // ils s'accrochaient au relief de l'autre piece et l'emmenaient de travers) : leur centre et leur normale
      const facets = [];
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (const g of moving) for (const m of g.children) {
        if (!m.isMesh || !m.geometry?.attributes?.position) continue;
        const pa = m.geometry.attributes.position.array, ix = m.geometry.index ? m.geometry.index.array : null;
        const nt = ix ? ix.length / 3 : pa.length / 9, every = Math.max(1, Math.floor(nt / 12000));
        for (let t = 0; t < nt; t += every) {
          const i0 = ix ? ix[t * 3] : t * 3, i1 = ix ? ix[t * 3 + 1] : t * 3 + 1, i2 = ix ? ix[t * 3 + 2] : t * 3 + 2;
          a.fromArray(pa, i0 * 3).applyMatrix4(g.matrix); b.fromArray(pa, i1 * 3).applyMatrix4(g.matrix); c.fromArray(pa, i2 * 3).applyMatrix4(g.matrix);
          const ctr = a.clone().add(b).add(c).divideScalar(3);
          if (ctr.distanceTo(P) > rho) continue;
          const n = b.clone().sub(a).cross(c.clone().sub(a));
          if (n.lengthSq() < 1e-12) continue;
          n.normalize();
          if (n.dot(Nc) > -0.3) continue;
          facets.push([ctr, n]);
        }
      }
      if (facets.length < 20) { fitMsg = "Trop peu de surface près du contact pour ajuster"; onChange?.(state()); return; }
      let F = facets;
      if (F.length > 400) { const k = F.length / 400; F = Array.from({ length: 400 }, (_, i) => facets[Math.floor(i * k)]); }
      // le support, seulement autour du contact (30/10/2026 : l'arbre de recherche d'un grand corps entier, 240 000
      // triangles, prenait 4 s a construire ; la zone utile, quelques milliers, se fait en un instant)
      const zone = boxOfAll(moving).expandByScalar(4), tb = new THREE.Box3();       // la place de la piece, a 4 mm pres
      const cropped = sups.map(g => {
        g.updateMatrix();
        const pos = [];
        for (const m of g.children) {
          if (!m.isMesh || !m.geometry?.attributes?.position) continue;
          const pa = m.geometry.attributes.position.array, ixx = m.geometry.index ? m.geometry.index.array : null, nt = ixx ? ixx.length / 3 : pa.length / 9;
          for (let t = 0; t < nt; t++) {
            const i0 = ixx ? ixx[t * 3] : t * 3, i1 = ixx ? ixx[t * 3 + 1] : t * 3 + 1, i2 = ixx ? ixx[t * 3 + 2] : t * 3 + 2;
            a.fromArray(pa, i0 * 3).applyMatrix4(g.matrix); b.fromArray(pa, i1 * 3).applyMatrix4(g.matrix); c.fromArray(pa, i2 * 3).applyMatrix4(g.matrix);
            if (zone.intersectsBox(tb.setFromPoints([a, b, c]))) pos.push(pa[i0 * 3], pa[i0 * 3 + 1], pa[i0 * 3 + 2], pa[i1 * 3], pa[i1 * 3 + 1], pa[i1 * 3 + 2], pa[i2 * 3], pa[i2 * 3 + 1], pa[i2 * 3 + 2]);
          }
        }
        if (!pos.length) return null;
        const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(pos), 3));
        const q2 = new THREE.Group(); q2.add(new THREE.Mesh(geo)); q2.position.copy(g.position); q2.quaternion.copy(g.quaternion); q2.scale.copy(g.scale); q2.updateMatrix();
        return q2;
      }).filter(Boolean);
      if (!cropped.length) { fitMsg = "Rien de l'autre pièce près du contact : rien à ajuster"; onChange?.(state()); return; }
      const geos = cropped.map(g => ({ geo: col.geoOf(g), m: g.matrix.clone(), inv: g.matrix.clone().invert(), nm: new THREE.Matrix3().getNormalMatrix(g.matrix) }));
      const tg = {}, q = new THREE.Vector3();
      const near = w => {
        let best = null;
        for (const s of geos) {
          const r = s.geo.boundsTree.closestPointToPoint(q.copy(w).applyMatrix4(s.inv), tg);
          if (!r || (best && r.distance >= best.d)) continue;
          const pos = s.geo.attributes.position.array, ixx = s.geo.index.array, f = r.faceIndex;
          a.fromArray(pos, ixx[f * 3] * 3); b.fromArray(pos, ixx[f * 3 + 1] * 3); c.fromArray(pos, ixx[f * 3 + 2] * 3);
          const n = b.clone().sub(a).cross(c.clone().sub(a)).applyMatrix3(s.nm).normalize();
          best = { d: r.distance, p: r.point.clone().applyMatrix4(s.m), n };
        }
        return best;
      };
      // les paires : une facette de la piece et la facette du support qui la regarde
      const pairsOf = D => {
        const nm = new THREE.Matrix3().getNormalMatrix(D), out = [];
        for (const [p0, n0] of F) {
          const w = p0.clone().applyMatrix4(D), nw = n0.clone().applyMatrix3(nm).normalize(), h = near(w);
          if (h && h.d < rho * 0.5 && nw.dot(h.n) < -0.5) out.push([w, h.p, h.n, h.d]);
        }
        return out;
      };
      const contactOf = ps => ps.filter(p => p[3] <= 0.3).length;
      let D = new THREE.Matrix4();
      const ps0 = pairsOf(D), before = ps0.length ? ps0.map(p => p[3]).sort((x, y) => x - y)[Math.floor(ps0.length / 2)] : Infinity, c0 = contactOf(ps0);
      // une iteration point-plan : petite rotation (w) et translation (t) qui rapprochent chaque point du plan de son vis-a-vis
      const solve6 = (A, g) => {
        const M = A.map((r, i) => [...r, g[i]]);
        for (let i = 0; i < 6; i++) {
          let piv = i; for (let k = i + 1; k < 6; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
          [M[i], M[piv]] = [M[piv], M[i]];
          if (Math.abs(M[i][i]) < 1e-12) return null;
          for (let k = 0; k < 6; k++) if (k !== i) { const f = M[k][i] / M[i][i]; for (let l = i; l < 7; l++) M[k][l] -= f * M[i][l]; }
        }
        return M.map((r, i) => r[6] / r[i]);
      };
      for (let it = 0; it < 20; it++) {
        const ps = pairsOf(D);
        if (ps.length < 12) break;
        const ds = ps.map(p => p[3]).sort((x, y) => x - y), med = ds[Math.floor(ds.length / 2)];
        const keep = ps.filter(p => p[3] <= Math.max(0.4, 2.5 * med));
        const cen = keep.reduce((s, p) => s.add(p[0]), new THREE.Vector3()).divideScalar(keep.length);
        const A = Array.from({ length: 6 }, () => new Array(6).fill(0)), gv = new Array(6).fill(0);
        for (const [w, bp, n] of keep) {
          const r = w.clone().sub(cen), cr = r.clone().cross(n), J = [cr.x, cr.y, cr.z, n.x, n.y, n.z], res = bp.clone().sub(w).dot(n);
          for (let i = 0; i < 6; i++) { gv[i] += J[i] * res; for (let k = 0; k < 6; k++) A[i][k] += J[i] * J[k]; }
        }
        for (let i = 0; i < 6; i++) A[i][i] += 1e-3 * keep.length;
        const x = solve6(A, gv);
        if (!x) break;
        // des pas mesures (3° et 1 mm au plus par tour) : la piece glisse, elle ne saute pas
        const wv = new THREE.Vector3(x[0], x[1], x[2]), ang = wv.length();
        const R = ang > 1e-9 ? new THREE.Matrix4().makeRotationAxis(wv.clone().normalize(), Math.min(ang, 0.05)) : new THREE.Matrix4();
        const tv = new THREE.Vector3(x[3], x[4], x[5]); if (tv.length() > 1) tv.setLength(1);
        const step = new THREE.Matrix4().makeTranslation(cen.x + tv.x, cen.y + tv.y, cen.z + tv.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-cen.x, -cen.y, -cen.z));
        D = step.multiply(D);
        if (ang < 1e-4 && Math.hypot(x[3], x[4], x[5]) < 0.003 && it > 3) break;
        if (it % 6 === 5) await new Promise(r => setTimeout(r, 0));
      }
      const ps1 = pairsOf(D), after = ps1.length ? ps1.map(p => p[3]).sort((x, y) => x - y)[Math.floor(ps1.length / 2)] : Infinity, c1 = contactOf(ps1);
      const qd = new THREE.Quaternion().setFromRotationMatrix(D), turn = 2 * Math.acos(Math.min(1, Math.abs(qd.w))) * 180 / Math.PI;
      const fmt = x => String(Math.round(x * 10) / 10).replace(".", ",");
      if (turn > 30 || !(c1 > c0 || after < before - 0.05)) { fitMsg = `Déjà au mieux (écart ${fmt(before)} mm) : rien à ajuster`; onChange?.(state()); return; }
      // reculer le long des normales du contact jusqu'a ne rien traverser (par sauts, puis au plus pres)
      const out = ps1.reduce((s, p) => s.add(p[2]), new THREE.Vector3()).normalize();
      const at = d => start.map(([g, m0]) => [g, new THREE.Matrix4().makeTranslation(out.x * d, out.y * d, out.z * d).multiply(D).multiply(m0)]);
      const hits = d => col.anyTouch(at(d), cropped, 0);
      let lo = 0, hi = 0;
      if (hits(0)) {
        hi = 0.1;
        while (hits(hi) && hi < 1.6) { lo = hi; hi *= 2; }
        if (hi < 1.6) for (let k = 0; k < 5; k++) { const mid = (lo + hi) / 2; if (hits(mid)) lo = mid; else hi = mid; }
      }
      // trop reculer, c'est que la place trouvee n'est pas la bonne : on laisse la piece ou elle etait
      if (hi > 1.5) { fitMsg = "Pas de meilleure place sans traverser l'autre pièce : la pièce reste où tu l'as collée"; onChange?.(state()); return; }
      for (const [g, m] of at(hi)) { m.decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }
      egg("sur_mesure");
      fitMsg = `Ajustée : écart ${fmt(before)} → ${fmt(after)} mm · ${c1} points en contact (avant ${c0})${hi > 0.05 ? ` · reculée de ${fmt(hi)} mm pour ne rien traverser` : ""}`;
      showContact(); placeHandle(); push(); render();
    },
    unglue: () => {
      const list = [...sel], j = jointOf(list);
      if (!j) return;
      const { N, E } = contact(j);
      joints = joints.filter(x => !list.includes(x.a));
      const away = (E ? new THREE.Vector3(0, 0, 1) : N).clone().multiplyScalar(2);
      apply(withKids(list), new THREE.Matrix4().makeTranslation(away.x, away.y, away.z));
      showContact(); placeHandle(); push(); render();
    },
    joints: () => joints.map(j => ({ a: j.a.userData.k, b: j.b.userData.k, kind: j.kind, p: j.p.toArray().map(v => Math.round(v * 1e4) / 1e4),
      n: j.n.toArray().map(v => Math.round(v * 1e6) / 1e6), ...(j.e ? { e: j.e.toArray().map(v => Math.round(v * 1e6) / 1e6) } : {}) })),
    state,
    dispose: () => {
      // pas tc.dispose() : en three 0.169 il appelle traverse, qui n'existe plus sur la poignee, et l'erreur cassait la
      // fermeture de la vue (page blanche, 29/10/2026) ; on la debranche et on libere son dessin a la main
      el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointerup", onUp); window.removeEventListener("keydown", onKey, true);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("pointerdown", onDragStart); window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", onDragEnd); window.removeEventListener("pointercancel", onDragEnd);
      el.removeEventListener("pointerdown", onBoxDown, true); window.removeEventListener("pointermove", onBoxMove); window.removeEventListener("pointerup", onBoxUp);
      boxDiv?.remove(); if (boxMode) controls.enabled = true;
      window.removeEventListener("keyup", onKeyUp); window.removeEventListener("blur", onBlur);
      el.removeEventListener("pointerdown", onSlideDown, true); window.removeEventListener("pointermove", onSlideMove); window.removeEventListener("pointerup", onSlideUp);
      holder.remove(ring); ring.geometry.dispose(); ringMat.dispose();
      try { tc.detach(); tc.disconnect(); } catch { /* deja debranchee */ }
      try { helper.traverse(o => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.dispose?.()); }); } catch { /* rien */ }
      scene.remove(helper); holder.remove(handle);
      clearMarks(); holder.remove(marks); markMat.dispose(); lineMat.dispose();
      sel.clear(); shade(); all.forEach(g => { g.visible = true; });
      controls.enabled = true; render();
    },
  };
  onChange?.(state());
  // banc d'essai seulement : une prise le long d'un rayon donne dans le repere du modele, et le collage
  if (import.meta.env.DEV) api.__dev = {
    pick: (o, d) => { holder.updateMatrixWorld(true); ray.set(o.clone().applyMatrix4(holder.matrixWorld), d.clone().transformDirection(holder.matrixWorld).normalize()); return pickRay(); },
    mate: (A, B) => { const u = mate(A, B); if (u) { push(); setSel(u); } return u; },
  };
  return api;
}
