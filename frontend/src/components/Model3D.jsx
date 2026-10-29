import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { finishCanvas } from "../utils/finishTex";
import { egg } from "../eggs";
import { ColorPairs, chooseColor } from "./ColorMap";
import { FSheet } from "./FicheKit";
import client, { apiUrl } from "../api/client";
import { currentFriend } from "../store/friend";
import { useIsAdmin } from "../store/auth";
import { showAlert, showConfirm } from "../utils/dialog";
import MwImg from "./MwImg";
import { openVue3D } from "./Vue3DPicker";

// La vue 3D d'un modele (27/10/2026) : son 3MF d'origine garde sur le serveur (converti la-bas, aux couleurs de
// ses filaments), sinon l'apercu 3D de MakerWorld (sans couleurs). Un plateau a la fois ; on tourne au doigt
// ou a la souris, on zoome, on recentre. three.js n'est charge qu'ici, a l'ouverture.
const BED = [256, 256];          // le plateau par defaut ; le serveur donne celui de mon imprimante (A1 mini, H2D...)

// le format compact (29/10/2026, « 2V3B ») : positions sur 16 bits, indices en ecarts, octets ranges par rang
const BIN_MAGIC = 0x42335632, BIN_MAGIC_P = 0x50335632;      // _P : chaque groupe porte son numero de piece (vue assemblee)
function parseBinCompact(buf, dv, withPiece) {
  const n = dv.getUint32(4, true);
  const lo = [dv.getFloat32(8, true), dv.getFloat32(12, true), dv.getFloat32(16, true)];
  const sc = [dv.getFloat32(20, true), dv.getFloat32(24, true), dv.getFloat32(28, true)];
  let o = 32;
  const groups = [];
  for (let k = 0; k < n; k++) {
    const col = dv.getUint32(o, true), nv = dv.getUint32(o + 4, true), nt = dv.getUint32(o + 8, true); o += 12;
    const piece = withPiece ? dv.getUint32(o, true) : null; if (withPiece) o += 4;
    const q = new Uint8Array(buf, o, nv * 6); o += nv * 6;
    const pos = new Float32Array(nv * 3);
    for (let c = 0; c < 3; c++) {
      const a = q.subarray(2 * c * nv, (2 * c + 1) * nv), b = q.subarray((2 * c + 1) * nv, (2 * c + 2) * nv), l = lo[c], s = sc[c];
      for (let i = 0; i < nv; i++) pos[3 * i + c] = l + (a[i] | (b[i] << 8)) * s;
    }
    const m = nt * 3, p = new Uint8Array(buf, o, m * 4); o += m * 4;
    const p0 = p.subarray(0, m), p1 = p.subarray(m, 2 * m), p2 = p.subarray(2 * m, 3 * m), p3 = p.subarray(3 * m, 4 * m);
    const idx = new Uint32Array(m);
    let acc = 0;
    for (let i = 0; i < m; i++) { acc = (acc + (p0[i] | (p1[i] << 8) | (p2[i] << 16) | (p3[i] << 24))) | 0; idx[i] = acc; }
    groups.push({ color: [(col >>> 24) & 255, (col >>> 16) & 255, (col >>> 8) & 255], pos, idx, piece });
  }
  return groups;
}

function parseBin(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength >= 32 && dv.getUint32(0, true) === BIN_MAGIC) return parseBinCompact(buf, dv, false);
  if (buf.byteLength >= 32 && dv.getUint32(0, true) === BIN_MAGIC_P) return parseBinCompact(buf, dv, true);
  let o = 0;      // l'ancien format (un copain dont le serveur n'est pas a jour)
  const n = dv.getUint32(o, true); o += 4;
  const groups = [];
  for (let k = 0; k < n; k++) {
    const col = dv.getUint32(o, true), nv = dv.getUint32(o + 4, true), nt = dv.getUint32(o + 8, true); o += 12;
    const pos = new Float32Array(buf.slice(o, o + nv * 12)); o += nv * 12;
    const idx = new Uint32Array(buf.slice(o, o + nt * 12)); o += nt * 12;
    groups.push({ color: [(col >>> 24) & 255, (col >>> 16) & 255, (col >>> 8) & 255], pos, idx });
  }
  return groups;
}

