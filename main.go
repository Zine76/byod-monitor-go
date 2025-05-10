package main

import (
	"bytes"
	"context" // Nécessaire pour le client InfluxDB
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	// Ces lignes importent les packages nécessaires.
	// Si Go se plaint qu'ils sont manquants, `go mod tidy` ou `go get ...` les installera.
	influxdb2 "github.com/influxdata/influxdb-client-go/v2"
	"github.com/influxdata/influxdb-client-go/v2/api" // Fait partie du client v2
	"github.com/joho/godotenv"
)

type Device struct {
	Name              string `json:"name"`
	Address           string `json:"address"`
	MAC               string `json:"mac"`
	Building          string `json:"building"`
	Tech              string `json:"tech"`
	IP                string `json:"ip,omitempty"`
	RebootInitiatedAt int64  `json:"rebootInitiatedAt,omitempty"`
	IsRebooting       bool   `json:"isRebooting"`
	Status            string `json:"status,omitempty"`
	LastSeen          string `json:"lastSeen,omitempty"`
	LatencyMs         int64  `json:"latencyMs,omitempty"`
}

type RebootRequest struct {
	Host string `json:"host"`
}

var cachedDevices []Device
var devicesMutex = &sync.RWMutex{}
var viaUsername string
var viaPassword string

var influxClient influxdb2.Client
var influxWriteAPI api.WriteAPIBlocking
var influxOrg string
var influxBucket string

