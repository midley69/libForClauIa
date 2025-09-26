// ============================================================================
// SERVICE DE NETTOYAGE ET MAINTENANCE
// Fichier : /var/www/libekoo/backend/services/cleanupService.js
// ============================================================================

const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');
const moderationService = require('./moderationService');

// ============================================================================
// CONSTANTES
// ============================================================================

const CLEANUP_CONFIG = {
  // Intervalles de nettoyage (en minutes)
  INTERVALS: {
    INACTIVE_SESSIONS: 5,     // Nettoyer les sessions inactives toutes les 5 min
    EXPIRED_BANS: 60,         // Vérifier les bans expirés toutes les heures
    OLD_MESSAGES: 1440,       // Nettoyer les anciens messages tous les jours
    OLD_LOGS: 1440,           // Nettoyer les anciens logs tous les jours
    REDIS_CLEANUP: 30         // Nettoyer Redis toutes les 30 min
  },
  
  // Durées de rétention (en jours)
  RETENTION: {
    MESSAGES: 7,              // Garder les messages 7 jours
    ADMIN_LOGS: 30,           // Garder les logs admin 30 jours
    CHAT_SESSIONS: 30,        // Garder les sessions de chat 30 jours
    VIDEO_SESSIONS: 15,       // Garder les sessions vidéo 15 jours
    MODERATION_REPORTS: 90    // Garder les signalements 90 jours
  },
  
  // Seuils d'inactivité (en minutes)
  INACTIVITY_THRESHOLDS: {
    CHAT_SESSION: 30,         // Session de chat inactive après 30 min
    VIDEO_SESSION: 60,        // Session vidéo inactive après 1h
    USER_ONLINE: 15,          // Utilisateur hors ligne après 15 min
    MATCHING_QUEUE: 5         // Retirer de la file après 5 min
  }
};

// ============================================================================
// NETTOYAGE DES SESSIONS
// ============================================================================

/**
 * Nettoyer les sessions de chat inactives
 */
async function cleanupInactiveChatSessions() {
  try {
    const cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - CLEANUP_CONFIG.INACTIVITY_THRESHOLDS.CHAT_SESSION);
    
    const result = await db.query(`
      UPDATE chat_sessions 
      SET status = 'ended', 
          ended_at = NOW(),
          duration_seconds = EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at)))
      WHERE status = 'active' 
      AND last_activity < $1
      RETURNING session_id, user1_id, user2_id
    `, [cutoffTime]);
    
    if (result.rows.length > 0) {
      logger.info(`Nettoyage: ${result.rows.length} sessions de chat inactives fermées`);
      
      // Nettoyer les caches Redis associés
      for (const session of result.rows) {
        await redisClient.deleteCache(`chat_session:${session.session_id}`);
      }
    }
    
    return result.rows.length;
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupInactiveChatSessions' });
    return 0;
  }
}

/**
 * Nettoyer les sessions vidéo inactives
 */
async function cleanupInactiveVideoSessions() {
  try {
    const cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - CLEANUP_CONFIG.INACTIVITY_THRESHOLDS.VIDEO_SESSION);
    
    const result = await db.query(`
      UPDATE video_sessions 
      SET status = 'ended', 
          ended_at = NOW(),
          duration_seconds = EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at)))
      WHERE status IN ('waiting', 'active') 
      AND created_at < $1
      RETURNING room_id
    `, [cutoffTime]);
    
    if (result.rows.length > 0) {
      logger.info(`Nettoyage: ${result.rows.length} sessions vidéo inactives fermées`);
      
      // Nettoyer les états Redis
      for (const session of result.rows) {
        await redisClient.client.del(`video_room:${session.room_id}`);
      }
    }
    
    return result.rows.length;
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupInactiveVideoSessions' });
    return 0;
  }
}

/**
 * Nettoyer toutes les sessions inactives
 */
async function cleanupInactiveSessions() {
  try {
    const [chatCleaned, videoCleaned] = await Promise.all([
      cleanupInactiveChatSessions(),
      cleanupInactiveVideoSessions()
    ]);
    
    const totalCleaned = chatCleaned + videoCleaned;
    
    if (totalCleaned > 0) {
      logger.info(`Nettoyage sessions terminé: ${chatCleaned} chats, ${videoCleaned} vidéos`);
    }
    
    return { chatSessions: chatCleaned, videoSessions: videoCleaned, total: totalCleaned };
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupInactiveSessions' });
    return { chatSessions: 0, videoSessions: 0, total: 0 };
  }
}

/**
 * Nettoyer les sessions d'un utilisateur spécifique
 */
