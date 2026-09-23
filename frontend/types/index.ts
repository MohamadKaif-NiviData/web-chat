export interface User {
  id: number;
  email: string;
  display_name: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  type: string;
  created_at: string;
}

export interface MessagePage {
  messages: Message[];
  next_cursor: number | null;
}

export interface ParticipantSummary {
  id: number;
  email: string;
  display_name: string;
  is_online: boolean;
}

export interface ConversationSummary {
  conversation_id: number;
  other_user: ParticipantSummary;
  last_message: Message | null;
}

export interface ConversationCreateResponse {
  conversation_id: number;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export type TypingEvent = {
  type: "typing";
  user_id: number;
};
