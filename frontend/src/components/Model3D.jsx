import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { finishCanvas } from "../utils/finishTex";
import { egg } from "../eggs";
import { ColorPairs, chooseColor } from "./ColorMap";
import { FSheet } from "./FicheKit";
import client, { apiUrl } from "../api/client";
import { currentFriend } from "../store/friend";
import MwImg from "./MwImg";

// La vue 3D d'un modele (27/10/2026) : son 3MF d'origine garde sur le serveur (converti la-bas, aux couleurs de
// ses filaments), sinon l'apercu 3D de MakerWorld (sans couleurs). Un plateau a la fois ; on tourne au doigt
// ou a la souris, on zoome, on recentre. three.js n'est charge qu'ici, a l'ouverture.
const BED = [256, 256];          // le plateau par defaut ; le serveur donne celui de mon imprimante (A1 mini, H2D...)

function parseBin(buf) {
  const dv = new DataView(buf);
  let o = 0;
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

function Viewer({ url, glb, onState, palette = null, finishes = null, multi = null, glow = false, bed = null, litho = false }) {
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
            const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.05, flatShading: true, envMapIntensity: 0,
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
            holder.add(piece);
          }
          model.add(holder);
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
          const compMat = new THREE.ShaderMaterial({ uniforms: { all: { value: tAll.texture }, acc: { value: acc.texture } }, depthTest: false, depthWrite: false,
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
            fragmentShader: `uniform sampler2D all; uniform sampler2D acc; varying vec2 vUv;
              void main() { float t = texture2D(all, vUv).r; vec3 T = texture2D(acc, vUv).rgb;
                vec3 c = vec3(1.0, 0.96, 0.86) * 3.2 * T;
                c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.45);       // des couleurs plus franches
                c = t > 0.02 ? max(c, 0.0) : vec3(0.006, 0.008, 0.016);
                gl_FragColor = vec4(c, 1.0);
                #include <colorspace_fragment>
              }` });
          const qT = new THREE.Scene(); qT.add(new THREE.Mesh(quad, transMat));
          const qC = new THREE.Scene(); qC.add(new THREE.Mesh(quad, compMat));
          disposables.push(tAll, tG, acc, matF, matB, transMat, compMat, quad);
          return {
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
              renderer.setRenderTarget(null); renderer.render(qC, ortho);
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
        api.current = { fit, night, backlight, bedShow };
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
  useEffect(() => { if (st.broken && redo < 1) { setSt({ busy: true }); setRedo(r => r + 1); } }, [st.broken]);   // eslint-disable-line react-hooks/exhaustive-deps
  const base = `/makerworld/3d/${encodeURIComponent(designId)}`;
  useEffect(() => {
    if (wait) return;                    // le profil se deduit encore (fiche d'une impression)
    let alive = true;
    setErr(null); setMeta(null);
    // le profil montre par la fiche ; sans lui, le serveur lit celui de l'impression (imprimante, ou choisi a la main)
    client.get(base, { params: { profile: profileId || "", print_id: printId || 0, fetch: fetchSource || want3mf ? 1 : 0,
                                 used: (usedPrints || []).join(","), scope: scope || "" }, timeout: 180000 })
      .then(({ data }) => { if (alive) { setMeta(data); setPlate(0); } })
      .catch(e => alive && setErr(e?.response?.data?.detail || "Pas de modèle 3D pour celui-ci"));
    return () => { alive = false; };
  }, [base, profileId, printId, wait, want3mf, redo, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  // pendant la preparation, son avancement (le serveur le dit a part, la demande principale attend)
  const [prog, setProg] = useState(null);
  useEffect(() => {
    if (wait || meta || err) { setProg(null); return; }
    let alive = true;
    const tick = () => client.get(`${base}/progress`, { params: { t: Date.now() } })
      .then(({ data }) => alive && setProg(data?.label ? data : null)).catch(() => {});
    const id = setInterval(tick, 500);
    tick();
    return () => { alive = false; clearInterval(id); };
  }, [base, wait, meta, err]);
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
            background: i === plate ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "var(--surface2)" }}>{x.assembled ? "🧩 Assemblé" : x.name ? `${x.n} · ${x.name}` : `Plateau ${x.n}`}</button>)}
        </div>}
        <div style={{ position: "relative", height: "min(62dvh, 560px)", borderRadius: 18, overflow: "hidden", border: "1px solid var(--border)",
          background: "radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, #0EA5E9 10%, var(--surface)), var(--surface2))" }}>
          {p && <Viewer key={`${p.url}|${shown ? "alt" : "own"}`} url={p.url} glb={isGlb(p.url)} onState={setSt} palette={shown}
            finishes={shown ? (palette || platePalettes ? paletteFinishes : usedFin) : meta?.finishes}
            multi={shown ? (palette || platePalettes ? paletteMulti : usedMulti) : null} glow={!!st.glow} litho={!!p.litho}
            bed={asm && p.size_mm ? [Math.ceil(p.size_mm[0] * 1.2 / 16) * 16, Math.ceil(p.size_mm[1] * 1.2 / 16) * 16] : meta?.bed}/>}
          {alt && p && !isGlb(p.url) && <div style={{ position: "absolute", top: 10, left: 10, display: "flex", padding: 3, gap: 2, borderRadius: 20,
            background: "color-mix(in srgb, var(--surface) 88%, transparent)", border: "1px solid var(--border)", backdropFilter: "blur(6px)" }}>
            {[[true, "Couleurs d'origine"], [false, `Couleurs ${altLabel.toLowerCase()}`]].map(([o, l]) => <button key={l} type="button" onClick={() => setOwn(o)}
              style={{ padding: "5px 11px", borderRadius: 16, border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 800,
                color: own === o ? "#fff" : "var(--text2)", background: own === o ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "transparent" }}>{l}</button>)}
          </div>}
          {(!meta && !err) || (p && st.busy) ? <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none" }}>
            <Ring pct={meta ? null : prog?.pct ?? null} label={meta ? "Chargement du plateau…" : prog?.label || "Préparation du modèle…"}/></div> : null}
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
          {st.size && <span>· {mm(st.size[0])} × {mm(st.size[1])} × {mm(st.size[2])}</span>}
          {p?.triangles ? <span>· {p.triangles.toLocaleString("fr-FR")} triangles</span> : null}
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
