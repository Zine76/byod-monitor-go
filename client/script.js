// script.js

// MODIFICATION : Définir l'URL de base de votre backend Go
// Si votre backend Go tourne toujours localement pendant que vous testez GitHub Pages :
const backendBaseUrl = 'http://localhost:5050';
// Si vous déployez un jour votre backend Go sur un serveur public/interne,
// vous changerez cette URL ici. Par exemple :
// const backendBaseUrl = 'https://mon-serveur-uqam.ca/api_byod';

let currentDevice = null;
let devices = []; // Initialiser comme un tableau vide

async function fetchDevicesAndInitialize() {
  try {
    // MODIFICATION : Utiliser backendBaseUrl
    const response = await fetch(`${backendBaseUrl}/api/devices`);
    if (!response.ok) {
      throw new Error(`Erreur HTTP ${response.status} lors de la récupération des appareils depuis ${backendBaseUrl}/api/devices`);
    }
    const loadedDevices = await response.json();
    devices = loadedDevices.map(d => ({
      ...d, 
      ip: d.ip || null, 
      status: d.status || null,
      rebootInitiatedAt: d.rebootInitiatedAt || null,
      isRebooting: d.isRebooting || false,
      lastSeen: d.lastSeen || null
    }));
    console.log("✅ Appareils chargés depuis le backend:", devices);
  } catch (error) {
    console.error("❌ Impossible de charger la liste des appareils depuis le backend:", error);
    alert("Erreur: Impossible de charger la liste des appareils. Vérifiez la console du backend et que le fichier appareils.csv existe et est correct. Assurez-vous aussi que le backend est accessible à l'URL configurée.");
    devices = []; 
  }
  initializeMonitoring(); 
}

function initializeMonitoring() {
  console.log("🚀 Initialisation du monitoring...");
  const buildings = new Set();
  const techs = new Set();
  devices.forEach(d => {
    if (d.building) buildings.add(d.building);
    if (d.tech) techs.add(d.tech);
  });

  const buildingFilter = document.getElementById("filter-building");
  buildingFilter.innerHTML = '<option value="">Tous les pavillons</option>';
  buildings.forEach(b => {
    const o = document.createElement('option');
    o.value = b; o.textContent = `Pavillon ${b}`;
    buildingFilter.appendChild(o);
  });

  const techFilter = document.getElementById("filter-tech");
  techFilter.innerHTML = '<option value="">Toutes les technologies</option>';
  techs.forEach(t => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    techFilter.appendChild(o);
  });
  console.log("🔩 Filtres peuplés.");

  const rebootButtonElement = document.querySelector('#sidebar button.btn:nth-of-type(2)');
  if (rebootButtonElement && rebootButtonElement.innerText.toLowerCase().includes('rebooter')) {
      rebootButtonElement.classList.add('reboot-btn'); 
  }

  resolveAllIPs(() => {
    console.log("📞 Résolution IP initiale terminée, lancement de la première mise à jour des statuts.");
    updateStatuses(); 
    setInterval(updateStatuses, 7000); 
    setInterval(() => resolveAllIPs(null, true), 300000); 
  }, false);

  ["search", "filter-building", "filter-tech", "filter-status"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(id === "search" ? "input" : "change", renderDevices);
  });
  console.log("👂 Écouteurs d'événements pour les filtres activés.");
}

