-- Create user_accounts table if not exists
CREATE TABLE IF NOT EXISTS user_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text UNIQUE NOT NULL,
  display_name text,
  avatar_url text,
  account_type text NOT NULL DEFAULT 'anonymous' CHECK (account_type IN ('anonymous', 'registered')),
  preferences jsonb DEFAULT '{}',
  stats jsonb DEFAULT '{"chats": 0, "video_calls": 0, "groups_joined": 0}',
  last_active timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create online_users table if not exists
CREATE TABLE IF NOT EXISTS online_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'chat', 'video', 'group')),
  location text,
  last_seen timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create groups table if not exists
CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  member_count integer DEFAULT 1 CHECK (member_count >= 0),
  max_members integer DEFAULT 10 CHECK (max_members > 0),
  is_active boolean DEFAULT true,
  category text DEFAULT 'Créé par utilisateur',
  location text,
  tags text[] DEFAULT '{}',
  last_activity timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  created_by text NOT NULL
);

-- Create group_members table if not exists
CREATE TABLE IF NOT EXISTS group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text DEFAULT 'member' CHECK (role IN ('owner', 'moderator', 'member')),
  joined_at timestamptz DEFAULT now(),
  last_active timestamptz DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- Create chat_sessions table if not exists
CREATE TABLE IF NOT EXISTS chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id text NOT NULL,
  user2_id text NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active', 'ended', 'skipped')),
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  message_count integer DEFAULT 0,
  rating_user1 integer CHECK (rating_user1 >= 1 AND rating_user1 <= 5),
  rating_user2 integer CHECK (rating_user2 >= 1 AND rating_user2 <= 5)
);

-- Create chat_messages table if not exists
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender_id text NOT NULL,
  content text NOT NULL,
  message_type text DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file', 'system')),
  metadata jsonb DEFAULT '{}',
  sent_at timestamptz DEFAULT now()
);

-- Create video_sessions table if not exists
CREATE TABLE IF NOT EXISTS video_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id text NOT NULL,
  user2_id text NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('connecting', 'active', 'ended', 'failed')),
  quality_stats jsonb DEFAULT '{}',
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer DEFAULT 0,
  rating_user1 integer CHECK (rating_user1 >= 1 AND rating_user1 <= 5),
  rating_user2 integer CHECK (rating_user2 >= 1 AND rating_user2 <= 5)
);

-- Create user_connections table if not exists
CREATE TABLE IF NOT EXISTS user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  connected_user_id text NOT NULL,
  connection_type text NOT NULL CHECK (connection_type IN ('chat', 'video', 'group')),
  session_id uuid,
  rating integer CHECK (rating >= 1 AND rating <= 5),
  notes text,
  is_friend boolean DEFAULT false,
  connected_at timestamptz DEFAULT now()
);

