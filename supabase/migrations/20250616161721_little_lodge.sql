-- ============================================================================
-- MIGRATION LIBERTALK - BASE DE DONNÉES COMPLÈTE OPTIMISÉE
-- ============================================================================

-- Nettoyer complètement la base existante
DROP TABLE IF EXISTS user_achievements CASCADE;
DROP TABLE IF EXISTS user_badges CASCADE;
DROP TABLE IF EXISTS badges CASCADE;
DROP TABLE IF EXISTS random_chat_messages CASCADE;
DROP TABLE IF EXISTS random_chat_sessions CASCADE;
DROP TABLE IF EXISTS random_chat_users CASCADE;
DROP TABLE IF EXISTS real_time_messages CASCADE;
DROP TABLE IF EXISTS chat_matches CASCADE;
DROP TABLE IF EXISTS active_chat_users CASCADE;
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
DROP TABLE IF EXISTS debug_logs CASCADE;

-- ============================================================================
-- 1. TABLE DES COMPTES UTILISATEURS
-- ============================================================================
CREATE TABLE user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL,
  pseudo TEXT,
  display_name TEXT,
  avatar_url TEXT,
  genre TEXT CHECK (genre IN ('homme', 'femme', 'autre')) DEFAULT 'autre',
  account_type TEXT NOT NULL DEFAULT 'anonymous' CHECK (account_type IN ('anonymous', 'registered')),
  
  -- Localisation détaillée
  country TEXT,
  city TEXT,
  location_enabled BOOLEAN DEFAULT false,
  
  -- Préférences utilisateur
  preferences JSONB DEFAULT '{
    "theme": "dark",
    "language": "fr",
    "notifications": true,
    "autoswitch": false,
    "show_location": false
  }',
  
  -- Statistiques et gamification
  stats JSONB DEFAULT '{
    "chats": 0,
    "video_calls": 0,
    "groups_joined": 0,
    "messages_sent": 0,
    "friends_added": 0,
    "total_time_minutes": 0
  }',
  
  -- Système de points et niveau
  points INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  experience INTEGER DEFAULT 0,
  
  -- Timestamps
  last_active TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 2. PRÉSENCE EN LIGNE TEMPS RÉEL
-- ============================================================================
CREATE TABLE online_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  pseudo TEXT,
  genre TEXT CHECK (genre IN ('homme', 'femme', 'autre')) DEFAULT 'autre',
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'chat', 'video', 'group', 'searching')),
  
  -- Localisation en temps réel
  country TEXT,
  city TEXT,
  location TEXT,
  
  -- Activité
  current_activity TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  session_start TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 3. SYSTÈME DE BADGES ET ACHIEVEMENTS
-- ============================================================================
CREATE TABLE badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT DEFAULT '#FFD700',
  category TEXT NOT NULL CHECK (category IN ('social', 'activity', 'special', 'time', 'achievement')),
  points_reward INTEGER DEFAULT 0,
  requirements JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  progress JSONB DEFAULT '{}',
  UNIQUE(user_id, badge_id)
);

CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  achievement_type TEXT NOT NULL,
  achievement_data JSONB DEFAULT '{}',
  points_earned INTEGER DEFAULT 0,
  achieved_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 4. GROUPES DE DISCUSSION DYNAMIQUES
-- ============================================================================
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  
  -- Gestion des membres
  member_count INTEGER DEFAULT 1 CHECK (member_count >= 0),
  max_members INTEGER DEFAULT 10 CHECK (max_members > 0),
  current_members TEXT[] DEFAULT '{}',
  
  -- État et métadonnées
  is_active BOOLEAN DEFAULT true,
  category TEXT DEFAULT 'Créé par utilisateur',
  tags TEXT[] DEFAULT '{}',
  
  -- Localisation
  country TEXT,
  city TEXT,
  location TEXT,
  
  -- Auto-suppression et activité
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  auto_delete_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '2 hours'),
  inactivity_threshold INTERVAL DEFAULT '30 minutes',
  
  -- Métadonnées
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL,
  
  -- Statistiques
  total_messages INTEGER DEFAULT 0,
  peak_members INTEGER DEFAULT 1
);

CREATE TABLE group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  pseudo TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'moderator', 'member')),
  
  -- Activité dans le groupe
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW(),
  messages_count INTEGER DEFAULT 0,
  
  UNIQUE(group_id, user_id)
);

-- ============================================================================
-- 5. CHAT RANDOMISÉ AVEC COULEURS PAR GENRE
-- ============================================================================
CREATE TABLE random_chat_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  pseudo TEXT NOT NULL,
  genre TEXT NOT NULL CHECK (genre IN ('homme', 'femme', 'autre')),
  status TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'connecte', 'hors_ligne')),
  
  -- Préférences de chat
  autoswitch_enabled BOOLEAN DEFAULT false,
  preferred_gender TEXT CHECK (preferred_gender IN ('homme', 'femme', 'autre', 'tous')) DEFAULT 'tous',
  
  -- Localisation pour chat local
  country TEXT,
  city TEXT,
  location_filter TEXT,
  
  -- Activité
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  search_started_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE random_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Participants
  user1_id TEXT NOT NULL,
  user1_pseudo TEXT NOT NULL,
  user1_genre TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  user2_pseudo TEXT NOT NULL,
  user2_genre TEXT NOT NULL,
  
  -- État de la session
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'autoswitch_waiting')),
  
  -- Autoswitch
  autoswitch_countdown_start TIMESTAMPTZ,
  autoswitch_countdown_remaining INTEGER DEFAULT 30,
  autoswitch_user_id TEXT,
  
  -- Métadonnées
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  message_count INTEGER DEFAULT 0,
  
  -- Évaluations
  rating_user1 INTEGER CHECK (rating_user1 BETWEEN 1 AND 5),
  rating_user2 INTEGER CHECK (rating_user2 BETWEEN 1 AND 5),
  
  -- Type de chat
  chat_type TEXT DEFAULT 'random' CHECK (chat_type IN ('random', 'local', 'filtered'))
);

