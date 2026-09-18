import re

with open('src/app/shared/services/tab.state.service.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'\s*channelName:\s*string;', '', content)
content = re.sub(r'\s*channelName:\s*dto\.encryptionChannel\s*\|\|\s*\'\',', '', content)
content = re.sub(r'\s*channelName:\s*\'\',', '', content)
content = re.sub(r'const chName = typeof channelName !== \\\'undefined\\\' \? channelName : \\\'Default Channel\\\';\\n\s*', '', content)
content = re.sub(r'channelName:\s*chName,\\n\s*', '', content)

with open('src/app/shared/services/tab.state.service.ts', 'w', encoding='utf-8') as f:
    f.write(content)
