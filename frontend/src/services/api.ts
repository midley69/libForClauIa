// ============================================================================
// SERVICE API FRONTEND
// Fichier : /var/www/libekoo/frontend/src/services/api.ts
// ============================================================================

import axios, { AxiosInstance, AxiosError, AxiosResponse } from 'axios'
import { 
  ApiResponse, 
  AuthResponse, 
  User, 
  ChatSession, 
  ChatMessage,
  VideoSession,
  MatchingRequest,
  MatchingResult,
  QueueStats,
  PublicStats,
  PersonalStats,
  ActivityData,
  ModerationReport,
  PaginatedResponse
} from '@/types'

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'
const API_TIMEOUT = 10000

// ============================================================================
// INSTANCE AXIOS
// ============================================================================

class ApiService {
  private api: AxiosInstance
  private token: string | null = null

  constructor() {
    this.api = axios.create({
      baseURL: API_BASE_URL,
      timeout: API_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // Intercepteur de requête pour ajouter le token
    this.api.interceptors.request.use(
      (config) => {
        if (this.token) {
          config.headers.Authorization = `Bearer ${this.token}`
        }
        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // Intercepteur de réponse pour gérer les erreurs
    this.api.interceptors.response.use(
      (response: AxiosResponse) => response,
      (error: AxiosError) => {
        // Gérer les erreurs d'authentification
        if (error.response?.status === 401) {
          this.clearToken()
          // Rediriger vers la page de connexion si nécessaire
          if (typeof window !== 'undefined') {
            const event = new CustomEvent('auth:logout')
            window.dispatchEvent(event)
          }
        }

        // Gérer les erreurs de réseau
        if (!error.response) {
          console.error('Erreur réseau:', error.message)
        }

        return Promise.reject(error)
      }
    )

    // Récupérer le token depuis le localStorage
    this.initializeToken()
  }

  // ============================================================================
  // GESTION DU TOKEN
  // ============================================================================

  private initializeToken(): void {
    if (typeof window !== 'undefined') {
      const savedToken = localStorage.getItem('libekoo_token')
      if (savedToken) {
        this.token = savedToken
      }
    }
  }

  setToken(token: string): void {
    this.token = token
    if (typeof window !== 'undefined') {
      localStorage.setItem('libekoo_token', token)
    }
  }

  clearToken(): void {
    this.token = null
    if (typeof window !== 'undefined') {
      localStorage.removeItem('libekoo_token')
    }
  }

  getToken(): string | null {
    return this.token
  }

  // ============================================================================
  // MÉTHODES UTILITAIRES
  // ============================================================================

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    data?: any,
    config?: any
  ): Promise<T> {
    try {
      const response = await this.api.request({
        method,
        url,
        data,
        ...config,
      })
      return response.data
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const apiError = error.response?.data || { 
          error: 'Erreur réseau', 
          code: 'NETWORK_ERROR' 
        }
        throw apiError
      }
      throw { error: 'Erreur inconnue', code: 'UNKNOWN_ERROR' }
    }
  }

  private get<T>(url: string, config?: any): Promise<T> {
    return this.request<T>('GET', url, undefined, config)
  }

  private post<T>(url: string, data?: any, config?: any): Promise<T> {
    return this.request<T>('POST', url, data, config)
  }

  private put<T>(url: string, data?: any, config?: any): Promise<T> {
    return this.request<T>('PUT', url, data, config)
  }

  private delete<T>(url: string, config?: any): Promise<T> {
    return this.request<T>('DELETE', url, undefined, config)
  }

  // ============================================================================
  // AUTHENTIFICATION
  // ============================================================================

  async createAnonymousSession(data: {
    gender?: string
    preferences?: Record<string, any>
  }): Promise<AuthResponse> {
    const response = await this.post<AuthResponse>('/auth/anonymous', data)
    if (response.success && response.token) {
      this.setToken(response.token)
    }
    return response
  }

  async register(data: {
    username: string
    email: string
    password: string
    gender: string
    ageRange?: string
    bio?: string
    preferences?: Record<string, any>
  }): Promise<AuthResponse> {
    const response = await this.post<AuthResponse>('/auth/register', data)
    if (response.success && response.token) {
      this.setToken(response.token)
    }
    return response
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await this.post<AuthResponse>('/auth/login', {
      email,
      password,
    })
    if (response.success && response.token) {
      this.setToken(response.token)
    }
    return response
  }

  async logout(): Promise<ApiResponse> {
    const response = await this.post<ApiResponse>('/auth/logout')
    this.clearToken()
    return response
  }

  async refreshToken(): Promise<AuthResponse> {
    const response = await this.post<AuthResponse>('/auth/refresh')
    if (response.success && response.token) {
      this.setToken(response.token)
    }
    return response
  }

  async getMe(): Promise<ApiResponse<User>> {
    return this.get<ApiResponse<User>>('/auth/me')
  }

  // ============================================================================
  // CHAT
  // ============================================================================

  async sendMessage(data: {
    sessionId: string
    content: string
    messageType?: string
    metadata?: Record<string, any>
  }): Promise<ApiResponse<ChatMessage>> {
    return this.post<ApiResponse<ChatMessage>>('/chat/send-message', data)
  }

  async getSessionMessages(
    sessionId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ApiResponse<ChatMessage[]>> {
    const params = new URLSearchParams()
    if (options.limit) params.append('limit', options.limit.toString())
    if (options.offset) params.append('offset', options.offset.toString())
    
    return this.get<ApiResponse<ChatMessage[]>>(
      `/chat/session/${sessionId}/messages?${params.toString()}`
    )
  }

  async getChatSessions(options: {
    status?: string
    type?: string
    limit?: number
    offset?: number
  } = {}): Promise<PaginatedResponse<ChatSession>> {
    const params = new URLSearchParams()
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value.toString())
      }
    })
    
