/*
  # Configuration complète LiberTalk - Base de données propre

  ## 1. Tables principales
  - `online_users` - Gestion des utilisateurs en ligne et leur statut
  - `groups` - Gestion des groupes de discussion
  - `chat_sessions` - Sessions de chat actives
  - `user_connections` - Connexions entre utilisateurs

  ## 2. Sécurité
  - RLS activé sur toutes les tables
  - Politiques d'accès public pour l'application

  ## 3. Performance
  - Index optimisés pour les requêtes fréquentes
  - Contraintes de données appropriées

  ## 4. Fonctions utilitaires
  - Nettoyage automatique des données obsolètes
  - Gestion des statistiques en temps réel
*/

-- =============================================
-- NETTOYAGE INITIAL (si nécessaire)
-- =============================================

-- Supprimer les tables existantes si elles existent (pour un redémarrage propre)
DROP TABLE IF EXISTS user_connections CASCADE;
DROP TABLE IF EXISTS chat_sessions CASCADE;
DROP TABLE IF EXISTS groups CASCADE;
DROP TABLE IF EXISTS online_users CASCADE;

-- Supprimer les fonctions existantes
DROP FUNCTION IF EXISTS cleanup_inactive_users() CASCADE;
DROP FUNCTION IF EXISTS cleanup_inactive_groups() CASCADE;
DROP FUNCTION IF EXISTS get_user_stats() CASCADE;

-- =============================================
-- TABLE: online_users
-- Gestion des utilisateurs connectés et leur statut
-- =============================================

CREATE TABLE online_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL,
  username TEXT DEFAULT 'Anonyme',
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'chat', 'video', 'group')),
  location TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Métadonnées pour les statistiques
  session_count INTEGER DEFAULT 1,
  total_time_online INTEGER DEFAULT 0 -- en secondes
);

-- Index pour les performances
CREATE INDEX idx_online_users_status ON online_users(status);
CREATE INDEX idx_online_users_last_seen ON online_users(last_seen);
CREATE INDEX idx_online_users_user_id ON online_users(user_id);
CREATE INDEX idx_online_users_active ON online_users(last_seen) WHERE last_seen > NOW() - INTERVAL '5 minutes';

-- =============================================
-- TABLE: groups
-- Gestion des groupes de discussion
-- =============================================

CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  member_count INTEGER DEFAULT 1 CHECK (member_count >= 0 AND member_count <= 50),
  max_members INTEGER DEFAULT 10 CHECK (max_members >= 1 AND max_members <= 50),
  is_active BOOLEAN DEFAULT true NOT NULL,
  category TEXT DEFAULT 'Créé par utilisateur' NOT NULL,
  location TEXT,
  language TEXT DEFAULT 'fr',
  last_activity TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_by TEXT NOT NULL,
  
  -- Métadonnées
  total_messages INTEGER DEFAULT 0,
  peak_members INTEGER DEFAULT 1
);

-- Index pour les performances
CREATE INDEX idx_groups_active ON groups(is_active, last_activity DESC);
CREATE INDEX idx_groups_category ON groups(category);
CREATE INDEX idx_groups_created_by ON groups(created_by);
CREATE INDEX idx_groups_member_count ON groups(member_count DESC);
CREATE INDEX idx_groups_recent ON groups(last_activity DESC) WHERE is_active = true;

-- =============================================
-- TABLE: chat_sessions
-- Sessions de chat actives entre utilisateurs
-- =============================================

CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type TEXT NOT NULL CHECK (session_type IN ('random', 'local', 'video')),
  user1_id TEXT NOT NULL,
  user2_id TEXT,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'waiting')),
  started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  ended_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Métadonnées
  message_count INTEGER DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  
  -- Contraintes
  CONSTRAINT valid_session CHECK (
    (session_type = 'random' AND user2_id IS NOT NULL AND group_id IS NULL) OR
    (session_type = 'local' AND user2_id IS NOT NULL AND group_id IS NULL) OR
    (session_type = 'video' AND user2_id IS NOT NULL AND group_id IS NULL) OR
    (group_id IS NOT NULL)
  )
);

