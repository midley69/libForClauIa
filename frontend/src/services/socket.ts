// ============================================================================
// SERVICE SOCKET.IO FRONTEND
// Fichier : /var/www/libekoo/frontend/src/services/socket.ts
// ============================================================================

import { io, Socket } from 'socket.io-client'
import { 
  ServerToClientEvents, 
  ClientToServerEvents,
  ChatMessage,
  VideoParticipant,
  TypingIndicator
} from '@/types'
import apiService from './api'

// ============================================================================
// CONFIGURATION
// ============================================================================

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || ''
const RECONNECTION_ATTEMPTS = 5
const RECONNECTION_DELAY = 1000

// ============================================================================
// TYPES
// ============================================================================

type EventCallback = (...args: any[]) => void

interface SocketConfig {
  autoConnect?: boolean
  transports?: string[]
}

// ============================================================================
// SERVICE SOCKET
// ============================================================================

class SocketService {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null
  private isConnected = false
  private isConnecting = false
  private eventListeners = new Map<string, Set<EventCallback>>()
  private reconnectAttempts = 0
  private maxReconnectAttempts = RECONNECTION_ATTEMPTS

  constructor() {
    // Ne pas se connecter automatiquement
  }

  // ============================================================================
  // CONNEXION ET DÉCONNEXION
  // ============================================================================

  connect(config: SocketConfig = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnected || this.isConnecting) {
        resolve()
        return
      }

      this.isConnecting = true

      const token = apiService.getToken()
      
      this.socket = io(SOCKET_URL, {
        auth: {
          token: token || undefined
        },
        transports: config.transports || ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: RECONNECTION_DELAY,
        timeout: 20000,
        autoConnect: config.autoConnect !== false
      })

      // Événements de connexion
      this.socket.on('connect', () => {
        console.log('🔌 Socket connecté:', this.socket?.id)
        this.isConnected = true
        this.isConnecting = false
        this.reconnectAttempts = 0
        this.emit('socket:connected')
        resolve()
      })

      this.socket.on('disconnect', (reason) => {
        console.log('🔌 Socket déconnecté:', reason)
        this.isConnected = false
        this.emit('socket:disconnected', reason)
      })

