import React, { useState, useEffect, useRef } from 'react';
import { 
  Video, 
  VideoOff, 
  Mic, 
  MicOff, 
  PhoneOff, 
  SkipForward, 
  UserPlus,
  Volume2,
  VolumeX
} from 'lucide-react';

export default function VideoCallPage() {
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isSpeakerEnabled, setIsSpeakerEnabled] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [canAddFriend, setCanAddFriend] = useState(true);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const handleToggleVideo = () => {
    setIsVideoEnabled(!isVideoEnabled);
  };

  const handleToggleMic = () => {
    setIsMicEnabled(!isMicEnabled);
  };

  const handleToggleSpeaker = () => {
    setIsSpeakerEnabled(!isSpeakerEnabled);
  };

  const handleEndCall = () => {
    // Handle ending the call
    setIsConnected(false);
  };

  const handleSkipUser = () => {
    // Handle skipping to next user
    setCanAddFriend(true);
    setShowAddFriend(false);
  };

  const handleAddFriend = () => {
    setShowAddFriend(true);
    setCanAddFriend(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex flex-col">
      {/* Header */}
      <div className="p-4 bg-black/20 backdrop-blur-sm">
        <h1 className="text-2xl font-bold text-white text-center">Appel Vidéo</h1>
      </div>

      {/* Video Container */}
      <div className="flex-1 relative p-4">
        {/* Remote Video (Main) */}
        <div className="w-full h-full bg-gray-800 rounded-lg overflow-hidden relative">
          <video
            ref={remoteVideoRef}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
          />
          
          {/* Remote user placeholder when no video */}
          {!isConnected && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
              <div className="text-center text-white">
                <div className="w-24 h-24 bg-gray-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                  <Video className="w-12 h-12" />
                </div>
                <p className="text-lg">En attente de connexion...</p>
              </div>
            </div>
          )}

          {/* Local Video (Picture in Picture) */}
          <div className="absolute top-4 right-4 w-32 h-24 bg-gray-700 rounded-lg overflow-hidden border-2 border-white/20">
            <video
              ref={localVideoRef}
              className="w-full h-full object-cover"
              autoPlay
              playsInline
              muted
            />
            {!isVideoEnabled && (
              <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                <VideoOff className="w-6 h-6 text-white" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      {isConnected && (
        <div className="p-6 bg-black/30 backdrop-blur-sm">
          <div className="flex justify-center space-x-4">
            {/* Toggle Video */}
            <button
              onClick={handleToggleVideo}
              className={`p-4 rounded-full transition-all duration-300 ${
                isVideoEnabled 
                  ? 'bg-gray-600 hover:bg-gray-500' 
                  : 'bg-red-500 hover:bg-red-400'
              }`}
              title={isVideoEnabled ? 'Désactiver la caméra' : 'Activer la caméra'}
            >
              {isVideoEnabled ? (
                <Video className="w-6 h-6 text-white" />
              ) : (
                <VideoOff className="w-6 h-6 text-white" />
              )}
            </button>

            {/* Toggle Microphone */}
            <button
              onClick={handleToggleMic}
              className={`p-4 rounded-full transition-all duration-300 ${
                isMicEnabled 
                  ? 'bg-gray-600 hover:bg-gray-500' 
                  : 'bg-red-500 hover:bg-red-400'
              }`}
              title={isMicEnabled ? 'Couper le micro' : 'Activer le micro'}
            >
              {isMicEnabled ? (
                <Mic className="w-6 h-6 text-white" />
              ) : (
                <MicOff className="w-6 h-6 text-white" />
              )}
            </button>

            {/* Toggle Speaker */}
            <button
              onClick={handleToggleSpeaker}
              className={`p-4 rounded-full transition-all duration-300 ${
                isSpeakerEnabled 
                  ? 'bg-gray-600 hover:bg-gray-500' 
                  : 'bg-red-500 hover:bg-red-400'
              }`}
              title={isSpeakerEnabled ? 'Couper le son' : 'Activer le son'}
            >
              {isSpeakerEnabled ? (
                <Volume2 className="w-6 h-6 text-white" />
              ) : (
                <VolumeX className="w-6 h-6 text-white" />
              )}
            </button>

            {/* End Call */}
            <button
              onClick={handleEndCall}
              className="p-4 bg-red-500 hover:bg-red-400 rounded-full transition-all duration-300"
              title="Terminer l'appel"
            >
              <PhoneOff className="w-6 h-6 text-white" />
            </button>

            {/* Skip User */}
            <button
              onClick={handleSkipUser}
              className="p-4 bg-yellow-500 hover:bg-yellow-400 rounded-full transition-all duration-300"
              title="Passer au suivant"
            >
              <SkipForward className="w-6 h-6 text-white" />
            </button>

            {/* Add Friend */}
            {canAddFriend && !showAddFriend && (
              <button
                onClick={handleAddFriend}
                className="p-4 bg-green-500 hover:bg-green-400 rounded-full transition-all duration-300"
                title="Ajouter en ami"
              >
                <UserPlus className="w-6 h-6 text-white" />
              </button>
            )}

            {showAddFriend && (
              <div className="p-4 bg-green-500 rounded-full">
                <span className="text-white text-sm">✓ Demande envoyée</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { VideoCallPage }