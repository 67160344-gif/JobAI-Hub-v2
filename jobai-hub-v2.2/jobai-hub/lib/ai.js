/* JobAI Hub - OpenAI Responses API client (ใช้ fetch ของ Node 20 ไม่ต้องติดตั้งแพ็กเกจเพิ่ม)
 * ทุกฟังก์ชันคืนค่า JSON ตาม schema หรือ throw error -> ฝั่ง server จะ fallback เป็น rule-based
 */
// OPENAI_BASE_URL ใช้กับ proxy/gateway ที่รองรับ Responses API ได้ (ค่าเริ่มต้นคือ OpenAI)
const apiUrl = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '') + '/responses';
const TIMEOUT_MS = 45000;

const enabled = () => Boolean((process.env.OPENAI_API_KEY || '').trim());
const model = () => (process.env.OPENAI_MODEL || 'gpt-6-luna').trim();

function outputText(data) {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const c of item.content || []) {
      if (c.type === 'refusal') throw new Error('AI ปฏิเสธคำขอ');
      if (c.type === 'output_text' && c.text) parts.push(c.text);
    }
  }
  return parts.join('');
}

/** เรียก Responses API แบบ Structured Outputs (JSON Schema) */
async function callJSON({ name, instructions, input, schema, maxTokens = 1500 }) {
  if (!enabled()) throw new Error('ไม่ได้ตั้งค่า OPENAI_API_KEY');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(apiUrl(), {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}` },
      body: JSON.stringify({
        model: model(),
        instructions,
        input,
        max_output_tokens: maxTokens,
        text: { format: { type: 'json_schema', name, schema, strict: true } }
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(data.error && data.error.message) || 'request failed'}`);
    const txt = outputText(data);
    if (!txt) throw new Error(`OpenAI ไม่ส่งข้อความกลับมา (status: ${data.status || 'unknown'})`);
    return JSON.parse(txt);
  } finally {
    clearTimeout(timer);
  }
}

const obj = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const str = { type: 'string' };
const int = { type: 'integer' };

async function analyzeResume(text, knownSkills) {
  return callJSON({
    name: 'resume_analysis',
    maxTokens: 2000,
    instructions: 'คุณคือผู้เชี่ยวชาญด้าน HR และ ATS ในประเทศไทย วิเคราะห์ Resume ที่ได้รับอย่างตรงไปตรงมา ตอบเป็นภาษาไทย ห้ามแต่งข้อมูลที่ไม่มีใน Resume',
    input: `วิเคราะห์ Resume ต่อไปนี้แล้วตอบตาม schema:
- score: คะแนนความสมบูรณ์ 0-100 (โครงสร้าง ความชัดเจน ตัวเลขวัดผล ข้อมูลติดต่อ ความเกี่ยวข้อง)
- skills: ทักษะหลักไม่เกิน 10 รายการ ถ้าตรงกับรายการนี้ให้ใช้ชื่อเดียวกัน: ${knownSkills.join(', ')}
- yearsNumber: จำนวนปีประสบการณ์ทำงานรวม (ทศนิยมได้) ถ้าไม่พบให้เป็น null
- field: สายงานหลักสั้น ๆ เช่น "UX/UI Design", "Software Development"
- recs: ข้อเสนอแนะ 2-4 ข้อ type = warn (ต้องแก้), info (ควรปรับ), ok (จุดแข็ง)

Resume:
"""
${text.slice(0, 12000)}
"""`,
    schema: obj({
      score: int,
      skills: { type: 'array', items: str },
      yearsNumber: { type: ['number', 'null'] },
      field: str,
      recs: { type: 'array', items: obj({ type: { type: 'string', enum: ['warn', 'info', 'ok'] }, title: str, text: str }) }
    })
  });
}

