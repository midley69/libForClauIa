/*
  # Amélioration du système de chat randomisé avec autoswitch

  1. Nouvelles fonctionnalités
    - Système d'autoswitch automatique
    - Gestion des déconnexions
    - Logs détaillés pour le débogage
    - Compteurs de reconnexion

  2. Tables mises à jour
    - `random_chat_sessions` : Ajout des champs autoswitch
    - `random_chat_users` : Amélioration du tracking
    - Nouvelle table `chat_logs` pour le débogage

  3. Fonctions améliorées
    - Détection automatique des partenaires inactifs
    - Reconnexion automatique avec autoswitch
    - Nettoyage intelligent des sessions
*/

-- Améliorer la table des sessions avec autoswitch
ALTER TABLE random_chat_sessions 
ADD COLUMN IF NOT EXISTS autoswitch_countdown_remaining INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS autoswitch_user_id TEXT,
ADD COLUMN IF NOT EXISTS partner_last_activity TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS reconnection_count INTEGER DEFAULT 0;

-- Améliorer la table des utilisateurs
ALTER TABLE random_chat_users 
ADD COLUMN IF NOT EXISTS connection_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_session_time INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS preferred_reconnect BOOLEAN DEFAULT true;

-- Créer une table pour les logs de débogage
CREATE TABLE IF NOT EXISTS chat_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  log_type TEXT NOT NULL CHECK (log_type IN ('match_search', 'connection', 'disconnection', 'autoswitch', 'error', 'cleanup')),
  user_id TEXT,
  session_id TEXT,
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les logs
CREATE INDEX IF NOT EXISTS idx_chat_logs_type ON chat_logs(log_type);
CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at ON chat_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_logs_user_id ON chat_logs(user_id);

-- Activer RLS pour les logs
ALTER TABLE chat_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on chat_logs" ON chat_logs
  FOR ALL USING (true) WITH CHECK (true);

