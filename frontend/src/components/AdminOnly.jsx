import { useIsAdmin, useIsHomeAdmin, useCanMw, useCanMwHome } from "../store/auth";

/**
 * N'affiche ses enfants que pour un administrateur.
 * Sert a masquer les actions (creation, edition, suppression) aux comptes en
 * lecture seule. C'est un confort d'interface : la vraie protection est faite
 * cote serveur, ou toute ecriture est refusee pour ces comptes.
 */
// home : action sur MES donnees (mes collections MakerWorld), qui reste
// possible quand je parcours le BambuNymous d'un copain.
// mw : action MakerWorld, ouverte aussi aux comptes qui en ont le droit.
export default function AdminOnly({ children, fallback = null, home = false, mw = false }) {
  const mine = useIsHomeAdmin(), here = useIsAdmin(), mwHome = useCanMwHome(), mwHere = useCanMw();
  const ok = mw ? (home ? mwHome : mwHere) : (home ? mine : here);
  return ok ? children : fallback;
}
