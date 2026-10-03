/* WhatsApp-Pult — öffentliche Hülle. Liest stand.json und liest/schreibt
 * gespraeche.json im privaten Repo über die GitHub-API. Kein Server, kein
 * Build, keine Fremdbibliothek. Das Token bleibt im Browser und geht nur
 * an api.github.com. Nichts wird an WhatsApp gesendet.
 * Diese Datei enthält keine Chat-Namen und keinen Nachrichtentext.
 */
"use strict";

const OWNER = "benedictcberg-hue";
const REPO = "whatsapp-pult";
const DATEI = "stand.json";
const GESPRAECHE_DATEI = "gespraeche.json";
const BRANCH = "main";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const TOKEN_SCHLUESSEL = "whatsapp-pult-token";
const WEG_SCHLUESSEL = "whatsapp-pult-weg";

const zustand = {
  token: "",
  stand: null,
  gespraeche: [],
  laedt: false,
  schreibend: 0,
  merken: null,
};

let ladeLauf = 0;

const chatVonKarte = new WeakMap();
const offenerEintrag = new WeakMap();

const $ = (id) => document.getElementById(id);

function el(tag, attrs, ...kinder) {
  const knoten = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") knoten.className = v;
    else if (k === "text") knoten.textContent = v;
    else if (k.startsWith("on")) knoten.addEventListener(k.slice(2), v);
    else knoten.setAttribute(k, v === true ? "" : v);
  }
  for (const kind of kinder.flat()) {
    if (kind === undefined || kind === null || kind === false) continue;
    knoten.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
  }
  return knoten;
}

function speicherLesen(schluessel) {
  for (const s of [() => localStorage, () => sessionStorage]) {
    try {
      const w = s().getItem(schluessel);
      if (w) return w;
    } catch (_) { /* gesperrt */ }
  }
  return "";
}
function speicherSchreiben(schluessel, wert, dauerhaft) {
  try {
    (dauerhaft ? localStorage : sessionStorage).setItem(schluessel, wert);
  } catch (_) { /* gesperrt */ }
}
function speicherLoeschen(schluessel) {
  try { localStorage.removeItem(schluessel); } catch (_) { /* gesperrt */ }
  try { sessionStorage.removeItem(schluessel); } catch (_) { /* gesperrt */ }
}

class GitHubFehler extends Error {
  constructor(status, text, limit) {
    super(`${status}: ${text}`);
    this.status = status;
    this.limit = !!limit;
  }
}

class NetzFehler extends Error {}

async function holen(url, optionen) {
  try {
    return await fetch(url, optionen);
  } catch (_) {
    throw new NetzFehler("Keine Verbindung zu api.github.com. Netz prüfen, dann erneut versuchen.");
  }
}

function verstaendlich(e, datei) {
  if (e instanceof GitHubFehler) {
    if (e.limit) return "GitHub-Limit erreicht (" + e.status + "). In ein paar Minuten erneut versuchen.";
    if (e.status === 401) return "Token ungültig oder abgelaufen (401). Bitte ein neues Token einfügen.";
    if (e.status === 404) {
      return datei + " nicht gefunden (404). Hat das Token Zugriff auf das Repo " + REPO +
        "? Repository access: Only select repositories → " + REPO + ".";
    }
    return e.message;
  }
  if (e instanceof SyntaxError) return datei + " ist kein gültiges JSON.";
  return String(e && e.message ? e.message : e);
}

function eintraege(liste) {
  return (Array.isArray(liste) ? liste : []).filter((e) => e && typeof e === "object" && !Array.isArray(e));
}

function zeigen(was) {
  $("anmeldung").hidden = was !== "anmeldung";
  $("lade").hidden = was !== "lade";
  $("dashboard").hidden = was !== "dashboard";
  const verbunden = was === "dashboard";
  $("verbindung").hidden = !verbunden;
  $("neu-laden").hidden = !(verbunden || was === "anmeldung" && !!zustand.token);
  $("abmelden").hidden = !(verbunden || was === "anmeldung" && !!zustand.token);
}

