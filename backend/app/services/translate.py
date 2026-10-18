"""
Traduction en francais des noms de prints.

Les noms arrivent tels que le trancheur ou MakerWorld les a produits : anglais,
chinois, parfois un nom de fichier brut. Chercher "cochon" ne trouvait donc
jamais "cute_pig_keychain". Ce champ existe uniquement pour la RECHERCHE ; il
ne remplace jamais le nom d'origine.

Portage de la fonction de Spoolnymous, qui avait deja resolu le probleme. Elle
ne concerne QUE les prints -- le translated_name des filaments a sa propre
source, le catalogue Bambu local, et n'a rien a voir avec ceci.

Services, dans l'ordre : Google Cloud Translation si une cle est posee
(Parametres ; 500 000 caracteres gratuits par mois, renouveles), puis
l'endpoint public de Google, puis MyMemory, puis DeepL si une cle est posee. Les deux premiers sont gratuits,
sans cle et bornes -- Google coupe vite (TooManyRequests), MyMemory plafonne
a quelques milliers de caracteres par jour -- mais leurs limites se
renouvellent. L'offre gratuite de DeepL est un credit qui ne se renouvelle
pas (1 million de caracteres au total pour les comptes recents) : il ne sert
donc qu'en dernier recours, pour ce que les deux autres n'ont pas traduit.

Regle qui compte : un ECHEC n'est jamais pris pour « deja en francais ». Un
service a bout de quota renvoie le texte tel quel ; l'ancienne version
l'enregistrait alors comme nom francais, et le print n'etait plus jamais
retente. Un echec rend desormais None et rien n'est ecrit : le prochain
passage (automatique, toutes les 6 h) le reprend.
"""
import logging
import threading
import time

logger = logging.getLogger(__name__)

DEEPL_KEY = "DEEPL_API_KEY"
GCLOUD_KEY = "GCLOUD_TRANSLATE_KEY"
KEY_SETTINGS = {"deepl": DEEPL_KEY, "gcloud": GCLOUD_KEY}

# MyMemory a bout de quota : on ne le sollicite plus jusqu'a cette heure.
_MYMEMORY_PAUSE = {"until": 0.0}


class TranslateUnavailable(Exception):
    """Aucun service n'a pu traduire : rien ne doit etre enregistre."""


def _looks_bogus(text: str) -> bool:
    """Vrai si `text` n'est pas une traduction mais une PAGE D'ERREUR.

    L'endpoint public de Google renvoie parfois du HTML d'erreur en HTTP 200
    ("Error 500 ... That's an error ... That's all we know"), que le scraper
    restitue tel quel -- et qui finissait stocke dans translated_name.
    """
    if not text:
        return False
    low = text.lower()
    markers = ("that's an error", "that’s an error", "that's all we know",
               "that’s all we know", "server error", "please try again later",
               "error 500", "error 429", "!!1", "<html", "</", "http://", "https://",
               "www.google.com",
               # erreurs renvoyees EN TEXTE (HTTP 200) par MyMemory
               "invalid source language", "invalid target language", "langpair=",
               "mymemory warning", "you used all available", "please specify")
    if any(m in low for m in markers):
        return True
    return len(text) > 300   # un nom traduit ne fait jamais 300+ caracteres


def _gcloud_batch(payload: list, key: str):
    """Traduit via Google Cloud Translation v2 (source detectee). None si
    indisponible -- quota du jour atteint compris (plafond pose dans la console)."""
    import requests
    try:
        r = requests.post("https://translation.googleapis.com/language/translate/v2",
                          params={"key": key.strip()}, timeout=20,
                          json={"q": payload, "target": "fr", "format": "text"})
    except Exception as e:
        logger.warning(f"[TRAD] Google Cloud injoignable ({type(e).__name__})")
        return None
    if r.status_code == 429 or (r.status_code == 403 and "quota" in r.text.lower()):
        logger.warning("[TRAD] Google Cloud : quota atteint")
        return None
    if r.status_code in (400, 401, 403):
        logger.warning(f"[TRAD] Google Cloud : clé ou API refusée (HTTP {r.status_code})")
        return None
    if r.status_code != 200:
        logger.warning(f"[TRAD] Google Cloud : HTTP {r.status_code}")
        return None
    try:
        out = [t.get("translatedText", "") for t in r.json()["data"]["translations"]]
    except (ValueError, KeyError, TypeError):
        return None
    return out if len(out) == len(payload) else None


