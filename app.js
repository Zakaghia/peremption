/* Alerte Péremption v1.1 — 100% local (IndexedDB), aucun serveur */
'use strict';

/* =========================================================
   1. BASE DE DONNÉES (IndexedDB)
   ========================================================= */
const DB_NOM = 'alerte-peremption';
const DB_VERSION = 1;
let db = null;

function ouvrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOM, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('articles')) {
        const store = d.createObjectStore('articles', { keyPath: 'id', autoIncrement: true });
        store.createIndex('date_peremption', 'date_peremption');
      }
      if (!d.objectStoreNames.contains('reglages')) {
        d.createObjectStore('reglages', { keyPath: 'cle' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, action) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let resultat;
    const r = action(s);
    if (r) r.onsuccess = () => { resultat = r.result; };
    t.oncomplete = () => resolve(resultat);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const Articles = {
  tous: () => tx('articles', 'readonly', s => s.getAll()),
  get: id => tx('articles', 'readonly', s => s.get(id)),
  ajouter: a => tx('articles', 'readwrite', s => s.add(a)),
  modifier: a => tx('articles', 'readwrite', s => s.put(a)),
  supprimer: id => tx('articles', 'readwrite', s => s.delete(id)),
  remplacerTout: liste => tx('articles', 'readwrite', s => {
    s.clear();
    liste.forEach(a => s.put(a));
  }),
};

const Reglages = {
  get: async (cle, defaut) => {
    const r = await tx('reglages', 'readonly', s => s.get(cle));
    return r ? r.valeur : defaut;
  },
  set: (cle, valeur) => tx('reglages', 'readwrite', s => s.put({ cle, valeur })),
};

/* =========================================================
   2. DATES ET COULEURS
   ========================================================= */
let seuilRouge = 7;
let seuilOrange = 30;
let taillePack = 6;

function aujourdhui() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function lireDate(iso) {                 // "2026-12-31" -> Date locale (sans décalage horaire)
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(a, m - 1, j);
}
function joursRestants(iso) {
  return Math.round((lireDate(iso) - aujourdhui()) / 86400000);
}
function couleur(jours) {
  if (jours <= seuilRouge) return 'rouge';
  if (jours <= seuilOrange) return 'orange';
  return 'vert';
}
function texteJours(jours) {
  if (jours < 0) return jours === -1 ? 'Périmé (1 j)' : `Périmé (${-jours} j)`;
  if (jours === 0) return "Aujourd'hui";
  if (jours === 1) return 'Reste 1 jour';
  return `Reste ${jours} jours`;
}
function formatDate(iso) {
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}
function echapper(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const normal = t => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');

/* =========================================================
   3. ÉCRAN LISTE
   ========================================================= */
const $ = id => document.getElementById(id);
let filtreActif = 'tous';
let tousLesArticles = [];

async function chargerArticles() {
  tousLesArticles = await Articles.tous();
  tousLesArticles.sort((a, b) => a.date_peremption.localeCompare(b.date_peremption) || a.nom.localeCompare(b.nom));
  return tousLesArticles;
}

async function afficherListe() {
  await chargerArticles();

  // Compteurs
  const nb = { rouge: 0, orange: 0, vert: 0, perime: 0 };
  tousLesArticles.forEach(a => {
    const j = joursRestants(a.date_peremption);
    nb[couleur(j)]++;
    if (j < 0) nb.perime++;
  });
  $('nb-rouge').textContent = nb.rouge;
  $('nb-orange').textContent = nb.orange;
  $('nb-vert').textContent = nb.vert;
  $('nb-perime').textContent = nb.perime;

  // Bannière (cliquable)
  const ban = $('banniere');
  const urgents = nb.rouge - nb.perime;
  const morceaux = [];
  if (nb.perime) morceaux.push(`${nb.perime} périmé${nb.perime > 1 ? 's' : ''}`);
  if (urgents) morceaux.push(`${urgents} à vendre vite`);
  if (morceaux.length) {
    ban.textContent = `Attention : ${morceaux.join(', ')}`;
    ban.dataset.filtre = nb.perime ? 'perime' : 'rouge';
    ban.hidden = false;
  } else {
    ban.hidden = true;
  }

  // Filtrage
  const q = normal($('recherche').value);
  const visibles = tousLesArticles.filter(a => {
    const j = joursRestants(a.date_peremption);
    if (filtreActif === 'perime' && j >= 0) return false;
    if (!['tous', 'perime'].includes(filtreActif) && couleur(j) !== filtreActif) return false;
    if (q && !normal(a.nom).includes(q) && !(a.code_barres || '').includes(q)) return false;
    return true;
  });

  $('liste').innerHTML = visibles.map(a => {
    const j = joursRestants(a.date_peremption);
    const c = j < 0 ? 'rouge perime' : couleur(j);
    const cb = j < 0 ? 'perime' : couleur(j);
    return `<li><button class="article ${c}" data-id="${a.id}">
      <div class="corps">
        <div class="nom">${echapper(a.nom)}</div>
        <div class="meta">
          <span>📅 ${formatDate(a.date_peremption)}</span>
          <span>Qté : <b>${Number(a.quantite) || 0}</b></span>
          ${a.emplacement ? `<span>📍 ${echapper(a.emplacement)}</span>` : ''}
        </div>
      </div>
      <span class="badge ${cb}">${texteJours(j)}</span>
    </button></li>`;
  }).join('');

  const vide = $('vide');
  if (visibles.length === 0) {
    vide.hidden = false;
    const aucun = tousLesArticles.length === 0;
    vide.querySelector('.vide-titre').textContent =
      aucun ? 'Aucun article' : filtreActif === 'perime' && !q ? 'Aucun produit périmé 👍' : 'Aucun résultat';
    vide.querySelector('p:last-child').innerHTML =
      aucun ? 'Appuie sur <b>+ Ajouter</b> pour enregistrer un produit.' : 'Change la recherche ou le filtre.';
  } else {
    vide.hidden = true;
  }

  // Suggestions pour le formulaire (noms et emplacements déjà utilisés)
  const noms = [...new Set(tousLesArticles.map(a => a.nom))];
  const empl = [...new Set(tousLesArticles.map(a => a.emplacement).filter(Boolean))];
  $('noms-connus').innerHTML = noms.map(n => `<option value="${echapper(n)}">`).join('');
  $('empl-connus').innerHTML = empl.map(n => `<option value="${echapper(n)}">`).join('');
}

function choisirFiltre(f) {
  filtreActif = f;
  document.querySelectorAll('.filtre').forEach(b => b.classList.toggle('actif', b.dataset.filtre === f));
  afficherListe();
}

/* =========================================================
   4. NAVIGATION
   ========================================================= */
function montrer(ecran, titre) {
  document.querySelectorAll('.ecran').forEach(e => e.classList.remove('actif'));
  $('ecran-' + ecran).classList.add('actif');
  $('titre').textContent = titre;
  const onglet = { liste: 'liste', form: null, reglages: 'reglages' }[ecran];
  document.querySelectorAll('.onglet').forEach(b => b.classList.toggle('actif', b.dataset.ecran === onglet));
  window.scrollTo(0, 0);
}

function allerListe() {
  montrer('liste', 'Alerte Péremption');
  afficherListe();
}

/* =========================================================
   5. FORMULAIRE AJOUTER / MODIFIER
   ========================================================= */
function modeAjout() { return !$('f-id').value; }

async function ouvrirAjout() {
  await chargerArticles();
  $('form').reset();
  $('f-id').value = '';
  $('f-qte').value = 1;
  $('f-erreur').hidden = true;
  $('zone-detail').hidden = true;
  $('btn-suppr').hidden = true;
  $('btn-scan').hidden = false;
  $('deja').hidden = true;
  montrer('form', 'Ajouter un article');
}

async function ouvrirDetail(id) {
  const a = await Articles.get(id);
  if (!a) return;
  $('f-id').value = a.id;
  $('f-nom').value = a.nom;
  $('f-date').value = a.date_peremption;
  $('f-qte').value = a.quantite ?? 0;
  $('f-empl').value = a.emplacement || '';
  $('f-code').value = a.code_barres || '';
  $('f-erreur').hidden = true;
  majEtat(a.date_peremption);
  $('zone-detail').hidden = false;
  $('btn-suppr').hidden = false;
  $('btn-scan').hidden = true;
  $('deja').hidden = true;
  $('btn-moins-pack').textContent = `−${taillePack} (pack)`;
  montrer('form', 'Modifier');
}

function majEtat(iso) {
  const el = $('f-etat');
  if (!iso) { el.className = 'info-etat'; el.textContent = ''; return; }
  const j = joursRestants(iso);
  el.className = 'info-etat ' + couleur(j);
  el.textContent = texteJours(j);
}

/* --- "Déjà en stock" : les lots existants du même produit --- */
function majDeja() {
  const box = $('deja');
  if (!modeAjout()) { box.hidden = true; return; }
  const nom = normal($('f-nom').value);
  if (!nom) { box.hidden = true; return; }
  const lots = tousLesArticles.filter(a => normal(a.nom) === nom);
  if (!lots.length) { box.hidden = true; return; }
  const dateChoisie = $('f-date').value;
  box.innerHTML =
    `<p class="deja-titre">Déjà en stock (${lots.length} date${lots.length > 1 ? 's' : ''})</p>` +
    lots.map(a => {
      const j = joursRestants(a.date_peremption);
      const choisi = a.date_peremption === dateChoisie;
      return `<button type="button" class="deja-lot ${choisi ? 'choisi' : ''}" data-date="${a.date_peremption}" data-empl="${echapper(a.emplacement || '')}">
        <span class="txt">📅 <b>${formatDate(a.date_peremption)}</b> · Qté ${Number(a.quantite) || 0}${a.emplacement ? ' · 📍 ' + echapper(a.emplacement) : ''}<br><small>${texteJours(j)}</small></span>
        <span class="action">${choisi ? '✓ Ajouter ici' : 'Même date'}</span>
      </button>`;
    }).join('') +
    `<p class="deja-aide">Même date = la quantité s'ajoute sur la ligne existante. Autre date = nouvelle ligne.</p>`;
  box.hidden = false;
}

function lireFormulaire() {
  const nom = $('f-nom').value.trim();
  const date = $('f-date').value;
  const qte = parseInt($('f-qte').value, 10);
  if (!nom) return { erreur: 'Écris le nom du produit.' };
  if (!date) return { erreur: 'Choisis la date de péremption.' };
  if (isNaN(qte) || qte < 0) return { erreur: 'La quantité doit être 0 ou plus.' };
  return {
    nom,
    date_peremption: date,
    quantite: qte,
    emplacement: $('f-empl').value.trim(),
    code_barres: $('f-code').value.trim(),
  };
}

async function enregistrer(e) {
  e.preventDefault();
  const data = lireFormulaire();
  if (data.erreur) {
    $('f-erreur').textContent = data.erreur;
    $('f-erreur').hidden = false;
    return;
  }
  const id = $('f-id').value;
  if (id) {
    const ancien = await Articles.get(Number(id));
    await Articles.modifier({ ...ancien, ...data });
    toast('Article modifié');
  } else {
    // Même produit + même date => on ajoute la quantité sur la ligne existante
    const lots = await Articles.tous();
    const existe = lots.find(a => normal(a.nom) === normal(data.nom) && a.date_peremption === data.date_peremption);
    if (existe) {
      const avant = Number(existe.quantite) || 0;
      existe.quantite = avant + data.quantite;
      if (!existe.code_barres && data.code_barres) existe.code_barres = data.code_barres;
      if (!existe.emplacement && data.emplacement) existe.emplacement = data.emplacement;
      await Articles.modifier(existe);
      toast(`Ajouté au stock : ${avant} + ${data.quantite} = ${existe.quantite}`);
    } else {
      await Articles.ajouter({ ...data, date_ajout: new Date().toISOString() });
      toast('Article ajouté');
    }
  }
  allerListe();
}

async function diminuer(n) {
  const id = Number($('f-id').value);
  const a = await Articles.get(id);
  if (!a) return;
  const avant = Number(a.quantite) || 0;
  const q = Math.max(0, avant - n);
  a.quantite = q;
  await Articles.modifier(a);
  $('f-qte').value = q;
  if (q === 0) {
    if (confirm('Quantité = 0. Supprimer cet article ?')) {
      await Articles.supprimer(id);
      toast('Article supprimé');
      allerListe();
      return;
    }
  }
  toast(`Quantité : ${avant} − ${avant - q} = ${q}`);
}

async function supprimer() {
  const id = Number($('f-id').value);
  if (!id) return;
  if (!confirm('Supprimer cet article ? (vendu ou retiré)')) return;
  await Articles.supprimer(id);
  toast('Article supprimé');
  allerListe();
}

/* =========================================================
   6. SCANNER DE CODE-BARRES (caméra)
   ========================================================= */
const LIB_SCAN = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
let lecteur = null;
let scanCible = 'ajout';      // 'ajout' ou 'recherche'
let scanFini = false;

function chargerLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB_SCAN;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('lib')); };
    document.head.appendChild(s);
  });
}

