// ============================================================
// INVESTMENT AGENT v2 - Google Apps Script
// Oso - Agente Inversor Conservador 2026
// IA: Google Gemini (gratis) | Datos: Wallbit API + Yahoo Finance
// Flujo: lista completa → Gemini selecciona 10 → Yahoo enriquece → Gemini asigna montos
// ============================================================
// INSTRUCCIONES:
// 1. Abrí script.google.com y creá un nuevo proyecto
// 2. Pegá este código completo
// 3. Completá las keys en CONFIG abajo
// 4. Ejecutá testAgent() primero para probar
// 5. Si todo sale bien, ejecutá setupTrigger() UNA sola vez
// ============================================================

const CONFIG = {
  GEMINI_API_KEY:  ""YOUR_GEMINI_KEY"",
  WALLBIT_API_KEY: ""YOUR_WALLBIT_KEY"",
  EMAIL_DESTINO:   "YOUR_EMAIL",
  HORA_EJECUCION:  9,
};

const WALLBIT_BASE = "https://api.wallbit.io/api/public/v1";

// ============================================================
// FUNCIÓN PRINCIPAL
// ============================================================

function runInvestmentAgent() {
  Logger.log("=== Iniciando Investment Agent v2 ===");

  try {
    // PASO 1: Balance
    Logger.log("Consultando balance...");
    const balance = getBalance();
    Logger.log(`Balance: $${balance} USD`);

    // PASO 2: Lista completa de acciones y ETFs (datos básicos, sin Yahoo)
    Logger.log("Cargando acciones...");
    const acciones = getAssetListPaginada("");
    Logger.log(`Acciones disponibles: ${acciones.length}`);

    Logger.log("Cargando ETFs...");
    const etfs = getAssetListPaginada("ETF");
    Logger.log(`ETFs disponibles: ${etfs.length}`);

    // PASO 3: Gemini elige los 10 mejores (5 ETFs + 5 acciones) sin datos del día
    Logger.log("Fase 1 - Gemini selecciona los 10 candidatos...");
    const candidatos = seleccionarCandidatos(acciones, etfs);
    Logger.log(`Candidatos seleccionados: ${candidatos.length}`);
    Logger.log(candidatos.map(c => c.ticker).join(", "));

    // PASO 4: Enriquecer solo los 10 con Yahoo Finance
    Logger.log("Enriqueciendo candidatos con datos del dia...");
    const enriched = enrichCandidatos(candidatos);

    // PASO 5: Gemini asigna montos con datos completos del día
    Logger.log("Fase 2 - Gemini asigna montos con datos del dia...");
    const sugerencias = asignarMontos(balance, enriched);

    const sugetfs     = sugerencias.filter(s => s.tipo === "ETF");
    const sugacciones = sugerencias.filter(s => s.tipo === "Stock");

    Logger.log(`ETFs: ${sugetfs.length} | Acciones: ${sugacciones.length}`);

    enviarEmailResumen(balance, sugetfs, sugacciones);
    Logger.log("=== Agente finalizado con exito ===");

  } catch (error) {
    Logger.log(`ERROR: ${error.message}`);
    enviarEmailError(error.message);
  }
}

// ============================================================
// WALLBIT: Balance
// ============================================================

