import { supabase } from '../lib/supabase';

export interface ChatUser {
  user_id: string;
  pseudo: string;
  genre: 'homme' | 'femme' | 'autre';
  chat_type: 'random' | 'local' | 'group';
  status: 'searching' | 'matched' | 'chatting';
  location?: string;
  last_activity: string;
}

export interface ChatMatch {
  id: string;
  user1_id: string;
  user1_pseudo: string;
  user1_genre: string;
  user2_id: string;
  user2_pseudo: string;
  user2_genre: string;
  match_type: string;
  status: 'active' | 'ended' | 'abandoned';
  started_at: string;
  last_activity: string;
  message_count: number;
}

export interface ChatMessage {
  id: string;
  match_id: string;
  sender_id: string;
  sender_pseudo: string;
  sender_genre: string;
  message_text: string;
  message_type: 'user' | 'system' | 'notification';
  color_code: string;
  sent_at: string;
}

class RealTimeChatService {
  private static instance: RealTimeChatService;
  private currentUserId: string | null = null;
  private currentMatchId: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private messageSubscription: any = null;

  static getInstance(): RealTimeChatService {
    if (!RealTimeChatService.instance) {
      RealTimeChatService.instance = new RealTimeChatService();
    }
    return RealTimeChatService.instance;
  }

  // Rechercher une correspondance avec de vrais utilisateurs
  async findMatch(
    userId: string,
    pseudo: string,
    genre: 'homme' | 'femme' | 'autre',
    chatType: 'random' | 'local' | 'group',
    location?: string
  ): Promise<ChatMatch | null> {
    try {
      console.log('🔍 Recherche de correspondance avec vrais utilisateurs...', { userId, pseudo, genre, chatType, location });

      // D'abord, créer l'utilisateur dans la table online_users pour le chat aléatoire
      const { error: userError } = await supabase
        .from('online_users')
        .upsert({
          user_id: userId,
          status: 'chat',
          location,
          last_seen: new Date().toISOString()
        });

      if (userError) {
        console.error('❌ Erreur création utilisateur online:', userError);
      }

      // Chercher un partenaire réel via la fonction SQL
      const { data: partners, error } = await supabase.rpc('find_random_chat_partner', {
        requesting_user_id: userId,
        p_location_filter: location
      });

      if (error) {
        console.error('❌ Erreur recherche partenaire:', error);
        throw error;
      }

      if (partners && partners.length > 0) {
        const partner = partners[0];
        console.log('✅ VRAI partenaire trouvé:', partner);
        
        // Créer une session de chat avec le vrai partenaire
        const { data: sessionData, error: sessionError } = await supabase.rpc('create_random_chat_session', {
          user1_id: userId,
          user1_pseudo: pseudo,
          user1_genre: genre,
          user2_id: partner.partner_user_id,
          user2_pseudo: partner.partner_pseudo,
          user2_genre: partner.partner_genre
        });

        if (sessionError) {
          console.error('❌ Erreur création session:', sessionError);
          throw sessionError;
        }

        const realMatch: ChatMatch = {
          id: sessionData,
          user1_id: userId,
          user1_pseudo: pseudo,
          user1_genre: genre,
          user2_id: partner.partner_user_id,
          user2_pseudo: partner.partner_pseudo,
          user2_genre: partner.partner_genre,
          match_type: chatType,
          status: 'active',
          started_at: new Date().toISOString(),
          last_activity: new Date().toISOString(),
          message_count: 0
        };

        this.currentUserId = userId;
        this.currentMatchId = sessionData;
        this.startHeartbeat();

        console.log('✅ Correspondance RÉELLE créée:', realMatch);
        return realMatch;
      }

      // Aucun vrai partenaire trouvé
      console.log('❌ Aucun vrai partenaire disponible');
      return null;

    } catch (error) {
      console.error('❌ Erreur dans findMatch:', error);
      throw error;
    }
  }

  // Envoyer un message
  async sendMessage(
    matchId: string,
    senderId: string,
    senderPseudo: string,
    senderGenre: string,
    messageText: string
  ): Promise<string | null> {
    try {
      console.log('📤 Envoi de message...', { matchId, senderId, messageText });

      // Envoyer le message directement dans la table random_chat_messages
      const { data, error } = await supabase
        .from('random_chat_messages')
        .insert({
          session_id: matchId,
          sender_id: senderId,
          sender_pseudo: senderPseudo,
          sender_genre: senderGenre,
          message_text: messageText
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Erreur lors de l\'envoi du message:', error);
        throw error;
      }

      console.log('✅ Message envoyé avec ID:', data.id);
      return data.id;
    } catch (error) {
      console.error('❌ Erreur dans sendMessage:', error);
      throw error;
    }
  }

  // Obtenir la couleur par genre
  private getColorByGender(genre: string): string {
    switch (genre) {
      case 'femme': return '#FF69B4';
      case 'homme': return '#1E90FF';
      default: return '#A9A9A9';
    }
  }

