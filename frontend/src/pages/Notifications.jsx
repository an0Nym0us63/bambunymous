import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import client, { apiUrl } from "../api/client";
import { notifSeenEvent } from "../components/NotifBell";

// Historique de MES notifications (15 jours) : celles que j'ai choisies, avec
// leur image quand il y en a une (couverture MakerWorld, plateau d'une
// impression). Ouvrir la page marque tout comme vu ; les nouvelles restent
// signalees jusqu'au prochain passage. Onglets : une categorie (?cat=), puis
// au besoin un type de cette categorie (?type=), gardes dans l'adresse.
const SECTION_ICON = { prints: "🖨️", printer: "📡", dry: "💧", spools: "🧵", mw: "🌐", friends: "👥", system: "🖥️",
  objects: "📦", attention: "⚠️", achievements: "🏅" };

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
  const [counts, setCounts] = useState(null);     // par categorie, tels qu'a l'ouverture (points des nouvelles)
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const cat = sp.get("cat") || "", type = sp.get("type") || "";
  const pick = (c, t = "") => {
    const n = new URLSearchParams(sp);
    c ? n.set("cat", c) : n.delete("cat");
    t ? n.set("type", t) : n.delete("type");
    setSp(n, { replace: true });
  };
  const firstLoad = useRef(true);
  const params = { ...(cat ? { sections: cat } : {}), ...(type ? { events: type } : {}) };

  useEffect(() => {
    let alive = true;
    client.get("/notify/me/history", { params }).then(({ data }) => {
      if (!alive) return;
      setData(data);
      if (firstLoad.current) setCounts(data.counts || {});
      // ouvrir le journal : tout est vu (une fois, au premier chargement)
      if (firstLoad.current && data.unseen) client.post("/notify/me/seen")
        .then(() => window.dispatchEvent(new CustomEvent(notifSeenEvent))).catch(() => {});
      firstLoad.current = false;
    }).catch(e => setErr(e.response?.data?.detail || e.message));
    return () => { alive = false; };
  }, [cat, type]);

  const loadMore = () => {
    const last = data.items[data.items.length - 1];
    setMore(true);
    client.get("/notify/me/history", { params: { ...params, before: last.id } })
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
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0, flex:1 }}>Notifications</h1>
        <button onClick={() => navigate("/settings?tab=notify")} title="Choisir mes notifications"
          aria-label="Choisir mes notifications" style={{ display:"flex", alignItems:"center", gap:6, background:"none",
            border:"none", cursor:"pointer", color:"var(--muted)", fontSize:12, fontWeight:700, padding:4, marginLeft:"auto" }}>
          <SlidersHorizontal size={16}/>Choisir</button>
      </div>
      <Tabs sections={data.sections || []} counts={counts || {}} cat={cat} type={type} pick={pick}/>
      {!data.items.length && (
        <p style={msg}>{cat ? "Rien dans cette catégorie ces " + data.days + " derniers jours."
          : <>Aucune notification ces {data.days} derniers jours. Choisis celles que tu veux recevoir dans
            Paramètres › Notifs : elles s'afficheront ici.</>}</p>
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
                  <BigIcon thumb={thumb} it={it}/>
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

// Grande icone : l'image si elle se charge, sinon l'emoji de la section sur
// un disque de sa teinte (comme la notification de l'appli Android)
function BigIcon({ thumb, it }) {
  const [broken, setBroken] = useState(false);
  if (thumb && !broken) return (
    <img src={thumb} alt="" loading="lazy" onError={() => setBroken(true)} style={{ width:46, height:46, borderRadius:12,
      objectFit:"cover", flexShrink:0, background:"var(--surface2)" }}/>
  );
  const c = it.section_color || "#4F46E5";
  return (
    <span style={{ width:46, height:46, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center",
      justifyContent:"center", fontSize:22, background:`${c}2e`, boxShadow:`inset 0 0 0 2px ${c}` }}>
      {it.section_emoji || SECTION_ICON[it.section] || "🔔"}</span>
  );
}

// Onglets : « Tout » puis les categories qui ont des notifications (nombre,
// point violet s'il y en avait de nouvelles a l'ouverture) ; sous une
// categorie qui en compte plusieurs, ses types. Une ligne qui defile au doigt.
function Tabs({ sections, counts, cat, type, pick }) {
  const total = Object.values(counts).reduce((n, c) => n + c.total, 0);
  const fresh = Object.values(counts).some(c => c.unseen);
  const shown = sections.filter(s => counts[s.id]?.total || s.id === cat);
  const evs = Object.entries(counts[cat]?.events || {}).sort((a, b) => b[1].total - a[1].total);
  if (!shown.length) return null;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:-4 }}>
      <Row>
        <Chip on={!cat} onClick={() => pick("")} label="Tout" n={total} dot={fresh && !!cat}/>
        {shown.map(s => (
          <Chip key={s.id} on={cat === s.id} onClick={() => pick(cat === s.id ? "" : s.id)} color={s.color}
            label={<><span>{s.emoji}</span>{s.name}</>} n={counts[s.id]?.total || 0}
            dot={!!counts[s.id]?.unseen && cat !== s.id}/>
        ))}
      </Row>
      {cat && evs.length > 1 && (
        <Row small>
          <Chip small on={!type} onClick={() => pick(cat)} label="Tous"/>
          {evs.map(([e, c]) => (
            <Chip small key={e} on={type === e} onClick={() => pick(cat, type === e ? "" : e)} label={c.label} n={c.total}
              dot={!!c.unseen && type !== e}/>
          ))}
        </Row>
      )}
    </div>
  );
}

// Ligne qui defile, sans barre, fondue sur le bord droit
function Row({ children, small }) {
  return (
    <div className="no-scrollbar" style={{ display:"flex", gap: small ? 6 : 7, overflowX:"auto", padding:"2px 0",
      scrollbarWidth:"none", WebkitMaskImage:"linear-gradient(90deg, #000 calc(100% - 28px), transparent)",
      maskImage:"linear-gradient(90deg, #000 calc(100% - 28px), transparent)", paddingRight:24 }}>{children}</div>
  );
}

function Chip({ on, onClick, label, n, dot, small, color = "#4F46E5" }) {
  const ref = useRef(null);
  // l'onglet choisi reste visible (lien direct vers une categorie du bout de la ligne)
  useEffect(() => { if (on) ref.current?.scrollIntoView({ block:"nearest", inline:"center" }); }, [on]);
  return (
    <button ref={ref} onClick={onClick} aria-pressed={on} style={{ position:"relative", flexShrink:0, display:"flex", alignItems:"center",
      gap:5, whiteSpace:"nowrap", cursor:"pointer", borderRadius:20, fontWeight:700,
      padding: small ? "4px 10px" : "6px 12px", fontSize: small ? 11.5 : 12.5,
      border: on ? `1px solid ${color}` : "1px solid var(--border)",
      background: on ? (small ? `${color}22` : color) : small ? "transparent" : "var(--surface2)",
      color: on ? (small ? "var(--text)" : "#fff") : "var(--text2)" }}>
      {label}
      {n != null && <span style={{ fontSize: small ? 10.5 : 11, fontWeight:700, opacity: on ? 0.85 : 0.6 }}>{n}</span>}
      {dot && <span title="Nouvelles" style={{ position:"absolute", top:1, right:1, width:8, height:8, borderRadius:"50%",
        background:"#4F46E5", boxShadow:"0 0 0 2px var(--bg, #fff)" }}/>}
    </button>
  );
}

const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
