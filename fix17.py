import re

with open('src/app/shared/services/tab.state.service.ts', 'r', encoding='utf-8') as f:
    content = f.read()

target = r'''let bodyObj = null;\\n    if \(body\) \{\\n        try \{\\n            bodyObj = JSON\.parse\(body\);\\n        \} catch \(e\) \{\}\\n    \}'''
replacement = r'''let bodyObj = null;\n    if (body) {\n        try {\n            const cleanedBody = body.replace(/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*/g, \\'\\').trim();\n            bodyObj = JSON.parse(cleanedBody);\n        } catch (e) {}\n    }'''

content = re.sub(target, replacement, content)

with open('src/app/shared/services/tab.state.service.ts', 'w', encoding='utf-8') as f:
    f.write(content)