// un apercu MakerWorld (GLB) ou un plateau de l'appli : l'adresse porte une version (« plate_1.glb?v=… »)
const isGlb = u => /\.glb(\?|$)/.test(String(u || ""));
const hex6 = c => String(c || "").replace(/^#/, "").slice(0, 6).toUpperCase();

// le rendu d'une finition de filament (28/10/2026) : translucide, satine, metallique, mat, lumineux
// reflets (silk, metal) : une piece eclairee servant d'environnement, sur ces seuls materiaux (les autres gardent
// leur rendu) ; paillettes, galaxie, marbre, bois, carbone : un motif dessine, projete sur chaque face
const FINISH_MAT = {
  translucent: { transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.25, metalness: 0 },
  // satine nacre (28/10/2026) : a moitie metal, le reflet de la piece eclairee prend la couleur de la piece au lieu de la
  // blanchir (un gris reste gris, un vert reflete du vert), et une face plate accroche enfin la lumiere
  silk: { roughness: 0.3, metalness: 0.42, envMapIntensity: 0.85 },
  metal: { roughness: 0.32, metalness: 1, envMapIntensity: 1.5 },
  matte: { roughness: 0.95, metalness: 0 },
  carbon: { roughness: 0.55, metalness: 0.35, envMapIntensity: 0.6 },   // la trame module la brillance (voir plus bas)
  sparkle: { roughness: 0.35 },
  galaxy: { roughness: 0.35 },
};
const TILE_MM = 16;                                   // un motif tous les 16 mm

// des coordonnees de texture, face par face, projetees sur le plan le plus en face (geometrie desindexee)
function boxUV(THREE, geo) {
  const g = geo.toNonIndexed(), p = g.attributes.position, uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = [a, b, c][k];
      const [u, w] = az >= ax && az >= ay ? [v.x, v.y] : ax >= ay ? [v.y, v.z] : [v.x, v.z];
      uv[(i + k) * 2] = u / TILE_MM; uv[(i + k) * 2 + 1] = w / TILE_MM;
    }
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

// pieces / edit (29/10/2026) : la vue assemblee, piece par piece (cle, nom, decalage « o » de ses sommets affiches par
// rapport au 3MF) et la place enregistree de chacune ({cle : matrice 4x4}) ; editApi : l'edition (sur PC)
// un exemplaire de plus d'une piece de la vue assemblee (30/10/2026) : ses maillages partages, ses matieres a lui (la
// selection estompe les autres pieces matiere par matiere), a la meme place que la piece copiee
function copyPiece(THREE, src, n) {
  const g = new THREE.Group();
  for (const m of src.children) {
    if (!m.isMesh) continue;
    const c = new THREE.Mesh(m.geometry, m.material.clone());
    c.position.copy(m.position); c.quaternion.copy(m.quaternion); c.scale.copy(m.scale); c.userData = { ...m.userData };
    c.castShadow = m.castShadow; c.receiveShadow = m.receiveShadow; c.renderOrder = m.renderOrder;
    g.add(c);
  }
  const base = src.userData.copyOf || src.userData.k, bpid = String(src.userData.pid).replace(/#\d+$/, "");
  const name = String(src.userData.name || "Pièce").replace(/ · exemplaire \d+$/, "");
  g.userData = { ...src.userData, k: `${base}#${n}`, pid: `${bpid}#${n}`, name: `${name} · exemplaire ${n + 1}`, copyOf: base, excluded: false };
  src.updateMatrix(); src.matrix.decompose(g.position, g.quaternion, g.scale); g.updateMatrix();
  return g;
}

function Viewer({ url, glb, onState, palette = null, finishes = null, multi = null, glow = false, bed = null, litho = false,
                  pieces = null, edit = null, editApi = null, pad = false }) {
  const [pans, setPans] = useState(false);
  const box = useRef(null);
  const [dark, setDark] = useState(false);
  const [lit, setLit] = useState(false);
  const [bedOn, setBedOn] = useState(true);            // le plateau (grille) : masquable pour voir dessous
  useEffect(() => { if (lit) egg("ombres_chinoises"); }, [lit]);
  const api = useRef(null);
  useEffect(() => {
    let dead = false, cleanup = () => {};
    (async () => {
      onState({ busy: true, error: null });
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (dead || !box.current) return;
      const el = box.current;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));   // assez net, et 2 a 4 fois moins de pixels a calculer qu'un ecran x3
      renderer.setSize(el.clientWidth, el.clientHeight);
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.6); scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(150, 300, 200); scene.add(sun);
      const back = new THREE.DirectionalLight(0xffffff, 0.6); back.position.set(-200, 120, -150); scene.add(back);
      // plateau masque : le dessous eclaire aussi (sinon il reste dans l'ombre du sol, comme s'il y etait encore)
      const under = new THREE.DirectionalLight(0xffffff, 0); under.position.set(120, -300, 160); scene.add(under);
      // l'environnement des reflets, prepare seulement s'il sert
      let envTex = null;
      const envMap = async () => {
        if (envTex) return envTex;
        const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
        const pm = new THREE.PMREMGenerator(renderer);
        envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); disposables.push(envTex);
        return envTex;
      };
      const texOf = {};
      // le plateau de l'imprimante, en repere
      // un carre de 16 mm, etire a la taille du plateau
      const [bw, bd] = bed || BED, side = Math.max(bw, bd);
      const grid = new THREE.GridHelper(side, Math.round(side / 16), 0x94a3b8, 0xcbd5e1); grid.material.transparent = true; grid.material.opacity = 0.45;
      grid.scale.set(bw / side, 1, bd / side); scene.add(grid);
      const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 1, 5000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      // les gestes habituels (comme Bambu Studio, 29/10/2026) : clic gauche tourner, molette ou clic droit maintenus
      // deplacer la vue, molette zoomer ; double-clic : la vue se centre sur le point vise
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
      controls.zoomToCursor = true;
      controls.dampingFactor = 0.15;                  // un elan court : la vue s'arrete vite d'elle-meme
      // une seule boucle, et seulement pendant que la vue bouge (27/10/2026) : avant, chaque image en demandait
      // deux (la suivante, et une de plus par l'evenement « change » que la mise a jour declenche elle-meme) ;
      // ca doublait a chaque image, plus de 3 000 rendus par seconde en tournant
      let raf = 0, running = false, dragging = false, stopAt = 0;
      // lumiere eteinte : rendu avec un vrai halo (bloom) autour de ce qui luit
      let composer = null, bloomOn = false;
      // lumiere derriere (lithophane) : un rendu a part, par epaisseurs traversees
      let lit = null, litOn = false;
      const render = () => { if (litOn && lit) lit.render(); else if (bloomOn && composer) composer.render(); else renderer.render(scene, camera); };
      const loop = () => {
        const moving = controls.update();
        render();
        // l'elan apres le lacher : 1,2 s au plus (il ne s'eteignait jamais tout a fait, la vue tournait a vide)
        if (moving && (dragging || performance.now() < stopAt)) raf = requestAnimationFrame(loop); else { running = false; raf = 0; }
      };
      const kick = () => { if (!running) { running = true; raf = requestAnimationFrame(loop); } };
      controls.addEventListener("start", () => { dragging = true; kick(); });
      controls.addEventListener("end", () => { dragging = false; stopAt = performance.now() + 1200; });
      controls.addEventListener("change", kick);
      const ro = new ResizeObserver(() => { renderer.setSize(el.clientWidth, el.clientHeight); composer?.setSize(el.clientWidth, el.clientHeight); lit?.resize(); camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); render(); });
      ro.observe(el);
      const disposables = [renderer];
      cleanup = () => { ro.disconnect(); cancelAnimationFrame(raf); controls.dispose();
        scene.traverse(o => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.dispose?.()); });
        disposables.forEach(d => d.dispose?.()); renderer.domElement.remove(); };
      try {
        const model = new THREE.Group();
        if (glb) {
          const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
          const { DRACOLoader } = await import("three/examples/jsm/loaders/DRACOLoader.js");
          const draco = new DRACOLoader(); draco.setDecoderPath("/draco/"); draco.setDecoderConfig({ type: "wasm" });
          disposables.push(draco);
          const gl = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url);
          const mat = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.55, metalness: 0.05, flatShading: true });
          gl.scene.traverse(o => { if (o.isMesh) o.material = mat; });
          // l'apercu MakerWorld est en metres (glTF) : en millimetres, comme le plateau
          gl.scene.scale.setScalar(1000);
          model.add(gl.scene);
        } else {
          // le plateau, compresse ; s'il n'a pas pu etre lu (coupure, fichier abime), une seconde fois decompresse par
          // le serveur, qui oublie la vue si le fichier est abime (410 : a refaire)
          let buf;
          try {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            buf = await r.arrayBuffer();
          } catch (e) {
            if (/^HTTP 4/.test(e.message)) throw e;
            const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}plain=1`);
            if (r.status === 410) { onState({ busy: false, error: null, broken: true }); return; }
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            buf = await r.arrayBuffer();
          }
          if (dead) return;
          const groups = parseBin(buf);
          const holder = new THREE.Group(); holder.rotation.x = -Math.PI / 2;     // le 3MF a Z vers le haut
          // la vue assemblee, piece par piece : un groupe par piece (pour l'editer, et pour la place enregistree)
          const byPiece = pieces && groups.some(g => g.piece != null) ? new Map() : null;
          for (const g of groups) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.BufferAttribute(g.pos, 3));
            geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
            // ombre a plat, facette par facette (comme Bambu Studio) : des normales lissees par sommet tracaient des
            // trainees de triangles la ou une face plate rejoint un arrondi ; et rien a calculer ni a garder en plus
            // recoloriee : la couleur du createur remplacee par celle du filament retenu (« À faire »)
            const own = g.color.map(x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
            const c = palette?.[own] ? new THREE.Color(`#${hex6(palette[own])}`) : new THREE.Color(`rgb(${g.color.join(",")})`);
            // sa finition : celle du filament d'origine, ou celle de la bobine utilisee / choisie
            const fin = finishes?.[own];
            // les deux cotes des faces (29/10/2026) : la ou une zone peinte tres decoupee touche une zone qui l'est moins,
            // des fissures d'un pixel laissaient voir le noir de l'interieur (des pointilles noirs sur la Nonne)
            const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.05, flatShading: true, envMapIntensity: 0, side: THREE.DoubleSide,
              ...(FINISH_MAT[fin] || {}) });
            // un filament multicolore (28/10/2026), en simili, la finition posee par-dessus comme pour les autres :
            // le degrade evolue le long du filament consomme, donc surtout avec la hauteur d'impression, et un peu dans
            // la couche elle-meme, le long du parcours (le remplissage du dessus change sur sa longueur) : couleur par
            // sommet ; le bicolore ou tricolore coaxial change selon l'angle de vue (une couleur de face, l'autre en
            // biais, la troisieme sur la tranche), avec un leger scintillement irise
            const mc = multi?.[own];
            if (mc?.type === "gradient" && mc.colors?.length >= 2) {
              const cols = mc.colors.map(h => new THREE.Color(`#${hex6(h)}`));
              let z0 = Infinity, z1 = -Infinity, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
              for (let i = 0; i < g.pos.length; i += 3) {
                const x = g.pos[i], y = g.pos[i + 1], z = g.pos[i + 2];
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
              }
              const vc = new Float32Array(g.pos.length), sz = Math.max(1e-6, z1 - z0), sxy = Math.max(1e-6, (x1 - x0) + (y1 - y0)), tmp = new THREE.Color();
              for (let i = 0; i < g.pos.length; i += 3) {
                // 80 % la hauteur, 20 % l'avancee dans la couche (en diagonale, comme un parcours qui balaie le plateau)
                const f = 0.8 * (g.pos[i + 2] - z0) / sz + 0.2 * ((g.pos[i] - x0) + (g.pos[i + 1] - y0)) / sxy;
                const t = Math.min(1, Math.max(0, f)) * (cols.length - 1), k = Math.min(cols.length - 2, Math.floor(t));
                tmp.copy(cols[k]).lerp(cols[k + 1], t - k);
                vc[i] = tmp.r; vc[i + 1] = tmp.g; vc[i + 2] = tmp.b;
              }
              geo.setAttribute("color", new THREE.BufferAttribute(vc, 3));
              mat.vertexColors = true; mat.color.set(0xffffff);
            } else if (mc?.type === "coaxial" && mc.colors?.length >= 2) {
              const [a, b, d] = [0, 1, 2].map(i => new THREE.Color(`#${hex6(mc.colors[Math.min(i, mc.colors.length - 1)])}`));
              const u = { cA: { value: a }, cB: { value: b }, cC: { value: d }, nC: { value: mc.colors.length } };
              mat.color.set(0xffffff);
              const prev = mat.onBeforeCompile;
              mat.onBeforeCompile = sh => {
                prev?.(sh);
                Object.assign(sh.uniforms, u);
                sh.fragmentShader = "uniform vec3 cA; uniform vec3 cB; uniform vec3 cC; uniform float nC;\n" + sh.fragmentShader.replace("#include <emissivemap_fragment>",
                  "#include <emissivemap_fragment>\n  { float fr = smoothstep(0.0, 0.85, 1.0 - abs(dot(normalize(normal), normalize(vViewPosition))));\n" +
                  "    vec3 mc = nC > 2.5 ? (fr < 0.5 ? mix(cA, cB, fr * 2.0) : mix(cB, cC, (fr - 0.5) * 2.0)) : mix(cA, cB, fr);\n" +
                  "    diffuseColor.rgb *= mc * (0.92 + 0.25 * fr); }");     // *= : le motif de la finition reste par-dessus
              };
            }
            // phosphorescent : il luit de sa couleur, eclaircie (une piece eclairee de l'interieur)
            // (la couleur eclairee baissee d'autant : sinon la somme sature, et la piece vire au blanc)
            if (fin === "glow") { mat.color = c.clone().multiplyScalar(0.6); mat.emissive = c.clone(); mat.emissiveIntensity = 0.45; mat.roughness = 0.6; }
            if (FINISH_MAT[fin]?.envMapIntensity) mat.envMap = await envMap();
            // le reflet s'ajoute a l'eclairage : la couleur est un peu baissee d'autant, sinon un gris satine sort blanc
            if (fin === "silk") {
              // le brillant d'un silk : la couleur de la face reste la sienne (aucun voile, c'est lui qui blanchissait un gris) ;
              // seul un lisere etroit, de sa propre couleur, s'allume sur la tranche vue en biais, comme un fil qui accroche la lumiere
              const prev = mat.onBeforeCompile;
              mat.onBeforeCompile = sh => {
                prev?.(sh);
                sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>",
                  "#include <emissivemap_fragment>\n  { float fr = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));\n" +
                  "    float rim = pow(smoothstep(0.5, 1.0, fr), 2.5);\n" +
                  "    totalEmissiveRadiance += diffuseColor.rgb * rim * 0.35; }");
              };
            }
            let mesh = geo;
            if (["sparkle", "galaxy", "marble", "wood", "carbon"].includes(fin)) {
              if (!texOf[fin]) {
                const { cv, emit } = finishCanvas(fin, "3d");
                const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
                t.anisotropy = 4; texOf[fin] = { t, emit }; disposables.push(t);
              }
              const { t, emit } = texOf[fin];
              mesh = boxUV(THREE, geo); geo.dispose();
              if (emit) { mat.emissive = new THREE.Color(0xffffff); mat.emissiveMap = t; mat.emissiveIntensity = 0.9; }
              else mat.map = t;
              // carbone (28/10/2026) : en couleur seule, la trame multipliait du noir et ne se voyait pas ; elle module
              // aussi la rugosite (les brins brillent differemment) et affleure a peine en lumiere
              if (fin === "carbon") { mat.roughnessMap = t; mat.emissive = new THREE.Color(0xffffff); mat.emissiveMap = t; mat.emissiveIntensity = 0.05; }
            }
            const piece = new THREE.Mesh(mesh, mat);
            if (fin === "glow") {
              piece.userData.glow = true; mat.userData.dayEmit = mat.emissiveIntensity;
              // dans le noir, autant de lumiere pour toutes les couleurs : un bleu ou un rouge (sombres) luisent plus fort
              const lum = 0.2126 * mat.emissive.r + 0.7152 * mat.emissive.g + 0.0722 * mat.emissive.b;
              mat.userData.nightEmit = Math.min(1.3, 0.3 / Math.max(0.12, lum));
              // un liseré lumineux sur les bords (la ou la surface fuit le regard) : on le devine phosphorescent meme
              // lumiere allumee
              const rim = { value: 2.2 };
              mat.userData.rim = rim;
              mat.onBeforeCompile = sh => {
                sh.uniforms.rimK = rim;
                sh.fragmentShader = "uniform float rimK;\n" + sh.fragmentShader.replace("#include <emissivemap_fragment>",
                  // la lueur suit legerement le relief (un peu plus forte de face) : les gravures restent devinables sans
                  // rien enlever a la lueur d'ensemble (28/10/2026)
                  "#include <emissivemap_fragment>\n  float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));\n" +
                  // le lisere passe par un lissage : sur des facettes planes, un seuil franc d'une face a l'autre fourmillait sous le halo
                  "  float rimF = pow(smoothstep(0.08, 1.0, 1.0 - ndv), 1.6);\n" +
                  "  totalEmissiveRadiance = totalEmissiveRadiance * (0.82 + 0.18 * ndv) + emissive * rimF * rimK;");
              };
            }
            if (byPiece) {
              let pg = byPiece.get(g.piece);
              if (!pg) { pg = new THREE.Group(); pg.userData = { pid: g.piece, ...(pieces[g.piece] || {}) }; byPiece.set(g.piece, pg); holder.add(pg); }
              pg.add(piece);
            } else holder.add(piece);
          }
          if (byPiece) {
            // chaque piece centree sur son origine (la poignee de rotation tourne autour d'elle), puis a sa place :
            // celle enregistree (matrice S : du 3MF a la place editee), sinon celle affichee
            const saved = edit?.pieces || {};
            // seules les pieces que l'on a separees soi-meme (« Separer ») sont refaites en morceaux (29/10/2026 : les
            // morceaux du decoupage automatique d'un moment ne se renumerotaient pas pareil, et s'eparpillaient)
            const splits = new Set(edit?.splits || []);
            const { splitPieceGeometry, buildSplitGroups } = splits.size ? await import("./assemblySplit") : {};
            for (const pg of [...byPiece.values()]) {
              const b = new THREE.Box3();
              pg.children.forEach(m => { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox); });
              const c = b.getCenter(new THREE.Vector3());
              pg.children.forEach(m => { m.geometry.translate(-c.x, -c.y, -c.z); m.geometry.computeBoundingSphere(); });
              pg.userData.c = c.clone();
              pg.position.copy(c);
              pg.updateMatrix();
              const o = pg.userData.o || [0, 0, 0];
              const place = (g, S) => {
                const cg = g.userData.c;
                new THREE.Matrix4().fromArray(S).multiply(new THREE.Matrix4().makeTranslation(cg.x - o[0], cg.y - o[1], cg.z - o[2])).decompose(g.position, g.quaternion, g.scale);
                g.updateMatrix();
              };
              // une piece separee a la main (« objet:instance:partie:morceau ») : refaite en ses morceaux, chacun a sa place
              const pre = `${pg.userData.k}:`;
              if (splitPieceGeometry && splits.has(pg.userData.k) && Object.keys(saved).some(k => k.startsWith(pre))) {
                const comps = splitPieceGeometry(THREE, pg);
                if (comps) {
                  const parts = buildSplitGroups(THREE, pg, comps);
                  holder.remove(pg); byPiece.delete(pg.userData.pid);
                  for (const g of parts) {
                    holder.add(g); byPiece.set(g.userData.pid, g);
                    const S = saved[g.userData.k] || saved[pg.userData.k];
                    if (S) place(g, S);
                  }
                  continue;
                }
              }
              // une cle d'avant (« objet:instance ») : la place de l'objet entier vaut pour ses parties
              const kk = String(pg.userData.k || "").split(":");
              const S = saved[pg.userData.k] || saved[`${pg.userData.k}:0`] || saved[kk.slice(0, 2).join(":")];
              if (S) place(pg, S);
            }
            // les exemplaires ajoutes (« cle#n ») et les pieces exclues de l'assemblage (30/10/2026)
            const byK = new Map([...byPiece.values()].map(g => [g.userData.k, g]));
            for (const [k, S] of Object.entries(saved)) {
              const m = /^(.+)#(\d+)$/.exec(k), src = m && byK.get(m[1]);
              if (!src) continue;
              const g = copyPiece(THREE, src, Number(m[2]));
              const cg = g.userData.c, o = g.userData.o || [0, 0, 0];
              new THREE.Matrix4().fromArray(S).multiply(new THREE.Matrix4().makeTranslation(cg.x - o[0], cg.y - o[1], cg.z - o[2])).decompose(g.position, g.quaternion, g.scale);
              g.updateMatrix();
              holder.add(g); byPiece.set(g.userData.pid, g);
            }
            const out = new Set(edit?.excluded || []);
            for (const g of byPiece.values()) if (out.has(g.userData.k)) { g.userData.excluded = true; g.visible = false; }
          }
          model.add(holder);
          if (byPiece) model.userData.edit = { holder, byPiece };
        }
        if (dead) return;
        scene.add(model);
        // pose au centre du plateau, a sa hauteur ; la camera en vue de trois-quarts
        const bb = new THREE.Box3().setFromObject(model), ctr = bb.getCenter(new THREE.Vector3());
        model.position.set(-ctr.x, -bb.min.y, -ctr.z);
        const bb2 = new THREE.Box3().setFromObject(model), sph = bb2.getBoundingSphere(new THREE.Sphere());
        const fit = () => {
          const d = sph.radius / Math.sin((camera.fov * Math.PI) / 360) * 1.15;
          camera.position.set(sph.center.x + d * 0.6, sph.center.y + d * 0.55, sph.center.z + d * 0.6);
          controls.target.copy(sph.center); camera.near = Math.max(0.1, d / 100); camera.far = d * 20; camera.updateProjectionMatrix(); controls.update(); render();
        };
        fit();
        const noMenu = e => e.preventDefault();
        const focus = e => {
          const r = el.getBoundingClientRect(), rc = new THREE.Raycaster();
          rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
          const hit = rc.intersectObject(model, true)[0];
          if (!hit) return;
          camera.position.add(hit.point.clone().sub(controls.target)); controls.target.copy(hit.point); controls.update(); render();
        };
        renderer.domElement.addEventListener("contextmenu", noMenu);
        renderer.domElement.addEventListener("dblclick", focus);
        // lumiere eteinte : seules les pieces phosphorescentes luisent (leur halo ressort dans le noir)
        const glowMats = [];
        scene.traverse(o => { if (o.isMesh && o.userData.glow) glowMats.push(o.material); });
        const night = async on => {
          if (on && !composer) {
            const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { SMAAPass }] = await Promise.all([
              import("three/examples/jsm/postprocessing/EffectComposer.js"), import("three/examples/jsm/postprocessing/RenderPass.js"),
              import("three/examples/jsm/postprocessing/UnrealBloomPass.js"), import("three/examples/jsm/postprocessing/OutputPass.js"),
              import("three/examples/jsm/postprocessing/SMAAPass.js")]);
            // rendu multi-echantillonne (28/10/2026) : sans lui, le passage par le composeur perdait l'anticrenelage et les
            // aretes scintillaient dans le noir
            const rt = new THREE.WebGLRenderTarget(el.clientWidth, el.clientHeight, { samples: 4, type: THREE.HalfFloatType });
            disposables.push(rt);
            composer = new EffectComposer(renderer, rt);
            composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(el.clientWidth, el.clientHeight);
            composer.addPass(new RenderPass(scene, camera));
            // halo mesure (28/10/2026) : seuil plus haut et force moindre, pour que le halo entoure la piece sans gommer ses details
            const pr0 = renderer.getPixelRatio();
            // le halo calcule a la resolution reelle (et non en pixels CSS) : ses mipmaps grossiers faisaient fourmiller les
            // aretes fines quand on tourne ; puis un lissage des aretes (SMAA) en sortie, par-dessus le multi-echantillonnage
            composer.addPass(new UnrealBloomPass(new THREE.Vector2(el.clientWidth * pr0, el.clientHeight * pr0), 0.45, 0.3, 0.3));
            composer.addPass(new OutputPass());
            composer.addPass(new SMAAPass(el.clientWidth * pr0, el.clientHeight * pr0));
            disposables.push(composer);
          }
          bloomOn = on;
          // une veilleuse : assez pour garder le relief de ce qui luit (sinon une silhouette plate)
          hemi.intensity = on ? 0.12 : 1.6; sun.intensity = on ? 0.4 : 1.6; back.intensity = on ? 0.08 : 0.6;
          grid.material.opacity = on ? 0.12 : 0.45;
          scene.background = on ? new THREE.Color(0x05070d) : null;
          glowMats.forEach(m => { m.emissiveIntensity = on ? m.userData.nightEmit : m.userData.dayEmit; if (m.userData.rim) m.userData.rim.value = on ? 0.6 : 2.2; });
          render();
        };
        // lumiere derriere (28/10/2026) : un lithophane ne se lit qu'eclaire par l'arriere. En chaque pixel, l'epaisseur
        // de chaque couleur que la lumiere traverse (la somme des profondeurs des faces arriere moins celle des faces
        // avant, par melange additif : juste meme quand le rayon entre et sort plusieurs fois), puis la lumiere filtree
        // couleur par couleur selon cette epaisseur : du blanc laisse passer 50 % par mm (0,8 mm clair, 3 mm sombre),
        // une couleur teinte d'autant, un noir bouche. Les couches CMJ enfouies sous le relief blanc ressortent ainsi.
        const litSetup = () => {
          const floatBlend = renderer.capabilities.isWebGL2 && renderer.extensions.has("EXT_float_blend");
          const pr = renderer.getPixelRatio();
          const mk = type => new THREE.WebGLRenderTarget(Math.round(el.clientWidth * pr), Math.round(el.clientHeight * pr),
            { type, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
          const tAll = mk(floatBlend ? THREE.FloatType : THREE.HalfFloatType), tG = mk(floatBlend ? THREE.FloatType : THREE.HalfFloatType), acc = mk(THREE.HalfFloatType);
          // la profondeur de chaque face, ajoutee (arriere) ou retiree (avant) ; comptee depuis le devant du modele,
          // pour rester precise meme en demi-flottants
          const near = { value: 0 };
          const depthMat = sgn => new THREE.ShaderMaterial({ uniforms: { near, sgn: { value: sgn } }, side: sgn > 0 ? THREE.BackSide : THREE.FrontSide,
            depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
            vertexShader: `uniform float near; varying float vz;
              void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vz = -mv.z - near; gl_Position = projectionMatrix * mv; }`,
            fragmentShader: `uniform float sgn; varying float vz; void main() { gl_FragColor = vec4(sgn * vz, 0.0, 0.0, 0.0); }` });
          const matF = depthMat(-1), matB = depthMat(1);
          scene.updateMatrixWorld(true);
          const groups = new Map();                       // couleur -> les faces de cette couleur, avant et arriere
          scene.traverse(o => {
            if (!o.isMesh || !o.geometry || !o.material?.color || o.parent === scene) return;
            const k = o.material.color.getHex();
            if (!groups.has(k)) groups.set(k, { col: o.material.color.clone(), sc: new THREE.Scene() });
            for (const m of [matF, matB]) {
              const c = new THREE.Mesh(o.geometry, m); c.matrixAutoUpdate = false; c.matrix.copy(o.matrixWorld); c.frustumCulled = false;
              groups.get(k).sc.add(c);
            }
          });
          const quad = new THREE.PlaneGeometry(2, 2), ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
          // la lumiere qui reste apres cette couleur, multipliee a ce qui est deja passe
          const transMat = new THREE.ShaderMaterial({ uniforms: { tex: { value: null }, col: { value: new THREE.Color() } }, depthTest: false, depthWrite: false,
            blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
            fragmentShader: `uniform sampler2D tex; uniform vec3 col; varying vec2 vUv;
              void main() { float t = max(0.0, texture2D(tex, vUv).r);
                // la teinte d'une couleur, accentuee (une fine couche colore deja bien), et l'ombre de l'epaisseur
                gl_FragColor = vec4(pow(max(col, vec3(0.004)), vec3(t * 1.7)) * pow(0.5, t), 1.0); }` });
          // l'image : la lumiere filtree la ou il y a de la matiere, la nuit ailleurs
          const compMat = new THREE.ShaderMaterial({ uniforms: { all: { value: tAll.texture }, acc: { value: acc.texture }, clearBg: { value: 0 } }, depthTest: false, depthWrite: false,
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
            fragmentShader: `uniform sampler2D all; uniform sampler2D acc; uniform float clearBg; varying vec2 vUv;
              void main() { float t = texture2D(all, vUv).r; vec3 T = texture2D(acc, vUv).rgb;
                vec3 c = vec3(1.0, 0.96, 0.86) * 3.2 * T;
                c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.45);       // des couleurs plus franches
                c = t > 0.02 ? max(c, 0.0) : vec3(0.006, 0.008, 0.016);
                gl_FragColor = vec4(c, t > 0.02 ? 1.0 : 1.0 - clearBg);       // fond vide pour une vignette (30/10/2026)
                #include <colorspace_fragment>
              }` });
          const qT = new THREE.Scene(); qT.add(new THREE.Mesh(quad, transMat));
          const qC = new THREE.Scene(); qC.add(new THREE.Mesh(quad, compMat));
          disposables.push(tAll, tG, acc, matF, matB, transMat, compMat, quad);
          return {
            clearBg: on => { compMat.uniforms.clearBg.value = on ? 1 : 0; },
            resize: () => { const q = renderer.getPixelRatio(); for (const t of [tAll, tG, acc]) t.setSize(Math.round(el.clientWidth * q), Math.round(el.clientHeight * q)); },
            render: () => {
              const ac = renderer.autoClear; renderer.autoClear = false;
              near.value = Math.max(0, camera.position.distanceTo(sph.center) - sph.radius);
              renderer.setClearColor(0x000000, 0);
              renderer.setRenderTarget(tAll); renderer.clear();
              for (const g of groups.values()) renderer.render(g.sc, camera);
              renderer.setRenderTarget(acc); renderer.setClearColor(0xffffff, 1); renderer.clear();
              for (const g of groups.values()) {
                renderer.setRenderTarget(tG); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(g.sc, camera);
                renderer.setRenderTarget(acc); transMat.uniforms.tex.value = tG.texture; transMat.uniforms.col.value.copy(g.col); renderer.render(qT, ortho);
              }
              renderer.setRenderTarget(null);
              if (compMat.uniforms.clearBg.value) { renderer.setClearColor(0x000000, 0); renderer.clear(); }
              renderer.render(qC, ortho);
              renderer.setClearColor(0x000000, 0); renderer.autoClear = ac;
            },
          };
        };
        const backlight = on => {
          if (on && !lit) lit = litSetup();
          litOn = on;
          render();
        };
        const bedShow = on => { grid.visible = on; under.intensity = on ? 0 : 1.3; hemi.groundColor.set(on ? 0x8a8f98 : 0xffffff); render(); };
        // le pave (tablette au stylet, 29/10/2026) : le glisser tourne ou deplace la vue ; zoomer d'un cran
        const dragPans = on => { controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE; controls.touches.ONE = on ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE; };
        const zoom = f => { camera.position.sub(controls.target).multiplyScalar(f).add(controls.target); controls.update(); render(); };
        // l'edition de la vue assemblee (PC) : l'editeur, et les places a enregistrer (S = place * T(o - c))
        const ed = model.userData.edit;
        let editor = null;
        const editing = async (on, onChange) => {
          if (!ed) return null;
          if (on && !editor) {
            const { createAssemblyEditor } = await import("./AssemblyEditor");
            editor = await createAssemblyEditor({ THREE, scene, camera, renderer, controls, holder: ed.holder, pieces: ed.byPiece, render, onChange,
              groupsInit: edit?.groups || [], jointsInit: edit?.joints || [], copyPiece: (src, n) => copyPiece(THREE, src, n),
              // pas encore enregistre par cette version : les parties d'un meme objet partent groupees
              groupByObject: edit?.v !== 2 });
          } else if (!on && editor) { try { editor.dispose(); } catch { /* la vue se ferme quand meme */ } editor = null; }
          return editor;
        };
        const toSave = () => {
          const out = {};
          for (const pg of ed?.byPiece.values() || []) {
            const c = pg.userData.c, o = pg.userData.o || [0, 0, 0];
            pg.updateMatrix();
            out[pg.userData.k] = pg.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(o[0] - c.x, o[1] - c.y, o[2] - c.z)).toArray();
          }
          return out;
        };
        // la vue telle que le 3MF la donne (sans place enregistree)
        const origin = () => [...(ed?.byPiece.values() || [])].map(pg => new THREE.Matrix4().makeTranslation(pg.userData.c.x, pg.userData.c.y, pg.userData.c.z));
        // la vue remise en place apres un changement d'assemblage (29/10/2026 : apres « Vue du 3MF », la grille et le cadrage
        // gardaient la taille d'avant jusqu'a la reouverture) : le modele recentre et pose, la grille a sa taille, la vue cadree
        const relayout = () => {
          if (!ed) return;
          const b = new THREE.Box3();
          for (const pg of ed.byPiece.values()) { if (pg.visible) b.expandByObject(pg); }
          if (b.isEmpty()) return;
          const c = b.getCenter(new THREE.Vector3());
          model.position.x -= c.x; model.position.z -= c.z; model.position.y -= b.min.y;
          model.updateMatrixWorld(true);
          const s3 = b.getSize(new THREE.Vector3());
          const gw = Math.max(64, Math.ceil(s3.x * 1.2 / 16) * 16), gd = Math.max(64, Math.ceil(s3.z * 1.2 / 16) * 16);
          grid.scale.set(gw / side, 1, gd / side);
          const sp = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
          sph.center.copy(sp.center); sph.radius = sp.radius;
          fit();
          onState({ busy: false, error: null, size: [s3.x, s3.z, s3.y], glow: glowMats.length > 0 });     // les dimensions sous la vue
        };
        // une vignette de la vue (29/10/2026) : carree, depuis l'angle ou l'on regarde, cadree sur le modele, sans la
        // grille du plateau, sur fond transparent ; rend une image PNG (Blob)
        const snapshot = async (size = 1024) => {
          const was = { grid: grid.visible, bg: scene.background, w: el.clientWidth, h: el.clientHeight, pr: renderer.getPixelRatio(),
            pos: camera.position.clone(), aspect: camera.aspect, near: camera.near, far: camera.far };
          // fond vide, de jour, de nuit comme eclaire par derriere (30/10/2026 : comme les autres vignettes)
          grid.visible = false; scene.background = null;
          lit?.clearBg(true);
          renderer.setPixelRatio(1); renderer.setSize(size, size, false);
          camera.aspect = 1;
          const sp = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
          const dir = camera.position.clone().sub(controls.target).normalize();
          const d = sp.radius / Math.sin((camera.fov * Math.PI) / 360) * 1.08;
          camera.position.copy(sp.center).addScaledVector(dir, d); camera.lookAt(sp.center);
          camera.near = Math.max(0.1, d / 100); camera.far = d * 20; camera.updateProjectionMatrix();
          renderer.setClearColor(0x000000, 0);
          // de jour, une lumiere qui vient de l'appareil (30/10/2026) : une vue prise par-dessous ou de dos n'est plus
          // dans l'ombre ; retiree apres la prise
          const head = !bloomOn && !litOn ? new THREE.DirectionalLight(0xffffff, 1.3) : null;
          if (head) { head.position.copy(camera.position); head.target.position.copy(sp.center); scene.add(head, head.target); }
          if (bloomOn && composer) composer.setSize(size, size);
          if (litOn && lit) lit.resize();
          render();                                        // le rendu tel qu'affiche : nuit, lumiere derriere (lithophane)
          const blob = await new Promise(res => renderer.domElement.toBlob(res, "image/png"));
          if (head) { scene.remove(head, head.target); head.dispose(); }
          // la vue reprend comme avant
          grid.visible = was.grid; scene.background = was.bg;
          lit?.clearBg(false);
          renderer.setPixelRatio(was.pr); renderer.setSize(was.w, was.h);
          if (bloomOn && composer) composer.setSize(was.w, was.h);
          if (litOn && lit) lit.resize();
          camera.position.copy(was.pos); camera.aspect = was.aspect; camera.near = was.near; camera.far = was.far;
          camera.lookAt(controls.target); camera.updateProjectionMatrix(); controls.update(); render();
          return blob;
        };
        // la vignette se prend sur tout plateau (30/10/2026) ; l'edition, sur la vue assemblee seulement
        if (editApi) editApi.current = { editing, toSave, origin, relayout, snapshot, get editor() { return editor; } };
        disposables.push({ dispose: () => { try { editor?.dispose(); } catch { /* rien */ } if (editApi) editApi.current = null; } });
        api.current = { fit, night, backlight, bedShow, dragPans, zoom };
        const s = bb2.getSize(new THREE.Vector3());
        onState({ busy: false, error: null, size: glb ? [s.x, s.z, s.y] : [s.x, s.z, s.y], glow: glowMats.length > 0 });
      } catch (e) {
        onState({ busy: false, error: e?.message || "Modèle illisible" });
      }
    })();
    return () => { dead = true; cleanup(); api.current = null; };
  }, [url, glb]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div style={{ position: "relative", width: "100%", height: "100%" }}>
    <div ref={box} style={{ position: "absolute", inset: 0, touchAction: "none", borderRadius: "inherit", transition: "background .4s",
      background: dark || lit ? "radial-gradient(circle at 50% 40%, #0b1020, #020308)" : "transparent" }}/>
    {pad && <div style={{ position: "absolute", right: 10, bottom: 58, display: "flex", flexDirection: "column", gap: 6, zIndex: 2 }}>
      {[[pans ? "✋" : "🔄", pans ? "Le glisser déplace la vue (toucher : tourner)" : "Le glisser tourne la vue (toucher : déplacer)", () => { const v = !pans; setPans(v); api.current?.dragPans(v); }, pans],
        ["＋", "Zoomer", () => api.current?.zoom(0.8)], ["－", "Dézoomer", () => api.current?.zoom(1.25)]].map(([l, t, f, on]) =>
        <button key={t} type="button" onClick={f} data-tip={t} style={{ width: 38, height: 38, borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer",
          fontSize: 16, fontWeight: 800, background: on ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "var(--surface)", color: on ? "#fff" : "var(--text2)",
          boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>{l}</button>)}
    </div>}
    <div style={{ position: "absolute", right: 10, bottom: 10, display: "flex", gap: 8 }}>
      {litho && <button type="button" onClick={() => { const v = !lit; setLit(v); api.current?.backlight(v); }}
        data-tip={lit ? "Éclairer par devant" : "Lumière derrière : l'image du lithophane apparaît, comme devant une lampe"}
        style={{ height: 38, padding: "0 12px", borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer",
          background: lit ? "linear-gradient(135deg, #fde68a, #f59e0b)" : "linear-gradient(135deg, #1e293b, #0f172a)", color: lit ? "#1e293b" : "#e2e8f0",
          fontSize: 13, fontWeight: 800, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>{lit ? "☀️ Devant" : "🔦 Derrière"}</button>}
      <button type="button" onClick={() => { const v = !bedOn; setBedOn(v); api.current?.bedShow(v); }}
        data-tip={bedOn ? "Masquer le plateau : voir le dessous sans la grille" : "Afficher le plateau"}
        style={{ width: 38, height: 38, borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer", fontSize: 15,
          background: bedOn ? "var(--surface)" : "linear-gradient(135deg, #0EA5E9, #6366F1)", color: bedOn ? "var(--text2)" : "#fff",
          boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>{bedOn ? "▦" : "▢"}</button>
      {glow && <button type="button" onClick={() => { const v = !dark; setDark(v); api.current?.night(v); }}
        data-tip={dark ? "Rallumer la lumière" : "Éteindre la lumière : le filament phosphorescent luit"}
        style={{ height: 38, padding: "0 12px", borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer",
          background: dark ? "linear-gradient(135deg, #facc15, #f59e0b)" : "linear-gradient(135deg, #1e293b, #0f172a)", color: dark ? "#1e293b" : "#e2e8f0",
          fontSize: 13, fontWeight: 800, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>{dark ? "💡 Rallumer" : "🌙 Éteindre"}</button>}
      <button type="button" onClick={() => api.current?.fit()} data-tip="Recentrer la vue"
        style={{ width: 38, height: 38, borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer",
          background: "var(--surface)", color: "var(--text2)", fontSize: 16, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>⟲</button>
    </div>
  </div>;
}

// La barre de l'edition de la vue assemblee (29/10/2026, PC, en plein ecran)
const EDIT_TIPS = {
  move: "Clique une pièce (Ctrl / Maj : en ajouter ; Alt : une pièce d'un groupe seule), puis tire sur les flèches (Alt maintenu : sans cran) · flèches 1 mm (Maj : 10), Ctrl + ↑↓ : monter · M R F C : modes, Z : cadrer",
  rotate: "Clique une pièce, puis tourne-la par ses anneaux (Alt maintenu : sans cran) · flèches : 1° (Maj : 15°) · valeurs exactes à droite",
  ground: "Clique la face (ou l'arête) qui doit être posée au sol",
  mate1: "Clique la face ou l'arête de la pièce à déplacer (son groupe suit)",
  mate2: "Clique la face ou l'arête contre laquelle la coller",
  mate1a: "Assisté : clique une face de la pièce à déplacer, elle sera centrée et alignée sur l'autre",
};
// les valeurs exactes de la selection : position de son centre (mm) et rotation d'un angle choisi autour d'un axe
// la liste des pieces (30/10/2026), a gauche en edition : choisir, masquer un moment (👁), exclure de l'assemblage (🚫,
// enregistre ; ↩ la remet), en ajouter un exemplaire (⧉ : une piece imprimee en plusieurs exemplaires), retirer un
// exemplaire ajoute (✕)
function PiecesPanel({ est, api }) {
  const [open, setOpen] = useState(true);
  const list = est.list || [];
  const nEx = list.filter(x => x.excluded).length;
  const ib = (extra = {}) => ({ width: 26, height: 26, borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)",
    cursor: "pointer", fontSize: 12, flexShrink: 0, padding: 0, ...extra });
  return <div style={{ position: "absolute", left: 12, top: 70, bottom: 12, zIndex: 3, width: open ? 250 : "auto", display: "flex", flexDirection: "column",
    pointerEvents: "none" }}>
    <div style={{ pointerEvents: "auto", display: "flex", flexDirection: "column", minHeight: 0, maxHeight: "100%", borderRadius: 14, border: "1px solid var(--border)",
      background: "color-mix(in srgb, var(--sheet-bg) 94%, transparent)", boxShadow: "0 10px 30px rgba(0,0,0,.2)", overflow: "hidden" }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", border: "none", background: "transparent",
        cursor: "pointer", fontSize: 12.5, fontWeight: 800, color: "var(--text)", textAlign: "left" }}>
        📋 Pièces ({list.length - nEx}{nEx ? ` · ${nEx} exclue${nEx > 1 ? "s" : ""}` : ""}) <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div style={{ overflowY: "auto", padding: "0 6px 6px", display: "flex", flexDirection: "column", gap: 3 }}>
        {list.map(x => <div key={x.k} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 4px", borderRadius: 8,
          background: x.sel ? "color-mix(in srgb, #0EA5E9 18%, transparent)" : "transparent", opacity: x.excluded ? 0.55 : 1 }}>
          <button type="button" disabled={x.excluded} onClick={() => api?.select([x.k])} data-tip={x.excluded ? "Exclue de l'assemblage" : "La choisir"}
            style={{ flex: 1, minWidth: 0, border: "none", background: "none", padding: "2px 2px", cursor: x.excluded ? "default" : "pointer", textAlign: "left",
              fontSize: 12, fontWeight: x.sel ? 800 : 600, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              textDecoration: x.excluded ? "line-through" : "none" }}>{x.name}</button>
          {x.excluded
            ? <button type="button" onClick={() => api?.include(x.k)} style={ib({ width: "auto", padding: "0 8px", fontWeight: 800 })} data-tip="La remettre dans l'assemblage">↩ Remettre</button>
            : <>
              <button type="button" onClick={() => api?.toggleShown(x.k)} style={ib({ opacity: x.shown ? 1 : 0.5 })}
                data-tip={x.shown ? "La masquer un moment (la vue seulement)" : "La montrer"}>{x.shown ? "👁" : "🙈"}</button>
              <button type="button" onClick={() => api?.copy(x.k)} style={ib()} data-tip="Un exemplaire de plus, posé à côté">⧉</button>
              {x.copy
                ? <button type="button" onClick={() => api?.uncopy(x.k)} style={ib({ color: "#ef4444" })} data-tip="Retirer cet exemplaire">✕</button>
                : <button type="button" onClick={() => api?.exclude([x.k])} style={ib({ color: "#ef4444" })} data-tip="L'exclure de l'assemblage (enregistré ; ↩ la remet)">🚫</button>}
            </>}
        </div>)}
      </div>}
    </div>
  </div>;
}

function ExactPanel({ est, api }) {
  const [pos, setPos] = useState(null);
  const [deg, setDeg] = useState("90");
  const c = est.center;
  useEffect(() => { setPos(c ? c.map(String) : null); }, [c?.[0], c?.[1], c?.[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c || !pos) return null;
  const inp = { width: 64, height: 28, padding: "0 6px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)",
    fontSize: 12.5, fontWeight: 700, textAlign: "right" };
  const go = () => { const v = pos.map(x => parseFloat(String(x).replace(",", "."))); if (v.every(Number.isFinite)) api?.moveTo(...v); };
  const rb = { height: 28, padding: "0 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)",
    fontSize: 12, fontWeight: 800, cursor: "pointer" };
  const turn = (ax, sgn) => { const d = parseFloat(String(deg).replace(",", ".")); if (Number.isFinite(d) && d) api?.rotate(ax, sgn * d); };
  return <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", zIndex: 3, padding: 10, borderRadius: 14, width: 230,
    background: "color-mix(in srgb, var(--surface) 94%, transparent)", border: "1px solid var(--border)", boxShadow: "0 10px 30px rgba(0,0,0,.25)",
    display: "flex", flexDirection: "column", gap: 8, fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>
    <span style={{ fontWeight: 900, color: "var(--text)" }}>Position du centre (mm)</span>
    {["X", "Y", "Z"].map((a, i) => <label key={a} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 14 }}>{a}</span>
      <input value={pos[i]} onChange={e => setPos(p => p.map((x, j) => j === i ? e.target.value : x))} onKeyDown={e => { if (e.key === "Enter") go(); }}
        onBlur={go} style={inp}/>
    </label>)}
    <span style={{ fontWeight: 900, color: "var(--text)", marginTop: 4 }}>Tourner de</span>
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input value={deg} onChange={e => setDeg(e.target.value)} style={inp}/> °
    </label>
    {["x", "y", "z"].map(a => <div key={a} style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ width: 14 }}>{a.toUpperCase()}</span>
      <button type="button" onClick={() => turn(a, 1)} style={rb}>⟲ +</button>
      <button type="button" onClick={() => turn(a, -1)} style={rb}>⟳ −</button>
    </div>)}
  </div>;
}

// l'aide de l'edition : tous les gestes et raccourcis
const EDIT_HELP = [
  ["Regarder", [
    ["Clic gauche glissé", "tourner autour du modèle"],
    ["Clic molette ou clic droit glissé", "déplacer la vue"],
    ["Molette", "zoomer (vers la souris)"],
    ["Double-clic", "centrer la vue sur le point visé"],
    ["Z", "cadrer la sélection (ou tout le modèle)"],
    ["Pavé en bas à droite", "au stylet : 🔄 / ✋ ce que fait le glisser (tourner ou déplacer la vue), ＋ / － zoomer"],
  ]],
  ["Choisir", [
    ["Clic sur une pièce", "la choisir (ou tout son groupe)"],
    ["Ctrl / Maj + clic", "en ajouter ou en retirer"],
    ["Alt + clic", "une pièce seule dans un groupe"],
    ["Ctrl + A", "tout choisir"],
    ["Échap", "plus rien de choisi (la fenêtre reste ouverte) ; Échap maintenu quitte le plein écran"],
    ["➕ Multi", "au stylet : chaque clic ajoute ou retire une pièce (comme Ctrl + clic)"],
    ["H / Alt + H", "masquer la sélection (pour atteindre ce qu'elle cache) / tout réafficher"],
    ["✂ Séparer", "propose de séparer la pièce choisie en ses morceaux qui ne se touchent pas (colorés pour les voir) : ✓ pour valider, ✕ pour laisser ; ⊕ Réunir la remet d'un seul tenant"],
    ["🔗 Grouper (Ctrl + G)", "les pièces choisies bougent ensemble ; ⛓ Dégrouper (Ctrl + Maj + G)"],
  ]],
  ["Déplacer (M)", [
    ["Flèches de la poignée", "tirer dans un axe ; le carré, dans un plan"],
    ["← → ↑ ↓", "1 mm (Maj : 10 mm)"],
    ["Ctrl + ↑ ↓", "monter, descendre"],
    ["Panneau de droite", "la position exacte du centre (X, Y, Z en mm), puis Entrée"],
  ]],
  ["Tourner (R)", [
    ["Anneaux de la poignée", "tourner autour d'un axe ; cran au choix (libre, 1°, 5°, 15°, 45°)"],
    ["← →  /  ↑ ↓", "1° autour de Z / de X (Maj : 15°)"],
    ["Panneau de droite", "tourner d'un angle exact autour de X, Y ou Z"],
  ]],
  ["Poser au sol (F)", [["Clic sur une face", "elle se pose à plat sur le sol ; une arête : mise à l'horizontale"]]],
  ["Coller (C)", [
    ["Face puis face", "la première pièce vient se plaquer contre l'autre"],
    ["Arête puis arête", "les arêtes s'alignent"],
    ["🪄 Assisté", "faces entières centrées et grands axes alignés ; arêtes milieu contre milieu"],
    ["Glisser la pièce collée", "elle coulisse sur la face (ou le long de l'arête) sans se décoller"],
    ["Maj + glisser", "elle tourne autour du contact (au cran choisi ; Alt : libre) ; au stylet : ⟳ Tourner collée"],
    ["⟲ / ⟳ 90° 15°", "tourner d'un cran autour du contact"],
    ["Les pièces collées", "suivent celle sur laquelle elles sont collées"],
    ["✂ Décoller", "libérer la pièce (écartée de 2 mm)"],
    ["🧩 Emboîter (E)", "colle d'abord les deux faces qui se touchent une fois emboîtées (l'épaulement) ; l'assistant cherche tout près (décalage, quart de tour) la place où la pièce repose sans rien traverser, puis l'enfonce aussi loin que possible"],
    ["🛡 Anti-collision", "en coulissant, la pièce collée s'arrête au contact de la matière"],
  ]],
  ["Toujours", [
    ["Alt maintenu en glissant", "sans aucun cran"],
    ["🧷 Aimanter", "déplacement au mm ; lâchée à moins de 3 mm du sol ou d'une pièce, elle s'y colle"],
    ["Ctrl + Z / Ctrl + Y", "annuler / refaire"],
    ["💾 Enregistrer", "gardé dans BambuNymous, ton 3MF n'est pas touché ; ↺ Vue du 3MF pour revenir"],
  ]],
];
function EditHelp({ onClose }) {
  return <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 6, background: "rgba(2,6,23,.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div onClick={e => e.stopPropagation()} style={{ width: "min(760px, calc(100% - 32px))", maxHeight: "calc(100% - 40px)", overflowY: "auto", padding: "16px 18px",
      borderRadius: 16, background: "var(--sheet-bg)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,.4)", color: "var(--text2)" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <b style={{ flex: 1, fontSize: 16, color: "var(--text)" }}>Éditer l'assemblage</b>
        <button type="button" onClick={onClose} style={{ border: "none", background: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "10px 18px" }}>
        {EDIT_HELP.map(([t, rows]) => <div key={t}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0EA5E9", textTransform: "uppercase", letterSpacing: ".05em", margin: "6px 0 4px" }}>{t}</div>
          {rows.map(([k, v]) => <div key={k} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.45, padding: "2px 0" }}>
            <b style={{ color: "var(--text)", flex: "0 0 150px" }}>{k}</b><span>{v}</span></div>)}
        </div>)}
      </div>
    </div>
  </div>;
}

