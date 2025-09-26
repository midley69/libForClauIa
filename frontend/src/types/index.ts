// ============================================================================
// TYPES TYPESCRIPT POUR LIBEKOO
// Fichier : /var/www/libekoo/frontend/src/types/index.ts
// ============================================================================

// ============================================================================
// TYPES UTILISATEUR
// ============================================================================

export type UserGender = 'homme' | 'femme' | 'non-binaire' | 'non-specifie'
export type UserStatus = 'offline' | 'online' | 'busy' | 'away'
export type AccountType = 'anonymous' | 'registered' | 'premium' | 'admin'
export type AgeRange = '13-17' | '18-24' | '25-34' | '35-44' | '45+'

export interface User {
  id: string
  username: string
  email?: string
  type: AccountType
  gender: UserGender
  ageRange?: AgeRange
  bio?: string
  status: UserStatus
  location: {
    country: string
    city: string
  }
  points: number
  level: number
  badges: Badge[]
  stats: UserStats
  preferences: UserPreferences
  createdAt: string
  lastActive: string
  isBanned?: boolean
  banReason?: string
}

export interface UserStats {
  totalChats: number
  totalMessages: number
  totalVideoCalls: number
  totalTimeMinutes: number
  friendsAdded: number
  reportsReceived?: number
  reportsSent?: number
}

export interface UserPreferences {
  theme?: 'light' | 'dark' | 'auto'
  language?: string
  notifications?: boolean
  autoSwitch?: boolean
  matching?: MatchingPreferences
}

export interface MatchingPreferences {
  genderPreference: 'all' | UserGender
  ageRangePreference: 'all' | AgeRange
  maxDistance: number
}

export interface Badge {
  id: string
  name: string
  description: string
  icon: string
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  earnedAt: string
}

// ============================================================================
// TYPES CHAT
// ============================================================================

export type SessionType = 'random' | 'local' | 'group' | 'private'
export type SessionStatus = 'waiting' | 'active' | 'ended' | 'abandoned'
export type MessageType = 'text' | 'emoji' | 'image' | 'file' | 'system'

export interface ChatSession {
  id: string
  type: SessionType
  status: SessionStatus
  partner?: {
    id: string
    username: string
    gender: UserGender
    location: {
      country: string
      city: string
    }
    distance?: number
  }
  messageCount: number
  duration: number
  createdAt: string
  startedAt?: string
  endedAt?: string
  lastActivity: string
}

export interface ChatMessage {
  id: string
  sessionId: string
  content: string
  type: MessageType
  sender: {
    id: string
    username: string
    isOwn: boolean
  }
  sentAt: string
  isEdited?: boolean
  editedAt?: string
  metadata?: Record<string, any>
}

export interface TypingIndicator {
  sessionId: string
  userId: string
  isTyping: boolean
  timestamp: number
}

// ============================================================================
// TYPES VIDÉO
// ============================================================================

export type VideoSessionStatus = 'waiting' | 'active' | 'ended' | 'failed'
export type VideoRoomType = 'private' | 'group' | 'random'

export interface VideoSession {
  id: string
  roomId: string
  type: VideoRoomType
  status: VideoSessionStatus
  creator: string
  participants: VideoParticipant[]
  maxParticipants: number
  settings: VideoSettings
  webrtcConfig: WebRTCConfig
  createdAt: string
  startedAt?: string
  endedAt?: string
  duration?: number
}

export interface VideoParticipant {
  userId: string
  username: string
  role: 'creator' | 'participant'
  joinedAt: string
  mediaState: MediaState
  isOwn: boolean
}

export interface MediaState {
  audio: boolean
  video: boolean
  screen: boolean
}

export interface VideoSettings {
  audioEnabled: boolean
  videoEnabled: boolean
  screenSharingEnabled: boolean
}

export interface WebRTCConfig {
  iceServers: RTCIceServer[]
}

export interface VideoQualityReport {
  roomId: string
  qualityIssues: QualityIssue[]
  connectionStats: ConnectionStats
}

export type QualityIssue = 
  | 'poor_video' 
  | 'poor_audio' 
  | 'connection_drops' 
  | 'high_latency' 
  | 'echo' 
  | 'noise'

export interface ConnectionStats {
  latency?: number
  packetLoss?: number
  bandwidth?: number
  quality?: 'excellent' | 'good' | 'fair' | 'poor'
}

// ============================================================================
// TYPES MATCHING
// ============================================================================

export type MatchType = 'random' | 'local' | 'group'

export interface MatchingRequest {
  matchType: MatchType
  preferences?: MatchingPreferences
}

