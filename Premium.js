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

// =========================================================
// PERSISTENT DATABASE
// =========================================================
// يمكن في Railway وضع DB_FILE=/data/economy.json بعد ربط Volume
// وبهذا تبقى العملات والرومات والتوب محفوظة حتى بعد إعادة التشغيل/النشر.
const DB_FILE = process.env.DB_FILE || './economy.json';
const DB_BACKUP_FILE = `${DB_FILE}.backup`;
const DB_TEMP_FILE = `${DB_FILE}.tmp`;

function ensureDBDirectory() {
    const dir = path.dirname(DB_FILE);
    if (dir && dir !== '.') {
        fs.mkdirSync(dir, { recursive: true });
    }
}

ensureDBDirectory();

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
    ensureDBDirectory();

    try {
        if (!fs.existsSync(DB_FILE)) {
            if (fs.existsSync(DB_BACKUP_FILE)) {
                fs.copyFileSync(DB_BACKUP_FILE, DB_FILE);
            } else {
                fs.writeFileSync(DB_FILE, JSON.stringify({ guildSettings: {}, users: {} }, null, 2), 'utf8');
            }
        }

        const raw = fs.readFileSync(DB_FILE, 'utf8').trim();
        if (!raw) {
            return { guildSettings: {}, users: {} };
        }

        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('قاعدة البيانات ليست بصيغة صحيحة.');
        }

        if (!data.guildSettings || typeof data.guildSettings !== 'object') {
            data.guildSettings = {};
        }
        if (!data.users || typeof data.users !== 'object') {
            data.users = {};
        }

        return data;
    } catch (error) {
        console.error('❌ تعذر قراءة قاعدة البيانات:', error.message);

        try {
            if (fs.existsSync(DB_BACKUP_FILE)) {
                const backupRaw = fs.readFileSync(DB_BACKUP_FILE, 'utf8');
                const backupData = JSON.parse(backupRaw);
                if (backupData && typeof backupData === 'object') {
                    console.log('♻️ تم استرجاع قاعدة البيانات من النسخة الاحتياطية.');
                    return backupData;
                }
            }
        } catch (backupError) {
            console.error('❌ تعذر استرجاع النسخة الاحتياطية:', backupError.message);
        }

        return { guildSettings: {}, users: {} };
    }
}

function saveDB(data) {
    ensureDBDirectory();

    try {
        const json = JSON.stringify(data, null, 2);

        // الكتابة إلى ملف مؤقت أولاً تمنع تلف قاعدة البيانات إذا انقطع البوت أثناء الحفظ.
        fs.writeFileSync(DB_TEMP_FILE, json, 'utf8');

        // الاحتفاظ بآخر نسخة سليمة كنسخة احتياطية.
        if (fs.existsSync(DB_FILE)) {
            fs.copyFileSync(DB_FILE, DB_BACKUP_FILE);
        }

        // استبدال الملف القديم بالنسخة الجديدة بشكل ذري قدر الإمكان.
        fs.renameSync(DB_TEMP_FILE, DB_FILE);
    } catch (error) {
        console.error('❌ تعذر حفظ قاعدة البيانات:', error.message);

        try {
            if (fs.existsSync(DB_TEMP_FILE)) {
                fs.unlinkSync(DB_TEMP_FILE);
            }
        } catch (_) {}
    }
}

function getGuildConfig(guildId) {
    const db = loadDB();
    const before = JSON.stringify(db.guildSettings?.[guildId] || null);
    const config = ensureGuildConfig(db, guildId);
    const after = JSON.stringify(config);

    if (before !== after) {
        saveDB(db);
    }

    return config;
}

function getCurrencyName(guildId) {
    return getGuildConfig(guildId).currencyName;
}

function ensureUser(db, userId) {
    if (!db[userId]) {
        db[userId] = {
            balance: 0,
            lastDaily: 0
        };
    }

    if (typeof db[userId].balance !== 'number') {
        db[userId].balance =
            Number(db[userId].balance) || 0;
    }

    if (typeof db[userId].lastDaily !== 'number') {
        db[userId].lastDaily =
            Number(db[userId].lastDaily) || 0;
    }
}

function parseAmount(value) {
    if (!value) return NaN;

    const text = String(value)
        .trim()
        .toLowerCase()
        .replace(/,/g, '');

    const match =
        text.match(/^(\d+(?:\.\d+)?)([kmbt])?$/);

    if (!match) return NaN;

    const number = Number(match[1]);
    const suffix = match[2] || '';

    const multipliers = {
        k: 1000,
        m: 1000000,
        b: 1000000000,
        t: 1000000000000
    };

    const amount =
        number * (multipliers[suffix] || 1);

    if (!Number.isFinite(amount)) {
        return NaN;
    }

    return Math.floor(amount);
}

function formatAmount(amount) {
    amount = Number(amount) || 0;

    if (amount < 1000) {
        return String(amount);
    }

    const units = [
        {
            value: 1000000000000,
            suffix: 't'
        },
        {
            value: 1000000000,
            suffix: 'b'
        },
        {
            value: 1000000,
            suffix: 'm'
        },
        {
            value: 1000,
            suffix: 'k'
        }
    ];

    for (const unit of units) {
        if (amount >= unit.value) {
            const result =
                amount / unit.value;

            if (Number.isInteger(result)) {
                return `${result}${unit.suffix}`;
            }

            return `${Number(
                result.toFixed(2)
            )}${unit.suffix}`;
        }
    }

    return String(amount);
}

const pendingTransfers = new Map();
const pendingRewards = new Map();

