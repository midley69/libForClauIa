// ============================================================================
// SERVICE D'ANALYTICS ET STATISTIQUES
// Fichier : /var/www/libekoo/backend/services/analyticsService.js
// ============================================================================

const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');

// ============================================================================
// CONSTANTES
// ============================================================================

const ANALYTICS_CONFIG = {
  // Intervals de génération des stats
  GENERATION_INTERVALS: {
    HOURLY: 'hourly',
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly'
  },
  
  // Rétention des données
  DATA_RETENTION_DAYS: {
    HOURLY: 7,    // Garder les stats horaires 7 jours
    DAILY: 90,    // Garder les stats quotidiennes 90 jours
    WEEKLY: 365,  // Garder les stats hebdomadaires 1 an
    MONTHLY: 1095 // Garder les stats mensuelles 3 ans
  },
  
  // Métriques suivies
  METRICS: {
    USERS: ['total_users', 'active_users', 'new_users', 'anonymous_users', 'registered_users'],
    ENGAGEMENT: ['total_sessions', 'total_messages', 'total_video_calls', 'average_session_duration'],
    GEOGRAPHIC: ['top_countries', 'geographic_distribution'],
    MODERATION: ['total_reports', 'total_bans', 'toxicity_incidents'],
    TECHNICAL: ['average_response_time', 'error_rate', 'uptime_percentage']
  }
};

// ============================================================================
// FONCTIONS UTILITAIRES
// ============================================================================

/**
 * Obtenir les bornes temporelles pour une période
 */
function getPeriodBounds(periodType, referenceDate = new Date()) {
  const date = new Date(referenceDate);
  let periodStart, periodEnd;
  
  switch (periodType) {
    case 'hourly':
      periodStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours());
      periodEnd = new Date(periodStart.getTime() + 60 * 60 * 1000);
      break;
      
    case 'daily':
      periodStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
      break;
      
    case 'weekly':
      const dayOfWeek = date.getDay();
      periodStart = new Date(date.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
      
    case 'monthly':
      periodStart = new Date(date.getFullYear(), date.getMonth(), 1);
      periodEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      break;
      
    default:
      throw new Error(`Type de période invalide: ${periodType}`);
  }
  
  return { periodStart, periodEnd };
}

/**
 * Formatter les métriques pour réponse API
 */
function formatMetrics(rawMetrics) {
  return {
    users: {
      total: rawMetrics.total_users || 0,
      active: rawMetrics.active_users || 0,
      new: rawMetrics.new_users || 0,
      anonymous: rawMetrics.anonymous_users || 0,
      registered: rawMetrics.registered_users || 0,
      onlineNow: rawMetrics.online_now || 0
    },
    engagement: {
      sessions: rawMetrics.total_sessions || 0,
      messages: rawMetrics.total_messages || 0,
      videoCalls: rawMetrics.total_video_calls || 0,
      averageSessionDuration: rawMetrics.average_session_duration_minutes || 0
    },
    geographic: {
      topCountries: rawMetrics.top_countries || {},
      distribution: rawMetrics.geographic_distribution || {}
    },
    moderation: {
      reports: rawMetrics.total_reports || 0,
      bans: rawMetrics.total_bans || 0,
      toxicityIncidents: rawMetrics.toxicity_incidents || 0
    },
    technical: {
      responseTime: rawMetrics.average_response_time_ms || 0,
      errorRate: rawMetrics.error_rate || 0,
      uptime: rawMetrics.uptime_percentage || 100
    }
  };
}

// ============================================================================
// COLLECTE DE DONNÉES
// ============================================================================

/**
 * Collecter les métriques utilisateurs
 */
async function collectUserMetrics(periodStart, periodEnd) {
  try {
    const queries = await Promise.all([
      // Utilisateurs totaux
      db.query('SELECT COUNT(*) as count FROM users'),
      
      // Utilisateurs actifs dans la période
      db.query(`
        SELECT COUNT(DISTINCT user_id) as count 
        FROM users 
        WHERE last_active >= $1 AND last_active < $2
      `, [periodStart, periodEnd]),
      
      // Nouveaux utilisateurs dans la période
      db.query(`
        SELECT COUNT(*) as count 
        FROM users 
        WHERE created_at >= $1 AND created_at < $2
      `, [periodStart, periodEnd]),
      
      // Répartition par type de compte
      db.query(`
        SELECT account_type, COUNT(*) as count 
        FROM users 
        WHERE last_active >= $1 AND last_active < $2
        GROUP BY account_type
      `, [periodStart, periodEnd]),
      
      // Utilisateurs en ligne maintenant
      db.query("SELECT COUNT(*) as count FROM users WHERE status = 'online'")
    ]);
    
    const accountTypes = {};
    queries[3].rows.forEach(row => {
      accountTypes[row.account_type] = parseInt(row.count);
    });
    
    return {
      total_users: parseInt(queries[0].rows[0].count),
      active_users: parseInt(queries[1].rows[0].count),
      new_users: parseInt(queries[2].rows[0].count),
      anonymous_users: accountTypes.anonymous || 0,
      registered_users: accountTypes.registered || 0,
      online_now: parseInt(queries[4].rows[0].count)
    };
    
  } catch (error) {
    logger.logError(error, { function: 'collectUserMetrics' });
    return {};
  }
}

