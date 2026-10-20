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
              // Meme mise en page que la notification de l'appli Android :
              // en-tete (masque violet · BambuNymous · section · heure), titre,
              // texte, et a droite la grande icone (image, ou emoji de la
              // section sur un disque de sa teinte).
              <div key={it.id} onClick={() => open(it)} className="card"
                style={{ padding:"11px 14px 12px", borderRadius:18, cursor: it.link ? "pointer" : "default",
                  background: it.seen ? undefined : "linear-gradient(90deg, rgba(79,70,229,0.07), transparent 65%), var(--surface)",
                  border: it.seen ? undefined : "1px solid rgba(79,70,229,0.35)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:11.5, color:"var(--muted)", minWidth:0 }}>
                  <span style={{ width:22, height:22, borderRadius:"50%", background:"#4F46E5", flexShrink:0, display:"flex",
                    alignItems:"center", justifyContent:"center" }}>
                    <img src="/notif-icon.png" alt="" style={{ width:13, height:13 }}/></span>
                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    <span style={{ color:"var(--text2)", fontWeight:600 }}>BambuNymous</span>
                    {it.section_name ? <> • {it.section_name}</> : null}
                    {" • "}{new Date(it.time).toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" })}</span>
                  {!it.seen && <span title="Nouvelle" style={{ width:7, height:7, borderRadius:"50%", background:"#4F46E5",
                    marginLeft:"auto", flexShrink:0 }}/>}
                </div>
                <div style={{ display:"flex", gap:12, marginTop:7, paddingLeft:30 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14, fontWeight:700, color:"var(--text)", overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{it.title}</div>
                    {it.message && (
                      <div style={{ fontSize:12.5, color:"var(--text2)", marginTop:3, whiteSpace:"pre-line", lineHeight:1.45,
                        display:"-webkit-box", WebkitLineClamp:5, WebkitBoxOrient:"vertical", overflow:"hidden" }}>{it.message}</div>
                    )}
                  </div>
                  {thumb ? (
                    <img src={thumb} alt="" loading="lazy" style={{ width:46, height:46, borderRadius:12, objectFit:"cover",
                      flexShrink:0, background:"var(--surface2)" }} onError={e => { e.currentTarget.style.visibility = "hidden"; }}/>
                  ) : (
                    <span style={{ width:46, height:46, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center",
                      justifyContent:"center", fontSize:22,
                      background:`${it.section_color || "#4F46E5"}2e`, boxShadow:`inset 0 0 0 2px ${it.section_color || "#4F46E5"}` }}>
                      {it.section_emoji || SECTION_ICON[it.section] || "🔔"}</span>
                  )}
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