function resolveAllIPs(callback, isPeriodicCall = false) {
  if (!isPeriodicCall) console.log("ℹ️ Début de resolveAllIPs (appel initial)...");
  let pending = devices.length;
  if (pending === 0) {
    if (typeof callback === 'function' && !isPeriodicCall) callback();
    else if (isPeriodicCall) renderDevices();
    return;
  }
  devices.forEach(device => {
    // MODIFICATION : Utiliser backendBaseUrl
    fetch(`${backendBaseUrl}/resolve?host=${device.address}`)
      .then(r => {
        if (!r.ok) return r.json().then(eD => { throw new Error(`HTTP ${r.status}: ${eD.error||r.statusText}`) }).catch(()=> {throw new Error(`HTTP ${r.status}: ${r.statusText}`)});
        return r.json();
      }).then(data => {
        if (data && data.success && data.address) {
          if (device.ip !== data.address) device.ip = data.address;
        } else if (device.ip === null || !isPeriodicCall) device.ip = "Inconnu (échec résolution)";
      }).catch(err => {
        if (device.ip === null || !isPeriodicCall) device.ip = "Inconnu (erreur fetch)";
        console.warn(`Erreur résolution IP pour ${device.address}:`, err.message);
      }).finally(() => {
        pending--;
        if (pending === 0) {
          if (typeof callback === 'function' && !isPeriodicCall) {
            if (!isPeriodicCall) console.log("✅ Toutes les résolutions d'IP initiales terminées.");
            callback();
          } else if (isPeriodicCall) {
            renderDevices();
            if (currentDevice && document.getElementById("sidebar").classList.contains("open")) {
              const updatedDevice = devices.find(d => d.address === currentDevice.address);
              if (updatedDevice && updatedDevice.ip !== document.getElementById("detail-ip").innerText) {
                openSidebar(updatedDevice);
              }
            }
          }
        }
      });
  });
}

function renderDevices() {
  const container = document.getElementById('status-container');
  if (!container) return; 
  container.innerHTML = "";
  
  const search = document.getElementById("search").value.toLowerCase();
  const fb = document.getElementById("filter-building").value;
  const ft = document.getElementById("filter-tech").value;
  const fsVal = document.getElementById("filter-status").value;

  devices.forEach(d => {
    const currentStatus = d.isRebooting ? "rebooting" : (d.status || "offline");
    if (fsVal && currentStatus !== fsVal) return;
    if (!d.status && !d.isRebooting && fsVal !== "offline" && fsVal !== "") return;

    const textContentForSearch = [d.name, d.building, d.tech, d.ip, d.mac].filter(Boolean).join(" ").toLowerCase();
    if (search && !textContentForSearch.includes(search)) return;
    if (fb && d.building !== fb) return;
    if (ft && d.tech !== ft) return;

    const box = document.createElement('div');
    box.className = `status-box ${currentStatus}`;
    box.innerHTML = `<div>${d.name}</div><div class="badge">${d.tech} • ${d.building}</div>`;
    box.onclick = () => openSidebar(d);
    container.appendChild(box);
  });
}

