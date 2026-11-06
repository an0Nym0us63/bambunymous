"""Le guide d'utilisation en site statique (06/11/2026), publie sur GitHub Pages par .github/workflows/guide.yml.

Une seule source : les chapitres de backend/guide (pages et captures), leur ordre, leurs icones et couleurs lus dans
frontend/src/pages/Guide.jsx, la mise en forme dans frontend/src/pages/guide.css et les couleurs du theme dans
frontend/src/index.css. Le site suit donc le guide de l'appli a chaque poussee, sans rien recopier a la main.

    python scripts/build_guide.py <dossier de sortie>
"""
import html
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / "backend" / "guide"
JSX = ROOT / "frontend" / "src" / "pages" / "Guide.jsx"
CSS = ROOT / "frontend" / "src" / "pages" / "guide.css"
THEME = ROOT / "frontend" / "src" / "index.css"


def chapters() -> list:
    src = JSX.read_text(encoding="utf-8")
    block = re.search(r"const CHAPTERS = \[(.*?)\];", src, re.S).group(1)
    order = re.findall(r'\[\s*"([a-z0-9-]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]', block)
    look_block = re.search(r"const CH_LOOK = \{(.*?)\};", src, re.S).group(1)
    look = {k: (ic, c) for k, ic, c in re.findall(r'"?([a-z0-9-]+)"?\s*:\s*\[\s*"([^"]+)"\s*,\s*"(#[0-9A-Fa-f]{3,8})"\s*\]', look_block)}
    return [(f, t, *look.get(f, ("📘", "#3B82F6"))) for f, t in order]


def theme_vars() -> tuple:
    """Les variables du theme sombre (:root) et clair ([data-theme="light"]) de l'appli."""
    src = THEME.read_text(encoding="utf-8")
    # les blocs qui portent les couleurs (--bg), pas ceux qui ne posent que color-scheme
    dark = re.search(r"\n:root \{([^}]*--bg:[^}]*)\}", src).group(1)
    light = re.search(r'\n\[data-theme="light"\] \{([^}]*--bg:[^}]*)\}', src).group(1)
    return dark.strip(), light.strip()


def build(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    if (out / "img").exists():
        shutil.rmtree(out / "img")
    shutil.copytree(GUIDE / "img", out / "img")
    parts, nav = [], []
    for f, title, ic, color in chapters():
        p = GUIDE / "pages" / f"{f}.html"
        body = p.read_text(encoding="utf-8") if p.is_file() else f"<h1>{html.escape(title)}</h1><p>Chapitre introuvable.</p>"
        # l'icone du chapitre dans son titre, comme dans l'appli
        body = re.sub(r"<h1>", f'<h1><span class="gd-ic">{ic}</span>', body, count=1)
        body = re.sub(r"<img\b", '<img loading="lazy"', body)
        parts.append(f'<article class="chapter" id="{f}" style="--ch:{color}" data-ic="{ic}">{body}</article>')
        nav.append({"id": f, "title": title, "ic": ic, "color": color})
    dark, light = theme_vars()
    css = CSS.read_text(encoding="utf-8")
    page = TEMPLATE.replace("/*THEME_DARK*/", dark).replace("/*THEME_LIGHT*/", light).replace("/*GUIDE_CSS*/", css) \
        .replace("<!--CONTENT-->", "".join(parts)).replace("/*NAV*/", json.dumps(nav, ensure_ascii=False))
    (out / "index.html").write_text(page, encoding="utf-8")
    (out / ".nojekyll").write_text("", encoding="utf-8")
    print(f"guide : {len(parts)} chapitres -> {out}")


TEMPLATE = r"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guide BambuNymous</title>
<meta name="description" content="Le guide d'utilisation de BambuNymous : imprimante, AMS, filaments, impressions, MakerWorld, copains.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📘</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root { color-scheme: dark; /*THEME_DARK*/ }
:root[data-theme="light"] { color-scheme: light; /*THEME_LIGHT*/ }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { color-scheme: light; /*THEME_LIGHT*/ } }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); font-family: "Inter", -apple-system, "Segoe UI", sans-serif; }
body { padding: 0 16px; }
.page { max-width: 1240px; margin: 0 auto; }
/*GUIDE_CSS*/
/* le site seul (hors appli) */
.bn-guide .gd-bar { top: 0; }
/* un lien vers une partie : son titre sous la barre collee en haut, pas derriere */
.bn-guide [id] { scroll-margin-top: 76px; }
.bn-guide .gd-col { top: 70px; }
.bn-guide .gd-theme { width: 40px; height: 40px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface2); color: var(--text); cursor: pointer; flex: none; font-size: 17px; }
.bn-guide .gd-menu { display: none; }
.bn-guide .gd-foot { color: var(--muted); font-size: 13px; padding: 10px 0 40px; }
@media (max-width: 900px) {
  .bn-guide .gd-col { display: none; }
  .bn-guide .gd-menu { display: grid; }
  .bn-guide .gd-title span { display: none; }
}
</style>
</head>
<body>
<div class="page bn-guide" id="guide">
  <div class="gd-bar">
    <button class="gd-menu" id="menuBtn" aria-label="Sommaire">☰</button>
    <a class="gd-title" href="#" style="text-decoration:none">📘 <span>Guide BambuNymous</span></a>
    <label class="gd-search">🔍<input id="q" type="search" placeholder="Rechercher dans le guide…" autocomplete="off"></label>
    <button class="gd-theme" id="themeBtn" aria-label="Thème clair ou sombre">🌓</button>
  </div>
  <div class="gd-wrap">
    <nav class="gd-col" id="col"><ul class="gd-tree" id="tree"></ul></nav>
    <main class="gd-main">
      <div class="gd-results" id="results" hidden></div>
      <div class="gd-content" id="content"><!--CONTENT--></div>
      <p class="gd-foot">Ce guide suit la dernière version de BambuNymous ; il est publié depuis le dépôt à chaque mise à jour.</p>
    </main>
  </div>
