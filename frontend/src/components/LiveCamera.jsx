import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { apiUrl } from "../api/client";
import { useFriend } from "../store/friend";

// La camera de l'imprimante (22/10/2026). En cascade (02/11/2026) :
//  1. le flux continu (MJPEG) : chez soi, le plus fluide et le plus leger ;
//  2. le direct tire image par image : chez un copain (le relais ne transporte pas de flux), ou quand le flux coince
//     (il ne demarre pas, se fige, ou ralentit : plus de 2,5 s entre deux images). La page demande l'image suivante
//     des qu'elle a recu la precedente : la cadence suit la liaison, sans retard qui s'accumule ;
//  3. en dernier recours, une capture toutes les 2 s.
// Depuis le 2 ou le 3, on retente le 1 (ou le 2 chez un copain) 10 s plus tard, puis 20, 40, et au plus une minute.
// Les modes de la tuile : « auto » (la cascade), « stream » (le direct seulement : 1 puis 2), « images » (le 3).
// Rien ne tourne quand l'appli est en arriere-plan.
const STALL_MS = 6000, SLOW_MS = 2500, RETRY_MS = 60000, RETRY_FIRST_MS = 10000, PERIOD_MS = 2000;
// le delai avant de retenter le mieux, partage par toutes les cameras de la page : il double a chaque echec, et revient
// au plus court des que le flux redonne des images
let retryMs = RETRY_FIRST_MS;

const token = () => { try { return localStorage.getItem("token") || ""; } catch { return ""; } };

