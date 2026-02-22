// Helper pour charger un JSON
async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Erreur de chargement: ${url}`);
  return await r.json();
}

(async () => {
  try {
    // Charge les jeux de données
    const [meta, categories, lieux, provs] = await Promise.all([
      loadJSON('data/meta.json'),
      loadJSON('data/categories.json'),
      loadJSON('data/lieux.json'),
      loadJSON('data/provenances.json')
    ]);

    // Carte
    const map = L.map('map');
    map.setView(meta.centre || [48.8566, 2.3522], meta.zoom || 6);

    // Fond OSM
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: meta.source || '© OpenStreetMap'
    }).addTo(map);

    // Index catégories
    const catIndex = {};
    categories.forEach(c => { catIndex[c.id] = c; });

    // Légende
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

    // Couche lieux
    const gLieux = L.featureGroup().addTo(map);
    lieux.forEach(lieu => {
      const cat = catIndex[lieu.categorie] || { couleur: '#2563EB', libelle: lieu.categorie || 'Autre' };
      const icon = L.divIcon({
        className: 'mk',
        html: `<span class="dot" style="background:${cat.couleur}"></span>`,
        iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -8]
      });
      const m = L.marker([lieu.latitude, lieu.longitude], { icon }).addTo(gLieux);
      const nom = lieu.nom || 'Sans nom';
      const desc = lieu.description || '';
      const catLib = cat.libelle;
      const extra = (lieu.lien ? `<div style="margin-top:6px"><a href="${lieu.lien}" target="_blank" rel="noopener">Ouvrir le lien</a></div>` : '');
      m.bindPopup(`<strong>${nom}</strong><div>${desc}</div><div style="margin-top:6px"><em>${catLib}</em></div>${extra}`);
    });

    // Couches provenances : participants (on) / non participants (off)
    const gProvOn  = L.featureGroup().addTo(map);
    const gProvOff = L.featureGroup().addTo(map);

    provs.forEach(p => {
      const cls = p.actif ? 'on' : 'off';
      const grp = p.actif ? gProvOn : gProvOff;
      const icon = L.divIcon({
        className: `mk-prov ${cls}`,
        html: `<span class="dot"></span>`,
        iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -8]
      });
      const m = L.marker([p.lat, p.lon], { icon }).addTo(grp);
      m.bindPopup(`<strong>${p.id} – ${p.nom}</strong><div>${p.adresse || ''}</div><div style="margin-top:6px"><em>${p.actif ? 'Participant' : 'Non participant'}</em></div>`);
    });

    // Ajuste la vue si nécessaire
    const all = L.featureGroup([gLieux, gProvOn, gProvOff]).addTo(map);
    if (all.getLayers().length > 0) {
      map.fitBounds(all.getBounds().pad(0.2));
    }

    // Titre
    if (meta.titre) {
      const titleCtl = L.control({ position: 'topleft' });
      titleCtl.onAdd = function () {
        const d = L.DomUtil.create('div', 'titlebar');
        d.innerHTML = `<div class="title">${meta.titre}</div>`;
        return d;
      };
      titleCtl.addTo(map);
    }

    // Filtres
    const cbOn  = document.getElementById('f_prov_on');
    const cbOff = document.getElementById('f_prov_off');

    function applyFilters() {
      if (cbOn.checked) { map.addLayer(gProvOn); } else { map.removeLayer(gProvOn); }
      if (cbOff.checked) { map.addLayer(gProvOff); } else { map.removeLayer(gProvOff); }
    }
    cbOn.addEventListener('change', applyFilters);
    cbOff.addEventListener('change', applyFilters);
    applyFilters(); // init

  } catch (e) {
    console.error(e);
    const root = document.getElementById('map');
    root.innerHTML = `<div style="padding:12px;font-family:system-ui,Segoe UI,Roboto,Arial">Erreur de chargement des données.<br><small>${e.message}</small></div>`;
  }
})();
