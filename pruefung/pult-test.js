// Prüfung für whatsapp-pult-ui: echte Seite im Browser, nachgestellte
// GitHub-API. Nur erfundene Daten, kein Netz, kein Token.
//
// Einmalig:  npm install -g playwright   und   npx playwright install chromium
// Aufruf:    node pruefung/pult-test.js            (alle Fälle)
//            node pruefung/pult-test.js nur=grossesLog,offline
// Windows:   node pruefung\pult-test.js
// Optional:  PULT_CHROMIUM=<Pfad zu chrome>  nimmt einen vorhandenen Browser.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

function playwrightLaden() {
  try { return require("playwright"); } catch (_) { /* global versuchen */ }
  const global = execSync("npm root -g", { encoding: "utf8" }).trim();
  return require(path.join(global, "playwright"));
}
const { chromium } = playwrightLaden();

const ordnerArg = process.argv.slice(2).find((a) => !a.startsWith("nur="));
const UI = path.resolve(ordnerArg || path.join(__dirname, ".."));
const NUR = (process.argv.find((a) => a.startsWith("nur=")) || "").slice(4).split(",").filter(Boolean);
const SHOTS = path.join(os.tmpdir(), "pult-test-bilder");
fs.mkdirSync(SHOTS, { recursive: true });

const ORIGIN = "http://pult.test";
const API = "https://api.github.com/repos/benedictcberg-hue/whatsapp-pult/contents/";

const STAND = {
  stand: "1. Januar 2030, 12:00",
  ungelesen: [
    { name: "Kontakt A", zeit: "gestern", anzahl: 2, letzte: "Erfundene Zeile A mit Ümlaut und Emoji 🙂", vorschlag: "Erfundener Vorschlag A." },
    { name: "Kontakt B", zeit: "heute", anzahl: 1, letzte: "Erfundene Zeile B", vorschlag: "Erfundener Vorschlag B." },
    { name: "Gruppe C", zeit: "1. Januar 2030", anzahl: 5, letzte: "Erfundene Zeile C", vorschlag: "Erfundener Vorschlag C." },
  ],
  zuletzt: [{ name: "Kontakt D", zeit: "01:00", text: "Erfunden D", status: "eigene Nachricht · zugestellt", ticks: true }],
  hinweis: [{ name: "Kontakt E", zeit: "gestern", vorschau: "🙂", gelesen_beim_oeffnen: true }],
  chats: [
    { id: "c1", name: "Kontakt A", zeit: "gestern", ungelesen: 2, vorschau: "Erfundene Zeile A" },
    { id: "c9", name: "Kontakt F", zeit: "Montag", vorschau: "Erfunden F" },
    { neu: true, marke: "neu", hinweis: "Platz für neue Chats" },
  ],
  aufgaben: [{ titel: "Erfundene Aufgabe", status: "offen", quelle: "Kontakt B" }],
  timer: [{ name: "Erfundener Timer", alarm: "2030-01-01T18:00:00+01:00", quelle: "Kontakt A" }],
  termine: [{ titel: "Erfundener Termin", wann: "2. Januar 2030", quelle: "Gruppe C" }],
};

let shaZaehler = 0;
const neueSha = () => "sha" + (++shaZaehler);
const b64 = (t) => Buffer.from(t, "utf8").toString("base64");
const unb64 = (t) => Buffer.from(t, "base64").toString("utf8");

function neueWelt(opt = {}) {
  const dateien = {
    "stand.json": { text: JSON.stringify(opt.stand || STAND, null, 2), sha: neueSha() },
    "gespraeche.json": { text: opt.gespraecheText !== undefined ? opt.gespraecheText : JSON.stringify({ gespraeche: opt.gespraeche || [] }, null, 2), sha: neueSha() },
  };
  if (opt.ohneGespraeche) delete dateien["gespraeche.json"];
  return { dateien, opt, log: [], puts: 0, gets: 0 };
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-github-api-version, accept",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
  "access-control-expose-headers": "x-ratelimit-remaining, x-ratelimit-reset",
};

