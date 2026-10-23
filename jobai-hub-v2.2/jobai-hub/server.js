/* JobAI Hub v2.2 - Backend (Express + PostgreSQL + JWT + OpenAI Responses API) */
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const A = require('./lib/analyzer');
const AI = require('./lib/ai');
const { resumeReport } = require('./lib/report');

const run = promisify(execFile);
const app = express();
const PORT = +(process.env.PORT || 3000);
const VERSION = '2.2.0';

/* ---------- JWT secret: ห้ามใช้ค่า default ที่เดาได้ ---------- */
const WEAK_SECRETS = ['', 'change-this-secret', 'dev-secret-change-me', 'jobai-hub-super-secret-change-this'];
let JWT_SECRET = (process.env.JWT_SECRET || '').trim();
if (WEAK_SECRETS.includes(JWT_SECRET) || JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ ต้องตั้งค่า JWT_SECRET (อย่างน้อย 32 ตัวอักษร) ก่อนรันใน production');
    process.exit(1);
  }
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('⚠️  JWT_SECRET ยังไม่ได้ตั้งค่า/สั้นเกินไป — ระบบสุ่ม secret ชั่วคราวให้ (ผู้ใช้ต้องเข้าสู่ระบบใหม่ทุกครั้งที่รีสตาร์ท)');
}

