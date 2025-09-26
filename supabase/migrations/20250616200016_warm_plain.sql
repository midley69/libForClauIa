/*
  # Correction et mise à jour des fonctions de chat randomisé

  1. Fonctions corrigées
    - find_random_chat_partner avec bons paramètres
    - create_random_chat_session 
    - end_random_chat_session
    - get_random_chat_stats

  2. Tables mises à jour
    - random_chat_users avec tous les champs nécessaires
    - random_chat_sessions avec gestion autoswitch
    - random_chat_messages avec couleurs par genre

  3. Sécurité
    - RLS activé sur toutes les tables
    - Policies pour accès public (développement)
*/

-- Supprimer les anciennes fonctions si elles existent
DROP FUNCTION IF EXISTS find_random_chat_partner(text, text);
DROP FUNCTION IF EXISTS find_random_chat_partner(text);
DROP FUNCTION IF EXISTS create_random_chat_session(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS end_random_chat_session(uuid, text, text);
DROP FUNCTION IF EXISTS get_random_chat_stats();

-- Créer ou mettre à jour la table random_chat_users
CREATE TABLE IF NOT EXISTS random_chat_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  pseudo TEXT NOT NULL,
  genre TEXT NOT NULL CHECK (genre IN ('homme', 'femme', 'autre')),
  status TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'connecte', 'hors_ligne')),
  autoswitch_enabled BOOLEAN DEFAULT false,
  preferred_gender TEXT DEFAULT 'tous' CHECK (preferred_gender IN ('homme', 'femme', 'autre', 'tous')),
  country TEXT,
  city TEXT,
  location_filter TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  search_started_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Créer ou mettre à jour la table random_chat_sessions
CREATE TABLE IF NOT EXISTS random_chat_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user1_id TEXT NOT NULL,
  user1_pseudo TEXT NOT NULL,
  user1_genre TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  user2_pseudo TEXT NOT NULL,
  user2_genre TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'autoswitch_waiting')),
  autoswitch_countdown_start TIMESTAMPTZ,
  autoswitch_countdown_remaining INTEGER DEFAULT 30,
  autoswitch_user_id TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  message_count INTEGER DEFAULT 0,
  rating_user1 INTEGER CHECK (rating_user1 >= 1 AND rating_user1 <= 5),
  rating_user2 INTEGER CHECK (rating_user2 >= 1 AND rating_user2 <= 5),
  chat_type TEXT DEFAULT 'random' CHECK (chat_type IN ('random', 'local', 'filtered'))
);

-- Créer ou mettre à jour la table random_chat_messages
CREATE TABLE IF NOT EXISTS random_chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES random_chat_sessions(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_pseudo TEXT NOT NULL,
  sender_genre TEXT NOT NULL CHECK (sender_genre IN ('homme', 'femme', 'autre')),
  message_text TEXT NOT NULL,
  message_type TEXT DEFAULT 'user' CHECK (message_type IN ('user', 'system', 'autoswitch_warning')),
  color_code TEXT DEFAULT CASE
    WHEN sender_genre = 'femme' THEN '#FF69B4'
    WHEN sender_genre = 'homme' THEN '#1E90FF'
    ELSE '#A9A9A9'
  END,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  is_edited BOOLEAN DEFAULT false
);

-- Activer RLS sur toutes les tables
ALTER TABLE random_chat_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE random_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE random_chat_messages ENABLE ROW LEVEL SECURITY;

-- Créer des policies permissives pour le développement
DROP POLICY IF EXISTS "Allow all operations on random_chat_users" ON random_chat_users;
CREATE POLICY "Allow all operations on random_chat_users" ON random_chat_users
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations on random_chat_sessions" ON random_chat_sessions;
CREATE POLICY "Allow all operations on random_chat_sessions" ON random_chat_sessions
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations on random_chat_messages" ON random_chat_messages;
CREATE POLICY "Allow all operations on random_chat_messages" ON random_chat_messages
  FOR ALL USING (true) WITH CHECK (true);

