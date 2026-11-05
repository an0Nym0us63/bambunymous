"""Ce que les catalogues savent d'un filament (05/11/2026), reuni en une liste de faits, chacun avec sa source : la fiche
d'un filament et le navigateur des catalogues les montrent tels quels.

Sources : le profil Bambu Studio (filaments Bambu, par leur identifiant « GFA00 »), la boutique Bambu (liens de rachat),
l'Open Filament Database (densite, temperatures, code-barres, reference, mandrin, liens d'achat, site et pays de la
marque), notre catalogue, FilamentColors (couleur mesuree, transparence TD, temperatures, Pantone / RAL proches, photo).

Un fait : {k, label, value, src, url?}. src : « bambu » (Bambu Studio), « boutique », « ofd », « own », « fc ».
"""

SRC = {"bambu": "Bambu Studio", "boutique": "Boutique Bambu", "ofd": "Open Filament Database", "own": "Notre catalogue",
       "fc": "FilamentColors"}


def _num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return int(x) if x == int(x) else x


def fr(x) -> str:
    """Un nombre a la francaise (1,26)."""
    return str(x).replace(".", ",")


def _range(a, b, unit="°C"):
    a, b = _num(a), _num(b)
    if a is None and b is None:
        return None
    if a is not None and b is not None and a != b:
        return f"{a}–{b} {unit}"
    return f"{a if a is not None else b} {unit}"


def from_profile(p: dict | None) -> list:
    """Le profil Bambu Studio d'un filament Bambu."""
    if not p:
        return []
    out = []
    def add(k, label, value, url=None):
        if value not in (None, "", "0 °C"):
            out.append({"k": k, "label": label, "value": value, "src": "bambu", **({"url": url} if url else {})})
    n = _num(p.get("nozzle_temperature"))
    add("nozzle", "Buse", (f"{n} °C" if n else None) and (f"{n} °C" + (f" (de {_num(p.get('nozzle_temperature_range_low'))} à "
        f"{_num(p.get('nozzle_temperature_range_high'))})" if p.get("nozzle_temperature_range_low") else "")))
    plates = [(lbl, _num(p.get(k))) for lbl, k in (("texturé", "textured_plate_temp"), ("lisse", "hot_plate_temp"), ("froid", "cool_plate_temp"))]
    plates = [f"{v} °C {lbl}" for lbl, v in plates if v]
    add("bed", "Plateau", " · ".join(plates) or None)
    d = _num(p.get("filament_density"))
    add("density", "Densité", f"{fr(d)} g/cm³" if d else None)
    v = _num(p.get("filament_max_volumetric_speed"))
    add("flow", "Débit maximal", f"{fr(v)} mm³/s" if v else None)
    v = _num(p.get("temperature_vitrification"))
    add("soften", "Ramollit vers", f"{v} °C" if v else None)
    t, h = _num(p.get("filament_dev_ams_drying_temperature")), _num(p.get("filament_dev_ams_drying_time"))
    add("dry", "Séchage conseillé", f"{t} °C pendant {h} h" if t and h else None)
    c = _num(p.get("filament_cost"))
    add("cost", "Prix catalogue (US)", f"{fr(c)} $" if c else None)
    if str(p.get("filament_soluble")) == "1":
        add("soluble", "Soluble", "oui")
    if str(p.get("filament_is_support")) == "1":
        add("support", "Filament de support", "oui")
    return out


def from_store(code: str) -> list:
    if not code:
        return []
    from . import bambu_store
    e = (bambu_store.load().get("codes") or {}).get(str(code).strip()) or {}
    out = []
    # une couleur vendue d'une seule facon : son lien est range sous « any » (05/11/2026 : il manquait sur la fiche)
    if e.get("any") and not e.get("spool") and not e.get("refill"):
        out.append({"k": "buy_any", "label": "Racheter", "value": "boutique Bambu", "url": e["any"], "src": "boutique"})
    if e.get("spool"):
        out.append({"k": "buy_spool", "label": "Racheter (bobine 1 kg)", "value": "boutique Bambu", "url": e["spool"], "src": "boutique"})
    if e.get("refill"):
        out.append({"k": "buy_refill", "label": "Racheter (recharge 1 kg)", "value": "boutique Bambu", "url": e["refill"], "src": "boutique"})
    return out


def from_view(v: dict | None) -> list:
    """Une entree « autres marques » (ofd, own, fc) : ses donnees techniques (v["tech"])."""
    if not v:
        return []
    src, t = v.get("source") or "ofd", v.get("tech") or {}
    out = []
    def add(k, label, value, url=None, s=None):
        if value not in (None, "", []):
            out.append({"k": k, "label": label, "value": value, "src": s or src, **({"url": url} if url else {})})
    add("nozzle", "Buse", _range(t.get("nozzle_min"), t.get("nozzle_max")))
    add("bed", "Plateau", _range(t.get("bed_min"), t.get("bed_max")))
    d = _num(t.get("density"))
    add("density", "Densité", f"{fr(d)} g/cm³" if d else None)
    tol = _num(t.get("dtol"))
    add("dtol", "Tolérance du diamètre", f"± {fr(tol)} mm" if tol else None)
    if v.get("spool_weight_g"):
        add("spool", "Support vide", f"{round(v['spool_weight_g'])} g" + ("" if v.get("spool_src") == "catalogue" else " (estimé, SpoolmanDB)"))
    core = _num(t.get("core"))
    add("core", "Mandrin", f"Ø {fr(core)} mm" if core else None)
    if t.get("refill"):
        add("refill", "Recharge", "sans bobine")
    add("gtin", "Code-barres", t.get("gtin"))
    add("article", "Référence", t.get("article"))
    add("print_temp", "Impression", t.get("print_temp"))
    for i, l in enumerate((t.get("links") or [])[:4]):
        if "amzn." in (l.get("url") or "") or "amazon." in (l.get("url") or ""):
            continue
        add(f"buy{i}", "Acheter", l.get("store") or "boutique", url=l.get("url"))
    if t.get("brand_site"):
        add("brand", "La marque", t.get("brand_site").split("//")[-1].strip("/").split("/")[0], url=t.get("brand_site"))
    add("origin", "Pays de la marque", t.get("origin"))
    if v.get("discontinued"):
        add("disc", "Fabrication", "arrêtée")
    return out


