/* WhatsApp-Pult — öffentliche Hülle. Liest stand.json aus dem privaten Repo
 * über die GitHub-API. Kein Server, kein Build, keine Fremdbibliothek.
 * Das Token bleibt im Browser und geht nur an api.github.com.
 * Diese Datei enthält keine Chat-Namen und keinen Nachrichtentext.
 */
"use strict";

const OWNER = "benedictcberg-hue";
const REPO = "whatsapp-pult";
const DATEI = "stand.json";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const TOKEN_SCHLUESSEL = "whatsapp-pult-token";

const zustand = {
  token: "",
  stand: null,
};

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

async function standLaden() {
  const url = `${API}/contents/${DATEI}`;
  const antwort = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${zustand.token}`,
      Accept: "application/vnd.github.raw+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!antwort.ok) {
    let text = antwort.statusText;
    try {
      const j = await antwort.json();
      text = j.message || text;
    } catch (_) {
      try { text = (await antwort.text()) || text; } catch (__) { /* egal */ }
    }
    throw new GitHubFehler(antwort.status, text);
  }
  const roh = await antwort.text();
  return JSON.parse(roh);
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

  const body = el("div", { class: "chat-body" },
    el("blockquote", { text: letzte }),
    el("div", { class: "vorschlag" },
      el("span", { class: "etikett", text: "Vorschlag · nicht gesendet" }),
      el("p", { class: "entwurf", text: vorschlag })
    ),
    el("div", { class: "aktionen" }, kopie, spaeter)
  );

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
  return artikel;
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
    ? "Quelle: WhatsApp Web, nur gelesen. Stand " + stand + "."
    : "Quelle: WhatsApp Web, nur gelesen.";
  boardZeichnen(daten);
  kennzahlenZeichnen(daten);
  zuletztZeichnen(daten);
  hinweisZeichnen(daten);
  zeigen("dashboard");
}

async function starten() {
  zeigen("lade");
  $("anmeldung-fehler").hidden = true;
  try {
    const daten = await standLaden();
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
  $("board").replaceChildren();
  $("kennzahlen").replaceChildren();
  $("zuletzt").replaceChildren();
  $("hinweis").replaceChildren();
  $("zuletzt-box").hidden = true;
  $("hinweis-box").hidden = true;
  $("stand-meta").textContent = "";
  $("fuss").textContent = "";
  $("leer").classList.remove("sichtbar");
}

function verdrahten() {
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
