// ============================================================================
// SERVICE DE MODÉRATION ET SÉCURITÉ
// Fichier : /var/www/libekoo/backend/services/moderationService.js
// ============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');

// ============================================================================
// CONSTANTES DE MODÉRATION
// ============================================================================

const MODERATION_CONFIG = {
  // Seuils d'auto-bannissement
  AUTO_BAN_THRESHOLDS: {
    REPORTS_24H: 5,        // 5 signalements en 24h
    TOXIC_MESSAGES_1H: 10, // 10 messages toxiques en 1h
    SPAM_MESSAGES_5MIN: 20 // 20 messages en 5 minutes
  },
  
  // Durées de bannissement
  BAN_DURATIONS: {
    TEMPORARY_HOURS: 24,
    REPEAT_OFFENDER_HOURS: 72,
    SEVERE_DAYS: 7
  },
  
  // Scores de toxicité
  TOXICITY_THRESHOLDS: {
    WARNING: 0.3,
    BLOCK: 0.7,
    AUTO_BAN: 0.9
  },
  
  // Mots et expressions surveillés
  MONITORED_KEYWORDS: [
    // Informations personnelles
    'téléphone', 'phone', 'numéro', 'whatsapp', 'telegram', 'instagram', 'snap',
    'adresse', 'address', 'email', 'mail', '@', 'contact',
    
    // Contenu inapproprié
    'nude', 'nue', 'sexe', 'sex', 'porn', 'cul', 'seins', 'penis',
    'rencontre', 'meet', 'cam', 'webcam', 'video call privé',
    
    // Spam/Commerce
    'gratuit', 'free', 'promo', 'pub', 'publicité', 'vendre', 'acheter',
    'argent', 'money', 'euro', '€', '$', 'bitcoin', 'crypto',
    
    // Langage toxique
    'connard', 'salope', 'putain', 'con', 'idiot', 'imbécile',
    'nazi', 'hitler', 'terroriste', 'raciste', 'pédé', 'pd'
  ],
  
  // Patterns regex dangereux
  DANGEROUS_PATTERNS: [
    /\b\d{10,}\b/g,                                    // Numéros de téléphone
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Emails
    /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/g, // URLs
    /\b(?:whatsapp|telegram|snap|insta|fb)\s*:?\s*\w+/gi, // Réseaux sociaux
  ]
};

// ============================================================================
// FONCTIONS UTILITAIRES
// ============================================================================

/**
 * Générer un hash sécurisé de l'IP
 */
function hashIP(ip) {
  return crypto.createHash('sha256')
    .update(ip + (process.env.IP_SALT || 'libekoo_salt'))
    .digest('hex');
}

/**
 * Analyser la toxicité avancée d'un message
 */