const slashCommands = [
    new SlashCommandBuilder()
        .setName('currency')
        .setDescription('تغيير اسم العملة داخل هذا السيرفر')
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('اسم العملة الجديد')
                .setRequired(true)
                .setMaxLength(20)
        ),

    new SlashCommandBuilder()
        .setName('economy-room')
        .setDescription('تفعيل أو تعطيل روم لأوامر العملة')
        .addSubcommand(sub =>
            sub
                .setName('add')
                .setDescription('تفعيل روم للعملة')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('الروم الذي ستعمل فيه أوامر العملة')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('تعطيل روم للعملة')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('الروم الذي تريد تعطيله')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('عرض رومات العملة المفعلة')
        ),

    new SlashCommandBuilder()
        .setName('bot-name')
        .setDescription('تغيير اسم البوت في هذا السيرفر فقط'),

    new SlashCommandBuilder()
        .setName('bot-avatar')
        .setDescription('تغيير صورة البوت في هذا السيرفر فقط')
        .addAttachmentOption(option =>
            option
                .setName('image')
                .setDescription('اختر صورة البوت من جهازك')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('bot-banner')
        .setDescription('تغيير بنر البوت في هذا السيرفر فقط')
        .addAttachmentOption(option =>
            option
                .setName('image')
                .setDescription('اختر صورة البنر من جهازك')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('rest')
        .setDescription('إرجاع اسم وصورة وبنر البوت للوضع الأساسي في هذا السيرفر فقط'),

    new SlashCommandBuilder()
        .setName('give')
        .setDescription('إضافة عملة إلى رصيد عضو')
        .addUserOption(option =>
            option
                .setName('member')
                .setDescription('العضو')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('amount')
                .setDescription('المبلغ مثل 20k أو 2m')
                .setRequired(true)
                .setMaxLength(30)
        ),

    new SlashCommandBuilder()
        .setName('withdraw')
        .setDescription('سحب عملة من رصيد عضو')
        .addUserOption(option =>
            option
                .setName('member')
                .setDescription('العضو')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('amount')
                .setDescription('المبلغ أو نص أو كامل')
                .setRequired(true)
                .setMaxLength(30)
        )
].map(command => command.toJSON());

async function registerSlashCommands() {
    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.commands.set(slashCommands);

            console.log(
                `✅ تم تسجيل أوامر السلاش في: ${guild.name}`
            );
        } catch (error) {
            console.error(
                `❌ فشل تسجيل أوامر السلاش في ${guild.name}:`,
                error
            );
        }
    }
}

function ensureGuildConfig(db, guildId) {
    if (!db.guildSettings) {
        db.guildSettings = {};
    }

    if (!db.guildSettings[guildId]) {
        db.guildSettings[guildId] = {
            currencyName: DEFAULT_CURRENCY_NAME,
            economyChannels: [],
            customBotName: null,
            customBotAvatar: null,
            customBotBanner: null
        };
    }

    const config = db.guildSettings[guildId];

    if (typeof config.currencyName !== 'string' || !config.currencyName.trim()) {
        config.currencyName = DEFAULT_CURRENCY_NAME;
    }

    if (!Array.isArray(config.economyChannels)) {
        config.economyChannels = [];
    }

    if (!Object.prototype.hasOwnProperty.call(config, 'customBotName')) {
        config.customBotName = null;
    }

    if (!Object.prototype.hasOwnProperty.call(config, 'customBotAvatar')) {
        config.customBotAvatar = null;
    }

    if (!Object.prototype.hasOwnProperty.call(config, 'customBotBanner')) {
        config.customBotBanner = null;
    }

    return config;
}

function isAdmin(member) {
    if (!member) return false;

    return (
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        member.permissions.has(PermissionFlagsBits.ManageGuild)
    );
}

function isEconomyChannel(guildId, channelId) {
    const config = getGuildConfig(guildId);

    return config.economyChannels.includes(channelId);
}

function getGuildUsers(db, guildId) {
    if (!db.users) {
        db.users = {};
    }

    if (!db.users[guildId]) {
        db.users[guildId] = {};
    }

    return db.users[guildId];
}

function ensureGuildUser(db, guildId, userId) {
    const users = getGuildUsers(db, guildId);

    if (!users[userId]) {
        users[userId] = {
            balance: 0,
            lastDaily: 0
        };
    }

    if (typeof users[userId].balance !== 'number') {
        users[userId].balance =
            Number(users[userId].balance) || 0;
    }

    if (typeof users[userId].lastDaily !== 'number') {
        users[userId].lastDaily =
            Number(users[userId].lastDaily) || 0;
    }

    return users[userId];
}

function getTopUsers(db, guildId) {
    const users = getGuildUsers(db, guildId);

    return Object.entries(users)
        .filter(([, data]) =>
            data &&
            Number.isFinite(Number(data.balance))
        )
        .sort(
            (a, b) =>
                Number(b[1].balance) -
                Number(a[1].balance)
        );
}

function createTopEmbed(guild, db) {
    const currencyName =
        getCurrencyName(guild.id);

    const topUsers =
        getTopUsers(db, guild.id).slice(0, 10);

    const description =
        topUsers.length
            ? topUsers
                .map(
                    ([userId, data], index) =>
                        `**${index + 1}.** <@${userId}> — **${formatAmount(data.balance)} ${currencyName}**`
                )
                .join('\n')
            : 'لا يوجد أي رصيد مسجل حتى الآن.';

    return new EmbedBuilder()
        .setColor('#D4AC0D')
        .setTitle('🏆 توب العملات')
        .setDescription(description)
        .setFooter({
            text: guild.name
        })
        .setTimestamp();
}

function getMemberBalance(db, guildId, userId) {
    const user =
        ensureGuildUser(
            db,
            guildId,
            userId
        );

    return Number(user.balance) || 0;
}

function setMemberBalance(
    db,
    guildId,
    userId,
    amount
) {
    const user =
        ensureGuildUser(
            db,
            guildId,
            userId
        );

    user.balance =
        Math.max(
            0,
            Math.floor(
                Number(amount) || 0
            )
        );
}

function addMemberBalance(
    db,
    guildId,
    userId,
    amount
) {
    const current =
        getMemberBalance(
            db,
            guildId,
            userId
        );

    setMemberBalance(
        db,
        guildId,
        userId,
        current + amount
    );
}

function removeMemberBalance(
    db,
    guildId,
    userId,
    amount
) {
    const current =
        getMemberBalance(
            db,
            guildId,
            userId
        );

    setMemberBalance(
        db,
        guildId,
        userId,
        current - amount
    );
}

function getDisplayName(member) {
    return (
        member?.displayName ||
        member?.user?.username ||
        'عضو'
    );
}

function getUserMention(userId) {
    return `<@${userId}>`;
}

function makeButton(
    customId,
    label,
    style = ButtonStyle.Secondary
) {
    return new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style);
}

