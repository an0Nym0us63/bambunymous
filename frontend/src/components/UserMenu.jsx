import React from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { LogOut, Trophy } from "lucide-react";
import { useAuth, ROLE_LABEL, ROLE_ADMIN } from "../store/auth";
import { FriendPicker, useFriendsPrinting } from "./Friends";

// Violet du scrim natif de la coquille Android : le meme, pour que la pastille
// se lise comme une continuite de l'application et non comme un accent de plus.
const AVATAR_BG = "#4f46e5";

/**
 * Pastille ronde portant l'initiale du compte, et menu associe.
 *
 * Sur mobile c'etait le seul manque bloquant : la deconnexion n'existait que
 * dans la sidebar desktop, donc un telephone n'avait aucun moyen de changer de
 * compte.
 *
 * placement="bottom" : le menu s'ouvre sous la pastille (header mobile).
 * placement="top"    : il s'ouvre au-dessus (bas de la sidebar desktop).
 *
 * Le menu est rendu par portail sur <body> et positionne en coordonnees
 * absolues. Un simple enfant en position:fixed ne suffirait pas : le header
 * porte un backdrop-filter, qui fait de lui un bloc conteneur pour ses
 * descendants fixed -- le menu serait reste prisonnier de la barre.
 */
export default function UserMenu({ placement = "bottom", showName = false, size = 30 }) {
  const username = useAuth((s) => s.username);
  const role     = useAuth((s) => s.role);
  const logout   = useAuth((s) => s.logout);
  const navigate = useNavigate();

  const btnRef = React.useRef(null);
  const [rect, setRect] = React.useState(null);   // null = menu ferme

  // Repositionner sur scroll/resize serait du luxe : on ferme, c'est plus
  // previsible qu'un menu qui derive a cote de son ancre.
  React.useEffect(() => {
    if (!rect) return;
    const close = () => setRect(null);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [rect]);

  const initial = (username || "").trim().charAt(0).toUpperCase() || "?";
  const roleLabel = ROLE_LABEL[role] || ROLE_LABEL[ROLE_ADMIN];

  const toggle = () => {
    if (rect) return setRect(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  };

  const doLogout = () => { setRect(null); logout(); navigate("/login"); };

  const menuPos = rect
    ? (placement === "top"
        ? { bottom: window.innerHeight - rect.top + 8, left: rect.left }
        : { top: rect.bottom + 8, right: window.innerWidth - rect.right })
    : null;

  const busy = useFriendsPrinting();          // copains qui impriment en ce moment
  return (
    <>
      <button ref={btnRef} onClick={toggle} aria-label="Compte"
        title={busy ? `${busy} copain${busy > 1 ? "s" : ""} en train d'imprimer` : undefined}
        style={{ display:"flex", alignItems:"center", gap:9, flexShrink:0,
          background:"none", border:"none", padding:0, cursor:"pointer" }}>
        <span style={{ width:size, height:size, borderRadius:"50%", flexShrink:0,
          background:AVATAR_BG, color:"white", fontWeight:700,
          fontSize:Math.round(size*0.45), lineHeight:1,
          display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
          {initial}
          {/* Activite chez les copains : un point vert, le nombre s'ils sont plusieurs */}
          {busy > 0 && (
            <span style={{ animation:"friendPulse 2.4s ease-in-out infinite", position:"absolute", top:-3, right:-4, minWidth: busy > 1 ? 15 : 10,
              height: busy > 1 ? 15 : 10, padding: busy > 1 ? "0 3px" : 0, borderRadius:8, background:"#22c55e",
              color:"white", fontSize:9, fontWeight:800, lineHeight:"15px", textAlign:"center", boxSizing:"border-box",
              boxShadow:"0 0 0 2px var(--surface)" }}>{busy > 1 ? busy : ""}</span>
          )}
        </span>
        {showName && (
          <span style={{ fontSize:13, color:"var(--text2)", overflow:"hidden",
            textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {username || "Compte"}
          </span>
        )}
      </button>

      {rect && createPortal(
        <>
          <div onClick={() => setRect(null)}
            style={{ position:"fixed", inset:0, zIndex:2999 }}/>
          <div style={{ position:"fixed", zIndex:3000, ...menuPos,
            minWidth:200, borderRadius:12, overflow:"hidden",
            background:"var(--sheet-bg)", border:"1px solid var(--border)",
            boxShadow:"0 10px 30px rgba(0,0,0,0.35)" }}>
            <div style={{ padding:"12px 14px", borderBottom:"1px solid var(--border)" }}>
              <p style={{ margin:0, fontSize:13, fontWeight:700, color:"var(--text)",
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {username || "Compte"}
              </p>
              <p style={{ margin:"2px 0 0", fontSize:11, color:"var(--muted)" }}>{roleLabel}</p>
            </div>
            <FriendPicker onDone={() => setRect(null)}/>
            <button onClick={() => { setRect(null); navigate("/stats?tab=achievements"); }}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:10,
                padding:"12px 14px", background:"none", border:"none", borderBottom:"1px solid var(--border)",
                cursor:"pointer", color:"var(--text)", fontSize:13, fontWeight:600, textAlign:"left" }}>
              <Trophy size={16} color="#F59E0B"/> Succès
            </button>
            <button onClick={doLogout}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:10,
                padding:"12px 14px", background:"none", border:"none", cursor:"pointer",
                color:"#ef4444", fontSize:13, fontWeight:600, textAlign:"left" }}>
              <LogOut size={16}/> Déconnexion
            </button>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
