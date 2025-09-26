/*
  # Nettoyage complet de la base de données LiberTalk

  Cette migration supprime TOUTES les tables existantes et repart sur une base propre.
  
  1. Suppression complète
    - Toutes les tables existantes
    - Toutes les fonctions existantes
    - Toutes les vues existantes
    - Tous les triggers existants
    
  2. Structure simple
    - Tables essentielles uniquement
    - Fonctions de base
    - Sécurité RLS simplifiée
    
  3. Données de test minimales
    - Quelques utilisateurs de démonstration
    - Groupes de base
*/

-- =============================================
-- NETTOYAGE COMPLET
-- =============================================

-- Supprimer toutes les tables dans l'ordre des dépendances
DROP TABLE IF EXISTS chat_logs CASCADE;
DROP TABLE IF EXISTS real_time_messages CASCADE;
DROP TABLE IF EXISTS chat_matches CASCADE;
DROP TABLE IF EXISTS active_chat_users CASCADE;
DROP TABLE IF EXISTS random_chat_messages CASCADE;
DROP TABLE IF EXISTS random_chat_sessions CASCADE;
DROP TABLE IF EXISTS random_chat_users CASCADE;
DROP TABLE IF EXISTS user_memory CASCADE;
DROP TABLE IF EXISTS user_widgets CASCADE;
DROP TABLE IF EXISTS user_connections CASCADE;
DROP TABLE IF EXISTS video_sessions CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_sessions CASCADE;
DROP TABLE IF EXISTS group_members CASCADE;
DROP TABLE IF EXISTS groups CASCADE;
DROP TABLE IF EXISTS online_users CASCADE;
DROP TABLE IF EXISTS user_accounts CASCADE;
DROP TABLE IF EXISTS user_stats CASCADE;

-- Supprimer toutes les fonctions
DROP FUNCTION IF EXISTS get_chat_stats() CASCADE;
DROP FUNCTION IF EXISTS find_smart_match(text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS send_chat_message(uuid, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS get_match_messages(uuid) CASCADE;
DROP FUNCTION IF EXISTS end_chat_match(uuid, text, text) CASCADE;
DROP FUNCTION IF EXISTS cleanup_inactive_users() CASCADE;
DROP FUNCTION IF EXISTS cleanup_inactive_groups() CASCADE;
DROP FUNCTION IF EXISTS get_live_stats() CASCADE;
DROP FUNCTION IF EXISTS update_user_stats() CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_data() CASCADE;
DROP FUNCTION IF EXISTS get_random_chat_stats() CASCADE;
DROP FUNCTION IF EXISTS find_random_chat_partner(text, text) CASCADE;
DROP FUNCTION IF EXISTS create_random_chat_session(text, text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS end_random_chat_session(uuid, text, text) CASCADE;
DROP FUNCTION IF EXISTS verify_installation() CASCADE;
DROP FUNCTION IF EXISTS simulate_active_users(integer) CASCADE;
DROP FUNCTION IF EXISTS maintain_chat_system() CASCADE;
DROP FUNCTION IF EXISTS add_chat_log(text, text, text, text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS check_autoswitch_sessions() CASCADE;
DROP FUNCTION IF EXISTS trigger_autoswitch(uuid, text, text) CASCADE;
DROP FUNCTION IF EXISTS execute_autoswitch(uuid) CASCADE;
DROP FUNCTION IF EXISTS handle_user_disconnect(text) CASCADE;
DROP FUNCTION IF EXISTS cleanup_random_chat_system() CASCADE;
DROP FUNCTION IF EXISTS get_random_chat_stats_detailed() CASCADE;
DROP FUNCTION IF EXISTS process_autoswitch() CASCADE;
DROP FUNCTION IF EXISTS cleanup_random_chat() CASCADE;

-- Supprimer toutes les vues
DROP VIEW IF EXISTS live_dashboard CASCADE;
DROP VIEW IF EXISTS popular_groups CASCADE;
DROP VIEW IF EXISTS user_connection_history CASCADE;
DROP VIEW IF EXISTS random_chat_waiting_users CASCADE;
DROP VIEW IF EXISTS random_chat_active_sessions CASCADE;

-- =============================================
-- STRUCTURE SIMPLE ET PROPRE
-- =============================================

-- Table des utilisateurs en ligne (présence temps réel)
CREATE TABLE online_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL,
  username TEXT DEFAULT 'Anonyme',
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'chat', 'video', 'group')),
  location TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des groupes de discussion
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) >= 3),
  description TEXT NOT NULL CHECK (length(trim(description)) >= 10),
  member_count INTEGER DEFAULT 1 CHECK (member_count >= 0),
  is_active BOOLEAN DEFAULT true,
  category TEXT DEFAULT 'Général',
  location TEXT,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL
);

-- =============================================
-- INDEX POUR LES PERFORMANCES
-- =============================================

CREATE INDEX idx_online_users_status ON online_users(status);
CREATE INDEX idx_online_users_last_seen ON online_users(last_seen);
CREATE INDEX idx_online_users_active ON online_users(last_seen) WHERE last_seen > NOW() - INTERVAL '5 minutes';

CREATE INDEX idx_groups_active ON groups(is_active, last_activity DESC);
CREATE INDEX idx_groups_member_count ON groups(member_count DESC);

-- =============================================
-- SÉCURITÉ RLS
-- =============================================

ALTER TABLE online_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on online_users" ON online_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on groups" ON groups FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- FONCTIONS ESSENTIELLES
-- =============================================

-- Fonction pour obtenir les statistiques en temps réel
CREATE OR REPLACE FUNCTION get_live_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  -- Nettoyer les utilisateurs inactifs
  DELETE FROM online_users WHERE last_seen < NOW() - INTERVAL '5 minutes';
  
  -- Nettoyer les groupes inactifs
  UPDATE groups SET is_active = false WHERE last_activity < NOW() - INTERVAL '30 minutes';
  
  SELECT json_build_object(
    'total_online', (SELECT COUNT(*) FROM online_users),
    'chat_users', (SELECT COUNT(*) FROM online_users WHERE status = 'chat'),
    'video_users', (SELECT COUNT(*) FROM online_users WHERE status = 'video'),
    'group_users', (SELECT COUNT(*) FROM online_users WHERE status = 'group'),
    'active_groups', (SELECT COUNT(*) FROM groups WHERE is_active = true),
    'last_updated', NOW()
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Fonction de nettoyage automatique
CREATE OR REPLACE FUNCTION cleanup_inactive_data()
RETURNS INTEGER AS $$
DECLARE
  cleaned_count INTEGER := 0;
BEGIN
  -- Supprimer les utilisateurs inactifs (plus de 5 minutes)
  DELETE FROM online_users WHERE last_seen < NOW() - INTERVAL '5 minutes';
  GET DIAGNOSTICS cleaned_count = ROW_COUNT;
  
  -- Désactiver les groupes inactifs (plus de 30 minutes)
  UPDATE groups SET is_active = false WHERE last_activity < NOW() - INTERVAL '30 minutes' AND is_active = true;
  
  -- Supprimer les groupes complètement inactifs (plus de 2 heures)
  DELETE FROM groups WHERE last_activity < NOW() - INTERVAL '2 hours' AND is_active = false;
  
  RETURN cleaned_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- DONNÉES DE TEST MINIMALES
-- =============================================

-- Utilisateurs de démonstration
INSERT INTO online_users (user_id, username, status, location) VALUES
('demo_user_1', 'Alice', 'online', 'Paris, France'),
('demo_user_2', 'Bob', 'chat', 'Lyon, France'),
('demo_user_3', 'Charlie', 'video', 'Marseille, France'),
('demo_user_4', 'Diana', 'group', 'Toulouse, France');

-- Groupes de démonstration
INSERT INTO groups (name, description, member_count, category, created_by) VALUES
('💬 Discussion Générale', 'Parlez de tout et de rien avec la communauté', 5, 'Général', 'demo_user_1'),
('🎮 Gaming Zone', 'Discussions sur les jeux vidéo et l''esport', 8, 'Gaming', 'demo_user_2'),
('🎵 Musique & Culture', 'Partagez vos goûts musicaux et culturels', 3, 'Culture', 'demo_user_3'),
('💻 Tech Talk', 'Discussions sur la technologie et l''innovation', 6, 'Technologie', 'demo_user_4');

-- =============================================
-- VÉRIFICATION FINALE
-- =============================================

-- Fonction de vérification
CREATE OR REPLACE FUNCTION verify_clean_installation()
RETURNS TABLE(
  component TEXT,
  count BIGINT,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 'online_users'::TEXT, COUNT(*), 'OK'::TEXT FROM online_users
  UNION ALL
  SELECT 'groups'::TEXT, COUNT(*), 'OK'::TEXT FROM groups;
END;
$$ LANGUAGE plpgsql;

-- Exécuter la vérification
SELECT * FROM verify_clean_installation();

-- Message de confirmation
SELECT 
  '🎉 Base de données nettoyée et reconstruite avec succès!' as message,
  NOW() as timestamp,
  'Structure simple et optimisée prête pour le développement.' as details;

-- Afficher les statistiques initiales
SELECT * FROM get_live_stats();