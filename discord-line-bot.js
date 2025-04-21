const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const express = require('express');
require('dotenv').config();

// Configuration
const USER_TOKEN = process.env.USER_TOKEN;
const CHANNEL_IDS = {
  FIRST_CHANNEL: '1362084541170192455', // Challenge channel source
  SECOND_CHANNEL: '1332169081314476063', // Banner/Gacha channel source
  CHALLENGE_DESTINATION: '1363789061852233728', // Challenge destination channel
  BANNER_DESTINATION: '1363789018327945276' // Banner destination channel
};

// Role IDs for pinging
const ROLE_IDS = {
  CHALLENGE_ROLE: '1363794959786053702',
  BANNER_ROLE: '1363795020552994896'
};

// สร้าง Discord Client
const client = new Client({
  checkUpdate: false
});

// รายการรอเพื่อส่งข้อความ
const pendingImages = {
  [CHANNEL_IDS.FIRST_CHANNEL]: null, // Challenge image
  [`${CHANNEL_IDS.SECOND_CHANNEL}_standard`]: null, // Standard gacha
  [`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`]: null, // Rate-up gacha
  lastUpdate: Date.now()
};

// ระยะเวลารอก่อนส่ง (ถ้าไม่ได้รับครบ) - 3 นาที
const WAIT_TIME = 3 * 60 * 1000;

// เพิ่มการจัดเก็บประวัติรูปภาพที่ส่งไปแล้ว
const sentImagesHistory = {
  urls: new Set(),
  lastSentTime: 0,
  // บันทึกสถานะล่าสุดเพื่อป้องกันการส่งซ้ำ
  lastSentState: null,
  
  // เพิ่มรูปภาพเข้าประวัติ
  addImage(url) {
    this.urls.add(url);
    
    // จำกัดขนาดของประวัติไม่ให้ใหญ่เกินไป (เก็บ 100 URL ล่าสุด)
    if (this.urls.size > 100) {
      const urlsArray = Array.from(this.urls);
      this.urls = new Set(urlsArray.slice(urlsArray.length - 100));
    }
  },
  
  // ตรวจสอบว่าเคยส่งรูปภาพนี้ไปแล้วหรือไม่
  hasImage(url) {
    return this.urls.has(url);
  },
  
  // บันทึกสถานะล่าสุดที่ส่ง
  saveLastSentState(challenge, standardGacha, rateUpGacha) {
    this.lastSentState = {
      challenge: challenge ? {...challenge} : null,
      standardGacha: standardGacha ? {...standardGacha} : null,
      rateUpGacha: rateUpGacha ? {...rateUpGacha} : null
    };
    this.lastSentTime = Date.now();
  },
  
  // ตรวจสอบว่าสถานะปัจจุบันเหมือนกับสถานะล่าสุดที่ส่งไปหรือไม่
  isSameAsLastSent(challenge, standardGacha, rateUpGacha) {
    if (!this.lastSentState) return false;
    
    const sameChallenge = (!challenge && !this.lastSentState.challenge) || 
                          (challenge && this.lastSentState.challenge && 
                           challenge.imageUrl === this.lastSentState.challenge.imageUrl);
                           
    const sameStandard = (!standardGacha && !this.lastSentState.standardGacha) || 
                         (standardGacha && this.lastSentState.standardGacha && 
                          standardGacha.imageUrl === this.lastSentState.standardGacha.imageUrl);
                          
    const sameRateUp = (!rateUpGacha && !this.lastSentState.rateUpGacha) || 
                       (rateUpGacha && this.lastSentState.rateUpGacha && 
                        rateUpGacha.imageUrl === this.lastSentState.rateUpGacha.imageUrl);
                        
    return sameChallenge && sameStandard && sameRateUp;
  },
  
  // ตรวจสอบว่าควรจะส่งหรือไม่ (ตรวจสอบเวลาและความเหมือน)
  shouldSend(challenge, standardGacha, rateUpGacha) {
    // ถ้าไม่เคยส่งอะไรมาก่อน ให้ส่งได้
    if (!this.lastSentState) return true;
    
    // ถ้าเนื้อหาเหมือนกับที่ส่งล่าสุด และยังไม่เกิน 1 ชั่วโมง ไม่ต้องส่งซ้ำ
    if (this.isSameAsLastSent(challenge, standardGacha, rateUpGacha) && 
        (Date.now() - this.lastSentTime < 60 * 60 * 1000)) {
      return false;
    }
    
    return true;
  }
};

