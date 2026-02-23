# Carte interactive – Modèle réutilisable

Ce dépôt contient un **outil clé en main** pour :
- publier une **carte interactive** (GitHub Pages),
- gérer un **tableau comparatif** des gîtes (Excel au **schéma figé**),
- produire des **fiches PDF** des gîtes retenus.

La carte est publique, accessible via **GitHub Pages**.

---

## 🎯 À quoi sert cet outil ?
- Visualiser des gîtes (week‑end, voyage, événement)
- Partager une carte interactive avec les participants
- **Réutiliser** la même structure pour **plusieurs projets**, en ne changeant que les **données**

---

## 🧠 Principe
- ✅ **Structure, design et règles figés** (`index.html`, `css/`, `js/`) — NE PAS MODIFIER
- ✅ **Seules les données changent** (`data/*.json`) — À mettre à jour

---

## 📁 Arborescence

```
/
├── index.html
├── css/style.css
├── js/carte.js
├── data/
│   ├── lieux.json            ← gîtes (généré depuis l’Excel vXX)
│   ├── categories.json       ← catégories (couleurs)
│   ├── provenances.json      ← domiciles P1..P5 + état (oui/non/incertain)
│   └── meta.json             ← titre, centre carte, zoom
└── tools/
    └── excel_to_json.py      ← générateur Excel (vXX) → data/lieux.json
```

---

## 🔁 Cycle d’un projet (to‑do)

1) **Initialiser**
   - Partir de l’Excel **modèle v52** (schéma v51 figé) et **vider** les lignes de gîtes.
   - Fixer les paramètres via un **questionnaire** : *secteur*, *dates*, *participants* (Oui / Non / Incertain).

2) **Alimenter l’Excel** (3 modes)
   - **Manuel** : saisir gîte par gîte.
   - **Automatique** : coller **le texte de l’annonce** ou **l’URL** → Copilot **extrait** et **remplit** l’Excel.
   - **Hybride** : mix des deux.
   - ⚠️ **Schéma figé** : ne pas renommer/retirer/re‑ordonner les colonnes.

3) **Générer la carte**
   - Si vous avez **Python** (amis/PC perso) :
     ```bash
     # (une seule fois) installer les bibliothèques
     pip install pandas openpyxl

     # (à chaque mise à jour Excel)
     python tools/excel_to_json.py "Comparatif_XXXX_vYY.xlsx" data/lieux.json
     ```
     → Commit & Push → la **carte** se met à jour.
   - Si vous **n’avez pas** Python (PC pro verrouillé) :
     - Envoyez l’Excel à Copilot → il vous rend **`data/lieux.json`** prêt à coller.

4) **Fiches PDF**
   - À partir de l’Excel (**prioritaire**) + compléments (Word/annonces), Copilot génère des **PDF** structurés :
     - Adresse & contact, équipements, tarifs & conditions,
     - Activités/proximité,
     - **Traiteurs/Chef** (contacts),
     - **Itinéraires par foyer** (liens Google Maps cliquables, durée & km),
     - **QR vidéo** (si disponible).

---

## 🧭 Données de la carte
- **`data/lieux.json`** : nom, ville **ou** adresse précise, lien annonce, **site**, **tarif**, **categorie** (*ideal / contraintes / limite / indispo / attente*), **capacite** (texte).
- **`data/provenances.json`** : domiciles **P1..P5** + `etat` = `oui|non|incertain`.
- **`data/meta.json`** : titre, centre/zoom.
- **`data/categories.json`** : catégories et couleurs.

---

## ❗ Dépannage
- Page blanche + URL visibles → `index.html` contient des URL **sans balises**. Restaurer le `index.html` fourni (avec `<link>`/`<script>`).
- “L is not defined” → Leaflet **non chargé** (même cause).
- “Invalid LatLng …” → adresse **non géocodable** (le point est ignoré et signalé en **console**).