-- Créer des index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_random_chat_users_status ON random_chat_users(status);
CREATE INDEX IF NOT EXISTS idx_random_chat_users_genre ON random_chat_users(genre, status);
CREATE INDEX IF NOT EXISTS idx_random_chat_users_last_seen ON random_chat_users(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_random_chat_users_autoswitch ON random_chat_users(autoswitch_enabled, status);
CREATE INDEX IF NOT EXISTS idx_random_chat_users_location ON random_chat_users(country, city, status);
CREATE INDEX IF NOT EXISTS idx_random_chat_users_search_time ON random_chat_users(search_started_at) WHERE status = 'en_attente';

CREATE INDEX IF NOT EXISTS idx_random_chat_sessions_status ON random_chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_random_chat_sessions_users ON random_chat_sessions(user1_id, user2_id);
CREATE INDEX IF NOT EXISTS idx_random_chat_sessions_active ON random_chat_sessions(status, last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_random_chat_sessions_autoswitch ON random_chat_sessions(status, autoswitch_countdown_start) WHERE status = 'autoswitch_waiting';

CREATE INDEX IF NOT EXISTS idx_random_chat_messages_session ON random_chat_messages(session_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_random_chat_messages_sender ON random_chat_messages(sender_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_random_chat_messages_type ON random_chat_messages(message_type);

-- Fonction pour trouver un partenaire de chat randomisé
CREATE OR REPLACE FUNCTION find_random_chat_partner(
  requesting_user_id TEXT,
  p_location_filter TEXT DEFAULT NULL
)
RETURNS TABLE(
  partner_user_id TEXT,
  partner_pseudo TEXT,
  partner_genre TEXT
) AS $$
BEGIN
  -- Chercher le premier utilisateur disponible (pas de filtres complexes pour l'instant)
  RETURN QUERY
  SELECT 
    rcu.user_id,
    rcu.pseudo,
    rcu.genre
  FROM random_chat_users rcu
  WHERE rcu.user_id != requesting_user_id
    AND rcu.status = 'en_attente'
    AND rcu.last_seen > NOW() - INTERVAL '2 minutes'
  ORDER BY rcu.search_started_at ASC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour créer une session de chat randomisé
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
    status, started_at, last_activity
  ) VALUES (
    user1_id, user1_pseudo, user1_genre,
    user2_id, user2_pseudo, user2_genre,
    'active', NOW(), NOW()
  ) RETURNING id INTO session_id;

  -- Mettre à jour le statut des utilisateurs
  UPDATE random_chat_users 
  SET status = 'connecte', last_seen = NOW()
  WHERE user_id IN (user1_id, user2_id);

  RETURN session_id;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour terminer une session de chat randomisé
CREATE OR REPLACE FUNCTION end_random_chat_session(
  session_id UUID,
  ended_by_user_id TEXT,
  end_reason TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  session_record RECORD;
BEGIN
  -- Récupérer les informations de la session
  SELECT * INTO session_record
  FROM random_chat_sessions
  WHERE id = session_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Marquer la session comme terminée
  UPDATE random_chat_sessions
  SET status = 'ended', ended_at = NOW()
  WHERE id = session_id;

  -- Remettre les utilisateurs en attente ou les supprimer
  IF end_reason = 'user_quit' THEN
    -- Supprimer l'utilisateur qui quitte
    DELETE FROM random_chat_users WHERE user_id = ended_by_user_id;
    
    -- Remettre l'autre utilisateur en attente
    UPDATE random_chat_users 
    SET status = 'en_attente', search_started_at = NOW(), last_seen = NOW()
    WHERE user_id IN (session_record.user1_id, session_record.user2_id)
      AND user_id != ended_by_user_id;
  ELSE
    -- Pour skip ou autres raisons, remettre les deux en attente
    UPDATE random_chat_users 
    SET status = 'en_attente', search_started_at = NOW(), last_seen = NOW()
    WHERE user_id IN (session_record.user1_id, session_record.user2_id);
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour obtenir les statistiques du chat randomisé
CREATE OR REPLACE FUNCTION get_random_chat_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'users', json_build_object(
      'total_waiting', (
        SELECT COUNT(*) 
        FROM random_chat_users 
        WHERE status = 'en_attente' 
          AND last_seen > NOW() - INTERVAL '2 minutes'
      ),
      'total_chatting', (
        SELECT COUNT(*) 
        FROM random_chat_users 
        WHERE status = 'connecte' 
          AND last_seen > NOW() - INTERVAL '2 minutes'
      ),
      'by_genre', json_build_object(
        'homme', (
          SELECT COUNT(*) 
          FROM random_chat_users 
          WHERE genre = 'homme' 
            AND status = 'en_attente' 
            AND last_seen > NOW() - INTERVAL '2 minutes'
        ),
        'femme', (
          SELECT COUNT(*) 
          FROM random_chat_users 
          WHERE genre = 'femme' 
            AND status = 'en_attente' 
            AND last_seen > NOW() - INTERVAL '2 minutes'
        ),
        'autre', (
          SELECT COUNT(*) 
          FROM random_chat_users 
          WHERE genre = 'autre' 
            AND status = 'en_attente' 
            AND last_seen > NOW() - INTERVAL '2 minutes'
        )
      )
    ),
    'sessions', json_build_object(
      'active', (
        SELECT COUNT(*) 
        FROM random_chat_sessions 
        WHERE status = 'active'
      ),
      'today', (
        SELECT COUNT(*) 
        FROM random_chat_sessions 
        WHERE started_at >= CURRENT_DATE
      )
    ),
    'messages', json_build_object(
      'today', (
        SELECT COUNT(*) 
        FROM random_chat_messages 
        WHERE sent_at >= CURRENT_DATE
      )
    ),
    'last_updated', NOW()
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Fonction de nettoyage automatique des utilisateurs inactifs
CREATE OR REPLACE FUNCTION cleanup_inactive_random_chat_users()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Supprimer les utilisateurs inactifs depuis plus de 2 minutes
  DELETE FROM random_chat_users 
  WHERE last_seen < NOW() - INTERVAL '2 minutes';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour gérer la déconnexion d'un utilisateur
CREATE OR REPLACE FUNCTION handle_user_disconnect(p_user_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  active_session RECORD;
BEGIN
  -- Chercher une session active pour cet utilisateur
  SELECT * INTO active_session
  FROM random_chat_sessions
  WHERE (user1_id = p_user_id OR user2_id = p_user_id)
    AND status = 'active'
  LIMIT 1;

  -- Si une session active existe, la terminer
  IF FOUND THEN
    PERFORM end_random_chat_session(active_session.id, p_user_id, 'user_disconnect');
  END IF;

  -- Supprimer l'utilisateur de la table
  DELETE FROM random_chat_users WHERE user_id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;