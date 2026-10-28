import React, { useState } from "react";
import { useTrackDetail } from "../utils/track";
import { Droplets, Sun, Thermometer, Timer, Clock, Package, Palette } from "lucide-react";
import client from "../api/client";
import { colorBg, opaqueColors, finishOf } from "../utils/colors";
import { createPortal } from "react-dom";
import { FilamentSheetFromSpool } from "./LazySheets";
import SpoolSVG from "./SpoolSVG";
import { HeroSpool } from "./SpoolGhost";
import { EXT_AMS_ID, amsName, slotLabel, isExternal, trayPct } from "../utils/ams";
import AdminOnly from "./AdminOnly";
import { showAlert } from "../utils/dialog";
import { FSheet, FCard, FRow, fChip, fBtn, fGrad } from "./FicheKit";

// ── Helpers ────────────────────────────────────────────────────────────────
// Convertit un hex 6 ou 8 chars (avec ou sans #) en valeur CSS utilisable.
// 8 chars = RRGGBBAA → si AA < FF → rgba(), sinon #rrggbb
// 6 chars = RRGGBB → #rrggbb
function hexToCss(hex) {
  if (!hex) return null;
  const h = hex.replace(/^#/, "").toLowerCase();
  if (h.length === 8) {
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16),
          b = parseInt(h.slice(4,6),16), a = parseInt(h.slice(6,8),16);
    if (a === 255) return `#${h.slice(0,6)}`;
    return `rgba(${r},${g},${b},${(a/255).toFixed(3)})`;
  }
  if (h.length === 6) return `#${h}`;
  return null;
}
// Alias pour compatibilité avec l'ancien nom
const hexCss = hexToCss;
// Affichage texte d'une couleur — toujours en hex, jamais en rgba()
const hexDisplay = (hex) => {
  if (!hex) return null;
  const h = hex.replace(/^#/, "").toLowerCase();
  return (h.length === 6 || h.length === 8) ? `#${h}` : null;
};


// Normalise un hex pour stockage (strip #, garder 6 ou 8 chars)
function normalizeHex(raw) {
  const h = (raw || "").replace(/^#/, "").toLowerCase();
  if (h.length === 8 || h.length === 6) return h;
  if (h.length === 3) return h.split("").map(c=>c+c).join("");
  return "";
}

function isEmptyTray(tray) {
  if (tray.empty) return true;
  // Un tray est vide si uuid ET filament_type sont vides
  // Ne pas se fier à la couleur (le noir pur #000000 serait faussement détecté comme vide)
  const noUuid = (tray.uuid||"").replace(/0/g,"") === "";
  const noType = !(tray.filament_type||"").trim();
  const noName = !(tray.tray_id_name||"").trim();
  return noUuid && noType && noName;
}
function luminance(hex) {
  const h = (hex||"").replace("#","");
  const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
  return isNaN(r) ? 128 : (r*299+g*587+b*114)/1000;
}
// Contraste : retourne "white" ou "black" selon la luminance du fond
function contrast(hex) {
  return luminance((hex||"").replace("#","")) < 128 ? "white" : "rgba(0,0,0,0.75)";
}

function parseColors(tray, spoolInfo) {
  // 1. multicolor via colors_array
  const arr = spoolInfo?.colors_array || tray?.colors_array;
  if (arr) {
    const cols = arr.split(",").map(c=>c.trim()).filter(Boolean);
    if (cols.length > 1) return cols.map(c => hexToCss(c)).filter(Boolean);
  }
  // 2. couleur simple
  const single = hexToCss(spoolInfo?.color || spoolInfo?.filament_color || tray?.color);
  return single ? [single] : null;
}

// Génère le style background pour n couleurs
function multicolorType(tray, spoolInfo) {
  return spoolInfo?.multicolor_type || tray?.multicolor_type || null;
}

// L'AMS 255 est le pseudo-AMS des bobines externes, fabrique cote serveur pour
// que l'externe traverse exactement le meme code que les AMS reels. Seul son
// libelle differe. Noms et etiquettes vivent dans utils/ams (AMS, HT, externe).
// Les slots arrivent deja dans l'ordre physique, y compris pour l'externe :
// c'est le serveur qui remet a l'endroit la numerotation inversee du
// protocole. Le front n'a donc rien a reordonner -- l'avoir fait ici faisait
// diverger l'etiquette affichee et l'emplacement inscrit sur la bobine.
const traysInOrder = (ams) => ams.trays || [];
// Pas de capteur sur le support externe : afficher 0 % et 0 °C ferait croire a
// une mesure, alors qu'il n'y en a aucune.
const hasClimate = (ams) => !isExternal(ams.id);
const traySlotNo = (ams, t) => t.id + 1;
// Le filament en place n'a pas d'echantillon (nuancier) : c'est le bon moment
// pour l'imprimer, la bobine est deja chargee. Seulement quand on SAIT : une
// bobine non reconnue (swatch inconnu) ne porte pas la pastille.
const sansEchantillon = (tray, info) => !isEmptyTray(tray) && info?.swatch === false;
const SWATCH_COLOR = "#F59E0B";
const SWATCH_TITLE = "Pas d'échantillon pour ce filament : il est en place, c'est le moment de l'imprimer";
// Bobine pas sechee depuis plus de 6 mois (regle du serveur, la meme que
// l'alerte) : elle est dans l'AMS, on peut la secher sur place.
const aSecher = (tray, info) => !isEmptyTray(tray) && info?.needs_drying === true;
const DRY_COLOR = "#0EA5E9";
const DRY_TITLE = "Bobine jamais séchée ou pas depuis plus de 6 mois : elle est dans l'AMS, c'est le moment de la sécher";
const fmtStock = (g) => g >= 1000 ? `${(g / 1000).toFixed(2).replace(".", ",")} kg` : `${Math.round(g)} g`;

// Pastille ronde d'alerte sur la tuile compacte.
function PillBadge({ color, title, Icon }) {
  return (
    <span title={title} style={{ width:12, height:12, borderRadius:"50%", background:color, color:"white",
      display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
      boxShadow:"0 0 0 1.5px rgba(255,255,255,0.9), 0 1px 3px rgba(0,0,0,0.35)" }}>
      <Icon size={8} strokeWidth={2.5}/>
    </span>
  );
}

// Hachures posees PAR-DESSUS une couleur (bobine posee, non inseree) : en
// calque, pour garder intactes les couleurs multiples dessous.
function HatchOverlay({ radius = 0 }) {
  return <span style={{ position:"absolute", inset:0, borderRadius:radius, pointerEvents:"none",
    background:"repeating-linear-gradient(-45deg, rgba(255,255,255,0.38) 0px, rgba(255,255,255,0.38) 2px, transparent 2px, transparent 6px)" }}/>;
}

// ── Mini pastille ──────────────────────────────────────────────────────────
function ColorPill({ tray, spoolInfo, active, h = 28 }) {
  const colors = parseColors(tray, spoolInfo);
  const c1 = colors?.[0];
  const isEmpty = isEmptyTray(tray);
  // Bobine POSEE pour le sechage dans un emplacement vide : sa couleur,
  // attenuee et hachuree (elle n'est pas inseree), avec un soleil.
  const posee = isEmpty ? tray.drying_spool : null;
  // Toutes ses couleurs (bobine multicolore comprise) ; les hachures viennent
  // par-dessus, en calque (HatchOverlay).
  const bg = posee
    ? { ...colorBg(parseColors({}, posee), multicolorType({}, posee), finishOf(posee), { size: 60 }), opacity: 0.85 }
    : isEmpty
    ? { background: "repeating-linear-gradient(-45deg, rgba(148,163,184,0.18) 0px, rgba(148,163,184,0.18) 2px, transparent 2px, transparent 6px)" }
    : colorBg(colors, multicolorType(tray, spoolInfo), finishOf(spoolInfo, tray), { size: 60 });
  const lum = luminance((c1||"").replace("#",""));
  const ringColor = active ? "#3b82f6" : isEmpty ? "rgba(148,163,184,0.2)" : lum > 200 ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.1)";
  return (
    <div style={{ flex:1, height:h, borderRadius:6, transition:"all 0.2s",
      boxShadow: active ? `0 0 0 2px ${ringColor}` : `0 0 0 1px ${ringColor}`,
      position:"relative", ...bg }}>
      {/* Slot vide : aucun indicateur de detection. Un slot sans filament
          conservait parfois le dernier match_mode connu, laissant une pastille
          grise/verte "a verifier" sur du vide. La grande vue filtrait deja sur
          !empty, pas la tuile compacte. */}
      {/* Detection en haut a droite, alertes en bas a gauche : coins opposes,
          rien ne se chevauche meme avec deux alertes sur une pastille etroite. */}
      {tray.match_mode && !isEmpty && (
        <span style={{ position:"absolute", top:1, right:3, lineHeight:1 }}>
          <MatchIcon mode={tray.match_mode} size={8}/>
        </span>
      )}
      {posee && <HatchOverlay radius={6}/>}
      {posee && (
        <span title={`Posée pour séchage : ${posee.translated_name || posee.name || ""}`}
          style={{ position:"absolute", top:1, right:3, lineHeight:1, color:"#f59e0b",
            filter:"drop-shadow(0 0 1px rgba(0,0,0,0.6))" }}>
          <Sun size={10} strokeWidth={2.8}/>
        </span>
      )}
      {/* Deux alertes : une par coin du bas. Cote a cote dans une pastille
          d'une trentaine de pixels, leurs anneaux blancs se touchaient. */}
      {sansEchantillon(tray, spoolInfo) && (
        <span style={{ position:"absolute", bottom:2, left:2 }}>
          <PillBadge color={SWATCH_COLOR} title={SWATCH_TITLE} Icon={Palette}/>
        </span>
      )}
      {aSecher(tray, spoolInfo) && (
        <span style={{ position:"absolute", bottom:2, ...(sansEchantillon(tray, spoolInfo) ? { right:2 } : { left:2 }) }}>
          <PillBadge color={DRY_COLOR} title={DRY_TITLE} Icon={Droplets}/>
        </span>
      )}
    </div>
  );
}

// ── Icône de détection filament ─────────────────────────────────────────────
function MatchIcon({ mode, size = 10 }) {
  if (!mode) return null;
  const cfg = {
    rfid:     { symbol: "⬡", color: "#22c55e", title: "Reconnu par RFID Bambu" },
    auto:     { symbol: "◈", color: "#f59e0b", title: "Reconnu automatiquement (profil + couleur)" },
    notfound: { symbol: "⚠", color: "#ef4444", title: "Filament identifié par l'imprimante mais introuvable en base" },
    manual:   { symbol: "◇", color: "#94a3b8", title: "Non identifié" },
    linked:   { symbol: "◆", color: "#8b5cf6", title: "Attribuée à la main" },
  }[mode];
  if (!cfg) return null;
  return (
    <span title={cfg.title} style={{ fontSize:size, lineHeight:1, color:cfg.color,
      textShadow:"0 0 4px rgba(0,0,0,0.8)", userSelect:"none", pointerEvents:"none" }}>
      {cfg.symbol}
    </span>
  );
}

// ── Boîtier AMS compact ─────────────────────────────────────────────────────
// la buse qu'un AMS alimente (« G », « D ») ou, par l'aiguillage, son entree (« ⇄ A ») ; null si sans objet
export function amsRoute(ams, dual, fs) {
  // derriere l'aiguillage : la buse ou va son entree (fs : switchRoutes, ou l'on peut s'y fier),
  // sinon l'entree elle-meme
  if (ams?.switch_port) {
    const out = fs?.[`out_${ams.switch_port.toLowerCase()}`];
    const side = out == null ? null : out === 1 ? "G" : "D";
    return { txt: `⇄ ${side || ams.switch_port}`, color: "#8b5cf6",
      title: `Branché sur l'entrée ${ams.switch_port} (IN-${ams.switch_port}) de l'aiguillage${side ? `, qui va vers la buse ${side === "G" ? "gauche" : "droite"}` : ""}` };
  }
  if (dual && ams?.extruder_id >= 0) return { txt: ams.extruder_id === 1 ? "G" : "D", title: `Alimente la buse ${ams.extruder_id === 1 ? "gauche" : "droite"}`, color: "#0ea5e9" };
  return null;
}
function AMSBox({ ams, activeAmsId, activeTrayId, isSelected, onClick, slotsWidth, climate = true, pillH = null, dual = false, fs = null }) {
  const route = amsRoute(ams, dual, fs);
  const dense = pillH != null;
  const isActive = ams.id === activeAmsId;
  const isDrying = ams.is_drying || ams.dry_time > 0;
  const getInfo = t => t.spool_info ?? null;

  // Couleur du pourtour : si les deux → double bordure (bleu + orange)
  const borderColor = isDrying && isActive
    ? "rgba(249,115,22,0.4)"        // orange prioritaire, bleu visible via boxShadow
    : isDrying ? "rgba(249,115,22,0.35)"
    : isActive ? "rgba(59,130,246,0.4)"
    : isSelected ? "rgba(255,255,255,0.2)"
    : "var(--border)";

  const bg = isDrying ? "rgba(249,115,22,0.04)"
    : isActive ? "rgba(59,130,246,0.06)"
    : "var(--surface2)";

  // Si actif+séchage : halo bleu fixe en box-shadow interne + dryPulse orange en animation
  const boxShadow = isActive && !isDrying ? "0 4px 16px rgba(59,130,246,0.15)"
    : !isDrying ? "none"
    : isActive ? "0 0 0 1px rgba(59,130,246,0.35), 0 4px 12px rgba(249,115,22,0.10)"
    : "0 4px 12px rgba(249,115,22,0.10)";

  return (
    <button onClick={onClick} style={{
      display:"flex", flexDirection:"column", alignItems:"center", gap: dense ? 3 : 6,
      background:"none", border:"none", cursor:"pointer", width:"100%", padding:0,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        {/* nowrap : un HT n'a qu'un slot, sa tuile est etroite et "HT-A"
            passait a la ligne. Le nom peut deborder de la tuile, pas se casser. */}
        <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", whiteSpace:"nowrap",
          color: isActive ? "#3b82f6" : isSelected ? "var(--text)" : "var(--muted)" }}>
          {amsName(ams.id)}
        </span>
        {/* Pastille bleue toujours visible si actif, même en séchage */}
        {isActive && <span style={{ width:6, height:6, borderRadius:"50%",
          backgroundColor:"#3b82f6", animation:"livePulse 2s infinite" }} />}
        {route && <span title={route.title} style={{ fontSize:9, fontWeight:900, padding:"0 5px", borderRadius:6, lineHeight:"13px",
          color: route.color, background: `${route.color}1f`, whiteSpace:"nowrap" }}>{route.txt}</span>}
      </div>
      <div style={{
        width: slotsWidth ?? "100%", minWidth:0, borderRadius: dense ? 10 : 12, padding: dense ? 4 : 6, display:"flex", gap:4, boxSizing:"border-box",
        border:`1px solid ${borderColor}`,
        background: bg,
        boxShadow: boxShadow,
        animation: isDrying ? "dryPulse 2.5s ease-in-out infinite" : "none",
        transition:"all 0.2s",
      }}>
        {traysInOrder(ams).map(t => <ColorPill key={t.id} tray={t} spoolInfo={getInfo(t)} active={isActive && t.id===activeTrayId} h={pillH ?? 28}/>)}
      </div>
      {/* Hauteur reservee meme sans capteur (externe) : sinon la tuile est
          plus courte que les AMS voisins et, dans la grille, son nom et ses
          slots ne s'alignent plus. On garde le bloc, vide, a la meme hauteur. */}
      {climate && <div style={{ display:"flex", flexWrap:"wrap", justifyContent:"center", columnGap:8, fontSize:9,
        color:"var(--muted)", whiteSpace:"nowrap",
        minHeight:12, visibility: hasClimate(ams) ? "visible" : "hidden" }}>
        <span style={{ display:"flex", alignItems:"center", gap:2 }}><Droplets size={8}/>{ams.humidity}%</span>
        <span style={{ display:"flex", alignItems:"center", gap:2,
          color: isDrying ? "#f97316" : "var(--muted)",
          animation: isDrying ? "dryGlow 2.5s ease-in-out infinite" : "none" }}>
          <Sun size={8} style={{ color: isDrying ? "#f97316" : undefined }}/>{(ams.temp ?? 0).toFixed(1)}°
        </span>
      </div>}
      {!dense && <div style={{ height:2, borderRadius:1,
        background: isSelected ? "#3b82f6" : "transparent",
        width: isSelected ? 32 : 8, transition:"all 0.3s" }} />}
    </button>
  );
}

// ── Bobine SVG — vue de face, disque plat ──────────────────────────────────
// ── Tray card ──────────────────────────────────────────────────────────────
function TrayCard({ tray, amsId, label, activeAmsId, activeTrayId, spoolInfo: loaded, onClick, size = 68, showName = true, compact = false }) {
  const isActive = amsId===activeAmsId && tray.id===activeTrayId;
  const empty = isEmptyTray(tray);
  // Bobine POSEE pour le sechage (emplacement vide) : memes details qu'une
  // bobine chargee (matiere, jauge, poids, nom), avec la bobine attenuee et ☀.
  const posee = empty ? tray.drying_spool : null;
  const spoolInfo = posee || loaded;
  const vide = empty && !posee;
  const colors = parseColors(tray, spoolInfo);
  const c1 = colors?.[0];
  const name = spoolInfo?.translated_name ?? spoolInfo?.name ?? spoolInfo?.filament_name ?? tray.catalog_name ?? null;
  // Sous-type complet en priorite (PLA Basic, PETG-HF…), repli sur la famille.
  const material = spoolInfo?.fila_type ?? spoolInfo?.filament_fila_type
    ?? spoolInfo?.material ?? spoolInfo?.filament_material ?? tray.filament_type ?? null;
  const hasW = spoolInfo?.remaining_weight_g != null;
  const hasT = (spoolInfo?.initial_weight_g ?? spoolInfo?.filament_weight_g) != null;
  const pct = hasW && hasT
    ? Math.round((spoolInfo.remaining_weight_g/(spoolInfo.initial_weight_g ?? spoolInfo.filament_weight_g))*100)
    : (tray.remain ?? 0);
  // Toujours en grammes : si bobine mappée → remaining_weight_g, sinon remain% × 10 (≈1kg)
  const wLabel = hasW
    ? `${Math.round(spoolInfo.remaining_weight_g)} g`
    : tray.remain != null ? `≈ ${tray.remain * 10} g` : null;

  // Barre de progression : couleur du filament, contour si trop clair
  const lum = luminance((c1||"").replace("#",""));
  const mcType = multicolorType(tray, spoolInfo);
  // Barre de niveau : couleur OPAQUE, sans damier — sinon translucide sur damier
  // masque le niveau. Le damier reste sur la bobine et les pastilles.
  const barBg = colorBg(opaqueColors(colors), mcType, finishOf(spoolInfo, tray), { bar: true });
  // Si filament gris/blanc → fond de la barre plus foncé
  const barTrackColor = "var(--border)";

  return (
    <div onClick={onClick} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4,
      minWidth:0, cursor: onClick ? "pointer" : "default" }}>
      {/* Type de filament en haut. minWidth:0 sur la colonne + troncature ici :
          sans les deux, un libelle long comme "Support for PLA/PETG" imposait
          sa largeur en nowrap et elargissait TOUTE la colonne, decalant les
          slots voisins. Le titre complet reste accessible au survol. */}
      {!compact && <p title={vide ? "" : (material || "")}
        style={{ fontSize:10, color:"var(--muted)", fontWeight:600, lineHeight:"13px",
        textAlign:"center", whiteSpace:"nowrap", height:13,
        maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis" }}>
        {vide ? "" : (material || "—")}
      </p>}
      {/* Barre de progression couleur filament */}
      <div style={{ width: Math.round(size * 0.72), height:5, background: barTrackColor,
        borderRadius:3, overflow:"hidden",
        boxShadow:"inset 0 0 0 1px rgba(0,0,0,0.08)" }}>
        {!vide && (
          <div style={{ height:"100%", borderRadius:3,
            width:`${Math.max(0,Math.min(100,pct))}%`,
            transition:"width 0.7s",
            boxShadow: lum > 200 ? "inset 0 0 0 1px rgba(0,0,0,0.15)" : lum < 30 ? "inset 0 0 0 1px rgba(255,255,255,0.1)" : "none",
            ...barBg }}/>
        )}
      </div>
      {/* Bobine SVG */}
      <div style={{ position:"relative",
        transform: isActive ? "scale(1.06)" : "scale(1)", transition:"transform 0.3s" }}>
        {empty && tray.drying_spool ? (
          <div style={{ opacity:0.6, position:"relative" }} title="Posée pour séchage (non insérée)">
            <SpoolSVG colors={parseColors({}, tray.drying_spool)} finish={finishOf(tray.drying_spool)} empty={false} size={size} active={false}
              type={multicolorType({}, tray.drying_spool)}/>
            {/* Hachures legeres : la bobine est la, mais pas inseree. */}
            <span style={{ position:"absolute", left:"50%", top:"50%", width:size, height:size,
              transform:"translate(-50%,-50%)", borderRadius:"50%", pointerEvents:"none",
              background:"repeating-linear-gradient(-45deg, rgba(255,255,255,0.28) 0px, rgba(255,255,255,0.28) 1.5px, transparent 1.5px, transparent 7px)" }}/>
          </div>
        ) : (
          <SpoolSVG colors={empty?null:colors} finish={finishOf(spoolInfo, tray)} empty={empty} size={size} active={isActive} type={mcType}/>
        )}
        {/* Label slot */}
        <div style={{ position:"absolute", bottom: Math.round(size * 0.14), left:"50%",
          transform:"translateX(-50%)", padding:"1px 7px", borderRadius:20,
          fontSize:9, fontWeight:700, whiteSpace:"nowrap",
          background: isActive ? "#3b82f6" : "rgba(0,0,0,0.55)",
          color: "white",
          opacity: isActive ? 1 : 0.85,
          boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }}>
          {label}
        </div>
        {tray.match_mode && !empty && (
          <span style={{ position:"absolute", top:2, right:2 }}>
            <MatchIcon mode={tray.match_mode} size={12}/>
          </span>
        )}
      </div>
      <p style={{ fontSize:11, fontWeight:800, color:"var(--text)", height:14, fontVariantNumeric:"tabular-nums",
        display:"flex", alignItems:"center", justifyContent:"center", gap:4, whiteSpace:"nowrap" }}>
        {vide ? "" : posee ? (hasW ? wLabel : "") : wLabel}
        {!vide && !posee && pct > 0 && size >= 80 && <span style={{ fontSize:10, fontWeight:700, color:"var(--muted)" }}>{Math.max(0, Math.min(100, pct))} %</span>}
      </p>
      {showName && <p style={{ fontSize:10, color:"var(--text2)", textAlign:"center",
        whiteSpace:"normal", wordBreak:"break-word", maxWidth: size + 20, lineHeight:"12px",
        overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
        {empty
          ? (tray.drying_spool
              ? <span style={{ color:"#f59e0b" }}>☀ {tray.drying_spool.translated_name || tray.drying_spool.name}</span>
              : "Vide")
          : (name || "")}
      </p>}
      {sansEchantillon(tray, spoolInfo) && (
        <span title={SWATCH_TITLE} style={{ display:"inline-flex", alignItems:"center", gap:3,
          padding:"1px 6px", borderRadius:20, fontSize:9, fontWeight:700, whiteSpace:"nowrap",
          color:SWATCH_COLOR, background:"rgba(245,158,11,0.12)", border:"1px solid rgba(245,158,11,0.35)" }}>
          <Palette size={9}/> Échantillon à faire
        </span>
      )}
      {aSecher(tray, spoolInfo) && (
        <span title={DRY_TITLE} style={{ display:"inline-flex", alignItems:"center", gap:3,
          padding:"1px 6px", borderRadius:20, fontSize:9, fontWeight:700, whiteSpace:"nowrap",
          color:DRY_COLOR, background:"rgba(14,165,233,0.12)", border:"1px solid rgba(14,165,233,0.35)" }}>
          <Droplets size={9}/> À sécher
        </span>
      )}
    </div>
  );
}



// ── Bobine en ligne (detail condense) ───────────────────────────────────────
function TrayRow({ tray, amsId, label, activeAmsId, activeTrayId, spoolInfo: loaded, onClick, size = 44 }) {
  const isActive = amsId === activeAmsId && tray.id === activeTrayId;
  const empty = isEmptyTray(tray);
  const posee = empty ? tray.drying_spool : null;
  const spoolInfo = posee || loaded;
  const vide = empty && !posee;
  const colors = parseColors(tray, spoolInfo);
  const mcType = multicolorType(tray, spoolInfo);
  const name = spoolInfo?.translated_name ?? spoolInfo?.name ?? spoolInfo?.filament_name ?? tray.catalog_name ?? null;
  const material = spoolInfo?.fila_type ?? spoolInfo?.filament_fila_type ?? spoolInfo?.material ?? spoolInfo?.filament_material ?? tray.filament_type ?? null;
  const hasW = spoolInfo?.remaining_weight_g != null;
  const hasT = (spoolInfo?.initial_weight_g ?? spoolInfo?.filament_weight_g) != null;
  const pct = hasW && hasT ? Math.round((spoolInfo.remaining_weight_g / (spoolInfo.initial_weight_g ?? spoolInfo.filament_weight_g)) * 100) : (tray.remain ?? 0);
  const w = hasW ? `${Math.round(spoolInfo.remaining_weight_g)} g` : tray.remain != null ? `≈ ${tray.remain * 10} g` : "";
  const barBg = colorBg(opaqueColors(colors), mcType, finishOf(spoolInfo, tray), { bar: true });
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, height: size + 4, cursor: onClick ? "pointer" : "default",
      borderRadius: 14, padding: "2px 10px 2px 2px", boxSizing: "border-box", background: isActive ? "rgba(59,130,246,0.08)" : "transparent",
      border: `1px solid ${isActive ? "rgba(59,130,246,0.45)" : "transparent"}` }}>
      <div style={{ position: "relative", flexShrink: 0, opacity: posee ? 0.6 : 1 }}>
        <SpoolSVG colors={vide ? null : (posee ? parseColors({}, posee) : colors)} finish={posee ? finishOf(posee) : finishOf(spoolInfo, tray)} empty={vide} size={size} active={isActive} type={posee ? multicolorType({}, posee) : mcType}/>
      </div>
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: size >= 64 ? 13.5 : 12, fontWeight: 800, color: "var(--text)", lineHeight: 1.2, minWidth: 0,
          ...(size >= 56 ? { overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", wordBreak: "break-word" }
            : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }) }}>
          <span style={{ fontSize: 10.5, fontWeight: 900, color: isActive ? "#3b82f6" : "var(--muted)", marginRight: 5 }}>{label}</span>
          <span>
            {vide ? "Vide" : posee ? `☀ ${posee.translated_name || posee.name || ""}` : (name || material || "—")}</span>
        </div>
        {!vide && <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{w}</span>
          {name && material && <span style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{material}</span>}
        </div>}
        {!vide && size >= 40 && <div style={{ height: 4, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, borderRadius: 3, ...barBg }}/></div>}
      </div>
    </div>
  );
}

