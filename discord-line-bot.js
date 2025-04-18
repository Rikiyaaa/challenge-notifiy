const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const express = require('express');
require('dotenv').config();

// Configuration
const USER_TOKEN = process.env.USER_TOKEN;
const CHANNEL_IDS = {
  FIRST_CHANNEL: '1362084541170192455', // Challenge channel
  SECOND_CHANNEL: '1332169081314476063'  // Banner/Gacha channel
};

// LINE Configuration
const LINE_TOKEN = process.env.LINE_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;

// Gemini Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// สร้าง Discord Client
const client = new Client({
  checkUpdate: false
});

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// รายการรอเพื่อสร้าง Carousel
const pendingImages = {
  [CHANNEL_IDS.FIRST_CHANNEL]: null, // Challenge image
  [`${CHANNEL_IDS.SECOND_CHANNEL}_standard`]: null, // Standard gacha
  [`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`]: null, // Rate-up gacha
  lastUpdate: Date.now()
};

// ระยะเวลารอก่อนส่ง (ถ้าไม่ได้รับครบ) - 3 นาที
const WAIT_TIME = 3 * 60 * 1000;

// Function to analyze image with Gemini (only for challenge images)
async function analyzeImageWithGemini(imageUrl) {
  try {
    console.log(`กำลังวิเคราะห์รูปภาพด้วย Gemini: ${imageUrl}`);
    
    // ดาวน์โหลดรูปภาพเป็น buffer โดยตรงไม่บันทึกลงดิสก์
    const imageResponse = await axios.get(imageUrl, { 
      responseType: 'arraybuffer',
      timeout: 30000 // เพิ่ม timeout เป็น 30 วินาที
    });
    
    let imageBuffer = Buffer.from(imageResponse.data);
    
    // แปลง buffer เป็น base64
    let base64Image = imageBuffer.toString('base64');
    
    // ส่งไปที่ Gemini สำหรับการวิเคราะห์โดยใช้โมเดล Vision
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: "ระบุ item drops ที่ปรากฏอยู่ในรูปภาพ กรุณาระบุชื่อของ item และจำนวนเเละเปอร์เซ็น แสดงข้อมูลในรูปแบบรายการที่เป็นระเบียบ ไม่ต้องพิมพ์ แน่นอน นี่คือรายการ item drops ที่ปรากฏในรูปภาพพิมพ์เเค่ข้อมูล item" },
            { 
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }
      ]
    });
    
    // ทำความสะอาด buffer เพื่อให้ garbage collector ทำงาน
    imageBuffer = null;
    base64Image = null;
    
    return response.text;
  } catch (error) {
    console.error('เกิดข้อผิดพลาดในการวิเคราะห์รูปภาพด้วย Gemini:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return "ไม่สามารถวิเคราะห์รูปภาพได้ เกิดข้อผิดพลาด";
  }
}

