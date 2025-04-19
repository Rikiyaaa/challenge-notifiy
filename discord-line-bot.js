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

    const bubbles = [];
    let itemNamesForAltText = [];
    
    // เพิ่ม bubble สำหรับรูปภาพ Challenge (ถ้ามี)
    if (challenge) {
      const { imageUrl, itemDropsText, author } = challenge;
      bubbles.push(createChallengeBubble(imageUrl, itemDropsText, author));
      
      // เก็บชื่อ item สำหรับ altText
      const itemNames = extractItemNames(itemDropsText);
      if (itemNames) {
        itemNamesForAltText.push(itemNames);
      }
      
      // เพิ่มรูปภาพเข้าประวัติ
      sentImagesHistory.addImage(imageUrl);
    }
    
    // เพิ่ม bubble สำหรับ Standard Gacha (ถ้ามี)
    if (standardGacha) {
      const { imageUrl, author } = standardGacha;
      bubbles.push(createBannerBubble(imageUrl, author, true));
      itemNamesForAltText.push("Standard Gacha");
      
      // เพิ่มรูปภาพเข้าประวัติ
      sentImagesHistory.addImage(imageUrl);
    }
    
    // เพิ่ม bubble สำหรับ Rate-up Gacha (ถ้ามี)
    if (rateUpGacha) {
      const { imageUrl, author } = rateUpGacha;
      bubbles.push(createBannerBubble(imageUrl, author, false));
      itemNamesForAltText.push("Rate-up Gacha");
      
      // เพิ่มรูปภาพเข้าประวัติ
      sentImagesHistory.addImage(imageUrl);
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
    
    // บันทึกสถานะล่าสุดที่ส่ง
    sentImagesHistory.saveLastSentState(challenge, standardGacha, rateUpGacha);
    
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
    // ตรวจสอบว่าเคยส่งรูปภาพนี้ไปแล้วหรือไม่ (กันการทำงานซ้ำซ้อน)
    if (sentImagesHistory.hasImage(imageUrl)) {
      console.log(`รูปภาพ Challenge นี้เคยส่งไปแล้ว ข้ามการวิเคราะห์: ${imageUrl}`);
      return;
    }
    
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
    // ตรวจสอบว่าเคยส่งรูปภาพนี้ไปแล้วหรือไม่ (กันการทำงานซ้ำซ้อน)
    if (sentImagesHistory.hasImage(imageUrl)) {
      console.log(`รูปภาพ ${isStandard ? 'Standard' : 'Rate-up'} Gacha นี้เคยส่งไปแล้ว ข้าม: ${imageUrl}`);
      return;
    }
    
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
  
  const challenge = pendingImages[CHANNEL_IDS.FIRST_CHANNEL];
  const standardGacha = pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_standard`];
  const rateUpGacha = pendingImages[`${CHANNEL_IDS.SECOND_CHANNEL}_rateup`];
  
  // มีอย่างน้อย 1 รูปภาพในคิวรอส่ง
  const hasAtLeastOneImage = challenge || standardGacha || rateUpGacha;
  
  // ถ้ามีรูปในคิวและรอมานานกว่า WAIT_TIME แล้ว
  if (hasAtLeastOneImage && (now - pendingImages.lastUpdate >= WAIT_TIME)) {
    // ตรวจสอบว่าควรส่งหรือไม่ (กันการส่งซ้ำ)
    if (sentImagesHistory.shouldSend(challenge, standardGacha, rateUpGacha)) {
      console.log(`รอนานกว่า ${WAIT_TIME / 120000} นาทีแล้ว กำลังส่ง Carousel Flex Message ที่มีอยู่...`);
      sendCarouselToLine();
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

// ฟังก์ชันดึงข้อความล่าสุดจากช่อง Challenge
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
