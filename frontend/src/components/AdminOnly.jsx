import { useIsAdmin, useIsHomeAdmin } from "../store/auth";

/**
 * N'affiche ses enfants que pour un administrateur.
 * Sert a masquer les actions (creation, edition, suppression) aux comptes en
 * lecture seule. C'est un confort d'interface : la vraie protection est faite
 * cote serveur, ou toute ecriture est refusee pour ces comptes.
 */
// home : action sur MES donnees (mes collections MakerWorld), qui reste
// possible quand je parcours le BambuNymous d'un copain.
export default function AdminOnly({ children, fallback = null, home = false }) {
  const mine = useIsHomeAdmin(), here = useIsAdmin();
  return (home ? mine : here) ? children : fallback;
}
