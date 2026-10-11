const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    EmbedBuilder 
} = require('discord.js');
const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const minecraftData = require('minecraft-data');
const { GoogleGenAI } = require('@google/genai');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

const TOKEN = process.env.TOKEN;
const ai = new GoogleGenAI(); 

const ALLOWED_USERS = [
    '1095004764368015451',
    '1497885828549054575',
    '1474063133902639267'
];

const pendingCodes = new Map();
const linkedAccounts = new Map();

let bot = null;
let viewerInstance = null; // Viewer referansını tutmak için
let movementInterval = null;
let reconnectTimeout = null;
let targetChannel = null;
let isIntentionalQuit = false;

client.once('ready', () => {
    console.log(`Discord botu aktif ve giriş yaptı: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!ALLOWED_USERS.includes(message.author.id)) return;

    if (message.channel.type === 1) { 
        if (!bot) return message.reply('⚠️ Bot şu anda oyunda değil! Önce !katil yazın.');
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Sen sadece bu oyuncunun kişisel asistanısın. Türkçe, samimi ve kısa bir asistan gibi yanıt ver: "${message.content}"`
            });
            message.reply(`🤖 Asistan: ${response.text}`);
        } catch (err) {
            message.reply('❌ Yapay zeka yanıt üretirken bir hata oluştu.');
        }
        return;
    }

    if (message.content === '!katil') {
        if (bot) return message.channel.send('⚠️ Bot zaten oyunda ve panel aktif!');
        isIntentionalQuit = false;
        targetChannel = message.channel;
        message.channel.send('⏳ Efendim, sunucuya bağlanıyorum...');
        connectMinecraft(message.channel);
    }

    if (message.content === '!cik') {
        if (!bot) return message.channel.send('⚠️ Bot zaten oyunda değil!');
        isIntentionalQuit = true;
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        cleanupBot();
        message.channel.send('🔌 Emredersiniz efendim, oyundan çıkış yapıldı.');
    }

    if (message.content === '!dogrulama-paneli') {
        const embed = new EmbedBuilder()
            .setTitle('🎮 Minecraft & Discord Hesap Eşleme')
            .setDescription('Minecraft hesabınızı Discord ile eşlemek için adımları takip edin:\n\n' +
                            '1. Oyunda bota fısıltı ile `/msg AternosBot hesap eşle` yazın.\n' +
                            '2. Botun size gönderdiği **6 haneli doğrulama kodunu** alın.\n' +
                            '3. Aşağıdaki **"Hesabı Doğrula"** butonuna basarak kodu forma yazın.')
            .setColor('#2b2d31');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_verify_account')
                .setLabel('🔑 Hesabı Doğrula')
                .setStyle(ButtonStyle.Success)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        if (interaction.customId === 'btn_verify_account') {
            const modal = new ModalBuilder()
                .setCustomId('modal_verify_code')
                .setTitle('Minecraft Hesap Eşleme');

            const codeInput = new TextInputBuilder()
                .setCustomId('input_code')
                .setLabel('6 Haneli Doğrulama Kodunuz:')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Örn: 482910')
                .setMinLength(6)
                .setMaxLength(6)
                .setRequired(true);

            const row = new ActionRowBuilder().addComponents(codeInput);
            modal.addComponents(row);

            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_verify_code') {
            const enteredCode = interaction.fields.getTextInputValue('input_code').trim();

            if (pendingCodes.has(enteredCode)) {
                const mcData = pendingCodes.get(enteredCode);
                const mcUsername = mcData.mcUsername;

                linkedAccounts.set(interaction.user.id, mcUsername);
                pendingCodes.delete(enteredCode);

                await interaction.reply({
                    content: `✅ Başarılı! **${mcUsername}** isimli Minecraft hesabınız **${interaction.user.tag}** ile başarıyla eşlendi!`,
                    ephemeral: true
                });

                if (bot) {
                    bot.chat(`/msg ${mcUsername} [Asistan] Discord hesabınız (${interaction.user.tag}) ile eşleme başarıyla tamamlandı!`);
                }
            } else {
                await interaction.reply({
                    content: '❌ Geçersiz veya süresi dolmuş doğrulama kodu! Lütfen oyundan tekrar `/msg AternosBot hesap eşle` yazarak yeni kod alın.',
                    ephemeral: true
                });
            }
        }
    }
});

