/* JobAI Hub - Rule-based analysis engine (ใช้เมื่อไม่มี OPENAI_API_KEY หรือเรียก AI ไม่สำเร็จ)
 * ไม่มี dependency ภายนอก ทดสอบได้ด้วย node test/analyzer.test.js
 */

// ทักษะที่ระบบรู้จัก: ชื่อมาตรฐาน -> regex สำหรับค้นหาในข้อความ
const SKILLS = {
  'UX/UI Design': /\bux\b|\bui\b|user experience|user interface|ux\/ui/i,
  'Figma': /figma/i,
  'Adobe XD': /adobe\s*xd/i,
  'User Research': /user research|ux research|usability|วิจัยผู้ใช้|สัมภาษณ์ผู้ใช้/i,
  'Prototyping': /prototyp|โปรโตไทป์/i,
  'Wireframing': /wirefram|ไวร์เฟรม/i,
  'Design System': /design system/i,
  'HTML/CSS': /\bhtml5?\b|\bcss3?\b/i,
  'JavaScript': /javascript|typescript|\bjs\b/i,
  'React': /\breact(?:\.js|js)?\b(?!\s*native)/i,
  'Vue': /\bvue(?:\.js|js)?\b/i,
  'Node.js': /node\.?js|express\.?js/i,
  'Tailwind': /tailwind/i,
  'Python': /python/i,
  'Java': /\bjava\b(?!script)/i,
  'SQL': /\bsql\b|postgres|mysql|sql server/i,
  'Git': /\bgit\b|github|gitlab/i,
  'Mobile App': /mobile app|\bios\b|android|flutter|react native|แอปมือถือ|แอปพลิเคชันมือถือ/i,
  'Fintech': /fintech|ฟินเทค|banking|ธนาคาร/i,
  'Data Analysis': /data analy|วิเคราะห์ข้อมูล|power\s*bi|tableau|looker/i,
  'Machine Learning': /machine learning|deep learning|tensorflow|pytorch|scikit/i,
  'Excel': /\bexcel\b|spreadsheet|google sheets/i,
  'Digital Marketing': /digital marketing|\bseo\b|\bsem\b|การตลาดออนไลน์|การตลาดดิจิทัล|social media/i,
  'Project Management': /project manag|\bagile\b|\bscrum\b|บริหารโครงการ|jira/i,
  'Communication': /communication|การสื่อสาร|presentation|การนำเสนอ/i
};
const SKILL_NAMES = Object.keys(SKILLS);

