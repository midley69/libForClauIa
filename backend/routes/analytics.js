// ============================================================================
// ROUTES ANALYTICS ET STATISTIQUES
// Fichier : /var/www/libekoo/backend/routes/analytics.js
// ============================================================================

const express = require('express');
const { query, validationResult } = require('express-validator');

const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');
const authMiddleware = require('../middleware/auth');
const { analyticsValidators, handleValidationErrors } = require('../middleware/validation');
const analyticsService = require('../services/analyticsService');

const router = express.Router();

// Appliquer l'authentification à toutes les routes
router.use(authMiddleware);

// ============================================================================
// STATISTIQUES PUBLIQUES (ANONYMES)
// ============================================================================

/**
 * GET /api/analytics/public-stats
 * Récupérer les statistiques publiques basiques
 */
router.get('/public-stats', async (req, res) => {
  try {
    // Récupérer les stats de base depuis Redis (cache)
    let publicStats = await redisClient.getCache('public_stats');
    
    if (!publicStats) {
      // Générer les stats publiques
      const queries = await Promise.all([
        db.query("SELECT COUNT(*) as count FROM users WHERE status = 'online'"),
        db.query("SELECT COUNT(*) as count FROM chat_sessions WHERE status = 'active'"),
        db.query("SELECT COUNT(*) as count FROM video_sessions WHERE status = 'active'"),
        db.query("SELECT COUNT(DISTINCT country) as count FROM users WHERE country IS NOT NULL"),
        db.query(`
          SELECT COUNT(*) as count 
          FROM chat_sessions 
          WHERE created_at >= CURRENT_DATE
        `),
        db.query(`
          SELECT COUNT(*) as count 
          FROM video_sessions 
          WHERE created_at >= CURRENT_DATE
        `)
      ]);
      
      publicStats = {
        onlineUsers: parseInt(queries[0].rows[0].count),
        activeChats: parseInt(queries[1].rows[0].count),
        activeVideos: parseInt(queries[2].rows[0].count),
        countriesRepresented: parseInt(queries[3].rows[0].count),
        chatsToday: parseInt(queries[4].rows[0].count),
        videosToday: parseInt(queries[5].rows[0].count),
        lastUpdated: new Date().toISOString()
      };
      
      // Mettre en cache pour 1 minute
      await redisClient.setCache('public_stats', publicStats, 60);
    }
    
    res.json({
      success: true,
      stats: publicStats
    });
    
  } catch (error) {
    logger.logError(error, { route: '/analytics/public-stats' });
    res.status(500).json({ 
      error: 'Erreur récupération statistiques',
      code: 'STATS_ERROR'
    });
  }
});

/**
 * GET /api/analytics/countries
 * Récupérer la répartition par pays (anonymisée)
 */
router.get('/countries', async (req, res) => {
  try {
    let countriesStats = await redisClient.getCache('countries_stats');
    
    if (!countriesStats) {
      const result = await db.query(`
        SELECT 
          country,
          COUNT(DISTINCT user_id) as user_count,
          COUNT(CASE WHEN status = 'online' THEN 1 END) as online_count
        FROM users 
        WHERE country IS NOT NULL
        GROUP BY country
        ORDER BY user_count DESC
        LIMIT 20
      `);
      
      countriesStats = {
        countries: result.rows.map(row => ({
          country: row.country,
          userCount: parseInt(row.user_count),
          onlineCount: parseInt(row.online_count),
          percentage: 0 // Sera calculé côté client
        })),
        lastUpdated: new Date().toISOString()
      };
      
      // Calculer les pourcentages
      const totalUsers = countriesStats.countries.reduce((sum, c) => sum + c.userCount, 0);
      countriesStats.countries.forEach(country => {
        country.percentage = totalUsers > 0 ? Math.round((country.userCount / totalUsers) * 100) : 0;
      });
      
      // Mettre en cache pour 5 minutes
      await redisClient.setCache('countries_stats', countriesStats, 300);
    }
    
    res.json({
      success: true,
      data: countriesStats
    });
    
  } catch (error) {
    logger.logError(error, { route: '/analytics/countries' });
    res.status(500).json({ 
      error: 'Erreur récupération pays',
      code: 'COUNTRIES_ERROR'
    });
  }
});

// ============================================================================
// STATISTIQUES UTILISATEUR PERSONNEL
// ============================================================================

/**
 * GET /api/analytics/my-stats
 * Récupérer les statistiques personnelles de l'utilisateur
 */