const pool = new Pool({
  host: process.env.DB_HOST || 'db', port: +(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'admin', password: process.env.DB_PASSWORD || 'password123',
  database: process.env.DB_NAME || 'jobai_db', max: 10
});
pool.on('error', e => console.error('PostgreSQL pool error:', e.message));

const H = 36e5;
const STATUSES = ['applied', 'interview', 'offer', 'hired', 'rejected'];
const STATUS_TH = { applied: 'ยื่นสมัครแล้ว', interview: 'นัดสัมภาษณ์', offer: 'ได้รับข้อเสนอ (Offer)', hired: 'ได้งานแล้ว', rejected: 'ไม่ผ่านการคัดเลือก' };
const REVIEW_TYPES = ['ผู้รับการสัมภาษณ์', 'ผู้สมัครที่ได้รับการว่าจ้างจริง', 'ผู้สมัคร'];
const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8' };
const SAMPLES = path.join(__dirname, 'samples');

/* ---------- helpers ---------- */
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // ส่ง error ของ async ไปที่ error handler
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };
const toId = v => { const n = Number(v); if (!Number.isInteger(n) || n <= 0 || n > 2147483647) bad('รหัสอ้างอิงไม่ถูกต้อง'); return n; };
const str = (v, max, label, { required = false, min = 0 } = {}) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) bad(`กรุณากรอก${label}`);
  if (s && s.length < min) bad(`${label}ต้องมีอย่างน้อย ${min} ตัวอักษร`);
  if (s.length > max) bad(`${label}ยาวเกิน ${max} ตัวอักษร`);
  return s;
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const notify = (userId, text) => userId ? pool.query('INSERT INTO notifications(user_id,text) VALUES($1,$2)', [userId, text]) : null;
const bangkokAt = (daysAhead, hour) => { // วันที่ +N วัน เวลา hour:00 น. (เวลาไทย)
  const d = new Date(Date.now() + daysAhead * 24 * H);
  const ymd = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00+07:00`);
};

/* ---------- middleware ---------- */
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
// เสิร์ฟเฉพาะโฟลเดอร์ public เท่านั้น (ไม่เปิดเผย server.js, docker-compose.yml, data.json)
app.use(express.static(path.join(__dirname, 'public')));

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบ' });
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' }); }
    const r = await pool.query('SELECT id,username,email,role,name,company,password_changed_at FROM users WHERE id=$1', [payload.id]);
    const u = r.rows[0];
    if (!u) return res.status(401).json({ message: 'ไม่พบบัญชีผู้ใช้ กรุณาเข้าสู่ระบบใหม่' });
    if (u.password_changed_at && payload.iat < Math.floor(new Date(u.password_changed_at).getTime() / 1000)) {
      return res.status(401).json({ message: 'มีการเปลี่ยนรหัสผ่าน กรุณาเข้าสู่ระบบใหม่' });
    }
    req.user = { id: u.id, username: u.username, email: u.email, role: u.role, name: u.name, company: u.company };
    next();
  } catch (e) { next(e); }
}
const role = r => (req, res, next) => req.user.role === r ? next() : res.status(403).json({ message: 'ไม่มีสิทธิ์ใช้งานส่วนนี้' });
const seeker = [auth, role('job_seeker')];
const employer = [auth, role('employer')];
const publicUser = u => ({ id: u.id, username: u.username, email: u.email, role: u.role, name: u.name, company: u.company || null });
const tokenFor = u => jwt.sign({ id: u.id, role: u.role }, JWT_SECRET, { expiresIn: '7d' });

// จำกัดการลองรหัสผ่านผิด: 10 ครั้ง / 15 นาที ต่อ IP+username
const attempts = new Map();
const LOCK_MS = 15 * 60 * 1000, MAX_TRIES = 10;
function loginBlocked(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > LOCK_MS) { attempts.delete(key); return false; }
  return a.count >= MAX_TRIES;
}
function loginFailed(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > LOCK_MS) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}
setInterval(() => { for (const [k, a] of attempts) if (Date.now() - a.first > LOCK_MS) attempts.delete(k); }, LOCK_MS).unref();

/* ---------- data access ---------- */
async function getResume(userId, withFile = false) {
  const r = await pool.query(`SELECT filename,analyzed_at,score,skills,years,years_number,recs,field,ai,resume_text,
    (file_data IS NOT NULL) AS has_file ${withFile ? ',file_data,mime_type' : ''} FROM resumes WHERE user_id=$1`, [userId]);
  const x = r.rows[0];
  if (!x || !x.filename) return null;
  return {
    filename: x.filename, analyzedAt: x.analyzed_at, score: x.score, skills: x.skills || [], years: x.years || 'ไม่ระบุ',
    yearsNumber: x.years_number, recs: x.recs || [], field: x.field, ai: !!x.ai,
    text: x.resume_text || '', hasFile: x.has_file, fileData: x.file_data, mimeType: x.mime_type
  };
}
const resumeOut = r => r ? { filename: r.filename, analyzedAt: r.analyzedAt, score: r.score, skills: r.skills, years: r.years, recs: r.recs, field: r.field, ai: r.ai, hasFile: r.hasFile }
  : { filename: '', empty: true, score: 0, skills: [], years: 'ไม่ระบุ', recs: [], field: null, ai: false };
const jobOut = (x, resume) => {
  const { match, matchedTags } = A.matchJob({ ...x, tags: x.tags || [] }, resume);
  return {
    id: x.id, company: x.company, title: x.title, location: x.location, salaryMin: x.salary_min, salaryMax: x.salary_max,
    exp: x.exp, tags: x.tags || [], description: x.description, postedAt: x.posted_at, active: x.active, match, matchedTags
  };
};
const mapApp = a => ({
  id: a.id, jobId: a.job_id, title: a.title, company: a.company, status: a.status, appliedAt: a.applied_at, interviewAt: a.interview_at,
  name: a.name, email: a.email, portfolio: a.portfolio, coverLetter: a.cover_letter, resumeName: a.resume_name, match: a.match, jobActive: a.job_active
});
async function getJob(id) {
  const r = await pool.query('SELECT * FROM jobs WHERE id=$1', [id]);
  return r.rows[0] ? { ...r.rows[0], tags: r.rows[0].tags || [] } : null;
}

/* ---------- system ---------- */
app.get('/api/status', (req, res) => res.json({ version: VERSION, ai: AI.enabled(), model: AI.enabled() ? AI.model() : null }));

/* ---------- auth ---------- */
app.post('/register', ah(async (req, res) => {
  const b = req.body || {};
  const username = str(b.username, 30, 'Username', { required: true, min: 3 });
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) bad('Username ใช้ได้เฉพาะ a-z, 0-9, _ . -');
  const email = str(b.email, 120, 'อีเมล', { required: true }).toLowerCase();
  if (!EMAIL_RE.test(email)) bad('รูปแบบอีเมลไม่ถูกต้อง');
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < 8) bad('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  if (Buffer.byteLength(password) > 72) bad('รหัสผ่านยาวเกินไป');
  const name = str(b.name, 100, 'ชื่อ-นามสกุล', { required: true });
  const userRole = b.role === 'employer' ? 'employer' : 'job_seeker';
  const company = userRole === 'employer' ? str(b.company, 120, 'ชื่อบริษัท', { required: true }) : null;
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = await pool.query(`INSERT INTO users(username,email,password_hash,role,name,company) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,username,email,role,name,company`,
      [username, email, hash, userRole, name, company]);
    const u = r.rows[0];
    await notify(u.id, userRole === 'employer' ? 'ยินดีต้อนรับสู่ Employer Portal เริ่มลงประกาศงานแรกได้เลย' : 'ยินดีต้อนรับสู่ JobAI Hub เริ่มจากอัปโหลด Resume ให้ AI วิเคราะห์');
    res.status(201).json({ message: 'สมัครสมาชิกสำเร็จ', token: tokenFor(u), user: publicUser(u) });
  } catch (e) {
    if (e.code === '23505') bad('Username หรือ Email ถูกใช้งานแล้ว', 409);
    throw e;
  }
}));

app.post('/login', ah(async (req, res) => {
  const b = req.body || {};
  const username = str(b.username, 60, 'Username', { required: true });
  const password = typeof b.password === 'string' ? b.password : '';
  const key = `${req.ip}|${username.toLowerCase()}`;
  if (loginBlocked(key)) bad('ลองรหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาที', 429);
  const r = await pool.query('SELECT * FROM users WHERE lower(username)=lower($1)', [username]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) { loginFailed(key); bad('Username หรือ Password ไม่ถูกต้อง', 401); }
  attempts.delete(key);
  res.json({ message: 'เข้าสู่ระบบสำเร็จ', token: tokenFor(u), user: publicUser(u) });
}));

app.post('/logout', (req, res) => res.json({ message: 'ออกจากระบบสำเร็จ' }));

app.post('/change-password', auth, ah(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) bad('กรอกรหัสผ่านเดิมและรหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร');
  if (Buffer.byteLength(newPassword) > 72) bad('รหัสผ่านยาวเกินไป');
  if (currentPassword === newPassword) bad('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
  const q = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!q.rowCount || !(await bcrypt.compare(currentPassword, q.rows[0].password_hash))) bad('รหัสผ่านเดิมไม่ถูกต้อง');
  const hash = await bcrypt.hash(newPassword, 10);
  // ตัดวินาทีให้เป็นจำนวนเต็ม เพื่อให้ token ใหม่ที่ออกในวินาทีเดียวกันยังใช้ได้ แต่ token เก่าทั้งหมดใช้ไม่ได้
  await pool.query(`UPDATE users SET password_hash=$1,password_changed_at=date_trunc('second',now()) WHERE id=$2`, [hash, req.user.id]);
  res.json({ message: 'เปลี่ยนรหัสผ่านสำเร็จ', token: tokenFor(req.user) });
}));

app.get('/me', auth, (req, res) => res.json(publicUser(req.user)));
app.get('/check-username/:name', ah(async (req, res) => {
  const r = await pool.query('SELECT 1 FROM users WHERE lower(username)=lower($1)', [String(req.params.name).slice(0, 60)]);
  res.json({ available: !r.rowCount, message: r.rowCount ? 'Username นี้ถูกใช้งานแล้ว' : 'Username นี้สามารถใช้งานได้' });
}));

/* ---------- job seeker: resume ---------- */
app.get('/api/resume', seeker, ah(async (req, res) => res.json(resumeOut(await getResume(req.user.id)))));

async function extractText(buffer, ext) {
  if (ext === 'pdf') {
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    let text = '';
    try { text = (await pdfParse(buffer)).text || ''; } catch (e) { console.warn('pdf-parse:', e.message); }
    if (text.replace(/\s/g, '').length < 20) text = await ocrScannedPdf(buffer); // PDF สแกน -> OCR
    return text;
  }
  if (ext === 'docx') return (await require('mammoth').extractRawText({ buffer })).value || '';
  return buffer.toString('utf8');
}

async function ocrScannedPdf(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobai-ocr-'));
  try {
    const pdf = path.join(dir, 'resume.pdf');
    fs.writeFileSync(pdf, buffer);
    await run('pdftoppm', ['-f', '1', '-l', '5', '-r', '200', '-png', pdf, path.join(dir, 'page')], { timeout: 60000 });
    const images = fs.readdirSync(dir).filter(n => /^page-\d+\.png$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    const pages = [];
    for (const img of images) {
      const { stdout } = await run('tesseract', [path.join(dir, img), 'stdout', '-l', 'tha+eng', '--psm', '3'], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      pages.push(stdout);
    }
    return pages.join('\n').trim();
  } catch (e) {
    console.warn('OCR failed:', e.code === 'ENOENT' ? 'ไม่พบ pdftoppm/tesseract (ใช้ Docker เพื่อเปิด OCR)' : e.message);
    return '';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function analyzeText(text) {
  const rules = A.analyzeResume(text);
  if (!AI.enabled()) return { ...rules, ai: false };
  try {
    const r = await AI.analyzeResume(text, A.SKILL_NAMES);
    const skills = [...new Set((r.skills || []).map(s => A.canonicalSkill(String(s).trim())).filter(Boolean))].slice(0, 12);
    const yearsNumber = typeof r.yearsNumber === 'number' && r.yearsNumber >= 0 && r.yearsNumber < 60 ? r.yearsNumber : rules.yearsNumber;
    const recs = (r.recs || []).filter(x => x && x.title && x.text).slice(0, 4);
    return {
      score: Math.max(0, Math.min(100, Math.round(r.score))), skills: skills.length ? skills : rules.skills,
      yearsNumber, years: A.yearsLabel(yearsNumber), field: String(r.field || rules.field || '').slice(0, 60) || null,
      recs: recs.length ? recs : rules.recs, ai: true
    };
  } catch (e) {
    console.warn('AI resume analysis failed, using rules:', e.message);
    return { ...rules, ai: false, aiError: true };
  }
}

app.post('/api/resume/analyze', express.raw({ type: '*/*', limit: '10mb' }), seeker, ah(async (req, res) => {
  // Express decode query string ให้แล้ว ห้าม decodeURIComponent ซ้ำ
  const filename = path.basename(String(req.query.filename || 'resume.txt')).replace(/[\u0000-\u001f"\\]/g, '').slice(0, 150) || 'resume.txt';
  const ext = (filename.match(/\.(pdf|docx|txt|md)$/i) || [])[1];
  if (!ext) bad('รองรับเฉพาะไฟล์ PDF, DOCX, TXT, MD');
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!buf.length) bad('ไฟล์ว่างเปล่า');
  const e = ext.toLowerCase();
  if (e === 'pdf' && buf.subarray(0, 5).toString() !== '%PDF-') bad('ไฟล์นี้ไม่ใช่ PDF ที่ถูกต้อง');
  if (e === 'docx' && buf.subarray(0, 2).toString() !== 'PK') bad('ไฟล์นี้ไม่ใช่ DOCX ที่ถูกต้อง');

  let text = '';
  try { text = await extractText(buf, e); } catch (err) {
    console.error('Resume extraction error:', err.message);
    bad('อ่านข้อความจากไฟล์ไม่ได้ กรุณาตรวจสอบไฟล์ PDF/DOCX หรือทดลองไฟล์อื่น', 422);
  }
  if (text.replace(/\s/g, '').length < 20) bad('ไม่พบข้อความที่อ่านได้ในเรซูเม่ กรุณาใช้ไฟล์ที่ชัดเจนขึ้น หรือบันทึกเป็น PDF ที่เลือกข้อความได้', 422);

  text = text.replace(/\u0000/g, ''); // PostgreSQL TEXT ไม่รับ NUL byte
  const result = await analyzeText(text);
  await pool.query(`INSERT INTO resumes(user_id,filename,analyzed_at,score,skills,years,years_number,recs,field,ai,resume_text,file_data,mime_type)
    VALUES($1,$2,now(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(user_id) DO UPDATE SET filename=EXCLUDED.filename,analyzed_at=now(),score=EXCLUDED.score,skills=EXCLUDED.skills,years=EXCLUDED.years,years_number=EXCLUDED.years_number,
      recs=EXCLUDED.recs,field=EXCLUDED.field,ai=EXCLUDED.ai,resume_text=EXCLUDED.resume_text,file_data=EXCLUDED.file_data,mime_type=EXCLUDED.mime_type`,
    [req.user.id, filename, result.score, JSON.stringify(result.skills), result.years, result.yearsNumber, JSON.stringify(result.recs), result.field, result.ai, text.slice(0, 20000), buf, MIME[e]]);
  await notify(req.user.id, `วิเคราะห์ Resume "${filename}" เสร็จแล้ว ได้คะแนน ${result.score}/100`);
  res.json({ ...resumeOut(await getResume(req.user.id)), aiError: !!result.aiError });
}));

app.get('/api/resume/report', seeker, ah(async (req, res) => {
  const resume = await getResume(req.user.id);
  if (!resume) bad('ยังไม่มีผลวิเคราะห์ Resume', 404);
  const jobs = (await pool.query('SELECT * FROM jobs WHERE active=true')).rows.map(j => jobOut(j, resume)).sort((a, b) => (b.match || 0) - (a.match || 0));
  res.type('html').send(resumeReport({ user: req.user, resume, jobs }));
}));

/* ---------- job seeker: jobs & applications ---------- */
app.get('/api/jobs', seeker, ah(async (req, res) => {
  const resume = await getResume(req.user.id);
  const r = await pool.query('SELECT * FROM jobs WHERE active=true ORDER BY posted_at DESC');
  res.json(r.rows.map(x => jobOut(x, resume)));
}));

app.post('/api/applications', seeker, ah(async (req, res) => {
  const b = req.body || {};
  const jobId = toId(b.jobId);
  const name = str(b.name, 100, 'ชื่อ-นามสกุล', { required: true });
  const email = str(b.email, 120, 'อีเมล', { required: true });
  if (!EMAIL_RE.test(email)) bad('รูปแบบอีเมลไม่ถูกต้อง');
  const portfolio = str(b.portfolio, 300, 'ลิงก์ผลงาน');
  if (portfolio && !/^https?:\/\//i.test(portfolio)) bad('ลิงก์ผลงานต้องขึ้นต้นด้วย http:// หรือ https://');
  const coverLetter = str(b.coverLetter, 5000, 'ข้อความถึง HR', { required: true });
  const job = await getJob(jobId);
  if (!job || !job.active) bad('ไม่พบตำแหน่งงานนี้ หรือปิดรับสมัครแล้ว', 404);
  const resume = await getResume(req.user.id, true);
  if (!resume) bad('กรุณาอัปโหลด Resume ก่อนสมัครงาน');
  const { match } = A.matchJob(job, resume);
  try {
    const r = await pool.query(`INSERT INTO applications(job_id,user_id,name,email,portfolio,cover_letter,resume_name,resume_data,resume_mime,match)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [jobId, req.user.id, name, email, portfolio || null, coverLetter, resume.filename, resume.fileData || null, resume.mimeType || null, match]);
    await notify(req.user.id, `ส่งใบสมัครตำแหน่ง ${job.title} ไปยัง ${job.company} เรียบร้อยแล้ว`);
    await notify(job.employer_id, `มีผู้สมัครใหม่: ${name} สมัครตำแหน่ง ${job.title}`);
    res.status(201).json(mapApp({ ...r.rows[0], title: job.title, company: job.company }));
  } catch (e) {
    if (e.code === '23505') bad('คุณสมัครตำแหน่งนี้ไปแล้ว', 409);
    throw e;
  }
}));

