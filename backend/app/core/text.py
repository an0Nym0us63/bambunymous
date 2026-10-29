"""Petits outils de texte partages."""
import html


def unent(s):
    """Les entites HTML d'un nom (« Akaki&apos;s Picnic », « Tom &amp; Jerry ») remises en caracteres (29/10/2026) :
    l'imprimante et le cloud Bambu en envoient dans les noms de taches. Deux passes, pour un nom echappe deux fois
    (« &amp;apos; »). Rend la valeur telle quelle si ce n'est pas du texte."""
    if not isinstance(s, str) or "&" not in s:
        return s
    for _ in range(2):
        t = html.unescape(s)
        if t == s:
            break
        s = t
    return s
