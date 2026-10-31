#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import urllib.request
import urllib.parse
import ssl
import re
import os
import time
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- HTML PARSER FOR NATIONAL PORTAL PERSONNEL ---
class NationalPortalParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_table = False
        self.in_tr = False
        self.in_cell = False
        self.current_cell = []
        self.current_row = []
        self.tables = []
        self.current_table = []

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.in_table = True
            self.current_table = []
        elif tag == 'tr' and self.in_table:
            self.in_tr = True
            self.current_row = []
        elif tag in ['td', 'th'] and self.in_tr:
            self.in_cell = True
            self.current_cell = []

    def handle_endtag(self, tag):
        if tag in ['td', 'th'] and self.in_cell:
            self.in_cell = False
            self.current_row.append(" ".join("".join(self.current_cell).split()))
        elif tag == 'tr' and self.in_tr:
            self.in_tr = False
            if self.current_row:
                self.current_table.append(self.current_row)
        elif tag == 'table' and self.in_table:
            self.in_table = False
            if self.current_table:
                self.tables.append(self.current_table)

    def handle_data(self, data):
        if self.in_cell:
            self.current_cell.append(data)


def clean_person_record(raw_name, raw_desig, raw_email, raw_phone, raw_office=""):
    name = str(raw_name or '').strip()
    desig = str(raw_desig or '').strip()
    email = str(raw_email or '').strip()
    phone = str(raw_phone or '').strip()

    # Filter out header rows
    if not name or len(name) < 3:
        return None
    if name in ['নাম', 'Name', 'নাম (বাংলা)', 'কর্মকর্তার নাম', 'শিক্ষকের নাম', 'কর্মচারীর নাম', 'ক্রমিক', 'ছবি']:
        return None
    if desig in ['পদবি', 'পদবী', 'Designation', 'পদ']:
        desig = ''

    # Clean email
    email_match = re.search(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', email)
    clean_email = email_match.group(0).lower() if email_match else ''

    # Clean mobile phone
    mob_match = re.search(r'(?:\+?88)?01[3-9][0-9\-]{8,10}|[০-৯]{11}', phone)
    clean_phone = mob_match.group(0) if mob_match else phone

    if not desig:
        desig = 'শিক্ষক / কর্মকর্তা'

    return {
        'name': name,
        'designation': desig,
        'office': raw_office,
        'email': clean_email,
        'mobile': clean_phone
    }


def parse_personnel_html(html_text):
    if not html_text:
        return []

    parser = NationalPortalParser()
    try:
        parser.feed(html_text)
    except Exception:
        pass

    extracted = []
    seen_names = set()

    # --- STRATEGY 1: Key-Value Card Tables (Standard National Portal) ---
    current_person = {}
    for tbl in parser.tables:
        is_kv = True
        tbl_dict = {}
        for row in tbl:
            if len(row) == 2:
                k = row[0].strip()
                v = row[1].strip()
                tbl_dict[k] = v
            else:
                is_kv = False
                break

        if is_kv and tbl_dict:
            if 'নাম' in tbl_dict or 'পদবি' in tbl_dict or 'পদবী' in tbl_dict:
                if current_person.get('name'):
                    rec = clean_person_record(
                        current_person.get('name'),
                        current_person.get('designation'),
                        current_person.get('email'),
                        current_person.get('mobile'),
                        current_person.get('office', '')
                    )
                    if rec and rec['name'] not in seen_names:
                        seen_names.add(rec['name'])
                        extracted.append(rec)

                current_person = {
                    'name': tbl_dict.get('নাম', ''),
                    'designation': tbl_dict.get('পদবি', '') or tbl_dict.get('পদবী', ''),
                    'office': tbl_dict.get('অফিস', ''),
                    'email': tbl_dict.get('ইমেইল', ''),
                    'mobile': tbl_dict.get('মোবাইল', '') or tbl_dict.get('ফোন (অফিস)', '') or tbl_dict.get('ফোন', '')
                }
            elif current_person and any(k in tbl_dict for k in ['মোবাইল', 'ফোন (অফিস)', 'ফোন', 'ইমেইল']):
                if not current_person.get('mobile'):
                    current_person['mobile'] = tbl_dict.get('মোবাইল', '') or tbl_dict.get('ফোন (অফিস)', '') or tbl_dict.get('ফোন', '')
                if not current_person.get('email') and 'ইমেইল' in tbl_dict:
                    current_person['email'] = tbl_dict.get('ইমেইল', '')

    if current_person.get('name'):
        rec = clean_person_record(
            current_person.get('name'),
            current_person.get('designation'),
            current_person.get('email'),
            current_person.get('mobile'),
            current_person.get('office', '')
        )
        if rec and rec['name'] not in seen_names:
            seen_names.add(rec['name'])
            extracted.append(rec)

    if len(extracted) >= 2:
        return extracted

    # --- STRATEGY 2: Multi-Column Data Tables ---
    for tbl in parser.tables:
        if len(tbl) < 2:
            continue
        # Check header row
        header = [c.lower() for c in tbl[0]]
        name_idx, desig_idx, email_idx, mob_idx = -1, -1, -1, -1
        for idx, col in enumerate(header):
            if any(k in col for k in ['নাম', 'name']):
                name_idx = idx
            elif any(k in col for k in ['পদবি', 'পদবী', 'designation']):
                desig_idx = idx
            elif any(k in col for k in ['ইমেইল', 'email']):
                email_idx = idx
            elif any(k in col for k in ['মোবাইল', 'ফোন', 'mobile', 'phone', 'contact']):
                mob_idx = idx

        if name_idx != -1:
            for row in tbl[1:]:
                if len(row) <= name_idx:
                    continue
                name_val = row[name_idx]
                desig_val = row[desig_idx] if desig_idx != -1 and len(row) > desig_idx else ''
                email_val = row[email_idx] if email_idx != -1 and len(row) > email_idx else ''
                mob_val = row[mob_idx] if mob_idx != -1 and len(row) > mob_idx else ''

                rec = clean_person_record(name_val, desig_val, email_val, mob_val)
                if rec and rec['name'] not in seen_names:
                    seen_names.add(rec['name'])
                    extracted.append(rec)

    return extracted


# --- NETWORK FETCHER WITH RETRIES ---
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'bn-BD,bn;q=0.9,en-US;q=0.8,en;q=0.7'
}

