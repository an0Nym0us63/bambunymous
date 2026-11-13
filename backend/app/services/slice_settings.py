"""
La carte d'identite du reglage d'une impression (13/11/2026) : tout ce que Bambu Studio a regle dans son 3MF, en clair,
range par famille (qualite, parois, remplissage, vitesses, supports, multi-filaments...), avec les buses (une, deux, ou
le rateau de buses d'une H2C), chaque filament utilise et ses reglages propres (temperatures, debit, refroidissement,
retraction, sechage), les objets du plateau, et la liste complete de tous les reglages (cherchable), chacun marque
« modifie » quand il differe du profil systeme.

D'ou viennent les valeurs (3MF de Bambu Studio 1.x et 2.x, toutes imprimantes) :
- Metadata/project_settings.config : le profil, en JSON. Une valeur peut etre une liste :
  * une case par variante d'extrudeuse (print_extruder_variant / printer_extruder_variant : « Direct Drive Standard »,
    « Direct Drive High Flow »...), rangees extrudeuse par extrudeuse (extruder_variant_list dit combien chacune en a) ;
    on garde celle du type de buse monte (extruder_type + nozzle_volume_type) ;
  * une case par filament et par variante (filament_self_index dit a quel filament appartient chaque case) ;
  * une case par filament (filament_type, filament_colour...) ; une par extrudeuse (nozzle_diameter...).
  Une imprimante a une buse (X1, P1, A1...) a des listes d'une case : une seule colonne.
  different_settings_to_system : les cles changees par rapport au profil systeme, [process, filament 1..N, imprimante].
- Metadata/slice_info.config : le plateau tranche (duree, poids, objets, filaments utilises et leur buse :
  filament_maps, 1 = gauche, 2 = droite comme dans Bambu Studio).
- Metadata/plate_N.json : l'emprise des objets sur le plateau.
- Metadata/plate_N.gcode : le nombre de couches et de changements de filament (« ; CP TOOLCHANGE START »).
- Metadata/model_settings.config : les reglages propres a un objet (3MF d'origine).
"""
from __future__ import annotations

import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

_CACHE: dict = {}

# ── Les valeurs a traduire ─────────────────────────────────────────────────────────────────────────────────────────
PATTERNS = {
    "gyroid": "Gyroïde", "grid": "Grille", "honeycomb": "Nid d'abeille", "3dhoneycomb": "Nid d'abeille 3D", "cubic": "Cubique",
    "adaptivecube": "Cubique adaptatif", "supportcubic": "Cubique de support", "quartercubic": "Quart cubique", "line": "Lignes",
    "zig-zag": "Zigzag", "crosshatch": "Croisillons", "crosszag": "Zigzag croisé", "lockedzag": "Zigzag verrouillé",
    "lightning": "Éclair", "rectilinear": "Rectiligne", "alignedrectilinear": "Rectiligne aligné", "triangles": "Triangles",
    "tri-hexagon": "Tri-hexagone", "concentric": "Concentrique", "hilbertcurve": "Courbe de Hilbert",
    "archimedeanchords": "Cordes d'Archimède", "octagramspiral": "Spirale octogramme", "monotonic": "Monotone",
    "monotonicline": "Ligne monotone", "2dlattice": "Treillis 2D", "2dhoneycomb": "Nid d'abeille 2D", "default": "Par défaut",
    "auto": "Auto", "zigzag": "Zigzag", "rectilinear-grid": "Grille rectiligne", "hollow": "Creux", "lattice": "Treillis"}
ENUMS = {
    "seam_position": {"aligned": "Alignée", "nearest": "La plus proche", "back": "Arrière", "random": "Aléatoire"},
    "support_type": {"normal(auto)": "Normal (auto)", "tree(auto)": "Arborescent (auto)", "normal(manual)": "Normal (manuel)",
                     "tree(manual)": "Arborescent (manuel)"},
    "support_style": {"default": "Par défaut", "grid": "Grille", "snug": "Ajusté", "tree_slim": "Arbre fin", "tree_strong": "Arbre solide",
                      "tree_hybrid": "Arbre hybride", "organic": "Organique", "tree_organic": "Organique"},
    "brim_type": {"auto_brim": "Auto", "no_brim": "Aucune", "outer_only": "Extérieure", "inner_only": "Intérieure",
                  "outer_and_inner": "Intérieure et extérieure", "brim_ears": "Oreilles", "painted": "Peinte"},
    "ironing_type": {"no ironing": "Non", "top": "Surfaces du dessus", "topmost": "Dernière surface du dessus", "solid": "Toutes les surfaces pleines"},
    "wall_generator": {"classic": "Classique", "arachne": "Arachne"},
    "wall_sequence": {"inner wall/outer wall": "Intérieure puis extérieure", "outer wall/inner wall": "Extérieure puis intérieure",
                      "inner-outer-inner wall": "Intérieure, extérieure, intérieure"},
    "print_sequence": {"by layer": "Couche par couche", "by object": "Objet par objet"},
    "fuzzy_skin": {"none": "Non", "external": "Parois extérieures", "all": "Toutes les parois", "allwalls": "Toutes les parois"},
    "fuzzy_skin_mode": {"displacement": "Déplacement", "extrusion": "Extrusion", "combined": "Combiné"},
    "fuzzy_skin_noise_type": {"classic": "Classique", "perlin": "Perlin", "billow": "Billow", "ridgedmulti": "Crêtes", "voronoi": "Voronoï"},
    "top_one_wall_type": {"none": "Non", "all top": "Toutes les surfaces du dessus", "topmost": "Dernière surface du dessus"},
    "z_hop_types": {"Auto Lift": "Auto", "Normal Lift": "Normal", "Slope Lift": "En pente", "Spiral Lift": "En spirale"},
    "filament_z_hop_types": {"Auto Lift": "Auto", "Normal Lift": "Normal", "Slope Lift": "En pente", "Spiral Lift": "En spirale"},
    "timelapse_type": {"0": "Non", "1": "Fluide (tête rangée)", "2": "Traditionnel"},
    "seam_slope_type": {"none": "Non", "external": "Paroi extérieure", "all": "Toutes les parois"},
    "slicing_mode": {"regular": "Normal", "even_odd": "Pair-impair", "close_holes": "Boucher les trous"},
    "reduce_infill_retraction_mode": {"Auto": "Auto", "Off": "Non", "On": "Oui"},
    "filament_map_mode": {"Auto For Flush": "Auto (moins de purge)", "Auto For Match": "Auto (couleurs de l'AMS)", "Manual": "Manuelle",
                          "Nozzle Manual": "Manuelle par buse"},
    "prime_volume_mode": {"Default": "Par défaut", "Saving": "Économe"},
    "bed_temperature_formula": {"by_highest_temp": "La plus haute des filaments", "by_first_filament": "Celle du premier filament"},
    "counterbore_hole_bridging": {"none": "Non", "partiallybridge": "Pont partiel", "sacrificiallayer": "Couche sacrificielle"},
    "ironing_direction": {}, "cooling_slowdown_logic": {"uniform_cooling": "Uniforme", "consistent_surface": "Surface constante"},
    "gcode_flavor": {"marlin": "Marlin", "marlin2": "Marlin 2", "klipper": "Klipper", "reprapfirmware": "RepRapFirmware"},
    "nozzle_volume_type": {"Standard": "Standard", "High Flow": "Haut débit", "Hybrid": "Hybride", "TPU High Flow": "Haut débit TPU"},
    "nozzle_type": {"hardened_steel": "Acier trempé", "stainless_steel": "Inox", "brass": "Laiton", "tungsten_carbide": "Carbure de tungstène",
                    "undefine": "Non précisé"},
    "ensure_vertical_shell_thickness": {"enabled": "Oui", "disabled": "Non", "ensure_all": "Partout", "ensure_critical_only": "Zones critiques",
                                        "ensure_moderate": "Modérée", "none": "Non"},
    "draft_shield": {"disabled": "Non", "enabled": "Oui", "limited": "Limité"},
    "aux_fan_standard_side": {"left": "Gauche", "right": "Droite"},
    "printer_structure": {"corexy": "CoreXY", "i3": "Cartésienne (i3)", "hbot": "H-bot", "delta": "Delta"},
    "wall_filament": {}, "support_filament": {}, "support_interface_filament": {},
}
for _k in ("sparse_infill_pattern", "top_surface_pattern", "bottom_surface_pattern", "internal_solid_infill_pattern", "ironing_pattern",
           "support_base_pattern", "support_interface_pattern", "sub_top_surface_pattern", "support_ironing_pattern",
           "locked_skin_infill_pattern", "locked_skeleton_infill_pattern"):
    ENUMS[_k] = PATTERNS