function getBalance() {
  const res = UrlFetchApp.fetch(`${WALLBIT_BASE}/balance/checking`, {
    method: "GET",
    headers: { "X-API-Key": CONFIG.WALLBIT_API_KEY },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  return data?.data?.[0]?.balance ?? 0;
}

// ============================================================
// WALLBIT: Lista paginada (acciones o ETFs según category)
// ============================================================

function getAssetListPaginada(category) {
  const todas = [];
  let page = 1;

  while (true) {
    const url = category
      ? `${WALLBIT_BASE}/assets?limit=50&page=${page}&category=${category}`
      : `${WALLBIT_BASE}/assets?limit=50&page=${page}`;

    const res = UrlFetchApp.fetch(url, {
      method: "GET",
      headers: { "X-API-Key": CONFIG.WALLBIT_API_KEY },
      muteHttpExceptions: true,
    });

    const json  = JSON.parse(res.getContentText());
    const batch = json.data ?? [];

    if (batch.length === 0) break;

    todas.push(...batch);
    page++;
    Utilities.sleep(200);
  }

  return todas;
}

// ============================================================
// WALLBIT: Detalle de un asset específico
// ============================================================

function getAssetDetail(symbol) {
  try {
    const res = UrlFetchApp.fetch(`${WALLBIT_BASE}/assets/${symbol}`, {
      method: "GET",
      headers: { "X-API-Key": CONFIG.WALLBIT_API_KEY },
      muteHttpExceptions: true,
    });
    return JSON.parse(res.getContentText())?.data ?? null;
  } catch (e) {
    Logger.log(`Error detalle ${symbol}: ${e.message}`);
    return null;
  }
}

// ============================================================
// YAHOO FINANCE: Variación del día
// ============================================================

function getYahooQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    const res = UrlFetchApp.fetch(url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0" },
      muteHttpExceptions: true,
    });
    const meta = JSON.parse(res.getContentText())?.chart?.result?.[0]?.meta;
    if (!meta) return { change_percent: null, volume_label: "N/D" };

    const prev    = meta.chartPreviousClose ?? meta.previousClose;
    const current = meta.regularMarketPrice;
    const change_percent = prev && current
      ? parseFloat((((current - prev) / prev) * 100).toFixed(2))
      : null;

    const volume     = meta.regularMarketVolume ?? null;
    const avg_volume = meta.averageDailyVolume3Month ?? null;
    let volume_label = "N/D";
    if (volume && avg_volume) {
      const ratio = volume / avg_volume;
      volume_label = ratio > 1.3 ? "alto" : ratio < 0.7 ? "bajo" : "normal";
    }

    return { change_percent, volume_label };
  } catch (e) {
    Logger.log(`Error Yahoo ${symbol}: ${e.message}`);
    return { change_percent: null, volume_label: "N/D" };
  }
}

// ============================================================
// Enriquecer los 10 candidatos con Wallbit detalle + Yahoo
// ============================================================

function enrichCandidatos(candidatos) {
  return candidatos.map(c => {
    const detail = getAssetDetail(c.ticker);
    const yahoo  = getYahooQuote(c.ticker);
    Utilities.sleep(200);

    return {
      symbol:         c.ticker,
      name:           detail?.name ?? c.nombre ?? c.ticker,
      price:          detail?.price ?? 0,
      tipo:           c.tipo,
      sector:         detail?.sector ?? c.sector ?? "Desconocido",
      exchange:       detail?.exchange ?? "N/A",
      market_cap_m:   detail?.market_cap_m ? Number(detail.market_cap_m) : null,
      dividend_yield: detail?.dividend?.yield ?? null,
      description:    (detail?.description_es ?? detail?.description ?? "").substring(0, 180),
      change_percent: yahoo.change_percent,
      volume_label:   yahoo.volume_label,
    };
  });
}

// ============================================================
// GEMINI FASE 1: Seleccionar 10 candidatos de la lista completa
// ============================================================

function seleccionarCandidatos(acciones, etfs) {
  const listaAcciones = acciones
    .map(a => `${a.symbol} | ${a.name} | ${a.sector ?? "N/D"}`)
    .join("\n");

  const listaETFs = etfs
    .map(a => `${a.symbol} | ${a.name} | ${a.sector ?? "N/D"}`)
    .join("\n");

  const prompt = `
Sos un asistente de inversion conservador para principiantes.
Analizá estas listas y seleccioná exactamente 10 activos: 5 ETFs y 5 acciones individuales,
los mas adecuados para un perfil conservador de largo plazo.

ACCIONES DISPONIBLES:
${listaAcciones}

ETFs DISPONIBLES:
${listaETFs}

CRITERIOS PARA LOS 5 ETFs:
- Priorizar ETFs de indice amplio: S&P 500, total market, bonos del tesoro, dividendos
- Evitar ETFs especulativos, apalancados, inversos, de nicho o paises emergentes riesgosos
- Ejemplos ideales: VOO, SPY, BND, VTI, SCHD, AGG, VYM

CRITERIOS PARA LAS 5 ACCIONES:
- Solo blue chips de alta capitalizacion de mercado
- Sectores defensivos: salud, consumo basico, finanzas grandes, tecnologia estable
- Preferir empresas que pagan dividendos historicamente estables
- Evitar: acciones especulativas, startups, alta volatilidad

REGLAS DE FORMATO - CRITICAS:
- Responde UNICAMENTE con el array JSON, sin texto antes ni despues
- Sin markdown, sin backticks, sin explicaciones
- El campo "tipo" debe ser exactamente "ETF" o "Stock"

FORMATO:
[
  { "ticker": "", "nombre": "", "tipo": "ETF", "sector": "" },
  { "ticker": "", "nombre": "", "tipo": "Stock", "sector": "" }
]
`.trim();

  const texto = llamarGemini(prompt, 1024);
  return JSON.parse(texto);
}

