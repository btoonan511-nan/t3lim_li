"""يولّد من apps-script/Code.gs و apps-script/Index.html:
- apps-script/app.gs : ملف واحد يُلصق في Apps Script.
- docs/index.html    : نسخة الموقع (GitHub Pages) تتصل بـ Apps Script عبر API_URL.
"""
API_URL = 'https://script.google.com/macros/s/AKfycbxH_xyC6WmTo3rsvfg5lT9WqiEdfm0GR4r7qd-GKs5ynRLq-8YuFCNd9AZu74zaNhju/exec'

code = open('apps-script/Code.gs', encoding='utf-8').read()
html = open('apps-script/Index.html', encoding='utf-8').read()

# --- app.gs ---
assert '`' not in html and '${' not in html, 'Index.html must not contain backticks or ${'
old = "HtmlService.createHtmlOutputFromFile('Index')"
assert old in code
app = code.replace(old, 'HtmlService.createHtmlOutput(INDEX_HTML)')
header_old = app[:app.index('*/') + 2]
header_new = ('/**\n * نظام تسجيل أعمال الصيانة - شركة سماء الميدان المحدودة\n'
              ' * ملف واحد جاهز: الصقه كاملاً في مشروع Apps Script ثم انشره كتطبيق ويب.\n'
              ' * (مولّد من Code.gs و Index.html عبر build.py)\n */')
app = app.replace(header_old, header_new, 1)
app = app.rstrip() + '\n\n// واجهة التطبيق (منسوخة من Index.html)\nconst INDEX_HTML = `' + html + '`;\n'
open('apps-script/app.gs', 'w', encoding='utf-8').write(app)

# --- docs/index.html ---
site = html.replace("var API_URL = '';", "var API_URL = '" + API_URL + "';", 1)
assert API_URL in site
site = site.replace('  <base target="_top">\n', '', 1)
site = site.replace(
    '  <meta name="viewport" content="width=device-width, initial-scale=1">\n',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '  <title>تسجيل أعمال الصيانة - سماء الميدان</title>\n'
    '  <meta name="theme-color" content="#7f1d2d">\n'
    '  <link rel="manifest" href="manifest.json">\n'
    '  <link rel="icon" href="icon.svg" type="image/svg+xml">\n'
    '  <link rel="apple-touch-icon" href="icon-192.png">\n'
    '  <meta name="apple-mobile-web-app-capable" content="yes">\n'
    '  <meta name="apple-mobile-web-app-title" content="أعمال الصيانة">\n', 1)
assert 'manifest.json' in site
open('docs/index.html', 'w', encoding='utf-8').write(site)
print('built apps-script/app.gs and docs/index.html')
