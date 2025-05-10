// script.js

let currentDevice = null;
let devices = []; // Initialiser comme un tableau vide

async function fetchDevicesAndInitialize() {
  try {
    const response = await fetch('http://localhost:5050/api/devices');
    if (!response.ok) {
      throw new Error(`Erreur HTTP ${response.status} lors de la récupération des appareils`);
    }
    const loadedDevices = await response.json();
    devices = loadedDevices.map(d => ({
      ...d, // Garder les propriétés du CSV
      ip: d.ip || null, // S'assurer que les champs dynamiques existent
      status: d.status || null,
      rebootInitiatedAt: d.rebootInitiatedAt || null,
      isRebooting: d.isRebooting || false,
      lastSeen: d.lastSeen || null
    }));
    console.log("✅ Appareils chargés depuis le backend:", devices);
  } catch (error) {
    console.error("❌ Impossible de charger la liste des appareils depuis le backend:", error);
    alert("Erreur: Impossible de charger la liste des appareils. Vérifiez la console du backend et que le fichier appareils.csv existe et est correct.");
    devices = []; // Utiliser une liste vide en cas d'échec pour éviter d'autres erreurs
  }
  initializeMonitoring(); // Appeler même si devices est vide, pour que les listeners soient attachés
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
    updateStatuses(); // Premier appel immédiat
    setInterval(updateStatuses, 7000); // Pings toutes les 7 secondes
    setInterval(() => resolveAllIPs(null, true), 300000); // Résolution IP toutes les 5 minutes
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
    fetch(`http://localhost:5050/resolve?host=${device.address}`)
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
  if (!container) return; // S'assurer que le container existe
  container.innerHTML = "";
  
  const search = document.getElementById("search").value.toLowerCase();
  const fb = document.getElementById("filter-building").value;
  const ft = document.getElementById("filter-tech").value;
  const fsVal = document.getElementById("filter-status").value;

  devices.forEach(d => {
    // Pour le rendu, si isRebooting est true, currentStatus est "rebooting"
    // Sinon, c'est d.status (qui pourrait être null/undefined initialement)
    const currentStatus = d.isRebooting ? "rebooting" : (d.status || "offline");

    // Si le filtre de statut est actif et ne correspond pas
    if (fsVal && currentStatus !== fsVal) return;
    
    // Ne pas afficher si le statut est null et qu'il n'est pas en reboot (attente du premier ping)
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
  const globalCurrentTime = new Date().getTime(); // Nom différent pour éviter confusion
  let devicesToUpdate = devices.length;
  if (devicesToUpdate === 0) { 
    renderDevices(); 
    return; 
  }

  devices.forEach(d => {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 3500); // Augmenté légèrement le timeout du fetch

    // Conserver le statut précédent pour le logging
    const previousVisualStatus = d.isRebooting ? "rebooting" : d.status;

    fetch(`http://${d.address}`, { signal: ctrl.signal, mode: "no-cors", cache: "no-store", headers: { 'Cache-Control': 'no-cache' } })
      .then(() => { // Ping réussi
        d.lastSeen = new Date().toLocaleTimeString();
        
        if (d.isRebooting) {
          const minRebootDowntime = 10000; // Doit être offline pendant au moins 10s après l'initiation du reboot
          const maxRebootVisualTime = 90000; // Temps max pour le statut "rebooting" visuel (90s)

          // Si le ping réussit MAIS qu'on est dans la période où il DEVRAIT être en train de tomber (ou juste après),
          // on attend encore un peu avant de le déclarer online pour éviter le flash vert.
          if (d.rebootInitiatedAt && (globalCurrentTime - d.rebootInitiatedAt < minRebootDowntime)) {
            // Il pingue trop tôt après la commande de reboot. On IGNORE ce ping réussi
            // et on le laisse visuellement en "rebooting".
            // console.log(`ℹ️ ${d.name} pingue encore (trop tôt après reboot). Reste visuellement 'rebooting'.`);
          } else if (d.rebootInitiatedAt && (globalCurrentTime - d.rebootInitiatedAt < maxRebootVisualTime)) {
            // Il a re-pingé, et on est après la période minRebootDowntime.
            // On peut le considérer comme revenu.
            d.status = "online";
            if (previousVisualStatus !== "online") { // Log seulement si changement réel de statut sous-jacent
                console.log(`✔️ ${d.name} (${d.address}) est revenu en ligne (était ${previousVisualStatus}). Fin du reboot.`);
            }
            delete d.rebootInitiatedAt;
            d.isRebooting = false;
          } else { // Fin de la période max de reboot visuel, ou rebootInitiatedAt manquant
            d.status = "online";
            if (d.isRebooting) console.log(`✔️ ${d.name} (${d.address}) est maintenant en ligne (timeout visuel reboot).`);
            delete d.rebootInitiatedAt;
            d.isRebooting = false;
          }
        } else { // Si n'était pas en reboot (isRebooting = false)
            if (d.status !== "online") { // Si était offline ou autre
                d.status = "online";
                console.log(`✔️ ${d.name} (${d.address}) est maintenant en ligne (était ${previousVisualStatus || 'inconnu'}).`);
            }
        }
      })
      .catch(err => { // Ping échoué
        d.lastSeen = new Date().toLocaleTimeString();
        if (!d.isRebooting) { 
            if (d.status !== "offline") {
                d.status = "offline";
                console.log(`❌ ${d.name} (${d.address}) est maintenant hors ligne (était ${previousVisualStatus || 'inconnu'}).`);
            }
        } else { 
            // Si le ping échoue et qu'il est en reboot (isRebooting = true), c'est normal.
            // On le laisse 'isRebooting' et son d.status sous-jacent (qui était 'online' avant le reboot) ne change pas.
            // On attend qu'il revienne ou que le timeout maxRebootTime soit dépassé.
            const maxRebootCompletionTime = 5 * 60 * 1000; // 5 minutes pour qu'un reboot se termine
            if (d.rebootInitiatedAt && (globalCurrentTime - d.rebootInitiatedAt > maxRebootCompletionTime)) {
                console.warn(`⚠️ ${d.name} en reboot depuis trop longtemps (ping échoué), passage à offline.`);
                d.status = "offline"; // Forcer offline
                delete d.rebootInitiatedAt;
                d.isRebooting = false;
            } else {
                // console.log(`ℹ️ ${d.name} est en cours de reboot et ne pingue pas (normal).`);
            }
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
        devicesToUpdate--;
        if (devicesToUpdate === 0) {
          renderDevices();
        }
      });
  });
}

function openSidebar(d) {
  currentDevice = d; 
  document.getElementById("detail-name").innerText = d.name;
  document.getElementById("detail-ip").innerText   = d.ip   || "Inconnu";
  document.getElementById("detail-mac").innerText  = d.mac;
  document.getElementById("detail-time").innerText = d.lastSeen || "Non testé";
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
  // Le statut sous-jacent (d.status) n'est pas changé ici, il était probablement 'online'.
  // renderDevices() va maintenant utiliser deviceToReboot.isRebooting pour afficher "rebooting"
  renderDevices(); // Mettre à jour l'affichage immédiatement

  fetch("http://localhost:5050/reboot", {
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
    // Lancer des mises à jour de statut plus fréquentes juste après un reboot
    setTimeout(updateStatuses, 5000);  // Après 5s
    setTimeout(updateStatuses, 15000); // Après 15s (pour attraper le down)
    setTimeout(updateStatuses, 30000); // Après 30s 
    setTimeout(updateStatuses, 60000); // Après 60s (pour attraper le up)
  }).catch(e => {
    alert(`❌ Échec envoi commande reboot pour ${deviceToReboot.name}: ` + e.message);
    console.error(`💥 Échec requête reboot pour ${deviceToReboot.address}: `, e.message);
    // Si la commande échoue, on peut décider de retirer le flag isRebooting
    // ou le laisser pour que updateStatuses le gère via timeout.
    // Pour l'instant, laissons updateStatuses gérer.
    // deviceToReboot.isRebooting = false;
    // delete deviceToReboot.rebootInitiatedAt;
    // renderDevices(); // Mettre à jour l'affichage si on change isRebooting ici
  }).finally(() => {
      // Le bouton sera réactivé par openSidebar en fonction de d.isRebooting
      // ou on peut forcer une réactivation après un certain délai si le flag persiste anormalement
      setTimeout(() => {
          if (rebootButton && deviceToReboot.isRebooting) { 
            console.warn(`Bouton de reboot pour ${deviceToReboot.name} réactivé (timeout de sécurité). isRebooting est toujours ${deviceToReboot.isRebooting}. Vérifier l'état de l'appareil.`);
            rebootButton.disabled = false; // Réactiver s'il est toujours bloqué
          } else if (rebootButton && !deviceToReboot.isRebooting) {
            rebootButton.disabled = false; // Normalement déjà fait par openSidebar si on reclique
          }
      }, 90000); // Réactiver après 90 secondes au cas où
  });
}

window.onload = () => {
  fetchDevicesAndInitialize();
};