// ============================================================
// GEMINI FASE 2: Asignar montos con datos completos del día
// ============================================================

function asignarMontos(balance, assets) {
  const listaFormateada = assets.map(a => {
    const change = a.change_percent != null
      ? (a.change_percent > 0 ? "+" : "") + a.change_percent.toFixed(2) + "%"
      : "N/D";
    const mcap = a.market_cap_m
      ? "$" + Number(a.market_cap_m).toLocaleString() + "M"
      : "N/D";
    const div = a.dividend_yield != null ? a.dividend_yield + "%" : "No paga";

    return [
      `Ticker: ${a.symbol}`,
      `Tipo: ${a.tipo}`,
      `Sector: ${a.sector}`,
      `Precio: $${a.price} USD`,
      `Variacion hoy: ${change}`,
      `Volumen: ${a.volume_label}`,
      `Cap mercado: ${mcap}`,
      `Dividendo: ${div}`,
      `Descripcion: ${a.description || "N/D"}`,
    ].join(" | ");
  }).join("\n");

  const prompt = `
Sos un asistente de inversion conservador para principiantes.
Estos 10 activos ya fueron preseleccionados como conservadores.
Tu tarea es analizar los datos de hoy y distribuir el capital entre ellos.

CAPITAL DISPONIBLE: $${balance} USD

ACTIVOS (5 ETFs + 5 acciones):
${listaFormateada}

ANALISIS QUE DEBES HACER:
- ¿Subio o bajo hoy? Variacion significativa (mayor a 2%) es señal importante
- Volumen alto con suba = señal positiva | Volumen alto con baja = señal de cautela
- Penalizar activos con caida mayor al 2% reduciendoles la asignacion

REGLAS DE DISTRIBUCION:
- La suma exacta de todos los monto_a_invertir debe ser $${balance} USD (diferencia maxima $0.10)
- Ningun activo puede recibir mas del 15% del capital
- Ningun activo puede recibir menos del 7% del capital
- Montos en dolares con hasta 2 decimales
- El campo precio_actual debe coincidir EXACTAMENTE con el precio de la lista

REGLAS DE FORMATO - CRITICAS:
- Responde UNICAMENTE con el array JSON, sin texto antes ni despues
- Sin markdown, sin backticks, sin explicaciones
- Todos los valores numericos deben ser numeros (no strings)
- El campo "razon" menciona comportamiento del dia y por que es conservador (max 2 oraciones)
- El campo "tipo" debe ser exactamente "ETF" o "Stock"

VERIFICACION INTERNA:
¿La suma de monto_a_invertir es exactamente $${balance}?
¿Ningun monto supera el 15% ni esta debajo del 7%?
¿El JSON es valido sin texto extra?

FORMATO:
[
  { "ticker": "", "nombre": "", "tipo": "ETF", "sector": "", "precio_actual": 0, "variacion_hoy": 0, "monto_a_invertir": 0, "razon": "" }
]
`.trim();

  const texto = llamarGemini(prompt, 2048);
  return JSON.parse(texto);
}

// ============================================================
// HELPER: Llamar a Gemini
// ============================================================

function llamarGemini(prompt, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
  };

  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const res  = UrlFetchApp.fetch(url, options);
  const data = JSON.parse(res.getContentText());

  if (data.error) throw new Error(`Gemini error: ${data.error.message}`);

  let texto = data.candidates[0].content.parts[0].text.trim();
  texto = texto.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return texto;
}

// ============================================================
// EMAIL: Resumen con tablas HTML
// ============================================================

