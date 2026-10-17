import { useEffect } from "react";

// Aucun champ de l'application ne doit etre rempli par un gestionnaire de mots
// de passe (Bitwarden prenait le numero de serie pour un identifiant et le
// code d'acces de l'imprimante pour un mot de passe). Monte dans le Layout :
// la page de connexion, hors Layout, garde le remplissage automatique.
//
// Plutot que de marquer chaque champ (et d'oublier les prochains), on marque
// TOUT champ present ou ajoute ensuite, fenetres en portail comprises :
//  - data-bwignore (Bitwarden), data-1p-ignore (1Password), data-lpignore
//    (LastPass), data-form-type="other" (Dashlane) ;
//  - autocomplete neutre si le champ n'en declare pas : "off", et
//    "new-password" pour un champ mot de passe (les navigateurs ignorent "off"
//    sur ceux-la).
const SEL = "input, textarea, select, form";

function mark(el) {
  if (el.hasAttribute("data-bwignore")) return;
  el.setAttribute("data-bwignore", "true");
  el.setAttribute("data-1p-ignore", "true");
  el.setAttribute("data-lpignore", "true");
  el.setAttribute("data-form-type", "other");
  if ((el.tagName === "INPUT" || el.tagName === "FORM") && !el.hasAttribute("autocomplete")) {
    el.setAttribute("autocomplete", el.type === "password" ? "new-password" : "off");
  }
}

export default function NoAutofill() {
  useEffect(() => {
    const scan = (root) => {
      if (root.matches?.(SEL)) mark(root);
      root.querySelectorAll?.(SEL).forEach(mark);
    };
    scan(document.body);
    const mo = new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return null;
}
