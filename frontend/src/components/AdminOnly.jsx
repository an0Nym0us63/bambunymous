import { useIsAdmin } from "../store/auth";

/**
 * N'affiche ses enfants que pour un administrateur.
 * Sert a masquer les actions (creation, edition, suppression) aux comptes en
 * lecture seule. C'est un confort d'interface : la vraie protection est faite
 * cote serveur, ou toute ecriture est refusee pour ces comptes.
 */
export default function AdminOnly({ children, fallback = null }) {
  return useIsAdmin() ? children : fallback;
}