async function ouvrirScanner(cible) {
  scanCible = cible;
  scanFini = false;
  $('scan-manuel').value = '';
  $('scan-msg').hidden = true;
  $('scanner').hidden = false;
  try {
    await chargerLib();
    const F = window.Html5QrcodeSupportedFormats;
    lecteur = new window.Html5Qrcode('lecteur', {
      verbose: false,
      formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    await lecteur.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => ({ width: Math.floor(w * 0.85), height: Math.floor(Math.min(h, w) * 0.45) }) },
      code => codeLu(code),
      () => {}
    );
  } catch (err) {
    const msg = $('scan-msg');
    msg.textContent = err && err.message === 'lib'
      ? 'Scanner pas encore prêt : ouvre l\'app une fois avec internet. Tu peux taper le code en bas.'
      : 'Caméra non disponible. Autorise la caméra, ou tape le code en bas.';
    msg.hidden = false;
  }
}

async function fermerScanner() {
  $('scanner').hidden = true;
  if (lecteur) {
    try { if (lecteur.isScanning) await lecteur.stop(); lecteur.clear(); } catch { /* rien */ }
    lecteur = null;
  }
}

async function codeLu(code) {
  if (scanFini) return;
  code = String(code || '').trim();
  if (!code) return;
  scanFini = true;
  await fermerScanner();
  if (scanCible === 'recherche') {
    $('recherche').value = code;
    choisirFiltre('tous');
    return;
  }
  appliquerCode(code);
}

