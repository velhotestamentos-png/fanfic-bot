import { logger } from "../lib/logger";
import type { Character } from "./story";

const POLLINATIONS_URL = "https://text.pollinations.ai/openai";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function generateStory(messages: Message[]): Promise<string> {
  const response = await fetch(POLLINATIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai",
      messages,
      max_tokens: 600,
      temperature: 0.9,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error({ status: response.status, text }, "Pollinations API error");
    throw new Error(`AI error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0]?.message?.content ?? "";
}

export function buildSystemPrompt(character: Character): string {
  return `Você é um narrador de fanfics interativas em português brasileiro.
Seu trabalho é criar histórias envolventes e empolgantes com o personagem do usuário como protagonista.

Personagem do jogador:
- Nome: ${character.name}
- Classe: ${character.classe}
- Traço de personalidade: ${character.trait}

Regras:
- Escreva em português brasileiro
- O protagonista é sempre ${character.name}, um(a) ${character.classe} ${character.trait}
- Use as habilidades e personalidade da classe e traço nas situações da história
- Cada trecho da história deve ter 3-5 parágrafos envolventes
- Ao final de CADA resposta, inclua EXATAMENTE 3 opções de escolha numeradas assim:
  [1] (texto curto da opção 1)
  [2] (texto curto da opção 2)
  [3] (texto curto da opção 3)
- As opções devem refletir o traço do personagem (${character.trait}) e sua classe (${character.classe})
- Mantenha consistência com as escolhas anteriores
- Deixe a história empolgante e com ganchos para o próximo trecho`;
}
