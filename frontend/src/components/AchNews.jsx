import { useEffect } from "react";
import client from "../api/client";
import { cheer } from "../eggs";
import { currentFriend, useFriend } from "../store/friend";
import { deviceId } from "../utils/device";

// Un palier de succes atteint pendant qu'on utilise l'appli (23/10/2026) : la meme carte en bas
// d'ecran que les secrets. Le serveur dit ce qui est nouveau depuis mon dernier passage ; on lui
// demande de temps en temps, et a chaque retour sur l'appli. Jamais chez un copain.
const EVERY = 60000, MAX = 4;

export default function AchNews() {
  const visiting = useFriend(s => s.friend);
  useEffect(() => {
    if (visiting) return undefined;
    let busy = false;
    const ask = () => {
      if (busy || document.hidden || currentFriend()) return;
      busy = true;
      client.get("/achievements/news", { params: { dev: deviceId() } }).then(({ data }) => {
        const news = data?.news || [];
        news.slice(0, MAX).forEach(n => cheer({
          emoji: n.emoji,
          head: n.secret ? "🤫 Secret débloqué !" : n.unique ? "🏵️ Succès débloqué !" : `${n.tier?.emoji || "🏅"} Palier ${n.tier?.label || ""} !`,
          color: n.tier?.color || "#F59E0B",
          name: n.unique ? n.name : `${n.name} · ${n.tier?.label || ""}`,
          text: n.desc,
        }));
        if (news.length > MAX) cheer({ emoji: "🎉", head: "Et ce n'est pas tout", color: "#F59E0B",
          name: `${news.length - MAX} autre${news.length - MAX > 1 ? "s" : ""} palier${news.length - MAX > 1 ? "s" : ""}`, text: "Tout est sur la page Succès." });
      }).catch(() => {}).finally(() => { busy = false; });
    };
    const first = setTimeout(ask, 5000);
    const iv = setInterval(ask, EVERY);
    const vis = () => { if (!document.hidden) ask(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearTimeout(first); clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
  }, [visiting]);
  return null;
}
