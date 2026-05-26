# Wohnungsverwaltung

Nebenkostenabrechnung & Hausverwaltung mit automatischer Belegerkennung per KI.

## Deployment auf Railway

1. Diesen Ordner als GitHub-Repo hochladen (Drag & Drop auf github.com)
2. Auf railway.app → "New Project" → "Deploy from GitHub Repo"
3. Unter "Variables" folgende Umgebungsvariable setzen:
   - `ANTHROPIC_API_KEY` = dein Anthropic API Key (sk-ant-...)
4. Railway startet die App automatisch

## Lokale Entwicklung

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... node server.js
```

Dann: http://localhost:3000
