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

const zustand = {
  token: "",
  stand: null,
  gespraeche: [],
};

const chatVonKarte = new WeakMap();

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
  constructor(status, text) {
    super(`${status}: ${text}`);
    this.status = status;
  }
}

function zeigen(was) {
  $("anmeldung").hidden = was !== "anmeldung";
  $("lade").hidden = was !== "lade";
  $("dashboard").hidden = was !== "dashboard";
  const verbunden = was === "dashboard";
  $("verbindung").hidden = !verbunden;
  $("neu-laden").hidden = !verbunden;
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
    const j = await antwort.json();
    text = j.message || text;
  } catch (_) {
    try { text = (await antwort.text()) || text; } catch (__) { /* egal */ }
  }
  return new GitHubFehler(antwort.status, text);
}

async function standLaden() {
  const url = `${API}/contents/${DATEI}?ref=${encodeURIComponent(BRANCH)}`;
  const antwort = await fetch(url, {
    cache: "no-store",
    headers: githubKopf("application/vnd.github.raw+json"),
  });
  if (!antwort.ok) throw await fehlerAus(antwort);
  return JSON.parse(await antwort.text());
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

function base64NachUtf8(b64) {
  const rein = String(b64 || "").replace(/\s/g, "");
  if (!rein) return "";
  const bin = atob(rein);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function gespraecheObjekt(roh) {
  const text = String(roh || "").trim();
  if (!text) return { gespraeche: [] };
  const daten = JSON.parse(text);
  if (!daten || typeof daten !== "object" || Array.isArray(daten)) {
    throw new Error("gespraeche.json hat kein Objekt. Nichts geschrieben.");
  }
  if (!Array.isArray(daten.gespraeche)) daten.gespraeche = [];
  return daten;
}

async function gespraecheLaden() {
  const url = `${API}/contents/${GESPRAECHE_DATEI}?ref=${encodeURIComponent(BRANCH)}`;
  const antwort = await fetch(url, {
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
  if (eintrag && eintrag.typ) return false;
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
  const meldung = e && e.message ? e.message : String(e);
  const status = e instanceof GitHubFehler ? e.status : 0;
  const fehltRecht = status === 403 || /resource not accessible|not accessible by integration|write access|contents permission/i.test(meldung);
  if (fehltRecht) {
    return meldung + " Das Token braucht Contents: Read and write auf whatsapp-pult.";
  }
  return meldung;
}

async function gespraecheLesenMitSha() {
  const url = `${API}/contents/${GESPRAECHE_DATEI}?ref=${encodeURIComponent(BRANCH)}`;
  const antwort = await fetch(url, {
    cache: "no-store",
    headers: githubKopf("application/vnd.github+json"),
  });
  if (antwort.status === 404) return { sha: null, daten: { gespraeche: [] } };
  if (!antwort.ok) throw await fehlerAus(antwort);
  const meta = await antwort.json();
  let daten;
  try {
    daten = gespraecheObjekt(base64NachUtf8(meta.content));
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error("gespraeche.json ist kein gültiges JSON. Nichts geschrieben.");
    }
    throw e;
  }
  return { sha: meta.sha || null, daten };
}

async function gespraecheAblegen(chat, text, vorschlag) {
  const url = `${API}/contents/${GESPRAECHE_DATEI}`;
  const name = String((chat && chat.name) || "").replace(/[\r\n]+/g, " ").trim();
  let letzterFehler = null;
  for (let versuch = 0; versuch < 2; versuch++) {
    const { sha, daten } = await gespraecheLesenMitSha();
    daten.gespraeche.push(eintragBauen(chat, text, vorschlag));
    const inhalt = JSON.stringify(daten, null, 2) + "\n";
    const koerper = {
      message: "Gespraech: " + name,
      content: utf8NachBase64(inhalt),
      branch: BRANCH,
    };
    if (sha) koerper.sha = sha;
    const antwort = await fetch(url, {
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
    if (letzterFehler.status !== 409) throw letzterFehler;
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

function kennzahlenZeichnen(daten) {
  const ungelesen = Array.isArray(daten.ungelesen) ? daten.ungelesen : [];
  const sichtbar = $("board").querySelectorAll("article.chat:not(.weg)").length;
  const nachrichten = ungelesen.reduce((s, c) => s + (Number(c.anzahl) || 0), 0);
  const kasten = [
    { wert: ungelesen.length, label: "Ungelesene Chats" },
    { wert: nachrichten, label: "Nachrichten offen" },
    { wert: ungelesen.length, label: "Warten auf dich", klasse: "warten" },
    { wert: sichtbar, label: "Vorschläge bereit", klasse: "ok", id: "bereit" },
  ];
  $("kennzahlen").replaceChildren(...kasten.map((k) =>
    el("article", { class: "kennzahl" + (k.klasse ? " " + k.klasse : "") },
      el("b", k.id ? { id: k.id, text: String(k.wert) } : { text: String(k.wert) }),
      el("span", { text: k.label })
    )
  ));
}

function zaehlen() {
  const n = $("board").querySelectorAll("article.chat:not(.weg)").length;
  const bereit = $("bereit");
  if (bereit) bereit.textContent = String(n);
  $("leer").classList.toggle("sichtbar", n === 0);
}

function chatKarte(chat) {
  const name = String(chat.name || "");
  const zeit = String(chat.zeit || "");
  const anzahl = Number(chat.anzahl) || 0;
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
    placeholder: "Nur ins private Repo. Nicht an WhatsApp.",
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

  const artikel = el("article", {
    class: "chat",
    "data-chat-id": hatChatId(chat.id) ? String(chat.id) : false,
  },
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
  const liste = (Array.isArray(zustand.gespraeche) ? zustand.gespraeche : []).filter((e) => passtZuChat(e, chat));
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

function boardZeichnen(daten) {
  const liste = Array.isArray(daten.ungelesen) ? daten.ungelesen : [];
  $("board").replaceChildren(...liste.map(chatKarte));
  $("blick-unter").textContent = liste.length
    ? (liste.length === 1 ? "Ein Chat, letzte Zeile, ein Entwurf." : liste.length + " Chats, letzte Zeile, ein Entwurf.")
    : "Keine wartenden Chats.";
  zaehlen();
}

function zuletztZeichnen(daten) {
  const liste = Array.isArray(daten.zuletzt) ? daten.zuletzt : [];
  const box = $("zuletzt-box");
  if (!liste.length) {
    box.hidden = true;
    $("zuletzt").replaceChildren();
    return;
  }
  box.hidden = false;
  $("zuletzt").replaceChildren(...liste.map((eintrag) => {
    const statusKinder = [String(eintrag.status || "")];
    if (eintrag.ticks) {
      statusKinder.push(" ");
      statusKinder.push(el("span", { class: "ticks", "aria-hidden": "true", text: "✓✓" }));
    }
    return el("article", {
      class: "ruhig-karte",
      "data-chat-id": hatChatId(eintrag.id) ? String(eintrag.id) : false,
    },
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
  const liste = Array.isArray(daten.hinweis) ? daten.hinweis : [];
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
    return el("article", {
      class: "notiz-karte",
      "data-chat-id": hatChatId(eintrag.id) ? String(eintrag.id) : false,
    },
      el("strong", { text: name }),
      zeit ? el("span", { class: "zeit", text: zeit }) : null,
      el("p", { text: text })
    );
  }));
}


function zielFinden(id) {
  const ziel = String(id || "");
  if (!ziel) return null;
  const alle = document.querySelectorAll("[data-chat-id]");
  let fallback = null;
  for (const knoten of alle) {
    if (knoten.getAttribute("data-chat-id") !== ziel) continue;
    if (knoten.classList.contains("chat")) return knoten;
    if (!fallback) fallback = knoten;
  }
  return fallback;
}

function uebersichtZeichnen(daten) {
  const liste = Array.isArray(daten.chats) ? daten.chats : [];
  const box = $("uebersicht-liste");
  if (!liste.length) {
    box.replaceChildren(el("p", { class: "leer-zeile", text: "Keine Chats im Stand." }));
    return;
  }
  box.replaceChildren(...liste.map((chat) => {
    if (chat && chat.neu) {
      return el("div", { class: "neu-slot" },
        el("span", { class: "pille pille-ruhig", text: String(chat.marke || "neu") }),
        el("span", { text: String(chat.hinweis || "Platz für neue Chats") })
      );
    }
    const ungelesen = Number(chat.ungelesen || chat.anzahl) || 0;
    const vorschau = String(chat.vorschau || chat.letzte || chat.text || "");
    return el("button", {
      type: "button",
      class: "chat-zeile" + (ungelesen ? " hat-ungelesen" : ""),
      "data-sprung": hatChatId(chat.id) ? String(chat.id) : false,
    },
      el("span", { class: "name", text: String(chat.name || "") }),
      el("span", { class: "zeit", text: String(chat.zeit || "") }),
      ungelesen
        ? el("span", { class: "badge", text: String(ungelesen) })
        : el("span", { class: "badge-platz", "aria-hidden": "true" }),
      el("span", { class: "vorschau", text: vorschau })
    );
  }));
}

function aufgabenZeichnen(daten) {
  const liste = Array.isArray(daten.aufgaben) ? daten.aufgaben : [];
  const box = $("aufgaben");
  if (!liste.length) {
    box.replaceChildren(el("p", { class: "leer-zeile", text: "Keine Aufgaben aus den Gesprächen." }));
    return;
  }
  box.className = "aufgaben-liste";
  box.replaceChildren(...liste.map((eintrag) => {
    const titel = String(eintrag.titel || eintrag.name || "");
    const status = String(eintrag.status || "");
    const kinder = [
      el("div", { class: "name-zeile" },
        el("span", { class: "name", text: titel }),
        status ? el("span", { class: "pille pille-amber", text: status }) : null
      ),
    ];
    if (eintrag.optional) kinder.push(el("span", { class: "meta-klein", text: "optional" }));
    if (eintrag.quelle) kinder.push(el("p", { text: "Quelle: " + String(eintrag.quelle) }));
    if (eintrag.datum) kinder.push(el("p", { text: String(eintrag.datum) }));
    return el("article", { class: "aufgabe" }, ...kinder);
  }));
}

function timerZeichnen(daten) {
  const liste = Array.isArray(daten.timer) ? daten.timer : [];
  const box = $("timer");
  if (!liste.length) {
    box.replaceChildren(el("p", { class: "leer-zeile", text: "Kein Alarm." }));
    return;
  }
  box.replaceChildren(...liste.map((eintrag) => {
    const alarm = String(eintrag.alarm || eintrag.wann || "");
    return el("article", { class: "timer-karte" },
      el("span", { class: "name", text: String(eintrag.name || "") }),
      el("time", { datetime: alarm, text: zeitAnzeige(alarm) || alarm }),
      eintrag.dauer ? el("span", { text: String(eintrag.dauer) }) : null,
      eintrag.text ? el("span", { class: "vorschau", text: String(eintrag.text) }) : null,
      el("span", { class: "meta-klein", text: "Quelle: " + String(eintrag.quelle || "") })
    );
  }));
}

function termineZeichnen(daten) {
  const liste = Array.isArray(daten.termine) ? daten.termine : [];
  const box = $("termine");
  if (!liste.length) {
    box.replaceChildren(el("p", { class: "leer-zeile", text: "Keine Termine aus den Gesprächen." }));
    return;
  }
  box.className = "termin-liste";
  box.replaceChildren(...liste.map((eintrag) => {
    const titel = String(eintrag.titel || eintrag.name || eintrag.text || "");
    const wann = String(eintrag.wann || eintrag.zeit || eintrag.datum || "");
    return el("article", { class: "termin-karte" },
      el("div", { class: "name-zeile" },
        el("span", { class: "name", text: titel }),
        wann ? el("span", { class: "zeit", text: wann }) : null
      ),
      eintrag.quelle ? el("p", { text: "Quelle: " + String(eintrag.quelle) }) : null
    );
  }));
}

async function wunschAblegen() {
  const url = `${API}/contents/${GESPRAECHE_DATEI}`;
  let letzterFehler = null;
  for (let versuch = 0; versuch < 2; versuch++) {
    const { sha, daten } = await gespraecheLesenMitSha();
    daten.gespraeche.push({
      typ: "neue-vorschlaege",
      zeit: new Date().toISOString(),
    });
    const inhalt = JSON.stringify(daten, null, 2) + "\n";
    const koerper = {
      message: "Wunsch: neue Vorschlaege",
      content: utf8NachBase64(inhalt),
      branch: BRANCH,
    };
    if (sha) koerper.sha = sha;
    const antwort = await fetch(url, {
      method: "PUT",
      cache: "no-store",
      headers: {
        ...githubKopf("application/vnd.github+json"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(koerper),
    });
    if (antwort.ok) return;
    letzterFehler = await fehlerAus(antwort);
    if (letzterFehler.status !== 409) throw letzterFehler;
  }
  throw letzterFehler;
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
  uebersichtZeichnen(daten);
  aufgabenZeichnen(daten);
  timerZeichnen(daten);
  termineZeichnen(daten);
  zuletztZeichnen(daten);
  hinweisZeichnen(daten);
  zeigen("dashboard");
}

async function starten() {
  zeigen("lade");
  $("anmeldung-fehler").hidden = true;
  try {
    const daten = await standLaden();
    const gespraeche = await gespraecheLaden();
    zustand.gespraeche = Array.isArray(gespraeche.gespraeche) ? gespraeche.gespraeche : [];
    dashboardZeichnen(daten);
  } catch (e) {
    const f = $("anmeldung-fehler");
    if (e instanceof GitHubFehler && e.status === 401) {
      speicherLoeschen(TOKEN_SCHLUESSEL);
      zustand.token = "";
      f.textContent = e.message;
    } else if (e instanceof GitHubFehler) {
      f.textContent = e.message;
    } else {
      f.textContent = String(e && e.message ? e.message : e);
    }
    f.hidden = false;
    zeigen("anmeldung");
    $("abmelden").hidden = !zustand.token;
  }
}

function dashboardLeeren() {
  zustand.stand = null;
  zustand.gespraeche = [];
  $("board").replaceChildren();
  $("kennzahlen").replaceChildren();
  $("zuletzt").replaceChildren();
  $("hinweis").replaceChildren();
  $("uebersicht-liste").replaceChildren();
  $("uebersicht-liste").classList.remove("offen");
  $("uebersicht-toggle").textContent = "runter";
  $("uebersicht-toggle").setAttribute("aria-expanded", "false");
  $("aufgaben").replaceChildren();
  $("timer").replaceChildren();
  $("termine").replaceChildren();
  $("wunsch-note").hidden = true;
  $("wunsch-note").textContent = "";
  $("wunsch-fehler").hidden = true;
  $("zuletzt-box").hidden = true;
  $("hinweis-box").hidden = true;
  $("stand-meta").textContent = "";
  $("fuss").textContent = "";
  $("leer").classList.remove("sichtbar");
}

function verdrahten() {
  $("uebersicht-toggle").addEventListener("click", () => {
    const liste = $("uebersicht-liste");
    const offen = liste.classList.toggle("offen");
    const knopf = $("uebersicht-toggle");
    knopf.textContent = offen ? "hoch" : "runter";
    knopf.setAttribute("aria-expanded", offen ? "true" : "false");
  });

  $("uebersicht-liste").addEventListener("click", (ev) => {
    const ziel = ev.target instanceof Element ? ev.target.closest("[data-sprung]") : null;
    if (!ziel) return;
    const karte = zielFinden(ziel.getAttribute("data-sprung"));
    if (!karte) return;
    karte.scrollIntoView({ behavior: "smooth", block: "start" });
    karte.classList.add("sprung");
    window.setTimeout(() => karte.classList.remove("sprung"), 1600);
  });

  $("neue-vorschlaege").addEventListener("click", () => {
    const knopf = $("neue-vorschlaege");
    const note = $("wunsch-note");
    const fehler = $("wunsch-fehler");
    if (!zustand.token || knopf.disabled) return;
    knopf.disabled = true;
    knopf.textContent = "Schreibe …";
    fehler.hidden = true;
    wunschAblegen().then(() => {
      note.hidden = false;
      note.textContent = "Wunsch liegt im Repo, Vorschläge kommen mit dem nächsten Stand.";
      knopf.textContent = "Neue Vorschläge";
      knopf.disabled = false;
    }).catch((e) => {
      fehler.hidden = false;
      fehler.textContent = schreibHinweis(e);
      knopf.textContent = "Neue Vorschläge";
      knopf.disabled = false;
    });
  });

  $("token-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const wert = $("token-eingabe").value.trim();
    if (!wert) return;
    zustand.token = wert;
    speicherSchreiben(TOKEN_SCHLUESSEL, wert, $("token-merken").checked);
    $("token-eingabe").value = "";
    $("anmeldung-fehler").hidden = true;
    starten();
  });

  $("abmelden").addEventListener("click", () => {
    speicherLoeschen(TOKEN_SCHLUESSEL);
    zustand.token = "";
    dashboardLeeren();
    zeigen("anmeldung");
    $("abmelden").hidden = true;
  });

  $("neu-laden").addEventListener("click", () => {
    if (zustand.token) starten();
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
      knopf.disabled = true;
      knopf.textContent = "Schreibe …";
      if (fehler) fehler.hidden = true;
      gespraecheAblegen(chatDaten, textEingabe, vorschlagText).then((liste) => {
        zustand.gespraeche = liste;
        const log = chat.querySelector(".gespraech-log");
        if (log) logZeichnen(log, chatDaten);
        if (bereich) bereich.value = "";
        knopf.textContent = "Im Repo";
        knopf.classList.add("fertig");
        window.setTimeout(() => {
          knopf.textContent = "Ins Repo";
          knopf.classList.remove("fertig");
          knopf.disabled = false;
        }, 1600);
      }).catch((e) => {
        if (fehler) {
          fehler.hidden = false;
          fehler.textContent = schreibHinweis(e);
        }
        knopf.textContent = "Ins Repo";
        knopf.disabled = false;
      });
      return;
    }

    if (ziel.closest("[data-spaeter]")) {
      chat.classList.add("weg");
      zaehlen();
      return;
    }

    if (ziel.closest(".wieder")) {
      chat.classList.remove("weg");
      zaehlen();
    }
  });

  zustand.token = speicherLesen(TOKEN_SCHLUESSEL);
  if (zustand.token) starten();
  else zeigen("anmeldung");
}

verdrahten();
