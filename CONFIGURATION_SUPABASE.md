# 🚀 Configuration Supabase LiberTalk - Guide Complet

## 📋 Étapes de Configuration

### 1. Exécuter la Migration SQL

1. **Connectez-vous à votre dashboard Supabase** : [supabase.com](https://supabase.com)
2. **Ouvrez votre projet LiberTalk**
3. **Allez dans "SQL Editor"** (menu de gauche)
4. **Cliquez sur "New query"**
5. **Copiez TOUT le contenu** du fichier `supabase/migrations/20250616161000_libertalk_complete.sql`
6. **Collez-le dans l'éditeur**
7. **Cliquez sur "Run"** (bouton vert)

### 2. Activer les Abonnements Temps Réel

Dans votre dashboard Supabase :

1. **Allez dans "Settings" > "API"**
2. **Scrollez jusqu'à "Realtime"**
3. **Activez ces tables** :
   - ✅ `online_users`
   - ✅ `random_chat_users`
   - ✅ `random_chat_sessions`
   - ✅ `random_chat_messages`
   - ✅ `groups`
   - ✅ `group_members`
   - ✅ `video_sessions`
   - ✅ `chat_sessions`
   - ✅ `chat_messages`
   - ✅ `user_accounts`

### 3. Vérifier les Variables d'Environnement

Votre fichier `.env` doit contenir :

```env
VITE_SUPABASE_URL=https://oyixnfbtrgymlakemvge.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95aXhuZmJ0cmd5bWxha2VtdmdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAwNDQ5NTcsImV4cCI6MjA2NTYyMDk1N30.r5QoO-z2Tx6E3y2jZiXdUbYgrU1Iq_CRBh9DAa_2odo
```

## 🏗️ Architecture de la Base de Données

### 📊 Tables Principales

#### 1. **user_accounts** - Comptes Utilisateurs
- Gestion des pseudos, genres, localisations
- Système de points et niveaux (gamification)
- Préférences personnalisées
- Statistiques d'utilisation

#### 2. **online_users** - Présence Temps Réel
- Statuts en ligne (online, chat, video, group)
- Localisation en temps réel
- Heartbeat automatique
- Nettoyage automatique des inactifs

#### 3. **random_chat_users** - Chat Randomisé
- File d'attente pour matching
- Préférences de genre et localisation
- Support autoswitch
- Couleurs automatiques par genre

#### 4. **random_chat_sessions** - Sessions Chat
- Gestion des correspondances
- Support autoswitch avancé
- Évaluations mutuelles
- Statistiques de session

#### 5. **random_chat_messages** - Messages Colorés
- Messages avec couleurs automatiques :
  - 🩷 **Rose (#FF69B4)** pour les femmes
  - 🔵 **Bleu (#1E90FF)** pour les hommes
  - ⚪ **Gris (#A9A9A9)** pour les autres
- Support multimédia
- Horodatage précis

#### 6. **groups** - Groupes Dynamiques
- Auto-suppression si inactifs
- Gestion des membres en temps réel
- Catégorisation et tags
- Statistiques d'activité

#### 7. **video_sessions** - Appels Vidéo
- Configuration WebRTC/Jitsi
- Statistiques de qualité
- Gestion des salles
- Métadonnées d'appel

#### 8. **badges** & **user_badges** - Gamification
- Système de badges automatique
- Points et niveaux
- Achievements en temps réel
- Progression trackée

### 🔧 Fonctionnalités Avancées

#### ⚡ Nettoyage Automatique
```sql
-- Utilisateurs inactifs (5 min)
SELECT cleanup_inactive_users();

-- Groupes inactifs (30 min)
SELECT cleanup_inactive_groups();

-- Mémoire expirée
SELECT cleanup_expired_memory();
```

#### 📊 Statistiques Temps Réel
```sql
-- Stats globales
SELECT * FROM get_live_stats();

-- Stats chat randomisé
SELECT * FROM get_random_chat_stats();

-- Dashboard live
SELECT * FROM live_dashboard;
```

#### 🎯 Matching Intelligent
```sql
-- Recherche de partenaire
SELECT * FROM find_random_chat_partner('user_id', 'France');

-- Création de session
SELECT create_random_chat_session(
  'user1', 'Alice', 'femme',
  'user2', 'Bob', 'homme'
);
```

#### 🏆 Système de Points
```sql
-- Attribuer des points
SELECT award_points('user_id', 50, 'Premier chat');

-- Vérifier les achievements
SELECT check_achievements('user_id');
```

## 🔒 Sécurité et Performance

### 🛡️ Row Level Security (RLS)
- **Activé sur toutes les tables**
- **Policies permissives** pour le développement
- **Prêt pour durcissement** en production

### ⚡ Indexes Optimisés
- **40+ indexes** pour performance maximale
- **Recherches ultra-rapides** par genre, localisation, statut
- **Queries optimisées** pour le temps réel

### 🧹 Gestion des Déconnexions
- **Détection automatique** des utilisateurs inactifs
- **Nettoyage intelligent** des sessions orphelines
- **Heartbeat système** pour maintenir la présence

## 🎮 Fonctionnalités Implémentées

### ✅ Chat Randomisé Avancé
- **Matching par genre et localisation**
- **Autoswitch automatique** (30s)
- **Messages colorés** par genre
- **File d'attente intelligente**

### ✅ Groupes Dynamiques
- **Création/suppression temps réel**
- **Auto-nettoyage** des groupes inactifs
- **Gestion des rôles** (owner, moderator, member)
- **Statistiques détaillées**

### ✅ Appels Vidéo (WebRTC Ready)
- **Configuration Jitsi** intégrée
- **Salles uniques** générées automatiquement
- **Statistiques de qualité** en temps réel
- **Gestion des permissions** audio/vidéo

### ✅ Gamification Complète
- **7 badges par défaut** configurés
- **Système de points** automatique
- **Niveaux progressifs** (100 points/niveau)
- **Achievements trackés** en temps réel

### ✅ Logs de Débogage
- **Logging centralisé** pour toutes les actions
- **Niveaux de log** (DEBUG, INFO, WARN, ERROR)
- **Nettoyage automatique** (7 jours)
- **Traçabilité complète**

## 🚀 Démarrage Rapide

### 1. Vérification de l'Installation
```sql
SELECT * FROM verify_libertalk_installation();
```

### 2. Test des Fonctionnalités
```sql
-- Voir les utilisateurs de démo
SELECT * FROM user_accounts;

-- Voir les groupes actifs
SELECT * FROM groups WHERE is_active = true;

-- Voir les badges disponibles
SELECT * FROM badges;
```

### 3. Monitoring en Temps Réel
```sql
-- Dashboard complet
SELECT * FROM live_dashboard;

-- Stats détaillées
SELECT * FROM get_live_stats();
```

## 🎯 Prochaines Étapes

1. **✅ Base de données configurée** - Architecture complète déployée
2. **🔄 Tests en cours** - Vérification des fonctionnalités
3. **🚀 Prêt pour utilisation** - Toutes les fonctionnalités opérationnelles

## 📞 Support

Si vous rencontrez des problèmes :

1. **Vérifiez les logs** : `SELECT * FROM debug_logs ORDER BY created_at DESC LIMIT 10;`
2. **Testez la connexion** : `SELECT * FROM get_live_stats();`
3. **Vérifiez Realtime** : Assurez-vous que toutes les tables sont activées
4. **Consultez la console** : Recherchez les erreurs JavaScript

---

**🎉 Votre base de données LiberTalk est maintenant configurée et optimisée pour une performance maximale !**