async function cleanupUserSessions(userId) {
  try {
    // Terminer les sessions de chat actives
    const chatResult = await db.query(`
      UPDATE chat_sessions 
      SET status = 'ended', ended_at = NOW()
      WHERE (user1_id = $1 OR user2_id = $1) 
      AND status = 'active'
      RETURNING session_id
    `, [userId]);
    
    // Terminer les sessions vidéo actives
    const videoResult = await db.query(`
      UPDATE video_sessions 
      SET status = 'ended', ended_at = NOW()
      WHERE participants::jsonb @> $1::jsonb
      AND status IN ('waiting', 'active')
      RETURNING room_id
    `, [JSON.stringify([{ userId }])]);
    
    // Nettoyer Redis
    await redisClient.deleteUserSession(userId);
    await redisClient.removeUserPresence(userId);
    await redisClient.deleteCache(`searching:${userId}`);
    
    // Retirer des files d'attente
    await Promise.all([
      redisClient.removeFromMatchingQueue(userId, 'random'),
      redisClient.removeFromMatchingQueue(userId, 'local'),
      redisClient.removeFromMatchingQueue(userId, 'group')
    ]);
    
    logger.info(`Sessions utilisateur ${userId} nettoyées: ${chatResult.rows.length} chats, ${videoResult.rows.length} vidéos`);
    
    return {
      chatSessions: chatResult.rows.length,
      videoSessions: videoResult.rows.length
    };
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupUserSessions', userId });
    return { chatSessions: 0, videoSessions: 0 };
  }
}

// ============================================================================
// NETTOYAGE DES UTILISATEURS
// ============================================================================

/**
 * Mettre à jour le statut des utilisateurs inactifs
 */
async function updateInactiveUserStatus() {
  try {
    const cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - CLEANUP_CONFIG.INACTIVITY_THRESHOLDS.USER_ONLINE);
    
    const result = await db.query(`
      UPDATE users 
      SET status = 'offline'
      WHERE status = 'online' 
      AND last_active < $1
      RETURNING user_id
    `, [cutoffTime]);
    
    // Nettoyer les présences Redis
    for (const user of result.rows) {
      await redisClient.removeUserPresence(user.user_id);
    }
    
    if (result.rows.length > 0) {
      logger.info(`Statut mis à jour: ${result.rows.length} utilisateurs passés hors ligne`);
    }
    
    return result.rows.length;
    
  } catch (error) {
    logger.logError(error, { function: 'updateInactiveUserStatus' });
    return 0;
  }
}

/**
 * Nettoyer les comptes anonymes anciens
 */
async function cleanupOldAnonymousAccounts() {
  try {
    const cutoffTime = new Date();
    cutoffTime.setDate(cutoffTime.getDate() - 1); // Supprimer après 1 jour
    
    const result = await db.query(`
      DELETE FROM users 
      WHERE account_type = 'anonymous' 
      AND last_active < $1
      AND created_at < $1
      RETURNING user_id
    `, [cutoffTime]);
    
    if (result.rows.length > 0) {
      logger.info(`Nettoyage: ${result.rows.length} comptes anonymes anciens supprimés`);
    }
    
    return result.rows.length;
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupOldAnonymousAccounts' });
    return 0;
  }
}

// ============================================================================
// NETTOYAGE DES DONNÉES
// ============================================================================

/**
 * Nettoyer les anciens messages
 */
async function cleanupOldMessages() {
  try {
    const cutoffTime = new Date();
    cutoffTime.setDate(cutoffTime.getDate() - CLEANUP_CONFIG.RETENTION.MESSAGES);
    
    const result = await db.query(`
      DELETE FROM messages 
      WHERE sent_at < $1
      AND is_deleted = false
      RETURNING id
    `, [cutoffTime]);
    
    if (result.rows.length > 0) {
      logger.info(`Nettoyage: ${result.rows.length} anciens messages supprimés`);
    }
    
    return result.rows.length;
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupOldMessages' });
    return 0;
  }
}

/**
 * Nettoyer les anciens logs d'administration
 */
async function cleanupOldAdminLogs() {
  try {
    const cutoffTime = new Date();
    cutoffTime.setDate(cutoffTime.getDate() - CLEANUP_CONFIG.RETENTION.ADMIN_LOGS);
    
    const result = await db.query(`
      DELETE FROM admin_logs 
      WHERE created_at < $1
      AND severity NOT IN ('error', 'critical')
      RETURNING id
    `, [cutoffTime]);
    
    if (result.rows.length > 0) {
      logger.info(`Nettoyage: ${result.rows.length} anciens logs admin supprimés`);
    }
    
    return result.rows.length;
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupOldAdminLogs' });
    return 0;
  }
}

