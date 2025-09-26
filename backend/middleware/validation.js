// ============================================================================
// MIDDLEWARE DE VALIDATION DES DONNÉES
// Fichier : /var/www/libekoo/backend/middleware/validation.js
// ============================================================================

const { body, query, param, validationResult } = require('express-validator');
const logger = require('../config/logger');

// ============================================================================
// UTILITAIRES DE VALIDATION
// ============================================================================

/**
 * Middleware pour gérer les erreurs de validation
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value,
      location: error.location
    }));
    
    logger.logSecurityEvent('validation_failed', {
      url: req.originalUrl,
      method: req.method,
      errors: formattedErrors,
      ip: req.userIP,
      userId: req.user?.userId
    });
    
    return res.status(400).json({
      error: 'Données invalides',
      code: 'VALIDATION_ERROR',
      details: formattedErrors
    });
  }
  
  next();
};

/**
 * Sanitiser et normaliser les chaînes de caractères
 */
const sanitizeString = (value) => {
  if (typeof value !== 'string') return value;
  
  return value
    .trim()
    .replace(/\s+/g, ' ') // Remplacer les espaces multiples par un seul
    .replace(/[^\w\s\-\.@]/gi, '') // Supprimer les caractères spéciaux dangereux
    .substring(0, 1000); // Limiter la longueur
};

/**
 * Valider qu'une valeur n'est pas dans une liste noire
 */
const notInBlacklist = (blacklist) => {
  return (value) => {
    if (blacklist.includes(value.toLowerCase())) {
      throw new Error('Valeur non autorisée');
    }
    return true;
  };
};

/**
 * Valider un nom d'utilisateur
 */
const isValidUsername = (value) => {
  const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
  if (!usernameRegex.test(value)) {
    throw new Error('Nom d\'utilisateur invalide (3-20 caractères, lettres, chiffres, _ et - uniquement)');
  }
  
  // Mots interdits
  const forbiddenWords = [
    'admin', 'administrator', 'moderator', 'mod', 'system', 'root',
    'libekoo', 'support', 'help', 'bot', 'null', 'undefined'
  ];
  
  if (forbiddenWords.some(word => value.toLowerCase().includes(word))) {
    throw new Error('Ce nom d\'utilisateur n\'est pas autorisé');
  }
  
  return true;
};

/**
 * Valider un mot de passe
 */
const isValidPassword = (value) => {
  if (value.length < 8) {
    throw new Error('Le mot de passe doit contenir au moins 8 caractères');
  }
  
  if (!/(?=.*[a-z])/.test(value)) {
    throw new Error('Le mot de passe doit contenir au moins une minuscule');
  }
  
  if (!/(?=.*[A-Z])/.test(value)) {
    throw new Error('Le mot de passe doit contenir au moins une majuscule');
  }
  
  if (!/(?=.*\d)/.test(value)) {
    throw new Error('Le mot de passe doit contenir au moins un chiffre');
  }
  
  // Vérifier les mots de passe trop communs
  const commonPasswords = [
    'password', '123456', '123456789', 'qwerty', 'abc123',
    'password123', 'admin', 'letmein', 'welcome', 'monkey'
  ];
  
  if (commonPasswords.includes(value.toLowerCase())) {
    throw new Error('Ce mot de passe est trop commun');
  }
  
  return true;
};

/**
 * Valider un contenu de message
 */
const isValidMessageContent = (value) => {
  if (!value || value.trim().length === 0) {
    throw new Error('Le message ne peut pas être vide');
  }
  
  if (value.length > 1000) {
    throw new Error('Message trop long (1000 caractères maximum)');
  }
  
  // Vérifier les caractères de contrôle
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value)) {
    throw new Error('Caractères de contrôle non autorisés');
  }
  
  return true;
};

// ============================================================================
// VALIDATEURS PAR DOMAINE
// ============================================================================

/**
 * Validateurs pour l'authentification
 */
const authValidators = {
  register: [
    body('username')
      .isLength({ min: 3, max: 20 })
      .custom(isValidUsername)
      .customSanitizer(sanitizeString),
    
    body('email')
      .isEmail()
      .normalizeEmail()
      .isLength({ max: 254 }),
    
    body('password')
      .custom(isValidPassword),
    
    body('gender')
      .optional()
      .isIn(['homme', 'femme', 'non-binaire', 'non-specifie']),
    
    body('ageRange')
      .optional()
      .isIn(['13-17', '18-24', '25-34', '35-44', '45+']),
    
    body('bio')
      .optional()
      .isLength({ max: 500 })
      .customSanitizer(sanitizeString),
    
    body('preferences')
      .optional()
      .isObject()
  ],
  
  login: [
    body('email')
      .isEmail()
      .normalizeEmail(),
    
    body('password')
      .notEmpty()
      .withMessage('Mot de passe requis')
  ],
  
  anonymous: [
    body('gender')
      .optional()
      .isIn(['homme', 'femme', 'non-binaire', 'non-specifie']),
    
    body('preferences')
      .optional()
      .isObject()
  ]
};

