// ============================================================================
// ROUTES DE CHAT ET MESSAGES
// Fichier : /var/www/libekoo/backend/routes/chat.js
// ============================================================================

const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');
const authMiddleware = require('../middleware/auth');
const moderationService = require('../services/moderationService');

const router = express.Router();

// Appliquer l'authentification à toutes les routes
router.use(authMiddleware);

// ============================================================================
// UTILITAIRES
// ============================================================================

/**
 * Analyser la toxicité d'un message
 */
async function analyzeToxicity(content) {
  // Implémentation simple de détection de toxicité
  // En production, utiliser une API comme Google Perspective API
  
  const toxicWords = [
    'connard', 'salope', 'putain', 'merde', 'con', 'idiot', 'imbécile',
    'nazi', 'raciste', 'terroriste', 'suicide', 'mourir', 'tuer'
  ];
  
  const personalInfoRegex = [
    /\b\d{10,}\b/, // Numéros de téléphone
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // Emails
    /\b\d{1,5}\s+\w+\s+(?:rue|avenue|boulevard|place)\b/i // Adresses
  ];
  
  const lowerContent = content.toLowerCase();
  let toxicityScore = 0;
  let containsPersonalInfo = false;
  const flagReasons = [];
  
  // Vérifier les mots toxiques
  for (const word of toxicWords) {
    if (lowerContent.includes(word)) {
      toxicityScore += 0.2;
      flagReasons.push(`Langage inapproprié: ${word}`);
    }
  }
  
  // Vérifier les informations personnelles
  for (const regex of personalInfoRegex) {
    if (regex.test(content)) {
      containsPersonalInfo = true;
      toxicityScore += 0.3;
      flagReasons.push('Informations personnelles détectées');
      break;
    }
  }
  
  // Vérifier les caractères répétés (spam)
  if (/(.)\1{4,}/.test(content)) {
    toxicityScore += 0.1;
    flagReasons.push('Caractères répétés (spam)');
  }
  
  // Vérifier les majuscules excessives
  if (content.length > 10 && content.replace(/[^A-Z]/g, '').length > content.length * 0.7) {
    toxicityScore += 0.1;
    flagReasons.push('Majuscules excessives');
  }
  
  return {
    toxicityScore: Math.min(toxicityScore, 1.0),
    containsPersonalInfo,
    autoFlagged: toxicityScore > 0.5,
    flagReasons
  };
}

/**
 * Formater un message pour la réponse
 */
