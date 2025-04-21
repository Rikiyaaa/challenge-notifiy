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
        '1332169081314476063': '1363809293287293070', //challenge
        '1362084541170192455': '1363789018327945276' // banner
    },
    
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
    commandRoleId: '1363795020552994896', // บทบาทสำหรับคำสั่งทั่วไป
    bannerRoleId: '1363794959786053702',  // บทบาทสำหรับ banner
    challengeRoleId: '1363795020552994896' // บทบาทสำหรับ challenge
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
function processSpecialCommands(content, channelId) {
    let newContent = content;
    let hasCommand = false;
    
    // ลบ @บทบาท-ที่ไม่รู้จัก
    if (newContent.includes('@บทบาท-ที่ไม่รู้จัก')) {
        newContent = removeUnknownRoleMentions(newContent);
        hasCommand = true;
        console.log(`พบ @บทบาท-ที่ไม่รู้จัก ลบออกแล้ว`);
    }
    
    // แก้ไขตรงนี้: ตรวจสอบคำสั่ง ?banner - ใช้ bannerRoleId เสมอ
    if (newContent.includes('?banner')) {
        newContent = newContent.replace(/\?banner/g, `<@&${config.bannerRoleId}>`);
        hasCommand = true;
        console.log(`พบ ?banner แทนที่ด้วย role ID ${config.bannerRoleId}`);
    }
    
    // แก้ไขตรงนี้: ตรวจสอบคำสั่ง ?challenge - ใช้ challengeRoleId เสมอ
    if (newContent.includes('?challenge')) {
        newContent = newContent.replace(/\?challenge/g, `<@&${config.challengeRoleId}>`);
        hasCommand = true;
        console.log(`พบ ?challenge แทนที่ด้วย role ID ${config.challengeRoleId}`);
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
        
        // ตรวจสอบคำสั่งพิเศษ
        if (content) {
            const result = processSpecialCommands(content, message.channel.id);
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
            const result = processSpecialCommands(messageOptions.content, message.channel.id);
            messageOptions.content = result.content;
        }
        
        // ส่งข้อความไปยังช่องปลายทาง
        await destinationChannel.send(messageOptions);
        console.log(`ส่งข้อความสำเร็จ!`);
        
    } catch (error) {
        console.error(`เกิดข้อผิดพลาดในการส่งข้อความ: ${error.message}`);
    }
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
    console.log(`- ลบ @บทบาท-ที่ไม่รู้จัก ออกจากข้อความทั้งหมด`);
    console.log(`- ถ้าเจอ ?banner จะแท็ก role ID ${config.bannerRoleId}`);
    console.log(`- ถ้าเจอ ?challenge จะแท็ก role ID ${config.challengeRoleId}`);
});

// คอยรับข้อความใหม่เท่านั้น
client.on('messageCreate', async (message) => {
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