function EditVersions({ list, dirty, onPick, onClose }) {
  const when = t => t ? new Date(t * 1000).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "?";
  const why = v => v.other ? "Enregistré sur une autre vue de ce modèle" : v.why === "vue du 3MF" ? "Avant « Vue du 3MF »" : "Version remplacée";
  return <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 6, background: "rgba(2,6,23,.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div onClick={e => e.stopPropagation()} style={{ width: "min(460px, calc(100% - 32px))", maxHeight: "calc(100% - 40px)", overflowY: "auto", padding: "16px 18px",
      borderRadius: 16, background: "var(--sheet-bg)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,.4)", color: "var(--text2)",
      display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <b style={{ flex: 1, fontSize: 16, color: "var(--text)" }}>🕘 Assemblages enregistrés</b>
        <button type="button" onClick={onClose} aria-label="Fermer" style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {list === "busy" ? <span style={{ fontSize: 13 }}>…</span>
        : !list.length ? <span style={{ fontSize: 13 }}>Aucune autre version pour l'instant : chaque enregistrement gardera désormais la précédente.</span>
        : <>
          {dirty && <span style={{ fontSize: 12, color: "#d97706", fontWeight: 700 }}>Les changements non enregistrés seront perdus.</span>}
          {list.map(v => <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)" }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
              <div style={{ fontWeight: 800, color: "var(--text)" }}>{when(v.at)} · {v.n} pièce{v.n > 1 ? "s" : ""}</div>
              <div style={{ color: "var(--muted)", fontWeight: 600 }}>{why(v)}</div>
            </div>
            <button type="button" onClick={() => onPick(v.id)} style={{ height: 32, padding: "0 12px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 800,
              color: "#fff", background: "linear-gradient(135deg, #0EA5E9, #6366F1)" }}>Reprendre</button>
          </div>)}
        </>}
    </div>
  </div>;
}