-- Create user_widgets table if not exists
CREATE TABLE IF NOT EXISTS user_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  widget_type text NOT NULL,
  position jsonb DEFAULT '{"x": 0, "y": 0}',
  size jsonb DEFAULT '{"width": 200, "height": 150}',
  settings jsonb DEFAULT '{}',
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create user_memory table if not exists
CREATE TABLE IF NOT EXISTS user_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  memory_type text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, memory_type, key)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_online_users_status ON online_users(status);
CREATE INDEX IF NOT EXISTS idx_online_users_last_seen ON online_users(last_seen);
CREATE INDEX IF NOT EXISTS idx_groups_active ON groups(is_active, last_activity);
CREATE INDEX IF NOT EXISTS idx_groups_category ON groups(category);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_users ON chat_sessions(user1_id, user2_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_video_sessions_status ON video_sessions(status);
CREATE INDEX IF NOT EXISTS idx_video_sessions_users ON video_sessions(user1_id, user2_id);
CREATE INDEX IF NOT EXISTS idx_user_connections_user ON user_connections(user_id, connected_at);
CREATE INDEX IF NOT EXISTS idx_user_widgets_user ON user_widgets(user_id, widget_type);
CREATE INDEX IF NOT EXISTS idx_user_memory_lookup ON user_memory(user_id, memory_type, key);
CREATE INDEX IF NOT EXISTS idx_user_memory_expires ON user_memory(expires_at) WHERE expires_at IS NOT NULL;

-- Enable Row Level Security on all tables
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

-- Create permissive policies for development (allow all operations)
DO $$
BEGIN
  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS "Allow all operations on user_accounts" ON user_accounts;
  DROP POLICY IF EXISTS "Allow all operations on online_users" ON online_users;
  DROP POLICY IF EXISTS "Allow all operations on groups" ON groups;
  DROP POLICY IF EXISTS "Allow all operations on group_members" ON group_members;
  DROP POLICY IF EXISTS "Allow all operations on chat_sessions" ON chat_sessions;
  DROP POLICY IF EXISTS "Allow all operations on chat_messages" ON chat_messages;
  DROP POLICY IF EXISTS "Allow all operations on video_sessions" ON video_sessions;
  DROP POLICY IF EXISTS "Allow all operations on user_connections" ON user_connections;
  DROP POLICY IF EXISTS "Allow all operations on user_widgets" ON user_widgets;
  DROP POLICY IF EXISTS "Allow all operations on user_memory" ON user_memory;

  -- Create new permissive policies
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
END $$;

-- Drop and recreate the live_dashboard view
DROP VIEW IF EXISTS live_dashboard;
CREATE VIEW live_dashboard AS
SELECT 
  'Total Users' as metric,
  COUNT(*) as value,
  'Total registered user accounts' as description
FROM user_accounts
UNION ALL
SELECT 
  'Online Users' as metric,
  COUNT(*) as value,
  'Currently active users' as description
FROM online_users 
WHERE last_seen > NOW() - INTERVAL '5 minutes'
UNION ALL
SELECT 
  'Active Groups' as metric,
  COUNT(*) as value,
  'Currently active groups' as description
FROM groups 
WHERE is_active = true AND last_activity > NOW() - INTERVAL '30 minutes';

-- Insert some sample data for testing
INSERT INTO user_accounts (user_id, display_name, account_type, stats) VALUES
  ('demo_user_1', 'Alice', 'anonymous', '{"chats": 5, "video_calls": 2, "groups_joined": 1}'),
  ('demo_user_2', 'Bob', 'anonymous', '{"chats": 3, "video_calls": 1, "groups_joined": 2}'),
  ('demo_user_3', 'Charlie', 'registered', '{"chats": 12, "video_calls": 8, "groups_joined": 3}')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO online_users (user_id, status, location) VALUES
  ('demo_user_1', 'online', 'Paris, France'),
  ('demo_user_2', 'chat', 'Lyon, France'),
  ('demo_user_3', 'video', 'Marseille, France')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO groups (name, description, member_count, category, location, created_by) VALUES
  ('🚀 Développeurs Web', 'Communauté de développeurs passionnés par les technologies web modernes', 15, 'Technologie', 'France', 'demo_user_1'),
  ('🎮 Gamers FR', 'Communauté française de joueurs multi-plateformes', 28, 'Gaming', 'France', 'demo_user_2'),
  ('🎨 Créatifs & Artistes', 'Espace de partage pour les créatifs et artistes', 12, 'Art & Créativité', 'Paris, France', 'demo_user_3')
ON CONFLICT DO NOTHING;

-- Drop existing functions if they exist and recreate them
DROP FUNCTION IF EXISTS cleanup_inactive_users();
DROP FUNCTION IF EXISTS cleanup_inactive_groups();
DROP FUNCTION IF EXISTS get_live_stats();

-- Create utility functions
CREATE FUNCTION cleanup_inactive_users()
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

CREATE FUNCTION cleanup_inactive_groups()
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

CREATE FUNCTION get_live_stats()
RETURNS TABLE(
  total_users BIGINT,
  online_users BIGINT,
  active_groups BIGINT,
  chat_sessions BIGINT,
  video_sessions BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM user_accounts)::BIGINT,
    (SELECT COUNT(*) FROM online_users WHERE last_seen > NOW() - INTERVAL '5 minutes')::BIGINT,
    (SELECT COUNT(*) FROM groups WHERE is_active = true AND last_activity > NOW() - INTERVAL '30 minutes')::BIGINT,
    (SELECT COUNT(*) FROM chat_sessions WHERE status = 'active')::BIGINT,
    (SELECT COUNT(*) FROM video_sessions WHERE status IN ('connecting', 'active'))::BIGINT;
END;
$$ LANGUAGE plpgsql;