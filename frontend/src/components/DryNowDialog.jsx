import React, { useEffect, useState } from "react";
import { useTrackDetail } from "../utils/track";
import { createPortal } from "react-dom";
import { Sun } from "lucide-react";
import client from "../api/client";
import { usePrinter } from "../store/printer";
import { amsName, slotLabel, isExternal, grilleAccueil, lireDisposition, columnWeight, slotCount } from "../utils/ams";
import { colorBg } from "../utils/colors";
import { showAlert } from "../utils/dialog";

// « Sechee aujourd'hui » : date la bobine, et dit OU elle seche. Par defaut
// « Ailleurs » (four, dessiccateur...) ; sinon un emplacement AMS VIDE ou elle
// est simplement posee : l'AMS la fait tourner sans la voir, l'appli retient
// l'emplacement tant qu'il reste vide pour montrer ce qui seche.
export default function DryNowDialog({ spoolId, spoolName, onClose, onDone }) {
  useTrackDetail("Séchage · Lancer un séchage");
  const status = usePrinter(s => s.status);
  const [where, setWhere] = useState("");          // "" = ailleurs, sinon "ams:tray"
  const [busy, setBusy] = useState(false);
  // Meme disposition des AMS que l'accueil (Parametres > ordre des AMS).
  const [order, setOrder] = useState(null);
  useEffect(() => {
    client.get("/settings/ams-order").then(({ data }) => setOrder(data.order ?? null)).catch(() => {});
  }, []);

  // Memes AMS que l'accueil (le support externe ne seche pas) ; seuls les
  // emplacements VIDES se choisissent.
  const units = (status?.ams_list || []).filter(a => !isExternal(a.id) && (a.trays || []).length);
  const hex = (c) => { const h = String(c || "").replace("#", "").slice(0, 6); return h.length === 6 ? `#${h}` : null; };
  // Toutes les couleurs (bobine multicolore) : colors_array de la fiche, ou
  // cols du MQTT pour un filament insere ; sinon la couleur simple.
  const colorsOf = (list, single) => {
    const arr = (Array.isArray(list) ? list : String(list || "").split(",")).map(hex).filter(Boolean);
    return arr.length ? arr : [hex(single)].filter(Boolean);
  };
  const sel = (() => {
    if (!where) return null;
    const [a, t] = where.split(":").map(Number);
    const tray = units.find(u => u.id === a)?.trays.find(x => x.id === t);
    const occ = tray?.drying_spool && tray.drying_spool.id !== spoolId ? (tray.drying_spool.translated_name || tray.drying_spool.name) : null;
    return { label: `${amsName(a)} · ${slotLabel(a, t)}`, occ };
  })();

  const confirm = async () => {
    setBusy(true);
    try {
      await client.patch(`/filaments/spools/${spoolId}`,
        { last_dried_at: new Date().toISOString() });   // maintenant (UTC, avec son Z)
      if (where) {
        const [a, t] = where.split(":");
        await client.put(`/printer/ams/${a}/${t}/drying`, { spool_id: spoolId });
        usePrinter.getState().fetch?.();
      }
      onDone?.();
    } catch (e) {
      showAlert(e.response?.data?.detail || e.message);
      setBusy(false);
    }
  };

  const opt = (key, label, sub) => {
    const on = where === key;
    return (
      <button key={key || "ailleurs"} onClick={() => setWhere(key)}
        style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"11px 12px", marginBottom:6,
          borderRadius:14, cursor:"pointer", textAlign:"left", color:"var(--text)",
          background: on ? "linear-gradient(135deg, rgba(245,158,11,0.16), transparent 70%), var(--surface2)" : "var(--surface2)",
          border: on ? "1.5px solid #f59e0b" : "1px solid var(--border)" }}>
        <span style={{ width:14, height:14, borderRadius:"50%", flexShrink:0,
          border: on ? "4px solid #f59e0b" : "1.5px solid var(--muted)" }}/>
        <span style={{ flex:1, minWidth:0 }}>
          <span style={{ fontSize:13.5, fontWeight:800 }}>{label}</span>
          {sub && <span style={{ display:"block", fontSize:10.5, color:"var(--muted)" }}>{sub}</span>}
        </span>
      </button>
    );
  };

  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position:"fixed", inset:0, zIndex:4500, background:"rgba(0,0,0,0.6)",
      display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--sheet-bg)", borderRadius:"22px 22px 0 0",
        width:"100%", maxWidth:460, maxHeight:"85dvh", overflowY:"auto", padding:"0 16px",
        paddingBottom:"calc(16px + env(safe-area-inset-bottom,0px))" }}>
        {/* en-tete : le soleil, la bobine */}
        <div style={{ display:"flex", alignItems:"center", gap:10, margin:"0 -16px 12px", padding:"16px 16px 12px",
          background:"linear-gradient(135deg, rgba(245,158,11,0.24), transparent 70%)" }}>
          <span style={{ width:38, height:38, borderRadius:12, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
            background:"linear-gradient(135deg, #F59E0B, #FBBF24)", boxShadow:"0 6px 16px -6px #F59E0B" }}><Sun size={19} color="#fff"/></span>
          <span style={{ minWidth:0 }}>
            <span style={{ display:"block", fontSize:16, fontWeight:900, color:"var(--text)" }}>Séchée aujourd'hui</span>
            <span style={{ display:"block", fontSize:12, fontWeight:700, color:"var(--muted)" }}>
              {spoolName ? `${spoolName} · ` : ""}Où sèche-t-elle ?</span>
          </span>
        </div>
        {opt("", "Ailleurs", "four, dessiccateur… — la date suffit")}
        {units.length > 0 && (<>
          <p style={{ fontSize:10.5, fontWeight:700, color:"var(--muted)", textTransform:"uppercase",
            letterSpacing:0.4, margin:"10px 0 6px" }}>Ou posée dans un AMS — touche un emplacement vide</p>
          {(() => { const cols = grilleAccueil(units, lireDisposition(order)); return (
          <div style={{ display:"grid", gap:8,
            gridTemplateColumns: cols.map(c => `minmax(0, ${columnWeight(c)}fr)`).join(" ") }}>
            {cols.flatMap((col, ci) => col.map((a, ri) => a && (
              <div key={a.id} style={{ gridColumn: ci + 1, gridRow: ri + 1, minWidth:0,
                padding:"8px 6px 9px", borderRadius:14, background:"var(--surface2)",
                border:"1px solid var(--border)" }}>
                <div style={{ fontSize:10.5, fontWeight:800, color:"var(--muted)", textAlign:"center",
                  letterSpacing:0.5, marginBottom:6 }}>{amsName(a.id)}</div>
                <div style={{ display:"flex", gap:4, margin:"0 auto",
                  width: `${(slotCount(a) / columnWeight(col)) * 100}%` }}>
                  {a.trays.map(t => {
                    const empty = t.empty || !t.filament_type;
                    const key = `${a.id}:${t.id}`;
                    const on = where === key;
                    const posee = empty ? t.drying_spool : null;
                    const cols = posee ? colorsOf(posee.colors_array, posee.color)
                      : empty ? [] : colorsOf(t.cols, t.color);
                    const bg = empty && !posee
                      ? { background:"repeating-linear-gradient(-45deg, rgba(148,163,184,0.22) 0px, rgba(148,163,184,0.22) 2px, transparent 2px, transparent 6px)" }
                      : colorBg(cols, posee ? posee.multicolor_type : null);
                    return (
                      <button key={t.id} disabled={!empty} onClick={() => setWhere(on ? "" : key)}
                        title={empty ? (posee ? `${slotLabel(a.id, t.id)} — posée : ${posee.translated_name || posee.name}`
                          : `${slotLabel(a.id, t.id)} — vide`) : `${slotLabel(a.id, t.id)} — occupé`}
                        style={{ flex:1, height:34, borderRadius:7, position:"relative", padding:0,
                          cursor: empty ? "pointer" : "not-allowed", opacity: empty ? 1 : 0.3,
                          border: on ? "2px solid #f59e0b" : empty ? "1.5px dashed rgba(148,163,184,0.7)" : "1px solid rgba(0,0,0,0.15)",
                          boxShadow: on ? "0 0 0 3px rgba(245,158,11,0.3)" : "none", ...bg }}>
                        {posee && <span style={{ position:"absolute", inset:0, borderRadius:6, pointerEvents:"none",
                          background:"repeating-linear-gradient(-45deg, rgba(255,255,255,0.38) 0px, rgba(255,255,255,0.38) 2px, transparent 2px, transparent 6px)" }}/>}
                        <span style={{ position:"absolute", left:0, right:0, bottom:1, fontSize:8.5, fontWeight:800,
                          color: on ? "#f59e0b" : "var(--muted)", textShadow:"0 0 2px var(--surface2)" }}>
                          {slotLabel(a.id, t.id)}
                        </span>
                        {(on || posee) && (
                          <Sun size={12} color="#f59e0b" strokeWidth={2.8}
                            style={{ position:"absolute", top:3, left:"50%", transform:"translateX(-50%)",
                              filter:"drop-shadow(0 0 1px rgba(0,0,0,0.6))" }}/>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )))}
          </div>
          ); })()}
          {sel && (
            <p style={{ fontSize:12, color:"#f59e0b", fontWeight:700, margin:"10px 0 0" }}>
              ☀ Posée en {sel.label}{sel.occ ? ` (remplace ${sel.occ})` : ""}
            </p>
          )}
        </>)}
        <div style={{ display:"flex", gap:8, marginTop:12 }}>
          <button onClick={onClose} style={{ flex:1, padding:10, borderRadius:12, border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--text)", fontSize:13, fontWeight:700, cursor:"pointer" }}>Annuler</button>
          <button onClick={confirm} disabled={busy} style={{ flex:2, padding:11, borderRadius:12, border:"none",
            background:"linear-gradient(135deg, #F59E0B, #F97316)", color:"white", fontSize:13.5, fontWeight:800, cursor:"pointer", opacity: busy ? 0.6 : 1,
            boxShadow:"0 8px 18px -10px #F59E0B" }}>
            {busy ? "…" : "☀ Séchée"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
