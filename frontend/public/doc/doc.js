// Guide de BambuNymous : charge les chapitres, construit le sommaire, cherche dans le texte.
// Ajouter un chapitre = un fichier dans pages/ + une ligne ici (l'ordre est celui du menu).
const CHAPTERS = [
  ["premiers-pas", "Premiers pas"],
  ["accueil", "Accueil"],
  ["tuiles", "Les tuiles de l'accueil"],
  ["imprimante", "Imprimante et AMS"],
  ["impressions", "Impressions"],
  ["filaments", "Filaments"],
  ["objets", "Objets et ventes"],
  ["stats", "Statistiques"],
  ["makerworld", "MakerWorld"],
  ["notifications", "Notifications"],
  ["copains", "Copains"],
  ["succes", "Succès"],
  ["parametres", "Paramètres"],
];

const $ = s => document.querySelector(s);
const content = $("#content"), tree = $("#tree"), results = $("#results"), q = $("#q");
const ICON = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slug = s => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- theme (memorise par visiteur, sans obligation) ----
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* prive */ } } };
const saved = store.get("doc-theme");
if (saved) document.documentElement.dataset.theme = saved;
$("#theme").onclick = () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next; store.set("doc-theme", next);
};

// ---- menu du telephone ----
const setMenu = open => { document.body.classList.toggle("menu", open); $("#burger").setAttribute("aria-expanded", open); };
$("#burger").onclick = () => setMenu(!document.body.classList.contains("menu"));
$("#veil").onclick = () => setMenu(false);

// ---- chargement ----
async function load() {
  const parts = await Promise.all(CHAPTERS.map(([f]) =>
    fetch(`pages/${f}.html`, { cache: "no-cache" }).then(r => r.ok ? r.text() : `<h1>${f}</h1><p>Chapitre introuvable.</p>`)
      .catch(() => `<h1>${f}</h1><p>Chapitre introuvable.</p>`)));
  content.innerHTML = parts.map((h, i) => `<article class="chapter" id="${CHAPTERS[i][0]}">${h}</article>`).join("");
  decorate();
  buildTree();
  buildIndex();
  const h = decodeURIComponent(location.hash.slice(1));
  if (h) { const t = document.getElementById(h); if (t) { openTo(h); t.scrollIntoView(); } }
  watchScroll();
}

// ancres sur les titres, captures agrandissables
function decorate() {
  content.querySelectorAll("h1, h2, h3, h4").forEach(h => {
    if (h.tagName === "H1") return;
    let id = h.id || h.closest("section")?.id;
    if (!id || h.closest("section")?.querySelector("h2, h3, h4") !== h) { id = h.id || slug(h.textContent); h.id = id; }
    const a = document.createElement("a"); a.className = "anchor"; a.href = "#" + id; a.textContent = "#"; a.setAttribute("aria-label", "Lien vers cette partie");
    h.appendChild(a);
  });
  content.querySelectorAll("figure img").forEach(img => {
    img.loading = "lazy";
    img.onclick = () => { const z = $("#zoom"); z.querySelector("img").src = img.src; z.querySelector("p").textContent = img.closest("figure").querySelector("figcaption")?.textContent || ""; z.hidden = false; };
  });
  $("#zoom").onclick = () => { $("#zoom").hidden = true; };
}

