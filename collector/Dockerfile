FROM python:3.12-slim
WORKDIR /app
COPY requirements.lock.txt ./requirements.lock.txt
RUN pip install --no-cache-dir -r requirements.lock.txt && useradd --uid 10001 --create-home collector && mkdir /data && chown collector /data
COPY jtopology ./jtopology
USER 10001
EXPOSE 8080
CMD ["python","-m","uvicorn","jtopology.api:app_factory","--factory","--host","0.0.0.0","--port","8080","--no-access-log"]
