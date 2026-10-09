FROM node:20-alpine

WORKDIR /app

# OCR support for scanned PDF files in Thai and English
RUN apk add --no-cache \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-data-tha \
    tesseract-ocr-data-eng

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["npm", "start"]
