# Wohnungsverwaltung v2

Professionelle Wohnungsverwaltung mit KI-Dokumentenanalyse.

## Deployment auf Railway

### 1. GitHub Repo
- Diesen Ordner als neues Repo `Wohnungsverwaltung` auf GitHub hochladen
- Inhalt des Ordners direkt ins Root (nicht den Ordner selbst)

### 2. Railway
- railway.app → New Project → Deploy from GitHub → Repo wählen
- Unter **Variables** folgende setzen:

```
ANTHROPIC_API_KEY = sk-ant-...
SESSION_SECRET = einLangesZufälligesPasswort123!
SETUP_KEY = IhrGeheimerSetupSchlüssel
NODE_ENV = production
```

### 3. PostgreSQL hinzufügen
- In Railway: + New → Database → PostgreSQL
- Railway setzt DATABASE_URL automatisch

### 4. Supabase Storage (für PDF-Speicherung)
- supabase.com → New Project → Storage → New Bucket "wohnverwaltung" (public)
- API Settings → URL und anon key kopieren
- In Railway Variables hinzufügen:
  ```
  SUPABASE_URL = https://xxx.supabase.co
  SUPABASE_KEY = eyJ...
  ```

### 5. Ersten Benutzer anlegen
- App öffnen → "Ersteinrichtung" → Setup-Key eingeben → Heiko anlegen
- Wiederholen für Ines

## Lokale Entwicklung
```bash
npm install
cp .env.example .env  # Variablen eintragen
node src/server.js
```
