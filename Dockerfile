FROM ghcr.io/puppeteer/puppeteer:21.6.1
USER 0
WORKDIR /app
COPY . /app
RUN chown -R pptruser:pptruser /app
RUN chmod -R 755 /app
USER pptruser
RUN chmod +x /app/startup.sh
RUN yarn --frozen-lockfile
RUN yarn build
CMD /app/startup.sh