# WhatsApp-Pult · öffentliche Hülle

Leeres Dashboard für ungelesene WhatsApp-Chats und Antwortvorschläge.
Diese Seite enthält **keine Chat-Inhalte**. Alles Inhaltliche kommt zur
Laufzeit aus dem privaten Repo `benedictcberg-hue/whatsapp-pult`
(`stand.json`), gelesen mit einem eigenen GitHub-Token.

**Adresse:** https://benedictcberg-hue.github.io/whatsapp-pult-ui/

```
  WhatsApp Web (nur gelesen)          Betreiber
          |                                  |
          v                                  v
  whatsapp-pult/stand.json  <---- GitHub-API mit eigenem Token ----
  (privat: Namen, letzte Zeile, Vorschlag)
          |
          v
  whatsapp-pult-ui (diese Seite, GitHub Pages)
```

## Warum das Repo öffentlich sein darf

`index.html`, `app.js` und `style.css` sind eine leere Hülle. Kein Chat-Name,
kein Nachrichtentext, kein Entwurf. Das Token liegt nur im Browser
(localStorage oder Sitzung) und geht ausschließlich an `api.github.com`
(per Content-Security-Policy erzwungen). Keine Fremdbibliothek, kein Build,
kein Server. Es wird nur gelesen — Kopieren geht in die Zwischenablage,
„Nicht jetzt“ blendet lokal aus. Es wird nichts gesendet und nichts geschrieben.

## Einrichten (einmalig)

1. **Pages einschalten:** Repo → Settings → Pages → *Deploy from a branch* →
   Branch **main** / **(root)** → Save. Nach ca. einer Minute ist die Adresse oben live.
2. **Token anlegen:** https://github.com/settings/personal-access-tokens/new
   - Repository access: *Only select repositories* → `whatsapp-pult`
   - Permissions → Repository → **Contents: Read** (sonst nichts)
3. Seite öffnen, Token einfügen, „Verbinden“. Optional: Token in diesem Browser merken.

Lokal ohne Pages: Dateien direkt im Browser öffnen, oder
`python -m http.server` im Ordner.
