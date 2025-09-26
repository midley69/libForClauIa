/*
  # Correction des statistiques temps réel et logiques de chat

  1. Tables optimisées
    - `online_users` - Présence utilisateur en temps réel
    - `chat_sessions` - Sessions de chat actives
    - `chat_messages` - Messages de chat
    - `user_stats` - Statistiques utilisateur
    - `random_chat_users` - Utilisateurs chat randomisé
    - `random_chat_sessions` - Sessions chat randomisé
    - `random_chat_messages` - Messages chat randomisé

  2. Fonctions temps réel
    - Mise à jour automatique des statistiques
    - Nettoyage automatique des utilisateurs inactifs
    - Gestion des sessions de chat

  3. Triggers pour synchronisation
    - Mise à jour automatique des compteurs
    - Nettoyage en temps réel
*/

-- Supprimer les anciennes tables si elles existent
DROP TABLE IF EXISTS random_chat_messages CASCADE;
DROP TABLE IF EXISTS random_chat_sessions CASCADE;
DROP TABLE IF EXISTS random_chat_users CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_sessions CASCADE;
DROP TABLE IF EXISTS user_stats CASCADE;

-- Nettoyer la table online_users
DELETE FROM online_users;

-- Table pour les statistiques utilisateur en temps réel
CREATE TABLE user_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  total_online INTEGER DEFAULT 0,
  chat_users INTEGER DEFAULT 0,
  video_users INTEGER DEFAULT 0,
  group_users INTEGER DEFAULT 0,
  random_chat_users INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Insérer une ligne de statistiques initiale
INSERT INTO user_stats (total_online, chat_users, video_users, group_users, random_chat_users)
VALUES (0, 0, 0, 0, 0);

-- Table pour les sessions de chat
CREATE TABLE chat_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user1_id TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('random', 'local', 'group')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'waiting')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW()
);

-- Table pour les messages de chat
CREATE TABLE chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table pour les utilisateurs de chat randomisé
CREATE TABLE random_chat_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  pseudo TEXT NOT NULL,
  genre TEXT NOT NULL CHECK (genre IN ('homme', 'femme', 'autre')),
  status TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'connecte', 'hors_ligne')),
  autoswitch_enabled BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table pour les sessions de chat randomisé
CREATE TABLE random_chat_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user1_id TEXT NOT NULL,
  user1_pseudo TEXT NOT NULL,
  user1_genre TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  user2_pseudo TEXT NOT NULL,
  user2_genre TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'autoswitch_waiting')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  message_count INTEGER DEFAULT 0,
  autoswitch_countdown_start TIMESTAMPTZ,
  autoswitch_user_id TEXT
);

-- Table pour les messages de chat randomisé
CREATE TABLE random_chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES random_chat_sessions(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  sender_pseudo TEXT NOT NULL,
  sender_genre TEXT NOT NULL,
  message_text TEXT NOT NULL,
  message_type TEXT DEFAULT 'user' CHECK (message_type IN ('user', 'system', 'autoswitch_warning')),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  color_code TEXT NOT NULL DEFAULT '#FFFFFF'
);

-- Index pour les performances
CREATE INDEX idx_online_users_status_active ON online_users(status) WHERE last_seen > NOW() - INTERVAL '2 minutes';
CREATE INDEX idx_online_users_last_seen ON online_users(last_seen);
CREATE INDEX idx_chat_sessions_active ON chat_sessions(status) WHERE status = 'active';
CREATE INDEX idx_random_chat_users_status ON random_chat_users(status, last_seen);
CREATE INDEX idx_random_chat_sessions_active ON random_chat_sessions(status) WHERE status = 'active';

-- Fonction pour mettre à jour les statistiques en temps réel
CREATE OR REPLACE FUNCTION update_user_stats()
RETURNS void AS $$
DECLARE
  total_count INTEGER;
  chat_count INTEGER;
  video_count INTEGER;
  group_count INTEGER;
  random_count INTEGER;
