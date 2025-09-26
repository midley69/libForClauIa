// ============================================================================
// ROUTES DE MATCHING ET APPARIEMENT
// Fichier : /var/www/libekoo/backend/routes/matching.js
// ============================================================================

const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');
const authMiddleware = require('../middleware/auth');
const matchingService = require('../services/matchingService');

const router = express.Router();

// Appliquer l'authentification à toutes les routes
router.use(authMiddleware);

// ============================================================================
// UTILITAIRES
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
 * Obtenir les préférences de matching par défaut
 */
function getDefaultMatchingPreferences(userType) {
  return {
    maxDistance: userType === 'local' ? 50 : 1000, // km
    ageRangePreference: 'all',
    genderPreference: 'all',
    matchingTimeout: 30, // secondes
    retryAttempts: 3
  };
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/matching/find-partner
 * Rechercher un partenaire de chat
 */
router.post('/find-partner',
  [
    body('matchType')
      .isIn(['random', 'local', 'group'])
      .withMessage('Type de match invalide'),
    body('preferences')
      .optional()
      .isObject()
      .withMessage('Préférences invalides')
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
      
      const { matchType, preferences = {} } = req.body;
      const userId = req.user.userId;
      
      logger.logMatching(userId, null, matchType, false, { stage: 'search_started', preferences });
      
      // Vérifier si l'utilisateur est déjà en recherche
      const existingSearch = await redisClient.getCache(`searching:${userId}`);
      if (existingSearch) {
        return res.status(409).json({
          error: 'Recherche déjà en cours',
          code: 'SEARCH_IN_PROGRESS',
          searchId: existingSearch.searchId
        });
      }
      
      // Récupérer les informations utilisateur complètes
      const userResult = await db.getUserById(userId);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }
      
      const user = userResult.rows[0];
      
      // Récupérer la localisation utilisateur
      const locationResult = await db.query(
        'SELECT * FROM user_locations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      
      const userLocation = locationResult.rows[0];
      
      // Merge des préférences
      const matchingPreferences = {
        ...getDefaultMatchingPreferences(matchType),
        ...preferences
      };
      
      // Données utilisateur pour le matching
      const matchingData = {
        userId: user.user_id,
        username: user.username,
        gender: user.gender,
        ageRange: user.age_range,
        country: user.country,
        city: user.city,
        latitude: userLocation?.latitude,
        longitude: userLocation?.longitude,
        matchType,
        preferences: matchingPreferences,
        joinedAt: Date.now()
      };
      
      // Générer ID de recherche
      const searchId = uuidv4();
      
      // Marquer l'utilisateur comme en recherche
      await redisClient.setCache(`searching:${userId}`, { 
        searchId, 
        matchType, 
        startedAt: Date.now() 
      }, 300); // 5 minutes
      
      // Recherche immédiate d'un partenaire
      let matchResult = await matchingService.findPartner(matchingData);
      
      if (matchResult.success && matchResult.partner) {
        // Match trouvé immédiatement
        logger.logMatching(
          userId, 
          matchResult.partner.userId, 
          matchType, 
          true, 
          { 
            stage: 'immediate_match', 
            distance: matchResult.distance,
            matchScore: matchResult.matchScore 
          }
        );
        
        // Nettoyer la recherche
        await redisClient.deleteCache(`searching:${userId}`);
        
        res.json({
          success: true,
          matched: true,
          searchId,
          session: matchResult.session,
          partner: {
            id: matchResult.partner.userId,
            username: matchResult.partner.username,
            gender: matchResult.partner.gender,
            location: {
              country: matchResult.partner.country,
              city: matchResult.partner.city
            },
            distance: matchResult.distance
          }
        });
        
      } else {
        // Aucun match trouvé, ajouter à la file d'attente
        await redisClient.addToMatchingQueue(userId, matchingData);
        
        logger.logMatching(userId, null, matchType, false, { 
          stage: 'added_to_queue', 
          queuePosition: await matchingService.getQueuePosition(userId, matchType)
        });
        
        res.json({
          success: true,
          matched: false,
          searchId,
          message: 'Recherche en cours...',
          queuePosition: await matchingService.getQueuePosition(userId, matchType),
          estimatedWait: await matchingService.getEstimatedWaitTime(matchType)
        });
      }
      
    } catch (error) {
      logger.logError(error, { route: '/matching/find-partner', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur lors de la recherche de partenaire',
        code: 'MATCHING_ERROR'
      });
    }
  }
);

