import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  type ButtonInteraction,
  type Message,
} from "discord.js";
import { logger } from "../lib/logger";
import { generateStory, SYSTEM_PROMPT } from "./ai";
import {
  createSession,
  getSession,
  deleteSession,
  parseChoices,
  stripChoices,
} from "./story";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

function buildChoiceButtons(choices: string[]): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  const emojis = ["1️⃣", "2️⃣", "3️⃣"];

  choices.forEach((choice, i) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`choice_${i}`)
        .setLabel(`${emojis[i]} ${choice.slice(0, 80)}`)
        .setStyle(ButtonStyle.Primary),
    );
  });

  return row;
}

function buildEndButtons(): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId("end_story")
      .setLabel("🔚 Encerrar história")
      .setStyle(ButtonStyle.Danger),
  );
  return row;
}

async function sendStoryChunk(
  target: Message | ButtonInteraction,
  storyText: string,
  choices: string[],
  isReply = false,
) {
  const narrative = stripChoices(storyText);
  const components =
    choices.length > 0
      ? [buildChoiceButtons(choices), buildEndButtons()]
      : [buildEndButtons()];

  const payload = {
    content: narrative.slice(0, 2000),
    components,
  };

  if (isReply && "reply" in target) {
    return await (target as Message).reply(payload);
  } else if ("update" in target) {
    await (target as ButtonInteraction).deferUpdate();
    return await (target as ButtonInteraction).followUp(payload);
  }
  return null;
}

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

  const content = message.content.trim();

  if (content.toLowerCase().startsWith("!fanfic")) {
    const theme = content.slice(7).trim();
    const userId = message.author.id;
    const channelId = message.channelId;

    const existing = getSession(userId, channelId);
    if (existing) {
      await message.reply(
        "⚠️ Você já tem uma história em andamento neste canal! Use os botões para continuar ou clique em **🔚 Encerrar história** para começar uma nova.",
      );
      return;
    }

    const session = createSession(userId, channelId, SYSTEM_PROMPT);

    const prompt = theme
      ? `Inicie uma fanfic com o tema: ${theme}. O protagonista sou eu (${message.author.username}).`
      : `Inicie uma fanfic de fantasia/aventura. O protagonista sou eu (${message.author.username}).`;

    session.messages.push({ role: "user", content: prompt });

    const typing = message.channel.isSendable()
      ? message.channel.sendTyping()
      : Promise.resolve();

    try {
      await typing;
      const responseText = await generateStory(session.messages);
      session.messages.push({ role: "assistant", content: responseText });
      const choices = parseChoices(responseText);
      session.choices = choices;

      await sendStoryChunk(message, responseText, choices, true);
    } catch (err) {
      logger.error({ err }, "Error generating story start");
      await message.reply(
        "❌ Erro ao gerar a história. Tente novamente em alguns segundos.",
      );
      deleteSession(userId, channelId);
    }
    return;
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const btn = interaction as ButtonInteraction;
  const userId = btn.user.id;
  const channelId = btn.channelId;

  if (btn.customId === "end_story") {
    deleteSession(userId, channelId);
    await btn.update({
      content: btn.message.content + "\n\n*— Fim da história. Use `!fanfic` para começar uma nova! —*",
      components: [],
    });
    return;
  }

  if (btn.customId.startsWith("choice_")) {
    const session = getSession(userId, channelId);
    if (!session) {
      await btn.reply({
        content: "❌ Sessão expirada. Use `!fanfic` para começar uma nova história.",
        ephemeral: true,
      });
      return;
    }

    const choiceIndex = parseInt(btn.customId.replace("choice_", ""), 10);
    const chosenText = session.choices[choiceIndex];

    if (!chosenText) {
      await btn.reply({ content: "❌ Opção inválida.", ephemeral: true });
      return;
    }

    session.messages.push({
      role: "user",
      content: `Escolho a opção ${choiceIndex + 1}: ${chosenText}. Continue a história.`,
    });

    await btn.update({
      content: btn.message.content + `\n\n> ✅ **Você escolheu:** ${chosenText}`,
      components: [],
    });

    if (btn.channel?.isSendable()) {
      await btn.channel.sendTyping();
    }

    try {
      const responseText = await generateStory(session.messages);
      session.messages.push({ role: "assistant", content: responseText });
      const choices = parseChoices(responseText);
      session.choices = choices;

      await sendStoryChunk(btn, responseText, choices, false);
    } catch (err) {
      logger.error({ err }, "Error generating story continuation");
      await btn.followUp(
        "❌ Erro ao continuar a história. Tente novamente.",
      );
    }
  }
});

client.once(Events.ClientReady, (c) => {
  logger.info({ tag: c.user.tag }, "Discord bot online");
});

export async function startBot() {
  const token = process.env["DISCORD_TOKEN"];
  if (!token) {
    logger.warn("DISCORD_TOKEN not set — Discord bot will not start");
    return;
  }
  await client.login(token);
}
