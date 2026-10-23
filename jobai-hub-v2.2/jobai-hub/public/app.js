/* JobAI Hub v2.2 - Frontend logic (เชื่อมต่อ REST API ที่ server.js) */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = { timeZone: 'Asia/Bangkok' };
const valid = d => d && !isNaN(new Date(d));
const fd = d => valid(d) ? new Date(d).toLocaleDateString('th-TH-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric', ...D }) : '-';
const fdt = d => valid(d) ? new Date(d).toLocaleString('th-TH-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', ...D }) + ' น.' : '-';
const ago = d => { if (!valid(d)) return ''; const h = (Date.now() - new Date(d)) / 36e5; return h < 1 ? 'เมื่อสักครู่' : h < 24 ? `${Math.floor(h)} ชั่วโมงที่แล้ว` : `${Math.floor(h / 24)} วันที่แล้ว`; };
const baht = n => '฿' + Number(n || 0).toLocaleString('en-US');
const salary = j => j.salaryMin || j.salaryMax ? `${j.salaryMin ? baht(j.salaryMin) : ''}${j.salaryMin && j.salaryMax ? ' - ' : ''}${j.salaryMax ? baht(j.salaryMax) : ''} / เดือน` : 'ไม่ระบุเงินเดือน';
// เก็บ token แยกต่อแท็บ (sessionStorage) จึงเปิดแท็บผู้หางานกับแท็บ HR พร้อมกันได้โดย token ไม่ทับกัน
const TOKEN_KEY = 'jobai_token';
const token = () => sessionStorage.getItem(TOKEN_KEY);
const setToken = t => { sessionStorage.setItem(TOKEN_KEY, t); localStorage.removeItem(TOKEN_KEY); };
const clearToken = () => { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); };