async function apiRoute(welt, route) {
  const req = route.request();
  const url = new URL(req.url());
  const m = req.method();
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
  const o = welt.opt;
  const blob = url.pathname.match(/\/repos\/benedictcberg-hue\/whatsapp-pult\/git\/blobs\/(.+)$/);
  if (blob) {
    welt.log.push("GET blob " + blob[1]);
    if (o.offline) return route.abort("internetdisconnected");
    const treffer = Object.values(welt.dateien).find((d) => d.sha === decodeURIComponent(blob[1]));
    if (!treffer) return route.fulfill({ status: 404, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ message: "Not Found" }) });
    return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "text/plain; charset=utf-8" }, body: treffer.text });
  }
  const datei = decodeURIComponent(url.pathname.replace("/repos/benedictcberg-hue/whatsapp-pult/contents/", ""));
  welt.log.push(m + " " + datei + " " + (req.headers()["accept"] || ""));
  const json = (status, body, extra) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json", ...(extra || {}) }, body: JSON.stringify(body) });

  if (o.offline) return route.abort("internetdisconnected");
  if (o.verzoegerung) await new Promise((r) => setTimeout(r, o.verzoegerung));
  if (o.status401) return json(401, { message: "Bad credentials" });
  if (o.status404Alle) return json(404, { message: "Not Found" });
  if (m === "GET") {
    welt.gets++;
    if (o.gespraecheFehler && datei === "gespraeche.json") return json(o.gespraecheFehler, { message: "Server Error" });
    const d = welt.dateien[datei];
    if (!d) return json(404, { message: "Not Found" });
    const roh = (req.headers()["accept"] || "").includes("raw");
    if (roh) return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "text/plain; charset=utf-8" }, body: d.bytes || d.text });
    const size = d.bytes ? d.bytes.length : Buffer.byteLength(d.text);
    if (d.bytes) return json(200, { name: datei, path: datei, sha: d.sha, size, encoding: "base64", content: d.bytes.toString("base64") });
    if (o.gross && datei === "gespraeche.json") {
      return json(200, { name: datei, path: datei, sha: d.sha, size: 1500000, encoding: "none", content: "" });
    }
    return json(200, { name: datei, path: datei, sha: d.sha, size, encoding: "base64", content: b64(d.text).replace(/(.{60})/g, "$1\n") });
  }
  if (m === "PUT") {
    welt.puts++;
    const body = JSON.parse(req.postData() || "{}");
    if (o.put401) return json(401, { message: "Bad credentials" });
    if (o.putRateLimit) return json(403, { message: "API rate limit exceeded for user ID 1." }, { "x-ratelimit-remaining": "0" });
    if (o.putOhneRecht) return json(403, { message: "Resource not accessible by personal access token" });
    if (o.konfliktEinmal && !welt.konfliktGehabt) {
      welt.konfliktGehabt = true;
      // jemand anderes schreibt dazwischen
      const d0 = welt.dateien[datei];
      const alt = JSON.parse(d0.text);
      alt.gespraeche.push({ name: "Fremd", zeit: "2030-01-01T00:00:00Z", text: "von anderem Tab", vorschlag: "" });
      welt.dateien[datei] = { text: JSON.stringify(alt, null, 2), sha: neueSha() };
    }
    const d = welt.dateien[datei];
    if (d && body.sha !== d.sha) return json(409, { message: `${datei} does not match ${body.sha}` });
    if (!d && body.sha) return json(422, { message: "sha wasn't supplied" });
    welt.dateien[datei] = { text: unb64(body.content), sha: neueSha() };
    welt.letzteMeldung = body.message;
    if (o.antwortVerlorenEinmal && !welt.verlorenGehabt) { welt.verlorenGehabt = true; return route.abort("connectionreset"); }
    return json(d ? 200 : 201, { content: { sha: welt.dateien[datei].sha } });
  }
  return json(405, { message: "nope" });
}

