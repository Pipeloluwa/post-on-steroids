import re

with open('src/app/components/workspace/body.types.component/body.types.component.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r',\s*channelName:\s*\'\'', '', content)

with open('src/app/components/workspace/body.types.component/body.types.component.ts', 'w', encoding='utf-8') as f:
    f.write(content)
