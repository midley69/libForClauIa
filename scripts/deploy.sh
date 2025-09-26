#!/bin/bash

# ============================================================================
# SCRIPT DE DÉPLOIEMENT COMPLET LIBEKOO
# Fichier : /var/www/libekoo/scripts/deploy.sh
# ============================================================================

set -e  # Arrêter le script en cas d'erreur

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Variables de configuration
PROJECT_DIR="/var/www/libekoo"
BACKUP_DIR="/var/backups/libekoo"
LOG_FILE="/var/log/libekoo-deploy.log"
GITHUB_REPO="https://github.com/votre-repo/libekoo.git"  # À remplacer
DOMAIN="libekoo.me"
NODE_VERSION="18"

# ============================================================================
# FONCTIONS UTILITAIRES
# ============================================================================

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" >> $LOG_FILE
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    echo "[ERROR] $1" >> $LOG_FILE
    exit 1
}

warning() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
    echo "[WARNING] $1" >> $LOG_FILE
}

info() {
    echo -e "${BLUE}[INFO] $1${NC}"
    echo "[INFO] $1" >> $LOG_FILE
}

success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
    echo "[SUCCESS] $1" >> $LOG_FILE
}

# ============================================================================
# VÉRIFICATIONS PRÉLIMINAIRES
# ============================================================================

check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "Ce script doit être exécuté en tant que root (sudo)"
    fi
}

check_system() {
    info "Vérification du système..."
    
    # Vérifier Ubuntu
    if ! grep -q "Ubuntu" /etc/os-release; then
        warning "Ce script est optimisé pour Ubuntu. Certaines commandes peuvent ne pas fonctionner."
    fi
    
    # Vérifier l'espace disque
    AVAILABLE_SPACE=$(df / | awk 'NR==2 {print $4}')
    if [ $AVAILABLE_SPACE -lt 5000000 ]; then  # 5GB
        warning "Espace disque insuffisant (< 5GB disponible)"
    fi
    
    # Vérifier la RAM
    TOTAL_RAM=$(free -m | awk 'NR==2{print $2}')
    if [ $TOTAL_RAM -lt 2000 ]; then  # 2GB
        warning "RAM insuffisante (< 2GB). Performance dégradée possible."
    fi
    
    success "Vérifications système OK"
}

# ============================================================================
# INSTALLATION DES DÉPENDANCES SYSTÈME
# ============================================================================

install_system_dependencies() {
    log "Installation des dépendances système..."
    
    # Mise à jour des paquets
    apt update && apt upgrade -y
    
    # Installation des paquets essentiels
    apt install -y \
        curl \
        wget \
        git \
        unzip \
        software-properties-common \
        apt-transport-https \
        ca-certificates \
        gnupg \
        lsb-release \
        build-essential \
        python3 \
        python3-pip \
        htop \
        nano \
        vim \
        ufw \
        fail2ban \
        certbot \
        python3-certbot-nginx
    
    success "Dépendances système installées"
}

install_nodejs() {
    log "Installation de Node.js $NODE_VERSION..."
    
    # Ajouter le dépôt NodeSource
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    
    # Installer Node.js
    apt install -y nodejs
    
    # Installer PM2 globalement
    npm install -g pm2
    
    # Vérifier l'installation
    NODE_VER=$(node --version)
    NPM_VER=$(npm --version)
    PM2_VER=$(pm2 --version)
    
    info "Node.js: $NODE_VER"
    info "NPM: $NPM_VER"
    info "PM2: $PM2_VER"
    
    success "Node.js installé"
}

install_postgresql() {
    log "Installation de PostgreSQL..."
    
    # Installer PostgreSQL
    apt install -y postgresql postgresql-contrib
    
    # Démarrer et activer PostgreSQL
    systemctl start postgresql
    systemctl enable postgresql
    
    # Configurer PostgreSQL
    sudo -u postgres psql << EOF
CREATE USER libekoo_user WITH PASSWORD 'LibeKoo2024!SecureDB';
CREATE DATABASE libekoo_db OWNER libekoo_user;
GRANT ALL PRIVILEGES ON DATABASE libekoo_db TO libekoo_user;
ALTER USER libekoo_user CREATEDB;
\q
EOF
    
    success "PostgreSQL installé et configuré"
}

