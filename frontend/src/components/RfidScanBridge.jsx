import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Nfc, X } from "lucide-react";
import { useRfidScan } from "../store/rfidScan";
import { toast } from "../store/toast";
import RfidSheet from "./RfidSheet";

// la fiche d'une bobine, celle de la page Filaments (chargee a la demande, avec elle)
const SpoolFiche = React.lazy(() => import("../pages/Filaments").then(m => ({ default: m.FilamentSheetFromSpool })));

// Monte une fois dans le Layout :
//  - recoit les scans du shell natif ou que l'on soit, et ouvre la fiche de la
//    bobine (ou la creation guidee) PAR-DESSUS la page et ce qui y est ouvert
//    (06/11/2026 : on changeait de page, une fenetre ouverte se perdait) ; sur la
//    page Filaments, comme avant, par son adresse ;
//  - hors de la page Filaments, montre que le mode est actif (header sur
//    telephone, sous le logo sur ordinateur) et permet de le couper.
//    L'ACTIVATION, elle, reste sur la page Filaments.
const MOBILE = "(max-width: 767px)";

export default function RfidScanBridge() {
  const { available, listening, wakeLock, stop } = useRfidScan();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE).matches);
  const [slot, setSlot] = useState(null);
  const [sheet, setSheet] = useState(null);         // {spool, id} | {rfid} : la fiche ouverte par-dessus

  useEffect(() => {
    const mq = window.matchMedia(MOBILE);
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    on();   // la largeur a pu changer entre le premier rendu et cet ecouteur
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => { setSlot(document.getElementById(mobile ? "header-status" : "sidebar-status")); }, [mobile]);

  useEffect(() => {
    if (!available) return;
    const handler = (e) => {
      const d = e.detail || {};
      // Mauvaise lecture, tag non Bambu, donnees incompletes... : un message
      // qui s'efface seul (2 s), pour enchainer le scan sans cliquer « OK ».
      if (d.error) { toast(`Lecture RFID : ${d.error}`, "error", 2000); return; }
      const qs = (d.redirect || "").split("?")[1] || "";
      if (pathname === "/filaments") { navigate(`/filaments${qs ? `?${qs}` : ""}`, { replace: true }); return; }
      const q = new URLSearchParams(qs);
      if (q.get("spool")) setSheet({ spool: Number(q.get("spool")), id: q.get("id") ? Number(q.get("id")) : undefined });
      else if (q.get("rfid")) setSheet({ rfid: q.get("rfid") });
      else navigate(`/filaments${qs ? `?${qs}` : ""}`);
    };
    window.addEventListener("bambu-rfid-scan", handler);
    return () => window.removeEventListener("bambu-rfid-scan", handler);
  }, [available, navigate, pathname]);

  // au-dessus de tout (fenetres de tuiles, du planning…) : un contexte d'empilement a part
  const over = sheet && createPortal(<div style={{ position: "relative", zIndex: 9500 }}>
    {sheet.rfid ? <RfidSheet scanId={sheet.rfid} z={9500} onClose={() => setSheet(null)}
        onCreated={r => setSheet(r?.spool_id ? { spool: Number(r.spool_id), id: r.filament_id ? Number(r.filament_id) : undefined } : null)}/>
      : <React.Suspense fallback={null}><SpoolFiche spoolId={sheet.spool} filamentId={sheet.id} onClose={() => setSheet(null)}/></React.Suspense>}
  </div>, document.body);
  if (!listening || pathname === "/filaments" || !slot) return over || null;
  const title = "Scan RFID actif — appuyer pour l'arrêter"
    + (wakeLock === false ? " (la mise en veille n'a pas pu être bloquée)" : "");
  return <>{over}{createPortal(
    <button onClick={stop} title={title} aria-label={title}
      style={{ display:"flex", alignItems:"center", gap:5, height:26, padding:"0 9px", borderRadius:13,
        border:"none", background:"#22c55e", color:"white", fontSize:11, fontWeight:700, cursor:"pointer",
        flexShrink:0, whiteSpace:"nowrap", boxShadow:"0 0 0 3px rgba(34,197,94,0.25)",
        ...(mobile ? {} : { width:"100%", justifyContent:"center", height:30 }) }}>
      <Nfc size={13}/> {mobile ? "Scan" : "Scan RFID actif"} <X size={12} style={{ opacity:0.85 }}/>
    </button>,
    slot
  )}</>;
}
