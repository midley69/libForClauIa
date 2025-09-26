import { supabase } from '../lib/supabase';

export interface RandomChatUser {
  user_id: string;
  pseudo: string;
  genre: 'homme' | 'femme' | 'autre';
  status: 'en_attente' | 'connecte' | 'hors_ligne';
  autoswitch_enabled: boolean;
  last_seen: string;
}

export interface RandomChatSession {
  id: string;
  user1_id: string;
  user1_pseudo: string;
  user1_genre: string;
  user2_id: string;
  user2_pseudo: string;
  user2_genre: string;
  status: 'active' | 'ended' | 'autoswitch_waiting';
  started_at: string;
  last_activity: string;
  message_count: number;
  autoswitch_countdown_start?: string;
  autoswitch_user_id?: string;
}

export interface RandomChatMessage {
  id: string;
  session_id: string;
  sender_id: string;
  sender_pseudo: string;
  sender_genre: string;
  message_text: string;
  message_type: 'user' | 'system' | 'autoswitch_warning';
  sent_at: string;
  color_code: string;
}

class RandomChatService {
  private static instance: RandomChatService;
  private currentUserId: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  static getInstance(): RandomChatService {
    if (!RandomChatService.instance) {
      RandomChatService.instance = new RandomChatService();
    }
    return RandomChatService.instance;
  }

  // Créer ou mettre à jour un utilisateur
  async createUser(pseudo: string, genre: 'homme' | 'femme' | 'autre', autoswitchEnabled: boolean): Promise<RandomChatUser> {
    const userId = `random_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    const { data, error } = await supabase
      .from('random_chat_users')
      .upsert({
        user_id: userId,
        pseudo: pseudo.trim(),
        genre,
        status: 'en_attente',
        autoswitch_enabled: autoswitchEnabled,
        last_seen: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    
    this.currentUserId = userId;
    this.startHeartbeat();
    
    return data;
  }

  // Chercher un partenaire
  async findPartner(userId: string, locationFilter?: string): Promise<RandomChatUser | null> {
    const { data, error } = await supabase.rpc('find_random_chat_partner', {
      requesting_user_id: userId,
      p_location_filter: locationFilter
    });

    if (error) throw error;
    
    return data && data.length > 0 ? {
      user_id: data[0].partner_user_id,
      pseudo: data[0].partner_pseudo,
      genre: data[0].partner_genre,
      status: 'en_attente',
      autoswitch_enabled: false,
      last_seen: new Date().toISOString()
    } : null;
  }

  // Créer une session de chat
  async createSession(
    user1: RandomChatUser,
    user2: RandomChatUser
  ): Promise<string> {
    const { data, error } = await supabase.rpc('create_random_chat_session', {
      user1_id: user1.user_id,
      user1_pseudo: user1.pseudo,
      user1_genre: user1.genre,
      user2_id: user2.user_id,
      user2_pseudo: user2.pseudo,
      user2_genre: user2.genre
    });

    if (error) throw error;
    return data;
  }

  // Envoyer un message
  async sendMessage(
    sessionId: string,
    senderId: string,
    senderPseudo: string,
    senderGenre: string,
    messageText: string
  ): Promise<void> {
    const { error } = await supabase
      .from('random_chat_messages')
      .insert({
        session_id: sessionId,
        sender_id: senderId,
        sender_pseudo: senderPseudo,
        sender_genre: senderGenre,
        message_text: messageText.trim()
      });

    if (error) throw error;
  }

  // Charger les messages d'une session
  async loadMessages(sessionId: string): Promise<RandomChatMessage[]> {
    const { data, error } = await supabase
      .from('random_chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('sent_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  // Terminer une session
  async endSession(sessionId: string, endedByUserId: string, endReason: string): Promise<void> {
    const { error } = await supabase.rpc('end_random_chat_session', {
      session_id: sessionId,
      ended_by_user_id: endedByUserId,
      end_reason: endReason
    });

    if (error) throw error;
  }

  // Obtenir les statistiques
  async getStats(): Promise<any> {
    const { data, error } = await supabase.rpc('get_random_chat_stats');
    if (error) throw error;
    return data;
  }

  // S'abonner aux messages d'une session
  subscribeToMessages(sessionId: string, callback: (message: RandomChatMessage) => void) {
    return supabase
      .channel(`random_chat_messages_${sessionId}`)
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'random_chat_messages', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          callback(payload.new as RandomChatMessage);
        }
      )
      .subscribe();
  }

  // S'abonner aux changements de session
  subscribeToSession(sessionId: string, callback: (session: RandomChatSession) => void) {
    return supabase
      .channel(`random_chat_session_${sessionId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'random_chat_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          callback(payload.new as RandomChatSession);
        }
      )
      .subscribe();
  }

  // Démarrer le heartbeat
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(async () => {
      if (this.currentUserId) {
        try {
          await supabase
            .from('random_chat_users')
            .update({ last_seen: new Date().toISOString() })
            .eq('user_id', this.currentUserId);
        } catch (error) {
          console.error('Erreur heartbeat:', error);
        }
      }
    }, 30000);
  }

  // Nettoyer
  async cleanup(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.currentUserId) {
      try {
        await supabase
          .from('random_chat_users')
          .delete()
          .eq('user_id', this.currentUserId);
      } catch (error) {
        console.error('Erreur cleanup:', error);
      }
      
      this.currentUserId = null;
    }
  }
}

export default RandomChatService;