app.get('/api/applications', seeker, ah(async (req, res) => {
  const r = await pool.query(`SELECT a.*,j.title,j.company,j.active AS job_active FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=$1 ORDER BY a.applied_at DESC`, [req.user.id]);
  res.json(r.rows.map(mapApp));
}));

app.delete('/api/applications/:id', seeker, ah(async (req, res) => {
  const id = toId(req.params.id);
  const r = await pool.query(`DELETE FROM applications a USING jobs j WHERE a.id=$1 AND a.user_id=$2 AND j.id=a.job_id RETURNING j.employer_id,j.title,a.name`, [id, req.user.id]);
  if (!r.rowCount) bad('ไม่พบใบสมัครนี้', 404);
  await notify(r.rows[0].employer_id, `${r.rows[0].name} ถอนใบสมัครตำแหน่ง ${r.rows[0].title}`);
  res.json({ message: 'ถอนใบสมัครเรียบร้อย' });
}));

/* ---------- job seeker: AI cover letter & interview coach ---------- */
app.post('/api/cover-letter', seeker, ah(async (req, res) => {
  const job = await getJob(toId((req.body || {}).jobId));
  if (!job) bad('ไม่พบตำแหน่งงานนี้', 404);
  const resume = await getResume(req.user.id);
  if (!resume) bad('กรุณาอัปโหลด Resume ก่อน');
  const name = str((req.body || {}).name, 100, 'ชื่อ') || req.user.name;
  if (AI.enabled()) {
    try {
      const r = await AI.coverLetter(job, resume, name);
      if (r.letter && r.letter.trim().length > 50) return res.json({ letter: r.letter.trim(), ai: true });
    } catch (e) { console.warn('AI cover letter failed, using template:', e.message); }
  }
  res.json({ letter: A.coverLetter(job, resume, name), ai: false });
}));

