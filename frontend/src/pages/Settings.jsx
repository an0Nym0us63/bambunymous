import React, { useState, useEffect } from "react";
import { Save, Wifi, RefreshCw, Sun, Moon, Users, KeyRound, Trash2, Activity } from "lucide-react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import HeaderAction from "../components/HeaderAction";
import { usePrinter } from "../store/printer";
import { useTheme } from "../useTheme";
import { useAuth, useIsAdmin, ROLE_ADMIN, ROLE_READONLY,
         ROLE_OPTIONS, ROLE_LABEL, ROLE_BADGE } from "../store/auth";
import AdminOnly from "../components/AdminOnly";
import { useTrackDetail } from "../utils/track";

const inp = {
  width:"100%", background:"var(--surface2)", border:"1px solid var(--border)",
  borderRadius:10, padding:"8px 12px", fontSize:14, color:"var(--text)",
  outline:"none", transition:"border-color 0.15s", boxSizing:"border-box",
};
const lbl = {
  display:"block", fontSize:11, color:"var(--muted)", marginBottom:6,
  textTransform:"uppercase", letterSpacing:"0.05em",
};

// Le backend renvoie des datetime UTC *naifs* ("2026-07-18 21:24:33.123456").
// Sans le T ni le Z, Safari refuse de les parser et les autres moteurs les
// lisent en heure locale : le journal aurait affiche deux heures de decalage
// sans rien signaler.
function parseUTC(t) {
  if (!t) return null;
  const s = String(t).trim();
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  const d = new Date(s.replace(" ", "T") + (hasTz ? "" : "Z"));
  return isNaN(d.getTime()) ? null : d;
}

// Duree relative : sur une fenetre de 7 jours c'est plus parlant qu'une date.
function ago(t) {
  const d = parseUTC(t);
  if (!d) return null;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)    return "à l'instant";
  if (s < 3600)  return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const j = Math.floor(s / 86400);
  return j === 1 ? "hier" : `il y a ${j} j`;
}

function stamp(t) {
  const d = parseUTC(t);
  return d ? d.toLocaleString("fr-FR", { day:"2-digit", month:"2-digit",
    hour:"2-digit", minute:"2-digit" }) : "";
}
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


// ── Mon compte : changer son propre mot de passe (tous les roles) ──────────
function MyAccountSection() {
  const username = useAuth((s) => s.username);
  const role     = useAuth((s) => s.role);
  const [f, setF] = React.useState({ current:"", next:"", confirm:"" });
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg]   = React.useState(null);

  const inp = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
    padding:"8px 12px", fontSize:13, color:"var(--text)", outline:"none", width:"100%", boxSizing:"border-box" };
  const lbl = { fontSize:10, color:"var(--muted)", textTransform:"uppercase",
    letterSpacing:"0.05em", marginBottom:4, display:"block" };

  const submit = async () => {
    setMsg(null);
    if (f.next.length < 4)      return setMsg({ err:true, t:"Mot de passe trop court (4 caractères minimum)" });
    if (f.next !== f.confirm)   return setMsg({ err:true, t:"La confirmation ne correspond pas" });
    setBusy(true);
    try {
      await client.post("/auth/change-password", { current_password: f.current, new_password: f.next });
      setF({ current:"", next:"", confirm:"" });
      setMsg({ err:false, t:"Mot de passe modifié." });
    } catch(e) {
      setMsg({ err:true, t: e.response?.data?.detail || e.message });
    }
    setBusy(false);
  };

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 4px",
        display:"flex", alignItems:"center", gap:7 }}>
        <KeyRound size={15}/> Mon compte
      </h3>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 14px" }}>
        {username ? <b>{username}</b> : "Compte courant"}
        {" — "}
        {(ROLE_LABEL[role] || ROLE_LABEL[ROLE_ADMIN]).toLowerCase()}
      </p>
      <div style={{ display:"flex", flexDirection:"column", gap:10, maxWidth:360 }}>
        <div><label style={lbl}>Mot de passe actuel</label>
          <input style={inp} type="password" value={f.current}
            onChange={e=>setF(v=>({...v,current:e.target.value}))}/></div>
        <div><label style={lbl}>Nouveau mot de passe</label>
          <input style={inp} type="password" value={f.next}
            onChange={e=>setF(v=>({...v,next:e.target.value}))}/></div>
        <div><label style={lbl}>Confirmer</label>
          <input style={inp} type="password" value={f.confirm}
            onChange={e=>setF(v=>({...v,confirm:e.target.value}))}/></div>
        {msg && <p style={{ fontSize:12, margin:0, color: msg.err ? "#ef4444" : "#22c55e" }}>{msg.t}</p>}
        <button onClick={submit} disabled={busy || !f.current || !f.next}
          style={{ padding:"9px 18px", borderRadius:10, border:"none", background:"#3b82f6",
            color:"white", fontSize:13, fontWeight:700, alignSelf:"flex-start",
            cursor:(busy||!f.current||!f.next)?"not-allowed":"pointer",
            opacity:(busy||!f.current||!f.next)?0.6:1 }}>
          {busy ? "Modification…" : "Changer le mot de passe"}
        </button>
      </div>
    </div>
  );
}

