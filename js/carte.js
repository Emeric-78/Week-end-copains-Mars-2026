// ---------- Helpers ----------
async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Erreur de chargement: ${url}`);
  return await r.json();
}
const sleep = ms => new Promise(res => setTimeout(res, ms));
const isFiniteNum = v => Number.isFinite(parseFloat(v));

function fromCache(key){ try { return JSON.parse(localStorage.getItem(key)||'null'); } catch { return null; } }
function toCache(key,val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// Géocodage Nominatim (politesse/throttle)
async function geocode(text) {
  if (!text) return null;
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
  console.warn('[Geocode] Aucune coordonnée pour', q);
  return null;
}

function el(tag, attrs={}, html='') {
  const d = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => d.setAttribute(k,v));
  if (html) d.innerHTML = html;
  return d;
}

// ---------- Main ----------
(async () => {
  try {
    const [meta, categories, lieux, provsRaw] = await Promise.all([
      loadJSON('data/meta.json'),
      loadJSON('data/categories.json'),
      loadJSON('data/lieux.json'),
      loadJSON('data/provenances.json')
    ]);

    // Carte
    const map = L.map('map');
    map.setView(meta.centre || [48.8566, 2.3522], meta.zoom || 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: meta.source || '© OpenStreetMap'
    }).addTo(map);

    // Groupes par catégorie (pour filtres)
    const catIndex = {};
    categories.forEach(c => { catIndex[c.id] = c; });

    const gByCat = {};
    categories.forEach(c => gByCat[c.id] = L.featureGroup().addTo(map));

    // Provenances (participants / incertains / non)
    const gProv = { 'oui': L.featureGroup().addTo(map), 'incertain': L.featureGroup().addTo(map), 'non': L.featureGroup().addTo(map) };
    const etatToClass = { 'oui':'prov-oui', 'non':'prov-non', 'incertain':'prov-incertain' };
    const etatToLib   = { 'oui':'Participant', 'non':'Non participant', 'incertain':'Incertain' };

    // Ajout provenances (sécurisé + fallback géocodage adresse si lat/lon manquants)
    async function addProvenance(p) {
      const etat = (p.etat || 'oui').toLowerCase();
      const grp = gProv[etat] || gProv['oui'];
      const icon = L.divIcon({
        className:'mk-provenance',
        html:`<span class="icon-badge ${etatToClass[etat] || 'prov-oui'}">${(p.id||'').toUpperCase()}</span>`,
        iconSize:[26,26], iconAnchor:[13,13], popupAnchor:[0,-12]
      });

      let ll = null;
      if (isFiniteNum(p.lat) && isFiniteNum(p.lon)) {
        ll = [parseFloat(p.lat), parseFloat(p.lon)];
      } else if (p.adresse) {
        ll = await geocode(p.adresse);
      }

      if (!ll) { console.warn('[Provenance ignorée]', p); return; }

      L.marker(ll, { icon }).addTo(grp)
        .bindPopup(
          `<strong>${p.id ? p.id+' – ' : ''}${p.nom || ''}</strong>` +
          `<div>${p.adresse || ''}</div>` +
          `<div style="margin-top:6px"><em>${etatToLib[etat] || ''}</em></div>`
        );
    }
    for (const p of (provsRaw || [])) { await addProvenance(p); }

    // Ajout lieux (géocodage : adresse prioritaire, sinon ville)
    async function addLieu(lieu) {
      const cat = catIndex[lieu.categorie] || { id:'autre', libelle:'Autre', couleur:'#2563EB' };
      if (!gByCat[cat.id]) gByCat[cat.id] = L.featureGroup().addTo(map);

      let ll = null;
      if (lieu.adresse) ll = await geocode(lieu.adresse);
      if (!ll && lieu.ville_dept) ll = await geocode(lieu.ville_dept);

      if (!ll) { console.warn('[Lieu ignoré]', lieu); return; }

      const icon = L.divIcon({
        className:'mk',
        html:`<span class="dot" style="background:${cat.couleur}"></span>`,
        iconSize:[16,16], iconAnchor:[8,8], popupAnchor:[0,-8]
      });

      const nom = lieu.nom || 'Sans nom';
      const placeLine = lieu.adresse ? lieu.adresse : (lieu.ville_dept || '');
      const link = lieu.lien ? `<div style="margin-top:6px"><a href="${lieu.lien}" target="_blank" rel="noopener">Voir l’annonce</a></div>` : '';
      const desc = lieu.description ? `<div>${lieu.description}</div>` : '';

      L.marker(ll, { icon }).addTo(gByCat[cat.id])
        .bindPopup(`<strong>${nom}</strong><div>${placeLine}</div>${desc}${link}`);
    }
    for (const Lieu of (lieux || [])) { await addLieu(Lieu); }

    // Ajustement de vue
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

    // ---------- Panneau fusionné légende+filtres (repliable) ----------
    const toolbar = document.getElementById('toolbar');
    const btn = document.getElementById('toggleToolbar');

    // Contenu : Catégories
    const s1 = el('div',{class:'section'});
    s1.append(el('span',{class:'ttl'},'Catégories'));
    const row1 = el('div',{class:'row'});
    categories.forEach(c=>{
      const id = `flt_cat_${c.id}`;
      const label = el('label',{class:'label-chip'},
        `<input type="checkbox" id="${id}" data-cat="${c.id}" checked>
         <span class="swatch" style="background:${c.couleur}"></span> ${c.libelle}`);
      row1.append(label);
    });
    s1.append(row1);
    toolbar.append(s1);

    // Contenu : Provenances
    const s2 = el('div',{class:'section'});
    s2.append(el('span',{class:'ttl'},'Provenances'));
    const row2 = el('div',{class:'row'});
    [
      {k:'oui', txt:'Participants', cls:'prov-oui'},
      {k:'incertain', txt:'Incertains', cls:'prov-incertain'},
      {k:'non', txt:'Non participants', cls:'prov-non'}
    ].forEach(p=>{
      const id = `flt_prov_${p.k}`;
      const label = el('label',{class:'label-chip'},
        `<input type="checkbox" id="${id}" data-prov="${p.k}" checked>
         <span class="swatch ${p.cls}" style="background:transparent;"></span> ${p.txt}`);
      row2.append(label);
    });
    s2.append(row2);
    toolbar.append(s2);

    function applyFilters() {
      // Catégories
      categories.forEach(c=>{
        const cb = toolbar.querySelector(`input[data-cat="${c.id}"]`);
        if (!cb) return;
        if (cb.checked) map.addLayer(gByCat[c.id]); else map.removeLayer(gByCat[c.id]);
      });
      // Provenances
      Object.keys(gProv).forEach(k=>{
        const cb = toolbar.querySelector(`input[data-prov="${k}"]`);
        if (!cb) return;
        if (cb.checked) map.addLayer(gProv[k]); else map.removeLayer(gProv[k]);
      });
    }
    toolbar.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', applyFilters));
    applyFilters();

    // Bouton toggle (mobile)
    function setExpanded(expanded){
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toolbar.classList.toggle('hidden', !expanded && window.matchMedia('(max-width: 767px)').matches);
    }
    btn.addEventListener('click', ()=> setExpanded(btn.getAttribute('aria-expanded') !== 'true'));
    // Par défaut : masqué en mobile, visible en desktop (cf. CSS)
    setExpanded(false);

  } catch (e) {
    console.error(e);
    document.getElementById('map').innerHTML =
      `<div style="padding:12px;font-family:system-ui,Segoe UI,Roboto,Arial">
         <strong>Erreur de chargement des données.</strong><br>
         <small>${e.message}</small>
       </div>`;
  }
})();
