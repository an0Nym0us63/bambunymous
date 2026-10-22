import React, { useState } from "react";
import AttentionSection from "../components/AttentionSection";
import { useHomeData, Greeting, PrinterHero, AmsStrip, StatTiles, AlertTiles, QueueTile, FriendsTile, AchievementTile,
         Timeline } from "./home/shared";

// Accueil de test n°2 : « Fil du jour ». Sur PC, trois colonnes : l'imprimante
// et ses bobines, le bonjour et le fil de la journee, les tuiles. Sur mobile :
// bonjour, imprimante, tuiles, puis le fil.
export default function Accueil2() {
  const d = useHomeData();
  const { status } = d;
  const [alerts, setAlerts] = useState(false);
  return (
    <div className="acc2">
      <style>{`
        .acc2 { display:grid; gap:14px; grid-template-columns:minmax(0,1fr); max-width:1280px; width:100%; margin:0 auto;
                grid-template-areas: "hello" "printer" "tiles" "feed" "alerts"; }
        .acc2-col { display:flex; flex-direction:column; gap:14px; min-width:0; }
        .acc2-tiles { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px; align-content:start; }
        @media (min-width: 760px) and (max-width: 1099px) {
          .acc2 { grid-template-columns:minmax(0,1fr) minmax(0,1fr);
                  grid-template-areas: "hello hello" "printer tiles" "feed feed" "alerts alerts"; align-items:start; }
        }
        @media (min-width: 1100px) {
          .acc2 { grid-template-columns:minmax(0,1fr) minmax(0,1.25fr) minmax(0,0.95fr);
                  grid-template-areas: "printer hello tiles" "printer feed tiles" "alerts alerts alerts"; align-items:start; }
          .acc2-tiles { grid-template-columns:minmax(0,1fr); }
          .acc2-tiles > .card { grid-column:auto !important; }
        }
      `}</style>
      <div style={{ gridArea:"hello" }}><Greeting status={status} today={d.today}/></div>
      <div className="acc2-col" style={{ gridArea:"printer" }}>
        <PrinterHero status={status} last={d.last} compact/>
        <AmsStrip status={status}/>
      </div>
      <div className="acc2-tiles" style={{ gridArea:"tiles" }}>
        <StatTiles today={d.today} week={d.week}/>
        <AlertTiles attention={d.attention} max={2} onOpen={() => setAlerts(true)}/>
        <QueueTile queue={d.queue}/>
        <FriendsTile friends={d.friends}/>
        <AchievementTile ach={d.ach} span={2}/>
      </div>
      <div style={{ gridArea:"feed", minWidth:0 }}><Timeline feed={d.feed} max={10}/></div>
      <div style={{ gridArea:"alerts", minWidth:0 }}>
        {alerts ? <AttentionSection/> : (
          <button className="card" onClick={() => setAlerts(true)} style={{ width:"100%", padding:"12px 16px", textAlign:"left",
            border:"none", cursor:"pointer", color:"var(--text2)", fontSize:13, fontWeight:700 }}>
            Voir tous les points d'attention ▸</button>
        )}
      </div>
    </div>
  );
}
