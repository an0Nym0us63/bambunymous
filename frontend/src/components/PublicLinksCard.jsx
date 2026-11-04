import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import { toast } from "../store/toast";
import { showConfirm } from "../utils/dialog";
import { FSheet, FCard, fBtn } from "./FicheKit";
import { egg } from "../eggs";

// Les liens publics (04/11/2026) : tout ce qui s'ouvre sans compte -- « Ton annee », « Depuis le debut », les vitrines --
// avec leur creation, leur expiration et leurs ouvertures ; ouvrir, copier, changer la duree, supprimer ; et le journal
// des acces de chacun (heure, zone, fournisseur, appareil, adresse IP).
const KIND = { year: ["🎁", "#9333EA"], all: ["🏛️", "#4F46E5"], showcase: ["✨", "#A1803F"] };
const DUR = [[7, "7 j"], [30, "30 j"], [365, "1 an"], [0, "sans fin"]];
const utc = iso => new Date(`${iso}${iso.endsWith("Z") ? "" : "Z"}`);
const day = iso => iso ? utc(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";
const flag = cc => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : "🌐");
const place = g => g?.local ? "Réseau local" : [g?.city, g?.region !== g?.city ? g?.region : null, g?.country].filter(Boolean).join(", ") || "Zone inconnue";