export interface MatchingResult {
  success: boolean
  matched: boolean
  searchId?: string
  session?: ChatSession
  partner?: {
    id: string
    username: string
    gender: UserGender
    location: {
      country: string
      city: string
    }
    distance?: number
  }
  queuePosition?: number
  estimatedWait?: number
}

export interface QueueStats {
  random: {
    waiting: number
    averageWait: number
    activeMatches: number
  }
  local: {
    waiting: number
    averageWait: number
    activeMatches: number
  }
  group: {
    waiting: number
    averageWait: number
    activeMatches: number
  }
  totalOnlineUsers: number
  lastUpdated: string
}

// ============================================================================
// TYPES ANALYTICS
// ============================================================================

export interface PublicStats {
  onlineUsers: number
  activeChats: number
  activeVideos: number
  countriesRepresented: number
  chatsToday: number
  videosToday: number
  lastUpdated: string
}

export interface PersonalStats {
  user: User
  totals: {
    totalChats: number
    totalMessages: number
    totalVideoCalls: number
    totalTimeMinutes: number
    friendsAdded: number
  }
  sessionsByType: Record<SessionType, {
    count: number
    averageDuration: number
    totalMessages: number
  }>
  dailyActivity: Array<{
    date: string
    messages: number
  }>
  achievements: Record<string, boolean>
  lastUpdated: string
}

export interface ActivityData {
  date: string
  chat?: number
  video?: number
  messages?: number
}

// ============================================================================
// TYPES MODÉRATION
// ============================================================================

export type ReportType = 
  | 'spam' 
  | 'harassment' 
  | 'inappropriate_content' 
  | 'fake_profile' 
  | 'underage' 
  | 'other'

export type ReportStatus = 'pending' | 'investigating' | 'resolved' | 'dismissed'
export type ReportPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface ModerationReport {
  id: string
  reporter: {
    id: string
    username: string
  }
  reported: {
    id: string
    username: string
  }
  targetType: 'user' | 'message' | 'session'
  targetId: string
  reportType: ReportType
  description?: string
  status: ReportStatus
  priority: ReportPriority
  assignedTo?: string
  adminNotes?: string
  actionTaken?: string
  evidence?: Record<string, any>
  createdAt: string
  updatedAt: string
  resolvedAt?: string
}

// ============================================================================
// TYPES API
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  code?: string
  message?: string
  details?: any[]
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

export interface AuthResponse {
  success: boolean
  user: User
  token: string
  expiresIn: string
}

// ============================================================================
// TYPES SOCKET
// ============================================================================

export interface SocketUser {
  userId: string
  username: string
  socketId: string
}

export interface SocketError {
  message: string
  code?: string
  details?: any
}

// Événements Socket.io
export interface ServerToClientEvents {
  // Chat
  'chat:new_message': (message: ChatMessage) => void
  'chat:partner_connected': (data: { sessionId: string; partnerId: string; timestamp: string }) => void
  'chat:partner_disconnected': (data: { sessionId: string; partnerId: string; timestamp: string; reason?: string }) => void
  'chat:partner_typing': (data: { sessionId: string; partnerId: string; isTyping: boolean; timestamp: number }) => void
  'chat:session_ended': (data: { sessionId: string; endedBy: string; duration: number; timestamp: string }) => void
  'chat:partner_left': (data: { sessionId: string; timestamp: string }) => void
  
  // Vidéo
  'video:participant_joined': (data: { roomId: string; participant: VideoParticipant }) => void
  'video:participant_left': (data: { roomId: string; participantId: string; timestamp: number }) => void
  'video:participant_audio_changed': (data: { roomId: string; participantId: string; audioEnabled: boolean }) => void
  'video:participant_video_changed': (data: { roomId: string; participantId: string; videoEnabled: boolean }) => void
  'video:participant_screen_share_changed': (data: { roomId: string; participantId: string; screenSharingEnabled: boolean }) => void
  'video:participants_updated': (data: { roomId: string; participants: VideoParticipant[] }) => void
  'video:offer': (data: { roomId: string; fromUserId: string; targetUserId: string; offer: RTCSessionDescriptionInit }) => void
  'video:answer': (data: { roomId: string; fromUserId: string; targetUserId: string; answer: RTCSessionDescriptionInit }) => void
  'video:ice_candidate': (data: { roomId: string; fromUserId: string; targetUserId: string; candidate: RTCIceCandidateInit }) => void
  'video:participant_error': (data: { roomId: string; participantId: string; error: string }) => void
  'video:participant_disconnected': (data: { roomId: string; participantId: string; timestamp: number; reason?: string }) => void
  