async function evaluateAnswer(question, answer, job) {
  return callJSON({
    name: 'interview_evaluation',
    maxTokens: 1200,
    instructions: 'คุณคือโค้ชสัมภาษณ์งานมืออาชีพ ประเมินคำตอบอย่างเป็นธรรมตามหลัก STAR ให้คะแนนตามจริง และให้คำแนะนำที่นำไปใช้ได้ทันที ตอบภาษาไทย',
    input: `${job ? `ตำแหน่งที่สัมภาษณ์: ${job.title} (${job.company})\n` : ''}คำถาม: ${question}
คำตอบของผู้สมัคร:
"""
${answer.slice(0, 4000)}
"""
ให้คะแนน clarity, problem (การแก้ปัญหา), teamwork (การทำงานเป็นทีม) เป็นจำนวนเต็ม 1-10, total 0-100,
summary สรุปสั้น 1 ประโยค และ tip คำแนะนำที่เจาะจงกับคำตอบนี้ 1-2 ประโยค`,
    schema: obj({ total: int, clarity: int, problem: int, teamwork: int, summary: str, tip: str })
  });
}

async function interviewQuestions(job, resume) {
  return callJSON({
    name: 'interview_questions',
    maxTokens: 900,
    instructions: 'คุณคือ HR มืออาชีพที่สัมภาษณ์งานมาแล้วทุกสายอาชีพ ตอบภาษาไทย ใช้ภาษาที่เป็นธรรมชาติเหมือนการสัมภาษณ์จริง',
    input: `สร้างคำถามสัมภาษณ์งาน 5 ข้อ ที่ใช้ได้กับทุกอาชีพ (ไม่ใช่เฉพาะสายไอทีหรือออกแบบ) เรียงตามนี้:
1) แนะนำตัว
2–4) คำถามเชิงพฤติกรรม/สถานการณ์ คนละหมวด สุ่มจาก: จุดแข็ง-จุดอ่อน, การทำงานเป็นทีม, การแก้ปัญหา, การทำงานภายใต้ความกดดัน, ความผิดพลาดและบทเรียน, การรับมือลูกค้า, การสื่อสาร, ภาวะผู้นำ, การปรับตัว, จริยธรรมในการทำงาน
5) แรงจูงใจ/เป้าหมายอาชีพ
${job ? `ผู้สมัครกำลังเตรียมสัมภาษณ์ตำแหน่ง ${job.title} ที่ ${job.company} — ให้ปรับข้อ 4 และ 5 ให้เกี่ยวกับตำแหน่งนี้ โดยไม่ต้องลงรายละเอียดเทคนิคเฉพาะทาง` : 'ยังไม่ระบุตำแหน่ง ให้ใช้คำถามทั่วไปทั้งหมด'}
แต่ละครั้งให้เลือกคำถามที่แตกต่างกัน ไม่ซ้ำแบบเดิม (รหัสสุ่ม: ${Math.random().toString(36).slice(2, 8)})`,
    schema: obj({ questions: { type: 'array', items: str } })
  });
}

async function coverLetter(job, resume, name) {
  return callJSON({
    name: 'cover_letter',
    maxTokens: 1200,
    instructions: 'คุณคือผู้ช่วยเขียนจดหมายสมัครงานภาษาไทยแบบสุภาพ กระชับ ใช้สรรพนาม "ข้าพเจ้า" ห้ามแต่งประสบการณ์หรือตัวเลขที่ไม่มีในข้อมูล',
    input: `เขียน Cover Letter ความยาว 120-180 คำ ขึ้นต้นด้วย "เรียน ฝ่ายทรัพยากรบุคคล ${job.company}" และลงท้ายด้วย "ขอแสดงความนับถือ" ตามด้วยชื่อ "${name}"
ตำแหน่ง: ${job.title}
ทักษะที่ต้องการ: ${(job.tags || []).join(', ')}
รายละเอียดงาน: ${job.description || ''}
ข้อมูลผู้สมัคร: ประสบการณ์ ${(resume && resume.years) || 'ไม่ระบุ'}, ทักษะ ${((resume && resume.skills) || []).join(', ')}
ตัวอย่างเนื้อหา Resume:
"""
${((resume && resume.text) || '').slice(0, 3000)}
"""`,
    schema: obj({ letter: str })
  });
}

module.exports = { enabled, model, analyzeResume, evaluateAnswer, interviewQuestions, coverLetter };
