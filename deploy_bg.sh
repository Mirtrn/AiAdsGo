#!/bin/bash
while true; do
  SIZE=$(stat -c%s /home/ubuntu/autoads/dist/background-worker.js 2>/dev/null || echo 0)
  echo "bg size: $SIZE"
  if [ "$SIZE" -gt 58000000 ]; then
    break
  fi
  sleep 5
done
echo "SCP complete, copying to container..."
sudo docker cp /home/ubuntu/autoads/dist/background-worker.js autoads:/app/dist/background-worker.js
echo "Restarting background-worker..."
sudo docker exec autoads supervisorctl restart background-worker
echo BG_DONE