/**
 * Validateurs pour le chat
 */
const chatValidators = {
  sendMessage: [
    body('sessionId')
      .notEmpty()
      .isUUID()
      .withMessage('ID de session invalide'),
    
    body('content')
      .custom(isValidMessageContent)
      .customSanitizer(sanitizeString),
    
    body('messageType')
      .optional()
      .isIn(['text', 'emoji', 'image', 'file'])
      .withMessage('Type de message invalide'),
    
    body('metadata')
      .optional()
      .isObject()
  ],
  
  endSession: [
    param('sessionId')
      .isUUID()
      .withMessage('ID de session invalide'),
    
    body('rating')
      .optional()
      .isInt({ min: 1, max: 5 })
      .withMessage('Note invalide (1-5)'),
    
    body('reason')
      .optional()
      .isIn(['normal', 'timeout', 'inappropriate', 'technical'])
      .withMessage('Raison invalide')
  ],
  
  reportContent: [
    body('targetType')
      .isIn(['session', 'message', 'user'])
      .withMessage('Type de cible invalide'),
    
    body('targetId')
      .notEmpty()
      .withMessage('ID cible requis'),
    
    body('reportType')
      .isIn(['spam', 'harassment', 'inappropriate_content', 'fake_profile', 'underage', 'other'])
      .withMessage('Type de signalement invalide'),
    
    body('description')
      .optional()
      .isLength({ max: 500 })
      .customSanitizer(sanitizeString)
  ]
};

/**
 * Validateurs pour le matching
 */
const matchingValidators = {
  findPartner: [
    body('matchType')
      .isIn(['random', 'local', 'group'])
      .withMessage('Type de match invalide'),
    
    body('preferences')
      .optional()
      .isObject(),
    
    body('preferences.genderPreference')
      .optional()
      .isIn(['all', 'homme', 'femme', 'non-binaire'])
      .withMessage('Préférence de genre invalide'),
    
    body('preferences.ageRangePreference')
      .optional()
      .isIn(['all', '13-17', '18-24', '25-34', '35-44', '45+'])
      .withMessage('Préférence d\'âge invalide'),
    
    body('preferences.maxDistance')
      .optional()
      .isInt({ min: 5, max: 5000 })
      .withMessage('Distance invalide (5-5000 km)')
  ],
  
  reportUser: [
    body('reportedUserId')
      .notEmpty()
      .withMessage('ID utilisateur requis'),
    
    body('reportType')
      .isIn(['spam', 'harassment', 'inappropriate_content', 'fake_profile', 'underage', 'other'])
      .withMessage('Type de signalement invalide'),
    
    body('description')
      .optional()
      .isLength({ max: 500 })
      .customSanitizer(sanitizeString),
    
    body('sessionId')
      .optional()
      .isUUID()
      .withMessage('ID de session invalide')
  ]
};

/**
 * Validateurs pour la vidéo
 */
const videoValidators = {
  createRoom: [
    body('roomType')
      .optional()
      .isIn(['private', 'group', 'random'])
      .withMessage('Type de room invalide'),
    
    body('maxParticipants')
      .optional()
      .isInt({ min: 2, max: 4 })
      .withMessage('Nombre de participants invalide (2-4)'),
    
    body('settings')
      .optional()
      .isObject(),
    
    body('settings.audioEnabled')
      .optional()
      .isBoolean(),
    
    body('settings.videoEnabled')
      .optional()
      .isBoolean(),
    
    body('settings.screenSharingEnabled')
      .optional()
      .isBoolean()
  ],
  
  reportQuality: [
    param('roomId')
      .notEmpty()
      .withMessage('ID de room requis'),
    
    body('qualityIssues')
      .isArray()
      .withMessage('Liste des problèmes requise'),
    
    body('qualityIssues.*')
      .isIn(['poor_video', 'poor_audio', 'connection_drops', 'high_latency', 'echo', 'noise'])
      .withMessage('Problème de qualité invalide'),
    
    body('connectionStats')
      .optional()
      .isObject()
  ]
};

/**
 * Validateurs pour l'administration
 */
