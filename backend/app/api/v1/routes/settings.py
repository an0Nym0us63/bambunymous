from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from ....db.session import get_db
from ....services.settings_service import get_all_settings, set_setting, get_setting
from ....core.mqtt import mqtt_manager
from ....core.security import hash_password
from .auth import get_current_user, require_admin

router = APIRouter()


@router.delete("/reset-all", tags=["settings"])
async def reset_all_data(_: str = Depends(get_current_user)):
    """
    Vide TOUTES les données : historique, filaments, bobines, snapshots, 3MF,
    ainsi que tous les fichiers images associés (prints, filaments, groupes, uploads, tmp).
    Garde les settings (IP, token…) et la base settings elle-même.
    """
    import shutil, os
    from sqlalchemy import text
    from ....db.session import AsyncSessionLocal
    from pathlib import Path

    async with AsyncSessionLocal() as db:
        # Supprimer dans l'ordre FK
        for tbl in [
            "print_tags", "print_snapshots", "filament_usage", "prints",
            "bobines", "filaments", "groups",
            "object_accessories", "objects", "object_groups",
        ]:
            try:
                await db.execute(text(f"DELETE FROM {tbl}"))
            except Exception:
                pass
        await db.commit()

    # Supprimer tous les fichiers/images associés (prints, filaments, groupes, uploads, tmp)
    data_dir = Path(os.getenv("DATA_DIR", "/data"))
    for sub in ("prints", "filaments", "groups", "uploads", "tmp", "objects", "accessories"):
        d = data_dir / sub
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True, exist_ok=True)

    return {"ok": True, "message": "Toutes les données et images supprimées"}