const FIELDS = {
  'UX/UI Design': ['UX/UI Design', 'Figma', 'Adobe XD', 'User Research', 'Prototyping', 'Wireframing', 'Design System'],
  'Software Development': ['JavaScript', 'React', 'Vue', 'Node.js', 'Python', 'Java', 'SQL', 'Git', 'HTML/CSS', 'Tailwind', 'Mobile App'],
  'Data & Analytics': ['Data Analysis', 'Machine Learning', 'SQL', 'Python', 'Excel'],
  'Marketing': ['Digital Marketing', 'Communication'],
  'Project Management': ['Project Management', 'Communication']
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const norm = s => String(s || '').trim().toLowerCase();

/** หาชื่อทักษะมาตรฐานของ tag (เช่น "Mobile App" -> "Mobile App", "figma" -> "Figma") */
function canonicalSkill(tag) {
  const t = String(tag || '').trim();
  const exact = SKILL_NAMES.find(k => norm(k) === norm(t));
  if (exact) return exact;
  const hit = SKILL_NAMES.find(k => SKILLS[k].test(t));
  return hit || t;
}

function detectSkills(text) {
  return SKILL_NAMES.filter(k => SKILLS[k].test(text || ''));
}

function detectField(skills) {
  let best = null, bestScore = 0;
  for (const [field, list] of Object.entries(FIELDS)) {
    const s = skills.filter(x => list.includes(x)).length;
    if (s > bestScore) { best = field; bestScore = s; }
  }
  return best;
}

function yearsLabel(years) {
  if (years == null || !isFinite(years) || years <= 0) return 'ไม่ระบุ';
  const y = Math.floor(years), m = Math.round((years - y) * 12);
  if (m === 12) return `${y + 1} ปี`;
  if (!y) return `${m} เดือน`;
  return m ? `${y} ปี ${m} เดือน` : `${y} ปี`;
}

const toCE = y => (y >= 2400 ? y - 543 : y); // แปลง พ.ศ. -> ค.ศ.
const EDU_RE = /education|การศึกษา|university|มหาวิทยาลัย|bachelor|master|ปริญญา|high school|มัธยม|gpa|เกรดเฉลี่ย/i;

/** ประมาณจำนวนปีประสบการณ์จากข้อความ Resume (คืนค่าเป็นปีแบบทศนิยม หรือ null) */
function extractYears(text, now = new Date()) {
  const t = String(text || '');
  // 1) ระบุตรง ๆ เช่น "ประสบการณ์ 3 ปี 6 เดือน", "5+ years of experience"
  const m1 = t.match(/(?:ประสบการณ์(?:การทำงาน)?|experience)[^\d\n]{0,25}(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:ปี|years?|yrs?)(?:\s*(\d{1,2})\s*เดือน)?/i);
  if (m1) return clamp(+m1[1] + (m1[2] ? +m1[2] / 12 : 0), 0, 50);
  const m2 = t.match(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:work(?:ing)?\s+|professional\s+)?experience/i);
  if (m2) return clamp(+m2[1], 0, 50);

  // 2) รวมช่วงปีทำงาน เช่น "2019 - 2022", "Jan 2021 – Present", "2563 - ปัจจุบัน"
  const curYear = now.getFullYear() + now.getMonth() / 12;
  const re = /((?:19|20|25)\d{2})\s*(?:[-–—]|to|ถึง)\s*(?:[A-Za-z฀-๿.]{0,12}\s*)?((?:19|20|25)\d{2}|present|current|now|ปัจจุบัน)/gi;
  const ranges = [];
  let m;
  while ((m = re.exec(t))) {
    // ข้ามช่วงปีของการศึกษา (ดูบรรทัดเดียวกันและบรรทัดก่อนหน้า)
    const lineStart = t.lastIndexOf('\n', m.index - 1);
    const prevStart = lineStart > 0 ? t.lastIndexOf('\n', lineStart - 1) : -1;
    const lineEnd = t.indexOf('\n', m.index);
    if (EDU_RE.test(t.slice(prevStart + 1, lineEnd < 0 ? t.length : lineEnd))) continue;
    const start = toCE(+m[1]);
    const end = /^\d/.test(m[2]) ? toCE(+m[2]) : curYear;
    if (start >= 1970 && end >= start && end <= curYear + 1) ranges.push([start, Math.min(end, curYear)]);
  }
  if (!ranges.length) return null;
  ranges.sort((a, b) => a[0] - b[0]);
  let total = 0, [cs, ce] = ranges[0];
  for (const [s, e] of ranges.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e); else { total += ce - cs; [cs, ce] = [s, e]; }
  }
  total += ce - cs;
  return total > 0 ? clamp(Math.round(total * 2) / 2, 0, 50) : null;
}