</div>
<script>
(function () {
  var NAV = /*NAV*/;
  var root = document.documentElement;
  try { var t = localStorage.getItem("bn_guide_theme"); if (t) root.setAttribute("data-theme", t); } catch (e) {}
  document.getElementById("themeBtn").onclick = function () {
    var dark = root.getAttribute("data-theme") ? root.getAttribute("data-theme") === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
    var next = dark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("bn_guide_theme", next); } catch (e) {}
  };
  var norm = function (s) { return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); };
  var esc = function (s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var content = document.getElementById("content");
  // les parties : chaque <section id> avec son titre (h2/h3), sous son chapitre
  var idOf = function (h) { var s = h.closest("section"); return s && s.querySelector("h2, h3, h4") === h ? s.id : h.id; };
  var tree = "";
  NAV.forEach(function (c) {
    var art = document.getElementById(c.id);
    var subs = art ? [].slice.call(art.querySelectorAll("h2")) : [];
    tree += '<li><div class="row"><a class="top" style="--ch:' + c.color + '" href="#' + c.id + '"><span class="ic">' + c.ic + "</span>" + esc(c.title) + "</a></div>";
    if (subs.length) {
      tree += "<ul>";
      subs.forEach(function (h) { var id = idOf(h); if (id) tree += '<li><div class="row"><a href="#' + id + '">' + esc(h.textContent.trim()) + "</a></div></li>"; });
      tree += "</ul>";
    }
    tree += "</li>";
  });
  var treeEl = document.getElementById("tree");
  treeEl.innerHTML = tree;
  // le chapitre en cours se deplie dans le sommaire
  var tops = [].slice.call(treeEl.querySelectorAll("a.top"));
  var onScroll = function () {
    var cur = null;
    NAV.forEach(function (c) { var a = document.getElementById(c.id); if (a && a.getBoundingClientRect().top < 120) cur = c.id; });
    tops.forEach(function (a) {
      var on = a.getAttribute("href") === "#" + cur;
      a.classList.toggle("cur", on);
      a.closest("li").classList.toggle("open", on);
    });
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  // le sommaire au telephone : le meme, en tiroir
  document.getElementById("menuBtn").onclick = function () {
    var d = document.createElement("div");
    d.className = "bn-guide gd-drawer";
    d.innerHTML = '<div><div class="gd-drawer-head"><b>Sommaire</b><button aria-label="Fermer">✕</button></div><ul class="gd-tree">' + tree + "</ul></div>";
    [].forEach.call(d.querySelectorAll("li"), function (li) { li.classList.add("open"); });
    d.onclick = function (e) { if (e.target === d || e.target.closest("a") || e.target.closest("button")) d.remove(); };
    document.body.appendChild(d);
  };
  // agrandir une capture
  content.addEventListener("click", function (e) {
    var img = e.target.closest("figure img");
    if (!img) return;
    var z = document.createElement("div");
    z.className = "bn-guide gd-zoom";
    var cap = img.closest("figure").querySelector("figcaption");
    z.innerHTML = '<img src="' + img.getAttribute("src") + '" alt="">' + (cap ? "<p>" + esc(cap.textContent) + "</p>" : "");
    z.onclick = function () { z.remove(); };
    document.body.appendChild(z);
  });
  // la recherche : les parties dont le texte contient tous les mots
  var parts = [].slice.call(content.querySelectorAll("section[id]")).map(function (s) {
    var h = s.querySelector("h2, h3, h4"), art = s.closest("article");
    return { id: s.id, title: h ? h.textContent.trim() : s.id, chap: art ? (NAV.filter(function (c) { return c.id === art.id; })[0] || {}).title : "", text: norm(s.textContent), raw: s.textContent };
  });
  var results = document.getElementById("results");
  var timer = null;
  document.getElementById("q").addEventListener("input", function (e) {
    clearTimeout(timer);
    var v = e.target.value;
    timer = setTimeout(function () {
      var words = norm(v).split(/\s+/).filter(Boolean);
      if (!words.length) { results.hidden = true; content.hidden = false; return; }
      var hits = parts.filter(function (p) { return words.every(function (w) { return p.text.indexOf(w) >= 0; }); }).slice(0, 60);
      var out = "<h2>" + hits.length + (hits.length >= 60 ? "+" : "") + " résultat" + (hits.length > 1 ? "s" : "") + "</h2>";
      hits.forEach(function (p) {
        var i = p.text.indexOf(words[0]), ex = p.raw.slice(Math.max(0, i - 60), i + 120).replace(/\s+/g, " ").trim();
        out += '<a class="hit" href="#' + p.id + '"><small>' + esc(p.chap || "") + "</small><b>" + esc(p.title) + "</b><span>…" + esc(ex) + "…</span></a>";
      });
      results.innerHTML = out;
      results.hidden = false;
      content.hidden = true;
    }, 150);
  });
  results.addEventListener("click", function (e) {
    var a = e.target.closest("a.hit");
    if (!a) return;
    document.getElementById("q").value = "";
    results.hidden = true;
    content.hidden = false;
  });
})();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    build(Path(sys.argv[1] if len(sys.argv) > 1 else "_site"))
