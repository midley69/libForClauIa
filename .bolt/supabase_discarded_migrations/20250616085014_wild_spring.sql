-- =============================================
-- LIBERTALK - RECONSTRUCTION COMPLÈTE DE LA BASE DE DONNÉES
-- =============================================

-- Nettoyage complet (suppression de toutes les tables existantes)
DROP TABLE IF EXISTS user_connections CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS video_sessions CASCADE;
DROP TABLE IF EXISTS group_members CASCADE;
DROP TABLE IF EXISTS user_widgets CASCADE;
DROP TABLE IF EXISTS user_memory CASCADE;
DROP TABLE IF EXISTS chat_sessions CASCADE;
DROP TABLE IF EXISTS groups CASCADE;
DROP TABLE IF EXISTS online_users CASCADE;
DROP TABLE IF EXISTS user_accounts CASCADE;

-- Supprimer les fonctions existantes
DROP FUNCTION IF EXISTS cleanup_inactive_users() CASCADE;
DROP FUNCTION IF EXISTS cleanup_inactive_groups() CASCADE;
DROP FUNCTION IF EXISTS get_live_stats() CASCADE;
DROP FUNCTION IF EXISTS match_users() CASCADE;

-- =============================================
-- TABLE: user_accounts
-- Gestion des comptes utilisateurs (anonymes et enregistrés)
-- =============================================

CREATE TABLE user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL,
  username TEXT,
  email TEXT UNIQUE,
  is_anonymous BOOLEAN DEFAULT true NOT NULL,
  avatar_url TEXT,
  location TEXT,
  language TEXT DEFAULT 'fr',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_login TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Préférences utilisateur
  preferences JSONB DEFAULT '{}',
  
  -- Statistiques
  total_connections INTEGER DEFAULT 0,
  total_chat_time INTEGER DEFAULT 0, -- en secondes
  total_video_time INTEGER DEFAULT 0, -- en secondes
  
  -- Contraintes
  CONSTRAINT valid_username CHECK (username IS NULL OR length(trim(username)) >= 2),
  CONSTRAINT valid_email CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- =============================================
-- TABLE: online_users
-- Présence en temps réel des utilisateurs
-- =============================================

CREATE TABLE online_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL,
  username TEXT DEFAULT 'Anonyme',
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'chat', 'video', 'group', 'away')),
  location TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  session_start TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Métadonnées de session
  device_type TEXT DEFAULT 'web',
  user_agent TEXT,
  ip_address INET,
  
  -- Statistiques de session
  session_duration INTEGER DEFAULT 0, -- en secondes
  actions_count INTEGER DEFAULT 0
);

-- =============================================
-- TABLE: groups
-- Groupes de discussion thématiques
-- =============================================

CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 3 AND 50),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 10 AND 200),
  member_count INTEGER DEFAULT 1 CHECK (member_count >= 0 AND member_count <= 50),
  max_members INTEGER DEFAULT 10 CHECK (max_members BETWEEN 2 AND 50),
  is_active BOOLEAN DEFAULT true NOT NULL,
  is_public BOOLEAN DEFAULT true NOT NULL,
  category TEXT DEFAULT 'Général' NOT NULL,
  tags TEXT[] DEFAULT '{}',
  location TEXT,
  language TEXT DEFAULT 'fr',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_activity TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_by TEXT NOT NULL,
  
  -- Statistiques
  total_messages INTEGER DEFAULT 0,
  peak_members INTEGER DEFAULT 1,
  total_sessions INTEGER DEFAULT 0,
  
  -- Configuration
  settings JSONB DEFAULT '{"allow_video": true, "allow_files": false, "moderated": false}'
);

-- =============================================
-- TABLE: group_members
-- Membres des groupes avec rôles
-- =============================================

CREATE TABLE group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'moderator', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_active TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Statistiques membre
  messages_count INTEGER DEFAULT 0,
  time_spent INTEGER DEFAULT 0, -- en secondes
  
  UNIQUE(group_id, user_id)
);

-- =============================================
-- TABLE: chat_sessions
-- Sessions de chat entre utilisateurs
-- =============================================

CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type TEXT NOT NULL CHECK (session_type IN ('random', 'local', 'video', 'group')),
  
  -- Participants
  user1_id TEXT NOT NULL,
  user2_id TEXT,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  
  -- État de la session
  status TEXT DEFAULT 'active' CHECK (status IN ('waiting', 'active', 'ended', 'cancelled')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Métadonnées
  location_filter TEXT,
  language_filter TEXT DEFAULT 'fr',
  
  -- Statistiques
  message_count INTEGER DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  
  -- Évaluation
  user1_rating INTEGER CHECK (user1_rating BETWEEN 1 AND 5),
  user2_rating INTEGER CHECK (user2_rating BETWEEN 1 AND 5),
  
  -- Contraintes logiques
  CONSTRAINT valid_session_type CHECK (
    (session_type IN ('random', 'local', 'video') AND user2_id IS NOT NULL AND group_id IS NULL) OR
    (session_type = 'group' AND group_id IS NOT NULL)
  )
);

-- =============================================
-- TABLE: chat_messages
-- Messages de chat avec support multimédia
-- =============================================

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  
  -- Contenu du message
  message_text TEXT,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'emoji', 'image', 'file', 'system')),
  
  -- Métadonnées
  sent_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  edited_at TIMESTAMPTZ,
  is_deleted BOOLEAN DEFAULT false,
  
  -- Support multimédia
  file_url TEXT,
  file_type TEXT,
  file_size INTEGER,
  
  -- Contraintes
  CONSTRAINT valid_message CHECK (
    (message_type = 'text' AND message_text IS NOT NULL AND length(trim(message_text)) > 0) OR
    (message_type IN ('image', 'file') AND file_url IS NOT NULL) OR
    (message_type = 'system')
  )
);

-- =============================================
-- TABLE: video_sessions
-- Sessions d'appels vidéo avec métadonnées
-- =============================================

CREATE TABLE video_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  
  -- Participants
  caller_id TEXT NOT NULL,
  callee_id TEXT NOT NULL,
  
  -- État de l'appel
  status TEXT DEFAULT 'calling' CHECK (status IN ('calling', 'ringing', 'active', 'ended', 'failed')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  
  -- Qualité et métadonnées
  duration_seconds INTEGER DEFAULT 0,
  video_quality TEXT DEFAULT 'auto',
  audio_quality TEXT DEFAULT 'auto',
  
  -- Statistiques techniques
  connection_quality JSONB DEFAULT '{}',
  bandwidth_stats JSONB DEFAULT '{}',
  
  -- Évaluation
  caller_rating INTEGER CHECK (caller_rating BETWEEN 1 AND 5),
  callee_rating INTEGER CHECK (callee_rating BETWEEN 1 AND 5),
  
  -- Raison de fin d'appel
  end_reason TEXT CHECK (end_reason IN ('normal', 'timeout', 'network_error', 'user_cancelled', 'technical_error'))
);

-- =============================================
-- TABLE: user_connections
-- Historique des connexions entre utilisateurs
-- =============================================

CREATE TABLE user_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('chat', 'video', 'group')),
  
  -- Métadonnées de connexion
  connected_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  duration_seconds INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  
  -- Évaluations mutuelles
  user1_rating INTEGER CHECK (user1_rating BETWEEN 1 AND 5),
  user2_rating INTEGER CHECK (user2_rating BETWEEN 1 AND 5),
  
  -- Statut de la relation
  is_friend BOOLEAN DEFAULT false,
  is_blocked BOOLEAN DEFAULT false,
  
  -- Éviter les doublons
  UNIQUE(user1_id, user2_id, connected_at)
);

-- =============================================
-- TABLE: user_widgets
-- Configuration des widgets utilisateur
-- =============================================

CREATE TABLE user_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  widget_type TEXT NOT NULL CHECK (widget_type IN ('stats', 'friends', 'groups', 'recent_chats', 'preferences')),
  
  -- Configuration du widget
  position INTEGER DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  UNIQUE(user_id, widget_type)
);

-- =============================================
-- TABLE: user_memory
-- Système de mémoire/préférences utilisateur
-- =============================================

CREATE TABLE user_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('preference', 'history', 'setting', 'cache')),
  memory_key TEXT NOT NULL,
  memory_value JSONB NOT NULL,
  
  -- Métadonnées
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ,
  
  -- Contraintes
  UNIQUE(user_id, memory_type, memory_key)
);

-- =============================================
-- INDEX POUR LES PERFORMANCES
-- =============================================

