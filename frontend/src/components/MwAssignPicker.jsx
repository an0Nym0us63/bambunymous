import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import client, { apiUrl } from "../api/client";
import { useMwAssign } from "../store/mwAssign";
import { toast } from "../store/toast";
import { mwImg } from "./MwImg";

// Associer un modele MakerWorld a des impressions : une fenetre de recherche,
// liste A PLAT (une impression d'un groupe se choisit seule), chaque ligne dit
// si elle a deja un modele (et lequel) ; un filtre ne montre que les orphelines.
const fmtDate = iso => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric" }); } catch { return ""; }
};

function Thumb({ id }) {
  const [ok, setOk] = useState(true);
  return ok
    ? <img src={apiUrl(`/prints/${id}/image`)} alt="" loading="lazy" onError={() => setOk(false)}
        style={{ width:44, height:44, borderRadius:8, objectFit:"cover", flexShrink:0, background:"var(--surface2)" }}/>
    : <span style={{ width:44, height:44, borderRadius:8, flexShrink:0, background:"var(--surface2)", display:"flex",
        alignItems:"center", justifyContent:"center", fontSize:18 }}>🖨️</span>;
}

export default function MwAssignPicker() {
  const item = useMwAssign(s => s.item);
  const clear = useMwAssign(s => s.clear);
  const [q, setQ] = useState("");
  const [unlinked, setUnlinked] = useState(true);
  const [rows, setRows] = useState(null);
  const [next, setNext] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => { if (item) { setQ(""); setUnlinked(true); setSel(new Set()); } }, [item]);

  const load = (offset = 0) => {
    const n = ++seq.current;
    if (!offset) setRows(null);
    client.get("/prints/makerworld/pick", { params: { search: q || undefined, unlinked: unlinked || undefined, offset, limit: 40 } })
      .then(({ data }) => {
        if (n !== seq.current) return;
        setRows(r => (offset && r ? [...r, ...data.items] : data.items));
        setNext(data.next_offset);
      })
      .catch(e => { if (n === seq.current) { setRows([]); toast(e.response?.data?.detail || e.message, "error"); } });
  };
  useEffect(() => {
    if (!item) return undefined;
    const t = setTimeout(() => load(0), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [item, q, unlinked]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;
  const toggle = id => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const apply = async () => {
    setBusy(true);
    try {
      const { data } = await client.post("/prints/makerworld/assign", { design_id: item.design_id, print_ids: [...sel] });
      toast(`Modèle associé à ${data.count} impression${data.count > 1 ? "s" : ""}`, "success");
      window.dispatchEvent(new Event("bn-prints-changed"));
      clear();
    } catch (e) { toast(e.response?.data?.detail || e.message, "error"); }
    setBusy(false);
  };
  const title = item.title_fr || item.title || `Modèle ${item.design_id}`;

  return createPortal(
    <div onClick={clear} style={{ position:"fixed", inset:0, zIndex:4500, background:"rgba(0,0,0,0.55)", display:"flex",
      alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:560, height:"min(720px, 90dvh)", display:"flex",
        flexDirection:"column", background:"var(--sheet-bg, var(--surface))", borderRadius:"16px 16px 0 0",
        boxShadow:"0 -8px 30px rgba(0,0,0,.35)", overflow:"hidden" }}>
        {/* le modele a associer */}
        <div style={{ padding:"14px 14px 10px", display:"flex", flexDirection:"column", gap:10, borderBottom:"1px solid var(--border)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {item.cover_url
              ? <img src={mwImg(item.cover_url, 44)} alt="" style={{ width:40, height:40, borderRadius:8, objectFit:"cover", flexShrink:0 }}/>
              : <span style={{ width:40, height:40, borderRadius:8, background:"var(--surface2)", flexShrink:0 }}/>}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, color:"var(--muted)", fontWeight:700 }}>🔗 Associer ce modèle à des impressions</div>
              <div style={{ fontSize:13.5, fontWeight:800, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis",
                whiteSpace:"nowrap" }}>{title}</div>
            </div>
            <button type="button" onClick={clear} aria-label="Fermer" style={{ background:"none", border:"none", fontSize:20,
              color:"var(--muted)", cursor:"pointer", lineHeight:1 }}>✕</button>
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher une impression (nom, fichier, filament…)"
            autoComplete="off" spellCheck={false}
            style={{ width:"100%", boxSizing:"border-box", padding:"9px 12px", borderRadius:10, fontSize:13,
              background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" }}/>
          <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:12.5, color:"var(--text2)", cursor:"pointer" }}>
            <input type="checkbox" checked={unlinked} onChange={e => setUnlinked(e.target.checked)}
              style={{ width:16, height:16, accentColor:"#3b82f6" }}/>
            Seulement les impressions sans modèle MakerWorld
          </label>
        </div>
        {/* les impressions, a plat */}
        <div style={{ flex:1, minHeight:0, overflowY:"auto" }}>
          {rows === null ? <div style={{ padding:16, fontSize:12.5, color:"var(--muted)" }}>Chargement…</div>
            : !rows.length ? <div style={{ padding:16, fontSize:12.5, color:"var(--muted)" }}>
                {unlinked ? "Aucune impression sans modèle ne correspond." : "Aucune impression ne correspond."}</div>
            : rows.map(r => {
              const on = sel.has(r.id);
              const same = r.design_id && String(r.design_id) === String(item.design_id);
              return (
                <button key={r.id} type="button" onClick={() => toggle(r.id)} style={{ width:"100%", display:"flex", alignItems:"center",
                  gap:10, padding:"8px 12px", border:"none", borderBottom:"1px solid var(--border)", textAlign:"left", cursor:"pointer",
                  background: on ? "rgba(59,130,246,0.10)" : "none", color:"var(--text)" }}>
                  <span style={{ width:20, height:20, borderRadius:6, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
                    border: on ? "none" : "1.5px solid var(--muted)", background: on ? "#3b82f6" : "none", color:"#fff", fontSize:12,
                    fontWeight:900 }}>{on ? "✓" : ""}</span>
                  <Thumb id={r.id}/>
                  <span style={{ flex:1, minWidth:0 }}>
                    <span style={{ display:"block", fontSize:12.5, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis",
                      whiteSpace:"nowrap" }}>{r.name}</span>
                    <span style={{ display:"block", fontSize:11, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis",
                      whiteSpace:"nowrap" }}>{fmtDate(r.date)}{r.group ? ` · 🗂️ ${r.group}` : ""}</span>
                    <span style={{ display:"block", fontSize:10.5, fontWeight:700, marginTop:1, overflow:"hidden", textOverflow:"ellipsis",
                      whiteSpace:"nowrap", color: same ? "#16a34a" : r.design_id ? "#d97706" : "var(--muted)" }}>
                      {same ? "✓ déjà ce modèle" : r.design_id ? `🔗 lié à : ${r.design_title || `modèle ${r.design_id}`}` : "sans modèle MakerWorld"}</span>
                  </span>
                </button>
              );
            })}
          {next != null && rows?.length > 0 && (
            <button type="button" onClick={() => load(next)} style={{ width:"100%", padding:12, border:"none", background:"none",
              color:"#3b82f6", fontWeight:700, fontSize:12.5, cursor:"pointer" }}>Afficher plus</button>
          )}
        </div>
        <div style={{ padding:"10px 14px calc(10px + env(safe-area-inset-bottom,0px))", borderTop:"1px solid var(--border)",
          display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ flex:1, fontSize:12, color:"var(--muted)" }}>
            {sel.size ? `${sel.size} impression${sel.size > 1 ? "s" : ""} choisie${sel.size > 1 ? "s" : ""}` : "Touche les impressions à associer"}
            {[...sel].some(id => rows?.find(r => r.id === id && r.design_id && String(r.design_id) !== String(item.design_id)))
              && <span style={{ display:"block", color:"#d97706" }}>Certaines ont déjà un autre modèle : il sera remplacé.</span>}
          </span>
          <button type="button" onClick={clear} style={{ padding:"8px 12px", borderRadius:9, border:"1px solid var(--border)",
            background:"var(--surface)", color:"var(--text2)", cursor:"pointer", fontWeight:700 }}>Annuler</button>
          <button type="button" onClick={apply} disabled={busy || !sel.size} style={{ padding:"8px 14px", borderRadius:9, border:"none",
            fontWeight:800, color:"#fff", background: sel.size ? "#3b82f6" : "var(--border)", cursor: sel.size ? "pointer" : "default" }}>
            {busy ? "…" : "Associer"}</button>
        </div>
      </div>
    </div>, document.body);
}
