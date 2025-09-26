// ============================================================================
// SERVICE DE MATCHING ET APPARIEMENT
// Fichier : /var/www/libekoo/backend/services/matchingService.js
// ============================================================================

const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');

// ============================================================================
// CONSTANTES
// ============================================================================

const MATCHING_CONFIG = {
  // Temps d'attente max par type (en secondes)
  MAX_WAIT_TIME: {
    random: 45,
    local: 60,
    group: 30
  },
  
  // Distance max pour match local (en km)
  MAX_LOCAL_DISTANCE: 100,
  
  // Score de compatibilité minimum
  MIN_COMPATIBILITY_SCORE: 0.3,
  
  // Nombre max de tentatives de match
  MAX_RETRY_ATTEMPTS: 5
};

// ============================================================================
// FONCTIONS UTILITAIRES
// ============================================================================

/**
 * Calculer la distance entre deux points géographiques
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  
  const R = 6371; // Rayon de la Terre en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c);
}

/**
 * Calculer un score de compatibilité entre deux utilisateurs
 */
function calculateCompatibilityScore(user1, user2) {
  let score = 0.5; // Score de base
  
  // Préférences de genre
  if (user1.preferences?.genderPreference && user1.preferences.genderPreference !== 'all') {
    if (user1.preferences.genderPreference === user2.gender) {
      score += 0.2;
    } else {
      score -= 0.3;
    }
  }
  
  if (user2.preferences?.genderPreference && user2.preferences.genderPreference !== 'all') {
    if (user2.preferences.genderPreference === user1.gender) {
      score += 0.2;
    } else {
      score -= 0.3;
    }
  }
  
  // Préférences d'âge
  if (user1.preferences?.ageRangePreference && user1.preferences.ageRangePreference !== 'all') {
    if (user1.preferences.ageRangePreference === user2.ageRange) {
      score += 0.15;
    }
  }
  
  // Proximité géographique (bonus pour users proches)
  if (user1.latitude && user1.longitude && user2.latitude && user2.longitude) {
    const distance = calculateDistance(user1.latitude, user1.longitude, user2.latitude, user2.longitude);
    if (distance !== null) {
      if (distance < 10) score += 0.2;
      else if (distance < 50) score += 0.1;
      else if (distance < 200) score += 0.05;
    }
  }
  
  // Même pays (petit bonus)
  if (user1.country === user2.country) {
    score += 0.1;
  }
  
  // Même ville (bonus plus important)
  if (user1.city === user2.city) {
    score += 0.15;
  }
  
  // Éviter les matchs répétés récents
  // Cette logique sera ajoutée plus tard avec l'historique
  
  return Math.max(0, Math.min(1, score));
}

/**
 * Vérifier si deux utilisateurs peuvent être appariés
 */
async function canMatch(user1, user2) {
  // Vérifier que ce ne sont pas les mêmes utilisateurs
  if (user1.userId === user2.userId) return false;
  
  // Vérifier les préférences de genre
  if (user1.preferences?.genderPreference && user1.preferences.genderPreference !== 'all') {
    if (user1.preferences.genderPreference !== user2.gender) return false;
  }
  
  if (user2.preferences?.genderPreference && user2.preferences.genderPreference !== 'all') {
    if (user2.preferences.genderPreference !== user1.gender) return false;
  }
  
  // Vérifier la distance maximale pour le chat local
  if (user1.matchType === 'local' || user2.matchType === 'local') {
    if (user1.latitude && user1.longitude && user2.latitude && user2.longitude) {
      const distance = calculateDistance(user1.latitude, user1.longitude, user2.latitude, user2.longitude);
      const maxDistance = Math.max(
        user1.preferences?.maxDistance || MATCHING_CONFIG.MAX_LOCAL_DISTANCE,
        user2.preferences?.maxDistance || MATCHING_CONFIG.MAX_LOCAL_DISTANCE
      );
      if (distance > maxDistance) return false;
    }
  }
  
  // Vérifier les bannissements récents entre ces utilisateurs
  // TODO: Implémenter la logique de blocage mutuel
  
  return true;
}

