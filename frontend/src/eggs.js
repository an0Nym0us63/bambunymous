import client from "./api/client";
import { currentFriend } from "./store/friend";

// Petits gestes caches dans l'appli : la page les signale au serveur, qui en
// fait une medaille secrete (sous-section des Secrets). Rien ne part chez un
// copain, et un geste deja signale ne l'est plus.
const KEY = "bn-eggs";

function done() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { return new Set(); }
}

export async function egg(name) {
  try { if (currentFriend()) return; } catch { /* pas de copain */ }
  const d = done();
  if (d.has(name)) return;
  try {
    const { data } = await client.post(`/achievements/egg/${name}`);
    d.add(name);
    try { localStorage.setItem(KEY, JSON.stringify([...d])); } catch { /* stockage indisponible */ }
    if (data?.new) celebrate(data);
  } catch { /* hors connexion, ou pas connecte : on retentera */ }
}

// n gestes en moins de ms millisecondes -> fn
export function tapper(n, ms, fn) {
  let t = [];
  return () => {
    const now = Date.now();
    t = t.filter(x => now - x < ms);
    t.push(now);
    if (t.length >= n) { t = []; fn(); }
  };
}

// Bravo : une carte qui monte en bas de l'ecran, se ferme au toucher ou seule.
function celebrate(e) {
  const box = document.createElement("div");
  box.setAttribute("role", "status");
  box.style.cssText = "position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));z-index:9600;" +
    "transform:translate(-50%,20px);opacity:0;transition:all .35s cubic-bezier(.2,1.4,.4,1);max-width:calc(100vw - 32px);" +
    "width:340px;padding:14px 16px;border-radius:16px;background:var(--sheet-bg,#1e293b);color:var(--text,#fff);" +
    "border:1px solid #EC4899;box-shadow:0 12px 40px rgba(0,0,0,.45),0 0 0 4px rgba(236,72,153,.18);" +
    "display:flex;gap:12px;align-items:center;cursor:pointer;font-family:inherit";
  const big = document.createElement("span");
  big.textContent = e.emoji || "🥚";
  big.style.cssText = "font-size:34px;line-height:1;animation:bn-egg-pop .6s ease-out";
  const txt = document.createElement("span");
  txt.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0";
  const a = document.createElement("b");
  a.textContent = "🥚 Easter egg trouvé !";
  a.style.cssText = "font-size:12px;color:#EC4899;text-transform:uppercase;letter-spacing:.05em";
  const b = document.createElement("span");
  b.textContent = e.name || "";
  b.style.cssText = "font-size:15px;font-weight:800";
  const c = document.createElement("span");
  c.textContent = e.lore || "";
  c.style.cssText = "font-size:12.5px;opacity:.75;line-height:1.35";
  txt.append(a, b, c);
  box.append(big, txt);
  ensureStyle();
  document.body.appendChild(box);
  requestAnimationFrame(() => { box.style.opacity = "1"; box.style.transform = "translate(-50%,0)"; });
  const close = () => { box.style.opacity = "0"; box.style.transform = "translate(-50%,20px)"; setTimeout(() => box.remove(), 400); };
  box.onclick = close;
  setTimeout(close, 6000);
}

function ensureStyle() {
  if (document.getElementById("bn-egg-style")) return;
  const st = document.createElement("style");
  st.id = "bn-egg-style";
  st.textContent = "@keyframes bn-egg-pop{0%{transform:scale(.2) rotate(-30deg)}60%{transform:scale(1.3) rotate(10deg)}100%{transform:none}}" +
    "@keyframes bn-spin{to{transform:rotate(720deg)}}" +
    "@keyframes bn-shine{0%{filter:brightness(1)}50%{filter:brightness(1.8) drop-shadow(0 0 10px #fff)}100%{filter:brightness(1)}}";
  document.head.appendChild(st);
}

// Les guetteurs globaux : clavier, doigt, recherches, rechargements.
export function installEggs() {
  if (window.__bnEggs) return;
  window.__bnEggs = true;
  ensureStyle();
  const K = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];
  let ki = 0, word = "";
  window.addEventListener("keydown", e => {
    const k = (e.key || "").toLowerCase();
    ki = k === K[ki] ? ki + 1 : (k === K[0] ? 1 : 0);
    if (ki === K.length) { ki = 0; egg("konami"); }
    const tag = (e.target?.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable;
    if (!typing && k.length === 1) {
      word = (word + k).slice(-5);
      if (word === "bambu") egg("magic_word");
    }
  });
  // au doigt : glisser haut, haut, bas, bas, gauche, droite, gauche, droite, puis toucher deux fois
  const S = ["U", "U", "D", "D", "L", "R", "L", "R", "T", "T"];
  let si = 0, x0 = 0, y0 = 0;
  window.addEventListener("touchstart", e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
  window.addEventListener("touchend", e => {
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    const g = Math.max(Math.abs(dx), Math.abs(dy)) < 12 ? "T" : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U");
    si = g === S[si] ? si + 1 : (g === S[0] ? 1 : 0);
    if (si === S.length) { si = 0; egg("konami"); }
  }, { passive: true });
  window.addEventListener("input", e => {
    if ((e.target?.tagName || "") !== "INPUT") return;
    const v = (e.target.value || "").trim().toLowerCase();
    if (v === "42") egg("answer");
    if (v === "easter egg" || v === "easteregg") egg("seeker");
  });
  try {
    const now = Date.now();
    const r = JSON.parse(sessionStorage.getItem("bn-reloads") || "[]").filter(x => now - x < 30000);
    r.push(now);
    sessionStorage.setItem("bn-reloads", JSON.stringify(r));
    if (r.length >= 5) setTimeout(() => egg("impatient"), 1500);
  } catch { /* stockage indisponible */ }
}

// Bascules de theme : 10 en une minute
const themeTaps = tapper(10, 60000, () => egg("disco"));
export const themeToggled = () => themeTaps();
