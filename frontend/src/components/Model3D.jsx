import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { finishCanvas } from "../utils/finishTex";
import { FSheet } from "./FicheKit";
import client from "../api/client";
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
  silk: { roughness: 0.32, metalness: 0.1, envMapIntensity: 0.22 },       // un brillant satine, pas un metal (un gris virait au blanc)
  metal: { roughness: 0.32, metalness: 1, envMapIntensity: 1.5 },
  matte: { roughness: 0.95, metalness: 0 },
  carbon: { roughness: 0.38, metalness: 0.1, envMapIntensity: 0.6 },
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

function Viewer({ url, glb, onState, palette = null, finishes = null, glow = false, bed = null }) {
  const box = useRef(null);
  const [dark, setDark] = useState(false);
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
      const render = () => { if (bloomOn && composer) composer.render(); else renderer.render(scene, camera); };
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
      const ro = new ResizeObserver(() => { renderer.setSize(el.clientWidth, el.clientHeight); composer?.setSize(el.clientWidth, el.clientHeight); camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); render(); });
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
            // phosphorescent : il luit de sa couleur, eclaircie (une piece eclairee de l'interieur)
            // (la couleur eclairee baissee d'autant : sinon la somme sature, et la piece vire au blanc)
            if (fin === "glow") { mat.color = c.clone().multiplyScalar(0.6); mat.emissive = c.clone(); mat.emissiveIntensity = 0.45; mat.roughness = 0.6; }
            if (FINISH_MAT[fin]?.envMapIntensity) mat.envMap = await envMap();
            // le reflet s'ajoute a l'eclairage : la couleur est un peu baissee d'autant, sinon un gris satine sort blanc
            if (fin === "silk") mat.color.multiplyScalar(0.82);
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
                  "#include <emissivemap_fragment>\n  float rimF = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 1.6);\n" +
                  "  totalEmissiveRadiance += emissive * rimF * rimK;");
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
            const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
              import("three/examples/jsm/postprocessing/EffectComposer.js"), import("three/examples/jsm/postprocessing/RenderPass.js"),
              import("three/examples/jsm/postprocessing/UnrealBloomPass.js"), import("three/examples/jsm/postprocessing/OutputPass.js")]);
            composer = new EffectComposer(renderer);
            composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(el.clientWidth, el.clientHeight);
            composer.addPass(new RenderPass(scene, camera));
            composer.addPass(new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 0.45, 0.3, 0.3));
            composer.addPass(new OutputPass());
            disposables.push(composer);
          }
          bloomOn = on;
          // une veilleuse : assez pour garder le relief de ce qui luit (sinon une silhouette plate)
          hemi.intensity = on ? 0.12 : 1.6; sun.intensity = on ? 0.35 : 1.6; back.intensity = on ? 0.08 : 0.6;
          grid.material.opacity = on ? 0.12 : 0.45;
          scene.background = on ? new THREE.Color(0x05070d) : null;
          glowMats.forEach(m => { m.emissiveIntensity = on ? m.userData.nightEmit : m.userData.dayEmit; if (m.userData.rim) m.userData.rim.value = on ? 0.6 : 2.2; });
          render();
        };
        api.current = { fit, night };
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
      background: dark ? "radial-gradient(circle at 50% 40%, #0b1020, #020308)" : "transparent" }}/>
    {glow && <button type="button" onClick={() => { const v = !dark; setDark(v); api.current?.night(v); }}
      data-tip={dark ? "Rallumer la lumière" : "Éteindre la lumière : le filament phosphorescent luit"}
      style={{ position: "absolute", right: 56, bottom: 10, height: 38, padding: "0 12px", borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer",
        background: dark ? "linear-gradient(135deg, #facc15, #f59e0b)" : "linear-gradient(135deg, #1e293b, #0f172a)", color: dark ? "#1e293b" : "#e2e8f0",
        fontSize: 13, fontWeight: 800, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>{dark ? "💡 Rallumer" : "🌙 Éteindre"}</button>}
    <button type="button" onClick={() => api.current?.fit()} data-tip="Recentrer la vue"
      style={{ position: "absolute", right: 10, bottom: 10, width: 38, height: 38, borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer",
        background: "var(--surface)", color: "var(--text2)", fontSize: 16, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>⟲</button>
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
                                  palette = null, platePalettes = null, paletteFinishes = null, altName = null, usedPrints = null,
                                  fetchSource = false }) {
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState(null);
  const [plate, setPlate] = useState(0);
  const [st, setSt] = useState({ busy: true });
  // l'apercu MakerWorld (sans couleurs) : le 3MF d'origine se recupere a la demande (un telechargement MakerWorld)
  const [want3mf, setWant3mf] = useState(false);
  // un plateau abime (le serveur a oublie la vue) : on redemande, la vue se refait -- une fois
  const [redo, setRedo] = useState(0);
  useEffect(() => { if (st.broken && redo < 1) { setSt({ busy: true }); setRedo(r => r + 1); } }, [st.broken]);   // eslint-disable-line react-hooks/exhaustive-deps
  const base = `/makerworld/3d/${encodeURIComponent(designId)}`;
  useEffect(() => {
    if (wait) return;                    // le profil se deduit encore (fiche d'une impression)
    let alive = true;
    setErr(null); setMeta(null);
    // le profil montre par la fiche ; sans lui, le serveur lit celui de l'impression (imprimante, ou choisi a la main)
    client.get(base, { params: { profile: profileId || "", print_id: printId || 0, fetch: fetchSource || want3mf ? 1 : 0,
                                 used: (usedPrints || []).join(",") }, timeout: 180000 })
      .then(({ data }) => { if (alive) { setMeta(data); setPlate(0); } })
      .catch(e => alive && setErr(e?.response?.data?.detail || "Pas de modèle 3D pour celui-ci"));
    return () => { alive = false; };
  }, [base, profileId, printId, wait, want3mf, redo]);   // eslint-disable-line react-hooks/exhaustive-deps
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
  const p = meta?.plates?.[plate];
  // les couleurs montrees : d'origine, ou celles des filaments retenus / utilises (par defaut, s'il y en a)
  // un plateau peut avoir ses propres choix (platePalettes : { numero : palette })
  const alt = (p && platePalettes?.[p.n]) || palette || meta?.used_palette || null;
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
            background: i === plate ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "var(--surface2)" }}>{x.name ? `${x.n} · ${x.name}` : `Plateau ${x.n}`}</button>)}
        </div>}
        <div style={{ position: "relative", height: "min(62dvh, 560px)", borderRadius: 18, overflow: "hidden", border: "1px solid var(--border)",
          background: "radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, #0EA5E9 10%, var(--surface)), var(--surface2))" }}>
          {p && <Viewer key={`${p.url}|${shown ? "alt" : "own"}`} url={p.url} glb={isGlb(p.url)} onState={setSt} palette={shown}
            finishes={shown ? (palette || platePalettes ? paletteFinishes : meta?.used_finishes) : meta?.finishes} glow={!!st.glow} bed={meta?.bed}/>}
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
          {meta.skipped?.length > 0 && <span>· plateau{meta.skipped.length > 1 ? "x" : ""} {meta.skipped.join(", ")} trop lourd{meta.skipped.length > 1 ? "s" : ""} pour être affiché</span>}
        </div>}
        {/* les couleurs utilisees : chaque couleur du createur et ce qui l'a remplacee (ou rien de trouve) */}
        {shown && !palette && meta?.used_detail?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6,
          fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
          <span>Correspondance :</span>
          {meta.used_detail.map(x => {
            const sw = c => <span style={{ width: 14, height: 14, borderRadius: "50%", display: "inline-block", border: "1px solid var(--border)",
              background: c ? `#${c}` : "repeating-linear-gradient(45deg, var(--surface2) 0 3px, var(--border) 3px 6px)" }}/>;
            const tip = x.to ? `Filament n°${x.e} du projet → n°${x.es} de l'impression (${x.how === "pièces" ? "trouvé par les pièces de même nom" : x.how === "couleur et poids" ? "la bobine la plus ressemblante, en couleur et en poids" : "par son numéro"})`
              : `Filament n°${x.e} : aucune de ces impressions ne l'a utilisé`;
            return <span key={`${x.from}-${x.e}`} data-tip={tip} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px",
              borderRadius: 12, background: "var(--surface2)" }}>{sw(x.from)}<span>→</span>{sw(x.to)}</span>;
          })}
        </div>}
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--muted)" }}>Un doigt pour tourner, deux pour zoomer et déplacer ; ⟲ recentre.</p>
      </div>
    </FSheet>,
    document.body);
}
