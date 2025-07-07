import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';          // para guardar Markdown

puppeteer.use(StealthPlugin());

// --- Leer parámetros de la línea de comandos ---
// Uso: node test.js <BASE_URL> <término de búsqueda...>
const BASE_URL   = process.argv[2];                // p. ej. https://www.mercadolibre.com.co
const SEARCH_TERM = process.argv.slice(3).join(' '); // permite términos con espacios

if (!BASE_URL || !SEARCH_TERM) {
  console.error('⚠️  Uso: node test.js <BASE_URL> <término de búsqueda>');
  process.exit(1);
}

// --- Configuración según dominio ---
const DOMAIN = new URL(BASE_URL).hostname;

const CONFIG = DOMAIN.includes('mercadolibre')
  ? {
      productCardSelector: 'li.ui-search-layout__item',
      directSearchUrl: `https://listado.mercadolibre.com.co/${encodeURIComponent(SEARCH_TERM)}`,
      // Mercado Libre usa /gafas-de-sol, etc.
      searchInputSelectors: [
        'input#cb1-edit',              // barra principal
        'input[placeholder="Buscar"]'
      ]
    }
  : {
      productCardSelector: 'div.product-card',
      directSearchUrl: `${BASE_URL}/pdsearch/${SEARCH_TERM}/?ici=s1%60EditSearch%60${SEARCH_TERM}%60_fb%60d0%60PageHome&search_source=1&search_type=all&source=search`,
      searchInputSelectors: [
        'input[placeholder*="Search"]',
        'input[placeholder*="Buscar"]',
        'input[type="search"]',
        '.search-input',
        '[data-testid="search-input"]'
      ]
    };

// Lista de User Agents reales para rotar
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/111.0 Firefox/111.0'
];

// Función para esperar tiempo aleatorio
const randomDelay = (min = 1000, max = 3000) => 
  new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

// Función para detectar CAPTCHAs
const detectCaptcha = async (page) => {
  const captchaSelectors = [
    'div[id*="captcha"]',
    'div[class*="captcha"]',
    'div[class*="verification"]',
    'div[class*="challenge"]',
    '.sui-modal',
    '[class*="anti-robot"]',
    'text="Por favor, selecciona los siguientes gráficos"',
    'text="CONFIRMAR"'
  ];

  for (const selector of captchaSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        console.log(`🚫 CAPTCHA detectado: ${selector}`);
        return true;
      }
    } catch (e) {
      // Continuar con el siguiente selector
    }
  }
  return false;
};

// Función para cerrar modales/popups
const closeModals = async (page) => {
  const closeSelectors = [
    'button[class*="close"]',
    '.modal-close',
    '[aria-label="close"]',
    '[aria-label="cerrar"]',
    'button:has-text("×")',
    'button:has-text("✕")',
    '.sui-modal-close'
  ];

  for (const selector of closeSelectors) {
    try {
      const closeBtn = await page.$(selector);
      if (closeBtn) {
        await closeBtn.click();
        console.log(`✅ Modal cerrado: ${selector}`);
        await randomDelay(500, 1000);
      }
    } catch (e) {
      // Continuar con el siguiente selector
    }
  }
};

// Función para configurar página con máxima evasión
const setupPage = async (page, userAgent) => {
  // Configurar User Agent
  await page.setUserAgent(userAgent);
  
  // Configurar viewport según el User Agent
  if (userAgent.includes('iPhone')) {
    await page.setViewport({ width: 375, height: 812, isMobile: true, deviceScaleFactor: 2 });
  } else if (userAgent.includes('Android')) {
    await page.setViewport({ width: 414, height: 896, isMobile: true, deviceScaleFactor: 2 });
  } else {
    await page.setViewport({ width: 1366, height: 768, isMobile: false });
  }

  // Headers adicionales para parecer más humano
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document'
  });

  // Interceptar y bloquear recursos innecesarios
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    const url = request.url();
    
    // Bloquear recursos que pueden detectar bots
    if (resourceType === 'image' && url.includes('captcha')) {
      request.abort();
    } else if (resourceType === 'stylesheet' || resourceType === 'font') {
      request.abort(); // Acelerar carga
    } else if (url.includes('analytics') || url.includes('tracking') || url.includes('facebook') || url.includes('google-analytics')) {
      request.abort();
    } else {
      request.continue();
    }
  });

  // Evaluar scripts para ocultar automatización
  await page.evaluateOnNewDocument(() => {
    // Eliminar propiedades que detectan Puppeteer
    delete Object.getPrototypeOf(navigator).webdriver;
    
    // Sobrescribir plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
    
    // Sobrescribir languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['es-ES', 'es', 'en']
    });
    
    // Agregar propiedades de navegador real
    Object.defineProperty(navigator, 'permissions', {
      get: () => ({
        query: () => Promise.resolve({ state: 'granted' })
      })
    });
  });
};

// Función para navegar con reintentos
const navigateWithRetry = async (page, url, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`🔄 Intento ${i + 1} navegando a: ${url}`);
      
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });
      
      // Esperar un poco para que cargue completamente
      await randomDelay(2000, 4000);
      
      // Verificar si hay CAPTCHA
      const hasCaptcha = await detectCaptcha(page);
      if (hasCaptcha) {
        console.log('🚫 CAPTCHA detectado, reintentando...');
        await randomDelay(5000, 10000); // Esperar más tiempo
        continue;
      }
      
      // Cerrar posibles modales
      await closeModals(page);
      
      return true; // Éxito
    } catch (error) {
      console.log(`❌ Error en intento ${i + 1}: ${error.message}`);
      if (i === maxRetries - 1) throw error;
      await randomDelay(3000, 6000);
    }
  }
  return false;
};