    return this.get<PaginatedResponse<ChatSession>>(
      `/chat/sessions?${params.toString()}`
    )
  }

  async endChatSession(
    sessionId: string,
    data: { rating?: number; reason?: string } = {}
  ): Promise<ApiResponse> {
    return this.post<ApiResponse>(`/chat/session/${sessionId}/end`, data)
  }

  async reportContent(data: {
    sessionId: string
    targetType: string
    targetId?: string
    reportType: string
    description?: string
  }): Promise<ApiResponse> {
    return this.post<ApiResponse>(`/chat/session/${data.sessionId}/report`, data)
  }

  async getBlockedWords(): Promise<ApiResponse<string[]>> {
    return this.get<ApiResponse<string[]>>('/chat/blocked-words')
  }

  // ============================================================================
  // MATCHING
  // ============================================================================

  async findPartner(data: MatchingRequest): Promise<ApiResponse<MatchingResult>> {
    return this.post<ApiResponse<MatchingResult>>('/matching/find-partner', data)
  }

  async cancelSearch(searchId?: string): Promise<ApiResponse> {
    return this.post<ApiResponse>('/matching/cancel-search', { searchId })
  }

  async getSearchStatus(searchId: string): Promise<ApiResponse<MatchingResult>> {
    return this.get<ApiResponse<MatchingResult>>(`/matching/status/${searchId}`)
  }

  async getQueueStats(): Promise<ApiResponse<QueueStats>> {
    return this.get<ApiResponse<QueueStats>>('/matching/queue-stats')
  }

  async updateMatchingPreferences(preferences: {
    genderPreference?: string
    ageRangePreference?: string
    maxDistance?: number
  }): Promise<ApiResponse> {
    return this.post<ApiResponse>('/matching/preferences', preferences)
  }

  async reportUser(data: {
    reportedUserId: string
    reportType: string
    description?: string
    sessionId?: string
  }): Promise<ApiResponse> {
    return this.post<ApiResponse>('/matching/report-user', data)
  }

  async getNearbyUsers(radius = 50): Promise<ApiResponse<User[]>> {
    return this.get<ApiResponse<User[]>>(`/matching/nearby-users?radius=${radius}`)
  }

  // ============================================================================
  // VIDÉO
  // ============================================================================

  async createVideoRoom(data: {
    roomType?: string
    maxParticipants?: number
    settings?: Record<string, any>
  }): Promise<ApiResponse<VideoSession>> {
    return this.post<ApiResponse<VideoSession>>('/video/create-room', data)
  }

  async getVideoRoom(roomId: string): Promise<ApiResponse<VideoSession>> {
    return this.get<ApiResponse<VideoSession>>(`/video/room/${roomId}`)
  }

  async joinVideoRoom(roomId: string): Promise<ApiResponse> {
    return this.post<ApiResponse>(`/video/room/${roomId}/join`)
  }

  async leaveVideoRoom(roomId: string, rating?: number): Promise<ApiResponse> {
    return this.post<ApiResponse>(`/video/room/${roomId}/leave`, { rating })
  }

  async getVideoSessions(options: {
    limit?: number
    offset?: number
  } = {}): Promise<PaginatedResponse<VideoSession>> {
    const params = new URLSearchParams()
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value.toString())
      }
    })
    
    return this.get<PaginatedResponse<VideoSession>>(
      `/video/sessions?${params.toString()}`
    )
  }

  async reportVideoQuality(roomId: string, data: {
    qualityIssues: string[]
    connectionStats?: Record<string, any>
  }): Promise<ApiResponse> {
    return this.post<ApiResponse>(`/video/room/${roomId}/report-quality`, data)
  }

  async getWebRTCConfig(): Promise<ApiResponse<{
    iceServers: RTCIceServer[]
    maxParticipants: number
    sessionTimeout: number
    mediaConstraints: MediaStreamConstraints
  }>> {
    return this.get<ApiResponse<any>>('/video/webrtc-config')
  }

  async deleteVideoRoom(roomId: string): Promise<ApiResponse> {
    return this.delete<ApiResponse>(`/video/room/${roomId}`)
  }

  // ============================================================================
  // ANALYTICS
  // ============================================================================

  async getPublicStats(): Promise<ApiResponse<PublicStats>> {
    return this.get<ApiResponse<PublicStats>>('/analytics/public-stats')
  }

  async getCountriesStats(): Promise<ApiResponse<any>> {
    return this.get<ApiResponse<any>>('/analytics/countries')
  }

  async getMyStats(): Promise<ApiResponse<PersonalStats>> {
    return this.get<ApiResponse<PersonalStats>>('/analytics/my-stats')
  }

  async getMyActivity(options: {
    period?: string
    type?: string
  } = {}): Promise<ApiResponse<{
    activity: ActivityData[]
    period: string
    type: string
    summary: Record<string, number>
  }>> {
    const params = new URLSearchParams()
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value)
      }
    })
    
    return this.get<ApiResponse<any>>(
      `/analytics/my-activity?${params.toString()}`
    )
  }

  async getLiveStats(): Promise<ApiResponse<any>> {
    return this.get<ApiResponse<any>>('/analytics/live-stats')
  }

  async getQueueStatus(): Promise<ApiResponse<any>> {
    return this.get<ApiResponse<any>>('/analytics/queue-status')
  }

  async getTrends(options: {
    period?: string
    startDate?: string
    endDate?: string
    limit?: number
  } = {}): Promise<ApiResponse<any>> {
    const params = new URLSearchParams()
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value.toString())
      }
    })
    
    return this.get<ApiResponse<any>>(`/analytics/trends?${params.toString()}`)
  }

  async getPeakHours(): Promise<ApiResponse<any>> {
    return this.get<ApiResponse<any>>('/analytics/peak-hours')
  }

  async exportData(options: {
    format?: string
    type?: string
  } = {}): Promise<any> {
    const params = new URLSearchParams()
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value)
      }
    })
    
    return this.api.get(`/analytics/export?${params.toString()}`, {
      responseType: options.format === 'csv' ? 'blob' : 'json'
    })
  }

  // ============================================================================
  // ADMINISTRATION (pour les admins)
  // ============================================================================

  async getAdminDashboard(): Promise<ApiResponse<any>> {
    return this.get<ApiResponse<any>>('/admin/dashboard')
  }

  async searchUsers(options: {
    search?: string
    status?: string
    type?: string
    limit?: number
    offset?: number
  } = {}): Promise<PaginatedResponse<User>> {
    const params = new URLSearchParams()
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value.toString())
      }
    })
    
    return this.get<PaginatedResponse<User>>(`/admin/users?${params.toString()}`)
  }

  async getUserDetails(userId: string): Promise<ApiResponse<User>> {
    return this.get<ApiResponse<User>>(`/admin/users/${userId}`)
  }

  async banUser(userId: string, data: {
    reason: string
    duration?: number
    banType?: string
  }): Promise<ApiResponse> {
    return this.post<ApiResponse>(`/admin/users/${userId}/ban`, data)
  }

  async unbanUser(userId: string): Promise<ApiResponse> {
    return this.post<ApiResponse>(`/admin/users/${userId}/unban`)
  }

  async getReports(options: {
    status?: string
    priority?: string
    type?: string
    limit?: number
    offset?: number
  } = {}): Promise<PaginatedResponse<ModerationReport>> {
    const params = new URLSearchParams()
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value.toString())
      }
    })
    
    return this.get<PaginatedResponse<ModerationReport>>(`/admin/reports?${params.toString()}`)
  }

  async processReport(reportId: string, data: {
    status: string
    adminNotes?: string
    actionTaken?: string
  }): Promise<ApiResponse> {
    return this.put<ApiResponse>(`/admin/reports/${reportId}`, data)
  }

  async getFlaggedMessages(options: {
    minToxicity?: number
    limit?: number
  } = {}): Promise<ApiResponse<any[]>> {
    const params = new URLSearchParams()
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value.toString())
      }
    })
    
    return this.get<ApiResponse<any[]>>(`/admin/messages/flagged?${params.toString()}`)
  }

  async deleteMessage(messageId: string, reason: string): Promise<ApiResponse> {
    return this.post<ApiResponse>(`/admin/messages/${messageId}/delete`, { reason })
  }

  async getBannedIPs(): Promise<ApiResponse<any[]>> {
    return this.get<ApiResponse<any[]>>('/admin/banned-ips')
  }

  async unbanIP(ipId: string): Promise<ApiResponse> {
    return this.post<ApiResponse>(`/admin/banned-ips/${ipId}/unban`)
  }

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  async healthCheck(): Promise<ApiResponse<any>> {
    return this.get<ApiResponse<any>>('/health')
  }
}

// ============================================================================
// INSTANCE SINGLETON
// ============================================================================

const apiService = new ApiService()

export default apiService
export { ApiService }