router.get('/my-stats', async (req, res) => {
  try {
    const userId = req.user?.userId;
    
    if (!userId || !req.user.isAuthenticated) {
      return res.status(401).json({
        error: 'Authentification requise',
        code: 'AUTH_REQUIRED'
      });
    }
    
    // Récupérer les stats de l'utilisateur
    const [userResult, sessionsResult, messagesResult] = await Promise.all([
      db.getUserById(userId),
      
      db.query(`
        SELECT 
          session_type,
          COUNT(*) as session_count,
          AVG(duration_seconds) as avg_duration,
          SUM(message_count) as total_messages
        FROM chat_sessions 
        WHERE user1_id = $1 OR user2_id = $1
        GROUP BY session_type
      `, [userId]),
      
      db.query(`
        SELECT 
          DATE(sent_at) as date,
          COUNT(*) as message_count
        FROM messages m
        JOIN chat_sessions cs ON m.session_id = cs.id
        WHERE m.sender_id = $1
        AND m.sent_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(sent_at)
        ORDER BY date DESC
      `, [userId])
    ]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    const user = userResult.rows[0];
    const userStats = user.stats || {};
    
    // Préparer les données de session par type
    const sessionsByType = {};
    sessionsResult.rows.forEach(row => {
      sessionsByType[row.session_type] = {
        count: parseInt(row.session_count),
        averageDuration: parseInt(row.avg_duration) || 0,
        totalMessages: parseInt(row.total_messages) || 0
      };
    });
    
    // Données d'activité des 30 derniers jours
    const dailyActivity = messagesResult.rows.map(row => ({
      date: row.date,
      messages: parseInt(row.message_count)
    }));
    
    res.json({
      success: true,
      stats: {
        user: {
          id: userId,
          username: user.username,
          accountType: user.account_type,
          level: user.level,
          points: user.points,
          badges: user.badges || [],
          memberSince: user.created_at
        },
        totals: {
          totalChats: userStats.total_chats || 0,
          totalMessages: userStats.total_messages || 0,
          totalVideoCalls: userStats.total_video_calls || 0,
          totalTimeMinutes: userStats.total_time_minutes || 0,
          friendsAdded: userStats.friends_added || 0
        },
        sessionsByType,
        dailyActivity,
        achievements: {
          // Calculer des achievements basiques
          chatMaster: (userStats.total_chats || 0) >= 100,
          socialButterfly: (userStats.friends_added || 0) >= 10,
          videoExpert: (userStats.total_video_calls || 0) >= 50,
          messageKing: (userStats.total_messages || 0) >= 1000
        },
        lastUpdated: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.logError(error, { route: '/analytics/my-stats', userId: req.user?.userId });
    res.status(500).json({ 
      error: 'Erreur récupération statistiques personnelles',
      code: 'PERSONAL_STATS_ERROR'
    });
  }
});

/**
 * GET /api/analytics/my-activity
 * Récupérer l'historique d'activité de l'utilisateur
 */
router.get('/my-activity',
  [
    query('period').optional().isIn(['7d', '30d', '90d']).withMessage('Période invalide'),
    query('type').optional().isIn(['all', 'chat', 'video', 'messages']).withMessage('Type invalide'),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const userId = req.user?.userId;
      const { period = '30d', type = 'all' } = req.query;
      
      if (!userId || !req.user.isAuthenticated) {
        return res.status(401).json({ error: 'Authentification requise' });
      }
      
      // Calculer la date de début selon la période
      const periodDays = {
        '7d': 7,
        '30d': 30,
        '90d': 90
      };
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - periodDays[period]);
      
      const queries = [];
      
      // Activité de chat
      if (type === 'all' || type === 'chat') {
        queries.push(
          db.query(`
            SELECT 
              'chat' as activity_type,
              DATE(created_at) as date,
              COUNT(*) as count
            FROM chat_sessions 
            WHERE (user1_id = $1 OR user2_id = $1)
            AND created_at >= $2
            GROUP BY DATE(created_at)
            ORDER BY date
          `, [userId, startDate])
        );
      }
      
      // Activité vidéo
      if (type === 'all' || type === 'video') {
        queries.push(
          db.query(`
            SELECT 
              'video' as activity_type,
              DATE(created_at) as date,
              COUNT(*) as count
            FROM video_sessions 
            WHERE participants::jsonb @> $1::jsonb
            AND created_at >= $2
            GROUP BY DATE(created_at)
            ORDER BY date
          `, [JSON.stringify([{ userId }]), startDate])
        );
      }
      
      // Activité de messages
      if (type === 'all' || type === 'messages') {
        queries.push(
          db.query(`
            SELECT 
              'messages' as activity_type,
              DATE(sent_at) as date,
              COUNT(*) as count
            FROM messages 
            WHERE sender_id = $1
            AND sent_at >= $2
            GROUP BY DATE(sent_at)
            ORDER BY date
          `, [userId, startDate])
        );
      }
      
      const results = await Promise.all(queries);
      
      // Combiner les résultats
      const activity = [];
      results.forEach(result => {
        activity.push(...result.rows);
      });
      
      // Grouper par date
      const activityByDate = {};
      activity.forEach(item => {
        const dateStr = item.date.toISOString().split('T')[0];
        if (!activityByDate[dateStr]) {
          activityByDate[dateStr] = {};
        }
        activityByDate[dateStr][item.activity_type] = parseInt(item.count);
      });
      
      // Convertir en array
      const activityArray = Object.entries(activityByDate).map(([date, data]) => ({
        date,
        ...data
      })).sort((a, b) => new Date(a.date) - new Date(b.date));
      
      res.json({
        success: true,
        activity: activityArray,
        period,
        type,
        summary: {
          totalDays: activityArray.length,
          totalChats: activityArray.reduce((sum, day) => sum + (day.chat || 0), 0),
          totalVideos: activityArray.reduce((sum, day) => sum + (day.video || 0), 0),
          totalMessages: activityArray.reduce((sum, day) => sum + (day.messages || 0), 0)
        }
      });
      
    } catch (error) {
      logger.logError(error, { route: '/analytics/my-activity', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur récupération activité',
        code: 'ACTIVITY_ERROR'
      });
    }
  }
);

// ============================================================================
// STATISTIQUES TEMPS RÉEL
// ============================================================================

/**
 * GET /api/analytics/live-stats
 * Récupérer les statistiques en temps réel
 */
router.get('/live-stats', async (req, res) => {
  try {
    const liveStatsResult = await analyticsService.getRealTimeStats();
    
    if (liveStatsResult.success) {
      res.json({
        success: true,
        stats: liveStatsResult.stats
      });
    } else {
      res.status(500).json({ error: liveStatsResult.error });
    }
    
  } catch (error) {
    logger.logError(error, { route: '/analytics/live-stats' });
    res.status(500).json({ 
      error: 'Erreur récupération statistiques temps réel',
      code: 'LIVE_STATS_ERROR'
    });
  }
});

/**
 * GET /api/analytics/queue-status
 * Récupérer le statut des files d'attente
 */
router.get('/queue-status', async (req, res) => {
  try {
    const matchingService = require('../services/matchingService');
    const queueStats = await matchingService.getQueueStats();
    
    res.json({
      success: true,
      queues: {
        random: {
          waiting: queueStats.randomQueue,
          averageWait: queueStats.averageWaitRandom,
          activeMatches: queueStats.activeRandomMatches
        },
        local: {
          waiting: queueStats.localQueue,
          averageWait: queueStats.averageWaitLocal,
          activeMatches: queueStats.activeLocalMatches
        },
        group: {
          waiting: queueStats.groupQueue,
          averageWait: queueStats.averageWaitGroup,
          activeMatches: queueStats.activeGroupMatches
        }
      },
      global: {
        totalOnlineUsers: queueStats.totalOnlineUsers,
        lastUpdated: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.logError(error, { route: '/analytics/queue-status' });
    res.status(500).json({ 
      error: 'Erreur récupération statut files',
      code: 'QUEUE_STATUS_ERROR'
    });
  }
});

// ============================================================================
// TENDANCES ET ANALYTICS AVANCÉES
// ============================================================================

/**
 * GET /api/analytics/trends
 * Récupérer les tendances d'utilisation
 */
router.get('/trends',
  [
    ...analyticsValidators.getAnalytics,
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { 
        period = 'daily', 
        startDate, 
        endDate, 
        limit = 7 
      } = req.query;
      
      const analyticsResult = await analyticsService.getAnalytics(
        period,
        startDate ? new Date(startDate) : null,
        endDate ? new Date(endDate) : null,
        parseInt(limit)
      );
      
      if (analyticsResult.success) {
        // Transformer les données pour afficher les tendances
        const analytics = analyticsResult.analytics;
        const trends = {
          users: [],
          engagement: [],
          growth: []
        };
        
        analytics.forEach(entry => {
          const metrics = entry.metrics;
          trends.users.push({
            date: entry.period.start,
            total: metrics.users.total,
            active: metrics.users.active,
            new: metrics.users.new
          });
          
          trends.engagement.push({
            date: entry.period.start,
            sessions: metrics.engagement.sessions,
            messages: metrics.engagement.messages,
            videoCalls: metrics.engagement.videoCalls
          });
        });
        
        // Calculer la croissance
        for (let i = 1; i < trends.users.length; i++) {
          const current = trends.users[i];
          const previous = trends.users[i - 1];
          
          trends.growth.push({
            date: current.date,
            userGrowth: previous.total > 0 ? 
              Math.round(((current.total - previous.total) / previous.total) * 100) : 0,
            engagementGrowth: previous.active > 0 ? 
              Math.round(((current.active - previous.active) / previous.active) * 100) : 0
          });
        }
        
        res.json({
          success: true,
          trends,
          period,
          dataPoints: analytics.length
        });
        
      } else {
        res.status(500).json({ error: analyticsResult.error });
      }
      
    } catch (error) {
      logger.logError(error, { route: '/analytics/trends' });
      res.status(500).json({ 
        error: 'Erreur récupération tendances',
        code: 'TRENDS_ERROR'
      });
    }
  }
);

/**
 * GET /api/analytics/peak-hours
 * Récupérer les heures de pointe
 */
router.get('/peak-hours', async (req, res) => {
  try {
    let peakHours = await redisClient.getCache('peak_hours');
    
    if (!peakHours) {
      const result = await db.query(`
        SELECT 
          EXTRACT(HOUR FROM created_at) as hour,
          COUNT(*) as sessions,
          AVG(duration_seconds) as avg_duration
        FROM chat_sessions 
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY hour
      `);
      
      peakHours = {
        hourly: result.rows.map(row => ({
          hour: parseInt(row.hour),
          sessions: parseInt(row.sessions),
          averageDuration: parseInt(row.avg_duration) || 0
        })),
        lastUpdated: new Date().toISOString()
      };
      
      // Mettre en cache pour 1 heure
      await redisClient.setCache('peak_hours', peakHours, 3600);
    }
    
    res.json({
      success: true,
      data: peakHours
    });
    
  } catch (error) {
    logger.logError(error, { route: '/analytics/peak-hours' });
    res.status(500).json({ 
      error: 'Erreur récupération heures de pointe',
      code: 'PEAK_HOURS_ERROR'
    });
  }
});

// ============================================================================
// EXPORTS ET RAPPORTS
// ============================================================================

/**
 * GET /api/analytics/export
 * Exporter les données analytiques (utilisateurs authentifiés uniquement)
 */
router.get('/export',
  [
    query('format').optional().isIn(['json', 'csv']).withMessage('Format invalide'),
    query('type').optional().isIn(['personal', 'summary']).withMessage('Type invalide'),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const userId = req.user?.userId;
      const { format = 'json', type = 'personal' } = req.query;
      
      if (!userId || !req.user.isAuthenticated) {
        return res.status(401).json({ error: 'Authentification requise' });
      }
      
      if (type === 'personal') {
        // Exporter les données personnelles de l'utilisateur
        const [userResult, sessionsResult, messagesResult] = await Promise.all([
          db.getUserById(userId),
          
          db.query(`
            SELECT session_id, session_type, status, created_at, ended_at, 
                   duration_seconds, message_count
            FROM chat_sessions 
            WHERE user1_id = $1 OR user2_id = $1
            ORDER BY created_at DESC
            LIMIT 1000
          `, [userId]),
          
          db.query(`
            SELECT COUNT(*) as total_messages,
                   MIN(sent_at) as first_message,
                   MAX(sent_at) as last_message
            FROM messages m
            JOIN chat_sessions cs ON m.session_id = cs.id
            WHERE m.sender_id = $1
          `, [userId])
        ]);
        
        const exportData = {
          user: userResult.rows[0],
          sessions: sessionsResult.rows,
          messageStats: messagesResult.rows[0],
          exportedAt: new Date().toISOString(),
          exportFormat: format
        };
        
        if (format === 'csv') {
          // Convertir en CSV (simplifié)
          const csv = [
            'Type,Date,Duration,Messages',
            ...sessionsResult.rows.map(s => 
              `${s.session_type},${s.created_at},${s.duration_seconds || 0},${s.message_count || 0}`
            )
          ].join('\n');
          
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="libekoo-export-${userId}.csv"`);
          res.send(csv);
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', `attachment; filename="libekoo-export-${userId}.json"`);
          res.json(exportData);
        }
        
      } else {
        res.status(403).json({ error: 'Type d\'export non autorisé' });
      }
      
    } catch (error) {
      logger.logError(error, { route: '/analytics/export', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur lors de l\'export',
        code: 'EXPORT_ERROR'
      });
    }
  }
);

module.exports = router;
