import re

with open('src/app/shared/services/request.execution.service.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r',\s*channelName:\s*freshState\.encryption\?\.channelName\s*\|\|\s*\'\'', '', content)

with open('src/app/shared/services/request.execution.service.ts', 'w', encoding='utf-8') as f:
    f.write(content)
