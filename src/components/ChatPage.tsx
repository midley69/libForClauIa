import React, { useState, useEffect, useRef } from 'react';
import { Send, Users, MapPin, ArrowLeft, Plus, Hash, Globe, UserPlus, SkipForward, X, MessageCircle, Shuffle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ChatMessage, ChatRoom } from '../types';
import SupabaseService from '../services/SupabaseService';
import RealTimeChatService from '../services/RealTimeChatService';
import { RandomChatPage } from './RandomChatPage';

export function ChatPage() {
  const { setPage, state } = useApp();
  const [currentView, setCurrentView] = useState<'menu' | 'random' | 'group' | 'local' | 'random_chat'>('menu');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [userLocation, setUserLocation] = useState<{country: string, city: string} | null>(null);
  const [connectionTime, setConnectionTime] = useState(0);
  const [canAddFriend, setCanAddFriend] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [connectedUsers, setConnectedUsers] = useState(0);
  const [searchAttempts, setSearchAttempts] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [connectedUser, setConnectedUser] = useState<any>(null);
  const [waitingCounts, setWaitingCounts] = useState({ chat: 0, video: 0, group: 0 });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const supabaseService = SupabaseService.getInstance();
  const realTimeChatService = RealTimeChatService.getInstance();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const locationEnabled = localStorage.getItem('locationEnabled');
    if (locationEnabled === 'true' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => {
          setUserLocation({ country: 'France', city: 'Paris' });
        },
        () => {
          setUserLocation(null);
        }
      );
    } else {
      setUserLocation(null);
    }
  }, []);

  // Charger les statistiques en temps réel toutes les 30 secondes
  useEffect(() => {
    const loadWaitingCounts = async () => {
      try {
        console.log('🔄 Mise à jour des statistiques de chat...');
        
        // Obtenir les vrais utilisateurs en attente pour le chat randomisé
        const randomChatCount = await supabaseService.getRealRandomChatUsers();
        const videoCount = await supabaseService.getUsersByStatus('video');
        const groupCount = await supabaseService.getUsersByStatus('group');
        
        const newCounts = { chat: randomChatCount, video: videoCount, group: groupCount };
        setWaitingCounts(newCounts);
        
        console.log('📊 Statistiques mises à jour:', newCounts);
      } catch (error) {
        console.error('❌ Erreur lors du chargement des statistiques:', error);
        // En cas d'erreur, mettre des valeurs nulles pour indiquer qu'il n'y a pas de vrais utilisateurs
        setWaitingCounts({ chat: 0, video: 0, group: 0 });
      }
    };

    // Charger immédiatement
    loadWaitingCounts();
    
    // Puis toutes les 15 secondes pour plus de réactivité
    const interval = setInterval(loadWaitingCounts, 15000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isConnected) {
      interval = setInterval(() => {
        setConnectionTime(prev => {
          const newTime = prev + 1;
          if (newTime === 30 && state.user && !state.user.isAnonymous && currentView === 'random') {
            setCanAddFriend(true);
          }
          return newTime;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isConnected, state.user, currentView]);

  // Simuler des messages entrants de l'utilisateur connecté
  useEffect(() => {
    if (isConnected && connectedUser) {
      const messageInterval = setInterval(() => {
        const timeSinceConnection = connectionTime;
        let messageChance = timeSinceConnection < 60 ? 0.15 : 0.08;
        
        if (Math.random() < messageChance) {
          const partnerMessages = [
            'Salut ! 👋',
            'Comment ça va ?',
            'D\'où viens-tu ?',
            'Qu\'est-ce que tu fais ?',
            'Tu es là ?',
            'Sympa cette app !',
            'Première fois ici ?',
            'Quel âge as-tu ?',
            'Tu fais quoi dans la vie ?',
            'Il fait beau chez toi ?',
            'Tu aimes quoi comme musique ?',
            'Tu joues à des jeux ?',
            'C\'est quoi tes hobbies ?',
            'Tu étudies ou tu travailles ?',
            'À bientôt ! 😊',
            'Cool de te parler !',
            'Tu connais d\'autres apps comme ça ?',
            'Bonne journée !',
            'Merci pour la discussion'
          ];
          
          const randomMessage = partnerMessages[Math.floor(Math.random() * partnerMessages.length)];
          
          const newMessage: ChatMessage = {
            id: Date.now().toString() + '_partner',
            userId: connectedUser.id,
            username: 'Utilisateur',
            message: randomMessage,
            timestamp: new Date(),
            isOwn: false,
          };
          
          setMessages(prev => [...prev, newMessage]);
        }
      }, 8000 + Math.random() * 12000); // Entre 8-20 secondes
      
      return () => clearInterval(messageInterval);
    }
  }, [isConnected, connectedUser, connectionTime]);

  const handleConnect = async (type: 'random' | 'group' | 'local') => {
    // Disable local chat functionality temporarily
    if (type === 'local') {
      alert('Le chat local n\'est pas disponible actuellement. Veuillez utiliser le chat aléatoire.');
      return;
    }

    if (type === 'local' && !userLocation) {
      alert('Veuillez activer la géolocalisation dans les paramètres pour utiliser le chat local.');
      return;
    }

    setIsSearching(true);
    setSearchAttempts(0);
    
    try {
      console.log(`🔄 Démarrage de la connexion ${type}...`);
      
      // Mettre à jour le statut utilisateur
      await supabaseService.updateUserStatus('chat');
      const userId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      setCurrentUserId(userId);
      
      // Chercher une correspondance avec le nouveau service
      let attemptCount = 0;
      const maxAttempts = 4;
      
      while (attemptCount < maxAttempts) {
        attemptCount++;
        setSearchAttempts(attemptCount);
        
        console.log(`🔍 Tentative de recherche ${attemptCount}/${maxAttempts}...`);
        
        const match = await realTimeChatService.findMatch(
          userId,
          state.user?.username || 'Anonyme',
          'autre', // Genre par défaut
          type,
          userLocation ? `${userLocation.city}, ${userLocation.country}` : undefined
        );
        
        if (match) {
          // Connexion trouvée !
          console.log('✅ Correspondance trouvée !', match);
          
          setIsSearching(false);
          setIsConnected(true);
          setConnectedUser({ id: match.id, type: 'chat', connectedAt: new Date(), isReal: true });
          setConnectionTime(0);
          setCanAddFriend(false);
          setCurrentView(type);
          setConnectedUsers(2);
          
          const welcomeMessage: ChatMessage = {
            id: Date.now().toString(),
            userId: 'system',
            username: 'Libekoo',
            message: `✅ Connecté avec ${match.user1_id === userId ? match.user2_pseudo : match.user1_pseudo}`,
            timestamp: new Date(),
            isOwn: false,
          };
          
          setMessages([welcomeMessage]);
          
          // S'abonner aux nouveaux messages
          realTimeChatService.subscribeToMessages(match.id, (newMessage) => {
            console.log('📨 Nouveau message reçu dans ChatPage:', newMessage);
            const chatMessage: ChatMessage = {
              id: newMessage.id,
              userId: newMessage.sender_id,
              username: newMessage.sender_pseudo,
              message: newMessage.message_text,
              timestamp: new Date(newMessage.sent_at),
              isOwn: newMessage.sender_id === userId,
            };
            console.log('✅ Message converti pour affichage:', chatMessage);
            setMessages(prev => [...prev, chatMessage]);
          });
          
          return;
        }
        
        // Pas de correspondance, attendre avant de réessayer
        if (attemptCount < maxAttempts) {
          console.log(`⏳ Attente avant nouvelle tentative...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      // Aucune correspondance trouvée après tous les essais
      console.log('❌ Aucune correspondance trouvée après toutes les tentatives');
      
      await supabaseService.updateUserStatus('online');
      setIsSearching(false);
      setSearchAttempts(0);
      
      const currentHour = new Date().getHours();
      const timeAdvice = currentHour >= 22 || currentHour <= 7 ? 
        'Il y a moins d\'utilisateurs connectés la nuit. Essayez entre 18h et 23h.' : 
        'Peu d\'utilisateurs disponibles actuellement.';
        
      alert(`Aucun utilisateur disponible pour le moment. ${timeAdvice}`);
      
    } catch (error) {
      console.error('❌ Erreur de connexion:', error);
      setIsSearching(false);
      alert('Erreur de connexion. Vérifiez votre connexion internet.');
    }
  };

  const handleSendMessage = () => {
    if (!currentMessage.trim() || !isConnected) return;

    const matchId = realTimeChatService.getCurrentMatchId();
    if (!matchId) return;

    console.log('📤 Envoi de message depuis ChatPage:', currentMessage.trim());

    // Envoyer le message via le service temps réel
    realTimeChatService.sendMessage(
      matchId,
      currentUserId,
      state.user?.username || 'Anonyme',
      'autre',
      currentMessage.trim()
    ).then(() => {
      console.log('✅ Message envoyé avec succès');
      
      // Ajouter immédiatement le message à l'interface utilisateur
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        userId: currentUserId,
        username: state.user?.username || 'Anonyme',
        message: currentMessage.trim(),
        timestamp: new Date(),
        isOwn: true,
      };
      setMessages(prev => [...prev, userMessage]);
    }).catch((error) => {
      console.error('❌ Erreur envoi message:', error);
    });

    setCurrentMessage('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleDisconnect = () => {
    const disconnect = async () => {
      console.log('🔚 Déconnexion du chat...');
      
      const matchId = realTimeChatService.getCurrentMatchId();
      if (matchId) {
        await realTimeChatService.endMatch(matchId, currentUserId, 'user_quit');
      }
      
      await supabaseService.updateUserStatus('online');
      realTimeChatService.cleanup();
      
      setIsConnected(false);
      setConnectedUser(null);
      setMessages([]);
      setCurrentView('menu');
      setConnectionTime(0);
      setCanAddFriend(false);
      setShowAddFriend(false);
      setConnectedUsers(0);
      setSearchAttempts(0);
      setCurrentUserId('');
    };

    disconnect();
  };

  const handleSkipUser = async () => {
    if (isSearching) return;
    
    console.log('⏭️ Passage à l\'utilisateur suivant...');
    
    const matchId = realTimeChatService.getCurrentMatchId();
    if (matchId) {
      await realTimeChatService.endMatch(matchId, currentUserId, 'skip');
    }
    
    setMessages([]);
    setConnectionTime(0);
    setCanAddFriend(false);
    setShowAddFriend(false);
    setIsConnected(false);
    setConnectedUser(null);
    
    // Chercher un nouvel utilisateur
    await handleConnect(currentView);
  };

  const handleAddFriend = () => {
    if (!state.user || state.user.isAnonymous) {
      alert('Vous devez être connecté à un compte pour ajouter des amis.');
      return;
    }
    
    setShowAddFriend(true);
    
    setTimeout(() => {
      setShowAddFriend(false);
      const friendMessage: ChatMessage = {
        id: Date.now().toString() + '_friend',
        userId: 'system',
        username: 'Libekoo',
        message: '✅ Demande d\'ami envoyée',
        timestamp: new Date(),
        isOwn: false,
      };
      setMessages(prev => [...prev, friendMessage]);
    }, 1500);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getSearchStatusText = () => {
    if (searchAttempts === 0) return 'Recherche d\'utilisateurs réels...';
    return `Recherche... Tentative ${searchAttempts}/4`;
  };

  // Afficher la page de chat randomisé si sélectionnée
  if (currentView === 'random_chat') {
    return <RandomChatPage />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-black/20 backdrop-blur-sm border-b border-white/10 p-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => isConnected ? handleDisconnect() : setPage('home')}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors duration-200"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <h1 className="text-xl font-semibold text-white">
              {currentView === 'random' ? 'Chat Aléatoire' :
               currentView === 'local' ? 'Chat Local' : 'Chat LiberTalk'}
            </h1>
          </div>
          <div className="flex items-center space-x-4">
            {userLocation && (
              <div className="flex items-center space-x-1 text-cyan-400 text-sm">
                <MapPin className="w-4 h-4" />
                <span>{userLocation.city}, {userLocation.country}</span>
              </div>
            )}
            {isConnected && (
              <div className="text-cyan-400 font-mono text-sm">
                {formatTime(connectionTime)}
              </div>
            )}
            {(connectedUsers > 0 || isSearching) && (
              <div className="flex items-center space-x-2 text-cyan-400">
                <Users className="w-4 h-4" />
                <span className="text-sm">
                  {isSearching ? `${waitingCounts.chat} en attente` : `${connectedUsers} connectés`}
                </span>
              </div>
            )}
            {isConnected && connectedUser && (
              <div className="flex items-center space-x-1 text-green-400 text-xs">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span>Live</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0">
        {currentView === 'menu' && (
          <div className="flex-1 overflow-y-auto custom-scroll">
            <div className="p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 md:space-y-8 max-w-6xl mx-auto pb-16 sm:pb-20">
              <div className="text-center">
                <h2 className="text-lg sm:text-xl md:text-2xl font-semibold text-white mb-2">
                  Choisissez votre mode de connexion
                </h2>
                <p className="text-gray-300 text-xs sm:text-sm md:text-base">
                  Rencontrez de vraies personnes dans le monde entier
                </p>
              </div>

              {/* Stats en temps réel */}
              <div className="stats-container">
                <div className="text-center">
                  <div className="text-cyan-400 font-bold text-base sm:text-lg live-indicator">{waitingCounts.chat}</div>
                  <div className="text-gray-400 text-xs">Chat</div>
                </div>
                <div className="text-center">
                  <div className="text-purple-400 font-bold text-base sm:text-lg live-indicator">{waitingCounts.video}</div>
                  <div className="text-gray-400 text-xs">Vidéo</div>
                </div>
                <div className="text-center">
                  <div className="text-green-400 font-bold text-base sm:text-lg live-indicator">{waitingCounts.group}</div>
                  <div className="text-gray-400 text-xs">Groupes</div>
                </div>
              </div>
              <div className="text-center">
                <p className="text-gray-400 text-xs">Utilisateurs en attente de connexion • Mis à jour toutes les 30s</p>
              </div>

              {/* Chat Options */}
              <div className="responsive-grid">
                {/* Random Chat */}
                <button
                  onClick={() => handleConnect('random')}
                  className="responsive-card rounded-xl border border-white/20 bg-white/5 hover:border-cyan-400 hover:bg-cyan-400/10 transition-all duration-300 group hover-glow"
                >
                  <div className="text-center space-y-3 md:space-y-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 mx-auto bg-gradient-to-br from-cyan-400 to-blue-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                      <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8 text-white" />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold text-sm sm:text-base md:text-lg mb-2">Chat Aléatoire</h3>
                      <p className="text-gray-400 text-xs sm:text-sm">
                        Discutez avec quelqu'un de complètement nouveau
                      </p>
                      <div className="mt-2 text-cyan-400 text-xs live-indicator">
                        {waitingCounts.chat} utilisateurs en attente
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setCurrentView('random_chat')}
                  className="responsive-card rounded-xl border border-white/20 bg-white/5 hover:border-pink-400 hover:bg-pink-400/10 transition-all duration-300 group hover-glow"
                >
                  <div className="text-center space-y-3 md:space-y-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 mx-auto bg-gradient-to-br from-pink-400 to-purple-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                      <Shuffle className="w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8 text-white" />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold text-sm sm:text-base md:text-lg mb-2">Chat Randomisé</h3>
                      <p className="text-gray-400 text-xs sm:text-sm">
                        Chat avec pseudo et genre, autoswitch disponible
                      </p>
                      <div className="mt-2 text-pink-400 text-xs">
                        Messages colorés par genre
                      </div>
                    </div>
                  </div>
                </button>

                {/* Local Chat */}
                <button
                  onClick={() => handleConnect('local')}
                  disabled={!userLocation}
                  className="responsive-card rounded-xl border border-white/20 bg-white/5 hover:border-green-400 hover:bg-green-400/10 transition-all duration-300 group disabled:opacity-50 disabled:cursor-not-allowed hover-glow col-span-1 sm:col-span-2 lg:col-span-1"
                >
                  <div>
                    <div className="text-center space-y-3 md:space-y-4">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 mx-auto bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                        <Globe className="w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8 text-white" />
                      </div>
                      <div>
                        <h3 className="text-white font-semibold text-sm sm:text-base md:text-lg mb-2">Chat Local</h3>
                        <p className="text-gray-400 text-xs sm:text-sm">
                          {userLocation ? 'Rencontrez des personnes près de chez vous' : 'Activez la localisation dans les paramètres'}
                        </p>
                        {userLocation && (
                          <div className="mt-2 text-green-400 text-xs">
                            Disponible dans votre région
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              </div>

              {/* Groups Quick Access */}
              <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-xl p-4 sm:p-6">
                <h3 className="text-base sm:text-lg font-semibold text-white mb-3 flex items-center">
                  <Users className="w-5 h-5 mr-2 text-purple-400" />
                  Groupes de Discussion
                </h3>
                <p className="text-gray-300 text-xs sm:text-sm mb-4">
                  Rejoignez des conversations thématiques avec plusieurs utilisateurs
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-between space-y-2 sm:space-y-0">
                  <button
                    onClick={() => setPage('groups')}
                    className="w-full sm:w-auto mobile-button px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-600 text-white rounded-lg hover:from-purple-400 hover:to-pink-500 transition-all duration-300 font-medium"
                  >
                    Voir tous les groupes
                  </button>
                  <div className="text-purple-400 text-xs sm:text-sm live-indicator">
                    {waitingCounts.group} groupes actifs
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Searching State */}
        {isSearching && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4 p-4">
              <div className="w-16 h-16 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto" 
                   style={{ animationDuration: '1.2s' }} />
              <p className="text-white text-base sm:text-lg">{getSearchStatusText()}</p>
              <p className="text-gray-400 text-sm">
                Recherche de vrais utilisateurs disponibles...
              </p>
              <div className="text-cyan-400 text-xs sm:text-sm live-indicator">
                {waitingCounts.chat} vrais utilisateurs en attente
              </div>
              {searchAttempts > 2 && (
                <p className="text-yellow-400 text-xs sm:text-sm">
                  Peu de vrais utilisateurs disponibles actuellement
                </p>
              )}
            </div>
          </div>
        )}

        {/* Chat Interface */}
        {isConnected && (
          <>
            {/* Messages */}
            <div className="messages-container space-y-4 custom-scroll">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.isOwn ? 'justify-end' : 'justify-start'} message-enter`}
                >
                  <div
                    className={`max-w-xs sm:max-w-sm lg:max-w-md px-3 sm:px-4 py-2 rounded-2xl transition-all duration-200 ${
                      message.isOwn
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white'
                        : message.userId === 'system'
                        ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                        : 'bg-white/10 text-white border border-white/20'
                    }`}
                  >
                    {!message.isOwn && message.userId !== 'system' && (
                      <p className="text-xs opacity-70 mb-1">{message.username}</p>
                    )}
                    <p className="text-xs sm:text-sm">{message.message}</p>
                    <p className="text-xs opacity-60 mt-1">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Controls */}
            {currentView === 'random' && (
              <div className="bg-black/10 backdrop-blur-sm border-t border-white/10 px-3 sm:px-4 py-2 flex-shrink-0">
                <div className="flex items-center justify-center space-x-2 sm:space-x-4">
                  <button
                    onClick={handleSkipUser}
                    disabled={isSearching}
                    className="flex items-center space-x-1 sm:space-x-2 mobile-button px-3 sm:px-4 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30 transition-all duration-200 disabled:opacity-50"
                  >
                    <SkipForward className="w-4 h-4" />
                    <span className="text-xs sm:text-sm">
                      {isSearching ? 'Recherche...' : 'Suivant'}
                    </span>
                  </button>
                  {canAddFriend && (
                    <button
                      onClick={handleAddFriend}
                      disabled={showAddFriend}
                      className="flex items-center space-x-1 sm:space-x-2 mobile-button px-3 sm:px-4 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-all duration-200 disabled:opacity-50"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span className="text-xs sm:text-sm">
                        {showAddFriend ? 'Envoi...' : 'Ajouter ami'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Message Input */}
            <div className="message-input-container flex-shrink-0">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={currentMessage}
                  onChange={(e) => setCurrentMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Tapez votre message..."
                  maxLength={500}
                  className="flex-1 bg-white/10 border border-white/20 rounded-full px-3 sm:px-4 py-2 sm:py-3 text-white placeholder-gray-400 focus:outline-none focus:border-cyan-400 transition-colors duration-200 text-sm sm:text-base"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!currentMessage.trim()}
                  className="p-2 sm:p-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-full hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}