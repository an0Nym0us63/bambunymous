import { useEffect } from "react";

// Aucun champ de l'application ne doit etre rempli par un gestionnaire de mots
// de passe ou par le remplissage du navigateur (Bitwarden prenait le numero de
// serie pour un identifiant ; iOS proposait « Préremplir le contact » et des
// codes Bitwarden sur la recherche des filaments, a cause du mot « nom » de son
// texte indicatif). Monte dans le Layout : la page de connexion, hors Layout,
// garde le remplissage automatique.
//
// Plutot que de marquer chaque champ (et d'oublier les prochains), on marque
// TOUT champ present ou ajoute ensuite, fenetres en portail comprises, et on
// remarque un champ dont React change les attributs :
//  - data-bwignore (Bitwarden), data-1p-ignore (1Password), data-lpignore
//    (LastPass), data-form-type="other" (Dashlane) ;
//  - autocomplete force a "off" (« new-password » pour un mot de passe, que
//    les navigateurs ignorent sinon) ; seuls les usages voulus sont gardes
//    (code a usage unique et mot de passe actuel de la double authentification) ;
//  - un nom de champ neutre et aleatoire : iOS et Chrome devinent le role d'un
//    champ d'apres son nom ;
//  - dans le texte indicatif et l'etiquette accessible, les mots qui font
//    deviner un contact ou un identifiant (« nom », « adresse », « e-mail »…)
//    sont coupes par un caractere invisible : meme affichage, plus de devinette.
const SEL = "input, textarea, select, form";
const KEEP = new Set(["one-time-code", "current-password", "new-password"]);
const NO_TEXT = new Set(["checkbox", "radio", "range", "color", "file", "hidden", "submit", "button", "reset", "image"]);
const ZW = "‌";
const TRIGGERS = /\b(pr[ée]nom|nom|names?|adresses?|address|e-?mails?|courriel|t[ée]l[ée]phone|phone|mobile|ville|city|pays|country|soci[ée]t[ée]|entreprise|company|code postal|postal|zip|utilisateurs?|username|user|login|identifiant|mot de passe|password|contact)\b/gi;

const rid = () => "bn_" + Math.random().toString(36).slice(2, 10);
// Casse les mots declencheurs (idempotent : un mot deja casse ne correspond plus).
const scramble = (t) => t && t.replace(TRIGGERS, w => w[0] + ZW + w.slice(1));

function mark(el) {
  if (!el.hasAttribute("data-bwignore")) {
    el.setAttribute("data-bwignore", "true");
    el.setAttribute("data-1p-ignore", "true");
    el.setAttribute("data-lpignore", "true");
    el.setAttribute("data-form-type", "other");
  }
  if (el.tagName === "FORM") {
    if (el.getAttribute("autocomplete") !== "off") el.setAttribute("autocomplete", "off");
    return;
  }
  const isText = el.tagName !== "INPUT" || !NO_TEXT.has(el.type);
  if (!isText) return;
  const ac = el.getAttribute("autocomplete");
  const want = KEEP.has(ac) ? ac : (el.type === "password" ? "new-password" : "off");
  if (ac !== want) el.setAttribute("autocomplete", want);
  if (!(el.getAttribute("name") || "").startsWith("bn_")) el.setAttribute("name", rid());
  for (const a of ["placeholder", "aria-label"]) {
    const v = el.getAttribute(a);
    const s = scramble(v);
    if (s !== v) el.setAttribute(a, s);
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
      for (const m of muts) {
        if (m.type === "attributes") { if (m.target.matches?.(SEL)) mark(m.target); continue; }
        for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
      }
    });
    // Attributs aussi : React remet un texte indicatif ou un autocomplete quand
    // sa valeur change ; mark() est idempotent, il ne reecrit que si besoin.
    mo.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["placeholder", "aria-label", "autocomplete", "name"] });
    return () => mo.disconnect();
  }, []);
  return null;
}
