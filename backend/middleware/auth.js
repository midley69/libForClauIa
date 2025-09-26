// ============================================================================
// MIDDLEWARE D'AUTHENTIFICATION
// Fichier : /var/www/libekoo/backend/middleware/auth.js
// ============================================================================

const jwt = require('jsonwebtoken');
const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');
const moderationService = require('../services/moderationService');

// ============================================================================
// MIDDLEWARE PRINCIPAL D'AUTHENTIFICATION
// ============================================================================

/**
 * Middleware d'authentification flexible (anonyme autorisé)
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;
    
    // Si pas de token, continuer comme utilisateur anonyme
    if (!token) {
      req.user = {
        userId: null,
        userType: 'anonymous',
        isAuthenticated: false
      };
      return next();
    }
    
    try {
      // Vérifier et décoder le token JWT
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'libekoo_jwt_secret_2024');
      
      // Vérifier si la session existe dans Redis
      const session = await redisClient.getUserSession(decoded.userId);
      if (!session) {
        // Token valide mais session expirée
        return res.status(401).json({
          error: 'Session expirée',
          code: 'SESSION_EXPIRED'
        });
      }
      
      // Vérifier si l'utilisateur existe et n'est pas banni
      const userResult = await db.getUserById(decoded.userId);
      if (userResult.rows.length === 0) {
        await redisClient.deleteUserSession(decoded.userId);
        return res.status(401).json({
          error: 'Utilisateur non trouvé',
          code: 'USER_NOT_FOUND'
        });
      }
      
      const user = userResult.rows[0];
      
      // Vérifier si l'utilisateur est banni
      if (user.is_banned) {
        await redisClient.deleteUserSession(decoded.userId);
        
        const banMessage = user.ban_expires_at 
          ? `Compte suspendu jusqu'au ${new Date(user.ban_expires_at).toLocaleDateString()}`
          : 'Compte suspendu définitivement';
          
        return res.status(403).json({
          error: banMessage,
          code: 'USER_BANNED',
          banReason: user.ban_reason,
          banExpiresAt: user.ban_expires_at
        });
      }
      
      // Vérifier si l'IP est bannie
      const userIP = req.userIP || req.ip;
      const ipHash = moderationService.hashIP(userIP);
      const isIPBanned = await moderationService.checkBannedIP(ipHash);
      
      if (isIPBanned) {
        logger.logSecurityEvent('banned_ip_token_attempt', {
          userId: decoded.userId,
          ip: userIP
        });
        
        return res.status(403).json({
          error: 'Accès temporairement restreint',
          code: 'IP_BANNED'
        });
      }
      
      // Mettre à jour la dernière activité
      await db.updateUserStatus(decoded.userId, user.status, new Date());
      
      // Prolonger la session Redis
      await redisClient.setUserSession(decoded.userId, {
        ...session,
        lastActivity: new Date().toISOString()
      }, 3600 * 24 * 7); // 7 jours
      
      // Attacher les informations utilisateur à la requête
      req.user = {
        userId: decoded.userId,
        userType: decoded.userType || 'registered',
        username: decoded.username,
        email: decoded.email,
        gender: decoded.gender,
        accountType: user.account_type,
        isAuthenticated: true,
        permissions: getUserPermissions(user.account_type),
        session: session
      };
      
      next();
      
    } catch (jwtError) {
      // Token invalide
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token expiré',
          code: 'TOKEN_EXPIRED'
        });
      } else if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'Token invalide',
          code: 'INVALID_TOKEN'
        });
      } else {
        throw jwtError;
      }
    }
    
  } catch (error) {
    logger.logError(error, { 
      middleware: 'authMiddleware',
      url: req.originalUrl,
      method: req.method,
      ip: req.userIP
    });
    
    res.status(500).json({
      error: 'Erreur d\'authentification',
      code: 'AUTH_ERROR'
    });
  }
};

// ============================================================================
// MIDDLEWARE D'AUTHENTIFICATION REQUISE
// ============================================================================

/**
 * Middleware qui exige une authentification valide
 */
const requireAuth = async (req, res, next) => {
  // Appliquer d'abord le middleware d'auth standard
  await authMiddleware(req, res, () => {
    if (!req.user || !req.user.isAuthenticated) {
      return res.status(401).json({
        error: 'Authentification requise',
        code: 'AUTHENTICATION_REQUIRED'
      });
    }
    next();
  });
};