function formatMessage(message, currentUserId) {
  return {
    id: message.message_id,
    sessionId: message.session_id,
    content: message.content,
    type: message.message_type,
    sender: {
      id: message.sender_id,
      username: message.sender_username,
      isOwn: message.sender_id === currentUserId
    },
    sentAt: message.sent_at,
    isEdited: message.is_edited,
    editedAt: message.edited_at
  };
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/chat/send-message
 * Envoyer un message dans une session
 */
router.post('/send-message',
  [
    body('sessionId')
      .notEmpty()
      .withMessage('ID de session requis'),
    body('content')
      .isLength({ min: 1, max: 1000 })
      .withMessage('Message invalide (1-1000 caractères)'),
    body('messageType')
      .optional()
      .isIn(['text', 'emoji', 'image', 'file'])
      .withMessage('Type de message invalide')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Données invalides',
          details: errors.array()
        });
      }
      
      const { sessionId, content, messageType = 'text', metadata = {} } = req.body;
      const userId = req.user.userId;
      const userIP = req.userIP;
      
      // Vérifier que la session existe et que l'utilisateur y participe
      const sessionResult = await db.query(`
        SELECT * FROM chat_sessions 
        WHERE session_id = $1 
        AND (user1_id = $2 OR user2_id = $2)
        AND status = 'active'
      `, [sessionId, userId]);
      
      if (sessionResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Session non trouvée ou inactive',
          code: 'SESSION_NOT_FOUND'
        });
      }
      
      const session = sessionResult.rows[0];
      
      // Rate limiting par utilisateur
      const rateLimitResult = await redisClient.checkRateLimit(
        `chat_messages:${userId}`, 
        60, // 60 messages
        60  // par minute
      );
      
      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          error: 'Limite de messages dépassée',
          code: 'RATE_LIMIT_EXCEEDED',
          resetTime: rateLimitResult.resetTime
        });
      }
      
      // Récupérer les informations utilisateur
      const userResult = await db.getUserById(userId);
      const user = userResult.rows[0];
      
      // Analyser la toxicité du message
      const toxicityAnalysis = await analyzeToxicity(content);
      
      // Bloquer automatiquement les messages très toxiques
      if (toxicityAnalysis.autoFlagged && toxicityAnalysis.toxicityScore > 0.8) {
        logger.logSecurityEvent('message_blocked_toxicity', {
          userId,
          sessionId,
          content: content.substring(0, 50),
          toxicityScore: toxicityAnalysis.toxicityScore
        });
        
        return res.status(400).json({
          error: 'Message non autorisé',
          code: 'MESSAGE_BLOCKED',
          reason: 'Contenu inapproprié détecté'
        });
      }
      
      // Générer ID unique pour le message
      const messageId = uuidv4();
      const ipHash = require('crypto').createHash('sha256')
        .update(userIP + process.env.IP_SALT || 'libekoo_salt')
        .digest('hex');
      
      // Insérer le message dans la base
      const messageData = {
        message_id: messageId,
        session_id: session.id,
        sender_id: userId,
        sender_username: user.username,
        content,
        message_type: messageType,
        sender_ip_hash: ipHash
      };
      
      const insertResult = await db.insertMessage(messageData);
      const insertedMessage = insertResult.rows[0];
      
      // Mettre à jour les informations de modération si nécessaire
      if (toxicityAnalysis.toxicityScore > 0) {
        await db.query(`
          UPDATE messages 
          SET toxicity_score = $2, contains_personal_info = $3, 
              auto_flagged = $4, auto_flag_reasons = $5
          WHERE id = $1
        `, [
          insertedMessage.id,
          toxicityAnalysis.toxicityScore,
          toxicityAnalysis.containsPersonalInfo,
          toxicityAnalysis.autoFlagged,
          JSON.stringify(toxicityAnalysis.flagReasons)
        ]);
      }
      
      // Mettre à jour le compteur de messages de la session
      await db.query(`
        UPDATE chat_sessions 
        SET message_count = message_count + 1, last_activity = NOW()
        WHERE id = $1
      `, [session.id]);
      
      // Mettre à jour les statistiques utilisateur
      await db.query(`
        UPDATE users 
        SET stats = jsonb_set(
          COALESCE(stats, '{}'), 
          '{total_messages}', 
          (COALESCE(stats->>'total_messages', '0')::int + 1)::text::jsonb
        ),
        updated_at = NOW()
        WHERE user_id = $1
      `, [userId]);
      
      // Logger le message pour modération
      logger.logChatMessage({
        message_id: messageId,
        session_id: sessionId,
        sender_id: userId,
        content: content,
        message_type: messageType,
        sender_ip_hash: ipHash,
        toxicity_score: toxicityAnalysis.toxicityScore
      });
      
      // Préparer la réponse
      const responseMessage = {
        id: messageId,
        sessionId: sessionId,
        content: content,
        type: messageType,
        sender: {
          id: userId,
          username: user.username,
          isOwn: true
        },
        sentAt: insertedMessage.sent_at,
        metadata: metadata
      };
      
      // Retourner la réponse (le Socket.io handler se chargera de la diffusion)
      res.json({
        success: true,
        message: responseMessage,
        toxicityWarning: toxicityAnalysis.autoFlagged ? 'Message signalé pour modération' : null
      });
      
    } catch (error) {
      logger.logError(error, { route: '/chat/send-message', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur envoi message',
        code: 'MESSAGE_SEND_ERROR'
      });
    }
  }
);

/**
 * GET /api/chat/session/:sessionId/messages
 * Récupérer l'historique des messages d'une session
 */
router.get('/session/:sessionId/messages',
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limite invalide (1-100)'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset invalide')
  ],
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      const userId = req.user.userId;
      
      // Vérifier que l'utilisateur a accès à cette session
      const sessionResult = await db.query(`
        SELECT * FROM chat_sessions 
        WHERE session_id = $1 
        AND (user1_id = $2 OR user2_id = $2)
      `, [sessionId, userId]);
      
      if (sessionResult.rows.length === 0) {
        return res.status(403).json({
          error: 'Accès refusé à cette session',
          code: 'SESSION_ACCESS_DENIED'
        });
      }
      
      // Récupérer les messages
      const messagesResult = await db.query(`
        SELECT m.*, cs.session_id
        FROM messages m
        JOIN chat_sessions cs ON m.session_id = cs.id
        WHERE cs.session_id = $1
        AND m.is_deleted = false
        ORDER BY m.sent_at DESC
        LIMIT $2 OFFSET $3
      `, [sessionId, parseInt(limit), parseInt(offset)]);
      
      const messages = messagesResult.rows
        .reverse() // Inverser pour avoir l'ordre chronologique
        .map(message => formatMessage(message, userId));
      
      res.json({
        success: true,
        messages,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: messages.length
        }
      });
      
    } catch (error) {
      logger.logError(error, { route: '/chat/session/messages', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur récupération messages',
        code: 'MESSAGES_FETCH_ERROR'
      });
    }
  }
);

