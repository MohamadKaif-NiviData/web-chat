export interface User {
  id: number;
  email: string;
  display_name: string;
}

export interface Attachment {
  id: number;
  download_url: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  type: string;
  created_at: string;
  read_by: number[];
  attachment?: Attachment | null;
  edited_at?: string | null;
  forwarded_from_user_id?: number | null;
  forwarded_from_display_name?: string | null;
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
  is_group: boolean;
  name: string;
  participants: ParticipantSummary[];
  last_message: Message | null;
  created_by_user_id?: number | null;
  pinned_message?: Message | null;
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

export type ReadEvent = {
  type: "read";
  message_ids: number[];
  user_id: number;
};

export type MessageEditedEvent = {
  type: "message_edited";
  message_id: number;
  content: string;
  edited_at: string;
};

export type MessageDeletedEvent = {
  type: "message_deleted";
  message_id: number;
};

export type MessageHiddenEvent = {
  type: "message_hidden";
  message_id: number;
};

export type RemovedFromConversationEvent = {
  type: "removed_from_conversation";
  conversation_id: number;
};

export type MessagePinnedEvent = {
  type: "message_pinned";
  conversation_id: number;
  message_id: number;
};

export type MessageUnpinnedEvent = {
  type: "message_unpinned";
  conversation_id: number;
};

export interface MessageSearchResult {
  message_id: number;
  conversation_id: number;
  conversation_name: string;
  is_group: boolean;
  sender_id: number;
  sender_display_name: string;
  content: string;
  created_at: string;
  edited_at?: string | null;
}

export interface MessageSearchPage {
  results: MessageSearchResult[];
  next_cursor: number | null;
}
