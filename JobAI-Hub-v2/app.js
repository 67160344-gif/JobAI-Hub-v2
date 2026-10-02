/* JobAI Hub - Frontend logic (เชื่อมต่อ REST API ที่ server.js) */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = { timeZone: 'Asia/Bangkok' };
const fd = d => new Date(d).toLocaleDateString('th-TH-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric', ...D });
const fdt = d => new Date(d).toLocaleString('th-TH-u-ca-gregory', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...D });
const ago = d => { const h = (Date.now() - new Date(d)) / 36e5; return h < 1 ? 'เมื่อสักครู่' : h < 24 ? `${Math.floor(h)} ชั่วโมงที่แล้ว` : `${Math.floor(h / 24)} วันที่แล้ว`; };
const baht = n => '฿' + Number(n).toLocaleString('en-US');
const api = async (u, m = 'GET', b) => {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('jobai_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(u, { method: m, headers, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || 'เกิดข้อผิดพลาด');
  return d;
};

const S = { user: null, resume: null, jobs: [], apps: [], reviews: [], notifs: [], tab: 'resume', job: null, form: null, q: 0, ans: [], cur: null, draft: '', rate: 0 };
const QS = [
  'ช่วยแนะนำตัวและเล่าประสบการณ์ที่ผ่านมาของคุณในสายงาน UX/UI โดยสรุป',
  'ช่วยเล่าถึงโปรเจกต์ที่ยากที่สุดที่คุณเคยเจอเกี่ยวกับการออกแบบ UX/UI และคุณมีวิธีแก้ปัญหาข้อขัดแย้งกับ Developer อย่างไร?',
  'คุณมีขั้นตอนการทำ User Research อย่างไร และนำผลที่ได้ไปปรับปรุงดีไซน์อย่างไร?',
  'เล่าถึงครั้งที่ผู้มีส่วนได้ส่วนเสียไม่เห็นด้วยกับดีไซน์ของคุณ คุณรับมือกับสถานการณ์นั้นอย่างไร?',
  'ทำไมคุณถึงสนใจตำแหน่งนี้ และคุณวางเป้าหมายในอาชีพของคุณไว้อย่างไรในอีก 3 ปีข้างหน้า?'
];

/* ---------- UI helpers ---------- */
function toast(m, t = 'ok') {
  const e = document.createElement('div');
  e.className = `px-4 py-3 rounded-xl text-xs font-medium shadow-lg text-white ${t === 'err' ? 'bg-red-600' : 'bg-slate-900'}`;
  e.innerHTML = `<i class="fa-solid ${t === 'err' ? 'fa-circle-exclamation' : 'fa-circle-check'} mr-2"></i>${esc(m)}`;
  $('#toast-root').appendChild(e); setTimeout(() => e.remove(), 4000);
}
const modal = h => $('#modal-root').innerHTML = `<div class="fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-4" onclick="if(event.target===this)closeModal()"><div class="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-xl">${h}</div></div>`;
const closeModal = () => $('#modal-root').innerHTML = '';
const applied = id => S.apps.some(a => a.jobId === id);
const inp = 'w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

function switchTab(t) {
  if (!S.user) return loginModal();
  if (S.user.role === 'employer') t = 'employer';
  else if (t === 'employer') t = 'resume';
  S.tab = t;
  document.querySelectorAll('.tab-content').forEach(e => e.classList.add('hidden'));
  const target = $('#tab-' + t);
  if (target) target.classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active-tab', b.id === 'nav-' + t));
  document.querySelectorAll('[data-mtab]').forEach(b => {
    const on = b.dataset.mtab === t;
    ['bg-blue-50', 'text-blue-600', 'font-semibold'].forEach(c => b.classList.toggle(c, on));
    ['bg-slate-100', 'text-slate-600'].forEach(c => b.classList.toggle(c, !on));
  });
  if (t === 'match') renderJobs();
  if (t === 'apply') renderApply();
  if (t === 'coach') renderCoach();
  if (t === 'tracking') loadTracking();
  if (t === 'employer') renderEmployer();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- 1. Resume ---------- */
const REC = {
  warn: ['bg-amber-50 border-amber-500', 'fa-triangle-exclamation text-amber-600', 'text-amber-900', 'text-amber-700'],
  info: ['bg-blue-50 border-blue-500', 'fa-wand-magic-sparkles text-blue-600', 'text-blue-900', 'text-blue-700'],
  ok: ['bg-emerald-50 border-emerald-500', 'fa-circle-check text-emerald-600', 'text-emerald-900', 'text-emerald-700']
};
function renderResume() {
  const r = S.resume;
  const L = r.score >= 80 ? ['ดีมาก (Competitive)', 'text-green-400', 'bg-green-500/20 text-green-300'] : r.score >= 60 ? ['ดี (Good)', 'text-amber-400', 'bg-amber-500/20 text-amber-300'] : ['ควรปรับปรุง', 'text-red-400', 'bg-red-500/20 text-red-300'];
  $('#resume-result').innerHTML = `
    <div class="flex justify-between items-center mb-2"><h2 class="text-lg font-semibold text-slate-800 flex items-center"><i class="fa-solid fa-chart-pie text-blue-600 mr-2"></i> ผลการวิเคราะห์จาก AI</h2>
      <span class="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">วิเคราะห์เรียบร้อย</span></div>
    <p class="text-xs text-slate-400 mb-5"><i class="fa-solid fa-file mr-1"></i>${esc(r.filename)} • ${fdt(r.analyzedAt)}</p>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <div class="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 rounded-xl text-center"><span class="text-xs text-slate-300 block">คะแนน Resume ความสมบูรณ์</span>
        <span class="text-4xl font-extrabold ${L[1]} my-1 block">${r.score}<span class="text-lg text-slate-400">/100</span></span><span class="text-[11px] ${L[2]} px-2 py-0.5 rounded">ระดับ: ${L[0]}</span></div>
      <div class="bg-slate-50 p-4 rounded-xl border border-slate-100"><p class="text-xs text-slate-500 font-medium">ทักษะหลักที่พบ (Detected Skills)</p>
        <div class="flex flex-wrap gap-1.5 mt-2">${r.skills.length ? r.skills.map(s => `<span class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">${esc(s)}</span>`).join('') : '<span class="text-xs text-slate-400">ไม่พบทักษะที่ระบบรู้จัก</span>'}</div></div>
      <div class="bg-slate-50 p-4 rounded-xl border border-slate-100"><p class="text-xs text-slate-500 font-medium">ประสบการณ์การทำงาน</p>
        <p class="text-lg font-bold text-slate-800 mt-1">${esc(r.years)}</p><p class="text-xs text-slate-400 mt-1">ตรงกับสายงาน UX/UI Specialist</p></div></div>
    <div class="space-y-4"><h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wider">ข้อเสนอแนะในการปรับปรุง (AI Recommendations)</h3>
      ${r.recs.map(x => { const c = REC[x.type] || REC.info; return `<div class="p-4 ${c[0]} border-l-4 rounded-r-xl"><div class="flex items-start"><i class="fa-solid ${c[1]} mt-1 mr-3"></i><div><h4 class="text-sm font-semibold ${c[2]}">${esc(x.title)}</h4><p class="text-xs ${c[3]} mt-0.5">${esc(x.text)}</p></div></div></div>`; }).join('')}</div>
    <div class="mt-6 flex justify-end space-x-3">
      <button onclick="downloadReport()" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50"><i class="fa-solid fa-download mr-1"></i>ดาวน์โหลดการวิเคราะห์ PDF</button>
      <button onclick="switchTab('match')" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-md transition">ไปยังขั้นตอนถัดไป: จับคู่งาน AI <i class="fa-solid fa-arrow-right ml-1"></i></button></div>`;
}

function pickFile() {
  const i = document.createElement('input'); i.type = 'file'; i.accept = '.pdf,.docx,.txt,.md';
  i.onchange = () => i.files[0] && handleResume(i.files[0]); i.click();
}
async function handleResume(f) {
  if (!/\.(pdf|docx|txt|md)$/i.test(f.name)) return toast('รองรับเฉพาะไฟล์ PDF, DOCX, TXT', 'err');
  if (f.size > 10 * 1048576) return toast('ไฟล์ใหญ่เกิน 10MB', 'err');
  $('#resume-result').innerHTML = '<div class="py-24 text-center text-slate-500"><i class="fa-solid fa-spinner fa-spin text-3xl text-blue-600 mb-3"></i><p class="text-sm">AI กำลังวิเคราะห์ Resume ของคุณ...</p></div>';
  try {
    const r = await fetch('/api/resume/analyze?filename=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(localStorage.getItem('jobai_token') ? { Authorization: 'Bearer ' + localStorage.getItem('jobai_token') } : {}) }, body: f });
    const d = await r.json(); if (!r.ok) throw new Error(d.message);
    S.resume = d; S.jobs = await api('/api/jobs'); S.form = null; S.notifs = await api('/api/notifications');
    toast('วิเคราะห์ Resume เรียบร้อย'); renderNotifs();
  } catch (e) { toast(e.message, 'err'); }
  renderResume(); if (S.tab === 'apply') renderApply();
}
function downloadReport() {
  const r = S.resume, w = window.open('', '_blank');
  if (!w) return toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต Pop-up', 'err');
  w.document.write(`<html lang="th"><head><meta charset="utf-8"><title>Resume Analysis</title><style>body{font-family:Kanit,sans-serif;padding:32px;max-width:720px;margin:auto}li{margin:10px 0}</style></head><body><h1>ผลการวิเคราะห์ Resume - JobAI Hub</h1><p>ไฟล์: ${esc(r.filename)}<br>คะแนน: <b>${r.score}/100</b><br>ประสบการณ์: ${esc(r.years)}<br>ทักษะ: ${esc(r.skills.join(', '))}</p><h3>ข้อเสนอแนะ</h3><ul>${r.recs.map(x => `<li><b>${esc(x.title)}</b><br>${esc(x.text)}</li>`).join('')}</ul></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
  toast('เลือก "บันทึกเป็น PDF" ในหน้าต่างพิมพ์');
}

/* ---------- 2. Job matching ---------- */
const COLORS = ['bg-blue-600', 'bg-purple-600', 'bg-indigo-600', 'bg-teal-600', 'bg-rose-600', 'bg-orange-600'];
function jobCard(j) {
  const ok = j.match >= 85, done = applied(j.id);
  return `<div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"><div>
    <div class="flex justify-between items-start mb-3"><div class="flex items-center space-x-3">
      <div class="w-12 h-12 rounded-xl ${COLORS[j.id % 6]} text-white font-bold flex items-center justify-center text-xl">${esc(j.company[0])}</div>
      <div><h3 onclick="showJob(${j.id})" class="font-bold text-slate-800 hover:text-blue-600 cursor-pointer">${esc(j.title)}</h3><p class="text-xs text-slate-400">${esc(j.company)}</p></div></div>
      <span class="px-2.5 py-1 ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'} text-xs font-bold rounded-full whitespace-nowrap"><i class="fa-solid fa-bolt mr-1"></i>${j.match}% Match</span></div>
    <div class="space-y-2 text-xs text-slate-600 my-4"><p class="flex items-center"><i class="fa-solid fa-location-dot w-5 text-slate-400"></i> ${esc(j.location)}</p>
      <p class="flex items-center"><i class="fa-solid fa-money-bill-wave w-5 text-slate-400"></i> ${baht(j.salaryMin)} - ${baht(j.salaryMax)} / เดือน</p>
      <p class="flex items-center"><i class="fa-solid fa-briefcase w-5 text-slate-400"></i> ประสบการณ์ ${esc(j.exp)}</p></div>
    <div class="flex flex-wrap gap-1 mb-4">${j.tags.map(t => `<span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[11px]">${esc(t)}</span>`).join('')}</div></div>
    <div class="pt-4 border-t border-slate-100 flex items-center justify-between"><span class="text-[11px] text-slate-400">อัปเดตเมื่อ ${ago(j.postedAt)}</span>
      ${done ? '<span class="px-4 py-1.5 bg-slate-100 text-slate-500 rounded-lg text-xs font-medium"><i class="fa-solid fa-check mr-1"></i>สมัครแล้ว</span>' : `<button onclick="applyTo(${j.id})" class="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition">สมัครทันที</button>`}</div></div>`;
}
function renderJobs() {
  const q = $('#job-search').value.trim().toLowerCase(), s = $('#job-sort').value;
  const a = S.jobs.filter(j => !q || [j.title, j.company, j.location, ...j.tags].join(' ').toLowerCase().includes(q));
  a.sort(s === 'salary' ? (x, y) => y.salaryMax - x.salaryMax : s === 'latest' ? (x, y) => new Date(y.postedAt) - new Date(x.postedAt) : (x, y) => y.match - x.match);
  $('#job-grid').innerHTML = a.length ? a.map(jobCard).join('') : '<p class="col-span-full text-center text-sm text-slate-400 py-16"><i class="fa-solid fa-magnifying-glass text-3xl mb-3 block"></i>ไม่พบงานที่ตรงกับคำค้นหา</p>';
}
function showJob(id) {
  const j = S.jobs.find(x => x.id === id);
  modal(`<div class="flex justify-between items-start mb-3"><div><h2 class="text-lg font-bold text-slate-800">${esc(j.title)}</h2><p class="text-xs text-slate-400">${esc(j.company)}</p></div>
    <button onclick="closeModal()" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark text-lg"></i></button></div>
    <p class="text-xs text-slate-600 leading-relaxed mb-4">${esc(j.desc)}</p>
    <div class="space-y-1.5 text-xs text-slate-600 mb-4"><p><i class="fa-solid fa-location-dot w-5 text-slate-400"></i>${esc(j.location)}</p><p><i class="fa-solid fa-money-bill-wave w-5 text-slate-400"></i>${baht(j.salaryMin)} - ${baht(j.salaryMax)} / เดือน</p><p><i class="fa-solid fa-briefcase w-5 text-slate-400"></i>ประสบการณ์ ${esc(j.exp)}</p><p><i class="fa-solid fa-bolt w-5 text-emerald-500"></i>ความเหมาะสม ${j.match}%</p></div>
    <div class="flex flex-wrap gap-1 mb-5">${j.tags.map(t => `<span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[11px]">${esc(t)}</span>`).join('')}</div>
    <div class="flex justify-end space-x-2"><button onclick="closeModal()" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-600">ปิด</button>
    ${applied(j.id) ? '<span class="px-4 py-2 bg-slate-100 text-slate-500 rounded-xl text-xs">สมัครแล้ว</span>' : `<button onclick="closeModal();applyTo(${j.id})" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold">สมัครทันที</button>`}</div>`);
}
function applyTo(id) { S.job = S.jobs.find(j => j.id === id); switchTab('apply'); }

/* ---------- 3. Apply ---------- */
const cover = j => `เรียน ทีมงาน HR ${j.company}\nผมมีความสนใจในตำแหน่ง ${j.title} เป็นอย่างมาก ด้วยประสบการณ์ ${S.resume.years} ในสายงานออกแบบ และมีทักษะด้าน ${S.resume.skills.slice(0, 3).join(', ') || 'การออกแบบ'} ซึ่งตรงกับความต้องการของตำแหน่งงานนี้\nผมพร้อมร่วมสร้างคุณค่าให้ทีม และยินดีเข้ารับการสัมภาษณ์ในเวลาที่สะดวก\nขอแสดงความนับถือ\n${S.form.name}`;
function renderApply() {
  if (!S.form) S.form = { name: 'นาย สมชาย ใจดี', email: 'somchai.j@email.com', portfolio: 'https://behance.net/somchai-ux', cover: '', coverJob: null };
  if (!S.job || applied(S.job.id)) S.job = S.jobs.find(j => !applied(j.id)) || null;
  const f = S.form, j = S.job;
  if (!j) { $('#apply-root').innerHTML = '<div class="py-12 text-center text-sm text-slate-400"><i class="fa-solid fa-circle-check text-4xl text-emerald-500 mb-3 block"></i>คุณสมัครงานครบทุกตำแหน่งแล้ว ดูสถานะได้ที่แท็บติดตามผล</div>'; return; }
  if (f.coverJob !== j.id) { f.cover = cover(j); f.coverJob = j.id; }
  $('#apply-root').innerHTML = `<form onsubmit="submitApplication(event)" class="space-y-5">
    <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3"><div class="flex-grow"><p class="text-xs text-slate-400 mb-1">ตำแหน่งงานที่กำลังสมัคร</p>
      <select onchange="applyTo(+this.value)" class="w-full bg-transparent font-bold text-slate-800 text-sm focus:outline-none">${S.jobs.filter(x => !applied(x.id)).map(x => `<option value="${x.id}" ${x.id === j.id ? 'selected' : ''}>${esc(x.title)} - ${esc(x.company)}</option>`).join('')}</select></div>
      <span class="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-semibold whitespace-nowrap">${j.match}% Match Score</span></div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label class="block text-xs font-semibold text-slate-700 mb-1">ชื่อ-นามสกุล</label><input required value="${esc(f.name)}" oninput="S.form.name=this.value" class="${inp}"></div>
      <div><label class="block text-xs font-semibold text-slate-700 mb-1">อีเมลติดต่อ</label><input required type="email" value="${esc(f.email)}" oninput="S.form.email=this.value" class="${inp}"></div></div>
    <div><label class="block text-xs font-semibold text-slate-700 mb-1">แนบไฟล์ Resume & Portfolio</label><div class="flex items-center space-x-3 p-3 border border-slate-200 rounded-xl bg-slate-50">
      <i class="fa-solid fa-file-lines text-red-500 text-2xl"></i><div class="flex-grow"><p class="text-xs font-semibold text-slate-700">${esc(S.resume.filename)}</p><p class="text-[11px] text-green-600"><i class="fa-solid fa-circle-check"></i> ตรวจสอบโดย AI Resume Analyzer แล้ว (${S.resume.score}/100)</p></div>
      <button type="button" onclick="pickFile()" class="text-xs text-blue-600 hover:underline">เปลี่ยนไฟล์</button></div></div>
    <div><label class="block text-xs font-semibold text-slate-700 mb-1">ลิงก์ผลงาน (Portfolio / GitHub / Behance)</label><input type="url" value="${esc(f.portfolio)}" oninput="S.form.portfolio=this.value" class="${inp}"></div>
    <div><div class="flex justify-between items-center mb-1"><label class="text-xs font-semibold text-slate-700">ข้อความถึง HR (AI Auto Cover Letter Generated)</label>
      <button type="button" onclick="S.form.coverJob=null;renderApply()" class="text-[11px] text-blue-600 hover:underline"><i class="fa-solid fa-wand-magic-sparkles mr-1"></i>ให้ AI เขียนใหม่</button></div>
      <textarea required rows="6" oninput="S.form.cover=this.value" class="${inp}">${esc(f.cover)}</textarea></div>
    <div class="pt-4 flex items-center justify-between border-t border-slate-100"><span class="text-xs text-slate-500"><i class="fa-solid fa-lock text-slate-400 mr-1"></i> ยืนยันการส่งข้อมูลไปยังระบบบริษัทโดยตรง</span>
      <button type="submit" class="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md transition"><i class="fa-solid fa-paper-plane mr-1.5"></i> ส่งใบสมัครทันที</button></div></form>`;
}
async function submitApplication(e) {
  e.preventDefault(); const f = S.form;
  try {
    await api('/api/applications', 'POST', { jobId: S.job.id, name: f.name, email: f.email, portfolio: f.portfolio, coverLetter: f.cover, resumeName: S.resume.filename });
    toast('สมัครงานสำเร็จ! ส่งใบสมัครไปยัง HR เรียบร้อยแล้ว'); S.job = null; f.coverJob = null;
    S.notifs = await api('/api/notifications'); renderNotifs(); switchTab('tracking');
  } catch (err) { toast(err.message, 'err'); }
}

/* ---------- 4. Interview coach ---------- */
let rec = null;
function renderCoach() {
  const q = S.q, ev = S.ans.filter(Boolean), avg = k => ev.length ? ev.reduce((s, x) => s + x[k], 0) / ev.length : 0;
  const tot = ev.length ? Math.round(avg('total')) : null, last = S.cur || ev[ev.length - 1];
  const left = q >= QS.length ? `<div class="text-center py-16"><i class="fa-solid fa-trophy text-5xl text-amber-400 mb-4"></i><h3 class="text-lg font-bold">ฝึกซ้อมครบทั้ง ${QS.length} ข้อแล้ว!</h3>
      <p class="text-sm text-slate-400 mt-2">ตอบและได้รับการประเมิน ${ev.length} ข้อ คะแนนเฉลี่ย ${tot ?? '-'}/100</p>
      <button onclick="S.q=0;S.ans=[];S.cur=null;S.draft='';renderCoach()" class="mt-6 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-bold">ฝึกซ้อมใหม่อีกครั้ง</button></div>`
    : `<div><div class="flex items-center justify-between pb-4 border-b border-slate-800"><div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-full bg-indigo-500/20 border border-indigo-400 flex items-center justify-center text-indigo-400"><i class="fa-solid fa-robot text-lg"></i></div>
        <div><h3 class="text-sm font-bold text-slate-100">AI Interviewer Coach</h3><span class="text-[11px] text-emerald-400 flex items-center"><span class="w-2 h-2 rounded-full bg-emerald-400 mr-1 animate-pulse"></span> ออนไลน์พร้อมฝึกซ้อม</span></div></div>
        <span class="text-xs bg-slate-800 px-3 py-1 rounded-full text-slate-400">คำถามที่ ${q + 1} จาก ${QS.length}</span></div>
      <div class="mt-6 p-5 bg-slate-800/80 rounded-xl border border-slate-700"><span class="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider block mb-1">คำถามสัมภาษณ์จำลอง:</span><p class="text-sm text-slate-200 font-medium">"${esc(QS[q])}"</p></div>
      <div class="mt-6"><label class="block text-xs font-medium text-slate-400 mb-2">คำตอบของคุณ (พิมพ์ หรือใช้เสียงตอบ):</label>
        <textarea id="interview-answer" rows="5" oninput="S.draft=this.value" placeholder="ตอบตามโครงสร้าง STAR: สถานการณ์ → ภารกิจ → สิ่งที่ลงมือทำ → ผลลัพธ์" class="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-indigo-500">${esc(S.draft)}</textarea></div></div>
      <div class="mt-6 flex flex-wrap gap-2 justify-between items-center pt-4 border-t border-slate-800">
        <button id="mic-btn" onclick="toggleMic()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium"><i class="fa-solid fa-microphone mr-1 text-red-400"></i> พูดบันทึกเสียง</button>
        <div class="flex gap-2"><button onclick="nextQ()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium">${S.cur ? (q === QS.length - 1 ? 'ดูสรุปผล' : 'ข้อถัดไป') : 'ข้ามคำถาม'} <i class="fa-solid fa-forward ml-1"></i></button>
        <button onclick="evaluateAnswer()" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition"><i class="fa-solid fa-wand-magic-sparkles mr-1"></i> ให้ AI ประเมินคำตอบ</button></div></div>`;
  const m = [['ความชัดเจน (Clarity)', 'clarity'], ['การแก้ปัญหา (Problem Solving)', 'problem'], ['การทำงานเป็นทีม (Teamwork)', 'teamwork']];
  $('#coach-root').innerHTML = `<div class="lg:col-span-2 bg-slate-900 text-white p-6 rounded-2xl shadow-md flex flex-col justify-between min-h-[420px]">${left}</div>
    <div class="lg:col-span-1 space-y-4"><div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm"><h3 class="text-sm font-bold text-slate-800 mb-3"><i class="fa-solid fa-award text-amber-500 mr-2"></i>คะแนนการตอบสัมภาษณ์</h3>
      <div class="text-center py-3 bg-amber-50/50 rounded-xl border border-amber-100 mb-4"><span class="text-3xl font-extrabold text-amber-600">${tot ?? '--'}<span class="text-sm text-slate-400">/100</span></span>
        <p class="text-xs text-amber-800 mt-1 font-medium">${last ? esc(last.summary) : 'ตอบคำถามแล้วกด "ให้ AI ประเมินคำตอบ"'}</p></div>
      <div class="space-y-2 text-xs text-slate-600">${m.map(([l, k]) => `<div class="flex justify-between"><span>${l}:</span><span class="font-bold text-slate-800">${ev.length ? avg(k).toFixed(1).replace('.0', '') + '/10' : '-'}</span></div>`).join('')}</div>
      <p class="text-[11px] text-slate-400 mt-3">ประเมินแล้ว ${ev.length}/${QS.length} ข้อ</p></div>
    <div class="bg-blue-50 p-5 rounded-2xl border border-blue-100"><h3 class="text-sm font-bold text-blue-900 mb-2"><i class="fa-solid fa-lightbulb text-blue-600 mr-2"></i>คำแนะนำจาก AI โค้ช</h3>
      <p class="text-xs text-blue-800 leading-relaxed">${last ? esc(last.tip) : 'ตอบตามโครงสร้าง STAR และยกตัวอย่างผลลัพธ์เชิงตัวเลขเพื่อให้คำตอบน่าเชื่อถือ'}</p></div></div>`;
}
async function evaluateAnswer() {
  const a = $('#interview-answer').value.trim();
  if (!a) return toast('กรุณากรอกหรือพิมพ์คำตอบก่อนให้ AI ประเมินครับ', 'err');
  if (rec) rec.stop();
  try { S.cur = S.ans[S.q] = await api('/api/interview/evaluate', 'POST', { question: QS[S.q], answer: a }); renderCoach(); toast(`AI ประเมินแล้ว: ${S.cur.total}/100`); }
  catch (e) { toast(e.message, 'err'); }
}
function nextQ() { if (rec) rec.stop(); S.q++; S.cur = null; S.draft = ''; renderCoach(); }
function setMic(on) { const b = $('#mic-btn'); if (b) b.innerHTML = on ? '<i class="fa-solid fa-stop mr-1 text-red-400 animate-pulse"></i> หยุดบันทึกเสียง' : '<i class="fa-solid fa-microphone mr-1 text-red-400"></i> พูดบันทึกเสียง'; }
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('เบราว์เซอร์นี้ไม่รองรับการพูด ลองใช้ Chrome หรือ Edge', 'err');
  if (rec) return rec.stop();
  rec = new SR(); rec.lang = 'th-TH'; rec.continuous = true;
  rec.onresult = e => { const t = [...e.results].slice(e.resultIndex).map(r => r[0].transcript).join(' '); const a = $('#interview-answer'); if (a) { a.value = (a.value + ' ' + t).trim(); S.draft = a.value; } };
  rec.onend = () => { rec = null; setMic(false); };
  rec.onerror = () => toast('ไม่สามารถใช้ไมโครโฟนได้ กรุณาอนุญาตการเข้าถึงไมโครโฟน', 'err');
  rec.start(); setMic(true);
}

/* ---------- 5. Tracking & reviews ---------- */
const COLS = [
  { k: 'applied', t: 'ยื่นสมัครแล้ว', box: 'bg-slate-100/70 border-slate-200', txt: 'text-slate-600', dot: 'bg-slate-400', badge: 'bg-slate-100 text-slate-600', card: 'border-slate-200', empty: 'border-slate-300' },
  { k: 'interview', t: 'นัดสัมภาษณ์', box: 'bg-blue-50/70 border-blue-100', txt: 'text-blue-700', dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700', card: 'border-blue-200', empty: 'border-blue-200' },
  { k: 'offer', t: 'รอผลยื่นเสนอ (Offer)', box: 'bg-amber-50/70 border-amber-100', txt: 'text-amber-700', dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700', card: 'border-amber-200', empty: 'border-amber-200' },
  { k: 'hired', t: 'ได้งานแล้ว', box: 'bg-emerald-50/70 border-emerald-100', txt: 'text-emerald-700', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', card: 'border-emerald-200', empty: 'border-emerald-200' }
];
function appCard(a, c) {
  const b = a.status === 'interview' ? `สัมภาษณ์ ${fdt(a.interviewAt)}` : a.status === 'applied' ? `ส่งเมื่อ ${fd(a.appliedAt)}` : a.status === 'offer' ? 'ได้รับข้อเสนอแล้ว' : 'ผ่านการคัดเลือก';
  return `<div class="bg-white p-4 rounded-xl border ${c.card} shadow-sm space-y-2 mb-3"><span class="text-[10px] ${c.badge} px-2 py-0.5 rounded font-semibold">${b}</span>
    <h4 class="font-bold text-xs text-slate-800 pt-1">${esc(a.title)}</h4><p class="text-[11px] text-slate-500">${esc(a.company)}</p>
    ${a.status === 'interview' ? `<button onclick="switchTab('coach')" class="w-full py-1 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded text-[11px] font-semibold transition"><i class="fa-solid fa-comments mr-1"></i> เตรียมตัวด้วย AI โค้ช</button>` : ''}
    <div class="flex gap-2 pt-1">${a.status !== 'hired' ? `<button onclick="advance(${a.id})" class="flex-1 py-1 bg-slate-100 hover:bg-slate-200 rounded text-[11px] text-slate-600">จำลอง HR อัปเดตสถานะ <i class="fa-solid fa-arrow-right"></i></button>` : ''}
    <button onclick="withdraw(${a.id})" title="ถอนใบสมัคร" class="px-2 py-1 text-[11px] text-red-500 hover:bg-red-50 rounded"><i class="fa-regular fa-trash-can"></i></button></div></div>`;
}
function renderKanban() {
  $('#kanban').innerHTML = COLS.map(c => { const l = S.apps.filter(a => a.status === c.k); return `<div class="${c.box} p-4 rounded-2xl border"><div class="flex justify-between items-center mb-3"><span class="text-xs font-bold ${c.txt} uppercase">${c.t} (${l.length})</span><span class="w-2 h-2 rounded-full ${c.dot}"></span></div>
    ${l.length ? l.map(a => appCard(a, c)).join('') : `<div class="p-6 text-center border-2 border-dashed ${c.empty} rounded-xl text-slate-400 text-xs">ไม่มีรายการ</div>`}</div>`; }).join('');
}
const stars = r => [1, 2, 3, 4, 5].map(i => `<i class="fa-${i <= r ? 'solid' : 'regular'} fa-star"></i>`).join('');
function renderReviews() {
  $('#reviews-root').innerHTML = `<div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"><div class="flex justify-between items-center mb-6 gap-3"><div><h2 class="text-lg font-bold text-slate-800">รีวิวบริษัทและประสบการณ์สัมภาษณ์จากผู้สมัครจริง</h2><p class="text-xs text-slate-400">แบ่งปันและอ่านประสบการณ์ตรงเพื่อเตรียมความพร้อมอย่างมั่นใจ</p></div>
    <button onclick="reviewForm()" class="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"><i class="fa-solid fa-pen mr-1"></i> เขียนรีวิวประสบการณ์</button></div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${S.reviews.map(r => `<div class="p-4 rounded-xl border border-slate-100 bg-slate-50 space-y-2"><div class="flex justify-between items-start"><div><h4 class="text-xs font-bold text-slate-800">${esc(r.company)}</h4>
      <div class="text-amber-400 text-xs my-0.5">${stars(r.rating)}<span class="text-slate-600 font-semibold ml-1">${r.rating.toFixed(1)}</span></div></div>
      <span class="text-[10px] text-slate-400">รีวิวเมื่อ${new Date(r.createdAt).toLocaleDateString('th-TH-u-ca-gregory', { month: 'long', year: 'numeric', ...D })}</span></div>
      <p class="text-xs text-slate-600 leading-relaxed">"${esc(r.comment)}"</p><div class="flex items-center space-x-2 text-[11px] text-slate-400 pt-1"><span class="bg-white px-2 py-0.5 rounded border border-slate-200">ตำแหน่ง: ${esc(r.position)}</span><span>• ${esc(r.type)}</span></div></div>`).join('')}</div></div>`;
}
function reviewForm() {
  S.rate = 0; const cs = [...new Set([...S.jobs.map(j => j.company), ...S.apps.map(a => a.company)])];
  modal(`<h2 class="text-lg font-bold text-slate-800 mb-4">เขียนรีวิวประสบการณ์</h2><form onsubmit="submitReview(event)" class="space-y-4">
    <div><label class="block text-xs font-semibold text-slate-700 mb-1">ชื่อบริษัท</label><input id="rv-company" list="rv-list" required class="${inp}"><datalist id="rv-list">${cs.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
    <div><label class="block text-xs font-semibold text-slate-700 mb-1">ตำแหน่งที่สมัคร</label><input id="rv-position" required class="${inp}"></div>
    <div><label class="block text-xs font-semibold text-slate-700 mb-1">สถานะของคุณ</label><select id="rv-type" class="${inp}"><option>ผู้รับการสัมภาษณ์</option><option>ผู้สมัครที่ได้รับการว่าจ้างจริง</option><option>ผู้สมัคร</option></select></div>
    <div><label class="block text-xs font-semibold text-slate-700 mb-1">ให้คะแนน</label><div id="rv-stars" class="text-2xl text-amber-400 space-x-1">${[1, 2, 3, 4, 5].map(i => `<button type="button" onclick="setRate(${i})"><i class="fa-regular fa-star"></i></button>`).join('')}</div></div>
    <div><label class="block text-xs font-semibold text-slate-700 mb-1">ประสบการณ์ของคุณ</label><textarea id="rv-comment" rows="4" required minlength="10" placeholder="เล่าขั้นตอนสัมภาษณ์ บรรยากาศ และสิ่งที่ควรเตรียมตัว" class="${inp}"></textarea></div>
    <div class="flex justify-end space-x-2"><button type="button" onclick="closeModal()" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-600">ยกเลิก</button><button class="px-5 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold">โพสต์รีวิว</button></div></form>`);
}
function setRate(n) { S.rate = n; document.querySelectorAll('#rv-stars i').forEach((e, i) => e.className = `fa-${i < n ? 'solid' : 'regular'} fa-star`); }
async function submitReview(e) {
  e.preventDefault();
  try {
    await api('/api/reviews', 'POST', { company: $('#rv-company').value, position: $('#rv-position').value, type: $('#rv-type').value, rating: S.rate, comment: $('#rv-comment').value });
    closeModal(); S.reviews = await api('/api/reviews'); renderReviews(); toast('ขอบคุณสำหรับรีวิวของคุณ!');
  } catch (err) { toast(err.message, 'err'); }
}
async function loadTracking() { try { S.apps = await api('/api/applications'); S.reviews = await api('/api/reviews'); } catch (e) { toast(e.message, 'err'); } renderKanban(); renderReviews(); }
async function advance(id) { try { await api(`/api/applications/${id}/advance`, 'PATCH'); await loadTracking(); S.notifs = await api('/api/notifications'); renderNotifs(); toast('อัปเดตสถานะเรียบร้อย'); } catch (e) { toast(e.message, 'err'); } }
async function withdraw(id) { if (!confirm('ต้องการถอนใบสมัครนี้ใช่หรือไม่?')) return; try { await api(`/api/applications/${id}`, 'DELETE'); await loadTracking(); toast('ถอนใบสมัครเรียบร้อย'); } catch (e) { toast(e.message, 'err'); } }

/* ---------- Notifications ---------- */
function renderNotifs() {
  const u = S.notifs.filter(n => !n.read).length, b = $('#bell-badge'); b.textContent = u; b.classList.toggle('hidden', !u);
  $('#notif-panel').innerHTML = `<div class="flex justify-between items-center px-4 py-3 border-b border-slate-100"><span class="text-sm font-semibold text-slate-800">การแจ้งเตือน</span>${u ? '<button onclick="readAll()" class="text-[11px] text-blue-600 hover:underline">อ่านทั้งหมด</button>' : ''}</div>
    <div class="max-h-80 overflow-y-auto">${S.notifs.length ? S.notifs.map(n => `<div class="px-4 py-3 text-xs border-b border-slate-50 ${n.read ? 'text-slate-500' : 'bg-blue-50/60 text-slate-700'}">${esc(n.text)}<span class="block text-[10px] text-slate-400 mt-0.5">${ago(n.createdAt)}</span></div>`).join('') : '<p class="p-6 text-center text-xs text-slate-400">ไม่มีการแจ้งเตือน</p>'}</div>`;
}
async function readAll() { await api('/api/notifications/read', 'POST'); S.notifs.forEach(n => n.read = true); renderNotifs(); }

/* ---------- Authentication ---------- */
function updateAuthUI(){
  const a=$('#auth-actions'), n=$('#current-user-name'), r=$('#current-user-role');
  const isEmployer = S.user?.role === 'employer';
  document.querySelectorAll('[data-role-nav="jobseeker"]').forEach(el => el.classList.toggle('hidden', isEmployer));
  document.querySelectorAll('[data-role-nav="employer"]').forEach(el => el.classList.toggle('hidden', !isEmployer));
  document.querySelectorAll('[data-role-section="jobseeker"]').forEach(el => el.classList.toggle('hidden', isEmployer));
  document.querySelectorAll('[data-role-section="employer"]').forEach(el => el.classList.toggle('hidden', !isEmployer));
  if(!S.user){
    if(n)n.textContent='ผู้เยี่ยมชม'; if(r)r.textContent='ยังไม่ได้เข้าสู่ระบบ';
    if(a)a.innerHTML='<button onclick="loginModal()" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold">เข้าสู่ระบบ</button>';
    return;
  }
  if(n)n.textContent=S.user.name||S.user.username;
  if(r)r.textContent=isEmployer?'Employer':'Job Seeker';
  if(a)a.innerHTML='<button onclick="logout()" class="px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600">ออกจากระบบ</button>';
  S.tab = isEmployer ? 'employer' : (S.tab === 'employer' ? 'resume' : S.tab);
}
function loginModal(){
  modal(`<h2 class="text-xl font-bold text-slate-800 mb-1">เข้าสู่ระบบ JobAI Hub</h2><p class="text-xs text-slate-400 mb-5">บัญชีทดสอบ: somchai / demo1234 หรือ suda / demo1234</p><form onsubmit="doLogin(event)" class="space-y-3"><input id="login-user" required placeholder="Username" class="${inp}"><input id="login-pass" required type="password" placeholder="Password" class="${inp}"><button class="w-full py-2.5 bg-blue-600 text-white rounded-xl text-xs font-semibold">เข้าสู่ระบบ</button></form>`);
}
async function doLogin(e){e.preventDefault();try{const d=await api('/login','POST',{username:$('#login-user').value,password:$('#login-pass').value});localStorage.setItem('jobai_token',d.token);S.user=d.user;closeModal();updateAuthUI();await bootData();switchTab(S.user.role==='employer'?'employer':'resume');toast('เข้าสู่ระบบสำเร็จ');}catch(err){toast(err.message,'err')}}
async function logout(){localStorage.removeItem('jobai_token');S.user=null;S.apps=[];S.jobs=[];S.resume=null;S.notifs=[];updateAuthUI();document.querySelectorAll('.tab-content').forEach(e=>e.classList.add('hidden'));loginModal();}
async function bootData(){
  if(S.user?.role==='employer'){
    S.resume=null; S.jobs=[]; S.apps=[]; S.reviews=[]; S.notifs=[];
    await renderEmployer();
    return;
  }
  [S.resume,S.jobs,S.apps,S.reviews,S.notifs]=await Promise.all(['resume','jobs','applications','reviews','notifications'].map(x=>api('/api/'+x)));
  renderResume();renderJobs();renderNotifs();
}

/* ---------- Employer Portal ---------- */
async function renderEmployer(){
  if(!S.user||S.user.role!=='employer') return;
  const root=$('#employer-root'); if(!root)return;
  root.innerHTML='<div class="p-10 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin text-2xl"></i><p class="text-sm mt-2">กำลังโหลดข้อมูลนายจ้าง...</p></div>';
  try{
    const [jobs,apps]=await Promise.all([api('/api/employer/jobs'),api('/api/employer/applications')]);
    root.innerHTML=`<div class="bg-gradient-to-r from-slate-900 to-blue-900 rounded-2xl p-6 text-white"><span class="text-xs opacity-70">Employer Portal</span><h1 class="text-2xl font-bold mt-1">จัดการตำแหน่งงานและผู้สมัคร</h1><p class="text-xs opacity-80 mt-2">บัญชี: ${esc(S.user.name)}</p></div>
    <div class="grid md:grid-cols-2 gap-6"><div class="bg-white rounded-2xl border border-slate-200 p-5"><div class="flex justify-between items-center mb-4"><h2 class="font-bold">ตำแหน่งงานของฉัน</h2><button onclick="newEmployerJob()" class="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold">+ เพิ่มงาน</button></div><div class="space-y-3">${jobs.map(j=>`<div class="p-3 rounded-xl border border-slate-100"><div class="flex justify-between"><div><b class="text-sm">${esc(j.title)}</b><p class="text-xs text-slate-500">${esc(j.company)} • ผู้สมัคร ${j.applications} คน</p></div>${j.active?`<button onclick="closeEmployerJob(${j.id})" class="text-xs text-red-600">ปิดรับ</button>`:'<span class="text-xs text-slate-400">ปิดแล้ว</span>'}</div></div>`).join('')}</div></div>
    <div class="bg-white rounded-2xl border border-slate-200 p-5"><h2 class="font-bold mb-4">ผู้สมัครล่าสุด (${apps.length})</h2><div class="space-y-3">${apps.length?apps.map(a=>`<div class="p-3 rounded-xl border border-slate-100"><div class="flex justify-between gap-3"><div><b class="text-sm">${esc(a.candidateName||a.name||a.username)}</b><p class="text-xs text-slate-500">${esc(a.title)} • ${esc(a.email||'')}</p></div><select onchange="changeApplicantStatus(${a.id},this.value)" class="text-xs border rounded-lg px-2 py-1"><option value="applied" ${a.status==='applied'?'selected':''}>สมัครแล้ว</option><option value="interview" ${a.status==='interview'?'selected':''}>สัมภาษณ์</option><option value="offer" ${a.status==='offer'?'selected':''}>Offer</option><option value="hired" ${a.status==='hired'?'selected':''}>จ้างแล้ว</option></select></div></div>`).join(''):'<p class="text-xs text-slate-400">ยังไม่มีผู้สมัคร</p>'}</div></div></div>`;
  }catch(e){root.innerHTML=`<div class="p-5 bg-red-50 text-red-700 rounded-xl">${esc(e.message)}</div>`}
}
function newEmployerJob(){modal(`<h2 class="text-lg font-bold mb-4">เพิ่มตำแหน่งงาน</h2><form onsubmit="createEmployerJob(event)" class="space-y-3"><input id="ej-title" required placeholder="ชื่อตำแหน่ง" class="${inp}"><input id="ej-company" required placeholder="ชื่อบริษัท" class="${inp}"><input id="ej-location" placeholder="สถานที่ / Remote" class="${inp}"><div class="grid grid-cols-2 gap-2"><input id="ej-min" type="number" placeholder="เงินเดือนต่ำสุด" class="${inp}"><input id="ej-max" type="number" placeholder="เงินเดือนสูงสุด" class="${inp}"></div><input id="ej-exp" placeholder="ประสบการณ์" class="${inp}"><input id="ej-tags" placeholder="ทักษะ คั่นด้วย ," class="${inp}"><textarea id="ej-desc" placeholder="รายละเอียดงาน" class="${inp}" rows="4"></textarea><button class="w-full py-2.5 bg-blue-600 text-white rounded-xl text-xs font-semibold">สร้างงาน</button></form>`)}
async function createEmployerJob(e){e.preventDefault();try{await api('/api/employer/jobs','POST',{title:$('#ej-title').value,company:$('#ej-company').value,location:$('#ej-location').value,salaryMin:$('#ej-min').value,salaryMax:$('#ej-max').value,exp:$('#ej-exp').value,tags:$('#ej-tags').value.split(',').map(x=>x.trim()).filter(Boolean),description:$('#ej-desc').value});closeModal();renderEmployer();toast('สร้างตำแหน่งงานสำเร็จ')}catch(err){toast(err.message,'err')}}
async function closeEmployerJob(id){try{await api('/api/employer/jobs/'+id+'/close','PATCH');renderEmployer();toast('ปิดรับสมัครแล้ว')}catch(e){toast(e.message,'err')}}
async function changeApplicantStatus(id,status){try{await api('/api/employer/applications/'+id+'/status','PATCH',{status});renderEmployer();toast('อัปเดตสถานะผู้สมัครแล้ว')}catch(e){toast(e.message,'err')}}

/* ---------- Init ---------- */
(async function init() {
  const dz = $('#drop-zone');
  dz.addEventListener('click', pickFile);
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('bg-blue-100'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('bg-blue-100'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('bg-blue-100'); if (e.dataTransfer.files[0]) handleResume(e.dataTransfer.files[0]); });
  $('#job-search').addEventListener('input', renderJobs); $('#job-sort').addEventListener('change', renderJobs);
  $('#bell').addEventListener('click', e => { e.stopPropagation(); $('#notif-panel').classList.toggle('hidden'); });
  document.addEventListener('click', e => { if (!e.target.closest('#notif-panel')) $('#notif-panel').classList.add('hidden'); });
  updateAuthUI();
  if (!localStorage.getItem('jobai_token')) { loginModal(); return; }
  try { S.user = await api('/me'); updateAuthUI(); await bootData(); switchTab(S.user.role==='employer'?'employer':'resume'); }
  catch (e) { localStorage.removeItem('jobai_token'); updateAuthUI(); loginModal(); }
})();
