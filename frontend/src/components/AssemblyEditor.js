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
    if (e.value) { handle.updateMatrix(); dragStart = { h: handle.matrix.clone(), m: withKids([...sel]).map(g => [g, g.matrix.clone()]) }; }
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
      const q = handle.quaternion, ang = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
      if (ang > 1e-6) {
        const ax = new THREE.Vector3(q.x, q.y, q.z).normalize().multiplyScalar(Math.sign(q.w) || 1);
        let a = THREE.MathUtils.radToDeg(ang * ROT_GAIN);
        if (rotStep && !alt) a = Math.round(a / rotStep) * rotStep;
        handle.quaternion.setFromAxisAngle(ax, THREE.MathUtils.degToRad(a));
        liveAngle = Math.round(a * 10) / 10;
        onChange?.(state());
      }
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
    pivot: !!pivot, dirty: changes !== savedAt, splitPending: pendingSplit ? pendingSplit.groups.length : 0,
    canSplit: sel.size === 1 && !pendingSplit, canReunite: [...sel].some(g => g.userData.from),
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
  const applySnap = () => { tc.setTranslationSnap(magnet && !alt ? 1 : null); tc.setRotationSnap(rotStep && !alt ? THREE.MathUtils.degToRad(rotStep) : null); };
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
      const unit = mate(A, pick);
      if (unit) { push(); setSel(unit); }
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
  // emboiter la selection collee : la place la plus proche (decalage dans le plan du contact, quart de tour autour de
  // la normale) ou elle repose sur le contact sans traverser la matiere, puis aussi loin que possible vers l'interieur
  const fit = async () => {
    const list = [...sel], j = jointOf(list);
    if (fitting) return;
    if (!j || j.kind !== "face") { fitMsg = "Colle d'abord la pièce face contre face (les deux faces qui se touchent une fois emboîtées)"; onChange?.(state()); return; }
    fitting = 0; fitMsg = null; onChange?.(state());
    const col = await getCollider();
    const moving = withKids(list), start = moving.map(g => [g, g.matrix.clone()]);
    // seulement la piece support (et son groupe) : une troisieme piece qui chevauche deja, ailleurs, empechait toute place
    // libre (30/10/2026 : « aucune place libre a moins de 20 mm » a chaque fois)
    const others = unitOf(j.b).filter(g => !moving.includes(g) && g.visible);
    const { P, N } = contact(j);
    const u = (Math.abs(N.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).cross(N).normalize(), w = N.clone().cross(u);
    const sz = boxOfAll(list).getSize(new THREE.Vector3()).length();
    const R = Math.min(20, Math.max(4, sz * 0.4)), step = Math.max(0.5, R / 20);
    const mats = (ang, x, y, d) => {
      const t = u.clone().multiplyScalar(x).addScaledVector(w, y).addScaledVector(N, 0.05 - d);
      const M = new THREE.Matrix4().makeTranslation(t.x, t.y, t.z).multiply(about(P, new THREE.Quaternion().setFromAxisAngle(N, THREE.MathUtils.degToRad(ang))));
      return start.map(([g, m0]) => [g, M.clone().multiply(m0)]);
    };
    const free = (ang, x, y, d, erode = 0) => !col.anyTouch(mats(ang, x, y, d), others, erode);
    const tick = async (n, total) => { fitting = Math.min(99, Math.round(100 * n / total)); onChange?.(state()); await new Promise(res => setTimeout(res, 0)); };
    let best = null, tol = 0;
    if (free(0, 0, 0, 0)) best = { ang: 0, x: 0, y: 0, r: 0 };            // deja bien place
    // des pieces dessinees sans jeu (le tenon de la taille exacte du trou) ne sont jamais « libres » : on tolere
    // ensuite un leger chevauchement (la surface rentree de 0,3 puis 0,8 mm)
    for (const extra of [0, 0.3, 0.8]) {
      if (best) break;
      tol = extra;
      // 1. a grands pas, la piece amincie (sa surface rentree d'un peu plus d'un demi-pas) : le pas peut tomber dans
      // le jeu d'un emboitement (0,2 mm) ; la place libre la plus proche pour chaque quart de tour
      const erode = step * 0.6 + extra;
      const offs = [];
      for (let x = -R; x <= R + 1e-6; x += step) for (let y = -R; y <= R + 1e-6; y += step) if (Math.hypot(x, y) <= R) offs.push([x, y, Math.hypot(x, y)]);
      offs.sort((p, q) => p[2] - q[2]);
      const coarse = [];
      let n = 0;
      for (const ang of [0, 90, 180, 270]) {
        for (const [x, y, r] of offs) {
          n++;
          if (free(ang, x, y, 0, erode)) { coarse.push({ ang, x, y, r: r + (ang ? 0.01 : 0) }); break; }
          if (n % 20 === 0) await tick(n, offs.length * 4 + 900);
        }
      }
      coarse.sort((p, q) => (p.ang !== 0) - (q.ang !== 0) || p.r - q.r);     // sans tourner, si ca entre
      // 2. au dixieme de mm, la vraie piece, autour de chaque place trouvee : le centre de la zone libre (le tenon
      // centre dans son trou)
      for (const c of coarse) {
        const pts = [];
        for (let dx = -step; dx <= step + 1e-6; dx += 0.1) for (let dy = -step; dy <= step + 1e-6; dy += 0.1) {
          n++;
          if (free(c.ang, c.x + dx, c.y + dy, 0, extra)) pts.push([c.x + dx, c.y + dy]);
          if (n % 20 === 0) await tick(n, offs.length * 4 + 900);
        }
        if (!pts.length) continue;
        let cx = pts.reduce((v, p) => v + p[0], 0) / pts.length, cy = pts.reduce((v, p) => v + p[1], 0) / pts.length;
        if (!free(c.ang, cx, cy, 0, extra)) [cx, cy] = pts.reduce((m, p) => (Math.hypot(p[0] - cx, p[1] - cy) < Math.hypot(m[0] - cx, m[1] - cy) ? p : m));
        best = { ang: c.ang, x: cx, y: cy, r: Math.hypot(cx, cy) };
        break;
      }
    }
    if (!best) { fitting = null; fitMsg = `Aucune place à moins de ${Math.round(R)} mm où ${j.b.userData.name || "le support"} ne soit pas traversé : rapproche la pièce de son logement, ou colle-la sur la face d'appui (l'épaulement), pas sur le bout du tenon`; onChange?.(state()); return; }
    // puis aussi loin que possible vers l'interieur (une piece qui entre dans un logement)
    const depthMax = boxOfAll(list).getSize(new THREE.Vector3()).dot(new THREE.Vector3(Math.abs(N.x), Math.abs(N.y), Math.abs(N.z)));
    let lo = 0, hi = depthMax;
    if (!free(best.ang, best.x, best.y, hi, tol)) for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (free(best.ang, best.x, best.y, mid, tol)) lo = mid; else hi = mid; }
    else lo = hi;
    const depth = lo > 0.15 ? lo - 0.1 : 0;
    for (const [g, m] of mats(best.ang, best.x, best.y, depth)) { m.decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }
    // le contact suit la piece (dans le repere du support)
    j.b.updateMatrix();
    const t = u.clone().multiplyScalar(best.x).addScaledVector(w, best.y).addScaledVector(N, 0.05 - depth);
    j.p.add(t.clone().transformDirection(j.b.matrix.clone().invert()).multiplyScalar(t.length()));
    fitting = null;
    const f = v => String(Math.round(v * 10) / 10).replace(".", ",");
    egg("tenon_mortaise");
    fitMsg = `Emboîtée${best.r > 0.05 ? ` · décalée de ${f(Math.hypot(best.x, best.y))} mm` : ""}${best.ang ? ` · tournée de ${best.ang}°` : ""}${depth ? ` · enfoncée de ${f(depth)} mm` : ""}${tol ? ` · pièces sans jeu : ${f(tol)} mm de chevauchement toléré` : ""}`;
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
      if (k === "z") return frame();
      if (k === "h") return api.hide();
      if (k === "e") return fit();
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
    setMode: m => { mode = m; first = null; pivot = m === "mate" ? pivot : null; clearMarks(); placeHandle(); shade(); render(); onChange?.(state()); },
    setMagnet: on => { magnet = on; applySnap(); onChange?.(state()); },
    setRotStep: d => { rotStep = d; applySnap(); onChange?.(state()); },
    setMulti: on => { multi = on; onChange?.(state()); },
    setTurnGlued: on => { turnGlued = on; onChange?.(state()); },
    setGuard: async on => { guard = on; if (on) await getCollider(); onChange?.(state()); },
    select: keys => setSel(keys.map(k => byKey.get(k)).filter(Boolean)),
    // separer la piece choisie : proposer (morceaux colores), puis valider ou non
    splitPreview: async () => {
      if (sel.size !== 1 || pendingSplit) return;
      const pg = [...sel][0];
      const { splitPieceGeometry, buildSplitGroups } = await import("./assemblySplit");
      const comps = splitPieceGeometry(THREE, pg);
      if (!comps) { fitMsg = "Cette pièce est d'un seul tenant : rien à séparer"; onChange?.(state()); return; }
      const groups = buildSplitGroups(THREE, pg, comps);
      const tints = [0xef4444, 0x22c55e, 0x3b82f6, 0xf59e0b, 0xa855f7, 0x06b6d4, 0xec4899, 0x84cc16];
      groups.forEach((g, i) => { holder.add(g); g.children.forEach(m => { m.material.emissive = new THREE.Color(tints[i % tints.length]); m.material.emissiveIntensity = 0.55; }); });
      pg.visible = false;
      pendingSplit = { pg, groups };
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
