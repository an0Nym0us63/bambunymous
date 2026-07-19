"""
Traduction en francais des noms de prints.

Les noms arrivent tels que le trancheur ou MakerWorld les a produits : anglais,
chinois, parfois un nom de fichier brut. Chercher "cochon" ne trouvait donc
jamais "cute_pig_keychain". Ce champ existe uniquement pour la RECHERCHE ; il
ne remplace jamais le nom d'origine.

Portage de la fonction de Spoolnymous, qui avait deja resolu le probleme. Elle
ne concerne QUE les prints -- le translated_name des filaments a sa propre
source, le catalogue Bambu local, et n'a rien a voir avec ceci.
"""
import logging
import threading

logger = logging.getLogger(__name__)


def translate_name(name: str) -> str:
    """
    Traduit un nom vers le francais.

    Double passage, repris tel quel de Spoolnymous, et c'est la ruse qui fait
    tout l'interet de la fonction :

      - mot a mot, en forcant un terme par ligne. Sur un nom de fichier, le
        contexte n'aide pas et induit meme en erreur : isoler les mots donne
        de bien meilleurs resultats sur "cute_pig_keychain".
      - contextuel, sur la chaine entiere, qui rattrape les expressions.

    On garde l'union dedoublonnee des deux, ce qui maximise les chances qu'un
    terme cherche s'y trouve -- l'objectif est d'etre trouve, pas d'etre
    elegant. Si le passage contextuel rend la chaine inchangee, le nom est deja
    francais (ou intraduisible) et on s'arrete la.
    """
    if not name or not name.strip():
        return ""

    import time
    from deep_translator import GoogleTranslator, exceptions

    forced_input = "\n".join(name.split())
    original = name.strip()

    def _both():
        # translate_batch : UNE seule requete pour les deux passages au lieu de
        # deux. Sur un rattrapage de plusieurs centaines de prints, c'est la
        # difference entre passer sous le quota et se faire couper.
        r = GoogleTranslator(source="auto", target="fr").translate_batch(
            [forced_input, original])
        return (r[0] or "").strip(), (r[1] or "").strip()

    try:
        mot_a_mot, contextuel = _both()
    except exceptions.TooManyRequests:
        time.sleep(1)          # un seul repli : au-dela, on rend l'original
        try:
            mot_a_mot, contextuel = _both()
        except Exception:
            return original
    mot_a_mot = " ".join(mot_a_mot.split("\n")).strip()

    if contextuel.lower() == original.lower():
        return contextuel

    seen, words = set(), []
    for word in (mot_a_mot + " " + contextuel).split():
        key = word.lower()
        if key not in seen:
            seen.add(key)
            words.append(word)
    return " ".join(words)


async def translate_print(pid: int) -> bool:
    """
    Renseigne prints.translated_name si le champ est vide.

    Ne remplit QUE le vide : cette seule regle protege les corrections faites a
    la main, sans qu'il faille un drapeau pour les distinguer.
    """
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print

    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p or (p.translated_name or "").strip():
            return False
        source = (p.file_name or p.original_name or "").strip()
        if not source:
            return False
        try:
            tr = translate_name(source).strip()
        except Exception as e:
            # L'endpoint public de Google n'est pas contractuel : il coupe ou
            # limite le debit. Un nom non traduit n'est pas un incident, la
            # recherche retombe simplement sur le nom d'origine.
            logger.warning(f"[TRAD] print #{pid} : {e}")
            return False
        if not tr or tr.lower() == source.lower():
            return False
        p.translated_name = tr[:512]
        await db.commit()
        logger.info(f"[TRAD] print #{pid} : {source!r} → {tr!r}")
        return True


def launch_translation(pid: int) -> None:
    """
    Lance la traduction sans rien bloquer. Un appel reseau vers un service tiers
    n'a rien a faire sur le chemin d'enregistrement d'un print : au pire le
    champ reste vide et le bouton de rattrapage le reprendra.
    """
    def _run():
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(translate_print(pid))
        except Exception:
            logger.exception(f"[TRAD] echec pour le print #{pid}")
        finally:
            loop.close()

    threading.Thread(target=_run, daemon=True).start()
