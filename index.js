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
let movementInterval = null;
let reconnectTimeout = null;
let targetChannel = null;
let isIntentionalQuit = false;

client.once('clientReady', () => {
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
        if (bot) return message.channel.send('⚠️ Bot zaten oyunda!');
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
                    content: '❌ Geçersiz veya süresi dolmuş doğrulama kodu! Lütfen oyunda tekrar `/msg AternosBot hesap eşle` yazarak yeni kod alın.',
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
            channel.send('✅ Oyuna giriş yaptım efendim! Minecraft içinden `/msg AternosBot <mesaj>` yazarak beni yönetebilir ve sorular sorabilirsiniz.');
            console.log('Bot oyuna spawn oldu.');

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

        async function handleMessage(username, messageText) {
            if (username === bot.username) return;
            console.log(`[Minecraft Mesajı] ${username}: ${messageText}`);
            
            const lowerMsg = messageText.toLowerCase().trim();

            // Hesap Eşleme İsteği
            if (lowerMsg.includes('hesap eşle') || lowerMsg.includes('hesapesle') || lowerMsg.includes('esle')) {
                const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
                pendingCodes.set(verificationCode, {
                    mcUsername: username,
                    createdAt: Date.now()
                });

                bot.chat(`/msg ${username} [Eşleme] Kodunuz: ${verificationCode}. Discord'daki butona basarak bu kodu girin efendim.`);
                return;
            }

            try {
                const prompt = `
Sen Minecraft'ta samimi, yardımcı bir kişisel asistansın. Oyuncu (${username}) sana şu mesajı yazdı: "${messageText}"
Bu mesajı dikkatlice analiz et.

1. Eğer oyuncu eşya tarifi (crafting), oyun bilgisi, sorular soruyor ya da sadece sohbet ediyorsa "action" değerini "chat" yap ve "reply" kısmına sorunun kısa, anlaşılır, Türkçe cevabını yaz.
2. Eğer oyuncu maden kazmanı/toplamanı istiyorsa (kömür, elmas, demir vb.) "action" değerini "mine" yap, "target" değerine bloğun teknik adını yaz (örn: coal_ore, diamond_ore, iron_ore).
3. Eğer odun kesmeni istiyorsa "action" değerini "wood" yap.
4. Oyundan çıkmanı istiyorsa "action" değerini "quit" yap.

Sadece geçerli bir JSON objesi döndür (kod bloğu kullanma):
{
  "action": "mine" | "wood" | "quit" | "chat",
  "target": "kazılacak blok adı veya null",
  "reply": "Oyuncuya iletilecek Türkçe yanıt (soru sorulduysa sorunun cevabı)"
}
`;

                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt
                });

                let textResp = response.text.trim();
                textResp = textResp.replace(/```json/g, '').replace(/```/g, '').trim();
                const jsonStartIndex = textResp.indexOf('{');
                const jsonEndIndex = textResp.lastIndexOf('}');
                if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
                    textResp = textResp.substring(jsonStartIndex, jsonEndIndex + 1);
                }

                const data = JSON.parse(textResp);

                if (data.reply) {
                    bot.chat(`/msg ${username} ${data.reply}`);
                }

                if (data.action === 'mine' && data.target) {
                    findAndMineOre(data.target);
                } else if (data.action === 'wood') {
                    cutSafeTree();
                } else if (data.action === 'quit') {
                    isIntentionalQuit = true;
                    cleanupBot();
                    if (targetChannel) targetChannel.send('🔌 Oyun içinden gelen komutla oyundan çıkış yapıldı.');
                }

            } catch (err) {
                console.error('AI Command Error:', err);
                bot.chat(`/msg ${username} Efendim, sorunuzu işlerken bir hata oluştu.`);
            }
        }

        bot.on('whisper', (username, message) => handleMessage(username, message));
        bot.on('chat', (username, message) => {
            if (message.toLowerCase().includes('aternosbot') || message.toLowerCase().includes('hesap eşle')) {
                handleMessage(username, message);
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

async function findAndMineOre(oreName) {
    const mcData = minecraftData(bot.version);
    
    const targetBlock = bot.findBlock({
        matching: block => {
            return block.name.includes(oreName) || (oreName.includes('coal') && block.name.includes('coal'));
        },
        maxDistance: 64
    });

    if (!targetBlock) {
        bot.chat(`Etrafta 64 blok yakınımda ${oreName} bulamadım efendim.`);
        return;
    }

    bot.chat(`Bulduuum! ${targetBlock.name} madenine doğru ilerliyorum efendim.`);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);
    
    try {
        await bot.pathfinder.setGoal(new goals.GoalAtBlock(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z));
        await bot.dig(targetBlock);
        bot.chat(`Madeni başarıyla kazdım efendim! ⛏️`);
    } catch (err) {
        console.log('Maden kazma hatası:', err);
        bot.chat('Madenin yanına giderken bir engelle karşılaştım.');
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
