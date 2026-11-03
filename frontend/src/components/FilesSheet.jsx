import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client, { apiUrl } from "../api/client";
import { FSheet, fBtn } from "./FicheKit";
import { showAlert, showConfirm } from "../utils/dialog";
import { toast } from "../store/toast";
import { egg } from "../eggs";

// Les fichiers associes d'une impression ou d'un groupe (03/11/2026) : tout ce qui s'y rattache, range par sorte -- 3MF
// tranche, 3MF d'origine, vues 3D, documents du modele, fichiers joints a la main -- a la place des entrees eparses du
// menu (telecharger le tranche, l'original, importer…). On y joint n'importe quel fichier ; un 3MF peut devenir le 3MF
// d'origine (vue 3D, couleurs).
// kind : "print" | "group". actions : ce que la fiche sait deja faire (telecharger, importer, recuperer, vue 3D…).
const KIND_DOC = { guide: "📘", bom: "📋", other: "📄" };
const ICON_EXT = [[/\.(pdf)$/i, "📕"], [/\.(png|jpe?g|webp|gif|heic)$/i, "🖼"], [/\.(mp4|webm|mov|m4v)$/i, "🎞"], [/\.(3mf|stl|step|stp|obj)$/i, "📐"],
  [/\.(zip|rar|7z)$/i, "🗜"], [/\.(txt|md|csv|json|gcode)$/i, "📝"]];