/** วิเคราะห์ Resume แบบ rule-based */
function analyzeResume(text, now = new Date()) {
  const t = String(text || '');
  const skills = detectSkills(t);
  const years = extractYears(t, now);
  const chars = t.replace(/\s/g, '').length; // ภาษาไทยไม่เว้นวรรค จึงวัดความยาวเป็นตัวอักษร
  const metrics = (t.match(/\d+(?:\.\d+)?\s*%|\d{1,3}(?:,\d{3})+|\d+\s*(?:users|ผู้ใช้|คน|ล้าน|เท่า|k\b)/gi) || []).length;
  const has = {
    email: /[\w.+-]+@[\w-]+\.[\w.-]+/.test(t),
    phone: /(?:\+66|0)\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}/.test(t),
    experience: /experience|ประสบการณ์|work history|employment/i.test(t),
    education: EDU_RE.test(t),
    summary: /summary|profile|objective|about me|สรุป|เกี่ยวกับ|โปรไฟล์/i.test(t),
    link: /behance|dribbble|github|linkedin|https?:\/\//i.test(t)
  };

  has.cert = /certif|ใบรับรอง|ใบประกาศ|course|คอร์ส|bootcamp/i.test(t);
  has.english = /english|ภาษาอังกฤษ|toeic|ielts|toefl|cu-tep/i.test(t);
  let score = 30 + Math.min(skills.length * 3, 18) + Math.min(metrics, 4) * 3;
  score += (has.email ? 4 : 0) + (has.phone ? 3 : 0) + (has.experience ? 5 : 0) + (has.education ? 4 : 0) + (has.summary ? 4 : 0) + (has.link ? 3 : 0) + (has.cert ? 3 : 0) + (has.english ? 3 : 0);
  if (chars >= 600 && chars <= 9000) score += 4;
  if (chars < 300) score -= 12;
  score = clamp(Math.round(score), 10, 100);

  const recs = [];
  if (!metrics) recs.push({ type: 'warn', title: 'เพิ่มตัวเลขวัดผลของผลงาน (Quantifiable Metrics)', text: 'ใส่ผลลัพธ์เป็นตัวเลข เช่น "ออกแบบหน้า Checkout ใหม่ ทำให้ Conversion เพิ่มขึ้น 18% ใน 2 เดือน" เพื่อให้ HR เห็นผลงานชัดขึ้น' });
  if (!has.email || !has.phone) recs.push({ type: 'warn', title: 'ข้อมูลติดต่อไม่ครบ', text: `ยังไม่พบ${!has.email ? 'อีเมล' : ''}${!has.email && !has.phone ? 'และ' : ''}${!has.phone ? 'เบอร์โทรศัพท์' : ''} ควรใส่ไว้ส่วนหัวของ Resume` });
  if (!has.summary) recs.push({ type: 'info', title: 'เพิ่มส่วนสรุปโปรไฟล์ (Summary)', text: 'เขียนสรุป 3–4 บรรทัดว่าคุณเชี่ยวชาญอะไรและกำลังมองหางานแบบไหน ใช้คีย์เวิร์ดตรงกับประกาศงานเพื่อผ่านระบบ ATS' });
  if (skills.length < 4) recs.push({ type: 'info', title: 'ระบุทักษะให้ชัดเจนขึ้น', text: 'เพิ่มหัวข้อ Skills และใช้ชื่อเครื่องมือ/ทักษะที่ตรงกับประกาศงาน (เช่น Figma, SQL, Python) ระบบคัดกรองจะจับคู่ได้แม่นขึ้น' });
  if (!has.link) recs.push({ type: 'info', title: 'แนบลิงก์ผลงาน', text: 'เพิ่มลิงก์ Portfolio, GitHub หรือ LinkedIn เพื่อให้ HR ดูผลงานจริงได้ทันที' });
  if (chars > 9000) recs.push({ type: 'info', title: 'Resume ยาวเกินไป', text: 'พยายามสรุปให้อยู่ใน 1–2 หน้า เน้นผลงาน 3–5 ปีล่าสุดที่เกี่ยวข้องกับตำแหน่ง' });
  if (chars < 300) recs.push({ type: 'warn', title: 'เนื้อหาน้อยเกินไป', text: 'Resume ควรมีประวัติการทำงาน การศึกษา และทักษะอย่างน้อยหัวข้อละ 2–3 บรรทัด' });
  if (!has.cert) recs.push({ type: 'info', title: 'เพิ่มใบรับรองหรือคอร์สที่เกี่ยวข้อง', text: 'ใส่ Certificate หรือคอร์สออนไลน์ที่เกี่ยวกับสายงาน (เช่น Google UX Design, AWS, Data Analytics) ช่วยเพิ่มความน่าเชื่อถือ' });
  if (!has.english) recs.push({ type: 'info', title: 'ระบุระดับภาษาอังกฤษ', text: 'บริษัทจำนวนมากต้องการภาษาอังกฤษ ควรระบุระดับหรือคะแนนสอบ เช่น TOEIC 750' });
  if (recs.every(r => r.type !== 'warn')) recs.unshift({ type: 'ok', title: 'จุดแข็ง: โครงสร้าง Resume ครบถ้วน', text: `มีข้อมูลติดต่อ${metrics ? ' ตัวเลขวัดผล' : ''}และทักษะชัดเจน ลองปรับคีย์เวิร์ดให้ตรงกับแต่ละตำแหน่งก่อนสมัคร` });
  if (!recs.length) recs.push({ type: 'ok', title: 'Resume ครบถ้วนดีมาก', text: 'โครงสร้างครบ มีตัวเลขวัดผลและข้อมูลติดต่อ ลองปรับคีย์เวิร์ดให้ตรงกับแต่ละตำแหน่งก่อนสมัคร' });

  return { score, skills, yearsNumber: years, years: yearsLabel(years), field: detectField(skills), recs: recs.slice(0, 4) };
}