/* Après un scan dans "Ajouter" : retrouver le produit */
async function appliquerCode(code, depuisScan = true) {
  await chargerArticles();
  // Si l'utilisateur a déjà écrit un nom, on ne l'écrase jamais
  if (!depuisScan && $('f-nom').value.trim()) return;
  $('f-code').value = code;
  const noms = [...new Map(
    tousLesArticles.filter(a => a.code_barres === code).map(a => [normal(a.nom), a.nom])
  ).values()];

  if (noms.length === 0) {
    toast('Nouveau produit : écris le nom');
    $('f-nom').focus();
  } else if (noms.length === 1) {
    choisirNom(noms[0]);
  } else {
    // Même code-barres pour plusieurs produits (ex : fraise / tchina)
    $('choix-liste').innerHTML = noms.map(n =>
      `<button type="button" class="btn" data-nom="${echapper(n)}">${echapper(n)}</button>`).join('');
    $('choix').hidden = false;
  }
}

function choisirNom(nom) {
  $('f-nom').value = nom;
  const dernier = tousLesArticles.filter(a => normal(a.nom) === normal(nom)).pop();
  if (dernier && !$('f-empl').value) $('f-empl').value = dernier.emplacement || '';
  majDeja();
  toast(`Produit : ${nom}`);
}

