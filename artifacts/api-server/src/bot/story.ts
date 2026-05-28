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

export function buildStoryText(session: StorySession, username: string): string {
  const lines: string[] = [];
  lines.push("=".repeat(50));
  lines.push(`FANFIC INTERATIVA — ${username}`);
  lines.push(`Data: ${new Date().toLocaleString("pt-BR")}`);
  lines.push("=".repeat(50));
  lines.push("");

  let chapterNum = 1;

  for (const msg of session.messages) {
    if (msg.role === "system") continue;

    if (msg.role === "assistant") {
      lines.push(`--- Capítulo ${chapterNum} ---`);
      lines.push("");
      lines.push(stripChoices(msg.content));
      lines.push("");
      chapterNum++;
    } else if (msg.role === "user" && !msg.content.startsWith("Inicie")) {
      const choiceMatch = msg.content.match(/opção \d+: (.+?)\./);
      if (choiceMatch) {
        lines.push(`> Escolha: ${choiceMatch[1]}`);
        lines.push("");
      }
    }
  }

  lines.push("=".repeat(50));
  lines.push("Fim da história.");
  lines.push("=".repeat(50));

  return lines.join("\n");
}