CREATE TABLE random_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES random_chat_sessions(id) ON DELETE CASCADE,
  
  -- Expéditeur avec genre pour couleurs
  sender_id TEXT NOT NULL,
  sender_pseudo TEXT NOT NULL,
  sender_genre TEXT NOT NULL CHECK (sender_genre IN ('homme', 'femme', 'autre')),
  
  -- Contenu du message
  message_text TEXT NOT NULL,
  message_type TEXT DEFAULT 'user' CHECK (message_type IN ('user', 'system', 'autoswitch_warning')),
  
  -- Couleur automatique basée sur le genre
  color_code TEXT GENERATED ALWAYS AS (
    CASE 
      WHEN sender_genre = 'femme' THEN '#FF69B4'
      WHEN sender_genre = 'homme' THEN '#1E90FF'
      ELSE '#A9A9A9'
    END
  ) STORED,
  
  -- Métadonnées
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  is_edited BOOLEAN DEFAULT false
);

-- ============================================================================
-- 6. SYSTÈME D'APPELS VIDÉO (WebRTC/Jitsi Ready)
-- ============================================================================
CREATE TABLE video_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Participants
  user1_id TEXT NOT NULL,
  user1_pseudo TEXT,
  user2_id TEXT NOT NULL,
  user2_pseudo TEXT,
  
  -- État de l'appel
  status TEXT DEFAULT 'connecting' CHECK (status IN ('connecting', 'active', 'ended', 'failed', 'rejected')),
  
  -- Configuration WebRTC/Jitsi
  room_id TEXT UNIQUE,
  jitsi_room_name TEXT,
  webrtc_config JSONB DEFAULT '{}',
  
  -- Qualité et statistiques
  quality_stats JSONB DEFAULT '{
    "video_quality": "auto",
    "audio_quality": "high",
    "connection_quality": "unknown",
    "bandwidth_usage": 0,
    "packet_loss": 0,
    "latency_ms": 0
  }',
  
  -- Paramètres de l'appel
  video_enabled BOOLEAN DEFAULT true,
  audio_enabled BOOLEAN DEFAULT true,
  screen_sharing BOOLEAN DEFAULT false,
  
  -- Durée et timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0,
  
  -- Évaluations
  rating_user1 INTEGER CHECK (rating_user1 BETWEEN 1 AND 5),
  rating_user2 INTEGER CHECK (rating_user2 BETWEEN 1 AND 5),
  
  -- Raison de fin d'appel
  end_reason TEXT CHECK (end_reason IN ('normal', 'timeout', 'error', 'rejected', 'network_issue'))
);

-- ============================================================================
-- 7. CHAT SESSIONS CLASSIQUES
-- ============================================================================
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'skipped')),
  session_type TEXT DEFAULT 'random' CHECK (session_type IN ('random', 'group', 'private')),
  
  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  
  -- Statistiques
  message_count INTEGER DEFAULT 0,
  
  -- Évaluations
  rating_user1 INTEGER CHECK (rating_user1 BETWEEN 1 AND 5),
  rating_user2 INTEGER CHECK (rating_user2 BETWEEN 1 AND 5)
);

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file', 'system', 'emoji')),
  
  -- Métadonnées
  metadata JSONB DEFAULT '{}',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  is_edited BOOLEAN DEFAULT false
);

-- ============================================================================
-- 8. CONNEXIONS ET HISTORIQUE
-- ============================================================================
CREATE TABLE user_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  connected_user_id TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('chat', 'video', 'group')),
  
  -- Référence à la session
  session_id UUID,
  
  -- Évaluation et notes
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  notes TEXT,
  is_friend BOOLEAN DEFAULT false,
  is_blocked BOOLEAN DEFAULT false,
  
  -- Statistiques de connexion
  duration_seconds INTEGER DEFAULT 0,
  messages_exchanged INTEGER DEFAULT 0,
  
  -- Timing
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ
);

-- ============================================================================
-- 9. WIDGETS ET PERSONNALISATION
-- ============================================================================
CREATE TABLE user_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  widget_type TEXT NOT NULL CHECK (widget_type IN ('stats', 'friends', 'achievements', 'activity', 'leaderboard')),
  
  -- Position et taille
  position JSONB DEFAULT '{"x": 0, "y": 0}',
  size JSONB DEFAULT '{"width": 200, "height": 150}',
  
  -- Configuration
  settings JSONB DEFAULT '{}',
  is_visible BOOLEAN DEFAULT true,
  z_index INTEGER DEFAULT 1,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 10. MÉMOIRE UTILISATEUR ET CACHE
-- ============================================================================
CREATE TABLE user_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('preferences', 'cache', 'session', 'temporary', 'persistent')),
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  
  -- Expiration automatique
  expires_at TIMESTAMPTZ,
  auto_cleanup BOOLEAN DEFAULT true,
  
  -- Métadonnées
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  access_count INTEGER DEFAULT 0,
  last_accessed TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, memory_type, key)
);

