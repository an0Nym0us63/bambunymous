import React, { useState, useEffect, useMemo } from "react";
import client from "../api/client";
import { showAlert, showConfirm } from "../utils/dialog";
import { colorBg, parseColorsList } from "../utils/colors";
import { moneyVal } from "../utils/money";

/**
 * Revision des prix : tarif catalogue d'un filament face au prix d'achat de
 * chacune de ses bobines, archivees comprises.
 *
 * L'objet est de REPERER puis CORRIGER sur place. D'ou trois filtres qui
 * repondent chacun a une question concrete plutot qu'a une categorie :
 *   - Sans prix : ce qui fausse tous les couts, puisque le calcul retombe
 *     alors sur 20 EUR/kg par defaut ;
 *   - Ecarts : une bobine payee tres loin du tarif catalogue -- soit une bonne
 *     affaire, soit une faute de saisie, et seul l'oeil peut trancher ;
 *   - Tout.
 *
 * Les archivees sont incluses volontairement : elles portent l'historique
 * d'achat, donc la reference pour juger si un tarif est encore juste.
 */

const ECART = 0.25;   // 25% d'ecart relatif avant de signaler

// null = jamais renseigne, 0 = renseigne a zero (offert, echantillon). Cette
// vue cherche les MANQUANTS, pas les nuls : les confondre remplirait la liste
// de faux positifs.
const missing = (v) => v === null || v === undefined;

function flagsFor(f) {
  const noCat = missing(f.price);
  const noSpool = f.spools.some(s => missing(s.price));
  const gap = !noCat && f.price > 0 && f.spools.some(s =>
    !missing(s.price) && Math.abs(s.price - f.price) / f.price > ECART);
  return { noCat, noSpool, gap };
}

