// ============================================================================
// ROUTES D'AUTHENTIFICATION
// Fichier : /var/www/libekoo/backend/routes/auth.js
// ============================================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const geoip = require('geoip-lite');
const crypto = require('crypto');

const db = require('../config/database');
const redisClient = require('../config/redis');
const logger = require('../config/logger');
const moderationService = require('../services/moderationService');

const router = express.Router();

// ============================================================================
// RATE LIMITING SPÉCIFIQUE
// ============================================================================

// Rate limiting pour les tentatives de connexion
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives par IP
  message: { error: 'Trop de tentatives de connexion, réessayez dans 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting pour la création de compte
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5, // 5 créations par IP par heure
  message: { error: 'Trop de créations de compte, réessayez dans 1 heure' },
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================================================
// UTILITAIRES
// ============================================================================

/**
 * Générer un hash sécurisé de l'IP
 */
function hashIP(ip) {
  return crypto.createHash('sha256').update(ip + process.env.IP_SALT || 'libekoo_salt').digest('hex');
}

/**
 * Extraire la géolocalisation depuis l'IP
 */
function getLocationFromIP(ip) {
  try {
    const geo = geoip.lookup(ip);
    if (geo) {
      return {
        country: geo.country,
        city: geo.city || 'Inconnue',
        region: geo.region,
        latitude: geo.ll ? geo.ll[0] : null,
        longitude: geo.ll ? geo.ll[1] : null,
        timezone: geo.timezone
      };
    }
  } catch (error) {
    logger.warn('Erreur géolocalisation IP:', error);
  }
  
  // Valeurs par défaut
  return {
    country: 'FR',
    city: 'Paris',
    region: 'IDF',
    latitude: 48.8566,
    longitude: 2.3522,
    timezone: 'Europe/Paris'
  };
}

/**
 * Générer un token JWT
 */
function generateToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET || 'libekoo_jwt_secret_2024', {
    expiresIn: '7d'
  });
}

/**
 * Générer un ID utilisateur anonyme
 */