function readStream(url, onFrame, onEnd) {
  const ctl = new AbortController();
  const t = token();
  fetch(url, { signal: ctl.signal, headers: t ? { Authorization: `Bearer ${t}` } : {}, cache: "no-store" })
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
  // suivi (02/11/2026) : au retour de chez un copain, la camera repart sur ton direct (lue une fois, elle pouvait garder
  // le reglage du copain)
  const friend = useFriend(s => s.friend);
  const [live, setLive] = useState(null);          // "stream" | "images" | null (rien encore)
  const [hidden, setHidden] = useState(document.hidden);
  const [broken, setBroken] = useState(false);
  // une premiere vue est arrivee : avant, l'image vide montrait l'icone d'image cassee sur fond noir (02/11/2026)
  const [ready, setReady] = useState(false);
  // en grand, la cadence reellement recue (02/11/2026) : « EN DIRECT · 7 img/s », pour savoir d'ou vient une saccade
  const shown = useRef(0);
  const [fps, setFps] = useState(null);
  useEffect(() => {
    if (!big) return undefined;
    let last = shown.current, at = Date.now();
    const t = setInterval(() => { const now = Date.now(); setFps((shown.current - last) * 1000 / (now - at)); last = shown.current; at = now; }, 2000);
    return () => { clearInterval(t); setFps(null); };
  }, [big]);
  useEffect(() => {
    const f = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);

  useEffect(() => {
    if (hidden) return undefined;
    let stop = null, poll = null, retry = null, dead = false, lastUrl = null;
    const want = mode;
    const show = blob => {
      const u = URL.createObjectURL(new Blob([blob], { type: "image/jpeg" }));
      const el = img.current;
      if (!el) { URL.revokeObjectURL(u); return; }
      const old = lastUrl;
      lastUrl = u;
      el.src = u;
      shown.current++;
      setBroken(false); setReady(true);
      if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
    };
    const top = () => (friend ? pull : flow);       // le mieux possible ici
    const again = () => {                            // depuis un mode de secours : retenter le mieux plus tard
      if (want !== "auto" && want !== "stream") return;
      clearTimeout(retry);                           // un seul essai en attente (le tirage puis les captures en posaient deux)
      retry = setTimeout(() => { clearInterval(poll); poll = null; stop?.(); stop = null; if (!dead) top()(); }, retryMs);
      retryMs = Math.min(RETRY_MS, retryMs * 2);
    };
    const images = () => {
      setLive("images");
      let busy = false;
      const tick = () => {
        if (busy || !img.current) return;
        busy = true;
        const im = new Image();
        im.onload = () => { busy = false; if (!dead && img.current) { img.current.src = im.src; shown.current++; setBroken(false); setReady(true); } };
        im.onerror = () => { busy = false; if (!dead) setBroken(true); };
        // fresh : une image recente ou rien (03/11/2026 : l'ancienne image s'affichait un moment avant « injoignable »)
        im.src = apiUrl(`/camera/snapshot?fresh=1&t=${Date.now()}`);
      };
      tick();
      poll = setInterval(tick, PERIOD_MS);
      again();
    };
    const viewer = Math.random().toString(36).slice(2, 10);       // pour compter les spectateurs (travaux)
    // 2. le direct tire image par image ; en echec : les captures (ou, en mode « stream », « injoignable »)
    const pull = () => {
      setLive("pull");
      let seq = 0, empty = 0;
      const down = () => {
        stop = null;
        if (dead) return;
        if (want === "stream") { setLive(null); setBroken(true); again(); }
        else images();
      };
      (async () => {
        while (!dead) {
          const ctl = new AbortController();
          stop = () => ctl.abort();
          try {
            const t = token();
            const r = await fetch(apiUrl(`/camera/frame?after=${seq}&v=${viewer}&t=${Date.now()}`),
              { signal: ctl.signal, cache: "no-store", headers: t ? { Authorization: `Bearer ${t}` } : {} });
            if (dead) return;
            // rien en 4 s, deux fois : la camera s'est tue ; une erreur, ou un copain pas a jour (404)
            if (r.status === 204) { if (++empty >= 2) return down(); continue; }
            if (!r.ok) return down();
            const b = await r.arrayBuffer();
            if (dead) return;
            const n = parseInt(r.headers.get("X-Seq") || "", 10);
            empty = 0;
            show(b);
            if (Number.isFinite(n)) seq = n;
            else await new Promise(ok => setTimeout(ok, 250));    // sans numero, on redemanderait la meme : on patiente
          } catch (e) {
            if (dead || e.name === "AbortError") return;
            return down();
          }
        }
      })();
      if (!friend) again();                          // chez soi, le flux continu est retente
    };
    // 1. le flux continu ; s'il ne demarre pas, se fige ou ralentit : le tirage
    const flow = () => {
      setLive("stream");
      let last = 0, stall = null, watch = null;
      const end = () => {
        clearTimeout(stall); clearInterval(watch);
        stop?.(); stop = null;
        if (!dead) pull();
      };
      const arm = () => { clearTimeout(stall); stall = setTimeout(end, STALL_MS); };
      arm();
      watch = setInterval(() => { if (last && Date.now() - last > SLOW_MS) end(); }, 500);
      const cut = readStream("/api/v1/camera/stream", f => {
        last = Date.now();
        arm(); retryMs = RETRY_FIRST_MS; show(f);
      }, () => !dead && end());
      stop = () => { clearTimeout(stall); clearInterval(watch); cut(); };
    };
    if (want === "images") images(); else top()();
    return () => {
      dead = true;
      stop?.(); clearInterval(poll); clearTimeout(retry);
      if (lastUrl) setTimeout(() => URL.revokeObjectURL(lastUrl), 1000);
    };
  }, [mode, hidden, friend?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: "relative", cursor: expandable ? "zoom-in" : undefined, ...style }}
      onClick={expandable ? e => { e.stopPropagation(); setBig(true); } : undefined}>
      {/* natural (en grand) : l'image a ses vraies proportions, sans bandes noires autour */}
      {/* rien d'affiche tant qu'aucune vue n'est arrivee (ni icone cassee ni noir) : un fond doux qui patiente a la place */}
      <img ref={img} data-pk="" alt="" style={natural
        ? { display: broken || !ready ? "none" : "block", width: "auto", height: "auto", maxWidth: "100%", maxHeight: "74vh", borderRadius: "inherit" }
        : { width: "100%", display: "block", visibility: ready && !broken ? "visible" : "hidden", aspectRatio: style?.height ? undefined : "16/9",
          height: style?.height, objectFit: fit, background: ready ? "#111" : "transparent", maxHeight, borderRadius: "inherit" }}/>
      {!ready && !broken && <div aria-label="Connexion à la caméra" style={{ ...(natural ? { width: "min(90vw, 720px)", aspectRatio: "16/9" } : { position: "absolute", inset: 0 }),
        borderRadius: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--muted)",
        backgroundColor: "var(--surface2)", backgroundImage: "linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--text) 7%, transparent) 50%, transparent 70%)",
        backgroundSize: "60% 100%", backgroundRepeat: "no-repeat", animation: "bn-tile-sweep 1.6s ease-in-out infinite" }}>📷 Connexion à la caméra…</div>}
      {broken && <div style={{ ...(natural ? { padding: "26px 12px" } : { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }),
        textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "var(--muted)", background: "var(--surface2)", borderRadius: "inherit" }}>📷 Caméra injoignable pour l'instant</div>}
      {/* un voyant discret quand c'est le flux continu ; rien pour les captures */}
      {(live === "stream" || live === "pull") && !broken && <span data-tip="En direct" style={{ position: "absolute", left: 8, top: 8, width: 6, height: 6, borderRadius: "50%",
        background: "#ef4444", boxShadow: "0 0 0 2px rgba(0,0,0,0.25)", opacity: 0.85, animation: "livePulse 2s infinite" }}/>}
      {/* en secours sur les captures (le flux s'est fige) : on le voit, et le direct est retente tout seul */}
      {live === "images" && mode !== "images" && !broken && <span data-tip="Le direct ne passe pas : une image toutes les 2 s, le direct est retenté tout seul"
        style={{ position: "absolute", left: 6, top: 6, padding: "1px 6px", borderRadius: 8, fontSize: 9.5, fontWeight: 800, color: "#fff",
          background: "rgba(15,23,42,0.55)", letterSpacing: ".03em", pointerEvents: "auto" }}>captures</span>}
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
                background: live !== "images" ? "rgba(239,68,68,0.28)" : "rgba(255,255,255,0.14)",
                border: `1px solid ${live !== "images" ? "rgba(239,68,68,0.55)" : "rgba(255,255,255,0.22)"}` }}>
                {live !== "images" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "livePulse 2s infinite" }}/>}
                {live === "stream" ? "EN DIRECT" : live === "pull" ? "EN DIRECT · IMAGES" : "CAPTURES"}
                {fps != null && <span style={{ fontWeight: 700, opacity: .8, letterSpacing: 0 }}>· {fps >= 1 ? `${Math.round(fps)} img/s` : fps > 0 ? `1 img / ${Math.round(1 / fps)} s` : "aucune image"}</span>}</span>
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
