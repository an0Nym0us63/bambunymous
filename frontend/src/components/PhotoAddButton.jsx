import React from "react";
import { createPortal } from "react-dom";
import { useIsAdmin } from "../store/auth";
import { useShares } from "../store/shares";

/**
 * Bouton "+" d'ajout de photo, avec le meme comportement partout (fiche filament,
 * print, groupe) :
 *  - directement le selecteur du systeme quand il propose deja tout : iPhone /
 *    iPad (Phototheque, Prendre une photo ou une video, Fichiers), notre appli
 *    Android (camera + galerie), et l'ordinateur (pas de camera a proposer) ;
 *  - un petit popup "Prendre une photo" (input capture) / "Choisir depuis la
 *    galerie" seulement dans un navigateur Android : selon le navigateur, son
 *    selecteur n'offre pas toujours l'appareil photo.
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
  const androidBrowser = !isWebView && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");

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
        onClick={() => (androidBrowser ? setOpen(true) : fileRef.current?.click())}
        title={title}
        style={{ width:size, height:size, borderRadius:"50%", background:"linear-gradient(135deg, #3B82F6, #6366F1)",
          boxShadow:"0 6px 14px -6px #3B82F6", border:"none", cursor:"pointer", display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:Math.round(size*0.7), color:"white", fontWeight:700 }}>
        +
      </button>

      {/* Inputs caches : camera (capture) et galerie (simple). */}
      <input ref={camRef} type="file" accept="image/*" capture="environment"
        style={{ display:"none" }} onChange={handle}/>
      <input ref={fileRef} type="file" accept="image/*,video/*" multiple
        style={{ display:"none" }} onChange={handle}/>

      {open && createPortal(
        <div style={{ position:"fixed", inset:0, zIndex:4000, background:"rgba(0,0,0,0.5)" }}
          onClick={() => setOpen(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ position:"absolute", bottom:0, left:0, right:0, overflow:"hidden",
            background:"var(--sheet-bg)", borderRadius:"22px 22px 0 0", padding:"0 16px calc(24px + env(safe-area-inset-bottom, 0px))" }}>
            <div style={{ margin:"0 -16px 14px", padding:"14px 18px 14px",
              background:"radial-gradient(circle at 12% 30%, rgba(59,130,246,0.35), transparent 60%), var(--surface2)" }}>
              <div style={{ width:38, height:4, borderRadius:2, background:"rgba(148,163,184,.6)", margin:"0 auto 12px" }}/>
              <p style={{ fontWeight:900, fontSize:17, color:"var(--text)", margin:0 }}>📸 {title}</p>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {[["📷", "Prendre une photo", "l'appareil photo du téléphone", "#3B82F6", () => camRef.current?.click()],
                ["🖼️", "Choisir depuis la galerie", "photos et vidéos, plusieurs à la fois", "#8B5CF6", () => fileRef.current?.click()]].map(([ic, l, d, c, on]) => (
                <button key={l} onClick={on}
                  style={{ padding:"12px 14px", borderRadius:16, cursor:"pointer", textAlign:"left",
                    border:`1px solid color-mix(in srgb, ${c} 30%, var(--border))`,
                    background:`linear-gradient(135deg, ${c}1c, transparent 60%), var(--surface2)`, color:"var(--text)",
                    display:"flex", alignItems:"center", gap:12 }}>
                  <span style={{ width:42, height:42, borderRadius:14, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:21,
                    background:`linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 60%, #ffffff))`, boxShadow:`0 6px 14px -6px ${c}` }}>{ic}</span>
                  <span style={{ display:"flex", flexDirection:"column", gap:1 }}>
                    <span style={{ fontSize:14.5, fontWeight:800 }}>{l}</span>
                    <span style={{ fontSize:12, fontWeight:600, color:"var(--muted)" }}>{d}</span>
                  </span>
                </button>))}
              <button onClick={() => setOpen(false)}
                style={{ padding:"12px", borderRadius:14, border:"1px solid var(--border)", cursor:"pointer",
                  background:"var(--surface2)", color:"var(--text)", fontSize:13.5, fontWeight:800 }}>
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