const adminValidators = {
  searchUsers: [
    query('search')
      .optional()
      .isLength({ max: 100 })
      .customSanitizer(sanitizeString),
    
    query('status')
      .optional()
      .isIn(['online', 'offline', 'banned', 'all']),
    
    query('type')
      .optional()
      .isIn(['anonymous', 'registered', 'admin', 'all']),
    
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 }),
    
    query('offset')
      .optional()
      .isInt({ min: 0 })
  ],
  
  banUser: [
    param('userId')
      .notEmpty()
      .withMessage('ID utilisateur requis'),
    
    body('reason')
      .notEmpty()
      .isLength({ max: 500 })
      .customSanitizer(sanitizeString)
      .withMessage('Raison requise (max 500 caractères)'),
    
    body('duration')
      .optional()
      .isInt({ min: 1, max: 8760 })
      .withMessage('Durée invalide (1-8760 heures)'),
    
    body('banType')
      .optional()
      .isIn(['temporary', 'permanent'])
      .withMessage('Type de ban invalide')
  ],
  
  processReport: [
    param('reportId')
      .isUUID()
      .withMessage('ID de signalement invalide'),
    
    body('status')
      .isIn(['investigating', 'resolved', 'dismissed'])
      .withMessage('Statut invalide'),
    
    body('adminNotes')
      .optional()
      .isLength({ max: 1000 })
      .customSanitizer(sanitizeString)
      .withMessage('Notes trop longues'),
    
    body('actionTaken')
      .optional()
      .isLength({ max: 200 })
      .customSanitizer(sanitizeString)
      .withMessage('Action trop longue')
  ]
};

/**
 * Validateurs pour les analytics
 */
const analyticsValidators = {
  getAnalytics: [
    query('period')
      .optional()
      .isIn(['hourly', 'daily', 'weekly', 'monthly'])
      .withMessage('Période invalide'),
    
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Date de début invalide'),
    
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('Date de fin invalide'),
    
    query('limit')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Limite invalide (1-1000)')
  ]
};

// ============================================================================
// VALIDATEURS GÉNÉRIQUES
// ============================================================================

/**
 * Validateurs pour les paramètres de pagination
 */
const paginationValidators = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limite invalide (1-100)'),
  
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset invalide (>= 0)')
];

/**
 * Validateurs pour les IDs UUID
 */
const uuidValidators = {
  sessionId: param('sessionId').isUUID().withMessage('ID de session invalide'),
  userId: param('userId').notEmpty().withMessage('ID utilisateur requis'),
  roomId: param('roomId').notEmpty().withMessage('ID de room requis'),
  reportId: param('reportId').isUUID().withMessage('ID de signalement invalide'),
  messageId: param('messageId').isUUID().withMessage('ID de message invalide')
};

// ============================================================================
// MIDDLEWARE DE SANITISATION
// ============================================================================

/**
 * Middleware de sanitisation générale
 */
const sanitizeRequest = (req, res, next) => {
  try {
    // Sanitiser les paramètres de requête
    if (req.query) {
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === 'string') {
          req.query[key] = sanitizeString(value);
        }
      }
    }
    
    // Sanitiser le corps de la requête (sauf les mots de passe)
    if (req.body && typeof req.body === 'object') {
      for (const [key, value] of Object.entries(req.body)) {
        if (typeof value === 'string' && !key.toLowerCase().includes('password')) {
          req.body[key] = sanitizeString(value);
        }
      }
    }
    
    next();
    
  } catch (error) {
    logger.logError(error, { middleware: 'sanitizeRequest' });
    next();
  }
};

/**
 * Middleware de validation de l'IP
 */
const validateClientIP = (req, res, next) => {
  const clientIP = req.userIP || req.ip;
  
  // Vérifier le format de l'IP
  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  
  if (!clientIP || !ipRegex.test(clientIP.split(',')[0].trim())) {
    logger.logSecurityEvent('invalid_client_ip', {
      ip: clientIP,
      url: req.originalUrl,
      userAgent: req.headers['user-agent']
    });
  }
  
  next();
};

// ============================================================================
// EXPORT DU MODULE
// ============================================================================

module.exports = {
  // Middleware principal
  handleValidationErrors,
  sanitizeRequest,
  validateClientIP,
  
  // Validateurs par domaine
  authValidators,
  chatValidators,
  matchingValidators,
  videoValidators,
  adminValidators,
  analyticsValidators,
  
  // Validateurs génériques
  paginationValidators,
  uuidValidators,
  
  // Utilitaires
  sanitizeString,
  isValidUsername,
  isValidPassword,
  isValidMessageContent,
  notInBlacklist
};
