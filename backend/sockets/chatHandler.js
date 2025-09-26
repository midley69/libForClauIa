// ============================================================================
// HANDLER SOCKET.IO POUR CHAT TEMPS RÉEL
// Fichier : /var/www/libekoo/backend/sockets/chatHandler.js
// ============================================================================

const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');
const moderationService = require('../services/moderationService');
const matchingService = require('../services/matchingService');

// ============================================================================
// UTILITAIRES
// ============================================================================

/**
 * Vérifier si un utilisateur participe à une session
 */
async function verifySessionParticipant(sessionId, userId) {
  try {
    const result = await db.query(`
      SELECT * FROM chat_sessions 
      WHERE session_id = $1 
      AND (user1_id = $2 OR user2_id = $2)
    `, [sessionId, userId]);
    
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    logger.logError(error, { function: 'verifySessionParticipant', sessionId, userId });
    return null;
  }
}

/**
 * Obtenir l'ID du partenaire dans une session
 */
function getPartnerId(session, userId) {
  return session.user1_id === userId ? session.user2_id : session.user1_id;
}

/**
 * Formatter un message pour l'envoi Socket.io
 */
function formatSocketMessage(message, isOwn = false) {
  return {
    id: message.message_id,
    sessionId: message.session_id,
    content: message.content,
    type: message.message_type || 'text',
    sender: {
      id: message.sender_id,
      username: message.sender_username,
      isOwn
    },
    sentAt: message.sent_at,
    metadata: message.metadata || {}
  };
}

// ============================================================================
// HANDLER PRINCIPAL
// ============================================================================

