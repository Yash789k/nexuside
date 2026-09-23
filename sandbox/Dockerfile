FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /app
RUN npm init -y && npm install --omit=dev playwright@1.58.2 && apt-get update && apt-get install -y --no-install-recommends python3-pytest && rm -rf /var/lib/apt/lists/*
COPY browser.mjs proxy.mjs ./
USER pwuser
CMD ["node", "/app/browser.mjs"]
