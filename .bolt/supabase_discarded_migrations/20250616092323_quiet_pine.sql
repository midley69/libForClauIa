/*
  # Système de Chat Randomisé - Extension Base de Données

  1. Nouvelles Tables
    - `random_chat_users` - Utilisateurs du chat randomisé avec pseudo et genre
    - `random_chat_sessions` - Sessions de chat randomisé
    - `random_chat_messages` - Messages avec coloration par genre

  2. Fonctionnalités
    - Gestion des pseudos et genres
    - Matching automatique des utilisateurs
    - Autoswitch après déconnexion
    - Coloration des messages par genre
    - Système de "Suivant"

  3. Sécurité
    - RLS activé avec politiques publiques
    - Validation des données
    - Nettoyage automatique
*/

-- =============================================
-- TABLE: random_chat_users
-- Utilisateurs du chat randomisé avec pseudo et genre
-- =============================================

CREATE TABLE IF NOT EXISTS random_chat_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL,
  pseudo TEXT NOT NULL CHECK (length(trim(pseudo)) BETWEEN 3 AND 15),
  genre TEXT NOT NULL CHECK (genre IN ('homme', 'femme', 'autre')),
  
  -- État de l'utilisateur
  status TEXT DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'connecte', 'hors_ligne')),
  
  -- Préférences
  autoswitch_enabled BOOLEAN DEFAULT false,
  location_filter TEXT,
  
  -- Métadonnées
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_seen TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  session_start TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Statistiques
  total_connections INTEGER DEFAULT 0,
  total_messages_sent INTEGER DEFAULT 0,
  total_time_chatting INTEGER DEFAULT 0, -- en secondes
  
  -- Informations techniques
  device_type TEXT DEFAULT 'web',
  user_agent TEXT,
  ip_address INET
);

-- =============================================
-- TABLE: random_chat_sessions
-- Sessions de chat randomisé entre deux utilisateurs
-- =============================================

CREATE TABLE IF NOT EXISTS random_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Participants
  user1_id TEXT NOT NULL,
  user2_id TEXT NOT NULL,
  
  -- Informations des participants (dénormalisées pour performance)
  user1_pseudo TEXT NOT NULL,
  user1_genre TEXT NOT NULL,
  user2_pseudo TEXT NOT NULL,
  user2_genre TEXT NOT NULL,
  
  -- État de la session
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'user1_left', 'user2_left', 'autoswitch_waiting')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  ended_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Autoswitch
  autoswitch_countdown_start TIMESTAMPTZ,
  autoswitch_user_id TEXT, -- Utilisateur qui attend l'autoswitch
  
  -- Statistiques
  message_count INTEGER DEFAULT 0,
  duration_seconds INTEGER DEFAULT 0,
  
  -- Raison de fin
  end_reason TEXT CHECK (end_reason IN ('user_next', 'user_quit', 'autoswitch', 'timeout', 'error')),
  ended_by_user_id TEXT,
  
  -- Contraintes
  CONSTRAINT different_users CHECK (user1_id != user2_id),
  CONSTRAINT valid_autoswitch CHECK (
    (status = 'autoswitch_waiting' AND autoswitch_countdown_start IS NOT NULL AND autoswitch_user_id IS NOT NULL) OR
    (status != 'autoswitch_waiting')
  )
);

-- =============================================
-- TABLE: random_chat_messages
-- Messages du chat randomisé avec coloration par genre
-- =============================================

CREATE TABLE IF NOT EXISTS random_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES random_chat_sessions(id) ON DELETE CASCADE,
  
  -- Expéditeur
  sender_id TEXT NOT NULL,
  sender_pseudo TEXT NOT NULL,
  sender_genre TEXT NOT NULL,
  
  -- Contenu
  message_text TEXT NOT NULL CHECK (length(trim(message_text)) > 0 AND length(trim(message_text)) <= 500),
  message_type TEXT DEFAULT 'user' CHECK (message_type IN ('user', 'system', 'autoswitch_warning')),
  
  -- Métadonnées
  sent_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  is_deleted BOOLEAN DEFAULT false,
  
  -- Couleur basée sur le genre (pour l'affichage)
  color_code TEXT GENERATED ALWAYS AS (
    CASE 
      WHEN sender_genre = 'femme' THEN '#FF69B4'
      WHEN sender_genre = 'homme' THEN '#1E90FF'
      ELSE '#A9A9A9'
    END
  ) STORED
);

-- =============================================
-- INDEX POUR LES PERFORMANCES
-- =============================================

