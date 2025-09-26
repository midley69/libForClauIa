// Gestionnaire de déconnexions pour LiberTalk
import { supabase } from '../lib/supabase';

class DisconnectionManager {
  private static instance: DisconnectionManager;
  private currentUserId: string | null = null;
  private isPageUnloading: boolean = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private visibilityChangeHandler: (() => void) | null = null;
  private beforeUnloadHandler: ((event: BeforeUnloadEvent) => void) | null = null;
  private unloadHandler: (() => void) | null = null;

  static getInstance(): DisconnectionManager {
    if (!DisconnectionManager.instance) {
      DisconnectionManager.instance = new DisconnectionManager();
    }
    return DisconnectionManager.instance;
  }

  // Initialiser la gestion des déconnexions
  initialize(userId: string): void {
    this.currentUserId = userId;
    this.setupEventListeners();
    this.startHeartbeat();
    
    console.log('🔄 Gestionnaire de déconnexions initialisé pour:', userId);
  }

  // Configurer les écouteurs d'événements
  private setupEventListeners(): void {
    // Détecter quand l'utilisateur ferme la page
    this.beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      this.isPageUnloading = true;
      this.handleDisconnection('page_close');
      
      // Optionnel : afficher un message de confirmation
      // event.preventDefault();
      // event.returnValue = '';
    };

    // Détecter la fermeture définitive de la page
    this.unloadHandler = () => {
      this.handleDisconnection('page_unload');
    };

    // Détecter quand l'utilisateur change d'onglet
    this.visibilityChangeHandler = () => {
      if (document.hidden) {
        console.log('👁️ Page cachée - utilisateur probablement inactif');
        this.handleVisibilityChange(false);
      } else {
        console.log('👁️ Page visible - utilisateur de retour');
        this.handleVisibilityChange(true);
      }
    };

    // Ajouter les écouteurs
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    window.addEventListener('unload', this.unloadHandler);
    document.addEventListener('visibilitychange', this.visibilityChangeHandler);

    // Détecter les erreurs de connexion réseau
    window.addEventListener('online', () => {
      console.log('🌐 Connexion réseau rétablie');
      this.handleNetworkChange(true);
    });

    window.addEventListener('offline', () => {
      console.log('🌐 Connexion réseau perdue');
      this.handleNetworkChange(false);
    });
  }

  // Gérer les changements de visibilité
  private handleVisibilityChange(isVisible: boolean): void {
    if (!this.currentUserId) return;

    if (isVisible) {
      // Redémarrer le heartbeat quand l'utilisateur revient
      this.startHeartbeat();
      this.updateUserActivity();
    } else {
      // Réduire la fréquence du heartbeat quand l'utilisateur est absent
      this.stopHeartbeat();
      setTimeout(() => {
        if (document.hidden && !this.isPageUnloading) {
          this.handleDisconnection('tab_hidden');
        }
      }, 60000); // Attendre 1 minute avant de considérer comme déconnecté
    }
  }

  // Gérer les changements de réseau
  private handleNetworkChange(isOnline: boolean): void {
    if (!this.currentUserId) return;

    if (isOnline) {
      // Reconnecter l'utilisateur
      this.updateUserActivity();
      this.startHeartbeat();
    } else {
      // Marquer comme déconnecté temporairement
      this.stopHeartbeat();
    }
  }

  // Démarrer le heartbeat
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      this.updateUserActivity();
    }, 15000); // Toutes les 15 secondes
  }

  // Arrêter le heartbeat
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // Mettre à jour l'activité utilisateur
  private async updateUserActivity(): Promise<void> {
    if (!this.currentUserId || this.isPageUnloading) return;

    try {
      await supabase
        .from('random_chat_users')
        .update({ 
          last_seen: new Date().toISOString() 
        })
        .eq('user_id', this.currentUserId);

      console.log('💓 Heartbeat envoyé pour:', this.currentUserId);
    } catch (error) {
      console.error('❌ Erreur heartbeat:', error);
    }
  }

  // Gérer la déconnexion
  private async handleDisconnection(reason: string): Promise<void> {
    if (!this.currentUserId) return;

    console.log(`🚪 Déconnexion détectée (${reason}) pour:`, this.currentUserId);

    try {
      // Utiliser la fonction SQL pour gérer proprement la déconnexion
      await supabase.rpc('handle_user_disconnect', {
        p_user_id: this.currentUserId
      });

      console.log('✅ Déconnexion traitée avec succès');
    } catch (error) {
      console.error('❌ Erreur lors de la déconnexion:', error);
      
      // Fallback : supprimer directement l'utilisateur
      try {
        await supabase
          .from('random_chat_users')
          .delete()
          .eq('user_id', this.currentUserId);
      } catch (fallbackError) {
        console.error('❌ Erreur fallback déconnexion:', fallbackError);
      }
    }
  }

  // Déconnexion manuelle
  async disconnect(): Promise<void> {
    if (!this.currentUserId) return;

    console.log('🔚 Déconnexion manuelle pour:', this.currentUserId);
    
    this.isPageUnloading = true;
    await this.handleDisconnection('manual_disconnect');
    this.cleanup();
  }

  // Nettoyer les ressources
  cleanup(): void {
    console.log('🧹 Nettoyage du gestionnaire de déconnexions');

    this.stopHeartbeat();

    // Supprimer les écouteurs d'événements
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    }
    if (this.unloadHandler) {
      window.removeEventListener('unload', this.unloadHandler);
    }
    if (this.visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
    }

    this.currentUserId = null;
    this.isPageUnloading = false;
    this.beforeUnloadHandler = null;
    this.unloadHandler = null;
    this.visibilityChangeHandler = null;
  }

  // Obtenir le statut de connexion
  isConnected(): boolean {
    return this.currentUserId !== null && !this.isPageUnloading;
  }

  // Obtenir l'ID utilisateur actuel
  getCurrentUserId(): string | null {
    return this.currentUserId;
  }
}

export default DisconnectionManager;