function updateStatuses() {
  // La fonction updateStatuses actuelle fait des fetch directs aux adresses des appareils (`http://${d.address}`)
  // pour simuler un ping. Ceci NE fonctionnera PAS depuis une page GitHub Pages
  // vers des adresses sur ton réseau local ou des adresses ddns.uqam.ca à cause de CORS
  // et du fait que ce sont des requêtes cross-origin depuis un contexte sécurisé (HTTPS GitHub Pages)
  // vers des contextes potentiellement non sécurisés (HTTP) ou des réseaux privés.

  // Pour que cela fonctionne avec GitHub Pages, la VÉRIFICATION DE STATUT doit être faite
  // par le BACKEND GO (ce que nous avons déjà implémenté avec checkDeviceStatus).
  // Le frontend (script.js) doit alors seulement RÉCUPÉRER les statuts mis à jour depuis le backend.

  // **Modification nécessaire pour updateStatuses avec GitHub Pages :**
  // Au lieu de faire des fetch directs, on devrait appeler /api/devices périodiquement
  // pour obtenir les statuts mis à jour par le serveur.
  // Ou, si fetchDevicesAndInitialize est appelé périodiquement, cela suffit.

  // Pour l'instant, je vais laisser la logique de PING CLIENT commentée
  // car elle ne fonctionnera pas de manière fiable depuis GitHub Pages vers tes appareils.
  // Le statut affiché dépendra de ce qui est récupéré par fetchDevicesAndInitialize
  // et mis à jour par le backend Go.

  // Si tu veux un rafraîchissement plus fréquent des données du backend sans recharger toute la page :
  // Il faudrait que fetchDevicesAndInitialize soit appelée périodiquement, 
  // ou un nouvel endpoint qui renvoie juste les mises à jour.
  // Pour la simplicité, on va se baser sur le fait que `startStatusScheduler` dans Go met à jour
  // `cachedDevices`, et `fetchDevicesAndInitialize` est appelé au chargement.
  // Pour un refresh, il faudrait appeler à nouveau fetchDevicesAndInitialize ou une partie.
  // console.log("Mise à jour des statuts visuels via fetchDevicesAndInitialize (si appelée périodiquement)");
  // Pour l'instant, cette fonction ne fera rien de plus si les pings client sont désactivés.
  // Les statuts seront ceux fournis par le backend lors du dernier fetchDevicesAndInitialize.
  // Le setInterval dans initializeMonitoring appelle déjà cette fonction updateStatuses, 
  // mais elle ne fait plus de pings client.
  
  // Pour un vrai rafraîchissement depuis le backend sans recharger toute la page :
  // On pourrait appeler à nouveau fetchDevicesAndInitialize (ou une version allégée)
  // mais cela re-remplirait les filtres, etc.
  // Pour le moment, le statut est mis à jour en mémoire par le backend Go.
  // Le frontend récupère cet état lors du chargement initial.
  // Pour voir les mises à jour du backend, il faudrait rafraîchir la page
  // OU que `fetchDevicesAndInitialize` soit appelée par un `setInterval`.

  // **Pour un vrai rafraîchissement des données sans recharger la page**
  // Il est mieux d'appeler fetchDevicesAndInitialize dans un intervalle
  // MAIS cela va recharger TOUTE la liste et potentiellement réinitialiser les filtres.
  // L'appel `updateStatuses` actuel dans `setInterval` ne fait plus de pings client,
  // donc il ne mettra pas à jour les couleurs à moins que `devices` soit mis à jour autrement.

  // **Action pour cette fonction `updateStatuses` quand servie depuis GitHub Pages :**
  // Elle devrait probablement être renommée et appeler `fetchDevicesAndInitialize`
  // pour récupérer l'état le plus récent du backend.
  // Cependant, pour éviter de re-créer les filtres à chaque fois, on pourrait
  // juste mettre à jour les données des `devices` et appeler `renderDevices()`.

  // **SOLUTION SIMPLIFIÉE pour l'instant pour le refresh depuis le backend :**
  // On va modifier `initializeMonitoring` pour appeler `fetchDevicesAndInitialize` périodiquement.
  // Et `updateStatuses` ne fera plus rien, car les pings client ne sont pas fiables ici.
  // La source de vérité pour le statut est le backend.
  // renderDevices(); // Juste pour s'assurer que l'affichage est à jour avec les données actuelles
}