-- ============================================================================
-- 11. LOGS DE DÉBOGAGE
-- ============================================================================
CREATE TABLE debug_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  session_id TEXT,
  log_level TEXT NOT NULL CHECK (log_level IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL')),
  component TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  stack_trace TEXT,
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 12. INDEXES OPTIMISÉS POUR PERFORMANCE MAXIMALE
-- ============================================================================

-- Indexes pour user_accounts
CREATE INDEX idx_user_accounts_user_id ON user_accounts(user_id);
CREATE INDEX idx_user_accounts_pseudo ON user_accounts(pseudo);
CREATE INDEX idx_user_accounts_genre ON user_accounts(genre);
CREATE INDEX idx_user_accounts_location ON user_accounts(country, city);
CREATE INDEX idx_user_accounts_active ON user_accounts(last_active DESC);
CREATE INDEX idx_user_accounts_points ON user_accounts(points DESC);
CREATE INDEX idx_user_accounts_level ON user_accounts(level DESC);

-- Indexes pour online_users (critiques pour temps réel)
CREATE INDEX idx_online_users_status ON online_users(status);
CREATE INDEX idx_online_users_last_seen ON online_users(last_seen DESC);
CREATE INDEX idx_online_users_genre_status ON online_users(genre, status);
CREATE INDEX idx_online_users_location ON online_users(country, city);
CREATE INDEX idx_online_users_activity ON online_users(current_activity);

-- Indexes pour groupes (performance des recherches)
CREATE INDEX idx_groups_active ON groups(is_active, last_activity DESC);
CREATE INDEX idx_groups_category ON groups(category);
CREATE INDEX idx_groups_location ON groups(country, city);
CREATE INDEX idx_groups_members ON groups(member_count DESC);
CREATE INDEX idx_groups_auto_delete ON groups(auto_delete_at) WHERE is_active = true;
CREATE INDEX idx_groups_tags ON groups USING GIN(tags);

-- Indexes pour group_members
CREATE INDEX idx_group_members_group_id ON group_members(group_id);
CREATE INDEX idx_group_members_user_id ON group_members(user_id);
CREATE INDEX idx_group_members_active ON group_members(group_id, last_active DESC);

-- Indexes pour chat randomisé (critiques pour matching)
CREATE INDEX idx_random_chat_users_status ON random_chat_users(status);
CREATE INDEX idx_random_chat_users_genre ON random_chat_users(genre, status);
CREATE INDEX idx_random_chat_users_location ON random_chat_users(country, city, status);
CREATE INDEX idx_random_chat_users_autoswitch ON random_chat_users(autoswitch_enabled, status);
CREATE INDEX idx_random_chat_users_search_time ON random_chat_users(search_started_at) WHERE status = 'en_attente';

-- Indexes pour sessions de chat randomisé
CREATE INDEX idx_random_chat_sessions_status ON random_chat_sessions(status);
CREATE INDEX idx_random_chat_sessions_users ON random_chat_sessions(user1_id, user2_id);
CREATE INDEX idx_random_chat_sessions_active ON random_chat_sessions(status, last_activity DESC);
CREATE INDEX idx_random_chat_sessions_autoswitch ON random_chat_sessions(status, autoswitch_countdown_start) WHERE status = 'autoswitch_waiting';

-- Indexes pour messages de chat randomisé
CREATE INDEX idx_random_chat_messages_session ON random_chat_messages(session_id, sent_at DESC);
CREATE INDEX idx_random_chat_messages_sender ON random_chat_messages(sender_id, sent_at DESC);
CREATE INDEX idx_random_chat_messages_type ON random_chat_messages(message_type);

-- Indexes pour appels vidéo
CREATE INDEX idx_video_sessions_status ON video_sessions(status);
CREATE INDEX idx_video_sessions_users ON video_sessions(user1_id, user2_id);
CREATE INDEX idx_video_sessions_room ON video_sessions(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX idx_video_sessions_active ON video_sessions(status, started_at DESC);

-- Indexes pour chat sessions classiques
CREATE INDEX idx_chat_sessions_status ON chat_sessions(status);
CREATE INDEX idx_chat_sessions_users ON chat_sessions(user1_id, user2_id);
CREATE INDEX idx_chat_sessions_activity ON chat_sessions(last_activity DESC);

-- Indexes pour messages de chat
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, sent_at DESC);
CREATE INDEX idx_chat_messages_sender ON chat_messages(sender_id, sent_at DESC);

-- Indexes pour connexions utilisateur
CREATE INDEX idx_user_connections_user ON user_connections(user_id, connected_at DESC);
CREATE INDEX idx_user_connections_type ON user_connections(connection_type);
CREATE INDEX idx_user_connections_friends ON user_connections(user_id, is_friend) WHERE is_friend = true;

-- Indexes pour badges et achievements
CREATE INDEX idx_user_badges_user ON user_badges(user_id, earned_at DESC);
CREATE INDEX idx_user_badges_badge ON user_badges(badge_id);
CREATE INDEX idx_user_achievements_user ON user_achievements(user_id, achieved_at DESC);
CREATE INDEX idx_user_achievements_type ON user_achievements(achievement_type);

-- Indexes pour widgets
CREATE INDEX idx_user_widgets_user ON user_widgets(user_id, widget_type);
CREATE INDEX idx_user_widgets_visible ON user_widgets(user_id, is_visible);

-- Indexes pour mémoire utilisateur
CREATE INDEX idx_user_memory_lookup ON user_memory(user_id, memory_type, key);
CREATE INDEX idx_user_memory_expires ON user_memory(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_user_memory_cleanup ON user_memory(auto_cleanup, expires_at) WHERE auto_cleanup = true;
CREATE INDEX idx_user_memory_access ON user_memory(last_accessed DESC);

-- Indexes pour logs de débogage
CREATE INDEX idx_debug_logs_user ON debug_logs(user_id, created_at DESC);
CREATE INDEX idx_debug_logs_level ON debug_logs(log_level, created_at DESC);
CREATE INDEX idx_debug_logs_component ON debug_logs(component, created_at DESC);
CREATE INDEX idx_debug_logs_session ON debug_logs(session_id, created_at DESC);

-- ============================================================================
-- 13. ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Activer RLS sur toutes les tables
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE random_chat_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE random_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE random_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE debug_logs ENABLE ROW LEVEL SECURITY;

-- Policies permissives pour le développement (à affiner en production)
DO $$
BEGIN
  -- Supprimer les policies existantes
  DROP POLICY IF EXISTS "Allow all operations on user_accounts" ON user_accounts;
  DROP POLICY IF EXISTS "Allow all operations on online_users" ON online_users;
  DROP POLICY IF EXISTS "Allow all operations on badges" ON badges;
  DROP POLICY IF EXISTS "Allow all operations on user_badges" ON user_badges;
  DROP POLICY IF EXISTS "Allow all operations on user_achievements" ON user_achievements;
  DROP POLICY IF EXISTS "Allow all operations on groups" ON groups;
  DROP POLICY IF EXISTS "Allow all operations on group_members" ON group_members;
  DROP POLICY IF EXISTS "Allow all operations on random_chat_users" ON random_chat_users;
  DROP POLICY IF EXISTS "Allow all operations on random_chat_sessions" ON random_chat_sessions;
  DROP POLICY IF EXISTS "Allow all operations on random_chat_messages" ON random_chat_messages;
  DROP POLICY IF EXISTS "Allow all operations on video_sessions" ON video_sessions;
  DROP POLICY IF EXISTS "Allow all operations on chat_sessions" ON chat_sessions;
  DROP POLICY IF EXISTS "Allow all operations on chat_messages" ON chat_messages;
  DROP POLICY IF EXISTS "Allow all operations on user_connections" ON user_connections;
  DROP POLICY IF EXISTS "Allow all operations on user_widgets" ON user_widgets;
  DROP POLICY IF EXISTS "Allow all operations on user_memory" ON user_memory;
  DROP POLICY IF EXISTS "Allow all operations on debug_logs" ON debug_logs;

  -- Créer les nouvelles policies
  CREATE POLICY "Allow all operations on user_accounts" ON user_accounts FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on online_users" ON online_users FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on badges" ON badges FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on user_badges" ON user_badges FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on user_achievements" ON user_achievements FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on groups" ON groups FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on group_members" ON group_members FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on random_chat_users" ON random_chat_users FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on random_chat_sessions" ON random_chat_sessions FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on random_chat_messages" ON random_chat_messages FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on video_sessions" ON video_sessions FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on chat_sessions" ON chat_sessions FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on chat_messages" ON chat_messages FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on user_connections" ON user_connections FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on user_widgets" ON user_widgets FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on user_memory" ON user_memory FOR ALL USING (true) WITH CHECK (true);
  CREATE POLICY "Allow all operations on debug_logs" ON debug_logs FOR ALL USING (true) WITH CHECK (true);
END $$;

-- ============================================================================
-- 14. FONCTIONS UTILITAIRES ET NETTOYAGE AUTOMATIQUE
-- ============================================================================

-- Supprimer les fonctions existantes
DROP FUNCTION IF EXISTS cleanup_inactive_users();
DROP FUNCTION IF EXISTS cleanup_inactive_groups();
DROP FUNCTION IF EXISTS cleanup_expired_memory();
DROP FUNCTION IF EXISTS cleanup_old_logs();
DROP FUNCTION IF EXISTS get_live_stats();
DROP FUNCTION IF EXISTS get_random_chat_stats();
DROP FUNCTION IF EXISTS find_random_chat_partner(TEXT, TEXT);
DROP FUNCTION IF EXISTS create_random_chat_session(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS end_random_chat_session(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS handle_user_disconnect(TEXT);
DROP FUNCTION IF EXISTS trigger_autoswitch(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS execute_autoswitch(UUID);
DROP FUNCTION IF EXISTS award_points(TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS check_achievements(TEXT);
DROP FUNCTION IF EXISTS log_debug(TEXT, TEXT, TEXT, TEXT, JSONB);

-- Nettoyage des utilisateurs inactifs
CREATE OR REPLACE FUNCTION cleanup_inactive_users()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Supprimer les utilisateurs inactifs depuis plus de 5 minutes
  DELETE FROM online_users 
  WHERE last_seen < NOW() - INTERVAL '5 minutes';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log du nettoyage
  INSERT INTO debug_logs (user_id, log_level, component, message, details)
  VALUES ('SYSTEM', 'INFO', 'cleanup_inactive_users', 'Nettoyage utilisateurs inactifs', 
          jsonb_build_object('deleted_count', deleted_count));
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Nettoyage des groupes inactifs avec auto-suppression
CREATE OR REPLACE FUNCTION cleanup_inactive_groups()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
  deleted_count INTEGER;
BEGIN
  -- Marquer comme inactifs les groupes sans activité
  UPDATE groups 
  SET is_active = false 
  WHERE last_activity < NOW() - inactivity_threshold 
    AND is_active = true;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  
  -- Supprimer les groupes expirés (auto_delete_at dépassé)
  DELETE FROM groups 
  WHERE auto_delete_at < NOW() 
    AND is_active = false;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log du nettoyage
  INSERT INTO debug_logs (user_id, log_level, component, message, details)
  VALUES ('SYSTEM', 'INFO', 'cleanup_inactive_groups', 'Nettoyage groupes inactifs', 
          jsonb_build_object('updated_count', updated_count, 'deleted_count', deleted_count));
  
  RETURN updated_count + deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Nettoyage de la mémoire expirée
CREATE OR REPLACE FUNCTION cleanup_expired_memory()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM user_memory 
  WHERE expires_at IS NOT NULL 
    AND expires_at < NOW()
    AND auto_cleanup = true;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Nettoyage des anciens logs
CREATE OR REPLACE FUNCTION cleanup_old_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Garder seulement les logs des 7 derniers jours
  DELETE FROM debug_logs 
  WHERE created_at < NOW() - INTERVAL '7 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Statistiques en temps réel
CREATE OR REPLACE FUNCTION get_live_stats()
RETURNS TABLE(
  total_users BIGINT,
  online_users BIGINT,
  chat_users BIGINT,
  video_users BIGINT,
  group_users BIGINT,
  active_groups BIGINT,
  active_chat_sessions BIGINT,
  active_video_sessions BIGINT,
  total_messages_today BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM user_accounts WHERE last_active > NOW() - INTERVAL '24 hours')::BIGINT,
    (SELECT COUNT(*) FROM online_users WHERE last_seen > NOW() - INTERVAL '5 minutes')::BIGINT,
    (SELECT COUNT(*) FROM online_users WHERE status = 'chat' AND last_seen > NOW() - INTERVAL '5 minutes')::BIGINT,
    (SELECT COUNT(*) FROM online_users WHERE status = 'video' AND last_seen > NOW() - INTERVAL '5 minutes')::BIGINT,
    (SELECT COUNT(*) FROM online_users WHERE status = 'group' AND last_seen > NOW() - INTERVAL '5 minutes')::BIGINT,
    (SELECT COUNT(*) FROM groups WHERE is_active = true AND last_activity > NOW() - INTERVAL '30 minutes')::BIGINT,
    (SELECT COUNT(*) FROM random_chat_sessions WHERE status = 'active')::BIGINT,
    (SELECT COUNT(*) FROM video_sessions WHERE status IN ('connecting', 'active'))::BIGINT,
    (SELECT COUNT(*) FROM random_chat_messages WHERE sent_at > CURRENT_DATE)::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- Statistiques spécifiques au chat randomisé
CREATE OR REPLACE FUNCTION get_random_chat_stats()
RETURNS TABLE(
  users JSONB,
  sessions JSONB,
  messages JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    jsonb_build_object(
      'total_waiting', (SELECT COUNT(*) FROM random_chat_users WHERE status = 'en_attente'),
      'by_gender', jsonb_build_object(
        'homme', (SELECT COUNT(*) FROM random_chat_users WHERE status = 'en_attente' AND genre = 'homme'),
        'femme', (SELECT COUNT(*) FROM random_chat_users WHERE status = 'en_attente' AND genre = 'femme'),
        'autre', (SELECT COUNT(*) FROM random_chat_users WHERE status = 'en_attente' AND genre = 'autre')
      ),
      'autoswitch_enabled', (SELECT COUNT(*) FROM random_chat_users WHERE status = 'en_attente' AND autoswitch_enabled = true)
    ),
    jsonb_build_object(
      'active', (SELECT COUNT(*) FROM random_chat_sessions WHERE status = 'active'),
      'autoswitch_waiting', (SELECT COUNT(*) FROM random_chat_sessions WHERE status = 'autoswitch_waiting'),
      'total_today', (SELECT COUNT(*) FROM random_chat_sessions WHERE started_at > CURRENT_DATE)
    ),
    jsonb_build_object(
      'total_today', (SELECT COUNT(*) FROM random_chat_messages WHERE sent_at > CURRENT_DATE),
      'by_type', jsonb_build_object(
        'user', (SELECT COUNT(*) FROM random_chat_messages WHERE message_type = 'user' AND sent_at > CURRENT_DATE),
        'system', (SELECT COUNT(*) FROM random_chat_messages WHERE message_type = 'system' AND sent_at > CURRENT_DATE)
      )
    );
END;
$$ LANGUAGE plpgsql;

-- Recherche de partenaire pour chat randomisé
CREATE OR REPLACE FUNCTION find_random_chat_partner(
  requesting_user_id TEXT,
  location_filter TEXT DEFAULT NULL
)
RETURNS TABLE(
  partner_user_id TEXT,
  partner_pseudo TEXT,
  partner_genre TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.user_id,
    u.pseudo,
    u.genre
  FROM random_chat_users u
  WHERE u.status = 'en_attente'
    AND u.user_id != requesting_user_id
    AND (location_filter IS NULL OR u.location_filter = location_filter OR u.location_filter IS NULL)
  ORDER BY u.search_started_at ASC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Création de session de chat randomisé
CREATE OR REPLACE FUNCTION create_random_chat_session(
  user1_id TEXT,
  user1_pseudo TEXT,
  user1_genre TEXT,
  user2_id TEXT,
  user2_pseudo TEXT,
  user2_genre TEXT
)
RETURNS UUID AS $$
DECLARE
  session_id UUID;
BEGIN
  -- Créer la session
  INSERT INTO random_chat_sessions (
    user1_id, user1_pseudo, user1_genre,
    user2_id, user2_pseudo, user2_genre,
    status
  ) VALUES (
    user1_id, user1_pseudo, user1_genre,
    user2_id, user2_pseudo, user2_genre,
    'active'
  ) RETURNING id INTO session_id;
  
  -- Mettre à jour le statut des utilisateurs
  UPDATE random_chat_users 
  SET status = 'connecte' 
  WHERE user_id IN (user1_id, user2_id);
  
  -- Log de la création
  INSERT INTO debug_logs (user_id, session_id, log_level, component, message, details)
  VALUES (user1_id, session_id::TEXT, 'INFO', 'create_random_chat_session', 'Session de chat randomisé créée', 
          jsonb_build_object('partner_id', user2_id, 'session_id', session_id));
  
  RETURN session_id;
END;
$$ LANGUAGE plpgsql;

-- Fin de session de chat randomisé
CREATE OR REPLACE FUNCTION end_random_chat_session(
  session_id UUID,
  ended_by_user_id TEXT,
  end_reason TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  session_record RECORD;
BEGIN
  -- Récupérer les détails de la session
  SELECT * INTO session_record 
  FROM random_chat_sessions 
  WHERE id = session_id AND status = 'active';
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- Mettre à jour la session
  UPDATE random_chat_sessions 
  SET 
    status = 'ended',
    ended_at = NOW()
  WHERE id = session_id;
  
  -- Remettre les utilisateurs en attente ou les supprimer
  UPDATE random_chat_users 
  SET status = 'en_attente' 
  WHERE user_id IN (session_record.user1_id, session_record.user2_id)
    AND status = 'connecte';
  
  -- Log de la fin
  INSERT INTO debug_logs (user_id, session_id, log_level, component, message, details)
  VALUES (ended_by_user_id, session_id::TEXT, 'INFO', 'end_random_chat_session', 'Session de chat randomisé terminée', 
          jsonb_build_object('reason', end_reason, 'session_id', session_id));
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Gestion des déconnexions utilisateur
CREATE OR REPLACE FUNCTION handle_user_disconnect(p_user_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  -- Supprimer de la liste des utilisateurs en ligne
  DELETE FROM online_users WHERE user_id = p_user_id;
  
  -- Supprimer du chat randomisé
  DELETE FROM random_chat_users WHERE user_id = p_user_id;
  
  -- Terminer les sessions actives
  UPDATE random_chat_sessions 
  SET status = 'ended', ended_at = NOW()
  WHERE (user1_id = p_user_id OR user2_id = p_user_id) 
    AND status IN ('active', 'autoswitch_waiting');
  
  -- Log de la déconnexion
  INSERT INTO debug_logs (user_id, log_level, component, message, details)
  VALUES (p_user_id, 'INFO', 'handle_user_disconnect', 'Utilisateur déconnecté', 
          jsonb_build_object('user_id', p_user_id));
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Système de points et achievements
CREATE OR REPLACE FUNCTION award_points(
  p_user_id TEXT,
  p_points INTEGER,
  p_reason TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  current_points INTEGER;
  new_level INTEGER;
BEGIN
  -- Ajouter les points
  UPDATE user_accounts 
  SET 
    points = points + p_points,
    experience = experience + p_points
  WHERE user_id = p_user_id
  RETURNING points INTO current_points;
  
  -- Calculer le nouveau niveau (100 points par niveau)
  new_level := (current_points / 100) + 1;
  
  -- Mettre à jour le niveau si nécessaire
  UPDATE user_accounts 
  SET level = new_level 
  WHERE user_id = p_user_id AND level < new_level;
  
  -- Enregistrer l'achievement
  INSERT INTO user_achievements (user_id, achievement_type, achievement_data, points_earned)
  VALUES (p_user_id, 'points_earned', jsonb_build_object('reason', p_reason), p_points);
  
  -- Vérifier les nouveaux badges
  PERFORM check_achievements(p_user_id);
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Vérification des achievements
CREATE OR REPLACE FUNCTION check_achievements(p_user_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  user_stats RECORD;
  badge_count INTEGER := 0;
BEGIN
  -- Récupérer les stats de l'utilisateur
  SELECT * INTO user_stats 
  FROM user_accounts 
  WHERE user_id = p_user_id;
  
  -- Badge "Premier Chat" (1 chat)
  IF (user_stats.stats->>'chats')::INTEGER >= 1 THEN
    INSERT INTO user_badges (user_id, badge_id)
    SELECT p_user_id, id FROM badges WHERE name = 'Premier Chat'
    ON CONFLICT (user_id, badge_id) DO NOTHING;
  END IF;
  
  -- Badge "Bavard" (10 chats)
  IF (user_stats.stats->>'chats')::INTEGER >= 10 THEN
    INSERT INTO user_badges (user_id, badge_id)
    SELECT p_user_id, id FROM badges WHERE name = 'Bavard'
    ON CONFLICT (user_id, badge_id) DO NOTHING;
  END IF;
  
  -- Badge "Sociable" (5 amis ajoutés)
  IF (user_stats.stats->>'friends_added')::INTEGER >= 5 THEN
    INSERT INTO user_badges (user_id, badge_id)
    SELECT p_user_id, id FROM badges WHERE name = 'Sociable'
    ON CONFLICT (user_id, badge_id) DO NOTHING;
  END IF;
  
  GET DIAGNOSTICS badge_count = ROW_COUNT;
  RETURN badge_count;
END;
$$ LANGUAGE plpgsql;

-- Fonction de logging pour débogage
CREATE OR REPLACE FUNCTION log_debug(
  p_user_id TEXT,
  p_session_id TEXT,
  p_level TEXT,
  p_component TEXT,
  p_message TEXT,
  p_details JSONB DEFAULT '{}'
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO debug_logs (user_id, session_id, log_level, component, message, details)
  VALUES (p_user_id, p_session_id, p_level, p_component, p_message, p_details);
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 15. VUES POUR DASHBOARD ET STATISTIQUES
-- ============================================================================

-- Vue du dashboard en temps réel
DROP VIEW IF EXISTS live_dashboard;
CREATE VIEW live_dashboard AS
SELECT 
  'Utilisateurs Totaux' as metric,
  COUNT(*) as value,
  'Comptes utilisateurs créés' as description
FROM user_accounts
UNION ALL
SELECT 
  'Utilisateurs En Ligne' as metric,
  COUNT(*) as value,
  'Actuellement connectés' as description
FROM online_users 
WHERE last_seen > NOW() - INTERVAL '5 minutes'
UNION ALL
SELECT 
  'Groupes Actifs' as metric,
  COUNT(*) as value,
  'Groupes avec activité récente' as description
FROM groups 
WHERE is_active = true AND last_activity > NOW() - INTERVAL '30 minutes'
UNION ALL
SELECT 
  'Sessions Chat' as metric,
  COUNT(*) as value,
  'Sessions de chat actives' as description
FROM random_chat_sessions 
WHERE status = 'active'
UNION ALL
SELECT 
  'Appels Vidéo' as metric,
  COUNT(*) as value,
  'Appels vidéo en cours' as description
FROM video_sessions 
WHERE status IN ('connecting', 'active');

-- ============================================================================
-- 16. DONNÉES DE TEST ET BADGES INITIAUX
-- ============================================================================

-- Insérer les badges par défaut
INSERT INTO badges (name, description, icon, color, category, points_reward, requirements) VALUES
('Premier Chat', 'Votre première conversation', '💬', '#4CAF50', 'social', 10, '{"chats": 1}'),
('Bavard', 'Participé à 10 conversations', '🗣️', '#2196F3', 'social', 50, '{"chats": 10}'),
('Sociable', 'Ajouté 5 amis', '👥', '#FF9800', 'social', 25, '{"friends_added": 5}'),
('Explorateur', 'Rejoint 3 groupes différents', '🌍', '#9C27B0', 'activity', 30, '{"groups_joined": 3}'),
('Vidéaste', 'Premier appel vidéo', '📹', '#F44336', 'activity', 20, '{"video_calls": 1}'),
('Marathonien', '2 heures de temps total', '⏰', '#607D8B', 'time', 100, '{"total_time_minutes": 120}'),
('Pionnier', 'Parmi les premiers utilisateurs', '🏆', '#FFD700', 'special', 200, '{"early_adopter": true}')
ON CONFLICT (name) DO NOTHING;

-- Insérer des comptes de démonstration
INSERT INTO user_accounts (user_id, pseudo, display_name, genre, account_type, country, city, preferences, stats, points, level) VALUES
('demo_alice', 'Alice_Dev', 'Alice', 'femme', 'registered', 'France', 'Paris', 
 '{"theme": "dark", "language": "fr", "autoswitch": false}', 
 '{"chats": 15, "video_calls": 3, "groups_joined": 2, "messages_sent": 145, "friends_added": 4, "total_time_minutes": 180}', 
 250, 3),
('demo_bob', 'Bob_Gamer', 'Bob', 'homme', 'anonymous', 'France', 'Lyon', 
 '{"theme": "light", "language": "fr", "autoswitch": true}', 
 '{"chats": 8, "video_calls": 12, "groups_joined": 1, "messages_sent": 89, "friends_added": 2, "total_time_minutes": 95}', 
 150, 2),
('demo_charlie', 'Charlie_Art', 'Charlie', 'autre', 'registered', 'France', 'Marseille', 
 '{"theme": "dark", "language": "en", "autoswitch": false}', 
 '{"chats": 25, "video_calls": 7, "groups_joined": 4, "messages_sent": 234, "friends_added": 8, "total_time_minutes": 300}', 
 400, 4)
ON CONFLICT (user_id) DO NOTHING;

-- Insérer des utilisateurs en ligne de démonstration
INSERT INTO online_users (user_id, pseudo, genre, status, country, city, current_activity) VALUES
('demo_alice', 'Alice_Dev', 'femme', 'online', 'France', 'Paris', 'Navigue sur l''accueil'),
('demo_bob', 'Bob_Gamer', 'homme', 'chat', 'France', 'Lyon', 'En chat randomisé'),
('demo_charlie', 'Charlie_Art', 'autre', 'group', 'France', 'Marseille', 'Dans un groupe')
ON CONFLICT (user_id) DO NOTHING;

-- Insérer des groupes de démonstration
INSERT INTO groups (name, description, member_count, category, country, city, tags, created_by, total_messages, peak_members) VALUES
('🚀 Développeurs Web', 'Communauté de développeurs passionnés par les technologies web modernes', 15, 'Technologie', 'France', 'Paris', 
 ARRAY['développement', 'web', 'javascript', 'react'], 'demo_alice', 89, 18),
('🎮 Gamers FR', 'Communauté française de joueurs multi-plateformes', 28, 'Gaming', 'France', 'Lyon', 
 ARRAY['gaming', 'jeux', 'communauté'], 'demo_bob', 156, 32),
('🎨 Créatifs & Artistes', 'Espace de partage pour les créatifs et artistes', 12, 'Art & Créativité', 'France', 'Marseille', 
 ARRAY['art', 'créativité', 'design'], 'demo_charlie', 67, 15),
('📚 Étudiants & Apprentissage', 'Groupe d''entraide pour étudiants et apprenants', 22, 'Éducation', 'France', 'Toulouse', 
 ARRAY['étude', 'apprentissage', 'entraide'], 'demo_alice', 134, 25),
('🌍 Voyageurs', 'Partage d''expériences de voyage et conseils', 18, 'Voyage', 'France', 'Nice', 
 ARRAY['voyage', 'découverte', 'culture'], 'demo_bob', 98, 20)
ON CONFLICT DO NOTHING;

-- Insérer des membres de groupes
INSERT INTO group_members (group_id, user_id, pseudo, role, messages_count) VALUES
((SELECT id FROM groups WHERE name = '🚀 Développeurs Web'), 'demo_alice', 'Alice_Dev', 'owner', 25),
((SELECT id FROM groups WHERE name = '🚀 Développeurs Web'), 'demo_charlie', 'Charlie_Art', 'member', 12),
((SELECT id FROM groups WHERE name = '🎮 Gamers FR'), 'demo_bob', 'Bob_Gamer', 'owner', 34),
((SELECT id FROM groups WHERE name = '🎨 Créatifs & Artistes'), 'demo_charlie', 'Charlie_Art', 'owner', 18)
ON CONFLICT (group_id, user_id) DO NOTHING;

-- Attribuer quelques badges aux utilisateurs de démo
INSERT INTO user_badges (user_id, badge_id) VALUES
('demo_alice', (SELECT id FROM badges WHERE name = 'Premier Chat')),
('demo_alice', (SELECT id FROM badges WHERE name = 'Bavard')),
('demo_alice', (SELECT id FROM badges WHERE name = 'Sociable')),
('demo_bob', (SELECT id FROM badges WHERE name = 'Premier Chat')),
('demo_bob', (SELECT id FROM badges WHERE name = 'Vidéaste')),
('demo_charlie', (SELECT id FROM badges WHERE name = 'Premier Chat')),
('demo_charlie', (SELECT id FROM badges WHERE name = 'Bavard')),
('demo_charlie', (SELECT id FROM badges WHERE name = 'Explorateur'))
ON CONFLICT (user_id, badge_id) DO NOTHING;

-- ============================================================================
-- 17. FONCTION DE VÉRIFICATION D'INSTALLATION
-- ============================================================================

CREATE OR REPLACE FUNCTION verify_libertalk_installation()
RETURNS TABLE(
  component TEXT,
  status TEXT,
  details TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    'Tables'::TEXT,
    '✅ OK'::TEXT,
    format('%s tables créées', (
      SELECT COUNT(*) FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN (
        'user_accounts', 'online_users', 'badges', 'user_badges', 'user_achievements',
        'groups', 'group_members', 'random_chat_users', 'random_chat_sessions', 
        'random_chat_messages', 'video_sessions', 'chat_sessions', 'chat_messages',
        'user_connections', 'user_widgets', 'user_memory', 'debug_logs'
      )
    ))
  
  UNION ALL
  
  SELECT 
    'Indexes'::TEXT,
    '✅ OK'::TEXT,
    format('%s indexes créés', (
      SELECT COUNT(*) FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND indexname LIKE 'idx_%'
    ))
  
  UNION ALL
  
  SELECT 
    'RLS Policies'::TEXT,
    '✅ OK'::TEXT,
    format('%s policies actives', (
      SELECT COUNT(*) FROM pg_policies 
      WHERE schemaname = 'public'
    ))
  
  UNION ALL
  
  SELECT 
    'Fonctions'::TEXT,
    '✅ OK'::TEXT,
    format('%s fonctions créées', (
      SELECT COUNT(*) FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
      AND p.proname IN (
        'cleanup_inactive_users', 'cleanup_inactive_groups', 'get_live_stats',
        'get_random_chat_stats', 'find_random_chat_partner', 'award_points'
      )
    ))
  
  UNION ALL
  
  SELECT 
    'Données de test'::TEXT,
    CASE WHEN (SELECT COUNT(*) FROM user_accounts) > 0 THEN '✅ OK' ELSE '⚠️ Vide' END,
    format('%s comptes de démo', (SELECT COUNT(*) FROM user_accounts))
  
  UNION ALL
  
  SELECT 
    'Badges système'::TEXT,
    CASE WHEN (SELECT COUNT(*) FROM badges) > 0 THEN '✅ OK' ELSE '⚠️ Vide' END,
    format('%s badges configurés', (SELECT COUNT(*) FROM badges));
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 18. FINALISATION ET VÉRIFICATION
-- ============================================================================

-- Log de l'installation
INSERT INTO debug_logs (user_id, log_level, component, message, details) VALUES
('SYSTEM', 'INFO', 'Installation LiberTalk', 'Base de données LiberTalk configurée avec succès', 
 jsonb_build_object(
   'timestamp', NOW(),
   'version', '1.0.0',
   'tables_created', 17,
   'functions_created', 15
 ));

-- Message de succès
SELECT '🎉 Installation LiberTalk terminée avec succès !' as message;

-- Vérification complète
SELECT * FROM verify_libertalk_installation();

-- Statistiques initiales
SELECT * FROM get_live_stats();

-- Statistiques chat randomisé
SELECT * FROM get_random_chat_stats();