const iconOf = n => (ICON_EXT.find(([re]) => re.test(n)) || [null, "📎"])[1];
const size = b => b == null ? "sur le NAS" : b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`;

async function saveBlob(url, fallback) {
  try {
    const r = await client.get(url.replace(/^\/api\/v1/, ""), { responseType: "blob", timeout: 600000 });
    const cd = r.headers?.["content-disposition"] || "";
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
    const u = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = u; a.download = m ? decodeURIComponent(m[1]) : fallback;
    a.dispatchEvent(new MouseEvent("click"));
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  } catch (e) { showAlert(e.response?.status === 404 ? "Ce fichier n'est pas sur le serveur." : (e.message || "Téléchargement impossible")); }
}

export default function FilesSheet({ kind, id, title, isAdmin, actions = {}, onClose }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const base = kind === "print" ? `/prints/${id}` : `/prints/groups/${id}`;
  useEffect(() => {
    let alive = true;
    client.get(`${base}/files`).then(r => alive && setD(r.data)).catch(e => alive && setD({ error: e.response?.data?.detail || e.message }));
    return () => { alive = false; };
  }, [base, tick]);
  const refresh = () => setTick(t => t + 1);
  // joindre un fichier ; un 3MF peut devenir le 3MF d'origine
  const attach = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.multiple = true;
    inp.onchange = async () => {
      const files = [...(inp.files || [])];
      if (!files.length) return;
      if (files.length === 1 && /\.3mf$/i.test(files[0].name) && actions.importSource
        && await showConfirm(`« ${files[0].name} » est un 3MF : en faire le 3MF d'origine (vue 3D, couleurs du créateur) ?`,
          { confirmLabel: "📦 3MF d'origine", cancelLabel: "📎 Simple fichier joint" })) {
        await actions.importSource(files[0]); refresh(); return;
      }
      setBusy(true);
      let n = 0;
      for (const f of files) {
        const fd = new FormData(); fd.append("file", f);
        try { await client.post(`${base}/attachments`, fd, { timeout: 600000 }); n++; }
        catch (e) { showAlert(`${f.name} : ${e.response?.data?.detail || e.message}`); }
      }
      setBusy(false);
      if (n) { toast(n > 1 ? `${n} fichiers joints` : "Fichier joint"); egg("fichiers_joints"); }
      refresh();
    };
    inp.click();
  };
  // un document du modele retire (celui d'un modele lie par erreur) : plus montre, plus garde
  const hideDoc = async x => {
    if (!(await showConfirm(`Retirer « ${x.name || x.label} » des documents du modèle ? Il ne sera plus montré ni gardé (« ↺ Remettre » le fait revenir).`,
      { confirmLabel: "Retirer" }))) return;
    try { await client.delete(`/makerworld/doc/${x.design_id}/${x.id}`); refresh(); } catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const restoreDocs = async did => {
    try { await client.post(`/makerworld/doc/${did}/restore`); toast("Documents remis : ils se gardent de nouveau à la prochaine lecture du modèle"); refresh(); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const del = async a => {
    if (!(await showConfirm(`Supprimer « ${a.label} » ?`, { confirmLabel: "Supprimer" }))) return;
    try { await client.delete(`${base}/attachments/${encodeURIComponent(a.name)}`); refresh(); } catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };

  const sec = (icon, label, n, children, extra = null) => <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "10px 12px", borderRadius: 16,
    border: "1px solid var(--border)", background: "var(--surface)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 15 }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 900, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted)" }}>{label}{n != null ? ` · ${n}` : ""}</span>
      {extra}
    </div>
    {children}
  </div>;
  // (les boutons passent dessous quand la place manque : sur un telephone, le nom restait reduit a une lettre)
  const row = (icon, name, sub, btns, key) => <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flexWrap: "wrap", rowGap: 6 }}>
    <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
    <span style={{ flex: "1 1 150px", minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      {sub && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>}
    </span>
    <span style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: "auto" }}>{btns}</span>
  </div>;
  const btn = (label, onClick, tip, tone = "#0EA5E9") => <button type="button" onClick={onClick} data-tip={tip} style={{ padding: "6px 10px", borderRadius: 10,
    cursor: "pointer", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", border: `1px solid color-mix(in srgb, ${tone} 40%, var(--border))`,
    background: `color-mix(in srgb, ${tone} 10%, var(--surface2))`, color: tone }}>{label}</button>;
  const empty = t => <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{t}</div>;

  const g = kind === "group";
  const atts = d?.attachments || [], docs = d?.docs || [], views = d?.vue3d || [];
  return createPortal(
    <FSheet onClose={onClose} z={1100} bottom={<>
      <button type="button" onClick={onClose} style={{ ...fBtn, flex: 1 }}>Fermer</button>
      {isAdmin && <button type="button" disabled={busy} onClick={attach} style={{ ...fBtn, flex: 2, color: "#fff", border: "none", opacity: busy ? 0.6 : 1,
        background: "linear-gradient(135deg, #8B5CF6, #0EA5E9)" }}>{busy ? "Envoi…" : "📤 Joindre un fichier"}</button>}
    </>}>
      <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>🗂 Fichiers associés</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        </div>
        {!d && empty("Chargement…")}
        {d?.error && empty(d.error)}
        {d && !d.error && <>
          {sec("📐", g ? "3MF tranchés" : "3MF tranché", g ? d.sliced : null,
            (g ? d.sliced : d.sliced) ? row("📐", g ? `${d.sliced} sur ${d.prints} impression${d.prints > 1 ? "s" : ""}` : "Pour mon imprimante",
              g ? "un fichier s'ils sont identiques, sinon un zip" : "gardé au lancement de l'impression",
              btn("⤓ Télécharger", () => actions.download?.("sliced"), "Le 3MF tranché", "#F59E0B"), "s")
              : empty("Pas de 3MF tranché gardé"))}
          {sec("📦", "3MF d'origine", null, <>
            {g ? (actions.sourceRows || []).map(m => row("📦", m.label, m.has ? "importé ou récupéré" : "pas encore là",
              <>{m.has && btn("⤓", () => actions.download?.("source"), "Télécharger les 3MF d'origine", "#F97316")}
                {isAdmin && btn(m.has ? "📤 Remplacer" : "📤 Importer", () => actions.importGroupSource?.(m)?.then?.(refresh), "Le projet Bambu Studio", "#F97316")}</>, m.key))
              : row("📦", d.source ? "Le projet d'origine" : "Pas de 3MF d'origine", d.source ? (d.design_id ? "MakerWorld · à retrancher" : "importé · à retrancher")
                  : d.can_fetch_source ? "il se récupère depuis MakerWorld" : "importe-le pour la vue 3D et les couleurs",
                <>{d.source && btn("⤓", () => actions.download?.("source"), "Télécharger le 3MF d'origine", "#F97316")}
                  {d.source && !d.design_id && actions.own3d && btn("🧊", actions.own3d, "Vue 3D de mon 3MF d'origine")}
                  {!d.source && d.can_fetch_source && btn("⇣ Récupérer", async () => { await actions.fetchSource?.(); refresh(); }, "Depuis MakerWorld", "#F97316")}
                  {isAdmin && btn(d.source ? "📤" : "📤 Importer", () => actions.importSource?.()?.then?.(refresh), d.source ? "Remplacer le 3MF d'origine" : "Le projet Bambu Studio", "#F97316")}</>, "src")}
            {g && actions.own3d && row("🧊", "Vue 3D", "depuis le 3MF d'origine importé", btn("🧊 Voir", actions.own3d, "Vue 3D"), "o3d")}
          </>)}
          {sec("🧊", "Vues 3D", views.length, views.length
            ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {views.map(v => <a key={v.n} href={apiUrl(v.url.replace(/^\/api\/v1/, ""))} target="_blank" rel="noopener noreferrer" data-tip="Ouvrir"
                  style={{ width: 72, height: 72, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", background: "var(--surface2)" }}>
                  <img src={apiUrl(v.url.replace(/^\/api\/v1/, ""))} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/></a>)}
              </div>
            : empty("Aucune vue prise dans la vue 3D"),
            isAdmin && actions.manageViews ? btn("Gérer", actions.manageViews, "Les vues 3D gardées et la vignette") : null)}
          {sec("📄", "Documents du modèle", docs.length, docs.length
            ? docs.map((x, i) => row(KIND_DOC[x.kind] || "📄", x.name || x.label, `${x.label || "document"}${x.kept ? " · gardé ici" : " · chez MakerWorld"}${g && x.model ? ` · ${x.model}` : ""}`,
                <>{btn("↗", () => window.open(x.kept ? x.href : x.url, "_blank", "noopener"), "Ouvrir")}
                  {x.kept && btn("⤓", () => saveBlob(x.href + "?dl=1", x.name || "document"), "Télécharger")}
                  {isAdmin && btn("🗑", () => hideDoc(x), "Retirer ce document du modèle", "#EF4444")}</>, `d${i}`))
            : empty(d.design_id || g ? "Le créateur n'a joint aucun document" : "Pas de modèle MakerWorld lié"),
            isAdmin && Object.keys(d.docs_hidden || {}).length ? <span style={{ display: "flex", gap: 6 }}>{Object.entries(d.docs_hidden).map(([did, n]) =>
              <React.Fragment key={did}>{btn(`↺ Remettre ${n}`, () => restoreDocs(did), `${n} document${n > 1 ? "s" : ""} retiré${n > 1 ? "s" : ""} du modèle ${did}`, "#64748B")}</React.Fragment>)}</span> : null)}
          {sec("📎", "Fichiers joints", atts.length, atts.length
            ? atts.map(a => row(iconOf(a.label), a.label, `${size(a.size)}${a.at ? ` · ${new Date(a.at * 1000).toLocaleDateString("fr-FR")}` : ""}`,
                <>{btn("⤓", () => saveBlob(a.url, a.label), "Télécharger")}
                  {isAdmin && btn("🗑", () => del(a), "Supprimer", "#EF4444")}</>, a.name))
            : empty(isAdmin ? "Rien de joint : une notice, une photo, un autre 3MF… avec 📤 Joindre un fichier" : "Rien de joint"))}
        </>}
      </div>
    </FSheet>, document.body);
}
