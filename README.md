# Moniteur AV Go (BYOD Monitor Go)

Ce projet est un backend en Go avec une interface web simple pour surveiller l'état d'appareils audiovisuels (VIA, Mersive, etc.) sur le réseau et permettre leur redémarrage à distance via Puppeteer. Les données de statut sont également stockées dans InfluxDB pour une visualisation potentielle avec Grafana.

## Fonctionnalités

*   Affichage en temps réel du statut (online/offline) des appareils configurés.
*   Résolution DNS des noms d'hôtes des appareils.
*   Redémarrage à distance des appareils VIA via une simulation d'interface web avec Puppeteer.
*   Collecte et stockage des statuts (online/offline, latence) dans InfluxDB v3.
*   Interface web simple pour visualiser les appareils et initier les actions.

## Prérequis

*   **Go** (version 1.18 ou plus récente recommandée)
*   **Node.js** (version 16 ou plus récente recommandée, pour l'exécution du script Puppeteer)
    *   Puppeteer sera installé localement par le script si nécessaire, ou vous pouvez l'installer globalement.
*   **InfluxDB v3 OSS Core** installé et en cours d'exécution.
    *   Instructions d'installation : [Lien vers la doc InfluxDB v3 si vous en avez un]
    *   Assurez-vous de le lancer en mode sans authentification pour un usage local simplifié (voir section Configuration InfluxDB).
*   Un navigateur web moderne.

## Configuration

1.  **Cloner le dépôt (si ce n'est pas déjà fait) :**
    ```bash
    git clone https://github.com/Zine76/byod-monitor-go.git
    cd byod-monitor-go
    ```

2.  **Fichier des appareils (`appareils.csv`) :**
    *   Copiez le fichier d'exemple `appareils.example.csv` en `appareils.csv` à la racine du projet :
        ```bash
        cp appareils.example.csv appareils.csv
        ```
    *   Modifiez `appareils.csv` pour y lister vos appareils réels avec les colonnes : `Nom,Adresse,MAC,Pavillon,Technologie`.

3.  **Variables d'environnement (`.env`) :**
    *   Copiez le fichier d'exemple `.env.example` en `.env` à la racine du projet :
        ```bash
        cp .env.example .env 
        ``` 
        *(Note : Si vous n'avez pas de `.env.example` commité, créez `.env` manuellement).*
    *   Modifiez le fichier `.env` avec vos informations :
        ```env
        # Identifiants pour les appareils VIA
        VIA_USERNAME="votre_utilisateur_via"
        VIA_PASSWORD="votre_mot_de_passe_via"

        # Configuration pour InfluxDB v3
        # (Assurez-vous qu'InfluxDB tourne sur le port 8181 et en mode --without-auth)
        INFLUXDB_URL="http://localhost:8181"
        INFLUXDB_TOKEN="" 
        INFLUXDB_ORG="" # Peut être vide ou une valeur factice comme "-"
        INFLUXDB_BUCKET="byod_monitoring" # Ou le nom de la base de données InfluxDB créée
        ```

4.  **Base de Données InfluxDB :**
    *   Assurez-vous que votre instance InfluxDB v3 OSS Core est lancée (par exemple, avec la commande que nous avons trouvée) :
        ```bash
        # Depuis le dossier d'installation d'InfluxDB
        ./influxdb3.exe serve --node-id node1 --object-store file --data-dir "CHEMIN_VERS_VOS_DONNEES_INFLUXDB" --without-auth
        ```
    *   Créez la base de données (bucket) dans InfluxDB si ce n'est pas déjà fait (depuis un autre terminal) :
        ```bash
        # Depuis le dossier d'installation d'InfluxDB
        ./influxdb3.exe create database byod_monitoring 
        ```
        (Remplacez `byod_monitoring` par le nom que vous avez mis dans `INFLUXDB_BUCKET`).

5.  **Dépendances Go :**
    *   Naviguez vers le dossier du projet et exécutez :
        ```bash
        go mod tidy
        ```
        Cela téléchargera les dépendances Go nécessaires (comme le client InfluxDB et godotenv).

6.  **Dépendance Puppeteer (pour le script de reboot) :**
    *   Le script `reboot-via-puppeteer.js` nécessite `puppeteer`. Si vous n'avez pas Puppeteer installé de manière accessible par Node.js, vous pourriez avoir besoin de l'installer dans un contexte où Node peut le trouver. Pour un projet simple, vous pouvez l'installer globalement (non idéal pour la portabilité) ou créer un mini `package.json` à la racine et faire `npm install puppeteer`.
    *   Pour l'instant, le script suppose que `require('puppeteer')` fonctionne.

## Lancement de l'application

1.  **Assurez-vous que votre serveur InfluxDB v3 est en cours d'exécution.**
2.  **Ouvrez un terminal à la racine du projet `byod-monitor-go`.**
3.  **Lancez le backend Go :**
    ```bash
    go run main.go
    ```
    Vous devriez voir des logs indiquant que le serveur est actif sur `http://localhost:5050`.

4.  **Accédez à l'interface web :**
    Ouvrez votre navigateur et allez à l'adresse `http://localhost:5050`.

## TODO / Améliorations Possibles

*   [ ] Authentification Microsoft pour sécuriser l'accès.
*   [ ] Interface d'administration pour gérer la liste des appareils (au lieu du CSV).
*   [ ] Visualisation des données InfluxDB avec Grafana.
*   [ ] Améliorer la robustesse des pings serveur.
*   [ ] Gestion plus fine des erreurs et des logs.

---
*Ce projet est à des fins de démonstration et d'apprentissage.*
