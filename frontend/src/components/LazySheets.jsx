// Les fiches d'une bobine ou d'une impression, ouvertes depuis l'accueil (AMS, alertes) :
// chargees seulement a l'ouverture. Importees directement, elles tiraient avec l'accueil
// les pages Filaments et Impressions entieres (pres de 6 500 lignes) avant le premier affichage.
import React from "react";
import { importRetry } from "../utils/importRetry";
import { FSheet } from "./FicheKit";

// (28/10/2026) Pendant le chargement du morceau, la coque de la fiche s'affiche deja (voile, poignee,
// ✕ qui ferme) avec quelques barres animees : plus de temps mort sans rien a l'ecran.
export function SheetSkeleton({ onClose }) {
  return (
    <FSheet onClose={onClose}>
      <div aria-busy="true" aria-label="Chargement" style={{ padding:"56px 16px 28px", display:"flex", flexDirection:"column", gap:12 }}>
        <div className="mw-skel" style={{ height:22, width:"62%", borderRadius:8 }}/>
        <div className="mw-skel" style={{ height:13, width:"40%", borderRadius:6 }}/>
        <div className="mw-skel" style={{ height:88, width:"100%", borderRadius:16, marginTop:8 }}/>
        <div className="mw-skel" style={{ height:64, width:"100%", borderRadius:16 }}/>
      </div>
    </FSheet>);
}

const lazyNamed = (load, name) => {
  const C = React.lazy(() => importRetry(load).then(m => ({ default: m[name] })));
  const Wrapped = props => <React.Suspense fallback={<SheetSkeleton onClose={props.onClose}/>}><C {...props}/></React.Suspense>;
  Wrapped.displayName = name;
  return Wrapped;
};

const filaments = () => import("../pages/Filaments");
const prints = () => import("../pages/Prints");
const objects = () => import("../pages/Objects");

export const FilamentSheet = lazyNamed(filaments, "FilamentSheet");
export const FilamentSheetFromSpool = lazyNamed(filaments, "FilamentSheetFromSpool");
export const PrintDetail = lazyNamed(prints, "PrintDetail");
export const GroupBottomSheet = lazyNamed(prints, "GroupBottomSheet");
export const ObjectSheet = lazyNamed(objects, "ObjectSheet");
export const AccessorySheet = lazyNamed(objects, "AccessorySheet");

// (28/10/2026) Prechargement des morceaux lourds une fois l'accueil affiche et le navigateur au repos
// (repli : une temporisation), pour que la premiere fiche s'ouvre sans squelette. Un echec ici reste
// silencieux : pas de rechargement de l'appli pour un prechargement, l'ouverture reelle a son filet.
if (typeof window !== "undefined" && !navigator.connection?.saveData) {
  const prefetch = () => [filaments, prints, objects].forEach(load => load().catch(() => {}));
  if ("requestIdleCallback" in window) window.requestIdleCallback(prefetch, { timeout: 8000 });
  else setTimeout(prefetch, 3000);
}