/** ปีประสบการณ์ขั้นต่ำจากข้อความ เช่น "3-5 ปี" -> 3, "2+ ปี" -> 2 */
function minYears(exp) {
  const m = String(exp || '').match(/(\d{1,2})/);
  return m ? +m[1] : null;
}

/** คำนวณ % ความเหมาะสมระหว่าง Resume กับงาน */
function matchJob(job, resume) {
  const skills = (resume && resume.skills) || [];
  const text = (resume && resume.text) || '';
  if (!skills.length && !text) return { match: null, matchedTags: [] };
  const have = new Set(skills.map(norm));
  const tags = (job.tags || []).filter(Boolean);
  const matchedTags = tags.filter(tag => {
    const c = canonicalSkill(tag);
    return have.has(norm(c)) || have.has(norm(tag)) || (text && text.toLowerCase().includes(norm(tag)));
  });
  const ratio = tags.length ? matchedTags.length / tags.length : 0.5;
  // โบนัสเมื่อทักษะใน Resume ปรากฏในชื่อ/รายละเอียดงาน แต่ไม่ได้อยู่ใน tags
  const jobText = `${job.title || ''} ${job.description || job.desc || ''}`;
  const counted = new Set(matchedTags.map(t => norm(canonicalSkill(t))));
  const extra = skills.filter(s => !counted.has(norm(s)) && SKILLS[s] && SKILLS[s].test(jobText)).length;
  let score = 40 + 50 * ratio + Math.min(extra, 2) * 3;
  const need = minYears(job.exp), yrs = resume && resume.yearsNumber;
  if (need != null && yrs != null) score += yrs >= need ? 5 : -5 * Math.min(need - yrs, 3);
  return { match: clamp(Math.round(score), 15, 98), matchedTags };
}

/** ประเมินคำตอบสัมภาษณ์แบบ rule-based (STAR + คีย์เวิร์ด) */
function evaluateAnswer(question, answer) {
  const a = String(answer || '').trim();
  const len = a.replace(/\s+/g, '').length;
  const star = {
    situation: /สถานการณ์|ตอนที่|ครั้งหนึ่ง|ช่วงที่|เคย|ที่ทำงาน|ที่ร้าน|โปรเจกต์|โครงการ|บริษัทเก่า|ตอนเรียน|situation|when i|at my|project/i.test(a),
    task: /หน้าที่|รับผิดชอบ|เป้าหมาย|ภารกิจ|โจทย์|ต้องการ|task|goal|responsib|objective/i.test(a),
    action: /ลงมือ|ตัดสินใจ|วิเคราะห์|ออกแบบ|พัฒนา|พูดคุย|ประชุม|นำเสนอ|ทดสอบ|ปรับ|แก้ไข|เสนอ|i (?:led|designed|built|decided|created|proposed|analy[sz]ed)|action/i.test(a),
    result: /ผลลัพธ์|ส่งผล|ทำให้|เพิ่มขึ้น|ลดลง|สำเร็จ|ได้รับ|result|increase|reduc|improv|achiev/i.test(a)
  };
  const metric = /\d/.test(a);
  const teamworkHits = (a.match(/ทีม|เพื่อนร่วมงาน|developer|นักพัฒนา|stakeholder|ผู้มีส่วนได้ส่วนเสีย|ร่วมกัน|หัวหน้า|ลูกค้า|team|collaborat|สื่อสาร|รับฟัง/gi) || []).length;
  const problemHits = (a.match(/ปัญหา|แก้|วิธี|สาเหตุ|วิเคราะห์|ทางออก|ข้อมูล|ทดสอบ|ทางเลือก|problem|solv|root cause|test|data|option/gi) || []).length;
  const structure = (a.match(/แรก|ขั้นแรก|จากนั้น|ต่อมา|สุดท้าย|ดังนั้น|เพราะ|first|then|finally|because|so that/gi) || []).length;
  const starCount = Object.values(star).filter(Boolean).length;

  const lenScore = len < 40 ? 2 : len < 120 ? 5 : len < 250 ? 7 : len <= 1500 ? 9 : 7;
  const clarity = clamp(Math.round(lenScore * 0.6 + Math.min(structure, 3) + (starCount >= 3 ? 1 : 0)), 1, 10);
  const problem = clamp(Math.round((len < 40 ? 2 : 4) + Math.min(problemHits, 3) + (star.action ? 1.5 : 0) + (metric ? 1.5 : 0)), 1, 10);
  const teamwork = clamp(Math.round((len < 40 ? 2 : 4) + Math.min(teamworkHits, 4) * 1.25 + (star.result ? 1 : 0)), 1, 10);
  const total = clamp(Math.round(((clarity + problem + teamwork) / 3) * 8 + starCount * 4 + (metric ? 4 : 0)), 5, 100);

  const missing = [];
  if (!star.situation) missing.push('ปูบริบท/สถานการณ์ให้ชัด');
  if (!star.task) missing.push('บอกเป้าหมายหรือหน้าที่ของคุณ');
  if (!star.action) missing.push('อธิบายสิ่งที่คุณลงมือทำเอง');
  if (!star.result) missing.push('สรุปผลลัพธ์ที่เกิดขึ้น');
  let tip;
  if (len < 40) tip = 'คำตอบสั้นเกินไป ลองเล่าเป็นเรื่องราวตามโครงสร้าง STAR: สถานการณ์ → ภารกิจ → สิ่งที่ลงมือทำ → ผลลัพธ์';
  else if (missing.length) tip = `ลองเพิ่ม: ${missing.join(', ')}${metric ? '' : ' และใส่ตัวเลขวัดผล เช่น % หรือระยะเวลาที่ลดลง'}`;
  else if (!metric) tip = 'โครงสร้างดีแล้ว เพิ่มตัวเลขวัดผล (เช่น เพิ่มยอดขึ้น 20%, ลดเวลาลง 3 วัน) จะทำให้คำตอบน่าเชื่อถือขึ้นมาก';
  else tip = 'คำตอบครบตามโครงสร้าง STAR และมีตัวเลขสนับสนุน ลองฝึกพูดให้กระชับภายใน 1.5–2 นาที';
  const summary = total >= 80 ? 'ตอบได้ดีมาก ชัดเจนและมีหลักฐานสนับสนุน' : total >= 60 ? 'ตอบได้ดี แต่ยังเสริมรายละเอียดได้อีก' : total >= 40 ? 'พอใช้ ควรเล่าให้เป็นขั้นตอนและยกตัวอย่างจริง' : 'ควรปรับปรุง คำตอบยังขาดรายละเอียดสำคัญ';
  return { total, clarity, problem, teamwork, summary, tip };
}

