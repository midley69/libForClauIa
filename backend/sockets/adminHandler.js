// ============================================================================
// HANDLER SOCKET.IO POUR ADMINISTRATION
// Fichier : /var/www/libekoo/backend/sockets/adminHandler.js
// ============================================================================

const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');
const moderationService = require('../services/moderationService');
const analyticsService = require('../services/analyticsService');

// ============================================================================
// VÉRIFICATION DES PERMISSIONS ADMIN
// ============================================================================

/**
 * Vérifier si un utilisateur est administrateur
 */
async function verifyAdminPermissions(userId) {
  try {
    // Vérifier en base si l'utilisateur est admin
    const result = await db.query(`
      SELECT user_id, account_type, email
      FROM users 
      WHERE user_id = $1 
      AND (account_type = 'admin' OR email IN ($2, $3))
    `, [userId, 'admin@libekoo.me', 'moderateur@libekoo.me']);
    
    return result.rows.length > 0;
  } catch (error) {
    logger.logError(error, { function: 'verifyAdminPermissions', userId });
    return false;
  }
}

/**
 * Logger une action d'administration
 */
async function logAdminAction(adminId, action, targetType, targetId, details = {}, severity = 'info') {
  try {
    await db.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, action_details, severity)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [adminId, action, targetType, targetId, JSON.stringify(details), severity]);
    
    logger.logAdminAction(adminId, action, targetType, targetId, details);
  } catch (error) {
    logger.logError(error, { function: 'logAdminAction', adminId, action });
  }
}

// ============================================================================
// HANDLER PRINCIPAL
// ============================================================================

