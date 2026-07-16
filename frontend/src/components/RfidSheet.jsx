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
  // "create" = nouvelle bobine ; "map" = completer une bobine existante.
  const [mode, setMode]             = useState("create");
  const [mapSpoolId, setMapSpoolId] = useState(null);

  useEffect(() => {
    client.get(`/rfid/scan/${scanId}`)
      .then(r => {
        setData(r.data);
        // S'il existe des bobines a completer, on preselectionne ce mode : le cas
        // "j'avais deja la bobine, je lui pose enfin son tag" est le plus courant.
        const ms = r.data?.mappable_spools || [];
        if (ms.length > 0) { setMode("map"); setMapSpoolId(ms[0].id); }
      })
      .catch(e => setErr(e.response?.data?.detail || e.message));
  }, [scanId]);

  // En mode "completer", on prerempli les champs avec ce que la bobine a deja,
  // pour ne pas ecraser par du vide et eviter une re-saisie.
  useEffect(() => {
    if (mode !== "map" || !data?.mappable_spools) return;
    const sp = data.mappable_spools.find(s => s.id === mapSpoolId);
    if (!sp) return;
    setSpoolPrice(sp.price_override != null ? String(sp.price_override) : "");
    setLocation(sp.location || "");
  }, [mode, mapSpoolId, data]);

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await client.post(`/rfid/scan/${scanId}/create`, {
        spool_id: mode === "map" ? mapSpoolId : null,
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

          {fil ? (<>
            <p style={{ margin:"0 0 10px", padding:"8px 10px", borderRadius:8, fontSize:12,
              background:"rgba(34,197,94,0.10)", color:"#22c55e" }}>
              Le filament existe déjà (#{fil.id}){data.mappable_spools?.length
                ? " — choisis quoi faire de la bobine :" : " — seule la bobine sera créée."}
            </p>

            {/* Choix : creer une nouvelle bobine, ou completer une bobine existante
                (meme filament, active, sans tag). Ce second cas pose le tag NFC sur
                une bobine qu'on avait deja saisie a la main. */}
            {data.mappable_spools?.length > 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
                {[["map","🔗 Compléter une bobine existante"],
                  ["create","➕ Créer une nouvelle bobine"]].map(([m,label]) => (
                  <button key={m} onClick={() => setMode(m)}
                    style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 12px",
                      borderRadius:10, cursor:"pointer", textAlign:"left", fontSize:13, fontWeight:600,
                      border:`1px solid ${mode===m ? "#3b82f6" : "var(--border)"}`,
                      background: mode===m ? "rgba(59,130,246,0.10)" : "var(--surface2)",
                      color: mode===m ? "#60a5fa" : "var(--text)" }}>
                    <span style={{ width:16, height:16, borderRadius:"50%", flexShrink:0,
                      border:`2px solid ${mode===m ? "#3b82f6" : "var(--muted)"}`,
                      background: mode===m ? "#3b82f6" : "transparent",
                      boxShadow: mode===m ? "inset 0 0 0 2px var(--sheet-bg)" : "none" }}/>
                    {label}
                  </button>
                ))}

                {/* Liste des bobines a completer */}
                {mode === "map" && (
                  <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:2,
                    paddingLeft:4 }}>
                    {data.mappable_spools.map(sp => (
                      <button key={sp.id} onClick={() => setMapSpoolId(sp.id)}
                        style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                          gap:10, padding:"9px 11px", borderRadius:8, cursor:"pointer", fontSize:12,
                          border:`1px solid ${mapSpoolId===sp.id ? "#3b82f6" : "var(--border)"}`,
                          background: mapSpoolId===sp.id ? "rgba(59,130,246,0.12)" : "transparent",
                          color:"var(--text)" }}>
                        <span style={{ fontWeight:700 }}>Bobine #{sp.id}</span>
                        <span style={{ fontSize:11, color:"var(--muted)",
                          fontFamily:"JetBrains Mono,monospace" }}>
                          {sp.remaining_weight_g != null ? `${Math.round(sp.remaining_weight_g)} g` : "—"}
                          {sp.location ? ` · ${sp.location}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>) : (
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
              <label style={lbl}>{mode === "map" ? "Prix de la bobine (€)" : "Prix de cette bobine (€)"}</label>
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
            {busy ? "Enregistrement…"
              : !fil ? "Créer le filament et la bobine"
              : mode === "map" ? `Compléter la bobine #${mapSpoolId ?? ""}`
              : "Créer une nouvelle bobine"}
          </button>
        </>)}
      </div>
    </div>,
    document.body
  );
}