/**
 * Nettoyer les anciennes sessions terminées
 */
async function cleanupOldFinishedSessions() {
  try {
    const chatCutoff = new Date();
    chatCutoff.setDate(chatCutoff.getDate() - CLEANUP_CONFIG.RETENTION.CHAT_SESSIONS);
    
    const videoCutoff = new Date();
    videoCutoff.setDate(videoCutoff.getDate() - CLEANUP_CONFIG.RETENTION.VIDEO_SESSIONS);
    
    const [chatResult, videoResult] = await Promise.all([
      db.query(`
        DELETE FROM chat_sessions 
        WHERE status = 'ended' 
        AND ended_at < $1
        RETURNING session_id
      `, [chatCutoff]),
      
      db.query(`
        DELETE FROM video_sessions 
        WHERE status = 'ended' 
        AND ended_at < $1
        RETURNING room_id
      `, [videoCutoff])
    ]);
    
    const totalCleaned = chatResult.rows.length + videoResult.rows.length;
    
    if (totalCleaned > 0) {
      logger.info(`Nettoyage: ${chatResult.rows.length} sessions chat, ${videoResult.rows.length} sessions vidéo supprimées`);
    }
    
    return { chatSessions: chatResult.rows.length, videoSessions: videoResult.rows.length };
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupOldFinishedSessions' });
    return { chatSessions: 0, videoSessions: 0 };
  }
}

/**
 * Nettoyer les anciens signalements résolus
 */
async function cleanupOldReports() {
  try {
    const cutoffTime = new Date();
    cutoffTime.setDate(cutoffTime.getDate() - CLEANUP_CONFIG.RETENTION.MODERATION_REPORTS);
    
    const result = await db.query(`
      DELETE FROM moderation_reports 
      WHERE status IN ('resolved', 'dismissed') 
      AND resolved_at < $1
      RETURNING id
    `, [cutoffTime]);
    
    if (result.rows.length > 0) {
      logger.info(`Nettoyage: ${result.rows.length} anciens signalements supprimés`);
    }
    
    return result.rows.length;
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupOldReports' });
    return 0;
  }
}

// ============================================================================
// NETTOYAGE REDIS
// ============================================================================

/**
 * Nettoyer les données expirées dans Redis
 */
async function cleanupRedisData() {
  try {
    let totalCleaned = 0;
    
    // Nettoyer les files d'attente de matching
    const matchingService = require('./matchingService');
    totalCleaned += await matchingService.cleanupQueues();
    
    // Nettoyer les caches expirés
    const cacheKeys = await redisClient.client.keys('cache:*');
    for (const key of cacheKeys) {
      const ttl = await redisClient.client.ttl(key);
      if (ttl === -2) { // Clé expirée
        await redisClient.client.del(key);
        totalCleaned++;
      }
    }
    
    // Nettoyer les présences obsolètes
    const presenceKeys = await redisClient.client.keys('user_presence:*');
    const cutoffTime = Date.now() - (15 * 60 * 1000); // 15 minutes
    
    for (const key of presenceKeys) {
      try {
        const presence = await redisClient.client.get(key);
        if (presence) {
          const data = JSON.parse(presence);
          if (data.lastSeen && data.lastSeen < cutoffTime) {
            await redisClient.client.del(key);
            totalCleaned++;
          }
        }
      } catch (error) {
        // Données corrompues, supprimer
        await redisClient.client.del(key);
        totalCleaned++;
      }
    }
    
    // Nettoyer les rate limits expirés
    const rateLimitKeys = await redisClient.client.keys('rate_limit:*');
    for (const key of rateLimitKeys) {
      const ttl = await redisClient.client.ttl(key);
      if (ttl === -2) {
        totalCleaned++;
      }
    }
    
    if (totalCleaned > 0) {
      logger.info(`Nettoyage Redis: ${totalCleaned} clés nettoyées`);
    }
    
    return totalCleaned;
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupRedisData' });
    return 0;
  }
}

// ============================================================================
// NETTOYAGE GÉNÉRAL
// ============================================================================

/**
 * Exécuter un nettoyage complet quotidien
 */
async function performDailyCleanup() {
  try {
    logger.info('Début du nettoyage quotidien...');
    
    const results = await Promise.all([
      cleanupOldMessages(),
      cleanupOldAdminLogs(),
      cleanupOldFinishedSessions(),
      cleanupOldReports(),
      cleanupOldAnonymousAccounts(),
      moderationService.cleanupExpiredBans(),
      cleanupRedisData()
    ]);
    
    const summary = {
      oldMessages: results[0],
      adminLogs: results[1],
      finishedSessions: results[2],
      reports: results[3],
      anonymousAccounts: results[4],
      expiredBans: results[5],
      redisKeys: results[6]
    };
    
    logger.info('Nettoyage quotidien terminé', summary);
    
    return summary;
    
  } catch (error) {
    logger.logError(error, { function: 'performDailyCleanup' });
    return {};
  }
}