/**
 * POST /api/matching/cancel-search
 * Annuler la recherche de partenaire
 */
router.post('/cancel-search', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { searchId } = req.body;
    
    logger.logMatching(userId, null, 'cancel', false, { stage: 'search_cancelled' });
    
    // Vérifier si l'utilisateur est en recherche
    const existingSearch = await redisClient.getCache(`searching:${userId}`);
    if (!existingSearch) {
      return res.status(404).json({
        error: 'Aucune recherche en cours',
        code: 'NO_SEARCH_FOUND'
      });
    }
    
    // Vérifier l'ID de recherche si fourni
    if (searchId && existingSearch.searchId !== searchId) {
      return res.status(400).json({
        error: 'ID de recherche invalide',
        code: 'INVALID_SEARCH_ID'
      });
    }
    
    // Retirer de toutes les files d'attente possibles
    await Promise.all([
      redisClient.removeFromMatchingQueue(userId, 'random'),
      redisClient.removeFromMatchingQueue(userId, 'local'),
      redisClient.removeFromMatchingQueue(userId, 'group')
    ]);
    
    // Nettoyer le cache de recherche
    await redisClient.deleteCache(`searching:${userId}`);
    
    res.json({
      success: true,
      message: 'Recherche annulée'
    });
    
  } catch (error) {
    logger.logError(error, { route: '/matching/cancel-search', userId: req.user?.userId });
    res.status(500).json({ 
      error: 'Erreur lors de l\'annulation',
      code: 'CANCEL_ERROR'
    });
  }
});

/**
 * GET /api/matching/status/:searchId
 * Vérifier le statut d'une recherche
 */
router.get('/status/:searchId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { searchId } = req.params;
    
    // Vérifier si l'utilisateur est en recherche
    const existingSearch = await redisClient.getCache(`searching:${userId}`);
    if (!existingSearch || existingSearch.searchId !== searchId) {
      return res.status(404).json({
        error: 'Recherche non trouvée',
        code: 'SEARCH_NOT_FOUND'
      });
    }
    
    // Vérifier s'il y a eu un match entre temps
    const matchResult = await redisClient.getCache(`match:${userId}`);
    if (matchResult) {
      // Match trouvé
      await redisClient.deleteCache(`searching:${userId}`);
      await redisClient.deleteCache(`match:${userId}`);
      
      logger.logMatching(userId, matchResult.partnerId, existingSearch.matchType, true, { stage: 'async_match' });
      
      return res.json({
        success: true,
        matched: true,
        searchId,
        session: matchResult.session,
        partner: matchResult.partner
      });
    }
    
    // Toujours en recherche
    const queuePosition = await matchingService.getQueuePosition(userId, existingSearch.matchType);
    const estimatedWait = await matchingService.getEstimatedWaitTime(existingSearch.matchType);
    
    res.json({
      success: true,
      matched: false,
      searchId,
      status: 'searching',
      queuePosition,
      estimatedWait,
      elapsedTime: Date.now() - existingSearch.startedAt
    });
    
  } catch (error) {
    logger.logError(error, { route: '/matching/status', userId: req.user?.userId });
    res.status(500).json({ 
      error: 'Erreur vérification statut',
      code: 'STATUS_ERROR'
    });
  }
});

/**
 * GET /api/matching/queue-stats
 * Statistiques des files d'attente
 */
