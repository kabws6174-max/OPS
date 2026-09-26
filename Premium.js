const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    SlashCommandBuilder
} = require('discord.js');

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const TOKEN = String(process.env.DISCORD_TOKEN || '').trim();

if (!TOKEN) {
    console.error('❌ DISCORD_TOKEN غير موجود في Railway Variables.');
    process.exit(1);
}

const REQUEST_CHANNEL_ID = '1545187326093693038';
const PREMIUM_ROLE_ID = '1544858160982917261';
const MASS_SUMMON_ROLE_ID = '1546263383526088805';

const DB_FILE = path.join(__dirname, 'economy.json');
const DB_BACKUP_FILE = path.join(__dirname, 'economy.backup.json');
const DB_TEMP_FILE = path.join(__dirname, 'economy.tmp.json');

const DEFAULT_CURRENCY_NAME = '𝐎𝐏𝐬';
const MAX_ECONOMY_CHANNELS = 3;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        if (fs.existsSync(DB_BACKUP_FILE)) {
            try {
                fs.copyFileSync(DB_BACKUP_FILE, DB_FILE);
            } catch {}
        } else {
            fs.writeFileSync(
                DB_FILE,
                JSON.stringify({}, null, 2),
                'utf8'
            );
        }
    }

    try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const data = raw.trim() ? JSON.parse(raw) : {};

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('Invalid database format');
        }

        return data;
    } catch (error) {
        console.error('❌ Database Load Error:', error);

        try {
            if (fs.existsSync(DB_BACKUP_FILE)) {
                const raw = fs.readFileSync(DB_BACKUP_FILE, 'utf8');
                const backup = raw.trim() ? JSON.parse(raw) : {};

                if (
                    backup &&
                    typeof backup === 'object' &&
                    !Array.isArray(backup)
                ) {
                    fs.copyFileSync(DB_BACKUP_FILE, DB_FILE);
                    console.log(
                        '✅ تم استرجاع قاعدة البيانات من النسخة الاحتياطية.'
                    );
                    return backup;
                }
            }
        } catch (backupError) {
            console.error(
                '❌ Backup Database Load Error:',
                backupError
            );
        }

        return {};
    }
}

function saveDB(data) {
    try {
        const serialized = JSON.stringify(data, null, 2);

        fs.writeFileSync(
            DB_TEMP_FILE,
            serialized,
            'utf8'
        );

        try {
            const fd = fs.openSync(DB_TEMP_FILE, 'r');
            fs.fsyncSync(fd);
            fs.closeSync(fd);
        } catch {}

        if (fs.existsSync(DB_FILE)) {
            try {
                fs.copyFileSync(
                    DB_FILE,
                    DB_BACKUP_FILE
                );
            } catch (backupError) {
                console.error(
                    '❌ Database Backup Error:',
                    backupError
                );
            }
        }

        if (
            process.platform === 'win32' &&
            fs.existsSync(DB_FILE)
        ) {
            fs.unlinkSync(DB_FILE);
        }

        fs.renameSync(
            DB_TEMP_FILE,
            DB_FILE
        );
    } catch (error) {
        console.error(
            '❌ Database Save Error:',
            error
        );

        try {
            if (
                fs.existsSync(
                    DB_TEMP_FILE
                )
            ) {
                fs.unlinkSync(
                    DB_TEMP_FILE
                );
            }
        } catch {}

        try {
            if (
                fs.existsSync(
                    DB_BACKUP_FILE
                ) &&
                !fs.existsSync(
                    DB_FILE
                )
            ) {
                fs.copyFileSync(
                    DB_BACKUP_FILE,
                    DB_FILE
                );
            }
        } catch {}
    }
}

function ensureGuildConfig(db, guildId) {
    if (!db.guildSettings) {
        db.guildSettings = {};
    }

    if (!db.guildSettings[guildId]) {
        db.guildSettings[guildId] = {
            currencyName: DEFAULT_CURRENCY_NAME,
            economyChannels: []
        };
    }

    const config =
        db.guildSettings[guildId];

    if (
        typeof config.currencyName !== 'string' ||
        !config.currencyName.trim()
    ) {
        config.currencyName =
            DEFAULT_CURRENCY_NAME;
    }

    if (!Array.isArray(config.economyChannels)) {
        config.economyChannels = [];
    }

    config.economyChannels =
        config.economyChannels
            .filter(
                id =>
                    /^\d{17,20}$/.test(
                        String(id)
                    )
            )
            .slice(
                0,
                MAX_ECONOMY_CHANNELS
            );

    return config;
}

function getGuildConfig(guildId) {
    const db = loadDB();

    return ensureGuildConfig(
        db,
        guildId
    );
}

function getCurrencyName(guildId) {
    return getGuildConfig(
        guildId
    ).currencyName;
}

/*
=========================================================
فصل بيانات كل سيرفر
=========================================================
*/

function ensureGuildData(db, guildId) {
    if (!db.guildData) {
        db.guildData = {};
    }

    if (
        !db.guildData[guildId] ||
        typeof db.guildData[guildId] !== 'object' ||
        Array.isArray(db.guildData[guildId])
    ) {
        db.guildData[guildId] = {
            users: {}
        };
    }

    if (
        !db.guildData[guildId].users ||
        typeof db.guildData[guildId].users !== 'object' ||
        Array.isArray(db.guildData[guildId].users)
    ) {
        db.guildData[guildId].users = {};
    }

    return db.guildData[guildId];
}

function ensureUser(db, guildId, userId) {
    const guildData =
        ensureGuildData(
            db,
            guildId
        );

    if (!guildData.users[userId]) {
        /*
        نقل بيانات النظام القديم إلى أول سيرفر
        يستخدم الحساب مرة واحدة فقط.
        بعد ذلك يصبح الحساب منفصلاً لكل سيرفر.
        */

        if (
            db[userId] &&
            typeof db[userId] === 'object' &&
            !db[userId].__legacyMigrated
        ) {
            guildData.users[userId] = {
                balance:
                    Number(
                        db[userId].balance
                    ) || 0,

                lastDaily:
                    Number(
                        db[userId].lastDaily
                    ) || 0
            };

            delete db[userId];

            try {
                saveDB(db);
            } catch {}
        } else {
            guildData.users[userId] = {
                balance: 0,
                lastDaily: 0
            };
        }
    }

    if (
        typeof guildData.users[userId].balance !==
        'number'
    ) {
        guildData.users[userId].balance =
            Number(
                guildData.users[userId].balance
            ) || 0;
    }

    if (
        typeof guildData.users[userId].lastDaily !==
        'number'
    ) {
        guildData.users[userId].lastDaily =
            Number(
                guildData.users[userId].lastDaily
            ) || 0;
    }

    return guildData.users[userId];
}

