// ===== Helpers =====
async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Erreur de chargement: ${url}`);
  return await r.json();
}
const sleep = ms => new Promise(res => setTimeout(res, ms));
const isFiniteNum = v => Number.isFinite(parseFloat(v));

function fromCache(key){ try { return JSON.parse(localStorage.getItem(key)||'null'); } catch { return null; } }
function toCache(key,val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// Convertit "Ville (41)" en "Ville, Loir-et-Cher, France" (meilleur géocodage)
const deptMap = {
  "41": "Loir-et-Cher", "45": "Loiret", "37": "Indre-et-Loire", "72": "Sarthe"
};
function normalizeVilleDept(villeDept) {
  if (!villeDept) return null;
  const m = villeDept.match(/^(.+?)\s*\((\d{2})\)/);
  if (m) {
    const city = m[1].trim();
    const code = m[2];
    const dept = deptMap[code] || code;
    return `${city}, ${dept}, France`;
  }
  return `${villeDept}, France`;
}

// Géocodage Nominatim (politesse/throttle)
async function geocode(text) {
  if (!text) return null;
  const q = text;
  const key = `geo:${q}`;
  const cached = fromCache(key);
  if (cached) return cached;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fr&q=${encodeURIComponent(q)}`;
  const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const js = await resp.json();
  if (Array.isArray(js) && js.length) {
    const ll = [parseFloat(js[0].lat), parseFloat(js[0].lon)];
    toCache(key, ll); await sleep(900); return ll;
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

// ===== Main =====
(async () => {
  try {
    const [meta, categories, lieux, provsRaw] = await Promise.all([
      loadJSON('data/meta.json'),
      loadJSON('data/categories.json'),
      loadJSON('data/lieux.json'),
      loadJSON('data/provenances.json')
    ]);

    // Titre affiché tout en haut
    document.getElementById('page-title').textContent = meta.titre || 'Carte';

    // Carte
    const map = L.map('map', { zoomControl: true });
    // Déplace le zoom en bas à droite pour libérer le haut pour le titre
    map.zoomControl.setPosition('bottomright');

    map.setView(meta.centre || [48.8566, 2.3522], meta.zoom || 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: meta.source || '© OpenStreetMap'
    }).addTo(map);

    // Catégories
    const catIndex = {}; categories.forEach(c => catIndex[c.id] = c);
    const gByCat = {}; categories.forEach(c => gByCat[c.id] = L.featureGroup().addTo(map));

    // Provenances
    const gProv = { 'oui': L.featureGroup().addTo(map), 'incertain': L.featureGroup().addTo(map), 'non': L.featureGroup().addTo(map) };
    const etatToClass = { 'oui':'prov-oui', 'non':'prov-non', 'incertain':'prov-incertain' };
    const etatToLib   = { 'oui':'Disponible', 'non':'Ne vient pas', 'incertain':'Incertain' }; // libellé infobulle provenances

    // Ajoute les provenances (sécurisé, fallback géocodage sur adresse)
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
        .bindPopup(`<strong>${p.id ? p.id+' – ' : ''}${p.nom || ''}</strong><div>${p.adresse || ''}</div><div style="margin-top:6px"><em>${etatToLib[etat] || ''}</em></div>`);
    }
    for (const p of (provsRaw || [])) { await addProvenance(p); }

    // Libellés “disponibilité / verdict” pour gîtes à partir de la catégorie (en attendant que l’Excel vXX alimente des champs dédiés)
    const catToDispon = {
      'indispo':'Indisponible',
      'attente':'En attente de réponse',
      'ideal':'Disponible',
      'limite':'Disponible (à vérifier)',
      'contraintes':'Disponible (avec contraintes)'
    };
    const catToVerdict = {
      'indispo':'Indisponible',
      'attente':'En attente',
      'ideal':'Idéal',
      'limite':'Limite à vérifier',
      'contraintes':'Avec contraintes'
    };

    // Ajoute les gîtes (géocodage : adresse > ville(dept))
    async function addLieu(lieu) {
      const cat = catIndex[lieu.categorie] || { id:'autre', libelle:'Autre', couleur:'#2563EB' };
      if (!gByCat[cat.id]) gByCat[cat.id] = L.featureGroup().addTo(map);

      let ll = null;
      if (lieu.adresse) ll = await geocode(lieu.adresse);
      if (!ll && lieu.ville_dept) ll = await geocode(normalizeVilleDept(lieu.ville_dept));
      if (!ll) { console.warn('[Lieu ignoré]', lieu); return; }

      // Icône avec numéro
      const icon = L.divIcon({
        className:'mk-lieu',
        html:`<span class="pin" style="background:${cat.couleur}">${(lieu.id||'')}</span>`,
        iconSize:[24,24], iconAnchor:[12,12], popupAnchor:[0,-12]
      });

      // Contenu popup (structure demandée)
      const nom = (lieu.nom || '').trim();
      const titre = `<strong>n°${lieu.id} — ${nom}</strong>`;
      const place = lieu.adresse ? lieu.adresse : (lieu.ville_dept || '');
      const disponibilite = `<em>${catToDispon[lieu.categorie] || ''}</em>`;
      const verdict = `<div><strong>Analyse :</strong> ${catToVerdict[lieu.categorie] || ''}</div>`;
      const resume = lieu.description ? `<div style="margin-top:6px">${lieu.description}</div>` : '';
      const tarif = lieu.tarif ? `<div style="margin-top:6px"><strong>Tarif :</strong> ${lieu.tarif}</div>` : '';
      const lienAnnonce = lieu.lien ? `<a href="${lieu.lien}" target="_blank" rel="noopener">Voir l’annonce</a>` : '';
      const lienSite = lieu.site ? ` &nbsp;|&nbsp; <a href="${lieu.site}" target="_blank" rel="noopener">Site du gîte</a>` : '';
      const liens = (lienAnnonce || lienSite) ? `<div style="margin-top:6px">${lienAnnonce}${lienSite}</div>` : '';

      const html = [
        titre,
        `<div>${place}</div>`,
        `<div style="margin-top:6px">${disponibilite}</div>`,
        `<div style="margin-top:6px">${verdict}</div>`,
        resume,
        tarif,
        liens
      ].join('');

      L.marker(ll, { icon }).addTo(gByCat[cat.id]).bindPopup(html);
    }
    for (const Lieu of (lieux || [])) { await addLieu(Lieu); }

    // Ajustement vue
    const all = L.featureGroup([...Object.values(gByCat), ...Object.values(gProv)]).addTo(map);
    if (all.getLayers().length) map.fitBounds(all.getBounds().pad(0.2));

    // ===== Panneau fusionné (bas-gauche) =====
    const toolbar = document.getElementById('toolbar');
    const tbBody  = document.getElementById('tbBody');
    const tbBtn   = document.getElementById('tbToggle');

    // Contenu : Catégories
    const s1 = el('div',{class:'section'});
    s1.append(el('div',{class:'ttl'},'Catégories'));
    const row1 = el('div',{class:'row'});
    categories.forEach(c=>{
      const id = `flt_cat_${c.id}`;
      const lab = el('label',{class:'label-chip'},
        `<input type="checkbox" id="${id}" data-cat="${c.id}" checked>
         <span class="swatch" style="background:${c.couleur}"></span> ${c.libelle}`);
      row1.append(lab);
    });
    s1.append(row1);
    tbBody.append(s1);

    // Contenu : Provenances
    const s2 = el('div',{class:'section'});
    s2.append(el('div',{class:'ttl'},'Provenances'));
    const row2 = el('div',{class:'row'});
    [
      {k:'oui', txt:'Participants', cls:'prov-oui'},
      {k:'incertain', txt:'Incertains', cls:'prov-incertain'},
      {k:'non', txt:'Non participants', cls:'prov-non'}
    ].forEach(p=>{
      const id = `flt_prov_${p.k}`;
      const lab = el('label',{class:'label-chip'},
        `<input type="checkbox" id="${id}" data-prov="${p.k}" checked>
         <span class="swatch ${p.cls}"></span> ${p.txt}`);
      row2.append(lab);
    });
    s2.append(row2);
    tbBody.append(s2);

    // Filtres comportement
    function applyFilters() {
      categories.forEach(c=>{
        const cb = tbBody.querySelector(`input[data-cat="${c.id}"]`);
        if (!cb) return;
        if (cb.checked) map.addLayer(gByCat[c.id]); else map.removeLayer(gByCat[c.id]);
      });
      Object.keys(gProv).forEach(k=>{
        const cb = tbBody.querySelector(`input[data-prov="${k}"]`);
        if (!cb) return;
        if (cb.checked) map.addLayer(gProv[k]); else map.removeLayer(gProv[k]);
      });
    }
    tbBody.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', applyFilters));
    applyFilters();

    // Toggle (▾ / −)
    function setCollapsed(collapsed){
      toolbar.classList.toggle('collapsed', collapsed);
      tbBtn.setAttribute('aria-expanded', (!collapsed).toString());
      tbBtn.textContent = collapsed ? '▾' : '−';
    }
    tbBtn.addEventListener('click', ()=> setCollapsed(!toolbar.classList.contains('collapsed')));
    // Par défaut : replié (surtout pour mobile)
    setCollapsed(true);

  } catch (e) {
    console.error(e);
    document.getElementById('map').innerHTML =
      `<div style="padding:12px;font-family:system-ui,Segoe UI,Roboto,Arial">
         <strong>Erreur de chargement des données.</strong><br>
         <small>${e.message}</small>
       </div>`;
  }
})();
