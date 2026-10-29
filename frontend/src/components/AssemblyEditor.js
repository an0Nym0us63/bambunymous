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
export async function createAssemblyEditor({ THREE, scene, camera, renderer, controls, holder, pieces, render, onChange, groupsInit = [] }) {
  const { TransformControls } = await import("three/examples/jsm/controls/TransformControls.js");
  const el = renderer.domElement;
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const all = [...pieces.values()];
  const byKey = new Map(all.map(g => [g.userData.k, g]));

  let mode = "move";                 // move | rotate | ground | mate
  let magnet = true, assist = true;
  const sel = new Set();             // les pieces choisies
  let first = null;                  // coller : la premiere prise
  let pivot = null;                  // l'axe de contact apres un collage {p, axis, unit} (repere du support)
  // les groupes : des listes de pieces (gardes par leur cle)
  let groups = (groupsInit || []).map(ks => ks.map(k => byKey.get(k)).filter(Boolean)).filter(g => g.length > 1);
  const groupOf = g => groups.find(gr => gr.includes(g)) || null;
  const unitOf = g => groupOf(g) || [g];

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
    if (e.value) { handle.updateMatrix(); dragStart = { h: handle.matrix.clone(), m: [...sel].map(g => [g, g.matrix.clone()]) }; }
    else { dragStart = null; snapAfterDrag(); push(); }
  });
  tc.addEventListener("objectChange", () => {
    if (!dragStart) return;
    handle.updateMatrix();
    const d = handle.matrix.clone().multiply(dragStart.h.clone().invert());
    for (const [g, m0] of dragStart.m) { d.clone().multiply(m0).decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }
  });
  tc.addEventListener("change", render);

  const undo = [], redo = [];
  const snapshot = () => ({ m: all.map(g => g.matrix.clone()), groups: groups.map(gr => [...gr]) });
  const restore = s => { all.forEach((g, i) => { s.m[i].decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }); groups = s.groups.map(gr => [...gr]); placeHandle(); render(); };
  let last = snapshot();
  let changes = 0, savedAt = 0;          // dirty : des changements depuis le dernier enregistrement
  const push = () => { undo.push(last); if (undo.length > 100) undo.shift(); redo.length = 0; last = snapshot(); changes++; onChange?.(state()); };
  const selName = () => sel.size === 0 ? null : sel.size === 1 ? [...sel][0].userData.name : `${sel.size} pièces${groups.some(gr => gr.length === sel.size && gr.every(g => sel.has(g))) ? " (groupe)" : ""}`;
  const state = () => ({ mode, magnet, assist, selected: selName(), count: sel.size, step: first ? 2 : 1, canUndo: undo.length > 0, canRedo: redo.length > 0,
    pivot: !!pivot, dirty: changes !== savedAt,
    canGroup: sel.size > 1 && !groups.some(gr => gr.length === sel.size && gr.every(g => sel.has(g))),
    canUngroup: [...sel].some(g => groupOf(g)) });

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

  const meshes = () => all.flatMap(g => g.children.filter(c => c.isMesh));
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
    if (!sel.size || !(mode === "move" || mode === "rotate")) { tc.detach(); return; }
    const c = boxOfAll([...sel]).getCenter(new THREE.Vector3());
    handle.position.copy(c); handle.quaternion.identity(); handle.scale.set(1, 1, 1); handle.updateMatrix();
    tc.attach(handle); tc.setMode(mode === "move" ? "translate" : "rotate");
  };
  const shade = () => {
    all.forEach(o => o.children.forEach(m => { if (m.isMesh && m.material) { const dim = sel.size > 0 && !sel.has(o); m.material.transparent = dim; m.material.opacity = dim ? 0.45 : 1; } }));
  };
  const setSel = list => { sel.clear(); list.forEach(g => sel.add(g)); shade(); placeHandle(); render(); onChange?.(state()); };

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
    if (t.lengthSq()) { apply(list, new THREE.Matrix4().makeTranslation(t.x, t.y, t.z)); placeHandle(); render(); }
  };
  const applySnap = () => { tc.setTranslationSnap(magnet ? 1 : null); tc.setRotationSnap(magnet ? THREE.MathUtils.degToRad(15) : null); };
  applySnap();

  // coller A contre B
  const mate = (A, B) => {
    const unit = sel.has(A.group) ? [...sel] : unitOf(A.group);
    if (unit.includes(B.group)) return false;
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
    apply(unit, new THREE.Matrix4().makeTranslation(to.x - from.x, to.y - from.y, to.z - from.z).multiply(about(from, q)));
    pivot = { p: to.clone(), axis: axis.normalize(), unit };
    return true;
  };

  let down = null;
  const onDown = ev => { down = [ev.clientX, ev.clientY]; };
  const onUp = ev => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 4 || tc.dragging) { down = null; return; }   // un glisser : la vue tourne
    down = null;
    if (tc.axis) return;                              // un clic sur la poignee
    const pick = pickAt(ev);
    if (mode === "move" || mode === "rotate") {
      if (!pick) { if (!ev.ctrlKey && !ev.shiftKey) setSel([]); return; }
      const unit = ev.altKey ? [pick.group] : unitOf(pick.group);
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) {
        const on = unit.every(g => sel.has(g));
        setSel(on ? [...sel].filter(g => !unit.includes(g)) : [...sel, ...unit.filter(g => !sel.has(g))]);
      } else setSel(unit);
      return;
    }
    if (!pick) return;
    if (mode === "ground") {
      const unit = sel.has(pick.group) ? [...sel] : unitOf(pick.group);
      const n = pick.kind === "face" && pick.region ? pick.n : pick.n;
      if (pick.kind === "face") apply(unit, about(pick.p, new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 0, -1))));
      else {
        const h = new THREE.Vector3(pick.e.x, pick.e.y, 0);
        if (h.lengthSq() > 1e-6) apply(unit, about(pick.p, new THREE.Quaternion().setFromUnitVectors(pick.e, h.normalize())));
      }
      drop(unit); pivot = null; clearMarks(); push(); render(); return;
    }
    if (mode === "mate") {
      if (!first) { first = pick; clearMarks(); mark(pick); onChange?.(state()); return; }
      const A = first;
      first = null; clearMarks();
      if (mate(A, pick)) { mark(pick); push(); }
      render(); onChange?.(state());
    }
  };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);
  const onKey = ev => {
    if (ev.target?.closest?.("input, textarea")) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? api.redo() : api.undo(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") { ev.preventDefault(); api.redo(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "g") { ev.preventDefault(); ev.shiftKey ? api.ungroup() : api.group(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") { ev.preventDefault(); setSel(all); }
    else if (ev.key === "Escape") { first = null; clearMarks(); setSel([]); }
    else if (sel.size && ev.key.startsWith("Arrow")) {
      // les fleches : 1 mm (10 avec Maj) ; haut/bas avec Ctrl : monter/descendre
      ev.preventDefault();
      const s = ev.shiftKey ? 10 : 1, t = new THREE.Vector3();
      if (ev.ctrlKey || ev.metaKey) t.z = ev.key === "ArrowUp" ? s : ev.key === "ArrowDown" ? -s : 0;
      else { t.x = ev.key === "ArrowRight" ? s : ev.key === "ArrowLeft" ? -s : 0; t.y = ev.key === "ArrowUp" ? s : ev.key === "ArrowDown" ? -s : 0; }
      apply([...sel], new THREE.Matrix4().makeTranslation(t.x, t.y, t.z)); placeHandle(); push(); render();
    }
  };
  window.addEventListener("keydown", onKey);

  const api = {
    setMode: m => { mode = m; first = null; pivot = m === "mate" ? pivot : null; clearMarks(); placeHandle(); shade(); render(); onChange?.(state()); },
    setMagnet: on => { magnet = on; applySnap(); onChange?.(state()); },
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
    reset: matrices => { all.forEach((g, i) => { matrices[i].decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }); groups = []; setSel([]); push(); },
    groups: () => groups.map(gr => gr.map(g => g.userData.k)),
    state,
    dispose: () => {
      // pas tc.dispose() : en three 0.169 il appelle traverse, qui n'existe plus sur la poignee, et l'erreur cassait la
      // fermeture de la vue (page blanche, 29/10/2026) ; on la debranche et on libere son dessin a la main
      el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointerup", onUp); window.removeEventListener("keydown", onKey);
      try { tc.detach(); tc.disconnect(); } catch { /* deja debranchee */ }
      try { helper.traverse(o => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.dispose?.()); }); } catch { /* rien */ }
      scene.remove(helper); holder.remove(handle);
      clearMarks(); holder.remove(marks); markMat.dispose(); lineMat.dispose();
      sel.clear(); shade();
      controls.enabled = true; render();
    },
  };
  onChange?.(state());
  return api;
}
