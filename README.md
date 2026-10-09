# JobAI Hub v2

เวอร์ชันนี้เปลี่ยนจาก Demo ที่เก็บข้อมูลใน `data.json` เป็นระบบ PostgreSQL + JWT และเพิ่ม Employer Portal, OCR, AI API และ PDF จริง

## รันด้วย Docker (แนะนำ)
1. สร้างไฟล์ `.env` ในโฟลเดอร์โปรเจกต์:
```env
OPENAI_API_KEY=ใส่คีย์ของคุณ
OPENAI_MODEL=gpt-6-luna
```
2. รัน:
```bash
docker compose up --build
```
3. เปิด `http://localhost:3000`

ถ้าไม่มี `OPENAI_API_KEY` ระบบยังเปิดได้ แต่ Resume/Interview/Cover Letter จะใช้โหมดสำรองและ UI จะแสดงว่าไม่ได้ใช้ AI จริง

## บัญชี Demo
- Job seeker: `somchai` / `demo1234`
- Employer: `suda` / `demo1234`

## สิ่งที่เพิ่ม
- Login/Register/Logout จริงด้วย JWT และ password hash
- ข้อมูล Resume, ใบสมัคร, notification และประวัติการประเมินแยกตาม user
- PostgreSQL เป็นฐานข้อมูลหลัก; `data.json` ไม่ถูกใช้เป็น runtime database แล้ว
- Employer ลงประกาศงานเองและดู/อัปเดตใบสมัครได้
- Resume PDF สแกนพยายาม OCR ด้วย Poppler + Tesseract ใน Docker
- Resume analysis / interview evaluation / cover letter ต่อ OpenAI Responses API เมื่อมี API key
- สร้าง Resume Analysis PDF จริงจาก backend

## หมายเหตุ
การใช้ OpenAI API มีค่าใช้จ่ายตามบัญชี API ของคุณ และต้องตั้ง `OPENAI_API_KEY` เอง
