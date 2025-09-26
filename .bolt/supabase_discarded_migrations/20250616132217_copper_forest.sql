/*
  # Correction des fonctions manquantes pour LiberTalk

  1. Fonctions créées
    - `get_chat_stats()` - Statistiques en temps réel du chat
    - `find_smart_match()` - Recherche intelligente de correspondances
    - `send_chat_message()` - Envoi de messages avec couleurs par genre
    - `get_match_messages()` - Récupération des messages d'une correspondance
    - `end_chat_match()` - Fin d'une correspondance de chat

  2. Tables créées si manquantes
    - `active_chat_users` - Utilisateurs actifs en recherche
    - `chat_matches` - Correspondances de chat actives
    - `real_time_messages` - Messages en temps réel

  3. Sécurité
    - RLS activé sur toutes les tables
    - Politiques d'accès public pour le développement
    - Index de performance ajoutés

  4. Données de test
    - Utilisateurs de démonstration pour tests immédiats
*/

-- Créer les tables manquantes si elles n'existent pas
CREATE TABLE IF NOT EXISTS active_chat_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL,
  pseudo TEXT NOT NULL,
  genre TEXT CHECK (genre IN ('homme', 'femme', 'autre')) NOT NULL,
  chat_type TEXT CHECK (chat_type IN ('random', 'local', 'group')) NOT NULL,
  status TEXT CHECK (status IN ('searching', 'matched', 'chatting')) DEFAULT 'searching',
  location TEXT,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id TEXT NOT NULL,
  user1_pseudo TEXT NOT NULL,
  user1_genre TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  user2_pseudo TEXT NOT NULL,
  user2_genre TEXT NOT NULL,
  match_type TEXT DEFAULT 'random',
  status TEXT CHECK (status IN ('active', 'ended', 'abandoned')) DEFAULT 'active',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  message_count INTEGER DEFAULT 0,
  ended_by TEXT,
  end_reason TEXT
);

CREATE TABLE IF NOT EXISTS real_time_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID REFERENCES chat_matches(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_pseudo TEXT NOT NULL,
  sender_genre TEXT NOT NULL,
  message_text TEXT NOT NULL,
  message_type TEXT DEFAULT 'user' CHECK (message_type IN ('user', 'system', 'notification')),
  color_code TEXT DEFAULT '#ffffff',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activer RLS sur toutes les tables
ALTER TABLE active_chat_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE real_time_messages ENABLE ROW LEVEL SECURITY;

-- Créer les politiques d'accès public
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'active_chat_users' 
    AND policyname = 'Allow all operations on active_chat_users'
  ) THEN
    CREATE POLICY "Allow all operations on active_chat_users"
      ON active_chat_users
      FOR ALL
      TO public
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'chat_matches' 
    AND policyname = 'Allow all operations on chat_matches'
  ) THEN
    CREATE POLICY "Allow all operations on chat_matches"
      ON chat_matches
      FOR ALL
      TO public
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'real_time_messages' 
    AND policyname = 'Allow all operations on real_time_messages'
  ) THEN
    CREATE POLICY "Allow all operations on real_time_messages"
      ON real_time_messages
      FOR ALL
      TO public
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Créer les index pour les performances
CREATE INDEX IF NOT EXISTS idx_active_chat_users_status ON active_chat_users(status);
CREATE INDEX IF NOT EXISTS idx_active_chat_users_chat_type ON active_chat_users(chat_type);
CREATE INDEX IF NOT EXISTS idx_active_chat_users_last_activity ON active_chat_users(last_activity);
CREATE INDEX IF NOT EXISTS idx_chat_matches_status ON chat_matches(status);
CREATE INDEX IF NOT EXISTS idx_chat_matches_started_at ON chat_matches(started_at);
CREATE INDEX IF NOT EXISTS idx_real_time_messages_match_id ON real_time_messages(match_id);
CREATE INDEX IF NOT EXISTS idx_real_time_messages_sent_at ON real_time_messages(sent_at);

-- Fonction: Obtenir les statistiques du chat
CREATE OR REPLACE FUNCTION get_chat_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  total_active INTEGER;
  searching_count INTEGER;
  chatting_count INTEGER;
  random_count INTEGER;
  local_count INTEGER;
  group_count INTEGER;
  active_matches_count INTEGER;
  messages_today INTEGER;