function generateAnonymousId() {
  return `anon_${crypto.randomBytes(8).toString('hex')}_${Date.now()}`;
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/auth/anonymous
 * Créer une session anonyme
 */
router.post('/anonymous', async (req, res) => {
  try {
    const { gender, preferences } = req.body;
    const userIP = req.userIP;
    const ipHash = hashIP(userIP);
    
    logger.logUserActivity('anonymous', 'session_creation_attempt', { ip: userIP });
    
    // Vérifier si l'IP est bannie
    const isBanned = await moderationService.checkBannedIP(ipHash);
    if (isBanned) {
      logger.logSecurityEvent('banned_ip_access_attempt', { ip: userIP }, 'warning');
      return res.status(403).json({ 
        error: 'Accès temporairement restreint',
        code: 'IP_BANNED'
      });
    }
    
    // Générer ID utilisateur anonyme
    const userId = generateAnonymousId();
    const location = getLocationFromIP(userIP);
    
    // Créer utilisateur anonyme dans la DB
    const userData = {
      user_id: userId,
      username: `Anonyme_${userId.slice(-6)}`,
      gender: gender || 'non-specifie',
      country: location.country,
      city: location.city,
      ip_hash: ipHash,
      account_type: 'anonymous',
      preferences: preferences || {}
    };
    
    await db.insertUser(userData);
    
    // Stocker la localisation
    await db.query(`
      INSERT INTO user_locations (user_id, ip_hash, country, country_code, city, latitude, longitude, timezone)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      userId, ipHash, location.country, location.country,
      location.city, location.latitude, location.longitude, location.timezone
    ]);
    
    // Générer token
    const token = generateToken({
      userId,
      userType: 'anonymous',
      gender: userData.gender
    });
    
    // Stocker session dans Redis
    await redisClient.setUserSession(userId, {
      userId,
      userType: 'anonymous',
      gender: userData.gender,
      location,
      ipHash,
      createdAt: new Date().toISOString()
    }, 3600 * 24); // 24h
    
    // Mettre à jour le statut utilisateur
    await db.updateUserStatus(userId, 'online');
    
    logger.logUserActivity(userId, 'anonymous_session_created', location);
    
    res.json({
      success: true,
      user: {
        id: userId,
        username: userData.username,
        type: 'anonymous',
        gender: userData.gender,
        location: {
          country: location.country,
          city: location.city
        }
      },
      token,
      expiresIn: '24h'
    });
    
  } catch (error) {
    logger.logError(error, { route: '/auth/anonymous', ip: req.userIP });
    res.status(500).json({ 
      error: 'Erreur création session anonyme',
      code: 'SESSION_CREATION_ERROR'
    });
  }
});

/**
 * POST /api/auth/register
 * Inscription utilisateur
 */
router.post('/register', 
  registerLimiter,
  [
    body('username')
      .isLength({ min: 3, max: 20 })
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('Nom d\'utilisateur invalide (3-20 caractères, lettres, chiffres, - et _ uniquement)'),
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Email invalide'),
    body('password')
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Mot de passe invalide (8+ caractères, 1 minuscule, 1 majuscule, 1 chiffre)'),
    body('gender')
      .isIn(['homme', 'femme', 'non-binaire', 'non-specifie'])
      .withMessage('Genre invalide'),
    body('ageRange')
      .optional()
      .isIn(['13-17', '18-24', '25-34', '35-44', '45+'])
      .withMessage('Tranche d\'âge invalide')
  ],
  async (req, res) => {
    try {
      // Vérifier les erreurs de validation
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Données invalides',
          details: errors.array()
        });
      }
      
      const { username, email, password, gender, ageRange, bio } = req.body;
      const userIP = req.userIP;
      const ipHash = hashIP(userIP);
      
      logger.logUserActivity(email, 'registration_attempt', { ip: userIP });
      
      // Vérifier si l'IP est bannie
      const isBanned = await moderationService.checkBannedIP(ipHash);
      if (isBanned) {
        return res.status(403).json({ error: 'Accès temporairement restreint' });
      }
      
      // Vérifier si l'email existe déjà
      const existingUser = await db.getUserByEmail(email);
      if (existingUser.rows.length > 0) {
        return res.status(409).json({ 
          error: 'Email déjà utilisé',
          code: 'EMAIL_EXISTS'
        });
      }
      
      // Vérifier si le nom d'utilisateur existe
      const existingUsername = await db.query(
        'SELECT user_id FROM users WHERE username = $1', 
        [username]
      );
      if (existingUsername.rows.length > 0) {
        return res.status(409).json({ 
          error: 'Nom d\'utilisateur déjà pris',
          code: 'USERNAME_EXISTS'
        });
      }
      
      // Hasher le mot de passe
      const passwordHash = await bcrypt.hash(password, 12);
      
      // Générer ID utilisateur
      const userId = `user_${crypto.randomBytes(8).toString('hex')}`;
      const location = getLocationFromIP(userIP);
      
      // Créer utilisateur en base
      const userData = {
        user_id: userId,
        username,
        email,
        password_hash: passwordHash,
        gender,
        age_range: ageRange,
        bio,
        country: location.country,
        city: location.city,
        ip_hash: ipHash,
        account_type: 'registered',
        preferences: req.body.preferences || {}
      };
      
      await db.insertUser(userData);
      
      // Stocker la localisation
      await db.query(`
        INSERT INTO user_locations (user_id, ip_hash, country, country_code, city, latitude, longitude, timezone)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        userId, ipHash, location.country, location.country,
        location.city, location.latitude, location.longitude, location.timezone
      ]);
      
      // Générer token
      const token = generateToken({
        userId,
        userType: 'registered',
        email,
        username,
        gender
      });
      
      // Stocker session dans Redis
      await redisClient.setUserSession(userId, {
        userId,
        username,
        email,
        userType: 'registered',
        gender,
        location,
        ipHash,
        createdAt: new Date().toISOString()
      }, 3600 * 24 * 7); // 7 jours
      
      logger.logUserActivity(userId, 'user_registered', { email, location });
      
      res.status(201).json({
        success: true,
        message: 'Inscription réussie',
        user: {
          id: userId,
          username,
          email,
          type: 'registered',
          gender,
          location: {
            country: location.country,
            city: location.city
          }
        },
        token,
        expiresIn: '7d'
      });
      
    } catch (error) {
      logger.logError(error, { route: '/auth/register', ip: req.userIP });
      res.status(500).json({ 
        error: 'Erreur lors de l\'inscription',
        code: 'REGISTRATION_ERROR'
      });
    }
  }
);

/**
 * POST /api/auth/login
 * Connexion utilisateur
 */
