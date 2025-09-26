/*
  # Create missing chat functions

  This migration creates the essential functions needed for the chat system to work properly.
  
  1. Functions Created
    - `get_chat_stats()` - Returns real-time chat statistics
    - `find_smart_match()` - Finds chat matches for users
    - `send_chat_message()` - Sends messages in chat matches
    - `get_match_messages()` - Retrieves messages for a match
    - `end_chat_match()` - Ends a chat match
    
  2. Tables Created (if not exist)
    - `active_chat_users` - Users currently searching for chat
    - `chat_matches` - Active chat matches between users
    - `real_time_messages` - Messages sent in chat matches
    
  3. Security
    - Enable RLS on all new tables
    - Add appropriate policies for public access
*/

-- Create active_chat_users table if it doesn't exist
CREATE TABLE IF NOT EXISTS active_chat_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text UNIQUE NOT NULL,
  pseudo text NOT NULL,
  genre text NOT NULL CHECK (genre IN ('homme', 'femme', 'autre')),
  chat_type text NOT NULL CHECK (chat_type IN ('random', 'local', 'group')),
  status text NOT NULL DEFAULT 'searching' CHECK (status IN ('searching', 'matched', 'chatting')),
  location text,
  last_activity timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Create chat_matches table if it doesn't exist
CREATE TABLE IF NOT EXISTS chat_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id text NOT NULL,
  user1_pseudo text NOT NULL,
  user1_genre text NOT NULL,
  user2_id text NOT NULL,
  user2_pseudo text NOT NULL,
  user2_genre text NOT NULL,
  match_type text NOT NULL DEFAULT 'random',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'abandoned')),
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  last_activity timestamptz DEFAULT now(),
  message_count integer DEFAULT 0,
  ended_by text,
  end_reason text
);

-- Create real_time_messages table if it doesn't exist
CREATE TABLE IF NOT EXISTS real_time_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES chat_matches(id) ON DELETE CASCADE,
  sender_id text NOT NULL,
  sender_pseudo text NOT NULL,
  sender_genre text NOT NULL,
  message_text text NOT NULL,
  message_type text DEFAULT 'user' CHECK (message_type IN ('user', 'system', 'notification')),
  color_code text DEFAULT '#ffffff',
  sent_at timestamptz DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE active_chat_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE real_time_messages ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (as per existing schema)
DROP POLICY IF EXISTS "Allow all operations on active_chat_users" ON active_chat_users;
CREATE POLICY "Allow all operations on active_chat_users"
  ON active_chat_users
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations on chat_matches" ON chat_matches;
CREATE POLICY "Allow all operations on chat_matches"
  ON chat_matches
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations on real_time_messages" ON real_time_messages;
CREATE POLICY "Allow all operations on real_time_messages"
  ON real_time_messages
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_active_chat_users_user_id ON active_chat_users(user_id);
CREATE INDEX IF NOT EXISTS idx_active_chat_users_status ON active_chat_users(status);
CREATE INDEX IF NOT EXISTS idx_active_chat_users_chat_type ON active_chat_users(chat_type);
CREATE INDEX IF NOT EXISTS idx_active_chat_users_last_activity ON active_chat_users(last_activity);

CREATE INDEX IF NOT EXISTS idx_chat_matches_user1_id ON chat_matches(user1_id);
CREATE INDEX IF NOT EXISTS idx_chat_matches_user2_id ON chat_matches(user2_id);
CREATE INDEX IF NOT EXISTS idx_chat_matches_status ON chat_matches(status);
CREATE INDEX IF NOT EXISTS idx_chat_matches_started_at ON chat_matches(started_at);

CREATE INDEX IF NOT EXISTS idx_real_time_messages_match_id ON real_time_messages(match_id);
CREATE INDEX IF NOT EXISTS idx_real_time_messages_sender_id ON real_time_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_real_time_messages_sent_at ON real_time_messages(sent_at);