router.get('/queue-stats', async (req, res) => {
  try {
    const stats = await matchingService.getQueueStats();
    
    res.json({
      success: true,
      stats: {
        random: {
          count: stats.randomQueue,
          averageWait: stats.averageWaitRandom,
          activeMatches: stats.activeRandomMatches
        },
        local: {
          count: stats.localQueue,
          averageWait: stats.averageWaitLocal,
          activeMatches: stats.activeLocalMatches
        },
        group: {
          count: stats.groupQueue,
          averageWait: stats.averageWaitGroup,
          activeMatches: stats.activeGroupMatches
        },
        totalUsers: stats.totalOnlineUsers,
        lastUpdated: Date.now()
      }
    });
    
  } catch (error) {
    logger.logError(error, { route: '/matching/queue-stats', userId: req.user?.userId });
    res.status(500).json({ 
      error: 'Erreur récupération statistiques',
      code: 'STATS_ERROR'
    });
  }
});

/**
 * POST /api/matching/preferences
 * Mettre à jour les préférences de matching
 */
router.post('/preferences',
  [
    body('genderPreference')
      .optional()
      .isIn(['all', 'homme', 'femme', 'non-binaire'])
      .withMessage('Préférence de genre invalide'),
    body('ageRangePreference')
      .optional()
      .isIn(['all', '13-17', '18-24', '25-34', '35-44', '45+'])
      .withMessage('Préférence d\'âge invalide'),
    body('maxDistance')
      .optional()
      .isInt({ min: 5, max: 5000 })
      .withMessage('Distance invalide (5-5000 km)')
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
      
      const userId = req.user.userId;
      const newPreferences = req.body;
      
      // Récupérer les préférences actuelles
      const userResult = await db.getUserById(userId);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }
      
      const currentPreferences = userResult.rows[0].preferences || {};
      const updatedPreferences = {
        ...currentPreferences,
        matching: {
          ...currentPreferences.matching,
          ...newPreferences
        }
      };
      
      // Mettre à jour en base
      await db.query(
        'UPDATE users SET preferences = $2, updated_at = NOW() WHERE user_id = $1',
        [userId, JSON.stringify(updatedPreferences)]
      );
      
      logger.logUserActivity(userId, 'preferences_updated', { type: 'matching', preferences: newPreferences });
      
      res.json({
        success: true,
        message: 'Préférences mises à jour',
        preferences: updatedPreferences.matching
      });
      
    } catch (error) {
      logger.logError(error, { route: '/matching/preferences', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur mise à jour préférences',
        code: 'PREFERENCES_ERROR'
      });
    }
  }
);

/**
 * POST /api/matching/report-user
 * Signaler un utilisateur rencontré
 */
