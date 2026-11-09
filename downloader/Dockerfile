# Media downloader for Cloud: gallery-dl + yt-dlp + ffmpeg, small stdlib HTTP API.
FROM python:3.13-alpine
RUN apk add --no-cache ffmpeg ca-certificates
# Rebuilt weekly with a new UPDATED value so the tools pick up site fixes.
ARG UPDATED=0
RUN pip install --no-cache-dir --upgrade "yt-dlp[default]" gallery-dl && echo "tools as of $UPDATED"
COPY app.py /app/app.py
USER 1000:1000
ENV PYTHONUNBUFFERED=1 HOME=/tmp
EXPOSE 8000
CMD ["python", "/app/app.py"]