function parseAmount(value) {
    if (!value) return NaN;

    const text =
        String(value)
            .trim()
            .toLowerCase()
            .replace(
                /,/g,
                ''
            );

    const match =
        text.match(
            /^(\d+(?:\.\d+)?)([kmbt])?$/
        );

    if (!match) return NaN;

    const number =
        Number(
            match[1]
        );

    const suffix =
        match[2] || '';

    if (!Number.isFinite(number)) {
        return NaN;
    }

    const multipliers = {
        k: 1_000,
        m: 1_000_000,
        b: 1_000_000_000,
        t: 1_000_000_000_000
    };

    return Math.floor(
        number *
        (
            multipliers[suffix] ||
            1
        )
    );
}

function formatAmount(amount) {
    amount =
        Number(amount) || 0;

    if (
        amount >=
        1_000_000_000_000
    ) {
        return (
            (
                amount /
                1_000_000_000_000
            )
                .toFixed(2)
                .replace(
                    /\.00$/,
                    ''
                )
                .replace(
                    /(\.\d)0$/,
                    '$1'
                ) +
            'T'
        );
    }

    if (
        amount >=
        1_000_000_000
    ) {
        return (
            (
                amount /
                1_000_000_000
            )
                .toFixed(2)
                .replace(
                    /\.00$/,
                    ''
                )
                .replace(
                    /(\.\d)0$/,
                    '$1'
                ) +
            'B'
        );
    }

    if (
        amount >=
        1_000_000
    ) {
        return (
            (
                amount /
                1_000_000
            )
                .toFixed(2)
                .replace(
                    /\.00$/,
                    ''
                )
                .replace(
                    /(\.\d)0$/,
                    '$1'
                ) +
            'M'
        );
    }

    if (
        amount >=
        1_000
    ) {
        return (
            (
                amount /
                1_000
            )
                .toFixed(2)
                .replace(
                    /\.00$/,
                    ''
                )
                .replace(
                    /(\.\d)0$/,
                    '$1'
                ) +
            'K'
        );
    }

    return amount.toLocaleString();
}

function getTransferKey(
    guildId,
    userId
) {
    return `${guildId}:${userId}`;
}

const pendingTransfers =
    new Map();

const pendingRewards =
    new Map();

client.once(
    'ready',
    async () => {
        console.log(
            `✅ Logged in as ${client.user.tag}`
        );

        console.log(
            `💾 Database file: ${DB_FILE}`
        );

        loadDB();

        try {
            console.log(
                `🌐 Servers: ${client.guilds.cache.size}`
            );
        } catch {}

        client.user.setActivity(
            'BLK System',
            {
                type: 0
            }
        );
    }
);

