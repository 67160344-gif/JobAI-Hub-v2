# JobAI Hub v2 changes

- Real registration/login/logout with bcrypt password hashing + JWT.
- PostgreSQL-backed users, resumes, jobs, applications, reviews, notifications and interview history.
- User-specific data isolation; duplicate applications are unique per user/job.
- Employer portal for posting jobs and managing applications.
- OpenAI Responses API integration for Resume analysis, interview evaluation and cover letters when `OPENAI_API_KEY` is configured.
- PDF scan OCR in Docker using Poppler + Tesseract Thai/English.
- Server-generated Resume Analysis PDF download.
- Frontend auth modal and role-aware navigation.
- `data.json` is retained only as a reference/backup; runtime data is PostgreSQL.
