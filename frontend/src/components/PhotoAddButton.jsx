import React from "react";
import { useIsAdmin } from "../store/auth";
import { useShares } from "../store/shares";

/**
 * Bouton "+" d'ajout de photo, avec le meme comportement partout (fiche filament,
 * print, groupe) : il ouvre directement le selecteur du systeme, qui propose
 * deja tout -- iPhone : Phototheque / Prendre une photo ou une video / Fichiers ;
 * Android (appli ou navigateur) : appareil photo / galerie / fichiers ;
 * ordinateur : l'explorateur. Notre ancien popup « Prendre une photo / Choisir
 * depuis la galerie » faisait donc doublon (et « Prendre » ouvrait l'explorateur
 * sur ordinateur).
 *
 * onPick(file) est appele une fois PAR fichier choisi, dans l'ordre de
 * selection. Sur telephone, la galerie numerote les photos au moment du choix :
 * cet ordre est celui de FileList, on le respecte donc tel quel. Les appelants
 * qui n'attendent qu'une photo continuent de marcher -- ils reçoivent juste
 * plusieurs appels successifs au lieu d'un.
 */
export default function PhotoAddButton({ onPick, size = 20, title = "Ajouter une photo" }) {
  // Ajout de photo = action : masque pour les comptes en lecture seule.
  // Le garde est place APRES les hooks (regles des hooks).
  const isAdmin = useIsAdmin();

  const fileRef = React.useRef(null);

  if (!isAdmin) return null;

  const handle = async (e) => {
    // FileList preserve l'ordre de selection : sur mobile, l'ordre dans lequel
    // l'utilisateur a tape les vignettes (les numeros affiches).
    const files = Array.from(e.target.files || []);
    e.target.value = "";        // permet de reprendre les memes fichiers ensuite
    // Sequentiel et non parallele : on ATTEND chaque onPick avant le suivant.
    // Si l'appelant fait un upload (onPick renvoie une promesse), les fichiers
    // arrivent au serveur dans l'ordre choisi. Sans await, les requetes
    // partiraient en meme temps et l'ordre serait celui, aleatoire, des
    // reponses reseau -- l'ordre des vignettes serait perdu.
    // Chaque envoi est suivi par la puce du header : une grosse video (envoi
    // puis compression) peut durer, on garde la main et on voit ou ca en est.
    for (const f of files) {
      try { await useShares.getState().upload(f, () => Promise.resolve(onPick(f))); }
      catch (err) { console.error("upload photo", err); }
    }
  };

  return (
    <>
      <button
        onClick={() => fileRef.current?.click()}
        title={title}
        style={{ width:size, height:size, borderRadius:"50%", background:"#3b82f6",
          border:"none", cursor:"pointer", display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:Math.round(size*0.7), color:"white", fontWeight:700 }}>
        +
      </button>

      {/* Selecteur du systeme : photos, appareil photo, fichiers (plusieurs a la fois). */}
      <input ref={fileRef} type="file" accept="image/*,video/*" multiple
        style={{ display:"none" }} onChange={handle}/>
    </>
  );
}