function analyzeToxicity(content, metadata = {}) {
  const lowerContent = content.toLowerCase();
  let toxicityScore = 0;
  const flagReasons = [];
  let containsPersonalInfo = false;
  
  // 1. Vérifier les mots-clés surveillés
  for (const keyword of MODERATION_CONFIG.MONITORED_KEYWORDS) {
    if (lowerContent.includes(keyword.toLowerCase())) {
      toxicityScore += 0.15;
      flagReasons.push(`Mot-clé surveillé: ${keyword}`);
      
      // Les infos personnelles augmentent plus le score
      if (['téléphone', 'phone', 'numéro', 'email', 'adresse'].includes(keyword.toLowerCase())) {
        toxicityScore += 0.2;
        containsPersonalInfo = true;
      }
    }
  }
  
  // 2. Vérifier les patterns dangereux
  for (const pattern of MODERATION_CONFIG.DANGEROUS_PATTERNS) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      toxicityScore += 0.3;
      containsPersonalInfo = true;
      flagReasons.push(`Pattern dangereux détecté: ${matches[0].substring(0, 20)}...`);
    }
  }
  
  // 3. Vérifier le spam (caractères répétés)
  if (/(.)\1{4,}/.test(content)) {
    toxicityScore += 0.2;
    flagReasons.push('Spam: caractères répétés');
  }
  
  // 4. Vérifier les majuscules excessives
  if (content.length > 10 && content.replace(/[^A-Z]/g, '').length > content.length * 0.7) {
    toxicityScore += 0.15;
    flagReasons.push('Majuscules excessives');
  }
  
  // 5. Vérifier la longueur excessive (potentiel spam)
  if (content.length > 500) {
    toxicityScore += 0.1;
    flagReasons.push('Message excessivement long');
  }
  
  // 6. Vérifier les caractères spéciaux excessifs
  const specialChars = content.match(/[^a-zA-Z0-9\s]/g);
  if (specialChars && specialChars.length > content.length * 0.3) {
    toxicityScore += 0.1;
    flagReasons.push('Caractères spéciaux excessifs');
  }
  
  // 7. Analyser le contexte si disponible
  if (metadata.isFirstMessage && (toxicityScore > 0.2 || containsPersonalInfo)) {
    toxicityScore += 0.2; // Premier message louche = plus suspect
    flagReasons.push('Premier message suspect');
  }
  
  return {
    toxicityScore: Math.min(toxicityScore, 1.0),
    containsPersonalInfo,
    autoFlagged: toxicityScore >= MODERATION_CONFIG.TOXICITY_THRESHOLDS.WARNING,
    autoBlocked: toxicityScore >= MODERATION_CONFIG.TOXICITY_THRESHOLDS.BLOCK,
    flagReasons,
    riskLevel: toxicityScore >= 0.7 ? 'high' : toxicityScore >= 0.4 ? 'medium' : 'low'
  };
}

/**
 * Vérifier si un utilisateur doit être auto-banni
 */
async function checkAutoBan(userId, ipHash) {
  try {
    const checks = await Promise.all([
      // Vérifier les signalements récents
      db.query(`
        SELECT COUNT(*) as count 
        FROM moderation_reports 
        WHERE reported_user_id = $1 
        AND created_at > NOW() - INTERVAL '24 hours'
      `, [userId]),
      
      // Vérifier les messages toxiques récents
      db.query(`
        SELECT COUNT(*) as count 
        FROM messages 
        WHERE sender_id = $1 
        AND sent_at > NOW() - INTERVAL '1 hour'
        AND toxicity_score >= $2
      `, [userId, MODERATION_CONFIG.TOXICITY_THRESHOLDS.BLOCK]),
      
      // Vérifier le spam récent
      db.query(`
        SELECT COUNT(*) as count 
        FROM messages 
        WHERE sender_id = $1 
        AND sent_at > NOW() - INTERVAL '5 minutes'
      `, [userId]),
      
      // Vérifier les bans précédents
      db.query(`
        SELECT COUNT(*) as count
        FROM admin_logs
        WHERE target_id = $1
        AND action = 'ban_user'
        AND created_at > NOW() - INTERVAL '30 days'
      `, [userId])
    ]);
    
    const recentReports = parseInt(checks[0].rows[0].count);
    const toxicMessages = parseInt(checks[1].rows[0].count);
    const recentMessages = parseInt(checks[2].rows[0].count);
    const previousBans = parseInt(checks[3].rows[0].count);
    
    let shouldBan = false;
    let banReason = '';
    let banDuration = MODERATION_CONFIG.BAN_DURATIONS.TEMPORARY_HOURS;
    
    // Trop de signalements
    if (recentReports >= MODERATION_CONFIG.AUTO_BAN_THRESHOLDS.REPORTS_24H) {
      shouldBan = true;
      banReason = `${recentReports} signalements en 24h`;
      banDuration = previousBans > 0 ? MODERATION_CONFIG.BAN_DURATIONS.REPEAT_OFFENDER_HOURS : MODERATION_CONFIG.BAN_DURATIONS.TEMPORARY_HOURS;
    }
    
    // Trop de messages toxiques
    if (toxicMessages >= MODERATION_CONFIG.AUTO_BAN_THRESHOLDS.TOXIC_MESSAGES_1H) {
      shouldBan = true;
      banReason = `${toxicMessages} messages toxiques en 1h`;
      banDuration = MODERATION_CONFIG.BAN_DURATIONS.REPEAT_OFFENDER_HOURS;
    }
    
    // Spam massif
    if (recentMessages >= MODERATION_CONFIG.AUTO_BAN_THRESHOLDS.SPAM_MESSAGES_5MIN) {
      shouldBan = true;
      banReason = `Spam: ${recentMessages} messages en 5 minutes`;
      banDuration = MODERATION_CONFIG.BAN_DURATIONS.TEMPORARY_HOURS;
    }
    
    // Récidiviste
    if (previousBans >= 3) {
      banDuration = MODERATION_CONFIG.BAN_DURATIONS.SEVERE_DAYS * 24; // Convertir en heures
    }
    
    return {
      shouldBan,
      banReason,
      banDuration,
      stats: {
        recentReports,
        toxicMessages,
        recentMessages,
        previousBans
      }
    };
    
  } catch (error) {
    logger.logError(error, { function: 'checkAutoban', userId });
    return { shouldBan: false };
  }
}

