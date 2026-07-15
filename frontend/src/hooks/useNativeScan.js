import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Pont vers le shell Android (WebView).
 *
 * Le shell natif — quand il existe — expose `window.BambuScan`. En PWA pure, cet
 * objet est absent : tout ce fichier devient alors inerte, `available` reste
 * false, et rien de l'application normale n'est modifié. C'est la condition du
 * « zéro régression » : la présence du pont AJOUTE une capacité, elle n'altère
 * aucun comportement existant.
 *
 * Contrat côté natif (window.BambuScan) :
 *   - isAvailable(): "true" | "false"      (chaîne — pont JS = types primitifs)
 *   - startScan(): démarre l'écoute NFC continue
 *   - stopScan():  arrête l'écoute
 * Le natif renvoie chaque scan à la page par un CustomEvent "bambu-rfid-scan"
 * dont le detail porte { status, redirect, error }.
 */
export function useNativeScan(onScan) {
  const [available] = useState(() => {
    try { return !!(window.BambuScan && window.BambuScan.isAvailable() === "true"); }
    catch { return false; }
  });
  const [listening, setListening] = useState(false);
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  useEffect(() => {
    if (!available) return;
    const handler = (e) => onScanRef.current?.(e.detail || {});
    window.addEventListener("bambu-rfid-scan", handler);
    return () => window.removeEventListener("bambu-rfid-scan", handler);
  }, [available]);

  const start = useCallback(() => {
    if (!available) return;
    try { window.BambuScan.startScan(); setListening(true); } catch {}
  }, [available]);

  const stop = useCallback(() => {
    if (!available) return;
    try { window.BambuScan.stopScan(); } catch {}
    setListening(false);
  }, [available]);

  const toggle = useCallback(() => {
    if (listening) stop(); else start();
  }, [listening, start, stop]);

  // Filet de sécurité : si la page se démonte alors que l'écoute tourne (on
  // quitte Filaments), on coupe le reader mode natif — sinon il lirait dans le
  // vide en arrière-plan.
  useEffect(() => () => { if (available) { try { window.BambuScan.stopScan(); } catch {} } }, [available]);

  return { available, listening, start, stop, toggle };
}
