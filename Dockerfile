FROM node:20-slim

# Cài các thư viện hệ thống cần cho Chromium
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-noto-cjk \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libgdk-pixbuf2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  ca-certificates \
  wget \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache npm install layer
COPY package.json package-lock.json* ./
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm install --omit=dev

# Copy source
COPY bot.js util.js server.js ./

# Tạo thư mục runtime
RUN mkdir -p zalo_session images

VOLUME ["/app/zalo_session", "/app/images"]

ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]

