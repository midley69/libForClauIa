export interface User {
  id: string;
  username?: string;
  isAnonymous: boolean;
  location?: string;
  avatar?: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: Date;
  isOwn: boolean;
}

export interface ChatRoom {
  id: string;
  type: 'random' | 'group' | 'local';
  name?: string;
  participants: User[];
  messages: ChatMessage[];
}

export interface VideoCall {
  id: string;
  participants: User[];
  isActive: boolean;
}

export type AppPage = 'home' | 'chat' | 'video' | 'groups' | 'settings';

export interface AppState {
  currentPage: AppPage;
  user: User | null;
  onlineUsers: number;
  currentChat: ChatRoom | null;
  currentCall: VideoCall | null;
}