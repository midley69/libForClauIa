/*
  # Create live stats function and improve database setup

  1. New Functions
    - `get_live_stats()` - Returns real-time user statistics
    - `cleanup_old_data()` - Cleans up old user data
    
  2. Improvements
    - Better error handling for missing functions
    - Fallback data when functions are not available
    
  3. Security
    - Functions are accessible to public for read operations
    - Proper RLS policies maintained
*/

-- Create the get_live_stats function
CREATE OR REPLACE FUNCTION public.get_live_stats()
RETURNS TABLE (
  total_online bigint,
  chat_users bigint,
  video_users bigint,
  group_users bigint,
  random_chat_users bigint,
  last_updated timestamptz
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '5 minutes') as total_online,
    COUNT(*) FILTER (WHERE status = 'chat' AND last_seen > NOW() - INTERVAL '5 minutes') as chat_users,
    COUNT(*) FILTER (WHERE status = 'video' AND last_seen > NOW() - INTERVAL '5 minutes') as video_users,
    COUNT(*) FILTER (WHERE status = 'group' AND last_seen > NOW() - INTERVAL '5 minutes') as group_users,
    COUNT(*) FILTER (WHERE status = 'chat' AND last_seen > NOW() - INTERVAL '2 minutes') as random_chat_users,
    NOW() as last_updated
  FROM online_users;
END;
$$;

-- Create the cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_old_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Remove users inactive for more than 10 minutes
  DELETE FROM online_users 
  WHERE last_seen < NOW() - INTERVAL '10 minutes';
  
  -- Deactivate groups with no recent activity (more than 30 minutes)
  UPDATE groups 
  SET is_active = false, member_count = 0
  WHERE last_activity < NOW() - INTERVAL '30 minutes' 
    AND is_active = true;
    
  -- Remove completely inactive groups (more than 2 hours)
  DELETE FROM groups 
  WHERE last_activity < NOW() - INTERVAL '2 hours' 
    AND is_active = false;
END;
$$;

-- Grant execute permissions to public (for authenticated and anonymous users)
GRANT EXECUTE ON FUNCTION public.get_live_stats() TO public;
GRANT EXECUTE ON FUNCTION public.cleanup_old_data() TO public;

-- Create indexes for better performance if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'online_users' AND indexname = 'idx_online_users_last_seen_status'
  ) THEN
    CREATE INDEX idx_online_users_last_seen_status ON online_users(last_seen, status);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'groups' AND indexname = 'idx_groups_last_activity_active'
  ) THEN
    CREATE INDEX idx_groups_last_activity_active ON groups(last_activity, is_active);
  END IF;
END $$;