function connectMinecraft(channel) {
    if (isIntentionalQuit) return;

    try {
        bot = mineflayer.createBot({
            host: 'akukasmp.aternos.me',
            port: 64952,
            username: 'AternosBot',
            version: '1.21.11',
            auth: 'offline'
        });

        bot.loadPlugin(pathfinder);

        bot.on('spawn', () => {
            channel.send('✅ Oyuna giriş yaptım efendim! `/msg AternosBot hesap eşle` veya talimat vererek yönetebilirsiniz.');
            console.log('Bot oyuna spawn oldu.');

            // Port çakışmasını önlemek için viewer sadece ilk açılışta veya kapalıysa başlatılır
            if (!viewerInstance) {
                try {
                    viewerInstance = mineflayerViewer(bot, { port: 3000, firstPerson: true });
                    console.log('Prismarine viewer aktif edildi.');
                } catch (e) {
                    console.log('Viewer başlatılamadı veya port zaten dolu:', e.message);
                }
            }

            let movingForward = true;
            if (movementInterval) clearInterval(movementInterval);
            movementInterval = setInterval(() => {
                if (!bot) return;
                if (movingForward) {
                    bot.setControlState('forward', true);
                    setTimeout(() => bot.setControlState('forward', false), 2000);
                } else {
                    bot.setControlState('back', true);
                    setTimeout(() => bot.setControlState('back', false), 2000);
                }
                movingForward = !movingForward;
            }, 30000);
        });

        bot.on('whisper', async (username, message) => {
            console.log(`[Fısıltı] ${username}: ${message}`);
            
            if (message.toLowerCase().trim().includes('hesap eşle') || message.toLowerCase().trim().includes('hesapesle')) {
                const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
                pendingCodes.set(verificationCode, {
                    mcUsername: username,
                    createdAt: Date.now()
                });

                bot.chat(`/msg ${username} [Eşleme] Doğrulama kodunuz: ${verificationCode}. Discord sunucusundaki doğrulama butonuna basarak kodu girin.`);
                return;
            }

            try {
                const prompt = `
Sen Minecraft'ta bir yardımcı botsun. Oyuncu (${username}) sana fısıltı gönderdi: "${message}"
İsteği analiz et. Görev maden kazmak (ör: elmas, demir, kömür), odun kesmek, eşya tarifi vermek, oyundan çıkmak veya sohbet yanıtı olabilir.

Aşağıdaki JSON formatında yanıt ver:
{
  "action": "mine" | "wood" | "quit" | "chat",
  "target": "kazılacak blok adı (örn: diamond_ore, iron_ore, coal_ore) veya null",
  "reply": "Oyuncuya oyun içinde verilecek Türkçe kısa yanıt"
}
`;

                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt
                });

                let textResp = response.text.trim().replace(/```json/g, '').replace(/```/g, '').trim();
                const data = JSON.parse(textResp);

                if (data.reply) {
                    bot.chat(`/msg ${username} ${data.reply}`);
                }

                if (data.action === 'mine' && data.target) {
                    mineOre(data.target);
                } else if (data.action === 'wood') {
                    cutSafeTree();
                } else if (data.action === 'quit') {
                    isIntentionalQuit = true;
                    cleanupBot();
                    if (targetChannel) targetChannel.send('🔌 Oyun içinden gelen komutla oyundan çıkış yapıldı.');
                }

            } catch (err) {
                console.error('AI Whisper Error:', err);
                bot.chat(`/msg ${username} Üzgünüm efendim, isteğinizi anlayamadım.`);
            }
        });

        bot.on('error', (err) => {
            console.error('Minecraft Bağlantı Hatası:', err);
            channel.send(`❌ Minecraft Bağlantı Hatası: ${err.code || err.message}`);
        });

        bot.on('end', (reason) => {
            console.log(`Bot sunucudan düştü. (Sebep: ${reason})`);
            channel.send(`🔌 Bağlantı koptu (Sebep: ${reason}). Yeniden bağlanıyorum...`);
            cleanupBot();

            if (!isIntentionalQuit) {
                reconnectTimeout = setTimeout(() => connectMinecraft(channel), 5000);
            }
        });

    } catch (error) {
        console.error(error);
        channel.send(`❌ Hata oluştu: ${error.message}`);
        cleanupBot();
    }
}

async function cutSafeTree() {
    const mcData = minecraftData(bot.version);
    const logBlock = bot.findBlock({
        matching: block => {
            return block.name.includes('_log') && 
                   !block.name.includes('stripped') && 
                   bot.findBlock({ matching: b => b.name.includes('leaves'), maxDistance: 4, point: block.position }) !== null;
        },
        maxDistance: 48
    });

    if (!logBlock) {
        bot.chat('Yakınlarda yapraklı güvenli bir ağaç bulamadım efendim.');
        return;
    }

    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);
    await bot.pathfinder.setGoal(new goals.GoalAtBlock(logBlock.position.x, logBlock.position.y, logBlock.position.z));
    
    try {
        await bot.dig(logBlock);
        bot.chat('Ağacı kestim efendim!');
    } catch (err) {
        console.log('Ağaç kesme hatası:', err);
    }
}

async function mineOre(oreName) {
    const mcData = minecraftData(bot.version);
    const targetBlock = bot.findBlock({
        matching: block => block.name.includes(oreName),
        maxDistance: 64
    });

    if (!targetBlock) {
        bot.chat(`Yakınlarda ${oreName} bulamadım efendim.`);
        return;
    }

    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);
    await bot.pathfinder.setGoal(new goals.GoalAtBlock(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z));

    try {
        await bot.dig(targetBlock);
        bot.chat(`${oreName} madenini kazdım efendim!`);
    } catch (err) {
        bot.chat('Maden kazılırken bir sorun oluştu.');
    }
}

function cleanupBot() {
    if (movementInterval) {
        clearInterval(movementInterval);
        movementInterval = null;
    }
    if (bot) {
        try {
            bot.quit();
        } catch (e) {}
        bot = null;
    }
}

client.login(TOKEN);
