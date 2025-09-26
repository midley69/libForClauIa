/*
  # Correction du système de chat randomisé LiberTalk

  1. Nouvelles Tables
    - `active_chat_users` - Utilisateurs actifs pour matching en temps réel
    - `chat_matches` - Correspondances actives entre utilisateurs
    - `real_time_messages` - Messages avec synchronisation temps réel améliorée

  2. Fonctions améliorées
    - Matching intelligent avec nettoyage automatique
    - Gestion des utilisateurs inactifs
    - Synchronisation temps réel optimisée

  3. Sécurité
    - RLS activé sur toutes les tables
    - Politiques d'accès optimisées pour les performances
*/

-- Supprimer les anciennes tables si elles existent
DROP TABLE IF EXISTS real_time_messages CASCADE;
DROP TABLE IF EXISTS chat_matches CASCADE;
DROP TABLE IF EXISTS active_chat_users CASCADE;

-- Table pour les utilisateurs actifs en recherche de chat
CREATE TABLE active_chat_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  pseudo TEXT NOT NULL,
  genre TEXT NOT NULL CHECK (genre IN ('homme', 'femme', 'autre')),
  chat_type TEXT NOT NULL CHECK (chat_type IN ('random', 'local', 'group')),
  status TEXT NOT NULL DEFAULT 'searching' CHECK (status IN ('searching', 'matched', 'chatting')),
  location TEXT,
  preferences JSONB DEFAULT '{}',
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table pour les correspondances actives
CREATE TABLE chat_matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user1_id TEXT NOT NULL,
  user1_pseudo TEXT NOT NULL,
  user1_genre TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  user2_pseudo TEXT NOT NULL,
  user2_genre TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('random', 'local', 'group')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'abandoned')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  message_count INTEGER DEFAULT 0
);

-- Table pour les messages temps réel
CREATE TABLE real_time_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID REFERENCES chat_matches(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_pseudo TEXT NOT NULL,
  sender_genre TEXT NOT NULL,
  message_text TEXT NOT NULL,
  message_type TEXT DEFAULT 'user' CHECK (message_type IN ('user', 'system', 'notification')),
  color_code TEXT NOT NULL DEFAULT '#FFFFFF',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered BOOLEAN DEFAULT FALSE,
  read_by_recipient BOOLEAN DEFAULT FALSE
);

-- Index pour les performances
CREATE INDEX idx_active_chat_users_status ON active_chat_users(status, chat_type, last_activity);
CREATE INDEX idx_active_chat_users_searching ON active_chat_users(chat_type, status) WHERE status = 'searching';
CREATE INDEX idx_chat_matches_active ON chat_matches(status, last_activity) WHERE status = 'active';
CREATE INDEX idx_real_time_messages_match ON real_time_messages(match_id, sent_at);
CREATE INDEX idx_real_time_messages_undelivered ON real_time_messages(delivered, sent_at) WHERE delivered = FALSE;

-- Fonction pour nettoyer les utilisateurs inactifs
CREATE OR REPLACE FUNCTION cleanup_inactive_chat_users()
RETURNS INTEGER AS $$
DECLARE
  cleaned_count INTEGER;
BEGIN
  -- Supprimer les utilisateurs inactifs depuis plus de 2 minutes
  DELETE FROM active_chat_users 
  WHERE last_activity < NOW() - INTERVAL '2 minutes';
  
  GET DIAGNOSTICS cleaned_count = ROW_COUNT;
  
  -- Marquer les correspondances abandonnées
  UPDATE chat_matches 
  SET status = 'abandoned', ended_at = NOW()
  WHERE status = 'active' 
    AND last_activity < NOW() - INTERVAL '5 minutes';
  
  RETURN cleaned_count;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour trouver une correspondance intelligente
CREATE OR REPLACE FUNCTION find_smart_match(
  requesting_user_id TEXT,
  user_pseudo TEXT,
  user_genre TEXT,
  chat_type TEXT,
  user_location TEXT DEFAULT NULL
)
RETURNS TABLE(
  match_id UUID,
  partner_user_id TEXT,
  partner_pseudo TEXT,
  partner_genre TEXT,
  partner_location TEXT
) AS $$
DECLARE
  partner_record RECORD;
  new_match_id UUID;
