const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

app.use(express.json({ limit: '12mb' }));
app.get('/app.js', (req,res)=>res.sendFile(path.join(__dirname,'app.js')));
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));

const pool = new Pool({
  host: process.env.DB_HOST || 'db', port: +(process.env.DB_PORT||5432),
  user: process.env.DB_USER || 'admin', password: process.env.DB_PASSWORD || 'password123',
  database: process.env.DB_NAME || 'jobai_db', max: 10
});
const H=36e5, now=()=>new Date().toISOString(), ago=h=>new Date(Date.now()-h*H).toISOString();
const STAGES=['applied','interview','offer','hired'];
const seedJobs=[
 ['TechCorp Thailand Ltd.','Senior UX/UI Designer','กรุงเทพฯ (BTS อโศก / Hybrid)',55000,75000,'3-5 ปี',['Figma','Design System','User Research'],'นำทีมออกแบบผลิตภัณฑ์หลักขององค์กร วาง Design System และทำงานใกล้ชิดกับ Product และ Developer',98,2],
 ['InnoFinTech Co., Ltd.','Product Designer (Mobile)','สีลม, กรุงเทพฯ (Work from Home 100%)',60000,80000,'2-4 ปี',['Mobile App','Wireframing','Fintech'],'ออกแบบประสบการณ์ผู้ใช้แอปการเงินบนมือถือ ตั้งแต่ Wireframe จนถึง Prototype พร้อมทดสอบกับผู้ใช้จริง',91,24],
 ['Global Digital Agency','UI Developer & Designer','พระราม 9, กรุงเทพฯ',45000,55000,'2+ ปี',['HTML/CSS','Figma','Tailwind'],'ออกแบบหน้าเว็บด้วย Figma และลงมือพัฒนาเป็น HTML/CSS ให้ลูกค้าหลายอุตสาหกรรม',82,72],
 ['CloudNine Software','UX Researcher','รัชดา, กรุงเทพฯ (Hybrid)',50000,70000,'2-4 ปี',['User Research','Prototyping','Figma'],'วางแผนและทำ User Research สรุปข้อค้นพบให้ทีมออกแบบและผลิตภัณฑ์นำไปใช้ตัดสินใจ',88,10],
 ['PixelWorks Studio','Frontend Designer','เชียงใหม่ (Remote ได้)',40000,60000,'1-3 ปี',['HTML/CSS','JavaScript','Tailwind'],'สร้างหน้าเว็บที่สวยและใช้งานได้จริงด้วย Tailwind และ JavaScript ร่วมกับทีมออกแบบ',79,48],
 ['HealthPlus Digital','UX/UI Designer (Healthtech)','สาทร, กรุงเทพฯ',52000,68000,'3+ ปี',['UX/UI Design','Design System','Mobile App'],'ออกแบบแอปสุขภาพที่ใช้งานง่ายสำหรับผู้ใช้ทุกช่วงวัย พร้อมดูแล Design System ของแพลตฟอร์ม',86,30]
];
const SKILLS={'UX/UI Design':/\bux\b|\bui\b|ออกแบบ/i,'Figma':/figma/i,'User Research':/research|วิจัย/i,'HTML/CSS':/html|css/i,'Wireframing':/wireframe/i,'Mobile App':/mobile|แอป/i,'Design System':/design system/i,'Tailwind':/tailwind/i,'Fintech':/fintech/i,'Prototyping':/prototype/i,'JavaScript':/javascript|react/i};