  // Charger les messages d'une correspondance
  async loadMessages(matchId: string): Promise<ChatMessage[]> {
    try {
      console.log('📥 Chargement des messages pour:', matchId);

      const { data, error } = await supabase
        .from('random_chat_messages')
        .select('*')
        .eq('session_id', matchId)
        .order('sent_at', { ascending: true });

      if (error) {
        console.error('❌ Erreur chargement messages:', error);
        throw error;
      }

      const messages: ChatMessage[] = (data || []).map(msg => ({
        id: msg.id,
        match_id: matchId,
        sender_id: msg.sender_id,
        sender_pseudo: msg.sender_pseudo,
        sender_genre: msg.sender_genre,
        message_text: msg.message_text,
        message_type: msg.message_type as 'user' | 'system' | 'notification',
        color_code: msg.color_code,
        sent_at: msg.sent_at
      }));

      console.log('✅ Messages chargés:', messages.length);
      return messages;
    } catch (error) {
      console.error('❌ Erreur dans loadMessages:', error);
      return [];
    }
  }

  // S'abonner aux nouveaux messages
  subscribeToMessages(matchId: string, callback: (message: ChatMessage) => void) {
    console.log('📡 Abonnement aux messages pour:', matchId);

    // Nettoyer l'ancien abonnement
    if (this.messageSubscription) {
      this.messageSubscription.unsubscribe?.();
    }

    // Créer un abonnement réel aux messages
    this.messageSubscription = supabase
      .channel(`random_chat_messages_${matchId}`)
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'random_chat_messages', filter: `session_id=eq.${matchId}` },
        (payload) => {
          console.log('📨 Nouveau message reçu:', payload.new);
          const newMessage = payload.new as any;
          
          const chatMessage: ChatMessage = {
            id: newMessage.id,
            match_id: matchId,
            sender_id: newMessage.sender_id,
            sender_pseudo: newMessage.sender_pseudo,
            sender_genre: newMessage.sender_genre,
            message_text: newMessage.message_text,
            message_type: newMessage.message_type,
            color_code: newMessage.color_code,
            sent_at: newMessage.sent_at
          };

          callback(chatMessage);
        }
      )
      .subscribe((status) => {
        console.log('📡 Statut abonnement messages:', status);
      });

    console.log('✅ Abonnement aux messages actif pour:', matchId);
    return this.messageSubscription;
  }

  // Terminer une correspondance
  async endMatch(matchId: string, userId: string, reason: string = 'user_action'): Promise<boolean> {
    try {
      console.log('🔚 Fin de correspondance...', { matchId, userId, reason });

      // Terminer la session via la fonction SQL
      const { data, error } = await supabase.rpc('end_random_chat_session', {
        session_id: matchId,
        ended_by_user_id: userId,
        end_reason: reason
      });

      if (error) {
        console.error('❌ Erreur fin de session:', error);
        throw error;
      }

      // Nettoyer l'abonnement aux messages
      if (this.messageSubscription) {
        this.messageSubscription.unsubscribe();
      }

      console.log('✅ Correspondance terminée');
      this.cleanup();
      return true;
    } catch (error) {
      console.error('❌ Erreur dans endMatch:', error);
      return false;
    }
  }

  // Obtenir les statistiques en temps réel
  async getStats(): Promise<any> {
    try {
      // Obtenir les vraies statistiques depuis Supabase
      const { data: randomChatStats, error } = await supabase.rpc('get_random_chat_stats');
      
      if (error) {
        console.error('❌ Erreur lors de la récupération des stats:', error);
        throw error;
      }

      console.log('📊 Statistiques réelles récupérées:', randomChatStats);
      return {
        active_users: randomChatStats?.users || { total: 0, searching: 0, chatting: 0, by_type: { random: 0 } },
        active_matches: randomChatStats?.sessions?.active || 0,
        total_messages_today: randomChatStats?.messages?.today || 0,
        last_updated: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Erreur dans getStats:', error);
      // Fallback avec des valeurs nulles pour indiquer qu'il n'y a pas de données
      return {
        active_users: { total: 0, searching: 0, chatting: 0, by_type: { random: 0 } },
        active_matches: 0,
        total_messages_today: 0,
        last_updated: new Date().toISOString()
      };
    }
  }

  // Démarrer le heartbeat pour maintenir la présence
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(async () => {
      if (this.currentUserId) {
        try {
          // Mettre à jour la présence dans online_users
          await supabase
            .from('online_users')
            .update({ last_seen: new Date().toISOString() })
            .eq('user_id', this.currentUserId);

          console.log('💓 Heartbeat pour utilisateur:', this.currentUserId);
        } catch (error) {
          console.error('❌ Erreur heartbeat:', error);
        }
      }
    }, 30000); // Toutes les 30 secondes
  }

  // Nettoyer les ressources
  cleanup(): void {
    console.log('🧹 Nettoyage du service de chat...');

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.messageSubscription) {
      this.messageSubscription.unsubscribe();
      this.messageSubscription = null;
    }

    // Nettoyer la présence utilisateur
    if (this.currentUserId) {
      supabase
        .from('online_users')
        .delete()
        .eq('user_id', this.currentUserId)
        .then(() => {
          console.log('✅ Présence utilisateur nettoyée');
        })
        .catch((error) => {
          console.error('❌ Erreur nettoyage présence:', error);
        });
    }

    this.currentUserId = null;
    this.currentMatchId = null;
  }

  // Obtenir l'ID de correspondance actuel
  getCurrentMatchId(): string | null {
    return this.currentMatchId;
  }

  // Obtenir l'ID utilisateur actuel
  getCurrentUserId(): string | null {
    return this.currentUserId;
  }
}

export default RealTimeChatService;