/* =========================================================
   7. RÉGLAGES
   ========================================================= */
async function chargerReglages() {
  seuilRouge = await Reglages.get('seuilRouge', 7);
  seuilOrange = await Reglages.get('seuilOrange', 30);
  taillePack = await Reglages.get('taillePack', 6);
}

function ouvrirReglages() {
  $('r-rouge').value = seuilRouge;
  $('r-orange').value = seuilOrange;
  $('r-pack').value = taillePack;
  $('r-erreur').hidden = true;
  majInfoSauvegarde();
  montrer('reglages', 'Réglages');
}

async function enregistrerReglages() {
  const r = parseInt($('r-rouge').value, 10);
  const o = parseInt($('r-orange').value, 10);
  const p = parseInt($('r-pack').value, 10);
  let err = '';
  if (isNaN(r) || isNaN(o) || r < 0 || o <= r) err = 'Le chiffre orange doit être plus grand que le rouge.';
  else if (isNaN(p) || p < 2) err = 'La taille du pack doit être 2 ou plus.';
  if (err) { $('r-erreur').textContent = err; $('r-erreur').hidden = false; return; }
  seuilRouge = r; seuilOrange = o; taillePack = p;
  await Reglages.set('seuilRouge', r);
  await Reglages.set('seuilOrange', o);
  await Reglages.set('taillePack', p);
  $('r-erreur').hidden = true;
  toast('Réglages enregistrés');
}