-- Function: get_chat_stats
-- Returns real-time statistics about chat activity
CREATE OR REPLACE FUNCTION get_chat_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  total_active integer;
  searching_count integer;
  chatting_count integer;
  random_count integer;
  local_count integer;
  group_count integer;
  active_matches integer;
  messages_today integer;
BEGIN
  -- Get active users counts
  SELECT COUNT(*) INTO total_active FROM active_chat_users WHERE last_activity > now() - interval '5 minutes';
  SELECT COUNT(*) INTO searching_count FROM active_chat_users WHERE status = 'searching' AND last_activity > now() - interval '5 minutes';
  SELECT COUNT(*) INTO chatting_count FROM active_chat_users WHERE status = 'chatting' AND last_activity > now() - interval '5 minutes';
  
  -- Get counts by chat type
  SELECT COUNT(*) INTO random_count FROM active_chat_users WHERE chat_type = 'random' AND status = 'searching' AND last_activity > now() - interval '5 minutes';
  SELECT COUNT(*) INTO local_count FROM active_chat_users WHERE chat_type = 'local' AND status = 'searching' AND last_activity > now() - interval '5 minutes';
  SELECT COUNT(*) INTO group_count FROM active_chat_users WHERE chat_type = 'group' AND status = 'searching' AND last_activity > now() - interval '5 minutes';
  
  -- Get active matches
  SELECT COUNT(*) INTO active_matches FROM chat_matches WHERE status = 'active';
  
  -- Get messages today
  SELECT COUNT(*) INTO messages_today FROM real_time_messages WHERE sent_at >= CURRENT_DATE;
  
  -- Build result
  result := jsonb_build_object(
    'active_users', jsonb_build_object(
      'total', total_active,
      'searching', searching_count,
      'chatting', chatting_count,
      'by_type', jsonb_build_object(
        'random', random_count,
        'local', local_count,
        'group', group_count
      )
    ),
    'active_matches', active_matches,
    'total_messages_today', messages_today,
    'last_updated', now()
  );
  
  RETURN result;
END;
$$;

