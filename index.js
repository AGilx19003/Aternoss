const { Client, GatewayIntentBits } = require('discord.js');
const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const TOKEN = TOKEN;

let bot = null;
let movementInterval = null;

client.once('ready', () => {
    console.log(`Discord botu aktif ve giriş yaptı: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!katil') {
        if (bot) {
            message.channel.send('⚠️ Bot zaten oyunda ve panel aktif!');
            return;
        }

        message.channel.send('⏳ Bot akukasmp.aternos.me sunucusuna bağlanıyor ve web paneli hazırlanıyor...');

        try {
            bot = mineflayer.createBot({
                host: 'akukasmp.aternos.me',
                port: 64952, // Aternos'tan aldığın port numaranı buraya yaz
                username: 'AternosBot',
                version: '1.21.11',
                auth: 'offline'
            });

            bot.on('spawn', () => {
                message.channel.send('✅ Bot oyuna girdi! Web paneli http://localhost:3000 adresinde aktif.');
                console.log('Bot oyuna spawn oldu.');

                // Web panelini başlat (Tarayıcıdan canlı izlemek için)
                mineflayerViewer(bot, { port: 3000, firstPerson: true });

                // Her 15 saniyede bir ileri-geri hareket döngüsü
                let movingForward = true;
                movementInterval = setInterval(() => {
                    if (!bot) return;
                    
                    if (movingForward) {
                        bot.setControlState('forward', true);
                        setTimeout(() => bot.setControlState('forward', false), 2000); // 2 saniye ileri
                    } else {
                        bot.setControlState('back', true);
                        setTimeout(() => bot.setControlState('back', false), 2000); // 2 saniye geri
                    }
                    movingForward = !movingForward;
                }, 15000); // 15 saniyede bir
            });

            bot.on('error', (err) => {
                console.error('Minecraft Bağlantı Hatası:', err);
                message.channel.send(`❌ Minecraft Bağlantı Hatası: ${err.code || err.message}`);
                cleanupBot();
            });

            bot.on('end', (reason) => {
                console.log(`Bot sunucudan düştü. (Sebep: ${reason})`);
                message.channel.send(`🔌 Bot sunucudan düştü. (Sebep: ${reason})`);
                cleanupBot();
            });

        } catch (error) {
            console.error(error);
            message.channel.send(`❌ Hata oluştu: ${error.message}`);
            cleanupBot();
        }
    }

    if (message.content === '!cik') {
        if (!bot) {
            message.channel.send('⚠️ Bot zaten oyunda değil!');
            return;
        }
        cleanupBot();
        message.channel.send('🔌 Bot oyundan çıkarıldı ve panel kapatıldı.');
    }
});

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
