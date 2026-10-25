import client from "./api/client";
import { create } from "zustand";
import { currentFriend } from "./store/friend";

// Petits gestes caches dans l'appli : la page les signale au serveur, qui en
// fait une medaille secrete (sous-section des Secrets). Rien ne part chez un
// copain, et un geste deja signale ne l'est plus.
// ce que cet appareil retient, par compte (deux comptes sur le meme appareil ne se melangent pas) ;
// la premiere fois, le compte reprend ce que l'appareil retenait avant (24/10/2026)
const who = () => { try { return JSON.parse(localStorage.getItem("auth-store") || "{}").state?.username || ""; } catch { return ""; } };
function perUser(base) {
  const u = who(), k = u ? `${base}:${u}` : base;
  try { if (u && localStorage.getItem(k) == null && localStorage.getItem(base)) localStorage.setItem(k, localStorage.getItem(base)); } catch { /* rien */ }
  return k;
}
const KEY_ = () => perUser("bn-eggs");

const NC_ = () => perUser("bn-eggs-nc");       // trouves par un compte qui ne compte pas : bandeau deja montre
function seen(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); }
}
function done() { return seen(KEY_()); }

// Les secrets deja trouves, pour que les objets caches disparaissent une fois trouves (24/10/2026) :
// ce que cet appareil sait, complete au lancement par le serveur (trouve sur un autre appareil).
export const useEggsFound = create(() => ({ found: new Set([...seen(KEY_()), ...seen(NC_())]) }));
function noteFound(name) {
  const f = useEggsFound.getState().found;
  if (!f.has(name)) useEggsFound.setState({ found: new Set([...f, name]) });
}
/** Ce secret est-il deja trouve ? (un objet cache s'efface alors) */
export const useEggFound = name => useEggsFound(st => st.found.has(name));

