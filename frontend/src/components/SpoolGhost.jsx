import React from "react";
import SpoolSVG from "./SpoolSVG";

// Les autres exemplaires d'un filament, derriere une bobine (28/10/2026) : une ombre discrete du meme dessin, a peine decalee.
// En stock : a droite ; en commande (pas encore recue) : a gauche, plus pale et grise. Le compte en petit, a cote.
export function Ghost({ side, size, off, top, colors, finish, type, ordered = false }) {
  return <span aria-hidden="true" style={{ position:"absolute", top, [side]: -off, opacity: ordered ? 0.32 : 0.55,
    filter: ordered ? "grayscale(.5) saturate(.6)" : "saturate(.8)" }}>
    <SpoolSVG colors={colors} finish={finish} size={size} type={type}/></span>;
}
export function GhostBadge({ side, color = "var(--muted)", bg = "color-mix(in srgb, var(--muted) 12%, transparent)", tip, children, size = 9.5, bottom = 0, off = 0 }) {
  return <span data-tip={tip} style={{ position:"absolute", [side]: off, bottom, zIndex:2, fontSize:size, fontWeight:700, color, background:bg, opacity:.9,
    borderRadius:8, padding:"0 5px", whiteSpace:"nowrap", lineHeight:1.5 }}>{children}</span>;
}
export const ORD_C = "#0284c7", ORD_BG = "color-mix(in srgb, #0EA5E9 14%, transparent)";
export const tipStock = (n, w) => `${n} autre${n > 1 ? "s" : ""} bobine${n > 1 ? "s" : ""} de ce filament en stock${w ? ` (${w})` : ""}`;
export const tipOrdered = n => `${n} bobine${n > 1 ? "s" : ""} de ce filament commandée${n > 1 ? "s" : ""}, pas encore reçue${n > 1 ? "s" : ""}`;

// l'en-tete d'une fiche (118 px) : la bobine et ses ombres, les comptes poses a cote, au-dessus de l'ombre portee
export function HeroSpool({ colors, finish, type, color, stack = 0, ordered = 0, size = 118, stockWeight = null, children }) {
  const k = size / 118;
  return <span style={{ position:"relative", display:"inline-flex", flexShrink:0, filter:`drop-shadow(0 8px 18px ${color}66)`,
    marginRight: stack > 0 ? 12 * k : 0, marginLeft: ordered > 0 ? 12 * k : 0 }}>
    {stack > 0 && <Ghost side="right" size={108 * k} off={12 * k} top={5 * k} colors={colors} finish={finish} type={type}/>}
    {ordered > 0 && <Ghost side="left" size={108 * k} off={12 * k} top={5 * k} colors={colors} finish={finish} type={type} ordered/>}
    {children || <span style={{ position:"relative", display:"inline-flex" }}><SpoolSVG colors={colors} finish={finish} size={size} type={type}/></span>}
    {stack > 0 && <GhostBadge side="right" size={11} bottom={22 * k} off={-18 * k} tip={tipStock(stack, stockWeight)}>🧵 +{stack}</GhostBadge>}
    {ordered > 0 && <GhostBadge side="left" size={11} bottom={22 * k} off={-18 * k} color={ORD_C} bg={ORD_BG} tip={tipOrdered(ordered)}>📬 +{ordered}</GhostBadge>}
  </span>;
}
