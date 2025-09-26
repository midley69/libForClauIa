// Gestionnaire d'autoswitch pour LiberTalk
import { supabase } from '../lib/supabase';

export interface AutoswitchSession {
  sessionId: string;
  countdownRemaining: number;
  isActive: boolean;
}

class AutoswitchManager {
  private static instance: AutoswitchManager;
  private currentSession: AutoswitchSession | null = null;
  private countdownInterval: NodeJS.Timeout | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private onCountdownUpdate: ((seconds: number) => void) | null = null;
  private onAutoswitchComplete: ((newSessionId: string | null) => void) | null = null;

  static getInstance(): AutoswitchManager {
    if (!AutoswitchManager.instance) {
      AutoswitchManager.instance = new AutoswitchManager();
    }
    return AutoswitchManager.instance;
  }

  // Initialiser l'autoswitch pour une session
  initialize(
    onCountdownUpdate: (seconds: number) => void,
    onAutoswitchComplete: (newSessionId: string | null) => void
  ): void {
    this.onCountdownUpdate = onCountdownUpdate;
    this.onAutoswitchComplete = onAutoswitchComplete;
    
    console.log('🔄 Gestionnaire d\'autoswitch initialisé');
  }

  // Démarrer la surveillance d'une session spécifique
  startMonitoringSession(sessionId: string): void {
    if (!sessionId || sessionId.trim() === '') {
      console.error('❌ Session ID invalide pour l\'autoswitch');
      return;
    }

    this.currentSession = {
      sessionId: sessionId.trim(),
      countdownRemaining: 0,
      isActive: false
    };
    
    // Vérifier périodiquement les sessions en autoswitch
    this.startPeriodicCheck();
    
    console.log('🔄 Gestionnaire d\'autoswitch initialisé pour session:', sessionId);
  }

  // Démarrer la vérification périodique
  private startPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      await this.checkForAutoswitch();
    }, 5000); // Vérifier toutes les 5 secondes
  }

  // Vérifier si l'autoswitch doit être déclenché
  private async checkForAutoswitch(): Promise<void> {
    if (!this.currentSession || !this.currentSession.sessionId || this.currentSession.sessionId.trim() === '') {
      // Pas de session à surveiller pour le moment
      return;
    }

    const sessionId = this.currentSession.sessionId.trim();

    try {
      // Vérifier le statut de la session
      const { data: session, error } = await supabase
        .from('random_chat_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (error || !session) {
        console.error('❌ Erreur lors de la vérification de session:', error);
        return;
      }

      // Si la session est en attente d'autoswitch
      if (session.status === 'autoswitch_waiting' && !this.currentSession.isActive) {
        console.log('⏰ Autoswitch détecté, démarrage du compte à rebours');
        this.startCountdown(session.autoswitch_countdown_remaining || 30);
      }
    } catch (error) {
      console.error('❌ Erreur lors de la vérification d\'autoswitch:', error);
    }
  }

  // Démarrer le compte à rebours
  private startCountdown(initialSeconds: number): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    this.currentSession!.isActive = true;
    this.currentSession!.countdownRemaining = initialSeconds;

    console.log(`⏰ Compte à rebours autoswitch démarré: ${initialSeconds} secondes`);

    this.countdownInterval = setInterval(async () => {
      if (!this.currentSession) return;

      this.currentSession.countdownRemaining--;
      
      // Notifier la mise à jour du compte à rebours
      if (this.onCountdownUpdate) {
        this.onCountdownUpdate(this.currentSession.countdownRemaining);
      }

      console.log(`⏰ Autoswitch dans: ${this.currentSession.countdownRemaining}s`);

      // Quand le compte à rebours atteint 0
      if (this.currentSession.countdownRemaining <= 0) {
        clearInterval(this.countdownInterval!);
        this.countdownInterval = null;
        
        await this.executeAutoswitch();
      }
    }, 1000);
  }

  // Exécuter l'autoswitch
  private async executeAutoswitch(): Promise<void> {
    if (!this.currentSession) return;

    console.log('🔄 Exécution de l\'autoswitch pour session:', this.currentSession.sessionId);

    try {
      // Appeler la fonction SQL pour exécuter l'autoswitch
      const { data: newSessionId, error } = await supabase.rpc('execute_autoswitch', {
        p_session_id: this.currentSession.sessionId
      });

      if (error) {
        console.error('❌ Erreur lors de l\'autoswitch:', error);
        this.onAutoswitchComplete?.(null);
        return;
      }

      if (newSessionId) {
        console.log('✅ Autoswitch réussi, nouvelle session:', newSessionId);
        
        // Mettre à jour la session courante
        this.currentSession.sessionId = newSessionId;
        this.currentSession.isActive = false;
        this.currentSession.countdownRemaining = 0;
        
        this.onAutoswitchComplete?.(newSessionId);
      } else {
        console.log('❌ Autoswitch échoué - aucun partenaire disponible');
        this.onAutoswitchComplete?.(null);
      }
    } catch (error) {
      console.error('❌ Erreur lors de l\'exécution de l\'autoswitch:', error);
      this.onAutoswitchComplete?.(null);
    }
  }

  // Annuler l'autoswitch en cours
  cancelAutoswitch(): void {
    if (!this.currentSession?.isActive) return;

    console.log('❌ Annulation de l\'autoswitch');

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    this.currentSession.isActive = false;
    this.currentSession.countdownRemaining = 0;

    // Notifier l'annulation
    if (this.onCountdownUpdate) {
      this.onCountdownUpdate(0);
    }
  }

  // Déclencher manuellement l'autoswitch
  async triggerManualAutoswitch(userId: string, inactivePartnerId: string): Promise<boolean> {
    if (!this.currentSession?.sessionId) return false;

    console.log('🔄 Déclenchement manuel de l\'autoswitch');

    try {
      const { data: success, error } = await supabase.rpc('trigger_autoswitch', {
        p_session_id: this.currentSession.sessionId,
        p_active_user_id: userId,
        p_inactive_user_id: inactivePartnerId
      });

      if (error) {
        console.error('❌ Erreur lors du déclenchement manuel:', error);
        return false;
      }

      console.log('✅ Autoswitch déclenché manuellement');
      return success;
    } catch (error) {
      console.error('❌ Erreur lors du déclenchement manuel:', error);
      return false;
    }
  }

  // Obtenir le statut actuel
  getStatus(): AutoswitchSession | null {
    return this.currentSession;
  }

  // Vérifier si l'autoswitch est actif
  isActive(): boolean {
    return this.currentSession?.isActive || false;
  }

  // Obtenir le temps restant
  getTimeRemaining(): number {
    return this.currentSession?.countdownRemaining || 0;
  }

  // Nettoyer les ressources
  cleanup(): void {
    console.log('🧹 Nettoyage du gestionnaire d\'autoswitch');

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.currentSession = null;
    this.onCountdownUpdate = null;
    this.onAutoswitchComplete = null;
  }
}

export default AutoswitchManager;