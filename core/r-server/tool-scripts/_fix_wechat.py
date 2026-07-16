import re

with open("/opt/biof3-r-server/tool-scripts/enrichment-report-template.html") as f:
    html = f.read()

# Remove any existing broken wechat content from body
html = re.sub(r'<div class="wechat-float">.*?</div>\s*</div>', '', html, count=1, flags=re.DOTALL)
# Remove orphan large base64 img if any
html = re.sub(r'<img src="data:image/jpeg;base64,[A-Za-z0-9+/=]{1000,}"[^>]*>', '', html)

# Get correct card from DESeq2
with open("/opt/biof3-r-server/tool-scripts/deseq2-report-template.html") as f:
    deseq = f.read()

m = re.search(r'(<div class="wechat-float">.*?</div>\s*</div>)', deseq, re.DOTALL)
if not m:
    print("ERROR: no wechat card in deseq2")
    exit(1)

wechat_html = m.group(1)
print("Card length:", len(wechat_html))

# Insert after <header class="report-header">
target = '<header class="report-header">'
if target not in html:
    print("ERROR: header tag not found")
    exit(1)

html = html.replace(target, target + wechat_html, 1)

with open("/opt/biof3-r-server/tool-scripts/enrichment-report-template.html", "w") as f:
    f.write(html)

print("OK. Has wechat-float:", 'wechat-float' in html)
print("Has info div:", 'class="info"' in html)