def _deepl_batch(payload: list, key: str):
    """Traduit via l'API DeepL (source detectee). None si indisponible."""
    import requests
    host = "api-free.deepl.com" if key.strip().endswith(":fx") else "api.deepl.com"
    try:
        r = requests.post(f"https://{host}/v2/translate", timeout=20,
                          headers={"Authorization": f"DeepL-Auth-Key {key.strip()}"},
                          json={"text": payload, "target_lang": "FR"})
    except Exception as e:
        logger.warning(f"[TRAD] DeepL injoignable ({type(e).__name__})")
        return None
    if r.status_code == 456:
        logger.warning("[TRAD] DeepL : quota du mois atteint")
        return None
    if r.status_code in (401, 403):
        logger.warning("[TRAD] DeepL : clé refusée")
        return None
    if r.status_code != 200:
        logger.warning(f"[TRAD] DeepL : HTTP {r.status_code}")
        return None
    try:
        out = [t.get("text", "") for t in r.json().get("translations", [])]
    except ValueError:
        return None
    return out if len(out) == len(payload) else None


def _mymemory_one(txt: str):
    """Traduit UNE chaine via MyMemory (gratuit, sans cle). None si echec."""
    if time.time() < _MYMEMORY_PAUSE["until"]:
        return None
    from deep_translator import MyMemoryTranslator
    # MyMemory exige une langue source ISO ('auto' est refuse). Les noms de print
    # sont quasi toujours en anglais (MakerWorld / trancheur) -> on force 'en'.
    for src in ("en-GB", "en-US", "en"):
        try:
            r = MyMemoryTranslator(source=src, target="fr-FR").translate(txt)
        except Exception as e:
            if "TooManyRequests" in type(e).__name__ or "quota" in str(e).lower():
                break
            continue
        if r and not _looks_bogus(r):
            return r
        if r and "you used all available" in r.lower():
            break
    else:
        return None
    # Quota du jour epuise : inutile d'insister avant quelques heures.
    _MYMEMORY_PAUSE["until"] = time.time() + 6 * 3600
    logger.warning("[TRAD] MyMemory : quota du jour atteint, pause de 6 h")
    return None


def _translate_batch(payload: list, keys=None) -> tuple:
    """Traduit une liste de chaines vers le FR. Rend (traductions, services),
    deux listes de meme longueur que payload ; une traduction None = echec
    (rien ne doit etre enregistre), le service dit qui a repondu.

    Les services gratuits qui se renouvellent passent d'abord ; DeepL, dont le
    quota gratuit s'epuise pour de bon, ne recoit que ce qu'ils n'ont pas pu
    traduire. keys = {"gcloud": ..., "deepl": ...} (cles facultatives)."""
    keys = keys if isinstance(keys, dict) else {"deepl": keys or ""}
    if keys.get("gcloud"):
        r = _gcloud_batch(payload, keys["gcloud"])
        if r is not None and not any(_looks_bogus(x or "") for x in r):
            return r, ["gcloud"] * len(r)
    from deep_translator import GoogleTranslator
    try:
        r = GoogleTranslator(source="auto", target="fr").translate_batch(payload)
        if r and len(r) == len(payload) and not any(_looks_bogus(x or "") for x in r):
            return r, ["google"] * len(r)
        logger.warning("[TRAD] Google indisponible (page d'erreur) -> repli MyMemory")
    except Exception as e:
        logger.warning(f"[TRAD] Google KO ({type(e).__name__}) -> repli MyMemory")
    r = [_mymemory_one(x) for x in payload]
    by = [("mymemory" if x is not None else None) for x in r]
    reste = [i for i, x in enumerate(r) if x is None]
    if reste and keys.get("deepl"):
        d = _deepl_batch([payload[i] for i in reste], keys["deepl"])
        if d is not None and not any(_looks_bogus(x or "") for x in d):
            for i, x in zip(reste, d):
                r[i], by[i] = x, "deepl"
    return r, by