BEGIN
  -- Nettoyer d'abord les utilisateurs inactifs (plus de 2 minutes)
  DELETE FROM online_users WHERE last_seen < NOW() - INTERVAL '2 minutes';
  DELETE FROM random_chat_users WHERE last_seen < NOW() - INTERVAL '2 minutes';
  
  -- Compter les utilisateurs actifs
  SELECT COUNT(*) INTO total_count FROM online_users WHERE last_seen > NOW() - INTERVAL '2 minutes';
  SELECT COUNT(*) INTO chat_count FROM online_users WHERE status = 'chat' AND last_seen > NOW() - INTERVAL '2 minutes';
  SELECT COUNT(*) INTO video_count FROM online_users WHERE status = 'video' AND last_seen > NOW() - INTERVAL '2 minutes';
  SELECT COUNT(*) INTO group_count FROM online_users WHERE status = 'group' AND last_seen > NOW() - INTERVAL '2 minutes';
  SELECT COUNT(*) INTO random_count FROM random_chat_users WHERE status = 'en_attente' AND last_seen > NOW() - INTERVAL '2 minutes';
  
  -- Mettre à jour les statistiques
  UPDATE user_stats SET
    total_online = total_count,
    chat_users = chat_count,
    video_users = video_count,
    group_users = group_count,
    random_chat_users = random_count,
    last_updated = NOW();
END;
$$ LANGUAGE plpgsql;

