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

// Convertit "Ville (41)" -> "Ville, Loir-et-Cher, France" (meilleur géocodage)
const deptMap = { "41":"Loir-et-Cher","45":"Loiret","37":"Indre-et-Loire","72":"Sarthe" };
function normalizeVilleDept(villeDept) {
  if (!villeDept) return null;
  const m = villeDept.match(/^(.+?)\s*\((\d{2})\)/);
  if (m) { const city = m[1].trim(); const code = m[2]; const dept = deptMap[code] || code; return `${city}, ${dept}, France`; }
  return `${villeDept}, France`;
}

// Géocodage Nominatim (politesse/throttle)
async function geocode(text) {
  if (!text) return null;
  const key = `geo:${text}`;
  const cached = fromCache(key);
  if (cached) return cached;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fr&q=${encodeURIComponent(text)}`;
  const resp = await fetch(url, { headers: { 'Accept':'application/json' } });
  const js = await resp.json();
  if (Array.isArray(js) && js.length) {
    const ll = [parseFloat(js[0].lat), parseFloat(js[0].lon)];
    toCache(key, ll); await sleep(900); return ll;
  }
  await sleep(900);
  console.warn('[Geocode] Aucune coordonnée pour', text);
  return null;
}

function el(tag, attrs={}, html='') {
  const d = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => d.setAttribute(k,v));
  if (html) d.innerHTML = html; return d;
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

    // Titre
    document.getElementById('page-title').textContent = meta.titre || 'Carte';

    // Carte
    const map = L.map('map', { zoomControl: true });
    map.zoomControl.setPosition('bottomright'); // libère le haut pour le titre
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
    const etatToLib   = { 'oui':'Participant', 'non':'Non participant', 'incertain':'Incertain' };

    // Ajout provenances
    async function addProvenance(p) {
      const etat = (p.etat || 'oui').toLowerCase();
      const grp = gProv[etat] || gProv['oui'];
      const icon = L.divIcon({
        className:'mk-provenance',
        html:`<span class="icon-badge ${etatToClass[etat] || 'prov-oui'}">${(p.id||'').toUpperCase()}</span>`,
        iconSize:[26,26], iconAnchor:[13,13], popupAnchor:[0,-12]
      });

      let ll = null;
      if (isFiniteNum(p.lat) && isFiniteNum(p.lon)) ll = [parseFloat(p.lat), parseFloat(p.lon)];
      else if (p.adresse) ll = await geocode(p.adresse);

      if (!ll) { console.warn('[Provenance ignorée]', p); return; }
      L.marker(ll, { icon }).addTo(grp)
       .bindPopup(`<strong>${p.id ? p.id+' – ' : ''}${p.nom || ''}</strong><div>${p.adresse || ''}</div><div style="margin-top:6px"><em>${etatToLib[etat] || ''}</em></div>`);
    }
    for (const p of (provsRaw || [])) { await addProvenance(p); }

    // Statut fusionné (disponibilité + verdict)
    const catToStatut = {
      'indispo':     'Indisponible',
      'attente':     'En attente de réponse',
      'ideal':       'Disponible / composition couchages idéale',
      'limite':      'Disponible / correspondance couchages à vérifier',
      'contraintes': 'Disponible / répartition couchages avec contraintes'
    };

    // Helpers popup (capacité + statut)
    function computeCapaciteLabel(lieu) {
      if (lieu.capacite && String(lieu.capacite).trim()) return String(lieu.capacite).trim();
      return ''; // fallback : on n’invente rien si non fourni (proviendra de l’Excel > JSON)
    }
    function computeStatut(lieu) {
      return catToStatut[lieu.categorie] || '';
    }

    // Ajout gîtes (géocodage : adresse > ville(dept))
    async function addLieu(lieu) {
      const cat = catIndex[lieu.categorie] || { id:'autre', libelle:'Autre', couleur:'#2563EB' };
      if (!gByCat[cat.id]) gByCat[cat.id] = L.featureGroup().addTo(map);

      let ll = null;
      if (lieu.adresse) ll = await geocode(lieu.adresse);
      if (!ll && lieu.ville_dept) ll = await geocode(normalizeVilleDept(lieu.ville_dept));
      if (!ll) { console.warn('[Lieu ignoré]', lieu); return; }

      const icon = L.divIcon({
        className:'mk-lieu',
        html:`<span class="pin" style="background:${cat.couleur}">${(lieu.id||'')}</span>`,
        iconSize:[24,24], iconAnchor:[12,12], popupAnchor:[0,-12]
      });

      const nom = (lieu.nom || '').trim();
      const titre = `<strong>n°${lieu.id} — ${nom}</strong>`;
      const place = lieu.adresse ? lieu.adresse : (lieu.ville_dept || '');

      const capaciteTxt = computeCapaciteLabel(lieu);
      const statutTxt   = computeStatut(lieu);
      const ligneFusion = (capaciteTxt || statutTxt)
        ? `<em>${capaciteTxt ? 'Capacité : ' + capaciteTxt + (statutTxt ? ' — ' : '') : ''}${statutTxt || ''}</em>`
        : '';

