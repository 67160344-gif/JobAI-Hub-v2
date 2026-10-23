/* ทดสอบ rule-based engine: node test/analyzer.test.js (ไม่ต้องใช้ฐานข้อมูล) */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const A = require('../lib/analyzer');
const NOW = new Date('2026-10-23T00:00:00+07:00');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✓', name); };

t('ปีประสบการณ์แบบระบุตรง', () => {
  assert.strictEqual(A.extractYears('ประสบการณ์ 3 ปี 6 เดือน', NOW), 3.5);
  assert.strictEqual(A.extractYears('5+ years of experience in design', NOW), 5);
});
t('ปีประสบการณ์จากช่วงปี (รวม พ.ศ. และไม่นับการศึกษา)', () => {
  const txt = 'Designer (2563 - 2565)\nUX Lead (2022 - ปัจจุบัน)\nมหาวิทยาลัยบูรพา (2016 - 2020)';
  assert.strictEqual(A.extractYears(txt, NOW), 7); // 2020 (พ.ศ. 2563) -> ต.ค. 2026 ≈ 6.75 ปี ปัดเป็น 7
  assert.strictEqual(A.extractYears('อายุ 25 ปี', NOW), null);
});
t('label ปี', () => {
  assert.strictEqual(A.yearsLabel(3.5), '3 ปี 6 เดือน');
  assert.strictEqual(A.yearsLabel(null), 'ไม่ระบุ');
});
t('วิเคราะห์ sample resume', () => {
  const r = A.analyzeResume(fs.readFileSync(path.join(__dirname, '../samples/Somchai_Resume_2026.txt'), 'utf8'), NOW);
  assert.ok(r.score >= 75 && r.score <= 100, r.score);
  assert.ok(r.skills.includes('Figma') && r.skills.includes('User Research'));
  assert.strictEqual(r.years, '3 ปี 6 เดือน');
  assert.strictEqual(r.field, 'UX/UI Design');
  const weak = A.analyzeResume('ชื่อ นาย ก. อยากได้งาน', NOW);
  assert.ok(weak.score < r.score && weak.recs.some(x => x.type === 'warn'));
});
t('Match score สะท้อนทักษะ', () => {
  const resume = { skills: ['Figma', 'User Research'], yearsNumber: 3.5, text: '' };
  const hi = A.matchJob({ title: 'UX Researcher', tags: ['User Research', 'Figma'], exp: '2-4 ปี' }, resume);
  const lo = A.matchJob({ title: 'Backend Dev', tags: ['Java', 'SQL'], exp: '5+ ปี' }, resume);
  assert.ok(hi.match > lo.match, `${hi.match} > ${lo.match}`);
  assert.deepStrictEqual(hi.matchedTags, ['User Research', 'Figma']);
  assert.strictEqual(A.matchJob({ tags: ['Figma'] }, null).match, null);
});
t('ประเมินคำตอบสัมภาษณ์', () => {
  const good = A.evaluateAnswer('q', 'ตอนที่ทำโปรเจกต์ ผมรับผิดชอบหน้า Checkout เป้าหมายคือลดการยกเลิก ขั้นแรกวิเคราะห์ข้อมูลและทดสอบกับผู้ใช้ จากนั้นประชุมกับทีม Developer ผลลัพธ์คือยอดจองเพิ่มขึ้น 35%');
  const bad = A.evaluateAnswer('q', 'ได้ครับ');
  assert.ok(good.total > 70 && bad.total < 30, `${good.total} / ${bad.total}`);
  for (const k of ['clarity', 'problem', 'teamwork']) assert.ok(good[k] >= 1 && good[k] <= 10);
});
t('คำถามและ cover letter', () => {
  const job = { title: 'UX Researcher', company: 'CloudNine', tags: ['User Research', 'Figma'] };
  assert.strictEqual(A.interviewQuestions(job).length, 5);
  const g = A.interviewQuestions(null);
  assert.strictEqual(g.length, 5);
  assert.strictEqual(new Set(g).size, 5);
  assert.ok(A.interviewQuestions(job).some(q => q.includes('UX Researcher')));
  const seen = new Set(); for (let i = 0; i < 30; i++) A.interviewQuestions(null).forEach(q => seen.add(q));
  assert.ok(seen.size > 20, 'ควรสุ่มได้หลากหลาย: ' + seen.size);
  const cl = A.coverLetter(job, { skills: ['Figma'], years: '3 ปี' }, 'สมชาย');
  assert.ok(cl.includes('CloudNine') && cl.includes('Figma') && cl.endsWith('สมชาย'));
});
console.log(`\n${passed} tests passed`);