function PriceCell({ value, onSave, muted }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  const start = () => { setVal(missing(value) ? "" : String(value)); setEditing(true); };
  const save = async () => {
    const t = val.trim();
    // Champ vide = effacer le prix, et non zero : ce sont deux etats
    // differents, c'est tout l'enjeu de cette vue.
    const n = t === "" ? null : parseFloat(t.replace(",", "."));
    if (t !== "" && (isNaN(n) || n < 0)) return;
    setBusy(true);
    try { await onSave(n); setEditing(false); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  if (editing) {
    return (
      <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
        <input value={val} autoFocus type="number" step="0.01" inputMode="decimal"
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          style={{ width:64, padding:"3px 6px", borderRadius:6, fontSize:12,
            border:"1px solid #3b82f6", background:"var(--surface)", color:"var(--text)",
            outline:"none", textAlign:"right" }}/>
        <button onClick={save} disabled={busy}
          style={{ border:"none", background:"#22c55e", color:"white", borderRadius:6,
            width:24, height:24, cursor:"pointer", fontSize:12 }}>✓</button>
        <button onClick={() => setEditing(false)}
          style={{ border:"1px solid var(--border)", background:"none", color:"var(--muted)",
            borderRadius:6, width:24, height:24, cursor:"pointer", fontSize:12 }}>✕</button>
      </span>
    );
  }
  return (
    <button onClick={start}
      style={{ border:"1px dashed transparent", background:"none", cursor:"pointer",
        padding:"2px 6px", borderRadius:6, fontSize:12.5, fontWeight:700,
        fontFamily:"'JetBrains Mono',ui-monospace,monospace",
        color: missing(value) ? "#f59e0b" : (muted ? "var(--muted)" : "var(--text)"),
        borderColor: missing(value) ? "rgba(245,158,11,0.5)" : "transparent" }}>
      {missing(value) ? "— €" : `${moneyVal(Number(value), 2)} €`}
    </button>
  );
}

export default function PriceReview({ onClose }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");   // all | missing | gap
  const [open, setOpen] = useState({});          // filaments deplies

  const load = () => client.get("/filaments/price-review")
    .then(r => setRows(r.data)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows.filter(f => {
      const fl = flagsFor(f);
      if (filter === "missing" && !(fl.noCat || fl.noSpool)) return false;
      if (filter === "gap" && !fl.gap) return false;
      if (!needle) return true;
      return `${f.name} ${f.manufacturer||""} ${f.fila_type||""}`.toLowerCase().includes(needle);
    });
  }, [rows, q, filter]);

  const counts = useMemo(() => {
    if (!rows) return { missing:0, gap:0 };
    let m = 0, g = 0;
    for (const f of rows) {
      const fl = flagsFor(f);
      if (fl.noCat || fl.noSpool) m++;
      if (fl.gap) g++;
    }
    return { missing:m, gap:g };
  }, [rows]);

  const saveFil = async (f, n) => {
    await client.patch(`/filaments/filaments/${f.id}`, { price: n });
    setRows(rs => rs.map(x => x.id === f.id ? { ...x, price: n } : x));
  };
  const saveSpool = async (f, sp, n) => {
    await client.patch(`/filaments/spools/${sp.id}`, { price_override: n });
    setRows(rs => rs.map(x => x.id !== f.id ? x : {
      ...x, spools: x.spools.map(s => s.id === sp.id ? { ...s, price: n } : s) }));
  };

  const chip = (id, label, n) => (
    <button key={id} onClick={() => setFilter(id)}
      style={{ padding:"6px 13px", borderRadius:20, fontSize:12.5, fontWeight:800,
        cursor:"pointer", whiteSpace:"nowrap",
        border: filter===id ? "none" : "1px solid var(--border)",
        background: filter===id ? "linear-gradient(135deg, #F59E0B, #F97316)" : "var(--surface)",
        color: filter===id ? "#fff" : "var(--muted)" }}>
      {label}{n != null && <span style={{ opacity:0.6, marginLeft:5 }}>{n}</span>}
    </button>
  );

  return (
    <div style={{ position:"fixed", inset:0, zIndex:9000, background:"var(--bg)",
      display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"calc(14px + env(safe-area-inset-top, 0px)) 16px 12px", borderBottom:"1px solid var(--border)",
        display:"flex", flexDirection:"column", gap:10,
        background:"radial-gradient(circle at 10% 20%, #F59E0B44, transparent 60%), linear-gradient(135deg, #F59E0B1c, transparent 70%), var(--surface2)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ width:42, height:42, borderRadius:14, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20,
            background:"linear-gradient(135deg, #F59E0B, #FBBF24)", boxShadow:"0 8px 18px -8px #F59E0B" }}>💶</span>
          <h2 style={{ flex:1, margin:0, fontSize:19, fontWeight:900, color:"var(--text)" }}>
            Révision des prix
          </h2>
          <button onClick={onClose} aria-label="Fermer"
            style={{ border:"1px solid var(--border)", background:"var(--surface)", color:"var(--text2)", fontWeight:800,
              borderRadius:20, padding:"7px 14px", fontSize:12.5, cursor:"pointer" }}>✕ Fermer</button>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Filtrer : nom, marque, sous-type…"
          style={{ width:"100%", boxSizing:"border-box", height:40, padding:"0 14px", borderRadius:20,
            border:"1px solid var(--border)", background:"var(--surface)",
            color:"var(--text)", fontSize:13.5, outline:"none" }}/>
        <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:2 }}>
          {chip("all", "Tout", rows?.length)}
          {chip("missing", "Sans prix", counts.missing)}
          {chip("gap", `Écarts > ${Math.round(ECART*100)} %`, counts.gap)}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"10px 12px 32px" }}>
        {!rows ? (
          <p style={{ fontSize:12.5, color:"var(--muted)", textAlign:"center", padding:24 }}>Chargement…</p>
        ) : !shown.length ? (
          <p style={{ fontSize:12.5, color:"var(--muted)", textAlign:"center", padding:24 }}>
            Aucun filament ne correspond.
          </p>
        ) : shown.map(f => {
          const fl = flagsFor(f);
          const colors = parseColorsList(f.color, f.colors_array);
          const isOpen = !!open[f.id];
          const nSp = f.spools.length;
          return (
            <div key={f.id} style={{ marginBottom:8, padding:0, overflow:"hidden", borderRadius:16,
              border:`1px solid ${fl.noCat || fl.noSpool ? "rgba(245,158,11,0.45)" : "var(--border)"}`,
              background: fl.noCat || fl.noSpool ? "linear-gradient(135deg, rgba(245,158,11,0.10), transparent 60%), var(--surface2)" : "var(--surface2)" }}>
              <div onClick={() => setOpen(o => ({ ...o, [f.id]: !o[f.id] }))}
                style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px",
                  cursor: nSp ? "pointer" : "default" }}>
                <span style={{ width:30, height:30, borderRadius:"50%", flexShrink:0, boxShadow:"inset 0 0 0 1px rgba(148,163,184,.5)",
                  ...colorBg(colors, f.multicolor_type) }}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ margin:0, fontSize:13.5, fontWeight:800, color:"var(--text)",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {f.name}
                  </p>
                  <p style={{ margin:"1px 0 0", fontSize:10.5, color:"var(--muted)",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {[f.manufacturer, f.fila_type].filter(Boolean).join(" · ")}
                    {nSp > 0 && ` · ${nSp} bobine${nSp>1?"s":""}`}
                  </p>
                </div>
                {fl.gap && <span title="Écart avec le tarif catalogue"
                  style={{ fontSize:9, fontWeight:800, padding:"2px 6px", borderRadius:20,
                    background:"rgba(245,158,11,0.15)", color:"#f59e0b", flexShrink:0 }}>≠</span>}
                <span onClick={e => e.stopPropagation()} style={{ flexShrink:0 }}>
                  <PriceCell value={f.price} onSave={n => saveFil(f, n)}/>
                </span>
                {nSp > 0 && <span style={{ color:"var(--muted)", fontSize:10, flexShrink:0 }}>
                  {isOpen ? "▾" : "▸"}</span>}
              </div>

              {isOpen && nSp > 0 && (
                <div style={{ borderTop:"1px solid var(--border)", background:"var(--surface)" }}>
                  {f.spools.map(sp => {
                    const ecart = !missing(sp.price) && !missing(f.price) && f.price > 0
                      ? (sp.price - f.price) / f.price : null;
                    return (
                      <div key={sp.id} style={{ display:"flex", alignItems:"center", gap:8,
                        padding:"7px 12px 7px 32px", borderTop:"1px solid var(--border)" }}>
                        <span style={{ fontSize:11, color:"var(--muted)", flexShrink:0,
                          fontFamily:"'JetBrains Mono',ui-monospace,monospace" }}>#{sp.id}</span>
                        <span style={{ flex:1, minWidth:0, fontSize:11, color:"var(--muted)",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {sp.archived ? "archivée" : (sp.location || "—")}
                          {sp.remaining_weight_g != null && ` · ${Math.round(sp.remaining_weight_g)} g`}
                        </span>
                        {ecart != null && Math.abs(ecart) > ECART && (
                          <span style={{ fontSize:9.5, fontWeight:700, flexShrink:0,
                            color: ecart > 0 ? "#ef4444" : "#22c55e" }}>
                            {ecart > 0 ? "+" : ""}{Math.round(ecart*100)} %
                          </span>
                        )}
                        <PriceCell value={sp.price} muted={sp.archived}
                          onSave={n => saveSpool(f, sp, n)}/>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