// ============================================================================
// MIDDLEWARE DE PERMISSIONS
// ============================================================================

/**
 * Obtenir les permissions d'un utilisateur selon son type de compte
 */
function getUserPermissions(accountType) {
  const permissions = {
    anonymous: [
      'chat:send_message',
      'chat:join_session',
      'video:create_room',
      'video:join_room',
      'matching:find_partner'
    ],
    registered: [
      'chat:send_message',
      'chat:join_session',
      'chat:view_history',
      'video:create_room',
      'video:join_room',
      'video:record_session',
      'matching:find_partner',
      'matching:set_preferences',
      'user:add_friends',
      'user:view_profile'
    ],
    premium: [
      'chat:send_message',
      'chat:join_session',
      'chat:view_history',
      'chat:priority_matching',
      'video:create_room',
      'video:join_room',
      'video:record_session',
      'video:hd_quality',
      'matching:find_partner',
      'matching:set_preferences',
      'matching:premium_filters',
      'user:add_friends',
      'user:view_profile',
      'user:premium_badges'
    ],
    admin: [
      '*' // Toutes les permissions
    ]
  };
  
  return permissions[accountType] || permissions.anonymous;
}

/**
 * Middleware de vérification des permissions
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user || !req.user.isAuthenticated) {
      return res.status(401).json({
        error: 'Authentification requise',
        code: 'AUTHENTICATION_REQUIRED'
      });
    }
    
    const userPermissions = req.user.permissions || [];
    
    // Admin a toutes les permissions
    if (userPermissions.includes('*')) {
      return next();
    }
    
    // Vérifier la permission spécifique
    if (!userPermissions.includes(permission)) {
      logger.logSecurityEvent('unauthorized_permission_attempt', {
        userId: req.user.userId,
        permission,
        userType: req.user.userType,
        url: req.originalUrl
      });
      
      return res.status(403).json({
        error: 'Permission insuffisante',
        code: 'INSUFFICIENT_PERMISSION',
        requiredPermission: permission
      });
    }
    
    next();
  };
};

// ============================================================================
// MIDDLEWARE D'AUTHENTIFICATION ADMIN
// ============================================================================

/**
 * Middleware qui exige des privilèges administrateur
 */
const requireAdmin = async (req, res, next) => {
  await requireAuth(req, res, () => {
    if (req.user.accountType !== 'admin' && !req.user.permissions.includes('*')) {
      logger.logSecurityEvent('unauthorized_admin_attempt', {
        userId: req.user.userId,
        userType: req.user.userType,
        url: req.originalUrl,
        ip: req.userIP
      });
      
      return res.status(403).json({
        error: 'Privilèges administrateur requis',
        code: 'ADMIN_REQUIRED'
      });
    }
    next();
  });
};

// ============================================================================
// MIDDLEWARE DE VÉRIFICATION DE BAN
// ============================================================================

/**
 * Middleware pour vérifier les bans IP (à utiliser sur les routes sensibles)
 */
const checkBannedIP = async (req, res, next) => {
  try {
    const userIP = req.userIP || req.ip;
    const ipHash = moderationService.hashIP(userIP);
    
    const isBanned = await moderationService.checkBannedIP(ipHash);
    
    if (isBanned) {
      logger.logSecurityEvent('banned_ip_access_blocked', {
        ip: userIP,
        url: req.originalUrl,
        method: req.method
      });
      
      return res.status(403).json({
        error: 'Accès temporairement restreint pour cette adresse IP',
        code: 'IP_BANNED'
      });
    }
    
    next();
    
  } catch (error) {
    logger.logError(error, { middleware: 'checkBannedIP' });
    // En cas d'erreur, laisser passer (fail open)
    next();
  }
};

// ============================================================================
// MIDDLEWARE D'ENRICHISSEMENT UTILISATEUR
// ============================================================================

/**
 * Middleware qui enrichit les informations utilisateur
 */
