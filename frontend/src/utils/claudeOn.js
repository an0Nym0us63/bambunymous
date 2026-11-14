import { useEffect, useState } from "react";
import client from "../api/client";
import { currentFriend } from "../store/friend";

// La connexion Claude est-elle reglee ? (14/11/2026) : les gestes qui passent par Claude (reclasser) ne s'affichent qu'alors.
// Lu une fois par chargement de l'appli.
let ASK = null;
export function useClaudeOn() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    if (currentFriend()) return undefined;         // chez un copain : rien ne passe par mon Claude
    ASK = ASK || client.get("/prints/translate-missing").then(r => !!r.data?.claude_key).catch(() => false);
    ASK.then(v => { if (alive) setOn(v); });
    return () => { alive = false; };
  }, []);
  return on;
}