// ============================================================================
// FONCTIONS PRINCIPALES
// ============================================================================

/**
 * Vérifier si une IP est bannie
 */
async function checkBannedIP(ipHash) {
  try {
    const result = await db.checkBannedIP(ipHash);
    return result;
  } catch (error) {
    logger.logError(error, { function: 'checkBannedIP', ipHash: ipHash?.substring(0, 8) });
    return false;
  }
}

/**
 * Bannir une IP
 */
async function banIP(ipHash, reason, banDuration = 24, bannedBy = 'system') {
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + banDuration);
    
    await db.query(`
      INSERT INTO banned_ips (ip_hash, ban_type, reason, banned_by, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (ip_hash) DO UPDATE SET
        reason = $3,
        banned_by = $4,
        expires_at = $5,
        ban_count = banned_ips.ban_count + 1,
        updated_at = NOW()
    `, [
      ipHash,
      banDuration > 168 ? 'permanent' : 'temporary', // Plus de 7 jours = permanent
      reason,
      bannedBy,
      banDuration > 168 ? null : expiresAt
    ]);
    
    logger.logSecurityEvent('ip_banned', {
      ipHash: ipHash.substring(0, 8),
      reason,
      duration: banDuration,
      bannedBy
    }, 'warning');
    
    return true;
  } catch (error) {
    logger.logError(error, { function: 'banIP', ipHash: ipHash?.substring(0, 8) });
    return false;
  }
}

/**
 * Bannir un utilisateur
 */