BEGIN
  -- Nettoyer d'abord les utilisateurs inactifs
  PERFORM cleanup_inactive_chat_users();
  
  -- Ajouter ou mettre à jour l'utilisateur demandeur
  INSERT INTO active_chat_users (
    user_id, pseudo, genre, chat_type, status, location, last_activity
  ) VALUES (
    requesting_user_id, user_pseudo, user_genre, chat_type, 'searching', user_location, NOW()
  ) ON CONFLICT (user_id) DO UPDATE SET
    pseudo = EXCLUDED.pseudo,
    genre = EXCLUDED.genre,
    chat_type = EXCLUDED.chat_type,
    status = 'searching',
    location = EXCLUDED.location,
    last_activity = NOW();
  
  -- Chercher un partenaire compatible
  SELECT * INTO partner_record
  FROM active_chat_users
  WHERE user_id != requesting_user_id
    AND chat_type = find_smart_match.chat_type
    AND status = 'searching'
    AND last_activity > NOW() - INTERVAL '2 minutes'
    AND (
      find_smart_match.chat_type != 'local' 
      OR (location IS NOT NULL AND find_smart_match.user_location IS NOT NULL)
    )
  ORDER BY 
    -- Priorité aux utilisateurs récents
    last_activity DESC,
    -- Puis par ordre d'arrivée
    created_at ASC
  LIMIT 1;
  
  -- Si un partenaire est trouvé, créer la correspondance
  IF partner_record IS NOT NULL THEN
    -- Créer la correspondance
    INSERT INTO chat_matches (
      user1_id, user1_pseudo, user1_genre,
      user2_id, user2_pseudo, user2_genre,
      match_type, status, started_at, last_activity
    ) VALUES (
      requesting_user_id, user_pseudo, user_genre,
      partner_record.user_id, partner_record.pseudo, partner_record.genre,
      chat_type, 'active', NOW(), NOW()
    ) RETURNING id INTO new_match_id;
    
    -- Mettre à jour le statut des utilisateurs
    UPDATE active_chat_users 
    SET status = 'matched', last_activity = NOW()
    WHERE user_id IN (requesting_user_id, partner_record.user_id);
    
    -- Ajouter un message de bienvenue
    INSERT INTO real_time_messages (
      match_id, sender_id, sender_pseudo, sender_genre,
      message_text, message_type, color_code
    ) VALUES (
      new_match_id, 'system', 'LiberTalk', 'system',
      '🎉 Vous êtes maintenant connectés ! Dites bonjour 👋', 'system', '#00D4FF'
    );
    
    -- Retourner les informations de la correspondance
    RETURN QUERY SELECT 
      new_match_id,
      partner_record.user_id,
      partner_record.pseudo,
      partner_record.genre,
      partner_record.location;
  END IF;
  
  -- Aucune correspondance trouvée
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour envoyer un message
CREATE OR REPLACE FUNCTION send_chat_message(
  match_id UUID,
  sender_id TEXT,
  sender_pseudo TEXT,
  sender_genre TEXT,
  message_text TEXT
)
RETURNS UUID AS $$
DECLARE
  message_id UUID;
  color_code TEXT;
BEGIN
  -- Déterminer la couleur selon le genre
  CASE sender_genre
    WHEN 'femme' THEN color_code := '#FF69B4';
    WHEN 'homme' THEN color_code := '#1E90FF';
    ELSE color_code := '#A9A9A9';
  END CASE;
  
  -- Insérer le message
  INSERT INTO real_time_messages (
    match_id, sender_id, sender_pseudo, sender_genre,
    message_text, message_type, color_code, sent_at
  ) VALUES (
    match_id, sender_id, sender_pseudo, sender_genre,
    message_text, 'user', color_code, NOW()
  ) RETURNING id INTO message_id;
  
  -- Mettre à jour l'activité de la correspondance
  UPDATE chat_matches 
  SET 
    message_count = message_count + 1,
    last_activity = NOW()
  WHERE id = match_id;
  
  -- Mettre à jour l'activité de l'utilisateur
  UPDATE active_chat_users 
  SET 
    status = 'chatting',
    last_activity = NOW()
  WHERE user_id = sender_id;
  
  RETURN message_id;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour terminer une correspondance
CREATE OR REPLACE FUNCTION end_chat_match(
  match_id UUID,
  ended_by_user_id TEXT,
  end_reason TEXT DEFAULT 'user_action'
)
RETURNS BOOLEAN AS $$
DECLARE
  match_record RECORD;
  other_user_id TEXT;