app.get('/api/interview/questions', seeker, ah(async (req, res) => {
  let job = null;
  if (req.query.jobId) {
    job = await getJob(toId(req.query.jobId));
    if (!job) bad('ไม่พบตำแหน่งงานนี้', 404);
  }
  const resume = await getResume(req.user.id);
  if (AI.enabled()) {
    try {
      const r = await AI.interviewQuestions(job, resume);
      const qs = (r.questions || []).map(q => String(q).trim()).filter(q => q.length > 5).slice(0, 5);
      if (qs.length >= 3) return res.json({ questions: qs, ai: true, job: job && { id: job.id, title: job.title, company: job.company } });
    } catch (e) { console.warn('AI questions failed, using template:', e.message); }
  }
  res.json({ questions: A.interviewQuestions(job), ai: false, job: job && { id: job.id, title: job.title, company: job.company } });
}));

app.post('/api/interview/evaluate', seeker, ah(async (req, res) => {
  const b = req.body || {};
  const question = str(b.question, 500, 'คำถาม', { required: true });
  const answer = str(b.answer, 4000, 'คำตอบ', { required: true });
  const job = b.jobId ? await getJob(toId(b.jobId)) : null;
  let result = null, ai = false;
  if (AI.enabled()) {
    try {
      const r = await AI.evaluateAnswer(question, answer, job);
      const c10 = n => Math.max(1, Math.min(10, Math.round(+n || 1)));
      result = { total: Math.max(0, Math.min(100, Math.round(+r.total || 0))), clarity: c10(r.clarity), problem: c10(r.problem), teamwork: c10(r.teamwork), summary: String(r.summary || '').slice(0, 300), tip: String(r.tip || '').slice(0, 600) };
      ai = true;
    } catch (e) { console.warn('AI evaluation failed, using rules:', e.message); }
  }
  if (!result) result = A.evaluateAnswer(question, answer);
  await pool.query(`INSERT INTO interview_answers(user_id,job_id,question,answer,total,clarity,problem,teamwork,summary,tip,ai) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [req.user.id, job ? job.id : null, question, answer, result.total, result.clarity, result.problem, result.teamwork, result.summary, result.tip, ai]);
  res.json({ ...result, ai });
}));

app.get('/api/interview/history', seeker, ah(async (req, res) => {
  const r = await pool.query(`SELECT i.id,i.question,i.total,i.clarity,i.problem,i.teamwork,i.summary,i.ai,i.created_at AS "createdAt",j.title AS "jobTitle"
    FROM interview_answers i LEFT JOIN jobs j ON j.id=i.job_id WHERE i.user_id=$1 ORDER BY i.created_at DESC LIMIT 20`, [req.user.id]);
  res.json(r.rows);
}));

/* ---------- reviews & notifications ---------- */
app.get('/api/reviews', auth, ah(async (req, res) => {
  const r = await pool.query(`SELECT id,company,position,rating,comment,type,created_at AS "createdAt",(user_id=$1) AS mine FROM reviews ORDER BY created_at DESC LIMIT 100`, [req.user.id]);
  res.json(r.rows);
}));
app.post('/api/reviews', seeker, ah(async (req, res) => {
  const b = req.body || {};
  const company = str(b.company, 120, 'ชื่อบริษัท', { required: true });
  const position = str(b.position, 120, 'ตำแหน่ง', { required: true });
  const comment = str(b.comment, 2000, 'รีวิว', { required: true, min: 10 });
  const rating = Number(b.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) bad('กรุณาให้คะแนน 1–5 ดาว');
  const type = REVIEW_TYPES.includes(b.type) ? b.type : 'ผู้สมัคร';
  const r = await pool.query(`INSERT INTO reviews(user_id,company,position,type,rating,comment) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,company,position,rating,comment,type,created_at AS "createdAt"`,
    [req.user.id, company, position, type, rating, comment]);
  res.status(201).json(r.rows[0]);
}));
app.get('/api/notifications', auth, ah(async (req, res) => {
  const r = await pool.query(`SELECT id,text,read,created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.user.id]);
  res.json(r.rows);
}));
app.post('/api/notifications/read', auth, ah(async (req, res) => {
  await pool.query('UPDATE notifications SET read=true WHERE user_id=$1 AND read=false', [req.user.id]);
  res.json({ message: 'อ่านแล้ว' });
}));