// ── Le sechage en grand (popup) ─────────────────────────────────────────────
// L'avancement (anneau et barre), le temps restant et l'heure de fin, la consigne
// et la temperature actuelle, l'humidite, le filament.
// le sechage d'une unite : l'anneau d'avancement, le temps restant et la fin, la barre,
// la consigne, la temperature et l'humidite (dans sa fenetre, et dans la tuile Sechage en grand)
const DRY_PHASE = { 1: ["Vérification", "#0ea5e9"], 2: ["Séchage", "#f97316"], 3: ["Refroidissement", "#0ea5e9"], 4: ["Arrêt en cours", "#94a3b8"],
  5: ["Erreur", "#ef4444"], 6: ["Chauffe hors contrôle", "#ef4444"], 7: ["Test", "#94a3b8"] };
const DRY_SUB = { 1: "chauffe", 2: "déshumidification" };
const DRY_CANNOT = { 0: "une impression est en cours", 1: "alimentation insuffisante", 2: "l'AMS est occupé", 3: "du filament est engagé à la sortie de l'AMS",
  4: "le séchage démarre", 5: "pas en mode 2D", 6: "un séchage est déjà en cours", 7: "mise à jour en cours",
  8: "alimentation insuffisante : brancher l'alimentation de l'AMS", 10: "filament à la sortie de l'AMS : le décharger à la main" };
