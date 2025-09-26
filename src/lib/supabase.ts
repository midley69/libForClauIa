import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types pour la base de données - mis à jour selon le schéma réel
export interface Database {
  public: {
    Tables: {
      online_users: {
        Row: {
          id: string
          user_id: string
          status: 'online' | 'chat' | 'video' | 'group'
          location?: string
          last_seen: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          status?: 'online' | 'chat' | 'video' | 'group'
          location?: string
          last_seen?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          status?: 'online' | 'chat' | 'video' | 'group'
          location?: string
          last_seen?: string
          created_at?: string
        }
      }
      groups: {
        Row: {
          id: string
          name: string
          description: string
          member_count: number
          is_active: boolean
          category: string
          location?: string
          last_activity: string
          created_at: string
          created_by: string
        }
        Insert: {
          id?: string
          name: string
          description: string
          member_count?: number
          is_active?: boolean
          category?: string
          location?: string
          last_activity?: string
          created_at?: string
          created_by: string
        }
        Update: {
          id?: string
          name?: string
          description?: string
          member_count?: number
          is_active?: boolean
          category?: string
          location?: string
          last_activity?: string
          created_at?: string
          created_by?: string
        }
      }
    }
  }
}