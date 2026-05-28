import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
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
  buildStoryText,
} from "./story";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

function buildChoiceButtons(
  choices: string[],
): ActionRowBuilder<ButtonBuilder> {
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

  if (!narrative) {
    throw new Error("Empty story response from AI");
  }

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
  } else if ("followUp" in target) {
    await (target as ButtonInteraction).deferUpdate();
    return await (target as ButtonInteraction).followUp(payload);
  }
  return null;
}

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const lower = content.toLowerCase();

  if (lower === "!ajuda") {
    await message.reply(
      [
        "📖 **Comandos do Bot de Fanfic**",
        "",
        "`!fanfic` — Inicia uma nova história de aventura/fantasia",
        "`!fanfic <tema>` — Inicia uma história com tema personalizado",
        "  _Ex: `!fanfic escola de magia`, `!fanfic nave espacial`_",
        "",
        "`!fanfic save` — Salva a história atual como arquivo `.txt`",
        "`!fanfic reset` — Cancela a história em andamento",
        "`!ajuda` — Mostra esta mensagem",
        "",
        "**Durante a história:**",
        "• Clique nos botões 1️⃣ 2️⃣ 3️⃣ para escolher o rumo da história",
        "• Clique em 🔚 **Encerrar história** para finalizar",
      ].join("\n"),
    );
    return;
  }

  if (!lower.startsWith("!fanfic")) return;

  const userId = message.author.id;
  const channelId = message.channelId;

  // !fanfic reset — limpa sessão travada
  if (lower === "!fanfic reset") {
    deleteSession(userId, channelId);
    await message.reply(
      "🔄 Sessão resetada! Use `!fanfic` para começar uma nova história.",
    );
    return;
  }

  // !fanfic save — exporta a história como .txt
  if (lower === "!fanfic save") {
    const session = getSession(userId, channelId);
    if (!session) {
      await message.reply(
        "❌ Você não tem nenhuma história em andamento. Use `!fanfic` para começar uma.",
      );
      return;
    }
    const hasContent = session.messages.some((m) => m.role === "assistant");
    if (!hasContent) {
      await message.reply("❌ A história ainda não tem conteúdo para salvar.");
      return;
    }
    const storyText = buildStoryText(session, message.author.username);
    const buffer = Buffer.from(storyText, "utf-8");
    const filename = `fanfic_${message.author.username}_${Date.now()}.txt`;
    const attachment = new AttachmentBuilder(buffer, { name: filename });
    await message.reply({
      content: "📖 Aqui está sua história até agora!",
      files: [attachment],
    });
    return;
  }

  // !fanfic [tema] — inicia nova história
  const existing = getSession(userId, channelId);
  if (existing) {
    await message.reply(
      "⚠️ Você já tem uma história em andamento! Use os botões para continuar, `!fanfic save` para salvar, ou `!fanfic reset` para começar uma nova.",
    );
    return;
  }

  const theme = content.slice(7).trim();
  const session = createSession(userId, channelId, SYSTEM_PROMPT);

  const prompt = theme
    ? `Inicie uma fanfic com o tema: ${theme}. O protagonista sou eu (${message.author.username}).`
    : `Inicie uma fanfic de fantasia/aventura empolgante. O protagonista sou eu (${message.author.username}).`;

  session.messages.push({ role: "user", content: prompt });

  try {
    if (message.channel.isSendable()) {
      await message.channel.sendTyping();
    }
    const responseText = await generateStory(session.messages);
    session.messages.push({ role: "assistant", content: responseText });
    const choices = parseChoices(responseText);
    session.choices = choices;
    await sendStoryChunk(message, responseText, choices, true);
  } catch (err) {
    logger.error({ err }, "Error generating story start");
    deleteSession(userId, channelId); // limpa sessão ANTES de tentar responder
    try {
      await message.reply(
        "❌ Erro ao gerar a história. Tente `!fanfic` novamente em alguns segundos.",
      );
    } catch (replyErr) {
      logger.error({ replyErr }, "Failed to send error reply");
    }
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
      content:
        btn.message.content +
        "\n\n*— Fim da história. Use `!fanfic` para começar uma nova! —*",
      components: [],
    });
    return;
  }

  if (btn.customId.startsWith("choice_")) {
    const session = getSession(userId, channelId);
    if (!session) {
      await btn.reply({
        content:
          "❌ Sessão expirada. Use `!fanfic` para começar uma nova história.",
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
      content:
        btn.message.content + `\n\n> ✅ **Você escolheu:** ${chosenText}`,
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
      try {
        await btn.followUp("❌ Erro ao continuar a história. Tente novamente.");
      } catch (followErr) {
        logger.error({ followErr }, "Failed to send followUp error");
      }
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
