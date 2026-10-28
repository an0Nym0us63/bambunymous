// Les fiches d'une bobine ou d'une impression, ouvertes depuis l'accueil (AMS, alertes) :
// chargees seulement a l'ouverture. Importees directement, elles tiraient avec l'accueil
// les pages Filaments et Impressions entieres (pres de 6 500 lignes) avant le premier affichage.
import React from "react";
import { importRetry } from "../utils/importRetry";

const lazyNamed = (load, name) => {
  const C = React.lazy(() => importRetry(load).then(m => ({ default: m[name] })));
  const Wrapped = props => <React.Suspense fallback={null}><C {...props}/></React.Suspense>;
  Wrapped.displayName = name;
  return Wrapped;
};

const filaments = () => import("../pages/Filaments");
const prints = () => import("../pages/Prints");

export const FilamentSheet = lazyNamed(filaments, "FilamentSheet");
export const FilamentSheetFromSpool = lazyNamed(filaments, "FilamentSheetFromSpool");
export const PrintDetail = lazyNamed(prints, "PrintDetail");
export const GroupBottomSheet = lazyNamed(prints, "GroupBottomSheet");
const objects = () => import("../pages/Objects");
export const ObjectSheet = lazyNamed(objects, "ObjectSheet");
export const AccessorySheet = lazyNamed(objects, "AccessorySheet");