async function banUser(userId, reason, banDuration = 24, bannedBy = 'system') {
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + banDuration);
    
    // Mettre à jour l'utilisateur
    await db.query(`
      UPDATE users 
      SET is_banned = true, 
          ban_reason = $2, 
          ban_expires_at = $3,
          status = 'offline',
          updated_at = NOW()
      WHERE user_id = $1
    `, [userId, reason, banDuration > 168 ? null : expiresAt]);
    
    // Logger l'action admin
    await db.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, action_details)
      VALUES ($1, 'ban_user', 'user', $2, $3, $4)
    `, [
      bannedBy,
      userId,
      reason,
      JSON.stringify({
        duration_hours: banDuration,
        expires_at: expiresAt.toISOString(),
        auto_ban: bannedBy === 'system'
      })
    ]);
    
    // Supprimer les sessions actives
    await redisClient.deleteUserSession(userId);
    await redisClient.deleteCache(`searching:${userId}`);
    
    // Terminer les chats actifs
    await db.query(`
      UPDATE chat_sessions 
      SET status = 'ended', ended_at = NOW()
      WHERE (user1_id = $1 OR user2_id = $1) AND status = 'active'
    `, [userId]);
    
    logger.logSecurityEvent('user_banned', {
      userId,
      reason,
      duration: banDuration,
      bannedBy
    }, 'warning');
    
    return true;
  } catch (error) {
    logger.logError(error, { function: 'banUser', userId });
    return false;
  }
}

/**
 * Débannir un utilisateur
 */
async function unbanUser(userId, unbannedBy = 'admin') {
  try {
    await db.query(`
      UPDATE users 
      SET is_banned = false, 
          ban_reason = NULL, 
          ban_expires_at = NULL,
          updated_at = NOW()
      WHERE user_id = $1
    `, [userId]);
    
    // Logger l'action
    await db.query(`
      INSERT INTO admin_logs (admin_id, action, target_type, target_id, action_details)
      VALUES ($1, 'unban_user', 'user', $2, $3)
    `, [
      unbannedBy,
      userId,
      JSON.stringify({ unbanned_at: new Date().toISOString() })
    ]);
    
    logger.logSecurityEvent('user_unbanned', { userId, unbannedBy }, 'info');
    
    return true;
  } catch (error) {
    logger.logError(error, { function: 'unbanUser', userId });
    return false;
  }
}

/**
 * Modérer un message automatiquement
 */
async function moderateMessage(messageData, userMetadata = {}) {
  try {
    const { message_id, sender_id, content, sender_ip_hash } = messageData;
    
    // Analyser la toxicité
    const analysis = analyzeToxicity(content, userMetadata);
    
    // Mettre à jour le message avec les résultats de modération
    await db.query(`
      UPDATE messages 
      SET toxicity_score = $2,
          contains_personal_info = $3,
          auto_flagged = $4,
          auto_flag_reasons = $5
      WHERE message_id = $1
    `, [
      message_id,
      analysis.toxicityScore,
      analysis.containsPersonalInfo,
      analysis.autoFlagged,
      JSON.stringify(analysis.flagReasons)
    ]);
    
    // Si le message est automatiquement bloqué
    if (analysis.autoBlocked) {
      // Marquer comme supprimé
      await db.query(`
        UPDATE messages 
        SET is_deleted = true, deleted_by = 'auto_moderation', deleted_at = NOW()
        WHERE message_id = $1
      `, [message_id]);
      
      logger.logSecurityEvent('message_auto_deleted', {
        messageId: message_id,
        senderId: sender_id,
        toxicityScore: analysis.toxicityScore,
        reasons: analysis.flagReasons
      });
    }
    
    // Vérifier si l'utilisateur doit être auto-banni
    const banCheck = await checkAutoban(sender_id, sender_ip_hash);
    if (banCheck.shouldBan) {
      await banUser(sender_id, banCheck.banReason, banCheck.banDuration, 'system');
      
      // Bannir aussi l'IP si c'est un cas sévère
      if (analysis.toxicityScore >= 0.8) {
        await banIP(sender_ip_hash, 'Messages toxiques répétés', 48, 'system');
      }
    }
    
    return {
      ...analysis,
      messageBlocked: analysis.autoBlocked,
      userBanned: banCheck.shouldBan,
      banReason: banCheck.banReason
    };
    
  } catch (error) {
    logger.logError(error, { function: 'moderateMessage', messageId: messageData.message_id });
    return { error: true };
  }
}

/**
 * Créer un signalement
 */
async function createReport(reportData) {
  try {
    const {
      reporterId,
      reportedUserId,
      targetType,
      targetId,
      reportType,
      description,
      evidence = {}
    } = reportData;
    
    // Vérifier les signalements en double récents
    const duplicateCheck = await db.query(`
      SELECT id FROM moderation_reports 
      WHERE reporter_id = $1 
      AND target_type = $2 
      AND target_id = $3
      AND created_at > NOW() - INTERVAL '1 hour'
    `, [reporterId, targetType, targetId]);
    
    if (duplicateCheck.rows.length > 0) {
      return { success: false, reason: 'Signalement déjà effectué récemment' };
    }
    
    // Déterminer la priorité automatiquement
    let priority = 'normal';
    if (reportType === 'underage' || reportType === 'harassment') {
      priority = 'high';
    } else if (reportType === 'inappropriate_content') {
      priority = 'medium';
    }
    
    // Créer le signalement
    const reportId = require('uuid').v4();
    await db.query(`
      INSERT INTO moderation_reports 
      (id, reporter_id, reported_user_id, target_type, target_id, report_type, description, priority, evidence)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      reportId,
      reporterId,
      reportedUserId,
      targetType,
      targetId,
      reportType,
      description,
      priority,
      JSON.stringify(evidence)
    ]);
    
    // Incrémenter les compteurs
    await db.query(`
      UPDATE users 
      SET stats = jsonb_set(
        COALESCE(stats, '{}'), 
        '{reports_received}', 
        (COALESCE(stats->>'reports_received', '0')::int + 1)::text::jsonb
      )
      WHERE user_id = $1
    `, [reportedUserId]);
    
    logger.logSecurityEvent('report_created', {
      reportId,
      reporterId,
      reportedUserId,
      reportType,
      priority
    });
    
    return { success: true, reportId, priority };
    
  } catch (error) {
    logger.logError(error, { function: 'createReport', reporterId: reportData.reporterId });
    return { success: false, reason: 'Erreur système' };
  }
}