install_redis() {
    log "Installation de Redis..."
    
    # Installer Redis
    apt install -y redis-server
    
    # Configurer Redis
    sed -i 's/^# requirepass foobared/requirepass LibeKoo2024!SecureRedis/' /etc/redis/redis.conf
    sed -i 's/^supervised no/supervised systemd/' /etc/redis/redis.conf
    
    # Redémarrer Redis
    systemctl restart redis-server
    systemctl enable redis-server
    
    success "Redis installé et configuré"
}

install_nginx() {
    log "Installation de Nginx..."
    
    # Installer Nginx
    apt install -y nginx
    
    # Démarrer et activer Nginx
    systemctl start nginx
    systemctl enable nginx
    
    success "Nginx installé"
}

# ============================================================================
# CONFIGURATION DU PROJET
# ============================================================================

setup_project_structure() {
    log "Configuration de la structure du projet..."
    
    # Créer les répertoires nécessaires
    mkdir -p $PROJECT_DIR/{backend,frontend,database,scripts,logs,uploads,backups}
    mkdir -p $BACKUP_DIR
    mkdir -p /var/log/libekoo
    
    # Permissions
    chown -R www-data:www-data $PROJECT_DIR
    chmod -R 755 $PROJECT_DIR
    
    success "Structure du projet configurée"
}

clone_or_update_repository() {
    log "Récupération du code source..."
    
    if [ -d "$PROJECT_DIR/.git" ]; then
        info "Mise à jour du dépôt existant..."
        cd $PROJECT_DIR
        git pull origin main
    else
        info "Clonage du dépôt..."
        # Si GitHub n'est pas encore configuré, utiliser les fichiers locaux
        info "Utilisation des fichiers locaux pour cette démo"
        # git clone $GITHUB_REPO $PROJECT_DIR
    fi
    
    success "Code source récupéré"
}

install_backend_dependencies() {
    log "Installation des dépendances backend..."
    
    cd $PROJECT_DIR/backend
    
    # Copier package.json si nécessaire
    if [ ! -f "package.json" ]; then
        info "Création du package.json..."
        # Le package.json sera créé par les artefacts précédents
    fi
    
    # Installer les dépendances
    npm install --production
    
    success "Dépendances backend installées"
}

setup_environment() {
    log "Configuration de l'environnement..."
    
    # Copier le fichier .env
    if [ ! -f "$PROJECT_DIR/backend/.env" ]; then
        info "Création du fichier .env..."
        # Le fichier .env sera créé par les artefacts précédents
    fi
    
    # Générer des clés sécurisées
    JWT_SECRET=$(openssl rand -hex 32)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    HASH_SALT=$(openssl rand -hex 32)
    
    # Mettre à jour le fichier .env avec les vraies clés
    sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" $PROJECT_DIR/backend/.env
    sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$ENCRYPTION_KEY/" $PROJECT_DIR/backend/.env
    sed -i "s/HASH_SALT=.*/HASH_SALT=$HASH_SALT/" $PROJECT_DIR/backend/.env
    
    success "Environnement configuré"
}

setup_database() {
    log "Configuration de la base de données..."
    
    cd $PROJECT_DIR/backend
    
    # Exécuter les migrations
    if [ -f "$PROJECT_DIR/database/schema.sql" ]; then
        sudo -u postgres psql -d libekoo_db -f $PROJECT_DIR/database/schema.sql
        success "Schéma de base de données appliqué"
    else
        warning "Fichier de schéma non trouvé"
    fi
    
    success "Base de données configurée"
}

# ============================================================================
# CONFIGURATION NGINX
# ============================================================================