/**
 * Collecter les métriques d'engagement
 */
async function collectEngagementMetrics(periodStart, periodEnd) {
  try {
    const queries = await Promise.all([
      // Sessions de chat dans la période
      db.query(`
        SELECT COUNT(*) as count,
               AVG(duration_seconds/60.0) as avg_duration
        FROM chat_sessions 
        WHERE created_at >= $1 AND created_at < $2
      `, [periodStart, periodEnd]),
      
      // Messages dans la période
      db.query(`
        SELECT COUNT(*) as count 
        FROM messages 
        WHERE sent_at >= $1 AND sent_at < $2
      `, [periodStart, periodEnd]),
      
      // Appels vidéo dans la période
      db.query(`
        SELECT COUNT(*) as count 
        FROM video_sessions 
        WHERE created_at >= $1 AND created_at < $2
      `, [periodStart, periodEnd])
    ]);
    
    return {
      total_sessions: parseInt(queries[0].rows[0].count),
      average_session_duration_minutes: parseFloat(queries[0].rows[0].avg_duration) || 0,
      total_messages: parseInt(queries[1].rows[0].count),
      total_video_calls: parseInt(queries[2].rows[0].count)
    };
    
  } catch (error) {
    logger.logError(error, { function: 'collectEngagementMetrics' });
    return {};
  }
}

/**
 * Collecter les métriques géographiques
 */
async function collectGeographicMetrics(periodStart, periodEnd) {
  try {
    const queries = await Promise.all([
      // Top pays par activité
      db.query(`
        SELECT u.country, COUNT(DISTINCT u.user_id) as active_users
        FROM users u
        WHERE u.last_active >= $1 AND u.last_active < $2
        AND u.country IS NOT NULL
        GROUP BY u.country
        ORDER BY active_users DESC
        LIMIT 10
      `, [periodStart, periodEnd]),
      
      // Distribution détaillée
      db.query(`
        SELECT u.country, u.city, COUNT(DISTINCT u.user_id) as users
        FROM users u
        WHERE u.last_active >= $1 AND u.last_active < $2
        AND u.country IS NOT NULL AND u.city IS NOT NULL
        GROUP BY u.country, u.city
        ORDER BY users DESC
        LIMIT 50
      `, [periodStart, periodEnd])
    ]);
    
    const topCountries = {};
    queries[0].rows.forEach(row => {
      topCountries[row.country] = parseInt(row.active_users);
    });
    
    const detailedDistribution = {};
    queries[1].rows.forEach(row => {
      if (!detailedDistribution[row.country]) {
        detailedDistribution[row.country] = {};
      }
      detailedDistribution[row.country][row.city] = parseInt(row.users);
    });
    
    return {
      top_countries: topCountries,
      geographic_distribution: detailedDistribution
    };
    
  } catch (error) {
    logger.logError(error, { function: 'collectGeographicMetrics' });
    return {};
  }
}

/**
 * Collecter les métriques de modération
 */
async function collectModerationMetrics(periodStart, periodEnd) {
  try {
    const queries = await Promise.all([
      // Signalements dans la période
      db.query(`
        SELECT COUNT(*) as count 
        FROM moderation_reports 
        WHERE created_at >= $1 AND created_at < $2
      `, [periodStart, periodEnd]),
      
      // Bans dans la période
      db.query(`
        SELECT COUNT(*) as count 
        FROM admin_logs 
        WHERE action = 'ban_user' 
        AND created_at >= $1 AND created_at < $2
      `, [periodStart, periodEnd]),
      
      // Messages toxiques détectés
      db.query(`
        SELECT COUNT(*) as count 
        FROM messages 
        WHERE toxicity_score >= 0.5 
        AND sent_at >= $1 AND sent_at < $2
      `, [periodStart, periodEnd])
    ]);
    
    return {
      total_reports: parseInt(queries[0].rows[0].count),
      total_bans: parseInt(queries[1].rows[0].count),
      toxicity_incidents: parseInt(queries[2].rows[0].count)
    };
    
  } catch (error) {
    logger.logError(error, { function: 'collectModerationMetrics' });
    return {};
  }
}