function enviarEmailResumen(balance, etfs, acciones) {
  const fecha  = new Date().toLocaleDateString("es-AR");
  const total  = etfs.length + acciones.length;
  const sumado = [...etfs, ...acciones]
    .reduce((acc, s) => acc + s.monto_a_invertir, 0)
    .toFixed(2);

  function filaActivo(s, i) {
    const bg = i % 2 === 0 ? "#f9f9f9" : "#ffffff";
    const change = s.variacion_hoy != null
      ? s.variacion_hoy > 0
        ? `<span style="color:#27ae60;">+${s.variacion_hoy.toFixed(2)}%</span>`
        : `<span style="color:#e74c3c;">${s.variacion_hoy.toFixed(2)}%</span>`
      : `<span style="color:#aaa;">N/D</span>`;

    return `
      <tr style="background:${bg};">
        <td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${s.ticker}</td>
        <td style="padding:8px;border:1px solid #ddd;">${s.nombre ?? s.ticker}</td>
        <td style="padding:8px;border:1px solid #ddd;">${s.sector}</td>
        <td style="padding:8px;border:1px solid #ddd;">$${s.precio_actual}</td>
        <td style="padding:8px;border:1px solid #ddd;">${change}</td>
        <td style="padding:8px;border:1px solid #ddd;font-weight:bold;">$${s.monto_a_invertir}</td>
      </tr>
      <tr style="background:${bg};">
        <td colspan="6" style="padding:8px;border:1px solid #ddd;color:#555;font-size:13px;">
          ${s.razon}
        </td>
      </tr>`;
  }

  function tablaSeccion(titulo, color, items) {
    if (items.length === 0) return "";
    return `
      <h3 style="color:${color};margin-top:24px;">${titulo} (${items.length})</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="background:${color};color:white;">
          <th style="padding:8px;text-align:left;">Ticker</th>
          <th style="padding:8px;text-align:left;">Nombre</th>
          <th style="padding:8px;text-align:left;">Sector</th>
          <th style="padding:8px;text-align:left;">Precio</th>
          <th style="padding:8px;text-align:left;">Hoy</th>
          <th style="padding:8px;text-align:left;">Invertir</th>
        </tr>
        ${items.map((s, i) => filaActivo(s, i)).join("")}
      </table>`;
  }

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
    <h2 style="color:#2c3e50;border-bottom:2px solid #3498db;padding-bottom:10px;">
      Investment Agent - ${fecha}
    </h2>
    <p style="color:#555;">
      Balance disponible: <strong>$${balance} USD</strong> &nbsp;|&nbsp;
      Total sugerido: <strong>$${sumado} USD</strong> &nbsp;|&nbsp;
      Activos: <strong>${total}</strong>
    </p>

    ${tablaSeccion("ETFs Recomendados", "#2980b9", etfs)}
    ${tablaSeccion("Acciones Recomendadas", "#8e44ad", acciones)}

    <br>
    <p style="color:#e74c3c;font-size:12px;">
      Estas sugerencias son orientativas y no constituyen asesoramiento financiero.
      Siempre toma tus propias decisiones de inversion.
    </p>
    <p style="color:#aaa;font-size:12px;border-top:1px solid #eee;padding-top:10px;">
      Ejecutado automaticamente a las ${CONFIG.HORA_EJECUCION}:00hs.<br>
      Datos: Wallbit API + Yahoo Finance | IA: Gemini 2.5 Flash-Lite | Fase 1: seleccion | Fase 2: asignacion
    </p>
  </div>`;

  GmailApp.sendEmail(
    CONFIG.EMAIL_DESTINO,
    `Investment Agent - ${total} sugerencias del dia - ${fecha}`,
    `${total} activos sugeridos. Total a invertir: $${sumado} USD. Abri en HTML para ver el detalle.`,
    { htmlBody: html }
  );

  Logger.log("Email enviado.");
}

// ============================================================
// EMAIL: Error
// ============================================================

function enviarEmailError(mensaje) {
  GmailApp.sendEmail(
    CONFIG.EMAIL_DESTINO,
    "Investment Agent - ERROR",
    `Error en la ejecucion:\n\n${mensaje}\n\nRevisa los logs en script.google.com`
  );
}

// ============================================================
// SETUP: Ejecutar UNA SOLA VEZ para activar el scheduler
// ============================================================

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("runInvestmentAgent")
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.HORA_EJECUCION)
    .create();
  Logger.log(`Trigger creado: corre todos los dias a las ${CONFIG.HORA_EJECUCION}:00hs`);
}

// ============================================================
// TEST: Correr manualmente para probar
// ============================================================

function testAgent() {
  Logger.log("=== TEST MODE ===");
  runInvestmentAgent();
}

function verBalance() {
  const res = UrlFetchApp.fetch(`${WALLBIT_BASE}/balance/stocks`, {
    method: "GET",
    headers: { "X-API-Key": CONFIG.WALLBIT_API_KEY },
    muteHttpExceptions: true,
  });
  Logger.log(res.getContentText());
}
function verBalance2() {
  const res = UrlFetchApp.fetch(`${WALLBIT_BASE}/balance/checking`, {
    method: "GET",
    headers: { "X-API-Key": CONFIG.WALLBIT_API_KEY },
    muteHttpExceptions: true,
  });
  Logger.log(res.getContentText());
}

