-- ============================================================================
-- LIBEKOO - SCHÉMA BASE DE DONNÉES POSTGRESQL COMPLET
-- Migration de Supabase vers PostgreSQL auto-hébergé
-- Fichier : /var/www/libekoo/database/schema.sql
-- ============================================================================

-- Extensions nécessaires
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ============================================================================
-- 1. TABLE UTILISATEURS (Anonymes et Inscrits)
-- ============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT UNIQUE NOT NULL, -- ID session pour anonymes, email pour inscrits
    username TEXT,
    email TEXT UNIQUE,
    password_hash TEXT, -- NULL pour anonymes
    
    -- Profil utilisateur
    gender TEXT DEFAULT 'non-specifie' CHECK (gender IN ('homme', 'femme', 'non-binaire', 'non-specifie')),
    age_range TEXT CHECK (age_range IN ('13-17', '18-24', '25-34', '35-44', '45+')),
    bio TEXT,
    
    -- Localisation (anonyme via IP)
    country TEXT,
    city TEXT,
    ip_hash TEXT, -- Hash de l'IP pour bannissement
    
    -- Statut et préférences
    account_type TEXT DEFAULT 'anonymous' CHECK (account_type IN ('anonymous', 'registered', 'premium')),
    status TEXT DEFAULT 'offline' CHECK (status IN ('offline', 'online', 'busy', 'away')),
    preferences JSONB DEFAULT '{}',
    
    -- Statistiques utilisateur
    stats JSONB DEFAULT '{
        "total_chats": 0,
        "total_video_calls": 0,
        "total_messages": 0,
        "total_friends": 0,
        "total_time_minutes": 0,
        "reports_received": 0,
        "reports_sent": 0
    }',
    
    -- Gamification
    points INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    badges JSONB DEFAULT '[]',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_active TIMESTAMPTZ DEFAULT NOW(),
    
    -- Modération
    is_banned BOOLEAN DEFAULT FALSE,
    ban_reason TEXT,
    ban_expires_at TIMESTAMPTZ
);

-- ============================================================================
-- 2. TABLE SESSIONS DE CHAT
-- ============================================================================
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id TEXT UNIQUE NOT NULL,
    
    -- Participants
    user1_id TEXT NOT NULL,
    user1_username TEXT,
    user2_id TEXT NOT NULL,
    user2_username TEXT,
    
    -- Configuration session
    session_type TEXT DEFAULT 'random' CHECK (session_type IN ('random', 'local', 'group', 'private')),
    status TEXT DEFAULT 'active' CHECK (status IN ('waiting', 'active', 'ended', 'abandoned')),
    
    -- Géolocalisation (pour matching local)
    user1_country TEXT,
    user1_city TEXT,
    user2_country TEXT,
    user2_city TEXT,
    geographic_distance_km INTEGER,
    
    -- Statistiques session
    message_count INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    last_activity TIMESTAMPTZ DEFAULT NOW(),
    
    -- Évaluations (1-5)
    user1_rating INTEGER CHECK (user1_rating BETWEEN 1 AND 5),
    user2_rating INTEGER CHECK (user2_rating BETWEEN 1 AND 5),
    
    -- Modération
    is_flagged BOOLEAN DEFAULT FALSE,
    flag_reason TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ
);

-- ============================================================================
-- 3. TABLE MESSAGES (Stockage Temporaire pour Modération)
-- ============================================================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id TEXT UNIQUE NOT NULL,
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    
    -- Expéditeur
    sender_id TEXT NOT NULL,
    sender_username TEXT,
    sender_ip_hash TEXT,
    
    -- Contenu du message
    content TEXT NOT NULL,
    message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'emoji', 'image', 'file', 'system')),
    
    -- Métadonnées
    metadata JSONB DEFAULT '{}',
    language_detected TEXT,
    
    -- Timestamps
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Modération automatique
    toxicity_score FLOAT DEFAULT 0.0, -- 0.0 = sain, 1.0 = toxique
    contains_personal_info BOOLEAN DEFAULT FALSE,
    auto_flagged BOOLEAN DEFAULT FALSE,
    auto_flag_reasons JSONB DEFAULT '[]',
    
    -- Modération manuelle
    is_reported BOOLEAN DEFAULT FALSE,
    report_count INTEGER DEFAULT 0,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_by TEXT,
    deleted_at TIMESTAMPTZ,
    
    -- Index pour recherche rapide
    search_vector tsvector
);