// ฟังก์ชันส่งข้อความไปยัง Discord Channel
async function sendToDiscordChannel(imageInfo, isChallenge) {
  try {
    // ตรวจสอบว่ามีรูปภาพที่รอส่งหรือไม่
    if (!imageInfo) {
      console.log(`ไม่มีรูปภาพ ${isChallenge ? 'Challenge' : 'Banner'} ที่รอส่ง`);
      return;
    }
    
    // เลือก Channel ปลายทาง
    const destinationChannelId = isChallenge ? 
      CHANNEL_IDS.CHALLENGE_DESTINATION : 
      CHANNEL_IDS.BANNER_DESTINATION;
    
    const destinationChannel = client.channels.cache.get(destinationChannelId);
    if (!destinationChannel) {
      console.error(`ไม่พบช่องปลายทาง ${destinationChannelId}`);
      return;
    }
    
    // เลือก Role ที่จะปิง
    const roleId = isChallenge ? ROLE_IDS.CHALLENGE_ROLE : ROLE_IDS.BANNER_ROLE;
    
    // สร้างข้อความพร้อมปิง Role
    let messageContent = `<@&${roleId}> `;
    
    if (isChallenge) {
      messageContent += `New Challenge from ${imageInfo.author}`;
    } else {
      messageContent += `New ${imageInfo.isStandard ? 'Standard' : 'Rate-up'} Banner from ${imageInfo.author}`;
    }
    
    // ส่งข้อความพร้อมรูปภาพ
    await destinationChannel.send({
      content: messageContent,
      files: [imageInfo.imageUrl]
    });
    
    console.log(`ส่งรูปภาพ ${isChallenge ? 'Challenge' : 'Banner'} ไปยัง Discord Channel ${destinationChannelId} สำเร็จ`);
    
    // เพิ่มรูปภาพเข้าประวัติ
    sentImagesHistory.addImage(imageInfo.imageUrl);
    
    return true;
  } catch (error) {
    console.error(`เกิดข้อผิดพลาดในการส่งข้อความไปยัง Discord Channel:`, error);
    return false;
  }
}

// ฟังก์ชันส่งข้อความทั้งหมดที่รอส่ง
async function sendPendingMessages() {
  try {
    // ตรวจสอบว่ามีรูปภาพที่รอส่งหรือไม่
    const challenge = pendingImages[CHANNEL_IDS.FIRST_CHANNEL];
    const standardGacha = pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_standard`];
    const rateUpGacha = pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`];
    
    if (!challenge && !standardGacha && !rateUpGacha) {
      console.log('ไม่มีรูปภาพที่รอส่ง');
      return;
    }
    
    // ตรวจสอบว่าควรส่งหรือไม่ (กันการส่งซ้ำ)
    if (!sentImagesHistory.shouldSend(challenge, standardGacha, rateUpGacha)) {
      console.log('ข้อมูลเหมือนกับที่ส่งล่าสุดและยังไม่ถึงเวลาส่งใหม่ ข้ามการส่ง...');
      return;
    }
    
    // ส่ง Challenge (ถ้ามี)
    if (challenge) {
      await sendToDiscordChannel(challenge, true);
    }
    
    // ส่ง Standard Gacha (ถ้ามี)
    if (standardGacha) {
      await sendToDiscordChannel(standardGacha, false);
    }
    
    // ส่ง Rate-up Gacha (ถ้ามี)
    if (rateUpGacha) {
      await sendToDiscordChannel(rateUpGacha, false);
    }
    
    // บันทึกสถานะล่าสุดที่ส่ง
    sentImagesHistory.saveLastSentState(challenge, standardGacha, rateUpGacha);
    
    // ล้างรายการที่รอส่ง
    pendingImages[CHANNEL_IDS.FIRST_CHANNEL] = null;
    pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_standard`] = null;
    pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`] = null;
    pendingImages.lastUpdate = Date.now();
    
  } catch (error) {
    console.error('เกิดข้อผิดพลาดในการส่งข้อความที่รอส่ง:', error);
  }
}

// ฟังก์ชันเพิ่มรูปภาพจาก Challenge Channel
async function addChallengeImage(imageUrl, author) {
  try {
    // ตรวจสอบว่าเคยส่งรูปภาพนี้ไปแล้วหรือไม่ (กันการทำงานซ้ำซ้อน)
    if (sentImagesHistory.hasImage(imageUrl)) {
      console.log(`รูปภาพ Challenge นี้เคยส่งไปแล้ว ข้ามการประมวลผล: ${imageUrl}`);
      return;
    }
    
    // เก็บข้อมูลรูปภาพ
    pendingImages[CHANNEL_IDS.FIRST_CHANNEL] = {
      imageUrl,
      author
    };
    pendingImages.lastUpdate = Date.now();
    
    console.log(`เพิ่มรูปภาพ Challenge เข้าคิวรอส่งแล้ว`);
    
    // ตรวจสอบว่าควรส่งเลยหรือไม่
    checkIfShouldSendMessages();
  } catch (error) {
    console.error(`เกิดข้อผิดพลาดในการเพิ่มรูปภาพ Challenge เข้าคิวรอส่ง:`, error);
  }
}

