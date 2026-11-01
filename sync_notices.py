import json
import os
import sys
import urllib.request
import crawler_v2

ONESIGNAL_APP_ID = os.environ.get('ONESIGNAL_APP_ID', 'f0739958-8121-4f10-9188-bd1bb96e1a49') # Optional OneSignal App ID
ONESIGNAL_REST_KEY = os.environ.get('ONESIGNAL_REST_KEY', '')

def send_push_notification(title, message, url=''):
    if not ONESIGNAL_REST_KEY or not ONESIGNAL_APP_ID:
        print("OneSignal keys not configured, skipping push notification broadcast.")
        return
    
    payload = {
        "app_id": ONESIGNAL_APP_ID,
        "included_segments": ["All"],
        "headings": {"en": title, "bn": title},
        "contents": {"en": message, "bn": message},
        "url": url
    }
    try:
        req = urllib.request.Request(
            "https://onesignal.com/api/v1/notifications",
            data=json.dumps(payload).encode('utf-8'),
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": f"Basic {ONESIGNAL_REST_KEY}"
            }
        )
        res = urllib.request.urlopen(req, timeout=10)
        print("Push notification sent successfully:", res.status)
    except Exception as e:
        print(f"Failed to send push notification: {e}")

def main():
    old_titles = set()
    if os.path.exists('www/data/notices_data.json'):
        try:
            with open('www/data/notices_data.json', 'r', encoding='utf-8') as f:
                existing = json.load(f)
                for item in existing:
                    old_titles.add(item.get('title', '').strip())
        except Exception as e:
            print(f"Error reading existing notices: {e}")

    # Crawl fresh notices
    notices = crawler_v2.crawl_official_notices()
    if not notices:
        print("No notices extracted.")
        return

    # Check for newly added notices
    brand_new = []
    for n in notices:
        t = n.get('title', '').strip()
        if t and t not in old_titles:
            brand_new.append(n)

    if brand_new:
        print(f"Found {len(brand_new)} brand-new notice(s)!")
        latest = brand_new[0]
        category = latest.get('category_name', 'অফিসিয়াল নোটিশ')
        title = f"📢 নতুন {category}"
        body = latest.get('title', '')[:100]
        pdf_or_url = latest.get('pdf_url') or latest.get('detail_url') or ''
        
        send_push_notification(title, body, pdf_or_url)
    else:
        print("All notices are already up to date.")

if __name__ == '__main__':
    main()
