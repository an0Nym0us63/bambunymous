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
  // l'anti-collision (29/10/2026) : une piece collee qu'on fait coulisser s'arrete au contact de la matiere ; et
  // l'emboitement, qui cherche ou la piece entre sans rien traverser
  let guard = false, fitting = null, fitMsg = null, collider = null;
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
  tc.size = 0.8;
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
    pivot: !!pivot, pairs: pairs.length, pinsA: pins.a.length, pinsB: pins.b.length,
    pinsFrom: pins.A?.userData.name || null, pinsTo: pins.B?.userData.name || null, dirty: changes !== savedAt, splitPending: pendingSplit ? pendingSplit.groups.length : 0,
    canSplit: !pendingSplit && (sel.size === 1 || [...sel].some(g => groupOf(g))), canReunite: [...sel].some(g => g.userData.from),
    canGroup: sel.size > 1 && !groups.some(gr => gr.length === sel.size && gr.every(g => sel.has(g))),
    canUngroup: [...sel].some(g => groupOf(g)), multi, turnGlued, liveAngle, guard, fitting, fitMsg,
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
    // le grand axe : la direction la plus etendue dans le plan (analyse des points de la face, en 2D)
    const u = Math.abs(n0.z) < 0.9 ? new THREE.Vector3(0, 0, 1).cross(n0).normalize() : new THREE.Vector3(1, 0, 0).cross(n0).normalize();
    const v = n0.clone().cross(u);
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { const d = p.clone().sub(c), x = d.dot(u), y = d.dot(v); sxx += x * x; syy += y * y; sxy += x * y; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const axis = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(v, Math.sin(ang)).normalize();
    const elongated = Math.abs(sxx - syy) + Math.abs(sxy) > 0.08 * (sxx + syy);       // une face ronde ou carree : pas de grand axe sur
    return { c, area, axis, n: n0, elongated, count: seen.size };
  };

  // la prise sous la souris : la piece, et sa face ou son arete (en coordonnees du support)
  const pickAt = ev => {
    const r = el.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
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
    let region = null;
    if (assist && idx) {
      const rg = regionOf(geo, hit.faceIndex);
      if (rg) region = { c: rg.c.clone().applyMatrix4(M), area: rg.area, axis: rg.axis.clone().applyMatrix3(N).normalize(), elongated: rg.elongated };
    }
    return { group: g, kind: "face", p, n, size, region };
  };

  // applique M (repere du support) a des pieces
  const apply = (list, M) => { for (const g of list) { g.updateMatrix(); M.clone().multiply(g.matrix).decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); } };
  const about = (p, q) => new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  const drop = list => { const b = boxOfAll(list); apply(list, new THREE.Matrix4().makeTranslation(0, 0, -b.min.z)); };

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
    const list = [...sel], b = boxOfAll(list), t = new THREE.Vector3();
    if (Math.abs(b.min.z) < SNAP) t.z = -b.min.z;
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
    const f = v => String(Math.round(v * 10) / 10).replace(".", ",");
    fitMsg = `Assemblée sur ${n} point${n > 1 ? "s" : ""}${n > 1 ? ` · écart le plus grand : ${f(err)} mm` : ""}${n < 3 ? " · 3 points fixent tout à fait l'orientation" : ""}`;
    onChange?.(state());
  };

  let down = null;
  const onDown = ev => { down = [ev.clientX, ev.clientY]; };
  const onUp = ev => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 4 || tc.dragging) { down = null; return; }   // un glisser : la vue tourne
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
  el.addEventListener("pointerdown", onDown);
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
  // l'emboitement (30/10/2026, refait) : autour du collage, la piece est essayee a chaque angle autour du contact (tous
  // les 15°, et de pres autour de sa position) et a chaque decalage proche ; on garde la place ou elle s'enfonce le plus
  // dans son support sans le traverser (un tenon entre dans son trou), puis on l'affine au dixieme de mm et au degre, et
  // on la centre dans le jeu. Des pieces dessinees sans jeu passent avec un leger chevauchement tolere.
  const fit = async () => {
    const list = [...sel], j = jointOf(list);
    if (fitting) return;
    if (!j || j.kind !== "face") { fitMsg = "Colle d'abord la pièce face contre face (les deux faces qui se touchent une fois emboîtées)"; onChange?.(state()); return; }
    fitting = 0; fitMsg = null; onChange?.(state());
    const col = await getCollider();
    const moving = withKids(list), start = moving.map(g => [g, g.matrix.clone()]);
    // seulement la piece support (et son groupe) : une troisieme piece qui chevauche deja, ailleurs, ne compte pas
    const others = unitOf(j.b).filter(g => !moving.includes(g) && g.visible);
    const { P, N } = contact(j);
    const u = (Math.abs(N.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).cross(N).normalize(), w = N.clone().cross(u);
    const bsz = boxOfAll(list).getSize(new THREE.Vector3());
    const R = Math.min(20, Math.max(4, bsz.length() * 0.4)), step = Math.max(0.5, R / 10);
    const depthMax = bsz.dot(new THREE.Vector3(Math.abs(N.x), Math.abs(N.y), Math.abs(N.z)));
    const mats = (ang, x, y, d) => {
      const t = u.clone().multiplyScalar(x).addScaledVector(w, y).addScaledVector(N, 0.05 - d);
      const M = new THREE.Matrix4().makeTranslation(t.x, t.y, t.z).multiply(about(P, new THREE.Quaternion().setFromAxisAngle(N, THREE.MathUtils.degToRad(ang))));
      return start.map(([g, m0]) => [g, M.clone().multiply(m0)]);
    };
    const free = (ang, x, y, d, erode = 0) => !col.anyTouch(mats(ang, x, y, d), others, erode);
    let n = 0, total = 1;
    const tick = async () => { if (++n % 15) return; fitting = Math.min(99, Math.round(100 * n / total)); onChange?.(state()); await new Promise(res => setTimeout(res, 0)); };
    // jusqu'ou la piece s'enfonce a cette place : pas a pas depuis le contact, jusqu'au premier choc, puis au plus pres
    // (30/10/2026 : une recherche par moities sautait au fond ; une piece toute entiere plongee dans une autre ne croise
    // plus aucune face, elle passait pour « libre » et finissait dans le support)
    const dStep = Math.max(0.4, depthMax / 40);
    const depthAt = async (ang, x, y, erode) => {
      let lo = 0, hi = null;
      for (let d = dStep; d <= depthMax + 1e-6; d += dStep) {
        await tick();
        if (free(ang, x, y, d, erode)) lo = d; else { hi = d; break; }
      }
      if (hi == null) return lo;
      for (let k = 0; k < 6; k++) { const mid = (lo + hi) / 2; if (free(ang, x, y, mid, erode)) lo = mid; else hi = mid; }
      return lo;
    };
    // les angles : d'abord autour de la position actuelle ; tous les 15° seulement si rien n'entre ainsi (plus rapide)
    const near = [0, -5, 5, -10, 10];
    const around = [];
    for (let a = 15; a < 360; a += 15) around.push(a > 180 ? a - 360 : a);
    const offs = [];
    for (let x = -R; x <= R + 1e-6; x += step) for (let y = -R; y <= R + 1e-6; y += step) if (Math.hypot(x, y) <= R) offs.push([x, y, Math.hypot(x, y)]);
    offs.sort((p, q) => p[2] - q[2]);
    let best = null, tol = 0, spare = null;
    for (const [extra, angs] of [[0, near], [0, around], [0.3, near], [0.8, near]]) {
      tol = extra;
      const erode = step * 0.6 + extra;
      total = angs.length * offs.length * 1.3 + 15 * 40 + 900;
      // 1. a grands pas, la piece amincie : les places ou elle entre deja un peu (sondee a quelques mm de profondeur) ;
      // a defaut, celles ou elle repose au contact (au plus 3 par angle, les plus proches)
      const probe = Math.min(depthMax * 0.5, 3);
      let cands = [];
      const touching = [];
      for (const ang of angs) {
        let k = 0;
        for (const [x, y, r] of offs) {
          await tick();
          if (free(ang, x, y, probe, erode)) cands.push({ ang, x, y, r });
          else if (k < 3 && free(ang, x, y, 0, erode)) { touching.push({ ang, x, y, r }); k++; }
        }
      }
      // rien n'entre : au passage suivant (plus d'angles, puis un peu de tolerance) ; au dernier, la place au contact
      if (!cands.length && extra === 0.8) cands = touching;
      if (!cands.length) continue;
      // les plus prometteuses seulement (proches, peu tournees) : la profondeur se mesure ensuite pour chacune
      cands.sort((p, q) => p.r + 0.05 * Math.abs(p.ang) - q.r - 0.05 * Math.abs(q.ang));
      cands = cands.slice(0, 15);
      // 2. jusqu'ou chacune s'enfonce : la plus profonde l'emporte (a peu pres egales : la plus proche, sans tourner)
      for (const c of cands) c.d = await depthAt(c.ang, c.x, c.y, erode);
      const cost = c => -c.d + 0.02 * c.r + 0.01 * Math.abs(c.ang);
      cands.sort((p, q) => cost(p) - cost(q));
      // 3. les meilleures, affinees avec la vraie piece (au chevauchement tolere) : a son angle puis a ±1, ±2, ±3°, les
      // decalages ou elle entre (sondee) sur une grille de 0,2 mm, puis de 0,05 mm autour de leur milieu ; on prend le
      // milieu de la zone libre (le tenon centre dans son trou) et on mesure jusqu'ou elle s'enfonce
      const pr = Math.min(probe, 1.5);
      const zone = (ang, cx, cy, half, st) => {
        const pts = [];
        for (let dx = -half; dx <= half + 1e-6; dx += st) for (let dy = -half; dy <= half + 1e-6; dy += st) {
          n++;
          if (free(ang, cx + dx, cy + dy, pr, extra)) pts.push([cx + dx, cy + dy]);
        }
        if (!pts.length) return null;
        return [pts.reduce((v, p) => v + p[0], 0) / pts.length, pts.reduce((v, p) => v + p[1], 0) / pts.length];
      };
      for (const c of cands.slice(0, 4)) {
        for (const da of [0, -1, 1, -2, 2, -3, 3]) {
          const ang = c.ang + da;
          await tick();
          let m = zone(ang, c.x, c.y, step, 0.2);
          if (!m) continue;
          m = zone(ang, m[0], m[1], 0.3, 0.05) || m;
          if (!free(ang, m[0], m[1], pr, extra)) continue;
          const cur = { ang, x: m[0], y: m[1], r: Math.hypot(m[0], m[1]), d: await depthAt(ang, m[0], m[1], extra) };
          // vraiment emboitee : enfoncee, elle est tenue de trois cotes au moins (decalee d'1 mm, elle touche) ; sinon elle
          // n'a fait que glisser le long du support (posee au bord)
          if (cur.d > 0.5) {
            const dz = cur.d * 0.5;
            const held = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => !free(ang, m[0] + a, m[1] + b, dz, extra)).length;
            if (held < 3) cur.d = 0;
          }
          if (!best || cost(cur) < cost(best)) best = cur;
          break;
        }
      }
      // rien n'entre, meme de peu, et plus de tolerance a essayer : la meilleure place au contact
      if (!best && extra === 0.8) {
        const c = cands[0];
        if (free(c.ang, c.x, c.y, 0, extra)) best = { ...c, d: 0 };
      }
      // vraiment entree : c'est fini ; sinon, gardee en reserve, et on cherche plus loin (tous les angles, la tolerance)
      if (best && best.d > 0.5) break;
      if (best && (!spare || best.d > spare.d)) spare = { ...best, tol };
      best = null;
    }
    if (!best && spare) { best = spare; tol = spare.tol; }
    if (!best) { fitting = null; fitMsg = `Aucune place à moins de ${Math.round(R)} mm où ${j.b.userData.name || "le support"} ne soit pas traversé : rapproche la pièce de son logement, ou colle-la sur la face d'appui (l'épaulement), pas sur le bout du tenon`; onChange?.(state()); return; }
    const depth = best.d > 0.15 ? best.d - 0.1 : 0;
    for (const [g, m] of mats(best.ang, best.x, best.y, depth)) { m.decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }
    // le contact suit la piece (dans le repere du support)
    j.b.updateMatrix();
    const t = u.clone().multiplyScalar(best.x).addScaledVector(w, best.y).addScaledVector(N, 0.05 - depth);
    j.p.add(t.clone().transformDirection(j.b.matrix.clone().invert()).multiplyScalar(t.length()));
    fitting = null;
    const f = v => String(Math.round(v * 10) / 10).replace(".", ",");
    const ang = Math.round(((best.ang % 360) + 540) % 360 - 180);
    egg("tenon_mortaise");
    fitMsg = `${depth ? "Emboîtée" : `Aucun logement où elle entre à moins de ${Math.round(R)} mm : posée au contact`}${best.r > 0.05 ? ` · décalée de ${f(best.r)} mm` : ""}${ang ? ` · tournée de ${ang}°` : ""}${depth ? ` · enfoncée de ${f(depth)} mm` : ""}${tol && depth ? ` · pièces sans jeu : ${f(tol)} mm de chevauchement toléré` : ""}`;
    showContact(); placeHandle(); push(); render();
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
    const d = Math.max(sph.radius, 5) / Math.sin((camera.fov * Math.PI) / 360) * 1.2;
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
      if (k === "e") return fit();
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
    setMode: m => { if (m !== "pins") pinsClear(); mode = m; first = null; if (m !== "mate") pairs = []; pivot = m === "mate" ? pivot : null; clearMarks(); placeHandle(); shade(); render(); onChange?.(state()); },
    setMagnet: on => { magnet = on; applySnap(); onChange?.(state()); },
    setRotStep: d => { rotStep = d; applySnap(); onChange?.(state()); },
    setMulti: on => { multi = on; onChange?.(state()); },
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
    fit,
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
  return api;
}