// Modification dans initializeMonitoring pour rafraîchir depuis le backend
function initializeMonitoring() {
  console.log("🚀 Initialisation du monitoring...");
  // ... (code pour peupler les filtres, inchangé) ...
  const buildings = new Set();
  const techs = new Set();
  devices.forEach(d => {
    if (d.building) buildings.add(d.building);
    if (d.tech) techs.add(d.tech);
  });

  const buildingFilter = document.getElementById("filter-building");
  buildingFilter.innerHTML = '<option value="">Tous les pavillons</option>';
  buildings.forEach(b => {
    const o = document.createElement('option');
    o.value = b; o.textContent = `Pavillon ${b}`;
    buildingFilter.appendChild(o);
  });

  const techFilter = document.getElementById("filter-tech");
  techFilter.innerHTML = '<option value="">Toutes les technologies</option>';
  techs.forEach(t => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    techFilter.appendChild(o);
  });
  console.log("🔩 Filtres peuplés.");

  const rebootButtonElement = document.querySelector('#sidebar button.btn:nth-of-type(2)');
  if (rebootButtonElement && rebootButtonElement.innerText.toLowerCase().includes('rebooter')) {
      rebootButtonElement.classList.add('reboot-btn'); 
  }
  // Fin du code pour peupler les filtres

  resolveAllIPs(() => { // Ceci appelle le backend pour les IPs
    console.log("📞 Résolution IP initiale terminée.");
    // fetchDevicesAndInitialize a déjà été appelé une fois et a appelé renderDevices via initializeMonitoring.
    // Maintenant, nous allons rafraîchir les données des appareils (qui incluent les statuts mis à jour par le backend Go)
    // périodiquement.
  }, false);

  // Remplacer l'ancien setInterval(updateStatuses, ...)
  // par un appel périodique à une fonction qui rafraîchit les données du backend.
  setInterval(async () => {
    console.log("🔄 Rafraîchissement des données des appareils depuis le backend...");
    try {
      const response = await fetch(`${backendBaseUrl}/api/devices`);
      if (!response.ok) {
        console.error(`Erreur HTTP ${response.status} lors du rafraîchissement des appareils.`);
        return; // Ne pas continuer si erreur
      }
      const loadedDevices = await response.json();
      // Fusionner intelligemment les nouvelles données avec les anciennes pour ne pas perdre l'état de `isRebooting` du client
      devices.forEach(existingDevice => {
        const updatedDeviceData = loadedDevices.find(ld => ld.address === existingDevice.address);
        if (updatedDeviceData) {
          existingDevice.status = updatedDeviceData.status;
          existingDevice.ip = updatedDeviceData.ip || existingDevice.ip; // Garder l'IP si la nouvelle est nulle
          existingDevice.lastSeen = updatedDeviceData.lastSeen;
          // Ne pas écraser isRebooting ou rebootInitiatedAt ici, car géré par le client pour le visuel du reboot
        }
      });
      // Ajouter les nouveaux appareils qui n'existaient pas
      loadedDevices.forEach(ld => {
        if (!devices.some(d => d.address === ld.address)) {
          devices.push({ // S'assurer d'initialiser les champs client
            ...ld,
            isRebooting: false,
            rebootInitiatedAt: null
          });
        }
      });
      // Supprimer les appareils qui n'existent plus dans la source
      devices = devices.filter(d => loadedDevices.some(ld => ld.address === d.address));


      renderDevices(); // Mettre à jour l'affichage avec les nouveaux statuts
    } catch (error) {
      console.error("❌ Erreur lors du rafraîchissement des appareils depuis le backend:", error);
    }
  }, 7000); // Rafraîchir les données du backend toutes les 7 secondes

  setInterval(() => resolveAllIPs(null, true), 300000); // Résolution IP toutes les 5 minutes (inchangé)

  ["search", "filter-building", "filter-tech", "filter-status"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(id === "search" ? "input" : "change", renderDevices);
  });
  console.log("👂 Écouteurs d'événements pour les filtres activés.");
}
// La fonction updateStatuses originale (avec les pings client) est maintenant effectivement remplacée
// par la logique de rafraîchissement dans setInterval de initializeMonitoring.


function openSidebar(d) {
  currentDevice = d; 
  document.getElementById("detail-name").innerText = d.name;
  document.getElementById("detail-ip").innerText   = d.ip   || "Inconnu";
  document.getElementById("detail-mac").innerText  = d.mac;
  document.getElementById("detail-time").innerText = d.lastSeen || "Non testé"; // lastSeen vient du backend
  document.getElementById("detail-link").href      = `http://${d.address}`;

  const rebootButton = document.querySelector('#sidebar .reboot-btn');
  if (rebootButton) {
    rebootButton.disabled = !!d.isRebooting; 
  }
  document.getElementById("sidebar").classList.add("open");
}
function closeSidebar() { 
  document.getElementById("sidebar").classList.remove("open"); 
}
function copyToClipboard(id) {
  navigator.clipboard.writeText(document.getElementById(id).innerText)
    .then(() => console.log(`📋 Copié: ${document.getElementById(id).innerText}`))
    .catch(err => console.error('❌ Erreur copie:', err));
}