// สกัดเฉพาะชื่อไอเทมออกจากข้อความ
function extractItemNames(itemDropsText) {
  // แยกข้อความเป็นบรรทัด
  const lines = itemDropsText.split('\n');
  
  // อาร์เรย์เก็บชื่อไอเทม
  const itemNames = [];
  
  // ประมวลผลแต่ละบรรทัด
  for (const line of lines) {
    // ข้ามบรรทัดว่าง
    if (!line.trim()) continue;
    
    // ลบเครื่องหมาย * ที่อาจมีอยู่ที่จุดเริ่มต้นของบรรทัดและตัดช่องว่างทั้งหมด
    let cleanLine = line.trim();
    if (cleanLine.startsWith('*')) {
      cleanLine = cleanLine.substring(1).trim();
    }
    
    let itemName = "";
    
    // กรณีที่มีวงเล็บ (x...) ให้ใช้ข้อความก่อนวงเล็บ
    const parenIndex = cleanLine.indexOf('(');
    if (parenIndex !== -1) {
      itemName = cleanLine.substring(0, parenIndex).trim();
    } 
    // กรณีที่มี x ตามด้วยตัวเลข (เช่น x1-2, x3~5)
    else if (cleanLine.includes('x') && /x\d/.test(cleanLine)) {
      const xIndex = cleanLine.indexOf('x');
      // ตรวจสอบว่า x ที่พบเป็น x ที่ตามด้วยตัวเลขหรือไม่
      if (xIndex > 0 && /\d/.test(cleanLine[xIndex + 1])) {
        itemName = cleanLine.substring(0, xIndex).trim();
      } else {
        // ถ้าไม่มีรูปแบบที่ชัดเจน ใช้ทั้งบรรทัด
        itemName = cleanLine.trim();
      }
    } else {
      // ถ้าไม่พบรูปแบบใดๆ ลองแยกโดยเอาเฉพาะข้อความก่อนตัวเลขแรกหรือเครื่องหมาย
      const match = cleanLine.match(/^(.*?)(?:\d|%|,)/);
      if (match && match[1].trim()) {
        itemName = match[1].trim();
      } else {
        // ถ้าไม่พบรูปแบบใดๆ เลย ใช้ทั้งบรรทัด
        itemName = cleanLine.trim();
      }
    }
    
    // ตรวจสอบว่าได้ชื่อไอเทมหรือไม่ และเพิ่มเข้าอาร์เรย์
    if (itemName) {
      itemNames.push(itemName);
    }
  }
  
  // เชื่อมชื่อไอเทมด้วยเครื่องหมายจุลภาค
  return itemNames.join(', ');
}

// สร้าง bubble สำหรับ Challenge (FIRST_CHANNEL)
function createChallengeBubble(imageUrl, itemDropsText, author) {
  return {
    type: "bubble",
    hero: {
      type: "image",
      url: imageUrl,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover"
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "ข้อมูล Challenge",
          weight: "bold",
          size: "xl",
          color: "#27ACB2"
        },
        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "🎁 รางวัล",
              weight: "bold",
              color: "#aaaaaa"
            },
            {
              type: "box",
              layout: "vertical",
              margin: "lg",
              contents: [
                {
                  type: "text",
                  text: itemDropsText,
                  wrap: true,
                  size: "sm"
                }
              ]
            },
            {
              type: "separator",
              margin: "md"
            },
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              margin: "md",
              contents: [
                {
                  type: "text",
                  text: "👤",
                  color: "#aaaaaa",
                  size: "sm",
                  flex: 1
                },
                {
                  type: "text",
                  text: author,
                  wrap: true,
                  color: "#666666",
                  size: "sm",
                  flex: 5
                }
              ]
            },
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: "⏰",
                  color: "#aaaaaa",
                  size: "sm",
                  flex: 1
                },
                {
                  type: "text",
                  text: new Date().toLocaleString('th-TH'),
                  wrap: true,
                  color: "#666666",
                  size: "sm",
                  flex: 5
                }
              ]
            }
          ]
        }
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          height: "sm",
          action: {
            type: "uri",
            label: "ดูรูปภาพ",
            uri: imageUrl
          },
          color: "#27ACB2"
        }
      ],
      flex: 0
    }
  };
}

// สร้าง bubble สำหรับ Gacha Banner (SECOND_CHANNEL)
function createBannerBubble(imageUrl, author, isStandard) {
  return {
    type: "bubble",
    hero: {
      type: "image",
      url: imageUrl,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover"
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: isStandard ? "Standard Gacha" : "Rate-up Gacha",
          weight: "bold",
          size: "xl",
          color: isStandard ? "#E32C82" : "#B600FF"
        },
        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "📅 Summon Banner",
              weight: "bold",
              color: "#aaaaaa"
            },
            {
              type: "separator",
              margin: "md"
            },
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              margin: "md",
              contents: [
                {
                  type: "text",
                  text: "👤",
                  color: "#aaaaaa",
                  size: "sm",
                  flex: 1
                },
                {
                  type: "text",
                  text: author,
                  wrap: true,
                  color: "#666666",
                  size: "sm",
                  flex: 5
                }
              ]
            },
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: "⏰",
                  color: "#aaaaaa",
                  size: "sm",
                  flex: 1
                },
                {
                  type: "text",
                  text: new Date().toLocaleString('th-TH'),
                  wrap: true,
                  color: "#666666",
                  size: "sm",
                  flex: 5
                }
              ]
            }
          ]
        }
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          height: "sm",
          action: {
            type: "uri",
            label: "ดูรูปภาพ",
            uri: imageUrl
          },
          color: isStandard ? "#FF6B00" : "#B600FF"
        }
      ],
      flex: 0
    }
  };
}

