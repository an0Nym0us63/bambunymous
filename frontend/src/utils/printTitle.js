// Le nom affiche d'une impression (14/11/2026) : son nom francais quand il en a un, sinon son nom de fichier.
// Pas les traductions « union » des services automatiques (Google, DeepL, MyMemory) : elles collent le mot a mot et le
// contextuel pour la recherche (« Goofy serie GRIM REAPER Yeux mobiles NON AMS LA FAUCHEUR SANS ») et ne font pas un nom.
// Celles de Claude et les corrections a la main, si.
const UNION = new Set(["gcloud", "google", "deepl", "mymemory"]);

export function printTitle(p) {
  if (!p) return "";
  const t = (p.translated_name || "").trim();
  if (t && !UNION.has(p.translated_by || "")) return t;
  return p.file_name || t || "";
}
