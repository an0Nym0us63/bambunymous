import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { apiUrl } from "../api/client";
import { currentFriend } from "../store/friend";

// La camera de l'imprimante (22/10/2026). Trois modes :
//  - « stream » : le flux continu du serveur (une image des qu'elle arrive) ;
//  - « images » : une capture toutes les 2 s ;
//  - « auto »   : le flux, et s'il ne demarre pas ou se fige plus de 6 s, les
//                 captures, puis un nouvel essai du flux une minute plus tard.
// Chez un copain, toujours des captures (le relais ne transporte pas de flux).
// Rien ne tourne quand l'appli est en arriere-plan.
const STALL_MS = 6000, RETRY_MS = 60000, PERIOD_MS = 2000;

function readStream(url, onFrame, onEnd) {
  const ctl = new AbortController();
  const token = (() => { try { return localStorage.getItem("token") || ""; } catch { return ""; } })();
  fetch(url, { signal: ctl.signal, headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" })
    .then(async r => {
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      let buf = new Uint8Array(0);
      const dec = new TextDecoder("latin1");
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const nb = new Uint8Array(buf.length + value.length);
        nb.set(buf); nb.set(value, buf.length); buf = nb;
        // « --frame / en-tetes / ligne vide / image » : on decoupe image par image
        for (;;) {
          const head = dec.decode(buf.subarray(0, Math.min(buf.length, 300)));
          const sep = head.indexOf("\r\n\r\n");
          if (sep < 0) break;
          const m = /Content-Length:\s*(\d+)/i.exec(head.slice(0, sep));
          if (!m) { buf = buf.subarray(sep + 4); continue; }
          const n = parseInt(m[1], 10), start = sep + 4;
          if (buf.length < start + n) break;
          onFrame(buf.slice(start, start + n));
          buf = buf.subarray(start + n + 2);
        }
      }
      onEnd(null);
    })
    .catch(e => { if (e.name !== "AbortError") onEnd(e); });
  return () => ctl.abort();
}

// Un clic ouvre la camera en grand (Echap ou un clic pour fermer).
export default function LiveCamera({ mode = "auto", style, maxHeight, expandable = true, fit = "cover", natural = false }) {
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return undefined;
    const k = e => { if (e.key === "Escape") setBig(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [big]);
  const img = useRef(null);
  const friend = currentFriend();
  const [live, setLive] = useState(null);          // "stream" | "images" | null (rien encore)
  const [hidden, setHidden] = useState(document.hidden);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const f = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);

  useEffect(() => {
    if (hidden) return undefined;
    let stop = null, poll = null, stall = null, retry = null, dead = false, lastUrl = null;
    const want = friend ? "images" : mode;
    const show = blob => {
      const u = URL.createObjectURL(new Blob([blob], { type: "image/jpeg" }));
      const el = img.current;
      if (!el) { URL.revokeObjectURL(u); return; }
      const old = lastUrl;
      lastUrl = u;
      el.src = u;
      setBroken(false);
      if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
    };
    const images = () => {
      setLive("images");
      let busy = false;
      const el = img.current;
      const tick = () => {
        if (busy || !img.current) return;
        busy = true;
        const im = new Image();
        im.onload = () => { busy = false; if (!dead && img.current) { img.current.src = im.src; setBroken(false); } };
        im.onerror = () => { busy = false; if (!dead) setBroken(true); };
        im.src = apiUrl(`/camera/snapshot?t=${Date.now()}`);
      };
      tick();
      poll = setInterval(tick, PERIOD_MS);
      if (want === "auto") retry = setTimeout(() => { clearInterval(poll); poll = null; if (!dead) stream(); }, RETRY_MS);
      return el;
    };
    const fallback = () => {
      stop?.(); stop = null; clearTimeout(stall);
      if (dead) return;
      if (want === "stream") { setLive(null); setBroken(true); retry = setTimeout(() => !dead && stream(), 15000); }
      else images();
    };
    const arm = () => { clearTimeout(stall); stall = setTimeout(fallback, STALL_MS); };
    const stream = () => {
      setLive("stream");
      arm();
      stop = readStream("/api/v1/camera/stream", f => { arm(); show(f); }, () => !dead && fallback());
    };
    if (want === "images") images(); else stream();
    return () => {
      dead = true;
      stop?.(); clearInterval(poll); clearTimeout(stall); clearTimeout(retry);
      if (lastUrl) setTimeout(() => URL.revokeObjectURL(lastUrl), 1000);
    };
  }, [mode, hidden, friend?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: "relative", cursor: expandable ? "zoom-in" : undefined, ...style }}
      onClick={expandable ? e => { e.stopPropagation(); setBig(true); } : undefined}>
      {/* natural (en grand) : l'image a ses vraies proportions, sans bandes noires autour */}
      <img ref={img} data-pk="" alt="Caméra de l'imprimante" style={natural
        ? { display: broken ? "none" : "block", width: "auto", height: "auto", maxWidth: "100%", maxHeight: "74vh", borderRadius: "inherit" }
        : { width: "100%", display: broken ? "none" : "block", aspectRatio: style?.height ? undefined : "16/9", height: style?.height,
          objectFit: fit, background: "#111", maxHeight, borderRadius: "inherit" }}/>
      {broken && <div style={{ padding: "26px 12px", textAlign: "center", fontSize: 12.5, color: "var(--muted)", background: "var(--surface2)",
        borderRadius: "inherit" }}>Caméra injoignable pour l'instant</div>}
      {/* un voyant discret quand c'est le flux continu ; rien pour les captures */}
      {live === "stream" && !broken && <span title="En direct" style={{ position: "absolute", left: 8, top: 8, width: 6, height: 6, borderRadius: "50%",
        background: "#ef4444", boxShadow: "0 0 0 2px rgba(0,0,0,0.25)", opacity: 0.85, animation: "livePulse 2s infinite" }}/>}
      {/* en grand : un en-tete (camera, en direct ou captures, fermer), l'image a ses proportions sur un fond sombre */}
      {big && createPortal(
        <div data-no-pull="" onClick={e => { e.stopPropagation(); setBig(false); }} style={{ position: "fixed", inset: 0, zIndex: 6000,
          background: "radial-gradient(120% 80% at 50% 35%, rgba(30,41,59,0.92), rgba(2,6,23,0.98))", backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)", display: "flex", flexDirection: "column", cursor: "zoom-out", animation: "bn-fade .18s ease-out" }}>
          <div onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "default",
            padding: "calc(12px + env(safe-area-inset-top,0px)) 14px 10px" }}>
            <span style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19,
              background: "linear-gradient(135deg, #3B82F6, #6366F1)", boxShadow: "0 8px 20px -8px #3B82F6" }}>📷</span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ color: "#fff", fontSize: 16, fontWeight: 900 }}>Caméra</span>
              <span style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 9px", borderRadius: 20,
                fontSize: 11, fontWeight: 900, letterSpacing: ".04em", color: "#fff",
                background: live === "stream" ? "rgba(239,68,68,0.28)" : "rgba(255,255,255,0.14)",
                border: `1px solid ${live === "stream" ? "rgba(239,68,68,0.55)" : "rgba(255,255,255,0.22)"}` }}>
                {live === "stream" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "livePulse 2s infinite" }}/>}
                {live === "stream" ? "EN DIRECT" : "CAPTURES"}</span>
            </span>
            <button aria-label="Fermer" onClick={() => setBig(false)} style={{ width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
              border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.12)", backdropFilter: "blur(10px)", color: "#fff",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <X size={19}/></button>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center",
            padding: "6px 14px calc(18px + env(safe-area-inset-bottom,0px))" }}>
            <LiveCamera mode={mode} expandable={false} natural
              style={{ borderRadius: 18, overflow: "hidden", maxWidth: "min(100%, 1400px)", boxShadow: "0 24px 60px rgba(0,0,0,0.6)", cursor: "default" }}/>
          </div>
        </div>, document.body)}
    </div>
  );
}
