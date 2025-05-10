// reboot-via-puppeteer.js
const puppeteer = require('puppeteer');
const fs =require('fs');
const path =require('path');

(async () => {
  const host = process.argv[2];
  const usernameArg = process.argv[3];
  const passwordArg = process.argv[4];
  const safeHostName = host ? host.replace(/[^a-z0-9.-]/gi, '_') : 'unknown_host';

  if (!host || !usernameArg || !passwordArg ) {
    console.error(`[${host}] ❌ Args manquants: node reboot-via-puppeteer.js <host> <user> <pass>`);
    process.exit(1);
  }

  const loginAttemptUrls = [
    `https://${host}/index/login`,    // Tenter cette URL en premier (pour type F-5160)
    `https://${host}/viaIndex/login`  // Fallback pour l'ancienne URL (type AB-9350)
  ];

  let browser;
  let loginSuccess = false;
  let pageUrlAfterLogin = '';

  console.log(`[${host}] Script Puppeteer démarré.`);

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors', '--disable-gpu', '--disable-dev-shm-usage'],
      timeout: 60000, // Timeout global pour le lancement du navigateur
    });
    console.log(`[${host}] Navigateur lancé.`);

    const page = await browser.newPage();
    console.log(`[${host}] Nouvelle page ouverte.`);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-CA,fr;q=0.9,en;q=0.8' });
    page.setDefaultNavigationTimeout(60000); // Timeout pour les navigations de page

    const usernameSelector = 'input[name="login_name"]';
    const passwordSelector = 'input[name="login_password"]';
    const submitSelector = 'input#btnLogin';

    for (const loginUrl of loginAttemptUrls) {
      try {
        console.log(`[${host}] Tentative de navigation et login sur ${loginUrl}...`);
        await page.goto(loginUrl, { waitUntil: 'networkidle0', timeout: 30000 }); // Timeout spécifique pour goto
        const currentPageUrl = page.url();
        console.log(`[${host}] Page ${currentPageUrl} chargée.`);

        const isLikelyLoginPage = await page.$(usernameSelector) !== null;

        if (!isLikelyLoginPage && !currentPageUrl.toLowerCase().includes('login')) {
            console.log(`[${host}] Détecté comme potentiellement déjà connecté sur ${currentPageUrl}.`);
            loginSuccess = true;
            pageUrlAfterLogin = currentPageUrl;
            break; 
        }
        
        if (isLikelyLoginPage || currentPageUrl.toLowerCase().includes('login')) {
            await page.waitForSelector(usernameSelector, { timeout: 10000, visible: true });
            console.log(`[${host}] Champ Username ('${usernameSelector}') trouvé sur ${currentPageUrl}.`);
            await page.type(usernameSelector, usernameArg);
            
            await page.waitForSelector(passwordSelector, { timeout: 5000, visible: true });
            console.log(`[${host}] Champ Password ('${passwordSelector}') trouvé.`);
            await page.type(passwordSelector, passwordArg);

            await page.waitForSelector(submitSelector, { timeout: 5000, visible: true });
            console.log(`[${host}] Bouton Login ('${submitSelector}') trouvé. Clic...`);
            await Promise.all([
              page.click(submitSelector),
              page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }) // Timeout spécifique pour la navigation post-login
            ]);
            pageUrlAfterLogin = page.url();
            console.log(`[${host}] Connexion effectuée via ${loginUrl}. Nouvelle URL: ${pageUrlAfterLogin}`);
            loginSuccess = true;
            break; 
        }
      } catch (attemptError) {
        console.warn(`[${host}] Échec de la tentative sur ${loginUrl}: ${attemptError.message.split('\n')[0]}`);
        if (loginAttemptUrls.indexOf(loginUrl) === loginAttemptUrls.length - 1) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const errorContextPath = path.join(__dirname, `error_login_final_attempt_${safeHostName}_${timestamp}`);
            try {
                const pageContent = await page.content(); fs.writeFileSync(`${errorContextPath}.html`, pageContent);
                console.log(`[${host}] 📄 HTML (échec login final) sauvegardé: ${errorContextPath}.html`);
                await page.screenshot({ path: `${errorContextPath}.png`, fullPage: true });
                console.log(`[${host}] 📷 Screenshot (échec login final) sauvegardé: ${errorContextPath}.png`);
            } catch (debugError) {console.error(`[${host}] Erreur sauvegarde debug: ${debugError.message}`);}
        }
      }
    }

    if (!loginSuccess) {
      throw new Error("Échec de toutes les tentatives de login.");
    }

    console.log(`[${host}] Tentative de reboot via $.serverAction('reboot') sur ${pageUrlAfterLogin}...`);
    const rebootActionResult = await page.evaluate(() => {
      if (typeof $ !== 'undefined' && typeof $.serverAction === 'function') {
        $.serverAction('reboot');
        return { success: true, message: '$.serverAction("reboot") appelé.' };
      }
      return { success: false, message: 'La fonction $.serverAction n\'a pas été trouvée.' };
    });

    if (!rebootActionResult.success) {
      console.error(`[${host}] ❌ Échec de l'action de reboot : ${rebootActionResult.message}`);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const errorContextPath = path.join(__dirname, `error_serveraction_failed_${safeHostName}_${timestamp}`);
        try {
            const pageContent = await page.content(); fs.writeFileSync(`${errorContextPath}.html`, pageContent);
            console.log(`[${host}] 📄 HTML (échec $.serverAction) sauvegardé: ${errorContextPath}.html`);
            await page.screenshot({ path: `${errorContextPath}.png`, fullPage: true });
            console.log(`[${host}] 📷 Screenshot (échec $.serverAction) sauvegardé: ${errorContextPath}.png`);
        } catch (debugError) {console.error(`[${host}] Erreur sauvegarde debug: ${debugError.message}`);}
      process.exit(1); 
    } else {
      console.log(`[${host}] ✅ ${rebootActionResult.message}`);
    }
    
    // MODIFICATION: Délai augmenté
    console.log(`[${host}] Attente de 15 secondes après l'envoi de la commande de reboot...`);
    await new Promise(resolve => setTimeout(resolve, 15000)); // Délai augmenté à 15 secondes
    console.log(`[${host}] 🔁 Commande de reboot (probablement) envoyée et délai écoulé.`);

  } catch (error) {
    console.error(`[${host}] ❌ Erreur FINALE dans le processus de reboot via Puppeteer : ${error.message}`);
    process.exit(1);
  } finally {
    if (browser) {
      console.log(`[${host}] Fermeture du navigateur.`);
      await browser.close();
    }
    console.log(`[${host}] Script Puppeteer terminé.`);
  }
  // MODIFICATION: Log de fin de script
  console.log(`[${host}] SCRIPT NODE.JS VA MAINTENANT QUITTER AVEC CODE 0 (SI PAS D'ERREUR AVANT).`);
})();