def from_fc(m: dict | None) -> list:
    """Le meilleur echantillon FilamentColors (fc_catalog.matches) : couleur mesuree, TD, temperatures, teintes proches."""
    if not m:
        return []
    out = [{"k": "measured", "label": "Couleur mesurée", "value": f"#{m['hex']}", "hex": m["hex"], "src": "fc", "url": m.get("url")}]
    if m.get("td") is not None:
        out.append({"k": "td", "label": "Transparence (TD)", "value": str(m["td"]).replace(".", ","), "src": "fc"})
    # les temperatures de son type chez FilamentColors : generiques, elles ne servent qu'a defaut des autres (merge)
    if m.get("hot"):
        out.append({"k": "nozzle", "label": "Buse (type)", "value": f"{m['hot']} °C", "src": "fc"})
    if m.get("bed"):
        out.append({"k": "bed", "label": "Plateau (type)", "value": f"{m['bed']} °C", "src": "fc"})
    if m.get("ral"):
        out.append({"k": "ral", "label": "RAL le plus proche", "value": m["ral"], "src": "fc"})
    if m.get("pantone"):
        out.append({"k": "pantone", "label": "Pantone le plus proche", "value": m["pantone"], "src": "fc"})
    if m.get("link") and "amzn." not in m["link"] and "amazon." not in m["link"]:     # pas de lien affilie
        out.append({"k": "buy_fc", "label": "Acheter", "value": m["link"].split("//")[-1].split("/")[0], "url": m["link"], "src": "fc"})
    return out


def merge(*lists) -> list:
    """Les faits de plusieurs sources : le premier de chaque sorte (k) garde sa place, les liens d'achat s'additionnent."""
    seen, out = set(), []
    for lst in lists:
        for f in lst or []:
            k = f["k"]
            if k.startswith("buy"):
                if f.get("url") in seen:
                    continue
                seen.add(f.get("url"))
            elif k in seen:
                continue
            seen.add(k)
            out.append(f)
    return out



# ── Les champs du filament (05/11/2026) : ce que la synchro peut poser, une source par champ ──
# priorite : notre catalogue, puis Bambu (profil Bambu Studio, boutique), puis l'Open Filament Database, puis
# FilamentColors (ses temperatures sont celles du type : en dernier) ; la transparence (TD) ne vient que de lui
def _i(v):
    n = _num(v)
    return int(round(n)) if n else None


def fields(profile: dict | None, view: dict | None, fc: dict | None, store_code: str | None) -> dict:
    cand: dict = {}

    def put(k, v, src):
        if v not in (None, "", 0) and k not in cand:
            cand[k] = (v, src)

    t = (view or {}).get("tech") or {}
    vsrc = (view or {}).get("source")
    # 1. notre catalogue
    if vsrc == "own":
        put("gtin", t.get("gtin"), "own")
    # 2. Bambu
    if profile:
        p = profile
        put("density", _num(p.get("filament_density")), "bambu")
        put("nozzle_min", _i(p.get("nozzle_temperature_range_low")), "bambu")
        put("nozzle_max", _i(p.get("nozzle_temperature_range_high")), "bambu")
        beds = [x for x in (_i(p.get("textured_plate_temp")), _i(p.get("hot_plate_temp"))) if x]
        if beds:
            put("bed_min", min(beds), "bambu")
            put("bed_max", max(beds), "bambu")
        put("dry_temp", _i(p.get("filament_dev_ams_drying_temperature")), "bambu")
        put("dry_hours", _num(p.get("filament_dev_ams_drying_time")), "bambu")
    # pas de lien d'achat pour un Bambu (05/11/2026) : le lien direct de la boutique (bonne fiche, bonne couleur) est
    # deja calcule a chaque fois depuis son code couleur ; le recopier ferait doublon
    # 3. Open Filament Database
    if vsrc == "ofd":
        put("density", _num(t.get("density")), "ofd")
        put("nozzle_min", _i(t.get("nozzle_min")), "ofd")
        put("nozzle_max", _i(t.get("nozzle_max")), "ofd")
        put("bed_min", _i(t.get("bed_min")), "ofd")
        put("bed_max", _i(t.get("bed_max")), "ofd")
        put("gtin", t.get("gtin"), "ofd")
        link = next((l.get("url") for l in t.get("links") or [] if l.get("url") and "amzn." not in l["url"] and "amazon." not in l["url"]), None)
        put("buy_url", link, "ofd")
    # 4. FilamentColors
    if fc:
        put("td", _num(fc.get("td")), "fc")
        put("nozzle_min", _i(fc.get("hot")), "fc")
        put("bed_min", _i(fc.get("bed")), "fc")
        link = fc.get("link")
        if link and "amzn." not in link and "amazon." not in link and not profile:
            put("buy_url", link, "fc")
    return cand