function githubKopf(accept) {
  return {
    Authorization: `Bearer ${zustand.token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fehlerAus(antwort) {
  let text = antwort.statusText;
  try {
    const roh = await antwort.text();
    try {
      text = JSON.parse(roh).message || roh || text;
    } catch (_) {
      text = roh || text;
    }
  } catch (_) { /* egal */ }
  const rest = antwort.headers.get("x-ratelimit-remaining");
  const limit = (antwort.status === 403 || antwort.status === 429) &&
    (rest === "0" || /rate limit/i.test(text));
  return new GitHubFehler(antwort.status, text, limit);
}

async function standLaden() {
  const url = `${API}/contents/${DATEI}?ref=${encodeURIComponent(BRANCH)}`;
  const antwort = await holen(url, {
    cache: "no-store",
    headers: githubKopf("application/vnd.github.raw+json"),
  });
  if (!antwort.ok) throw await fehlerAus(antwort);
  const daten = JSON.parse(await antwort.text());
  if (!daten || typeof daten !== "object" || Array.isArray(daten)) {
    throw new Error(DATEI + " hat kein Objekt.");
  }
  return daten;
}

function utf8NachBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  const schritt = 0x8000;
  for (let i = 0; i < bytes.length; i += schritt) {
    bin += String.fromCharCode(...bytes.subarray(i, i + schritt));
  }
  return btoa(bin);
}

// Streng: eine Datei in ANSI/Windows-1252 bricht ab, statt beim nächsten
// Schreiben alle Umlaute durch Ersatzzeichen zu ersetzen.
function utf8Streng(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    throw new Error("gespraeche.json ist kein UTF-8. Nichts geschrieben.");
  }
}

function base64NachUtf8(b64) {
  const rein = String(b64 || "").replace(/\s/g, "");
  if (!rein) return "";
  const bin = atob(rein);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return utf8Streng(bytes);
}

function gespraecheObjekt(roh) {
  const text = String(roh || "").trim();
  if (!text) return { gespraeche: [] };
  const daten = JSON.parse(text);
  if (!daten || typeof daten !== "object" || Array.isArray(daten)) {
    throw new Error("gespraeche.json hat kein Objekt. Nichts geschrieben.");
  }
  if (daten.gespraeche === undefined) daten.gespraeche = [];
  if (!Array.isArray(daten.gespraeche)) {
    throw new Error("gespraeche.json: „gespraeche“ ist keine Liste. Nichts geschrieben.");
  }
  return daten;
}

async function gespraecheLaden() {
  const url = `${API}/contents/${GESPRAECHE_DATEI}?ref=${encodeURIComponent(BRANCH)}`;
  const antwort = await holen(url, {
    cache: "no-store",
    headers: githubKopf("application/vnd.github.raw+json"),
  });
  if (antwort.status === 404) return { gespraeche: [] };
  if (!antwort.ok) throw await fehlerAus(antwort);
  try {
    return gespraecheObjekt(await antwort.text());
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error("gespraeche.json ist kein gültiges JSON.");
    }
    throw e;
  }
}

function hatChatId(wert) {
  return wert !== undefined && wert !== null && String(wert) !== "";
}

function passtZuChat(eintrag, chat) {
  if (hatChatId(chat && chat.id) && hatChatId(eintrag && eintrag.id)) {
    return String(eintrag.id) === String(chat.id);
  }
  return String((eintrag && eintrag.name) || "") === String((chat && chat.name) || "");
}

function eintragBauen(chat, text, vorschlag) {
  const eintrag = {};
  if (hatChatId(chat && chat.id)) eintrag.id = chat.id;
  eintrag.name = String((chat && chat.name) || "");
  eintrag.zeit = new Date().toISOString();
  eintrag.text = text;
  eintrag.vorschlag = vorschlag;
  return eintrag;
}

function schreibHinweis(e) {
  if (e instanceof GitHubFehler && !e.limit) {
    const fehltRecht = e.status === 403 || /resource not accessible|not accessible by integration|write access|contents permission/i.test(e.message);
    if (fehltRecht) {
      return e.message + " Das Token braucht Contents: Read and write auf whatsapp-pult.";
    }
  }
  return verstaendlich(e, GESPRAECHE_DATEI);
}

async function blobLesen(sha) {
  // Inhalt genau zu dieser SHA. Die Contents-API liefert über 1 MB keinen
  // content mit; ohne das hier würde der nächste PUT das Log überschreiben.
  const antwort = await holen(`${API}/git/blobs/${encodeURIComponent(sha)}`, {
    cache: "no-store",
    headers: githubKopf("application/vnd.github.raw+json"),
  });
  if (!antwort.ok) throw await fehlerAus(antwort);
  return utf8Streng(new Uint8Array(await antwort.arrayBuffer()));
}

async function gespraecheLesenMitSha() {
  const url = `${API}/contents/${GESPRAECHE_DATEI}?ref=${encodeURIComponent(BRANCH)}`;
  const antwort = await holen(url, {
    cache: "no-store",
    headers: githubKopf("application/vnd.github+json"),
  });
  if (antwort.status === 404) return { sha: null, daten: { gespraeche: [] } };
  if (!antwort.ok) throw await fehlerAus(antwort);
  const meta = await antwort.json();
  if (!meta || typeof meta.sha !== "string" || !meta.sha) {
    throw new Error("gespraeche.json: Antwort ohne SHA. Nichts geschrieben.");
  }
  const vollstaendig = meta.encoding === "base64" && (!!meta.content || Number(meta.size) === 0);
  const roh = vollstaendig ? base64NachUtf8(meta.content) : await blobLesen(meta.sha);
  let daten;
  try {
    daten = gespraecheObjekt(roh);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error("gespraeche.json ist kein gültiges JSON. Nichts geschrieben.");
    }
    throw e;
  }
  return { sha: meta.sha, daten };
}

function gleicherEintrag(a, b) {
  return !!a && typeof a === "object" && a.zeit === b.zeit && a.name === b.name && a.text === b.text;
}

// Schreibvorgänge dieses Tabs laufen nacheinander, nicht gegeneinander.
let schreibKette = Promise.resolve();

function gespraecheAblegen(chat, eintrag) {
  const lauf = schreibKette.then(() => gespraecheAblegenJetzt(chat, eintrag));
  schreibKette = lauf.catch(() => {});
  return lauf;
}

async function gespraecheAblegenJetzt(chat, eintrag) {
  const url = `${API}/contents/${GESPRAECHE_DATEI}`;
  const name = String((chat && chat.name) || "").replace(/[\r\n]+/g, " ").trim();
  let letzterFehler = null;
  for (let versuch = 0; versuch < 3; versuch++) {
    if (versuch) await new Promise((ok) => window.setTimeout(ok, 400 * versuch));
    const { sha, daten } = await gespraecheLesenMitSha();
    // Kam die Antwort eines früheren Versuchs nie an, steht der Eintrag
    // vielleicht schon im Repo. Dann nicht doppelt schreiben.
    if (daten.gespraeche.some((e) => gleicherEintrag(e, eintrag))) return daten.gespraeche;
    daten.gespraeche.push(eintrag);
    const inhalt = JSON.stringify(daten, null, 2) + "\n";
    const koerper = {
      message: "Gespraech: " + name,
      content: utf8NachBase64(inhalt),
      branch: BRANCH,
    };
    if (sha) koerper.sha = sha;
    const antwort = await holen(url, {
      method: "PUT",
      cache: "no-store",
      headers: {
        ...githubKopf("application/vnd.github+json"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(koerper),
    });
    if (antwort.ok) return daten.gespraeche;
    letzterFehler = await fehlerAus(antwort);
    if (letzterFehler.status !== 409 && letzterFehler.status !== 422) throw letzterFehler;
  }
  throw letzterFehler;
}

function initialen(name) {
  const t = String(name || "").trim();
  if (!t) return "?";
  return t.charAt(0).toUpperCase();
}

function inZwischenablage(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise(function (ok, nein) {
    const feld = document.createElement("textarea");
    feld.value = text;
    feld.setAttribute("readonly", "");
    feld.style.position = "fixed";
    feld.style.left = "-9999px";
    document.body.appendChild(feld);
    feld.select();
    let gut = false;
    try { gut = document.execCommand("copy"); } catch (e) { gut = false; }
    document.body.removeChild(feld);
    gut ? ok() : nein();
  });
}

function anzahlVon(chat) {
  return Math.max(0, Math.floor(Number(chat.anzahl) || 0));
}

function kennzahlenZeichnen(daten) {
  const ungelesen = eintraege(daten.ungelesen);
  const nachrichten = ungelesen.reduce((s, c) => s + anzahlVon(c), 0);
  const kasten = [
    { wert: ungelesen.length, label: "Ungelesene Chats" },
    { wert: nachrichten, label: "Nachrichten offen" },
    { wert: 0, label: "Warten auf dich", klasse: "warten", id: "warten" },
    { wert: 0, label: "Vorschläge bereit", klasse: "ok", id: "bereit" },
  ];
  $("kennzahlen").replaceChildren(...kasten.map((k) =>
    el("article", { class: "kennzahl" + (k.klasse ? " " + k.klasse : "") },
      el("b", k.id ? { id: k.id, text: String(k.wert) } : { text: String(k.wert) }),
      el("span", { text: k.label })
    )
  ));
  zaehlen();
}

function zaehlen() {
  const offen = $("board").querySelectorAll("article.chat:not(.weg)");
  const mitVorschlag = Array.from(offen).filter((k) => {
    const e = k.querySelector(".entwurf");
    return !!(e && e.textContent.trim());
  }).length;
  const warten = $("warten");
  if (warten) warten.textContent = String(offen.length);
  const bereit = $("bereit");
  if (bereit) bereit.textContent = String(mitVorschlag);
  $("leer").classList.toggle("sichtbar", offen.length === 0);
}

function chatSchluessel(chat) {
  return hatChatId(chat.id) ? "id:" + String(chat.id) : "name:" + String(chat.name || "");
}

// "Nicht jetzt" überlebt Neu laden. Gespeichert wird nur ein Prüfwert aus
// Chat und letzter Zeile, kein Name und kein Text. Neue Zeile = wieder sichtbar.
function wegWert(chat) {
  const text = chatSchluessel(chat) + "\n" + String(chat.letzte || "");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function wegLesen() {
  try {
    const liste = JSON.parse(speicherLesen(WEG_SCHLUESSEL) || "[]");
    return new Set(Array.isArray(liste) ? liste.map(String) : []);
  } catch (_) {
    return new Set();
  }
}

function wegSchreiben(menge) {
  const dauerhaft = (() => {
    try { return !!localStorage.getItem(TOKEN_SCHLUESSEL); } catch (_) { return false; }
  })();
  speicherLoeschen(WEG_SCHLUESSEL);
  if (menge.size) speicherSchreiben(WEG_SCHLUESSEL, JSON.stringify(Array.from(menge)), dauerhaft);
}

function wegMerken(chat, weg) {
  const menge = wegLesen();
  if (weg) menge.add(wegWert(chat));
  else menge.delete(wegWert(chat));
  wegSchreiben(menge);
}

function ansagen(text) {
  const a = $("ansage");
  if (!a) return;
  a.textContent = "";
  window.setTimeout(() => { a.textContent = text; }, 60);
}

function chatKarte(chat) {
  const name = String(chat.name || "");
  const zeit = String(chat.zeit || "");
  const anzahl = anzahlVon(chat);
  const letzte = String(chat.letzte || "");
  const vorschlag = String(chat.vorschlag || "");

  const wieder = el("button", { type: "button", class: "knopf-text wieder", text: "Wieder zeigen" });
  const wegHinweis = el("p", { class: "weg-hinweis" },
    "Nicht jetzt · nur hier ausgeblendet. ", wieder
  );

  const kopie = el("button", { type: "button", class: "knopf knopf-kopie", "data-kopieren": "", text: "Kopieren" });
  const spaeter = el("button", { type: "button", class: "knopf knopf-spaeter", "data-spaeter": "", text: "Nicht jetzt" });
  const log = el("div", { class: "gespraech-log" });
  const feld = el("textarea", {
    rows: "3",
    placeholder: "Nur ins private Repo. Nicht an WhatsApp. Strg+Enter schreibt.",
  });
  const insRepo = el("button", {
    type: "button",
    class: "knopf knopf-kopie",
    "data-repo": "",
    text: "Ins Repo",
  });
  const schreibFehler = el("p", { class: "fehler schreib-fehler", role: "alert", hidden: true });

  const body = el("div", { class: "chat-body" },
    el("blockquote", { text: letzte }),
    el("div", { class: "vorschlag" },
      el("span", { class: "etikett", text: "Vorschlag · nicht gesendet" }),
      el("p", { class: "entwurf", text: vorschlag })
    ),
    el("div", { class: "dazu" },
      el("label", {}, "Dazu sagen", feld),
      el("div", { class: "aktionen" }, insRepo),
      schreibFehler
    ),
    log,
    el("div", { class: "aktionen" }, kopie, spaeter)
  );

  logZeichnen(log, chat);

  const artikel = el("article", { class: "chat" },
    el("header", { class: "chat-kopf" },
      el("div", { class: "avatar", "aria-hidden": "true", text: initialen(name) }),
      el("div", { class: "wer" },
        el("div", { class: "name-zeile" },
          el("span", { class: "name", text: name }),
          el("span", { class: "zeit", text: zeit })
        ),
        el("div", { class: "status-zeile" },
          el("span", { class: "pille pille-amber", text: "wartet auf dich" }),
          anzahl ? el("span", { class: "badge", title: String(anzahl) + " ungelesen", text: String(anzahl) }) : null
        ),
        wegHinweis
      )
    ),
    body
  );
  chatVonKarte.set(artikel, chat);
  return artikel;
}

function zeitAnzeige(iso) {
  const roh = String(iso || "");
  if (!roh) return "";
  const datum = new Date(roh);
  if (Number.isNaN(datum.getTime())) return roh;
  return datum.toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
}

function logZeichnen(container, chat) {
  const liste = eintraege(zustand.gespraeche).filter((e) => passtZuChat(e, chat));
  if (!liste.length) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  container.hidden = false;
  container.replaceChildren(
    el("span", { class: "etikett", text: "Bisher dazu" }),
    ...liste.map((e) => el("article", { class: "log-eintrag" },
      el("time", { datetime: String(e.zeit || ""), text: zeitAnzeige(e.zeit) }),
      el("p", { text: String(e.text || "") }),
      el("p", { class: "log-vorschlag", text: "Vorschlag: " + String(e.vorschlag || "") })
    ))
  );
}

function alleLogsZeichnen() {
  for (const karte of $("board").querySelectorAll("article.chat")) {
    const chat = chatVonKarte.get(karte);
    const log = karte.querySelector(".gespraech-log");
    if (chat && log) logZeichnen(log, chat);
  }
}

function boardZeichnen(daten) {
  const liste = eintraege(daten.ungelesen);
  // Getippter Text in "Dazu sagen" bleibt beim Neu laden stehen.
  const entwuerfe = new Map();
  for (const karte of $("board").querySelectorAll("article.chat")) {
    const chat = chatVonKarte.get(karte);
    const feld = karte.querySelector("textarea");
    if (chat && feld && feld.value) entwuerfe.set(chatSchluessel(chat), feld.value);
  }
  const weg = wegLesen();
  const karten = liste.map((chat) => {
    const karte = chatKarte(chat);
    const entwurf = entwuerfe.get(chatSchluessel(chat));
    if (entwurf) karte.querySelector("textarea").value = entwurf;
    if (weg.has(wegWert(chat))) karte.classList.add("weg");
    return karte;
  });
  const sichtbar = new Set(liste.map(wegWert));
  const bleibt = new Set(Array.from(weg).filter((w) => sichtbar.has(w)));
  if (bleibt.size !== weg.size) wegSchreiben(bleibt);
  $("board").replaceChildren(...karten);
  $("blick-unter").textContent = liste.length
    ? (liste.length === 1 ? "Ein Chat, letzte Zeile, ein Entwurf." : liste.length + " Chats, letzte Zeile, ein Entwurf.")
    : "Keine wartenden Chats.";
  zaehlen();
}

function zuletztZeichnen(daten) {
  const liste = eintraege(daten.zuletzt);
  const box = $("zuletzt-box");
  if (!liste.length) {
    box.hidden = true;
    $("zuletzt").replaceChildren();
    return;
  }
  box.hidden = false;
  $("zuletzt").replaceChildren(...liste.map((eintrag) => {
    const statusKinder = [String(eintrag.status || "")];
    if (eintrag.ticks === true) {
      statusKinder.push(" ");
      statusKinder.push(el("span", { class: "ticks", "aria-hidden": "true", text: "✓✓" }));
    }
    return el("article", { class: "ruhig-karte" },
      el("div", { class: "name-zeile" },
        el("span", { class: "name", text: String(eintrag.name || "") }),
        el("span", { class: "zeit", text: String(eintrag.zeit || "") })
      ),
      el("span", { class: "pille pille-ruhig" }, ...statusKinder),
      el("p", { text: String(eintrag.text || "") })
    );
  }));
}

function hinweisZeichnen(daten) {
  const liste = eintraege(daten.hinweis);
  const box = $("hinweis-box");
  if (!liste.length) {
    box.hidden = true;
    $("hinweis").replaceChildren();
    return;
  }
  box.hidden = false;
  $("hinweis").replaceChildren(...liste.map((eintrag) => {
    const name = String(eintrag.name || "");
    const zeit = eintrag.zeit ? " · " + String(eintrag.zeit) : "";
    const vorschau = String(eintrag.vorschau || "");
    let text;
    if (vorschau) {
      text = "Vorschau nur " + vorschau + ". Öffnen des Chats hat ihn als gelesen markiert.";
    } else {
      text = "Vorschau leer. Öffnen des Chats hat ihn als gelesen markiert.";
    }
    return el("article", { class: "notiz-karte" },
      el("strong", { text: name }),
      zeit ? el("span", { class: "zeit", text: zeit }) : null,
      el("p", { text: text })
    );
  }));
}

function dashboardZeichnen(daten) {
  zustand.stand = daten;
  const stand = String(daten.stand || "");
  $("stand-meta").textContent = stand ? "WhatsApp Web · Stand " + stand : "WhatsApp Web";
  $("fuss").textContent = stand
    ? "Quelle: WhatsApp Web, nur gelesen. Stand " + stand + ". Diskussion nur ins private Repo, nicht an WhatsApp."
    : "Quelle: WhatsApp Web, nur gelesen. Diskussion nur ins private Repo, nicht an WhatsApp.";
  boardZeichnen(daten);
  kennzahlenZeichnen(daten);
  zuletztZeichnen(daten);
  hinweisZeichnen(daten);
  zeigen("dashboard");
}

function neuLadenKnopf() {
  const knopf = $("neu-laden");
  knopf.disabled = zustand.laedt || zustand.schreibend > 0;
  knopf.textContent = zustand.laedt ? "Lädt …" : "Neu laden";
}

function tokenUngueltig(text) {
  ladeLauf++;
  zustand.laedt = false;
  speicherLoeschen(TOKEN_SCHLUESSEL);
  zustand.token = "";
  zustand.merken = null;
  dashboardLeeren();
  neuLadenKnopf();
  const f = $("anmeldung-fehler");
  f.textContent = text;
  f.hidden = false;
  zeigen("anmeldung");
}

function tokenHinweis() {
  return /^ghp_/.test(zustand.token)
    ? "Klassisches Token (ghp_…) erkannt: es reicht an alle deine Repos. Besser ein fine-grained Token nur für " + REPO + "."
    : "";
}

function logHinweis(text) {
  // Nach einem Deploy kann kurz eine ältere index.html im Cache liegen.
  const h = $("log-hinweis");
  if (!h) return;
  h.textContent = text;
  h.hidden = !text;
}

// still: Neu laden aus dem Dashboard. Der vorige Stand bleibt sichtbar,
// ein Netzfehler wirft dann nicht auf die Anmeldung zurück.
async function starten(still) {
  const lauf = ++ladeLauf;
  const leise = !!still && !!zustand.stand;
  zustand.laedt = true;
  neuLadenKnopf();
  if (!leise) zeigen("lade");
  $("anmeldung-fehler").hidden = true;
  try {
    const [stand, gespraeche] = await Promise.allSettled([standLaden(), gespraecheLaden()]);
    if (lauf !== ladeLauf) return;
    if (stand.status === "rejected") throw stand.reason;
    if (zustand.merken !== null) {
      speicherSchreiben(TOKEN_SCHLUESSEL, zustand.token, zustand.merken);
      zustand.merken = null;
    }
    const hinweise = [tokenHinweis()];
    if (gespraeche.status === "fulfilled") {
      zustand.gespraeche = Array.isArray(gespraeche.value.gespraeche) ? gespraeche.value.gespraeche : [];
    } else {
      if (!leise) zustand.gespraeche = [];
      hinweise.push("Diskussionslog nicht geladen: " + verstaendlich(gespraeche.reason, GESPRAECHE_DATEI) +
        " „Ins Repo“ liest das Log vor dem Schreiben neu.");
    }
    logHinweis(hinweise.filter(Boolean).join(" "));
    dashboardZeichnen(stand.value);
  } catch (e) {
    if (lauf !== ladeLauf) return;
    const text = verstaendlich(e, DATEI);
    if (e instanceof GitHubFehler && e.status === 401) {
      tokenUngueltig(text);
      return;
    } else if (leise) {
      logHinweis("Neu laden fehlgeschlagen: " + text + " Zu sehen ist der vorige Stand.");
      return;
    }
    const f = $("anmeldung-fehler");
    f.textContent = text;
    f.hidden = false;
    zeigen("anmeldung");
  } finally {
    if (lauf === ladeLauf) {
      zustand.laedt = false;
      neuLadenKnopf();
    }
  }
}

function dashboardLeeren() {
  zustand.stand = null;
  zustand.gespraeche = [];
  $("board").replaceChildren();
  $("kennzahlen").replaceChildren();
  $("zuletzt").replaceChildren();
  $("hinweis").replaceChildren();
  $("zuletzt-box").hidden = true;
  $("hinweis-box").hidden = true;
  $("stand-meta").textContent = "";
  $("fuss").textContent = "";
  $("leer").classList.remove("sichtbar");
  logHinweis("");
}

function verdrahten() {
  // Nicht in fremden Seiten einbetten lassen (Pages kann keine Header setzen).
  if (window.top !== window.self) {
    document.body.textContent = "WhatsApp-Pult bitte direkt öffnen.";
    return;
  }
  $("token-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const wert = $("token-eingabe").value.trim();
    if (!wert) return;
    zustand.token = wert;
    // Gespeichert wird erst, wenn der Stand geladen ist (siehe starten).
    speicherLoeschen(TOKEN_SCHLUESSEL);
    zustand.merken = $("token-merken").checked;
    $("token-eingabe").value = "";
    $("anmeldung-fehler").hidden = true;
    starten();
  });

  $("abmelden").addEventListener("click", () => {
    ladeLauf++;
    zustand.laedt = false;
    zustand.merken = null;
    neuLadenKnopf();
    speicherLoeschen(TOKEN_SCHLUESSEL);
    speicherLoeschen(WEG_SCHLUESSEL);
    zustand.token = "";
    dashboardLeeren();
    $("anmeldung-fehler").hidden = true;
    zeigen("anmeldung");
  });

  $("neu-laden").addEventListener("click", () => {
    if (zustand.token && !zustand.laedt && !zustand.schreibend) starten(true);
  });

  $("board").addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || !(ev.ctrlKey || ev.metaKey)) return;
    const ziel = ev.target;
    if (!(ziel instanceof HTMLTextAreaElement)) return;
    const knopf = ziel.closest("article.chat") && ziel.closest("article.chat").querySelector("[data-repo]");
    if (knopf) {
      ev.preventDefault();
      knopf.click();
    }
  });

  $("board").addEventListener("click", (ev) => {
    const ziel = ev.target;
    if (!(ziel instanceof Element)) return;
    const chat = ziel.closest("article.chat");
    if (!chat) return;

    if (ziel.closest("[data-kopieren]")) {
      const knopf = ziel.closest("[data-kopieren]");
      const entwurf = chat.querySelector(".entwurf");
      const text = entwurf ? entwurf.textContent.trim() : "";
      inZwischenablage(text).then(() => {
        knopf.textContent = "Kopiert";
        knopf.classList.add("fertig");
        ansagen("Vorschlag kopiert.");
        window.setTimeout(() => {
          knopf.textContent = "Kopieren";
          knopf.classList.remove("fertig");
        }, 1600);
      }).catch(() => {
        knopf.textContent = "Nicht kopiert";
        window.setTimeout(() => { knopf.textContent = "Kopieren"; }, 1600);
      });
      return;
    }

    if (ziel.closest("[data-repo]")) {
      const knopf = ziel.closest("[data-repo]");
      const chatDaten = chatVonKarte.get(chat);
      const bereich = chat.querySelector("textarea");
      const fehler = chat.querySelector(".schreib-fehler");
      const textEingabe = bereich ? bereich.value.trim() : "";
      if (!chatDaten || knopf.disabled) return;
      if (!textEingabe) {
        if (fehler) {
          fehler.hidden = false;
          fehler.textContent = "Bitte etwas eintragen.";
        }
        return;
      }
      const entwurf = chat.querySelector(".entwurf");
      const vorschlagText = entwurf ? entwurf.textContent : "";
      const offen = offenerEintrag.get(chat);
      const eintrag = offen && offen.text === textEingabe && offen.vorschlag === vorschlagText
        ? offen
        : eintragBauen(chatDaten, textEingabe, vorschlagText);
      offenerEintrag.set(chat, eintrag);
      knopf.disabled = true;
      knopf.textContent = "Schreibe …";
      if (fehler) fehler.hidden = true;
      zustand.schreibend++;
      neuLadenKnopf();
      gespraecheAblegen(chatDaten, eintrag).then((liste) => {
        offenerEintrag.delete(chat);
        if (!zustand.token) return; // inzwischen abgemeldet
        zustand.gespraeche = liste;
        alleLogsZeichnen();
        if (bereich && bereich.value.trim() === textEingabe) bereich.value = "";
        knopf.textContent = "Im Repo";
        knopf.classList.add("fertig");
        ansagen("Ins private Repo geschrieben.");
        window.setTimeout(() => {
          knopf.textContent = "Ins Repo";
          knopf.classList.remove("fertig");
          knopf.disabled = false;
        }, 1600);
      }).catch((e) => {
        if (!(e instanceof NetzFehler)) offenerEintrag.delete(chat);
        if (!zustand.token) return; // inzwischen abgemeldet
        if (e instanceof GitHubFehler && e.status === 401) {
          tokenUngueltig(verstaendlich(e, GESPRAECHE_DATEI));
          return;
        }
        if (fehler) {
          fehler.hidden = false;
          fehler.textContent = schreibHinweis(e);
        }
        knopf.textContent = "Ins Repo";
        knopf.disabled = false;
      }).finally(() => {
        zustand.schreibend--;
        neuLadenKnopf();
      });
      return;
    }

    if (ziel.closest("[data-spaeter]")) {
      chat.classList.add("weg");
      const chatDaten = chatVonKarte.get(chat);
      if (chatDaten) wegMerken(chatDaten, true);
      zaehlen();
      const wieder = chat.querySelector(".wieder");
      if (wieder) wieder.focus();
      return;
    }

    if (ziel.closest(".wieder")) {
      chat.classList.remove("weg");
      const chatDaten = chatVonKarte.get(chat);
      if (chatDaten) wegMerken(chatDaten, false);
      zaehlen();
      const spaeter = chat.querySelector("[data-spaeter]");
      if (spaeter) spaeter.focus();
    }
  });

  zustand.token = speicherLesen(TOKEN_SCHLUESSEL);
  if (zustand.token) starten();
  else zeigen("anmeldung");
}

verdrahten();