func loadDevicesFromCSV() error {
	csvFilePath := filepath.Join(".", "appareils.csv")
	file, err := os.Open(csvFilePath)
	if err != nil {
		log.Printf("❌ ERREUR CRITIQUE: Le fichier appareils.csv est introuvable à l'emplacement: %s", csvFilePath)
		return fmt.Errorf("fichier appareils.csv manquant: %w", err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	reader.Comma = ','
	header, err := reader.Read()
	if err != nil {
		return fmt.Errorf("erreur lecture en-tête CSV: %w", err)
	}
	colIndex := make(map[string]int)
	expectedHeaders := []string{"Nom", "Adresse", "MAC", "Pavillon", "Technologie"}
	for i, h := range header {
		colIndex[strings.TrimSpace(h)] = i
	}
	for _, expected := range expectedHeaders {
		if _, ok := colIndex[expected]; !ok {
			return fmt.Errorf("en-tête CSV manquant: %s. En-têtes trouvés: %v", expected, header)
		}
	}
	records, err := reader.ReadAll()
	if err != nil {
		return fmt.Errorf("erreur lecture des enregistrements CSV: %w", err)
	}

	devicesMutex.Lock()
	defer devicesMutex.Unlock()
	var tempDevices []Device
	for lineNum, record := range records {
		if len(record) < len(header) {
			log.Printf("⚠️ Ligne %d ignorée dans appareils.csv (colonnes incorrectes): %v", lineNum+2, record)
			continue
		}
		device := Device{
			Name:     strings.TrimSpace(record[colIndex["Nom"]]),
			Address:  strings.TrimSpace(record[colIndex["Adresse"]]),
			MAC:      strings.TrimSpace(record[colIndex["MAC"]]),
			Building: strings.TrimSpace(record[colIndex["Pavillon"]]),
			Tech:     strings.TrimSpace(record[colIndex["Technologie"]]),
			Status:   "checking",
		}
		if device.Name == "" || device.Address == "" || device.MAC == "" || device.Building == "" || device.Tech == "" {
			log.Printf("⚠️ Ligne %d ignorée (données manquantes): %+v", lineNum+2, device)
			continue
		}
		tempDevices = append(tempDevices, device)
	}
	cachedDevices = tempDevices
	log.Printf("✅ %d appareils chargés depuis appareils.csv", len(cachedDevices))
	return nil
}

func devicesHandler(w http.ResponseWriter, r *http.Request) {
	devicesMutex.RLock()
	defer devicesMutex.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cachedDevices)
}

func resolveHandler(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	if host == "" {
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"success": false, "error": "Hostname manquant"}`, http.StatusBadRequest)
		return
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		log.Printf("⚠️ Erreur DNS pour %s: %v", host, err)
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, fmt.Sprintf(`{"success": false, "error": "Erreur DNS", "details": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	if len(ips) == 0 {
		log.Printf("⚠️ Aucune IP pour %s", host)
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"success": false, "error": "Aucune IP trouvée"}`, http.StatusNotFound)
		return
	}
	var ipAddress string
	var family int = 4
	for _, ip := range ips {
		if ip.To4() != nil {
			ipAddress = ip.String()
			family = 4
			break
		}
	}
	if ipAddress == "" && len(ips) > 0 {
		ipAddress = ips[0].String()
		if ips[0].To4() == nil {
			family = 6
		}
	}
	response := map[string]interface{}{"success": true, "hostname": host, "address": ipAddress, "family": family}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func checkDeviceStatus(device *Device) {
	portsToTry := []string{"80", "443"}
	var connected bool = false
	var latency time.Duration
	var currentStatus string
	var currentLatencyMs int64

	startTime := time.Now()
	for _, port := range portsToTry {
		conn, err := net.DialTimeout("tcp", net.JoinHostPort(device.Address, port), 3*time.Second)
		if err == nil {
			conn.Close()
			connected = true
			latency = time.Since(startTime)
			break
		}
	}

	currentTimeStr := time.Now().Format(time.RFC1123)
	if connected {
		currentStatus = "online"
		currentLatencyMs = latency.Milliseconds()
	} else {
		currentStatus = "offline"
		currentLatencyMs = 0
	}

	devicesMutex.Lock()
	device.Status = currentStatus
	device.LatencyMs = currentLatencyMs
	device.LastSeen = currentTimeStr
	deviceName := device.Name
	deviceAddressForTag := device.Address
	deviceBuilding := device.Building
	deviceTech := device.Tech
	devicesMutex.Unlock()

	if influxWriteAPI != nil {
		p := influxdb2.NewPointWithMeasurement("device_reachability").
			AddTag("deviceName", deviceName).
			AddTag("deviceAddress", deviceAddressForTag).
			AddTag("building", deviceBuilding).
			AddTag("tech", deviceTech).
			AddField("status_str", currentStatus).
			AddField("status", boolToInt(currentStatus == "online")).
			AddField("latency_ms", currentLatencyMs).
			SetTime(time.Now())

		err := influxWriteAPI.WritePoint(context.Background(), p)
		if err != nil {
			log.Printf("❌ Erreur écriture InfluxDB pour %s: %v", deviceName, err)
		} else {
			log.Printf("✅ Écrit dans InfluxDB pour %s: status=%s, latency=%dms", deviceName, currentStatus, currentLatencyMs)
		}
	}
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func startStatusScheduler() {
	log.Println("ℹ️ Démarrage du planificateur de vérification des statuts...")
	ticker := time.NewTicker(10 * time.Second)
	go func() {
		time.Sleep(2 * time.Second) // Petit délai avant le premier cycle
		log.Println("⚙️ Premier cycle de vérification des statuts...")
		performStatusChecks()
		for range ticker.C {
			performStatusChecks()
		}
	}()
}

func performStatusChecks() {
	devicesMutex.RLock()
	var devicesToCheck []*Device
	for i := range cachedDevices {
		devicesToCheck = append(devicesToCheck, &cachedDevices[i])
	}
	devicesMutex.RUnlock()

	var wg sync.WaitGroup
	for _, dPtr := range devicesToCheck {
		wg.Add(1)
		go func(dev *Device) {
			defer wg.Done()
			checkDeviceStatus(dev)
		}(dPtr)
	}
	wg.Wait()
	// log.Println("✅ Cycle de vérification des statuts terminé.")
}

func rebootDeviceViaPuppeteer(host, deviceTech string) (string, error) {
	scriptPath := filepath.Join(".", "reboot-via-puppeteer.js")
	var cmdUser, cmdPass string
	if strings.ToUpper(deviceTech) == "VIA" {
		if viaUsername == "" || viaPassword == "" {
			return "", fmt.Errorf("identifiants VIA non configurés")
		}
		cmdUser = viaUsername
		cmdPass = viaPassword
	} else { // Logique simplifiée, étendre si besoin pour d'autres technos
		return "", fmt.Errorf("reboot pour tech %s non supporté via Puppeteer", deviceTech)
	}

	log.Printf("ℹ️ Lancement Puppeteer pour %s (Tech: %s)", host, deviceTech)
	cmd := exec.Command("node", scriptPath, host, cmdUser, cmdPass)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()

	// Log stdout/stderr systématiquement
	if stdout.Len() > 0 {
		log.Printf("Stdout Puppeteer pour %s:\n%s", host, stdout.String())
	}
	if stderr.Len() > 0 {
		log.Printf("Stderr Puppeteer pour %s:\n%s", host, stderr.String())
	}

	if err != nil {
		log.Printf("❌ Erreur exécution Puppeteer pour %s: %v", host, err)
		return "", fmt.Errorf("échec script reboot (Puppeteer): %v. Stderr: %s", err, strings.TrimSpace(stderr.String()))
	}
	log.Printf("✅ Script Puppeteer OK pour %s.", host)
	return strings.TrimSpace(stdout.String()), nil
}

func rebootHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"success": false, "error": "Méthode non autorisée"}`, http.StatusMethodNotAllowed)
		return
	}
	var reqBody RebootRequest
	err := json.NewDecoder(r.Body).Decode(&reqBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"success": false, "error": "Corps de requête invalide"}`, http.StatusBadRequest)
		return
	}
	defer r.Body.Close()
	if reqBody.Host == "" {
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"success": false, "error": "host manquant"}`, http.StatusBadRequest)
		return
	}

	var deviceToReboot *Device
	var deviceTech string
	found := false
	devicesMutex.Lock() // Verrouiller pour chercher et modifier
	for i := range cachedDevices {
		if cachedDevices[i].Address == reqBody.Host {
			deviceToReboot = &cachedDevices[i]
			deviceTech = cachedDevices[i].Tech
			found = true
			break
		}
	}
	if !found {
		devicesMutex.Unlock()
		log.Printf("⚠️ Reboot appareil inconnu: %s", reqBody.Host)
		http.Error(w, fmt.Sprintf(`{"success": false, "error": "Appareil %s non trouvé"}`, reqBody.Host), http.StatusNotFound)
		return
	}
	if strings.ToUpper(deviceTech) != "VIA" {
		devicesMutex.Unlock()
		log.Printf("⚠️ Reboot non-VIA rejeté: %s (%s)", reqBody.Host, deviceTech)
		http.Error(w, fmt.Sprintf(`{"success": false, "error": "Reboot pour %s non supporté"}`, deviceTech), http.StatusBadRequest)
		return
	}
	deviceToReboot.IsRebooting = true
	deviceToReboot.RebootInitiatedAt = time.Now().UnixNano() / int64(time.Millisecond)
	deviceToReboot.Status = "rebooting" // Statut serveur
	devicesMutex.Unlock()               // Déverrouiller avant appel bloquant

	log.Printf("🔁 Reboot demandé pour %s (Tech: %s).", reqBody.Host, deviceTech)
	output, err := rebootDeviceViaPuppeteer(reqBody.Host, deviceTech)

	devicesMutex.Lock() // Reverrouiller pour mettre à jour après l'appel
	if deviceToReboot != nil {
		deviceToReboot.IsRebooting = false // Le serveur ne le considère plus activement en reboot
	}
	devicesMutex.Unlock()

	if err != nil {
		log.Printf("🚨 Erreur reboot %s: %v", reqBody.Host, err)
		http.Error(w, fmt.Sprintf(`{"success": false, "error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	response := map[string]interface{}{"success": true, "status": http.StatusOK, "message": "Reboot initié.", "output": output}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Println("Info: Fichier .env non trouvé/erreur chargement. Variables système seront utilisées si dispo.")
	}
	viaUsername = os.Getenv("VIA_USERNAME")
	viaPassword = os.Getenv("VIA_PASSWORD")
	if viaUsername == "" || viaPassword == "" {
		log.Println("⚠️ AVERTISSEMENT: VIA_USERNAME/VIA_PASSWORD non configurés.")
	} else {
		log.Println("✅ Identifiants VIA chargés.")
	}

	influxURL := os.Getenv("INFLUXDB_URL")
	influxToken := os.Getenv("INFLUXDB_TOKEN") // Sera vide pour --without-auth
	influxOrg = os.Getenv("INFLUXDB_ORG")      // Peut être vide ou factice
	influxBucket = os.Getenv("INFLUXDB_BUCKET")

	if influxURL == "" || influxBucket == "" {
		log.Println("⚠️ AVERTISSEMENT: Config InfluxDB (URL, BUCKET) incomplète. Données non stockées.")
		// influxWriteAPI restera nil
	} else {
		currentInfluxOrg := influxOrg
		if currentInfluxOrg == "" {
			currentInfluxOrg = "-" // Valeur factice pour satisfaire le client v2 si l'org est vide
			log.Println("ℹ️ INFLUXDB_ORG non défini, utilisation de '-' pour le client InfluxDB v2.")
		}
		influxClient = influxdb2.NewClient(influxURL, influxToken)
		influxWriteAPI = influxClient.WriteAPIBlocking(currentInfluxOrg, influxBucket)
		// Test de connexion optionnel (peut être ajouté ici si souhaité)
		// _, healthErr := influxClient.Health(context.Background())
		// if healthErr != nil {
		//    log.Printf("❌ Erreur connexion InfluxDB: %v. Les écritures échoueront.", healthErr)
		//    influxWriteAPI = nil // Empêcher les tentatives d'écriture
		// } else {
		//    log.Println("✅ Connecté à InfluxDB (Health check OK).")
		// }
		log.Println("✅ Client InfluxDB initialisé (connexion sera tentée à la première écriture).")

	}
	defer func() {
		if influxClient != nil {
			influxClient.Close()
			log.Println("ℹ️ Client InfluxDB fermé.")
		}
	}()

	if err := loadDevicesFromCSV(); err != nil {
		log.Fatalf("❌ Serveur ne peut démarrer (CSV): %v", err)
	}
	startStatusScheduler()

	mux := http.NewServeMux()
	fileServer := http.FileServer(http.Dir("./client"))
	mux.Handle("/", fileServer)
	mux.HandleFunc("/api/devices", devicesHandler)
	mux.HandleFunc("/resolve", resolveHandler)
	mux.HandleFunc("/reboot", rebootHandler)
	port := "5050"
	log.Printf("✅ Backend Go actif sur http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, enableCORS(mux)); err != nil {
		log.Fatalf("❌ Erreur démarrage serveur: %v", err)
	}
}

func enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}