function ocrScannedPdf(buffer) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobai-ocr-'));

  try {
    const pdfPath = path.join(tempDir, 'resume.pdf');
    const prefix = path.join(tempDir, 'page');
    fs.writeFileSync(pdfPath, buffer);

    // OCR only the first five pages to keep processing time reasonable.
    execFileSync(
      'pdftoppm',
      ['-f', '1', '-l', '5', '-r', '180', '-png', pdfPath, prefix],
      { timeout: 60000, stdio: 'pipe' }
    );

    const images = fs.readdirSync(tempDir)
      .filter(name => /^page-\d+\.png$/i.test(name))
      .sort((a, b) => {
        const pageA = Number(a.match(/\d+/)[0]);
        const pageB = Number(b.match(/\d+/)[0]);
        return pageA - pageB;
      });

    const pages = [];
    for (const image of images) {
      const pageText = execFileSync(
        'tesseract',
        [path.join(tempDir, image), 'stdout', '-l', 'tha+eng', '--psm', '3'],
        {
          timeout: 60000,
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );
      pages.push(pageText);
    }

    return pages.join('\n').trim();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function initDb(){
 await pool.query(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,username TEXT UNIQUE NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'job_seeker',name TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT now());
 CREATE TABLE IF NOT EXISTS resumes(id SERIAL PRIMARY KEY,user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,filename TEXT,analyzed_at TIMESTAMPTZ,score INT,skills JSONB DEFAULT '[]',years TEXT,recs JSONB DEFAULT '[]',file_data BYTEA,mime_type TEXT);
 ALTER TABLE resumes ADD COLUMN IF NOT EXISTS file_data BYTEA; ALTER TABLE resumes ADD COLUMN IF NOT EXISTS mime_type TEXT;
 CREATE TABLE IF NOT EXISTS jobs(id SERIAL PRIMARY KEY,employer_id INT REFERENCES users(id) ON DELETE CASCADE,company TEXT NOT NULL,title TEXT NOT NULL,location TEXT,salary_min INT,salary_max INT,exp TEXT,tags JSONB DEFAULT '[]',description TEXT,base INT DEFAULT 70,posted_at TIMESTAMPTZ DEFAULT now(),active BOOLEAN DEFAULT TRUE);
 CREATE TABLE IF NOT EXISTS applications(id SERIAL PRIMARY KEY,job_id INT REFERENCES jobs(id) ON DELETE CASCADE,user_id INT REFERENCES users(id) ON DELETE CASCADE,status TEXT DEFAULT 'applied',applied_at TIMESTAMPTZ DEFAULT now(),interview_at TIMESTAMPTZ,name TEXT,email TEXT,portfolio TEXT,cover_letter TEXT,resume_name TEXT,match INT,UNIQUE(job_id,user_id));
 CREATE TABLE IF NOT EXISTS reviews(id SERIAL PRIMARY KEY,user_id INT REFERENCES users(id) ON DELETE CASCADE,company TEXT,position TEXT,rating INT,comment TEXT,type TEXT,created_at TIMESTAMPTZ DEFAULT now());
 CREATE TABLE IF NOT EXISTS notifications(id SERIAL PRIMARY KEY,user_id INT REFERENCES users(id) ON DELETE CASCADE,text TEXT,read BOOLEAN DEFAULT FALSE,created_at TIMESTAMPTZ DEFAULT now());`);
 const {rows}=await pool.query('SELECT COUNT(*)::int n FROM users');
 if(!rows[0].n){
  const pw=await bcrypt.hash('demo1234',10);
  const s=await pool.query(`INSERT INTO users(username,email,password_hash,role,name) VALUES($1,$2,$3,'job_seeker',$4) RETURNING id`,['somchai','somchai@email.com',pw,'สมชาย ใจดี']);
  const e=await pool.query(`INSERT INTO users(username,email,password_hash,role,name) VALUES($1,$2,$3,'employer',$4) RETURNING id`,['suda','suda@jobai.com',pw,'สุดา HR']);
  const eid=e.rows[0].id, uid=s.rows[0].id;
  await pool.query(`INSERT INTO resumes(user_id,filename,analyzed_at,score,skills,years,recs) VALUES($1,$2,now(),85,$3,$4,$5)`,[uid,'Somchai_Resume_2026.pdf',JSON.stringify(['UX/UI Design','Figma','User Research','HTML/CSS']),'3 ปี 6 เดือน',JSON.stringify([{type:'warn',title:'เพิ่มเชิงปริมาณผลงาน (Quantifiable Metrics)',text:'เพิ่มตัวเลขวัดผลของผลงาน เช่น % การเติบโตหรือจำนวนผู้ใช้งาน'},{type:'info',title:'ปรับคำโปรไฟล์ให้ผ่าน ATS',text:'ใช้ Action Verbs และคีย์เวิร์ดที่ตรงกับประกาศงาน'}])]);
  for(const j of seedJobs) await pool.query(`INSERT INTO jobs(employer_id,company,title,location,salary_min,salary_max,exp,tags,description,base,posted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[eid,j[0],j[1],j[2],j[3],j[4],j[5],JSON.stringify(j[6]),j[7],j[8],new Date(Date.now()-j[9]*H)]);
  const jobs=await pool.query('SELECT id,title,company,base FROM jobs ORDER BY id');
  await pool.query(`INSERT INTO applications(job_id,user_id,status,applied_at,name,email,cover_letter,resume_name,match) VALUES($1,$2,'applied',now(),$3,$4,$5,$6,$7),($8,$2,'interview',now()-interval '5 days',$3,$4,$5,$6,$7)`,[jobs.rows[2].id,uid,'สมชาย ใจดี','somchai@email.com','ขอสมัครงานและยินดีพูดคุยรายละเอียด','Somchai_Resume_2026.pdf',82,jobs.rows[0].id]);
  await pool.query(`INSERT INTO notifications(user_id,text) VALUES($1,$2),($1,$3)`,[uid,'TechCorp Thailand นัดสัมภาษณ์ตำแหน่ง Senior UX/UI Designer แล้ว','HR ของ Global Digital Agency เปิดดูเรซูเม่ของคุณแล้ว']);
 }
}
function auth(req,res,next){const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):null; if(!token)return res.status(401).json({message:'กรุณาเข้าสู่ระบบ'}); try{req.user=jwt.verify(token,JWT_SECRET);next()}catch{return res.status(401).json({message:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'})}}
function role(r){return (req,res,next)=>req.user.role===r?next():res.status(403).json({message:'ไม่มีสิทธิ์ใช้งานส่วนนี้'})}
function tokenFor(u){return jwt.sign({id:u.id,username:u.username,role:u.role,name:u.name},JWT_SECRET,{expiresIn:'7d'})}

app.post('/register',async(req,res)=>{try{const {username,email,password,name}=req.body;if(!username||!email||!password)return res.status(400).json({message:'กรุณากรอกข้อมูลให้ครบ'});const hash=await bcrypt.hash(password,10);const r=await pool.query(`INSERT INTO users(username,email,password_hash,role,name) VALUES($1,$2,$3,'job_seeker',$4) RETURNING id,username,email,role,name`,[username,email,hash,name||username]);res.status(201).json({message:'สมัครสมาชิกสำเร็จ',token:tokenFor(r.rows[0]),user:r.rows[0]})}catch(e){res.status(409).json({message:e.code==='23505'?'Username หรือ Email ถูกใช้งานแล้ว':'สมัครสมาชิกไม่สำเร็จ'})}});
app.post('/login',async(req,res)=>{const r=await pool.query('SELECT * FROM users WHERE username=$1',[req.body.username]);if(!r.rows[0]||!(await bcrypt.compare(req.body.password||'',r.rows[0].password_hash)))return res.status(401).json({message:'Username หรือ Password ไม่ถูกต้อง'});const u=r.rows[0];res.json({message:'เข้าสู่ระบบสำเร็จ',token:tokenFor(u),user:{id:u.id,username:u.username,email:u.email,role:u.role,name:u.name}})});
app.post('/logout',(req,res)=>res.json({message:'ออกจากระบบสำเร็จ'}));
app.post('/change-password',auth,async(req,res)=>{const {currentPassword,newPassword}=req.body||{};if(!currentPassword||!newPassword||newPassword.length<8)return res.status(400).json({message:'กรอกรหัสผ่านเดิมและรหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร'});const q=await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.user.id]);if(!q.rowCount||!(await bcrypt.compare(currentPassword,q.rows[0].password_hash)))return res.status(400).json({message:'รหัสผ่านเดิมไม่ถูกต้อง'});const hash=await bcrypt.hash(newPassword,10);await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,req.user.id]);res.json({message:'เปลี่ยนรหัสผ่านสำเร็จ'});});
app.get('/me',auth,async(req,res)=>{const r=await pool.query('SELECT id,username,email,role,name FROM users WHERE id=$1',[req.user.id]);res.json(r.rows[0])});
app.get('/check-username/:name',async(req,res)=>{const r=await pool.query('SELECT 1 FROM users WHERE username=$1',[req.params.name]);res.json({available:!r.rowCount,message:r.rowCount?'Username นี้ถูกใช้งานแล้ว':'Username นี้สามารถใช้งานได้'})});
app.get('/users',auth,role('employer'),async(req,res)=>{const r=await pool.query('SELECT id,username,email,role,name FROM users ORDER BY id');res.json({page:1,limit:r.rowCount,total:r.rowCount,data:r.rows})});

