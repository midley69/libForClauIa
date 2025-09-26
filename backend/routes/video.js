// ============================================================================
// ROUTES POUR APPELS VIDÉO
// Fichier : /var/www/libekoo/backend/routes/video.js
// ============================================================================

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Appliquer l'authentification à toutes les routes
router.use(authMiddleware);

// ============================================================================
// CONFIGURATION WEBRTC
// ============================================================================

const WEBRTC_CONFIG = {
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  MAX_PARTICIPANTS: 4,
  SESSION_TIMEOUT: 60 * 60 * 1000 // 1 heure
};

// ============================================================================
// UTILITAIRES
// ============================================================================

/**
 * Générer un ID de room unique
 */
function generateRoomId() {
  return `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Vérifier les permissions d'accès à une room
 */
async function checkRoomAccess(roomId, userId) {
  try {
    // Vérifier en base de données
    const result = await db.query(`
      SELECT vs.*, 
             (vs.participants::jsonb @> $2::jsonb) as is_participant
      FROM video_sessions vs
      WHERE vs.room_id = $1
    `, [roomId, JSON.stringify([{ userId }])]);
    
    if (result.rows.length === 0) {
      return { allowed: false, reason: 'Room non trouvée' };
    }
    
    const session = result.rows[0];
    
    // Vérifier si l'utilisateur est autorisé
    const participants = session.participants || [];
    const isParticipant = participants.some(p => p.userId === userId);
    
    if (!isParticipant && participants.length >= WEBRTC_CONFIG.MAX_PARTICIPANTS) {
      return { allowed: false, reason: 'Room pleine' };
    }
    
    if (session.status === 'ended') {
      return { allowed: false, reason: 'Session terminée' };
    }
    
    return { allowed: true, session };
    
  } catch (error) {
    logger.logError(error, { function: 'checkRoomAccess', roomId, userId });
    return { allowed: false, reason: 'Erreur système' };
  }
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/video/create-room
 * Créer une nouvelle room vidéo
 */
router.post('/create-room',
  [
    body('roomType').optional().isIn(['private', 'group', 'random']).withMessage('Type de room invalide'),
    body('maxParticipants').optional().isInt({ min: 2, max: 4 }).withMessage('Nombre de participants invalide'),
    body('settings').optional().isObject().withMessage('Paramètres invalides')
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
      
      const {
        roomType = 'group',
        maxParticipants = 4,
        settings = {}
      } = req.body;
      
      const userId = req.user.userId;
      
      // Récupérer les informations utilisateur
      const userResult = await db.getUserById(userId);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }
      
      const user = userResult.rows[0];
      const roomId = generateRoomId();
      const sessionId = uuidv4();
      
      // Créer la session vidéo en base
      const insertResult = await db.query(`
        INSERT INTO video_sessions (
          id, session_id, room_id, 
          participants, max_participants,
          webrtc_config, ice_servers,
          status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING *
      `, [
        uuidv4(),
        sessionId,
        roomId,
        JSON.stringify([{
          userId: user.user_id,
          username: user.username,
          role: 'creator',
          joinedAt: new Date().toISOString(),
          mediaState: {
            audio: settings.audioEnabled !== false,
            video: settings.videoEnabled !== false,
            screen: false
          }
        }]),
        Math.min(maxParticipants, WEBRTC_CONFIG.MAX_PARTICIPANTS),
        JSON.stringify({
          roomType,
          ...settings
        }),
        JSON.stringify(WEBRTC_CONFIG.ICE_SERVERS),
        'waiting'
      ]);
      
      // Stocker l'état de la room dans Redis
      await redisClient.setVideoRoomState(roomId, {
        roomId,
        sessionId,
        type: roomType,
        status: 'waiting',
        creator: userId,
        participants: [{
          userId: user.user_id,
          username: user.username,
          role: 'creator',
          joinedAt: Date.now(),
          mediaState: {
            audio: settings.audioEnabled !== false,
            video: settings.videoEnabled !== false,
            screen: false
          }
        }],
        currentParticipants: 1,
        maxParticipants: Math.min(maxParticipants, WEBRTC_CONFIG.MAX_PARTICIPANTS),
        settings: {
          audioEnabled: settings.audioEnabled !== false,
          videoEnabled: settings.videoEnabled !== false,
          screenSharingEnabled: settings.screenSharingEnabled === true
        },
        createdAt: Date.now()
      });
      
      logger.logUserActivity(userId, 'video_room_created', {
        roomId,
        sessionId,
        roomType
      });
      
      res.status(201).json({
        success: true,
        room: {
          id: roomId,
          sessionId,
          type: roomType,
          creator: userId,
          status: 'waiting',
          participants: 1,
          maxParticipants: Math.min(maxParticipants, WEBRTC_CONFIG.MAX_PARTICIPANTS),
          settings: {
            audioEnabled: settings.audioEnabled !== false,
            videoEnabled: settings.videoEnabled !== false,
            screenSharingEnabled: settings.screenSharingEnabled === true
          },
          webrtcConfig: {
            iceServers: WEBRTC_CONFIG.ICE_SERVERS
          },
          createdAt: insertResult.rows[0].created_at
        }
      });
      
    } catch (error) {
      logger.logError(error, { route: '/video/create-room', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur lors de la création de la room',
        code: 'ROOM_CREATION_ERROR'
      });
    }
  }
);

/**
 * GET /api/video/room/:roomId
 * Récupérer les informations d'une room
 */
router.get('/room/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.userId;
    
    // Vérifier l'accès à la room
    const accessCheck = await checkRoomAccess(roomId, userId);
    if (!accessCheck.allowed) {
      return res.status(403).json({
        error: accessCheck.reason,
        code: 'ROOM_ACCESS_DENIED'
      });
    }
    
    // Récupérer l'état de la room depuis Redis
    const roomState = await redisClient.getVideoRoomState(roomId);
    
    if (!roomState) {
      // Si pas en Redis, reconstruire depuis la base
      const session = accessCheck.session;
      const participants = session.participants || [];
      
      const roomData = {
        id: roomId,
        sessionId: session.session_id,
        type: session.webrtc_config?.roomType || 'group',
        status: session.status,
        creator: participants.find(p => p.role === 'creator')?.userId,
        participants: participants.map(p => ({
          userId: p.userId,
          username: p.username,
          role: p.role,
          joinedAt: p.joinedAt,
          mediaState: p.mediaState || { audio: true, video: true, screen: false },
          isOwn: p.userId === userId
        })),
        maxParticipants: session.max_participants,
        settings: session.webrtc_config || {},
        webrtcConfig: {
          iceServers: session.ice_servers || WEBRTC_CONFIG.ICE_SERVERS
        },
        createdAt: session.created_at
      };
      
      res.json({
        success: true,
        room: roomData
      });
      
    } else {
      // Données depuis Redis
      res.json({
        success: true,
        room: {
          id: roomState.roomId,
          sessionId: roomState.sessionId,
          type: roomState.type,
          status: roomState.status,
          creator: roomState.creator,
          participants: roomState.participants.map(p => ({
            ...p,
            isOwn: p.userId === userId
          })),
          maxParticipants: roomState.maxParticipants,
          settings: roomState.settings,
          webrtcConfig: {
            iceServers: WEBRTC_CONFIG.ICE_SERVERS
          },
          createdAt: new Date(roomState.createdAt).toISOString()
        }
      });
    }
    
    logger.logUserActivity(userId, 'video_room_viewed', { roomId });
    
  } catch (error) {
    logger.logError(error, { route: '/video/room/:roomId', userId: req.user?.userId });
    res.status(500).json({ 
      error: 'Erreur récupération room',
      code: 'ROOM_FETCH_ERROR'
    });
  }
});

/**
 * POST /api/video/room/:roomId/join
 * Rejoindre une room vidéo
 */
router.post('/room/:roomId/join', async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.userId;
    
    // Vérifier l'accès à la room
    const accessCheck = await checkRoomAccess(roomId, userId);
    if (!accessCheck.allowed) {
      return res.status(403).json({
        error: accessCheck.reason,
        code: 'ROOM_ACCESS_DENIED'
      });
    }
    
    // Récupérer les informations utilisateur
    const userResult = await db.getUserById(userId);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    const user = userResult.rows[0];
    
    // Récupérer l'état actuel de la room
    let roomState = await redisClient.getVideoRoomState(roomId);
    
    if (!roomState) {
      // Recréer l'état depuis la base de données
      const session = accessCheck.session;
      roomState = {
        roomId,
        sessionId: session.session_id,
        participants: session.participants || [],
        status: session.status,
        maxParticipants: session.max_participants
      };
    }
    
    // Vérifier si l'utilisateur n'est pas déjà dans la room
    const existingParticipant = roomState.participants.find(p => p.userId === userId);
    
    if (!existingParticipant) {
      // Ajouter le nouveau participant
      const newParticipant = {
        userId: user.user_id,
        username: user.username,
        role: 'participant',
        joinedAt: Date.now(),
        mediaState: {
          audio: true,
          video: true,
          screen: false
        }
      };
      
      roomState.participants.push(newParticipant);
      roomState.currentParticipants = roomState.participants.length;
      
      // Si c'est le deuxième participant, démarrer l'appel
      if (roomState.participants.length === 2 && roomState.status === 'waiting') {
        roomState.status = 'active';
        
        // Mettre à jour en base de données
        await db.query(`
          UPDATE video_sessions 
          SET status = 'active', 
              started_at = NOW(),
              participants = $2
          WHERE room_id = $1
        `, [roomId, JSON.stringify(roomState.participants)]);
      }
      
      // Sauvegarder l'état mis à jour
      await redisClient.setVideoRoomState(roomId, roomState);
    }
    
    logger.logUserActivity(userId, 'video_room_joined', { roomId });
    
    res.json({
      success: true,
      message: 'Room rejointe avec succès',
      room: {
        id: roomId,
        status: roomState.status,
        participants: roomState.participants.map(p => ({
          ...p,
          isOwn: p.userId === userId
        })),
        webrtcConfig: {
          iceServers: WEBRTC_CONFIG.ICE_SERVERS
        }
      }
    });
    
  } catch (error) {
    logger.logError(error, { route: '/video/room/:roomId/join', userId: req.user?.userId });
    res.status(500).json({ 
      error: 'Erreur lors de la connexion à la room',
      code: 'ROOM_JOIN_ERROR'
    });
  }
});

/**
 * POST /api/video/room/:roomId/leave
 * Quitter une room vidéo
 */
router.post('/room/:roomId/leave', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { rating } = req.body;
    const userId = req.user.userId;
    
    // Récupérer l'état de la room
    const roomState = await redisClient.getVideoRoomState(roomId);
    
    if (roomState) {
      // Retirer l'utilisateur de la liste des participants
      roomState.participants = roomState.participants.filter(p => p.userId !== userId);
      roomState.currentParticipants = roomState.participants.length;
      
      if (roomState.participants.length === 0) {
        // Plus personne dans la room, la terminer
        await db.query(`
          UPDATE video_sessions 
          SET status = 'ended', 
              ended_at = NOW(),
              duration_seconds = EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at)))
          WHERE room_id = $1
        `, [roomId]);
        
        // Supprimer de Redis
        await redisClient.client.del(`video_room:${roomId}`);
        
      } else {
        // Mettre à jour l'état
        await redisClient.setVideoRoomState(roomId, roomState);
        
        // Mettre à jour en base
        await db.query(`
          UPDATE video_sessions 
          SET participants = $2
          WHERE room_id = $1
        `, [roomId, JSON.stringify(roomState.participants)]);
      }
    }
    
    // Enregistrer la note si fournie
    if (rating && rating >= 1 && rating <= 5) {
      await db.query(`
        UPDATE video_sessions 
        SET total_ratings = total_ratings + 1,
            average_rating = (COALESCE(average_rating * (total_ratings - 1), 0) + $2) / total_ratings
        WHERE room_id = $1
      `, [roomId, rating]);
    }
    
    logger.logUserActivity(userId, 'video_room_left', { roomId, rating });
    
    res.json({
      success: true,
      message: 'Room quittée avec succès'
    });
    
  } catch (error) {
    logger.logError(error, { route: '/video/room/:roomId/leave', userId: req.user?.userId });
    res.status(500).json({ 
      error: 'Erreur lors de la déconnexion',
      code: 'ROOM_LEAVE_ERROR'
    });
  }
});

/**
 * GET /api/video/sessions
 * Récupérer l'historique des sessions vidéo de l'utilisateur
 */
router.get('/sessions',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limite invalide'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset invalide')
  ],
  async (req, res) => {
    try {
      const { limit = 20, offset = 0 } = req.query;
      const userId = req.user.userId;
      
      const result = await db.query(`
        SELECT vs.*
        FROM video_sessions vs
        WHERE vs.participants::jsonb @> $1::jsonb
        ORDER BY vs.created_at DESC
        LIMIT $2 OFFSET $3
      `, [
        JSON.stringify([{ userId }]),
        parseInt(limit),
        parseInt(offset)
      ]);
      
      const sessions = result.rows.map(session => {
        const participants = session.participants || [];
        const userParticipant = participants.find(p => p.userId === userId);
        
        return {
          id: session.session_id,
          roomId: session.room_id,
          status: session.status,
          participants: participants.map(p => ({
            userId: p.userId,
            username: p.username,
            role: p.role,
            isOwn: p.userId === userId
          })),
          duration: session.duration_seconds,
          averageRating: session.average_rating,
          createdAt: session.created_at,
          startedAt: session.started_at,
          endedAt: session.ended_at,
          userRole: userParticipant?.role || 'participant'
        };
      });
      
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
      logger.logError(error, { route: '/video/sessions', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur récupération sessions',
        code: 'SESSIONS_FETCH_ERROR'
      });
    }
  }
);

/**
 * POST /api/video/room/:roomId/report-quality
 * Signaler des problèmes de qualité
 */
router.post('/room/:roomId/report-quality',
  [
    body('qualityIssues').isArray().withMessage('Liste des problèmes requise'),
    body('connectionStats').optional().isObject().withMessage('Statistiques invalides')
  ],
  async (req, res) => {
    try {
      const { roomId } = req.params;
      const { qualityIssues, connectionStats = {} } = req.body;
      const userId = req.user.userId;
      
      // Vérifier l'accès à la room
      const accessCheck = await checkRoomAccess(roomId, userId);
      if (!accessCheck.allowed) {
        return res.status(403).json({ error: 'Accès refusé à cette room' });
      }
      
      // Enregistrer le rapport de qualité
      await db.query(`
        UPDATE video_sessions 
        SET quality_metrics = jsonb_set(
          COALESCE(quality_metrics, '{}'),
          $2,
          $3
        )
        WHERE room_id = $1
      `, [
        roomId,
        `{${userId}}`,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          qualityIssues,
          connectionStats,
          reportedBy: userId
        })
      ]);
      
      logger.logUserActivity(userId, 'video_quality_reported', {
        roomId,
        qualityIssues,
        connectionStats
      });
      
      res.json({
        success: true,
        message: 'Rapport de qualité enregistré'
      });
      
    } catch (error) {
      logger.logError(error, { route: '/video/room/:roomId/report-quality', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur signalement qualité',
        code: 'QUALITY_REPORT_ERROR'
      });
    }
  }
);

/**
 * GET /api/video/webrtc-config
 * Récupérer la configuration WebRTC
 */
router.get('/webrtc-config', async (req, res) => {
  try {
    res.json({
      success: true,
      config: {
        iceServers: WEBRTC_CONFIG.ICE_SERVERS,
        maxParticipants: WEBRTC_CONFIG.MAX_PARTICIPANTS,
        sessionTimeout: WEBRTC_CONFIG.SESSION_TIMEOUT,
        mediaConstraints: {
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: {
            width: { min: 320, ideal: 640, max: 1280 },
            height: { min: 240, ideal: 480, max: 720 },
            frameRate: { min: 15, ideal: 24, max: 30 }
          }
        }
      }
    });
    
  } catch (error) {
    logger.logError(error, { route: '/video/webrtc-config' });
    res.status(500).json({ 
      error: 'Erreur récupération configuration',
      code: 'CONFIG_FETCH_ERROR'
    });
  }
});

/**
 * DELETE /api/video/room/:roomId
 * Supprimer/terminer une room (créateur seulement)
 */
router.delete('/room/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.userId;
    
    // Vérifier que l'utilisateur est le créateur
    const roomState = await redisClient.getVideoRoomState(roomId);
    
    if (!roomState || roomState.creator !== userId) {
      return res.status(403).json({
        error: 'Seul le créateur peut supprimer la room',
        code: 'UNAUTHORIZED_ROOM_DELETION'
      });
    }
    
    // Terminer la session en base
    await db.query(`
      UPDATE video_sessions 
      SET status = 'ended', 
          ended_at = NOW(),
          duration_seconds = EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at)))
      WHERE room_id = $1
    `, [roomId]);
    
    // Supprimer de Redis
    await redisClient.client.del(`video_room:${roomId}`);
    
    logger.logUserActivity(userId, 'video_room_deleted', { roomId });
    
    res.json({
      success: true,
      message: 'Room supprimée avec succès'
    });
    
  } catch (error) {
    logger.logError(error, { route: '/video/room/:roomId DELETE', userId: req.user?.userId });
    res.status(500).json({ 
      error: 'Erreur suppression room',
      code: 'ROOM_DELETION_ERROR'
    });
  }
});

module.exports = router;
