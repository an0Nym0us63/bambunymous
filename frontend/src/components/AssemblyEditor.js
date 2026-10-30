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
                                                  copyPiece = null, cutsInit = {} }) {
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
  // le cran des deplacements (30/10/2026 : l'aimant imposait le millimetre, on ne placait rien entre deux) : libre par
  // defaut ; l'aimant ne fait plus que coller au sol et aux pieces voisines. Garde sur l'appareil
  let moveStep = 0;
  try { moveStep = Number(localStorage.getItem("bn.asm.moveStep")) || 0; } catch { /* pas de stockage */ }
  const stepRound = (v, off = false) => (moveStep && !off ? v.set(...[v.x, v.y, v.z].map(x => Math.round(x / moveStep) * moveStep)) : v);
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
    else {
      const j = jointOf([...sel]);
      if (j && dragStart) {
        // le point de contact suit la piece (dans le repere du support)
        handle.updateMatrix();
        const d = handle.matrix.clone().multiply(dragStart.h.clone().invert()), { P } = contact(j);
        j.b.updateMatrix(); j.p.copy(P.applyMatrix4(d).applyMatrix4(j.b.matrix.clone().invert()));
        showContact();
        if (d.elements[12] || d.elements[13] || d.elements[14]) egg("glissade");
      } else snapAfterDrag();
      dragStart = null; liveAngle = null; push();
    }
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
      const rq = new THREE.Quaternion().setFromAxisAngle(tc.rotationAxis.clone().normalize(), THREE.MathUtils.degToRad(a));
      if (tc.space === "local") handle.quaternion.copy(dragStart.q).multiply(rq).normalize();       // l'axe de la poignee (piece collee)
      else handle.quaternion.copy(rq).multiply(dragStart.q).normalize();
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
  let pendingCut = null;
  let edgeMode = false;               // « ╱ Arete » : un clic prend l'arete la plus proche, sinon toujours la face
  // « ➕ Point de colle » (30/10/2026) : sur une piece deja collee, une prise de plus (point, arete ou face) et sa cible ;
  // le premier collage tient (la piece ne fait que glisser et tourner sur son contact). keepPins : les points poses
  let addPin = false, keepPins = [];
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
  const state = () => ({ mode, magnet, assist, rotStep, moveStep, center: center(), selected: selName(), count: sel.size, step: first ? 2 : 1, canUndo: undo.length > 0, canRedo: redo.length > 0,
    pivot: !!pivot, pairs: pairs.length, twinPos: twinAlt && twinAlt.at === changes && twinAlt.fits.length > 1 ? `${twinAlt.i + 1}/${twinAlt.fits.length}` : null, boxMode, ground3, groundPts: gPts.length, vertical, pinsA: pins.a.length, pinsB: pins.b.length,
    pinsFrom: pins.A?.userData.name || null, pinsTo: pins.B?.userData.name || null, dirty: changes !== savedAt, splitPending: pendingSplit ? pendingSplit.groups.length : 0,
    cutPending: pendingCut ? pendingCut.parts.length : 0, cutCount: pendingCut ? pendingCut.cuts.length - pendingCut.base : 0,
    cutPiece: pendingCut ? pendingCut.g.userData.name : null, eraser, addPin, autoFit, edgeMode,
    canSplit: !pendingSplit && (sel.size === 1 || [...sel].some(g => groupOf(g))), canReunite: [...sel].some(g => g.userData.from),
    canGroup: sel.size > 1 && !groups.some(gr => gr.length === sel.size && gr.every(g => sel.has(g))),
    // de la selection part au moins un collage (vers une piece hors d'elle) : « Grouper le colle » a un sens
    canGroupGlued: sel.size > 0 && joints.some(j => sel.has(j.a) !== sel.has(j.b)),
    canUngroup: [...sel].some(g => groupOf(g)), multi, turnGlued, liveAngle, guard, fitMsg,
    hidden: all.filter(g => !g.visible && !g.userData.excluded && g !== pendingSplit?.pg && !pendingCut?.old.includes(g)).length,
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
      // l'arete entiere, meme courbe (avant : le seul segment du triangle touche)
      const pts = pick.hl?.chain ? pick.hl.chain.map(v => v.clone().applyMatrix4(pick.hl.M)) : [pick.a, pick.b];
      marks.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    } else {
      const r = Math.max(1.5, Math.min(pick.size * 0.06, pick.region ? Math.sqrt(pick.region.area) * 0.4 : 1e9));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 24), markMat);
      disc.position.copy(pick.p).addScaledVector(pick.n, 0.05);      // la ou l'on a clique : c'est la que la piece se cale
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
  // « ⊞ Tout a plat, ecarte » (30/10/2026) : pour commencer un assemblage, chaque piece (ou groupe) posee sur sa plus
  // grande face d'appui, tournee pour tenir le moins de place, puis toutes rangees en rangees sur le plateau, ecartees.
  // Les collages sont defaits (↶ revient a l'assemblage)
  // les points d'une piece dans le repere du support (au plus ~n, regulierement pris)
  const ptsOf = (unit, n) => {
    let nv = 0;
    for (const g of unit) for (const m of g.children) if (m.isMesh && m.geometry?.attributes?.position) nv += m.geometry.attributes.position.count;
    const st = Math.max(1, Math.ceil(nv / n)), out = [], v = new THREE.Vector3();
    for (const g of unit) { g.updateMatrix(); for (const m of g.children) {
      if (!m.isMesh || !m.geometry?.attributes?.position) continue;
      const pa = m.geometry.attributes.position.array, M = g.matrix.clone().multiply(m.matrix);
      for (let i = 0; i < pa.length; i += 3 * st) { v.set(pa[i], pa[i + 1], pa[i + 2]).applyMatrix4(M); out.push(v.x, v.y, v.z); }
    } }
    return out;
  };
  const flatOf = unit => {
    // les triangles (normale, surface, centre), au plus ~20 000 regardes, dans le repere du support
    let nt = 0;
    for (const g of unit) { g.updateMatrix(); for (const m of g.children) if (m.isMesh && m.geometry?.attributes?.position) nt += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }
    const st = Math.max(1, Math.ceil(nt / 20000)), T = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
    for (const g of unit) for (const m of g.children) {
      if (!m.isMesh || !m.geometry?.attributes?.position) continue;
      const M = g.matrix.clone().multiply(m.matrix), pos = m.geometry.attributes.position, ix = m.geometry.index?.array;
      const k = ix ? ix.length / 3 : pos.count / 3;
      for (let t = 0; t < k; t += st) {
        a.fromBufferAttribute(pos, ix ? ix[t * 3] : t * 3).applyMatrix4(M); b.fromBufferAttribute(pos, ix ? ix[t * 3 + 1] : t * 3 + 1).applyMatrix4(M);
        c.fromBufferAttribute(pos, ix ? ix[t * 3 + 2] : t * 3 + 2).applyMatrix4(M);
        n.subVectors(b, a).cross(e.subVectors(c, a));
        const ar = n.length() / 2;
        if (ar < 1e-9) continue;
        n.normalize();
        T.push(n.x, n.y, n.z, ar * st, (a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
      }
    }
    if (!T.length) return null;
    const P = ptsOf(unit, 20000);
    // les directions des grandes faces planes (normales regroupees a ~2° pres), les plus etendues d'abord
    const bins = new Map();
    for (let i = 0; i < T.length; i += 7) {
      const key = `${Math.round(T[i] * 25)},${Math.round(T[i + 1] * 25)},${Math.round(T[i + 2] * 25)}`;
      const e = bins.get(key) || { s: new THREE.Vector3(), ar: 0 };
      e.s.x += T[i] * T[i + 3]; e.s.y += T[i + 1] * T[i + 3]; e.s.z += T[i + 2] * T[i + 3]; e.ar += T[i + 3]; bins.set(key, e);
    }
    const cands = [...bins.values()].sort((x, y) => y.ar - x.ar).slice(0, 10).map(e => e.s.normalize());
    // l'appui d'une direction : la surface des triangles tournes vers elle, au plus loin dans cette direction (0,3 mm)
    const support = d => {
      let far = -Infinity;
      for (let i = 0; i < P.length; i += 3) far = Math.max(far, P[i] * d.x + P[i + 1] * d.y + P[i + 2] * d.z);
      let s = 0;
      for (let i = 0; i < T.length; i += 7) if (T[i] * d.x + T[i + 1] * d.y + T[i + 2] * d.z > 0.995 && T[i + 4] * d.x + T[i + 5] * d.y + T[i + 6] * d.z > far - 0.3) s += T[i + 3];
      return s;
    };
    let best = new THREE.Vector3(0, 0, -1), bs = support(best) * 1.05;   // telle qu'elle est, si a peu pres aussi bien
    for (const d of cands) { const s = support(d); if (s > bs) { bs = s; best = d; } }
    return best;
  };
  const layFlat = () => {
    const units = [];
    for (const g of all) if (g.visible && !g.userData.excluded && !units.some(u => u.includes(g))) units.push(unitOf(g).filter(x => x.visible && !x.userData.excluded));
    if (!units.length) return;
    const c0 = boxOfAll(units.flat()).getCenter(new THREE.Vector3());
    joints = [];
    const z = new THREE.Vector3(0, 0, -1), up = new THREE.Vector3(0, 0, 1);
    // l'emprise au sol d'une piece : ses points (la boite d'une piece tournee deborde de la piece)
    const foot = u => {
      const p = ptsOf(u, 6000), b = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) { b[0] = Math.min(b[0], p[i]); b[1] = Math.min(b[1], p[i + 1]); b[2] = Math.max(b[2], p[i]); b[3] = Math.max(b[3], p[i + 1]); }
      return b;
    };
    const boxes = units.map(u => {
      const d = flatOf(u);
      if (d && d.dot(z) < 0.9999) apply(u, about(boxOfAll(u).getCenter(new THREE.Vector3()), new THREE.Quaternion().setFromUnitVectors(d, z)));
      // tournee a plat pour tenir le moins de place (la plus petite emprise, tous les 5°), le grand cote en X
      const p = ptsOf(u, 3000);
      let ba = 0, bArea = Infinity;
      for (let k = 0; k < 18; k++) {
        const th = k * Math.PI / 36, cs = Math.cos(th), sn = Math.sin(th);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < p.length; i += 3) { const x = cs * p[i] - sn * p[i + 1], y = sn * p[i] + cs * p[i + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const area = (x1 - x0) * (y1 - y0);
        if (area < bArea - 1e-6) { bArea = area; ba = (x1 - x0) >= (y1 - y0) ? th : th + Math.PI / 2; }
      }
      if (ba) apply(u, about(boxOfAll(u).getCenter(new THREE.Vector3()), new THREE.Quaternion().setFromAxisAngle(up, ba)));
      drop(u);
      return foot(u);
    });
    // en rangees, les plus profondes d'abord, a 8 mm les unes des autres
    const gap = 8, sx = i => boxes[i][2] - boxes[i][0], sy = i => boxes[i][3] - boxes[i][1];
    const order = units.map((u, i) => i).sort((i, j) => sy(j) - sy(i));
    const W = Math.max(...order.map(sx), Math.sqrt(order.reduce((s, i) => s + (sx(i) + gap) * (sy(i) + gap), 0)) * 1.3);
    let x = 0, y = 0, row = 0;
    const at = [];
    for (const i of order) {
      if (x > 0 && x + sx(i) > W) { x = 0; y += row + gap; row = 0; }
      at[i] = [x, y];
      x += sx(i) + gap; row = Math.max(row, sy(i));
    }
    let X1 = 0, Y1 = 0;
    order.forEach(i => { X1 = Math.max(X1, at[i][0] + sx(i)); Y1 = Math.max(Y1, at[i][1] + sy(i)); });
    order.forEach(i => {
      const tx = c0.x - X1 / 2 + at[i][0] - boxes[i][0], ty = c0.y + Y1 / 2 - at[i][1] - sy(i) - boxes[i][1];
      apply(units[i], new THREE.Matrix4().makeTranslation(tx, ty, 0));
    });
    pivot = null; clearMarks(); showContact(); push(); setSel([]);
    fitMsg = `Posées à plat, écartées : ${units.length} pièce${units.length > 1 ? "s" : ""} (↶ revient à l'assemblage)`;
    egg("a_plat");
    render(); onChange?.(state()); frame();
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
    return { c, area, axis, n: n0, elongated, count: seen.size, relaxed, tris: seen };
  };

  // les aretes vives d'un maillage (deux faces a plus de 30°), sommet -> sommets voisins le long d'elles : pour suivre
  // une arete courbe d'un bout a l'autre (faite une fois par maillage, a la demande)
  const creases = new WeakMap();
  const creaseOf = geo => {
    if (creases.has(geo)) return creases.get(geo);
    const nb = neighbours(geo), pos = geo.attributes.position, ix = geo.index.array, nt = ix.length / 3;
    const nrm = new Float32Array(nt * 3), v = new THREE.Vector3();
    for (let t = 0; t < nt; t++) { triNormal(pos, ix, t, v); nrm[t * 3] = v.x; nrm[t * 3 + 1] = v.y; nrm[t * 3 + 2] = v.z; }
    const adjV = new Map(), cos30 = Math.cos(Math.PI / 6);
    const link = (a, b) => { if (!adjV.has(a)) adjV.set(a, new Set()); adjV.get(a).add(b); };
    for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
      const u = nb[t * 3 + e];
      if (u < t) continue;
      if (nrm[t * 3] * nrm[u * 3] + nrm[t * 3 + 1] * nrm[u * 3 + 1] + nrm[t * 3 + 2] * nrm[u * 3 + 2] > cos30) continue;
      const a = ix[t * 3 + e], b = ix[t * 3 + (e + 1) % 3];
      link(a, b); link(b, a);
    }
    creases.set(geo, adjV);
    return adjV;
  };
  // l'arete entiere a partir d'un de ses segments (a, b : sommets) : on la suit de chaque cote tant qu'elle ne tourne
  // pas brusquement (50°) ; rend les points (repere du maillage), et si elle est courbe
  const creaseChain = (geo, a, b) => {
    const adjV = creaseOf(geo), pos = geo.attributes.position, P = i => new THREE.Vector3().fromBufferAttribute(pos, i);
    const walk = (prev, cur) => {
      const out = [];
      const seen = new Set([prev, cur]);
      for (let k = 0; k < 3000; k++) {
        const d0 = P(cur).sub(P(prev)).normalize();
        let best = null, bc = Math.cos(THREE.MathUtils.degToRad(50));
        for (const nx of adjV.get(cur) || []) {
          if (seen.has(nx)) continue;
          const c = P(nx).sub(P(cur)).normalize().dot(d0);
          if (c > bc) { bc = c; best = nx; }
        }
        if (best === null) break;
        out.push(best); seen.add(best); prev = cur; cur = best;
      }
      return out;
    };
    const ids = [...walk(b, a).reverse(), a, b, ...walk(a, b)];
    const pts = ids.map(P);
    let len = 0, turn = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    if (pts.length > 2) turn = pts[1].clone().sub(pts[0]).normalize().angleTo(pts[pts.length - 1].clone().sub(pts[pts.length - 2]).normalize());
    return { pts, len, curved: turn > THREE.MathUtils.degToRad(10) };
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
    const hits = ray.intersectObjects(meshes(), false), hit = hits[0];
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
    // « ╱ Arete » allumee : l'arete vive (plus de 30° entre ses deux faces) la plus proche du clic, cherchee dans les
    // triangles autour (une quinzaine de pixels) -- pas seulement les trois cotes du triangle touche, souvent une
    // diagonale a plat (30/10/2026 : en mode arete, une face etait encore prise) ; aucune pres du clic : la face
    if (idx && edgeMode) {
      const nb = neighbours(geo), ix = idx.array;
      const pxmm = hit.distance * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, el.clientHeight);
      const R = Math.max(0.5, (coarse ? 26 : 16) * pxmm);
      const vx = k => new THREE.Vector3().fromBufferAttribute(pos, ix[k]).applyMatrix4(M);
      const nOf = t => { const v = new THREE.Vector3(); triNormal(pos, ix, t, v); return v.applyMatrix3(N).normalize(); };
      const seen = new Set([hit.faceIndex]), st = [hit.faceIndex], ln = new THREE.Line3(), q = new THREE.Vector3();
      const cands = [];
      while (st.length && seen.size < 4000) {
        const t = st.pop(), nt = nOf(t);
        for (let e = 0; e < 3; e++) {
          const a = vx(t * 3 + e), b = vx(t * 3 + (e + 1) % 3);
          ln.set(a, b); ln.closestPointToPoint(p, true, q);
          const d = q.distanceTo(p);
          if (d > R) continue;
          const u = nb[t * 3 + e];
          if (u < 0 || nt.angleTo(nOf(u)) > Math.PI / 6) {
            cands.push({ d, a, b, q: q.clone(), t, n: nt, ia: ix[t * 3 + e], ib: ix[t * 3 + (e + 1) % 3] });
          }
          if (u >= 0 && !seen.has(u)) { seen.add(u); st.push(u); }
        }
      }
      // parmi les plus proches, une vraie arete (2 mm de long au moins) plutot qu'un pli du maillage d'une surface
      // arrondie ; sinon la plus longue
      cands.sort((x, y) => x.d - y.d);
      let best = null, ch = null;
      for (const c of cands.slice(0, 8)) {
        const cc = creaseChain(geo, c.ia, c.ib);
        if (cc.len >= 2) { best = c; ch = cc; break; }
        if (!ch || cc.len > ch.len) { best = c; ch = cc; }
      }
      if (best) {
        // l'arete entiere (la suite des segments dans le prolongement) : ses bouts, pour un collage milieu contre milieu
        let { a, b } = best;
        if (!ch.curved && ch.pts.length > 2) { a = ch.pts[0].clone().applyMatrix4(M); b = ch.pts[ch.pts.length - 1].clone().applyMatrix4(M); }
        return { group: g, kind: "edge", p: best.q, a, b, e: new THREE.Vector3().subVectors(b, a).normalize(), n: best.n, size, mesh: hit.object, tri: best.t,
          hl: { geo, M, chain: ch.pts, len: ch.len, curved: ch.curved } };
      }
    }
    // la face entiere autour du clic (en mode assiste) ; une face a relief (tricot) : sa normale moyenne, et pas d'arete
    // (les cretes du relief n'en sont pas)
    let region = null;
    if (assist && idx) {
      const rg = regionOf(geo, hit.faceIndex);
      if (rg) region = { c: rg.c.clone().applyMatrix4(M), area: rg.area, axis: rg.axis.clone().applyMatrix3(N).normalize(), elongated: rg.elongated, relaxed: rg.relaxed };
      if (rg?.relaxed && rg.area > 20) {
        const nr = rg.n.clone().applyMatrix3(N).normalize();
        if (nr.dot(n) < 0) nr.negate();
        return { group: g, kind: "face", p, n: nr, size, region, mesh: hit.object, tri: hit.faceIndex };
      }
    }
    return { group: g, kind: "face", p, n, size, region, mesh: hit.object, tri: hit.faceIndex };
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
  // une piece collee (30/10/2026) : la poignee se met dans le repere du contact, sans l'axe qui la decollerait : ses deux
  // fleches font glisser la piece dans le plan de la face (son anneau la tourne autour de la normale) ; collee par une
  // arete, une seule fleche, le long de l'arete, et un anneau autour d'elle
  const contactFrame = j => {
    const { P, N, E } = contact(j);
    let x, z;
    if (E) { x = E.clone().normalize(); z = N.clone().addScaledVector(x, -N.dot(x)); if (z.lengthSq() < 1e-9) z = new THREE.Vector3(0, 0, 1).cross(x); z.normalize(); }
    else {
      z = N.clone().normalize();
      const ref = Math.abs(z.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      x = ref.addScaledVector(z, -ref.dot(z)).normalize();
    }
    const y = z.clone().cross(x);
    return { P, x, y, z, edge: !!E };
  };
  const placeHandle = () => {
    if (!sel.size || !(mode === "move" || mode === "rotate")) { tc.detach(); return; }
    const c = boxOfAll([...sel]).getCenter(new THREE.Vector3()), j = jointOf([...sel]);
    handle.scale.set(1, 1, 1);
    if (j) {
      const f = contactFrame(j);
      handle.position.copy(c).addScaledVector(f.z, -c.clone().sub(f.P).dot(f.z));     // sur le plan du contact
      handle.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.x, f.y, f.z));
      tc.setSpace("local");
      if (mode === "move") { tc.showX = true; tc.showY = !f.edge; tc.showZ = false; }
      else { tc.showX = f.edge; tc.showY = false; tc.showZ = !f.edge; }
    } else {
      handle.position.copy(c); handle.quaternion.identity();
      tc.setSpace("world"); tc.showX = tc.showY = tc.showZ = true;
    }
    handle.updateMatrix();
    tc.attach(handle); tc.setMode(mode === "move" ? "translate" : "rotate");
  };
  const shade = () => {
    // chaque materiau garde son etat d'origine (30/10/2026 : les pieces translucides par nature revenaient opaques, sans
    // ecrire la profondeur, et restaient abimees apres la selection)
    all.forEach(o => o.children.forEach(m => {
      if (!m.isMesh || !m.material) return;
      const mt = m.material, b = mt.userData.base || (mt.userData.base = { transparent: mt.transparent, opacity: mt.opacity });
      const dim = sel.size > 0 && !sel.has(o), tr = dim || b.transparent;
      if (mt.transparent !== tr) { mt.transparent = tr; mt.needsUpdate = true; }
      mt.opacity = dim ? Math.min(b.opacity, 0.65) : b.opacity;
    }));
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
  const applySnap = () => { tc.setTranslationSnap(moveStep && !alt ? moveStep : null); tc.setRotationSnap(null); };   // le cran des rotations : applique ici, apres la demultiplication
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
      // centrees l'une sur l'autre seulement entre deux faces planes de meme taille (une coupe et son vis-a-vis) ; sinon
      // la piece se cale la ou l'on a clique (30/10/2026 : elle partait au centre de toute la face de l'objet)
      const twinish = A.region && B.region && !A.region.relaxed && !B.region.relaxed
        && Math.max(A.region.area, B.region.area) < 1.6 * Math.min(A.region.area, B.region.area);
      if (twinish) {
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

  // les faces jumelles (30/10/2026, assemblyTwins) : en Coller assiste, la face touchee sur la piece a coller fait chercher
  // sur les autres pieces les faces de meme contour (la coupe d'en face), surlignees en vert avec leur ressemblance ; le
  // second toucher, sur l'une d'elles ou seulement sur sa piece, pose la piece exactement dessus. Quand plusieurs angles
  // vont aussi bien (une face carree, ronde), « ↻ Autre position » passe au suivant
  let twinsLib = null, twinSearch = null, twinFor = null, twinAlt = null;
  const twinMarks = new THREE.Group(); twinMarks.renderOrder = 998; holder.add(twinMarks);
  const twinMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.5, depthTest: false, side: THREE.DoubleSide });
  const clearTwins = () => {
    twinMarks.children.slice().forEach(m => { m.geometry?.dispose(); if (m.material !== twinMat) { m.material.map?.dispose(); m.material.dispose(); } twinMarks.remove(m); });
    twinSearch = null; twinFor = null;
  };
  const meshMat = (g, mesh) => { g.updateMatrix(); mesh.updateMatrix(); return g.matrix.clone().multiply(mesh.matrix); };
  const drawTwins = list => {
    const L = Math.max(10, boxOfAll(all.filter(g => g.visible)).getSize(new THREE.Vector3()).length());
    for (const t of list) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(twinsLib.trianglesOf(t.mesh.geometry, t.reg, meshMat(t.g, t.mesh)), 3));
      const m = new THREE.Mesh(geo, twinMat); m.renderOrder = 998;
      m.position.copy(t.face.n).multiplyScalar(0.05);
      twinMarks.add(m);
      // la pastille, de taille fixe a l'ecran et posee en haut a droite de la face : grande et au centre, elle cachait
      // l'endroit a toucher (30/10/2026)
      const s = label(String(Math.round(t.fits[0].score * 100)), "#16a34a");
      s.material.sizeAttenuation = false; s.material.opacity = 0.9; s.scale.setScalar(0.055); s.center.set(-0.35, -0.35);
      s.position.copy(t.face.c).addScaledVector(t.face.n, L * 0.002); twinMarks.add(s);
    }
    render();
  };
  // une face jumelle deja occupee : juste devant elle (moins de 0,8 mm), une autre piece, en plusieurs points de la face
  // une face deja prise : une autre piece posee dessus -- y compris une piece du meme groupe (30/10/2026 : le haut du
  // pantalon, groupe avec la chemise posee dessus, etait encore propose) ; le rayon voit les deux cotes des faces (une
  // piece qui s'y enfonce un peu) ; pas plus loin que 0,8 mm (plus loin, les tenons dans leur logement passaient pour pris)
  const occupied = (t, skip) => {
    const targets = all.filter(g => g.visible && g !== t.g && !skip.has(g)).flatMap(g => g.children.filter(c => c.isMesh));
    if (!targets.length) return false;
    holder.updateMatrixWorld(true);
    const tri = t.face.tri, nt = tri.length / 9, pts = [t.face.c.clone()];
    for (let k = 0; k < 6 && nt; k++) {
      const i = Math.floor((k + 0.5) / 6 * nt) * 9;
      pts.push(new THREE.Vector3((tri[i] + tri[i + 3] + tri[i + 6]) / 3, (tri[i + 1] + tri[i + 4] + tri[i + 7]) / 3, (tri[i + 2] + tri[i + 5] + tri[i + 8]) / 3));
    }
    const dir = t.face.n.clone().transformDirection(holder.matrixWorld);
    const rc = new THREE.Raycaster();
    const sides = targets.map(m => [m, m.material.side]);
    sides.forEach(([m]) => { m.material.side = THREE.DoubleSide; });
    let hits = 0;
    try {
      for (const p of pts) {
        const o = holder.localToWorld(p.clone().addScaledVector(t.face.n, -0.3));
        rc.set(o, dir); rc.far = 1.1;
        if (rc.intersectObjects(targets, false).length) hits++;
      }
    } finally { sides.forEach(([m, sd]) => { m.material.side = sd; }); }
    return hits >= Math.ceil(pts.length / 2);
  };
  // quiet : lance seul apres un collage -- rien n'est dit s'il n'y a rien a gagner ; rend vrai si la piece a bouge
  // le calcul d'emboiter / aligner pour la selection collee (sans rien deplacer) : { r, j, N, moving, touching, still }, ou
  // { why } ; quiet : les seuils d'un ajustement automatique (un gain net, sinon rien)
  const fitCore = async (mode, quiet = false) => {
    const list = [...sel], j = jointOf(list);
    if (!j) return { why: "nojoint" };
    const col = await getCollider();
    const { nestPlace } = await import("./assemblyNest");
    const moving = withKids(list), { P, N } = contact(j);
    // les autres pieces ne se traversent pas (la piece support ne compte pas : le contact avec elle est deja regle par
    // les cartes de hauteur, et son relief -- un tricot autour de l'empreinte d'un bec -- faisait refuser toutes les
    // places) ; une tolerance d'un millimetre (la piece amincie d'autant) : un frottement de relief n'est pas une
    // collision ; si la piece chevauche deja une autre piece la ou on l'a collee, le test ne bloque rien
    const sup = new Set(unitOf(j.b));
    const others = all.filter(g => g.visible && !moving.includes(g) && !sup.has(g));
    const hit = M => col.anyTouch(moving.map(g => { g.updateMatrix(); return [g, M.clone().multiply(g.matrix)]; }), others, 1);
    const collides = others.length && !hit(new THREE.Matrix4()) ? hit : null;
    const base = unitOf(j.b).filter(g => g.visible && !moving.includes(g));
    let r = await nestPlace({ THREE, collider: col, moving, base, P, N, mode, collides });
    // toutes les places touchent une autre piece : la meilleure quand meme, en le disant (refuser tout ne laissait rien a faire)
    let touching = false;
    if (r && !r.M) { r = await nestPlace({ THREE, collider: col, moving, base, P, N, mode }); touching = true; }
    if (!r) return { why: "none" };
    // rien ne bouge sans un gain net (32 mm de chemin pour 0,1 mm plus bas ; un alignement sans face trouvee tournait
    // quand meme la piece) : emboiter, au moins 0,3 mm plus bas ; aligner, une face reellement recouverte, et mieux
    const still = (r.moved < 0.05 && Math.abs(r.turned) < 0.1 && Math.abs(r.sink) < 0.05)
      || (mode === "nest" && r.sink < 0.3)
      || (mode === "align" && (r.cov1 < (quiet ? 0.3 : 0.1) || r.cov1 < r.cov0 + (quiet ? 0.05 : 0.01)));
    return { r, j, N, moving, touching, still };
  };
  // une place trouvee, appliquee : la piece, son point de contact (dans le repere du support), l'axe des rotations
  const applyFit = f => {
    apply(f.moving, f.r.M);
    f.j.b.updateMatrix();
    f.j.p.copy(f.r.contact.clone().applyMatrix4(f.j.b.matrix.clone().invert()));
    pivot = { p: f.r.contact.clone(), axis: f.N.clone().normalize(), unit: f.moving };
  };
  const fitText = (mode, r) => {
    const mm = x => String(Math.round(x * 10) / 10).replace(".", ",");
    const moved = `déplacée de ${mm(r.moved)} mm${Math.abs(r.turned) >= 0.5 ? `, tournée de ${Math.round(r.turned)}°` : ""}`;
    return mode === "align" ? `alignée : les deux faces se recouvrent à ${Math.round(r.cov1 * 100)} % (avant ${Math.round(r.cov0 * 100)} %)${r.clash > 0.02 ? `, ${Math.round(r.clash * 100)} % de la pièce en conflit` : ""}, ${moved}`
      : `emboîtée : ${r.sink >= 0.05 ? `${mm(r.sink)} mm plus bas` : "même hauteur"}, ${moved}`;
  };
  // quiet : lance seul apres un collage -- rien n'est dit s'il n'y a rien a gagner ; rend vrai si la piece a bouge
  const fitOnContact = async (mode, quiet = false) => {
    const said = fitMsg;
    const say = m => { fitMsg = quiet && m !== null ? (said || fitMsg) : m; onChange?.(state()); return false; };
    if (!jointOf([...sel])) return say(mode === "align" ? "Colle d'abord la pièce sur la face où l'aligner (🧲 Coller), puis 📐 Aligner"
      : "Colle d'abord la pièce sur celle où elle doit s'emboîter (🧲 Coller), puis 🧩 Emboîter");
    say(mode === "align" ? "Recherche de la place où la pièce déborde le moins…" : "Recherche de la place où la pièce s'emboîte…");
    await new Promise(r => setTimeout(r, 30));
    try {
      const f = await fitCore(mode, quiet);
      if (f.why === "none") return say(mode === "align" ? "Pas de place où elle repose à plat sur cette face, autour de là où elle est collée (une face courbe : 🎯 Ajuster)"
        : "Pas de place trouvée autour de là où elle est collée : la pièce déborde de son support partout");
      if (f.why) return say(null);
      if (f.still) return say(mode === "align" ? (f.r.cov1 < 0.3 ? "Pas de face plane à épouser sous la pièce : elle reste où elle est (🎯 Ajuster pour une face courbe)" : "Déjà alignée au mieux")
        : "Déjà à la meilleure place : elle ne descend pas plus bas autour de là où elle est collée");
      applyFit(f);
      showContact(); placeHandle(); push(); render();
      egg(mode === "align" ? "aligne" : "emboite");
      fitMsg = (quiet ? "Collée, puis " : "") + fitText(mode, f.r);
      if (!quiet) fitMsg = fitMsg[0].toUpperCase() + fitMsg.slice(1);
      if (f.touching) fitMsg += " — elle touche une autre pièce à cette place";
      onChange?.(state());
      return true;
    } catch (e) { console.error("[3D] emboiter / aligner", e); return say("La recherche a échoué"); }
  };
  // apres un collage au jugé (sans face jumelle) : la piece s'emboite dans le creux autour, sinon s'aligne sur la forme
  // de la face (30/10/2026 : on la collait dans son trou, puis il fallait la deplacer et la tourner a la main)
  let autoFit = true;
  // eteint par defaut (30/10/2026 : la piece bougeait d'elle-meme apres le collage, on ne savait plus pourquoi)
  try { autoFit = localStorage.getItem("bn.asm.autofit") === "1"; } catch { autoFit = false; }
  const settle = async () => { if (!autoFit) return; if (!(await fitOnContact("nest", true))) await fitOnContact("align", true); };
  // un point de colle de plus, le premier collage tenu : la piece tourne autour de la normale du contact et glisse dans
  // son plan, jusqu'a ce que la nouvelle prise vienne sur sa cible -- deux aretes : alignees (et l'une sur l'autre), deux
  // faces : face a face (et l'une contre l'autre), des points : superposes (a partir de deux, au mieux pour tous)
  const pinOnContact = (A, B, j) => {
    const unit = unitOf(A.group), moving = withKids(unit), { P, N } = contact(j), w = N.clone().normalize();
    const flat = v => v.clone().addScaledVector(w, -v.dot(w));
    const angle = (a, b) => Math.atan2(a.clone().cross(b).dot(w), a.dot(b));
    let th = 0, t = new THREE.Vector3(), kind = A.kind === "edge" && B.kind === "edge" ? "edge" : A.kind === "face" && B.kind === "face" && A.n && B.n ? "face" : "point";
    const rot = (v, a) => v.clone().sub(P).applyAxisAngle(w, a).add(P);
    if (kind === "edge") {
      const da = flat(A.e), db = flat(B.e);
      if (da.lengthSq() < 1e-6 || db.lengthSq() < 1e-6) kind = "point";
      else {
        da.normalize(); db.normalize();
        const t1 = angle(da, db), t2 = angle(da, db.clone().negate());
        th = Math.abs(t1) <= Math.abs(t2) ? t1 : t2;
        const off = flat(B.p.clone().sub(rot(A.p, th))), dbn = db;
        t = off.addScaledVector(dbn, -off.dot(dbn));                  // l'une sur l'autre ; le long de l'arete, libre
      }
    }
    if (kind === "face") {
      const na = flat(A.n), nb = flat(B.n).negate();
      if (na.lengthSq() < 1e-4 || nb.lengthSq() < 1e-4) kind = "point";
      else {
        na.normalize(); nb.normalize();
        th = angle(na, nb);
        const d = B.p.clone().sub(rot(A.p, th)).dot(nb);
        t = nb.clone().multiplyScalar(d);                               // face contre face ; dans son plan, libre
      }
    }
    if (kind === "point") {
      keepPins.push({ ag: A.group, bg: B.group, a: toLocal(A.group, A.p), b: toLocal(B.group, B.p) });
      const pts = keepPins.filter(k => unit.includes(k.ag)).map(k => [toWorld(k.ag, k.a), toWorld(k.bg, k.b)]);
      if (pts.length === 1) t = flat(pts[0][1].clone().sub(pts[0][0]));
      else {
        // au mieux pour tous les points, dans le plan du contact (Procuste a deux dimensions)
        const ca = new THREE.Vector3(), cb = new THREE.Vector3();
        pts.forEach(([a, b]) => { ca.add(a); cb.add(b); }); ca.divideScalar(pts.length); cb.divideScalar(pts.length);
        let sc = 0, ss = 0;
        for (const [a, b] of pts) { const x = flat(a.clone().sub(ca)), y = flat(b.clone().sub(cb)); sc += x.dot(y); ss += x.clone().cross(y).dot(w); }
        th = Math.atan2(ss, sc);
        t = flat(cb.clone().sub(rot(ca, th)));
      }
    }
    const M = new THREE.Matrix4().makeTranslation(t.x, t.y, t.z).multiply(about(P, new THREE.Quaternion().setFromAxisAngle(w, th)));
    apply(moving, M);
    // le contact suit la piece (il glisse avec elle sur le support)
    j.b.updateMatrix();
    j.p.copy(P.clone().applyMatrix4(M).applyMatrix4(j.b.matrix.clone().invert()));
    pivot = { p: P.clone().applyMatrix4(M), axis: w, unit: moving };
    showContact(); placeHandle(); push(); setSel(unit);
    const mm = x => String(Math.round(x * 10) / 10).replace(".", ",");
    fitMsg = `Collée : point de colle ajouté (${kind === "edge" ? "arêtes alignées" : kind === "face" ? "faces l'une contre l'autre" : `${keepPins.filter(k => unit.includes(k.ag)).length} point(s)`}), le premier collage tient — glissée de ${mm(t.length())} mm${Math.abs(th) > 0.005 ? `, tournée de ${Math.round(th * 180 / Math.PI)}°` : ""}`;
    egg("point_de_colle");
    render(); onChange?.(state());
  };
  const startTwins = A => {
    clearTwins();
    if (!assist || A.kind !== "face" || !A.mesh?.geometry?.attributes?.position) return;
    const unit = sel.has(A.group) ? [...sel] : unitOf(A.group), skip = new Set(withKids(unit));
    const others = all.filter(g => g.visible && !skip.has(g));
    if (!others.length) return;
    fitMsg = "Recherche des faces jumelles…"; onChange?.(state());
    const run = (async () => {
      await new Promise(r => setTimeout(r, 0));                // la consigne s'affiche d'abord
      if (!twinsLib) { const { createTwins } = await import("./assemblyTwins"); twinsLib = createTwins(THREE, neighbours); }
      return twinsLib.search({ g: A.group, mesh: A.mesh, tri: A.tri }, others, meshMat);
    })().catch(e => { console.error("[3D] faces jumelles", e); return null; });
    twinSearch = run; twinFor = A;
    run.then(r => {
      if (twinFor !== A) return;                               // deja colle, ou une autre face touchee
      // seules les nettes sont surlignees (une petite face ronde ressemble a beaucoup d'autres) ; les autres servent
      // quand on touche leur piece
      // une face deja prise (une autre piece posee dessus) n'est pas proposee (30/10/2026)
      if (r) r.twins = r.twins.filter(t => !occupied(t, skip));
      const best = r?.twins[0]?.fits[0].score || 0, shown = (r?.twins || []).filter(t => t.fits[0].score >= Math.max(0.88, best - 0.05));
      const n = shown.length;
      shown.forEach(t => { t.shown = true; });
      if (n) drawTwins(shown);
      fitMsg = n ? `${n === 1 ? "Une face jumelle" : `${n} faces jumelles`} en vert (% de ressemblance) : touche ${n === 1 ? "la face verte" : "celle qui va avec"} ; ailleurs, la pièce se colle au point touché`
        : r ? "Pas de face jumelle : touche l'endroit où la coller" : "Face courbe : touche l'endroit où la coller";
      onChange?.(state());
    });
  };
  // poser la piece sur sa jumelle, a la position choisie parmi les meilleures
  const placeTwin = () => {
    const s = twinAlt, f = s.fits[s.i];
    for (const [g, m0] of s.start) { f.M.clone().multiply(m0).decompose(g.position, g.quaternion, g.scale); g.updateMatrix(); }
    const { c, n } = s.face;
    pivot = { p: c.clone(), axis: n.clone(), unit: s.start.map(([g]) => g) };
    s.g.updateMatrix();
    const inv = s.g.matrix.clone().invert();
    joints = joints.filter(j => !s.unit.includes(j.a));
    joints.push({ a: s.a, b: s.g, kind: "face", p: c.clone().applyMatrix4(inv), n: n.clone().transformDirection(inv), e: null });
    pairs = [pairOf({ group: s.a, kind: "face", n: n.clone().negate() }, { group: s.g, kind: "face", n }, c, c)];
    push(); s.at = changes; setSel(s.unit);
    const k = s.fits.length;
    fitMsg = `Collée sur sa face jumelle · ${Math.round(f.score * 100)} % de recouvrement${k > 1 ? ` · position ${s.i + 1}/${k} : ↻ Autre position` : ""}`;
    onChange?.(state()); render();
  };
  const mateTwin = (A, t) => {
    const unit = sel.has(A.group) ? [...sel] : unitOf(A.group);
    if (unit.includes(t.g) || withKids(unit).includes(t.g)) return false;
    const best = t.fits[0].score;
    twinAlt = { a: A.group, unit, g: t.g, face: t.face, i: 0, fits: t.fits.filter(f => f.score >= best - 0.08),
      start: withKids(unit).map(g => { g.updateMatrix(); return [g, g.matrix.clone()]; }) };
    placeTwin();
    egg("faces_jumelles");
    return unit;
  };
  // la jumelle visee par le second toucher : celle touchee, sinon la plus proche du toucher sur la piece touchee (ou son groupe)
  // la jumelle touchee : sur sa face, ou tout pres d'une face verte ; ailleurs sur la piece, aucune (30/10/2026 : toucher
  // n'importe ou sur la piece la posait sur sa jumelle, on ne pouvait plus la coller ailleurs)
  const twinAt = (r, pick) => {
    const on = r?.twins.filter(t => unitOf(pick.group).includes(t.g)) || [];
    if (!on.length) return null;
    const hit = pick.mesh && on.find(t => t.mesh === pick.mesh && twinsLib.regionOfTri(pick.mesh.geometry, pick.tri) === t.reg);
    if (hit) return hit;
    const near = on.filter(t => t.shown && t.face.c.distanceTo(pick.p) <= Math.max(3, Math.sqrt(t.face.area) * 0.6));
    return near.reduce((m, t) => (!m || t.face.c.distanceTo(pick.p) < m.face.c.distanceTo(pick.p) ? t : m), null);
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
    tap(pick, ev);
  };
  // ce que fait un toucher, selon le mode (une prise : la piece, sa face ou son arete ; ou rien)
  const tap = (pick, ev) => {
    if (mode === "cut") { if (!pendingCut) setSel(pick ? [pick.group] : []); return; }
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
    if (!pick) { if (!ev.ctrlKey && !ev.shiftKey && !multi) { first = null; clearMarks(); clearTwins(); setSel([]); render(); onChange?.(state()); } return; }
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
      if (!first) { first = pick; clearMarks(); mark(pick); onChange?.(state()); if (!addPin) startTwins(pick); return; }
      const A = first;
      first = null; clearMarks();
      if (addPin) {
        const j = jointOf(unitOf(A.group));
        if (!j || !unitOf(j.b).includes(pick.group)) {
          fitMsg = j ? `La seconde prise se met sur ${j.b.userData.name}, la pièce où elle est collée` : "Colle d'abord la pièce (premier collage), puis ➕ Point de colle";
          onChange?.(state()); return;
        }
        pinOnContact(A, pick, j); return;
      }
      const search = twinFor === A ? twinSearch : null;
      twinFor = null;
      if (search && !ev.shiftKey && !multi) {
        // les jumelles (la recherche finit si elle tourne encore) ; sans jumelle sur la piece touchee : le collage d'avant
        fitMsg = "Recherche des faces jumelles…"; onChange?.(state());
        search.then(r => {
          clearTwins(); fitMsg = null;
          const t = twinAt(r, pick);
          if (!(t && mateTwin(A, t))) {
            // des jumelles proposees, et touche ailleurs : la piece vient la ou l'on a touche (sa face centree sur ce
            // point), et non sur toute la face touchee (30/10/2026)
            const unit = mate(A, r?.twins?.some(x => x.shown) ? { ...pick, region: null, at: true } : pick);
            if (unit) { pairs = [pairOf(A, pick, pivot ? pivot.p : pick.p, pivot ? pivot.p : pick.p)]; push(); setSel(unit); settle(); }
          }
          render(); onChange?.(state());
        });
        return;
      }
      clearTwins();
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
        settle();
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
    stepRound(want);
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

  // le couteau (30/10/2026) : en mode « Couper », un trait trace a travers la piece choisie la tranche dans toute
  // l'epaisseur vue a l'ecran, sur la longueur du trait ; les morceaux qui ne tiennent plus ensemble se separent (un
  // support integre qui ne tient que par quelques ponts). Un doigt ou le clic gauche trace ; deux doigts ou le clic droit
  // tournent la vue, la molette zoome. Plusieurs traits s'ajoutent avant de valider. Les coupes sont gardees avec
  // l'assemblage (piece entiere -> liste de secteurs, dans son repere) et refaites a l'ouverture
  const cuts = new Map(Object.entries(cutsInit || {}).filter(([, v]) => Array.isArray(v) && v.length));
  let stroke = null, viewWas = null;
  const knifeView = on => {
    if (on && !viewWas) {
      viewWas = { mb: { ...controls.mouseButtons }, t: { ...controls.touches } };
      controls.mouseButtons.LEFT = null; controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
      controls.touches.ONE = null; controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
      el.style.cursor = "crosshair";
    } else if (!on && viewWas) {
      Object.assign(controls.mouseButtons, viewWas.mb); Object.assign(controls.touches, viewWas.t); viewWas = null;
      el.style.cursor = "";
    }
  };
  const drawStroke = () => {
    const s = stroke, hr = host.getBoundingClientRect();
    Object.assign(s.div.style, { left: `${s.x0 - hr.left}px`, top: `${s.y0 - hr.top}px`, width: `${Math.hypot(s.x1 - s.x0, s.y1 - s.y0)}px`,
      transform: `rotate(${Math.atan2(s.y1 - s.y0, s.x1 - s.x0)}rad)` });
  };
  const dropStroke = () => { stroke?.div.remove(); stroke = null; };
  // la gomme (30/10/2026) : en mode Couper, « 🧽 Gomme » allumee, le glisser peint en rouge les triangles sous le
  // pinceau (sur la piece choisie, ses morceaux ou la coupe en cours) ; au lacher, ils se detachent en un morceau a part,
  // retire de l'assemblage a la validation. Pour les restes de supports, les bavures
  let eraser = false, rub = null;
  const rubMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.75, depthTest: false, side: THREE.DoubleSide });
  const centroids = new WeakMap();
  const centersOf = geo => {
    let c = centroids.get(geo);
    if (c) return c;
    const p = geo.attributes.position.array, ix = geo.index?.array, n = ix ? ix.length / 3 : p.length / 9;
    c = new Float32Array(n * 3);
    for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) { const v = ix ? ix[t * 3 + e] : t * 3 + e; for (let a = 0; a < 3; a++) c[t * 3 + a] += p[v * 3 + a] / 3; }
    centroids.set(geo, c);
    return c;
  };
  // les maillages que la gomme peut toucher : ceux de la piece visee (ses morceaux, ou la coupe proposee)
  const rubTargets = () => {
    if (pendingCut) return (pendingCut.parts.length ? pendingCut.parts : pendingCut.old).filter(g => g.visible);
    const g = sel.size === 1 ? [...sel][0] : null;
    if (!g || g.userData.copyOf) return [];
    return g.userData.from ? all.filter(x => x.userData.from === g.userData.from && !x.userData.copyOf && x.visible) : [g];
  };
  const drawRub = () => {
    for (const [mesh, set] of rub.marks) {
      if (mesh.userData.rubView) { mesh.remove(mesh.userData.rubView); mesh.userData.rubView.geometry.dispose(); }
      const p = mesh.geometry.attributes.position.array, ix = mesh.geometry.index?.array, out = new Float32Array(set.size * 9);
      let o = 0;
      for (const t of set) for (let e = 0; e < 3; e++) { const v = ix ? ix[t * 3 + e] : t * 3 + e; out[o++] = p[v * 3]; out[o++] = p[v * 3 + 1]; out[o++] = p[v * 3 + 2]; }
      const gg = new THREE.BufferGeometry(); gg.setAttribute("position", new THREE.BufferAttribute(out, 3));
      const view = new THREE.Mesh(gg, rubMat); view.renderOrder = 999; view.raycast = () => {};
      mesh.add(view); mesh.userData.rubView = view;
    }
    render();
  };
  const clearRub = () => {
    if (!rub) return;
    for (const mesh of rub.marks.keys()) if (mesh.userData.rubView) { mesh.remove(mesh.userData.rubView); mesh.userData.rubView.geometry.dispose(); delete mesh.userData.rubView; }
    rub = null; render();
  };
  const rubAt = ev => {
    const r = el.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(rub.targets.flatMap(g => g.children.filter(c => c.isMesh)), false)[0];
    if (!hit) return;
    // le rayon du pinceau : une douzaine de pixels a l'ecran, en mm a cette distance
    const px = coarse ? 20 : 12, mm = hit.distance * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / r.height * px;
    const mesh = hit.object, q = mesh.worldToLocal(hit.point.clone()), c = centersOf(mesh.geometry), r2 = mm * mm;
    let set = rub.marks.get(mesh);
    if (!set) rub.marks.set(mesh, set = new Set());
    const before = set.size;
    for (let t = 0; t < c.length / 3; t++) {
      const dx = c[t * 3] - q.x, dy = c[t * 3 + 1] - q.y, dz = c[t * 3 + 2] - q.z;
      if (dx * dx + dy * dy + dz * dz <= r2) set.add(t);
    }
    set.add(hit.faceIndex);
    if (set.size !== before) drawRub();
  };
  const rubEnd = () => {
    const rb = rub;
    if (!rb) return;
    rub = null;
    // les triangles gommes, nommes dans la geometrie d'ou viennent les morceaux (par maillage de la piece entiere)
    const erase = {};
    let g0 = null;
    for (const [mesh, set] of rb.marks) {
      if (!set.size) continue;
      const g = pieceOf(mesh) || rb.targets.find(x => x.children.includes(mesh));
      g0 = g0 || g;
      const whole = g.userData.from ? g.userData.whole : g;
      const src = mesh.userData.src, mi = src ? src.mi : whole.children.filter(m => m.isMesh && m.geometry?.attributes?.position).indexOf(mesh);
      const list = erase[mi] || (erase[mi] = []);
      for (const t of set) list.push(src ? src.tris[t] : t);
    }
    for (const mesh of rb.marks.keys()) if (mesh.userData.rubView) { mesh.remove(mesh.userData.rubView); mesh.userData.rubView.geometry.dispose(); delete mesh.userData.rubView; }
    if (!g0) { render(); return; }
    Object.values(erase).forEach(l => l.sort((a, b) => a - b));
    cutWith({ erase }, g0);
  };
  const onKnifeDown = ev => {
    if (mode !== "cut") return;
    if (stroke) { if (ev.pointerId !== stroke.id) dropStroke(); return; }      // un second doigt : c'est la vue
    if (rub) { if (ev.pointerId !== rub.id) clearRub(); return; }
    if (fingers > 1 || (ev.pointerType === "mouse" && ev.button !== 0)) return;
    if (eraser) {
      if (pendingCut && !pendingCut.parts.length) { fitMsg = "Des traits attendent : finis la coupe (ou ✕ efface-les) avant de gommer"; onChange?.(state()); return; }
      const targets = rubTargets();
      if (!targets.length) { fitMsg = "Touche d'abord la pièce à nettoyer, puis gomme les restes"; onChange?.(state()); return; }
      rub = { id: ev.pointerId, targets, marks: new Map() };
      rubAt(ev);
      return;
    }
    const div = document.createElement("div");
    div.style.cssText = "position:absolute;height:0;border-top:2.5px dashed #ef4444;transform-origin:0 0;pointer-events:none;z-index:5;filter:drop-shadow(0 0 2px #fff)";
    host.appendChild(div);
    stroke = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, x1: ev.clientX, y1: ev.clientY, div };
    drawStroke();
  };
  const onKnifeMove = ev => {
    if (rub && ev.pointerId === rub.id) { if (fingers > 1) clearRub(); else rubAt(ev); return; }
    if (stroke && ev.pointerId === stroke.id) { stroke.x1 = ev.clientX; stroke.y1 = ev.clientY; drawStroke(); }
  };
  const onKnifeUp = ev => {
    if (rub && ev.pointerId === rub.id) { rubEnd(); return; }
    if (!stroke || ev.pointerId !== stroke.id) return;
    const s = stroke;
    dropStroke();
    if (Math.hypot(s.x1 - s.x0, s.y1 - s.y0) >= 12) cutWith(s);              // plus court : un toucher, qui choisit la piece
  };
  const onKnifeCancel = ev => { if (stroke && ev.pointerId === stroke.id) dropStroke(); if (rub && ev.pointerId === rub.id) clearRub(); };
  el.addEventListener("pointerdown", onKnifeDown);
  window.addEventListener("pointermove", onKnifeMove);
  window.addEventListener("pointerup", onKnifeUp);
  window.addEventListener("pointercancel", onKnifeCancel);
  // la place d'un morceau (ou de la piece entiere) ramenee au repere de la piece entiere
  const wholeFrame = g => { g.updateMatrix(); const o = g.userData.from ? g.userData.c.clone().sub(g.userData.parentC) : new THREE.Vector3();
    return g.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z)); };
  const r6 = v => v.toArray().map(x => Math.round(x * 1e6) / 1e6);
  // s : le trait trace, ou « sup » : detacher les supports integres (reperes d'eux-memes, assemblySplit.supportTris)
  const cutWith = async (s, target = null) => {
    const g = pendingCut ? pendingCut.g : target || (sel.size === 1 ? [...sel][0] : null);
    const say = m => { fitMsg = m; onChange?.(state()); };
    const sup = s === "sup", rubbed = !!s?.erase || s === "clean";
    if (rubbed && pendingCut && target && (target.userData.from || target.userData.k) !== pendingCut.K && !pendingCut.parts.includes(target))
      return say("Valide ou annule d'abord la coupe en cours, puis gomme l'autre pièce");
    if (!g) return say(sup ? "Choisis d'abord la pièce dont détacher les supports" : "Touche d'abord la pièce à couper, puis trace un trait à travers elle");
    if (g.userData.copyOf) return say("Un exemplaire ajouté ne se coupe pas : coupe la pièce d'origine");
    const K = g.userData.from || g.userData.k, whole = g.userData.from ? g.userData.whole : g;
    if (!whole) return say("Cette pièce ne se coupe pas : réunis-la d'abord (🧩 Pièce, ⊕ Réunir)");
    // l'oeil et les deux bords du trait, dans le repere de la piece entiere
    let wedge = s === "clean" ? { clean: 1 } : rubbed ? { erase: s.erase } : { sup: 1 };
    if (!sup && !rubbed) {
      const r = el.getBoundingClientRect();
      const rayAt = (x, y) => { mouse.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera); return ray.ray.clone(); };
      holder.updateMatrixWorld(true);
      const inv = holder.matrixWorld.clone().multiply(wholeFrame(g)).invert();
      const r0 = rayAt(s.x0, s.y0), r1 = rayAt(s.x1, s.y1);
      wedge = { e: r0.origin.clone().applyMatrix4(inv).toArray().map(x => Math.round(x * 1e4) / 1e4),
        a: r6(r0.direction.clone().transformDirection(inv)), b: r6(r1.direction.clone().transformDirection(inv)) };
    }
    if (g !== whole) {
      // un morceau : la coupe reste dans sa boite (les autres morceaux de la piece ne sont pas touches)
      const bx = new THREE.Box3(), o = g.userData.c.clone().sub(g.userData.parentC);
      g.children.forEach(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); bx.union(m.geometry.boundingBox); } });
      bx.translate(o).expandByScalar(0.3);
      wedge.box = [...bx.min.toArray(), ...bx.max.toArray()].map(x => Math.round(x * 100) / 100);
    }
    const base = pendingCut ? pendingCut.cuts : (cuts.get(K) || []), next = [...base, wedge];
    say(sup ? "Recherche des supports…" : "Découpe…");
    await new Promise(res => setTimeout(res, 0));
    const { splitPieceGeometry, buildSplitGroups } = await import("./assemblySplit");
    const info = {}, comps = splitPieceGeometry(THREE, whole, next, info);
    if (!info.lastHits) return say(s === "clean" ? "Rien à nettoyer sur cette pièce : rien ne pend ni ne tient par un coin (la 🧽 Gomme reste là pour le reste)"
      : rubbed ? "Rien de gommé : passe la gomme sur la pièce" : sup ? "Pas de support reconnu sur cette pièce (parois ou plaques fines, à faces planes) : coupe-les au couteau, un trait par jointure"
      : "Ce trait ne traverse pas la pièce : trace-le à travers elle, d'un bord à l'autre de la jointure");
    let pc = pendingCut;
    if (!pc) {
      // ce qu'il y avait avant : la piece entiere, ou ses morceaux ; et a quel morceau appartenait chaque triangle
      const old = g.userData.from ? all.filter(x => x.userData.from === K && !x.userData.copyOf) : [g];
      const prev = g.userData.from ? splitPieceGeometry(THREE, whole, base.length ? base : null) : null;
      pc = { K, g, whole, old, vis: old.map(x => x.visible), oldOwn: prev?.owner || null, base: base.length, parts: [] };
      pendingCut = pc;
    }
    pc.cuts = next;
    drawCuts();
    // plusieurs jointures (30/10/2026) : un trait qui ne detache encore rien est garde, la piece se separe quand toutes
    // sont tranchees
    if (!comps || comps.length <= (pc.parts.length || pc.old.length)) {
      const n = pc.cuts.length - pc.base;
      tc.detach(); render();
      return say(pc.parts.length ? `Trait ${n} gardé : il ne détache rien de plus ; trace les autres jointures, ou ✓ Couper`
        : `Trait ${n} gardé (en rouge) : la pièce tient encore ailleurs ; trace les autres jointures, elle se sépare quand tout est tranché`);
    }
    pc.parts.forEach(p => { holder.remove(p); p.children.forEach(m => { m.geometry.dispose(); m.material.dispose(); }); });
    const parts = buildSplitGroups(THREE, whole, comps);
    // chaque nouveau morceau vient de l'ancien qui avait le plus de ses triangles d'origine (un triangle deja coupe
    // appartient aux deux cotes : un seul ne suffit pas) et garde sa place
    const votes = parts.map(() => new Map());
    if (pc.oldOwn) comps.owner.forEach((own, mi) => { for (let t = 0; t < own.length; t++) {
      const j = own[t], i = pc.oldOwn[mi][t];
      if (j >= 0 && i >= 0) votes[j].set(i, (votes[j].get(i) || 0) + 1);
    } });
    const src = votes.map(v => {
      const best = [...v].sort((x, y) => y[1] - x[1])[0];
      return (best && byKey.get(`${K}:${best[0]}`)) || pc.old[0];
    });
    const tints = [0xef4444, 0x22c55e, 0x3b82f6, 0xf59e0b, 0xa855f7, 0x06b6d4, 0xec4899, 0x84cc16];
    parts.forEach((p, j) => {
      const o = src[j] || pc.old[0], cc = p.userData.c.clone().sub(p.userData.parentC);
      wholeFrame(o).multiply(new THREE.Matrix4().makeTranslation(cc.x, cc.y, cc.z)).decompose(p.position, p.quaternion, p.scale);
      p.updateMatrix();
      p.userData.excluded = !!o.userData.excluded;
      p.visible = pc.vis[pc.old.indexOf(o)] !== false && !o.userData.excluded;
      holder.add(p);
      p.children.forEach(m => { m.material.emissive = new THREE.Color(tints[j % tints.length]); m.material.emissiveIntensity = 0.55; });
    });
    pc.old.forEach(x => { x.visible = false; });
    pc.parts = parts; pc.src = src; pc.marks = comps.map(c => c.mark);
    // ce qui est gomme est montre en rouge vif jusqu'a la validation
    parts.forEach((p, j) => { if (pc.marks[j] === 2) p.children.forEach(m => { m.material.emissive = new THREE.Color(0xff0000); m.material.emissiveIntensity = 0.9; }); });
    tc.detach(); fitMsg = null; render(); onChange?.(state());
  };
  // les traits deja donnes, en rouge sur la piece (le secteur coupe, a la profondeur du morceau vise)
  const cutLines = new THREE.Group(); cutLines.renderOrder = 1000; holder.add(cutLines);
  const cutMat = new THREE.LineBasicMaterial({ color: 0xef4444, depthTest: false, transparent: true, opacity: 0.95 });
  const drawCuts = () => {
    cutLines.children.slice().forEach(l => { l.geometry.dispose(); cutLines.remove(l); });
    const pc = pendingCut;
    if (!pc) { render(); return; }
    const M = wholeFrame(pc.g), o = pc.g.userData.from ? pc.g.userData.c.clone().sub(pc.g.userData.parentC) : new THREE.Vector3();
    const bx = new THREE.Box3();
    pc.g.children.forEach(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); bx.union(m.geometry.boundingBox); } });
    const mid = bx.getCenter(new THREE.Vector3()).add(o);
    for (const w of pc.cuts.slice(pc.base).filter(x => x.e)) {           // les traits seulement (ni supports ni gomme)
      const E = new THREE.Vector3().fromArray(w.e), A = new THREE.Vector3().fromArray(w.a), Bd = new THREE.Vector3().fromArray(w.b);
      const t = mid.clone().sub(E).dot(A.clone().add(Bd).normalize());
      const pts = [E.clone().addScaledVector(A, t / Math.max(0.2, A.dot(A.clone().add(Bd).normalize()))), E.clone().addScaledVector(Bd, t / Math.max(0.2, Bd.dot(A.clone().add(Bd).normalize())))]
        .map(p => p.applyMatrix4(M));
      cutLines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), cutMat));
    }
    render();
  };
  const cutCancel = () => {
    const pc = pendingCut;
    if (!pc) return;
    pendingCut = null;
    drawCuts();
    pc.parts.forEach(p => { holder.remove(p); p.children.forEach(m => { m.geometry.dispose(); m.material.dispose(); }); });
    pc.old.forEach((x, i) => { x.visible = pc.vis[i]; });
    render(); onChange?.(state());
  };
  const cutConfirm = () => {
    const pc = pendingCut;
    if (!pc || !pc.parts.length) return;
    pendingCut = null;
    drawCuts();
    pc.parts.forEach(p => p.children.forEach(m => {           // leur couleur d'origine
      const s0 = pc.whole.children.find(x => x.isMesh && x.material.color.equals(m.material.color));
      m.material.emissive = s0 ? s0.material.emissive.clone() : new THREE.Color(0); m.material.emissiveIntensity = s0 ? s0.material.emissiveIntensity : 1;
    }));
    const firstOf = o => pc.parts[pc.src.indexOf(o)] || pc.parts[0];
    const oldKeys = new Map(pc.old.map(o => [o.userData.k, o]));
    pc.old.forEach(o => { holder.remove(o); pieces.delete(o.userData.pid); });
    pc.parts.forEach(p => pieces.set(p.userData.pid, p));
    // les exemplaires ajoutes d'un ancien morceau suivent le nouveau qui en garde le plus
    for (const cp of all) {
      const o = cp.userData.copyOf && oldKeys.get(cp.userData.copyOf);
      if (!o) continue;
      const nb = firstOf(o).userData.k, n = String(cp.userData.k).split("#")[1];
      cp.userData.copyOf = nb; cp.userData.k = `${nb}#${n}`;
    }
    reindex();
    const derived = o => pc.parts.filter((p, j) => pc.src[j] === o);
    groups = groups.map(gr => gr.flatMap(x => (pc.old.includes(x) ? derived(x) : [x]))).filter(gr => gr.length > 1);
    // un collage sur un ancien morceau passe au nouveau qui en garde le plus (son point, ramene a son repere)
    joints = joints.map(j => {
      const a = pc.old.includes(j.a) ? firstOf(j.a) : j.a;
      if (!pc.old.includes(j.b)) return { ...j, a };
      const b = firstOf(j.b);
      j.b.updateMatrix(); b.updateMatrix();
      return { ...j, a, b, p: j.p.clone().applyMatrix4(j.b.matrix).applyMatrix4(b.matrix.clone().invert()) };
    }).filter(j => j.a !== j.b);
    const fresh = pc.cuts.slice(pc.base);
    // ce qui a ete gomme quitte l'assemblage (il reste dans la liste des pieces, a remettre au besoin)
    pc.parts.forEach((p, j) => { if (pc.marks?.[j] === 2) { p.userData.excluded = true; p.visible = false; } });
    cuts.set(pc.K, pc.cuts);
    resetHistory();
    egg(fresh.some(x => x.erase || x.clean) ? "coup_de_gomme" : fresh.some(x => x.sup) ? "sans_echafaudage" : "couteau");
    fitMsg = `Coupée : ${pc.parts.length} morceaux, chacun se choisit, se déplace ou se retire de l'assemblage (📋 Pièces)`;
    setSel(derived(pc.g));
    fitMsg = fresh.some(x => x.erase || x.clean) ? "Nettoyé : retiré de l'assemblage (📋 Pièces : ↩ pour le remettre)"
      : `Coupée : ${pc.parts.length} morceaux, chacun se choisit, se déplace ou se retire de l'assemblage (📋 Pièces)`;
    onChange?.(state());
  };
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
    if (ev.button !== 0 || !sel.size || tc.axis || mode === "cut") return;
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
      stepRound(d, ev.altKey);
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
      if (k === "x") return api.setMode("cut");
      if (k === "enter" && mode === "cut" && pendingCut) return cutConfirm();
      if (k === "escape" && mode === "cut" && pendingCut) { ev.preventDefault(); ev.stopPropagation(); return cutCancel(); }
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
      first = null; clearMarks(); clearTwins(); setSel([]); render(); onChange?.(state());
    }
    else if (sel.size && ev.key.startsWith("Arrow") && jointOf([...sel])) {
      // collee : les fleches la font glisser sur le contact, d'apres l'ecran
      ev.preventDefault();
      const k = ev.key;
      api.nudge(k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0, k === "ArrowUp" ? 1 : k === "ArrowDown" ? -1 : 0, 0, ev.shiftKey ? 10 : 1);
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
    setMode: m => { if (m !== "mate") { addPin = false; keepPins = []; } if (m !== "cut") { cutCancel(); dropStroke(); clearRub(); } knifeView(m === "cut"); if (m !== "pins") pinsClear(); if (m !== "ground") { gPts = []; gUnit = []; drawGround(); } mode = m; first = null; clearTwins(); if (m !== "mate") pairs = []; pivot = m === "mate" ? pivot : null; clearMarks(); placeHandle(); shade(); render(); onChange?.(state()); },
    setMagnet: on => { magnet = on; applySnap(); onChange?.(state()); },
    setRotStep: d => { rotStep = d; applySnap(); onChange?.(state()); },
    setMoveStep: d => { moveStep = d; try { localStorage.setItem("bn.asm.moveStep", String(d)); } catch { /* rien */ } applySnap(); onChange?.(state()); },
    setMulti: on => { multi = on; onChange?.(state()); },
    // au doigt : glisser monte ou descend la piece au lieu de la faire glisser a plat
    setVertical: on => { vertical = on; onChange?.(state()); },
    // un pas de cote, en avant, en hauteur, d'apres l'ecran : droite / loin / haut (r, f, u : -1, 0 ou 1), de s mm ;
    // suivant l'axe du plateau le plus proche de la direction vue (un pas net, en X ou en Y)
    // collee (30/10/2026) : dans le plan du contact seulement, suivant l'axe de la face le plus proche de la droite de
    // l'ecran (◀ ▶) et du haut de l'ecran (▲ ▼) ; le point de contact suit
    nudge: (r, f, u, s = 1) => {
      if (!sel.size) return;
      holder.updateMatrixWorld(true);
      const inv = new THREE.Matrix3().setFromMatrix4(holder.matrixWorld).invert();
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).applyMatrix3(inv);
      const j = jointOf([...sel]);
      if (j) {
        const fr = contactFrame(j), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).applyMatrix3(inv);
        const signed = (ax, v) => ax.clone().multiplyScalar(Math.sign(ax.dot(v)) || 1);
        let ar, af;
        if (fr.edge) { ar = signed(fr.x, right); af = signed(fr.x, up); }
        else if (Math.abs(fr.x.dot(right)) >= Math.abs(fr.y.dot(right))) { ar = signed(fr.x, right); af = signed(fr.y, up); }
        else { ar = signed(fr.y, right); af = signed(fr.x, up); }
        const t = ar.multiplyScalar(r * s).addScaledVector(af, f * s);
        if (t.lengthSq() < 1e-12) return;
        apply(withKids([...sel]), new THREE.Matrix4().makeTranslation(t.x, t.y, t.z));
        j.b.updateMatrix(); j.p.add(t.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(j.b.matrix).invert()));
        showContact(); placeHandle(); push(); render();
        return;
      }
      const fwd = camera.getWorldDirection(new THREE.Vector3()).applyMatrix3(inv);
      const axis = v => (Math.abs(v.x) >= Math.abs(v.y) ? new THREE.Vector3(Math.sign(v.x) || 1, 0, 0) : new THREE.Vector3(0, Math.sign(v.y) || 1, 0));
      const t = new THREE.Vector3().addScaledVector(axis(right), r * s).addScaledVector(axis(fwd), f * s);
      t.z += u * s;
      apply(withKids([...sel]), new THREE.Matrix4().makeTranslation(t.x, t.y, t.z)); placeHandle(); push(); render();
    },
    setTurnGlued: on => { turnGlued = on; onChange?.(state()); },
    pinsApply,
    // la position suivante sur la meme face jumelle (tant que rien d'autre n'a bouge depuis)
    twinNext: () => {
      if (!twinAlt || twinAlt.at !== changes || twinAlt.fits.length < 2) return;
      twinAlt.i = (twinAlt.i + 1) % twinAlt.fits.length;
      placeTwin();
    },
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
    cutConfirm, cutCancel,
    // le choix face / arete : survoler une ligne la surligne, la toucher la prend
    setEdgeMode: on => { edgeMode = on; onChange?.(state()); },
    setAutoFit: on => { autoFit = on; try { localStorage.setItem("bn.asm.autofit", on ? "1" : "0"); } catch { /* rien */ } onChange?.(state()); },
    setAddPin: on => {
      if (on && mode !== "mate") api.setMode("mate");
      addPin = on; first = null; keepPins = []; clearMarks(); clearTwins(); render();
      fitMsg = on ? "➕ Point de colle : touche un point, une arête ou une face de la pièce collée, puis l'endroit qui lui correspond sur la pièce où elle est collée" : null;
      onChange?.(state());
    },
    setEraser: on => { eraser = on; if (!on) clearRub(); onChange?.(state()); },
    // detacher les supports integres de la piece choisie : proposes en couleur, a valider comme une coupe
    cleanScraps: () => { if (mode !== "cut") api.setMode("cut"); return cutWith("clean"); },
    detachSupports: () => { if (mode !== "cut") api.setMode("cut"); return cutWith("sup"); },
    cuts: () => Object.fromEntries([...cuts].filter(([k, v]) => v.length && all.some(g => g.userData.from === k))),
    // remettre une piece separee d'un seul tenant
    reunite: () => {
      const from = [...sel].map(g => g.userData.from).find(Boolean);
      if (!from) return;
      const parts = all.filter(g => g.userData.from === from && !g.userData.copyOf);
      cuts.delete(from);
      // coupee au couteau : la piece entiere d'origine revient, a la place de son premier morceau (30/10/2026)
      const W = parts[0].userData.whole;
      if (W) {
        wholeFrame(parts[0]).decompose(W.position, W.quaternion, W.scale); W.updateMatrix();
        W.visible = true; W.userData.excluded = false;
        parts.forEach(g => { holder.remove(g); pieces.delete(g.userData.pid); });
        holder.add(W); pieces.set(W.userData.pid, W);
        reindex();
        groups = groups.map(gr => [...new Set(gr.map(g => (parts.includes(g) ? W : g)))]).filter(gr => gr.length > 1);
        joints = joints.map(j => ({ ...j, a: parts.includes(j.a) ? W : j.a, b: parts.includes(j.b) ? W : j.b })).filter(j => j.a !== j.b);
        resetHistory(); setSel([W]); return;
      }
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
    layFlat: () => layFlat(),
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
    // emboiter (30/10/2026) : la piece collee glisse et tourne sur son contact jusqu'a la place ou elle descend le plus
    // (un bloc dans son logement), sans rien traverser (assemblyNest)
    // emboiter / aligner (30/10/2026, assemblyNest) : la piece collee glisse et tourne sur son contact, autour de la ou
    // elle est collee : jusqu'a la place ou elle descend le plus (un bloc dans son logement), ou ou sa face d'appui
    // deborde le moins de celle qui la porte, centree (une plaque sur un flanc)
    nest: () => fitOnContact("nest"),
    tell: m => { fitMsg = m; onChange?.(state()); },
    align: () => fitOnContact("align"),
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
      el.removeEventListener("pointerdown", onKnifeDown); window.removeEventListener("pointermove", onKnifeMove);
      window.removeEventListener("pointerup", onKnifeUp); window.removeEventListener("pointercancel", onKnifeCancel);
      clearRub(); rubMat.dispose(); cutCancel(); dropStroke(); knifeView(false);
      holder.remove(cutLines); cutMat.dispose();
      holder.remove(ring); ring.geometry.dispose(); ringMat.dispose();
      try { tc.detach(); tc.disconnect(); } catch { /* deja debranchee */ }
      try { helper.traverse(o => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.dispose?.()); }); } catch { /* rien */ }
      scene.remove(helper); holder.remove(handle);
      clearMarks(); holder.remove(marks); markMat.dispose(); lineMat.dispose();
      clearTwins(); holder.remove(twinMarks); twinMat.dispose();
      // les pieces masquees reviennent, pas celles retirees de l'assemblage (30/10/2026 : elles restaient affichees
      // apres l'edition, jusqu'a rouvrir la vue)
      sel.clear(); shade(); all.forEach(g => { g.visible = !g.userData.excluded; });
      controls.enabled = true; render();
    },
  };
  onChange?.(state());
  // banc d'essai seulement : une prise le long d'un rayon donne dans le repere du modele, et le collage
  if (import.meta.env.DEV) api.__dev = {
    pick: (o, d) => { holder.updateMatrixWorld(true); ray.set(o.clone().applyMatrix4(holder.matrixWorld), d.clone().transformDirection(holder.matrixWorld).normalize()); return pickRay(); },
    mate: (A, B) => { const u = mate(A, B); if (u) { push(); setSel(u); } return u; },
    tap: (pick, ev = {}) => tap(pick, ev),
    twins: () => twinSearch,
  };
  return api;
}