client.on(
    'messageCreate',
    async message => {
        try {
            if (
                message.author.bot
            ) {
                return;
            }

            if (
                !message.guild
            ) {
                return;
            }

            const content =
                message.content.trim();

            if (
                !content
            ) {
                return;
            }

            const economyDB =
                loadDB();

            const guildConfig =
                ensureGuildConfig(
                    economyDB,
                    message.guild.id
                );

            if (
                !guildConfig.economyChannels.includes(
                    message.channel.id
                )
            ) {
                return;
            }

            const db =
                economyDB;

            const userId =
                message.author.id;

            ensureUser(
                db,
                message.guild.id,
                userId
            );

            /*
            =========================================================
            PENDING TRANSFER
            =========================================================
            */

            if (
                pendingTransfers.has(
                    getTransferKey(
                        message.guild.id,
                        userId
                    )
                )
            ) {
                const transferData =
                    pendingTransfers.get(
                        getTransferKey(
                            message.guild.id,
                            userId
                        )
                    );

                if (
                    transferData.code &&
                    content ===
                        transferData.code
                ) {
                    pendingTransfers.delete(
                        getTransferKey(
                            message.guild.id,
                            userId
                        )
                    );

                    await message
                        .delete()
                        .catch(
                            () => {}
                        );

                    if (
                        transferData.botMsg
                    ) {
                        await transferData
                            .botMsg
                            .delete()
                            .catch(
                                () => {}
                            );
                    }

                    const transferDB =
                        loadDB();

                    ensureUser(
                        transferDB,
                        message.guild.id,
                        userId
                    );

                    ensureUser(
                        transferDB,
                        message.guild.id,
                        transferData.targetId
                    );

                    if (
                        ensureUser(
                            transferDB,
                            message.guild.id,
                            userId
                        ).balance <
                        transferData.amount
                    ) {
                        return message.channel.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(
                                        '#D4AC0D'
                                    )
                                    .setDescription(
                                        '❌ ليس لديك رصيد كافٍ لإتمام عملية التحويل.'
                                    )
                            ]
                        });
                    }

                    ensureUser(
                        transferDB,
                        message.guild.id,
                        userId
                    ).balance -=
                        transferData.amount;

                    ensureUser(
                        transferDB,
                        message.guild.id,
                        transferData.targetId
                    ).balance +=
                        transferData.amount;

                    saveDB(
                        transferDB
                    );

                    const targetMember =
                        await message.guild.members
                            .fetch(
                                transferData.targetId
                            )
                            .catch(
                                () => null
                            );

                    const currencyName =
                        getCurrencyName(
                            message.guild.id
                        );

                    const receiptEmbed =
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setTitle(
                                'إيصال تحويل'
                            )
                            .addFields(
                                {
                                    name:
                                        'المبلغ',
                                    value:
                                        `\`\`\`fix\n${formatAmount(
                                            transferData.amount
                                        )} ${currencyName}\n\`\`\``
                                },
                                {
                                    name:
                                        'إلى',
                                    value:
                                        `\`\`\`ini\n[ ${
                                            targetMember
                                                ? targetMember.user.tag
                                                : transferData.targetId
                                        } ]\n\`\`\``
                                },
                                {
                                    name:
                                        'من',
                                    value:
                                        `\`\`\`ini\n[ ${message.author.tag} ]\n\`\`\``
                                }
                            )
                            .setTimestamp();

                    await message.author
                        .send({
                            embeds: [
                                receiptEmbed
                            ]
                        })
                        .catch(
                            () => {}
                        );

                    if (
                        targetMember
                    ) {
                        await targetMember
                            .send({
                                embeds: [
                                    receiptEmbed
                                ]
                            })
                            .catch(
                                () => {}
                            );
                    }

                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    `✅ تم التحويل بنجاح بقيمة **${formatAmount(
                                        transferData.amount
                                    )} ${currencyName}**.`
                                )
                        ]
                    });
                }
            }

            /*
            =========================================================
            DAILY
            =========================================================
            */

            if (
                content === 'مكافاة' ||
                content === 'مكافأة'
            ) {
                const accountAge =
                    Date.now() -
                    message.author.createdTimestamp;

                const fourteenDays =
                    14 *
                    24 *
                    60 *
                    60 *
                    1000;

                if (
                    accountAge <
                    fourteenDays
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    'لا يمكنك أخذ المكافأة اليومية لأن عمر حسابك أقل من 14 يومًا.'
                                )
                        ]
                    });
                }

                const now =
                    Date.now();

                const cooldown =
                    24 *
                    60 *
                    60 *
                    1000;

                if (
                    now -
                        ensureUser(
                            db,
                            message.guild.id,
                            userId
                        ).lastDaily <
                    cooldown
                ) {
                    const remaining =
                        cooldown -
                        (
                            now -
                            ensureUser(
                                db,
                                message.guild.id,
                                userId
                            ).lastDaily
                        );

                    const hours =
                        Math.floor(
                            remaining /
                            (
                                60 *
                                60 *
                                1000
                            )
                        );

                    const minutes =
                        Math.floor(
                            (
                                remaining %
                                (
                                    60 *
                                    60 *
                                    1000
                                )
                            ) /
                            (
                                60 *
                                1000
                            )
                        );

                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    `⏳ لقد استلمت مكافأتك مسبقاً. يمكنك الاستلام بعد **${hours} ساعة و ${minutes} دقيقة**.`
                                )
                        ]
                    });
                }

                const isPremium =
                    message.member.roles.cache.has(
                        PREMIUM_ROLE_ID
                    );

                const randomAmount =
                    isPremium
                        ? Math.floor(
                            Math.random() *
                            2001
                        ) + 3000
                        : Math.floor(
                            Math.random() *
                            301
                        ) + 1700;

                ensureUser(
                    db,
                    message.guild.id,
                    userId
                ).balance +=
                    randomAmount;

                ensureUser(
                    db,
                    message.guild.id,
                    userId
                ).lastDaily =
                    now;

                saveDB(
                    db
                );

                const currencyName =
                    getCurrencyName(
                        message.guild.id
                    );

                const rewardEmbed =
                    new EmbedBuilder()
                        .setColor(
                            '#D4AC0D'
                        )
                        .setDescription(
                            isPremium
                                ? `🎁 **مكافأة عضو مميز**\n\nلقد حصلت على **${formatAmount(
                                    randomAmount
                                )} ${currencyName}**`
                                : `🎁 لقد حصلت على **${formatAmount(
                                    randomAmount
                                )} ${currencyName}** coin`
                        );

                return message.channel.send({
                    embeds: [
                        rewardEmbed
                    ]
                });
            }

            /*
            =========================================================
            BALANCE
            =========================================================
            */

            const currencyCommandName =
                getCurrencyName(
                    message.guild.id
                ).toLowerCase();

            if (
                content.toLowerCase() ===
                    currencyCommandName ||
                content.toLowerCase() ===
                    'ops' ||
                content ===
                    'رصيد' ||
                content.startsWith(
                    'رصيد '
                ) ||
                content.toLowerCase().startsWith(
                    `${currencyCommandName} `
                ) ||
                content.toLowerCase().startsWith(
                    'ops '
                )
            ) {
                const targetMember =
                    message.mentions.members.first() ||
                    message.member;

                const targetUser =
                    ensureUser(
                        db,
                        message.guild.id,
                        targetMember.id
                    );

                const balance =
                    Number(
                        targetUser.balance
                    ) || 0;

                const description =
                    targetMember.id ===
                    message.author.id
                        ? `رصيدك الحالي : ${formatAmount(
                            balance
                        )} ${getCurrencyName(
                            message.guild.id
                        )}`
                        : `رصيد العضو ${targetMember} الحالي : ${formatAmount(
                            balance
                        )} ${getCurrencyName(
                            message.guild.id
                        )}`;

                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setDescription(
                                description
                            )
                    ]
                });
            }

            /*
            =========================================================
            TOP
            =========================================================
            */

            if (
                content === 'توب' ||
                content === 'التوب' ||
                content.toLowerCase() ===
                    'top' ||
                /^توب\s+[1-5]$/i.test(
                    content
                )
            ) {
                let page = 1;

                if (
                    content.startsWith(
                        'توب '
                    )
                ) {
                    page =
                        parseInt(
                            content.split(
                                /\s+/
                            )[1]
                        );
                }

                if (
                    page < 1 ||
                    page > 5
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ صفحات التوب من 1 إلى 5 فقط.'
                                )
                        ]
                    });
                }

                const guildUsers =
                    ensureGuildData(
                        db,
                        message.guild.id
                    ).users;

                const sortedUsers =
                    Object.entries(
                        guildUsers
                    )
                        .filter(
                            ([, data]) =>
                                Number(
                                    data.balance
                                ) > 0
                        )
                        .sort(
                            (a, b) =>
                                Number(
                                    b[1].balance
                                ) -
                                Number(
                                    a[1].balance
                                )
                        );

                const start =
                    (page - 1) *
                    10;

                const pageUsers =
                    sortedUsers.slice(
                        start,
                        start + 10
                    );

                let description =
                    '';

                pageUsers.forEach(
                    (
                        [userId, data],
                        index
                    ) => {
                        description +=
                            `#${start + index + 1} <@${userId}> — **${formatAmount(
                                data.balance
                            )} ${getCurrencyName(
                                message.guild.id
                            )}**\n`;
                    }
                );

                if (
                    !description
                ) {
                    description =
                        'لا يوجد أعضاء لديهم رصيد حتى الآن.';
                }

                const totalPages =
                    Math.max(
                        1,
                        Math.ceil(
                            sortedUsers.length /
                            10
                        )
                    );

                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setTitle(
                                `🏆 توب السيرفر — الصفحة ${page}/${totalPages}`
                            )
                            .setDescription(
                                description
                            )
                            .setFooter({
                                text:
                                    message.guild.name
                            })
                    ]
                });
            }

            /*
            =========================================================
            INFO
            =========================================================
            */

            if (
                content === 'معلومات' ||
                content === 'المعلومات'
            ) {
                const targetMember =
                    message.mentions.members.first() ||
                    message.member;

                const targetId =
                    targetMember.id;

                const userData =
                    ensureUser(
                        db,
                        message.guild.id,
                        targetId
                    );

                let lastTimeText =
                    'لم يستلم أبداً';

                let nextTimeText =
                    'متاح الآن';

                if (
                    userData.lastDaily >
                    0
                ) {
                    const lastDate =
                        new Date(
                            userData.lastDaily
                        );

                    lastTimeText =
                        lastDate.toLocaleString();

                    const nextTime =
                        userData.lastDaily +
                        (
                            24 *
                            60 *
                            60 *
                            1000
                        );

                    if (
                        Date.now() <
                        nextTime
                    ) {
                        nextTimeText =
                            new Date(
                                nextTime
                            ).toLocaleString();
                    }
                }

                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setTitle(
                                `📊 معلومات ${targetMember.user.username}`
                            )
                            .setDescription(
                                `💰 الرصيد: **${formatAmount(
                                    userData.balance
                                )} ${getCurrencyName(
                                    message.guild.id
                                )}**\n\n🎁 آخر مكافأة: **${lastTimeText}**\n⏳ المكافأة القادمة: **${nextTimeText}**`
                            )
                    ]
                });
            }

            /*
            =========================================================
            GIVE
            =========================================================
            */

            if (
                content.toLowerCase()
                    .startsWith(
                        'اعطي '
                    )
            ) {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.Administrator
                    )
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ ليس لديك صلاحية لاستخدام هذا الأمر.'
                                )
                        ]
                    });
                }

                const args =
                    content.split(
                        /\s+/
                    );

                const targetMember =
                    message.mentions.members.first();

                const amount =
                    parseAmount(
                        args[2]
                    );

                if (
                    !targetMember ||
                    isNaN(amount) ||
                    amount <= 0
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ الاستخدام الصحيح: `اعطي @العضو المبلغ`\nمثال: `اعطي @العضو 20k`'
                                )
                        ]
                    });
                }

                ensureUser(
                    db,
                    message.guild.id,
                    targetMember.id
                );

                ensureUser(
                    db,
                    message.guild.id,
                    targetMember.id
                ).balance +=
                    amount;

                saveDB(
                    db
                );

                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setDescription(
                                `✅ تم إضافة **${formatAmount(
                                    amount
                                )} ${getCurrencyName(
                                    message.guild.id
                                )}** إلى رصيد ${targetMember}`
                            )
                    ]
                });
            }

            /*
            =========================================================
            WITHDRAW
            =========================================================
            */

            if (
                content.toLowerCase()
                    .startsWith(
                        'سحب '
                    )
            ) {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.Administrator
                    )
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ ليس لديك صلاحية لاستخدام هذا الأمر.'
                                )
                        ]
                    });
                }

                const args =
                    content.split(
                        /\s+/
                    );

                const targetMember =
                    message.mentions.members.first();

                const argValue =
                    args[2]
                        ? args[2].toLowerCase()
                        : '';

                if (
                    !targetMember ||
                    !argValue
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ الاستخدام الصحيح: `سحب @العضو المبلغ` أو `سحب @العضو نص` أو `سحب @العضو كامل`'
                                )
                        ]
                    });
                }

                const targetData =
                    ensureUser(
                        db,
                        message.guild.id,
                        targetMember.id
                    );

                const balance =
                    Number(
                        targetData.balance
                    ) || 0;

                let amount = 0;

                if (
                    argValue ===
                    'كامل'
                ) {
                    amount =
                        balance;
                } else if (
                    argValue ===
                    'نص'
                ) {
                    amount =
                        Math.floor(
                            balance /
                            2
                        );
                } else {
                    amount =
                        parseAmount(
                            argValue
                        );
                }

                if (
                    !Number.isFinite(
                        amount
                    ) ||
                    amount < 0
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ يرجى كتابة مبلغ صالح أو كلمة (نص) أو (كامل).\n\nالاختصارات المدعومة: `k` `m` `b` `t`'
                                )
                        ]
                    });
                }

                if (
                    amount >
                    balance
                ) {
                    amount =
                        balance;
                }

                ensureUser(
                    db,
                    message.guild.id,
                    targetMember.id
                ).balance =
                    Math.max(
                        0,
                        balance -
                            amount
                    );

                saveDB(
                    db
                );

                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setDescription(
                                `✅ تم سحب **${formatAmount(
                                    amount
                                )} ${getCurrencyName(
                                    message.guild.id
                                )}** من رصيد ${targetMember}`
                            )
                    ]
                });
            }

            /*
            =========================================================
            TRANSFER
            =========================================================
            */

            if (
                content.toLowerCase()
                    .startsWith(
                        'تحويل '
                    )
            ) {
                const args =
                    content.split(
                        /\s+/
                    );

                const targetMember =
                    message.mentions.members.first();

                const argValue =
                    args[2]
                        ? args[2].toLowerCase()
                        : '';

                if (
                    !targetMember ||
                    !argValue
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ الاستخدام الصحيح: `تحويل @العضو المبلغ` أو `تحويل @العضو نص` أو `تحويل @العضو كامل`'
                                )
                        ]
                    });
                }

                if (
                    targetMember.id ===
                    message.author.id
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ لا يمكنك التحويل لنفسك!'
                                )
                        ]
                    });
                }

                let amount = 0;

                const currentBalance =
                    Number(
                        ensureUser(
                            db,
                            message.guild.id,
                            userId
                        ).balance
                    ) || 0;

                if (
                    argValue ===
                    'كامل'
                ) {
                    amount =
                        currentBalance;
                } else if (
                    argValue ===
                    'نص'
                ) {
                    amount =
                        Math.floor(
                            currentBalance /
                            2
                        );
                } else {
                    amount =
                        parseAmount(
                            argValue
                        );
                }

                if (
                    !Number.isFinite(
                        amount
                    ) ||
                    amount <= 0
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ يرجى كتابة مبلغ صالح أو كلمة (نص) أو (كامل).'
                                )
                        ]
                    });
                }

                if (
                    amount >
                    currentBalance
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ ليس لديك رصيد كافٍ لإتمام عملية التحويل.'
                                )
                        ]
                    });
                }

                const code =
                    String(
                        Math.floor(
                            100000 +
                            Math.random() *
                            900000
                        )
                    );

                const currencyName =
                    getCurrencyName(
                        message.guild.id
                    );

                const botMsg =
                    await message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setTitle(
                                    '🔐 تأكيد التحويل'
                                )
                                .setDescription(
                                    `سيتم تحويل **${formatAmount(
                                        amount
                                    )} ${currencyName}** إلى ${targetMember}.\n\nأرسل رمز التحقق التالي في الشات لإتمام العملية:\n\n**${code}**`
                                )
                        ]
                    });

                const key =
                    getTransferKey(
                        message.guild.id,
                        userId
                    );

                const timeout =
                    setTimeout(
                        () => {
                            pendingTransfers.delete(
                                key
                            );

                            botMsg
                                .delete()
                                .catch(
                                    () => {}
                                );
                        },
                        60 *
                        1000
                    );

                pendingTransfers.set(
                    key,
                    {
                        guildId:
                            message.guild.id,
                        senderId:
                            userId,
                        targetId:
                            targetMember.id,
                        amount,
                        code,
                        botMsg,
                        timeout
                    }
                );

                return;
            }

            /*
            =========================================================
            دعم
            =========================================================
            */

            if (
                content === 'دعم' ||
                content === 'دعم؟'
            ) {
                const supportChannelId =
                    '1540417155059687504';

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setLabel(
                                    'الدعم'
                                )
                                .setStyle(
                                    ButtonStyle.Link
                                )
                                .setURL(
                                    `https://discord.com/channels/${message.guild.id}/${supportChannelId}`
                                )
                        );

                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setTitle(
                                '🎫 الدعم'
                            )
                            .setDescription(
                                'إذا كنت بحاجة إلى مساعدة، يمكنك التواصل مع فريق الدعم.'
                            )
                    ],
                    components: [
                        row
                    ]
                });
            }
        } catch (error) {
            console.error(
                '❌ Message Error:',
                error
            );
        }
    }
);

