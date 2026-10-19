// Tirer-pour-rafraichir de la PWA iPhone / iPad (installee sur l'ecran
// d'accueil). iOS n'en fournit pas en mode « ecran d'accueil » ; Safari et la
// coquille Android ont deja le leur, ils ne sont pas concernes.
//
// Ne change rien au defilement : les ecouteurs sont passifs (jamais de
// preventDefault), on ne fait que lire le geste. Le geste ne s'arme que :
//  - en haut de la page (conteneur principal a 0) ;
//  - hors d'une rangee qui defile de cote, et hors d'une liste interne
//    deja defilee ;
//  - sans fenetre ouverte par-dessus ([data-no-pull]) ;
//  - et il s'abandonne des que le doigt part plus de cote que vers le bas.
// Relache au-dela du seuil : la page se recharge.

const THRESHOLD = 70;     // px tires (apres amortissement) pour recharger
const MAX = 110;

let installed = false;

const isIosStandalone = () => typeof window !== "undefined" && (
  window.navigator.standalone === true
  || (/iPhone|iPad|iPod/.test(navigator.userAgent) && window.matchMedia?.("(display-mode: standalone)").matches));

function pageTop() {
  const main = document.querySelector("main.page-content");
  const y = main ? main.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0);
  return y <= 0 && (window.scrollY || 0) <= 0;
}

// Une zone qui defile de cote, ou une liste interne pas en haut : pas pour nous.
function blockedBy(el) {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e.matches?.("main.page-content")) break;
    const cs = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 2 && (cs.overflowX === "auto" || cs.overflowX === "scroll")) return true;
    if (e.scrollTop > 0 && (cs.overflowY === "auto" || cs.overflowY === "scroll")) return true;
  }
  return false;
}

function indicator() {
  let el = document.getElementById("ios-ptr");
  if (el) return el;
  el = document.createElement("div");
  el.id = "ios-ptr";
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    position: "fixed", left: "50%", top: "calc(var(--header-h, 52px) + 4px)", zIndex: "4500",
    width: "36px", height: "36px", marginLeft: "-18px", borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
    background: "var(--sheet-bg, #1e1e2e)", border: "1px solid var(--border, rgba(128,128,128,0.3))",
    boxShadow: "0 4px 14px rgba(0,0,0,0.3)", color: "#3b82f6", fontSize: "19px", fontWeight: "700",
    opacity: "0", transform: "translateY(-50px)", transition: "opacity .15s",
  });
  el.textContent = "↻";
  document.body.appendChild(el);
  return el;
}

export function installIosPullRefresh(force = false) {
  if (installed || !(force || isIosStandalone())) return;
  installed = true;
  let start = null;            // { x, y } du doigt, si le geste est arme
  let pull = 0;
  let locked = false;          // direction decidee (verticale)

  const show = (d) => {
    const el = indicator();
    const p = Math.min(1, d / THRESHOLD);
    el.style.transition = "opacity .15s";
    el.style.opacity = String(Math.min(1, p * 1.2));
    el.style.transform = `translateY(${Math.min(d, MAX) - 40}px) rotate(${p * 300}deg)`;
    el.style.color = p >= 1 ? "#22c55e" : "#3b82f6";
  };
  const hide = () => {
    const el = document.getElementById("ios-ptr");
    if (!el) return;
    el.style.transition = "opacity .2s, transform .2s";
    el.style.opacity = "0";
    el.style.transform = "translateY(-50px)";
  };

  document.addEventListener("touchstart", (e) => {
    start = null; pull = 0; locked = false;
    if (e.touches.length !== 1 || !pageTop() || document.querySelector("[data-no-pull]") || blockedBy(e.target)) return;
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true, capture: true });

  document.addEventListener("touchmove", (e) => {
    if (!start) return;
    const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
    if (!locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) > Math.abs(dy) || dy < 0) { start = null; return; }   // de cote ou vers le haut : pas pour nous
      locked = true;
    }
    if (!pageTop()) { start = null; hide(); return; }
    pull = Math.max(0, dy * 0.5);
    show(pull);
  }, { passive: true, capture: true });

  const end = () => {
    if (!start) return;
    start = null;
    if (pull >= THRESHOLD) {
      const el = indicator();
      el.style.transform = `translateY(${THRESHOLD - 40}px)`;
      el.style.animation = "ios-ptr-spin .7s linear infinite";
      if (!document.getElementById("ios-ptr-kf")) {
        const st = document.createElement("style");
        st.id = "ios-ptr-kf";
        st.textContent = "@keyframes ios-ptr-spin{from{rotate:0deg}to{rotate:360deg}}";
        document.head.appendChild(st);
      }
      setTimeout(() => window.location.reload(), 150);
    } else hide();
    pull = 0;
  };
  document.addEventListener("touchend", end, { passive: true, capture: true });
  document.addEventListener("touchcancel", () => { start = null; pull = 0; hide(); }, { passive: true, capture: true });
}
