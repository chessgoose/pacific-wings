#!/bin/bash
cd /Users/lzhao/Downloads/pacific-wings
echo "Starting server at http://localhost:8765/mission_reviewer.html"
python3 -m http.server 8765 &
SERVER_PID=$!
sleep 0.5
open http://localhost:8765/mission_reviewer.html
wait $SERVER_PID