-- Index pour user_accounts
CREATE INDEX idx_user_accounts_user_id ON user_accounts(user_id);
CREATE INDEX idx_user_accounts_email ON user_accounts(email) WHERE email IS NOT NULL;
CREATE INDEX idx_user_accounts_anonymous ON user_accounts(is_anonymous);

-- Index pour online_users
CREATE INDEX idx_online_users_user_id ON online_users(user_id);
CREATE INDEX idx_online_users_status ON online_users(status);
CREATE INDEX idx_online_users_last_seen ON online_users(last_seen);
CREATE INDEX idx_online_users_active ON online_users(last_seen) WHERE last_seen > NOW() - INTERVAL '5 minutes';

-- Index pour groups
CREATE INDEX idx_groups_active ON groups(is_active, last_activity DESC);
CREATE INDEX idx_groups_category ON groups(category);
CREATE INDEX idx_groups_created_by ON groups(created_by);
CREATE INDEX idx_groups_member_count ON groups(member_count DESC);
CREATE INDEX idx_groups_public ON groups(is_public) WHERE is_active = true;

-- Index pour group_members
CREATE INDEX idx_group_members_group_id ON group_members(group_id);
CREATE INDEX idx_group_members_user_id ON group_members(user_id);
CREATE INDEX idx_group_members_role ON group_members(role);

-- Index pour chat_sessions
CREATE INDEX idx_chat_sessions_status ON chat_sessions(status, last_activity DESC);
CREATE INDEX idx_chat_sessions_user1 ON chat_sessions(user1_id);
CREATE INDEX idx_chat_sessions_user2 ON chat_sessions(user2_id);
CREATE INDEX idx_chat_sessions_group ON chat_sessions(group_id);
CREATE INDEX idx_chat_sessions_type ON chat_sessions(session_type);

-- Index pour chat_messages
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, sent_at DESC);
CREATE INDEX idx_chat_messages_sender ON chat_messages(sender_id);
CREATE INDEX idx_chat_messages_type ON chat_messages(message_type);

-- Index pour video_sessions
CREATE INDEX idx_video_sessions_chat_session ON video_sessions(chat_session_id);
CREATE INDEX idx_video_sessions_caller ON video_sessions(caller_id);
CREATE INDEX idx_video_sessions_callee ON video_sessions(callee_id);
CREATE INDEX idx_video_sessions_status ON video_sessions(status);

-- Index pour user_connections
CREATE INDEX idx_user_connections_user1 ON user_connections(user1_id, connected_at DESC);
CREATE INDEX idx_user_connections_user2 ON user_connections(user2_id, connected_at DESC);
CREATE INDEX idx_user_connections_type ON user_connections(connection_type);
CREATE INDEX idx_user_connections_friends ON user_connections(user1_id, user2_id) WHERE is_friend = true;

-- Index pour user_widgets
CREATE INDEX idx_user_widgets_user_id ON user_widgets(user_id);
CREATE INDEX idx_user_widgets_type ON user_widgets(widget_type);
CREATE INDEX idx_user_widgets_visible ON user_widgets(user_id, position) WHERE is_visible = true;

-- Index pour user_memory
CREATE INDEX idx_user_memory_user_id ON user_memory(user_id);
CREATE INDEX idx_user_memory_type ON user_memory(memory_type);
CREATE INDEX idx_user_memory_key ON user_memory(user_id, memory_key);
CREATE INDEX idx_user_memory_expires ON user_memory(expires_at) WHERE expires_at IS NOT NULL;

-- =============================================
-- SÉCURITÉ - ROW LEVEL SECURITY
-- =============================================

-- Activer RLS sur toutes les tables
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;

-- Politiques d'accès public (application ouverte)
CREATE POLICY "Public access to user_accounts" ON user_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to online_users" ON online_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to groups" ON groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to group_members" ON group_members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to chat_sessions" ON chat_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to chat_messages" ON chat_messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to video_sessions" ON video_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to user_connections" ON user_connections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to user_widgets" ON user_widgets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to user_memory" ON user_memory FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- FONCTIONS UTILITAIRES AVANCÉES
-- =============================================

-- Fonction de nettoyage automatique des utilisateurs inactifs
CREATE OR REPLACE FUNCTION cleanup_inactive_users()
RETURNS TABLE(deleted_users INTEGER, updated_sessions INTEGER) AS $$
DECLARE
  deleted_count INTEGER;
  updated_count INTEGER;
