#!/bin/bash
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"
cd "$(dirname "$0")"

# Ferma eventuale server già attivo sulla porta 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null
sleep 0.5

# Avvia il server
node server.js &
SERVER_PID=$!

# Aspetta che il server risponda (max 10 secondi)
for i in {1..20}; do
  sleep 0.5
  curl -s http://localhost:3000 > /dev/null 2>&1 && break
done

# Apre l'admin nel browser
open http://localhost:3000/admin

echo ""
echo "  Admin → http://localhost:3000/admin"
echo "  Chiudi questa finestra per fermare il server."
echo ""

# Quando si chiude la finestra, ferma il server
trap "kill $SERVER_PID 2>/dev/null" EXIT
wait $SERVER_PID