# ── Les familles et leurs libelles (dans l'ordre d'affichage) ──────────────────────────────────────────────────────
FAMILIES = [
    ("qualite", "🎚", "Qualité", [
        ("layer_height", "Épaisseur de couche"), ("initial_layer_print_height", "Épaisseur de la première couche"),
        ("min_layer_height", "Couche la plus fine (adaptative)"), ("max_layer_height", "Couche la plus épaisse (adaptative)"),
        ("line_width", "Largeur de ligne"), ("initial_layer_line_width", "Largeur, première couche"),
        ("outer_wall_line_width", "Largeur, paroi extérieure"), ("inner_wall_line_width", "Largeur, parois intérieures"),
        ("top_surface_line_width", "Largeur, surface du dessus"), ("sparse_infill_line_width", "Largeur, remplissage"),
        ("internal_solid_infill_line_width", "Largeur, remplissage plein"), ("initial_layer_infill_line_width", "Largeur, remplissage 1re couche"),
        ("support_line_width", "Largeur, supports"), ("print_flow_ratio", "Débit du réglage"), ("initial_layer_flow_ratio", "Débit, première couche"),
        ("resolution", "Résolution"), ("enable_arc_fitting", "Lissage des arcs (G2/G3)"), ("precise_z_height", "Hauteur Z précise"),
        ("xy_hole_compensation", "Compensation des trous (XY)"), ("xy_contour_compensation", "Compensation des contours (XY)"),
        ("elefant_foot_compensation", "Compensation du pied d'éléphant"), ("enable_circle_compensation", "Compensation des cercles"),
        ("circle_compensation_manual_offset", "Décalage des cercles"), ("slice_closing_radius", "Rayon de fermeture"),
        ("slicing_mode", "Mode de découpe"), ("smooth_coefficient", "Coefficient de lissage")]),
    ("couture", "🪡", "Couture", [
        ("seam_position", "Position de la couture"), ("seam_placement_away_from_overhangs", "Couture loin des surplombs"),
        ("seam_gap", "Écart de couture"), ("seam_slope_type", "Couture en biseau (scarf)"), ("seam_slope_conditional", "Biseau conditionnel"),
        ("scarf_angle_threshold", "Angle seuil du biseau"), ("seam_slope_start_height", "Hauteur de départ du biseau"),
        ("seam_slope_entire_loop", "Biseau sur toute la boucle"), ("seam_slope_min_length", "Longueur mini du biseau"),
        ("seam_slope_steps", "Étapes du biseau"), ("seam_slope_gap", "Écart du biseau"), ("seam_slope_inner_walls", "Biseau aussi à l'intérieur"),
        ("apply_scarf_seam_on_circles", "Biseau sur les cercles"), ("override_filament_scarf_seam_setting", "Remplace le biseau du filament"),
        ("wipe_speed", "Vitesse d'essuyage"), ("role_base_wipe_speed", "Essuyage à la vitesse de la ligne")]),
    ("parois", "🧱", "Parois", [
        ("wall_loops", "Nombre de parois"), ("alternate_extra_wall", "Paroi en plus une couche sur deux"), ("wall_generator", "Générateur de parois"),
        ("wall_sequence", "Ordre des parois"), ("is_infill_first", "Remplissage avant les parois"), ("print_in_clockwise", "Sens horaire"),
        ("precise_outer_wall", "Paroi extérieure précise"), ("detect_thin_wall", "Détecter les parois fines"),
        ("detect_overhang_wall", "Détecter les parois en surplomb"), ("only_one_wall_first_layer", "Une seule paroi en première couche"),
        ("top_one_wall_type", "Une seule paroi en haut"), ("embedding_wall_into_infill", "Parois noyées dans le remplissage"),
        ("wall_transition_angle", "Angle de transition (Arachne)"), ("wall_transition_length", "Longueur de transition (Arachne)"),
        ("wall_transition_filter_deviation", "Déviation du filtre (Arachne)"), ("wall_distribution_count", "Répartition des parois (Arachne)"),
        ("min_bead_width", "Largeur mini de ligne (Arachne)"), ("min_feature_size", "Détail mini (Arachne)"),
        ("z_direction_outwall_speed_continuous", "Vitesse continue sur la paroi extérieure")]),
    ("coques", "🔝", "Dessus et dessous", [
        ("top_shell_layers", "Couches du dessus"), ("top_shell_thickness", "Épaisseur mini du dessus"), ("top_surface_pattern", "Motif du dessus"),
        ("top_surface_density", "Densité du dessus"), ("sub_top_surface_pattern", "Motif sous le dessus"), ("top_area_threshold", "Seuil de surface du dessus"),
        ("top_solid_infill_flow_ratio", "Débit du dessus"), ("bottom_shell_layers", "Couches du dessous"),
        ("bottom_shell_thickness", "Épaisseur mini du dessous"), ("bottom_surface_pattern", "Motif du dessous"),
        ("bottom_surface_density", "Densité du dessous"), ("internal_solid_infill_pattern", "Motif du remplissage plein"),
        ("ensure_vertical_shell_thickness", "Épaisseur verticale garantie"), ("detect_floating_vertical_shell", "Coques verticales flottantes"),
        ("detect_narrow_internal_solid_infill", "Remplissage plein étroit"), ("infill_instead_top_bottom_surfaces", "Remplissage à la place du dessus/dessous"),
        ("top_color_penetration_layers", "Couches de couleur du dessus"), ("bottom_color_penetration_layers", "Couches de couleur du dessous"),
        ("interface_shells", "Coques d'interface")]),
    ("lissage", "✨", "Lissage", [
        ("ironing_type", "Lissage"), ("ironing_pattern", "Motif du lissage"), ("ironing_direction", "Angle du lissage"), ("ironing_flow", "Débit du lissage"),
        ("ironing_spacing", "Espacement du lissage"), ("ironing_inset", "Retrait du lissage"), ("ironing_speed", "Vitesse du lissage"),
        ("ironing_fan_speed", "Ventilation du lissage")]),
    ("remplissage", "🧩", "Remplissage", [
        ("sparse_infill_density", "Densité"), ("sparse_infill_pattern", "Motif"), ("infill_direction", "Angle du remplissage"),
        ("infill_rotate_step", "Rotation à chaque couche"), ("infill_shift_step", "Décalage à chaque couche"), ("symmetric_infill_y_axis", "Symétrique sur Y"),
        ("sparse_infill_anchor", "Ancrage"), ("sparse_infill_anchor_max", "Ancrage maximal"), ("infill_combination", "Combiner le remplissage"),
        ("infill_wall_overlap", "Chevauchement avec les parois"), ("minimum_sparse_infill_area", "Surface mini de remplissage"),
        ("sparse_infill_lattice_angle_1", "Angle 1 du treillis"), ("sparse_infill_lattice_angle_2", "Angle 2 du treillis"),
        ("skin_infill_density", "Densité de la peau"), ("skin_infill_depth", "Profondeur de la peau"), ("skeleton_infill_density", "Densité du squelette"),
        ("locked_skin_infill_pattern", "Motif de la peau"), ("locked_skeleton_infill_pattern", "Motif du squelette"), ("infill_lock_depth", "Profondeur verrouillée"),
        ("internal_bridge_support_thickness", "Épaisseur des ponts internes"), ("filter_out_gap_fill", "Ignorer les petits trous"),
        ("fill_multiline", "Lignes multiples"), ("conformal_infill", "Remplissage conforme"), ("modifier_ignore_infill", "Modificateurs sans remplissage")]),
    ("ponts", "🌉", "Ponts et surplombs", [
        ("bridge_flow", "Débit des ponts"), ("bridge_angle", "Angle des ponts"), ("thick_bridges", "Ponts épais"), ("max_bridge_length", "Pont le plus long sans support"),
        ("bridge_no_support", "Pas de support sous les ponts"), ("counterbore_hole_bridging", "Trous lamés"), ("bridge_speed", "Vitesse des ponts"),
        ("enable_overhang_speed", "Ralentir dans les surplombs"), ("overhang_1_4_speed", "Surplomb 10-25 %"), ("overhang_2_4_speed", "Surplomb 25-50 %"),
        ("overhang_3_4_speed", "Surplomb 50-75 %"), ("overhang_4_4_speed", "Surplomb 75-100 %"), ("overhang_totally_speed", "Surplomb total")]),
    ("vitesses", "🏎", "Vitesses", [
        ("initial_layer_speed", "Première couche"), ("initial_layer_infill_speed", "Remplissage, première couche"), ("outer_wall_speed", "Paroi extérieure"),
        ("inner_wall_speed", "Parois intérieures"), ("small_perimeter_speed", "Petits périmètres"), ("small_perimeter_threshold", "Seuil des petits périmètres"),
        ("sparse_infill_speed", "Remplissage"), ("internal_solid_infill_speed", "Remplissage plein"), ("vertical_shell_speed", "Coques verticales"),
        ("top_surface_speed", "Surface du dessus"), ("gap_infill_speed", "Comblement des trous"), ("support_speed", "Supports"),
        ("support_interface_speed", "Interface des supports"), ("travel_speed", "Déplacements"), ("travel_speed_z", "Déplacements en Z"),
        ("smooth_speed_discontinuity_area", "Lisser les changements de vitesse"), ("enable_height_slowdown", "Ralentir en hauteur"),
        ("slowdown_start_height", "Ralentir à partir de"), ("slowdown_end_height", "Ralentir jusqu'à"), ("slowdown_start_speed", "Vitesse au début du ralenti"),
        ("slowdown_end_speed", "Vitesse à la fin du ralenti")]),
    ("accel", "📈", "Accélérations et à-coups", [
        ("default_acceleration", "Accélération normale"), ("outer_wall_acceleration", "Paroi extérieure"), ("inner_wall_acceleration", "Parois intérieures"),
        ("top_surface_acceleration", "Surface du dessus"), ("sparse_infill_acceleration", "Remplissage"), ("initial_layer_acceleration", "Première couche"),
        ("initial_layer_travel_acceleration", "Déplacements, première couche"), ("travel_acceleration", "Déplacements"),
        ("travel_short_distance_acceleration", "Déplacements courts"), ("prime_tower_acceleration", "Tour de purge"),
        ("accel_to_decel_enable", "Limiter la décélération"), ("accel_to_decel_factor", "Facteur de décélération"),
        ("default_jerk", "À-coup normal"), ("outer_wall_jerk", "À-coup, paroi extérieure"), ("inner_wall_jerk", "À-coup, parois intérieures"),
        ("top_surface_jerk", "À-coup, dessus"), ("infill_jerk", "À-coup, remplissage"), ("initial_layer_jerk", "À-coup, première couche"),
        ("travel_jerk", "À-coup, déplacements")]),
    ("supports", "🌳", "Supports", [
        ("enable_support", "Supports"), ("support_type", "Type"), ("support_style", "Style"), ("support_threshold_angle", "Angle seuil"),
        ("support_on_build_plate_only", "Sur le plateau seulement"), ("support_critical_regions_only", "Zones critiques seulement"),
        ("support_remove_small_overhang", "Ignorer les petits surplombs"), ("enforce_support_layers", "Couches forcées"),
        ("support_top_z_distance", "Écart au-dessus (Z)"), ("support_bottom_z_distance", "Écart en dessous (Z)"),
        ("support_object_xy_distance", "Écart à l'objet (XY)"), ("support_object_first_layer_gap", "Écart en première couche"),
        ("top_z_overrides_xy_distance", "Z prioritaire sur XY"), ("support_base_pattern", "Motif de la base"), ("support_base_pattern_spacing", "Espacement de la base"),
        ("support_angle", "Angle du motif"), ("support_expansion", "Élargissement"), ("support_interface_top_layers", "Couches d'interface du haut"),
        ("support_interface_bottom_layers", "Couches d'interface du bas"), ("support_interface_pattern", "Motif d'interface"),
        ("support_interface_spacing", "Espacement de l'interface du haut"), ("support_bottom_interface_spacing", "Espacement de l'interface du bas"),
        ("support_interface_loop_pattern", "Interface en boucles"), ("support_interface_not_for_body", "Matière d'interface pas pour le corps"),
        ("independent_support_layer_height", "Hauteur de couche indépendante"), ("tree_support_branch_angle", "Arbre : angle des branches"),
        ("tree_support_branch_distance", "Arbre : écart des branches"), ("tree_support_branch_diameter", "Arbre : diamètre des branches"),
        ("tree_support_branch_diameter_angle", "Arbre : angle du diamètre"), ("tree_support_tip_diameter", "Arbre : diamètre de la pointe"),
        ("tree_support_wall_count", "Arbre : parois"), ("enable_support_ironing", "Lisser l'interface"), ("support_ironing_pattern", "Motif du lissage d'interface"),
        ("support_ironing_flow", "Débit du lissage d'interface"), ("support_ironing_spacing", "Espacement du lissage d'interface"),
        ("support_object_skip_flush", "Pas de purge dans les supports d'objet"), ("support_fast_purge_mode", "Purge rapide des supports")]),
    ("radeau", "🛟", "Radeau", [
        ("raft_layers", "Couches du radeau"), ("raft_contact_distance", "Écart au radeau"), ("raft_expansion", "Élargissement"),
        ("raft_first_layer_density", "Densité de la première couche"), ("raft_first_layer_expansion", "Élargissement de la première couche")]),
    ("adherence", "🧲", "Adhérence au plateau", [
        ("brim_type", "Bordure"), ("brim_width", "Largeur de la bordure"), ("brim_object_gap", "Écart bordure / objet"),
        ("skirt_loops", "Jupe : tours"), ("skirt_height", "Jupe : couches"), ("skirt_distance", "Jupe : écart"), ("skirt_per_object", "Une jupe par objet"),
        ("draft_shield", "Paravent"), ("bed_temperature_formula", "Température du plateau")]),
    ("multi", "🔄", "Multi-filaments et purge", [
        ("filament_map_mode", "Répartition des filaments sur les buses"), ("enable_filament_dynamic_map", "Répartition dynamique"),
        ("enable_prime_tower", "Tour de purge"), ("prime_tower_width", "Largeur de la tour"), ("prime_tower_brim_width", "Bordure de la tour"),
        ("prime_tower_infill_gap", "Espacement du remplissage de la tour"), ("prime_tower_rib_wall", "Tour à nervures"), ("prime_tower_rib_width", "Largeur des nervures"),
        ("prime_tower_extra_rib_length", "Nervures : longueur en plus"), ("prime_tower_fillet_wall", "Paroi arrondie"), ("prime_tower_max_speed", "Vitesse maxi de la tour"),
        ("prime_tower_line_width", "Largeur de ligne de la tour"), ("prime_tower_enable_framework", "Ossature de la tour"),
        ("wipe_tower_rotation_angle", "Rotation de la tour"), ("wipe_tower_no_sparse_layers", "Pas de couches creuses dans la tour"),
        ("prime_volume_mode", "Volume de purge"), ("flush_multiplier", "Multiplicateur de purge"), ("flush_into_infill", "Purger dans le remplissage"),
        ("flush_into_objects", "Purger dans les objets"), ("flush_into_support", "Purger dans les supports"),
        ("single_extruder_multi_material", "Une buse, plusieurs filaments"), ("ooze_prevention", "Anti-suintement"),
        ("standby_temperature_delta", "Écart de température en attente"), ("enable_pre_heating", "Préchauffer la buse suivante"),
        ("wall_filament", "Filament des parois"), ("sparse_infill_filament", "Filament du remplissage"), ("solid_infill_filament", "Filament du remplissage plein"),
        ("support_filament", "Filament des supports"), ("support_interface_filament", "Filament de l'interface"),
        ("interlocking_beam", "Imbrication des matières"), ("interlocking_beam_width", "Largeur de l'imbrication"),
        ("interlocking_orientation", "Orientation de l'imbrication"), ("interlocking_beam_layer_count", "Couches de l'imbrication"),
        ("interlocking_depth", "Profondeur de l'imbrication"), ("interlocking_boundary_avoidance", "Évitement des bords"),
        ("mmu_segmented_region_max_width", "Largeur maxi d'une zone colorée"), ("mmu_segmented_region_interlocking_depth", "Profondeur d'imbrication des couleurs"),
        ("enable_mixed_color_sublayer", "Sous-couches de couleurs mélangées")]),
    ("deplacements", "↪️", "Déplacements", [
        ("reduce_crossing_wall", "Éviter de traverser les parois"), ("max_travel_detour_distance", "Détour maximal"),
        ("avoid_crossing_wall_includes_support", "Éviter aussi les supports"), ("reduce_infill_retraction_mode", "Moins de rétractions dans le remplissage"),
        ("monotonic_travel_into_wall", "Entrée monotone dans les parois")]),
    ("special", "🪄", "Modes spéciaux", [
        ("print_sequence", "Ordre d'impression"), ("spiral_mode", "Mode vase"), ("spiral_mode_smooth", "Vase lissé"),
        ("spiral_mode_max_xy_smoothing", "Lissage XY maxi du vase"), ("fuzzy_skin", "Surface floue"), ("fuzzy_skin_mode", "Surface floue : mode"),
        ("fuzzy_skin_noise_type", "Surface floue : bruit"), ("fuzzy_skin_thickness", "Surface floue : épaisseur"),
        ("fuzzy_skin_point_distance", "Surface floue : écart des points"), ("fuzzy_skin_first_layer", "Surface floue en première couche"),
        ("timelapse_type", "Timelapse"), ("farthest_point_timelapse", "Timelapse au point le plus loin"), ("exclude_object", "Objets annulables"),
        ("enable_wrapping_detection", "Détection d'enroulement"), ("periodic_modifier", "Modificateur périodique")]),
    ("imprimante", "🖨", "Imprimante", [
        ("printer_model", "Modèle"), ("printer_settings_id", "Profil d'imprimante"), ("printer_variant", "Variante"),
        ("printer_structure", "Cinématique"), ("printable_height", "Hauteur imprimable"), ("nozzle_height", "Hauteur de la buse"),
        ("extruder_clearance_max_radius", "Rayon de la tête"), ("extruder_clearance_height_to_rod", "Hauteur sous la tige"),
        ("extruder_clearance_height_to_lid", "Hauteur sous le capot"), ("auxiliary_fan", "Ventilateur auxiliaire"),
        ("support_chamber_temp_control", "Chauffe de la chambre"), ("support_air_filtration", "Filtration de l'air"),
        ("scan_first_layer", "Inspection de la première couche"), ("silent_mode", "Mode silencieux"), ("gcode_flavor", "G-code"),
        ("use_firmware_retraction", "Rétraction par le firmware"), ("master_extruder_id", "Extrudeuse principale"),
        ("machine_hotend_change_time", "Temps d'un changement de buse"), ("machine_switch_extruder_time", "Temps d'un changement d'extrudeuse"),
        ("machine_load_filament_time", "Temps de chargement"), ("machine_unload_filament_time", "Temps de déchargement"),
        ("machine_max_speed_x", "Vitesse maxi X"), ("machine_max_speed_y", "Vitesse maxi Y"), ("machine_max_speed_z", "Vitesse maxi Z"),
        ("machine_max_acceleration_x", "Accélération maxi X"), ("machine_max_acceleration_y", "Accélération maxi Y"),
        ("machine_max_acceleration_extruding", "Accélération maxi en extrusion"), ("machine_max_acceleration_travel", "Accélération maxi en déplacement"),
        ("machine_max_jerk_x", "À-coup maxi X"), ("machine_max_jerk_y", "À-coup maxi Y")]),
]
# les reglages d'une buse (une colonne par buse)
NOZZLE_KEYS = [
    ("nozzle_diameter", "Diamètre"), ("nozzle_volume_type", "Débit de la buse"), ("nozzle_type", "Matière de la buse"), ("extruder_type", "Extrudeuse"),
    ("retraction_length", "Rétraction"), ("retraction_speed", "Vitesse de rétraction"), ("deretraction_speed", "Vitesse de dé-rétraction"),
    ("retract_restart_extra", "Extra au redémarrage"), ("retraction_minimum_travel", "Déplacement mini avant rétraction"),
    ("retract_when_changing_layer", "Rétracter au changement de couche"), ("retract_before_wipe", "Rétraction avant essuyage"),
    ("wipe", "Essuyage"), ("wipe_distance", "Distance d'essuyage"), ("z_hop", "Saut en Z"), ("z_hop_types", "Type de saut en Z"),
    ("retract_lift_above", "Saut au-dessus de"), ("retract_lift_below", "Saut en dessous de"), ("retract_length_toolchange", "Rétraction au changement"),
    ("long_retractions_when_cut", "Longue rétraction à la coupe"), ("retraction_distances_when_cut", "Rétraction à la coupe")]
