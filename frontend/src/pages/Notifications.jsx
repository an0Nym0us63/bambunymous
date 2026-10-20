import React, { useEffect, useRef, useState } from "react";
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

const HIDDEN_KEY = "notifHiddenSections";
const ALL_SECTIONS = Object.keys(SECTION_ICON);

export default function Notifications() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [more, setMore] = useState(false);
  const navigate = useNavigate();
  // Categories masquees (ce navigateur)
  const [hidden, setHiddenState] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]")); } catch { return new Set(); }
  });
  const setHidden = h => { setHiddenState(h); try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...h])); } catch { /* indisponible */ } };
  const [picker, setPicker] = useState(false);
  const firstLoad = useRef(true);
  const params = hidden.size ? { sections: ALL_SECTIONS.filter(x => !hidden.has(x)).join(",") } : {};

  useEffect(() => {
    let alive = true;
    client.get("/notify/me/history", { params }).then(({ data }) => {
      if (!alive) return;
      setData(data);
      // ouvrir le journal : tout est vu (une fois, au premier chargement)
      if (firstLoad.current && data.unseen) client.post("/notify/me/seen")
        .then(() => window.dispatchEvent(new CustomEvent(notifSeenEvent))).catch(() => {});
      firstLoad.current = false;
    }).catch(e => setErr(e.response?.data?.detail || e.message));
    return () => { alive = false; };
  }, [[...hidden].sort().join(",")]);

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
        <SectionFilter sections={data.sections || []} hidden={hidden} open={picker} setOpen={setPicker} onChange={setHidden}/>
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

// Filtre des categories : menu deroulant, Tous / Aucun, une case par section
function SectionFilter({ sections, hidden, open, setOpen, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const shown = sections.filter(s => !hidden.has(s.id)).length;
  const toggle = id => { const h = new Set(hidden); h.has(id) ? h.delete(id) : h.add(id); onChange(h); };
  const link = { background:"none", border:"none", padding:0, cursor:"pointer", color:"#6366F1", fontSize:12, fontWeight:700 };
  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 11px", borderRadius:20, fontSize:12, fontWeight:700,
          cursor:"pointer", border: hidden.size ? "1px solid rgba(99,102,241,0.45)" : "1px solid var(--border)",
          background: hidden.size ? "rgba(99,102,241,0.12)" : "var(--surface2)", color: hidden.size ? "#6366F1" : "var(--text2)" }}>
        Catégories{sections.length ? ` ${shown}/${sections.length}` : ""} <span style={{ fontSize:9 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="card" style={{ position:"absolute", right:0, top:"calc(100% + 6px)", zIndex:50, minWidth:220,
          padding:"8px 6px", boxShadow:"0 10px 30px rgba(0,0,0,0.25)" }}>
          <div style={{ display:"flex", gap:14, padding:"2px 10px 8px", borderBottom:"1px solid var(--border)", marginBottom:4 }}>
            <button onClick={() => onChange(new Set())} style={link}>Tous</button>
            <button onClick={() => onChange(new Set(sections.map(s => s.id)))} style={link}>Aucun</button>
          </div>
          {sections.map(s => (
            <label key={s.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", borderRadius:8,
              cursor:"pointer", fontSize:13, color:"var(--text)" }}>
              <input type="checkbox" checked={!hidden.has(s.id)} onChange={() => toggle(s.id)}
                style={{ accentColor:"#6366F1", width:16, height:16 }}/>
              <span style={{ width:24, height:24, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:13, background:`${s.color}2e` }}>{s.emoji}</span>
              {s.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
