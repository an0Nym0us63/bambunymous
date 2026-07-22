import React from "react";
import { createPortal } from "react-dom";
import { useIsAdmin } from "../store/auth";

/**
 * Bouton "+" d'ajout de photo, avec le meme comportement partout (fiche filament,
 * print, groupe) :
 *  - en navigateur : un petit popup propose "Prendre une photo" (input capture) ou
 *    "Choisir depuis la galerie" (input simple). Selon la plateforme, <input
 *    capture> ouvre la camera seule ou l'explorateur -> ce popup laisse le choix.
 *  - dans la WebView Android : le selecteur natif propose DEJA camera + galerie,
 *    donc notre popup ferait doublon. On declenche directement l'input simple et
 *    c'est Android qui affiche son choix.
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

  const camRef = React.useRef(null);
  const fileRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);

  if (!isAdmin) return null;

  const isWebView = typeof window !== "undefined" && !!window.BambuScan;

  const handle = async (e) => {
    // FileList preserve l'ordre de selection : sur mobile, l'ordre dans lequel
    // l'utilisateur a tape les vignettes (les numeros affiches).
    const files = Array.from(e.target.files || []);
    e.target.value = "";        // permet de reprendre les memes fichiers ensuite
    setOpen(false);
    // Sequentiel et non parallele : on ATTEND chaque onPick avant le suivant.
    // Si l'appelant fait un upload (onPick renvoie une promesse), les fichiers
    // arrivent au serveur dans l'ordre choisi. Sans await, les requetes
    // partiraient en meme temps et l'ordre serait celui, aleatoire, des
    // reponses reseau -- l'ordre des vignettes serait perdu.
    for (const f of files) {
      try { await onPick(f); }
      catch (err) { console.error("upload photo", err); }
    }
  };

  return (
    <>
      <button
        onClick={() => (isWebView ? fileRef.current?.click() : setOpen(true))}
        title={title}
        style={{ width:size, height:size, borderRadius:"50%", background:"#3b82f6",
          border:"none", cursor:"pointer", display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:Math.round(size*0.7), color:"white", fontWeight:700 }}>
        +
      </button>

      {/* Inputs caches : camera (capture) et galerie (simple). */}
      <input ref={camRef} type="file" accept="image/*" capture="environment"
        style={{ display:"none" }} onChange={handle}/>
      <input ref={fileRef} type="file" accept="image/*" multiple
        style={{ display:"none" }} onChange={handle}/>

      {open && createPortal(
        <div style={{ position:"fixed", inset:0, zIndex:4000, background:"rgba(0,0,0,0.5)" }}
          onClick={() => setOpen(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ position:"absolute", bottom:0, left:0, right:0,
            background:"var(--sheet-bg)", borderRadius:"20px 20px 0 0", padding:"20px 16px 32px" }}>
            <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)", margin:"0 auto 16px" }}/>
            <p style={{ fontWeight:700, fontSize:15, color:"var(--text)", margin:"0 0 16px" }}>{title}</p>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <button onClick={() => camRef.current?.click()}
                style={{ padding:"14px", borderRadius:12, border:"none", cursor:"pointer",
                  background:"var(--surface2)", color:"var(--text)", fontSize:14, fontWeight:600,
                  display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:22 }}>📷</span> Prendre une photo
              </button>
              <button onClick={() => fileRef.current?.click()}
                style={{ padding:"14px", borderRadius:12, border:"none", cursor:"pointer",
                  background:"var(--surface2)", color:"var(--text)", fontSize:14, fontWeight:600,
                  display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:22 }}>📁</span> Choisir depuis la galerie
              </button>
              <button onClick={() => setOpen(false)}
                style={{ padding:"12px", borderRadius:12, border:"1px solid var(--border)", cursor:"pointer",
                  background:"none", color:"var(--muted)", fontSize:13 }}>
                Annuler
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