def _merge(mot_a_mot: str, contextuel: str) -> str:
    seen, words = set(), []
    for w in (mot_a_mot + " " + contextuel).split():
        if w.lower() not in seen:
            seen.add(w.lower())
            words.append(w)
    return " ".join(words)


def translate_name(name: str, keys=None) -> tuple:
    """
    Traduit un nom vers le francais : rend (texte, service), service valant
    "identique" si le nom est deja francais. Leve TranslateUnavailable si aucun
    service n'a repondu.

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
        return "", "identique"
    original = name.strip()
    r, by = _translate_batch(["\n".join(name.split()), original], keys)
    if r[0] is None or r[1] is None:
        raise TranslateUnavailable()
    mot_a_mot = " ".join((r[0] or "").strip().split("\n")).strip()
    contextuel = (r[1] or "").strip()
    if _looks_bogus(contextuel) or _looks_bogus(mot_a_mot):
        raise TranslateUnavailable()
    if contextuel.lower() == original.lower():
        return contextuel, "identique"
    merged = _merge(mot_a_mot, contextuel)
    return merged, (by[1] if merged.lower() != original.lower() else "identique")


async def _keys() -> dict:
    """Cles des services payants ou a credit, posees dans les Parametres."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        return {k: (await get_setting(db, s, "") or "").strip() for k, s in KEY_SETTINGS.items()}


async def translate_print(pid: int) -> bool:
    """
    Renseigne prints.translated_name si le champ est vide.

    Ne remplit QUE le vide : cette seule regle protege les corrections faites a
    la main, sans qu'il faille un drapeau pour les distinguer.

    Lire, traduire, ecrire -- en refermant la session entre les deux. La garder
    ouverte immobiliserait une connexion SQLite pendant tout l'appel reseau,
    soit plusieurs secondes, et ce code s'execute sur le chemin de creation
    d'un print : precisement la ou une pression d'ecriture supplementaire est
    le moins souhaitable.
    """
    import asyncio
    from sqlalchemy import update
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    from .tmf_parser import _clean_name

    async with AsyncSessionLocal() as db:
        p = await db.get(Print, pid)
        if not p or (p.translated_name or "").strip():
            return False
        source = _clean_name(p.file_name or p.original_name or "").strip()
    if not source:
        return False
    key = await _keys()

    try:
        tr, by = await asyncio.to_thread(translate_name, source, key)
        tr = tr.strip()
    except TranslateUnavailable:
        # Rien d'ecrit : le rattrapage automatique le reprendra.
        logger.info(f"[TRAD] print #{pid} : services indisponibles, repris plus tard")
        return False
    except Exception as e:
        logger.warning(f"[TRAD] print #{pid} : {e}")
        return False
    # Deja francais : on inscrit le nom nettoye (vrai, et utile a la recherche),
    # pour ne pas le representer a chaque rattrapage.
    if not tr or tr.lower() == source.lower():
        tr, by = source, "identique"

    async with AsyncSessionLocal() as db:
        await db.execute(update(Print).where(Print.id == pid)
                         .values(translated_name=tr[:512], translated_by=by))
        await db.commit()
    logger.info(f"[TRAD] print #{pid} : {source!r} → {tr!r} ({by})")
    return True


