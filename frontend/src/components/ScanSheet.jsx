import React, { useEffect, useRef, useState } from "react";
import { useTrackDetail } from "../utils/track";
import { createPortal } from "react-dom";
// le decodeur QR (130 Ko) : charge a l'ouverture du lecteur, pas avec le reste de l'appli
const loadQR = () => import("jsqr").then(m => m.default || m);

/**
 * Scan du QR code imprimé sur les échantillons.
 *
 * Le QR encode simplement l'ID du filament ("106"). Contrairement à un code
 * lu en OCR, il porte sa propre correction d'erreur : une étiquette pliée,
 * salie ou mal éclairée reste lisible. On accepte aussi une URL contenant
 * ?id=… au cas où on encoderait des liens complets un jour.
 *
 * L'ID est également imprimé en clair sous le QR : la saisie manuelle ci-dessous
 * est le repli si la caméra n'est pas disponible (pas de HTTPS, permission
 * refusée…).
 */
function parseId(text) {
  if (!text) return null;
  const t = String(text).trim();
  if (/^\d+$/.test(t)) return t;                 // "106"
  const m = t.match(/[?&]id=(\d+)/)              // ".../filaments?id=106"
         || t.match(/#(\d+)\b/);                 // "#106"
  return m ? m[1] : null;
}

export default function ScanSheet({ onDetect, onClose }) {
  useTrackDetail("Filaments · Scan");
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const aliveRef  = useRef(true);
  const rafRef    = useRef(null);
  const streamRef = useRef(null);
  const trackRef  = useRef(null);
  const switchRef = useRef(null);   // change d'objectif (defini dans l'effet)

  const [status, setStatus] = useState("Démarrage de la caméra…");
  const [error, setError]   = useState(null);
  const [manual, setManual] = useState("");

  // Les objectifs x2 / x5 sont exposés de deux façons selon le téléphone :
  //  - comme des CAMÉRAS distinctes (enumerateDevices) ;
  //  - comme un ZOOM sur la piste courante (track capabilities).
  // On propose les deux, sinon impossible d'utiliser le télé — celui qui aide
  // le plus pour lire un QR de 9 mm.
  const [cams, setCams]       = useState([]);
  const [camId, setCamId]     = useState(null);
  const [zoomCap, setZoomCap] = useState(null);   // {min,max,step}
  const [zoom, setZoom]       = useState(1);

  useEffect(() => {
    aliveRef.current = true;

    const start = async (deviceId) => {
      // Couper la piste precedente, sinon certains telephones refusent d'ouvrir
      // un second objectif ("NotReadableError").
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      const constraints = deviceId
        ? { video: { deviceId: { exact: deviceId } }, audio: false }
        : { video: { facingMode: { ideal: "environment" } }, audio: false };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // Zoom optique/numerique si la piste le supporte
      const caps = track.getCapabilities?.() || {};
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        setZoomCap({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
        setZoom(track.getSettings?.().zoom ?? caps.zoom.min);
      } else {
        setZoomCap(null);
      }
      setCamId(track.getSettings?.().deviceId ?? deviceId ?? null);
    };

    (async () => {
      try {
        await start(null);
        // enumerateDevices ne donne les libelles qu'APRES une autorisation
        const devs = (await navigator.mediaDevices.enumerateDevices())
          .filter(d => d.kind === "videoinput");
        setCams(devs);
        setStatus("Vise le QR code…");
        tick();
      } catch {
        setError("Caméra inaccessible : vérifie l'autorisation du navigateur. "
               + "Sans HTTPS, la caméra est bloquée — saisis l'ID à la main.");
      }
    })();

    switchRef.current = async (id) => {
      try { await start(id); } catch { /* objectif indisponible : on garde l'actuel */ }
    };

    let jsQR = null;
    loadQR().then(f => { jsQR = f; }).catch(() => { /* sans decodeur : la camera reste, rien n'est lu */ });
    const tick = () => {
      if (!aliveRef.current) return;
      const v = videoRef.current, c = canvasRef.current;
      if (jsQR && v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
        c.width = v.videoWidth; c.height = v.videoHeight;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const res = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
        const id = res && parseId(res.data);
        if (id) {
          aliveRef.current = false;
          onDetect(id);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    return () => {
      aliveRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, [onDetect]);

  const applyZoom = async (z) => {
    setZoom(z);
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ zoom: z }] });
    } catch { /* certains navigateurs refusent : sans effet, pas grave */ }
  };


  const submitManual = () => {
    const id = parseId(manual);
    if (id) onDetect(id);
  };

  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9999,
      background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center",
      justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:420,
        background:"var(--sheet-bg)", borderRadius:22, overflow:"hidden" }}>

        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px",
          background:"linear-gradient(135deg, rgba(59,130,246,0.22), transparent 70%)" }}>
          <span style={{ width:38, height:38, borderRadius:12, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:18, color:"#fff", background:"linear-gradient(135deg, #3B82F6, #6366F1)" }}>⌗</span>
          <span style={{ flex:1, minWidth:0 }}>
            <span style={{ display:"block", fontSize:16, fontWeight:900, color:"var(--text)" }}>Scanner un échantillon</span>
            <span style={{ display:"block", fontSize:12, fontWeight:600, color:"var(--muted)" }}>Le QR collé sur la plaquette du nuancier</span>
          </span>
          <button onClick={onClose} aria-label="Fermer" style={{ width:34, height:34, borderRadius:"50%", border:"1px solid var(--border)", flexShrink:0,
            background:"var(--surface2)", color:"var(--text2)", fontSize:15, cursor:"pointer" }}>✕</button>
        </div>

        {!error && (
          <div style={{ position:"relative", background:"#000", aspectRatio:"1" }}>
            <video ref={videoRef} playsInline muted
              style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
            <div style={{ position:"absolute", top:"25%", left:"25%", width:"50%", height:"50%",
              border:"3px solid #60a5fa", borderRadius:16,
              boxShadow:"0 0 0 9999px rgba(0,0,0,0.4)" }}/>
            <p style={{ position:"absolute", bottom:8, left:0, right:0, textAlign:"center",
              margin:0, fontSize:11, color:"white", textShadow:"0 1px 3px #000" }}>
              {status}
            </p>
          </div>
        )}

        {!error && (cams.length > 1 || zoomCap) && (
          <div style={{ padding:"10px 16px 0", display:"flex", flexDirection:"column", gap:8 }}>
            {cams.length > 1 && (
              <div style={{ display:"flex", gap:6, overflowX:"auto" }}>
                {cams.map((d, i) => (
                  <button key={d.deviceId} onClick={() => switchRef.current?.(d.deviceId)}
                    style={{ flexShrink:0, padding:"6px 12px", borderRadius:16, border:"none",
                      cursor:"pointer", fontSize:12, fontWeight:800,
                      background: camId === d.deviceId ? "linear-gradient(135deg, #3B82F6, #6366F1)" : "var(--surface2)",
                      color: camId === d.deviceId ? "white" : "var(--muted)" }}>
                    {d.label || `Objectif ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
            {zoomCap && (
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:11, color:"var(--muted)" }}>Zoom</span>
                <input type="range" style={{ flex:1 }}
                  min={zoomCap.min} max={zoomCap.max} step={zoomCap.step} value={zoom}
                  onChange={e => applyZoom(Number(e.target.value))}/>
                <span style={{ fontSize:11, color:"var(--text)", minWidth:34,
                  textAlign:"right", fontFamily:"JetBrains Mono,monospace" }}>
                  ×{Number(zoom).toFixed(1)}
                </span>
              </div>
            )}
          </div>
        )}
        <canvas ref={canvasRef} style={{ display:"none" }}/>

        {error && (
          <p style={{ margin:"12px 16px 0", padding:"10px 12px", fontSize:12.5, fontWeight:700, color:"#ef4444", borderRadius:14,
            background:"rgba(239,68,68,0.10)", border:"1px solid rgba(239,68,68,0.3)" }}>⚠ {error}</p>
        )}

        <div style={{ padding:"12px 16px" }}>
          <label style={{ fontSize:12, fontWeight:800, color:"var(--muted)", display:"block", marginBottom:6 }}>
            …ou saisis l'ID imprimé sous le QR
          </label>
          <div style={{ display:"flex", gap:8 }}>
            <input value={manual} inputMode="numeric" placeholder="106"
              onChange={e => setManual(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submitManual()}
              style={{ flex:1, minWidth:0, background:"var(--surface2)", border:"1px solid var(--border)",
                borderRadius:12, padding:"0 14px", height:42, fontSize:15, fontWeight:800, color:"var(--text)",
                outline:"none", fontFamily:"JetBrains Mono,monospace" }}/>
            <button onClick={submitManual}
              style={{ padding:"0 18px", height:42, borderRadius:12, border:"none", cursor:"pointer",
                background:"linear-gradient(135deg, #3B82F6, #6366F1)", color:"white", fontSize:13.5, fontWeight:800 }}>
              Ouvrir
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