function buildEconomyButtons() {
    return new ActionRowBuilder()
        .addComponents(
            makeButton(
                'economy_balance',
                '💰 الرصيد',
                ButtonStyle.Secondary
            ),
            makeButton(
                'economy_daily',
                '🎁 يومي',
                ButtonStyle.Success
            ),
            makeButton(
                'economy_top',
                '🏆 التوب',
                ButtonStyle.Primary
            ),
            makeButton(
                'economy_transfer',
                '💸 تحويل',
                ButtonStyle.Secondary
            )
        );
}

function buildTransferModal() {
    const modal =
        new ModalBuilder()
            .setCustomId(
                'transfer_modal'
            )
            .setTitle(
                '💸 تحويل عملة'
            );

    const userInput =
        new TextInputBuilder()
            .setCustomId(
                'transfer_user'
            )
            .setLabel(
                'ايدي العضو'
            )
            .setPlaceholder(
                'ضع ايدي العضو هنا'
            )
            .setStyle(
                TextInputStyle.Short
            )
            .setRequired(
                true
            )
            .setMaxLength(
                30
            );

    const amountInput =
        new TextInputBuilder()
            .setCustomId(
                'transfer_amount'
            )
            .setLabel(
                'المبلغ'
            )
            .setPlaceholder(
                'مثال: 20k أو 2m'
            )
            .setStyle(
                TextInputStyle.Short
            )
            .setRequired(
                true
            )
            .setMaxLength(
                30
            );

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(
                userInput
            ),
        new ActionRowBuilder()
            .addComponents(
                amountInput
            )
    );

    return modal;
}

function buildGiveModal() {
    const modal =
        new ModalBuilder()
            .setCustomId(
                'give_modal'
            )
            .setTitle(
                '💰 إضافة عملة'
            );

    const userInput =
        new TextInputBuilder()
            .setCustomId(
                'give_user'
            )
            .setLabel(
                'ايدي العضو'
            )
            .setPlaceholder(
                'ضع ايدي العضو هنا'
            )
            .setStyle(
                TextInputStyle.Short
            )
            .setRequired(
                true
            )
            .setMaxLength(
                30
            );

    const amountInput =
        new TextInputBuilder()
            .setCustomId(
                'give_amount'
            )
            .setLabel(
                'المبلغ'
            )
            .setPlaceholder(
                'مثال: 20k أو 2m'
            )
            .setStyle(
                TextInputStyle.Short
            )
            .setRequired(
                true
            )
            .setMaxLength(
                30
            );

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(
                userInput
            ),
        new ActionRowBuilder()
            .addComponents(
                amountInput
            )
    );

    return modal;
}

function buildWithdrawModal() {
    const modal =
        new ModalBuilder()
            .setCustomId(
                'withdraw_modal'
            )
            .setTitle(
                '💸 سحب عملة'
            );

    const userInput =
        new TextInputBuilder()
            .setCustomId(
                'withdraw_user'
            )
            .setLabel(
                'ايدي العضو'
            )
            .setPlaceholder(
                'ضع ايدي العضو هنا'
            )
            .setStyle(
                TextInputStyle.Short
            )
            .setRequired(
                true
            )
            .setMaxLength(
                30
            );

    const amountInput =
        new TextInputBuilder()
            .setCustomId(
                'withdraw_amount'
            )
            .setLabel(
                'المبلغ'
            )
            .setPlaceholder(
                'مثال: 20k أو كامل'
            )
            .setStyle(
                TextInputStyle.Short
            )
            .setRequired(
                true
            )
            .setMaxLength(
                30
            );

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(
                userInput
            ),
        new ActionRowBuilder()
            .addComponents(
                amountInput
            )
    );

    return modal;
}

function buildMassSummonModal(guildId) {
    const modal =
        new ModalBuilder()
            .setCustomId(
                `mass_summon_modal_${guildId}`
            )
            .setTitle(
                '📩 إشعار استدعاء'
            );

    const destinationInput =
        new TextInputBuilder()
            .setCustomId(
                'mass_summon_destination'
            )
            .setLabel(
                'التوجه'
            )
            .setPlaceholder(
                'اكتب ايدي الروم أو لينك الروم هنا...'
            )
            .setStyle(
                TextInputStyle.Short
            )
            .setRequired(
                true
            )
            .setMaxLength(
                200
            );

    const reasonInput =
        new TextInputBuilder()
            .setCustomId(
                'mass_summon_reason'
            )
            .setLabel(
                'السبب'
            )
            .setPlaceholder(
                'اكتب سبب الاستدعاء هنا...'
            )
            .setStyle(
                TextInputStyle.Paragraph
            )
            .setRequired(
                true
            )
            .setMaxLength(
                1000
            );

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(
                destinationInput
            ),
        new ActionRowBuilder()
            .addComponents(
                reasonInput
            )
    );

    return modal;
}

function getPremiumMember(member) {
    if (!member) return false;

    return member.roles.cache.has(
        PREMIUM_ROLE_ID
    );
}

function getMassSummonMember(member) {
    if (!member) return false;

    return (
        member.roles.cache.has(
            MASS_SUMMON_ROLE_ID
        ) ||
        member.permissions.has(
            PermissionFlagsBits.Administrator
        )
    );
}

function cleanText(text, max = 1000) {
    return String(text || '')
        .replace(/@everyone/gi, '@\u200beveryone')
        .replace(/@here/gi, '@\u200bhere')
        .slice(0, max);
}

async function sendRequestMessage(guild, message) {
    try {
        const channel =
            guild.channels.cache.get(
                REQUEST_CHANNEL_ID
            );

        if (!channel || !channel.isTextBased()) {
            return false;
        }

        await channel.send({
            content: message
        });

        return true;
    } catch (error) {
        console.error(
            '❌ تعذر إرسال الطلب:',
            error
        );

        return false;
    }
}

client.once(
    'ready',
    async () => {
        console.log(
            `✅ تم تسجيل الدخول باسم ${client.user.tag}`
        );

        await registerSlashCommands();

        client.user.setPresence({
            activities: [
                {
                    name: 'نظام العملات',
                    type: 0
                }
            ],
            status: 'online'
        });
    }
);

