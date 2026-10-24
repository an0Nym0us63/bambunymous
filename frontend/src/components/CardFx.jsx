import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import client from "../api/client";
import { useFriend } from "../store/friend";
import { deviceId } from "../utils/device";

// Fete des cartes : a l'ouverture de l'appli, les cartes gagnees depuis la
// derniere fois (gagnees pour de bon, jamais un recalcul) se retournent en
// grand, avec un effet a la mesure de la plus haute. Redemande aussi au retour
// sur l'appli et de temps en temps (l'appli Android reste ouverte des jours) ;
// suivi par appareil : un autre appareil ne la « mange » plus.
const Show = lazy(() => import("./CardFxShow"));
const EVERY = 120000;

export default function CardFx() {
  const visiting = useFriend(s => s.friend);
  const [cards, setCards] = useState(null);
  const showing = useRef(false);
  useEffect(() => {
    if (visiting) return undefined;
    let busy = false;
    const ask = () => {
      if (busy || showing.current || document.hidden) return;
      busy = true;
      client.get("/achievements/card-fx", { params: { dev: deviceId() } }).then(({ data }) => {
        if (!data?.cards?.length || showing.current) return;
        showing.current = true;
        window.__bnCardFx = true;            // la surprise de l'accueil attend la fin de la fete
        let tries = 0;
        const go = () => {
          if (document.getElementById("splash") && tries++ < 30) { setTimeout(go, 300); return; }
          setCards(data.cards);
        };
        setTimeout(go, 600);
      }).catch(() => {}).finally(() => { busy = false; });
    };
    ask();
    const iv = setInterval(ask, EVERY);
    const vis = () => { if (!document.hidden) ask(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
  }, [visiting]);
  if (!cards) return null;
  const close = () => {
    setCards(null);
    showing.current = false;
    window.__bnCardFx = false;
    client.post("/achievements/card-fx/seen", null, { params: { dev: deviceId() } }).catch(() => {});
  };
  return <Suspense fallback={null}><Show cards={cards} onClose={close}/></Suspense>;
}