/**
 * Exécuter un nettoyage périodique (toutes les 5 minutes)
 */
async function performPeriodicCleanup() {
  try {
    const results = await Promise.all([
      cleanupInactiveSessions(),
      updateInactiveUserStatus(),
      cleanupRedisData()
    ]);
    
    const totalCleaned = results[0].total + results[1] + results[2];
    
    if (totalCleaned > 0) {
      logger.info(`Nettoyage périodique: ${totalCleaned} éléments nettoyés`);
    }
    
    return {
      inactiveSessions: results[0],
      inactiveUsers: results[1],
      redisKeys: results[2]
    };
    
  } catch (error) {
    logger.logError(error, { function: 'performPeriodicCleanup' });
    return {};
  }
}

// ============================================================================
// OPTIMISATION BASE DE DONNÉES
// ============================================================================

/**
 * Optimiser la base de données (vacuum, reindex)
 */
async function optimizeDatabase() {
  try {
    logger.info('Début de l\'optimisation de la base de données...');
    
    // Analyser les statistiques
    await db.query('ANALYZE');
    
    // Vacuum des tables principales
    const tables = [
      'users', 'chat_sessions', 'messages', 'video_sessions',
      'moderation_reports', 'admin_logs', 'banned_ips'
    ];
    
    for (const table of tables) {
      try {
        await db.query(`VACUUM ANALYZE ${table}`);
        logger.info(`Table ${table} optimisée`);
      } catch (error) {
        logger.logError(error, { table, operation: 'vacuum' });
      }
    }
    
    // Réindexer si nécessaire
    const reindexResult = await db.query(`
      SELECT schemaname, tablename, attname, n_distinct, correlation 
      FROM pg_stats 
      WHERE schemaname = 'public' 
      AND n_distinct < 10
    `);
    
    if (reindexResult.rows.length > 0) {
      logger.info('Réindexation recommandée pour certaines colonnes');
    }
    
    logger.info('Optimisation de la base de données terminée');
    
    return true;
    
  } catch (error) {
    logger.logError(error, { function: 'optimizeDatabase' });
    return false;
  }
}

/**
 * Obtenir des statistiques de santé de la base de données
 */
async function getDatabaseHealth() {
  try {
    const queries = await Promise.all([
      // Taille de la base de données
      db.query(`
        SELECT pg_size_pretty(pg_database_size(current_database())) as db_size,
               pg_database_size(current_database()) as db_size_bytes
      `),
      
      // Connexions actives
      db.query(`
        SELECT count(*) as active_connections,
               max(now() - query_start) as longest_query
        FROM pg_stat_activity 
        WHERE state = 'active'
      `),
      
      // Tables les plus volumineuses
      db.query(`
        SELECT tablename,
               pg_size_pretty(pg_total_relation_size(tablename::regclass)) as size,
               pg_total_relation_size(tablename::regclass) as size_bytes
        FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(tablename::regclass) DESC 
        LIMIT 5
      `),
      
      // Index non utilisés
      db.query(`
        SELECT schemaname, tablename, indexname, idx_scan
        FROM pg_stat_user_indexes 
        WHERE idx_scan = 0 
        AND schemaname = 'public'
      `)
    ]);
    
    return {
      databaseSize: queries[0].rows[0],
      connections: queries[1].rows[0],
      largestTables: queries[2].rows,
      unusedIndexes: queries[3].rows,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    logger.logError(error, { function: 'getDatabaseHealth' });
    return {};
  }
}

// ============================================================================
// EXPORT DU MODULE
// ============================================================================

module.exports = {
  // Nettoyage des sessions
  cleanupInactiveSessions,
  cleanupInactiveChatSessions,
  cleanupInactiveVideoSessions,
  cleanupUserSessions,
  
  // Nettoyage des utilisateurs
  updateInactiveUserStatus,
  cleanupOldAnonymousAccounts,
  
  // Nettoyage des données
  cleanupOldMessages,
  cleanupOldAdminLogs,
  cleanupOldFinishedSessions,
  cleanupOldReports,
  
  // Nettoyage Redis
  cleanupRedisData,
  
  // Nettoyages globaux
  performDailyCleanup,
  performPeriodicCleanup,
  
  // Optimisation
  optimizeDatabase,
  getDatabaseHealth,
  
  // Configuration
  CLEANUP_CONFIG
};