configure_nginx() {
    log "Configuration de Nginx..."
    
    # Créer la configuration Nginx
    cat > /etc/nginx/sites-available/$DOMAIN << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    
    # Redirection vers HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;
    
    # Certificats SSL (à configurer avec Certbot)
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    
    # Configuration SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Headers de sécurité
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
    
    # Configuration du proxy vers Node.js
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeout
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # WebSocket pour Socket.io
    location /socket.io/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    
    # Fichiers statiques
    location / {
        root $PROJECT_DIR/frontend/dist;
        try_files \$uri \$uri/ /index.html;
        
        # Cache des assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # Sécurité - bloquer l'accès aux fichiers sensibles
    location ~ /\. {
        deny all;
    }
    
    location ~ /(\.env|\.git|package\.json|node_modules) {
        deny all;
    }
}
EOF
    
    # Activer le site
    ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
    
    # Supprimer le site par défaut
    rm -f /etc/nginx/sites-enabled/default
    
    # Tester la configuration
    nginx -t || error "Configuration Nginx invalide"
    
    success "Nginx configuré"
}

setup_ssl() {
    log "Configuration SSL avec Let's Encrypt..."
    
    # Obtenir le certificat SSL
    certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN
    
    # Configurer le renouvellement automatique
    (crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -
    
    success "SSL configuré"
}

# ============================================================================
# CONFIGURATION DES SERVICES
# ============================================================================

setup_pm2() {
    log "Configuration de PM2..."
    
    cd $PROJECT_DIR/backend
    
    # Créer le fichier de configuration PM2
    cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'libekoo-api',
    script: './server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: '/var/log/libekoo/pm2-error.log',
    out_file: '/var/log/libekoo/pm2-out.log',
    log_file: '/var/log/libekoo/pm2-combined.log',
    time: true,
    max_memory_restart: '500M',
    node_args: '--max_old_space_size=512',
    watch: false,
    ignore_watch: ['node_modules', 'logs', 'uploads'],
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
EOF
    
    # Démarrer l'application
    pm2 start ecosystem.config.js
    
    # Sauvegarder la configuration PM2
    pm2 save
    
    # Configurer PM2 pour démarrer au boot
    pm2 startup systemd
    
    success "PM2 configuré"
}

setup_firewall() {
    log "Configuration du pare-feu..."
    
    # Réinitialiser UFW
    ufw --force reset
    
    # Règles de base
    ufw default deny incoming
    ufw default allow outgoing
    
    # Autoriser SSH
    ufw allow ssh
    
    # Autoriser HTTP et HTTPS
    ufw allow http
    ufw allow https
    
    # Autoriser les ports spécifiques
    ufw allow 3001  # API Node.js (temporaire pour debug)
    
    # Activer UFW
    ufw --force enable
    
    success "Pare-feu configuré"
}

setup_fail2ban() {
    log "Configuration de Fail2ban..."
    
    # Configurer Fail2ban pour Nginx
    cat > /etc/fail2ban/jail.local << EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log

[sshd]
enabled = true
port = ssh
logpath = /var/log/auth.log
maxretry = 3
EOF
    
    # Redémarrer Fail2ban
    systemctl restart fail2ban
    systemctl enable fail2ban
    
    success "Fail2ban configuré"
}

# ============================================================================
# MONITORING ET MAINTENANCE
# ============================================================================

setup_monitoring() {
    log "Configuration du monitoring..."
    
    # Script de monitoring
    cat > $PROJECT_DIR/scripts/monitor.sh << 'EOF'
#!/bin/bash

# Monitoring script pour Libekoo
LOGFILE="/var/log/libekoo/monitor.log"

check_service() {
    if systemctl is-active --quiet $1; then
        echo "[$(date)] $1 is running" >> $LOGFILE
    else
        echo "[$(date)] WARNING: $1 is not running" >> $LOGFILE
        systemctl restart $1
    fi
}

check_disk_space() {
    USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ $USAGE -gt 85 ]; then
        echo "[$(date)] WARNING: Disk usage is ${USAGE}%" >> $LOGFILE
    fi
}

check_service postgresql
check_service redis-server
check_service nginx
check_disk_space

# Vérifier PM2
if ! pm2 list | grep -q "online"; then
    echo "[$(date)] WARNING: PM2 processes not running" >> $LOGFILE
    pm2 restart all
fi
EOF
    
    chmod +x $PROJECT_DIR/scripts/monitor.sh
    
    # Ajouter au cron
    (crontab -l 2>/dev/null; echo "*/5 * * * * $PROJECT_DIR/scripts/monitor.sh") | crontab -
    
    success "Monitoring configuré"
}