// Función principal de scraping
const scrapeShein = async () => {
  let browser;
  
  try {
    // Lanzar navegador con configuración anti-detección
    browser = await puppeteer.launch({ 
      headless: false, // Cambiar a true para producción
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-web-security',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--enable-features=NetworkService,NetworkServiceLogging',
        '--proxy-bypass-list=*',
        '--disable-extensions'
      ]
    });

    const page = await browser.newPage();
    
    // Configurar página con User Agent aleatorio
    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    await setupPage(page, randomUA);
    
    console.log(`🎭 Usando User Agent: ${randomUA.slice(0, 50)}...`);
    
    // Estrategia 1: Intentar página de inicio primero
    const homePage = `${BASE_URL}/`;
    const success = await navigateWithRetry(page, homePage);
    
    if (!success) {
      throw new Error('No se pudo acceder a la página de inicio');
    }
    
    // Simular comportamiento humano en homepage
    await randomDelay(2000, 4000);
    
    // Estrategia 2: Usar búsqueda interna en lugar de URL directa
    try {
      // Buscar campo de búsqueda
      const searchSelectors = CONFIG.searchInputSelectors;
      
      let searchInput = null;
      for (const selector of searchSelectors) {
        try {
          searchInput = await page.$(selector);
          if (searchInput) {
            console.log(`🔍 Campo de búsqueda encontrado: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (searchInput) {
        // Simular escritura humana
        await searchInput.click();
        await randomDelay(500, 1000);
        
        // Escribir letra por letra
        for (const char of SEARCH_TERM) {
          await searchInput.type(char);
          await randomDelay(100, 300);
        }
        
        // Presionar Enter
        await searchInput.press('Enter');
        console.log(`✅ Búsqueda realizada: ${SEARCH_TERM}`);
        
        // Esperar resultados
        await randomDelay(3000, 5000);
        
      } else {
        console.log('⚠️ No se encontró campo de búsqueda, intentando URL directa...');
        
        // Fallback: usar URL directa con modificaciones
        const searchUrl = CONFIG.directSearchUrl;
        await navigateWithRetry(page, searchUrl);
      }
      
    } catch (searchError) {
      console.log(`❌ Error en búsqueda: ${searchError.message}`);
    }
    
    // Verificar CAPTCHA final
    const finalCaptcha = await detectCaptcha(page);
    if (finalCaptcha) {
      console.log('🚫 CAPTCHA persistente detectado');
      await page.screenshot({ path: 'captcha_detected.png', fullPage: true });
      console.log('📸 Screenshot del CAPTCHA guardado → captcha_detected.png');
      
      // Estrategia alternativa: esperar y recargar
      console.log('⏳ Esperando 30 segundos antes de recargar...');
      await randomDelay(30000, 35000);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await randomDelay(3000, 5000);
    }
    
    // Scroll progresivo para cargar contenido
    console.log('📜 Realizando scroll progresivo...');
    for (let y = 0; y <= 3000; y += 300) {
      await page.evaluate((_y) => window.scrollTo(0, _y), y);
      await randomDelay(500, 1000);
    }

    /* ---------- capturar tarjetas crudas ---------- */
    try {
      const cardsArr = await page.$$eval(CONFIG.productCardSelector,
        cards => cards.map(c => c.outerHTML)
      );
      if (!cardsArr.length) throw new Error('sin resultados');
      const rawHTML = cardsArr.join('\n\n<!-- ---- -->\n\n');

      // --- guardar en subcarpeta response_HTML ---
      const dir = 'response_HTML';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const outFile = `${dir}/raw_cards_${SEARCH_TERM.replace(/\s+/g,'_')}_${Date.now()}.html`;
      fs.writeFileSync(outFile, rawHTML);
      console.log(`🗂️  Guardado ${outFile} con ${cardsArr.length} tarjetas`);
      return true;                     // Éxito → detenemos estrategias
    } catch (e) {
      console.warn(`⚠️  No se encontraron tarjetas con selector ${CONFIG.productCardSelector}:`, e.message);
      return false;
    }
  } catch (error) {
    console.error('💥 Error en scraping:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

// Función para múltiples intentos con diferentes estrategias
const scrapeWithFallback = async () => {
  const strategies = [
    { name: 'Búsqueda interna', delay: 0 },
    { name: 'Espera extendida', delay: 60000 },
    { name: 'Diferentes viewport', delay: 30000 }
  ];
  
  for (const strategy of strategies) {
    try {
      console.log(`🎯 Intentando estrategia: ${strategy.name}`);
      
      if (strategy.delay > 0) {
        console.log(`⏳ Esperando ${strategy.delay / 1000} segundos...`);
        await randomDelay(strategy.delay, strategy.delay + 5000);
      }
      
      const ok = await scrapeShein();
      if (ok) {
        console.log(`✅ Éxito con estrategia: ${strategy.name}`);
        return;           // detenemos las siguientes estrategias
      }
      
    } catch (error) {
      console.log(`❌ Falló estrategia ${strategy.name}: ${error.message}`);
      continue;
    }
  }
  
  throw new Error('Todas las estrategias fallaron');
};

// Ejecutar el scraper
(async () => {
  try {
    await scrapeWithFallback();
    console.log('✅ Scraping completado y HTML almacenado.');
  } catch (error) {
    console.error('💥 Error final:', error.message);
    process.exit(1);
  }
})();