@router.get("/ams-order")
async def get_ams_order(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    """Disposition des AMS sur l'accueil (objet {rows, cols, cells}, ou ancienne liste)."""
    import json
    raw = await get_setting(db, "AMS_ORDER")
    try:
        order = json.loads(raw) if raw else []
    except Exception:
        order = []
    return {"order": order}


@router.post("/ams-order")
async def set_ams_order(body: dict, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    """
    body: {"order": {"rows": R, "cols": C, "cells": [{"id": ams_id, "row": r, "col": c}]}}
    Grille de l'accueil aux dimensions choisies, chaque unite rangee par sa
    case (0 = premiere ligne / colonne). Couvre AMS (0-3), AMS HT (128+) et
    externe (255). L'ancienne forme -- une liste de positions lue colonne par
    colonne sur deux lignes -- reste relue par le front.
    """
    import json
    raw = body.get("order")
    if not isinstance(raw, dict):
        raise HTTPException(422, "order doit etre un objet {rows, cols, cells}")

    def entier(v, lo, hi):
        return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi

    rows, cols = raw.get("rows"), raw.get("cols")
    if not entier(rows, 1, 4) or not entier(cols, 1, 8):
        raise HTTPException(422, "rows doit valoir 1 a 4 et cols 1 a 8")
    cells, ids, prises = [], set(), set()
    for c in (raw.get("cells") or [])[:64]:
        if not isinstance(c, dict):
            continue
        i, r, k = c.get("id"), c.get("row"), c.get("col")
        if not entier(i, 0, 255) or not entier(r, 0, rows - 1) or not entier(k, 0, cols - 1):
            raise HTTPException(422, f"case invalide : {c}")
        # Une unite rangee deux fois s'afficherait deux fois, deux unites sur
        # une case se recouvriraient : refus plutot que choix silencieux.
        if i in ids or (r, k) in prises:
            raise HTTPException(422, f"unite ou case en double : {c}")
        ids.add(i)
        prises.add((r, k))
        cells.append({"id": i, "row": r, "col": k})
    order = {"rows": rows, "cols": cols, "cells": cells}
    await set_setting(db, "AMS_ORDER", json.dumps(order))
    return {"ok": True, "order": order}


class SettingsOut(BaseModel):
    PRINTER_IP: str = ""
    PRINTER_ID: str = ""
    PRINTER_ACCESS_CODE_SET: bool = False   # indique si un code est configuré, sans l'exposer
    PRINTER_NAME: str = ""
    PRINTER_MODEL: str = ""          # vide = automatique
    PRINTER_MODEL_AUTO: str = ""     # deduit du numero de serie
    PRINTER_MODELS: list = []
    ADMIN_USERNAME: str = "admin"
    COST_BY_HOUR: str = "0"


class SettingsUpdate(BaseModel):
    PRINTER_IP: Optional[str] = None
    PRINTER_ID: Optional[str] = None
    PRINTER_ACCESS_CODE: Optional[str] = None   # None = ne pas toucher
    PRINTER_NAME: Optional[str] = None
    PRINTER_MODEL: Optional[str] = None
    ADMIN_USERNAME: Optional[str] = None
    ADMIN_PASSWORD: Optional[str] = None
    COST_BY_HOUR: Optional[str] = None


@router.get("", response_model=SettingsOut)
async def get_settings(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    all_s = await get_all_settings(db)
    from ....services.makerworld import printer_from_serial, PRINTER_MODELS
    return SettingsOut(
        PRINTER_MODEL=all_s.get("PRINTER_MODEL", "") or "",
        PRINTER_MODEL_AUTO=printer_from_serial(all_s.get("PRINTER_ID", "")),
        PRINTER_MODELS=PRINTER_MODELS,
        PRINTER_IP=all_s.get("PRINTER_IP", ""),
        PRINTER_ID=all_s.get("PRINTER_ID", ""),
        PRINTER_ACCESS_CODE_SET=bool(all_s.get("PRINTER_ACCESS_CODE")),
        PRINTER_NAME=all_s.get("PRINTER_NAME", ""),
        ADMIN_USERNAME=all_s.get("ADMIN_USERNAME", "admin"),
        COST_BY_HOUR=all_s.get("COST_BY_HOUR", "0"),
    )


@router.patch("")
async def update_settings(
    body: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    printer_changed = False
    elec_changed = False
    data = body.model_dump(exclude_none=True)

    for field, value in data.items():
        if field == "ADMIN_PASSWORD":
            if value:
                await set_setting(db, "ADMIN_PASSWORD_HASH", hash_password(value))
        elif field == "PRINTER_ACCESS_CODE":
            if value:
                await set_setting(db, field, value)
                printer_changed = True
        else:
            if field == "COST_BY_HOUR":
                # « 0,20 » comme « 0.20 » : la virgule francaise faisait echouer
                # le calcul du cout electrique (float("0,20")).
                v = str(value or "").strip().replace(",", ".").replace(" ", "").replace("€", "")
                try:
                    value = str(float(v or 0))
                except ValueError:
                    raise HTTPException(400, "Tarif électrique invalide (ex. 0,20)")
            await set_setting(db, field, value)
            if field in ("PRINTER_IP", "PRINTER_ID"):
                printer_changed = True
            if field == "COST_BY_HOUR":
                elec_changed = True

    if printer_changed:
        ip   = await get_setting(db, "PRINTER_IP")
        pid  = await get_setting(db, "PRINTER_ID")
        code = await get_setting(db, "PRINTER_ACCESS_CODE")
        if ip and pid and code:
            mqtt_manager.reconnect(ip, pid, code)

    if elec_changed:
        # Recalcul de tous les prints en arrière-plan
        import threading, asyncio as _aio
        def _recalc_all():
            loop = _aio.new_event_loop()
            async def _go():
                from ....db.session import AsyncSessionLocal
                from ....models.print_history import Print
                from sqlalchemy import select as _sel
                from ....services.print_tracker import recalculate_print
                async with AsyncSessionLocal() as db2:
                    pids = (await db2.execute(_sel(Print.id).where(Print.status == "SUCCESS"))).scalars().all()
                for pid in pids: await recalculate_print(pid)
            try: loop.run_until_complete(_go())
            finally: loop.close()
        threading.Thread(target=_recalc_all, daemon=True).start()

    return {"ok": True}


# ── Delais de sechage ─────────────────────────────────────────────────────────
@router.get("/dry-rules")
async def get_dry_rules(db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    """Delai par defaut, regles declarees, et familles / sous-familles connues (menu)."""
    from sqlalchemy import select, distinct
    from ....models.filament import Filament
    from ....services import drying
    rules = await drying.load(db)
    fams = (await db.execute(select(distinct(Filament.material)).where(Filament.material.isnot(None)))).scalars().all()
    types = (await db.execute(select(distinct(Filament.fila_type)).where(Filament.fila_type.isnot(None)))).scalars().all()
    clean = lambda xs: sorted({x.strip() for x in xs if x and x.strip()}, key=str.lower)
    return {**rules, "families": clean(fams), "types": clean(types)}


@router.put("/dry-rules")
async def put_dry_rules(body: dict, _: str = Depends(require_admin)):
    from ....services import drying
    return await drying.save(body)


# ── Modeles de support vide ───────────────────────────────────────────────────
# Poids d'un support (bobine vide) par marque ou modele : « Bambu Lab -> 250 g ».
# Proposes en liste partout ou l'on saisit ce poids (pesee, fiche filament),
# avec « Autre » pour une valeur libre. Une liste dans la table settings.
SPOOL_TARES_KEY = "SPOOL_TARES"


async def _read_tares(db) -> list:
    import json
    raw = await get_setting(db, SPOOL_TARES_KEY, "")
    try:
        data = json.loads(raw) if raw else []
    except ValueError:
        data = []
    return [t for t in data if isinstance(t, dict) and t.get("name")] if isinstance(data, list) else []


@router.get("/spool-tares")
async def get_spool_tares(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    return {"tares": await _read_tares(db)}


SPOOL_TARES_LINKED_KEY = "SPOOL_TARES_LINKED"


async def link_legacy_tares(db, fils=None, tares=None) -> int:
    """
    Une seule fois (cle SPOOL_TARES_LINKED) : les filaments d'avant le lien
    sont rattaches au modele dont le poids est exactement le leur, s'il est
    seul a l'avoir. Appele au demarrage, et avant tout enregistrement des
    modeles. Rend le nombre de filaments rattaches.
    """
    from sqlalchemy import select
    from ....models.filament import Filament
    if await get_setting(db, SPOOL_TARES_LINKED_KEY, ""):
        return 0
    if tares is None:
        tares = await _read_tares(db)
    if fils is None:
        fils = (await db.execute(select(Filament))).scalars().all()
    n = 0
    for f in fils:
        if f.spool_tare_name or f.spool_weight_g is None:
            continue
        m = [t for t in tares if abs(float(t["weight_g"]) - f.spool_weight_g) < 0.05]
        if len(m) == 1:
            f.spool_tare_name = m[0]["name"]
            n += 1
    await db.commit()
    await set_setting(db, SPOOL_TARES_LINKED_KEY, "1")
    return n


@router.put("/spool-tares")
async def put_spool_tares(body: dict, db: AsyncSession = Depends(get_db), _: str = Depends(require_admin)):
    """
    body: {"tares": [{"name": "Bambu Lab", "weight_g": 250, "from": "Bambu Lab"}, ...]}

    Les filaments rattaches a un modele (spool_tare_name) suivent : nouveau
    poids repercute, renommage (« from » = nom d'origine de la ligne) suivi,
    modele supprime -> lien retire, le poids reste. Le poids restant des
    bobines n'est pas recalcule (la pesee d'origine n'est pas gardee).
    """
    import json
    from sqlalchemy import select
    from ....models.filament import Filament
    raw = body.get("tares")
    if not isinstance(raw, list) or len(raw) > 100:
        raise HTTPException(422, "tares doit etre une liste (100 au plus)")
    out, vus = [], set()
    for t in raw:
        if not isinstance(t, dict):
            raise HTTPException(422, "Modele invalide")
        name = str(t.get("name") or "").strip()[:60]
        if not name:
            raise HTTPException(422, "Chaque modele a besoin d'un nom")
        try:
            w = float(t.get("weight_g"))
        except (TypeError, ValueError):
            raise HTTPException(422, f"Poids manquant pour « {name} »")
        if not 0 <= w <= 5000:
            raise HTTPException(422, f"Poids invalide pour « {name} » (0 a 5000 g)")
        if name.lower() in vus:
            raise HTTPException(422, f"« {name} » est en double")
        vus.add(name.lower())
        frm = str(t.get("from") or "").strip() or None
        out.append({"name": name, "weight_g": round(w, 1), "_from": frm})
    out.sort(key=lambda x: x["name"].lower())

    before = await _read_tares(db)
    fils = (await db.execute(select(Filament))).scalars().all()

    await link_legacy_tares(db, fils, before)

    # nom d'origine -> nouvelle ligne ; un nom d'origine absent = supprime
    by_from = {}
    for o in out:
        by_from[(o["_from"] or o["name"]).lower()] = o
    updated = 0
    for f in fils:
        if not f.spool_tare_name:
            continue
        o = by_from.get(f.spool_tare_name.lower())
        if o is None:
            f.spool_tare_name = None          # modele supprime : le poids reste
            continue
        if f.spool_tare_name != o["name"] or f.spool_weight_g != o["weight_g"]:
            if f.spool_weight_g != o["weight_g"]:
                updated += 1
            f.spool_tare_name, f.spool_weight_g = o["name"], o["weight_g"]
    await db.commit()

    clean = [{"name": o["name"], "weight_g": o["weight_g"]} for o in out]
    await set_setting(db, SPOOL_TARES_KEY, json.dumps(clean))
    await set_setting(db, SPOOL_TARES_LINKED_KEY, "1")
    return {"tares": clean, "updated_filaments": updated}
