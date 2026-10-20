import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { pushApi } from "./PushBridge";

// Parametres > Appli Android : telecharger ou mettre a jour l'appli (servie
// par BambuNymous lui-meme), et, dans l'appli, ses propres reglages (adresse
// de BambuNymous, jeton RFID). Elle sert aux notifications, au scan RFID, a
// l'appareil photo : rien de propre aux notifications.
export default function AndroidApp({ card, cardTitle }) {
  const [native, setNative] = useState(null);
  useEffect(() => {
    try { if (window.BambuScan?.getConfig) setNative(JSON.parse(window.BambuScan.getConfig())); } catch { /* navigateur */ }
  }, []);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <DownloadApp/>
      {window.BambuScan && (
        <div className="card" style={card}>
          <div style={cardTitle}>Réglages de l'appli</div>
          <p style={{ fontSize:12.5, color:"var(--muted)", margin:"0 0 12px", lineHeight:1.5 }}>
            L'adresse de BambuNymous et le jeton RFID sont gardés par l'appli Android. Tu peux les modifier ici.
          </p>
          {native?.url && (
            <p style={{ fontSize:12, color:"var(--text2)", margin:"0 0 12px",
              fontFamily:"JetBrains Mono, monospace", wordBreak:"break-all" }}>
              {native.url}<br/>
              Jeton RFID : {native.hasToken ? "défini ✓" : "non défini"}
              {native.versionName ? <><br/>Version installée : {native.versionName}</> : null}
            </p>
          )}
          <button type="button" onClick={() => { try { window.BambuScan.openSettings(); } catch { /* ancien shell */ } }}
            style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 16px", borderRadius:12, border:"none",
              cursor:"pointer", background:"linear-gradient(135deg,#4f46e5,#6366f1)", color:"#fff", fontSize:13, fontWeight:700 }}>
            ⚙️ Ouvrir les réglages de l'appli
          </button>
        </div>
      )}
    </div>
  );
}

// L'appli Android, servie par BambuNymous lui-meme (frontend/public/android) :
// version, date et taille lues dans version.json, publie avec l'APK.
export function DownloadApp() {
  const [v, setV] = useState(null);
  useEffect(() => {
    fetch("/android/version.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).then(setV).catch(() => {});
  }, []);
  if (!v) return null;
  const inApp = !!pushApi();
  // version installee (l'appli la donne depuis le 20/10/2026 ; avant : ancienne)
  let mine = null;
  try { mine = JSON.parse(window.BambuScan?.getConfig?.() || "{}").versionCode ?? null; } catch { /* navigateur */ }
  const upToDate = inApp && mine != null && v.code != null && Number(mine) >= Number(v.code);
  const mo = (v.size / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  const date = v.date ? new Date(v.date).toLocaleDateString("fr-FR", { day:"numeric", month:"short", year:"numeric" }) : "";
  return (
    <div className="card" style={{ padding:"14px 18px", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
      <img src="/icon-192.png" alt="" style={{ width:44, height:44, borderRadius:11, flexShrink:0 }}/>
      <div style={{ flex:1, minWidth:160 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"var(--text)" }}>Appli Android BambuNymous</div>
        <div style={{ fontSize:11.5, color:"var(--muted)", marginTop:2 }}>
          Version {v.version}{date ? ` · ${date}` : ""} · {mo} Mo
          {!inApp ? " · notifications, scan RFID, appareil photo" : null}</div>
        {inApp && (
          <div style={{ fontSize:11.5, fontWeight:700, marginTop:3, color: upToDate ? "#22c55e" : "#f59e0b" }}>
            {upToDate ? "✓ Ton appli est à jour" : "Une mise à jour est disponible"}</div>
        )}
      </div>
      <a href="/android/BambuNymous.apk" download="BambuNymous.apk"
        style={{ display:"inline-flex", alignItems:"center", gap:7, padding:"8px 14px", borderRadius:10, fontSize:12.5,
          fontWeight:700, textDecoration:"none", flexShrink:0,
          ...(upToDate ? { background:"var(--surface2)", color:"var(--text2)", border:"1px solid var(--border)" }
            : { background:"#4F46E5", color:"white" }) }}>
        <Download size={15} strokeWidth={2.4}/> {!inApp ? "Télécharger" : upToDate ? "Réinstaller" : "Mettre à jour"}</a>
    </div>
  );
}

