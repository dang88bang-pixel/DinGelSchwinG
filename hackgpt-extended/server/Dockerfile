FROM python:3.12-slim

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py pty_bridge.py scanner.py status.py security.py userstore.py db.py audit.py \
     rights.py ratelimit.py webauthn.py ./

EXPOSE 5000 8765 8766 8767
# Default: Auth-Server. Bridge/Scanner/Status: docker-compose überschreibt command.
CMD ["python", "app.py"]
