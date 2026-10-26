import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { importRetry } from "../utils/importRetry";
import client from "../api/client";
import { useFriend } from "../store/friend";
import { deviceId } from "../utils/device";

// Fete des grades (26/10/2026) : un echelon de grade gagne (et plus encore un nouveau grade) s'annonce en
// grand, une fois par appareil, comme la fete des cartes. Demande a l'ouverture, au retour sur l'appli et
// toutes les deux minutes ; la fete des cartes passe d'abord (window.__bnCardFx).
const Show = lazy(() => importRetry(() => import("./GradeFxShow")));
const EVERY = 120000;

export default function GradeFx() {
  const visiting = useFriend(s => s.friend);
  const [g, setG] = useState(null);
  const showing = useRef(false);
  useEffect(() => {
    if (visiting) return undefined;
    let busy = false;
    const ask = () => {
      if (busy || showing.current || document.hidden) return;
      busy = true;
      client.get("/achievements/grade-fx", { params: { dev: deviceId() } }).then(({ data }) => {
        if (!data?.grade || showing.current) return;
        showing.current = true;
        let tries = 0;
        const go = () => {
          if ((document.getElementById("splash") || window.__bnCardFx) && tries++ < 400) { setTimeout(go, 400); return; }
          window.__bnGradeFx = true;
          setG(data.grade);
        };
        setTimeout(go, 1200);
      }).catch(() => {}).finally(() => { busy = false; });
    };
    ask();
    const iv = setInterval(ask, EVERY);
    const vis = () => { if (!document.hidden) ask(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
  }, [visiting]);
  if (!g) return null;
  const close = () => {
    const lvl = g.to;
    setG(null);
    showing.current = false;
    window.__bnGradeFx = false;
    client.post("/achievements/grade-fx/seen", null, { params: { dev: deviceId(), level: lvl } }).catch(() => {});
  };
  return <Suspense fallback={null}><Show from={g.from} to={g.to} score={g.score} scoreMax={g.score_max} onClose={close}/></Suspense>;
}