-- Index pour random_chat_users
CREATE INDEX IF NOT EXISTS idx_random_chat_users_user_id ON random_chat_users(user_id);
CREATE INDEX IF NOT EXISTS idx_random_chat_users_status ON random_chat_users(status);
CREATE INDEX IF NOT EXISTS idx_random_chat_users_last_seen ON random_chat_users(last_seen);
CREATE INDEX IF NOT EXISTS idx_random_chat_users_waiting ON random_chat_users(status, last_seen) WHERE status = 'en_attente';

-- Index pour random_chat_sessions
CREATE INDEX IF NOT EXISTS idx_random_chat_sessions_user1 ON random_chat_sessions(user1_id);
CREATE INDEX IF NOT EXISTS idx_random_chat_sessions_user2 ON random_chat_sessions(user2_id);
CREATE INDEX IF NOT EXISTS idx_random_chat_sessions_status ON random_chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_random_chat_sessions_active ON random_chat_sessions(status, last_activity) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_random_chat_sessions_autoswitch ON random_chat_sessions(status, autoswitch_countdown_start) WHERE status = 'autoswitch_waiting';

-- Index pour random_chat_messages
CREATE INDEX IF NOT EXISTS idx_random_chat_messages_session ON random_chat_messages(session_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_random_chat_messages_sender ON random_chat_messages(sender_id);

-- =============================================
-- SÉCURITÉ - ROW LEVEL SECURITY
-- =============================================

-- Activer RLS
ALTER TABLE random_chat_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE random_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE random_chat_messages ENABLE ROW LEVEL SECURITY;

-- Politiques d'accès public
CREATE POLICY "Public access to random_chat_users" ON random_chat_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to random_chat_sessions" ON random_chat_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to random_chat_messages" ON random_chat_messages FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- FONCTIONS UTILITAIRES
-- =============================================

-- Fonction pour trouver un partenaire de chat
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
    rcu.user_id,
    rcu.pseudo,
    rcu.genre
  FROM random_chat_users rcu
  WHERE rcu.user_id != requesting_user_id
    AND rcu.status = 'en_attente'
    AND rcu.last_seen > NOW() - INTERVAL '2 minutes'
    AND (location_filter IS NULL OR rcu.location_filter = location_filter OR rcu.location_filter IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM random_chat_sessions rcs 
      WHERE rcs.status = 'active' 
      AND (rcs.user1_id = rcu.user_id OR rcs.user2_id = rcu.user_id)
    )
  ORDER BY rcu.last_seen DESC, RANDOM()
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour créer une session de chat
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
    user1_id, user2_id,
    user1_pseudo, user1_genre,
    user2_pseudo, user2_genre
  ) VALUES (
    user1_id, user2_id,
    user1_pseudo, user1_genre,
    user2_pseudo, user2_genre
  ) RETURNING id INTO session_id;
  
  -- Mettre à jour le statut des utilisateurs
  UPDATE random_chat_users 
  SET status = 'connecte', last_seen = NOW()
  WHERE user_id IN (user1_id, user2_id);
  
  -- Insérer un message système de bienvenue
  INSERT INTO random_chat_messages (
    session_id, sender_id, sender_pseudo, sender_genre,
    message_text, message_type
  ) VALUES (
    session_id, 'system', 'LiberTalk', 'autre',
    'Vous êtes maintenant connectés ! Dites bonjour 👋', 'system'
  );
  
  RETURN session_id;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour terminer une session
