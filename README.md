# WhatsApp-Pult · öffentliche Hülle

Leeres Dashboard für ungelesene WhatsApp-Chats, Antwortvorschläge und eine
kurze Diskussion dazu. Diese Seite enthält **keine Chat-Inhalte**. Alles
Inhaltliche kommt zur Laufzeit aus dem privaten Repo
`benedictcberg-hue/whatsapp-pult`:

- `stand.json` — gelesen (Stand, letzte Zeile, Vorschlag)
- `gespraeche.json` — gelesen und, über „Ins Repo“, geschrieben

**Adresse:** https://benedictcberg-hue.github.io/whatsapp-pult-ui/

```
  WhatsApp Web (nur gelesen)              Browser
          |                                  |
          v                                  v
  whatsapp-pult (privat)  <---- api.github.com, Token nur im Browser ----
    stand.json                 gelesen
    gespraeche.json            gelesen und geschrieben („Ins Repo“)
          |
          v
  whatsapp-pult-ui (diese Seite, GitHub Pages)
```

Es geht **nichts** an WhatsApp. „Kopieren“ und „Nicht jetzt“ bleiben lokal
im Browser. „Ins Repo“ schreibt nur `gespraeche.json` im privaten Repo
(Branch `main`, GitHub Contents-API: erst GET für die SHA, dann PUT).

## Token

Fine-grained Personal Access Token, angelegt unter
https://github.com/settings/personal-access-tokens/new :

- Repository access: **nur** `whatsapp-pult` (keine weiteren Repos)
- Permissions → Repository → **Contents: Read and write**
- Sonst nichts

Das Token bleibt im Browser (localStorage oder nur die Sitzung) und geht
ausschließlich an `api.github.com`. Die Content-Security-Policy ist
unverändert: `connect-src` erlaubt nur `https://api.github.com`.

Fehlt das Schreibrecht, zeigt „Ins Repo“ die Meldung der API und weist
darauf hin, dass das Token **Contents: Read and write** auf `whatsapp-pult`
braucht.

## Warum das Repo öffentlich sein darf

`index.html`, `app.js` und `style.css` sind eine leere Hülle. Kein Chat-Name,
kein Nachrichtentext, kein Entwurf. Keine Fremdbibliothek, kein Build,
kein Server.

## Einrichten (einmalig)

1. **Pages** ist bereits an: Deploy from a branch, **main** / **(root)**.
   Adresse siehe oben.
2. **Token** wie oben: nur `whatsapp-pult`, Contents Read and write, sonst nichts.
3. Seite öffnen, Token einfügen, „Verbinden“. Optional: Token in diesem Browser merken.

Lokal ohne Pages: im Ordner `py -m http.server 8000` (Windows) bzw.
`python3 -m http.server 8000`, dann http://localhost:8000 öffnen.
Nicht per Doppelklick als `file://` öffnen: dort teilen sich alle lokalen
HTML-Dateien einen Browserspeicher, ein gemerktes Token wäre für sie lesbar.

## Verhalten bei Fehlern

- Fällt nur `gespraeche.json` aus, bleibt das Dashboard da; ein Hinweis
  sagt, dass das Log nicht geladen ist. „Ins Repo“ liest vor dem Schreiben neu.
- „Ins Repo“ schreibt nie über ein Log, das es nicht vollständig gelesen hat:
  über 1 MB wird der Inhalt über die Blob-SHA nachgeladen; kein Objekt,
  „gespraeche“ keine Liste oder kein UTF-8 → Abbruch, nichts geschrieben.
- Konflikte (409/422) werden bis zu dreimal neu gelesen und angehängt.
  Kam die Antwort eines Schreibvorgangs nicht an, wird derselbe Eintrag
  beim nächsten Klick erkannt und nicht doppelt geschrieben.
- „Neu laden“ behält getippten Text und „Nicht jetzt“. „Nicht jetzt“ merkt
  sich nur einen Prüfwert aus Chat und letzter Zeile, keinen Namen, keinen Text.
- Das Token wird erst gespeichert, wenn der Stand geladen ist.

## Prüfung

`pruefung/pult-test.js` öffnet die Seite in Chromium und stellt die
GitHub-API nach: nur erfundene Daten, kein Netz, kein Token. Geprüft werden
u. a. Schreiben mit Konflikt, Log über 1 MB, Ausfall des Logs, 401/403/404,
offline, kaputte Daten, 360 px Breite, „Nicht jetzt“ und Entwürfe beim
Neu laden.

```
npm install -g playwright
npx playwright install chromium
node pruefung/pult-test.js            (Windows: node pruefung\pult-test.js)
```
