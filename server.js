require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const prisma = new PrismaClient();

// 1. ตั้งค่า PORT ให้ Render ใช้งานได้
const PORT = process.env.PORT || 3024; 
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 2. ปรับ CORS ให้รองรับเฉพาะโดเมนหน้าบ้านของคุณ
const allowedOrigins = [
  'http://localhost:3000', // สำหรับ Dev ในเครื่อง
  'https://luxury-trader-backend.vercel.app' // 📍 ใส่ URL หน้าบ้าน Vercel ของคุณตรงนี้!
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));


// =================================================================
// 🤖 LIVE AI GENERATIVE MISSION API (Connected Real Database Version)
// =================================================================

// ฟังก์ชันกลางสำหรับสั่ง AI สร้างภารกิจ
async function generateDailyMissionsInternal(todayStr, todayName) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const prompt = `คุณคือระบบ AI ผู้จัดการส่วนตัวของ 'คุณชัดดนัย' เทรดเดอร์พรีเมียมและวิศวกรคอมพิวเตอร์
  หน้าที่ของคุณคือคิดและสร้างภารกิจยุทธวิธีรายวันสเกลกระชับ (Micro-Missions) ประจำวัน (${todayName}) ที่แปลกใหม่ ทำเสร็จและเคลียร์จบได้ในวันนั้นทันที
  เน้นวินัยการลงมือทำรายวันแบบจับต้องได้จริง
  สร้างภารกิจทั้งหมด 4 ข้อถ้วน แบ่งเป็น:
  1. หมวดหมู่ dev: งานเขียนโค้ด/เพิ่มฟังก์ชัน
  2. หมวดหมู่ trade: วินัยพอร์ต/เป้าหมายกำไรวันนี้
  3. หมวดหมู่ fitness: เวทเทรนนิ่ง/สร้างกล้ามเนื้อ (หมายเหตุอุปกรณ์ออกกำลังกายมีแค่ เสื่อโยคะ, บอร์ดวิดพื้น, ลูกกลิ้งออกกำลังกาย)
  4. หมวดหมู่ learn: เรียนรู้ 1 สิ่งที่จะช่วยยกระดับศักยภาพชีวิตและการทำงานในทุกมิติ ไม่ว่าจะเป็น การลงทุน, กลยุทธ์การหารายได้, การตัดต่อ/ถ่ายคลิป, การทำโปรดักต์, การสร้างแบรนด์ หรือทักษะใดๆ ที่จะทำให้เราก้าวหน้าและเพิ่มโอกาสทางการเงินได้จริง
  ส่งกลับมาเป็น JSON Array รูปแบบ:
  [
    { "text": "...", "category": "dev" },
    { "text": "...", "category": "trade" },
    { "text": "...", "category": "fitness" },
    { "text": "...", "category": "learn" }
  ]`;

  const result = await model.generateContent(prompt);
  const rawMissions = JSON.parse(result.response.text());

  // บันทึกลง DB
  const savedMissions = [];
  for (const item of rawMissions) {
    const created = await prisma.mission.create({
      data: {
        text: item.text,
        category: item.category,
        date: todayStr,
        completed: false
      }
    });
    savedMissions.push(created);
  }
  return savedMissions;
}

// 1. [POST] /missions/generate - สั่งให้ AI เจนภารกิจของวันนี้ แล้วบันทึกลงฐานข้อมูลจริง
app.post("/missions/generate", async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split("T")[0];
    const days = ["วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์"];
    const todayName = days[new Date().getDay()];

    // ตรวจสอบข้อมูลซ้ำซ้อน
    const existingMissions = await prisma.mission.findMany({ where: { date: todayStr } });
    if (existingMissions.length > 0) {
      return res.json(existingMissions);
    }

    // เรียกฟังก์ชันกลาง
    const savedMissions = await generateDailyMissionsInternal(todayStr, todayName);
    res.json(savedMissions);
  } catch (err) {
    console.error("Gemini AI Core Error:", err);
    res.status(500).json({ error: "ระบบหลังบ้านขัดข้อง" });
  }
});

// 2. [GET] /missions - ดึงข้อมูลภารกิจทั้งหมดตามเดือนและปี (สำหรับนำไปแปลงปฏิทินย้อนหลัง)
app.get("/missions", async (req, res) => {
  try {
    const { month, year } = req.query;
    let whereCondition = {};
    
    if (month && year) {
      // ค้นหาคำที่ขึ้นต้นด้วย YYYY-MM
      const searchPattern = `${year}-${String(month).padStart(2, "0")}`;
      whereCondition.date = {
        startsWith: searchPattern
      };
    }

    const misiones = await prisma.mission.findMany({
      where: whereCondition,
      orderBy: { id: "asc" }
    });
    res.json(misiones);
  } catch (err) {
    console.error("Fetch missions error:", err);
    res.status(500).json({ error: "ดึงข้อมูลภารกิจผิดพลาด" });
  }
});

// 3. [GET] /missions/today - หน้าบ้านดึงภารกิจของวันนี้
app.get("/missions/today", async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split("T")[0];
    let todayMissions = await prisma.mission.findMany({
      where: { date: todayStr },
      orderBy: { id: "asc" }
    });

    if (todayMissions.length === 0) {
      const days = ["วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์"];
      const todayName = days[new Date().getDay()];
      todayMissions = await generateDailyMissionsInternal(todayStr, todayName);
    }
    res.json(todayMissions);
  } catch (err) {
    res.status(500).json({ error: "ดึง/สร้างข้อมูลภารกิจผิดพลาด" });
  }
});

// 4. [PUT] /missions/toggle/:id - บันทึกสถานะการสลับติ๊กเคลียร์ภารกิจจริงลง DB
app.put("/missions/toggle/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const target = await prisma.mission.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: "ไม่พบภารกิจนี้" });

    const updated = await prisma.mission.update({
      where: { id },
      data: { completed: !target.completed }
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "สลับสถานะภารกิจล้มเหลว" });
  }
});

// [DELETE] /missions/today - ล้างภารกิจของวันนี้เพื่อสุ่มใหม่
app.delete("/missions/today", async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split("T")[0];
    await prisma.mission.deleteMany({
      where: { date: todayStr }
    });
    res.json({ message: "ล้างภารกิจของวันนี้สำเร็จ เตรียมสุ่มใหม่ได้เลย!" });
  } catch (err) {
    console.error("Delete today missions error:", err);
    res.status(500).json({ error: "ไม่สามารถล้างภารกิจได้" });
  }
});


// =================================================================
// 📊 PROGRESS JOURNAL API (Standalone Mode - Connected DB)
// =================================================================

// แก้ไข app.get("/transactions", ...) ใน server.js
app.get("/transactions", async (req, res) => {
  try {
    const trades = await prisma.transaction.findMany({
      orderBy: { id: "desc" }, // เอาล่าสุดขึ้นก่อน
    });
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/transactions", async (req, res) => {
  try {
    // 1. รับค่าที่เพิ่มขึ้นมา (startTime, endTime) จาก req.body
    const { title, amount, type, date, category, startTime, endTime } = req.body;

    if (!title || !type || !date) {
      return res.status(400).json({ error: "ข้อมูลสำคัญไม่ครบถ้วน" });
    }

    // 2. บันทึกลง Prisma
    const newEntry = await prisma.transaction.create({
      data: {
        title,
        amount: amount ? parseFloat(amount) : 0.0,
        type,
        date,
        category: category || "trade", // กรณีเป็นเทรดให้ default เป็น trade หรือตามที่ส่งมา
        startTime: startTime || null, // บันทึกค่าเวลาลงไป
        endTime: endTime || null,     // บันทึกค่าเวลาลงไป
      },
    });

    res.status(201).json(newEntry);
  } catch (err) {
    console.error("Create transaction error:", err);
    res.status(500).json({ error: "ระบบหลังบ้านบันทึกข้อมูลไม่สำเร็จ" });
  }
});

app.delete("/transactions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const targetTrade = await prisma.transaction.findUnique({
      where: { id: parseInt(id) },
    });
    if (!targetTrade) {
      return res.status(404).json({ error: "ไม่พบประวัติการทำรายการนี้ในระบบ" });
    }
    await prisma.transaction.delete({
      where: { id: parseInt(id) },
    });
    res.json({ message: "ลบข้อมูลสถิติสำเร็จเรียบร้อยแล้ว" });
  } catch (err) {
    console.error("Delete transaction error:", err);
    res.status(500).json({ error: "ระบบหลังบ้านเกิดข้อผิดพลาดในการลบข้อมูล" });
  }
});

app.get("/projects/active", async (req, res) => {
  try {
    // 1. ดึง Transaction ทุกตัวที่เป็น [WORK]
    const allDevLogs = await prisma.transaction.findMany({
      where: { title: { startsWith: "[WORK]" } },
      orderBy: { date: 'desc' } // เรียงวันที่ล่าสุดขึ้นก่อน
    });

    // 2. ใช้ Map เพื่อกรองโปรเจกต์ที่ Progress ล่าสุดยังไม่ถึง 100
    const projectStatusMap = new Map();

    allDevLogs.forEach(log => {
      // ดึงชื่อโปรเจกต์และ progress จาก title เช่น [WORK]|ProjectName|สถานะ...: 75%
      const parts = log.title.split('|');
      const projectName = parts[1];
      const progressMatch = log.title.match(/(\d+)%/);
      const progress = progressMatch ? parseInt(progressMatch[1]) : 0;

      // ถ้าโปรเจกต์นี้ยังไม่มีใน Map ให้บันทึกสถานะล่าสุดไว้
      if (!projectStatusMap.has(projectName)) {
        projectStatusMap.set(projectName, progress);
      }
    });

    // 3. กรองเอาเฉพาะโปรเจกต์ที่ Progress < 100
    const activeProjects = Array.from(projectStatusMap.entries())
      .filter(([name, progress]) => progress < 100)
      .map(([name]) => name);

    res.json(activeProjects);
  } catch (err) {
    res.status(500).json({ error: "ดึงข้อมูลโปรเจกต์ไม่สำเร็จ" });
  }
});

// ดึงสถานะความคืบหน้าล่าสุดของโปรเจกต์นั้นๆ
app.get("/projects/latest/:name", async (req, res) => {
  try {
    const lastLog = await prisma.transaction.findFirst({
      where: { title: { contains: `[WORK]|${req.params.name}|` } },
      orderBy: { date: 'desc' } // เอาข้อมูลล่าสุด
    });
    res.json(lastLog);
  } catch (err) {
    res.status(500).json({ error: "ไม่พบข้อมูลงานล่าสุด" });
  }
});

app.post("/transactions/upsert", async (req, res) => {
  // 1. รับค่าทั้งหมดที่จำเป็นเข้ามา
  const { title, amount, type, date, startTime, endTime, category } = req.body;

  try {
    // ตรวจสอบว่าโปรเจกต์นี้มีอยู่ในวันนั้นหรือยัง
    // เราค้นหาจากชื่อโปรเจกต์ (split ที่ตำแหน่งที่ 2)
    const projectName = title.split('|')[1];
    
    const existing = await prisma.transaction.findFirst({
      where: {
        date: date,
        title: { contains: projectName } 
      }
    });

    if (existing) {
      // ถ้าเจอ ให้ Update ข้อมูลใหม่ทั้งหมด (รวมเวลาและ category)
      await prisma.transaction.update({
        where: { id: existing.id },
        data: { 
          title, 
          amount, 
          type, 
          startTime, // อัปเดตเวลา
          endTime,   // อัปเดตเวลา
          category   // อัปเดตหมวดหมู่
        }
      });
      res.json({ message: "อัปเดตงานเดิมพร้อมเวลาและหมวดหมู่เรียบร้อย" });
    } else {
      // ถ้าไม่เจอ ให้ Create ใหม่
      await prisma.transaction.create({
        data: { 
          title, 
          amount, 
          type, 
          date, 
          startTime, 
          endTime, 
          category 
        }
      });
      res.json({ message: "สร้างงานใหม่พร้อมเวลาและหมวดหมู่เรียบร้อย" });
    }
  } catch (err) {
    console.error("Upsert Error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
  }
});

// 🤖 AI Insight Analyzer API
app.post("/api/analyze-habits", async (req, res) => {
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const dateStr = oneWeekAgo.toISOString().split("T")[0];

    // ดึงข้อมูล 2 แหล่ง (Transactions + Missions) อ้างอิงตามโครงสร้าง DB ของคุณ
    const [transactions, missions] = await Promise.all([
      prisma.transaction.findMany({
        where: { createdAt: { gte: oneWeekAgo } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.mission.findMany({
        where: { createdAt: { gte: oneWeekAgo } }
      })
    ]);

    // ใช้โมเดลตัวเดียวกับที่คุณใช้ใน /missions/generate
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", // ใช้ชื่อโมเดลตามที่คุณใช้อยู่ในโค้ดต้นแบบเลยครับ
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
      คุณคือระบบ AI ผู้จัดการส่วนตัวของ 'คุณชัดดนัย' เทรดเดอร์พรีเมียมและวิศวกรคอมพิวเตอร์
      นี่คือข้อมูลพฤติกรรมในรอบ 7 วันที่ผ่านมา:
      Transactions: ${JSON.stringify(transactions)}
      Missions ที่ทำสำเร็จ/ไม่สำเร็จ: ${JSON.stringify(missions)}
      
      ช่วยวิเคราะห์ความสัมพันธ์ระหว่างการเทรด, การออกกำลังกาย และงานเขียนโค้ด
      โดยดูว่าพฤติกรรมหรือภารกิจไหนที่ส่งผลต่อประสิทธิภาพสูงสุด
      ส่งผลลัพธ์กลับมาเป็น JSON ดังนี้:
      {
        "insight": "บทวิเคราะห์สั้นๆ ไม่เกิน 3 บรรทัด",
        "action": "ภารกิจที่ควรโฟกัสวันนี้"
      }
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const parsedData = JSON.parse(responseText);

    res.json(parsedData);
  } catch (err) {
    console.error("Gemini AI Core Error (Insight):", err);
    res.status(500).json({ error: "ระบบหลังบ้านหรือสมอง AI ขัดข้อง" });
  }
});

// =================================================================
// 📊 DUAL-CHART TRADING JOURNAL API ENDPOINTS
// =================================================================

// 1. [GET] /trade-journal - ดึงประวัติการเทรดทั้งหมดเรียงจากใหม่ไปเก่า
app.get("/trade-journal", async (req, res) => {
  try {
    const logs = await prisma.tradeJournal.findMany({
      orderBy: {
        id: "desc", // เอาข้อมูลล่าสุดที่เพิ่งเทรดเสร็จขึ้นก่อน
      },
    });
    res.json(logs);
  } catch (err) {
    console.error("Fetch trade journal error:", err);
    res.status(500).json({ error: "หลังบ้านเกิดข้อผิดพลาดในการดึงบันทึกประวัติเทรด" });
  }
});

// 2. [POST] /trade-journal - บันทึกประวัติการเทรดใหม่ลงดาต้าเบส
app.post("/trade-journal", async (req, res) => {
  try {
    const { pair, result, pnl, date, time, session, planImg, resultImg, notes } = req.body;

    // Validation ข้อมูลที่จำเป็นเบื้องต้น
    if (!pair || !result || pnl === undefined || !date) {
      return res.status(400).json({ error: "กรุณากรอกข้อมูล Asset, ผลลัพธ์, PnL และวันที่ให้ครบถ้วน" });
    }

    const newLog = await prisma.tradeJournal.create({
      data: {
        pair: pair.toUpperCase(), // บังคับให้เป็นตัวใหญ่พิมพ์นิยม
        result,
        pnl: parseFloat(pnl),
        date,
        time: time || "--:--",
        session,
        planImg: planImg || null, // ถ้าไม่มีรูปแผนส่งมาให้เซฟเป็นค่าว่าง
        resultImg: resultImg || null, // ถ้าไม่มีรูปผลลัพธ์ให้เซฟเป็นค่าว่าง
        notes: notes || "",
      },
    });

    res.status(201).json(newLog);
  } catch (err) {
    console.error("Create trade journal error:", err);
    res.status(500).json({ error: "ระบบหลังบ้านเกิดข้อผิดพลาดในการบันทึกข้อมูล" });
  }
});

// 3. [DELETE] /trade-journal/:id - ลบบันทึกประวัติเทรด (เผื่อกรอกผิด)
app.delete("/trade-journal/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.tradeJournal.delete({
      where: { id: parseInt(id) },
    });
    res.json({ message: "ลบบันทึกประวัติเทรดสำเร็จ" });
  } catch (err) {
    console.error("Delete trade journal error:", err);
    res.status(500).json({ error: "ไม่สามารถลบข้อมูลรายการนี้ได้" });
  }
});

// =================================================================
// 🧠 AI TRADING CHART VISUAL ANALYTICS ENGINE (Gemini Multimodal)
// =================================================================

// ฟังก์ชันแปลงรูปแบบ Base64 สตริงจากหน้าบ้าน ให้เป็น Object ที่ Gemini Vision เข้าใจ
function fileToGenerativePart(base64DataWithHeader) {
  // แยกเอาเฉพาะข้อมูล Data Base64 เพียวๆ ตัดส่วน "data:image/png;base64," ออก
  const matches = base64DataWithHeader.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error("รูปแบบ Base64 รูปภาพไม่ถูกต้อง");
  }
  return {
    inlineData: {
      data: matches[2],
      mimeType: matches[1]
    },
  };
}

app.post("/trade-journal/ai-analyze", async (req, res) => {
  try {
    const { image, pair, notes } = req.body;

    if (!image) {
      return res.status(400).json({ error: "กรุณาแนบรูปภาพกราฟเทรดสำหรับวิเคราะห์ด้วยครับ" });
    }

    // 1. เรียกใช้งานโมดูลจำลองความคิดสำหรับการวิเคราะห์รูปภาพ
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash"
      });

    // 2. ออกแบบ Prompt สลักทฤษฎีเทรดมือโปร คุมกรอบให้ AI ตอบเฉพาะเรื่องเทรดเท่านั้น
    const prompt = `
      คุณคือ "Stayhard AI Elite Trading Coach" เป็นผู้เชี่ยวชาญด้านเทคนิคอลขั้นสูงและจิตวิทยาการเทรด 
      จงวิเคราะห์ภาพถ่ายกราฟเทรดของสินทรัพย์ ${pair || "ที่แนบมา"} นี้ และทำตามคำสั่งต่อไปนี้อย่างละเอียด:
      
      1. วิเคราะห์แนวโน้ม (Market Structure) ปัจจุบันว่าเป็นอย่างไร (Uptrend / Downtrend / Sideway) ตามทฤษฎี Dow Theory หรือ SMC (Smart Money Concepts)
      2. มาร์กจุดสำคัญ (Key Levels): ส่องหาบริเวณ Support/Resistance, Supply/Demand Zone หรือ QM Level ที่น่าสนใจในรูปภาพ
      3. เสนอกลยุทธ์เทรด (Suggested Strategies): แนะนำแนวทางเปิด Position ที่ได้เปรียบ (เช่น รอเด้ง Sell ที่ Supply Zone, หรือ Buy เมื่อเบรคกรอบพร้อมบอกอัตรา Risk-Reward ที่เหมาะสม)
      
      *ข้อมูล Confluence เพิ่มเติมจากเทรดเดอร์:* "${notes || "ไม่มีการระบุ"}"
      
      *กฎเหล็ก:* ให้ตอบเป็นภาษาไทยด้วยภาษานักเทรดมืออาชีพ กระชับ ดุดัน จริงจัง เป็นข้อๆ และเน้นย้ำเรื่องวินัยการตัดขาดทุน (Stop Loss) เสมอ ห้ามตอบเรื่องอื่นที่ไม่เกี่ยวข้องกับการเทรดเด็ดขาด!
    `;

    // 3. แปลงภาพและรันการประมวลผล
    const imagePart = fileToGenerativePart(image);
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const textAnalysis = response.text();

    // 4. ส่งคำตอบวิเคราะห์กลับไปหน้าบ้าน
    res.json({ analysis: textAnalysis });
  } catch (err) {
    console.error("AI Chart analysis error:", err);
    res.status(500).json({ error: "สมองส่วนกลาง AI เกิดข้อผิดพลาดในการอ่านโครงสร้างกราฟ" });
  }
});

// =================================================================
// ตารางชีวิต
// =================================================================
// ดึงงานของวันที่เลือก
app.get('/todos/:date', async (req, res) => {
    const todos = await prisma.todo.findMany({ where: { date: req.params.date } });
    res.json(todos);
});

// เพิ่มงานใหม่
app.post('/todos', async (req, res) => {
    const { title, date } = req.body;
    const newTodo = await prisma.todo.create({ data: { title, date } });
    res.json(newTodo);
});

// ติ๊กถูก / แก้ไขสถานะ
app.patch('/todos/:id/toggle', async (req, res) => {
    const { id } = req.params;
    const { isCompleted } = req.body;
    const updated = await prisma.todo.update({
        where: { id: parseInt(id) },
        data: { isCompleted }
    });
    res.json(updated);
});

// ลบงานตาม ID
app.delete('/todos/:id', async (req, res) => {
    const { id } = req.params;
    const numericId = parseInt(id);

    console.log("พยายามลบ Todo ID:", numericId); // ดูที่ Terminal ของ Backend

    try {
        // ใช้ deleteMany จะไม่พ่น Error ถ้า ID นั้นไม่มีอยู่จริง
        const result = await prisma.todo.deleteMany({
            where: { id: numericId }
        });

        if (result.count === 0) {
            console.log("ไม่พบรายการ ID นี้ในฐานข้อมูล");
            return res.status(404).json({ error: "ไม่พบรายการ" });
        }

        console.log("ลบสำเร็จ!");
        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Backend Error Detail:", error); // ก๊อป Error นี้มาให้เรนบลูดู!
        res.status(500).json({ error: "เกิดข้อผิดพลาดที่ฐานข้อมูล" });
    }
});

app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 STAYHARD BACKEND LIVE ON PORT: ${PORT}`);
  console.log(`=========================================`);
});