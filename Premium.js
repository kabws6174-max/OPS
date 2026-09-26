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
require('dotenv').config();

const TOKEN = String(
    process.env.DISCORD_TOKEN || 'MTU1MzA5OTU2NjIzOTMxODA4Ng.GyGPmy.y_edAasusm0kEaEoJXRj6fQ-nOr8BvPok1HeHM'
).trim();

const REQUEST_CHANNEL_ID = '1545187326093693038';
const PREMIUM_ROLE_ID = '1544858160982917261';
const MASS_SUMMON_ROLE_ID = '1546263383526088805';

const DB_FILE = './economy.json';

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
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify({}, null, 2),
            'utf8'
        );
    }

    try {
        return JSON.parse(
            fs.readFileSync(DB_FILE, 'utf8')
        );
    } catch {
        return {};
    }
}

function saveDB(data) {
    fs.writeFileSync(
        DB_FILE,
        JSON.stringify(data, null, 2),
        'utf8'
    );
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

    const config = db.guildSettings[guildId];

    if (
        typeof config.currencyName !== 'string' ||
        !config.currencyName.trim()
    ) {
        config.currencyName = DEFAULT_CURRENCY_NAME;
    }

    if (!Array.isArray(config.economyChannels)) {
        config.economyChannels = [];
    }

    config.economyChannels = config.economyChannels
        .filter(id => /^\d{17,20}$/.test(String(id)))
        .slice(0, MAX_ECONOMY_CHANNELS);

    return config;
}

function getGuildConfig(guildId) {
    const db = loadDB();
    return ensureGuildConfig(db, guildId);
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
                `❌ تعذر تسجيل أوامر السلاش في: ${guild.name}`,
                error
            );
        }
    }
}

client.once('ready', async () => {
    console.log('======================================');
    console.log(`✅ البوت اشتغل: ${client.user.tag}`);
    console.log('💰 نظام العملات أصبح يدعم إعدادات مستقلة لكل سيرفر.');
    console.log('👤 اسم وصورة وبنر البوت أصبحت مستقلة لكل سيرفر.');
    await registerSlashCommands();
    console.log('======================================');

    const statuses = [
        'نظام العملات',
        'افضل بوت عملات',
        'سبحان الله وبحمده',
        'استغفر الله'
    ];

    let index = 0;

    client.user.setPresence({
        activities: [
            {
                name: 'customstatus',
                type: 4,
                state: statuses[index]
            }
        ],
        status: 'online'
    });

    setInterval(() => {
        client.user.setPresence({
            activities: [
                {
                    name: 'customstatus',
                    type: 4,
                    state: statuses[index]
                }
            ],
            status: 'online'
        });

        index =
            (index + 1) %
            statuses.length;
    }, 1000);
});

client.on('guildCreate', async guild => {
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

        console.log(
            `✅ تم تسجيل أوامر السلاش في السيرفر الجديد: ${guild.name}`
        );
    } catch (error) {
        console.error(
            `❌ تعذر إعداد السيرفر الجديد: ${guild.name}`,
            error
        );
    }
});