BEGIN
  -- Récupérer les informations de la correspondance
  SELECT * INTO match_record FROM chat_matches WHERE id = match_id AND status = 'active';
  
  IF match_record IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Déterminer l'autre utilisateur
  IF match_record.user1_id = ended_by_user_id THEN
    other_user_id := match_record.user2_id;
  ELSE
    other_user_id := match_record.user1_id;
  END IF;
  
  -- Marquer la correspondance comme terminée
  UPDATE chat_matches 
  SET 
    status = 'ended',
    ended_at = NOW()
  WHERE id = match_id;
  
  -- Remettre les utilisateurs en recherche ou les supprimer
  IF end_reason = 'skip' THEN
    -- L'utilisateur qui skip reste en recherche
    UPDATE active_chat_users 
    SET status = 'searching', last_activity = NOW()
    WHERE user_id = ended_by_user_id;
    
    -- L'autre utilisateur aussi
    UPDATE active_chat_users 
    SET status = 'searching', last_activity = NOW()
    WHERE user_id = other_user_id;
  ELSE
    -- Supprimer les utilisateurs de la recherche
    DELETE FROM active_chat_users 
    WHERE user_id IN (ended_by_user_id, other_user_id);
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour obtenir les statistiques en temps réel
CREATE OR REPLACE FUNCTION get_chat_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  -- Nettoyer d'abord
  PERFORM cleanup_inactive_chat_users();
  
  SELECT json_build_object(
    'active_users', json_build_object(
      'total', (SELECT COUNT(*) FROM active_chat_users WHERE last_activity > NOW() - INTERVAL '2 minutes'),
      'searching', (SELECT COUNT(*) FROM active_chat_users WHERE status = 'searching' AND last_activity > NOW() - INTERVAL '2 minutes'),
      'chatting', (SELECT COUNT(*) FROM active_chat_users WHERE status IN ('matched', 'chatting') AND last_activity > NOW() - INTERVAL '2 minutes'),
      'by_type', json_build_object(
        'random', (SELECT COUNT(*) FROM active_chat_users WHERE chat_type = 'random' AND status = 'searching' AND last_activity > NOW() - INTERVAL '2 minutes'),
        'local', (SELECT COUNT(*) FROM active_chat_users WHERE chat_type = 'local' AND status = 'searching' AND last_activity > NOW() - INTERVAL '2 minutes'),
        'group', (SELECT COUNT(*) FROM active_chat_users WHERE chat_type = 'group' AND status = 'searching' AND last_activity > NOW() - INTERVAL '2 minutes')
      )
    ),
    'active_matches', (SELECT COUNT(*) FROM chat_matches WHERE status = 'active' AND last_activity > NOW() - INTERVAL '5 minutes'),
    'total_messages_today', (SELECT COUNT(*) FROM real_time_messages WHERE sent_at > CURRENT_DATE),
    'last_updated', NOW()
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour obtenir les messages d'une correspondance
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
) AS $$
BEGIN
  -- Marquer les messages comme livrés
  UPDATE real_time_messages 
  SET delivered = TRUE 
  WHERE real_time_messages.match_id = get_match_messages.match_id 
    AND delivered = FALSE;
  
  RETURN QUERY
  SELECT 
    rtm.id,
    rtm.sender_id,
    rtm.sender_pseudo,
    rtm.sender_genre,
    rtm.message_text,
    rtm.message_type,
    rtm.color_code,
    rtm.sent_at
  FROM real_time_messages rtm
  WHERE rtm.match_id = get_match_messages.match_id
  ORDER BY rtm.sent_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Fonction de maintenance automatique
CREATE OR REPLACE FUNCTION maintain_chat_system()
RETURNS void AS $$
BEGIN
  -- Nettoyer les utilisateurs inactifs
  PERFORM cleanup_inactive_chat_users();
  
  -- Supprimer les anciennes correspondances terminées (plus de 1 heure)
  DELETE FROM chat_matches 
  WHERE status IN ('ended', 'abandoned') 
    AND ended_at < NOW() - INTERVAL '1 hour';
  
  -- Supprimer les anciens messages (plus de 24 heures)
  DELETE FROM real_time_messages 
  WHERE sent_at < NOW() - INTERVAL '24 hours';
  
  -- Mettre à jour les statistiques globales
  PERFORM update_user_stats();
END;
$$ LANGUAGE plpgsql;

-- Activer RLS sur toutes les nouvelles tables
ALTER TABLE active_chat_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE real_time_messages ENABLE ROW LEVEL SECURITY;

-- Politiques RLS pour accès public (démo)
CREATE POLICY "Allow all operations on active_chat_users" ON active_chat_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on chat_matches" ON chat_matches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on real_time_messages" ON real_time_messages FOR ALL USING (true) WITH CHECK (true);

-- Triggers pour maintenir la cohérence
CREATE OR REPLACE FUNCTION update_user_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE active_chat_users 
  SET last_activity = NOW()
  WHERE user_id = NEW.sender_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_activity
  AFTER INSERT ON real_time_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_user_activity();

-- Fonction pour simuler des utilisateurs actifs (pour les tests)
CREATE OR REPLACE FUNCTION simulate_active_users(count INTEGER DEFAULT 10)
RETURNS void AS $$
DECLARE
  i INTEGER;
  genres TEXT[] := ARRAY['homme', 'femme', 'autre'];
  types TEXT[] := ARRAY['random', 'local', 'group'];
  locations TEXT[] := ARRAY['Paris, France', 'Lyon, France', 'Marseille, France', 'Toulouse, France'];
BEGIN
  FOR i IN 1..count LOOP
    INSERT INTO active_chat_users (
      user_id, pseudo, genre, chat_type, status, location, last_activity
    ) VALUES (
      'sim_user_' || i || '_' || extract(epoch from now()),
      'User' || i,
      genres[1 + (i % 3)],
      types[1 + (i % 3)],
      'searching',
      locations[1 + (i % 4)],
      NOW() - (random() * INTERVAL '1 minute')
    ) ON CONFLICT (user_id) DO NOTHING;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Initialiser quelques utilisateurs de test
SELECT simulate_active_users(5);