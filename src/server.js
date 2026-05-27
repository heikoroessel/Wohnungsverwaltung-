require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Supabase Storage
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'wohnverwaltung-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (req.session?.userId) return next();
  res.status(401).json({ error: 'Nicht angemeldet' });
};

// ── INIT DB ──
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL, name VARCHAR(100), created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS objekte (
        id SERIAL PRIMARY KEY, kuerzel VARCHAR(20) NOT NULL, name VARCHAR(200) NOT NULL,
        strasse VARCHAR(200), plz VARCHAR(10), ort VARCHAR(100), beschreibung TEXT,
        erstellt_am TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS einheiten (
        id SERIAL PRIMARY KEY, objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
        bezeichnung VARCHAR(100) NOT NULL, typ VARCHAR(50) DEFAULT 'wohnung',
        flaeche DECIMAL(8,2), zimmer INTEGER, lage VARCHAR(100), erstellt_am TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS mieter (
        id SERIAL PRIMARY KEY, einheit_id INTEGER REFERENCES einheiten(id) ON DELETE CASCADE,
        vorname VARCHAR(100), nachname VARCHAR(100) NOT NULL, email VARCHAR(200),
        telefon VARCHAR(50), strasse VARCHAR(200), plz VARCHAR(10), ort VARCHAR(100),
        einzug_datum DATE, auszug_datum DATE, nk_vorauszahlung DECIMAL(10,2),
        miete_kalt DECIMAL(10,2), kaution DECIMAL(10,2), kaution_bezahlt BOOLEAN DEFAULT FALSE,
        notizen TEXT, erstellt_am TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS dokumente (
        id SERIAL PRIMARY KEY, objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
        einheit_id INTEGER REFERENCES einheiten(id), mieter_id INTEGER REFERENCES mieter(id),
        typ VARCHAR(50) NOT NULL, bezeichnung VARCHAR(300) NOT NULL, jahr INTEGER,
        dateiname VARCHAR(300), storage_path VARCHAR(500), storage_url TEXT,
        groesse_bytes INTEGER, ki_analyse TEXT, notizen TEXT, hochgeladen_am TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS nk_abrechnungen (
        id SERIAL PRIMARY KEY, einheit_id INTEGER REFERENCES einheiten(id) ON DELETE CASCADE,
        mieter_id INTEGER REFERENCES mieter(id), dokument_id INTEGER REFERENCES dokumente(id),
        jahr INTEGER NOT NULL, zeitraum_von DATE, zeitraum_bis DATE,
        heizkosten DECIMAL(10,2) DEFAULT 0, warmwasser DECIMAL(10,2) DEFAULT 0,
        kaltwasser DECIMAL(10,2) DEFAULT 0, versicherung DECIMAL(10,2) DEFAULT 0,
        grundsteuer DECIMAL(10,2) DEFAULT 0, allgemeinstrom DECIMAL(10,2) DEFAULT 0,
        hausmeister DECIMAL(10,2) DEFAULT 0, reinigung DECIMAL(10,2) DEFAULT 0,
        muell DECIMAL(10,2) DEFAULT 0, aufzug DECIMAL(10,2) DEFAULT 0,
        gartenpflege DECIMAL(10,2) DEFAULT 0, winterdienst DECIMAL(10,2) DEFAULT 0,
        co2_mieteranteil DECIMAL(10,2) DEFAULT 0, sonstige DECIMAL(10,2) DEFAULT 0,
        summe_umlagefaehig DECIMAL(10,2) DEFAULT 0, vorauszahlungen DECIMAL(10,2) DEFAULT 0,
        saldo DECIMAL(10,2) DEFAULT 0, status VARCHAR(50) DEFAULT 'entwurf',
        brief_erstellt BOOLEAN DEFAULT FALSE, erstellt_am TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kosten_steuer (
        id SERIAL PRIMARY KEY, objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
        dokument_id INTEGER REFERENCES dokumente(id), jahr INTEGER NOT NULL,
        kategorie VARCHAR(100), bezeichnung VARCHAR(300), betrag_gesamt DECIMAL(10,2),
        betrag_35a DECIMAL(10,2), anbieter VARCHAR(200), datum DATE,
        notizen TEXT, erstellt_am TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Datenbank initialisiert');
  } catch(e) {
    console.error('DB Init Fehler:', e.message);
  }
}

// ── AUTH ROUTES ──
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Benutzer nicht gefunden' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Falsches Passwort' });
    req.session.userId = user.id;
    req.session.userName = user.name;
    res.json({ success: true, name: user.name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.post('/api/setup', async (req, res) => {
  const { setupKey, username, password, name } = req.body;
  if (setupKey !== (process.env.SETUP_KEY || 'wohnverwaltung2024')) {
    return res.status(403).json({ error: 'Ungültiger Setup-Key' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, name) VALUES ($1, $2, $3) ON CONFLICT (username) DO UPDATE SET password_hash = $2, name = $3',
      [username, hash, name]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ userId: req.session.userId, name: req.session.userName });
});

// ── OBJEKTE ──
app.get('/api/objekte', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, 
        COUNT(DISTINCT e.id) as einheiten_count,
        COUNT(DISTINCT m.id) FILTER (WHERE m.auszug_datum IS NULL) as aktive_mieter
      FROM objekte o
      LEFT JOIN einheiten e ON e.objekt_id = o.id
      LEFT JOIN mieter m ON m.einheit_id = e.id
      GROUP BY o.id ORDER BY o.kuerzel
    `);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/objekte', requireAuth, async (req, res) => {
  const { kuerzel, name, strasse, plz, ort, beschreibung } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO objekte (kuerzel, name, strasse, plz, ort, beschreibung) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [kuerzel, name, strasse, plz, ort, beschreibung]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/objekte/:id', requireAuth, async (req, res) => {
  const { kuerzel, name, strasse, plz, ort, beschreibung } = req.body;
  try {
    const result = await pool.query(
      'UPDATE objekte SET kuerzel=$1, name=$2, strasse=$3, plz=$4, ort=$5, beschreibung=$6 WHERE id=$7 RETURNING *',
      [kuerzel, name, strasse, plz, ort, beschreibung, req.params.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/objekte/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM objekte WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── EINHEITEN ──
app.get('/api/objekte/:objektId/einheiten', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, 
        m.vorname, m.nachname, m.einzug_datum, m.auszug_datum, 
        m.nk_vorauszahlung, m.miete_kalt, m.id as mieter_id
      FROM einheiten e
      LEFT JOIN mieter m ON m.einheit_id = e.id AND m.auszug_datum IS NULL
      WHERE e.objekt_id = $1 ORDER BY e.typ, e.bezeichnung
    `, [req.params.objektId]);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/objekte/:objektId/einheiten', requireAuth, async (req, res) => {
  const { bezeichnung, typ, flaeche, zimmer, lage } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO einheiten (objekt_id, bezeichnung, typ, flaeche, zimmer, lage) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.objektId, bezeichnung, typ || 'wohnung', flaeche, zimmer, lage]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/einheiten/:id', requireAuth, async (req, res) => {
  const { bezeichnung, typ, flaeche, zimmer, lage } = req.body;
  try {
    const result = await pool.query(
      'UPDATE einheiten SET bezeichnung=$1, typ=$2, flaeche=$3, zimmer=$4, lage=$5 WHERE id=$6 RETURNING *',
      [bezeichnung, typ, flaeche, zimmer, lage, req.params.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/einheiten/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM einheiten WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── MIETER ──
app.get('/api/einheiten/:einheitId/mieter', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM mieter WHERE einheit_id=$1 ORDER BY einzug_datum DESC',
      [req.params.einheitId]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/einheiten/:einheitId/mieter', requireAuth, async (req, res) => {
  const { vorname, nachname, email, telefon, strasse, plz, ort,
          einzug_datum, auszug_datum, nk_vorauszahlung, miete_kalt, kaution, notizen } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO mieter (einheit_id, vorname, nachname, email, telefon, strasse, plz, ort,
        einzug_datum, auszug_datum, nk_vorauszahlung, miete_kalt, kaution, notizen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.params.einheitId, vorname, nachname, email, telefon, strasse, plz, ort,
       einzug_datum || null, auszug_datum || null, nk_vorauszahlung, miete_kalt, kaution, notizen]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/mieter/:id', requireAuth, async (req, res) => {
  const { vorname, nachname, email, telefon, strasse, plz, ort,
          einzug_datum, auszug_datum, nk_vorauszahlung, miete_kalt, kaution, notizen } = req.body;
  try {
    const result = await pool.query(
      `UPDATE mieter SET vorname=$1, nachname=$2, email=$3, telefon=$4, strasse=$5, plz=$6,
        ort=$7, einzug_datum=$8, auszug_datum=$9, nk_vorauszahlung=$10, miete_kalt=$11,
        kaution=$12, notizen=$13 WHERE id=$14 RETURNING *`,
      [vorname, nachname, email, telefon, strasse, plz, ort,
       einzug_datum || null, auszug_datum || null, nk_vorauszahlung, miete_kalt, kaution, notizen, req.params.id]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/mieter/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM mieter WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DOKUMENTE ──
app.get('/api/objekte/:objektId/dokumente', requireAuth, async (req, res) => {
  const { jahr, typ } = req.query;
  try {
    let q = 'SELECT d.*, m.vorname, m.nachname FROM dokumente d LEFT JOIN mieter m ON m.id = d.mieter_id WHERE d.objekt_id=$1';
    const params = [req.params.objektId];
    if (jahr) { params.push(jahr); q += ` AND d.jahr=$${params.length}`; }
    if (typ) { params.push(typ); q += ` AND d.typ=$${params.length}`; }
    q += ' ORDER BY d.hochgeladen_am DESC';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/objekte/:objektId/dokumente', requireAuth, upload.single('file'), async (req, res) => {
  const { typ, bezeichnung, jahr, einheit_id, mieter_id, notizen } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Keine Datei' });

  try {
    let storagePath = null;
    let storageUrl = null;

    // Upload to Supabase if configured
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
      const fileName = `${req.params.objektId}/${jahr || 'allgemein'}/${Date.now()}_${file.originalname}`;
      const { data, error } = await supabase.storage
        .from('wohnverwaltung')
        .upload(fileName, file.buffer, { contentType: file.mimetype });
      if (!error && data) {
        storagePath = data.path;
        const { data: urlData } = supabase.storage.from('wohnverwaltung').getPublicUrl(data.path);
        storageUrl = urlData?.publicUrl;
      }
    }

    const result = await pool.query(
      `INSERT INTO dokumente (objekt_id, einheit_id, mieter_id, typ, bezeichnung, jahr, 
        dateiname, storage_path, storage_url, groesse_bytes, notizen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.params.objektId, einheit_id || null, mieter_id || null, typ, bezeichnung,
       jahr || null, file.originalname, storagePath, storageUrl, file.size, notizen]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/dokumente/:id', requireAuth, async (req, res) => {
  try {
    const doc = await pool.query('SELECT * FROM dokumente WHERE id=$1', [req.params.id]);
    if (doc.rows[0]?.storage_path && process.env.SUPABASE_URL) {
      await supabase.storage.from('wohnverwaltung').remove([doc.rows[0].storage_path]);
    }
    await pool.query('DELETE FROM dokumente WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── KI: Mietvertrag analysieren ──
app.post('/api/ki/analyse-mietvertrag', requireAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Keine Datei' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API Key fehlt' });

  try {
    const b64 = file.buffer.toString('base64');
    const prompt = `Du analysierst einen deutschen Mietvertrag. Antworte NUR mit einem JSON-Objekt, kein Markdown.

Extrahiere folgende Felder:
- mieter_vorname, mieter_nachname, mieter_email, mieter_telefon
- mieter_strasse, mieter_plz, mieter_ort (aktuelle Adresse des Mieters)
- einzug_datum (Format: YYYY-MM-DD)
- miete_kalt (Zahl, Kaltmiete pro Monat in Euro)
- nk_vorauszahlung (Zahl, Nebenkostenvorauszahlung pro Monat in Euro)
- kaution (Zahl, Kautionsbetrag in Euro)
- einheit_bezeichnung (z.B. "OG links", "Erdgeschoss", "Garage")
- objekt_adresse (vollständige Adresse des Mietobjekts)
- notizen (wichtige Sondervereinbarungen, max 2 Sätze)

Wenn ein Feld nicht gefunden wird, setze es auf null.`;

    const content = file.mimetype === 'application/pdf'
      ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }, { type: 'text', text: prompt }]
      : [{ type: 'image', source: { type: 'base64', media_type: file.mimetype, data: b64 } }, { type: 'text', text: prompt }];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5-20251001', max_tokens: 1000, messages: [{ role: 'user', content }] })
    });
    const data = await response.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    let parsed = {};
    try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); } catch(e) {}
    res.json({ success: true, data: parsed });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── KI: Hausverwaltungspaket analysieren ──
app.post('/api/ki/analyse-hvpaket', requireAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Keine Datei' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API Key fehlt' });

  try {
    const b64 = file.buffer.toString('base64');
    const prompt = `Du analysierst ein deutsches Hausverwaltungspaket (WEG-Abrechnung). Antworte NUR mit einem JSON-Objekt, kein Markdown.

Extrahiere für JEDE gefundene Wohneinheit/Verwaltungseinheit die umlagefähigen Kosten:

{
  "objekt_adresse": "vollständige Adresse",
  "abrechnungsjahr": 2025,
  "einheiten": [
    {
      "bezeichnung": "WE 12 / OG / Wohnung",
      "eigentuemerkennung": "z.B. 095001 WE 12",
      "umlagefaehig": {
        "heizkosten": 973.41,
        "warmwasser": 0,
        "kaltwasser": 314.88,
        "versicherung": 205.55,
        "grundsteuer": 0,
        "allgemeinstrom": 74.11,
        "hausmeister": 333.72,
        "reinigung": 40.32,
        "muell": 66.89,
        "aufzug": 353.71,
        "gartenpflege": 14.12,
        "winterdienst": 25.49,
        "co2_mieteranteil": 73.89,
        "sonstige": 0
      },
      "summe_umlagefaehig": 2423.10
    }
  ]
}

Wichtig: Nur Kosten aus Sektion "umlagefähig (Mieter)" extrahieren, NICHT "nicht umlagefähig".
Wenn CO₂-Kosten vorhanden: Mieteranteil (meist 70-80%) in co2_mieteranteil eintragen.`;

    const content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
      { type: 'text', text: prompt }
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5-20251001', max_tokens: 2000, messages: [{ role: 'user', content }] })
    });
    const data = await response.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    let parsed = {};
    try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); } catch(e) {}
    res.json({ success: true, data: parsed });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DASHBOARD Stats ──
app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const [objekte, mieter, dokumente] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM objekte'),
      pool.query('SELECT COUNT(*) FROM mieter WHERE auszug_datum IS NULL'),
      pool.query('SELECT COUNT(*) FROM dokumente')
    ]);
    res.json({
      objekte: parseInt(objekte.rows[0].count),
      aktive_mieter: parseInt(mieter.rows[0].count),
      dokumente: parseInt(dokumente.rows[0].count)
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SERVE FRONTEND ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start
const PORT = process.env.PORT || 3000;
initDb().then(() => {
  app.listen(PORT, () => console.log(`🏠 Wohnverwaltung läuft auf Port ${PORT}`));
});
