/*
  # Fix Random Chat Partner Function

  1. Database Changes
    - Fix ambiguous column reference in find_random_chat_partner function
    - Rename location_filter parameter to p_location_filter to avoid conflicts
    - Update function logic to handle the parameter correctly

  2. Security
    - Maintain existing RLS policies
    - No changes to table permissions
*/

-- Drop the existing function if it exists
DROP FUNCTION IF EXISTS find_random_chat_partner(text, text);

-- Create the corrected function with proper parameter naming
CREATE OR REPLACE FUNCTION find_random_chat_partner(
  requesting_user_id text,
  p_location_filter text DEFAULT NULL
)
RETURNS TABLE (
  partner_user_id text,
  partner_pseudo text,
  partner_genre text
) 
LANGUAGE plpgsql
AS $$
BEGIN
  -- Find a suitable partner for random chat
  RETURN QUERY
  SELECT 
    rcu.user_id,
    rcu.pseudo,
    rcu.genre
  FROM random_chat_users rcu
  WHERE rcu.user_id != requesting_user_id
    AND rcu.status = 'en_attente'
    AND rcu.last_seen > (NOW() - INTERVAL '5 minutes')
    AND (p_location_filter IS NULL OR rcu.country = p_location_filter OR rcu.city = p_location_filter)
  ORDER BY rcu.search_started_at ASC
  LIMIT 1;
END;
$$;