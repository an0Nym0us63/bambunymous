import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FSheet } from "./FicheKit";
import client from "../api/client";

// La vue 3D d'un modele (27/10/2026) : son 3MF d'origine garde sur le serveur (converti la-bas, aux couleurs de
// ses filaments), sinon l'apercu 3D de MakerWorld (sans couleurs). Un plateau a la fois ; on tourne au doigt
// ou a la souris, on zoome, on recentre. three.js n'est charge qu'ici, a l'ouverture.
const BED = 256;

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

function Viewer({ url, glb, onState }) {
  const box = useRef(null);
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
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(150, 300, 200); scene.add(sun);
      const back = new THREE.DirectionalLight(0xffffff, 0.6); back.position.set(-200, 120, -150); scene.add(back);
      // le plateau de l'imprimante, en repere
      const grid = new THREE.GridHelper(BED, 16, 0x94a3b8, 0xcbd5e1); grid.material.transparent = true; grid.material.opacity = 0.45; scene.add(grid);
      const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 1, 5000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.15;                  // un elan court : la vue s'arrete vite d'elle-meme
      // une seule boucle, et seulement pendant que la vue bouge (27/10/2026) : avant, chaque image en demandait
      // deux (la suivante, et une de plus par l'evenement « change » que la mise a jour declenche elle-meme) ;
      // ca doublait a chaque image, plus de 3 000 rendus par seconde en tournant
      let raf = 0, running = false, dragging = false, stopAt = 0;
      const render = () => { renderer.render(scene, camera); };
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
      const ro = new ResizeObserver(() => { renderer.setSize(el.clientWidth, el.clientHeight); camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); render(); });
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
          const mat = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.55, metalness: 0.05 });
          gl.scene.traverse(o => { if (o.isMesh) o.material = mat; });
          // l'apercu MakerWorld est en metres (glTF) : en millimetres, comme le plateau
          gl.scene.scale.setScalar(1000);
          model.add(gl.scene);
        } else {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const groups = parseBin(await r.arrayBuffer());
          const holder = new THREE.Group(); holder.rotation.x = -Math.PI / 2;     // le 3MF a Z vers le haut
          for (const g of groups) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.BufferAttribute(g.pos, 3));
            geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
            geo.computeVertexNormals();
            const c = new THREE.Color(`rgb(${g.color.join(",")})`);
            holder.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.05 })));
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
        api.current = { fit };
        const s = bb2.getSize(new THREE.Vector3());
        onState({ busy: false, error: null, size: glb ? [s.x, s.z, s.y] : [s.x, s.z, s.y] });
      } catch (e) {
        onState({ busy: false, error: e?.message || "Modèle illisible" });
      }
    })();
    return () => { dead = true; cleanup(); api.current = null; };
  }, [url, glb]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div style={{ position: "relative", width: "100%", height: "100%" }}>
    <div ref={box} style={{ position: "absolute", inset: 0, touchAction: "none" }}/>
    <button type="button" onClick={() => api.current?.fit()} data-tip="Recentrer la vue"
      style={{ position: "absolute", right: 10, bottom: 10, width: 38, height: 38, borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer",
        background: "var(--surface)", color: "var(--text2)", fontSize: 16, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>⟲</button>
  </div>;
}

export default function Model3D({ designId, profileId = null, printId = null, wait = false, title = "", onClose }) {
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState(null);
  const [plate, setPlate] = useState(0);
  const [st, setSt] = useState({ busy: true });
  useEffect(() => {
    if (wait) return;                    // le profil se deduit encore (fiche d'une impression)
    let alive = true;
    setErr(null);
    // le profil montre par la fiche ; sans lui, le serveur lit celui de l'impression (imprimante, ou choisi a la main)
    client.get(`/makerworld/3d/${encodeURIComponent(designId)}`, { params: { profile: profileId || "", print_id: printId || 0 }, timeout: 180000 })
      .then(({ data }) => { if (alive) { setMeta(data); setPlate(0); } })
      .catch(e => alive && setErr(e?.response?.data?.detail || "Pas de modèle 3D pour celui-ci"));
    return () => { alive = false; };
  }, [designId, profileId, printId, wait]);
  const p = meta?.plates?.[plate];
  const mm = v => `${Math.round(v)} mm`;
  return createPortal(
    <FSheet onClose={onClose} z={4600}>
      <div style={{ padding: "48px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ width: 40, height: 40, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0,
            background: "linear-gradient(135deg, #0EA5E9, #6366F1)", boxShadow: "0 8px 18px -8px #0EA5E9" }}>🧊</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#0EA5E9" }}>Vue 3D</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title || `Modèle ${designId}`}</div>
          </div>
        </div>
        {meta?.plates?.length > 1 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {meta.plates.map((x, i) => <button key={x.n} type="button" onClick={() => setPlate(i)} style={{ padding: "5px 12px", borderRadius: 20, cursor: "pointer",
            fontSize: 12.5, fontWeight: 800, border: i === plate ? "none" : "1px solid var(--border)", color: i === plate ? "#fff" : "var(--text2)",
            background: i === plate ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "var(--surface2)" }}>{x.name ? `${x.n} · ${x.name}` : `Plateau ${x.n}`}</button>)}
        </div>}
        <div style={{ position: "relative", height: "min(62dvh, 560px)", borderRadius: 18, overflow: "hidden", border: "1px solid var(--border)",
          background: "radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, #0EA5E9 10%, var(--surface)), var(--surface2))" }}>
          {p && <Viewer key={p.url} url={p.url} glb={p.url.endsWith(".glb")} onState={setSt}/>}
          {(!meta && !err) || (p && st.busy) ? <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 700, color: "var(--muted)", pointerEvents: "none" }}>{meta ? "Chargement du plateau…" : "Préparation du modèle…"}</div> : null}
          {(err || st.error) && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
            textAlign: "center", fontSize: 13, fontWeight: 700, color: "#ef4444" }}>{err || `Plateau illisible : ${st.error}`}</div>}
        </div>
        {meta && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
          <span>{meta.source === "3mf" ? "3MF d'origine, aux couleurs de ses filaments"
            : meta.source === "3mf_other" ? "3MF d'origine d'un autre profil du modèle" : "Aperçu MakerWorld (sans couleurs)"}</span>
          {meta.ms >= 1000 && <span data-tip="La première ouverture prépare le modèle ; les suivantes sont immédiates">· préparé en {(meta.ms / 1000).toFixed(1).replace(".", ",")} s</span>}
          {st.size && <span>· {mm(st.size[0])} × {mm(st.size[1])} × {mm(st.size[2])}</span>}
          {p?.triangles ? <span>· {p.triangles.toLocaleString("fr-FR")} triangles</span> : null}
          {meta.skipped?.length > 0 && <span>· plateau{meta.skipped.length > 1 ? "x" : ""} {meta.skipped.join(", ")} trop lourd{meta.skipped.length > 1 ? "s" : ""} pour être affiché</span>}
        </div>}
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--muted)" }}>Un doigt pour tourner, deux pour zoomer et déplacer ; ⟲ recentre.</p>
      </div>
    </FSheet>,
    document.body);
}