/**
 * GET /api/chat/sessions
 * Récupérer les sessions de chat de l'utilisateur
 */
router.get('/sessions',
  [
    query('status')
      .optional()
      .isIn(['active', 'ended', 'all'])
      .withMessage('Statut invalide'),
    query('type')
      .optional()
      .isIn(['random', 'local', 'group', 'private', 'all'])
      .withMessage('Type invalide')
  ],
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { status = 'all', type = 'all', limit = 20, offset = 0 } = req.query;
      
      let whereClause = '(cs.user1_id = $1 OR cs.user2_id = $1)';
      let params = [userId];
      let paramIndex = 2;
      
      if (status !== 'all') {
        whereClause += ` AND cs.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }
      
      if (type !== 'all') {
        whereClause += ` AND cs.session_type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }
      
      const sessionsResult = await db.query(`
        SELECT cs.*, 
               CASE 
                 WHEN cs.user1_id = $1 THEN cs.user2_username 
                 ELSE cs.user1_username 
               END as partner_username,
               CASE 
                 WHEN cs.user1_id = $1 THEN cs.user2_id 
                 ELSE cs.user1_id 
               END as partner_id
        FROM chat_sessions cs
        WHERE ${whereClause}
        ORDER BY cs.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, [...params, parseInt(limit), parseInt(offset)]);
      
      const sessions = sessionsResult.rows.map(session => ({
        id: session.session_id,
        type: session.session_type,
        status: session.status,
        partner: {
          id: session.partner_id,
          username: session.partner_username
        },
        messageCount: session.message_count,
        duration: session.duration_seconds,
        createdAt: session.created_at,
        startedAt: session.started_at,
        endedAt: session.ended_at,
        lastActivity: session.last_activity
      }));
      
      res.json({
        success: true,
        sessions,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: sessions.length
        }
      });
      
    } catch (error) {
      logger.logError(error, { route: '/chat/sessions', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur récupération sessions',
        code: 'SESSIONS_FETCH_ERROR'
      });
    }
  }
);

/**
 * POST /api/chat/session/:sessionId/end
 * Terminer une session de chat
 */
router.post('/session/:sessionId/end',
  [
    body('rating')
      .optional()
      .isInt({ min: 1, max: 5 })
      .withMessage('Note invalide (1-5)'),
    body('reason')
      .optional()
      .isIn(['normal', 'timeout', 'inappropriate', 'technical'])
      .withMessage('Raison invalide')
  ],
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { rating, reason = 'normal' } = req.body;
      const userId = req.user.userId;
      
      // Vérifier que la session existe et appartient à l'utilisateur
      const sessionResult = await db.query(`
        SELECT * FROM chat_sessions 
        WHERE session_id = $1 
        AND (user1_id = $2 OR user2_id = $2)
        AND status = 'active'
      `, [sessionId, userId]);
      
      if (sessionResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Session non trouvée ou déjà terminée',
          code: 'SESSION_NOT_FOUND'
        });
      }
      
      const session = sessionResult.rows[0];
      
      // Calculer la durée de la session
      const startTime = new Date(session.started_at || session.created_at);
      const endTime = new Date();
      const durationSeconds = Math.floor((endTime - startTime) / 1000);
      
      // Déterminer quel utilisateur note
      const isUser1 = session.user1_id === userId;
      const ratingColumn = isUser1 ? 'rating_user1' : 'rating_user2';
      
      // Mettre à jour la session
      await db.query(`
        UPDATE chat_sessions 
        SET status = 'ended', 
            ended_at = NOW(), 
            duration_seconds = $2,
            ${ratingColumn} = $3
        WHERE id = $1
      `, [session.id, durationSeconds, rating || null]);
      
      // Mettre à jour les statistiques utilisateur
      await db.query(`
        UPDATE users 
        SET stats = jsonb_set(
          jsonb_set(
            COALESCE(stats, '{}'), 
            '{total_chats}', 
            (COALESCE(stats->>'total_chats', '0')::int + 1)::text::jsonb
          ),
          '{total_time_minutes}',
          (COALESCE(stats->>'total_time_minutes', '0')::int + $2)::text::jsonb
        )
        WHERE user_id = $1
      `, [userId, Math.floor(durationSeconds / 60)]);
      
      logger.logUserActivity(userId, 'chat_session_ended', {
        sessionId,
        duration: durationSeconds,
        rating,
        reason
      });
      
      res.json({
        success: true,
        message: 'Session terminée',
        session: {
          id: sessionId,
          duration: durationSeconds,
          endedAt: endTime.toISOString()
        }
      });
      
    } catch (error) {
      logger.logError(error, { route: '/chat/session/end', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur fin de session',
        code: 'SESSION_END_ERROR'
      });
    }
  }
);

/**
 * POST /api/chat/session/:sessionId/report
 * Signaler une session ou un message
 */
router.post('/session/:sessionId/report',
  [
    body('reportType')
      .isIn(['spam', 'harassment', 'inappropriate_content', 'fake_profile', 'other'])
      .withMessage('Type de signalement invalide'),
    body('targetType')
      .isIn(['session', 'message'])
      .withMessage('Type de cible invalide'),
    body('targetId')
      .optional()
      .notEmpty()
      .withMessage('ID cible requis pour les messages'),
    body('description')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Description trop longue')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Données invalides',
          details: errors.array()
        });
      }
      
      const { sessionId } = req.params;
      const { reportType, targetType, targetId, description } = req.body;
      const reporterId = req.user.userId;
      
      // Vérifier que la session existe et appartient à l'utilisateur
      const sessionResult = await db.query(`
        SELECT * FROM chat_sessions 
        WHERE session_id = $1 
        AND (user1_id = $2 OR user2_id = $2)
      `, [sessionId, reporterId]);
      
      if (sessionResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Session non trouvée',
          code: 'SESSION_NOT_FOUND'
        });
      }
      
      const session = sessionResult.rows[0];
      const reportedUserId = session.user1_id === reporterId ? session.user2_id : session.user1_id;
      
      // Si c'est un message, vérifier qu'il existe
      if (targetType === 'message' && targetId) {
        const messageResult = await db.query(`
          SELECT m.* FROM messages m
          JOIN chat_sessions cs ON m.session_id = cs.id
          WHERE m.message_id = $1 AND cs.session_id = $2
        `, [targetId, sessionId]);
        
        if (messageResult.rows.length === 0) {
          return res.status(404).json({
            error: 'Message non trouvé',
            code: 'MESSAGE_NOT_FOUND'
          });
        }
      }
      
      // Créer le signalement
      const reportId = uuidv4();
      await db.query(`
        INSERT INTO moderation_reports 
        (id, reporter_id, reported_user_id, target_type, target_id, report_type, description)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        reportId, 
        reporterId, 
        reportedUserId, 
        targetType, 
        targetId || sessionId,
        reportType, 
        description
      ]);
      
      logger.logUserActivity(reporterId, 'content_reported', {
        reportType,
        targetType,
        targetId: targetId || sessionId,
        reportedUserId
      });
      
      res.json({
        success: true,
        message: 'Signalement enregistré',
        reportId
      });
      
    } catch (error) {
      logger.logError(error, { route: '/chat/session/report', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur lors du signalement',
        code: 'REPORT_ERROR'
      });
    }
  }
);

/**
 * GET /api/chat/blocked-words
 * Récupérer la liste des mots bloqués (pour le filtre côté client)
 */
router.get('/blocked-words', async (req, res) => {
  try {
    // Liste basique des mots bloqués (côté client pour feedback immédiat)
    const blockedWords = [
      'spam', 'pub', 'publicité', 'promo', 'gratuit',
      'urgent', 'rapide', 'argent', 'euro', '€'
    ];
    
    res.json({
      success: true,
      blockedWords,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    logger.logError(error, { route: '/chat/blocked-words' });
    res.status(500).json({ 
      error: 'Erreur récupération mots bloqués',
      code: 'BLOCKED_WORDS_ERROR'
    });
  }
});

module.exports = router;
