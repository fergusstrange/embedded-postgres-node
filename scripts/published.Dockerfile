ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine
WORKDIR /consumer
COPY package.json package.json
COPY .github/upstream.json .github/upstream.json
COPY scripts/check-published.mjs scripts/check-published.mjs
COPY test/fixtures/released-consumer.mjs test/fixtures/released-consumer.mjs
USER node
ENTRYPOINT ["npm", "run", "check:published", "--"]