BEGIN
  -- Supprimer les utilisateurs inactifs depuis plus de 5 minutes
  DELETE FROM online_users 
  WHERE last_seen < NOW() - INTERVAL '5 minutes';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Terminer les sessions orphelines
  UPDATE chat_sessions 
  SET status = 'ended', ended_at = NOW()
  WHERE status = 'active' 
  AND last_activity < NOW() - INTERVAL '10 minutes';
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  
  -- Nettoyer la mémoire expirée
  DELETE FROM user_memory 
  WHERE expires_at IS NOT NULL 
  AND expires_at < NOW();
  
  RETURN QUERY SELECT deleted_count, updated_count;
END;
$$ LANGUAGE plpgsql;

-- Fonction de nettoyage des groupes inactifs
CREATE OR REPLACE FUNCTION cleanup_inactive_groups()
RETURNS TABLE(deactivated_groups INTEGER, deleted_groups INTEGER) AS $$
DECLARE
  deactivated_count INTEGER;
  deleted_count INTEGER;
BEGIN
  -- Désactiver les groupes sans activité depuis 30 minutes
  UPDATE groups 
  SET is_active = false 
  WHERE last_activity < NOW() - INTERVAL '30 minutes' 
  AND is_active = true;
  
  GET DIAGNOSTICS deactivated_count = ROW_COUNT;
  
  -- Supprimer les groupes inactifs depuis plus de 2 heures
  DELETE FROM groups 
  WHERE last_activity < NOW() - INTERVAL '2 hours' 
  AND is_active = false;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN QUERY SELECT deactivated_count, deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour obtenir les statistiques en temps réel