router.post('/login',
  loginLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
    body('password').notEmpty().withMessage('Mot de passe requis')
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
      
      const { email, password } = req.body;
      const userIP = req.userIP;
      const ipHash = hashIP(userIP);
      
      logger.logUserActivity(email, 'login_attempt', { ip: userIP });
      
      // Vérifier si l'IP est bannie
      const isBanned = await moderationService.checkBannedIP(ipHash);
      if (isBanned) {
        return res.status(403).json({ error: 'Accès temporairement restreint' });
      }
      
      // Récupérer utilisateur
      const userResult = await db.getUserByEmail(email);
      if (userResult.rows.length === 0) {
        logger.logSecurityEvent('login_failed_user_not_found', { email, ip: userIP });
        return res.status(401).json({ 
          error: 'Email ou mot de passe incorrect',
          code: 'INVALID_CREDENTIALS'
        });
      }
      
      const user = userResult.rows[0];
      
      // Vérifier si l'utilisateur est banni
      if (user.is_banned) {
        logger.logSecurityEvent('banned_user_login_attempt', { userId: user.user_id, ip: userIP });
        return res.status(403).json({ 
          error: 'Compte temporairement suspendu',
          code: 'USER_BANNED'
        });
      }
      
      // Vérifier le mot de passe
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch) {
        logger.logSecurityEvent('login_failed_wrong_password', { email, ip: userIP });
        return res.status(401).json({ 
          error: 'Email ou mot de passe incorrect',
          code: 'INVALID_CREDENTIALS'
        });
      }
      
      // Mise à jour de la géolocalisation
      const location = getLocationFromIP(userIP);
      await db.query(`
        UPDATE users SET 
          ip_hash = $2, country = $3, city = $4, last_active = NOW()
        WHERE user_id = $1
      `, [user.user_id, ipHash, location.country, location.city]);
      
      // Générer token
      const token = generateToken({
        userId: user.user_id,
        userType: 'registered',
        email: user.email,
        username: user.username,
        gender: user.gender
      });
      
      // Stocker session dans Redis
      await redisClient.setUserSession(user.user_id, {
        userId: user.user_id,
        username: user.username,
        email: user.email,
        userType: 'registered',
        gender: user.gender,
        location,
        ipHash,
        lastLogin: new Date().toISOString()
      }, 3600 * 24 * 7); // 7 jours
      
      // Mettre à jour le statut utilisateur
      await db.updateUserStatus(user.user_id, 'online');
      
      logger.logUserActivity(user.user_id, 'user_logged_in', location);
      
      res.json({
        success: true,
        message: 'Connexion réussie',
        user: {
          id: user.user_id,
          username: user.username,
          email: user.email,
          type: 'registered',
          gender: user.gender,
          points: user.points,
          level: user.level,
          location: {
            country: location.country,
            city: location.city
          }
        },
        token,
        expiresIn: '7d'
      });
      
    } catch (error) {
      logger.logError(error, { route: '/auth/login', ip: req.userIP });
      res.status(500).json({ 
        error: 'Erreur lors de la connexion',
        code: 'LOGIN_ERROR'
      });
    }
  }
);

/**
 * POST /api/auth/logout
 * Déconnexion utilisateur
 */
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'libekoo_jwt_secret_2024');
        
        // Supprimer la session Redis
        await redisClient.deleteUserSession(decoded.userId);
        
        // Mettre à jour le statut utilisateur
        await db.updateUserStatus(decoded.userId, 'offline');
        
        logger.logUserActivity(decoded.userId, 'user_logged_out');
        
      } catch (jwtError) {
        logger.warn('Token invalide lors de la déconnexion:', jwtError.message);
      }
    }
    
    res.json({
      success: true,
      message: 'Déconnexion réussie'
    });
    
  } catch (error) {
    logger.logError(error, { route: '/auth/logout' });
    res.status(500).json({ 
      error: 'Erreur lors de la déconnexion',
      code: 'LOGOUT_ERROR'
    });
  }
});

/**
 * POST /api/auth/refresh
 * Renouveler le token
 */
router.post('/refresh', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'libekoo_jwt_secret_2024');
      
      // Vérifier si la session existe encore
      const session = await redisClient.getUserSession(decoded.userId);
      if (!session) {
        return res.status(401).json({ error: 'Session expirée' });
      }
      
      // Générer nouveau token
      const newToken = generateToken({
        userId: decoded.userId,
        userType: decoded.userType,
        email: decoded.email,
        username: decoded.username,
        gender: decoded.gender
      });
      
      // Prolonger la session Redis
      await redisClient.setUserSession(decoded.userId, session, 3600 * 24 * 7);
      
      res.json({
        success: true,
        token: newToken,
        expiresIn: '7d'
      });
      
    } catch (jwtError) {
      return res.status(401).json({ error: 'Token invalide' });
    }
    
  } catch (error) {
    logger.logError(error, { route: '/auth/refresh' });
    res.status(500).json({ 
      error: 'Erreur renouvellement token',
      code: 'REFRESH_ERROR'
    });
  }
});

/**
 * GET /api/auth/me
 * Récupérer les informations utilisateur
 */
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'libekoo_jwt_secret_2024');
      
      // Récupérer utilisateur depuis la DB
      const userResult = await db.getUserById(decoded.userId);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }
      
      const user = userResult.rows[0];
      
      // Récupérer session Redis pour infos supplémentaires
      const session = await redisClient.getUserSession(decoded.userId);
      
      res.json({
        success: true,
        user: {
          id: user.user_id,
          username: user.username,
          email: user.email,
          type: user.account_type,
          gender: user.gender,
          bio: user.bio,
          points: user.points,
          level: user.level,
          badges: user.badges,
          stats: user.stats,
          location: {
            country: user.country,
            city: user.city
          },
          preferences: user.preferences,
          createdAt: user.created_at,
          lastActive: user.last_active
        }
      });
      
    } catch (jwtError) {
      return res.status(401).json({ error: 'Token invalide' });
    }
    
  } catch (error) {
    logger.logError(error, { route: '/auth/me' });
    res.status(500).json({ 
      error: 'Erreur récupération utilisateur',
      code: 'USER_FETCH_ERROR'
    });
  }
});

module.exports = router;