/* =========================================================
   8. SAUVEGARDE : EXPORTER / IMPORTER
   ========================================================= */
async function exporter() {
  const articles = await Articles.tous();
  const contenu = {
    app: 'alerte-peremption',
    version: 1,
    date_export: new Date().toISOString(),
    reglages: { seuilRouge, seuilOrange, taillePack },
    articles,
  };
  const d = new Date();
  const nomFichier = `sauvegarde-peremption-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  const blob = new Blob([JSON.stringify(contenu, null, 2)], { type: 'application/json' });
  const fichier = new File([blob], nomFichier, { type: 'application/json' });

  // Sur iPhone : la feuille de partage permet "Enregistrer dans Fichiers" ou WhatsApp
  try {
    if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
      await navigator.share({ files: [fichier], title: 'Sauvegarde Alerte Péremption' });
      await noterSauvegarde();
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;   // l'utilisateur a annulé
  }

  // Sinon : téléchargement classique
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomFichier;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  await noterSauvegarde();
}

async function noterSauvegarde() {
  await Reglages.set('derniereSauvegarde', new Date().toISOString());
  majInfoSauvegarde();
  toast('Sauvegarde faite ✓');
}

async function majInfoSauvegarde() {
  const d = await Reglages.get('derniereSauvegarde', null);
  $('derniere-sauv').textContent = d
    ? `Dernière sauvegarde : ${new Date(d).toLocaleDateString('fr-FR')}`
    : 'Aucune sauvegarde pour le moment.';
}

async function importer(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const json = JSON.parse(await f.text());
    const liste = Array.isArray(json) ? json : json.articles;
    if (!Array.isArray(liste)) throw new Error('format');
    const propres = liste
      .filter(a => a && a.nom && /^\d{4}-\d{2}-\d{2}$/.test(a.date_peremption))
      .map(a => ({
        ...(Number.isInteger(a.id) ? { id: a.id } : {}),
        nom: String(a.nom),
        date_peremption: a.date_peremption,
        quantite: Math.max(0, parseInt(a.quantite, 10) || 0),
        emplacement: String(a.emplacement || ''),
        code_barres: String(a.code_barres || ''),
        date_ajout: a.date_ajout || new Date().toISOString(),
      }));
    if (!confirm(`Importer ${propres.length} article(s) ?\nAttention : les données actuelles seront remplacées.`)) return;
    await Articles.remplacerTout(propres);
    const rg = json.reglages;
    if (rg) {
      const r = parseInt(rg.seuilRouge, 10), o = parseInt(rg.seuilOrange, 10), p = parseInt(rg.taillePack, 10);
      if (!isNaN(r) && !isNaN(o) && o > r && r >= 0) {
        seuilRouge = r; seuilOrange = o;
        await Reglages.set('seuilRouge', r); await Reglages.set('seuilOrange', o);
      }
      if (!isNaN(p) && p >= 2) { taillePack = p; await Reglages.set('taillePack', p); }
    }
    toast(`${propres.length} article(s) importé(s)`);
    allerListe();
  } catch {
    alert("Ce fichier n'est pas une sauvegarde valide.");
  }
}

/* =========================================================
   9. DIVERS
   ========================================================= */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

async function demanderStockagePersistant() {
  // Demande au navigateur de ne pas effacer les données
  try {
    if (navigator.storage && navigator.storage.persist) {
      const deja = await navigator.storage.persisted();
      const ok = deja || await navigator.storage.persist();
      $('info-stockage').textContent = ok
        ? 'Données enregistrées dans ce téléphone (stockage protégé ✓).'
        : 'Données enregistrées dans ce téléphone. Pense à exporter souvent.';
    }
  } catch { /* rien */ }
}

/* =========================================================
   10. DÉMARRAGE
   ========================================================= */
async function demarrer() {
  try {
    db = await ouvrirDB();
  } catch {
    document.querySelector('main').innerHTML =
      '<div class="carte"><h2>Erreur</h2><p class="aide">Impossible d\'ouvrir la base de données. Désactive la navigation privée puis réessaie.</p></div>';
    return;
  }
  await chargerReglages();

  // Navigation
  document.querySelectorAll('.onglet').forEach(b => b.addEventListener('click', () => {
    const e = b.dataset.ecran;
    if (e === 'liste') allerListe();
    else if (e === 'ajouter') ouvrirAjout();
    else if (e === 'reglages') ouvrirReglages();
  }));

  // Liste
  document.querySelectorAll('.filtre, .compteur').forEach(b =>
    b.addEventListener('click', () => choisirFiltre(
      b.classList.contains('compteur') && filtreActif === b.dataset.filtre ? 'tous' : b.dataset.filtre
    )));
  $('banniere').addEventListener('click', e => choisirFiltre(e.currentTarget.dataset.filtre));
  $('recherche').addEventListener('input', afficherListe);
  $('btn-scan-recherche').addEventListener('click', () => ouvrirScanner('recherche'));
  $('liste').addEventListener('click', e => {
    const b = e.target.closest('.article');
    if (b) ouvrirDetail(Number(b.dataset.id));
  });

  // Formulaire
  $('form').addEventListener('submit', enregistrer);
  $('f-nom').addEventListener('input', majDeja);
  $('f-nom').addEventListener('change', majDeja);
  $('f-date').addEventListener('change', e => { majEtat(e.target.value); majDeja(); });
  $('deja').addEventListener('click', e => {
    const b = e.target.closest('.deja-lot');
    if (!b) return;
    $('f-date').value = b.dataset.date;
    if (!$('f-empl').value && b.dataset.empl) $('f-empl').value = b.dataset.empl;
    majDeja();
    $('f-qte').focus();
    $('f-qte').select();
  });
  $('btn-moins').addEventListener('click', () => diminuer(1));
  $('btn-moins-pack').addEventListener('click', () => diminuer(taillePack));
  $('btn-suppr').addEventListener('click', supprimer);
  $('btn-annuler').addEventListener('click', allerListe);

  // Scanner
  $('btn-scan').addEventListener('click', () => ouvrirScanner('ajout'));
  $('scan-fermer').addEventListener('click', fermerScanner);
  $('scan-ok').addEventListener('click', () => codeLu($('scan-manuel').value));
  $('scan-manuel').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); codeLu(e.target.value); } });
  $('choix-liste').addEventListener('click', e => {
    const b = e.target.closest('[data-nom]');
    if (!b) return;
    $('choix').hidden = true;
    choisirNom(b.dataset.nom);
  });
  $('choix-nouveau').addEventListener('click', () => {
    $('choix').hidden = true;
    $('f-nom').value = '';
    majDeja();
    $('f-nom').focus();
  });

  // Réglages
  $('btn-reglages').addEventListener('click', enregistrerReglages);
  $('btn-export').addEventListener('click', exporter);
  $('f-import').addEventListener('change', importer);

  // Recalcule les couleurs quand on revient sur l'app (nouveau jour)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && $('ecran-liste').classList.contains('actif')) afficherListe();
  });

  await afficherListe();
  demanderStockagePersistant();

  // Mode hors ligne
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

demarrer();