  // Système
  'user:banned': (data: { reason: string; duration: string; bannedBy: string }) => void
  'error': (error: SocketError) => void
}

export interface ClientToServerEvents {
  // Chat
  'chat:join_session': (data: { sessionId: string }, callback: (response: ApiResponse) => void) => void
  'chat:leave_session': (data: { sessionId: string }, callback: (response: ApiResponse) => void) => void
  'chat:send_message': (data: { sessionId: string; content: string; messageType?: MessageType; metadata?: Record<string, any> }, callback: (response: ApiResponse) => void) => void
  'chat:typing': (data: { sessionId: string; isTyping: boolean }) => void
  'chat:end_session': (data: { sessionId: string; rating?: number; reason?: string }, callback: (response: ApiResponse) => void) => void
  'chat:next_partner': (data: { currentSessionId?: string }, callback: (response: ApiResponse) => void) => void
  'chat:report': (data: { sessionId: string; targetType: string; targetId: string; reportType: ReportType; description?: string }, callback: (response: ApiResponse) => void) => void
  
  // Vidéo
  'video:join_room': (data: { roomId: string }, callback: (response: ApiResponse) => void) => void
  'video:leave_room': (data: { roomId: string }, callback: (response: ApiResponse) => void) => void
  'video:toggle_audio': (data: { roomId: string; enabled: boolean }, callback: (response: ApiResponse) => void) => void
  'video:toggle_video': (data: { roomId: string; enabled: boolean }, callback: (response: ApiResponse) => void) => void
  'video:toggle_screen_share': (data: { roomId: string; enabled: boolean }, callback: (response: ApiResponse) => void) => void
  'video:offer': (data: { roomId: string; targetUserId: string; offer: RTCSessionDescriptionInit }) => void
  'video:answer': (data: { roomId: string; targetUserId: string; answer: RTCSessionDescriptionInit }) => void
  'video:ice_candidate': (data: { roomId: string; targetUserId: string; candidate: RTCIceCandidateInit }) => void
  'video:quality_report': (data: { roomId: string; stats: ConnectionStats }) => void
  'video:error': (data: { roomId: string; error: string; context: string }) => void
}

// ============================================================================
// TYPES UI
// ============================================================================

export interface ToastOptions {
  type: 'success' | 'error' | 'warning' | 'info'
  title?: string
  message: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  closeOnOverlayClick?: boolean
  showCloseButton?: boolean
}

export interface LoadingState {
  isLoading: boolean
  error?: string | null
}

// ============================================================================
// TYPES STORE (ZUSTAND)
// ============================================================================

export interface AuthStore {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  
  // Actions
  login: (email: string, password: string) => Promise<void>
  register: (userData: Partial<User> & { email: string; password: string }) => Promise<void>
  createAnonymousSession: (userData: { gender?: UserGender; preferences?: Partial<UserPreferences> }) => Promise<void>
  logout: () => void
  refreshToken: () => Promise<void>
  updateUser: (updates: Partial<User>) => void
  clearError: () => void
}

export interface ChatStore {
  currentSession: ChatSession | null
  messages: ChatMessage[]
  isConnected: boolean
  isSearching: boolean
  typingUsers: TypingIndicator[]
  
  // Actions
  setCurrentSession: (session: ChatSession | null) => void
  addMessage: (message: ChatMessage) => void
  updateTyping: (typing: TypingIndicator) => void
  clearMessages: () => void
  setSearching: (searching: boolean) => void
}

export interface VideoStore {
  currentRoom: VideoSession | null
  localStream: MediaStream | null
  remoteStreams: Map<string, MediaStream>
  isConnected: boolean
  mediaState: MediaState
  
  // Actions
  setCurrentRoom: (room: VideoSession | null) => void
  setLocalStream: (stream: MediaStream | null) => void
  addRemoteStream: (userId: string, stream: MediaStream) => void
  removeRemoteStream: (userId: string) => void
  updateMediaState: (state: Partial<MediaState>) => void
}

// ============================================================================
// TYPES UTILITAIRES
// ============================================================================

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
export type RequiredKeys<T, K extends keyof T> = T & Required<Pick<T, K>>

export interface Coordinates {
  latitude: number
  longitude: number
}

export interface Country {
  code: string
  name: string
  flag: string
}

export interface City {
  name: string
  country: string
  coordinates?: Coordinates
}

// Globals
declare global {
  interface Window {
    __APP_VERSION__: string
    __BUILD_TIME__: string
  }
}

export {}
