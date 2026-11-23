#!/usr/bin/env bash
# Self-signed HTTPS certificate for LAN use (so an iPhone/Android browser may use the microphone).
#   scripts/make_cert.sh 192.168.1.23        -> cert.pem + key.pem (valid 825 days)
#   python run.py --lan --ssl-certfile cert.pem --ssl-keyfile key.pem
# The phone will warn about an unknown certificate. Easier and properly trusted: Tailscale (see README).
set -e
IP="${1:?usage: make_cert.sh <LAN-IP-of-this-computer>}"
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout key.pem -out cert.pem \
  -subj "/CN=khmer-studio" -addext "subjectAltName=IP:${IP},IP:127.0.0.1,DNS:localhost"
echo "wrote cert.pem and key.pem for ${IP}"