-- Index pour les performances
CREATE INDEX idx_chat_sessions_active ON chat_sessions(status, last_activity DESC);
CREATE INDEX idx_chat_sessions_user1 ON chat_sessions(user1_id);
CREATE INDEX idx_chat_sessions_user2 ON chat_sessions(user2_id);
CREATE INDEX idx_chat_sessions_group ON chat_sessions(group_id);
CREATE INDEX idx_chat_sessions_type ON chat_sessions(session_type);

-- =============================================
-- TABLE: user_connections
-- Historique des connexions entre utilisateurs
-- =============================================

CREATE TABLE user_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('chat', 'video', 'group')),
  connected_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  duration_seconds INTEGER DEFAULT 0,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  
  -- Éviter les doublons
  UNIQUE(user1_id, user2_id, connected_at)
);

-- Index pour les performances
CREATE INDEX idx_user_connections_user1 ON user_connections(user1_id, connected_at DESC);
CREATE INDEX idx_user_connections_user2 ON user_connections(user2_id, connected_at DESC);
CREATE INDEX idx_user_connections_type ON user_connections(connection_type);

-- =============================================
-- SÉCURITÉ - ROW LEVEL SECURITY
-- =============================================

-- Activer RLS sur toutes les tables
ALTER TABLE online_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_connections ENABLE ROW LEVEL SECURITY;

-- Politiques d'accès public (application ouverte)
CREATE POLICY "Public access to online_users" ON online_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to groups" ON groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to chat_sessions" ON chat_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to user_connections" ON user_connections FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- FONCTIONS UTILITAIRES
-- =============================================

-- Fonction de nettoyage des utilisateurs inactifs
CREATE OR REPLACE FUNCTION cleanup_inactive_users()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Supprimer les utilisateurs inactifs depuis plus de 3 minutes
  DELETE FROM online_users 
  WHERE last_seen < NOW() - INTERVAL '3 minutes';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log du nettoyage
  RAISE NOTICE 'Nettoyage utilisateurs: % supprimés à %', deleted_count, NOW();
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Fonction de nettoyage des groupes inactifs
CREATE OR REPLACE FUNCTION cleanup_inactive_groups()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Marquer comme inactifs les groupes sans activité depuis 20 minutes
  UPDATE groups 
  SET is_active = false 
  WHERE last_activity < NOW() - INTERVAL '20 minutes' 
  AND is_active = true;
  
  -- Supprimer les groupes inactifs depuis plus de 1 heure
  DELETE FROM groups 
  WHERE last_activity < NOW() - INTERVAL '1 hour' 
  AND is_active = false;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log du nettoyage
  RAISE NOTICE 'Nettoyage groupes: % supprimés à %', deleted_count, NOW();
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour obtenir les statistiques en temps réel
CREATE OR REPLACE FUNCTION get_user_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total_online', (SELECT COUNT(*) FROM online_users WHERE last_seen > NOW() - INTERVAL '3 minutes'),
    'chat_users', (SELECT COUNT(*) FROM online_users WHERE status = 'chat' AND last_seen > NOW() - INTERVAL '3 minutes'),
    'video_users', (SELECT COUNT(*) FROM online_users WHERE status = 'video' AND last_seen > NOW() - INTERVAL '3 minutes'),
    'group_users', (SELECT COUNT(*) FROM online_users WHERE status = 'group' AND last_seen > NOW() - INTERVAL '3 minutes'),
    'active_groups', (SELECT COUNT(*) FROM groups WHERE is_active = true AND last_activity > NOW() - INTERVAL '20 minutes'),
    'total_groups', (SELECT COUNT(*) FROM groups WHERE is_active = true),
    'active_sessions', (SELECT COUNT(*) FROM chat_sessions WHERE status = 'active'),
    'updated_at', NOW()
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- DONNÉES DE TEST INITIALES
-- =============================================

-- Insérer des utilisateurs de test
INSERT INTO online_users (user_id, username, status, location) VALUES
  ('demo_user_1', 'Alice', 'online', 'Paris, France'),
  ('demo_user_2', 'Bob', 'chat', 'Lyon, France'),
  ('demo_user_3', 'Charlie', 'video', 'Marseille, France'),
  ('demo_user_4', 'Diana', 'group', 'Toulouse, France'),
  ('demo_user_5', 'Eve', 'online', 'Nice, France');

