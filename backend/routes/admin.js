// ============================================================================
// ROUTES D'ADMINISTRATION ET MODÉRATION
// Fichier : /var/www/libekoo/backend/routes/admin.js
// ============================================================================

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');
const authMiddleware = require('../middleware/auth');
const moderationService = require('../services/moderationService');
const analyticsService = require('../services/analyticsService');

const router = express.Router();

// ============================================================================
// MIDDLEWARE ADMIN
// ============================================================================

// Rate limiting strict pour les routes admin
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requêtes par fenêtre pour les admins
  message: { error: 'Limite de requêtes admin dépassée' }
});

// Middleware de vérification admin
const requireAdmin = async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentification requise' });
    }
    
    // Vérifier si l'utilisateur est admin
    const result = await db.query(`
      SELECT user_id, account_type, email
      FROM users 
      WHERE user_id = $1 
      AND (account_type = 'admin' OR email IN ($2, $3))
    `, [userId, 'admin@libekoo.me', 'moderateur@libekoo.me']);
    
    if (result.rows.length === 0) {
      logger.logSecurityEvent('unauthorized_admin_access', { userId, ip: req.userIP });
      return res.status(403).json({ error: 'Permissions administrateur requises' });
    }
    
    req.admin = result.rows[0];
    next();
    
  } catch (error) {
    logger.logError(error, { middleware: 'requireAdmin', userId: req.user?.userId });
    res.status(500).json({ error: 'Erreur vérification permissions' });
  }
};

// Appliquer les middlewares à toutes les routes
router.use(adminLimiter);
router.use(authMiddleware);
router.use(requireAdmin);

// ============================================================================
// DASHBOARD ET STATISTIQUES
// ============================================================================

/**
 * GET /api/admin/dashboard
 * Récupérer les données du dashboard admin
 */
