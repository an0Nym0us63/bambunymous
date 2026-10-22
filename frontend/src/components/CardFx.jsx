import React, { Suspense, lazy, useEffect, useState } from "react";
import client from "../api/client";
import { useFriend } from "../store/friend";

// Fete des cartes : a l'ouverture de l'appli, les cartes gagnees depuis la
// derniere fois (gagnees pour de bon, jamais un recalcul) se retournent en
// grand, avec un effet a la mesure de la plus haute. Une fois par lancement.
const Show = lazy(() => import("./CardFxShow"));
let asked = false;

export default function CardFx() {
  const visiting = useFriend(s => s.friend);
  const [cards, setCards] = useState(null);
  useEffect(() => {
    if (asked || visiting) return;
    asked = true;
    client.get("/achievements/card-fx").then(({ data }) => {
      if (!data?.cards?.length) return;
      window.__bnCardFx = true;            // la surprise de l'accueil attend la fin de la fete
      let tries = 0;
      const go = () => {
        if (document.getElementById("splash") && tries++ < 30) { setTimeout(go, 300); return; }
        setCards(data.cards);
      };
      setTimeout(go, 600);
    }).catch(() => {});
  }, [visiting]);
  if (!cards) return null;
  const close = () => {
    setCards(null);
    window.__bnCardFx = false;
    client.post("/achievements/card-fx/seen").catch(() => {});
  };
  return <Suspense fallback={null}><Show cards={cards} onClose={close}/></Suspense>;
}
