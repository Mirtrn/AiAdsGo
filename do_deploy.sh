#!/bin/bash
cd /home/ubuntu/autoads
echo "[start $(date)]" >> /tmp/deploy2.log
sudo docker build -t autoads:single . >> /tmp/deploy2.log 2>&1
sudo docker stop autoads >> /tmp/deploy2.log 2>&1 || true
sudo docker rm autoads >> /tmp/deploy2.log 2>&1 || true
sudo docker-compose -f docker-compose.single.yml up -d >> /tmp/deploy2.log 2>&1
echo "[DEPLOY_DONE $(date)]" >> /tmp/deploy2.log