// ── Utilisateurs (administrateurs seulement) ──────────────────────────────
function UsersSection() {
  const isAdmin = useIsAdmin();
  const meName  = useAuth((s) => s.username);
  const [list, setList]   = React.useState(null);
  const [busy, setBusy]   = React.useState(false);
  const [err, setErr]     = React.useState(null);
  const [creating, setCreating] = React.useState(false);
  const [nf, setNf] = React.useState({ username:"", password:"", role: ROLE_READONLY });
  const [confirmDel, setConfirmDel] = React.useState(null);
  const [pwdFor, setPwdFor] = React.useState(null);   // id du compte dont on change le mdp
  const [pwdVal, setPwdVal] = React.useState("");

  const load = React.useCallback(async () => {
    try { const { data } = await client.get("/users"); setList(data); setErr(null); }
    catch(e) { setList([]); setErr(e.response?.status === 403 ? null : (e.response?.data?.detail || e.message)); }
  }, []);
  React.useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (!isAdmin) return null;

  const inp = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
    padding:"8px 12px", fontSize:13, color:"var(--text)", outline:"none", width:"100%", boxSizing:"border-box" };

  // Pastilles d'action, meme grammaire que partout ailleurs dans l'application
  // (bouton Journal du header, filtres du journal d'activite) : forme arrondie,
  // fond transparent, contour fin, couleur porteuse de sens. Les boutons
  // precedents etaient des paves opaques en var(--bg), plus lourds que le
  // contenu qu'ils accompagnaient et etrangers au reste de l'interface.
  const pill = (color, border) => ({
    padding:"4px 11px", borderRadius:20, fontSize:11, fontWeight:600,
    cursor:"pointer", background:"transparent", whiteSpace:"nowrap",
    border:`1px solid ${border || "var(--border)"}`, color,
  });

  const act = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); await load(); }
    catch(e) { setErr(e.response?.data?.detail || e.message); }
    setBusy(false);
  };

  const create = () => act(async () => {
    await client.post("/users", { username: nf.username.trim(), password: nf.password, role: nf.role });
    setNf({ username:"", password:"", role: ROLE_READONLY }); setCreating(false);
  });

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 4px",
        display:"flex", alignItems:"center", gap:7 }}>
        <Users size={15}/> Utilisateurs
      </h3>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 14px" }}>
        Un compte <b>administrateur</b> a tous les droits. Un compte <b>lecture seule (avec
        prix)</b> consulte tout, montants compris, sans rien pouvoir modifier. Un compte <b>lecture seule</b> peut
        tout consulter, sans aucune modification, et les montants lui sont masqués.
      </p>

      {err && <p style={{ fontSize:12, color:"#ef4444", margin:"0 0 10px" }}>{err}</p>}

      {list === null ? (
        <p style={{ fontSize:12, color:"var(--muted)" }}>Chargement…</p>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:12 }}>
          {list.map(u => (
            <div key={u.id} style={{ background:"var(--surface2)", border:"1px solid var(--border)",
              borderRadius:10, padding:"10px 12px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                <span style={{ fontSize:13, fontWeight:700, flex:1, minWidth:100 }}>
                  {u.username}{u.username === meName ? " (vous)" : ""}
                </span>
                <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20,
                  background: u.role === ROLE_ADMIN ? "rgba(59,130,246,0.12)" : "rgba(148,163,184,0.15)",
                  color: u.role === ROLE_ADMIN ? "#60a5fa" : "#94a3b8" }}>
                  {ROLE_BADGE[u.role] || u.role}
                </span>
                {u.protected && (
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20,
                    background:"rgba(245,158,11,0.12)", color:"#f59e0b" }}>Principal</span>
                )}
                {!u.active && (
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20,
                    background:"rgba(239,68,68,0.12)", color:"#ef4444" }}>Désactivé</span>
                )}
              </div>
              {/* Derniere utilisation : elle a sa place ici, aupres du compte,
                  plutot que dans une seconde liste de comptes ailleurs. */}
              <p style={{ fontSize:11, color:"var(--muted)", margin:"4px 0 0" }}>
                {u.last_seen ? `Vu ${ago(u.last_seen)} · ${stamp(u.last_seen)}` : "Jamais utilisé"}
              </p>
              <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap" }}>
                {/* Le compte principal et le sien propre ne sont pas modifiables
                    (hors mot de passe) : on evite de se couper l'acces. */}
                {!u.protected && u.username !== meName && (<>
                {/* Avec trois roles, la bascule binaire n'a plus de sens : on
                    propose les roles autres que le sien. */}
                {ROLE_OPTIONS.filter(([r]) => r !== u.role).map(([r,l]) => (
                  <button key={r} disabled={busy}
                    onClick={()=>act(()=>client.patch(`/users/${u.id}`, { role: r }))}
                    style={pill("#60a5fa", "rgba(59,130,246,0.35)")}>
                    → {l}
                  </button>
                ))}
                <button disabled={busy} onClick={()=>act(()=>client.patch(`/users/${u.id}`, { active: !u.active }))}
                  style={u.active ? pill("#f59e0b", "rgba(245,158,11,0.35)")
                                  : pill("#22c55e", "rgba(34,197,94,0.35)")}>
                  {u.active ? "Désactiver" : "Réactiver"}
                </button>
                <button disabled={busy}
                  onClick={()=> confirmDel === u.id
                    ? act(async ()=>{ await client.delete(`/users/${u.id}`); setConfirmDel(null); })
                    : setConfirmDel(u.id)}
                  style={{ ...pill("#ef4444", "rgba(239,68,68,0.35)"),
                    // Seule exception au fond transparent : une fois armee, la
                    // suppression doit se distinguer nettement du reste.
                    ...(confirmDel === u.id
                      ? { background:"#ef4444", color:"white", borderColor:"#ef4444" }
                      : {}) }}>
                  {confirmDel === u.id ? "Confirmer ?" : <Trash2 size={12}/>}
                </button>
                </>)}
                <button disabled={busy} onClick={()=>{ setPwdFor(pwdFor===u.id?null:u.id); setPwdVal(""); }}
                  style={pill("var(--muted)")}>
                  Mot de passe
                </button>
              </div>
              {pwdFor === u.id && (
                <div style={{ display:"flex", gap:6, marginTop:8 }}>
                  <input style={{ ...inp, flex:1 }} type="password" placeholder="Nouveau mot de passe"
                    value={pwdVal} onChange={e=>setPwdVal(e.target.value)}/>
                  <button disabled={busy || pwdVal.length < 4}
                    onClick={()=>act(async ()=>{ await client.patch(`/users/${u.id}`, { password: pwdVal });
                      setPwdFor(null); setPwdVal(""); })}
                    style={{ padding:"8px 14px", borderRadius:8, border:"none", background:"#3b82f6",
                      color:"white", fontSize:12, fontWeight:700,
                      cursor: pwdVal.length < 4 ? "not-allowed" : "pointer",
                      opacity: pwdVal.length < 4 ? 0.6 : 1 }}>OK</button>
                </div>
              )}
            </div>
          ))}
          {list.length === 0 && (
            <p style={{ fontSize:12, color:"var(--muted)" }}>Aucun compte enregistré.</p>
          )}
        </div>
      )}

      {!creating ? (
        <button onClick={()=>setCreating(true)}
          style={{ padding:"8px 16px", borderRadius:10, border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--text)", fontSize:12, fontWeight:700,
            cursor:"pointer" }}>+ Nouvel utilisateur</button>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:8, maxWidth:360 }}>
          <input style={inp} placeholder="Nom d'utilisateur" value={nf.username}
            onChange={e=>setNf(v=>({...v,username:e.target.value}))}/>
          <input style={inp} type="password" placeholder="Mot de passe" value={nf.password}
            onChange={e=>setNf(v=>({...v,password:e.target.value}))}/>
          {/* En colonne : a trois options, les libelles ne tiennent plus cote
              a cote sur un ecran de telephone. */}
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {ROLE_OPTIONS.map(([r,l])=>(
              <button key={r} onClick={()=>setNf(v=>({...v,role:r}))}
                style={{ padding:"8px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
                  textAlign:"left",
                  border:"1px solid " + (nf.role===r ? "#3b82f6" : "var(--border)"),
                  background: nf.role===r ? "rgba(59,130,246,0.12)" : "var(--surface2)",
                  color: nf.role===r ? "#60a5fa" : "var(--muted)" }}>{l}</button>
            ))}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>{ setCreating(false); setErr(null); }}
              style={{ flex:1, padding:"9px", borderRadius:10, border:"1px solid var(--border)",
                background:"var(--surface2)", color:"var(--muted)", fontSize:12, cursor:"pointer" }}>Annuler</button>
            <button onClick={create} disabled={busy || !nf.username.trim() || nf.password.length < 4}
              style={{ flex:2, padding:"9px", borderRadius:10, border:"none", background:"#3b82f6",
                color:"white", fontSize:12, fontWeight:700,
                cursor:(!nf.username.trim()||nf.password.length<4)?"not-allowed":"pointer",
                opacity:(busy||!nf.username.trim()||nf.password.length<4)?0.6:1 }}>Créer</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Couleur par methode : on lit la nature de l'action avant meme son libelle.
