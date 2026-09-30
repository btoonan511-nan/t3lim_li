"""يدمج apps-script/Code.gs و apps-script/Index.html في ملف واحد apps-script/app.gs."""
code = open('apps-script/Code.gs', encoding='utf-8').read()
html = open('apps-script/Index.html', encoding='utf-8').read()
assert '`' not in html and '${' not in html, 'Index.html must not contain backticks or ${'
old = "HtmlService.createHtmlOutputFromFile('Index')"
assert old in code
code = code.replace(old, 'HtmlService.createHtmlOutput(INDEX_HTML)')
header_old = code[:code.index('*/') + 2]
header_new = ('/**\n * نظام تسجيل أعمال الصيانة - شركة سماء الميدان المحدودة\n'
              ' * ملف واحد جاهز: الصقه كاملاً في مشروع Apps Script ثم انشره كتطبيق ويب.\n'
              ' * (مولّد من Code.gs و Index.html عبر build.py)\n */')
code = code.replace(header_old, header_new, 1)
out = code.rstrip() + '\n\n// واجهة التطبيق (منسوخة من Index.html)\nconst INDEX_HTML = `' + html + '`;\n'
open('apps-script/app.gs', 'w', encoding='utf-8').write(out)