/* ---------- employer ---------- */
function jobInput(b, partial = false) {
  const out = {};
  if (!partial || b.title !== undefined) out.title = str(b.title, 120, 'ชื่อตำแหน่ง', { required: true });
  if (!partial || b.company !== undefined) out.company = str(b.company, 120, 'ชื่อบริษัท', { required: true });
  if (!partial || b.location !== undefined) out.location = str(b.location, 150, 'สถานที่');
  if (!partial || b.exp !== undefined) out.exp = str(b.exp, 50, 'ประสบการณ์');
  if (!partial || b.description !== undefined) out.description = str(b.description, 5000, 'รายละเอียดงาน');
  if (!partial || b.salaryMin !== undefined || b.salaryMax !== undefined) {
    let min = Math.max(0, Math.round(+b.salaryMin || 0)), max = Math.max(0, Math.round(+b.salaryMax || 0));
    if (min > 10000000 || max > 10000000) bad('เงินเดือนไม่ถูกต้อง');
    if (min && max && min > max) [min, max] = [max, min];
    out.salary_min = min; out.salary_max = max;
  }
  if (!partial || b.tags !== undefined) {
    const tags = Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(',');
    out.tags = JSON.stringify([...new Set(tags.map(t => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 10));
  }
  if (b.active !== undefined) out.active = Boolean(b.active);
  return out;
}

app.get('/api/employer/jobs', employer, ah(async (req, res) => {
  const r = await pool.query(`SELECT j.*,COUNT(a.id)::int AS applications FROM jobs j LEFT JOIN applications a ON a.job_id=j.id WHERE j.employer_id=$1 GROUP BY j.id ORDER BY j.active DESC,j.posted_at DESC`, [req.user.id]);
  res.json(r.rows.map(x => ({ ...jobOut(x, null), applications: x.applications })));
}));
app.post('/api/employer/jobs', employer, ah(async (req, res) => {
  const j = jobInput(req.body || {});
  const r = await pool.query(`INSERT INTO jobs(employer_id,company,title,location,salary_min,salary_max,exp,tags,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.user.id, j.company, j.title, j.location, j.salary_min, j.salary_max, j.exp, j.tags, j.description]);
  res.status(201).json(jobOut(r.rows[0], null));
}));
app.patch('/api/employer/jobs/:id', employer, ah(async (req, res) => {
  const id = toId(req.params.id);
  const j = jobInput(req.body || {}, true);
  const keys = Object.keys(j);
  if (!keys.length) bad('ไม่มีข้อมูลที่ต้องแก้ไข');
  const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(',');
  const r = await pool.query(`UPDATE jobs SET ${sets} WHERE id=$1 AND employer_id=$2 RETURNING *`, [id, req.user.id, ...keys.map(k => j[k])]);
  if (!r.rowCount) bad('ไม่พบงาน', 404);
  res.json(jobOut(r.rows[0], null));
}));
app.patch('/api/employer/jobs/:id/close', employer, ah(async (req, res) => {
  const r = await pool.query('UPDATE jobs SET active=false WHERE id=$1 AND employer_id=$2 RETURNING *', [toId(req.params.id), req.user.id]);
  if (!r.rowCount) bad('ไม่พบงาน', 404);
  res.json(jobOut(r.rows[0], null));
}));

app.get('/api/employer/applications', employer, ah(async (req, res) => {
  const r = await pool.query(`SELECT a.id,a.job_id,a.status,a.applied_at,a.interview_at,a.name,a.email,a.portfolio,a.cover_letter,a.resume_name,a.match,
      (a.resume_data IS NOT NULL OR rs.file_data IS NOT NULL) AS has_resume,j.title,j.company,u.username,u.name AS candidate_name
    FROM applications a JOIN jobs j ON j.id=a.job_id JOIN users u ON u.id=a.user_id LEFT JOIN resumes rs ON rs.user_id=a.user_id
    WHERE j.employer_id=$1 ORDER BY a.applied_at DESC`, [req.user.id]);
  res.json(r.rows.map(a => ({ ...mapApp(a), username: a.username, candidateName: a.candidate_name, hasResume: a.has_resume })));
}));
app.get('/api/employer/applications/:id/resume', employer, ah(async (req, res) => {
  const q = await pool.query(`SELECT a.resume_name,a.resume_data,a.resume_mime,rs.filename,rs.file_data,rs.mime_type
    FROM applications a JOIN jobs j ON j.id=a.job_id LEFT JOIN resumes rs ON rs.user_id=a.user_id WHERE a.id=$1 AND j.employer_id=$2`, [toId(req.params.id), req.user.id]);
  const f = q.rows[0];
  if (!f) bad('ไม่พบใบสมัคร', 404);
  // ใช้ไฟล์ที่แนบตอนสมัคร (snapshot) ก่อน ถ้าไม่มีจึงใช้ Resume ปัจจุบันของผู้สมัคร
  const data = f.resume_data || f.file_data, name = f.resume_data ? f.resume_name : f.filename, mime = f.resume_data ? f.resume_mime : f.mime_type;
  if (!data) bad('ไม่มีไฟล์ Resume ที่บันทึกไว้', 404);
  const inline = /pdf|text/.test(mime || '');
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name || 'resume')}`);
  res.send(data);
}));
app.patch('/api/employer/applications/:id/status', employer, ah(async (req, res) => {
  const id = toId(req.params.id);
  const status = (req.body || {}).status;
  if (!STATUSES.includes(status)) bad('สถานะไม่ถูกต้อง');
  let interviewAt = null;
  if (status === 'interview') {
    interviewAt = req.body.interviewAt ? new Date(req.body.interviewAt) : bangkokAt(3, 10);
    if (isNaN(interviewAt)) bad('วันเวลานัดสัมภาษณ์ไม่ถูกต้อง');
  }
  const r = await pool.query(`UPDATE applications a SET status=$1, interview_at=CASE WHEN $1='interview' THEN $4::timestamptz ELSE a.interview_at END
    FROM jobs j WHERE a.job_id=j.id AND a.id=$2 AND j.employer_id=$3 RETURNING a.*,j.title,j.company`, [status, id, req.user.id, interviewAt]);
  if (!r.rowCount) bad('ไม่พบใบสมัคร', 404);
  const a = r.rows[0];
  const when = status === 'interview' ? ` วันที่ ${new Date(a.interview_at).toLocaleString('th-TH-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })} น. เตรียมตัวกับ AI โค้ชได้เลย` : '';
  await notify(a.user_id, `${a.company}: ใบสมัครตำแหน่ง ${a.title} อัปเดตเป็น "${STATUS_TH[status]}"${when}`);
  res.json(mapApp(a));
}));

/* ---------- 404 & error handler ---------- */
app.use('/api', (req, res) => res.status(404).json({ message: 'ไม่พบ API นี้' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ message: err.type === 'entity.too.large' ? 'ไฟล์หรือข้อมูลใหญ่เกินกำหนด' : err.type === 'entity.parse.failed' ? 'รูปแบบข้อมูล JSON ไม่ถูกต้อง' : err.message });
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') return res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' });
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง' });
});
process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));

