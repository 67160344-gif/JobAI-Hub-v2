FROM node:20-alpine

WORKDIR /app

# OCR สำหรับ Resume PDF แบบสแกน (ไทย + อังกฤษ)
RUN apk add --no-cache \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-data-tha \
    tesseract-ocr-data-eng

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/status >/dev/null || exit 1
CMD ["node", "server.js"]