router.get('/dashboard', async (req, res) => {
  try {
    const adminId = req.admin.user_id;
    
    // Récupérer toutes les métriques en parallèle
    const [
      liveStats,
      moderationStats,
      recentActivity,
      systemHealth
    ] = await Promise.all([
      analyticsService.getRealTimeStats(),
      moderationService.getModerationStats(),
      
      // Activité récente
      db.query(`
        SELECT action, target_type, created_at, severity
        FROM admin_logs 
        ORDER BY created_at DESC 
        LIMIT 20
      `),
      
      // Santé système
      db.query(`
        SELECT 
          pg_database_size(current_database()) as db_size,
          (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
          NOW() - pg_postmaster_start_time() as uptime
      `)
    ]);
    
    // Logger l'accès au dashboard
    await db.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id)
      VALUES ($1, 'dashboard_access', 'system', 'dashboard')
    `, [adminId]);
    
    res.json({
      success: true,
      dashboard: {
        stats: liveStats.stats || {},
        moderation: moderationStats,
        recentActivity: recentActivity.rows.map(activity => ({
          action: activity.action,
          targetType: activity.target_type,
          timestamp: activity.created_at,
          severity: activity.severity
        })),
        systemHealth: {
          databaseSize: parseInt(systemHealth.rows[0].db_size),
          activeConnections: parseInt(systemHealth.rows[0].active_connections),
          uptime: systemHealth.rows[0].uptime,
          status: 'healthy' // À améliorer avec des checks réels
        },
        lastUpdated: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.logError(error, { route: '/admin/dashboard', adminId: req.admin?.user_id });
    res.status(500).json({ error: 'Erreur récupération dashboard' });
  }
});

/**
 * GET /api/admin/analytics
 * Récupérer les analytics détaillées
 */
router.get('/analytics',
  [
    query('period').optional().isIn(['hourly', 'daily', 'weekly', 'monthly']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 1000 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Paramètres invalides', details: errors.array() });
      }
      
      const { 
        period = 'daily', 
        startDate, 
        endDate, 
        limit = 30 
      } = req.query;
      
      const analyticsResult = await analyticsService.getAnalytics(
        period, 
        startDate ? new Date(startDate) : null,
        endDate ? new Date(endDate) : null,
        parseInt(limit)
      );
      
      if (analyticsResult.success) {
        res.json({
          success: true,
          analytics: analyticsResult.analytics
        });
      } else {
        res.status(500).json({ error: analyticsResult.error });
      }
      
    } catch (error) {
      logger.logError(error, { route: '/admin/analytics', adminId: req.admin?.user_id });
      res.status(500).json({ error: 'Erreur récupération analytics' });
    }
  }
);

// ============================================================================
// GESTION DES UTILISATEURS
// ============================================================================

/**
 * GET /api/admin/users
 * Rechercher et lister les utilisateurs
 */
router.get('/users',
  [
    query('search').optional().isLength({ max: 100 }),
    query('status').optional().isIn(['online', 'offline', 'banned', 'all']),
    query('type').optional().isIn(['anonymous', 'registered', 'admin', 'all']),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Paramètres invalides', details: errors.array() });
      }
      
      const {
        search,
        status = 'all',
        type = 'all',
        limit = 50,
        offset = 0
      } = req.query;
      
      let query = `
        SELECT u.user_id, u.username, u.email, u.account_type, u.gender,
               u.country, u.city, u.status, u.is_banned, u.ban_reason, u.ban_expires_at,
               u.created_at, u.last_active, u.points, u.level, u.stats,
               COUNT(mr.id) as report_count
        FROM users u
        LEFT JOIN moderation_reports mr ON u.user_id = mr.reported_user_id
        WHERE 1=1
      `;
      
      const params = [];
      let paramIndex = 1;
      
      // Recherche textuelle
      if (search && search.trim()) {
        query += ` AND (
          u.username ILIKE $${paramIndex} OR 
          u.email ILIKE $${paramIndex} OR 
          u.user_id ILIKE $${paramIndex}
        )`;
        params.push(`%${search.trim()}%`);
        paramIndex++;
      }
      
      // Filtre par statut
      if (status !== 'all') {
        if (status === 'banned') {
          query += ` AND u.is_banned = true`;
        } else {
          query += ` AND u.status = $${paramIndex} AND u.is_banned = false`;
          params.push(status);
          paramIndex++;
        }
      }
      
      // Filtre par type
      if (type !== 'all') {
        query += ` AND u.account_type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }
      
      query += `
        GROUP BY u.user_id, u.username, u.email, u.account_type, u.gender,
                 u.country, u.city, u.status, u.is_banned, u.ban_reason, u.ban_expires_at,
                 u.created_at, u.last_active, u.points, u.level, u.stats
        ORDER BY u.last_active DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      params.push(parseInt(limit), parseInt(offset));
      
      const result = await db.query(query, params);
      
      // Compter le total pour la pagination
      let countQuery = `SELECT COUNT(DISTINCT u.user_id) as total FROM users u WHERE 1=1`;
      let countParams = [];
      let countParamIndex = 1;
      
      if (search && search.trim()) {
        countQuery += ` AND (u.username ILIKE $${countParamIndex} OR u.email ILIKE $${countParamIndex} OR u.user_id ILIKE $${countParamIndex})`;
        countParams.push(`%${search.trim()}%`);
        countParamIndex++;
      }
      
      if (status !== 'all') {
        if (status === 'banned') {
          countQuery += ` AND u.is_banned = true`;
        } else {
          countQuery += ` AND u.status = $${countParamIndex} AND u.is_banned = false`;
          countParams.push(status);
        }
      }
      
      if (type !== 'all') {
        countQuery += ` AND u.account_type = $${countParamIndex}`;
        countParams.push(type);
      }
      
      const countResult = await db.query(countQuery, countParams);
      
      res.json({
        success: true,
        users: result.rows.map(user => ({
          id: user.user_id,
          username: user.username,
          email: user.email,
          type: user.account_type,
          gender: user.gender,
          location: `${user.city || 'Inconnue'}, ${user.country || 'Inconnu'}`,
          status: user.status,
          isBanned: user.is_banned,
          banReason: user.ban_reason,
          banExpiresAt: user.ban_expires_at,
          points: user.points,
          level: user.level,
          stats: user.stats,
          reportCount: parseInt(user.report_count),
          createdAt: user.created_at,
          lastActive: user.last_active
        })),
        pagination: {
          total: parseInt(countResult.rows[0].total),
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: parseInt(offset) + result.rows.length < parseInt(countResult.rows[0].total)
        }
      });
      
    } catch (error) {
      logger.logError(error, { route: '/admin/users', adminId: req.admin?.user_id });
      res.status(500).json({ error: 'Erreur recherche utilisateurs' });
    }
  }
);

/**
 * GET /api/admin/users/:userId
 * Récupérer les détails d'un utilisateur
 */
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.admin.user_id;
    
    // Récupérer les informations utilisateur complètes
    const [userResult, sessionsResult, reportsResult, locationResult] = await Promise.all([
      db.query('SELECT * FROM users WHERE user_id = $1', [userId]),
      
      db.query(`
        SELECT session_id, session_type, status, created_at, ended_at, message_count, duration_seconds
        FROM chat_sessions 
        WHERE user1_id = $1 OR user2_id = $1
        ORDER BY created_at DESC 
        LIMIT 20
      `, [userId]),
      
      db.query(`
        SELECT * FROM moderation_reports 
        WHERE reporter_id = $1 OR reported_user_id = $1
        ORDER BY created_at DESC 
        LIMIT 10
      `, [userId]),
      
      db.query(`
        SELECT * FROM user_locations 
        WHERE user_id = $1 
        ORDER BY created_at DESC 
        LIMIT 1
      `, [userId])
    ]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    const user = userResult.rows[0];
    
    // Logger l'accès au profil utilisateur
    await db.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id)
      VALUES ($1, 'view_user_profile', 'user', $2)
    `, [adminId, userId]);
    
    res.json({
      success: true,
      user: {
        id: user.user_id,
        username: user.username,
        email: user.email,
        type: user.account_type,
        gender: user.gender,
        ageRange: user.age_range,
        bio: user.bio,
        status: user.status,
        isBanned: user.is_banned,
        banReason: user.ban_reason,
        banExpiresAt: user.ban_expires_at,
        points: user.points,
        level: user.level,
        badges: user.badges,
        stats: user.stats,
        preferences: user.preferences,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        lastActive: user.last_active,
        location: locationResult.rows[0] ? {
          country: locationResult.rows[0].country,
          city: locationResult.rows[0].city,
          latitude: locationResult.rows[0].latitude,
          longitude: locationResult.rows[0].longitude
        } : null,
        recentSessions: sessionsResult.rows.map(session => ({
          id: session.session_id,
          type: session.session_type,
          status: session.status,
          messageCount: session.message_count,
          duration: session.duration_seconds,
          createdAt: session.created_at,
          endedAt: session.ended_at
        })),
        reports: reportsResult.rows.map(report => ({
          id: report.id,
          type: report.report_type,
          description: report.description,
          status: report.status,
          isReporter: report.reporter_id === userId,
          createdAt: report.created_at
        }))
      }
    });
    
  } catch (error) {
    logger.logError(error, { route: '/admin/users/:userId', adminId: req.admin?.user_id });
    res.status(500).json({ error: 'Erreur récupération utilisateur' });
  }
});

