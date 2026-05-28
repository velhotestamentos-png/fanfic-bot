export interface StorySession {
  userId: string;
  channelId: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  choices: string[];
  lastMessageId?: string;
}

const sessions = new Map<string, StorySession>();

export function getSessionKey(userId: string, channelId: string) {
  return `${channelId}:${userId}`;
}

export function createSession(
  userId: string,
  channelId: string,
  systemPrompt: string,
): StorySession {
  const session: StorySession = {
    userId,
    channelId,
    messages: [{ role: "system", content: systemPrompt }],
    choices: [],
  };
  sessions.set(getSessionKey(userId, channelId), session);
  return session;
}

export function getSession(
  userId: string,
  channelId: string,
): StorySession | undefined {
  return sessions.get(getSessionKey(userId, channelId));
}

export function deleteSession(userId: string, channelId: string) {
  sessions.delete(getSessionKey(userId, channelId));
}

export function parseChoices(text: string): string[] {
  const choices: string[] = [];
  const regex = /\[(\d)\]\s*(.+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    choices.push(match[2]!.trim());
  }
  return choices.slice(0, 3);
}

export function stripChoices(text: string): string {
  return text.replace(/\[\d\]\s*.+/g, "").trim();
}
