// === utilitaires ===
async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Erreur de chargement: ${url}`);
  return await r.json();
}
const sleep = ms => new Promise(res => setTimeout(res, ms));

function fromCache(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function toCache(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// Géocodage Nominatim (politesse : 1 requête ~/s, cache local)
async function geocode(text) {
  const q = `${text}, France`;
  const key = `geo:${q}`;
  const cached = fromCache(key);
  if (cached) return cached;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fr&q=${encodeURIComponent(q)}`;
  const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const js = await resp.json();
  if (Array.isArray(js) && js.length) {
    const ll = [parseFloat(js[0].lat), parseFloat(js[0].lon)];
    toCache(key, ll);
    await sleep(900); // throttle
    return ll;
  }
  await sleep(900);
  return null;
}

function el(tag, attrs={}, html='') {
  const d = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => d.setAttribute(k, v));
  if (html) d.innerHTML = html;
  return d;
}

(async () => {
  try {
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

    // === légende catégories ===
    const catIndex = {}; categories.forEach(c => catIndex[c.id] = c);
    const legend = L.control({ position:'bottomleft' });
    legend.onAdd = function() {
      const div = L.DomUtil.create('div', 'legend');
      div.innerHTML = `<strong>Catégories</strong><br>` +
        categories.map(c => `<span class="sw" style="display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;background:${c.couleur};box-shadow:0 0 0 1px rgba(0,0,0,.12) inset;"></span>${c.libelle}`).join('<br>');
      return div;
    };
    legend.addTo(map);

    // === groupes lieux par catégorie (pour filtres) ===
    const gByCat = {}; categories.forEach(c => gByCat[c.id] = L.featureGroup().addTo(map));

    // === provenances ===
    const gProv = { 'oui': L.featureGroup().addTo(map), 'non': L.featureGroup().addTo(map), 'incertain': L.featureGroup().addTo(map) };
    const etatToClass = { 'oui':'prov-oui', 'non':'prov-non', 'incertain':'prov-incertain' };
    const etatToLib   = { 'oui':'Participant', 'non':'Non participant', 'incertain':'Incertain' };

    // Pastille P1/P2/... pour provenances
    (provs || []).forEach(p => {
      const etat = (p.etat || 'oui').toLowerCase();
      const icon = L.divIcon({
        className: 'mk-provenance',
        html: `<span class="icon-badge ${etatToClass[etat] || 'prov-oui'}">${(p.id||'').toUpperCase()}</span>`,
        iconSize: [26,26], iconAnchor:[13,13], popupAnchor:[0,-12]
      });
      L.marker([p.lat, p.lon], { icon })
       .addTo(gProv[etat] || gProv['oui'])
       .bindPopup(
         `<strong>${p.id ? p.id+' – ' : ''}${p.nom || ''}</strong>` +
         `<div>${p.adresse || ''}</div>` +
         `<div style="margin-top:6px"><em>${etatToLib[etat] || ''}</em></div>`
       );
    });

    // === lieux (avec géocodage si nécessaire) ===
    async function placeLieu(lieu) {
      const cat = catIndex[lieu.categorie] || { id:'autre', libelle:'Autre', couleur:'#2563EB' };
      if (!gByCat[cat.id]) gByCat[cat.id] = L.featureGroup().addTo(map);

      // Coordonnées si déjà présentes… (pas le cas ici)
      let ll = null;

      // Priorité 1 : adresse complète
      if (!ll && lieu.adresse) ll = await geocode(lieu.adresse);
      // Priorité 2 : ville (41) → on géocode "ville (41), France"
      if (!ll && lieu.ville_dept) ll = await geocode(lieu.ville_dept);

      if (!ll) return; // si rien trouvé, on ignore

      const icon = L.divIcon({
        className: 'mk',
        html: `<span class="dot" style="background:${cat.couleur}"></span>`,
        iconSize: [16,16], iconAnchor:[8,8], popupAnchor:[0,-8]
      });

      const nom = lieu.nom || 'Sans nom';
      const placeLine = lieu.adresse ? lieu.adresse : lieu.ville_dept;
      const link = lieu.lien ? `<div style="margin-top:6px"><a href="${lieu.lien}" target="_blank" rel="noopener">Voir l’annonce</a></div>` : '';
      const desc = lieu.description ? `<div>${lieu.description}</div>` : '';

      L.marker(ll, { icon })
        .addTo(gByCat[cat.id])
        .bindPopup(`<strong>${nom}</strong><div>${placeLine || ''}</div>${desc}${link}`);
    }

    for (const Lieu of lieux) { await placeLieu(Lieu); }

    // Ajustement de vue global
    const all = L.featureGroup([...Object.values(gByCat), ...Object.values(gProv)]).addTo(map);
    if (all.getLayers().length) map.fitBounds(all.getBounds().pad(0.2));

    // Titre
    if (meta.titre) {
      const titleCtl = L.control({ position:'topleft' });
      titleCtl.onAdd = function() {
        const d = L.DomUtil.create('div','titlebar');
        d.innerHTML = `<div class="title">${meta.titre}</div>`;
        return d;
      };
      titleCtl.addTo(map);
    }

    // === Panneau de filtres (catégories + provenances) ===
    const toolbar = document.getElementById('toolbar');
    toolbar.innerHTML = '';
    toolbar.append(el('div', {class:'block'}, '<strong>Filtres :</strong>'));

    const blockCat = el('div', {class:'block'}); blockCat.append(el('span', {class:'ttl'}, 'Catégories : '));
    categories.forEach(c => blockCat.append(el('label', {}, `<input type="checkbox" data-cat="${c.id}" checked> ${c.libelle}`)));
    toolbar.append(blockCat);

    const blockProv = el('div', {class:'block'}); blockProv.append(el('span', {class:'ttl'}, 'Provenances : '));
    [{k:'oui',txt:'Participants'}, {k:'incertain',txt:'Incertains'}, {k:'non',txt:'Non participants'}]
      .forEach(p => blockProv.append(el('label', {}, `<input type="checkbox" data-prov="${p.k}" checked> ${p.txt}`)));
    toolbar.append(blockProv);

    function applyFilters() {
      categories.forEach(c => {
        const cb = toolbar.querySelector(`input[data-cat="${c.id}"]`);
        if (!cb) return;
        if (cb.checked) { map.addLayer(gByCat[c.id]); } else { map.removeLayer(gByCat[c.id]); }
      });
      Object.keys(gProv).forEach(k => {
        const cb = toolbar.querySelector(`input[data-prov="${k}"]`);
        if (!cb) return;
        if (cb.checked) { map.addLayer(gProv[k]); } else { map.removeLayer(gProv[k]); }
      });
    }
    toolbar.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', applyFilters));
    applyFilters();

  } catch (e) {
    console.error(e);
    document.getElementById('map').innerHTML =
      `<div style="padding:12px;font-family:system-ui,Segoe UI,Roboto,Arial">Erreur de chargement des données.<br><small>${e.message}</small></div>`;
  }
})();
