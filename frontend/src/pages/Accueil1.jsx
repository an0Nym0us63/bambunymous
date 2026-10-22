import React, { useState } from "react";
import AttentionSection from "../components/AttentionSection";
import { DeviceGrid } from "./Home";
import { useHomeData, Greeting, PrinterHero, AmsStrip, StatTiles, AlertTiles, QueueTile, FriendsTile, AchievementTile, LIVE } from "./home/shared";

// Accueil de test n°1 : « Cockpit + tuiles ». Le bonjour, l'imprimante en grand,
// ses bobines ; a cote (PC) ou dessous (mobile), les tuiles ; en bas, le detail.
export default function Accueil1() {
  const d = useHomeData();
  const { status } = d;
  const [ams, setAms] = useState(false);
  const [alerts, setAlerts] = useState(false);
  const live = LIVE.includes(String(status?.status || "").toUpperCase());
  return (
    <div className="acc1">
      <style>{`
        .acc1 { display:grid; gap:14px; grid-template-columns:minmax(0,1fr); max-width:1180px; width:100%; margin:0 auto; }
        .acc1-main, .acc1-side { display:flex; flex-direction:column; gap:14px; min-width:0; }
        .acc1-tiles { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px; }
        @media (min-width: 980px) {
          .acc1 { grid-template-columns:minmax(0,1.45fr) minmax(0,1fr); align-items:start; }
          .acc1-full { grid-column:1 / -1; }
        }
      `}</style>
      <div className="acc1-full"><Greeting status={status} today={d.today}/></div>
      <div className="acc1-main">
        <PrinterHero status={status} last={d.last}/>
        <AmsStrip status={status} open={ams} onDetail={() => setAms(o => !o)}/>
        {ams && <DeviceGrid amsList={status?.ams_list ?? []}
          activeAmsId={live ? (status?.active_ams_id ?? -1) : -1} activeTrayId={live ? (status?.active_tray_id ?? -1) : -1}
          rack={status?.hotend_rack} spoolLookup={{}} activeNozzleId={status?.nozzles?.find(n => n.active)?.id ?? null}/>}
      </div>
      <div className="acc1-side">
        <div className="acc1-tiles">
          <StatTiles today={d.today} week={d.week}/>
          <AlertTiles attention={d.attention} max={2} onOpen={() => setAlerts(true)}/>
          <QueueTile queue={d.queue}/>
          <FriendsTile friends={d.friends}/>
          <AchievementTile ach={d.ach} span={2}/>
        </div>
      </div>
      <div className="acc1-full" id="acc1-alerts">
        {alerts || window.innerWidth >= 980 ? <AttentionSection/> : (
          <button className="card" onClick={() => setAlerts(true)} style={{ width:"100%", padding:"12px 16px", textAlign:"left",
            border:"none", cursor:"pointer", color:"var(--text2)", fontSize:13, fontWeight:700 }}>
            Voir tous les points d'attention ▸</button>
        )}
      </div>
    </div>
  );
}
