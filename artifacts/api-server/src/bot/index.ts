import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  EmbedBuilder,
  Events,
  type ButtonInteraction,
  type Message,
} from "discord.js";
import { logger } from "../lib/logger";
import { generateStory, buildSystemPrompt } from "./ai";
import {
  createSession,
  createPendingSetup,
  getPendingSetup,
  deletePendingSetup,
  getSession,
  deleteSession,
  parseChoices,
  stripChoices,
  buildStoryText,
  type Character,
} from "./story";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// ─── Chapter counter ────────────────────────────────────────────────────────

const chapterCounter = new Map<string, number>();

function getNextChapter(userId: string, channelId: string): number {
  const key = `${channelId}:${userId}`;
  const next = (chapterCounter.get(key) ?? 0) + 1;
  chapterCounter.set(key, next);
  return next;
}

function resetChapter(userId: string, channelId: string) {
  chapterCounter.delete(`${channelId}:${userId}`);
}

// ─── Character data ──────────────────────────────────────────────────────────

const CLASSES = [
  { id: "guerreiro", label: "⚔️ Guerreiro" },
  { id: "mago", label: "🧙 Mago" },
  { id: "ladino", label: "🗡️ Ladino" },
  { id: "arqueiro", label: "🏹 Arqueiro" },
  { id: "clerigo", label: "✨ Clérigo" },
];

const TRAITS = [
  { id: "corajoso", label: "💪 Corajoso" },
  { id: "astuto", label: "🦊 Astuto" },
  { id: "sabio", label: "📚 Sábio" },
  { id: "impulsivo", label: "🌪️ Impulsivo" },
  { id: "misterioso", label: "🌑 Misterioso" },
];

// ─── Button builders ─────────────────────────────────────────────────────────

function buildClassButtons(): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>();
  const row2 = new ActionRowBuilder<ButtonBuilder>();

  CLASSES.slice(0, 3).forEach((c) =>
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`class_${c.id}`)
        .setLabel(c.label)
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  CLASSES.slice(3).forEach((c) =>
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`class_${c.id}`)
        .setLabel(c.label)
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return [row1, row2];
}

function buildTraitButtons(): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>();
  const row2 = new ActionRowBuilder<ButtonBuilder>();

  TRAITS.slice(0, 3).forEach((t) =>
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`trait_${t.id}`)
        .setLabel(t.label)
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  TRAITS.slice(3).forEach((t) =>
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`trait_${t.id}`)
        .setLabel(t.label)
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return [row1, row2];
}

function buildChoiceButtons(choices: string[]): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  const emojis = ["1️⃣", "2️⃣", "3️⃣"];
  choices.forEach((choice, i) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`choice_${i}`)
        .setLabel(`${emojis[i]} ${choice.slice(0, 74)}`)
        .setStyle(ButtonStyle.Primary),
    );
  });
  return row;
}

function buildEndButton(): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId("end_story")
      .setLabel("🔚 Encerrar história")
      .setStyle(ButtonStyle.Danger),
  );
  return row;
}

// ─── Embed builders ──────────────────────────────────────────────────────────

function buildClassPickerEmbed(username: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎭 Criação de Personagem")
    .setDescription(`Olá, **${username}**! Antes de começar, escolha a **classe** do seu personagem:`)
    .addFields(
      { name: "⚔️ Guerreiro", value: "Força e combate corpo a corpo", inline: true },
      { name: "🧙 Mago", value: "Magia e feitiços poderosos", inline: true },
      { name: "🗡️ Ladino", value: "Furtividade e golpes precisos", inline: true },
      { name: "🏹 Arqueiro", value: "Precisão e ataques à distância", inline: true },
      { name: "✨ Clérigo", value: "Cura e poder divino", inline: true },
    );
}

function buildTraitPickerEmbed(classeLabel: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎭 Criação de Personagem")
    .setDescription(`Ótimo! Você será um **${classeLabel}**.\n\nAgora escolha o **traço de personalidade** do seu personagem:`)
    .addFields(
      { name: "💪 Corajoso", value: "Age sem hesitar", inline: true },
      { name: "🦊 Astuto", value: "Sempre tem um plano", inline: true },
      { name: "📚 Sábio", value: "Pensa antes de agir", inline: true },
      { name: "🌪️ Impulsivo", value: "Corre riscos sem pensar", inline: true },
      { name: "🌑 Misterioso", value: "Guarda segredos sombrios", inline: true },
    );
}

