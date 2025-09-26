// ============================================================================
// HANDLER SOCKET.IO POUR APPELS VIDÉO WEBRTC
// Fichier : /var/www/libekoo/backend/sockets/videoHandler.js
// ============================================================================

const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');

// ============================================================================
// CONFIGURATION WEBRTC
// ============================================================================

const WEBRTC_CONFIG = {
  // Serveurs STUN/TURN publics (à remplacer par vos propres serveurs en production)
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  
  // Configuration des médias par défaut
  DEFAULT_MEDIA_CONSTRAINTS: {
    audio: true,
    video: {
      width: { min: 320, ideal: 640, max: 1280 },
      height: { min: 240, ideal: 480, max: 720 },
      frameRate: { min: 15, ideal: 24, max: 30 }
    }
  },
  
  // Limites des sessions
  MAX_PARTICIPANTS_PER_ROOM: 4,
  SESSION_TIMEOUT_MINUTES: 60
};

// ============================================================================
// UTILITAIRES
// ============================================================================

/**
 * Générer un ID de room vidéo unique
 */
function generateRoomId() {
  return `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Vérifier si un utilisateur peut rejoindre une room
 */
async function canJoinRoom(roomId, userId) {
  try {
    const roomState = await redisClient.getVideoRoomState(roomId);
    
    if (!roomState) {
      return { allowed: false, reason: 'Room non trouvée' };
    }
    
    // Vérifier si l'utilisateur est déjà dans la room
    if (roomState.participants.some(p => p.userId === userId)) {
      return { allowed: true, reason: 'Utilisateur déjà dans la room' };
    }
    
    // Vérifier la limite de participants
    if (roomState.participants.length >= WEBRTC_CONFIG.MAX_PARTICIPANTS_PER_ROOM) {
      return { allowed: false, reason: 'Room pleine' };
    }
    
    return { allowed: true };
    
  } catch (error) {
    logger.logError(error, { function: 'canJoinRoom', roomId, userId });
    return { allowed: false, reason: 'Erreur système' };
  }
}

/**
 * Mettre à jour l'état d'une room
 */
async function updateRoomState(roomId, updates) {
  try {
    const currentState = await redisClient.getVideoRoomState(roomId) || {
      roomId,
      participants: [],
      status: 'waiting',
      createdAt: Date.now(),
      settings: {
        audioEnabled: true,
        videoEnabled: true,
        screenSharingEnabled: false
      }
    };
    
    const newState = { ...currentState, ...updates, updatedAt: Date.now() };
    await redisClient.setVideoRoomState(roomId, newState);
    
    return newState;
    
  } catch (error) {
    logger.logError(error, { function: 'updateRoomState', roomId });
    return null;
  }
}

/**
 * Nettoyer une room (supprimer les participants déconnectés)
 */
async function cleanupRoom(roomId, io) {
  try {
    const roomState = await redisClient.getVideoRoomState(roomId);
    if (!roomState) return;
    
    // Vérifier quels sockets sont encore connectés
    const room = io.sockets.adapter.rooms.get(`video_room:${roomId}`);
    const activeSockets = room ? Array.from(room) : [];
    
    // Filtrer les participants actifs
    const activeParticipants = roomState.participants.filter(participant => 
      activeSockets.includes(participant.socketId)
    );
    
    if (activeParticipants.length === 0) {
      // Plus personne dans la room, la supprimer
      await redisClient.client.del(`video_room:${roomId}`);
      
      // Mettre à jour la session en base
      await db.query(`
        UPDATE video_sessions 
        SET status = 'ended', ended_at = NOW()
        WHERE room_id = $1 AND status = 'active'
      `, [roomId]);
      
      logger.info(`Room vidéo nettoyée: ${roomId}`);
      return null;
      
    } else if (activeParticipants.length !== roomState.participants.length) {
      // Mettre à jour avec les participants actifs
      const updatedState = await updateRoomState(roomId, {
        participants: activeParticipants,
        currentParticipants: activeParticipants.length
      });
      
      // Notifier les participants restants
      io.to(`video_room:${roomId}`).emit('video:participants_updated', {
        roomId,
        participants: updatedState.participants.map(p => ({
          userId: p.userId,
          username: p.username,
          joinedAt: p.joinedAt,
          mediaState: p.mediaState
        }))
      });
      
      return updatedState;
    }
    
    return roomState;
    
  } catch (error) {
    logger.logError(error, { function: 'cleanupRoom', roomId });
    return null;
  }
}

// ============================================================================
// HANDLER PRINCIPAL
// ============================================================================

module.exports = (io, socket) => {
  
  // ============================================================================
  // CRÉATION ET GESTION DES ROOMS
  // ============================================================================
  
  /**
   * Créer une nouvelle room vidéo
   */
  socket.on('video:create_room', async (data, callback) => {
    try {
      const { roomType = 'group', maxParticipants = 4, mediaSettings = {} } = data;
      const userId = socket.userId;
      
      // Récupérer les informations utilisateur
      const userResult = await db.getUserById(userId);
      if (userResult.rows.length === 0) {
        return callback({ error: 'Utilisateur non trouvé' });
      }
      
      const user = userResult.rows[0];
      const roomId = generateRoomId();
      
      // Créer la session en base de données
      await db.query(`
        INSERT INTO video_sessions (
          session_id, room_id, participants, max_participants, 
          webrtc_config, ice_servers, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        uuidv4(),
        roomId,
        JSON.stringify([{
          userId: user.user_id,
          username: user.username,
          role: 'creator'
        }]),
        Math.min(maxParticipants, WEBRTC_CONFIG.MAX_PARTICIPANTS_PER_ROOM),
        JSON.stringify(mediaSettings),
        JSON.stringify(WEBRTC_CONFIG.ICE_SERVERS),
        'waiting'
      ]);
      
      // Créer l'état de la room dans Redis
      const roomState = await updateRoomState(roomId, {
        roomId,
        type: roomType,
        status: 'waiting',
        creator: userId,
        participants: [{
          userId: user.user_id,
          username: user.username,
          socketId: socket.id,
          role: 'creator',
          joinedAt: Date.now(),
          mediaState: {
            audio: mediaSettings.audioEnabled !== false,
            video: mediaSettings.videoEnabled !== false,
            screen: false
          }
        }],
        currentParticipants: 1,
        maxParticipants: Math.min(maxParticipants, WEBRTC_CONFIG.MAX_PARTICIPANTS_PER_ROOM),
        settings: {
          audioEnabled: mediaSettings.audioEnabled !== false,
          videoEnabled: mediaSettings.videoEnabled !== false,
          screenSharingEnabled: mediaSettings.screenSharingEnabled === true
        }
      });
      
      // Rejoindre la room Socket.io
      socket.join(`video_room:${roomId}`);
      
      // Mettre à jour la présence utilisateur
      await redisClient.setUserPresence(userId, socket.id, {
        currentVideoRoom: roomId,
        status: 'video_call'
      });
      
      logger.logUserActivity(userId, 'video_room_created', { roomId, roomType });
      
      callback({
        success: true,
        room: {
          id: roomId,
          type: roomType,
          creator: userId,
          participants: roomState.participants.length,
          maxParticipants: roomState.maxParticipants,
          iceServers: WEBRTC_CONFIG.ICE_SERVERS
        }
      });
      
    } catch (error) {
      logger.logError(error, { event: 'video:create_room', userId: socket.userId });
      callback({ error: 'Erreur lors de la création de la room' });
    }
  });
  
  /**
   * Rejoindre une room vidéo existante
   */
  socket.on('video:join_room', async (data, callback) => {
    try {
      const { roomId } = data;
      const userId = socket.userId;
      
      if (!roomId) {
        return callback({ error: 'ID de room manquant' });
      }
      
      // Vérifier si l'utilisateur peut rejoindre
      const canJoin = await canJoinRoom(roomId, userId);
      if (!canJoin.allowed) {
        return callback({ error: canJoin.reason });
      }
      
      // Récupérer les informations utilisateur
      const userResult = await db.getUserById(userId);
      if (userResult.rows.length === 0) {
        return callback({ error: 'Utilisateur non trouvé' });
      }
      
      const user = userResult.rows[0];
      
      // Rejoindre la room Socket.io
      socket.join(`video_room:${roomId}`);
      
      // Mettre à jour l'état de la room
      const roomState = await redisClient.getVideoRoomState(roomId);
      
      // Vérifier si l'utilisateur n'est pas déjà dans la room
      const existingParticipant = roomState.participants.find(p => p.userId === userId);
      
      if (!existingParticipant) {
        // Ajouter le nouveau participant
        const newParticipant = {
          userId: user.user_id,
          username: user.username,
          socketId: socket.id,
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
          
          // Mettre à jour la session en base
          await db.query(`
            UPDATE video_sessions 
            SET status = 'active', started_at = NOW(), participants = $2
            WHERE room_id = $1
          `, [roomId, JSON.stringify(roomState.participants)]);
        }
        
        await updateRoomState(roomId, roomState);
        
        // Notifier les autres participants
        socket.to(`video_room:${roomId}`).emit('video:participant_joined', {
          roomId,
          participant: {
            userId: user.user_id,
            username: user.username,
            joinedAt: newParticipant.joinedAt,
            mediaState: newParticipant.mediaState
          }
        });
      } else {
        // Mettre à jour le socket ID du participant existant
        existingParticipant.socketId = socket.id;
        await updateRoomState(roomId, roomState);
      }
      
      // Mettre à jour la présence utilisateur
      await redisClient.setUserPresence(userId, socket.id, {
        currentVideoRoom: roomId,
        status: 'video_call'
      });
      
      logger.logUserActivity(userId, 'video_room_joined', { roomId });
      
      callback({
        success: true,
        room: {
          id: roomId,
          status: roomState.status,
          participants: roomState.participants.map(p => ({
            userId: p.userId,
            username: p.username,
            joinedAt: p.joinedAt,
            mediaState: p.mediaState,
            isOwn: p.userId === userId
          })),
          settings: roomState.settings,
          iceServers: WEBRTC_CONFIG.ICE_SERVERS
        }
      });
      
    } catch (error) {
      logger.logError(error, { event: 'video:join_room', userId: socket.userId });
      callback({ error: 'Erreur lors de la connexion à la room' });
    }
  });
  
  /**
   * Quitter une room vidéo
   */
  socket.on('video:leave_room', async (data, callback) => {
    try {
      const { roomId } = data;
      const userId = socket.userId;
      
      // Quitter la room Socket.io
      socket.leave(`video_room:${roomId}`);
      
      // Nettoyer la présence utilisateur
      await redisClient.removeUserPresence(userId);
      
      // Notifier les autres participants
      socket.to(`video_room:${roomId}`).emit('video:participant_left', {
        roomId,
        participantId: userId,
        timestamp: Date.now()
      });
      
      // Nettoyer la room
      await cleanupRoom(roomId, io);
      
      logger.logUserActivity(userId, 'video_room_left', { roomId });
      
      callback({ success: true });
      
    } catch (error) {
      logger.logError(error, { event: 'video:leave_room', userId: socket.userId });
      callback({ error: 'Erreur lors de la déconnexion' });
    }
  });
  
  // ============================================================================
  // SIGNALING WEBRTC
  // ============================================================================
  
  /**
   * Offre WebRTC
   */
  socket.on('video:offer', async (data) => {
    try {
      const { roomId, targetUserId, offer } = data;
      const userId = socket.userId;
      
      // Vérifier que l'utilisateur est dans la room
      const roomState = await redisClient.getVideoRoomState(roomId);
      if (!roomState || !roomState.participants.find(p => p.userId === userId)) {
        return;
      }
      
      // Envoyer l'offre au destinataire
      socket.to(`video_room:${roomId}`).emit('video:offer', {
        roomId,
        fromUserId: userId,
        targetUserId,
        offer
      });
      
      logger.info(`Offre WebRTC envoyée: ${userId} -> ${targetUserId} dans ${roomId}`);
      
    } catch (error) {
      logger.logError(error, { event: 'video:offer', userId: socket.userId });
    }
  });
  
  /**
   * Réponse WebRTC
   */
  socket.on('video:answer', async (data) => {
    try {
      const { roomId, targetUserId, answer } = data;
      const userId = socket.userId;
      
      // Envoyer la réponse au destinataire
      socket.to(`video_room:${roomId}`).emit('video:answer', {
        roomId,
        fromUserId: userId,
        targetUserId,
        answer
      });
      
      logger.info(`Réponse WebRTC envoyée: ${userId} -> ${targetUserId} dans ${roomId}`);
      
    } catch (error) {
      logger.logError(error, { event: 'video:answer', userId: socket.userId });
    }
  });
  
  /**
   * Candidat ICE
   */
  socket.on('video:ice_candidate', async (data) => {
    try {
      const { roomId, targetUserId, candidate } = data;
      const userId = socket.userId;
      
      // Envoyer le candidat au destinataire
      socket.to(`video_room:${roomId}`).emit('video:ice_candidate', {
        roomId,
        fromUserId: userId,
        targetUserId,
        candidate
      });
      
    } catch (error) {
      logger.logError(error, { event: 'video:ice_candidate', userId: socket.userId });
    }
  });
  
  // ============================================================================
  // CONTRÔLES MÉDIA
  // ============================================================================
  
  /**
   * Activer/désactiver l'audio
   */
  socket.on('video:toggle_audio', async (data, callback) => {
    try {
      const { roomId, enabled } = data;
      const userId = socket.userId;
      
      // Mettre à jour l'état de la room
      const roomState = await redisClient.getVideoRoomState(roomId);
      if (roomState) {
        const participant = roomState.participants.find(p => p.userId === userId);
        if (participant) {
          participant.mediaState.audio = enabled;
          await updateRoomState(roomId, roomState);
          
          // Notifier les autres participants
          socket.to(`video_room:${roomId}`).emit('video:participant_audio_changed', {
            roomId,
            participantId: userId,
            audioEnabled: enabled
          });
          
          logger.info(`Audio ${enabled ? 'activé' : 'désactivé'}: ${userId} dans ${roomId}`);
          
          callback({ success: true, audioEnabled: enabled });
        }
      }
      
    } catch (error) {
      logger.logError(error, { event: 'video:toggle_audio', userId: socket.userId });
      callback({ error: 'Erreur lors du changement d\'audio' });
    }
  });
  
  /**
   * Activer/désactiver la vidéo
   */
  socket.on('video:toggle_video', async (data, callback) => {
    try {
      const { roomId, enabled } = data;
      const userId = socket.userId;
      
      // Mettre à jour l'état de la room
      const roomState = await redisClient.getVideoRoomState(roomId);
      if (roomState) {
        const participant = roomState.participants.find(p => p.userId === userId);
        if (participant) {
          participant.mediaState.video = enabled;
          await updateRoomState(roomId, roomState);
          
          // Notifier les autres participants
          socket.to(`video_room:${roomId}`).emit('video:participant_video_changed', {
            roomId,
            participantId: userId,
            videoEnabled: enabled
          });
          
          logger.info(`Vidéo ${enabled ? 'activée' : 'désactivée'}: ${userId} dans ${roomId}`);
          
          callback({ success: true, videoEnabled: enabled });
        }
      }
      
    } catch (error) {
      logger.logError(error, { event: 'video:toggle_video', userId: socket.userId });
      callback({ error: 'Erreur lors du changement de vidéo' });
    }
  });
  
  /**
   * Partage d'écran
   */
  socket.on('video:toggle_screen_share', async (data, callback) => {
    try {
      const { roomId, enabled } = data;
      const userId = socket.userId;
      
      // Mettre à jour l'état de la room
      const roomState = await redisClient.getVideoRoomState(roomId);
      if (roomState) {
        const participant = roomState.participants.find(p => p.userId === userId);
        if (participant) {
          participant.mediaState.screen = enabled;
          await updateRoomState(roomId, roomState);
          
          // Notifier les autres participants
          socket.to(`video_room:${roomId}`).emit('video:participant_screen_share_changed', {
            roomId,
            participantId: userId,
            screenSharingEnabled: enabled
          });
          
          logger.info(`Partage d'écran ${enabled ? 'activé' : 'désactivé'}: ${userId} dans ${roomId}`);
          
          callback({ success: true, screenSharingEnabled: enabled });
        }
      }
      
    } catch (error) {
      logger.logError(error, { event: 'video:toggle_screen_share', userId: socket.userId });
      callback({ error: 'Erreur lors du partage d\'écran' });
    }
  });
  
  // ============================================================================
  // STATISTIQUES ET QUALITÉ
  // ============================================================================
  
  /**
   * Rapport de qualité de connexion
   */
  socket.on('video:quality_report', async (data) => {
    try {
      const { roomId, stats } = data;
      const userId = socket.userId;
      
      // Sauvegarder les stats en base (optionnel)
      await db.query(`
        UPDATE video_sessions 
        SET quality_metrics = jsonb_set(
          COALESCE(quality_metrics, '{}'),
          $2,
          $3
        )
        WHERE room_id = $1 AND status = 'active'
      `, [
        roomId,
        `{${userId}}`,
        JSON.stringify({
          timestamp: Date.now(),
          ...stats
        })
      ]);
      
      logger.logMetrics('video_quality_report', {
        userId,
        roomId,
        stats
      });
      
    } catch (error) {
      logger.logError(error, { event: 'video:quality_report', userId: socket.userId });
    }
  });
  
  // ============================================================================
  // NETTOYAGE À LA DÉCONNEXION
  // ============================================================================
  
  socket.on('disconnect', async () => {
    try {
      const userId = socket.userId;
      
      if (userId) {
        // Récupérer la présence pour voir si l'utilisateur était dans une room
        const presence = await redisClient.getUserPresence(userId);
        
        if (presence && presence.currentVideoRoom) {
          const roomId = presence.currentVideoRoom;
          
          // Notifier les autres participants
          socket.to(`video_room:${roomId}`).emit('video:participant_disconnected', {
            roomId,
            participantId: userId,
            timestamp: Date.now(),
            reason: 'disconnect'
          });
          
          // Nettoyer la room
          await cleanupRoom(roomId, io);
          
          logger.logUserActivity(userId, 'video_room_disconnected', { roomId });
        }
        
        // Nettoyer la présence
        await redisClient.removeUserPresence(userId);
      }
      
    } catch (error) {
      logger.logError(error, { event: 'disconnect', userId: socket.userId });
    }
  });
  
  // ============================================================================
  // GESTION D'ERREURS WEBRTC
  // ============================================================================
  
  /**
   * Signaler une erreur WebRTC
   */
  socket.on('video:error', async (data) => {
    try {
      const { roomId, error, context } = data;
      const userId = socket.userId;
      
      logger.logError(new Error(`WebRTC Error: ${error}`), {
        event: 'video:error',
        userId,
        roomId,
        context
      });
      
      // Notifier les autres participants si c'est une erreur critique
      if (context === 'connection_failed' || context === 'ice_failed') {
        socket.to(`video_room:${roomId}`).emit('video:participant_error', {
          roomId,
          participantId: userId,
          error: context
        });
      }
      
    } catch (err) {
      logger.logError(err, { event: 'video:error', userId: socket.userId });
    }
  });
  
};
