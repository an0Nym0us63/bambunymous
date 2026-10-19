import React, { useEffect, useState } from "react";
import client from "../api/client";
import { useFriend } from "../store/friend";
import { useIsHomeAdmin, ROLE_LABEL } from "../store/auth";
import { showAlert, showConfirm } from "../utils/dialog";
import Lightbox from "./Lightbox";
import { Pressable } from "./ContextMenu";

// ── Pastille « chez un copain » : dans l'en-tete (mobile) ou le menu (PC) ──
// Discrete mais toujours visible ; la toucher ramene chez moi.
export function FriendChip({ block = false }) {
  const friend = useFriend((s) => s.friend);
  const visit = useFriend((s) => s.visit);
  if (!friend) return null;
  return (
    <button onClick={() => visit(null)} title="Revenir chez moi"
      style={{ display:"flex", alignItems:"center", gap:6, minWidth:0, flexShrink: block ? 0 : 1,
        width: block ? "100%" : "auto", padding: block ? "7px 10px" : "4px 9px", borderRadius:20, cursor:"pointer",
        border:"1px solid rgba(249,115,22,0.45)", background:"rgba(249,115,22,0.12)", color:"#f97316",
        fontSize:12, fontWeight:700 }}>
      <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>👀 {friend.name}</span>
      <span style={{ marginLeft: block ? "auto" : 0, flexShrink:0, opacity:0.8 }}>🏠</span>
    </button>
  );
}

// ── Liste « Chez qui ? » (menu du compte) ───────────────────────────────────
export function FriendPicker({ onDone }) {
  const friend = useFriend((s) => s.friend);
  const visit = useFriend((s) => s.visit);
  const [list, setList] = useState(null);
  const [printing, setPrinting] = useState({});      // id -> avancement (%), pour le voyant
  useEffect(() => { client.get("/friends").then(({ data }) => setList(data.friends || [])).catch(() => setList([])); }, []);
  useEffect(() => {
    if (!list?.length) return;
    client.get("/friends/shared/printing").then(({ data }) =>
      setPrinting(Object.fromEntries((data.printing || []).map(f => [f.id, Math.round(f.progress ?? 0)])))).catch(() => {});
  }, [list?.length]);
  if (!list || (!list.length && !friend)) return null;
  const row = (on) => ({ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background: on
    ? "rgba(59,130,246,0.1)" : "none", border:"none", cursor:"pointer", color:"var(--text)", fontSize:13, textAlign:"left" });
  return (
    <div style={{ borderBottom:"1px solid var(--border)", padding:"4px 0" }}>
      <p style={{ margin:"6px 14px 2px", fontSize:10.5, fontWeight:700, color:"var(--muted)", textTransform:"uppercase",
        letterSpacing:0.4 }}>Chez qui ?</p>
      <button onClick={() => { onDone?.(); if (friend) visit(null); }} style={row(!friend)}>🏠 Chez moi</button>
      {list.map(f => (
        <button key={f.id} onClick={() => { onDone?.(); if (friend?.id !== f.id) visit(f); }} style={row(friend?.id === f.id)}>
          👀 {f.name}
          {/* Voyant : il imprime en ce moment */}
          {printing[f.id] != null && (
            <span title={`Imprime en ce moment · ${printing[f.id]} %`} style={{ display:"inline-flex", alignItems:"center", gap:4,
              fontSize:10.5, color:"#22c55e", fontWeight:600 }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:"#22c55e", boxShadow:"0 0 0 3px rgba(34,197,94,0.18)",
                animation:"livePulse 2s infinite" }}/>{printing[f.id]} %</span>
          )}
          <span style={{ marginLeft:"auto", fontSize:10.5, color:"var(--muted)" }}>{ROLE_LABEL[f.role] || f.role}</span>
        </button>
      ))}
    </div>
  );
}