function EditBar({ est, api, onSave, onReset, onClose, saving, onVersions }) {
  const [sure, setSure] = useState(false);
  const [help, setHelp] = useState(false);
  if (!est) return null;
  const b = (on, extra = {}) => ({ height: 34, padding: "0 12px", borderRadius: 10, border: on ? "none" : "1px solid var(--border)", cursor: "pointer",
    fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap", color: on ? "#fff" : "var(--text2)",
    background: on ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "var(--surface)", ...extra });
  const tip = est.glued && est.step !== 2 ? `Collée à ${est.glued.to} : glisse-la pour la faire coulisser ${est.glued.kind === "edge" ? "le long de l'arête" : "sur la face"}, Maj + glisser pour la tourner autour du contact · ✂ Décoller pour la libérer`
    : est.mode === "mate" ? (est.step === 2 ? EDIT_TIPS.mate2 : est.pairs ? `Collée${est.pairs > 1 ? ` en ${est.pairs} points` : ""} : Maj + clic (ou ➕ Multi) sur un autre point, une face ou une arête de la pièce, puis sur sa cible, pour fixer l'orientation`
      : est.assist ? EDIT_TIPS.mate1a : EDIT_TIPS.mate1) : EDIT_TIPS[est.mode];
  return <>
    <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, padding: 6, borderRadius: 14, zIndex: 3,
      background: "color-mix(in srgb, var(--surface) 92%, transparent)", border: "1px solid var(--border)", backdropFilter: "blur(8px)",
      boxShadow: "0 10px 30px rgba(0,0,0,.25)", flexWrap: "wrap", justifyContent: "center", maxWidth: "calc(100% - 24px)" }}>
      {[["move", "✥ Déplacer"], ["rotate", "⟳ Tourner"], ["ground", "⬇ Poser au sol"], ["mate", "🧲 Coller"]].map(([m, l]) =>
        <button key={m} type="button" onClick={() => api?.setMode(m)} style={b(est.mode === m)}>{l}</button>)}
      <span style={{ width: 1, background: "var(--border)", margin: "0 2px" }}/>
      <button type="button" onClick={() => api?.setMagnet(!est.magnet)} style={b(est.magnet)}
        data-tip="Aimantation : pas de 1 mm et 15°, et une pièce lâchée près d'une autre ou du sol vient s'y coller">🧷 Aimanter</button>
      <select value={est.rotStep} onChange={e => api?.setRotStep(Number(e.target.value))} data-tip="Le cran des rotations à la poignée (Alt maintenu : sans cran)"
        style={{ height: 34, padding: "0 8px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)",
          fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>
        {[[0, "⟳ libre"], [1, "⟳ 1°"], [5, "⟳ 5°"], [15, "⟳ 15°"], [45, "⟳ 45°"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <button type="button" onClick={() => api?.setMulti(!est.multi)} style={b(est.multi)}
        data-tip="Choisir plusieurs pièces d'un clic chacune (comme Ctrl + clic, pour le stylet)">➕ Multi</button>
      {est.glued && <button type="button" onClick={() => api?.setTurnGlued(!est.turnGlued)} style={b(est.turnGlued)}
        data-tip="Le glisser de la pièce collée la fait tourner autour du contact (comme Maj + glisser, pour le stylet)">⟳ Tourner collée</button>}
      <button type="button" onClick={() => api?.setAssist(!est.assist)} style={b(est.assist)}
        data-tip="Collage assisté : les faces planes entières sont centrées l'une sur l'autre et leurs grands axes alignés (sinon : au point cliqué)">🪄 Assisté</button>
      {!!(est.canGroup || est.canUngroup || est.glued || est.count > 0 || est.hidden > 0 || est.splitPending) && <span style={{ width: 1, background: "var(--border)", margin: "0 2px" }}/>}
      {est.canGroup && <button type="button" onClick={() => api?.group()} style={b(false)} data-tip="Les pièces choisies bougent ensemble (Ctrl+G)">🔗 Grouper</button>}
      {est.splitPending ? <>
        <button type="button" onClick={() => api?.splitConfirm()} style={b(true, { background: "linear-gradient(135deg, #16a34a, #0EA5E9)" })}>✓ Séparer en {est.splitPending}</button>
        <button type="button" onClick={() => api?.splitCancel()} style={b(false)}>✕ Ne pas séparer</button>
      </> : <>
        {est.canSplit && <button type="button" onClick={() => api?.splitPreview()} style={b(false)}
          data-tip="Des pièces groupées (les parties d'un objet du 3MF) : les rendre indépendantes d'un clic. Une pièce seule : proposer ses morceaux qui ne se touchent pas, à valider ou non">✂ Séparer</button>}
        {est.canReunite && <button type="button" onClick={() => api?.reunite()} style={b(false)} data-tip="Remettre la pièce d'un seul tenant">⊕ Réunir</button>}
      </>}
      {est.count > 0 && <button type="button" onClick={() => api?.hide()} style={b(false)} data-tip="Masquer la sélection pour atteindre ce qu'elle cache (H)">🙈 Masquer</button>}
      {est.hidden > 0 && <button type="button" onClick={() => api?.showAll()} style={b(false)} data-tip="Réafficher tout (Alt+H)">👁 Tout afficher ({est.hidden})</button>}
      {est.glued && <button type="button" disabled={est.fitting != null} onClick={() => api?.fit()} style={b(true, { background: "linear-gradient(135deg, #f59e0b, #ef4444)" })}
        data-tip="Chercher tout près la place où la pièce s'emboîte sans traverser la matière (E)">{est.fitting != null ? `🧩 ${est.fitting} %` : "🧩 Emboîter"}</button>}
      {est.glued && <button type="button" onClick={() => api?.setGuard(!est.guard)} style={b(est.guard)}
        data-tip="Anti-collision : en coulissant, la pièce s'arrête au contact de la matière">🛡 Anti-collision</button>}
      {est.glued && <button type="button" onClick={() => api?.unglue()} style={b(false, { color: "#ef4444" })}
        data-tip={`Collée à ${est.glued.to} : la libérer (écartée de 2 mm)`}>✂ Décoller</button>}
      {est.canUngroup && <button type="button" onClick={() => api?.ungroup()} style={b(false)} data-tip="Défaire le groupe (Ctrl+Maj+G)">⛓ Dégrouper</button>}
      {est.pivot && <>
        <span style={{ width: 1, background: "var(--border)", margin: "0 2px" }}/>
        {[[-90, "⟲ 90°"], [-15, "⟲ 15°"], [15, "⟳ 15°"], [90, "⟳ 90°"]].map(([d, l]) =>
          <button key={d} type="button" onClick={() => api?.turn(d)} style={b(false)} data-tip="Tourner la pièce collée autour du contact">{l}</button>)}
      </>}
      <span style={{ width: 1, background: "var(--border)", margin: "0 2px" }}/>
      <button type="button" disabled={!est.canUndo} onClick={() => api?.undo()} style={b(false, { opacity: est.canUndo ? 1 : 0.4 })} data-tip="Annuler (Ctrl+Z)">↶</button>
      <button type="button" disabled={!est.canRedo} onClick={() => api?.redo()} style={b(false, { opacity: est.canRedo ? 1 : 0.4 })} data-tip="Refaire (Ctrl+Y)">↷</button>
      <span style={{ width: 1, background: "var(--border)", margin: "0 2px" }}/>
      {sure ? <button type="button" onClick={() => { setSure(false); onReset(); }} style={b(false, { color: "#ef4444" })}>Confirmer : vue du 3MF</button>
        : <button type="button" onClick={() => { setSure(true); setTimeout(() => setSure(false), 4000); }} style={b(false)}
          data-tip="Oublier l'assemblage enregistré : la vue redevient celle du 3MF">↺ Vue du 3MF</button>}
      <button type="button" onClick={onVersions} style={b(false)} data-tip="Reprendre un assemblage enregistré avant (chaque version est gardée)">🕘 Versions</button>
      <button type="button" disabled={saving} onClick={onSave} style={b(true, { background: "linear-gradient(135deg, #16a34a, #0EA5E9)" })}>
        {saving ? "…" : est.dirty ? "💾 Enregistrer" : "✓ Enregistré"}</button>
      <button type="button" onClick={() => { setHelp(true); egg("mode_emploi"); }} style={b(false)} data-tip="Tous les gestes et raccourcis">?</button>
      <button type="button" onClick={onClose} style={b(false)} data-tip="Fermer l'édition">✕</button>
    </div>
    {help && <EditHelp onClose={() => setHelp(false)}/>}
    {(est.mode === "move" || est.mode === "rotate") && <ExactPanel est={est} api={api}/>}
    <PiecesPanel est={est} api={api}/>
    <div style={{ position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)", zIndex: 3, padding: "7px 14px", borderRadius: 12, fontSize: 12.5,
      fontWeight: 700, color: "var(--text2)", background: "color-mix(in srgb, var(--surface) 92%, transparent)", border: "1px solid var(--border)",
      maxWidth: "calc(100% - 140px)", textAlign: "center" }}>
      {est.splitPending ? <b style={{ color: "#0EA5E9" }}>{est.splitPending} morceaux, chacun de sa couleur : ✓ Séparer en {est.splitPending}, ou ✕ Ne pas séparer</b>
        : est.fitMsg ? <b style={{ color: /^Emboîtée/.test(est.fitMsg) ? "#16a34a" : "#d97706" }}>{est.fitMsg}</b>
        : est.fitting != null ? <b style={{ color: "#f59e0b" }}>🧩 Recherche de l'emboîtement… {est.fitting} %</b>
        : est.liveAngle != null ? <b style={{ color: "#0EA5E9", fontSize: 15 }}>Rotation : {String(est.liveAngle).replace(".", ",")}°</b> : <>
      {est.selected && (est.mode === "move" || est.mode === "rotate") ? <b style={{ color: "#0EA5E9" }}>{est.selected} · </b> : null}{tip}
      {est.count > 0 && <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>Les autres pièces s'estompent : clic dans le vide ou Échap pour tout désélectionner</span>}</>}
    </div>
  </>;
}

// Le cercle d'attente : l'avancement en %, ou un arc qui tourne quand il n'est pas mesurable
function Ring({ pct = null, label }) {
  const r = 30, c = 2 * Math.PI * r;
  const known = pct != null;
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
    <div style={{ position: "relative", width: 76, height: 76 }}>
      <svg width="76" height="76" viewBox="0 0 76 76" style={{ animation: known ? "none" : "bn3dspin 1s linear infinite" }}>
        <defs><linearGradient id="bn3dring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0EA5E9"/><stop offset="1" stopColor="#6366F1"/></linearGradient></defs>
        <circle cx="38" cy="38" r={r} fill="none" stroke="var(--border)" strokeWidth="6"/>
        <circle cx="38" cy="38" r={r} fill="none" stroke="url(#bn3dring)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={known ? c * (1 - pct / 100) : c * 0.72} transform="rotate(-90 38 38)"
          style={{ transition: "stroke-dashoffset .4s ease" }}/>
      </svg>
      {known && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 15, fontWeight: 900, background: "linear-gradient(135deg, #0EA5E9, #6366F1)", WebkitBackgroundClip: "text",
        backgroundClip: "text", color: "transparent" }}>{pct} %</div>}
    </div>
    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>{label}</div>
    <style>{"@keyframes bn3dspin { to { transform: rotate(360deg); } }"}</style>
  </div>;
}

// Le 3MF d'origine MakerWorld (profileId / printId pour le profil). Un interrupteur passe des couleurs d'origine
// a celles des filaments retenus (palette : {couleur du createur RRGGBB : couleur}, « À faire ») ou utilises
// (usedPrints : ces impressions, le serveur rapproche chaque filament du projet de la bobine qui l'a remplace).
// fetchSource : recuperer le 3MF d'origine s'il manque (« À faire »).
export default function Model3D({ designId = null, profileId = null, printId = null, wait = false, title = "", onClose,
                                  palette = null, platePalettes = null, paletteFinishes = null, paletteMulti = null, altName = null, usedPrints = null,
                                  fetchSource = false, scope = null }) {
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState(null);
  const [plate, setPlate] = useState(0);
  const [st, setSt] = useState({ busy: true });
  // l'apercu MakerWorld (sans couleurs) : le 3MF d'origine se recupere a la demande (un telechargement MakerWorld)
  const [want3mf, setWant3mf] = useState(false);
  // un plateau abime (le serveur a oublie la vue) : on redemande, la vue se refait -- une fois
  const [redo, setRedo] = useState(0);
  const [tick, setTick] = useState(0);                 // un choix de couleur a la main : la vue se relit
  const [again, setAgain] = useState(0);               // la suite des plateaux en preparation
  const plateRef = useRef(0);
  const softRef = useRef(false);
  plateRef.current = plate;
  useEffect(() => { if (st.broken && redo < 1) { setSt({ busy: true }); setRedo(r => r + 1); } }, [st.broken]);   // eslint-disable-line react-hooks/exhaustive-deps
  const base = `/makerworld/3d/${encodeURIComponent(designId)}`;
  useEffect(() => {
    if (wait) return;                    // le profil se deduit encore (fiche d'une impression)
    let alive = true;
    // la relecture de la suite (plateaux en preparation) ne vide pas la vue deja ouverte
    const soft = softRef.current;
    softRef.current = false;
    if (!soft) { setErr(null); setMeta(null); }
    // le profil montre par la fiche ; sans lui, le serveur lit celui de l'impression (imprimante, ou choisi a la main)
    client.get(base, { params: { profile: profileId || "", print_id: printId || 0, fetch: fetchSource || want3mf ? 1 : 0,
                                 used: (usedPrints || []).join(","), scope: scope || "" }, timeout: 180000 })
      .then(({ data }) => { if (alive) {
        // une relecture pendant la preparation : on reste sur le plateau regarde
        setMeta(old => { const was = old?.plates?.[plateRef.current]?.n;
          const i = was == null ? 0 : Math.max(0, (data.plates || []).findIndex(x => x.n === was));
          setPlate(i); return data; });
      } })
      .catch(e => { if (!alive) return; if (soft) setTimeout(() => { softRef.current = true; setAgain(a => a + 1); }, 3000);
        else setErr(e?.response?.data?.detail || "Pas de modèle 3D pour celui-ci"); });
    return () => { alive = false; };
  }, [base, profileId, printId, wait, want3mf, redo, tick, again]);   // eslint-disable-line react-hooks/exhaustive-deps
  // des plateaux encore en preparation (29/10/2026) : la vue s'est ouverte sur les premiers, elle redemande la suite
  useEffect(() => {
    if (!meta?.pending) return undefined;
    const t = setTimeout(() => { softRef.current = true; setAgain(a => a + 1); }, 1500);
    return () => clearTimeout(t);
  }, [meta]);
  // pendant la preparation, son avancement (le serveur le dit a part, la demande principale attend)
  const [prog, setProg] = useState(null);
  useEffect(() => {
    if (wait || (meta && !meta.pending) || err) { setProg(null); return; }
    let alive = true;
    const tick = () => client.get(`${base}/progress`, { params: { t: Date.now() } })
      .then(({ data }) => alive && setProg(data?.label ? data : null)).catch(() => {});
    const id = setInterval(tick, 500);
    tick();
    return () => { alive = false; clearInterval(id); };
  }, [base, wait, !!meta && !meta.pending, err]);   // eslint-disable-line react-hooks/exhaustive-deps
  // chez un copain (29/10/2026) : les fichiers de plateau viennent de chez lui, par le relais de mon serveur
  // (une adresse deja reecrite par le relais -- les reponses d'un copain le sont -- n'est pas reprefixee : le relais
  // refusait « friends/… » en 400)
  const viaFriend = u => currentFriend() && typeof u === "string" && u.startsWith("/api/v1/") && !u.startsWith("/api/v1/friends/")
    ? apiUrl(u.slice(7)) : u;
  const p0 = meta?.plates?.[plate];
  const p = p0 ? { ...p0, url: viaFriend(p0.url) } : p0;
  // un plateau dont le filament change a une hauteur (le « M600 » pose dans Bambu Studio, 28/10/2026) : le
  // serveur a coupe les pieces a ces hauteurs, chaque tranche a sa couleur ; on les dit sous la vue
  const zc = p?.z_colors || [];
  useEffect(() => { if (zc.length) egg("piece_montee"); }, [zc.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  // les couleurs montrees : d'origine, ou celles des filaments retenus / utilises (par defaut, s'il y en a)
  // un plateau peut avoir ses propres choix (platePalettes : { numero : palette })
  // les couleurs utilisees du plateau affiche (un groupe : celles des impressions de CE plateau) ; sans
  // rattachement par plateau, celles de toutes les impressions
  const byPlate = meta?.used_plates && Object.keys(meta.used_plates).length > 0;
  // la vue assemblee (29/10/2026) : toutes les pieces, donc les choix (« À faire ») de tous les plateaux reunis
  const asm = !!p?.assembled;
  const merged = o => o && Object.values(o).reduce((a, x) => ({ ...(a || {}), ...(x || {}) }), null);
  const ofPlate = (o, dflt) => (p && o?.[String(p.n)]) || dflt;     // le serveur donne aussi celle de l'assemble
  const usedPal = byPlate ? ofPlate(meta.used_plates, null) : meta?.used_palette;
  const usedDetail = byPlate ? ofPlate(meta.used_details_plates, []) : meta?.used_detail || [];
  const usedFin = byPlate ? ofPlate(meta.used_finishes_plates, {}) : meta?.used_finishes;
  const usedMulti = byPlate ? ofPlate(meta.used_multi_plates, {}) : meta?.used_multi;
  const alt = (p && (asm ? merged(platePalettes) : platePalettes?.[p.n])) || palette || usedPal || null;
  const altLabel = altName || (palette || platePalettes ? "Retenues" : "Utilisées");
  const [own, setOwn] = useState(false);
  // plein ecran (PC) et edition de la vue assemblee (29/10/2026)
  const isAdmin = useIsAdmin();
  // un PC : une souris, ou un navigateur d'ordinateur (un portable tactile annonce parfois un ecran tactile), et de la place
  const desktop = typeof window !== "undefined" && window.innerWidth >= 900
    && (!!window.matchMedia?.("(pointer: fine)").matches || !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
  const wrap = useRef(null), editApi = useRef(null);
  const [full, setFull] = useState(false), [editing, setEditing] = useState(false), [est, setEst] = useState(null);
  const [savedEdit, setSavedEdit] = useState(undefined), [saving, setSaving] = useState(false), [vkey, setVkey] = useState(0);
  // la vignette 3D (29/10/2026) : prise dans la vue assemblee, rangee avec l'impression ou le groupe d'ou la vue s'ouvre
  const [shot, setShot] = useState(null);                // null | "busy"
  const shotTarget = /^(print|group):\d+$/.test(scope || "") ? { kind: scope.split(":")[0], id: scope.split(":")[1] } : (printId ? { kind: "print", id: String(printId) } : null);
  const canShot = isAdmin && !currentFriend() && !!p && !p.pending && !!shotTarget;
  const takeShot = async () => {
    setShot("busy");
    try {
      const blob = await editApi.current?.snapshot();
      if (!blob) throw new Error("Vue pas prête");
      egg("vignette_3d");
      // a ranger : nouvelle vue (jusqu'a 4) ou a la place d'une autre, puis la choisir comme vignette (30/10/2026)
      openVue3D({ ...shotTarget, shot: { blob, url: URL.createObjectURL(blob) } });
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setShot(null); }
  };
  const editable = desktop && isAdmin && !currentFriend() && !!p?.assembled && !!p?.pieces && !!meta?.key;
  const edit = savedEdit !== undefined ? savedEdit : meta?.assembly_edit;
  useEffect(() => { setSavedEdit(undefined); }, [meta?.key]);
  // les assemblages a reprendre (30/10/2026) : versions passees de cette vue, et ceux d'autres vues du meme modele
  const [versions, setVersions] = useState(null);       // null | "busy" | [{ id, at, n, why, other }]
  const openVersions = async () => {
    setVersions("busy");
    try { const r = await client.get(`/makerworld/3d/edit/${meta.key}/versions`, { params: { did: designId } }); setVersions(r.data.versions || []); }
    catch (e) { setVersions(null); showAlert(e.response?.data?.detail || e.message); }
  };
  const restoreVersion = async id => {
    try {
      const r = await client.post(`/makerworld/3d/edit/${meta.key}/restore`, { id });
      setVersions(null);
      if (editing) { await editApi.current?.editing(false); setEditing(false); setEst(null); }
      setSavedEdit(r.data); setVkey(k => k + 1);      // la vue se refait avec l'assemblage repris
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const saveEdit = async () => {
    const pieces = editApi.current?.toSave();
    if (!pieces) return;
    setSaving(true);
    try { const r = await client.put(`/makerworld/3d/edit/${meta.key}`, { pieces, did: designId, excluded: editApi.current?.editor?.excluded() || [],
      groups: editApi.current?.editor?.groups() || [],
      joints: editApi.current?.editor?.joints() || [], splits: editApi.current?.editor?.splits() || [], v: 2 });
      setSavedEdit(r.data); editApi.current?.editor?.markSaved(); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };
  const resetEdit = async () => {
    try { await client.delete(`/makerworld/3d/edit/${meta.key}`); setSavedEdit(null); egg("case_depart"); editApi.current?.editor?.reset(editApi.current.origin()); editApi.current?.editor?.markSaved();
      editApi.current?.relayout(); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  // quitter l'edition : avec des changements non enregistres, un choix explicite dans la vue (29/10/2026 : la
  // question a deux boutons se validait trop vite) ; sinon on ferme
  const [leaving, setLeaving] = useState(false);
  const closeEdit = async how => {                     // how : "save" | "discard" | undefined (rien a garder)
    setLeaving(false);
    if (how === "save") await saveEdit();
    await editApi.current?.editing(false);
    setEditing(false); setEst(null);
    if (how === "discard") setVkey(k => k + 1);        // la vue revient a la place enregistree
    else editApi.current?.relayout();
    try { navigator.keyboard?.unlock?.(); } catch { /* rien */ }
    if (document.fullscreenElement === wrap.current) document.exitFullscreen?.().catch(() => {});
  };
  const stopEdit = () => { if (editApi.current?.editor?.state().dirty) setLeaving(true); else closeEdit(); };
  const startEdit = async () => {
    if (document.fullscreenElement !== wrap.current) await wrap.current?.requestFullscreen?.().catch(() => {});
    // en plein ecran, Echap revient a l'edition (desselectionner) au lieu de quitter (30/10/2026) : le garder enfonce
    // quitte le plein ecran (Chrome, Edge)
    try { await navigator.keyboard?.lock?.(["Escape"]); } catch { /* navigateur sans verrou du clavier */ }
    const ed = await editApi.current?.editing(true, setEst);
    if (ed) setEditing(true);
  };
  useEffect(() => {
    const f = () => { const on = document.fullscreenElement === wrap.current; setFull(on); if (on) egg("grand_ecran"); if (!on && editing) stopEdit(); };
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = alt && !own ? alt : null;
  const mm = v => `${Math.round(v)} mm`;
  return createPortal(
    <FSheet onClose={onClose} z={4600}>
      <div style={{ padding: "48px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {meta?.profile_cover
            ? <MwImg src={meta.profile_cover} w={96} alt="" style={{ width: 48, height: 48, borderRadius: 13, objectFit: "cover", flexShrink: 0,
                border: "1px solid var(--border)", boxShadow: "0 8px 18px -8px #0EA5E9" }}/>
            : <span style={{ width: 40, height: 40, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0,
            background: "linear-gradient(135deg, #0EA5E9, #6366F1)", boxShadow: "0 8px 18px -8px #0EA5E9" }}>🧊</span>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#0EA5E9" }}>Vue 3D</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title || `Modèle ${designId}`}</div>
            {meta?.profile_title && <div data-tip="Le profil affiché" style={{ fontSize: 11.5, fontWeight: 700, color: "#0891b2", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🧩 {meta.profile_title}</div>}
          </div>
        </div>
        {meta?.plates?.length > 1 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {meta.plates.map((x, i) => <button key={x.n} type="button" onClick={() => setPlate(i)} style={{ padding: "5px 12px", borderRadius: 20, cursor: "pointer",
            fontSize: 12.5, fontWeight: 800, border: i === plate ? "none" : "1px solid var(--border)", color: i === plate ? "#fff" : "var(--text2)",
            background: i === plate ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "var(--surface2)" }}>{x.pending ? "⏳ " : ""}{x.assembled ? "🧩 Assemblé" : x.name ? `${x.n} · ${x.name}` : `Plateau ${x.n}`}</button>)}
        </div>}
        <div ref={wrap} style={{ position: "relative", height: full ? "100vh" : "min(62dvh, 560px)", borderRadius: full ? 0 : 18, overflow: "hidden",
          border: full ? "none" : "1px solid var(--border)",
          background: "radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, #0EA5E9 10%, var(--surface)), var(--surface2))" }}>
          {p && !p.pending && <Viewer key={`${p.url}|${shown ? "alt" : "own"}|${vkey}`} url={p.url} glb={isGlb(p.url)} onState={setSt} palette={shown}
            pieces={p.assembled ? p.pieces : null} edit={p.assembled ? edit : null} editApi={editApi} pad={full || editing}
            finishes={shown ? (palette || platePalettes ? paletteFinishes : usedFin) : meta?.finishes}
            multi={shown ? (palette || platePalettes ? paletteMulti : usedMulti) : null} glow={!!st.glow} litho={!!p.litho}
            bed={asm && p.size_mm ? [Math.ceil(p.size_mm[0] * 1.2 / 16) * 16, Math.ceil(p.size_mm[1] * 1.2 / 16) * 16] : meta?.bed}/>}
          {editing && <EditBar est={est} api={editApi.current?.editor} onSave={saveEdit} onReset={resetEdit} onClose={stopEdit} saving={saving} onVersions={openVersions}/>}
          {versions && <EditVersions list={versions} dirty={!!est?.dirty} onPick={restoreVersion} onClose={() => setVersions(null)}/>}
          {editing && leaving && <div style={{ position: "absolute", inset: 0, zIndex: 7, background: "rgba(2,6,23,.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "min(420px, calc(100% - 32px))", padding: "18px 18px 14px", borderRadius: 16, background: "var(--sheet-bg)", border: "1px solid var(--border)",
              boxShadow: "0 20px 60px rgba(0,0,0,.4)", display: "flex", flexDirection: "column", gap: 10 }}>
              <b style={{ fontSize: 15, color: "var(--text)" }}>L'assemblage a des changements non enregistrés</b>
              <button type="button" onClick={() => closeEdit("save")} style={{ height: 40, borderRadius: 12, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 800,
                color: "#fff", background: "linear-gradient(135deg, #16a34a, #0EA5E9)" }}>💾 Enregistrer et fermer</button>
              <button type="button" onClick={() => closeEdit("discard")} style={{ height: 40, borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer",
                fontSize: 14, fontWeight: 800, color: "#ef4444", background: "var(--surface)" }}>Fermer sans enregistrer</button>
              <button type="button" onClick={() => setLeaving(false)} style={{ height: 36, borderRadius: 12, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
                color: "var(--text2)", background: "transparent" }}>↩ Continuer l'édition</button>
            </div>
          </div>}
          {desktop && p && !p.pending && !st.busy && !editing && <div style={{ position: "absolute", left: 10, bottom: 10, display: "flex", gap: 8, zIndex: 2 }}>
            <button type="button" onClick={() => full ? document.exitFullscreen?.() : wrap.current?.requestFullscreen?.().catch(() => {})}
              data-tip={full ? "Quitter le plein écran" : "Plein écran"} style={{ width: 38, height: 38, borderRadius: 12, border: "1px solid var(--border)",
                cursor: "pointer", background: "var(--surface)", color: "var(--text2)", fontSize: 16, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>{full ? "🗗" : "⛶"}</button>
            {canShot && <button type="button" disabled={shot === "busy"} onClick={takeShot}
              data-tip={`Prendre la vue telle que tu la regardes (${p.assembled ? "l'assemblage" : "ce plateau"}) comme vignette ${shotTarget.kind === "group" ? "du groupe" : "de l'impression"}, sans la grille`}
              style={{ height: 38, padding: "0 12px", borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer", fontSize: 13, fontWeight: 800,
                background: "var(--surface)", color: "var(--text2)", boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>{shot === "busy" ? "…" : "📸 Vignette"}</button>}
            {editable && <button type="button" onClick={startEdit} data-tip="Déplacer, tourner, poser au sol, coller les pièces (en plein écran)"
              style={{ height: 38, padding: "0 12px", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 800, color: "#fff",
                background: "linear-gradient(135deg, #0EA5E9, #6366F1)", boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>✏️ Éditer l'assemblage</button>}
            {editable && <button type="button" disabled={versions === "busy"} onClick={openVersions} data-tip="Reprendre un assemblage enregistré avant (chaque version est gardée)"
              style={{ width: 38, height: 38, borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer", background: "var(--surface)", color: "var(--text2)",
                fontSize: 16, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>🕘</button>}
          </div>}
          {!editing && alt && p && !p.pending && !isGlb(p.url) && <div style={{ position: "absolute", top: 10, left: 10, display: "flex", padding: 3, gap: 2, borderRadius: 20,
            background: "color-mix(in srgb, var(--surface) 88%, transparent)", border: "1px solid var(--border)", backdropFilter: "blur(6px)" }}>
            {[[true, "Couleurs d'origine"], [false, `Couleurs ${altLabel.toLowerCase()}`]].map(([o, l]) => <button key={l} type="button" onClick={() => setOwn(o)}
              style={{ padding: "5px 11px", borderRadius: 16, border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 800,
                color: own === o ? "#fff" : "var(--text2)", background: own === o ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "transparent" }}>{l}</button>)}
          </div>}
          {(!meta && !err) || p?.pending || (p && st.busy) ? <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none" }}>
            <Ring pct={meta && !p?.pending ? null : prog?.pct ?? null}
              label={p?.pending ? prog?.label || "Préparation de ce plateau…" : meta ? "Chargement du plateau…" : prog?.label || "Préparation du modèle…"}/></div> : null}
          {(err || st.error || (st.broken && redo >= 1)) && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
            textAlign: "center", fontSize: 13, fontWeight: 700, color: "#ef4444" }}>{err || (st.error ? `Plateau illisible : ${st.error}` : "Plateau abîmé, même refait : rouvre la vue plus tard")}</div>}
        </div>
        {meta && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
          <span>{meta.source === "3mf" && shown ? `3MF d'origine, aux couleurs des filaments ${altLabel.toLowerCase()}`
            : meta.source === "3mf" ? "3MF d'origine, aux couleurs de ses filaments"
            : meta.source === "3mf_other" ? "3MF d'origine d'un autre profil du modèle" : "Aperçu MakerWorld (sans couleurs)"}</span>
          {meta.source === "makerworld" && !want3mf && <button type="button" onClick={() => setWant3mf(true)}
            data-tip="Compte comme un téléchargement MakerWorld (une fois pour ce profil)"
            style={{ padding: "3px 10px", borderRadius: 14, border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 800, color: "#fff",
              background: "linear-gradient(135deg, #0EA5E9, #6366F1)" }}>🎨 Récupérer le 3MF d'origine (couleurs)</button>}
          {meta.fetch_error && <span style={{ color: "#ef4444" }}>· 3MF non récupéré : {meta.fetch_error}</span>}
          {meta.ms >= 1000 && <span data-tip="La première ouverture prépare le modèle ; les suivantes sont immédiates">· préparé en {(meta.ms / 1000).toFixed(1).replace(".", ",")} s</span>}
          {st.size && !p?.pending && <span>· {mm(st.size[0])} × {mm(st.size[1])} × {mm(st.size[2])}</span>}
          {p?.triangles ? <span>· {p.triangles.toLocaleString("fr-FR")} triangles</span> : null}
          {p?.assembled && edit?.pieces && <span style={{ color: edit.from_key ? "#d97706" : "#16a34a" }}
            data-tip={edit.from_key ? "Enregistré sur une autre vue de ce modèle (un autre profil) : enregistre-le ici pour le garder" : "Ton assemblage enregistré"}>
            · {edit.from_key ? "assemblage repris d'une autre vue du modèle" : "assemblage enregistré"}</span>}
          {p?.tidied && !(p?.assembled && edit?.pieces) && <span data-tip="Dans le 3MF, les pièces étaient dispersées : celles qui se touchent restent ensemble, les autres sont rapprochées">· pièces rapprochées</span>}
          {zc.length > 0 && <span data-tip="Changement de filament posé dans Bambu Studio à cette hauteur : au-dessus, les pièces prennent cette couleur"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>· changement de filament à
            {zc.map(([z, c], i) => <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", display: "inline-block", border: "1px solid var(--border)",
                background: shown?.[c] ? `#${hex6(shown[c])}` : `#${c}` }}/>{String(z).replace(".", ",")} mm{i < zc.length - 1 ? "," : ""}</span>)}</span>}
          {meta.skipped?.length > 0 && <span>· plateau{meta.skipped.length > 1 ? "x" : ""} {meta.skipped.join(", ")} trop lourd{meta.skipped.length > 1 ? "s" : ""} pour être affiché</span>}
        </div>}
        {/* les couleurs utilisees : chaque couleur du createur et ce qui l'a remplacee (ou rien de trouve) ; avec une
            portee (impression ou groupe), toucher une paire pour choisir soi-meme */}
        {shown && !palette && usedDetail.length > 0 && <ColorPairs detail={usedDetail} options={meta?.used_options || []} chosen={meta?.chosen || {}}
          scope={meta?.scope || null} onChoose={async (o, body) => { try { await chooseColor(meta.scope, o, body); } catch { /* rien */ } setTick(t => t + 1); }}/>}
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--muted)" }}>Un doigt pour tourner, deux pour zoomer et déplacer ; ⟲ recentre.</p>
      </div>
    </FSheet>,
    document.body);
}