// ฟังก์ชันเพิ่มรูปภาพจาก Banner Channel
async function addBannerImage(imageUrl, author, isStandard) {
  try {
    // ตรวจสอบว่าเคยส่งรูปภาพนี้ไปแล้วหรือไม่ (กันการทำงานซ้ำซ้อน)
    if (sentImagesHistory.hasImage(imageUrl)) {
      console.log(`รูปภาพ ${isStandard ? 'Standard' : 'Rate-up'} Banner นี้เคยส่งไปแล้ว ข้าม: ${imageUrl}`);
      return;
    }
    
    const key = isStandard ? 
      `${CHANNEL_IDS.SECOND_CHANNEL}_standard` : 
      `${CHANNEL_IDS.SECOND_CHANNEL}_rateup`;
    
    // เก็บข้อมูลรูปภาพ
    pendingImages[key] = {
      imageUrl,
      author,
      isStandard
    };
    pendingImages.lastUpdate = Date.now();
    
    console.log(`เพิ่มรูปภาพ ${isStandard ? 'Standard' : 'Rate-up'} Banner เข้าคิวรอส่งแล้ว`);
    
    // ตรวจสอบว่าควรส่งเลยหรือไม่
    checkIfShouldSendMessages();
  } catch (error) {
    console.error(`เกิดข้อผิดพลาดในการเพิ่มรูปภาพ Banner เข้าคิวรอส่ง:`, error);
  }
}

// ตรวจสอบว่าควรส่งข้อความเลยหรือไม่
function checkIfShouldSendMessages() {
  // ตรวจสอบว่ามีรูปภาพทั้งหมดแล้วหรือไม่ (มี Challenge + Standard Gacha + Rate-up Gacha)
  if (pendingImages[CHANNEL_IDS.FIRST_CHANNEL] && 
      pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_standard`] && 
      pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`]) {
    console.log('ได้รับรูปภาพครบทั้ง 3 ประเภทแล้ว กำลังส่งข้อความ...');
    sendPendingMessages();
  }
}

// ฟังก์ชันตรวจสอบคิวรอส่งเป็นระยะ
function checkPendingQueue() {
  const now = Date.now();
  
  const challenge = pendingImages[CHANNEL_IDS.FIRST_CHANNEL];
  const standardGacha = pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_standard`];
  const rateUpGacha = pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`];
  
  // มีอย่างน้อย 1 รูปภาพในคิวรอส่ง
  const hasAtLeastOneImage = challenge || standardGacha || rateUpGacha;
  
  // ถ้ามีรูปในคิวและรอมานานกว่า WAIT_TIME แล้ว
  if (hasAtLeastOneImage && (now - pendingImages.lastUpdate >= WAIT_TIME)) {
    // ตรวจสอบว่าควรส่งหรือไม่ (กันการส่งซ้ำ)
    if (sentImagesHistory.shouldSend(challenge, standardGacha, rateUpGacha)) {
      console.log(`รอนานกว่า ${WAIT_TIME / 60000} นาทีแล้ว กำลังส่งข้อความที่มีอยู่...`);
      sendPendingMessages();
    } else {
      console.log('ข้อมูลเหมือนกับที่ส่งล่าสุดและยังไม่ถึงเวลาส่งใหม่ ล้างคิวรอส่ง...');
      // ล้างคิวเพื่อป้องกันการส่งซ้ำในรอบถัดไป
      pendingImages[CHANNEL_IDS.FIRST_CHANNEL] = null;
      pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_standard`] = null;
      pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`] = null;
      pendingImages.lastUpdate = now;
    }
  }
}

