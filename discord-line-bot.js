const { Client } = require('discord.js-selfbot-v13');
const client = new Client({
    checkUpdate: false
});

const USER_TOKEN = process.env.USER_TOKEN;

// ตั้งค่าต่างๆ
const config = {
    // เซิร์ฟเวอร์ต้นทาง
    sourceServerId: '1332161684910899362',
    // เซิร์ฟเวอร์ปลายทาง
    destinationServerId: '1300072578668429322',
    
    // แมปของ Channel IDs (ต้นทาง -> ปลายทาง)
    channels: {
        // ช่องต้นทาง: ช่องปลายทาง
        '1332169081314476063': '1363789018327945276', //challenge
        '1362084541170192455': '1363809293287293070' // banner
    },
    
    // ช่องปลายทางที่ต้องลบ @บทบาท-ที่ไม่รู้จัก
    specialFilterChannels: ['1363789018327945276', '1363809293287293070'],
    
    // ชื่อช่องเพื่อใช้ในการแสดงข้อความ log
    channelNames: {
        '1332169081314476063': 'challenge',
        '1362084541170192455': 'banner'
    },
    
    // แมปของ Role IDs ระหว่างเซิร์ฟเวอร์
    // Key: role ID ของเซิร์ฟเวอร์ต้นทาง, Value: role ID ของเซิร์ฟเวอร์ปลายทาง
    roleMapping: {
        '1363756435506200688': '1363794959786053702',
        '1363801882795184268': '1363795020552994896',
        // เพิ่ม role ID ตามต้องการ
    },
    
    // เพิ่ม ID role สำหรับคำสั่งพิเศษ
    commandRoleId: '1363795020552994896',
    challengeRoleId: '1363794959786053702'
};

// ฟังก์ชั่นสำหรับแปลง role mention
function convertRoleMentions(content) {
    // แปลง mention ในรูปแบบ <@&ROLE_ID>
    for (const [sourceRoleId, destRoleId] of Object.entries(config.roleMapping)) {
        const sourceRoleMention = `<@&${sourceRoleId}>`;
        const destRoleMention = `<@&${destRoleId}>`;
        content = content.replace(new RegExp(sourceRoleMention, 'g'), destRoleMention);
    }
    return content;
}

// ฟังก์ชั่นสำหรับลบ @บทบาท-ที่ไม่รู้จัก
function removeUnknownRoleMentions(content) {
    return content.replace(/@บทบาท-ที่ไม่รู้จัก/g, '');
}

// ฟังก์ชั่นสำหรับตรวจสอบและจัดการคำสั่งพิเศษ
function processSpecialCommands(content, sourceChannelId, destinationChannelId) {
    let newContent = content;
    let hasCommand = false;
    
    // ลบ @บทบาท-ที่ไม่รู้จัก ถ้าพบในข้อความและช่องปลายทางอยู่ใน specialFilterChannels
    if (newContent.includes('@บทบาท-ที่ไม่รู้จัก')) {
        // ตรวจสอบว่าช่องปลายทางเป็นช่องที่ระบุให้ลบหรือไม่
        if (config.specialFilterChannels.includes(destinationChannelId)) {
            newContent = removeUnknownRoleMentions(newContent);
            hasCommand = true;
            console.log(`พบ @บทบาท-ที่ไม่รู้จัก ในช่อง ${destinationChannelId} ลบออกแล้ว`);
        }
    }
    
    // ตรวจสอบคำสั่ง ?banner
    if (newContent.includes('?banner')) {
        // ถ้าอยู่ในห้อง challenge ให้ใช้ role ID พิเศษ
        if (sourceChannelId === '1332169081314476063') {
            newContent = newContent.replace(/\?banner/g, `<@&${config.challengeRoleId}>`);
            console.log(`พบ ?banner ในห้อง challenge แทนที่ด้วย role ID ${config.challengeRoleId}`);
        } else {
            newContent = newContent.replace(/\?banner/g, `<@&${config.commandRoleId}>`);
            console.log(`พบ ?banner แทนที่ด้วย role ID ${config.commandRoleId}`);
        }
        hasCommand = true;
    }
    
    // ตรวจสอบคำสั่ง ?challenge
    if (newContent.includes('?challenge')) {
        newContent = newContent.replace(/\?challenge/g, `<@&${config.commandRoleId}>`);
        hasCommand = true;
        console.log(`พบ ?challenge แทนที่ด้วย role ID ${config.commandRoleId}`);
    }
    
    return {
        content: newContent,
        hasCommand
    };
}