// le journal des acces d'un lien : les chiffres, les lieux, puis chaque ouverture jour par jour
export function AccessLog({ token, label, onClose }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    client.get(`/public-links/${token}/log`).then(r => setD(r.data)).catch(() => setD({ error: true }));
    egg("liens_acces");
  }, [token]);
  const e = d?.entries || [];
  const sum = useMemo(() => {
    const ips = new Set(e.map(x => x.ip)), cc = new Set(e.map(x => x.geo?.cc).filter(Boolean));
    const by = {};
    e.forEach(x => { const k = place(x.geo); by[k] = by[k] || { n: 0, cc: x.geo?.cc, local: x.geo?.local, ips: new Set() }; by[k].n++; by[k].ips.add(x.ip); });
    const places = Object.entries(by).sort((a, b) => b[1].n - a[1].n);
    const days = [];
    e.forEach(x => { const k = utc(x.at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      if (!days.length || days[days.length - 1][0] !== k) days.push([k, []]); days[days.length - 1][1].push(x); });
    return { ips: ips.size, cc: cc.size, places, days };
  }, [e]);
  const max = sum.places[0]?.[1].n || 1;
  const stat = (v, l, c) => <div style={{ flex: "1 1 90px", padding: "10px 12px", borderRadius: 14, border: "1px solid var(--border)",
    background: `linear-gradient(135deg, color-mix(in srgb, ${c} 14%, transparent), transparent 70%), var(--surface)` }}>
    <div style={{ fontSize: 22, fontWeight: 900, color: c }}>{v}</div><div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>{l}</div></div>;
  return createPortal(<FSheet onClose={onClose} z={1300} bottom={<button type="button" onClick={onClose} style={{ ...fBtn, flex: 1 }}>Fermer</button>}>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>👁 Les accès · {label}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>Chaque ouverture du lien, avec la zone de l'adresse IP : la ville du fournisseur d'accès au mieux, jamais une adresse postale.</div>
      </div>
      {!d ? <div style={{ color: "var(--muted)" }}>Chargement…</div> : d.error ? <div style={{ color: "#ef4444" }}>Le journal n'a pas pu être lu.</div> : !e.length
        ? <div style={{ fontSize: 13.5, color: "var(--muted)" }}>Aucune ouverture notée pour l'instant (le journal commence le 04/11/2026).</div> : <>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {stat(e.length, `ouverture${e.length > 1 ? "s" : ""}`, "#0EA5E9")}{stat(sum.ips, `adresse${sum.ips > 1 ? "s" : ""} IP`, "#8B5CF6")}
          {stat(sum.cc || "—", `pays`, "#22C55E")}{stat(sum.places.length, `lieu${sum.places.length > 1 ? "x" : ""}`, "#F59E0B")}
        </div>
        <FCard t="D'où" i="📍" c="#F59E0B">
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
            {sum.places.slice(0, 12).map(([k, v]) => <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>
              <span style={{ fontSize: 17 }}>{v.local ? "🏠" : flag(v.cc)}</span>
              <span style={{ flex: "0 1 45%", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k}</span>
              <span style={{ flex: 1, height: 8, borderRadius: 6, background: "var(--surface2)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${v.n / max * 100}%`, borderRadius: 6, background: "linear-gradient(90deg, #F59E0B, #EC4899)" }}/></span>
              <span style={{ minWidth: 54, textAlign: "right", fontSize: 12, color: "var(--muted)" }}>{v.n} · {v.ips.size} IP</span>
            </div>)}
          </div>
        </FCard>
        <FCard t="Les ouvertures" i="🕒" c="#0EA5E9">
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginTop: 4 }}>Les {d.max} dernières, sur {d.days} jours.</div>
          {sum.days.map(([k, xs]) => <div key={k} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>{k}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {xs.map((x, i) => <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)" }}>
                <span style={{ fontSize: 12.5, fontWeight: 900, color: "var(--text)", minWidth: 40, fontVariantNumeric: "tabular-nums" }}>
                  {utc(x.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                <span style={{ fontSize: 18, lineHeight: 1 }}>{x.geo?.local ? "🏠" : flag(x.geo?.cc)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{place(x.geo)}</span>
                  <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                    {[x.dev, x.geo?.isp, x.ref ? `depuis ${x.ref}` : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>{x.ip}</span>
              </div>)}
            </div>
          </div>)}
        </FCard>
      </>}
    </div>
  </FSheet>, document.body);
}

export default function PublicLinksCard({ card, cardTitle }) {
  const [log, setLog] = useState(null);
  const [links, setLinks] = useState(null);
  const load = () => client.get("/public-links").then(r => setLinks(r.data?.links || [])).catch(() => setLinks([]));
  useEffect(() => { load(); }, []);
  const url = l => `${window.location.origin}${l.path}`;
  const copy = async l => { try { await navigator.clipboard.writeText(url(l)); toast("Lien copié"); } catch { toast(url(l)); } };
  const setDur = async (l, days) => {
    try { await client.patch(`/public-links/${l.token}`, { days }); load(); toast(days ? `Valable ${days} jours à partir d'aujourd'hui` : "Valable sans fin"); }
    catch { toast("La durée n'a pas pu être changée", "error"); }
  };
  const del = async l => {
    if (!(await showConfirm(`Supprimer le lien « ${l.label} » ? Il ne s'ouvrira plus.`, { confirmLabel: "Supprimer" }))) return;
    try { await client.delete(`/public-links/${l.token}`); load(); toast("Lien supprimé"); } catch { toast("Le lien n'a pas pu être supprimé", "error"); }
  };
  const chip = { padding: "5px 10px", borderRadius: 14, cursor: "pointer", fontSize: 12, fontWeight: 800, border: "1px solid var(--border)", background: "var(--surface2)",
    color: "var(--text2)", textDecoration: "none" };
  return <div className="card" style={card}>
    <div style={cardTitle}>🔗 Liens publics</div>
    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginBottom: 10 }}>
      Ce qui s'ouvre sans compte : « Ton année » et « Depuis le début » (Statistiques), et tes vitrines (Impressions › Galerie). Un lien expiré ne s'ouvre plus.</div>
    {links === null ? <div style={{ color: "var(--muted)" }}>Chargement…</div>
      : !links.length ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Aucun lien public pour l'instant.</div>
      : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {links.map(l => { const [ic, c] = KIND[l.kind] || ["🔗", "#64748B"];
          return <div key={l.token} style={{ padding: 10, borderRadius: 14, border: `1px solid ${l.expired ? "color-mix(in srgb, #ef4444 40%, var(--border))" : "var(--border)"}`,
            background: `linear-gradient(135deg, color-mix(in srgb, ${c} 10%, transparent), transparent 60%), var(--surface)`, opacity: l.expired ? .8 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>{ic}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{l.label}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                  créé le {day(l.created)} · {l.views} ouverture{l.views > 1 ? "s" : ""}{l.last_view ? ` (dernière le ${day(l.last_view)})` : ""}</span>
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 900, whiteSpace: "nowrap", color: l.expired ? "#ef4444" : l.expires ? "#d97706" : "#16a34a" }}>
                {l.expired ? "expiré" : l.expires ? `jusqu'au ${day(l.expires)}` : "sans fin"}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
              <a href={url(l)} target="_blank" rel="noopener noreferrer" style={chip}>↗ Ouvrir</a>
              <button type="button" onClick={() => copy(l)} style={chip}>📋 Copier</button>
              <button type="button" onClick={() => setLog(l)} style={chip}>👁 Accès</button>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)", marginLeft: 4 }}>{l.expired ? "Rouvrir pour" : "Durée"} :</span>
              {DUR.map(([n, lb]) => <button key={n} type="button" onClick={() => setDur(l, n)} style={chip}>{lb}</button>)}
              <button type="button" onClick={() => del(l)} style={{ ...chip, color: "#ef4444", marginLeft: "auto" }}>Supprimer</button>
            </div>
          </div>; })}
      </div>}
    {log && <AccessLog token={log.token} label={log.label} onClose={() => setLog(null)}/>}
  </div>;
}
