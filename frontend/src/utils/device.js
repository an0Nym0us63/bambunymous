// Un identifiant d'appareil tire au hasard, garde dans le navigateur : le serveur suit par appareil
// ce qui a deja ete annonce (paliers, fete des cartes), pour qu'un appareil n'avale pas l'annonce
// d'un autre. Sans stockage (navigation privee) : vide, le serveur suit alors le compte.
export function deviceId() {
  try {
    let d = localStorage.getItem("bn-device");
    if (!d) {
      d = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join("");
      localStorage.setItem("bn-device", d);
    }
    return d;
  } catch { return ""; }
}