// ============================================================================
// FONCTIONS PRINCIPALES
// ============================================================================

/**
 * Générer les analytics pour une période donnée
 */
async function generateAnalytics(periodType, referenceDate = new Date()) {
  try {
    const { periodStart, periodEnd } = getPeriodBounds(periodType, referenceDate);
    
    logger.info(`Génération analytics ${periodType}`, {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString()
    });
    
    // Collecter toutes les métriques en parallèle
    const [userMetrics, engagementMetrics, geographicMetrics, moderationMetrics] = await Promise.all([
      collectUserMetrics(periodStart, periodEnd),
      collectEngagementMetrics(periodStart, periodEnd),
      collectGeographicMetrics(periodStart, periodEnd),
      collectModerationMetrics(periodStart, periodEnd)
    ]);
    
    // Compiler les métriques
    const allMetrics = {
      ...userMetrics,
      ...engagementMetrics,
      ...geographicMetrics,
      ...moderationMetrics,
      // Métriques techniques basiques
      average_response_time_ms: 0, // À implémenter avec monitoring
      error_rate: 0,               // À implémenter avec monitoring  
      uptime_percentage: 100       // À implémenter avec monitoring
    };
    
    // Vérifier si les analytics existent déjà pour cette période
    const existingAnalytics = await db.query(`
      SELECT id FROM analytics 
      WHERE period_type = $1 AND period_start = $2 AND period_end = $3
    `, [periodType, periodStart, periodEnd]);
    
    if (existingAnalytics.rows.length > 0) {
      // Mettre à jour les analytics existants
      await db.query(`
        UPDATE analytics SET
          total_users = $4,
          active_users = $5,
          new_users = $6,
          anonymous_users = $7,
          registered_users = $8,
          total_sessions = $9,
          total_messages = $10,
          total_video_calls = $11,
          average_session_duration_minutes = $12,
          top_countries = $13,
          geographic_distribution = $14,
          total_reports = $15,
          total_bans = $16,
          toxicity_incidents = $17,
          average_response_time_ms = $18,
          error_rate = $19,
          uptime_percentage = $20
        WHERE id = $1
      `, [
        existingAnalytics.rows[0].id,
        allMetrics.total_users,
        allMetrics.active_users,
        allMetrics.new_users,
        allMetrics.anonymous_users,
        allMetrics.registered_users,
        allMetrics.total_sessions,
        allMetrics.total_messages,
        allMetrics.total_video_calls,
        allMetrics.average_session_duration_minutes,
        JSON.stringify(allMetrics.top_countries),
        JSON.stringify(allMetrics.geographic_distribution),
        allMetrics.total_reports,
        allMetrics.total_bans,
        allMetrics.toxicity_incidents,
        allMetrics.average_response_time_ms,
        allMetrics.error_rate,
        allMetrics.uptime_percentage
      ]);
    } else {
      // Insérer de nouveaux analytics
      await db.query(`
        INSERT INTO analytics (
          period_type, period_start, period_end,
          total_users, active_users, new_users, anonymous_users, registered_users,
          total_sessions, total_messages, total_video_calls, average_session_duration_minutes,
          top_countries, geographic_distribution,
          total_reports, total_bans, toxicity_incidents,
          average_response_time_ms, error_rate, uptime_percentage
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      `, [
        periodType, periodStart, periodEnd,
        allMetrics.total_users,
        allMetrics.active_users,
        allMetrics.new_users,
        allMetrics.anonymous_users,
        allMetrics.registered_users,
        allMetrics.total_sessions,
        allMetrics.total_messages,
        allMetrics.total_video_calls,
        allMetrics.average_session_duration_minutes,
        JSON.stringify(allMetrics.top_countries),
        JSON.stringify(allMetrics.geographic_distribution),
        allMetrics.total_reports,
        allMetrics.total_bans,
        allMetrics.toxicity_incidents,
        allMetrics.average_response_time_ms,
        allMetrics.error_rate,
        allMetrics.uptime_percentage
      ]);
    }
    
    // Mettre en cache les stats temps réel
    await redisClient.setLiveStats(formatMetrics(allMetrics), 300); // 5 minutes
    
    logger.logMetrics('analytics_generated', {
      periodType,
      period: `${periodStart.toISOString()} - ${periodEnd.toISOString()}`,
      metrics: allMetrics
    });
    
    return {
      success: true,
      period: { type: periodType, start: periodStart, end: periodEnd },
      metrics: formatMetrics(allMetrics)
    };
    
  } catch (error) {
    logger.logError(error, { function: 'generateAnalytics', periodType });
    return { success: false, error: error.message };
  }
}

