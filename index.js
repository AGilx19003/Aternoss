const { Client, GatewayIntentBits } = require('discord.js');
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

// Kendi Discord Kullanıcı ID'nizi buraya yazın! (Başkası komut kullanamaz)
const OWNER_ID = 'BURAYA_DISCORD_KULLANICI_ID_YAZ'; 

let bot = null;
let movementInterval = null;
let reconnectTimeout = null;
let targetChannel = null;
let isIntentionalQuit = false;

client.once('ready', () => {
    console.log(`Discord botu aktif ve giriş yaptı: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // GÜVENLİK KONTROLÜ: Mesajı atan kişi siz değilseniz bot tamamen yok sayar!
    if (message.author.id !== OWNER_ID) return;

    // Yapay Zeka Asistan /msg veya DM (Sadece sizin için çalışır)
    if (message.content.startsWith('!msg') || message.channel.type === 1) {
        const query = message.content.startsWith('!msg') ? message.content.slice(4).trim() : message.content;
        if (!bot) {
            return message.reply('⚠️ Bot şu anda oyunda değil! Önce !katil yazın.');
        }
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Sen sadece bu oyuncunun kişisel asistanısın. Oyuncunun sana yazdığı mesaja Türkçe, samimi ve kısa bir asistan gibi yanıt ver: "${query}"`
            });
            const replyText = response.text;
            message.reply(`🤖 Asistan: ${replyText}`);
            bot.chat(`[Asistan] ${replyText}`);
        } catch (err) {
            console.error('Yapay Zeka Hatası:', err);
            message.reply('❌ Yapay zeka yanıt üretirken bir hata oluştu.');
        }
        return;
    }

    if (message.content === '!katil') {
        if (bot) {
            message.channel.send('⚠️ Bot zaten oyunda ve panel aktif!');
            return;
        }

        isIntentionalQuit = false;
        targetChannel = message.channel;
        message.channel.send('⏳ Efendim, sunucuya bağlanıyorum ve kişisel asistanınız aktif ediliyor...');
        connectMinecraft(message.channel);
    }

    // Koordinata git: !git x y z
    if (message.content.startsWith('!git')) {
        if (!bot) return message.channel.send('⚠️ Bot oyunda değil!');
        const args = message.content.split(' ');
        if (args.length < 4) return message.channel.send('⚠️ Kullanım: `!git <x> <y> <z>`');
        
        const x = parseInt(args[1]);
        const y = parseInt(args[2]);
        const z = parseInt(args[3]);

        message.channel.send(`📍 Emredersiniz efendim, (${x}, ${y}, ${z}) koordinatına gidiyorum.`);
        const mcData = minecraftData(bot.version);
        const defaultMove = new Movements(bot, mcData);
        bot.pathfinder.setMovements(defaultMove);
        bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
    }

    // Güvenli Ağaç Kesme: !agackes
    if (message.content === '!agackes') {
        if (!bot) return message.channel.send('⚠️ Bot oyunda değil!');
        message.channel.send('🪓 Evinize zarar vermeden güvenli bir ağaç arayıp kesiyorum...');
        cutSafeTree();
    }

    // Maden Kazma: !maden <maden_adi>
    if (message.content.startsWith('!maden')) {
        if (!bot) return message.channel.send('⚠️ Bot oyunda değil!');
        const args = message.content.split(' ');
        const oreName = args[1] || 'coal_ore';
        message.channel.send(`⛏️ İstediğiniz ${oreName} madenini arıyorum...`);
        mineOre(oreName);
    }

    // Yatakta uyuma: !uyu
    if (message.content === '!uyu') {
        if (!bot) return message.channel.send('⚠️ Bot oyunda değil!');
        sleepInBed();
    }

    if (message.content === '!cik') {
        if (!bot) {
            message.channel.send('⚠️ Bot zaten oyunda değil!');
            return;
        }
        isIntentionalQuit = true;
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        cleanupBot();
        message.channel.send('🔌 Emredersiniz efendim, oyundan çıkış yapıldı.');
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
            channel.send('✅ Oyuna giriş yaptım efendim! Web paneli http://localhost:3000 adresinde aktif.');
            console.log('Bot oyuna spawn oldu.');

            try {
                mineflayerViewer(bot, { port: 3000, firstPerson: true });
            } catch (e) {}

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

        bot.on('error', (err) => {
            console.error('Minecraft Bağlantı Hatası:', err);
            channel.send(`❌ Minecraft Bağlantı Hatası: ${err.code || err.message}`);
        });

        bot.on('end', (reason) => {
            console.log(`Bot sunucudan düştü. (Sebep: ${reason})`);
            channel.send(`🔌 Bağlantı koptu (Sebep: ${reason}). Yeniden bağlanıyorum efendim...`);
            cleanupBot();

            if (!isIntentionalQuit) {
                reconnectTimeout = setTimeout(() => {
                    connectMinecraft(channel);
                }, 5000);
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

async function sleepInBed() {
    const bed = bot.findBlock({
        matching: block => block.name.includes('bed'),
        maxDistance: 32
    });

    if (!bed) {
        bot.chat('Yakınlarda hiç yatak bulamadım efendim.');
        return;
    }

    try {
        await bot.sleep(bed);
        bot.chat('Yatağa yattım, huzurlu uykular efendim zzz...');
    } catch (err) {
        bot.chat('Şu an uyuyamıyorum.');
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
