// === utilitaires ===
async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Erreur de chargement: ${url}`);
  return await r.json();
}

function el(tag, attrs={}, html='') {
  const d = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => d.setAttribute(k, v));
  if (html) d.innerHTML = html;
  return d;
}

(async () => {
  try {
    // Charge données
    const [meta, categories, lieux, provs] = await Promise.all([
      loadJSON('data/meta.json'),
      loadJSON('data/categories.json'),
      loadJSON('data/lieux.json'),
      loadJSON('data/provenances.json')
    ]);

    // === carte ===
    const map = L.map('map');
    map.setView(meta.centre || [48.8566, 2.3522], meta.zoom || 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: meta.source || '© OpenStreetMap'
    }).addTo(map);

    // === légende catégories (couleurs) ===
    const catIndex = {};
    categories.forEach(c => { catIndex[c.id] = c; });

    const legend = L.control({ position:'bottomleft' });
    legend.onAdd = function() {
      const div = L.DomUtil.create('div', 'legend');
      div.innerHTML = `<strong>Catégories</strong><br>` +
        categories.map(c => `<span class="sw" style="display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;background:${c.couleur};box-shadow:0 0 0 1px rgba(0,0,0,.12) inset;"></span>${c.libelle}`).join('<br>');
      return div;
    };
    legend.addTo(map);

    // === groupes par catégorie (pour filtrage) ===
    const gByCat = {};
    categories.forEach(c => gByCat[c.id] = L.featureGroup().addTo(map));

    // === lieux (gîtes) ===
    lieux.forEach(lieu => {
      const cat = catIndex[lieu.categorie] || { couleur:'#2563EB', libelle: lieu.categorie || 'Autre', id:'autre' };
      if (!gByCat[cat.id]) gByCat[cat.id] = L.featureGroup().addTo(map);

      const icon = L.divIcon({
        className: 'mk',
        html: `<span class="dot" style="background:${cat.couleur}"></span>`,
        iconSize: [16,16], iconAnchor:[8,8], popupAnchor:[0,-8]
      });

      const m = L.marker([lieu.latitude, lieu.longitude], { icon }).addTo(gByCat[cat.id]);
      const nom = lieu.nom || 'Sans nom';
      const desc = lieu.description || '';
      const catLib = cat.libelle || 'Catégorie';
      const extra = (lieu.lien ? `<div style="margin-top:6px"><a href="${lieu.lien}" target="_blank" rel="noopener">Ouvrir le lien</a></div>` : '');
      m.bindPopup(`<strong>${nom}</strong><div>${desc}</div><div style="margin-top:6px"><em>${catLib}</em></div>${extra}`);
    });

    // === provenances ===
    const gProv = {
      'oui': L.featureGroup().addTo(map),
      'non': L.featureGroup().addTo(map),
      'incertain': L.featureGroup().addTo(map)
    };

    const etatToClass = { 'oui':'prov-oui', 'non':'prov-non', 'incertain':'prov-incertain' };
    const etatToLib   = { 'oui':'Participant', 'non':'Non participant', 'incertain':'Incertain' };

    provs.forEach(p => {
      const etat = (p.etat || 'oui').toLowerCase();
      const cls  = etatToClass[etat] || 'prov-oui';
      const grp  = gProv[etat] || gProv['oui'];

      const icon = L.divIcon({
        className: 'mk-provenance',
        html: `<span class="icon-badge ${cls}">${(p.id||'').toUpperCase()}</span>`,
        iconSize: [26,26], iconAnchor:[13,13], popupAnchor:[0,-12]
      });

      const m = L.marker([p.lat, p.lon], { icon }).addTo(grp);
      m.bindPopup(
        `<strong>${p.id ? p.id+' – ' : ''}${p.nom || ''}</strong>` +
        `<div>${p.adresse || ''}</div>` +
        `<div style="margin-top:6px"><em>${etatToLib[etat] || ''}</em></div>`
      );
    });

    // === ajustement de vue ===
    const allLayers = L.featureGroup([...Object.values(gByCat), ...Object.values(gProv)]).addTo(map);
    if (allLayers.getLayers().length) map.fitBounds(allLayers.getBounds().pad(0.2));

    // === titre ===
    if (meta.titre) {
      const titleCtl = L.control({ position:'topleft' });
      titleCtl.onAdd = function() {
        const d = L.DomUtil.create('div','titlebar');
        d.innerHTML = `<div class="title">${meta.titre}</div>`;
        return d;
      };
      titleCtl.addTo(map);
    }

    // === panneau de filtres (catégories + provenances) ===
    const toolbar = document.getElementById('toolbar');

    // bloc catégories
    const blockCat = el('div', {class:'block'});
    blockCat.append(el('span', {class:'ttl'}, 'Catégories : '));
    categories.forEach(c => {
      const id = `flt_cat_${c.id}`;
      const lab = el('label', {}, `<input type="checkbox" id="${id}" data-cat="${c.id}" checked> ${c.libelle}`);
      blockCat.append(lab);
    });

    // bloc provenances
    const blockProv = el('div', {class:'block'});
    blockProv.append(el('span', {class:'ttl'}, 'Provenances : '));
    const provDefs = [
      {k:'oui', txt:'Participants'},
      {k:'incertain', txt:'Incertains'},
      {k:'non', txt:'Non participants'}
    ];
    provDefs.forEach(p => {
      const id = `flt_prov_${p.k}`;
      const lab = el('label', {}, `<input type="checkbox" id="${id}" data-prov="${p.k}" checked> ${p.txt}`);
      blockProv.append(lab);
    });

    // assemble
    toolbar.append(el('div', {class:'block'}, '<strong>Filtres :</strong>'));
    toolbar.append(blockCat);
    toolbar.append(blockProv);

    // comportements
    function applyFilters() {
      // catégories
      categories.forEach(c => {
        const cb = document.querySelector(`input[data-cat="${c.id}"]`);
        if (!cb) return;
        if (cb.checked) { map.addLayer(gByCat[c.id]); } else { map.removeLayer(gByCat[c.id]); }
      });
      // provenances
      Object.keys(gProv).forEach(k => {
        const cb = document.querySelector(`input[data-prov="${k}"]`);
        if (!cb) return;
        if (cb.checked) { map.addLayer(gProv[k]); } else { map.removeLayer(gProv[k]); }
      });
    }

    toolbar.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', applyFilters);
    });
    applyFilters(); // init

  } catch (e) {
    console.error(e);
    const root = document.getElementById('map');
    root.innerHTML = `<div style="padding:12px;font-family:system-ui,Segoe UI,Roboto,Arial">Erreur de chargement des données.<br><small>${e.message}</small></div>`;
  }
})();
