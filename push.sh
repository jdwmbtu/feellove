#!/bin/bash
git add .
git commit -m "Auto-update: $(date)"
git push
echo "Pushed to GitHub at $(date)"