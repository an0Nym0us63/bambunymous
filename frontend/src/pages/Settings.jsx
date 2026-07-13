import React, { useState, useEffect } from "react";
import { Save, Wifi, RefreshCw, Sun, Moon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import HeaderAction from "../components/HeaderAction";
import { usePrinter } from "../store/printer";
import { useTheme } from "../useTheme";

const inp = {
  width:"100%", background:"var(--surface2)", border:"1px solid var(--border)",
  borderRadius:10, padding:"8px 12px", fontSize:14, color:"var(--text)",
  outline:"none", transition:"border-color 0.15s", boxSizing:"border-box",
};
const lbl = {
  display:"block", fontSize:11, color:"var(--muted)", marginBottom:6,
  textTransform:"uppercase", letterSpacing:"0.05em",
};
const sec = {
  display:"grid", gridTemplateColumns:"1fr 1fr", gap:12,
};
const card = { padding:16 };
const cardTitle = {
  fontSize:11, fontWeight:600, color:"var(--muted)", textTransform:"uppercase",
  letterSpacing:"0.08em", marginBottom:16, display:"flex", alignItems:"center", gap:6,
};

const AMS_NAMES = { 0:"AMS-A", 1:"AMS-B", 2:"AMS-C", 3:"AMS-D" };
const POSITION_LABELS = [
  "Position 1 — haut gauche",
  "Position 2 — bas gauche (sous A)",
  "Position 3 — à côté de A",
  "Position 4 — sous la position 3",
];

function AMSOrderSection() {
  const status = usePrinter(s => s.status);
  const availableIds = [...new Map((status?.ams_list || []).map(a => [a.id, a])).values()]
    .map(a => a.id).sort((a,b) => a-b);

  const [order, setOrder] = useState([null, null, null, null]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    client.get("/settings/ams-order").then(({ data }) => {
      const o = data.order || [];
      setOrder([0,1,2,3].map(i => (o[i] ?? null)));
    }).finally(() => setLoading(false));
  }, []);

  const unplaced = availableIds.filter(id => !order.includes(id));

  const placeAt = (slotIndex, amsId) => {
    setOrder(prev => prev.map((v, i) => {
      if (i === slotIndex) return amsId;
      return v === amsId ? null : v; // retire l'AMS de son ancienne position
    }));
  };
  const clearSlot = (slotIndex) => setOrder(prev => prev.map((v,i) => i===slotIndex ? null : v));

  const save = async () => {
    setSaving(true);
    try {
      await client.post("/settings/ams-order", { order });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch(e) {
      alert("Erreur: " + (e.response?.data?.detail || e.message));
    } finally { setSaving(false); }
  };

  const chipStyle = (draggable) => ({
    display:"flex", alignItems:"center", gap:6, padding:"8px 12px", borderRadius:10,
    background:"var(--surface2)", border:"1px solid var(--border)", fontSize:13, fontWeight:700,
    color:"var(--text)", cursor: draggable ? "grab" : "default", userSelect:"none",
  });

  if (loading) return null;

  return (
    <div className="card" style={card}>
      <p style={cardTitle}>Disposition AMS sur l'accueil</p>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"-8px 0 14px" }}>
        Glisse-dépose un AMS dans la position où tu veux le voir sur l'accueil.
      </p>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gridTemplateRows:"auto auto", gridAutoFlow:"column", gap:10, marginBottom:16 }}>
        {order.map((amsId, idx) => (
          <div key={idx}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const id = Number(e.dataTransfer.getData("text/plain")); if (!isNaN(id)) placeAt(idx, id); }}
            style={{ minHeight:64, borderRadius:12, border:"2px dashed var(--border)",
              background:"var(--surface)", padding:10, display:"flex", flexDirection:"column", gap:6 }}>
            <span style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.04em" }}>
              {POSITION_LABELS[idx]}
            </span>
            {amsId != null ? (
              <div draggable onDragStart={e => e.dataTransfer.setData("text/plain", String(amsId))}
                style={chipStyle(true)}>
                {AMS_NAMES[amsId] ?? `AMS ${amsId+1}`}
                <button onClick={() => clearSlot(idx)} style={{ marginLeft:"auto", background:"none",
                  border:"none", color:"var(--muted)", cursor:"pointer", fontSize:13 }}>✕</button>
              </div>
            ) : (
              <span style={{ fontSize:11, color:"var(--muted)", opacity:0.6 }}>Vide — dépose un AMS ici</span>
            )}
          </div>
        ))}
      </div>

      {unplaced.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <p style={{ fontSize:11, color:"var(--muted)", marginBottom:8 }}>AMS disponibles (non placés)</p>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {unplaced.map(id => (
              <div key={id} draggable onDragStart={e => e.dataTransfer.setData("text/plain", String(id))}
                style={chipStyle(true)}>
                {AMS_NAMES[id] ?? `AMS ${id+1}`}
              </div>
            ))}
          </div>
        </div>
      )}

      {!availableIds.length && (
        <p style={{ fontSize:12, color:"var(--muted)" }}>
          Aucun AMS détecté pour l'instant — connecte-toi à l'imprimante pour les voir apparaître ici.
        </p>
      )}

      <button onClick={save} disabled={saving}
        style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 16px",
          background:"#3b82f6", border:"none", borderRadius:10, color:"white",
          fontSize:13, fontWeight:700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
        {saving ? <RefreshCw size={14} style={{ animation:"spin 1s linear infinite" }}/> : <Save size={14}/>}
        {saved ? "Sauvegardé ✓" : "Sauvegarder la disposition"}
      </button>
    </div>
  );
}