-- ============================================================================
-- 4. TABLE SESSIONS VIDÉO
-- ============================================================================
CREATE TABLE video_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id TEXT UNIQUE NOT NULL,
    room_id TEXT UNIQUE NOT NULL,
    
    -- Participants (JSON pour support multi-utilisateurs)
    participants JSONB NOT NULL DEFAULT '[]',
    max_participants INTEGER DEFAULT 4,
    current_participants INTEGER DEFAULT 0,
    
    -- Configuration technique
    webrtc_config JSONB DEFAULT '{}',
    ice_servers JSONB DEFAULT '[{"urls": ["stun:stun.l.google.com:19302"]}]',
    
    -- État de la session
    status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'ended', 'failed')),
    
    -- Statistiques qualité
    quality_metrics JSONB DEFAULT '{
        "average_latency_ms": 0,
        "packet_loss_percent": 0,
        "connection_quality": "unknown",
        "bandwidth_usage_mbps": 0
    }',
    
    -- Contrôles média
    audio_enabled BOOLEAN DEFAULT TRUE,
    video_enabled BOOLEAN DEFAULT TRUE,
    screen_sharing_active BOOLEAN DEFAULT FALSE,
    recording_enabled BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER DEFAULT 0,
    
    -- Évaluations
    average_rating FLOAT,
    total_ratings INTEGER DEFAULT 0,
    
    -- Modération
    is_flagged BOOLEAN DEFAULT FALSE,
    auto_moderation_score FLOAT DEFAULT 0.0
);

-- ============================================================================
-- 5. TABLE ADMINISTRATION & LOGS
-- ============================================================================
CREATE TABLE admin_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL, -- 'user', 'session', 'message', 'ip'
    target_id TEXT NOT NULL,
    
    -- Détails de l'action
    action_details JSONB DEFAULT '{}',
    reason TEXT,
    severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    
    -- IP et metadata
    admin_ip TEXT,
    user_agent TEXT,
    
    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 6. TABLE SIGNALEMENTS
-- ============================================================================
CREATE TABLE moderation_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Signalement
    reporter_id TEXT NOT NULL,
    reported_user_id TEXT,
    target_type TEXT NOT NULL CHECK (target_type IN ('user', 'message', 'session')),
    target_id TEXT NOT NULL,
    
    -- Détails du signalement
    report_type TEXT NOT NULL CHECK (report_type IN ('spam', 'harassment', 'inappropriate_content', 'fake_profile', 'underage', 'other')),
    description TEXT,
    evidence JSONB DEFAULT '{}', -- Screenshots, logs, etc.
    
    -- Statut du traitement
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'investigating', 'resolved', 'dismissed')),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    
    -- Traitement
    assigned_to TEXT,
    admin_notes TEXT,
    action_taken TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- ============================================================================
-- 7. TABLE IP BANNIES
-- ============================================================================
CREATE TABLE banned_ips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip_hash TEXT UNIQUE NOT NULL,
    
    -- Détails du bannissement
    ban_type TEXT DEFAULT 'temporary' CHECK (ban_type IN ('temporary', 'permanent')),
    reason TEXT NOT NULL,
    banned_by TEXT NOT NULL,
    
    -- Durée du bannissement
    expires_at TIMESTAMPTZ,
    
    -- Métadonnées
    country TEXT,
    city TEXT,
    ban_count INTEGER DEFAULT 1, -- Nombre de bans pour cette IP
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 8. TABLE LOCALISATION UTILISATEURS (Anonyme)
-- ============================================================================
CREATE TABLE user_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    
    -- Géolocalisation (via service GeoIP)
    country TEXT NOT NULL,
    country_code TEXT NOT NULL,
    region TEXT,
    city TEXT NOT NULL,
    latitude FLOAT,
    longitude FLOAT,
    timezone TEXT,
    
    -- Métadonnées
    isp TEXT,
    connection_type TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 9. TABLE ANALYTICS & STATISTIQUES
-- ============================================================================
CREATE TABLE analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Période de mesure
    period_type TEXT NOT NULL CHECK (period_type IN ('hourly', 'daily', 'weekly', 'monthly')),
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    
    -- Métriques utilisateurs
    total_users INTEGER DEFAULT 0,
    active_users INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    anonymous_users INTEGER DEFAULT 0,
    registered_users INTEGER DEFAULT 0,
    
    -- Métriques engagement
    total_sessions INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    total_video_calls INTEGER DEFAULT 0,
    average_session_duration_minutes FLOAT DEFAULT 0,
    
    -- Métriques géographiques
    top_countries JSONB DEFAULT '{}',
    geographic_distribution JSONB DEFAULT '{}',
    
    -- Métriques modération
    total_reports INTEGER DEFAULT 0,
    total_bans INTEGER DEFAULT 0,
    toxicity_incidents INTEGER DEFAULT 0,
    
    -- Métriques techniques
    average_response_time_ms FLOAT DEFAULT 0,
    error_rate FLOAT DEFAULT 0,
    uptime_percentage FLOAT DEFAULT 100,
    
    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 10. TABLE PRÉPARATION MONÉTISATION