// ฟังก์ชั่นสำหรับส่งต่อข้อความ
async function transferMessage(message, destinationChannel) {
    try {
        const channelName = config.channelNames[message.channel.id] || message.channel.name;
        console.log(`กำลังส่งข้อความจาก ${channelName}...`);
        
        // แปลง role mentions
        let content = message.content ? convertRoleMentions(message.content) : "";
        
        // ตรวจสอบคำสั่งพิเศษ โดยส่ง ID ช่องต้นทางและปลายทาง
        if (content) {
            const result = processSpecialCommands(content, message.channel.id, destinationChannel.id);
            content = result.content;
            
            if (result.hasCommand) {
                console.log(`มีการจัดการคำสั่งพิเศษในข้อความแล้ว`);
            }
        }
        
        // ถ้าไม่มีเนื้อหาหรือไฟล์แนบ ให้ข้าม
        if (!content && message.attachments.size === 0 && message.embeds.length === 0) {
            return;
        }
        
        // ดาวน์โหลดไฟล์แนบ (ถ้ามี)
        const attachments = [...message.attachments.values()];
        const files = attachments.map(attachment => ({
            attachment: attachment.url,
            name: attachment.name
        }));
        
        // สร้างตัวเลือกสำหรับการส่งข้อความ
        const messageOptions = {
            content: content || null,
            files: files.length > 0 ? files : undefined,
        };
        
        // ถ้ามี embeds ให้ส่ง embeds ด้วย
        if (message.embeds.length > 0) {
            // หมายเหตุ: ระบบ selfbot อาจมีข้อจำกัดในการส่ง embeds ที่สมบูรณ์
            // messageOptions.embeds = message.embeds;
            
            // ทางเลือก: แปลง embeds เป็นรูปแบบข้อความพื้นฐาน
            for (const embed of message.embeds) {
                let embedText = '';
                if (embed.title) embedText += `**${embed.title}**\n`;
                if (embed.description) embedText += `${embed.description}\n`;
                if (embed.fields && embed.fields.length > 0) {
                    for (const field of embed.fields) {
                        embedText += `\n**${field.name}**\n${field.value}\n`;
                    }
                }
                
                if (embedText) {
                    messageOptions.content = messageOptions.content 
                        ? `${messageOptions.content}\n\n${embedText}` 
                        : embedText;
                }
                
                // ถ้ามีรูปภาพใน embed ให้เพิ่มเข้าไปใน files
                if (embed.image) {
                    messageOptions.files = messageOptions.files || [];
                    messageOptions.files.push({
                        attachment: embed.image.url,
                        name: 'embed-image.png'
                    });
                }
            }
        }
        
        // ตรวจสอบคำสั่งพิเศษในข้อความที่แปลง embeds ด้วย
        if (messageOptions.content) {
            const result = processSpecialCommands(messageOptions.content, message.channel.id, destinationChannel.id);
            messageOptions.content = result.content;
        }
        
        // ส่งข้อความไปยังช่องปลายทาง
        await destinationChannel.send(messageOptions);
        console.log(`ส่งข้อความสำเร็จ!`);
        
    } catch (error) {
        console.error(`เกิดข้อผิดพลาดในการส่งข้อความ: ${error.message}`);
    }
}

// ฟังก์ชั่นเพิ่มเติมสำหรับตรวจสอบข้อความในช่องปลายทาง
function checkDestinationMessage(message) {
    // ตรวจสอบว่าเป็นข้อความในช่องปลายทางที่ต้องการตรวจสอบหรือไม่
    if (message.guild && message.guild.id === config.destinationServerId && 
        config.specialFilterChannels.includes(message.channel.id)) {
        
        // ถ้ามีข้อความ @บทบาท-ที่ไม่รู้จัก ให้ลบทันที
        if (message.content && message.content.includes('@บทบาท-ที่ไม่รู้จัก')) {
            try {
                console.log(`พบ @บทบาท-ที่ไม่รู้จัก ในช่อง ${message.channel.id} กำลังลบข้อความ...`);
                message.delete().then(() => {
                    console.log(`ลบข้อความสำเร็จ!`);
                }).catch(error => {
                    console.error(`ไม่สามารถลบข้อความได้: ${error.message}`);
                });
            } catch (error) {
                console.error(`เกิดข้อผิดพลาดในการลบข้อความ: ${error.message}`);
            }
            return true;
        }
    }
    return false;
}

// ฟังก์ชั่นหลักที่จะทำงานเมื่อบอทพร้อมใช้งาน
client.on('ready', async () => {
    console.log(`ล็อกอินสำเร็จในฐานะ ${client.user.tag}`);
    console.log(`บอทพร้อมรับข้อความใหม่แล้ว! กำลังตรวจสอบช่อง:`);
    
    // แสดงรายการช่องที่กำลังติดตาม
    for (const [sourceId, destId] of Object.entries(config.channels)) {
        const channelName = config.channelNames[sourceId] || sourceId;
        console.log(`- ติดตาม ${channelName} (${sourceId}) -> (${destId})`);
    }
    
    console.log(`บอทจะจัดการคำสั่งพิเศษดังนี้:`);
    console.log(`- ถ้าเจอ ?banner ในห้อง challenge จะแท็ก role ID ${config.challengeRoleId}`);
    console.log(`- ถ้าเจอ ?banner ในห้องอื่นๆ หรือ ?challenge จะแท็ก role ID ${config.commandRoleId}`);
    console.log(`- ลบ @บทบาท-ที่ไม่รู้จัก ออกจากข้อความในช่อง:`);
    for (const channelId of config.specialFilterChannels) {
        console.log(`  - ${channelId}`);
    }
});

// คอยรับข้อความใหม่เท่านั้น
client.on('messageCreate', async (message) => {
    // ตรวจสอบข้อความในช่องปลายทางก่อน
    if (checkDestinationMessage(message)) {
        return; // ถ้ามีการจัดการข้อความในช่องปลายทางแล้ว ให้จบการทำงาน
    }
    
    // ตรวจสอบว่าเป็นข้อความจากช่องและเซิร์ฟเวอร์ที่ต้องการหรือไม่
    if (message.guild && message.guild.id === config.sourceServerId) {
        const destChannelId = config.channels[message.channel.id];
        
        if (destChannelId) {
            // หาช่องปลายทาง
            const destChannel = client.channels.cache.get(destChannelId);
            if (destChannel) {
                await transferMessage(message, destChannel);
            } else {
                console.error(`ไม่พบช่องปลายทาง ${destChannelId}`);
            }
        }
    }
});

// ล็อกอินเข้าสู่บัญชี Discord
client.login(USER_TOKEN);

// โค้ดเพิ่มเติมสำหรับการทำงานต่อเนื่อง
process.on('unhandledRejection', error => {
    console.error('ข้อผิดพลาดที่ไม่ได้จัดการ:', error);
});