/**
 * POST /api/admin/users/:userId/ban
 * Bannir un utilisateur
 */
router.post('/users/:userId/ban',
  [
    body('reason').notEmpty().isLength({ max: 500 }).withMessage('Raison requise (max 500 caractères)'),
    body('duration').optional().isInt({ min: 1, max: 8760 }).withMessage('Durée invalide (1-8760 heures)'),
    body('banType').optional().isIn(['temporary', 'permanent']).withMessage('Type de ban invalide')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Données invalides', details: errors.array() });
      }
      
      const { userId } = req.params;
      const { reason, duration = 24, banType = 'temporary' } = req.body;
      const adminId = req.admin.user_id;
      
      // Vérifier que l'utilisateur existe et n'est pas déjà admin
      const userResult = await db.query('SELECT * FROM users WHERE user_id = $1', [userId]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }
      
      const user = userResult.rows[0];
      if (user.account_type === 'admin') {
        return res.status(400).json({ error: 'Impossible de bannir un administrateur' });
      }
      
      const banDuration = banType === 'permanent' ? 8760 : duration;
      
      const success = await moderationService.banUser(userId, reason, banDuration, adminId);
      
      if (success) {
        res.json({
          success: true,
          message: `Utilisateur ${userId} banni avec succès`,
          ban: {
            reason,
            duration: banDuration,
            type: banType,
            bannedBy: adminId,
            bannedAt: new Date().toISOString()
          }
        });
      } else {
        res.status(500).json({ error: 'Erreur lors du bannissement' });
      }
      
    } catch (error) {
      logger.logError(error, { route: '/admin/users/:userId/ban', adminId: req.admin?.user_id });
      res.status(500).json({ error: 'Erreur lors du bannissement' });
    }
  }
);