      this.socket.on('connect_error', (error) => {
        console.error('❌ Erreur de connexion socket:', error)
        this.isConnecting = false
        this.reconnectAttempts++
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.emit('socket:connection_failed', error)
          reject(error)
        }
      })

      this.socket.on('reconnect', (attemptNumber) => {
        console.log(`🔄 Socket reconnecté après ${attemptNumber} tentative(s)`)
        this.isConnected = true
        this.reconnectAttempts = 0
        this.emit('socket:reconnected', attemptNumber)
      })

      this.socket.on('reconnect_failed', () => {
        console.error('❌ Échec de reconnexion socket')
        this.isConnected = false
        this.emit('socket:reconnection_failed')
      })

      // Configurer les listeners d'événements
      this.setupEventListeners()
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
      this.isConnected = false
      this.isConnecting = false
      this.emit('socket:disconnected', 'manual')
    }
  }

  // ============================================================================
  // GESTION DES ÉVÉNEMENTS
  // ============================================================================

  private setupEventListeners(): void {
    if (!this.socket) return

    // Événements de chat
    this.socket.on('chat:new_message', (message) => {
      console.log('📨 Nouveau message reçu:', message)
      this.emit('chat:new_message', message)
    })

    this.socket.on('chat:partner_connected', (data) => {
      console.log('👤 Partenaire connecté:', data)
      this.emit('chat:partner_connected', data)
    })

    this.socket.on('chat:partner_disconnected', (data) => {
      console.log('👤 Partenaire déconnecté:', data)
      this.emit('chat:partner_disconnected', data)
    })

    this.socket.on('chat:partner_typing', (data) => {
      this.emit('chat:partner_typing', data)
    })

    this.socket.on('chat:session_ended', (data) => {
      console.log('🔚 Session de chat terminée:', data)
      this.emit('chat:session_ended', data)
    })

    this.socket.on('chat:partner_left', (data) => {
      console.log('👋 Partenaire parti:', data)
      this.emit('chat:partner_left', data)
    })

    // Événements vidéo
    this.socket.on('video:participant_joined', (data) => {
      console.log('🎥 Participant rejoint:', data)
      this.emit('video:participant_joined', data)
    })

    this.socket.on('video:participant_left', (data) => {
      console.log('🎥 Participant parti:', data)
      this.emit('video:participant_left', data)
    })

    this.socket.on('video:participant_audio_changed', (data) => {
      this.emit('video:participant_audio_changed', data)
    })

    this.socket.on('video:participant_video_changed', (data) => {
      this.emit('video:participant_video_changed', data)
    })

    this.socket.on('video:participant_screen_share_changed', (data) => {
      this.emit('video:participant_screen_share_changed', data)
    })

    this.socket.on('video:participants_updated', (data) => {
      this.emit('video:participants_updated', data)
    })

    // Événements WebRTC
    this.socket.on('video:offer', (data) => {
      this.emit('video:offer', data)
    })

    this.socket.on('video:answer', (data) => {
      this.emit('video:answer', data)
    })

    this.socket.on('video:ice_candidate', (data) => {
      this.emit('video:ice_candidate', data)
    })

    this.socket.on('video:participant_error', (data) => {
      console.error('🎥 Erreur participant:', data)
      this.emit('video:participant_error', data)
    })

    this.socket.on('video:participant_disconnected', (data) => {
      console.log('🎥 Participant déconnecté:', data)
      this.emit('video:participant_disconnected', data)
    })

    // Événements système
    this.socket.on('user:banned', (data) => {
      console.warn('🚫 Utilisateur banni:', data)
      this.emit('user:banned', data)
    })

    this.socket.on('error', (error) => {
      console.error('❌ Erreur socket:', error)
      this.emit('socket:error', error)
    })
  }

  // ============================================================================
  // MÉTHODES UTILITAIRES
  // ============================================================================

  isSocketConnected(): boolean {
    return this.isConnected && this.socket?.connected === true
  }

  getSocketId(): string | undefined {
    return this.socket?.id
  }

  // ============================================================================
  // GESTION DES LISTENERS
  // ============================================================================

  on(event: string, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)?.add(callback)
  }

  off(event: string, callback?: EventCallback): void {
    if (callback) {
      this.eventListeners.get(event)?.delete(callback)
    } else {
      this.eventListeners.delete(event)
    }
  }

  private emit(event: string, ...args: any[]): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(...args)
        } catch (error) {
          console.error(`Erreur dans le listener ${event}:`, error)
        }
      })
    }
  }

  // ============================================================================
  // MÉTHODES CHAT
  // ============================================================================

  joinChatSession(sessionId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isSocketConnected()) {
        reject(new Error('Socket non connecté'))
        return
      }

      this.socket?.emit('chat:join_session', { sessionId }, (response) => {
        if (response.success) {
          resolve(response)
        } else {
          reject(new Error(response.error || 'Erreur inconnue'))
        }
      })
    })
  }

  leaveChatSession(sessionId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isSocketConnected()) {
        reject(new Error('Socket non connecté'))
        return
      }

      this.socket?.emit('chat:leave_session', { sessionId }, (response) => {
        if (response.success) {
          resolve(response)
        } else {
          reject(new Error(response.error || 'Erreur inconnue'))
        }
      })
    })
  }

  sendMessage(data: {
    sessionId: string
    content: string
    messageType?: string
    metadata?: Record<string, any>
  }): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isSocketConnected()) {
        reject(new Error('Socket non connecté'))
        return
      }

      this.socket?.emit('chat:send_message', data, (response) => {
        if (response.success) {
          resolve(response)
        } else {
          reject(new Error(response.error || 'Erreur envoi message'))
        }
      })
    })
  }

  sendTyping(sessionId: string, isTyping: boolean): void {
    if (this.isSocketConnected()) {
      this.socket?.emit('chat:typing', { sessionId, isTyping })
    }
  }

  endChatSession(data: {
    sessionId: string
    rating?: number
    reason?: string
  }): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isSocketConnected()) {
        reject(new Error('Socket non connecté'))
        return
      }

      this.socket?.emit('chat:end_session', data, (response) => {
        if (response.success) {
          resolve(response)
        } else {
          reject(new Error(response.error || 'Erreur fin session'))
        }
      })
    })
  }

  requestNextPartner(currentSessionId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isSocketConnected()) {
        reject(new Error('Socket non connecté'))
        return
      }

      this.socket?.emit('chat:next_partner', { currentSessionId }, (response) => {
        if (response.success) {
          resolve(response)
        } else {
          reject(new Error(response.error || 'Erreur changement partenaire'))
        }
      })
    })
  }

  reportContent(data: {
    sessionId: string
    targetType: string
    targetId: string
    reportType: string
    description?: string
  }): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isSocketConnected()) {
        reject(new Error('Socket non connecté'))
        return
      }

      this.socket?.emit('chat:report', data, (response) => {
        if (response.success) {
          resolve(response)
        } else {
          reject(new Error(response.error || 'Erreur signalement'))
        }
      })
    })
  }

  // ============================================================================
  // MÉTHODES VIDÉO
  // ============================================================================

  joinVideoRoom(roomId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isSocketConnected()) {
        reject(new Error('Socket non connecté'))
        return
      }

      this.socket?.emit('video:join_room', { roomId }, (response) => {
        if (response.success) {
          resolve(response)
        } else {
          reject(new Error(response.error || 'Erreur connexion room vidéo'))
        }
      })
    })
  }

  leaveVideoRoom(roomId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isSocketConnected()) {
        reject(new Error('Socket non connecté'))
        return
      }

      this.socket?.emit('video:leave_room', { roomId }, (response) => {
        if (response.success) {
          resolve(response)
        } else {
          reject(new Error(response.error || 'Erreur déconnexion room vidéo'))
        }
      })
    })
  }

  toggleAudio(roomId: string, enabled: boolean): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isSocketConnected()) {
        reject(new Error('Socket non connecté'))
        return
      }

      this.socket?.emit('video:toggle_audio', { roomId, enabled }, (response) => {
        if (response.success) {
          resolve(response)
        } else {
          reject(new Error(response.error || 'Erreur toggle audio'))
        }
      })
    })
  }

  toggleVideo(roomId: string, enabled: boolean): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isSocketConnected()) {
        reject(new Error('Socket non connecté'))
        return
      }

      this.socket?.emit('video:toggle_video', { roomId, enabled }, (response) => {
        if (response.success) {
          resolve(response)
        } else {
          reject(new Error(response.error || 'Erreur toggle vidéo'))
        }
      })
    })
  }

  toggleScreenShare(roomId: string, enabled: boolean): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isSocketConnected()) {
        reject(new Error('Socket non connecté'))
        return
      }

      this.socket?.emit('video:toggle_screen_share', { roomId, enabled }, (response) => {
        if (response.success) {
          resolve(response)
        } else {
          reject(new Error(response.error || 'Erreur partage écran'))
        }
      })
    })
  }

  // ============================================================================
  // MÉTHODES WEBRTC
  // ============================================================================

  sendOffer(roomId: string, targetUserId: string, offer: RTCSessionDescriptionInit): void {
    if (this.isSocketConnected()) {
      this.socket?.emit('video:offer', { roomId, targetUserId, offer })
    }
  }

  sendAnswer(roomId: string, targetUserId: string, answer: RTCSessionDescriptionInit): void {
    if (this.isSocketConnected()) {
      this.socket?.emit('video:answer', { roomId, targetUserId, answer })
    }
  }

  sendIceCandidate(roomId: string, targetUserId: string, candidate: RTCIceCandidateInit): void {
    if (this.isSocketConnected()) {
      this.socket?.emit('video:ice_candidate', { roomId, targetUserId, candidate })
    }
  }

  reportQuality(roomId: string, stats: any): void {
    if (this.isSocketConnected()) {
      this.socket?.emit('video:quality_report', { roomId, stats })
    }
  }

  reportError(roomId: string, error: string, context: string): void {
    if (this.isSocketConnected()) {
      this.socket?.emit('video:error', { roomId, error, context })
    }
  }

  // ============================================================================
  // NETTOYAGE
  // ============================================================================

  cleanup(): void {
    this.eventListeners.clear()
    this.disconnect()
  }
}

// ============================================================================
// INSTANCE SINGLETON
// ============================================================================

const socketService = new SocketService()

export default socketService
export { SocketService }
