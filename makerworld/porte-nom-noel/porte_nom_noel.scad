// Porte-nom de Noël paramétrique — 2 couleurs sans AMS (changement de couleur à la couche)
// Licence : CC BY-NC-SA 4.0 · Polices : Google Fonts (OFL)

/* [Texte] */
// Le prénom
nom = "Léa";
// Police
police = "Pacifico"; // [Pacifico, Lobster]
// Hauteur des lettres (mm)
taille = 18; // [10:1:40]
// Espacement des lettres (1 = normal)
espacement = 1.0; // [0.8:0.05:1.3]

/* [Motif] */
// Motif à gauche du prénom (sert d'attache)
motif = "etoile"; // [etoile, flocon, sapin, coeur, boule]
// Taille du motif (mm)
taille_motif = 22; // [14:1:40]
// Diamètre du trou pour le ruban (0 = pas de trou)
trou = 3.5; // [0:0.5:6]

/* [Épaisseurs] */
// Épaisseur du socle (mm) — couleur 1
ep_socle = 2.4; // [1.2:0.2:4]
// Relief des lettres (mm) — couleur 2
ep_relief = 1.2; // [0.6:0.2:3]
// Largeur de la bordure autour des lettres (mm)
bordure = 2.6; // [1.5:0.1:5]

/* [Couleurs (aperçu seulement)] */
couleur_socle = "#B3122E";
couleur_relief = "#F5F1E6";

/* [Hidden] */
$fn = 48;
L = taille_motif;

module texte2d()
    text(nom, size = taille, font = police, halign = "left", valign = "baseline", spacing = espacement);

// ---------- motifs 2D, centrés en 0 et tenant dans un carré de taille L ----------
module etoile2d(r) {
    ri = r * 0.48;
    offset(r = r * 0.08) offset(delta = -r * 0.08)
        polygon([for (i = [0:9]) let(a = 90 + i * 36, rr = i % 2 ? ri : r) [rr * cos(a), rr * sin(a)]]);
}
module flocon2d(r) {
    w = r * 0.17;
    for (a = [0:60:300]) rotate(a) {
        hull() { circle(d = w); translate([r - w / 2, 0]) circle(d = w); }
        for (p = [0.42, 0.68]) translate([r * p, 0])
            for (s = [-1, 1]) let(l = r * (1 - p) * 0.62)
                hull() { circle(d = w * 0.85); rotate(s * 55) translate([l, 0]) circle(d = w * 0.85); }
    }
    circle(r * 0.3, $fn = 6);
}
module sapin2d(r) {
    // 3 étages arrondis + tronc + petite étoile
    for (i = [0:2]) let(y = -r * 0.62 + i * r * 0.4, b = r * (0.82 - i * 0.2), h = r * 0.62)
        offset(r = r * 0.07) offset(delta = -r * 0.07) polygon([[-b, y], [b, y], [0, y + h]]);
    translate([-r * 0.14, -r * 0.92]) square([r * 0.28, r * 0.34]);
    translate([0, r * 0.82]) etoile2d(r * 0.22);
}
module coeur2d(r) {
    c = r * 0.42;
    for (sx = [-1, 1]) hull() { translate([sx * r * 0.42, r * 0.28]) circle(c); translate([0, -r * 0.88]) circle(r * 0.06); }
}
module boule2d(r) {
    circle(r * 0.8);
    translate([-r * 0.25, r * 0.7]) square([r * 0.5, r * 0.3]);
}
module motif2d() {
    r = L / 2;
    if (motif == "etoile") etoile2d(r);
    else if (motif == "flocon") flocon2d(r);
    else if (motif == "sapin") sapin2d(r);
    else if (motif == "coeur") coeur2d(r * 0.95);
    else boule2d(r);
}
// position du motif : à gauche, un peu au-dessus de la ligne de base, empiétant sur la 1re lettre
pos_motif = [-L * 0.32, taille * 0.62];
// trou : en haut du motif (dans la boule : dans la bélière)
pos_trou = motif == "boule" ? [0, L / 2 * 0.82] : motif == "sapin" ? [0, L * 0.05] : motif == "coeur" ? [0, L * 0.12] : [0, 0];

module dessus2d() {
    texte2d();
    translate(pos_motif) motif2d();
}
module socle2d() offset(r = -2) offset(r = bordure + 2) dessus2d();
module trou2d() if (trou > 0) translate(pos_motif + pos_trou) circle(d = trou);
// anneau de renfort autour du trou, dans la couleur du relief
module renfort2d() if (trou > 0) translate(pos_motif + pos_trou) circle(d = trou + 3);

// sortie : "tout", "socle" ou "relief" (pour exporter les 2 couleurs séparément)
partie = "tout"; // [tout, socle, relief]

if (partie != "relief")
    color(couleur_socle) linear_extrude(ep_socle) difference() { socle2d(); trou2d(); }
if (partie != "socle")
    color(couleur_relief) translate([0, 0, ep_socle - 0.01]) linear_extrude(ep_relief + 0.01)
        difference() { union() { dessus2d(); renfort2d(); } trou2d(); }
