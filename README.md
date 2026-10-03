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

Lokal ohne Pages: Dateien direkt im Browser öffnen, oder
`python -m http.server` im Ordner.