# les reglages d'un filament, par famille
FIL_FAMILIES = [
    ("Identité", [("filament_type", "Matière"), ("filament_vendor", "Marque"), ("filament_settings_id", "Profil"), ("filament_diameter", "Diamètre"),
                  ("filament_density", "Densité"), ("filament_cost", "Prix"), ("filament_shrink", "Retrait (XY)"), ("filament_soluble", "Soluble"),
                  ("filament_is_support", "Filament de support"), ("required_nozzle_HRC", "Dureté de buse requise"), ("filament_adhesiveness_category", "Adhérence")]),
    ("Températures", [("nozzle_temperature", "Buse"), ("nozzle_temperature_initial_layer", "Buse, première couche"),
                      ("nozzle_temperature_range_low", "Plage conseillée, bas"), ("nozzle_temperature_range_high", "Plage conseillée, haut"),
                      ("cool_plate_temp", "Plateau Cool"), ("cool_plate_temp_initial_layer", "Plateau Cool, 1re couche"),
                      ("textured_cool_plate_temp", "Plateau Cool texturé"), ("eng_plate_temp", "Plateau Engineering"),
                      ("eng_plate_temp_initial_layer", "Plateau Engineering, 1re couche"), ("hot_plate_temp", "Plateau High Temp"),
                      ("hot_plate_temp_initial_layer", "Plateau High Temp, 1re couche"), ("textured_plate_temp", "Plateau PEI texturé"),
                      ("textured_plate_temp_initial_layer", "Plateau PEI texturé, 1re couche"), ("supertack_plate_temp", "Plateau Supertack"),
                      ("supertack_plate_temp_initial_layer", "Plateau Supertack, 1re couche"), ("chamber_temperatures", "Chambre"),
                      ("temperature_vitrification", "Température de ramollissement"), ("filament_preheat_temperature_delta", "Écart de préchauffe")]),
    ("Débit", [("filament_flow_ratio", "Débit"), ("enable_pressure_advance", "Pressure advance"), ("pressure_advance", "Valeur du pressure advance"),
               ("filament_max_volumetric_speed", "Débit volumique maxi"), ("filament_adaptive_volumetric_speed", "Débit volumique adaptatif")]),
    ("Refroidissement", [("fan_min_speed", "Ventilateur mini"), ("fan_max_speed", "Ventilateur maxi"), ("fan_cooling_layer_time", "Ventilateur à fond sous"),
                         ("close_fan_the_first_x_layers", "Pas de ventilation les premières couches"), ("full_fan_speed_layer", "Ventilation complète à la couche"),
                         ("overhang_fan_speed", "Ventilation des surplombs"), ("overhang_fan_threshold", "Seuil de surplomb ventilé"),
                         ("enable_overhang_bridge_fan", "Ventiler surplombs et ponts"), ("additional_cooling_fan_speed", "Ventilateur auxiliaire"),
                         ("slow_down_for_layer_cooling", "Ralentir pour refroidir"), ("slow_down_layer_time", "Temps mini par couche"),
                         ("slow_down_min_speed", "Vitesse mini"), ("reduce_fan_stop_start_freq", "Moins d'arrêts du ventilateur"),
                         ("no_slow_down_for_cooling_on_outwalls", "Pas de ralenti sur la paroi extérieure"),
                         ("during_print_exhaust_fan_speed", "Extraction pendant l'impression"), ("complete_print_exhaust_fan_speed", "Extraction à la fin"),
                         ("activate_air_filtration", "Filtration de l'air"), ("cooling_slowdown_logic", "Logique de ralenti")]),
    ("Rétraction propre au filament", [("filament_retraction_length", "Rétraction"), ("filament_retraction_speed", "Vitesse de rétraction"),
                                       ("filament_deretraction_speed", "Vitesse de dé-rétraction"), ("filament_z_hop", "Saut en Z"),
                                       ("filament_z_hop_types", "Type de saut en Z"), ("filament_retraction_minimum_travel", "Déplacement mini"),
                                       ("filament_retract_when_changing_layer", "Au changement de couche"), ("filament_wipe", "Essuyage"),
                                       ("filament_wipe_distance", "Distance d'essuyage"), ("filament_retract_before_wipe", "Avant essuyage"),
                                       ("filament_retract_restart_extra", "Extra au redémarrage")]),
    ("Changements et purge", [("filament_change_length", "Longueur au changement"), ("filament_minimal_purge_on_wipe_tower", "Purge mini dans la tour"),
                              ("filament_prime_volume", "Volume d'amorçage"), ("filament_flush_temp", "Température de purge"),
                              ("filament_flush_volumetric_speed", "Débit de purge"), ("filament_ramming_volumetric_speed", "Débit de bourrage"),
                              ("filament_cooling_before_tower", "Refroidir avant la tour")]),
    ("Séchage", [("filament_dev_ams_drying_temperature", "Séchage AMS : température"), ("filament_dev_ams_drying_time", "Séchage AMS : durée"),
                 ("filament_dev_chamber_drying_bed_temperature", "Séchage en chambre : plateau"), ("filament_dev_chamber_drying_time", "Séchage en chambre : durée"),
                 ("filament_dev_drying_softening_temperature", "Température de ramollissement au séchage")]),
]
LABELS = {k: l for _f, _i, _t, rows in FAMILIES for k, l in rows}
LABELS.update({k: l for k, l in NOZZLE_KEYS})
LABELS.update({k: l for _t, rows in FIL_FAMILIES for k, l in rows})
FIL_KEYS = {k for _t, rows in FIL_FAMILIES for k, _l in rows}
NOZ_KEYS = {k for k, _l in NOZZLE_KEYS}
# jamais montre (G-code, textes, listes de points, tables) : dans « tout », juste leur taille
BLOB = re.compile(r"(_gcode$|^post_process$|_notes$|^template_custom|^bed_custom|area$|^thumbnail|^flush_volumes|^filament_ids$|"
                  r"^printhost|^host_type|^filename_format|^upward_compatible|^print_compatible|^head_wrap|^extruder_offset|^wipe_tower_[xy]$|"
                  r"^nozzle_flush_dataset|^volumetric_speed_coefficients|^filament_prime_tower_speed_factor_curve|_matrix$|_vector$)")
