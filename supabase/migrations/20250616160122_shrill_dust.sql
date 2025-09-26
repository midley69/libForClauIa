-- Complete LiberTalk Database Rebuild
-- This migration creates a robust, scalable database architecture

-- Drop existing tables if they exist (clean slate)
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

-- Create user_accounts table
CREATE TABLE user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  account_type TEXT NOT NULL DEFAULT 'anonymous' CHECK (account_type IN ('anonymous', 'registered')),
  preferences JSONB DEFAULT '{}',
  stats JSONB DEFAULT '{"chats": 0, "video_calls": 0, "groups_joined": 0}',
  last_active TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create online_users table for real-time presence
CREATE TABLE online_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'chat', 'video', 'group')),
  location TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create groups table
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  member_count INTEGER DEFAULT 1 CHECK (member_count >= 0),
  max_members INTEGER DEFAULT 10 CHECK (max_members > 0),
  is_active BOOLEAN DEFAULT true,
  category TEXT DEFAULT 'Créé par utilisateur',
  location TEXT,
  tags TEXT[] DEFAULT '{}',
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL
);

-- Create group_members table
CREATE TABLE group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'moderator', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

-- Create chat_sessions table
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'skipped')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  rating_user1 INTEGER CHECK (rating_user1 BETWEEN 1 AND 5),
  rating_user2 INTEGER CHECK (rating_user2 BETWEEN 1 AND 5)
);

-- Create chat_messages table
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file', 'system')),
  metadata JSONB DEFAULT '{}',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create video_sessions table
CREATE TABLE video_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('connecting', 'active', 'ended', 'failed')),
  quality_stats JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0,
  rating_user1 INTEGER CHECK (rating_user1 BETWEEN 1 AND 5),
  rating_user2 INTEGER CHECK (rating_user2 BETWEEN 1 AND 5)
);

-- Create user_connections table for history
CREATE TABLE user_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  connected_user_id TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('chat', 'video', 'group')),
  session_id UUID,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  notes TEXT,
  is_friend BOOLEAN DEFAULT false,
  connected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_widgets table for customization
CREATE TABLE user_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  widget_type TEXT NOT NULL,
  position JSONB DEFAULT '{"x": 0, "y": 0}',
  size JSONB DEFAULT '{"width": 200, "height": 150}',
  settings JSONB DEFAULT '{}',
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_memory table for preferences and cache
CREATE TABLE user_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, memory_type, key)
);

-- Create indexes for performance
CREATE INDEX idx_online_users_status ON online_users(status);
CREATE INDEX idx_online_users_last_seen ON online_users(last_seen);
CREATE INDEX idx_groups_active ON groups(is_active, last_activity);
CREATE INDEX idx_groups_category ON groups(category);
CREATE INDEX idx_group_members_group_id ON group_members(group_id);
CREATE INDEX idx_group_members_user_id ON group_members(user_id);
CREATE INDEX idx_chat_sessions_users ON chat_sessions(user1_id, user2_id);
CREATE INDEX idx_chat_sessions_status ON chat_sessions(status);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, sent_at);
CREATE INDEX idx_video_sessions_users ON video_sessions(user1_id, user2_id);
CREATE INDEX idx_video_sessions_status ON video_sessions(status);
CREATE INDEX idx_user_connections_user ON user_connections(user_id, connected_at);
CREATE INDEX idx_user_widgets_user ON user_widgets(user_id, widget_type);
CREATE INDEX idx_user_memory_lookup ON user_memory(user_id, memory_type, key);
CREATE INDEX idx_user_memory_expires ON user_memory(expires_at) WHERE expires_at IS NOT NULL;

-- Enable Row Level Security
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

-- Create RLS policies (permissive for development, can be tightened for production)
CREATE POLICY "Allow all operations on user_accounts" ON user_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on online_users" ON online_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on groups" ON groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on group_members" ON group_members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on chat_sessions" ON chat_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on chat_messages" ON chat_messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on video_sessions" ON video_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on user_connections" ON user_connections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on user_widgets" ON user_widgets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on user_memory" ON user_memory FOR ALL USING (true) WITH CHECK (true);

-- Create utility functions
CREATE OR REPLACE FUNCTION cleanup_inactive_users()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM online_users 
  WHERE last_seen < NOW() - INTERVAL '5 minutes';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_inactive_groups()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE groups 
  SET is_active = false 
  WHERE last_activity < NOW() - INTERVAL '30 minutes' 
    AND is_active = true;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_expired_memory()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM user_memory 
  WHERE expires_at IS NOT NULL 
    AND expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_live_stats()
RETURNS TABLE(
  total_users INTEGER,
  online_users INTEGER,
  chat_users INTEGER,
  video_users INTEGER,
  group_users INTEGER,
  active_groups INTEGER,
  total_groups INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*)::INTEGER FROM user_accounts WHERE last_active > NOW() - INTERVAL '24 hours'),
    (SELECT COUNT(*)::INTEGER FROM online_users WHERE last_seen > NOW() - INTERVAL '5 minutes'),
    (SELECT COUNT(*)::INTEGER FROM online_users WHERE status = 'chat' AND last_seen > NOW() - INTERVAL '5 minutes'),
    (SELECT COUNT(*)::INTEGER FROM online_users WHERE status = 'video' AND last_seen > NOW() - INTERVAL '5 minutes'),
    (SELECT COUNT(*)::INTEGER FROM online_users WHERE status = 'group' AND last_seen > NOW() - INTERVAL '5 minutes'),
    (SELECT COUNT(*)::INTEGER FROM groups WHERE is_active = true AND last_activity > NOW() - INTERVAL '30 minutes'),
    (SELECT COUNT(*)::INTEGER FROM groups WHERE is_active = true);