def launch_translation(pid: int) -> None:
    """
    Lance la traduction sans rien bloquer. Un appel reseau vers un service tiers
    n'a rien a faire sur le chemin d'enregistrement d'un print : au pire le
    champ reste vide et le rattrapage le reprendra.
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


def translate_names(names: list, keys=None) -> dict:
    """
    Traduit une liste de noms et rend {source: traduction}.

    Valeur (traduction, service) ; ("", "identique") = rien a traduire (deja
    francais, intraduisible, sans lettre) ; nom ABSENT du resultat = echec du
    service, a ne pas enregistrer.

    Trois economies par rapport a Spoolnymous, qui traitait un print a la fois :

      1. DEDOUBLONNAGE. Un meme modele reimprime dix fois porte dix fois le
         meme nom. On ne traduit qu'une fois et on applique partout.
      2. GROUPAGE. 20 noms partent en UNE requete au lieu de 20. Sur une
         bibliotheque fournie, c'est ce qui evite de se faire couper pour abus.
      3. TRI PREALABLE. Un nom sans la moindre lettre (« 20250807_163605 »)
         n'a rien a traduire : on ne le soumet pas.
    """
    import re as _re

    out, uniques = {}, []
    for n in names:
        n = (n or "").strip()
        if not n or n in uniques or n in out:
            continue
        if not _re.search(r"[^\W\d_]", n, _re.UNICODE):   # aucune lettre
            out[n] = ("", "identique")
            continue
        uniques.append(n)

    for i in range(0, len(uniques), _CHUNK):
        chunk = uniques[i:i + _CHUNK]
        # Deux entrees par nom : mot a mot (un terme par ligne) puis contextuel.
        payload = []
        for n in chunk:
            payload.append("\n".join(n.split()))
            payload.append(n)

        try:
            res, by = _translate_batch(payload, keys)
        except Exception as e:
            logger.warning(f"[TRAD] lot ignore : {e}")
            continue

        failed = 0
        for k, n in enumerate(chunk):
            m, c = res[2 * k], res[2 * k + 1]
            if m is None or c is None:
                failed += 1
                continue                      # echec : rien d'enregistre
            mot_a_mot = " ".join((m or "").split("\n")).strip()
            contextuel = (c or "").strip()
            if _looks_bogus(contextuel) or _looks_bogus(mot_a_mot):
                failed += 1
                continue
            if not contextuel or contextuel.lower() == n.lower():
                out[n] = ("", "identique")    # deja francais, ou intraduisible
                continue
            merged = _merge(mot_a_mot, contextuel)
            out[n] = ((merged[:512], by[2 * k + 1]) if merged.lower() != n.lower()
                      else ("", "identique"))

        # Tout le lot en echec : les services sont a bout, inutile de
        # continuer a les solliciter pour les lots suivants.
        if failed == len(chunk):
            logger.warning("[TRAD] services indisponibles, rattrapage remis a plus tard")
            break
        # Respiration entre deux lots : les endpoints sont publics.
        if i + _CHUNK < len(uniques):
            time.sleep(0.5)
    return out


async def translate_missing_prints(limit: int = 40, retry_same: bool = False,
                                   exclude: set = None) -> dict:
    """
    Traduit jusqu'a `limit` prints sans nom francais, et rend le reste a faire.

    retry_same : reprend AUSSI les prints dont le nom francais est simplement
    leur nom d'origine nettoye -- ceux qu'un service a bout de quota a fait
    passer pour « deja francais ». Un nom saisi a la main differe du nom
    d'origine : il n'est jamais repris.

    Le travail se fait en TROIS temps -- lire, traduire hors boucle, ecrire --
    et non d'une traite. deep_translator est une bibliotheque bloquante :
    l'appeler dans une fonction async gele la boucle d'evenements, donc tout le
    serveur, pendant chaque requete reseau. On sort donc la traduction dans un
    thread, et on ne garde surtout pas la session SQL ouverte pendant ce temps.
    """
    import asyncio
    from sqlalchemy import select, or_, update
    from ..db.session import AsyncSessionLocal
    from ..models.print_history import Print
    from .tmf_parser import _clean_name

    exclude = exclude if exclude is not None else set()

    # ── 1. Lecture, session refermee aussitot ────────────────────────────
    async with AsyncSessionLocal() as db:
        q = select(Print.id, Print.file_name, Print.original_name, Print.translated_name)
        if not retry_same:
            q = q.where(or_(Print.translated_name.is_(None), Print.translated_name == ""))
        # Du plus recent au plus vieux : ce sont les prints recents qu'on
        # cherche en premier.
        rows = (await db.execute(q.order_by(Print.print_date.desc()))).all()

    todo = []
    for pid, fn, on, tn in rows:
        if pid in exclude:
            continue
        src = _clean_name(fn or on or "").strip()
        tn = (tn or "").strip()
        if tn and not (retry_same and tn.lower() == src.lower()):
            continue
        todo.append((pid, src, fn or on or ""))
    remaining_before = len(todo)
    batch = todo[:limit]
    if not batch:
        return {"translated": 0, "skipped": 0, "failed": 0, "remaining": 0}
    for pid, _, _ in batch:
        exclude.add(pid)

    # ── 2. Traduction HORS de la boucle d'evenements ─────────────────────
    key = await _keys()
    table = await asyncio.to_thread(translate_names, [s for _, s, _ in batch if s], key)

    # ── 3. Ecriture, session rouverte ────────────────────────────────────
    done = skipped = failed = 0
    async with AsyncSessionLocal() as db:
        for pid, src, raw in batch:
            if src and src not in table:
                failed += 1                 # echec du service : on n'ecrit rien
                continue
            tr, by = table.get(src, ("", "identique"))
            if tr:
                done += 1
            else:
                # Rien a traduire : on inscrit le nom NETTOYE plutot qu'un
                # marqueur technique. C'est vrai, ca reste utile a la
                # recherche, et ca evite de representer ce print a chaque
                # passage suivant.
                tr, by = src or raw, "identique"
                skipped += 1
            await db.execute(update(Print).where(Print.id == pid)
                             .values(translated_name=tr[:512], translated_by=by))
        await db.commit()

    return {"translated": done, "skipped": skipped, "failed": failed,
            "remaining": max(0, remaining_before - len(batch))}


# ── Rattrapage en tache de fond ────────────────────────────────────────────
#
# L'etat tient en un booleen, en memoire du processus, volontairement : si le
# serveur redemarre, le thread est mort avec lui et le drapeau doit repartir a
# faux.
_BACKFILL = {"running": False, "stop": False, "last": None}


def backfill_running() -> bool:
    return bool(_BACKFILL["running"])


def backfill_last():
    """Bilan du dernier rattrapage termine (ou None)."""
    return _BACKFILL["last"]


def stop_backfill() -> None:
    _BACKFILL["stop"] = True


def start_backfill(retry_same: bool = False) -> bool:
    """Demarre le rattrapage. Rend False s'il tournait deja."""
    if _BACKFILL["running"]:
        return False
    _BACKFILL.update(running=True, stop=False)

    def _run():
        import asyncio
        loop = asyncio.new_event_loop()
        total = {"translated": 0, "skipped": 0, "failed": 0}
        seen = set()
        try:
            while not _BACKFILL["stop"]:
                r = loop.run_until_complete(
                    translate_missing_prints(40, retry_same=retry_same, exclude=seen))
                for k in total:
                    total[k] += r.get(k, 0)
                if not r.get("remaining"):
                    break
                # Un lot entierement en echec : services a bout, on s'arrete
                # (le passage automatique suivant reprendra).
                if r.get("failed") and not (r.get("translated") or r.get("skipped")):
                    break
        except Exception:
            logger.exception("[TRAD] rattrapage interrompu")
        finally:
            loop.close()
            _BACKFILL.update(running=False, stop=False,
                             last={**total, "at": time.strftime("%Y-%m-%dT%H:%M:%S")})
            logger.info(f"[TRAD] rattrapage termine : {total['translated']} traduit(s), "
                        f"{total['skipped']} deja en francais, {total['failed']} en echec")

    threading.Thread(target=_run, daemon=True).start()
    return True


async def auto_backfill_loop(period_s: int = 6 * 3600, first_delay_s: int = 300):
    """Reprend toutes les 6 h les prints restes sans nom francais (echecs de
    quota) : un nom non traduit ne doit pas attendre un clic dans les reglages."""
    import asyncio
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            start_backfill()
        except Exception:
            logger.exception("[TRAD] rattrapage automatique")
        await asyncio.sleep(period_s)