BOOLS = {"enable_arc_fitting", "precise_z_height", "enable_circle_compensation", "seam_placement_away_from_overhangs", "seam_slope_conditional",
         "seam_slope_entire_loop", "seam_slope_inner_walls", "apply_scarf_seam_on_circles", "override_filament_scarf_seam_setting",
         "role_base_wipe_speed", "alternate_extra_wall", "is_infill_first", "print_in_clockwise", "precise_outer_wall", "detect_thin_wall",
         "detect_overhang_wall", "only_one_wall_first_layer", "embedding_wall_into_infill", "z_direction_outwall_speed_continuous",
         "ensure_vertical_shell_thickness", "detect_floating_vertical_shell", "detect_narrow_internal_solid_infill",
         "infill_instead_top_bottom_surfaces", "interface_shells", "symmetric_infill_y_axis", "infill_combination", "filter_out_gap_fill",
         "fill_multiline", "conformal_infill", "modifier_ignore_infill", "thick_bridges", "bridge_no_support", "enable_overhang_speed",
         "smooth_speed_discontinuity_area", "enable_height_slowdown", "accel_to_decel_enable", "enable_support", "support_on_build_plate_only",
         "support_critical_regions_only", "support_remove_small_overhang", "top_z_overrides_xy_distance", "support_interface_loop_pattern",
         "support_interface_not_for_body", "independent_support_layer_height", "enable_support_ironing", "support_object_skip_flush",
         "support_fast_purge_mode", "skirt_per_object", "draft_shield", "enable_filament_dynamic_map", "enable_prime_tower", "prime_tower_rib_wall",
         "prime_tower_fillet_wall", "prime_tower_enable_framework", "wipe_tower_no_sparse_layers", "flush_into_infill", "flush_into_objects",
         "flush_into_support", "single_extruder_multi_material", "ooze_prevention", "enable_pre_heating", "interlocking_beam",
         "enable_mixed_color_sublayer", "reduce_crossing_wall", "avoid_crossing_wall_includes_support", "monotonic_travel_into_wall",
         "spiral_mode", "spiral_mode_smooth", "fuzzy_skin_first_layer", "farthest_point_timelapse", "exclude_object", "enable_wrapping_detection",
         "periodic_modifier", "auxiliary_fan", "support_chamber_temp_control", "support_air_filtration",
         "scan_first_layer", "silent_mode", "use_firmware_retraction", "retract_when_changing_layer", "wipe", "long_retractions_when_cut",
         "filament_soluble", "filament_is_support", "enable_pressure_advance", "enable_overhang_bridge_fan", "slow_down_for_layer_cooling",
         "reduce_fan_stop_start_freq", "no_slow_down_for_cooling_on_outwalls", "activate_air_filtration", "filament_retract_when_changing_layer",
         "filament_wipe", "filament_cooling_before_tower", "filament_long_retractions_when_cut", "filament_adaptive_volumetric_speed",
         "enable_tower_interface_features", "has_scarf_joint_seam", "filament_printable", "filament_is_mixed", "cooling_filter_enabled",
         "filament_pre_heating_enabled", "filament_idle_travel_cooling_enabled", "enable_order_independent_overlap_carving",
         "aux_fan_independent_control", "sync_auxiliary_fan_to_second_fan", "handle_hotend_as_extruder", "has_filament_switcher",
         "prime_tower_flat_ironing", "prime_tower_line_ironing", "prime_tower_side_scrape", "gcode_add_line_number", "use_relative_e_distances",
         "support_cooling_filter", "printing_by_object_gcode", "start_end_points", "conformal_link_flip_layers"}
