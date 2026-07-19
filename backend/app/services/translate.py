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


# ── Rattrapage groupé ──────────────────────────────────────────────────────

_CHUNK = 20        # noms distincts par requête (soit 40 chaînes envoyées)


def translate_names(names: list) -> dict:
    """
    Traduit une liste de noms et rend {source: traduction}.

    Trois economies par rapport a Spoolnymous, qui traitait un print a la fois :

      1. DEDOUBLONNAGE. Un meme modele reimprime dix fois porte dix fois le
         meme nom. On ne traduit qu'une fois et on applique partout.
      2. GROUPAGE. translate_batch accepte une liste : 20 noms partent en UNE
         requete au lieu de 20. Sur une bibliotheque fournie, c'est ce qui
         evite de se faire couper pour abus.
      3. TRI PREALABLE. Un nom sans la moindre lettre (« 20250807_163605 »)
         n'a rien a traduire : on ne le soumet pas.
    """
    import re as _re
    import time
    from deep_translator import GoogleTranslator, exceptions

    uniques = []
    for n in names:
        n = (n or "").strip()
        if not n or n in uniques:
            continue
        if not _re.search(r"[^\W\d_]", n, _re.UNICODE):   # aucune lettre
            continue
        uniques.append(n)
    if not uniques:
        return {}

    out = {}
    for i in range(0, len(uniques), _CHUNK):
        chunk = uniques[i:i + _CHUNK]
        # Deux entrees par nom : mot a mot (un terme par ligne) puis contextuel.
        payload = []
        for n in chunk:
            payload.append("\n".join(n.split()))
            payload.append(n)

        def _go():
            return GoogleTranslator(source="auto", target="fr").translate_batch(payload)

        try:
            res = _go()
        except exceptions.TooManyRequests:
            time.sleep(2)
            try:
                res = _go()
            except Exception as e:
                logger.warning(f"[TRAD] lot abandonne apres nouvel echec : {e}")
                continue
        except Exception as e:
            logger.warning(f"[TRAD] lot ignore : {e}")
            continue

        for k, n in enumerate(chunk):
            mot_a_mot  = " ".join((res[2*k]     or "").split("\n")).strip()
            contextuel = (res[2*k + 1] or "").strip()
            if not contextuel or contextuel.lower() == n.lower():
                continue          # deja francais, ou intraduisible
            seen, words = set(), []
            for w in (mot_a_mot + " " + contextuel).split():
                if w.lower() not in seen:
                    seen.add(w.lower())
                    words.append(w)
            merged = " ".join(words)
            if merged and merged.lower() != n.lower():
                out[n] = merged[:512]

        # Respiration entre deux lots : l'endpoint est public, on ne le
        # martele pas.
        if i + _CHUNK < len(uniques):
            time.sleep(0.5)
    return out


async def translate_missing_prints(limit: int = 40) -> dict:
    """
    Traduit jusqu'a `limit` prints sans nom francais, et rend le reste a faire.

    Volontairement borne et repetable plutot que lance en tache de fond : le
    front rappelle jusqu'a ce qu'il ne reste rien, ce qui donne une progression
    reelle sans etat serveur, sans thread et sans route de statut a maintenir.
    """
    from sqlalchemy import select, or_, func
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    from .tmf_parser import _clean_name

    async with AsyncSessionLocal() as db:
        base = select(Print).where(
            or_(Print.translated_name.is_(None), Print.translated_name == ""))
        # Du plus recent au plus vieux : ce sont les prints recents qu'on
        # cherche en premier. Sans order_by explicite, SQLite rendait l'ordre
        # des rowid, donc les plus anciens d'abord -- exactement l'inverse de
        # ce qui est utile si le rattrapage s'interrompt en cours de route.
        rows = (await db.execute(
            base.order_by(Print.print_date.desc()).limit(limit))).scalars().all()
        # COUNT plutot que de charger toutes les lignes pour les compter : sur
        # plusieurs centaines de prints, la difference est reelle.
        remaining_before = (await db.execute(
            select(func.count()).select_from(base.subquery()))).scalar_one()
        if not rows:
            return {"translated": 0, "skipped": 0, "remaining": 0}

        # On traduit le nom NETTOYE : sans extension, sans underscore ni
        # marqueur de version, le traducteur voit enfin des mots.
        sources = {}
        for p in rows:
            src = _clean_name(p.file_name or p.original_name or "")
            if src:
                sources[p.id] = src

        table = translate_names(list(sources.values()))

        done = 0
        for p in rows:
            tr = table.get(sources.get(p.id, ""))
            if tr:
                p.translated_name = tr
                done += 1
            else:
                # Rien a traduire : deja francais, nom propre, ou sans lettre.
                # On inscrit le nom NETTOYE plutot qu'un marqueur technique.
                # C'est vrai -- le nom francais est bien celui-la --, ca reste
                # utile a la recherche, et surtout ca evite de represente ce
                # print a chaque passage suivant, ce qui bouclerait sans fin.
                p.translated_name = (sources.get(p.id) or
                                     p.file_name or p.original_name or "")[:512]
        await db.commit()

    return {"translated": done, "skipped": len(rows) - done,
            "remaining": max(0, remaining_before - len(rows))}