-- Fonction pour obtenir les statistiques
CREATE OR REPLACE FUNCTION get_live_stats()
RETURNS TABLE(
  total_online INTEGER,
  chat_users INTEGER,
  video_users INTEGER,
  group_users INTEGER,
  random_chat_users INTEGER,
  last_updated TIMESTAMPTZ
) AS $$
BEGIN
  -- Mettre à jour les stats avant de les retourner
  PERFORM update_user_stats();
  
  RETURN QUERY
  SELECT 
    us.total_online,
    us.chat_users,
    us.video_users,
    us.group_users,
    us.random_chat_users,
    us.last_updated
  FROM user_stats us
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour chercher un partenaire de chat randomisé
CREATE OR REPLACE FUNCTION find_random_chat_partner(requesting_user_id TEXT)
RETURNS TABLE(
  partner_user_id TEXT,
  partner_pseudo TEXT,
  partner_genre TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rcu.user_id,
    rcu.pseudo,
    rcu.genre
  FROM random_chat_users rcu
  WHERE rcu.user_id != requesting_user_id
    AND rcu.status = 'en_attente'
    AND rcu.last_seen > NOW() - INTERVAL '2 minutes'
  ORDER BY rcu.created_at ASC
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
  
  -- Ajouter un message système de bienvenue
  INSERT INTO random_chat_messages (
    session_id, sender_id, sender_pseudo, sender_genre,
    message_text, message_type, color_code
  ) VALUES (
    session_id, 'system', 'LiberTalk', 'autre',
    'Vous êtes maintenant connectés ! Dites bonjour 👋', 'system', '#00D4FF'
  );
  
  RETURN session_id;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour terminer une session de chat randomisé
CREATE OR REPLACE FUNCTION end_random_chat_session(
  session_id UUID,
  ended_by_user_id TEXT,
  end_reason TEXT
)
RETURNS void AS $$
DECLARE
  session_record RECORD;
  other_user_id TEXT;
  other_user_autoswitch BOOLEAN;
BEGIN
  -- Récupérer les informations de la session
  SELECT * INTO session_record FROM random_chat_sessions WHERE id = session_id;
  
  IF session_record IS NULL THEN
    RETURN;
  END IF;
  
  -- Déterminer l'autre utilisateur
  IF session_record.user1_id = ended_by_user_id THEN
    other_user_id := session_record.user2_id;
  ELSE
    other_user_id := session_record.user1_id;
  END IF;
  
  -- Vérifier si l'autre utilisateur a l'autoswitch activé
  SELECT autoswitch_enabled INTO other_user_autoswitch 
  FROM random_chat_users 
  WHERE user_id = other_user_id;
  
  IF other_user_autoswitch AND end_reason = 'user_next' THEN
    -- Démarrer l'autoswitch pour l'autre utilisateur
    UPDATE random_chat_sessions SET
      status = 'autoswitch_waiting',
      autoswitch_countdown_start = NOW(),
      autoswitch_user_id = other_user_id,
      ended_at = NOW()
    WHERE id = session_id;
    
    -- Message d'avertissement autoswitch
    INSERT INTO random_chat_messages (
      session_id, sender_id, sender_pseudo, sender_genre,
      message_text, message_type, color_code
    ) VALUES (
      session_id, 'system', 'LiberTalk', 'autre',
      'Votre partenaire est parti. Autoswitch dans 30 secondes...', 'autoswitch_warning', '#FFA500'
    );
  ELSE
    -- Terminer la session normalement
    UPDATE random_chat_sessions SET
      status = 'ended',
      ended_at = NOW()
    WHERE id = session_id;
    
    -- Remettre les utilisateurs en attente
    UPDATE random_chat_users 
    SET status = 'en_attente', last_seen = NOW()
    WHERE user_id IN (session_record.user1_id, session_record.user2_id);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour obtenir les statistiques du chat randomisé
CREATE OR REPLACE FUNCTION get_random_chat_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  -- Nettoyer d'abord
  DELETE FROM random_chat_users WHERE last_seen < NOW() - INTERVAL '2 minutes';
  
  SELECT json_build_object(
    'users', json_build_object(
      'total_waiting', (SELECT COUNT(*) FROM random_chat_users WHERE status = 'en_attente'),
      'total_connected', (SELECT COUNT(*) FROM random_chat_users WHERE status = 'connecte'),
      'by_genre', json_build_object(
        'homme', (SELECT COUNT(*) FROM random_chat_users WHERE genre = 'homme' AND status = 'en_attente'),
        'femme', (SELECT COUNT(*) FROM random_chat_users WHERE genre = 'femme' AND status = 'en_attente'),
        'autre', (SELECT COUNT(*) FROM random_chat_users WHERE genre = 'autre' AND status = 'en_attente')
      )
    ),
    'sessions', json_build_object(
      'active', (SELECT COUNT(*) FROM random_chat_sessions WHERE status = 'active'),
      'autoswitch_waiting', (SELECT COUNT(*) FROM random_chat_sessions WHERE status = 'autoswitch_waiting')
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour mettre à jour automatiquement les couleurs des messages
CREATE OR REPLACE FUNCTION set_message_color()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.message_type = 'user' THEN
    CASE NEW.sender_genre
      WHEN 'femme' THEN NEW.color_code := '#FF69B4';
      WHEN 'homme' THEN NEW.color_code := '#1E90FF';
      ELSE NEW.color_code := '#A9A9A9';
    END CASE;
  ELSIF NEW.message_type = 'system' THEN
    NEW.color_code := '#00D4FF';
  ELSE
    NEW.color_code := '#FFA500';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_message_color
  BEFORE INSERT ON random_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION set_message_color();

-- Trigger pour mettre à jour le compteur de messages
CREATE OR REPLACE FUNCTION update_message_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE random_chat_sessions 
  SET 
    message_count = message_count + 1,
    last_activity = NOW()
  WHERE id = NEW.session_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_message_count
  AFTER INSERT ON random_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_message_count();

-- Activer RLS sur toutes les tables
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE random_chat_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE random_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE random_chat_messages ENABLE ROW LEVEL SECURITY;

-- Politiques RLS (accès public pour cette démo)
CREATE POLICY "Allow all operations on user_stats" ON user_stats FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on chat_sessions" ON chat_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on chat_messages" ON chat_messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on random_chat_users" ON random_chat_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on random_chat_sessions" ON random_chat_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on random_chat_messages" ON random_chat_messages FOR ALL USING (true) WITH CHECK (true);

-- Fonction de nettoyage automatique (à exécuter périodiquement)
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS void AS $$
BEGIN
  -- Supprimer les utilisateurs inactifs
  DELETE FROM online_users WHERE last_seen < NOW() - INTERVAL '2 minutes';
  DELETE FROM random_chat_users WHERE last_seen < NOW() - INTERVAL '2 minutes';
  
  -- Supprimer les sessions terminées anciennes
  DELETE FROM chat_sessions WHERE status = 'ended' AND ended_at < NOW() - INTERVAL '1 hour';
  DELETE FROM random_chat_sessions WHERE status = 'ended' AND ended_at < NOW() - INTERVAL '1 hour';
  
  -- Supprimer les groupes inactifs
  UPDATE groups SET is_active = false 
  WHERE last_activity < NOW() - INTERVAL '30 minutes' AND is_active = true;
  
  -- Mettre à jour les statistiques
  PERFORM update_user_stats();
END;
$$ LANGUAGE plpgsql;

-- Initialiser les statistiques
SELECT update_user_stats();