BED_KEYS = {"cool plate": "cool_plate_temp", "engineering plate": "eng_plate_temp", "high temp plate": "hot_plate_temp",
            "textured pei plate": "textured_plate_temp", "supertack plate": "supertack_plate_temp",
            "textured cool plate": "textured_cool_plate_temp", "smooth pei plate": "hot_plate_temp"}


def _norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def _num(v):
    try:
        f = float(str(v).replace(",", ".").rstrip("%"))
        return int(f) if f == int(f) else round(f, 3)
    except (TypeError, ValueError):
        return v


def _fr(x) -> str:
    """Un nombre a la francaise (virgule)."""
    if isinstance(x, float):
        return f"{x:g}".replace(".", ",")
    return str(x)


PLAIN = {"skirt_height", "wall_distribution_count", "tree_support_wall_count", "interlocking_beam_layer_count", "interlocking_boundary_avoidance",
         "seam_slope_steps", "full_fan_speed_layer", "additional_fan_full_speed_layer", "optional_fan_full_speed_layer", "master_extruder_id",
         "required_nozzle_HRC", "filament_adhesiveness_category", "enforce_support_layers", "smooth_coefficient", "filament_cooling_before_tower"}
UNITS = {"minimum_sparse_infill_area": " mm²", "interlocking_orientation": "°", "infill_rotate_step": "°"}


def _unit(key: str) -> str:
    k = key.lower()
    if key in PLAIN or k.endswith("_layer") or "layers" in k:
        return ""
    if key in UNITS:
        return UNITS[key]
    if "fan" in k and ("speed" in k or k.endswith("_fan")) and "layer" not in k:
        return " %"
    if k.endswith("_time") or "time_" in k:
        return " h" if "drying" in k else " s"
    if "acceleration" in k:
        return " mm/s²"
    if "jerk" in k:
        return " mm/s"
    if "volumetric" in k:
        return " mm³/s"
    if "speed" in k:
        return " mm/s"
    if "temp" in k or "temperature" in k:
        return " °C"
    if "angle" in k or k in ("infill_direction", "ironing_direction"):
        return "°"
    if k in ("filament_density",):
        return " g/cm³"
    if k in ("filament_cost",):
        return " €/kg"
    if "prime_volume" in k or "purge" in k:
        return " mm³"
    if any(w in k for w in ("height", "width", "distance", "length", "thickness", "gap", "z_hop", "diameter", "depth", "radius",
                            "expansion", "compensation", "offset", "clearance", "spacing", "inset", "lift_", "travel", "resolution",
                            "threshold", "anchor", "overlap", "_size")):
        return " mm"
    return ""


def fmt(key: str, v) -> str | None:
    """Une valeur lisible (traduite, avec son unite)."""
    if v is None or v == "":
        return None
    s = str(v).strip()
    if s == "nil":
        return "comme l'imprimante"
    if key in ENUMS:
        t = ENUMS[key].get(s)
        if t:
            return t
    if key in BOOLS and s in ("0", "1", "true", "false"):
        return "Oui" if s in ("1", "true") else "Non"
    if s in ("enabled", "disabled"):
        return "Oui" if s == "enabled" else "Non"
    if s == "-1" and _unit(key) not in ("°",):
        return "auto"
    if key in ("wall_filament", "sparse_infill_filament", "solid_infill_filament", "support_filament", "support_interface_filament"):
        return "Celui de l'objet" if s == "0" else f"Filament {s}"
    if s.endswith("%"):
        return s.replace(".", ",").replace("%", " %")
    n = _num(s)
    if isinstance(n, (int, float)):
        return f"{_fr(n)}{_unit(key)}"
    return s