-- Fonction pour ajouter des logs
CREATE OR REPLACE FUNCTION add_chat_log(
  p_log_type TEXT,
  p_user_id TEXT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL,
  p_message TEXT DEFAULT '',
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO chat_logs (log_type, user_id, session_id, message, metadata)
  VALUES (p_log_type, p_user_id, p_session_id, p_message, p_metadata)
  RETURNING id INTO log_id;
  
  RETURN log_id;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour détecter les partenaires inactifs et déclencher l'autoswitch
CREATE OR REPLACE FUNCTION check_autoswitch_sessions()
RETURNS TABLE(session_id UUID, inactive_user_id TEXT, active_user_id TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    CASE 
      WHEN u1.last_seen < NOW() - INTERVAL '30 seconds' THEN s.user1_id
      WHEN u2.last_seen < NOW() - INTERVAL '30 seconds' THEN s.user2_id
      ELSE NULL
    END as inactive_user,
    CASE 
      WHEN u1.last_seen < NOW() - INTERVAL '30 seconds' THEN s.user2_id
      WHEN u2.last_seen < NOW() - INTERVAL '30 seconds' THEN s.user1_id
      ELSE NULL
    END as active_user
  FROM random_chat_sessions s
  JOIN random_chat_users u1 ON s.user1_id = u1.user_id
  JOIN random_chat_users u2 ON s.user2_id = u2.user_id
  WHERE s.status = 'active'
    AND (
      (u1.last_seen < NOW() - INTERVAL '30 seconds' AND u2.autoswitch_enabled = true) OR
      (u2.last_seen < NOW() - INTERVAL '30 seconds' AND u1.autoswitch_enabled = true)
    );
END;
$$ LANGUAGE plpgsql;

-- Fonction pour déclencher l'autoswitch
CREATE OR REPLACE FUNCTION trigger_autoswitch(
  p_session_id UUID,
  p_active_user_id TEXT,
  p_inactive_user_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  countdown_seconds INTEGER := 30;
BEGIN
  -- Log de l'autoswitch
  PERFORM add_chat_log(
    'autoswitch',
    p_active_user_id,
    p_session_id::TEXT,
    'Autoswitch déclenché - partenaire inactif',
    jsonb_build_object(
      'inactive_user_id', p_inactive_user_id,
      'countdown_seconds', countdown_seconds
    )
  );

  -- Mettre à jour la session pour l'autoswitch
  UPDATE random_chat_sessions 
  SET 
    status = 'autoswitch_waiting',
    autoswitch_user_id = p_active_user_id,
    autoswitch_countdown_remaining = countdown_seconds,
    partner_last_activity = NOW()
  WHERE id = p_session_id;

  -- Ajouter un message système
  INSERT INTO random_chat_messages (
    session_id, sender_id, sender_pseudo, sender_genre, 
    message_text, message_type, color_code
  ) VALUES (
    p_session_id::TEXT, 'system', 'LiberTalk', 'autre',
    'Votre partenaire semble inactif. Reconnexion automatique dans 30 secondes...',
    'autoswitch_warning', '#FFA500'
  );

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour reconnecter automatiquement
CREATE OR REPLACE FUNCTION execute_autoswitch(p_session_id UUID)
RETURNS UUID AS $$
DECLARE
  active_user_record RECORD;
  new_partner_record RECORD;
  new_session_id UUID;
BEGIN
  -- Récupérer l'utilisateur actif
  SELECT u.* INTO active_user_record
  FROM random_chat_sessions s
  JOIN random_chat_users u ON u.user_id = s.autoswitch_user_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Chercher un nouveau partenaire
  SELECT * INTO new_partner_record
  FROM random_chat_users
  WHERE user_id != active_user_record.user_id
    AND status = 'en_attente'
    AND last_seen > NOW() - INTERVAL '1 minute'
  ORDER BY last_seen DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Aucun partenaire disponible, remettre en attente
    UPDATE random_chat_users 
    SET status = 'en_attente' 
    WHERE user_id = active_user_record.user_id;
    
    PERFORM add_chat_log(
      'autoswitch',
      active_user_record.user_id,
      p_session_id::TEXT,
      'Autoswitch échoué - aucun partenaire disponible'
    );
    
    RETURN NULL;
  END IF;

  -- Terminer l'ancienne session
  UPDATE random_chat_sessions 
  SET status = 'ended', ended_at = NOW()
  WHERE id = p_session_id;

  -- Créer une nouvelle session
  INSERT INTO random_chat_sessions (
    user1_id, user1_pseudo, user1_genre,
    user2_id, user2_pseudo, user2_genre,
    status, reconnection_count
  ) VALUES (
    active_user_record.user_id, active_user_record.pseudo, active_user_record.genre,
    new_partner_record.user_id, new_partner_record.pseudo, new_partner_record.genre,
    'active', 1
  ) RETURNING id INTO new_session_id;

  -- Mettre à jour les statuts des utilisateurs
  UPDATE random_chat_users 
  SET status = 'connecte', connection_count = connection_count + 1
  WHERE user_id IN (active_user_record.user_id, new_partner_record.user_id);

  -- Log de succès
  PERFORM add_chat_log(
    'autoswitch',
    active_user_record.user_id,
    new_session_id::TEXT,
    'Autoswitch réussi - nouveau partenaire trouvé',
    jsonb_build_object(
      'new_partner_id', new_partner_record.user_id,
      'old_session_id', p_session_id
    )
  );

  -- Message de bienvenue
  INSERT INTO random_chat_messages (
    session_id, sender_id, sender_pseudo, sender_genre,
    message_text, message_type, color_code
  ) VALUES (
    new_session_id::TEXT, 'system', 'LiberTalk', 'autre',
    '✨ Nouveau partenaire connecté via autoswitch !',
    'system', '#00FF00'
  );

  RETURN new_session_id;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour gérer les déconnexions propres
CREATE OR REPLACE FUNCTION handle_user_disconnect(p_user_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  active_session_record RECORD;
  partner_user_id TEXT;
BEGIN
  -- Trouver la session active de l'utilisateur
  SELECT * INTO active_session_record
  FROM random_chat_sessions
  WHERE (user1_id = p_user_id OR user2_id = p_user_id)
    AND status IN ('active', 'autoswitch_waiting');

  IF FOUND THEN
    -- Identifier le partenaire
    partner_user_id := CASE 
      WHEN active_session_record.user1_id = p_user_id 
      THEN active_session_record.user2_id 
      ELSE active_session_record.user1_id 
    END;

    -- Log de déconnexion
    PERFORM add_chat_log(
      'disconnection',
      p_user_id,
      active_session_record.id::TEXT,
      'Utilisateur déconnecté',
      jsonb_build_object('partner_id', partner_user_id)
    );

    -- Vérifier si le partenaire a l'autoswitch activé
    IF EXISTS (
      SELECT 1 FROM random_chat_users 
      WHERE user_id = partner_user_id AND autoswitch_enabled = true
    ) THEN
      -- Déclencher l'autoswitch pour le partenaire
      PERFORM trigger_autoswitch(
        active_session_record.id,
        partner_user_id,
        p_user_id
      );
    ELSE
      -- Terminer la session
      UPDATE random_chat_sessions 
      SET status = 'ended', ended_at = NOW()
      WHERE id = active_session_record.id;

      -- Remettre le partenaire en attente
      UPDATE random_chat_users 
      SET status = 'en_attente' 
      WHERE user_id = partner_user_id;
    END IF;
  END IF;

  -- Supprimer l'utilisateur déconnecté
  DELETE FROM random_chat_users WHERE user_id = p_user_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Fonction de nettoyage améliorée avec logs
CREATE OR REPLACE FUNCTION cleanup_random_chat_system()
RETURNS TABLE(cleaned_users INTEGER, cleaned_sessions INTEGER, triggered_autoswitches INTEGER) AS $$
DECLARE
  users_cleaned INTEGER := 0;
  sessions_cleaned INTEGER := 0;
  autoswitches_triggered INTEGER := 0;
  autoswitch_session RECORD;
BEGIN
  -- Log de début de nettoyage
  PERFORM add_chat_log(
    'cleanup',
    NULL,
    NULL,
    'Début du nettoyage automatique du système'
  );

  -- Vérifier les sessions pour autoswitch
  FOR autoswitch_session IN 
    SELECT * FROM check_autoswitch_sessions()
    WHERE inactive_user_id IS NOT NULL
  LOOP
    PERFORM trigger_autoswitch(
      autoswitch_session.session_id::UUID,
      autoswitch_session.active_user_id,
      autoswitch_session.inactive_user_id
    );
    autoswitches_triggered := autoswitches_triggered + 1;
  END LOOP;

  -- Nettoyer les utilisateurs inactifs (plus de 2 minutes)
  DELETE FROM random_chat_users 
  WHERE last_seen < NOW() - INTERVAL '2 minutes';
  GET DIAGNOSTICS users_cleaned = ROW_COUNT;

  -- Nettoyer les sessions abandonnées (plus de 5 minutes)
  UPDATE random_chat_sessions 
  SET status = 'ended', ended_at = NOW()
  WHERE status IN ('active', 'autoswitch_waiting')
    AND started_at < NOW() - INTERVAL '5 minutes';
  GET DIAGNOSTICS sessions_cleaned = ROW_COUNT;

  -- Nettoyer les anciens logs (plus de 24 heures)
  DELETE FROM chat_logs 
  WHERE created_at < NOW() - INTERVAL '24 hours';

  -- Log de fin de nettoyage
  PERFORM add_chat_log(
    'cleanup',
    NULL,
    NULL,
    'Nettoyage terminé',
    jsonb_build_object(
      'users_cleaned', users_cleaned,
      'sessions_cleaned', sessions_cleaned,
      'autoswitches_triggered', autoswitches_triggered
    )
  );

  RETURN QUERY SELECT users_cleaned, sessions_cleaned, autoswitches_triggered;
END;
$$ LANGUAGE plpgsql;

-- Fonction pour obtenir les statistiques détaillées avec logs
CREATE OR REPLACE FUNCTION get_random_chat_stats_detailed()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'users', jsonb_build_object(
      'total_waiting', (SELECT COUNT(*) FROM random_chat_users WHERE status = 'en_attente'),
      'total_chatting', (SELECT COUNT(*) FROM random_chat_users WHERE status = 'connecte'),
      'autoswitch_enabled', (SELECT COUNT(*) FROM random_chat_users WHERE autoswitch_enabled = true),
      'by_genre', jsonb_build_object(
        'homme', (SELECT COUNT(*) FROM random_chat_users WHERE genre = 'homme'),
        'femme', (SELECT COUNT(*) FROM random_chat_users WHERE genre = 'femme'),
        'autre', (SELECT COUNT(*) FROM random_chat_users WHERE genre = 'autre')
      )
    ),
    'sessions', jsonb_build_object(
      'active', (SELECT COUNT(*) FROM random_chat_sessions WHERE status = 'active'),
      'autoswitch_waiting', (SELECT COUNT(*) FROM random_chat_sessions WHERE status = 'autoswitch_waiting'),
      'total_today', (SELECT COUNT(*) FROM random_chat_sessions WHERE started_at > CURRENT_DATE)
    ),
    'messages', jsonb_build_object(
      'total_today', (SELECT COUNT(*) FROM random_chat_messages WHERE sent_at > CURRENT_DATE),
      'last_hour', (SELECT COUNT(*) FROM random_chat_messages WHERE sent_at > NOW() - INTERVAL '1 hour')
    ),
    'logs', jsonb_build_object(
      'recent_errors', (SELECT COUNT(*) FROM chat_logs WHERE log_type = 'error' AND created_at > NOW() - INTERVAL '1 hour'),
      'recent_connections', (SELECT COUNT(*) FROM chat_logs WHERE log_type = 'connection' AND created_at > NOW() - INTERVAL '1 hour'),
      'recent_autoswitches', (SELECT COUNT(*) FROM chat_logs WHERE log_type = 'autoswitch' AND created_at > NOW() - INTERVAL '1 hour')
    ),
    'last_updated', NOW()
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql;