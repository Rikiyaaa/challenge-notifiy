const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();
// Configuration
const SOURCE_CHANNEL_ID = process.env.SOURCE_CHANNEL_ID;
const USER_TOKEN = process.env.USER_TOKEN;

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

// Function to analyze image with Gemini - ไม่บันทึกไฟล์ลงโฟลเดอร์ temp
// Function to analyze image with Gemini - ไม่บันทึกไฟล์ลงโฟลเดอร์ temp
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
/**
 * สกัดเฉพาะชื่อไอเทมออกจากข้อความ โดยไม่รวมตัวเลขและเครื่องหมายใดๆ
 * @param {string} itemDropsText - ข้อความที่มีรูปแบบหลากหลาย เช่น "* ชื่อไอเทม (x1~2, 50%)" หรือ "ชื่อไอเทม x1-2 50%"
 * @returns {string} - รายชื่อไอเทมที่คั่นด้วยเครื่องหมายจุลภาค
 */
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


// ฟังก์ชันส่งข้อมูล item drops ไปยัง LINE ในรูปแบบ Flex Message
// ฟังก์ชันส่งข้อมูล item drops ไปยัง LINE ในรูปแบบ Flex Message
async function sendItemDropsToLine(imageUrl, itemDropsText, author) {
  try {
    // ตรวจสอบว่า URL เป็น HTTPS หรือไม่ (LINE ต้องการ HTTPS เท่านั้น)
    if (!imageUrl.startsWith('https://')) {
      console.error('LINE ต้องการ URL แบบ HTTPS เท่านั้น');
      return;
    }
    
    // นำชื่อ item มาใช้เป็น altText
    const itemNamesOnly = extractItemNames(itemDropsText);
    
    const flexMessage = {
      type: "flex",
      altText: itemNamesOnly, // ใช้ชื่อ item อย่างเดียวเป็น altText
      contents: {
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
      }
    };

    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: LINE_USER_ID,
      messages: [flexMessage]
    }, {
      headers: {
        'Authorization': `Bearer ${LINE_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`ส่งข้อมูล Item Drops จาก ${author} ไปยัง LINE สำเร็จ (Flex Message)`);
  } catch (error) {
    console.error('เกิดข้อผิดพลาดในการส่งข้อมูลไปยัง LINE:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// จัดการ unhandled rejections เพื่อป้องกันการล่มของแอพ
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Promise Rejection:', error);
});

client.on('ready', () => {
  console.log(`เข้าสู่ระบบในชื่อ ${client.user.tag}`);
  console.log('กำลังตรวจสอบรูปภาพใหม่จากช่อง Discord เพื่อวิเคราะห์ Item Drops...');
});

// ตรวจจับข้อความใหม่ (เฉพาะรูปภาพ)
client.on('messageCreate', async message => {
  if (message.channelId === SOURCE_CHANNEL_ID) {
    // ส่งเฉพาะรูปภาพ
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
          try {
            console.log(`ตรวจพบรูปภาพจาก ${message.author.username}: ${attachment.url}`);
            
            // 1. วิเคราะห์รูปภาพด้วย Gemini โดยตรงจาก URL
            const itemDropsText = await analyzeImageWithGemini(attachment.url);
            console.log('ผลการวิเคราะห์:', itemDropsText);
            
            // 2. ส่งข้อมูลไปยัง LINE
            await sendItemDropsToLine(attachment.url, itemDropsText, message.author.username);
            
          } catch (error) {
            console.error('เกิดข้อผิดพลาดในการประมวลผลรูปภาพ:', error);
          }
        }
      }
    }
  }
});

// เข้าสู่ระบบด้วย User Token
client.login(USER_TOKEN);