/**
 * Nettoyer les bans expirés
 */
async function cleanupExpiredBans() {
  try {
    // Nettoyer les utilisateurs
    const userCleanup = await db.query(`
      UPDATE users 
      SET is_banned = false, ban_reason = NULL, ban_expires_at = NULL
      WHERE is_banned = true 
      AND ban_expires_at IS NOT NULL 
      AND ban_expires_at <= NOW()
      RETURNING user_id
    `);
    
    // Nettoyer les IPs
    const ipCleanup = await db.query(`
      DELETE FROM banned_ips 
      WHERE expires_at IS NOT NULL 
      AND expires_at <= NOW()
      RETURNING ip_hash
    `);
    
    if (userCleanup.rows.length > 0 || ipCleanup.rows.length > 0) {
      logger.info(`Nettoyage bans expirés: ${userCleanup.rows.length} utilisateurs, ${ipCleanup.rows.length} IPs`);
    }
    
    return {
      usersUnbanned: userCleanup.rows.length,
      ipsUnbanned: ipCleanup.rows.length
    };
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupExpiredBans' });
    return { usersUnbanned: 0, ipsUnbanned: 0 };
  }
}

/**
 * Obtenir les statistiques de modération
 */
async function getModerationStats() {
  try {
    const stats = await Promise.all([
      // Signalements par statut
      db.query(`
        SELECT status, COUNT(*) as count 
        FROM moderation_reports 
        GROUP BY status
      `),
      
      // Signalements par type
      db.query(`
        SELECT report_type, COUNT(*) as count 
        FROM moderation_reports 
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY report_type
        ORDER BY count DESC
      `),
      
      // Utilisateurs bannis
      db.query(`
        SELECT COUNT(*) as count 
        FROM users 
        WHERE is_banned = true
      `),
      
      // Messages flaggés aujourd'hui
      db.query(`
        SELECT COUNT(*) as count 
        FROM messages 
        WHERE auto_flagged = true 
        AND sent_at >= CURRENT_DATE
      `),
      
      // IPs bannies actives
      db.query(`
        SELECT COUNT(*) as count 
        FROM banned_ips 
        WHERE expires_at IS NULL OR expires_at > NOW()
      `)
    ]);
    
    return {
      reportsByStatus: Object.fromEntries(
        stats[0].rows.map(row => [row.status, parseInt(row.count)])
      ),
      reportsByType: Object.fromEntries(
        stats[1].rows.map(row => [row.report_type, parseInt(row.count)])
      ),
      bannedUsers: parseInt(stats[2].rows[0].count),
      flaggedMessagesToday: parseInt(stats[3].rows[0].count),
      bannedIPs: parseInt(stats[4].rows[0].count)
    };
    
  } catch (error) {
    logger.logError(error, { function: 'getModerationStats' });
    return {};
  }
}

// ============================================================================
// EXPORT DU MODULE
// ============================================================================

module.exports = {
  // Fonctions principales
  checkBannedIP,
  banIP,
  banUser,
  unbanUser,
  moderateMessage,
  createReport,
  
  // Fonctions d'analyse
  analyzeToxicity,
  checkAutoban,
  
  // Maintenance
  cleanupExpiredBans,
  getModerationStats,
  
  // Utilitaires
  hashIP,
  
  // Configuration
  MODERATION_CONFIG
};