function DryCard({ ams }) {
  const total = (ams.dry_duration || 0) * 60, left = ams.dry_time || 0;
  const done = total ? Math.max(0, Math.min(1, 1 - left / total)) : null;
  const fmt = m => { const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h} h ${String(mm).padStart(2, "0")}` : `${mm} min`; };
  const end = left ? new Date(Date.now() + left * 60000) : null;
  const days = end ? Math.round((new Date(end.getFullYear(), end.getMonth(), end.getDate()) - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000) : 0;
  const endTxt = end ? `${end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${days > 0 ? "⁺" + String(days).split("").map(c => "⁰¹²³⁴⁵⁶⁷⁸⁹"[c]).join("") : ""}` : "—";
  const R = 64, C = 2 * Math.PI * R;
  const box = (label, value, color) => (
    <div style={{ padding: "10px 12px", borderRadius: 12, background: "var(--surface2)", minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: color || "var(--text)", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, position: "relative" }}>
          <svg width={R * 2 + 16} height={R * 2 + 16} style={{ flexShrink: 0, transform: "rotate(-90deg)" }} aria-hidden="true">
            <circle cx={R + 8} cy={R + 8} r={R} fill="none" stroke="var(--surface2)" strokeWidth="12"/>
            {done != null && <circle cx={R + 8} cy={R + 8} r={R} fill="none" stroke="#f97316" strokeWidth="12" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - done)} style={{ transition: "stroke-dashoffset .6s" }}/>}
          </svg>
          <div style={{ position: "absolute", left: 0, width: R * 2 + 16, textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: "#f97316" }}>{done != null ? `${Math.round(done * 100)}%` : "…"}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{ams.dry_temperature ? `${ams.dry_temperature}°C` : ""}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>Reste</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "var(--text)", lineHeight: 1.05 }}>{left ? fmt(left) : "—"}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>fin à {endTxt}</div>
          </div>
        </div>
        {done != null && <div>
          <div style={{ height: 10, borderRadius: 6, background: "var(--border)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${done * 100}%`, borderRadius: 6, background: "linear-gradient(90deg, #fb923c, #f97316)",
              boxShadow: "0 0 10px rgba(249,115,22,0.5)" }}/></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", fontWeight: 700, marginTop: 4 }}>
            <span>{fmt(total - left)} écoulées</span><span>sur {fmt(total)}</span></div>
        </div>}
        {/* le mode (le preset de filament), la phase et sa sous-phase, les ventilateurs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ams.dry_filament && <span style={{ padding: "4px 11px", borderRadius: 20, fontSize: 12.5, fontWeight: 900, color: "#fff", background: "#f97316" }}>
            Mode {ams.dry_filament}</span>}
          {DRY_PHASE[ams.dry_status] && <span style={{ padding: "4px 11px", borderRadius: 20, fontSize: 12.5, fontWeight: 800,
            color: DRY_PHASE[ams.dry_status][1], background: `${DRY_PHASE[ams.dry_status][1]}1f` }}>
            ● {DRY_PHASE[ams.dry_status][0]}{DRY_SUB[ams.dry_sub_status] ? ` · ${DRY_SUB[ams.dry_sub_status]}` : ""}</span>}
          {(ams.dry_fan1 || ams.dry_fan2) ? <span style={{ padding: "4px 11px", borderRadius: 20, fontSize: 12.5, fontWeight: 800, color: "var(--text2)",
            background: "var(--surface2)" }}>
            <span style={{ display: "inline-block", animation: "spin 1.2s linear infinite" }}>✻</span> ventilateur{ams.dry_fan1 && ams.dry_fan2 ? "s" : ""}
            {ams.dry_fan1 && ams.dry_fan2 ? " 1 et 2" : ams.dry_fan1 ? " 1" : " 2"}</span> : null}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
          {ams.dry_filament && box("Mode", ams.dry_filament, "#f97316")}
          {box("Consigne", ams.dry_temperature ? `${ams.dry_temperature}°C` : "—", "#f97316")}
          {ams.dry_duration > 0 && box("Durée réglée", fmt(ams.dry_duration * 60))}
          {box("Dans l'AMS", ams.temp != null ? `${Number(ams.temp).toFixed(1).replace(".", ",")} °C` : "—")}
          {box("Humidité", ams.humidity != null ? `${ams.humidity} %` : "—", "#0ea5e9")}
        </div>
        {ams.dry_cannot?.filter(r => r !== 4 && r !== 6).length > 0 && <div style={{ padding: "9px 12px", borderRadius: 12, fontSize: 12.5, fontWeight: 700, color: "#b45309",
          background: "rgba(245,158,11,0.12)" }}>
          Séchage impossible pour l'instant : {ams.dry_cannot.filter(r => r !== 4 && r !== 6).map(r => DRY_CANNOT[r] || `raison ${r}`).join(" ; ")}</div>}
    </div>
  );
}
function DryPopup({ ams, onClose }) {
  React.useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div data-no-pull="" onClick={e => { e.stopPropagation(); onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 950, padding: 14,
      background: "rgba(2,6,23,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{ width: "min(440px, 100%)", padding: 18, display: "flex", flexDirection: "column", gap: 14,
        background: "var(--sheet-bg)", boxShadow: "0 30px 80px rgba(0,0,0,0.45)", position: "relative", overflow: "hidden" }}>
        <span aria-hidden="true" style={{ position: "absolute", right: -70, top: -70, width: 200, height: 200, borderRadius: "50%", background: "rgba(249,115,22,0.15)" }}/>
        <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
          <span style={{ width: 36, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(249,115,22,0.15)", color: "#f97316" }}><Thermometer size={18}/></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: "var(--text)" }}>Séchage · {amsName(ams.id)}</div>
            {ams.dry_filament && <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>{ams.dry_filament}</div>}
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid var(--border)",
            background: "var(--surface2)", color: "var(--text2)", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
        <DryCard ams={ams}/>
      </div>
    </div>, document.body);
}

// ── Détail AMS ─────────────────────────────────────────────────────────────
// bare : seulement les bobines (la fenetre « Mes AMS » montre deja le climat et le sechage)
function AMSDetail({ ams, activeAmsId, activeTrayId, onTrayClick, hideName = false, showNames = true, fitH = null, bare = false }) {
  const [dryOpen, setDryOpen] = React.useState(false);
  // la taille des bobines suit la largeur de la tuile
  const box = React.useRef(null);
  const [w, setW] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const isActive = ams.id===activeAmsId;
  const isDrying = ams.is_drying || ams.dry_time > 0;
  const getInfo = t => t.spool_info ?? null;

  const fmtMins = (mins) => {
    if (!mins) return "";
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? `${h}h${m > 0 ? " " + m + "min" : ""}` : `${m}min`;
  };

  return (
    <div ref={box} className="card" style={{ position:"relative", padding: fitH != null ? "2px" : hideName ? "6px 2px 4px" : 16,
      borderColor: isDrying ? "rgba(249,115,22,0.35)" : isActive ? "rgba(59,130,246,0.3)" : undefined,
      boxShadow: isDrying ? "0 0 0 1px rgba(249,115,22,0.1)" : isActive ? "0 0 0 1px rgba(59,130,246,0.1)" : undefined }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent: hideName ? "flex-end" : "space-between", marginBottom: isDrying ? 10 : fitH != null ? 4 : 12,
        ...((hideName && !hasClimate(ams) && !isDrying) || fitH != null || bare ? { display:"none" } : {}) }}>
        {!hideName && <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:12, fontWeight:700, letterSpacing:"0.06em", color: isDrying?"#f97316":isActive?"#3b82f6":"var(--muted)" }}>
            {amsName(ams.id)}
          </span>
          {isActive && !isDrying && <span style={{ width:6, height:6, borderRadius:"50%", backgroundColor:"#3b82f6", animation:"livePulse 2s infinite" }} />}
          {isDrying && (
            <span style={{
              display:"inline-flex", alignItems:"center", justifyContent:"center",
              width:20, height:20, borderRadius:"50%",
              background:"rgba(249,115,22,0.15)",
              boxShadow:"0 0 0 0 rgba(249,115,22,0.4)",
              animation:"dryPulse 2.5s ease-in-out infinite",
            }}>
              <Thermometer size={13} style={{ color:"#f97316" }}/>
            </span>
          )}
        </div>}
        {hasClimate(ams) && (
        <div style={{ display:"flex", gap:12, fontSize:10, color:"var(--muted)" }}>
          <span style={{ display:"flex", alignItems:"center", gap:3 }}><Droplets size={10}/>{ams.humidity}%</span>
          <span style={{ display:"flex", alignItems:"center", gap:3, color: isDrying ? "#f97316" : "var(--muted)" }}>
            <Sun size={10}/>{ams.temp?.toFixed(1)}°C{isDrying && ams.dry_temperature ? ` → ${ams.dry_temperature}°C` : ""}
          </span>
        </div>
        )}
      </div>

      {/* Bandeau séchage */}
      {dryOpen && <DryPopup ams={ams} onClose={() => setDryOpen(false)}/>}
      {isDrying && fitH == null && !bare && (
        <div role="button" onClick={e => { e.stopPropagation(); setDryOpen(true); }} style={{ cursor:"pointer", marginBottom:14, padding:"10px 12px", borderRadius:10,
          background:"rgba(249,115,22,0.07)", border:"1px solid rgba(249,115,22,0.25)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
            <span style={{ fontSize:12, fontWeight:700, color:"#f97316" }}>Séchage en cours</span>
          </div>
          <div style={{ display:"flex", gap:16, flexWrap:"wrap", fontSize:11, color:"var(--text)" }}>
            {ams.dry_temperature > 0 && (
              <span style={{ display:"flex", alignItems:"center", gap:4 }}><Thermometer size={12} style={{ color:"#f97316", flexShrink:0 }}/> Température : <b>{ams.dry_temperature}°C</b></span>
            )}
            {ams.dry_duration > 0 && (
              <span style={{ display:"flex", alignItems:"center", gap:4 }}><Timer size={12} style={{ color:"var(--muted)", flexShrink:0 }}/> Durée : <b>{ams.dry_duration}h</b></span>
            )}
            {ams.dry_time > 0 && (
              <span style={{ display:"flex", alignItems:"center", gap:4 }}><Clock size={12} style={{ color:"#f97316", flexShrink:0 }}/> Restant : <b style={{ color:"#f97316" }}>{fmtMins(ams.dry_time)}</b></span>
            )}
            {ams.dry_filament && (
              <span style={{ display:"flex", alignItems:"center", gap:4 }}><Package size={12} style={{ color:"var(--muted)", flexShrink:0 }}/> Filament : <b>{ams.dry_filament}</b></span>
            )}
          </div>
        </div>
      )}
      {/* Largeur calquee sur une grille de 4, puis centree : avec un ou deux
          slots -- le cas de l'externe -- une grille figee a 4 colonnes les
          collait a gauche. On garde volontairement la MEME taille de carte
          que dans un AMS plein plutot que de les etirer, sinon deux slots
          externes auraient l'air de deux fois rien a cote d'un AMS. */}
      {fitH != null && w > 0 && (() => {
        const trays = traysInOrder(ams), n = trays.length || 1;
        const cols = Math.min(n, w >= 560 ? 4 : w >= 260 ? 2 : 1);
        const rows = Math.ceil(n / cols);
        const room = fitH - 6;
        const size = Math.max(26, Math.min(cols >= 4 ? 96 : 80, Math.floor((room - 4 * (rows - 1)) / rows) - 4));
        return (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "4px 10px" }}>
            {trays.map(t => <TrayRow key={t.id} tray={t} amsId={ams.id} label={slotLabel(ams.id, t.id)} activeAmsId={activeAmsId}
              activeTrayId={activeTrayId} spoolInfo={getInfo(t)} size={size}
              onClick={() => onTrayClick && onTrayClick({ tray: t, amsId: ams.id, amsLabel: amsName(ams.id), slotNo: traySlotNo(ams, t) })}/>)}
          </div>
        );
      })()}
      {fitH == null && (() => {
        const n = traysInOrder(ams).length || 1;
        const GAP = 4, COLS = 4;
        const byW = w ? Math.max(30, Math.min(96, Math.floor((w - 32 - GAP * (COLS - 1)) / COLS) - 10)) : 68;
        // hauteur imposee : la bobine prend ce que laissent la matiere, la barre, le poids (et le nom s'il tient)
        const compact = fitH != null && fitH < 170;
        const size = fitH != null ? Math.max(26, Math.min(byW, fitH - (compact ? 30 : 64) - (hideName || !hasClimate(ams) ? 0 : 22))) : byW;
        return (
      <div style={{ display:"grid", gridTemplateColumns:`repeat(${n},minmax(0,1fr))`, gap:GAP,
        width: n < COLS
          ? `calc((100% - ${(COLS-1)*GAP}px) * ${n} / ${COLS} + ${(n-1)*GAP}px)`
          : "100%",
        margin:"0 auto" }}>
        {traysInOrder(ams).map(t => (
          <TrayCard key={t.id} tray={t} amsId={ams.id}
            label={slotLabel(ams.id, t.id)}
            activeAmsId={activeAmsId} activeTrayId={activeTrayId}
            spoolInfo={getInfo(t)} size={size} showName={showNames && !compact} compact={compact}
            onClick={()=>onTrayClick&&onTrayClick({tray:t,amsId:ams.id,amsLabel:amsName(ams.id),
              slotNo:traySlotNo(ams, t)})}
          />
        ))}
      </div>
        );
      })()}
    </div>
  );
}