/**
 * Générer les analytics horaires
 */
async function generateHourlyAnalytics() {
  return await generateAnalytics('hourly');
}

/**
 * Générer les analytics quotidiens
 */
async function generateDailyAnalytics() {
  return await generateAnalytics('daily');
}

/**
 * Obtenir les analytics pour une période
 */
async function getAnalytics(periodType, startDate, endDate, limit = 100) {
  try {
    let query = `
      SELECT * FROM analytics 
      WHERE period_type = $1
    `;
    const params = [periodType];
    let paramIndex = 2;
    
    if (startDate) {
      query += ` AND period_start >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      query += ` AND period_end <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    
    query += ` ORDER BY period_start DESC LIMIT $${paramIndex}`;
    params.push(limit);
    
    const result = await db.query(query, params);
    
    const analytics = result.rows.map(row => ({
      id: row.id,
      period: {
        type: row.period_type,
        start: row.period_start,
        end: row.period_end
      },
      metrics: formatMetrics(row),
      createdAt: row.created_at
    }));
    
    return { success: true, analytics };
    
  } catch (error) {
    logger.logError(error, { function: 'getAnalytics', periodType });
    return { success: false, error: error.message };
  }
}

/**
 * Obtenir les statistiques en temps réel
 */
async function getRealTimeStats() {
  try {
    // Essayer d'abord le cache Redis
    let stats = await redisClient.getLiveStats();
    
    if (!stats) {
      // Si pas en cache, générer à la volée
      const liveMetrics = await collectUserMetrics(new Date(Date.now() - 60000), new Date());
      const engagementMetrics = await collectEngagementMetrics(new Date(Date.now() - 3600000), new Date());
      
      stats = formatMetrics({
        ...liveMetrics,
        ...engagementMetrics
      });
      
      // Mettre en cache pour 1 minute
      await redisClient.setLiveStats(stats, 60);
    }
    
    return { success: true, stats };
    
  } catch (error) {
    logger.logError(error, { function: 'getRealTimeStats' });
    return { success: false, error: error.message };
  }
}

/**
 * Mettre à jour le statut d'un utilisateur
 */
async function updateUserStatus(userId, status) {
  try {
    await db.updateUserStatus(userId, status, new Date());
    
    // Incrémenter les compteurs en temps réel
    if (status === 'online') {
      await redisClient.incrementCounter('users_online_today');
    }
    
    return true;
  } catch (error) {
    logger.logError(error, { function: 'updateUserStatus', userId, status });
    return false;
  }
}

/**
 * Nettoyer les anciennes analytics
 */
async function cleanupOldAnalytics() {
  try {
    const cleanupResults = await Promise.all([
      // Nettoyer les analytics horaires anciennes
      db.query(`
        DELETE FROM analytics 
        WHERE period_type = 'hourly' 
        AND period_start < NOW() - INTERVAL '${ANALYTICS_CONFIG.DATA_RETENTION_DAYS.HOURLY} days'
      `),
      
      // Nettoyer les analytics quotidiennes anciennes
      db.query(`
        DELETE FROM analytics 
        WHERE period_type = 'daily' 
        AND period_start < NOW() - INTERVAL '${ANALYTICS_CONFIG.DATA_RETENTION_DAYS.DAILY} days'
      `),
      
      // Nettoyer les analytics hebdomadaires anciennes
      db.query(`
        DELETE FROM analytics 
        WHERE period_type = 'weekly' 
        AND period_start < NOW() - INTERVAL '${ANALYTICS_CONFIG.DATA_RETENTION_DAYS.WEEKLY} days'
      `)
    ]);
    
    const totalCleaned = cleanupResults.reduce((sum, result) => sum + result.rowCount, 0);
    
    if (totalCleaned > 0) {
      logger.info(`Nettoyage analytics: ${totalCleaned} entrées supprimées`);
    }
    
    return { cleaned: totalCleaned };
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupOldAnalytics' });
    return { cleaned: 0 };
  }
}

// ============================================================================
// EXPORT DU MODULE
// ============================================================================

module.exports = {
  // Génération d'analytics
  generateAnalytics,
  generateHourlyAnalytics,
  generateDailyAnalytics,
  
  // Récupération d'analytics
  getAnalytics,
  getRealTimeStats,
  
  // Mise à jour temps réel
  updateUserStatus,
  
  // Collecte de métriques
  collectUserMetrics,
  collectEngagementMetrics,
  collectGeographicMetrics,
  collectModerationMetrics,
  
  // Maintenance
  cleanupOldAnalytics,
  
  // Utilitaires
  formatMetrics,
  getPeriodBounds,
  
  // Configuration
  ANALYTICS_CONFIG
};
