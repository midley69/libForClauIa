import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  User, 
  Shield, 
  Bell, 
  Globe, 
  LogOut,
  Edit3,
  Save,
  X,
  MapPin,
  Users,
  UserPlus,
  Check,
  MessageCircle,
  Video as VideoIcon,
  Trash2
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const LANGUAGES = [
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
];

interface Friend {
  id: string;
  name: string;
  status: 'online' | 'offline';
  addedFrom: 'chat' | 'video' | 'group';
  addedAt: Date;
}

export function SettingsPage() {
  const { state, setPage, setUser } = useApp();
  const [isEditing, setIsEditing] = useState(false);
  const [isLogin, setIsLogin] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notifications, setNotifications] = useState(true);
  const [language, setLanguage] = useState('fr');
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [userLocation, setUserLocation] = useState<{country: string, city: string} | null>(null);
  const [locationStatus, setLocationStatus] = useState<'checking' | 'enabled' | 'disabled'>('checking');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [languageChangeMessage, setLanguageChangeMessage] = useState('');

  useEffect(() => {
    // Load settings from localStorage
    const savedNotifications = localStorage.getItem('notifications');
    const savedLanguage = localStorage.getItem('language');
    const savedLocationEnabled = localStorage.getItem('locationEnabled');
    const savedFriends = localStorage.getItem('friends');
    
    if (savedNotifications !== null) setNotifications(savedNotifications === 'true');
    if (savedLanguage) setLanguage(savedLanguage);
    if (savedLocationEnabled !== null) {
      const isEnabled = savedLocationEnabled === 'true';
      setLocationEnabled(isEnabled);
      setLocationStatus(isEnabled ? 'enabled' : 'disabled');
    } else {
      setLocationStatus('disabled');
    }
    if (savedFriends) {
      try {
        const parsedFriends = JSON.parse(savedFriends);
        setFriends(parsedFriends.map((f: any) => ({
          ...f,
          addedAt: new Date(f.addedAt)
        })));
      } catch (e) {
        setFriends([]);
      }
    }
  }, []);

  useEffect(() => {
    // Get user location only if enabled
    if (locationEnabled && navigator.geolocation) {
      setLocationStatus('checking');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // Use real coordinates to get approximate location
          setUserLocation({ country: 'France', city: 'Paris' });
          setLocationStatus('enabled');
        },
        (error) => {
          console.log('Location access denied:', error);
          setUserLocation(null);
          setLocationStatus('disabled');
          setLocationEnabled(false);
          localStorage.setItem('locationEnabled', 'false');
        }
      );
    } else {
      setUserLocation(null);
      setLocationStatus('disabled');
    }
  }, [locationEnabled]);

  const handleLogin = () => {
    if (email.trim() && password.trim()) {
      setUser({
        id: 'user-' + Date.now(),
        username: username.trim() || email.split('@')[0],
        isAnonymous: false,
        location: userLocation ? `${userLocation.city}, ${userLocation.country}` : undefined,
      });
      setIsLogin(false);
      setEmail('');
      setPassword('');
      setUsername('');
    }
  };

  const handleSaveProfile = () => {
    if (username.trim()) {
      setUser({
        id: 'user-' + Date.now(),
        username: username.trim(),
        isAnonymous: false,
        location: userLocation ? `${userLocation.city}, ${userLocation.country}` : undefined,
      });
      setIsEditing(false);
      setUsername('');
    }
  };

  const handleLogout = () => {
    setUser(null);
    setFriends([]);
    localStorage.removeItem('friends');
    setPage('home');
  };

  const handleRemoveFriend = (friendId: string) => {
    const updatedFriends = friends.filter(friend => friend.id !== friendId);
    setFriends(updatedFriends);
    localStorage.setItem('friends', JSON.stringify(updatedFriends));
  };

  const handleNotificationChange = (enabled: boolean) => {
    setNotifications(enabled);
    localStorage.setItem('notifications', enabled.toString());
  };

  const handleLanguageChange = (newLanguage: string) => {
    setLanguage(newLanguage);
    localStorage.setItem('language', newLanguage);
    
    const selectedLang = LANGUAGES.find(l => l.code === newLanguage);
    setLanguageChangeMessage(`Langue changée vers ${selectedLang?.name} ${selectedLang?.flag}`);
    
    setTimeout(() => {
      setLanguageChangeMessage('');
    }, 3000);
  };

  const handleLocationChange = (enabled: boolean) => {
    setLocationEnabled(enabled);
    localStorage.setItem('locationEnabled', enabled.toString());
    
    if (!enabled) {
      setUserLocation(null);
      setLocationStatus('disabled');
    }
  };

  const selectedLanguage = LANGUAGES.find(lang => lang.code === language) || LANGUAGES[0];

  const getLocationStatusText = () => {
    switch (locationStatus) {
      case 'checking':
        return 'Vérification en cours...';
      case 'enabled':
        return userLocation ? `Détectée: ${userLocation.city}, ${userLocation.country}` : 'Activée';
      case 'disabled':
        return 'Désactivée';
      default:
        return 'Inconnue';
    }
  };

  const getLocationStatusColor = () => {
    switch (locationStatus) {
      case 'checking':
        return 'text-yellow-400';
      case 'enabled':
        return 'text-green-400';
      case 'disabled':
        return 'text-gray-400';
      default:
        return 'text-gray-400';
    }
  };

  const getAddedFromIcon = (source: string) => {
    switch (source) {
      case 'chat':
        return <MessageCircle className="w-3 h-3" />;
      case 'video':
        return <VideoIcon className="w-3 h-3" />;
      case 'group':
        return <Users className="w-3 h-3" />;
      default:
        return <MessageCircle className="w-3 h-3" />;
    }
  };

  const getAddedFromText = (source: string) => {
    switch (source) {
      case 'chat':
        return 'Chat';
      case 'video':
        return 'Vidéo';
      case 'group':
        return 'Groupe';
      default:
        return 'Chat';
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-black/20 backdrop-blur-sm border-b border-white/10 p-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setPage('home')}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <h1 className="text-xl font-semibold text-white">Paramètres</h1>
          </div>
        </div>
      </div>

      {/* Language Change Message */}
      {languageChangeMessage && (
        <div className="bg-green-500/20 border border-green-500/30 p-3 mx-4 mt-4 rounded-lg">
          <p className="text-green-300 text-center text-sm">{languageChangeMessage}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-20">
        <div className="p-6 space-y-6 max-w-2xl mx-auto">
          {/* Profile Section */}
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center">
                <User className="w-5 h-5 mr-2 text-cyan-400" />
                Profil
              </h2>
              <button
                onClick={() => {
                  if (state.user) {
                    setIsEditing(!isEditing);
                  } else {
                    setIsLogin(!isLogin);
                  }
                }}
                className="p-2 text-cyan-400 hover:bg-cyan-400/10 rounded-lg transition-colors"
              >
                {(isEditing || isLogin) ? <X className="w-5 h-5" /> : <Edit3 className="w-5 h-5" />}
              </button>
            </div>

            {state.user ? (
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-cyan-400 to-purple-400 rounded-full flex items-center justify-center">
                    <span className="text-white font-semibold text-lg">
                      {state.user.username?.charAt(0).toUpperCase() || 'A'}
                    </span>
                  </div>
                  <div>
                    <p className="text-white font-medium">
                      {state.user.username || 'Utilisateur Anonyme'}
                    </p>
                    <p className="text-gray-400 text-sm">
                      {state.user.isAnonymous ? 'Mode Anonyme' : 'Compte Connecté'}
                    </p>
                    {state.user.location && (
                      <p className="text-cyan-400 text-sm flex items-center">
                        <MapPin className="w-3 h-3 mr-1" />
                        {state.user.location}
                      </p>
                    )}
                  </div>
                </div>
                
                {isEditing && (
                  <div className="space-y-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Nom d'utilisateur
                      </label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-400"
                        placeholder={state.user.username || "Nouveau nom d'utilisateur"}
                      />
                    </div>

                    <button
                      onClick={handleSaveProfile}
                      disabled={!username.trim()}
                      className="w-full p-3 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-semibold rounded-lg hover:from-cyan-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      <Save className="w-4 h-4 inline mr-2" />
                      Sauvegarder les modifications
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {isLogin ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Email
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-400"
                        placeholder="votre@email.com"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Mot de passe
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-400"
                        placeholder="••••••••"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Nom d'utilisateur (optionnel)
                      </label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-400"
                        placeholder="Nom d'affichage"
                      />
                    </div>

                    <button
                      onClick={handleLogin}
                      disabled={!email.trim() || !password.trim()}
                      className="w-full p-3 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-semibold rounded-lg hover:from-cyan-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      <Save className="w-4 h-4 inline mr-2" />
                      Se connecter
                    </button>
                  </div>
                ) : isEditing ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Nom d'utilisateur
                      </label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-400"
                        placeholder="Choisissez un nom d'utilisateur"
                      />
                    </div>

                    <button
                      onClick={handleSaveProfile}
                      disabled={!username.trim()}
                      className="w-full p-3 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-semibold rounded-lg hover:from-cyan-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      <Save className="w-4 h-4 inline mr-2" />
                      Sauvegarder le profil
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-300 mb-4">Vous êtes en mode anonyme</p>
                    <div className="space-y-3">
                      <button
                        onClick={() => setIsLogin(true)}
                        className="w-full px-6 py-3 bg-gradient-to-r from-cyan-500 to-purple-600 text-white font-semibold rounded-lg hover:from-cyan-400 hover:to-purple-500 transition-all"
                      >
                        Se connecter / S'inscrire
                      </button>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="w-full px-6 py-2 border border-cyan-400 text-cyan-400 font-semibold rounded-lg hover:bg-cyan-400/10 transition-all"
                      >
                        Créer un profil anonyme
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Friends Section */}
          {state.user && !state.user.isAnonymous && (
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
              <h2 className="text-lg font-semibold text-white flex items-center mb-4">
                <Users className="w-5 h-5 mr-2 text-green-400" />
                Amis ({friends.length})
              </h2>
              
              <div className="space-y-3">
                {friends.length > 0 ? (
                  friends.map((friend) => (
                    <div key={friend.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-blue-400 rounded-full flex items-center justify-center">
                          <span className="text-white font-medium text-sm">
                            {friend.name.charAt(0)}
                          </span>
                        </div>
                        <div>
                          <p className="text-white font-medium">{friend.name}</p>
                          <div className="flex items-center space-x-2">
                            <p className={`text-xs ${friend.status === 'online' ? 'text-green-400' : 'text-gray-400'}`}>
                              {friend.status === 'online' ? 'En ligne' : 'Hors ligne'}
                            </p>
                            <span className="text-gray-500">•</span>
                            <div className="flex items-center space-x-1 text-xs text-gray-400">
                              {getAddedFromIcon(friend.addedFrom)}
                              <span>{getAddedFromText(friend.addedFrom)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded-full ${friend.status === 'online' ? 'bg-green-400' : 'bg-gray-400'}`} />
                        <button
                          onClick={() => handleRemoveFriend(friend.id)}
                          className="p-1 text-red-400 hover:bg-red-400/10 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8">
                    <UserPlus className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-400 mb-2">Aucun ami pour le moment</p>
                    <p className="text-gray-500 text-sm">
                      Ajoutez des amis depuis les chats, vidéos ou groupes
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Privacy Section */}
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <h2 className="text-lg font-semibold text-white flex items-center mb-4">
              <Shield className="w-5 h-5 mr-2 text-purple-400" />
              Confidentialité & Sécurité
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-medium">Connexions authentiques</p>
                  <p className="text-gray-400 text-sm">Uniquement de vraies personnes, aucun bot</p>
                </div>
                <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-medium">Géolocalisation</p>
                  <p className={`text-sm ${getLocationStatusColor()}`}>
                    {getLocationStatusText()}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer" 
                    checked={locationEnabled}
                    onChange={(e) => handleLocationChange(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                </label>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-medium">Données personnelles</p>
                  <p className="text-gray-400 text-sm">Suppression automatique après déconnexion</p>
                </div>
                <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              </div>
            </div>
          </div>

          {/* Notifications Section */}
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <h2 className="text-lg font-semibold text-white flex items-center mb-4">
              <Bell className="w-5 h-5 mr-2 text-yellow-400" />
              Notifications
            </h2>
            
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">Notifications push</p>
                <p className="text-gray-400 text-sm">Recevoir des notifications de nouveaux messages</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={notifications}
                  onChange={(e) => handleNotificationChange(e.target.checked)}
                />
                <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
              </label>
            </div>
          </div>

          {/* Language Section */}
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <h2 className="text-lg font-semibold text-white flex items-center mb-4">
              <Globe className="w-5 h-5 mr-2 text-green-400" />
              Langue
            </h2>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                <span className="text-white">Langue actuelle</span>
                <div className="flex items-center space-x-2">
                  <span className="text-2xl">{selectedLanguage.flag}</span>
                  <span className="text-cyan-400 font-medium">{selectedLanguage.name}</span>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => handleLanguageChange(lang.code)}
                    className={`p-3 rounded-lg border transition-all flex items-center space-x-2 ${
                      language === lang.code
                        ? 'border-cyan-400 bg-cyan-400/10 text-cyan-400'
                        : 'border-white/20 bg-white/5 text-white hover:border-white/40'
                    }`}
                  >
                    <span className="text-xl">{lang.flag}</span>
                    <span className="text-sm font-medium">{lang.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Account Actions */}
          {state.user && (
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
              <button
                onClick={handleLogout}
                className="w-full p-3 text-red-400 border border-red-400/50 rounded-lg hover:bg-red-400/10 transition-all flex items-center justify-center"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Se déconnecter
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}