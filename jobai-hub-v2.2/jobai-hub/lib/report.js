/* สร้างรายงานผลวิเคราะห์ Resume เป็น HTML พร้อมพิมพ์ (บันทึกเป็น PDF ได้จากหน้าต่างพิมพ์ของเบราว์เซอร์) */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPE = { warn: ['ต้องแก้ไข', '#b45309', '#fffbeb'], info: ['ควรปรับปรุง', '#1d4ed8', '#eff6ff'], ok: ['จุดแข็ง', '#047857', '#ecfdf5'] };

function resumeReport({ user, resume, jobs }) {
  const date = new Date(resume.analyzedAt || Date.now()).toLocaleString('th-TH-u-ca-gregory', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
  const level = resume.score >= 80 ? 'ดีมาก' : resume.score >= 60 ? 'ดี' : 'ควรปรับปรุง';
  const recs = (resume.recs || []).map(r => {
    const t = TYPE[r.type] || TYPE.info;
    return `<div class="rec" style="border-color:${t[1]};background:${t[2]}"><span style="color:${t[1]}">${t[0]}</span><b>${esc(r.title)}</b><p>${esc(r.text)}</p></div>`;
  }).join('');
  const top = (jobs || []).slice(0, 5).map(j => `<tr><td>${esc(j.title)}</td><td>${esc(j.company)}</td><td>${j.match ?? '-'}%</td><td>${esc((j.matchedTags || []).join(', ') || '-')}</td></tr>`).join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>Resume Analysis - ${esc(user.name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:16mm}
body{font-family:Sarabun,Tahoma,sans-serif;color:#0f172a;max-width:760px;margin:24px auto;padding:0 16px;font-size:14px;line-height:1.6}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #2563eb;padding-bottom:12px;margin-bottom:20px}
h1{font-size:22px;margin:0}h2{font-size:16px;margin:24px 0 8px;color:#1e3a8a}
.muted{color:#64748b;font-size:12px}
.grid{display:grid;grid-template-columns:1fr 2fr;gap:16px}
.score{background:#0f172a;color:#fff;border-radius:12px;padding:16px;text-align:center}
.score b{font-size:44px;display:block;color:#4ade80}
.box{border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px}
.tag{display:inline-block;background:#dbeafe;color:#1d4ed8;border-radius:6px;padding:2px 8px;margin:2px;font-size:12px}
.rec{border-left:4px solid;border-radius:0 10px 10px 0;padding:10px 14px;margin:8px 0;break-inside:avoid}
.rec span{font-size:11px;font-weight:700;margin-right:8px}.rec p{margin:2px 0 0}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e2e8f0;text-align:left;padding:6px}th{background:#f8fafc}
.print{position:fixed;top:16px;right:16px;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:8px 16px;font-family:inherit;cursor:pointer}
@media print{.print{display:none}body{margin:0}}
</style></head><body>
<button class="print" onclick="window.print()">บันทึกเป็น PDF / พิมพ์</button>
<header><div><h1>รายงานผลวิเคราะห์ Resume</h1><div class="muted">JobAI Hub • สร้างโดยระบบ ${resume.ai ? 'AI' : 'วิเคราะห์อัตโนมัติ (โหมดสำรอง)'}</div></div>
<div class="muted" style="text-align:right">${esc(user.name)}<br>${esc(resume.filename)}<br>${date}</div></header>
<div class="grid"><div class="score">คะแนนความสมบูรณ์<b>${resume.score}</b>/100 • ระดับ${level}</div>
<div class="box"><div><b>ประสบการณ์:</b> ${esc(resume.years || 'ไม่ระบุ')}${resume.field ? ` • <b>สายงาน:</b> ${esc(resume.field)}` : ''}</div>
<div style="margin-top:6px"><b>ทักษะที่พบ:</b><br>${(resume.skills || []).map(s => `<span class="tag">${esc(s)}</span>`).join('') || '<span class="muted">ไม่พบทักษะที่ระบบรู้จัก</span>'}</div></div></div>
<h2>ข้อเสนอแนะ</h2>${recs || '<p class="muted">ไม่มีข้อเสนอแนะ</p>'}
${top ? `<h2>งานที่เหมาะสมที่สุด</h2><table><tr><th>ตำแหน่ง</th><th>บริษัท</th><th>Match</th><th>ทักษะที่ตรง</th></tr>${top}</table>` : ''}
<p class="muted" style="margin-top:32px">รายงานนี้สร้างจากข้อมูลใน Resume ที่อัปโหลดเท่านั้น ใช้เป็นแนวทางในการปรับปรุง ไม่ใช่การประเมินผลการสมัครงาน</p>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),600))</script>
</body></html>`;
}

module.exports = { resumeReport };