app.get('/api/resume',auth,async(req,res)=>{const r=await pool.query('SELECT filename,analyzed_at "analyzedAt",score,skills,years,recs FROM resumes WHERE user_id=$1',[req.user.id]);res.json(r.rows[0]||{filename:'',score:0,skills:[],years:'ไม่ระบุ',recs:[]})});
app.get('/api/jobs',auth,async(req,res)=>{const r=await pool.query(`SELECT j.*,COALESCE((SELECT COUNT(*) FROM applications a WHERE a.job_id=j.id AND a.user_id=$1),0)>0 AS applied FROM jobs j WHERE j.active=true ORDER BY j.posted_at DESC`,[req.user.id]);res.json(r.rows.map(x=>({...x,id:x.id,company:x.company,title:x.title,location:x.location,salaryMin:x.salary_min,salaryMax:x.salary_max,exp:x.exp,tags:x.tags||[],desc:x.description,description:x.description,postedAt:x.posted_at,match:x.base,applied:x.applied})))});
app.post('/api/applications',auth,async(req,res)=>{const {jobId,name,email,portfolio,coverLetter,resumeName}=req.body;const j=await pool.query('SELECT * FROM jobs WHERE id=$1 AND active=true',[jobId]);if(!j.rowCount)return res.status(404).json({message:'ไม่พบตำแหน่งงานนี้'});try{const r=await pool.query(`INSERT INTO applications(job_id,user_id,name,email,portfolio,cover_letter,resume_name,match) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[jobId,req.user.id,name,email,portfolio,coverLetter,resumeName,j.rows[0].base]);await pool.query(`INSERT INTO notifications(user_id,text) VALUES($1,$2)`,[req.user.id,`ส่งใบสมัครตำแหน่ง ${j.rows[0].title} ไปยัง ${j.rows[0].company} เรียบร้อยแล้ว`]);res.status(201).json({...r.rows[0],jobId:r.rows[0].job_id,title:j.rows[0].title,company:j.rows[0].company,status:r.rows[0].status,appliedAt:r.rows[0].applied_at})}catch(e){res.status(409).json({message:'คุณสมัครตำแหน่งนี้ไปแล้ว'})}});
function mapApp(a){return {...a,id:a.id,jobId:a.job_id,title:a.title,company:a.company,status:a.status,appliedAt:a.applied_at,interviewAt:a.interview_at,name:a.name,email:a.email,portfolio:a.portfolio,coverLetter:a.cover_letter,resumeName:a.resume_name,match:a.match}}
app.get('/api/applications',auth,async(req,res)=>{const r=await pool.query(`SELECT a.*,j.title,j.company FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=$1 ORDER BY a.applied_at DESC`,[req.user.id]);res.json(r.rows.map(mapApp))});
app.patch('/api/applications/:id/advance',auth,async(req,res)=>{const r=await pool.query(`SELECT a.*,j.title,j.company FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=$1 AND a.user_id=$2`,[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({message:'ไม่พบใบสมัครนี้'});const a=r.rows[0],i=STAGES.indexOf(a.status);if(i<0||i===STAGES.length-1)return res.status(400).json({message:'ใบสมัครนี้อยู่ในขั้นตอนสุดท้ายแล้ว'});const status=STAGES[i+1], interview=status==='interview'?new Date(Date.now()+5*24*H):null;const u=await pool.query('UPDATE applications SET status=$1,interview_at=$2 WHERE id=$3 RETURNING *',[status,interview,req.params.id]);await pool.query('INSERT INTO notifications(user_id,text) VALUES($1,$2)',[req.user.id,`สถานะใบสมัคร ${a.title} เปลี่ยนเป็น ${status}`]);res.json(mapApp({...u.rows[0],title:a.title,company:a.company}))});
app.delete('/api/applications/:id',auth,async(req,res)=>{const r=await pool.query('DELETE FROM applications WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({message:'ไม่พบใบสมัครนี้'});res.json({message:'ถอนใบสมัครเรียบร้อย'})});
app.get('/api/reviews',auth,async(req,res)=>{const r=await pool.query('SELECT * FROM reviews ORDER BY created_at DESC');res.json(r.rows)});
app.post('/api/reviews',auth,async(req,res)=>{const {company,position,type,rating,comment}=req.body;const r=await pool.query(`INSERT INTO reviews(user_id,company,position,type,rating,comment) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[req.user.id,company,position,type,rating,comment]);res.status(201).json(r.rows[0])});
app.get('/api/notifications',auth,async(req,res)=>{const r=await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]);res.json(r.rows)});
app.post('/api/notifications/read',auth,async(req,res)=>{await pool.query('UPDATE notifications SET read=true WHERE user_id=$1',[req.user.id]);res.json({message:'อ่านแล้ว'})});