/**
 * Créer une nouvelle session de chat
 */
async function createChatSession(user1, user2, matchType) {
  const sessionId = uuidv4();
  
  // Calculer la distance géographique
  let geographicDistance = null;
  if (user1.latitude && user1.longitude && user2.latitude && user2.longitude) {
    geographicDistance = calculateDistance(user1.latitude, user1.longitude, user2.latitude, user2.longitude);
  }
  
  // Données de la session
  const sessionData = {
    session_id: sessionId,
    user1_id: user1.userId,
    user1_username: user1.username,
    user2_id: user2.userId,
    user2_username: user2.username,
    session_type: matchType,
    user1_country: user1.country,
    user1_city: user1.city,
    user2_country: user2.country,
    user2_city: user2.city
  };
  
  // Créer en base de données
  const result = await db.createChatSession(sessionData);
  const session = result.rows[0];
  
  // Mise à jour de la distance géographique si calculée
  if (geographicDistance !== null) {
    await db.query(
      'UPDATE chat_sessions SET geographic_distance_km = $2 WHERE id = $1',
      [session.id, geographicDistance]
    );
  }
  
  // Stocker l'état de la session dans Redis
  await redisClient.setCache(`chat_session:${sessionId}`, {
    sessionId,
    user1Id: user1.userId,
    user2Id: user2.userId,
    status: 'active',
    createdAt: Date.now(),
    matchType
  }, 3600 * 2); // 2 heures
  
  logger.logMatching(user1.userId, user2.userId, matchType, true, {
    sessionId,
    distance: geographicDistance,
    compatibilityScore: calculateCompatibilityScore(user1, user2)
  });
  
  return {
    sessionId,
    sessionDbId: session.id,
    createdAt: session.created_at,
    distance: geographicDistance
  };
}

// ============================================================================
// FONCTIONS PRINCIPALES
// ============================================================================

/**
 * Rechercher un partenaire pour un utilisateur
 */
async function findPartner(userData) {
  try {
    const { userId, matchType } = userData;
    
    logger.info(`Recherche de partenaire pour ${userId} (type: ${matchType})`);
    
    // Récupérer les utilisateurs en attente dans la file du même type
    const queueKey = `matching_queue:${matchType}`;
    const queueLength = await redisClient.client.lLen(queueKey);
    
    if (queueLength === 0) {
      return { success: false, reason: 'Aucun utilisateur en attente' };
    }
    
    // Parcourir la file pour trouver un match compatible
    let bestMatch = null;
    let bestScore = 0;
    let checkedUsers = [];
    
    for (let i = 0; i < Math.min(queueLength, 10); i++) {
      const candidateData = await redisClient.client.lIndex(queueKey, i);
      if (!candidateData) continue;
      
      let candidate;
      try {
        candidate = JSON.parse(candidateData);
      } catch (error) {
        logger.warn('Données candidat invalides dans la file:', error);
        continue;
      }
      
      checkedUsers.push(candidate.userId);
      
      // Vérifier la compatibilité
      const canMatchResult = await canMatch(userData, candidate);
      if (!canMatchResult) continue;
      
      // Calculer le score de compatibilité
      const compatibilityScore = calculateCompatibilityScore(userData, candidate);
      
      if (compatibilityScore > bestScore && compatibilityScore >= MATCHING_CONFIG.MIN_COMPATIBILITY_SCORE) {
        bestMatch = candidate;
        bestScore = compatibilityScore;
        
        // Si score parfait, pas besoin de chercher plus
        if (compatibilityScore >= 0.9) break;
      }
    }
    
    // Si un match a été trouvé
    if (bestMatch) {
      // Retirer le partenaire de la file
      await redisClient.removeFromMatchingQueue(bestMatch.userId, matchType);
      
      // Créer la session de chat
      const session = await createChatSession(userData, bestMatch, matchType);
      
      // Notifier les deux utilisateurs via Redis (pour les WebSockets)
      await redisClient.setCache(`match:${userData.userId}`, {
        matched: true,
        partnerId: bestMatch.userId,
        sessionId: session.sessionId,
        partner: {
          id: bestMatch.userId,
          username: bestMatch.username,
          gender: bestMatch.gender,
          country: bestMatch.country,
          city: bestMatch.city
        },
        session: {
          id: session.sessionId,
          createdAt: session.createdAt
        },
        distance: session.distance,
        matchScore: bestScore
      }, 300); // 5 minutes
      
      await redisClient.setCache(`match:${bestMatch.userId}`, {
        matched: true,
        partnerId: userData.userId,
        sessionId: session.sessionId,
        partner: {
          id: userData.userId,
          username: userData.username,
          gender: userData.gender,
          country: userData.country,
          city: userData.city
        },
        session: {
          id: session.sessionId,
          createdAt: session.createdAt
        },
        distance: session.distance,
        matchScore: bestScore
      }, 300); // 5 minutes
      
      return {
        success: true,
        partner: bestMatch,
        session: {
          id: session.sessionId,
          createdAt: session.createdAt
        },
        distance: session.distance,
        matchScore: bestScore
      };
    }
    
    return { 
      success: false, 
      reason: 'Aucun match compatible trouvé',
      checkedUsers: checkedUsers.length
    };
    
  } catch (error) {
    logger.logError(error, { function: 'findPartner', userId: userData.userId });
    return { success: false, reason: 'Erreur système' };
  }
}