class _Cfg:
    """Lit project_settings en tenant compte des listes par variante d'extrudeuse et par filament."""

    def __init__(self, ps: dict):
        self.ps = ps
        self.n_ext = max(1, len(ps.get("nozzle_diameter") or [1]))
        self.n_fil = len(ps.get("filament_type") or ps.get("filament_colour") or [])
        evl = ps.get("extruder_variant_list") or []
        types, vols = ps.get("extruder_type") or [], ps.get("nozzle_volume_type") or []
        self.ext_variant = []
        for k in range(self.n_ext):
            t = types[k] if k < len(types) else (types[0] if types else "DirectDrive")
            v = vols[k] if k < len(vols) else (vols[0] if vols else "Standard")
            self.ext_variant.append(_norm(f"{t}{v}"))
        self.idx = {}                  # longueur d'une liste de variantes -> l'index de chaque extrudeuse
        for key in ("print_extruder_variant", "printer_extruder_variant"):
            lst = ps.get(key) or []
            if not lst:
                continue
            out, off = [], 0
            for k in range(self.n_ext):
                cnt = len(str(evl[k]).split(",")) if k < len(evl) else max(1, len(lst) // self.n_ext)
                block = lst[off:off + cnt]
                pos = next((i for i, x in enumerate(block) if _norm(x) == self.ext_variant[k]), 0)
                out.append(min(off + pos, len(lst) - 1))
                off += cnt
            self.idx.setdefault(len(lst), out)
        self.self_index = [str(x) for x in ps.get("filament_self_index") or []]
        self.fil_variant = [_norm(x) for x in ps.get("filament_extruder_variant") or []]
        diff = ps.get("different_settings_to_system") or []
        sp = lambda s: {x for x in str(s or "").split(";") if x}
        self.diff_proc = sp(diff[0]) if diff else set()
        self.diff_printer = sp(diff[-1]) if len(diff) > 1 else set()
        self.diff_fil = [sp(x) for x in diff[1:-1]] if len(diff) > 2 else []

    def changed(self, key, f: int | None = None) -> bool:
        if f is not None:
            return 0 < f <= len(self.diff_fil) and key in self.diff_fil[f - 1]
        return key in self.diff_proc or key in self.diff_printer

    def get(self, key, default=None):
        v = self.ps.get(key, default)
        return v[0] if isinstance(v, list) and v else v

    def ext_values(self, key) -> list | None:
        """[valeur de chaque extrudeuse] si la cle en a une par extrudeuse, sinon None."""
        v = self.ps.get(key)
        if not isinstance(v, list) or not v:
            return None
        if len(v) in self.idx and (self.n_ext > 1 or len(v) > 1):
            return [v[i] for i in self.idx[len(v)]]
        if len(v) == self.n_ext:
            return list(v)
        return None

    def ext(self, key, k: int):
        vals = self.ext_values(key)
        if vals:
            return vals[min(k, len(vals) - 1)]
        return self.get(key)

    def fil(self, key, f: int, k: int | None = None):
        """Une valeur pour le filament f (1-based), monte sur l'extrudeuse k."""
        v = self.ps.get(key)
        if not isinstance(v, list):
            return v
        if not v:
            return None
        if self.self_index and len(v) == len(self.self_index) and len(v) != self.n_fil:
            want = self.ext_variant[k] if k is not None and k < len(self.ext_variant) else None
            cand = [i for i, s in enumerate(self.self_index) if s == str(f)]
            for i in cand:
                if want is None or (i < len(self.fil_variant) and self.fil_variant[i] == want):
                    return v[i]
            return v[cand[0]] if cand else v[0]
        if len(v) == self.n_fil:
            return v[f - 1] if 0 < f <= len(v) else v[0]
        if k is not None and len(v) in self.idx:
            return v[self.idx[len(v)][min(k, len(self.idx[len(v)]) - 1)]]
        return v[0]


def _plate_info(z: zipfile.ZipFile, plate: int | None):
    """(numero du plateau tranche, ses metadonnees, ses filaments, ses buses, ses objets) d'apres slice_info.config."""
    if "Metadata/slice_info.config" not in z.namelist():
        return plate, {}, [], [], []
    root = ET.fromstring(z.read("Metadata/slice_info.config"))
    pick = None
    for pl in root.findall("plate"):
        meta = {m.get("key"): m.get("value") for m in pl.findall("metadata")}
        if plate is None or str(meta.get("index")) == str(plate):
            if pl.findall("filament") or pick is None:
                pick = (pl, meta)
            if plate is not None:
                break
    if not pick:
        return plate, {}, [], [], []
    pl, meta = pick
    return (int(meta.get("index") or plate or 1), meta, [dict(f.attrib) for f in pl.findall("filament")],
            [dict(n.attrib) for n in pl.findall("nozzle")], [dict(o.attrib) for o in pl.findall("object")])


def _gcode_facts(z: zipfile.ZipFile, plate: int) -> dict:
    name = f"Metadata/plate_{plate}.gcode"
    if name not in z.namelist():
        return {}
    layers, changes, height = None, 0, None
    with z.open(name) as fh:
        for raw in fh:
            if raw.startswith(b";"):
                if raw.startswith(b"; total layer number:") and layers is None:
                    try:
                        layers = int(raw.split(b":")[1].strip())
                    except ValueError:
                        pass
                elif raw.startswith(b"; max_z_height:") and height is None:
                    try:
                        height = float(raw.split(b":")[1].strip())
                    except ValueError:
                        pass
                elif raw.startswith(b"; CP TOOLCHANGE START"):
                    changes += 1
    return {"layers": layers, "changes": changes, "height": height}


def _objects(z: zipfile.ZipFile, plate: int, sliced_objs: list) -> list:
    """Les objets du plateau : nom, emprise (plate_N.json), annule ou non, et leurs reglages propres (model_settings)."""
    out = []
    boxes = {}
    pj = f"Metadata/plate_{plate}.json"
    if pj in z.namelist():
        try:
            for o in json.loads(z.read(pj)).get("bbox_objects") or []:
                b = o.get("bbox") or []
                if len(b) == 4:
                    boxes.setdefault(o.get("name"), []).append((round(b[2] - b[0], 1), round(b[3] - b[1], 1)))
        except (ValueError, TypeError):
            pass
    own = {}
    if "Metadata/model_settings.config" in z.namelist():
        try:
            root = ET.fromstring(z.read("Metadata/model_settings.config"))
            skip = {"name", "extruder", "source_file", "source_object_id", "source_volume_id", "source_offset_x", "source_offset_y",
                    "source_offset_z", "matrix", "mesh_stat", "face_count", "volume_type", "source_in_inches", "id"}
            for ob in root.findall("object"):
                meta = {m.get("key"): m.get("value") for m in ob.findall("metadata")}
                extra = {k: v for k, v in meta.items() if k not in skip and not k.startswith("source_")}
                if extra:
                    own[meta.get("name")] = extra
        except ET.ParseError:
            pass
    seen = {}
    for o in sliced_objs or [{"name": n} for n in boxes]:
        n = o.get("name")
        i = seen.get(n, 0)
        seen[n] = i + 1
        size = (boxes.get(n) or [None] * (i + 1))[min(i, len(boxes.get(n) or [None]) - 1)] if boxes.get(n) else None
        row = {"name": n, "size": f"{_fr(size[0])} × {_fr(size[1])} mm" if size else None, "skipped": o.get("skipped") == "true"}
        if own.get(n):
            row["own"] = [[LABELS.get(k, k), fmt(k, v) or v] for k, v in own[n].items()]
        out.append(row)
    return out


def _fmt_h(sec) -> str | None:
    try:
        s = int(float(sec))
    except (TypeError, ValueError):
        return None
    h, m = s // 3600, s % 3600 // 60
    return f"{h} h {m:02d}" if h else f"{m} min"


def summarize(path: Path, plate: int | None = None) -> dict:
    st = path.stat()
    ck = (str(path), st.st_mtime, plate)
    if ck in _CACHE:
        return _CACHE[ck]
    with zipfile.ZipFile(path) as z:
        if "Metadata/project_settings.config" not in z.namelist():
            raise ValueError("3MF sans réglages de projet")
        ps = json.loads(z.read("Metadata/project_settings.config").decode("utf-8", "replace"))
        plate, meta, fils, nozzles_used, sobjs = _plate_info(z, plate)
        gc = _gcode_facts(z, plate or 1)
        objects = _objects(z, plate or 1, sobjs)
        version = None
        if "Metadata/slice_info.config" in z.namelist():
            m = re.search(rb'X-BBL-Client-Version" value="([^"]+)"', z.read("Metadata/slice_info.config"))
            version = m.group(1).decode() if m else None
    c = _Cfg(ps)
    two = c.n_ext > 1
    sides = ["Gauche", "Droite"] if c.n_ext == 2 else [f"Buse {k + 1}" for k in range(c.n_ext)] if two else ["Buse"]

    # la buse de chaque filament (1 : gauche, 2 : droite), d'apres le plateau sinon le projet
    maps = [x for x in str(meta.get("filament_maps") or "").split() if x.strip()] or [str(x) for x in ps.get("filament_map") or []]
    ext_of = lambda f: max(0, min(c.n_ext - 1, int(maps[f - 1]) - 1)) if 0 < f <= len(maps) and str(maps[f - 1]).isdigit() else 0

    bed = str(c.get("curr_bed_type") or "")
    bkey = BED_KEYS.get(bed.lower(), "hot_plate_temp")
    names = ps.get("filament_settings_id") or []
    used = []
    all_fil = False
    if not fils and c.n_fil:          # pas tranche (3MF d'origine) : tous les filaments du projet
        fils, all_fil = [{"id": str(i + 1)} for i in range(min(c.n_fil, 32))], True
    for f in fils:
        try:
            fid = int(f.get("id"))
        except (TypeError, ValueError):
            continue
        k = ext_of(fid)
        nm = str(names[fid - 1] if 0 < fid <= len(names) else f.get("type") or "")
        fams = []
        for title, rows in FIL_FAMILIES:
            rr = []
            for key, label in rows:
                if key not in ps:
                    continue
                raw = c.fil(key, fid, k)
                val = fmt(key, raw)
                if val is None:
                    continue
                cur = key in (bkey, bkey + "_initial_layer")
                if key.endswith("plate_temp") or key.endswith("plate_temp_initial_layer"):
                    if not cur and str(raw) in ("0", ""):
                        continue
                rr.append({"k": key, "l": label, "v": val, "ch": c.changed(key, fid), "cur": cur})
            if rr:
                fams.append([title, rr])
        rl = c.fil("filament_retraction_length", fid, k)
        used.append({
            "id": fid, "name": nm.split(" @")[0].strip(), "type": f.get("type") or c.fil("filament_type", fid),
            "vendor": c.fil("filament_vendor", fid), "color": f.get("color") or c.fil("filament_colour", fid),
            "g": _num(f.get("used_g")), "m": _num(f.get("used_m")), "side": sides[k], "ext": k,
            "support": f.get("used_for_support") == "true", "object": f.get("used_for_object") != "false",
            "temp": _num(c.fil("nozzle_temperature", fid, k)), "temp_first": _num(c.fil("nozzle_temperature_initial_layer", fid, k)),
            "bed": _num(c.fil(bkey, fid, k)), "bed_first": _num(c.fil(bkey + "_initial_layer", fid, k)),
            "retract": _num(rl) if rl not in (None, "nil", "") else None, "fan": _num(c.fil("fan_max_speed", fid, k)),
            "flow": _num(c.fil("filament_flow_ratio", fid, k)), "max_vol": _num(c.fil("filament_max_volumetric_speed", fid, k)),
            "nchanged": len(c.diff_fil[fid - 1]) if 0 < fid <= len(c.diff_fil) else 0, "families": fams,
        })
    used_ext = sorted({u["ext"] for u in used}) or list(range(c.n_ext))

    # les buses : une colonne chacune
    counts = ps.get("extruder_nozzle_stats_new") or ps.get("extruder_nozzle_stats") or []
    noz = []
    for k in range(c.n_ext):
        stats = str(counts[k]) if k < len(counts) else ""
        rack = sum(int(x.split("#")[1]) for x in stats.split("|") if "#" in x and x.split("#")[1].isdigit()) if stats else 0
        noz.append({"side": sides[k], "used": k in used_ext, "diameter": _num(c.ext("nozzle_diameter", k)),
                    "flow": fmt("nozzle_volume_type", c.ext("nozzle_volume_type", k)), "type": fmt("nozzle_type", c.ext("nozzle_type", k)),
                    "rack": rack if rack > 1 else None})
    nozzle_rows = []
    for key, label in NOZZLE_KEYS:
        if key not in ps:
            continue
        vals = c.ext_values(key) or [c.get(key)] * c.n_ext
        vv = [fmt(key, x) for x in vals[:c.n_ext]]
        if all(x is None for x in vv):
            continue
        nozzle_rows.append({"k": key, "l": label, "vals": vv, "ch": c.changed(key)})

    # les familles du reglage
    families = []
    shown = set(NOZ_KEYS) | FIL_KEYS
    for fid_, icon, title, rows in FAMILIES:
        rr = []
        for key, label in rows:
            if key not in ps:
                continue
            shown.add(key)
            vals = c.ext_values(key) if key not in ("printer_settings_id", "printer_model") else None
            if vals and two:
                vv = [fmt(key, x) for x in vals[:c.n_ext]]
                if all(x is None for x in vv):
                    continue
                if len(set(vv)) == 1:
                    rr.append({"k": key, "l": label, "v": vv[0], "ch": c.changed(key)})
                else:
                    rr.append({"k": key, "l": label, "vals": vv, "ch": c.changed(key)})
            else:
                v = fmt(key, c.ext(key, used_ext[0]) if vals else c.get(key))
                if v is None:
                    continue
                rr.append({"k": key, "l": label, "v": v, "ch": c.changed(key)})
        if fid_ == "multi" and gc.get("changes") is not None:
            rr.insert(0, {"k": "_changes", "l": "Changements de filament", "v": str(gc["changes"]), "ch": False})
        if fid_ == "qualite" and gc.get("layers"):
            rr.insert(2, {"k": "_layers", "l": "Nombre de couches", "v": str(gc["layers"]), "ch": False})
        if rr:
            families.append({"id": fid_, "icon": icon, "title": title, "rows": rr})

    # tout le reste, pour etre complet (cherchable)
    rest = []
    for key in sorted(ps):
        if key in shown or key in ("different_settings_to_system", "name", "from", "version", "inherits"):
            continue
        v = ps[key]
        if BLOB.search(key):
            n = len(v) if isinstance(v, list) else len(str(v))
            val = f"({n} valeur{'s' if n > 1 else ''})" if isinstance(v, list) else (f"(texte, {str(v).count(chr(10)) + 1} lignes)" if str(v).strip() else None)
        elif isinstance(v, list):
            if key in FIL_KEYS or (c.n_fil and len(v) in (c.n_fil, len(c.self_index))):
                val = " · ".join(dict.fromkeys(fmt(key, x) or "—" for x in v))[:300]
            else:
                ev = c.ext_values(key)
                val = " / ".join(fmt(key, x) or "—" for x in ev) if ev and two else (fmt(key, ev[0] if ev else v[0]) or "—")
        else:
            val = fmt(key, v)
        if val is None:
            continue
        rest.append({"k": key, "l": LABELS.get(key), "v": val, "ch": c.changed(key)})

    g = c.get
    sup_on = str(g("enable_support")) in ("1", "true")
    hero = {
        "printer": g("printer_model") or (str(g("printer_settings_id") or "").split(" ")[0] or None),
        "printer_profile": g("printer_settings_id"), "process": g("print_settings_id"), "version": version, "bed": bed or None,
        "layer": _num(g("layer_height")), "first_layer": _num(g("initial_layer_print_height")), "walls": _num(g("wall_loops")),
        "top": _num(g("top_shell_layers")), "bottom": _num(g("bottom_shell_layers")),
        "infill": g("sparse_infill_density"), "pattern": g("sparse_infill_pattern"), "pattern_fr": fmt("sparse_infill_pattern", g("sparse_infill_pattern")),
        "support": (g("support_type") if sup_on else None), "support_fr": fmt("support_type", g("support_type")) if sup_on else None,
        "support_used": meta.get("support_used") == "true", "brim": g("brim_type"), "brim_fr": fmt("brim_type", g("brim_type")),
        "seam": fmt("seam_position", g("seam_position")), "ironing": fmt("ironing_type", g("ironing_type")) if g("ironing_type") not in (None, "no ironing") else None,
        "vase": str(g("spiral_mode")) == "1", "by_object": g("print_sequence") == "by object",
        "fuzzy": fmt("fuzzy_skin", g("fuzzy_skin")) if g("fuzzy_skin") not in (None, "none") else None,
        "prime_tower": str(g("enable_prime_tower")) == "1" and len(used) > 1,
        "time": _fmt_h(meta.get("prediction")), "weight": _num(meta.get("weight")), "layers": gc.get("layers"),
        "height": round(gc["height"], 2) if gc.get("height") else None, "changes": gc.get("changes"),
        "objects": len(objects), "nchanged": len(c.diff_proc), "timelapse": fmt("timelapse_type", g("timelapse_type")),
    }
    out = {"plate": plate, "two": two, "all_fil": all_fil, "sides": sides, "hero": hero, "nozzles": noz, "nozzle_rows": nozzle_rows, "filaments": used,
           "families": families, "objects": objects, "rest": rest, "total": len(ps)}
    _CACHE[ck] = out
    if len(_CACHE) > 64:
        _CACHE.pop(next(iter(_CACHE)))
    return out