// ฟังก์ชันส่ง Carousel Flex Message
async function sendCarouselToLine() {
  try {
    // ตรวจสอบว่ามีรูปภาพที่รอส่งหรือไม่
    const hasChallenge = pendingImages[CHANNEL_IDS.FIRST_CHANNEL];
    const hasStandardGacha = pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_standard`];
    const hasRateUpGacha = pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`];
    
    if (!hasChallenge && !hasStandardGacha && !hasRateUpGacha) {
      console.log('ไม่มีรูปภาพที่รอส่ง');
      return;
    }

    const bubbles = [];
    let itemNamesForAltText = [];
    
    // เพิ่ม bubble สำหรับรูปภาพ Challenge (ถ้ามี)
    if (hasChallenge) {
      const { imageUrl, itemDropsText, author } = hasChallenge;
      bubbles.push(createChallengeBubble(imageUrl, itemDropsText, author));
      
      // เก็บชื่อ item สำหรับ altText
      const itemNames = extractItemNames(itemDropsText);
      if (itemNames) {
        itemNamesForAltText.push(itemNames);
      }
    }
    
    // เพิ่ม bubble สำหรับ Standard Gacha (ถ้ามี)
    if (hasStandardGacha) {
      const { imageUrl, author } = hasStandardGacha;
      bubbles.push(createBannerBubble(imageUrl, author, true));
      itemNamesForAltText.push("Standard Gacha");
    }
    
    // เพิ่ม bubble สำหรับ Rate-up Gacha (ถ้ามี)
    if (hasRateUpGacha) {
      const { imageUrl, author } = hasRateUpGacha;
      bubbles.push(createBannerBubble(imageUrl, author, false));
      itemNamesForAltText.push("Rate-up Gacha");
    }
    
    if (bubbles.length === 0) {
      console.log('ไม่มี bubble ที่จะส่ง');
      return;
    }
    
    // สร้าง altText จากชื่อ item
    const altText = itemNamesForAltText.join(', ').substring(0, 150); // จำกัดความยาว altText
    
    // สร้าง Carousel Flex Message
    const carouselMessage = {
      type: "flex",
      altText: altText || "ข้อมูล Challenge และ Gacha",
      contents: {
        type: "carousel",
        contents: bubbles
      }
    };

    // ส่ง Carousel ไปยัง LINE
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: LINE_USER_ID,
      messages: [carouselMessage]
    }, {
      headers: {
        'Authorization': `Bearer ${LINE_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`ส่ง Carousel Flex Message ไปยัง LINE สำเร็จ (จำนวน ${bubbles.length} รูปภาพ)`);
    
    // ล้างรายการที่รอส่ง
    pendingImages[CHANNEL_IDS.FIRST_CHANNEL] = null;
    pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_standard`] = null;
    pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`] = null;
    pendingImages.lastUpdate = Date.now();
    
  } catch (error) {
    console.error('เกิดข้อผิดพลาดในการส่ง Carousel Flex Message:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// ฟังก์ชันเพิ่มรูปภาพจาก Challenge Channel
async function addChallengeImage(imageUrl, author) {
  try {
    // วิเคราะห์รูปภาพ Challenge ด้วย Gemini
    const itemDropsText = await analyzeImageWithGemini(imageUrl);
    console.log(`ผลการวิเคราะห์รูปภาพ Challenge:`, itemDropsText);
    
    // เก็บข้อมูลรูปภาพ
    pendingImages[CHANNEL_IDS.FIRST_CHANNEL] = {
      imageUrl,
      itemDropsText,
      author
    };
    pendingImages.lastUpdate = Date.now();
    
    console.log(`เพิ่มรูปภาพ Challenge เข้าคิวรอส่งแล้ว`);
    
    // ตรวจสอบว่าควรส่ง Carousel เลยหรือไม่
    checkIfShouldSendCarousel();
  } catch (error) {
    console.error(`เกิดข้อผิดพลาดในการเพิ่มรูปภาพ Challenge เข้าคิวรอส่ง:`, error);
  }
}

// ฟังก์ชันเพิ่มรูปภาพจาก Banner Channel
async function addBannerImage(imageUrl, author, isStandard) {
  try {
    const key = isStandard ? 
      `${CHANNEL_IDS.SECOND_CHANNEL}_standard` : 
      `${CHANNEL_IDS.SECOND_CHANNEL}_rateup`;
    
    // เก็บข้อมูลรูปภาพ (ไม่ต้องวิเคราะห์ด้วย Gemini)
    pendingImages[key] = {
      imageUrl,
      author
    };
    pendingImages.lastUpdate = Date.now();
    
    console.log(`เพิ่มรูปภาพ ${isStandard ? 'Standard' : 'Rate-up'} Gacha เข้าคิวรอส่งแล้ว`);
    
    // ตรวจสอบว่าควรส่ง Carousel เลยหรือไม่
    checkIfShouldSendCarousel();
  } catch (error) {
    console.error(`เกิดข้อผิดพลาดในการเพิ่มรูปภาพ Banner เข้าคิวรอส่ง:`, error);
  }
}

// ตรวจสอบว่าควรส่ง Carousel เลยหรือไม่
function checkIfShouldSendCarousel() {
  // ตรวจสอบว่ามีรูปภาพทั้งหมดแล้วหรือไม่ (มี Challenge + Standard Gacha + Rate-up Gacha)
  if (pendingImages[CHANNEL_IDS.FIRST_CHANNEL] && 
      pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_standard`] && 
      pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`]) {
    console.log('ได้รับรูปภาพครบทั้ง 3 ประเภทแล้ว กำลังส่ง Carousel Flex Message...');
    sendCarouselToLine();
  }
}

// ฟังก์ชันตรวจสอบคิวรอส่งเป็นระยะ
function checkPendingQueue() {
  const now = Date.now();
  // ถ้ามีอย่างน้อย 1 รูปภาพในคิวรอส่ง และรอมานานกว่า WAIT_TIME แล้ว
  if ((pendingImages[CHANNEL_IDS.FIRST_CHANNEL] || 
       pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_standard`] || 
       pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`]) && 
      (now - pendingImages.lastUpdate >= WAIT_TIME)) {
    console.log(`รอนานกว่า ${WAIT_TIME / 60000} นาทีแล้ว กำลังส่ง Carousel Flex Message ที่มีอยู่...`);
    sendCarouselToLine();
  }
}

// จัดการกับ Banner Images (ตัดสินใจว่าเป็น Standard หรือ Rate-up)
let lastBannerImageTimestamp = 0;
async function processBannerImage(imageUrl, author, timestamp) {
  // ถ้าเป็นรูปแรกที่ได้รับหรือเวลาผ่านไปนานกว่า 1 นาที ถือว่าเป็นชุดใหม่
  if (timestamp - lastBannerImageTimestamp > 60000) {
    // รีเซ็ตสถานะ Gacha Images
    pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_standard`] = null;
    pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`] = null;
    
    // ถือว่ารูปแรกเป็น Standard Gacha
    await addBannerImage(imageUrl, author, true);
  } else {
    // ถือว่ารูปถัดไปเป็น Rate-up Gacha
    await addBannerImage(imageUrl, author, false);
  }
  
  // อัปเดตเวลาล่าสุด
  lastBannerImageTimestamp = timestamp;
}

// ฟังก์ชันดึงข้อความล่าสุดจากช่องที่ระบุ
async function fetchLatestMessages(channelId) {
  try {
    console.log(`กำลังดึงข้อความล่าสุดจากช่อง ${channelId}...`);
    const channel = await client.channels.fetch(channelId);
    
    if (!channel) {
      console.error(`ไม่พบช่อง ${channelId}`);
      return;
    }
    
    // ดึงข้อความล่าสุด 10 ข้อความ
    const messages = await channel.messages.fetch({ limit: 10 });
    
    // ตรวจสอบข้อความที่มีรูปภาพในช่วง 10 นาทีที่ผ่านมา
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    
    let processedImages = 0;
    
    for (const message of messages.values()) {
      // ตรวจสอบเฉพาะข้อความใหม่ในช่วง 10 นาทีที่ผ่านมา
      if (message.createdTimestamp > tenMinutesAgo && message.attachments.size > 0) {
        for (const attachment of message.attachments.values()) {
          if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            console.log(`ตรวจพบรูปภาพใหม่จาก ${message.author.username} ในช่อง ${channelId}: ${attachment.url}`);
            
            if (channelId === CHANNEL_IDS.FIRST_CHANNEL) {
              // สำหรับ Challenge Channel เราใช้เพียงรูปแรกที่พบ
              if (processedImages === 0) {
                await addChallengeImage(attachment.url, message.author.username);
                processedImages++;
                break;
              }
            } else if (channelId === CHANNEL_IDS.SECOND_CHANNEL) {
              // สำหรับ Banner Channel เรารับได้ 2 รูป
              if (processedImages < 2) {
                await processBannerImage(attachment.url, message.author.username, message.createdTimestamp);
                processedImages++;
              }
            }
          }
        }
        
        // สำหรับ Banner Channel เราหยุดเมื่อได้รับ 2 รูปแล้ว
        if (channelId === CHANNEL_IDS.SECOND_CHANNEL && processedImages >= 2) {
          break;
        }
        // สำหรับ Challenge Channel เราหยุดเมื่อได้รับ 1 รูปแล้ว
        else if (channelId === CHANNEL_IDS.FIRST_CHANNEL && processedImages >= 1) {
          break;
        }
      }
    }
    
    if (processedImages === 0) {
      console.log(`ไม่พบรูปภาพใหม่ในช่อง ${channelId}`);
    }
  } catch (error) {
    console.error(`เกิดข้อผิดพลาดในการดึงข้อความล่าสุดจากช่อง ${channelId}:`, error);
  }
}

// เริ่มต้นการทำงานเมื่อบอทพร้อม
client.on('ready', async () => {
  console.log(`เข้าสู่ระบบในชื่อ ${client.user.tag}`);
  console.log('กำลังเริ่มต้นตรวจสอบรูปภาพจากช่อง Discord เพื่อส่งเป็น Carousel Flex Message...');
  
  // เริ่มต้นดึงข้อความล่าสุดจากทั้ง 2 ช่อง
  await fetchLatestMessages(CHANNEL_IDS.FIRST_CHANNEL);
  await fetchLatestMessages(CHANNEL_IDS.SECOND_CHANNEL);
  
  // ตั้งเวลาตรวจสอบคิวรอส่งทุก 1 นาที
  setInterval(checkPendingQueue, 60 * 1000);
  
  // ตั้งเวลาดึงข้อความล่าสุดทุก 10 นาที
  setInterval(async () => {
    await fetchLatestMessages(CHANNEL_IDS.FIRST_CHANNEL);
    await fetchLatestMessages(CHANNEL_IDS.SECOND_CHANNEL);
  }, 10 * 60 * 1000);
});

// ตรวจจับข้อความใหม่ (real-time)
client.on('messageCreate', async message => {
  const channelId = message.channelId;
  
  // ตรวจสอบว่าเป็นช่องที่เราสนใจหรือไม่
  if (channelId === CHANNEL_IDS.FIRST_CHANNEL || channelId === CHANNEL_IDS.SECOND_CHANNEL) {
    // ส่งเฉพาะรูปภาพ
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
          try {
            console.log(`ตรวจพบรูปภาพใหม่จาก ${message.author.username} ในช่อง ${channelId}: ${attachment.url}`);
            
            if (channelId === CHANNEL_IDS.FIRST_CHANNEL) {
              // สำหรับ Challenge Channel
              await addChallengeImage(attachment.url, message.author.username);
              break; // หยุดหลังจากพบรูปภาพแรก
            } else if (channelId === CHANNEL_IDS.SECOND_CHANNEL) {
              // สำหรับ Banner Channel
              await processBannerImage(attachment.url, message.author.username, message.createdTimestamp);
            }
          } catch (error) {
            console.error('เกิดข้อผิดพลาดในการประมวลผลรูปภาพ:', error);
          }
        }
      }
    }
  }
});

// ตรวจจับเมื่อเกิดข้อผิดพลาด
client.on('error', error => {
  console.error('เกิดข้อผิดพลาดในการเชื่อมต่อ Discord:', error);
});

// ตรวจจับเมื่อถูกตัดการเชื่อมต่อ
client.on('disconnect', event => {
  console.log('ถูกตัดการเชื่อมต่อจาก Discord:', event);
  console.log('กำลังพยายามเชื่อมต่อใหม่...');
});

// สร้าง Web Server ง่ายๆ เพื่อให้สามารถเปิดใช้งานบน hosting ได้
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Discord-LINE Integration Bot is running!');
});

app.get('/status', (req, res) => {
  const status = {
    discord: client.user ? `Connected as ${client.user.tag}` : 'Disconnected',
    pendingImages: {
      challenge: pendingImages[CHANNEL_IDS.FIRST_CHANNEL] ? 'Waiting' : 'None',
      standardGacha: pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_standard`] ? 'Waiting' : 'None',
      rateupGacha: pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`] ? 'Waiting' : 'None',
      lastUpdate: new Date(pendingImages.lastUpdate).toLocaleString('th-TH')
    },
    uptime: Math.floor(process.uptime()) + ' seconds'
  };
  
  res.json(status);
});

// เส้นทางสำหรับการบังคับให้ส่ง carousel ที่รออยู่
app.get('/send', async (req, res) => {
  try {
    await sendCarouselToLine();
    res.send('Carousel sent successfully!');
  } catch (error) {
    res.status(500).send('Error sending carousel: ' + error.message);
  }
});

// สร้างเส้นทางสำหรับการดึงข้อมูลล่าสุดจากช่อง
app.get('/fetch', async (req, res) => {
  try {
    await fetchLatestMessages(CHANNEL_IDS.FIRST_CHANNEL);
    await fetchLatestMessages(CHANNEL_IDS.SECOND_CHANNEL);
    res.send('Messages fetched successfully!');
  } catch (error) {
    res.status(500).send('Error fetching messages: ' + error.message);
  }
});

// เริ่มต้น Web Server
app.listen(PORT, () => {
  console.log(`Web Server กำลังทำงานที่พอร์ต ${PORT}`);
});

// ฟังก์ชันจัดการเมื่อเกิดข้อผิดพลาดแบบไม่คาดคิด
process.on('uncaughtException', (error) => {
  console.error('เกิดข้อผิดพลาดแบบไม่คาดคิด:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('เกิด Promise rejection ที่ไม่ได้จัดการ:', error);
});

// ฟังก์ชันสำหรับการ restart bot เป็นระยะ เพื่อป้องกันปัญหา memory leak
function scheduleRestart() {
  // restart ทุก 24 ชั่วโมง
  const restartInterval = 24 * 60 * 60 * 1000;
  
  setTimeout(() => {
    console.log('กำลัง restart bot ตามกำหนดเวลา...');
    process.exit(0); // ออกจากโปรแกรม (ให้ process manager เช่น PM2 restart)
  }, restartInterval);
  
  console.log(`ตั้งเวลา restart bot ทุก ${restartInterval / (60 * 60 * 1000)} ชั่วโมง`);
}

// เริ่มการทำงานหลักของ bot
async function main() {
  try {
    // เข้าสู่ระบบ Discord
    await client.login(USER_TOKEN);
    
    // ตั้งเวลา restart
    scheduleRestart();
    
  } catch (error) {
    console.error('เกิดข้อผิดพลาดในการเริ่มต้นโปรแกรม:', error);
    process.exit(1);
  }
}

// เริ่มต้นโปรแกรม
main();
