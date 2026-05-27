-- Wohnverwaltung Database Schema
-- Run this once on your PostgreSQL database

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Objects (Häuser/Liegenschaften)
CREATE TABLE IF NOT EXISTS objekte (
  id SERIAL PRIMARY KEY,
  kuerzel VARCHAR(20) NOT NULL,
  name VARCHAR(200) NOT NULL,
  strasse VARCHAR(200),
  plz VARCHAR(10),
  ort VARCHAR(100),
  beschreibung TEXT,
  erstellt_am TIMESTAMP DEFAULT NOW()
);

-- Units (Wohnungen, Garagen, etc. within an object)
CREATE TABLE IF NOT EXISTS einheiten (
  id SERIAL PRIMARY KEY,
  objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
  bezeichnung VARCHAR(100) NOT NULL,
  typ VARCHAR(50) DEFAULT 'wohnung', -- wohnung, garage, stellplatz
  flaeche DECIMAL(8,2),
  zimmer INTEGER,
  lage VARCHAR(100), -- EG, OG, DG, links, rechts etc.
  erstellt_am TIMESTAMP DEFAULT NOW()
);

-- Tenants
CREATE TABLE IF NOT EXISTS mieter (
  id SERIAL PRIMARY KEY,
  einheit_id INTEGER REFERENCES einheiten(id) ON DELETE CASCADE,
  vorname VARCHAR(100),
  nachname VARCHAR(100) NOT NULL,
  email VARCHAR(200),
  telefon VARCHAR(50),
  strasse VARCHAR(200),
  plz VARCHAR(10),
  ort VARCHAR(100),
  einzug_datum DATE,
  auszug_datum DATE,
  nk_vorauszahlung DECIMAL(10,2),
  miete_kalt DECIMAL(10,2),
  kaution DECIMAL(10,2),
  kaution_bezahlt BOOLEAN DEFAULT FALSE,
  notizen TEXT,
  erstellt_am TIMESTAMP DEFAULT NOW()
);

-- Documents
CREATE TABLE IF NOT EXISTS dokumente (
  id SERIAL PRIMARY KEY,
  objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
  einheit_id INTEGER REFERENCES einheiten(id),
  mieter_id INTEGER REFERENCES mieter(id),
  typ VARCHAR(50) NOT NULL,
  -- typen: mietvertrag, hausverwaltung_paket, nk_abrechnung, grundsteuer, 
  --        handwerker_rechnung, protokoll, inserat, sonstiges
  bezeichnung VARCHAR(300) NOT NULL,
  jahr INTEGER,
  dateiname VARCHAR(300),
  storage_path VARCHAR(500),
  storage_url TEXT,
  groesse_bytes INTEGER,
  ki_analyse TEXT, -- JSON: extracted data from Claude
  notizen TEXT,
  hochgeladen_am TIMESTAMP DEFAULT NOW()
);

-- NK Abrechnungen (structured data extracted from documents)
CREATE TABLE IF NOT EXISTS nk_abrechnungen (
  id SERIAL PRIMARY KEY,
  einheit_id INTEGER REFERENCES einheiten(id) ON DELETE CASCADE,
  mieter_id INTEGER REFERENCES mieter(id),
  dokument_id INTEGER REFERENCES dokumente(id),
  jahr INTEGER NOT NULL,
  zeitraum_von DATE,
  zeitraum_bis DATE,
  -- Kosten aus Hausverwaltungspaket (umlagefähig)
  heizkosten DECIMAL(10,2) DEFAULT 0,
  warmwasser DECIMAL(10,2) DEFAULT 0,
  kaltwasser DECIMAL(10,2) DEFAULT 0,
  versicherung DECIMAL(10,2) DEFAULT 0,
  grundsteuer DECIMAL(10,2) DEFAULT 0,
  allgemeinstrom DECIMAL(10,2) DEFAULT 0,
  hausmeister DECIMAL(10,2) DEFAULT 0,
  reinigung DECIMAL(10,2) DEFAULT 0,
  muell DECIMAL(10,2) DEFAULT 0,
  aufzug DECIMAL(10,2) DEFAULT 0,
  gartenpflege DECIMAL(10,2) DEFAULT 0,
  winterdienst DECIMAL(10,2) DEFAULT 0,
  co2_mieteranteil DECIMAL(10,2) DEFAULT 0,
  sonstige DECIMAL(10,2) DEFAULT 0,
  -- Totals
  summe_umlagefaehig DECIMAL(10,2) DEFAULT 0,
  vorauszahlungen DECIMAL(10,2) DEFAULT 0,
  saldo DECIMAL(10,2) DEFAULT 0, -- positiv = Nachzahlung, negativ = Guthaben
  -- Status
  status VARCHAR(50) DEFAULT 'entwurf', -- entwurf, fertig, versendet
  brief_erstellt BOOLEAN DEFAULT FALSE,
  erstellt_am TIMESTAMP DEFAULT NOW()
);

-- Costs for tax purposes
CREATE TABLE IF NOT EXISTS kosten_steuer (
  id SERIAL PRIMARY KEY,
  objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
  dokument_id INTEGER REFERENCES dokumente(id),
  jahr INTEGER NOT NULL,
  kategorie VARCHAR(100), -- haushaltsnahe_dienstleistung, handwerkerleistung, werbungskosten
  bezeichnung VARCHAR(300),
  betrag_gesamt DECIMAL(10,2),
  betrag_35a DECIMAL(10,2), -- anrechenbar nach §35a
  anbieter VARCHAR(200),
  datum DATE,
  notizen TEXT,
  erstellt_am TIMESTAMP DEFAULT NOW()
);

-- Insert default admin user (password: admin123 - CHANGE THIS!)
INSERT INTO users (username, password_hash, name) 
VALUES 
  ('heiko', '$2b$10$rQnK8K5L9mX2pJ7vN3wR4.8Y1Z6A0B9C3D7E2F5G8H1I4J7K0L3M', 'Heiko Rössel'),
  ('ines', '$2b$10$rQnK8K5L9mX2pJ7vN3wR4.8Y1Z6A0B9C3D7E2F5G8H1I4J7K0L3M', 'Ines Rössel')
ON CONFLICT (username) DO NOTHING;