// ── Parametres → Comptes : mes copains (invitations recues) ────────────────
export function FriendsCard() {
  const isAdmin = useIsHomeAdmin();
  const visit = useFriend((s) => s.visit);
  const [list, setList] = useState(null);
  const [inv, setInv] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const load = () => client.get("/friends").then(({ data }) => setList(data.friends || [])).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (!isAdmin) return null;
  const add = async () => {
    setBusy(true); setErr(null);
    try { await client.post("/friends", { invitation: inv, name }); setInv(""); setName(""); await load(); }
    catch (e) { setErr(e.response?.data?.detail || e.message); }
    setBusy(false);
  };
  const remove = async f => {
    if (!await showConfirm(`Retirer « ${f.name} » de tes copains ? (Son BambuNymous n'est pas touché.)`, { confirmLabel:"Retirer" })) return;
    try { await client.delete(`/friends/${f.id}`); await load(); } catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const inp = { width:"100%", boxSizing:"border-box", padding:"8px 10px", borderRadius:8, fontSize:12.5,
    background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" };
  const btn = { padding:"6px 12px", borderRadius:9, fontSize:12, fontWeight:600, cursor:"pointer",
    background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" };
  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>👀 Copains</h3>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 12px", lineHeight:1.5 }}>
        Parcours le BambuNymous d'un ami (historique, collections MakerWorld…) en lecture seule, avec les droits du
        compte qu'il t'a créé chez lui. Il te donne une <b>invitation copain</b> (dans ses Paramètres → Comptes) ; colle-la ici.
        Chez lui, ☆ range toujours dans <b>tes</b> collections, et l'appli te dit si tu as déjà le modèle.
      </p>
      {list === null ? <p style={{ fontSize:12, color:"var(--muted)" }}>…</p> : list.map(f => (
        <Pressable key={f.id} menu={() => ({ title: f.name, subtitle: f.url, items: [
            { icon: "👀", label: "Visiter", onClick: () => visit(f) },
            { icon: "🗑", label: "Retirer de mes copains…", danger: true, onClick: () => remove(f) },
          ] })}
          style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0", borderTop:"1px solid var(--border)" }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"var(--text)" }}>{f.name}</div>
            <div style={{ fontSize:11, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {f.url} · compte {f.user} · {ROLE_LABEL[f.role] || f.role}</div>
          </div>
          <button onClick={() => visit(f)} style={{ ...btn, color:"#3b82f6" }}>Visiter</button>
          <button onClick={() => remove(f)} style={{ ...btn, color:"var(--muted)" }}>✕</button>
        </Pressable>
      ))}
      <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:10 }}>
        <textarea value={inv} onChange={e => setInv(e.target.value)} placeholder="Coller l'invitation (bnym1.…)" rows={2}
          autoComplete="off" style={{ ...inp, fontFamily:"JetBrains Mono,monospace", fontSize:11, resize:"vertical" }}/>
        <div style={{ display:"flex", gap:6 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Nom (ex. Léo)" autoComplete="off" style={{ ...inp, flex:1 }}/>
          <button onClick={add} disabled={busy || !inv.trim()}
            style={{ ...btn, background:"#3b82f6", border:"none", color:"white", fontWeight:700 }}>{busy ? "…" : "Ajouter"}</button>
        </div>
        {err && <p style={{ fontSize:12, color:"#ef4444", margin:0 }}>{err}</p>}
      </div>
    </div>
  );
}

// ── Parametres → Comptes : invitation copain pour un compte de chez moi ────
export function FriendKeyButtons({ user, onChanged, pill }) {
  const [shown, setShown] = useState(null);      // invitation a copier (affichee une seule fois)
  const make = async () => {
    if (user.has_friend_key && !await showConfirm(`Recréer l'invitation de « ${user.username} » ? L'ancienne cessera de marcher.`,
      { confirmLabel:"Recréer" })) return;
    try {
      const { data } = await client.post(`/users/${user.id}/friend-key`, { origin: window.location.origin });
      setShown(data.invitation); onChanged?.();
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const revoke = async () => {
    if (!await showConfirm(`Révoquer l'invitation de « ${user.username} » ? Son appli ne pourra plus te parcourir.`,
      { confirmLabel:"Révoquer" })) return;
    try { await client.delete(`/users/${user.id}/friend-key`); onChanged?.(); } catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(shown); showAlert("Invitation copiée."); } catch { /* copie manuelle */ } };
  return (<>
    <button onClick={make} style={pill("#14b8a6", "rgba(20,184,166,0.35)")}>
      🔑 {user.has_friend_key ? "Nouvelle invitation copain" : "Invitation copain"}</button>
    {user.has_friend_key && <button onClick={revoke} style={pill("#94a3b8", "rgba(148,163,184,0.35)")}>Révoquer l'invitation</button>}
    {shown && (
      <div style={{ flex:"1 1 100%", marginTop:4, padding:10, borderRadius:10, background:"rgba(20,184,166,0.08)",
        border:"1px solid rgba(20,184,166,0.35)" }}>
        <p style={{ margin:"0 0 6px", fontSize:11.5, color:"var(--text2)", lineHeight:1.45 }}>
          Envoie ce texte à ton copain : il le colle dans ses <b>Paramètres → Comptes → Copains</b>. Il ne sera plus affiché ;
          s'il est perdu, recrée une invitation. L'adresse incluse est <b>{window.location.origin}</b> : elle doit être
          joignable depuis chez lui.</p>
        <textarea readOnly value={shown} rows={3} onFocus={e => e.target.select()}
          style={{ width:"100%", boxSizing:"border-box", fontFamily:"JetBrains Mono,monospace", fontSize:10.5, padding:8,
            borderRadius:8, background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" }}/>
        <div style={{ display:"flex", gap:6, marginTop:6 }}>
          <button onClick={copy} style={pill("#14b8a6", "rgba(20,184,166,0.35)")}>📋 Copier</button>
          <button onClick={() => setShown(null)} style={pill("#94a3b8", "rgba(148,163,184,0.35)")}>Fermer</button>
        </div>
      </div>
    )}
  </>);
}

// ── « Deja chez moi ? » : pour les modeles vus chez un copain ──────────────
const MINE = new Map();
export function useMine(ids) {
  const friend = useFriend((s) => s.friend);
  const [, bump] = useState(0);
  const key = (ids || []).join(",");
  useEffect(() => {
    if (!friend || !ids?.length) return;
    const miss = ids.filter(i => !MINE.has(String(i)));
    if (!miss.length) return;
    let alive = true;
    for (let i = 0; i < miss.length; i += 100) {
      client.get("/makerworld/mine", { params: { ids: miss.slice(i, i + 100).join(",") } })
        .then(({ data }) => { Object.entries(data.items || {}).forEach(([k, v]) => MINE.set(k, v)); if (alive) bump(n => n + 1); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [friend?.id, key]);
  return friend ? (id) => MINE.get(String(id)) : null;
}

export function MineBadge({ m }) {
  if (!m) return null;
  const bits = [];
  if (m.printed) bits.push(`imprimé ${m.printed}×`);
  else if (m.in_progress) bits.push("en cours");
  if (m.collections?.length) bits.push(`📁 ${m.collections.join(", ")}`);
  if (m.liked) bits.push("❤");
  const has = bits.length > 0;
  return (
    <span title={has ? "Chez moi" : "Je ne l'ai pas encore"}
      style={{ display:"inline-block", marginTop:4, fontSize:10.5, fontWeight:700, padding:"2px 7px", borderRadius:20,
        color: has ? "#a78bfa" : "var(--muted)", background: has ? "rgba(167,139,250,0.14)" : "var(--surface)",
        border: has ? "none" : "1px dashed var(--border)", maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis",
        whiteSpace:"nowrap" }}>
      🏠 {has ? bits.join(" · ") : "pas chez moi"}
    </span>
  );
}


// ── « Chez les copains » ─────────────────────────────────────────────────────
// Mes copains (liste lue une fois par session), seulement chez moi : chez un
// copain, « chez les copains » n'a pas de sens.
let _friendsList = null;
export function useHasFriends() {
  const friend = useFriend((s) => s.friend);
  const [n, setN] = useState(_friendsList ? _friendsList.length : null);
  useEffect(() => {
    if (friend || _friendsList) return;
    client.get("/friends").then(({ data }) => { _friendsList = data.friends || []; setN(_friendsList.length); })
      .catch(() => setN(0));
  }, [friend]);
  return !friend && (n || 0) > 0;
}

// Image relayee par mon serveur : une <img> n'envoie pas d'en-tete, le jeton part en _t.
export const relayed = (u) => {
  if (!u || !u.startsWith("/api/v1/friends/")) return u;
  const t = localStorage.getItem("token") || "";
  return `${u}${u.includes("?") ? "&" : "?"}_t=${encodeURIComponent(t)}`;
};

// Lecture « chez les copains » d'une adresse, gardee 5 min : la section ne
// s'affiche que s'il y a quelque chose, il faut donc lire avant d'afficher.
const _shared = new Map();      // url -> { t, p }
export function useShared(url, enabled = true) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!enabled || !url) { setData(null); return; }
    let alive = true;
    let hit = _shared.get(url);
    if (!hit || Date.now() - hit.t > 300000) {
      hit = { t: Date.now(), p: client.get(url).then(r => r.data).catch(e => ({ error: e.response?.data?.detail || e.message })) };
      _shared.set(url, hit);
    }
    hit.p.then(d => alive && setData(d));
    return () => { alive = false; };
  }, [url, enabled]);
  return data;
}
export const sharedCount = (d) => (d?.friends || []).reduce((t, f) => t + (f.status === "ok" ? f.prints?.length || 0 : 0), 0);

// Impressions de mes copains (meme filament, ou meme modele), par copain ;
// toucher une vignette ouvre ses photos en grand. Seuls les copains qui ont
// quelque chose sont listes.
export function FriendsPrints({ url, data: given, empty = "Rien chez eux pour l'instant." }) {
  const read = useShared(given ? null : url);
  const data = given || read;
  const [view, setView] = useState(null);       // { images, index }
  const muted = { color: "var(--muted)", fontSize: 12.5, textAlign: "center", padding: 18, margin: 0 };
  if (!data) return <p style={muted}>Je demande à tes copains…</p>;
  if (data.error) return <p style={{ ...muted, color: "#ef4444" }}>⚠ {data.error}</p>;
  if (data.reason) return <p style={muted}>{data.reason}</p>;
  const fmt = d => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
  const any = (data.friends || []).some(f => f.prints?.length);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!any && <p style={muted}>{empty}</p>}
      {(data.friends || []).map(f => (f.status === "ok" && f.prints?.length) ? (
        <div key={f.id}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>👀 {f.name}</span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {f.prints.length} impression{f.prints.length > 1 ? "s" : ""}</span>
          </div>
          {(
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))", gap: 8 }}>
              {f.prints.map(p => {
                const imgs = (p.photos?.length ? p.photos : [p.image]).map(relayed);
                return (
                  <button key={p.id} onClick={() => setView({ images: imgs, index: 0 })}
                    style={{ padding: 0, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden",
                      background: "var(--surface2)", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
                    <div style={{ position: "relative", paddingTop: "100%", background: "var(--surface)" }}>
                      <img src={imgs[0]} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%",
                        height: "100%", objectFit: "cover" }} onError={e => { e.currentTarget.style.display = "none"; }}/>
                      {imgs.length > 1 && <span style={{ position: "absolute", top: 5, right: 5, fontSize: 10, fontWeight: 800,
                        color: "white", background: "rgba(0,0,0,0.55)", borderRadius: 10, padding: "1px 6px" }}>{imgs.length} 📷</span>}
                    </div>
                    <div style={{ padding: "5px 7px 6px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[fmt(p.print_date), p.grams ? `${p.grams} g` : null,
                          p.filaments?.length ? p.filaments.map(x => x.name).join(", ") : null].filter(Boolean).join(" · ")}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null)}
      {view && <Lightbox images={view.images} index={view.index} onClose={() => setView(null)}/>}
    </div>
  );
}