// ฟังก์ชันดึงข้อความล่าสุดจากช่อง
async function fetchLatestMessages(channelId, limit = 5) {
  try {
    const channel = client.channels.cache.get(channelId);
    if (!channel) {
      console.error(`ไม่พบช่อง ${channelId}`);
      return;
    }
    
    // ดึงข้อความล่าสุด
    const messages = await channel.messages.fetch({ limit });
    console.log(`ดึงข้อความล่าสุด ${messages.size} ข้อความจากช่อง ${channelId}`);
    
    // วนลูปตรวจสอบข้อความและรูปภาพ
    for (const [, message] of messages.entries()) {
      // ตรวจสอบเฉพาะข้อความที่มีรูปภาพ
      if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        const imageUrl = attachment.url;
        const author = message.author.username;
        
        // ตรวจสอบว่าเป็นรูปภาพหรือไม่
        if (imageUrl && (imageUrl.endsWith('.jpg') || imageUrl.endsWith('.jpeg') || imageUrl.endsWith('.png'))) {
          console.log(`พบรูปภาพในช่อง ${channelId}: ${imageUrl}`);
          
          // ตรวจสอบประเภทของช่อง
          if (channelId === CHANNEL_IDS.FIRST_CHANNEL) {
            // ช่อง Challenge
            await addChallengeImage(imageUrl, author);
          } else if (channelId === CHANNEL_IDS.SECOND_CHANNEL) {
            // ตรวจสอบว่าเป็น Standard Gacha หรือ Rate-up Gacha
            // ตัวอย่างการตรวจสอบอย่างง่าย: ใช้ชื่อไฟล์หรือคำอธิบายรูปภาพ
            // ในที่นี้สมมติว่าชื่อไฟล์หรือคำอธิบายมีคำว่า "standard" หรือ "permanent"
            const isStandard = 
              (attachment.name && (attachment.name.toLowerCase().includes('standard') || attachment.name.toLowerCase().includes('permanent'))) ||
              (message.content && (message.content.toLowerCase().includes('standard') || message.content.toLowerCase().includes('permanent')));
            
            await addBannerImage(imageUrl, author, isStandard);
          }
        }
      }
    }
  } catch (error) {
    console.error(`เกิดข้อผิดพลาดในการดึงข้อความล่าสุดจากช่อง ${channelId}:`, error);
  }
}

// ตั้งเวลาตรวจสอบข้อความใหม่ทุก 10 นาที
function setupMessageChecking() {
  const CHECK_INTERVAL = 10 * 60 * 1000; // 10 นาที
  
  // ตรวจสอบทันทีเมื่อเริ่มต้น
  setTimeout(async () => {
    await fetchLatestMessages(CHANNEL_IDS.FIRST_CHANNEL);
    await fetchLatestMessages(CHANNEL_IDS.SECOND_CHANNEL);
  }, 5000); // รอ 5 วินาทีหลังจากบอทเริ่มทำงาน
  
  // ตั้งเวลาตรวจสอบเป็นประจำ
  setInterval(async () => {
    console.log('กำลังตรวจสอบข้อความใหม่ในทุกช่อง...');
    await fetchLatestMessages(CHANNEL_IDS.FIRST_CHANNEL);
    await fetchLatestMessages(CHANNEL_IDS.SECOND_CHANNEL);
  }, CHECK_INTERVAL);
  
  // ตั้งเวลาตรวจสอบคิวรอส่งทุก 1 นาที
  setInterval(() => {
    checkPendingQueue();
  }, 60 * 1000); // 1 นาที
}

// เมื่อบอทพร้อมใช้งาน
client.on('ready', () => {
  console.log(`เข้าสู่ระบบในชื่อ ${client.user.tag}!`);
  
  // เริ่มตั้งเวลาตรวจสอบข้อความ
  setupMessageChecking();
});

// เมื่อมีข้อความใหม่ในช่องที่เฝ้าดู
client.on('messageCreate', async (message) => {
  // ตรวจสอบว่าเป็นช่องที่เฝ้าดูหรือไม่
  if (message.channelId === CHANNEL_IDS.FIRST_CHANNEL || message.channelId === CHANNEL_IDS.SECOND_CHANNEL) {
    // ตรวจสอบเฉพาะข้อความที่มีรูปภาพ
    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      const imageUrl = attachment.url;
      const author = message.author.username;
      
      // ตรวจสอบว่าเป็นรูปภาพหรือไม่
      if (imageUrl && (imageUrl.endsWith('.jpg') || imageUrl.endsWith('.jpeg') || imageUrl.endsWith('.png'))) {
        console.log(`พบรูปภาพใหม่ในช่อง ${message.channelId}: ${imageUrl}`);
        
        // ตรวจสอบประเภทของช่อง
        if (message.channelId === CHANNEL_IDS.FIRST_CHANNEL) {
          // ช่อง Challenge
          await addChallengeImage(imageUrl, author);
        } else if (message.channelId === CHANNEL_IDS.SECOND_CHANNEL) {
          // ตรวจสอบว่าเป็น Standard Gacha หรือ Rate-up Gacha
          const isStandard = 
            (attachment.name && (attachment.name.toLowerCase().includes('standard') || attachment.name.toLowerCase().includes('permanent'))) ||
            (message.content && (message.content.toLowerCase().includes('standard') || message.content.toLowerCase().includes('permanent')));
          
          await addBannerImage(imageUrl, author, isStandard);
        }
      }
    }
  }
});

// สร้าง Express server เพื่อให้ Replit ไม่หลับ
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// ทำให้บอทไม่หลุดการเชื่อมต่อ
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// เชื่อมต่อ Discord
client.login(USER_TOKEN);
