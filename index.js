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

const TOKEN = process.env.TOKEN;

let bot = null;
let movementInterval = null;
let reconnectTimeout = null;
let targetChannel = null; // Botun durum mesajı atacağı Discord kanalı
let isIntentionalQuit = false; // Kullanıcının bilinçli olarak '!cik' komutu verip vermediğini takip eder

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

        isIntentionalQuit = false;
        targetChannel = message.channel;
        message.channel.send('⏳ Bot akukasmp.aternos.me sunucusuna bağlanıyor ve web paneli hazırlanıyor...');
        connectMinecraft(message.channel);
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
        message.channel.send('🔌 Bot oyundan çıkarıldı, otomatik bağlanma durduruldu ve panel kapatıldı.');
    }
});

function connectMinecraft(channel) {
    if (isIntentionalQuit) return;

    try {
        bot = mineflayer.createBot({
            host: 'akukasmp.aternos.me',
            port: 64952, // Aternos port numaranız
            username: 'AternosBot',
            version: '1.21.11',
            auth: 'offline'
        });

        bot.on('spawn', () => {
            channel.send('✅ Bot oyuna girdi! Web paneli http://localhost:3000 adresinde aktif.');
            console.log('Bot oyuna spawn oldu.');

            // Web panelini başlat (Tarayıcıdan canlı izlemek için)
            try {
                mineflayerViewer(bot, { port: 3000, firstPerson: true });
            } catch (e) {
                // Viewer zaten çalışıyorsa çökmesini engeller
            }

            // Her 15 saniyede bir ileri-geri hareket döngüsü (Anti-AFK)
            let movingForward = true;
            if (movementInterval) clearInterval(movementInterval);
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
            channel.send(`❌ Minecraft Bağlantı Hatası: ${err.code || err.message}`);
        });

        bot.on('end', (reason) => {
            console.log(`Bot sunucudan düştü. (Sebep: ${reason})`);
            channel.send(`🔌 Bot sunucudan düştü. (Sebep: ${reason})`);
            
            cleanupBot();

            // Eğer kullanıcı manuel olarak çıkış yapmadıysa 5 saniye sonra tekrar bağlan
            if (!isIntentionalQuit) {
                channel.send('🔄 5 saniye sonra sunucuya tekrar bağlanmaya çalışılacak...');
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