-- ============================================================================
CREATE TABLE revenue_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Type de revenu
    revenue_type TEXT NOT NULL CHECK (revenue_type IN ('ads', 'premium_subscription', 'virtual_gifts', 'api_access')),
    
    -- Montant et devise
    amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    currency TEXT DEFAULT 'EUR',
    
    -- Source
    source_user_id TEXT,
    source_session_id TEXT,
    source_details JSONB DEFAULT '{}',
    
    -- Statut
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'refunded')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- ============================================================================
-- INDEX POUR PERFORMANCE
-- ============================================================================

-- Users
CREATE INDEX idx_users_user_id ON users(user_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_location ON users(country, city);
CREATE INDEX idx_users_ip_hash ON users(ip_hash);
CREATE INDEX idx_users_last_active ON users(last_active);

-- Chat Sessions
CREATE INDEX idx_chat_sessions_user1 ON chat_sessions(user1_id);
CREATE INDEX idx_chat_sessions_user2 ON chat_sessions(user2_id);
CREATE INDEX idx_chat_sessions_status ON chat_sessions(status);
CREATE INDEX idx_chat_sessions_type ON chat_sessions(session_type);
CREATE INDEX idx_chat_sessions_location ON chat_sessions(user1_country, user1_city);
CREATE INDEX idx_chat_sessions_created_at ON chat_sessions(created_at);

-- Messages
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_sent_at ON messages(sent_at);
CREATE INDEX idx_messages_toxicity ON messages(toxicity_score);
CREATE INDEX idx_messages_auto_flagged ON messages(auto_flagged);
CREATE INDEX idx_messages_search ON messages USING GIN(search_vector);
CREATE INDEX idx_messages_content ON messages USING GIN(content gin_trgm_ops);

-- Video Sessions
CREATE INDEX idx_video_sessions_room_id ON video_sessions(room_id);
CREATE INDEX idx_video_sessions_status ON video_sessions(status);
CREATE INDEX idx_video_sessions_created_at ON video_sessions(created_at);

-- Admin Logs
CREATE INDEX idx_admin_logs_admin_id ON admin_logs(admin_id);
CREATE INDEX idx_admin_logs_target ON admin_logs(target_type, target_id);
CREATE INDEX idx_admin_logs_created_at ON admin_logs(created_at);
CREATE INDEX idx_admin_logs_severity ON admin_logs(severity);

-- Moderation Reports
CREATE INDEX idx_reports_reporter_id ON moderation_reports(reporter_id);
CREATE INDEX idx_reports_target ON moderation_reports(target_type, target_id);
CREATE INDEX idx_reports_status ON moderation_reports(status);
CREATE INDEX idx_reports_priority ON moderation_reports(priority);

-- Banned IPs
CREATE INDEX idx_banned_ips_hash ON banned_ips(ip_hash);
CREATE INDEX idx_banned_ips_expires ON banned_ips(expires_at);

-- User Locations
CREATE INDEX idx_user_locations_user_id ON user_locations(user_id);
CREATE INDEX idx_user_locations_location ON user_locations(country, city);
CREATE INDEX idx_user_locations_coords ON user_locations(latitude, longitude);

-- Analytics
CREATE INDEX idx_analytics_period ON analytics(period_type, period_start);

-- ============================================================================
-- TRIGGERS POUR MISE À JOUR AUTOMATIQUE
-- ============================================================================

-- Fonction de mise à jour timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Application des triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_chat_sessions_updated_at BEFORE UPDATE ON chat_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_reports_updated_at BEFORE UPDATE ON moderation_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_banned_ips_updated_at BEFORE UPDATE ON banned_ips FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_locations_updated_at BEFORE UPDATE ON user_locations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger pour mise à jour search_vector dans messages
CREATE OR REPLACE FUNCTION update_message_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('french', COALESCE(NEW.content, ''));
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_messages_search_vector BEFORE INSERT OR UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION update_message_search_vector();

-- ============================================================================
-- DONNÉES DE TEST INITIALES
-- ============================================================================

-- Utilisateur admin par défaut
INSERT INTO users (user_id, username, email, password_hash, account_type, status, country, city) 
VALUES (
    'admin_libekoo_2024',
    'Administrateur',
    'admin@libekoo.me',
    '$2b$10$rQZ4QoZ4QoZ4QoZ4QoZ4Qo', -- À remplacer par un vrai hash
    'registered',
    'online',
    'France',
    'Paris'
);

-- Quelques utilisateurs de test
INSERT INTO users (user_id, username, gender, account_type, status, country, city, stats) VALUES
('demo_alice', 'Alice_Paris', 'femme', 'anonymous', 'online', 'France', 'Paris', '{"total_chats": 5, "total_messages": 50}'),
('demo_bob', 'Bob_Lyon', 'homme', 'anonymous', 'online', 'France', 'Lyon', '{"total_chats": 3, "total_messages": 30}'),
('demo_charlie', 'Charlie_Marseille', 'non-binaire', 'registered', 'online', 'France', 'Marseille', '{"total_chats": 8, "total_messages": 80}');

COMMIT;