-- Insérer des groupes de test
INSERT INTO groups (name, description, member_count, category, location, created_by) VALUES
  ('🎮 Gamers Zone', 'Discussion sur les jeux vidéo et l''esport', 8, 'Gaming', 'Paris, France', 'demo_user_1'),
  ('🎬 Cinéphiles', 'Parlons de films, séries et documentaires', 5, 'Divertissement', 'Lyon, France', 'demo_user_2'),
  ('💻 Tech Talk', 'Discussions sur la technologie et l''innovation', 12, 'Technologie', 'Marseille, France', 'demo_user_3'),
  ('🍳 Cuisine du Monde', 'Recettes et conseils culinaires', 6, 'Lifestyle', 'Toulouse, France', 'demo_user_4'),
  ('📚 Lecteurs Passionnés', 'Recommandations de livres et discussions littéraires', 4, 'Culture', 'Nice, France', 'demo_user_5');

-- Insérer quelques sessions de test
INSERT INTO chat_sessions (session_type, user1_id, user2_id, status) VALUES
  ('random', 'demo_user_1', 'demo_user_2', 'active'),
  ('video', 'demo_user_3', 'demo_user_4', 'active');

-- =============================================
-- TRIGGERS POUR MAINTENANCE AUTOMATIQUE
-- =============================================

-- Trigger pour mettre à jour last_activity des groupes
CREATE OR REPLACE FUNCTION update_group_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE groups 
    SET last_activity = NOW() 
    WHERE id = NEW.group_id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Appliquer le trigger sur les sessions de chat
CREATE TRIGGER trigger_update_group_activity
  AFTER INSERT OR UPDATE ON chat_sessions
  FOR EACH ROW
  WHEN (NEW.group_id IS NOT NULL)
  EXECUTE FUNCTION update_group_activity();

-- =============================================
-- VUES UTILES POUR LES STATISTIQUES
-- =============================================

-- Vue pour les statistiques en temps réel
CREATE OR REPLACE VIEW live_stats AS
SELECT 
  (SELECT COUNT(*) FROM online_users WHERE last_seen > NOW() - INTERVAL '3 minutes') as total_online,
  (SELECT COUNT(*) FROM online_users WHERE status = 'chat' AND last_seen > NOW() - INTERVAL '3 minutes') as chat_users,
  (SELECT COUNT(*) FROM online_users WHERE status = 'video' AND last_seen > NOW() - INTERVAL '3 minutes') as video_users,
  (SELECT COUNT(*) FROM online_users WHERE status = 'group' AND last_seen > NOW() - INTERVAL '3 minutes') as group_users,
  (SELECT COUNT(*) FROM groups WHERE is_active = true AND last_activity > NOW() - INTERVAL '20 minutes') as active_groups,
  (SELECT COUNT(*) FROM chat_sessions WHERE status = 'active') as active_sessions,
  NOW() as updated_at;

-- Vue pour les groupes populaires
CREATE OR REPLACE VIEW popular_groups AS
SELECT 
  id,
  name,
  description,
  member_count,
  category,
  location,
  last_activity,
  created_at
FROM groups 
WHERE is_active = true 
  AND last_activity > NOW() - INTERVAL '20 minutes'
ORDER BY member_count DESC, last_activity DESC
LIMIT 20;

-- =============================================
-- COMMENTAIRES FINAUX
-- =============================================

-- Configuration terminée avec succès !
-- 
-- Tables créées :
-- ✅ online_users (gestion des utilisateurs connectés)
-- ✅ groups (gestion des groupes de discussion)
-- ✅ chat_sessions (sessions de chat actives)
-- ✅ user_connections (historique des connexions)
--
-- Fonctionnalités :
-- ✅ RLS activé avec politiques d'accès public
-- ✅ Index optimisés pour les performances
-- ✅ Fonctions de nettoyage automatique
-- ✅ Triggers pour la maintenance
-- ✅ Vues pour les statistiques
-- ✅ Données de test insérées
--
-- Prochaines étapes :
-- 1. Activer Realtime dans Supabase Dashboard pour les tables :
--    - online_users
--    - groups
--    - chat_sessions
-- 2. Tester l'application
-- 3. Vérifier les statistiques en temps réel

SELECT 'Configuration LiberTalk terminée avec succès !' as status;