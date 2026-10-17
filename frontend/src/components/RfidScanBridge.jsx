import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Nfc, X } from "lucide-react";
import { useRfidScan } from "../store/rfidScan";
import { showAlert } from "../utils/dialog";

// Monte une fois dans le Layout :
//  - recoit les scans du shell natif ou que l'on soit, et ouvre la fiche sur
//    la page Filaments (bobine connue) ou la creation guidee (inconnue) ;
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
      if (d.error) { showAlert(d.error); return; }
      const qs = (d.redirect || "").split("?")[1] || "";
      // La fiche (ou la creation) s'ouvre sur la page Filaments, d'ou que l'on scanne.
      navigate(`/filaments${qs ? `?${qs}` : ""}`, { replace: pathname === "/filaments" });
    };
    window.addEventListener("bambu-rfid-scan", handler);
    return () => window.removeEventListener("bambu-rfid-scan", handler);
  }, [available, navigate, pathname]);

  if (!listening || pathname === "/filaments" || !slot) return null;
  const title = "Scan RFID actif — appuyer pour l'arrêter"
    + (wakeLock === false ? " (la mise en veille n'a pas pu être bloquée)" : "");
  return createPortal(
    <button onClick={stop} title={title} aria-label={title}
      style={{ display:"flex", alignItems:"center", gap:5, height:26, padding:"0 9px", borderRadius:13,
        border:"none", background:"#22c55e", color:"white", fontSize:11, fontWeight:700, cursor:"pointer",
        flexShrink:0, whiteSpace:"nowrap", boxShadow:"0 0 0 3px rgba(34,197,94,0.25)",
        ...(mobile ? {} : { width:"100%", justifyContent:"center", height:30 }) }}>
      <Nfc size={13}/> {mobile ? "Scan" : "Scan RFID actif"} <X size={12} style={{ opacity:0.85 }}/>
    </button>,
    slot
  );
}