/* ---------- database ---------- */
const SEED_JOBS = [
  ['TechCorp Thailand Ltd.', 'Senior UX/UI Designer', 'กรุงเทพฯ (BTS อโศก / Hybrid)', 55000, 75000, '3-5 ปี', ['Figma', 'Design System', 'User Research'], 'นำทีมออกแบบผลิตภัณฑ์หลักขององค์กร วาง Design System และทำงานใกล้ชิดกับ Product และ Developer', 2],
  ['InnoFinTech Co., Ltd.', 'Product Designer (Mobile)', 'สีลม, กรุงเทพฯ (Work from Home 100%)', 60000, 80000, '2-4 ปี', ['Mobile App', 'Wireframing', 'Fintech'], 'ออกแบบประสบการณ์ผู้ใช้แอปการเงินบนมือถือ ตั้งแต่ Wireframe จนถึง Prototype พร้อมทดสอบกับผู้ใช้จริง', 24],
  ['Global Digital Agency', 'UI Developer & Designer', 'พระราม 9, กรุงเทพฯ', 45000, 55000, '2+ ปี', ['HTML/CSS', 'Figma', 'Tailwind'], 'ออกแบบหน้าเว็บด้วย Figma และลงมือพัฒนาเป็น HTML/CSS ให้ลูกค้าหลายอุตสาหกรรม', 72],
  ['CloudNine Software', 'UX Researcher', 'รัชดา, กรุงเทพฯ (Hybrid)', 50000, 70000, '2-4 ปี', ['User Research', 'Prototyping', 'Figma'], 'วางแผนและทำ User Research สรุปข้อค้นพบให้ทีมออกแบบและผลิตภัณฑ์นำไปใช้ตัดสินใจ', 10],
  ['PixelWorks Studio', 'Frontend Designer', 'เชียงใหม่ (Remote ได้)', 40000, 60000, '1-3 ปี', ['HTML/CSS', 'JavaScript', 'Tailwind'], 'สร้างหน้าเว็บที่สวยและใช้งานได้จริงด้วย Tailwind และ JavaScript ร่วมกับทีมออกแบบ', 48],
  ['HealthPlus Digital', 'UX/UI Designer (Healthtech)', 'สาทร, กรุงเทพฯ', 52000, 68000, '3+ ปี', ['UX/UI Design', 'Design System', 'Mobile App'], 'ออกแบบแอปสุขภาพที่ใช้งานง่ายสำหรับผู้ใช้ทุกช่วงวัย พร้อมดูแล Design System ของแพลตฟอร์ม', 30]
];
const SEED_REVIEWS = [
  ['TechCorp Thailand Ltd.', 'Senior UI Designer', 5, 'กระบวนการสัมภาษณ์ 2 รอบ บรรยากาศเป็นกันเองมาก AI Coach ช่วยเก็งคำถามเกี่ยวกับ Design System ให้ ตรงกับที่ HR ถามเกือบ 90% รู้ผลไวภายใน 3 วันทำการ', 'ผู้สมัครที่ได้รับการว่าจ้างจริง', 125],
  ['InnoFinTech Co., Ltd.', 'Product Designer', 4, 'มี Take-home Design Test ให้ทำ เวลา 3 วัน โจทย์ค่อนข้างท้าทายแต่ทีมงาน Feedback ละเอียดมาก สวัสดิการและเงินเดือนตรงตามที่แจ้งไว้', 'ผู้รับการสัมภาษณ์', 155],
  ['CloudNine Software', 'UX Researcher', 4, 'สัมภาษณ์รอบแรกเป็น Case Study ให้วางแผน Usability Test ภายใน 45 นาที ทีมใจดีและให้ Feedback ทันที', 'ผู้รับการสัมภาษณ์', 40]
];
function seedResumeFile() {
  const pdf = path.join(SAMPLES, 'Somchai_Resume_2026.pdf'), txt = path.join(SAMPLES, 'Somchai_Resume_2026.txt');
  return {
    text: fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : 'UX/UI Designer ประสบการณ์ 3 ปี 6 เดือน Figma User Research HTML/CSS',
    data: fs.existsSync(pdf) ? fs.readFileSync(pdf) : null
  };
}

