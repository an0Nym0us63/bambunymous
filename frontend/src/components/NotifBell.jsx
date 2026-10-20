import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import client from "../api/client";

// Cloche de l'en-tete : nombre de notifications pas encore vues (historique
// de 15 jours, propre a chaque compte). Relue chaque minute, au retour sur
// l'onglet, et quand la page Notifications les marque vues.
export const notifSeenEvent = "bambu-notif-seen";

export default function NotifBell({ size = 20 }) {
  const [n, setN] = useState(0);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    let alive = true;
    const load = () => client.get("/notify/me/unseen").then(({ data }) => { if (alive) setN(data.unseen || 0); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    const vis = () => { if (document.visibilityState === "visible") load(); };
    const seen = () => setN(0);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener(notifSeenEvent, seen);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", vis);
      window.removeEventListener(notifSeenEvent, seen); };
  }, [pathname]);

  const active = pathname === "/notifications";
  return (
    <button onClick={() => navigate("/notifications")} aria-label={n ? `${n} notification${n > 1 ? "s" : ""} non vue${n > 1 ? "s" : ""}` : "Notifications"}
      title="Notifications" style={{ position:"relative", flexShrink:0, width:size + 14, height:size + 14, borderRadius:"50%",
        border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
        background: active ? "rgba(59,130,246,0.15)" : "transparent", color: active ? "#3b82f6" : "var(--text2)" }}>
      <Bell size={size} strokeWidth={2.1}/>
      {n > 0 && (
        <span style={{ position:"absolute", top:1, right:0, minWidth:16, height:16, padding:"0 4px", borderRadius:8,
          background:"#ef4444", color:"white", fontSize:9.5, fontWeight:800, lineHeight:"16px", textAlign:"center",
          boxShadow:"0 0 0 2px var(--surface)" }}>{n > 99 ? "99+" : n}</span>
      )}
    </button>
  );
}