const enrichUserData = async (req, res, next) => {
  try {
    if (req.user && req.user.isAuthenticated) {
      // Récupérer la localisation utilisateur
      const locationResult = await db.query(
        'SELECT * FROM user_locations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [req.user.userId]
      );
      
      if (locationResult.rows.length > 0) {
        req.user.location = {
          country: locationResult.rows[0].country,
          city: locationResult.rows[0].city,
          latitude: locationResult.rows[0].latitude,
          longitude: locationResult.rows[0].longitude
        };
      }
      
      // Récupérer les préférences utilisateur
      const userResult = await db.getUserById(req.user.userId);
      if (userResult.rows.length > 0) {
        req.user.preferences = userResult.rows[0].preferences || {};
        req.user.stats = userResult.rows[0].stats || {};
      }
    }
    
    next();
    
  } catch (error) {
    logger.logError(error, { middleware: 'enrichUserData' });
    // En cas d'erreur, continuer sans enrichissement
    next();
  }
};

// ============================================================================
// MIDDLEWARE DE LOGGING DES REQUÊTES
// ============================================================================

/**
 * Middleware de logging des requêtes authentifiées
 */
const logAuthenticatedRequests = (req, res, next) => {
  if (req.user && req.user.isAuthenticated) {
    const startTime = Date.now();
    
    // Override de la fonction end de la réponse
    const originalEnd = res.end;
    res.end = function(...args) {
      const duration = Date.now() - startTime;
      
      logger.logRequestPerformance(req, res, duration);
      
      // Appeler la fonction end originale
      originalEnd.apply(this, args);
    };
  }
  
  next();
};

// ============================================================================
// UTILITAIRES D'AUTHENTIFICATION
// ============================================================================

/**
 * Générer un token JWT
 */
function generateToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, process.env.JWT_SECRET || 'libekoo_jwt_secret_2024', {
    expiresIn,
    issuer: 'libekoo.me',
    audience: 'libekoo-users'
  });
}

/**
 * Vérifier un token JWT
 */
function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET || 'libekoo_jwt_secret_2024', {
    issuer: 'libekoo.me',
    audience: 'libekoo-users'
  });
}

/**
 * Extraire les informations utilisateur depuis un token
 */
async function getUserFromToken(token) {
  try {
    const decoded = verifyToken(token);
    const session = await redisClient.getUserSession(decoded.userId);
    
    if (!session) {
      return null;
    }
    
    const userResult = await db.getUserById(decoded.userId);
    if (userResult.rows.length === 0) {
      return null;
    }
    
    return {
      ...decoded,
      dbUser: userResult.rows[0],
      session
    };
    
  } catch (error) {
    return null;
  }
}

// ============================================================================
// MIDDLEWARE DE NETTOYAGE DES SESSIONS
// ============================================================================

/**
 * Middleware de nettoyage des sessions expirées
 */
const cleanupExpiredSessions = async (req, res, next) => {
  try {
    // Nettoyer périodiquement (1 fois sur 100 requêtes)
    if (Math.random() < 0.01) {
      // Nettoyer les sessions expirées en arrière-plan
      setImmediate(async () => {
        try {
          const keys = await redisClient.client.keys('user_session:*');
          let cleanedCount = 0;
          
          for (const key of keys) {
            const ttl = await redisClient.client.ttl(key);
            if (ttl === -1) {
              // Pas d'expiration définie, définir une expiration par défaut
              await redisClient.client.expire(key, 7 * 24 * 3600); // 7 jours
            } else if (ttl === -2) {
              // Clé expirée, compter
              cleanedCount++;
            }
          }
          
          if (cleanedCount > 0) {
            logger.info(`Nettoyage sessions: ${cleanedCount} sessions expirées supprimées`);
          }
          
        } catch (error) {
          logger.logError(error, { task: 'cleanupExpiredSessions' });
        }
      });
    }
    
  } catch (error) {
    logger.logError(error, { middleware: 'cleanupExpiredSessions' });
  }
  
  next();
};

// ============================================================================
// EXPORT DU MODULE
// ============================================================================

module.exports = {
  // Middlewares principaux
  authMiddleware,
  requireAuth,
  requireAdmin,
  
  // Middlewares de permissions
  requirePermission,
  getUserPermissions,
  
  // Middlewares de sécurité
  checkBannedIP,
  
  // Middlewares d'enrichissement
  enrichUserData,
  logAuthenticatedRequests,
  cleanupExpiredSessions,
  
  // Utilitaires
  generateToken,
  verifyToken,
  getUserFromToken
};