CREATE OR REPLACE FUNCTION end_random_chat_session(
  session_id UUID,
  ended_by_user_id TEXT,
  end_reason TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  session_record RECORD;
  other_user_id TEXT;
  other_user_autoswitch BOOLEAN;
BEGIN
  -- Récupérer les informations de la session
  SELECT * INTO session_record
  FROM random_chat_sessions
  WHERE id = session_id AND status = 'active';
  
  IF NOT FOUND THEN
    RETURN FALSE;
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
  
  -- Calculer la durée
  UPDATE random_chat_sessions
  SET 
    ended_at = NOW(),
    duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER,
    end_reason = end_reason,
    ended_by_user_id = ended_by_user_id
  WHERE id = session_id;
  
  IF other_user_autoswitch AND end_reason IN ('user_next', 'user_quit') THEN
    -- Démarrer l'autoswitch pour l'autre utilisateur
    UPDATE random_chat_sessions
    SET 
      status = 'autoswitch_waiting',
      autoswitch_countdown_start = NOW(),
      autoswitch_user_id = other_user_id
    WHERE id = session_id;
    
    -- Insérer un message d'avertissement autoswitch
    INSERT INTO random_chat_messages (
      session_id, sender_id, sender_pseudo, sender_genre,
      message_text, message_type
    ) VALUES (
      session_id, 'system', 'LiberTalk', 'autre',
      'Votre partenaire est parti. Autoswitch activé : recherche d''un nouveau partenaire dans 30 secondes...', 'autoswitch_warning'
    );
    
  ELSE
    -- Terminer complètement la session
    UPDATE random_chat_sessions
    SET status = 'ended'
    WHERE id = session_id;
    
    -- Remettre les utilisateurs en attente
    UPDATE random_chat_users
    SET status = 'en_attente', last_seen = NOW()
    WHERE user_id IN (session_record.user1_id, session_record.user2_id);
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour gérer l'autoswitch
CREATE OR REPLACE FUNCTION process_autoswitch()
RETURNS INTEGER AS $$
DECLARE
  expired_session RECORD;
  new_partner RECORD;
  processed_count INTEGER := 0;
BEGIN
  -- Traiter les sessions en attente d'autoswitch expirées (30 secondes)
  FOR expired_session IN
    SELECT * FROM random_chat_sessions
    WHERE status = 'autoswitch_waiting'
    AND autoswitch_countdown_start < NOW() - INTERVAL '30 seconds'
  LOOP
    -- Chercher un nouveau partenaire
    SELECT * INTO new_partner
    FROM find_random_chat_partner(expired_session.autoswitch_user_id);
    
    IF FOUND THEN
      -- Créer une nouvelle session avec le nouveau partenaire
      PERFORM create_random_chat_session(
        expired_session.autoswitch_user_id,
        CASE WHEN expired_session.user1_id = expired_session.autoswitch_user_id 
             THEN expired_session.user1_pseudo 
             ELSE expired_session.user2_pseudo END,
        CASE WHEN expired_session.user1_id = expired_session.autoswitch_user_id 
             THEN expired_session.user1_genre 
             ELSE expired_session.user2_genre END,
        new_partner.partner_user_id,
        new_partner.partner_pseudo,
        new_partner.partner_genre
      );
      
      processed_count := processed_count + 1;
    ELSE
      -- Aucun partenaire trouvé, remettre en attente
      UPDATE random_chat_users
      SET status = 'en_attente', last_seen = NOW()
      WHERE user_id = expired_session.autoswitch_user_id;
    END IF;
    
    -- Marquer l'ancienne session comme terminée
    UPDATE random_chat_sessions
    SET status = 'ended', end_reason = 'autoswitch'
    WHERE id = expired_session.id;
  END LOOP;
  
  RETURN processed_count;
END;
$$ LANGUAGE plpgsql;

-- Fonction de nettoyage pour le chat randomisé
CREATE OR REPLACE FUNCTION cleanup_random_chat()
RETURNS TABLE(
  inactive_users_removed INTEGER,
  expired_sessions_ended INTEGER,
  autoswitch_processed INTEGER
) AS $$
DECLARE
  inactive_count INTEGER;
  expired_count INTEGER;
  autoswitch_count INTEGER;
BEGIN
  -- Supprimer les utilisateurs inactifs (plus de 3 minutes)
  DELETE FROM random_chat_users
  WHERE last_seen < NOW() - INTERVAL '3 minutes';
  GET DIAGNOSTICS inactive_count = ROW_COUNT;
  
  -- Terminer les sessions inactives (plus de 5 minutes sans activité)
  UPDATE random_chat_sessions
  SET status = 'ended', end_reason = 'timeout', ended_at = NOW()
  WHERE status = 'active' 
  AND last_activity < NOW() - INTERVAL '5 minutes';
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  
  -- Traiter les autoswitch
  SELECT process_autoswitch() INTO autoswitch_count;
  
  RETURN QUERY SELECT inactive_count, expired_count, autoswitch_count;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour obtenir les statistiques du chat randomisé
CREATE OR REPLACE FUNCTION get_random_chat_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'timestamp', NOW(),
    'users', json_build_object(
      'total_waiting', (SELECT COUNT(*) FROM random_chat_users WHERE status = 'en_attente' AND last_seen > NOW() - INTERVAL '2 minutes'),
      'total_connected', (SELECT COUNT(*) FROM random_chat_users WHERE status = 'connecte' AND last_seen > NOW() - INTERVAL '2 minutes'),
      'by_gender', json_build_object(
        'homme', (SELECT COUNT(*) FROM random_chat_users WHERE genre = 'homme' AND status = 'en_attente' AND last_seen > NOW() - INTERVAL '2 minutes'),
        'femme', (SELECT COUNT(*) FROM random_chat_users WHERE genre = 'femme' AND status = 'en_attente' AND last_seen > NOW() - INTERVAL '2 minutes'),
        'autre', (SELECT COUNT(*) FROM random_chat_users WHERE genre = 'autre' AND status = 'en_attente' AND last_seen > NOW() - INTERVAL '2 minutes')
      )
    ),
    'sessions', json_build_object(
      'active', (SELECT COUNT(*) FROM random_chat_sessions WHERE status = 'active'),
      'autoswitch_waiting', (SELECT COUNT(*) FROM random_chat_sessions WHERE status = 'autoswitch_waiting'),
      'total_today', (SELECT COUNT(*) FROM random_chat_sessions WHERE created_at > CURRENT_DATE)
    ),
    'messages', json_build_object(
      'last_hour', (SELECT COUNT(*) FROM random_chat_messages WHERE sent_at > NOW() - INTERVAL '1 hour'),
      'total_today', (SELECT COUNT(*) FROM random_chat_messages WHERE sent_at > CURRENT_DATE)
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- TRIGGERS
-- =============================================

-- Trigger pour mettre à jour last_activity des sessions
CREATE OR REPLACE FUNCTION update_random_chat_session_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE random_chat_sessions
  SET 
    last_activity = NOW(),
    message_count = message_count + 1
  WHERE id = NEW.session_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_random_chat_activity
  AFTER INSERT ON random_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_random_chat_session_activity();

-- =============================================
-- DONNÉES DE TEST
-- =============================================

-- Insérer des utilisateurs de test pour le chat randomisé
INSERT INTO random_chat_users (user_id, pseudo, genre, status, autoswitch_enabled) VALUES
  ('random_user_1', 'Alice92', 'femme', 'en_attente', false),
  ('random_user_2', 'Bob_Gamer', 'homme', 'en_attente', true),
  ('random_user_3', 'Charlie_X', 'autre', 'en_attente', false),
  ('random_user_4', 'Diana_Art', 'femme', 'en_attente', true),
  ('random_user_5', 'Ethan_Dev', 'homme', 'en_attente', false);

-- Créer une session de test
DO $$
DECLARE
  test_session_id UUID;
BEGIN
  SELECT create_random_chat_session(
    'random_user_1', 'Alice92', 'femme',
    'random_user_2', 'Bob_Gamer', 'homme'
  ) INTO test_session_id;
  
  -- Ajouter quelques messages de test
  INSERT INTO random_chat_messages (session_id, sender_id, sender_pseudo, sender_genre, message_text) VALUES
    (test_session_id, 'random_user_1', 'Alice92', 'femme', 'Salut ! Comment ça va ?'),
    (test_session_id, 'random_user_2', 'Bob_Gamer', 'homme', 'Salut Alice ! Ça va bien et toi ?'),
    (test_session_id, 'random_user_1', 'Alice92', 'femme', 'Super ! Tu fais quoi de beau ?');
END $$;

-- =============================================
-- VUES UTILES
-- =============================================

-- Vue pour les utilisateurs en attente
CREATE OR REPLACE VIEW random_chat_waiting_users AS
SELECT 
  user_id,
  pseudo,
  genre,
  autoswitch_enabled,
  location_filter,
  last_seen,
  EXTRACT(EPOCH FROM (NOW() - last_seen))::INTEGER as seconds_waiting
FROM random_chat_users
WHERE status = 'en_attente' 
  AND last_seen > NOW() - INTERVAL '2 minutes'
ORDER BY last_seen ASC;

-- Vue pour les sessions actives
CREATE OR REPLACE VIEW random_chat_active_sessions AS
SELECT 
  rcs.id,
  rcs.user1_id,
  rcs.user1_pseudo,
  rcs.user1_genre,
  rcs.user2_id,
  rcs.user2_pseudo,
  rcs.user2_genre,
  rcs.status,
  rcs.started_at,
  rcs.last_activity,
  rcs.message_count,
  EXTRACT(EPOCH FROM (NOW() - rcs.started_at))::INTEGER as duration_seconds,
  CASE 
    WHEN rcs.status = 'autoswitch_waiting' THEN 30 - EXTRACT(EPOCH FROM (NOW() - rcs.autoswitch_countdown_start))::INTEGER
    ELSE NULL
  END as autoswitch_countdown_remaining
FROM random_chat_sessions rcs
WHERE rcs.status IN ('active', 'autoswitch_waiting')
ORDER BY rcs.last_activity DESC;

-- Message de confirmation
SELECT 
  '🎉 Système de Chat Randomisé configuré avec succès!' as message,
  NOW() as timestamp,
  'Tables, fonctions et données de test créées pour le chat randomisé avec pseudo et genre.' as details;

-- Afficher les statistiques initiales
SELECT * FROM get_random_chat_stats();