const { Client, GatewayIntentBits } = require('discord.js');
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus,
    VoiceConnectionStatus
} = require('@discordjs/voice');
const express = require('express');
const path = require('path');
const fs = require('fs');

// Web server to keep Railway happy
const app = express();
app.get('/', (req, res) => res.send('AFK Bot is alive!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web server running on port ${PORT}`));

// Error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', err => {
    console.error('Uncaught Exception:', err);
});

// Discord client
const OWNER_ID = '451647372628459520'; // replace with your Discord user ID

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});
client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// Gateway reconnection logging
client.on('shardDisconnect', (event, shardId) => {
    console.warn(`⚠️ Shard ${shardId} disconnected (code ${event.code}). Waiting for Discord.js to reconnect...`);
});

client.on('shardReconnecting', (shardId) => {
    console.log(`🔄 Shard ${shardId} is reconnecting to the gateway...`);
});

// Track active voice sessions for the heartbeat
const activeSessions = new Map(); // guildId -> { connection, player, channel }

// Command: !gising
client.on('messageCreate', async (message) => {
    if (message.content === '!gising') {
        if (message.author.id !== OWNER_ID) {
            return message.reply('❌ Only the bot owner can use this command.');
        }

        const channel = message.member.voice.channel;
        if (!channel) return message.reply('❌ Join a voice channel first!');

        // Check if silence.mp3 exists
        const silencePath = path.join(__dirname, 'silence.mp3');
        if (!fs.existsSync(silencePath)) {
            return message.reply('❌ silence.mp3 not found! Place a silent mp3 in the bot folder.');
        }

        try {
            const joinAndPlay = () => {
                const connection = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: channel.guild.id,
                    adapterCreator: channel.guild.voiceAdapterCreator
                });

                const player = createAudioPlayer();

                // Function to play silent audio in a loop
                const playLoop = () => {
                    const resource = createAudioResource(silencePath);
                    player.play(resource);
                };

                playLoop();
                connection.subscribe(player);

                // Loop the silent audio forever
                player.on(AudioPlayerStatus.Idle, playLoop);

                // Handle audio player errors — restart playback
                player.on('error', (err) => {
                    console.error('🔴 Audio player error:', err.message);
                    try { playLoop(); } catch (e) { console.error('Failed to restart playback:', e); }
                });

                // Handle voice connection errors
                connection.on('error', (err) => {
                    console.error('🔴 Voice connection error:', err.message);
                });

                // Monitor connection state and rejoin on disconnect
                connection.on('stateChange', (oldState, newState) => {
                    console.log(`🔊 Voice connection state: ${oldState.status} → ${newState.status}`);

                    if (newState.status === VoiceConnectionStatus.Disconnected) {
                        console.warn('⚠️ Voice connection disconnected. Attempting to rejoin...');
                        // Give Discord a moment before rejoining
                        setTimeout(() => {
                            try {
                                joinAndPlay();
                                console.log('✅ Successfully rejoined voice channel after disconnect.');
                            } catch (err) {
                                console.error('❌ Failed to rejoin voice channel:', err);
                            }
                        }, 5000);
                    }
                });

                // Store session for heartbeat monitoring
                activeSessions.set(channel.guild.id, { connection, player, channel });

                return connection;
            };

            joinAndPlay();
            message.reply('✅ Bot joined VC and is staying AFK 24/7');
        } catch (err) {
            console.error('Error joining VC:', err);
            message.reply('❌ Failed to join VC. Check console for errors.');
        }
    }
});

// Heartbeat: every 30 seconds, verify all active connections are still alive
setInterval(() => {
    for (const [guildId, session] of activeSessions.entries()) {
        const { connection, channel } = session;
        const status = connection.state.status;
        if (
            status === VoiceConnectionStatus.Disconnected ||
            status === VoiceConnectionStatus.Destroyed
        ) {
            console.warn(`💓 Heartbeat detected dead connection in guild ${guildId} (status: ${status}). Rejoining...`);
            try {
                const newConnection = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: channel.guild.id,
                    adapterCreator: channel.guild.voiceAdapterCreator
                });
                const silencePath = path.join(__dirname, 'silence.mp3');
                const player = createAudioPlayer();
                const playLoop = () => {
                    const resource = createAudioResource(silencePath);
                    player.play(resource);
                };
                playLoop();
                newConnection.subscribe(player);
                player.on(AudioPlayerStatus.Idle, playLoop);
                player.on('error', (err) => {
                    console.error('🔴 Audio player error (heartbeat-restored session):', err.message);
                    try { playLoop(); } catch (e) { console.error('Failed to restart playback:', e); }
                });
                newConnection.on('error', (err) => {
                    console.error('🔴 Voice connection error (heartbeat-restored session):', err.message);
                });
                activeSessions.set(guildId, { connection: newConnection, player, channel });
                console.log(`✅ Heartbeat rejoined voice channel in guild ${guildId}.`);
            } catch (err) {
                console.error(`❌ Heartbeat failed to rejoin guild ${guildId}:`, err);
            }
        } else {
            console.log(`💓 Heartbeat OK — guild ${guildId} connection status: ${status}`);
        }
    }
}, 30000);

console.log("TOKEN exists?", process.env.TOKEN ? "Yes" : "No");
client.login(process.env.TOKEN);
