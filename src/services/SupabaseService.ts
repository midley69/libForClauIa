import { supabase } from '../lib/supabase';
import type { Database } from '../lib/supabase';

type OnlineUser = Database['public']['Tables']['online_users']['Row'];
type GroupRow = Database['public']['Tables']['groups']['Row'];

class SupabaseService {
  private static instance: SupabaseService;
  private currentUserId: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private connectionAttempts: number = 0;
  private maxRetries: number = 3;

  static getInstance(): SupabaseService {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
    }
    return SupabaseService.instance;
  }

  // Test de connexion à Supabase avec timeout
  async testConnection(): Promise<boolean> {
    try {
      console.log('🔄 Test de connexion Supabase...');
      
      // Créer une promesse avec timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      const connectionPromise = supabase
        .from('online_users')
        .select('count')
        .limit(1);

      const { data, error } = await Promise.race([connectionPromise, timeoutPromise]) as any;

      if (error) {
        console.error('❌ Erreur de connexion Supabase:', error);
        this.isConnected = false;
        return false;
      }

      console.log('✅ Connexion Supabase réussie');
      this.isConnected = true;
      this.connectionAttempts = 0;
      return true;
    } catch (error) {
      console.error('❌ Erreur de test de connexion:', error);
      this.isConnected = false;
      return false;
    }
  }

  // Obtenir le statut de connexion
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  // Initialiser la présence utilisateur avec retry automatique
  async initializeUserPresence(status: 'online' | 'chat' | 'video' | 'group' = 'online', location?: string): Promise<string> {
    try {
      console.log('🔄 Initialisation de la présence utilisateur...');
      
      // Tester la connexion d'abord
      const isConnected = await this.testConnection();
      if (!isConnected) {
        console.warn('⚠️ Connexion Supabase échouée, utilisation du mode fallback');
        // Générer un ID utilisateur même en mode fallback
        this.currentUserId = `fallback_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        return this.currentUserId;
      }

      // Générer un ID utilisateur unique
      this.currentUserId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log('📝 Création utilisateur:', {
        userId: this.currentUserId,
        status,
        location
      });
      
      // Insérer l'utilisateur dans la table online_users
      const { data, error } = await supabase
        .from('online_users')
        .insert({
          user_id: this.currentUserId,
          status,
          location,
          last_seen: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Erreur lors de l\'insertion utilisateur:', error);
        
        // Gestion spécifique des erreurs
        if (error.code === '42P01') {
          console.error('❌ Table online_users manquante. Exécutez la migration SQL complète.');
          throw new Error('Base de données non configurée. Veuillez exécuter la migration SQL.');
        }
        
        // En cas d'erreur, continuer en mode fallback
        console.warn('⚠️ Erreur d\'insertion, continuation en mode fallback');
        return this.currentUserId;
      }

      console.log('✅ Utilisateur initialisé avec succès:', data);

      // Démarrer le heartbeat pour maintenir la présence
      this.startHeartbeat();

      return this.currentUserId;
    } catch (error) {
      console.error('❌ Erreur d\'initialisation:', error);
      this.connectionAttempts++;
      
      if (this.connectionAttempts < this.maxRetries) {
        console.log(`🔄 Tentative ${this.connectionAttempts}/${this.maxRetries} dans 2 secondes...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.initializeUserPresence(status, location);
      }
      
      console.warn('⚠️ Échec après', this.maxRetries, 'tentatives, mode fallback activé');
      // Générer un ID utilisateur même en cas d'échec
      this.currentUserId = `fallback_user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      return this.currentUserId;
    }
  }

  // Mettre à jour le statut utilisateur
  async updateUserStatus(status: 'online' | 'chat' | 'video' | 'group'): Promise<void> {
    if (!this.currentUserId) {
      console.warn('⚠️ Pas d\'utilisateur actuel');
      return;
    }

    if (!this.isConnected) {
      console.warn('⚠️ Mode fallback: pas de mise à jour de statut');
      return;
    }

    try {
      const { error } = await supabase
        .from('online_users')
        .update({
          status,
          last_seen: new Date().toISOString()
        })
        .eq('user_id', this.currentUserId);

      if (error) {
        console.error('❌ Erreur mise à jour statut:', error);
        
        // Si l'utilisateur n'existe plus, le recréer
        if (error.code === 'PGRST116') {
          console.log('🔄 Recréation de l\'utilisateur...');
          await this.initializeUserPresence(status);
        }
      } else {
        console.log('✅ Statut mis à jour:', status);
      }
    } catch (error) {
      console.error('❌ Erreur de mise à jour du statut:', error);
    }
  }

  // Obtenir le nombre d'utilisateurs en ligne avec fallback intelligent
  async getOnlineUsersCount(): Promise<number> {
    try {
      if (!this.isConnected) {
        console.log('⚠️ Mode fallback: connexion fermée');
        return this.getFallbackUserCount();
      }

      console.log('🔄 Récupération du nombre d\'utilisateurs en ligne...');
      
      // Nettoyer d'abord les utilisateurs inactifs
      await this.cleanupInactiveUsers();

      // Compter les utilisateurs actifs (dernières 5 minutes)
      const { count, error } = await supabase
        .from('online_users')
        .select('*', { count: 'exact', head: true })
        .gte('last_seen', new Date(Date.now() - 5 * 60 * 1000).toISOString());

      if (error) {
        console.error('❌ Erreur lors du comptage des utilisateurs:', error);
        return this.getFallbackUserCount();
      }

      const realCount = count || 0;
      console.log('📊 Utilisateurs réels en ligne:', realCount);
      
      // Ajouter des utilisateurs simulés pour rendre l'app plus vivante
      const simulatedCount = this.getSimulatedUserCount();
      const totalCount = Math.max(1, realCount + simulatedCount);
      
      console.log('📊 Total utilisateurs (réels + simulés):', totalCount);
      return totalCount;
      
    } catch (error) {
      console.error('❌ Erreur de comptage:', error);
      return this.getFallbackUserCount();
    }
  }

  // Obtenir les utilisateurs par statut
  async getUsersByStatus(status: 'online' | 'chat' | 'video' | 'group'): Promise<number> {
    try {
      if (!this.isConnected) {
        return this.getFallbackStatusCount(status);
      }

      const { count, error } = await supabase
        .from('online_users')
        .select('*', { count: 'exact', head: true })
        .eq('status', status)
        .gte('last_seen', new Date(Date.now() - 5 * 60 * 1000).toISOString());

      if (error) {
        console.error(`❌ Erreur lors du comptage pour ${status}:`, error);
        return this.getFallbackStatusCount(status);
      }

      const realCount = count || 0;
      const simulatedCount = this.getSimulatedStatusCount(status);
      const totalCount = realCount + simulatedCount;
      
      console.log(`📊 ${status}: ${realCount} réels + ${simulatedCount} simulés = ${totalCount}`);
      return totalCount;
      
    } catch (error) {
      console.error(`❌ Erreur de comptage pour ${status}:`, error);
      return this.getFallbackStatusCount(status);
    }
  }

  // Créer un groupe avec validation complète
  async createGroup(name: string, description: string, createdBy: string, location?: string): Promise<GroupRow> {
    try {
      if (!this.isConnected) {
        console.warn('⚠️ Mode fallback: simulation de création de groupe');
        // Retourner un groupe simulé
        return {
          id: `fallback_group_${Date.now()}`,
          name: name.trim(),
          description: description.trim(),
          member_count: 1,
          is_active: true,
          category: 'Créé par utilisateur',
          location,
          created_at: new Date().toISOString(),
          last_activity: new Date().toISOString(),
          created_by: createdBy
        } as GroupRow;
      }

      console.log('🔄 Création du groupe:', { name, description, createdBy, location });
      
      // Validation des données
      if (!name.trim() || name.trim().length < 3) {
        throw new Error('Le nom du groupe doit contenir au moins 3 caractères');
      }
      
      if (!description.trim() || description.trim().length < 10) {
        throw new Error('La description doit contenir au moins 10 caractères');
      }
      
      const { data, error } = await supabase
        .from('groups')
        .insert({
          name: name.trim(),
          description: description.trim(),
          member_count: 1,
          is_active: true,
          category: 'Créé par utilisateur',
          location,
          last_activity: new Date().toISOString(),
          created_by: createdBy
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Erreur lors de la création du groupe:', error);
        
        if (error.code === '42P01') {
          throw new Error('Table groups manquante. Veuillez exécuter la migration SQL.');
        }
        
        throw error;
      }

      console.log('✅ Groupe créé avec succès:', data);
      return data;
      
    } catch (error) {
      console.error('❌ Erreur de création de groupe:', error);
      throw error;
    }
  }

  // Obtenir tous les groupes actifs avec nettoyage
  async getActiveGroups(): Promise<GroupRow[]> {
    try {
      if (!this.isConnected) {
        console.log('⚠️ Mode fallback: retour de groupes de démonstration');
        return this.getFallbackGroups();
      }

      console.log('🔄 Récupération des groupes actifs...');
      
      // Nettoyer d'abord les groupes inactifs
      await this.cleanupInactiveGroups();

      // Récupérer les groupes actifs (dernières 30 minutes)
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .eq('is_active', true)
        .gte('last_activity', new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .order('member_count', { ascending: false })
        .order('last_activity', { ascending: false })
        .limit(20);

      if (error) {
        console.error('❌ Erreur lors de la récupération des groupes:', error);
        
        if (error.code === '42P01') {
          console.error('❌ Table groups manquante. Exécutez la migration SQL.');
        }
        
        return this.getFallbackGroups();
      }

      const groups = data || [];
      console.log('📊 Groupes actifs récupérés:', groups.length);
      return groups;
      
    } catch (error) {
      console.error('❌ Erreur de récupération des groupes:', error);
      return this.getFallbackGroups();
    }
  }

  // Rejoindre un groupe avec validation
  async joinGroup(groupId: string): Promise<boolean> {
    try {
      if (!this.isConnected) {
        console.log('⚠️ Mode fallback: simulation de rejoindre un groupe');
        return Math.random() > 0.3; // 70% de chance de succès
      }

      console.log('🔄 Tentative de rejoindre le groupe:', groupId);
      
      const { data, error } = await supabase
        .from('groups')
        .select('member_count')
        .eq('id', groupId)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        console.error('❌ Groupe non trouvé ou inactif:', error);
        return false;
      }

      // Vérifier la limite de membres (utiliser une limite par défaut de 10)
      if (data.member_count >= 10) {
        console.warn('⚠️ Groupe plein');
        return false;
      }

      // Mettre à jour le nombre de membres
      const { error: updateError } = await supabase
        .from('groups')
        .update({
          member_count: data.member_count + 1,
          last_activity: new Date().toISOString()
        })
        .eq('id', groupId);

      if (updateError) {
        console.error('❌ Erreur lors de la mise à jour du groupe:', updateError);
        return false;
      }

      console.log('✅ Groupe rejoint avec succès');
      return true;
      
    } catch (error) {
      console.error('❌ Erreur pour rejoindre le groupe:', error);
      return false;
    }
  }

  // Quitter un groupe avec nettoyage
  async leaveGroup(groupId: string): Promise<void> {
    try {
      if (!this.isConnected) {
        console.log('⚠️ Mode fallback: simulation de quitter un groupe');
        return;
      }

      console.log('🔄 Quitter le groupe:', groupId);
      
      const { data, error } = await supabase
        .from('groups')
        .select('member_count')
        .eq('id', groupId)
        .single();

      if (error || !data) {
        console.error('❌ Groupe non trouvé:', error);
        return;
      }

      const newMemberCount = Math.max(0, data.member_count - 1);

      if (newMemberCount === 0) {
        // Marquer le groupe comme inactif au lieu de le supprimer
        await supabase
          .from('groups')
          .update({
            is_active: false,
            member_count: 0
          })
          .eq('id', groupId);
        console.log('🔒 Groupe marqué comme inactif (aucun membre)');
      } else {
        // Mettre à jour le nombre de membres
        await supabase
          .from('groups')
          .update({
            member_count: newMemberCount,
            last_activity: new Date().toISOString()
          })
          .eq('id', groupId);
        console.log('✅ Groupe quitté, membres restants:', newMemberCount);
      }
      
    } catch (error) {
      console.error('❌ Erreur pour quitter le groupe:', error);
    }
  }

  // S'abonner aux changements en temps réel avec gestion d'erreur
  subscribeToOnlineUsers(callback: (count: number) => void) {
    if (!this.isConnected) {
      console.warn('⚠️ Mode fallback: pas d\'abonnement temps réel');
      return null;
    }

    console.log('🔄 Abonnement aux changements d\'utilisateurs...');
    
    return supabase
      .channel(`online_users_changes_${Date.now()}`)
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'online_users' },
        async () => {
          try {
            const count = await this.getOnlineUsersCount();
            callback(count);
          } catch (error) {
            console.error('❌ Erreur lors de la mise à jour du compteur:', error);
          }
        }
      )
      .subscribe((status) => {
        console.log('📡 Statut abonnement utilisateurs:', status);
      });
  }

  subscribeToGroups(callback: (groups: GroupRow[]) => void) {
    if (!this.isConnected) {
      console.warn('⚠️ Mode fallback: pas d\'abonnement temps réel');
      return null;
    }

    console.log('🔄 Abonnement aux changements de groupes...');
    
    return supabase
      .channel(`groups_changes_${Date.now()}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'groups' },
        async () => {
          try {
            const groups = await this.getActiveGroups();
            callback(groups);
          } catch (error) {
            console.error('❌ Erreur lors de la mise à jour des groupes:', error);
          }
        }
      )
      .subscribe((status) => {
        console.log('📡 Statut abonnement groupes:', status);
      });
  }

  // Fonctions utilitaires privées
  private async cleanupInactiveUsers(): Promise<void> {
    try {
      const { error } = await supabase
        .from('online_users')
        .delete()
        .lt('last_seen', new Date(Date.now() - 5 * 60 * 1000).toISOString());
        
      if (error) {
        console.error('❌ Erreur nettoyage utilisateurs:', error);
      }
    } catch (error) {
      console.error('❌ Erreur nettoyage utilisateurs:', error);
    }
  }

  private async cleanupInactiveGroups(): Promise<void> {
    try {
      // Marquer comme inactifs les groupes sans activité depuis 30 minutes
      const { error } = await supabase
        .from('groups')
        .update({ is_active: false })
        .lt('last_activity', new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .eq('is_active', true);
        
      if (error) {
        console.error('❌ Erreur nettoyage groupes:', error);
      }
    } catch (error) {
      console.error('❌ Erreur nettoyage groupes:', error);
    }
  }

  private getFallbackUserCount(): number {
    const currentHour = new Date().getHours();
    const baseCount = currentHour >= 18 && currentHour <= 23 ? 65 : 35;
    return Math.floor(Math.random() * 40) + baseCount;
  }

  private getSimulatedUserCount(): number {
    const currentHour = new Date().getHours();
    const multiplier = currentHour >= 18 && currentHour <= 23 ? 1.8 : 1.2;
    return Math.floor((Math.random() * 20 + 15) * multiplier);
  }

  private getFallbackStatusCount(status: string): number {
    const currentHour = new Date().getHours();
    const multiplier = currentHour >= 18 && currentHour <= 23 ? 1.8 : 1.2;
    const fallbackCounts = { 
      chat: Math.floor(18 * multiplier), 
      video: Math.floor(6 * multiplier), 
      group: Math.floor(12 * multiplier), 
      online: Math.floor(45 * multiplier) 
    };
    return fallbackCounts[status as keyof typeof fallbackCounts] || 0;
  }

  private getSimulatedStatusCount(status: string): number {
    const currentHour = new Date().getHours();
    const multiplier = currentHour >= 18 && currentHour <= 23 ? 1.5 : 1;
    const simulatedCounts = { 
      chat: Math.floor(12 * multiplier), 
      video: Math.floor(4 * multiplier), 
      group: Math.floor(8 * multiplier), 
      online: Math.floor(20 * multiplier) 
    };
    return simulatedCounts[status as keyof typeof simulatedCounts] || 0;
  }

  private getFallbackGroups(): GroupRow[] {
    return [
      {
        id: 'demo-group-1',
        name: '🚀 Développeurs Web',
        description: 'Communauté de développeurs passionnés par les technologies web modernes',
        member_count: 15,
        is_active: true,
        category: 'Technologie',
        location: 'France',
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        created_by: 'demo_user'
      },
      {
        id: 'demo-group-2',
        name: '🎮 Gamers FR',
        description: 'Communauté française de joueurs multi-plateformes',
        member_count: 28,
        is_active: true,
        category: 'Gaming',
        location: 'France',
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        created_by: 'demo_user'
      },
      {
        id: 'demo-group-3',
        name: '🎨 Créatifs & Artistes',
        description: 'Espace de partage pour les créatifs et artistes',
        member_count: 12,
        is_active: true,
        category: 'Art & Créativité',
        location: 'Paris, France',
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        created_by: 'demo_user'
      }
    ] as GroupRow[];
  }

  // Heartbeat pour maintenir la présence
  private startHeartbeat(): void {
    console.log('💓 Démarrage du heartbeat...');
    
    this.heartbeatInterval = setInterval(async () => {
      if (this.currentUserId && this.isConnected) {
        try {
          await supabase
            .from('online_users')
            .update({ 
              last_seen: new Date().toISOString()
            })
            .eq('user_id', this.currentUserId);
        } catch (error) {
          console.error('❌ Erreur heartbeat:', error);
          this.isConnected = false;
        }
      }
    }, 30000); // Toutes les 30 secondes
  }

  // Nettoyer la présence utilisateur
  async cleanup(): Promise<void> {
    console.log('🧹 Nettoyage de la présence utilisateur...');
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.currentUserId && this.isConnected) {
      try {
        await supabase
          .from('online_users')
          .delete()
          .eq('user_id', this.currentUserId);
        console.log('✅ Utilisateur supprimé de la base');
      } catch (error) {
        console.error('❌ Erreur lors du nettoyage:', error);
      }
      
      this.currentUserId = null;
    }
    
    this.isConnected = false;
    this.connectionAttempts = 0;
  }

  // Obtenir le nombre de vrais utilisateurs en attente pour le chat randomisé
  async getRealRandomChatUsers(): Promise<number> {
    try {
      if (!this.isConnected) {
        console.log('⚠️ Mode fallback: pas de connexion pour chat randomisé');
        return 0;
      }

      const { count, error } = await supabase
        .from('random_chat_users')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'en_attente')
        .gte('last_seen', new Date(Date.now() - 2 * 60 * 1000).toISOString()); // Actifs dans les 2 dernières minutes

      if (error) {
        console.error('❌ Erreur comptage utilisateurs chat randomisé:', error);
        return 0;
      }

      const realCount = count || 0;
      console.log('📊 Vrais utilisateurs chat randomisé en attente:', realCount);
      return realCount;
    } catch (error) {
      console.error('❌ Erreur comptage utilisateurs chat randomisé:', error);
      return 0;
    }
  }

  // Nettoyer les utilisateurs inactifs du chat randomisé
  async cleanupInactiveRandomChatUsers(): Promise<void> {
    try {
      if (!this.isConnected) return;

      const { error } = await supabase
        .from('random_chat_users')
        .delete()
        .lt('last_seen', new Date(Date.now() - 2 * 60 * 1000).toISOString()); // Supprimer ceux inactifs depuis 2 minutes
        
      if (error) {
        console.error('❌ Erreur nettoyage utilisateurs chat randomisé:', error);
      } else {
        console.log('🧹 Nettoyage utilisateurs inactifs chat randomisé effectué');
      }
    } catch (error) {
      console.error('❌ Erreur nettoyage utilisateurs chat randomisé:', error);
    }
  }
}

export default SupabaseService;