async function initDb() {
  await pool.query(`
  CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,username TEXT UNIQUE NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'job_seeker',name TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT now());
  ALTER TABLE users ADD COLUMN IF NOT EXISTS company TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
  CREATE TABLE IF NOT EXISTS resumes(id SERIAL PRIMARY KEY,user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,filename TEXT,analyzed_at TIMESTAMPTZ,score INT,skills JSONB DEFAULT '[]',years TEXT,recs JSONB DEFAULT '[]',file_data BYTEA,mime_type TEXT);
  ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_data BYTEA;
  ALTER TABLE resumes ADD COLUMN IF NOT EXISTS mime_type TEXT;
  ALTER TABLE resumes ADD COLUMN IF NOT EXISTS resume_text TEXT;
  ALTER TABLE resumes ADD COLUMN IF NOT EXISTS field TEXT;
  ALTER TABLE resumes ADD COLUMN IF NOT EXISTS ai BOOLEAN DEFAULT FALSE;
  ALTER TABLE resumes ADD COLUMN IF NOT EXISTS years_number REAL;
  CREATE TABLE IF NOT EXISTS jobs(id SERIAL PRIMARY KEY,employer_id INT REFERENCES users(id) ON DELETE CASCADE,company TEXT NOT NULL,title TEXT NOT NULL,location TEXT,salary_min INT,salary_max INT,exp TEXT,tags JSONB DEFAULT '[]',description TEXT,base INT DEFAULT 70,posted_at TIMESTAMPTZ DEFAULT now(),active BOOLEAN DEFAULT TRUE);
  CREATE TABLE IF NOT EXISTS applications(id SERIAL PRIMARY KEY,job_id INT REFERENCES jobs(id) ON DELETE CASCADE,user_id INT REFERENCES users(id) ON DELETE CASCADE,status TEXT DEFAULT 'applied',applied_at TIMESTAMPTZ DEFAULT now(),interview_at TIMESTAMPTZ,name TEXT,email TEXT,portfolio TEXT,cover_letter TEXT,resume_name TEXT,match INT,UNIQUE(job_id,user_id));
  ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_data BYTEA;
  ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_mime TEXT;
  CREATE TABLE IF NOT EXISTS reviews(id SERIAL PRIMARY KEY,user_id INT REFERENCES users(id) ON DELETE SET NULL,company TEXT,position TEXT,rating INT,comment TEXT,type TEXT,created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS notifications(id SERIAL PRIMARY KEY,user_id INT REFERENCES users(id) ON DELETE CASCADE,text TEXT,read BOOLEAN DEFAULT FALSE,created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS interview_answers(id SERIAL PRIMARY KEY,user_id INT REFERENCES users(id) ON DELETE CASCADE,job_id INT REFERENCES jobs(id) ON DELETE SET NULL,question TEXT,answer TEXT,total INT,clarity INT,problem INT,teamwork INT,summary TEXT,tip TEXT,ai BOOLEAN DEFAULT FALSE,created_at TIMESTAMPTZ DEFAULT now());
  CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_employer ON jobs(employer_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_interview_user ON interview_answers(user_id,created_at DESC);`);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (!rows[0].n) {
    console.log('Seeding demo data...');
    const pw = await bcrypt.hash('demo1234', 10);
    const uid = (await pool.query(`INSERT INTO users(username,email,password_hash,role,name) VALUES('somchai','somchai.j@email.com',$1,'job_seeker','สมชาย ใจดี') RETURNING id`, [pw])).rows[0].id;
    const eid = (await pool.query(`INSERT INTO users(username,email,password_hash,role,name,company) VALUES('suda','suda@jobai.com',$1,'employer','สุดา HR','JobAI Partner Recruitment') RETURNING id`, [pw])).rows[0].id;
    for (const j of SEED_JOBS) {
      await pool.query(`INSERT INTO jobs(employer_id,company,title,location,salary_min,salary_max,exp,tags,description,posted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [eid, j[0], j[1], j[2], j[3], j[4], j[5], JSON.stringify(j[6]), j[7], new Date(Date.now() - j[8] * H)]);
    }
    const f = seedResumeFile(), an = A.analyzeResume(f.text);
    await pool.query(`INSERT INTO resumes(user_id,filename,analyzed_at,score,skills,years,years_number,recs,field,ai,resume_text,file_data,mime_type) VALUES($1,'Somchai_Resume_2026.pdf',now()-interval '1 day',$2,$3,$4,$5,$6,$7,false,$8,$9,$10)`,
      [uid, an.score, JSON.stringify(an.skills), an.years, an.yearsNumber, JSON.stringify(an.recs), an.field, f.text, f.data, f.data ? MIME.pdf : null]);
    const jobs = (await pool.query('SELECT * FROM jobs ORDER BY id')).rows;
    const resume = await getResume(uid);
    const cl = j => A.coverLetter({ ...j, tags: j.tags || [] }, resume, 'สมชาย ใจดี');
    const ins = `INSERT INTO applications(job_id,user_id,status,applied_at,interview_at,name,email,portfolio,cover_letter,resume_name,resume_data,resume_mime,match)
      VALUES($1,$2,$3,$4,$5,'สมชาย ใจดี','somchai.j@email.com','https://behance.net/somchai-ux',$6,'Somchai_Resume_2026.pdf',$7,$8,$9)`;
    await pool.query(ins, [jobs[2].id, uid, 'applied', new Date(Date.now() - 2 * 24 * H), null, cl(jobs[2]), f.data, f.data ? MIME.pdf : null, A.matchJob(jobs[2], resume).match]);
    await pool.query(ins, [jobs[0].id, uid, 'interview', new Date(Date.now() - 5 * 24 * H), bangkokAt(3, 14), cl(jobs[0]), f.data, f.data ? MIME.pdf : null, A.matchJob(jobs[0], resume).match]);
    await pool.query(`INSERT INTO notifications(user_id,text,created_at) VALUES($1,$2,now()-interval '3 hours'),($1,$3,now()-interval '1 day')`,
      [uid, 'TechCorp Thailand Ltd.: นัดสัมภาษณ์ตำแหน่ง Senior UX/UI Designer แล้ว เตรียมตัวกับ AI โค้ชได้เลย', 'HR ของ Global Digital Agency เปิดดูเรซูเม่ของคุณแล้ว']);
    await pool.query(`INSERT INTO notifications(user_id,text) VALUES($1,'มีผู้สมัครใหม่: สมชาย ใจดี สมัครตำแหน่ง UI Developer & Designer')`, [eid]);
  }

  // ซ่อมข้อมูลจากเวอร์ชันก่อน (สำหรับฐานข้อมูลเดิมที่ไม่ได้ลบ volume)
  for (const r of (await pool.query(`SELECT user_id,years FROM resumes WHERE years_number IS NULL AND years IS NOT NULL AND years<>'ไม่ระบุ'`)).rows) {
    await pool.query('UPDATE resumes SET years_number=$2 WHERE user_id=$1', [r.user_id, A.extractYears(`ประสบการณ์ ${r.years}`)]);
  }
  await pool.query(`UPDATE applications SET interview_at=applied_at+interval '7 days' WHERE status='interview' AND interview_at IS NULL`);
  await pool.query(`UPDATE applications a SET resume_data=r.file_data,resume_mime=r.mime_type FROM resumes r WHERE a.user_id=r.user_id AND a.resume_data IS NULL AND r.file_data IS NOT NULL AND a.resume_name=r.filename`);
  const somchai = (await pool.query(`SELECT r.user_id FROM resumes r JOIN users u ON u.id=r.user_id WHERE u.username='somchai' AND r.file_data IS NULL AND r.filename='Somchai_Resume_2026.pdf'`)).rows[0];
  if (somchai) {
    const f = seedResumeFile();
    if (f.data) {
      await pool.query(`UPDATE resumes SET file_data=$2,mime_type=$3,resume_text=COALESCE(resume_text,$4) WHERE user_id=$1`, [somchai.user_id, f.data, MIME.pdf, f.text]);
      await pool.query(`UPDATE applications SET resume_data=$2,resume_mime=$3 WHERE user_id=$1 AND resume_data IS NULL`, [somchai.user_id, f.data, MIME.pdf]);
    }
  }
  if (!(await pool.query('SELECT 1 FROM reviews LIMIT 1')).rowCount) {
    for (const r of SEED_REVIEWS) {
      await pool.query(`INSERT INTO reviews(company,position,rating,comment,type,created_at) VALUES($1,$2,$3,$4,$5,now()-($6 || ' days')::interval)`, r);
    }
  }
}

async function start() {
  for (let i = 1; ; i++) {
    try { await pool.query('SELECT 1'); break; } catch (e) {
      if (i >= 30) { console.error('❌ เชื่อมต่อ PostgreSQL ไม่ได้:', e.message); process.exit(1); }
      console.log(`Waiting for PostgreSQL... ${i}/30`);
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  try { await initDb(); } catch (e) { console.error('❌ เตรียมฐานข้อมูลไม่สำเร็จ:', e); process.exit(1); }
  const server = app.listen(PORT, () => console.log(`JobAI Hub v${VERSION} running on http://localhost:${PORT} • AI: ${AI.enabled() ? `เปิด (${AI.model()})` : 'ปิด (โหมดสำรอง)'}`));
  const stop = () => server.close(() => pool.end().finally(() => process.exit(0)));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

if (require.main === module) start();
module.exports = { app, initDb, pool };