const MATCH_LABEL = {
  rfid:     { text:"RFID Bambu",   color:"#22c55e" },
  auto:     { text:"Auto",         color:"#f59e0b" },
  notfound: { text:"Introuvable",  color:"#ef4444" },
  manual:   { text:"Manuel",       color:"#94a3b8" },
  linked:   { text:"Attribuée à la main", color:"#8b5cf6" },
};

function TrayBottomSheet({ tray, amsId, amsLabel, slotNo, onClose }) {
  useTrackDetail("Accueil · Emplacement AMS");
  const [spoolSheet, setSpoolSheet] = React.useState(null);
  if (!tray) return null;
  const color  = hexDisplay(tray.color);
  const info   = tray.spool_info;
  const match  = MATCH_LABEL[tray.match_mode];
  // ce qui reste : le poids suivi par BambuNymous ; le % de l'AMS reste dans « Données imprimante »
  const pct    = trayPct(tray) ?? 0;
  const isEmpty = tray.empty || !tray.filament_type;
  const [mapOpen, setMapOpen] = React.useState(false);

  const Row = ({ label, value, mono, accent }) => <FRow l={label} v={value} vc={accent} mono={mono}/>;
  const [foldOpen, setFoldOpen] = React.useState({});      // cartes repliees a l'ouverture
  const fold = k => ({ fold: true, open: !!foldOpen[k], onToggle: () => setFoldOpen(o => ({ ...o, [k]: !o[k] })) });
  // la couleur de l'emplacement, pour l'en-tete (une couleur tres claire garde un gris pour la teinte)
  const cols = isEmpty ? (tray.drying_spool ? parseColors({}, tray.drying_spool) : null) : parseColors(tray, info);
  const main = (cols && cols[0]) || "#94a3b8";
  const tint = /^#?f[0-9a-f]f[0-9a-f]f[0-9a-f]/i.test(String(main)) || /^#?(ff|fe|fd|fc|fb|fa)(ff|fe|fd|fc|fb|fa)/i.test(String(main)) ? "#94a3b8" : main;
  const gauge = pct < 20 ? "#ef4444" : pct < 40 ? "#f59e0b" : "#22c55e";
  const name = isEmpty ? (tray.drying_spool ? (tray.drying_spool.translated_name || tray.drying_spool.name) : "Emplacement vide")
    : (info?.translated_name || info?.name || tray.filament_type || "Slot vide");

  return (
    <>
    <FSheet onClose={onClose} z={1000} bottom={!isEmpty && (tray.spool_id || (match && tray.match_mode !== "rfid")) ? <>
      {tray.spool_id && <button onClick={() => setSpoolSheet({ spoolId: tray.spool_id, filamentId: info?.filament_id, hex: info?.color || tray.color })}
        style={{ ...fBtn, flex: 1, border: "none", color: "#fff", background: "linear-gradient(135deg, #3B82F6, #6366F1)",
          boxShadow: "0 8px 18px -10px #3B82F6" }}><Package size={15}/> Fiche de la bobine</button>}
      {/* Tout ce qui n'est pas du RFID peut se tromper : une detection « auto » fausse se corrige ici, et le
          choix est retenu pour l'emplacement tant que le meme filament y reste. */}
      {tray.match_mode && tray.match_mode !== "rfid" && <AdminOnly><button onClick={() => setMapOpen(true)}
        style={{ ...fBtn, flex: 1, minWidth: 0 }}>🔗 {tray.spool_id ? "Attribuer" : "Mapper / Créer"}</button></AdminOnly>}
    </> : null}>
      {/* la bobine de l'emplacement en vedette */}
      <div style={{ position:"relative", overflow:"hidden", padding:"52px 18px 18px", display:"flex", alignItems:"center", gap:16, flexWrap:"wrap",
        background:`radial-gradient(circle at 18% 45%, ${tint}55, transparent 60%), linear-gradient(135deg, ${tint}26, transparent 70%), var(--surface2)` }}>
        {/* les autres exemplaires du filament en ombre (en stock a droite, en commande a gauche), comme sur la fiche bobine */}
        <span style={{ display:"inline-flex", opacity: isEmpty && !tray.drying_spool ? .35 : 1 }}>
          <HeroSpool colors={cols || ["#94a3b8"]} finish={isEmpty ? finishOf(tray.drying_spool) : finishOf(info, tray)} type={isEmpty ? multicolorType({}, tray.drying_spool) : multicolorType(tray, info)}
            color={tint} size={104} stack={!isEmpty && info?.filament_spools > 1 ? info.filament_spools - 1 : 0} ordered={!isEmpty ? (info?.filament_ordered || 0) : 0}
            stockWeight={!isEmpty && info?.filament_stock_g != null && info?.remaining_weight_g != null && info.filament_stock_g > info.remaining_weight_g ? fmtStock(info.filament_stock_g - info.remaining_weight_g) : null}>
            <span style={{ position:"relative", display:"inline-flex" }}>
              <SpoolSVG colors={cols || ["#94a3b8"]} finish={isEmpty ? finishOf(tray.drying_spool) : finishOf(info, tray)} size={104} type={isEmpty ? multicolorType({}, tray.drying_spool) : multicolorType(tray, info)}/>
              {/* Bobine posee pour sechage : hachuree (non inseree). */}
              {isEmpty && tray.drying_spool && <HatchOverlay radius={52}/>}
            </span>
          </HeroSpool>
        </span>
        <div style={{ flex:"1 1 190px", minWidth:0, display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {fChip(`🎛 ${amsLabel} · emplacement ${slotNo ?? tray.id + 1}`, "#3B82F6")}
            {match && <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:800,
              color:match.color, background:`${match.color}1f`, border:`1px solid ${match.color}33` }}><MatchIcon mode={tray.match_mode} size={11}/>{match.text}</span>}
            {info?.needs_drying && fChip("💧 à sécher", DRY_COLOR)}
          </div>
          <div style={{ fontSize:23, fontWeight:900, color:"var(--text)", lineHeight:1.12, overflowWrap:"anywhere" }}>{name}</div>
          {!isEmpty && (info?.brand || info?.fila_type || tray.filament_type) && <div style={{ fontSize:13, fontWeight:700, color:"var(--muted)" }}>
            {[info?.brand, info?.fila_type || tray.filament_type].filter(Boolean).join(" · ")}</div>}
          {!isEmpty && pct > 0 && <div style={{ display:"flex", flexDirection:"column", gap:5, marginTop:2 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
              <span style={{ fontSize:26, fontWeight:900, lineHeight:1.2, ...fGrad(gauge, `color-mix(in srgb, ${gauge} 60%, #ffffff)`) }}>
                {info?.remaining_weight_g ? `${info.remaining_weight_g.toFixed(0)} g` : `${pct} %`}</span>
              {info?.remaining_weight_g ? <span style={{ fontSize:12.5, fontWeight:900, color:"#fff", padding:"2px 8px", borderRadius:20, background:gauge }}>{pct} %</span> : null}
            </div>
            <div style={{ height:8, borderRadius:5, background:"color-mix(in srgb, var(--border) 80%, transparent)", overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${pct}%`, borderRadius:5, transition:"width 0.5s",
                background:`linear-gradient(90deg, ${gauge}, color-mix(in srgb, ${gauge} 60%, #ffffff))` }}/>
            </div>
          </div>}
        </div>
      </div>

      <div style={{ padding:"14px 14px 18px", display:"flex", flexDirection:"column", gap:12 }}>
          {isEmpty ? (
            tray.drying_spool ? (
              <FCard t="Posée pour séchage" i="☀" c="#F59E0B">
                <p style={{ fontSize:13, color:"var(--text)", margin:"4px 0 10px", lineHeight:1.45 }}>
                  Emplacement vide — {[tray.drying_spool.brand, tray.drying_spool.fila_type || tray.drying_spool.material, `#${tray.drying_spool.id}`,
                    tray.drying_spool.remaining_weight_g != null ? `${Math.round(tray.drying_spool.remaining_weight_g)} g restants` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
                <AdminOnly><button onClick={async () => {
                    try { await client.delete(`/printer/ams/${amsId}/${tray.id}/drying`); onClose(); }
                    catch (e) { showAlert(e.response?.data?.detail || e.message); }
                  }}
                  style={{ ...fBtn, alignSelf:"flex-start", padding:"8px 14px", fontSize:13 }}>
                  Retirer de l'emplacement
                </button></AdminOnly>
              </FCard>
            ) : (
              <p style={{ color:"var(--muted)", fontSize:14, fontWeight:700, textAlign:"center", padding:"18px 0" }}>Rien dans cet emplacement.</p>
            )
          ) : (<>
            {info?.found_mode && info.found_mode !== tray.match_mode && (
              <p style={{ fontSize:12, color:"var(--muted)", margin:0 }}>Détection en base : {info.found_mode}</p>
            )}

            {/* ── la bobine liee en base ── */}
            <FCard t={`Bobine${tray.spool_id ? ` #${tray.spool_id}` : " liée en base"}`} i="🧵" c="#F97316">
            {info ? (<>
              {/* Meme decoupage, memes libelles et meme ordre que la fiche
                  bobine : les deux ecrans decrivent le meme objet, ils doivent
                  se lire pareil. Ici les valeurs ne sont pas editables, c'est
                  la seule difference -- le bouton en bas ouvre la vraie fiche
                  pour cela. */}
              <Row label="Emplacement"     value={info.location}/>
              <Row label="Poids restant"   value={info.remaining_weight_g != null ? `${Math.round(info.remaining_weight_g)} g` : null}/>
              <Row label="Stock du filament" value={info.filament_stock_g != null ? `${fmtStock(info.filament_stock_g)} (toutes bobines)${info.filament_ordered ? ` · 📬 ${info.filament_ordered} en commande` : ""}` : null}/>
              <Row label="Prix d'achat"    value={info.price_override ? `${Number(info.price_override).toFixed(2)} €` : null}/>
              <Row label="Tag NFC"         value={info.tag_number} mono/>
              <Row label="Première util."  value={info.first_used_at?.slice(0,10)}/>
              <Row label="Dernière util."  value={info.last_used_at?.slice(0,10)}/>
              <Row label="Dernier séchage" value={info.needs_drying
                ? `${info.last_dried_at?.slice(0,10) || "jamais"} · à sécher`
                : info.last_dried_at?.slice(0,10)} accent={info.needs_drying ? DRY_COLOR : undefined}/>
              <Row label="Commentaire"     value={info.comment}/>
              <Row label="ID externe"      value={info.external_spool_id} mono/>
            </>) : (
              <p style={{ fontSize:12.5, color:"#f59e0b", fontWeight:700, margin:"4px 0 2px" }}>
                {tray.spool_id
                  ? `Bobine #${tray.spool_id} — données non chargées`
                  : "Aucune bobine mappée — matching en attente"}
              </p>
            )}
            </FCard>

            {info && <FCard t={`Filament${info.filament_id ? ` #${info.filament_id}` : ""}`} i="🎨" c="#8B5CF6" {...fold("fil")}
              summary={<p style={{ margin:"4px 0 0", fontSize:12.5, fontWeight:700, color:"var(--muted)" }}>
                {[info.brand, info.material, info.fila_type].filter(Boolean).join(" · ") || "—"}</p>}>
              <Row label="Nom"             value={info.translated_name || info.name}/>
              {info.translated_name && info.name !== info.translated_name &&
                <Row label="Nom EN"        value={info.name}/>}
              <Row label="Marque"          value={info.brand}/>
              <Row label="Matière"         value={info.material}/>
              <Row label="Sous-type"       value={info.fila_type}/>
              {info.swatch != null &&
                <Row label="Échantillon"   value={info.swatch ? "Oui" : "Non"}/>}
              <Row label="Profile ID"      value={info.profile_id} mono/>
              <Row label="Multicolor"      value={info.multicolor_type !== "monochrome" ? info.multicolor_type : null}/>
              <Row label="Poids bobine"    value={info.initial_weight_g ? `${info.initial_weight_g} g` : null}/>
              <Row label="Poids support"   value={info.spool_weight_g ? `${info.spool_weight_g} g` : null}/>
              <Row label="Prix catalogue"  value={info.price ? `${Number(info.price).toFixed(2)} €` : null}/>
            </FCard>}

            {/* Séchage depuis AMS + données catalogue */}
            {(tray.drying_temp > 0 || tray.spool_info?.filament_material) && (
              <FCard t="Séchage" i="🌡" c="#F59E0B">
                {tray.drying_temp > 0 && <Row label="Réglage" value={`${tray.drying_temp}°C · ${tray.drying_time}h`}/>}
                {tray.spool_info?.filament_material && <Row label="Matériau" value={`${tray.spool_info.filament_material}${tray.spool_info.filament_type ? ` — ${tray.spool_info.filament_type}` : ""}`}/>}
              </FCard>
            )}

            {/* ── ce que dit l'imprimante (temps reel), replie ── */}
            <FCard t="Données imprimante" i="📡" c="#06B6D4" {...fold("mqtt")}
              summary={<p style={{ margin:"4px 0 0", fontSize:12.5, fontWeight:700, color:"var(--muted)" }}>
                {[tray.filament_type, tray.remain != null && tray.remain >= 0 ? `${tray.remain} % selon l'AMS` : null].filter(Boolean).join(" · ") || "temps réel"}</p>}>
              <Row label="Type"          value={tray.filament_type}/>
              <Row label="Couleur"       value={(() => { const arr = (info?.colors_array||tray?.colors_array||"").split(",").filter(Boolean); return arr.length > 1 ? arr.map(hexDisplay).filter(Boolean).join(" / ") : color; })()} mono/>
              <Row label="Profile ID"    value={tray.tray_info_idx || tray.tray_id_name}/>
              <Row label="Tag UID"       value={tray.tag_uid && !tray.tag_uid.match(/^0+$/) ? tray.tag_uid : null} mono/>
              <Row label="Restant selon l'AMS" value={tray.remain != null && tray.remain >= 0 ? `${tray.remain}%` : null}/>
              <Row label="UUID tray (RFID)" value={tray.uuid && !tray.uuid.match(/^0+$/) ? tray.uuid : null} mono/>
            </FCard>
          </>)}
      </div>
    </FSheet>
    {mapOpen && (
      <MapTraySheet tray={tray} amsId={amsId} onClose={() => setMapOpen(false)} onMapped={() => { setMapOpen(false); onClose(); }}/>
    )}
    {spoolSheet && createPortal(
      <FilamentSheetFromSpool
        filamentId={spoolSheet.filamentId}
        spoolId={spoolSheet.spoolId}
        filamentColorHex={spoolSheet.hex}
        onClose={() => setSpoolSheet(null)}/>,
      document.body
    )}
    </>
  );
}

// ── Mapper / Créer une bobine pour un tray non reconnu ────────────────────
function MapTraySheet({ tray, amsId, onClose, onMapped }) {
  useTrackDetail("Filaments · Corriger un emplacement AMS");
  const isBambu = Boolean(tray.tray_info_idx);
  // On ouvre toujours sur les bobines existantes : une bobine tierce sans profil
  // (emplacement « non identifie ») doit pouvoir etre associee, pas seulement creee.
  const [mode, setMode] = React.useState("suggest");
  const [spools, setSpools] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const hasRfid = Boolean(tray.uuid && !/^0+$/.test(tray.uuid));
  const [catalogInfo, setCatalogInfo] = React.useState(null); // entrée catalogue Bambu
  const [source, setSource] = React.useState("catalog");      // "catalog" | "free"
  const [form, setForm] = React.useState({
    name: "",
    material: tray.filament_type || "PLA Basic",
    manufacturer: (isBambu && hasRfid) ? "Bambu Lab" : "",
    weight: "1000",
  });

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (tray.color) params.set("color", tray.color);
    params.set("tray_has_rfid", hasRfid ? "true" : "false");

    const spoolsP = client.get("/filaments/map-tray/suggest?" + params)
      .then(r => setSpools(r.data?.spools || []))
      .catch(() => setSpools([]));

    // Rechercher dans le catalogue Bambu pour pré-remplir le formulaire de création.
    //
    // Le tray MQTT donne la FAMILLE ("PLA"), pas la variante ("PLA Basic").
    // Or le filtre `fila_type` de /catalog/search fait une egalite STRICTE sur le
    // type detaille du catalogue : envoyer "PLA" ne matchait donc jamais rien et
    // le bandeau catalogue n'apparaissait plus. C'est `family` qu'il faut passer.
    const FAMILIES = ["PLA-CF","PETG-CF","PA-CF","PPS","PETG","PLA","ABS","ASA","TPU","PVA","PC","PA"];
    const rawType = (tray.filament_type || "").trim();
    const family = FAMILIES.find(m => rawType.toUpperCase() === m
      || rawType.toUpperCase().startsWith(m + " ")
      || rawType.toUpperCase().startsWith(m + "-")) || rawType;

    // Le catalogue renvoie color_hex sur 8 caracteres (alpha compris) : on
    // compare donc les 6 premiers des deux cotes.
    const hex6 = h => (h || "").replace(/^#/, "").toLowerCase().slice(0, 6);

    const catalogP = (tray.tray_info_idx && tray.color && family)
      ? client.get("/filaments/catalog/search", { params: { family, lang: "fr" } })
          .then(r => {
            const target = hex6(tray.color);
            const entries = r.data?.entries || [];
            // 1) couleur exacte ET meme reference RFID  2) couleur exacte  3) reference RFID
            const match =
              entries.find(e => hex6(e.color_hex) === target && e.fila_id === tray.tray_info_idx)
              || entries.find(e => hex6(e.color_hex) === target)
              || entries.find(e => e.fila_id === tray.tray_info_idx);
            if (match) {
              setCatalogInfo(match);
              setForm(f => ({
                ...f,
                name: match.name_fr || match.name,
                // material = famille, fila_type = variante
                material: match.family || family,
                manufacturer: "Bambu Lab",
              }));
            }
          }).catch(() => {})
      : Promise.resolve();

    Promise.all([spoolsP, catalogP]).finally(() => setLoading(false));
  }, []);

  const [result, setResult] = React.useState(null); // réponse backend après action

  const link = async (spool_id) => {
    setSaving(true);
    try {
      if (!hasRfid && amsId != null) {
        // Sans RFID : simple attribution a l'emplacement, retenue tant que le
        // meme filament y reste. Rien n'est modifie sur la bobine ni le filament.
        await client.post("/filaments/map-tray/assign", { ams_id: amsId, tray_id: tray.id, spool_id });
        const s = spools.find(x => x.id === spool_id);
        setResult({ action: "assigned", spool_id,
          filament_name: s ? (s.filament_translated_name || s.filament_name) : `#${spool_id}`,
          changes: [
            "Attribution valable pour cet emplacement seulement, tant que ce filament y reste : elle s'oublie dès qu'on le retire ou le remplace.",
            "Pour que la détection automatique la reconnaisse seule la prochaine fois, renseigne bien le profil et la couleur du filament (fiche filament).",
          ] });
        return;
      }
      // RFID : on ecrit le tag sur la bobine, il la reconnaitra partout ensuite.
      const r = await client.post("/filaments/map-tray/link", {
        spool_id, tray_uuid: tray.uuid, profile_id: tray.tray_info_idx, color: tray.color,
      });
      setResult(r.data);
    } catch (e) {
      showAlert(e.response?.data?.detail || e.message);
    } finally { setSaving(false); }
  };

  const useCatalog = !!catalogInfo && source === "catalog";

  const create = async () => {
    setSaving(true);
    try {
      const body = {
        tray_uuid: tray.uuid, profile_id: tray.tray_info_idx, color: tray.color,
        ams_id: amsId, tray_id: tray.id,
        material: form.material, name: form.name,
        manufacturer: form.manufacturer || undefined,
        weight: Number(form.weight) || 1000,
      };
      // Import catalogue : on transmet la variante, le nom FR, les couleurs et le
      // code Bambu, sinon la fiche creee serait plus pauvre que la meme reference
      // importee par ailleurs.
      if (useCatalog) {
        Object.assign(body, {
          name:            catalogInfo.name_fr || catalogInfo.name,
          name_en:         catalogInfo.name,
          translated_name: catalogInfo.name_fr || undefined,
          material:        catalogInfo.family || form.material,
          fila_type:       catalogInfo.fila_type,
          fila_color_code: catalogInfo.fila_color_code || undefined,
          multicolor_type: catalogInfo.color_type_fr || undefined,
          colors:          catalogInfo.colors || undefined,
          manufacturer:    "Bambu Lab",
        });
      }
      const r = await client.post("/filaments/map-tray/create", body);
      setResult(r.data);
    } finally { setSaving(false); }
  };

  const inputStyle = { width:"100%", background:"var(--surface)", border:"1px solid var(--border)",
    borderRadius:12, padding:"10px 12px", fontSize:14, fontWeight:600, color:"var(--text)", outline:"none",
    boxSizing:"border-box" };
  const labelStyle = { fontSize:12, fontWeight:800, color:"var(--muted)", margin:"0 0 5px", display:"block" };

  const M = "#3B82F6";
  const trayCols = parseColors(tray, null) || ["#94a3b8"];
  if (result) return (
    <FSheet onClose={onClose} z={1100} bottom={<button onClick={onMapped} style={{ ...fBtn, flex: 1, border: "none", color: "#fff",
      background: "linear-gradient(135deg, #22C55E, #16A34A)", boxShadow: "0 8px 18px -10px #22C55E" }}>✓ Terminé</button>}>
      <div style={{ padding: "52px 18px 16px", display: "flex", alignItems: "center", gap: 14,
        background: "radial-gradient(circle at 15% 40%, rgba(34,197,94,0.4), transparent 60%), var(--surface2)" }}>
        <span style={{ width: 48, height: 48, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 24, color: "#fff", background: "linear-gradient(135deg, #22C55E, #16A34A)", boxShadow: "0 8px 18px -8px #22C55E" }}>✓</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)" }}>
            {result.action === "assigned" ? "Bobine attribuée" : result.action === "mapped" ? "Filament mappé" : "Bobine créée"}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>{result.filament_name}</div>
        </div>
      </div>
      <div style={{ padding: "14px 14px 18px" }}>
        <FCard t="Ce qui a changé" i="🔄" c="#22C55E">
          {(result.changes || []).map((c, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 0", borderTop: "1px dashed var(--border)" }}>
              <span style={{ color: "#22c55e", fontSize: 13, fontWeight: 900, flexShrink: 0 }}>→</span>
              <span style={{ fontSize: 13, color: "var(--text)" }}>{c}</span>
            </div>
          ))}
        </FCard>
      </div>
    </FSheet>
  );

  const segBtn = on => ({ flex: 1, padding: "8px 8px", borderRadius: 11, fontSize: 12.5, fontWeight: 800, border: "none", cursor: "pointer", whiteSpace: "nowrap",
    background: on ? `linear-gradient(135deg, ${M}, #6366F1)` : "transparent", color: on ? "white" : "var(--muted)" });
  return (
    <FSheet onClose={onClose} z={1100}>
      <div style={{ padding: "52px 18px 16px", display: "flex", alignItems: "center", gap: 14,
        background: `radial-gradient(circle at 15% 40%, ${M}44, transparent 60%), var(--surface2)` }}>
        <span style={{ display: "inline-flex", flexShrink: 0, filter: `drop-shadow(0 6px 14px ${M}55)` }}><SpoolSVG colors={trayCols} size={62}/></span>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: M }}>🔗 Emplacement</span>
          <span style={{ fontSize: 19, fontWeight: 900, color: "var(--text)", lineHeight: 1.2 }}>
            {tray.spool_id ? "Attribuer une bobine à cet emplacement" : "Associer une bobine à cet emplacement"}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
            {tray.filament_type || "Type inconnu"}
            {tray.color ? ` · ${hexDisplay(tray.color) || ('#'+tray.color)}` : ""}
            {tray.tray_info_idx ? ` · ${tray.tray_info_idx}` : ""}
            {tray.uuid && !/^0+$/.test(tray.uuid) ? ` · 🔖 ${tray.uuid.slice(0,8)}…` : ""}
          </span>
        </div>
      </div>
        <div style={{ padding:"14px 16px 20px" }}>
          {/* Bascule pour tous : une bobine tierce aussi peut deja exister. */}
          {(
            <div style={{ display:"flex", gap:3, padding:3, marginBottom:14, borderRadius:14, background:"var(--surface)", border:"1px solid var(--border)" }}>
              {[["suggest","🧵 Bobine existante"],["create","➕ Créer"]].map(([id,label]) => (
                <button key={id} onClick={() => setMode(id)} style={segBtn(mode === id)}>{label}</button>
              ))}
            </div>
          )}

          {mode === "suggest" && !hasRfid && amsId != null && (
            <p style={{ fontSize:11, color:"var(--muted)", margin:"0 0 10px", lineHeight:1.45 }}>
              L'attribution ne vaut que pour cet emplacement, tant que ce filament y reste.
              Pour une détection automatique fiable, mieux vaut renseigner le profil et la
              couleur du filament.
            </p>
          )}
          {mode === "suggest" && (
            loading
              ? <p style={{ color:"var(--muted)", fontSize:13 }}>Recherche des bobines sans RFID…</p>
              : spools.length === 0
                ? <p style={{ color:"var(--muted)", fontSize:13 }}>
                    Aucune bobine sans tag RFID trouvée.<br/>
                    <span style={{ fontSize:11 }}>Passe en mode « Créer » pour en créer une.</span>
                  </p>
                : spools.map(s => (
                  <button key={s.id}
                    disabled={saving}
                    onClick={() => link(s.id)}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 12px",
                      borderRadius:14, border:"1px solid var(--border)", background:"var(--surface2)",
                      marginBottom:8, cursor: saving ? "default" : "pointer",
                      opacity: saving ? 0.6 : 1, textAlign:"left" }}>
                    <span style={{ display:"inline-flex", flexShrink:0 }}><SpoolSVG colors={[s.filament_color ? `#${s.filament_color}` : "#94a3b8"]} size={36}/></span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:13, fontWeight:700, color:"var(--text)", margin:0,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.filament_translated_name || s.filament_name}</p>
                      <p style={{ fontSize:10, color:"var(--muted)", margin:0 }}>
                        {[s.filament_manufacturer, s.filament_material].filter(Boolean).join(" · ")}
                        {s.remaining_weight_g ? ` · ${Math.round(s.remaining_weight_g)}g` : ""}
                      </p>
                    </div>
                    <span style={{ fontSize:12, color:"#fff", fontWeight:800, flexShrink:0, padding:"5px 11px", borderRadius:20,
                      background:"linear-gradient(135deg, #3B82F6, #6366F1)" }}>
                      {saving ? "…" : "Associer →"}
                    </span>
                  </button>
                ))
          )}

          {mode === "create" && (<>
            {/* Le catalogue Bambu connait cette reference : on laisse le choix
                explicite entre l'import (fiche complete) et la creation libre. */}
            {catalogInfo && (
              <div style={{ marginBottom:12 }}>
                <div style={{ display:"flex", gap:3, background:"var(--surface)", border:"1px solid var(--border)",
                  borderRadius:14, padding:3, marginBottom:8 }}>
                  {[["catalog","📦 Depuis le catalogue"],["free","✏️ Création libre"]].map(([id,label]) => (
                    <button key={id} onClick={() => setSource(id)}
                      style={segBtn(source === id)}>
                      {label}
                    </button>
                  ))}
                </div>
                {source === "catalog" && (
                  <div style={{ padding:"8px 12px", borderRadius:10,
                    background:"rgba(59,130,246,0.06)", border:"1px solid rgba(59,130,246,0.2)",
                    display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:24, height:24, borderRadius:5, flexShrink:0,
                      background: `#${(catalogInfo.color_hex || "888").slice(0,6)}` }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:12, fontWeight:700, color:"#60a5fa", margin:0,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {catalogInfo.name_fr || catalogInfo.name} — {catalogInfo.fila_type}
                      </p>
                      <p style={{ fontSize:10, color:"var(--muted)", margin:0 }}>
                        {catalogInfo.fila_id} · {catalogInfo.fila_color_code || catalogInfo.color_code}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* En import catalogue, ces champs sont ignores : les afficher
                editables laisserait croire le contraire. */}
            {!useCatalog && (<>
              <div style={{ marginBottom:10 }}>
                <label style={labelStyle}>Nom de la couleur</label>
                <input style={inputStyle} value={form.name} autoFocus placeholder="ex: Jade White"
                  onChange={e => setForm(f => ({...f, name: e.target.value}))}/>
              </div>
              <div style={{ marginBottom:10 }}>
                <label style={labelStyle}>Matière (PLA, PETG, ABS…)</label>
                <input style={inputStyle} value={form.material}
                  onChange={e => setForm(f => ({...f, material: e.target.value}))}/>
              </div>
              <div style={{ marginBottom:10 }}>
                <label style={labelStyle}>Marque</label>
                <input style={inputStyle} value={form.manufacturer}
                  onChange={e => setForm(f => ({...f, manufacturer: e.target.value}))}/>
              </div>
            </>)}
            <div style={{ marginBottom:12 }}>
              <label style={labelStyle}>Poids total (g)</label>
              <input style={inputStyle} type="number" value={form.weight}
                onChange={e => setForm(f => ({...f, weight: e.target.value}))}/>
            </div>
            <button onClick={create} disabled={saving}
              style={{ ...fBtn, width:"100%", border:"none",
                background: saving ? "var(--border)" : "linear-gradient(135deg, #3B82F6, #6366F1)", boxShadow: saving ? "none" : "0 8px 18px -10px #3B82F6",
                color:"white", cursor: saving ? "default" : "pointer" }}>
              {saving ? "Création…"
                : useCatalog ? "Importer depuis le catalogue"
                : "Créer le filament et la bobine"}
            </button>
          </>)}
        </div>
    </FSheet>
  );
}


// ── Section principale ─────────────────────────────────────────────────────
export { AMSBox, AMSDetail, TrayBottomSheet, DryPopup, DryCard, amsName, EXT_AMS_ID };

export default function AMSSection({ amsList, activeAmsId, activeTrayId }) {
  // Dédupliquer par id au cas où le polling enverrait des doublons
  const uniqueAmsList = amsList ? [...new Map(amsList.map(a=>[a.id,a])).values()] : [];
  const [selectedId, setSelectedId] = useState(null);
  const [selectedTray, setSelectedTray] = useState(null);
  if (!uniqueAmsList?.length) return (
    <div className="card" style={{ padding:24, textAlign:"center", color:"var(--muted)", fontSize:14 }}>Aucun AMS détecté</div>
  );
  const autoId = activeAmsId >= 0 ? activeAmsId : uniqueAmsList[0]?.id ?? 0;
  const displayId = selectedId !== null ? selectedId : autoId;
  const displayAms = uniqueAmsList.find(a=>a.id===displayId) ?? uniqueAmsList[0];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* Sélecteur */}
      <div className="card" style={{ padding:12 }}>
        <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.min(uniqueAmsList.length,4)},1fr)`, gap:12 }}>
          {uniqueAmsList.map(ams => (
            <AMSBox key={ams.id} ams={ams} activeAmsId={activeAmsId} activeTrayId={activeTrayId}
              isSelected={ams.id===displayId}
              onClick={() => setSelectedId(p => p===ams.id ? null : ams.id)}
            />
          ))}
        </div>
      </div>
      {/* Détail */}
      {displayAms && <AMSDetail ams={displayAms} activeAmsId={activeAmsId} activeTrayId={activeTrayId} onTrayClick={setSelectedTray}/>}
      {selectedTray && <TrayBottomSheet tray={selectedTray.tray} amsId={selectedTray.amsId} amsLabel={selectedTray.amsLabel}
        slotNo={selectedTray.slotNo} onClose={()=>setSelectedTray(null)}/>}
    </div>
  );
}
