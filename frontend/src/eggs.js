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
    "@keyframes bn-shine{0%{filter:brightness(1)}50%{filter:brightness(1.8) drop-shadow(0 0 10px #fff)}100%{filter:brightness(1)}}" +
    "@keyframes bn-jiggle{0%,100%{transform:none}25%{transform:rotate(-12deg)}75%{transform:rotate(12deg)}}";
  document.head.appendChild(st);
}

const WORDS = [["bambu", "magic_word"], ["sudo", "sudo"], ["bonjour", "hello"], ["ping", "ping"],
  ["merci", "thanks"], ["xyzzy", "xyzzy"], ["aide", "help"], ["matrix", "matrix"], ["lumos", "lumos"],
  ["benchy", "benchy"], ["spaghetti", "spaghetti"], ["iddqd", "iddqd"], ["coucou", "coucou"], ["buse", "buse"]];
const escTap = tapper(10, 5000, () => egg("escape"));
const undoTap = tapper(10, 5000, () => egg("undo"));
const shiftTap = tapper(5, 2000, () => egg("sticky"));
const tabTap = tapper(20, 10000, () => egg("tabber"));

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
      word = (word + k).slice(-12);
      for (const [w, name] of WORDS) if (word.endsWith(w)) egg(name);
    }
    // raccourcis : tout selectionner (hors champ), chercher dans la page, s'evader
    if ((e.ctrlKey || e.metaKey) && k === "a" && !typing) egg("select_all");
    if ((e.ctrlKey || e.metaKey) && k === "f") egg("find");
    if (k === "escape") escTap();
    // sous le capot, enregistrer, annuler, Maj a repetition, tabulations, evasion
    if (k === "f12") egg("devtools");
    if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); egg("save"); }
    if ((e.ctrlKey || e.metaKey) && k === "z" && !typing) undoTap();
    if (k === "shift" && !e.repeat) shiftTap();
    if (k === "tab") tabTap();
    if (e.altKey && k === "f4") egg("alt_f4");
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
    if (v === "1337") egg("leet_input");
  });
  // secouer : trois a-coups violents en une seconde et demie
  const shake = tapper(3, 1500, () => egg("shake"));
  let lastJolt = 0;
  window.addEventListener("devicemotion", e => {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a) return;
    const g = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
    const now = Date.now();
    if (g > 25 && now - lastJolt > 150) { lastJolt = now; shake(); }
  });
  // retourner : ecran vers le bas, ou tete en bas, une seconde
  let flipT = null;
  const flipped = (beta, gamma) => Math.abs(beta) > 150 || (beta < -60 && Math.abs(gamma) < 30);
  window.addEventListener("deviceorientation", e => {
    if (e.beta == null) return;
    if (flipped(e.beta, e.gamma || 0)) { if (!flipT) flipT = setTimeout(() => egg("flip"), 1000); }
    else if (flipT) { clearTimeout(flipT); flipT = null; }
  });
  try {
    screen.orientation?.addEventListener?.("change", () => {
      if ((screen.orientation.type || "").includes("secondary") && screen.orientation.type.startsWith("portrait")) egg("flip");
    });
  } catch { /* pas d'orientation */ }
  // imprimer la page, plein ecran, copier, tunnel
  window.addEventListener("beforeprint", () => egg("print_page"));
  document.addEventListener("fullscreenchange", () => { if (document.fullscreenElement) egg("fullscreen"); });
  document.addEventListener("copy", () => { if (String(window.getSelection?.() || "").trim()) egg("copycat"); });
  let wentOff = false;
  window.addEventListener("offline", () => { wentOff = true; });
  window.addEventListener("online", () => { if (wentOff) setTimeout(() => egg("offline"), 2000); });
  // taille de fenetre : timbre-poste ou cinema
  const size = () => {
    if (window.innerWidth < 300) egg("tiny");
    if (window.innerWidth > 2500) egg("giant");
  };
  window.addEventListener("resize", size);
  size();
  // furax : 15 clics au meme endroit en 3 secondes
  let spot = null, clicks = [];
  window.addEventListener("click", e => {
    const now = Date.now(), here = `${Math.round(e.clientX / 20)}:${Math.round(e.clientY / 20)}`;
    if (here !== spot) { spot = here; clicks = []; }
    clicks = clicks.filter(x => now - x < 3000);
    clicks.push(now);
    if (clicks.length >= 15) { clicks = []; egg("rage"); }
  }, true);
  // clics droits
  const rightTap = tapper(5, 3000, () => egg("right_click"));
  window.addEventListener("contextmenu", () => rightTap());
  // yo-yo : tout en bas puis tout en haut, 3 fois en 20 secondes
  let edge = null;
  const yoyo = tapper(6, 20000, () => egg("yoyo"));
  // (la page defile dans la fenetre sur telephone, dans son conteneur sur ordinateur)
  window.addEventListener("scroll", e => {
    const el = e.target === document ? document.documentElement : e.target;
    if (!el || el.scrollHeight == null) return;
    const max = el.scrollHeight - el.clientHeight, y = el === document.documentElement ? window.scrollY : el.scrollTop;
    if (max < 400) return;
    const at = y <= 2 ? "top" : y >= max - 2 ? "bottom" : null;
    if (at && at !== edge) { edge = at; yoyo(); }
  }, { passive: true, capture: true });
  // loupe : zoom au doigt
  window.visualViewport?.addEventListener("resize", () => { if (window.visualViewport.scale > 2) egg("zoom"); });
  // paysage, sur un telephone
  const land = () => { if (window.matchMedia("(pointer: coarse)").matches && window.innerWidth > window.innerHeight
    && window.innerHeight < 600) egg("landscape"); };
  window.addEventListener("orientationchange", () => setTimeout(land, 500));
  // marche arriere : 5 retours en 10 secondes
  const back = tapper(5, 10000, () => egg("moonwalk"));
  window.addEventListener("popstate", () => back());
  // cache-cache : 10 allers-retours en 30 secondes
  const hide = tapper(10, 30000, () => egg("hide_seek"));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") hide(); });
  // fichier lache hors d'une zone de depot ; texte colle dans un champ
  // (hors zone, le navigateur ouvrirait le fichier a la place de l'appli : on l'en empeche)
  const files = e => [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragover", e => { if (files(e) && !e.defaultPrevented) e.preventDefault(); });
  window.addEventListener("drop", e => { if (files(e) && !e.defaultPrevented) { e.preventDefault(); egg("drop"); } });
  window.addEventListener("paste", e => {
    const tag = (e.target?.tagName || "").toLowerCase();
    if ((tag === "input" || tag === "textarea") && (e.clipboardData?.getData("text") || "").trim()) egg("paste");
  });
  // sieste : 30 minutes visible sans un geste
  let idle = null;
  const wake = () => { clearTimeout(idle); idle = setTimeout(() => { if (document.visibilityState === "visible") egg("nap"); }, 30 * 60000); };
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach(t => window.addEventListener(t, wake, { passive: true }));
  wake();
  // heures remarquables, a l'ouverture ou au retour sur l'appli
  const clock = () => {
    const d = new Date(), hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (hm === "13:37") egg("leet_time");
    if (hm === "11:11") egg("wish");
    if (hm === "0:00") egg("midnight_open");
    if (hm === "12:34") egg("time_1234");
    if (hm === "22:22") egg("time_2222");
    if (hm === "3:14") egg("time_314");
    if (hm === "4:04") egg("time_404");
    if (hm === "23:59") egg("time_2359");
    if (d.getHours() === 5) egg("dawn");
    if (d.getMonth() === 3 && d.getDate() === 1) egg("april_fool");
    if (d.getMonth() === 1 && d.getDate() === 29) egg("leap_open");
    // theme clair en pleine nuit
    if (d.getHours() < 5 && document.documentElement.getAttribute("data-theme") === "light") egg("sunglasses");
  };
  clock();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") clock(); });
  // une manette branchee
  window.addEventListener("gamepadconnected", () => egg("gamepad"));
  // souris agitee : 12 changements de sens en une seconde et demie
  let lastX = null, dir = 0;
  const wiggle = tapper(12, 1500, () => egg("mouse_shake"));
  window.addEventListener("mousemove", e => {
    if (lastX != null && Math.abs(e.clientX - lastX) > 8) {
      const d = e.clientX > lastX ? 1 : -1;
      if (d !== dir) { dir = d; wiggle(); }
    }
    lastX = e.clientX;
  }, { passive: true });
  // trois heures d'affilee
  setTimeout(() => egg("marathon_session"), 3 * 3600000);
  // un mot laisse dans la console, et la commande qui va avec
  try {
    window.bambunymous = () => { egg("console"); return "🖨️ Accès accordé."; };
    console.log("%c🖨️ BambuNymous", "font-size:16px;font-weight:900;color:#8B5CF6",
      "\nPsst… tu as trouvé la salle des machines. Tape bambunymous() pour entrer.");
  } catch { /* pas de console */ }
  // navigateur dans une autre langue
  if (navigator.language && !navigator.language.toLowerCase().startsWith("fr")) egg("polyglot");
  // batterie presque vide, ou pleine et branchee
  try {
    navigator.getBattery?.().then(b => {
      const chk = () => {
        if (b.level < 0.05 && !b.charging) egg("battery");
        if (b.level >= 1 && b.charging) egg("full_battery");
      };
      chk();
      b.addEventListener("levelchange", chk);
    }).catch(() => {});
  } catch { /* pas d'API batterie */ }
  try {
    const now = Date.now();
    const r = JSON.parse(sessionStorage.getItem("bn-reloads") || "[]").filter(x => now - x < 30000);
    r.push(now);
    sessionStorage.setItem("bn-reloads", JSON.stringify(r));
    if (r.length >= 5) setTimeout(() => egg("impatient"), 1500);
  } catch { /* stockage indisponible */ }
}

// Changements de page : 15 en 30 secondes ; cloche : 10 en 5 secondes
const pageTaps = tapper(15, 30000, () => egg("zapper"));
export const pageChanged = () => pageTaps();
const bellTaps = tapper(10, 5000, () => egg("bell"));
export const bellRung = () => bellTaps();

// Regles des succes : 5 ouvertures en une minute
const rulesTaps = tapper(5, 60000, () => egg("rtfm"));
export const rulesOpened = () => rulesTaps();

// Bascules de theme : 10 en une minute
const themeTaps = tapper(10, 60000, () => egg("disco"));
export const themeToggled = () => themeTaps();