async function api(u, m = 'GET', b) {
  const headers = {};
  if (b !== undefined) headers['Content-Type'] = 'application/json';
  if (token()) headers.Authorization = `Bearer ${token()}`;
  let r;
  try { r = await fetch(u, { method: m, headers, body: b !== undefined ? JSON.stringify(b) : undefined }); }
  catch { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่า Backend ทำงานอยู่'); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token() && !['/login', '/register'].includes(u)) sessionExpired(d.message);
  if (r.status === 403 && S.user) resyncRole();
  if (!r.ok) throw new Error(d.message || 'เกิดข้อผิดพลาด');
  return d;
}

const S = {
  user: null, status: null, resume: null, jobs: [], apps: [], reviews: [], notifs: [], tab: 'resume', job: null, form: null, rate: 0, poll: null,
  coach: { jobId: null, questions: [], ai: false, loading: false, q: 0, ans: [], cur: null, draft: '', history: [] },
  emp: { jobs: [], apps: [], filter: '' }
};

/* ---------- UI helpers ---------- */
function toast(m, t = 'ok') {
  const e = document.createElement('div');
  const cls = { err: 'bg-red-600', warn: 'bg-amber-600', ok: 'bg-slate-900' }[t] || 'bg-slate-900';
  const icon = { err: 'fa-circle-exclamation', warn: 'fa-triangle-exclamation', ok: 'fa-circle-check' }[t] || 'fa-circle-check';
  e.className = `px-4 py-3 rounded-xl text-xs font-medium shadow-lg text-white max-w-xs ${cls}`;
  e.innerHTML = `<i class="fa-solid ${icon} mr-2"></i>${esc(m)}`;
  $('#toast-root').appendChild(e); setTimeout(() => e.remove(), 4500);
}
const modal = h => { $('#modal-root').innerHTML = `<div class="fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-4" onclick="if(event.target===this)closeModal()"><div role="dialog" aria-modal="true" class="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-xl">${h}</div></div>`; const f = $('#modal-root input, #modal-root textarea'); if (f) f.focus(); };
const closeModal = () => { $('#modal-root').innerHTML = ''; };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal-root').innerHTML) closeModal(); });
const applied = id => S.apps.some(a => a.jobId === id);
const inp = 'w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const aiTag = ai => ai ? '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-semibold"><i class="fa-solid fa-microchip mr-1"></i>AI จริง</span>'
  : '<span class="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-semibold" title="ไม่ได้ตั้งค่า OPENAI_API_KEY หรือเรียก AI ไม่สำเร็จ"><i class="fa-solid fa-gears mr-1"></i>โหมดสำรอง</span>';
function busy(btn, on, label) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.html = btn.innerHTML; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>${label || 'กำลังทำงาน...'}`; } else if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }

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
  if (t === 'resume') renderResume();
  if (t === 'match') renderJobs();
  if (t === 'apply') renderApply();
  if (t === 'coach') openCoach();
  if (t === 'tracking') loadTracking();
  if (t === 'employer') renderEmployer();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadStatus() {
  try { S.status = await api('/api/status'); } catch { S.status = { ai: false }; }
  const b = $('#ai-badge'); if (!b) return;
  b.classList.remove('hidden');
  b.className = `ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${S.status.ai ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`;
  b.textContent = S.status.ai ? `AI: ${S.status.model}` : 'AI: โหมดสำรอง';
  b.title = S.status.ai ? 'เชื่อมต่อ OpenAI Responses API แล้ว' : 'ยังไม่ได้ตั้งค่า OPENAI_API_KEY ระบบใช้การวิเคราะห์แบบกฎ (rule-based)';
}

/* ---------- 1. Resume ---------- */
const REC = {
  warn: ['bg-amber-50 border-amber-500', 'fa-triangle-exclamation text-amber-600', 'text-amber-900', 'text-amber-700'],
  info: ['bg-blue-50 border-blue-500', 'fa-wand-magic-sparkles text-blue-600', 'text-blue-900', 'text-blue-700'],
  ok: ['bg-emerald-50 border-emerald-500', 'fa-circle-check text-emerald-600', 'text-emerald-900', 'text-emerald-700']
};
function renderResume() {
  const r = S.resume;
  if (!r || r.empty || !r.filename) {
    $('#resume-result').innerHTML = `<div class="h-full flex flex-col items-center justify-center text-center py-16">
      <div class="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-3xl mb-4"><i class="fa-solid fa-file-circle-plus"></i></div>
      <h2 class="text-lg font-semibold text-slate-800">ยังไม่มี Resume ในระบบ</h2>
      <p class="text-sm text-slate-500 mt-1 max-w-sm">อัปโหลดไฟล์ PDF, DOCX หรือ TXT ทางซ้ายมือ ระบบจะให้คะแนน ตรวจหาทักษะ และให้คำแนะนำในการปรับปรุงทันที</p>
      <button onclick="pickFile()" class="mt-5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold">อัปโหลด Resume</button></div>`;
    return;
  }
  const L = r.score >= 80 ? ['ดีมาก (Competitive)', 'text-green-400', 'bg-green-500/20 text-green-300'] : r.score >= 60 ? ['ดี (Good)', 'text-amber-400', 'bg-amber-500/20 text-amber-300'] : ['ควรปรับปรุง', 'text-red-400', 'bg-red-500/20 text-red-300'];
  $('#resume-result').innerHTML = `
    <div class="flex justify-between items-center mb-2 gap-2"><h2 class="text-lg font-semibold text-slate-800 flex items-center"><i class="fa-solid fa-chart-pie text-blue-600 mr-2"></i> ผลการวิเคราะห์ Resume</h2>${aiTag(r.ai)}</div>
    <p class="text-xs text-slate-400 mb-5"><i class="fa-solid fa-file mr-1"></i>${esc(r.filename)} • วิเคราะห์เมื่อ ${fdt(r.analyzedAt)}</p>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <div class="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 rounded-xl text-center"><span class="text-xs text-slate-300 block">คะแนน Resume ความสมบูรณ์</span>
        <span class="text-4xl font-extrabold ${L[1]} my-1 block">${r.score}<span class="text-lg text-slate-400">/100</span></span><span class="text-[11px] ${L[2]} px-2 py-0.5 rounded">ระดับ: ${L[0]}</span></div>
      <div class="bg-slate-50 p-4 rounded-xl border border-slate-100"><p class="text-xs text-slate-500 font-medium">ทักษะหลักที่พบ (Detected Skills)</p>
        <div class="flex flex-wrap gap-1.5 mt-2">${r.skills.length ? r.skills.map(s => `<span class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">${esc(s)}</span>`).join('') : '<span class="text-xs text-slate-400">ไม่พบทักษะที่ระบบรู้จัก</span>'}</div></div>
      <div class="bg-slate-50 p-4 rounded-xl border border-slate-100"><p class="text-xs text-slate-500 font-medium">ประสบการณ์การทำงาน</p>
        <p class="text-lg font-bold text-slate-800 mt-1">${esc(r.years)}</p><p class="text-xs text-slate-400 mt-1">${r.field ? `สายงานหลัก: ${esc(r.field)}` : 'ยังระบุสายงานไม่ได้'}</p></div></div>
    <div class="space-y-4"><h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wider">ข้อเสนอแนะในการปรับปรุง</h3>
      ${r.recs.map(x => { const c = REC[x.type] || REC.info; return `<div class="p-4 ${c[0]} border-l-4 rounded-r-xl"><div class="flex items-start"><i class="fa-solid ${c[1]} mt-1 mr-3"></i><div><h4 class="text-sm font-semibold ${c[2]}">${esc(x.title)}</h4><p class="text-xs ${c[3]} mt-0.5">${esc(x.text)}</p></div></div></div>`; }).join('')}</div>
    <div class="mt-6 flex flex-wrap justify-end gap-3">
      <button onclick="downloadReport()" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50"><i class="fa-solid fa-download mr-1"></i>ดาวน์โหลดรายงาน (PDF)</button>
      <button onclick="switchTab('match')" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-md transition">ไปยังขั้นตอนถัดไป: จับคู่งาน AI <i class="fa-solid fa-arrow-right ml-1"></i></button></div>`;
}

function pickFile() {
  const i = document.createElement('input'); i.type = 'file'; i.accept = '.pdf,.docx,.txt,.md';
  i.onchange = () => i.files[0] && handleResume(i.files[0]); i.click();
}
async function handleResume(f) {
  if (!/\.(pdf|docx|txt|md)$/i.test(f.name)) return toast('รองรับเฉพาะไฟล์ PDF, DOCX, TXT', 'err');
  if (f.size > 10 * 1048576) return toast('ไฟล์ใหญ่เกิน 10MB', 'err');
  if (!f.size) return toast('ไฟล์ว่างเปล่า', 'err');
  if (S.tab !== 'resume') switchTab('resume');
  $('#resume-result').innerHTML = `<div class="py-24 text-center text-slate-500"><i class="fa-solid fa-spinner fa-spin text-3xl text-blue-600 mb-3"></i><p class="text-sm">${S.status && S.status.ai ? 'AI' : 'ระบบ'}กำลังวิเคราะห์ Resume ของคุณ...</p><p class="text-xs text-slate-400 mt-1">ไฟล์ PDF แบบสแกนอาจใช้เวลา OCR ประมาณ 10–30 วินาที</p></div>`;
  try {
    const r = await fetch('/api/resume/analyze?filename=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + token() }, body: f });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) sessionExpired(d.message);
    if (!r.ok) throw new Error(d.message || 'วิเคราะห์ไม่สำเร็จ');
    S.resume = d; S.form = null;
    [S.jobs, S.notifs] = await Promise.all([api('/api/jobs'), api('/api/notifications')]);
    S.coach.questions = [];
    renderNotifs();
    toast(`วิเคราะห์ Resume เรียบร้อย ได้ ${d.score}/100`);
    if (d.aiError) toast('เรียก AI ไม่สำเร็จ ระบบใช้โหมดสำรองแทน', 'warn');
  } catch (e) { toast(e.message, 'err'); }
  renderResume(); renderJobs();
}
async function downloadReport() {
  const w = window.open('', '_blank'); // เปิดหน้าต่างทันทีเพื่อไม่ให้ถูก popup blocker บล็อก
  if (!w) return toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต Pop-up', 'err');
  w.document.write('<p style="font-family:sans-serif;padding:24px">กำลังสร้างรายงาน...</p>');
  try {
    const r = await fetch('/api/resume/report', { headers: { Authorization: 'Bearer ' + token() } });
    const html = await r.text();
    if (!r.ok) throw new Error((() => { try { return JSON.parse(html).message; } catch { return 'สร้างรายงานไม่สำเร็จ'; } })());
    w.document.open(); w.document.write(html); w.document.close();
    toast('เลือก "บันทึกเป็น PDF" ในหน้าต่างพิมพ์');
  } catch (e) { w.close(); toast(e.message, 'err'); }
}

/* ---------- 2. Job matching ---------- */
const COLORS = ['bg-blue-600', 'bg-purple-600', 'bg-indigo-600', 'bg-teal-600', 'bg-rose-600', 'bg-orange-600'];
const matchBadge = j => j.match == null
  ? '<span class="px-2.5 py-1 bg-slate-100 text-slate-500 text-[11px] font-semibold rounded-full whitespace-nowrap" title="อัปโหลด Resume เพื่อคำนวณ">-- % Match</span>'
  : `<span class="px-2.5 py-1 ${j.match >= 80 ? 'bg-emerald-100 text-emerald-700' : j.match >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'} text-xs font-bold rounded-full whitespace-nowrap"><i class="fa-solid fa-bolt mr-1"></i>${j.match}% Match</span>`;
const tagChips = j => (j.tags || []).map(t => (j.matchedTags || []).includes(t)
  ? `<span class="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[11px]"><i class="fa-solid fa-check mr-0.5"></i>${esc(t)}</span>`
  : `<span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[11px]">${esc(t)}</span>`).join('');
function jobCard(j) {
  const done = applied(j.id);
  return `<div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"><div>
    <div class="flex justify-between items-start mb-3 gap-2"><div class="flex items-center space-x-3 min-w-0">
      <div class="w-12 h-12 shrink-0 rounded-xl ${COLORS[j.id % 6]} text-white font-bold flex items-center justify-center text-xl">${esc((j.company || '?')[0])}</div>
      <div class="min-w-0"><button onclick="showJob(${j.id})" class="text-left font-bold text-slate-800 hover:text-blue-600">${esc(j.title)}</button><p class="text-xs text-slate-400 truncate">${esc(j.company)}</p></div></div>
      ${matchBadge(j)}</div>
    <div class="space-y-2 text-xs text-slate-600 my-4"><p class="flex items-center"><i class="fa-solid fa-location-dot w-5 text-slate-400"></i> ${esc(j.location || 'ไม่ระบุ')}</p>
      <p class="flex items-center"><i class="fa-solid fa-money-bill-wave w-5 text-slate-400"></i> ${salary(j)}</p>
      <p class="flex items-center"><i class="fa-solid fa-briefcase w-5 text-slate-400"></i> ประสบการณ์ ${esc(j.exp || 'ไม่ระบุ')}</p></div>
    <div class="flex flex-wrap gap-1 mb-4">${tagChips(j)}</div></div>
    <div class="pt-4 border-t border-slate-100 flex items-center justify-between gap-2"><span class="text-[11px] text-slate-400">โพสต์เมื่อ ${fd(j.postedAt)} (${ago(j.postedAt)})</span>
      ${done ? '<span class="px-4 py-1.5 bg-slate-100 text-slate-500 rounded-lg text-xs font-medium whitespace-nowrap"><i class="fa-solid fa-check mr-1"></i>สมัครแล้ว</span>' : `<button onclick="applyTo(${j.id})" class="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition whitespace-nowrap">สมัครทันที</button>`}</div></div>`;
}
function renderJobs() {
  if (!$('#job-grid')) return;
  const q = $('#job-search').value.trim().toLowerCase(), s = $('#job-sort').value;
  const a = S.jobs.filter(j => !q || [j.title, j.company, j.location, ...(j.tags || [])].join(' ').toLowerCase().includes(q));
  a.sort(s === 'salary' ? (x, y) => (y.salaryMax || 0) - (x.salaryMax || 0) : s === 'latest' ? (x, y) => new Date(y.postedAt) - new Date(x.postedAt) : (x, y) => (y.match ?? -1) - (x.match ?? -1));
  const hint = !S.resume || S.resume.empty ? '<div class="col-span-full p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800"><i class="fa-solid fa-circle-info mr-1"></i>อัปโหลด Resume ในขั้นตอนที่ 1 เพื่อให้ระบบคำนวณ % ความเหมาะสมของแต่ละงาน <button onclick="switchTab(\'resume\')" class="underline font-semibold ml-1">ไปอัปโหลด</button></div>' : '';
  $('#job-grid').innerHTML = hint + (a.length ? a.map(jobCard).join('') : '<p class="col-span-full text-center text-sm text-slate-400 py-16"><i class="fa-solid fa-magnifying-glass text-3xl mb-3 block"></i>ไม่พบงานที่ตรงกับคำค้นหา</p>');
}
function showJob(id) {
  const j = S.jobs.find(x => x.id === id); if (!j) return;
  modal(`<div class="flex justify-between items-start mb-3"><div><h2 class="text-lg font-bold text-slate-800">${esc(j.title)}</h2><p class="text-xs text-slate-400">${esc(j.company)}</p></div>
    <button onclick="closeModal()" aria-label="ปิด" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark text-lg"></i></button></div>
    <p class="text-xs text-slate-600 leading-relaxed mb-4 whitespace-pre-line">${esc(j.description || 'ไม่มีรายละเอียดงาน')}</p>
    <div class="space-y-1.5 text-xs text-slate-600 mb-4"><p><i class="fa-solid fa-location-dot w-5 text-slate-400"></i>${esc(j.location || 'ไม่ระบุ')}</p><p><i class="fa-solid fa-money-bill-wave w-5 text-slate-400"></i>${salary(j)}</p><p><i class="fa-regular fa-calendar w-5 text-slate-400"></i>โพสต์เมื่อ ${fd(j.postedAt)}</p><p><i class="fa-solid fa-briefcase w-5 text-slate-400"></i>ประสบการณ์ ${esc(j.exp || 'ไม่ระบุ')}</p>
    <p><i class="fa-solid fa-bolt w-5 text-emerald-500"></i>ความเหมาะสม ${j.match == null ? '(อัปโหลด Resume เพื่อคำนวณ)' : j.match + '%'}${(j.matchedTags || []).length ? ` • ทักษะที่ตรง: ${esc(j.matchedTags.join(', '))}` : ''}</p></div>
    <div class="flex flex-wrap gap-1 mb-5">${tagChips(j)}</div>
    <div class="flex justify-end space-x-2"><button onclick="closeModal()" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-600">ปิด</button>
    ${applied(j.id) ? '<span class="px-4 py-2 bg-slate-100 text-slate-500 rounded-xl text-xs">สมัครแล้ว</span>' : `<button onclick="closeModal();applyTo(${j.id})" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold">สมัครทันที</button>`}</div>`);
}
function applyTo(id) { S.job = S.jobs.find(j => j.id === id) || null; if (S.form) S.form.coverJob = null; switchTab('apply'); }

/* ---------- 3. Apply ---------- */
function renderApply() {
  if (!S.form) S.form = { name: S.user.name || '', email: S.user.email || '', portfolio: '', cover: '', coverJob: null, coverAi: null, coverLoading: false };
  if (!S.job || applied(S.job.id)) S.job = S.jobs.filter(j => !applied(j.id)).sort((a, b) => (b.match ?? -1) - (a.match ?? -1))[0] || null;
  const f = S.form, j = S.job;
  if (!S.resume || S.resume.empty) { $('#apply-root').innerHTML = '<div class="p-8 bg-amber-50 rounded-xl text-amber-800 text-sm">กรุณาอัปโหลด Resume ในขั้นตอนที่ 1 ก่อนสมัครงาน <button onclick="switchTab(\'resume\')" class="ml-2 underline font-semibold">ไปอัปโหลด</button></div>'; return; }
  if (!j) { $('#apply-root').innerHTML = '<div class="py-12 text-center text-sm text-slate-400"><i class="fa-solid fa-circle-check text-4xl text-emerald-500 mb-3 block"></i>คุณสมัครงานครบทุกตำแหน่งแล้ว ดูสถานะได้ที่แท็บติดตามผล</div>'; return; }
  const needCover = f.coverJob !== j.id;
  if (needCover) { f.cover = ''; f.coverJob = j.id; f.coverAi = null; }
  $('#apply-root').innerHTML = `<form onsubmit="submitApplication(event)" class="space-y-5">
    <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3"><div class="flex-grow min-w-0"><label for="apply-job" class="text-xs text-slate-400 mb-1 block">ตำแหน่งงานที่กำลังสมัคร</label>
      <select id="apply-job" onchange="applyTo(+this.value)" class="w-full bg-transparent font-bold text-slate-800 text-sm focus:outline-none">${S.jobs.filter(x => !applied(x.id)).map(x => `<option value="${x.id}" ${x.id === j.id ? 'selected' : ''}>${esc(x.title)} - ${esc(x.company)}</option>`).join('')}</select></div>
      ${j.match == null ? '' : `<span class="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-semibold whitespace-nowrap">${j.match}% Match Score</span>`}</div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label for="ap-name" class="block text-xs font-semibold text-slate-700 mb-1">ชื่อ-นามสกุล</label><input id="ap-name" required maxlength="100" value="${esc(f.name)}" oninput="S.form.name=this.value" class="${inp}"></div>
      <div><label for="ap-email" class="block text-xs font-semibold text-slate-700 mb-1">อีเมลติดต่อ</label><input id="ap-email" required type="email" maxlength="120" value="${esc(f.email)}" oninput="S.form.email=this.value" class="${inp}"></div></div>
    <div><p class="block text-xs font-semibold text-slate-700 mb-1">ไฟล์ Resume ที่จะแนบ</p><div class="flex items-center space-x-3 p-3 border border-slate-200 rounded-xl bg-slate-50">
      <i class="fa-solid fa-file-lines text-red-500 text-2xl"></i><div class="flex-grow min-w-0"><p class="text-xs font-semibold text-slate-700 truncate">${esc(S.resume.filename)}</p><p class="text-[11px] text-green-600"><i class="fa-solid fa-circle-check"></i> วิเคราะห์แล้ว (${S.resume.score}/100)</p></div>
      <button type="button" onclick="pickFile()" class="text-xs text-blue-600 hover:underline whitespace-nowrap">เปลี่ยนไฟล์</button></div></div>
    <div><label for="ap-port" class="block text-xs font-semibold text-slate-700 mb-1">ลิงก์ผลงาน (Portfolio / GitHub / Behance)</label><input id="ap-port" type="url" maxlength="300" placeholder="https://" value="${esc(f.portfolio)}" oninput="S.form.portfolio=this.value" class="${inp}"></div>
    <div><div class="flex justify-between items-center mb-1 gap-2"><label for="ap-cover" class="text-xs font-semibold text-slate-700">ข้อความถึง HR (Cover Letter) <span id="cover-tag">${f.coverAi == null ? '' : aiTag(f.coverAi)}</span></label>
      <button type="button" id="cover-btn" onclick="loadCover(true)" class="text-[11px] text-blue-600 hover:underline whitespace-nowrap"><i class="fa-solid fa-wand-magic-sparkles mr-1"></i>ให้ AI เขียนใหม่</button></div>
      <textarea id="ap-cover" required rows="9" maxlength="5000" oninput="S.form.cover=this.value" class="${inp}">${esc(f.cover)}</textarea></div>
    <div class="pt-4 flex flex-wrap gap-3 items-center justify-between border-t border-slate-100"><span class="text-xs text-slate-500"><i class="fa-solid fa-lock text-slate-400 mr-1"></i> ข้อมูลจะถูกส่งให้นายจ้างของตำแหน่งนี้เท่านั้น</span>
      <button type="submit" id="apply-btn" class="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md transition"><i class="fa-solid fa-paper-plane mr-1.5"></i> ส่งใบสมัครทันที</button></div></form>`;
  if (needCover) loadCover(false);
}
async function loadCover(force) {
  const f = S.form, j = S.job; if (!j) return;
  const jobId = j.id, ta = $('#ap-cover'), btn = $('#cover-btn');
  if (force && f.cover && !confirm('ต้องการให้ระบบเขียนข้อความใหม่แทนข้อความเดิมใช่หรือไม่?')) return;
  if (ta) { ta.value = ''; ta.placeholder = 'กำลังเขียน Cover Letter ให้คุณ...'; ta.disabled = true; }
  busy(btn, true, 'กำลังเขียน...');
  try {
    const d = await api('/api/cover-letter', 'POST', { jobId, name: f.name });
    if (f.coverJob !== jobId) return; // ผู้ใช้เปลี่ยนตำแหน่งไปแล้ว
    f.cover = d.letter; f.coverAi = d.ai;
    const t = $('#ap-cover'); if (t) t.value = d.letter;
    const tag = $('#cover-tag'); if (tag) tag.innerHTML = aiTag(d.ai);
  } catch (e) { toast(e.message, 'err'); }
  finally { const t = $('#ap-cover'); if (t) { t.disabled = false; t.placeholder = ''; } busy($('#cover-btn'), false); }
}
async function submitApplication(e) {
  e.preventDefault(); const f = S.form, btn = $('#apply-btn');
  if (!f.cover.trim()) return toast('กรุณากรอกข้อความถึง HR', 'err');
  busy(btn, true, 'กำลังส่ง...');
  try {
    await api('/api/applications', 'POST', { jobId: S.job.id, name: f.name, email: f.email, portfolio: f.portfolio, coverLetter: f.cover });
    toast('สมัครงานสำเร็จ! ส่งใบสมัครไปยัง HR เรียบร้อยแล้ว'); S.job = null; f.coverJob = null;
    [S.apps, S.notifs] = await Promise.all([api('/api/applications'), api('/api/notifications')]);
    renderNotifs(); switchTab('tracking');
  } catch (err) { toast(err.message, 'err'); busy(btn, false); }
}

/* ---------- 4. Interview coach ---------- */
let rec = null;
const C = () => S.coach;
function coachJobs() {
  const iv = S.apps.filter(a => a.status === 'interview').map(a => a.jobId);
  const list = [...S.jobs];
  for (const a of S.apps) if (!list.some(j => j.id === a.jobId)) list.push({ id: a.jobId, title: a.title, company: a.company });
  return list.sort((a, b) => iv.includes(b.id) - iv.includes(a.id)).map(j => ({ ...j, interview: iv.includes(j.id) }));
}
async function openCoach() {
  const c = C();
  if (!c.questions.length && !c.loading) {
    if (c.jobId == null) c.jobId = ''; // ค่าเริ่มต้น: คำถามสัมภาษณ์ทั่วไป ใช้ได้ทุกอาชีพ
    await loadQuestions(c.jobId);
  } else renderCoach();
  api('/api/interview/history').then(h => { c.history = h; renderCoach(); }).catch(() => {});
}
async function loadQuestions(jobId) {
  const c = C(); if (rec) rec.stop();
  Object.assign(c, { jobId, loading: true, questions: [], q: 0, ans: [], cur: null, draft: '' });
  renderCoach();
  try { const d = await api('/api/interview/questions' + (jobId ? `?jobId=${jobId}` : '')); c.questions = d.questions; c.ai = d.ai; }
  catch (e) { toast(e.message, 'err'); }
  c.loading = false; renderCoach();
}
function prepInterview(jobId) { C().questions = []; C().jobId = jobId; switchTab('coach'); }
function renderCoach() {
  const c = C(), QS = c.questions, q = c.q, ev = c.ans.filter(Boolean), avg = k => ev.length ? ev.reduce((s, x) => s + x[k], 0) / ev.length : 0;
  const tot = ev.length ? Math.round(avg('total')) : null, last = c.cur || ev[ev.length - 1];
  const opts = coachJobs().map(j => `<option value="${j.id}" ${String(c.jobId) === String(j.id) ? 'selected' : ''}>${j.interview ? '📅 นัดสัมภาษณ์ • ' : ''}${esc(j.title)} - ${esc(j.company)}</option>`).join('');
  const picker = `<div class="flex flex-wrap items-center gap-2 pb-4 border-b border-slate-800"><label for="coach-job" class="text-[11px] text-slate-400">ชุดคำถาม:</label>
    <select id="coach-job" onchange="loadQuestions(this.value)" ${c.loading ? 'disabled' : ''} class="flex-1 min-w-[180px] bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 px-2 py-1.5"><option value="" ${!c.jobId ? 'selected' : ''}>🎯 คำถามสัมภาษณ์ทั่วไป (ใช้ได้ทุกอาชีพ)</option>${opts}</select>
    ${QS.length ? aiTag(c.ai) : ''}<button onclick="loadQuestions(C().jobId)" ${c.loading ? 'disabled' : ''} title="สุ่มคำถามชุดใหม่" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-[11px] text-slate-300"><i class="fa-solid fa-shuffle mr-1"></i>สุ่มชุดใหม่</button></div>`;
  let left;
  if (c.loading) left = `${picker}<div class="flex-1 flex flex-col items-center justify-center py-20 text-slate-400"><i class="fa-solid fa-spinner fa-spin text-3xl text-indigo-400 mb-3"></i><p class="text-sm">กำลังเตรียมคำถามสัมภาษณ์...</p></div>`;
  else if (!QS.length) left = `${picker}<div class="py-20 text-center text-slate-400 text-sm">ไม่สามารถโหลดคำถามได้ <button onclick="loadQuestions(C().jobId)" class="underline ml-1">ลองใหม่</button></div>`;
  else if (q >= QS.length) left = `${picker}<div class="text-center py-16"><i class="fa-solid fa-trophy text-5xl text-amber-400 mb-4"></i><h3 class="text-lg font-bold">ฝึกซ้อมครบทั้ง ${QS.length} ข้อแล้ว!</h3>
      <p class="text-sm text-slate-400 mt-2">ตอบและได้รับการประเมิน ${ev.length} ข้อ คะแนนเฉลี่ย ${tot ?? '-'}/100</p>
      <div class="mt-6 flex justify-center gap-2"><button onclick="Object.assign(C(),{q:0,ans:[],cur:null,draft:''});renderCoach()" class="px-5 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold">ฝึกชุดเดิมอีกครั้ง</button>
      <button onclick="loadQuestions(C().jobId)" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-bold">ขอคำถามชุดใหม่</button></div></div>`;
  else left = `<div>${picker}<div class="flex items-center justify-between pt-4"><div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-full bg-indigo-500/20 border border-indigo-400 flex items-center justify-center text-indigo-400"><i class="fa-solid fa-robot text-lg"></i></div>
        <div><h3 class="text-sm font-bold text-slate-100">AI Interviewer Coach</h3><span class="text-[11px] text-emerald-400 flex items-center"><span class="w-2 h-2 rounded-full bg-emerald-400 mr-1 animate-pulse"></span> พร้อมฝึกซ้อม</span></div></div>
        <span class="text-xs bg-slate-800 px-3 py-1 rounded-full text-slate-400">คำถามที่ ${q + 1} จาก ${QS.length}</span></div>
      <div class="mt-5 p-5 bg-slate-800/80 rounded-xl border border-slate-700"><span class="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider block mb-1">คำถามสัมภาษณ์:</span><p class="text-sm text-slate-200 font-medium">"${esc(QS[q])}"</p></div>
      <div class="mt-5"><label for="interview-answer" class="block text-xs font-medium text-slate-400 mb-2">คำตอบของคุณ (พิมพ์ หรือใช้เสียงตอบ):</label>
        <textarea id="interview-answer" rows="6" maxlength="4000" oninput="C().draft=this.value" placeholder="ตอบตามโครงสร้าง STAR: สถานการณ์ → ภารกิจ → สิ่งที่ลงมือทำ → ผลลัพธ์" class="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-indigo-500">${esc(c.draft)}</textarea></div></div>
      <div class="mt-5 flex flex-wrap gap-2 justify-between items-center pt-4 border-t border-slate-800">
        <button id="mic-btn" onclick="toggleMic()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium"><i class="fa-solid fa-microphone mr-1 text-red-400"></i> พูดบันทึกเสียง</button>
        <div class="flex gap-2"><button onclick="nextQ()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium">${c.cur ? (q === QS.length - 1 ? 'ดูสรุปผล' : 'ข้อถัดไป') : 'ข้ามคำถาม'} <i class="fa-solid fa-forward ml-1"></i></button>
        <button id="eval-btn" onclick="evaluateAnswer()" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition"><i class="fa-solid fa-wand-magic-sparkles mr-1"></i> ให้ AI ประเมินคำตอบ</button></div></div>`;
  const m = [['ความชัดเจน (Clarity)', 'clarity'], ['การแก้ปัญหา (Problem Solving)', 'problem'], ['การทำงานเป็นทีม (Teamwork)', 'teamwork']];
  const hist = (c.history || []).slice(0, 5);
  $('#coach-root').innerHTML = `<div class="lg:col-span-2 bg-slate-900 text-white p-6 rounded-2xl shadow-md flex flex-col justify-between min-h-[460px]">${left}</div>
    <div class="lg:col-span-1 space-y-4"><div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm"><h3 class="text-sm font-bold text-slate-800 mb-3 flex justify-between items-center"><span><i class="fa-solid fa-award text-amber-500 mr-2"></i>คะแนนการตอบสัมภาษณ์</span>${last ? aiTag(last.ai) : ''}</h3>
      <div class="text-center py-3 bg-amber-50/50 rounded-xl border border-amber-100 mb-4"><span class="text-3xl font-extrabold text-amber-600">${tot ?? '--'}<span class="text-sm text-slate-400">/100</span></span>
        <p class="text-xs text-amber-800 mt-1 font-medium px-2">${last ? `ข้อล่าสุด ${last.total}/100 • ${esc(last.summary)}` : 'ตอบคำถามแล้วกด "ให้ AI ประเมินคำตอบ"'}</p></div>
      <div class="space-y-2 text-xs text-slate-600">${m.map(([l, k]) => `<div class="flex justify-between"><span>${l}:</span><span class="font-bold text-slate-800">${ev.length ? avg(k).toFixed(1).replace('.0', '') + '/10' : '-'}</span></div>`).join('')}</div>
      <p class="text-[11px] text-slate-400 mt-3">ประเมินแล้ว ${ev.length}/${QS.length || 5} ข้อ (คะแนนเฉลี่ยของชุดนี้)</p></div>
    <div class="bg-blue-50 p-5 rounded-2xl border border-blue-100"><h3 class="text-sm font-bold text-blue-900 mb-2"><i class="fa-solid fa-lightbulb text-blue-600 mr-2"></i>คำแนะนำจากโค้ช</h3>
      <p class="text-xs text-blue-800 leading-relaxed">${last ? esc(last.tip) : 'ตอบตามโครงสร้าง STAR และยกตัวอย่างผลลัพธ์เชิงตัวเลขเพื่อให้คำตอบน่าเชื่อถือ'}</p></div>
    ${hist.length ? `<div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm"><h3 class="text-sm font-bold text-slate-800 mb-3"><i class="fa-solid fa-clock-rotate-left text-slate-400 mr-2"></i>ประวัติการฝึกล่าสุด</h3>
      <div class="space-y-2">${hist.map(h => `<div class="flex justify-between gap-2 text-[11px]"><span class="text-slate-600 truncate" title="${esc(h.question)}">${esc(h.question)}</span><span class="font-bold ${h.total >= 70 ? 'text-emerald-600' : h.total >= 50 ? 'text-amber-600' : 'text-red-500'} whitespace-nowrap">${h.total}/100</span></div>`).join('')}</div></div>` : ''}</div>`;
}
async function evaluateAnswer() {
  const c = C(), a = ($('#interview-answer').value || '').trim();
  if (!a) return toast('กรุณาพิมพ์หรือพูดคำตอบก่อนให้ AI ประเมิน', 'err');
  if (rec) rec.stop();
  const btn = $('#eval-btn'); busy(btn, true, 'กำลังประเมิน...');
  try {
    c.draft = a;
    c.cur = c.ans[c.q] = await api('/api/interview/evaluate', 'POST', { question: c.questions[c.q], answer: a, jobId: c.jobId || undefined });
    renderCoach(); toast(`ประเมินแล้ว: ${c.cur.total}/100`);
    api('/api/interview/history').then(h => { c.history = h; renderCoach(); }).catch(() => {});
  } catch (e) { toast(e.message, 'err'); busy(btn, false); }
}
function nextQ() { const c = C(); if (rec) rec.stop(); c.q++; c.cur = null; c.draft = ''; renderCoach(); }
function setMic(on) { const b = $('#mic-btn'); if (b) b.innerHTML = on ? '<i class="fa-solid fa-stop mr-1 text-red-400 animate-pulse"></i> หยุดบันทึกเสียง' : '<i class="fa-solid fa-microphone mr-1 text-red-400"></i> พูดบันทึกเสียง'; }
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('เบราว์เซอร์นี้ไม่รองรับการพูด ลองใช้ Chrome หรือ Edge', 'err');
  if (rec) return rec.stop();
  rec = new SR(); rec.lang = 'th-TH'; rec.continuous = true;
  rec.onresult = e => { const t = [...e.results].slice(e.resultIndex).filter(r => r.isFinal).map(r => r[0].transcript).join(' '); const a = $('#interview-answer'); if (a && t) { a.value = (a.value + ' ' + t).trim(); C().draft = a.value; } };
  rec.onend = () => { rec = null; setMic(false); };
  rec.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast('ไม่สามารถใช้ไมโครโฟนได้ กรุณาอนุญาตการเข้าถึงไมโครโฟน', 'err'); };
  rec.start(); setMic(true);
}

/* ---------- 5. Tracking & reviews ---------- */
const COLS = [
  { k: 'applied', t: 'ยื่นสมัครแล้ว', box: 'bg-slate-100/70 border-slate-200', txt: 'text-slate-600', dot: 'bg-slate-400', badge: 'bg-slate-100 text-slate-600', card: 'border-slate-200', empty: 'border-slate-300' },
  { k: 'interview', t: 'นัดสัมภาษณ์', box: 'bg-blue-50/70 border-blue-100', txt: 'text-blue-700', dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700', card: 'border-blue-200', empty: 'border-blue-200' },
  { k: 'offer', t: 'ได้รับข้อเสนอ (Offer)', box: 'bg-amber-50/70 border-amber-100', txt: 'text-amber-700', dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700', card: 'border-amber-200', empty: 'border-amber-200' },
  { k: 'hired', t: 'ได้งานแล้ว', box: 'bg-emerald-50/70 border-emerald-100', txt: 'text-emerald-700', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', card: 'border-emerald-200', empty: 'border-emerald-200' },
  { k: 'rejected', t: 'ไม่ผ่านการคัดเลือก', box: 'bg-red-50/60 border-red-100', txt: 'text-red-600', dot: 'bg-red-400', badge: 'bg-red-100 text-red-600', card: 'border-red-200', empty: 'border-red-200' }
];
function appCard(a, c) {
  const b = a.status === 'interview' ? `สัมภาษณ์ ${fdt(a.interviewAt)}` : a.status === 'applied' ? `ส่งเมื่อ ${fd(a.appliedAt)}` : a.status === 'offer' ? 'ได้รับข้อเสนอแล้ว' : a.status === 'hired' ? 'ผ่านการคัดเลือก' : 'ไม่ผ่านในรอบนี้';
  const canWithdraw = a.status === 'applied' || a.status === 'interview';
  return `<div class="bg-white p-4 rounded-xl border ${c.card} shadow-sm space-y-2 mb-3"><span class="text-[10px] ${c.badge} px-2 py-0.5 rounded font-semibold">${b}</span>
    <h4 class="font-bold text-xs text-slate-800 pt-1">${esc(a.title)}</h4><p class="text-[11px] text-slate-500">${esc(a.company)}${a.jobActive === false ? ' • <span class="text-slate-400">ปิดรับสมัครแล้ว</span>' : ''}</p>
    ${a.match != null ? `<p class="text-[11px] text-slate-400"><i class="fa-solid fa-bolt text-emerald-500 mr-1"></i>Match ${a.match}%</p>` : ''}
    ${a.status === 'interview' ? `<button onclick="prepInterview(${a.jobId})" class="w-full py-1 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded text-[11px] font-semibold transition"><i class="fa-solid fa-comments mr-1"></i> เตรียมตัวด้วย AI โค้ช</button>` : ''}
    <div class="flex gap-2 pt-1"><button onclick="viewMyApplication(${a.id})" class="flex-1 py-1 bg-slate-100 hover:bg-slate-200 rounded text-[11px] text-slate-600"><i class="fa-regular fa-eye mr-1"></i>ดูใบสมัคร</button>
    ${canWithdraw ? `<button onclick="withdraw(${a.id})" title="ถอนใบสมัคร" aria-label="ถอนใบสมัคร" class="px-2 py-1 text-[11px] text-red-500 hover:bg-red-50 rounded"><i class="fa-regular fa-trash-can"></i></button>` : ''}</div></div>`;
}
function renderKanban() {
  $('#kanban').innerHTML = COLS.map(c => { const l = S.apps.filter(a => a.status === c.k); return `<div class="${c.box} p-4 rounded-2xl border"><div class="flex justify-between items-center mb-3"><span class="text-xs font-bold ${c.txt} uppercase">${c.t} (${l.length})</span><span class="w-2 h-2 rounded-full ${c.dot}"></span></div>
    ${l.length ? l.map(a => appCard(a, c)).join('') : `<div class="p-6 text-center border-2 border-dashed ${c.empty} rounded-xl text-slate-400 text-xs">ไม่มีรายการ</div>`}</div>`; }).join('');
}
function viewMyApplication(id) {
  const a = S.apps.find(x => x.id === id); if (!a) return;
  modal(`<div class="flex justify-between items-start mb-3"><div><h2 class="text-lg font-bold">${esc(a.title)}</h2><p class="text-xs text-slate-400">${esc(a.company)} • ส่งเมื่อ ${fdt(a.appliedAt)}</p></div><button onclick="closeModal()" aria-label="ปิด" class="text-slate-400"><i class="fa-solid fa-xmark text-lg"></i></button></div>
    <div class="text-xs space-y-1 mb-3 text-slate-600"><p><b>ชื่อ:</b> ${esc(a.name)}</p><p><b>อีเมล:</b> ${esc(a.email)}</p><p><b>Resume:</b> ${esc(a.resumeName || '-')}</p>${a.portfolio ? `<p><b>Portfolio:</b> <a class="text-blue-600 underline" href="${esc(a.portfolio)}" target="_blank" rel="noopener noreferrer">${esc(a.portfolio)}</a></p>` : ''}</div>
    <p class="text-xs font-semibold mb-1">ข้อความถึง HR</p><div class="p-3 bg-slate-50 rounded-xl text-xs whitespace-pre-line text-slate-700">${esc(a.coverLetter || '-')}</div>`);
}
const stars = r => [1, 2, 3, 4, 5].map(i => `<i class="fa-${i <= r ? 'solid' : 'regular'} fa-star"></i>`).join('');
function renderReviews() {
  $('#reviews-root').innerHTML = `<div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"><div class="flex flex-wrap justify-between items-center mb-6 gap-3"><div><h2 class="text-lg font-bold text-slate-800">รีวิวบริษัทและประสบการณ์สัมภาษณ์จากผู้สมัคร</h2><p class="text-xs text-slate-400">แบ่งปันและอ่านประสบการณ์ตรงเพื่อเตรียมความพร้อมอย่างมั่นใจ</p></div>
    <button onclick="reviewForm()" class="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"><i class="fa-solid fa-pen mr-1"></i> เขียนรีวิวประสบการณ์</button></div>
    ${S.reviews.length ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">${S.reviews.map(r => `<div class="p-4 rounded-xl border ${r.mine ? 'border-blue-200 bg-blue-50/40' : 'border-slate-100 bg-slate-50'} space-y-2"><div class="flex justify-between items-start gap-2"><div><h4 class="text-xs font-bold text-slate-800">${esc(r.company)}${r.mine ? ' <span class="text-[10px] text-blue-600 font-normal">(รีวิวของคุณ)</span>' : ''}</h4>
      <div class="text-amber-400 text-xs my-0.5">${stars(r.rating)}<span class="text-slate-600 font-semibold ml-1">${Number(r.rating || 0).toFixed(1)}</span></div></div>
      <span class="text-[10px] text-slate-400 whitespace-nowrap">${valid(r.createdAt) ? new Date(r.createdAt).toLocaleDateString('th-TH-u-ca-gregory', { month: 'short', year: 'numeric', ...D }) : ''}</span></div>
      <p class="text-xs text-slate-600 leading-relaxed">"${esc(r.comment)}"</p><div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 pt-1"><span class="bg-white px-2 py-0.5 rounded border border-slate-200">ตำแหน่ง: ${esc(r.position)}</span><span>• ${esc(r.type)}</span></div></div>`).join('')}</div>`
      : '<p class="text-center text-sm text-slate-400 py-10"><i class="fa-regular fa-comments text-3xl block mb-2"></i>ยังไม่มีรีวิว เป็นคนแรกที่แบ่งปันประสบการณ์</p>'}</div>`;
}
function reviewForm() {
  S.rate = 0; const cs = [...new Set([...S.apps.map(a => a.company), ...S.jobs.map(j => j.company)])];
  modal(`<h2 class="text-lg font-bold text-slate-800 mb-4">เขียนรีวิวประสบการณ์</h2><form onsubmit="submitReview(event)" class="space-y-4">
    <div><label for="rv-company" class="block text-xs font-semibold text-slate-700 mb-1">ชื่อบริษัท</label><input id="rv-company" list="rv-list" required maxlength="120" class="${inp}"><datalist id="rv-list">${cs.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
    <div><label for="rv-position" class="block text-xs font-semibold text-slate-700 mb-1">ตำแหน่งที่สมัคร</label><input id="rv-position" required maxlength="120" class="${inp}"></div>
    <div><label for="rv-type" class="block text-xs font-semibold text-slate-700 mb-1">สถานะของคุณ</label><select id="rv-type" class="${inp}"><option>ผู้รับการสัมภาษณ์</option><option>ผู้สมัครที่ได้รับการว่าจ้างจริง</option><option>ผู้สมัคร</option></select></div>
    <div><p class="block text-xs font-semibold text-slate-700 mb-1">ให้คะแนน <span class="text-red-500">*</span></p><div id="rv-stars" class="text-2xl text-amber-400 space-x-1">${[1, 2, 3, 4, 5].map(i => `<button type="button" aria-label="${i} ดาว" onclick="setRate(${i})"><i class="fa-regular fa-star"></i></button>`).join('')}</div></div>
    <div><label for="rv-comment" class="block text-xs font-semibold text-slate-700 mb-1">ประสบการณ์ของคุณ</label><textarea id="rv-comment" rows="4" required minlength="10" maxlength="2000" placeholder="เล่าขั้นตอนสัมภาษณ์ บรรยากาศ และสิ่งที่ควรเตรียมตัว" class="${inp}"></textarea></div>
    <div class="flex justify-end space-x-2"><button type="button" onclick="closeModal()" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-600">ยกเลิก</button><button class="px-5 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold">โพสต์รีวิว</button></div></form>`);
}
function setRate(n) { S.rate = n; document.querySelectorAll('#rv-stars i').forEach((e, i) => { e.className = `fa-${i < n ? 'solid' : 'regular'} fa-star`; }); }
async function submitReview(e) {
  e.preventDefault();
  if (!S.rate) return toast('กรุณาให้คะแนน 1–5 ดาว', 'err');
  try {
    await api('/api/reviews', 'POST', { company: $('#rv-company').value, position: $('#rv-position').value, type: $('#rv-type').value, rating: S.rate, comment: $('#rv-comment').value });
    closeModal(); S.reviews = await api('/api/reviews'); renderReviews(); toast('ขอบคุณสำหรับรีวิวของคุณ!');
  } catch (err) { toast(err.message, 'err'); }
}
async function loadTracking() {
  try { [S.apps, S.reviews] = await Promise.all([api('/api/applications'), api('/api/reviews')]); } catch (e) { toast(e.message, 'err'); }
  renderKanban(); renderReviews();
}
async function withdraw(id) {
  if (!confirm('ต้องการถอนใบสมัครนี้ใช่หรือไม่? นายจ้างจะได้รับแจ้งเตือน')) return;
  try { await api(`/api/applications/${id}`, 'DELETE'); await loadTracking(); toast('ถอนใบสมัครเรียบร้อย'); } catch (e) { toast(e.message, 'err'); }
}

/* ---------- Notifications ---------- */
function renderNotifs() {
  const u = S.notifs.filter(n => !n.read).length, b = $('#bell-badge');
  b.textContent = u > 9 ? '9+' : u; b.classList.toggle('hidden', !u);
  $('#notif-panel').innerHTML = `<div class="flex justify-between items-center px-4 py-3 border-b border-slate-100"><span class="text-sm font-semibold text-slate-800">การแจ้งเตือน</span>${u ? '<button onclick="readAll()" class="text-[11px] text-blue-600 hover:underline">อ่านทั้งหมด</button>' : ''}</div>
    <div class="max-h-80 overflow-y-auto">${S.notifs.length ? S.notifs.map(n => `<div class="px-4 py-3 text-xs border-b border-slate-50 ${n.read ? 'text-slate-500' : 'bg-blue-50/60 text-slate-700'}">${esc(n.text)}<span class="block text-[10px] text-slate-400 mt-0.5">${ago(n.createdAt)}</span></div>`).join('') : '<p class="p-6 text-center text-xs text-slate-400">ไม่มีการแจ้งเตือน</p>'}</div>`;
}
async function readAll() { try { await api('/api/notifications/read', 'POST'); S.notifs.forEach(n => { n.read = true; }); renderNotifs(); } catch (e) { toast(e.message, 'err'); } }
async function pollNotifs() {
  if (!S.user || document.hidden) return;
  try {
    const before = new Set(S.notifs.map(n => n.id));
    S.notifs = await api('/api/notifications');
    const fresh = S.notifs.filter(n => !before.has(n.id) && !n.read);
    renderNotifs();
    if (fresh.length && before.size) {
      toast(fresh[0].text);
      if (S.user.role === 'job_seeker') { S.apps = await api('/api/applications'); if (S.tab === 'tracking') renderKanban(); }
      else if (S.tab === 'employer') renderEmployer();
    }
  } catch { /* ignore */ }
}

/* ---------- Authentication ---------- */
function updateAuthUI() {
  const a = $('#auth-actions'), n = $('#current-user-name'), r = $('#current-user-role'), av = $('#profile-avatar');
  const isEmployer = S.user?.role === 'employer';
  document.querySelectorAll('[data-role-nav="jobseeker"]').forEach(el => el.classList.toggle('hidden', !S.user || isEmployer));
  document.querySelectorAll('[data-role-nav="employer"]').forEach(el => el.classList.toggle('hidden', !isEmployer));
  document.querySelectorAll('[data-role-section]').forEach(el => el.classList.add('hidden'));
  if (!S.user) {
    if (n) n.textContent = 'ผู้เยี่ยมชม'; if (r) r.textContent = 'ยังไม่ได้เข้าสู่ระบบ';
    if (av) av.innerHTML = '<i class="fa-solid fa-user"></i>';
    if (a) a.innerHTML = '<button onclick="loginModal()" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold">เข้าสู่ระบบ</button>';
    return;
  }
  if (n) n.textContent = S.user.name || S.user.username;
  if (r) r.textContent = isEmployer ? `Employer${S.user.company ? ' • ' + S.user.company : ''}` : 'Job Seeker';
  if (av) av.textContent = (S.user.name || S.user.username || '?').trim().charAt(0).toUpperCase();
  if (a) a.innerHTML = '<div class="flex gap-2"><button onclick="changePasswordModal()" title="เปลี่ยนรหัสผ่าน" aria-label="เปลี่ยนรหัสผ่าน" class="px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600"><i class="fa-solid fa-key"></i><span class="hidden sm:inline ml-1">เปลี่ยนรหัส</span></button><button onclick="logout()" title="ออกจากระบบ" aria-label="ออกจากระบบ" class="px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600"><i class="fa-solid fa-right-from-bracket"></i><span class="hidden sm:inline ml-1">ออกจากระบบ</span></button></div>';
}
function loginModal() {
  modal(`<h2 class="text-xl font-bold text-slate-800 mb-1">เข้าสู่ระบบ JobAI Hub</h2><p class="text-xs text-slate-400 mb-5">บัญชีทดสอบ: <b>somchai</b> / demo1234 (ผู้หางาน) หรือ <b>suda</b> / demo1234 (นายจ้าง)</p>
    <form onsubmit="doLogin(event)" class="space-y-3"><input id="login-user" required autocomplete="username" placeholder="Username" class="${inp}"><input id="login-pass" required type="password" autocomplete="current-password" placeholder="Password" class="${inp}"><button id="login-btn" class="w-full py-2.5 bg-blue-600 text-white rounded-xl text-xs font-semibold">เข้าสู่ระบบ</button></form>
    <button onclick="registerModal()" class="mt-4 text-xs text-blue-600 underline">ยังไม่มีบัญชี? สมัครสมาชิก</button>`);
}
function registerModal() {
  modal(`<h2 class="text-xl font-bold mb-4">สมัครสมาชิก JobAI Hub</h2><form onsubmit="doRegister(event)" class="space-y-3">
    <div class="grid grid-cols-2 gap-2 text-xs"><label class="flex items-center gap-2 p-2.5 border rounded-xl cursor-pointer"><input type="radio" name="reg-role" value="job_seeker" checked onchange="$('#reg-company-wrap').classList.add('hidden');$('#reg-company').required=false"> ผู้หางาน</label>
      <label class="flex items-center gap-2 p-2.5 border rounded-xl cursor-pointer"><input type="radio" name="reg-role" value="employer" onchange="$('#reg-company-wrap').classList.remove('hidden');$('#reg-company').required=true"> นายจ้าง / HR</label></div>
    <input id="reg-name" required maxlength="100" placeholder="ชื่อ-นามสกุล" class="${inp}">
    <div id="reg-company-wrap" class="hidden"><input id="reg-company" maxlength="120" placeholder="ชื่อบริษัท" class="${inp}"></div>
    <input id="reg-user" required minlength="3" maxlength="30" pattern="[A-Za-z0-9_.\\-]+" title="ใช้ได้เฉพาะ a-z, 0-9, _ . -" autocomplete="username" placeholder="Username (a-z, 0-9)" class="${inp}">
    <input id="reg-email" type="email" required maxlength="120" placeholder="อีเมล" class="${inp}">
    <input id="reg-pass" type="password" minlength="8" required autocomplete="new-password" placeholder="รหัสผ่านอย่างน้อย 8 ตัว" class="${inp}">
    <button id="reg-btn" class="w-full py-2.5 bg-blue-600 text-white rounded-xl text-xs font-semibold">สมัครสมาชิก</button></form>
    <button onclick="loginModal()" class="mt-3 text-xs text-blue-600 underline">กลับไปเข้าสู่ระบบ</button>`);
}
async function afterLogin(d, msg) {
  setToken(d.token); S.user = d.user; closeModal(); updateAuthUI();
  await bootData(); switchTab(S.user.role === 'employer' ? 'employer' : 'resume'); toast(msg);
}
async function doRegister(e) {
  e.preventDefault(); const btn = $('#reg-btn'); busy(btn, true, 'กำลังสมัคร...');
  try {
    const role = document.querySelector('input[name="reg-role"]:checked').value;
    const d = await api('/register', 'POST', { name: $('#reg-name').value, username: $('#reg-user').value, email: $('#reg-email').value, password: $('#reg-pass').value, role, company: $('#reg-company').value });
    await afterLogin(d, 'สมัครสมาชิกสำเร็จ');
  } catch (err) { toast(err.message, 'err'); busy(btn, false); }
}
function changePasswordModal() {
  modal(`<h2 class="text-xl font-bold mb-4">เปลี่ยนรหัสผ่าน</h2><form onsubmit="doChangePassword(event)" class="space-y-3"><input id="old-pass" type="password" required autocomplete="current-password" placeholder="รหัสผ่านเดิม" class="${inp}"><input id="new-pass" type="password" minlength="8" required autocomplete="new-password" placeholder="รหัสผ่านใหม่ อย่างน้อย 8 ตัว" class="${inp}"><input id="confirm-pass" type="password" minlength="8" required autocomplete="new-password" placeholder="ยืนยันรหัสผ่านใหม่" class="${inp}"><button class="w-full py-2.5 bg-blue-600 text-white rounded-xl text-xs font-semibold">บันทึกรหัสผ่านใหม่</button></form>
    <p class="text-[11px] text-slate-400 mt-3">อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะถูกออกจากระบบอัตโนมัติ</p>`);
}
async function doChangePassword(e) {
  e.preventDefault();
  if ($('#new-pass').value !== $('#confirm-pass').value) return toast('รหัสผ่านใหม่ไม่ตรงกัน', 'err');
  try { const d = await api('/change-password', 'POST', { currentPassword: $('#old-pass').value, newPassword: $('#new-pass').value }); setToken(d.token); closeModal(); toast('เปลี่ยนรหัสผ่านสำเร็จ'); }
  catch (err) { toast(err.message, 'err'); }
}
async function doLogin(e) {
  e.preventDefault(); const btn = $('#login-btn'); busy(btn, true, 'กำลังเข้าสู่ระบบ...');
  try { const d = await api('/login', 'POST', { username: $('#login-user').value, password: $('#login-pass').value }); await afterLogin(d, `ยินดีต้อนรับ ${d.user.name}`); }
  catch (err) { toast(err.message, 'err'); busy(btn, false); }
}
function resetState() {
  if (rec) rec.stop();
  Object.assign(S, { user: null, resume: null, jobs: [], apps: [], reviews: [], notifs: [], job: null, form: null, tab: 'resume' });
  S.coach = { jobId: null, questions: [], ai: false, loading: false, q: 0, ans: [], cur: null, draft: '', history: [] };
  S.emp = { jobs: [], apps: [], filter: '' };
  clearInterval(S.poll); S.poll = null;
}
function logout() {
  clearToken(); resetState(); updateAuthUI(); renderNotifs(); closeModal(); loginModal();
}
// ถ้า server บอกว่าไม่มีสิทธิ์ ให้ตรวจว่าบัญชีที่ใช้อยู่จริงตรงกับหน้าจอหรือไม่ แล้วจัดหน้าจอให้ตรง
async function resyncRole() {
  try {
    const me = await fetch('/me', { headers: { Authorization: 'Bearer ' + token() } }).then(r => r.ok ? r.json() : null);
    if (!me) return sessionExpired();
    if (me.id !== S.user.id || me.role !== S.user.role) {
      resetState(); S.user = me; updateAuthUI(); await bootData();
      switchTab(me.role === 'employer' ? 'employer' : 'resume');
      toast(`สลับเป็นบัญชี ${me.name} ให้ตรงกับที่เข้าสู่ระบบอยู่`, 'warn');
    }
  } catch { /* ignore */ }
}
let expiredShown = false;
function sessionExpired(msg) {
  if (expiredShown) return; expiredShown = true;
  clearToken(); resetState(); updateAuthUI(); renderNotifs();
  toast(msg || 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'warn'); loginModal();
  setTimeout(() => { expiredShown = false; }, 2000);
}
async function bootData() {
  clearInterval(S.poll); S.poll = setInterval(pollNotifs, 30000);
  if (S.user?.role === 'employer') {
    S.notifs = await api('/api/notifications'); renderNotifs();
    return;
  }
  [S.resume, S.jobs, S.apps, S.reviews, S.notifs] = await Promise.all(['resume', 'jobs', 'applications', 'reviews', 'notifications'].map(x => api('/api/' + x)));
  renderNotifs();
}

/* ---------- Employer Portal ---------- */
const STATUS_TH = { applied: 'ยื่นสมัครแล้ว', interview: 'นัดสัมภาษณ์', offer: 'ยื่นข้อเสนอ (Offer)', hired: 'จ้างแล้ว', rejected: 'ไม่ผ่าน' };
async function renderEmployer() {
  if (!S.user || S.user.role !== 'employer') return;
  const root = $('#employer-root'); if (!root) return;
  if (!S.emp.jobs.length) root.innerHTML = '<div class="p-10 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin text-2xl"></i><p class="text-sm mt-2">กำลังโหลดข้อมูลนายจ้าง...</p></div>';
  try { [S.emp.jobs, S.emp.apps] = await Promise.all([api('/api/employer/jobs'), api('/api/employer/applications')]); }
  catch (e) { root.innerHTML = `<div class="p-5 bg-red-50 text-red-700 rounded-xl">${esc(e.message)}</div>`; return; }
  drawEmployer();
}
function drawEmployer() {
  const { jobs, apps, filter } = S.emp, root = $('#employer-root');
  const list = filter ? apps.filter(a => String(a.jobId) === String(filter)) : apps;
  const stat = (label, val, icon, color) => `<div class="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3"><div class="w-10 h-10 rounded-xl ${color} flex items-center justify-center"><i class="fa-solid ${icon}"></i></div><div><p class="text-[11px] text-slate-400">${label}</p><p class="text-xl font-bold text-slate-800">${val}</p></div></div>`;
  root.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${stat('ตำแหน่งที่เปิดรับ', jobs.filter(j => j.active).length, 'fa-briefcase', 'bg-blue-50 text-blue-600')}
      ${stat('ผู้สมัครทั้งหมด', apps.length, 'fa-users', 'bg-indigo-50 text-indigo-600')}
      ${stat('นัดสัมภาษณ์', apps.filter(a => a.status === 'interview').length, 'fa-calendar-check', 'bg-amber-50 text-amber-600')}
      ${stat('จ้างแล้ว', apps.filter(a => a.status === 'hired').length, 'fa-handshake', 'bg-emerald-50 text-emerald-600')}</div>
    <div class="grid lg:grid-cols-5 gap-6"><div class="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5"><div class="flex justify-between items-center mb-4"><h2 class="font-bold">ตำแหน่งงานของฉัน (${jobs.length})</h2><button onclick="employerJobForm()" class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold">+ เพิ่มงาน</button></div>
      <div class="space-y-3">${jobs.length ? jobs.map(j => `<div class="p-3 rounded-xl border ${j.active ? 'border-slate-100' : 'border-dashed border-slate-200 bg-slate-50 opacity-75'}"><div class="flex justify-between gap-2"><div class="min-w-0"><b class="text-sm">${esc(j.title)}</b><p class="text-xs text-slate-500">${esc(j.company)} • ${salary(j)}</p>
        <button onclick="S.emp.filter='${j.id}';drawEmployer()" class="text-[11px] text-blue-600 hover:underline mt-1">ผู้สมัคร ${j.applications} คน</button></div>
        <div class="flex flex-col items-end gap-1 text-xs whitespace-nowrap">${j.active ? '<span class="text-emerald-600 font-semibold">● เปิดรับ</span>' : '<span class="text-slate-400">ปิดรับแล้ว</span>'}
          <div class="flex gap-2"><button onclick="employerJobForm(${j.id})" class="text-slate-500 hover:text-blue-600">แก้ไข</button><button onclick="toggleJob(${j.id},${!j.active})" class="${j.active ? 'text-red-600' : 'text-blue-600'}">${j.active ? 'ปิดรับ' : 'เปิดอีกครั้ง'}</button></div></div></div></div>`).join('') : '<p class="text-xs text-slate-400">ยังไม่มีประกาศงาน กด "+ เพิ่มงาน" เพื่อเริ่ม</p>'}</div></div>
    <div class="lg:col-span-3 bg-white rounded-2xl border border-slate-200 p-5"><div class="flex flex-wrap justify-between items-center gap-2 mb-4"><h2 class="font-bold">ผู้สมัคร (${list.length})</h2>
      <select onchange="S.emp.filter=this.value;drawEmployer()" aria-label="กรองตามตำแหน่ง" class="text-xs border border-slate-200 rounded-lg px-2 py-1.5 max-w-[60%]"><option value="">ทุกตำแหน่ง</option>${jobs.map(j => `<option value="${j.id}" ${String(filter) === String(j.id) ? 'selected' : ''}>${esc(j.title)}</option>`).join('')}</select></div>
      <div class="space-y-3">${list.length ? list.map(a => `<div class="p-3 rounded-xl border border-slate-100"><div class="flex flex-wrap justify-between gap-3"><div class="min-w-0">
        <div class="flex items-center gap-2"><b class="text-sm">${esc(a.candidateName || a.name || a.username)}</b>${a.match != null ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full ${a.match >= 80 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'} font-semibold">${a.match}% Match</span>` : ''}</div>
        <p class="text-xs text-slate-500">${esc(a.title)} • สมัคร ${fd(a.appliedAt)}${a.status === 'interview' ? ` • <span class="text-blue-600">สัมภาษณ์ ${fdt(a.interviewAt)}</span>` : ''}</p>
        <div class="flex gap-3 mt-2 text-xs"><button onclick="viewApplicant(${a.id})" class="text-slate-600 hover:text-blue-600"><i class="fa-regular fa-envelope-open mr-1"></i>ดูใบสมัคร</button>
          ${a.hasResume ? `<button onclick="viewApplicantResume(${a.id})" class="text-blue-600 hover:underline"><i class="fa-solid fa-file-pdf mr-1"></i>Resume</button>` : '<span class="text-slate-300">ไม่มีไฟล์ Resume</span>'}</div></div>
        <select onchange="changeApplicantStatus(${a.id},this.value)" aria-label="สถานะใบสมัคร" class="text-xs border rounded-lg px-2 py-1 h-fit">${Object.entries(STATUS_TH).map(([k, v]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>`).join('') : '<p class="text-xs text-slate-400">ยังไม่มีผู้สมัคร</p>'}</div></div></div>`;
}
function employerJobForm(id) {
  const j = id ? S.emp.jobs.find(x => x.id === id) : null;
  const v = k => esc(j ? (k === 'tags' ? (j.tags || []).join(', ') : j[k] ?? '') : k === 'company' ? (S.user.company || '') : '');
  modal(`<h2 class="text-lg font-bold mb-4">${j ? 'แก้ไขตำแหน่งงาน' : 'เพิ่มตำแหน่งงาน'}</h2><form onsubmit="saveEmployerJob(event,${j ? j.id : 'null'})" class="space-y-3">
    <input id="ej-title" required maxlength="120" placeholder="ชื่อตำแหน่ง *" value="${v('title')}" class="${inp}"><input id="ej-company" required maxlength="120" placeholder="ชื่อบริษัท *" value="${v('company')}" class="${inp}">
    <input id="ej-location" maxlength="150" placeholder="สถานที่ / Remote" value="${v('location')}" class="${inp}">
    <div class="grid grid-cols-2 gap-2"><input id="ej-min" type="number" min="0" step="1000" placeholder="เงินเดือนต่ำสุด" value="${j && j.salaryMin ? j.salaryMin : ''}" class="${inp}"><input id="ej-max" type="number" min="0" step="1000" placeholder="เงินเดือนสูงสุด" value="${j && j.salaryMax ? j.salaryMax : ''}" class="${inp}"></div>
    <input id="ej-exp" maxlength="50" placeholder="ประสบการณ์ เช่น 2-4 ปี" value="${v('exp')}" class="${inp}"><input id="ej-tags" maxlength="400" placeholder="ทักษะที่ต้องการ คั่นด้วย , เช่น Figma, SQL" value="${v('tags')}" class="${inp}">
    <textarea id="ej-desc" maxlength="5000" placeholder="รายละเอียดงาน" class="${inp}" rows="4">${v('description')}</textarea>
    <div class="flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-600">ยกเลิก</button><button class="px-5 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold">${j ? 'บันทึก' : 'สร้างงาน'}</button></div></form>`);
}
async function saveEmployerJob(e, id) {
  e.preventDefault();
  const body = { title: $('#ej-title').value, company: $('#ej-company').value, location: $('#ej-location').value, salaryMin: $('#ej-min').value, salaryMax: $('#ej-max').value, exp: $('#ej-exp').value, tags: $('#ej-tags').value.split(',').map(x => x.trim()).filter(Boolean), description: $('#ej-desc').value };
  try { await api(id ? `/api/employer/jobs/${id}` : '/api/employer/jobs', id ? 'PATCH' : 'POST', body); closeModal(); await renderEmployer(); toast(id ? 'บันทึกการแก้ไขแล้ว' : 'สร้างตำแหน่งงานสำเร็จ'); }
  catch (err) { toast(err.message, 'err'); }
}
async function toggleJob(id, active) {
  if (!active && !confirm('ปิดรับสมัครตำแหน่งนี้? ผู้หางานจะไม่เห็นประกาศนี้อีก')) return;
  try { await api(`/api/employer/jobs/${id}`, 'PATCH', { active }); await renderEmployer(); toast(active ? 'เปิดรับสมัครอีกครั้งแล้ว' : 'ปิดรับสมัครแล้ว'); } catch (e) { toast(e.message, 'err'); }
}
function viewApplicant(id) {
  const a = S.emp.apps.find(x => x.id === id); if (!a) return;
  modal(`<div class="flex justify-between items-start mb-3"><div><h2 class="text-lg font-bold">${esc(a.candidateName || a.name)}</h2><p class="text-xs text-slate-400">${esc(a.title)} • สมัครเมื่อ ${fdt(a.appliedAt)}</p></div><button onclick="closeModal()" aria-label="ปิด" class="text-slate-400"><i class="fa-solid fa-xmark text-lg"></i></button></div>
    <div class="text-xs space-y-1 mb-3 text-slate-600"><p><b>อีเมล:</b> <a class="text-blue-600" href="mailto:${esc(a.email)}">${esc(a.email)}</a></p><p><b>สถานะ:</b> ${STATUS_TH[a.status] || a.status}${a.match != null ? ` • <b>Match:</b> ${a.match}%` : ''}</p>
    ${a.portfolio ? `<p><b>Portfolio:</b> <a class="text-blue-600 underline break-all" href="${esc(a.portfolio)}" target="_blank" rel="noopener noreferrer">${esc(a.portfolio)}</a></p>` : ''}<p><b>Resume:</b> ${esc(a.resumeName || '-')}</p></div>
    <p class="text-xs font-semibold mb-1">ข้อความถึง HR</p><div class="p-3 bg-slate-50 rounded-xl text-xs whitespace-pre-line text-slate-700 max-h-64 overflow-y-auto">${esc(a.coverLetter || '-')}</div>
    <div class="flex justify-end gap-2 mt-4">${a.hasResume ? `<button onclick="viewApplicantResume(${a.id})" class="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold"><i class="fa-solid fa-file-pdf mr-1"></i>เปิด Resume</button>` : ''}<button onclick="closeModal()" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-600">ปิด</button></div>`);
}
async function viewApplicantResume(id) {
  const w = window.open('', '_blank'); // เปิดก่อน await เพื่อไม่ให้ถูกบล็อก
  try {
    const r = await fetch(`/api/employer/applications/${id}/resume`, { headers: { Authorization: 'Bearer ' + token() } });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || 'เปิด Resume ไม่สำเร็จ'); }
    const blob = await r.blob(), url = URL.createObjectURL(blob);
    const cd = r.headers.get('Content-Disposition') || '', name = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/) || [])[1] || 'resume');
    if (/pdf|text/.test(blob.type) && w) w.location.href = url;
    else { if (w) w.close(); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { if (w) w.close(); toast(e.message, 'err'); }
}
function changeApplicantStatus(id, status) {
  if (status !== 'interview') return saveStatus(id, { status });
  const d = new Date(Date.now() + 3 * 864e5); d.setHours(10, 0, 0, 0);
  const local = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  modal(`<h2 class="text-lg font-bold mb-2">นัดสัมภาษณ์</h2><p class="text-xs text-slate-500 mb-4">ผู้สมัครจะได้รับแจ้งเตือนพร้อมวันเวลานัด</p>
    <form onsubmit="event.preventDefault();saveStatus(${id},{status:'interview',interviewAt:new Date($('#iv-at').value).toISOString()})" class="space-y-3">
    <label for="iv-at" class="block text-xs font-semibold">วันและเวลาสัมภาษณ์</label><input id="iv-at" type="datetime-local" required value="${local}" class="${inp}">
    <div class="flex justify-end gap-2"><button type="button" onclick="closeModal();drawEmployer()" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-600">ยกเลิก</button><button class="px-5 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold">ยืนยันนัด</button></div></form>`);
}
async function saveStatus(id, body) {
  try { await api(`/api/employer/applications/${id}/status`, 'PATCH', body); closeModal(); await renderEmployer(); toast(`อัปเดตเป็น "${STATUS_TH[body.status]}" และแจ้งผู้สมัครแล้ว`); }
  catch (e) { toast(e.message, 'err'); drawEmployer(); }
}

/* ---------- Init ---------- */
(async function init() {
  const dz = $('#drop-zone');
  dz.addEventListener('click', pickFile);
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); } });
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('bg-blue-100'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('bg-blue-100'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('bg-blue-100'); if (e.dataTransfer.files[0]) handleResume(e.dataTransfer.files[0]); });
  $('#job-search').addEventListener('input', renderJobs); $('#job-sort').addEventListener('change', renderJobs);
  $('#bell').addEventListener('click', e => { e.stopPropagation(); $('#notif-panel').classList.toggle('hidden'); });
  document.addEventListener('click', e => { if (!e.target.closest('#notif-panel')) $('#notif-panel').classList.add('hidden'); });
  updateAuthUI(); renderNotifs(); loadStatus();
  if (!token()) { loginModal(); return; }
  try { S.user = await api('/me'); updateAuthUI(); await bootData(); switchTab(S.user.role === 'employer' ? 'employer' : 'resume'); }
  catch { clearToken(); resetState(); updateAuthUI(); loginModal(); }
})();