client.on(
    'interactionCreate',
    async interaction => {
        try {
            if (
                interaction.isChatInputCommand()
            ) {
                if (
                    !interaction.guild
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الأمر يعمل داخل السيرفر فقط.',
                        ephemeral: true
                    });
                }

                if (
                    !(
                        interaction.memberPermissions &&
                        interaction.memberPermissions.has(
                            PermissionFlagsBits.Administrator
                        )
                    )
                ) {
                    return interaction.reply({
                        content:
                            'ليس لديك صلاحية لاستخدام هذا الأمر.',
                        ephemeral: true
                    });
                }

                const db =
                    loadDB();

                const config =
                    ensureGuildConfig(
                        db,
                        interaction.guild.id
                    );

                const guildUsers =
                    ensureGuildData(
                        db,
                        interaction.guild.id
                    ).users;

                /*
                =========================================================
                CURRENCY
                =========================================================
                */

                if (
                    interaction.commandName ===
                    'currency'
                ) {
                    const name =
                        interaction.options
                            .getString(
                                'name',
                                true
                            )
                            .trim();

                    if (
                        !name
                    ) {
                        return interaction.reply({
                            content:
                                '❌ اسم العملة غير صحيح.',
                            ephemeral: true
                        });
                    }

                    config.currencyName =
                        name;

                    saveDB(
                        db
                    );

                    return interaction.reply({
                        content:
                            `✅ تم تغيير اسم العملة إلى **${name}** في هذا السيرفر فقط.`,
                        ephemeral: true
                    });
                }

                /*
                =========================================================
                ECONOMY CHANNELS
                =========================================================
                */

                if (
                    interaction.commandName ===
                    'economy-channel'
                ) {
                    const subcommand =
                        interaction.options
                            .getSubcommand();

                    if (
                        subcommand ===
                        'add'
                    ) {
                        const channel =
                            interaction.options
                                .getChannel(
                                    'channel',
                                    true
                                );

                        if (
                            !config.economyChannels.includes(
                                channel.id
                            )
                        ) {
                            config.economyChannels.push(
                                channel.id
                            );
                        }

                        config.economyChannels =
                            config.economyChannels.slice(
                                0,
                                MAX_ECONOMY_CHANNELS
                            );

                        saveDB(
                            db
                        );

                        return interaction.reply({
                            content:
                                `✅ تم إضافة ${channel} إلى غرف العملات في هذا السيرفر.`,
                            ephemeral: true
                        });
                    }

                    if (
                        subcommand ===
                        'remove'
                    ) {
                        const channel =
                            interaction.options
                                .getChannel(
                                    'channel',
                                    true
                                );

                        config.economyChannels =
                            config.economyChannels.filter(
                                id =>
                                    id !==
                                    channel.id
                            );

                        saveDB(
                            db
                        );

                        return interaction.reply({
                            content:
                                `✅ تم حذف ${channel} من غرف العملات في هذا السيرفر.`,
                            ephemeral: true
                        });
                    }

                    if (
                        subcommand ===
                        'list'
                    ) {
                        const channels =
                            config.economyChannels
                                .map(
                                    id =>
                                        `<#${id}>`
                                )
                                .join(
                                    '\n'
                                );

                        return interaction.reply({
                            content:
                                channels ||
                                'لا توجد غرف عملات محددة.',
                            ephemeral: true
                        });
                    }
                }

                /*
                =========================================================
                GIVE
                =========================================================
                */

                if (
                    interaction.commandName ===
                    'give'
                ) {
                    const targetUser =
                        interaction.options
                            .getUser(
                                'member',
                                true
                            );

                    const amountText =
                        interaction.options
                            .getString(
                                'amount',
                                true
                            );

                    const amount =
                        parseAmount(
                            amountText
                        );

                    if (
                        !Number.isFinite(
                            amount
                        ) ||
                        amount <= 0
                    ) {
                        return interaction.reply({
                            content:
                                '❌ المبلغ غير صحيح.\nمثال: `20k` أو `2m` أو `500`.',
                            ephemeral: true
                        });
                    }

                    ensureUser(
                        db,
                        interaction.guild.id,
                        targetUser.id
                    );

                    ensureUser(
                        db,
                        interaction.guild.id,
                        targetUser.id
                    ).balance +=
                        amount;

                    saveDB(
                        db
                    );

                    return interaction.reply({
                        content:
                            `✅ تم إضافة **${formatAmount(
                                amount
                            )} ${getCurrencyName(
                                interaction.guild.id
                            )}** إلى رصيد <@${targetUser.id}>.`,
                        ephemeral: true
                    });
                }

                /*
                =========================================================
                WITHDRAW
                =========================================================
                */

                if (
                    interaction.commandName ===
                    'withdraw'
                ) {
                    const targetUser =
                        interaction.options
                            .getUser(
                                'member',
                                true
                            );

                    const amountText =
                        interaction.options
                            .getString(
                                'amount',
                                true
                            )
                            .trim()
                            .toLowerCase();

                    if (
                        targetUser.bot
                    ) {
                        return interaction.reply({
                            content:
                                '❌ لا يمكنك سحب عملة من بوت.',
                            ephemeral: true
                        });
                    }

                    const targetData =
                        ensureUser(
                            db,
                            interaction.guild.id,
                            targetUser.id
                        );

                    const balance =
                        Number(
                            targetData.balance
                        ) || 0;

                    let amount = 0;

                    if (
                        amountText ===
                        'كامل'
                    ) {
                        amount =
                            balance;
                    } else if (
                        amountText ===
                        'نص'
                    ) {
                        amount =
                            Math.floor(
                                balance /
                                2
                            );
                    } else {
                        amount =
                            parseAmount(
                                amountText
                            );
                    }

                    if (
                        !Number.isFinite(
                            amount
                        ) ||
                        amount < 0
                    ) {
                        return interaction.reply({
                            content:
                                '❌ المبلغ غير صحيح.',
                            ephemeral: true
                        });
                    }

                    if (
                        amount >
                        balance
                    ) {
                        return interaction.reply({
                            content:
                                `❌ رصيد العضو غير كافٍ. رصيده الحالي **${formatAmount(
                                    balance
                                )} ${getCurrencyName(
                                    interaction.guild.id
                                )}**.`,
                            ephemeral: true
                        });
                    }

                    ensureUser(
                        db,
                        interaction.guild.id,
                        targetUser.id
                    ).balance =
                        Math.max(
                            0,
                            balance -
                                amount
                        );

                    saveDB(
                        db
                    );

                    return interaction.reply({
                        content:
                            `✅ تم سحب **${formatAmount(
                                amount
                            )} ${getCurrencyName(
                                interaction.guild.id
                            )}** من رصيد <@${targetUser.id}>.`,
                        ephemeral: true
                    });
                }

                /*
                =========================================================
                TOP
                =========================================================
                */

                if (
                    interaction.commandName ===
                    'top'
                ) {
                    const sortedUsers =
                        Object.entries(
                            guildUsers
                        )
                            .filter(
                                ([, data]) =>
                                    Number(
                                        data.balance
                                    ) > 0
                            )
                            .sort(
                                (a, b) =>
                                    Number(
                                        b[1].balance
                                    ) -
                                    Number(
                                        a[1].balance
                                    )
                            );

                    const pageUsers =
                        sortedUsers.slice(
                            0,
                            10
                        );

                    let description =
                        '';

                    pageUsers.forEach(
                        (
                            [userId, data],
                            index
                        ) => {
                            description +=
                                `#${index + 1} <@${userId}> — **${formatAmount(
                                    data.balance
                                )} ${getCurrencyName(
                                    interaction.guild.id
                                )}**\n`;
                        }
                    );

                    if (
                        !description
                    ) {
                        description =
                            'لا يوجد أعضاء لديهم رصيد حتى الآن.';
                    }

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setTitle(
                                    '🏆 توب السيرفر'
                                )
                                .setDescription(
                                    description
                                )
                        ],
                        ephemeral: true
                    });
                }

                /*
                =========================================================
                SERVER SETTINGS
                =========================================================
                */

                if (
                    interaction.commandName ===
                    'server-settings'
                ) {
                    const channels =
                        config.economyChannels
                            .map(
                                id =>
                                    `<#${id}>`
                            )
                            .join(
                                '\n'
                            ) ||
                        'لا توجد غرف عملات.';

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setTitle(
                                    '⚙️ إعدادات السيرفر'
                                )
                                .setDescription(
                                    `💰 اسم العملة: **${config.currencyName}**\n\n📢 غرف العملات:\n${channels}`
                                )
                        ],
                        ephemeral: true
                    });
                }

                /*
                =========================================================
                باقي أوامر السلاش الأصلية
                =========================================================
                */

                if (
                    interaction.commandName ===
                    'rest'
                ) {
                    await interaction.deferReply({
                        ephemeral: true
                    });

                    try {
                        const me =
                            interaction.guild.members.me ||
                            await interaction.guild.members
                                .fetch(
                                    client.user.id
                                );

                        await me.edit({
                            nick: null,
                            avatar: null,
                            banner: null
                        });

                        return interaction.editReply({
                            content:
                                '✅ تم إرجاع اسم وصورة وبنر البوت للوضع الأساسي في هذا السيرفر فقط.'
                        });
                    } catch (error) {
                        console.error(
                            '❌ Reset Guild Profile Error:',
                            error
                        );

                        return interaction.editReply({
                            content:
                                '❌ تعذر إرجاع بروفايل البوت في هذا السيرفر.'
                        });
                    }
                }

                if (
                    interaction.commandName ===
                    'bot-name'
                ) {
                    const name =
                        interaction.options
                            .getString(
                                'name',
                                true
                            );

                    try {
                        const me =
                            interaction.guild.members.me ||
                            await interaction.guild.members
                                .fetch(
                                    client.user.id
                                );

                        await me.setNickname(
                            name
                        );

                        return interaction.reply({
                            content:
                                '✅ تم تغيير اسم البوت في هذا السيرفر فقط.',
                            ephemeral: true
                        });
                    } catch (error) {
                        console.error(
                            '❌ Bot Name Error:',
                            error
                        );

                        return interaction.reply({
                            content:
                                '❌ تعذر تغيير اسم البوت في هذا السيرفر.',
                            ephemeral: true
                        });
                    }
                }

                if (
                    interaction.commandName ===
                    'bot-avatar'
                ) {
                    const attachment =
                        interaction.options
                            .getAttachment(
                                'image',
                                true
                            );

                    const allowedTypes = [
                        'image/png',
                        'image/jpeg',
                        'image/jpg',
                        'image/webp',
                        'image/gif'
                    ];

                    if (
                        attachment.contentType &&
                        !allowedTypes.includes(
                            attachment.contentType
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ يجب اختيار صورة بصيغة PNG أو JPG أو WEBP أو GIF.',
                            ephemeral: true
                        });
                    }

                    if (
                        attachment.size >
                        10 *
                        1024 *
                        1024
                    ) {
                        return interaction.reply({
                            content:
                                '❌ حجم الصورة كبير جداً. الحد الأقصى 10MB.',
                            ephemeral: true
                        });
                    }

                    try {
                        const me =
                            interaction.guild.members.me ||
                            await interaction.guild.members
                                .fetch(
                                    client.user.id
                                );

                        await me.edit({
                            avatar:
                                attachment.url
                        });

                        return interaction.reply({
                            content:
                                '✅ تم تغيير صورة البوت في هذا السيرفر فقط.',
                            ephemeral: true
                        });
                    } catch (error) {
                        console.error(
                            '❌ Bot Avatar Error:',
                            error
                        );

                        return interaction.reply({
                            content:
                                '❌ تعذر تغيير صورة البوت في هذا السيرفر.',
                            ephemeral: true
                        });
                    }
                }

                if (
                    interaction.commandName ===
                    'bot-banner'
                ) {
                    const attachment =
                        interaction.options
                            .getAttachment(
                                'image',
                                true
                            );

                    const allowedTypes = [
                        'image/png',
                        'image/jpeg',
                        'image/jpg',
                        'image/webp',
                        'image/gif'
                    ];

                    if (
                        attachment.contentType &&
                        !allowedTypes.includes(
                            attachment.contentType
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ يجب اختيار صورة بصيغة PNG أو JPG أو WEBP أو GIF.',
                            ephemeral: true
                        });
                    }

                    if (
                        attachment.size >
                        10 *
                        1024 *
                        1024
                    ) {
                        return interaction.reply({
                            content:
                                '❌ حجم الصورة كبير جداً. الحد الأقصى 10MB.',
                            ephemeral: true
                        });
                    }

                    try {
                        const me =
                            interaction.guild.members.me ||
                            await interaction.guild.members
                                .fetch(
                                    client.user.id
                                );

                        await me.edit({
                            banner:
                                attachment.url
                        });

                        return interaction.reply({
                            content:
                                '✅ تم تغيير بنر البوت في هذا السيرفر فقط.',
                            ephemeral: true
                        });
                    } catch (error) {
                        console.error(
                            '❌ Bot Banner Error:',
                            error
                        );

                        return interaction.reply({
                            content:
                                '❌ تعذر تغيير بنر البوت في هذا السيرفر.',
                            ephemeral: true
                        });
                    }
                }
            }

            /*
            =========================================================
            BUTTONS
            =========================================================
            */

            if (
                interaction.isButton()
            ) {
                const customId =
                    interaction.customId;

                if (
                    customId.startsWith(
                        'reward_accept_'
                    )
                ) {
                    const rewardId =
                        customId.replace(
                            'reward_accept_',
                            ''
                        );

                    const reward =
                        pendingRewards.get(
                            rewardId
                        );

                    if (
                        !reward
                    ) {
                        return interaction.reply({
                            content:
                                '❌ إشعار المكافأة انتهى أو تم استلامه مسبقاً.',
                            ephemeral: true
                        });
                    }

                    if (
                        interaction.user.id !==
                        reward.targetId
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الإشعار ليس مخصصاً لك.',
                            ephemeral: true
                        });
                    }

                    const db =
                        loadDB();

                    const rewardUser =
                        ensureUser(
                            db,
                            reward.guildId,
                            reward.targetId
                        );

                    rewardUser.balance +=
                        reward.amount;

                    saveDB(
                        db
                    );

                    pendingRewards.delete(
                        rewardId
                    );

                    const currencyName =
                        getCurrencyName(
                            reward.guildId
                        );

                    const receivedEmbed =
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setTitle(
                                '📨 تم استلام المكافأة'
                            )
                            .setDescription(
                                `تمت إضافة **${formatAmount(
                                    reward.amount
                                )} ${currencyName}** إلى رصيدك بنجاح.\n\n**السبب :** ${reward.reason}\n**رصيدك الحالي :** ${formatAmount(
                                    rewardUser.balance
                                )} ${currencyName}`
                            )
                            .setTimestamp();

                    return interaction.update({
                        embeds: [
                            receivedEmbed
                        ],
                        components: []
                    });
                }

                if (
                    customId.startsWith(
                        'reward_decline_'
                    )
                ) {
                    const rewardId =
                        customId.replace(
                            'reward_decline_',
                            ''
                        );

                    const reward =
                        pendingRewards.get(
                            rewardId
                        );

                    if (
                        !reward
                    ) {
                        return interaction.reply({
                            content:
                                '❌ إشعار المكافأة انتهى أو تم استلامه مسبقاً.',
                            ephemeral: true
                        });
                    }

                    if (
                        interaction.user.id !==
                        reward.targetId
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الإشعار ليس مخصصاً لك.',
                            ephemeral: true
                        });
                    }

                    pendingRewards.delete(
                        rewardId
                    );

                    return interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ تم رفض المكافأة.'
                                )
                        ],
                        components: []
                    });
                }

                /*
                =========================================================
                TRANSFER CONFIRM
                =========================================================
                */

                if (
                    customId.startsWith(
                        'transfer_confirm_'
                    )
                ) {
                    const senderId =
                        customId.replace(
                            'transfer_confirm_',
                            ''
                        );

                    if (
                        interaction.user.id !==
                        senderId
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الزر ليس مخصصاً لك.',
                            ephemeral: true
                        });
                    }

                    const transfer =
                        pendingTransfers.get(
                            getTransferKey(
                                interaction.guild.id,
                                senderId
                            )
                        );

                    if (
                        !transfer
                    ) {
                        return interaction.reply({
                            content:
                                '❌ عملية التحويل انتهت أو غير موجودة.',
                            ephemeral: true
                        });
                    }

                    const db =
                        loadDB();

                    const senderData =
                        ensureUser(
                            db,
                            interaction.guild.id,
                            senderId
                        );

                    const targetData =
                        ensureUser(
                            db,
                            interaction.guild.id,
                            transfer.targetId
                        );

                    if (
                        senderData.balance <
                        transfer.amount
                    ) {
                        pendingTransfers.delete(
                            getTransferKey(
                                interaction.guild.id,
                                senderId
                            )
                        );

                        return interaction.reply({
                            content:
                                '❌ لم يعد لديك رصيد كافٍ لإتمام العملية.',
                            ephemeral: true
                        });
                    }

                    senderData.balance -=
                        transfer.amount;

                    targetData.balance +=
                        transfer.amount;

                    saveDB(
                        db
                    );

                    pendingTransfers.delete(
                        getTransferKey(
                            interaction.guild.id,
                            senderId
                        )
                    );

                    if (
                        transfer.timeout
                    ) {
                        clearTimeout(
                            transfer.timeout
                        );
                    }

                    return interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    `✅ تم التحويل بنجاح بقيمة **${formatAmount(
                                        transfer.amount
                                    )} ${getCurrencyName(
                                        interaction.guild.id
                                    )}**.`
                                )
                        ],
                        components: []
                    });
                }

                /*
                =========================================================
                TRANSFER CANCEL
                =========================================================
                */

                if (
                    customId.startsWith(
                        'transfer_cancel_'
                    )
                ) {
                    const senderId =
                        customId.replace(
                            'transfer_cancel_',
                            ''
                        );

                    if (
                        interaction.user.id !==
                        senderId
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الزر ليس مخصصاً لك.',
                            ephemeral: true
                        });
                    }

                    const transfer =
                        pendingTransfers.get(
                            getTransferKey(
                                interaction.guild.id,
                                senderId
                            )
                        );

                    if (
                        !transfer
                    ) {
                        return interaction.reply({
                            content:
                                '❌ عملية التحويل انتهت أو غير موجودة.',
                            ephemeral: true
                        });
                    }

                    if (
                        transfer.timeout
                    ) {
                        clearTimeout(
                            transfer.timeout
                        );
                    }

                    pendingTransfers.delete(
                        getTransferKey(
                            interaction.guild.id,
                            senderId
                        )
                    );

                    return interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setDescription(
                                    '❌ تم إلغاء عملية التحويل.'
                                )
                        ],
                        components: []
                    });
                }
            }

            /*
            =========================================================
            MODALS
            =========================================================
            */

            if (
                interaction.isModalSubmit()
            ) {
                if (
                    interaction.customId ===
                    'currency_modal'
                ) {
                    if (
                        !interaction.guild
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الأمر يعمل داخل السيرفر فقط.',
                            ephemeral: true
                        });
                    }

                    const name =
                        interaction.fields
                            .getTextInputValue(
                                'currency_name'
                            )
                            .trim();

                    if (
                        !name
                    ) {
                        return interaction.reply({
                            content:
                                '❌ اسم العملة غير صحيح.',
                            ephemeral: true
                        });
                    }

                    const db =
                        loadDB();

                    const config =
                        ensureGuildConfig(
                            db,
                            interaction.guild.id
                        );

                    config.currencyName =
                        name;

                    saveDB(
                        db
                    );

                    return interaction.reply({
                        content:
                            `✅ تم تغيير اسم العملة إلى **${name}** في هذا السيرفر فقط.`,
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId ===
                    'reward_modal'
                ) {
                    const targetUser =
                        interaction.fields
                            .getTextInputValue(
                                'target_user'
                            )
                            .trim();

                    const amountText =
                        interaction.fields
                            .getTextInputValue(
                                'reward_amount'
                            )
                            .trim();

                    const reason =
                        interaction.fields
                            .getTextInputValue(
                                'reward_reason'
                            )
                            .trim();

                    const amount =
                        parseAmount(
                            amountText
                        );

                    if (
                        !/^\d{17,20}$/.test(
                            targetUser
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ آيدي العضو غير صحيح.',
                            ephemeral: true
                        });
                    }

                    if (
                        !Number.isFinite(
                            amount
                        ) ||
                        amount <= 0
                    ) {
                        return interaction.reply({
                            content:
                                '❌ مبلغ المكافأة غير صحيح.',
                            ephemeral: true
                        });
                    }

                    const member =
                        await interaction.guild.members
                            .fetch(
                                targetUser
                            )
                            .catch(
                                () => null
                            );

                    if (
                        !member
                    ) {
                        return interaction.reply({
                            content:
                                '❌ لم يتم العثور على العضو داخل السيرفر.',
                            ephemeral: true
                        });
                    }

                    const rewardId =
                        `${interaction.guild.id}_${targetUser}_${Date.now()}_${Math.floor(
                            Math.random() *
                            100000
                        )}`;

                    pendingRewards.set(
                        rewardId,
                        {
                            guildId:
                                interaction.guild.id,
                            targetId:
                                targetUser,
                            amount,
                            reason:
                                reason ||
                                'بدون سبب'
                        }
                    );

                    const currencyName =
                        getCurrencyName(
                            interaction.guild.id
                        );

                    const row =
                        new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(
                                        `reward_accept_${rewardId}`
                                    )
                                    .setLabel(
                                        'استلام'
                                    )
                                    .setStyle(
                                        ButtonStyle.Success
                                    ),
                                new ButtonBuilder()
                                    .setCustomId(
                                        `reward_decline_${rewardId}`
                                    )
                                    .setLabel(
                                        'رفض'
                                    )
                                    .setStyle(
                                        ButtonStyle.Danger
                                    )
                            );

                    await interaction.reply({
                        content:
                            `<@${targetUser}>`,
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setTitle(
                                    '📨 مكافأة جديدة'
                                )
                                .setDescription(
                                    `لديك مكافأة بقيمة **${formatAmount(
                                        amount
                                    )} ${currencyName}**.\n\n**السبب:** ${reason || 'بدون سبب'}\n\nاضغط على **استلام** لإضافة المبلغ إلى رصيدك.`
                                )
                        ],
                        components: [
                            row
                        ]
                    });

                    return;
                }
            }
        } catch (error) {
            console.error(
                '❌ Interaction Error:',
                error
            );

            if (
                interaction.replied ||
                interaction.deferred
            ) {
                return interaction.followUp({
                    content:
                        '❌ حدث خطأ غير متوقع.',
                    ephemeral: true
                }).catch(
                    () => {}
                );
            }

            return interaction.reply({
                content:
                    '❌ حدث خطأ غير متوقع.',
                ephemeral: true
            }).catch(
                () => {}
            );
        }
    }
);

client.on(
    'error',
    error => {
        console.error(
            '❌ Discord Client Error:',
            error
        );
    }
);

process.on(
    'unhandledRejection',
    error => {
        console.error(
            '❌ Unhandled Rejection:',
            error
        );
    }
);

process.on(
    'uncaughtException',
    error => {
        console.error(
            '❌ Uncaught Exception:',
            error
        );
    }
);

client.login(
    TOKEN
);