// force : envoyer meme si cet appareil le croit deja trouve (une farce du jour J : le serveur, qui fait
// foi, repond « deja a toi » sans rien rejouer ; une memoire locale perimee ne doit pas la perdre)
export async function egg(name, force = false) {
  try { if (currentFriend()) return; } catch { /* pas de copain */ }
  const d = done();
  if (d.has(name) && !force) return;
  try {
    const { data } = await client.post(`/achievements/egg/${name}`);
    if (data?.locked) {
      // jouee mais pas gagnee : une fete hors de son jour, une farce venue par son adresse
      const k = "bn-locked-" + name;
      let told = false;
      try { told = !!sessionStorage.getItem(k); sessionStorage.setItem(k, "1"); } catch { /* rien */ }
      if (!told) whisper(data.emoji || "🔒", data.locked === "fete" ? "Pas aujourd'hui…" : "Joli, mais…",
        data.locked === "fete" ? "Ce secret-là ne se gagne que le jour de sa fête. Reviens à la bonne date !"
          : "Cette farce ne se gagne que si elle te tombe dessus par surprise, à l'ouverture de l'appli.");
      return;
    }
    if (data?.already && data.mine) {
      // deja vu par ce compte (un autre appareil) : rien a rejouer
      d.add(name);
      noteFound(name);
      try { localStorage.setItem(KEY_(), JSON.stringify([...d])); } catch { /* stockage indisponible */ }
      return;
    }
    if (data?.already) {
      // deja trouve dans la maison : ce compte l'a trouve lui aussi ; on le lui dit une fois (ca ne compte
      // pas), puis on ne redemande plus et l'objet s'efface pour lui
      d.add(name);
      noteFound(name);
      // un compte de la famille, lui, le gagne pour sa page (la maison l'avait deja)
      if (data.name) queued(done => celebrate(data, name, data.family ? "Pour toi ! (La maison l'avait déjà.)" : "Déjà trouvé dans la maison : ne compte pas", null, done));
      try { localStorage.setItem(KEY_(), JSON.stringify([...d])); } catch { /* stockage indisponible */ }
      return;
    }
    if (data?.uncounted) {
      // compte qui ne fait pas avancer les succes : on le felicite (une fois), sans rien enregistrer ;
      // s'il est coche plus tard, le prochain passage comptera pour de bon
      const nc = seen(NC_());
      if (!nc.has(name)) {
        nc.add(name);
        try { localStorage.setItem(NC_(), JSON.stringify([...nc])); } catch { /* stockage indisponible */ }
        // personne dans la maison ne l'a encore : ca ne compte pas, mais ca merite un bravo
        queued(done => celebrate(data, name, "Bravo ! Même la maison ne l'a pas encore. (Ce compte ne compte pas pour les succès.)", null, done));
        noteFound(name);
      }
      return;
    }
    d.add(name);
    try { localStorage.setItem(KEY_(), JSON.stringify([...d])); } catch { /* stockage indisponible */ }
    noteFound(name);
    if (data?.new) queued(done => celebrate(data, name, false, null, done));
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
// Un murmure : la meme petite carte que les succes, pour une simple annonce
export function whisper(emoji, title, text) {
  queued(done => celebrate({ emoji, name: title, lore: text }, "w_", false, null, done));
}

// Le bandeau dit ce qu'on vient de trouver, d'apres sa section (le serveur la donne : sub) ; sinon d'apres
// le nom (h_ page cachee, p_ farce), et a defaut easter egg
const SUB_KIND = {
  cachettes: ["🔎 Cachette dénichée !", "#0EA5E9"], hidden: ["🗺️ Page cachée réussie !", "#22C55E"],
  pranks: ["🌀 Farce découverte !", "#8B5CF6"], fetes: ["🎉 Fête trouvée !", "#F59E0B"],
  android: ["🤖 Secret Android trouvé !", "#16A34A"], eggs: ["🥚 Easter egg trouvé !", "#EC4899"],
};
const KIND = (n, sub) => n === "w_" ? ["🔮 Psst…", "#7C3AED"] : SUB_KIND[sub] || (n.startsWith("h_") ? SUB_KIND.hidden
  : n.startsWith("p_") ? SUB_KIND.pranks : SUB_KIND.eggs);

function celebrate(e, name = "", uncounted = false, kind = null, onGone = null) {
  const [head, col] = kind || KIND(name, e?.sub);
  const box = document.createElement("div");
  box.setAttribute("role", "status");
  box.style.cssText = "position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));z-index:9600;" +
    "transform:translate(-50%,20px);opacity:0;transition:all .35s cubic-bezier(.2,1.4,.4,1);max-width:calc(100vw - 32px);" +
    "width:340px;padding:14px 16px;border-radius:16px;background:var(--sheet-bg,#1e293b);color:var(--text,#fff);" +
    `border:1px solid ${col};box-shadow:0 12px 40px rgba(0,0,0,.45),0 0 0 4px ${col}2e;` +
    "display:flex;gap:12px;align-items:center;cursor:pointer;font-family:inherit";
  const big = document.createElement("span");
  big.textContent = e.emoji || "🥚";
  big.style.cssText = "font-size:34px;line-height:1;animation:bn-egg-pop .6s ease-out";
  const txt = document.createElement("span");
  txt.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0";
  const a = document.createElement("b");
  a.textContent = head;
  a.style.cssText = `font-size:12px;color:${col};text-transform:uppercase;letter-spacing:.05em`;
  const b = document.createElement("span");
  b.textContent = e.name || "";
  b.style.cssText = "font-size:15px;font-weight:800";
  const c = document.createElement("span");
  c.textContent = e.lore || "";
  c.style.cssText = "font-size:12.5px;opacity:.75;line-height:1.35";
  txt.append(a, b, c);
  if (uncounted) {
    const nc = document.createElement("span");
    nc.textContent = typeof uncounted === "string" ? uncounted : "Non comptabilisé : ce compte ne fait pas avancer les succès";
    nc.style.cssText = "font-size:11px;font-weight:700;color:#F59E0B;margin-top:2px";
    txt.append(nc);
  }
  box.append(big, txt);
  ensureStyle();
  document.body.appendChild(box);
  requestAnimationFrame(() => { box.style.opacity = "1"; box.style.transform = "translate(-50%,0)"; });
  let gone = false;
  const close = () => { if (gone) return; gone = true; box.style.opacity = "0"; box.style.transform = "translate(-50%,20px)";
    setTimeout(() => { box.remove(); onGone?.(); }, 400); };
  box.onclick = close;
  setTimeout(close, 6000);
}

// Un palier de succes atteint pendant qu'on utilise l'appli : la meme carte que les secrets, une a la fois
// (les secrets trouves passent par la meme file : plusieurs a la fois s'enchainent au lieu de s'empiler)
const cheers = [];
let cheering = false;
function nextCheer() {
  const show = cheers.shift();
  if (!show) { cheering = false; return; }
  cheering = true;
  // une carte qui ne rend jamais la main (erreur, minuteur gele) ne bloque plus toute la file (25/10/2026)
  let next = false;
  const go = () => { if (next) return; next = true; clearTimeout(guard); setTimeout(nextCheer, 250); };
  const guard = setTimeout(go, 12000);
  try { show(go); } catch { go(); }
}
function queued(show) {
  cheers.push(show);
  if (!cheering) nextCheer();
}
// onShown(vu) : appele quand la carte s'affiche, vu = l'ecran etait devant quelqu'un
export function cheer(c) {
  queued(done => { celebrate({ emoji: c.emoji, name: c.name, lore: c.text }, "", false, [c.head, c.color], done); c.onShown?.(!document.hidden); });
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
  ["benchy", "benchy"], ["spaghetti", "spaghetti"], ["iddqd", "iddqd"], ["coucou", "coucou"], ["buse", "buse"],
  // lot du 23/10/2026
  ["g28", "g28"], ["m600", "m600"], ["warping", "warping"], ["stringing", "stringing"], ["octoprint", "octoprint"],
  ["voron", "voron"], ["jarvis", "jarvis"], ["skynet", "skynet"], ["hodor", "hodor"], ["gandalf", "gandalf"], ["yoda", "yoda"],
  ["rickroll", "rickroll"], ["pizza", "pizza"], ["abracadabra", "abracadabra"], ["tardis", "tardis"]];
// Petits effets qui accompagnent certains secrets (rejouables : c'est pour le plaisir)
const FX = {
  // retour a l'origine : la page file dans le coin, puis revient
  g28: () => fxAnim([{ transform: "none" }, { transform: "translate(-45vw,-45vh) scale(.2)", offset: .45 },
    { transform: "translate(-45vw,-45vh) scale(.2)", offset: .6 }, { transform: "none" }], 1800),
  // tout danse
  rickroll: () => fxAnim([0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ transform: i === 8 ? "none" : `rotate(${i % 2 ? 3 : -3}deg) translateY(${i % 2 ? -8 : 0}px)` })), 2400),
  // disparu… et revenu
  abracadabra: () => fxAnim([{ opacity: 1, filter: "none" }, { opacity: 0, filter: "blur(12px)", offset: .4 },
    { opacity: 0, filter: "blur(12px)", offset: .6 }, { opacity: 1, filter: "none" }], 2200),
  pizza: () => fxRain(["🍕"]),
  // la buse qui file : des fils partout
  stringing: () => fxRain(["〰️", "➰", "🧵"]),
  // la piece qui se souleve dans les coins
  warping: () => fxAnim([{ transform: "none" }, { transform: "perspective(600px) rotateX(8deg)", offset: .5 }, { transform: "none" }], 1600),
  // l'ecran qui crie
  caps_lock: () => fxAnim([{ transform: "none" }, { transform: "scale(1.04)", offset: .2 }, { transform: "scale(.98)", offset: .4 }, { transform: "none" }], 500),
};
function fxAnim(frames, ms) {
  try { (document.querySelector("main.page-content") || document.body).animate(frames, { duration: ms, easing: "ease-in-out" }); } catch { /* sans animations */ }
}
function fxRain(set, up = false) {
  for (let i = 0; i < 22; i++) {
    const e = document.createElement("span");
    e.textContent = set[i % set.length];
    e.setAttribute("aria-hidden", "true");
    e.style.cssText = `position:fixed;left:${Math.random() * 96}vw;${up ? "bottom" : "top"}:-40px;font-size:${22 + Math.random() * 20}px;` +
      "z-index:9500;pointer-events:none";
    document.body.appendChild(e);
    const a = e.animate([{ transform: "none", opacity: 1 }, { transform: `translateY(${up ? "-" : ""}112vh) rotate(${Math.random() * 360 - 180}deg)`, opacity: .9 }],
      { duration: 2600 + Math.random() * 1800, delay: Math.random() * 900, easing: "linear", fill: "forwards" });
    a.onfinish = () => e.remove();
  }
}
const eggFx = name => { egg(name); FX[name]?.(); };
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
  let ki = 0, word = "", held = 0;
  const capsTap = tapper(12, 8000, () => eggFx("caps_lock"));
  window.addEventListener("keydown", e => {
    const k = (e.key || "").toLowerCase();
    ki = k === K[ki] ? ki + 1 : (k === K[0] ? 1 : 0);
    if (ki === K.length) { ki = 0; egg("konami"); }
    const tag = (e.target?.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable;
    if (!typing && k.length === 1) {
      word = (word + k).slice(-12);
      for (const [w, name] of WORDS) if (word.endsWith(w)) eggFx(name);
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
    // lot du 23/10/2026 : touches oubliees, raccourcis, majuscules qui crient, touche coincee
    if (k === "pause") egg("pause_key");
    if (k === "insert") egg("insert_key");
    if (k === "f1") { e.preventDefault(); egg("f1"); }
    if ((e.ctrlKey || e.metaKey) && !typing && (k === "y" || (e.shiftKey && k === "z"))) egg("redo");
    if ((e.ctrlKey || e.metaKey) && k === "d") egg("bookmark");
    if (typing && k.length === 1 && /[a-z]/i.test(k) && e.getModifierState?.("CapsLock")) capsTap();
    if (e.repeat) { if (++held === 80) egg("key_hold"); } else held = 0;
  });
  // la touche Impr. ecran n'arrive qu'au relachement (le systeme garde l'appui)
  window.addEventListener("keyup", e => { if ((e.key || "").toLowerCase() === "printscreen") egg("print_screen"); });
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
  installEggs2();
}

// ── Lot du 23/10/2026 ───────────────────────────────────────────────────────
// Ce que seule l'appli Android voit (24/10/2026) : la vraie lampe torche, une capture d'ecran, la luminosite,
// les capteurs, le mode avion… Elle appelle window.__bnEgg(nom) ; seuls ces noms-la sont acceptes.
const NATIVE = new Set([
  "airplane", "altitude", "big_font", "bold_text", "brightness_max", "brightness_min", "cold_phone", "dark_room",
  "display_zoom", "do_not_disturb", "elevator", "fast_charge", "four_sides", "fresh_apk", "from_notif", "hardware_keyboard",
  "headphones", "hot_phone", "hotspot", "humid_air", "just_booted", "knock_knock", "level", "magnet",
  "network_switch", "new_android", "nod", "nope", "north", "old_android", "pocket", "power_save",
  "print_screen", "proximity", "roaming", "rotation_lock", "screen_recording", "silence", "sos_torch", "spin_phone",
  "split_screen", "storage_full", "storm", "sunlight", "tablet", "time_travel", "timezone", "torch",
  "uptime_30", "vibrate_mode", "volume_dj", "volume_max", "vpn", "wireless_charge",
]);
function installEggs2() {
  // ce que la maison a deja trouve (sur n'importe quel appareil) : les objets caches s'effacent
  if (!currentFriend()) client.get("/achievements/eggs-found", { home: true }).then(({ data }) => {
    if (!Array.isArray(data?.found)) return;
    // le serveur fait foi : cet appareil retient exactement ce que ce compte a trouve. Un secret que
    // l'appareil croyait fait sans que le serveur l'ait note au nom de ce compte (avant le suivi par
    // compte, un secret deja a la maison n'etait pas note pour la famille) redevient faisable (25/10/2026)
    const srv = new Set(data.found);
    try { localStorage.setItem(KEY_(), JSON.stringify([...srv])); } catch { /* rien */ }
    useEggsFound.setState({ found: new Set([...srv, ...seen(NC_())]) });
  }).catch(() => {});
  window.__bnEgg = name => { if (NATIVE.has(name)) egg(name); };
  // ce que l'appli a annonce avant que la page soit prete
  (window.__bnEggQ || []).forEach(n => window.__bnEgg(n));
  window.__bnEggQ = [];
  // le chargeur branche pendant qu'on est la
  try {
    navigator.getBattery?.().then(b => { b.addEventListener("chargingchange", () => { if (b.charging) egg("plugged"); }); }).catch(() => {});
  } catch { /* pas d'API batterie */ }
  // le theme du systeme bascule sous nos yeux
  try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => egg("os_theme")); } catch { /* rien */ }
  // un stylet, un ecran de cinema
  window.addEventListener("pointerdown", e => { if (e.pointerType === "pen") egg("stylus"); }, { passive: true });
  if ((screen.width || 0) * (window.devicePixelRatio || 1) >= 3800) egg("ultra_hd");
  // trois onglets de l'appli ouverts en meme temps
  try {
    const me = Math.random().toString(36).slice(2), seen = new Map();
    const ch = new BroadcastChannel("bn-eggs");
    ch.onmessage = ({ data }) => {
      if (!data?.id) return;
      seen.set(data.id, Date.now());
      if (data.t === "hi") ch.postMessage({ t: "here", id: me });
      const live = [...seen.values()].filter(t => Date.now() - t < 5000).length;
      if (live >= 2) egg("clones");
    };
    ch.postMessage({ t: "hi", id: me });
  } catch { /* pas de canal */ }
  // gestes a plusieurs doigts : cinq doigts ; deux doigts qui tournent ; deux doigts tenus la nuit (lampe de poche)
  let rot = null, torchT = null;
  const angle = t => Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180 / Math.PI;
  window.addEventListener("touchstart", e => {
    if (e.touches.length >= 5) egg("high_five");
    if (e.touches.length === 2) {
      rot = { a: angle(e.touches), total: 0 };
      const h = new Date().getHours();
      clearTimeout(torchT);
      if (h >= 21 || h < 6) torchT = setTimeout(torch, 3000);
    }
  }, { passive: true });
  window.addEventListener("touchmove", e => {
    if (e.touches.length !== 2 || !rot) return;
    const a = angle(e.touches);
    let d = a - rot.a;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    rot.total += d; rot.a = a;
    if (Math.abs(d) > 2) clearTimeout(torchT);
    if (Math.abs(rot.total) > 270) { rot.total = 0; egg("spinner"); }
  }, { passive: true });
  window.addEventListener("touchend", e => { if (e.touches.length < 2) { rot = null; clearTimeout(torchT); } }, { passive: true });
  // le crabe : beaucoup de defilement de cote, a la molette ou au pave
  let side = 0, sideT = 0;
  window.addEventListener("wheel", e => {
    const now = Date.now();
    if (now - sideT > 5000) side = 0;
    sideT = now;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) side += Math.abs(e.deltaX);
    if (side > 5000) { side = 0; egg("crab"); }
  }, { passive: true });
  // heures et jours : l'apero du vendredi, le lundi aux aurores, la pleine lune, midi pile, le dimanche matin, l'heure du the
  const cal = () => {
    const d = new Date(), h = d.getHours(), m = d.getMinutes(), day = d.getDay();
    if (day === 5 && h === 18) egg("apero");
    if (day === 1 && h === 7) egg("monday_morning");
    if (h === 12 && m === 0) egg("noon");
    if (day === 0 && h >= 6 && h < 8) egg("sunday_early");
    if (h === 17 && m === 0) egg("tea_time");
    const phase = (((d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % 29.530588853 + 29.530588853) % 29.530588853;
    if (phase > 14.3 && phase < 15.3 && (h >= 20 || h < 6)) egg("full_moon");
  };
  cal();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") cal(); });
  // cote a cote : sur ordinateur, la fenetre a la moitie de l'ecran (l'autre moitie pour autre chose)
  const half = () => {
    if (window.matchMedia("(pointer: fine)").matches && screen.width >= 1200) {
      const r = window.outerWidth / screen.availWidth;
      if (r > 0.45 && r < 0.55 && window.outerHeight > screen.availHeight * 0.85) egg("split_screen");
    }
  };
  let hz = null;
  window.addEventListener("resize", () => { clearTimeout(hz); hz = setTimeout(half, 800); });
  half();
  // la fenetre redimensionnee vingt fois en dix secondes
  let rz = null;
  const resizes = tapper(20, 10000, () => egg("resizer"));
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(resizes, 120); });
  // le centieme lancement sur cet appareil
  try {
    const n = (parseInt(localStorage.getItem("bn-launches")) || 0) + 1;
    localStorage.setItem("bn-launches", String(n));
    if (n >= 100) egg("launches_100");
  } catch { /* stockage indisponible */ }
  // un joker dans un champ
  window.addEventListener("input", e => { if ((e.target?.tagName || "") === "INPUT" && (e.target.value || "").trim() === "*") egg("wildcard"); });
  // un cercle bien rond, au doigt ou a la souris (bouton tenu)
  let path = null;
  window.addEventListener("pointerdown", e => { path = [[e.clientX, e.clientY]]; }, { passive: true });
  window.addEventListener("pointermove", e => { if (path && (e.buttons || e.pointerType === "touch")) path.push([e.clientX, e.clientY]); }, { passive: true });
  window.addEventListener("pointerup", () => { if (path && round(path)) egg("circle"); path = null; }, { passive: true });
  // ce qui se cache dans les pages : un element marque data-egg, a toucher data-egg-n fois (4 s au plus)
  const marks = {};
  window.addEventListener("click", e => {
    const el = e.target?.closest?.("[data-egg]");
    if (!el) return;
    const name = el.getAttribute("data-egg"), n = parseInt(el.getAttribute("data-egg-n")) || 1;
    if (!marks[name]) marks[name] = tapper(n, 4000, () => egg(name));
    marks[name]();
  }, true);
}