/* คลังคำถามสัมภาษณ์ทั่วไป ใช้ได้กับทุกอาชีพ (พนักงานขาย, แคชเชียร์, พยาบาล, วิศวกร, นักออกแบบ, ฯลฯ)
 * จัดเป็นหมวด แล้วสุ่มหมวดละไม่เกิน 1 ข้อ เพื่อให้แต่ละชุดครอบคลุมหลายด้าน */
const QUESTION_BANK = {
  intro: [
    'ช่วยแนะนำตัวเองสั้น ๆ ภายใน 1–2 นาที ว่าคุณเป็นใคร มีประสบการณ์อะไรบ้าง',
    'ถ้าให้อธิบายตัวเองด้วย 3 คำ คุณจะเลือกคำว่าอะไร และเพราะอะไร?',
    'เล่าเส้นทางการทำงานหรือการเรียนของคุณที่ผ่านมา ว่ามาถึงจุดนี้ได้อย่างไร'
  ],
  strengths: [
    'จุดแข็งที่สุดของคุณคืออะไร ยกตัวอย่างสถานการณ์จริงที่จุดแข็งนี้ช่วยให้งานสำเร็จ',
    'จุดที่คุณยังต้องพัฒนาคืออะไร และตอนนี้คุณกำลังทำอะไรเพื่อปรับปรุงมัน?',
    'เพื่อนร่วมงานหรือหัวหน้าเก่ามักชมคุณเรื่องอะไร และติเรื่องอะไร?'
  ],
  teamwork: [
    'เล่าถึงครั้งที่คุณมีความเห็นไม่ตรงกับเพื่อนร่วมงานหรือหัวหน้า คุณจัดการอย่างไร?',
    'ถ้าเพื่อนร่วมทีมคนหนึ่งไม่ทำงานในส่วนของตัวเอง จนกระทบงานของทั้งทีม คุณจะทำอย่างไร?',
    'เล่าประสบการณ์ที่คุณได้ช่วยเหลือเพื่อนร่วมงานจนงานของทีมสำเร็จ'
  ],
  problem: [
    'เล่าถึงปัญหาที่ยากที่สุดที่คุณเคยเจอในการทำงานหรือการเรียน คุณแก้ไขอย่างไร และผลเป็นอย่างไร?',
    'ถ้าเจอปัญหาที่ไม่เคยเจอมาก่อนและไม่มีใครให้ถามได้ทันที คุณจะเริ่มต้นแก้อย่างไร?',
    'เล่าถึงครั้งที่คุณเสนอวิธีทำงานใหม่ที่ช่วยให้งานเร็วขึ้นหรือดีขึ้น'
  ],
  pressure: [
    'ถ้ามีงานด่วนหลายงานเข้ามาพร้อมกัน คุณจัดลำดับความสำคัญอย่างไร?',
    'เล่าถึงช่วงที่คุณต้องทำงานภายใต้ความกดดันหรือเส้นตายที่กระชั้นชิด คุณรับมืออย่างไร?',
    'เวลารู้สึกเครียดจากงาน คุณมีวิธีจัดการความเครียดของตัวเองอย่างไร?'
  ],
  failure: [
    'เล่าถึงความผิดพลาดในการทำงานที่คุณเคยทำ คุณแก้ไขอย่างไร และได้บทเรียนอะไร?',
    'เคยมีงานที่คุณทำไม่สำเร็จตามเป้าหมายไหม เกิดอะไรขึ้น และถ้าย้อนกลับไปได้จะทำต่างไปอย่างไร?',
    'ถ้าได้รับคำติชมที่ไม่ค่อยดีจากหัวหน้า คุณจะรับมือและนำไปปรับใช้อย่างไร?'
  ],
  service: [
    'ถ้าเจอลูกค้าหรือผู้รับบริการที่ไม่พอใจและพูดจาไม่สุภาพ คุณจะจัดการสถานการณ์อย่างไร?',
    'เล่าถึงครั้งที่คุณทำมากกว่าที่ได้รับมอบหมาย เพื่อให้ลูกค้าหรือคนที่คุณทำงานด้วยพอใจ',
    'คุณคิดว่าการบริการที่ดีคืออะไร ยกตัวอย่างจากประสบการณ์ของคุณ'
  ],
  communication: [
    'ถ้าต้องอธิบายเรื่องที่ซับซ้อนให้คนที่ไม่มีความรู้ด้านนั้นเข้าใจ คุณจะทำอย่างไร?',
    'เล่าถึงครั้งที่การสื่อสารผิดพลาดทำให้เกิดปัญหา และคุณแก้ไขอย่างไร',
    'ถ้าต้องแจ้งข่าวไม่ดีกับหัวหน้าหรือลูกค้า คุณจะสื่อสารอย่างไร?'
  ],
  leadership: [
    'เล่าถึงครั้งที่คุณต้องเป็นผู้นำหรือรับผิดชอบงานแทนคนอื่น คุณทำอย่างไร?',
    'ถ้าได้รับมอบหมายงานที่ไม่ชัดเจน ไม่มีใครบอกขั้นตอน คุณจะเริ่มทำอย่างไร?',
    'เล่าตัวอย่างที่คุณตัดสินใจเรื่องสำคัญด้วยตัวเอง คุณใช้ข้อมูลอะไรประกอบการตัดสินใจ?'
  ],
  adapt: [
    'เล่าถึงครั้งที่ต้องปรับตัวกับการเปลี่ยนแปลงกะทันหันในงาน เช่น เปลี่ยนหัวหน้า เปลี่ยนวิธีทำงาน',
    'ถ้าต้องเรียนรู้งานหรือเครื่องมือใหม่ให้ได้ภายในเวลาสั้น ๆ คุณจะเรียนรู้อย่างไร?',
    'ถ้าต้องทำงานในวันหยุดหรือนอกเวลาเป็นครั้งคราว คุณคิดอย่างไร?'
  ],
  ethics: [
    'ถ้าเห็นเพื่อนร่วมงานทำสิ่งที่ผิดกฎของบริษัท คุณจะทำอย่างไร?',
    'ถ้าหัวหน้าสั่งงานที่คุณคิดว่าไม่ถูกต้อง คุณจะจัดการอย่างไร?'
  ],
  motivation: [
    'ทำไมคุณถึงสนใจงานนี้ และรู้จักบริษัทของเรามากแค่ไหน?',
    'อีก 3–5 ปีข้างหน้า คุณมองเห็นตัวเองเป็นอย่างไรในสายอาชีพนี้?',
    'อะไรทำให้คุณมีแรงจูงใจในการทำงานมากที่สุด?',
    'ทำไมเราควรเลือกคุณมากกว่าผู้สมัครคนอื่น?',
    'ทำไมคุณถึงอยากออกจากงานเดิม หรือกำลังมองหางานใหม่?'
  ]
};
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** สุ่มคำถามสัมภาษณ์ 5 ข้อ: แนะนำตัว + 3 หมวดพฤติกรรม/สถานการณ์ที่ไม่ซ้ำกัน + แรงจูงใจ
 *  ถ้าเลือกตำแหน่งงานไว้ จะแทรกคำถามเฉพาะตำแหน่ง 1 ข้อ (ใช้ชื่อตำแหน่ง/บริษัท) */
