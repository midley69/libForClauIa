/*
  # Configuration initiale LiberTalk

  1. Nouvelles Tables
    - `online_users`
      - `id` (uuid, primary key)
      - `user_id` (text, unique)
      - `status` (text, enum: online/chat/video/group)
      - `location` (text, optionnel)
      - `last_seen` (timestamptz)
      - `created_at` (timestamptz)
    
    - `groups`
      - `id` (uuid, primary key)
      - `name` (text)
      - `description` (text)
      - `member_count` (integer)
      - `is_active` (boolean)
      - `category` (text)
      - `location` (text, optionnel)
      - `last_activity` (timestamptz)
      - `created_at` (timestamptz)
      - `created_by` (text)

  2. Sécurité
    - Enable RLS sur toutes les tables
    - Politiques pour permettre toutes les opérations (app publique)

  3. Performance
    - Index sur les colonnes fréquemment utilisées
    - Fonctions de nettoyage automatique

  4. Temps réel
    - Tables configurées pour Realtime
*/

-- =============================================
-- TABLE: online_users
-- =============================================

CREATE TABLE IF NOT EXISTS online_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('online', 'chat', 'video', 'group')),
  location TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_online_users_status ON online_users(status);
CREATE INDEX IF NOT EXISTS idx_online_users_last_seen ON online_users(last_seen);
CREATE INDEX IF NOT EXISTS idx_online_users_user_id ON online_users(user_id);

-- Activer RLS (Row Level Security)
ALTER TABLE online_users ENABLE ROW LEVEL SECURITY;

-- Politique pour permettre toutes les opérations (app publique)
CREATE POLICY "Allow all operations on online_users" ON online_users
  FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- TABLE: groups
-- =============================================

CREATE TABLE IF NOT EXISTS groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  member_count INTEGER DEFAULT 1 CHECK (member_count >= 0),
  is_active BOOLEAN DEFAULT true,
  category TEXT DEFAULT 'Créé par utilisateur',
  location TEXT,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_groups_active ON groups(is_active);
CREATE INDEX IF NOT EXISTS idx_groups_last_activity ON groups(last_activity);
CREATE INDEX IF NOT EXISTS idx_groups_member_count ON groups(member_count);
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups(created_by);

-- Activer RLS (Row Level Security)
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Politique pour permettre toutes les opérations (app publique)
CREATE POLICY "Allow all operations on groups" ON groups
  FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- FONCTIONS DE NETTOYAGE AUTOMATIQUE
-- =============================================

-- Fonction pour nettoyer les utilisateurs inactifs (plus de 2 minutes)
CREATE OR REPLACE FUNCTION cleanup_inactive_users()
RETURNS void AS $$
BEGIN
  DELETE FROM online_users 
  WHERE last_seen < NOW() - INTERVAL '2 minutes';
  
  -- Log du nettoyage
  RAISE NOTICE 'Nettoyage des utilisateurs inactifs effectué à %', NOW();
END;
$$ LANGUAGE plpgsql;

-- Fonction pour nettoyer les groupes inactifs (plus de 15 minutes)
CREATE OR REPLACE FUNCTION cleanup_inactive_groups()
RETURNS void AS $$
BEGIN
  DELETE FROM groups 
  WHERE last_activity < NOW() - INTERVAL '15 minutes'
  AND is_active = true;
  
  -- Log du nettoyage
  RAISE NOTICE 'Nettoyage des groupes inactifs effectué à %', NOW();
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- DONNÉES DE TEST (optionnel)
-- =============================================

-- Insérer quelques utilisateurs de test
INSERT INTO online_users (user_id, status, location) VALUES
  ('test_user_1', 'online', 'Paris, France'),
  ('test_user_2', 'chat', 'Lyon, France'),
  ('test_user_3', 'video', 'Marseille, France')
ON CONFLICT (user_id) DO NOTHING;

-- Insérer quelques groupes de test
INSERT INTO groups (name, description, member_count, category, location, created_by) VALUES
  ('Gamers Zone', 'Discussion sur les jeux vidéo', 5, 'Gaming', 'Paris, France', 'test_user_1'),
  ('Cinéphiles', 'Parlons de films et séries', 3, 'Divertissement', 'Lyon, France', 'test_user_2'),
  ('Tech Talk', 'Discussions technologiques', 7, 'Technologie', 'Marseille, France', 'test_user_3')
ON CONFLICT DO NOTHING;

-- =============================================
-- CONFIGURATION REALTIME
-- =============================================

-- Note: Vous devez activer manuellement Realtime dans le dashboard Supabase
-- Allez dans Settings > API > Realtime et activez :
-- ✅ online_users
-- ✅ groups