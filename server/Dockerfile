# Phloem relay — zero-dependency Node server. Deploy to Railway / Render / Fly / any Docker host.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV PORT=8787
EXPOSE 8787
CMD ["node", "src/index.mjs"]