function interviewQuestions(job) {
  const middle = shuffle(['strengths', 'teamwork', 'problem', 'pressure', 'failure', 'service', 'communication', 'leadership', 'adapt', 'ethics']).slice(0, 3).map(k => pick(QUESTION_BANK[k]));
  const qs = [pick(QUESTION_BANK.intro), ...middle];
  if (job) {
    const skill = (job.tags || [])[0];
    qs[3] = pick([
      `ในตำแหน่ง ${job.title} คุณคิดว่าทักษะที่สำคัญที่สุดคืออะไร และคุณมีทักษะนั้นแค่ไหน?`,
      `ถ้าได้เริ่มงานตำแหน่ง ${job.title} ใน 30 วันแรก คุณจะทำอะไรบ้าง?`,
      skill ? `เล่าประสบการณ์ที่เกี่ยวกับ ${skill} ที่ทำให้คุณพร้อมสำหรับตำแหน่ง ${job.title}` : `คุณมีประสบการณ์อะไรที่ทำให้พร้อมสำหรับตำแหน่ง ${job.title}?`
    ]);
    qs.push(`ทำไมคุณถึงสนใจตำแหน่ง ${job.title} ที่ ${job.company} และคาดหวังอะไรจากงานนี้?`);
  } else qs.push(pick(QUESTION_BANK.motivation));
  return qs;
}

