// L'edition de la vue assemblee (29/10/2026), sur PC, a la souris. Chaque piece est un groupe three.js (enfant du
// support du modele, en coordonnees du 3MF : Z vers le haut, en mm). Les gestes :
//  - deplacer / tourner : la poignee de three.js (TransformControls), avec l'aimantation (pas de 1 mm et 15°, et la
//    piece lachee pres d'une autre ou du sol vient s'y coller) ;
//  - poser au sol : une face touchee vient a plat sur le sol (une arete : mise a l'horizontale), puis la piece y descend ;
//  - coller : une face (ou une arete) de la piece A, puis une face (ou une arete) de la piece B : A pivote pour que les
//    deux se regardent (ou s'alignent) et vient se coller au point touche ; elle peut ensuite tourner autour de
//    l'axe de contact (boutons) ;
//  - annuler, refaire.
// Une arete est reconnue la ou les deux faces qui la bordent font un angle marque (plus de 30°), et seulement si le
// clic tombe tout pres d'elle ; sinon c'est la face.
export async function createAssemblyEditor({ THREE, scene, camera, renderer, controls, holder, pieces, render, onChange }) {
  const { TransformControls } = await import("three/examples/jsm/controls/TransformControls.js");
  const el = renderer.domElement;
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const tc = new TransformControls(camera, el);
  tc.setSpace("world");
  tc.size = 0.8;
  const helper = tc.getHelper();
  scene.add(helper);
  tc.addEventListener("dragging-changed", e => { controls.enabled = !e.value; if (!e.value) { snapAfterDrag(); push(); } });
  tc.addEventListener("change", render);

  let mode = "move";                 // move | rotate | ground | mate
  let magnet = true;
  let sel = null;                    // le groupe de la piece choisie
  let first = null;                  // coller : la premiere prise {group, kind, p, n|e}
  let pivot = null;                  // l'axe de contact apres un collage {p, axis} (repere du support)
  const undo = [], redo = [];
  const groups = [...pieces.values()];
  const snapshot = () => groups.map(g => g.matrix.clone());
  const restore = s => { groups.forEach((g, i) => { s[i].decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }); render(); };
  let last = snapshot();
  let changes = 0, savedAt = 0;          // dirty : des changements depuis le dernier enregistrement
  const push = () => { undo.push(last); if (undo.length > 100) undo.shift(); redo.length = 0; last = snapshot(); changes++; onChange?.(state()); };
  const state = () => ({ mode, magnet, selected: sel?.userData.name || null, step: first ? 2 : 1, canUndo: undo.length > 0, canRedo: redo.length > 0,
    pivot: !!pivot, dirty: changes !== savedAt });

  // une marque de la prise (face : un disque ; arete : un trait)
  const markMat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xf97316, depthTest: false });
  const marks = new THREE.Group(); marks.renderOrder = 999; holder.add(marks);
  const clearMarks = () => { marks.children.slice().forEach(m => { m.geometry.dispose(); marks.remove(m); }); };
  const mark = pick => {
    if (pick.kind === "edge") {
      const g = new THREE.BufferGeometry().setFromPoints([pick.a, pick.b]);
      marks.add(new THREE.Line(g, lineMat));
    } else {
      const r = Math.max(1.5, pick.size * 0.08);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 24), markMat);
      disc.position.copy(pick.p).addScaledVector(pick.n, 0.05);
      disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pick.n);
      marks.add(disc);
    }
    render();
  };

  const meshes = () => groups.flatMap(g => g.children.filter(c => c.isMesh));
  const toLocal = v => holder.worldToLocal(v.clone());
  const pieceOf = o => { while (o && !pieces.has(o.userData.pid)) o = o.parent; return o; };
  const boxOf = g => { g.updateMatrixWorld(true); const b = new THREE.Box3(); g.children.forEach(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(g.matrix)); } }); return b; };

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
    const toHolder = v => v.applyMatrix4(hit.object.matrix).applyMatrix4(g.matrix);     // mesh -> piece -> support
    const va = toHolder(new THREE.Vector3().fromBufferAttribute(pos, ia)), vb = toHolder(new THREE.Vector3().fromBufferAttribute(pos, ib)),
      vc = toHolder(new THREE.Vector3().fromBufferAttribute(pos, ic));
    const p = toLocal(hit.point);
    const n = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va)).normalize();
    const size = boxOf(g).getSize(new THREE.Vector3()).length();
    // l'arete la plus proche du clic, si le clic la frole et si c'est une vraie arete (angle marque avec sa voisine)
    const edges = [[ia, ib, va, vb], [ib, ic, vb, vc], [ic, ia, vc, va]];
    let best = null;
    for (const [i1, i2, a, b] of edges) {
      const seg = new THREE.Line3(a, b), q = seg.closestPointToPoint(p, true, new THREE.Vector3()), d = q.distanceTo(p);
      const len = a.distanceTo(b);
      if (d < Math.max(0.5, 0.12 * len) && (!best || d < best.d)) best = { d, i1, i2, a, b, q };
    }
    if (best && idx) {
      // la face voisine de cette arete (meme groupe de couleur : la piece peut en avoir d'autres, tant pis)
      const ix = idx.array, A = best.i1, B = best.i2, me = hit.faceIndex;
      let nb = null;
      for (let t = 0; t < ix.length; t += 3) {
        if (t / 3 === me) continue;
        const x = ix[t], y = ix[t + 1], z = ix[t + 2];
        if ((x === A || y === A || z === A) && (x === B || y === B || z === B)) { nb = [x, y, z]; break; }
      }
      if (nb) {
        const [wa, wb, wc] = nb.map(i => toHolder(new THREE.Vector3().fromBufferAttribute(pos, i)));
        const n2 = new THREE.Vector3().subVectors(wb, wa).cross(new THREE.Vector3().subVectors(wc, wa)).normalize();
        if (n.angleTo(n2) > Math.PI / 6) {
          return { group: g, kind: "edge", p: best.q, a: best.a, b: best.b, e: new THREE.Vector3().subVectors(best.b, best.a).normalize(), n, size };
        }
      }
    }
    return { group: g, kind: "face", p, n, size };
  };

  // applique a une piece : d'abord sa place, puis M (repere du support)
  const apply = (g, M) => { g.updateMatrix(); const m = M.clone().multiply(g.matrix); m.decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); };
  const about = (p, q) => new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  const drop = g => { const b = boxOf(g); apply(g, new THREE.Matrix4().makeTranslation(0, 0, -b.min.z)); };

  // l'aimantation apres un deplacement : sol a moins de 3 mm, et faces de boite d'une autre piece a moins de 3 mm
  const SNAP = 3;
  const snapAfterDrag = () => {
    if (!magnet || !sel || mode !== "move") return;
    const b = boxOf(sel), t = new THREE.Vector3();
    if (Math.abs(b.min.z) < SNAP) t.z = -b.min.z;
    for (const o of groups) {
      if (o === sel) continue;
      const c = boxOf(o);
      const near = ax => b.max[ax] > c.min[ax] - SNAP && b.min[ax] < c.max[ax] + SNAP;
      for (const ax of ["x", "y", "z"]) {
        const others = ["x", "y", "z"].filter(a => a !== ax);
        if (!others.every(near)) continue;
        const d1 = c.min[ax] - b.max[ax], d2 = c.max[ax] - b.min[ax];
        if (Math.abs(d1) < SNAP && !t[ax]) t[ax] = d1;
        else if (Math.abs(d2) < SNAP && !t[ax]) t[ax] = d2;
      }
    }
    if (t.lengthSq()) { apply(sel, new THREE.Matrix4().makeTranslation(t.x, t.y, t.z)); tc.attach(sel); render(); }
  };

  const select = g => {
    sel = g;
    groups.forEach(o => o.children.forEach(m => { if (m.isMesh && m.material) { m.material.transparent = !!g && o !== g; m.material.opacity = g && o !== g ? 0.45 : 1; } }));
    if (g && (mode === "move" || mode === "rotate")) { tc.attach(g); tc.setMode(mode === "move" ? "translate" : "rotate"); } else tc.detach();
    render(); onChange?.(state());
  };
  const applySnap = () => { tc.setTranslationSnap(magnet ? 1 : null); tc.setRotationSnap(magnet ? THREE.MathUtils.degToRad(15) : null); };
  applySnap();

  let down = null;
  const onDown = ev => { down = [ev.clientX, ev.clientY]; };
  const onUp = ev => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 4 || tc.dragging) { down = null; return; }   // un glisser : la vue tourne
    down = null;
    if (tc.axis) return;                              // un clic sur la poignee
    const pick = pickAt(ev);
    if (mode === "move" || mode === "rotate") { select(pick ? pick.group : null); return; }
    if (!pick) return;
    if (mode === "ground") {
      const g = pick.group;
      if (pick.kind === "face") apply(g, about(pick.p, new THREE.Quaternion().setFromUnitVectors(pick.n, new THREE.Vector3(0, 0, -1))));
      else {
        const h = new THREE.Vector3(pick.e.x, pick.e.y, 0);
        if (h.lengthSq() > 1e-6) apply(g, about(pick.p, new THREE.Quaternion().setFromUnitVectors(pick.e, h.normalize())));
      }
      drop(g); pivot = null; clearMarks(); push(); render(); return;
    }
    if (mode === "mate") {
      if (!first) { first = pick; clearMarks(); mark(pick); onChange?.(state()); return; }
      const A = first, B = pick;
      first = null; clearMarks();
      if (A.group === B.group) { onChange?.(state()); return; }
      let q = new THREE.Quaternion(), axis;
      if (A.kind === "face" && B.kind === "face") {
        q.setFromUnitVectors(A.n, B.n.clone().negate()); axis = B.n.clone();
      } else if (A.kind === "edge" && B.kind === "edge") {
        const eb = A.e.dot(B.e) >= 0 ? B.e.clone() : B.e.clone().negate();
        q.setFromUnitVectors(A.e, eb); axis = eb;
      } else axis = (B.kind === "face" ? B.n : B.e).clone();
      const g = A.group;
      apply(g, new THREE.Matrix4().makeTranslation(B.p.x - A.p.x, B.p.y - A.p.y, B.p.z - A.p.z).multiply(about(A.p, q)));
      pivot = { p: B.p.clone(), axis: axis.normalize(), group: g };
      mark(B); push(); render(); onChange?.(state());
    }
  };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);
  const onKey = ev => {
    if (ev.target?.closest?.("input, textarea")) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? api.redo() : api.undo(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") { ev.preventDefault(); api.redo(); }
    else if (ev.key === "Escape") { first = null; clearMarks(); select(null); }
    else if (sel && ev.key.startsWith("Arrow")) {
      // les fleches : 1 mm (10 avec Maj) ; haut/bas avec Ctrl : monter/descendre
      ev.preventDefault();
      const s = ev.shiftKey ? 10 : 1, t = new THREE.Vector3();
      if (ev.ctrlKey || ev.metaKey) t.z = ev.key === "ArrowUp" ? s : ev.key === "ArrowDown" ? -s : 0;
      else { t.x = ev.key === "ArrowRight" ? s : ev.key === "ArrowLeft" ? -s : 0; t.y = ev.key === "ArrowUp" ? s : ev.key === "ArrowDown" ? -s : 0; }
      apply(sel, new THREE.Matrix4().makeTranslation(t.x, t.y, t.z)); tc.attach(sel); push(); render();
    }
  };
  window.addEventListener("keydown", onKey);

  const api = {
    setMode: m => { mode = m; first = null; pivot = m === "mate" ? pivot : null; clearMarks(); select(m === "move" || m === "rotate" ? sel : null); onChange?.(state()); },
    setMagnet: on => { magnet = on; applySnap(); onChange?.(state()); },
    undo: () => { if (!undo.length) return; redo.push(snapshot()); last = undo.pop(); restore(last); changes++; if (sel) tc.attach(sel); onChange?.(state()); },
    redo: () => { if (!redo.length) return; undo.push(snapshot()); last = redo.pop(); restore(last); changes++; if (sel) tc.attach(sel); onChange?.(state()); },
    markSaved: () => { savedAt = changes; onChange?.(state()); },
    // tourner la piece collee autour de l'axe de contact
    turn: deg => {
      if (!pivot) return;
      apply(pivot.group, about(pivot.p, new THREE.Quaternion().setFromAxisAngle(pivot.axis, THREE.MathUtils.degToRad(deg))));
      push(); render();
    },
    reset: matrices => { restore(matrices); select(null); push(); },
    matrices: () => new Map([...pieces.entries()].map(([pid, g]) => [pid, g.matrix.clone()])),
    state,
    dispose: () => {
      el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointerup", onUp); window.removeEventListener("keydown", onKey);
      tc.detach(); tc.dispose(); scene.remove(helper); clearMarks(); holder.remove(marks); markMat.dispose(); lineMat.dispose();
      groups.forEach(o => o.children.forEach(m => { if (m.isMesh && m.material) { m.material.transparent = false; m.material.opacity = 1; } }));
      controls.enabled = true; render();
    },
  };
  onChange?.(state());
  return api;
}
