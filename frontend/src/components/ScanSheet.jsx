import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";

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
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const aliveRef  = useRef(true);
  const rafRef    = useRef(null);

  const [status, setStatus] = useState("Démarrage de la caméra…");
  const [error, setError]   = useState(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    aliveRef.current = true;
    let stream = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } }, audio: false,
        });
        if (!aliveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus("Vise le QR code…");
        tick();
      } catch {
        setError("Caméra inaccessible : vérifie l'autorisation du navigateur. "
               + "Sans HTTPS, la caméra est bloquée — saisis l'ID à la main.");
      }
    })();

    const tick = () => {
      if (!aliveRef.current) return;
      const v = videoRef.current, c = canvasRef.current;
      if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
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
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [onDetect]);

  const submitManual = () => {
    const id = parseId(manual);
    if (id) onDetect(id);
  };

  return createPortal(
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9999,
      background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center",
      justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:420,
        background:"var(--sheet-bg)", borderRadius:16, overflow:"hidden" }}>

        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"12px 16px" }}>
          <p style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:0 }}>
            Scanner un échantillon
          </p>
          <button onClick={onClose} style={{ background:"none", border:"none",
            color:"var(--muted)", fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        {!error && (
          <div style={{ position:"relative", background:"#000", aspectRatio:"1" }}>
            <video ref={videoRef} playsInline muted
              style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
            <div style={{ position:"absolute", top:"25%", left:"25%", width:"50%", height:"50%",
              border:"2px solid #3b82f6", borderRadius:10,
              boxShadow:"0 0 0 9999px rgba(0,0,0,0.4)" }}/>
            <p style={{ position:"absolute", bottom:8, left:0, right:0, textAlign:"center",
              margin:0, fontSize:11, color:"white", textShadow:"0 1px 3px #000" }}>
              {status}
            </p>
          </div>
        )}
        <canvas ref={canvasRef} style={{ display:"none" }}/>

        {error && (
          <p style={{ margin:0, padding:"12px 16px", fontSize:12, color:"#ef4444" }}>⚠ {error}</p>
        )}

        <div style={{ padding:"12px 16px" }}>
          <label style={{ fontSize:11, color:"var(--muted)", display:"block", marginBottom:4 }}>
            …ou saisis l'ID imprimé sous le QR
          </label>
          <div style={{ display:"flex", gap:8 }}>
            <input value={manual} inputMode="numeric" placeholder="106"
              onChange={e => setManual(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submitManual()}
              style={{ flex:1, background:"var(--surface2)", border:"1px solid var(--border)",
                borderRadius:8, padding:"9px 12px", fontSize:14, color:"var(--text)",
                outline:"none", fontFamily:"JetBrains Mono,monospace" }}/>
            <button onClick={submitManual}
              style={{ padding:"9px 16px", borderRadius:8, border:"none", cursor:"pointer",
                background:"#3b82f6", color:"white", fontSize:13, fontWeight:700 }}>
              Ouvrir
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