function rebootDevice() {
  if (!currentDevice) {
    console.warn("Tentative de reboot sans appareil sélectionné.");
    return;
  }
  if (currentDevice.isRebooting) {
    console.log(`ℹ️ Reboot pour ${currentDevice.name} déjà en cours. Ignoré.`);
    return;
  }

  const deviceToReboot = currentDevice; 
  console.log(`⚙️ Tentative de reboot pour ${deviceToReboot.name} (${deviceToReboot.address})`);
  
  const rebootButton = document.querySelector('#sidebar .reboot-btn');
  if (rebootButton) rebootButton.disabled = true;
  
  deviceToReboot.isRebooting = true; 
  deviceToReboot.rebootInitiatedAt = new Date().getTime();
  renderDevices(); 

  // MODIFICATION : Utiliser backendBaseUrl
  fetch(`${backendBaseUrl}/reboot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host: deviceToReboot.address })
  }).then(r => {
    if (!r.ok) return r.json().then(eD => { throw new Error(`Erreur serveur ${r.status}: ${eD.error||'Erreur inconnue'}`) }).catch(()=> {throw new Error(`Erreur serveur ${r.status}`)});
    return r.json();
  }).then(resp => {
    if (!resp.success) throw new Error(resp.error || "Échec de la commande de reboot côté backend");
    alert(`✅ Commande de reboot envoyée pour ${deviceToReboot.name} !`);
    console.log(`🎉 Commande reboot pour ${deviceToReboot.address} envoyée. Output du script:`, resp.output);
    // Pas besoin de forcer updateStatuses ici, le setInterval le fera.
    // On peut vouloir un fetch immédiat pour refléter le statut "rebooting" du serveur
    setTimeout(async () => {
        const response = await fetch(`${backendBaseUrl}/api/devices`);
        const loadedDevices = await response.json();
        const updatedDeviceData = loadedDevices.find(ld => ld.address === deviceToReboot.address);
        if (updatedDeviceData) {
            deviceToReboot.status = updatedDeviceData.status; // Mettre à jour avec le statut du serveur
        }
        renderDevices();
    }, 5000); // Attendre un peu que le serveur ait pu marquer en rebooting

  }).catch(e => {
    alert(`❌ Échec envoi commande reboot pour ${deviceToReboot.name}: ` + e.message);
    console.error(`💥 Échec requête reboot pour ${deviceToReboot.address}: `, e.message);
    // Remettre isRebooting à false si la commande elle-même échoue (avant même d'atteindre le serveur ou si le serveur rejette)
    deviceToReboot.isRebooting = false;
    delete deviceToReboot.rebootInitiatedAt;
    if (rebootButton) rebootButton.disabled = false; // Réactiver le bouton immédiatement
    renderDevices();
  }).finally(() => {
      setTimeout(() => {
          if (rebootButton && deviceToReboot.isRebooting) { 
            console.warn(`Bouton de reboot pour ${deviceToReboot.name} réactivé (timeout de sécurité). isRebooting est toujours ${deviceToReboot.isRebooting}. Vérifier l'état de l'appareil.`);
            rebootButton.disabled = false; 
          } else if (rebootButton && !deviceToReboot.isRebooting) {
            // Si le reboot est terminé (isRebooting = false), le bouton est déjà réactivé par openSidebar
            // mais on s'assure qu'il l'est.
             if (currentDevice && currentDevice.address === deviceToReboot.address) { // Seulement si c'est toujours l'appareil courant
                rebootButton.disabled = false;
             }
          }
      }, 90000); 
  });
}

window.onload = () => {
  fetchDevicesAndInitialize();
};
