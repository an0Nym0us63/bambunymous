// Dialogues in-app (remplacent alert()/confirm() natifs du navigateur).
// API imperative : showAlert(msg) et showConfirm(msg) -> Promise. Un unique
// <DialogHost/> monte a la racine enregistre le handler qui affiche la modale.
let _handler = null;
export function _register(fn) { _handler = fn; }

export function showAlert(message, opts = {}) {
  if (!_handler) { window.alert(message); return Promise.resolve(); }
  return _handler({ type: "alert", message, ...opts });
}
export function showConfirm(message, opts = {}) {
  if (!_handler) return Promise.resolve(window.confirm(message));
  return _handler({ type: "confirm", message, ...opts });
}