END;
$$ LANGUAGE plpgsql;

-- Create a view for live dashboard
CREATE OR REPLACE VIEW live_dashboard AS
SELECT 
  'users' as metric,
  COUNT(*) as value,
  'Total users (24h)' as description
FROM user_accounts 
WHERE last_active > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
  'online' as metric,
  COUNT(*) as value,
  'Currently online' as description
FROM online_users 
WHERE last_seen > NOW() - INTERVAL '5 minutes'

UNION ALL

SELECT 
  'groups' as metric,
  COUNT(*) as value,
  'Active groups' as description
FROM groups 
WHERE is_active = true AND last_activity > NOW() - INTERVAL '30 minutes';

-- Insert sample data for testing (with properly escaped quotes)
INSERT INTO user_accounts (user_id, display_name, account_type, preferences, stats) VALUES
('demo_user_1', 'Alice', 'anonymous', '{"theme": "dark", "language": "fr"}', '{"chats": 15, "video_calls": 3, "groups_joined": 2}'),
('demo_user_2', 'Bob', 'anonymous', '{"theme": "light", "language": "fr"}', '{"chats": 8, "video_calls": 12, "groups_joined": 1}'),
('demo_user_3', 'Charlie', 'registered', '{"theme": "dark", "language": "en"}', '{"chats": 25, "video_calls": 7, "groups_joined": 4}');

INSERT INTO groups (name, description, member_count, category, location, tags, created_by) VALUES
('🚀 Développeurs Web', 'Communauté de développeurs passionnés par les technologies web modernes', 15, 'Technologie', 'France', ARRAY['développement', 'web', 'javascript', 'react'], 'demo_user_1'),
('🎮 Gamers FR', 'Communauté française de joueurs multi-plateformes', 28, 'Gaming', 'France', ARRAY['gaming', 'jeux', 'communauté'], 'demo_user_2'),
('🎨 Créatifs & Artistes', 'Espace de partage pour les créatifs et artistes', 12, 'Art & Créativité', 'Paris, France', ARRAY['art', 'créativité', 'design'], 'demo_user_3'),
('📚 Étudiants & Apprentissage', 'Groupe d''entraide pour étudiants et apprenants', 22, 'Éducation', 'France', ARRAY['étude', 'apprentissage', 'entraide'], 'demo_user_1'),
('🌍 Voyageurs', 'Partage d''expériences de voyage et conseils', 18, 'Voyage', 'International', ARRAY['voyage', 'découverte', 'culture'], 'demo_user_2');

-- Insert some sample online users
INSERT INTO online_users (user_id, status, location) VALUES
('demo_user_1', 'online', 'Paris, France'),
('demo_user_2', 'chat', 'Lyon, France'),
('demo_user_3', 'video', 'Marseille, France');

-- Insert sample group memberships
INSERT INTO group_members (group_id, user_id, role) VALUES
((SELECT id FROM groups WHERE name = '🚀 Développeurs Web'), 'demo_user_1', 'owner'),
((SELECT id FROM groups WHERE name = '🚀 Développeurs Web'), 'demo_user_3', 'member'),
((SELECT id FROM groups WHERE name = '🎮 Gamers FR'), 'demo_user_2', 'owner'),
((SELECT id FROM groups WHERE name = '🎨 Créatifs & Artistes'), 'demo_user_3', 'owner');

-- Create a function to verify installation
CREATE OR REPLACE FUNCTION verify_installation()
RETURNS TABLE(
  table_name TEXT,
  row_count BIGINT,
  status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    'user_accounts'::TEXT,
    (SELECT COUNT(*) FROM user_accounts),
    CASE WHEN (SELECT COUNT(*) FROM user_accounts) > 0 THEN '✅ OK' ELSE '⚠️ Empty' END
  
  UNION ALL
  
  SELECT 
    'online_users'::TEXT,
    (SELECT COUNT(*) FROM online_users),
    CASE WHEN (SELECT COUNT(*) FROM online_users) > 0 THEN '✅ OK' ELSE '⚠️ Empty' END
  
  UNION ALL
  
  SELECT 
    'groups'::TEXT,
    (SELECT COUNT(*) FROM groups),
    CASE WHEN (SELECT COUNT(*) FROM groups) > 0 THEN '✅ OK' ELSE '⚠️ Empty' END
  
  UNION ALL
  
  SELECT 
    'group_members'::TEXT,
    (SELECT COUNT(*) FROM group_members),
    CASE WHEN (SELECT COUNT(*) FROM group_members) > 0 THEN '✅ OK' ELSE '⚠️ Empty' END;
END;
$$ LANGUAGE plpgsql;

-- Final verification
SELECT 'Installation completed successfully!' as message;
SELECT * FROM verify_installation();
SELECT * FROM get_live_stats();