BEGIN
  -- Nettoyer les utilisateurs inactifs d'abord
  DELETE FROM active_chat_users WHERE last_activity < NOW() - INTERVAL '10 minutes';
  
  -- Compter les utilisateurs actifs
  SELECT COUNT(*) INTO total_active 
  FROM active_chat_users 
  WHERE last_activity > NOW() - INTERVAL '5 minutes';
  
  SELECT COUNT(*) INTO searching_count 
  FROM active_chat_users 
  WHERE status = 'searching' AND last_activity > NOW() - INTERVAL '5 minutes';
  
  SELECT COUNT(*) INTO chatting_count 
  FROM active_chat_users 
  WHERE status = 'chatting' AND last_activity > NOW() - INTERVAL '5 minutes';
  
  -- Compter par type de chat
  SELECT COUNT(*) INTO random_count 
  FROM active_chat_users 
  WHERE chat_type = 'random' AND status = 'searching' AND last_activity > NOW() - INTERVAL '5 minutes';
  
  SELECT COUNT(*) INTO local_count 
  FROM active_chat_users 
  WHERE chat_type = 'local' AND status = 'searching' AND last_activity > NOW() - INTERVAL '5 minutes';
  
  SELECT COUNT(*) INTO group_count 
  FROM active_chat_users 
  WHERE chat_type = 'group' AND status = 'searching' AND last_activity > NOW() - INTERVAL '5 minutes';
  
  -- Compter les correspondances actives
  SELECT COUNT(*) INTO active_matches_count 
  FROM chat_matches 
  WHERE status = 'active';
  
  -- Compter les messages d'aujourd'hui
  SELECT COUNT(*) INTO messages_today 
  FROM real_time_messages 
  WHERE sent_at >= CURRENT_DATE;
  
  -- Construire le résultat JSON
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
    'active_matches', active_matches_count,
    'total_messages_today', messages_today,
    'last_updated', TO_CHAR(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
  
  RETURN result;
END;
$$;

-- Fonction: Recherche intelligente de correspondances
CREATE OR REPLACE FUNCTION find_smart_match(
  requesting_user_id TEXT,
  user_pseudo TEXT,
  user_genre TEXT,
  chat_type TEXT,
  user_location TEXT DEFAULT NULL
)
RETURNS TABLE(match_id UUID, matched_user_id TEXT, matched_user_pseudo TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  matched_user_record RECORD;
  new_match_id UUID;
BEGIN
  -- Nettoyer les utilisateurs inactifs
  DELETE FROM active_chat_users WHERE last_activity < NOW() - INTERVAL '10 minutes';
  
  -- Ajouter ou mettre à jour l'utilisateur demandeur
  INSERT INTO active_chat_users (user_id, pseudo, genre, chat_type, status, location, last_activity)
  VALUES (requesting_user_id, user_pseudo, user_genre, chat_type, 'searching', user_location, NOW())
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    pseudo = EXCLUDED.pseudo,
    genre = EXCLUDED.genre,
    chat_type = EXCLUDED.chat_type,
    status = 'searching',
    location = EXCLUDED.location,
    last_activity = NOW();
  
  -- Chercher une correspondance (exclure le même utilisateur, préférer un genre différent)
  SELECT * INTO matched_user_record
  FROM active_chat_users 
  WHERE user_id != requesting_user_id 
    AND chat_type = find_smart_match.chat_type
    AND status = 'searching'
    AND last_activity > NOW() - INTERVAL '5 minutes'
    AND (user_location IS NULL OR location IS NULL OR location = user_location)
  ORDER BY 
    CASE WHEN genre != user_genre THEN 0 ELSE 1 END,
    last_activity DESC
  LIMIT 1;
  
  -- Si une correspondance est trouvée, créer l'enregistrement de correspondance
  IF matched_user_record IS NOT NULL THEN
    -- Générer un nouvel ID de correspondance
    new_match_id := gen_random_uuid();
    
    -- Créer l'enregistrement de correspondance
    INSERT INTO chat_matches (
      id, user1_id, user1_pseudo, user1_genre, 
      user2_id, user2_pseudo, user2_genre, 
      match_type, status, started_at, last_activity
    ) VALUES (
      new_match_id, requesting_user_id, user_pseudo, user_genre,
      matched_user_record.user_id, matched_user_record.pseudo, matched_user_record.genre,
      chat_type, 'active', NOW(), NOW()
    );
    
    -- Mettre à jour le statut des deux utilisateurs
    UPDATE active_chat_users 
    SET status = 'matched', last_activity = NOW()
    WHERE user_id IN (requesting_user_id, matched_user_record.user_id);
    
    -- Retourner les informations de correspondance
    RETURN QUERY SELECT new_match_id, matched_user_record.user_id, matched_user_record.pseudo;
  END IF;
  
  -- Aucune correspondance trouvée
  RETURN;
END;
$$;

-- Fonction: Envoyer un message de chat
CREATE OR REPLACE FUNCTION send_chat_message(
  match_id UUID,
  sender_id TEXT,
  sender_pseudo TEXT,
  sender_genre TEXT,
  message_text TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  message_id UUID;
  color_code TEXT;
BEGIN
  -- Générer l'ID du message
  message_id := gen_random_uuid();
  
  -- Définir la couleur selon le genre
  color_code := CASE 
    WHEN sender_genre = 'homme' THEN '#3B82F6'
    WHEN sender_genre = 'femme' THEN '#EC4899'
    ELSE '#10B981'
  END;
  
  -- Insérer le message
  INSERT INTO real_time_messages (
    id, match_id, sender_id, sender_pseudo, sender_genre,
    message_text, message_type, color_code, sent_at
  ) VALUES (
    message_id, match_id, sender_id, sender_pseudo, sender_genre,
    message_text, 'user', color_code, NOW()
  );
  
  -- Mettre à jour l'activité de la correspondance et le nombre de messages
  UPDATE chat_matches 
  SET last_activity = NOW(), message_count = message_count + 1
  WHERE id = match_id;
  
  -- Mettre à jour l'activité de l'utilisateur
  UPDATE active_chat_users 
  SET last_activity = NOW(), status = 'chatting'
  WHERE user_id = sender_id;
  
  RETURN message_id;
END;
$$;

-- Fonction: Obtenir les messages d'une correspondance
CREATE OR REPLACE FUNCTION get_match_messages(match_id UUID)
RETURNS TABLE(
  id UUID,
  sender_id TEXT,
  sender_pseudo TEXT,
  sender_genre TEXT,
  message_text TEXT,
  message_type TEXT,
  color_code TEXT,
  sent_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.sender_id, m.sender_pseudo, m.sender_genre,
         m.message_text, m.message_type, m.color_code, m.sent_at
  FROM real_time_messages m
  WHERE m.match_id = get_match_messages.match_id
  ORDER BY m.sent_at ASC;
END;
$$;

-- Fonction: Terminer une correspondance de chat
CREATE OR REPLACE FUNCTION end_chat_match(
  match_id UUID,
  ended_by_user_id TEXT,
  end_reason TEXT DEFAULT 'user_action'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  match_record RECORD;
BEGIN
  -- Obtenir les détails de la correspondance
  SELECT * INTO match_record FROM chat_matches WHERE id = match_id;
  
  IF match_record IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Mettre à jour le statut de la correspondance
  UPDATE chat_matches 
  SET status = 'ended', 
      ended_at = NOW(), 
      ended_by = ended_by_user_id,
      end_reason = end_chat_match.end_reason
  WHERE id = match_id;
  
  -- Supprimer les utilisateurs du chat actif
  DELETE FROM active_chat_users 
  WHERE user_id IN (match_record.user1_id, match_record.user2_id);
  
  RETURN TRUE;
END;
$$;

-- Ajouter des données de test pour les démonstrations
INSERT INTO active_chat_users (user_id, pseudo, genre, chat_type, status, last_activity) VALUES
('demo_user_1', 'Alice', 'femme', 'random', 'searching', NOW() - INTERVAL '1 minute'),
('demo_user_2', 'Bob', 'homme', 'random', 'searching', NOW() - INTERVAL '2 minutes'),
('demo_user_3', 'Charlie', 'autre', 'local', 'searching', NOW() - INTERVAL '30 seconds'),
('demo_user_4', 'Diana', 'femme', 'random', 'searching', NOW() - INTERVAL '45 seconds'),
('demo_user_5', 'Ethan', 'homme', 'local', 'searching', NOW() - INTERVAL '1.5 minutes')
ON CONFLICT (user_id) DO UPDATE SET
  pseudo = EXCLUDED.pseudo,
  genre = EXCLUDED.genre,
  chat_type = EXCLUDED.chat_type,
  status = EXCLUDED.status,
  last_activity = EXCLUDED.last_activity;

-- Vérification finale - tester les fonctions
DO $$
DECLARE
  stats_result JSONB;
  test_match RECORD;
BEGIN
  -- Tester get_chat_stats
  SELECT get_chat_stats() INTO stats_result;
  RAISE NOTICE 'Statistiques de test: %', stats_result;
  
  -- Tester find_smart_match
  SELECT * INTO test_match FROM find_smart_match('test_user_123', 'TestUser', 'homme', 'random', NULL);
  IF test_match.match_id IS NOT NULL THEN
    RAISE NOTICE 'Test de correspondance réussi: %', test_match.match_id;
  ELSE
    RAISE NOTICE 'Aucune correspondance trouvée (normal si pas assez d''utilisateurs)';
  END IF;
  
  RAISE NOTICE 'Installation des fonctions terminée avec succès !';
END $$;