/**
 * Obtenir la position dans la file d'attente
 */
async function getQueuePosition(userId, queueType) {
  try {
    const queueKey = `matching_queue:${queueType}`;
    const queueLength = await redisClient.client.lLen(queueKey);
    
    for (let i = 0; i < queueLength; i++) {
      const userData = await redisClient.client.lIndex(queueKey, i);
      if (userData) {
        const parsed = JSON.parse(userData);
        if (parsed.userId === userId) {
          return i + 1; // Position basée sur 1
        }
      }
    }
    
    return -1; // Pas trouvé dans la file
  } catch (error) {
    logger.logError(error, { function: 'getQueuePosition', userId, queueType });
    return -1;
  }
}

/**
 * Estimer le temps d'attente
 */
async function getEstimatedWaitTime(queueType) {
  try {
    const queueKey = `matching_queue:${queueType}`;
    const queueLength = await redisClient.client.lLen(queueKey);
    
    // Logique simple d'estimation basée sur la longueur de la file
    if (queueLength === 0) return 0;
    if (queueLength <= 2) return 15; // 15 secondes
    if (queueLength <= 5) return 30; // 30 secondes
    if (queueLength <= 10) return 60; // 1 minute
    
    return Math.min(queueLength * 10, MATCHING_CONFIG.MAX_WAIT_TIME[queueType]);
  } catch (error) {
    logger.logError(error, { function: 'getEstimatedWaitTime', queueType });
    return 60; // Défaut: 1 minute
  }
}

/**
 * Obtenir les statistiques des files d'attente
 */
async function getQueueStats() {
  try {
    const [randomQueue, localQueue, groupQueue] = await Promise.all([
      redisClient.client.lLen('matching_queue:random'),
      redisClient.client.lLen('matching_queue:local'),
      redisClient.client.lLen('matching_queue:group')
    ]);
    
    // Récupérer les sessions actives
    const activeSessionsResult = await db.query(`
      SELECT session_type, COUNT(*) as count
      FROM chat_sessions
      WHERE status = 'active'
      GROUP BY session_type
    `);
    
    const activeSessions = {};
    activeSessionsResult.rows.forEach(row => {
      activeSessions[row.session_type] = parseInt(row.count);
    });
    
    // Récupérer le nombre total d'utilisateurs en ligne
    const onlineUsersResult = await db.query(
      "SELECT COUNT(*) as count FROM users WHERE status = 'online'"
    );
    const totalOnlineUsers = parseInt(onlineUsersResult.rows[0].count);
    
    return {
      randomQueue,
      localQueue,
      groupQueue,
      activeRandomMatches: activeSessions.random || 0,
      activeLocalMatches: activeSessions.local || 0,
      activeGroupMatches: activeSessions.group || 0,
      totalOnlineUsers,
      averageWaitRandom: await getEstimatedWaitTime('random'),
      averageWaitLocal: await getEstimatedWaitTime('local'),
      averageWaitGroup: await getEstimatedWaitTime('group')
    };
  } catch (error) {
    logger.logError(error, { function: 'getQueueStats' });
    return {
      randomQueue: 0,
      localQueue: 0,
      groupQueue: 0,
      activeRandomMatches: 0,
      activeLocalMatches: 0,
      activeGroupMatches: 0,
      totalOnlineUsers: 0,
      averageWaitRandom: 60,
      averageWaitLocal: 60,
      averageWaitGroup: 60
    };
  }
}