router.post('/report-user',
  [
    body('reportedUserId')
      .notEmpty()
      .withMessage('ID utilisateur requis'),
    body('reportType')
      .isIn(['spam', 'harassment', 'inappropriate_content', 'fake_profile', 'underage', 'other'])
      .withMessage('Type de signalement invalide'),
    body('description')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Description trop longue (500 caractères max)')
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
      
      const { reportedUserId, reportType, description, sessionId } = req.body;
      const reporterId = req.user.userId;
      
      // Vérifier que l'utilisateur ne se signale pas lui-même
      if (reporterId === reportedUserId) {
        return res.status(400).json({
          error: 'Impossible de se signaler soi-même',
          code: 'SELF_REPORT'
        });
      }
      
      // Vérifier si l'utilisateur signalé existe
      const reportedUserResult = await db.getUserById(reportedUserId);
      if (reportedUserResult.rows.length === 0) {
        return res.status(404).json({ error: 'Utilisateur signalé non trouvé' });
      }
      
      // Vérifier s'il n'y a pas déjà un signalement récent
      const existingReport = await db.query(`
        SELECT id FROM moderation_reports 
        WHERE reporter_id = $1 AND reported_user_id = $2 
        AND created_at > NOW() - INTERVAL '1 hour'
        LIMIT 1
      `, [reporterId, reportedUserId]);
      
      if (existingReport.rows.length > 0) {
        return res.status(409).json({
          error: 'Signalement déjà effectué récemment',
          code: 'DUPLICATE_REPORT'
        });
      }
      
      // Créer le signalement
      const reportId = uuidv4();
      await db.query(`
        INSERT INTO moderation_reports 
        (id, reporter_id, reported_user_id, target_type, target_id, report_type, description, status, priority)
        VALUES ($1, $2, $3, 'user', $4, $5, $6, 'pending', 'normal')
      `, [reportId, reporterId, reportedUserId, reportedUserId, reportType, description]);
      
      // Incrémenter le compteur de signalements pour l'utilisateur signalé
      await db.query(`
        UPDATE users 
        SET stats = jsonb_set(
          COALESCE(stats, '{}'), 
          '{reports_received}', 
          (COALESCE(stats->>'reports_received', '0')::int + 1)::text::jsonb
        )
        WHERE user_id = $1
      `, [reportedUserId]);
      
      // Vérifier si l'utilisateur signalé dépasse le seuil d'auto-bannissement
      const reportCount = await db.query(`
        SELECT COUNT(*) as count FROM moderation_reports 
        WHERE reported_user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
      `, [reportedUserId]);
      
      const dailyReports = parseInt(reportCount.rows[0].count);
      
      if (dailyReports >= 5) {
        // Auto-bannissement temporaire
        await db.query(`
          UPDATE users 
          SET is_banned = true, ban_reason = 'Signalements multiples', ban_expires_at = NOW() + INTERVAL '24 hours'
          WHERE user_id = $1
        `, [reportedUserId]);
        
        logger.logSecurityEvent('auto_ban_applied', { 
          userId: reportedUserId, 
          reportCount: dailyReports 
        }, 'warning');
      }
      
      logger.logUserActivity(reporterId, 'user_reported', {
        reportedUserId,
        reportType,
        sessionId: sessionId || null
      });
      
      res.json({
        success: true,
        message: 'Signalement enregistré',
        reportId
      });
      
    } catch (error) {
      logger.logError(error, { route: '/matching/report-user', userId: req.user?.userId });
      res.status(500).json({ 
        error: 'Erreur lors du signalement',
        code: 'REPORT_ERROR'
      });
    }
  }
);

/**
 * GET /api/matching/nearby-users
 * Récupérer les utilisateurs à proximité (pour chat local)
 */
router.get('/nearby-users', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { radius = 50 } = req.query; // Rayon en km
    
    // Récupérer la localisation de l'utilisateur
    const locationResult = await db.query(
      'SELECT latitude, longitude, country, city FROM user_locations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    
    if (locationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Localisation non trouvée' });
    }
    
    const userLocation = locationResult.rows[0];
    
    // Rechercher les utilisateurs dans le rayon (approximation simple)
    const nearbyResult = await db.query(`
      SELECT u.user_id, u.username, u.gender, u.country, u.city, 
             ul.latitude, ul.longitude, u.status
      FROM users u
      JOIN user_locations ul ON u.user_id = ul.user_id
      WHERE u.user_id != $1 
        AND u.status = 'online'
        AND ul.country = $2
        AND ABS(ul.latitude - $3) < 1 
        AND ABS(ul.longitude - $4) < 1
      ORDER BY (ABS(ul.latitude - $3) + ABS(ul.longitude - $4))
      LIMIT 20
    `, [userId, userLocation.country, userLocation.latitude, userLocation.longitude]);
    
    const nearbyUsers = nearbyResult.rows.map(user => {
      const distance = calculateDistance(
        userLocation.latitude, userLocation.longitude,
        user.latitude, user.longitude
      );
      
      return {
        id: user.user_id,
        username: user.username,
        gender: user.gender,
        location: {
          country: user.country,
          city: user.city
        },
        distance: distance,
        status: user.status
      };
    }).filter(user => user.distance <= parseInt(radius));
    
    res.json({
      success: true,
      nearbyUsers,
      userLocation: {
        country: userLocation.country,
        city: userLocation.city
      },
      radius: parseInt(radius)
    });
    
  } catch (error) {
    logger.logError(error, { route: '/matching/nearby-users', userId: req.user?.userId });
    res.status(500).json({ 
      error: 'Erreur recherche utilisateurs proches',
      code: 'NEARBY_USERS_ERROR'
    });
  }
});

module.exports = router;
