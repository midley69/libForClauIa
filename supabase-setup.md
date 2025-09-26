# Configuration Supabase pour LiberTalk

## 1. Créer un projet Supabase

1. Allez sur [supabase.com](https://supabase.com)
2. Cliquez sur "Start your project"
3. Connectez-vous avec GitHub ou créez un compte
4. Cliquez sur "New project"
5. Choisissez votre organisation
6. Donnez un nom à votre projet (ex: "libertalk")
7. Créez un mot de passe pour la base de données
8. Choisissez une région proche de vous
9. Cliquez sur "Create new project"

## 2. Récupérer les clés API

Une fois votre projet créé :

1. Allez dans "Settings" > "API"
2. Copiez l'URL du projet (Project URL)
3. Copiez la clé "anon public" (anon key)

## 3. Configurer les variables d'environnement

Remplacez les valeurs dans votre fichier `.env` :

```
VITE_SUPABASE_URL=votre_project_url_ici
VITE_SUPABASE_ANON_KEY=votre_anon_key_ici
```

## 4. Créer les tables dans Supabase

Allez dans "SQL Editor" dans votre dashboard Supabase et exécutez ces scripts :

### Table pour les utilisateurs en ligne

```sql
-- Créer la table online_users
CREATE TABLE IF NOT EXISTS online_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('online', 'chat', 'video', 'group')),
  location TEXT,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_online_users_status ON online_users(status);
CREATE INDEX IF NOT EXISTS idx_online_users_last_seen ON online_users(last_seen);

-- Activer RLS (Row Level Security)
ALTER TABLE online_users ENABLE ROW LEVEL SECURITY;

-- Politique pour permettre à tous de lire et écrire
CREATE POLICY "Allow all operations on online_users" ON online_users
  FOR ALL USING (true) WITH CHECK (true);
```

### Table pour les groupes

```sql
-- Créer la table groups
CREATE TABLE IF NOT EXISTS groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  member_count INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  category TEXT DEFAULT 'Créé par utilisateur',
  location TEXT,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_groups_active ON groups(is_active);
CREATE INDEX IF NOT EXISTS idx_groups_last_activity ON groups(last_activity);

-- Activer RLS (Row Level Security)
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Politique pour permettre à tous de lire et écrire
CREATE POLICY "Allow all operations on groups" ON groups
  FOR ALL USING (true) WITH CHECK (true);
```

### Fonction de nettoyage automatique

```sql
-- Fonction pour nettoyer automatiquement les utilisateurs inactifs
CREATE OR REPLACE FUNCTION cleanup_inactive_users()
RETURNS void AS $$
BEGIN
  DELETE FROM online_users 
  WHERE last_seen < NOW() - INTERVAL '2 minutes';
END;
$$ LANGUAGE plpgsql;

-- Fonction pour nettoyer automatiquement les groupes inactifs
CREATE OR REPLACE FUNCTION cleanup_inactive_groups()
RETURNS void AS $$
BEGIN
  DELETE FROM groups 
  WHERE last_activity < NOW() - INTERVAL '15 minutes';
END;
$$ LANGUAGE plpgsql;
```

## 5. Activer les abonnements temps réel

Dans "Settings" > "API" > "Realtime", activez les tables :
- ✅ online_users
- ✅ groups

## 6. Test de la configuration

Une fois tout configuré, votre application devrait :
- ✅ Afficher le nombre réel d'utilisateurs connectés
- ✅ Mettre à jour le compteur en temps réel
- ✅ Synchroniser les groupes entre tous les PC
- ✅ Nettoyer automatiquement les données obsolètes

## Dépannage

Si ça ne fonctionne pas :

1. **Vérifiez les variables d'environnement** dans `.env`
2. **Vérifiez que RLS est activé** avec les bonnes politiques
3. **Vérifiez que Realtime est activé** pour les tables
4. **Regardez la console** pour les erreurs JavaScript
5. **Vérifiez les logs** dans Supabase Dashboard > Logs

## Support

Si vous avez des problèmes, vérifiez :
- Les clés API sont correctes
- Les tables sont créées
- RLS est configuré
- Realtime est activé