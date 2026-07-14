import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import { colorBg, parseColorsList } from "../utils/colors";

/**
 * Bobine scannée mais inconnue : création guidée.
 *
 * Le tag NFC porte assez d'informations (material_id + material_variant_id) pour
 * retrouver la référence EXACTE dans le catalogue Bambu. Il ne reste donc à
 * saisir que ce que le tag ne peut pas savoir : les prix.
 *
 * - prix de la bobine : toujours demandé (il varie d'un achat à l'autre) ;
 * - prix du filament : uniquement si le filament doit être créé.
 */
export default function RfidSheet({ scanId, onClose, onCreated }) {
  const [data, setData]   = useState(null);
  const [err, setErr]     = useState(null);
  const [busy, setBusy]   = useState(false);

  const [spoolPrice, setSpoolPrice] = useState("");
  const [filPrice, setFilPrice]     = useState("");
  const [location, setLocation]     = useState("");

  useEffect(() => {
    client.get(`/rfid/scan/${scanId}`)
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.detail || e.message));
  }, [scanId]);

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await client.post(`/rfid/scan/${scanId}/create`, {
        spool_price: spoolPrice === "" ? null : Number(spoolPrice),
        filament_price: filPrice === "" ? null : Number(filPrice),
        location: location || null,
      });
      onCreated?.(r.data);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
      setBusy(false);
    }
  };

  const cat  = data?.catalog;
  const fil  = data?.filament;
  const scan = data?.scan;

  // Couleurs : celles du catalogue si on l'a trouvé, sinon celle du tag.
  const cols = parseColorsList(
    cat?.color_hex || scan?.color_hex,
    cat?.colors?.length > 1 ? cat.colors.map(c => "#" + c.slice(0, 6)).join(",") : null,
  );

  const inp = { width:"100%", boxSizing:"border-box", padding:"9px 12px", borderRadius:8,
    border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)",
    fontSize:14, outline:"none", fontFamily:"JetBrains Mono, monospace" };
  const lbl = { display:"block", fontSize:11, color:"var(--muted)", marginBottom:4 };

  return createPortal(
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4000,
      background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"flex-end",
      justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:520,
        maxHeight:"92vh", overflowY:"auto", background:"var(--sheet-bg)",
        borderRadius:"20px 20px 0 0", padding:"20px 16px 28px" }}>

        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          <p style={{ margin:0, flex:1, fontSize:15, fontWeight:800, color:"var(--text)" }}>
            📡 Bobine inconnue
          </p>
          <button onClick={onClose} style={{ background:"none", border:"none",
            color:"var(--muted)", fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        {err && (
          <p style={{ margin:"0 0 12px", padding:"8px 10px", borderRadius:8, fontSize:12,
            background:"rgba(239,68,68,0.1)", color:"#ef4444" }}>⚠ {err}</p>
        )}

        {!data ? (
          <p style={{ fontSize:12, color:"var(--muted)" }}>Lecture du tag…</p>
        ) : (<>
          {/* Identité de la bobine */}
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px",
            borderRadius:12, background:"var(--surface2)", marginBottom:14 }}>
            <div style={{ width:44, height:44, borderRadius:10, flexShrink:0,
              position:"relative", overflow:"hidden",
              boxShadow:"inset 0 0 0 1px rgba(128,128,128,0.3)" }}>
              <div style={{ position:"absolute", inset:0,
                ...colorBg(cols, cat?.multicolor_type) }}/>
            </div>
            <div style={{ minWidth:0, flex:1 }}>
              <p style={{ margin:0, fontSize:14, fontWeight:700, color:"var(--text)" }}>
                {cat?.name || scan?.fila_type || "Filament inconnu"}
              </p>
              <p style={{ margin:"2px 0 0", fontSize:11, color:"var(--muted)" }}>
                {[cat ? "Bambu Lab" : null, cat?.fila_type || scan?.fila_type]
                  .filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          {/* D'où viennent les infos : sans ça, on ne sait pas si l'app a reconnu
              la référence ou si elle improvise. */}
          <p style={{ margin:"0 0 14px", fontSize:11, color:"var(--muted)", lineHeight:1.5 }}>
            {cat
              ? <>Référence reconnue dans le catalogue Bambu ({cat.fila_id} · {cat.fila_color_code}).</>
              : <>⚠ Référence absente du catalogue. Le filament sera créé avec les
                 seules informations du tag ({scan?.material_id}).</>}
            <br/>
            Tag&nbsp;: <span style={{ fontFamily:"JetBrains Mono,monospace" }}>
              {data.tray_uid?.slice(0, 12)}…
            </span>
          </p>

          {fil ? (
            <p style={{ margin:"0 0 14px", padding:"8px 10px", borderRadius:8, fontSize:12,
              background:"rgba(34,197,94,0.10)", color:"#22c55e" }}>
              Le filament existe déjà (#{fil.id}) — seule la bobine sera créée.
            </p>
          ) : (
            <p style={{ margin:"0 0 14px", padding:"8px 10px", borderRadius:8, fontSize:12,
              background:"rgba(59,130,246,0.10)", color:"#60a5fa" }}>
              Le filament sera créé, puis la bobine.
            </p>
          )}

          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {/* Le prix du filament n'est demandé que pour une NOUVELLE référence :
                sur un filament déjà connu, il est déjà renseigné. */}
            {data.needs_filament_price && (
              <div>
                <label style={lbl}>Prix du filament (€ / kg) — nouvelle référence</label>
                <input value={filPrice} inputMode="decimal" placeholder="24.99"
                  onChange={e => setFilPrice(e.target.value)} style={inp}/>
              </div>
            )}

            <div>
              <label style={lbl}>Prix de cette bobine (€)</label>
              <input value={spoolPrice} inputMode="decimal" placeholder="21.90" autoFocus
                onChange={e => setSpoolPrice(e.target.value)} style={inp}/>
            </div>

            <div>
              <label style={lbl}>Emplacement (optionnel)</label>
              <input value={location} placeholder="Étagère A"
                onChange={e => setLocation(e.target.value)}
                style={{ ...inp, fontFamily:"inherit" }}/>
            </div>
          </div>

          <button onClick={create} disabled={busy}
            style={{ width:"100%", marginTop:18, padding:"13px", borderRadius:12,
              border:"none", cursor: busy ? "default" : "pointer",
              background:"#3b82f6", color:"white", fontSize:14, fontWeight:800 }}>
            {busy ? "Création…"
              : fil ? "Créer la bobine" : "Créer le filament et la bobine"}
          </button>
        </>)}
      </div>
    </div>,
    document.body
  );
}