async function seite(browser, welt, opt = {}) {
  const ctx = await browser.newContext({ viewport: opt.viewport || { width: 1280, height: 900 }, locale: "de-DE", timezoneId: "Europe/Berlin", permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const fehler = [];
  page.on("pageerror", (e) => fehler.push("pageerror: " + e.message));
  page.on("console", (msg) => { if (msg.type() === "error") fehler.push("console: " + msg.text()); });
  await page.route(ORIGIN + "/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const datei = path.join(UI, p === "/" ? "index.html" : decodeURIComponent(p));
    if (!datei.startsWith(UI + path.sep) || !fs.existsSync(datei)) return route.fulfill({ status: 404, body: "nf" });
    const typ = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" }[path.extname(datei)] || "application/octet-stream";
    return route.fulfill({ status: 200, headers: { "content-type": typ }, body: fs.readFileSync(datei) });
  });
  await page.route("https://api.github.com/**", (route) => apiRoute(welt, route));
  if (opt.tokenVorher) await page.addInitScript((t) => { try { localStorage.setItem("whatsapp-pult-token", t); } catch (_) {} }, opt.tokenVorher);
  await page.goto(ORIGIN + "/");
  return { ctx, page, fehler };
}

async function verbinden(page) {
  await page.fill("#token-eingabe", "github_pat_TEST");
  await page.click("#token-form button[type=submit]");
}

const sichtbar = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

const TESTS = {
  async grundlauf(browser) {
    const welt = neueWelt();
    const { page, fehler, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])", { timeout: 5000 });
    const karten = await page.locator("#board article.chat").count();
    const zahlen = await page.locator("#kennzahlen .kennzahl").allInnerTexts();
    await page.screenshot({ path: path.join(SHOTS, "desktop.png"), fullPage: true });
    await ctx.close();
    return { ok: karten === 3 && fehler.length === 0, karten, zahlen, fehler };
  },

  async insRepo(browser) {
    const welt = neueWelt();
    const { page, fehler, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const karte = page.locator("#board article.chat").first();
    await karte.locator("textarea").fill("Mein Kommentar äöü 🙂");
    await karte.locator("[data-repo]").click();
    await page.waitForFunction(() => document.querySelector(".gespraech-log:not([hidden])"), null, { timeout: 5000 }).catch(() => {});
    await warte(300);
    const g = JSON.parse(welt.dateien["gespraeche.json"].text);
    const log = await karte.locator(".gespraech-log").innerText().catch(() => "");
    await ctx.close();
    const e = g.gespraeche[0] || {};
    return { ok: g.gespraeche.length === 1 && e.text === "Mein Kommentar äöü 🙂" && e.name === "Kontakt A" && log.includes("Mein Kommentar"), anzahl: g.gespraeche.length, eintrag: e, meldung: welt.letzteMeldung, fehler };
  },

  async konflikt409(browser) {
    const welt = neueWelt({ konfliktEinmal: true });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const karte = page.locator("#board article.chat").first();
    await karte.locator("textarea").fill("nach Konflikt");
    await karte.locator("[data-repo]").click();
    await warte(800);
    const g = JSON.parse(welt.dateien["gespraeche.json"].text);
    await ctx.close();
    return { ok: g.gespraeche.length === 2, texte: g.gespraeche.map((x) => x.text), puts: welt.puts };
  },

  async grossesLog(browser) {
    // Log liegt schon mit 3 Einträgen im Repo, API meldet "zu groß" (encoding none)
    const vorhanden = [1, 2, 3].map((i) => ({ name: "Kontakt B", zeit: "2030-01-01T00:00:0" + i + "Z", text: "alt " + i, vorschlag: "" }));
    const welt = neueWelt({ gespraeche: vorhanden, gross: true });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const karte = page.locator("#board article.chat").first();
    await karte.locator("textarea").fill("neu");
    await karte.locator("[data-repo]").click();
    await warte(800);
    const g = JSON.parse(welt.dateien["gespraeche.json"].text);
    const fehlerText = await karte.locator(".schreib-fehler").innerText().catch(() => "");
    await ctx.close();
    // ok = keine alten Einträge verloren
    return { ok: g.gespraeche.length === 4 || (g.gespraeche.length === 3 && !!fehlerText), eintraegeDanach: g.gespraeche.length, fehlerText };
  },

  async gespraecheAusfall(browser) {
    const welt = neueWelt({ gespraecheFehler: 500 });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await warte(800);
    const dash = await sichtbar(page, "#dashboard");
    const karten = await page.locator("#board article.chat").count();
    const fehlerText = await page.locator("[role=alert]:visible").allInnerTexts();
    await ctx.close();
    return { ok: dash && karten === 3, dashboard: dash, karten, fehlerText };
  },

  async rateLimitBeimSchreiben(browser) {
    const welt = neueWelt({ putRateLimit: true });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const karte = page.locator("#board article.chat").first();
    await karte.locator("textarea").fill("x");
    await karte.locator("[data-repo]").click();
    await warte(600);
    const t = await karte.locator(".schreib-fehler").innerText();
    const textBleibt = await karte.locator("textarea").inputValue();
    await ctx.close();
    return { ok: !/Read and write/.test(t) && textBleibt === "x", meldung: t, textBleibt };
  },

  async ohneSchreibrecht(browser) {
    const welt = neueWelt({ putOhneRecht: true });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const karte = page.locator("#board article.chat").first();
    await karte.locator("textarea").fill("x");
    await karte.locator("[data-repo]").click();
    await warte(600);
    const t = await karte.locator(".schreib-fehler").innerText();
    await ctx.close();
    return { ok: /Read and write/.test(t), meldung: t };
  },

  async neuLadenBehaeltEntwurf(browser) {
    const welt = neueWelt();
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    await page.locator("#board article.chat").nth(1).locator("textarea").fill("halb getippt");
    await page.click("#neu-laden");
    await page.waitForSelector("#dashboard:not([hidden])");
    await warte(300);
    const wert = await page.locator("#board article.chat").nth(1).locator("textarea").inputValue();
    await ctx.close();
    return { ok: wert === "halb getippt", wert };
  },

  async nichtJetztUeberlebtNeuLaden(browser) {
    const welt = neueWelt();
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    await page.locator("#board article.chat").first().locator("[data-spaeter]").click();
    await page.click("#neu-laden");
    await page.waitForSelector("#dashboard:not([hidden])");
    await warte(300);
    const weg = await page.locator("#board article.chat.weg").count();
    await ctx.close();
    return { ok: weg === 1, weg };
  },

  async token401(browser) {
    const welt = neueWelt({ status401: true });
    const { page, ctx } = await seite(browser, welt, { tokenVorher: "github_pat_ALT" });
    await page.waitForSelector("#anmeldung:not([hidden])", { timeout: 5000 });
    const t = await page.locator("#anmeldung-fehler").innerText();
    const gespeichert = await page.evaluate(() => localStorage.getItem("whatsapp-pult-token"));
    await ctx.close();
    return { ok: !gespeichert, meldung: t, gespeichert };
  },

  async kein404Zugriff(browser) {
    const welt = neueWelt({ status404Alle: true });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#anmeldung:not([hidden])", { timeout: 5000 });
    await warte(200);
    const t = await page.locator("#anmeldung-fehler").innerText();
    await ctx.close();
    return { ok: /whatsapp-pult/.test(t), meldung: t };
  },

  async offline(browser) {
    const welt = neueWelt({ offline: true });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#anmeldung:not([hidden])", { timeout: 5000 });
    await warte(200);
    const t = await page.locator("#anmeldung-fehler").innerText();
    await ctx.close();
    return { ok: !/^Failed to fetch$/.test(t.trim()), meldung: t };
  },

  async kaputteDaten(browser) {
    const stand = { stand: 5, ungelesen: [null, "x", { name: "", anzahl: "drei", letzte: "W".repeat(400), vorschlag: null }, { name: "Kontakt Z", anzahl: -2 }], zuletzt: [null, { name: "Q", ticks: "false" }], hinweis: "kein array",
      chats: [null, 7, { name: "Kontakt Y", ungelesen: -1 }], aufgaben: [null, { titel: "A" }], timer: [null, "x"], termine: { kein: "array" } };
    const welt = neueWelt({ stand, gespraecheText: JSON.stringify({ gespraeche: [null, 5, { name: "Kontakt Z", text: "t" }] }) });
    const { page, fehler, ctx } = await seite(browser, welt, { viewport: { width: 360, height: 800 } });
    await verbinden(page);
    await warte(800);
    const dash = await sichtbar(page, "#dashboard");
    const quer = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: path.join(SHOTS, "kaputt-360.png"), fullPage: true });
    await ctx.close();
    return { ok: dash && quer <= 0 && fehler.length === 0, dashboard: dash, querScroll: quer, fehler };
  },

  async mobil360(browser) {
    const welt = neueWelt();
    const { page, fehler, ctx } = await seite(browser, welt, { viewport: { width: 360, height: 800 } });
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const quer = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: path.join(SHOTS, "mobil-360.png"), fullPage: true });
    await ctx.close();
    return { ok: quer <= 0 && fehler.length === 0, querScroll: quer, fehler };
  },

  async kennzahlenNachNichtJetzt(browser) {
    const welt = neueWelt();
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const vorher = await page.locator("#kennzahlen b").allInnerTexts();
    await page.locator("#board article.chat").first().locator("[data-spaeter]").click();
    const nachher = await page.locator("#kennzahlen b").allInnerTexts();
    const fokus = await page.evaluate(() => document.activeElement && document.activeElement.className);
    await ctx.close();
    return { ok: vorher.join() === "3,8,3,3" && nachher.join() === "3,8,2,2" && /wieder/.test(fokus), vorher, nachher, fokus };
  },

  async strgEnter(browser) {
    const welt = neueWelt();
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const feld = page.locator("#board article.chat").nth(2).locator("textarea");
    await feld.fill("per Tastatur");
    await feld.press("Control+Enter");
    await warte(600);
    const g = JSON.parse(welt.dateien["gespraeche.json"].text);
    await ctx.close();
    return { ok: g.gespraeche.length === 1 && g.gespraeche[0].name === "Gruppe C", g: g.gespraeche.map((x) => x.name) };
  },

  async neuLadenOffline(browser) {
    const welt = neueWelt();
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    welt.opt.offline = true;
    await page.click("#neu-laden");
    await warte(500);
    const dash = await sichtbar(page, "#dashboard");
    const hinweis = await page.locator("#log-hinweis").innerText().catch(() => "");
    const knopf = await page.locator("#neu-laden").innerText();
    await ctx.close();
    return { ok: dash && /Neu laden fehlgeschlagen/.test(hinweis) && knopf === "Neu laden", dash, hinweis, knopf };
  },

  async abmeldenWaehrendLaden(browser) {
    const welt = neueWelt({ verzoegerung: 700 });
    const { page, ctx } = await seite(browser, welt, { tokenVorher: "github_pat_ALT" });
    await page.waitForSelector("#abmelden:not([hidden])", { timeout: 3000 }).catch(() => {});
    const knopfDa = await sichtbar(page, "#abmelden");
    if (knopfDa) await page.click("#abmelden");
    await warte(1200);
    const dash = await sichtbar(page, "#dashboard");
    const karten = await page.locator("#board article.chat").count();
    await ctx.close();
    return { ok: !dash && karten === 0, knopfDa, dash, karten };
  },

  async nichtMerkenLoeschtAltes(browser) {
    const welt = neueWelt();
    const { page, ctx } = await seite(browser, welt, { tokenVorher: "github_pat_ALT" });
    await page.waitForSelector("#dashboard:not([hidden])");
    await page.click("#abmelden");
    // neu verbinden ohne merken: localStorage darf kein Token behalten
    await page.evaluate(() => localStorage.setItem("whatsapp-pult-token", "github_pat_GANZALT"));
    await page.uncheck("#token-merken");
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const lokal = await page.evaluate(() => localStorage.getItem("whatsapp-pult-token"));
    const sitzung = await page.evaluate(() => sessionStorage.getItem("whatsapp-pult-token"));
    await ctx.close();
    return { ok: !lokal && sitzung === "github_pat_TEST", lokal, sitzung };
  },

  async keinNameImSpeicher(browser) {
    const welt = neueWelt();
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    await page.locator("#board article.chat").first().locator("[data-spaeter]").click();
    const alles = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    await ctx.close();
    return { ok: !/Kontakt|Erfunden/.test(alles) && /whatsapp-pult-weg/.test(alles), alles: alles.replace(/github_pat_\w+/g, "github_pat_***") };
  },

  async gespraecheKeineListe(browser) {
    const text = JSON.stringify({ gespraeche: { "Kontakt A": [{ text: "gruppiert" }] } });
    const welt = neueWelt({ gespraecheText: text });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const hinweis = await page.locator("#log-hinweis").innerText();
    const karte = page.locator("#board article.chat").first();
    await karte.locator("textarea").fill("x");
    await karte.locator("[data-repo]").click();
    await warte(500);
    const fehler = await karte.locator(".schreib-fehler").innerText();
    const unveraendert = welt.dateien["gespraeche.json"].text === text;
    await ctx.close();
    return { ok: unveraendert && welt.puts === 0 && /keine Liste/.test(fehler) && /keine Liste/.test(hinweis), puts: welt.puts, fehler, hinweis };
  },

  async ansiDatei(browser) {
    const welt = neueWelt();
    // "Grüße" in Windows-1252
    welt.dateien["gespraeche.json"] = { bytes: Buffer.from('{"gespraeche":[{"name":"Kontakt A","text":"Gr\xfc\xdfe"}]}', "latin1"), sha: neueSha() };
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const karte = page.locator("#board article.chat").first();
    await karte.locator("textarea").fill("x");
    await karte.locator("[data-repo]").click();
    await warte(500);
    const fehler = await karte.locator(".schreib-fehler").innerText();
    await ctx.close();
    return { ok: welt.puts === 0 && /kein UTF-8/.test(fehler), puts: welt.puts, fehler };
  },

  async antwortVerlorenKeinDuplikat(browser) {
    const welt = neueWelt({ antwortVerlorenEinmal: true });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const karte = page.locator("#board article.chat").first();
    await karte.locator("textarea").fill("nur einmal");
    await karte.locator("[data-repo]").click();
    await warte(600);
    const fehler1 = await karte.locator(".schreib-fehler").innerText().catch(() => "");
    await karte.locator("[data-repo]").click();
    await warte(600);
    const g = JSON.parse(welt.dateien["gespraeche.json"].text);
    const feld = await karte.locator("textarea").inputValue();
    await ctx.close();
    return { ok: g.gespraeche.length === 1 && feld === "", anzahl: g.gespraeche.length, fehler1, feld };
  },

  async schreib401(browser) {
    const welt = neueWelt({ put401: true });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    const karte = page.locator("#board article.chat").first();
    await karte.locator("textarea").fill("x");
    await karte.locator("[data-repo]").click();
    await page.waitForSelector("#anmeldung:not([hidden])", { timeout: 3000 }).catch(() => {});
    const anm = await sichtbar(page, "#anmeldung");
    const karten = await page.locator("#board article.chat").count();
    const gespeichert = await page.evaluate(() => localStorage.getItem("whatsapp-pult-token") || sessionStorage.getItem("whatsapp-pult-token"));
    await ctx.close();
    return { ok: anm && karten === 0 && !gespeichert, anm, karten, gespeichert };
  },

  async klassischesToken(browser) {
    const welt = neueWelt();
    const { page, ctx } = await seite(browser, welt);
    await page.fill("#token-eingabe", "ghp_KLASSISCH");
    await page.click("#token-form button[type=submit]");
    await page.waitForSelector("#dashboard:not([hidden])");
    const hinweis = await page.locator("#log-hinweis").innerText();
    await ctx.close();
    return { ok: /Klassisches Token/.test(hinweis), hinweis };
  },

  async tokenErstNachErfolg(browser) {
    const welt = neueWelt({ status404Alle: true });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#anmeldung-fehler:not([hidden])");
    const gespeichert = await page.evaluate(() => localStorage.getItem("whatsapp-pult-token") || sessionStorage.getItem("whatsapp-pult-token"));
    const retry = await sichtbar(page, "#neu-laden");
    await ctx.close();
    return { ok: !gespeichert && retry, gespeichert, retry };
  },

  async dreiGleichzeitig(browser) {
    const welt = neueWelt({ verzoegerung: 150 });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    for (let i = 0; i < 3; i++) await page.locator("#board article.chat").nth(i).locator("textarea").fill("parallel " + i);
    await page.evaluate(() => document.querySelectorAll("#board [data-repo]").forEach((b) => b.click()));
    await warte(3500);
    const g = JSON.parse(welt.dateien["gespraeche.json"].text);
    const fehler = await page.locator(".schreib-fehler:visible").allInnerTexts();
    await ctx.close();
    return { ok: g.gespraeche.length === 3 && fehler.length === 0, anzahl: g.gespraeche.length, fehler, puts: welt.puts };
  },

  async schnellNacheinander(browser) {
    const welt = neueWelt({ verzoegerung: 150 });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    for (let i = 0; i < 3; i++) await page.locator("#board article.chat").nth(i).locator("textarea").fill("schnell " + i);
    for (let i = 0; i < 3; i++) { await page.locator("#board article.chat").nth(i).locator("[data-repo]").click({ noWaitAfter: true }); await warte(80); }
    await warte(3500);
    const g = JSON.parse(welt.dateien["gespraeche.json"].text);
    await ctx.close();
    return { ok: g.gespraeche.length === 3, anzahl: g.gespraeche.length, puts: welt.puts };
  },

  async wunschKnopf(browser) {
    const welt = neueWelt({ gespraeche: [{ name: "Kontakt A", zeit: "2030-01-01T00:00:00Z", text: "alt", vorschlag: "" }] });
    const { page, fehler, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    await page.click("#neue-vorschlaege");
    await page.waitForSelector("#wunsch-note:not([hidden])", { timeout: 4000 }).catch(() => {});
    const note = await page.locator("#wunsch-note").innerText().catch(() => "");
    const g = JSON.parse(welt.dateien["gespraeche.json"].text);
    const log = await page.locator("#board article.chat").first().locator(".gespraech-log").innerText();
    await ctx.close();
    const w = g.gespraeche[1] || {};
    return { ok: g.gespraeche.length === 2 && w.typ === "neue-vorschlaege" && /Wunsch liegt im Repo/.test(note) && !/neue-vorschlaege/.test(log) && fehler.length === 0,
      anzahl: g.gespraeche.length, typ: w.typ, meldung: welt.letzteMeldung, note, fehler };
  },

  async wunschVerlorenKeinDuplikat(browser) {
    const welt = neueWelt({ antwortVerlorenEinmal: true });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    await page.click("#neue-vorschlaege");
    await warte(600);
    const fehler1 = await page.locator("#wunsch-fehler").innerText().catch(() => "");
    await page.click("#neue-vorschlaege");
    await warte(600);
    const g = JSON.parse(welt.dateien["gespraeche.json"].text);
    await ctx.close();
    return { ok: g.gespraeche.length === 1 && /Keine Verbindung/.test(fehler1), anzahl: g.gespraeche.length, fehler1 };
  },

  async wunschUndKommentarZugleich(browser) {
    const welt = neueWelt({ verzoegerung: 120 });
    const { page, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    await page.locator("#board article.chat").first().locator("textarea").fill("zugleich");
    await page.evaluate(() => { document.querySelector("#board [data-repo]").click(); document.getElementById("neue-vorschlaege").click(); });
    await warte(2500);
    const g = JSON.parse(welt.dateien["gespraeche.json"].text);
    await ctx.close();
    return { ok: g.gespraeche.length === 2 && welt.puts === 2, anzahl: g.gespraeche.length, puts: welt.puts };
  },

  async uebersichtSprung(browser) {
    const welt = neueWelt({ stand: { ...STAND, ungelesen: STAND.ungelesen.map((c, i) => ({ ...c, id: "c" + (i + 1) })) } });
    const { page, fehler, ctx } = await seite(browser, welt);
    await verbinden(page);
    await page.waitForSelector("#dashboard:not([hidden])");
    await page.click("#uebersicht-toggle");
    const zeilen = await page.locator("#uebersicht-liste .chat-zeile").count();
    await page.locator("#uebersicht-liste .chat-zeile").first().click();
    await warte(300);
    const sprung = await page.locator("#board article.chat.sprung").count();
    const bereiche = await page.locator("#aufgaben .aufgabe, #timer .timer-karte, #termine .termin-karte").count();
    await page.screenshot({ path: path.join(SHOTS, "desktop-neu.png"), fullPage: true });
    await ctx.close();
    return { ok: zeilen === 2 && sprung === 1 && bereiche === 3 && fehler.length === 0, zeilen, sprung, bereiche, fehler };
  },

  async anmeldungOptik(browser) {
    const welt = neueWelt();
    const { page, ctx } = await seite(browser, welt);
    await page.waitForSelector("#anmeldung:not([hidden])");
    const pille = await sichtbar(page, "#verbindung");
    await page.screenshot({ path: path.join(SHOTS, "anmeldung.png"), fullPage: true });
    await ctx.close();
    return { ok: !pille, verbundenPilleSichtbar: pille };
  },
};

(async () => {
  const browser = await chromium.launch(process.env.PULT_CHROMIUM ? { executablePath: process.env.PULT_CHROMIUM } : {});
  const erg = {};
  for (const [name, fn] of Object.entries(TESTS)) {
    if (NUR.length && !NUR.includes(name)) continue;
    try { erg[name] = await fn(browser); } catch (e) { erg[name] = { ok: false, absturz: String(e && e.message || e).split("\n")[0] }; }
    console.log((erg[name].ok ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(erg[name]));
  }
  await browser.close();
  const fail = Object.values(erg).filter((r) => !r.ok).length;
  console.log(`\n${Object.keys(erg).length - fail}/${Object.keys(erg).length} bestanden · Bilder: ${SHOTS}`);
  process.exitCode = fail ? 1 : 0;
})();