setup_backup() {
    log "Configuration des sauvegardes..."
    
    # Script de sauvegarde
    cat > $PROJECT_DIR/scripts/backup.sh << 'EOF'
#!/bin/bash

BACKUP_DIR="/var/backups/libekoo"
DATE=$(date +"%Y%m%d_%H%M%S")

# Créer le répertoire de sauvegarde
mkdir -p $BACKUP_DIR

# Sauvegarde de la base de données
sudo -u postgres pg_dump libekoo_db > $BACKUP_DIR/db_backup_$DATE.sql
gzip $BACKUP_DIR/db_backup_$DATE.sql

# Sauvegarde des fichiers uploadés
tar -czf $BACKUP_DIR/uploads_backup_$DATE.tar.gz -C /var/www/libekoo uploads/

# Sauvegarde de la configuration
tar -czf $BACKUP_DIR/config_backup_$DATE.tar.gz -C /var/www/libekoo backend/.env scripts/ database/

# Nettoyer les anciennes sauvegardes (garder 7 jours)
find $BACKUP_DIR -name "*.gz" -mtime +7 -delete
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete

echo "[$(date)] Backup completed" >> /var/log/libekoo/backup.log
EOF
    
    chmod +x $PROJECT_DIR/scripts/backup.sh
    
    # Sauvegarde quotidienne à 2h du matin
    (crontab -l 2>/dev/null; echo "0 2 * * * $PROJECT_DIR/scripts/backup.sh") | crontab -
    
    success "Sauvegardes configurées"
}

# ============================================================================
# FONCTION PRINCIPALE
# ============================================================================

main() {
    log "🚀 Début du déploiement de Libekoo"
    
    # Vérifications
    check_root
    check_system
    
    # Installation des dépendances
    install_system_dependencies
    install_nodejs
    install_postgresql
    install_redis
    install_nginx
    
    # Configuration du projet
    setup_project_structure
    clone_or_update_repository
    install_backend_dependencies
    setup_environment
    setup_database
    
    # Configuration des services
    configure_nginx
    setup_ssl
    setup_pm2
    
    # Sécurité
    setup_firewall
    setup_fail2ban
    
    # Monitoring et maintenance
    setup_monitoring
    setup_backup
    
    # Redémarrer les services
    systemctl restart nginx
    systemctl restart postgresql
    systemctl restart redis-server
    
    success "🎉 Déploiement terminé avec succès !"
    
    # Afficher les informations finales
    echo ""
    echo "============================================================================"
    echo -e "${GREEN}LIBEKOO DÉPLOYÉ AVEC SUCCÈS !${NC}"
    echo "============================================================================"
    echo -e "🌐 Site web: ${CYAN}https://$DOMAIN${NC}"
    echo -e "🔧 API: ${CYAN}https://$DOMAIN/api/${NC}"
    echo -e "📊 Logs: ${CYAN}/var/log/libekoo/${NC}"
    echo -e "💾 Sauvegardes: ${CYAN}$BACKUP_DIR${NC}"
    echo ""
    echo -e "${YELLOW}Commandes utiles:${NC}"
    echo -e "  pm2 status                 - Statut de l'application"
    echo -e "  pm2 logs                   - Voir les logs"
    echo -e "  pm2 restart libekoo-api    - Redémarrer l'API"
    echo -e "  systemctl status nginx     - Statut Nginx"
    echo -e "  tail -f /var/log/libekoo/  - Suivre les logs"
    echo ""
    echo -e "${RED}⚠️  IMPORTANT:${NC}"
    echo -e "1. Changez les mots de passe dans /var/www/libekoo/backend/.env"
    echo -e "2. Configurez les DNS pour pointer vers cette IP: $(curl -s ifconfig.me)"
    echo -e "3. Testez toutes les fonctionnalités"
    echo -e "4. Configurez la surveillance externe"
    echo ""
}

# Exécution avec gestion d'erreur
trap 'error "Déploiement interrompu à la ligne $LINENO"' ERR

main "$@"