/**
 * Nettoyer les files d'attente (supprimer les utilisateurs inactifs)
 */
async function cleanupQueues() {
  try {
    const queueTypes = ['random', 'local', 'group'];
    let totalCleaned = 0;
    
    for (const queueType of queueTypes) {
      const queueKey = `matching_queue:${queueType}`;
      const queueLength = await redisClient.client.lLen(queueKey);
      
      for (let i = queueLength - 1; i >= 0; i--) {
        const userData = await redisClient.client.lIndex(queueKey, i);
        if (userData) {
          const parsed = JSON.parse(userData);
          const ageMinutes = (Date.now() - parsed.joinedAt) / (1000 * 60);
          
          // Supprimer si plus vieux que le temps d'attente maximum
          const maxWaitMinutes = MATCHING_CONFIG.MAX_WAIT_TIME[queueType] / 60;
          if (ageMinutes > maxWaitMinutes) {
            await redisClient.client.lRem(queueKey, 1, userData);
            await redisClient.deleteCache(`searching:${parsed.userId}`);
            totalCleaned++;
            
            logger.info(`Utilisateur ${parsed.userId} retiré de la file ${queueType} (timeout)`);
          }
        }
      }
    }
    
    if (totalCleaned > 0) {
      logger.info(`Nettoyage files d'attente: ${totalCleaned} utilisateurs retirés`);
    }
    
    return totalCleaned;
  } catch (error) {
    logger.logError(error, { function: 'cleanupQueues' });
    return 0;
  }
}

/**
 * Forcer un match pour test (développement uniquement)
 */
async function forceMatch(user1Id, user2Id) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Force match non autorisé en production');
  }
  
  try {
    const [user1Result, user2Result] = await Promise.all([
      db.getUserById(user1Id),
      db.getUserById(user2Id)
    ]);
    
    if (user1Result.rows.length === 0 || user2Result.rows.length === 0) {
      throw new Error('Utilisateur(s) non trouvé(s)');
    }
    
    const user1 = user1Result.rows[0];
    const user2 = user2Result.rows[0];
    
    // Créer des objets utilisateur compatibles avec createChatSession
    const userData1 = {
      userId: user1.user_id,
      username: user1.username,
      gender: user1.gender,
      country: user1.country,
      city: user1.city
    };
    
    const userData2 = {
      userId: user2.user_id,
      username: user2.username,
      gender: user2.gender,
      country: user2.country,
      city: user2.city
    };
    
    // Créer la session
    const session = await createChatSession(userData1, userData2, 'random');
    
    logger.info(`Match forcé créé: ${user1Id} <-> ${user2Id} (session: ${session.sessionId})`);
    
    return {
      success: true,
      sessionId: session.sessionId,
      users: [userData1, userData2]
    };
    
  } catch (error) {
    logger.logError(error, { function: 'forceMatch', user1Id, user2Id });
    throw error;
  }
}

// ============================================================================
// EXPORT DU MODULE
// ============================================================================

module.exports = {
  // Fonctions principales
  findPartner,
  getQueuePosition,
  getEstimatedWaitTime,
  getQueueStats,
  cleanupQueues,
  
  // Fonctions utilitaires
  calculateDistance,
  calculateCompatibilityScore,
  canMatch,
  createChatSession,
  
  // Fonctions de développement
  forceMatch,
  
  // Configuration
  MATCHING_CONFIG
};
