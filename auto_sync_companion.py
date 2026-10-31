#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
বাংলাদেশ ১৫৫টি সরকারি টেকনিক্যাল স্কুল ও কলেজ (TSC) — লোকাল অটো-সিঙ্ক ও অটো-সেভ সার্ভার
এই স্ক্রিপ্টটি চালু থাকলে ব্রাউজার অ্যাপটি সরাসরি *.gov.bd সার্ভার থেকে ডাটা চেক করে এবং কোনো পরিবর্তন পেলে
স্বয়ংক্রিয়ভাবে tsc_directory_app.html ফাইলের ভেতরেই স্থায়ীভাবে সেভ করে ফেলে।
"""
import http.server
import socketserver
import urllib.request
import urllib.parse
import webbrowser
import os
import json
import re
import threading

PORT = 8765
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class AutoSyncHandler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/fetch':
            qs = urllib.parse.parse_qs(parsed.query)
            target_url = qs.get('url', [''])[0]
            if not target_url:
                self.send_response(400)
                self.end_headers()
                return
            try:
                req = urllib.request.Request(
                    target_url,
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_response(502)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
            return
        return super().do_GET()

    def do_POST(self):
        if self.path == '/auto-save':
            try:
                length = int(self.headers.get('Content-Length', 0))
                raw = self.rfile.read(length).decode('utf-8')
                payload = json.loads(raw)
                new_tsc_data = payload.get('tsc_data')
                if isinstance(new_tsc_data, list) and len(new_tsc_data) >= 150:
                    html_file = os.path.join(DIRECTORY, 'tsc_directory_app.html')
                    if os.path.exists(html_file):
                        with open(html_file, 'r', encoding='utf-8') as f:
                            content = f.read()
                        compact = json.dumps(new_tsc_data, ensure_ascii=False)
                        updated, cnt = re.subn(
                            r'const TSC_DATA = \[.*?\];',
                            lambda m: f'const TSC_DATA = {compact};',
                            content,
                            count=1,
                            flags=re.S
                        )
                        if cnt == 1:
                            with open(html_file, 'w', encoding='utf-8') as f:
                                f.write(updated)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b'{"status":"saved"}')
            except Exception as e:
                self.send_response(500)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
            return
        self.send_response(404)
        self.end_headers()

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), AutoSyncHandler) as httpd:
        url = f"http://127.0.0.1:{PORT}/tsc_directory_app.html"
        print(f"TSC Auto-Sync & Auto-Save Server running at {url}")
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        httpd.serve_forever()