function buildCharacterConfirmEmbed(character: Character, theme: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("✅ Personagem criado!")
    .addFields(
      { name: "Nome", value: character.name, inline: true },
      { name: "Classe", value: character.classe, inline: true },
      { name: "Traço", value: character.trait, inline: true },
      { name: "Tema", value: theme || "Fantasia/Aventura", inline: false },
    )
    .setFooter({ text: "Gerando sua história..." });
}

function buildStoryEmbed(narrative: string, chapter: number, character: Character, hasChoices: boolean): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📖 Capítulo ${chapter}`)
    .setDescription(narrative.slice(0, 4096))
    .setFooter({
      text: hasChoices
        ? `${character.classe} ${character.trait} | Escolha como a história continua:`
        : `${character.classe} ${character.trait} | Fim deste trecho.`,
    });
}

// ─── Story chunk sender ───────────────────────────────────────────────────────

async function sendStoryChunk(
  target: Message | ButtonInteraction,
  storyText: string,
  choices: string[],
  isReply: boolean,
  userId: string,
  channelId: string,
  character: Character,
) {
  const narrative = stripChoices(storyText);
  if (!narrative) throw new Error("Empty story response from AI");

  const chapter = getNextChapter(userId, channelId);
  const embed = buildStoryEmbed(narrative, chapter, character, choices.length > 0);
  const components = choices.length > 0
    ? [buildChoiceButtons(choices), buildEndButton()]
    : [buildEndButton()];

  const payload = { embeds: [embed], components };

  if (isReply) {
    return await (target as Message).reply(payload);
  } else {
    await (target as ButtonInteraction).deferUpdate();
    return await (target as ButtonInteraction).followUp(payload);
  }
}

// ─── Shared: begin story after character is ready ─────────────────────────────

async function beginStory(
  target: Message | ButtonInteraction,
  userId: string,
  channelId: string,
  character: Character,
  theme: string,
  isReply: boolean,
) {
  const systemPrompt = buildSystemPrompt(character);
  const session = createSession(userId, channelId, character, theme, systemPrompt);

  const prompt = theme
    ? `Inicie uma fanfic com o tema: ${theme}. O protagonista é ${character.name}, um(a) ${character.classe} ${character.trait}.`
    : `Inicie uma fanfic de fantasia/aventura empolgante. O protagonista é ${character.name}, um(a) ${character.classe} ${character.trait}.`;

  session.messages.push({ role: "user", content: prompt });

  const channel = "channel" in target ? (target as ButtonInteraction).channel : (target as Message).channel;
  if (channel?.isSendable()) await channel.sendTyping();

  try {
    const responseText = await generateStory(session.messages);
    session.messages.push({ role: "assistant", content: responseText });
    const choices = parseChoices(responseText);
    session.choices = choices;
    await sendStoryChunk(target, responseText, choices, isReply, userId, channelId, character);
  } catch (err) {
    logger.error({ err }, "Error generating story start");
    deleteSession(userId, channelId);
    resetChapter(userId, channelId);
    try {
      const errMsg = "❌ Erro ao gerar a história. Tente `!fanfic` novamente em alguns segundos.";
      if (isReply) {
        await (target as Message).reply(errMsg);
      } else {
        await (target as ButtonInteraction).followUp(errMsg);
      }
    } catch (replyErr) {
      logger.error({ replyErr }, "Failed to send error reply");
    }
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const lower = content.toLowerCase();

  if (lower === "!ajuda game") {
    await message.reply(
      [
        "📖 **Comandos do Bot de Fanfic**",
        "",
        "`!fanfic` — Inicia criação de personagem e começa uma história",
        "`!fanfic <tema>` — Inicia com um tema específico",
        "  _Ex: `!fanfic escola de magia`, `!fanfic nave espacial`_",
        "",
        "`!fanfic save` — Salva a história atual como arquivo `.txt`",
        "`!fanfic reset` — Cancela a história em andamento",
        "`!ajuda game` — Mostra esta mensagem",
        "",
        "**Durante a história:**",
        "• Escolha sua **classe** e **traço** antes de começar",
        "• Clique nos botões 1️⃣ 2️⃣ 3️⃣ para escolher o rumo da história",
        "• Clique em 🔚 **Encerrar história** para finalizar",
      ].join("\n"),
    );
    return;
  }

  if (!lower.startsWith("!fanfic")) return;

  const userId = message.author.id;
  const channelId = message.channelId;

  if (lower === "!fanfic reset") {
    deleteSession(userId, channelId);
    deletePendingSetup(userId, channelId);
    resetChapter(userId, channelId);
    await message.reply("🔄 Sessão resetada! Use `!fanfic` para começar uma nova história.");
    return;
  }

  if (lower === "!fanfic save") {
    const session = getSession(userId, channelId);
    if (!session) {
      await message.reply("❌ Você não tem nenhuma história em andamento. Use `!fanfic` para começar uma.");
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
    await message.reply({ content: "📖 Aqui está sua história até agora!", files: [attachment] });
    return;
  }

  if (getSession(userId, channelId) || getPendingSetup(userId, channelId)) {
    await message.reply(
      "⚠️ Você já tem uma história em andamento! Use os botões para continuar, `!fanfic save` para salvar, ou `!fanfic reset` para começar uma nova.",
    );
    return;
  }

  const theme = content.slice(7).trim();
  createPendingSetup(userId, channelId, message.author.username, theme);

  const embed = buildClassPickerEmbed(message.author.username);
  await message.reply({ embeds: [embed], components: buildClassButtons() });
});

// ─── Interaction handler ──────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const btn = interaction as ButtonInteraction;
  const userId = btn.user.id;
  const channelId = btn.channelId;

  // ── Class selection ──
  if (btn.customId.startsWith("class_")) {
    const pending = getPendingSetup(userId, channelId);
    if (!pending) {
      await btn.reply({ content: "❌ Sessão expirada. Use `!fanfic` para começar.", ephemeral: true });
      return;
    }

    const classeId = btn.customId.replace("class_", "");
    const classeObj = CLASSES.find((c) => c.id === classeId);
    if (!classeObj) return;

    pending.classe = classeObj.label;

    const embed = buildTraitPickerEmbed(classeObj.label);
    await btn.update({ embeds: [embed], components: buildTraitButtons() });
    return;
  }

  // ── Trait selection ──
  if (btn.customId.startsWith("trait_")) {
    const pending = getPendingSetup(userId, channelId);
    if (!pending || !pending.classe) {
      await btn.reply({ content: "❌ Sessão expirada. Use `!fanfic` para começar.", ephemeral: true });
      return;
    }

    const traitId = btn.customId.replace("trait_", "");
    const traitObj = TRAITS.find((t) => t.id === traitId);
    if (!traitObj) return;

    const character: Character = {
      name: pending.username,
      classe: pending.classe,
      trait: traitObj.label,
    };

    deletePendingSetup(userId, channelId);

    const confirmEmbed = buildCharacterConfirmEmbed(character, pending.theme);
    await btn.update({ embeds: [confirmEmbed], components: [] });

    await beginStory(btn, userId, channelId, character, pending.theme, false);
    return;
  }

  // ── End story ──
  if (btn.customId === "end_story") {
    deleteSession(userId, channelId);
    resetChapter(userId, channelId);
    const endEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("✅ Fim da história")
      .setDescription("*— A aventura chegou ao fim. Use `!fanfic` para começar uma nova! —*");
    await btn.update({ embeds: [endEmbed], components: [] });
    return;
  }

  // ── Story choice ──
  if (btn.customId.startsWith("choice_")) {
    const session = getSession(userId, channelId);
    if (!session) {
      await btn.reply({ content: "❌ Sessão expirada. Use `!fanfic` para começar uma nova história.", ephemeral: true });
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

    const prevEmbed = btn.message.embeds[0];
    const updatedEmbed = prevEmbed
      ? EmbedBuilder.from(prevEmbed).setFooter({ text: `✅ Escolha: ${chosenText}` })
      : new EmbedBuilder().setDescription(`✅ Escolha: ${chosenText}`);

    await btn.update({ embeds: [updatedEmbed], components: [] });

    if (btn.channel?.isSendable()) await btn.channel.sendTyping();

    try {
      const responseText = await generateStory(session.messages);
      session.messages.push({ role: "assistant", content: responseText });
      const choices = parseChoices(responseText);
      session.choices = choices;
      await sendStoryChunk(btn, responseText, choices, false, userId, channelId, session.character);
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

// ─── Bot startup ──────────────────────────────────────────────────────────────

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
