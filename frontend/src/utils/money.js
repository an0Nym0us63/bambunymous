import { useAuth, ROLE_READONLY } from "../store/auth";

/** Symbole affiche a la place d'un montant masque. */
export const MONEY_MASK = "—";

/**
 * Vrai si les montants doivent etre masques. Seul ROLE_READONLY est concerne :
 * ROLE_READONLY_PRICES est aussi en lecture seule mais voit les montants.
 * Lecture synchrone du store : utilisable dans des fonctions de formatage qui
 * ne sont pas des composants React.
 */
export const isMoneyHidden = () => useAuth.getState().role === ROLE_READONLY;

/**
 * Formate un nombre en montant, ou renvoie le masque en lecture seule.
 * N'inclut pas le symbole monetaire : les appelants gardent le leur.
 */
export const moneyVal = (v, digits = 2) =>
  isMoneyHidden() ? MONEY_MASK : Number(v || 0).toFixed(digits);
