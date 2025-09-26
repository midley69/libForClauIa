#!/bin/bash

# ============================================================================
# SCRIPT D'INSTALLATION BASE DE DONNÉES LIBEKOO
# Fichier : /var/www/libekoo/scripts/setup-database.sh
# ============================================================================

echo "🚀 Installation de la base de données Libekoo..."

# Variables de configuration
DB_NAME="libekoo_db"
DB_USER="libekoo_user"
DB_PASSWORD="LibeKoo2024!SecureDB"
SCRIPT_DIR="/var/www/libekoo/database"

# 1. Créer le répertoire des scripts de base de données
mkdir -p $SCRIPT_DIR

# 2. Créer le fichier schema.sql avec le contenu complet
cat > $SCRIPT_DIR/schema.sql << 'EOF'
[Le contenu SQL complet du schéma précédent sera ici]
EOF

# 3. Appliquer le schéma à la base de données
echo "📊 Application du schéma de base de données..."
sudo -u postgres psql -d $DB_NAME << EOSQL
-- Connexion à la base de données Libekoo
\c $DB_NAME;

-- Vérification des extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Import du schéma complet
\i $SCRIPT_DIR/schema.sql

-- Vérification des tables créées
\dt

-- Statistiques
SELECT schemaname, tablename, attname, n_distinct, correlation 
FROM pg_stats 
WHERE schemaname = 'public' 
ORDER BY tablename, attname;

EOSQL

# 4. Créer un fichier de configuration de connexion pour l'application
cat > $SCRIPT_DIR/db-config.json << EOF
{
  "development": {
    "host": "localhost",
    "port": 5432,
    "database": "$DB_NAME",
    "username": "$DB_USER",
    "password": "$DB_PASSWORD",
    "dialect": "postgres",
    "logging": true,
    "pool": {
      "max": 10,
      "min": 1,
      "acquire": 30000,
      "idle": 10000
    }
  },
  "production": {
    "host": "localhost",
    "port": 5432,
    "database": "$DB_NAME",
    "username": "$DB_USER",
    "password": "$DB_PASSWORD",
    "dialect": "postgres",
    "logging": false,
    "pool": {
      "max": 20,
      "min": 2,
      "acquire": 30000,
      "idle": 10000
    }
  }
}
EOF

# 5. Test de connexion
echo "🔍 Test de connexion à la base de données..."
sudo -u postgres psql -d $DB_NAME -c "SELECT version();"
sudo -u postgres psql -d $DB_NAME -c "SELECT COUNT(*) as total_tables FROM information_schema.tables WHERE table_schema = 'public';"

# 6. Création d'un utilisateur de backup
sudo -u postgres psql << EOF
CREATE USER libekoo_backup WITH PASSWORD 'BackupLibeKoo2024!';
GRANT CONNECT ON DATABASE $DB_NAME TO libekoo_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO libekoo_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO libekoo_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO libekoo_backup;
\q
EOF

# 7. Script de sauvegarde automatique
cat > /var/www/libekoo/scripts/backup-database.sh << 'EOF'
#!/bin/bash

# Variables
BACKUP_DIR="/var/backups/libekoo"
DB_NAME="libekoo_db"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/libekoo_backup_$DATE.sql"

# Créer le répertoire de backup
mkdir -p $BACKUP_DIR

# Effectuer la sauvegarde
echo "🔄 Sauvegarde de la base de données..."
sudo -u postgres pg_dump $DB_NAME > $BACKUP_FILE

# Compresser la sauvegarde
gzip $BACKUP_FILE

# Nettoyer les anciennes sauvegardes (garder 7 jours)
find $BACKUP_DIR -name "libekoo_backup_*.sql.gz" -mtime +7 -delete

echo "✅ Sauvegarde terminée : ${BACKUP_FILE}.gz"
EOF

# Rendre les scripts exécutables
chmod +x /var/www/libekoo/scripts/*.sh

# 8. Configurer une sauvegarde quotidienne via cron
(crontab -l 2>/dev/null; echo "0 2 * * * /var/www/libekoo/scripts/backup-database.sh") | crontab -

# 9. Afficher un résumé
echo ""
echo "✅ Configuration base de données terminée !"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Base de données : $DB_NAME"
echo "👤 Utilisateur : $DB_USER"
echo "🔐 Mot de passe : $DB_PASSWORD"
echo "📂 Répertoire config : $SCRIPT_DIR"
echo "💾 Sauvegardes : /var/backups/libekoo"
echo "⏰ Backup automatique : 2h00 chaque jour"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 10. Instructions pour la suite
echo "🔄 Étapes suivantes :"
echo "1. Vérifier que toutes les tables ont été créées"
echo "2. Configurer le backend Node.js"
echo "3. Tester les connexions"
echo ""
echo "Pour vérifier les tables :"
echo "sudo -u postgres psql -d $DB_NAME -c '\\dt'"
