@echo off
chcp 65001 >nul
echo Starting Bangladesh 155 TSC Directory App with Automatic Daily Website Sync & Disk Auto-Save...
python auto_sync_companion.py || start "" "tsc_directory_app.html"