CREATE OR REPLACE FUNCTION get_live_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'timestamp', NOW(),
    'users', json_build_object(
      'total_online', (SELECT COUNT(*) FROM online_users WHERE last_seen > NOW() - INTERVAL '5 minutes'),
      'chat_users', (SELECT COUNT(*) FROM online_users WHERE status = 'chat' AND last_seen > NOW() - INTERVAL '5 minutes'),
      'video_users', (SELECT COUNT(*) FROM online_users WHERE status = 'video' AND last_seen > NOW() - INTERVAL '5 minutes'),
      'group_users', (SELECT COUNT(*) FROM online_users WHERE status = 'group' AND last_seen > NOW() - INTERVAL '5 minutes'),
      'away_users', (SELECT COUNT(*) FROM online_users WHERE status = 'away' AND last_seen > NOW() - INTERVAL '5 minutes')
    ),
    'groups', json_build_object(
      'active_groups', (SELECT COUNT(*) FROM groups WHERE is_active = true AND last_activity > NOW() - INTERVAL '30 minutes'),
      'total_groups', (SELECT COUNT(*) FROM groups WHERE is_active = true),
      'total_members', (SELECT COALESCE(SUM(member_count), 0) FROM groups WHERE is_active = true)
    ),
    'sessions', json_build_object(
      'active_chats', (SELECT COUNT(*) FROM chat_sessions WHERE status = 'active' AND session_type IN ('random', 'local')),
      'active_videos', (SELECT COUNT(*) FROM video_sessions WHERE status = 'active'),
      'waiting_users', (SELECT COUNT(*) FROM chat_sessions WHERE status = 'waiting')
    ),
    'activity', json_build_object(
      'messages_last_hour', (SELECT COUNT(*) FROM chat_messages WHERE sent_at > NOW() - INTERVAL '1 hour'),
      'new_connections_today', (SELECT COUNT(*) FROM user_connections WHERE connected_at > CURRENT_DATE),
      'peak_online_today', (SELECT COALESCE(MAX(actions_count), 0) FROM online_users WHERE session_start > CURRENT_DATE)
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Fonction de matching intelligent pour les utilisateurs
CREATE OR REPLACE FUNCTION match_users(
  requesting_user_id TEXT,
  session_type TEXT,
  location_filter TEXT DEFAULT NULL,
  language_filter TEXT DEFAULT 'fr'
)
RETURNS TABLE(matched_user_id TEXT, compatibility_score INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ou.user_id,
    (
      CASE WHEN ou.location = location_filter THEN 50 ELSE 0 END +
      CASE WHEN EXISTS(
        SELECT 1 FROM user_connections uc 
        WHERE (uc.user1_id = requesting_user_id AND uc.user2_id = ou.user_id)
        OR (uc.user1_id = ou.user_id AND uc.user2_id = requesting_user_id)
      ) THEN -20 ELSE 20 END +
      CASE WHEN ou.session_start > NOW() - INTERVAL '10 minutes' THEN 30 ELSE 10 END
    ) as score
  FROM online_users ou
  WHERE ou.user_id != requesting_user_id
  AND ou.status = 'online'
  AND ou.last_seen > NOW() - INTERVAL '2 minutes'
  AND (location_filter IS NULL OR ou.location = location_filter)
  AND NOT EXISTS (
    SELECT 1 FROM chat_sessions cs 
    WHERE cs.status = 'active' 
    AND (cs.user1_id = ou.user_id OR cs.user2_id = ou.user_id)
  )
  ORDER BY score DESC, RANDOM()
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- TRIGGERS POUR MAINTENANCE AUTOMATIQUE
-- =============================================

-- Trigger pour mettre à jour last_activity des groupes
CREATE OR REPLACE FUNCTION update_group_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE groups 
    SET last_activity = NOW(),
        total_messages = total_messages + 1
    WHERE id = NEW.group_id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour mettre à jour les statistiques de session
CREATE OR REPLACE FUNCTION update_session_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE chat_sessions 
    SET message_count = message_count + 1,
        last_activity = NOW()
    WHERE id = NEW.session_id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour mettre à jour updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Appliquer les triggers
CREATE TRIGGER trigger_update_group_activity
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  WHEN (NEW.session_id IN (SELECT id FROM chat_sessions WHERE group_id IS NOT NULL))
  EXECUTE FUNCTION update_group_activity();

CREATE TRIGGER trigger_update_session_stats
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_session_stats();

CREATE TRIGGER trigger_user_widgets_updated_at
  BEFORE UPDATE ON user_widgets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_user_memory_updated_at
  BEFORE UPDATE ON user_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- VUES OPTIMISÉES POUR L'APPLICATION
-- =============================================

-- Vue pour les statistiques en temps réel
CREATE OR REPLACE VIEW live_dashboard AS
SELECT 
  (SELECT COUNT(*) FROM online_users WHERE last_seen > NOW() - INTERVAL '5 minutes') as total_online,
  (SELECT COUNT(*) FROM online_users WHERE status = 'chat' AND last_seen > NOW() - INTERVAL '5 minutes') as chat_users,
  (SELECT COUNT(*) FROM online_users WHERE status = 'video' AND last_seen > NOW() - INTERVAL '5 minutes') as video_users,
  (SELECT COUNT(*) FROM online_users WHERE status = 'group' AND last_seen > NOW() - INTERVAL '5 minutes') as group_users,
  (SELECT COUNT(*) FROM groups WHERE is_active = true AND last_activity > NOW() - INTERVAL '30 minutes') as active_groups,
  (SELECT COUNT(*) FROM chat_sessions WHERE status = 'active') as active_sessions,
  (SELECT COUNT(*) FROM video_sessions WHERE status = 'active') as active_video_calls,
  NOW() as updated_at;

-- Vue pour les groupes populaires
CREATE OR REPLACE VIEW popular_groups AS
SELECT 
  g.id,
  g.name,
  g.description,
  g.member_count,
  g.category,
  g.location,
  g.last_activity,
  g.created_at,
  g.tags,
  EXTRACT(EPOCH FROM (NOW() - g.last_activity))/60 as minutes_since_activity
FROM groups g
WHERE g.is_active = true 
  AND g.is_public = true
  AND g.last_activity > NOW() - INTERVAL '30 minutes'
ORDER BY g.member_count DESC, g.last_activity DESC;

-- Vue pour l'historique des connexions utilisateur
CREATE OR REPLACE VIEW user_connection_history AS
SELECT 
  uc.user1_id,
  uc.user2_id,
  uc.connection_type,
  uc.connected_at,
  uc.duration_seconds,
  uc.message_count,
  uc.user1_rating,
  uc.user2_rating,
  uc.is_friend,
  CASE 
    WHEN uc.duration_seconds > 300 THEN 'long'
    WHEN uc.duration_seconds > 60 THEN 'medium'
    ELSE 'short'
  END as connection_quality
FROM user_connections uc
ORDER BY uc.connected_at DESC;

-- =============================================
-- DONNÉES DE TEST COMPLÈTES
-- =============================================

-- Insérer des comptes utilisateur de test
INSERT INTO user_accounts (user_id, username, is_anonymous, location, language, preferences) VALUES
  ('demo_user_1', 'Alice_Dev', false, 'Paris, France', 'fr', '{"theme": "dark", "notifications": true}'),
  ('demo_user_2', 'Bob_Gamer', false, 'Lyon, France', 'fr', '{"theme": "light", "notifications": true}'),
  ('demo_user_3', 'Charlie_Tech', false, 'Marseille, France', 'fr', '{"theme": "auto", "notifications": false}'),
  ('demo_user_4', 'Diana_Artist', false, 'Toulouse, France', 'fr', '{"theme": "dark", "notifications": true}'),
  ('demo_user_5', 'Eve_Student', false, 'Nice, France', 'fr', '{"theme": "light", "notifications": true}'),
  ('anon_user_1', NULL, true, 'Bordeaux, France', 'fr', '{}'),
  ('anon_user_2', NULL, true, 'Strasbourg, France', 'fr', '{}');

-- Insérer des utilisateurs en ligne
INSERT INTO online_users (user_id, username, status, location, device_type) VALUES
  ('demo_user_1', 'Alice_Dev', 'online', 'Paris, France', 'web'),
  ('demo_user_2', 'Bob_Gamer', 'chat', 'Lyon, France', 'mobile'),
  ('demo_user_3', 'Charlie_Tech', 'video', 'Marseille, France', 'web'),
  ('demo_user_4', 'Diana_Artist', 'group', 'Toulouse, France', 'web'),
  ('demo_user_5', 'Eve_Student', 'online', 'Nice, France', 'mobile'),
  ('anon_user_1', 'Anonyme', 'online', 'Bordeaux, France', 'web'),
  ('anon_user_2', 'Anonyme', 'chat', 'Strasbourg, France', 'mobile');

-- Insérer des groupes de test
INSERT INTO groups (name, description, member_count, category, tags, location, created_by, settings) VALUES
  ('🚀 Développeurs Web', 'Communauté de développeurs passionnés par les technologies web modernes', 12, 'Technologie', '{"javascript", "react", "nodejs"}', 'France', 'demo_user_1', '{"allow_video": true, "allow_files": true, "moderated": false}'),
  ('🎮 Gamers FR', 'Communauté française de joueurs multi-plateformes', 25, 'Gaming', '{"gaming", "esport", "streaming"}', 'France', 'demo_user_2', '{"allow_video": true, "allow_files": false, "moderated": true}'),
  ('🎨 Créatifs & Artistes', 'Espace de partage pour les créatifs et artistes', 8, 'Art & Créativité', '{"art", "design", "photographie"}', 'Paris, France', 'demo_user_4', '{"allow_video": true, "allow_files": true, "moderated": false}'),
  ('📚 Étudiants & Entraide', 'Groupe d''entraide pour étudiants de tous niveaux', 18, 'Éducation', '{"études", "entraide", "examens"}', 'France', 'demo_user_5', '{"allow_video": false, "allow_files": true, "moderated": true}'),
  ('🍳 Cuisine & Recettes', 'Partage de recettes et conseils culinaires', 15, 'Lifestyle', '{"cuisine", "recettes", "gastronomie"}', 'Lyon, France', 'demo_user_3', '{"allow_video": false, "allow_files": true, "moderated": false}'),
  ('🌍 Voyageurs', 'Conseils et récits de voyage autour du monde', 22, 'Voyage', '{"voyage", "aventure", "culture"}', 'France', 'demo_user_1', '{"allow_video": true, "allow_files": true, "moderated": false}');

-- Insérer des membres de groupes
INSERT INTO group_members (group_id, user_id, role) VALUES
  ((SELECT id FROM groups WHERE name = '🚀 Développeurs Web'), 'demo_user_1', 'owner'),
  ((SELECT id FROM groups WHERE name = '🚀 Développeurs Web'), 'demo_user_3', 'admin'),
  ((SELECT id FROM groups WHERE name = '🚀 Développeurs Web'), 'demo_user_5', 'member'),
  ((SELECT id FROM groups WHERE name = '🎮 Gamers FR'), 'demo_user_2', 'owner'),
  ((SELECT id FROM groups WHERE name = '🎮 Gamers FR'), 'demo_user_4', 'moderator'),
  ((SELECT id FROM groups WHERE name = '🎨 Créatifs & Artistes'), 'demo_user_4', 'owner'),
  ((SELECT id FROM groups WHERE name = '📚 Étudiants & Entraide'), 'demo_user_5', 'owner'),
  ((SELECT id FROM groups WHERE name = '🍳 Cuisine & Recettes'), 'demo_user_3', 'owner'),
  ((SELECT id FROM groups WHERE name = '🌍 Voyageurs'), 'demo_user_1', 'owner');

-- Insérer des sessions de chat actives
INSERT INTO chat_sessions (session_type, user1_id, user2_id, status, started_at) VALUES
  ('random', 'demo_user_1', 'demo_user_2', 'active', NOW() - INTERVAL '5 minutes'),
  ('video', 'demo_user_3', 'demo_user_4', 'active', NOW() - INTERVAL '3 minutes'),
  ('local', 'demo_user_5', 'anon_user_1', 'active', NOW() - INTERVAL '8 minutes');

-- Insérer des sessions de groupe
INSERT INTO chat_sessions (session_type, group_id, user1_id, status, started_at) VALUES
  ('group', (SELECT id FROM groups WHERE name = '🚀 Développeurs Web'), 'demo_user_1', 'active', NOW() - INTERVAL '10 minutes'),
  ('group', (SELECT id FROM groups WHERE name = '🎮 Gamers FR'), 'demo_user_2', 'active', NOW() - INTERVAL '15 minutes');

-- Insérer des widgets utilisateur par défaut
INSERT INTO user_widgets (user_id, widget_type, position, settings) VALUES
  ('demo_user_1', 'stats', 1, '{"show_total_time": true, "show_connections": true}'),
  ('demo_user_1', 'friends', 2, '{"show_online_only": false}'),
  ('demo_user_1', 'groups', 3, '{"show_member_count": true}'),
  ('demo_user_2', 'stats', 1, '{"show_total_time": false, "show_connections": true}'),
  ('demo_user_2', 'recent_chats', 2, '{"limit": 5}');

-- Insérer des préférences utilisateur
INSERT INTO user_memory (user_id, memory_type, memory_key, memory_value) VALUES
  ('demo_user_1', 'preference', 'chat_sound', '"enabled"'),
  ('demo_user_1', 'preference', 'video_quality', '"auto"'),
  ('demo_user_1', 'setting', 'language', '"fr"'),
  ('demo_user_2', 'preference', 'notification_sound', '"disabled"'),
  ('demo_user_2', 'cache', 'last_group_visited', '"🎮 Gamers FR"'),
  ('demo_user_3', 'history', 'favorite_categories', '["Technologie", "Gaming"]');

-- =============================================
-- FINALISATION ET VÉRIFICATION
-- =============================================

-- Fonction de vérification de l'installation
CREATE OR REPLACE FUNCTION verify_installation()
RETURNS TABLE(
  table_name TEXT,
  record_count BIGINT,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 'user_accounts'::TEXT, COUNT(*), 'OK'::TEXT FROM user_accounts
  UNION ALL
  SELECT 'online_users'::TEXT, COUNT(*), 'OK'::TEXT FROM online_users
  UNION ALL
  SELECT 'groups'::TEXT, COUNT(*), 'OK'::TEXT FROM groups
  UNION ALL
  SELECT 'group_members'::TEXT, COUNT(*), 'OK'::TEXT FROM group_members
  UNION ALL
  SELECT 'chat_sessions'::TEXT, COUNT(*), 'OK'::TEXT FROM chat_sessions
  UNION ALL
  SELECT 'user_widgets'::TEXT, COUNT(*), 'OK'::TEXT FROM user_widgets
  UNION ALL
  SELECT 'user_memory'::TEXT, COUNT(*), 'OK'::TEXT FROM user_memory;
END;
$$ LANGUAGE plpgsql;

-- Exécuter la vérification
SELECT * FROM verify_installation();

-- Message de confirmation
SELECT 
  '🎉 Base de données LiberTalk configurée avec succès!' as message,
  NOW() as timestamp,
  'Toutes les tables, index, fonctions et données de test ont été créés.' as details;

-- Afficher les statistiques initiales
SELECT * FROM get_live_stats();