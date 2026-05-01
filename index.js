await play.setToken({
  youtube: {
    cookie: process.env.YT_COOKIE || ""
  }
});
require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} = require("@discordjs/voice");
const play = require("play-dl");
const fs = require("fs");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 📁 CONFIG (prefix per server)
const CONFIG_FILE = "config.json";
let config = fs.existsSync(CONFIG_FILE)
  ? JSON.parse(fs.readFileSync(CONFIG_FILE))
  : {};

const saveConfig = () =>
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

// 🎶 QUEUE
const queues = new Map();

client.on("ready", () => {
  console.log(`🎵 Logged in as ${client.user.tag}`);
});

// ▶️ PLAY FUNCTION
async function playSong(guild, song) {
  const queue = queues.get(guild.id);

  if (!song) {
    queue.connection.destroy();
    queues.delete(guild.id);
    return;
  }

  const stream = await play.stream(song.url);
  const resource = createAudioResource(stream.stream, {
    inputType: stream.type,
    inlineVolume: true
  });

  resource.volume.setVolume(queue.volume / 100);

  queue.player.play(resource);

  queue.player.once(AudioPlayerStatus.Idle, () => {
    if (queue.loop) {
      playSong(guild, queue.songs[0]);
    } else {
      queue.songs.shift();
      playSong(guild, queue.songs[0]);
    }
  });
}

// 💬 COMMANDS
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const guildId = message.guild.id;

  if (!config[guildId]) config[guildId] = { prefix: "!" };

  const PREFIX = config[guildId].prefix;

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).split(/ +/);
  const cmd = args.shift().toLowerCase();

  const member = await message.guild.members.fetch(message.author.id);
  const voice = member.voice.channel;

  // 📡 PING
  if (cmd === "ping") {
    return message.reply(`📡 ${client.ws.ping}ms`);
  }

  // ⚙️ SET PREFIX
  if (cmd === "setprefix") {
    if (!message.member.permissions.has("Administrator"))
      return message.reply("❌ Admin only");

    config[guildId].prefix = args[0];
    saveConfig();

    return message.reply(`✅ Prefix set to ${args[0]}`);
  }

  // ▶️ PLAY
  if (cmd === "play") {
    if (!voice) return message.reply("❌ Join VC");

    const query = args.join(" ");
    if (!query) return message.reply("❌ Give song");

    let song;

    if (play.sp_validate(query) === "track") {
      const sp = await play.spotify(query);
      const yt = await play.search(`${sp.name} ${sp.artists[0].name}`, { limit: 1 });
      song = { title: yt[0].title, url: yt[0].url };
    } else {
      const yt = await play.search(query, { limit: 1 });
      song = { title: yt[0].title, url: yt[0].url };
    }

    let queue = queues.get(guildId);

    if (!queue) {
      const player = createAudioPlayer();

      const connection = joinVoiceChannel({
        channelId: voice.id,
        guildId: guildId,
        adapterCreator: message.guild.voiceAdapterCreator
      });

      queue = {
        connection,
        player,
        songs: [],
        volume: 100,
        loop: false
      };

      queues.set(guildId, queue);
      connection.subscribe(player);
    }

    queue.songs.push(song);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pause").setLabel("⏯️").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("skip").setLabel("⏭️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("stop").setLabel("⏹️").setStyle(ButtonStyle.Danger)
    );

    message.reply({
      content: `🎵 Added: ${song.title}`,
      components: [row]
    });

    if (queue.songs.length === 1) {
      playSong(message.guild, queue.songs[0]);
    }
  }

  // ⏭️ SKIP
  if (cmd === "skip") {
    const queue = queues.get(guildId);
    if (!queue) return;
    queue.player.stop();
    message.reply("⏭️ Skipped");
  }

  // ⏭️ SKIP TO
  if (cmd === "skipto") {
    const queue = queues.get(guildId);
    if (!queue) return;

    const num = Number(args[0]);
    if (!num || num < 1 || num > queue.songs.length)
      return message.reply("❌ Invalid number");

    queue.songs.splice(0, num - 1);
    queue.player.stop();

    message.reply(`⏭️ Skipped to ${num}`);
  }

  // ⏹️ STOP
  if (cmd === "stop") {
    const queue = queues.get(guildId);
    if (!queue) return;

    queue.songs = [];
    queue.player.stop();
    message.reply("⏹️ Stopped");
  }

  // ⏸️ PAUSE
  if (cmd === "pause") {
    const queue = queues.get(guildId);
    if (!queue) return;

    queue.player.pause();
    message.reply("⏸️ Paused");
  }

  // ▶️ RESUME
  if (cmd === "resume") {
    const queue = queues.get(guildId);
    if (!queue) return;

    queue.player.unpause();
    message.reply("▶️ Resumed");
  }

  // 🔊 VOLUME
  if (cmd === "volume") {
    const queue = queues.get(guildId);
    if (!queue) return message.reply("❌ Nothing playing");

    const vol = Number(args[0]);
    if (!vol || vol < 1 || vol > 200)
      return message.reply("❌ 1–200");

    queue.volume = vol;
    message.reply(`🔊 Volume: ${vol}`);
  }

  // 🔁 LOOP
  if (cmd === "loop") {
    const queue = queues.get(guildId);
    if (!queue) return;

    queue.loop = !queue.loop;
    message.reply(`🔁 Loop: ${queue.loop ? "ON" : "OFF"}`);
  }

  // 📜 QUEUE
  if (cmd === "queue") {
    const queue = queues.get(guildId);
    if (!queue || !queue.songs.length)
      return message.reply("❌ Empty");

    const list = queue.songs.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
    message.reply(`📜 Queue:\n${list}`);
  }

  // 🧹 CLEAR
  if (cmd === "clear") {
    const queue = queues.get(guildId);
    if (!queue) return;

    queue.songs = [];
    message.reply("🧹 Cleared");
  }
});

// 🎛️ BUTTONS
client.on("interactionCreate", async (i) => {
  if (!i.isButton()) return;

  const queue = queues.get(i.guild.id);
  if (!queue)
    return i.reply({ content: "❌ Nothing playing", ephemeral: true });

  if (i.customId === "pause") {
    queue.player.pause();
    return i.reply({ content: "⏸️ Paused", ephemeral: true });
  }

  if (i.customId === "skip") {
    queue.player.stop();
    return i.reply({ content: "⏭️ Skipped", ephemeral: true });
  }

  if (i.customId === "stop") {
    queue.songs = [];
    queue.player.stop();
    return i.reply({ content: "⏹️ Stopped", ephemeral: true });
  }
});

client.login(process.env.TOKEN);