module.exports = (io, socket) => {
  
  // Vérifier les permissions admin au début
  let isAdmin = false;
  
  // Vérification asynchrone des permissions
  verifyAdminPermissions(socket.userId).then(result => {
    isAdmin = result;
    if (isAdmin) {
      socket.join('admin_room');
      logger.logUserActivity(socket.userId, 'admin_socket_connected');
    }
  });
  
  // Middleware de vérification pour tous les événements admin
  const requireAdmin = (callback) => {
    return (...args) => {
      const callbackFn = args[args.length - 1];
      
      if (!isAdmin) {
        if (typeof callbackFn === 'function') {
          callbackFn({ error: 'Permissions administrateur requises' });
        }
        return;
      }
      
      callback(...args);
    };
  };
  
  // ============================================================================
  // SURVEILLANCE TEMPS RÉEL
  // ============================================================================
  
  /**
   * Démarrer la surveillance temps réel
   */
  socket.on('admin:start_monitoring', requireAdmin(async (data, callback) => {
    try {
      const { monitoringType = 'all' } = data;
      const adminId = socket.userId;
      
      // Rejoindre les channels de monitoring appropriés
      if (monitoringType === 'all' || monitoringType === 'chat') {
        socket.join('admin_chat_monitoring');
      }
      if (monitoringType === 'all' || monitoringType === 'video') {
        socket.join('admin_video_monitoring');
      }
      if (monitoringType === 'all' || monitoringType === 'moderation') {
        socket.join('admin_moderation_monitoring');
      }
      
      await logAdminAction(adminId, 'start_monitoring', 'system', 'monitoring', { monitoringType });
      
      callback({ 
        success: true, 
        message: `Surveillance ${monitoringType} activée`,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      logger.logError(error, { event: 'admin:start_monitoring', userId: socket.userId });
      callback({ error: 'Erreur lors de l\'activation de la surveillance' });
    }
  }));
  
  /**
   * Arrêter la surveillance
   */
  socket.on('admin:stop_monitoring', requireAdmin(async (data, callback) => {
    try {
      const adminId = socket.userId;
      
      // Quitter tous les channels de monitoring
      socket.leave('admin_chat_monitoring');
      socket.leave('admin_video_monitoring');
      socket.leave('admin_moderation_monitoring');
      
      await logAdminAction(adminId, 'stop_monitoring', 'system', 'monitoring');
      
      callback({ success: true, message: 'Surveillance désactivée' });
      
    } catch (error) {
      logger.logError(error, { event: 'admin:stop_monitoring', userId: socket.userId });
      callback({ error: 'Erreur lors de la désactivation' });
    }
  }));
  
  /**
   * Obtenir les statistiques temps réel
   */
  socket.on('admin:get_live_stats', requireAdmin(async (data, callback) => {
    try {
      const [
        liveStats,
        queueStats,
        moderationStats,
        dbStats
      ] = await Promise.all([
        analyticsService.getRealTimeStats(),
        db.query(`
          SELECT 
            (SELECT COUNT(*) FROM users WHERE status = 'online') as online_users,
            (SELECT COUNT(*) FROM chat_sessions WHERE status = 'active') as active_chats,
            (SELECT COUNT(*) FROM video_sessions WHERE status = 'active') as active_videos,
            (SELECT COUNT(*) FROM moderation_reports WHERE status = 'pending') as pending_reports
        `),
        moderationService.getModerationStats(),
        db.query(`SELECT schemaname, tablename, n_tup_ins, n_tup_upd, n_tup_del 
                   FROM pg_stat_user_tables 
                   WHERE schemaname = 'public'
                   ORDER BY n_tup_ins DESC LIMIT 10`)
      ]);
      
      const currentStats = queueStats.rows[0];
      
      callback({
        success: true,
        stats: {
          realTime: liveStats.stats || {},
          current: {
            onlineUsers: parseInt(currentStats.online_users),
            activeChats: parseInt(currentStats.active_chats),
            activeVideos: parseInt(currentStats.active_videos),
            pendingReports: parseInt(currentStats.pending_reports)
          },
          moderation: moderationStats,
          database: {
            activity: dbStats.rows.map(row => ({
              table: row.tablename,
              inserts: parseInt(row.n_tup_ins),
              updates: parseInt(row.n_tup_upd),
              deletes: parseInt(row.n_tup_del)
            }))
          },
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (error) {
      logger.logError(error, { event: 'admin:get_live_stats', userId: socket.userId });
      callback({ error: 'Erreur lors de la récupération des statistiques' });
    }
  }));
  
  // ============================================================================
  // GESTION DES UTILISATEURS
  // ============================================================================
  
  /**
   * Rechercher des utilisateurs
   */
  socket.on('admin:search_users', requireAdmin(async (data, callback) => {
    try {
      const { query, filters = {}, limit = 50 } = data;
      const adminId = socket.userId;
      
      let searchQuery = `
        SELECT u.user_id, u.username, u.email, u.account_type, u.gender, 
               u.country, u.city, u.status, u.is_banned, u.ban_reason,
               u.created_at, u.last_active, u.points, u.level, u.stats
        FROM users u
        WHERE 1=1
      `;
      const params = [];
      let paramIndex = 1;
      
      // Recherche par texte
      if (query && query.trim()) {
        searchQuery += ` AND (
          u.username ILIKE $${paramIndex} OR 
          u.email ILIKE $${paramIndex} OR 
          u.user_id ILIKE $${paramIndex}
        )`;
        params.push(`%${query.trim()}%`);
        paramIndex++;
      }
      
      // Filtres
      if (filters.accountType) {
        searchQuery += ` AND u.account_type = $${paramIndex}`;
        params.push(filters.accountType);
        paramIndex++;
      }
      
      if (filters.status) {
        searchQuery += ` AND u.status = $${paramIndex}`;
        params.push(filters.status);
        paramIndex++;
      }
      
      if (filters.isBanned !== undefined) {
        searchQuery += ` AND u.is_banned = $${paramIndex}`;
        params.push(filters.isBanned);
        paramIndex++;
      }
      
      if (filters.country) {
        searchQuery += ` AND u.country = $${paramIndex}`;
        params.push(filters.country);
        paramIndex++;
      }
      
      searchQuery += ` ORDER BY u.last_active DESC LIMIT $${paramIndex}`;
      params.push(limit);
      
      const result = await db.query(searchQuery, params);
      
      await logAdminAction(adminId, 'search_users', 'user', 'search', { 
        query, 
        filters, 
        resultsCount: result.rows.length 
      });
      
      callback({
        success: true,
        users: result.rows.map(user => ({
          id: user.user_id,
          username: user.username,
          email: user.email,
          type: user.account_type,
          gender: user.gender,
          location: `${user.city}, ${user.country}`,
          status: user.status,
          isBanned: user.is_banned,
          banReason: user.ban_reason,
          points: user.points,
          level: user.level,
          stats: user.stats,
          createdAt: user.created_at,
          lastActive: user.last_active
        }))
      });
      
    } catch (error) {
      logger.logError(error, { event: 'admin:search_users', userId: socket.userId });
      callback({ error: 'Erreur lors de la recherche' });
    }
  }));
  
  /**
   * Bannir un utilisateur
   */
  socket.on('admin:ban_user', requireAdmin(async (data, callback) => {
    try {
      const { userId, reason, duration = 24, banType = 'temporary' } = data;
      const adminId = socket.userId;
      
      if (!userId || !reason) {
        return callback({ error: 'Données manquantes' });
      }
      
      const banDuration = banType === 'permanent' ? 8760 : duration; // 1 an pour permanent
      
      const success = await moderationService.banUser(userId, reason, banDuration, adminId);
      
      if (success) {
        // Déconnecter l'utilisateur s'il est en ligne
        const userSockets = await io.in(`user_${userId}`).fetchSockets();
        userSockets.forEach(userSocket => {
          userSocket.emit('user:banned', {
            reason,
            duration: banType,
            bannedBy: 'admin'
          });
          userSocket.disconnect(true);
        });
        
        await logAdminAction(adminId, 'ban_user', 'user', userId, { 
          reason, 
          duration: banDuration, 
          banType 
        }, 'warning');
        
        // Notifier les autres admins
        socket.to('admin_room').emit('admin:user_banned', {
          userId,
          reason,
          duration: banDuration,
          bannedBy: adminId,
          timestamp: new Date().toISOString()
        });
        
        callback({ 
          success: true, 
          message: `Utilisateur ${userId} banni avec succès` 
        });
      } else {
        callback({ error: 'Erreur lors du bannissement' });
      }
      
    } catch (error) {
      logger.logError(error, { event: 'admin:ban_user', userId: socket.userId });
      callback({ error: 'Erreur lors du bannissement' });
    }
  }));
  
  /**
   * Débannir un utilisateur
   */
  socket.on('admin:unban_user', requireAdmin(async (data, callback) => {
    try {
      const { userId } = data;
      const adminId = socket.userId;
      
      const success = await moderationService.unbanUser(userId, adminId);
      
      if (success) {
        await logAdminAction(adminId, 'unban_user', 'user', userId, {}, 'info');
        
        // Notifier les autres admins
        socket.to('admin_room').emit('admin:user_unbanned', {
          userId,
          unbannedBy: adminId,
          timestamp: new Date().toISOString()
        });
        
        callback({ 
          success: true, 
          message: `Utilisateur ${userId} débanni avec succès` 
        });
      } else {
        callback({ error: 'Erreur lors du débannissement' });
      }
      
    } catch (error) {
      logger.logError(error, { event: 'admin:unban_user', userId: socket.userId });
      callback({ error: 'Erreur lors du débannissement' });
    }
  }));
  
  // ============================================================================
  // GESTION DES SIGNALEMENTS
  // ============================================================================
  
  /**
   * Récupérer les signalements en attente
   */
  socket.on('admin:get_pending_reports', requireAdmin(async (data, callback) => {
    try {
      const { limit = 50, priority = 'all' } = data;
      
      let query = `
        SELECT mr.*, 
               u1.username as reporter_username,
               u2.username as reported_username
        FROM moderation_reports mr
        LEFT JOIN users u1 ON mr.reporter_id = u1.user_id
        LEFT JOIN users u2 ON mr.reported_user_id = u2.user_id
        WHERE mr.status = 'pending'
      `;
      
      const params = [];
      let paramIndex = 1;
      
      if (priority !== 'all') {
        query += ` AND mr.priority = $${paramIndex}`;
        params.push(priority);
        paramIndex++;
      }
      
      query += ` ORDER BY 
        CASE mr.priority 
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        mr.created_at DESC
        LIMIT $${paramIndex}`;
      params.push(limit);
      
      const result = await db.query(query, params);
      
      callback({
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
          priority: report.priority,
          evidence: report.evidence,
          createdAt: report.created_at
        }))
      });
      
    } catch (error) {
      logger.logError(error, { event: 'admin:get_pending_reports', userId: socket.userId });
      callback({ error: 'Erreur lors de la récupération des signalements' });
    }
  }));
  
  /**
   * Traiter un signalement
   */
  socket.on('admin:process_report', requireAdmin(async (data, callback) => {
    try {
      const { reportId, action, adminNotes } = data;
      const adminId = socket.userId;
      
      // Actions possibles: 'dismiss', 'warning', 'ban_user', 'delete_content'
      let actionTaken = '';
      
      switch (action) {
        case 'dismiss':
          actionTaken = 'Signalement rejeté';
          break;
        case 'warning':
          actionTaken = 'Avertissement envoyé';
          break;
        case 'ban_user':
          actionTaken = 'Utilisateur banni';
          break;
        case 'delete_content':
          actionTaken = 'Contenu supprimé';
          break;
        default:
          return callback({ error: 'Action invalide' });
      }
      
      // Mettre à jour le signalement
      await db.query(`
        UPDATE moderation_reports 
        SET status = 'resolved',
            assigned_to = $2,
            admin_notes = $3,
            action_taken = $4,
            resolved_at = NOW()
        WHERE id = $1
      `, [reportId, adminId, adminNotes, actionTaken]);
      
      await logAdminAction(adminId, 'process_report', 'report', reportId, { 
        action, 
        actionTaken, 
        adminNotes 
      });
      
      // Notifier les autres admins
      socket.to('admin_room').emit('admin:report_processed', {
        reportId,
        action: actionTaken,
        processedBy: adminId,
        timestamp: new Date().toISOString()
      });
      
      callback({ 
        success: true, 
        message: `Signalement traité: ${actionTaken}` 
      });
      
    } catch (error) {
      logger.logError(error, { event: 'admin:process_report', userId: socket.userId });
      callback({ error: 'Erreur lors du traitement du signalement' });
    }
  }));
  
  // ============================================================================
  // SURVEILLANCE DES CONVERSATIONS
  // ============================================================================
  
  /**
   * Récupérer les conversations actives à surveiller
   */
  socket.on('admin:get_active_conversations', requireAdmin(async (data, callback) => {
    try {
      const { limit = 20, flaggedOnly = false } = data;
      
      let query = `
        SELECT cs.session_id, cs.user1_username, cs.user2_username,
               cs.created_at, cs.message_count, cs.is_flagged,
               COUNT(m.id) as total_messages,
               AVG(m.toxicity_score) as avg_toxicity
        FROM chat_sessions cs
        LEFT JOIN messages m ON cs.id = m.session_id
        WHERE cs.status = 'active'
      `;
      
      if (flaggedOnly) {
        query += ` AND cs.is_flagged = true`;
      }
      
      query += `
        GROUP BY cs.id, cs.session_id, cs.user1_username, cs.user2_username,
                 cs.created_at, cs.message_count, cs.is_flagged
        ORDER BY avg_toxicity DESC NULLS LAST, cs.created_at DESC
        LIMIT $1
      `;
      
      const result = await db.query(query, [limit]);
      
      callback({
        success: true,
        conversations: result.rows.map(conv => ({
          sessionId: conv.session_id,
          participants: [conv.user1_username, conv.user2_username],
          startedAt: conv.created_at,
          messageCount: parseInt(conv.total_messages) || 0,
          averageToxicity: parseFloat(conv.avg_toxicity) || 0,
          isFlagged: conv.is_flagged,
          riskLevel: parseFloat(conv.avg_toxicity) > 0.5 ? 'high' : 
                     parseFloat(conv.avg_toxicity) > 0.3 ? 'medium' : 'low'
        }))
      });
      
    } catch (error) {
      logger.logError(error, { event: 'admin:get_active_conversations', userId: socket.userId });
      callback({ error: 'Erreur lors de la récupération des conversations' });
    }
  }));
  
  /**
   * Récupérer les messages d'une conversation
   */
  socket.on('admin:get_conversation_messages', requireAdmin(async (data, callback) => {
    try {
      const { sessionId, limit = 100 } = data;
      const adminId = socket.userId;
      
      const result = await db.query(`
        SELECT m.*, cs.session_id
        FROM messages m
        JOIN chat_sessions cs ON m.session_id = cs.id
        WHERE cs.session_id = $1
        ORDER BY m.sent_at DESC
        LIMIT $2
      `, [sessionId, limit]);
      
      await logAdminAction(adminId, 'view_conversation', 'session', sessionId);
      
      callback({
        success: true,
        sessionId,
        messages: result.rows.reverse().map(msg => ({
          id: msg.message_id,
          senderId: msg.sender_id,
          senderUsername: msg.sender_username,
          content: msg.content,
          type: msg.message_type,
          sentAt: msg.sent_at,
          toxicityScore: msg.toxicity_score,
          autoFlagged: msg.auto_flagged,
          flagReasons: msg.auto_flag_reasons,
          containsPersonalInfo: msg.contains_personal_info,
          isDeleted: msg.is_deleted
        }))
      });
      
    } catch (error) {
      logger.logError(error, { event: 'admin:get_conversation_messages', userId: socket.userId });
      callback({ error: 'Erreur lors de la récupération des messages' });
    }
  }));
  
  // ============================================================================
  // NETTOYAGE À LA DÉCONNEXION
  // ============================================================================
  
  socket.on('disconnect', async () => {
    try {
      if (isAdmin) {
        await logAdminAction(socket.userId, 'admin_disconnected', 'system', 'admin_session');
        logger.logUserActivity(socket.userId, 'admin_socket_disconnected');
      }
    } catch (error) {
      logger.logError(error, { event: 'disconnect', userId: socket.userId });
    }
  });
  
};
