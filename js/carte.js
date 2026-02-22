// Charge un JSON (helper)
async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Erreur de chargement: ${url}`);
  return await r.json();
}

(async () => {
  try {
    // Charge meta + catégories + lieux
    const [meta, categories, lieux] = await Promise.all([
      loadJSON('data/meta.json'),
      loadJSON('data/categories.json'),
      loadJSON('data/lieux.json')
    ]);

    // Création de la carte
    const map = L.map('map');
    map.setView(meta.centre || [48.8566, 2.3522], meta.zoom || 6);

    // Fond OSM
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: meta.source || '© OpenStreetMap'
    }).addTo(map);

    // Index catégories → couleur
    const catIndex = {};
    categories.forEach(c => { catIndex[c.id] = c; });

    // Légende simple
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'legend');
      div.innerHTML = `<strong>Catégories</strong><br>` +
        categories.map(c =>
          `<span class="sw" style="background:${c.couleur}"></span> ${c.libelle}`
        ).join('<br>');
      return div;
    };
    legend.addTo(map);

    // Ajoute les lieux
    const group = L.featureGroup().addTo(map);

    lieux.forEach(lieu => {
      const cat = catIndex[lieu.categorie] || { couleur: '#2563EB', libelle: lieu.categorie || 'Autre' };

      // Marqueur style "pastille colorée"
      const icon = L.divIcon({
        className: 'mk',
        html: `<span class="dot" style="background:${cat.couleur}"></span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -8]
      });

      const m = L.marker([lieu.latitude, lieu.longitude], { icon }).addTo(group);
      const nom = lieu.nom || 'Sans nom';
      const desc = lieu.description || '';
      const catLib = cat.libelle;
      const extra = (lieu.lien ? `<div style="margin-top:6px"><a href="${lieu.lien}" target="_blank" rel="noopener">Ouvrir le lien</a></div>` : '');
      m.bindPopup(`<strong>${nom}</strong><div>${desc}</div><div style="margin-top:6px"><em>${catLib}</em></div>${extra}`);
    });

    // Ajuste la vue si des points existent
    if (group.getLayers().length > 0) {
      map.fitBounds(group.getBounds().pad(0.2));
    }

    // Titre optionnel
    if (meta.titre) {
      const titleCtl = L.control({ position: 'topleft' });
      titleCtl.onAdd = function () {
        const d = L.DomUtil.create('div', 'titlebar');
        d.innerHTML = `<div class="title">${meta.titre}</div>`;
        return d;
      };
      titleCtl.addTo(map);
    }

  } catch (e) {
    console.error(e);
    const root = document.getElementById('map');
    root.innerHTML = `<div style="padding:12px;font-family:system-ui,Segoe UI,Roboto,Arial">Erreur de chargement des données.<br><small>${e.message}</small></div>`;
  }
})();