// ---- sommaire en arborescence : chapitre (h1) > h2 > h3 ----
function idOf(h) { const s = h.closest("section"); return s && s.querySelector("h2, h3, h4") === h ? s.id : h.id; }
function buildTree() {
  const html = [];
  content.querySelectorAll("article.chapter").forEach(ch => {
    const h1 = ch.querySelector("h1");
    const kids = [...ch.querySelectorAll("h2, h3")];
    const sub = [];
    let cur = null;
    kids.forEach(h => {
      const item = { id: idOf(h), text: h.firstChild.textContent.trim(), kids: [] };
      if (h.tagName === "H2" || !cur) { cur = item; sub.push(item); } else cur.kids.push(item);
    });
    const li = (it, top) => `<li data-id="${it.id}"><div class="row"><button class="tog${it.kids.length ? "" : " leaf"}" aria-label="Déplier">${ICON}</button>`
      + `<a href="#${it.id}">${esc(it.text)}</a></div>${it.kids.length ? `<ul>${it.kids.map(k => li(k)).join("")}</ul>` : ""}</li>`;
    html.push(li({ id: ch.id, text: h1 ? h1.textContent.trim() : ch.id, kids: sub }, true));
  });
  tree.innerHTML = html.join("");
  tree.addEventListener("click", e => {
    const t = e.target.closest(".tog");
    if (t) { t.closest("li").classList.toggle("open"); return; }
    const a = e.target.closest("a");
    if (a) { a.closest("li").classList.add("open"); if (matchMedia("(max-width: 900px)").matches) setMenu(false); clearSearch(); }
  });
  $("#expand").onclick = () => tree.querySelectorAll("li").forEach(l => l.querySelector("ul") && l.classList.add("open"));
  $("#collapse").onclick = () => tree.querySelectorAll("li").forEach(l => l.classList.remove("open"));
}
function openTo(id) {
  const li = tree.querySelector(`li[data-id="${CSS.escape(id)}"]`);
  let p = li; while (p) { if (p.tagName === "LI") p.classList.add("open"); p = p.parentElement?.closest("li"); }
}
function watchScroll() {
  const heads = [...content.querySelectorAll("h1, h2, h3")];
  let tick = false;
  addEventListener("scroll", () => {
    if (tick) return; tick = true;
    requestAnimationFrame(() => {
      tick = false;
      let cur = heads[0];
      for (const h of heads) { if (h.getBoundingClientRect().top < 120) cur = h; else break; }
      const id = cur.tagName === "H1" ? cur.closest("article").id : idOf(cur);
      tree.querySelectorAll("a.cur").forEach(a => a.classList.remove("cur"));
      const a = tree.querySelector(`a[href="#${CSS.escape(id)}"]`);
      if (a) a.classList.add("cur");
    });
  }, { passive: true });
}

// ---- recherche plein texte, par section ----
let INDEX = [];
function buildIndex() {
  INDEX = [];
  content.querySelectorAll("article.chapter").forEach(ch => {
    const chap = ch.querySelector("h1")?.textContent.trim() || "";
    let block = { id: ch.id, title: chap, chap, text: "" };
    const push = () => { if (block.text.trim() || block.title) INDEX.push({ ...block, n: norm(block.title + " " + block.text) }); };
    const walk = node => {
      for (const el of node.children) {
        if (/^H[1-4]$/.test(el.tagName)) {
          if (el.tagName !== "H1") { push(); block = { id: idOf(el), title: el.firstChild.textContent.trim(), chap, text: "" }; }
        } else if (el.tagName === "SECTION") walk(el);
        else block.text += " " + (el.innerText || el.textContent);
      }
    };
    walk(ch); push();
  });
}
function clearSearch() { if (q.value) { q.value = ""; results.hidden = true; content.hidden = false; } }
function search(v) {
  const words = norm(v).split(/\s+/).filter(w => w.length > 1);
  if (!words.length) { results.hidden = true; content.hidden = false; return; }
  const hits = INDEX.map(b => {
    if (!words.every(w => b.n.includes(w))) return null;
    const score = words.reduce((s, w) => s + (norm(b.title).includes(w) ? 10 : 0) + Math.min(5, b.n.split(w).length - 1), 0);
    return { b, score };
  }).filter(Boolean).sort((a, c) => c.score - a.score).slice(0, 40);
  const mark = s => { let out = esc(s); words.forEach(w => { out = out.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>"); }); return out; };
  const snippet = t => {
    const n = norm(t), i = Math.max(0, n.indexOf(words[0]) - 60);
    return (i ? "…" : "") + t.replace(/\s+/g, " ").slice(i, i + 180).trim() + "…";
  };
  results.innerHTML = `<h2>${hits.length ? `${hits.length} résultat${hits.length > 1 ? "s" : ""}` : "Aucun résultat"} pour « ${esc(v)} »</h2>`
    + hits.map(({ b }) => `<a class="hit" href="#${b.id}"><small>${esc(b.chap)}</small><b>${mark(b.title)}</b><span>${mark(snippet(b.text.replace(/\s+/g, " ")))}</span></a>`).join("");
  results.hidden = false; content.hidden = true;
}
q.addEventListener("input", () => search(q.value));
results.addEventListener("click", e => {
  const a = e.target.closest("a.hit"); if (!a) return;
  e.preventDefault();
  const id = a.getAttribute("href").slice(1);
  clearSearch(); setMenu(false); openTo(id);
  history.replaceState(null, "", "#" + id);
  document.getElementById(id)?.scrollIntoView();
});
addEventListener("hashchange", () => { const id = decodeURIComponent(location.hash.slice(1)); if (id) { clearSearch(); openTo(id); } });

load();