const METHOD_STYLE = {
  POST:   ["#22c55e", "rgba(34,197,94,0.12)"],
  PUT:    ["#3b82f6", "rgba(59,130,246,0.12)"],
  PATCH:  ["#3b82f6", "rgba(59,130,246,0.12)"],
  DELETE: ["#ef4444", "rgba(239,68,68,0.12)"],
};
const ACT_PAGE = 50;
const ACT_KINDS = [["", "Tout"], ["action", "Actions"],
                   ["visite", "Pages"], ["detail", "Détails"]];
const KIND_STYLE = {
  visite: ["#a78bfa", "rgba(167,139,250,0.12)", "PAGE"],
  detail: ["#22d3ee", "rgba(34,211,238,0.12)", "VUE"],
};
// Fenetres proposees. Celles qui depassent la duree de conservation renvoyee
// par l'API sont retirees : promettre 30 jours quand la purge en garde 7
// n'aurait affiche que du vide.
const ACT_WINDOWS = [[1,"24 h"],[7,"7 jours"],[30,"30 jours"],[90,"90 jours"]];

function ActivitySection() {
  const isAdmin = useIsAdmin();
  const [days,  setDays]  = React.useState(7);
  const [who,   setWho]   = React.useState("");
  const [kind,  setKind]  = React.useState("");
  const [q,     setQ]     = React.useState("");     // saisie
  const [query, setQuery] = React.useState("");     // terme effectivement envoye
  const [items, setItems] = React.useState(null);
  const [total, setTotal] = React.useState(0);
  const [keep,  setKeep]  = React.useState(null);   // duree de conservation
  const [names, setNames] = React.useState([]);
  const [busy,  setBusy]  = React.useState(false);
  const [err,   setErr]   = React.useState(null);
  const [purge, setPurge] = React.useState(false);   // confirmation en deux temps

  const load = React.useCallback(async (offset = 0) => {
    setBusy(true); setErr(null);
    try {
      const { data } = await client.get("/users/activity", {
        params: { days, username: who || undefined, kind: kind || undefined,
                  q: query || undefined, limit: ACT_PAGE, offset },
      });
      setTotal(data.total || 0);
      if (data.retention_days) setKeep(data.retention_days);
      // offset 0 = nouveau filtre, on repart de zero ; sinon on empile.
      setItems(prev => offset === 0 ? (data.items || []) : [...(prev || []), ...(data.items || [])]);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
      if (offset === 0) setItems([]);
    }
    setBusy(false);
  }, [days, who, kind, query]);

  React.useEffect(() => { if (isAdmin) load(0); }, [isAdmin, load]);
  // Recherche differee : sans ce delai, chaque touche frappee declencherait un
  // appel et la liste sauterait sous les doigts.
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  React.useEffect(() => {
    if (!isAdmin) return;
    client.get("/users")
      .then(r => setNames((r.data || []).map(u => u.username)))
      .catch(() => {});   // le filtre reste utilisable sans la liste
  }, [isAdmin]);

  if (!isAdmin) return null;

  const chip = (on) => ({
    padding:"5px 10px", borderRadius:8, fontSize:11, fontWeight:600, cursor:"pointer",
    border:"1px solid " + (on ? "#3b82f6" : "var(--border)"),
    background: on ? "rgba(59,130,246,0.12)" : "var(--surface2)",
    color: on ? "#60a5fa" : "var(--muted)",
  });

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 4px",
        display:"flex", alignItems:"center", gap:7 }}>
        <Activity size={15}/> Activité
        {/* Discret et a l'ecart des filtres : c'est une action irreversible,
            elle ne doit pas se trouver sous un doigt qui trie. */}
        <button disabled={busy}
          onClick={() => purge
            ? (async () => {
                setBusy(true);
                try { await client.delete("/users/activity"); setPurge(false); await load(0); }
                catch (e) { setErr(e.response?.data?.detail || e.message); }
                setBusy(false);
              })()
            : setPurge(true)}
          onBlur={() => setPurge(false)}
          style={{ marginLeft:"auto", padding:"3px 9px", borderRadius:7, fontSize:10,
            fontWeight:600, cursor:"pointer", border:"1px solid var(--border)",
            background: purge ? "#ef4444" : "transparent",
            color: purge ? "white" : "var(--muted)" }}>
          {purge ? "Confirmer ?" : "Vider"}
        </button>
      </h3>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 14px" }}>
        <b>Actions</b> : créations, modifications, suppressions. <b>Pages</b> : arrivée sur
        une page. <b>Détails</b> : onglet ouvert ou fiche consultée. Les vues ne sont
        enregistrées qu'au changement, jamais en continu.
        {keep ? ` Le journal est purgé au-delà de ${keep} jours.` : ""}
      </p>

      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
        {ACT_KINDS.map(([k,l]) => (
          <button key={k} onClick={()=>setKind(k)} style={chip(kind===k)}>{l}</button>
        ))}
      </div>

      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
        {ACT_WINDOWS.filter(([d]) => !keep || d <= keep).map(([d,l]) => (
          <button key={d} onClick={()=>setDays(d)} style={chip(days===d)}>{l}</button>
        ))}
        <input value={q} onChange={e=>setQ(e.target.value)}
          placeholder="Rechercher un libellé…"
          style={{ ...inp, width:"auto", flex:"1 1 140px", minWidth:120,
            fontSize:12, padding:"5px 10px" }}/>
        <select value={who} onChange={e=>setWho(e.target.value)}
          style={{ ...chip(!!who), marginLeft:"auto", maxWidth:150 }}>
          <option value="">Tous les comptes</option>
          {names.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {err && <p style={{ fontSize:12, color:"#ef4444", margin:"0 0 10px" }}>{err}</p>}

      {items === null ? (
        <p style={{ fontSize:12, color:"var(--muted)" }}>Chargement…</p>
      ) : items.length === 0 ? (
        <p style={{ fontSize:12, color:"var(--muted)" }}>Aucune action sur cette période.</p>
      ) : (
        <>
          <div style={{ display:"flex", flexDirection:"column", gap:4,
            maxHeight:420, overflowY:"auto" }}>
            {items.map(it => {
              const view = it.kind === "visite" || it.kind === "detail";
              const [fg, bg, tag] = KIND_STYLE[it.kind]
                || [...(METHOD_STYLE[it.method] || ["#94a3b8","rgba(148,163,184,0.15)"]), it.method];
              const ko = it.status >= 400;
              return (
                <div key={it.id} style={{ display:"flex", alignItems:"flex-start", gap:8,
                  background:"var(--surface2)", border:"1px solid var(--border)",
                  borderRadius:10, padding:"8px 10px" }}>
                  <span style={{ fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:6,
                    background:bg, color:fg, flexShrink:0, marginTop:1 }}>{tag}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:12, fontWeight:600,
                      color: view ? "var(--text2)" : "var(--text)" }}>
                      {it.kind === "visite" ? `Page ${it.label}` : (it.label || it.path)}
                    </p>
                    {/* Le chemin n'apprend rien sur une vue : le libelle dit
                        deja tout, l'afficher ferait du bruit. */}
                    {!view && (
                      <p style={{ margin:"1px 0 0", fontSize:10, color:"var(--muted)",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {it.path}{ko ? ` · échec ${it.status}` : ""}
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <p style={{ margin:0, fontSize:11, fontWeight:600, color:"var(--text2)" }}>
                      {it.username}
                    </p>
                    <p style={{ margin:"1px 0 0", fontSize:10, color:"var(--muted)" }}>
                      {stamp(it.at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:10 }}>
            <span style={{ fontSize:11, color:"var(--muted)" }}>
              {items.length} sur {total}
            </span>
            {items.length < total && (
              <button disabled={busy} onClick={()=>load(items.length)}
                style={{ marginLeft:"auto", padding:"5px 12px", borderRadius:20, fontSize:11,
                  fontWeight:600, cursor:"pointer", border:"1px solid var(--border)",
                  background:"transparent", color:"var(--muted)" }}>
                {busy ? "Chargement…" : "Charger plus"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RfidDebugSection() {
  // Visible seulement dans la coquille WebView (window.BambuScan present).
  const isWebView = typeof window !== "undefined" && !!window.BambuScan;
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState(null);

  if (!isWebView) return null;

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await client.get("/rfid/scan/last-debug");
      setData(r.data);
    } catch(e) {
      setErr(e.response?.status === 404
        ? "Aucun scan en mémoire. Scannez un tag d'abord (via le scanner), puis revenez ici."
        : (e.response?.data?.detail || e.message));
    } finally { setLoading(false); }
  };

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>
        Débug RFID
      </h3>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 14px" }}>
        Affiche le détail brut du dernier tag scanné (payload, champs parsés,
        correspondance catalogue, profil résolu). Utile pour vérifier un profil
        quand un scan ouvre directement la fiche d'une bobine existante. Scannez un
        tag, puis appuyez ici.
      </p>
      <button onClick={load} disabled={loading}
        style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:700, cursor:loading?"wait":"pointer",
          border:"none", background:"#3b82f6", color:"white" }}>
        {loading ? "Lecture…" : "Voir le dernier scan"}
      </button>

      {err && <p style={{ fontSize:12, color:"#ef4444", margin:"12px 0 0" }}>{err}</p>}

      {data && (
        <div style={{ marginTop:14 }}>
          {/* Résumé lisible des champs utiles */}
          <div style={{ background:"var(--surface2)", borderRadius:10, padding:"10px 12px", marginBottom:10 }}>
            {[
              ["Tag UID", data.normalized?.tray_uid],
              ["Material ID", data.normalized?.material_id],
              ["Variant ID", data.normalized?.variant_id],
              ["Profil résolu", data.resolved_filament?.profile_id],
              ["Filament", data.resolved_filament?.name],
              ["Matière", data.resolved_filament?.material],
              ["Sous-type", data.resolved_filament?.fila_type],
              ["Catalogue", data.catalog_match ? "trouvé" : "aucun"],
              ["Bobine liée", data.already_linked_spool ? `#${data.already_linked_spool.spool_id}` : "non"],
            ].map(([k,v]) => (
              <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0",
                fontSize:12, borderBottom:"1px solid var(--border)" }}>
                <span style={{ color:"var(--muted)" }}>{k}</span>
                <span style={{ color:"var(--text)", fontFamily:"monospace", textAlign:"right", maxWidth:"60%",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{v || "—"}</span>
              </div>
            ))}
          </div>
          {/* JSON brut complet, repliable */}
          <details>
            <summary style={{ fontSize:12, color:"#60a5fa", cursor:"pointer", marginBottom:8 }}>
              Données brutes (JSON)
            </summary>
            <pre style={{ fontSize:10, color:"var(--text)", background:"var(--bg)", padding:12,
              borderRadius:8, overflow:"auto", maxHeight:300, margin:0,
              fontFamily:"JetBrains Mono, monospace", whiteSpace:"pre-wrap", wordBreak:"break-all" }}>
{JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function TranslateNamesSection() {
  const [running, setRunning] = React.useState(null);   // null = pas encore su
  const [err, setErr] = React.useState(null);

  // L'etat vit sur le serveur, pas ici : c'est lui qui fait tourner le thread.
  // On l'interroge en arrivant, puis toutes les 5 s tant qu'il tourne. Quitter
  // la page, y revenir ou recharger l'application retrouve donc toujours
  // l'etat reel -- ce qu'une boucle cliente ne permettait pas.
  const poll = React.useCallback(async () => {
    try {
      const { data } = await client.get("/prints/translate-missing");
      setRunning(!!data.running);
      return !!data.running;
    } catch { setRunning(false); return false; }
  }, []);

  React.useEffect(() => {
    let alive = true, timer = null;
    const tick = async () => {
      const on = await poll();
      if (alive && on) timer = setTimeout(tick, 5000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [poll]);

  const act = async (stop) => {
    setErr(null);
    try {
      await client.post("/prints/translate-missing", null, { params: { stop } });
      setRunning(!stop);
      if (!stop) setTimeout(poll, 5000);
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
  };

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>
        Traduire les noms de prints
      </h3>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 14px" }}>
        Les prints arrivent nommés en anglais ou en chinois : ce rattrapage leur ajoute
        un nom français, utilisé <b>uniquement pour la recherche</b> — le nom d'origine
        reste affiché. Les noms saisis à la main ne sont jamais écrasés. Les nouveaux
        prints sont traduits automatiquement, ce bouton ne sert qu'à l'existant.
      </p>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <button onClick={() => act(running)} disabled={running === null}
          style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:700,
            cursor: running === null ? "wait" : "pointer", border:"none",
            background: running ? "var(--border)" : "#3b82f6",
            color: running ? "var(--text)" : "white" }}>
          {running ? "Arrêter" : "⟳ Traduire les noms manquants"}
        </button>
        {running && (
          <span style={{ display:"flex", alignItems:"center", gap:7, fontSize:12,
            color:"#3b82f6", fontWeight:600 }}>
            {/* Le rattrapage dure plusieurs minutes sans rien afficher : il
                faut un signe de vie, sinon on le croit bloque. */}
            <span style={{ width:8, height:8, borderRadius:"50%", background:"#3b82f6",
              animation:"pulse 1.2s ease-in-out infinite" }}/>
            Traduction en cours…
          </span>
        )}
        {err && <span style={{ fontSize:12, color:"#ef4444" }}>{err}</span>}
      </div>
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




// ── Points d'attention ─────────────────────────────────────────────────────
/**
 * Une seule carte pour les trois écrans liés aux alertes : ils étaient éclatés
 * en trois cartes distinctes alors qu'ils traitent du même sujet.
 */
function AttentionCard({ card, cardTitle }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="card" style={card}>
      <div style={cardTitle}>Points d'attention</div>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 12px" }}>
        Choisis l'ordre des catégories sur l'accueil, et masque celles qui ne
        t'intéressent pas. La liste des alertes, elle, s'ouvre depuis l'accueil.
      </p>
      <button type="button" onClick={() => setOpen(true)}
        style={{ padding:"9px 14px", borderRadius:8, border:"none", cursor:"pointer",
          background:"#3b82f6", color:"white", fontSize:12, fontWeight:700 }}>
        Organiser les catégories…
      </button>

      {open && <CategoriesModal onClose={() => setOpen(false)}/>}
    </div>
  );
}


/**
 * Ordre et masquage des catégories.
 *
 * Glisser-déposer via les POINTER EVENTS, et non l'API drag-and-drop HTML5 :
 * cette dernière ne fonctionne tout simplement pas au tactile. Elle aurait été
 * inutilisable sur mobile, là où l'appli sert le plus.
 */
function CategoriesModal({ onClose }) {
  const [rows, setRows]   = React.useState(null);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy]   = React.useState(false);
  const [err, setErr]     = React.useState(null);
  const [dragIdx, setDragIdx] = React.useState(null);

  const listRef = React.useRef(null);
  const dragRef = React.useRef(null);   // index en cours de deplacement
  const rowsRef = React.useRef(null);   // dernier etat, lisible depuis les listeners

  React.useEffect(() => {
    client.get("/attention/categories")
      .then(r => setRows(r.data?.categories || []))
      .catch(e => setErr(e.response?.data?.detail || e.message));
  }, []);
  React.useEffect(() => { rowsRef.current = rows; }, [rows]);

  /**
   * Reordonnancement au pointeur.
   *
   * Deux pieges evites ici :
   *  - les listeners sont poses sur le DOCUMENT, pas sur la liste : pendant le
   *    geste, React reordonne les noeuds, et un handler attache a la ligne
   *    deplacee peut cesser de recevoir les evenements.
   *  - la cible est calculee a partir des rectangles REELS de chaque ligne, pas
   *    d'une hauteur supposee uniforme : les libelles passent a la ligne, donc
   *    les hauteurs different.
   */
  const startDrag = (clientY0, i) => {
    dragRef.current = i;
    setDragIdx(i);

    const moveTo = (y) => {
      const from = dragRef.current;
      const list = listRef.current;
      const cur = rowsRef.current;
      if (from == null || !list || !cur) return;

      let to = from;
      const n = list.children.length;
      for (let k = 0; k < n; k++) {
        const r = list.children[k].getBoundingClientRect();
        if (y >= r.top && y <= r.bottom) { to = k; break; }
        if (k === 0 && y < r.top) { to = 0; break; }
        if (k === n - 1 && y > r.bottom) { to = k; break; }
      }
      if (to === from) return;

      const next = [...cur];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      rowsRef.current = next;
      setRows(next);
      dragRef.current = to;
      setDragIdx(to);
      setDirty(true);
    };

    const onPointerMove = (ev) => moveTo(ev.clientY);

    // Le tactile est traite EN PLUS des pointer events. Sur mobile, le navigateur
    // demarre un defilement des que le doigt bouge et emet alors un pointercancel :
    // le drag mourait aussitot. touchAction:none ne suffisait pas. Ici on ecoute
    // touchmove en NON PASSIF pour pouvoir appeler preventDefault() et empecher
    // reellement le defilement pendant le geste.
    const onTouchMove = (ev) => {
      if (ev.cancelable) ev.preventDefault();
      const t = ev.touches[0];
      if (t) moveTo(t.clientY);
    };

    const stop = () => {
      dragRef.current = null;
      setDragIdx(null);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", stop);
      document.removeEventListener("touchcancel", stop);
      document.body.style.overflow = prevOverflow;
    };

    // Verrouiller le defilement de la page pendant le geste
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", stop);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", stop);
    document.addEventListener("touchcancel", stop);

    if (clientY0 != null) moveTo(clientY0);
  };

  const toggleHidden = (cat) => {
    setRows(rs => rs.map(r => r.category === cat ? { ...r, hidden: !r.hidden } : r));
    setDirty(true);
  };

  const move = (i, dir) => {
    const j = i + dir;
    if (!rows || j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
    setDirty(true);
  };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await client.put("/attention/categories", {
        order:  rows.map(r => r.category),
        hidden: rows.filter(r => r.hidden).map(r => r.category),
      });
      setDirty(false);
      onClose();
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9999,
      background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center",
      justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:480,
        maxHeight:"86vh", display:"flex", flexDirection:"column",
        background:"var(--sheet-bg)", borderRadius:16, overflow:"hidden" }}>

        <div style={{ padding:"12px 16px", display:"flex", alignItems:"center", gap:10 }}>
          <p style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:0, flex:1 }}>
            Catégories de l'accueil
          </p>
          <button type="button" onClick={onClose}
            style={{ background:"none", border:"none", color:"var(--muted)",
              fontSize:18, cursor:"pointer" }}>✕</button>
        </div>
        <p style={{ margin:0, padding:"0 16px 10px", fontSize:11, color:"var(--muted)" }}>
          Fais glisser la poignée (ou utilise les flèches) pour réordonner. L'œil
          masque une catégorie de l'accueil — elle reste consultable dans la liste
          des alertes.
        </p>

        {err && <p style={{ margin:0, padding:"0 16px 8px", fontSize:12, color:"#ef4444" }}>⚠ {err}</p>}

        <div ref={listRef} style={{ flex:1, overflowY:"auto", padding:"0 12px 8px" }}>
          {!rows ? (
            <p style={{ fontSize:12, color:"var(--muted)", padding:12, margin:0 }}>Chargement…</p>
          ) : rows.map((r, i) => (
            <div key={r.category}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 8px",
                borderRadius:8, marginBottom:4,
                background: dragIdx === i ? "rgba(59,130,246,0.18)" : "var(--surface2)",
                opacity: r.hidden ? 0.45 : 1,
                boxShadow: dragIdx === i ? "0 4px 14px rgba(0,0,0,0.28)" : "none" }}>

              {/* touchAction:none est indispensable : sans lui le navigateur
                  interprete le geste comme un defilement et le drag ne demarre
                  jamais au doigt. */}
              {/* Poignee : on ecoute le pointeur ET le tactile. Le pointercancel
                  emis par le navigateur au demarrage d'un defilement tuait le
                  drag sur mobile ; le chemin tactile, lui, bloque le defilement.
                  Zone de touche elargie (padding) pour etre attrapable au doigt. */}
              <span
                onPointerDown={e => { if (e.pointerType !== "touch") startDrag(e.clientY, i); }}
                onTouchStart={e => startDrag(e.touches[0]?.clientY, i)}
                style={{ cursor:"grab", touchAction:"none", color:"var(--muted)",
                  fontSize:16, flexShrink:0, padding:"6px 8px", margin:"-6px 0",
                  userSelect:"none", WebkitUserSelect:"none",
                  WebkitTouchCallout:"none" }}>⠿</span>

              <span style={{ fontSize:13, flexShrink:0 }}>{r.icon}</span>

              {/* Libelle jamais tronque : c'est la seule chose qui dit ce qu'on deplace. */}
              <span style={{ flex:1, fontSize:12, fontWeight:600, color:"var(--text)",
                whiteSpace:"normal", wordBreak:"break-word", lineHeight:1.3 }}>
                {r.label}
              </span>

              {/* Fleches conservees : sur certains navigateurs mobiles le drag
                  reste capricieux, et il faut toujours un moyen sur d'y arriver. */}
              <div style={{ display:"flex", flexDirection:"column", flexShrink:0 }}>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                  style={{ background:"none", border:"none", cursor: i === 0 ? "default" : "pointer",
                    color: i === 0 ? "var(--border)" : "var(--muted)", fontSize:9,
                    lineHeight:1, padding:"1px 3px" }}>▲</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                  style={{ background:"none", border:"none",
                    cursor: i === rows.length - 1 ? "default" : "pointer",
                    color: i === rows.length - 1 ? "var(--border)" : "var(--muted)", fontSize:9,
                    lineHeight:1, padding:"1px 3px" }}>▼</button>
              </div>

              <button type="button" onClick={() => toggleHidden(r.category)}
                title={r.hidden ? "Afficher sur l'accueil" : "Masquer de l'accueil"}
                style={{ flexShrink:0, background:"none", border:"none", cursor:"pointer",
                  fontSize:14, padding:"0 2px" }}>
                {r.hidden ? "🚫" : "👁"}
              </button>
            </div>
          ))}
        </div>

        <div style={{ padding:"12px 16px", display:"flex", gap:8 }}>
          <button type="button" onClick={onClose}
            style={{ flex:1, padding:"9px", borderRadius:8, border:"1px solid var(--border)",
              background:"none", color:"var(--muted)", fontSize:12, cursor:"pointer" }}>
            Annuler
          </button>
          <button type="button" onClick={save} disabled={!dirty || busy}
            style={{ flex:2, padding:"9px", borderRadius:8, border:"none",
              background: dirty ? "#3b82f6" : "var(--border)",
              color: dirty ? "white" : "var(--muted)", fontSize:12, fontWeight:700,
              cursor: dirty ? "pointer" : "default" }}>
            {busy ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>
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
      const blob = new Blob([r.data], { type: "application/pdf" });
      const fileName = "etiquettes-filaments.pdf";

      // Dans la WebView Android, le telechargement d'une blob: URL echoue (le
      // DownloadManager ne sait pas les traiter). On passe alors le PDF au pont
      // natif, qui l'enregistre dans les Telechargements et l'ouvre. En navigateur
      // classique, window.BambuScan n'existe pas -> comportement standard inchange.
      if (window.BambuScan?.savePdf) {
        const b64 = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        window.BambuScan.savePdf(b64, fileName);
        setOpen(false);
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
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

// Onglets de la page. `admin` marque ceux dont tout le contenu est reserve aux
// administrateurs : les afficher a un compte en lecture seule reviendrait a lui
// proposer des onglets vides.
const SET_TABS = [
  { id:"general",  label:"Général",  admin:true  },
  { id:"display",  label:"Affichage", admin:false },
  { id:"accounts", label:"Comptes",  admin:false },
  { id:"data",     label:"Données",  admin:true  },
];

export default function Settings() {
  // Config de la coquille native (URL + presence du jeton), pour affichage.
  const [nativeCfg, setNativeCfg] = React.useState(null);
  React.useEffect(() => {
    try {
      if (window.BambuScan?.getConfig) setNativeCfg(JSON.parse(window.BambuScan.getConfig()));
    } catch { /* pas en webview */ }
  }, []);
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
    // Les identifiants ne sont plus geres ici : voir "Mon compte" et "Utilisateurs".
    if (cost)   payload.COST_BY_HOUR   = cost;
    try {
      await client.patch("/settings", payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch(err) {
      alert("Erreur: " + (err.response?.data?.detail || err.message));
    } finally { setSaving(false); }
  };

  const isAdmin = useIsAdmin();
  const tabs = SET_TABS.filter(t => isAdmin || !t.admin);
  // L'onglet par defaut depend du role : "Général" n'existe pas pour un compte
  // en lecture seule, il atterrit donc sur "Affichage".
  const [tab, setTab] = React.useState(() => (isAdmin ? "general" : "display"));
  useTrackDetail(`Paramètres · ${tabs.find(t => t.id === tab)?.label || tab}`);

  // Tous les hooks sont declares AVANT ce retour anticipe. Les placer apres
  // aurait fait varier leur nombre entre le rendu "chargement" et le suivant,
  // ce que React refuse ("Rendered more hooks than during the previous
  // render") -- l'ecran des parametres serait devenu blanc au chargement.
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
        <AdminOnly><button onClick={() => navigate("/logs")} aria-label="Journal"
          style={{ padding:"5px 12px", borderRadius:20, border:"1px solid var(--border)",
            background:"var(--surface2)", cursor:"pointer", display:"flex",
            alignItems:"center", gap:5, color:"var(--muted)", fontSize:12 }}>
          📋 Journal
        </button></AdminOnly>
      </HeaderAction>

      <div className="hidden-mobile" style={{ display:"none", alignItems:"center", justifyContent:"flex-end" }}>
        <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0, marginRight:"auto" }}>Paramètres</h1>
        <AdminOnly><button onClick={() => navigate("/logs")}
          style={{ padding:"6px 14px", borderRadius:20, border:"1px solid var(--border)",
            background:"var(--surface2)", cursor:"pointer", display:"flex", alignItems:"center", gap:6,
            color:"var(--muted)", fontSize:12 }}>
          📋 Journal
        </button></AdminOnly>
      </div>

      {/* Meme composant visuel que Filaments / Historique / Objets. */}
      <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:12,
        padding:4, border:"1px solid var(--border)" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            flex:1, padding:"8px 12px", borderRadius:8, fontSize:12, fontWeight:600,
            cursor:"pointer", border:"none", transition:"all 0.15s",
            background: tab===t.id ? "#3b82f6" : "transparent",
            color: tab===t.id ? "white" : "var(--muted)" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Affichage ─────────────────────────────────────────────── */}
      {tab === "display" && (<>
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
      <AdminOnly>
        <AMSOrderSection/>
        <AttentionCard card={card} cardTitle={cardTitle}/>
        <LabelsCard card={card} cardTitle={cardTitle}/>
      </AdminOnly>
      </>)}

      {/* ── Général ───────────────────────────────────────────────── */}
      {tab === "general" && (
      <AdminOnly>
      <form onSubmit={handleSave} style={{ display:"flex", flexDirection:"column", gap:16 }}>

        {/* Application native (WebView) : rouvrir les reglages URL + jeton RFID.
            Visible uniquement dans la coquille Android (window.BambuScan). */}
        {typeof window !== "undefined" && window.BambuScan && (
          <div className="card" style={card}>
            <div style={cardTitle}>Application native</div>
            <p style={{ fontSize:12.5, color:"var(--muted)", margin:"0 0 12px", lineHeight:1.5 }}>
              L'adresse de BambuNymous et le jeton RFID sont gérés par l'application
              Android. Tu peux les modifier ici.
            </p>
            {nativeCfg?.url && (
              <p style={{ fontSize:12, color:"var(--text2)", margin:"0 0 12px",
                fontFamily:"JetBrains Mono, monospace", wordBreak:"break-all" }}>
                {nativeCfg.url}
                <br/>
                Jeton RFID : {nativeCfg.hasToken ? "défini ✓" : "non défini"}
              </p>
            )}
            <button type="button"
              onClick={() => { try { window.BambuScan.openSettings(); } catch {} }}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 16px",
                borderRadius:12, border:"none", cursor:"pointer",
                background:"linear-gradient(135deg,#4f46e5,#6366f1)", color:"#fff",
                fontSize:13, fontWeight:700 }}>
              ⚙️ Ouvrir les réglages de l'application
            </button>
          </div>
        )}

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
      </AdminOnly>
      )}

      {/* ── Comptes ───────────────────────────────────────────────── */}
      {tab === "accounts" && (<>
      <MyAccountSection/>
      <UsersSection/>
      <ActivitySection/>
      </>)}

      {/* ── Données ───────────────────────────────────────────────── */}
      {tab === "data" && (
      <AdminOnly>
        <EnrichFromCatalogSection/>
        <RecalculateSection/>
        <TranslateNamesSection/>
        <SpoolnymousImport/>
        <RfidDebugSection/>
      </AdminOnly>
      )}




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