client.on(
    'guildCreate',
    async guild => {
        try {
            const db = loadDB();

            ensureGuildConfig(
                db,
                guild.id
            );

            saveDB(db);

            await guild.commands.set(
                slashCommands
            );
        } catch (error) {
            console.error(
                '❌ خطأ عند دخول سيرفر جديد:',
                error
            );
        }
    }
);

client.on(
    'messageCreate',
    async message => {
        try {
            if (
                message.author.bot ||
                !message.guild
            ) {
                return;
            }

            if (
                !isEconomyChannel(
                    message.guild.id,
                    message.channel.id
                )
            ) {
                return;
            }

            const content =
                message.content.trim();

            if (!content) return;

            const parts =
                content.split(/\s+/);

            const command =
                parts[0].toLowerCase();

            const db =
                loadDB();

            ensureGuildUser(
                db,
                message.guild.id,
                message.author.id
            );

            if (
                command === 'رصيدي' ||
                command === 'رصيد' ||
                command === 'balance'
            ) {
                const balance =
                    getMemberBalance(
                        db,
                        message.guild.id,
                        message.author.id
                    );

                const currencyName =
                    getCurrencyName(
                        message.guild.id
                    );

                await message.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setTitle(
                                '💰 رصيدك'
                            )
                            .setDescription(
                                `رصيدك الحالي هو **${formatAmount(balance)} ${currencyName}**`
                            )
                    ]
                });

                saveDB(db);
                return;
            }

            if (
                command === 'توب' ||
                command === 'top'
            ) {
                await message.reply({
                    embeds: [
                        createTopEmbed(
                            message.guild,
                            db
                        )
                    ]
                });

                saveDB(db);
                return;
            }

            if (
                command === 'يومي' ||
                command === 'daily'
            ) {
                const user =
                    ensureGuildUser(
                        db,
                        message.guild.id,
                        message.author.id
                    );

                const now =
                    Date.now();

                const cooldown =
                    24 * 60 * 60 * 1000;

                if (
                    now -
                    user.lastDaily <
                    cooldown
                ) {
                    const remaining =
                        cooldown -
                        (
                            now -
                            user.lastDaily
                        );

                    const hours =
                        Math.ceil(
                            remaining /
                            (60 * 60 * 1000)
                        );

                    return message.reply({
                        content:
                            `⏳ يمكنك استلام اليومي بعد **${hours} ساعة**.`
                    });
                }

                const reward =
                    Math.floor(
                        Math.random() *
                        5000
                    ) + 1000;

                user.balance +=
                    reward;

                user.lastDaily =
                    now;

                saveDB(db);

                const currencyName =
                    getCurrencyName(
                        message.guild.id
                    );

                await message.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setTitle(
                                '🎁 المكافأة اليومية'
                            )
                            .setDescription(
                                `تم إضافة **${formatAmount(reward)} ${currencyName}** إلى رصيدك.`
                            )
                    ]
                });

                return;
            }

            if (
                command === 'تحويل' ||
                command === 'تحويل_عملة' ||
                command === 'transfer'
            ) {
                if (!parts[1] || !parts[2]) {
                    return message.reply({
                        content:
                            '❌ الاستخدام: `تحويل @العضو المبلغ`'
                    });
                }

                const mentioned =
                    message.mentions.users.first();

                const targetId =
                    mentioned?.id ||
                    parts[1].replace(/[<@!>]/g, '');

                if (
                    !/^\d{17,20}$/.test(
                        targetId
                    )
                ) {
                    return message.reply({
                        content:
                            '❌ ايدي العضو غير صحيح.'
                    });
                }

                if (
                    targetId ===
                    message.author.id
                ) {
                    return message.reply({
                        content:
                            '❌ لا يمكنك التحويل لنفسك.'
                    });
                }

                const amount =
                    parseAmount(
                        parts[2]
                    );

                if (
                    !Number.isFinite(
                        amount
                    ) ||
                    amount <= 0
                ) {
                    return message.reply({
                        content:
                            '❌ المبلغ غير صحيح.'
                    });
                }

                const balance =
                    getMemberBalance(
                        db,
                        message.guild.id,
                        message.author.id
                    );

                if (
                    balance <
                    amount
                ) {
                    return message.reply({
                        content:
                            '❌ رصيدك لا يكفي.'
                    });
                }

                pendingTransfers.set(
                    message.author.id,
                    {
                        guildId:
                            message.guild.id,
                        targetId,
                        amount,
                        code: null,
                        createdAt:
                            Date.now()
                    }
                );

                const currencyName =
                    getCurrencyName(
                        message.guild.id
                    );

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            makeButton(
                                `verify_transfer_${message.author.id}_${targetId}_${amount}`,
                                'تأكيد التحويل',
                                ButtonStyle.Success
                            ),
                            makeButton(
                                `cancel_transfer_${message.author.id}`,
                                'إلغاء',
                                ButtonStyle.Danger
                            )
                        );

                await message.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setTitle(
                                '💸 تأكيد التحويل'
                            )
                            .setDescription(
                                `هل تريد تحويل **${formatAmount(amount)} ${currencyName}** إلى <@${targetId}>؟`
                            )
                    ],
                    components: [
                        row
                    ]
                });

                saveDB(db);
                return;
            }

            if (
                command === 'مكافأة' ||
                command === 'مكافاه' ||
                command === 'give'
            ) {
                if (
                    !isAdmin(
                        message.member
                    )
                ) {
                    return;
                }

                const mentioned =
                    message.mentions.users.first();

                if (
                    !mentioned ||
                    !parts[2]
                ) {
                    return message.reply({
                        content:
                            '❌ الاستخدام: `مكافأة @العضو المبلغ`'
                    });
                }

                const amount =
                    parseAmount(
                        parts[2]
                    );

                if (
                    !Number.isFinite(
                        amount
                    ) ||
                    amount <= 0
                ) {
                    return message.reply({
                        content:
                            '❌ المبلغ غير صحيح.'
                    });
                }

                addMemberBalance(
                    db,
                    message.guild.id,
                    mentioned.id,
                    amount
                );

                saveDB(db);

                const currencyName =
                    getCurrencyName(
                        message.guild.id
                    );

                await message.reply({
                    content:
                        `✅ تم إضافة **${formatAmount(amount)} ${currencyName}** إلى رصيد ${mentioned}.`
                });

                return;
            }

            if (
                command === 'سحب' ||
                command === 'withdraw'
            ) {
                if (
                    !isAdmin(
                        message.member
                    )
                ) {
                    return;
                }

                const mentioned =
                    message.mentions.users.first();

                if (
                    !mentioned ||
                    !parts[2]
                ) {
                    return message.reply({
                        content:
                            '❌ الاستخدام: `سحب @العضو المبلغ`'
                    });
                }

                let amount;

                if (
                    parts[2] === 'كامل' ||
                    parts[2].toLowerCase() === 'all'
                ) {
                    amount =
                        getMemberBalance(
                            db,
                            message.guild.id,
                            mentioned.id
                        );
                } else {
                    amount =
                        parseAmount(
                            parts[2]
                        );
                }

                if (
                    !Number.isFinite(
                        amount
                    ) ||
                    amount <= 0
                ) {
                    return message.reply({
                        content:
                            '❌ المبلغ غير صحيح.'
                    });
                }

                const current =
                    getMemberBalance(
                        db,
                        message.guild.id,
                        mentioned.id
                    );

                if (
                    current <
                    amount
                ) {
                    return message.reply({
                        content:
                            '❌ رصيد العضو لا يكفي.'
                    });
                }

                removeMemberBalance(
                    db,
                    message.guild.id,
                    mentioned.id,
                    amount
                );

                saveDB(db);

                const currencyName =
                    getCurrencyName(
                        message.guild.id
                    );

                await message.reply({
                    content:
                        `✅ تم سحب **${formatAmount(amount)} ${currencyName}** من رصيد ${mentioned}.`
                });

                return;
            }

            if (
                command === 'نقاط' ||
                command === 'points'
            ) {
                const balance =
                    getMemberBalance(
                        db,
                        message.guild.id,
                        message.author.id
                    );

                const currencyName =
                    getCurrencyName(
                        message.guild.id
                    );

                await message.reply({
                    content:
                        `💰 رصيدك: **${formatAmount(balance)} ${currencyName}**`
                });

                saveDB(db);
                return;
            }

            if (
                command === 'help' ||
                command === 'مساعدة'
            ) {
                const currencyName =
                    getCurrencyName(
                        message.guild.id
                    );

                await message.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setTitle(
                                '📚 أوامر العملات'
                            )
                            .setDescription(
                                [
                                    `**رصيد** — عرض رصيدك`,
                                    `**يومي** — استلام المكافأة اليومية`,
                                    `**توب** — عرض أعلى الأرصدة`,
                                    `**تحويل @العضو المبلغ** — تحويل ${currencyName}`,
                                    `**مكافأة @العضو المبلغ** — إضافة ${currencyName} (للإدارة)`,
                                    `**سحب @العضو المبلغ** — سحب ${currencyName} (للإدارة)`
                                ].join('\n')
                            )
                    ]
                });

                return;
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
                const guild =
                    interaction.guild;

                if (!guild) {
                    return interaction.reply({
                        content:
                            '❌ هذا الأمر يعمل داخل السيرفر فقط.',
                        ephemeral: true
                    });
                }

                const member =
                    interaction.member;

                const commandName =
                    interaction.commandName;

                if (
                    commandName ===
                    'currency'
                ) {
                    if (
                        !isAdmin(
                            member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الأمر للإدارة فقط.',
                            ephemeral: true
                        });
                    }

                    const name =
                        interaction.options
                            .getString(
                                'name',
                                true
                            )
                            .trim();

                    const db =
                        loadDB();

                    const config =
                        ensureGuildConfig(
                            db,
                            guild.id
                        );

                    config.currencyName =
                        name.slice(
                            0,
                            20
                        );

                    saveDB(db);

                    return interaction.reply({
                        content:
                            `✅ تم تغيير اسم العملة إلى **${config.currencyName}** وحفظه في قاعدة البيانات.`,
                        ephemeral: true
                    });
                }

                if (
                    commandName ===
                    'economy-room'
                ) {
                    if (
                        !isAdmin(
                            member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الأمر للإدارة فقط.',
                            ephemeral: true
                        });
                    }

                    const subcommand =
                        interaction.options
                            .getSubcommand();

                    const db =
                        loadDB();

                    const config =
                        ensureGuildConfig(
                            db,
                            guild.id
                        );

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
                            config.economyChannels.includes(
                                channel.id
                            )
                        ) {
                            return interaction.reply({
                                content:
                                    '⚠️ هذا الروم مفعّل بالفعل.',
                                ephemeral: true
                            });
                        }

                        if (
                            config.economyChannels.length >=
                            MAX_ECONOMY_CHANNELS
                        ) {
                            return interaction.reply({
                                content:
                                    `❌ لا يمكنك تفعيل أكثر من ${MAX_ECONOMY_CHANNELS} رومات للعملات.`,
                                ephemeral: true
                            });
                        }

                        config.economyChannels.push(
                            channel.id
                        );

                        saveDB(db);

                        return interaction.reply({
                            content:
                                `✅ تم تفعيل ${channel} كروم للعملات وتم حفظ الإعداد.`,
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

                        const index =
                            config.economyChannels.indexOf(
                                channel.id
                            );

                        if (
                            index === -1
                        ) {
                            return interaction.reply({
                                content:
                                    '⚠️ هذا الروم غير مفعّل.',
                                ephemeral: true
                            });
                        }

                        config.economyChannels.splice(
                            index,
                            1
                        );

                        saveDB(db);

                        return interaction.reply({
                            content:
                                `✅ تم تعطيل ${channel} وحفظ التغيير.`,
                            ephemeral: true
                        });
                    }

                    if (
                        subcommand ===
                        'list'
                    ) {
                        const list =
                            config.economyChannels
                                .map(
                                    id =>
                                        `<#${id}>`
                                );

                        return interaction.reply({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(
                                        '#D4AC0D'
                                    )
                                    .setTitle(
                                        '⚙️ رومات العملات المفعلة'
                                    )
                                    .setDescription(
                                        list.length
                                            ? list.join('\n')
                                            : 'لا يوجد رومات مفعلة.'
                                    )
                            ],
                            ephemeral: true
                        });
                    }
                }

                if (
                    commandName ===
                    'bot-name'
                ) {
                    if (
                        !isAdmin(
                            member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الأمر للإدارة فقط.',
                            ephemeral: true
                        });
                    }

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                `bot_name_modal_${guild.id}`
                            )
                            .setTitle(
                                '✏️ تغيير اسم البوت'
                            );

                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                'bot_name'
                            )
                            .setLabel(
                                'اسم البوت'
                            )
                            .setPlaceholder(
                                'اكتب الاسم الجديد'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(
                                32
                            );

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(
                                input
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                if (
                    commandName ===
                    'bot-avatar'
                ) {
                    if (
                        !isAdmin(
                            member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الأمر للإدارة فقط.',
                            ephemeral: true
                        });
                    }

                    const image =
                        interaction.options
                            .getAttachment(
                                'image',
                                true
                            );

                    const db =
                        loadDB();

                    const config =
                        ensureGuildConfig(
                            db,
                            guild.id
                        );

                    config.customBotAvatar =
                        image.url;

                    saveDB(db);

                    try {
                        await client.user.setAvatar(
                            image.url
                        );
                    } catch (error) {
                        console.error(
                            '❌ فشل تغيير صورة البوت:',
                            error
                        );
                    }

                    return interaction.reply({
                        content:
                            '✅ تم حفظ صورة البوت لهذا السيرفر.',
                        ephemeral: true
                    });
                }

                if (
                    commandName ===
                    'bot-banner'
                ) {
                    if (
                        !isAdmin(
                            member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الأمر للإدارة فقط.',
                            ephemeral: true
                        });
                    }

                    const image =
                        interaction.options
                            .getAttachment(
                                'image',
                                true
                            );

                    const db =
                        loadDB();

                    const config =
                        ensureGuildConfig(
                            db,
                            guild.id
                        );

                    config.customBotBanner =
                        image.url;

                    saveDB(db);

                    return interaction.reply({
                        content:
                            '✅ تم حفظ بنر البوت لهذا السيرفر.',
                        ephemeral: true
                    });
                }

                if (
                    commandName ===
                    'rest'
                ) {
                    if (
                        !isAdmin(
                            member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الأمر للإدارة فقط.',
                            ephemeral: true
                        });
                    }

                    const db =
                        loadDB();

                    const config =
                        ensureGuildConfig(
                            db,
                            guild.id
                        );

                    config.customBotName =
                        null;

                    config.customBotAvatar =
                        null;

                    config.customBotBanner =
                        null;

                    saveDB(db);

                    return interaction.reply({
                        content:
                            '✅ تم إرجاع إعدادات البوت لهذا السيرفر للوضع الأساسي وحفظ التغيير.',
                        ephemeral: true
                    });
                }

                if (
                    commandName ===
                    'give'
                ) {
                    if (
                        !isAdmin(
                            member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الأمر للإدارة فقط.',
                            ephemeral: true
                        });
                    }

                    const target =
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
                                '❌ المبلغ غير صحيح.',
                            ephemeral: true
                        });
                    }

                    const db =
                        loadDB();

                    addMemberBalance(
                        db,
                        guild.id,
                        target.id,
                        amount
                    );

                    saveDB(db);

                    const currencyName =
                        getCurrencyName(
                            guild.id
                        );

                    return interaction.reply({
                        content:
                            `✅ تمت إضافة **${formatAmount(amount)} ${currencyName}** إلى ${target}.`,
                            ephemeral: true
                    });
                }

                if (
                    commandName ===
                    'withdraw'
                ) {
                    if (
                        !isAdmin(
                            member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا الأمر للإدارة فقط.',
                            ephemeral: true
                        });
                    }

                    const target =
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
                            .trim();

                    const db =
                        loadDB();

                    let amount;

                    if (
                        amountText.toLowerCase() ===
                        'all' ||
                        amountText ===
                        'كامل'
                    ) {
                        amount =
                            getMemberBalance(
                                db,
                                guild.id,
                                target.id
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
                        amount <= 0
                    ) {
                        return interaction.reply({
                            content:
                                '❌ المبلغ غير صحيح.',
                            ephemeral: true
                        });
                    }

                    const current =
                        getMemberBalance(
                            db,
                            guild.id,
                            target.id
                        );

                    if (
                        current <
                        amount
                    ) {
                        return interaction.reply({
                            content:
                                '❌ رصيد العضو لا يكفي.',
                            ephemeral: true
                        });
                    }

                    removeMemberBalance(
                        db,
                        guild.id,
                        target.id,
                        amount
                    );

                    saveDB(db);

                    const currencyName =
                        getCurrencyName(
                            guild.id
                        );

                    return interaction.reply({
                        content:
                            `✅ تم سحب **${formatAmount(amount)} ${currencyName}** من ${target}.`,
                        ephemeral: true
                    });
                }

                return;
            }

            if (
                interaction.isButton()
            ) {
                const guild =
                    interaction.guild;

                if (!guild) {
                    return interaction.reply({
                        content:
                            '❌ هذا الزر يعمل داخل السيرفر فقط.',
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId ===
                    'economy_balance'
                ) {
                    const db =
                        loadDB();

                    const balance =
                        getMemberBalance(
                            db,
                            guild.id,
                            interaction.user.id
                        );

                    const currencyName =
                        getCurrencyName(
                            guild.id
                        );

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setTitle(
                                    '💰 رصيدك'
                                )
                                .setDescription(
                                    `رصيدك الحالي: **${formatAmount(balance)} ${currencyName}**`
                                )
                        ],
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId ===
                    'economy_daily'
                ) {
                    const db =
                        loadDB();

                    const user =
                        ensureGuildUser(
                            db,
                            guild.id,
                            interaction.user.id
                        );

                    const now =
                        Date.now();

                    const cooldown =
                        24 *
                        60 *
                        60 *
                        1000;

                    if (
                        now -
                        user.lastDaily <
                        cooldown
                    ) {
                        const remaining =
                            cooldown -
                            (
                                now -
                                user.lastDaily
                            );

                        const hours =
                            Math.ceil(
                                remaining /
                                (
                                    60 *
                                    60 *
                                    1000
                                )
                            );

                        return interaction.reply({
                            content:
                                `⏳ يمكنك استلام اليومي بعد **${hours} ساعة**.`,
                            ephemeral: true
                        });
                    }

                    const reward =
                        Math.floor(
                            Math.random() *
                            5000
                        ) + 1000;

                    user.balance +=
                        reward;

                    user.lastDaily =
                        now;

                    saveDB(db);

                    const currencyName =
                        getCurrencyName(
                            guild.id
                        );

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setTitle(
                                    '🎁 المكافأة اليومية'
                                )
                                .setDescription(
                                    `تم إضافة **${formatAmount(reward)} ${currencyName}** إلى رصيدك.`
                                )
                        ],
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId ===
                    'economy_top'
                ) {
                    const db =
                        loadDB();

                    return interaction.reply({
                        embeds: [
                            createTopEmbed(
                                guild,
                                db
                            )
                        ],
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId ===
                    'economy_transfer'
                ) {
                    return interaction.showModal(
                        buildTransferModal()
                    );
                }

                if (
                    interaction.customId.startsWith(
                        'cancel_transfer_'
                    )
                ) {
                    const senderId =
                        interaction.customId
                            .replace(
                                'cancel_transfer_',
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

                    pendingTransfers.delete(
                        senderId
                    );

                    return interaction.update({
                        content:
                            '❌ تم إلغاء عملية التحويل.',
                        embeds: [],
                        components: []
                    });
                }

                if (
                    interaction.customId.startsWith(
                        'verify_transfer_'
                    )
                ) {
                    const parts =
                        interaction.customId
                            .split('_');

                    const senderId =
                        parts[2];

                    const targetId =
                        parts[3];

                    const amount =
                        parseInt(
                            parts[4]
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
                            senderId
                        );

                    if (!transfer) {
                        return interaction.reply({
                            content:
                                '❌ عملية التحويل انتهت أو غير موجودة.',
                            ephemeral: true
                        });
                    }

                    if (
                        transfer.guildId !==
                        guild.id
                    ) {
                        return interaction.reply({
                            content:
                                '❌ عملية التحويل مرتبطة بسيرفر آخر.',
                            ephemeral: true
                        });
                    }

                    const db =
                        loadDB();

                    const sender =
                        ensureGuildUser(
                            db,
                            guild.id,
                            senderId
                        );

                    ensureGuildUser(
                        db,
                        guild.id,
                        targetId
                    );

                    if (
                        sender.balance <
                        amount
                    ) {
                        pendingTransfers.delete(
                            senderId
                        );

                        return interaction.reply({
                            content:
                                '❌ لم يعد لديك رصيد كافٍ لإتمام العملية.',
                            ephemeral: true
                        });
                    }

                    let code = '';

                    for (
                        let i = 0;
                        i < 6;
                        i++
                    ) {
                        code +=
                            Math.floor(
                                Math.random() *
                                10
                            );
                    }

                    transfer.code =
                        code;

                    pendingTransfers.set(
                        senderId,
                        transfer
                    );

                    return interaction.reply({
                        content:
                            `🔐 رمز التحقق الخاص بالتحويل:\n\n**${code}**\n\nقم بإرسال الرمز في روم العملات لتأكيد العملية.`,
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId.startsWith(
                        'mass_summon_'
                    )
                ) {
                    if (
                        !getMassSummonMember(
                            interaction.member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ لا تملك صلاحية استخدام الاستدعاء.',
                            ephemeral: true
                        });
                    }

                    return interaction.showModal(
                        buildMassSummonModal(
                            guild.id
                        )
                    );
                }
            }

            if (
                interaction.isModalSubmit()
            ) {
                const guild =
                    interaction.guild;

                if (!guild) {
                    return interaction.reply({
                        content:
                            '❌ هذا النموذج يعمل داخل السيرفر فقط.',
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId ===
                    'transfer_modal'
                ) {
                    const targetText =
                        interaction.fields
                            .getTextInputValue(
                                'transfer_user'
                            )
                            .trim();

                    const amountText =
                        interaction.fields
                            .getTextInputValue(
                                'transfer_amount'
                            )
                            .trim();

                    const targetId =
                        targetText.replace(
                            /[<@!>]/g,
                            ''
                        );

                    if (
                        !/^\d{17,20}$/.test(
                            targetId
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ ايدي العضو غير صحيح.',
                            ephemeral: true
                        });
                    }

                    if (
                        targetId ===
                        interaction.user.id
                    ) {
                        return interaction.reply({
                            content:
                                '❌ لا يمكنك التحويل لنفسك.',
                            ephemeral: true
                        });
                    }

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
                                '❌ المبلغ غير صحيح.',
                            ephemeral: true
                        });
                    }

                    const db =
                        loadDB();

                    const balance =
                        getMemberBalance(
                            db,
                            guild.id,
                            interaction.user.id
                        );

                    if (
                        balance <
                        amount
                    ) {
                        return interaction.reply({
                            content:
                                '❌ رصيدك لا يكفي.',
                            ephemeral: true
                        });
                    }

                    pendingTransfers.set(
                        interaction.user.id,
                        {
                            guildId:
                                guild.id,
                            targetId,
                            amount,
                            code: null,
                            createdAt:
                                Date.now()
                        }
                    );

                    const currencyName =
                        getCurrencyName(
                            guild.id
                        );

                    const row =
                        new ActionRowBuilder()
                            .addComponents(
                                makeButton(
                                    `verify_transfer_${interaction.user.id}_${targetId}_${amount}`,
                                    'تأكيد التحويل',
                                    ButtonStyle.Success
                                ),
                                makeButton(
                                    `cancel_transfer_${interaction.user.id}`,
                                    'إلغاء',
                                    ButtonStyle.Danger
                                )
                            );

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(
                                    '#D4AC0D'
                                )
                                .setTitle(
                                    '💸 تأكيد التحويل'
                                )
                                .setDescription(
                                    `هل تريد تحويل **${formatAmount(amount)} ${currencyName}** إلى <@${targetId}>؟`
                                )
                        ],
                        components: [
                            row
                        ],
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId.startsWith(
                        'bot_name_modal_'
                    )
                ) {
                    if (
                        !isAdmin(
                            interaction.member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا النموذج للإدارة فقط.',
                            ephemeral: true
                        });
                    }

                    const name =
                        interaction.fields
                            .getTextInputValue(
                                'bot_name'
                            )
                            .trim();

                    const db =
                        loadDB();

                    const config =
                        ensureGuildConfig(
                            db,
                            guild.id
                        );

                    config.customBotName =
                        name;

                    saveDB(db);

                    return interaction.reply({
                        content:
                            '✅ تم حفظ اسم البوت لهذا السيرفر.',
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId.startsWith(
                        'mass_summon_modal_'
                    )
                ) {
                    const destination =
                        interaction.fields
                            .getTextInputValue(
                                'mass_summon_destination'
                            )
                            .trim();

                    const reason =
                        interaction.fields
                            .getTextInputValue(
                                'mass_summon_reason'
                            )
                            .trim();

                    const validChannelId =
                        /^\d{17,20}$/.test(
                            destination
                        );

                    const validChannelLink =
                        /^https?:\/\/(?:www\.)?discord(?:app)?\.com\/channels\/\d+\/\d+(?:\/\d+)?$/i.test(
                            destination
                        );

                    if (
                        !validChannelId &&
                        !validChannelLink
                    ) {
                        return interaction.reply({
                            content:
                                '❌ التوجه يجب أن يكون ايدي روم صحيح أو لينك روم صحيح.',
                            ephemeral: true
                        });
                    }

                    let destinationText =
                        destination;

                    if (
                        validChannelId
                    ) {
                        destinationText =
                            `<#${destination}>`;
                    }

                    const summonEmbed =
                        new EmbedBuilder()
                            .setColor(
                                '#D4AC0D'
                            )
                            .setTitle(
                                '📩 إشعار استدعاء'
                            )
                            .addFields(
                                {
                                    name:
                                        '🌐 السيرفر',
                                    value:
                                        `**${guild.name}**`
                                },
                                {
                                    name:
                                        '📍 التوجه',
                                    value:
                                        destinationText
                                },
                                {
                                    name:
                                        '📌 السبب',
                                    value:
                                        reason
                                }
                            )
                            .setTimestamp();

                    await interaction.reply({
                        content:
                            '📩 جاري إرسال إشعار الاستدعاء لجميع أعضاء السيرفر.',
                        ephemeral: true
                    });

                    const members =
                        await guild.members.fetch();

                    for (
                        const member
                        of members.values()
                    ) {
                        if (
                            member.user.bot
                        ) continue;

                        await member.send({
                            embeds: [
                                summonEmbed
                            ]
                        }).catch(
                            () => {}
                        );
                    }

                    return;
                }

                if (
                    interaction.customId ===
                    'give_modal'
                ) {
                    if (
                        !isAdmin(
                            interaction.member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا النموذج للإدارة فقط.',
                            ephemeral: true
                        });
                    }

                    const targetText =
                        interaction.fields
                            .getTextInputValue(
                                'give_user'
                            )
                            .trim();

                    const amountText =
                        interaction.fields
                            .getTextInputValue(
                                'give_amount'
                            )
                            .trim();

                    const targetId =
                        targetText.replace(
                            /[<@!>]/g,
                            ''
                        );

                    if (
                        !/^\d{17,20}$/.test(
                            targetId
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ ايدي العضو غير صحيح.',
                            ephemeral: true
                        });
                    }

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
                                '❌ المبلغ غير صحيح.',
                            ephemeral: true
                        });
                    }

                    const db =
                        loadDB();

                    addMemberBalance(
                        db,
                        guild.id,
                        targetId,
                        amount
                    );

                    saveDB(db);

                    const currencyName =
                        getCurrencyName(
                            guild.id
                        );

                    return interaction.reply({
                        content:
                            `✅ تمت إضافة **${formatAmount(amount)} ${currencyName}** إلى <@${targetId}>.`,
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId ===
                    'withdraw_modal'
                ) {
                    if (
                        !isAdmin(
                            interaction.member
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ هذا النموذج للإدارة فقط.',
                            ephemeral: true
                        });
                    }

                    const targetText =
                        interaction.fields
                            .getTextInputValue(
                                'withdraw_user'
                            )
                            .trim();

                    const amountText =
                        interaction.fields
                            .getTextInputValue(
                                'withdraw_amount'
                            )
                            .trim();

                    const targetId =
                        targetText.replace(
                            /[<@!>]/g,
                            ''
                        );

                    if (
                        !/^\d{17,20}$/.test(
                            targetId
                        )
                    ) {
                        return interaction.reply({
                            content:
                                '❌ ايدي العضو غير صحيح.',
                            ephemeral: true
                        });
                    }

                    const db =
                        loadDB();

                    let amount;

                    if (
                        amountText ===
                        'كامل' ||
                        amountText.toLowerCase() ===
                        'all'
                    ) {
                        amount =
                            getMemberBalance(
                                db,
                                guild.id,
                                targetId
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
                        amount <= 0
                    ) {
                        return interaction.reply({
                            content:
                                '❌ المبلغ غير صحيح.',
                            ephemeral: true
                        });
                    }

                    const current =
                        getMemberBalance(
                            db,
                            guild.id,
                            targetId
                        );

                    if (
                        current <
                        amount
                    ) {
                        return interaction.reply({
                            content:
                                '❌ رصيد العضو لا يكفي.',
                            ephemeral: true
                        });
                    }

                    removeMemberBalance(
                        db,
                        guild.id,
                        targetId,
                        amount
                    );

                    saveDB(db);

                    const currencyName =
                        getCurrencyName(
                            guild.id
                        );

                    return interaction.reply({
                        content:
                            `✅ تم سحب **${formatAmount(amount)} ${currencyName}** من <@${targetId}>.`,
                        ephemeral: true
                    });
                }
            }

        } catch (error) {
            console.error(
                '❌ Interaction Error:',
                error
            );

            if (
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    content:
                        '❌ حدث خطأ أثناء تنفيذ العملية.',
                    ephemeral: true
                }).catch(
                    () => {}
                );
            }
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

if (!TOKEN) {
    console.error(
        '❌ لم يتم العثور على DISCORD_TOKEN في ملف .env.'
    );

    process.exit(1);
}

client.login(
    TOKEN
).catch(
    error => {
        console.error(
            '❌ فشل تسجيل الدخول إلى Discord.'
        );

        console.error(
            error
        );

        process.exit(1);
    }
);