function EnrichFromCatalogSection() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setRunning(true); setResult(null);
    try {
      const { data } = await client.post("/filaments/filaments/enrich-from-catalog");
      setResult(data);
    } catch(e) { alert(e.response?.data?.detail || e.message); }
    finally { setRunning(false); }
  };

  return (
    <div className="card" style={card}>
      <p style={cardTitle}>Enrichissement catalogue Bambu</p>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"-8px 0 14px" }}>
        Pour tous les filaments Bambu en base (avec Profile ID), cherche leur fiche officielle
        dans le catalogue et met à jour : nom, code couleur, type multicolore, couleurs…
      </p>
      <button onClick={run} disabled={running}
        style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 16px",
          background: running ? "var(--border)" : "#3b82f6", border:"none", borderRadius:10,
          color:"white", fontSize:13, fontWeight:700, cursor: running ? "not-allowed" : "pointer" }}>
        {running ? <RefreshCw size={14} style={{ animation:"spin 1s linear infinite" }}/> : "🔍"}
        {running ? "Recherche en cours…" : "Enrichir depuis le catalogue Bambu"}
      </button>
      {result && (
        <div style={{ marginTop:14, padding:"10px 14px", borderRadius:10,
          background:"var(--surface2)", border:"1px solid var(--border)", fontSize:12 }}>
          <p style={{ fontWeight:700, color:"var(--text)", margin:"0 0 8px" }}>
            Résultat — {result.total_bambu} filament(s) Bambu en base
          </p>
          <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:10 }}>
            <span style={{ color:"#22c55e", fontWeight:700 }}>✓ {result.updated} mis à jour</span>
            <span style={{ color:"#f59e0b", fontWeight:700 }}>⚠ {result.not_found} introuvables dans le catalogue</span>
            <span style={{ color:"var(--muted)" }}>— {result.skipped} ignorés (sans couleur hex)</span>
          </div>
          {result.details?.updated?.length > 0 && (
            <div>
              <p style={{ color:"var(--muted)", margin:"0 0 4px", textTransform:"uppercase", fontSize:10, letterSpacing:"0.06em" }}>Mis à jour</p>
              {result.details.updated.map(f => (
                <div key={f.id} style={{ fontSize:11, color:"var(--text)", padding:"2px 0" }}>
                  #{f.id} {f.name} → {f.changes.join(", ")}
                </div>
              ))}
            </div>
          )}
          {result.details?.not_found?.length > 0 && (
            <div style={{ marginTop:8 }}>
              <p style={{ color:"var(--muted)", margin:"0 0 4px", textTransform:"uppercase", fontSize:10, letterSpacing:"0.06em" }}>Introuvables</p>
              {result.details.not_found.map(f => (
                <div key={f.id} style={{ fontSize:11, color:"#f59e0b", padding:"2px 0" }}>
                  #{f.id} {f.name} (profil {f.profile_id}, couleur #{f.color})
                </div>
              ))}
            </div>
          )}
          {result.details?.no_profile?.length > 0 && (
            <div style={{ marginTop:8 }}>
              <p style={{ color:"var(--muted)", margin:"0 0 4px", textTransform:"uppercase", fontSize:10, letterSpacing:"0.06em" }}>
                Sans Profile ID — non enrichissables
              </p>
              {result.details.no_profile.map(f => (
                <div key={f.id} style={{ fontSize:11, color:"var(--muted)", padding:"2px 0" }}>
                  #{f.id} {f.name}{f.manufacturer ? ` · ${f.manufacturer}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function RecalculateSection() {
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const run = async () => {
    setLoading(true); setDone(false);
    try {
      await client.post("/prints/recalculate-all");
      setDone(true);
      setTimeout(() => setDone(false), 5000);
    } catch(e) { alert(e.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>
        Recalculer les coûts
      </h3>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 14px" }}>
        Recalcule les coûts filament et électricité de tous les prints (utile après changement de prix ou d'import). Les groupes se mettent à jour automatiquement.
      </p>
      <button onClick={run} disabled={loading}
        style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:700, cursor:loading?"wait":"pointer",
          border:"none", background: done ? "#22c55e" : loading ? "var(--border)" : "#3b82f6",
          color:"white", display:"flex", alignItems:"center", gap:8 }}>
        {loading ? "Recalcul en cours…" : done ? "✓ Recalcul lancé" : "⟳ Recalculer tous les prints"}
      </button>
    </div>
  );
}
// Pastille couleur — degrade sur un calque interne d'un conteneur overflow:hidden
// et anneau en box-shadow : un border sur un element peint laisse transparaitre
// le fond et cree un halo.
function ColorDot({ f, size = 14 }) {
  const cols = (f.colors_array || "")
    .split(",").map(c => `#${c.trim().replace(/^#/, "").slice(0, 6)}`)
    .filter(c => c.length === 7);
  let bg = f.color
    ? (String(f.color).startsWith("#") ? String(f.color).slice(0, 7) : `#${String(f.color).slice(0, 6)}`)
    : "#888";
  if (cols.length > 1) {
    bg = f.multicolor_type === "gradient"
      ? `linear-gradient(135deg, ${cols.join(",")})`
      : `linear-gradient(90deg, ${cols.map((c, i, a) =>
          `${c} ${i / a.length * 100}%, ${c} ${(i + 1) / a.length * 100}%`).join(",")})`;
  }
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", flexShrink:0,
      position:"relative", overflow:"hidden",
      boxShadow:"inset 0 0 0 1px rgba(128,128,128,0.35)" }}>
      <div style={{ position:"absolute", inset:0, background:bg }}/>
    </div>
  );
}

// ── Alertes ignorées ───────────────────────────────────────────────────────
function DismissedCard({ card, cardTitle }) {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr]   = React.useState(null);

  const load = () => {
    setErr(null);
    client.get("/attention/dismissed")
      .then(r => setRows(r.data?.dismissed || []))
      .catch(e => setErr(e.response?.data?.detail || e.message));
  };
  React.useEffect(() => { if (open) load(); }, [open]);

  const remove = async (key) => {
    setRows(rs => rs.filter(r => r.key !== key));   // optimiste
    try { await client.delete(`/attention/dismiss/${encodeURIComponent(key)}`); }
    catch { load(); }
  };

  const clearAll = async () => {
    if (!window.confirm("Remettre en circulation TOUTES les alertes ignorées ?")) return;
    setBusy(true);
    try { await client.delete("/attention/dismissed"); setRows([]); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const fmt = (r) => {
    if (r.forever) return "Définitivement";
    if (!r.until) return "—";
    const d = new Date(r.until);
    if (r.expired) return "Expiré";
    const days = Math.max(0, Math.ceil((d - new Date()) / 86400000));
    return `Encore ${days} j`;
  };

  const btn = (bg, color) => ({ padding:"8px 14px", borderRadius:8, border:"none",
    cursor:"pointer", background:bg, color, fontSize:12, fontWeight:700 });

  return (
    <div className="card" style={card}>
      <div style={cardTitle}>Alertes ignorées</div>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 12px" }}>
        Les points d'attention que tu as masqués — pour 7 jours ou définitivement.
        Tu peux les remettre en circulation ici.
      </p>
      <button type="button" onClick={() => setOpen(true)} style={btn("#3b82f6","white")}>
        Voir les alertes ignorées…
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position:"fixed", inset:0, zIndex:9999,
          background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center",
          justifyContent:"center", padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:520,
            maxHeight:"84vh", display:"flex", flexDirection:"column",
            background:"var(--sheet-bg)", borderRadius:16, overflow:"hidden" }}>

            <div style={{ padding:"12px 16px", display:"flex", alignItems:"center", gap:10 }}>
              <p style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:0, flex:1 }}>
                Alertes ignorées{rows ? ` (${rows.length})` : ""}
              </p>
              <button type="button" onClick={() => setOpen(false)}
                style={{ background:"none", border:"none", color:"var(--muted)",
                  fontSize:18, cursor:"pointer" }}>✕</button>
            </div>

            {err && (
              <p style={{ margin:0, padding:"0 16px 8px", fontSize:12, color:"#ef4444" }}>⚠ {err}</p>
            )}

            <div style={{ flex:1, overflowY:"auto", padding:"0 8px 8px" }}>
              {!rows ? (
                <p style={{ fontSize:12, color:"var(--muted)", padding:12, margin:0 }}>Chargement…</p>
              ) : !rows.length ? (
                <p style={{ fontSize:12, color:"var(--muted)", padding:12, margin:0 }}>
                  Aucune alerte ignorée.
                </p>
              ) : rows.map(r => (
                <div key={r.key} style={{ display:"flex", alignItems:"center", gap:10,
                  padding:"8px", borderRadius:8 }}>
                  <ColorDot f={r} size={22}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:12, fontWeight:600, color:"var(--text)",
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {r.title}
                    </p>
                    <p style={{ margin:0, fontSize:10, color:"var(--muted)",
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {r.icon} {r.label}{r.detail ? ` · ${r.detail}` : ""}
                    </p>
                  </div>
                  <span style={{ flexShrink:0, fontSize:10, fontWeight:700,
                    fontFamily:"JetBrains Mono,monospace",
                    color: r.forever ? "#ef4444" : r.expired ? "var(--muted)" : "#f59e0b" }}>
                    {fmt(r)}
                  </span>
                  <button type="button" onClick={() => remove(r.key)}
                    title="Remettre en circulation"
                    style={{ flexShrink:0, background:"none", border:"none", cursor:"pointer",
                      color:"var(--muted)", fontSize:14, padding:"0 2px" }}>↩</button>
                </div>
              ))}
            </div>

            <div style={{ padding:"12px 16px", display:"flex", gap:8 }}>
              <button type="button" onClick={() => setOpen(false)}
                style={{ ...btn("var(--surface2)","var(--muted)"), flex:1 }}>Fermer</button>
              <button type="button" disabled={!rows?.length || busy} onClick={clearAll}
                style={{ ...btn(rows?.length ? "rgba(239,68,68,0.12)" : "var(--border)",
                  rows?.length ? "#ef4444" : "var(--muted)"), flex:2 }}>
                {busy ? "…" : "Tout remettre en circulation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Étiquettes filaments (PDF) ─────────────────────────────────────────────
function LabelsCard({ card, cardTitle }) {
  const [open, setOpen] = React.useState(false);
  const [fils, setFils] = React.useState([]);
  const [sel, setSel] = React.useState(new Set());
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    if (!open) return;
    client.get("/filaments/filaments")
      .then(r => {
        const list = r.data || [];
        setFils(list);
        setSel(new Set(list.map(f => f.id)));   // tout coché par défaut
      })
      .catch(() => setErr("Chargement impossible"));
  }, [open]);

  const shown = fils.filter(f => {
    if (!q.trim()) return true;
    const hay = [String(f.id), f.translated_name, f.name, f.manufacturer,
                 f.material, f.fila_type, f.color_bucket]
      .filter(Boolean).join(" ").toLowerCase();
    return q.trim().toLowerCase().split(/\s+/).every(w => hay.includes(w));
  });

  const toggle = (id) => setSel(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const download = async (ids) => {
    setBusy(true); setErr(null);
    try {
      // responseType blob : sans ca axios renvoie une chaine et le PDF est corrompu
      // NB : le routeur a le prefixe /filaments ET la route est declaree
      // "/filaments/labels/pdf" -> le doublon est normal (cf. /filaments/filaments).
      const r = await client.post("/filaments/filaments/labels/pdf", { ids: ids || null },
        { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = "etiquettes-filaments.pdf";
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch {
      setErr("Génération impossible");
    } finally { setBusy(false); }
  };

  const btn = (bg) => ({ padding:"8px 14px", borderRadius:8, border:"none", cursor:"pointer",
    background:bg, color:"white", fontSize:12, fontWeight:700 });

  return (
    <div className="card" style={card}>
      <div style={cardTitle}>Étiquettes filaments</div>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 12px" }}>
        Planche d'étiquettes à coller sur les échantillons : un QR code de 9 × 9 mm
        encodant l'ID du filament, et l'ID en clair juste en dessous pour pouvoir
        le saisir à la main. C'est ce QR que lit le bouton Scanner.
      </p>
      <button type="button" onClick={() => setOpen(true)} style={btn("#3b82f6")}>
        Générer les étiquettes…
      </button>
      {err && <p style={{ fontSize:12, color:"#ef4444", margin:"8px 0 0" }}>⚠ {err}</p>}

      {open && (
        <div onClick={() => setOpen(false)} style={{ position:"fixed", inset:0, zIndex:9999,
          background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center",
          justifyContent:"center", padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:520,
            maxHeight:"84vh", display:"flex", flexDirection:"column",
            background:"var(--sheet-bg)", borderRadius:16, overflow:"hidden" }}>

            <div style={{ padding:"12px 16px", display:"flex", alignItems:"center", gap:10 }}>
              <p style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:0, flex:1 }}>
                Étiquettes — {sel.size} / {fils.length}
              </p>
              <button type="button" onClick={() => setSel(new Set(fils.map(f => f.id)))}
                style={{ ...btn("var(--surface2)"), color:"var(--muted)" }}>Tout cocher</button>
              <button type="button" onClick={() => setSel(new Set())}
                style={{ ...btn("var(--surface2)"), color:"var(--muted)" }}>Tout décocher</button>
            </div>

            <div style={{ padding:"0 16px 8px" }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrer : nom, marque, matière, teinte…"
                style={{ width:"100%", boxSizing:"border-box", padding:"8px 12px", borderRadius:8,
                  border:"1px solid var(--border)", background:"var(--surface2)",
                  color:"var(--text)", fontSize:13, outline:"none" }}/>
            </div>

            <div style={{ flex:1, overflowY:"auto", padding:"0 8px" }}>
              {shown.map(f => (
                <label key={f.id} style={{ display:"flex", alignItems:"center", gap:10,
                  padding:"7px 8px", borderRadius:8, cursor:"pointer" }}>
                  <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)}/>
                  <ColorDot f={f}/>
                  <span style={{ fontFamily:"JetBrains Mono,monospace", fontWeight:800,
                    fontSize:12, color:"#60a5fa", minWidth:34 }}>#{f.id}</span>
                  <span style={{ flex:1, minWidth:0, fontSize:12, color:"var(--text)",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {f.translated_name || f.name}
                    <span style={{ color:"var(--muted)" }}>
                      {" · "}{[f.manufacturer, f.material].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </label>
              ))}
              {!shown.length && (
                <p style={{ fontSize:12, color:"var(--muted)", padding:12, margin:0 }}>
                  Aucun filament.
                </p>
              )}
            </div>

            <div style={{ padding:"12px 16px", display:"flex", gap:8 }}>
              <button type="button" onClick={() => setOpen(false)}
                style={{ ...btn("var(--surface2)"), color:"var(--muted)", flex:1 }}>Annuler</button>
              <button type="button" disabled={!sel.size || busy}
                onClick={() => download([...sel])}
                style={{ ...btn(sel.size ? "#3b82f6" : "var(--border)"), flex:2 }}>
                {busy ? "Génération…" : `Générer (${sel.size})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [ip,      setIp]      = useState("");
  const [serial,  setSerial]  = useState("");
  const [code,    setCode]    = useState("");
  const [pname,   setPname]   = useState("");
  const [user,    setUser]    = useState("admin");
  const [pass,    setPass]    = useState("");
  const [cost,    setCost]    = useState("0");
  const [codeSet, setCodeSet] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [resetting,    setResetting]    = useState(false);
  const [version, setVersion] = useState(null);

  useEffect(() => {
    client.get("/version").then(({ data }) => setVersion(data)).catch(() => {});
    client.get("/settings").then(({ data }) => {
      setCodeSet(data.PRINTER_ACCESS_CODE_SET ?? false);
      setIp(data.PRINTER_IP     ?? "");
      setSerial(data.PRINTER_ID ?? "");
      setPname(data.PRINTER_NAME ?? "");
      setUser(data.ADMIN_USERNAME ?? "admin");
      setCost(data.COST_BY_HOUR ?? "0");
      setLoading(false);
    });
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {};
    if (ip)     payload.PRINTER_IP     = ip;
    if (serial) payload.PRINTER_ID     = serial;
    if (code)   payload.PRINTER_ACCESS_CODE = code;
    if (pname)  payload.PRINTER_NAME   = pname;
    if (user)   payload.ADMIN_USERNAME = user;
    if (pass)   payload.ADMIN_PASSWORD = pass;
    if (cost)   payload.COST_BY_HOUR   = cost;
    try {
      await client.patch("/settings", payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch(err) {
      alert("Erreur: " + (err.response?.data?.detail || err.message));
    } finally { setSaving(false); }
  };

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:200, color:"var(--muted)", fontSize:14 }}>Chargement…</div>
  );

  const F = (label, value, set, opts={}) => (
    <div>
      <label style={lbl}>{label}</label>
      <input
        type={opts.type||"text"}
        value={value}
        placeholder={opts.placeholder||""}
        onChange={e => set(e.target.value)}
        style={inp}
        onFocus={e => e.target.style.borderColor="#3b82f6"}
        onBlur={e => e.target.style.borderColor="var(--border)"}
      />
      {opts.hint && <p style={{ fontSize:10, color:"#22c55e", marginTop:4 }}>{opts.hint}</p>}
    </div>
  );

  return (
    <div style={{ maxWidth:640, margin:"0 auto", display:"flex", flexDirection:"column", gap:16 }}>
      {/* Mobile : le bouton part dans le header (une ligne de gagnee).
          Desktop : le header mobile n'existe pas, on le garde dans le flux. */}
      <HeaderAction>
        <button onClick={() => navigate("/logs")} aria-label="Journal"
          style={{ padding:"5px 12px", borderRadius:20, border:"1px solid var(--border)",
            background:"var(--surface2)", cursor:"pointer", display:"flex",
            alignItems:"center", gap:5, color:"var(--muted)", fontSize:12 }}>
          📋 Journal
        </button>
      </HeaderAction>

      <div className="hidden-mobile" style={{ display:"none", alignItems:"center", justifyContent:"flex-end" }}>
        <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0, marginRight:"auto" }}>Paramètres</h1>
        <button onClick={() => navigate("/logs")}
          style={{ padding:"6px 14px", borderRadius:20, border:"1px solid var(--border)",
            background:"var(--surface2)", cursor:"pointer", display:"flex", alignItems:"center", gap:6,
            color:"var(--muted)", fontSize:12 }}>
          📋 Journal
        </button>
      </div>

      <form onSubmit={handleSave} style={{ display:"flex", flexDirection:"column", gap:16 }}>

        {/* Thème */}
        <div className="card" style={card}>
          <div style={cardTitle}>Apparence</div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:14, color:"var(--text2)" }}>Thème</span>
            <button type="button" onClick={toggle}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 16px",
                borderRadius:20, border:"1px solid var(--border)", background:"var(--surface2)",
                color:"var(--text)", fontSize:13, cursor:"pointer" }}>
              {theme === "dark" ? <><Moon size={14}/> Sombre</> : <><Sun size={14}/> Clair</>}
            </button>
          </div>
        </div>

        {/* Imprimante */}
        <div className="card" style={card}>
          <div style={cardTitle}><Wifi size={13}/> Imprimante</div>
          <div style={sec}>
            {F("Adresse IP", ip, setIp, { placeholder:"192.168.1.xxx" })}
            {F("Numéro de série", serial, setSerial, { placeholder:"31B…" })}
            <div>
              <label style={lbl}>Code d&apos;accès</label>
              <input type="password" value={code}
                placeholder={codeSet ? "Laisser vide pour conserver" : "Code LAN"}
                onChange={e => setCode(e.target.value)}
                style={inp}
                onFocus={e => e.target.style.borderColor="#3b82f6"}
                onBlur={e => e.target.style.borderColor="var(--border)"}
              />
              {codeSet && !code && <p style={{ fontSize:10, color:"#22c55e", marginTop:4 }}>✓ Code configuré</p>}
            </div>
            {F("Nom affiché", pname, setPname, { placeholder:"Mon H2C" })}
          </div>
        </div>

        {/* Compte */}
        <div className="card" style={card}>
          <div style={cardTitle}>Compte</div>
          <div style={sec}>
            {F("Utilisateur", user, setUser)}
            {F("Mot de passe", pass, setPass, { type:"password", placeholder:"Laisser vide pour conserver" })}
          </div>
        </div>

        {/* Électricité */}
        <div className="card" style={card}>
          <div style={cardTitle}>Électricité</div>
          <div style={{ maxWidth:200 }}>
            {F("Tarif (€/h)", cost, setCost, { placeholder:"0.20" })}
          </div>
        </div>


        <button type="submit" disabled={saving}
          style={{ display:"inline-flex", alignItems:"center", gap:8,
            background:"#3b82f6", color:"white", border:"none",
            padding:"10px 20px", borderRadius:12, fontSize:14, fontWeight:500,
            cursor:saving?"not-allowed":"pointer", opacity:saving?0.6:1 }}
          onMouseEnter={e => { if(!saving) e.currentTarget.style.background="#2563eb"; }}
          onMouseLeave={e => e.currentTarget.style.background="#3b82f6"}>
          {saving ? <RefreshCw size={15} style={{ animation:"spin 1s linear infinite" }} /> : <Save size={15} />}
          {saved ? "Sauvegardé ✓" : "Sauvegarder"}
        </button>
      </form>

      <AMSOrderSection/>

      <EnrichFromCatalogSection/>
        <RecalculateSection/>




      {/* ── Étiquettes filaments ───────────────────────────────────── */}
      <LabelsCard card={card} cardTitle={cardTitle}/>

      {/* ── Alertes ignorées ───────────────────────────────────────── */}
      <DismissedCard card={card} cardTitle={cardTitle}/>

      {/* ── Import depuis Spoolnymous ───────────────────────────────── */}
      <SpoolnymousImport/>


      {version && (
        <p style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace",
          textAlign:"center", marginTop:8 }}>
          v{version.commit?.slice(0,8) || "dev"} · {version.build_date?.slice(0,10) || "?"}
        </p>
      )}
    </div>
  );
}

function SpoolnymousImport() {
  const [url, setUrl] = React.useState(localStorage.getItem("spoolnymous_url") || "");
  const [running, setRunning] = React.useState(false);
  const [steps, setSteps] = React.useState([]);
  const [done, setDone] = React.useState(false);
  const [pingInfo, setPingInfo] = React.useState(null);
  const [doReset, setDoReset] = React.useState(true);
  const pollRef = React.useRef(null);

  const ping = async () => {
    if (!url) return;
    try {
      const r = await client.get("/import/spoolnymous/ping", { params:{ url } });
      setPingInfo(r.data);
    } catch { setPingInfo(null); alert("Impossible de joindre Spoolnymous — vérifie l\'URL et que Spoolnymous est démarré."); }
  };

  const start = async () => {
    if (!url) return;
    localStorage.setItem("spoolnymous_url", url);
    setRunning(true); setDone(false); setSteps([]);
    if (doReset) { try { await client.delete('/settings/reset-all'); setSteps(prev=>[...prev,{msg:'BambuNymous vidé',ok:true}]); } catch{} }
    await client.post("/import/spoolnymous", { url });
    // Polling toutes les 800ms
    pollRef.current = setInterval(async () => {
      const r = await client.get("/import/spoolnymous/status");
      setSteps(r.data.steps || []);
      if (r.data.done) {
        setRunning(false); setDone(true);
        clearInterval(pollRef.current);
      }
    }, 800);
  };

  React.useEffect(() => () => clearInterval(pollRef.current), []);

  const inp = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
    padding:"8px 12px", fontSize:13, color:"var(--text)", outline:"none", width:"100%", boxSizing:"border-box" };

  return (
    <div className="card" style={{ padding:"16px" }}>
      <h3 style={{ fontSize:13, fontWeight:700, color:"var(--text)", margin:"0 0 12px" }}>
        📦 Importer depuis Spoolnymous
      </h3>

      <div style={{ display:"flex", gap:8, marginBottom:10 }}>
        <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="http://192.168.1.42:7913"
          style={{ ...inp, flex:1 }}/>
        <button onClick={ping}
          style={{ padding:"8px 14px", borderRadius:8, border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--text)", fontSize:12, cursor:"pointer", flexShrink:0 }}>
          Ping
        </button>
      </div>

      {pingInfo && (
        <div style={{ background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.2)",
          borderRadius:8, padding:"8px 12px", marginBottom:10, fontSize:11, color:"#22c55e" }}>
          ✓ Connecté · DB {pingInfo.db_size_mb} Mo · {pingInfo.prints_files} vignettes · {pingInfo.uploads_files} uploads
        </div>
      )}

      <div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)",
        borderRadius:8, padding:"8px 12px", marginBottom:10, fontSize:11, color:"#ef4444" }}>
        ⚠️ <strong>Recommandé :</strong> Vider BambuNymous avant l'import pour éviter les conflits d'IDs.
        <label style={{ display:"flex", alignItems:"center", gap:6, marginTop:6, cursor:"pointer" }}>
          <input type="checkbox" checked={doReset} onChange={e=>setDoReset(e.target.checked)}/>
          <span>Vider automatiquement avant l'import</span>
        </label>
      </div>

      <button onClick={start} disabled={running || !url}
        style={{ width:"100%", padding:"10px", borderRadius:10, border:"none", cursor:running?"wait":"pointer",
          background: running ? "var(--surface2)" : "#3b82f6",
          color: running ? "var(--muted)" : "white", fontSize:13, fontWeight:700 }}>
        {running ? "Import en cours…" : "🚀 Lancer l'import complet"}
      </button>

      {(steps.length > 0) && (
        <div style={{ marginTop:12, background:"var(--surface2)", borderRadius:8,
          padding:"10px 12px", fontSize:12, fontFamily:"monospace",
          maxHeight:280, overflowY:"auto" }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display:"flex", gap:8, marginBottom:3, color: s.ok ? "var(--text)" : "#ef4444" }}>
              <span>{s.ok ? "✓" : "✗"}</span>
              <span>{s.msg}</span>
            </div>
          ))}
          {running && <div style={{ color:"var(--muted)", marginTop:4 }}>⏳ En attente…</div>}
          {done && <div style={{ color:"#22c55e", fontWeight:700, marginTop:6 }}>✅ Import terminé !</div>}
        </div>
      )}
    </div>
  );
}