-- Function: find_smart_match
-- Finds a suitable chat partner for a user
CREATE OR REPLACE FUNCTION find_smart_match(
  requesting_user_id text,
  user_pseudo text,
  user_genre text,
  chat_type text,
  user_location text DEFAULT NULL
)
RETURNS TABLE(match_id uuid, partner_id text, partner_pseudo text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  partner_record record;
  new_match_id uuid;
BEGIN
  -- First, add the requesting user to active users
  INSERT INTO active_chat_users (user_id, pseudo, genre, chat_type, status, location)
  VALUES (requesting_user_id, user_pseudo, user_genre, chat_type, 'searching', user_location)
  ON CONFLICT (user_id) DO UPDATE SET
    pseudo = EXCLUDED.pseudo,
    genre = EXCLUDED.genre,
    chat_type = EXCLUDED.chat_type,
    status = 'searching',
    location = EXCLUDED.location,
    last_activity = now();
  
  -- Look for a suitable partner
  SELECT * INTO partner_record
  FROM active_chat_users
  WHERE user_id != requesting_user_id
    AND chat_type = find_smart_match.chat_type
    AND status = 'searching'
    AND last_activity > now() - interval '5 minutes'
    AND (find_smart_match.user_location IS NULL OR location IS NULL OR location = find_smart_match.user_location)
  ORDER BY last_activity DESC
  LIMIT 1;
  
  -- If partner found, create match
  IF partner_record IS NOT NULL THEN
    -- Create the match
    INSERT INTO chat_matches (user1_id, user1_pseudo, user1_genre, user2_id, user2_pseudo, user2_genre, match_type)
    VALUES (requesting_user_id, user_pseudo, user_genre, partner_record.user_id, partner_record.pseudo, partner_record.genre, chat_type)
    RETURNING id INTO new_match_id;
    
    -- Update both users status to matched
    UPDATE active_chat_users 
    SET status = 'chatting', last_activity = now()
    WHERE user_id IN (requesting_user_id, partner_record.user_id);
    
    -- Return match info
    RETURN QUERY SELECT new_match_id, partner_record.user_id, partner_record.pseudo;
  END IF;
  
  -- No match found
  RETURN;
END;
$$;

-- Function: send_chat_message
-- Sends a message in a chat match
CREATE OR REPLACE FUNCTION send_chat_message(
  match_id uuid,
  sender_id text,
  sender_pseudo text,
  sender_genre text,
  message_text text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  message_id uuid;
  color_code text;
BEGIN
  -- Set color based on genre
  color_code := CASE sender_genre
    WHEN 'homme' THEN '#3B82F6'
    WHEN 'femme' THEN '#EC4899'
    ELSE '#10B981'
  END;
  
  -- Insert message
  INSERT INTO real_time_messages (match_id, sender_id, sender_pseudo, sender_genre, message_text, color_code)
  VALUES (match_id, sender_id, sender_pseudo, sender_genre, message_text, color_code)
  RETURNING id INTO message_id;
  
  -- Update match activity and message count
  UPDATE chat_matches 
  SET last_activity = now(), message_count = message_count + 1
  WHERE id = match_id;
  
  -- Update sender activity
  UPDATE active_chat_users 
  SET last_activity = now()
  WHERE user_id = sender_id;
  
  RETURN message_id;
END;
$$;

-- Function: get_match_messages
-- Retrieves messages for a specific match
CREATE OR REPLACE FUNCTION get_match_messages(match_id uuid)
RETURNS TABLE(
  id uuid,
  sender_id text,
  sender_pseudo text,
  sender_genre text,
  message_text text,
  message_type text,
  color_code text,
  sent_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.sender_id, m.sender_pseudo, m.sender_genre, m.message_text, m.message_type, m.color_code, m.sent_at
  FROM real_time_messages m
  WHERE m.match_id = get_match_messages.match_id
  ORDER BY m.sent_at ASC;
END;
$$;

-- Function: end_chat_match
-- Ends a chat match
CREATE OR REPLACE FUNCTION end_chat_match(
  match_id uuid,
  ended_by_user_id text,
  end_reason text DEFAULT 'user_action'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  match_record record;
BEGIN
  -- Get match details
  SELECT * INTO match_record FROM chat_matches WHERE id = match_id AND status = 'active';
  
  IF match_record IS NULL THEN
    RETURN false;
  END IF;
  
  -- End the match
  UPDATE chat_matches 
  SET status = 'ended', ended_at = now(), ended_by = ended_by_user_id, end_reason = end_reason
  WHERE id = match_id;
  
  -- Remove users from active chat users
  DELETE FROM active_chat_users 
  WHERE user_id IN (match_record.user1_id, match_record.user2_id);
  
  RETURN true;
END;
$$;

-- Function: cleanup_inactive_users
-- Removes inactive users from active_chat_users
CREATE OR REPLACE FUNCTION cleanup_inactive_users()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM active_chat_users 
  WHERE last_activity < now() - interval '10 minutes';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Create a trigger to automatically cleanup inactive users
CREATE OR REPLACE FUNCTION trigger_cleanup_inactive_users()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Run cleanup every time someone joins
  PERFORM cleanup_inactive_users();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleanup_trigger ON active_chat_users;
CREATE TRIGGER cleanup_trigger
  AFTER INSERT ON active_chat_users
  FOR EACH ROW
  EXECUTE FUNCTION trigger_cleanup_inactive_users();

-- Insert some sample data for testing
INSERT INTO active_chat_users (user_id, pseudo, genre, chat_type, status) VALUES
  ('test_user_1', 'Alice', 'femme', 'random', 'searching'),
  ('test_user_2', 'Bob', 'homme', 'random', 'searching'),
  ('test_user_3', 'Charlie', 'autre', 'local', 'searching')
ON CONFLICT (user_id) DO NOTHING;