import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import client, { apiUrl } from "../api/client";
import { notifSeenEvent } from "../components/NotifBell";

// Historique de MES notifications (15 jours) : celles que j'ai choisies, avec
// leur image quand il y en a une (couverture MakerWorld, plateau d'une
// impression). Ouvrir la page marque tout comme vu ; les nouvelles restent
// signalees jusqu'au prochain passage.
const SECTION_ICON = { prints: "🖨️", printer: "📡", dry: "💧", spools: "🧵", mw: "🌐", friends: "👥", system: "🖥️" };

const dayLabel = d => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((t - x) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  return x.toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });
};

// Vignette : image jointe, sinon le plateau de l'impression citee par le lien
const thumbOf = it => {
  if (it.image) return it.image;
  const m = /^\/prints\?id=(\d+)/.exec(it.link || "");
  return m ? apiUrl(`/prints/${m[1]}/image`) : null;
};

export default function Notifications() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [more, setMore] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    client.get("/notify/me/history").then(({ data }) => {
      setData(data);
      if (data.unseen) client.post("/notify/me/seen").then(() => window.dispatchEvent(new CustomEvent(notifSeenEvent))).catch(() => {});
    }).catch(e => setErr(e.response?.data?.detail || e.message));
  }, []);

  const loadMore = () => {
    const last = data.items[data.items.length - 1];
    setMore(true);
    client.get("/notify/me/history", { params: { before: last.id } })
      .then(({ data: d }) => setData(x => ({ ...x, items: [...x.items, ...d.items], more: d.more })))
      .catch(() => {}).finally(() => setMore(false));
  };
  const open = it => {
    if (!it.link) return;
    if (it.link.startsWith("/")) navigate(it.link);
    else window.open(it.link, "_blank", "noopener");
  };

  if (err) return <p style={msg}>{err}</p>;
  if (!data) return <p style={msg}>…</p>;

  const groups = [];
  for (const it of data.items) {
    const k = dayLabel(it.time);
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, items: [] });
    groups[groups.length - 1].items.push(it);
  }

  return (
    <div style={{ maxWidth:720, margin:"0 auto", display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
        <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0, flex:1 }}>Notifications</h1>
        <button onClick={() => navigate("/settings?tab=notify")} style={{ background:"none", border:"none", cursor:"pointer",
          color:"#3b82f6", fontSize:12, fontWeight:700 }}>Choisir mes notifications</button>
      </div>
      {!data.items.length && (
        <p style={msg}>Aucune notification ces {data.days} derniers jours. Choisis celles que tu veux recevoir dans
          Paramètres › Notifs : elles s'afficheront ici.</p>
      )}
      {groups.map(g => (
        <div key={g.k} style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ fontSize:11, fontWeight:800, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.06em",
            padding:"0 4px" }}>{g.k}</div>
          {g.items.map(it => {
            const thumb = thumbOf(it);
            return (
              <div key={it.id} onClick={() => open(it)} className="card"
                style={{ display:"flex", gap:12, padding:"11px 13px", cursor: it.link ? "pointer" : "default",
                  borderLeft: it.seen ? "1px solid var(--border)" : "3px solid #3b82f6",
                  background: it.seen ? undefined : "linear-gradient(90deg, rgba(59,130,246,0.07), transparent 60%), var(--surface)" }}>
                {thumb ? (
                  <img src={thumb} alt="" loading="lazy" style={{ width:52, height:52, borderRadius:10, objectFit:"cover", flexShrink:0,
                    background:"var(--surface2)" }} onError={e => { e.currentTarget.style.visibility = "hidden"; }}/>
                ) : (
                  <span style={{ width:52, height:52, borderRadius:10, flexShrink:0, display:"flex", alignItems:"center",
                    justifyContent:"center", fontSize:24, background:"var(--surface2)" }}>{SECTION_ICON[it.section] || "🔔"}</span>
                )}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                    <span style={{ flex:1, fontSize:13.5, fontWeight:800, color:"var(--text)", overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{it.title}</span>
                    <span style={{ fontSize:10.5, color:"var(--muted)", flexShrink:0 }}>
                      {new Date(it.time).toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" })}</span>
                  </div>
                  {it.message && (
                    <div style={{ fontSize:12, color:"var(--text2)", marginTop:3, whiteSpace:"pre-line", lineHeight:1.45,
                      display:"-webkit-box", WebkitLineClamp:5, WebkitBoxOrient:"vertical", overflow:"hidden" }}>{it.message}</div>
                  )}
                  <div style={{ fontSize:10.5, color:"var(--muted)", marginTop:4 }}>{it.section_label}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {data.more && (
        <button onClick={loadMore} disabled={more} style={{ alignSelf:"center", padding:"8px 18px", borderRadius:20, fontSize:12,
          fontWeight:700, cursor:"pointer", background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text2)" }}>
          {more ? "…" : "Plus anciennes"}</button>
      )}
      <p style={{ ...msg, padding:"4px", fontSize:11 }}>Gardées {data.days} jours.</p>
    </div>
  );
}

const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
