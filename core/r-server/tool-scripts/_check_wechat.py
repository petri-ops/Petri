import re
with open("/opt/biof3-r-server/tool-scripts/enrichment-report-template.html") as f:
    html = f.read()
m = re.search(r'<div class="wechat-float">(.*?)</div>\s*</div>', html[:6000], re.DOTALL)
if m:
    content = m.group(1)
    has_info = 'class="info"' in content
    print("Has .info div:", has_info)
    short = re.sub(r'base64,[A-Za-z0-9+/=]{50,}', 'base64,...', content)
    print("Structure:", short[:400])
else:
    print("wechat-float not found or wrong structure")
    # Show what's there
    idx = html.find("wechat-float")
    if idx > 0:
        short = re.sub(r'base64,[A-Za-z0-9+/=]{50,}', 'BASE64', html[idx:idx+500])
        print("Found at:", short)