/**
 * POST /api/admin/users/:userId/unban
 * Débannir un utilisateur
 */
router.post('/users/:userId/unban', async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.admin.user_id;
    
    const success = await moderationService.unbanUser(userId, adminId);
    
    if (success) {
      res.json({
        success: true,
        message: `Utilisateur ${userId} débanni avec succès`,
        unbannedBy: adminId,
        unbannedAt: new Date().toISOString()
      });
    } else {
      res.status(500).json({ error: 'Erreur lors du débannissement' });
    }
    
  } catch (error) {
    logger.logError(error, { route: '/admin/users/:userId/unban', adminId: req.admin?.user_id });
    res.status(500).json({ error: 'Erreur lors du débannissement' });
  }
});

// ============================================================================
// GESTION DES SIGNALEMENTS
// ============================================================================

/**
 * GET /api/admin/reports
 * Récupérer les signalements
 */
router.get('/reports',
  [
    query('status').optional().isIn(['pending', 'investigating', 'resolved', 'dismissed', 'all']),
    query('priority').optional().isIn(['low', 'normal', 'high', 'urgent', 'all']),
    query('type').optional().isIn(['spam', 'harassment', 'inappropriate_content', 'fake_profile', 'underage', 'other', 'all']),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Paramètres invalides', details: errors.array() });
      }
      
      const {
        status = 'all',
        priority = 'all',
        type = 'all',
        limit = 50,
        offset = 0
      } = req.query;
      
      let query = `
        SELECT mr.*, 
               u1.username as reporter_username,
               u2.username as reported_username
        FROM moderation_reports mr
        LEFT JOIN users u1 ON mr.reporter_id = u1.user_id
        LEFT JOIN users u2 ON mr.reported_user_id = u2.user_id
        WHERE 1=1
      `;
      
      const params = [];
      let paramIndex = 1;
      
      if (status !== 'all') {
        query += ` AND mr.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }
      
      if (priority !== 'all') {
        query += ` AND mr.priority = $${paramIndex}`;
        params.push(priority);
        paramIndex++;
      }
      
      if (type !== 'all') {
        query += ` AND mr.report_type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }
      
      query += `
        ORDER BY 
          CASE mr.priority 
            WHEN 'urgent' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            ELSE 4
          END,
          mr.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      params.push(parseInt(limit), parseInt(offset));
      
      const result = await db.query(query, params);
      
      res.json({
        success: true,
        reports: result.rows.map(report => ({
          id: report.id,
          reporter: {
            id: report.reporter_id,
            username: report.reporter_username
          },
          reported: {
            id: report.reported_user_id,
            username: report.reported_username
          },
          targetType: report.target_type,
          targetId: report.target_id,
          reportType: report.report_type,
          description: report.description,
          status: report.status,
          priority: report.priority,
          assignedTo: report.assigned_to,
          adminNotes: report.admin_notes,
          actionTaken: report.action_taken,
          evidence: report.evidence,
          createdAt: report.created_at,
          updatedAt: report.updated_at,
          resolvedAt: report.resolved_at
        }))
      });
      
    } catch (error) {
      logger.logError(error, { route: '/admin/reports', adminId: req.admin?.user_id });
      res.status(500).json({ error: 'Erreur récupération signalements' });
    }
  }
);

/**
 * PUT /api/admin/reports/:reportId
 * Traiter un signalement
 */
router.put('/reports/:reportId',
  [
    body('status').isIn(['investigating', 'resolved', 'dismissed']).withMessage('Statut invalide'),
    body('adminNotes').optional().isLength({ max: 1000 }).withMessage('Notes trop longues'),
    body('actionTaken').optional().isLength({ max: 200 }).withMessage('Action trop longue')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Données invalides', details: errors.array() });
      }
      
      const { reportId } = req.params;
      const { status, adminNotes, actionTaken } = req.body;
      const adminId = req.admin.user_id;
      
      // Mettre à jour le signalement
      const result = await db.query(`
        UPDATE moderation_reports 
        SET status = $2,
            assigned_to = $3,
            admin_notes = $4,
            action_taken = $5,
            updated_at = NOW(),
            resolved_at = CASE WHEN $2 IN ('resolved', 'dismissed') THEN NOW() ELSE resolved_at END
        WHERE id = $1
        RETURNING *
      `, [reportId, status, adminId, adminNotes, actionTaken]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Signalement non trouvé' });
      }
      
      // Logger l'action
      await db.query(`
        INSERT INTO admin_logs (admin_id, action, target_type, target_id, action_details)
        VALUES ($1, 'process_report', 'report', $2, $3)
      `, [adminId, reportId, JSON.stringify({ status, actionTaken })]);
      
      res.json({
        success: true,
        message: 'Signalement mis à jour',
        report: {
          id: result.rows[0].id,
          status: result.rows[0].status,
          assignedTo: result.rows[0].assigned_to,
          adminNotes: result.rows[0].admin_notes,
          actionTaken: result.rows[0].action_taken,
          updatedAt: result.rows[0].updated_at,
          resolvedAt: result.rows[0].resolved_at
        }
      });
      
    } catch (error) {
      logger.logError(error, { route: '/admin/reports/:reportId', adminId: req.admin?.user_id });
      res.status(500).json({ error: 'Erreur traitement signalement' });
    }
  }
);

// ============================================================================
// SURVEILLANCE DES MESSAGES
// ============================================================================

/**
 * GET /api/admin/messages/flagged
 * Récupérer les messages signalés automatiquement
 */
router.get('/messages/flagged',
  [
    query('minToxicity').optional().isFloat({ min: 0, max: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 })
  ],
  async (req, res) => {
    try {
      const { minToxicity = 0.3, limit = 50 } = req.query;
      
      const result = await db.query(`
        SELECT m.*, cs.session_id, u.username as sender_username
        FROM messages m
        JOIN chat_sessions cs ON m.session_id = cs.id
        LEFT JOIN users u ON m.sender_id = u.user_id
        WHERE m.auto_flagged = true 
        AND m.toxicity_score >= $1
        AND m.sent_at >= NOW() - INTERVAL '24 hours'
        ORDER BY m.toxicity_score DESC, m.sent_at DESC
        LIMIT $2
      `, [parseFloat(minToxicity), parseInt(limit)]);
      
      res.json({
        success: true,
        messages: result.rows.map(msg => ({
          id: msg.message_id,
          sessionId: msg.session_id,
          content: msg.content,
          sender: {
            id: msg.sender_id,
            username: msg.sender_username
          },
          toxicityScore: msg.toxicity_score,
          flagReasons: msg.auto_flag_reasons,
          containsPersonalInfo: msg.contains_personal_info,
          sentAt: msg.sent_at,
          isDeleted: msg.is_deleted
        }))
      });
      
    } catch (error) {
      logger.logError(error, { route: '/admin/messages/flagged', adminId: req.admin?.user_id });
      res.status(500).json({ error: 'Erreur récupération messages signalés' });
    }
  }
);

/**
 * POST /api/admin/messages/:messageId/delete
 * Supprimer un message
 */
router.post('/messages/:messageId/delete',
  [
    body('reason').notEmpty().isLength({ max: 200 }).withMessage('Raison requise')
  ],
  async (req, res) => {
    try {
      const { messageId } = req.params;
      const { reason } = req.body;
      const adminId = req.admin.user_id;
      
      // Marquer le message comme supprimé
      const result = await db.query(`
        UPDATE messages 
        SET is_deleted = true, deleted_by = $2, deleted_at = NOW()
        WHERE message_id = $1
        RETURNING *
      `, [messageId, adminId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Message non trouvé' });
      }
      
      // Logger l'action
      await db.query(`
        INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, action_details)
        VALUES ($1, 'delete_message', 'message', $2, $3, $4)
      `, [adminId, messageId, reason, JSON.stringify({ content: result.rows[0].content.substring(0, 50) })]);
      
      res.json({
        success: true,
        message: 'Message supprimé avec succès',
        deletedAt: new Date().toISOString()
      });
      
    } catch (error) {
      logger.logError(error, { route: '/admin/messages/:messageId/delete', adminId: req.admin?.user_id });
      res.status(500).json({ error: 'Erreur suppression message' });
    }
  }
);

// ============================================================================
// GESTION DES IP BANNIES
// ============================================================================

/**
 * GET /api/admin/banned-ips
 * Liste des IP bannies
 */
router.get('/banned-ips', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT bi.*, 
             COUNT(DISTINCT u.user_id) as affected_users
      FROM banned_ips bi
      LEFT JOIN users u ON u.ip_hash = bi.ip_hash
      WHERE bi.expires_at IS NULL OR bi.expires_at > NOW()
      GROUP BY bi.id
      ORDER BY bi.created_at DESC
      LIMIT 100
    `);
    
    res.json({
      success: true,
      bannedIPs: result.rows.map(ip => ({
        id: ip.id,
        ipHash: ip.ip_hash.substring(0, 16) + '...', // Masquer partiellement
        banType: ip.ban_type,
        reason: ip.reason,
        bannedBy: ip.banned_by,
        banCount: ip.ban_count,
        affectedUsers: parseInt(ip.affected_users),
        createdAt: ip.created_at,
        expiresAt: ip.expires_at
      }))
    });
    
  } catch (error) {
    logger.logError(error, { route: '/admin/banned-ips', adminId: req.admin?.user_id });
    res.status(500).json({ error: 'Erreur récupération IP bannies' });
  }
});

/**
 * POST /api/admin/banned-ips/:ipId/unban
 * Débannir une IP
 */
router.post('/banned-ips/:ipId/unban', async (req, res) => {
  try {
    const { ipId } = req.params;
    const adminId = req.admin.user_id;
    
    const result = await db.query(`
      DELETE FROM banned_ips 
      WHERE id = $1
      RETURNING ip_hash, reason
    `, [ipId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'IP non trouvée' });
    }
    
    // Logger l'action
    await db.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, action_details)
      VALUES ($1, 'unban_ip', 'ip', $2, $3)
    `, [adminId, result.rows[0].ip_hash, JSON.stringify({ previousReason: result.rows[0].reason })]);
    
    res.json({
      success: true,
      message: 'IP débannie avec succès'
    });
    
  } catch (error) {
    logger.logError(error, { route: '/admin/banned-ips/:ipId/unban', adminId: req.admin?.user_id });
    res.status(500).json({ error: 'Erreur débannissement IP' });
  }
});

module.exports = router;