/** Cover letter แบบเทมเพลต (ใช้เมื่อไม่มี AI) */
function coverLetter(job, resume, name) {
  const skills = (resume && resume.skills) || [];
  const tagMatch = (job.tags || []).filter(t => skills.some(s => norm(s) === norm(canonicalSkill(t))));
  const show = [...new Set([...tagMatch, ...skills])].slice(0, 3);
  const yrs = resume && resume.years && resume.years !== 'ไม่ระบุ' ? `ประสบการณ์ทำงาน ${resume.years}` : 'ประสบการณ์และความตั้งใจ';
  const field = resume && resume.field ? ` ในสาย ${resume.field}` : '';
  return [
    `เรียน ฝ่ายทรัพยากรบุคคล ${job.company}`,
    '',
    `ข้าพเจ้ามีความสนใจสมัครงานในตำแหน่ง ${job.title} เป็นอย่างยิ่ง ด้วย${yrs}${field}${show.length ? ` และทักษะด้าน ${show.join(', ')}` : ''} ข้าพเจ้าเชื่อว่าจะสามารถช่วยให้ทีมบรรลุเป้าหมายได้ตั้งแต่วันแรก`,
    tagMatch.length ? `ทักษะที่ตรงกับความต้องการของตำแหน่งนี้ ได้แก่ ${tagMatch.join(', ')} ซึ่งข้าพเจ้าได้ใช้ในงานจริงมาแล้ว` : 'ข้าพเจ้าพร้อมเรียนรู้เครื่องมือและกระบวนการทำงานของทีมอย่างรวดเร็ว',
    'ข้าพเจ้าได้แนบ Resume และลิงก์ผลงานมาพร้อมนี้ และยินดีเข้ารับการสัมภาษณ์ในวันและเวลาที่สะดวก',
    '',
    'ขอแสดงความนับถือ',
    name || ''
  ].join('\n');
}

module.exports = { QUESTION_BANK, SKILLS, SKILL_NAMES, canonicalSkill, detectSkills, detectField, extractYears, yearsLabel, analyzeResume, matchJob, evaluateAnswer, interviewQuestions, coverLetter, minYears };