def fetch_url(url, timeout=12):
    if not url:
        return ""
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='ignore')
    except Exception:
        return ""


def process_college(inst):
    inst_id = inst['id']
    name = inst.get('bn_name') or inst.get('name')
    web_url = inst.get('web_url', '').rstrip('/')
    
    officer_urls = [
        inst.get('officer_url'),
        f"{web_url}/pages/officers" if web_url else None,
        f"{web_url}/site/page/officers" if web_url else None
    ]
    staff_urls = [
        inst.get('staff_url'),
        f"{web_url}/pages/staff-profiles" if web_url else None,
        f"{web_url}/site/page/staff" if web_url else None
    ]

    # Fetch officers
    new_officers = []
    for u in filter(None, officer_urls):
        html = fetch_url(u)
        parsed = parse_personnel_html(html)
        if len(parsed) >= 2:
            new_officers = parsed
            break

    # Fetch staff
    new_staff = []
    for u in filter(None, staff_urls):
        html = fetch_url(u)
        parsed = parse_personnel_html(html)
        if len(parsed) >= 1:
            new_staff = parsed
            break

    # Reconcile or update
    off_updated = False
    if len(new_officers) >= 2:
        inst['officers'] = new_officers
        off_updated = True
        # Update principal_name
        for o in new_officers:
            if 'অধ্যক্ষ' in o.get('designation', ''):
                inst['principal_name'] = o['name']
                break

    st_updated = False
    if len(new_staff) >= 1:
        inst['staff'] = new_staff
        st_updated = True

    return {
        'id': inst_id,
        'name': name,
        'off_count': len(inst.get('officers', [])),
        'st_count': len(inst.get('staff', [])),
        'off_updated': off_updated,
        'st_updated': st_updated
    }


def main():
    json_path = 'www/data/tsc_data.json'
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    total = len(data)
    print(f"Starting crawl for {total} colleges with 10 threads...")
    start_time = time.time()

    updated_count = 0
    results_log = []

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(process_college, inst): inst for inst in data}
        completed = 0
        for f in as_completed(futures):
            completed += 1
            res = f.result()
            if res['off_updated'] or res['st_updated']:
                updated_count += 1
            results_log.append(f"[{completed}/{total}] {res['name']}: {res['off_count']} officers, {res['st_count']} staff (Updated: {res['off_updated']})")
            if completed % 15 == 0 or completed == total:
                print(f"Progress: {completed}/{total} colleges processed ({updated_count} fresh updates)...")

    duration = time.time() - start_time
    print(f"\nCrawling finished in {duration:.1f} seconds!")
    print(f"Total colleges updated with fresh portal data: {updated_count}")

    # Save to JSON
    with open('www/data/tsc_data.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Save to JS
    compact_data = json.dumps(data, ensure_ascii=False)
    with open('www/data/tsc_data.js', 'w', encoding='utf-8') as f:
        f.write('window.TSC_DATA = ' + compact_data + ';')

    # Update tsc_directory_app.html
    html_file = 'tsc_directory_app.html'
    if os.path.exists(html_file):
        with open(html_file, 'r', encoding='utf-8') as f:
            content = f.read()
        updated_html, cnt = re.subn(
            r'const TSC_DATA = \[.*?\];',
            lambda m: f'const TSC_DATA = {compact_data};',
            content,
            count=1,
            flags=re.S
        )
        if cnt == 1:
            with open(html_file, 'w', encoding='utf-8') as f:
                f.write(updated_html)
            print("Successfully updated tsc_directory_app.html as well!")

    with open('crawl_summary.txt', 'w', encoding='utf-8') as f:
        f.write("\n".join(results_log))
    print("Summary written to crawl_summary.txt")


if __name__ == '__main__':
    main()
