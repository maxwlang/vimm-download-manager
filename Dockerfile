FROM ghcr.io/puppeteer/puppeteer:21.6.1
WORKDIR /app
ADD . /app
RUN chmod +x ./startup.sh
RUN yarn --frozen-lockfile
RUN yarn build
CMD ./startup.sh