client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

        const content =
            message.content.trim();

        if (
            message.guild &&
            content.startsWith('استدعاء')
        ) {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.Administrator
                )
            ) return;

            const targetUser =
                message.mentions.users.first();

            if (!targetUser) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ الاستخدام الصحيح:\n`استدعاء @العضو`'
                            )
                    ]
                });
            }

            const targetMember =
                await message.guild.members
                    .fetch(targetUser.id)
                    .catch(() => null);

            if (!targetMember) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ العضو غير موجود في السيرفر.'
                            )
                    ]
                });
            }

            if (targetMember.user.bot) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ لا يمكنك استدعاء بوت.'
                            )
                    ]
                });
            }

            const embed =
                new EmbedBuilder()
                    .setColor('#D4AC0D')
                    .setTitle('📢 نظام الاستدعاء')
                    .setDescription(
                        `اضغط على الزر أدناه لإرسال استدعاء إلى ${targetMember}.`
                    )
                    .setFooter({
                        text: message.guild.name
                    });

            const row =
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(
                                `summon_open_${message.author.id}_${targetMember.id}`
                            )
                            .setLabel('استدعاء العضو')
                            .setEmoji('📢')
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                    );

            return message.channel.send({
                embeds: [embed],
                components: [row]
            });
        }

        if (
            message.guild &&
            content === 'طلب'
        ) {
            const embed =
                new EmbedBuilder()
                    .setColor('#D4AC0D')
                    .setTitle('📋 رفع طلب')
                    .setDescription(
                        'من هنا يمكنك رفع طلب\nاختر نوع الطلب من القائمة الموجودة بالأسفل.'
                    )
                    .setTimestamp();

            const menu =
                new StringSelectMenuBuilder()
                    .setCustomId(
                        `request_menu_${message.author.id}_${Date.now()}`
                    )
                    .setPlaceholder(
                        'اختر نوع الطلب'
                    )
                    .addOptions(
                        {
                            label: 'رفع طلب عملة',
                            value: 'currency',
                            emoji: '💰',
                            description:
                                'رفع طلب خاص بالعملة'
                        },
                        {
                            label: 'رفع طلب رتبة',
                            value: 'role',
                            emoji: '👑',
                            description:
                                'رفع طلب خاص بالرتبة'
                        },
                        {
                            label: 'رفع طلب بنك',
                            value: 'bank',
                            emoji: '🏦',
                            description:
                                'رفع طلب خاص بالبنك'
                        }
                    );

            return message.channel.send({
                embeds: [embed],
                components: [
                    new ActionRowBuilder()
                        .addComponents(menu)
                ]
            });
        }

        if (
            message.guild &&
            content === 'شعار تسليم'
        ) {
            if (
                !message.member.permissions.has(
                    PermissionFlagsBits.Administrator
                )
            ) return;

            return message.channel.send({
                content:
                    '📨 اضغط على الزر أدناه لإكمال شعار التسليم.',
                components: [
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(
                                    `delivery_open_${message.author.id}`
                                )
                                .setLabel(
                                    'شعار تسليم'
                                )
                                .setEmoji('📨')
                                .setStyle(
                                    ButtonStyle.Secondary
                                )
                        )
                ]
            });
        }

        if (
            message.guild &&
            (
                content === 'شعار كل' ||
                content.toLowerCase() ===
                    'شعار all' ||
                content === 'شعار كامل'
            )
        ) {
            if (
                !message.member.roles.cache.has(
                    MASS_SUMMON_ROLE_ID
                )
            ) return;

            const embed =
                new EmbedBuilder()
                    .setColor('#D4AC0D')
                    .setTitle('📩 إشعار استدعاء')
                    .setDescription(
                        'اضغط على الزر أدناه لإرسال إشعار استدعاء إلى جميع أعضاء السيرفر.'
                    )
                    .setTimestamp();

            const row =
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(
                                `mass_summon_open_${message.author.id}_${message.guild.id}`
                            )
                            .setLabel(
                                'إشعار استدعاء'
                            )
                            .setEmoji('📩')
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                    );

            return message.channel.send({
                embeds: [embed],
                components: [row]
            });
        }

        if (!message.guild) return;

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
            userId
        );

        if (
            pendingTransfers.has(
                userId
            )
        ) {
            const transferData =
                pendingTransfers.get(
                    userId
                );

            if (
                transferData.code &&
                content ===
                    transferData.code
            ) {
                pendingTransfers.delete(
                    userId
                );

                await message.delete()
                    .catch(() => {});

                if (transferData.botMsg) {
                    await transferData.botMsg
                        .delete()
                        .catch(() => {});
                }

                const transferDB =
                    loadDB();

                ensureUser(
                    transferDB,
                    userId
                );

                ensureUser(
                    transferDB,
                    transferData.targetId
                );

                if (
                    transferDB[userId]
                        .balance <
                    transferData.amount
                ) {
                    return message.channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#D4AC0D')
                                .setDescription(
                                    '❌ ليس لديك رصيد كافٍ لإتمام عملية التحويل.'
                                )
                        ]
                    });
                }

                transferDB[userId]
                    .balance -=
                    transferData.amount;

                transferDB[
                    transferData.targetId
                ].balance +=
                    transferData.amount;

                saveDB(
                    transferDB
                );

                const targetMember =
                    await message.guild.members
                        .fetch(
                            transferData.targetId
                        )
                        .catch(() => null);

                const currencyName =
                    getCurrencyName(
                        message.guild.id
                    );

                const receiptEmbed =
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setTitle(
                            'إيصال تحويل'
                        )
                        .addFields(
                            {
                                name: 'المبلغ',
                                value:
                                    `\`\`\`fix\n${formatAmount(
                                        transferData.amount
                                    )} ${currencyName}\n\`\`\``
                            },
                            {
                                name: 'إلى',
                                value:
                                    `\`\`\`ini\n[ ${
                                        targetMember
                                            ? targetMember.user.tag
                                            : transferData.targetId
                                    } ]\n\`\`\``
                            },
                            {
                                name: 'من',
                                value:
                                    `\`\`\`ini\n[ ${message.author.tag} ]\n\`\`\``
                            }
                        )
                        .setTimestamp();

                await message.author.send({
                    embeds: [receiptEmbed]
                }).catch(() => {});

                if (targetMember) {
                    await targetMember.send({
                        embeds: [receiptEmbed]
                    }).catch(() => {});
                }

                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                `✅ تم التحويل بنجاح بقيمة **${formatAmount(
                                    transferData.amount
                                )} ${currencyName}**.`
                            )
                    ]
                });
            }
        }

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
                            .setColor('#D4AC0D')
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
                    db[userId].lastDaily <
                cooldown
            ) {
                const remaining =
                    cooldown -
                    (
                        now -
                        db[userId].lastDaily
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
                            .setColor('#D4AC0D')
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

            db[userId].balance +=
                randomAmount;

            db[userId].lastDaily =
                now;

            saveDB(db);

            const currencyName =
                getCurrencyName(
                    message.guild.id
                );

            const rewardEmbed =
                new EmbedBuilder()
                    .setColor('#D4AC0D')
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
                embeds: [rewardEmbed]
            });
        }

        const currencyCommandName =
            getCurrencyName(
                message.guild.id
            ).toLowerCase();

        if (
            content.toLowerCase() ===
                currencyCommandName ||
            content.toLowerCase() ===
                'ops' ||
            content === 'رصيد' ||
            content.startsWith('رصيد ') ||
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

            ensureUser(
                db,
                targetMember.id
            );

            const balance =
                Number(
                    db[targetMember.id]
                        .balance
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
                        .setColor('#D4AC0D')
                        .setDescription(
                            description
                        )
                ]
            });
        }

        if (
            content.startsWith(
                'تحويل'
            )
        ) {
            const args =
                content.split(/\s+/);

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
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ الاستخدام الصحيح: `تحويل @منشن المبلغ` أو `تحويل @منشن نص` أو `تحويل @منشن كامل`'
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
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ لا يمكنك التحويل لنفسك!'
                            )
                    ]
                });
            }

            let amount = 0;

            const currentBalance =
                Number(
                    db[userId].balance
                ) || 0;

            if (
                argValue === 'كامل'
            ) {
                amount =
                    currentBalance;
            } else if (
                argValue === 'نص'
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
                isNaN(amount) ||
                amount <= 0
            ) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ يرجى كتابة مبلغ صالح أو كلمة (نص) أو (كامل).\n\nالاختصارات المدعومة: `k` `m` `b` `t`'
                            )
                    ]
                });
            }

            if (
                currentBalance <
                amount
            ) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ ليس لديك رصيد كافٍ لإتمام عملية التحويل.'
                            )
                    ]
                });
            }

            const row =
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(
                                `verify_transfer_${userId}_${targetMember.id}_${amount}`
                            )
                            .setLabel(
                                'إظهار رمز التحقق'
                            )
                            .setStyle(
                                ButtonStyle.Secondary
                            )
                    );

            const sentMsg =
                await message.channel.send({
                    content:
                        '🔒 يرجى الضغط على الزر أدناه لإظهار رمز التحقق وإرساله في الشات لتأكيد عملية التحويل.',
                    components: [row]
                });

            pendingTransfers.set(
                userId,
                {
                    targetId:
                        targetMember.id,
                    amount,
                    code: '',
                    botMsg: sentMsg
                }
            );

            return;
        }

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
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ صفحات التوب من 1 إلى 5 فقط.'
                            )
                    ]
                });
            }

            const sortedUsers =
                Object.entries(db)
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

            let description = '';

            pageUsers.forEach(
                ([uId, data], index) => {
                    description +=
                        `#${start + index + 1} <@${uId}> — **${formatAmount(
                            data.balance
                        )} ${getCurrencyName(
                            message.guild.id
                        )}**\n`;
                }
            );

            if (!description) {
                description =
                    `الصفحة **${page}** فارغة.`;
            }

            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setTitle(
                            `قائمة التوب — الصفحة ${page}`
                        )
                        .setDescription(
                            description
                        )
                ]
            });
        }

        if (
            content === 'معلومات' ||
            content === 'المعلومات'
        ) {
            const targetMember =
                message.mentions.members.first() ||
                message.member;

            const targetId =
                targetMember.id;

            ensureUser(
                db,
                targetId
            );

            const userData =
                db[targetId];

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
                    24 *
                    60 *
                    60 *
                    1000;

                if (
                    Date.now() <
                    nextTime
                ) {
                    const diff =
                        nextTime -
                        Date.now();

                    const h =
                        Math.floor(
                            diff /
                            (
                                60 *
                                60 *
                                1000
                            )
                        );

                    const m =
                        Math.floor(
                            (
                                diff %
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

                    nextTimeText =
                        `${h} ساعة و ${m} دقيقة`;
                }
            }

            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setTitle(
                            'معلومات حسابك'
                        )
                        .addFields(
                            {
                                name: 'العضو',
                                value:
                                    `${targetMember}`
                            },
                            {
                                name: 'رصيدك',
                                value:
                                    `${getCurrencyName(
                                        message.guild.id
                                    )} ${formatAmount(
                                        userData.balance
                                    )}`
                            },
                            {
                                name:
                                    'آخر مكافأة حصلت عليها',
                                value:
                                    lastTimeText
                            },
                            {
                                name:
                                    'موعد المكافأة القادمة',
                                value:
                                    nextTimeText
                            }
                        )
                ]
            });
        }

        if (
            content.startsWith(
                'اعطي'
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
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ هذا الأمر مخصص للإداريين فقط.'
                            )
                    ]
                });
            }

            const args =
                content.split(/\s+/);

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
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ الاستخدام الصحيح: `اعطي @العضو المبلغ`\nمثال: `اعطي @العضو 20k`'
                            )
                    ]
                });
            }

            ensureUser(
                db,
                targetMember.id
            );

            db[targetMember.id]
                .balance +=
                amount;

            saveDB(db);

            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setDescription(
                            `✅ تم إضافة **${formatAmount(
                                amount
                            )} ${getCurrencyName(
                                message.guild.id
                            )}** إلى رصيد العضو ${targetMember}`
                        )
                ]
            });
        }

        if (
            content.startsWith(
                'سحب'
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
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ هذا الأمر مخصص للإداريين فقط.'
                            )
                    ]
                });
            }

            const args =
                content.split(/\s+/);

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
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ الاستخدام الصحيح: `سحب @العضو المبلغ` أو `سحب @العضو نص` أو `سحب @العضو كامل`'
                            )
                    ]
                });
            }

            ensureUser(
                db,
                targetMember.id
            );

            const balance =
                Number(
                    db[targetMember.id]
                        .balance
                ) || 0;

            let amount = 0;

            if (
                argValue === 'كامل'
            ) {
                amount = balance;
            } else if (
                argValue === 'نص'
            ) {
                amount =
                    Math.floor(
                        balance / 2
                    );
            } else {
                amount =
                    parseAmount(
                        argValue
                    );
            }

            if (
                isNaN(amount) ||
                amount <= 0
            ) {
                return message.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#D4AC0D')
                            .setDescription(
                                '❌ يرجى كتابة مبلغ صالح أو كلمة (نص) أو (كامل).\n\nالاختصارات المدعومة: `k` `m` `b` `t`'
                            )
                    ]
                });
            }

            if (
                amount > balance
            ) {
                amount = balance;
            }

            db[targetMember.id]
                .balance =
                Math.max(
                    0,
                    balance - amount
                );

            saveDB(db);

            return message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setDescription(
                            `✅ تم سحب **${formatAmount(
                                amount
                            )} ${getCurrencyName(
                                message.guild.id
                            )}** من رصيد العضو ${targetMember}`
                        )
                ]
            });
        }

    } catch (error) {
        console.error(
            '❌ Message Error:',
            error
        );
    }
});

