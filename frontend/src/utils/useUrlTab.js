import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// Onglet d'une page porte par l'adresse (?tab=…) : un rafraichissement ou un
// changement de maison (store/friend, qui recharge la meme page en gardant
// ces cles) rouvre le meme onglet, et le bouton Retour revient a l'onglet
// precedent comme a une page. L'onglet par defaut n'ecrit rien dans l'adresse.
// Une valeur inconnue (lien ancien, onglet absent ici) retombe sur le defaut.
export const TAB_KEYS = ["tab", "mw", "afaire"];

export function useUrlTab(key, def, allowed) {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = raw && (!allowed || allowed.includes(raw)) ? raw : def;
  const setValue = useCallback((v) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v === def || v == null) next.delete(key); else next.set(key, v);
      return next;
    });
  }, [key, def, setParams]);
  return [value, setValue];
}

// Les cles d'onglets de l'adresse courante, pour les garder quand une page
// remplace ses autres parametres (fiche ouverte par ?id=…).
export function keepTabs(params, extra = {}) {
  const out = {};
  for (const k of TAB_KEYS) {
    const v = params.get(k);
    if (v) out[k] = v;
  }
  return { ...out, ...extra };
}
