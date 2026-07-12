import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Scan du code court (#AA) imprimé sur les échantillons.
 *
 * L'OCR de deux lettres sur une étiquette de 10 mm est la partie fragile : pas
 * de correction d'erreur, contrairement à un QR code. On met donc toutes les
 * chances de notre côté :
 *   - on ne lit qu'un cadre central (ROI), pas toute l'image ;
 *   - l'alphabet est restreint à A-Z ;
 *   - on n'accepte un code qu'après DEUX lectures identiques consécutives.
 * Et il reste une saisie manuelle en repli, qui ne dépend de rien.
 */
export default function ScanSheet({ onDetect, onClose }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const lastRef   = useRef(null);
  const aliveRef  = useRef(true);

  const [status, setStatus] = useState("Démarrage de la caméra…");
  const [error, setError]   = useState(null);
  const [manual, setManual] = useState("");
  const [seen, setSeen]     = useState(null);

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
      } catch (e) {
        setError("Caméra inaccessible. Vérifie l'autorisation du navigateur "
               + "(et le HTTPS : sans lui, la caméra est bloquée).");
        return;
      }

      setStatus("Chargement de la reconnaissance…");
      let Tesseract;
      try {
        Tesseract = (await import("tesseract.js")).default;
        workerRef.current = await Tesseract.createWorker("eng");
        await workerRef.current.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
          tessedit_pageseg_mode: "7",   // une seule ligne de texte
        });
      } catch (e) {
        setError("Moteur de reconnaissance indisponible. Saisis le code à la main.");
        return;
      }
      if (!aliveRef.current) return;
      setStatus("Vise l'étiquette…");
      loop();
    })();

    const loop = async () => {
      while (aliveRef.current) {
        try {
          const code = await grab();
          if (code) {
            setSeen(code);
            // Deux lectures identiques d'affilée : on evite les faux positifs
            if (lastRef.current === code) { finish(code); return; }
            lastRef.current = code;
          } else {
            lastRef.current = null;
          }
        } catch { /* image illisible, on continue */ }
        await new Promise(r => setTimeout(r, 500));
      }
    };

    const grab = async () => {
      const v = videoRef.current, c = canvasRef.current;
      if (!v || !c || !v.videoWidth || !workerRef.current) return null;
      // ROI : carre central, agrandi x3 (Tesseract lit mal les petits caracteres)
      const side = Math.min(v.videoWidth, v.videoHeight) * 0.42;
      const sx = (v.videoWidth - side) / 2, sy = (v.videoHeight - side) / 2;
      const S = 3;
      c.width = side * S; c.height = side * S;
      const ctx = c.getContext("2d");
      ctx.drawImage(v, sx, sy, side, side, 0, 0, c.width, c.height);
      // Passage en N&B contraste : aide beaucoup l'OCR
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
        const v2 = g > 135 ? 255 : 0;
        d[i] = d[i+1] = d[i+2] = v2;
      }
      ctx.putImageData(img, 0, 0);

      const { data } = await workerRef.current.recognize(c);
      const m = (data?.text || "").toUpperCase().match(/[A-Z]{2}/);
      return m ? m[0] : null;
    };

    const finish = (code) => {
      aliveRef.current = false;
      onDetect(code);
    };

    return () => {
      aliveRef.current = false;
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (workerRef.current) workerRef.current.terminate().catch(() => {});
    };
  }, [onDetect]);

  const submitManual = () => {
    const c = manual.trim().toUpperCase().replace(/^#/, "");
    if (/^[A-Z]{2}$/.test(c)) onDetect(c);
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
            {/* Viseur : delimite la zone reellement analysee */}
            <div style={{ position:"absolute", top:"29%", left:"29%", width:"42%", height:"42%",
              border:"2px solid #3b82f6", borderRadius:8, boxShadow:"0 0 0 9999px rgba(0,0,0,0.45)" }}/>
            <p style={{ position:"absolute", bottom:8, left:0, right:0, textAlign:"center",
              margin:0, fontSize:11, color:"white", textShadow:"0 1px 3px #000" }}>
              {seen ? `Lu : #${seen}…` : status}
            </p>
          </div>
        )}
        <canvas ref={canvasRef} style={{ display:"none" }}/>

        {error && (
          <p style={{ margin:0, padding:"12px 16px", fontSize:12, color:"#ef4444" }}>⚠ {error}</p>
        )}

        <div style={{ padding:"12px 16px" }}>
          <label style={{ fontSize:11, color:"var(--muted)", display:"block", marginBottom:4 }}>
            …ou saisis le code à la main
          </label>
          <div style={{ display:"flex", gap:8 }}>
            <input value={manual} maxLength={3} placeholder="AB"
              onChange={e => setManual(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submitManual()}
              style={{ flex:1, background:"var(--surface2)", border:"1px solid var(--border)",
                borderRadius:8, padding:"9px 12px", fontSize:14, color:"var(--text)",
                outline:"none", textTransform:"uppercase",
                fontFamily:"JetBrains Mono,monospace", letterSpacing:"0.1em" }}/>
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