client.on(
    'interactionCreate',
    async interaction => {
        try {

            if (
                interaction.isChatInputCommand()
            ) {
                if (!interaction.guild) {
                    return interaction.reply({
                        content:
                            '❌ هذا الأمر يعمل داخل السيرفر فقط.',
                        ephemeral: true
                    });
                }

                if (
                    !interaction.memberPermissions?.has(
                        PermissionFlagsBits.Administrator
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الأمر مخصص للإداريين فقط.',
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
                        !name ||
                        name.length > 20
                    ) {
                        return interaction.reply({
                            content:
                                '❌ اسم العملة يجب أن يكون بين 1 و20 حرفاً.',
                            ephemeral: true
                        });
                    }

                    config.currencyName =
                        name;

                    saveDB(db);

                    return interaction.reply({
                        content:
                            `✅ تم تغيير اسم العملة في هذا السيرفر إلى **${name}**.`,
                        ephemeral: true
                    });
                }

                if (
                    interaction.commandName ===
                    'economy-room'
                ) {
                    const subcommand =
                        interaction.options
                            .getSubcommand();

                    if (
                        subcommand === 'add'
                    ) {
                        const channel =
                            interaction.options
                                .getChannel(
                                    'channel',
                                    true
                                );

                        if (
                            !channel.isTextBased()
                        ) {
                            return interaction.reply({
                                content:
                                    '❌ يجب اختيار روم كتابي.',
                                ephemeral: true
                            });
                        }

                        if (
                            config.economyChannels
                                .includes(
                                    channel.id
                                )
                        ) {
                            return interaction.reply({
                                content:
                                    'ℹ️ هذا الروم مفعّل بالفعل لأوامر العملة.',
                                ephemeral: true
                            });
                        }

                        if (
                            config.economyChannels
                                .length >=
                            MAX_ECONOMY_CHANNELS
                        ) {
                            return interaction.reply({
                                content:
                                    `❌ لا يمكنك تفعيل أكثر من **${MAX_ECONOMY_CHANNELS} رومات** للعملة في السيرفر.`,
                                ephemeral: true
                            });
                        }

                        config.economyChannels
                            .push(
                                channel.id
                            );

                        saveDB(db);

                        return interaction.reply({
                            content:
                                `✅ تم تفعيل أوامر العملة في ${channel}.\n💰 الرومات المفعلة: **${config.economyChannels.length}/${MAX_ECONOMY_CHANNELS}**`,
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
                            config.economyChannels
                                .indexOf(
                                    channel.id
                                );

                        if (
                            index === -1
                        ) {
                            return interaction.reply({
                                content:
                                    '❌ هذا الروم غير مفعّل لأوامر العملة.',
                                ephemeral: true
                            });
                        }

                        config.economyChannels
                            .splice(
                                index,
                                1
                            );

                        saveDB(db);

                        return interaction.reply({
                            content:
                                `✅ تم تعطيل أوامر العملة في ${channel}.`,
                            ephemeral: true
                        });
                    }

                    if (
                        subcommand ===
                        'list'
                    ) {
                        const channels =
                            config
                                .economyChannels
                                .length
                                ? config
                                    .economyChannels
                                    .map(
                                        id =>
                                            `<#${id}>`
                                    )
                                    .join(
                                        '\n'
                                    )
                                : 'لا توجد رومات مفعلة حالياً.';

                        return interaction.reply({
                            content:
                                `💰 **رومات العملة المفعلة**\n\n${channels}\n\n**${config.economyChannels.length}/${MAX_ECONOMY_CHANNELS}**`,
                            ephemeral: true
                        });
                    }
                }

                /*
                =========================================================
                BOT NAME - SERVER ONLY
                =========================================================
                */

                if (
                    interaction.commandName ===
                    'bot-name'
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                `bot_name_modal_${interaction.user.id}`
                            )
                            .setTitle(
                                '👤 تغيير اسم البوت'
                            );

                    const nameInput =
                        new TextInputBuilder()
                            .setCustomId(
                                'bot_name'
                            )
                            .setLabel(
                                'اسم البوت الجديد'
                            )
                            .setPlaceholder(
                                'اكتب اسم البوت هنا...'
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
                                nameInput
                            )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                /*
                =========================================================
                BOT AVATAR - SERVER ONLY
                =========================================================
                */

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
                            avatar:
                                attachment.url
                        });

                        return interaction.editReply({
                            content:
                                '✅ تم تغيير صورة البوت في هذا السيرفر فقط.'
                        });
                    } catch (error) {
                        console.error(
                            '❌ Guild Avatar Error:',
                            error
                        );

                        return interaction.editReply({
                            content:
                                '❌ تعذر تغيير صورة البوت في هذا السيرفر. تأكد من أن إصدار discord.js حديث وأن البوت يستطيع تعديل ملفه داخل السيرفر.'
                        });
                    }
                }

                /*
                =========================================================
                BOT BANNER - SERVER ONLY
                =========================================================
                */

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
                            banner:
                                attachment.url
                        });

                        return interaction.editReply({
                            content:
                                '✅ تم تغيير بنر البوت في هذا السيرفر فقط.'
                        });
                    } catch (error) {
                        console.error(
                            '❌ Guild Banner Error:',
                            error
                        );

                        return interaction.editReply({
                            content:
                                '❌ تعذر تغيير بنر البوت في هذا السيرفر. تأكد من أن Discord يسمح للبوت باستخدام Banner وأن الصورة صالحة.'
                        });
                    }
                }

                /*
                =========================================================
                REST - RESET SERVER PROFILE ONLY
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
                            )
                            .trim();

                    if (
                        targetUser.bot
                    ) {
                        return interaction.reply({
                            content:
                                '❌ لا يمكنك إعطاء عملة لبوت.',
                            ephemeral: true
                        });
                    }

                    const amount =
                        parseAmount(
                            amountText
                        );

                    if (
                        isNaN(amount) ||
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
                        targetUser.id
                    );

                    db[targetUser.id]
                        .balance +=
                        amount;

                    saveDB(db);

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

                    ensureUser(
                        db,
                        targetUser.id
                    );

                    const balance =
                        Number(
                            db[targetUser.id]
                                .balance
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
                        isNaN(amount) ||
                        amount <= 0
                    ) {
                        return interaction.reply({
                            content:
                                '❌ المبلغ غير صحيح.\nاستخدم مبلغاً مثل `20k` أو `2m` أو استخدم `نص` أو `كامل`.',
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

                    db[targetUser.id]
                        .balance =
                        Math.max(
                            0,
                            balance -
                                amount
                        );

                    saveDB(db);

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
            }

            /*
            =========================================================
            BOT NAME MODAL - SERVER ONLY
            =========================================================
            */

            if (
                interaction.isModalSubmit() &&
                interaction.customId.startsWith(
                    'bot_name_modal_'
                )
            ) {
                const ownerId =
                    interaction.customId
                        .split('_')[3];

                if (
                    interaction.user.id !==
                    ownerId
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الطلب ليس مخصصاً لك.',
                        ephemeral: true
                    });
                }

                if (
                    !interaction.memberPermissions?.has(
                        PermissionFlagsBits.Administrator
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الأمر مخصص للإداريين فقط.',
                        ephemeral: true
                    });
                }

                const name =
                    interaction.fields
                        .getTextInputValue(
                            'bot_name'
                        )
                        .trim();

                if (
                    !name ||
                    name.length > 32
                ) {
                    return interaction.reply({
                        content:
                            '❌ اسم البوت يجب أن يكون بين 1 و32 حرفاً.',
                        ephemeral: true
                    });
                }

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
                        nick: name
                    });

                    return interaction.editReply({
                        content:
                            `✅ تم تغيير اسم البوت إلى **${name}** في هذا السيرفر فقط.`
                    });
                } catch (error) {
                    console.error(
                        '❌ Guild Name Error:',
                        error
                    );

                    return interaction.editReply({
                        content:
                            '❌ تعذر تغيير اسم البوت في هذا السيرفر. تأكد من أن للبوت صلاحية تغيير الاسم وأن رتبة البوت تسمح بذلك.'
                    });
                }
            }

            /*
            =========================================================
            DELIVERY OPEN
            =========================================================
            */

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    'delivery_open_'
                )
            ) {
                const adminId =
                    interaction.customId
                        .split('_')[2];

                if (
                    interaction.user.id !==
                    adminId
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الزر ليس مخصصاً لك.',
                        ephemeral: true
                    });
                }

                if (
                    !interaction.member.permissions.has(
                        PermissionFlagsBits.Administrator
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الأمر مخصص للإداريين فقط.',
                        ephemeral: true
                    });
                }

                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `delivery_modal_${adminId}`
                        )
                        .setTitle(
                            '📨 شعار تسليم'
                        );

                const memberInput =
                    new TextInputBuilder()
                        .setCustomId(
                            'delivery_member_id'
                        )
                        .setLabel(
                            'ايدي العضو'
                        )
                        .setPlaceholder(
                            'اكتب ايدي العضو هنا...'
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(
                            true
                        )
                        .setMaxLength(
                            25
                        );

                const amountInput =
                    new TextInputBuilder()
                        .setCustomId(
                            'delivery_amount'
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

                const reasonInput =
                    new TextInputBuilder()
                        .setCustomId(
                            'delivery_reason'
                        )
                        .setLabel(
                            'السبب'
                        )
                        .setPlaceholder(
                            'اكتب سبب التسليم هنا...'
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
                            memberInput
                        ),
                    new ActionRowBuilder()
                        .addComponents(
                            amountInput
                        ),
                    new ActionRowBuilder()
                        .addComponents(
                            reasonInput
                        )
                );

                return interaction.showModal(
                    modal
                );
            }

            /*
            =========================================================
            DELIVERY MODAL
            =========================================================
            */

            if (
                interaction.isModalSubmit() &&
                interaction.customId.startsWith(
                    'delivery_modal_'
                )
            ) {
                const adminId =
                    interaction.customId
                        .split('_')[2];

                if (
                    interaction.user.id !==
                    adminId
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الطلب ليس مخصصاً لك.',
                        ephemeral: true
                    });
                }

                if (
                    !interaction.member.permissions.has(
                        PermissionFlagsBits.Administrator
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الأمر مخصص للإداريين فقط.',
                        ephemeral: true
                    });
                }

                const memberId =
                    interaction.fields
                        .getTextInputValue(
                            'delivery_member_id'
                        )
                        .trim();

                const amountText =
                    interaction.fields
                        .getTextInputValue(
                            'delivery_amount'
                        )
                        .trim();

                const reason =
                    interaction.fields
                        .getTextInputValue(
                            'delivery_reason'
                        )
                        .trim();

                if (
                    !/^\d{17,20}$/.test(
                        memberId
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
                    isNaN(amount) ||
                    amount <= 0
                ) {
                    return interaction.reply({
                        content:
                            '❌ المبلغ غير صحيح.',
                        ephemeral: true
                    });
                }

                const targetMember =
                    await interaction.guild.members
                        .fetch(
                            memberId
                        )
                        .catch(
                            () => null
                        );

                if (!targetMember) {
                    return interaction.reply({
                        content:
                            '❌ العضو غير موجود في السيرفر.',
                        ephemeral: true
                    });
                }

                const rewardId =
                    `${interaction.user.id}_${targetMember.id}_${Date.now()}_${Math.floor(
                        Math.random() * 100000
                    )}`;

                pendingRewards.set(
                    rewardId,
                    {
                        targetId:
                            targetMember.id,
                        amount,
                        reason,
                        guildId:
                            interaction.guild.id
                    }
                );

                const currencyName =
                    getCurrencyName(
                        interaction.guild.id
                    );

                const rewardEmbed =
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setTitle(
                            '📨 إشعار استلام مكافأة'
                        )
                        .addFields(
                            {
                                name:
                                    'المبلغ',
                                value:
                                    `**${formatAmount(
                                        amount
                                    )} ${currencyName}**`
                            },
                            {
                                name:
                                    'السبب',
                                value:
                                    reason
                            }
                        )
                        .setTimestamp();

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(
                                    `reward_receive_${rewardId}`
                                )
                                .setLabel(
                                    'استلام المكافأة'
                                )
                                .setEmoji(
                                    '📩'
                                )
                                .setStyle(
                                    ButtonStyle.Secondary
                                )
                        );

                try {
                    await targetMember.send({
                        embeds: [
                            rewardEmbed
                        ],
                        components: [
                            row
                        ]
                    });

                    return interaction.reply({
                        content:
                            `✅ تم إرسال شعار التسليم إلى ${targetMember}.`,
                        ephemeral: true
                    });
                } catch {
                    pendingRewards.delete(
                        rewardId
                    );

                    return interaction.reply({
                        content:
                            '❌ تعذر إرسال شعار التسليم في الخاص للعضو.',
                        ephemeral: true
                    });
                }
            }

            /*
            =========================================================
            REQUEST MENU
            =========================================================
            */

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId.startsWith(
                    'request_menu_'
                )
            ) {
                const requestType =
                    interaction.values[0];

                const typeNames = {
                    currency:
                        'رفع طلب عملة',
                    role:
                        'رفع طلب رتبة',
                    bank:
                        'رفع طلب بنك'
                };

                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `request_modal_${requestType}_${interaction.user.id}`
                        )
                        .setTitle(
                            typeNames[
                                requestType
                            ]
                        );

                const memberIdInput =
                    new TextInputBuilder()
                        .setCustomId(
                            'request_member_id'
                        )
                        .setLabel(
                            'ايدي العضو'
                        )
                        .setPlaceholder(
                            'اكتب ايدي العضو هنا...'
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(
                            true
                        )
                        .setMaxLength(
                            25
                        );

                const reasonInput =
                    new TextInputBuilder()
                        .setCustomId(
                            'request_reason'
                        )
                        .setLabel(
                            'السبب'
                        )
                        .setPlaceholder(
                            'اكتب سبب الطلب هنا...'
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
                            memberIdInput
                        ),
                    new ActionRowBuilder()
                        .addComponents(
                            reasonInput
                        )
                );

                return interaction.showModal(
                    modal
                );
            }

            /*
            =========================================================
            REQUEST MODAL
            =========================================================
            */

            if (
                interaction.isModalSubmit() &&
                interaction.customId.startsWith(
                    'request_modal_'
                )
            ) {
                const parts =
                    interaction.customId
                        .split('_');

                const requestType =
                    parts[2];

                const memberId =
                    interaction.fields
                        .getTextInputValue(
                            'request_member_id'
                        )
                        .trim();

                const reason =
                    interaction.fields
                        .getTextInputValue(
                            'request_reason'
                        )
                        .trim();

                if (
                    !/^\d{17,20}$/.test(
                        memberId
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ ايدي العضو غير صحيح.',
                        ephemeral: true
                    });
                }

                const typeNames = {
                    currency:
                        'رفع طلب عملة',
                    role:
                        'رفع طلب رتبة',
                    bank:
                        'رفع طلب بنك'
                };

                const requestChannel =
                    await client.channels
                        .fetch(
                            REQUEST_CHANNEL_ID
                        )
                        .catch(
                            () => null
                        );

                if (
                    !requestChannel ||
                    !requestChannel.isTextBased()
                ) {
                    return interaction.reply({
                        content:
                            '❌ روم الطلبات غير موجود أو لا يمكنني الكتابة فيه.',
                        ephemeral: true
                    });
                }

                let memberText =
                    `<@${memberId}>`;

                if (
                    interaction.guild
                ) {
                    const member =
                        await interaction.guild.members
                            .fetch(
                                memberId
                            )
                            .catch(
                                () => null
                            );

                    if (member) {
                        memberText =
                            `${member} \`(${member.user.tag})\``;
                    }
                }

                const requestEmbed =
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setTitle(
                            '📋 طلب جديد'
                        )
                        .addFields(
                            {
                                name:
                                    'نوع الطلب',
                                value:
                                    `**${
                                        typeNames[
                                            requestType
                                        ] ||
                                        requestType
                                    }**`
                            },
                            {
                                name:
                                    'العضو',
                                value:
                                    memberText
                            },
                            {
                                name:
                                    'ايدي العضو',
                                value:
                                    `\`${memberId}\``
                            },
                            {
                                name:
                                    'السبب',
                                value:
                                    reason
                            },
                            {
                                name:
                                    'مقدم الطلب',
                                value:
                                    `${interaction.user}`
                            }
                        )
                        .setTimestamp();

                const requestRow =
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(
                                    `request_status_delivered_${interaction.user.id}`
                                )
                                .setLabel(
                                    'تم التسليم'
                                )
                                .setEmoji(
                                    '✅'
                                )
                                .setStyle(
                                    ButtonStyle.Success
                                ),
                            new ButtonBuilder()
                                .setCustomId(
                                    `request_status_not_delivered_${interaction.user.id}`
                                )
                                .setLabel(
                                    'لم يتم التسليم'
                                )
                                .setEmoji(
                                    '❌'
                                )
                                .setStyle(
                                    ButtonStyle.Danger
                                )
                        );

                await requestChannel.send({
                    embeds: [
                        requestEmbed
                    ],
                    components: [
                        requestRow
                    ]
                });

                return interaction.reply({
                    content:
                        '✅ تم إرسال الطلب بنجاح.',
                    ephemeral: true
                });
            }

            /*
            =========================================================
            REQUEST STATUS
            =========================================================
            */

            if (
                interaction.isButton() &&
                (
                    interaction.customId.startsWith(
                        'request_status_delivered_'
                    ) ||
                    interaction.customId.startsWith(
                        'request_status_not_delivered_'
                    )
                )
            ) {
                if (
                    !interaction.member.permissions.has(
                        PermissionFlagsBits.Administrator
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الزر مخصص للإداريين فقط.',
                        ephemeral: true
                    });
                }

                const isDelivered =
                    interaction.customId.startsWith(
                        'request_status_delivered_'
                    );

                const statusText =
                    isDelivered
                        ? '✅ **تم التسليم**'
                        : '❌ **لم يتم التسليم**';

                const currentEmbed =
                    interaction.message
                        .embeds[0];

                const updatedEmbed =
                    EmbedBuilder
                        .from(
                            currentEmbed
                        )
                        .addFields({
                            name:
                                'حالة الطلب',
                            value:
                                statusText
                        })
                        .setFooter({
                            text:
                                `تم تحديث الحالة بواسطة ${interaction.user.tag}`
                        })
                        .setTimestamp();

                const disabledRow =
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(
                                    `request_status_done_${interaction.message.id}`
                                )
                                .setLabel(
                                    'تم التسليم'
                                )
                                .setEmoji(
                                    '✅'
                                )
                                .setStyle(
                                    ButtonStyle.Success
                                )
                                .setDisabled(
                                    true
                                ),
                            new ButtonBuilder()
                                .setCustomId(
                                    `request_status_done_not_${interaction.message.id}`
                                )
                                .setLabel(
                                    'لم يتم التسليم'
                                )
                                .setEmoji(
                                    '❌'
                                )
                                .setStyle(
                                    ButtonStyle.Danger
                                )
                                .setDisabled(
                                    true
                                )
                        );

                await interaction.update({
                    embeds: [
                        updatedEmbed
                    ],
                    components: [
                        disabledRow
                    ]
                });

                return;
            }

            /*
            =========================================================
            REWARD RECEIVE
            =========================================================
            */

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    'reward_receive_'
                )
            ) {
                const rewardId =
                    interaction.customId.replace(
                        'reward_receive_',
                        ''
                    );

                const reward =
                    pendingRewards.get(
                        rewardId
                    );

                if (!reward) {
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

                ensureUser(
                    db,
                    reward.targetId
                );

                db[reward.targetId]
                    .balance +=
                    reward.amount;

                saveDB(db);

                pendingRewards.delete(
                    rewardId
                );

                const currencyName =
                    getCurrencyName(
                        reward.guildId
                    );

                const receivedEmbed =
                    new EmbedBuilder()
                        .setColor('#D4AC0D')
                        .setTitle(
                            '📨 تم استلام المكافأة'
                        )
                        .setDescription(
                            `تمت إضافة **${formatAmount(
                                reward.amount
                            )} ${currencyName}** إلى رصيدك بنجاح.\n\n**السبب :** ${reward.reason}\n**رصيدك الحالي :** ${formatAmount(
                                db[
                                    reward.targetId
                                ].balance
                            )} ${currencyName}`
                        )
                        .setTimestamp();

                return interaction.update({
                    embeds: [
                        receivedEmbed
                    ],
                    components: [
                        new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(
                                        `reward_received_${rewardId}`
                                    )
                                    .setLabel(
                                        'تم استلام المكافأة'
                                    )
                                    .setEmoji(
                                        '✅'
                                    )
                                    .setStyle(
                                        ButtonStyle.Secondary
                                    )
                                    .setDisabled(
                                        true
                                    )
                            )
                    ]
                });
            }

            /*
            =========================================================
            SUMMON OPEN
            =========================================================
            */

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    'summon_open_'
                )
            ) {
                const parts =
                    interaction.customId
                        .split('_');

                const adminId =
                    parts[2];

                const targetId =
                    parts[3];

                if (
                    interaction.user.id !==
                    adminId
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الزر ليس مخصصاً لك.',
                        ephemeral: true
                    });
                }

                if (
                    !interaction.member.permissions.has(
                        PermissionFlagsBits.Administrator
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الأمر مخصص للإداريين فقط.',
                        ephemeral: true
                    });
                }

                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `summon_modal_${adminId}_${targetId}`
                        )
                        .setTitle(
                            '📩 إشعار استدعاء'
                        );

                const destinationInput =
                    new TextInputBuilder()
                        .setCustomId(
                            'summon_destination'
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
                            'summon_reason'
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

                return interaction.showModal(
                    modal
                );
            }

            /*
            =========================================================
            SUMMON MODAL
            =========================================================
            */

            if (
                interaction.isModalSubmit() &&
                interaction.customId.startsWith(
                    'summon_modal_'
                )
            ) {
                const parts =
                    interaction.customId
                        .split('_');

                const adminId =
                    parts[2];

                const targetId =
                    parts[3];

                if (
                    interaction.user.id !==
                    adminId
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الاستدعاء ليس مخصصاً لك.',
                        ephemeral: true
                    });
                }

                if (
                    !interaction.member.permissions.has(
                        PermissionFlagsBits.Administrator
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الأمر مخصص للإداريين فقط.',
                        ephemeral: true
                    });
                }

                const destination =
                    interaction.fields
                        .getTextInputValue(
                            'summon_destination'
                        )
                        .trim();

                const reason =
                    interaction.fields
                        .getTextInputValue(
                            'summon_reason'
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

                const targetMember =
                    await interaction.guild.members
                        .fetch(
                            targetId
                        )
                        .catch(
                            () => null
                        );

                if (!targetMember) {
                    return interaction.reply({
                        content:
                            '❌ العضو غير موجود في السيرفر.',
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
                        .setColor('#D4AC0D')
                        .setTitle(
                            '📩 إشعار استدعاء'
                        )
                        .addFields(
                            {
                                name:
                                    '🌐 السيرفر',
                                value:
                                    `**${interaction.guild.name}**`
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
                        .setFooter({
                            text:
                                'نظام الاستدعاء'
                        })
                        .setTimestamp();

                try {
                    await targetMember.send({
                        embeds: [
                            summonEmbed
                        ]
                    });

                    return interaction.reply({
                        content:
                            `✅ تم إرسال إشعار الاستدعاء إلى ${targetMember}.`,
                        ephemeral: true
                    });
                } catch {
                    return interaction.reply({
                        content:
                            '❌ تعذر إرسال الاستدعاء في الخاص. قد تكون رسائل الخاص مغلقة لدى العضو.',
                        ephemeral: true
                    });
                }
            }

            /*
            =========================================================
            MASS SUMMON OPEN
            =========================================================
            */

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    'mass_summon_open_'
                )
            ) {
                const parts =
                    interaction.customId
                        .split('_');

                const adminId =
                    parts[3];

                if (
                    interaction.user.id !==
                    adminId
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الزر ليس مخصصاً لك.',
                        ephemeral: true
                    });
                }

                if (
                    !interaction.member.roles.cache.has(
                        MASS_SUMMON_ROLE_ID
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ هذا الأمر ليس متاحاً لك.',
                        ephemeral: true
                    });
                }

                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `mass_summon_modal_${interaction.guild.id}`
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

                return interaction.showModal(
                    modal
                );
            }

            /*
            =========================================================
            MASS SUMMON MODAL
            =========================================================
            */

            if (
                interaction.isModalSubmit() &&
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
                        .setColor('#D4AC0D')
                        .setTitle(
                            '📩 إشعار استدعاء'
                        )
                        .addFields(
                            {
                                name:
                                    '🌐 السيرفر',
                                value:
                                    `**${interaction.guild.name}**`
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
                    await interaction.guild.members.fetch();

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

            /*
            =========================================================
            VERIFY TRANSFER
            =========================================================
            */

            if (
                interaction.isButton() &&
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

                const db =
                    loadDB();

                ensureUser(
                    db,
                    senderId
                );

                ensureUser(
                    db,
                    targetId
                );

                if (
                    db[senderId]
                        .balance <
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