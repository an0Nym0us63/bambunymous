import { useEffect } from "react";
import client from "../api/client";
import { cheer } from "../eggs";
import { currentFriend, useFriend } from "../store/friend";
import { deviceId } from "../utils/device";

// Un palier de succes atteint pendant qu'on utilise l'appli (23/10/2026) : la meme carte en bas
// d'ecran que les secrets. Le serveur dit ce qui est nouveau depuis mon dernier passage ; on lui
// demande de temps en temps, et a chaque retour sur l'appli. Jamais chez un copain.
// Un palier n'est acquitte aupres du serveur qu'une fois sa carte AFFICHEE, ecran visible (25/10/2026) :
// ce qui attendait dans la file quand on a quitte l'appli revient a la prochaine ouverture.
const EVERY = 60000, MAX = 4;
const inLine = new Set();      // en file ou deja montres dans cette page : pas deux fois
const ack = keys => keys.length && client.post("/achievements/news/ack", { dev: deviceId(), keys }).catch(() => {});
const settle = keys => vu => { if (vu) ack(keys); else keys.forEach(k => inLine.delete(k)); };

export default function AchNews() {
  const visiting = useFriend(s => s.friend);
  useEffect(() => {
    if (visiting) return undefined;
    let busy = false;
    const ask = () => {
      if (busy || document.hidden || currentFriend()) return;
      busy = true;
      client.get("/achievements/news", { params: { dev: deviceId(), ack: 1 } }).then(({ data }) => {
        const news = (data?.news || []).filter(n => n.key && !inLine.has(n.key));
        news.forEach(n => inLine.add(n.key));
        news.slice(0, MAX).forEach(n => cheer({
          onShown: settle([n.key]),
          emoji: n.emoji,
          head: n.secret ? "🤫 Secret débloqué !" : n.unique ? "🏵️ Succès débloqué !" : `${n.tier?.emoji || "🏅"} Palier ${n.tier?.label || ""} !`,
          color: n.tier?.color || "#F59E0B",
          name: n.unique ? n.name : `${n.name} · ${n.tier?.label || ""}`,
          text: n.desc,
        }));
        if (news.length > MAX) cheer({ onShown: settle(news.slice(MAX).map(n => n.key)), emoji: "🎉", head: "Et ce n'est pas tout", color: "#F59E0B",
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