// Employer
app.get('/api/employer/jobs',auth,role('employer'),async(req,res)=>{const r=await pool.query(`SELECT j.*,COUNT(a.id)::int applications FROM jobs j LEFT JOIN applications a ON a.job_id=j.id WHERE j.employer_id=$1 GROUP BY j.id ORDER BY j.posted_at DESC`,[req.user.id]);res.json(r.rows)});
app.post('/api/employer/jobs',auth,role('employer'),async(req,res)=>{const {title,company,location,salaryMin,salaryMax,exp,tags,description}=req.body;if(!title||!company)return res.status(400).json({message:'กรุณากรอกตำแหน่งและบริษัท'});const r=await pool.query(`INSERT INTO jobs(employer_id,company,title,location,salary_min,salary_max,exp,tags,description,base) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,75) RETURNING *`,[req.user.id,company,title,location,+salaryMin||0,+salaryMax||0,exp,JSON.stringify(tags||[]),description||'']);res.status(201).json(r.rows[0])});
app.patch('/api/employer/jobs/:id/close',auth,role('employer'),async(req,res)=>{const r=await pool.query('UPDATE jobs SET active=false WHERE id=$1 AND employer_id=$2 RETURNING *',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({message:'ไม่พบงาน'});res.json(r.rows[0])});
app.get('/api/employer/applications',auth,role('employer'),async(req,res)=>{const r=await pool.query(`SELECT a.*,j.title,j.company,u.username,u.name AS candidate_name FROM applications a JOIN jobs j ON j.id=a.job_id JOIN users u ON u.id=a.user_id WHERE j.employer_id=$1 ORDER BY a.applied_at DESC`,[req.user.id]);res.json(r.rows.map(a=>({...mapApp(a),username:a.username,candidateName:a.candidate_name}))) });
app.get('/api/employer/applications/:id/resume',auth,role('employer'),async(req,res)=>{const q=await pool.query(`SELECT r.filename,r.file_data,r.mime_type FROM applications a JOIN jobs j ON j.id=a.job_id JOIN resumes r ON r.user_id=a.user_id WHERE a.id=$1 AND j.employer_id=$2`,[req.params.id,req.user.id]);if(!q.rowCount||!q.rows[0].file_data)return res.status(404).json({message:'ไม่มีไฟล์ Resume ที่บันทึกไว้ กรุณาให้ผู้สมัครอัปโหลด Resume ใหม่'});const f=q.rows[0];res.setHeader('Content-Type',f.mime_type||'application/octet-stream');res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(f.filename||'resume')}`);res.send(f.file_data);});
app.patch('/api/employer/applications/:id/status',auth,role('employer'),async(req,res)=>{const r=await pool.query(`UPDATE applications a SET status=$1 FROM jobs j WHERE a.job_id=j.id AND a.id=$2 AND j.employer_id=$3 RETURNING a.*`,[req.body.status,req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({message:'ไม่พบใบสมัคร'});res.json(r.rows[0])});

// Resume analysis: text/rules fallback; AI can be layered later without affecting auth/db.
app.post(
  '/api/resume/analyze',
  express.raw({ type: '*/*', limit: '10mb' }),
  auth,
  async (req, res) => {
    const filename = decodeURIComponent(req.query.filename || 'resume.txt');
    let text = '';

    try {
      if (/\.pdf$/i.test(filename)) {
        const pdfParse = require('pdf-parse/lib/pdf-parse.js');
        text = (await pdfParse(req.body)).text || '';

        // If the PDF contains no selectable text, try OCR.
        if (text.trim().length < 20) {
          text = ocrScannedPdf(req.body);
        }
      } else if (/\.docx$/i.test(filename)) {
        text = (await require('mammoth').extractRawText({
          buffer: req.body
        })).value;
      } else {
        text = req.body.toString('utf8');
      }
    } catch (e) {
      console.error('Resume extraction error:', e.message);
      return res.status(422).json({
        message: 'อ่านข้อความจากไฟล์ไม่ได้ กรุณาตรวจสอบไฟล์ PDF/DOCX หรือทดลองไฟล์อื่น'
      });
    }

    if (text.trim().length < 20) {
      return res.status(422).json({
        message: 'ไม่พบข้อความที่อ่านได้ในเรซูเม่ กรุณาตรวจสอบไฟล์หรือใช้ PDF ที่ชัดเจนขึ้น'
      });
    }

    const skills = Object.keys(SKILLS).filter(k => SKILLS[k].test(text));
    const score = Math.min(
      100,
      55 + skills.length * 7 + (text.match(/\d+%/g) || []).length * 4
    );
    const result = {
      filename,
      analyzedAt: now(),
      score,
      skills,
      years: 'ไม่ระบุ',
      recs: [{
        type: 'info',
        title: 'เพิ่มตัวเลขวัดผล',
        text: 'เพิ่มผลลัพธ์เชิงตัวเลขของผลงานเพื่อให้ Resume ชัดเจนขึ้น'
      }]
    };

    await pool.query(
      `INSERT INTO resumes
        (user_id,filename,analyzed_at,score,skills,years,recs,file_data,mime_type)
       VALUES($1,$2,now(),$3,$4,$5,$6,$7,$8)
       ON CONFLICT(user_id) DO UPDATE SET
         filename=EXCLUDED.filename,
         analyzed_at=now(),
         score=EXCLUDED.score,
         skills=EXCLUDED.skills,
         years=EXCLUDED.years,
         recs=EXCLUDED.recs,
         file_data=EXCLUDED.file_data,
         mime_type=EXCLUDED.mime_type`,
      [
        req.user.id,
        filename,
        score,
        JSON.stringify(skills),
        result.years,
        JSON.stringify(result.recs),
        req.body,
        /\.pdf$/i.test(filename)
          ? 'application/pdf'
          : /\.docx$/i.test(filename)
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'text/plain'
      ]
    );

    res.json(result);
  }
);

// Serve static assets
app.use(express.static(__dirname));

async function start(){for(let i=0;i<20;i++){try{await pool.query('SELECT 1');await initDb();app.listen(PORT,()=>console.log(`JobAI Hub running on http://localhost:${PORT}`));return}catch(e){console.log(`Waiting for PostgreSQL... ${i+1}/20`);await new Promise(r=>setTimeout(r,1500))}}process.exit(1)}
start();
