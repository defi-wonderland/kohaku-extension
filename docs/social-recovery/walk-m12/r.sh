#!/bin/zsh
curl -s --max-time 170 -X POST --data-binary @- http://127.0.0.1:${WALK_PORT:-9431}/