module.exports = (io, socket) => {
  
  // ============================================================================
  // GESTION DES CONNEXIONS
  // ============================================================================
  
  /**
   * Rejoindre une session de chat
   */
  socket.on('chat:join_session', async (data, callback) => {
    try {
      const { sessionId } = data;
      const userId = socket.userId;
      
      if (!sessionId) {
        return callback({ error: 'ID de session manquant' });
      }
      
      // Vérifier que l'utilisateur peut rejoindre cette session
      const session = await verifySessionParticipant(sessionId, userId);
      if (!session) {
        return callback({ error: 'Session non trouvée ou accès refusé' });
      }
      
      // Rejoindre la room Socket.io
      socket.join(`chat_session:${sessionId}`);
      
      // Mettre à jour la présence
      await redisClient.setUserPresence(userId, socket.id, {
        currentSession: sessionId,
        joinedAt: Date.now(),
        status: 'chatting'
      });
      
      // Notifier le partenaire de la connexion
      const partnerId = getPartnerId(session, userId);
      socket.to(`user_${partnerId}`).emit('chat:partner_connected', {
        sessionId,
        partnerId: userId,
        timestamp: new Date().toISOString()
      });
      
      logger.logUserActivity(userId, 'chat_session_joined', { sessionId });
      
      callback({ 
        success: true, 
        sessionId,
        session: {
          id: session.session_id,
          type: session.session_type,
          createdAt: session.created_at,
          partner: {
            id: partnerId,
            username: session.user1_id === userId ? session.user2_username : session.user1_username
          }
        }
      });
      
    } catch (error) {
      logger.logError(error, { event: 'chat:join_session', userId: socket.userId });
      callback({ error: 'Erreur lors de la connexion à la session' });
    }
  });
  
  /**
   * Quitter une session de chat
   */
  socket.on('chat:leave_session', async (data, callback) => {
    try {
      const { sessionId } = data;
      const userId = socket.userId;
      
      // Vérifier la session
      const session = await verifySessionParticipant(sessionId, userId);
      if (!session) {
        return callback({ error: 'Session non trouvée' });
      }
      
      // Quitter la room Socket.io
      socket.leave(`chat_session:${sessionId}`);
      
      // Nettoyer la présence
      await redisClient.removeUserPresence(userId);
      
      // Notifier le partenaire de la déconnexion
      const partnerId = getPartnerId(session, userId);
      socket.to(`user_${partnerId}`).emit('chat:partner_disconnected', {
        sessionId,
        partnerId: userId,
        timestamp: new Date().toISOString()
      });
      
      logger.logUserActivity(userId, 'chat_session_left', { sessionId });
      
      callback({ success: true });
      
    } catch (error) {
      logger.logError(error, { event: 'chat:leave_session', userId: socket.userId });
      callback({ error: 'Erreur lors de la déconnexion' });
    }
  });
  
  // ============================================================================
  // ENVOI ET RÉCEPTION DE MESSAGES
  // ============================================================================
  
  /**
   * Envoyer un message dans une session
   */
  socket.on('chat:send_message', async (data, callback) => {
    try {
      const { sessionId, content, messageType = 'text', metadata = {} } = data;
      const userId = socket.userId;
      const userIP = socket.userIP;
      
      // Validation des données
      if (!sessionId || !content || content.length === 0) {
        return callback({ error: 'Données du message invalides' });
      }
      
      if (content.length > 1000) {
        return callback({ error: 'Message trop long (1000 caractères max)' });
      }
      
      // Vérifier la session
      const session = await verifySessionParticipant(sessionId, userId);
      if (!session || session.status !== 'active') {
        return callback({ error: 'Session inactive ou non trouvée' });
      }
      
      // Rate limiting par utilisateur
      const rateLimitResult = await redisClient.checkRateLimit(
        `chat_messages:${userId}`, 
        60, // 60 messages
        60  // par minute
      );
      
      if (!rateLimitResult.allowed) {
        return callback({ 
          error: 'Limite de messages dépassée',
          resetTime: rateLimitResult.resetTime
        });
      }
      
      // Récupérer les informations utilisateur
      const userResult = await db.getUserById(userId);
      if (userResult.rows.length === 0) {
        return callback({ error: 'Utilisateur non trouvé' });
      }
      
      const user = userResult.rows[0];
      const ipHash = moderationService.hashIP(userIP);
      
      // Analyser la toxicité du message
      const isFirstMessage = session.message_count === 0;
      const moderationResult = await moderationService.moderateMessage({
        message_id: uuidv4(),
        session_id: session.id,
        sender_id: userId,
        sender_username: user.username,
        content,
        message_type: messageType,
        sender_ip_hash: ipHash
      }, { isFirstMessage });
      
      // Si le message est bloqué
      if (moderationResult.messageBlocked) {
        return callback({ 
          error: 'Message bloqué par la modération',
          reason: 'Contenu inapproprié détecté'
        });
      }
      
      // Si l'utilisateur a été banni
      if (moderationResult.userBanned) {
        // Déconnecter le socket
        socket.emit('user:banned', {
          reason: moderationResult.banReason,
          duration: 'temporaire'
        });
        socket.disconnect(true);
        return;
      }
      
      // Générer l'ID du message
      const messageId = uuidv4();
      
      // Insérer le message en base
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
      
      // Mettre à jour la session
      await db.query(`
        UPDATE chat_sessions 
        SET message_count = message_count + 1, 
            last_activity = NOW()
        WHERE id = $1
      `, [session.id]);
      
      // Mettre à jour les stats utilisateur
      await db.query(`
        UPDATE users 
        SET stats = jsonb_set(
          COALESCE(stats, '{}'), 
          '{total_messages}', 
          (COALESCE(stats->>'total_messages', '0')::int + 1)::text::jsonb
        )
        WHERE user_id = $1
      `, [userId]);
      
      // Formatter le message pour l'envoi
      const formattedMessage = formatSocketMessage({
        message_id: messageId,
        session_id: sessionId,
        sender_id: userId,
        sender_username: user.username,
        content,
        message_type: messageType,
        sent_at: insertedMessage.sent_at,
        metadata
      });
      
      // Envoyer le message à tous les participants de la session
      io.to(`chat_session:${sessionId}`).emit('chat:new_message', {
        ...formattedMessage,
        sender: {
          ...formattedMessage.sender,
          isOwn: false // Sera ajusté côté client
        }
      });
      
      // Logger le message pour modération
      logger.logChatMessage({
        message_id: messageId,
        session_id: sessionId,
        sender_id: userId,
        content: content,
        message_type: messageType,
        sender_ip_hash: ipHash,
        toxicity_score: moderationResult.toxicityScore || 0
      });
      
      callback({ 
        success: true, 
        message: {
          ...formattedMessage,
          sender: { ...formattedMessage.sender, isOwn: true }
        },
        warnings: moderationResult.autoFlagged ? ['Message signalé pour modération'] : []
      });
      
    } catch (error) {
      logger.logError(error, { event: 'chat:send_message', userId: socket.userId });
      callback({ error: 'Erreur lors de l\'envoi du message' });
    }
  });
  
  /**
   * Signaler que l'utilisateur est en train de taper
   */
  socket.on('chat:typing', async (data) => {
    try {
      const { sessionId, isTyping } = data;
      const userId = socket.userId;
      
      // Vérifier la session
      const session = await verifySessionParticipant(sessionId, userId);
      if (!session) return;
      
      // Notifier le partenaire
      const partnerId = getPartnerId(session, userId);
      socket.to(`user_${partnerId}`).emit('chat:partner_typing', {
        sessionId,
        partnerId: userId,
        isTyping,
        timestamp: Date.now()
      });
      
    } catch (error) {
      logger.logError(error, { event: 'chat:typing', userId: socket.userId });
    }
  });
  
  // ============================================================================
  // GESTION DES SESSIONS
  // ============================================================================
  
  /**
   * Terminer une session de chat
   */
  socket.on('chat:end_session', async (data, callback) => {
    try {
      const { sessionId, rating, reason = 'normal' } = data;
      const userId = socket.userId;
      
      // Vérifier la session
      const session = await verifySessionParticipant(sessionId, userId);
      if (!session) {
        return callback({ error: 'Session non trouvée' });
      }
      
      // Calculer la durée
      const startTime = new Date(session.started_at || session.created_at);
      const endTime = new Date();
      const durationSeconds = Math.floor((endTime - startTime) / 1000);
      
      // Déterminer quelle colonne de rating utiliser
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
      
      // Mettre à jour les stats utilisateur
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
      
      // Nettoyer les présences
      await redisClient.removeUserPresence(userId);
      
      // Notifier le partenaire
      const partnerId = getPartnerId(session, userId);
      socket.to(`user_${partnerId}`).emit('chat:session_ended', {
        sessionId,
        endedBy: userId,
        duration: durationSeconds,
        timestamp: endTime.toISOString()
      });
      
      // Faire quitter tous les participants de la room
      io.to(`chat_session:${sessionId}`).socketsLeave(`chat_session:${sessionId}`);
      
      logger.logUserActivity(userId, 'chat_session_ended', {
        sessionId,
        duration: durationSeconds,
        rating,
        reason
      });
      
      callback({ 
        success: true, 
        session: {
          id: sessionId,
          duration: durationSeconds,
          endedAt: endTime.toISOString()
        }
      });
      
    } catch (error) {
      logger.logError(error, { event: 'chat:end_session', userId: socket.userId });
      callback({ error: 'Erreur lors de la fin de session' });
    }
  });
  
  /**
   * Changer de partenaire (next)
   */
  socket.on('chat:next_partner', async (data, callback) => {
    try {
      const { currentSessionId } = data;
      const userId = socket.userId;
      
      // Terminer la session actuelle si elle existe
      if (currentSessionId) {
        const session = await verifySessionParticipant(currentSessionId, userId);
        if (session && session.status === 'active') {
          await db.query(`
            UPDATE chat_sessions 
            SET status = 'ended', ended_at = NOW()
            WHERE id = $1
          `, [session.id]);
          
          // Notifier le partenaire
          const partnerId = getPartnerId(session, userId);
          socket.to(`user_${partnerId}`).emit('chat:partner_left', {
            sessionId: currentSessionId,
            timestamp: new Date().toISOString()
          });
          
          socket.leave(`chat_session:${currentSessionId}`);
        }
      }
      
      // Démarrer une nouvelle recherche
      const userResult = await db.getUserById(userId);
      if (userResult.rows.length === 0) {
        return callback({ error: 'Utilisateur non trouvé' });
      }
      
      const user = userResult.rows[0];
      
      // Récupérer la localisation
      const locationResult = await db.query(
        'SELECT * FROM user_locations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      
      const location = locationResult.rows[0];
      
      // Données pour le matching
      const matchingData = {
        userId: user.user_id,
        username: user.username,
        gender: user.gender,
        country: user.country,
        city: user.city,
        latitude: location?.latitude,
        longitude: location?.longitude,
        matchType: 'random', // Par défaut
        preferences: user.preferences?.matching || {},
        joinedAt: Date.now()
      };
      
      // Rechercher immédiatement un partenaire
      const matchResult = await matchingService.findPartner(matchingData);
      
      if (matchResult.success && matchResult.partner) {
        // Match trouvé
        callback({
          success: true,
          matched: true,
          session: matchResult.session,
          partner: {
            id: matchResult.partner.userId,
            username: matchResult.partner.username,
            gender: matchResult.partner.gender,
            location: {
              country: matchResult.partner.country,
              city: matchResult.partner.city
            }
          }
        });
      } else {
        // Ajouter à la file d'attente
        await redisClient.addToMatchingQueue(userId, matchingData);
        
        callback({
          success: true,
          matched: false,
          message: 'Recherche d\'un nouveau partenaire...',
          queuePosition: await matchingService.getQueuePosition(userId, 'random')
        });
      }
      
      logger.logUserActivity(userId, 'next_partner_requested', { previousSession: currentSessionId });
      
    } catch (error) {
      logger.logError(error, { event: 'chat:next_partner', userId: socket.userId });
      callback({ error: 'Erreur lors du changement de partenaire' });
    }
  });
  
  // ============================================================================
  // GESTION DES SIGNALEMENTS
  // ============================================================================
  
  /**
   * Signaler un message ou un utilisateur
   */
  socket.on('chat:report', async (data, callback) => {
    try {
      const { sessionId, targetType, targetId, reportType, description } = data;
      const reporterId = socket.userId;
      
      // Vérifier la session
      const session = await verifySessionParticipant(sessionId, reporterId);
      if (!session) {
        return callback({ error: 'Session non trouvée' });
      }
      
      const reportedUserId = getPartnerId(session, reporterId);
      
      // Créer le signalement
      const reportResult = await moderationService.createReport({
        reporterId,
        reportedUserId,
        targetType,
        targetId: targetId || sessionId,
        reportType,
        description,
        evidence: {
          sessionId,
          timestamp: new Date().toISOString(),
          reporterIP: socket.userIP
        }
      });
      
      if (reportResult.success) {
        callback({ 
          success: true, 
          reportId: reportResult.reportId,
          message: 'Signalement enregistré, merci' 
        });
        
        logger.logUserActivity(reporterId, 'content_reported', {
          reportId: reportResult.reportId,
          targetType,
          reportType,
          sessionId
        });
      } else {
        callback({ error: reportResult.reason });
      }
      
    } catch (error) {
      logger.logError(error, { event: 'chat:report', userId: socket.userId });
      callback({ error: 'Erreur lors du signalement' });
    }
  });
  
  // ============================================================================
  // NETTOYAGE À LA DÉCONNEXION
  // ============================================================================
  
  socket.on('disconnect', async () => {
    try {
      const userId = socket.userId;
      
      if (userId) {
        // Nettoyer la présence
        await redisClient.removeUserPresence(userId);
        
        // Retirer des files d'attente
        await Promise.all([
          redisClient.removeFromMatchingQueue(userId, 'random'),
          redisClient.removeFromMatchingQueue(userId, 'local'),
          redisClient.removeFromMatchingQueue(userId, 'group')
        ]);
        
        // Notifier les partenaires dans les sessions actives
        const activeSessions = await db.query(`
          SELECT session_id, user1_id, user2_id FROM chat_sessions 
          WHERE (user1_id = $1 OR user2_id = $1) AND status = 'active'
        `, [userId]);
        
        for (const session of activeSessions.rows) {
          const partnerId = getPartnerId(session, userId);
          socket.to(`user_${partnerId}`).emit('chat:partner_disconnected', {
            sessionId: session.session_id,
            partnerId: userId,
            timestamp: new Date().toISOString(),
            reason: 'disconnect'
          });
        }
        
        logger.logUserActivity(userId, 'chat_socket_disconnected');
      }
      
    } catch (error) {
      logger.logError(error, { event: 'disconnect', userId: socket.userId });
    }
  });
  
};