// un trace ferme, assez grand, a rayon regulier : un cercle
function round(p) {
  if (p.length < 24) return false;
  const cx = p.reduce((t, q) => t + q[0], 0) / p.length, cy = p.reduce((t, q) => t + q[1], 0) / p.length;
  const r = p.map(q => Math.hypot(q[0] - cx, q[1] - cy)), mean = r.reduce((t, x) => t + x, 0) / r.length;
  if (mean < 50) return false;
  const dev = Math.sqrt(r.reduce((t, x) => t + (x - mean) ** 2, 0) / r.length) / mean;
  const closed = Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < mean * 0.45;
  let turn = 0;
  for (let i = 1; i < p.length; i++) {
    let d = Math.atan2(p[i][1] - cy, p[i][0] - cx) - Math.atan2(p[i - 1][1] - cy, p[i - 1][0] - cx);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    turn += d;
  }
  return closed && dev < 0.12 && Math.abs(turn) > 5.6;
}

// lampe de poche : l'ecran tout blanc quelques secondes
function torch() {
  egg("torch");
  const w = document.createElement("div");
  w.setAttribute("aria-hidden", "true");
  w.style.cssText = "position:fixed;inset:0;z-index:9700;background:#fff;opacity:0;transition:opacity .4s;pointer-events:none";
  document.body.appendChild(w);
  requestAnimationFrame(() => { w.style.opacity = "1"; });
  setTimeout(() => { w.style.opacity = "0"; setTimeout(() => w.remove(), 500); }, 5000);
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
